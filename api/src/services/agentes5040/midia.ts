// ─────────────────────────────────────────────────────────────────────────────
// MÍDIA DO LEAD PARA A IA. Áudio vira texto (Whisper), imagem e PDF viram bloco de
// visão. Sem banco: o cache é um Map que quem chama carrega e persiste (A2 guarda no
// bucket privado). No máximo 2 mídias lidas por turno; URL morta ou acima do teto
// vira o marcador "[audio]" / "[imagem]" / "[documento]", como no resto da casa.
// Nada daqui vai para log (nem URL nem texto transcrito).
// ─────────────────────────────────────────────────────────────────────────────

import {
  downloadImageAsAnthropicSource, downloadPdfAsAnthropicSource, transcribeAudio,
} from '../../utils/mediaProcessor';
import type { MsgConversa } from './tipos';

export const MAX_MIDIAS_POR_TURNO = 2;
/** Quanto esperar por UMA mídia (download + leitura). Passou disso, vira marcador e a rodada segue. */
export const PRAZO_MIDIA_MS = 20_000;
const TETO_TRANSCRICAO = 1500;

export type FonteImagem = NonNullable<Awaited<ReturnType<typeof downloadImageAsAnthropicSource>>>;
export type FontePdf = NonNullable<Awaited<ReturnType<typeof downloadPdfAsAnthropicSource>>>;

export type BlocoMidia =
  | { msgId: number; tipo: 'texto'; texto: string }
  | { msgId: number; tipo: 'imagem'; source: FonteImagem }
  | { msgId: number; tipo: 'pdf'; source: FontePdf };

/** Cache por id de wa_mensagens. Quem chama persiste o que foi acrescentado. */
export type CacheMidia = Map<number, BlocoMidia>;

const MARCADOR: Record<string, string> = { audio: '[audio]', image: '[imagem]', imagem: '[imagem]', document: '[documento]' };

export const ehMidia = (m: Pick<MsgConversa, 'tipo' | 'media_url'>): boolean =>
  ['audio', 'image', 'imagem', 'document'].includes(m.tipo) && !!String(m.media_url ?? '').trim();

function corta(t: string): string {
  const s = t.trim();
  return s.length <= TETO_TRANSCRICAO ? s : `${s.slice(0, TETO_TRANSCRICAO).trimEnd()} [...]`;
}

/**
 * Espera no máximo `ms` pela promessa; estourou, devolve null. O download em si (utils/mediaProcessor.ts, que não
 * aceita AbortSignal) pode terminar sozinho depois, mas a rodada não fica esperando por ele.
 */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([p, limite]).finally(() => { if (timer) clearTimeout(timer); });
}

async function ler(m: MsgConversa): Promise<BlocoMidia | null> {
  const url = String(m.media_url ?? '').trim();
  if (m.tipo === 'audio') {
    const t = await transcribeAudio(url);
    return t ? { msgId: m.id, tipo: 'texto', texto: `(áudio transcrito) ${corta(t)}` } : null;
  }
  if (m.tipo === 'image' || m.tipo === 'imagem') {
    const s = await downloadImageAsAnthropicSource(url);
    return s ? { msgId: m.id, tipo: 'imagem', source: s } : null;
  }
  if (m.tipo === 'document') {
    const s = await downloadPdfAsAnthropicSource(url);
    return s ? { msgId: m.id, tipo: 'pdf', source: s } : null;
  }
  return null;
}

/**
 * Prepara a mídia das mensagens NOVAS do lead. As 2 mais recentes são lidas (ou vêm do cache);
 * as demais, e as que falharem, viram marcador de texto. Nunca lança.
 */
export async function prepararMidia(novas: readonly MsgConversa[], cache: CacheMidia = new Map()): Promise<BlocoMidia[]> {
  const midias = novas.filter(ehMidia);
  const lidas = new Set(midias.slice(-MAX_MIDIAS_POR_TURNO).map(m => m.id));
  const out: BlocoMidia[] = [];
  for (const m of midias) {
    const marcador: BlocoMidia = { msgId: m.id, tipo: 'texto', texto: MARCADOR[m.tipo] ?? '[mídia]' };
    const guardado = cache.get(m.id);
    if (guardado) { out.push(guardado); continue; }
    if (!lidas.has(m.id)) { out.push(marcador); continue; }
    let bloco: BlocoMidia | null = null;
    try { bloco = await comPrazo(ler(m), PRAZO_MIDIA_MS); } catch { bloco = null; }
    if (bloco) cache.set(m.id, bloco);
    out.push(bloco ?? marcador);
  }
  return out;
}
