/* ─────────────────────────────────────────────────────────────────────────────
   MANTÉM O CHROME DA AGENTE MINIMIZADO.
   Roda pelo VIGIA.ps1 a cada rodada e logo depois de subir o Chrome.

   Por que existe: em 14/09 o dono perguntou "por que o Instagram fica abrindo
   toda hora". O Chrome dela é um robô, e janela de robô na frente de quem usa o
   computador é defeito. Subir com --start-minimized não basta: o perfil guarda
   o tamanho da última janela e o Chrome reabre nele (medido em 14/09: subiu
   "minimizado" às 18:13:18 e às 18:13:35 estava na tela).

   Não minimiza enquanto o LIGAR-WHATSAPP estiver mostrando o QR, que precisa
   ficar na frente. A marca qr-aberto.flag diz isso e vale no máximo 15 minutos,
   pra uma marca esquecida não desligar esta proteção pra sempre.

   Uso:  node minimizar-chrome.mjs [--esperar=40]
         --esperar dá esse tanto de segundos pro Chrome recém-aberto responder.
   ───────────────────────────────────────────────────────────────────────────── */
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CDP = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const MARCA_QR = fileURLToPath(new URL('./qr-aberto.flag', import.meta.url));
const esperarSeg = Number(process.argv.find(a => a.startsWith('--esperar='))?.split('=')[1] || 0);
const dorme = ms => new Promise(r => setTimeout(r, ms));

if (existsSync(MARCA_QR) && Date.now() - statSync(MARCA_QR).mtimeMs < 15 * 60000) {
  console.log('QR do WhatsApp na tela, não minimizo agora.');
  process.exit(0);
}

let versao = null;
const prazo = Date.now() + esperarSeg * 1000;
do {
  try {
    versao = await (await fetch(CDP + '/json/version', { signal: AbortSignal.timeout(5000) })).json();
    break;
  } catch { await dorme(1000); }
} while (Date.now() < prazo);
if (!versao?.webSocketDebuggerUrl) { console.log('o Chrome da agente não respondeu pra minimizar.'); process.exit(0); }

const ws = new WebSocket(versao.webSocketDebuggerUrl);
await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = erro; });
let n = 0;
const manda = (method, params = {}) => new Promise(ok => {
  const id = ++n;
  const ouvir = e => {
    try {
      const m = JSON.parse(e.data);
      if (m.id === id) { ws.removeEventListener('message', ouvir); ok(m.result || null); }
    } catch { }
  };
  ws.addEventListener('message', ouvir);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => ok(null), 8000);
});

// Uma janela pode ter várias abas: junta por janela antes de mexer.
const paginas = ((await manda('Target.getTargets'))?.targetInfos || []).filter(t => t.type === 'page');
const janelas = new Map();
for (const p of paginas) {
  const r = await manda('Browser.getWindowForTarget', { targetId: p.targetId });
  if (r?.windowId) janelas.set(r.windowId, r.bounds?.windowState);
}

let minimizadas = 0;
for (const [id, estado] of janelas) {
  if (estado === 'minimized') continue;
  await manda('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'minimized' } });
  minimizadas++;
}
if (minimizadas) console.log(`minimizei ${minimizadas} janela(s) do Chrome da agente.`);
try { ws.close(); } catch { }
process.exit(0);
