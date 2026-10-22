import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A ação `estacionar` da Duda e da Helena na rodada viva (B4b): o PRÓPRIO lead disse que agora não dá, ou pediu para
// chamar numa data. Mesma montagem dos testes da Helena (banco falso, IA falsa, saídas trocadas por mocks que contam
// chamadas). Nada alcança a rede.
const h = vi.hoisted(() => {
  // A instância da linha IO é lida na CARGA do eletropostoRespostas: tem de estar no ambiente antes do import.
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  return {
    principal: null as any,
    gerador: null as any,
    enviar: vi.fn(),
    ficha: vi.fn(),
    teto: vi.fn(),
    vagas: vi.fn(),
    livre: vi.fn(),
    gravarCard: vi.fn(),
    aviso: vi.fn(),
    aoLead: vi.fn(),
    transcrever: vi.fn(),
    cooldown: false,
    teste: false as boolean | null,
  };
});
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
    mapa: new Map([['giovanna', '34993396255'], ['thiago', '34991360223'], ['diego', '34991360172']]),
  }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: (e: any) => /em cooldown|credenciais Z-API ausentes/i.test(String(e?.message ?? e)),
  linhaIoEmCooldown: () => h.cooldown,
  leadEhDeTeste: async () => h.teste,
  telefoneDoConsultor: (m: Map<string, string>, n: string) => m.get(String(n ?? '').trim().toLowerCase().split(' ')[0]!) ?? null,
  telefoneDoDono: () => '34900000000',
  tetoDaLinhaPermiteFicha: (...a: unknown[]) => h.teto(...a),
}));
vi.mock('../services/agentes5040/agendaEnvio', () => ({
  enfileirarAgenda: async () => ({ ok: true, chave: 'ag5040_agenda_fila:0:confirma' }),
  bolhaDeConfirmacao: () => null,
}));
vi.mock('../services/agentes5040/agendaSolar', () => ({
  gravarCardSolar: vi.fn(), remarcarCardSolar: vi.fn(), marcarBoasVindasEnviada: vi.fn(), silenciarLembretesDoCard: vi.fn(),
  reservarBoasVindas: vi.fn(), devolverBoasVindas: vi.fn(),
}));
vi.mock('../services/agentes5040/agendaSolarVagas', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/agendaSolarVagas')>()),
  vagasSolar: async () => [],
}));
vi.mock('../services/io/eletropostoVagas', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoVagas')>()),
  proximasVagas: (...a: unknown[]) => h.vagas(...a),
  aindaLivre: (...a: unknown[]) => h.livre(...a),
}));
vi.mock('../services/io/eletropostoCard', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoCard')>()),
  gravarCardEletroposto: (...a: unknown[]) => h.gravarCard(...a),
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: async (...a: unknown[]) => h.aviso(...a),
  sendHuman: async (...a: unknown[]) => h.aoLead(...a),
  linhaEmCooldown: () => false,
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/lineThrottle')>()),
  dentroDoTetoHorarioLinha: async () => true,
}));
vi.mock('../utils/mediaProcessor', () => ({
  transcribeAudio: (...a: unknown[]) => h.transcrever(...a),
  downloadImageAsAnthropicSource: async () => null,
  downloadPdfAsAnthropicSource: async () => null,
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223', diego: '34991360172' } }));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { ACOES_DUDA } from '../services/agentes5040/personas/duda';
import { ACOES_HELENA } from '../services/agentes5040/personas/helena';
import { ACOES_CARLA } from '../services/agentes5040/personas/carla';
import { ACAO_ESTACIONAR } from '../services/agentes5040/tipos';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);
const DESDE_POSSE = iso(10 * 60_000);
const V1 = '2026-10-21T12:30:00.000Z';

const TEL = '5534991101000';
const CHAVE = `34${TEL.slice(-8)}`;

let banco: BancoFalso;
let gerador: BancoFalso;

function semear(dona: 'duda' | 'helena', texto: string) {
  (banco.tabelas.wa_mensagens ??= []).push({
    id: 10, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto, momment: MOMENTO_LEAD,
  });
  (banco.tabelas.whatsapp_sessions ??= []).push({
    phone: CHAVE, tipo: 'ag5040', updated_at: AGORA.toISOString(),
    lead_data: { dona, estado: 'viva', desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [] },
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
const suprimidos = (): unknown[] => banco.tabelas.whatsapp_suppression ?? [];

const BOLHA_OK = 'Tudo bem, sem pressa. Quando for melhor pra você, é só me chamar aqui.';
function modelo(respostas: Array<{ bolhas: string[]; extra?: Record<string, unknown> }>) {
  return iaFalsa((_body, n) => {
    const x = respostas[Math.min(n, respostas.length) - 1]!;
    return respostaIA(saidaJson(x.bolhas, x.extra ?? {}), { cache_creation_input_tokens: 100 });
  });
}
const estacionar = (volta?: string, bolhas = [BOLHA_OK]) => ({
  bolhas, extra: { acao: 'estacionar', ...(volta !== undefined ? { dados: [{ chave: 'volta_em', valor: volta }] } : {}) },
});
let ia = modelo([estacionar()]);
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.cooldown = false; h.teste = false;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry ? { ok: false, motivo: 'dry' } : { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  h.teto.mockReset().mockResolvedValue('ok');
  h.vagas.mockReset().mockResolvedValue([V1]);
  h.livre.mockReset().mockResolvedValue(true);
  h.aviso.mockReset().mockResolvedValue(undefined);
  h.aoLead.mockReset().mockResolvedValue(undefined);
  h.transcrever.mockReset().mockResolvedValue(null);
  h.gravarCard.mockReset().mockResolvedValue({ id: 500, bloqueado: false });
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  process.env.AGENTES5040_HELENA_VIVO = '1';
  delete process.env.AGENTES5040_CARLA_VIVO;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  delete process.env.EP_RESPOSTAS_OFF; delete process.env.EP_REMARCAR_OFF;
  process.env.FICHA_5040_IA_OFF = '1';
  zerarCacheArmazem(); zerarCacheInterruptores();
  ia = modelo([estacionar()]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.FICHA_5040_IA_OFF;
  (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0;
});

describe('estacionar: a ação existe só na Duda e na Helena', () => {
  it('as duas personas aceitam a ação e a Carla não', () => {
    expect(ACOES_DUDA as readonly string[]).toContain(ACAO_ESTACIONAR);
    expect(ACOES_HELENA as readonly string[]).toContain(ACAO_ESTACIONAR);
    expect(ACOES_CARLA as readonly string[]).not.toContain(ACAO_ESTACIONAR);
  });
});

describe('estacionar: a Duda, com data dita pelo lead', () => {
  it('grava lead_data.base ANTES da bolha (data às 9h de Brasília, só o código do motivo) e a bolha sai', async () => {
    semear('duda', 'Agora não consigo, me chama dia 10 de novembro');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('10/11')]);
    let baseNaHoraDoEnvio: any = null;
    h.enviar.mockImplementation(async (p: any) => { baseNaHoraDoEnvio = posseDe().base ?? null; return { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }; });
    await rodar();
    expect(baseNaHoraDoEnvio).toMatchObject({ estacionado_ate: '2026-11-10T12:00:00.000Z', estacionado_motivo: 'data_dita', ultima: false });
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_OK);
    expect(h.enviar.mock.calls[0]![0].peca).toBeUndefined();
    expect(posseDe()).toMatchObject({ estado: 'viva', respostas: 1, ate_wa_id: 10 });
    expect(JSON.stringify(posseDe().base)).not.toMatch(/novembro|34991101000/);          // nada do que ele disse, nada de telefone
    expect(suprimidos()).toHaveLength(0);
  });

  it('o formato AAAA-MM-DD também vale, e a data guardada junta com o que já havia em base (retomadas não some)', async () => {
    semear('duda', 'Pode me chamar no dia 3 de dezembro');
    alvo([hmacDe(CHAVE)!]);
    (banco.tabelas.whatsapp_sessions![0]!.lead_data as any).base = { retomadas: 1, ultima_retomada_em: iso(86_400_000) };
    ia = modelo([estacionar('2026-12-03')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ retomadas: 1, estacionado_ate: '2026-12-03T12:00:00.000Z', ultima: false });
  });

  it('data que o modelo escreveu mas o lead NÃO disse cai no prazo fixo de 30 dias e vira a última retomada', async () => {
    semear('duda', 'Agora não dá, depois eu vejo isso');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('10/11')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2026-11-19T12:00:00.000Z', estacionado_motivo: 'agora_nao', ultima: true });
  });

  for (const volta of ['31/02', 'novembro', '19/10/2026']) {
    it(`data torta ou no passado (${volta}), mesmo com o lead dizendo "dia 10", cai no prazo fixo`, async () => {
      semear('duda', 'Me chama dia 10');
      alvo([hmacDe(CHAVE)!]);
      ia = modelo([estacionar(volta)]);
      await rodar();
      expect(posseDe().base).toMatchObject({ estacionado_ate: '2026-11-19T12:00:00.000Z', ultima: true });
    });
  }
});

describe('estacionar: data sem ano e data longe demais', () => {
  it('DD/MM que já passou neste ano é do ano seguinte ("me chama em janeiro" dito em 20/10)', async () => {
    semear('duda', 'Me chama em janeiro, dia 15');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('15/01')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2027-01-15T12:00:00.000Z', estacionado_motivo: 'data_dita', ultima: false });
  });
  it('data acima de 180 dias é limitada a 180 dias (o dia 18/04/2027 é domingo: segunda 19/04), nunca o prazo fixo de 30', async () => {
    semear('duda', 'Me chama só no ano que vem, em dezembro');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('2027-12-01')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2027-04-19T12:00:00.000Z', estacionado_motivo: 'data_dita', ultima: false });
  });
  it('data em feriado nacional vai para o próximo dia útil (15/11/2026, domingo e feriado: segunda 16/11)', async () => {
    semear('duda', 'Me chama dia 15 de novembro');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('15/11')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2026-11-16T12:00:00.000Z' });
  });
});

describe('estacionar: o lead escreve de novo depois de estacionar', () => {
  const FUTURO = '2026-11-10T12:00:00.000Z';
  const BOLHA_NORMAL = 'Que bom que voltou. Me conta mais sobre o que você precisa?';
  const estacionada = (extra: Record<string, unknown> = {}) => {
    (banco.tabelas.whatsapp_sessions![0]!.lead_data as any).base = {
      retomadas: 1, ultima_retomada_em: iso(86_400_000), estacionado_ate: FUTURO, estacionado_motivo: 'data_dita', ultima: true, ...extra,
    };
  };

  it('fala nova com estacionado_ate no futuro: zera o estacionado e guarda o resto de base (retomadas segue)', async () => {
    semear('duda', 'Voltei, pode me explicar melhor?');
    alvo([hmacDe(CHAVE)!]);
    estacionada();
    ia = modelo([{ bolhas: [BOLHA_NORMAL] }]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: null, estacionado_motivo: null, ultima: false, retomadas: 1 });
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('a Helena também', async () => {
    semear('helena', 'Voltei, pode me explicar melhor?');
    alvo([hmacDe(CHAVE)!]);
    estacionada();
    ia = modelo([{ bolhas: [BOLHA_NORMAL] }]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: null });
  });

  it('se ele pede de novo para esperar, a ação estacionar grava a nova data por cima', async () => {
    semear('duda', 'Ainda não deu, me chama dia 3 de dezembro');
    alvo([hmacDe(CHAVE)!]);
    estacionada();
    ia = modelo([estacionar('03/12')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2026-12-03T12:00:00.000Z', ultima: false, retomadas: 1 });
  });

  it('o dry não grava; estacionado já vencido ou ausente também não mexe', async () => {
    semear('duda', 'Voltei');
    alvo([hmacDe(CHAVE)!]);
    estacionada();
    ia = modelo([{ bolhas: [BOLHA_NORMAL] }]);
    await rodar({ dry: true });
    expect(posseDe().base).toMatchObject({ estacionado_ate: FUTURO, ultima: true });
    estacionada({ estacionado_ate: iso(3_600_000) });
    await rodar();
    expect(posseDe().base.estacionado_ate).toBe(iso(3_600_000));
  });
});

describe('estacionar: "agora não" sem data', () => {
  it('prazo fixo de 30 dias (9h de Brasília) e marca que a retomada do dia é a última', async () => {
    semear('duda', 'Agora não dá, mais pra frente a gente conversa');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar()]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2026-11-19T12:00:00.000Z', estacionado_motivo: 'agora_nao', ultima: true });
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('a bolha recusada pelo envio (teto) NÃO desfaz o estacionado: ele só reduz envio', async () => {
    semear('duda', 'Agora não dá');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar()]);
    h.enviar.mockImplementation(async () => ({ ok: false, motivo: 'teto_linha', detalhe: 'hora:60' }));
    await rodar();
    expect(posseDe().base).toMatchObject({ ultima: true });
  });
});

describe('estacionar: pedido de parar NUNCA estaciona (é opt-out)', () => {
  const DESPEDIDA = 'Tudo bem, não te chamo mais. Obrigada pela atenção.';

  it('o modelo erra e usa estacionar: nova chamada com o aviso, e a segunda vez é nao_incomodar (despedida, silêncio, nada de base)', async () => {
    semear('duda', 'Não quero mais, para de me chamar');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('10/11'), { bolhas: [DESPEDIDA], extra: { acao: 'nao_incomodar' } }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(JSON.stringify(ia.chamadas[1]!.body.messages)).toContain('Isso NÃO é estacionar');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(DESPEDIDA);
    expect(suprimidos()).toEqual([expect.objectContaining({ phone: TEL, motivo: 'opt_out' })]);
    expect(posseDe()).toMatchObject({ estado: 'nao_incomodar' });
    expect(posseDe().base).toBeUndefined();
  });

  it('o modelo insiste em estacionar: ninguém recebe bolha, o número é silenciado e a posse fecha em nao_incomodar', async () => {
    semear('duda', 'Não me chama mais');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('10/11')]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(suprimidos()).toEqual([expect.objectContaining({ phone: TEL, motivo: 'opt_out' })]);
    expect(posseDe()).toMatchObject({ estado: 'nao_incomodar', ate_wa_id: 10 });
    expect(posseDe().base).toBeUndefined();
  });

  it('o dry não silencia nem grava', async () => {
    semear('duda', 'Para de me mandar mensagem');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('10/11')]);
    await rodar({ dry: true });
    expect(suprimidos()).toHaveLength(0);
    expect(posseDe()).toMatchObject({ estado: 'viva' });
    expect(posseDe().base).toBeUndefined();
  });
});

describe('estacionar: a Helena (sem card de eletroposto)', () => {
  it('com data dita: grava a base e a bolha sai', async () => {
    semear('helena', 'Agora não, me chama em novembro, dia 3');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('03/11')]);
    await rodar();
    expect(posseDe().base).toMatchObject({ estacionado_ate: '2026-11-03T12:00:00.000Z', estacionado_motivo: 'data_dita', ultima: false });
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].dona).toBe('helena');
  });

  it('a bolha da Helena que pede SIM não sai nem com estacionar (a regra de violação vale também para esta ação)', async () => {
    semear('helena', 'Agora não dá');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar(undefined, ['Tudo bem. Quando puder, responda SIM para confirmar a sua presença.'])]);
    await rodar();
    expect(ia.chamadas.length).toBeGreaterThanOrEqual(2);
    expect(h.enviar.mock.calls.every(c => !/SIM/.test(String(c[0].bolha)))).toBe(true);
  });

  it('opt-out vale para a Helena também', async () => {
    semear('helena', 'Não quero, obrigado');
    alvo([hmacDe(CHAVE)!]);
    ia = modelo([estacionar('03/11')]);
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(suprimidos()).toHaveLength(1);
    expect(posseDe().base).toBeUndefined();
  });
});
