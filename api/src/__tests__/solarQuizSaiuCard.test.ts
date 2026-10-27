import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { BancoFalso } from './bancoFalsoQuiz';

// TODO LEAD DO QUIZ SOLAR CAI NA AGENDA (27/10/2026): o lead que deixou o WhatsApp e saiu sem marcar ganha um card da Nilce, criado pelo
// tick `solar_quiz_avisos`. O card NASCE para todo lead; o que muda é QUEM fala com o cliente (decisão do chefe anti-ban):
// FALA (abertura da Duda, a única mensagem) só quando tudo vale; senão nasce MUDO. Banco e WhatsApp em memória; nada alcança a rede.

const h = vi.hoisted(() => ({
  cooldown: false,
  main: null as any,
  ger: null as any,
  enviados: [] as Array<{ numero: string; texto: string }>,
  capi: vi.fn(),
  /** `agenteAtendeEste('duda', tel)`. */
  duda: false,
  /** `estaBloqueado(tel)`. */
  bloqueado: false,
  /** `lerPosse(chave)`: null = conversa sem posse. */
  posse: null as any,
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: (t: string) => h.ger.from(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (numero: string, texto: string) => { h.enviados.push({ numero, texto }); }),
  linhaEmCooldown: vi.fn(() => h.cooldown),
}));
vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.capi }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn(async () => h.bloqueado),
}));
vi.mock('../services/agentes5040/posse', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/posse')>()),
  agenteAtendeEste: vi.fn(async () => h.duda),
  lerPosse: vi.fn(async () => h.posse),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
// A ocupação que as vagas leem é a dos próprios cards do banco falso (o que o tick cria passa a ocupar a agenda).
vi.mock('../services/io/eletropostoVagas', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoVagas')>()),
  carregarCompromissos: vi.fn(async () => (h.ger.tabela('agendamentos') as any[])
    .filter(a => a.status !== 'cancelado' && a.quando)
    .map(a => ({ ts: Date.parse(a.quando), dono: a.vendedor_nome }))),
}));

import router from '../routes/ioSolar';
import { runSolarQuizAvisosTick, camposDeRecuperacao, CHAVES } from '../services/io/solarQuizAviso';
import { vagasSolar, rebaixarSaiuAMudo, cancelarCardsSaiuSemMarcar, remarcarCardSolar, tirarMarcaSaiuDoCard, silenciarLembretesDoCard } from '../services/agentes5040/agendaSolar';
import { textoDeAbertura, bolhaDeAbertura } from '../services/agentes5040/textosAgenda';
import { limparRespostas, limparRespostasExtra, quandoDoAgora } from '../services/io/solarQuiz';
import { TEL_AVISO } from '../services/io/solarEquipe';
import { quandoDoCardTexto, avisoSaiuSemMarcar } from '../services/io/solarQuizTextos';
import { ehCardMudo, ehCardSaiu, caminhoDaFicha } from '../services/agenda/solarRota';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/io/solar', router);

/** Instantes em Brasília (UTC-3). 2026-10-23 é sexta, 24 é sábado, 25 é domingo, 26 é segunda. */
const brt = (ymd: string, hhmm: string): number => Date.parse(`${ymd}T${hhmm}:00-03:00`);
const SEXTA_14H = brt('2026-10-23', '14:00');
const MIN = 60_000;
const hhmmBRT = (iso: string): string => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(11, 16);

const RESP_BOA = {
  conta: '600_1050', cidade: 'Uberlândia-MG', tipo: 'casa', imovel: 'proprio', urgencia: 'ja', concorrente: 'sim', pagamento: 'vista', decisor: 'eu', grupoa: 'nao',
  telhado: 'ceramica', sombra: 'sol', aumento: 'nao', dor: 'sobe', tempo: 'meses', travou: 'caro', desejo: 'viajar', criterio: 'parcela',
};
const RESP_CURIOSA = { ...RESP_BOA, urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado', concorrente: 'nao' };
const LEAD = 'quiz_3491112222';
const TEL = '5534991112222';

function semearLead(id: string, p: {
  tel?: string; atividade: number; resp?: Record<string, unknown>; agendado?: number | null; caminho?: string; pontos?: string; form?: string; nome?: string;
}) {
  const resp = p.resp ?? RESP_BOA;
  h.ger.tabela('leads_meta').push({
    lead_id: id, nome: p.nome ?? 'Ana Souza', whatsapp: p.tel ?? TEL, cidade: 'Uberlândia-MG', agendado_id: p.agendado ?? null,
    form_id: p.form ?? 'quiz_solar', created_time: new Date(p.atividade).toISOString(),
    field_data: [{ name: 'Pontos', values: [p.pontos ?? '80'] }, { name: 'Caminho', values: [p.caminho ?? 'ligacao'] },
      { name: 'utm_source', values: ['meta'] }, { name: 'utm_campaign', values: ['quiz-1'] },
      ...camposDeRecuperacao(limparRespostas(resp), limparRespostasExtra(resp), p.atividade)],
  });
}
const leadsDeN = (n: number) => ({ id: `quiz_349111000${n}`, tel: `553499111000${n}` });

const cartoes = (): any[] => h.ger.tabela('agendamentos');
const lead = (id = LEAD): any => h.ger.tabela('leads_meta').find((l: any) => l.lead_id === id);
const chave = (k: string): any => h.main.tabela('system_state').find((l: any) => l.key === k);
const paraNilce = () => h.enviados.filter(e => e.numero === TEL_AVISO['nilce']);
const primeiraLinha = (c: any): string => String(c.observacao).split('\n')[0];
const tick = (agora: number) => runSolarQuizAvisosTick({ agora });

beforeEach(() => {
  h.main = new BancoFalso();
  h.ger = new BancoFalso();
  h.enviados.length = 0; h.cooldown = false; h.duda = false; h.bloqueado = false; h.posse = null;
  h.capi.mockReset().mockResolvedValue({ ok: true, status: 200 });
  process.env.AGENTES5040_FICHA = '0';
  delete process.env.SOLAR_QUIZ_ESCALA_THIAGO; delete process.env.SOLAR_QUIZ_FILA_MANHA; delete process.env.SOLAR_QUIZ_AVISOS_OFF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SEXTA_14H);
});
afterEach(() => { vi.useRealTimers(); });

describe('o card que FALA: todas as condições do chefe valem', () => {
  it('dentro do horário, nota 80, com a Duda: card em encaixe de "agora", abertura liberada, sem Schedule, T2 com o horário do card', async () => {
    h.duda = true;
    semearLead(LEAD, { atividade: SEXTA_14H });
    const agora = SEXTA_14H + 11 * MIN;
    const r = await tick(agora);
    expect(cartoes()).toHaveLength(1);
    const c = cartoes()[0];
    expect(r.cards).toEqual({ falam: 1, mudos: 0 });
    expect(c).toMatchObject({ vendedor_nome: 'Nilce', created_by: 'lp_solar', status: 'agendado', cliente_telefone: TEL, utm_source: 'meta', utm_campaign: 'quiz-1' });
    expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO');
    expect(ehCardSaiu(c.observacao)).toBe(true);
    expect(ehCardMudo(c.observacao)).toBe(false);
    expect(Date.parse(c.quando)).toBe(quandoDoAgora(agora));                    // o mesmo minuto real do /quiz/agora (14:20)
    expect(c.boas_vindas_at).toBeNull();                                          // a abertura da Duda é a única mensagem
    expect(c.bomdia_at).toBeTruthy(); expect(c.lembrete_5min_at).toBeTruthy();    // ligarAgora: sem bom dia e sem "oi" de 5 min
    expect(lead().agendado_id).toBe(c.id);
    expect(chave(CHAVES.cardSaiu + LEAD)?.value.card_id).toBe(c.id);
    expect(chave(CHAVES.quiz1o + LEAD)).toBeTruthy();                             // o claim do 1º contato, ganho ANTES do insert
    expect(chave(`aviso_antigo:${c.id}`)).toBeTruthy();                           // a ficha do 5040 não manda um 2º aviso
    expect(h.capi).not.toHaveBeenCalled();                                        // o cliente não agendou: sem Schedule
    expect(paraNilce()).toHaveLength(1);
    const t = paraNilce()[0].texto;
    expect(t.split('\n')[0]).toContain('SAIU SEM MARCAR');
    expect(t).toContain('Quando: hoje, 14:20 (já está na sua agenda)');
    expect(t).not.toMatch(/[—–]/);
  });

  it('fora do horário (sexta 18:15) e com a Duda: card na próxima vaga da Nilce, normal (leva bom dia e "oi" no dia), e a lista das 07:00 diz o horário dele', async () => {
    h.duda = true;
    const sexta1815 = brt('2026-10-23', '18:15');
    vi.setSystemTime(sexta1815);
    semearLead(LEAD, { atividade: sexta1815 });
    await tick(sexta1815 + 12 * MIN);
    expect(cartoes()).toHaveLength(1);
    const c = cartoes()[0];
    expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO');
    expect(c.boas_vindas_at).toBeNull();
    expect(c.bomdia_at ?? null).toBeNull();            // o card é de outro dia: o bom dia fala no dia dele
    expect(c.lembrete_5min_at ?? null).toBeNull();
    expect(hhmmBRT(c.quando)).toBe('08:00');           // segunda, 26/10: sábado e domingo não são dias de ligação
    expect(c.quando).toBe(new Date(brt('2026-10-26', '08:00')).toISOString());
    expect(h.enviados).toHaveLength(0);                // fora do horário nada sai, só a fila das 07:00
    expect(chave(`aviso_antigo:${c.id}`)).toBeTruthy();
    await tick(brt('2026-10-24', '07:02'));            // sábado
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain('Na sua agenda: seg 26/10, 08:00');
    expect(cartoes()).toHaveLength(1);
  });

  it('o 2º lead que quer falar na mesma rodada espera a próxima (1 que fala por rodada), e não vira mudo', async () => {
    h.duda = true;
    const a = leadsDeN(1), b = leadsDeN(2);
    semearLead(a.id, { tel: a.tel, atividade: SEXTA_14H, nome: 'Ana' });
    semearLead(b.id, { tel: b.tel, atividade: SEXTA_14H, nome: 'Beto' });
    const r1 = await tick(SEXTA_14H + 11 * MIN);
    expect(r1.cards).toEqual({ falam: 1, mudos: 0 });
    expect(cartoes()).toHaveLength(1);
    expect(h.main.tabela('system_state').filter((l: any) => l.key.startsWith(CHAVES.quiz1o))).toHaveLength(1);
    const r2 = await tick(SEXTA_14H + 12 * MIN);
    expect(r2.cards).toEqual({ falam: 1, mudos: 0 });
    expect(cartoes()).toHaveLength(2);
    expect(cartoes().every((c: any) => !ehCardMudo(c.observacao))).toBe(true);
  });
});

describe('o card MUDO: cada condição do A que falha', () => {
  const preparos: Array<[string, () => void, Partial<{ caminho: string; pontos: string; resp: Record<string, unknown> }>]> = [
    ['curioso', () => { h.duda = true; }, { caminho: 'curioso', pontos: '5', resp: RESP_CURIOSA }],
    ['fora do padrão (bloqueado)', () => { h.duda = true; h.bloqueado = true; }, {}],
    ['a Duda não atende este telefone', () => { h.duda = false; }, {}],
    ['a Nilce já falou com ele (solar_falei)', () => {
      h.duda = true;
      h.main.tabela('system_state').push({ key: CHAVES.falei + LEAD, value: { em: new Date(SEXTA_14H + 5 * MIN).toISOString() }, updated_at: new Date(SEXTA_14H + 5 * MIN).toISOString() });
    }, {}],
    ['o tick antigo já mandou o "não marcou" (solar_boasvindas_sent)', () => {
      h.duda = true;
      h.main.tabela('system_state').push({ key: `solar_boasvindas_sent:quiz_${LEAD}`, value: {}, updated_at: new Date(SEXTA_14H).toISOString() });
    }, {}],
    ['o claim solar_quiz_1o já existe (outra rodada ou o tick antigo falou primeiro)', () => {
      h.duda = true;
      h.main.tabela('system_state').push({ key: CHAVES.quiz1o + LEAD, value: { tipo: 'nao_marcou' }, updated_at: new Date(SEXTA_14H).toISOString() });
    }, {}],
  ];
  for (const [nome, preparar, lead_] of preparos) {
    it(`${nome}: o card nasce mudo, com tudo carimbado, e o claim do 1º contato não é nosso`, async () => {
      preparar();
      semearLead(LEAD, { atividade: SEXTA_14H, ...lead_ });
      const antes = h.main.tabela('system_state').filter((l: any) => l.key === CHAVES.quiz1o + LEAD).length;
      const r = await tick(SEXTA_14H + 11 * MIN);
      expect(r.cards).toEqual({ falam: 0, mudos: 1 });
      expect(cartoes()).toHaveLength(1);
      const c = cartoes()[0];
      expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO');
      expect(c.observacao).toContain('Onde: Casa');
      expect(ehCardMudo(c.observacao)).toBe(true);
      expect(c.boas_vindas_at).toBeTruthy(); expect(c.bomdia_at).toBeTruthy(); expect(c.lembrete_5min_at).toBeTruthy();
      expect(h.main.tabela('system_state').filter((l: any) => l.key === CHAVES.quiz1o + LEAD)).toHaveLength(antes);
      expect(lead().agendado_id).toBe(c.id);
      expect(h.capi).not.toHaveBeenCalled();
    });
  }

  it('curioso: card na próxima vaga (nunca "ligar agora"), na grade :00/:30 e com 30 min de antecedência', async () => {
    semearLead(LEAD, { atividade: SEXTA_14H, caminho: 'curioso', pontos: '5', resp: RESP_CURIOSA });
    const agora = SEXTA_14H + 11 * MIN;
    await tick(agora);
    const c = cartoes()[0];
    expect(hhmmBRT(c.quando)).toBe('15:00');                           // 14:11 + 30 min = 14:41, a 1ª vaga é 15:00
    expect(Date.parse(c.quando)).not.toBe(quandoDoAgora(agora));
    expect(c.observacao).toContain('Curioso (');
    // O aviso à Nilce continua (ordem do dono) e diz o horário do card.
    expect(paraNilce()[0].texto).toContain('Quando: hoje, 15:00 (já está na sua agenda)');
  });

  it('o 2º lead na mesma vaga cai na vaga seguinte (índice único), e o minuto ocupado do "agora" empurra +5 min', async () => {
    const a = leadsDeN(1), b = leadsDeN(2);
    semearLead(a.id, { tel: a.tel, atividade: SEXTA_14H, caminho: 'curioso', pontos: '5', resp: RESP_CURIOSA });
    semearLead(b.id, { tel: b.tel, atividade: SEXTA_14H, caminho: 'curioso', pontos: '5', resp: RESP_CURIOSA });
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes().map((c: any) => hhmmBRT(c.quando)).sort()).toEqual(['15:00', '15:30']);
    const c = leadsDeN(3), d = leadsDeN(4);
    semearLead(c.id, { tel: c.tel, atividade: SEXTA_14H });
    semearLead(d.id, { tel: d.tel, atividade: SEXTA_14H });
    await tick(SEXTA_14H + 12 * MIN);
    const agoras = cartoes().filter((x: any) => x.cliente_telefone === c.tel || x.cliente_telefone === d.tel).map((x: any) => hhmmBRT(x.quando)).sort();
    expect(agoras).toEqual(['14:20', '14:25']);
  });
});

describe('quando o card nasce, e quando NÃO nasce', () => {
  it('21h às 7h o tick não cria card; a 1ª rodada das 7h cria, e a lista das 07:00 já diz o horário dele', async () => {
    const sexta2110 = brt('2026-10-23', '21:10');
    vi.setSystemTime(sexta2110);
    semearLead(LEAD, { atividade: sexta2110 });
    await tick(sexta2110 + 11 * MIN);                                  // 21:21
    await tick(brt('2026-10-24', '06:50'));
    expect(cartoes()).toHaveLength(0);
    expect(chave(CHAVES.manha + LEAD)).toBeTruthy();                   // o aviso foi para a fila das 07:00
    await tick(brt('2026-10-24', '07:05'));                            // sábado
    expect(cartoes()).toHaveLength(1);
    const c = cartoes()[0];
    expect(c.quando).toBe(new Date(brt('2026-10-26', '08:00')).toISOString());   // lead mais velho que a janela: próxima vaga
    expect(chave(`aviso_antigo:${c.id}`)).toBeTruthy();                // o `abandono:` já existia: a ficha não manda um 2º aviso
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain('Na sua agenda: seg 26/10, 08:00');
  });

  it('duas rodadas do tick (e duas ao mesmo tempo): um card só', async () => {
    h.duda = true;
    semearLead(LEAD, { atividade: SEXTA_14H });
    await Promise.all([tick(SEXTA_14H + 11 * MIN), tick(SEXTA_14H + 11 * MIN)]);
    await tick(SEXTA_14H + 12 * MIN);
    await tick(SEXTA_14H + 20 * MIN);
    expect(cartoes()).toHaveLength(1);
    expect(h.main.tabela('system_state').filter((l: any) => l.key.startsWith(CHAVES.cardSaiu))).toHaveLength(1);
    expect(paraNilce()).toHaveLength(1);                               // e um aviso só
  });

  it('lead com 3 h (aviso expirado): o card sai, sem aviso T2 e sem aviso_antigo (a ficha avisa a Nilce)', async () => {
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 3 * 3_600_000);                             // 17:00, sexta
    expect(cartoes()).toHaveLength(1);
    const c = cartoes()[0];
    expect(Date.parse(c.quando)).toBeGreaterThan(SEXTA_14H + 3 * 3_600_000);
    expect(['00', '30']).toContain(hhmmBRT(c.quando).slice(3));
    expect(h.enviados).toHaveLength(0);
    expect(chave(CHAVES.abandono + LEAD)).toBeUndefined();
    expect(chave(`aviso_antigo:${c.id}`)).toBeUndefined();
  });

  it('o `abandono:` já existia antes do card (fila das 22h, backfill): o aviso_antigo sai junto com o card', async () => {
    semearLead(LEAD, { atividade: SEXTA_14H });
    h.main.tabela('system_state').push({ key: CHAVES.abandono + LEAD, value: { em: new Date(SEXTA_14H + 11 * MIN).toISOString() }, updated_at: new Date(SEXTA_14H + 11 * MIN).toISOString() });
    await tick(SEXTA_14H + 3 * 3_600_000);
    expect(cartoes()).toHaveLength(1);
    expect(chave(`aviso_antigo:${cartoes()[0].id}`)).toBeTruthy();
  });

  it('telefone que já tem card agendado no futuro: não cria outro, só liga o lead a ele', async () => {
    const existente = {
      id: 500, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_nome: 'Ana', cliente_telefone: TEL, status: 'agendado',
      created_by: 'lp_solar', created_at: new Date(SEXTA_14H - MIN).toISOString(), observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO',
    };
    cartoes().push(existente);
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 11 * MIN);
    await tick(SEXTA_14H + 12 * MIN);
    expect(cartoes()).toHaveLength(1);
    expect(lead().agendado_id).toBe(500);
    expect(paraNilce()).toHaveLength(0);                               // quem marcou não é abandono
  });

  it('o card SAIU SEM MARCAR de outra rodada (claim perdido) também só é ligado, nunca duplicado', async () => {
    cartoes().push({
      id: 600, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_nome: 'Ana', cliente_telefone: TEL, status: 'agendado',
      created_by: 'lp_solar', created_at: new Date(SEXTA_14H).toISOString(), observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa',
    });
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes()).toHaveLength(1);
    expect(lead().agendado_id).toBe(600);
  });

  it('até 5 cards mudos por rodada; o 6º sai na rodada seguinte', async () => {
    for (let n = 1; n <= 6; n++) { const l = leadsDeN(n); semearLead(l.id, { tel: l.tel, atividade: SEXTA_14H, nome: `Lead ${n}` }); }
    const r1 = await tick(SEXTA_14H + 11 * MIN);
    expect(r1.cards).toEqual({ falam: 0, mudos: 5 });
    expect(cartoes()).toHaveLength(5);
    const r2 = await tick(SEXTA_14H + 12 * MIN);
    expect(r2.cards).toEqual({ falam: 0, mudos: 1 });
    expect(cartoes()).toHaveLength(6);
    expect(cartoes().every((c: any) => ehCardMudo(c.observacao))).toBe(true);
  });

  it('criar card não gasta o "1 envio por rodada": com 2 cards na rodada, ainda sai UM aviso T2', async () => {
    const a = leadsDeN(1), b = leadsDeN(2);
    semearLead(a.id, { tel: a.tel, atividade: SEXTA_14H });
    semearLead(b.id, { tel: b.tel, atividade: SEXTA_14H });
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes()).toHaveLength(2);
    expect(paraNilce()).toHaveLength(1);
    await tick(SEXTA_14H + 12 * MIN);
    expect(paraNilce()).toHaveLength(2);                               // o outro aviso na rodada seguinte, com o horário do card dele
    expect(paraNilce().every(e => e.texto.includes('(já está na sua agenda)'))).toBe(true);
  });

  it('SOLAR_QUIZ_AVISOS_OFF=1 cala os AVISOS à equipe, mas o card continua nascendo (o lead cai na agenda de qualquer jeito)', async () => {
    process.env.SOLAR_QUIZ_AVISOS_OFF = '1';
    semearLead(LEAD, { atividade: SEXTA_14H });
    const r = await tick(SEXTA_14H + 11 * MIN);
    expect(r.motivo).toBe('desligado');
    expect(cartoes()).toHaveLength(1);
    expect(lead().agendado_id).toBe(cartoes()[0].id);
    expect(h.enviados).toHaveLength(0);
    expect(chave(CHAVES.abandono + LEAD)).toBeUndefined();
  });

  it('aviso_antigo só existe com `abandono:` (regra E): sem fila das 07:00 e fora do horário, ninguém avisa a Nilce e a ficha cuida do card', async () => {
    process.env.SOLAR_QUIZ_FILA_MANHA = '0';
    const sexta1815 = brt('2026-10-23', '18:15');
    vi.setSystemTime(sexta1815);
    semearLead(LEAD, { atividade: sexta1815 });
    await tick(sexta1815 + 12 * MIN);
    expect(cartoes()).toHaveLength(1);
    expect(chave(CHAVES.abandono + LEAD)).toBeUndefined();
    expect(chave(`aviso_antigo:${cartoes()[0].id}`)).toBeUndefined();
  });

  it('o card que fala NÃO nasce com posse existente (qualquer dona): nasce MUDO', async () => {
    h.duda = true;
    h.posse = { dona: 'carla', estado: 'viva' };
    semearLead(LEAD, { atividade: SEXTA_14H });
    const r = await tick(SEXTA_14H + 11 * MIN);
    expect(r.cards).toEqual({ falam: 0, mudos: 1 });
    expect(ehCardMudo(cartoes()[0].observacao)).toBe(true);
    expect(chave(CHAVES.quiz1o + LEAD)).toBeUndefined();
  });

  it('o card só nasce falando até 20:50 (20:49 fala; 20:51 já nasce MUDO); das 21h às 7h não cria', async () => {
    h.duda = true;
    const a = brt('2026-10-23', '20:49');
    vi.setSystemTime(a);
    semearLead(LEAD, { atividade: a - 30 * MIN });
    const r1 = await tick(a);
    expect(r1.cards).toEqual({ falam: 1, mudos: 0 });
    h.ger.zerar(); h.main.zerar();
    const b = brt('2026-10-23', '20:51');
    vi.setSystemTime(b);
    semearLead(LEAD, { atividade: b - 30 * MIN });
    const r2 = await tick(b);
    expect(r2.cards).toEqual({ falam: 0, mudos: 1 });
    expect(ehCardMudo(cartoes()[0].observacao)).toBe(true);
    h.ger.zerar(); h.main.zerar();
    const c = brt('2026-10-23', '21:00');
    vi.setSystemTime(c);
    semearLead(LEAD, { atividade: c - 30 * MIN });
    const r3 = await tick(c);
    expect(r3.cards).toEqual({ falam: 0, mudos: 0 });
    expect(cartoes()).toHaveLength(0);
  });

  it('quem já clicou "agora" ou já marcou (agendado_id) não ganha card', async () => {
    semearLead('quiz_1', { atividade: SEXTA_14H, agendado: 5 });
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes()).toHaveLength(0);
  });

  it('rascunho do quiz antigo (sem os códigos) é ignorado', async () => {
    h.ger.tabela('leads_meta').push({ lead_id: 'quiz_velho', nome: 'Velho', whatsapp: TEL, cidade: 'X', agendado_id: null, form_id: 'quiz_solar',
      created_time: new Date(SEXTA_14H).toISOString(), field_data: [{ name: 'Pontos', values: ['90'] }] });
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes()).toHaveLength(0);
  });
});

describe('modo teste (qteste_ / lp_solar_teste) segue isolado', () => {
  const SEGREDO = () => String(process.env.CRON_SECRET);
  it('o rascunho de teste vira card lp_solar_teste, rodando 2x continua 1 card, com os carimbos, sem mensagem, e desfaz com /cancelar', async () => {
    h.duda = true;
    semearLead('qteste_3491112222', { atividade: SEXTA_14H, form: 'quiz_solar_teste' });
    await tick(SEXTA_14H + 15 * MIN);
    await tick(SEXTA_14H + 16 * MIN);
    expect(cartoes()).toHaveLength(1);
    const c = cartoes()[0];
    expect(c.created_by).toBe('lp_solar_teste');
    expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO');
    expect(c.boas_vindas_at).toBeTruthy(); expect(c.bomdia_at).toBeTruthy(); expect(c.lembrete_5min_at).toBeTruthy();
    expect(lead('qteste_3491112222').agendado_id).toBe(c.id);
    expect(h.enviados).toHaveLength(0);
    expect(h.capi).not.toHaveBeenCalled();
    expect(chave(CHAVES.quiz1o + 'qteste_3491112222')).toBeUndefined();
    expect(chave(`aviso_antigo:${c.id}`)).toBeUndefined();
    const r = await request(app).post(`/io/solar/quiz/teste/${c.id}/cancelar`).set('x-cron-secret', SEGREDO()).send({});
    expect(r.status).toBe(200);
    expect(cartoes()[0].status).toBe('cancelado');
  });
});

// ── o cliente volta ao quiz e marca: o card SAIU é CANCELADO e o caminho normal segue (card novo) ──────────────────
const RESP_BODY = { nome: 'Ana Souza', tel: TEL, respostas: RESP_BOA, event_id: 'agd_abc123xyz' };
const STAMP = '2026-10-23T16:30:00.000Z';
function semearCardSaiu(over: Record<string, unknown> = {}): void {
  cartoes().push({
    id: 900, vendedor_nome: 'Nilce', quando: new Date(brt('2026-10-26', '08:00')).toISOString(), cliente_nome: 'Ana Souza', cliente_telefone: TEL,
    status: 'agendado', created_by: 'lp_solar', created_at: new Date(SEXTA_14H - 10 * MIN).toISOString(), boas_vindas_at: STAMP, bomdia_at: STAMP, lembrete_5min_at: STAMP,
    observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa\nConta de luz: R$ 600 a R$ 1.050', ...over,
  });
  semearLead(LEAD, { atividade: SEXTA_14H - 20 * MIN, agendado: 900 });
}
const agendar = (extra: Record<string, unknown> = {}) =>
  request(app).post('/io/solar/quiz/agendar').send({ ...RESP_BODY, ymd: '2026-10-23', h: '16:30', dono: 'Nilce', ...extra });
const status = (id: number): string => cartoes().find((c: any) => c.id === id).status;
const schedules = () => h.capi.mock.calls.map(c => c[0]).filter((e: any) => e.nome === 'Schedule');

describe('o cliente volta ao quiz e marca: cancela o card SAIU SEM MARCAR e cria o card novo (sem 409)', () => {
  it('/quiz/agendar com o card SAIU no FUTURO: o SAIU é cancelado, nasce card novo normal, com Schedule, aviso à Nilce e agendado_id novo', async () => {
    semearCardSaiu();
    const r = await agendar();
    expect(r.status).toBe(200);
    expect(r.body.id).not.toBe(900);
    expect(status(900)).toBe('cancelado');
    const novo = cartoes().find((c: any) => c.id === r.body.id);
    expect(cartoes()).toHaveLength(2);
    expect(novo.status).toBe('agendado');
    expect(novo.quando).toBe(new Date(brt('2026-10-23', '16:30')).toISOString());
    expect(primeiraLinha(novo)).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO');
    expect(novo.boas_vindas_at ?? null).toBeNull();                          // card normal: a confirmação normal ao cliente sai
    expect(lead().agendado_id).toBe(novo.id);
    expect(schedules()).toHaveLength(1);
    expect(paraNilce()).toHaveLength(1);                                       // o aviso do /agendar à consultora
  });

  it('com o card SAIU já no PASSADO (criado ontem, ainda "agendado"): também é cancelado', async () => {
    semearCardSaiu({ quando: new Date(SEXTA_14H - 3 * 3_600_000).toISOString(), created_at: new Date(SEXTA_14H - 30 * 3_600_000).toISOString() });
    const r = await agendar();
    expect(r.status).toBe(200);
    expect(status(900)).toBe('cancelado');
    expect(cartoes().filter((c: any) => c.status === 'agendado')).toHaveLength(1);
    expect(schedules()).toHaveLength(1);
  });

  it('de qualquer dono (card SAIU do Diego, o da vistoria): cancelado, e o card novo nasce normal', async () => {
    semearCardSaiu({ vendedor_nome: 'Diego' });
    const r = await agendar();
    expect(r.status).toBe(200);
    expect(status(900)).toBe('cancelado');
    expect(cartoes().find((c: any) => c.id === r.body.id).vendedor_nome).toBe('Nilce');
  });

  it('card SAIU criado há mais de 48 h não é mexido, e card que não é SAIU (o que o cliente escolheu) nunca é cancelado: 409 "ja marcado"', async () => {
    semearCardSaiu({ created_at: new Date(SEXTA_14H - 50 * 3_600_000).toISOString() });
    const r1 = await agendar();
    expect(r1.status).toBe(200);
    expect(status(900)).toBe('agendado');
    h.ger.zerar();
    cartoes().push({ id: 902, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(SEXTA_14H - 3 * 3_600_000).toISOString(), observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO' });
    const r2 = await agendar();
    expect(r2.status).toBe(409);
    expect(r2.body.error).toBe('ja marcado');
    expect(status(902)).toBe('agendado');
  });

  it('409 "ja marcado" com um card SAIU no telefone: nada é cancelado e o agendado_id antigo do lead fica intacto', async () => {
    semearCardSaiu();
    cartoes().push({ id: 903, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(SEXTA_14H - 3 * 3_600_000).toISOString(), observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO' });
    const r = await agendar();
    expect(r.status).toBe(409);
    expect(status(900)).toBe('agendado');
    expect(lead().agendado_id).toBe(900);
    expect(schedules()).toHaveLength(0);
  });

  it('dois /quiz/agendar ao mesmo tempo (clique duplo): um card novo só, o SAIU cancelado, um Schedule só', async () => {
    semearCardSaiu();
    const [a, b] = await Promise.all([agendar(), agendar()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(status(900)).toBe('cancelado');
    expect(cartoes().filter((c: any) => c.status === 'agendado')).toHaveLength(1);
    expect(schedules()).toHaveLength(1);
    expect(lead().agendado_id).toBe(cartoes().find((c: any) => c.status === 'agendado').id);
  });

  it('o card SAIU que o TICK acabou de criar (pelo banco, antes do clique) também é cancelado pela rota', async () => {
    vi.setSystemTime(SEXTA_14H + 11 * MIN);
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 11 * MIN);
    const saiu = cartoes()[0];
    expect(ehCardSaiu(saiu.observacao)).toBe(true);
    const r = await agendar();
    expect(r.status).toBe(200);
    expect(status(saiu.id)).toBe('cancelado');
    expect(lead().agendado_id).toBe(r.body.id);
    expect(r.body.id).not.toBe(saiu.id);
  });

  it('cancelarCardsSaiuSemMarcar é idempotente e nunca cancela o card novo (exceto) nem card que não é SAIU', async () => {
    semearCardSaiu();
    cartoes().push({ id: 950, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(SEXTA_14H).toISOString(), observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO' });
    expect(await cancelarCardsSaiuSemMarcar('3491112222', 900)).toEqual([]);          // o único SAIU é o excetuado
    expect(await cancelarCardsSaiuSemMarcar('3491112222')).toEqual([900]);
    expect(await cancelarCardsSaiuSemMarcar('3491112222')).toEqual([]);               // a 2ª vez não acha nada
    expect(status(950)).toBe('agendado');
  });

  it('/quiz/agora com o card SAIU: o SAIU é cancelado e nasce o card do "agora" (aviso T1, Schedule, lembretes carimbados)', async () => {
    semearCardSaiu();
    const r = await request(app).post('/io/solar/quiz/agora').send(RESP_BODY);
    expect(r.status).toBe(200);
    expect(r.body.id).not.toBe(900);
    expect(status(900)).toBe('cancelado');
    const novo = cartoes().find((c: any) => c.id === r.body.id);
    expect(primeiraLinha(novo)).toBe('LP SOLAR QUIZ · AGORA');
    expect(Date.parse(novo.quando)).toBe(quandoDoAgora(SEXTA_14H));
    expect(novo.lembrete_5min_at).toBeTruthy(); expect(novo.bomdia_at).toBeTruthy();
    expect(lead().agendado_id).toBe(novo.id);
    expect(schedules()).toHaveLength(1);
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto.split('\n')[0]).toContain('LIGAR AGORA');
  });

  it('se o card novo não nasce (horário tomado, 409), o card SAIU continua "agendado" (nunca foi cancelado) e o lead segue ligado a ele', async () => {
    semearCardSaiu();
    cartoes().push({ id: 901, vendedor_nome: 'Nilce', quando: new Date(brt('2026-10-23', '16:30')).toISOString(), cliente_telefone: '5534988887777', status: 'agendado', created_by: 'lp_solar' });
    const r = await agendar();
    expect(r.status).toBe(409);
    expect(status(900)).toBe('agendado');
    expect(lead().agendado_id).toBe(900);
    expect(schedules()).toHaveLength(0);
  });

  it('modo teste não cancela card real', async () => {
    semearCardSaiu();
    const r = await request(app).post('/io/solar/quiz/agendar').set('x-cron-secret', String(process.env.CRON_SECRET))
      .send({ ...RESP_BODY, ymd: '2026-10-23', h: '16:30', dono: 'Nilce', teste: true });
    expect(r.status).toBe(200);
    expect(status(900)).toBe('agendado');
  });
});

describe('card que FALA e cuja abertura não saiu vira MUDO (rebaixarSaiuAMudo)', () => {
  it('troca a 1ª linha, carimba os 3 campos, deixa o resto da ficha, e a régua do dia (Giovanna) o reconhece como MUDO', async () => {
    h.duda = true;
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 11 * MIN);
    const c = cartoes()[0];
    expect(c.boas_vindas_at).toBeNull();
    const resto = c.observacao.split('\n').slice(1).join('\n');
    expect(await rebaixarSaiuAMudo(c.id)).toBe(true);
    const depois = cartoes()[0];
    expect(primeiraLinha(depois)).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO');
    expect(depois.observacao.split('\n')[1]).toBe('Onde: Casa');                  // o tipo do imóvel não se perde
    expect(depois.observacao.split('\n').slice(2).join('\n')).toBe(resto);       // o resto da ficha fica igual
    expect(depois.boas_vindas_at).toBeTruthy(); expect(depois.bomdia_at).toBeTruthy(); expect(depois.lembrete_5min_at).toBeTruthy();
    expect(ehCardMudo(depois.observacao)).toBe(true);       // solarAgendaGiovanna exclui por este mesmo teste
    expect(await rebaixarSaiuAMudo(c.id)).toBe(false);      // já é MUDO: não toca
  });
  it('não toca card que não é SAIU (o que o cliente escolheu) nem card que não existe', async () => {
    cartoes().push({ id: 7, status: 'agendado', observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO', boas_vindas_at: null });
    expect(await rebaixarSaiuAMudo(7)).toBe(false);
    expect(await rebaixarSaiuAMudo(99)).toBe(false);
    expect(cartoes()[0].boas_vindas_at).toBeNull();
  });
});

describe('rebaixar a MUDO: filtro pela marca, varredura do tick e falha parcial', () => {
  it('não depende do texto inteiro da observação (quem mexeu nela no meio do caminho não faz falhar) e não toca MUDO nem card normal', async () => {
    cartoes().push({ id: 31, status: 'agendado', observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Rural · LIGAÇÃO\nConta de luz: x\nNota da Nilce', boas_vindas_at: null });
    cartoes().push({ id: 32, status: 'agendado', observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa', boas_vindas_at: null });
    cartoes().push({ id: 33, status: 'agendado', observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO', boas_vindas_at: null });
    expect(await rebaixarSaiuAMudo(31)).toBe(true);
    expect(cartoes()[0].observacao).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Rural\nConta de luz: x\nNota da Nilce');
    expect(await rebaixarSaiuAMudo(32)).toBe(false);
    expect(await rebaixarSaiuAMudo(33)).toBe(false);
    expect(cartoes()[1].boas_vindas_at).toBeNull(); expect(cartoes()[2].boas_vindas_at).toBeNull();
  });

  it('se o rebaixamento inteiro falha, ao menos o bom dia e o "oi" de 5 min do dia ficam carimbados (boas_vindas_at fica nulo para tentar de novo)', async () => {
    cartoes().push({ id: 41, status: 'agendado', observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO', boas_vindas_at: null, bomdia_at: null, lembrete_5min_at: null });
    const orig = h.ger.from.bind(h.ger);
    let primeira = true;
    h.ger.from = (t: string) => {
      const q = orig(t);
      if (t !== 'agendamentos') return q;
      const up = q.update;
      q.update = (p: any) => {
        const r = up(p);
        if (primeira && 'observacao' in p) { primeira = false; r.then = (ok: any, ko: any) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, ko); }
        return r;
      };
      return q;
    };
    expect(await rebaixarSaiuAMudo(41)).toBe(false);
    expect(cartoes()[0].bomdia_at).toBeTruthy(); expect(cartoes()[0].lembrete_5min_at).toBeTruthy();
    expect(cartoes()[0].boas_vindas_at).toBeNull();
    expect(primeiraLinha(cartoes()[0])).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO');
  });

  it('a reserva do rebaixamento não cala o bom dia e o "oi" de um card que a Duda desmarcou no meio do caminho', async () => {
    cartoes().push({ id: 42, status: 'agendado', observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO', boas_vindas_at: null, bomdia_at: null, lembrete_5min_at: null });
    const orig = h.ger.from.bind(h.ger);
    h.ger.from = (t: string) => {
      const q = orig(t);
      if (t !== 'agendamentos') return q;
      const up = q.update;
      q.update = (p: any) => {
        const r = up(p);
        if ('observacao' in p) {   // o update principal falha, e antes disso a Duda tira a marca do card
          cartoes()[0].observacao = 'LP SOLAR QUIZ · Casa · LIGAÇÃO';
          r.then = (ok: any, ko: any) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, ko);
        }
        return r;
      };
      return q;
    };
    expect(await rebaixarSaiuAMudo(42)).toBe(false);
    expect(cartoes()[0].bomdia_at).toBeNull(); expect(cartoes()[0].lembrete_5min_at).toBeNull();
  });

  it('remarcarCardSolar e tirarMarcaSaiuDoCard carimbam boas_vindas_at quando estava nulo (a Duda já confirmou na conversa) e não trocam o que existia', async () => {
    cartoes().push({ id: 80, vendedor_nome: 'Nilce', quando: new Date(brt('2026-10-26', '08:00')).toISOString(), status: 'agendado', created_by: 'lp_solar', boas_vindas_at: null, historico: null,
      observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO' });
    expect(await remarcarCardSolar(80, new Date(brt('2026-10-26', '09:15')).toISOString())).toBe('ok');
    expect(cartoes()[0].boas_vindas_at).toBeTruthy();
    cartoes().push({ id: 81, vendedor_nome: 'Nilce', quando: new Date(brt('2026-10-26', '10:00')).toISOString(), status: 'agendado', created_by: 'lp_solar', boas_vindas_at: STAMP, historico: null,
      observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa' });
    expect(await remarcarCardSolar(81, new Date(brt('2026-10-26', '11:15')).toISOString())).toBe('ok');
    expect(cartoes()[1].boas_vindas_at).toBe(STAMP);
  });

  it('o tick (cards) varre o card que fala e passou de 15 min sem abertura, MESMO com SOLAR_BOASVINDAS_OFF=1; antes de 15 min ou já MUDO, não toca', async () => {
    process.env.SOLAR_BOASVINDAS_OFF = '1';
    const fala = (id: number, minAtras: number) => ({
      id, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_telefone: `55349911100${id}`, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(SEXTA_14H - minAtras * MIN).toISOString(), boas_vindas_at: null, bomdia_at: null, lembrete_5min_at: null,
      observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO\nConta de luz: x',
    });
    cartoes().push(fala(51, 16), fala(52, 10), { ...fala(53, 20), boas_vindas_at: '2026-10-23T16:00:00.000Z' });
    await tick(SEXTA_14H);
    expect(ehCardMudo(cartoes()[0].observacao)).toBe(true);
    expect(cartoes()[0].boas_vindas_at).toBeTruthy();
    expect(ehCardMudo(cartoes()[1].observacao)).toBe(false);                      // 10 min: a Duda ainda tem a vez
    expect(ehCardMudo(cartoes()[2].observacao)).toBe(false);                      // abertura saiu (boas_vindas_at carimbado): continua falando
    delete process.env.SOLAR_BOASVINDAS_OFF;
  });

  it('a varredura roda também de madrugada (rebaixar não envia nada), e o card novo continua sem nascer das 21h às 7h', async () => {
    const noite = brt('2026-10-23', '23:30');
    vi.setSystemTime(noite);
    cartoes().push({ id: 61, vendedor_nome: 'Nilce', quando: new Date(noite + 8 * 3_600_000).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(noite - 20 * MIN).toISOString(), boas_vindas_at: null, observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO' });
    await tick(noite);
    expect(ehCardMudo(cartoes()[0].observacao)).toBe(true);
    expect(cartoes()).toHaveLength(1);
  });
});

describe('o lead que ganhou OUTRO card no meio do caminho: o SAIU sai da agenda', () => {
  /** Faz o lead aparecer com card (777) no instante em que o tick tenta ligá-lo, como se o cliente tivesse marcado agora. */
  function clienteMarcaNoMeio(): void {
    const orig = h.ger.from.bind(h.ger);
    h.ger.from = (t: string) => {
      const q = orig(t);
      if (t !== 'leads_meta') return q;
      const up = q.update;
      q.update = (p: any) => { if ('agendado_id' in p && p.agendado_id !== 777) lead().agendado_id = 777; return up(p); };
      return q;
    };
  }
  it('card recém-criado: o lead já tinha outro card, então o SAIU novo é cancelado', async () => {
    clienteMarcaNoMeio();
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0].status).toBe('cancelado');
    expect(lead().agendado_id).toBe(777);
  });
  it('relink de card criado numa rodada anterior: lead em outro card, o SAIU é cancelado; lead sem outro card não é', async () => {
    cartoes().push({ id: 600, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(SEXTA_14H).toISOString(), boas_vindas_at: STAMP, observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa' });
    h.main.tabela('system_state').push({ key: CHAVES.cardSaiu + LEAD, value: { card_id: 600 }, updated_at: new Date(SEXTA_14H).toISOString() });
    semearLead(LEAD, { atividade: SEXTA_14H });
    clienteMarcaNoMeio();
    await tick(SEXTA_14H + 11 * MIN);
    expect(cartoes()[0].status).toBe('cancelado');
    // sem outro card: o relink simples liga e o card fica
    h.ger = new BancoFalso(); h.main = new BancoFalso();
    cartoes().push({ id: 601, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 3_600_000).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
      created_at: new Date(SEXTA_14H).toISOString(), boas_vindas_at: STAMP, observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa' });
    h.main.tabela('system_state').push({ key: CHAVES.cardSaiu + LEAD, value: { card_id: 601 }, updated_at: new Date(SEXTA_14H).toISOString() });
    semearLead(LEAD, { atividade: SEXTA_14H });
    await tick(SEXTA_14H + 12 * MIN);
    expect(cartoes()[0].status).toBe('agendado');
    expect(lead().agendado_id).toBe(601);
  });
});

describe('a Duda combina horário com o card SAIU: ele perde a marca e a régua do dia volta', () => {
  const saiuMudo = (extra: Record<string, unknown> = {}) => ({
    id: 70, vendedor_nome: 'Nilce', quando: new Date(brt('2026-10-26', '08:00')).toISOString(), cliente_telefone: TEL, status: 'agendado', created_by: 'lp_solar',
    created_at: new Date(SEXTA_14H - MIN).toISOString(), boas_vindas_at: STAMP, bomdia_at: STAMP, lembrete_5min_at: STAMP, historico: null,
    observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa\nConta de luz: x', ...extra,
  });
  it('remarcarCardSolar: troca a 1ª linha no MESMO update (resto igual, tipo vindo de "Onde:"), e o caminho segue ligação', async () => {
    cartoes().push(saiuMudo());
    expect(await remarcarCardSolar(70, new Date(brt('2026-10-26', '09:15')).toISOString())).toBe('ok');
    const c = cartoes()[0];
    expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO');
    expect(c.observacao.split('\n').slice(1).join('\n')).toBe('Onde: Casa\nConta de luz: x');
    expect(ehCardSaiu(c.observacao)).toBe(false); expect(ehCardMudo(c.observacao)).toBe(false);
    expect(caminhoDaFicha(c.observacao)).toBe('ligacao');
    expect(c.boas_vindas_at).toBe(STAMP);                       // nunca zerado: a abertura não repete
    expect(c.bomdia_at ?? null).toBeNull(); expect(c.lembrete_5min_at ?? null).toBeNull();   // a régua da Giovanna fala no dia novo
  });
  it('card que fala (tipo na 1ª linha): o tipo é preservado; card que não é SAIU não é tocado', async () => {
    cartoes().push(saiuMudo({ id: 71, quando: new Date(brt('2026-10-26', '10:00')).toISOString(), observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Rural · LIGAÇÃO\nConta de luz: x' }));
    cartoes().push(saiuMudo({ id: 72, quando: new Date(brt('2026-10-27', '10:00')).toISOString(), observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO\nx' }));
    expect(await remarcarCardSolar(71, new Date(brt('2026-10-26', '11:15')).toISOString())).toBe('ok');
    expect(primeiraLinha(cartoes()[0])).toBe('LP SOLAR QUIZ · Rural · LIGAÇÃO');
    expect(await remarcarCardSolar(72, new Date(brt('2026-10-27', '11:15')).toISOString())).toBe('ok');
    expect(cartoes()[1].observacao).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO\nx');
  });
  it('ligar agora: tirar a marca e DEPOIS silenciar deixa o card sem marca e com bom dia e "oi" de 5 min carimbados (o silenciar recarimba o que o tirar zerou)', async () => {
    cartoes().push(saiuMudo({ quando: new Date(brt('2026-10-23', '16:00')).toISOString() }));
    expect(await tirarMarcaSaiuDoCard(70)).toBe(true);
    expect(cartoes()[0].lembrete_5min_at ?? null).toBeNull();
    expect(await silenciarLembretesDoCard(70)).toBe(true);
    const c = cartoes()[0];
    expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO');
    expect(ehCardSaiu(c.observacao)).toBe(false);
    expect(c.bomdia_at).toBeTruthy(); expect(c.lembrete_5min_at).toBeTruthy();
    expect(c.boas_vindas_at).toBe(STAMP);
  });

  it('MESMO horário: tirarMarcaSaiuDoCard troca a marca, zera o "oi" de 5 min e o bom dia pela regra das 11h, e não toca boas_vindas_at', async () => {
    cartoes().push(saiuMudo({ quando: new Date(brt('2026-10-23', '16:00')).toISOString() }));
    expect(await tirarMarcaSaiuDoCard(70)).toBe(true);                 // sexta 14h: o bom dia do dia já passou (depois das 11h)
    let c = cartoes()[0];
    expect(primeiraLinha(c)).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO');
    expect(c.boas_vindas_at).toBe(STAMP);
    expect(c.bomdia_at ?? null).toBeNull(); expect(c.lembrete_5min_at ?? null).toBeNull();
    expect(await tirarMarcaSaiuDoCard(70)).toBe(false);                // já normal: nada a fazer
    h.ger.zerar();
    vi.setSystemTime(brt('2026-10-23', '09:00'));                      // antes das 11h e o card é de hoje: o bom dia nasce carimbado
    cartoes().push(saiuMudo({ quando: new Date(brt('2026-10-23', '16:00')).toISOString() }));
    expect(await tirarMarcaSaiuDoCard(70)).toBe(true);
    c = cartoes()[0];
    expect(c.bomdia_at).toBeTruthy(); expect(c.lembrete_5min_at ?? null).toBeNull();
  });
});

describe('a abertura do card SAIU que fala (texto próprio)', () => {
  const quando = 'amanhã às 14h30';
  it('diz que a Nilce vai ligar para explicar o diagnóstico e oferece outro horário, sem "já está marcado"', () => {
    const t = textoDeAbertura('ligacao', 'Maria', quando, 'Nilce', true)!;
    expect(t).toBe('Oi, Maria! Sou a Duda, da Irmãos na Obra. A *Nilce* vai te ligar amanhã às 14h30 para explicar seu diagnóstico. Outro horário? É só responder.');
    expect(t.length).toBeLessThanOrEqual(160);
    expect(t).not.toMatch(/marcado|[—–]/);
    expect(textoDeAbertura('ligacao', 'Maria', quando, 'Nilce')).toContain('Já está marcado');   // o card que o cliente escolheu segue igual
  });
  it('passou do limite da bolha: tira o nome ("Oi!"), e depois os asteriscos', () => {
    const longo = 'Maximiliano-Bartolomeu-Cavalcanti-de-Albuquerque-Sobrinho-Neto';
    const t = textoDeAbertura('ligacao', longo, quando, 'Nilce', true)!;
    expect(t.startsWith('Oi! Sou a Duda')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(160);
    expect(t).toContain('A *Nilce* vai te ligar');
    expect(textoDeAbertura('ligacao', 'Maria', 'quinta, 23/10 às 14h30 e mais um bocado de texto para estourar o limite da bolha inteira', 'Nilce', true)).toBeNull();
  });
  it('bolhaDeAbertura monta o "quando" do ISO e usa a variante só com saiu=true', () => {
    const iso = new Date(brt('2026-10-24', '14:30')).toISOString();
    const agora = new Date(SEXTA_14H).toISOString();
    expect(bolhaDeAbertura('ligacao', 'Ana', iso, 'Nilce', agora, true)).toContain('A *Nilce* vai te ligar amanhã às 14h30 para explicar seu diagnóstico');
    expect(bolhaDeAbertura('ligacao', 'Ana', iso, 'Nilce', agora)).toContain('Já está marcado');
  });
});

describe('os textos com o horário do card', () => {
  it('quandoDoCardTexto: hoje, amanhã e outro dia; e o T2 sem horário de card continua como antes', () => {
    expect(quandoDoCardTexto(brt('2026-10-23', '14:20'), SEXTA_14H)).toBe('hoje, 14:20');
    expect(quandoDoCardTexto(brt('2026-10-24', '08:00'), SEXTA_14H)).toBe('amanhã, 08:00');
    expect(quandoDoCardTexto(brt('2026-10-26', '08:00'), SEXTA_14H)).toBe('seg 26/10, 08:00');
    const hid = { nome: 'Ana', tel: TEL, nota: 80, cidadeUf: 'Uberlândia-MG', resp: limparRespostas(RESP_BOA), extra: limparRespostasExtra(RESP_BOA), diag: null, kwh: null };
    expect(avisoSaiuSemMarcar(hid as never, 'diagnostico', '14:11', 'codigo12345')).toContain('Quando: hoje, 14:11');
  });
  it('as vagas do solar para o lead novo seguem a grade :00/:30 (a mesma que o tick usa)', async () => {
    const v = await vagasSolar({ dono: 'Nilce', caminho: 'ligacao', n: 3, agora: SEXTA_14H + 11 * MIN, faixa: 'novo' });
    expect((v ?? []).map(hhmmBRT)).toEqual(['15:00', '15:30', '16:00']);
  });
});
