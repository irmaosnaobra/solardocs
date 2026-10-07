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
          updates.push({ id, patch: q._patch, exigiuStatus: q._status });
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

beforeEach(() => {
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
  it('a grade é 8–11 e 13–16 de 30 em 30, com almoço fechado', async () => {
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

  it('três voltas e para: o card fica pra gente', async () => {
    state.set('solar_reagenda:1', { key: 'solar_reagenda:1', value: { n: 3 }, updated_at: '2026-09-01T00:00:00.000Z' });
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
    futura = [{
      id: 900, quando: primeiro, vendedor_nome: 'Giovanna',
      cliente_telefone: '5534900000900', created_by: 'lead-meta', status: 'chave_na_mao',
    }];
    await tick();
    expect(updates[0].patch.quando).not.toBe(primeiro);
  });

  it('mas horário cancelado não ocupa nada — é a outra ponta da mesma régua', async () => {
    const primeiro = '2026-10-01T11:00:00.000Z';
    futura = [{
      id: 900, quando: primeiro, vendedor_nome: 'Giovanna',
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
    const primeiro = '2026-10-01T11:00:00.000Z';
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
    colidemEm = ['2026-10-01T11:00:00.000Z', '2026-10-01T11:30:00.000Z',
      '2026-10-01T12:00:00.000Z', '2026-10-01T12:30:00.000Z', '2026-10-01T13:00:00.000Z'];
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

  it('no degrau 1, 40h não bastam: o degrau 2 pede 48h', async () => {
    vermelhos = [card({ id: 70, status: 'fez_orcamento', quando: hAtras(40) })];
    noDegrau(70, 'fez_orcamento', 1);
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('todos_no_degrau');
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
  it('no degrau 2 o próximo REPETE as 48h, e no 3 o próximo sobe pra 72h', async () => {
    vermelhos = [card({ id: 75, status: 'fez_orcamento', quando: hAtras(49) })];
    noDegrau(75, 'fez_orcamento', 2);
    expect((await tick()).remarcados).toBe(1);
    expect(state.get('solar_reagenda:75')?.value?.degrau).toBe(3);

    state.clear(); updates.length = 0;
    vermelhos = [card({ id: 76, status: 'fez_orcamento', quando: hAtras(60) })];
    noDegrau(76, 'fez_orcamento', 3);
    expect((await tick()).motivo).toBe('todos_no_degrau');
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
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Giovanna' });
    expect(updates).toHaveLength(0);
  });

  it('dry mostra de quando pra quando, sem tocar em nada', async () => {
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('remarcaria_agora');
    expect(r.previa?.[0]).toMatchObject({ id: 1, dono: 'Giovanna', volta: 1 });
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

  it('o vermelho continua parando no teto de 2 voltas', async () => {
    state.set('solar_reagenda:1', { key: 'solar_reagenda:1', value: { n: 3, ultimo: '2026-09-01T00:00:00.000Z' }, updated_at: '2026-09-01T00:00:00.000Z' });
    vermelhos = [card({ status: 'nao_atendeu' })];
    const r = await tick();
    expect(r.remarcados).toBe(0);
    expect(r.motivo).toBe('ninguem_na_vez');
  });

  it('card de eletroposto nunca entra aqui: ele tem régua própria', async () => {
    vermelhos = [esquecido(7, { created_by: 'lp_eletroposto' })];
    expect((await tick()).remarcados).toBe(0);
  });
});
