// Parcours complet du schéma : compte -> dépôt -> classement -> lien de partage.
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'revise-'));
const assert = require('assert');
const EXTERNAL = process.env.BASE_URL; // ex : http://localhost:8787 pour tester la version Cloudflare
const app = EXTERNAL ? null : require('../server');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const server = EXTERNAL ? { close() {} } : app.listen(0);
  const base = EXTERNAL || `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (url, opts = {}) => {
    const res = await fetch(base + url, { ...opts, headers: { ...(opts.headers || {}), cookie } });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return res;
  };
  const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = (file, mime, name, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([file], { type: mime }), name);
    return { method: 'POST', body: fd };
  };

  assert.equal((await call('/api/fiches')).status, 401, 'non connecté => 401');
  assert.equal((await call('/api/register', json({ email: 'a@b.fr', name: 'Léa', password: 'court' }))).status, 400);
  let r = await call('/api/register', json({ email: 'lea@ex.fr', name: 'Léa', password: 'motdepasse1' }));
  assert.equal(r.status, 201);
  assert.equal((await call('/api/register', json({ email: 'lea@ex.fr', name: 'X', password: 'motdepasse1' }))).status, 409);

  // dépôt d'un PDF et d'une photo, classés classe/matière/cours
  r = await call('/api/fiches', form(Buffer.from('%PDF-1.4 test'), 'application/pdf', 'pythagore.pdf', { classe: '3e', matiere: 'Maths', cours: 'Pythagore' }));
  assert.equal(r.status, 201);
  const pdf = await r.json();
  r = await call('/api/fiches', form(PNG, 'image/png', 'photo.png', { classe: '3e', matiere: 'Maths', cours: 'Thalès' }));
  assert.equal(r.status, 201);
  const img = await r.json();

  // refus d'un type non autorisé et d'un classement incomplet
  assert.equal((await call('/api/fiches', form('<script>', 'text/html', 'x.html', { classe: 'a', matiere: 'b', cours: 'c' }))).status, 415);
  assert.equal((await call('/api/fiches', form(PNG, 'image/png', 'p.png', { classe: '3e' }))).status, 400);

  const list = await (await call('/api/fiches')).json();
  assert.equal(list.length, 2);

  // le fichier privé n'est pas accessible sans compte
  const file = await call(`/api/fiches/${pdf.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  const anon = await fetch(`${base}/api/fiches/${pdf.id}/file`);
  assert.equal(anon.status, 401);

  // partage par lien : accessible sans compte, puis révocable
  const { url, shareToken } = await (await call(`/api/fiches/${img.id}/share`, { method: 'POST' })).json();
  assert.ok(url.endsWith(`/s/${shareToken}`));
  const shared = await fetch(`${base}/api/shared/${shareToken}`);
  assert.equal(shared.status, 200);
  const meta = await shared.json();
  assert.equal(meta.cours, 'Thalès');
  assert.equal((await fetch(`${base}/api/shared/${shareToken}/file`)).status, 200);
  assert.equal((await fetch(`${base}/s/${shareToken}`)).status, 200);
  assert.equal((await fetch(`${base}/api/shared/${pdf.id}`)).status, 404, 'fiche non partagée => 404');
  await call(`/api/fiches/${img.id}/share`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/api/shared/${shareToken}`)).status, 404, 'lien désactivé => 404');

  // un autre utilisateur ne voit pas les fiches de Léa
  const c1 = cookie; cookie = '';
  await call('/api/register', json({ email: 'tom@ex.fr', name: 'Tom', password: 'motdepasse2' }));
  assert.equal((await (await call('/api/fiches')).json()).length, 0);
  assert.equal((await call(`/api/fiches/${pdf.id}/file`)).status, 404);
  assert.equal((await call(`/api/fiches/${pdf.id}`, { method: 'DELETE' })).status, 404);
  cookie = c1;

  // suppression
  assert.equal((await call(`/api/fiches/${pdf.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await call('/api/fiches')).json()).length, 1);

  // déconnexion / reconnexion
  await call('/api/logout', { method: 'POST' });
  cookie = '';
  assert.equal((await call('/api/login', json({ email: 'lea@ex.fr', password: 'faux' }))).status, 401);
  assert.equal((await call('/api/login', json({ email: 'lea@ex.fr', password: 'motdepasse1' }))).status, 200);

  server.close();
  console.log('OK – parcours complet validé');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
