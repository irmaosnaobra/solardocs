import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

// Auto-geração de vídeo do produto via Higgsfield (aba Produtos do /gerador, afiliados).
// O vídeo é image-to-video: recria um anúncio do produto ancorado na imagem dele,
// sem rosto/avatar. Fluxo assíncrono: POST submit → Higgsfield processa → faz POST
// no nosso webhook quando termina (serverless não pode ficar pollando).
//
// Contrato verificado no SDK oficial github.com/higgsfield-ai/higgsfield-client:
//   base    https://platform.higgsfield.ai
//   auth    header  Authorization: Key <HF_KEY>   (HF_KEY no formato key:secret)
//   submit  POST {base}/{application}?hf_webhook=<url>  body = arguments (JSON)
//           resposta { request_id, status_url, cancel_url }
//   webhook Higgsfield faz POST no hf_webhook com o resultado quando completa
//   status  GET {status_url} → { status: queued|in_progress|completed|failed|nsfw|canceled }

const BASE = 'https://platform.higgsfield.ai';
const HF_KEY = process.env.HF_KEY || '';
// endpoint de image-to-video (DoP) — confirmado no SDK JS oficial
// github.com/higgsfield-ai/higgsfield-js: subscribe('/v1/image2video/dop', {input}).
// O body do POST é o `input` ESPALHADO direto (não embrulhado). Configurável por env.
const HF_APP_I2V = process.env.HF_APP_I2V || 'v1/image2video/dop';
// model variant: dop-turbo (2x mais rápido) / dop-lite (entrada) / dop-preview (premium).
const HF_MODEL = process.env.HF_MODEL || 'dop-turbo';
// URL pública da nossa API (onde o Higgsfield faz o POST de volta).
const API_BASE = process.env.API_PUBLIC_BASE || 'https://api.solardoc.app';
const WEBHOOK_URL = `${API_BASE}/gerador/social/higgsfield-webhook`;

export function temHiggsfield(): boolean {
  return !!HF_KEY;
}

interface DispararArgs { prompt: string; imagemUrl: string | null; rowId: number; }

// dispara a geração de UM vídeo de produto e grava o request_id na linha.
// Degradação honesta: sem HF_KEY não quebra — só marca a linha como aguardando config.
export async function dispararVideoProduto({ prompt, imagemUrl, rowId }: DispararArgs): Promise<{ ok: boolean; motivo?: string; requestId?: string }> {
  if (!temHiggsfield()) {
    logger.warn('higgsfield', 'HF_KEY ausente — vídeo não disparado (aguardando config)', { rowId });
    await supabaseGerador.from('social_studio')
      .update({ video_status: 'aguardando_config' }).eq('id', rowId);
    return { ok: false, motivo: 'sem_hf_key' };
  }

  // body do submit. Formato VALIDADO contra a API real (curl): o DoP exige os campos
  // embrulhados em { params: {...} } — a API retorna 422 "Field required: body.params"
  // sem o wrapper (o README do SDK simplifica, mas a API quer params). Confirmado por
  // 403 "Not enough credits" com este shape = tudo certo, só faltava crédito.
  const params: Record<string, any> = { model: HF_MODEL, prompt };
  if (imagemUrl) params.input_images = [{ type: 'image_url', image_url: imagemUrl }];
  const args = { params };

  const url = `${BASE}/${HF_APP_I2V}?hf_webhook=${encodeURIComponent(WEBHOOK_URL)}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Key ${HF_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'higgsfield-server-js/2.0' },
      body: JSON.stringify(args),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logger.warn('higgsfield', `submit HTTP ${r.status}`, { rowId, body: body.slice(0, 300) });
      await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
      return { ok: false, motivo: `http_${r.status}` };
    }
    const j = await r.json() as any;
    const requestId = j?.request_id || j?.id || null;
    await supabaseGerador.from('social_studio')
      .update({ hf_request_id: requestId, video_status: 'gerando' }).eq('id', rowId);
    logger.info('higgsfield', 'vídeo de produto disparado', { rowId, requestId });
    return { ok: true, requestId };
  } catch (e: any) {
    logger.warn('higgsfield', 'falha no submit', { rowId, err: String(e?.message || e) });
    await supabaseGerador.from('social_studio').update({ video_status: 'erro' }).eq('id', rowId);
    return { ok: false, motivo: 'exception' };
  }
}

// extrai a URL do vídeo do payload do webhook. Formato confirmado no SDK JS:
// { status, request_id, images:[{url}], video:{url} }. Mantém fallbacks por garantia.
function extrairVideoUrl(p: any): string | null {
  return (
    p?.video?.url ||                                    // formato DoP oficial
    p?.video_url || p?.url || p?.output?.url || p?.result?.url ||
    p?.videos?.[0]?.url || p?.output?.videos?.[0]?.url ||
    p?.results?.[0]?.url || p?.output?.[0]?.url ||
    p?.jobs?.[0]?.results?.raw?.url || null             // shape JobSet
  );
}

// extrai o status normalizado do payload.
function extrairStatus(p: any): string {
  return String(p?.status || p?.state || '').toLowerCase();
}

// processa o POST do Higgsfield no nosso webhook. Acha a linha por hf_request_id
// e atualiza video_status + video_url. Só toca linhas que estavam 'gerando'
// (defesa contra POST externo arbitrário).
export async function processarWebhook(payload: any): Promise<{ ok: boolean; rowId?: number }> {
  const requestId = payload?.request_id || payload?.id || payload?.requestId || null;
  if (!requestId) {
    logger.warn('higgsfield', 'webhook sem request_id', { keys: Object.keys(payload || {}) });
    return { ok: false };
  }

  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('id, video_status').eq('hf_request_id', String(requestId)).limit(1);
  const row = rows?.[0];
  if (!row) {
    logger.warn('higgsfield', 'webhook: nenhuma linha com esse request_id', { requestId });
    return { ok: false };
  }

  const status = extrairStatus(payload);
  const videoUrl = extrairVideoUrl(payload);
  let novoStatus: string;
  if (status === 'completed' && videoUrl) novoStatus = 'pronto';
  else if (status === 'failed' || status === 'nsfw' || status === 'canceled' || status === 'error') novoStatus = 'erro';
  else if (videoUrl) novoStatus = 'pronto';            // completou implícito
  else novoStatus = 'gerando';                         // update intermediário — mantém

  const patch: Record<string, any> = { video_status: novoStatus };
  if (videoUrl) patch.video_url = videoUrl;
  await supabaseGerador.from('social_studio').update(patch).eq('id', row.id);
  logger.info('higgsfield', 'webhook processado', { rowId: row.id, novoStatus, temUrl: !!videoUrl });
  return { ok: true, rowId: row.id };
}
