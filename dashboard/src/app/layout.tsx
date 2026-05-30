import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import '@/styles/globals.css';

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
                  // 1. Mata service workers antigos
                  if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(function(regs){
                      regs.forEach(function(r){ r.unregister(); });
                    });
                  }
                  // 2. Limpa Cache Storage API (chunks antigos do _next/static)
                  if ('caches' in window) {
                    caches.keys().then(function(keys){
                      keys.forEach(function(k){ caches.delete(k); });
                    });
                  }
                  // 3. Quando JS dinâmico falha (chunk de deploy antigo sumiu),
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
      </body>
    </html>
  );
}
