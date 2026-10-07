import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O CARD VERMELHO VENCIDO VOLTA PRO DIA SEGUINTE SOZINHO (ordem de 20/08/2026).
//
// Os riscos aqui são de dois tipos, e eles puxam pra lados opostos:
//   · remarcar DEMAIS — em cima do toque de 5 min que ainda estava saindo, por
//     baixo de uma lista de horários que a pessoa ia responder, pra quem já
//     voltou a conversar, pra sempre (sem teto de tentativas), ou pro estoque
//     velho de vermelhos todo de uma vez;
//   · remarcar SEM AVISAR — marcar reunião no calendário do consultor e a pessoa
//     nunca saber, seja porque o teto da linha estourou, seja porque o slot foi
//     vendido no meio do caminho e o robô desistiu calado.

let fichas: any[] = [];
/** (consultor|iso) já ocupados no banco — é o índice único `agendamentos_vq_naosolar_uniq`. */
let ocupados = new Set<string>();
const state = new Map<string, { key: string; value: any; updated_at: string }>();
const apagados: string[] = [];
/** Faz a leitura da rampa do dia falhar, pra provar que ela fecha a porta. */
let rampaQuebrada = false;
/** Faz a leitura da sala de espera falhar. */
let esperaQuebrada = false;
/** Faz a leitura do estado do ciclo (a escada e as voltas) falhar. */
let cicloQuebrado = false;
const updates: Array<{ id: number; patch: any }> = [];

/** Chamado a cada UPDATE de ficha, antes de aplicar. */
let aplicarUpdateGancho: (() => void) | null = null;

function aplicarUpdate(q: any) {
  aplicarUpdateGancho?.();
  const alvo = fichas.find(f => f.id === q._filtros.id);
  if (!alvo) return { data: [], error: null };
  // O `.eq('status','nao_atendeu')` do módulo: corrida com gente.
  if (q._filtros.status && alvo.status !== q._filtros.status) return { data: [], error: null };
  if (q._update.quando && ocupados.has(`${alvo.vendedor_nome}|${q._update.quando}`)) {
    return { data: null, error: { code: '23505', message: 'duplicate key' } };
  }
  Object.assign(alvo, q._update);
  updates.push({ id: alvo.id, patch: q._update });
  return { data: [{ id: alvo.id }], error: null };
}

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _update: null as any,
        _filtros: {} as Record<string, any>,
        select(_cols?: string) { return q._update ? Promise.resolve(aplicarUpdate(q)) : q; },
        eq(col: string, v: any) { q._filtros[col] = v; return q; },
        // Desde 30/09/2026 o módulo busca DOIS status de uma vez
        // (`nao_atendeu` e `agendado`), então a cadeia precisa do `.in`.
        in(col: string, vs: any[]) { q._filtros[`in_${col}`] = vs; return q; },
        // Desde 01/10/2026 a fila deixou de listar O QUE ENTRA e passou a listar
        // o que NÃO entra: destino final e apalavrado. O mock precisa do `.not`.
        not(col: string, _op: string, lista: string) {
          q._filtros[`not_${col}`] = String(lista).replace(/^\(|\)$/g, '').split(',');
          return q;
        },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        lte(col: string, v: any) { q._filtros[`lte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          const piso = new Date(q._filtros['gte_quando']).getTime();
          const teto = new Date(q._filtros['lte_quando']).getTime();
          return Promise.resolve({
            // CÓPIA, não a linha viva: é assim que dá pra simular a corrida com
            // gente (alguém muda o status entre a leitura e a gravação).
            data: fichas.filter(f =>
              (q._filtros['not_status']
                ? !(q._filtros['not_status'] as string[]).includes(f.status)
                : q._filtros['in_status']
                  ? (q._filtros['in_status'] as string[]).includes(f.status)
                  : (!q._filtros['status'] || f.status === q._filtros['status']))
              && new Date(f.quando).getTime() >= piso
              && new Date(f.quando).getTime() <= teto).map(f => ({ ...f })),
            error: null,
          });
        },
        // `update(...).eq('id', x)` sem `.select()` é awaited direto (o
        // `confirmacao_at` do fim). Sem isto o await nunca resolveria.
        then(ok: any, falha: any) {
          return Promise.resolve(q._update ? aplicarUpdate(q) : { data: null, error: null }).then(ok, falha);
        },
      };
      return q;
    },
  },
}));

// ── O MOCK DO `system_state` CORTA E ORDENA COMO O SERVIDOR (07/10/2026) ─────
//
// Era um mock de formas fixas (`.like().limit()`, `.like().gte().limit()`) que
// devolvia TUDO, na ordem de inserção. Com ele, ler "sem ordem e com limit 1000"
// e ler "o mais recente" davam o mesmo resultado, e o freio da cadência podia
// abrir calado em produção com o teste verde. Agora ele é um construtor de
// consulta de verdade:
//   · `.order()` ordena de fato, e sem ele a ordem é a de inserção;
//   · a resposta nunca passa de 1000 linhas, pedindo mais ou não (o `max-rows`
//     do PostgREST);
//   · `insert` em chave que já existe devolve 23505, que é o que faz o claim;
//   · `value->>campo` lê o campo do JSON como texto, igual ao Postgres.
const MAX_ROWS = 1000;
/** Chamado depois de cada `insert` que entrou: é por aqui que o teste mexe no
 *  relógio ENTRE o claim de um tick e o do outro. */
let aoInserir: ((chave: string) => void) | null = null;
// Insert que falha por rede (não é 23505): o claim da vez não pode calar o vermelho.
let falhaInsert: ((chave: string) => boolean) | null = null;
/** Chamado a cada leitura de coluna: um `throw` aqui faz quebrar só a consulta
 *  que filtra por aquela coluna. */
let colunaDeGancho: ((col: string) => void) | null = null;

function colunaDe(r: any, col: string): any {
  colunaDeGancho?.(col);
  const json = /^(\w+)->>(\w+)$/.exec(col);
  if (json) {
    const v = r?.[json[1]!]?.[json[2]!];
    return v === undefined || v === null ? null : String(v);
  }
  return r?.[col];
}

function consultaSystemState() {
  const filtros: Array<(r: any) => boolean> = [];
  let op: 'select' | 'insert' | 'upsert' | 'delete' = 'select';
  let linha: any = null;
  let opcoes: any = null;
  let chavesIn: string[] | null = null;
  let chaveEq: string | null = null;
  const likes: string[] = [];
  let ordem: { col: string; asc: boolean } | null = null;
  let limite = Infinity;
  let unica = false;

  const executar = () => {
    if (op === 'insert') {
      if (falhaInsert?.(linha.key)) return { data: null, error: { code: 'PGRST000', message: 'rede caiu' } };
      if (state.has(linha.key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      state.set(linha.key, { key: linha.key, value: linha.value, updated_at: linha.updated_at });
      aoInserir?.(linha.key);
      return { data: null, error: null };
    }
    if (op === 'upsert') {
      if (!(opcoes?.ignoreDuplicates && state.has(linha.key))) state.set(linha.key, linha);
      return { data: null, error: null };
    }
    if (op === 'delete') {
      const chaves = chavesIn ?? (chaveEq !== null ? [chaveEq]
        : [...state.values()].filter(r => filtros.every(f => f(r))).map(r => r.key));
      for (const k of chaves) { apagados.push(k); state.delete(k); }
      return { data: null, error: null };
    }
    // A leitura da SALA DE ESPERA tem que poder falhar no teste: ela é
    // fail-closed, e trava que ninguém prova é trava que ninguém tem.
    if (esperaQuebrada && chavesIn?.some(k => k.startsWith('apalavrado:'))) {
      return { data: null, error: { message: 'boom' } };
    }
    // A leitura do ESTADO DO CICLO também tem que poder falhar: ela
    // descartava o erro, e isso apagava a escada de todo mundo.
    if (cicloQuebrado && chavesIn?.some(k => k.startsWith('ep_reagenda_auto:'))) {
      return { data: null, error: { message: 'boom' } };
    }
    // A rampa do dia (e tudo que varre `ep_reagenda_auto:%`): `rampaQuebrada`
    // simula a consulta falhando, que tem que FECHAR a porta, não abrir.
    if (rampaQuebrada && likes.some(p => p.startsWith('ep_reagenda_auto:'))) {
      return { data: null, error: { message: 'boom' } };
    }
    let linhas = [...state.values()].filter(r => filtros.every(f => f(r)));
    if (ordem) {
      const { col, asc } = ordem;
      linhas = linhas.sort((a, b) => {
        const x = String(colunaDe(a, col) ?? ''), y = String(colunaDe(b, col) ?? '');
        return x === y ? 0 : (x < y ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    linhas = linhas.slice(0, Math.min(limite, MAX_ROWS));
    if (unica) return { data: linhas[0] ?? null, error: null };
    return { data: linhas, error: null };
  };

  const q: any = {
    select() { return q; },
    in(col: string, vs: any[]) {
      if (col === 'key') chavesIn = vs.map(String);
      filtros.push(r => vs.map(String).includes(String(colunaDe(r, col))));
      return q;
    },
    like(col: string, padrao: string) {
      likes.push(padrao);
      const prefixo = padrao.replace(/%$/, '');
      filtros.push(r => String(colunaDe(r, col) ?? '').startsWith(prefixo));
      return q;
    },
    eq(col: string, v: any) {
      if (col === 'key') chaveEq = String(v);
      filtros.push(r => { const x = colunaDe(r, col); return x !== null && x !== undefined && String(x) === String(v); });
      return q;
    },
    neq(col: string, v: any) {
      filtros.push(r => { const x = colunaDe(r, col); return x !== null && x !== undefined && String(x) !== String(v); });
      return q;
    },
    gte(col: string, v: any) { filtros.push(r => String(colunaDe(r, col) ?? '') >= String(v)); return q; },
    order(col: string, o?: { ascending?: boolean }) { ordem = { col, asc: o?.ascending !== false }; return q; },
    limit(n: number) { limite = n; return q; },
    maybeSingle() { unica = true; return q; },
    insert(r: any) { op = 'insert'; linha = r; return q; },
    upsert(r: any, o?: any) { op = 'upsert'; linha = r; opcoes = o; return q; },
    delete() { op = 'delete'; return q; },
    then(ok: any, falha: any) {
      return Promise.resolve().then(() => {
        try { return executar(); } catch (e) { return { data: null, error: { message: String(e) } }; }
      }).then(ok, falha);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({
  supabase: { from: () => consultaSystemState() },
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

// A grade (quais horas existem em cada dia, feriado, quem já ocupa) é do
// `eletropostoVagas` e tem teste próprio. Aqui só interessa QUAL janela o módulo
// pede e QUAL dos horários devolvidos ele escolhe.
let vagas: string[] | null = [];
const pedidos: Array<{ dono: string; agora: number; quantas: number; faixa?: string }> = [];
/** Gancho pra simular o que acontece ENTRE a leitura da ficha e a gravação. Pode
 *  ser assíncrono: é assim que dois ticks ficam presos no mesmo ponto (a corrida
 *  dos relógios). */
let aoPedirVagas: (() => void | Promise<void>) | null = null;
vi.mock('../services/io/eletropostoVagas', async (real) => {
  const orig = await real() as any;
  return {
    ...orig,
    proximasVagas: vi.fn(async (dono: string, quantas: number, opts: any) => {
      pedidos.push({ dono, quantas, agora: opts?.agora, faixa: opts?.faixa });
      await aoPedirVagas?.();
      return vagas;
    }),
  };
});

vi.mock('../services/io/eletropostoAgenda', () => ({
  EP_AGENDA_PREFIX: 'ep_agenda_sent:',
  EP_NAO_ATENDEU_PREFIX: 'ep_nao_atendeu_auto:',
  quandoPorExtenso: (iso: string) => `dia ${iso}`,
  telefoneBonito: (t: string | null) => (t ? '(34) 99136-0172' : ''),
  carregarConsultores: async () => new Map([['Diego', '5534991360172']]),
}));

vi.mock('../services/io/eletropostoRemarcar', () => ({ EP_REMARCAR_PREFIX: 'ep_remarcar:' }));

const enviadas: Array<{ tel: string; bolhas: string[]; opts?: any }> = [];
let envioQuebrado = false;
let linhaEmCooldownAgora = false;
vi.mock('../services/agents/zapiClient', () => ({
  linhaEmCooldown: vi.fn(() => linhaEmCooldownAgora),
  sendHuman: vi.fn(async (tel: string, bolhas: string[], _inst?: string, opts?: any) => {
    if (envioQuebrado) throw new Error('[zapi:io] HTTP 400 — whatsapp is disconnected');
    enviadas.push({ tel, bolhas, opts });
  }),
}));

let tetoLivre = true;
const pedidosTeto: any[] = [];
/** A rampa de reconexão da linha: `null` = linha aquecida, tetos cheios. */
let rampaAgora: { hora: number; dia: number } | null = null;
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async (o?: any) => { pedidosTeto.push(o); return tetoLivre; }),
  rampaReconexaoVigente: vi.fn(async () => rampaAgora),
}));

// 20/08/2026 (quinta), 15h BRT = 18h UTC — dentro da janela de 9h–19h.
const AGORA = new Date('2026-08-20T18:00:00.000Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();
/** Sexta 21/08: 13h e 14h BRT (16h e 17h UTC). */
const SEXTA_13H = '2026-08-21T16:00:00.000Z';
const SEXTA_14H = '2026-08-21T17:00:00.000Z';
/** Segunda 24/08: 13h BRT. Sabado e domingo a agenda nao abre. */
const SEGUNDA_13H = '2026-08-24T16:00:00.000Z';

function ficha(over: Partial<any> = {}) {
  return {
    id: 3, cliente_nome: 'Irineu de Almeida', cliente_telefone: '5577991110001',
    quando: horasAtras(2),               // hoje 13h BRT, perdida há 2h
    vendedor_nome: 'Diego', created_by: 'lp_eletroposto',
    // NOTA 3 na LP = `quente`. Só quente ganha 2ª e 3ª chance (ordem de 20/08).
    temperatura: 'quente',
    status: 'nao_atendeu', lead_resposta_at: null, historico: null,
    confirmacao_at: '2026-08-18T12:00:00.000Z', lembrete_1h_at: 'x', lembrete_5min_at: 'x',
    ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  fichas = [ficha()];
  ocupados = new Set();
  state.clear(); apagados.length = 0; updates.length = 0; enviadas.length = 0; pedidos.length = 0;
  vagas = [SEXTA_13H, SEXTA_14H];
  aoPedirVagas = null;
  aoInserir = null;
  falhaInsert = null;
  colunaDeGancho = null;
  aplicarUpdateGancho = null;
  tetoLivre = true;
  rampaAgora = null;
  envioQuebrado = false;
  linhaEmCooldownAgora = false;
  pedidosTeto.length = 0;
  rampaQuebrada = false;
  esperaQuebrada = false;
  cicloQuebrado = false;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function tick(opts: any = {}) {
  return (await import('../services/io/eletropostoReagendaAuto')).runEletropostoReagendaAutoTick(opts);
}

describe('o reagendamento em si', () => {
  it('vermelho vencido volta pra agendado no dia seguinte, mesma hora e mesmo consultor', async () => {
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(fichas[0].status).toBe('agendado');
    expect(fichas[0].quando).toBe(SEXTA_13H);     // a reunião perdida era 13h BRT
    expect(fichas[0].vendedor_nome).toBe('Diego');
  });

  it('pede vagas a partir da MEIA-NOITE do dia seguinte — "o outro dia", não "daqui a pouco"', async () => {
    await tick();
    expect(pedidos).toHaveLength(1);
    // 21/08 00:00 BRT = 21/08 03:00 UTC.
    expect(new Date(pedidos[0].agora).toISOString()).toBe('2026-08-21T03:00:00.000Z');
    expect(pedidos[0].dono).toBe('Diego');
  });

  it('a ficha SAI LIMPA: lembretes zerados e confirmação só depois do envio', async () => {
    await tick();
    const remarcacao = updates[0].patch;
    expect(remarcacao.lembrete_1h_at).toBeNull();
    expect(remarcacao.lembrete_5min_at).toBeNull();
    expect(remarcacao.presenca_confirmada_at).toBeNull();
    // O UPDATE que move a reunião grava confirmacao_at NULO; quem carimba é o
    // segundo update, depois de a mensagem sair.
    expect(remarcacao.confirmacao_at).toBeNull();
    expect(updates[1].patch.confirmacao_at).toBeTruthy();
  });

  it('apaga os três carimbos que calariam o dia novo', async () => {
    await tick();
    expect(apagados).toEqual(expect.arrayContaining([
      'ep_nao_atendeu_auto:3', 'ep_agenda_sent:3:manha', 'ep_remarcar:3',
    ]));
  });

  it('a mensagem cita o horário perdido e o novo, e carimba o teto da linha', async () => {
    await tick();
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].bolhas[0]).toContain('NEXUS Eletropostos');
    expect(enviadas[0].bolhas[0]).toContain(horasAtras(2));   // o que ele perdeu
    expect(enviadas[0].bolhas[1]).toContain(SEXTA_13H);       // o que ele ganhou
    expect(state.has('ep_agenda_sent:3:reagendado')).toBe(true);
  });

  it('a tentativa vira linha no card — vermelho parado e vermelho trabalhado não são a mesma tela', async () => {
    await tick();
    expect(updates[0].patch.historico).toContain('Reagendamento automático 1/3');
  });

  it('sem vaga na mesma hora, pega o primeiro livre do dia', async () => {
    vagas = [SEXTA_14H];                          // a hora perdida (13h) não voltou
    await tick();
    expect(fichas[0].quando).toBe(SEXTA_14H);
  });
});

describe('não falar demais com quem sumiu', () => {
  it('não remarca antes de 45 min do horário perdido — o toque de 5 min ainda estava saindo', async () => {
    fichas = [ficha({ quando: new Date(AGORA.getTime() - 20 * 60_000).toISOString() })];
    const r = await tick();
    expect(r.motivo).toBe('nenhum_vermelho');
    expect(enviadas).toHaveLength(0);
  });

  it('quem escreveu DEPOIS de perder o horário não entra: essa conversa tem dono', async () => {
    fichas = [ficha({ lead_resposta_at: horasAtras(1) })];
    const r = await tick();
    expect(r.motivo).toBe('nenhum_vermelho');
  });

  it('quem tem lista de horários na mesa não é movido por baixo dela', async () => {
    state.set('ep_remarcar:3', { key: 'ep_remarcar:3', value: {}, updated_at: horasAtras(3) });
    const r = await tick();
    expect(r.motivo).toBe('ninguem_na_vez');
    expect(updates).toHaveLength(0);
  });

  it('oferta VENCIDA (mais de 24h) não segura mais ninguém', async () => {
    state.set('ep_remarcar:3', { key: 'ep_remarcar:3', value: {}, updated_at: horasAtras(30) });
    const r = await tick();
    expect(r.remarcados).toBe(1);
  });

  // Tres voltas desde 01/10/2026 (ordem do Thiago: "nao atendeu, 3 voltas").
  it('para na terceira volta: quem já foi remarcado 3 vezes vira assunto de gente', async () => {
    state.set('ep_reagenda_auto:3', { key: 'ep_reagenda_auto:3', value: { n: 3, ultimo: horasAtras(24) }, updated_at: horasAtras(24) });
    const r = await tick();
    expect(r.motivo).toBe('ninguem_na_vez');
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('a última tentativa avisa que é a última', async () => {
    // Com 3 voltas (01/10/2026), a última é a TERCEIRA: a ficha já gastou duas.
    state.set('ep_reagenda_auto:3', { key: 'ep_reagenda_auto:3', value: { n: 2, ultimo: horasAtras(24) }, updated_at: horasAtras(24) });
    await tick();
    expect(enviadas[0].bolhas[2]).toContain('último horário');
  });

  it('a penúltima NÃO avisa que é a última', async () => {
    // A outra metade da regra: com teto de 3, a segunda volta ainda tem a
    // terceira pela frente, e prometer "último horário" ali seria mentira.
    state.set('ep_reagenda_auto:3', { key: 'ep_reagenda_auto:3', value: { n: 1, ultimo: horasAtras(24) }, updated_at: horasAtras(24) });
    await tick();
    expect(enviadas[0].bolhas[2]).not.toContain('último horário');
  });

  // ── ESTE TESTE JÁ FOI INVERTIDO DUAS VEZES, E A SEGUNDA É A DE HOJE ───────
  //
  // 20/08: piso duro, pra o módulo novo não despejar o estoque velho.
  // 29/09: o Thiago mandou ir buscar o estoque velho, e a janela foi pra 365.
  // 03/10: ele abriu a agenda de 05 a 09/10, achou card com reunião de origem em
  //        MAIO, e mandou de volta — "esses ficam onde estavam".
  //
  // Medido naquele dia: 143 dos 263 cards da semana tinham origem a mais de 3
  // semanas, 29 deles a mais de 2 meses. A rampa segurou o VOLUME por dia, como
  // prometido, mas ninguém tinha segurado a IDADE — e uma semana de rampa foi
  // tempo suficiente pra fila chegar nos antigos e despejá-los todos de uma vez.
  //
  // A janela de 21 dias é o freio que faltava. Ela e a rampa fazem coisas
  // diferentes: a rampa diz quantos por dia, a janela diz quais.
  it('vermelho VELHO fica FORA: 21 dias, não 365', async () => {
    fichas = [ficha({ quando: '2026-06-12T16:00:00.000Z' })];   // 69 dias atrás
    expect((await tick()).motivo).toBe('nenhum_vermelho');
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('e o vermelho DENTRO dos 21 dias entra, que é o trabalho do módulo', async () => {
    fichas = [ficha({ quando: '2026-08-06T16:00:00.000Z' })];   // 14 dias atrás
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(fichas[0].status).toBe('agendado');
  });

  it('EP_REAGENDA_JANELA_DIAS abre a janela sem deploy, pra rodada de resgate', async () => {
    // Se um dia ele quiser os antigos de volta DE NOVO, é por aqui: de propósito,
    // por uma rodada, e não como padrão.
    process.env.EP_REAGENDA_JANELA_DIAS = '365';
    fichas = [ficha({ quando: '2026-06-12T16:00:00.000Z' })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('mas antes do primeiro card da base continua fora — piso não é "sem piso"', async () => {
    fichas = [ficha({ quando: '2026-04-01T16:00:00.000Z' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('EP_REAGENDA_INICIO sobe o piso sem deploy', async () => {
    process.env.EP_REAGENDA_INICIO = '2026-07-01T00:00:00.000Z';
    fichas = [ficha({ quando: '2026-06-12T16:00:00.000Z' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('fora da janela de 9h–19h ninguém é remarcado', async () => {
    vi.setSystemTime(new Date('2026-08-20T23:30:00.000Z'));   // 20h30 BRT
    const r = await tick();
    expect(r.motivo).toBe('fora_da_janela');
  });

  // ── A VIRADA DE 29/09/2026 ────────────────────────────────────────────────
  // Em 20/08 o Thiago pediu "apenas os clientes QUENTES tenham uma 2ª e 3ª
  // chance", e o corte fazia sentido no mundo de então: a grade de eletroposto
  // estava sendo vendida e cada volta ocupava um horário vendável.
  //
  // Em 29/09 ele pediu o contrário, "TODOS os NÃO ATENDEU têm que remarcar
  // automaticamente". E a medição do dia explica por que a objeção antiga não
  // vale mais: a agenda futura tem 4 reuniões de eletroposto marcadas pra amanhã
  // e 3 pra depois, numa grade de 16 a 20 por dia. Não há comprador sendo
  // empurrado pra fora — 80% da grade está vazia.
  //
  // O que passou a ser escasso é a LINHA, e quem cuida dela é a rampa diária.
  it('morno entra agora — a ordem é recuperar gente', async () => {
    fichas = [ficha({ temperatura: 'morno' })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(fichas[0].status).toBe('agendado');
    expect(enviadas).toHaveLength(1);
  });

  it('frio entra', async () => {
    fichas = [ficha({ temperatura: 'frio' })];
    expect((await tick()).remarcados).toBe(1);
  });

  // Origem que não qualifica (ManyChat, prospecção, cadastro na mão) grava a ficha
  // sem temperatura. Antes isso era motivo pra ficar de fora; agora não é.
  it('ficha SEM temperatura entra', async () => {
    fichas = [ficha({ temperatura: null })];
    expect((await tick()).remarcados).toBe(1);
  });

  // A VOLTA ATRÁS. Se a linha reclamar, a régua de 20/08 volta com uma env e sem
  // deploy — é a única coisa que torna reversível uma decisão que mexe em volume.
  it('EP_REAGENDA_SO_QUENTE=1 devolve a régua de 20/08', async () => {
    process.env.EP_REAGENDA_SO_QUENTE = '1';
    fichas = [ficha({ temperatura: 'morno' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('EP_REAGENDA_SO_QUENTE=1 não atrapalha o quente', async () => {
    process.env.EP_REAGENDA_SO_QUENTE = '1';
    fichas = [ficha({ temperatura: 'quente' })];
    expect((await tick()).remarcados).toBe(1);
  });

  // ── A RAMPA DIÁRIA ────────────────────────────────────────────────────────
  // Ela é o que sobrou de freio depois que o piso duro e o corte de temperatura
  // saíram. Sem ela: 1 ficha por tick, tick de 2 em 2 minutos, janela de 10
  // horas = até 300 remarcações por dia, e cada uma recomeça uma régua de 3 a 4
  // mensagens. As 75 fichas paradas virariam ~300 mensagens numa tarde, pela
  // linha que já caiu 3 vezes em 7 dias por rajada.
  it('a rampa do dia fecha a porta quando o teto é atingido', async () => {
    process.env.EP_REAGENDA_POR_DIA = '2';
    const hoje = new Date(AGORA).toISOString();
    // `ultimo` é o que a rampa conta desde 01/10/2026 — `updated_at` é coluna de
    // infraestrutura e deixou de valer pra esta conta.
    state.set('ep_reagenda_auto:901', { key: 'ep_reagenda_auto:901', value: { n: 1, ultimo: hoje }, updated_at: hoje });
    state.set('ep_reagenda_auto:902', { key: 'ep_reagenda_auto:902', value: { n: 1, ultimo: hoje }, updated_at: hoje });
    const r = await tick();
    expect(r.motivo).toBe('rampa_do_dia_cheia');
    expect(r.remarcados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('carimbo de ONTEM não gasta a rampa de hoje', async () => {
    process.env.EP_REAGENDA_POR_DIA = '1';
    const ontem = new Date(new Date(AGORA).getTime() - 40 * 3600_000).toISOString();
    state.set('ep_reagenda_auto:901', { key: 'ep_reagenda_auto:901', value: { n: 1, ultimo: ontem }, updated_at: ontem });
    expect((await tick()).remarcados).toBe(1);
  });

  it('rampa em 0 congela o módulo sem precisar do kill-switch', async () => {
    process.env.EP_REAGENDA_POR_DIA = '0';
    expect((await tick()).motivo).toBe('rampa_do_dia_cheia');
  });

  // FAIL-CLOSED. Consulta que quebra devolve `data` nulo; contar isso como zero
  // faria a rampa desaparecer justamente no dia em que o banco está ruim, e aí
  // são 300 remarcações. Na dúvida não remarca: a fila esperou meses, espera o
  // próximo tick.
  it('leitura da rampa falhou: ninguém é remarcado', async () => {
    rampaQuebrada = true;
    const r = await tick();
    expect(r.motivo).toBe('erro_rampa');
    expect(r.remarcados).toBe(0);
    expect(updates).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
  });

  it('ficha de solar não entra — a copy é de eletroposto', async () => {
    fichas = [ficha({ created_by: 'lead-meta' })];
    const r = await tick();
    expect(r.motivo).toBe('nenhum_vermelho');
  });

  it('EP_REAGENDA_AUTO_OFF=1 desliga tudo', async () => {
    process.env.EP_REAGENDA_AUTO_OFF = '1';
    const r = await tick();
    expect(r.motivo).toBe('desligado');
    expect(updates).toHaveLength(0);
  });
});

// ── A QUEDA DA LINHA 5040 EM 02/10/2026 ──────────────────────────────────────
// 39 remarcações das 9h00 às 9h55, uma a cada ~90s, e a linha caiu. Três
// defeitos somados; cada teste abaixo falha no código daquele dia.
describe('a rajada de 02/10 não se repete', () => {
  it('o teto é perguntado pela LINHA INTEIRA — o carimbo deste robô é prefixo da agenda', async () => {
    await tick();
    expect(pedidosTeto).toHaveLength(1);
    expect(pedidosTeto[0]?.transacional).toBe(true);
    // 07/10/2026: este teste exigia "sem piso", e sem piso a linha inteira (mais
    // de 40 por dia só com a agenda) contra 6/h e 40/dia nunca passava. O
    // vermelho ficou 0/40 por cinco dias. O piso volta FINITO e ABAIXO dos 20/h
    // da régua do SIM: quando a linha enche, este robô cala primeiro.
    expect(Number.isFinite(pedidosTeto[0]?.pisoHora)).toBe(true);
    expect(pedidosTeto[0]?.pisoHora).toBeLessThan(20);
    expect(Number.isFinite(pedidosTeto[0]?.pisoDia)).toBe(true);
  });

  // O FREIO QUE DE FATO FALTOU EM 02/10 é a cadência, e ela é medida aqui pelo
  // comportamento: dez vermelhos na fila, teto da linha sempre aberto, um tick a
  // cada 2 minutos por uma hora inteira. No código de 02/10 seriam 30 mensagens.
  it('numa hora de teto aberto, no máximo 4 mensagens: o espaçamento é de 15 min', async () => {
    fichas = Array.from({ length: 10 }, (_, i) => ficha({ id: 70 + i, quando: horasAtras(2 + i / 10) }));
    for (let m = 0; m < 60; m += 2) {
      vi.setSystemTime(new Date(AGORA.getTime() + m * 60_000));
      await tick();
    }
    expect(enviadas.length).toBeGreaterThan(0);
    expect(enviadas.length).toBeLessThanOrEqual(4);
  });

  it('dentro do espaçamento o vermelho espera, e o calado anda', async () => {
    const ha5 = new Date(AGORA.getTime() - 5 * 60_000).toISOString();
    state.set('ep_reagenda_auto:900', {
      key: 'ep_reagenda_auto:900', value: { n: 1, ultimo: ha5, relogio: 'fala' }, updated_at: ha5,
    });
    const r = await tick();
    expect(r.motivo).toBe('espacamento_da_fala');
    expect(enviadas).toHaveLength(0);
    expect(fichas[0].status).toBe('nao_atendeu');
    // o calado não manda mensagem, então o espaçamento não tem o que segurar nele
    fichas = [ficha({ id: 5, status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('passados os 15 min, o vermelho anda', async () => {
    const ha16 = new Date(AGORA.getTime() - 16 * 60_000).toISOString();
    state.set('ep_reagenda_auto:900', {
      key: 'ep_reagenda_auto:900', value: { n: 1, ultimo: ha16, relogio: 'fala' }, updated_at: ha16,
    });
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  it('o carimbo de um CALADO não conta no espaçamento de quem fala', async () => {
    const agora = AGORA.toISOString();
    state.set('ep_reagenda_auto:900', {
      key: 'ep_reagenda_auto:900', value: { n: 1, ultimo: agora, relogio: 'mudo' }, updated_at: agora,
    });
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  it('a remarcação sai em UMA mensagem — toque frio não fatia', async () => {
    await tick();
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.opts?.maxBolhas).toBe(1);
  });

  it('envio falhou: a rodada PARA, em vez de remarcar a fila inteira sem avisar ninguém', async () => {
    fichas = [
      ficha({ id: 41, quando: horasAtras(9) }),
      ficha({ id: 42, quando: horasAtras(8) }),
      ficha({ id: 43, quando: horasAtras(7) }),
    ];
    envioQuebrado = true;
    const r = await tick();
    expect(r.erros).toBe(1);
    expect(updates.map(u => u.id)).toEqual([41]);
  });
});

// ── A LINHA CAÍDA NÃO MOVE QUEM FALA (03/10/2026) ──────────────────────────
//
// Com a linha fora o teto diz "pode", porque nada sai e o contador fica zerado.
// Em 03/10 foram 15 reuniões mudadas de dia, uma por tick, sem o cliente saber.
describe('linha fora do ar', () => {
  it('cooldown do zapiClient: o vermelho NÃO é tocado', async () => {
    linhaEmCooldownAgora = true;
    const r = await tick();
    expect(r.motivo).toBe('teto_da_linha');
    expect(updates).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('monitor viu a queda (downStreak > 0): o vermelho NÃO é tocado', async () => {
    state.set('zapi_io_health', { key: 'zapi_io_health', value: { downStreak: 2 }, updated_at: horasAtras(1) });
    const r = await tick();
    expect(updates).toHaveLength(0);
    expect(r.remarcados).toBe(0);
  });

  it('monitor diz que voltou (downStreak 0): anda normal', async () => {
    state.set('zapi_io_health', { key: 'zapi_io_health', value: { downStreak: 0 }, updated_at: horasAtras(1) });
    const r = await tick();
    expect(r.remarcados).toBe(1);
  });

  it('o calado continua andando com a linha fora: ele não depende de mensagem', async () => {
    linhaEmCooldownAgora = true;
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    vagas = [SEXTA_13H];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
  });

  it('o calado NÃO grava carimbo de envio: o teto da linha não paga mensagem fantasma', async () => {
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    vagas = [SEXTA_13H];
    await tick();
    expect([...state.keys()].filter(k => k.startsWith('ep_agenda_sent:'))).toEqual([]);
  });
});

describe('nunca marcar sem conseguir avisar', () => {
  it('teto da linha estourado: a ficha NÃO é tocada — reunião que ninguém avisa é pior que fila parada', async () => {
    tetoLivre = false;
    const r = await tick();
    expect(r.motivo).toBe('teto_da_linha');
    expect(updates).toHaveLength(0);
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('slot vendido no meio do caminho (23505): tenta o próximo em vez de desistir', async () => {
    ocupados.add(`Diego|${SEXTA_13H}`);
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(fichas[0].quando).toBe(SEXTA_14H);
  });

  // ── A FILA ANDA MESMO QUANDO A PRIMEIRA NÃO TEM VAGA (01/10/2026) ───────
  //
  // `POR_TICK = 1` pegava a primeira da fila e, sem vaga, devolvia zero. A ordem
  // da fila não muda entre ticks, então a rodada seguinte tentava a MESMA ficha:
  // uma ficha sem horário parava a fila inteira com a rampa vazia. Com a rampa
  // dos calados em 200, isso apareceria no primeiro dia.
  it('primeira ficha sem vaga: a rodada tenta a seguinte em vez de devolver zero', async () => {
    fichas = [
      ficha({ id: 21, status: 'agendado', quando: horasAtras(9) }),
      ficha({ id: 22, status: 'agendado', quando: horasAtras(8) }),
    ];
    let pedido = 0;
    vagas = [];
    aoPedirVagas = () => { if (++pedido === 2) vagas = [SEXTA_13H]; };
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(pedido).toBe(2);
    // Moveu a SEGUNDA. A primeira continua na fila, sem tentativa gasta.
    expect(updates.map(u => u.id)).toEqual([22]);
    expect(state.has('ep_reagenda_auto:21')).toBe(false);
  });

  it('mesmo assim move só uma por rodada: para no que MOVEU, não no que tentou', async () => {
    fichas = [
      ficha({ id: 31, status: 'agendado', quando: horasAtras(9) }),
      ficha({ id: 32, status: 'agendado', quando: horasAtras(8) }),
    ];
    expect((await tick()).remarcados).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('agenda do consultor sem vaga nenhuma: não inventa horário e não gasta tentativa', async () => {
    vagas = [];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(updates).toHaveLength(0);
    expect(state.has('ep_reagenda_auto:3')).toBe(false);
  });

  it('leitura da agenda falhou: não inventa horário', async () => {
    vagas = null;
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('alguém tirou a ficha do vermelho no meio do caminho: quem manda é a pessoa', async () => {
    const antes = fichas[0].quando;
    // A corrida: o consultor muda o status entre a leitura e a gravação. O
    // `.eq('status','nao_atendeu')` do UPDATE não pega linha nenhuma.
    aoPedirVagas = () => { fichas[0].status = 'em_atendimento'; };
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(fichas[0].quando).toBe(antes);
    expect(enviadas).toHaveLength(0);
  });
});

// "E assim até o terceiro dia" (2 voltas) é a REQUISIÇÃO — e ela só existe se a ficha
// conseguir ficar vermelha DE NOVO depois de voltar pra agenda. As duas réguas
// de marcação do `eletropostoAgenda` exigem `lead_resposta_at` vazio: sem zerar
// a coluna, quem disse "SIM" e não apareceu (o no-show clássico) travaria na
// primeira volta e ficaria `agendado` até o repasse de 12h trocar o consultor
// dele e jogá-lo num horário fora da grade.
describe('o ciclo chega ao terceiro dia', () => {
  it('o reagendamento zera o lead_resposta_at — é ele que deixa a ficha ficar vermelha de novo', async () => {
    fichas = [ficha({ lead_resposta_at: '2026-08-19T12:00:00.000Z' })];   // falou ANTES da reunião
    await tick();
    expect(updates[0].patch.lead_resposta_at).toBeNull();
    expect(fichas[0].lead_resposta_at).toBeNull();
  });

  it('duas voltas seguidas na mesma ficha: a tentativa anda de 1 pra 2 e o horário também', async () => {
    await tick();
    expect(state.get('ep_reagenda_auto:3')?.value).toMatchObject({ n: 1 });
    expect(fichas[0].quando).toBe(SEXTA_13H);

    // A régua da agenda dá a sexta como ausente e o horário passa.
    fichas[0].status = 'nao_atendeu';
    vi.setSystemTime(new Date(new Date(SEXTA_13H).getTime() + 60 * 60_000));   // sexta, 14h BRT
    vagas = [SEGUNDA_13H];
    enviadas.length = 0;

    await tick();
    expect(state.get('ep_reagenda_auto:3')?.value).toMatchObject({ n: 2 });
    expect(fichas[0].quando).toBe(SEGUNDA_13H);
    expect(fichas[0].status).toBe('agendado');
    expect(enviadas).toHaveLength(1);
    // A SEGUNDA DEIXOU DE SER A ÚLTIMA em 01/10/2026 ("não atendeu, 3 voltas"):
    // ainda há a terceira pela frente, então a copy não promete o fim.
    expect(enviadas[0].bolhas[2]).not.toContain('último horário');
  });
});

describe('dry', () => {
  it('mostra quem seria remarcado e de quando pra quando, sem tocar em nada', async () => {
    const r = await tick({ dry: true });
    expect(r.remarcados).toBe(1);
    expect(r.previa?.[0]).toMatchObject({ id: 3, tentativa: 1 });
    expect(r.previa?.[0].para).toContain(SEXTA_13H);
    expect(updates).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
    expect(state.size).toBe(0);
  });
});

// ── O CARD CONFIRMADO QUE NINGUÉM MEXEU (30/09/2026) ───────────────────────
//
// Ordem do Thiago: "o card confirmado, se não for alterado, já será remarcado
// novamente após 6h. Marcado e confirmado e não mexido às 13:00: quando chegar
// 19h, remarca para o outro dia, hora e hora e 30, na mesma hora que não
// aconteceu ou o mais próximo possível."
//
// O gatilho é a INAÇÃO. Até aqui o módulo só pegava quem alguém marcou como NÃO
// ATENDEU; o card que ficou `agendado` pra sempre, porque o consultor não
// fechou, não era assunto de ninguém.
//
// O RISCO DESTE CAMINHO, e é ele que os testes abaixo cercam: a reunião pode ter
// ACONTECIDO e ido bem, e o card só não foi atualizado. Mandar pro cliente a
// copy de no-show ("você não conseguiu entrar na apresentação") seria acusar de
// falta quem esteve presente. Por isso o card esquecido se move em SILÊNCIO.
describe('o card esquecido, 6h depois', () => {
  const agendadoHa = (h: number) => ficha({ status: 'agendado', quando: horasAtras(h) });

  it('6 horas depois da reunião, o card sem desfecho volta pro dia seguinte', async () => {
    fichas = [agendadoHa(6)];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(fichas[0].status).toBe('agendado');
    expect(fichas[0].quando).toBe(SEXTA_13H);
  });

  it('antes das 6 horas não encosta: o consultor ainda pode fechar o card', async () => {
    fichas = [agendadoHa(3)];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(fichas[0].quando).toBe(horasAtras(3));
  });

  it('o prazo é configurável sem deploy', async () => {
    process.env.EP_ESQUECIDO_H = '2';
    fichas = [agendadoHa(3)];
    expect((await tick()).remarcados).toBe(1);
  });

  it('NADA é enviado ao cliente: a reunião pode ter acontecido', async () => {
    fichas = [agendadoHa(6)];
    await tick();
    expect(enviadas).toHaveLength(0);
  });

  it('mas o vermelho de verdade continua avisando', async () => {
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(6) })];
    await tick();
    expect(enviadas).toHaveLength(1);
  });

  it('o histórico não inventa que a pessoa faltou', async () => {
    fichas = [agendadoHa(6)];
    await tick();
    const linha = String(fichas[0].historico || '');
    expect(linha).not.toContain('não apareceu');
    expect(linha).toContain('sem desfecho');
    expect(linha).toContain('Nada foi enviado ao cliente');
  });

  it('o histórico do vermelho continua dizendo que não apareceu', async () => {
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(6) })];
    await tick();
    expect(String(fichas[0].historico || '')).toContain('não apareceu');
  });

  // A corrida com gente: o guard do UPDATE era fixo em `nao_atendeu`. Com dois
  // status na busca, ele tem que casar com o que FOI LIDO, senão o card
  // esquecido nunca grava (o update não acha linha) ou, pior, grava por cima de
  // alguém que mexeu no card no meio do caminho.
  it('se alguém mexer no card entre a leitura e a gravação, quem manda é a pessoa', async () => {
    fichas = [agendadoHa(6)];
    aoPedirVagas = () => { fichas[0].status = 'em_atendimento'; };
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(fichas[0].status).toBe('em_atendimento');
    expect(fichas[0].quando).toBe(horasAtras(6));
  });

  it('card confirmado do FUTURO nunca entra', async () => {
    fichas = [ficha({ status: 'agendado', quando: new Date(AGORA.getTime() + 3600_000).toISOString() })];
    expect((await tick()).remarcados).toBe(0);
  });

  it('os dois gatilhos convivem na mesma varredura', async () => {
    fichas = [
      ficha({ id: 1, status: 'nao_atendeu', quando: horasAtras(2) }),
      ficha({ id: 2, status: 'agendado', quando: horasAtras(8) }),
    ];
    // POR_TICK é 1: o tick pega um por vez, mas os dois são candidatos.
    const r = await tick({ dry: true });
    expect(r.remarcados).toBeGreaterThanOrEqual(1);
  });
});

// ── A GRADE REDONDA, E NÃO A FAIXA DOS QUINZE ──────────────────────────────
// "Remarca pro outro dia, hora e hora e 30, na mesma hora que não aconteceu."
// Isto não é follow-up: é a MESMA primeira reunião mudando de dia, e o cliente
// escolheu 13:00. Devolver 13:15 perderia o "na mesma hora".
describe('para onde o card volta', () => {
  it('pede vaga na grade de venda, não na faixa de remarcação', async () => {
    await tick();
    expect(pedidos).toHaveLength(1);
    // O mock grava a `faixa` de proposito: sem isso a assercao passava sozinha
    // (undefined nunca e 'remarcacao') e o teste nao provava nada.
    expect(pedidos[0]!.faixa).toBe('novo');
  });

  it('a mesma hora ganha do resto do dia', async () => {
    vagas = [SEXTA_14H, SEXTA_13H];          // 14h vem primeiro na lista
    await tick();
    expect(fichas[0].quando).toBe(SEXTA_13H); // mas 13h era a hora perdida
  });

  it('sem a mesma hora livre, cai na mais próxima daquele dia', async () => {
    vagas = [SEXTA_14H];
    await tick();
    expect(fichas[0].quando).toBe(SEXTA_14H);
  });

  it('dia inteiro cheio: vai pro dia seguinte', async () => {
    vagas = [SEGUNDA_13H];
    await tick();
    expect(fichas[0].quando).toBe(SEGUNDA_13H);
  });
});

// ── A JANELA SÓ SEGURA QUEM FALA (01/10/2026) ──────────────────────────────
//
// A regra do card esquecido subiu depois das 19h. À 01h38 o Thiago abriu a
// agenda e não viu card remarcado nenhum: não estava quebrado, estava fora da
// janela de 9h–19h, que existe pra não mandar "você não apareceu" de madrugada.
//
// O card esquecido não manda nada, então a janela não tem o que proteger nele.
describe('fora do horário comercial', () => {
  const MADRUGADA = new Date('2026-08-21T04:38:00.000Z');   // 01h38 BRT de sexta

  it('o card esquecido se move de madrugada, porque ele é silencioso', async () => {
    vi.setSystemTime(MADRUGADA);
    fichas = [ficha({ status: 'agendado', quando: '2026-08-20T16:00:00.000Z' })];
    vagas = [SEXTA_13H, SEXTA_14H];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
  });

  it('o vermelho NÃO se move de madrugada: ele mandaria mensagem', async () => {
    vi.setSystemTime(MADRUGADA);
    fichas = [ficha({ status: 'nao_atendeu', quando: '2026-08-20T16:00:00.000Z' })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('fora_da_janela');
    expect(enviadas).toHaveLength(0);
  });

  it('de madrugada, com os dois na fila, só o esquecido anda', async () => {
    vi.setSystemTime(MADRUGADA);
    fichas = [
      ficha({ id: 1, status: 'nao_atendeu', quando: '2026-08-20T16:00:00.000Z' }),
      ficha({ id: 2, status: 'agendado', quando: '2026-08-20T16:00:00.000Z' }),
    ];
    await tick();
    expect(fichas[0].quando).toBe('2026-08-20T16:00:00.000Z');   // o vermelho ficou
    expect(fichas[1].quando).toBe(SEXTA_13H);                     // o esquecido andou
    expect(enviadas).toHaveLength(0);
  });

  it('o teto da linha não trava o esquecido: ele não usa a linha', async () => {
    tetoLivre = false;
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('mas o teto da linha continua travando o vermelho', async () => {
    tetoLivre = false;
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(2) })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('teto_da_linha');
  });

  it('dentro da janela nada muda: o vermelho anda como sempre andou', async () => {
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(2) })];
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });
});

// ── O CARD ESQUECIDO VOLTA PARA SEMPRE ─────────────────────────────────────
//
// "Agenda é feita para ter responsabilidade de ser trabalhada, então a pessoa,
// quando não marca e não utiliza a ferramenta, sempre terá os clientes
// retornando e ocupando a agenda. Vamos seguir a regra." (Thiago, 01/10/2026)
//
// Ocupar a grade é o CUSTO que faz a regra funcionar. O teto de 2 continua
// existindo pro vermelho, que manda mensagem: remarcar calado pode ser
// infinito, dizer "você não apareceu" vinte vezes não pode.
describe('o teto de 2 e quem ele vale', () => {
  const jaFoi = (id: number, n: number) =>
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`, value: { n, ultimo: horasAtras(24) }, updated_at: horasAtras(24),
    });

  it('o esquecido volta na 3ª, na 5ª e na 10ª vez', async () => {
    for (const n of [2, 4, 9]) {
      fichas = [ficha({ id: 7, status: 'agendado', quando: horasAtras(8) })];
      state.clear(); jaFoi(7, n);
      vagas = [SEXTA_13H, SEXTA_14H];
      expect((await tick()).remarcados).toBe(1);
    }
  });

  it('o vermelho para no teto, como sempre parou', async () => {
    fichas = [ficha({ id: 7, status: 'nao_atendeu', quando: horasAtras(2) })];
    jaFoi(7, 3);
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
  });

  it('o histórico do esquecido não promete um teto que não existe', async () => {
    fichas = [ficha({ id: 7, status: 'agendado', quando: horasAtras(8) })];
    jaFoi(7, 5);
    await tick();
    const linha = String(fichas[0].historico || '');
    expect(linha).toContain('6ª vez');
    expect(linha).not.toContain('/2');
  });
});


// ── A LEITURA DO ESTADO DO CICLO FECHA A PORTA (01/10/2026) ───────────────
//
// Achado de revisão adversarial, reproduzido no harness antes de virar conserto.
// A leitura descartava o `error`, e o cliente do Supabase daqui NÃO lança: erro
// de banco RESOLVE com `data: null`. Resultado silencioso e PERMANENTE — um tick
// com o banco ruim zerava a escada de todos os cards e o teto de 3 voltas do
// vermelho, reescrevendo cada carimbo como degrau 1 / volta 1.
describe('quando a leitura do estado do ciclo falha', () => {
  const noDegrauAlto = (id: number, status: string, degrau: number) =>
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`,
      value: { n: degrau, ultimo: horasAtras(400), relogio: 'mudo', status, degrau },
      updated_at: horasAtras(400),
    });

  it('ninguém é remarcado, e o motivo diz qual leitura caiu', async () => {
    cicloQuebrado = true;
    fichas = [ficha({ id: 90, status: 'arrendamento', quando: horasAtras(60) })];
    noDegrauAlto(90, 'arrendamento', 5);
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('erro_ciclo');
    expect(r.erros).toBe(1);
    expect(updates).toHaveLength(0);
  });

  it('e o carimbo NÃO é reescrito no degrau 1 — o dano era permanente', async () => {
    cicloQuebrado = true;
    fichas = [ficha({ id: 91, status: 'arrendamento', quando: horasAtras(60) })];
    noDegrauAlto(91, 'arrendamento', 5);
    await tick();
    expect(state.get('ep_reagenda_auto:91')?.value?.degrau).toBe(5);
  });

  it('o vermelho no teto de voltas também não é liberado pela falha', async () => {
    // Sem a trava, `estadoDe` vazio fazia `tentativa` voltar pra 1 e o cliente
    // recebia um quarto "você não conseguiu entrar na apresentação".
    cicloQuebrado = true;
    fichas = [ficha({ id: 92, status: 'nao_atendeu', quando: horasAtras(2) })];
    state.set('ep_reagenda_auto:92', {
      key: 'ep_reagenda_auto:92',
      value: { n: 3, ultimo: horasAtras(24), relogio: 'fala', status: 'nao_atendeu', degrau: 1 },
      updated_at: horasAtras(24),
    });
    expect((await tick()).remarcados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('com a leitura BOA o mesmo card descansa no degrau dele, e isso é o controle', async () => {
    fichas = [ficha({ id: 93, status: 'arrendamento', quando: horasAtras(60) })];
    noDegrauAlto(93, 'arrendamento', 5);          // degrau 6 pede 96h
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('todos_no_degrau');
  });
});

// ── A SALA DE ESPERA DEIXOU DE SER UM STATUS (01/10/2026) ─────────────────
//
// Ordem do dono: "a etiqueta APALAVRADO não substitui a atual, ela é
// acrescentada; a etiqueta mantém pra conseguirmos identificar a negociação
// correta daquele cliente".
//
// O que se prende aqui é a consequência no robô: quem tira a ficha da roda
// passou a ser a MARCA `apalavrado:<id>`, e o status fica com a etiqueta. E a
// data, que antes só enfeitava a tela, voltou a valer: depois dela a ficha anda.
describe('a sala de espera por marca, não por status', () => {
  const marcaEspera = (id: number, retomar: string | null, em?: string) =>
    state.set(`apalavrado:${id}`, {
      key: `apalavrado:${id}`,
      value: {
        aguardando: 'esperando o investidor',
        ...(retomar === null ? {} : { retomar_em: retomar }),
        ...(em ? { em } : {}),
      },
      updated_at: horasAtras(24),
    });
  const daquiADias = (d: number) => new Date(AGORA.getTime() + d * 86400_000).toISOString();

  it('a etiqueta FICA: o card apalavrado continua chave_na_mao e não anda', async () => {
    fichas = [ficha({ id: 80, status: 'chave_na_mao', quando: horasAtras(100) })];
    marcaEspera(80, daquiADias(20));
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(updates).toHaveLength(0);
    expect(fichas[0].status).toBe('chave_na_mao');   // a etiqueta não foi trocada
  });

  // ESTA É A PARTE QUE O STATUS NÃO FAZIA. Com `status = 'apalavrado'` a ficha
  // saía da roda PRA SEMPRE: a data aparecia na tela e, se ninguém olhasse, o
  // card morria ali — o cemitério que o status foi criado pra não ser.
  it('passada a data, ela volta pra roda sozinha, e calada', async () => {
    fichas = [ficha({ id: 81, status: 'arrendamento', quando: horasAtras(100) })];
    marcaEspera(81, daquiADias(-1));                // o prazo venceu ontem
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(fichas[0].status).toBe('arrendamento');
  });

  it('data ilegível não vira silêncio eterno: cai no padrão de 30 dias', async () => {
    fichas = [ficha({ id: 82, status: 'carregador', quando: horasAtras(100) })];
    marcaEspera(82, 'amanhã de manhã', horasAtras(24));    // marcada ontem
    expect((await tick()).remarcados).toBe(0);             // 30 dias contados de ontem
    marcaEspera(82, 'amanhã de manhã', new Date(AGORA.getTime() - 40 * 86400_000).toISOString());
    expect((await tick()).remarcados).toBe(1);             // marcada há 40 dias: passou
  });

  it('marca SEM data nenhuma não silencia o card — carimbo quebrado não some com cliente', async () => {
    fichas = [ficha({ id: 83, status: 'meio_a_meio', quando: horasAtras(100) })];
    marcaEspera(83, null);
    expect((await tick()).remarcados).toBe(1);
  });

  // ── CORREÇÃO DO QUE EU ESCREVI DE MANHÃ (01/10/2026) ───────────────────
  //
  // Este teste dizia "o status antigo continua tirando da roda" e prendia o
  // `apalavrado` como fim de linha. Era a conclusão errada: NADA no sistema tira
  // esse status de uma ficha, então os cards apalavrados ANTES da marca ficavam
  // presos PRA SEMPRE, e a data deles não significava nada. Três dos cinco cards
  // na sala de espera estavam assim.
  //
  // Quem segura a ficha é a MARCA, que tem data. O status é só uma etiqueta sem
  // nome.
  it('o status antigo `apalavrado` NÃO prende mais: quem segura é a marca', async () => {
    fichas = [ficha({ id: 84, status: 'apalavrado', quando: horasAtras(300) })];
    // com a marca viva, não anda
    state.set('apalavrado:84', {
      key: 'apalavrado:84',
      value: { aguardando: 'esperando o banco', retomar_em: new Date(AGORA.getTime() + 20 * 86400_000).toISOString() },
      updated_at: horasAtras(24),
    });
    expect((await tick()).remarcados).toBe(0);
  });

  it('e passada a data ele VOLTA, em vez de morrer na sala de espera', async () => {
    fichas = [ficha({ id: 84, status: 'apalavrado', quando: horasAtras(300) })];
    state.set('apalavrado:84', {
      key: 'apalavrado:84',
      value: { aguardando: 'esperando o banco', retomar_em: new Date(AGORA.getTime() - 86400_000).toISOString() },
      updated_at: horasAtras(24),
    });
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);          // negociação volta calada
    expect(fichas[0].status).toBe('apalavrado');  // e sem perder o que tem
  });

  it('sem marca nenhuma, ele é uma negociação como outra qualquer', async () => {
    // É o certo: card com o status velho e sem prazo registrado não pode ficar
    // parado pra sempre só porque ninguém apagou o status dele.
    fichas = [ficha({ id: 87, status: 'apalavrado', quando: horasAtras(300) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('leitura da sala de espera falhou: NINGUÉM anda nesta rodada', async () => {
    // Fail-closed. Na dúvida, o errado é devolver pra agenda um cliente que
    // alguém pediu explicitamente pra deixar em paz.
    esperaQuebrada = true;
    fichas = [ficha({ id: 85, status: 'chave_na_mao', quando: horasAtras(100) })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('erro_espera');
    expect(r.erros).toBe(1);
    expect(updates).toHaveLength(0);
  });

  it('o vermelho também respeita a espera: ninguém recebe mensagem de card em paz', async () => {
    fichas = [ficha({ id: 86, status: 'nao_atendeu', quando: horasAtras(2) })];
    marcaEspera(86, daquiADias(10));
    expect((await tick()).remarcados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });
});

// ── A ESCADA DA NEGOCIAÇÃO, DENTRO DO TICK (01/10/2026) ───────────────────
//
// A aritmética da escada tem teste próprio e puro (`escadaNegociacao.test.ts`).
// Este bloco prende a outra metade, que é a que pode quebrar em produção: que o
// tick REALMENTE segura a ficha que ainda não descansou, que o carimbo guarda a
// etiqueta, e que os outros dois relógios não foram contaminados.
describe('a escada da negociação no tick', () => {
  /** Carimbo com etiqueta e degrau: o estado que a escada lê. */
  const noDegrau = (id: number, status: string, degrau: number) =>
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`,
      value: { n: degrau, ultimo: horasAtras(degrau * 48), relogio: 'mudo', status, degrau },
      updated_at: horasAtras(24),
    });

  it('no degrau 1, 40h de parada NÃO bastam: o degrau 2 pede 48h', async () => {
    fichas = [ficha({ id: 50, status: 'arrendamento', quando: horasAtras(40) })];
    noDegrau(50, 'arrendamento', 1);
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('todos_no_degrau');
    expect(updates).toHaveLength(0);
  });

  it('e 49h bastam — o card volta e sobe pro degrau 2', async () => {
    fichas = [ficha({ id: 50, status: 'arrendamento', quando: horasAtras(49) })];
    noDegrau(50, 'arrendamento', 1);
    expect((await tick()).remarcados).toBe(1);
    const v = state.get('ep_reagenda_auto:50')?.value;
    expect(v?.degrau).toBe(2);
    expect(v?.status).toBe('arrendamento');
  });

  // A REPETIÇÃO, que é a forma nova (07/10/2026): "se mantém, 48hrs; se
  // manteve, 48hrs". O degrau 3 pede o MESMO que o 2, e só o 4 sobe pra 72h.
  it('no degrau 2 o próximo REPETE as 48h: 40h não bastam, 49h bastam', async () => {
    fichas = [ficha({ id: 51, status: 'chave_na_mao', quando: horasAtras(40) })];
    noDegrau(51, 'chave_na_mao', 2);
    expect((await tick()).motivo).toBe('todos_no_degrau');
    fichas = [ficha({ id: 51, status: 'chave_na_mao', quando: horasAtras(49) })];
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('ep_reagenda_auto:51')?.value?.degrau).toBe(3);
  });

  it('no degrau 3 o próximo sobe pra 72h: 60h não bastam, 73h bastam', async () => {
    fichas = [ficha({ id: 51, status: 'chave_na_mao', quando: horasAtras(60) })];
    noDegrau(51, 'chave_na_mao', 3);
    expect((await tick()).motivo).toBe('todos_no_degrau');
    fichas = [ficha({ id: 51, status: 'chave_na_mao', quando: horasAtras(73) })];
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('ep_reagenda_auto:51')?.value?.degrau).toBe(4);
  });

  // O CORAÇÃO DA REGRA. "Se manter uma dessas etiquetas" sobe; mudar de etiqueta
  // é a negociação ANDANDO, e quem andou merece o toque curto de volta.
  it('etiqueta que MUDOU volta pro degrau 1: 25h bastam, mesmo vindo do degrau 6', async () => {
    fichas = [ficha({ id: 52, status: 'chave_na_mao', quando: horasAtras(25) })];
    noDegrau(52, 'arrendamento', 6);          // a etiqueta de antes era outra
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('ep_reagenda_auto:52')?.value?.degrau).toBe(1);
    expect(state.get('ep_reagenda_auto:52')?.value?.status).toBe('chave_na_mao');
  });

  it('carimbo velho, sem etiqueta: a ficha ganha mais um degrau 1 e a escada começa dali', async () => {
    fichas = [ficha({ id: 53, status: 'meio_a_meio', quando: horasAtras(25) })];
    state.set('ep_reagenda_auto:53', {
      key: 'ep_reagenda_auto:53', value: { n: 4, ultimo: horasAtras(60) }, updated_at: horasAtras(60),
    });
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('ep_reagenda_auto:53')?.value?.degrau).toBe(1);
  });

  it('a linha do card diz o degrau, as horas dele e as da próxima volta', async () => {
    // Degrau 3: repete as 48h do 2, e a linha avisa que a próxima já é 72h.
    fichas = [ficha({ id: 54, status: 'carregador', quando: horasAtras(49) })];
    noDegrau(54, 'carregador', 2);
    await tick();
    const linha = String(fichas[0].historico || '');
    expect(linha).toContain('Ciclo de 48h (3ª volta nesta etiqueta');
    expect(linha).toContain('a próxima volta é em 72h');
    expect(linha).toContain('mudar de etiqueta recomeça em 24h');
  });

  it('e quando o total não bate com o degrau, ela diz os dois', async () => {
    // Card que já voltou 9 vezes mas trocou de etiqueta agora: 1ª volta NESTA
    // etiqueta, 10ª no total. Dizer só "1ª volta" faria parecer card novo.
    fichas = [ficha({ id: 55, status: 'chave_na_mao', quando: horasAtras(49) })];
    state.set('ep_reagenda_auto:55', {
      key: 'ep_reagenda_auto:55',
      value: { n: 9, ultimo: horasAtras(60), status: 'arrendamento', degrau: 4 },
      updated_at: horasAtras(60),
    });
    await tick();
    const linha = String(fichas[0].historico || '');
    expect(linha).toContain('(1ª volta nesta etiqueta (10ª no total))');
  });

  // A ESCADA É SÓ DA NEGOCIAÇÃO. Os outros dois relógios são ordem antiga e
  // separada: 45 min pro vermelho e 6h pro esquecido, sem escada.
  it('o vermelho não entra na escada: 2h e um degrau alto guardado, e ele anda', async () => {
    fichas = [ficha({ id: 56, status: 'nao_atendeu', quando: horasAtras(2) })];
    // `n` baixo de propósito: o vermelho TEM teto de 3 voltas, e é esse teto
    // que a gente não quer que mascare o teste. O que está sendo medido é o
    // `degrau`, que o relógio dele precisa ignorar.
    state.set('ep_reagenda_auto:56', {
      key: 'ep_reagenda_auto:56',
      value: { n: 1, ultimo: horasAtras(24), relogio: 'fala', status: 'nao_atendeu', degrau: 9 },
      updated_at: horasAtras(24),
    });
    expect((await tick()).remarcados).toBe(1);
  });

  it('nem o card esquecido: 8h e um degrau alto guardado, e ele anda', async () => {
    fichas = [ficha({ id: 57, status: 'agendado', quando: horasAtras(8) })];
    noDegrau(57, 'agendado', 9);
    expect((await tick()).remarcados).toBe(1);
  });

  it('fila cheia de gente no prazo responde `todos_no_degrau`, não `ninguem_na_vez`', async () => {
    // Os dois se resolvem de formas diferentes: um é fila vazia, o outro é fila
    // cheia descansando. Juntar num motivo só esconderia a escada de quem lê o
    // tick e desligaria o módulo achando que ele parou.
    fichas = [
      ficha({ id: 58, status: 'arrendamento', quando: horasAtras(40) }),
      ficha({ id: 59, status: 'carregador', quando: horasAtras(45) }),
    ];
    noDegrau(58, 'arrendamento', 2);          // o degrau 3 pede 48h
    noDegrau(59, 'carregador', 2);            // o degrau 3 pede 48h
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('todos_no_degrau');
  });

  it('o passo muda sem deploy, e o corte do tick acompanha', async () => {
    process.env.EP_NEGOCIACAO_PASSO_H = '0';   // escada plana: 24h pra sempre
    fichas = [ficha({ id: 60, status: 'arrendamento', quando: horasAtras(25) })];
    noDegrau(60, 'arrendamento', 5);
    expect((await tick()).remarcados).toBe(1);
  });
});

// ── A RAMPA CONTA PELO CARIMBO DO MÓDULO, NÃO PELO `updated_at` ───────────
//
// O DEFEITO, medido em produção à 02h de 01/10/2026: com ZERO fichas remarcadas
// no dia, o módulo logava "rampa do dia cheia (10/10)" a cada tick e não mexia
// em nada. O Thiago abriu a agenda e viu o quadro intacto, com 16 na fila.
//
// A conta saía de `.gte('updated_at', inicioDoDia)`. `updated_at` é coluna de
// infraestrutura: quem escreve, quando e com que fuso não é contrato deste
// módulo. `value.ultimo` é o ISO que ELE grava no mesmo upsert em que conta a
// tentativa.
describe('a rampa do dia', () => {
  const carimbo = (id: number, ultimo: string, updatedAt: string, relogio?: 'fala' | 'mudo') =>
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`,
      value: { n: 1, ultimo, ...(relogio ? { relogio } : {}) },
      updated_at: updatedAt,
    });
  const hojeCedo = () => new Date(AGORA.getTime() - 2 * 3600_000).toISOString();

  it('carimbo VELHO com updated_at de hoje não fecha a rampa', async () => {
    // Exatamente o caso de produção: 10 carimbos antigos que, por qualquer
    // motivo, têm `updated_at` recente. Nenhum deles é trabalho de hoje.
    for (let i = 100; i < 110; i++) carimbo(i, horasAtras(72), new Date(AGORA).toISOString());
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('10 carimbos de HOJE fecham a rampa do vermelho, que é o que ela existe pra fazer', async () => {
    for (let i = 100; i < 110; i++) carimbo(i, hojeCedo(), hojeCedo(), 'fala');
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(2) })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('rampa_do_dia_cheia');
  });

  it('9 de hoje ainda deixam passar um vermelho', async () => {
    for (let i = 100; i < 109; i++) carimbo(i, hojeCedo(), hojeCedo(), 'fala');
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(2) })];
    expect((await tick()).remarcados).toBe(1);
  });

  // ── CADA RELÓGIO TEM A RAMPA DELE (01/10/2026) ──────────────────────────
  //
  // Era um teto só pros dois caminhos, e ele foi dimensionado por VOLUME DE
  // MENSAGEM ("75 fichas de uma vez são ~300 mensagens"). Isso descreve o
  // vermelho. Os calados não mandam nada, e ficavam presos atrás dele: medido em
  // 01/10, a rampa fechou em 40/40 às 13h03 com 182 fichas esperando, 110 delas
  // em negociação. A fila dava 5 dias por causa de um limite que existe pra
  // proteger uma linha de WhatsApp que elas não usam.
  it('a rampa cheia do vermelho NÃO segura o card calado', async () => {
    for (let i = 100; i < 110; i++) carimbo(i, hojeCedo(), hojeCedo(), 'fala');
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
  });

  it('nem o card em negociação, que também é calado', async () => {
    for (let i = 100; i < 110; i++) carimbo(i, hojeCedo(), hojeCedo(), 'fala');
    fichas = [ficha({ status: 'chave_na_mao', quando: horasAtras(72) })];
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(fichas[0].status).toBe('chave_na_mao');
  });

  it('mas a rampa do calado também fecha, no número dela', async () => {
    process.env.EP_REAGENDA_MUDO_POR_DIA = '2';
    for (let i = 100; i < 102; i++) carimbo(i, hojeCedo(), hojeCedo(), 'mudo');
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('rampa_do_dia_cheia');
  });

  // Carimbo gravado antes de 01/10 não tem `relogio`. Contar como calado abriria
  // a torneira da linha no dia da virada: o que já foi falado hoje deixaria de
  // gastar o teto que protege a linha. Conta como `fala`.
  it('carimbo sem `relogio` gasta a rampa do vermelho, não a do calado', async () => {
    for (let i = 100; i < 110; i++) carimbo(i, hojeCedo(), hojeCedo());
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(2) })];
    expect((await tick()).motivo).toBe('rampa_do_dia_cheia');
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('o carimbo que o módulo grava diz de qual relógio ele é', async () => {
    fichas = [ficha({ id: 9, status: 'agendado', quando: horasAtras(8) })];
    await tick();
    expect(state.get('ep_reagenda_auto:9')?.value?.relogio).toBe('mudo');
    fichas = [ficha({ id: 11, status: 'nao_atendeu', quando: horasAtras(2) })];
    await tick();
    expect(state.get('ep_reagenda_auto:11')?.value?.relogio).toBe('fala');
  });

  it('carimbo sem `ultimo` legível não conta: formato velho não trava a fila', async () => {
    for (let i = 100; i < 115; i++)
      state.set(`ep_reagenda_auto:${i}`, { key: `ep_reagenda_auto:${i}`, value: { n: 1 }, updated_at: new Date(AGORA).toISOString() });
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('consulta quebrada continua fechando a porta, não abrindo', async () => {
    rampaQuebrada = true;
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('erro_rampa');
  });
});

// ── O CARD EM NEGOCIAÇÃO VOLTA PRA AGENDA A CADA 48H (01/10/2026) ──────────
//
// "Chave na mão, arrendamento, negociando, 50-50: ele volta sempre 48 horas
// depois, pra ficar rodando e a gente fechar ou não fechar." E, olhando os
// parados: "quero a lista lançada na regra".
//
// Até aqui o ciclo de 48h existia só como desenho no quadro do CRM: o card
// mudava de coluna, mas não voltava pra agenda de ninguém. Quadro não é
// compromisso; agenda é. Medido em 01/10: 60 cards nos quatro modelos
// (Thiago 38, Diego 22), 94% deles passados das 48h.
describe('o ciclo da negociação (a escada começa em 24h)', () => {
  const MODELOS = ['chave_na_mao', 'meio_a_meio', 'carregador', 'arrendamento',
    'em_atendimento', 'fez_orcamento', 'proposta_apresentada'];
  const QUINZE = '2026-08-21T16:15:00.000Z';   // sexta 13:15 BRT
  const emNegociacao = (st: string, h = 25) =>
    ficha({ status: st, quando: horasAtras(h) });

  it('os sete estágios do funil voltam depois de 24h', async () => {
    for (const st of MODELOS) {
      fichas = [emNegociacao(st)];
      state.clear(); updates.length = 0; vagas = [QUINZE];
      expect((await tick()).remarcados).toBe(1);
    }
  });

  it('antes de 24h não encosta', async () => {
    fichas = [emNegociacao('chave_na_mao', 20)];
    expect((await tick()).remarcados).toBe(0);
  });

  // A REGRA MAIS IMPORTANTE DESTE BLOCO. Forçar `agendado` apagaria a
  // classificação do funil — a informação que diz por qual porta o cliente está
  // entrando — e, pior, devolveria a ficha pra régua da agenda, que fala com o
  // cliente. O status diferente de `agendado` é o que a mantém muda.
  it('o card NÃO perde o status: chave na mão volta chave na mão', async () => {
    fichas = [emNegociacao('chave_na_mao')];
    vagas = [QUINZE];
    await tick();
    expect(fichas[0].status).toBe('chave_na_mao');
    expect(updates[0].patch.status).toBeUndefined();
  });

  it('e não zera carimbo nenhum: quem negocia já falou com a gente', async () => {
    fichas = [emNegociacao('arrendamento')];
    vagas = [QUINZE];
    await tick();
    const p = updates[0].patch;
    expect(p).not.toHaveProperty('lead_resposta_at');
    expect(p).not.toHaveProperty('confirmacao_at');
    expect(p).not.toHaveProperty('presenca_confirmada_at');
    expect(Object.keys(p).sort()).toEqual(['historico', 'quando']);
  });

  it('vai pra faixa dos QUINZE, não pro horário redondo da vitrine', async () => {
    fichas = [emNegociacao('meio_a_meio')];
    vagas = [QUINZE];
    await tick();
    expect(pedidos[0]!.faixa).toBe('remarcacao');
  });

  it('o vermelho e o esquecido continuam no horário redondo', async () => {
    for (const st of ['nao_atendeu', 'agendado']) {
      fichas = [ficha({ status: st, quando: horasAtras(8) })];
      pedidos.length = 0; state.clear(); vagas = [SEXTA_13H];
      await tick();
      expect(pedidos[0]!.faixa).toBe('novo');
    }
  });

  it('nada é enviado ao cliente', async () => {
    fichas = [emNegociacao('chave_na_mao')];
    vagas = [QUINZE];
    await tick();
    expect(enviadas).toHaveLength(0);
  });

  // O CARIMBO AQUI É O QUE O MÓDULO DE FATO GRAVA depois de 11 voltas na mesma
  // etiqueta. A versão anterior deste teste usava um carimbo SEM `status`, que
  // cai no degrau 1: ele passava com 50h de parada e não provava teto nenhum,
  // só que o degrau 1 basta. Agora ele mede o degrau 12, que pede 168h.
  const onzeVoltas = (st: string) => state.set('ep_reagenda_auto:3', {
    key: 'ep_reagenda_auto:3',
    value: { n: 11, ultimo: horasAtras(400), relogio: 'mudo', status: st, degrau: 11 },
    updated_at: horasAtras(400),
  });

  it('volta pra sempre: não tem teto de voltas (o degrau sobe, o teto não existe)', async () => {
    onzeVoltas('carregador');
    fichas = [emNegociacao('carregador', 169)];      // o degrau 12 pede 168h
    vagas = [QUINZE];
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('ep_reagenda_auto:3')?.value?.degrau).toBe(12);
  });

  it('e no degrau 12 ele espera as 168h: 160h não bastam', async () => {
    onzeVoltas('carregador');
    fichas = [emNegociacao('carregador', 160)];
    vagas = [QUINZE];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('todos_no_degrau');
  });

  // IDA E VOLTA, sem helper no meio: o segundo tick lê o carimbo que o PRIMEIRO
  // escreveu. É o único teste que pega divergência entre quem grava e quem lê —
  // e essa divergência já existiu neste arquivo (o leitor descartava campos).
  it('ida e volta: o segundo tick lê o carimbo que o primeiro escreveu', async () => {
    fichas = [emNegociacao('arrendamento', 60)];
    vagas = [QUINZE];
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('ep_reagenda_auto:3')?.value?.degrau).toBe(1);
    // A ficha foi pro futuro. Trago o horário pra trás na mão pra medir os
    // PRÓXIMOS degraus: o 2 pede 48h, o 3 repete as 48h, e só o 4 sobe pra 72h.
    for (const [degrau, cedo, tarde] of [[2, 40, 49], [3, 40, 49], [4, 60, 73]] as const) {
      fichas[0].quando = horasAtras(cedo);
      expect((await tick()).remarcados, 'degrau ' + degrau + ' cedo demais').toBe(0);
      fichas[0].quando = horasAtras(tarde);
      expect((await tick()).remarcados, 'degrau ' + degrau + ' no prazo').toBe(1);
      expect(state.get('ep_reagenda_auto:3')?.value?.degrau).toBe(degrau);
    }
  });

  it('o histórico diz que é ciclo, e não que a pessoa faltou', async () => {
    fichas = [emNegociacao('chave_na_mao')];
    vagas = [QUINZE];
    await tick();
    const h = String(fichas[0].historico || '');
    expect(h).not.toContain('não apareceu');
    expect(h).not.toContain('sem desfecho');
    expect(h).toContain('Ciclo de 24h');
    expect(h).toContain('Apalavrado');
  });

  // APALAVRADO saiu desta lista em 01/10: ele não é mais fim de linha, é sala de
  // espera com DATA, e quem segura a ficha é a marca. O teste disso está no
  // bloco da sala de espera, junto com o que acontece depois do prazo.

  it('vendido e sem interesse também ficam de fora', async () => {
    for (const st of ['fechou', 'sem_interesse', 'cancelado']) {
      fichas = [ficha({ status: st, quando: horasAtras(100) })];
      expect((await tick()).remarcados).toBe(0);
    }
  });

  it('o prazo é configurável sem deploy', async () => {
    process.env.EP_NEGOCIACAO_H = '12';
    fichas = [emNegociacao('chave_na_mao', 20)];
    vagas = [QUINZE];
    expect((await tick()).remarcados).toBe(1);
  });
});

// ── O CARD VOLTA COM A MESMA CARA (01/10/2026) ─────────────────────────────
//
// "Deixa cair sempre como confirmada mesmo, com a mesma cor." Ordem do Thiago
// olhando a agenda do Diego cheia de card rosa.
//
// O caminho mudo zerava `presenca_confirmada_at` e carimbava `confirmacao_at`,
// e essa combinação é exatamente o que a grade pinta como "NÃO CONFIRMOU": o
// card dizendo que o cliente foi perguntado e calou, sobre gente que tinha
// confirmado presença de verdade.
describe('o card que volta mudo não perde o que já era', () => {
  it('o card esquecido leva só horário e histórico', async () => {
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    vagas = [SEXTA_13H];
    await tick();
    expect(Object.keys(updates[0].patch).sort()).toEqual(['historico', 'quando']);
  });

  it('presença confirmada sobrevive: continua verde', async () => {
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8), presenca_confirmada_at: '2026-08-19T10:00:00.000Z' })];
    vagas = [SEXTA_13H];
    await tick();
    expect(updates[0].patch).not.toHaveProperty('presenca_confirmada_at');
    expect(fichas[0].presenca_confirmada_at).toBe('2026-08-19T10:00:00.000Z');
  });

  it('mas o vermelho, que FALA, continua saindo limpo', async () => {
    // Ele volta pra régua da agenda e precisa poder ser confirmado de novo.
    fichas = [ficha({ status: 'nao_atendeu', quando: horasAtras(2) })];
    vagas = [SEXTA_13H];
    await tick();
    const p = updates[0].patch;
    expect(p).toHaveProperty('confirmacao_at', null);
    expect(p).toHaveProperty('presenca_confirmada_at', null);
    expect(p).toHaveProperty('lead_resposta_at', null);
  });
});

// ── QUEM ESCREVEU DEPOIS DA REUNIÃO VOLTA, SE FOR CALADO ───────────────────
//
// O filtro existe pra não atropelar conversa viva com mensagem nossa. Os
// caminhos mudos não mandam mensagem, e quem escreveu depois é justamente quem
// o consultor precisa retornar: eram 10 fichas ficando de fora por isso.
describe('quem escreveu depois da reunião', () => {
  // 8h basta pro esquecido; a negociação exige 48h, então o fixture usa 50.
  const escreveu = (st: string, h = 8) => ficha({
    status: st, quando: horasAtras(h),
    lead_resposta_at: new Date(AGORA.getTime() - 3 * 3600_000).toISOString(),
  });

  it('o card esquecido volta mesmo tendo escrito', async () => {
    fichas = [escreveu('agendado')];
    vagas = [SEXTA_13H];
    expect((await tick()).remarcados).toBe(1);
  });

  it('o card em negociação também', async () => {
    fichas = [escreveu('chave_na_mao', 50)];
    vagas = ['2026-08-21T16:15:00.000Z'];
    expect((await tick()).remarcados).toBe(1);
  });

  it('mas o vermelho continua de fora: essa conversa tem dono', async () => {
    fichas = [escreveu('nao_atendeu')];
    expect((await tick()).remarcados).toBe(0);
  });
});

// ── "ATÉ ESSE CLIENTE TER UM DESTINO FINAL E PARAR DE RODAR" ───────────────
//
// Ordem do Thiago (01/10/2026): "tudo que fica pra trás tem que ser remarcado na
// agenda à frente, com as regras de tempo de cada um já definido; será cíclico
// até esse cliente ter um destino final e parar de rodar".
//
// A regra deixou de ser uma LISTA DO QUE ENTRA e virou uma lista do que NÃO
// entra. Toda allowlist tem o mesmo defeito: o status criado depois nasce de
// fora, calado, e ninguém descobre até um cliente sumir. Foi assim que 68 fichas
// de eletroposto ficaram sem robô nenhum.
describe('quem roda e quem para de rodar', () => {
  const relogio = async (st: string) =>
    (await import('../services/io/eletropostoReagendaAuto')).relogioDoCiclo(st);

  it('os cinco destinos finais param de rodar', async () => {
    for (const st of ['fechou', 'sem_interesse', 'cancelado', 'perdido', 'fechou_concorrente']) {
      expect(await relogio(st)).toBeNull();
    }
  });

  it('apalavrado roda no relógio da negociação: quem o segura é a MARCA', async () => {
    // Até 01/10 este relógio devolvia `null` pra ele, e isso prendia pra sempre
    // os cards que ficaram com o status antigo — nada no sistema o remove.
    expect(await relogio('apalavrado')).toBe('negocia');
  });

  it('cada um com o seu relógio', async () => {
    expect(await relogio('nao_atendeu')).toBe('fala');       // 45 min, com mensagem
    expect(await relogio('agendado')).toBe('esquecido');     // 6h, calado
    expect(await relogio('chave_na_mao')).toBe('negocia');   // 48h, calado
  });

  // O CORAÇÃO DA INVERSÃO: status que ninguém previu nasce RODANDO.
  it('status novo, que ninguém escreveu aqui, nasce rodando', async () => {
    for (const st of ['falando_whatsapp', 'reagendar', 'sem_orcamento', 'status_que_nao_existe_ainda']) {
      expect(await relogio(st)).toBe('negocia');
    }
  });

  it('e roda de verdade: falando_whatsapp volta depois de 48h', async () => {
    fichas = [ficha({ status: 'falando_whatsapp', quando: horasAtras(50) })];
    vagas = ['2026-08-21T16:15:00.000Z'];
    expect((await tick()).remarcados).toBe(1);
    expect(fichas[0].status).toBe('falando_whatsapp');
  });

  it('e quem tem destino final não volta, por mais velho que seja', async () => {
    for (const st of ['fechou', 'sem_interesse', 'cancelado']) {
      fichas = [ficha({ status: st, quando: horasAtras(24 * 30) })];
      expect((await tick()).remarcados).toBe(0);
    }
  });
});

// ── O HORÁRIO NOVO DO VERMELHO NÃO É EM CIMA DA HORA (07/10/2026) ──────────
//
// A fila que ficou presa cinco dias é de reuniões de dias atrás, e pra elas a
// busca começava AGORA: destravar às 16h30 mandaria "já separei outro: hoje
// 17h". O vermelho passa a buscar com 3h de antecedência; o calado não avisa
// ninguém e continua buscando de agora.
describe('a antecedência do horário novo', () => {
  it('perdida ONTEM e vista agora: a busca começa 3h à frente', async () => {
    fichas = [ficha({ quando: horasAtras(26) })];
    await tick();
    expect(pedidos[0]!.agora).toBe(AGORA.getTime() + 180 * 60_000);
  });

  it('perdida HOJE: continua sendo o dia seguinte, como sempre foi', async () => {
    await tick();
    expect(new Date(pedidos[0]!.agora).toISOString()).toBe('2026-08-21T03:00:00.000Z');
  });

  it('o calado não ganha antecedência: ele não avisa ninguém', async () => {
    fichas = [ficha({ status: 'agendado', quando: horasAtras(26) })];
    await tick();
    expect(pedidos[0]!.agora).toBe(AGORA.getTime());
  });

  it('a antecedência muda sem deploy', async () => {
    process.env.EP_REAGENDA_FALA_ANTECEDENCIA_MIN = '0';
    fichas = [ficha({ quando: horasAtras(26) })];
    await tick();
    expect(pedidos[0]!.agora).toBe(AGORA.getTime());
  });
});

// ── OS TRÊS FUROS DA REVISÃO ANTI-BAN DE 07/10/2026 ─────────────────────────
//
// O conserto de 07/10 (o vermelho voltou a falar, com espaçamento de 15 min)
// subiu às 16h20 e a revisão achou três jeitos de o freio não segurar. Os
// testes abaixo caem no código daquele commit. Nenhum deles corta remarcação:
// o que não sai agora continua na fila, sem tentativa gasta.
// Mesma fórmula do chaveDaVez (quarto de hora de Brasília); o teste da chave
// confere a do módulo. Aqui é síncrona para os ajudantes.
const chaveVez = (ms: number) => {
  const d = new Date(ms - 3 * 3600_000);
  return `ep_reagenda_vez:${d.toISOString().slice(0, 10)}T${String(d.getUTCHours()).padStart(2, "0")}:${Math.floor(d.getUTCMinutes() / 15)}`;
};
const vezesNoBanco = () => [...state.keys()].filter(k => k.startsWith('ep_reagenda_vez:'));

describe('três relógios: uma fala por quarto de hora', () => {
  it('a chave da vez é o quarto de hora de Brasília', async () => {
    const { chaveDaVez } = await import('../services/io/eletropostoReagendaAuto');
    // 18h00 UTC = 15h00 BRT
    expect(chaveDaVez(AGORA.getTime())).toBe('ep_reagenda_vez:2026-08-20T15:0');
    expect(chaveDaVez(AGORA.getTime() + (14 * 60 + 59) * 1000)).toBe('ep_reagenda_vez:2026-08-20T15:0');
    expect(chaveDaVez(AGORA.getTime() + 15 * 60_000)).toBe('ep_reagenda_vez:2026-08-20T15:1');
    expect(chaveDaVez(AGORA.getTime() + 59 * 60_000)).toBe('ep_reagenda_vez:2026-08-20T15:3');
    // 02h59 UTC do dia 21 ainda é 23h59 do dia 20 em Brasília
    expect(chaveDaVez(new Date('2026-08-21T02:59:00.000Z').getTime())).toBe('ep_reagenda_vez:2026-08-20T23:3');
  });

  // A corrida de 16h30m34s e 16h30m36s de 07/10: dois relógios passam o
  // espaçamento juntos (o carimbo só é gravado depois do envio). No código
  // daquele dia, o que perdia a ficha 1 pulava pra ficha 2 e saíam DUAS falas.
  it('dois ticks ao mesmo tempo no mesmo quarto de hora: só UM fala', async () => {
    fichas = [
      ficha({ id: 51, quando: horasAtras(3) }),
      ficha({ id: 52, quando: horasAtras(2.5) }),
      ficha({ id: 53, quando: horasAtras(2.2) }),
    ];
    // Os dois ticks só passam daqui juntos: os dois já leram o espaçamento.
    let chegaram = 0;
    let soltar!: () => void;
    const juntos = new Promise<void>(r => { soltar = r; });
    aoPedirVagas = async () => { if (++chegaram === 2) soltar(); await juntos; };
    const mod = await import('../services/io/eletropostoReagendaAuto');
    const [a, b] = await Promise.all([
      mod.runEletropostoReagendaAutoTick(), mod.runEletropostoReagendaAutoTick(),
    ]);
    expect(enviadas).toHaveLength(1);
    expect(a.remarcados + b.remarcados).toBe(1);
    // E ninguém se perdeu: as outras duas continuam vermelhas, na fila.
    expect(fichas.filter(f => f.status === 'nao_atendeu')).toHaveLength(2);
    expect(vezesNoBanco()).toHaveLength(1);
  });

  // Uma chave por quarto de hora sozinha deixaria passar este: um relógio às
  // 15h14m59s e outro às 15h15m01s pegam chaves diferentes.
  it('na virada do quarto de hora (15h14m59s e 15h15m01s) também não saem duas', async () => {
    vi.setSystemTime(new Date(AGORA.getTime() + (14 * 60 + 59) * 1000));
    fichas = [
      ficha({ id: 61, quando: horasAtras(3) }),
      ficha({ id: 62, quando: horasAtras(2.5) }),
    ];
    // O segundo tick fica parado na agenda até o primeiro pegar a vez; aí o
    // relógio anda 2 s e cruza o quarto de hora.
    let n = 0;
    let soltarB!: () => void;
    const bPode = new Promise<void>(r => { soltarB = r; });
    aoPedirVagas = async () => { if (++n === 2) await bPode; };
    aoInserir = (k) => {
      if (k.startsWith('ep_reagenda_vez:')) { vi.setSystemTime(new Date(Date.now() + 2000)); soltarB(); }
    };
    const mod = await import('../services/io/eletropostoReagendaAuto');
    const pa = mod.runEletropostoReagendaAutoTick();
    // Sem vez nenhuma (o código antigo), o segundo sai quando o primeiro acaba.
    void pa.then(() => soltarB());
    const pb = mod.runEletropostoReagendaAutoTick();
    await Promise.all([pa, pb]);
    expect(enviadas.length).toBeLessThanOrEqual(1);
    // A vez de quem desistiu foi devolvida: só sobra a chave de quem falou.
    expect(vezesNoBanco()).toHaveLength(enviadas.length);
  });

  it('a vez é pega ANTES de mexer na ficha, e quem falou fica com ela', async () => {
    let vezNaHora: string[] | null = null;
    aplicarUpdateGancho = () => { if (vezNaHora === null) vezNaHora = vezesNoBanco(); };
    expect((await tick()).remarcados).toBe(1);
    expect(vezNaHora).toEqual(['ep_reagenda_vez:2026-08-20T15:0']);
    expect(state.get('ep_reagenda_vez:2026-08-20T15:0')?.value).toMatchObject({ ficha: 3 });
  });

  it('pegou a vez e o vermelho não mudou de dia: a vez é devolvida pra outro relógio', async () => {
    // A pessoa tira a ficha do vermelho entre a leitura e a gravação.
    aoPedirVagas = () => { fichas[0].status = 'em_atendimento'; };
    expect((await tick()).remarcados).toBe(0);
    expect(vezesNoBanco()).toEqual([]);
    expect(apagados).toContain('ep_reagenda_vez:2026-08-20T15:0');
  });

  it('a vez deste quarto é de outro relógio: o vermelho espera e o calado anda', async () => {
    state.set('ep_reagenda_vez:2026-08-20T15:0', {
      key: 'ep_reagenda_vez:2026-08-20T15:0', value: { em: AGORA.toISOString(), ficha: 999 }, updated_at: AGORA.toISOString(),
    });
    fichas = [
      ficha({ id: 71, quando: horasAtras(3) }),
      ficha({ id: 72, status: 'agendado', quando: horasAtras(8) }),
    ];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(fichas.find(f => f.id === 71)!.status).toBe('nao_atendeu');
    expect(updates.map(u => u.id)).toEqual([72]);
    // E a vez do outro relógio não é apagada por quem perdeu.
    expect(state.has('ep_reagenda_vez:2026-08-20T15:0')).toBe(true);
  });

  it('no quarto de hora seguinte, passado o espaçamento, a ficha que esperou fala', async () => {
    fichas = [ficha({ id: 81, quando: horasAtras(3) }), ficha({ id: 82, quando: horasAtras(2.5) })];
    await tick();
    expect(enviadas).toHaveLength(1);
    vi.setSystemTime(new Date(AGORA.getTime() + 16 * 60_000));
    await tick();
    expect(enviadas).toHaveLength(2);
    expect(fichas.every(f => f.status === 'agendado')).toBe(true);
  });
});

describe('a leitura do espaçamento não pode ser cortada', () => {
  const carimbo = (id: number, quando: string, relogio: 'fala' | 'mudo') =>
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`, value: { n: 1, ultimo: quando, relogio }, updated_at: quando,
    });
  const ontem = () => new Date(AGORA.getTime() - 30 * 3600_000).toISOString();

  // Ninguém apaga estes carimbos (309 em 07/10). Passando de mil, a leitura sem
  // ordem e com limit 1000 perdia a última fala e o freio abria calado.
  it('1500 carimbos antigos e 1 recente: o freio de 15 min segura', async () => {
    for (let i = 0; i < 1500; i++) carimbo(10_000 + i, ontem(), 'fala');
    carimbo(900, new Date(AGORA.getTime() - 5 * 60_000).toISOString(), 'fala');
    // E o calado mais novo não esconde a fala: é a última FALA que conta.
    for (let i = 0; i < 5; i++) carimbo(20_000 + i, new Date(AGORA.getTime() - 60_000).toISOString(), 'mudo');
    const r = await tick();
    expect(r.motivo).toBe('espacamento_da_fala');
    expect(enviadas).toHaveLength(0);
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('e com a última fala há 16 min, o vermelho anda: o freio não fecha pra sempre', async () => {
    for (let i = 0; i < 1500; i++) carimbo(10_000 + i, ontem(), 'fala');
    carimbo(900, new Date(AGORA.getTime() - 16 * 60_000).toISOString(), 'fala');
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  it('a rampa do dia também não perde os de HOJE no corte', async () => {
    process.env.EP_REAGENDA_POR_DIA = '10';
    for (let i = 0; i < 1500; i++) carimbo(10_000 + i, ontem(), 'fala');
    const cedo = new Date(AGORA.getTime() - 2 * 3600_000).toISOString();
    for (let i = 0; i < 10; i++) carimbo(30_000 + i, cedo, 'fala');
    const r = await tick();
    expect(r.motivo).toBe('rampa_do_dia_cheia');
    expect(enviadas).toHaveLength(0);
  });

  it('a leitura da última fala quebrou: o vermelho espera, o calado anda', async () => {
    // Só quebra a consulta que filtra por `relogio`, que é a do espaçamento.
    colunaDeGancho = (col) => { if (col === 'value->>relogio') throw new Error('boom'); };
    carimbo(950, ontem(), 'mudo');   // uma linha pro filtro ter o que ler
    fichas =[ficha({ id: 91, quando: horasAtras(3) }), ficha({ id: 92, status: 'agendado', quando: horasAtras(8) })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(updates.map(u => u.id)).toEqual([92]);
  });
});

describe('a linha que acabou de voltar', () => {
  // Uma fala de verdade deixa o carimbo da ficha E a chave da vez daquele quarto
  // de hora. A rampa de reconexão conta pela vez (nunca reescrita).
  const fala = (id: number, quando: string) => {
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`, value: { n: 1, ultimo: quando, relogio: 'fala' }, updated_at: quando,
    });
    const vez = chaveVez(Date.parse(quando));
    state.set(vez, { key: vez, value: { em: quando, ficha: id }, updated_at: quando });
  };
  const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();
  // Como em produção: a rampa do dia do vermelho em 40, pra ela não mascarar a
  // de reconexão.
  beforeEach(() => { process.env.EP_REAGENDA_POR_DIA = '40'; });

  it('no dia da volta ela ANDA: sem fala na última hora, o vermelho sai', async () => {
    rampaAgora = { hora: 2, dia: 10 };
    expect((await tick()).remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  // O piso de 16/h passava por cima da rampa (max(2, 16) = 16): no dia da volta,
  // 40 "você não conseguiu entrar" pras fichas acumuladas durante a queda.
  it('2 falas na última hora com a rampa em 2/h: espera, e a ficha NÃO se perde', async () => {
    rampaAgora = { hora: 2, dia: 10 };
    fala(901, minAtras(20));
    fala(902, minAtras(40));
    const r = await tick();
    expect(r.motivo).toBe('rampa_de_reconexao');
    expect(r.remarcados).toBe(0);
    expect(updates).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
    expect(fichas[0].status).toBe('nao_atendeu');
    expect(state.has('ep_reagenda_auto:3')).toBe(false);   // sem tentativa gasta
    expect(vezesNoBanco()).toHaveLength(2);                // só as duas das falas antigas
    // Passada a hora, a MESMA ficha anda no tick seguinte.
    vi.setSystemTime(new Date(AGORA.getTime() + 45 * 60_000));
    const r2 = await tick();
    expect(r2.remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
    expect(fichas[0].status).toBe('agendado');
  });

  it('o teto do dia da rampa também vale: 10 falas em 24h seguram a 11ª', async () => {
    rampaAgora = { hora: 2, dia: 10 };
    for (let i = 0; i < 10; i++) fala(910 + i, minAtras(90 + i * 100));
    expect((await tick()).motivo).toBe('rampa_de_reconexao');
    expect(enviadas).toHaveLength(0);
  });

  it('no 3º dia a rampa é 4/h: 2 falas na hora já não seguram', async () => {
    rampaAgora = { hora: 4, dia: 30 };
    fala(901, minAtras(20));
    fala(902, minAtras(40));
    expect((await tick()).remarcados).toBe(1);
  });

  it('a rampa não segura o calado: ele não usa a linha', async () => {
    rampaAgora = { hora: 2, dia: 10 };
    fala(901, minAtras(20));
    fala(902, minAtras(40));
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('linha aquecida (sem rampa): as mesmas 2 falas na hora não seguram nada', async () => {
    fala(901, minAtras(20));
    fala(902, minAtras(40));
    expect((await tick()).remarcados).toBe(1);
  });

  // Troca de status no /gerador reescreve o ep_reagenda_auto:<id> (rota
  // /gerador/apalavrado/soltar) sem mensagem nenhuma. Isso não pode contar como
  // fala na rampa: agenda nunca bloqueia por coisa que não saiu.
  it('carimbo reescrito pela troca de status (sem vez) não conta na rampa', async () => {
    rampaAgora = { hora: 2, dia: 10 };
    for (const id of [901, 902, 903]) {
      state.set(`ep_reagenda_auto:${id}`, {
        key: `ep_reagenda_auto:${id}`, value: { n: 1, ultimo: minAtras(600), relogio: 'fala' }, updated_at: minAtras(30),
      });
    }
    const r = await tick();
    expect(r.motivo).not.toBe('rampa_de_reconexao');
    expect(r.remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });
});

describe('a vez com o banco instável', () => {
  it('insert da vez com erro de rede (não 23505): o vermelho fala uma vez, não cala', async () => {
    falhaInsert = (k) => k.startsWith('ep_reagenda_vez:');
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  it('erro de rede mas outra vez recente na vizinhança: não fala (a dupla continua impossível)', async () => {
    falhaInsert = (k) => k.startsWith('ep_reagenda_vez:');
    const outra = chaveVez(AGORA.getTime() - 5 * 60_000);
    state.set(outra, { key: outra, value: { em: 'x', ficha: 1 }, updated_at: new Date(AGORA.getTime() - 5 * 60_000).toISOString() });
    const r = await tick();
    expect(enviadas).toHaveLength(0);
    expect(r.remarcados).toBe(0);
  });
});
