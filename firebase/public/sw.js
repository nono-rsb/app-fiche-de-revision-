// Service worker : l'appli s'ouvre aussi sans réseau.
// Réseau d'abord (toujours la dernière version en ligne), cache en secours hors connexion.
const CACHE = 'revise-v2';
const SHELL = [
  '/', '/index.html', '/style.css', '/app.js', '/library.js', '/review.js', '/sharing.js', '/files.js', '/pdf.js',
  '/util.js', '/state.js', '/firebase.js', '/firebase-config.js', '/vendor/firebase.js',
  '/logo.svg', '/icon-192.png', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // les données Firebase ont leur propre cache
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000); // réseau trop lent : on passe au cache
        const res = await fetch(req, { signal: ctrl.signal, cache: 'no-cache' }); // revérifie toujours auprès du serveur, jamais une vieille copie
        clearTimeout(timer);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
        if (hit) return hit;
        if (req.mode === 'navigate' && url.pathname === '/') return cache.match('/index.html');
        return new Response('Hors connexion', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })()
  );
});
