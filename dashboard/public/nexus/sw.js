/* Service worker do Portal do Parceiro NEXUS.
 * Escopo /nexus/ (registrado com scope explicito). Nao toca em /gerador nem no sw do /gerador.
 * Regra: rede primeiro para tudo. So navegacao (pagina) tem reserva: se a rede cair, mostra /nexus/offline.html.
 * Nada mais passa por aqui: /_api/, scripts, estilos, fontes e imagens seguem direto para a rede. Nao ha cache de dados. */
var VERSAO = 'nexus-parceiro-v3';
var OFFLINE = '/nexus/offline.html';

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.add(new Request(OFFLINE, { cache: 'reload' })); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n.indexOf('nexus-parceiro-') === 0 && n !== VERSAO; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/nexus/') !== 0) return;
  e.respondWith(fetch(req).catch(function () {
    return caches.match(OFFLINE).then(function (r) { return r || new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
  }));
});
