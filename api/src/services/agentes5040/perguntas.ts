// ─────────────────────────────────────────────────────────────────────────────
// PERGUNTAS EM ABERTO. O que a agente não soube responder vira uma fila; o sócio responde numa tela e a resposta
// entra no conhecimento da agente na hora, POR PRODUTO. Cada pergunta é um registro próprio em system_state:
//
//   chave  ag5040_pergunta:<produto>:<16 hex do sha1 da pergunta normalizada>
//   valor  { produto, pergunta, exemplos:[{dia,hmac,como_respondeu}] (até 5), vezes, criada_em, atualizada_em,
//            status:'aberta'|'respondida'|'ignorada', resposta?, respondida_por?, respondida_em? }
//
// Sem telefone, nome de lead nem fala do lead: o exemplo leva só o dia, o HMAC da conversa e como a AGENTE respondeu.
// O trecho literal do lead fica na nota do bucket privado (qualidade/<dia>/<hmac>.json); a tela chega nele pelo HMAC.
// O relógio da qualidade só CRIA a pergunta ou SOMA `vezes` e exemplos; pergunta respondida ou ignorada nunca reabre
// sozinha (só o sócio, pela tela).
//
// Este arquivo é lido pelo turno (a injeção no conhecimento) e pela rota do painel, então só importa supabase,
// interruptores e tipos: nada de envio, nada de IA.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { supabase } from '../../utils/supabase';
import { ligado } from './interruptores';
import type { Persona, Produto } from './tipos';

export const PREFIXO_PERGUNTA = 'ag5040_pergunta:';
export const PRODUTOS_PERGUNTA: readonly Produto[] = ['solar', 'solardoc', 'eletroposto'];
export const STATUS_PERGUNTA = ['aberta', 'respondida', 'ignorada'] as const;
export type StatusPergunta = typeof STATUS_PERGUNTA[number];

export const MAX_EXEMPLOS = 5;
export const MAX_PERGUNTA = 120;
export const MAX_COMO_RESPONDEU = 160;
export const RESPOSTA_MIN = 3;
export const RESPOSTA_MAX = 400;
const PAGINA = 1000;
const MAX_PAGINAS = 5;

export interface ExemploPergunta { dia: string; hmac: string; como_respondeu: string }

export interface Pergunta {
  produto: Produto;
  pergunta: string;
  exemplos: ExemploPergunta[];
  vezes: number;
  criada_em: string;
  atualizada_em: string;
  status: StatusPergunta;
  resposta?: string;
  respondida_por?: string;
  respondida_em?: string;
}

/** A pergunta com o id que a tela usa nas rotas (`<produto>:<16 hex>`). */
export type PerguntaComId = Pergunta & { id: string };

const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? '');

// ── a chave ──────────────────────────────────────────────────────────────────

const TRACOS = /[̀-ͯ]/g;

/** A forma que decide se duas perguntas são a mesma: minúscula, sem acento, sem pontuação, espaços colapsados. */
export function normalizarPergunta(texto: string): string {
  return String(texto ?? '').normalize('NFD').replace(TRACOS, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().slice(0, MAX_PERGUNTA);
}

export function chaveDaPergunta(produto: Produto, perguntaCurta: string): string {
  const hash = createHash('sha1').update(normalizarPergunta(perguntaCurta), 'utf8').digest('hex').slice(0, 16);
  return `${PREFIXO_PERGUNTA}${produto}:${hash}`;
}

const ID_VALIDO = /^(solar|solardoc|eletroposto):[0-9a-f]{16}$/;

export const idValido = (id: string): boolean => ID_VALIDO.test(String(id ?? ''));
export const chaveDoId = (id: string): string => `${PREFIXO_PERGUNTA}${id}`;
export const idDaChave = (chave: string): string => chave.startsWith(PREFIXO_PERGUNTA) ? chave.slice(PREFIXO_PERGUNTA.length) : chave;

export const produtoDaPersona = (p: Persona): Produto => (p === 'duda' ? 'solar' : p === 'carla' ? 'solardoc' : 'eletroposto');

// ── ler o valor gravado ──────────────────────────────────────────────────────

const texto = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** O valor bruto do banco (objeto ou texto JSON) como Pergunta. Ilegível = null. */
export function perguntaDoValor(v: unknown): Pergunta | null {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (!PRODUTOS_PERGUNTA.includes(o.produto as Produto)) return null;
  if (!STATUS_PERGUNTA.includes(o.status as StatusPergunta)) return null;
  const exemplos = (Array.isArray(o.exemplos) ? o.exemplos : []).slice(0, MAX_EXEMPLOS).map((e): ExemploPergunta => {
    const r = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    return { dia: texto(r.dia, 10), hmac: texto(r.hmac, 64), como_respondeu: texto(r.como_respondeu, MAX_COMO_RESPONDEU) };
  });
  const p: Pergunta = {
    produto: o.produto as Produto,
    pergunta: texto(o.pergunta, MAX_PERGUNTA),
    exemplos,
    vezes: Number.isFinite(Number(o.vezes)) && Number(o.vezes) > 0 ? Math.floor(Number(o.vezes)) : 1,
    criada_em: texto(o.criada_em, 40),
    atualizada_em: texto(o.atualizada_em, 40),
    status: o.status as StatusPergunta,
  };
  if (typeof o.resposta === 'string' && o.resposta.trim()) p.resposta = o.resposta.trim().slice(0, RESPOSTA_MAX);
  if (typeof o.respondida_por === 'string' && o.respondida_por) p.respondida_por = texto(o.respondida_por, 60);
  if (typeof o.respondida_em === 'string' && o.respondida_em) p.respondida_em = texto(o.respondida_em, 40);
  return p;
}

// ── o relógio cria ou soma ───────────────────────────────────────────────────

export interface NovaOcorrencia {
  produto: Produto;
  pergunta_curta: string;
  dia: string;
  hmac: string;
  como_respondeu: string;
}

export type ResultadoRegistro = 'criada' | 'somada' | 'fechada' | 'erro';

/**
 * Cria a pergunta (insert: a chave única decide a corrida) ou soma uma ocorrência na que já existe. Pergunta
 * respondida ou ignorada não muda: 'fechada'. A fusão é em SÉRIE (quem chama): ler-e-gravar não é atômico.
 */
export async function registrarPergunta(o: NovaOcorrencia, agora: Date): Promise<ResultadoRegistro> {
  const curta = texto(o.pergunta_curta, MAX_PERGUNTA);
  if (!PRODUTOS_PERGUNTA.includes(o.produto) || !normalizarPergunta(curta)) return 'erro';
  const chave = chaveDaPergunta(o.produto, curta);
  const em = agora.toISOString();
  const exemplo: ExemploPergunta = { dia: o.dia, hmac: o.hmac, como_respondeu: texto(o.como_respondeu, MAX_COMO_RESPONDEU) };
  try {
    const nova: Pergunta = { produto: o.produto, pergunta: curta, exemplos: [exemplo], vezes: 1, criada_em: em, atualizada_em: em, status: 'aberta' };
    const { error } = await supabase.from('system_state').insert({ key: chave, value: nova, updated_at: em });
    if (!error) return 'criada';
    if (codigoDe(error) !== '23505') return 'erro';
    const { data, error: eLer } = await supabase.from('system_state').select('value, updated_at').eq('key', chave).maybeSingle();
    if (eLer) return 'erro';
    const lida = data as { value?: unknown; updated_at?: string } | null;
    const atual = perguntaDoValor(lida?.value);
    if (!atual) return 'erro';
    if (atual.status !== 'aberta') return 'fechada';
    const exemplos = [...atual.exemplos];
    if (exemplos.length < MAX_EXEMPLOS) exemplos.push(exemplo);
    // Gravação CONDICIONAL: só vale se a pergunta ainda está aberta e ninguém mexeu nela desde a leitura. Se o sócio
    // respondeu no meio, nada é gravado e a resposta dele não é apagada.
    let q = supabase.from('system_state')
      .update({ value: { ...atual, exemplos, vezes: atual.vezes + 1, atualizada_em: em }, updated_at: em })
      .eq('key', chave).eq('value->>status', 'aberta');
    if (lida?.updated_at) q = q.eq('updated_at', lida.updated_at);
    const { data: gravadas, error: eGrava } = await q.select('key');
    if (eGrava) return 'erro';
    return Array.isArray(gravadas) && gravadas.length ? 'somada' : 'fechada';
  } catch {
    return 'erro';
  }
}

// ── a lista, para a tela ─────────────────────────────────────────────────────

export class ErroPerguntas extends Error {
  constructor(readonly codigo: string) { super(`perguntas: ${codigo}`); this.name = 'ErroPerguntas'; }
}

/** Todas as perguntas (ou as de um status), da mais recentemente atualizada para a mais antiga. Lança ErroPerguntas. */
export async function listarPerguntas(status?: StatusPergunta): Promise<PerguntaComId[]> {
  const out: PerguntaComId[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${PREFIXO_PERGUNTA}%`).order('key', { ascending: true }).range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new ErroPerguntas('leitura');
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const r of lote) {
      const v = perguntaDoValor(r.value);
      if (v && (!status || v.status === status)) out.push({ ...v, id: idDaChave(r.key) });
    }
    if (lote.length < PAGINA) break;
  }
  return out.sort((a, b) => Date.parse(b.atualizada_em) - Date.parse(a.atualizada_em) || (a.id < b.id ? -1 : 1));
}

async function lerUma(id: string): Promise<Pergunta | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveDoId(id)).maybeSingle();
  if (error) throw new ErroPerguntas('leitura');
  return perguntaDoValor((data as { value?: unknown } | null)?.value);
}

async function gravarUma(id: string, v: Pergunta, agora: Date): Promise<void> {
  const { error } = await supabase.from('system_state').update({ value: v, updated_at: agora.toISOString() }).eq('key', chaveDoId(id));
  if (error) throw new ErroPerguntas('gravacao');
  zerarCacheRespostasDono();
}

// ── validar a resposta do dono ───────────────────────────────────────────────

const RE_TRAVESSAO = /[—–]/;
const RE_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u20E3\uFE0F]/u;
/** Dinheiro: R$, "reais", "$", "por mês", mil e k, mensal, porcentagem, e verbo de preço (custa, sai, fica, por, a partir de) com número. */
const UNIDADE = '(?:dias?|anos?|mes(?:es)?|horas?|semanas?|minutos?|kwp?|kwh|m2|metros?|vezes|x)';
const RE_DINHEIRO = new RegExp([
  String.raw`r\s*\$`, String.raw`\$`, String.raw`\breais\b`,
  String.raw`\d[\d.,]*\s*(?:por|ao|a|\/)\s*m[eê]s\b`,          // 67 por mês
  String.raw`\d[\d.,]*\s*(?:mil|k)\b`,                          // 18 mil, 10k
  String.raw`\bmensa(?:l|is|lidade)`,                           // mensal, mensais, mensalidade
  String.raw`\d\s*%|%\s*\d`,                                    // 20%
  // custa 67, sai 1.500, fica 200, por 97, a partir de 18: número sem unidade logo depois (2 dias e 25 anos passam)
  String.raw`\b(?:custa|custam|sai|saem|fica|ficam|por|a partir de)\s+(?:de\s+)?\d[\d.,]*(?![\d.,])(?!\s*` + UNIDADE + String.raw`\b)`,
].join('|'), 'i');

/** null = pode. Senão, a frase que a tela mostra. */
export function validarResposta(bruta: unknown): string | null {
  if (typeof bruta !== 'string') return 'Escreva a resposta.';
  const t = bruta.replace(/\s+/g, ' ').trim();
  if (t.length < RESPOSTA_MIN) return `A resposta precisa ter pelo menos ${RESPOSTA_MIN} caracteres.`;
  if (t.length > RESPOSTA_MAX) return `A resposta passou de ${RESPOSTA_MAX} caracteres. Deixe mais curta.`;
  if (RE_TRAVESSAO.test(t)) return 'Tire o travessão. Use ponto ou vírgula.';
  if (RE_EMOJI.test(t)) return 'Tire o emoji. A agente fala sem figurinhas.';
  if (RE_DINHEIRO.test(t)) return 'Tire o valor em dinheiro. Preço fica no conhecimento fixo da agente, não aqui. Responda sem o número.';
  return null;
}

export type ResultadoAcao = 'ok' | 'nao_achou' | 'estado_errado';

/** Responde (ou corrige a resposta de) uma pergunta aberta, ignorada ou já respondida. */
export async function responderPergunta(id: string, resposta: string, por: string, agora: Date): Promise<ResultadoAcao> {
  const atual = await lerUma(id);
  if (!atual) return 'nao_achou';
  await gravarUma(id, {
    ...atual, status: 'respondida', resposta: resposta.replace(/\s+/g, ' ').trim(), respondida_por: por, respondida_em: agora.toISOString(),
  }, agora);
  return 'ok';
}

/** Marca uma pergunta ABERTA como ignorada. Respondida tem que ser reaberta antes. */
export async function ignorarPergunta(id: string, por: string, agora: Date): Promise<ResultadoAcao> {
  const atual = await lerUma(id);
  if (!atual) return 'nao_achou';
  if (atual.status !== 'aberta') return 'estado_errado';
  await gravarUma(id, { ...atual, status: 'ignorada', respondida_por: por, respondida_em: agora.toISOString() }, agora);
  return 'ok';
}

/** Volta a pergunta para aberta e TIRA a resposta do conhecimento. */
export async function reabrirPergunta(id: string, agora: Date): Promise<ResultadoAcao> {
  const atual = await lerUma(id);
  if (!atual) return 'nao_achou';
  if (atual.status === 'aberta') return 'estado_errado';
  const { resposta: _r, respondida_por: _p, respondida_em: _e, ...resto } = atual;
  await gravarUma(id, { ...resto, status: 'aberta' }, agora);
  return 'ok';
}

// ── injeção no conhecimento ──────────────────────────────────────────────────

export const MAX_RESPOSTAS_NO_BLOCO = 40;
export const MAX_CARACTERES_DO_BLOCO = 6000;
export const TITULO_DO_BLOCO = 'RESPOSTAS DO DONO A PERGUNTAS QUE VOCÊ NÃO SOUBE. Valem como conhecimento. Diga com as suas palavras, na bolha curta de sempre.';
const CACHE_MS = 60_000;
/** Leitura que estourou o prazo ou falhou: o cache vazio vale 30 s, para não martelar o banco em cada turno. */
const CACHE_ERRO_MS = 30_000;
/** O turno ao vivo não espera o banco mais que isto: passou, a agente segue sem o bloco. */
export const ESPERA_MAX_MS = 1500;

/** Monta o bloco: as respondidas mais novas primeiro, até 40 itens e 6000 caracteres no total. null = nada a dizer. */
export function montarBlocoDeRespostas(itens: readonly Pergunta[]): string | null {
  const prontas = itens
    .filter(p => p.status === 'respondida' && p.resposta)
    .sort((a, b) => Date.parse(b.respondida_em ?? '') - Date.parse(a.respondida_em ?? '') || 0);
  let bloco = TITULO_DO_BLOCO;
  let n = 0;
  for (const p of prontas) {
    if (n >= MAX_RESPOSTAS_NO_BLOCO) break;
    const linha = `\n- Pergunta: ${p.pergunta}\n  Resposta: ${p.resposta}`;
    if (bloco.length + linha.length > MAX_CARACTERES_DO_BLOCO) break;
    bloco += linha;
    n++;
  }
  return n ? bloco : null;
}

export interface OpcoesBloco {
  /** Lê as perguntas do produto (testes passam um falso). Lança em erro. */
  ler?: (produto: Produto) => Promise<Pergunta[]>;
  agora?: () => number;
  /** Prazo da leitura (ms). Padrão ESPERA_MAX_MS. */
  esperaMs?: number;
}

const cacheBloco = new Map<Produto, { em: number; bloco: string | null; erro: boolean }>();
/** A leitura em andamento de cada produto: turnos simultâneos esperam a MESMA consulta. */
const lendoBloco = new Map<Produto, Promise<string | null>>();
/** Sobe a cada zerada: leitura que começou antes dela não grava o cache depois. */
let geracaoBloco = 0;

/** Zera o cache de 60 s e as leituras em andamento (testes e quem acabou de gravar uma resposta). */
export function zerarCacheRespostasDono(): void { cacheBloco.clear(); lendoBloco.clear(); geracaoBloco++; }

async function lerDoProduto(produto: Produto): Promise<Pergunta[]> {
  const out: Pergunta[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase.from('system_state').select('value')
      .like('key', `${PREFIXO_PERGUNTA}${produto}:%`).order('key', { ascending: true }).range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new ErroPerguntas('leitura');
    const lote = (data ?? []) as Array<{ value: unknown }>;
    for (const r of lote) {
      const v = perguntaDoValor(r.value);
      if (v && v.produto === produto && v.status === 'respondida') out.push(v);
    }
    if (lote.length < PAGINA) break;
  }
  return out;
}

/**
 * O bloco de system com as respostas do dono para a persona (só as do produto dela), ou null. Interruptor
 * `respostas_dono` desligado = null. Cache de 60 s por produto, uma leitura compartilhada por vez. Leitura que passa
 * de 1,5 s ou que falha = null (a agente segue sem o bloco) e o cache vazio vale 30 s. NUNCA lança.
 */
export async function blocoDeRespostasDoDono(persona: Persona, opts: OpcoesBloco = {}): Promise<string | null> {
  const produto = produtoDaPersona(persona);
  const agora = opts.agora ?? Date.now;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<'prazo'>(resolve => { relogio = setTimeout(() => resolve('prazo'), opts.esperaMs ?? ESPERA_MAX_MS); });
  try {
    const r = await Promise.race([resolverBloco(produto, opts), prazo]);
    if (r === 'prazo') {
      cacheBloco.set(produto, { em: agora(), bloco: null, erro: true });
      lendoBloco.delete(produto);   // leitura travada não segura as próximas: depois dos 30 s uma nova começa
      return null;
    }
    return r;
  } catch {
    return null;
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

async function resolverBloco(produto: Produto, opts: OpcoesBloco): Promise<string | null> {
  if (!(await ligado('respostas_dono'))) return null;
  const agora = (opts.agora ?? Date.now)();
  const c = cacheBloco.get(produto);
  if (c && agora - c.em < (c.erro ? CACHE_ERRO_MS : CACHE_MS)) return c.bloco;
  let lendo = lendoBloco.get(produto);
  if (!lendo) {
    const g = geracaoBloco;
    const leitura: Promise<string | null> = (async () => {
      try {
        const bloco = montarBlocoDeRespostas(await (opts.ler ?? lerDoProduto)(produto));
        if (g === geracaoBloco) cacheBloco.set(produto, { em: agora, bloco, erro: false });
        return bloco;
      } catch {
        if (g === geracaoBloco) cacheBloco.set(produto, { em: agora, bloco: null, erro: true });
        return null;
      }
    })().finally(() => { if (lendoBloco.get(produto) === leitura) lendoBloco.delete(produto); });
    lendoBloco.set(produto, leitura);
    lendo = leitura;
  }
  return lendo;
}
