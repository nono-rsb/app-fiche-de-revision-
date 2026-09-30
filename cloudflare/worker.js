// Version Cloudflare de Révise apps : Workers + D1 (base) + R2 (fichiers).
// Même API que server.js ; le front dans public/ est identique.

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => Date.now();
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...headers } });

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = (bytes = 24) => {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// PBKDF2 (scrypt n'est pas disponible dans Workers). 100 000 = maximum autorisé par Cloudflare.
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return toHex(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const cleanText = (v, max = 100) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const sessionCookie = (token, maxAge = SESSION_TTL_MS / 1000) =>
  `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

async function rateLimit(env, request, name, limit, windowMs) {
  const key = `${name}|${request.headers.get('CF-Connecting-IP') || 'local'}`;
  const since = now() - windowMs;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND t > ?').bind(key, since).first();
  if (n >= limit) throw new HttpError(429, 'Trop de tentatives, réessaie plus tard.');
  await env.DB.prepare('INSERT INTO attempts (key, t) VALUES (?, ?)').bind(key, now()).run();
  if (Math.random() < 0.02) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM attempts WHERE t < ?').bind(now() - 3600 * 1000),
      env.DB.prepare('DELETE FROM sessions WHERE created_at < ?').bind(now() - SESSION_TTL_MS),
    ]);
  }
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Requête invalide');
  }
}

async function authenticate(env, request) {
  const token = parseCookies(request.headers.get('Cookie') || '').sid;
  if (token) {
    const user = await env.DB.prepare(
      `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.created_at > ?`
    ).bind(token, now() - SESSION_TTL_MS).first();
    if (user) return user;
  }
  throw new HttpError(401, 'Non connecté');
}

const publicFiche = (f) => ({
  id: f.id, title: f.title, classe: f.classe, matiere: f.matiere, cours: f.cours,
  mime: f.mime, size: f.size, originalName: f.original_name, createdAt: f.created_at, shareToken: f.share_token || null,
});

// Vérifie que le contenu correspond au type annoncé (le type envoyé par le client n'est pas fiable).
async function matchesMagic(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const s = (from, str) => [...str].every((c, i) => b[from + i] === c.charCodeAt(0));
  switch (file.type) {
    case 'application/pdf': return s(0, '%PDF');
    case 'image/png': return b[0] === 0x89 && s(1, 'PNG');
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8;
    case 'image/gif': return s(0, 'GIF8');
    case 'image/webp': return s(0, 'RIFF') && s(8, 'WEBP');
    default: return false;
  }
}

async function sendFile(env, f) {
  const obj = await env.FILES.get(f.stored_name);
  if (!obj) throw new HttpError(404, 'Fichier introuvable');
  return new Response(obj.body, {
    headers: {
      'Content-Type': f.mime,
      'Content-Length': String(obj.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
      // Même en-tête que la version Node (server.js).
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

async function ownFiche(env, user, id) {
  const f = await env.DB.prepare('SELECT * FROM fiches WHERE id = ? AND user_id = ?').bind(Number(id), user.id).first();
  if (!f) throw new HttpError(404, 'Fiche introuvable');
  return f;
}
const sharedFiche = (env, token) =>
  env.DB.prepare('SELECT f.*, u.name AS owner FROM fiches f JOIN users u ON u.id = f.user_id WHERE f.share_token = ?').bind(token).first();

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  let m;

  // ----- Compte -----
  if (pathname === '/api/register' && method === 'POST') {
    await rateLimit(env, request, 'register', 10, 3600 * 1000);
    const body = await readBody(request);
    const email = cleanText(body.email, 200).toLowerCase();
    const name = cleanText(body.name, 60);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Email invalide');
    if (!name) throw new HttpError(400, 'Le prénom est obligatoire');
    if (password.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum');
    if (await env.DB.prepare('SELECT 1 AS x FROM users WHERE email = ?').bind(email).first())
      throw new HttpError(409, 'Un compte existe déjà avec cet email');
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
    const res = await env.DB.prepare('INSERT INTO users (email, name, password_hash, salt, created_at) VALUES (?,?,?,?,?)')
      .bind(email, name, await hashPassword(password, salt), salt, now()).run();
    const id = res.meta.last_row_id;
    const token = randomToken();
    await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').bind(token, id, now()).run();
    return json({ id, email, name }, 201, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    await rateLimit(env, request, 'login', 20, 15 * 60 * 1000);
    const body = await readBody(request);
    const email = cleanText(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const hash = await hashPassword(password, user ? user.salt : '0'.repeat(32));
    if (!user || !safeEqual(hash, user.password_hash)) throw new HttpError(401, 'Email ou mot de passe incorrect');
    const token = randomToken();
    await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').bind(token, user.id, now()).run();
    return json({ id: user.id, email: user.email, name: user.name }, 200, { 'Set-Cookie': sessionCookie(token) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = parseCookies(request.headers.get('Cookie') || '').sid;
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (pathname === '/api/me' && method === 'GET') return json(await authenticate(env, request));

  // ----- Liens de partage publics -----
  if ((m = pathname.match(/^\/api\/shared\/([\w-]+)(\/file)?$/)) && method === 'GET') {
    const f = await sharedFiche(env, m[1]);
    if (!f) throw new HttpError(404, 'Lien invalide ou désactivé');
    if (m[2]) return sendFile(env, f);
    return json({ ...publicFiche(f), shareToken: undefined, owner: f.owner });
  }
  if (pathname.startsWith('/s/') && method === 'GET') {
    return env.ASSETS.fetch(new Request(new URL('/shared', request.url), request));
  }

  // ----- Fiches (connecté) -----
  if (pathname === '/api/fiches' && method === 'GET') {
    const user = await authenticate(env, request);
    const { results } = await env.DB.prepare('SELECT * FROM fiches WHERE user_id = ? ORDER BY classe, matiere, cours, created_at DESC').bind(user.id).all();
    return json(results.map(publicFiche));
  }

  if (pathname === '/api/fiches' && method === 'POST') {
    const user = await authenticate(env, request);
    let form;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'Envoi impossible');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Ajoute un PDF ou une photo');
    if (!ALLOWED.includes(file.type) || !(await matchesMagic(file)))
      throw new HttpError(415, 'Formats acceptés : PDF, JPG, PNG, WEBP, GIF');
    if (file.size > MAX_FILE_SIZE) throw new HttpError(413, 'Fichier trop gros (20 Mo max)');
    const classe = cleanText(form.get('classe'));
    const matiere = cleanText(form.get('matiere'));
    const cours = cleanText(form.get('cours'));
    if (!classe || !matiere || !cours) throw new HttpError(400, 'Classe, matière et cours sont obligatoires');
    const original = (file.name || 'fiche').slice(0, 200);
    const title = cleanText(form.get('title'), 150) || cours || original;
    const stored = randomToken(18) + EXT[file.type];
    await env.FILES.put(stored, file.stream(), { httpMetadata: { contentType: file.type } });
    const res = await env.DB.prepare(
      `INSERT INTO fiches (user_id, title, classe, matiere, cours, stored_name, original_name, mime, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(user.id, title, classe, matiere, cours, stored, original, file.type, file.size, now()).run();
    const fiche = await env.DB.prepare('SELECT * FROM fiches WHERE id = ?').bind(res.meta.last_row_id).first();
    return json(publicFiche(fiche), 201);
  }

  if ((m = pathname.match(/^\/api\/fiches\/(\d+)(\/file|\/share)?$/))) {
    const user = await authenticate(env, request);
    const f = await ownFiche(env, user, m[1]);
    const sub = m[2];

    if (!sub && method === 'PATCH') {
      const body = await readBody(request);
      const next = {
        title: cleanText(body.title, 150) || f.title,
        classe: cleanText(body.classe) || f.classe,
        matiere: cleanText(body.matiere) || f.matiere,
        cours: cleanText(body.cours) || f.cours,
      };
      await env.DB.prepare('UPDATE fiches SET title=?, classe=?, matiere=?, cours=? WHERE id=?').bind(next.title, next.classe, next.matiere, next.cours, f.id).run();
      return json(publicFiche({ ...f, ...next }));
    }
    if (!sub && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM fiches WHERE id = ?').bind(f.id).run();
      await env.FILES.delete(f.stored_name);
      return json({ ok: true });
    }
    if (sub === '/file' && method === 'GET') return sendFile(env, f);
    if (sub === '/share' && method === 'POST') {
      const token = f.share_token || randomToken(16);
      await env.DB.prepare('UPDATE fiches SET share_token = ? WHERE id = ?').bind(token, f.id).run();
      return json({ shareToken: token, url: `${url.origin}/s/${token}` });
    }
    if (sub === '/share' && method === 'DELETE') {
      await env.DB.prepare('UPDATE fiches SET share_token = NULL WHERE id = ?').bind(f.id).run();
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Erreur serveur' }, 500);
    }
  },
};
