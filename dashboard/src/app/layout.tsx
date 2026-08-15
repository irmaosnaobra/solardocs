import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Nunito_Sans } from 'next/font/google';
import '@/styles/globals.css';
import UpdateBanner from '@/components/UpdateBanner/UpdateBanner';
import VoltaDoCheckout from '@/components/VoltaDoCheckout/VoltaDoCheckout';

// Self-hosted de propósito: um <link> pro fonts.googleapis.com é render-blocking
// cross-origin e custa ~1.5s de FCP no mobile. Não voltar pro <link>.
const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SolarDoc Pro',
  description: 'Documentação solar com IA',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" data-theme="light" className={nunitoSans.variable}>
      <head>
        {/* Light mode fixo (estilo SolarZ). Preferência antiga em localStorage é ignorada. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme='light';localStorage.removeItem('sd-theme');}catch(e){}`,
          }}
        />
        {/* Cache-buster: garante que cliente nunca trave em chunk antigo após deploy */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  // 1. Registra o service worker (PWA instalável + offline).
                  //    O sw.js usa network-first pra HTML — não revive o ChunkLoadError.
                  if ('serviceWorker' in navigator) {
                    window.addEventListener('load', function(){
                      // updateViaCache:'none' = browser nunca serve um sw.js velho
                      // do HTTP cache; sempre revalida. Garante que o kill-switch
                      // (voltar o sw.js self-destruct) chegue rápido se preciso.
                      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function(reg){
                        if (!reg) return;
                        // DETECÇÃO de nova versão (só detecção — NÃO recarrega sozinho:
                        // recarga silenciosa perde trabalho, ex: 40 campos da proposta).
                        // Quando um SW novo termina de instalar E já existe um controller
                        // ativo (=é UPDATE, não 1ª instalação), avisa a UI. O <UpdateBanner>
                        // ouve 'sw-update-ready' e mostra "Nova versão → Atualizar" (reload
                        // no clique). NÃO usamos controllerchange: o sw.js já faz skipWaiting
                        // +claim, então um handler de controllerchange recarregaria todo
                        // mundo na hora do deploy = a recarga silenciosa que evitamos.
                        // O aviso precisa DEIXAR MARCA, nao so' disparar. Evento nao
                        // tem memoria: este script roda no 'load' e a faixa so'
                        // monta o listener quando o React hidrata — medido, 1563ms
                        // contra 1618ms. Nessa janela o caminho reg.waiting (o do
                        // cliente que volta com update ja' baixado, que e' o caso
                        // que esta feature existe pra cobrir) disparava no vazio e
                        // a pessoa seguia na versao velha sem saber.
                        function avisa(){
                          window.__sdUpdateReady = true;
                          window.dispatchEvent(new CustomEvent('sw-update-ready'));
                        }
                        function watch(worker){
                          if (!worker) return;
                          worker.addEventListener('statechange', function(){
                            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                              avisa();
                            }
                          });
                        }
                        if (reg.waiting && navigator.serviceWorker.controller) {
                          avisa();
                        }
                        reg.addEventListener('updatefound', function(){ watch(reg.installing); });
                        // Tab PARADO aberto: o browser só checa update SW ao navegar ou
                        // ~a cada 24h. Sondar a cada 30min faz o app parado (o caso que
                        // essa feature existe pra cobrir) perceber o deploy sem reabrir.
                        setInterval(function(){ reg.update().catch(function(){}); }, 30 * 60 * 1000);
                      }).catch(function(){});
                    });
                  }
                  // 3. Airbag: quando JS dinâmico falha (chunk de deploy antigo sumiu),
                  //    redireciona pra /limpar-cache que zera tudo e volta.
                  //    Antes era só location.reload() — não era suficiente em casos
                  //    onde o browser tinha HTML cacheado apontando pra chunk inexistente.
                  var SK = 'sd-chunk-reload';
                  // Cinto E suspensorio. A /limpar-cache preserva a trava do
                  // sessionStorage, mas window.name e' o unico lugar que NENHUMA
                  // limpeza alcanca — e' o que garante, no pior caso, que o
                  // cliente veja a pagina crua uma vez em vez de ficar batendo
                  // de um lado pro outro pra sempre.
                  function tentouAgora(){
                    try {
                      var m = /sd-bust:(\d+)/.exec(window.name || '');
                      return !!m && (Date.now() - Number(m[1])) < 60000;
                    } catch(_) { return false; }
                  }
                  function marcaTentativa(){
                    try {
                      window.name = String(window.name || '').replace(/\s*sd-bust:\d+/, '') + ' sd-bust:' + Date.now();
                    } catch(_) {}
                  }
                  function bust(){
                    if (sessionStorage.getItem(SK)) return;
                    if (tentouAgora()) return;
                    marcaTentativa();
                    sessionStorage.setItem(SK, '1');
                    if (location.pathname !== '/limpar-cache') {
                      location.replace('/limpar-cache');
                    } else {
                      location.reload();
                    }
                  }
                  window.addEventListener('error', function(e){
                    var msg = (e && (e.message || '')) + '';
                    if (msg.indexOf('ChunkLoadError') !== -1 ||
                        msg.indexOf('Loading chunk') !== -1 ||
                        msg.indexOf('dynamically imported module') !== -1 ||
                        msg.indexOf('Failed to fetch dynamically') !== -1) {
                      bust();
                    }
                  });
                  window.addEventListener('unhandledrejection', function(e){
                    var msg = (e && e.reason && (e.reason.message || e.reason)) + '';
                    if (msg.indexOf('ChunkLoadError') !== -1 ||
                        msg.indexOf('Loading chunk') !== -1 ||
                        msg.indexOf('dynamically imported module') !== -1 ||
                        msg.indexOf('Failed to fetch dynamically') !== -1) {
                      bust();
                    }
                  });
                  // 4. AIRBAG DO CSS. O de cima so' pega JS: ChunkLoadError e' erro de
                  //    script. Folha de estilo que some depois de um deploy NAO lanca
                  //    erro nenhum — o navegador simplesmente desenha a pagina crua, com
                  //    fonte serifada e sem cor, e o cliente ve um site quebrado com o
                  //    JS funcionando normal. Foi exatamente o que aconteceu: HTML velho
                  //    em cache apontando pra .css que nao existe mais.
                  //
                  //    Dois gatilhos, porque um so' nao cobre:
                  //    a) o <link> que falha dispara 'error' — mas erro de RECURSO nao
                  //       borbulha, entao so' aparece na fase de captura (o 3o argumento).
                  window.addEventListener('error', function(e){
                    var t = e && e.target;
                    if (!t || !t.tagName) return;
                    if (t.tagName === 'LINK' && t.rel === 'stylesheet') bust();
                  }, true);
                  //    b) rede de seguranca: passado o load, confere se o CSS REALMENTE
                  //       valeu, lendo um token que so' existe no globals.css. Pega
                  //       tambem o caso em que o link nem chegou a disparar erro.
                  window.addEventListener('load', function(){
                    setTimeout(function(){
                      try {
                        var v = getComputedStyle(document.documentElement)
                          .getPropertyValue('--color-primary');
                        if (!v || !v.trim()) bust();
                      } catch(_) {}
                    }, 1200);
                  });

                  // Reseta flag se a página carregou ok depois de N segundos
                  setTimeout(function(){ sessionStorage.removeItem(SK); }, 8000);
                } catch(e) {}
              })();
            `,
          }}
        />
        <Script id="pwa-setup" strategy="afterInteractive">{`
          try {
            window.__pwaInstallPrompt = null;
            window.addEventListener('beforeinstallprompt', function(e) {
              e.preventDefault();
              window.__pwaInstallPrompt = e;
            });
          } catch(e) {}
        `}</Script>
        {/* lazyOnload, não afterInteractive: os 164KB do fbevents disputam main thread
            com a pintura do H1 e custam ~15 pontos de PageSpeed mobile.
            Contrapartida: o pixel só inicializa no idle pós-load, então quem clica no
            CTA em ~1s vindo de anúncio pode sair sem _fbc/_fbp, o que piora o match
            do CAPI nessa sessão. Se isso doer, inicializar no 1º scroll/toque. */}
        <Script id="meta-pixel" strategy="lazyOnload">{`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '824905216831401');
          fbq('track', 'PageView');
        `}</Script>
      </head>
      <body>
        {children}
        <UpdateBanner />
        {/* Resgate de quem volta do checkout pelo botão do navegador — a setinha
            da Stripe (cancel_url) cobre só o clique dentro da página deles. */}
        <VoltaDoCheckout />
      </body>
    </html>
  );
}
