// ─────────────────────────────────────────────────────────────────────────────
// RECUPERAÇÃO PESADA DO QUIZ E DO PIX DO SOLARDOC (16/11/2026, pedido do dono, remodelada pelo chefe anti-ban).
//
// Tudo sai pelo robô da Carla (`quiz_recuperacao_5040`, recuperacaoCarla.ts): a mesma vez de 10 min, as mesmas travas, o claim por insert ANTES do envio,
// a posse, a releitura e 1 envio por rodada. Este arquivo só decide QUEM recebe QUAL toque e com QUAL forma de pagamento. Nada aqui envia.
//
// A RÉGUA (permanente, enquanto ligada): T1 (o de sempre: 15 min depois do lead, 5 min depois do Pix, abandono da LP) > T2 a partir do dia útil seguinte
// ao T1 (`quiz_rec_sent2:`) > T3 a partir do 2º dia útil depois do T2 (`quiz_rec_sent3:`). Nunca 2 no mesmo dia, nunca um 4º, fim em 7 dias corridos do T1.
// O LOTE DE RESGATE (a "lista quente", 1 toque por pessoa, fixo no código e que se desarma sozinho em `valeAte`):
//   (a) quem deixou o WhatsApp no quiz desde 14/11 06:40 UTC e não comprou, com ou sem CNPJ;
//   (b) quem gerou o Pix automático (quiz ou LP) desde 01/11, com o contrato recusado, expirado ou pendente, sem pagamento.
// Sem carimbo, o lote dá o T1; com o T1 já enviado, o T2 (a partir do dia útil seguinte), mesmo que o T1 tenha mais de 7 dias.
// Só vai ao WhatsApp quem tem lead em leads_meta (quiz ou LP): sem ele não há o Código para ler a conversa (regra 11 do chefe).
//
// O PAGAMENTO (1 forma por toque): contrato com CPF = o código do Pix automático (o vivo, ou um novo depois do claim, nunca dois vivos), sozinho na 2ª
// mensagem; sem contrato, sem CPF ou com o Asaas recusando o código (4xx) = 1 link inteiro (Pix automático na LP ou cartão em /assinar). Nunca /diagnostico.
// ─────────────────────────────────────────────────────────────────────────────

import { hmacDe } from '../agentes5040/hmac';
import { PLANO_MENSAL } from '../agentes5040/conhecimento/solardoc';
import { pagamentoValeDesde } from '../asaas/pixAutoValidade';
import { ehLeadDeTeste } from './avisoGrupoSolardoc';
import type { VendasRecentes } from './compraQuizSolardoc';
import { chaveDoTelefone, normalizarTelefoneSd } from './quizSolardoc';
import {
  ESPERA_MIN_MS, PREFIXO_CARIMBO2_REC, PREFIXO_CARIMBO3_REC, PREFIXO_CARIMBO_REC, PREFIXO_PULOU_REC, campoFd, diaBRT, faseDoCodigo, primeiroNome,
  type LeadRec, type MarcaPagto,
} from './recuperacaoCarlaRegras';
import type { FormaPesada } from './recuperacaoPesadaTextos';

export const LOTE_RESGATE = Object.freeze({
  quizDesde: '2026-11-14T06:40:00.000Z',
  contratosDesde: '2026-11-01T03:00:00.000Z',
  /** Contrato criado depois disto é da régua de sempre (o 1º toque do Pix), não do lote. */
  contratosAte: '2026-11-16T15:00:00.000Z',
  /** O lote se desarma sozinho: 7 dias corridos depois do pedido (16/11), às 20h de Brasília. */
  valeAte: '2026-11-23T23:00:00.000Z',
});
/**
 * A régua nova (T2 e T3) só vale para quem recebeu o T1 DEPOIS desta data (o momento do pedido do dono, 16/11 12h de Brasília) e para o lote de resgate.
 * Quem recebeu o T1 antes, pela régua antiga (1 toque para sempre), continua com 1 toque: não ganha T2 retroativo e a fila não passa da conta do chefe.
 */
export const REGUA_DESDE = '2026-11-16T15:00:00.000Z';
/** A régua acaba 7 dias corridos depois do T1. */
export const REGUA_FIM_MS = 7 * 24 * 3600_000;
/** O que a rodada da Carla deixa para a vaga guardada da linha (lineThrottle): { prontos, em }. Fora de BOT_SENT_PREFIXES. */
export const CHAVE_FILA_REC = 'quiz_rec_fila';
/** A recuperação pesada avisa o time UMA vez de quem tentou pagar e já tinha conversado com a linha: `quiz_aviso:<hmac>:pesada`. */
export const SUFIXO_AVISO_PESADA = ':pesada';
/**
 * Quem a rodada pulou por motivo que NÃO fica gravado (posse de outra agente, equipe na conversa, pausa, leitura que falhou) ganha `quiz_rec_adiado:<hmac>`
 * = { em } e vai para o FIM da fila por 2 h: ninguém prende a cabeça da fila (4 do lote, 3 da régua, 4 do Pix) e todo mundo do lote chega a ser avaliado.
 * Fora de BOT_SENT_PREFIXES (não é envio) e não barra ninguém: só reordena.
 */
export const PREFIXO_ADIADO_REC = 'quiz_rec_adiado:';
export const ADIADO_MS = 2 * 3600_000;
/** O lote só pega contrato que nasceu no funil (quiz ou LP): renovação, cobrança de assinante e o código pedido na conversa ficam fora. */
export const ORIGENS_LOTE: ReadonlySet<string> = new Set(['quiz_solardoc', 'lp_solardoc']);
/** A mensalidade do plano (R$ 67), a que o link mostra. O código do contrato cita o valor DELE (plano + adicionais), ou nenhum. */
export const VALOR_PLANO = PLANO_MENSAL.valor;
const LOTE_POR_RODADA = 4;
const REGUA_POR_RODADA = 3;
const AVISOS_POR_RODADA = 2;
const DIA_MS = 24 * 3600_000;

export const loteVale = (agoraMs: number): boolean => agoraMs < Date.parse(LOTE_RESGATE.valeAte);

// ── a cadência (pura) ────────────────────────────────────────────────────────

/** `posse` = o `desde` da posse que o toque usou, quando ele manteve a de um toque anterior (o 3º toque confere a posse por ela). */
export interface CarimboLido { em: string | null; estado?: string; tipo?: string; motivo?: string; posse?: string }
export interface ToquesDaPessoa { sent?: CarimboLido; sent2?: CarimboLido; sent3?: CarimboLido }
export type ProximoToque = { toque: 1 | 2 | 3; prevEm: string | null; posseEm?: string } | { toque: null; motivo: string };

/** O dia (AAAA-MM-DD de Brasília) do `n`-ésimo dia de janela da linha DEPOIS do dia de `emMs`. null = nenhum em 14 dias. */
export function diaDeJanelaApos(emMs: number, n: number, janela: (d: Date) => boolean): string | null {
  let achados = 0;
  for (let k = 1; k <= 14; k++) {
    const dia = diaBRT(emMs + k * DIA_MS);
    if (janela(new Date(`${dia}T15:00:00.000Z`)) && ++achados === n) return dia;
  }
  return null;
}

const enviado = (c: CarimboLido | undefined): c is CarimboLido & { em: string } =>
  !!c && c.estado === 'enviado' && !!c.em && Number.isFinite(Date.parse(c.em));

/**
 * O próximo toque desta pessoa, ou por que nenhum. `lote` = a pessoa está no lote de resgate (e ele vale): só ele dá o T1 por aqui (o T1 de sempre é das
 * filas antigas) e só ele dá o T2 a quem tem o T1 com mais de 7 dias. Carimbo que não saiu de verdade (`nao_saiu`, `incerto`) encerra a régua.
 */
export function proximoToquePesado(e: ToquesDaPessoa, agoraMs: number, janela: (d: Date) => boolean, opts: { lote: boolean }): ProximoToque {
  const hoje = diaBRT(agoraMs);
  if (e.sent3) return { toque: null, motivo: 'tres_toques' };
  if (e.sent2) {
    if (!enviado(e.sent2) || !enviado(e.sent)) return { toque: null, motivo: 'toque_anterior_nao_saiu' };
    if (!opts.lote && Date.parse(e.sent.em) < Date.parse(REGUA_DESDE)) return { toque: null, motivo: 'toque_anterior_a_pesada' };
    if (agoraMs - Date.parse(e.sent.em) > REGUA_FIM_MS) return { toque: null, motivo: 'fim_7_dias' };
    const dia = diaDeJanelaApos(Date.parse(e.sent2.em), 2, janela);
    if (!dia || hoje < dia) return { toque: null, motivo: 'cedo_para_o_3' };
    return { toque: 3, prevEm: e.sent2.em, posseEm: e.sent2.posse ?? e.sent2.em };
  }
  if (e.sent) {
    if (!enviado(e.sent)) return { toque: null, motivo: 'toque_anterior_nao_saiu' };
    if (!opts.lote && Date.parse(e.sent.em) < Date.parse(REGUA_DESDE)) return { toque: null, motivo: 'toque_anterior_a_pesada' };
    if (!opts.lote && agoraMs - Date.parse(e.sent.em) > REGUA_FIM_MS) return { toque: null, motivo: 'fim_7_dias' };
    const dia = diaDeJanelaApos(Date.parse(e.sent.em), 1, janela);
    if (!dia || hoje < dia) return { toque: null, motivo: 'cedo_para_o_2' };
    return { toque: 2, prevEm: e.sent.em };
  }
  return opts.lote ? { toque: 1, prevEm: null } : { toque: null, motivo: 'sem_1o_toque' };
}

// ── links e textos auxiliares (puros) ────────────────────────────────────────

/** O link inteiro, com as UTMs da recuperação pesada. `utm_term` cortado em 60. */
export function linkPesado(destino: 'pix' | 'cartao', utmTerm: string | null | undefined): string {
  const base = destino === 'pix' ? 'https://solardoc.app/?pagar=pix&' : 'https://solardoc.app/assinar?';
  const t = String(utmTerm ?? '').trim().slice(0, 60);
  return `${base}utm_source=recuperacao&utm_medium=whatsapp&utm_campaign=pesada${t ? `&utm_term=${encodeURIComponent(t)}` : ''}`;
}

/** 1 link por toque: o T1 e o T3 levam o que a pessoa prefere (cartão se marcou cartão no quiz; Pix para o resto), o T2 leva o outro. */
export function formaPorLink(toque: 1 | 2 | 3, lead: LeadRec, daLp: boolean, utmTerm: string | null): FormaPesada {
  const prefere: 'pix' | 'cartao' = !daLp && campoFd(lead.field_data, 'pagamento') === 'cartao' ? 'cartao' : 'pix';
  const destino = toque === 2 ? (prefere === 'pix' ? 'cartao' : 'pix') : prefere;
  return destino === 'pix' ? { tipo: 'link_pix', link: linkPesado('pix', utmTerm) } : { tipo: 'link_cartao', link: linkPesado('cartao', utmTerm) };
}

/** "O seu diagnóstico deu 37 de 100, com velocidade pesando mais." ou null (lead sem índice, ou da LP). */
export function resultadoDoQuiz(lead: LeadRec): string | null {
  const indice = campoFd(lead.field_data, 'Índice');
  if (!/^\d{1,3}$/.test(indice)) return null;
  const pilar = campoFd(lead.field_data, 'Pilar mais fraco').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).toLocaleLowerCase('pt-BR');
  return pilar ? `O seu diagnóstico deu ${indice} de 100, com ${pilar} pesando mais.` : `O seu diagnóstico deu ${indice} de 100.`;
}

export const nomePesado = (lead: LeadRec): string | null => {
  const n = primeiroNome(lead.nome);
  return n && n.toLocaleLowerCase('pt-BR') !== 'cliente' ? n : null;
};

// ── a fila da pesada ─────────────────────────────────────────────────────────

export type GrupoPesada = 'quiz_1411' | 'pix_sem_pagamento' | 'regua';
export interface ItemPesada {
  lead: LeadRec; hmac: string; toque: 1 | 2 | 3; prevEm: string | null; contratoId: string | null; daLp: boolean; grupo: GrupoPesada;
  /** O `desde` da posse que o toque anterior deixou (no 3º toque pode ser a do 1º, se o 2º a manteve). Ausente = `prevEm`. */
  posseEm?: string | null;
  utmTerm: string | null;
  /** Pulado há menos de 2 h por motivo que não fica gravado: vai ao fim da fila. */
  adiado?: boolean;
  /** Já falou com a linha (pulo `ja_falou`) e está no lote: nada vai a ela, só o aviso ao time. */
  soAviso?: boolean;
}
/** `origem` = a da atribuição do contrato (`pix_auto_atrib:<id>`): só quiz_solardoc e lp_solardoc entram no lote. */
export interface ContratoLote { contratoId: string; status: string; created_at: string | null; whatsapp: string | null; origem: string | null }
export interface DecisaoPesada { hmac8: string; grupo: GrupoPesada; toques: number; proximo: 1 | 2 | 3 | null; motivo: string | null; contrato: boolean }

export interface DepsFilaPesada {
  janela(agora: Date): boolean;
  leads(desdeIso: string, ateIso: string): Promise<LeadRec[] | null>;
  leadsLp?(desdeIso: string, ateIso: string): Promise<LeadRec[] | null>;
  lerEstados?(chaves: string[]): Promise<Map<string, CarimboLido> | null>;
  /** Os contratos do Pix automático entre as datas, sem `ativo` nem `cancelado`, com o WhatsApp da atribuição. null = leitura falhou. */
  contratosSemPagamento?(desdeIso: string, ateIso: string): Promise<ContratoLote[] | null>;
}

const hmacDoLead = (l: LeadRec): string | null => { const t = normalizarTelefoneSd(l.whatsapp); return t ? hmacDe(chaveDoTelefone(t)) : null; };
const ms = (s: string | null | undefined): number => Date.parse(String(s ?? '')) || 0;

/**
 * Lê UMA vez por rodada quem a pesada chama agora: `lote` (vai logo depois do 1º toque do Pix), `regua` (o T2 e o T3, por último) e `avisos` (lote que já
 * falou com a linha: só o aviso ao time). `marcas` são as marcas vivas do Pix (120 h): dão o contrato de quem gerou o Pix agora. null = leitura falhou
 * (a rodada segue sem a pesada). `decisoes` (opcional) recebe o porquê de cada pessoa, para a sonda.
 */
export async function lerFilaPesada(
  d: DepsFilaPesada, agora: Date, marcas: readonly MarcaPagto[], decisoes?: DecisaoPesada[],
): Promise<{ lote: ItemPesada[]; regua: ItemPesada[]; avisos: ItemPesada[]; adiados: Set<string> } | null> {
  if (!d.lerEstados) return { lote: [], regua: [], avisos: [], adiados: new Set() };
  const agoraMs = agora.getTime();
  const lote = loteVale(agoraMs);
  const desde = Math.min(agoraMs - 13 * DIA_MS, lote ? Date.parse(LOTE_RESGATE.contratosDesde) : Infinity);
  const ate = new Date(agoraMs - ESPERA_MIN_MS).toISOString();
  const quiz = await d.leads(new Date(desde).toISOString(), ate);
  const lp = d.leadsLp ? await d.leadsLp(new Date(desde).toISOString(), ate) : [];
  if (!quiz || !lp) return null;
  const pessoas = new Map<string, { lead: LeadRec; daLp: boolean }>();
  for (const [lista, daLp] of [[quiz, false], [lp, true]] as const) {
    for (const l of lista) {
      const h = hmacDoLead(l);
      if (h && !ehLeadDeTeste(l.field_data) && !pessoas.has(h)) pessoas.set(h, { lead: l, daLp });
    }
  }
  // O contrato de cada pessoa: o do lote (o mais novo) e, por cima, o da marca viva do Pix (a mais nova).
  const contrato = new Map<string, { id: string; em: number }>();
  const grupoB = new Set<string>();
  if (lote && d.contratosSemPagamento) {
    const cs = await d.contratosSemPagamento(LOTE_RESGATE.contratosDesde, LOTE_RESGATE.contratosAte);
    if (!cs) return null;
    for (const c of cs) {
      if (!ORIGENS_LOTE.has(String(c.origem ?? ''))) continue;
      const tel = normalizarTelefoneSd(c.whatsapp);
      const h = tel ? hmacDe(chaveDoTelefone(tel)) : null;
      if (!h) continue;
      if (!pessoas.has(h)) { decisoes?.push({ hmac8: h.slice(0, 8), grupo: 'pix_sem_pagamento', toques: 0, proximo: null, motivo: 'sem_lead', contrato: true }); continue; }
      grupoB.add(h);
      if ((contrato.get(h)?.em ?? -1) < ms(c.created_at)) contrato.set(h, { id: c.contratoId, em: ms(c.created_at) });
    }
  }
  for (const m of marcas) if (pessoas.has(m.hmac) && (contrato.get(m.hmac)?.em ?? -1) < ms(m.em)) contrato.set(m.hmac, { id: m.contratoId, em: ms(m.em) });

  const hmacs = [...pessoas.keys()];
  const chaves = hmacs.flatMap(h => [PREFIXO_CARIMBO_REC, PREFIXO_CARIMBO2_REC, PREFIXO_CARIMBO3_REC, PREFIXO_PULOU_REC].map(p => `${p}${h}`)
    .concat(`quiz_aviso:${h}${SUFIXO_AVISO_PESADA}`, `${PREFIXO_ADIADO_REC}${h}`));
  const estados = hmacs.length ? await d.lerEstados(chaves) : new Map<string, CarimboLido>();
  if (!estados) return null;

  const saida = { lote: [] as ItemPesada[], regua: [] as ItemPesada[], avisos: [] as ItemPesada[] };
  // Adiado há menos de 2 h (e não no futuro): vai ao fim da fila. Vale também para o 1º toque do Pix e as outras filas da rodada (o tick reordena).
  const adiados = new Set(hmacs.filter(h => { const em = ms(estados.get(`${PREFIXO_ADIADO_REC}${h}`)?.em); return em > 0 && em <= agoraMs && agoraMs - em < ADIADO_MS; }));
  for (const h of hmacs) {
    const { lead, daLp } = pessoas.get(h)!;
    const grupoA = lote && !daLp && ms(lead.created_time) >= Date.parse(LOTE_RESGATE.quizDesde);
    const noLote = grupoA || grupoB.has(h);
    const grupo: GrupoPesada = grupoA ? 'quiz_1411' : grupoB.has(h) ? 'pix_sem_pagamento' : 'regua';
    const t = { sent: estados.get(`${PREFIXO_CARIMBO_REC}${h}`), sent2: estados.get(`${PREFIXO_CARIMBO2_REC}${h}`), sent3: estados.get(`${PREFIXO_CARIMBO3_REC}${h}`) };
    const toques = [t.sent, t.sent2, t.sent3].filter(Boolean).length;
    const nota = (proximo: 1 | 2 | 3 | null, motivo: string | null): void => {
      if (noLote || toques > 0) decisoes?.push({ hmac8: h.slice(0, 8), grupo, toques, proximo, motivo, contrato: contrato.has(h) });
    };
    const base = {
      lead, hmac: h, contratoId: contrato.get(h)?.id ?? null, daLp, grupo, utmTerm: campoFd(lead.field_data, 'utm_term') || null, ...(adiados.has(h) ? { adiado: true } : {}),
    };
    const pulo = estados.get(`${PREFIXO_PULOU_REC}${h}`);
    if (pulo) {
      if (noLote && pulo.motivo === 'ja_falou' && !estados.has(`quiz_aviso:${h}${SUFIXO_AVISO_PESADA}`)) {
        saida.avisos.push({ ...base, toque: 1, prevEm: null, soAviso: true });
        nota(null, 'ja_falou_aviso_ao_time');
      } else nota(null, `pulou_${pulo.motivo ?? 'sem_motivo'}`);
      continue;
    }
    const p = proximoToquePesado(t, agoraMs, d.janela, { lote: noLote });
    if (p.toque === null) { nota(null, p.motivo); continue; }
    nota(p.toque, null);
    (noLote ? saida.lote : saida.regua).push({ ...base, toque: p.toque, prevEm: p.prevEm, posseEm: p.posseEm ?? p.prevEm });
  }
  // Lote: quem fez o quiz primeiro (do lead mais antigo), depois o Pix (do contrato mais antigo). Régua: o T1 mais antigo primeiro. O adiado vai por último,
  // ANTES do corte por rodada: quem está preso (posse, equipe na conversa) não ocupa a vaga dos outros.
  const fim = (i: ItemPesada): number => (i.adiado ? 1 : 0);
  const ordemLote = (i: ItemPesada): number => (i.grupo === 'quiz_1411' ? 0 : 1e15) + (i.grupo === 'quiz_1411' ? ms(i.lead.created_time) : (contrato.get(i.hmac)?.em ?? 0));
  saida.lote.sort((a, b) => fim(a) - fim(b) || ordemLote(a) - ordemLote(b));
  saida.regua.sort((a, b) => fim(a) - fim(b) || ms(a.prevEm) - ms(b.prevEm));
  return {
    lote: saida.lote.slice(0, LOTE_POR_RODADA), regua: saida.regua.slice(0, REGUA_POR_RODADA), avisos: saida.avisos.slice(0, AVISOS_POR_RODADA), adiados,
  };
}

// ── o pagamento do toque, depois do claim ────────────────────────────────────

export interface ContratoLido {
  status: string; created_at: string | null; qr_payload: string | null; ultimo_pagamento_em: string | null; ultimo_pagamento_id?: string | null;
  email: string | null; expira_em?: string | null; contract_id?: string | null; cpf_cnpj?: string | null;
  /** A mensalidade REAL do contrato (valor do plano + adicionais do bump). null ou ausente = não deu para saber: o texto não cita valor. */
  mensal?: number | null;
}
export interface DepsPagtoPesada {
  lerPagamento?(contratoId: string): Promise<{ contrato: ContratoLido | null; whatsapp: string | null } | null>;
  vendas(agoraMs: number, desdeMs?: number): Promise<VendasRecentes>;
  compra(vendas: VendasRecentes, lp: string, chave: string): Promise<boolean>;
  compraPorEmail?(vendas: VendasRecentes, email: string): Promise<boolean>;
  jaPagouCpfOuEmail?(cpf: string, email: string, desdeIso?: string | null): Promise<boolean>;
  gerarCodigoNovo?(a: { contractId: string; nome: string | null; tel: string }): Promise<{ contractId: string; qrPayload: string; expiraEm: string }>;
  moverMarca?(hmac: string, antigo: string, novo: string): Promise<boolean>;
}
export type PagamentoPesado =
  | { ok: true; forma: FormaPesada; codigo: string | null; situacao: 'quiz' | 'pix'; valorMensal: number | null }
  | { ok: false; motivo: string; pular?: string; asaasMal?: boolean };

/**
 * Relê, DEPOIS do claim e da posse, se a pessoa pagou (venda pelo telefone ou pela sessão, contrato pago, venda ou plano pelo e-mail, outro contrato do mesmo CPF
 * ou e-mail) e escolhe a forma: código vivo, código novo (cria a autorização nova aqui, nunca antes) ou 1 link. Erro LANÇA (quem chama desfaz o claim).
 */
export async function pagamentoDoToque(
  d: DepsPagtoPesada, item: ItemPesada, tel: string, agoraMs: number, opts: { asaasMal: boolean; vendasDesdeMs?: number },
): Promise<PagamentoPesado> {
  const vendas = await d.vendas(agoraMs, opts.vendasDesdeMs);
  if (await d.compra(vendas, campoFd(item.lead.field_data, 'lp_session'), chaveDoTelefone(tel))) return { ok: false, motivo: 'pagou', pular: 'comprou' };
  const link = (): PagamentoPesado => ({
    ok: true, forma: formaPorLink(item.toque, item.lead, item.daLp, item.utmTerm), codigo: null, situacao: item.contratoId ? 'pix' : 'quiz', valorMensal: VALOR_PLANO,
  });
  if (!item.contratoId || !d.lerPagamento) return link();
  const fresco = await d.lerPagamento(item.contratoId);
  if (!fresco) return { ok: false, motivo: 'pagamento_falhou' };
  const c = fresco.contrato;
  if (!c) return link();
  if (pagamentoValeDesde(c, ms(c.created_at))) return { ok: false, motivo: 'pagou', pular: 'pagou' };
  if (c.email && d.compraPorEmail && await d.compraPorEmail(vendas, c.email)) return { ok: false, motivo: 'pagou', pular: 'comprou' };
  if (c.status === 'cancelado') return { ok: false, motivo: 'contrato_cancelado', pular: 'cancelado' };
  const fase = faseDoCodigo(c, agoraMs, { recusadoVence: true });
  // O código novo copia plano e adicionais do contrato antigo (pixAutoCodigo.ts): a mensalidade é a mesma. Sem o valor certo, o texto não cita valor.
  const valorMensal = typeof c.mensal === 'number' && Number.isFinite(c.mensal) && c.mensal > 0 ? c.mensal : null;
  if (fase === 'espera') return { ok: false, motivo: 'aguardando_codigo' };
  if (fase === 'codigo') return { ok: true, forma: { tipo: 'codigo' }, codigo: c.qr_payload as string, situacao: 'pix', valorMensal };
  if (fase !== 'vencido' || !d.gerarCodigoNovo || !d.jaPagouCpfOuEmail || !c.cpf_cnpj || !c.contract_id) return link();
  if (opts.asaasMal) return { ok: false, motivo: 'codigo_novo_adiado' };
  if (await d.jaPagouCpfOuEmail(c.cpf_cnpj, c.email ?? '', c.created_at)) return { ok: false, motivo: 'pagou', pular: 'pagou' };
  try {
    const novo = await d.gerarCodigoNovo({ contractId: c.contract_id, nome: nomePesado(item.lead), tel });
    try { await d.moverMarca?.(item.hmac, item.contratoId, novo.contractId); } catch { /* a próxima leitura acha o contrato vivo pelo CPF */ }
    return { ok: true, forma: { tipo: 'codigo' }, codigo: novo.qrPayload, situacao: 'pix', valorMensal };
  } catch (err) {
    // 4xx do Asaas (CPF recusado, cliente inválido): o código não sai, vai o link. 5xx e timeout: o Asaas está mal, a rodada não o martela de novo.
    if ((err as { permanente?: unknown } | null)?.permanente === true) return link();
    return { ok: false, motivo: 'codigo_novo_falhou', asaasMal: true };
  }
}
