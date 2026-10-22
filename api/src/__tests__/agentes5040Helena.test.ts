import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A Helena do eletroposto na rodada viva (B2). Banco falso em memória (o principal e o do gerador), IA falsa e as saídas
// trocadas por mocks que contam chamadas: vivoEnvio (a bolha ao lead), fichaEnvio (a ficha ao consultor) e o zapiClient (o que
// os robôs DO ELETROPOSTO falam). Os robôs do eletroposto rodam de verdade (eletropostoRespostas e eletropostoRemarcar):
// a regra de ouro é que nenhum muda, e o teste invertido prova que a posse da Helena não calou nenhum.
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
// A agenda do eletroposto: as vagas e a conferência final são nossas; o resto do módulo é o de verdade.
vi.mock('../services/io/eletropostoVagas', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoVagas')>()),
  proximasVagas: (...a: unknown[]) => h.vagas(...a),
  aindaLivre: (...a: unknown[]) => h.livre(...a),
}));
vi.mock('../services/io/eletropostoCard', async (orig) => ({
  ...(await orig<typeof import('../services/io/eletropostoCard')>()),
  gravarCardEletroposto: (...a: unknown[]) => h.gravarCard(...a),
}));
// O que os robôs do eletroposto falam: aviso à equipe (sendWhatsApp) e conversa de remarcação com o lead (sendHuman).
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
import { BOLHA_PASSAGEM_AGENDA_EP, BOLHA_PASSAGEM_GENERICA_EP, runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import {
  PREFIXOS_EP, PREFIXO_PRESENCA, acharVagaEp, bolhaCardCriado, bolhaPresencaAnotada, bolhaSemDetalhe, coberturaDoEpRespostas, ehSoFecho,
  JANELA_FECHO_SIM_MS, violacaoDaBolha, type CardEp,
} from '../services/agentes5040/helenaEp';
import { runEletropostoRespostasTick } from '../services/io/eletropostoRespostas';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number, base: Date = AGORA): string => new Date(base.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);
const DESDE_POSSE = iso(10 * 60_000);
const MIN = 60_000;
const V1 = '2026-10-21T12:30:00.000Z';                                      // quarta, 9h30 em Brasília
const V2 = '2026-10-21T17:30:00.000Z';                                      // 14h30
const V3 = '2026-10-22T12:30:00.000Z';
const V4 = '2026-10-22T17:30:00.000Z';
const TXT1 = 'amanhã, quarta, 21/10, às 9h30';
const QUANDO_CARD = '2026-10-22T13:30:00.000Z';                             // quinta, 10h30 em Brasília

const telDe = (i: number): string => `55349911${String(1000 + i).padStart(5, '0')}`;
const chaveDe = (i: number): string => `34${telDe(i).slice(-8)}`;
const TEL = telDe(0);
const CHAVE = chaveDe(0);

let banco: BancoFalso;
let gerador: BancoFalso;

const linhaLead = (id: number, tel: string, momento: string, texto: string, extra: Record<string, unknown> = {}) =>
  ({ id, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto, momment: momento, ...extra });

function card(extra: Record<string, unknown> = {}) {
  return {
    id: 7, cliente_telefone: TEL, cliente_nome: 'Roberto Lima', vendedor_nome: 'Thiago', status: 'agendado', created_by: 'lp_eletroposto',
    created_at: iso(86_400_000), quando: QUANDO_CARD, cidade: 'Araguari', observacao: null,
    confirmacao_at: iso(3 * 3_600_000), lembrete_1h_at: null, lembrete_5min_at: null, presenca_confirmada_at: null, ...extra,
  };
}

/** A conversa da Helena: a fala do lead, a posse viva dela e (opcional) o card de eletroposto. */
function semear(opts: { texto?: string; momento?: string; posse?: Record<string, unknown>; card?: Record<string, unknown> | null; cards?: Array<Record<string, unknown>> } = {}) {
  (banco.tabelas.wa_mensagens ??= []).push(linhaLead(10, TEL, opts.momento ?? MOMENTO_LEAD, opts.texto ?? 'Oi, vi o anúncio do eletroposto'));
  (banco.tabelas.whatsapp_sessions ??= []).push({
    phone: CHAVE, tipo: 'ag5040', updated_at: AGORA.toISOString(),
    lead_data: { dona: 'helena', estado: 'viva', apresentada: true, desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [], ...(opts.posse ?? {}) },
  });
  const lista = opts.cards ?? (opts.card === null ? [] : [card(opts.card ?? {})]);
  (gerador.tabelas.agendamentos ??= []).push(...lista);
}

/** O marcador do ep_respostas: até onde ele já leu (value.ate). */
function marcador(id: number, ate: string) {
  (banco.tabelas.system_state ??= []).push({ key: `${PREFIXOS_EP.resposta}${id}`, value: { ate, avisado_em: ate }, updated_at: ate });
}
const estadoSemear = (key: string, value: Record<string, unknown>, updated_at = AGORA.toISOString()) =>
  (banco.tabelas.system_state ??= []).push({ key, value, updated_at });

function alvo(hmacs: string[]) {
  banco.tabelas.system_state = [
    ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs, modos: {}, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

const posseDe = () => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data as Record<string, any>;
const chavesDoEstado = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);
const cardsDoGerador = () => (gerador.tabelas.agendamentos ?? []);

const FALA_HELENA = 'Oi! Aqui é a Helena, da Irmãos na Obra. O ponto que você pensa para o eletroposto fica em qual cidade?';
function modelo(respostas: Array<{ bolhas: string[]; extra?: Record<string, unknown> }>) {
  return iaFalsa((_body, n) => {
    const x = respostas[Math.min(n, respostas.length) - 1]!;
    return respostaIA(saidaJson(x.bolhas, x.extra ?? {}), { cache_creation_input_tokens: 100 });
  });
}
let ia = modelo([{ bolhas: [FALA_HELENA] }]);
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });
const pedidoDaChamada = (n: number): string => JSON.stringify(ia.chamadas[n]!.body.messages);

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.cooldown = false; h.teste = false;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry ? { ok: false, motivo: 'dry' } : { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  h.teto.mockReset().mockResolvedValue('ok');
  h.vagas.mockReset().mockResolvedValue([V1, V2, V3, V4]);
  h.livre.mockReset().mockResolvedValue(true);
  h.aviso.mockReset().mockResolvedValue(undefined);
  h.aoLead.mockReset().mockResolvedValue(undefined);
  h.transcrever.mockReset().mockResolvedValue(null);
  // O banco falso não devolve o id do insert: o gravador falso escreve o card na agenda falsa e devolve o id.
  h.gravarCard.mockReset().mockImplementation(async (ficha: any) => {
    const id = 500 + (gerador.tabelas.agendamentos ?? []).length;
    (gerador.tabelas.agendamentos ??= []).push({ id, created_at: AGORA.toISOString(), ...ficha });
    return { id, bloqueado: false };
  });
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_HELENA_VIVO = '1';
  delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  delete process.env.EP_RESPOSTAS_OFF; delete process.env.EP_REMARCAR_OFF;
  process.env.FICHA_5040_IA_OFF = '1';
  zerarCacheArmazem(); zerarCacheInterruptores();
  ia = modelo([{ bolhas: [FALA_HELENA] }]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  // Em NENHUM teste a Helena nova grava a sessão da Helena antiga: inv_agente:<chave> tiraria a conversa do ep_respostas.
  expect(chavesDoEstado().filter(k => k.startsWith('inv_agente:'))).toEqual([]);
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.FICHA_5040_IA_OFF;
  (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0;
});

// ── as peças puras ───────────────────────────────────────────────────────────

describe('os prefixos dos robôs do eletroposto são os deles', () => {
  const fonte = (arq: string): string => readFileSync(join(__dirname, '..', 'services', 'io', `${arq}.ts`), 'utf8');
  const constante = (arq: string, nome: string): string => {
    const m = new RegExp(`export const ${nome} = '([^']+)'`).exec(fonte(arq));
    expect(m, `${nome} em ${arq}`).not.toBeNull();
    return m![1]!;
  };
  it('cada prefixo copiado em helenaEp.ts é igual ao export do arquivo do robô', () => {
    expect(PREFIXOS_EP.resposta).toBe(constante('eletropostoAgenda', 'EP_RESPOSTA_PREFIX'));
    expect(PREFIXOS_EP.remarcar).toBe(constante('eletropostoRemarcar', 'EP_REMARCAR_PREFIX'));
    expect(PREFIXOS_EP.remarcarEnviado).toBe(constante('eletropostoRemarcar', 'EP_REMARCAR_SENT'));
    expect(PREFIXOS_EP.ofertaFria).toBe(constante('eletropostoRemarcar', 'EP_OFERTA_FRIA_SENT'));
    expect(PREFIXOS_EP.liberadoSim).toBe(constante('eletropostoCobraSim', 'EP_LIBERADO_PREFIX'));
    expect(PREFIXOS_EP.mudo).toBe(constante('eletropostoReagendaAuto', 'EP_MUDO_PREFIX'));
  });
});

describe('as peças puras da Helena', () => {
  it('a bolha nunca pede SIM, nunca promete lembrete e só diz "confirmado" com a prova', () => {
    expect(violacaoDaBolha('Você confirma sua presença respondendo SIM?', false)).toBe('pede_sim');
    expect(violacaoDaBolha('Pode me mandar um sim por aqui?', false)).toBe('pede_sim');
    expect(violacaoDaBolha('Sim, o Thiago atende em Araguari.', false)).toBeNull();
    expect(violacaoDaBolha('Vou te lembrar na véspera.', false)).toBe('promete_lembrete');
    expect(violacaoDaBolha('Te mando um lembrete antes.', false)).toBe('promete_lembrete');
    expect(violacaoDaBolha('Confirmado, Roberto.', false)).toBe('diz_confirmado');
    expect(violacaoDaBolha('Confirmado, Roberto.', true)).toBeNull();
    expect(violacaoDaBolha('Confirmado. Responde SIM?', true)).toBe('pede_sim');
  });

  it('pedido de confirmação SEM a palavra sim também é barrado', () => {
    for (const ruim of ['Você confirma sua presença?', 'Pode confirmar a presença amanhã?', 'Confirme presença por aqui, por favor.']) {
      expect(violacaoDaBolha(ruim, false), ruim).toBe('pede_sim');
      expect(violacaoDaBolha(ruim, true), ruim).toBe('pede_sim');
    }
    expect(violacaoDaBolha('Sua presença ficou anotada e está tudo certo.', true)).toBeNull();
    expect(violacaoDaBolha('É só responder que sim na mensagem de confirmação da reunião.', false)).toBeNull();
    expect(violacaoDaBolha('Isso, é só responder que sim nela.', false)).toBeNull();
  });

  it('as bolhas fixas são as aprovadas pelo redator', () => {
    expect(bolhaCardCriado('Roberto Lima')).toBe('Pronto, Roberto, deixei a sua reunião marcada. Os detalhes vão na mensagem de confirmação, aqui no mesmo WhatsApp.');
    expect(bolhaCardCriado(null)).toBe('Pronto, deixei a sua reunião marcada. Os detalhes vão na mensagem de confirmação, aqui no mesmo WhatsApp.');
    expect(bolhaPresencaAnotada('Roberto Lima')).toBe('Obrigada, Roberto. Sua presença ficou anotada e está tudo certo.');
    expect(bolhaPresencaAnotada(null)).toBe('Obrigada. Sua presença ficou anotada e está tudo certo.');
    expect(BOLHA_PASSAGEM_GENERICA_EP).toBe('Vou passar a conversa pro consultor. Já mandei tudo o que a gente falou, e ele te responde por aqui em breve.');
    expect(BOLHA_PASSAGEM_AGENDA_EP).toBe('Pra acertar o horário, o consultor fala com você. Já mandei a conversa pra ele, e ele te chama por aqui em breve.');
    for (const t of [bolhaCardCriado('Ana'), bolhaPresencaAnotada('Ana'), BOLHA_PASSAGEM_GENERICA_EP, BOLHA_PASSAGEM_AGENDA_EP]) {
      expect(t.length).toBeLessThanOrEqual(160);
      expect(violacaoDaBolha(t, true)).toBeNull();
    }
    expect(violacaoDaBolha(bolhaCardCriado('Ana'), false)).toBeNull();
  });

  it('a bolha logo depois do card não repete dia, hora, consultor, "confirmado", SIM nem lembrete', () => {
    expect(bolhaSemDetalhe(bolhaCardCriado('Roberto Lima'))).toBe(true);
    expect(bolhaSemDetalhe(bolhaCardCriado(null))).toBe(true);
    expect(bolhaCardCriado('Roberto Lima').length).toBeLessThanOrEqual(160);
    expect(bolhaPresencaAnotada('Roberto Lima').length).toBeLessThanOrEqual(160);
    for (const ruim of [
      'Marcado com o Thiago.', 'Marcado para quarta.', 'Marcado às 9h30.', 'Marcado amanhã.', 'Combinado, dia 21/10.',
      'Confirmado!', 'Responde SIM?', 'Te mando um lembrete.', '',
    ]) expect(bolhaSemDetalhe(ruim), ruim).toBe(false);
    for (const t of [bolhaCardCriado('Ana'), bolhaPresencaAnotada('Ana')]) {
      expect(t).not.toMatch(/[—–]/);
      expect(t[0]).toBe(t[0]!.toUpperCase());
    }
  });

  it('fecho depois do SIM: obrigado, ok e emoji; pergunta não é fecho', () => {
    for (const t of ['Obrigado!', 'ok', 'Valeu 👍', '👍', 'Muito obrigada', 'Sim', 'Beleza, obrigado']) expect(ehSoFecho([t]), t).toBe(true);
    for (const t of ['Obrigado, mas quanto custa?', 'E a obra, quem faz?', '']) expect(ehSoFecho([t]), t).toBe(false);
  });

  it('"sim" e "isso" só são fecho na janela de 30 minutos; "obrigado", "ok" e emoji seguem fecho', () => {
    for (const t of ['Sim', 'Isso', 'Sim, obrigado', 'Isso mesmo']) expect(ehSoFecho([t], false), t).toBe(false);
    for (const t of ['Obrigado!', 'ok', 'Valeu 👍', '👍', 'Beleza, obrigado']) expect(ehSoFecho([t], false), t).toBe(true);
    for (const t of ['Sim', 'Isso']) expect(ehSoFecho([t], true), t).toBe(true);
    expect(JANELA_FECHO_SIM_MS).toBe(30 * 60_000);
  });

  it('o horário nomeado é casado com a lista: o texto inteiro, ou uma frase que o contém (uma vaga só)', () => {
    const agora = AGORA.toISOString();
    expect(acharVagaEp(TXT1, [V1, V2], agora)).toBe(V1);
    expect(acharVagaEp(`${TXT1}, com o Thiago`, [V1, V2], agora)).toBe(V1);
    expect(acharVagaEp('amanhã às 9h30', [V1, V2], agora)).toBeNull();
    expect(acharVagaEp(undefined, [V1], agora)).toBeNull();
  });
});

describe('a cobertura do ep_respostas é a dele (cada caso contra o tick de verdade)', () => {
  const casos: Array<[string, Record<string, unknown>, boolean]> = [
    ['agendado com confirmação', {}, true],
    ['nao_atendeu', { status: 'nao_atendeu' }, true],
    ['sem nenhum toque da automação', { confirmacao_at: null }, false],
    ['só o lembrete de 1h conta como toque', { confirmacao_at: null, lembrete_1h_at: iso(3 * 3_600_000) }, true],
    ['cancelado por gente (sem a marca da régua do SIM)', { status: 'cancelado' }, false],
    ['em negociação', { status: 'em_negociacao' }, false],
    ['reunião de mais de 5 dias atrás', { quando: iso(6 * 86_400_000) }, false],
    ['reunião de 4 dias atrás ainda conta', { quando: iso(4 * 86_400_000) }, true],
    ['origem do lote nunca entra no caminho com efeito', { created_by: 'cadastro_eletroposto' }, false],
    ['origem que não é de eletroposto', { created_by: 'lp_solar' }, false],
  ];
  for (const [nome, extra, esperado] of casos) {
    it(`${nome}: ${esperado ? 'coberto' : 'fora'}`, async () => {
      const c = card(extra);
      (gerador.tabelas.agendamentos ??= []).push(c);
      (banco.tabelas.wa_mensagens ??= []).push(linhaLead(10, TEL, MOMENTO_LEAD, 'Sim'));
      const previsto = coberturaDoEpRespostas(c as unknown as CardEp, { agoraMs: AGORA.getTime(), falaMs: Date.parse(MOMENTO_LEAD), liberados: new Set() });
      expect(previsto).toBe(esperado);
      // ep_respostas de verdade (o de lote só avisa, mas também grava o marcador: o tratamento do lote é à parte)
      await runEletropostoRespostasTick();
      const gravou = chavesDoEstado().includes(`${PREFIXOS_EP.resposta}7`);
      if (c.created_by === 'cadastro_eletroposto') expect(gravou).toBe(true);
      else expect(gravou).toBe(esperado);
    });
  }

  it('cancelado só é coberto se a régua do SIM liberou o horário (marca ep_liberado_sim)', async () => {
    const c = card({ status: 'cancelado' });
    (gerador.tabelas.agendamentos ??= []).push(c);
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(10, TEL, MOMENTO_LEAD, 'Sim'));
    estadoSemear(`${PREFIXOS_EP.liberadoSim}7`, { em: iso(3600_000) });
    const previsto = coberturaDoEpRespostas(c as unknown as CardEp, { agoraMs: AGORA.getTime(), falaMs: Date.parse(MOMENTO_LEAD), liberados: new Set([7]) });
    expect(previsto).toBe(true);
    await runEletropostoRespostasTick();
    expect(chavesDoEstado()).toContain(`${PREFIXOS_EP.resposta}7`);
  });

  it('fala ANTES do primeiro toque da automação não é coberta', async () => {
    const c = card({ confirmacao_at: iso(MIN) });
    (gerador.tabelas.agendamentos ??= []).push(c);
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(10, TEL, iso(5 * MIN), 'Sim'));
    expect(coberturaDoEpRespostas(c as unknown as CardEp, { agoraMs: AGORA.getTime(), falaMs: Date.parse(iso(5 * MIN)), liberados: new Set() })).toBe(false);
    await runEletropostoRespostasTick();
    expect(chavesDoEstado()).not.toContain(`${PREFIXOS_EP.resposta}7`);
  });
});

// ── as regras antes da IA ────────────────────────────────────────────────────

describe('quando a Helena cala (a IA nem é chamada, nada sai, a fala vira lida)', () => {
  const calou = async (motivo: string) => {
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'viva', ate_wa_id: 10, respostas: 0 });
    expect(r.puladas[`helena_cala_${motivo}`]).toBe(1);
    expect(cardsDoGerador().filter(c => c.created_by === 'agente_eletroposto')).toHaveLength(0);
    return r;
  };

  it('card do lote (cadastro_eletroposto): o consultor responde', async () => {
    semear({ card: { created_by: 'cadastro_eletroposto' }, texto: 'Oi, quem é?' }); alvo([hmacDe(CHAVE)!]);
    await calou('card_do_lote');
  });

  it('ficha ep_mudo do horário atual do card', async () => {
    semear({ texto: 'Bom dia' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.mudo}7`, { quando: QUANDO_CARD, em: iso(3600_000), por: 'Thiago' });
    await calou('ep_mudo');
  });

  it('ep_mudo de OUTRO horário (a marca vale só para um) não cala', async () => {
    semear({ texto: 'Bom dia' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.mudo}7`, { quando: '2026-10-25T13:30:00.000Z', em: iso(3600_000), por: 'Thiago' });
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
  });

  for (const [texto, rotulo] of [
    ['Preciso remarcar a reunião', 'remarcar'], ['Quero cancelar', 'cancelar'], ['Não vou poder participar', 'não vou poder'],
    ['Trava o horário pra mim', 'querODeVolta'], ['Vamos deixar pra amanhã', 'deixar pra amanhã'],
  ] as const) {
    it(`"${texto}" (${rotulo}) com card que o ep_respostas cobre: é do robô de remarcação e da equipe`, async () => {
      semear({ texto }); alvo([hmacDe(CHAVE)!]);
      await calou('remarcacao_do_robo');
    });
  }

  it('oferta de remarcação aberta (menos de 24 h): cala, seja a escolha ("2") ou outra coisa', async () => {
    semear({ texto: '2' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.remarcar}7`, { ofertas: [V1, V2, V3], em: iso(3 * 3_600_000), rodada: 1, de: QUANDO_CARD });
    await calou('escolha_de_horario');
  });

  it('oferta aberta e a fala é outra coisa: cala do mesmo jeito', async () => {
    semear({ texto: 'Antes disso, quem é o dono da empresa?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.remarcar}7`, { ofertas: [V1, V2, V3], em: iso(3 * 3_600_000), rodada: 1, de: QUANDO_CARD });
    await calou('oferta_aberta');
  });

  it('oferta de mais de 24 h não vale: a Helena segue', async () => {
    semear({ texto: 'Quem é o dono da empresa?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.remarcar}7`, { ofertas: [V1, V2, V3], em: iso(30 * 3_600_000), rodada: 1, de: QUANDO_CARD });
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
  });

  it('um robô da remarcação já falou depois da fala (carimbo novo, a bolha ainda nem está em wa_mensagens)', async () => {
    semear({ texto: 'Pode ser às nove da manhã?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.remarcarEnviado}7:oferta`, { em: iso(MIN) }, iso(MIN));
    await calou('robo_falou');
  });

  it('um carimbo de ANTES da fala não conta', async () => {
    semear({ texto: 'Pode ser às nove?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.remarcarEnviado}7:oferta`, { em: iso(5 * 3_600_000) }, iso(5 * 3_600_000));
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
  });

  it('qualquer mensagem nossa depois da fala (from_me) tira a conversa da fila: só avança ate_wa_id', async () => {
    semear({ texto: 'Oi' }); alvo([hmacDe(CHAVE)!]);
    (banco.tabelas.wa_mensagens ??= []).push({ id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: 'Sem problema, a gente remarca.', momment: iso(MIN) });
    marcador(7, MOMENTO_LEAD);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.puladas.ja_respondida_por_nos).toBe(1);
    expect(posseDe().ate_wa_id).toBe(10);
  });
});

describe('quando a Helena espera o ep_respostas ler a fala', () => {
  it('marcador atrás da fala: espera a próxima rodada (nada gasto, a fala continua pendente)', async () => {
    semear({ texto: 'Bom dia, pode me mandar o endereço?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, iso(60 * MIN));
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(r.puladas.helena_espera_marcador_atras).toBe(1);
    expect(posseDe().ate_wa_id).toBeNull();
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_vez_vivo:'))).toEqual([]);
  });

  it('sem nenhum marcador ainda: espera', async () => {
    semear({ texto: 'Bom dia' }); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(r.puladas.helena_espera_marcador_atras).toBe(1);
    expect(ia.chamadas).toHaveLength(0);
  });

  it('o marcador chegou na fala: a Helena segue e responde (a vez é dela)', async () => {
    semear({ texto: 'Bom dia, o ponto é meu mesmo' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', telefone: TEL, bolha: FALA_HELENA, dry: false });
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 1 });
  });

  it('marcador atrás E a fala já passou de 15 min: o robô da agenda não leu, passa ao humano com a ficha', async () => {
    semear({ texto: 'Bom dia', momento: iso(20 * MIN) }); alvo([hmacDe(CHAVE)!]);
    marcador(7, iso(60 * MIN));
    await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(posseDe()).toMatchObject({ estado: 'passou_humano' });
  });

  it('card que o ep_respostas NÃO cobre (sem toque): não espera marcador nenhum e a Helena responde', async () => {
    semear({ texto: 'Oi, tudo bem?', card: { confirmacao_at: null } }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('lead sem card nenhum: não há marcador a esperar', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('só card do SOLAR no telefone: conta como "sem card de eletroposto"', async () => {
    semear({ card: { created_by: 'lp_solar', vendedor_nome: 'Nilce' } }); alvo([hmacDe(CHAVE)!]);
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(pedidoDaChamada(0)).toContain('Card na agenda: nenhum');
    expect(pedidoDaChamada(0)).not.toContain('Nilce');
  });
});

describe('chave sem telefone (lid:)', () => {
  it('sem o telefone resolvido a Helena não decide "sem card": espera', async () => {
    const { regrasDaHelena } = await import('../services/agentes5040/helenaEp');
    const v = await regrasDaHelena({ chave: 'lid:123456789', fala: { id: 10, momment: MOMENTO_LEAD }, textos: ['oi'], agoraMs: AGORA.getTime() });
    expect(v).toEqual({ tipo: 'espera', motivo: 'chave_sem_telefone' });
  });
});

describe('a fala que o ep_respostas não vê', () => {
  it('fala que chegou como LID: o robô da agenda não casa o telefone cru, então a Helena não espera um marcador que não vai andar', async () => {
    const { regrasDaHelena } = await import('../services/agentes5040/helenaEp');
    semear({ texto: 'Bom dia, pode me mandar o endereço?' });
    banco.tabelas.wa_mensagens![0]!.telefone = '184293746501234';                    // o LID cru da linha
    (banco.tabelas.wa_lid_telefone ??= []).push({ chave: CHAVE, lid: '184293746501234', telefone: TEL });
    const sem = await regrasDaHelena({ chave: CHAVE, fala: { id: 10, momment: MOMENTO_LEAD }, textos: ['Bom dia, pode me mandar o endereço?'], agoraMs: AGORA.getTime() });
    expect(sem).toMatchObject({ tipo: 'seguir', semCard: false });
    const remarcar = await regrasDaHelena({ chave: CHAVE, fala: { id: 10, momment: MOMENTO_LEAD }, textos: ['Preciso remarcar'], agoraMs: AGORA.getTime() });
    expect(remarcar).toEqual({ tipo: 'humano', motivo: 'remarcar_sem_cobertura' });
  });

  it('o mesmo card com o telefone cru de verdade continua coberto (espera o marcador)', async () => {
    const { regrasDaHelena } = await import('../services/agentes5040/helenaEp');
    semear({ texto: 'Bom dia' });
    const v = await regrasDaHelena({ chave: CHAVE, fala: { id: 10, momment: MOMENTO_LEAD }, textos: ['Bom dia'], agoraMs: AGORA.getTime() });
    expect(v).toEqual({ tipo: 'espera', motivo: 'marcador_atras' });
  });

  it('remarcar dito em ÁUDIO (só a transcrição mostra): com card, nenhum robô cobre, vai ao humano com a ficha e a bolha de agenda', async () => {
    semear({ texto: '', card: { confirmacao_at: iso(3 * 3_600_000) } }); alvo([hmacDe(CHAVE)!]);
    Object.assign(banco.tabelas.wa_mensagens![0]!, { tipo: 'audio', texto: null, media_url: 'https://exemplo.test/a.ogg' });
    marcador(7, MOMENTO_LEAD);
    h.transcrever.mockResolvedValue('Oi, eu preciso remarcar a reunião, não consigo nesse horário');
    ia = modelo([{ bolhas: ['Claro, Roberto. Qual horário fica melhor para você?'], extra: { acao: 'continuar' } }]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA_EP);        // a bolha da IA não saiu
    expect(posseDe().estado).toBe('passou_humano');
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passou_ao_humano' });
  });

  it('áudio que não pede para remarcar segue o fluxo normal', async () => {
    semear({ texto: '' }); alvo([hmacDe(CHAVE)!]);
    Object.assign(banco.tabelas.wa_mensagens![0]!, { tipo: 'audio', texto: null, media_url: 'https://exemplo.test/a.ogg' });
    marcador(7, MOMENTO_LEAD);
    h.transcrever.mockResolvedValue('Oi, o ponto é um posto de gasolina em Araguari');
    await rodar();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(FALA_HELENA);
  });
});

describe('pedido de remarcar que nenhum robô cobre = humano com a ficha, sem a bolha da IA', () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ['card sem nenhum toque da automação', { confirmacao_at: null }],
    ['reunião de mais de 5 dias atrás', { quando: iso(6 * 86_400_000) }],
    ['status fora dos três (em negociação)', { status: 'em_negociacao' }],
    ['cancelado por gente', { status: 'cancelado' }],
  ];
  for (const [nome, extra] of casos) {
    it(nome, async () => {
      semear({ texto: 'Preciso remarcar, não consigo nesse horário', card: extra }); alvo([hmacDe(CHAVE)!]);
      const r = await rodar();
      expect(ia.chamadas).toHaveLength(0);
      expect(h.ficha).toHaveBeenCalledTimes(1);
      expect(String(h.ficha.mock.calls[0]![1])).toContain('Helena');
      expect(h.ficha.mock.calls[0]![0]).toBe('34991360223');                       // o consultor do card (Thiago)
      expect(h.enviar).toHaveBeenCalledTimes(1);
      expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', bolha: BOLHA_PASSAGEM_AGENDA_EP });
      expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
      expect(posseDe()).toMatchObject({ estado: 'passou_humano' });
      expect(r.decisoes[0]).toMatchObject({ resultado: 'passou_ao_humano', ficha: 'enviada' });
    });
  }

  it('com a ficha que não saiu (cooldown) não há bolha: nada prometido', async () => {
    semear({ texto: 'Quero remarcar', card: { confirmacao_at: null } }); alvo([hmacDe(CHAVE)!]);
    h.cooldown = true;
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
  });
});

// ── a resposta ao SIM ────────────────────────────────────────────────────────

describe('confirmar_presenca: só a bolha, com a prova, uma vez por card', () => {
  const sim = (extra: Record<string, unknown> = {}) => ({ bolhas: ['Confirmado, Roberto. Se precisar remarcar, é só me avisar por aqui.'], extra: { acao: 'confirmar_presenca', ...extra } });

  it('SIM com confirmouMesmo e a presença gravada pelo ep_respostas: 1 bolha, reservada por card', async () => {
    semear({ texto: 'Sim', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([sim()]);
    await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', telefone: TEL, bolha: 'Confirmado, Roberto. Se precisar remarcar, é só me avisar por aqui.' });
    expect(chavesDoEstado()).toContain(`${PREFIXO_PRESENCA}7`);
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 1 });
    // só a bolha: nenhuma escrita no card
    expect(cardsDoGerador()[0]).toMatchObject({ status: 'agendado', presenca_confirmada_at: expect.any(String) });
    expect(banco.escritas.filter(e => e.tabela === 'system_state' && (e.chaves ?? []).some(k => k.startsWith('ep_'))).length).toBe(0);
  });

  it('SEM confirmouMesmo ("Sim, mas quanto custa?"): a IA diz confirmar_presenca e a Helena fica quieta', async () => {
    semear({ texto: 'Sim, mas quanto custa?', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([sim()]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(chavesDoEstado()).not.toContain(`${PREFIXO_PRESENCA}7`);
    expect(r.puladas.helena_presenca_nao_confirmou_mesmo).toBe(1);
    expect(posseDe().ate_wa_id).toBe(10);
  });

  it('presença ainda nula (o marcador sai antes da presença no ep_respostas): silêncio, nunca "confirmado"', async () => {
    semear({ texto: 'Sim', card: { presenca_confirmada_at: null } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([sim()]);
    const r = await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.puladas.helena_presenca_presenca_nao_gravada).toBe(1);
  });

  it('horário revendido (status cancelado, presença gravada): nada de "confirmado"', async () => {
    semear({ texto: 'Sim', card: { status: 'cancelado', presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXOS_EP.liberadoSim}7`, { em: iso(3600_000) });
    ia = modelo([sim()]);
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('segundo SIM no mesmo card: sem nova bolha (1 vez por card)', async () => {
    semear({ texto: 'Sim', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXO_PRESENCA}7`, { estado: 'reservada' });
    ia = modelo([sim()]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);                       // "Sim" depois da resposta é fecho: nem chama a IA
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.puladas.helena_cala_fecho_depois_do_sim).toBe(1);
  });

  it('o SIM chega depois de a resposta já ter saído, mas com mais texto: a IA é chamada e a reserva segura a bolha', async () => {
    semear({ texto: 'Sim, confirmo', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXO_PRESENCA}7`, { estado: 'reservada' });
    ia = modelo([sim()]);
    const r = await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(r.puladas.helena_presenca_ja_respondida ?? r.puladas.helena_cala_fecho_depois_do_sim).toBe(1);
  });

  it('"obrigado" e emoji depois da resposta do SIM não recebem resposta', async () => {
    for (const texto of ['Obrigado!', '👍']) {
      banco = novoBanco(); gerador = novoBanco(); h.principal = banco; h.gerador = gerador; h.enviar.mockClear();
      semear({ texto, card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
      marcador(7, MOMENTO_LEAD);
      estadoSemear(`${PREFIXO_PRESENCA}7`, { estado: 'reservada' });
      ia = modelo([{ bolhas: ['Por nada, Roberto.'] }]);
      await rodar();
      expect(ia.chamadas, texto).toHaveLength(0);
      expect(h.enviar, texto).not.toHaveBeenCalled();
    }
  });

  it('a bolha da IA que pede SIM de novo não sai: vai a bolha fixa da presença anotada', async () => {
    semear({ texto: 'Sim', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([{ bolhas: ['Confirmado, Roberto. Pode me responder SIM de novo amanhã?'], extra: { acao: 'confirmar_presenca' } }]);
    await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(bolhaPresencaAnotada('Roberto Lima'));
  });

  it('SIM confirmado com a IA devolvendo "continuar": a bolha sai só pela acaoPresenca (fixa), com a reserva; um 2º "Sim" e um "obrigado" depois não recebem bolha', async () => {
    semear({ texto: 'Sim', momento: iso(10 * MIN), card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, iso(10 * MIN));
    ia = modelo([{ bolhas: ['Que bom! O ponto fica em qual cidade?'] }]);          // acao padrão: continuar
    await rodar();
    expect(ia.chamadas).toHaveLength(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', telefone: TEL, bolha: bolhaPresencaAnotada('Roberto Lima') });
    expect(chavesDoEstado()).toContain(`${PREFIXO_PRESENCA}7`);
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 1 });
    let id = 10;
    for (const texto of ['Sim', 'Obrigado!']) {
      id++;
      (banco.tabelas.wa_mensagens ??= []).push(linhaLead(id, TEL, iso(MIN), texto));
      const r = await rodar();
      expect(r.puladas.helena_cala_fecho_depois_do_sim, texto).toBe(1);
      expect(posseDe().ate_wa_id, texto).toBe(id);
    }
    expect(ia.chamadas).toHaveLength(1);                                           // nem a IA foi chamada de novo
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('SIM confirmado com a IA devolvendo outra ação (calar): a presença é a resposta do mesmo jeito', async () => {
    semear({ texto: 'Confirmo', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([{ bolhas: [], extra: { acao: 'calar' } }]);
    await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(bolhaPresencaAnotada('Roberto Lima'));
    expect(chavesDoEstado()).toContain(`${PREFIXO_PRESENCA}7`);
  });

  it('"sim" 40 minutos depois da bolha de presença já é fala nova: a IA é chamada e responde normalmente, e "obrigado" segue fecho', async () => {
    semear({ texto: 'Sim', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    estadoSemear(`${PREFIXO_PRESENCA}7`, { estado: 'reservada', em: iso(40 * MIN) }, iso(40 * MIN));
    ia = modelo([{ bolhas: ['Por nada.'] }]);
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(1);                                           // não é mais fecho
    expect(r.puladas.helena_cala_fecho_depois_do_sim).toBeUndefined();
    expect(r.puladas.helena_presenca_ja_respondida).toBeUndefined();          // a resposta ao SIM já saiu: agora é conversa normal
    expect(h.enviar).toHaveBeenCalledTimes(1);

    // o "obrigado" vem depois de uma fala nossa (senão entraria no mesmo bloco do "sim")
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(11, TEL, iso(90_000), 'Por nada.', { from_me: true }), linhaLead(12, TEL, iso(MIN), 'Obrigado!'));
    const r2 = await rodar();
    expect(r2.puladas.helena_cala_fecho_depois_do_sim).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
  });

  it('card ainda cancelado e o lead confirmou: a Helena cala, mesmo com o ep_respostas atrás (pode estar reabrindo o card ou oferecendo horários)', async () => {
    semear({ texto: 'Sim', card: { status: 'cancelado', presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    estadoSemear(`${PREFIXOS_EP.liberadoSim}7`, { em: iso(3600_000) });            // coberto, e o marcador ainda não andou
    ia = modelo([sim()]);
    const r = await rodar();
    expect(r.puladas.helena_cala_cancelado_confirmou).toBe(1);
    expect(r.puladas.helena_espera_marcador_atras).toBeUndefined();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().ate_wa_id).toBe(10);
  });

  it('card cancelado e a fala NÃO é uma confirmação: a regra do cancelado não cala', async () => {
    semear({ texto: 'Quanto custa o modelo 02?', card: { status: 'cancelado' } }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['O consultor mostra os valores na reunião.'] }]);
    const r = await rodar();
    expect(r.puladas.helena_cala_cancelado_confirmou).toBeUndefined();
    expect(ia.chamadas).toHaveLength(1);
  });

  it('bolha recusada de forma passageira (teto): a reserva volta e a vez também; a próxima rodada tenta de novo', async () => {
    semear({ texto: 'Sim', card: { presenca_confirmada_at: iso(MIN) } }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([sim()]);
    h.enviar.mockResolvedValueOnce({ ok: false, motivo: 'teto_agentes', detalhe: 'hora:20' });
    await rodar();
    expect(chavesDoEstado()).not.toContain(`${PREFIXO_PRESENCA}7`);
    expect(posseDe().ate_wa_id).toBeNull();
    await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(2);
    expect(chavesDoEstado()).toContain(`${PREFIXO_PRESENCA}7`);
  });
});

// ── marcar sem card ──────────────────────────────────────────────────────────

describe('marcar_horario e pedir_horarios SEM card de eletroposto', () => {
  const BOLHA_IA_MARCADO = 'Marcado: amanhã, quarta, às 9h30, com o Thiago. Você confirma com um SIM?';
  const marcar = (bolhas = [BOLHA_IA_MARCADO], horario = TXT1) => ({ bolhas, extra: { acao: 'marcar_horario', dados: [{ chave: 'horario', valor: horario }] } });
  const novos = () => cardsDoGerador().filter(c => c.created_by === 'agente_eletroposto');

  it('o card nasce (agente_eletroposto, confirmacao_at nulo), a bolha sai logo depois SEM dia/hora/consultor/confirmado/SIM, e a pendência fica na posse', async () => {
    semear({ card: null, texto: 'Quero marcar a quinta', posse: {} }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([marcar()]);
    const r = await rodar();
    expect(novos()).toHaveLength(1);
    const c = novos()[0]!;
    expect(c).toMatchObject({ created_by: 'agente_eletroposto', status: 'agendado', quando: V1, vendedor_nome: 'Thiago', cliente_telefone: TEL });
    expect(c.confirmacao_at ?? null).toBeNull();                               // é o gatilho da confirmação oficial do ep_agenda
    expect(h.livre).toHaveBeenCalledWith(V1, 'Thiago');
    expect(h.vagas.mock.calls[0]![0]).toBe('Thiago');
    expect(h.livre.mock.invocationCallOrder[0]!).toBeLessThan(h.gravarCard.mock.invocationCallOrder[0]!);
    expect(h.gravarCard.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const bolha = h.enviar.mock.calls[0]![0].bolha as string;
    expect(bolha).toBe(bolhaCardCriado(null));                                  // a da IA repetia dia, hora, consultor e pedia SIM
    expect(bolhaSemDetalhe(bolha)).toBe(true);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', telefone: TEL, dry: false });
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 1, ep_dono: 'Thiago', ep_marcou: { cardId: c.id ?? expect.anything(), wa_id: 10, dono: 'Thiago' } });
    expect(r.decisoes[0]).toMatchObject({ acao: 'marcar_horario', resultado: 'marcou' });
    expect(h.ficha).not.toHaveBeenCalled();
    // nada de fila de agenda nem de sessão da Helena antiga
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_agenda_fila:') || k.startsWith('ag5040_agenda_sent:'))).toEqual([]);
  });

  it('a bolha da IA que já vem limpa é aproveitada', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([marcar(['Perfeito, anotei aqui. A mensagem com os detalhes da reunião chega por este WhatsApp.'])]);
    await rodar();
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Perfeito, anotei aqui. A mensagem com os detalhes da reunião chega por este WhatsApp.');
  });

  it('o consultor sai do rodízio do manychat: 3 cards de lp/manychat = Diego, e é com Diego que as vagas e a conferência falam', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    (gerador.tabelas.agendamentos ??= []).push(
      { id: 101, cliente_telefone: '5534988880001', created_by: 'lp_eletroposto', status: 'agendado', vendedor_nome: 'Thiago' },
      { id: 102, cliente_telefone: '5534988880002', created_by: 'manychat_eletroposto', status: 'agendado', vendedor_nome: 'Diego' },
      { id: 103, cliente_telefone: '5534988880003', created_by: 'lp_eletroposto', status: 'agendado', vendedor_nome: 'Thiago' },
      { id: 104, cliente_telefone: '5534988880004', created_by: 'lp_solar', status: 'agendado', vendedor_nome: 'Nilce' },
    );
    ia = modelo([marcar()]);
    await rodar();
    expect(h.vagas.mock.calls[0]![0]).toBe('Diego');
    expect(h.livre).toHaveBeenCalledWith(V1, 'Diego');
    expect(novos()[0]).toMatchObject({ vendedor_nome: 'Diego' });
    expect(posseDe().ep_dono).toBe('Diego');
  });

  it('o dono do telefone só vale se for Thiago ou Diego: a Nilce do solar não vira consultora de eletroposto', async () => {
    semear({ card: { created_by: 'lp_solar', vendedor_nome: 'Nilce', cliente_nome: 'Roberto Lima' } }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([marcar()]);
    await rodar();
    expect(novos()).toHaveLength(1);
    expect(novos()[0]!.vendedor_nome).toMatch(/^(Thiago|Diego)$/);
  });

  it('o consultor decidido antes fica na posse: o rodízio não vira o consultor entre o pedir_horarios e o marcar', async () => {
    semear({ card: null, posse: { ep_dono: 'Diego' } }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([marcar()]);
    await rodar();
    expect(novos()[0]).toMatchObject({ vendedor_nome: 'Diego' });
    expect(h.vagas.mock.calls[0]![0]).toBe('Diego');
  });

  it('as vagas livres vão aos fatos da IA, e o aviso do sistema manda a bolha sem dia, hora e consultor', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([marcar()]);
    await rodar();
    expect(pedidoDaChamada(0)).toContain(TXT1);
    expect(pedidoDaChamada(0)).toContain('AVISO DO SISTEMA');
    expect(pedidoDaChamada(0)).toContain('NÃO repete dia, hora nem consultor');
  });

  it('horário tomado (23505): no máximo UMA nova chamada à IA, com o aviso e as vagas novas', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    h.gravarCard.mockRejectedValueOnce(Object.assign(new Error('duplicado'), { code: '23505' }));
    h.vagas.mockResolvedValueOnce([V1, V2, V3, V4]).mockResolvedValueOnce([V2, V3]);
    ia = modelo([marcar(), { bolhas: ['Esse horário acabou de ser ocupado. Pode ser amanhã, quarta, às 14h30?'], extra: { acao: 'continuar' } }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(pedidoDaChamada(1)).toContain('AVISO DO SISTEMA');
    expect(pedidoDaChamada(1)).toContain('amanhã, quarta, 21/10, às 14h30');
    expect(novos()).toHaveLength(0);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toContain('acabou de ser ocupado');
  });

  it('23505 de novo na segunda chamada: não há terceira; passa ao humano com a ficha', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    h.gravarCard.mockRejectedValue(Object.assign(new Error('duplicado'), { code: '23505' }));
    h.vagas.mockResolvedValueOnce([V1, V2, V3, V4]).mockResolvedValueOnce([V2, V3]);
    ia = modelo([marcar(), { bolhas: [BOLHA_IA_MARCADO], extra: { acao: 'marcar_horario', dados: [{ chave: 'horario', valor: 'amanhã, quarta, 21/10, às 14h30' }] } }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(novos()).toHaveLength(0);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA_EP);
  });

  it('horário que a lista não tem (a IA inventou) ou que aindaLivre nega: a nova chamada traz o aviso e nada é gravado', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    h.livre.mockResolvedValueOnce(false);
    h.vagas.mockResolvedValueOnce([V1, V2, V3, V4]).mockResolvedValueOnce([V2, V3]);
    ia = modelo([marcar(), { bolhas: ['Esse horário acabou de ser ocupado. Pode ser amanhã, quarta, às 14h30?'], extra: { acao: 'continuar' } }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(h.gravarCard).not.toHaveBeenCalled();
    expect(novos()).toHaveLength(0);
  });

  it('telefone bloqueado (fora do padrão): nenhum card e nenhuma bolha', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    h.gravarCard.mockResolvedValue({ id: null, bloqueado: true });
    ia = modelo([marcar()]);
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().ate_wa_id).toBe(10);
  });

  it('bolha recusada depois do card: o card FICA, não vai para fila, e a pendência de 10 minutos segue na posse', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    h.enviar.mockResolvedValueOnce({ ok: false, motivo: 'teto_agentes', detalhe: 'hora:20' });
    ia = modelo([marcar()]);
    await rodar();
    expect(novos()).toHaveLength(1);
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 0 });
    expect(posseDe().ep_marcou).toBeTruthy();
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_agenda_fila:'))).toEqual([]);
  });

  it('pedir_horarios sem horário escolhido é uma pergunta comum (manhã ou tarde): nenhum card', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['Fica melhor de manhã ou de tarde para você?'], extra: { acao: 'pedir_horarios' } }]);
    await rodar();
    expect(novos()).toHaveLength(0);
    expect(h.gravarCard).not.toHaveBeenCalled();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Fica melhor de manhã ou de tarde para você?');
  });

  it('COM card de eletroposto, marcar_horario NÃO cria card: é da remarcação (robô) ou humano; aqui vai ao humano', async () => {
    semear({ texto: 'Pode ser às oito da manhã então?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([marcar()]);
    await rodar();
    expect(h.gravarCard).not.toHaveBeenCalled();
    expect(novos()).toHaveLength(0);
    expect(cardsDoGerador()).toHaveLength(1);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA_EP);
    expect(posseDe().estado).toBe('passou_humano');
  });

  it('o card nasceu DEPOIS das regras (relido logo antes de gravar): não grava e passa ao humano com a ficha', async () => {
    semear({ card: null, texto: 'Quero marcar a quinta' }); alvo([hmacDe(CHAVE)!]);
    // aindaLivre é a última coisa antes da gravação: é aqui que o ep_agenda, a landing ou outro consultor criam o card
    h.livre.mockImplementationOnce(async () => { (gerador.tabelas.agendamentos ??= []).push(card({ id: 9 })); return true; });
    ia = modelo([marcar()]);
    await rodar();
    expect(h.livre).toHaveBeenCalledTimes(1);
    expect(h.gravarCard).not.toHaveBeenCalled();
    expect(novos()).toHaveLength(0);
    expect(cardsDoGerador()).toHaveLength(1);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_AGENDA_EP);
    expect(posseDe().estado).toBe('passou_humano');
    expect(posseDe().ep_marcou).toBeUndefined();
  });

  it('COM card, pedir_horarios também vai ao humano e não cria card', async () => {
    semear({ texto: 'Tem horário às oito da manhã?' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([{ bolhas: ['Fica melhor de manhã ou de tarde?'], extra: { acao: 'pedir_horarios' } }]);
    await rodar();
    expect(novos()).toHaveLength(0);
    expect(h.ficha).toHaveBeenCalledTimes(1);
  });

  it('dry: nada é gravado, nada é enviado, e a decisão mostra o que sairia', async () => {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([marcar()]);
    const r = await rodar({ dry: true });
    expect(h.gravarCard).not.toHaveBeenCalled();
    expect(r.decisoes[0]).toMatchObject({ resultado: 'marcaria' });
    expect(novos()).toHaveLength(0);
    expect(banco.escritas.filter(e => e.tabela === 'whatsapp_sessions')).toEqual([]);
  });
});

describe('a pendência de 10 minutos depois do card marcado', () => {
  const mais = (min: number): Date => new Date(AGORA.getTime() + min * MIN);
  async function marcarEEsperar() {
    semear({ card: null }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['Qualquer coisa.'], extra: { acao: 'marcar_horario', dados: [{ chave: 'horario', valor: TXT1 }] } }]);
    await rodar();
    return cardsDoGerador().find(c => c.created_by === 'agente_eletroposto')!;
  }
  const rodarEm = async (min: number) => { vi.setSystemTime(mais(min)); return runVivoTick({ agora: mais(min), cliente: ia.cliente }); };

  it('antes dos 10 minutos: nada', async () => {
    await marcarEEsperar();
    h.ficha.mockClear();
    await rodarEm(9);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
  });

  it('10 minutos depois com confirmacao_at ainda nulo: passa ao humano com a ficha (sem bolha) e resolve a pendência', async () => {
    const c = await marcarEEsperar();
    h.ficha.mockClear(); h.enviar.mockClear();
    const r = await rodarEm(11);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(String(h.ficha.mock.calls[0]![1])).toContain('Helena');
    expect(h.ficha.mock.calls[0]![0]).toBe(c.vendedor_nome === 'Diego' ? '34991360172' : '34991360223');
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ep_marcou: { resolvido_em: expect.any(String), como: 'passou_ao_humano' } });
    expect(r.decisoes.some(d => d.resultado === 'passou_ao_humano')).toBe(true);
    // e não repete na rodada seguinte
    h.ficha.mockClear();
    await rodarEm(20);
    expect(h.ficha).not.toHaveBeenCalled();
  });

  it('a confirmação oficial saiu (confirmacao_at preenchido): só resolve, ninguém é chamado', async () => {
    const c = await marcarEEsperar();
    c.confirmacao_at = iso(0, mais(5));
    h.ficha.mockClear();
    await rodarEm(11);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'viva', ep_marcou: { como: 'confirmado' } });
  });

  it('ficha adiada (cooldown): a pendência NÃO é resolvida e a próxima rodada tenta de novo', async () => {
    await marcarEEsperar();
    h.ficha.mockClear();
    h.cooldown = true;
    await rodarEm(11);
    expect(h.ficha).not.toHaveBeenCalled();
    expect((posseDe().ep_marcou as any).resolvido_em).toBeUndefined();
    h.cooldown = false;
    await rodarEm(13);
    expect(h.ficha).toHaveBeenCalledTimes(1);
  });
});

// ── as outras ações, como as da Duda ─────────────────────────────────────────

describe('suporte, passagem e não incomodar, como os da Duda', () => {
  it('suporte_giovanna: ficha à Giovanna com o nome da Helena, a bolha da IA sai com dona helena, posse passa a humano', async () => {
    semear({ card: null, texto: 'Já sou cliente do SolarDoc e tive uma cobrança errada' }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['Entendi, Roberto. A Giovanna cuida disso com você.'], extra: { acao: 'suporte_giovanna', resumo: 'cobrança errada' } }]);
    const r = await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34993396255');
    expect(String(h.ficha.mock.calls[0]![1])).toContain('a Helena passou este cliente para a Giovanna');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', bolha: 'Entendi, Roberto. A Giovanna cuida disso com você.' });
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', suporte: { wa_id: 10 } });
    expect(r.decisoes[0]).toMatchObject({ dona: 'helena', resultado: 'passou_ao_humano' });
  });

  it('passar_duda: ficha ao consultor do card e a bolha genérica do eletroposto; nao_incomodar: despedida e silêncio', async () => {
    semear({ texto: 'Quero falar de energia solar para minha casa' }); alvo([hmacDe(CHAVE)!]);
    marcador(7, MOMENTO_LEAD);
    ia = modelo([{ bolhas: [], extra: { acao: 'passar_duda' } }]);
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', bolha: BOLHA_PASSAGEM_GENERICA_EP });
    expect(posseDe().estado).toBe('passou_humano');
  });

  it('nao_incomodar: estado gravado antes da despedida', async () => {
    semear({ card: null, texto: 'Para de me mandar mensagem' }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['Tudo bem, Roberto. Não te escrevo mais.'], extra: { acao: 'nao_incomodar' } }]);
    await rodar();
    expect(posseDe().estado).toBe('nao_incomodar');
    expect(h.enviar).toHaveBeenCalledTimes(1);
  });

  it('a bolha que pede SIM na fala comum é barrada: uma nova chance com o aviso; na segunda vez passa ao humano', async () => {
    semear({ card: null, texto: 'Oi, quero saber do eletroposto' }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([
      { bolhas: ['Que bom! Você confirma sua presença respondendo SIM?'] },
      { bolhas: ['Que bom! O ponto fica em qual cidade?'] },
    ]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(pedidoDaChamada(1)).toContain('foi barrada (pede_sim)');
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe('Que bom! O ponto fica em qual cidade?');

    banco = novoBanco(); gerador = novoBanco(); h.principal = banco; h.gerador = gerador; h.enviar.mockClear(); h.ficha.mockClear();
    semear({ card: null, texto: 'Oi, quero saber do eletroposto' }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['Que bom! Você confirma sua presença respondendo SIM?'] }]);
    await rodar();
    expect(ia.chamadas).toHaveLength(2);
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_PASSAGEM_GENERICA_EP);
  });

  it('só a Helena está ligada: posse da Duda no mesmo banco não é atendida', async () => {
    semear({ card: null, posse: { dona: 'duda' } }); alvo([hmacDe(CHAVE)!]);
    const r = await rodar();
    expect(r.puladas.dona_fora_da_rodada).toBe(1);
    expect(h.enviar).not.toHaveBeenCalled();
  });
});

// ── o teste invertido do parecer ─────────────────────────────────────────────

describe('a posse da Helena NÃO cala os robôs do eletroposto (o ep_respostas de verdade)', () => {
  it('Helena com posse viva: o ep_respostas ainda grava lead_resposta_at e presenca_confirmada_at, avisa a equipe e remarca', async () => {
    // Duas reuniões de Thiago e Diego; a Helena tem posse da primeira conversa.
    const A = telDe(0); const B = telDe(1);
    semear({ texto: 'Sim', card: { id: 7, cliente_telefone: A } });
    (gerador.tabelas.agendamentos ??= []).push(card({ id: 8, cliente_telefone: B, cliente_nome: 'Camila Prado', vendedor_nome: 'Diego', quando: '2026-10-23T14:30:00.000Z' }));
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(20, B, MOMENTO_LEAD, 'Preciso remarcar, não consigo nesse horário'));
    (banco.tabelas.whatsapp_sessions ??= []).push({
      phone: chaveDe(1), tipo: 'ag5040', updated_at: AGORA.toISOString(),
      lead_data: { dona: 'helena', estado: 'viva', apresentada: true, desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [] },
    });
    h.vagas.mockResolvedValue([V1, V2, V3]);

    const r = await runEletropostoRespostasTick();
    expect(r.erros).toBe(0);
    expect(r.avisados).toBe(2);
    expect(r.remarcadas).toBe(0);

    const c7 = cardsDoGerador().find(c => c.id === 7)!;
    const c8 = cardsDoGerador().find(c => c.id === 8)!;
    expect(c7.lead_resposta_at).toEqual(expect.any(String));                   // quem fala não está em silêncio
    expect(c7.presenca_confirmada_at).toEqual(expect.any(String));             // o SIM virou presença
    expect(c8.lead_resposta_at).toEqual(expect.any(String));
    expect(c8.presenca_confirmada_at ?? null).toBeNull();                      // quem pediu para remarcar não confirma
    const avisos = h.aviso.mock.calls.map(c => String(c[1]));
    expect(avisos.some(t => t.includes('CONFIRMOU PRESENÇA') && t.includes('Roberto Lima'))).toBe(true);
    expect(avisos.some(t => t.includes('PODE QUERER REMARCAR') && t.includes('Camila Prado'))).toBe(true);
    expect(h.aviso.mock.calls.length).toBe(4);                                   // Thiago e Diego, por aviso
    // o robô de remarcação falou com a Camila: a lista de horários, e a oferta ficou aberta
    expect(h.aoLead).toHaveBeenCalledTimes(1);
    expect(String(h.aoLead.mock.calls[0]![1][0])).toContain('1)');
    expect(chavesDoEstado()).toContain(`${PREFIXOS_EP.remarcar}8`);
    expect(chavesDoEstado()).toContain(`${PREFIXOS_EP.resposta}7`);
    expect(chavesDoEstado()).toContain(`${PREFIXOS_EP.resposta}8`);
    // a Helena nova não gravou a sessão da Helena antiga
    expect(chavesDoEstado().filter(k => k.startsWith('inv_agente:'))).toEqual([]);

    // E a Helena, agora, cala na Camila (oferta aberta, robô falou) e responde 1 vez ao SIM do Roberto.
    ia = modelo([{ bolhas: ['Confirmado, Roberto.'], extra: { acao: 'confirmar_presenca' } }]);
    alvo([hmacDe(chaveDe(0))!, hmacDe(chaveDe(1))!]);
    const v = await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0]).toMatchObject({ dona: 'helena', telefone: A, bolha: 'Confirmado, Roberto.' });
    expect(v.puladas.helena_cala_remarcacao_do_robo).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
  });

  it('a ordem: a Helena espera o ep_respostas; depois dele, exatamente UMA bolha ao SIM', async () => {
    semear({ texto: 'Sim' }); alvo([hmacDe(CHAVE)!]);
    ia = modelo([{ bolhas: ['Confirmado, Roberto.'], extra: { acao: 'confirmar_presenca' } }]);
    // 1) a Helena vem primeiro: o marcador está atrás, ela espera
    const antes = await rodar();
    expect(antes.puladas.helena_espera_marcador_atras).toBe(1);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(0);
    // 2) o ep_respostas lê a fala (marcador + presença)
    await runEletropostoRespostasTick();
    expect(chavesDoEstado()).toContain(`${PREFIXOS_EP.resposta}7`);
    expect(cardsDoGerador()[0]!.presenca_confirmada_at).toEqual(expect.any(String));
    // 3) a Helena de novo: uma bolha, e uma terceira rodada não repete
    await rodar();
    await rodar();
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(ia.chamadas).toHaveLength(1);
  });

  it('o outro lado: com "preciso remarcar", o ep_respostas faz a oferta e a Helena não diz nada', async () => {
    semear({ texto: 'Preciso remarcar, não consigo nesse horário' }); alvo([hmacDe(CHAVE)!]);
    h.vagas.mockResolvedValue([V1, V2, V3]);
    ia = modelo([{ bolhas: ['Claro, vamos remarcar.'] }]);
    await rodar();                                                             // antes do ep_respostas: cala pela fala
    await runEletropostoRespostasTick();
    await rodar();                                                             // depois: oferta aberta e o carimbo do robô
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.aoLead).toHaveBeenCalledTimes(1);
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_sent:'))).toEqual([]);
    expect(chavesDoEstado().some(k => k.startsWith(PREFIXOS_EP.remarcarEnviado))).toBe(true);
  });
});
