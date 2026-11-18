import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A RECUPERAÇÃO PESADA do quiz e do Pix do SolarDoc (16/11/2026): quem entra (com e sem CNPJ, recusado, pendente), quem sai (comprou, pediu para parar,
// equipe assumiu, já falou), a cadência (T1, T2 no dia útil seguinte, T3 dois dias úteis depois, nunca 2 no mesmo dia, nunca um 4º), a idempotência
// (claim antes do envio, 1 envio por rodada) e o reenvio do pagamento (código vivo, código novo depois do claim, link). Tudo sobre dependências falsas,
// com o relógio FIXO (AGORA) e nenhum `new Date()` solto nas asserções.

vi.mock('../utils/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'in', 'like', 'gte', 'lte', 'order', 'or', 'limit', 'neq', 'ilike']) q[k] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  q.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
  return { supabase: { from: () => q, rpc: () => q } };
});
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => undefined) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runQuizRecuperacaoTick, type DepsRec, type DadosPagamento } from '../services/solardoc/recuperacaoCarla';
import { faseDoCodigo, type LeadRec, type MarcaPagto } from '../services/solardoc/recuperacaoCarlaRegras';
import {
  LOTE_RESGATE, REGUA_DESDE, proximoToquePesado, linkPesado, type CarimboLido, type ContratoLote,
} from '../services/solardoc/recuperacaoPesada';
import { montarToquePesado, MODELOS_PESADA, T1_PIX, T1_QUIZ, T2, T3, variacaoDoHmac, type FormaPesada } from '../services/solardoc/recuperacaoPesadaTextos';
import { sondarPesada } from '../services/solardoc/recuperacaoPesadaSonda';
import { dentroDaJanelaDaBaseLinha } from '../services/agents/whatsapp/lineThrottle';
import { emBolhas } from '../services/agents/bolhas';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';
import { CLASSE_POR_ROBO } from '../services/chefe/classes';
import { chaveDaPosse } from '../services/agentes5040/posse';

// Quarta-feira, 18/11/2026, 12:00 de Brasília (15:00Z): dentro da janela, o lote vale e os leads de 14/11 já passaram das 48 h úteis.
const AGORA = new Date('2026-11-18T15:00:00.000Z');
const SEG_16 = new Date('2026-11-16T15:00:00.000Z');
const FUTURO = '2026-11-19T15:00:00.000Z';
const janela = (d: Date): boolean => dentroDaJanelaDaBaseLinha(d);
const hm = (tel: string): string => hmacDe(chaveDoTelefone(normalizarTelefoneSd(tel) as string)) as string;

let seq = 0;
const telDe = (n: number): string => `55349981${String(10000 + n)}`;
/** Lead do quiz de 14/11 (grupo do lote), com CNPJ 'sim' por padrão. */
function leadQuiz(over: Partial<LeadRec> = {}, campos: Record<string, string> = {}): LeadRec {
  seq++;
  const base: Record<string, string> = {
    'Código': `SD-${seq}`, 'Índice': '37', 'Pilar mais fraco': 'Velocidade', Empresa: 'Solar Andrade', cnpj: 'sim', pagamento: 'pix', lp_session: `lp-${seq}`,
    utm_term: '1203', ...campos,
  };
  return {
    lead_id: `sdquiz_${seq}`, nome: 'carlos andrade', whatsapp: telDe(seq), cidade: 'Uberlândia-MG', created_time: '2026-11-14T10:00:00.000Z',
    field_data: Object.entries(base).filter(([, v]) => v !== '').map(([name, v]) => ({ name, values: [v] })), ...over,
  };
}

interface Espiao {
  enviados: Array<{ tel: string; texto: string }>; estados: Map<string, CarimboLido>; ordem: string[]; fila: number[]; avisos: string[]; gerados: number;
}

/** As dependências falsas. `contratos` = contratoId → o que lerPagamento devolve; `lote` = o que contratosSemPagamento devolve. */
function montar(leads: LeadRec[], o: {
  lp?: LeadRec[]; contratos?: Record<string, DadosPagamento>; lote?: ContratoLote[]; marcas?: MarcaPagto[]; over?: Partial<DepsRec>; estados?: Record<string, CarimboLido>;
} = {}): { d: DepsRec; e: Espiao } {
  const e: Espiao = { enviados: [], estados: new Map(Object.entries(o.estados ?? {})), ordem: [], fila: [], avisos: [], gerados: 0 };
  const d: DepsRec = {
    estado: async () => ({ ligada: true, motivo: 'ligada' }),
    segredoOk: () => true,
    garantirLargada: async () => Date.parse('2026-10-26T15:46:00.000Z'),
    janela,
    linhaPausada: async () => 'nao',
    tetoHorario: async () => true,
    espacamento: async () => true,
    tomarVez: async () => 'tomada',
    limparVezes: async () => undefined,
    leads: async () => leads,
    leadsLp: async () => o.lp ?? [],
    existentes: async (ch) => new Set(ch.filter(c => e.estados.has(c))),
    lerEstados: async (ch) => new Map(ch.filter(c => e.estados.has(c)).map(c => [c, e.estados.get(c) as CarimboLido])),
    vendas: async () => ({ sessoes: new Set(), chaves: new Set(), emails: new Set() }),
    compra: async () => false,
    compraPorEmail: async () => false,
    posse: async () => 'livre',
    conversa: async () => ({ msgs: [], completa: true }),
    mensagemComCodigo: async () => false,
    podeFalar: async () => 'sim',
    supressao: async () => [],
    mudo: async () => 'nao',
    telefoneExiste: async () => 'sim',
    claim: async (c, ag) => { if (e.estados.has(c)) return 'ja'; e.estados.set(c, { em: ag.toISOString() }); e.ordem.push(`claim ${c.split(':')[0]}`); return 'ok'; },
    apagarClaim: async (c) => { e.estados.delete(c); e.ordem.push('apagarClaim'); },
    marcarClaim: async (c, v) => { e.estados.set(c, v as unknown as CarimboLido); },
    marcarPulo: async (c, motivo, ag) => { e.estados.set(c, { em: ag.toISOString(), motivo }); },
    assumirPosse: async () => { e.ordem.push('assumirPosse'); return 'assumida'; },
    posseAindaNossa: async () => true,
    desfazerPosse: async () => true,
    enviar: async (tel, texto) => { e.enviados.push({ tel, texto }); e.ordem.push('enviar'); return true; },
    erroDeLinha: async () => undefined,
    envioOk: async () => undefined,
    avisarSaiu: async () => { e.avisos.push('saiu'); return 'pendente'; },
    avisarNaoChama: async () => 'pendente',
    avisarSemVaga: async () => 'enviado',
    marcasPagamento: async () => o.marcas ?? [],
    lerPagamento: async (id) => o.contratos?.[id] ?? { contrato: null, whatsapp: null },
    contratosSemPagamento: async () => o.lote ?? [],
    jaPagouCpfOuEmail: async () => false,
    gerarCodigoNovo: async () => { e.gerados++; e.ordem.push('gerarCodigoNovo'); return { contractId: `novo_${e.gerados}`, qrPayload: '000201NOVOCODIGO', expiraEm: FUTURO }; },
    moverMarca: async () => true,
    marcarFila: async (n) => { e.fila.push(n); },
    marcarAdiado: async (hs, ag) => { for (const h of hs) e.estados.set(`quiz_rec_adiado:${h}`, { em: ag.toISOString() }); },
    avisarTentouPagar: async (l) => { e.avisos.push('tentou_pagar'); e.estados.set(`quiz_aviso:${hm(String(l.whatsapp))}:pesada`, { em: AGORA.toISOString() }); return 'pendente'; },
    ...o.over,
  };
  return { d, e };
}
const rodar = (d: DepsRec, agora: Date = AGORA) => runQuizRecuperacaoTick({ agora }, d);
const contrato = (over: Partial<NonNullable<DadosPagamento['contrato']>> = {}, tel: string | null = null): DadosPagamento => ({
  contrato: {
    status: 'recusado', created_at: '2026-11-03T14:00:00.000Z', qr_payload: '000201VELHO', ultimo_pagamento_em: null, ultimo_pagamento_id: null,
    email: 'ana@exemplo.com', expira_em: '2026-11-04T14:00:00.000Z', contract_id: 'c1', cpf_cnpj: '12345678909', mensal: 67, ...over,
  },
  whatsapp: tel,
});

beforeEach(() => {
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  delete process.env.AGENTES5040_HMAC; delete process.env.QUIZ_PESADA_OFF; delete process.env.QUIZ_RECUPERACAO_LIGADA;
  seq = 0;
});
afterEach(() => { delete process.env.QUIZ_PESADA_OFF; });

// ── a cadência (pura) ────────────────────────────────────────────────────────

describe('a cadência: T1, T2 a partir do dia útil seguinte, T3 a partir de 2 dias úteis depois do T2, nunca um 4º', () => {
  const env = (iso: string): CarimboLido => ({ em: iso, estado: 'enviado' });
  it('sem carimbo: só o lote dá o T1 por aqui (o T1 de sempre é das filas antigas)', () => {
    expect(proximoToquePesado({}, AGORA.getTime(), janela, { lote: true })).toEqual({ toque: 1, prevEm: null });
    expect(proximoToquePesado({}, AGORA.getTime(), janela, { lote: false })).toEqual({ toque: null, motivo: 'sem_1o_toque' });
  });
  it('T1 no sábado 14/11: nada no próprio sábado, domingo não abre, segunda manda e terça também (a partir de)', () => {
    const e = { sent: env('2026-11-14T13:00:00.000Z') };
    expect(proximoToquePesado(e, Date.parse('2026-11-14T22:00:00.000Z'), janela, { lote: true }).toque).toBeNull();
    expect(proximoToquePesado(e, Date.parse('2026-11-15T15:00:00.000Z'), janela, { lote: true }).toque).toBeNull();
    expect(proximoToquePesado(e, Date.parse('2026-11-16T15:00:00.000Z'), janela, { lote: true })).toEqual({ toque: 2, prevEm: e.sent.em });
    expect(proximoToquePesado(e, Date.parse('2026-11-17T15:00:00.000Z'), janela, { lote: true }).toque).toBe(2);
  });
  it('a régua nova só vale para quem recebeu o T1 depois do deploy (REGUA_DESDE) e para o lote: o T1 antigo, fora do lote, fica com 1 toque', () => {
    const antigo = { sent: env('2026-11-13T13:00:00.000Z') };
    expect(proximoToquePesado(antigo, AGORA.getTime(), janela, { lote: false })).toEqual({ toque: null, motivo: 'toque_anterior_a_pesada' });
    expect(proximoToquePesado(antigo, AGORA.getTime(), janela, { lote: true })).toEqual({ toque: 2, prevEm: antigo.sent.em });
    const antigo2 = { sent: env('2026-11-13T13:00:00.000Z'), sent2: env('2026-11-16T13:00:00.000Z') };
    expect(proximoToquePesado(antigo2, AGORA.getTime(), janela, { lote: false })).toEqual({ toque: null, motivo: 'toque_anterior_a_pesada' });
    const novo = { sent: env('2026-11-16T15:30:00.000Z') };
    expect(proximoToquePesado(novo, AGORA.getTime(), janela, { lote: false })).toEqual({ toque: 2, prevEm: novo.sent.em });
    expect(REGUA_DESDE).toBe('2026-11-16T15:00:00.000Z');
  });
  it('nunca 2 no mesmo dia: o T1 de hoje só abre o T2 amanhã', () => {
    expect(proximoToquePesado({ sent: env('2026-11-18T12:30:00.000Z') }, AGORA.getTime(), janela, { lote: true })).toEqual({ toque: null, motivo: 'cedo_para_o_2' });
  });
  it('T3 dois dias úteis depois do T2; com o feriado de 20/11 (sexta), o T2 de quinta só abre o T3 na segunda 23/11', () => {
    const seg = { sent: env('2026-11-14T13:00:00.000Z'), sent2: env('2026-11-16T13:00:00.000Z') };
    expect(proximoToquePesado(seg, Date.parse('2026-11-17T15:00:00.000Z'), janela, { lote: true }).toque).toBeNull();
    expect(proximoToquePesado(seg, AGORA.getTime(), janela, { lote: true })).toEqual({ toque: 3, prevEm: seg.sent2.em, posseEm: seg.sent2.em });
    const qui = { sent: env('2026-11-18T13:00:00.000Z'), sent2: env('2026-11-19T13:00:00.000Z') };
    expect(proximoToquePesado(qui, Date.parse('2026-11-21T15:00:00.000Z'), janela, { lote: false }).toque).toBeNull();
    expect(proximoToquePesado(qui, Date.parse('2026-11-23T15:00:00.000Z'), janela, { lote: false }).toque).toBe(3);
  });
  it('nunca um 4º; carimbo que não saiu de verdade encerra a régua; 7 dias corridos do T1 encerram a régua (o lote ainda dá o T2)', () => {
    expect(proximoToquePesado({ sent: env('2026-11-14T13:00:00.000Z'), sent2: env('2026-11-16T13:00:00.000Z'), sent3: env('2026-11-18T13:00:00.000Z') },
      Date.parse('2026-11-25T15:00:00.000Z'), janela, { lote: true })).toEqual({ toque: null, motivo: 'tres_toques' });
    expect(proximoToquePesado({ sent: { em: '2026-11-14T13:00:00.000Z', estado: 'nao_saiu' } }, AGORA.getTime(), janela, { lote: true }).toque).toBeNull();
    const velho = { sent: env('2026-11-03T13:00:00.000Z') };
    expect(proximoToquePesado({ sent: env('2026-11-16T15:30:00.000Z') }, Date.parse('2026-11-25T15:00:00.000Z'), janela, { lote: false })).toEqual({ toque: null, motivo: 'fim_7_dias' });
    expect(proximoToquePesado(velho, AGORA.getTime(), janela, { lote: true })).toEqual({ toque: 2, prevEm: velho.sent.em });
    expect(proximoToquePesado({ ...velho, sent2: env('2026-11-16T13:00:00.000Z') }, AGORA.getTime(), janela, { lote: true })).toEqual({ toque: null, motivo: 'fim_7_dias' });
  });
  it('faseDoCodigo: recusado vale vencido SÓ com a opção da pesada; cancelado nunca', () => {
    const c = { status: 'recusado', created_at: '2026-11-03T14:00:00.000Z', qr_payload: '000201X', expira_em: '2026-11-04T14:00:00.000Z' };
    expect(faseDoCodigo(c, AGORA.getTime())).toBe('nada');
    expect(faseDoCodigo(c, AGORA.getTime(), { recusadoVence: true })).toBe('vencido');
    expect(faseDoCodigo({ ...c, status: 'cancelado' }, AGORA.getTime(), { recusadoVence: true })).toBe('nada');
  });
  it('o 3º toque conta no frio da linha e no chefe', () => {
    expect(CLASSE_POR_ROBO.quiz_recuperacao_5040!.carimbos.map(c => c.prefixo)).toContain('quiz_rec_sent3:');
  });
});

// ── o lote de resgate e a rodada ─────────────────────────────────────────────

describe('o lote: quem deixou o WhatsApp no quiz desde 14/11, com ou sem CNPJ', () => {
  it('com e sem CNPJ entram; 1 envio por rodada, o mais antigo primeiro; claim antes do envio; link de pagamento inteiro; a 3ª rodada não repete ninguém', async () => {
    const semCnpj = leadQuiz({ created_time: '2026-11-14T09:00:00.000Z' }, { cnpj: 'nao', pagamento: 'cartao' });
    const comCnpj = leadQuiz({ created_time: '2026-11-14T11:00:00.000Z' });
    const { d, e } = montar([comCnpj, semCnpj]);
    const r1 = await rodar(d);
    expect(r1.enviou).toBe(true);
    expect(e.enviados).toHaveLength(1);
    expect(e.enviados[0]!.tel).toBe(normalizarTelefoneSd(semCnpj.whatsapp));
    const t = e.enviados[0]!.texto;
    expect(t).toMatch(/8 documentos|documentos com a logo|montar orçamento|sem limite de documentos/);
    expect(t).toContain('https://solardoc.app/assinar?utm_source=recuperacao&utm_medium=whatsapp&utm_campaign=pesada&utm_term=1203');
    expect(t).not.toMatch(/diagnostico\b|venceu|falhou|travou|fora do ar/);
    expect(e.ordem.indexOf('claim quiz_rec_sent')).toBeLessThan(e.ordem.indexOf('enviar'));
    expect(e.estados.get(`quiz_rec_sent:${hm(String(semCnpj.whatsapp))}`)).toMatchObject({ estado: 'enviado', tipo: 'lote' });
    expect(e.avisos).toContain('saiu');
    expect(e.fila[e.fila.length - 1]).toBe(1);   // sobrou 1 pronto para a vaga guardada da linha

    await rodar(d);
    expect(e.enviados).toHaveLength(2);
    expect(e.enviados[1]!.texto).toContain('https://solardoc.app/?pagar=pix&utm_source=recuperacao');
    await rodar(d);
    expect(e.enviados).toHaveLength(2);   // nada no mesmo dia: o T2 só amanhã
    expect(e.fila[e.fila.length - 1]).toBe(0);
  });

  it('claim que já existe (outra rodada levou): nada sai', async () => {
    const l = leadQuiz();
    const { d, e } = montar([l], { estados: { [`quiz_rec_sent:${hm(String(l.whatsapp))}`]: { em: AGORA.toISOString() } } });
    await rodar(d);
    expect(e.enviados).toHaveLength(0);
  });

  it('comprou (venda pelo telefone) não recebe e sai da fila para sempre', async () => {
    const l = leadQuiz();
    const { d, e } = montar([l], { over: { compra: async () => true } });
    await rodar(d);
    expect(e.enviados).toHaveLength(0);
    expect(e.estados.get(`quiz_rec_pulou:${hm(String(l.whatsapp))}`)?.motivo).toBe('comprou');
  });

  it('pediu para parar (supressão) e a equipe assumiu (pausa humana ou fala da equipe): nada sai', async () => {
    for (const over of [
      { supressao: async () => ['opt_out'] },
      { podeFalar: async () => 'nao' as const },
      { conversa: async () => ({ msgs: [{ id: 1, from_me: true, from_api: false, autor: 'equipe', texto: 'oi', tipo: 'texto', media_url: null, momment: '2026-11-17T13:00:00.000Z' }], completa: true }) },
    ] as Array<Partial<DepsRec>>) {
      const { d, e } = montar([leadQuiz()], { over });
      const r = await rodar(d);
      expect(e.enviados).toHaveLength(0);
      expect(r.enviou).toBe(false);
    }
  });

  it('já falou com a linha: o robô não fala por cima; o time é avisado UMA vez para falar à mão', async () => {
    const l = leadQuiz();
    const { d, e } = montar([l], {
      over: { conversa: async () => ({ msgs: [{ id: 1, from_me: false, from_api: false, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: '2026-11-15T13:00:00.000Z' }], completa: true }) },
    });
    await rodar(d);
    await rodar(d);
    expect(e.enviados).toHaveLength(0);
    expect(e.avisos.filter(a => a === 'tentou_pagar')).toHaveLength(1);
    expect(e.estados.get(`quiz_rec_pulou:${hm(String(l.whatsapp))}`)?.motivo).toBe('ja_falou');
  });

  it('o lote se desarma sozinho: depois de valeAte não lê contrato nem dá o T1 do lote', async () => {
    let leuContratos = 0;
    const l = leadQuiz();
    const { d, e } = montar([l], { over: { contratosSemPagamento: async () => { leuContratos++; return []; } } });
    await rodar(d, new Date('2026-11-24T15:00:00.000Z'));
    expect(leuContratos).toBe(0);
    expect(e.enviados).toHaveLength(0);
    expect(Date.parse(LOTE_RESGATE.valeAte)).toBeLessThan(Date.parse('2026-11-24T15:00:00.000Z'));
  });
});

describe('o lote: o Pix automático recusado ou pendente desde 01/11, sem pagamento', () => {
  const tel = telDe(77);
  const doLote = (over: Partial<ContratoLote> = {}): ContratoLote => ({ contratoId: 'c1', status: 'recusado', created_at: '2026-11-03T14:00:00.000Z', whatsapp: tel, origem: 'quiz_solardoc', ...over });
  const leadDele = (): LeadRec => leadQuiz({ whatsapp: tel, created_time: '2026-11-03T13:50:00.000Z' });

  it('recusado com CPF: o código NOVO nasce depois do claim e da releitura, sai sozinho na 2ª mensagem; o texto não diz que o Pix falhou', async () => {
    const { d, e } = montar([leadDele()], { lote: [doLote()], contratos: { c1: contrato({}, tel) } });
    await rodar(d);
    expect(e.ordem.indexOf('claim quiz_rec_sent')).toBeLessThan(e.ordem.indexOf('gerarCodigoNovo'));
    expect(e.ordem.indexOf('gerarCodigoNovo')).toBeLessThan(e.ordem.indexOf('enviar'));
    expect(e.enviados.map(x => x.texto)).toHaveLength(2);
    expect(e.enviados[1]!.texto).toBe('000201NOVOCODIGO');
    expect(e.enviados[0]!.texto).toMatch(/Pix automático/);
    expect(e.enviados[0]!.texto).toContain('O código vai logo abaixo');
    expect(e.enviados[0]!.texto).not.toMatch(/https?:|venceu|falhou|travou|fora do ar/);
  });

  it('pendente com o código ainda valendo (2 h ou mais): manda o MESMO código, sem criar outro (nunca 2 QRs vivos)', async () => {
    const { d, e } = montar([leadDele()], {
      lote: [doLote({ status: 'pendente' })],
      contratos: { c1: contrato({ status: 'pendente', created_at: '2026-11-18T10:00:00.000Z', expira_em: '2026-11-19T10:00:00.000Z', qr_payload: '000201VIVO' }, tel) },
    });
    await rodar(d);
    expect(e.gerados).toBe(0);
    expect(e.enviados.map(x => x.texto)[e.enviados.length - 1]).toBe('000201VIVO');
  });

  it('4xx do Asaas (permanente) ou contrato sem CPF: vai 1 link inteiro, sem código; 5xx: nada sai, o claim volta e o Asaas não é martelado na rodada', async () => {
    const perm = Object.assign(new Error('asaas_400'), { permanente: true });
    const a = montar([leadDele()], { lote: [doLote()], contratos: { c1: contrato({}, tel) }, over: { gerarCodigoNovo: async () => { throw perm; } } });
    await rodar(a.d);
    expect(a.e.enviados).toHaveLength(1);
    expect(a.e.enviados[0]!.texto).toContain('https://solardoc.app/?pagar=pix&utm_source=recuperacao');

    const b = montar([leadDele()], { lote: [doLote()], contratos: { c1: contrato({ cpf_cnpj: null }, tel) } });
    await rodar(b.d);
    expect(b.e.gerados).toBe(0);
    expect(b.e.enviados).toHaveLength(1);

    let tentativas = 0;
    const t2 = telDe(78);
    const c = montar([leadDele(), leadQuiz({ whatsapp: t2, created_time: '2026-11-04T13:00:00.000Z' })], {
      lote: [doLote(), doLote({ contratoId: 'c2', whatsapp: t2, created_at: '2026-11-04T14:00:00.000Z' })],
      contratos: { c1: contrato({}, tel), c2: contrato({ contract_id: 'c2' }, t2) },
      over: { gerarCodigoNovo: async () => { tentativas++; throw new Error('asaas_503'); } },
    });
    await rodar(c.d);
    expect(c.e.enviados).toHaveLength(0);
    expect(tentativas).toBe(1);
    expect([...c.e.estados.keys()].filter(k => k.startsWith('quiz_rec_sent'))).toEqual([]);
  });

  it('pagou: contrato pago, venda pelo e-mail ou outro contrato do mesmo CPF; cancelado no banco: ninguém recebe e o pulo fica', async () => {
    const casos: Array<{ c: DadosPagamento; over?: Partial<DepsRec>; motivo: string }> = [
      { c: contrato({ status: 'ativo', ultimo_pagamento_em: '2026-11-05T10:00:00.000Z' }, tel), motivo: 'pagou' },
      { c: contrato({}, tel), over: { compraPorEmail: async () => true }, motivo: 'comprou' },
      { c: contrato({}, tel), over: { jaPagouCpfOuEmail: async () => true }, motivo: 'pagou' },
      { c: contrato({ status: 'cancelado' }, tel), motivo: 'cancelado' },
    ];
    for (const caso of casos) {
      const { d, e } = montar([leadDele()], { lote: [doLote()], contratos: { c1: caso.c }, over: caso.over });
      await rodar(d);
      expect(e.enviados).toHaveLength(0);
      expect(e.gerados).toBe(0);
      expect(e.estados.get(`quiz_rec_pulou:${hm(tel)}`)?.motivo).toBe(caso.motivo);
    }
  });

  it('contrato cujo WhatsApp não tem lead no leads_meta: fica fora do WhatsApp (sem o Código não dá para ler a conversa)', async () => {
    const { d, e } = montar([], { lote: [doLote()], contratos: { c1: contrato({}, tel) } });
    await rodar(d);
    expect(e.enviados).toHaveLength(0);
  });

  it('já recebeu o 1º toque em 03/11: o lote dá o 2º (carimbo quiz_rec_sent2:), com a posse do 1º, e não um 1º de novo', async () => {
    const { d, e } = montar([leadDele()], {
      lote: [doLote()], contratos: { c1: contrato({}, tel) },
      estados: { [`quiz_rec_sent:${hm(tel)}`]: { em: '2026-11-03T14:10:00.000Z', estado: 'enviado', tipo: 'pagamento' } },
    });
    await rodar(d);
    expect(e.estados.get(`quiz_rec_sent2:${hm(tel)}`)).toMatchObject({ estado: 'enviado', tipo: 'pesada2', posse: '2026-11-03T14:10:00.000Z' });
    expect(e.ordem).not.toContain('assumirPosse');
    expect(e.enviados[0]!.texto).toContain('R$ 67 por mês');
  });
});

describe('a régua permanente', () => {
  it('o 15 min de quem fez o quiz, SEM CNPJ, entra com a pesada (já sem o lote): mostra o que o sistema faz e leva 1 link (tipo pesada1)', async () => {
    const l = leadQuiz({ created_time: '2026-11-25T14:30:00.000Z' }, { cnpj: 'abrindo' });
    const { d, e } = montar([l]);
    await rodar(d, new Date('2026-11-25T15:00:00.000Z'));
    expect(e.enviados[0]!.texto).toMatch(/documentos/);
    expect(e.enviados).toHaveLength(1);
    expect(e.enviados[0]!.texto).toContain('https://solardoc.app/?pagar=pix');
    expect(e.estados.get(`quiz_rec_sent:${hm(String(l.whatsapp))}`)).toMatchObject({ tipo: 'pesada1' });
  });

  it('T2 a quem recebeu a mensagem de 15 min ontem: o OUTRO link (cartão para quem prefere Pix), sem aviso ao grupo; depois o T3 e nunca um 4º', async () => {
    const l = leadQuiz({ created_time: '2026-11-11T13:00:00.000Z' });
    const h = hm(String(l.whatsapp));
    const { d, e } = montar([l], { estados: { [`quiz_rec_sent:${h}`]: { em: '2026-11-16T16:00:00.000Z', estado: 'enviado', tipo: 'diagnostico' } } });
    await rodar(d, new Date('2026-11-17T15:00:00.000Z'));
    expect(e.enviados).toHaveLength(1);
    expect(e.enviados[0]!.texto).toContain('https://solardoc.app/assinar?');
    expect(e.enviados[0]!.texto).toContain('O seu diagnóstico deu 37 de 100, com velocidade pesando mais.');
    expect(e.avisos).not.toContain('saiu');
    await rodar(d, new Date('2026-11-18T15:00:00.000Z'));
    expect(e.enviados).toHaveLength(1);   // o T3 só 2 dias úteis depois do T2
    await rodar(d, new Date('2026-11-19T15:00:00.000Z'));
    expect(e.enviados).toHaveLength(2);
    expect(e.estados.get(`quiz_rec_sent3:${h}`)).toMatchObject({ estado: 'enviado', tipo: 'pesada3' });
    expect(e.enviados[1]!.texto).toContain('https://solardoc.app/?pagar=pix');
    await rodar(d, new Date('2026-11-23T15:00:00.000Z'));
    expect(e.enviados).toHaveLength(2);
  });

  it('o 3º toque herda a posse que o 1º deixou (o 2º a manteve): a posse viva da Carla não barra e não é trocada', async () => {
    const l = leadQuiz({ created_time: '2026-11-11T13:00:00.000Z' });
    const h = hm(String(l.whatsapp));
    const t1 = '2026-11-16T16:00:00.000Z';
    const { d, e } = montar([l], {
      estados: {
        [`quiz_rec_sent:${h}`]: { em: t1, estado: 'enviado', tipo: 'pesada1' },
        [`quiz_rec_sent2:${h}`]: { em: '2026-11-17T13:00:00.000Z', estado: 'enviado', tipo: 'pesada2', posse: t1 },
      },
      over: { posse: async () => 'ocupada', posseAindaNossa: async (_c, em) => Date.parse(em) === Date.parse(t1) },
    });
    await rodar(d, new Date('2026-11-19T15:00:00.000Z'));
    expect(e.estados.get(`quiz_rec_sent3:${h}`)).toMatchObject({ estado: 'enviado', tipo: 'pesada3', posse: t1 });
    expect(e.ordem).not.toContain('assumirPosse');
    expect(e.enviados).toHaveLength(1);
  });

  it('o 1º toque de quem gerou o Pix (marca viva) com o contrato recusado: código novo, com o texto da pesada (nada de "venceu")', async () => {
    const l = leadQuiz({ created_time: '2026-11-18T13:00:00.000Z' });
    const tel = String(l.whatsapp);
    const marca: MarcaPagto = { hmac: hm(tel), em: '2026-11-18T13:05:00.000Z', contratoId: 'c9', origem: 'quiz_solardoc', email: 'ana@exemplo.com', nome: null, utm_term: null, lp_session: null };
    const { d, e } = montar([l], {
      marcas: [marca],
      contratos: { c9: contrato({ status: 'recusado', created_at: '2026-11-18T13:05:00.000Z', expira_em: '2026-11-18T13:30:00.000Z', contract_id: 'c9' }, tel) },
    });
    await rodar(d);
    expect(e.gerados).toBe(1);
    expect(e.enviados.map(x => x.texto)).toEqual([expect.not.stringMatching(/venceu|falhou|travou/), '000201NOVOCODIGO']);
    expect(e.estados.get(`quiz_rec_sent:${hm(tel)}`)).toMatchObject({ tipo: 'pesada_pix' });
  });

  it('QUIZ_PESADA_OFF=1 volta ao comportamento de antes: sem CNPJ fica fora, o lote não é lido e a fila da vaga não é gravada', async () => {
    process.env.QUIZ_PESADA_OFF = '1';
    let leuContratos = 0;
    const fresco = leadQuiz({ created_time: '2026-11-18T14:30:00.000Z' }, { cnpj: 'nao' });
    const doLote = leadQuiz();
    const { d, e } = montar([fresco, doLote], { over: { contratosSemPagamento: async () => { leuContratos++; return []; } } });
    await rodar(d);
    expect(leuContratos).toBe(0);
    expect(e.fila).toEqual([]);
    expect(e.enviados).toHaveLength(0);
  });
});

// ── os textos ────────────────────────────────────────────────────────────────

describe('os textos: 1 bolha de até 900, sem travessão, sem emoji, sem dizer que o Pix falhou, 1 forma de pagamento por toque', () => {
  const formas: FormaPesada[] = [
    { tipo: 'codigo' },
    { tipo: 'link_pix', link: linkPesado('pix', 'x'.repeat(200)) },
    { tipo: 'link_cartao', link: linkPesado('cartao', 'x'.repeat(200)) },
  ];
  it('pior caso de cada variação de cada toque', () => {
    for (const toque of [1, 2, 3] as const) {
      for (const situacao of ['quiz', 'pix'] as const) {
        for (const forma of formas) {
          for (const hmac of ['000000', '000001', '000002']) {
            for (const [nome, valorMensal] of [['Maximilianoooooooooooooo', 97.9], [null, null], ['Ana', 67]] as const) {
              const t = montarToquePesado({ toque, situacao, nome, resultado: 'O seu diagnóstico deu 100 de 100, com apresentação visual pesando mais.', forma, hmac, valorMensal, empresa: 'Empresa Solar Energia Renovavel e Servicos Ltda Matriz', indice: '100' });
              expect(t.length).toBeLessThanOrEqual(900);
              expect(emBolhas(t, { maxBolhas: 1, max: 900 })).toEqual([t]);
              expect(t).not.toMatch(/[–—]|\p{Extended_Pictographic}|\[|\]|venceu|falhou|travou|travar|fora do ar|diagnostico\?|bit\.ly/u);
              for (const linha of t.split('\n')) expect(linha.charAt(0)).toMatch(/[A-ZÀ-Ú]/);
              const links = t.match(/https:\/\/\S+/g) ?? [];
              expect(links.length).toBe(forma.tipo === 'codigo' ? 0 : 1);
              for (const u of links) expect(u.startsWith('https://solardoc.app/')).toBe(true);
            }
          }
        }
      }
    }
  });
  it('os modelos não têm travessão nem emoji; 3 variações por toque; a mesma pessoa ouve sempre a mesma', () => {
    for (const m of MODELOS_PESADA) expect(m).not.toMatch(/[–—]|\p{Extended_Pictographic}|venceu|falhou|travou|fora do ar/u);
    for (const lista of [T1_QUIZ, T1_PIX, T2, T3]) expect(lista).toHaveLength(3);
    expect(variacaoDoHmac('a1b2c3ff', 3)).toBe(variacaoDoHmac('a1b2c3ff', 3));
  });
  it('sem nome: "Oi, aqui é a Carla"', () => {
    expect(montarToquePesado({ toque: 1, situacao: 'quiz', nome: null, resultado: null, forma: { tipo: 'codigo' }, hmac: '000000', valorMensal: 67 })).toMatch(/^Oi, aqui é a Carla/);
  });
});

// ── a sonda ──────────────────────────────────────────────────────────────────

describe('a sonda só lê e não devolve nome nem telefone', () => {
  it('lista o lote com o porquê e a fila de agora com a avaliação de leitura; nada de claim, posse, código ou envio', async () => {
    const l = leadQuiz({ nome: 'Fulano Detal' });
    const { d, e } = montar([l]);
    const s = await sondarPesada({ agora: SEG_16 }, d);
    expect(s.pesada).toBe(true);
    expect(s.lote.ativo).toBe(true);
    expect(s.fila_agora).toEqual([{ hmac8: hm(String(l.whatsapp)).slice(0, 8), grupo: 'quiz_1411', toque: 1, pagamento: 'link', avaliacao: 'elegivel' }]);
    const json = JSON.stringify(s);
    expect(json).not.toContain('Fulano');
    expect(json).not.toContain(String(l.whatsapp).slice(-8));
    expect(e.ordem).toEqual([]);
    expect(e.enviados).toEqual([]);
  });
});

// ── a 2ª volta da revisão: a cabeça da fila não trava, o valor é o do contrato, a origem filtra o lote, a vaga guardada e as vendas ─────────────────

describe('a fila não trava na cabeça: quem pula por motivo que não fica gravado vai ao fim por 2 h', () => {
  it('4 do quiz presos (posse de outra agente) não seguram o lote: o 5º recebe na rodada seguinte, e o grupo do Pix também chega', async () => {
    const presos = [1, 2, 3, 4].map(n => leadQuiz({ created_time: `2026-11-14T1${n}:00:00.000Z` }));
    const livre = leadQuiz({ created_time: '2026-11-14T15:00:00.000Z' });
    const telPix = telDe(90);
    const doPix = leadQuiz({ whatsapp: telPix, created_time: '2026-11-03T13:50:00.000Z' });
    const presa = new Set(presos.map(l => chaveDaPosse(normalizarTelefoneSd(l.whatsapp) as string)));
    const { d, e } = montar([...presos, livre, doPix], {
      lote: [{ contratoId: 'c1', status: 'recusado', created_at: '2026-11-03T14:00:00.000Z', whatsapp: telPix, origem: 'quiz_solardoc' }],
      contratos: { c1: contrato({}, telPix) },
      over: { posse: async (chave) => (presa.has(chave) ? 'ocupada' : 'livre') },
    });
    const r1 = await rodar(d);
    expect(r1.enviou).toBe(false);
    expect(e.enviados).toHaveLength(0);
    for (const l of presos) expect(e.estados.get(`quiz_rec_adiado:${hm(String(l.whatsapp))}`)?.em).toBe(AGORA.toISOString());
    expect(e.fila[e.fila.length - 1]).toBe(0);   // sem envio e sem trava: a vaga do P5 não fica segurada

    const r2 = await rodar(d, new Date(AGORA.getTime() + 10 * 60_000));
    expect(r2.enviou).toBe(true);
    expect(e.enviados[0]!.tel).toBe(normalizarTelefoneSd(livre.whatsapp));
    const r3 = await rodar(d, new Date(AGORA.getTime() + 20 * 60_000));
    expect(r3.enviou).toBe(true);
    expect(e.enviados.map(x => x.tel)).toContain(normalizarTelefoneSd(telPix));
  });

  it('lead NOVO (quiz há 20 min) passa na frente do lote de resgate: é o 1º das decisões e o 1º a receber; o lote vem na rodada seguinte', async () => {
    const velho = leadQuiz({ created_time: '2026-11-14T10:00:00.000Z' });
    const novo = leadQuiz({ created_time: new Date(AGORA.getTime() - 20 * 60_000).toISOString() });
    const { d, e } = montar([velho, novo]);
    const r1 = await rodar(d);
    expect(r1.decisoes[0]!.hmac8).toBe(hm(String(novo.whatsapp)).slice(0, 8));
    expect(e.enviados[0]!.tel).toBe(normalizarTelefoneSd(novo.whatsapp));
    const r2 = await rodar(d, new Date(AGORA.getTime() + 10 * 60_000));
    expect(r2.enviou).toBe(true);
    expect(e.enviados[1]!.tel).toBe(normalizarTelefoneSd(velho.whatsapp));
  });

  it('lead NOVO preso (posse de outra agente) não trava: vai ao fim e o lote recebe na mesma rodada, sem passar de 8 avaliações', async () => {
    const velho = leadQuiz({ created_time: '2026-11-14T10:00:00.000Z' });
    const novo = leadQuiz({ created_time: new Date(AGORA.getTime() - 20 * 60_000).toISOString() });
    const presa = chaveDaPosse(normalizarTelefoneSd(novo.whatsapp) as string);
    const { d, e } = montar([velho, novo], { over: { posse: async (chave) => (chave === presa ? 'ocupada' : 'livre') } });
    const r1 = await rodar(d);
    expect(r1.decisoes[0]!.hmac8).toBe(hm(String(novo.whatsapp)).slice(0, 8));
    expect(r1.decisoes[0]!.resultado).toBe('pulou');
    expect(r1.avaliados).toBeLessThanOrEqual(8);
    expect(e.enviados[0]!.tel).toBe(normalizarTelefoneSd(velho.whatsapp));
  });

  it('o adiado volta à ordem de sempre depois de 2 h', async () => {
    const preso = leadQuiz({ created_time: '2026-11-14T08:00:00.000Z' });
    const outro = leadQuiz({ created_time: '2026-11-14T09:00:00.000Z' });
    const velho = new Date(AGORA.getTime() - 2 * 3600_000 - 60_000).toISOString();
    const { d, e } = montar([preso, outro], { estados: { [`quiz_rec_adiado:${hm(String(preso.whatsapp))}`]: { em: velho } } });
    await rodar(d);
    expect(e.enviados[0]!.tel).toBe(normalizarTelefoneSd(preso.whatsapp));
  });

  it('sem WhatsApp: o pulo fica gravado e o phone-exists não roda de novo a cada rodada', async () => {
    let consultas = 0;
    const l = leadQuiz();
    const { d, e } = montar([l], { over: { telefoneExiste: async () => { consultas++; return 'nao'; } } });
    await rodar(d);
    await rodar(d, new Date(AGORA.getTime() + 10 * 60_000));
    expect(consultas).toBe(1);
    expect(e.estados.get(`quiz_rec_pulou:${hm(String(l.whatsapp))}`)?.motivo).toBe('sem_whatsapp');
    expect(e.enviados).toHaveLength(0);
  });

  it('a vaga guardada: rodada que parou numa trava deixa os prontos marcados; rodada sem envio e sem trava grava 0', async () => {
    let n = 0;
    const { d, e } = montar([leadQuiz(), leadQuiz()], { over: { tetoHorario: async () => (++n === 1) } });
    const r = await rodar(d);
    expect(r.enviou).toBe(false);
    expect(e.fila[e.fila.length - 1]).toBe(2);
  });
});

describe('o valor no texto é o que o banco vai debitar', () => {
  const tel = telDe(81);
  const lead = (): LeadRec => leadQuiz({ whatsapp: tel, created_time: '2026-11-03T13:50:00.000Z' });
  const lote = [{ contratoId: 'c1', status: 'recusado', created_at: '2026-11-03T14:00:00.000Z', whatsapp: tel, origem: 'lp_solardoc' }];
  it('contrato com adicional do bump (R$ 97): o código novo diz R$ 97, nunca R$ 67', async () => {
    const { d, e } = montar([lead()], { lote, contratos: { c1: contrato({ mensal: 97 }, tel) } });
    await rodar(d);
    expect(e.enviados[0]!.texto).toContain('É a mensalidade de R$ 97');
    expect(e.enviados[0]!.texto).not.toContain('R$ 67');
  });
  it('sem o valor do contrato: o texto não cita valor nenhum', async () => {
    const { d, e } = montar([lead()], { lote, contratos: { c1: contrato({ mensal: null }, tel) } });
    await rodar(d);
    expect(e.enviados[0]!.texto).toContain('É a mensalidade do plano');
    expect(e.enviados[0]!.texto).not.toMatch(/R\$/);
  });
  it('o 2º toque com o código do contrato de R$ 84,90 cita R$ 84,90', () => {
    for (const hmac of ['000000', '000001', '000002']) {
      const t = montarToquePesado({ toque: 2, situacao: 'pix', nome: 'Ana', resultado: null, forma: { tipo: 'codigo' }, hmac, valorMensal: 84.9 });
      expect(t).toContain('R$ 84,90 por mês');
      expect(t).not.toContain('R$ 67');
    }
  });
});

describe('o lote só pega contrato do funil (quiz ou LP)', () => {
  it('renovação, cobrança, código da conversa ou contrato sem origem: fora do lote', async () => {
    for (const origem of ['renovacao', 'dunning', 'conversa_pix', null]) {
      const tel = telDe(85);
      const { d, e } = montar([leadQuiz({ whatsapp: tel, created_time: '2026-11-03T13:50:00.000Z' })], {
        lote: [{ contratoId: 'c1', status: 'recusado', created_at: '2026-11-03T14:00:00.000Z', whatsapp: tel, origem }],
        contratos: { c1: contrato({}, tel) },
      });
      await rodar(d);
      expect(e.enviados).toHaveLength(0);
      expect(e.gerados).toBe(0);
    }
  });
});

describe('as vendas: lidas desde 01/11 enquanto o lote vale, e sempre de pelo menos 8 dias', () => {
  it('durante o lote, desde 01/11; depois dele, 8 dias para trás (a régua vive 7)', async () => {
    const desde: Array<number | undefined> = [];
    const over: Partial<DepsRec> = { vendas: async (_a, dm) => { desde.push(dm); return { sessoes: new Set(), chaves: new Set(), emails: new Set() }; } };
    const a = montar([leadQuiz()], { over });
    await rodar(a.d);
    expect(desde[0]).toBe(Date.parse(LOTE_RESGATE.contratosDesde));
    desde.length = 0;
    const depois = new Date('2026-11-25T15:00:00.000Z');
    const b = montar([leadQuiz({ created_time: '2026-11-25T14:30:00.000Z' })], { over });
    await rodar(b.d, depois);
    expect(desde[0]).toBe(depois.getTime() - 8 * 24 * 3600_000);
  });
});
