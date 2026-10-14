import crypto from 'crypto';
import { supabase } from '../../../utils/supabase';
import { REGRAS_REDES } from '../../chefe/regulamento';

// ─────────────────────────────────────────────────────────────────────────────
// Vídeo das redes: o navegador envia direto ao Storage do banco principal (a função
// da Vercel aceita 4,5 MB de corpo) e a API só confere o que está lá.
//
// Duas funções:
//   criarUrlDeEnvio  devolve a URL assinada de envio e a URL pública final;
//   validarVideo     confere o link ANTES de qualquer chamada à Meta ou à Z-API
//                    (só o nosso bucket, só mp4 ou mov, tamanho pelo HEAD).
// ─────────────────────────────────────────────────────────────────────────────

export const BUCKET_REDES = 'redes-videos';

const TIPOS: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime' };

export class ErroVideo extends Error {
  constructor(public motivo: string, public mensagem: string, public http = 400) { super(mensagem); this.name = 'ErroVideo'; }
}

function baseSupabase(): string {
  return String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

/** Prefixo público do nosso bucket. Só link que começa assim é aceito. */
export function prefixoPublico(): string | null {
  const b = baseSupabase();
  return b ? `${b}/storage/v1/object/public/${BUCKET_REDES}/` : null;
}

function extensaoDe(nome: unknown, tipo: unknown): 'mp4' | 'mov' | null {
  const n = typeof nome === 'string' ? nome.toLowerCase() : '';
  const t = typeof tipo === 'string' ? tipo.toLowerCase() : '';
  if (/\.mp4$/.test(n) || t === 'video/mp4') return 'mp4';
  if (/\.mov$/.test(n) || t === 'video/quicktime') return 'mov';
  return null;
}

const naoAchou = (err: any): boolean =>
  /not found/i.test(String(err?.message ?? '')) || String(err?.statusCode ?? err?.status ?? '') === '404';

/** Opções do bucket: público, 50 MB e só mp4 e mov. Na criação e na conferência de quem já existe. */
const opcoesDoBucket = () => ({
  public: true,
  fileSizeLimit: REGRAS_REDES.reels.videoMaxBytes,
  allowedMimeTypes: Object.values(TIPOS),
});

const mesmosTipos = (a: unknown): boolean => {
  const esperado = Object.values(TIPOS).sort();
  return Array.isArray(a) && a.length === esperado.length && [...a].map(String).sort().every((t, i) => t === esperado[i]);
};

/**
 * Garante o bucket público, com 50 MB e só mp4 e mov. Confere por `getBucket` (o `list()` mente sobre bucket que
 * não existe) e só cria quando o erro é claro de "não existe". Qualquer outro erro vira 502. Bucket que existe
 * sem ser público dá erro (um link que dá 404 seria pior); existindo SEM os limites, é atualizado, e se a
 * atualização falhar a resposta é 502 em vez de aceitar vídeo sem teto de tamanho ou de tipo.
 */
export async function garantirBucket(): Promise<void> {
  const { data, error } = await supabase.storage.getBucket(BUCKET_REDES);
  if (!error && data) {
    if (!data.public) throw new ErroVideo('bucket_privado', 'O depósito dos vídeos existe mas não é público. Avise o suporte.', 502);
    const limite = Number((data as { file_size_limit?: number | null }).file_size_limit);
    const tipos = (data as { allowed_mime_types?: string[] | null }).allowed_mime_types;
    if (limite === REGRAS_REDES.reels.videoMaxBytes && mesmosTipos(tipos)) return;
    const { error: eAtualiza } = await supabase.storage.updateBucket(BUCKET_REDES, opcoesDoBucket());
    if (eAtualiza) throw new ErroVideo('bucket_sem_limites', 'O depósito dos vídeos está sem o limite de tamanho e de tipo e não consegui ajustar. Avise o suporte.', 502);
    return;
  }
  if (!error || !naoAchou(error)) throw new ErroVideo('bucket_erro', 'Não consegui conferir o depósito dos vídeos agora. Tente de novo.', 502);
  const { error: eCria } = await supabase.storage.createBucket(BUCKET_REDES, opcoesDoBucket());
  // Outra chamada pode ter criado no mesmo instante: confere de novo antes de desistir.
  if (eCria) {
    const { data: de2, error: e2 } = await supabase.storage.getBucket(BUCKET_REDES);
    if (e2 || !de2) throw new ErroVideo('bucket_erro', 'Não consegui criar o depósito dos vídeos agora. Tente de novo.', 502);
    if (!de2.public) throw new ErroVideo('bucket_privado', 'O depósito dos vídeos existe mas não é público. Avise o suporte.', 502);
  }
}

export interface UrlDeEnvio { upload_url: string; metodo: 'PUT'; cabecalhos: Record<string, string>; token: string; caminho: string; video_url: string; limite_bytes: number }

/** Entrada: `{ nome, tipo, tamanho }` do navegador. Saída: onde enviar e onde o vídeo vai ficar. */
export async function criarUrlDeEnvio(entrada: { nome?: unknown; tipo?: unknown; tamanho?: unknown }, agora = new Date()): Promise<UrlDeEnvio> {
  const ext = extensaoDe(entrada.nome, entrada.tipo);
  if (!ext) throw new ErroVideo('formato', 'Só vídeo mp4 ou mov.');
  const tamanho = entrada.tamanho;
  if (typeof tamanho !== 'number' || !Number.isFinite(tamanho) || tamanho <= 0) throw new ErroVideo('tamanho', 'Diga o tamanho do vídeo.');
  if (tamanho > REGRAS_REDES.reels.videoMaxBytes) throw new ErroVideo('grande', 'O vídeo passa de 50 MB.');
  const prefixo = prefixoPublico();
  if (!prefixo) throw new ErroVideo('sem_storage', 'O depósito dos vídeos não está configurado.', 502);
  await garantirBucket();
  const caminho = `${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET_REDES).createSignedUploadUrl(caminho);
  if (error || !data?.signedUrl) throw new ErroVideo('assinar', 'Não consegui preparar o envio agora. Tente de novo.', 502);
  return {
    upload_url: data.signedUrl, metodo: 'PUT', cabecalhos: { 'content-type': TIPOS[ext]! },
    token: data.token, caminho, video_url: `${prefixo}${caminho}`, limite_bytes: REGRAS_REDES.reels.videoMaxBytes,
  };
}

export interface VideoOk { ok: true; url: string; bytes: number; tipo: string; ext: 'mp4' | 'mov'; hash: string }
export interface VideoRecusado { ok: false; motivo: string; mensagem: string }

/** Sem etag a impressão digital cai para o link, que também é único por envio. */
export function hashDoVideo(url: string, etag: string | null, bytes: number): string {
  const base = etag ? `etag:${etag.replace(/"/g, '')}|${bytes}` : `url:${url}`;
  return crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
}

/**
 * Confere o vídeo pelo HEAD, sem baixar. Recusa: link de fora do nosso bucket, extensão errada, link que
 * não responde, resposta sem tamanho ou sem tipo de vídeo, e vídeo acima do teto (50 MB nos Reels, 10 MB
 * no status). `soMp4` vale para o status, que a Z-API só aceita em mp4.
 */
export async function validarVideo(url: unknown, opts: { maxBytes: number; soMp4?: boolean }): Promise<VideoOk | VideoRecusado> {
  const recusa = (motivo: string, mensagem: string): VideoRecusado => ({ ok: false, motivo, mensagem });
  const prefixo = prefixoPublico();
  if (typeof url !== 'string' || !url) return recusa('video_ausente', 'Falta o link do vídeo.');
  if (!prefixo) return recusa('sem_storage', 'O depósito dos vídeos não está configurado.');
  let u: URL;
  let base: URL;
  try { u = new URL(url); base = new URL(prefixo); } catch { return recusa('video_invalido', 'O link do vídeo não é válido.'); }
  // O caminho JÁ RESOLVIDO (o `new URL` tira os ".." e os "." e junta as barras) e DECODIFICADO é que se compara
  // com o prefixo: quem recebe o link resolve `%2e%2e` e sairia para outro bucket. `%` no caminho e barra
  // invertida, barra dupla e segmento "." ou ".." recusam de vez.
  let caminho: string;
  try { caminho = decodeURIComponent(u.pathname); } catch { return recusa('video_de_fora', 'O vídeo tem de ter sido enviado por esta tela.'); }
  const resto = caminho.slice(base.pathname.length);
  const fora = u.origin !== base.origin || u.username || u.password || u.search || u.hash
    || u.pathname.includes('%') || url.includes(String.fromCharCode(92)) || !url.startsWith(prefixo) || url.slice(prefixo.length).includes('..') || url.slice(prefixo.length).includes('/./')
    || !caminho.startsWith(base.pathname) || !resto || caminho.includes('//') || resto.split('/').some(seg => seg === '.' || seg === '..');
  if (fora) return recusa('video_de_fora', 'O vídeo tem de ter sido enviado por esta tela.');
  const ext = /\.(mp4|mov)$/i.exec(u.pathname)?.[1]?.toLowerCase() as 'mp4' | 'mov' | undefined;
  if (!ext) return recusa('formato', 'Só vídeo mp4 ou mov.');
  if (opts.soMp4 && ext !== 'mp4') return recusa('formato', 'O status aceita só mp4.');
  let r: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try { r = await fetch(url, { method: 'HEAD', signal: ctrl.signal }); } finally { clearTimeout(t); }
  } catch {
    return recusa('video_nao_responde', 'Não consegui abrir o vídeo. Envie de novo.');
  }
  if (!r.ok) return recusa('video_nao_responde', 'Não consegui abrir o vídeo. Envie de novo.');
  const bytes = Number(r.headers.get('content-length'));
  if (!Number.isFinite(bytes) || bytes <= 0) return recusa('sem_tamanho', 'Não consegui medir o vídeo. Envie de novo.');
  const tipo = String(r.headers.get('content-type') || '').toLowerCase();
  if (!tipo.startsWith('video/')) return recusa('sem_tipo_de_video', 'O arquivo enviado não é um vídeo.');
  if (bytes > opts.maxBytes) {
    const mb = Math.round(opts.maxBytes / (1024 * 1024));
    return recusa('video_grande', `O vídeo passa de ${mb} MB.`);
  }
  return { ok: true, url, bytes, tipo, ext, hash: hashDoVideo(url, r.headers.get('etag'), bytes) };
}
