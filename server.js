const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fiches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    classe TEXT NOT NULL,
    matiere TEXT NOT NULL,
    cours TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    share_token TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fiches_user ON fiches(user_id);
`);

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
// Types acceptés : PDF ou photo. Le type servi vient de cette table, jamais du client.
const ALLOWED = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const app = express();
app.disable('x-powered-by');
// Derrière le proxy de l'hébergeur : bonne IP client (limiteur) et bon https dans les liens de partage.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---------- helpers ----------
const now = () => Date.now();
const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

const cleanText = (v, max = 100) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// Limiteur simple en mémoire pour login / inscription.
const attempts = new Map();
function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}|${req.ip}`;
    const t = now();
    const entry = (attempts.get(key) || []).filter((x) => t - x < windowMs);
    if (entry.length >= limit) return res.status(429).json({ error: 'Trop de tentatives, réessaie plus tard.' });
    entry.push(t);
    attempts.set(key, entry);
    next();
  };
}
setInterval(() => {
  const t = now();
  for (const [k, v] of attempts) if (v.every((x) => t - x > 3600 * 1000)) attempts.delete(k);
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(t - SESSION_TTL_MS);
}, 3600 * 1000).unref();

function auth(req, res, next) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.created_at > ?`
      )
      .get(token, now() - SESSION_TTL_MS);
    if (row) {
      req.user = row;
      return next();
    }
  }
  res.status(401).json({ error: 'Non connecté' });
}

function publicFiche(f) {
  return {
    id: f.id,
    title: f.title,
    classe: f.classe,
    matiere: f.matiere,
    cours: f.cours,
    mime: f.mime,
    size: f.size,
    originalName: f.original_name,
    createdAt: f.created_at,
    shareToken: f.share_token || null,
  };
}

function sendFile(res, f) {
  const full = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.setHeader('Content-Type', f.mime);
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`
  );
  // Pas de CSP `sandbox` : Chrome refuserait alors d'afficher les PDF. Le type servi vient de la
  // liste ALLOWED (jamais du client) + nosniff, donc aucun HTML/JS n'est servi depuis les uploads.
  res.sendFile(full);
}

// ---------- 1. Création de compte ----------
app.post('/api/register', rateLimit(10, 3600 * 1000), (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const name = cleanText(req.body.name, 60);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });
  if (!name) return res.status(400).json({ error: 'Le prénom est obligatoire' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

  const salt = crypto.randomBytes(16).toString('hex');
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash, salt, created_at) VALUES (?,?,?,?,?)')
    .run(email, name, hashPassword(password, salt), salt, now());
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, info.lastInsertRowid, now());
  setSessionCookie(res, token);
  res.status(201).json({ id: Number(info.lastInsertRowid), email, name });
});

app.post('/api/login', rateLimit(20, 15 * 60 * 1000), (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok =
    user &&
    crypto.timingSafeEqual(Buffer.from(hashPassword(password, user.salt), 'hex'), Buffer.from(user.password_hash, 'hex'));
  if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, user.id, now());
  setSessionCookie(res, token);
  res.json({ id: user.id, email: user.email, name: user.name });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---------- 2. Dépôt des fiches (PDF ou photo) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, newToken(18) + (ALLOWED[file.mimetype] || '')),
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(new Error('TYPE'));
    cb(null, true);
  },
});

function uploadOne(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.message === 'TYPE') return res.status(415).json({ error: 'Formats acceptés : PDF, JPG, PNG, WEBP, GIF' });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop gros (20 Mo max)' });
    res.status(400).json({ error: 'Envoi impossible' });
  });
}

// ---------- 3. Classement : classe / matière / cours ----------
app.post('/api/fiches', auth, uploadOne, (req, res) => {
  const discard = () => req.file && fs.rm(req.file.path, () => {});
  if (!req.file) return res.status(400).json({ error: 'Ajoute un PDF ou une photo' });
  const classe = cleanText(req.body.classe);
  const matiere = cleanText(req.body.matiere);
  const cours = cleanText(req.body.cours);
  const title = cleanText(req.body.title, 150) || cours || req.file.originalname;
  if (!classe || !matiere || !cours) {
    discard();
    return res.status(400).json({ error: 'Classe, matière et cours sont obligatoires' });
  }
  // multer donne le nom d'origine en latin1 ; on le remet en UTF-8.
  const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
  const info = db
    .prepare(
      `INSERT INTO fiches (user_id, title, classe, matiere, cours, stored_name, original_name, mime, size, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(req.user.id, title, classe, matiere, cours, req.file.filename, original, req.file.mimetype, req.file.size, now());
  const fiche = db.prepare('SELECT * FROM fiches WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(publicFiche(fiche));
});

app.get('/api/fiches', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM fiches WHERE user_id = ? ORDER BY classe, matiere, cours, created_at DESC')
    .all(req.user.id);
  res.json(rows.map(publicFiche));
});

function ownFiche(req, res) {
  const f = db.prepare('SELECT * FROM fiches WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!f) res.status(404).json({ error: 'Fiche introuvable' });
  return f;
}

app.patch('/api/fiches/:id', auth, (req, res) => {
  const f = ownFiche(req, res);
  if (!f) return;
  const next = {
    title: cleanText(req.body.title, 150) || f.title,
    classe: cleanText(req.body.classe) || f.classe,
    matiere: cleanText(req.body.matiere) || f.matiere,
    cours: cleanText(req.body.cours) || f.cours,
  };
  db.prepare('UPDATE fiches SET title=?, classe=?, matiere=?, cours=? WHERE id=?').run(
    next.title, next.classe, next.matiere, next.cours, f.id
  );
  res.json(publicFiche({ ...f, ...next }));
});

app.delete('/api/fiches/:id', auth, (req, res) => {
  const f = ownFiche(req, res);
  if (!f) return;
  db.prepare('DELETE FROM fiches WHERE id = ?').run(f.id);
  fs.rm(path.join(UPLOAD_DIR, f.stored_name), () => {});
  res.json({ ok: true });
});

app.get('/api/fiches/:id/file', auth, (req, res) => {
  const f = ownFiche(req, res);
  if (f) sendFile(res, f);
});

// ---------- 4. Partage par lien ----------
app.post('/api/fiches/:id/share', auth, (req, res) => {
  const f = ownFiche(req, res);
  if (!f) return;
  const token = f.share_token || newToken(16);
  db.prepare('UPDATE fiches SET share_token = ? WHERE id = ?').run(token, f.id);
  res.json({ shareToken: token, url: `${req.protocol}://${req.get('host')}/s/${token}` });
});

app.delete('/api/fiches/:id/share', auth, (req, res) => {
  const f = ownFiche(req, res);
  if (!f) return;
  db.prepare('UPDATE fiches SET share_token = NULL WHERE id = ?').run(f.id);
  res.json({ ok: true });
});

const sharedFiche = (token) => db.prepare('SELECT f.*, u.name AS owner FROM fiches f JOIN users u ON u.id = f.user_id WHERE f.share_token = ?').get(token);

app.get('/api/shared/:token', (req, res) => {
  const f = sharedFiche(req.params.token);
  if (!f) return res.status(404).json({ error: 'Lien invalide ou désactivé' });
  res.json({ ...publicFiche(f), shareToken: undefined, owner: f.owner });
});

app.get('/api/shared/:token/file', (req, res) => {
  const f = sharedFiche(req.params.token);
  if (!f) return res.status(404).json({ error: 'Lien invalide ou désactivé' });
  sendFile(res, f);
});

app.get('/s/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shared.html')));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Révise apps → http://localhost:${PORT}`));
}
module.exports = app;
