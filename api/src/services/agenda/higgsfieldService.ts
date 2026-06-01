import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { comporCriativo } from './criativoCompositor';

// MODELAR CRIATIVO de anúncio do produto (aba Produtos do /gerador, afiliados).
// "Modelar = copiar mudando coisas, mantendo a copy": o Soul (image-to-image do
// Higgsfield) recria a CENA do produto a partir da foto dele (e-commerce premium,
// SEM texto), e depois o compositor sobrepõe a copy PT-BR (gancho/preço/CTA) por
// cima (texto nítido). Resultado: criativo 9:16 estilo TikTok Shop, automatizável.
//
// Por que Soul e não vídeo: dop-turbo (vídeo) saiu 1/10 (mudo); marketing-studio
// (UGC c/ voz) dá 401 na API key (só painel). Soul i2i VALIDADO em prod (completed).
//
// Contrato Soul (validado por curl):
//   POST https://platform.higgsfield.ai/higgsfield-ai/soul/standard
//   auth  Authorization: Key <HF_KEY>
//   body  { prompt, image_reference:{type:'image_url',image_url}, image_reference_strength }
//   status GET {BASE}/requests/{request_id}/status → { status, images:[{url}] }
//   upload de referência: POST /files/generate-upload-url → PUT → public_url (cloudfront)

const BASE = 'https://platform.higgsfield.ai';
const HF_KEY = process.env.HF_KEY || '';
const HF_SOUL = process.env.HF_SOUL || 'higgsfield-ai/soul/standard';
const HF_REF_STRENGTH = Number(process.env.HF_REF_STRENGTH || '0.45'); // 0=ignora ref, 1=copia
// modelo de vídeo image-to-video (anima o criativo). Kling v2.1 pro — VALIDADO.
const HF_VIDEO = process.env.HF_VIDEO || 'kling-video/v2.1/pro/image-to-video';
// animar é sob demanda (botão "Animar"), NÃO automático — gasta crédito só no que
// o Thiago escolher postar (decisão 2026-05-31). HF_AUTO_VIDEO=1 liga o auto se quiser.
const AUTO_VIDEO = process.env.HF_AUTO_VIDEO === '1';
// duração do vídeo = tempo de ler a narração (gancho+corpo+CTA), arredondado pro que
// o Kling suporta. Kling v2.1 honra 5 e 10 (validado: duration:10 → 10.04s).
function duracaoNarracao(textos: string[]): number {
  const palavras = textos.filter(Boolean).join(' ').trim().split(/\s+/).filter(Boolean).length;
  const seg = palavras / 2.5; // ~2.5 palavras/seg de locução PT-BR
  return seg > 7 ? 10 : 5;     // arredonda pro enum suportado
}
// prompt de movimento: câmera TRAVADA (sem zoom/pan) pra o texto não sair do quadro.
const VIDEO_PROMPT = 'Locked-off static camera, NO zoom, NO pan, NO camera movement. Only the person/product and fabric move subtly in place. Keep the full frame and all on-screen text exactly fixed and fully visible.';

export function temHiggsfield(): boolean {
  return !!HF_KEY;
}

const AUTH = () => ({ Authorization: `Key ${HF_KEY}`, 'User-Agent': 'higgsfield-server-js/2.0' });

// sobe uma imagem (de qualquer URL pública) pro CDN do Higgsfield e devolve a
// public_url cloudfront — exigida pelo image_reference do Soul (não aceita URL externa).
async function uploadParaHiggsfield(srcUrl: string): Promise<string | null> {
  try {
    const img = await fetch(srcUrl);
    if (!img.ok) return null;
    const ct = img.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await img.arrayBuffer());
    const up = await fetch(`${BASE}/files/generate-upload-url`, {
      method: 'POST', headers: { ...AUTH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: ct }),
    });
    if (!up.ok) return null;
    const { public_url, upload_url } = await up.json() as any;
    const put = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': ct }, body: buf });
    if (!put.ok) return null;
    return public_url;
  } catch (e: any) {
    logger.warn('higgsfield', 'upload ref falhou', { err: String(e?.message || e) });
    return null;
  }
}

interface DispararArgs { prompt: string; imagemUrl: string | null; rowId: number; }

// Soul image-to-image OPCIONAL (default OFF): pra produto de afiliado, o Soul
// ALUCINA o produto (gera item errado + texto-lixo), o que é fatal — a foto real
// do TikTok Shop (modelo usando o produto) é melhor e correta. Então por padrão
// modelamos = foto original do produto + overlay da copy (compositor). Soul só
// entra se HF_USE_SOUL=1 (experimental).
const USE_SOUL = process.env.HF_USE_SOUL === '1';

// modela o criativo do anúncio: imagem do produto + overlay da copy (gancho/preço/
// CTA/vendas) via compositor. Síncrono, grátis, produto correto. (Soul opcional.)
export async function modelarCriativoProduto({ prompt, imagemUrl, rowId }: DispararArgs): Promise<{ ok: boolean; motivo?: string; requestId?: string }> {
  if (!imagemUrl) {
    await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
    return { ok: false, motivo: 'sem_imagem' };
  }

  // caminho padrão: compõe direto sobre a foto do produto (sem IA de imagem).
  if (!USE_SOUL) {
    await supabaseGerador.from('social_studio').update({ video_status: 'compondo' }).eq('id', rowId);
    const novo = await comporEFinalizecar(rowId, imagemUrl);
    return { ok: novo === 'pronto', motivo: novo === 'pronto' ? undefined : 'composicao_falhou' };
  }

  // caminho experimental (Soul i2i) — só se HF_USE_SOUL=1 e tiver key.
  if (!temHiggsfield()) {
    await supabaseGerador.from('social_studio').update({ video_status: 'aguardando_config' }).eq('id', rowId);
    return { ok: false, motivo: 'sem_hf_key' };
  }
  const cena = `${prompt}\n\nProduct advertising scene, e-commerce / TikTok Shop style, clean background, premium lighting, vertical 9:16, NO text or watermark in the image.`;
  const refUrl = await uploadParaHiggsfield(imagemUrl);
  const body: Record<string, any> = { prompt: cena };
  if (refUrl) { body.image_reference = { type: 'image_url', image_url: refUrl }; body.image_reference_strength = HF_REF_STRENGTH; }
  try {
    const r = await fetch(`${BASE}/${HF_SOUL}`, { method: 'POST', headers: { ...AUTH(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      logger.warn('higgsfield', `soul submit HTTP ${r.status}`, { rowId, body: t.slice(0, 300) });
      await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
      return { ok: false, motivo: `http_${r.status}` };
    }
    const j = await r.json() as any;
    const requestId = j?.request_id || j?.id || null;
    await supabaseGerador.from('social_studio').update({ hf_request_id: requestId, video_status: 'gerando' }).eq('id', rowId);
    return { ok: true, requestId };
  } catch (e: any) {
    await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
    return { ok: false, motivo: 'exception' };
  }
}

// compat: nome antigo ainda usado em alguns lugares → aponta pro novo.
export const dispararVideoProduto = modelarCriativoProduto;

// imagem-base gerada pelo Soul: images[0].url (mantém fallbacks).
function extrairImagemUrl(p: any): string | null {
  return p?.images?.[0]?.url || p?.image?.url || p?.output?.images?.[0]?.url || p?.result?.url || p?.url || null;
}

function extrairStatus(p: any): string {
  return String(p?.status || p?.state || '').toLowerCase();
}

// após o Soul completar, compõe o texto por cima → PNG do criativo. Depois, se
// AUTO_VIDEO, dispara a animação (Kling). Se composição falhar, cai pra imagem-base.
async function comporEFinalizecar(rowId: number, imagemBaseUrl: string): Promise<string> {
  await supabaseGerador.from('social_studio').update({ video_status: 'compondo' }).eq('id', rowId);
  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('gancho, cta, produto_meta').eq('id', rowId).limit(1);
  const row = rows?.[0] as any;
  const pm = row?.produto_meta || {};
  const final = await comporCriativo({
    imagemBaseUrl, gancho: row?.gancho, cta: row?.cta,
    preco: pm.preco, vendas: pm.vendas, desconto: pm.desconto, rowId,
  });
  const pngUrl = final || imagemBaseUrl; // fallback: imagem sem overlay
  // guarda o PNG do criativo em imagem_url (fica como fallback se o vídeo falhar)
  await supabaseGerador.from('social_studio').update({ imagem_url: pngUrl, video_url: pngUrl }).eq('id', rowId);

  // anima o criativo → vídeo (decisão Thiago: automático). Best-effort.
  if (AUTO_VIDEO && temHiggsfield()) {
    const v = await animarCriativo(rowId, pngUrl);
    if (v.ok) return 'animando'; // reconcile pega o mp4 quando o Kling terminar
  }
  // sem vídeo (auto off / sem key / falha ao disparar): pronto com a imagem
  await supabaseGerador.from('social_studio').update({ video_status: 'pronto', video_url: pngUrl }).eq('id', rowId);
  return 'pronto';
}

// anima o PNG do criativo via Kling (image-to-video, câmera travada). Duração =
// tempo de ler a narração (gancho+roteiro+cta). Sobe o PNG pro cloudfront e dispara.
async function animarCriativo(rowId: number, pngUrl: string): Promise<{ ok: boolean }> {
  try {
    // duração derivada da narração que o Thiago vai falar por cima
    const { data: rows } = await supabaseGerador.from('social_studio')
      .select('gancho, roteiro, cta').eq('id', rowId).limit(1);
    const row = rows?.[0] as any;
    const dur = duracaoNarracao([row?.gancho, row?.roteiro, row?.cta]);

    const ref = await uploadParaHiggsfield(pngUrl);
    if (!ref) return { ok: false };
    const r = await fetch(`${BASE}/${HF_VIDEO}`, {
      method: 'POST', headers: { ...AUTH(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: ref, prompt: VIDEO_PROMPT, duration: dur }),
    });
    if (!r.ok) { logger.warn('higgsfield', `kling submit HTTP ${r.status}`, { rowId }); return { ok: false }; }
    const j = await r.json() as any;
    const vid = j?.request_id || j?.id || null;
    if (!vid) return { ok: false };
    await supabaseGerador.from('social_studio')
      .update({ hf_video_request_id: vid, video_status: 'animando' }).eq('id', rowId);
    logger.info('higgsfield', 'criativo enviado pra animar (kling)', { rowId, vid, dur });
    return { ok: true };
  } catch (e: any) {
    logger.warn('higgsfield', 'falha ao animar', { rowId, err: String(e?.message || e) });
    return { ok: false };
  }
}

// botão "Animar criativo": dispara a animação de uma linha que já tem imagem pronta.
// Sob demanda — gasta 1 crédito Kling só quando o Thiago clica.
export async function animarProduto(rowId: number): Promise<{ ok: boolean; motivo?: string }> {
  if (!temHiggsfield()) return { ok: false, motivo: 'sem_hf_key' };
  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('id, imagem_url, video_url, canal').eq('id', rowId).limit(1);
  const row = rows?.[0] as any;
  if (!row || row.canal !== 'produtos') return { ok: false, motivo: 'linha_invalida' };
  const png = row.imagem_url || row.video_url; // imagem do criativo (PNG)
  if (!png || /\.mp4($|\?)/.test(png)) return { ok: false, motivo: 'sem_imagem' };
  const v = await animarCriativo(rowId, png);
  return { ok: v.ok, motivo: v.ok ? undefined : 'falha_animar' };
}

function extrairVideoUrl(p: any): string | null {
  return p?.video?.url || p?.videos?.[0]?.url || p?.output?.url || p?.url || null;
}

// mapeia status do Soul → estado da linha. Em 'completed' com imagem, dispara composição.
async function aplicarStatus(rowId: number, status: string, imagemUrl: string | null): Promise<string> {
  if (status === 'failed' || status === 'nsfw' || status === 'canceled' || status === 'error') {
    await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
    return 'erro';
  }
  if ((status === 'completed' || imagemUrl) && imagemUrl) {
    return comporEFinalizecar(rowId, imagemUrl);
  }
  return 'gerando';
}

// webhook (se o Higgsfield disparar). Idempotente.
export async function processarWebhook(payload: any): Promise<{ ok: boolean; rowId?: number }> {
  const requestId = payload?.request_id || payload?.id || payload?.requestId || null;
  if (!requestId) return { ok: false };
  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('id, video_status').eq('hf_request_id', String(requestId)).limit(1);
  const row = rows?.[0] as any;
  if (!row) return { ok: false };
  if (row.video_status === 'pronto' || row.video_status === 'compondo') return { ok: true, rowId: row.id };
  const novo = await aplicarStatus(row.id, extrairStatus(payload), extrairImagemUrl(payload));
  logger.info('higgsfield', 'webhook processado', { rowId: row.id, novo });
  return { ok: true, rowId: row.id };
}

// RECONCILE (caminho principal): poll dos jobs do Higgsfield (grátis) e avança o estado.
// Fluxo: gerando(soul, se usar) → compondo → animando(kling) → pronto(mp4).
export async function reconciliarStatusProduto(rowId: number): Promise<{ ok: boolean; video_status?: string; video_url?: string | null }> {
  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('id, hf_request_id, hf_video_request_id, imagem_url, video_status, video_url, canal').eq('id', rowId).limit(1);
  const row = rows?.[0] as any;
  if (!row || row.canal !== 'produtos') return { ok: false };
  if (row.video_status === 'pronto' || row.video_status === 'erro') {
    return { ok: true, video_status: row.video_status, video_url: row.video_url };
  }
  if (!temHiggsfield()) return { ok: false };

  try {
    // ESTADO 'animando': poll do job de vídeo (Kling) → ao completar grava o MP4.
    if (row.video_status === 'animando') {
      if (!row.hf_video_request_id) return { ok: true, video_status: 'animando' };
      const r = await fetch(`${BASE}/requests/${encodeURIComponent(row.hf_video_request_id)}/status`, { headers: AUTH() });
      if (!r.ok) return { ok: false };
      const j = await r.json() as any;
      const st = extrairStatus(j);
      const vurl = extrairVideoUrl(j);
      if (st === 'completed' && vurl) {
        await supabaseGerador.from('social_studio').update({ video_status: 'pronto', video_url: vurl }).eq('id', rowId);
        return { ok: true, video_status: 'pronto', video_url: vurl };
      }
      if (st === 'failed' || st === 'nsfw' || st === 'canceled' || st === 'error') {
        // vídeo falhou → entrega a IMAGEM do criativo (degradação honesta)
        await supabaseGerador.from('social_studio').update({ video_status: 'pronto', video_url: row.imagem_url || row.video_url }).eq('id', rowId);
        return { ok: true, video_status: 'pronto', video_url: row.imagem_url || row.video_url };
      }
      return { ok: true, video_status: 'animando' };
    }
    // 'compondo' = composição síncrona em curso/falha — não reconsulta IA.
    if (row.video_status === 'compondo') return { ok: true, video_status: 'compondo' };
    // ESTADO 'gerando' (só se usar Soul): poll do job de imagem → ao completar, compõe.
    if (!row.hf_request_id) return { ok: false };
    const r = await fetch(`${BASE}/requests/${encodeURIComponent(row.hf_request_id)}/status`, { headers: AUTH() });
    if (!r.ok) { logger.warn('higgsfield', `status HTTP ${r.status}`, { rowId }); return { ok: false }; }
    const j = await r.json() as any;
    const novo = await aplicarStatus(rowId, extrairStatus(j), extrairImagemUrl(j));
    const { data: after } = await supabaseGerador.from('social_studio').select('video_url').eq('id', rowId).limit(1);
    return { ok: true, video_status: novo, video_url: after?.[0]?.video_url || null };
  } catch (e: any) {
    logger.warn('higgsfield', 'reconcile falhou', { rowId, err: String(e?.message || e) });
    return { ok: false };
  }
}
