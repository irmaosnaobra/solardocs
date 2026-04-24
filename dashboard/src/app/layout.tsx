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
    <html lang="pt-BR">
      <head>
        {/* Preconnect para Google Fonts — não bloqueia render em Android antigo */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
        />
        <Script id="pwa-setup" strategy="afterInteractive">{`
          try {
            window.__pwaInstallPrompt = null;
            window.addEventListener('beforeinstallprompt', function(e) {
              e.preventDefault();
              window.__pwaInstallPrompt = e;
            });
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.getRegistrations().then(function(regs) {
                regs.forEach(function(r) { r.unregister(); });
              });
            }
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
        <Script id="chat-widget" strategy="afterInteractive">{`
(function() {
  var API = 'https://solardocs-api-irmaosnaobra-aioros.vercel.app/chat';
  var WA = 'https://wa.me/5534991360223';
  var history = [];

  // Só mostra se estiver em rota de dashboard (autenticado)
  function isInsideDashboard() {
    var path = window.location.pathname;
    return !path.startsWith('/auth') &&
           !path.startsWith('/login') &&
           !path.startsWith('/register') &&
           !path.startsWith('/esqueci') &&
           !path.startsWith('/redefinir');
  }

  if (!isInsideDashboard()) return;

  var css = \`
    #sd-fab{position:fixed;bottom:24px;right:24px;z-index:99999;width:52px;height:52px;border-radius:50%;background:#f59e0b;border:none;cursor:pointer;font-size:22px;box-shadow:0 4px 20px rgba(245,158,11,.45);display:flex;align-items:center;justify-content:center;transition:transform .2s;}
    #sd-fab:hover{transform:scale(1.08);}
    #sd-box{position:fixed;bottom:86px;right:24px;z-index:99999;width:300px;max-height:420px;background:#0f172a;border:1px solid #1e293b;border-radius:16px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.5);}
    #sd-box.open{display:flex;}
    #sd-hdr{background:#f59e0b;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;color:#0f172a;}
    #sd-close{background:none;border:none;cursor:pointer;font-size:16px;color:#0f172a;padding:0;}
    #sd-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;}
    .sd-m{max-width:88%;font-size:12px;line-height:1.5;padding:9px 11px;border-radius:12px;word-break:break-word;}
    .sd-bot{background:#1e293b;color:#e2e8f0;align-self:flex-start;border-bottom-left-radius:4px;}
    .sd-usr{background:#f59e0b;color:#0f172a;font-weight:600;align-self:flex-end;border-bottom-right-radius:4px;}
    .sd-m a{color:#fbbf24;font-weight:700;}
    #sd-row{display:flex;gap:6px;padding:10px;border-top:1px solid #1e293b;}
    #sd-inp{flex:1;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:8px 10px;color:#f8fafc;font-size:12px;outline:none;}
    #sd-inp::placeholder{color:#64748b;}
    #sd-send{background:#f59e0b;border:none;border-radius:8px;padding:8px 12px;color:#0f172a;font-weight:700;font-size:13px;cursor:pointer;}
    #sd-send:disabled{opacity:.4;cursor:not-allowed;}
    @media(max-width:400px){#sd-box{width:calc(100vw - 32px);right:16px;}}
  \`;
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var fab = document.createElement('button');
  fab.id = 'sd-fab'; fab.textContent = '💬'; fab.title = 'Assistente Sol';
  document.body.appendChild(fab);

  var box = document.createElement('div'); box.id = 'sd-box';
  box.innerHTML = '<div id="sd-hdr"><span>🤖 Sol — Assistente</span><button id="sd-close">✕</button></div><div id="sd-msgs"><div class="sd-m sd-bot">Oi! Sou a Sol, assistente do SolarDoc. Como posso ajudar? 😊</div></div><div id="sd-row"><input id="sd-inp" placeholder="Digite sua dúvida..." maxlength="300"/><button id="sd-send">➤</button></div>';
  document.body.appendChild(box);

  var msgs = document.getElementById('sd-msgs');
  var inp = document.getElementById('sd-inp');
  var send = document.getElementById('sd-send');

  fab.onclick = function() {
    box.classList.toggle('open');
    fab.textContent = box.classList.contains('open') ? '✕' : '💬';
    if (box.classList.contains('open')) setTimeout(function(){inp.focus();},100);
  };
  document.getElementById('sd-close').onclick = function() {
    box.classList.remove('open'); fab.textContent = '💬';
  };
  inp.onkeydown = function(e) { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend();} };
  send.onclick = doSend;

  function addMsg(txt, cls) {
    var d = document.createElement('div'); d.className = 'sd-m ' + cls;
    d.innerHTML = txt.replace(/https:\\/\\/wa\\.me\\/\\S+/g, function(u){return '<a href="'+u+'" target="_blank">💬 Falar no WhatsApp</a>';});
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }

  function doSend() {
    var msg = inp.value.trim(); if (!msg || send.disabled) return;
    inp.value = ''; send.disabled = true;
    addMsg(msg, 'sd-usr');
    var t = addMsg('...', 'sd-bot'); t.style.opacity='.5';
    fetch(API, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history:history})})
      .then(function(r){return r.json();})
      .then(function(d){
        t.remove(); var reply = d.reply||'Tente novamente.';
        addMsg(reply,'sd-bot');
        history.push({role:'user',content:msg},{role:'assistant',content:reply});
        if(history.length>12) history=history.slice(-12);
      })
      .catch(function(){t.remove();addMsg('Erro. <a href="'+WA+'" target="_blank">💬 WhatsApp</a>','sd-bot');})
      .finally(function(){send.disabled=false;inp.focus();});
  }
})();
        `}</Script>
      </body>
    </html>
  );
}
