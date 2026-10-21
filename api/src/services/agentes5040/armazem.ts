// ─────────────────────────────────────────────────────────────────────────────
// ARMAZÉM DO ENSAIO. Bucket PRIVADO `ensaio-5040` no banco PRINCIPAL (utils/supabase.ts).
// A conversa, os rascunhos das agentes e o cache de mídia moram SÓ aqui: nenhum texto de
// lead vai para system_state, log ou rota sem login.
//
//  · turnos/<diaBRT>/<hmacChave>/<waIdUltimo>.json: UM objeto por turno. Gravado com
//    upsert:false (nunca lê e regrava); "já existe" conta como "já gravado", não como erro.
//  · midia/<waId>.json: cache da mídia lida (a URL do WhatsApp morre).
//  · notas/...: do painel (A3), fora deste arquivo.
//  · `hmacChave` = HMAC da chave do contato (hmac.ts). Sem segredo, nada é gravado.
//
// Bucket público é erro (o arquivo ficaria aberto a quem soubesse o caminho). `list()` devolve
// vazio para bucket que não existe: por isso `garantirBucketEnsaio` roda ANTES de qualquer list.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { diaBRT } from './relogio';
import type { BlocoMidia } from './midia';
import type { SaidaAgente } from './tipos';

export const BUCKET_ENSAIO = 'ensaio-5040';
const LIMITE_BYTES = 10 * 1024 * 1024;
const TETO_OBJETO_MIDIA = 8 * 1024 * 1024;
const PAGINA_LISTA = 100;
const MAX_PAGINAS_LISTA = 50;

export class ErroArmazem extends Error {
  constructor(readonly codigo: string) {
    super(`armazem: ${codigo}`);
    this.name = 'ErroArmazem';
  }
}

// ── o turno gravado ──────────────────────────────────────────────────────────

export interface MsgGravada {
  id: number;
  autor: 'lead' | 'robo' | 'equipe';
  tipo: string;
  texto: string | null;
  momento: string;
}

export interface UsoGravado { entrada: number; cache_criado: number; cache_lido: number; saida: number }

/** O que vai no JSON de um turno. Sem telefone: a chave é o HMAC. */
export interface TurnoGravado {
  v: 1;
  origem: 'vivo' | 'replay';
  /** Dia de Brasília da última mensagem do lead (ou da abertura). */
  dia: string;
  hmac: string;
  /** id (wa_mensagens) da última mensagem do bloco do lead; da primeira nossa, na abertura. */
  wa_id: number;
  /** Momento (ISO) dessa mensagem. */
  momento: string;
  kind: 'resposta' | 'abertura';
  /** Quem respondeu no porteiro (carla, duda, helena, giovanna_suporte) ou null. */
  dona: string | null;
  passo: number | 'falha';
  motivo_porteiro: string;
  /** Persona que chamou o modelo (null = porteiro barrou, nenhuma chamada). */
  persona: 'carla' | 'duda' | 'helena' | null;
  falou: boolean;
  /** Preenchidos quando falou=true. */
  bolhas: string[];
  acao: string | null;
  peca: SaidaAgente['peca'];
  dados: Record<string, string>;
  resumo: string | null;
  /** Por que a agente calou (trava, falta de contexto, IA fora, porteiro). */
  motivo_silencio: string | null;
  reescrita: string[] | null;
  modelo: string | null;
  uso: UsoGravado | null;
  qualificado: boolean | null;
  /** A pergunta do porteiro (passo 7), quando for o caso. */
  pergunta_porteiro: string | null;
  /** O bloco do lead que originou o turno. */
  entrada: MsgGravada[];
  n_historico: number;
  /** O que foi respondido de verdade depois (replay, e ao vivo quando já houve resposta). */
  real: MsgGravada[] | null;
  gravado_em: string;
  /** Só na rodada viva (Fase B): a fala saiu de verdade? Ausente no ensaio e no replay. */
  enviado?: boolean;
}

export type ResultadoGravacao = 'gravado' | 'ja_existia';

// ── bucket ───────────────────────────────────────────────────────────────────

let bucketOkAte = 0;

const naoAchou = (e: { message?: string; statusCode?: string | number; status?: number } | null | undefined): boolean => {
  const m = String(e?.message ?? '').toLowerCase();
  const c = String(e?.statusCode ?? e?.status ?? '');
  return c === '404' || m.includes('not found') || m.includes('does not exist');
};

const jaExiste = (e: { message?: string; statusCode?: string | number; status?: number } | null | undefined): boolean => {
  const m = String(e?.message ?? '').toLowerCase();
  const c = String(e?.statusCode ?? e?.status ?? '');
  return c === '409' || m.includes('already exists') || m.includes('duplicate');
};

/**
 * Garante o bucket PRIVADO. getBucket primeiro (o list() mente sobre bucket inexistente); cria só
 * quando o erro é claro de "não existe". Público = erro. O resultado bom vale 60 s.
 */
export async function garantirBucketEnsaio(): Promise<void> {
  if (Date.now() < bucketOkAte) return;
  const { data, error } = await supabase.storage.getBucket(BUCKET_ENSAIO);
  if (!error && data) {
    if (data.public) throw new ErroArmazem('bucket_publico');
    bucketOkAte = Date.now() + 60_000;
    return;
  }
  if (!error || !naoAchou(error)) throw new ErroArmazem('bucket_erro');
  const { error: eCria } = await supabase.storage.createBucket(BUCKET_ENSAIO, {
    public: false, fileSizeLimit: LIMITE_BYTES, allowedMimeTypes: ['application/json'],
  });
  if (eCria) {
    // Outra chamada pode ter criado no mesmo instante: confere de novo antes de desistir.
    const { data: d2, error: e2 } = await supabase.storage.getBucket(BUCKET_ENSAIO);
    if (e2 || !d2) throw new ErroArmazem('bucket_nao_criou');
    if (d2.public) throw new ErroArmazem('bucket_publico');
  }
  bucketOkAte = Date.now() + 60_000;
}

/** Zera o cache do bucket (testes). */
export function zerarCacheArmazem(): void { bucketOkAte = 0; }

// ── caminhos ─────────────────────────────────────────────────────────────────

export const caminhoDoTurno = (dia: string, hmac: string, waId: number): string => `turnos/${dia}/${hmac}/${waId}.json`;
export const caminhoDaMidia = (waId: number): string => `midia/${waId}.json`;

const hmacValido = (h: string): boolean => /^[0-9a-f]{64}$/.test(h);
const diaValido = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d);

// ── gravar ───────────────────────────────────────────────────────────────────

async function subir(caminho: string, corpo: string): Promise<ResultadoGravacao> {
  const { error } = await supabase.storage.from(BUCKET_ENSAIO)
    .upload(caminho, Buffer.from(corpo, 'utf8'), { contentType: 'application/json', upsert: false });
  if (!error) return 'gravado';
  if (jaExiste(error)) return 'ja_existia';
  throw new ErroArmazem('upload_falhou');
}

/** Um objeto por turno, sem ler e regravar. "Já existe" = já gravado. Lança ErroArmazem em falha de verdade. */
export async function gravarTurno(t: TurnoGravado): Promise<ResultadoGravacao> {
  if (!hmacValido(t.hmac) || !diaValido(t.dia) || !Number.isInteger(t.wa_id)) throw new ErroArmazem('turno_invalido');
  await garantirBucketEnsaio();
  return subir(caminhoDoTurno(t.dia, t.hmac, t.wa_id), JSON.stringify(t));
}

// ── ler ──────────────────────────────────────────────────────────────────────

async function baixarJson<T>(caminho: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET_ENSAIO).download(caminho);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()) as T; } catch { return null; }
}

/** Lista TODA uma pasta (paginada: o storage devolve de 100 em 100). */
async function listarPasta(prefixo: string): Promise<Array<{ name: string }>> {
  const out: Array<{ name: string }> = [];
  for (let p = 0; p < MAX_PAGINAS_LISTA; p++) {
    const { data, error } = await supabase.storage.from(BUCKET_ENSAIO)
      .list(prefixo, { limit: PAGINA_LISTA, offset: p * PAGINA_LISTA, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new ErroArmazem('lista_falhou');
    const lote = (data ?? []) as Array<{ name: string }>;
    out.push(...lote);
    if (lote.length < PAGINA_LISTA) break;
  }
  return out;
}

const DIAS_PADRAO = 14;

/** Os dias (YYYY-MM-DD) com turnos, dos mais recentes, no máximo `dias`. */
async function diasComTurnos(dias: number): Promise<string[]> {
  const todos = (await listarPasta('turnos')).map(x => x.name).filter(diaValido).sort().reverse();
  return todos.slice(0, Math.max(1, dias));
}

/** Todos os turnos de uma conversa (por HMAC), dos últimos `dias` dias, do mais antigo ao mais novo. */
export async function lerTurnos(hmac: string, dias = DIAS_PADRAO): Promise<TurnoGravado[]> {
  if (!hmacValido(hmac)) return [];
  await garantirBucketEnsaio();
  return lerTurnosNosDias(hmac, await diasComTurnos(dias));
}

/** Os turnos de uma conversa nos dias dados (YYYY-MM-DD). O replay usa os dias da época, que podem ser antigos. */
export async function lerTurnosNosDias(hmac: string, diasLista: readonly string[]): Promise<TurnoGravado[]> {
  if (!hmacValido(hmac)) return [];
  await garantirBucketEnsaio();
  const turnos: TurnoGravado[] = [];
  for (const dia of [...new Set(diasLista)].filter(diaValido)) {
    for (const f of await listarPasta(`turnos/${dia}/${hmac}`)) {
      const t = await baixarJson<TurnoGravado>(`turnos/${dia}/${hmac}/${f.name}`);
      if (t && t.v === 1) turnos.push(t);
    }
  }
  return turnos.sort((a, b) => Date.parse(a.momento) - Date.parse(b.momento) || a.wa_id - b.wa_id);
}

export interface ConversaListada {
  hmac: string;
  dia: string;
  /** Dia (BRT) do turno mais antigo visto na janela lida. */
  primeiro_dia: string;
  /** Os wa_id dos turnos vistos (nome dos arquivos). O painel cruza com as notas. */
  wa_ids: number[];
  turnos: number;
  ultimo: Pick<TurnoGravado, 'wa_id' | 'momento' | 'origem' | 'persona' | 'dona' | 'falou'>;
  /**
   * A agente que ficou com a conversa: a persona do último turno que teve uma. Quando o turno mais novo foi barrado
   * pelo porteiro (humano entrou, por exemplo), olha até 3 turnos para trás. null = nenhum dos lidos teve persona.
   */
  persona_conversa: TurnoGravado['persona'];
}

const RECUOS_PERSONA = 3;

/**
 * As conversas ensaiadas nos últimos `dias` dias. `origem` filtra pelo último turno de cada uma.
 * Lê só o turno mais recente de cada conversa (um download por conversa), até `max` conversas.
 */
export async function listarConversas(
  opts: { dias?: number; origem?: 'vivo' | 'replay'; max?: number } = {},
): Promise<ConversaListada[]> {
  await garantirBucketEnsaio();
  const max = opts.max ?? 200;
  const achadas = new Map<string, { dia: string; primeiro: string; arquivos: string[]; pares: Array<{ dia: string; id: number }> }>();
  dias: for (const dia of await diasComTurnos(opts.dias ?? DIAS_PADRAO)) {
    for (const pasta of await listarPasta(`turnos/${dia}`)) {
      if (!hmacValido(pasta.name)) continue;
      const arquivos = (await listarPasta(`turnos/${dia}/${pasta.name}`)).map(f => f.name).filter(n => n.endsWith('.json'));
      if (!arquivos.length) continue;
      const atual = achadas.get(pasta.name);
      // Dias vêm do mais novo ao mais velho: o primeiro dia visto é o do último turno; só soma a contagem.
      const pares = arquivos.map(n => ({ dia, id: Number(n.replace('.json', '')) })).filter(x => Number.isFinite(x.id));
      if (atual) { atual.arquivos.push(...arquivos); atual.primeiro = dia; atual.pares.push(...pares); } else achadas.set(pasta.name, { dia, primeiro: dia, arquivos, pares });
      if (achadas.size >= max * 3) break dias;
    }
  }
  const saida: ConversaListada[] = [];
  for (const [hmac, { dia, primeiro, arquivos, pares }] of achadas) {
    const recentes = [...pares].sort((a, b) => b.id - a.id);
    const maisNovo = recentes[0];
    if (maisNovo === undefined) continue;
    const t = await baixarJson<TurnoGravado>(caminhoDoTurno(maisNovo.dia, hmac, maisNovo.id));
    if (!t) continue;
    if (opts.origem && t.origem !== opts.origem) continue;
    let personaConversa = t.persona;
    for (let i = 1; personaConversa === null && i <= RECUOS_PERSONA && i < recentes.length; i++) {
      const antes = await baixarJson<TurnoGravado>(caminhoDoTurno(recentes[i]!.dia, hmac, recentes[i]!.id));
      if (antes) personaConversa = antes.persona;
    }
    saida.push({
      persona_conversa: personaConversa,
      hmac, dia, primeiro_dia: primeiro, wa_ids: arquivos.map(n => Number(n.replace('.json', ''))).filter(Number.isFinite), turnos: arquivos.length,
      ultimo: { wa_id: t.wa_id, momento: t.momento, origem: t.origem, persona: t.persona, dona: t.dona, falou: t.falou },
    });
    if (saida.length >= max) break;
  }
  return saida.sort((a, b) => Date.parse(b.ultimo.momento) - Date.parse(a.ultimo.momento));
}

// ── cache de mídia ───────────────────────────────────────────────────────────

/** Só vale guardar o que foi lido de verdade (marcador "[audio]" não é leitura). */
export const valeGuardar = (b: BlocoMidia): boolean => !(b.tipo === 'texto' && /^\[[^\]]*\]$/.test(b.texto.trim()));

/** Lê do bucket o cache das mídias pedidas (por id de wa_mensagens). Erro de leitura = sem cache. */
export async function lerMidiaCache(ids: readonly number[]): Promise<Map<number, BlocoMidia>> {
  const cache = new Map<number, BlocoMidia>();
  if (!ids.length) return cache;
  try {
    await garantirBucketEnsaio();
    for (const id of ids) {
      const b = await baixarJson<BlocoMidia>(caminhoDaMidia(id));
      if (b && b.msgId === id) cache.set(id, b);
    }
  } catch { /* sem cache: a mídia é lida de novo */ }
  return cache;
}

/** Guarda a mídia lida. Já existe ou grande demais = ignora. Nunca lança. */
export async function gravarMidiaCache(b: BlocoMidia): Promise<void> {
  try {
    if (!valeGuardar(b)) return;
    const corpo = JSON.stringify(b);
    if (corpo.length > TETO_OBJETO_MIDIA) return;
    await garantirBucketEnsaio();
    await subir(caminhoDaMidia(b.msgId), corpo);
  } catch { /* cache é conforto, não requisito */ }
}

// ── sonda ────────────────────────────────────────────────────────────────────

export interface RelatorioSonda {
  ok: boolean;
  privado: boolean;
  passos: Record<string, boolean>;
  erro?: string;
}

/** Escreve, lê, lista e apaga um objeto de teste, e confirma que o bucket é privado. */
export async function sondarArmazem(agora: Date = new Date()): Promise<RelatorioSonda> {
  const passos: Record<string, boolean> = {};
  const caminho = `sonda/${diaBRT(agora)}-${agora.getTime()}.json`;
  try {
    zerarCacheArmazem();
    await garantirBucketEnsaio();
    passos.bucket = true;
    const { data: b } = await supabase.storage.getBucket(BUCKET_ENSAIO);
    const privado = !!b && b.public === false;
    passos.privado = privado;
    passos.escreveu = (await subir(caminho, JSON.stringify({ sonda: true, em: agora.toISOString() }))) === 'gravado';
    const lido = await baixarJson<{ sonda?: boolean }>(caminho);
    passos.leu = lido?.sonda === true;
    // O mesmo caminho de novo tem que dar "já existia" (upsert:false).
    passos.nao_sobrescreve = (await subir(caminho, '{}')) === 'ja_existia';
    passos.listou = (await listarPasta('sonda')).some(f => caminho.endsWith(f.name));
    await supabase.storage.from(BUCKET_ENSAIO).remove([caminho]);
    passos.apagou = (await baixarJson(caminho)) === null;
    return { ok: Object.values(passos).every(Boolean), privado, passos };
  } catch (e) {
    return { ok: false, privado: passos.privado === true, passos, erro: e instanceof ErroArmazem ? e.codigo : 'interno' };
  } finally {
    try {
      await supabase.storage.from(BUCKET_ENSAIO).remove([caminho]);
    } catch { /* a sonda tentou apagar; o relatório já diz o que passou */ }
  }
}
