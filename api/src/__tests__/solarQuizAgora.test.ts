import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { BancoFalso } from './bancoFalsoQuiz';

// QUIZ SOLAR NOVO (24/10/2026): horário do "agora", encaixe de +5 min, grade da vitrine, diagnóstico, claims, "falei" por POST,
// abandono (dentro e fora do horário, fila das 07:00), curioso sem "agora", modo teste sem envio e a compatibilidade das chaves antigas.
// Banco e WhatsApp em memória; nada alcança a rede.

const h = vi.hoisted(() => ({
  cooldown: false,
  falhar: false,
  main: null as any,
  ger: null as any,
  enviados: [] as Array<{ numero: string; texto: string }>,
  capi: vi.fn(),
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: (t: string) => h.ger.from(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (numero: string, texto: string) => { if (h.falhar) throw new Error('z-api fora'); h.enviados.push({ numero, texto }); }),
  linhaEmCooldown: vi.fn(() => h.cooldown),
}));
vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.capi }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));

import { sendWhatsApp } from '../services/agents/zapiClient';
import router from '../routes/ioSolar';
import { normalizarCelular } from '../routes/ioSolar';
import {
  horarioAgoraAberto, quandoDoAgora, montarVitrine, cabe, calcularDiagnostico, limparRespostas, limparRespostasExtra,
  montarObservacao, camposDoLead, decidirEMontar, GRADE_QUIZ_SEMANA, GRADE_QUIZ_SABADO, msDe,
} from '../services/io/solarQuiz';
import { decidirCaminho } from '../services/agenda/solarRota';
import { TEL_AVISO } from '../services/io/solarEquipe';
import {
  runSolarQuizAvisosTick, avisarAgora, marcarFalei, camposDeRecuperacao, CHAVES, type PedidoAvisoAgora,
} from '../services/io/solarQuizAviso';
import { avisoAgora, aberturaSugerida, listaDas7, fichaDoAviso } from '../services/io/solarQuizTextos';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/io/solar', router);

/** Instantes em Brasília (UTC-3). 2026-10-23 é sexta, 24 é sábado, 25 é domingo, 26 é segunda. */
const brt = (ymd: string, hhmm: string, seg = 0): number => Date.parse(`${ymd}T${hhmm}:${String(seg).padStart(2, '0')}-03:00`);
const SEXTA_14H = brt('2026-10-23', '14:00');
const MIN = 60_000;

const RESP_BOA = {
  conta: '600_1050', cidade: 'Uberlândia-MG', tipo: 'casa', imovel: 'proprio', urgencia: 'ja', concorrente: 'sim', pagamento: 'vista', decisor: 'eu', grupoa: 'nao',
  telhado: 'ceramica', sombra: 'sol', aumento: 'nao', dor: 'sobe', tempo: 'meses', travou: 'caro', desejo: 'viajar', criterio: 'parcela',
};
const RESP_CURIOSA = { ...RESP_BOA, urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado', concorrente: 'nao' };
const corpo = (extra: Record<string, unknown> = {}, resp: Record<string, unknown> = RESP_BOA) =>
  ({ nome: 'Ana Souza', tel: '5534991112222', respostas: resp, event_id: 'agd_abc123xyz', ...extra });

beforeEach(() => {
  h.main = new BancoFalso();
  h.ger = new BancoFalso();
  h.enviados.length = 0; h.cooldown = false; h.falhar = false; vi.mocked(sendWhatsApp).mockClear();
  h.capi.mockReset().mockResolvedValue({ ok: true, status: 200 });
  process.env.AGENTES5040_FICHA = '0';
  delete process.env.SOLAR_QUIZ_ESCALA_THIAGO; delete process.env.SOLAR_QUIZ_FILA_MANHA; delete process.env.SOLAR_QUIZ_AVISOS_OFF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SEXTA_14H);
});
afterEach(() => { vi.useRealTimers(); });

// ── horário ──────────────────────────────────────────────────────────────────
describe('o horário do atendimento direto', () => {
  it('sexta 17:59 sim, sexta 18:00 não, sábado 11:59 sim, sábado 12:00 não, domingo não', () => {
    expect(horarioAgoraAberto(brt('2026-10-23', '17:59', 59))).toBe(true);
    expect(horarioAgoraAberto(brt('2026-10-23', '18:00'))).toBe(false);
    expect(horarioAgoraAberto(brt('2026-10-24', '11:59', 59))).toBe(true);
    expect(horarioAgoraAberto(brt('2026-10-24', '12:00'))).toBe(false);
    expect(horarioAgoraAberto(brt('2026-10-25', '10:00'))).toBe(false);
  });
  it('abre às 07:00 (06:59 ainda não) e feriado nacional fecha', () => {
    expect(horarioAgoraAberto(brt('2026-10-26', '06:59', 59))).toBe(false);
    expect(horarioAgoraAberto(brt('2026-10-26', '07:00'))).toBe(true);
    expect(horarioAgoraAberto(brt('2026-11-02', '10:00'))).toBe(false);   // Finados
  });
});

describe('o minuto real da ligação do "agora"', () => {
  it('é o próximo múltiplo de 5 min com pelo menos 5 min de folga', () => {
    const iso = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(11, 16);
    expect(iso(quandoDoAgora(brt('2026-10-23', '14:00', 0)))).toBe('14:05');
    expect(iso(quandoDoAgora(brt('2026-10-23', '14:00', 1)))).toBe('14:10');
    expect(iso(quandoDoAgora(brt('2026-10-23', '14:02')))).toBe('14:10');
    expect(iso(quandoDoAgora(brt('2026-10-23', '14:55')))).toBe('15:00');
    expect(quandoDoAgora(SEXTA_14H) % (5 * MIN)).toBe(0);
    expect(quandoDoAgora(SEXTA_14H) - SEXTA_14H).toBeGreaterThanOrEqual(5 * MIN);
  });
  it('o encaixe soma 5 min por vez', () => {
    expect(quandoDoAgora(SEXTA_14H, 1)).toBe(quandoDoAgora(SEXTA_14H) + 5 * MIN);
    expect(quandoDoAgora(SEXTA_14H, 3)).toBe(quandoDoAgora(SEXTA_14H) + 15 * MIN);
  });
});

// ── vitrine ──────────────────────────────────────────────────────────────────
describe('a vitrine do quiz (grade nova, só a Nilce)', () => {
  const dec = () => ({ ...decidirCaminho(limparRespostas(RESP_BOA), null, 'x'), caminho: 'ligacao' as const, candidatos: ['Nilce'] });
  it('a grade é de 07:00 a 17:30 na semana e de 07:00 a 11:30 no sábado, de 30 em 30', () => {
    expect(GRADE_QUIZ_SEMANA[0]).toBe('07:00'); expect(GRADE_QUIZ_SEMANA[GRADE_QUIZ_SEMANA.length - 1]).toBe('17:30'); expect(GRADE_QUIZ_SEMANA).toHaveLength(22);
    expect(GRADE_QUIZ_SABADO[0]).toBe('07:00'); expect(GRADE_QUIZ_SABADO[GRADE_QUIZ_SABADO.length - 1]).toBe('11:30'); expect(GRADE_QUIZ_SABADO).toHaveLength(10);
  });
  it('dois dias de atendimento, o sábado entra e o domingo não', () => {
    const dias = montarVitrine(dec(), [], SEXTA_14H, { grade: 'quiz' });
    expect(dias.map(d => d.ymd)).toEqual(['2026-10-23', '2026-10-24']);
    expect(dias[0].horas[0].h).toBe('14:30');            // 30 min de antecedência
    expect(dias[1].horas[0].h).toBe('07:00');
    expect(dias[1].horas[dias[1].horas.length - 1].h).toBe('11:30');
    expect(dias[0].horas.every(x => x.dono === 'Nilce')).toBe(true);
    const depoisDoSabado = montarVitrine(dec(), [], brt('2026-10-24', '12:30'), { grade: 'quiz' });
    expect(depoisDoSabado.map(d => d.ymd)).toEqual(['2026-10-26', '2026-10-27']);
  });
  it('horário ocupado sai da vitrine, e o agendar faz a MESMA pergunta', () => {
    const ocup = [{ dono: 'Nilce', ini: brt('2026-10-23', '15:00'), fim: brt('2026-10-23', '15:15') }];
    const d = dec();
    expect(montarVitrine(d, ocup, SEXTA_14H, { grade: 'quiz' })[0].horas.map(x => x.h)).not.toContain('15:00');
    expect(cabe('ligacao', '2026-10-23', '15:00', 'Nilce', d, ocup, SEXTA_14H, { grade: 'quiz' })).toBe(false);
    expect(cabe('ligacao', '2026-10-23', '15:30', 'Nilce', d, ocup, SEXTA_14H, { grade: 'quiz' })).toBe(true);
    expect(cabe('ligacao', '2026-10-24', '07:00', 'Nilce', d, ocup, SEXTA_14H, { grade: 'quiz' })).toBe(true);   // sábado cedo
    expect(cabe('ligacao', '2026-10-24', '12:00', 'Nilce', d, ocup, SEXTA_14H, { grade: 'quiz' })).toBe(false);
    expect(cabe('ligacao', '2026-10-25', '09:00', 'Nilce', d, ocup, SEXTA_14H, { grade: 'quiz' })).toBe(false); // domingo
  });
  it('sem a opção, a grade antiga fica como estava (08:00 a 16:30, sem sábado)', () => {
    const d = dec();
    expect(cabe('ligacao', '2026-10-24', '09:00', 'Nilce', d, [], SEXTA_14H)).toBe(false);
    expect(cabe('ligacao', '2026-10-23', '17:00', 'Nilce', d, [], SEXTA_14H)).toBe(false);
  });
  it('o curioso também ganha vitrine, mas continua curioso', () => {
    const r = decidirEMontar(limparRespostas(RESP_CURIOSA), null, [], SEXTA_14H, 'x', { grade: 'quiz' });
    expect(r.dec.caminho).toBe('curioso');
    expect(r.dias.length).toBe(2);
  });
});

// ── diagnóstico ──────────────────────────────────────────────────────────────
describe('o diagnóstico (sem preço)', () => {
  it('a conta que fica é R$ 99, a economia é o resto, e o kWh é o mesmo da ficha', () => {
    const d = calcularDiagnostico(limparRespostas(RESP_BOA), limparRespostasExtra(RESP_BOA))!;
    expect(d.conta_mes).toBe(825);
    expect(d.kwh_mes).toBe(786);                    // 825 / 1,05, a régua da ficha
    expect(d.conta_depois).toBe(99);
    expect(d.economia_mes).toBe(726);
    expect(d.economia_ano).toBe(726 * 12);
    expect(d.ano).toBe(825 * 12);
    expect(d.cinco_anos).toBe(825 * 60);
    expect(d.placas).toBeGreaterThanOrEqual(4);
    expect(d.kwp).toBeCloseTo(d.placas * 0.61, 2);
    expect(d.area_m2).toBe(Math.round(d.placas * 2.7));
    expect(d.geracao_kwh_mes).toBeGreaterThanOrEqual(d.kwh_mes);   // gera o que ela consome, ou mais
  });
  it('conta pequena tem no mínimo 4 placas; aumento de consumo pede mais placas', () => {
    const peq = calcularDiagnostico(limparRespostas({ ...RESP_BOA, conta: 'ate300' }), null)!;
    expect(peq.placas).toBe(4);
    const base = calcularDiagnostico(limparRespostas({ ...RESP_BOA, conta: '2000_5000' }), { aumento: 'nao' })!;
    const mais = calcularDiagnostico(limparRespostas({ ...RESP_BOA, conta: '2000_5000' }), { aumento: 'carro' })!;
    expect(mais.placas).toBeGreaterThan(base.placas);
  });
  it('Grupo A: conta_depois é null (a demanda continua sendo cobrada)', () => {
    const d = calcularDiagnostico(limparRespostas({ ...RESP_BOA, conta: '2000_5000', grupoa: 'sim' }), null)!;
    expect(d.conta_depois).toBeNull();
    expect(d.economia_mes).toBeNull();
    expect(d.economia_ano).toBeNull();
    expect(d.placas).toBeGreaterThanOrEqual(4);     // placas, kWp, área e geração continuam
    expect(d.kwp).toBeGreaterThan(0); expect(d.area_m2).toBeGreaterThan(0); expect(d.geracao_kwh_mes).toBeGreaterThan(0);
  });
  it('Grupo A nos textos: o diagnóstico sai sem economia e com "Grupo A: conferir a demanda"', () => {
    const resp = limparRespostas({ ...RESP_BOA, conta: '2000_5000', grupoa: 'sim' });
    const diag = calcularDiagnostico(resp, null);
    const t = avisoAgora({ nome: 'Ana Souza', tel: '5534991112222', nota: 93, cidadeUf: 'Uberlândia-MG', resp, extra: limparRespostasExtra(RESP_BOA), diag, kwh: 3000 }, '14:05', 'C');
    const linha = t.split('\n').find(l => l.startsWith('Diagnóstico:'))!;
    expect(linha).toMatch(/^Diagnóstico: \d+ placas, [\d,]+ kWp · Grupo A: conferir a demanda$/);
    expect(linha).not.toContain('economia');
    expect(t).not.toContain('dá para economizar');
    const obs = montarObservacao(resp, decidirCaminho(resp, null, 'x'), null, false, { diag });
    expect(obs).toContain('Grupo A: conferir a demanda');
  });
});

// ── compatibilidade ──────────────────────────────────────────────────────────
describe('as chaves e os valores antigos continuam valendo', () => {
  it('limparRespostas devolve só as chaves antigas, com os mesmos valores', () => {
    const r = limparRespostas(RESP_BOA);
    expect(Object.keys(r).sort()).toEqual(['cidade', 'concorrente', 'conta', 'decisor', 'grupoa', 'imovel', 'pagamento', 'tipo', 'urgencia']);
    expect(r).toMatchObject({ conta: '600_1050', tipo: 'casa', imovel: 'proprio', urgencia: 'ja', concorrente: 'sim', pagamento: 'vista', decisor: 'eu', grupoa: 'nao', cidade: 'Uberlândia-MG' });
    for (const conta of ['ate300', '300_600', '600_1050', '1050_2000', '2000_5000', '5000_mais']) expect(limparRespostas({ conta }).conta).toBe(conta);
  });
  it('as respostas novas não entram na nota', () => {
    const a = decidirCaminho(limparRespostas(RESP_BOA), null, 'x').pontos;
    const b = decidirCaminho(limparRespostas({ conta: RESP_BOA.conta, urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', concorrente: 'sim' }), null, 'x').pontos;
    expect(a).toBe(b);
  });
  it('as respostas novas: código fora da lista vira null e "travou" some se o tempo é "agora"', () => {
    const x = limparRespostasExtra({ telhado: 'palha', sombra: 'sol', tempo: 'agora', travou: 'caro' });
    expect(x.telhado).toBeNull();
    expect(x.sombra).toBe('sol');
    expect(x.travou).toBeNull();
    expect(limparRespostasExtra({ tempo: 'ano', travou: 'valia' }).travou).toBe('valia');
  });
  it('a ficha antiga (sem as respostas novas) sai idêntica; a nova só acrescenta linhas', () => {
    const resp = limparRespostas(RESP_BOA);
    const dec = decidirCaminho(resp, null, 'x');
    const velha = montarObservacao(resp, dec, null, false);
    expect(velha.split('\n')[0]).toBe('LP SOLAR QUIZ · Casa · LIGAÇÃO');
    expect(velha).not.toMatch(/Telhado|Diagnóstico/);
    const nova = montarObservacao(resp, dec, null, false, { respostas: limparRespostasExtra(RESP_BOA), diag: calcularDiagnostico(resp, null) });
    for (const linha of velha.split('\n')) expect(nova.split('\n')).toContain(linha);
    expect(nova).toMatch(/Telhado: Cerâmica/);
    expect(nova).toMatch(/Diagnóstico: \d+ placas/);
    const nomes = camposDoLead(resp, dec).map(c => c.name);
    expect(nomes).toContain('Consumo'); expect(nomes).toContain('Quem decide'); expect(nomes).toContain('Pagamento');
    expect(nomes).not.toContain('Telhado');
  });
  it('o card do "agora" tem a 1ª linha exata, e o caminho dele é ligação', () => {
    const resp = limparRespostas(RESP_BOA);
    const obs = montarObservacao(resp, decidirCaminho(resp, null, 'x'), null, false, { agora: true });
    expect(obs.split('\n')[0]).toBe('LP SOLAR QUIZ · AGORA');
  });
  it('celular: só com o 9 depois do DDD; tira o 55 só se sobrarem 10 ou 11 dígitos', () => {
    expect(normalizarCelular('(34) 99111-2222')).toBe('5534991112222');
    expect(normalizarCelular('5534991112222')).toBe('5534991112222');
    expect(normalizarCelular('034991112222')).toBe('5534991112222');
    expect(normalizarCelular('553433332222')).toBeNull();      // fixo
    expect(normalizarCelular('3499111222')).toBeNull();        // faltou dígito
  });
});

// ── textos ───────────────────────────────────────────────────────────────────
describe('os textos dos avisos', () => {
  const resp = limparRespostas(RESP_BOA);
  const dados = (extra: Partial<Parameters<typeof fichaDoAviso>[0]> = {}) => ({
    nome: 'Ana Souza', tel: '5534991112222', nota: 93, cidadeUf: 'Uberlândia-MG', resp, extra: limparRespostasExtra(RESP_BOA),
    diag: calcularDiagnostico(resp, null), kwh: 786, ...extra,
  });
  it('T1: 1ª linha com a nota, link do falei, sem travessão, emoji só na 1ª linha', () => {
    const t = avisoAgora(dados(), '14:05', 'CODIGO123abc');
    const linhas = t.split('\n');
    expect(linhas[0]).toBe('🟢 *NOTA 93 · LIGAR AGORA*');
    expect(linhas[1]).toBe('Quando: hoje, 14:05');
    expect(t).toContain('WhatsApp: https://wa.me/5534991112222');
    expect(t).toContain('Falou com o cliente? Toque aqui: https://api.solardoc.app/io/solar/falei/CODIGO123abc');
    expect(t).not.toMatch(/[—–]/);
    expect(linhas.slice(1).join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const l of linhas.filter(Boolean)) expect(l[0]).toBe(l[0].toUpperCase());
    expect(t).not.toContain('Qualifica visita técnica');
    expect(t).toContain('Pensa em solar: Há alguns meses · Travou: Achou caro');
  });
  it('T1: resposta que falta vira "Não respondeu"; "Travou" só aparece se a pergunta apareceu; acima de 1.000 kWh qualifica visita', () => {
    const t = avisoAgora(dados({ extra: limparRespostasExtra({ tempo: 'agora' }), kwh: 1500 }), '14:05', 'C');
    expect(t).toContain('Telhado: Não respondeu');
    expect(t).toContain('Pensa em solar: Começou a pensar agora\n');
    expect(t).not.toContain('Travou');
    expect(t).toContain('Qualifica visita técnica, acima de 1.000 kWh');
  });
  it('T1a: a abertura sai uma frase por linha, com o gancho do desejo e a pergunta da objeção', () => {
    const a = aberturaSugerida(dados());
    expect(a.split('\n')).toEqual([
      'Oi, Ana!', 'Aqui é a Nilce, da Irmãos na Obra.', 'Fiz a conta com as suas respostas.',
      expect.stringMatching(/^Em Uberlândia, dá para economizar cerca de R\$ 726 por mês\.$/),
      'Você marcou que quer viajar mais.', 'Posso te mostrar como ficaria a parcela?',
    ]);
  });
  it('T3: uma mensagem com N clientes', () => {
    const t = listaDas7([
      { nome: 'Ana', nota: 80, cidadeUf: 'Uberlândia-MG', conta: 'R$ 600 a R$ 1.050', onde: 'diagnostico', tel: '5534991112222' },
      { nome: 'Beto', nota: 70, cidadeUf: 'Araguari-MG', conta: 'Até R$ 300', onde: 'whatsapp', tel: '5534988887777' },
    ]);
    expect(t.split('\n')[0]).toBe('☀️ *BOM DIA · LIGAR HOJE · 2 FORA DO HORÁRIO*');
    expect(t).toContain('Saiu: No diagnóstico, sem clicar no especialista');
    expect(t).toContain('Saiu: Na tela do WhatsApp, antes de ver o diagnóstico');
  });
  it('o número da Nilce e o do Thiago existem (as chaves são minúsculas)', () => {
    expect(TEL_AVISO['nilce']).toBeTruthy();
    expect(TEL_AVISO['thiago']).toBeTruthy();
    expect((TEL_AVISO as Record<string, string>)['Nilce']).toBeUndefined();
  });
});

// ── claims, "falei" e lembretes (service) ────────────────────────────────────
const LEAD = 'quiz_3491112222';
const pedido = (extra: Partial<PedidoAvisoAgora> = {}): PedidoAvisoAgora => {
  const resp = limparRespostas(RESP_BOA);
  return {
    cardId: 77, lead: LEAD, quandoMs: SEXTA_14H + 5 * MIN,
    ficha: { nome: 'Ana Souza', tel: '5534991112222', nota: 93, cidadeUf: 'Uberlândia-MG', resp, extra: limparRespostasExtra(RESP_BOA), diag: calcularDiagnostico(resp, null), kwh: 786 },
    ...extra,
  };
};
const codigoDoAviso = (card = 77): string => h.main.tabela('system_state').find((l: any) => l.key === CHAVES.avisoAgora + card).value.codigo;
const paraNilce = () => h.enviados.filter(e => e.numero === TEL_AVISO['nilce']);
const paraThiago = () => h.enviados.filter(e => e.numero === TEL_AVISO['thiago']);

function semearLead(ger: any, id: string, p: { nome?: string; tel?: string; atividade: number; resp?: Record<string, unknown>; agendado?: number | null; caminho?: string; cidade?: string }) {
  const resp = p.resp ?? RESP_BOA;
  ger.tabela('leads_meta').push({
    lead_id: id, nome: p.nome ?? 'Ana Souza', whatsapp: p.tel ?? '5534991112222', cidade: p.cidade ?? 'Uberlândia-MG', agendado_id: p.agendado ?? null,
    form_id: 'quiz_solar', created_time: new Date(p.atividade).toISOString(),
    field_data: [{ name: 'Pontos', values: ['93'] }, { name: 'Caminho', values: [p.caminho ?? 'ligacao'] },
      ...camposDeRecuperacao(limparRespostas(resp), limparRespostasExtra(resp), p.atividade)],
  });
}

describe('o aviso "agora" e o claim por insert', () => {
  it('manda uma bolha só para a Nilce e NÃO manda de novo para o mesmo lead', async () => {
    const a = await avisarAgora(pedido(), SEXTA_14H);
    const b = await avisarAgora(pedido(), SEXTA_14H + 1000);
    expect(a).toEqual({ enviado: true, motivo: 'enviado' });
    expect(b).toEqual({ enviado: false, motivo: 'ja_avisado' });
    expect(paraNilce()).toHaveLength(1);
    expect(h.enviados).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain(`/io/solar/falei/${codigoDoAviso()}`);
    expect(h.main.tabela('system_state').filter((l: any) => l.key === CHAVES.avisoAgora + 77)).toHaveLength(1);
  });
  it('duas chamadas ao mesmo tempo também mandam uma só', async () => {
    await Promise.all([avisarAgora(pedido(), SEXTA_14H), avisarAgora(pedido(), SEXTA_14H)]);
    expect(h.enviados).toHaveLength(1);
  });
  it('com a ficha do 5040 ligada o aviso AINDA sai, e a ficha é a que fica de fora (aviso_antigo:<id>)', async () => {
    process.env.AGENTES5040_FICHA = '1'; process.env.AGENTES5040_HMAC = 'segredo-de-teste';
    const { zerarCacheInterruptores } = await import('../services/agentes5040/interruptores');
    zerarCacheInterruptores();
    const r = await avisarAgora(pedido(), SEXTA_14H);
    process.env.AGENTES5040_FICHA = '0'; delete process.env.AGENTES5040_HMAC; zerarCacheInterruptores();
    expect(r).toEqual({ enviado: true, motivo: 'enviado' });
    expect(paraNilce()).toHaveLength(1);
    expect(h.main.tabela('system_state').some((l: any) => l.key === 'aviso_antigo:77')).toBe(true);
    expect(h.main.tabela('system_state').some((l: any) => l.key === CHAVES.avisoAgora + 77)).toBe(true);
  });
  it('SOLAR_QUIZ_AVISOS_OFF=1 cala tudo', async () => {
    process.env.SOLAR_QUIZ_AVISOS_OFF = '1';
    expect((await avisarAgora(pedido(), SEXTA_14H)).motivo).toBe('desligado');
    expect(h.enviados).toHaveLength(0);
  });
});

describe('anti-ban: o carimbo no balde da linha e o robô registrado', () => {
  it('cada envio deixa solar_quiz_env: com o robô do CHEFE, e o prefixo está no balde das respostas das agentes', async () => {
    await avisarAgora(pedido(), SEXTA_14H);
    const carimbo = h.main.tabela('system_state').find((l: any) => l.key.startsWith('solar_quiz_env:nilce:agora:'));
    expect(carimbo.value.robo).toBe('solar_quiz_aviso');
    const { PREFIXOS_RESPOSTA_AGENTES } = await import('../services/agents/whatsapp/lineThrottle');
    expect([...PREFIXOS_RESPOSTA_AGENTES]).toContain('solar_quiz_env:');
    const { CLASSE_POR_ROBO } = await import('../services/chefe/classes');
    for (const r of ['solar_quiz_aviso', 'solar_quiz_lembrete', 'solar_quiz_lista_manha']) {
      expect(CLASSE_POR_ROBO[r]!.classe).toBe('aviso_interno_p2');
      expect(CLASSE_POR_ROBO[r]!.arquivos).toEqual(['services/io/solarQuizAviso.ts']);
    }
  });
});

describe('o "falei com o cliente"', () => {
  it('marcar é por POST, o segundo clique só diz que já estava, e código errado é inválido', async () => {
    await avisarAgora(pedido(), SEXTA_14H);
    const cod = codigoDoAviso();
    const a = await marcarFalei(cod, SEXTA_14H + 2 * MIN);
    const b = await marcarFalei(cod, SEXTA_14H + 3 * MIN);
    expect(a).toMatchObject({ estado: 'marcado', nome: 'Ana Souza' });
    expect(b).toMatchObject({ estado: 'ja_estava', em: SEXTA_14H + 2 * MIN });
    expect((await marcarFalei('naoexiste123')).estado).toBe('invalido');
    expect(h.main.tabela('system_state').filter((l: any) => l.key === CHAVES.falei + LEAD)).toHaveLength(1);
  });
  it('GET abre a página e NÃO marca; só o POST marca', async () => {
    await avisarAgora(pedido(), SEXTA_14H);
    const cod = codigoDoAviso();
    const g = await request(app).get(`/io/solar/falei/${cod}`);
    expect(g.status).toBe(200);
    expect(g.text).toContain('Você já falou com Ana Souza?');
    expect(g.text).toContain('<form method="post"');
    expect(g.text).toContain('Abrir esta página não marca nada. Só o botão abaixo conta como atendido.');
    expect(g.headers['cache-control']).toContain('no-store');
    await request(app).get(`/io/solar/falei/${cod}`);
    await request(app).head(`/io/solar/falei/${cod}`);
    expect(h.main.tabela('system_state').some((l: any) => l.key === CHAVES.falei + LEAD)).toBe(false);
    const p = await request(app).post(`/io/solar/falei/${cod}`);
    expect(p.status).toBe(200);
    expect(p.text).toMatch(/Pronto, marcado às \d\d:\d\d\. Ana Souza está como atendido\. Pode fechar esta página\./);
    expect(h.main.tabela('system_state').some((l: any) => l.key === CHAVES.falei + LEAD)).toBe(true);
    const p2 = await request(app).post(`/io/solar/falei/${cod}`);
    expect(p2.text).toMatch(/Já estava marcado às \d\d:\d\d\. Não precisa tocar de novo\./);
    expect((await request(app).get('/io/solar/falei/lixo')).status).toBe(404);
  });
});

describe('os lembretes de 5 e 10 minutos', () => {
  beforeEach(async () => {
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H - MIN, agendado: 77 });
    await avisarAgora(pedido(), SEXTA_14H);
    h.enviados.length = 0;
  });
  it('antes de 5 min não manda; aos 5 min vai o 2º aviso à Nilce, uma vez só', async () => {
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 4 * MIN });
    expect(h.enviados).toHaveLength(0);
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 6 * MIN });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 7 * MIN });
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain('ESPERANDO · LIGAR AGORA');
    expect(paraNilce()[0].texto).toContain(`/io/solar/falei/${codigoDoAviso()}`);
    expect(paraThiago()).toHaveLength(0);
  });
  it('aos 10 min o Thiago recebe o aviso de lead parado, uma vez só', async () => {
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(paraThiago()).toHaveLength(1);
    expect(paraThiago()[0].texto).toContain('LEAD PARADO · Ana Souza');
    expect(paraThiago()[0].texto).toContain('Parado há 12 min');
  });
  it('SOLAR_QUIZ_ESCALA_THIAGO=0 desliga só o aviso ao Thiago', async () => {
    process.env.SOLAR_QUIZ_ESCALA_THIAGO = '0';
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    expect(paraThiago()).toHaveLength(0);
    expect(paraNilce()).toHaveLength(1);
  });
  it('com "falei" nenhum lembrete sai', async () => {
    await marcarFalei(codigoDoAviso(), SEXTA_14H + 2 * MIN);
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    expect(h.enviados).toHaveLength(0);
  });
  it('fora do horário nenhum lembrete sai', async () => {
    h.main.tabela('system_state').find((l: any) => l.key === CHAVES.avisoAgora + 77).value.em = new Date(brt('2026-10-23', '17:56')).toISOString();
    h.main.tabela('system_state').find((l: any) => l.key === CHAVES.avisoAgora + 77).updated_at = new Date(brt('2026-10-23', '17:56')).toISOString();
    await runSolarQuizAvisosTick({ agora: brt('2026-10-23', '18:04') });
    expect(h.enviados).toHaveLength(0);
  });
});

describe('mais de 12 avisos por hora para a mesma pessoa viram um cartão a cada 10 min', () => {
  it('o 13º vira linha do cartão, e o cartão sai uma vez', async () => {
    for (let i = 0; i < 12; i++) h.main.tabela('system_state').push({ key: `${CHAVES.envio}nilce:agora:L${i}`, value: {}, updated_at: new Date(SEXTA_14H - 5 * MIN).toISOString() });
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H - MIN, agendado: 77 });
    // T1 NUNCA é agrupado: sai direto mesmo com 12 na hora, e conta no carimbo.
    const r = await avisarAgora(pedido(), SEXTA_14H);
    expect(r).toEqual({ enviado: true, motivo: 'enviado' });
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain('LIGAR AGORA');
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.cartaoFila))).toBe(false);
    h.enviados.length = 0;
    // O lembrete de 5 min (T4) é que vira linha de cartão, e o cartão sai (um só) na mesma rodada.
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 6 * MIN });
    const cartoes = () => paraNilce().filter(e => e.texto.includes('AVISOS NOS ÚLTIMOS 10 MIN'));
    expect(h.enviados).toHaveLength(1);
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0].texto).toContain('📋 *1 AVISOS NOS ÚLTIMOS 10 MIN · LIGAR*');
    expect(cartoes()[0].texto).toContain('https://wa.me/5534991112222');
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 7 * MIN });
    expect(cartoes()).toHaveLength(1);
  });
});

// ── abandono ─────────────────────────────────────────────────────────────────
describe('o abandono (saiu sem marcar)', () => {
  const marcaDeSaida = (ms: number, onde: string) =>
    h.main.tabela('system_state').push({ key: CHAVES.saiu + LEAD, value: { em: new Date(ms).toISOString(), onde }, updated_at: new Date(ms).toISOString() });

  it('sem marca de saída, avisa a Nilce 10 min depois da última atividade, UMA vez; o card (mudo, sem Schedule) nasce na parte `cards` (27/10/2026)', async () => {
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 8 * MIN });
    expect(h.enviados).toHaveLength(0);
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 13 * MIN });
    expect(paraNilce()).toHaveLength(1);
    const t = paraNilce()[0].texto;
    expect(t.split('\n')[0]).toBe('🟢 *NOTA 93 · SAIU SEM MARCAR · LIGAR AGORA*');
    expect(t.split('\n')[1]).toBe('Saiu no diagnóstico, sem clicar no especialista');
    expect(t).toContain('Falou com o cliente? Toque aqui:');
    // Desde 27/10/2026 o lead que saiu sem marcar ganha card (sem a Duda ligada o card nasce MUDO); o aviso diz o horário dele.
    expect(h.ger.tabela('agendamentos')).toHaveLength(1);
    expect(String(h.ger.tabela('agendamentos')[0].observacao).split('\n')[0]).toBe('LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO');
    expect(t).toContain('(já está na sua agenda)');
    expect(h.capi).not.toHaveBeenCalled();                         // e não dispara Schedule
    expect(h.main.tabela('system_state').some((l: any) => l.key === CHAVES.abandono + LEAD)).toBe(true);
  });
  it('com marca de saída, avisa 5 min depois dela e diz onde saiu', async () => {
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H });
    marcaDeSaida(SEXTA_14H + MIN, 'whatsapp');
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 5 * MIN });
    expect(h.enviados).toHaveLength(0);
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 7 * MIN });
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto.split('\n')[1]).toBe('Saiu na tela do WhatsApp, antes de ver o diagnóstico');
  });
  it('quem tem card, quem clicou "agora", quem já foi atendido e o curioso não são abandono', async () => {
    semearLead(h.ger, 'quiz_1', { atividade: SEXTA_14H, agendado: 5 });
    semearLead(h.ger, 'quiz_2', { atividade: SEXTA_14H });
    h.main.tabela('system_state').push({ key: CHAVES.avisoAgora + '99', value: { codigo: 'x', lead: 'quiz_2' }, updated_at: new Date(SEXTA_14H).toISOString() });
    semearLead(h.ger, 'quiz_3', { atividade: SEXTA_14H });
    h.main.tabela('system_state').push({ key: CHAVES.falei + 'quiz_3', value: {}, updated_at: new Date(SEXTA_14H).toISOString() });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(paraNilce().filter(e => e.texto.includes('SAIU SEM MARCAR'))).toHaveLength(0);
  });
  it('o curioso que deixou o WhatsApp e saiu TAMBÉM gera o aviso, com a nota na 1ª linha', async () => {
    semearLead(h.ger, 'quiz_4', { atividade: SEXTA_14H, caminho: 'curioso', resp: RESP_CURIOSA });
    h.ger.tabela('leads_meta')[0].field_data.find((c: any) => c.name === 'Pontos').values = ['5'];
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto.split('\n')[0]).toBe('🔴 *NOTA 5 · SAIU SEM MARCAR · LIGAR AGORA*');
  });
  it('rascunho do quiz antigo (sem os códigos) é ignorado', async () => {
    h.ger.tabela('leads_meta').push({ lead_id: 'quiz_velho', nome: 'Velho', whatsapp: '5534991112222', cidade: 'X', agendado_id: null, form_id: 'quiz_solar',
      created_time: new Date(SEXTA_14H).toISOString(), field_data: [{ name: 'Pontos', values: ['90'] }] });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(h.enviados).toHaveLength(0);
  });
  it('fora do horário guarda numa fila, e às 07:00 do próximo dia útil sai UMA mensagem com a lista', async () => {
    const sexta1815 = brt('2026-10-23', '18:15');
    semearLead(h.ger, LEAD, { atividade: sexta1815 });
    semearLead(h.ger, 'quiz_3488887777', { nome: 'Beto Lima', tel: '5534988887777', atividade: sexta1815 + MIN, cidade: 'Araguari-MG' });
    await runSolarQuizAvisosTick({ agora: sexta1815 + 12 * MIN });
    expect(h.enviados).toHaveLength(0);                                              // fora do horário: nada sai
    expect(h.main.tabela('system_state').filter((l: any) => l.key.startsWith(CHAVES.manha))).toHaveLength(2);
    await runSolarQuizAvisosTick({ agora: brt('2026-10-24', '06:50') });             // sábado, antes das 07:00
    expect(h.enviados).toHaveLength(0);
    await runSolarQuizAvisosTick({ agora: brt('2026-10-24', '07:02') });
    await runSolarQuizAvisosTick({ agora: brt('2026-10-24', '07:04') });
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0].numero).toBe(TEL_AVISO['nilce']);
    expect(h.enviados[0].texto.split('\n')[0]).toBe('☀️ *BOM DIA · LIGAR HOJE · 2 FORA DO HORÁRIO*');
    expect(h.enviados[0].texto).toContain('Nome: Beto Lima, nota 93');
    expect(h.main.tabela('system_state').filter((l: any) => l.key.startsWith(CHAVES.manha) && !l.key.startsWith(CHAVES.manhaLote))).toHaveLength(0);
  });
  it('SOLAR_QUIZ_FILA_MANHA=0: fora do horário o aviso simplesmente não sai (nem entra em fila)', async () => {
    process.env.SOLAR_QUIZ_FILA_MANHA = '0';
    const sexta1815 = brt('2026-10-23', '18:15');
    semearLead(h.ger, LEAD, { atividade: sexta1815 });
    await runSolarQuizAvisosTick({ agora: sexta1815 + 12 * MIN });
    await runSolarQuizAvisosTick({ agora: brt('2026-10-24', '07:02') });
    expect(h.enviados).toHaveLength(0);
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.manha))).toBe(false);
  });
});

// ── rotas ────────────────────────────────────────────────────────────────────
describe('POST /quiz', () => {
  it('devolve o diagnóstico do servidor, o horário do agora, curioso e a Nilce, sem mexer nas chaves antigas', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, lead_id: 'quiz_3491112222', caminho: 'ligacao', dono: 'Nilce', curioso: false, horario_agora: true });
    expect(r.body.diagnostico).toMatchObject({ conta_mes: 825, kwh_mes: 786, conta_depois: 99, economia_mes: 726 });
    expect(Object.keys(r.body.diagnostico).sort()).toEqual(['ano', 'area_m2', 'cinco_anos', 'conta_depois', 'conta_mes', 'economia_ano', 'economia_mes', 'geracao_kwh_mes', 'kwh_mes', 'kwp', 'placas']);
    expect(r.body.dias.map((d: { ymd: string }) => d.ymd)).toEqual(['2026-10-23', '2026-10-24']);
    expect(r.body).toHaveProperty('jaMarcado'); expect(r.body).toHaveProperty('semHorario'); expect(r.body).toHaveProperty('kwh');
    const lead = h.ger.tabela('leads_meta')[0];
    expect(lead).toMatchObject({ lead_id: 'quiz_3491112222', form_id: 'quiz_solar', consultor: 'Nilce' });
    const nomes = lead.field_data.map((c: { name: string }) => c.name);
    expect(nomes).toEqual(expect.arrayContaining(['Telhado', 'Diagnóstico', 'Respostas (código)', 'Atividade em', 'Pontos', 'Caminho']));
    expect(h.enviados).toHaveLength(0);
  });
  it('Grupo A devolve conta_depois null', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo({}, { ...RESP_BOA, conta: '2000_5000', tipo: 'empresa', grupoa: 'sim' }));
    expect(r.body.diagnostico.conta_depois).toBeNull();
  });
  it('fora do horário o horario_agora é false; curioso é curioso e ainda recebe vitrine', async () => {
    vi.setSystemTime(brt('2026-10-24', '12:30'));
    const r = await request(app).post('/io/solar/quiz').send(corpo({}, RESP_CURIOSA));
    expect(r.body).toMatchObject({ horario_agora: false, curioso: true, caminho: 'curioso' });
    expect(r.body.dias.length).toBe(2);
  });
  it('lead novo nunca vem como vistoria nem video', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo({}, { ...RESP_BOA, conta: '5000_mais', cidade: 'Uberlândia-MG' }));
    expect(['ligacao', 'curioso']).toContain(r.body.caminho);
  });
  it('celular inválido (fixo) é recusado', async () => {
    const r = await request(app).post('/io/solar/quiz').send(corpo({ tel: '553433332222' }));
    expect(r.status).toBe(400);
  });
});

describe('POST /quiz/agora', () => {
  it('cria o card da Nilce no minuto real, avisa uma vez, e dispara o Schedule com o MESMO event_id', async () => {
    await request(app).post('/io/solar/quiz').send(corpo());
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, dono: 'Nilce', quando: new Date(SEXTA_14H + 5 * MIN).toISOString() });
    const card = h.ger.tabela('agendamentos')[0];
    expect(card).toMatchObject({ vendedor_nome: 'Nilce', status: 'agendado', created_by: 'lp_solar', quando: new Date(SEXTA_14H + 5 * MIN).toISOString() });
    expect(card.observacao.split('\n')[0]).toBe('LP SOLAR QUIZ · AGORA');
    expect(card.lembrete_5min_at).toBeTruthy();
    expect(h.ger.tabela('leads_meta')[0].agendado_id).toBe(card.id);
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain('LIGAR AGORA');
    const schedule = h.capi.mock.calls.map(c => c[0]).filter(e => e.nome === 'Schedule');
    expect(schedule).toHaveLength(1);
    expect(schedule[0].eventId).toBe('agd_abc123xyz');
  });
  it('minuto ocupado: encaixa +5 min', async () => {
    h.ger.tabela('agendamentos').push({ id: 1, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 5 * MIN).toISOString(), status: 'agendado', created_by: 'lp_eletroposto' });
    h.ger.tabela('agendamentos').push({ id: 2, vendedor_nome: 'Nilce', quando: new Date(SEXTA_14H + 10 * MIN).toISOString(), status: 'agendado', created_by: 'lp_eletroposto' });
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo());
    expect(r.body.quando).toBe(new Date(SEXTA_14H + 15 * MIN).toISOString());
  });
  it('clique repetido não cria 2º card nem 2º aviso, e não repete o Schedule', async () => {
    await request(app).post('/io/solar/quiz/agora').send(corpo());
    const r2 = await request(app).post('/io/solar/quiz/agora').send(corpo());
    expect(r2.status).toBe(200);
    expect(r2.body.repetido).toBe(true);
    expect(h.ger.tabela('agendamentos')).toHaveLength(1);
    expect(paraNilce()).toHaveLength(1);
    expect(h.capi.mock.calls.filter(c => c[0].nome === 'Schedule')).toHaveLength(1);
  });
  it('fora do horário responde 409 fora_do_horario e não cria nada', async () => {
    vi.setSystemTime(brt('2026-10-23', '18:00'));
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('fora_do_horario');
    expect(h.ger.tabela('agendamentos')).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
  });
  it('curioso não tem o "agora": 409', async () => {
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo({}, RESP_CURIOSA));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('curioso');
    expect(h.ger.tabela('agendamentos')).toHaveLength(0);
  });
});

describe('POST /quiz/agendar', () => {
  it('marca na vitrine nova, com o Schedule do mesmo event_id, e o curioso também marca', async () => {
    const v = await request(app).post('/io/solar/quiz').send(corpo({}, RESP_CURIOSA));
    const dia = v.body.dias[0]; const hora = dia.horas[0];
    const r = await request(app).post('/io/solar/quiz/agendar').send(corpo({ ymd: dia.ymd, h: hora.h, dono: hora.dono }, RESP_CURIOSA));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, dono: 'Nilce' });
    const card = h.ger.tabela('agendamentos')[0];
    expect(card).toMatchObject({ vendedor_nome: 'Nilce', created_by: 'lp_solar' });
    expect(card.observacao).toContain('Curioso');
    expect(h.capi.mock.calls.filter(c => c[0].nome === 'Schedule')).toHaveLength(1);
    expect(paraNilce()).toHaveLength(1);
    expect(paraNilce()[0].texto).toContain('*Telhado:* Cerâmica');
  });
  it('horário que a vitrine nova não oferece (08:00 de domingo) é recusado com 409', async () => {
    const r = await request(app).post('/io/solar/quiz/agendar').send(corpo({ ymd: '2026-10-25', h: '08:00', dono: 'Nilce' }));
    expect(r.status).toBe(409);
    expect(h.ger.tabela('agendamentos')).toHaveLength(0);
  });
  it('07:00 de sábado, que só a grade nova tem, é aceito', async () => {
    const r = await request(app).post('/io/solar/quiz/agendar').send(corpo({ ymd: '2026-10-24', h: '07:00', dono: 'Nilce' }));
    expect(r.status).toBe(200);
    expect(h.ger.tabela('agendamentos')[0].quando).toBe(new Date(msDe('2026-10-24', '07:00')).toISOString());
  });
});

describe('POST /quiz/saiu', () => {
  beforeEach(async () => { await request(app).post('/io/solar/quiz').send(corpo()); h.capi.mockClear(); });
  it('aceita Blob application/json E corpo em texto, só grava a marca e não envia nada', async () => {
    const a = await request(app).post('/io/solar/quiz/saiu').set('Content-Type', 'application/json').send(JSON.stringify({ tel: '5534991112222', onde: 'whatsapp' }));
    expect(a.status).toBe(200);
    let marca = h.main.tabela('system_state').find((l: any) => l.key === CHAVES.saiu + LEAD);
    expect(marca.value.onde).toBe('whatsapp');
    h.main.zerar();
    const b = await request(app).post('/io/solar/quiz/saiu').set('Content-Type', 'text/plain;charset=UTF-8').send(JSON.stringify({ tel: '(34) 99111-2222', onde: 'diagnostico' }));
    expect(b.status).toBe(200);
    marca = h.main.tabela('system_state').find((l: any) => l.key === CHAVES.saiu + LEAD);
    expect(marca.value.onde).toBe('diagnostico');
    expect(h.enviados).toHaveLength(0);
    expect(h.ger.tabela('agendamentos')).toHaveLength(0);
    expect(h.capi).not.toHaveBeenCalled();
  });
  it('onde: só "whatsapp" e "horarios" têm texto próprio; "resultado", "fim", id de passo ou nada valem como diagnóstico', async () => {
    const onde = async (corpoOnde: Record<string, unknown>) => {
      h.main.zerar();
      await request(app).post('/io/solar/quiz/saiu').send({ tel: '5534991112222', ...corpoOnde });
      return h.main.tabela('system_state').find((l: any) => l.key === CHAVES.saiu + LEAD).value.onde;
    };
    expect(await onde({ onde: 'resultado' })).toBe('diagnostico');
    expect(await onde({ onde: 'diagnostico' })).toBe('diagnostico');
    expect(await onde({ onde: 'whatsapp' })).toBe('whatsapp');
    expect(await onde({ onde: 'horarios' })).toBe('horarios');
    expect(await onde({ onde: 'fim' })).toBe('diagnostico');
    expect(await onde({ onde: 'telhado' })).toBe('diagnostico');   // o id de um passo
    expect(await onde({})).toBe('diagnostico');
  });
  it('corpo ilegível ou sem telefone: 400, sem marca', async () => {
    const r = await request(app).post('/io/solar/quiz/saiu').set('Content-Type', 'text/plain').send('isto nao e json');
    expect(r.status).toBe(400);
    expect(h.main.tabela('system_state').length).toBe(0);
  });
});

describe('modo teste da sonda', () => {
  const SEGREDO = () => String(process.env.CRON_SECRET);
  it('teste:true SEM o header (ou com header errado) é 401 e não grava nada', async () => {
    const a = await request(app).post('/io/solar/quiz/agora').send(corpo({ teste: true }));
    const b = await request(app).post('/io/solar/quiz/agora').set('x-cron-secret', 'errado').send(corpo({ teste: true }));
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(h.ger.tabela('agendamentos')).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
  });
  it('com o header, /quiz, /agora, /agendar e /saiu gravam como lp_solar_teste e NÃO mandam mensagem nem CAPI', async () => {
    const q = await request(app).post('/io/solar/quiz').set('x-cron-secret', SEGREDO()).send(corpo({ teste: true }));
    expect(q.body.lead_id).toBe('qteste_3491112222');
    expect(h.ger.tabela('leads_meta')[0].form_id).toBe('quiz_solar_teste');
    const a = await request(app).post('/io/solar/quiz/agora').set('x-cron-secret', SEGREDO()).send(corpo({ teste: true }));
    expect(a.status).toBe(200);
    expect(a.body.teste).toBe(true);
    const ag = await request(app).post('/io/solar/quiz/agendar').set('x-cron-secret', SEGREDO())
      .send(corpo({ teste: true, tel: '5534988887777', ymd: '2026-10-24', h: '07:30', dono: 'Nilce' }));
    expect(ag.status).toBe(200);
    const s = await request(app).post('/io/solar/quiz/saiu').set('x-cron-secret', SEGREDO()).send({ tel: '5534991112222', onde: 'diagnostico', teste: true });
    expect(s.status).toBe(200);
    const cards = h.ger.tabela('agendamentos');
    expect(cards).toHaveLength(2);
    expect(cards.every((c: any) => c.created_by === 'lp_solar_teste')).toBe(true);
    expect(h.enviados).toHaveLength(0);
    expect(h.capi).not.toHaveBeenCalled();
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.avisoAgora))).toBe(false);
    // O tick não toca no rascunho de teste (outro form_id) nem no card.
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 20 * MIN });
    expect(h.enviados).toHaveLength(0);
  });
  it('cancelar só põe status cancelado, e só em card de teste com menos de 1 hora', async () => {
    const real = { id: 1, vendedor_nome: 'Nilce', quando: 'x', status: 'agendado', created_by: 'lp_solar', created_at: new Date().toISOString() };
    const teste = { id: 2, vendedor_nome: 'Nilce', quando: 'y', status: 'agendado', created_by: 'lp_solar_teste', created_at: new Date().toISOString() };
    const velho = { id: 3, vendedor_nome: 'Nilce', quando: 'z', status: 'agendado', created_by: 'lp_solar_teste', created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    h.ger.tabela('agendamentos').push(real, teste, velho);
    expect((await request(app).post('/io/solar/quiz/teste/2/cancelar').send({})).status).toBe(401);
    expect((await request(app).post('/io/solar/quiz/teste/1/cancelar').set('x-cron-secret', SEGREDO()).send({})).status).toBe(404);
    expect((await request(app).post('/io/solar/quiz/teste/3/cancelar').set('x-cron-secret', SEGREDO()).send({})).status).toBe(404);
    expect((await request(app).post('/io/solar/quiz/teste/2/cancelar').set('x-cron-secret', SEGREDO()).send({})).status).toBe(200);
    expect(h.ger.tabela('agendamentos').map((c: any) => [c.id, c.status])).toEqual([[1, 'agendado'], [2, 'cancelado'], [3, 'agendado']]);
    expect(h.ger.tabela('agendamentos')).toHaveLength(3);   // nada de DELETE
  });
});

// ── anti-ban: 1 envio por rodada, parar na falha, cartão sem dobra, T1 nunca agrupado ───────────────────
const LEAD_B = 'quiz_3488887777';
const semearDois = () => {
  semearLead(h.ger, LEAD, { atividade: SEXTA_14H });
  semearLead(h.ger, LEAD_B, { nome: 'Beto Lima', tel: '5534988887777', atividade: SEXTA_14H, cidade: 'Araguari-MG' });
};
const cartoes = () => paraNilce().filter(e => e.texto.includes('AVISOS NOS ÚLTIMOS 10 MIN'));
const filaDoCartao = (lead: string, em = SEXTA_14H) =>
  h.main.tabela('system_state').push({ key: `${CHAVES.cartaoFila}nilce:lembrete5:${lead}`, value: { lead, tipo: 'lembrete5', em: new Date(em).toISOString() }, updated_at: new Date(em).toISOString() });

describe('o tick manda NO MÁXIMO 1 mensagem por rodada', () => {
  it('com dois abandonos e um lembrete vencidos, cada rodada manda um só', async () => {
    semearDois();
    semearLead(h.ger, 'quiz_3477776666', { nome: 'Caio', tel: '5534977776666', atividade: SEXTA_14H - 20 * MIN, agendado: 55 });
    h.main.tabela('system_state').push({ key: CHAVES.avisoAgora + '55', value: { codigo: 'cod55abcdef', lead: 'quiz_3477776666', em: new Date(SEXTA_14H - 7 * MIN).toISOString() }, updated_at: new Date(SEXTA_14H - 7 * MIN).toISOString() });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    expect(h.enviados).toHaveLength(1);                       // o 2º aviso à Nilce (lembretes vêm primeiro)
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(h.enviados).toHaveLength(2);                       // o aviso ao Thiago
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 13 * MIN });
    expect(h.enviados).toHaveLength(3);                       // o 1º abandono
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 14 * MIN });
    expect(h.enviados).toHaveLength(4);                       // o 2º abandono
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 15 * MIN });
    expect(h.enviados).toHaveLength(4);
  });
});

describe('o tick PARA no primeiro envio que falha, e olha o cooldown da linha', () => {
  it('Z-API falhando: uma tentativa só, o claim do abandono é devolvido, e a rodada seguinte tenta de novo', async () => {
    semearDois();
    h.falhar = true;
    const r = await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    expect(vi.mocked(sendWhatsApp)).toHaveBeenCalledTimes(1);
    expect(r.parou).toBe('falha');
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.abandono))).toBe(false);
    h.falhar = false;
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(h.enviados).toHaveLength(1);
  });
  it('linha em cooldown: nada é enviado, e a rodada diz por que parou', async () => {
    semearDois();
    h.cooldown = true;
    const r = await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    expect(vi.mocked(sendWhatsApp)).not.toHaveBeenCalled();
    expect(r.parou).toBe('cooldown');
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.abandono))).toBe(false);
  });
});

describe('o cartão agrupado', () => {
  it('dois chamadores ao mesmo tempo: o cartão sai UMA vez (claim por janela de 10 min)', async () => {
    semearDois();
    filaDoCartao(LEAD); filaDoCartao(LEAD_B);
    await Promise.all([runSolarQuizAvisosTick({ agora: SEXTA_14H + MIN }), runSolarQuizAvisosTick({ agora: SEXTA_14H + MIN })]);
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0].texto).toContain('2 AVISOS');
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(`${CHAVES.cartaoLote}nilce:`))).toBe(true);
  });
  it('só leva quem ainda não foi atendido; se ninguém sobra, não manda nada', async () => {
    semearDois();
    filaDoCartao(LEAD); filaDoCartao(LEAD_B);
    h.main.tabela('system_state').push({ key: CHAVES.falei + LEAD, value: { em: new Date(SEXTA_14H + 30_000).toISOString() }, updated_at: new Date(SEXTA_14H + 30_000).toISOString() });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + MIN });
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0].texto).toContain('https://wa.me/5534988887777');
    expect(cartoes()[0].texto).not.toContain('https://wa.me/5534991112222');
    expect(cartoes()[0].texto).toContain('1 AVISOS');
    // Na janela seguinte o outro também foi atendido: nada a mandar.
    h.main.tabela('system_state').push({ key: CHAVES.falei + LEAD_B, value: { em: new Date(SEXTA_14H + 11 * MIN).toISOString() }, updated_at: new Date(SEXTA_14H + 11 * MIN).toISOString() });
    filaDoCartao(LEAD_B, SEXTA_14H + 5 * MIN);
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 12 * MIN });
    expect(cartoes()).toHaveLength(1);
  });
  it('cartão que falha devolve o claim e deixa a fila para a próxima rodada', async () => {
    semearDois(); filaDoCartao(LEAD);
    h.falhar = true;
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + MIN });
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.cartaoLote))).toBe(false);
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.cartaoFila))).toBe(true);
    h.falhar = false;
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 2 * MIN });
    expect(cartoes()).toHaveLength(1);
  });
  it('T2 (abandono) também nunca vira linha de cartão: com 12 na hora, sai direto', async () => {
    for (let i = 0; i < 12; i++) h.main.tabela('system_state').push({ key: `${CHAVES.envio}nilce:agora:L${i}`, value: {}, updated_at: new Date(SEXTA_14H).toISOString() });
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 11 * MIN });
    expect(paraNilce().filter(e => e.texto.includes('SAIU SEM MARCAR'))).toHaveLength(1);
    expect(h.main.tabela('system_state').some((l: any) => l.key.startsWith(CHAVES.cartaoFila))).toBe(false);
  });
});

describe('dois cliques "agora" do mesmo cliente em dias diferentes', () => {
  it('cada card tem o seu aviso, o "falei" de ontem não cancela os lembretes de hoje, e o clique de hoje marca de novo', async () => {
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H, agendado: 77 });
    expect((await avisarAgora(pedido(), SEXTA_14H)).motivo).toBe('enviado');
    const cod1 = codigoDoAviso(77);
    await marcarFalei(cod1, SEXTA_14H + 2 * MIN);
    h.enviados.length = 0;

    const SEGUNDA_14H = brt('2026-10-26', '14:00');
    vi.setSystemTime(SEGUNDA_14H);
    h.ger.tabela('leads_meta')[0].agendado_id = 88;
    const r = await avisarAgora(pedido({ cardId: 88, quandoMs: SEGUNDA_14H + 5 * MIN }), SEGUNDA_14H);
    expect(r).toEqual({ enviado: true, motivo: 'enviado' });                       // o claim de ontem não segura o de hoje
    expect(paraNilce()).toHaveLength(1);
    expect(h.main.tabela('system_state').some((l: any) => l.key === 'aviso_antigo:88')).toBe(true);
    const cod2 = codigoDoAviso(88);
    expect(cod2).not.toBe(cod1);

    h.enviados.length = 0;
    await runSolarQuizAvisosTick({ agora: SEGUNDA_14H + 6 * MIN });
    expect(paraNilce().filter(e => e.texto.includes('ESPERANDO'))).toHaveLength(1);   // o "falei" velho não cancelou

    const clique = await marcarFalei(cod2, SEGUNDA_14H + 7 * MIN);
    expect(clique).toMatchObject({ estado: 'marcado', em: SEGUNDA_14H + 7 * MIN });
    h.enviados.length = 0;
    await runSolarQuizAvisosTick({ agora: SEGUNDA_14H + 11 * MIN });
    expect(h.enviados).toHaveLength(0);                                              // agora sim, atendido
  });
  it('claim com ERRO não segura o aviso, e a ficha não é bloqueada (sem aviso_antigo)', async () => {
    const orig = h.main.from.bind(h.main);
    h.main.from = (t: string) => {
      const q = orig(t);
      const ins = q.insert;
      q.insert = (p: any) => (String(p?.key ?? '').startsWith(CHAVES.avisoAgora)
        ? Object.assign(q, { then: (ok: any) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'banco' } }).then(ok) })
        : ins(p));
      return q;
    };
    const r = await avisarAgora(pedido(), SEXTA_14H);
    expect(r).toEqual({ enviado: true, motivo: 'enviado' });
    expect(h.main.tabela('system_state').some((l: any) => l.key === 'aviso_antigo:77')).toBe(false);
  });
});

describe('onde saiu: o horário também tem texto próprio (T2 e T3)', () => {
  it('T2 e T3 dizem "Saiu na escolha do horário, sem marcar"', async () => {
    semearLead(h.ger, LEAD, { atividade: SEXTA_14H });
    h.main.tabela('system_state').push({ key: CHAVES.saiu + LEAD, value: { em: new Date(SEXTA_14H + MIN).toISOString(), onde: 'horarios' }, updated_at: new Date(SEXTA_14H + MIN).toISOString() });
    await runSolarQuizAvisosTick({ agora: SEXTA_14H + 7 * MIN });
    expect(paraNilce()[0].texto.split('\n')[1]).toBe('Saiu na escolha do horário, sem marcar');
    expect(listaDas7([{ nome: 'Ana', nota: 80, cidadeUf: 'X-MG', conta: 'Até R$ 300', onde: 'horarios', tel: '5534991112222' }])).toContain('Saiu: Na escolha do horário, sem marcar');
  });
});

describe('anti-ban: o carimbo entra nos tetos de 60/hora e 450/24 h da linha', () => {
  it('vivoEnvio monta os prefixos da linha com todo o balde PREFIXOS_RESPOSTA_AGENTES (inclui solar_quiz_env:)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(__dirname, '../services/agentes5040/vivoEnvio.ts'), 'utf8');
    expect(fonte).toContain('...PREFIXOS_AGENDA, ...PREFIXOS_RESPOSTA_AGENTES])]');
    const { PREFIXOS_RESPOSTA_AGENTES } = await import('../services/agents/whatsapp/lineThrottle');
    expect([...PREFIXOS_RESPOSTA_AGENTES]).toContain('solar_quiz_env:');
  });
});
