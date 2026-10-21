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
import { cardDaEpoca, dadosDaEpoca, quebrarEmTurnos, runReplay } from '../services/agentes5040/replay';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { hmacDe } from '../services/agentes5040/hmac';
import { msg } from './_agentes5040Util';

const AGORA = new Date('2026-10-20T15:00:00.000Z');
const TEL = '5534991112222';
const CHAVE = '3491112222';
const DESDE = '2026-10-12T00:00:00Z';
const ATE = '2026-10-14T00:00:00Z';

let banco: BancoFalso;
let gerador: BancoFalso;

const wa = (id: number, quem: 'lead' | 'robo' | 'equipe', texto: string, momment: string) => ({
  id, instancia: 'inst-io', telefone: TEL, is_group: false,
  from_me: quem !== 'lead', from_api: quem === 'robo' ? true : quem === 'equipe' ? false : null,
  tipo: 'texto', texto, momment,
});

function semearConversa() {
  banco.tabelas.wa_mensagens = [
    wa(1, 'lead', 'Oi, vim pelo site do eletroposto', '2026-10-12T13:00:00+00:00'),     // segunda 10h BRT
    wa(2, 'robo', 'Oi! Aqui é a Helena.', '2026-10-12T13:01:00+00:00'),
    wa(3, 'lead', 'Sou dono do ponto, a rede é trifásica e dá para 3 vagas', '2026-10-12T13:30:00+00:00'),
    wa(4, 'robo', 'Perfeito, anotado.', '2026-10-12T13:31:00+00:00'),
    wa(5, 'lead', 'E quanto custa?', '2026-10-13T13:00:00+00:00'),
  ];
  gerador.tabelas.eletroposto_nota1 = [{ id: 1, nome: 'Tadeu', telefone: TEL, cidade: 'Araguari', created_at: '2026-10-10T12:00:00Z' }];
}

const caminhos = () => [...banco.objetos.keys()].filter(k => k.startsWith('turnos/'));
const pedidoDe = (ia: ReturnType<typeof iaFalsa>, i: number): string => JSON.stringify(ia.chamadas[i]!.body.messages);
const FALA = 'Aqui é a Helena, da Irmãos na Obra. O ponto é seu?';

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_REPLAY = '1';
  delete process.env.AGENTES5040_TETO_REPLAY;
  zerarCacheArmazem(); zerarCacheInterruptores();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.AGENTES5040_REPLAY; });

describe('replay: quebrar a conversa em turnos', () => {
  it('bloco do lead até a nossa resposta; o último bloco sem resposta também é turno', () => {
    const c = [msg('lead', 'a'), msg('lead', 'b'), msg('robo', 'r1'), msg('lead', 'c'), msg('robo', 'r2'), msg('robo', 'r3'), msg('lead', 'd')];
    const t = quebrarEmTurnos(c);
    expect(t.map(x => x.bloco.map(m => m.texto))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(t.map(x => x.real.map(m => m.texto))).toEqual([['r1'], ['r2', 'r3'], []]);
    expect(t[1]!.historico.map(m => m.texto)).toEqual(['a', 'b', 'r1', 'c']);
    expect(t.every(x => x.kind === 'resposta')).toBe(true);
    expect(t[0]!.waId).toBe(c[1]!.id);
  });

  it('abertura só quando a PRIMEIRA mensagem da conversa é nossa (robô)', () => {
    const robo = quebrarEmTurnos([msg('robo', 'Oi, aqui é a Helena'), msg('lead', 'oi'), msg('robo', 'tudo bem?')]);
    expect(robo.map(x => x.kind)).toEqual(['abertura', 'resposta']);
    expect(robo[0]!.historico).toEqual([]);
    expect(robo[0]!.real.map(m => m.texto)).toEqual(['Oi, aqui é a Helena']);
    const lead = quebrarEmTurnos([msg('lead', 'oi'), msg('robo', 'oi')]);
    expect(lead.map(x => x.kind)).toEqual(['resposta']);
    const equipe = quebrarEmTurnos([msg('equipe', 'Aqui é o Thiago'), msg('lead', 'oi')]);
    expect(equipe.map(x => x.kind)).toEqual(['resposta']);
  });

  it('dadosDaEpoca tira card, leads_meta e cadastro criados DEPOIS do turno', () => {
    const ms = Date.parse('2026-10-12T13:00:00Z');
    const d = dadosDaEpoca({
      card: { created_at: '2026-10-15T10:00:00Z' } as any,
      leadsMeta: { created_time: '2026-10-11T10:00:00Z' } as any,
      cadastros: [{ created_at: '2026-10-10T10:00:00Z' } as any, { created_at: '2026-10-13T10:00:00Z' } as any],
    }, ms);
    expect(d.card).toBeNull();
    expect(d.leadsMeta).not.toBeNull();
    expect(d.cadastros).toHaveLength(1);
  });
});

describe('replay: a execução', () => {
  it('cada turno vê só o histórico até ali, no horário de época, e grava junto o que foi respondido de verdade', async () => {
    semearConversa();
    // card criado DEPOIS dos turnos: não pode aparecer
    gerador.tabelas.agendamentos = [{ id: 9, cliente_telefone: TEL, vendedor_nome: 'Thiago', status: 'confirmado', created_by: 'lp_eletroposto', created_at: '2026-10-18T10:00:00Z', quando: '2026-10-22T13:00:00Z' }];
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 8, agora: AGORA, cliente: ia.cliente });
    expect(r.ok).toBe(true);
    expect(r.turnosGravados).toBe(3);
    expect(ia.chamadas).toHaveLength(3);

    expect(pedidoDe(ia, 0)).toContain('vim pelo site');
    expect(pedidoDe(ia, 0)).not.toContain('Sou dono do ponto');
    expect(pedidoDe(ia, 0)).not.toContain('E quanto custa');
    expect(pedidoDe(ia, 1)).toContain('Sou dono do ponto');
    expect(pedidoDe(ia, 1)).toContain('Aqui é a Helena.');                       // o histórico real inclui o que nós dissemos
    expect(pedidoDe(ia, 1)).not.toContain('E quanto custa');
    expect(pedidoDe(ia, 0)).toContain('Agora em Brasília: segunda, 12/10, 10h.');  // a época, não hoje
    expect(pedidoDe(ia, 0)).toContain('Card na agenda: nenhum');
    expect(pedidoDe(ia, 0)).toContain('o sistema não trouxe nenhum');              // sem horário livre no replay

    const h64 = hmacDe(CHAVE)!;
    expect(caminhos().sort()).toEqual([
      `turnos/2026-10-12/${h64}/1.json`, `turnos/2026-10-12/${h64}/3.json`, `turnos/2026-10-13/${h64}/5.json`,
    ]);
    const t1 = JSON.parse(banco.objetos.get(`turnos/2026-10-12/${h64}/1.json`)!);
    expect(t1).toMatchObject({ origem: 'replay', kind: 'resposta', dona: 'helena', passo: 6, persona: 'helena', falou: true, n_historico: 1 });
    expect(t1.real.map((m: any) => m.texto)).toEqual(['Oi! Aqui é a Helena.']);
    const t3 = JSON.parse(banco.objetos.get(`turnos/2026-10-13/${h64}/5.json`)!);
    expect(t3.real).toEqual([]);

    expect(escritasProibidas(banco)).toEqual([]);
    expect(escritasProibidas(gerador)).toEqual([]);
    for (const k of (banco.tabelas.system_state ?? []).map(l => l.key)) {
      expect(k).not.toContain(CHAVE);
      expect(k.startsWith('ia_falha')).toBe(false);
    }
  });

  it('rodar de novo não gasta nada: o que já está gravado é pulado', async () => {
    semearConversa();
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    await runReplay({ desde: DESDE, ate: ATE, agora: AGORA, cliente: ia.cliente });
    const antes = ia.chamadas.length;
    zerarCacheArmazem();
    const r2 = await runReplay({ desde: DESDE, ate: ATE, agora: new Date(AGORA.getTime() + 10 * 60_000), cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(antes);
    expect(r2.turnosJaExistiam).toBe(3);
    expect(r2.turnosGravados).toBe(0);
  });

  it('os dados do turno anterior qualificam a Helena no turno seguinte (o valor passa), os do próprio turno não', async () => {
    semearConversa();
    banco.tabelas.wa_mensagens![2]!.texto = 'Pode ser';                           // o lead NÃO diz imóvel, padrão nem vagas no texto
    let n = 0;
    const ia = iaFalsa(() => {
      n++;
      if (n === 1) return respostaIA(saidaJson([FALA], { dados: [{ chave: 'imovel', valor: 'dono' }, { chave: 'padrao', valor: 'trifasico' }, { chave: 'vagas', valor: '3' }] }));
      return respostaIA(saidaJson(['O de 60 kW sai por R$ 135 mil. Quer marcar com o Thiago?']));
    });
    const r = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 3, agora: AGORA, cliente: ia.cliente });
    expect(r.turnos[0]).toMatchObject({ falou: true });
    expect(r.turnos[1]).toMatchObject({ falou: true });                            // turno 2: valor liberado pelos dados do turno 1
  });

  it('iniciativa de abertura: a conversa que COMEÇA por nós ganha o turno 0; a que começa pelo lead não', async () => {
    banco.tabelas.wa_mensagens = [
      wa(1, 'robo', 'Oi, aqui é a Helena. O ponto é seu?', '2026-10-12T13:00:00+00:00'),
      wa(2, 'lead', 'É meu sim', '2026-10-12T13:10:00+00:00'),
    ];
    gerador.tabelas.eletroposto_nota1 = [{ id: 1, nome: 'Tadeu', telefone: TEL, cidade: 'Araguari', created_at: '2026-10-10T12:00:00Z' }];
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, agora: AGORA, cliente: ia.cliente });
    expect(r.turnos.map(t => t.kind)).toEqual(['abertura', 'resposta']);
    expect(r.turnos[0]).toMatchObject({ falou: true });                            // a trava deixou a abertura passar
    const t0 = JSON.parse(banco.objetos.get(`turnos/2026-10-12/${hmacDe(CHAVE)}/1.json`)!);
    expect(t0).toMatchObject({ kind: 'abertura', n_historico: 0, entrada: [] });
    expect(t0.real.map((m: any) => m.texto)).toEqual(['Oi, aqui é a Helena. O ponto é seu?']);

    // sem a abertura liberada (conversa que começa pelo lead e já tem fala nossa), a mesma situação é barrada
    banco = novoBanco(); h.principal = banco; zerarCacheArmazem();
    banco.tabelas.wa_mensagens = [wa(1, 'lead', 'Oi', '2026-10-12T13:00:00+00:00')];
    const r2 = await runReplay({ desde: DESDE, ate: ATE, agora: AGORA, cliente: ia.cliente });
    expect(r2.turnos.every(t => t.kind === 'resposta')).toBe(true);
  });

  it('humano da época cala o turno; pausa aberta HOJE não cala o passado', async () => {
    semearConversa();
    banco.tabelas.wa_mensagens!.splice(1, 0, wa(20, 'equipe', 'Aqui é o Thiago, já te atendo', '2026-10-12T12:50:00+00:00'));
    banco.tabelas.atendimento_pausa = [];
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: AGORA, cliente: ia.cliente });
    expect(r.turnos[0]).toMatchObject({ passo: 1, persona: null });
    expect(ia.chamadas).toHaveLength(0);

    // conversa sem humano na época, mas com pausa aberta hoje
    banco = novoBanco(); h.principal = banco; zerarCacheArmazem();
    semearConversa();
    banco.tabelas.atendimento_pausa = [{ chave: CHAVE, liberado_em: null, ultima_fala_humano: AGORA.toISOString(), ultima_fala_lead: AGORA.toISOString() }];
    const r2 = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: AGORA, cliente: ia.cliente });
    expect(r2.turnos[0]).toMatchObject({ persona: 'helena', falou: true });
  });
});

describe('replay: interruptor, teto e dry', () => {
  it('desligado = nenhuma leitura e nenhuma chamada', async () => {
    delete process.env.AGENTES5040_REPLAY;
    process.env.AGENTES5040_REPLAY = '0';
    semearConversa();
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, agora: AGORA, cliente: ia.cliente });
    expect(r.ligado).toBe(false);
    expect(banco.leituras).toEqual([]);
    expect(ia.chamadas).toHaveLength(0);
  });

  it('teto PRÓPRIO do replay: as vagas do vivo não contam, e ao estourar nada mais é chamado', async () => {
    semearConversa();
    process.env.AGENTES5040_TETO_REPLAY = '2';
    banco.tabelas.system_state = Array.from({ length: 150 }, (_, i) => ({ key: `ag5040_ia:vivo:2026-10-20:${i + 1}`, value: {} }));
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 8, agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(2);
    expect(r.parou).toBe('teto');
    expect(r.turnosGravados).toBe(2);                                              // o 3º turno não foi gravado como "calou"
    delete process.env.AGENTES5040_TETO_REPLAY;
  });

  it('crédito zerado no replay abre o disjuntor e para, sem ia_falha', async () => {
    semearConversa();
    const ia = iaFalsa(() => { throw new Error('Your credit balance is too low'); });
    const r = await runReplay({ desde: DESDE, ate: ATE, agora: AGORA, cliente: ia.cliente });
    expect(r.parou).toBe('disjuntor');
    expect(caminhos()).toEqual([]);
    const chaves = (banco.tabelas.system_state ?? []).map(l => l.key);
    expect(chaves).toContain('ag5040_disjuntor');
    expect(chaves.some(k => k.startsWith('ia_falha'))).toBe(false);
  });

  it('dry com o interruptor desligado: usa o modelo, devolve o uso por turno (cache criado e lido) e não grava', async () => {
    delete process.env.AGENTES5040_REPLAY;
    semearConversa();
    let n = 0;
    const ia = iaFalsa(() => { n++; return respostaIA(saidaJson([FALA]), n === 1 ? { cache_creation_input_tokens: 800 } : { cache_read_input_tokens: 800 }); });
    const r = await runReplay({ desde: DESDE, ate: ATE, maxConversas: 1, maxTurnos: 2, dry: true, agora: AGORA, cliente: ia.cliente });
    expect(r.ligado).toBe(true);
    expect(r.turnos).toHaveLength(2);
    expect(r.turnos[0]!.uso!.cache_criado).toBeGreaterThan(0);
    expect(r.turnos[1]!.uso!.cache_lido).toBeGreaterThan(0);
    expect(r.turnos.map(t => t.persona)).toEqual(['helena', 'helena']);
    expect(caminhos()).toEqual([]);
    expect((banco.tabelas.system_state ?? []).filter(l => String(l.key).startsWith('ag5040_lock'))).toEqual([]);
  });

  it('o dry nunca passa de 1 conversa e 2 turnos, mesmo pedindo mais', async () => {
    delete process.env.AGENTES5040_REPLAY;
    semearConversa();
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, maxConversas: 9, maxTurnos: 9, dry: true, agora: AGORA, cliente: ia.cliente });
    expect(r.turnos).toHaveLength(2);
    expect(ia.chamadas).toHaveLength(2);
    expect(r.conversasProcessadas).toBe(1);
  });

  it('leitura do anúncio falhou: o turno cala com o motivo do anúncio', async () => {
    semearConversa();
    banco.tabelas.wa_mensagens![0]!.webhook_debug_id = 'isto-nao-e-um-uuid';
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: AGORA, cliente: ia.cliente });
    expect(r.turnos[0]).toMatchObject({ passo: 'falha', persona: null });
    expect(r.turnos[0]!.motivo).toMatch(/anúncio/);
    expect(ia.chamadas).toHaveLength(0);
  });

  it('janela inválida e sem instância não rodam', async () => {
    semearConversa();
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const a = await runReplay({ desde: ATE, ate: DESDE, agora: AGORA, cliente: ia.cliente });
    expect(a.ok).toBe(false);
    delete process.env.ZAPI_INSTANCE_ID_IO;
    const b = await runReplay({ desde: DESDE, ate: ATE, agora: AGORA, cliente: ia.cliente });
    expect(b.ok).toBe(false);
    expect(ia.chamadas).toHaveLength(0);
  });
});

describe('replay: o card da época, não o de hoje', () => {
  const card = (id: number, extra: Record<string, unknown>) => ({
    id, cliente_telefone: TEL, vendedor_nome: 'Thiago', status: 'confirmado', created_by: 'lp_eletroposto',
    created_at: '2026-10-10T12:00:00Z', quando: '2026-10-22T13:00:00Z', observacao: null, cidade: 'Araguari', ...extra,
  });

  it('cardDaEpoca escolhe o mais novo criado ANTES do turno e apaga o que muda depois', () => {
    const ms = Date.parse('2026-10-12T13:00:00Z');
    const c = cardDaEpoca([
      card(3, { created_at: '2026-10-18T10:00:00Z', vendedor_nome: 'Diego' }) as any,
      card(2, { created_at: '2026-10-11T10:00:00Z', status: 'vendido', observacao: 'OBS-DE-HOJE' }) as any,
      card(1, { created_at: '2026-10-01T10:00:00Z' }) as any,
    ], ms)!;
    expect(c.id).toBe(2);
    expect(c.status).toBeNull();
    expect(c.quando).toBeNull();
    expect(c.observacao).toBeNull();
    expect(c.vendedor_nome).toBe('Thiago (pode ter mudado)');
    expect(cardDaEpoca([card(3, { created_at: '2026-10-18T10:00:00Z' }) as any], ms)).toBeNull();
  });

  it('o turno antigo não vê o status VENDIDO de hoje, nem a observação, nem o card criado depois', async () => {
    semearConversa();
    gerador.tabelas.agendamentos = [
      card(2, { created_at: '2026-10-11T10:00:00Z', status: 'vendido', observacao: 'OBS-DE-HOJE', vendedor_nome: 'Nilce' }),
      card(3, { created_at: '2026-10-18T10:00:00Z', status: 'confirmado', vendedor_nome: 'Diego', cliente_nome: 'Outro' }),
    ];
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: AGORA, cliente: ia.cliente });
    const pedido = pedidoDe(ia, 0);
    expect(pedido.toLowerCase()).not.toContain('vendido');
    expect(pedido).not.toContain('OBS-DE-HOJE');
    expect(pedido).not.toContain('Diego');
    expect(pedido).toContain('Nilce (pode ter mudado)');
    expect(pedido).toContain('Marcado para: sem data no card.');
  });
});

describe('replay: resposta da rota sem texto, janela truncada, falha avulsa', () => {
  it('o relatório não leva bolhas nem texto do lead', async () => {
    semearConversa();
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: AGORA, cliente: ia.cliente });
    const json = JSON.stringify(r);
    expect(json).not.toContain('Aqui é a Helena');
    expect(json).not.toContain('vim pelo site');
    expect(json).not.toContain('"bolhas"');
    expect(r.turnos[0]).toMatchObject({ falou: true, n_bolhas: 1, tamanho: FALA.length });
    expect(r.janelaTruncada).toBe(false);
  });

  it('janela que passa do teto de leitura vem marcada', async () => {
    banco.tabelas.wa_mensagens = [];
    for (let i = 0; i < 5001; i++) {
      banco.tabelas.wa_mensagens.push({ id: i + 1, instancia: 'inst-io', telefone: `55349911${String(10000 + (i % 40)).padStart(5, '0')}`, is_group: false, from_me: false, tipo: 'texto', momment: new Date(Date.UTC(2026, 9, 13, 10, 0, 0) + i * 1000).toISOString() });
    }
    const ia = iaFalsa(() => respostaIA(saidaJson([FALA])));
    const r = await runReplay({ desde: DESDE, ate: ATE, dry: true, agora: AGORA, cliente: ia.cliente });
    expect(r.janelaTruncada).toBe(true);
    expect(r.motivo).toMatch(/mais recentes/);
  });

  it('falha avulsa: a primeira não grava e pula; a segunda grava o turno como falhou', async () => {
    semearConversa();
    const ia = iaFalsa(() => { throw new Error('400 invalid_request_error: bad request'); });
    const r1 = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: AGORA, cliente: ia.cliente });
    expect(r1.puladas.ia_indisponivel).toBe(1);
    expect(caminhos()).toEqual([]);
    const r2 = await runReplay({ desde: DESDE, ate: ATE, maxTurnos: 1, agora: new Date(AGORA.getTime() + 10 * 60_000), cliente: ia.cliente });
    expect(r2.turnos[0]).toMatchObject({ falou: false, persona: 'helena' });
    expect(r2.turnos[0]!.motivo).toMatch(/IA não respondeu/);
    expect(caminhos()).toHaveLength(1);
  });
});
