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
              f.status === q._filtros['status']
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
const pedidos: Array<{ dono: string; agora: number; quantas: number }> = [];
/** Gancho pra simular o que acontece ENTRE a leitura da ficha e a gravação. */
let aoPedirVagas: (() => void) | null = null;
vi.mock('../services/io/eletropostoVagas', async (real) => {
  const orig = await real() as any;
  return {
    ...orig,
    proximasVagas: vi.fn(async (dono: string, quantas: number, opts: any) => {
      pedidos.push({ dono, quantas, agora: opts?.agora });
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
    expect(enviadas[0].bolhas[0]).toContain('Irmãos na Obra');
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

  it('estoque velho de vermelho não vira disparo: reunião anterior ao piso duro fica de fora', async () => {
    fichas = [ficha({ quando: '2026-08-12T16:00:00.000Z' })];
    const r = await tick();
    expect(r.motivo).toBe('nenhum_vermelho');
  });

  it('fora da janela de 9h–19h ninguém é remarcado', async () => {
    vi.setSystemTime(new Date('2026-08-20T23:30:00.000Z'));   // 20h30 BRT
    const r = await tick();
    expect(r.motivo).toBe('fora_da_janela');
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
