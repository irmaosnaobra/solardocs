import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ principal: null as any, gerador: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));

import {
  escritasProibidas, iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso,
} from './_agentes5040Fake';
import { runEnsaioTick, ehLeadNovo, ultimoBlocoDoLead, lerCandidatas } from '../services/agentes5040/ensaio';
import { pensarTurno, qualificacaoDe, valoresDaPessoaDe } from '../services/agentes5040/turno';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { CHAVE_DISJUNTOR, clienteComCota, tetoDe } from '../services/agentes5040/cota';
import { hmacDe } from '../services/agentes5040/hmac';
import type { ContextoLead, MsgConversa } from '../services/agentes5040/tipos';
import { msg } from './_agentes5040Util';

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const TEL = '5534991112222';
const CHAVE = '3491112222';
const MOMENTO_LEAD = '2026-10-20T14:45:00+00:00';                          // 15 min antes: dentro da janela

const FALA_HELENA = 'Aqui é a Helena, da Irmãos na Obra. O ponto é seu?';

let banco: BancoFalso;
let gerador: BancoFalso;

function semear(extra: { cadastro?: boolean; primeiraMsg?: string; texto?: string; card?: Record<string, unknown> } = {}) {
  banco.tabelas.wa_mensagens = [
    ...(extra.primeiraMsg ? [{ id: 5, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Oi', momment: extra.primeiraMsg }] : []),
    { id: 10, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: extra.texto ?? 'Oi, quero saber do eletroposto', momment: MOMENTO_LEAD },
  ];
  if (extra.cadastro !== false) {
    gerador.tabelas.eletroposto_nota1 = [{ id: 1, nome: 'Tadeu Souza', telefone: TEL, cidade: 'Araguari', created_at: '2026-10-19T12:00:00Z' }];
  }
  if (extra.card) gerador.tabelas.agendamentos = [{ id: 7, cliente_telefone: TEL, ...extra.card }];
}

const oResponder = (bolhas = [FALA_HELENA], extra: Record<string, unknown> = {}) =>
  iaFalsa(() => respostaIA(saidaJson(bolhas, extra), { cache_creation_input_tokens: 100 }));

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_ENSAIO = '1';
  delete process.env.AGENTES5040_TETO_VIVO;
  zerarCacheArmazem(); zerarCacheInterruptores();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // O ensaio entrega `() => new Date()` (relógio de verdade) para a cota; sem fixar, o dia da chave da cota
  // seguia o dia em que o teste roda e quebrava depois da meia-noite de Brasília.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.AGENTES5040_ENSAIO; });

const chavesDoEstado = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);

describe('ensaio: interruptor', () => {
  it('desligado por env = nenhuma leitura de banco e nenhuma chamada à IA', async () => {
    process.env.AGENTES5040_ENSAIO = '0';
    semear();
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.ligado).toBe(false);
    expect(banco.leituras).toEqual([]);
    expect(gerador.leituras).toEqual([]);
    expect(ia.chamadas).toHaveLength(0);
    expect(banco.escritas).toEqual([]);
  });

  it('sem env e sem a chave no banco = desligado (a única leitura é a do interruptor)', async () => {
    delete process.env.AGENTES5040_ENSAIO;
    semear();
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.ligado).toBe(false);
    expect([...new Set(banco.leituras)]).toEqual(['system_state']);
    expect(gerador.leituras).toEqual([]);
    expect(ia.chamadas).toHaveLength(0);
  });

  it('a chave do banco liga', async () => {
    delete process.env.AGENTES5040_ENSAIO;
    banco.tabelas.system_state = [{ key: 'ag5040_interruptores', value: { ensaio: true } }];
    semear();
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.ligado).toBe(true);
    expect(ia.chamadas.length).toBeGreaterThan(0);
  });
});

describe('ensaio: o caminho feliz', () => {
  it('lead novo da landing: porteiro, Helena, turno gravado no bucket privado e nada fora dele', async () => {
    semear();
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.ok).toBe(true);
    expect(r.comModelo).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
    // o modelo viu o system em cache de 1 hora e o pedido com a conversa
    expect(ia.chamadas[0]!.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    const h64 = hmacDe(CHAVE)!;
    const caminho = `turnos/2026-10-20/${h64}/10.json`;
    expect(banco.bucket.publico).toBe(false);
    const t = JSON.parse(banco.objetos.get(caminho)!);
    expect(t).toMatchObject({
      v: 1, origem: 'vivo', dia: '2026-10-20', hmac: h64, wa_id: 10, kind: 'resposta',
      dona: 'helena', passo: 6, persona: 'helena', falou: true, bolhas: [FALA_HELENA], acao: 'continuar',
    });
    expect(t.entrada.map((m: any) => m.texto)).toEqual(['Oi, quero saber do eletroposto']);
    expect(t.uso).toMatchObject({ cache_criado: 100 });
    expect(t.real).toBeNull();

    // nenhuma escrita nas tabelas proibidas, nenhum ia_falha, nenhuma chave com telefone
    expect(escritasProibidas(banco)).toEqual([]);
    expect(escritasProibidas(gerador)).toEqual([]);
    for (const k of chavesDoEstado()) {
      expect(k).not.toContain(CHAVE);
      expect(k).not.toContain(TEL);
      expect(k.startsWith('ia_falha')).toBe(false);
    }
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain('Tadeu');
  });

  it('a resposta de verdade, quando já houve, vai junto', async () => {
    semear();
    banco.tabelas.wa_mensagens!.push({ id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: 'Oi, tudo bem?', momment: '2026-10-20T14:46:00+00:00' });
    const ia = oResponder();
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    const t = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/10.json`)!);
    expect(t.real.map((m: any) => m.texto)).toEqual(['Oi, tudo bem?']);
  });

  it('janela: mensagem de 25 min atrás e de 10 s atrás ficam de fora', async () => {
    semear();
    banco.tabelas.wa_mensagens![0]!.momment = '2026-10-20T14:35:00+00:00';
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.candidatas).toBe(0);
    banco.tabelas.wa_mensagens![0]!.momment = '2026-10-20T15:04:50+00:00';
    zerarCacheArmazem();
    const r2 = await runEnsaioTick({ agora: new Date(AGORA.getTime() + 5 * 60_000), cliente: ia.cliente });
    expect(r2.candidatas).toBe(0);
    expect(ia.chamadas).toHaveLength(0);
  });

  it('só lead novo: conversa de 60 dias atrás, sem card nem cadastro, não gasta nada', async () => {
    semear({ cadastro: false, primeiraMsg: '2026-08-01T12:00:00+00:00' });
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.puladas.nao_e_lead_novo).toBe(1);
    expect(ia.chamadas).toHaveLength(0);
    expect([...banco.objetos.keys()].filter(k => k.startsWith('turnos/'))).toEqual([]);
  });

  it('o mesmo contato com cadastro de 5 dias entra, mesmo com a primeira mensagem antiga', async () => {
    semear({ primeiraMsg: '2026-08-01T12:00:00+00:00' });
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.comModelo).toBe(1);
  });

  it('ehLeadNovo: 30 dias pela primeira mensagem (conversa inteira), 14 por card, leads_meta e cadastro', () => {
    const agoraMs = AGORA.getTime();
    const cx = (extra: Partial<Pick<ContextoLead, 'completa' | 'card' | 'leadsMeta' | 'cadastros'>> = {}) =>
      ({ completa: true, card: null, leadsMeta: null, cadastros: [], ...extra });
    const msgEm = (iso: string): MsgConversa[] => [msg('lead', 'oi', { momment: iso })];
    expect(ehLeadNovo(msgEm('2026-10-01T10:00:00Z'), cx(), agoraMs)).toBe(true);
    expect(ehLeadNovo(msgEm('2026-09-01T10:00:00Z'), cx(), agoraMs)).toBe(false);
    expect(ehLeadNovo(msgEm('2026-10-01T10:00:00Z'), cx({ completa: false }), agoraMs)).toBe(false);
    expect(ehLeadNovo(msgEm('2026-01-01T10:00:00Z'), cx({ card: { created_at: '2026-10-10T10:00:00Z' } as any }), agoraMs)).toBe(true);
    expect(ehLeadNovo(msgEm('2026-01-01T10:00:00Z'), cx({ card: { created_at: '2026-09-01T10:00:00Z' } as any }), agoraMs)).toBe(false);
    expect(ehLeadNovo(msgEm('2026-01-01T10:00:00Z'), cx({ leadsMeta: { created_time: '2026-10-15T10:00:00Z' } as any }), agoraMs)).toBe(true);
    expect(ehLeadNovo(msgEm('2026-01-01T10:00:00Z'), cx({ cadastros: [{ created_at: '2026-10-15T10:00:00Z' } as any] }), agoraMs)).toBe(true);
  });

  it('ultimoBlocoDoLead pega só o que ainda não teve resposta', () => {
    const a = msg('lead', 'a'); const b = msg('robo', 'b'); const c = msg('lead', 'c'); const d = msg('lead', 'd');
    expect(ultimoBlocoDoLead([a, b, c, d]).map(m => m.texto)).toEqual(['c', 'd']);
  });
});

describe('ensaio: o porteiro', () => {
  it('falha na leitura do porteiro = ninguém responde, sem chamar a IA', async () => {
    semear();
    banco.falhar.atendimento_pausa = { code: '57014' };
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.turnos[0]).toMatchObject({ passo: 'falha', persona: null, falou: false });
    const t = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/10.json`)!);
    expect(t.persona).toBeNull();
    expect(t.motivo_silencio).toMatch(/ninguém/);
  });

  it('humano na conversa = ninguém', async () => {
    semear();
    banco.tabelas.wa_mensagens!.unshift({ id: 4, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: false, tipo: 'texto', texto: 'Aqui é o Thiago', momment: '2026-10-20T13:00:00+00:00' });
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.turnos[0]).toMatchObject({ passo: 1, persona: null });
  });

  it('sem sinal do assunto = a pergunta única, sem modelo', async () => {
    semear({ cadastro: false });
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.turnos[0]).toMatchObject({ passo: 7, persona: null });
    const t = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/10.json`)!);
    expect(t.pergunta_porteiro).toMatch(/energia solar/);
  });

  it('cliente do SolarDoc vai para a Giovanna robô: fora das três, sem modelo', async () => {
    semear();
    banco.tabelas.users = [{ id: 1, whatsapp: TEL }];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.turnos[0]).toMatchObject({ passo: 3, dona: 'giovanna_suporte', persona: null });
  });

  it('a conversa já tem dona: o passar_* do último turno vale no próximo', async () => {
    semear();
    const ia = iaFalsa(() => respostaIA(saidaJson([], { acao: 'passar_duda' })));
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    const t1 = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/10.json`)!);
    expect(t1).toMatchObject({ persona: 'helena', acao: 'passar_duda', falou: true, bolhas: [] });
    // nova mensagem do lead depois da nossa vez
    banco.tabelas.wa_mensagens!.push({ id: 12, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Pode passar', momment: '2026-10-20T14:50:00+00:00' });
    const ia2 = oResponder(['Oi, aqui é a Duda. Quanto você gasta de luz?']);
    await runEnsaioTick({ agora: new Date(AGORA.getTime() + 5 * 60_000), cliente: ia2.cliente });
    const t2 = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/12.json`)!);
    expect(t2).toMatchObject({ passo: 2, dona: 'duda', persona: 'duda' });
  });
});

describe('ensaio: custo e travas de rodada', () => {
  it('crédito zerado abre o disjuntor, não grava o turno, não grava ia_falha e a rodada seguinte nem chama', async () => {
    semear();
    const ia = iaFalsa(() => { throw new Error('400 invalid_request_error: Your credit balance is too low to access the Anthropic API'); });
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.parou).toBe('disjuntor');
    expect(ia.chamadas).toHaveLength(1);                           // a reserva não repete o erro de crédito
    const chaves = chavesDoEstado();
    expect(chaves).toContain(CHAVE_DISJUNTOR);
    expect(chaves.some(k => k.startsWith('ia_falha'))).toBe(false);
    expect(banco.escritas.some(e => (e.chaves ?? []).some(k => k.startsWith('ia_falha')))).toBe(false);
    expect([...banco.objetos.keys()].filter(k => k.startsWith('turnos/'))).toEqual([]);
    expect(chaves).not.toContain('ag5040_vez:10');                  // a vez foi solta: dá para tentar de novo

    const ia2 = oResponder();
    const r2 = await runEnsaioTick({ agora: new Date(AGORA.getTime() + 5 * 60_000), cliente: ia2.cliente });
    expect(r2.parou).toBe('disjuntor');
    expect(ia2.chamadas).toHaveLength(0);
  });

  it('o disjuntor fecha sozinho depois do prazo', async () => {
    semear();
    banco.tabelas.system_state = [{ key: CHAVE_DISJUNTOR, value: { ate: '2026-10-20T14:00:00Z' } }];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.parou).toBeNull();
    expect(ia.chamadas.length).toBeGreaterThan(0);
  });

  it('teto do dia atingido = nenhuma chamada à IA', async () => {
    semear();
    process.env.AGENTES5040_TETO_VIVO = '2';
    banco.tabelas.system_state = [
      { key: 'ag5040_ia:vivo:2026-10-20:1', value: {} },
      { key: 'ag5040_ia:vivo:2026-10-20:2', value: {} },
    ];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.parou).toBe('teto');
    expect([...banco.objetos.keys()].filter(k => k.startsWith('turnos/'))).toEqual([]);
  });

  it('o teto conta CHAMADAS reais: cada uma reserva uma vaga', async () => {
    semear();
    let n = 0;
    const ia = iaFalsa(() => { n++; return respostaIA(n === 1 ? saidaJson(['aqui sem maiúscula?']) : saidaJson([FALA_HELENA])); });
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(2);                           // barrada pela trava + uma reescrita
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_ia:vivo:2026-10-20:'))).toHaveLength(2);
    const t = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/10.json`)!);
    expect(t.reescrita?.length).toBeGreaterThan(0);
  });

  // O dia da cota é o de BRASÍLIA, não o de UTC: 23:30 BRT já é o dia seguinte em UTC e a vaga continua a do dia 20.
  it.each([
    ['02:30 BRT', '2026-10-20T05:30:00Z', '2026-10-20'],
    ['15:00 BRT', '2026-10-20T18:00:00Z', '2026-10-20'],
    ['23:30 BRT (já é dia 21 em UTC)', '2026-10-21T02:30:00Z', '2026-10-20'],
    ['00:30 BRT do dia 21', '2026-10-21T03:30:00Z', '2026-10-21'],
  ])('o teto do dia segue o dia de Brasília: %s', async (_nome, relogio, dia) => {
    vi.setSystemTime(new Date(relogio));
    semear();
    process.env.AGENTES5040_TETO_VIVO = '1';
    banco.tabelas.system_state = [{ key: `ag5040_ia:vivo:${dia}:1`, value: {} }];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.parou).toBe('teto');
  });

  it('trava de rodada: duas rodadas no mesmo intervalo de 5 min, a segunda sai', async () => {
    semear();
    const ia = oResponder();
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    const antes = ia.chamadas.length;
    const r2 = await runEnsaioTick({ agora: new Date(AGORA.getTime() + 60_000), cliente: ia.cliente });
    expect(r2.ocupada).toBe(true);
    expect(ia.chamadas).toHaveLength(antes);
  });

  it('reserva da vez: a mesma mensagem não é ensaiada duas vezes, mesmo em outro intervalo', async () => {
    semear();
    const ia = oResponder();
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    const antes = ia.chamadas.length;
    const r2 = await runEnsaioTick({ agora: new Date(AGORA.getTime() + 5 * 60_000), cliente: ia.cliente });
    expect(r2.puladas.ja_ensaiada).toBe(1);
    expect(ia.chamadas).toHaveLength(antes);
  });

  it('no máximo 3 conversas com modelo por rodada', async () => {
    banco.tabelas.wa_mensagens = [];
    gerador.tabelas.eletroposto_nota1 = [];
    for (let i = 0; i < 5; i++) {
      const tel = `553499111${1000 + i}`;
      banco.tabelas.wa_mensagens.push({ id: 100 + i, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Oi', momment: `2026-10-20T14:4${i}:00+00:00` });
      gerador.tabelas.eletroposto_nota1.push({ id: i + 1, nome: 'X', telefone: tel, cidade: 'Araguari', created_at: '2026-10-19T12:00:00Z' });
    }
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.comModelo).toBe(3);
    expect(r.candidatas).toBe(5);
    const r2 = await runEnsaioTick({ agora: AGORA, uma: true, dry: true, cliente: ia.cliente });
    expect(r2.comModelo).toBe(1);
  });

  it('o dry nunca passa de UMA conversa com modelo, mesmo sem uma=1 (ele ignora o interruptor e gasta de verdade)', async () => {
    delete process.env.AGENTES5040_ENSAIO;
    banco.tabelas.wa_mensagens = [];
    gerador.tabelas.eletroposto_nota1 = [];
    for (let i = 0; i < 5; i++) {
      const tel = `553499111${1000 + i}`;
      banco.tabelas.wa_mensagens.push({ id: 100 + i, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Oi', momment: `2026-10-20T14:4${i}:00+00:00` });
      gerador.tabelas.eletroposto_nota1.push({ id: i + 1, nome: 'X', telefone: tel, cidade: 'Araguari', created_at: '2026-10-19T12:00:00Z' });
    }
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, dry: true, cliente: ia.cliente });
    expect(r.comModelo).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
  });
});

describe('ensaio: ?dry=1', () => {
  it('funciona com o interruptor desligado, usa o modelo, devolve o uso e não grava nem reserva', async () => {
    delete process.env.AGENTES5040_ENSAIO;
    semear();
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, dry: true, uma: true, cliente: ia.cliente });
    expect(r.ligado).toBe(true);
    expect(ia.chamadas).toHaveLength(1);
    expect(r.turnos[0]).toMatchObject({ persona: 'helena', falou: true, gravado: 'nao_gravou', uso: { cache_criado: 100 } });
    expect([...banco.objetos.keys()]).toEqual([]);
    expect(chavesDoEstado().filter(k => k.startsWith('ag5040_lock') || k.startsWith('ag5040_vez'))).toEqual([]);
    // pode repetir
    const r2 = await runEnsaioTick({ agora: AGORA, dry: true, uma: true, cliente: ia.cliente });
    expect(r2.turnos).toHaveLength(1);
  });

  it('o dry respeita o disjuntor e o teto', async () => {
    delete process.env.AGENTES5040_ENSAIO;
    semear();
    banco.tabelas.system_state = [{ key: CHAVE_DISJUNTOR, value: { ate: '2026-10-20T16:00:00Z' } }];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, dry: true, uma: true, cliente: ia.cliente });
    expect(r.parou).toBe('disjuntor');
    expect(ia.chamadas).toHaveLength(0);
  });
});

describe('ensaio: o anúncio de origem (passo 4)', () => {
  const ID_DEBUG = '11111111-2222-3333-4444-555555555555';
  const AD = '1203630000000001';

  it('leitura do anúncio falhou: ninguém responde e o motivo diz que foi o anúncio', async () => {
    semear({ cadastro: false });
    banco.tabelas.wa_mensagens![0]!.webhook_debug_id = 'isto-nao-e-um-uuid';
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.turnos[0]).toMatchObject({ passo: 'falha', persona: null, falou: false });
    expect(r.turnos[0]!.motivo).toMatch(/anúncio/);
  });

  it('webhook_debug com erro de leitura também cala, com o mesmo motivo', async () => {
    semear({ cadastro: false });
    banco.tabelas.wa_mensagens![0]!.webhook_debug_id = ID_DEBUG;
    banco.falhar.webhook_debug = { code: '57014' };
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.turnos[0]).toMatchObject({ passo: 'falha', persona: null });
    expect(r.turnos[0]!.motivo).toMatch(/anúncio/);
  });

  it('anúncio de campanha do eletroposto vale como dona (passo 4), mesmo sem cadastro nenhum', async () => {
    semear({ cadastro: false });
    banco.tabelas.wa_mensagens![0]!.webhook_debug_id = ID_DEBUG;
    banco.tabelas.webhook_debug = [{ id: ID_DEBUG, externalAdReply: { sourceId: AD, title: 'x' }, adContext: null }];
    banco.tabelas.system_state = [{
      key: `meta_ad:${AD}`,
      value: JSON.stringify({ anuncio: { id: AD, nome: 'Ad 1' }, campanha: { id: '9', nome: 'NEXUS Eletropostos | Leads' }, em: new Date().toISOString() }),
    }];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.turnos[0]).toMatchObject({ passo: 4, dona: 'helena', persona: 'helena', falou: true });
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain('ctwa');
  });

  it('anúncio sem produto conhecido não escolhe dona: segue a ordem do porteiro', async () => {
    semear({ cadastro: false });
    banco.tabelas.wa_mensagens![0]!.webhook_debug_id = ID_DEBUG;
    banco.tabelas.webhook_debug = [{ id: ID_DEBUG, externalAdReply: { sourceId: AD }, adContext: null }];
    banco.tabelas.system_state = [{
      key: `meta_ad:${AD}`,
      value: JSON.stringify({ anuncio: { id: AD, nome: 'Ad 1' }, campanha: { id: '9', nome: 'Campanha qualquer' }, em: new Date().toISOString() }),
    }];
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.turnos[0]).toMatchObject({ passo: 7, persona: null });
  });
});

describe('ensaio: horários livres entram na conversa da persona', () => {
  it('a Helena com card do Thiago vê horários por extenso nos fatos', async () => {
    semear({ card: { cliente_nome: 'Tadeu Souza', vendedor_nome: 'Thiago', status: 'confirmado', created_by: 'lp_eletroposto', created_at: '2026-10-19T12:00:00Z', quando: '2026-10-22T13:00:00Z' } });
    const ia = oResponder();
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    const pedido = JSON.stringify(ia.chamadas[0]!.body.messages);
    expect(pedido).toMatch(/Horários livres \(ofereça dois destes/);
    expect(pedido).toContain('hoje, terça, 20/10, às 13h30');
  });
});

describe('pensarTurno: o que a trava recebe de quem chama', () => {
  const base = (msgs: MsgConversa[], extra: Partial<ContextoLead> = {}): ContextoLead => ({
    chave: CHAVE, nome: 'Tadeu', msgs, completa: true, card: null, leadsMeta: null, cadastros: [],
    ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: AGORA.toISOString(), ...extra,
  });

  it('Helena: com imóvel, padrão e vagas ditos pelo lead, o valor público passa', async () => {
    const msgs = [msg('lead', 'Sou dono do terreno, a rede é trifásica e dá para umas 3 vagas. Quanto custa?')];
    const ia = iaFalsa(() => respostaIA(saidaJson(['O de 60 kW sai por R$ 135 mil. Quer que eu marque a conversa com o Thiago?'])));
    const r = await pensarTurno({ persona: 'helena', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    expect(r.qualificado).toBe(true);
    expect(r.pensamento.falou).toBe(true);
  });

  it('Helena: sem a qualificação, o mesmo valor é barrado', async () => {
    const msgs = [msg('lead', 'Quanto custa?')];
    const ia = iaFalsa(() => respostaIA(saidaJson(['O de 60 kW sai por R$ 135 mil. Quer que eu marque a conversa com o Thiago?'])));
    const r = await pensarTurno({ persona: 'helena', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    expect(r.qualificado).toBe(false);
    expect(r.pensamento.falou).toBe(false);
  });

  it('Helena: os dados do turno ANTERIOR qualificam; os da própria chamada não autorizam nada', async () => {
    const msgs = [msg('lead', 'Quanto custa?')];
    const fala = 'O de 60 kW sai por R$ 135 mil. Quer que eu marque a conversa com o Thiago?';
    const comDadosNaSaida = iaFalsa(() => respostaIA(saidaJson([fala], { dados: [{ chave: 'imovel', valor: 'dono' }, { chave: 'padrao', valor: 'trifasico' }, { chave: 'vagas', valor: '3' }] })));
    const a = await pensarTurno({ persona: 'helena', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: comDadosNaSaida.cliente, cacheMidia: new Map() });
    expect(a.pensamento.falou).toBe(false);
    const b = await pensarTurno({ persona: 'helena', ctx: base(msgs), novas: msgs, dadosAnteriores: { imovel: 'dono', padrao: 'trifasico', vagas: '3' }, abertura: false, cliente: oResponder([fala]).cliente, cacheMidia: new Map() });
    expect(b.qualificado).toBe(true);
    expect(b.pensamento.falou).toBe(true);
  });

  it('Duda: o valor em reais que o lead escreveu pode voltar na fala; o que ele não disse, não', async () => {
    const msgs = [msg('lead', 'Pago uns R$ 480 de luz por mês')];
    const boa = iaFalsa(() => respostaIA(saidaJson(['Entendi, R$ 480 de luz por mês. Em que cidade fica o imóvel?'])));
    const r1 = await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: boa.cliente, cacheMidia: new Map() });
    expect(r1.pensamento.falou).toBe(true);
    const ruim = iaFalsa(() => respostaIA(saidaJson(['Entendi, R$ 900 de luz por mês. Em que cidade fica o imóvel?'])));
    const r2 = await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ruim.cliente, cacheMidia: new Map() });
    expect(r2.pensamento.falou).toBe(false);
  });

  it('Duda: o prazo que o lead disse pode voltar como eco', async () => {
    const msgs = [msg('lead', 'Quero montar em até dois meses')];
    const ia = iaFalsa(() => respostaIA(saidaJson(['Certo, montar em até dois meses. Qual é a sua cidade?'])));
    const r = await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    expect(r.pensamento.falou).toBe(true);
  });

  it('ações sem fala (passar_duda) com bolhas vazias passam; sem acoesSemFala seriam barradas', async () => {
    const msgs = [msg('lead', 'Pode passar para a Duda')];
    const ia = iaFalsa(() => respostaIA(saidaJson([], { acao: 'passar_duda' })));
    const r = await pensarTurno({ persona: 'helena', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    expect(r.pensamento.falou).toBe(true);
  });

  it('o total da conta de luz lido da imagem entra nos valores da pessoa (leitura à parte, sem a persona)', async () => {
    const msgs = [msg('lead', null, { tipo: 'image', media_url: 'https://x/y.jpg' })];
    const cache = new Map([[msgs[0]!.id, { msgId: msgs[0]!.id, tipo: 'imagem' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: 'AAAA' } }]]);
    const ia = iaFalsa(body => {
      if (JSON.stringify(body.output_config).includes('e_conta_de_luz')) return respostaIA(JSON.stringify({ e_conta_de_luz: true, valor_total_reais: 523.4 }));
      return respostaIA(saidaJson(['Vi na conta o total de R$ 523,40. Em que cidade fica o imóvel?']));
    });
    const r = await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: cache });
    expect(r.valoresDaPessoa).toContain(523.4);
    expect(r.pensamento.falou).toBe(true);
  });

  it('qualificacaoDe e valoresDaPessoaDe: pedaços puros', () => {
    expect(qualificacaoDe(['terreno é meu, monofásico, duas vagas'], {}).completa).toBe(true);
    expect(qualificacaoDe(['terreno é meu'], {}).completa).toBe(false);
    expect(valoresDaPessoaDe(['gasto 1.250 reais'], { valor_conta: '480', consumo_kwh: '900' })).toEqual(expect.arrayContaining([1250, 480]));
    expect(valoresDaPessoaDe([], { consumo_kwh: '900' })).toEqual([]);
  });
});

describe('ensaio: a resposta da rota não leva texto', () => {
  it('o relatório só tem contagens, ids, estados, tamanhos e uso: nada do lead nem da agente', async () => {
    semear();
    const ia = oResponder();
    const r = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    const json = JSON.stringify(r);
    expect(json).not.toContain('Aqui é a Helena');
    expect(json).not.toContain('Oi, quero saber');
    expect(json).not.toContain('Tadeu');
    expect(json).not.toContain('"bolhas"');
    expect(r.turnos[0]).toMatchObject({ falou: true, n_bolhas: 1, tamanho: FALA_HELENA.length, uso: { cache_criado: 100 } });
    for (const k of ['entrada', 'resumo', 'dados']) expect(Object.keys(r.turnos[0]!)).not.toContain(k);
  });
});

describe('ensaio: teto próprio do dry', () => {
  it('padrão 10, env troca, separado do vivo e do replay', () => {
    delete process.env.AGENTES5040_TETO_DRY;
    expect(tetoDe('dry')).toBe(10);
    process.env.AGENTES5040_TETO_DRY = '3';
    expect(tetoDe('dry')).toBe(3);
    process.env.AGENTES5040_TETO_DRY = 'abc';
    expect(tetoDe('dry')).toBe(10);
    delete process.env.AGENTES5040_TETO_DRY;
    expect(tetoDe('vivo')).toBe(120);
  });

  it('o dry gasta as vagas do dry; estourou, nenhuma chamada; o vivo continua com as dele', async () => {
    semear();
    process.env.AGENTES5040_TETO_DRY = '1';
    banco.tabelas.system_state = Array.from({ length: 130 }, (_, i) => ({ key: `ag5040_ia:vivo:2026-10-20:${i + 1}`, value: {} }));
    const ia = oResponder();
    const r1 = await runEnsaioTick({ agora: AGORA, dry: true, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(1);
    expect(r1.turnos).toHaveLength(1);
    expect(chavesDoEstado()).toContain('ag5040_ia:dry:2026-10-20:1');
    const r2 = await runEnsaioTick({ agora: AGORA, dry: true, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(1);
    expect(r2.parou).toBe('teto');
    delete process.env.AGENTES5040_TETO_DRY;
  });
});

describe('ensaio: prazo da rodada dentro da cota', () => {
  it('sem tempo restante a chamada nem sai; com tempo, o timeout é cortado ao que sobra', async () => {
    const vistas: any[] = [];
    const base = { messages: { create: async (_b: any, o: any) => { vistas.push(o); return respostaIA(saidaJson(['Oi.'])); } } };
    const vencido = clienteComCota('dry', () => AGORA, base as any, Date.now() - 1);
    await expect(vencido.cliente.messages.create({}, { timeout: 60000 })).rejects.toThrow(/prazo/);
    expect(vencido.estado.parou).toBe('prazo');
    expect(vistas).toHaveLength(0);
    const apertado = clienteComCota('dry', () => AGORA, base as any, Date.now() + 20_000);
    await apertado.cliente.messages.create({}, { timeout: 60000, maxRetries: 0 });
    expect(vistas[0].timeout).toBeLessThanOrEqual(20_000);
    expect(vistas[0].maxRetries).toBe(0);
  });
});

describe('ensaio: candidatas', () => {
  it('lidas das mais recentes para as mais antigas; teto de páginas marca truncado e perde as mais velhas', async () => {
    banco.tabelas.wa_mensagens = [];
    for (let i = 0; i < 5001; i++) {
      const tel = `55349911${String(10000 + (i % 40)).padStart(5, '0')}`;
      banco.tabelas.wa_mensagens.push({ id: i + 1, instancia: 'inst-io', telefone: tel, is_group: false, from_me: false, tipo: 'texto', momment: new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + i * 1000).toISOString() });
    }
    const r = await lerCandidatas('inst-io', '2026-10-20T00:00:00Z', '2026-10-20T23:59:59Z');
    expect(r.truncado).toBe(true);
    expect(Date.parse(r.candidatas[0]!.momento)).toBeGreaterThan(Date.parse(r.candidatas[r.candidatas.length - 1]!.momento));
    expect(r.candidatas[0]!.waId).toBe(5001);
    const pequeno = await lerCandidatas('inst-io', '2026-10-20T10:00:00Z', '2026-10-20T10:00:10Z');
    expect(pequeno.truncado).toBe(false);
  });
});

describe('ensaio: falha avulsa da IA (400, timeout)', () => {
  it('tenta no máximo 2 vezes por mensagem; na segunda grava o turno como falhou, com o motivo', async () => {
    semear();
    const ia = iaFalsa(() => { throw new Error('400 invalid_request_error: bad request'); });
    const r1 = await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(r1.puladas.ia_indisponivel).toBe(1);
    expect([...banco.objetos.keys()].filter(k => k.startsWith('turnos/'))).toEqual([]);
    expect(chavesDoEstado()).not.toContain('ag5040_vez:10');
    expect(chavesDoEstado()).toContain('ag5040_tent:10');
    const r2 = await runEnsaioTick({ agora: new Date(AGORA.getTime() + 5 * 60_000), cliente: ia.cliente });
    expect(r2.turnos[0]).toMatchObject({ persona: 'helena', falou: false });
    expect(r2.turnos[0]!.motivo).toMatch(/IA não respondeu/);
    const t = JSON.parse(banco.objetos.get(`turnos/2026-10-20/${hmacDe(CHAVE)}/10.json`)!);
    expect(t.falou).toBe(false);
    expect(chavesDoEstado()).toContain('ag5040_vez:10');
    const antes = ia.chamadas.length;
    const r3 = await runEnsaioTick({ agora: new Date(AGORA.getTime() + 10 * 60_000), cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(antes);
    expect(r3.candidatas).toBe(0);
  });
});

describe('ensaio: nome composto do consultor no card (Diego Souza)', () => {
  it('o primeiro nome acha o dono e os horários livres entram', async () => {
    semear({ cadastro: false, card: { cliente_nome: 'Tadeu Souza', vendedor_nome: 'Diego Souza', status: 'confirmado', created_by: 'lp_eletroposto', created_at: '2026-10-19T12:00:00Z', quando: '2026-10-22T13:00:00Z' } });
    const ia = oResponder();
    await runEnsaioTick({ agora: AGORA, cliente: ia.cliente });
    expect(JSON.stringify(ia.chamadas[0]!.body.messages)).toContain('Horários livres (ofereça dois destes');
  });
});
