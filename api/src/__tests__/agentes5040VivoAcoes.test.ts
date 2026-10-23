import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// As ações da Duda na rodada viva (B1d-2c): marcar, remarcar, ligar agora, volta honesta e suporte. Banco falso em
// memória, IA falsa, e todas as saídas trocadas por mocks que contam chamadas: vivoEnvio (a bolha do turno),
// fichaEnvio (a ficha), agendaEnvio (a fila de agenda), agendaSolar (o card) e as vagas. Nada alcança a rede.
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
  teto: vi.fn(),
  fila: vi.fn(),
  entregarFila: vi.fn(),
  gravar: vi.fn(),
  remarcar: vi.fn(),
  boasVindas: vi.fn(),
  vagas: vi.fn(),
  silenciar: vi.fn(),
  cooldown: false,
  teste: false as boolean | null,
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ enviarResposta: (...a: unknown[]) => h.enviar(...a) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: async () => ({
    ok: true,
    mapa: new Map([['giovanna', '34993396255'], ['nilce', '34991516846'], ['thiago', '34991360223'], ['diego', '34991360172']]),
  }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: (e: any) => /em cooldown|credenciais Z-API ausentes/i.test(String(e?.message ?? e)),
  linhaIoEmCooldown: () => h.cooldown,
  leadEhDeTeste: async () => h.teste,
  telefoneDoConsultor: (m: Map<string, string>, n: string) => m.get(String(n ?? '').trim().toLowerCase().split(' ')[0]!) ?? null,
  telefoneDoDono: () => '34900000000',
  tetoDaLinhaPermiteFicha: (...a: unknown[]) => h.teto(...a),
}));
vi.mock('../services/agentes5040/agendaEnvio', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/agendaEnvio')>()),
  enfileirarAgenda: (...a: unknown[]) => h.fila(...a),
  enviarAgendaPendente: (...a: unknown[]) => h.entregarFila(...a),
}));
vi.mock('../services/agentes5040/agendaSolar', () => ({
  gravarCardSolar: (...a: unknown[]) => h.gravar(...a),
  remarcarCardSolar: (...a: unknown[]) => h.remarcar(...a),
  marcarBoasVindasEnviada: (...a: unknown[]) => h.boasVindas(...a),
  silenciarLembretesDoCard: (...a: unknown[]) => h.silenciar(...a),
}));
vi.mock('../services/agentes5040/agendaSolarVagas', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/agendaSolarVagas')>()),
  vagasSolar: (...a: unknown[]) => h.vagas(...a),
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { BOLHA_PASSAGEM_AGENDA, BOLHA_PASSAGEM_GENERICA, esperaDoRemarcadoMs, pendenciaDevida, runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import {
  acharVaga, alvoDaAgenda, bolhaLigarAgoraOk, camposDeHorario, citaAHora, destinoDaRecusa, kwhDoLead, opcaoPorExtenso, situacaoDoCard,
} from '../services/agentes5040/acoesVivo';
import { bolhaDeConfirmacao } from '../services/agentes5040/agendaEnvio';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number, base: Date = AGORA): string => new Date(base.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);
const DESDE_POSSE = iso(10 * 60_000);
// Quarta 21/10 em Brasília: 9h30, 14h30, 9h45 e 15h30 (UTC-3).
const V1 = '2026-10-21T12:30:00.000Z';
const V2 = '2026-10-21T17:30:00.000Z';
const V3 = '2026-10-22T12:30:00.000Z';
const V4 = '2026-10-22T17:30:00.000Z';
const TXT1 = 'amanhã, quarta, 21/10, às 9h30';
const BOLHA_MARCADO = 'Marcado: amanhã, quarta, às 9h30. Se precisar mudar, é só me chamar aqui.';
const BOLHA_LIGAR = 'Combinado. Já avisei a consultora e ela te liga em instantes. Se ela não puder agora, te volto aqui com um horário.';
const BOLHA_OUTRO = 'Esse horário acabou de ser ocupado. Pode ser amanhã, quarta, às 14h30?';
const FRASE_GASTO = 'Minha conta de luz vem uns R$ 280 por mês';

const telDe = (i: number): string => `55349911${String(1000 + i).padStart(5, '0')}`;
const chaveDe = (i: number): string => `34${telDe(i).slice(-8)}`;
const TEL = telDe(0);
const CHAVE = chaveDe(0);

let banco: BancoFalso;
let gerador: BancoFalso;

const linhaLead = (id: number, tel: string, momento: string, extra: Record<string, unknown> = {}) =>
  ({ id, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: FRASE_GASTO, momment: momento, ...extra });

function semearLead(opts: { texto?: string; momento?: string; posse?: Record<string, unknown>; card?: Record<string, unknown> | null; base?: Date } = {}) {
  const id = 10;
  const base = opts.base ?? AGORA;
  (banco.tabelas.wa_mensagens ??= []).push(linhaLead(id, TEL, opts.momento ?? iso(2 * 60_000, base), { texto: opts.texto ?? FRASE_GASTO }));
  (banco.tabelas.whatsapp_sessions ??= []).push({
    phone: CHAVE, tipo: 'ag5040', updated_at: base.toISOString(),
    lead_data: { dona: 'duda', estado: 'viva', apresentada: true, desde: iso(10 * 60_000, base), ate_wa_id: null, respostas: 0, imagens: [], links: [], ...(opts.posse ?? {}) },
  });
  if (opts.card) (gerador.tabelas.agendamentos ??= []).push({
    id: 7, cliente_telefone: TEL, cliente_nome: 'Tadeu Souza', vendedor_nome: 'Nilce', status: 'agendado', created_by: 'lp_solar',
    created_at: iso(86_400_000, base), quando: '2026-10-23T13:00:00.000Z', cidade: 'Araguari', observacao: null, ...opts.card,
  });
}

function alvo(hmacs: string[]) {
  banco.tabelas.system_state = [
    ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs, modos: {}, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

const posseDe = () => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data as Record<string, any>;
const chavesDoEstado = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);

const dadosHorario = [{ chave: 'horario', valor: TXT1 }];
/** O modelo falso: a n-ésima resposta é a n-ésima da lista (a última repete). */
function modelo(respostas: Array<{ bolhas: string[]; extra?: Record<string, unknown>; antes?: () => void }>) {
  return iaFalsa((_body, n) => {
    const x = respostas[Math.min(n, respostas.length) - 1]!;
    x.antes?.();
    return respostaIA(saidaJson(x.bolhas, x.extra ?? {}), { cache_creation_input_tokens: 100 });
  });
}
let ia = modelo([{ bolhas: [BOLHA_MARCADO], extra: { acao: 'marcar_horario', dados: dadosHorario } }]);
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });
const pedidoDaChamada = (n: number): string => JSON.stringify(ia.chamadas[n]!.body.messages);

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.cooldown = false; h.teste = false;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry ? { ok: false, motivo: 'dry' } : { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  h.teto.mockReset().mockResolvedValue('ok');
  h.fila.mockReset().mockResolvedValue({ ok: true, chave: 'ag5040_agenda_fila:99:confirma' });
  h.entregarFila.mockReset().mockResolvedValue({ enviadas: 0, descartadas: 0, mantidas: 0 });
  h.vagas.mockReset().mockResolvedValue([V1, V2, V3, V4]);
  h.boasVindas.mockReset().mockResolvedValue(true);
  h.silenciar.mockReset().mockResolvedValue(true);
  h.remarcar.mockReset().mockResolvedValue('ok');
  // O card que o gravarCardSolar "criaria": entra na agenda falsa para o resto do código enxergar.
  h.gravar.mockReset().mockImplementation(async (f: any) => {
    const card = { id: 99, vendedor_nome: f.dono, quando: f.quando, cliente_nome: f.nome, cliente_telefone: f.tel, cidade: f.cidade, observacao: f.observacao, created_by: 'lp_solar', created_at: AGORA.toISOString(), status: 'agendado', historico: null };
    (gerador.tabelas.agendamentos ??= []).push(card);
    return { status: 'ok', card };
  });
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  process.env.FICHA_5040_IA_OFF = '1';
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  zerarCacheArmazem(); zerarCacheInterruptores();
  ia = modelo([{ bolhas: [BOLHA_MARCADO], extra: { acao: 'marcar_horario', dados: dadosHorario } }]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.FICHA_5040_IA_OFF;
  (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0;
});

describe('as peças puras das ações', () => {
  it('kWh: o que ele disse em kWh vale primeiro; reais dividem pela tarifa do quiz (1,05); sem gasto = null', () => {
    expect(kwhDoLead({ consumo_kwh: '700' }, [])).toBe(700);
    expect(kwhDoLead({ consumo_kwh: 'uns 600 e pouco' }, [900])).toBe(600);
    expect(kwhDoLead({ consumo: 'R$ 840' }, [])).toBe(800);
    expect(kwhDoLead({}, [280])).toBe(267);
    expect(kwhDoLead({}, [1500])).toBe(1429);
    expect(kwhDoLead({ cidade: 'Uberaba' }, [])).toBeNull();
  });

  it('consultora pela faixa de kWh: até 300 Giovanna, até 1.000 Nilce, acima Thiago; card remarcável manda o vendedor dele', () => {
    expect(alvoDaAgenda(null, 267)).toEqual({ dono: 'Giovanna', faixa: 'novo', origem: 'gasto' });
    expect(alvoDaAgenda(null, 700)).toMatchObject({ dono: 'Nilce' });
    expect(alvoDaAgenda(null, 1429)).toMatchObject({ dono: 'Thiago' });
    expect(alvoDaAgenda(null, null)).toBeNull();
    const card = { id: 7, status: 'agendado', quando: V3, vendedor_nome: 'Nilce', cliente_nome: 'T', cidade: null, observacao: null, created_by: 'lp_solar', created_at: null };
    expect(alvoDaAgenda(card, 267)).toEqual({ dono: 'Nilce', faixa: 'remarcacao', origem: 'card' });
    expect(situacaoDoCard({ ...card, status: 'em_negociacao' })).toBe('bloqueado');
    expect(situacaoDoCard({ ...card, status: 'cancelado' })).toBe('sem_card');
    expect(situacaoDoCard({ ...card, created_by: 'lp_eletroposto' })).toBe('sem_card');
    expect(situacaoDoCard({ ...card, status: 'nao_atendeu' })).toBe('remarcavel');
  });

  it('o casamento da escolha é EXATO (acento e espaço à parte); nada de aproximação', () => {
    const vagas = [V1, V2];
    expect(acharVaga(TXT1, vagas, AGORA.toISOString())).toBe(V1);
    expect(acharVaga('  Amanha,  quarta, 21/10, as 9h30. ', vagas, AGORA.toISOString())).toBe(V1);          // acento, caixa e espaço à parte
    expect(acharVaga('amanhã, quarta, 21/10, às 9h31', vagas, AGORA.toISOString())).toBeNull();
    expect(acharVaga('amanhã às 9h30', vagas, AGORA.toISOString())).toBeNull();
    expect(acharVaga('amanhã, quarta, 21/10, às 9h', vagas, AGORA.toISOString())).toBeNull();
    expect(acharVaga(undefined, vagas, AGORA.toISOString())).toBeNull();
  });

  it('as bolhas fixas cabem na fila de agenda e na regra dos 160', () => {
    const c = camposDeHorario(V1, AGORA.toISOString(), 'Giovanna Souza');
    expect(c).toEqual({ dia: 'amanhã', hora: '9h30', consultora: 'Giovanna' });
    expect(camposDeHorario(V3, AGORA.toISOString(), 'Nilce').dia).toBe('quinta, 22/10');
    expect(opcaoPorExtenso(V1, AGORA.toISOString())).toBe('amanhã às 9h30');
    expect(bolhaLigarAgoraOk('Giovanna')).toBe('A Giovanna já recebeu seu pedido e vai ligar em instantes.');
    expect(bolhaLigarAgoraOk('')).toBeNull();
  });
});

describe('as peças puras novas (correções 3, 10 e 11)', () => {
  it('kWp NÃO é kWh: potência fica de fora; só consumo em kWh ou o gasto em R$ convertido pela tarifa entram', () => {
    expect(kwhDoLead({ potencia: '5 kWp' }, [])).toBeNull();
    expect(kwhDoLead({ potencia_kwp: '8' }, [])).toBeNull();
    expect(kwhDoLead({ consumo: 'sistema de 5 kWp' }, [])).toBeNull();
    expect(kwhDoLead({ potencia: '5 kWp' }, [280])).toBe(267);                 // sem consumo, vale o gasto em R$ ÷ 1,05
    expect(kwhDoLead({ potencia: '5 kWp', consumo_kwh: '450' }, [280])).toBe(450);
    expect(kwhDoLead({ consumo: 'R$ 840' }, [])).toBe(800);
  });

  it('a fala cita a hora do card: 14h30, 14:30, 14h 30; hora cheia aceita 14h, 14:00 e 14 horas; outra hora não vale', () => {
    const t = '2026-10-22T17:30:00.000Z';                                      // 14h30 em Brasília
    for (const ok of ['Fechado para quinta às 14h30!', 'Quinta, 14:30. Combinado', 'às 14h 30 então', 'ÀS 14H30']) expect(citaAHora(ok, t), ok).toBe(true);
    for (const no of ['Fechado para quinta às 14h!', 'Quinta às 4h30', 'às 14h45', 'Combinado, deixei marcado', 'dia 14/10 às 15h30', '']) expect(citaAHora(no, t), no).toBe(false);
    const cheia = '2026-10-22T17:00:00.000Z';                                  // 14h
    for (const ok of ['às 14h', 'às 14:00', 'às 14 horas', 'as 14h, tudo bem?']) expect(citaAHora(ok, cheia), ok).toBe(true);
    for (const no of ['às 14h30', 'às 4h', 'às 114h']) expect(citaAHora(no, cheia), no).toBe(false);
    const manha = '2026-10-22T12:00:00.000Z';                                  // 9h
    expect(citaAHora('às 09h', manha)).toBe(true);
    expect(citaAHora('às 9h', manha)).toBe(true);
    expect(citaAHora('às 19h', manha)).toBe(false);
  });

  it('só a recusa passageira vai para a fila; 5xx e timeout levam reforço; o resto passa ao humano', () => {
    for (const motivo of ['teto_agentes', 'teto_linha', 'prazo', 'espacamento', 'linha_pausada', 'pausa_humana']) expect(destinoDaRecusa({ motivo }), motivo).toBe('fila');
    for (const detalhe of ['cooldown', 'credenciais', 'reserva_falhou']) expect(destinoDaRecusa({ motivo: 'erro_linha', detalhe }), detalhe).toBe('fila');
    for (const detalhe of ['http_500', 'http_503', 'timeout']) expect(destinoDaRecusa({ motivo: 'erro_linha', detalhe }), detalhe).toBe('fila_reforco');
    for (const detalhe of ['http_400', 'http_404', 'falha', undefined]) expect(destinoDaRecusa({ motivo: 'erro_linha', detalhe }), String(detalhe)).toBe('humano');
    for (const motivo of ['ja_respondido', 'robo_do_outro_lado', 'mudo', 'bloqueado', 'bolha_invalida', 'pediu_humano', 'dry']) expect(destinoDaRecusa({ motivo }), motivo).toBe('humano');
  });
});

describe('marcar_horario', () => {
  it('sem card: a consultora vem da faixa de kWh do gasto (R$ 280 = Giovanna), o card nasce, a bolha do turno confirma e SÓ DEPOIS carimba as boas-vindas', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(h.vagas).toHaveBeenCalledTimes(1);
    expect(h.vagas.mock.calls[0]![0]).toMatchObject({ dono: 'Giovanna', caminho: 'ligacao', faixa: 'novo' });
    expect(ia.chamadas).toHaveLength(1);
    expect(pedidoDaChamada(0)).toContain(TXT1);                                // a lista foi aos fatos, por extenso
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.gravar.mock.calls[0]![0]).toMatchObject({ dono: 'Giovanna', quando: V1, tel: TEL });
    expect(h.gravar.mock.calls[0]![0].observacao.split('\n')[0]).toBe('LP SOLAR QUIZ · LIGAÇÃO');
    expect(h.gravar.mock.calls[0]![1]).toEqual({ faixa: 'novo' });
    expect(h.remarcar).not.toHaveBeenCalled();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'duda', telefone: TEL, bolha: BOLHA_MARCADO, dry: false });
    expect(h.boasVindas).toHaveBeenCalledWith(99);
    expect(h.gravar.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    expect(h.enviar.mock.invocationCallOrder[0]!).toBeLessThan(h.boasVindas.mock.invocationCallOrder[0]!);
    expect(h.fila).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();                                    // a ficha do card novo é do fichaTick
    expect(posseDe()).toMatchObject({ estado: 'viva', ate_wa_id: 10, respostas: 1 });
    expect(r.decisoes[0]).toMatchObject({ acao: 'marcar_horario', resultado: 'marcou' });
    expect(h.entregarFila).not.toHaveBeenCalled();                              // a fila tem rota e relógio próprios
  });

  it('a faixa de kWh decide a consultora: R$ 700 = Nilce, R$ 1.500 = Thiago', async () => {
    for (const [texto, dono] of [['Minha conta vem R$ 700 por mês', 'Nilce'], ['Minha conta vem R$ 1.500 por mês', 'Thiago']] as const) {
      banco = novoBanco(); gerador = novoBanco(); h.principal = banco; h.gerador = gerador;
      h.vagas.mockClear(); h.gravar.mockClear();
      semearLead({ texto }); alvo([hmacDe(CHAVE)!]);
      await rodar();
      expect(h.vagas.mock.calls[0]![0].dono, texto).toBe(dono);
      expect(h.gravar.mock.calls[0]![0].dono, texto).toBe(dono);
    }
  });

  it('sem gasto (nem card): não marca e nenhuma vaga é lida; passa ao humano com a ficha e a bolha fixa de agenda', async () => {
    semearLead({ texto: 'Quero saber de energia solar' }); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(h.vagas).not.toHaveBeenCalled();
    expect(pedidoDaChamada(0)).toContain('o sistema não trouxe nenhum');
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.remarcar).not.toHaveBeenCalled();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA);
    expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano' });
    expect(r.decisoes[0]).toMatchObject({ acao: 'marcar_horario', resultado: 'passou_ao_humano', ficha: 'enviada' });
  });

  it('com card agendado: remarca o MESMO card (faixa :15/:45 do vendedor dele), não cria outro e manda a ficha "remarcado"', async () => {
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.vagas.mock.calls[0]![0]).toMatchObject({ dono: 'Nilce', faixa: 'remarcacao' });
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.remarcar).toHaveBeenCalledTimes(1);
    expect(h.remarcar.mock.calls[0]).toEqual([7, V1, { faixa: 'remarcacao' }]);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.boasVindas).not.toHaveBeenCalled();                               // card antigo: não é o carimbo da abertura
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');                      // Nilce
    expect(String(h.ficha.mock.calls[0]![1])).toContain('REMARCADO');
    expect(h.teto).toHaveBeenCalledTimes(1);
    const chaves = chavesDoEstado();
    expect(chaves).toContain(`ficha_card:7:${V1}`);
    expect(chaves.filter(k => k.startsWith('ficha_lead:'))).toHaveLength(1);
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 1 });
  });

  it('horário tomado: UMA nova chamada à IA com o aviso e as vagas novas; se ela oferece outro, a bolha sai normal e nada é gravado', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.gravar.mockResolvedValue({ status: 'horario_tomado' });
    ia = modelo([
      { bolhas: [BOLHA_MARCADO], extra: { acao: 'marcar_horario', dados: dadosHorario } },
      { bolhas: [BOLHA_OUTRO], extra: { acao: 'continuar' } },
    ]);
    h.vagas.mockResolvedValueOnce([V1, V2, V3, V4]).mockResolvedValueOnce([V2, V3]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(pedidoDaChamada(1)).toContain('AVISO DO SISTEMA');
    expect(pedidoDaChamada(1)).toContain('amanhã, quarta, 21/10, às 14h30');
    expect(pedidoDaChamada(0)).not.toContain('AVISO DO SISTEMA');
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_OUTRO);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(r.chamadasIA).toBe(2);
  });

  it('horário tomado e a IA insiste em marcar: passa ao humano (ficha e bolha fixa de agenda), sem 3ª chamada', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.gravar.mockResolvedValue({ status: 'horario_tomado' });
    const r = await rodar();                                                    // o modelo falso repete marcar_horario
    expect(ia.chamadas).toHaveLength(2);
    expect(h.gravar).toHaveBeenCalledTimes(1);                                  // a 2ª resposta nem tenta gravar
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano' });
    expect(r.decisoes[r.decisoes.length - 1]).toMatchObject({ resultado: 'passou_ao_humano' });
  });

  it('a IA escolhe um horário que não está na lista: nada é gravado, 1 nova chamada', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = modelo([
      { bolhas: [BOLHA_MARCADO], extra: { acao: 'marcar_horario', dados: [{ chave: 'horario', valor: 'amanhã, quarta, 21/10, às 10h' }] } },
      { bolhas: [BOLHA_OUTRO], extra: { acao: 'continuar' } },
    ]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(2);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_OUTRO);
  });

  it('bolha recusada depois de gravar: UMA confirmação na fila de agenda (tipo confirma), nada de reenvio, a vez não é solta, o carimbo das boas-vindas fica', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValue({ ok: false, motivo: 'teto_agentes', detalhe: 'hora:20' });
    const r = await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.fila).toHaveBeenCalledTimes(1);
    const pedido = h.fila.mock.calls[0]![0];
    // O item leva o ISO do horário, nunca o texto pronto: "amanhã" e "9h30" são montados na hora do envio.
    expect(pedido).toMatchObject({ tipo: 'confirma', cardId: 99, telefone: TEL, quando: V1, validoAte: V1, consultora: 'Giovanna' });
    expect(pedido.reforco).toBeUndefined();
    expect(pedido.campos).toBeUndefined();
    expect(bolhaDeConfirmacao('confirma', V1, 'Giovanna', AGORA.toISOString())).toBe('Ficou marcado para amanhã às 9h30. A Giovanna te liga nesse horário.');
    expect(h.boasVindas).not.toHaveBeenCalled();
    expect(chavesDoEstado()).toContain('ag5040_vez_vivo:10');
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 0, estado: 'viva' });
    expect(r.decisoes[0]).toMatchObject({ resultado: 'confirmacao_enfileirada', motivo: 'teto_agentes:hora:20' });
    // a mesma fala não volta: a próxima rodada não chama a IA, não grava e não envia de novo
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.fila).toHaveBeenCalledTimes(1);
  });

  it('remarcação com bolha recusada: a fila leva o tipo remarca, e a ficha "remarcado" sai mesmo assim', async () => {
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValue({ ok: false, motivo: 'linha_pausada' });
    await rodar();
    expect(h.fila.mock.calls[0]![0]).toMatchObject({ tipo: 'remarca', cardId: 7, quando: V1, validoAte: V1, consultora: 'Nilce' });
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('erro de linha na bolha: enfileira a confirmação e PARA a rodada', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValue({ ok: false, motivo: 'erro_linha', detalhe: 'http_500' });
    const r = await rodar();
    expect(h.fila).toHaveBeenCalledTimes(1);
    expect(h.fila.mock.calls[0]![0]).toMatchObject({ tipo: 'confirma', reforco: true });   // 5xx: pode ter chegado, sai o texto de reforço
    expect(r.parou).toBe('erro_linha');
  });

  it('card de gente (negociação): a Duda não mexe; passa ao humano', async () => {
    semearLead({ card: { status: 'em_negociacao' } }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.remarcar).not.toHaveBeenCalled();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA);
  });

  it('card de eletroposto não conta como card do solar: nasce card novo', async () => {
    semearLead({ card: { created_by: 'lp_eletroposto', vendedor_nome: 'Diego' } }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.remarcar).not.toHaveBeenCalled();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.gravar.mock.calls[0]![0].dono).toBe('Giovanna');
  });

  it('o dry mostra que marcaria e não escreve nada: sem card, sem ficha, sem envio, sem posse alterada', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar({ dry: true });
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.remarcar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ ate_wa_id: null, respostas: 0 });
    expect(r.decisoes[0]).toMatchObject({ resultado: 'marcaria', sairia: [BOLHA_MARCADO] });
  });
});

describe('ligar_agora', () => {
  beforeEach(() => {
    ia = modelo([{ bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } }]);
  });

  it('em horário comercial: o card nasce com lembrete e bom dia (ligarAgora), a ficha vai ANTES da bolha com reserva própria, e a posse guarda o aviso', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.gravar.mock.calls[0]![0]).toMatchObject({ dono: 'Giovanna', quando: AGORA.toISOString() });
    expect(h.gravar.mock.calls[0]![1]).toEqual({ ligarAgora: true });
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34993396255');
    expect(String(h.ficha.mock.calls[0]![1])).toContain('LIGAR AGORA');
    expect(String(h.ficha.mock.calls[0]![1])).toContain(`wa.me/${TEL}`);
    expect(h.teto).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_LIGAR);
    expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    const chaves = chavesDoEstado();
    expect(chaves).toContain('ag5040_ligar:99:2026-10-20');                     // reserva própria, POR DIA
    expect(chaves).toContain('ficha_card:99');                                  // o fichaTick não duplica
    expect(chaves.filter(k => k.startsWith('ficha_lead:'))).toHaveLength(1);
    expect(h.boasVindas).toHaveBeenCalledWith(99);                              // a ficha saiu: sem boas-vindas por cima
    expect(h.silenciar).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'viva', ate_wa_id: 10, respostas: 1 });
    expect(posseDe().ligar).toMatchObject({ cardId: 99, avisado_em: AGORA.toISOString(), dono: 'Giovanna', faixa: 'novo', criado: true });
    expect(r.decisoes[0]).toMatchObject({ acao: 'ligar_agora', resultado: 'ligar_agora', ficha: 'enviada' });
  });

  it('card existente agendado: usa o card, não cria outro; não reserva ficha_card (o fichaTick já tratou o dele)', async () => {
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');                      // Nilce, a do card
    expect(chavesDoEstado()).toContain('ag5040_ligar:7:2026-10-20');
    expect(chavesDoEstado()).not.toContain('ficha_card:7');
    expect(h.silenciar).toHaveBeenCalledWith(7);                                // card EXISTENTE: lembrete de 5 min e bom dia = agora
    expect(h.boasVindas).not.toHaveBeenCalled();
    expect(posseDe().ligar).toMatchObject({ cardId: 7, criado: false });
  });

  it('ficha que não saiu: o card criado agora é desfeito e a IA é chamada de novo com o aviso e 2 vagas', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.ficha.mockRejectedValue(new Error('linha em cooldown'));
    ia = modelo([
      { bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } },
      { bolhas: [BOLHA_OUTRO], extra: { acao: 'continuar' } },
    ]);
    await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect((gerador.tabelas.agendamentos ?? []).find(c => c.id === 99)?.status).toBe('cancelado');
    expect(ia.chamadas).toHaveLength(2);
    expect(pedidoDaChamada(1)).toContain('ligação imediata NÃO está disponível');
    expect(h.vagas).toHaveBeenCalledTimes(2);
    expect(h.vagas.mock.calls[1]![0].n).toBe(2);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_OUTRO);                   // nenhuma promessa de ligação
    const chaves = chavesDoEstado();
    expect(chaves).toContain('ficha_card:99');                                    // o fichaTick não manda ficha de card negado
    expect((banco.tabelas.system_state ?? []).find(l => l.key === 'ficha_card:99')?.value).toMatchObject({ estado: 'card_desfeito' });
    expect(chaves.filter(k => k.startsWith('ag5040_ligar:'))).toEqual([]);          // a reserva própria voltou
    expect(h.boasVindas).not.toHaveBeenCalled();
    expect(chaves.filter(k => k.startsWith('ficha_lead:'))).toHaveLength(0);
    expect(posseDe().ligar).toBeUndefined();
  });

  it('teto de emergência da linha cheio: a ficha não sai, o card é desfeito (60/450 respeitado)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.teto.mockResolvedValue('teto');
    ia = modelo([
      { bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } },
      { bolhas: [BOLHA_OUTRO], extra: { acao: 'continuar' } },
    ]);
    await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect((gerador.tabelas.agendamentos ?? []).find(c => c.id === 99)?.status).toBe('cancelado');
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_OUTRO);
  });

  it('fora do horário comercial (a hora vira no meio da rodada): vira marcar, sem card, sem ficha, nova chamada com 2 vagas', async () => {
    const base = new Date('2026-10-20T20:59:30.000Z');                           // 17:59:30 em Brasília
    vi.setSystemTime(base);
    semearLead({ base }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([
      { bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' }, antes: () => { vi.setSystemTime(new Date(base.getTime() + 60_000)); } },   // 18:00:30
      { bolhas: [BOLHA_OUTRO], extra: { acao: 'continuar' } },
    ]);
    const r = await runVivoTick({ cliente: ia.cliente });
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(2);
    expect(pedidoDaChamada(1)).toContain('horário comercial acabou');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_OUTRO);
    expect(r.enviadas).toBe(1);
  });

  it('sem gasto: não liga (passa ao humano, bolha genérica)', async () => {
    semearLead({ texto: 'Quero saber de energia solar' }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_GENERICA);
  });
});

describe('volta honesta do ligar agora', () => {
  const AVISADO = iso(16 * 60_000);
  const ligar = (extra: Record<string, unknown> = {}) => ({ cardId: 99, avisado_em: AVISADO, dono: 'Giovanna', faixa: 'novo', criado: true, status_inicial: 'agendado', ...extra });
  const cardLigar = (extra: Record<string, unknown> = {}) => ({ id: 99, cliente_telefone: TEL, vendedor_nome: 'Giovanna', status: 'agendado', ...extra });
  /** Nossa bolha ("ela te liga em instantes") depois do aviso: sai da API, então NÃO é sinal da consultora. */
  const bolhaNossa = { id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: BOLHA_LIGAR, momment: iso(15 * 60_000 + 30_000) };

  function semearVolta(opts: { posse?: Record<string, unknown>; msgs?: any[]; card?: Record<string, unknown> | null } = {}) {
    (banco.tabelas.wa_mensagens ??= []).push(
      linhaLead(10, TEL, iso(17 * 60_000), { texto: 'Pode ligar' }), bolhaNossa, ...(opts.msgs ?? []),
    );
    (banco.tabelas.whatsapp_sessions ??= []).push({
      phone: CHAVE, tipo: 'ag5040', updated_at: AVISADO,
      lead_data: { dona: 'duda', estado: 'viva', apresentada: true, desde: iso(20 * 60_000), ate_wa_id: 11, respostas: 1, imagens: [], links: [], ligar: ligar(), ...(opts.posse ?? {}) },
    });
    if (opts.card !== null) (gerador.tabelas.agendamentos ??= []).push(cardLigar(opts.card ?? {}));
    alvo([hmacDe(CHAVE)!]);
  }

  it('15 min sem sinal (e com a nossa bolha de API depois do aviso): 1 volta na fila e a conversa passa ao humano; a rodada seguinte não repete', async () => {
    semearVolta();
    h.vagas.mockResolvedValue([V1, V2]);
    const r = await rodar();
    expect(h.fila).toHaveBeenCalledTimes(1);
    const p = h.fila.mock.calls[0]![0];
    expect(p).toMatchObject({
      tipo: 'volta', cardId: 99, telefone: TEL, quando: AVISADO, validoAte: new Date(Date.parse(AVISADO) + 40 * 60_000).toISOString(),
      consultora: 'Giovanna', opcoes: [V1, V2],
    });
    expect(p.campos).toBeUndefined();                                           // o texto ("amanhã às 9h30") é montado no envio
    expect(posseDe()).toMatchObject({ estado: 'passou_humano' });
    expect(posseDe().ligar.volta_em).toBeTruthy();
    expect(r.pendencias).toMatchObject({ voltas: 1 });
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();                                    // quem fala é o robô de agenda, não a resposta
    await rodar();
    expect(h.fila).toHaveBeenCalledTimes(1);
  });

  it('menos de 15 min: nada ainda', async () => {
    semearVolta({ posse: { ligar: ligar({ avisado_em: iso(14 * 60_000) }) } });
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
  });

  it('com sinal (a consultora falou ao cliente do celular): nada é enviado e a pendência se resolve', async () => {
    semearVolta({ msgs: [{ id: 12, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: false, tipo: 'texto', texto: 'Oi, aqui é a Giovanna', momment: iso(2 * 60_000) }] });
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    expect(posseDe().ligar.resolvido_em).toBeTruthy();
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
  });

  it('com sinal (ela respondeu à ficha no chat dela com a 5040): nada', async () => {
    semearVolta({ msgs: [{ id: 13, instancia: 'inst-io', telefone: '5534993396255', is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Ok, liguei', momment: iso(3 * 60_000) }] });
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe().ligar.resolvido_em).toBeTruthy();
  });

  it('com sinal (o status do card mudou): nada', async () => {
    semearVolta({ card: { status: 'nao_atendeu' } });
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe().ligar.resolvido_em).toBeTruthy();
  });

  it('quem pediu para parar depois do ligar agora: nada é enfileirado e o estado nao_incomodar NÃO é apagado', async () => {
    semearVolta({ posse: { estado: 'nao_incomodar' } });
    h.vagas.mockResolvedValue([V1, V2]);
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('nao_incomodar');
    expect(posseDe().ligar.resolvido_em).toBeTruthy();
  });

  it('menos de 2 vagas: não monta a bolha; passa ao humano sem enfileirar', async () => {
    semearVolta();
    h.vagas.mockResolvedValue([V1]);
    await rodar();
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'passou_humano' });
    expect(posseDe().ligar.volta).toBe('sem_vagas');
  });

  it('o dry não enfileira nem muda a posse', async () => {
    semearVolta();
    h.vagas.mockResolvedValue([V1, V2]);
    const r = await rodar({ dry: true });
    expect(h.fila).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    expect(r.decisoes.some(d => d.resultado === 'volta_enfileiraria')).toBe(true);
  });
});

describe('suporte_giovanna', () => {
  const BOLHA_SUPORTE = 'Entendi. Passei os seus dados para a Giovanna e ela fala com você por aqui mesmo.';
  beforeEach(() => {
    ia = modelo([{ bolhas: [BOLHA_SUPORTE], extra: { acao: 'suporte_giovanna', resumo: 'Cliente quer reembolso' } }]);
  });

  it('ficha completa à Giovanna (reserva própria e ficha_lead) ANTES da bolha do turno; posse passou_humano com o aviso guardado', async () => {
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(h.teto).toHaveBeenCalledTimes(1);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34993396255');
    expect(String(h.ficha.mock.calls[0]![1])).toContain('SUPORTE');
    expect(String(h.ficha.mock.calls[0]![1])).toContain('Cliente quer reembolso');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_SUPORTE);
    expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    const chaves = chavesDoEstado();
    expect(chaves).toContain(`ag5040_suporte:${hmacDe(CHAVE)}:10`);
    expect(chaves.filter(k => k.startsWith('ficha_lead:'))).toHaveLength(1);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10, respostas: 1 });
    expect(posseDe().suporte).toMatchObject({ wa_id: 10, avisado_em: AGORA.toISOString(), resumo: 'Cliente quer reembolso' });
    expect(r.decisoes[0]).toMatchObject({ acao: 'suporte_giovanna', resultado: 'passou_ao_humano', ficha: 'enviada' });
  });

  it('10 min sem fala da Giovanna (a nossa bolha de API não conta): a MESMA ficha vai ao dono, uma vez só', async () => {
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    h.ficha.mockClear(); h.teto.mockClear();
    const depois = new Date(AGORA.getTime() + 11 * 60_000);
    vi.setSystemTime(depois);
    const r = await runVivoTick({ agora: depois, cliente: ia.cliente });
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34900000000');
    expect(String(h.ficha.mock.calls[0]![1])).toContain('REENVIO');
    expect(chavesDoEstado()).toContain(`ag5040_suporte_dono:${hmacDe(CHAVE)}:10`);
    expect(posseDe().suporte.dono_em).toBeTruthy();
    expect(r.pendencias).toMatchObject({ reenvios: 1 });
    await runVivoTick({ agora: new Date(depois.getTime() + 120_000), cliente: ia.cliente });
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(ia.chamadas).toHaveLength(1);
  });

  it('suporte de quem depois pediu para parar: sem reenvio ao dono e o estado fica', async () => {
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    h.ficha.mockClear();
    posseDe().estado = 'nao_incomodar';
    const depois = new Date(AGORA.getTime() + 11 * 60_000);
    vi.setSystemTime(depois);
    await runVivoTick({ agora: depois, cliente: ia.cliente });
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('nao_incomodar');
  });

  it('a Giovanna falou (autor equipe depois do aviso): nenhum reenvio ao dono', async () => {
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    h.ficha.mockClear();
    (banco.tabelas.wa_mensagens ??= []).push({ id: 14, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: false, tipo: 'texto', texto: 'Oi, é a Giovanna', momment: iso(-5 * 60_000) });
    const depois = new Date(AGORA.getTime() + 11 * 60_000);
    vi.setSystemTime(depois);
    await runVivoTick({ agora: depois, cliente: ia.cliente });
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().suporte.resolvido_em).toBeTruthy();
  });

  it('teto de emergência cheio: a ficha não sai, nenhuma bolha promete a Giovanna e a vez é solta para a próxima rodada', async () => {
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    h.teto.mockResolvedValue('teto');
    const r = await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(chavesDoEstado()).not.toContain('ag5040_vez_vivo:10');
    expect(posseDe().estado).toBe('viva');
    expect(r.decisoes[0]).toMatchObject({ resultado: 'ficha_adiada', ficha: 'adiada' });
  });

  it('ficha incerta (timeout): sem bolha; passou_humano para não mandar duas', async () => {
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    h.ficha.mockRejectedValue(new Error('timeout'));
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('passou_humano');
  });
});

describe('a fila de agenda tem relógio próprio', () => {
  it('a rodada viva NÃO entrega a fila, de dia ou de noite (quem entrega é a rota /cron/agentes-5040/agenda)', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    await rodar();
    for (const hora of ['2026-10-21T02:00:00.000Z', '2026-10-20T10:00:00.000Z', '2026-10-20T23:59:00.000Z']) {
      await runVivoTick({ agora: new Date(hora), cliente: ia.cliente });
    }
    expect(h.entregarFila).not.toHaveBeenCalled();
  });
});

describe('o que vale para todas as ações', () => {
  it('nenhum telefone cru em system_state nem no relatório', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    const estado = JSON.stringify(banco.tabelas.system_state ?? []);
    expect(estado).not.toContain(TEL);
    expect(estado).not.toContain(CHAVE);
    expect(JSON.stringify(r)).not.toContain(TEL);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it('Helena e Carla seguem fora: a rodada não executa ação de agenda para posse delas', async () => {
    semearLead({ posse: { dona: 'helena' } }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(0);
  });

  it('passar_helena segue o caminho antigo: ficha e bolha fixa genérica, sem tocar na agenda', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: [], extra: { acao: 'passar_helena' } }]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_GENERICA);
  });
});


// ── as correções do B1d-2 (revisor Opus reprovou; chefe não bloqueia com passos) ─────────────────────────────

/** Zera os dois bancos e os mocks de contagem (para repetir o mesmo cenário em laço). */
function recomecar(): void {
  banco = novoBanco(); gerador = novoBanco(); h.principal = banco; h.gerador = gerador;
  for (const m of [h.gravar, h.remarcar, h.fila, h.ficha, h.boasVindas, h.silenciar]) m.mockClear();
  h.enviar.mockClear();
  zerarCacheInterruptores(); zerarCacheArmazem();
  ia = modelo([{ bolhas: [BOLHA_MARCADO], extra: { acao: 'marcar_horario', dados: dadosHorario } }]);
}

const cardDeEletropostoMaisNovo = {
  id: 8, cliente_telefone: TEL, cliente_nome: 'Tadeu', vendedor_nome: 'Diego', status: 'agendado', created_by: 'lp_eletroposto',
  quando: '2026-10-25T13:00:00.000Z', cidade: 'Araguari', observacao: null,
};

describe('correção 2: o card do solar é o mais novo DO SOLAR', () => {
  it('card de eletroposto MAIS NOVO que um solar agendado: remarca o solar, nunca cria outro card', async () => {
    semearLead({ card: {} });                                                   // solar id 7, criado há 1 dia, Nilce
    (gerador.tabelas.agendamentos ??= []).push({ ...cardDeEletropostoMaisNovo, created_at: iso(3_600_000) });
    alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.remarcar).toHaveBeenCalledTimes(1);
    expect(h.remarcar.mock.calls[0]).toEqual([7, V1, { faixa: 'remarcacao' }]);
    expect(h.vagas.mock.calls[0]![0]).toMatchObject({ dono: 'Nilce', faixa: 'remarcacao' });   // a consultora é a do SOLAR, não o Diego do eletroposto
  });

  it('o mesmo vale para o ligar agora: usa o card solar, não cria outro', async () => {
    ia = modelo([{ bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } }]);
    semearLead({ card: {} });
    (gerador.tabelas.agendamentos ??= []).push({ ...cardDeEletropostoMaisNovo, created_at: iso(3_600_000) });
    alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');                      // Nilce, a do card solar
    expect(posseDe().ligar).toMatchObject({ cardId: 7, criado: false });
  });
});

describe('correção 3: o que fazer com a bolha do turno recusada depois de gravar', () => {
  it('erro de linha que PROVA que nada saiu (cooldown): fila normal, SEM texto de reforço', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValue({ ok: false, motivo: 'erro_linha', detalhe: 'cooldown' });
    await rodar();
    expect(h.fila).toHaveBeenCalledTimes(1);
    expect(h.fila.mock.calls[0]![0].reforco).toBeUndefined();
  });

  it.each([
    ['ja_respondido', undefined], ['mudo', undefined], ['bloqueado', undefined], ['robo_do_outro_lado', undefined],
    ['bolha_invalida', 'passa_de_160'], ['pediu_humano', undefined], ['erro_linha', 'http_400'], ['erro_linha', 'falha'],
  ])('%s %s: o card fica, passa ao humano com ficha, SEM bolha e SEM fila', async (motivo, detalhe) => {
    recomecar();
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValue({ ok: false, motivo, ...(detalhe ? { detalhe } : {}) });
    await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);                                  // o card foi gravado e FICA
    expect(h.fila).not.toHaveBeenCalled();
    expect(h.enviar).toHaveBeenCalledTimes(1);                                  // só a tentativa do turno: nenhuma bolha de passagem
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
    expect((gerador.tabelas.agendamentos ?? []).find(c => c.id === 99)?.status).toBe('agendado');
  });

  it.each(['teto_agentes', 'teto_linha', 'prazo', 'espacamento', 'linha_pausada', 'pausa_humana'])('%s: recusa passageira vai para a fila', async motivo => {
    recomecar();
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValue({ ok: false, motivo });
    await rodar();
    expect(h.fila).toHaveBeenCalledTimes(1);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
  });
});

describe('correção 10: a bolha do turno cita a hora do card, senão sai o texto fixo', () => {
  it('sem a hora na fala do modelo: sai a bolha fixa de confirma, pelo enviarResposta', async () => {
    ia = modelo([{ bolhas: ['Combinado, já deixei marcado pra você!'], extra: { acao: 'marcar_horario', dados: dadosHorario } }]);
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Ficou marcado para amanhã às 9h30. A Giovanna te liga nesse horário.');
    expect(r.decisoes[0]).toMatchObject({ resultado: 'marcou', motivo: 'bolha_fixa' });
    expect(h.boasVindas).toHaveBeenCalledWith(99);
  });

  it('hora errada ou só a hora cheia de um horário com minutos (9h para 9h30): também troca; na remarcação o texto é o de remarca', async () => {
    ia = modelo([{ bolhas: ['Fechado, amanhã às 9h então!'], extra: { acao: 'marcar_horario', dados: dadosHorario } }]);
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Pronto, mudei sua ligação para amanhã às 9h30. Quem liga é a Nilce.');
  });

  it('fala que cita a hora (9:30 ou 9h30) sai como o modelo escreveu', async () => {
    ia = modelo([{ bolhas: ['Marcado para amanhã às 9:30, combinado?'], extra: { acao: 'marcar_horario', dados: dadosHorario } }]);
    semearLead(); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Marcado para amanhã às 9:30, combinado?');
    expect(r.decisoes[0]!.motivo).toBeNull();
  });
});

describe('correção 4: ficha_lead leva o id da fala (n = L.id)', () => {
  it('o 2º suporte do mesmo lead (outra fala) manda a ficha de novo, e não cai em ja_avisada', async () => {
    ia = modelo([{ bolhas: ['Entendi. Passei os seus dados para a Giovanna e ela fala com você por aqui mesmo.'], extra: { acao: 'suporte_giovanna', resumo: 'Cliente quer reembolso' } }]);
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    // o lead volta com outro pedido: posse viva de novo e uma fala nova
    const depois = new Date(AGORA.getTime() + 4 * 60_000);
    vi.setSystemTime(depois);
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(20, TEL, new Date(depois.getTime() - 2 * 60_000).toISOString(), { texto: 'Ainda preciso do reembolso, é urgente' }));
    Object.assign(posseDe(), { estado: 'viva', ate_wa_id: 10 });
    delete posseDe().suporte;
    await runVivoTick({ agora: depois, cliente: ia.cliente });
    expect(h.ficha).toHaveBeenCalledTimes(2);
    expect(chavesDoEstado().filter(k => k.startsWith('ficha_lead:'))).toHaveLength(2);
    expect(chavesDoEstado()).toContain(`ag5040_suporte:${hmacDe(CHAVE)}:20`);
  });
});

describe('correção 5: ligar agora com ficha INCERTA', () => {
  beforeEach(() => { ia = modelo([{ bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } }]); });

  it('5xx/timeout na ficha: o card FICA, nada é negado ao cliente, sem bolha; passa ao humano; a volta honesta fica armada', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.ficha.mockRejectedValue(new Error('timeout'));
    const r = await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect((gerador.tabelas.agendamentos ?? []).find(c => c.id === 99)?.status).toBe('agendado');   // NÃO foi desfeito
    expect(h.enviar).not.toHaveBeenCalled();                                    // nem promessa, nem negativa
    expect(ia.chamadas).toHaveLength(1);                                        // nem 2ª chamada ao modelo
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
    expect(posseDe().ligar).toMatchObject({ cardId: 99, criado: true });
    expect(h.boasVindas).toHaveBeenCalledWith(99);                              // nem boas-vindas por cima
    expect(chavesDoEstado()).not.toContain('ficha_card:99');                    // o fichaTick ainda pode mandar a dele
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passou_ao_humano', ficha: 'falhou' });
  });

  it('só a ficha que PROVOU não sair (cooldown) desfaz o card', async () => {
    semearLead(); alvo([hmacDe(CHAVE)!]);
    h.ficha.mockRejectedValue(new Error('linha em cooldown'));
    ia = modelo([{ bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } }, { bolhas: [BOLHA_OUTRO], extra: { acao: 'continuar' } }]);
    await rodar();
    expect((gerador.tabelas.agendamentos ?? []).find(c => c.id === 99)?.status).toBe('cancelado');
  });
});

describe('correção 6: reserva do ligar agora por dia', () => {
  it('no dia seguinte a reserva é outra (ag5040_ligar:<card>:<dia>), então o pedido não cai em ja_avisada', async () => {
    ia = modelo([{ bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } }]);
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(chavesDoEstado()).toContain('ag5040_ligar:7:2026-10-20');
    expect(h.ficha).toHaveBeenCalledTimes(1);
    const amanha = new Date(AGORA.getTime() + 24 * 3_600_000);                  // quarta 21/10, 12:00 em Brasília
    vi.setSystemTime(amanha);
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(30, TEL, new Date(amanha.getTime() - 2 * 60_000).toISOString(), { texto: 'Pode me ligar agora?' }));
    Object.assign(posseDe(), { estado: 'viva', ate_wa_id: 10 });
    delete posseDe().ligar;
    await runVivoTick({ agora: amanha, cliente: ia.cliente });
    expect(chavesDoEstado()).toContain('ag5040_ligar:7:2026-10-21');
    expect(h.ficha).toHaveBeenCalledTimes(2);
  });
});

describe('correção 7: ficha "remarcado" que não saiu vira pendência e é retentada', () => {
  const preparar = (): void => { semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]); };
  const depoisDe = async (min: number) => {
    const t = new Date(AGORA.getTime() + min * 60_000);
    vi.setSystemTime(t);
    return runVivoTick({ agora: t, cliente: ia.cliente });
  };
  /** O que o remarcarCardSolar de verdade faria no card: o horário novo. */
  const cardNoHorarioNovo = (): void => { (gerador.tabelas.agendamentos ?? []).find(c => c.id === 7)!.quando = V1; };

  it('adiada (teto de emergência): a pendência fica na posse SEM telefone e a rodada seguinte manda a ficha', async () => {
    preparar();
    h.teto.mockResolvedValue('teto');
    await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).toHaveBeenCalledTimes(1);                                  // a confirmação ao cliente saiu
    expect(posseDe().remarcado).toMatchObject({ cardId: 7, para: V1, wa_id: 10, tentativas: 1, incerta: false });
    expect(JSON.stringify(posseDe())).not.toContain(TEL);
    h.teto.mockResolvedValue('ok'); cardNoHorarioNovo();
    const r = await depoisDe(2);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('REMARCADO');
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');
    expect(chavesDoEstado()).toContain(`ficha_card:7:${V1}`);
    expect(posseDe().remarcado.resolvido_em).toBeTruthy();
    expect(r.decisoes.some(d => d.resultado === 'ficha_remarcado_reenviada' && d.motivo === 'enviada')).toBe(true);
    await depoisDe(4);
    expect(h.ficha).toHaveBeenCalledTimes(1);                                   // resolvida: não repete
  });

  it('adiada de novo: retenta com espaço crescente (2, 4, 8, 15 min e a cada 15), passa das 6 tentativas e só morre quando o horário passa', async () => {
    preparar();
    h.teto.mockResolvedValue('teto');
    await rodar(); cardNoHorarioNovo();
    expect(posseDe().remarcado.tentativas).toBe(1);
    await depoisDe(1);                                                          // antes dos 2 min: nada
    expect(posseDe().remarcado.tentativas).toBe(1);
    await depoisDe(2);  expect(posseDe().remarcado.tentativas).toBe(2);        // 2 min depois do nascimento
    await depoisDe(3);  expect(posseDe().remarcado.tentativas).toBe(2);        // 4 min de espera: ainda não
    await depoisDe(5);  expect(posseDe().remarcado.tentativas).toBe(2);
    await depoisDe(6);  expect(posseDe().remarcado.tentativas).toBe(3);        // +4
    await depoisDe(13); expect(posseDe().remarcado.tentativas).toBe(3);
    await depoisDe(14); expect(posseDe().remarcado.tentativas).toBe(4);        // +8
    await depoisDe(28); expect(posseDe().remarcado.tentativas).toBe(4);
    await depoisDe(29); expect(posseDe().remarcado.tentativas).toBe(5);        // +15
    await depoisDe(44); expect(posseDe().remarcado.tentativas).toBe(6);        // +15
    await depoisDe(59); expect(posseDe().remarcado.tentativas).toBe(7);        // passou das 6 de antes e segue
    expect(posseDe().remarcado.resolvido_em).toBeUndefined();
    expect(h.ficha).not.toHaveBeenCalled();
    // com a linha de volta, a próxima tentativa devida manda a ficha
    h.teto.mockResolvedValue('ok');
    await depoisDe(74);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe().remarcado.resolvido_em).toBeTruthy();
  });

  it('adiada o tempo todo: quando o horário do card passa a pendência se resolve sem enviar', async () => {
    preparar();
    h.teto.mockResolvedValue('teto');
    await rodar(); cardNoHorarioNovo();
    const ate = Math.ceil((Date.parse(V1) - AGORA.getTime()) / 60_000);
    for (let m = 30; m < ate; m += 300) await depoisDe(m);                      // passos < 6 h: a posse segue na janela das pendências
    expect(posseDe().remarcado.resolvido_em).toBeUndefined();
    await depoisDe(Math.ceil((Date.parse(V1) - AGORA.getTime()) / 60_000) + 1);
    expect(posseDe().remarcado).toMatchObject({ como: 'horario_passou' });
    expect(h.ficha).not.toHaveBeenCalled();
  });

  it('incerta (timeout): UM reenvio sob chaves :re, porque as mesmas chaves devolveriam ja_avisada', async () => {
    preparar();
    h.ficha.mockRejectedValueOnce(new Error('timeout'));
    await rodar(); cardNoHorarioNovo();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe().remarcado).toMatchObject({ incerta: true });
    await depoisDe(2);
    expect(h.ficha).toHaveBeenCalledTimes(2);
    expect(chavesDoEstado()).toContain(`ficha_card:7:${V1}:re`);
    expect(posseDe().remarcado.resolvido_em).toBeTruthy();
    await depoisDe(4);
    expect(h.ficha).toHaveBeenCalledTimes(2);                                   // nunca um 3º envio
  });

  it('o card mudou de horário antes da retentativa: a pendência se resolve sem enviar', async () => {
    preparar();
    h.teto.mockResolvedValue('teto');
    await rodar();
    h.teto.mockResolvedValue('ok');
    (gerador.tabelas.agendamentos ?? []).find(c => c.id === 7)!.quando = V3;    // outra remarcação mexeu no card
    await depoisDe(2);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().remarcado).toMatchObject({ como: 'card_mudou' });
  });

  it('ficha que saiu na hora não deixa pendência', async () => {
    preparar();
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe().remarcado).toBeUndefined();
  });
});

describe('pendenciaDevida: resolvidas e ainda-sem-vez saem antes do corte das 5 por rodada', () => {
  const T = Date.parse('2026-10-20T15:00:00.000Z');
  const min = (n: number): string => new Date(T - n * 60_000).toISOString();
  const rem = (extra: Record<string, unknown>): any => ({ remarcado: { cardId: 7, de: null, para: '2026-10-21T12:30:00.000Z', wa_id: 10, tentativas: 1, em: min(0), ...extra } });

  it('a espera cresce 2, 4, 8, 15 e fica em 15', () => {
    expect([1, 2, 3, 4, 5, 9].map(esperaDoRemarcadoMs)).toEqual([2, 4, 8, 15, 15, 15].map(m => m * 60_000));
  });
  it('remarcado: em espera sai, devida fica, resolvida sai', () => {
    expect(pendenciaDevida(rem({ em: min(1) }), T)).toBe(false);
    expect(pendenciaDevida(rem({ em: min(2) }), T)).toBe(true);
    expect(pendenciaDevida(rem({ tentativas: 3, ultima_em: min(7) }), T)).toBe(false);
    expect(pendenciaDevida(rem({ tentativas: 3, ultima_em: min(8) }), T)).toBe(true);
    expect(pendenciaDevida(rem({ tentativas: 9, ultima_em: min(15) }), T)).toBe(true);
    expect(pendenciaDevida(rem({ em: min(60), resolvido_em: min(1) }), T)).toBe(false);
  });
  it('volta (15 min) e suporte (10 min): antes da hora ou resolvidos saem; vencida fica para ser fechada', () => {
    expect(pendenciaDevida({ ligar: { avisado_em: min(14) } } as any, T)).toBe(false);
    expect(pendenciaDevida({ ligar: { avisado_em: min(15) } } as any, T)).toBe(true);
    expect(pendenciaDevida({ ligar: { avisado_em: min(300) } } as any, T)).toBe(true);
    expect(pendenciaDevida({ ligar: { avisado_em: min(30), volta_em: min(1) } } as any, T)).toBe(false);
    expect(pendenciaDevida({ ligar: { avisado_em: min(30), resolvido_em: min(1) } } as any, T)).toBe(false);
    expect(pendenciaDevida({ suporte: { avisado_em: min(9) } } as any, T)).toBe(false);
    expect(pendenciaDevida({ suporte: { avisado_em: min(10) } } as any, T)).toBe(true);
    expect(pendenciaDevida({ suporte: { avisado_em: min(30), dono_em: min(1) } } as any, T)).toBe(false);
    expect(pendenciaDevida({} as any, T)).toBe(false);
  });
  it('6 pendências em espera NÃO tomam o lugar de uma devida: depois do filtro a devida é a 1ª', () => {
    const lista = [...Array(6).keys()].map(() => rem({ em: min(1) })).concat([{ suporte: { avisado_em: min(30) } } as any]);
    const devidas = lista.filter(p => pendenciaDevida(p, T));
    expect(devidas).toHaveLength(1);
    expect(devidas.slice(0, 5)[0].suporte).toBeTruthy();
  });
});

describe('correção 9: erro de linha na rodada pula também as pendências', () => {
  it('com erro_linha numa conversa, a volta honesta pendente espera a próxima rodada; sem o erro ela roda', async () => {
    const AVISADO = iso(16 * 60_000);
    const montar = (): void => {
      recomecar();
      (banco.tabelas.wa_mensagens ??= []).push(
        linhaLead(10, TEL, iso(17 * 60_000), { texto: 'Pode ligar' }),
        { id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: BOLHA_LIGAR, momment: iso(15 * 60_000 + 30_000) },
      );
      (banco.tabelas.whatsapp_sessions ??= []).push({
        phone: CHAVE, tipo: 'ag5040', updated_at: AVISADO,
        lead_data: {
          dona: 'duda', estado: 'viva', apresentada: true, desde: iso(20 * 60_000), ate_wa_id: 11, respostas: 1, imagens: [], links: [],
          ligar: { cardId: 99, avisado_em: AVISADO, dono: 'Giovanna', faixa: 'novo', criado: true, status_inicial: 'agendado' },
        },
      });
      (gerador.tabelas.agendamentos ??= []).push({ id: 99, cliente_telefone: TEL, vendedor_nome: 'Giovanna', status: 'agendado' });
      // um 2º lead, com fala nova, que a rodada vai tentar responder
      (banco.tabelas.wa_mensagens ??= []).push(linhaLead(30, telDe(1), iso(2 * 60_000), { texto: 'Quero saber de energia solar' }));
      (banco.tabelas.whatsapp_sessions ??= []).push({
        phone: chaveDe(1), tipo: 'ag5040', updated_at: AGORA.toISOString(),
        lead_data: { dona: 'duda', estado: 'viva', apresentada: true, desde: iso(10 * 60_000), ate_wa_id: null, respostas: 0, imagens: [], links: [] },
      });
      banco.tabelas.system_state = [{ key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)!, hmacDe(chaveDe(1))!], modos: {}, atualizado_em: iso(3600_000) } }];
      h.vagas.mockResolvedValue([V1, V2]);
      ia = modelo([{ bolhas: ['Oi! Qual é o valor médio da sua conta de luz?'], extra: { acao: 'continuar' } }]);
    };
    montar();
    h.enviar.mockResolvedValue({ ok: false, motivo: 'erro_linha', detalhe: 'http_500' });
    const r1 = await rodar();
    expect(r1.parou).toBe('erro_linha');
    expect(r1.pendencias).toBeUndefined();
    expect(h.fila).not.toHaveBeenCalled();
    montar();
    h.enviar.mockResolvedValue({ ok: true, enviadas: 1, carimbos: ['ag5040_sent:30:1'] });
    const r2 = await rodar();
    expect(r2.parou).toBeNull();
    expect(h.fila).toHaveBeenCalledTimes(1);                                    // a volta honesta rodou
    expect(h.fila.mock.calls[0]![0]).toMatchObject({ tipo: 'volta', cardId: 99 });
  });
});

describe('correção 15: lead de número de teste só manda ficha ao celular do DONO', () => {
  const DONO = '34900000000';
  it.each([[true], [null]])('remarcação, ligar agora, suporte e passagem: tudo para o dono (teste = %s)', async teste => {
    // alvo lido e é teste: rótulo de teste. Alvo que não deu para ler (null): rótulo próprio, que não afirma que é teste.
    const rotulo = teste === null ? 'Não consegui conferir se este lead é de teste. Encaminhe à consultora.' : 'Lead de teste';
    // remarcação
    recomecar(); h.teste = teste;
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe(DONO);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('REMARCADO');
    expect(String(h.ficha.mock.calls[0]![1])).toContain(rotulo);
    if (teste === null) expect(String(h.ficha.mock.calls[0]![1])).not.toContain('Lead de teste');
    // ligar agora
    recomecar(); h.teste = teste;
    ia = modelo([{ bolhas: [BOLHA_LIGAR], extra: { acao: 'ligar_agora' } }]);
    semearLead(); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.ficha.mock.calls[0]![0]).toBe(DONO);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('LIGAR AGORA');
    // suporte (nunca à Giovanna)
    recomecar(); h.teste = teste;
    ia = modelo([{ bolhas: ['Entendi. Passei os seus dados para a Giovanna e ela fala com você por aqui mesmo.'], extra: { acao: 'suporte_giovanna', resumo: 'Cliente quer reembolso' } }]);
    semearLead({ texto: 'Sou cliente e quero o reembolso' }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.ficha.mock.calls[0]![0]).toBe(DONO);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('SUPORTE');
    // passagem ao humano (com card da Nilce)
    recomecar(); h.teste = teste;
    semearLead({ texto: 'Quero saber de energia solar', card: {} }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: [], extra: { acao: 'passar_helena' } }]);
    await rodar();
    expect(h.ficha.mock.calls[0]![0]).toBe(DONO);
    expect(String(h.ficha.mock.calls[0]![1])).toContain(rotulo);
    if (teste === null) expect(String(h.ficha.mock.calls[0]![1])).not.toContain('Lead de teste');
  });

  it('lead que NÃO é de teste segue para a consultora (controle positivo)', async () => {
    h.teste = false;
    semearLead({ card: {} }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');
  });
});
