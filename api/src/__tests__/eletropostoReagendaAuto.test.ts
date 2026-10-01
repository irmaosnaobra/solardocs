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
const updates: Array<{ id: number; patch: any }> = [];

function aplicarUpdate(q: any) {
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

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_col: string, chaves: string[]) => ({
          data: chaves.filter(k => state.has(k)).map(k => state.get(k)), error: null,
        }),
        // A rampa do dia: conta os carimbos `ep_reagenda_auto:` de hoje. O mock
        // devolve o que está no `state` com o prefixo pedido, e `rampaQuebrada`
        // simula a consulta falhando (que tem que FECHAR a porta, não abrir).
        like: (_col: string, padrao: string) => {
          const prefixo = padrao.replace(/%$/, '');
          const linhas = (desde?: string) => {
            if (rampaQuebrada) return { data: null, error: { message: 'boom' } };
            return {
              data: [...state.values()].filter((r: any) =>
                String(r.key).startsWith(prefixo)
                && (desde === undefined || String(r.updated_at || '') >= desde)),
              error: null,
            };
          };
          return {
            // A rampa deixou de filtrar por `updated_at` no servidor (01/10):
            // ela traz os carimbos e conta pelo `value.ultimo`, que é o dado que
            // o próprio módulo escreve. O mock serve as duas formas.
            limit: async () => linhas(),
            gte: (_c: string, desde: string) => ({ limit: async () => linhas(desde) }),
          };
        },
      }),
      upsert: async (r: any) => { state.set(r.key, r); return { error: null }; },
      delete: () => ({
        in: async (_col: string, chaves: string[]) => {
          for (const k of chaves) { apagados.push(k); state.delete(k); }
          return { error: null };
        },
      }),
    }),
  },
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

// A grade (quais horas existem em cada dia, feriado, quem já ocupa) é do
// `eletropostoVagas` e tem teste próprio. Aqui só interessa QUAL janela o módulo
// pede e QUAL dos horários devolvidos ele escolhe.
let vagas: string[] | null = [];
const pedidos: Array<{ dono: string; agora: number; quantas: number; faixa?: string }> = [];
/** Gancho pra simular o que acontece ENTRE a leitura da ficha e a gravação. */
let aoPedirVagas: (() => void) | null = null;
vi.mock('../services/io/eletropostoVagas', async (real) => {
  const orig = await real() as any;
  return {
    ...orig,
    proximasVagas: vi.fn(async (dono: string, quantas: number, opts: any) => {
      pedidos.push({ dono, quantas, agora: opts?.agora, faixa: opts?.faixa });
      aoPedirVagas?.();
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

const enviadas: Array<{ tel: string; bolhas: string[] }> = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (tel: string, bolhas: string[]) => { enviadas.push({ tel, bolhas }); }),
}));

let tetoLivre = true;
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoLivre),
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
  tetoLivre = true;
  rampaQuebrada = false;
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
    expect(updates[0].patch.historico).toContain('Reagendamento automático 1/2');
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

  it('para na segunda volta: quem já foi remarcado 2 vezes vira assunto de gente', async () => {
    state.set('ep_reagenda_auto:3', { key: 'ep_reagenda_auto:3', value: { n: 2, ultimo: horasAtras(24) }, updated_at: horasAtras(24) });
    const r = await tick();
    expect(r.motivo).toBe('ninguem_na_vez');
    expect(fichas[0].status).toBe('nao_atendeu');
  });

  it('a segunda tentativa avisa que é a última', async () => {
    state.set('ep_reagenda_auto:3', { key: 'ep_reagenda_auto:3', value: { n: 1, ultimo: horasAtras(24) }, updated_at: horasAtras(24) });
    await tick();
    expect(enviadas[0].bolhas[2]).toContain('último horário');
  });

  // 29/09/2026 INVERTEU ISTO. O piso duro de 20/08 existia pra ligar o módulo não
  // despejar o estoque velho; a ordem nova é justamente ir buscar o estoque velho
  // ("mesmo os mais antigos, podemos recuperar pessoas"). Quem passou a segurar o
  // despejo é a rampa diária, testada logo abaixo.
  it('vermelho VELHO entra: é pra isso que a régua nova existe', async () => {
    fichas = [ficha({ quando: '2026-06-12T16:00:00.000Z' })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(fichas[0].status).toBe('agendado');
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
    // E a segunda É a última (o Thiago fechou em 2 voltas): a copy tem que dizer.
    expect(enviadas[0].bolhas[2]).toContain('último horário');
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

  it('o vermelho para no teto de 2, como sempre parou', async () => {
    fichas = [ficha({ id: 7, status: 'nao_atendeu', quando: horasAtras(2) })];
    jaFoi(7, 2);
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
  const carimbo = (id: number, ultimo: string, updatedAt: string) =>
    state.set(`ep_reagenda_auto:${id}`, {
      key: `ep_reagenda_auto:${id}`, value: { n: 1, ultimo }, updated_at: updatedAt,
    });

  it('carimbo VELHO com updated_at de hoje não fecha a rampa', async () => {
    // Exatamente o caso de produção: 10 carimbos antigos que, por qualquer
    // motivo, têm `updated_at` recente. Nenhum deles é trabalho de hoje.
    for (let i = 100; i < 110; i++) carimbo(i, horasAtras(72), new Date(AGORA).toISOString());
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('10 carimbos de HOJE fecham a rampa, que é o que ela existe pra fazer', async () => {
    const hojeCedo = new Date(AGORA.getTime() - 2 * 3600_000).toISOString();
    for (let i = 100; i < 110; i++) carimbo(i, hojeCedo, hojeCedo);
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('rampa_do_dia_cheia');
  });

  it('9 de hoje ainda deixam passar uma', async () => {
    const hojeCedo = new Date(AGORA.getTime() - 2 * 3600_000).toISOString();
    for (let i = 100; i < 109; i++) carimbo(i, hojeCedo, hojeCedo);
    fichas = [ficha({ status: 'agendado', quando: horasAtras(8) })];
    expect((await tick()).remarcados).toBe(1);
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
describe('o ciclo de 48h da negociação', () => {
  const MODELOS = ['chave_na_mao', 'meio_a_meio', 'carregador', 'arrendamento',
    'em_atendimento', 'fez_orcamento', 'proposta_apresentada'];
  const QUINZE = '2026-08-21T16:15:00.000Z';   // sexta 13:15 BRT
  const emNegociacao = (st: string, h = 50) =>
    ficha({ status: st, quando: horasAtras(h) });

  it('os sete estágios do funil voltam depois de 48h', async () => {
    for (const st of MODELOS) {
      fichas = [emNegociacao(st)];
      state.clear(); updates.length = 0; vagas = [QUINZE];
      expect((await tick()).remarcados).toBe(1);
    }
  });

  it('antes de 48h não encosta', async () => {
    fichas = [emNegociacao('chave_na_mao', 40)];
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

  it('volta pra sempre: não tem teto de voltas', async () => {
    state.set('ep_reagenda_auto:3', {
      key: 'ep_reagenda_auto:3', value: { n: 11, ultimo: horasAtras(72) }, updated_at: horasAtras(72),
    });
    fichas = [emNegociacao('carregador')];
    vagas = [QUINZE];
    expect((await tick()).remarcados).toBe(1);
  });

  it('o histórico diz que é ciclo, e não que a pessoa faltou', async () => {
    fichas = [emNegociacao('chave_na_mao')];
    vagas = [QUINZE];
    await tick();
    const h = String(fichas[0].historico || '');
    expect(h).not.toContain('não apareceu');
    expect(h).not.toContain('sem desfecho');
    expect(h).toContain('Ciclo de 48h');
    expect(h).toContain('Apalavrado');
  });

  it('APALAVRADO fica de fora da roda: é a sala de espera', async () => {
    fichas = [ficha({ status: 'apalavrado', quando: horasAtras(100) })];
    expect((await tick()).remarcados).toBe(0);
  });

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

  it('apalavrado também para: ele tem data própria', async () => {
    expect(await relogio('apalavrado')).toBeNull();
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
