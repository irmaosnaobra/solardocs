// SolarDoc PWA service worker.
// Estratégia que torna o app instalável + offline SEM reviver o ChunkLoadError:
//
//  - HTML / navegação  → NETWORK-FIRST. Usuário online sempre recebe o HTML
//    fresco (apontando pros chunks atuais). Só cai no shell offline se a rede
//    falhar de verdade. ESTA é a regra que evita servir HTML velho apontando
//    pra chunk que o servidor já não tem (a causa do ChunkLoadError antigo).
//  - /_next/static/*   → CACHE-FIRST. São hasheados (o nome muda a cada build),
//    então cache nunca colide com deploy novo — e deixa o app instantâneo.
//  - Demais GET same-origin → stale-while-revalidate leve.
//
// Recuperação: se um dia este SW se comportar mal, basta voltar o sw.js
// "kill-switch" (que só apaga caches e se desregistra) que ele se remove do campo.

const VERSION = 'sd-v1';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/limpar-cache'; // página leve que já existe, serve de shell offline

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll([OFFLINE_URL]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // não intercepta cross-origin (Stripe, fonts...)

  // 1) Navegação (HTML) → NETWORK-FIRST. Online = sempre fresco.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }

  // 2) Assets hasheados e imutáveis → CACHE-FIRST (seguro: hash = chave de cache).
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icon')) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // 3) Resto (GET same-origin) → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
