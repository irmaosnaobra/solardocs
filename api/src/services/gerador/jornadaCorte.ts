// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, VENDAS FINALIZADAS (05/11/2026). Por ordem do dono, os clientes que já existiam passam a aparecer como FINALIZADOS:
// "trata todos os clientes existentes hoje como finalizados, não vamos corrigir todos e vamos organizar de hoje pra frente".
//
//   - O CORTE: o momento da primeira leitura depois do deploy, gravado UMA vez em `system_state`, chave `jornada_corte`, por INSERT com chave
//     única (nunca upsert). O valor é uma data ISO simples (não depende de segredo nenhum). Se o valor gravado for ilegível, a regra se comporta como
//     `JORNADA_FINALIZADAS_OFF`: ninguém é finalizado, só o CÓDIGO vai ao log, e nada devolve 503 nem derruba escrita ou robô.
//   - FINALIZADA = venda solar vendida ANTES do corte, sem trabalho de gente na jornada até o corte e sem dinheiro lançado. Nada é gravado por venda:
//     é uma conta. A DATA DA VENDA vem do estado (`vendido_em`) e, sem ele, do histórico do card (a linha "→ VENDIDO") e, sem ela, do `created_at`.
//     Sem nenhuma data, a venda fica ATIVA: nunca se finaliza calado.
//   - A venda com evento de etapa de GENTE até o corte continua ativa. Evento depois do corte NÃO a reabre (efeito colateral de upload, Trello ou
//     número não pode devolver uma venda antiga à cobrança): só o "Trazer para a jornada" do ADM, que grava o evento `trazida`.
//   - Obra com lançamento VIVO de dinheiro (não apagado, não estorno e não estornado) também é trabalho de gente: não é finalizada.
//
// Serviço puro de rota (sem importar rota). Nada aqui põe nome, telefone ou valor em log.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { ErroJornada, lerJornadaComVersao } from './jornadaSolarBanco';
import { lerObraComVersao } from './jornadaObraBanco';
import { lerCardsComDinheiroVivo, lerLancamentosDaObra } from './jornadaDinheiroBanco';
import { temDinheiroVivo } from './jornadaDinheiro';
import { POR_QUE_NAO_E_GENTE, type EstadoJornada } from './jornadaSolar';
import type { EstadoObra } from './jornadaObra';

export const CHAVE_CORTE = 'jornada_corte';

/** `JORNADA_FINALIZADAS_OFF=1` desliga a regra inteira (ninguém é finalizada e o corte nem é lido): tudo volta a como era antes. Lido a cada chamada. */
export const finalizadasDesligadas = (): boolean => process.env.JORNADA_FINALIZADAS_OFF === '1';

/** Ações do histórico que NÃO são trabalho de etapa (efeito de sistema): não seguram a venda na jornada. */
const ACOES_QUE_NAO_SAO_ETAPA: ReadonlySet<string> = new Set(['materializada', 'numero', 'numero_falhou', 'venda_completa']);

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

// ── A conta pura ────────────────────────────────────────────────────────────────────────────────────────────────────

/** O que a conta sabe de FORA do estado: a data da venda (ms; `null` = não achou) e se a obra tem dinheiro vivo lançado. */
export interface ContextoFinalizada { vendidoMs?: number | null; comDinheiro?: boolean }

/**
 * A venda é FINALIZADA? `corteMs` é o corte em milissegundos (0 ou inválido = regra desligada, ninguém é finalizada). Só é finalizada a venda cuja data é
 * ANTERIOR ao corte: a data do estado (`vendido_em`) e, sem ela, `ctx.vendidoMs`. Sem data nenhuma e sem estado, fica ATIVA. Com a marca `trazida`, com
 * dinheiro vivo lançado ou com evento de GENTE até o corte: ativa.
 */
export function ehFinalizada(js: EstadoJornada | null, jo: EstadoObra | null, corteMs: number, ctx: ContextoFinalizada = {}): boolean {
  if (finalizadasDesligadas() || !Number.isFinite(corteMs) || corteMs <= 0) return false;
  if (js?.historico.some((h) => h.acao === 'trazida')) return false;
  if (ctx.comDinheiro) return false;
  const doEstado = js?.vendido_em ? Date.parse(js.vendido_em) : NaN;
  const vendido = Number.isFinite(doEstado) ? doEstado : (typeof ctx.vendidoMs === 'number' ? ctx.vendidoMs : NaN);
  if (Number.isFinite(vendido)) { if (vendido >= corteMs) return false; } else if (!js) return false;
  const eventos = [...(js?.historico ?? []), ...(jo?.historico ?? [])];
  for (const h of eventos) {
    if (ACOES_QUE_NAO_SAO_ETAPA.has(h.acao) || POR_QUE_NAO_E_GENTE.has(h.por)) continue;
    const t = Date.parse(h.em);
    if (Number.isFinite(t) && t <= corteMs) return false;
  }
  return true;
}

// ── A data da venda, do card ────────────────────────────────────────────────────────────────────────────────────────

const RE_CABECALHO = /\[(\d{1,2})\/(\d{1,2}) (\d{1,2})h(\d{2})[^\]\n]*\]/g;
const RE_VENDIDO = /→\s*VENDIDO\b/i;

/**
 * A data (ms) em que o card virou VENDIDO, lida do `historico` dele (a linha `[dd/mm HHhMM · quem] ... Status: A → VENDIDO.`, que o Vendido e o
 * crmAtualizarStatus gravam no TOPO), no horário de Brasília. A linha NÃO tem ano: percorre as linhas da mais antiga para a mais nova, começando no ano
 * do `created_at`, e soma um ano a cada vez que dia/mês volta. Vale a linha VENDIDO mais nova. Sem linha, o `created_at`. Sem nada, `null`.
 */
export function dataDoVendidoDoCard(historico: unknown, criadoEm: unknown, agoraMs: number = Date.now()): number | null {
  const criado = typeof criadoEm === 'string' ? Date.parse(criadoEm) : NaN;
  const texto = typeof historico === 'string' ? historico : '';
  const achados: Array<{ i: number; dd: number; mm: number; h: number; mi: number; fim: number }> = [];
  for (const m of texto.matchAll(RE_CABECALHO)) {
    const i = m.index ?? 0;
    achados.push({ i, dd: Number(m[1]), mm: Number(m[2]), h: Number(m[3]), mi: Number(m[4]), fim: i + m[0].length });
  }
  let ano = Number.isFinite(criado) ? new Date(criado).getUTCFullYear() : new Date(agoraMs).getUTCFullYear();
  let melhor: number | null = null;
  let anterior = -1;
  for (let k = achados.length - 1; k >= 0; k--) {
    const a = achados[k];
    if (a.mm < 1 || a.mm > 12 || a.dd < 1 || a.dd > 31 || a.h > 23 || a.mi > 59) continue;
    const chave = a.mm * 100 + a.dd;
    if (anterior !== -1 && chave < anterior) ano++;
    anterior = chave;
    const resto = texto.slice(a.fim, k + 1 < achados.length ? achados[k + 1].i : undefined);
    if (RE_VENDIDO.test(resto)) {
      const ms = Date.UTC(ano, a.mm - 1, a.dd, a.h + 3, a.mi);   // o relógio da linha é o de Brasília (UTC-3)
      if (Number.isFinite(ms) && ms <= agoraMs + 36 * 3_600_000) melhor = ms;   // o laço vai do mais antigo ao mais novo: a última vale
    }
  }
  if (melhor !== null) return melhor;
  return Number.isFinite(criado) ? criado : null;
}

const TTL_DATAS_MS = 10 * 60_000;
const LOTE_DATAS = 100;
const cacheDatas = new Map<number, { ms: number | null; ate: number }>();
/** Para o Vendido (a venda acabou de acontecer) e para os testes. */
export function esquecerDataDoVendido(card?: number): void { if (card === undefined) cacheDatas.clear(); else cacheDatas.delete(card); }

/**
 * A data da venda de cada card (ms, ou `null`), lida de `agendamentos` (`created_at` e `historico`; a tabela NÃO tem coluna de data do status) em lotes
 * e guardada 10 min em memória (só o que leu com sucesso). Falha de leitura lança `ErroJornada`: quem chama trata como "não sei".
 */
export async function datasDoVendido(ids: readonly number[]): Promise<Map<number, number | null>> {
  const saida = new Map<number, number | null>();
  const agora = Date.now();
  const faltam: number[] = [];
  for (const id of new Set(ids.filter((n) => Number.isInteger(n) && n > 0))) {
    const c = cacheDatas.get(id);
    if (c && c.ate > agora) saida.set(id, c.ms); else faltam.push(id);
  }
  const lotes: number[][] = [];
  for (let i = 0; i < faltam.length; i += LOTE_DATAS) lotes.push(faltam.slice(i, i + LOTE_DATAS));
  const lidos = await Promise.all(lotes.map(async (lote) => {
    const { data, error } = await supabaseGerador.from('agendamentos').select('id, created_at, historico').in('id', lote);
    if (error) throw new ErroJornada(codigoDe(error));
    if (!Array.isArray(data)) throw new ErroJornada('cards');
    return data as unknown as Array<{ id: number; created_at?: string | null; historico?: string | null }>;
  }));
  for (const r of lidos.flat()) {
    if (!r || !Number.isInteger(r.id)) continue;
    const ms = dataDoVendidoDoCard(r.historico, r.created_at, agora);
    cacheDatas.set(r.id, { ms, ate: agora + TTL_DATAS_MS });
    saida.set(r.id, ms);
  }
  return saida;
}

// ── O corte gravado ─────────────────────────────────────────────────────────────────────────────────────────────────

const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * O corte (ms) do `value` do banco, ou null se ilegível. Vale a data ISO simples (o formato novo) e, para um corte que já tenha sido gravado com a
 * assinatura antiga (`{ v, em, sig }`), a data `em` dele. A assinatura não é conferida: o corte não depende de segredo nenhum.
 */
export function corteDoValor(value: unknown): number | null {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const texto = typeof value === 'string' ? value : (o && typeof o.em === 'string' ? o.em : '');
  if (!RE_ISO.test(texto)) return null;
  const t = Date.parse(texto);
  // Corte no futuro é recusado: senão uma data gravada à frente finalizaria as vendas novas.
  // A folga de 5 minutos cobre diferença de relógio entre instâncias.
  return Number.isFinite(t) && t > 0 && t <= Date.now() + 5 * 60_000 ? t : null;
}

let guardado: number | null = null;
let voando: Promise<number> | null = null;
let ilegivelAte = 0;
/** Para os testes. */
export function reiniciarCorte(): void { guardado = null; voando = null; ilegivelAte = 0; esquecerDataDoVendido(); }

async function lerLinha(): Promise<unknown | undefined> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', CHAVE_CORTE).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  return data ? (data as { value?: unknown }).value ?? null : undefined;
}

async function lerOuGravar(): Promise<number> {
  for (let volta = 0; volta < 3; volta++) {
    const lida = await lerLinha();
    if (lida !== undefined) {
      const t = corteDoValor(lida);
      if (t === null) {
        // Valor ilegível: a regra se desliga (ninguém é finalizado). Só o código vai ao log, e só uma vez por minuto.
        console.error('[jornada-solar] corte corte_invalido');
        ilegivelAte = Date.now() + 60_000;
        return 0;
      }
      return t;
    }
    const em = new Date().toISOString();
    const { error } = await supabase.from('system_state').insert({ key: CHAVE_CORTE, value: em, updated_at: em });
    if (!error) return Date.parse(em);
    // Perdeu a corrida (chave única): lê o que o outro gravou. Qualquer outro erro lança.
    if (codigoDe(error) !== '23505') throw new ErroJornada(codigoDe(error));
  }
  throw new ErroJornada('corte_ocupado');
}

/**
 * O corte em milissegundos; 0 quando a regra está desligada ou o valor gravado é ilegível (ninguém é finalizado). Preguiçoso (nunca no boot), com uma
 * leitura só por vez no processo; só guarda em memória o corte lido ou gravado com sucesso. Falha do BANCO lança `ErroJornada`: quem chama trata como
 * "não sei" (robô não envia; rota de escrita não grava).
 */
export async function lerCorte(): Promise<number> {
  if (finalizadasDesligadas()) return 0;
  if (guardado !== null) return guardado;
  if (Date.now() < ilegivelAte) return 0;
  if (!voando) {
    voando = lerOuGravar().then((t) => { if (t > 0) guardado = t; return t; }).finally(() => { voando = null; });
  }
  return voando;
}

// ── A conta de uma venda, com o que ela precisa de fora ─────────────────────────────────────────────────────────────

/**
 * O contexto de muitas vendas de uma vez (a lista e os robôs): a data da venda dos cards cujo estado não a tem e o conjunto dos cards com dinheiro vivo.
 * Com a regra desligada nada é lido. Falha de leitura lança `ErroJornada`.
 */
export async function lerContextoDasVendas(
  ids: readonly number[], jornadas: ReadonlyMap<number, EstadoJornada>, corte: number,
): Promise<(card: number) => ContextoFinalizada> {
  if (finalizadasDesligadas() || corte <= 0) return () => ({});
  const [datas, vivos] = await Promise.all([
    datasDoVendido(ids.filter((id) => !jornadas.get(id)?.vendido_em)),
    lerCardsComDinheiroVivo(),
  ]);
  return (card) => ({ vendidoMs: datas.get(card) ?? null, comDinheiro: vivos.has(card) });
}

/** Esta venda é finalizada agora? Lê o corte, os dois estados, a data da venda e o dinheiro dela. Falha de leitura lança. */
export async function obraFinalizada(card: number): Promise<boolean> {
  if (finalizadasDesligadas()) return false;
  const [corte, { estado: js }, { estado: jo }] = await Promise.all([lerCorte(), lerJornadaComVersao(card), lerObraComVersao(card)]);
  if (corte <= 0) return false;
  const [datas, { lancamentos }] = await Promise.all([
    js?.vendido_em ? Promise.resolve(new Map<number, number | null>()) : datasDoVendido([card]),
    lerLancamentosDaObra(card),
  ]);
  return ehFinalizada(js, jo, corte, { vendidoMs: datas.get(card) ?? null, comDinheiro: temDinheiroVivo(lancamentos) });
}

export const MSG_FINALIZADA = 'Esta venda está finalizada. Ela abre só para leitura; o administrador pode trazê-la para a jornada.';
