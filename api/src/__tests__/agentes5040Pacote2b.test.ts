import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pacote 2b das agentes da 5040: orçamento por escrito (Duda), pausa humana antes do modelo, ficha da trava com conteúdo,
// nome do lead, volta do ligar agora em 15 min com texto condicional, e a Duda que cede à reunião de eletroposto.
// Banco falso em memória, IA falsa e as saídas (bolha, ficha, fila, card) trocadas por mocks. Nada alcança a rede.
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
  silenciarContato: vi.fn(),
}));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  silenciarContato: (...a: unknown[]) => h.silenciarContato(...a),
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
  linhaIoEmCooldown: () => false,
  leadEhDeTeste: async () => false,
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
import { LIMITES_VIVO, runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import {
  BOLHA_ORCAMENTO_ESCRITO, TOPO_ORCAMENTO_COM_LIGACAO, TOPO_ORCAMENTO_ESCRITO, dadosDoLeadParaFicha, linhasDoOrcamentoEscrito,
} from '../services/agentes5040/acoesVivo';
import { juntarOpcoes, montarBolhaAgenda } from '../services/agentes5040/agendaEnvio';
import { pedeParaPararDeReceber } from '../services/agentes5040/baseRegras';
import { lerFatosPorteiro, montarContexto, nomeDoPerfil, type ListasDeBarragem } from '../services/agentes5040/contexto';
import { decidirDona } from '../services/agentes5040/porteiro';
import { aberturaUsaNomeDaConsultora, montarFicha, type CardDaFicha } from '../services/agentes5040/ficha';
import { fraseDeApresentacao } from '../services/agentes5040/avisoIA';
import type { ContextoLead, FatosPorteiro, MsgConversa } from '../services/agentes5040/tipos';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number, base: Date = AGORA): string => new Date(base.getTime() - msAntes).toISOString();
const telDe = (i: number): string => `55349911${String(1000 + i).padStart(5, '0')}`;
const chaveDe = (i: number): string => `34${telDe(i).slice(-8)}`;
const TEL = telDe(0);
const CHAVE = chaveDe(0);
const FRASE_GASTO = 'Minha conta de luz vem uns R$ 280 por mês';
const PEDIDO_ESCRITO = 'Prefiro por escrito. Moro em Araguari e a conta vem uns R$ 280 por mês';

let banco: BancoFalso;
let gerador: BancoFalso;

const linhaLead = (id: number, tel: string, momento: string, extra: Record<string, unknown> = {}) =>
  ({ id, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: FRASE_GASTO, momment: momento, ...extra });

function semearLead(opts: { texto?: string; card?: Record<string, unknown> | null } = {}) {
  (banco.tabelas.wa_mensagens ??= []).push(linhaLead(10, TEL, iso(2 * 60_000), { texto: opts.texto ?? FRASE_GASTO }));
  (banco.tabelas.whatsapp_sessions ??= []).push({
    phone: CHAVE, tipo: 'ag5040', updated_at: AGORA.toISOString(),
    lead_data: { dona: 'duda', estado: 'viva', apresentada: true, desde: iso(10 * 60_000), ate_wa_id: null, respostas: 0, imagens: [], links: [], },
  });
  if (opts.card) (gerador.tabelas.agendamentos ??= []).push({
    id: 7, cliente_telefone: TEL, cliente_nome: 'Tadeu Souza', vendedor_nome: 'Nilce', status: 'agendado', created_by: 'lp_solar',
    created_at: iso(86_400_000), quando: '2026-10-23T13:00:00.000Z', cidade: 'Araguari', observacao: null, ...opts.card,
  });
  banco.tabelas.system_state = [
    ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)!], modos: {}, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

const posseDe = () => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data as Record<string, any>;
const modelo = (bolhas: string[], extra: Record<string, unknown> = {}) =>
  iaFalsa(() => respostaIA(saidaJson(bolhas, extra), { cache_creation_input_tokens: 100 }));
let ia = modelo(['Oi']);
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry ? { ok: false, motivo: 'dry' } : { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  h.teto.mockReset().mockResolvedValue('ok');
  h.fila.mockReset().mockResolvedValue({ ok: true, chave: 'ag5040_agenda_fila:99:confirma' });
  h.entregarFila.mockReset().mockResolvedValue({ enviadas: 0, descartadas: 0, mantidas: 0 });
  h.vagas.mockReset().mockResolvedValue([]);
  h.boasVindas.mockReset().mockResolvedValue(true);
  h.silenciar.mockReset().mockResolvedValue(true);
  h.silenciarContato.mockReset().mockResolvedValue(undefined);
  h.remarcar.mockReset().mockResolvedValue('ok');
  h.gravar.mockReset().mockResolvedValue({ status: 'erro' });
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  process.env.FICHA_5040_IA_OFF = '1';
  delete process.env.PAUSA_HUMANA_OFF;
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  zerarCacheArmazem(); zerarCacheInterruptores();
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

// ── 1. orçamento por escrito ─────────────────────────────────────────────────

describe('orcamento_escrito (Duda)', () => {
  const dados = [{ chave: 'cidade', valor: 'Araguari' }, { chave: 'conta', valor: 'uns R$ 280 por mês' }];
  beforeEach(() => { ia = modelo([], { acao: 'orcamento_escrito', dados }); });

  it('manda a ficha à consultora ANTES da bolha fixa; o modelo não fala; a posse vai para passou_humano', async () => {
    semearLead({ texto: PEDIDO_ESCRITO, card: {} });
    const r = await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');                       // Nilce, a do card (a mesma rota do ligar_agora)
    const texto = String(h.ficha.mock.calls[0]![1]);
    expect(texto.split('\n')[0]).toContain(TOPO_ORCAMENTO_COM_LIGACAO);          // o card tem ligação marcada em 23/10
    expect(texto).toContain('Araguari');
    expect(texto).toMatch(/Consumo.*kWh/);
    expect(texto).toContain('Não mandou a foto da conta de luz');
    expect(texto).toContain('solardoc.app/gerador/whatsapp/?card=7');            // com card existe o link da conversa
    expect(h.enviar).toHaveBeenCalledTimes(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_ORCAMENTO_ESCRITO);
    expect(h.ficha.mock.invocationCallOrder[0]!).toBeLessThan(h.enviar.mock.invocationCallOrder[0]!);
    expect(h.gravar).not.toHaveBeenCalled();                                     // não cria card
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10, respostas: 1 });
    expect(r.decisoes[0]).toMatchObject({ acao: 'orcamento_escrito', resultado: 'orcamento_escrito', ficha: 'enviada' });
  });

  it('sem card: a consultora sai da faixa de kWh, a ficha vai sem link e diz se mandou foto', async () => {
    semearLead({ texto: PEDIDO_ESCRITO });
    (banco.tabelas.wa_mensagens ??= []).push(linhaLead(9, TEL, iso(3 * 60_000), { tipo: 'image', texto: null, media_url: 'https://x/y.jpg' }));
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.ficha.mock.calls[0]![0]).toBe('34991516846');                       // Nilce (267 kWh: desde 24/10/2026 só ela atende solar)
    const texto = String(h.ficha.mock.calls[0]![1]);
    expect(texto).toContain(TOPO_ORCAMENTO_ESCRITO);
    expect(texto).toContain('Mandou a foto da conta de luz');
    expect(texto).not.toContain('Reunião');
    expect(texto).not.toContain('gerador/whatsapp');
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(BOLHA_ORCAMENTO_ESCRITO);
  });

  it('a ficha que não saiu (linha em cooldown): NENHUMA bolha, e a vez volta para a próxima rodada', async () => {
    semearLead({ texto: PEDIDO_ESCRITO, card: {} });
    h.ficha.mockRejectedValue(new Error('linha em cooldown'));
    const r = await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe().estado).toBe('viva');
    expect(posseDe().ate_wa_id).toBeNull();
    expect(r.decisoes[0]).toMatchObject({ resultado: 'ficha_adiada' });
  });

  it('ficha incerta (5xx): passou_humano e SEM bolha', async () => {
    semearLead({ texto: PEDIDO_ESCRITO, card: {} });
    h.ficha.mockRejectedValue(new Error('Z-API HTTP 504'));
    await rodar();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'passou_humano', ate_wa_id: 10 });
  });

  it('a agenda nunca bloqueia: com card, o lembrete e o bom dia da ligação NÃO são silenciados (quem cala é a consultora)', async () => {
    semearLead({ texto: PEDIDO_ESCRITO, card: {} });
    await rodar();
    expect(h.ficha).toHaveBeenCalledTimes(1);
    expect(h.silenciar).not.toHaveBeenCalled();
  });

  it('o topo da ficha: com reunião futura no card, "TEM LIGAÇÃO MARCADA: COMBINE COM ELE"; sem reunião futura (ou sem card), "NÃO LIGAR"', async () => {
    semearLead({ texto: PEDIDO_ESCRITO, card: {} });                              // card em 23/10, futuro
    await rodar();
    const futuro = String(h.ficha.mock.calls[0]![1]);
    expect(futuro.split('\n')[0]).toContain('PEDIU ORÇAMENTO POR ESCRITO. TEM LIGAÇÃO MARCADA: COMBINE COM ELE.');
    expect(futuro).not.toContain('NÃO LIGAR');
    expect(futuro).toContain('e tem ligação marcada');                           // a ficha não se contradiz
    expect(futuro).not.toContain('não quer ligação');
    for (const card of [{ quando: '2026-10-19T13:00:00.000Z' }, null] as const) {
      banco = novoBanco(); gerador = novoBanco(); h.principal = banco; h.gerador = gerador; zerarCacheArmazem();
      h.ficha.mockClear();
      semearLead({ texto: PEDIDO_ESCRITO, ...(card ? { card } : {}) });
      await rodar();
      const t = String(h.ficha.mock.calls[0]![1]);
      expect(t.split('\n')[0]).toContain('PEDIU ORÇAMENTO POR ESCRITO, NÃO LIGAR.');
      expect(t).not.toContain('COMBINE COM ELE');
      expect(t).toContain('não quer ligação');
    }
  });

  it('o dry não manda ficha nem bolha', async () => {
    semearLead({ texto: PEDIDO_ESCRITO, card: {} });
    const r = await rodar({ dry: true });
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalledWith(expect.objectContaining({ dry: false }), expect.anything());
    expect(r.decisoes[0]).toMatchObject({ resultado: 'passaria_orcamento_escrito' });
    expect(posseDe().estado).toBe('viva');
  });

  it('as peças puras: dados do lead e linhas da ficha', () => {
    const d = dadosDoLeadParaFicha({ dados: { cidade: ' Catalão ', conta: 'uns 450 reais' }, cidades: ['Uberaba'], kwh: 430 });
    expect(d).toEqual({ Cidade: 'Catalão', 'Conta de luz': 'uns 450 reais', Consumo: '~430 kWh por mês' });
    expect(dadosDoLeadParaFicha({ dados: {}, cidades: [null, 'Uberaba'], kwh: null })).toEqual({ Cidade: 'Uberaba' });
    expect(linhasDoOrcamentoEscrito({ dados: {}, temFoto: false, comLigacaoMarcada: true })[0]).toContain('tem ligação marcada');
    const l = linhasDoOrcamentoEscrito({ dados: {}, temFoto: false });
    expect(l).toContain('Cidade: não informada');
    expect(l).toContain('Valor da conta: não informado');
    expect(`${fraseDeApresentacao('duda')} ${BOLHA_ORCAMENTO_ESCRITO}`.length).toBeLessThanOrEqual(160);
  });
});

// ── 2. pausa humana antes do modelo ──────────────────────────────────────────

describe('pedeParaPararDeReceber (o que cala o contato na pausa)', () => {
  it.each([
    'Para de me mandar mensagem', 'Pare de me mandar', 'Parem de me mandar isso', 'Para de mandar', 'Não me mande mais nada', 'Não me mandem mais',
    'Não mande mais', 'Não quero mais receber', 'Quero sair da lista', 'Me tira da lista', 'Me tire da lista', 'Remove meu número', 'Remover meu numero',
    'Quero me descadastrar', 'Descadastre', 'STOP', 'Pare.', 'parar!', 'Sair',
    'Não me manda mais mensagem', 'Me descadastra', 'Para de me mandar mensagem, por favor', 'Para de me mandar!', 'Descadastrar meu número',
    'Descadastre meu contato', 'Não me mande mais.', 'Pare de me mandar isso',
  ])('CALA: %s', (t) => { expect(pedeParaPararDeReceber([t])).toBe(true); });

  it.each([
    'Não quero financiar, prefiro à vista', 'Não quero esse horário, pode ser às 15h?', 'Meu cartão foi bloqueado',
    'Não precisa me ligar, me manda por escrito', 'Pode parar de ligar e me mandar por mensagem', 'Não tenho interesse no momento',
    'Sai do trabalho às 18h', 'Não quero agora, talvez mês que vem', 'Bloqueei o número antigo', 'Oi', 'Pare de ligar, prefiro mensagem',
    'Vou sair às 18h', 'Parar de pagar a conta de luz é o que eu quero',
    'Pode parar de me mandar áudio', 'Não me mande mais áudio', 'Para de mandar o boleto, já paguei', 'Quero sair da lista de espera da Cemig',
    'Quero descadastrar o cartão', 'Me tira da lista de espera', 'Pare de me mandar foto',
  ])('NÃO cala: %s', (t) => { expect(pedeParaPararDeReceber([t])).toBe(false); });
});

describe('pausa humana antes do modelo', () => {
  const pausa = () => (banco.tabelas.atendimento_pausa ??= []).push({
    chave: CHAVE, telefone: TEL, quem: 'Giovanna', ultima_fala_humano: iso(60_000), ultima_fala_lead: null, liberado_em: null,
  });

  it('em pausa: não chama o modelo, não manda ficha nem bolha, só marca a fala como vista', async () => {
    ia = modelo(['Oi, aqui é a Duda']);
    semearLead(); pausa();
    const r = await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(posseDe()).toMatchObject({ estado: 'viva', ate_wa_id: 10 });
    expect(r.puladas).toMatchObject({ pausa_humana: 1 });
    expect(r.decisoes[0]).toMatchObject({ resultado: 'recusada', motivo: 'pausa_humana' });
    // a próxima rodada não repete (a fala já foi vista)
    const r2 = await rodar();
    expect(r2.puladas).toMatchObject({ ja_atendida: 1 });
    expect(ia.chamadas).toHaveLength(0);
  });

  it('em pausa no dry: decide igual mas não grava ate_wa_id', async () => {
    ia = modelo(['Oi']);
    semearLead(); pausa();
    const r = await rodar({ dry: true });
    expect(ia.chamadas).toHaveLength(0);
    expect(posseDe().ate_wa_id).toBeNull();
    expect(r.puladas).toMatchObject({ pausa_humana: 1 });
  });

  it('em pausa e o lead pede para parar: grava o opt-out (silenciarContato), sem modelo e sem envio', async () => {
    ia = modelo(['Oi']);
    semearLead({ texto: 'Para de me mandar mensagem, não quero mais' }); pausa();
    await rodar();
    expect(ia.chamadas).toHaveLength(0);
    expect(h.ficha).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(h.silenciarContato).toHaveBeenCalledTimes(1);
    expect(h.silenciarContato).toHaveBeenCalledWith(TEL, 'opt_out', 'agentes5040-vivo');
    expect(posseDe().ate_wa_id).toBe(10);
  });

  it('em pausa, fala comum: não silencia ninguém; no dry nem o opt-out é gravado', async () => {
    ia = modelo(['Oi']);
    semearLead(); pausa();
    await rodar();
    expect(h.silenciarContato).not.toHaveBeenCalled();
    banco = novoBanco(); gerador = novoBanco(); h.principal = banco; h.gerador = gerador; zerarCacheArmazem();
    semearLead({ texto: 'Para de me mandar mensagem, não quero mais' }); pausa();
    await rodar({ dry: true });
    expect(h.silenciarContato).not.toHaveBeenCalled();
  });

  it('sem pausa a rodada segue e chama o modelo', async () => {
    ia = modelo(['Oi, aqui é a Duda. Em qual cidade você mora?']);
    semearLead();
    await rodar();
    expect(ia.chamadas.length).toBeGreaterThan(0);
  });
});

// ── 3. ficha da trava com conteúdo ───────────────────────────────────────────

describe('ficha da trava', () => {
  it('leva cidade, conta e kWh que a posse e o contexto já têm, e o link da conversa', async () => {
    // fala torta (2 perguntas) duas vezes: a trava barra e passa ao humano
    ia = modelo(['Qual a cidade? E a conta?'], {});
    semearLead({ card: {} });
    banco.tabelas.wa_mensagens!.push(linhaLead(9, TEL, iso(30 * 60_000), { texto: 'Oi' }));
    await rodar();
    const chamadasDeFicha = h.ficha.mock.calls.map(c => String(c[1]));
    expect(chamadasDeFicha.length).toBe(1);
    expect(chamadasDeFicha[0]).toContain('Cidade - Araguari');                   // a linha que a trava acrescentou (o cabeçalho do card só diz "..., Araguari")
    expect(chamadasDeFicha[0]).toMatch(/kWh/);
    expect(chamadasDeFicha[0]).toContain('solardoc.app/gerador/whatsapp/?card=7');
    expect(chamadasDeFicha[0]).toContain('a agente não achou uma resposta segura');
  });
});

// ── 4. nome do lead ──────────────────────────────────────────────────────────

describe('nome do perfil do WhatsApp', () => {
  it.each([
    ['Dona Maria', 'Maria'], ['Seu João', 'João'], ['Prof Ana', 'Ana'], ['Dr. Paulo', 'Paulo'], ['Pastor Elias', 'Elias'], ['José', 'José'],
    ['joão silva', 'João'], ['MARIA', 'Maria'], ['Ana Paula Souza', 'Ana'], ['  carlos  ', 'Carlos'], ['Solange', 'Solange'], ['zé', 'Zé'],
    ['Érica Lima', 'Érica'], ["D'Ávila", null],
  ])('%s -> %s', (entrada, saida) => { expect(nomeDoPerfil(entrada)).toBe(saida); });

  it.each([
    'João 2023', 'Maria 🌸', 'Solar Energia Uberaba', 'Loja do Zé', 'Joao Engenharia', 'Casa & Cia', '@fulano', 'Pedro | Vendas',
    'Mãe', 'Tio Beto', 'Amor', 'Cliente', 'J', 'Ana Ltda', 'Grupo Alfa', 'Supermercado Oficial', '', 'Maria-Clara',
    'Abcdefghijklmnopqrstuv', 'Vovó Lúcia', 'JM Instalações', 'Gratidão', 'Graças a Deus', 'Família Silva', 'Eletricista Zé', 'Dona', 'Seu', 'Dona Seu',
    'Prof 2023', 'JM', 'Dr', 'Bcd',
  ])('recusa %j', (entrada) => { expect(nomeDoPerfil(entrada)).toBeNull(); });

  const lead = (nome: string | null, id = 1): MsgConversa => ({
    id, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: iso(60_000),
    ...(nome ? { sender_name: nome } : {}),
  });

  it('o contexto usa o nome do perfil só quando o card e o cadastro não têm nome (ou têm "Cliente")', async () => {
    const ctx = await montarContexto(CHAVE, { msgs: [lead('priscila souza')], completa: true }, { agora: AGORA.toISOString() });
    expect(ctx.nome).toBe('Priscila');
    (gerador.tabelas.agendamentos ??= []).push({ id: 7, cliente_telefone: TEL, cliente_nome: 'Cliente', created_by: 'lp_solar', created_at: iso(1000), status: 'agendado' });
    expect((await montarContexto(CHAVE, { msgs: [lead('priscila souza')], completa: true }, { agora: AGORA.toISOString() })).nome).toBe('Priscila');
    gerador.tabelas.agendamentos![0]!.cliente_nome = 'Tadeu Souza';
    expect((await montarContexto(CHAVE, { msgs: [lead('priscila souza')], completa: true }, { agora: AGORA.toISOString() })).nome).toBe('Tadeu Souza');
  });

  it('perfil ruim ou fala nossa: continua sem nome', async () => {
    const nossa: MsgConversa = { ...lead(null, 2), autor: 'robo', from_me: true, sender_name: 'Giovanna' };
    const ctx = await montarContexto(CHAVE, { msgs: [lead('Solar Fácil 123'), nossa], completa: true }, { agora: AGORA.toISOString() });
    expect(ctx.nome).toBeNull();
  });

  it('o card nasce com o primeiro nome do perfil no lugar de "Cliente"', async () => {
    ia = modelo(['Combinado, ligo agora'], { acao: 'ligar_agora' });
    semearLead();
    banco.tabelas.wa_mensagens![0]!.sender_name = 'rafael pereira';
    h.gravar.mockImplementation(async (f: any) => ({ status: 'ok', card: { id: 99, vendedor_nome: f.dono, quando: f.quando, cliente_nome: f.nome, created_by: 'lp_solar', status: 'agendado' } }));
    await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(h.gravar.mock.calls[0]![0]).toMatchObject({ nome: 'Rafael' });
  });
});

describe('a ficha separa consultora e cliente', () => {
  const card: CardDaFicha = {
    id: 7, vendedor_nome: 'Giovanna Alves', quando: '2026-10-23T13:00:00.000Z', cliente_nome: 'Cliente', cidade: 'Araguari',
    observacao: null, created_by: 'lp_solar',
  };
  const ctx = (nome: string | null): ContextoLead => ({
    chave: CHAVE, nome, msgs: [{ id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: iso(60_000) }],
    completa: true, card: null, cardSolar: null, leadsMeta: null, cadastros: [], ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: AGORA.toISOString(),
  } as ContextoLead);
  const clienteIA = (abertura: string) => {
    const pedidos: string[] = [];
    const c = {
      messages: {
        async create(body: any) {
          pedidos.push(String(body.messages[0].content[0].text));
          return { content: [{ type: 'text', text: JSON.stringify({ linhas: ['Conta de 280 reais'], abertura }) }] };
        },
      },
    };
    return { c: c as any, pedidos, sistema: (body: any) => body };
  };

  it('o pedido à IA traz "Consultora: X" e "Cliente: sem nome" em linhas separadas', async () => {
    const ia1 = clienteIA('Oi, tudo bem? Vi o seu pedido de orçamento.');
    delete process.env.FICHA_5040_IA_OFF;
    await montarFicha(card, ctx(null), { cliente: ia1.c });
    expect(ia1.pedidos[0]).toContain('Cliente: sem nome');
    expect(ia1.pedidos[0]).toContain('Consultora: Giovanna');
    expect(ia1.pedidos[0]).not.toContain('Ficha Solar · Cliente');
    const ia2 = clienteIA('Oi, Priscila, aqui é da Irmãos na Obra.');
    await montarFicha(card, ctx('Priscila'), { cliente: ia2.c });
    expect(ia2.pedidos[0]).toContain('Cliente: Priscila');
  });

  it('abertura que chama o cliente pelo nome da consultora é descartada; a normal fica', async () => {
    delete process.env.FICHA_5040_IA_OFF;
    const ruim = await montarFicha(card, ctx(null), { cliente: clienteIA('Oi, Giovanna, tudo bem?').c });
    expect(ruim.origem).toBe('ia');
    expect(ruim.linhas.some(l => l.startsWith('Abertura:'))).toBe(false);
    const boa = await montarFicha(card, ctx('Priscila'), { cliente: clienteIA('Oi, Priscila, tudo bem?').c });
    expect(boa.linhas).toContain('Abertura: Oi, Priscila, tudo bem?');
    expect(aberturaUsaNomeDaConsultora('Oi, Giovanna!', 'Giovanna', '')).toBe(true);
    expect(aberturaUsaNomeDaConsultora('Oi, Ana!', 'Ana', 'Ana Lima')).toBe(false);   // mesmo nome nos dois: vale
    expect(aberturaUsaNomeDaConsultora('Oi, Solange!', 'Sol', '')).toBe(false);       // palavra inteira
  });
});

// ── 5. volta do ligar agora ──────────────────────────────────────────────────

describe('volta do ligar agora', () => {
  it('espera 15 min', () => { expect(LIMITES_VIVO.voltaHonestaMs).toBe(15 * 60_000); });

  it('o texto é condicional, com a consultora', () => {
    const b = montarBolhaAgenda('volta', { consultora: 'Giovanna', opcao1: 'hoje às 15h', opcao2: 'amanhã às 9h' });
    expect(b).toBe('Se a Giovanna ainda não conseguiu te ligar, deixo marcado: hoje às 15h ou amanhã às 9h. Qual fica melhor?');
  });

  it('mesmo dia: não repete o dia', () => {
    expect(juntarOpcoes('amanhã às 8h', 'amanhã às 8h30')).toBe('amanhã às 8h ou às 8h30');
    expect(montarBolhaAgenda('volta', { consultora: 'Nilce', opcao1: 'amanhã às 8h', opcao2: 'amanhã às 8h30' }))
      .toBe('Se a Nilce ainda não conseguiu te ligar, deixo marcado: amanhã às 8h ou às 8h30. Qual fica melhor?');
    expect(juntarOpcoes('hoje às 15h', 'amanhã às 9h')).toBe('hoje às 15h ou amanhã às 9h');
  });

  it('nunca passa de 160 no pior caso (nome longo, dias diferentes) e continua condicional', () => {
    const campos = { consultora: 'Wilhelmina-Alexandrina-Maximiliana-Bartolomeu-Fernandes-de-Albuquerque', opcao1: 'quinta, 23/10 às 14h30', opcao2: 'sexta, 24/10 às 14h45' };
    const b = montarBolhaAgenda('volta', campos)!;
    expect(b).toBeTruthy();
    expect(b.length).toBeLessThanOrEqual(160);
    expect(b).toMatch(/\bSe /);
    expect(b).not.toMatch(/Posso ligar/);
  });
});

// ── 6. a Duda cede à reunião de eletroposto ──────────────────────────────────

describe('porteiro: reunião de eletroposto ativa', () => {
  const base: FatosPorteiro = {
    leituraOk: true, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false,
    donaAtual: null, ehClienteSolarDoc: false, anuncio: null, primeiroTextoDoLead: null, origemCadastro: null, outroRoboAtivo: false,
  };
  const f = (x: Partial<FatosPorteiro>): FatosPorteiro => ({ ...base, ...x });

  it('a Duda cede em qualquer dos passos que a escolheriam; sem reunião ela segue', () => {
    for (const x of [{ anuncio: { adId: '1', produto: 'solar' as const } }, { origemCadastro: 'lp_solar' }, { primeiroTextoDoLead: 'Tenho interesse em energia solar' }]) {
      expect(decidirDona(f({ ...x, reuniaoEletroposto: true })), JSON.stringify(x)).toMatchObject({ dona: null, passo: 1 });
      expect(decidirDona(f({ ...x, reuniaoEletroposto: false })), JSON.stringify(x)).toMatchObject({ dona: 'duda' });
    }
  });

  it('a Helena e uma posse que já é da Duda não são afetadas', () => {
    expect(decidirDona(f({ origemCadastro: 'lp_eletroposto', reuniaoEletroposto: true }))).toMatchObject({ dona: 'helena' });
    expect(decidirDona(f({ donaAtual: 'duda', reuniaoEletroposto: true }))).toMatchObject({ dona: 'duda', passo: 2 });
  });

  describe('a leitura (mesma janela do recepcaoIo: 10 dias para trás, 60 para a frente)', () => {
    const listas: ListasDeBarragem = { silenciado: () => false, bloqueado: () => false, mudo: () => false };
    const lead = [lead0()];
    function lead0(): MsgConversa {
      return { id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'oi', tipo: 'texto', media_url: null, momment: iso(60_000) };
    }
    const card = (extra: Record<string, unknown>) => (gerador.tabelas.agendamentos ??= []).push({
      id: 50, cliente_telefone: TEL, created_by: 'lp_eletroposto', status: 'agendado', quando: iso(-3 * 86_400_000), created_at: iso(86_400_000), ...extra,
    });
    const ler = () => lerFatosPorteiro(CHAVE, lead, null, { listas, agora: AGORA.getTime(), completa: true });

    it('reunião marcada nos próximos dias: true', async () => { card({}); expect((await ler()).reuniaoEletroposto).toBe(true); });
    it('reunião de 5 dias atrás: true; de 15 dias atrás: false', async () => {
      card({ quando: iso(5 * 86_400_000) }); expect((await ler()).reuniaoEletroposto).toBe(true);
      gerador.tabelas.agendamentos![0]!.quando = iso(15 * 86_400_000); expect((await ler()).reuniaoEletroposto).toBe(false);
    });
    it('além de 60 dias à frente: false', async () => { card({ quando: iso(-70 * 86_400_000) }); expect((await ler()).reuniaoEletroposto).toBe(false); });
    it('card em fim de linha (sem_interesse, vendido, arrendamento, perdido...): a Duda NÃO cede; agendado, nao_atendeu e confirmado: cede', async () => {
      card({ status: 'sem_interesse', quando: iso(5 * 86_400_000) });
      for (const s of ['sem_interesse', 'vendido', 'arrendamento', 'perdido', 'fechou', 'fechou_concorrente']) {
        gerador.tabelas.agendamentos![0]!.status = s;
        expect((await ler()).reuniaoEletroposto, s).toBe(false);
      }
      for (const s of ['agendado', 'nao_atendeu', 'confirmado']) {
        gerador.tabelas.agendamentos![0]!.status = s;
        expect((await ler()).reuniaoEletroposto, s).toBe(true);
      }
    });
    it('card cancelado, ou do solar: false', async () => {
      card({ status: 'cancelado' }); expect((await ler()).reuniaoEletroposto).toBe(false);
      gerador.tabelas.agendamentos![0]!.status = 'agendado'; gerador.tabelas.agendamentos![0]!.created_by = 'lp_solar';
      expect((await ler()).reuniaoEletroposto).toBe(false);
    });
    it('sem card nenhum: false', async () => { expect((await ler()).reuniaoEletroposto).toBe(false); });
    it('erro de leitura da agenda (modo estrito): o porteiro cala', async () => {
      gerador.falhar.agendamentos = { code: '57014' };
      expect((await ler()).leituraOk).toBe(false);
    });
  });
});
