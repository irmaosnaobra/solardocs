import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SOLAR: QUEM NÃO ATENDEU VOLTA PRA AGENDA SOZINHO (ordem de 29/09/2026).
//
// Os riscos puxam pra lados opostos, igual ao módulo do eletroposto:
//   · MOVER DEMAIS — os 48 cards parados numa tarde só, o mesmo cliente duas
//     vezes, card de eletroposto (que tem régua própria), ou pra sempre;
//   · MOVER ERRADO — em cima de uma ligação que o consultor já tem marcada, num
//     domingo, num dia que a casa fechou, ou por cima de quem voltou a conversar.
//
// E um risco que é só deste: ele NÃO escreve pro cliente. Quem avisa é o
// `solarAgendaGiovanna`, e ele só avisa enquanto `bomdia_at` e `lembrete_5min_at`
// estão nulos. Esquecer de limpar os dois move o card em silêncio, e aí o cliente
// tem uma ligação marcada que ele nunca soube que existia.

const state = new Map<string, { key: string; value: any; updated_at: string }>();
let rampaQuebrada = false;
let cicloQuebrado = false;
let agendaQuebrada = false;

let vermelhos: any[] = [];
let futura: any[] = [];
const updates: Array<{ id: number; patch: any; exigiuStatus: string | null }> = [];
/** Simula alguém mexendo no card entre a leitura e a gravação. */
let updateNaoPega = false;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _status: null as string | null,
        _statusIn: null as string[] | null,
        _gte: null as string | null,
        _lte: null as string | null,
        _id: null as number | null,
        _patch: null as any,
        select() { return q; },
        eq(col: string, v: any) {
          if (col === 'status') q._status = v;
          if (col === 'id') q._id = v;
          if (q._patch) return q;
          return q;
        },
        in(col: string, v: string[]) { if (col === 'status') q._statusIn = v; return q; },
        gte(_c: string, v: string) { q._gte = v; return q; },
        lte(_c: string, v: string) { q._lte = v; return q; },
        order() { return q; },
        update(patch: any) { q._patch = patch; return q; },
        limit() {
          // Duas leituras usam `limit`: a dos vermelhos (status = nao_atendeu) e
          // a da agenda futura (status IN ...).
          if (q._statusIn) {
            if (agendaQuebrada) return Promise.resolve({ data: null, error: { message: 'boom' } });
            return Promise.resolve({ data: futura, error: null });
          }
          const out = vermelhos.filter(f =>
            (!q._status || f.status === q._status)
            && (!q._gte || f.quando >= q._gte)
            && (!q._lte || f.quando <= q._lte));
          return Promise.resolve({ data: out, error: null });
        },
        // O update termina em `.select('id')`, então o `then` do próprio objeto
        // é quem resolve: reproduz a cadeia real update().eq().eq().select().
        then(res: any) {
          const id = q._id as number;
          updates.push({ id, patch: q._patch, exigiuStatus: q._status });
          if (updateNaoPega) return res({ data: [], error: null });
          const alvo = vermelhos.find(f => f.id === id);
          if (alvo) Object.assign(alvo, q._patch);
          return res({ data: [{ id }], error: null });
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
        in: async (_col: string, chaves: string[]) => {
          if (cicloQuebrado) return { data: null, error: { message: 'boom' } };
          return { data: chaves.filter(k => state.has(k)).map(k => state.get(k)), error: null };
        },
        like: (_col: string, padrao: string) => ({
          gte: (_c: string, desde: string) => ({
            limit: async () => {
              if (rampaQuebrada) return { data: null, error: { message: 'boom' } };
              const prefixo = padrao.replace(/%$/, '');
              return {
                data: [...state.values()].filter((r: any) =>
                  String(r.key).startsWith(prefixo) && String(r.updated_at || '') >= desde),
                error: null,
              };
            },
          }),
        }),
      }),
      upsert: async (r: any) => { state.set(r.key, r); return { error: null }; },
    }),
  },
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agenda/agendaFechada', () => ({
  agendaFechadaNoIso: (iso: string) => String(iso).startsWith('2026-09-07'),
}));

// Quarta-feira, 30/09/2026, 11h BRT.
const AGORA = new Date('2026-09-30T14:00:00.000Z');
const envOriginal = { ...process.env };

const card = (over: any = {}) => ({
  id: 1,
  quando: '2026-09-25T11:15:00.000Z',
  cliente_nome: 'Veridiana',
  cliente_telefone: '5534998887766',
  vendedor_nome: 'Giovanna',
  created_by: 'lead-meta',
  status: 'nao_atendeu',
  lead_resposta_at: null,
  historico: null,
  ...over,
});

beforeEach(() => {
  vermelhos = [card()];
  futura = [];
  state.clear(); updates.length = 0;
  rampaQuebrada = false; cicloQuebrado = false; agendaQuebrada = false; updateNaoPega = false;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function tick(opts: any = {}) {
  return (await import('../services/agenda/reagendaSolarNaoAtendido')).runReagendaSolarTick(opts);
}

describe('mover o card', () => {
  it('não atendeu volta pra agendado, num horário futuro do mesmo consultor', async () => {
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.status).toBe('agendado');
    expect(new Date(updates[0].patch.quando).getTime()).toBeGreaterThan(AGORA.getTime());
    // Não troca de dono: mexer nisso mexeria na divisão que o repasse faz.
    expect(updates[0].patch.vendedor_nome).toBeUndefined();
  });

  // O DEFEITO QUE ESTE MÓDULO MAIS PODE CAUSAR. Ele não escreve pro cliente;
  // quem escreve é o solarAgendaGiovanna, e ele só escreve enquanto os dois
  // carimbos estão nulos. Sem isto o card muda de dia em silêncio.
  it('limpa os dois carimbos que calariam o dia novo', async () => {
    await tick();
    expect(updates[0].patch.bomdia_at).toBeNull();
    expect(updates[0].patch.lembrete_5min_at).toBeNull();
  });

  // E o que ele NÃO pode limpar: boas-vindas é do cadastro, já aconteceu.
  it('não zera boas_vindas_at — seria uma boas-vindas repetida', async () => {
    await tick();
    expect('boas_vindas_at' in updates[0].patch).toBe(false);
  });

  it('a volta vira linha no card', async () => {
    await tick();
    expect(updates[0].patch.historico).toContain('Remarcação automática 1/2');
    expect(updates[0].patch.historico).toContain('não atendeu');
  });

  it('o histórico antigo não é apagado', async () => {
    vermelhos = [card({ historico: 'linha velha' })];
    await tick();
    expect(updates[0].patch.historico).toContain('linha velha');
  });

  it('exige status nao_atendeu na gravação — corrida com gente', async () => {
    await tick();
    expect(updates[0].exigiuStatus).toBe('nao_atendeu');
  });

  it('alguém tirou do vermelho no meio do caminho: não conta e não carimba', async () => {
    updateNaoPega = true;
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(state.size).toBe(0);
  });
});

describe('onde a ligação cai', () => {
  it('nunca no passado', async () => {
    await tick();
    expect(new Date(updates[0].patch.quando).getTime()).toBeGreaterThan(AGORA.getTime());
  });

  it('nunca em domingo', async () => {
    await tick();
    const dow = new Date(`${updates[0].patch.quando.slice(0, 10)}T12:00:00-03:00`).getUTCDay();
    expect(dow).not.toBe(0);
  });

  it('pula o horário que o consultor já tem ocupado', async () => {
    // Enche o dia 01/10 inteiro na agenda da Giovanna.
    futura = [];
    for (let h = 8; h <= 17; h++) {
      for (const m of ['00', '15', '30', '45']) {
        futura.push({ quando: `2026-10-01T${String(h + 3).padStart(2, '0')}:${m}:00.000Z`, vendedor_nome: 'Giovanna', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' });
      }
    }
    await tick();
    expect(updates[0].patch.quando.slice(0, 10)).not.toBe('2026-10-01');
  });

  it('agenda de OUTRO consultor não bloqueia a vaga', async () => {
    futura = [{ quando: '2026-10-01T11:15:00.000Z', vendedor_nome: 'Nilce', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' }];
    const r = await tick();
    expect(r.remarcados).toBe(1);
  });

  it('leitura da agenda falhou: não inventa horário', async () => {
    agendaQuebrada = true;
    const r = await tick();
    expect(r.motivo).toBe('erro_agenda');
    expect(updates).toHaveLength(0);
  });
});

describe('quem não entra', () => {
  it('card de eletroposto — tem régua própria, e duas máquinas remarcariam duas vezes', async () => {
    vermelhos = [card({ created_by: 'lp_eletroposto' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('quem escreveu depois de perder o horário', async () => {
    vermelhos = [card({ lead_resposta_at: '2026-09-26T10:00:00.000Z' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('dia de agenda fechada não é falta do cliente, é nossa', async () => {
    vermelhos = [card({ quando: '2026-09-07T11:15:00.000Z' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('card sem telefone ou sem dono', async () => {
    vermelhos = [card({ cliente_telefone: null }), card({ id: 2, vendedor_nome: null })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('cliente que já tem ligação marcada não vira duas', async () => {
    futura = [{ quando: '2026-10-02T11:15:00.000Z', vendedor_nome: 'Giovanna', cliente_telefone: '5534998887766', created_by: 'lead-meta', status: 'agendado' }];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('o 55 duplicado não faz o mesmo cliente passar por outro', async () => {
    futura = [{ quando: '2026-10-02T11:15:00.000Z', vendedor_nome: 'Giovanna', cliente_telefone: '555534998887766', created_by: 'lead-meta', status: 'agendado' }];
    expect((await tick()).remarcados).toBe(0);
  });

  it('duas voltas e para: o card fica pra gente', async () => {
    state.set('solar_reagenda:1', { key: 'solar_reagenda:1', value: { n: 2 }, updated_at: '2026-09-01T00:00:00.000Z' });
    expect((await tick()).motivo).toBe('ninguem_na_vez');
  });

  it('card anterior ao piso fica fora', async () => {
    vermelhos = [card({ quando: '2026-04-01T11:15:00.000Z' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('mas card VELHO dentro do piso entra: é a ordem de 29/09', async () => {
    vermelhos = [card({ quando: '2026-06-10T11:15:00.000Z' })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('card que acabou de vencer espera a folga', async () => {
    vermelhos = [card({ quando: new Date(AGORA.getTime() - 5 * 60_000).toISOString() })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });
});

describe('a rampa diária', () => {
  // É o único freio de volume que existe aqui. Sem ela: 1 por tick, tick de 2 em
  // 2 min = até 300 por dia, e cada card move gera bom dia + oi. Os 48 parados
  // virariam ~96 mensagens numa tarde.
  it('fecha a porta no teto', async () => {
    process.env.SOLAR_REAGENDA_POR_DIA = '2';
    const hoje = AGORA.toISOString();
    state.set('solar_reagenda:901', { key: 'solar_reagenda:901', value: { n: 1 }, updated_at: hoje });
    state.set('solar_reagenda:902', { key: 'solar_reagenda:902', value: { n: 1 }, updated_at: hoje });
    const r = await tick();
    expect(r.motivo).toBe('rampa_do_dia_cheia');
    expect(updates).toHaveLength(0);
  });

  it('carimbo de ontem não gasta a rampa de hoje', async () => {
    process.env.SOLAR_REAGENDA_POR_DIA = '1';
    state.set('solar_reagenda:901', {
      key: 'solar_reagenda:901', value: { n: 1 },
      updated_at: new Date(AGORA.getTime() - 40 * 3600_000).toISOString(),
    });
    expect((await tick()).remarcados).toBe(1);
  });

  it('rampa em 0 congela sem precisar do kill-switch', async () => {
    process.env.SOLAR_REAGENDA_POR_DIA = '0';
    expect((await tick()).motivo).toBe('rampa_do_dia_cheia');
  });

  // FAIL-CLOSED nas duas leituras que seguram repetição.
  it('leitura da rampa falhou: ninguém é movido', async () => {
    rampaQuebrada = true;
    const r = await tick();
    expect(r.motivo).toBe('erro_rampa');
    expect(updates).toHaveLength(0);
  });

  it('leitura do ciclo falhou: ninguém é movido', async () => {
    cicloQuebrado = true;
    const r = await tick();
    expect(r.motivo).toBe('erro_ciclo');
    expect(updates).toHaveLength(0);
  });

  it('um por tick, mesmo com fila grande', async () => {
    vermelhos = [card(), card({ id: 2, cliente_telefone: '5534998887755' }), card({ id: 3, cliente_telefone: '5534998887744' })];
    expect((await tick()).remarcados).toBe(1);
  });
});

describe('kill-switch e dry', () => {
  it('SOLAR_REAGENDA_OFF=1 desliga tudo', async () => {
    process.env.SOLAR_REAGENDA_OFF = '1';
    expect((await tick()).motivo).toBe('desligado');
  });

  it('dry mostra de quando pra quando, sem tocar em nada', async () => {
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('remarcaria_agora');
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Giovanna', volta: 1 });
    expect(updates).toHaveLength(0);
    expect(state.size).toBe(0);
  });
});
