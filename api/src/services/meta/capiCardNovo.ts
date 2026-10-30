// ── CAPI CARD NOVO: O TICK (29/10/2026) ──────────────────────────────────────
// Todo lead do quiz que vira card chega ao Meta. A página conta o card que ela cria
// (fbq, e a linha `pagina` em capi_conversoes_enviadas); este tick manda o Schedule
// do SERVIDOR para o que a página não contou: o card SAIU SEM MARCAR e o da Duda
// (decisão em capiCardNovoPuro.ts).
//
// Cuidados:
//   • Roda no FIM do /cron/process-messages, depois de todo tick de WhatsApp: uma
//     chamada lenta ao Graph nunca segura uma mensagem. Regra do comentário do
//     cron.ts (linha 1598): o que roda lá NÃO entra no master.
//   • Primeira rodada = só grava a marca `capi_card_novo_desde` no system_state do
//     Supabase PRINCIPAL e não envia nada. Card criado antes da marca nunca é
//     enviado (os cards 1712, 1714, 1717 e 1718 já foram tratados à mão).
//   • Nunca lança. Até 10 envios por rodada, teto duro de 12 s: um envio só
//     começa com pelo menos 6 s de sobra, e cada leitura espera no máximo 3 s
//     (estourou = rodada abortada sem enviar). Um evento por requisição (o Meta
//     recusa o lote com um evento de mais de 7 dias).
//   • META_TEST_EVENT_CODE ligado: nenhum dedup é gravado (o card real não pode
//     ser queimado na aba de testes; o event_id fixo deixa o Meta deduplicar).
//   • Quem já foi contado pela página antes do deploy (card lp_solar dos últimos 30
//     dias sem marca SAIU nem Duda) não recebe Schedule do servidor.
//   • Dedup só depois que o Meta aceitou, ou numa recusa definitiva (subcódigo
//     2804036, ou nenhum identificador). Qualquer outra falha volta na rodada seguinte
//     até o card passar de 6 dias.
//   • Falha de leitura em QUALQUER consulta aborta a rodada: dedup que não leu não
//     pode virar "ninguém foi enviado".
//   • CAPI_CARD_OFF=1 desliga. META_TEST_EVENT_CODE continua mandando para a aba de testes.

import { supabaseGerador } from '../../utils/supabaseGerador';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { enviarEventoMeta, normFone, type ResultadoMeta } from '../../utils/metaCapi';
import {
  DEDUP_FONE_MS, ORCAMENTO_MS, MIN_RESTANTE_MS, TETO_LEITURA_MS, escolherCardsNovos, janelaDosCards, leadIdDoQuiz, montarEventoCardNovo, recusaDefinitiva,
  core8DeCardsDaPagina, FORM_QUIZ_SOLAR, ORIGENS_ROBO, type CardCand, type Envio, type LeadQuiz,
} from './capiCardNovoPuro';
import { emModoTesteDoMeta } from './capiPagina';

export const CHAVE_DESDE = 'capi_card_novo_desde';
export const ORIGEM_CARD_NOVO = 'card_novo';
const COLUNAS_CARD = 'id, cliente_nome, cliente_telefone, cidade, status, created_by, created_at, observacao';
const COLUNAS_LEAD = 'lead_id, form_id, nome, whatsapp, cidade, field_data, created_time, agendado_id';
const LIMITE_CARDS = 200;
const LIMITE_HISTORICO = 1000; // o PostgREST corta em 1000 linhas; vem do mais novo para o mais antigo

export interface RelatorioCardNovo {
  pulado?: 'desligado';
  primeiraRodada?: boolean;
  candidatos: number;
  enviados: number;
  recusadosDefinitivos: number;
  pendentes: number;
  ignorados: Record<string, number>;
  erros: Array<{ card?: string; erro: string }>;
  /** META_TEST_EVENT_CODE ligado: quantos envios ficaram sem linha de dedup. */
  semDedupPorTeste?: number;
  /** dry: o que sairia. */
  aEnviar?: Array<{ card: number; classe: string; origem: string }>;
}

/** Leitura com teto de TETO_LEITURA_MS. Estourou: lança, e a rodada inteira é abortada sem enviar nada. */
async function lerCom<T>(q: PromiseLike<T>, rotulo: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(q),
      new Promise<never>((_, rejeita) => { timer = setTimeout(() => rejeita(new Error(`leitura de ${rotulo} passou de ${TETO_LEITURA_MS} ms`)), TETO_LEITURA_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const vazio = (): RelatorioCardNovo => ({ candidatos: 0, enviados: 0, recusadosDefinitivos: 0, pendentes: 0, ignorados: {}, erros: [] });
const desligado = (): boolean => (process.env.CAPI_CARD_OFF || '').trim() === '1';
const ehDuplicata = (msg: string | undefined): boolean => /duplicate|unique/i.test(String(msg || ''));

async function lerLeads(cards: CardCand[]): Promise<{ leads: LeadQuiz[]; erro?: string }> {
  const ids = [...new Set(cards.map(c => leadIdDoQuiz(c.cliente_telefone)).filter((x): x is string => !!x))];
  const cardIds = cards.map(c => c.id);
  const [porId, porCard] = await Promise.all([
    ids.length ? lerCom(supabaseGerador.from('leads_meta').select(COLUNAS_LEAD).eq('form_id', FORM_QUIZ_SOLAR).in('lead_id', ids), 'leads_meta') : Promise.resolve({ data: [], error: null }),
    cardIds.length ? lerCom(supabaseGerador.from('leads_meta').select(COLUNAS_LEAD).eq('form_id', FORM_QUIZ_SOLAR).in('agendado_id', cardIds), 'leads_meta') : Promise.resolve({ data: [], error: null }),
  ]);
  const erro = porId.error || porCard.error;
  if (erro) return { leads: [], erro: String(erro.message || erro) };
  const mapa = new Map<string, LeadQuiz>();
  for (const l of [...(porId.data ?? []), ...(porCard.data ?? [])] as LeadQuiz[]) mapa.set(String(l.lead_id), l);
  return { leads: [...mapa.values()] };
}

/** Quem já tem Schedule: por card (`ag_<id>`) e por pessoa nos últimos 30 dias (qualquer card, qualquer origem). */
async function lerDedup(cards: CardCand[], leads: LeadQuiz[], agoraMs: number): Promise<{ cardsComSchedule: Set<number>; fonesComSchedule: Set<string>; erro?: string }> {
  const agIds = cards.map(c => `ag_${c.id}`);
  const core8s = [...new Set([
    ...cards.map(c => normFone(c.cliente_telefone)?.slice(-8)),
    ...leads.map(l => normFone(l.whatsapp)?.slice(-8)),
  ].filter((x): x is string => !!x))];
  const desde = new Date(agoraMs - DEDUP_FONE_MS).toISOString();
  const [porCard, porFone] = await Promise.all([
    lerCom(supabaseGerador.from('capi_conversoes_enviadas').select('lead_id').eq('event_name', 'Schedule').in('lead_id', agIds), 'dedup por card'),
    // enviado_em: a coluna de data da tabela (conferida em 30/10/2026; created_at nao existe nela).
    lerCom(supabaseGerador.from('capi_conversoes_enviadas').select('telefone_core8').eq('event_name', 'Schedule').in('telefone_core8', core8s).gte('enviado_em', desde), 'dedup por telefone'),
  ]);
  const erro = porCard.error || porFone.error;
  if (erro) return { cardsComSchedule: new Set(), fonesComSchedule: new Set(), erro: String(erro.message || erro) };
  return {
    cardsComSchedule: new Set((porCard.data ?? []).map(r => Number(String(r.lead_id).replace(/^ag_/, ''))).filter(Number.isFinite)),
    fonesComSchedule: new Set((porFone.data ?? []).map(r => String(r.telefone_core8))),
  };
}

async function gravarDedup(e: Envio, r: ResultadoMeta, definitiva: boolean, rel: RelatorioCardNovo): Promise<void> {
  // META_TEST_EVENT_CODE ligado: o evento foi para a aba de testes. Sem linha de dedup, o card real ainda sai quando o código for tirado.
  if (emModoTesteDoMeta()) { rel.semDedupPorTeste = (rel.semDedupPorTeste ?? 0) + 1; return; }
  const { error } = await supabaseGerador.from('capi_conversoes_enviadas').insert({
    lead_id: `ag_${e.card.id}`,
    telefone_core8: e.core8,
    cliente_nome: e.card.cliente_nome ?? null,
    valor: null,
    origem: ORIGEM_CARD_NOVO,
    event_name: 'Schedule',
    meta_status: r.status,
    meta_received: r.ok ? (r.recebidos ?? null) : 0,
    ...(definitiva ? { meta_error: String(r.erro || 'recusa definitiva').slice(0, 200) } : {}),
  });
  if (error && !ehDuplicata(error.message)) {
    // O Meta já recebeu: sem o dedup o card sai de novo (o event_id fixo deixa o Meta descartar, mas o dono precisa saber).
    rel.erros.push({ card: `ag_${e.card.id}`, erro: `dedup insert: ${error.message}` });
    logger.error('capi-card-novo', 'dedup insert falhou', error);
  }
}

export async function runCapiCardNovo(opts: { dry?: boolean } = {}): Promise<RelatorioCardNovo> {
  const inicio = Date.now();
  const dry = !!opts.dry;
  const rel = vazio();
  try {
    if (desligado() && !dry) { rel.pulado = 'desligado'; return rel; }

    // 1) A marca de corte (system_state do banco PRINCIPAL, o mesmo padrão do clientes_quentes_baseline).
    const { data: marca, error: erroMarca } = await lerCom(supabase.from('system_state').select('value').eq('key', CHAVE_DESDE).maybeSingle(), 'a marca');
    if (erroMarca) { rel.erros.push({ erro: `ler a marca: ${erroMarca.message}` }); return rel; }
    const desdeMs = Date.parse(String((marca?.value as { desde?: string } | null)?.desde ?? ''));
    if (!Number.isFinite(desdeMs)) {
      rel.primeiraRodada = true;
      if (dry) return rel;
      const agora = new Date(inicio).toISOString();
      const { error } = await supabase.from('system_state').upsert({ key: CHAVE_DESDE, value: { desde: agora }, updated_at: agora }, { onConflict: 'key' });
      if (error) { rel.erros.push({ erro: `gravar a marca: ${error.message}` }); return rel; }
      logger.info('capi-card-novo', `marca ${CHAVE_DESDE} gravada (${agora}); cards anteriores nunca serao enviados`);
      return rel;
    }

    // 2) Os candidatos, só pela data e pela origem; o resto da regra é do módulo puro.
    const { deMs, ateMs } = janelaDosCards(inicio, desdeMs);
    if (ateMs <= deMs) return rel;
    // Em paralelo: os candidatos e o histórico de 30 dias (quem a página já contou antes do deploy da linha `pagina`).
    const [{ data: cardsBrutos, error: erroCards }, { data: historico, error: erroHist }] = await Promise.all([
      lerCom(supabaseGerador.from('agendamentos').select(COLUNAS_CARD)
        .in('created_by', [...ORIGENS_ROBO])
        .gte('created_at', new Date(deMs).toISOString()).lte('created_at', new Date(ateMs).toISOString())
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(LIMITE_CARDS), 'agendamentos'),
      lerCom(supabaseGerador.from('agendamentos').select('id, cliente_nome, cliente_telefone, created_by, observacao')
        .in('created_by', [...ORIGENS_ROBO])
        .gte('created_at', new Date(inicio - DEDUP_FONE_MS).toISOString())
        .order('created_at', { ascending: false }).limit(LIMITE_HISTORICO), 'historico de cards'),
    ]);
    if (erroCards) { rel.erros.push({ erro: `ler agendamentos: ${erroCards.message}` }); return rel; }
    if (erroHist) { rel.erros.push({ erro: `ler historico de cards: ${erroHist.message}` }); return rel; }
    const cards = (cardsBrutos ?? []) as CardCand[];
    rel.candidatos = cards.length;
    if (!cards.length) return rel;

    // 3) O lead do quiz de cada card e a dedup. Falha de leitura aborta.
    const lidos = await lerLeads(cards);
    if (lidos.erro) { rel.erros.push({ erro: `ler leads_meta: ${lidos.erro}` }); return rel; }
    const dedup = await lerDedup(cards, lidos.leads, inicio);
    if (dedup.erro) { rel.erros.push({ erro: `ler dedup: ${dedup.erro}` }); return rel; }

    const sel = escolherCardsNovos({
      agoraMs: inicio, corteMs: desdeMs, cards, leads: lidos.leads,
      cardsComSchedule: dedup.cardsComSchedule, fonesComSchedule: dedup.fonesComSchedule,
      fonesDePaginaAntiga: core8DeCardsDaPagina((historico ?? []) as CardCand[]),
    });
    rel.ignorados = sel.ignorados;
    if (!sel.enviar.length) return rel;

    if (dry) {
      rel.aEnviar = sel.enviar.map(e => ({ card: e.card.id, classe: e.classe, origem: montarEventoCardNovo(e, inicio).origem }));
      return rel;
    }

    // 4) Um evento por requisição, com o relógio olhado antes de cada um.
    let feitos = 0;
    for (const e of sel.enviar) {
      // Só começa um envio com pelo menos MIN_RESTANTE_MS de sobra no teto de ORCAMENTO_MS (o envio tem 6 s de timeout próprio).
      if (Date.now() - inicio > ORCAMENTO_MS - MIN_RESTANTE_MS) break;
      feitos++;
      const ev = montarEventoCardNovo(e, Date.now());
      const r = await enviarEventoMeta(ev);
      if (r.ok) { rel.enviados++; await gravarDedup(e, r, false, rel); continue; }
      if (recusaDefinitiva(r)) { rel.recusadosDefinitivos++; await gravarDedup(e, r, true, rel); continue; }
      rel.erros.push({ card: `ag_${e.card.id}`, erro: r.erro || `http_${r.status}` });
    }
    rel.pendentes = sel.enviar.length - feitos;
    if (rel.enviados) logger.info('capi-card-novo', `${rel.enviados} Schedule(s) de card novo enviados ao Meta`, { pendentes: rel.pendentes });
  } catch (err) {
    logger.error('capi-card-novo', 'rodada falhou', err);
    rel.erros.push({ erro: String((err as Error)?.message || err) });
  }
  return rel;
}
