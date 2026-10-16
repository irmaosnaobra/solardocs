// Service Worker do gerador hospedado em /gerador/ (subpath do dashboard)
// Scope limitado a /gerador/ pra não interferir no resto do app.
const CACHE = 'gerador-propostas-v389';
const PRECACHE = [
  '/gerador/',
  '/gerador/index.html',
  '/gerador/style.css',
  '/gerador/tabelas.js',
  '/gerador/solar-data.js',
  '/gerador/etiqueta.js',
  '/gerador/pos-venda.js',
  '/gerador/financeiro.js',
  '/gerador/qrcode.js',
  '/gerador/mapa-arrendamento.js',
  '/gerador/logo.png',
  '/gerador/nexus-logo-papel.png',
  '/gerador/nexus-logo-tela.png',
  '/gerador/nexus-x.png',
  '/gerador/equip-carregador.jpg',
  '/gerador/manifest.webmanifest',
  '/gerador/icon-192.png',
  '/gerador/icon-512.png',
  '/gerador/ui/chave.js',
  '/gerador/ui/io2.css',
  '/gerador/ui/io2-cores-index.css',
  '/gerador/ui/io2-componentes.css',
  '/gerador/ui/io2-telas.css',
  '/gerador/ui/io2-telas.js',
  '/gerador/ui/io2-icones.css',
  '/gerador/ui/io2-icones.js',
  '/gerador/ui/io2-acabamento.css',
  '/gerador/ui/io2-agenda.css',
  '/gerador/ui/io2-subapps.css',
  '/gerador/ui/io2-cores-prospeccao.css',
  '/gerador/ui/io2-cores-cobrancas.css',
  '/gerador/ui/io2-cores-agentes.css',
  '/gerador/ui/io2-cores-estados.css',
  '/gerador/ui/io2-cores-radar.css',
  '/gerador/ui/casca.js',
  '/gerador/ui/perfil.js',
  '/gerador/ui/redes.js',
  '/gerador/ui/fontes/inter-variavel.woff2'
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
  // Só o que é deste site. A API (api.solardoc.app) também tem caminho /gerador/...,
  // e resposta de API com login nunca pode ir para o cache: ficaria velha e seria
  // entregue ao próximo que entrasse no mesmo aparelho.
  if (url.origin !== self.location.origin) return;
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
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (
          // A planilha vive num iframe do app: devolver o index.html no lugar dela subiria um segundo app lá dentro.
          url.pathname.startsWith('/gerador/clientes/')
            ? new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
            : caches.match('/gerador/index.html'))))
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
