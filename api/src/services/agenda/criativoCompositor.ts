import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import { logger } from '../../utils/logger';

// Compositor de criativo de anúncio: pega a imagem-base do produto (gerada pelo
// Soul image-to-image, cena bonita SEM texto) e sobrepõe a copy PT-BR
// (gancho/preço/CTA/vendas) por cima via HTML → PNG (Puppeteer). O texto é overlay
// nítido porque a IA de imagem erra texto embutido. Resultado: criativo 9:16
// estilo TikTok Shop pronto pra postar.

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar';

// Storage do gerador (mesmo bucket usado pra uploads de vídeo). Anon key publishable.
const SUPABASE_URL = 'https://ancecdfqfwlaujknizof.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IK5RV-I0PlQNpb7-cXBQFg_-pSYscO6';
const BUCKET = 'studio-videos';

interface ComporArgs {
  imagemBaseUrl: string;   // imagem do produto gerada pelo Soul
  gancho?: string | null;
  preco?: string | null;
  cta?: string | null;
  vendas?: number | null;
  desconto?: string | null;
  rowId: number;
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// HTML 9:16 (1080x1920) com a imagem de fundo + overlays de texto estilo TikTok Shop.
function montarHtml(a: ComporArgs): string {
  const vendasTxt = a.vendas && a.vendas > 0 ? `🔥 ${Number(a.vendas).toLocaleString('pt-BR')} vendidos` : '';
  const precoTxt = a.preco ? esc(a.preco) : '';
  const descTxt = a.desconto ? `${esc(a.desconto)} OFF` : '';
  const bg = esc(a.imagemBaseUrl);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Inter','Helvetica Neue',Arial,sans-serif}
  html,body{width:1080px;height:1920px;overflow:hidden}
  .wrap{position:relative;width:1080px;height:1920px;background:#0e0f11;overflow:hidden}
  /* a foto do produto raramente é 9:16 — fundo blur preenche, foto inteira no centro */
  .blur{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(44px) brightness(.55);transform:scale(1.12)}
  .fg{position:absolute;top:46%;left:50%;transform:translate(-50%,-50%);width:100%;max-height:1180px;object-fit:contain}
  .grad-top{position:absolute;top:0;left:0;right:0;height:480px;background:linear-gradient(180deg,rgba(0,0,0,.82),rgba(0,0,0,0))}
  .grad-bot{position:absolute;bottom:0;left:0;right:0;height:780px;background:linear-gradient(0deg,rgba(0,0,0,.92),rgba(0,0,0,.4) 55%,rgba(0,0,0,0))}
  .gancho{position:absolute;top:64px;left:60px;right:60px;color:#fff;font-size:72px;line-height:1.08;font-weight:800;text-shadow:0 4px 24px rgba(0,0,0,.6);letter-spacing:-1px}
  /* bloco inferior coeso: badges → preço → CTA empilhados, sem sobreposição */
  .bottom{position:absolute;bottom:80px;left:60px;right:60px;display:flex;flex-direction:column;gap:22px}
  .badges{display:flex;gap:18px;flex-wrap:wrap}
  .badge{background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.35);color:#fff;font-size:38px;font-weight:700;padding:14px 28px;border-radius:16px}
  .badge.off{background:#10b981;border-color:#10b981}
  .preco{color:#fff;font-size:104px;font-weight:900;line-height:1;text-shadow:0 4px 24px rgba(0,0,0,.7)}
  .cta{background:#f5a623;color:#1a1206;font-size:52px;font-weight:900;text-align:center;padding:36px;border-radius:24px;box-shadow:0 10px 40px rgba(245,166,35,.45);line-height:1.12}
  </style></head><body>
  <div class="wrap">
    <img class="blur" src="${bg}" crossorigin="anonymous">
    <img class="fg" src="${bg}" crossorigin="anonymous">
    <div class="grad-top"></div><div class="grad-bot"></div>
    ${a.gancho ? `<div class="gancho">${esc(a.gancho)}</div>` : ''}
    <div class="bottom">
      ${(vendasTxt || descTxt) ? `<div class="badges">${vendasTxt ? `<div class="badge">${vendasTxt}</div>` : ''}${descTxt ? `<div class="badge off">${descTxt}</div>` : ''}</div>` : ''}
      ${precoTxt ? `<div class="preco">${precoTxt}</div>` : ''}
      ${a.cta ? `<div class="cta">${esc(a.cta)}</div>` : ''}
    </div>
  </div></body></html>`;
}

// renderiza o HTML → PNG → sobe no Storage → retorna URL pública. Retorna null em falha.
export async function comporCriativo(a: ComporArgs): Promise<string | null> {
  let browser: any;
  try {
    const execPath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1080, height: 1920, deviceScaleFactor: 1 },
      executablePath: execPath,
      headless: true,
    });
    const page = await browser.newPage();
    await page.setContent(montarHtml(a), { waitUntil: 'networkidle0', timeout: 30000 });
    // garante que a imagem de fundo carregou
    await page.waitForFunction(
      `(() => { const i = document.querySelector('img.bg'); return i && i.complete && i.naturalWidth > 0; })()`,
      { timeout: 20000 }
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });

    const nome = `criativo_${a.rowId}_${Date.now()}.png`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${nome}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
      body: Buffer.from(png),
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      logger.warn('compositor', `upload Storage HTTP ${up.status}`, { rowId: a.rowId, body: t.slice(0, 200) });
      return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${nome}`;
  } catch (e: any) {
    logger.warn('compositor', 'falha ao compor criativo', { rowId: a.rowId, err: String(e?.message || e) });
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
