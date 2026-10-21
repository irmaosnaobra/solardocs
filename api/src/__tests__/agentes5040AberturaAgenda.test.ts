import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A ABERTURA do card do quiz solar (21/10/2026), pela fila de agenda da Duda. Duas metades:
//  1. as bolhas fixas (textosAgenda.ts): os 3 caminhos, com e sem nome, e o corte dos 160 caracteres;
//  2. a varredura da rodada viva (vivo.ts, abrirCardsDoQuiz): ordem bolha > reserva > posse > fila, o desfazer quando a fila não gravou,
//     os pulos (posse, 11 min, fora das 7h-21h, fora do escopo, sem horário), o dry e o máximo de 3 por rodada.
// A entrega da fila (janela, pausa humana, linha caída, card mudado) é provada em agentes5040AgendaEnvio.test.ts.
// Banco falso em memória, a fila (enfileirarAgenda) trocada por um mock que registra o estado NA HORA da chamada: nada alcança a rede.
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
  enfileirar: vi.fn(),
  ordem: [] as string[],
  visto: null as null | { cardReservado: string | null; posse: boolean },
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ enviarResposta: (...a: unknown[]) => h.enviar(...a) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: async () => ({ ok: true, mapa: new Map([['diego', '34991360172']]) }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: () => false,
  linhaIoEmCooldown: () => false,
  leadEhDeTeste: async () => false,
  telefoneDoConsultor: () => null,
  telefoneDoDono: () => '34900000000',
  tetoDaLinhaPermiteFicha: async () => 'ok',
}));
vi.mock('../services/agentes5040/agendaEnvio', () => ({
  enfileirarAgenda: (...a: unknown[]) => h.enfileirar(...a),
  bolhaDeConfirmacao: () => null,
  chaveFila: (id: number, tipo: string, quando: string) => `ag5040_agenda_fila:${id}:${tipo}:${quando}`,
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { runVivoTick, LIMITES_ABERTURA } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { bolhaDeAbertura, textoDeAbertura, MAX_BOLHA_ABERTURA } from '../services/agentes5040/textosAgenda';
import { SISTEMA_FIXO_DUDA, fatosDuda } from '../services/agentes5040/personas/duda';
import { logger } from '../utils/logger';

// ── 1. as bolhas fixas ───────────────────────────────────────────────────────

const AGORA_TXT = '2026-10-21T15:00:00.000Z';            // quarta 12:00 em Brasília
const AMANHA_1430 = '2026-10-22T17:30:00.000Z';           // quinta, 14h30 em Brasília: "amanhã às 14h30"
const QUINTA_23_1430 = '2026-10-23T17:30:00.000Z';        // sexta 23/10... (para o texto longo "sexta, 23/10 às 14h30")

describe('abertura: as bolhas fixas (textosAgenda)', () => {
  const quando = 'amanhã às 14h30';

  it('ligacao, video e vistoria, COM nome, com o texto exato', () => {
    expect(textoDeAbertura('ligacao', 'Irineu de Almeida', quando, 'Giovanna Souza')).toBe(
      'Oi, Irineu! Sou a Duda, da Irmãos na Obra. Já está marcado: *Giovanna* te liga *amanhã às 14h30*. É uma ligação curta para entender sua conta.');
    expect(textoDeAbertura('video', 'Irineu', quando, 'Nilce')).toBe(
      'Oi, Irineu! Sou a Duda, da Irmãos na Obra. Marcado: *Nilce* te chama por vídeo amanhã às 14h30, com o estudo na tela. Responda SIM para confirmar.');
    expect(textoDeAbertura('vistoria', 'Irineu', quando, 'Diego')).toBe(
      'Oi, Irineu! Sou a Duda, da Irmãos na Obra. Marcado: *Diego* vai aí amanhã às 14h30, visita técnica de uns 40 minutos. Responda SIM para confirmar.');
  });

  it('SEM nome (vazio, só símbolo ou só espaço), começa com "Oi! Sou a Duda"', () => {
    for (const nome of [null, undefined, '', '   ', '***', '123']) {
      expect(textoDeAbertura('ligacao', nome, quando, 'Giovanna')).toBe(
        'Oi! Sou a Duda, da Irmãos na Obra. Já está marcado: *Giovanna* te liga *amanhã às 14h30*. É uma ligação curta para entender sua conta.');
    }
    expect(textoDeAbertura('video', '', quando, 'Nilce')!.startsWith('Oi! Sou a Duda, da Irmãos na Obra. Marcado: *Nilce* te chama por vídeo')).toBe(true);
    expect(textoDeAbertura('vistoria', '', quando, 'Diego')!.startsWith('Oi! Sou a Duda, da Irmãos na Obra. Marcado: *Diego* vai aí')).toBe(true);
  });

  it('o nome não leva formatação do WhatsApp (asterisco, sublinhado) para dentro da bolha', () => {
    expect(textoDeAbertura('video', '*Irineu*', quando, 'Nilce')!.startsWith('Oi, Irineu! ')).toBe(true);
  });

  it('o horário é montado a partir do ISO: hoje, amanhã e dia da semana com data', () => {
    expect(bolhaDeAbertura('ligacao', 'Ana', AMANHA_1430, 'Nilce', AGORA_TXT)).toContain('te liga *amanhã às 14h30*');
    expect(bolhaDeAbertura('ligacao', 'Ana', '2026-10-21T19:00:00.000Z', 'Nilce', AGORA_TXT)).toContain('te liga *hoje às 16h*');
    expect(bolhaDeAbertura('vistoria', 'Ana', QUINTA_23_1430, 'Nilce', AGORA_TXT)).toContain('vai aí sexta, 23/10 às 14h30,');
  });

  it('corte de tamanho: passou de 160 tira o nome; ainda passou, tira os asteriscos; ainda passou, é null', () => {
    const q = 'quinta, 23/10 às 14h30';
    // 156 com nome de 6 letras e consultora de 8
    const normal = textoDeAbertura('vistoria', 'Irineu', q, 'Giovanna')!;
    expect(normal.length).toBe(156);
    expect(normal.startsWith('Oi, Irineu!')).toBe(true);
    // nome de 11 letras: 161 com nome, então sai sem nome (148), ainda com asteriscos
    const semNome = textoDeAbertura('vistoria', 'Maximiliano', q, 'Giovanna')!;
    expect(semNome.startsWith('Oi! Sou a Duda')).toBe(true);
    expect(semNome).toContain('*Giovanna*');
    expect(semNome.length).toBe(148);
    // consultora de 22 letras: sem nome e com asteriscos dá 162, sem asteriscos dá 160
    const consultora22 = 'M' + 'a'.repeat(21);
    const semAsteriscos = textoDeAbertura('vistoria', 'Irineu', q, consultora22)!;
    expect(semAsteriscos).not.toContain('*');
    expect(semAsteriscos.startsWith('Oi! Sou a Duda')).toBe(true);
    expect(semAsteriscos.length).toBe(MAX_BOLHA_ABERTURA);
    // consultora de 23 letras: nem assim cabe
    expect(textoDeAbertura('vistoria', 'Irineu', q, 'M' + 'a'.repeat(22))).toBeNull();
    // nunca passa de 160 em nenhum dos 3 caminhos
    for (const c of ['ligacao', 'video', 'vistoria']) {
      const t = textoDeAbertura(c, 'Maximiliano', q, 'Giovanna');
      if (t) expect(t.length).toBeLessThanOrEqual(MAX_BOLHA_ABERTURA);
    }
  });

  it('caminho que não existe, consultora vazia ou horário vazio = null (nada é enfileirado)', () => {
    expect(textoDeAbertura('curioso', 'Ana', quando, 'Nilce')).toBeNull();
    expect(textoDeAbertura(undefined, 'Ana', quando, 'Nilce')).toBeNull();
    expect(textoDeAbertura('ligacao', 'Ana', quando, '')).toBeNull();
    expect(textoDeAbertura('ligacao', 'Ana', '', 'Nilce')).toBeNull();
    expect(bolhaDeAbertura('ligacao', 'Ana', 'ontem', 'Nilce', AGORA_TXT)).toBeNull();
  });

  it('nenhuma bolha leva travessão', () => {
    for (const c of ['ligacao', 'video', 'vistoria']) {
      for (const n of ['Irineu', '']) expect(textoDeAbertura(c, n, quando, 'Giovanna')).not.toMatch(/[—–]/);
    }
  });
});

// ── 2. a varredura da rodada viva ────────────────────────────────────────────

const AGORA = new Date('2026-10-20T15:00:00.000Z');                       // terça, 12:00 em Brasília
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MIN = 60_000;
const QUANDO = '2026-10-21T17:30:00.000Z';                                // amanhã, 14h30 em Brasília

const telDe = (i: number): string => `55349911${String(1000 + i).padStart(5, '0')}`;
const chaveDe = (i: number): string => `34${telDe(i).slice(-8)}`;

let banco: BancoFalso;
let gerador: BancoFalso;

const LINHA_QUIZ = (c: 'ligacao' | 'video' | 'vistoria'): string =>
  `LP SOLAR QUIZ · Casa · ${c === 'vistoria' ? 'VISTORIA PRESENCIAL' : c === 'video' ? 'ATENDIMENTO ONLINE' : 'LIGAÇÃO'}`;

function card(i: number, extra: Record<string, unknown> = {}, caminho: 'ligacao' | 'video' | 'vistoria' = 'ligacao') {
  const c = {
    id: 500 + i, cliente_nome: 'Irineu de Almeida', cliente_telefone: telDe(i), quando: QUANDO, vendedor_nome: 'Giovanna Souza',
    observacao: `${LINHA_QUIZ(caminho)}\nConta de luz: R$ 600`, created_by: 'lp_solar', status: 'agendado',
    created_at: iso(2 * MIN), boas_vindas_at: null, ...extra,
  };
  (gerador.tabelas.agendamentos ??= []).push(c);
  return c;
}
const cardNoBanco = (i: number) => gerador.tabelas.agendamentos!.find(c => c.id === 500 + i)!;
const posseDe = (i: number) => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === chaveDe(i) && l.tipo === 'ag5040');

function semearPosse(i: number, dona = 'duda') {
  (banco.tabelas.whatsapp_sessions ??= []).push({
    phone: chaveDe(i), tipo: 'ag5040',
    lead_data: { dona, estado: 'viva', desde: iso(60 * MIN), ate_wa_id: 3, respostas: 1, imagens: [], links: [] },
  });
}

function alvo(hmacs: string[], modos: Record<string, string> = {}) {
  banco.tabelas.system_state = [
    ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs, modos, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}
const noEscopo = (...is: number[]) => alvo(is.map(i => hmacDe(chaveDe(i))!));
/** Modo 'todos' (a lista de teste vale no máximo 3 leads): a Duda atende qualquer um. */
const escopoTodos = () => { (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).push('duda'); alvo([], { duda: 'todos' }); };

let ia = iaFalsa(() => respostaIA(saidaJson(['x'])));
const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });

/** Anota a ordem das escritas dos dois bancos e o fim de cada chamada da fila. */
function medirOrdem() {
  for (const [nome, b] of [['gerador', gerador], ['principal', banco]] as const) {
    b.escritas.push = (...e) => { for (const x of e) if (x.tabela !== 'system_state') h.ordem.push(`${nome}:${x.tabela}:${x.op}`); return Array.prototype.push.call(b.escritas, ...e); };
  }
}

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador; h.ordem = [];
  h.enviar.mockReset().mockResolvedValue({ ok: false, motivo: 'dry' });
  h.ficha.mockReset().mockResolvedValue(undefined);
  // A fila falsa grava o ESTADO do mundo na hora da chamada: é daí que sai a prova da ordem.
  h.enfileirar.mockReset().mockImplementation(async (p: any) => {
    h.ordem.push('fila');
    h.visto = { cardReservado: cardNoBanco(p.cardId - 500)?.boas_vindas_at ?? null, posse: !!posseDe(p.cardId - 500) };
    return { ok: true, chave: `ag5040_agenda_fila:${p.cardId}:abertura:x` };
  });
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  zerarCacheArmazem(); zerarCacheInterruptores();
  ia = iaFalsa(() => respostaIA(saidaJson(['x'])));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(logger.error).mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_DUDA_VIVO;
  (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0;
});

describe('abertura: o caminho feliz (bolha > reserva > posse > fila)', () => {
  it('a ordem é reserva, posse, fila; na hora da fila o card já está reservado e a posse já existe; sem IA e sem envio direto', async () => {
    card(0); noEscopo(0); medirOrdem();
    const r = await rodar();
    expect(h.ordem).toEqual(['gerador:agendamentos:update', 'principal:whatsapp_sessions:insert', 'fila']);
    expect(h.visto!.cardReservado).toBeTruthy();
    expect(h.visto!.posse).toBe(true);
    expect(r.abertura).toMatchObject({ vistos: 1, tentados: 1, abertos: 1, puladas: {} });
    expect(ia.chamadas).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(cardNoBanco(0).boas_vindas_at).toBeTruthy();
    expect(posseDe(0)!.lead_data).toMatchObject({ dona: 'duda', estado: 'viva', ate_wa_id: null, respostas: 0 });
  });

  it('o pedido da fila leva o tipo abertura, o card, o telefone, o horário como validade, a consultora, o caminho e o primeiro nome', async () => {
    card(0, {}, 'vistoria'); noEscopo(0);
    await rodar();
    expect(h.enfileirar).toHaveBeenCalledTimes(1);
    const [pedido] = h.enfileirar.mock.calls[0]!;
    expect(pedido).toEqual({
      tipo: 'abertura', cardId: 500, telefone: telDe(0), quando: QUANDO, validoAte: QUANDO, consultora: 'Giovanna', caminho: 'vistoria', nome: 'Irineu',
    });
  });

  it('os 3 caminhos do card chegam à fila com o caminho certo (ligação, vídeo, vistoria)', async () => {
    card(0, {}, 'ligacao'); card(1, {}, 'video'); card(2, {}, 'vistoria'); noEscopo(0, 1, 2);
    await rodar();
    expect(h.enfileirar.mock.calls.map(c => c[0].caminho)).toEqual(['ligacao', 'video', 'vistoria']);
  });

  it('a Duda não está na rodada (nenhuma dona ligada): a varredura nem lê o banco do Gerador', async () => {
    process.env.AGENTES5040_DUDA_VIVO = '0';
    card(0); noEscopo(0);
    const r = await rodar();
    expect(r.ligado).toBe(false);
    expect(r.abertura).toBeUndefined();
    expect(gerador.leituras).toEqual([]);
    expect(h.enfileirar).not.toHaveBeenCalled();
  });

  it('só Helena ligada: sem varredura da abertura (a abertura é da Duda)', async () => {
    process.env.AGENTES5040_DUDA_VIVO = '0'; process.env.AGENTES5040_HELENA_VIVO = '1';
    card(0); noEscopo(0);
    const r = await rodar();
    expect(r.abertura).toBeUndefined();
    expect(h.enfileirar).not.toHaveBeenCalled();
    expect(gerador.escritas.length).toBe(0);
  });
});

describe('abertura: a fila não gravou = reserva e posse desfeitas', () => {
  for (const motivo of ['erro', 'bolha_invalida', 'pedido_invalido'] as const) {
    it(`fila recusa (${motivo}): devolve boas_vindas_at, apaga a posse criada agora e registra`, async () => {
      card(0); noEscopo(0); medirOrdem();
      h.enfileirar.mockImplementationOnce(async () => { h.ordem.push('fila'); return { ok: false, motivo }; });
      const r = await rodar();
      expect(h.ordem).toEqual([
        'gerador:agendamentos:update', 'principal:whatsapp_sessions:insert', 'fila', 'principal:whatsapp_sessions:delete', 'gerador:agendamentos:update',
      ]);
      expect(cardNoBanco(0).boas_vindas_at).toBeNull();
      expect(posseDe(0)).toBeUndefined();
      expect(r.abertura).toMatchObject({ tentados: 1, abertos: 0, puladas: { [`fila_recusou_${motivo}`]: 1 } });
    });
  }

  it('o enfileirar lançou (defesa: o real nunca lança): vira erro, a releitura da fila não acha o item e desfaz', async () => {
    card(0); noEscopo(0);
    h.enfileirar.mockRejectedValueOnce(new Error('boom'));
    const r = await rodar();
    expect(cardNoBanco(0).boas_vindas_at).toBeNull();
    expect(posseDe(0)).toBeUndefined();
    expect(r.abertura!.abertos).toBe(0);
  });

  it('ja_enviado (o carimbo da abertura existe): a abertura SAIU, então nada é desfeito', async () => {
    card(0); noEscopo(0);
    h.enfileirar.mockResolvedValueOnce({ ok: false, motivo: 'ja_enviado' });
    const r = await rodar();
    expect(cardNoBanco(0).boas_vindas_at).toBeTruthy();
    expect(posseDe(0)).toBeDefined();
    expect(r.abertura!.puladas).toEqual({ abertura_ja_enviada: 1 });
  });

  it('depois de enfileirado, nada desfaz (nem em rodada seguinte): a reserva e a posse ficam', async () => {
    card(0); noEscopo(0);
    await rodar();
    const antes = cardNoBanco(0).boas_vindas_at;
    await rodar();
    expect(cardNoBanco(0).boas_vindas_at).toBe(antes);
    expect(posseDe(0)).toBeDefined();
    expect(h.enfileirar).toHaveBeenCalledTimes(1);         // a segunda rodada vê card reservado e posse: não repete
  });

  it('a reserva perdida (outra rodada pegou o card) não assume posse nem enfileira', async () => {
    card(0); noEscopo(0);
    // outra rodada reserva o card entre a leitura da varredura e o UPDATE: a troca acontece no 2º acesso ao banco do Gerador.
    const orig = gerador.cliente.from;
    let acessos = 0;
    gerador.cliente.from = (nome: string) => {
      acessos++;
      if (nome === 'agendamentos' && acessos === 2) cardNoBanco(0).boas_vindas_at = iso(1000);
      return orig(nome);
    };
    const r = await rodar();
    expect(h.enfileirar).not.toHaveBeenCalled();
    expect(posseDe(0)).toBeUndefined();
    expect(r.abertura!.puladas).toEqual({ reserva_perdida: 1 });
  });

  it('a posse não foi assumida (já tinha dona): devolve a reserva e não enfileira', async () => {
    card(0); noEscopo(0);
    // a posse nasce entre a leitura e o INSERT: o banco falso não tem índice único, então o insert da posse é forçado a falhar com 23505
    const orig = banco.cliente.from;
    banco.cliente.from = (nome: string) => {
      const q = orig(nome);
      if (nome === 'whatsapp_sessions') {
        const insert = q.insert;
        q.insert = () => { const b = insert({}); b.then = (ok: any) => Promise.resolve({ data: null, error: { code: '23505' } }).then(ok); return b; };
      }
      return q;
    };
    const r = await rodar();
    expect(h.enfileirar).not.toHaveBeenCalled();
    expect(cardNoBanco(0).boas_vindas_at).toBeNull();
    expect(r.abertura!.puladas).toEqual({ posse_tomada_agora: 1 });
  });
});

describe('abertura: quem não recebe', () => {
  it('card de um lead que JÁ tem posse (da Duda ou de outra dona) = pula, sem escrever nada', async () => {
    card(0); card(1); semearPosse(0, 'duda'); semearPosse(1, 'helena'); noEscopo(0, 1);
    const r = await rodar();
    expect(r.abertura).toMatchObject({ vistos: 2, tentados: 0, abertos: 0, puladas: { com_posse: 2 } });
    expect(h.enfileirar).not.toHaveBeenCalled();
    expect(gerador.escritas.length).toBe(0);
    expect(cardNoBanco(0).boas_vindas_at).toBeNull();
  });

  it('card criado há 11 minutos = pula (o tick antigo cobre depois dos 15)', async () => {
    card(0, { created_at: iso(11 * MIN) }); card(1, { created_at: iso(10 * MIN - 1000) }); noEscopo(0, 1);
    const r = await rodar();
    expect(h.enfileirar.mock.calls.map(c => c[0].cardId)).toEqual([501]);
    expect(r.abertura!.abertos).toBe(1);
    expect(cardNoBanco(0).boas_vindas_at).toBeNull();
    expect(LIMITES_ABERTURA.idadeMs).toBe(10 * MIN);
  });

  it('fora das 7h às 21h em Brasília = nem lê os cards; às 7h e às 20h59 abre', async () => {
    card(0); noEscopo(0);
    const antes = gerador.leituras.length;
    const r6h = await rodar({ agora: new Date('2026-10-20T09:59:00.000Z') });                      // 6h59
    expect(r6h.abertura!.puladas).toEqual({ fora_das_7_as_21: 1 });
    const r21h = await rodar({ agora: new Date('2026-10-21T00:00:00.000Z') });                     // 21h00
    expect(r21h.abertura!.puladas).toEqual({ fora_das_7_as_21: 1 });
    expect(gerador.leituras.length).toBe(antes);
    expect(h.enfileirar).not.toHaveBeenCalled();
    // às 7h exatas: o card tem que ser recente em relação a esse instante
    cardNoBanco(0).created_at = '2026-10-20T10:00:00.000Z';
    const r7h = await rodar({ agora: new Date('2026-10-20T10:01:00.000Z') });
    expect(r7h.abertura!.abertos).toBe(1);
  });

  it('lead fora do escopo da Duda = pula, sem posse nem reserva', async () => {
    card(0); card(1); noEscopo(1);                                                                    // só o 1 está no escopo
    const r = await rodar();
    expect(r.abertura!.puladas).toEqual({ fora_do_escopo: 1 });
    expect(h.enfileirar.mock.calls.map(c => c[0].cardId)).toEqual([501]);
    expect(cardNoBanco(0).boas_vindas_at).toBeNull();
    expect(posseDe(0)).toBeUndefined();
  });

  it('card que não é do quiz, de outra origem, sem consultora, sem horário, com horário passado ou já com boas-vindas = pula', async () => {
    card(0, { observacao: 'Ligar no 34 99111-0000' });                                                // sem a marca do quiz
    card(1, { created_by: 'manychat' });
    card(2, { vendedor_nome: '' });
    card(3, { quando: null });
    card(4, { quando: iso(5 * MIN) });                                                                // horário que já passou
    card(5, { boas_vindas_at: iso(MIN) });
    card(6, { status: 'cancelado' });
    noEscopo(0, 1, 2, 3, 4, 5, 6);
    const r = await rodar();
    expect(h.enfileirar).not.toHaveBeenCalled();
    expect(r.abertura!.abertos).toBe(0);
    expect(gerador.escritas.length).toBe(0);
    expect(banco.escritas.filter(e => e.tabela === 'whatsapp_sessions')).toEqual([]);
  });

  it('bolha que não cabe nos 160 (consultora de nome enorme) = nada reservado, o tick antigo cobre', async () => {
    card(0, { vendedor_nome: 'M' + 'a'.repeat(30) }, 'vistoria'); noEscopo(0);
    const r = await rodar();
    expect(r.abertura).toMatchObject({ tentados: 0, abertos: 0, puladas: { bolha_nao_cabe: 1 } });
    expect(gerador.escritas.length).toBe(0);
    expect(posseDe(0)).toBeUndefined();
    expect(h.enfileirar).not.toHaveBeenCalled();
  });

  it('a conversa de um card que a própria Duda marcou (posse da Duda) recebe a confirmação, nunca a abertura', async () => {
    card(0); semearPosse(0, 'duda'); noEscopo(0);
    await rodar();
    expect(h.enfileirar).not.toHaveBeenCalled();
  });

  it('leitura dos cards falhou = registra e a rodada segue', async () => {
    gerador.falhar.agendamentos = { code: '57014' };
    noEscopo(0);
    const r = await rodar();
    expect(r.ok).toBe(true);
    expect(r.abertura!.puladas).toEqual({ leitura_falhou: 1 });
  });

  it('a varredura não depende do modelo: com o disjuntor aberto ela abre do mesmo jeito', async () => {
    card(0); noEscopo(0);
    banco.tabelas.system_state!.push({ key: 'ag5040_disjuntor', value: { ate: new Date(AGORA.getTime() + 3600_000).toISOString() }, updated_at: iso(MIN) });
    const r = await rodar();
    expect(r.parou).toBe('disjuntor');
    expect(r.abertura!.abertos).toBe(1);
  });
});

describe('abertura: dry e limite por rodada', () => {
  it('dry = nada gravado em lugar nenhum; o relatório traz o card e a bolha que sairiam, sem telefone', async () => {
    card(0, {}, 'video'); noEscopo(0); medirOrdem();
    const r = await rodar({ dry: true });
    expect(h.ordem).toEqual([]);
    expect(gerador.escritas.length).toBe(0);
    expect(banco.escritas.length).toBe(0);
    expect(h.enfileirar).not.toHaveBeenCalled();
    expect(r.abertura!.abertos).toBe(0);
    expect(r.abertura!.sairia).toEqual([{
      card_id: 500,
      bolha: 'Oi, Irineu! Sou a Duda, da Irmãos na Obra. Marcado: *Giovanna* te chama por vídeo amanhã às 14h30, com o estudo na tela. Responda SIM para confirmar.',
    }]);
    expect(JSON.stringify(r.abertura)).not.toContain(telDe(0));
    expect(cardNoBanco(0).boas_vindas_at).toBeNull();
  });

  it('no máximo 3 por rodada; os outros ficam para a próxima, e a próxima abre os que sobraram', async () => {
    for (const i of [0, 1, 2, 3, 4]) card(i);
    escopoTodos();
    const r1 = await rodar();
    expect(LIMITES_ABERTURA.porRodada).toBe(3);
    expect(r1.abertura).toMatchObject({ vistos: 5, tentados: 3, abertos: 3, puladas: { limite_por_rodada: 1 } });
    expect(h.enfileirar.mock.calls.map(c => c[0].cardId)).toEqual([500, 501, 502]);
    expect(cardNoBanco(3).boas_vindas_at).toBeNull();
    const r2 = await rodar();
    expect(r2.abertura).toMatchObject({ abertos: 2 });
    expect(h.enfileirar.mock.calls.map(c => c[0].cardId)).toEqual([500, 501, 502, 503, 504]);
  });

  it('tentativa que a fila recusou conta no limite (3 tentativas, nenhuma aberta)', async () => {
    for (const i of [0, 1, 2, 3]) card(i);
    escopoTodos();
    h.enfileirar.mockResolvedValue({ ok: false, motivo: 'erro' });
    const r = await rodar();
    expect(r.abertura).toMatchObject({ tentados: 3, abertos: 0 });
    expect(h.enfileirar).toHaveBeenCalledTimes(3);
  });
});

describe('abertura: a Duda sabe tratar o SIM (persona)', () => {
  it('o prompt diz que a última mensagem nossa pode ser a confirmação, que o SIM vira 1 bolha de agradecimento e que não marca nem repete o horário', () => {
    expect(SISTEMA_FIXO_DUDA).toContain('A CONFIRMAÇÃO DO HORÁRIO');
    expect(SISTEMA_FIXO_DUDA).toMatch(/última mensagem nossa na conversa for essa confirmação/);
    expect(SISTEMA_FIXO_DUDA).toMatch(/SIM, "confirmado", "ok", "pode ser"/);
    expect(SISTEMA_FIXO_DUDA).toMatch(/UMA bolha curta/);
    expect(SISTEMA_FIXO_DUDA).toMatch(/Nunca marcar_horario nem remarcar por causa do SIM/);
    expect(SISTEMA_FIXO_DUDA).toMatch(/não repita a data nem a hora/);
  });

  it('a regra vem declarada como mais forte que o "Primeira resposta" do roteiro e que o "confirme a data e a hora"', () => {
    const i = SISTEMA_FIXO_DUDA.indexOf('A CONFIRMAÇÃO DO HORÁRIO');
    const secao = SISTEMA_FIXO_DUDA.slice(i, SISTEMA_FIXO_DUDA.indexOf('CURIOSO DO QUIZ'));
    expect(secao).toContain('Vale mais que o ROTEIRO');
    expect(secao).toContain('LIGAÇÃO JÁ MARCADA');
    expect(SISTEMA_FIXO_DUDA).toContain('Primeira resposta');
    expect(secao).not.toMatch(/[—–]/);
    expect(secao).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('os fatos da Duda seguem funcionando com o card recém-aberto', () => {
    const f = fatosDuda({
      chave: '3499111000', nome: 'Irineu', msgs: [], completa: true, card: { id: 1, status: 'agendado', quando: QUANDO, vendedor_nome: 'Giovanna', cliente_nome: 'Irineu', cidade: null, observacao: null, created_by: 'lp_solar', created_at: iso(MIN) },
      leadsMeta: null, cadastros: [], ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: AGORA.toISOString(),
    } as any);
    expect(f).toContain('Giovanna');
  });
});
