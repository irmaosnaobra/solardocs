// Service Worker do gerador hospedado em /gerador/ (subpath do dashboard)
// Scope limitado a /gerador/ pra não interferir no resto do app.
const CACHE = 'gerador-propostas-v28';
const PRECACHE = [
  '/gerador/',
  '/gerador/index.html',
  '/gerador/style.css',
  '/gerador/tabelas.js',
  '/gerador/solar-data.js',
  '/gerador/manifest.webmanifest',
  '/gerador/icon-192.png',
  '/gerador/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Só intercepta requests do /gerador/ (scope limitado)
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/gerador/')) return;

  // Não cacheia chamadas Supabase (sempre online)
  if (req.url.includes('supabase.co')) return;
  if (req.method !== 'GET') return;

  // Network-first pro HTML (sempre pega versão fresca quando online)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/gerador/index.html')))
    );
    return;
  }

  // Cache-first pros assets estáticos
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }))
  );
});
