import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { lerComentariosRecentesFb, chaveRespostaGenteFb } from '../../instagram/fbComentarios';
import { chaveRespostaGenteIg } from '../../instagram/igEngine';
import { lerLinha, lerErroMeta, registrarParada, paradaVigente, codigoDo, ErroLivro, type RedeMeta } from './comum';

// ─────────────────────────────────────────────────────────────────────────────
// CAIXA DE COMENTÁRIOS do Instagram e da Página (fase 1 das redes, 14/10/2026).
//
// Só LEITURA. Antes do campo de resposta a tela mostra o que o motor já mandou ou tem na
// fila para cada comentário, e se gente já respondeu. A leitura vem do banco quando dá:
//   - Instagram: `ig_events` (os comentários que o webhook já trouxe) e a fila `ig_queue`.
//     Não gasta cota da Meta.
//   - Facebook: leitura no Graph dos últimos posts da Página, guardada por 1 minuto em
//     `system_state` (`redes_cx_cache:facebook`), porque gasta a cota da mesma Página e
//     conta do motor. Dentro do minuto, todo mundo lê a mesma cópia.
//
// Texto de comentário e nome de quem comentou nunca vão para log.
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'redes_caixa';
const CACHE_FB_MS = 60_000;
const CHAVE_CACHE_FB = 'redes_cx_cache:facebook';
const MAX_ITENS = 40;
const DIAS_VALIDOS = 7;   // a Meta só deixa responder em privado até 7 dias; a caixa mostra a mesma janela

export type EstadoMotor = 'enviada' | 'na_fila' | 'falhou' | 'pulada' | null;

export interface ComentarioCaixa {
  rede: RedeMeta;
  id: string;
  texto: string;
  autor_id: string | null;
  autor_nome: string | null;
  post_id: string | null;
  criado_em: string | null;
  /** O que o motor fez neste comentário. A resposta pública do motor segue a DM. */
  motor: { dm: EstadoMotor; publica: EstadoMotor };
  /** Resposta de gente, se já houve (1 por comentário). */
  gente: { por: string | null; em: string | null; estado: string | null } | null;
  pode_responder: boolean;
}

export interface CaixaComentarios {
  rede: RedeMeta;
  itens: ComentarioCaixa[];
  fonte: 'banco' | 'cache' | 'meta' | 'cache_velho';
  atualizado_em: string;
  parada?: { abre_em: string; motivo: string } | null;
}

const emLotes = <T,>(xs: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n)); return o; };

function estadoDaFila(status: string): EstadoMotor {
  if (status === 'sent' || status === 'incerto') return 'enviada';
  if (status === 'pending' || status === 'sending') return 'na_fila';
  if (status === 'failed') return 'falhou';
  if (status === 'skipped') return 'pulada';
  return null;
}

/** Quem GENTE já respondeu, por id de comentário. */
async function respostasDeGente(rede: RedeMeta, ids: string[]): Promise<Map<string, { por: string | null; em: string | null; estado: string | null }>> {
  const chave = rede === 'instagram' ? chaveRespostaGenteIg : chaveRespostaGenteFb;
  const m = new Map<string, { por: string | null; em: string | null; estado: string | null }>();
  for (const lote of emLotes(ids, 50)) {
    const { data, error } = await supabase.from('system_state').select('key, value').in('key', lote.map(chave));
    if (error) throw new ErroLivro(codigoDo(error));
    for (const l of (data ?? []) as Array<{ key: string; value: any }>) {
      const id = l.key.slice(chave('').length);
      m.set(id, { por: l.value?.por ?? null, em: l.value?.em ?? null, estado: l.value?.estado ?? null });
    }
  }
  return m;
}

// ── Instagram ────────────────────────────────────────────────────────────────

async function caixaInstagram(agora: number): Promise<ComentarioCaixa[]> {
  const desde = new Date(agora - DIAS_VALIDOS * 24 * 3600_000).toISOString();
  const { data, error } = await supabase.from('ig_events').select('ref, raw, criado_em')
    .eq('tipo', 'comment').gte('criado_em', desde).order('criado_em', { ascending: false }).limit(MAX_ITENS);
  if (error) throw new ErroLivro(codigoDo(error));
  const eventos = ((data ?? []) as Array<{ ref: string | null; raw: any; criado_em: string | null }>).filter(e => e.ref);
  const ids = [...new Set(eventos.map(e => String(e.ref)))];
  if (!ids.length) return [];

  const fila = new Map<string, { dm: EstadoMotor; publica: EstadoMotor }>();
  for (const lote of emLotes(ids, 50)) {
    const { data: q, error: eq } = await supabase.from('ig_queue').select('recipient, tipo, status').in('recipient', lote).in('tipo', ['private_reply', 'public_reply']);
    if (eq) throw new ErroLivro(codigoDo(eq));
    for (const r of (q ?? []) as Array<{ recipient: string; tipo: string; status: string }>) {
      const atual = fila.get(r.recipient) ?? { dm: null, publica: null };
      if (r.tipo === 'private_reply') atual.dm = estadoDaFila(r.status);
      else atual.publica = estadoDaFila(r.status);
      fila.set(r.recipient, atual);
    }
  }
  const gente = await respostasDeGente('instagram', ids);
  return eventos.map((e) => {
    const id = String(e.ref);
    const v = e.raw ?? {};
    const g = gente.get(id) ?? null;
    return {
      rede: 'instagram' as const, id,
      texto: String(v.text ?? '').slice(0, 1000),
      autor_id: v.from?.id ? String(v.from.id) : null,
      autor_nome: v.from?.username ? `@${v.from.username}` : null,
      post_id: v.media?.id ? String(v.media.id) : (v.media_id ? String(v.media_id) : null),
      criado_em: e.criado_em ?? null,
      motor: fila.get(id) ?? { dm: null, publica: null },
      gente: g,
      pode_responder: !g,
    };
  });
}

// ── Facebook ─────────────────────────────────────────────────────────────────

interface ItemFbCache { id: string; texto: string; autor_id: string | null; autor_nome: string | null; post_id: string | null; criado_em: string | null }

async function lerCacheFb(): Promise<{ em: number; itens: ItemFbCache[] } | null> {
  try {
    const l = await lerLinha<{ em?: string; itens?: ItemFbCache[] }>(CHAVE_CACHE_FB);
    const em = Date.parse(String(l?.value?.em ?? ''));
    return l && Number.isFinite(em) && Array.isArray(l.value?.itens) ? { em, itens: l.value.itens! } : null;
  } catch { return null; }
}

async function guardarCacheFb(itens: ItemFbCache[], agora: number): Promise<void> {
  const iso = new Date(agora).toISOString();
  const { error } = await supabase.from('system_state').upsert({ key: CHAVE_CACHE_FB, value: { em: iso, itens }, updated_at: iso }, { onConflict: 'key' });
  if (error) logger.error(LOG, 'não guardei a cópia da leitura do Facebook', { codigo: codigoDo(error) });
}

async function itensFb(agora: number): Promise<{ itens: ItemFbCache[]; fonte: CaixaComentarios['fonte']; parada: CaixaComentarios['parada'] }> {
  const cache = await lerCacheFb();
  if (cache && agora - cache.em < CACHE_FB_MS) return { itens: cache.itens, fonte: 'cache', parada: null };
  // Parada vigente da Página (a mesma de publicar e responder): serve a cópia velha, se houver, e não chama a Meta.
  const parada = await paradaVigente('facebook', agora).catch(() => null);
  if (parada) {
    return { itens: cache?.itens ?? [], fonte: 'cache_velho', parada: { abre_em: new Date(parada.ate).toISOString(), motivo: parada.motivo } };
  }
  try {
    const lidos = await lerComentariosRecentesFb();
    const limite = agora - DIAS_VALIDOS * 24 * 3600_000;
    const itens: ItemFbCache[] = lidos
      .filter(c => c.message.trim() && Date.parse(c.created_time) >= limite)
      .sort((a, b) => Date.parse(b.created_time) - Date.parse(a.created_time))
      .slice(0, MAX_ITENS)
      .map(c => ({ id: c.id, texto: c.message.slice(0, 1000), autor_id: c.fromId, autor_nome: c.fromName, post_id: c.postId, criado_em: c.created_time }));
    await guardarCacheFb(itens, agora);
    return { itens, fonte: 'meta', parada: null };
  } catch (err) {
    // Erro de limite da Meta para a Página por 15 min; sem isso a caixa seria a causa da parada.
    const e = lerErroMeta(0, String((err as Error)?.message || err));
    await registrarParada('facebook', e, agora).catch(() => undefined);
    logger.error(LOG, `leitura dos comentários do Facebook falhou (código ${e.codigo ?? '-'})`);
    if (cache) return { itens: cache.itens, fonte: 'cache_velho', parada: null };
    throw err;
  }
}

async function caixaFacebook(agora: number): Promise<{ itens: ComentarioCaixa[]; fonte: CaixaComentarios['fonte']; parada: CaixaComentarios['parada'] }> {
  const { itens, fonte, parada } = await itensFb(agora);
  const ids = itens.map(i => i.id);
  const motor = new Map<string, { dm: EstadoMotor; publica: EstadoMotor }>();
  for (const lote of emLotes(ids, 50)) {
    const { data, error } = await supabase.from('ig_events').select('ref, tipo').in('ref', lote).in('tipo', ['fb_private_reply', 'fb_falha']);
    if (error) throw new ErroLivro(codigoDo(error));
    for (const r of (data ?? []) as Array<{ ref: string; tipo: string }>) {
      const atual = motor.get(r.ref) ?? { dm: null, publica: null };
      // A resposta privada do motor leva o aviso público junto (fbComentarios.ts).
      if (r.tipo === 'fb_private_reply') { atual.dm = 'enviada'; atual.publica = 'enviada'; }
      else if (atual.dm === null) atual.dm = 'falhou';
      motor.set(r.ref, atual);
    }
  }
  const gente = await respostasDeGente('facebook', ids);
  return {
    fonte, parada,
    itens: itens.map((i) => {
      const g = gente.get(i.id) ?? null;
      return { rede: 'facebook' as const, ...i, motor: motor.get(i.id) ?? { dm: null, publica: null }, gente: g, pode_responder: !g };
    }),
  };
}

export async function listarComentarios(rede: RedeMeta, agora = Date.now()): Promise<CaixaComentarios> {
  if (rede === 'instagram') {
    return { rede, itens: await caixaInstagram(agora), fonte: 'banco', atualizado_em: new Date(agora).toISOString(), parada: null };
  }
  const r = await caixaFacebook(agora);
  return { rede, itens: r.itens, fonte: r.fonte, atualizado_em: new Date(agora).toISOString(), parada: r.parada };
}

/**
 * Autor e texto de um comentário, lidos do NOSSO lado (o navegador manda só o id). Instagram: `ig_events`.
 * Facebook: a cópia da leitura. `conhecido: false` = o id não está entre os comentários que lemos (pode ser id de
 * post ou de outra coisa): quem responde recusa, para um id qualquer não virar comentário novo no topo. Autor
 * desconhecido volta null: a Meta nem sempre devolve quem comentou.
 */
export async function dadosDoComentario(rede: RedeMeta, id: string): Promise<{ conhecido: boolean; autor: string | null; texto: string | null }> {
  if (rede === 'instagram') {
    const { data, error } = await supabase.from('ig_events').select('raw').eq('tipo', 'comment').eq('ref', id).limit(1);
    if (error) throw new ErroLivro(codigoDo(error));
    const achou = ((data ?? [])[0] as { raw?: any } | undefined);
    const raw = achou?.raw;
    return { conhecido: !!achou, autor: raw?.from?.id ? String(raw.from.id) : null, texto: raw?.text ? String(raw.text) : null };
  }
  const cache = await lerCacheFb();
  const item = cache?.itens.find(i => i.id === id);
  return { conhecido: !!item, autor: item?.autor_id ?? null, texto: item?.texto ?? null };
}
