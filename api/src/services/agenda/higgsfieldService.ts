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

// modela o criativo: Soul image-to-image ancorado na foto do produto. Grava o
// request_id e marca 'gerando'. Degradação honesta sem HF_KEY.
export async function modelarCriativoProduto({ prompt, imagemUrl, rowId }: DispararArgs): Promise<{ ok: boolean; motivo?: string; requestId?: string }> {
  if (!temHiggsfield()) {
    await supabaseGerador.from('social_studio').update({ video_status: 'aguardando_config' }).eq('id', rowId);
    return { ok: false, motivo: 'sem_hf_key' };
  }

  // prompt de CENA (sem texto — o texto é overlay depois). Reaproveita o prompt já
  // gerado e reforça "anúncio de produto e-commerce, sem texto na imagem".
  const cena = `${prompt}\n\nProduct advertising scene, e-commerce / TikTok Shop style, clean studio or lifestyle background, premium lighting, vertical 9:16, NO text or watermark in the image, leave clean space top and bottom for captions.`;

  // a foto do produto precisa estar no CDN do Higgsfield pra virar image_reference.
  let refUrl: string | null = null;
  if (imagemUrl) refUrl = await uploadParaHiggsfield(imagemUrl);

  const body: Record<string, any> = { prompt: cena };
  if (refUrl) {
    body.image_reference = { type: 'image_url', image_url: refUrl };
    body.image_reference_strength = HF_REF_STRENGTH;
  }

  try {
    const r = await fetch(`${BASE}/${HF_SOUL}`, {
      method: 'POST', headers: { ...AUTH(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      logger.warn('higgsfield', `soul submit HTTP ${r.status}`, { rowId, body: t.slice(0, 300) });
      await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
      return { ok: false, motivo: `http_${r.status}` };
    }
    const j = await r.json() as any;
    const requestId = j?.request_id || j?.id || null;
    await supabaseGerador.from('social_studio')
      .update({ hf_request_id: requestId, video_status: 'gerando' }).eq('id', rowId);
    logger.info('higgsfield', 'criativo de produto disparado (soul)', { rowId, requestId });
    return { ok: true, requestId };
  } catch (e: any) {
    logger.warn('higgsfield', 'falha no submit soul', { rowId, err: String(e?.message || e) });
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

// após o Soul completar, compõe o texto por cima e finaliza a linha.
// Se a composição falhar, cai pra 'pronto' com a imagem-base (degradação honesta).
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
  const url = final || imagemBaseUrl; // fallback: imagem sem overlay
  await supabaseGerador.from('social_studio').update({ video_status: 'pronto', video_url: url }).eq('id', rowId);
  return 'pronto';
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

// RECONCILE (caminho principal): GET status do Soul (grátis) → ao completar, compõe.
export async function reconciliarStatusProduto(rowId: number): Promise<{ ok: boolean; video_status?: string; video_url?: string | null }> {
  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('id, hf_request_id, video_status, video_url, canal').eq('id', rowId).limit(1);
  const row = rows?.[0] as any;
  if (!row || row.canal !== 'produtos') return { ok: false };
  if (row.video_status === 'pronto' || row.video_status === 'erro') {
    return { ok: true, video_status: row.video_status, video_url: row.video_url };
  }
  // 'compondo' = Soul já terminou, composição em andamento/falha — não reconsulta a IA.
  if (row.video_status === 'compondo') return { ok: true, video_status: 'compondo' };
  if (!row.hf_request_id || !temHiggsfield()) return { ok: false };

  try {
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
