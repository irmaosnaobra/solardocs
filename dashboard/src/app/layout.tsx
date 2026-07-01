import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import '@/styles/globals.css';
import UpdateBanner from '@/components/UpdateBanner/UpdateBanner';

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
    <html lang="pt-BR" data-theme="light">
      <head>
        {/* Light mode fixo (estilo SolarZ). Preferência antiga em localStorage é ignorada. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme='light';localStorage.removeItem('sd-theme');}catch(e){}`,
          }}
        />
        {/* Preconnect para Google Fonts — não bloqueia render em Android antigo */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700;800&display=swap"
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
                        function watch(worker){
                          if (!worker) return;
                          worker.addEventListener('statechange', function(){
                            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                              window.dispatchEvent(new CustomEvent('sw-update-ready'));
                            }
                          });
                        }
                        if (reg.waiting && navigator.serviceWorker.controller) {
                          window.dispatchEvent(new CustomEvent('sw-update-ready'));
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
                  function bust(){
                    if (sessionStorage.getItem(SK)) return;
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
        <Script id="meta-pixel" strategy="afterInteractive">{`
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
      </body>
    </html>
  );
}
