/* Telemetria do navegador — PostHog (produto) + Sentry (erros).
 *
 * COMO LIGAR: cole as duas chaves aqui embaixo. Enquanto estiverem vazias este
 * arquivo não faz UMA requisição sequer — pode ficar em todas as páginas sem
 * custo nenhum. Uma chave só liga o serviço dela.
 *
 * COMO USAR NA PÁGINA (uma linha, no fim do <body>):
 *   <script src="/lib/telemetria.js" defer></script>
 *
 * Em site de FORA deste projeto (LimpaPro, Gelatina...), copie este arquivo pra
 * lá e use src="/lib/telemetria.js" do mesmo jeito. Não aponte pro domínio do
 * dashboard: dá acoplamento e um domínio fora do ar derruba a telemetria do outro.
 *
 * EVENTO MANUAL: window.evento('clicou_whatsapp', { origem: 'hero' })
 *
 * TESTE A/B (substitui fatiar funil por janela de backup):
 *   window.variante('headline_agosto', function (v) {
 *     if (v === 'test') document.querySelector('h1').textContent = 'Nova headline';
 *   });
 * Crie o experimento no PostHog com esse mesmo nome. A variante vira propriedade
 * fixa da sessão, então TODO evento seguinte (inclusive a compra) já sai marcado
 * com ela — é isso que deixa comparar variante em vez de comparar dia.
 *
 * LEMBRETE: isto é contador de navegador, não é livro-caixa. Bloqueador de
 * anúncio e Safari comem parte. O que vira dinheiro (venda, lead, agendamento)
 * tem que ser disparado do servidor, em api/src/lib/posthog.ts.
 */
(function () {
  'use strict';

  // ─── COLE AS CHAVES AQUI ───────────────────────────────────────────────────
  var POSTHOG_KEY = '';                          // phc_xxxxxxxx (PostHog > Project Settings)
  var POSTHOG_HOST = 'https://us.i.posthog.com'; // troque pra https://eu.i.posthog.com se o projeto for na UE
  var SENTRY_DSN = '';                           // https://xxxx@oyyy.ingest.sentry.io/zzz
  // ───────────────────────────────────────────────────────────────────────────

  // Permite sobrescrever por página, sem editar este arquivo:
  // <script>window.__TELEMETRIA__ = { posthogKey: '...' }</script> ANTES do src.
  var cfg = window.__TELEMETRIA__ || {};
  var chavePostHog = cfg.posthogKey || POSTHOG_KEY;
  var hostPostHog = cfg.posthogHost || POSTHOG_HOST;
  var dsnSentry = cfg.sentryDsn || SENTRY_DSN;

  // Versões travadas: mesma versão em todos os sites, senão você depura duas vezes.
  var URL_POSTHOG = 'https://cdn.jsdelivr.net/npm/posthog-js@1.410.6/dist/array.js';
  var URL_SENTRY = 'https://browser.sentry-cdn.com/10.69.0/bundle.min.js';

  // Fila de eventos disparados antes do PostHog terminar de carregar. Sem isto,
  // o clique no CTA que acontece nos primeiros 2 segundos some.
  var fila = [];
  window.evento = function (nome, props) {
    if (window.posthog && window.posthog.capture) window.posthog.capture(nome, props || {});
    else fila.push([nome, props || {}]);
  };

  // Experimentos pedidos antes das flags chegarem (o normal: a flag vem por rede).
  var filaVariantes = [];

  /**
   * Decide a variante de um experimento e avisa quando souber.
   *
   * Chama de volta com 'control', o nome da variante, ou undefined se o
   * experimento não existir / o PostHog estiver desligado — nesse caso a página
   * fica como está, que é o comportamento seguro.
   *
   * CUIDADO COM PISCA: a flag chega por rede, então a troca acontece depois da
   * primeira pintura. Se a variante mexe em algo grande e visível, esconda o
   * bloco no CSS e mostre dentro do callback — senão o visitante vê a versão A
   * virar B na cara dele, e isso sozinho já muda a conversão.
   */
  window.variante = function (experimento, aoDecidir) {
    if (!chavePostHog) { try { aoDecidir(undefined); } catch (e) {} return; }
    filaVariantes.push([experimento, aoDecidir]);
    if (window.posthog && window.posthog.onFeatureFlags) resolverVariantes();
  };

  function resolverVariantes() {
    if (!window.posthog || !window.posthog.onFeatureFlags || !filaVariantes.length) return;
    var pendentes = filaVariantes;
    filaVariantes = [];
    window.posthog.onFeatureFlags(function () {
      for (var i = 0; i < pendentes.length; i++) {
        var experimento = pendentes[i][0];
        var aoDecidir = pendentes[i][1];
        var v;
        try { v = window.posthog.getFeatureFlag(experimento); } catch (e) { v = undefined; }

        // Gruda a variante na sessão: todo evento daqui pra frente sai marcado,
        // então dá pra comparar VARIANTE. Sem isto você volta a comparar dia.
        if (v && window.posthog.register) {
          var props = {};
          props['variante_' + experimento] = v;
          try { window.posthog.register(props); } catch (e) {}
        }
        try { aoDecidir(v); } catch (e) {}
      }
    });
  }

  function carregar(src, aoTerminar) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = aoTerminar;
    s.onerror = function () { /* CDN bloqueada: segue sem telemetria, sem erro na tela */ };
    document.head.appendChild(s);
  }

  if (chavePostHog) {
    carregar(URL_POSTHOG, function () {
      if (!window.posthog || !window.posthog.init) return;
      window.posthog.init(chavePostHog, {
        api_host: hostPostHog,
        capture_pageview: true,
        capture_pageleave: true,
        persistence: 'localStorage+cookie',
      });
      for (var i = 0; i < fila.length; i++) window.posthog.capture(fila[i][0], fila[i][1]);
      fila = [];
      resolverVariantes();
    });
  }

  if (dsnSentry) {
    carregar(URL_SENTRY, function () {
      if (!window.Sentry || !window.Sentry.init) return;
      window.Sentry.init({
        dsn: dsnSentry,
        // Só erro. Performance no navegador consome cota rápido e não é o problema aqui.
        tracesSampleRate: 0,
        // Não manda o que o usuário digitou em formulário.
        sendDefaultPii: false,
      });
    });
  }
})();
