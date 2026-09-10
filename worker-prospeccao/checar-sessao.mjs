/* Diz se o Chrome da agente esta logado no Instagram, e em qual conta.
   Imprime "LOGADO:<handle>" ou "DESLOGADO". Usado pelo COMECAR.ps1. */

const CDP = process.env.CHROME_CDP || 'http://127.0.0.1:9222';

try {
  const alvos = await (await fetch(CDP + '/json/list')).json();
  const pg = alvos.find(t => t.type === 'page' && String(t.url).includes('instagram'));
  if (!pg) { console.log('DESLOGADO'); process.exit(0); }

  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; setTimeout(() => e(new Error('timeout')), 8000); });

  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); const f = pend.get(m.id); if (f) { pend.delete(m.id); f(m); } };
  const js = expr => new Promise(ok => {
    const i = ++id; pend.set(i, m => ok(m.result?.result?.value));
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    setTimeout(() => { if (pend.delete(i)) ok(undefined); }, 6000);
  });

  const r = await js(`
    (function () {
      if (document.querySelector('input[name="username"]')) return { logado: false };
      var conta = '';
      var l = document.querySelectorAll('a[href^="/"]');
      for (var i = 0; i < l.length; i++) {
        var m = (l[i].getAttribute('href') || '').match(/^\\/([A-Za-z0-9._]{3,30})\\/$/);
        if (m && l[i].querySelector('img')) { conta = m[1]; break; }
      }
      return { logado: true, conta: conta };
    })()
  `);
  ws.close();

  if (r?.logado) console.log('LOGADO:' + (r.conta || 'conta'));
  else console.log('DESLOGADO');
} catch {
  console.log('DESLOGADO');
}
process.exit(0);
