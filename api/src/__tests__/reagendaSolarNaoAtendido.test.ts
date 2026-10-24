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
const updates: Array<{ id: number; patch: any; exigiuStatus: string | null; exigiuQuando?: string | null; exigiuDono?: string | null }> = [];
/** Simula alguém mexendo no card entre a leitura e a gravação. */
let updateNaoPega = false;
/** Horários que o índice único recusa (código 23505), como quando a outra
 *  máquina marcou ali entre a leitura e a gravação. */
let colidemEm: string[] = [];
/** Um erro de banco que NÃO é colisão de horário. */
let updateQuebrado = false;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _status: null as string | null,
        _statusIn: null as string[] | null,
        _statusNot: null as string[] | null,
        _gte: null as string | null,
        _lte: null as string | null,
        _id: null as number | null,
        _patch: null as any,
        select() { return q; },
        eq(col: string, v: any) {
          if (col === 'status') q._status = v;
          if (col === 'id') q._id = v;
          if (col === 'quando') q._quando = v;
          // A trava do dono LIDO (13/10/2026) na gravação.
          if (col === 'vendedor_nome') q._dono = v;
          if (q._patch) return q;
          return q;
        },
        in(col: string, v: string[]) { if (col === 'status') q._statusIn = v; return q; },
        // Desde 01/10/2026 a fila lista o que NAO entra (destino final e
        // apalavrado) em vez do que entra.
        not(col: string, _op: string, lista: string) {
          if (col === 'status') q._statusNot = String(lista).replace(/^\(|\)$/g, '').split(',');
          return q;
        },
        gte(_c: string, v: string) { q._gte = v; return q; },
        lte(_c: string, v: string) { q._lte = v; return q; },
        order() { return q; },
        update(patch: any) { q._patch = patch; return q; },
        limit() {
          // Duas leituras usam `limit`, e desde 30/09/2026 AS DUAS usam `.in`
          // em `status` — a fila passou a pedir `nao_atendeu` + `agendado`.
          // Quem as separa é o `lte`: só a fila tem teto de data (ela busca o
          // que já venceu); a agenda futura tem só piso.
          if ((q._statusIn || q._statusNot) && !q._lte) {
            if (agendaQuebrada) return Promise.resolve({ data: null, error: { message: 'boom' } });
            // O FILTRO DE STATUS VALE AQUI TAMBÉM. Antes o mock devolvia a
            // agenda futura inteira, e com isso qualquer teste de "o que ocupa
            // horário" passava de graça: era exatamente o defeito de 01/10, em
            // que a varredura real não via 31 das 92 linhas futuras.
            const vis = futura.filter(o =>
              (!q._statusIn || q._statusIn.includes(o.status))
              && (!q._statusNot || !q._statusNot.includes(o.status)));
            return Promise.resolve({ data: vis, error: null });
          }
          const out = vermelhos.filter(f =>
            (!q._status || f.status === q._status)
            && (!q._statusIn || q._statusIn.includes(f.status))
            && (!q._statusNot || !q._statusNot.includes(f.status))
            && (!q._gte || f.quando >= q._gte)
            && (!q._lte || f.quando <= q._lte));
          return Promise.resolve({ data: out, error: null });
        },
        // O update termina em `.select('id')`, então o `then` do próprio objeto
        // é quem resolve: reproduz a cadeia real update().eq().eq().select().
        then(res: any) {
          const id = q._id as number;
          updates.push({ id, patch: q._patch, exigiuStatus: q._status, exigiuQuando: q._quando, exigiuDono: q._dono });
          if (updateNaoPega) return res({ data: [], error: null });
          if (colidemEm.includes(String(q._patch?.quando))) {
            return res({ data: null, error: { code: '23505', message: 'duplicate key' } });
          }
          if (updateQuebrado) return res({ data: null, error: { code: '42501', message: 'nao autorizado' } });
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
          // A rampa deixou de filtrar no servidor: ela traz os carimbos e conta
          // pelo `value.ultimo`. O mock serve as duas formas.
          return {
            limit: async () => linhas(),
            gte: (_c: string, desde: string) => ({ limit: async () => linhas(desde) }),
          };
        },
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

// 24/10/2026: o PADRÃO do código é NÃO trocar o card entre Giovanna e Nilce (só a
// Nilce atende solar). A máquina da troca de 13/10 continua montada atrás de
// SOLAR_NAO_ATENDEU_TROCA_ON=1, e a suíte inteira roda com ela ligada para seguir
// cobrindo a mecânica (rampa, teto, carimbos, histórico). O que vale SEM a env
// está no describe "o padrão desde 24/10/2026", mais abaixo, que a desliga.
beforeEach(() => {
  process.env.SOLAR_NAO_ATENDEU_TROCA_ON = '1';
  vermelhos = [card()];
  futura = [];
  state.clear(); updates.length = 0;
  rampaQuebrada = false; cicloQuebrado = false; agendaQuebrada = false; updateNaoPega = false;
  colidemEm = []; updateQuebrado = false;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function tick(opts: any = {}) {
  return (await import('../services/agenda/reagendaSolarNaoAtendido')).runReagendaSolarTick(opts);
}

describe('mover o card', () => {
  // ALTERADO em 13/10/2026: o card era da Giovanna e este teste afirmava que o
  // dono não mudava. Essa é justamente a regra que mudou (a Giovanna e a Nilce
  // passam o NÃO ATENDEU uma pra outra), então a fixture virou sócio, que segue
  // mantendo o dono. O caso da Giovanna e da Nilce tem teste próprio mais abaixo.
  it('não atendeu volta pra agendado, num horário futuro do mesmo consultor', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego' })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.status).toBe('agendado');
    expect(new Date(updates[0].patch.quando).getTime()).toBeGreaterThan(AGORA.getTime());
    // Sócio não troca de dono.
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
    expect(updates[0].patch.historico).toContain('Remarcação automática 1/3');
    expect(updates[0].patch.historico).toContain('não atendeu');
  });

  // ── A LINHA MUDA COM O RELÓGIO (01/10/2026) ─────────────────────────────
  //
  // Havia um texto só, "não atendeu em X", e ele é fato apenas quando alguém
  // apertou NÃO ATENDEU. Medido em 01/10: os 20 cards que o módulo moveu naquele
  // dia estavam TODOS em `agendado`, e os 20 ficaram com "não atendeu" escrito
  // no histórico, com um `/2` de um teto que não se aplica a eles. Cadastro que
  // inventa um fato é pior que cadastro calado: alguém lê e cobra o cliente.
  it('o card esquecido não é acusado de falta, e não promete teto nenhum', async () => {
    vermelhos = [card({ status: 'agendado', quando: '2026-09-29T11:15:00.000Z' })];
    await tick();
    const linha = String(updates[0].patch.historico);
    expect(linha).not.toContain('não atendeu');
    expect(linha).not.toMatch(/automática \d+\/\d+/);   // sem denominador: este caminho não tem teto
    expect(linha).toContain('sem desfecho');
    expect(linha).toContain('Nada foi enviado ao cliente');
  });

  it('o card em negociação diz que é o ciclo de 24h, e como se sai dele', async () => {
    vermelhos = [card({ status: 'fez_orcamento', quando: '2026-09-25T11:15:00.000Z' })];
    await tick();
    const linha = String(updates[0].patch.historico);
    expect(linha).toContain('Ciclo de 24h (1ª volta nesta etiqueta)');
    expect(linha).toContain('a proxima volta e em 48h');
    expect(linha).not.toContain('não atendeu');
    expect(linha).toContain('Apalavrado');
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
  // A grade morava no nilceParaGiovanna.ts, apagado em 05/10/2026, e o teste dela
  // foi junto. Ela espelha a GRADE_NILCE da LP do solar: mexeu numa, mexe na outra.
  it('a grade dos sócios é 8–11 e 13–16 de 30 em 30, com almoço fechado', async () => {
    const { GRADE_NILCE } = await import('../services/agenda/reagendaSolarNaoAtendido');
    expect(GRADE_NILCE).toEqual([
      '08:00','08:30','09:00','09:30','10:00','10:30','11:00',
      '13:00','13:30','14:00','14:30','15:00','15:30','16:00',
    ]);
  });

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
    // Enche o dia 01/10 inteiro na agenda do Diego (13/10/2026: a fixture era a
    // Giovanna, que agora entrega o NÃO ATENDEU pra Nilce; o dono que fica com o
    // card é o sócio, e é a agenda dele que decide).
    vermelhos = [card({ vendedor_nome: 'Diego' })];
    futura = [];
    for (let h = 8; h <= 17; h++) {
      for (const m of ['00', '15', '30', '45']) {
        futura.push({ quando: `2026-10-01T${String(h + 3).padStart(2, '0')}:${m}:00.000Z`, vendedor_nome: 'Diego', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' });
      }
    }
    await tick();
    expect(updates[0].patch.quando.slice(0, 10)).not.toBe('2026-10-01');
  });

  it('agenda de OUTRO consultor não bloqueia a vaga', async () => {
    // 13/10/2026: era 'Nilce', mas a Nilce agora é quem RECEBE o card da Giovanna.
    futura = [{ quando: '2026-10-01T11:15:00.000Z', vendedor_nome: 'Thiago', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' }];
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

  // ALTERADO em 13/10/2026: o teto passou a contar só as voltas do VERMELHO
  // (`nFala`), e não o `n` total. A fixture virou `nFala: 3`; com `n: 3` puro o
  // card agora anda (ver o describe do teto, no fim do arquivo).
  // ALTERADO de novo em 13/10/2026: o teto passou a limitar só as MENSAGENS, e o
  // card da Giovanna e da Nilce no teto agora passa calado pra outra. A fixture
  // virou sócio, que segue parando; o caso delas está no describe da troca calada.
  it('três voltas e para: o card fica pra gente', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego' })];
    state.set('solar_reagenda:1', { key: 'solar_reagenda:1', value: { n: 3, nFala: 3 }, updated_at: '2026-09-01T00:00:00.000Z' });
    expect((await tick()).motivo).toBe('ninguem_na_vez');
  });

  it('card anterior ao piso fica fora', async () => {
    vermelhos = [card({ quando: '2026-04-01T11:15:00.000Z' })];
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  // 03/10/2026 inverteu isto, e o motivo está escrito no gêmeo do eletroposto
  // ("vermelho VELHO fica FORA"): com a janela em 365 dias este módulo foi buscar
  // card de maio e jogou na semana do Thiago. Vinte das 51 fichas que eu devolvi
  // naquele dia eram daqui.
  it('card VELHO fica FORA: 21 dias, não 365', async () => {
    vermelhos = [card({ quando: '2026-06-10T11:15:00.000Z' })];   // 112 dias atrás
    expect((await tick()).motivo).toBe('nenhum_vermelho');
  });

  it('e o card DENTRO dos 21 dias entra, que é o trabalho do módulo', async () => {
    vermelhos = [card({ quando: '2026-09-16T11:15:00.000Z' })];   // 14 dias atrás
    expect((await tick()).remarcados).toBe(1);
  });

  it('SOLAR_REAGENDA_JANELA_DIAS abre a janela sem deploy, pra rodada de resgate', async () => {
    process.env.SOLAR_REAGENDA_JANELA_DIAS = '365';
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
    // `ultimo` e o que a rampa conta desde 30/09/2026 — `updated_at` e coluna
    // de infraestrutura e deixou de valer pra esta conta.
    state.set('solar_reagenda:901', { key: 'solar_reagenda:901', value: { n: 1, ultimo: hoje }, updated_at: hoje });
    state.set('solar_reagenda:902', { key: 'solar_reagenda:902', value: { n: 1, ultimo: hoje }, updated_at: hoje });
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

  // ── CADA RELÓGIO TEM A RAMPA DELE (01/10/2026) ──────────────────────────
  //
  // A rampa de cima é dimensionada por MENSAGEM: cada card vermelho que volta
  // gera bom dia + oi. O card esquecido e o card em negociação não mandam nada,
  // e ficavam presos atrás do vermelho: medido em 01/10, o solar fechou a rampa
  // às 00h40 e deixou 116 cards esperando o dia virar.
  const carimbo = (id: number, relogio?: 'fala' | 'mudo') => {
    const hoje = AGORA.toISOString();
    state.set(`solar_reagenda:${id}`, {
      key: `solar_reagenda:${id}`,
      value: { n: 1, ultimo: hoje, ...(relogio ? { relogio } : {}) },
      updated_at: hoje,
    });
  };

  it('a rampa cheia do vermelho NÃO segura o card calado', async () => {
    process.env.SOLAR_REAGENDA_POR_DIA = '1';
    carimbo(901, 'fala');
    vermelhos = [card({ status: 'agendado', quando: '2026-09-29T11:15:00.000Z' })];
    expect((await tick()).remarcados).toBe(1);
  });

  it('mas a rampa do calado também fecha, no número dela', async () => {
    process.env.SOLAR_REAGENDA_MUDO_POR_DIA = '1';
    carimbo(901, 'mudo');
    vermelhos = [card({ status: 'agendado', quando: '2026-09-29T11:15:00.000Z' })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('rampa_do_dia_cheia');
  });

  // Carimbo gravado antes de 01/10 não tem `relogio`. Contar como calado faria o
  // que já foi FALADO hoje deixar de gastar o teto que protege a linha, no dia
  // exato da virada. Conta como `fala`.
  it('carimbo sem `relogio` gasta a rampa do vermelho, não a do calado', async () => {
    process.env.SOLAR_REAGENDA_POR_DIA = '1';
    process.env.SOLAR_REAGENDA_MUDO_POR_DIA = '1';
    carimbo(901);
    expect((await tick()).motivo).toBe('rampa_do_dia_cheia');   // o vermelho parou
    vermelhos = [card({ status: 'agendado', quando: '2026-09-29T11:15:00.000Z' })];
    expect((await tick()).remarcados).toBe(1);                   // o calado andou
  });

  it('o carimbo que o módulo grava diz de qual relógio ele é', async () => {
    await tick();
    expect(state.get('solar_reagenda:1')?.value?.relogio).toBe('fala');
    state.clear();
    vermelhos = [card({ status: 'agendado', quando: '2026-09-29T11:15:00.000Z' })];
    await tick();
    expect(state.get('solar_reagenda:1')?.value?.relogio).toBe('mudo');
  });

  // ── A FILA ANDA MESMO QUANDO O PRIMEIRO NÃO PODE (01/10/2026) ───────────
  //
  // `POR_TICK = 1` pegava o primeiro da fila e, se ele não pudesse se mover,
  // devolvia zero. A ordem não muda entre ticks, então a rodada seguinte tentava
  // o MESMO card: um card travado parava a fila inteira com a rampa vazia.
  it('primeiro card já com ligação marcada: a rodada move o seguinte', async () => {
    vermelhos = [
      card({ id: 41, cliente_telefone: '5534900000041' }),
      card({ id: 42, cliente_telefone: '5534900000042', quando: '2026-09-24T11:15:00.000Z' }),
    ];
    // O 41 já tem horário futuro: mover criaria a mesma pessoa em dois lugares.
    futura = [{
      id: 999, quando: '2026-10-05T14:00:00.000Z', vendedor_nome: 'Giovanna',
      cliente_telefone: '5534900000041', created_by: 'lead-meta', status: 'agendado',
    }] as any;
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(updates.map(u => u.id)).toEqual([42]);
  });

  // ── O QUE OCUPA HORÁRIO É DENYLIST, NÃO ALLOWLIST (01/10/2026) ──────────
  //
  // A varredura pedia uma LISTA DO QUE ENTRA: agendado, nao_atendeu,
  // em_atendimento, falando_whatsapp. Status criado depois nascia invisível, e
  // foi o que aconteceu no dia em que o ciclo de 48h começou a devolver
  // negociação pra agenda: das 92 linhas futuras, 31 estavam fora da lista. Pro
  // Thiago, a varredura escolhia um horário que já tinha reunião viva, o índice
  // único recusava a gravação, e o card não andava — oito vezes por rodada.
  it('card em negociação no futuro OCUPA o horário, como qualquer reunião', async () => {
    // 08:00 BRT de quinta 01/10: a varredura comeca no PROXIMO dia util, nao no
    // resto de hoje.
    const primeiro = '2026-10-01T11:00:00.000Z';
    // 13/10/2026: 'Nilce', a agenda de quem RECEBE o card da Giovanna.
    futura = [{
      id: 900, quando: primeiro, vendedor_nome: 'Nilce',
      cliente_telefone: '5534900000900', created_by: 'lead-meta', status: 'chave_na_mao',
    }];
    await tick();
    expect(updates[0].patch.quando).not.toBe(primeiro);
  });

  it('mas horário cancelado não ocupa nada — é a outra ponta da mesma régua', async () => {
    // 08:15 BRT: o primeiro horário da faixa de follow-up da Giovanna (09/10).
    const primeiro = '2026-10-01T11:15:00.000Z';
    // 13/10/2026: 'Nilce', a agenda de quem RECEBE o card da Giovanna.
    futura = [{
      id: 900, quando: primeiro, vendedor_nome: 'Nilce',
      cliente_telefone: '5534900000900', created_by: 'lead-meta', status: 'cancelado',
    }];
    await tick();
    expect(updates[0].patch.quando).toBe(primeiro);
  });

  // ── RECUSA DE HORÁRIO OCUPADO NÃO É ERRO (01/10/2026) ───────────────────
  //
  // A agenda tem dois donos: o reciclo do eletroposto escreve nela também. Entre
  // ler e gravar, o horário pode ter sido tomado, e o índice único recusa com
  // 23505. Isso é o banco dizendo a verdade, e a resposta certa é tentar o
  // seguinte. Contar erro e desistir foi o que devolveu `erros: 8, remarcados: 0`
  // na primeira rodada da regra nova.
  it('horário recusado pelo índice único: tenta o seguinte e não conta erro', async () => {
    const primeiro = '2026-10-01T11:15:00.000Z';
    colidemEm = [primeiro];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(r.erros).toBe(0);
    expect(updates).toHaveLength(2);                       // tentou dois horários
    expect(updates[0].patch.quando).toBe(primeiro);         // o recusado
    expect(updates[1].patch.quando).not.toBe(primeiro);     // e o que entrou
  });

  it('mas não tenta pra sempre: horário sempre recusado para em 4 e não vira laço', async () => {
    // Todos os horários do dia e do dia seguinte recusados.
    colidemEm = ['2026-10-01T11:15:00.000Z', '2026-10-01T11:45:00.000Z',
      '2026-10-01T12:15:00.000Z', '2026-10-01T12:45:00.000Z', '2026-10-01T13:15:00.000Z'];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.erros).toBe(0);                 // recusa de horário não é erro
    expect(updates).toHaveLength(4);         // 4 horários no único card da fila, e para
  });

  it('erro de banco que NÃO é colisão continua contando como erro, e não repete', async () => {
    updateQuebrado = true;
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.erros).toBe(1);
    expect(updates).toHaveLength(1);         // não insistiu no mesmo card
  });

  // ── A ESCADA DA NEGOCIAÇÃO (01/10/2026) ─────────────────────────────────
  //
  // A aritmética tem teste próprio e puro em `escadaNegociacao.test.ts`, junto
  // com a do eletroposto, pra garantir que as duas contam igual. Aqui fica o que
  // só o tick prova: que o corte exato segura o card no prazo, que o carimbo
  // guarda a etiqueta, e que o relógio do vermelho não foi contaminado.
  const noDegrau = (id: number, status: string, degrau: number, n = degrau) =>
    state.set(`solar_reagenda:${id}`, {
      key: `solar_reagenda:${id}`,
      value: { n, ultimo: AGORA.toISOString(), relogio: 'mudo', status, degrau },
      updated_at: AGORA.toISOString(),
    });
  /** `quando` a N horas antes do AGORA do teste. */
  const hAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

  // ── DESDE 09/10/2026 O DEGRAU DIZ ONDE, E O DIA DIZ QUANDO ─────────────
  //
  // "Ele tem que sair às 23:59 do mesmo dia e não esperar dar as 48h", e "a
  // lógica é virar no mesmo dia e ocupar seu lugar na próxima agenda". AGORA é
  // quarta 30/09, 11h.
  /** Um horário de Brasília em ISO. */
  const brt = (dia: string, hm: string) => new Date(`${dia}T${hm}:00-03:00`).toISOString();

  it('o card das 09:15 de HOJE não anda às 11h, em degrau nenhum', async () => {
    vermelhos = [card({ id: 70, status: 'fez_orcamento', quando: brt('2026-09-30', '09:15') })];
    noDegrau(70, 'fez_orcamento', 1);
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('esperando_a_virada');
  });

  it('O EXEMPLO DA ORDEM: às 23:59 o card das 10:00 vai pras 10:15 de amanhã', async () => {
    vermelhos = [card({ id: 80, status: 'fez_orcamento', quando: brt('2026-09-30', '10:00') })];
    vi.setSystemTime(new Date(brt('2026-09-30', '23:59')));
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.quando).toBe(brt('2026-10-01', '10:15'));
  });

  it('às 23:58 ainda não', async () => {
    vermelhos = [card({ id: 80, status: 'fez_orcamento', quando: brt('2026-09-30', '10:00') })];
    vi.setSystemTime(new Date(brt('2026-09-30', '23:58')));
    expect((await tick()).remarcados).toBe(0);
  });

  it('sexta 13:15 com 24h: o lugar é segunda às 13:15, não às 08:15', async () => {
    vermelhos = [card({ id: 81, status: 'fez_orcamento', quando: brt('2026-10-02', '13:15') })];
    vi.setSystemTime(new Date(brt('2026-10-02', '23:59')));
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.quando).toBe(brt('2026-10-05', '13:15'));
  });

  it('o lugar ocupado: o seguinte do mesmo dia', async () => {
    vermelhos = [card({ id: 82, status: 'fez_orcamento', quando: brt('2026-09-30', '10:00') })];
    futura = [{ quando: brt('2026-10-01', '10:15'), vendedor_nome: 'Giovanna', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' }];
    vi.setSystemTime(new Date(brt('2026-09-30', '23:59')));
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.quando).toBe(brt('2026-10-01', '10:45'));
  });

  it('o UPDATE exige o horário que foi lido: dois ticks não empurram o card dois degraus', async () => {
    vermelhos = [card({ id: 83, status: 'fez_orcamento', quando: brt('2026-09-29', '09:15') })];
    await tick();
    expect(updates[0].exigiuQuando).toBe(brt('2026-09-29', '09:15'));
  });

  it('e 49h bastam — o card volta e sobe pro degrau 2', async () => {
    vermelhos = [card({ id: 70, status: 'fez_orcamento', quando: hAtras(49) })];
    noDegrau(70, 'fez_orcamento', 1);
    expect((await tick()).remarcados).toBe(1);
    const v = state.get('solar_reagenda:70')?.value;
    expect(v?.degrau).toBe(2);
    expect(v?.status).toBe('fez_orcamento');
  });

  // A REPETIÇÃO (07/10/2026): o degrau 3 pede as mesmas 48h do 2, e só o 4
  // sobe pra 72h. É a forma nova da escada, então ela é provada no tick também.
  it('no degrau 3 o lugar REPETE as 48h, e no 4 sobe pra 72h', async () => {
    // O card de ontem (terça) às 09:15: 48h depois é quinta às 09:15, 72h é
    // sexta às 09:15.
    vermelhos = [card({ id: 75, status: 'fez_orcamento', quando: brt('2026-09-29', '09:15') })];
    noDegrau(75, 'fez_orcamento', 2);
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:75')?.value?.degrau).toBe(3);
    expect(updates[0].patch.quando).toBe(brt('2026-10-01', '09:15'));

    state.clear(); updates.length = 0;
    vermelhos = [card({ id: 76, status: 'fez_orcamento', quando: brt('2026-09-29', '09:15') })];
    noDegrau(76, 'fez_orcamento', 3);
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.quando).toBe(brt('2026-10-02', '09:15'));
  });

  // O CARD QUE VIROU ATRASADO CAI HOJE. O de ontem às 10:00, no degrau 1, tem o
  // lugar dele hoje às 10:00, que já passou (AGORA é 11:00): ele vai pro
  // primeiro horário livre de hoje dali pra frente, 11:15, e não pra amanhã.
  it('a negociação cai no primeiro horário livre de HOJE, não de amanhã', async () => {
    vermelhos = [card({ id: 77, status: 'fez_orcamento', quando: hAtras(25) })];
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.quando).toBe('2026-09-30T14:15:00.000Z');
  });

  it('o vermelho e o esquecido continuam caindo no OUTRO dia', async () => {
    for (const [id, status, h] of [[78, 'nao_atendeu', 1], [79, 'agendado', 7]] as const) {
      state.clear(); updates.length = 0;
      vermelhos = [card({ id, status, quando: hAtras(h) })];
      expect((await tick()).remarcados, status).toBe(1);
      expect(String(updates[0].patch.quando).slice(0, 10), status).toBe('2026-10-01');
    }
  });

  it('etiqueta que MUDOU volta pro degrau 1: 25h bastam, mesmo vindo do degrau 6', async () => {
    vermelhos = [card({ id: 71, status: 'em_atendimento', quando: hAtras(25) })];
    noDegrau(71, 'fez_orcamento', 6, 1);        // etiqueta de antes era outra
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:71')?.value?.degrau).toBe(1);
  });

  it('carimbo velho, sem etiqueta: ganha mais um degrau 1 e a escada começa dali', async () => {
    vermelhos = [card({ id: 72, status: 'fez_orcamento', quando: hAtras(25) })];
    state.set('solar_reagenda:72', {
      key: 'solar_reagenda:72', value: { n: 1, ultimo: hAtras(60) }, updated_at: hAtras(60),
    });
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:72')?.value?.degrau).toBe(1);
  });

  it('o vermelho não entra na escada: 1h e um degrau alto guardado, e ele anda', async () => {
    vermelhos = [card({ id: 73, status: 'nao_atendeu', quando: hAtras(1) })];
    noDegrau(73, 'nao_atendeu', 9, 1);          // `n` baixo: o teto de 3 voltas é outro assunto
    expect((await tick()).remarcados).toBe(1);
  });

  it('nem o card esquecido: 7h e um degrau alto guardado, e ele anda', async () => {
    vermelhos = [card({ id: 74, status: 'agendado', quando: hAtras(7) })];
    noDegrau(74, 'agendado', 9, 1);
    expect((await tick()).remarcados).toBe(1);
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

describe('a janela de horário', () => {
  // ISTO FALTOU NA PRIMEIRA VERSÃO, e o custo apareceu medindo produção às 00h59
  // de 30/09: o módulo subiu perto da meia-noite, a rampa do dia virou às 00h00 e
  // uma hora depois as 10 remarcações do dia já estavam gastas. Dez cards
  // mudaram de dia enquanto ninguém olhava. Não é anti-ban (nenhuma mensagem sai
  // de madrugada), é observação: a rampa existe pra dar tempo de reagir, e de
  // madrugada ela não dá tempo nenhum.
  it('cala de madrugada', async () => {
    vi.setSystemTime(new Date('2026-09-30T04:30:00.000Z'));   // 01h30 BRT
    expect((await tick()).motivo).toBe('fora_da_janela');
  });

  it('cala depois das 19h', async () => {
    vi.setSystemTime(new Date('2026-09-30T23:00:00.000Z'));   // 20h BRT
    expect((await tick()).motivo).toBe('fora_da_janela');
  });

  it('trabalha no expediente', async () => {
    vi.setSystemTime(new Date('2026-09-30T13:00:00.000Z'));   // 10h BRT
    expect((await tick()).remarcados).toBe(1);
  });

  it('a janela é configurável sem deploy', async () => {
    process.env.SOLAR_REAGENDA_INICIO_H = '0';
    process.env.SOLAR_REAGENDA_FIM_H = '24';
    vi.setSystemTime(new Date('2026-09-30T04:30:00.000Z'));   // 01h30 BRT
    expect((await tick()).remarcados).toBe(1);
  });

  it('seco atravessa a janela: conferir é pergunta, não ação', async () => {
    vi.setSystemTime(new Date('2026-09-30T04:30:00.000Z'));   // 01h30 BRT
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('remarcaria_agora');
    expect(updates).toHaveLength(0);
  });
});

describe('kill-switch e dry', () => {
  it('SOLAR_REAGENDA_OFF=1 desliga tudo', async () => {
    process.env.SOLAR_REAGENDA_OFF = '1';
    expect((await tick()).motivo).toBe('desligado');
  });

  // O SEGUNDO DEFEITO QUE A SONDA DE PRODUÇÃO ACHOU. Com a rampa cheia, o
  // `?dry=1` respondia `rampa_do_dia_cheia` e mais nada: não dizia quem seria
  // movido nem se a fila ainda existia. Prévia que só funciona quando o módulo já
  // podia agir não serve pra conferir nada — e foi exatamente quando eu precisei
  // dela que ela ficou muda.
  it('seco atravessa a rampa cheia e ainda mostra a fila', async () => {
    process.env.SOLAR_REAGENDA_POR_DIA = '0';
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('remarcaria_agora');
    // 13/10/2026: a Giovanna entrega o NÃO ATENDEU, então o dono da prévia é a Nilce.
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Nilce', veioDe: 'Giovanna' });
    expect(updates).toHaveLength(0);
  });

  it('dry mostra de quando pra quando, sem tocar em nada', async () => {
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('remarcaria_agora');
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Nilce', veioDe: 'Giovanna', volta: 1 });
    expect(updates).toHaveLength(0);
    expect(state.size).toBe(0);
  });
});

// ── O CARD DO SOLAR QUE NINGUÉM FECHOU (30/09/2026) ────────────────────────
//
// Mesma ordem que criou a regra no eletroposto: "o card confirmado, se não for
// alterado, já será remarcado após 6h", e "a pessoa, quando não marca e não
// utiliza a ferramenta, sempre terá os clientes retornando".
//
// Sem isto a regra valia só pra metade da casa: 6 cards de solar vencidos e sem
// desfecho (Giovanna 2, Nilce 4) que robô nenhum olhava.
describe('o card esquecido do solar', () => {
  const esquecido = (h: number, over: any = {}) =>
    card({ status: 'agendado', quando: new Date(AGORA.getTime() - h * 3600_000).toISOString(), ...over });

  it('6 horas depois, o card sem desfecho volta pra agenda', async () => {
    vermelhos = [esquecido(7)];
    const r = await tick();
    expect(r.remarcados).toBe(1);
  });

  it('antes das 6 horas não encosta', async () => {
    vermelhos = [esquecido(3)];
    expect((await tick()).remarcados).toBe(0);
  });

  it('NÃO destrava as mensagens: a ligação pode ter acontecido', async () => {
    // Zerar `bomdia_at` faria a régua mandar "bom dia, hoje tem ligação" pra
    // quem já conversou ontem.
    vermelhos = [esquecido(7)];
    await tick();
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).not.toHaveProperty('bomdia_at');
    expect(updates[0].patch).not.toHaveProperty('lembrete_5min_at');
  });

  it('mas o vermelho continua destravando, porque ali a falta é fato', async () => {
    vermelhos = [card({ status: 'nao_atendeu' })];
    await tick();
    expect(updates[0].patch).toHaveProperty('bomdia_at', null);
    expect(updates[0].patch).toHaveProperty('lembrete_5min_at', null);
  });

  it('a gravação exige o status que foi LIDO, não `nao_atendeu` fixo', async () => {
    vermelhos = [esquecido(7)];
    await tick();
    expect(updates[0].exigiuStatus).toBe('agendado');
  });

  it('o esquecido não tem teto de voltas: ele sempre retorna', async () => {
    state.set('solar_reagenda:1', { key: 'solar_reagenda:1', value: { n: 9, ultimo: '2026-09-01T00:00:00.000Z' }, updated_at: '2026-09-01T00:00:00.000Z' });
    vermelhos = [esquecido(7)];
    expect((await tick()).remarcados).toBe(1);
  });

  // ALTERADO em 13/10/2026: mesma razão do teste das três voltas, a fixture ganhou
  // `nFala: 3` porque o teto não lê mais o `n` total. E a fixture virou sócio
  // (também 13/10/2026): Giovanna e Nilce no teto passam calado, o sócio para.
  it('o vermelho continua parando no teto de 2 voltas', async () => {
    state.set('solar_reagenda:1', { key: 'solar_reagenda:1', value: { n: 3, nFala: 3, ultimo: '2026-09-01T00:00:00.000Z' }, updated_at: '2026-09-01T00:00:00.000Z' });
    vermelhos = [card({ status: 'nao_atendeu', vendedor_nome: 'Diego' })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
  });

  it('card de eletroposto nunca entra aqui: ele tem régua própria', async () => {
    vermelhos = [esquecido(7, { created_by: 'lp_eletroposto' })];
    expect((await tick()).remarcados).toBe(0);
  });
});

// ── O NÃO ATENDEU DA GIOVANNA E DA NILCE PASSA PARA A OUTRA (13/10/2026) ────
//
// Ordem do dono: "Faz uma regra para o atendimento solar da Giovanna e Nilce,
// quando eles colocarem não atendeu, vai para a outra agendado no outro dia."
//
// O risco é trocar de mão o que NÃO foi marcado como falta: o card esquecido e o
// card em negociação mantêm o dono, e o sócio também. E o outro lado: marcar a
// ligação na agenda de quem ENTREGA, em cima de um horário que a parceira já tem.
// ── O PADRÃO DESDE 24/10/2026: NINGUÉM TROCA DE CONSULTORA ──────────────────
// Sem env nenhuma, o NÃO ATENDEU da Nilce não volta mais para a Giovanna (nem o
// da Giovanna para a Nilce). A remarcação na faixa :15/:45 continua igual.
describe('o padrão desde 24/10/2026: o card não troca de consultora', () => {
  beforeEach(() => { delete process.env.SOLAR_NAO_ATENDEU_TROCA_ON; delete process.env.SOLAR_NAO_ATENDEU_TROCA_OFF; });

  it('donoDaVolta: Giovanna no NÃO ATENDEU vira Nilce; Nilce, Thiago e Diego ficam; fora do NÃO ATENDEU ninguém muda', async () => {
    const { donoDaVolta } = await import('../services/agenda/reagendaSolarNaoAtendido');
    expect(donoDaVolta('Giovanna', 'nao_atendeu')).toBe('Nilce');
    expect(donoDaVolta(' Giovanna ', 'nao_atendeu')).toBe('Nilce');
    for (const dono of ['Nilce', 'Thiago', 'Diego']) expect(donoDaVolta(dono, 'nao_atendeu')).toBe(dono);
    for (const dono of ['Nilce', 'Giovanna', 'Thiago', 'Diego']) {
      for (const status of ['agendado', 'fez_orcamento']) expect(donoDaVolta(dono, status)).toBe(dono);
    }
  });

  it('Nilce marca NÃO ATENDEU: continua com a Nilce, agendada, outro dia, em :15 ou :45', async () => {
    vermelhos = [card({ vendedor_nome: 'Nilce' })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p).not.toHaveProperty('vendedor_nome');
    expect(p.status).toBe('agendado');
    expect(new Date(p.quando).getTime()).toBeGreaterThan(AGORA.getTime());
    expect([15, 45]).toContain(new Date(p.quando).getUTCMinutes());
    expect(p.historico).toContain('com o mesmo consultor');
  });

  it('Giovanna marca NÃO ATENDEU: o card é remarcado com a Nilce, na faixa :15/:45 dela', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    const seco = await tick({ dry: true });
    expect(seco.previa?.[0]).toMatchObject({ id: 1, dono: 'Nilce', veioDe: 'Giovanna' });
    const r = await tick();
    expect(r.remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.vendedor_nome).toBe('Nilce');
    expect(p.status).toBe('agendado');
    expect(new Date(p.quando).getTime()).toBeGreaterThan(AGORA.getTime());
    expect([15, 45]).toContain(new Date(p.quando).getUTCMinutes());
  });

  it('Thiago e Diego, como estão hoje: ficam com o mesmo consultor', async () => {
    for (const dono of ['Thiago', 'Diego']) {
      updates.length = 0;
      vermelhos = [card({ vendedor_nome: dono })];
      expect((await tick()).remarcados).toBe(1);
      expect(updates[0].patch).not.toHaveProperty('vendedor_nome');
    }
  });
});

describe('o não atendeu passa pra outra (13/10/2026), com SOLAR_NAO_ATENDEU_TROCA_ON=1', () => {
  /** Minuto do horário em Brasília (o fuso é fixo, então bate com o UTC). */
  const minuto = (iso: string) => new Date(iso).getUTCMinutes();
  const diaUtil = (iso: string) => {
    const dow = new Date(`${iso.slice(0, 10)}T12:00:00-03:00`).getUTCDay();
    return dow !== 0 && dow !== 6;
  };
  const seguintes = (iso: string) => new Date(iso).getTime() > AGORA.getTime()
    && iso.slice(0, 10) > '2026-09-30';

  it('Giovanna marca NÃO ATENDEU: o card vai pra Nilce, agendado, outro dia, em :15 ou :45', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.vendedor_nome).toBe('Nilce');
    expect(p.status).toBe('agendado');
    expect(seguintes(p.quando)).toBe(true);
    expect(diaUtil(p.quando)).toBe(true);
    expect([15, 45]).toContain(minuto(p.quando));
  });

  it('Nilce marca NÃO ATENDEU: o card vai pra Giovanna, agendado, outro dia, em :15 ou :45', async () => {
    vermelhos = [card({ vendedor_nome: 'Nilce' })];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.vendedor_nome).toBe('Giovanna');
    expect(p.status).toBe('agendado');
    expect(seguintes(p.quando)).toBe(true);
    expect(diaUtil(p.quando)).toBe(true);
    expect([15, 45]).toContain(minuto(p.quando));
  });

  it('horário livre na agenda de quem entrega mas OCUPADO na de quem recebe: cai no próximo livre de quem recebe', async () => {
    // 08:15 de quinta 01/10 ocupado na Nilce (quem recebe) e LIVRE na Giovanna.
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    futura = [{ quando: '2026-10-01T11:15:00.000Z', vendedor_nome: 'Nilce', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' }];
    await tick();
    expect(updates[0].patch.vendedor_nome).toBe('Nilce');
    expect(updates[0].patch.quando).toBe('2026-10-01T11:45:00.000Z');
  });

  it('e o horário ocupado na agenda de quem ENTREGA não segura a vaga de quem recebe', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    futura = [{ quando: '2026-10-01T11:15:00.000Z', vendedor_nome: 'Giovanna', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' }];
    await tick();
    expect(updates[0].patch.quando).toBe('2026-10-01T11:15:00.000Z');
  });

  it('23505 na primeira tentativa: tenta o seguinte, ainda na agenda de quem recebe, e grava o dono novo', async () => {
    // Nilce entrega, Giovanna recebe. 08:15 ocupado SÓ na Nilce e 08:45 ocupado SÓ
    // na Giovanna: lendo a agenda de quem recebe, a 1ª tentativa é 08:15 (recusada
    // pelo índice) e a 2ª pula 08:45 e cai em 09:15. Lendo a de quem entrega, a 1ª
    // já seria 08:45 e o teste falha logo no primeiro update.
    vermelhos = [card({ vendedor_nome: 'Nilce' })];
    futura = [
      { quando: '2026-10-01T11:15:00.000Z', vendedor_nome: 'Nilce', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' },
      { quando: '2026-10-01T11:45:00.000Z', vendedor_nome: 'Giovanna', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' },
    ];
    colidemEm = ['2026-10-01T11:15:00.000Z'];
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(r.erros).toBe(0);
    expect(updates).toHaveLength(2);
    expect(updates[0].patch.quando).toBe('2026-10-01T11:15:00.000Z');
    expect(updates[0].patch.vendedor_nome).toBe('Giovanna');
    expect(updates[1].patch.quando).toBe('2026-10-01T12:15:00.000Z');
    expect(updates[1].patch.vendedor_nome).toBe('Giovanna');
    // A trava de corrida usa o dono LIDO (quem entrega), nas duas tentativas.
    expect(updates[1].exigiuDono).toBe('Nilce');
  });

  it('sócio com NÃO ATENDEU: o update NÃO traz vendedor_nome', async () => {
    for (const socio of ['Thiago', 'Diego']) {
      state.clear(); updates.length = 0;
      vermelhos = [card({ vendedor_nome: socio })];
      expect((await tick()).remarcados, socio).toBe(1);
      expect(updates[0].patch, socio).not.toHaveProperty('vendedor_nome');
      expect(updates[0].exigiuDono, socio).toBe(socio);
    }
  });

  it('card esquecido (agendado vencido) da Giovanna: continua com a Giovanna', async () => {
    vermelhos = [card({ status: 'agendado', vendedor_nome: 'Giovanna', quando: new Date(AGORA.getTime() - 7 * 3600_000).toISOString() })];
    // 08:15 ocupado na Giovanna: a vaga tem que sair da agenda DELA (o dono fica),
    // então o card cai em 08:45. Na agenda da Nilce o 08:15 estaria livre.
    futura = [{ quando: '2026-10-01T11:15:00.000Z', vendedor_nome: 'Giovanna', cliente_telefone: null, created_by: 'lead-meta', status: 'agendado' }];
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.quando).toBe('2026-10-01T11:45:00.000Z');
    expect(updates[0].patch).not.toHaveProperty('vendedor_nome');
    expect(updates[0].patch.historico).toContain('com o mesmo consultor');
  });

  it('card em negociação da Giovanna: continua com a Giovanna', async () => {
    vermelhos = [card({ status: 'fez_orcamento', vendedor_nome: 'Giovanna', quando: new Date(AGORA.getTime() - 25 * 3600_000).toISOString() })];
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch).not.toHaveProperty('vendedor_nome');
    expect(updates[0].patch.historico).toContain('com o mesmo consultor');
  });

  it('sem SOLAR_NAO_ATENDEU_TROCA_ON o NÃO ATENDEU da Giovanna vai para a Nilce, e o da Nilce fica com ela', async () => {
    delete process.env.SOLAR_NAO_ATENDEU_TROCA_ON;
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.vendedor_nome).toBe('Nilce');
    expect(updates[0].patch.status).toBe('agendado');
    vermelhos = [card({ vendedor_nome: 'Nilce' })];
    updates.length = 0;
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch).not.toHaveProperty('vendedor_nome');
  });

  it('a gravação exige o dono que foi LIDO: se alguém passou o card na mão, quem manda é a pessoa', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    await tick();
    expect(updates[0].patch.vendedor_nome).toBe('Nilce');
    expect(updates[0].exigiuDono).toBe('Giovanna');
  });

  it('o carimbo do ciclo guarda de quem pra quem, sem mexer nos campos de sempre', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    await tick();
    const v = state.get('solar_reagenda:1')?.value;
    expect(v?.troca).toEqual({ de: 'Giovanna', para: 'Nilce' });
    // Sem `status` aqui: o mock aplica o patch no mesmo objeto que o módulo leu,
    // então o `String(f.status)` do carimbo já vê `agendado`. Em produção a
    // linha lida e a gravada são objetos diferentes.
    expect(v).toMatchObject({ n: 1, relogio: 'fala', degrau: 1 });
    expect(v).toHaveProperty('ultimo');
    expect(v).toHaveProperty('de');
    // E o leitor do carimbo não quebra com o campo a mais: a volta 2 é contada.
    updates.length = 0;
    vermelhos = [card({ vendedor_nome: 'Nilce', quando: '2026-09-25T11:15:00.000Z' })];
    state.get('solar_reagenda:1')!.value.ultimo = '2026-09-01T00:00:00.000Z';
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:1')?.value?.n).toBe(2);
  });

  it('o histórico com troca escreve os dois nomes, e não diz "mesmo consultor"', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    await tick();
    const linha = String(updates[0].patch.historico);
    expect(linha).toContain('Remarcação automática 1/3');
    expect(linha).toContain('com Giovanna e passou para Nilce, que liga em');
    expect(linha).not.toContain('mesmo consultor');
    expect(linha).not.toContain('—');
  });

  it('linhaDoHistorico: com troca nomeia os dois; sem troca o texto é o de antes', async () => {
    const { linhaDoHistorico } = await import('../services/agenda/reagendaSolarNaoAtendido');
    const de = '2026-09-25T11:15:00.000Z', para = '2026-10-01T11:15:00.000Z';
    const com = linhaDoHistorico(de, para, 1, 'fala', 1, { de: 'Nilce', para: 'Giovanna' });
    expect(com).toMatch(/Sistema\] 🔁 Remarcação automática 1\/3: não atendeu em .* com Nilce e passou para Giovanna, que liga em /);
    expect(com).not.toContain('mesmo consultor');
    const sem = linhaDoHistorico(de, para, 1, 'fala', 1);
    expect(sem).toMatch(/Remarcação automática 1\/3: não atendeu em .* e voltou pra .*, com o mesmo consultor\.$/);
    expect(sem).not.toContain('passou para');
  });

  it('dry=1 mostra a parceira como dono e de quem veio; sócio não ganha veioDe', async () => {
    vermelhos = [card({ vendedor_nome: 'Nilce' })];
    const r = await tick({ dry: true });
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Giovanna', veioDe: 'Nilce' });
    expect(updates).toHaveLength(0);
    vermelhos = [card({ vendedor_nome: 'Thiago' })];
    const s = await tick({ dry: true });
    expect(s.previa?.[0]).toMatchObject({ dono: 'Thiago' });
    expect(s.previa?.[0]).not.toHaveProperty('veioDe');
  });

  it('donoDaVolta e parceiraDaLigacao: puras', async () => {
    const { donoDaVolta } = await import('../services/agenda/reagendaSolarNaoAtendido');
    const { parceiraDaLigacao } = await import('../services/agenda/solarRota');
    expect(donoDaVolta('Giovanna', 'nao_atendeu')).toBe('Nilce');
    expect(donoDaVolta('Nilce', 'nao_atendeu')).toBe('Giovanna');
    expect(donoDaVolta(' Nilce ', 'nao_atendeu')).toBe('Giovanna');
    expect(donoDaVolta('Giovanna', 'agendado')).toBe('Giovanna');
    expect(donoDaVolta('Giovanna', 'fez_orcamento')).toBe('Giovanna');
    expect(donoDaVolta('Thiago', 'nao_atendeu')).toBe('Thiago');
    expect(donoDaVolta('', 'nao_atendeu')).toBe('');
    expect(parceiraDaLigacao('Diego')).toBeNull();
    expect(parceiraDaLigacao(null)).toBeNull();
  });

  // A lista que escolhe quem recebe o card (DONAS_DUAS_FAIXAS) e a lista de quem o
  // bom dia das 7h enxerga (DONAS) são duas. Se divergirem, o cliente fica sem aviso.
  it('toda parceira da ligação está entre as donas que o bom dia enxerga', async () => {
    const { DONAS_DUAS_FAIXAS, parceiraDaLigacao } = await import('../services/agenda/solarRota');
    const { DONAS } = await import('../services/io/solarAgendaGiovanna');
    expect(DONAS_DUAS_FAIXAS.length).toBeGreaterThan(0);
    for (const d of DONAS_DUAS_FAIXAS) {
      const p = parceiraDaLigacao(d);
      expect(p).not.toBeNull();
      expect(p).not.toBe(d);
      expect(DONAS).toContain(p);
    }
  });
});

// ── O TETO CONTA SÓ AS VOLTAS DO VERMELHO (13/10/2026) ──────────────────────
//
// O teto de 3 voltas protege a linha de WhatsApp: cada volta do vermelho destrava
// um bom dia e um "oi". Ele lia o `n` do carimbo, que soma TAMBÉM as voltas
// silenciosas. Medido em 13/10: 33 dos 116 cards vivos de solar da Giovanna e da
// Nilce tinham `n >= 3`, 30 só por volta silenciosa, e o NÃO ATENDEU deles ficava
// parado sem erro. Agora o carimbo grava `nFala`, e o carimbo antigo (sem o campo)
// é contado pelo histórico do card.
describe('o teto conta só as voltas do vermelho (13/10/2026)', () => {
  const VELHO = '2026-09-01T00:00:00.000Z';
  const carimbo = (id: number, value: any) =>
    state.set(`solar_reagenda:${id}`, { key: `solar_reagenda:${id}`, value: { ultimo: VELHO, ...value }, updated_at: VELHO });
  const silenciosas =
    '[02/10 · 00:01 · Sistema] 🔁 Ciclo de 24h (1ª volta nesta etiqueta): o dia de qui 01/10 · 10:15 fechou com a negociação parada.\n\n'
    + '[03/10 · 09:30 · Sistema] 🔁 Remarcação automática (2ª vez): a ligação de sex 02/10 · 10:15 passou e o card ficou sem desfecho por mais de 6h.';
  const doVermelho = (n: number, m = 3) =>
    `[0${n}/10 · 09:30 · Sistema] 🔁 Remarcação automática ${n}/${m}: não atendeu em qua 30/09 · 10:15 e voltou pra qui 01/10 · 10:15, com o mesmo consultor.`;

  it('n >= 3 só de volta silenciosa e sem nFala: o NÃO ATENDEU MOVE, e a linha diz 1/3', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego', historico: silenciosas })];
    carimbo(1, { n: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(updates[0].patch.status).toBe('agendado');
    expect(updates[0].patch.historico).toContain('Remarcação automática 1/3');
    expect(updates[0].patch.historico).not.toContain('4/3');
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({ n: 4, nFala: 1 });
  });

  it('nFala: 3 no carimbo: NÃO move, mesmo com histórico limpo', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego', historico: silenciosas })];
    carimbo(1, { n: 5, nFala: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
    expect(updates).toHaveLength(0);
  });

  it('nFala: 2 move, e o carimbo sobe pra nFala: 3 (a próxima já bate no teto)', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego' })];
    carimbo(1, { n: 4, nFala: 2 });
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({ n: 5, nFala: 3 });
    expect(updates[0].patch.historico).toContain('Remarcação automática 3/3');
  });

  it('sem nFala e com 3 linhas do vermelho no histórico: NÃO move', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego', historico: [doVermelho(3), silenciosas, doVermelho(2), doVermelho(1)].join('\n\n') })];
    carimbo(1, { n: 1 });
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
  });

  it('vale o maior dos dois: carimbo nFala: 1 com 3 linhas no histórico NÃO move, e nFala: 3 com histórico vazio NÃO move', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego', historico: [doVermelho(3), doVermelho(2), doVermelho(1)].join('\n\n') })];
    carimbo(1, { n: 3, nFala: 1 });
    const a = await tick();
    expect(a.remarcados).toBe(0);
    expect(a.motivo).toBe('ninguem_na_vez');
    expect(updates).toHaveLength(0);

    vermelhos = [card({ vendedor_nome: 'Diego', historico: '' })];
    carimbo(1, { n: 3, nFala: 3 });
    const b = await tick();
    expect(b.remarcados).toBe(0);
    expect(b.motivo).toBe('ninguem_na_vez');
    expect(updates).toHaveLength(0);
  });

  it('carimbo antigo (n: 5, sem nFala) com 2 linhas do vermelho e silenciosas: MOVE, a linha diz 3/3 e o carimbo sai n: 6, nFala: 3', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego', historico: [doVermelho(2), silenciosas, doVermelho(1)].join('\n\n') })];
    carimbo(1, { n: 5 });
    expect((await tick()).remarcados).toBe(1);
    expect(updates[0].patch.historico).toContain('Remarcação automática 3/3');
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({ n: 6, nFala: 3 });
  });

  it('volta silenciosa (negociação) em card com nFala: 2 mantém nFala: 2', async () => {
    vermelhos = [card({ id: 80, status: 'fez_orcamento', quando: new Date(AGORA.getTime() - 25 * 3600_000).toISOString() })];
    carimbo(80, { n: 5, nFala: 2, relogio: 'mudo', status: 'fez_orcamento', degrau: 1 });
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:80')?.value).toMatchObject({ n: 6, nFala: 2, relogio: 'mudo' });
    expect(updates[0].patch.historico).toContain('Ciclo de');
  });

  it('volta silenciosa (esquecido) em card com nFala: 2 mantém nFala: 2, e a linha segue com "Nª vez"', async () => {
    vermelhos = [card({ id: 81, status: 'agendado', quando: new Date(AGORA.getTime() - 7 * 3600_000).toISOString() })];
    carimbo(81, { n: 4, nFala: 2 });
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:81')?.value).toMatchObject({ n: 5, nFala: 2 });
    expect(updates[0].patch.historico).toContain('Remarcação automática (5ª vez)');
  });

  it('volta silenciosa em card sem nFala grava o que o histórico já contava', async () => {
    vermelhos = [card({ id: 82, status: 'agendado', quando: new Date(AGORA.getTime() - 7 * 3600_000).toISOString(),
      historico: [doVermelho(2), doVermelho(1)].join('\n\n') })];
    carimbo(82, { n: 2 });
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:82')?.value).toMatchObject({ n: 3, nFala: 2 });
  });

  it('Giovanna no mesmo caso: além de mover, passa pra Nilce (as duas regras juntas)', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna', historico: silenciosas })];
    carimbo(1, { n: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(updates[0].patch.vendedor_nome).toBe('Nilce');
    expect(updates[0].patch.status).toBe('agendado');
    expect(updates[0].patch.historico).toContain('Remarcação automática 1/3: não atendeu em');
    expect(updates[0].patch.historico).toContain('com Giovanna e passou para Nilce');
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({ n: 4, nFala: 1, troca: { de: 'Giovanna', para: 'Nilce' } });
  });

  it('dry=1 mostra a volta do vermelho, não o total', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego', historico: silenciosas })];
    carimbo(1, { n: 3 });
    const r = await tick({ dry: true });
    expect(r.previa?.[0]).toMatchObject({ id: 1, volta: 1 });
    expect(updates).toHaveLength(0);
  });

  it('vermelhasNoHistorico: conta o vermelho em todos os formatos, não o esquecido nem a negociação', async () => {
    const { vermelhasNoHistorico, linhaDoHistorico } = await import('../services/agenda/reagendaSolarNaoAtendido');
    const de = '2026-09-25T11:15:00.000Z', para = '2026-10-01T11:15:00.000Z';
    // Formato atual, sem e com troca de consultora (gerados pela função de verdade).
    expect(vermelhasNoHistorico(linhaDoHistorico(de, para, 1, 'fala', 1))).toBe(1);
    expect(vermelhasNoHistorico(linhaDoHistorico(de, para, 2, 'fala', 1, { de: 'Giovanna', para: 'Nilce' }))).toBe(1);
    // Formato de 29/09 e 01/10 (69ee0909, 8b8e28b9) com o teto antigo no denominador.
    expect(vermelhasNoHistorico('[30/09 · 10:00 · Sistema] 🔁 Remarcação automática 1/2: não atendeu em qua 30/09 · 10:15 e voltou pra qui 01/10 · 10:15, com o mesmo consultor.')).toBe(1);
    // Esquecido e negociação não contam.
    expect(vermelhasNoHistorico(linhaDoHistorico(de, para, 2, 'esquecido', 1))).toBe(0);
    expect(vermelhasNoHistorico(linhaDoHistorico(de, para, 3, 'negocia', 2))).toBe(0);
    expect(vermelhasNoHistorico(silenciosas)).toBe(0);
    // Misturado: três do vermelho no meio de silenciosas e de texto livre.
    const misto = [
      linhaDoHistorico(de, para, 1, 'fala', 1),
      linhaDoHistorico(de, para, 2, 'esquecido', 1),
      'Cliente pediu pra ligar de tarde. Remarcação automática foi boa.',
      linhaDoHistorico(de, para, 2, 'fala', 1, { de: 'Nilce', para: 'Giovanna' }),
      linhaDoHistorico(de, para, 4, 'negocia', 3),
      linhaDoHistorico(de, para, 3, 'fala', 1),
    ].join('\n\n');
    expect(vermelhasNoHistorico(misto)).toBe(3);
    // Entradas vazias.
    expect(vermelhasNoHistorico(null)).toBe(0);
    expect(vermelhasNoHistorico(undefined)).toBe(0);
    expect(vermelhasNoHistorico('')).toBe(0);
  });
});

// ── DEPOIS DO TETO O CARD AINDA PASSA, SÓ QUE CALADO (13/10/2026) ───────────────
//
// O dono repetiu: "quando a Giovanna/Nilce coloca um cliente em NÃO ATENDEU passa
// automaticamente à outra". O teto de 3 voltas do vermelho deixava o card parado
// com a mesma consultora. Agora ele limita as MENSAGENS: o card da Giovanna e da
// Nilce no teto passa pra outra sem destravar aviso e gasta a rampa MUDA. Calada de
// verdade: o update PREENCHE com a hora de agora só o carimbo da régua que veio
// nulo (senão o `solarAgendaGiovanna` falaria no dia novo com o carimbo `mudo`), e
// nunca troca a hora de um que já tem valor (o `solarRespostas` lê `bomdia_at`
// como o último toque real). Zerar liberaria bom dia. Sócio no teto segue parando.
describe('depois do teto o card passa calado (13/10/2026)', () => {
  const VELHO = '2026-09-01T00:00:00.000Z';
  /** O caso comum: bom dia e "oi" já saíram, os dois carimbos têm valor. */
  const REGUA_FEITA = { bomdia_at: '2026-09-29T10:00:00.000Z', lembrete_5min_at: '2026-09-29T14:10:00.000Z' };
  const ehIso = (v: any) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());
  const carimbo = (id: number, value: any) =>
    state.set(`solar_reagenda:${id}`, { key: `solar_reagenda:${id}`, value: { ultimo: VELHO, ...value }, updated_at: VELHO });
  const doVermelho = (n: number) =>
    `[0${n}/10 · 09:30 · Sistema] 🔁 Remarcação automática ${n}/3: não atendeu em qua 30/09 · 10:15 e voltou pra qui 01/10 · 10:15, com o mesmo consultor.`;
  const tres = () => [doVermelho(3), doVermelho(2), doVermelho(1)].join('\n\n');

  async function passaCalado(de: 'Giovanna' | 'Nilce', para: 'Giovanna' | 'Nilce') {
    const { vermelhasNoHistorico } = await import('../services/agenda/reagendaSolarNaoAtendido');
    vermelhos = [card({ vendedor_nome: de, historico: tres(), ...REGUA_FEITA })];
    carimbo(1, { n: 5, nFala: 3 });
    const antes = vermelhasNoHistorico(vermelhos[0].historico);
    const r = await tick();
    expect(r.remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.status).toBe('agendado');
    expect(p.vendedor_nome).toBe(para);
    expect(p.confirmacao_at).toBeNull();
    expect(p.lembrete_1h_at).toBeNull();
    // Os dois já tinham valor: nem zera nem refaz, as chaves nem entram no update.
    expect('bomdia_at' in p).toBe(false);
    expect('lembrete_5min_at' in p).toBe(false);
    expect(new Date(p.quando).getTime()).toBeGreaterThan(AGORA.getTime());
    expect(p.quando.slice(0, 10) > '2026-09-30').toBe(true);   // a partir de amanhã
    expect([15, 45]).toContain(new Date(p.quando).getUTCMinutes());
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({
      n: 6, nFala: 3, relogio: 'mudo', calada: true, troca: { de, para },
    });
    // A linha nova avisa o time, e NÃO é contada como volta do vermelho.
    const nova = String(p.historico).split('\n\n')[0];
    expect(nova).toContain('Remarcação automática (6ª vez)');
    expect(nova).toContain(`com ${de} e passou para ${para}`);
    expect(nova).toContain('O bom dia e o oi automáticos já saíram em 3 remarcações, então esta não liberou mensagem nova para o cliente.');
    expect(nova).not.toContain('avisos automáticos de não atendimento');
    expect(nova).not.toMatch(/automática \d+\/\d+/);
    expect(vermelhasNoHistorico(p.historico)).toBe(antes);
  }

  it('Giovanna no teto (nFala: 3, régua feita): MOVE pra Nilce, calado, sem mexer nos dois carimbos', async () => {
    await passaCalado('Giovanna', 'Nilce');
  });

  it('Nilce no teto (nFala: 3, régua feita): MOVE pra Giovanna, calado, sem mexer nos dois carimbos', async () => {
    await passaCalado('Nilce', 'Giovanna');
  });

  it('teto vindo só do histórico (carimbo sem nFala, 3 linhas do vermelho): também passa calado', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna', historico: tres(), ...REGUA_FEITA })];
    carimbo(1, { n: 1 });
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.vendedor_nome).toBe('Nilce');
    expect('bomdia_at' in p).toBe(false);
    expect('lembrete_5min_at' in p).toBe(false);
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({ n: 2, nFala: 3, relogio: 'mudo', calada: true });
  });

  // ── CALADA DE VERDADE: preenche só o que veio nulo ──────────────────────────
  it('no teto com os DOIS carimbos nulos: o update traz os dois, com a hora de agora', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna', bomdia_at: null, lembrete_5min_at: null })];
    carimbo(1, { n: 5, nFala: 3 });
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect(ehIso(p.bomdia_at)).toBe(true);
    expect(ehIso(p.lembrete_5min_at)).toBe(true);
    expect(p.bomdia_at).toBe(AGORA.toISOString());
    expect(p.lembrete_5min_at).toBe(AGORA.toISOString());
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({ relogio: 'mudo', calada: true });
  });

  it('no teto com bomdia_at preenchido e lembrete_5min_at nulo: o update traz SÓ o lembrete', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna', bomdia_at: REGUA_FEITA.bomdia_at, lembrete_5min_at: null })];
    carimbo(1, { n: 5, nFala: 3 });
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect(ehIso(p.lembrete_5min_at)).toBe(true);
    expect('bomdia_at' in p).toBe(false);   // a hora de um bom dia verdadeiro não se troca
  });

  it('no teto com lembrete_5min_at preenchido e bomdia_at nulo: o update traz SÓ o bom dia', async () => {
    vermelhos = [card({ vendedor_nome: 'Nilce', bomdia_at: null, lembrete_5min_at: REGUA_FEITA.lembrete_5min_at })];
    carimbo(1, { n: 5, nFala: 3 });
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect(ehIso(p.bomdia_at)).toBe(true);
    expect('lembrete_5min_at' in p).toBe(false);
  });

  it('no teto com os DOIS preenchidos: o update não tem nenhuma das duas chaves', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna', ...REGUA_FEITA })];
    carimbo(1, { n: 5, nFala: 3 });
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect('bomdia_at' in p).toBe(false);
    expect('lembrete_5min_at' in p).toBe(false);
  });

  // A volta: depois de Giovanna para Nilce, a Nilce também marca NÃO ATENDEU, e o
  // card vai de volta pra Giovanna, calado, sem subir o teto.
  it('a Nilce marca NÃO ATENDEU no card que veio da Giovanna: volta pra Giovanna calado, nFala segue 3 e n sobe 1', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna', historico: tres(), ...REGUA_FEITA })];
    carimbo(1, { n: 5, nFala: 3 });
    expect((await tick()).remarcados).toBe(1);
    const volta1 = state.get('solar_reagenda:1')!.value;
    expect(volta1).toMatchObject({ n: 6, nFala: 3, relogio: 'mudo', calada: true, troca: { de: 'Giovanna', para: 'Nilce' } });

    // A Nilce liga, não atende, e aperta NÃO ATENDEU: status vermelho de novo,
    // horário já vencido, dono Nilce, o histórico que o primeiro tick gravou.
    const historicoDepois = String(updates[0].patch.historico);
    updates.length = 0;
    vermelhos = [card({
      vendedor_nome: 'Nilce', status: 'nao_atendeu', historico: historicoDepois, ...REGUA_FEITA,
      quando: '2026-09-29T11:15:00.000Z',
    })];
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.vendedor_nome).toBe('Giovanna');
    expect(p.status).toBe('agendado');
    expect('bomdia_at' in p).toBe(false);
    expect('lembrete_5min_at' in p).toBe(false);
    expect(String(p.historico).split('\n\n')[0]).toContain('(7ª vez)');
    expect(state.get('solar_reagenda:1')?.value).toMatchObject({
      n: 7, nFala: 3, relogio: 'mudo', calada: true, troca: { de: 'Nilce', para: 'Giovanna' },
    });
  });

  it('sócio no teto (nFala: 3): NÃO move, como sempre', async () => {
    vermelhos = [card({ vendedor_nome: 'Diego' })];
    carimbo(1, { n: 5, nFala: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
    expect(updates).toHaveLength(0);
  });

  it('sem SOLAR_NAO_ATENDEU_TROCA_ON, com a Nilce no teto: NÃO move (volta a valer o teto; ela não troca com a Giovanna)', async () => {
    delete process.env.SOLAR_NAO_ATENDEU_TROCA_ON;
    vermelhos = [card({ vendedor_nome: 'Nilce' })];
    carimbo(1, { n: 5, nFala: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
    expect(updates).toHaveLength(0);
  });

  it('sem SOLAR_NAO_ATENDEU_TROCA_ON, com a Giovanna no teto: MOVE pra Nilce, calado', async () => {
    delete process.env.SOLAR_NAO_ATENDEU_TROCA_ON;
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    carimbo(1, { n: 5, nFala: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(1);
    expect(updates[0].patch.vendedor_nome).toBe('Nilce');
  });

  // A troca calada não manda nada, então gasta a rampa dos calados. Os carimbos do
  // dia são montados como nos testes da rampa acima.
  describe('rampa', () => {
    const doDia = (id: number, relogio: 'fala' | 'mudo') => {
      const hoje = AGORA.toISOString();
      state.set(`solar_reagenda:${id}`, {
        key: `solar_reagenda:${id}`, value: { n: 1, ultimo: hoje, relogio }, updated_at: hoje,
      });
    };

    it('com a rampa de FALA cheia a troca calada ainda anda', async () => {
      process.env.SOLAR_REAGENDA_POR_DIA = '1';
      doDia(901, 'fala');
      vermelhos = [card({ vendedor_nome: 'Giovanna' })];
      carimbo(1, { n: 5, nFala: 3 });
      expect((await tick()).remarcados).toBe(1);
      expect(updates[0].patch.vendedor_nome).toBe('Nilce');
    });

    it('com a rampa MUDA cheia a troca calada NÃO anda', async () => {
      process.env.SOLAR_REAGENDA_MUDO_POR_DIA = '1';
      doDia(901, 'mudo');
      vermelhos = [card({ vendedor_nome: 'Giovanna' })];
      carimbo(1, { n: 5, nFala: 3 });
      const r = await tick();
      expect(r.remarcados).toBe(0);
      expect(r.motivo).toBe('rampa_do_dia_cheia');
      expect(updates).toHaveLength(0);
    });

    it('e ela gasta a rampa muda, não a de fala: a próxima troca calada do dia já não anda', async () => {
      process.env.SOLAR_REAGENDA_MUDO_POR_DIA = '1';
      vermelhos = [card({ vendedor_nome: 'Giovanna' })];
      carimbo(1, { n: 5, nFala: 3 });
      expect((await tick()).remarcados).toBe(1);
      vermelhos = [card({ id: 2, vendedor_nome: 'Nilce', cliente_telefone: '5534991112222' })];
      carimbo(2, { n: 5, nFala: 3 });
      const r = await tick();
      expect(r.remarcados).toBe(0);
      expect(r.motivo).toBe('rampa_do_dia_cheia');
    });
  });

  it('regressão: Giovanna com nFala: 2 continua FALANDO (zera os dois campos, relogio fala, linha 3/3)', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    carimbo(1, { n: 4, nFala: 2 });
    expect((await tick()).remarcados).toBe(1);
    const p = updates[0].patch;
    expect(p.vendedor_nome).toBe('Nilce');
    expect(p.bomdia_at).toBeNull();
    expect(p.lembrete_5min_at).toBeNull();
    expect(p.historico).toContain('Remarcação automática 3/3: não atendeu em');
    const v = state.get('solar_reagenda:1')?.value;
    expect(v).toMatchObject({ n: 5, nFala: 3, relogio: 'fala' });
    expect(v.calada).toBeUndefined();
  });

  it('fora da janela de horário a troca calada não anda (a janela vale pra todo NÃO ATENDEU)', async () => {
    vi.setSystemTime(new Date('2026-09-30T23:00:00.000Z'));   // 20h BRT
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    carimbo(1, { n: 5, nFala: 3 });
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('fora_da_janela');
    expect(updates).toHaveLength(0);
  });

  it('dry=1 mostra calada: true, e não grava nada', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    carimbo(1, { n: 5, nFala: 3 });
    const r = await tick({ dry: true });
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Nilce', veioDe: 'Giovanna', calada: true });
    expect(updates).toHaveLength(0);
  });

  it('dry=1 de quem ainda fala NÃO traz calada', async () => {
    vermelhos = [card({ vendedor_nome: 'Giovanna' })];
    carimbo(1, { n: 4, nFala: 2 });
    const r = await tick({ dry: true });
    expect(r.previa?.[0]?.calada).toBeUndefined();
  });

  it('linhaDaTrocaCalada nunca casa o regex do vermelho', async () => {
    const { linhaDaTrocaCalada, vermelhasNoHistorico } = await import('../services/agenda/reagendaSolarNaoAtendido');
    const linha = linhaDaTrocaCalada('2026-09-25T11:15:00.000Z', '2026-10-01T11:15:00.000Z', 9, { de: 'Nilce', para: 'Giovanna' });
    expect(vermelhasNoHistorico(linha)).toBe(0);
    expect(linha).toContain('(9ª vez)');
    expect(linha).not.toContain('nada foi enviado');
    expect(linha).not.toContain('—');
  });
});
