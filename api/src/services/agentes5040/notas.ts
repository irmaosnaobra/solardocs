// ─────────────────────────────────────────────────────────────────────────────
// NOTAS DO PAINEL DO ENSAIO (A3). Moram no MESMO bucket privado do armazém (`ensaio-5040`), em
//   notas/<wa_id do turno>/<autor>-<ts>.json
// O <wa_id> é único por turno (ao vivo e replay gravam no mesmo caminho do armazém). Cada nota é um
// arquivo novo gravado com upsert:false: ninguém sobrescreve ninguém. Quem apaga é só o autor.
//
// Nenhum telefone aqui: a nota leva o HMAC da conversa, o id do turno, o nome de quem avaliou
// (parte do e-mail, `[a-z0-9_]`) e o comentário. Nada vai para system_state nem para log.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { BUCKET_ENSAIO, caminhoDoTurno, garantirBucketEnsaio, type TurnoGravado } from './armazem';

export class ErroNotas extends Error {
  constructor(readonly codigo: string) {
    super(`notas: ${codigo}`);
    this.name = 'ErroNotas';
  }
}

export interface NotaGravada {
  v: 1;
  /** wa_id do turno. */
  turno: number;
  hmac: string;
  persona: TurnoGravado['persona'];
  origem: TurnoGravado['origem'];
  autor: string;
  certo: boolean;
  /** Inteiro de 0 a 10. */
  nota: number;
  comentario: string;
  em: string;
  /** Nome do arquivo sem `.json` (`<autor>-<ts>`). Preenchido na leitura. */
  id?: string;
}

export const TAMANHO_MAX_COMENTARIO = 500;
export const META_AVALIACOES = 50;
const PAGINA = 100;
const MAX_PAGINAS = 50;
const MAX_DOWNLOADS_INDICE = 800;
const TENTATIVAS_NOME = 5;
const CACHE_INDICE_MS = 20_000;

const ID_NOTA = /^([a-z0-9_]{1,40})-(\d{10,16})$/;

/** O nome de quem avalia, como entra no caminho. null = sem nome aproveitável. */
export function autorSeguro(nome: unknown): string | null {
  const a = String(nome ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return a.replace(/_/g, '') ? a : null;
}

export function lerIdDeNota(id: unknown): { autor: string; ts: number } | null {
  const m = ID_NOTA.exec(String(id ?? ''));
  return m ? { autor: m[1]!, ts: Number(m[2]) } : null;
}

const caminhoDaNota = (turno: number, id: string): string => `notas/${turno}/${id}.json`;
const turnoValido = (t: unknown): t is number => typeof t === 'number' && Number.isSafeInteger(t) && t > 0;

const jaExiste = (e: { message?: string; statusCode?: string | number; status?: number } | null | undefined): boolean => {
  const m = String(e?.message ?? '').toLowerCase();
  const c = String(e?.statusCode ?? e?.status ?? '');
  return c === '409' || m.includes('already exists') || m.includes('duplicate');
};

async function baixar<T>(caminho: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET_ENSAIO).download(caminho);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()) as T; } catch { return null; }
}

async function listar(prefixo: string): Promise<string[]> {
  const out: string[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase.storage.from(BUCKET_ENSAIO)
      .list(prefixo, { limit: PAGINA, offset: p * PAGINA, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new ErroNotas('lista_falhou');
    const lote = (data ?? []) as Array<{ name: string }>;
    out.push(...lote.map(x => x.name));
    if (lote.length < PAGINA) break;
  }
  return out;
}

let cacheIndice: { em: number; dados: IndiceDeNotas } | null = null;
let cacheComNota: { em: number; ids: Set<number> } | null = null;
/** Zera os caches (depois de gravar ou apagar, e nos testes). */
export function zerarCacheNotas(): void { cacheIndice = null; cacheComNota = null; }

const CONCORRENCIA = 8;

/** Roda `fn` em todos os itens, no máximo `n` ao mesmo tempo (sem pacote). A ordem do resultado é a dos itens. */
export async function emParalelo<T, R>(itens: readonly T[], fn: (item: T) => Promise<R>, n: number = CONCORRENCIA): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    for (;;) {
      const i = proximo++;
      if (i >= itens.length) return;
      saida[i] = await fn(itens[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, itens.length)) }, trabalhador));
  return saida;
}

/** Quais turnos (wa_id) têm ao menos uma nota: uma lista só da pasta `notas/`. Cache de 20 s. */
export async function turnosComNota(): Promise<Set<number>> {
  if (cacheComNota && Date.now() - cacheComNota.em < CACHE_INDICE_MS) return cacheComNota.ids;
  await garantirBucketEnsaio();
  const ids = new Set((await listar('notas')).map(Number).filter(turnoValido));
  cacheComNota = { em: Date.now(), ids };
  return ids;
}

// ── o turno que a nota avalia ────────────────────────────────────────────────

/** Lê UM turno pelo caminho exato (sem varrer dias). */
export async function lerTurnoExato(dia: string, hmac: string, waId: number): Promise<TurnoGravado | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^[0-9a-f]{64}$/.test(hmac) || !turnoValido(waId)) return null;
  await garantirBucketEnsaio();
  const t = await baixar<TurnoGravado>(caminhoDoTurno(dia, hmac, waId));
  return t && t.v === 1 && t.hmac === hmac && t.wa_id === waId ? t : null;
}

// ── gravar e apagar ──────────────────────────────────────────────────────────

export interface NovaNota {
  turno: number; hmac: string; persona: NotaGravada['persona']; origem: NotaGravada['origem'];
  autor: string; certo: boolean; nota: number; comentario: string;
}

/** Acrescenta uma nota. Nunca sobrescreve: se o nome já existe, tenta o próximo milissegundo. */
export async function gravarNota(n: NovaNota, agora: number = Date.now()): Promise<{ id: string }> {
  if (!turnoValido(n.turno) || !/^[0-9a-f]{64}$/.test(n.hmac) || !autorSeguro(n.autor) || n.autor !== autorSeguro(n.autor)) {
    throw new ErroNotas('nota_invalida');
  }
  await garantirBucketEnsaio();
  const corpo: NotaGravada = {
    v: 1, turno: n.turno, hmac: n.hmac, persona: n.persona, origem: n.origem, autor: n.autor,
    certo: n.certo, nota: n.nota, comentario: n.comentario, em: new Date(agora).toISOString(),
  };
  for (let i = 0; i < TENTATIVAS_NOME; i++) {
    const id = `${n.autor}-${agora + i}`;
    const { error } = await supabase.storage.from(BUCKET_ENSAIO)
      .upload(caminhoDaNota(n.turno, id), Buffer.from(JSON.stringify(corpo), 'utf8'), { contentType: 'application/json', upsert: false });
    if (!error) { zerarCacheNotas(); return { id }; }
    if (!jaExiste(error)) throw new ErroNotas('upload_falhou');
  }
  throw new ErroNotas('nome_ocupado');
}

export type ResultadoApagar = 'apagada' | 'nao_existe' | 'nao_e_sua';

/** Só o autor apaga: o nome do arquivo E o autor gravado dentro dele têm que ser os dele. */
export async function apagarNota(turno: number, id: string, autor: string): Promise<ResultadoApagar> {
  const parte = lerIdDeNota(id);
  if (!turnoValido(turno) || !parte || autorSeguro(autor) !== autor) throw new ErroNotas('nota_invalida');
  if (parte.autor !== autor) return 'nao_e_sua';
  await garantirBucketEnsaio();
  const caminho = caminhoDaNota(turno, id);
  const nota = await baixar<NotaGravada>(caminho);
  if (!nota) return 'nao_existe';
  if (nota.autor !== autor) return 'nao_e_sua';
  const { error } = await supabase.storage.from(BUCKET_ENSAIO).remove([caminho]);
  if (error) throw new ErroNotas('remocao_falhou');
  zerarCacheNotas();
  return 'apagada';
}

// ── ler ──────────────────────────────────────────────────────────────────────

/** Todas as notas de UM turno (o histórico inteiro), da mais antiga para a mais nova. */
export async function lerNotasDoTurno(turno: number): Promise<NotaGravada[]> {
  if (!turnoValido(turno)) return [];
  await garantirBucketEnsaio();
  const nomes = (await listar(`notas/${turno}`)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).filter(n => lerIdDeNota(n));
  const lidas = await emParalelo(nomes, async id => ({ id, n: await baixar<NotaGravada>(caminhoDaNota(turno, id)) }));
  const notas: NotaGravada[] = [];
  for (const { id, n } of lidas) if (n && n.v === 1 && n.turno === turno) notas.push({ ...n, id });
  return notas.sort((a, b) => Date.parse(a.em) - Date.parse(b.em) || String(a.id).localeCompare(String(b.id)));
}

export interface IndiceDeNotas {
  /** Por turno (wa_id): a última nota de cada autor. */
  porTurno: Map<number, NotaGravada[]>;
  /** O teto de downloads cortou a leitura: os números são parciais. */
  truncado: boolean;
}

/**
 * A última nota de cada autor em cada turno com nota. Uma lista da pasta `notas/` diz quais turnos têm nota;
 * o nome do arquivo (`<autor>-<ts>`) diz qual é a mais nova de cada autor, então só ela é baixada.
 * Cache de 20 s (zerado a cada gravação ou remoção). Mais de 800 downloads: `truncado`.
 */
export async function indiceDeNotas(): Promise<IndiceDeNotas> {
  if (cacheIndice && Date.now() - cacheIndice.em < CACHE_INDICE_MS) return cacheIndice.dados;
  await garantirBucketEnsaio();
  const porTurno = new Map<number, NotaGravada[]>();
  let baixados = 0;
  let truncado = false;
  const turnos = (await listar('notas')).map(Number).filter(turnoValido);
  await emParalelo(turnos, async turno => {
    const ultimas = new Map<string, { id: string; ts: number }>();
    for (const nome of await listar(`notas/${turno}`)) {
      if (!nome.endsWith('.json')) continue;
      const id = nome.slice(0, -5);
      const p = lerIdDeNota(id);
      if (!p) continue;
      const atual = ultimas.get(p.autor);
      if (!atual || p.ts > atual.ts) ultimas.set(p.autor, { id, ts: p.ts });
    }
    const lista: NotaGravada[] = [];
    for (const { id } of ultimas.values()) {
      if (baixados >= MAX_DOWNLOADS_INDICE) { truncado = true; break; }
      baixados++;   // reservado antes do await: com vários em paralelo o teto vale igual
      const n = await baixar<NotaGravada>(caminhoDaNota(turno, id));
      if (n && n.v === 1 && n.turno === turno) lista.push({ ...n, id });
    }
    if (lista.length) porTurno.set(turno, lista);
  });
  const dados = { porTurno, truncado };
  cacheIndice = { em: Date.now(), dados };
  return dados;
}

// ── contas ───────────────────────────────────────────────────────────────────

export type ChavePersona = 'carla' | 'duda' | 'helena' | 'ninguem';
export const PRODUTO_DA_PERSONA: Record<ChavePersona, string> = {
  carla: 'SolarDoc', duda: 'Solar', helena: 'Eletroposto', ninguem: 'Sem agente',
};

export interface LinhaDoPlacar {
  persona: ChavePersona;
  produto: string;
  turnos_avaliados: number;
  avaliacoes: number;
  certos: number;
  pct_certo: number | null;
  media: number | null;
  faltam: number;
}

const arred1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Regra: a ÚLTIMA nota de cada autor em cada turno conta como uma avaliação. Um turno é "avaliado" se tem
 * ao menos uma. % certo = avaliações "certo" / avaliações. Média = média das notas. Faltam = 50 menos os turnos avaliados.
 * "Sem agente" (o porteiro calou a conversa) só aparece quando alguém avaliou um desses turnos.
 */
export function montarPlacar(porTurno: ReadonlyMap<number, readonly NotaGravada[]>): LinhaDoPlacar[] {
  const base = new Map<ChavePersona, { turnos: number; av: number; certos: number; soma: number }>();
  for (const p of ['carla', 'duda', 'helena'] as ChavePersona[]) base.set(p, { turnos: 0, av: 0, certos: 0, soma: 0 });
  for (const notas of porTurno.values()) {
    if (!notas.length) continue;
    const chave: ChavePersona = notas[0]!.persona ?? 'ninguem';
    const a = base.get(chave) ?? { turnos: 0, av: 0, certos: 0, soma: 0 };
    a.turnos++;
    for (const n of notas) { a.av++; if (n.certo) a.certos++; a.soma += n.nota; }
    base.set(chave, a);
  }
  return [...base.entries()].map(([persona, a]) => ({
    persona, produto: PRODUTO_DA_PERSONA[persona], turnos_avaliados: a.turnos, avaliacoes: a.av, certos: a.certos,
    pct_certo: a.av ? Math.round((a.certos / a.av) * 100) : null,
    media: a.av ? arred1(a.soma / a.av) : null,
    faltam: Math.max(0, META_AVALIACOES - a.turnos),
  }));
}

/** Média das notas (última de cada autor) dos turnos pedidos, e quantos têm nota. */
export function resumoDeNotas(porTurno: ReadonlyMap<number, readonly NotaGravada[]>, waIds: readonly number[]): { com_nota: number; media: number | null } {
  let turnos = 0; let n = 0; let soma = 0;
  for (const id of waIds) {
    const notas = porTurno.get(id);
    if (!notas?.length) continue;
    turnos++;
    for (const x of notas) { n++; soma += x.nota; }
  }
  return { com_nota: turnos, media: n ? arred1(soma / n) : null };
}
