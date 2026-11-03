import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Os dois toques do dia da Giovanna e da Nilce. Os riscos aqui são concretos e
// cada um já custou caro em outro agente desta mesma linha: falar com quem não é
// delas, falar com ficha de eletroposto (o lead #584 respondeu "não solicitei
// nenhum serviço de energia solar"), repetir o toque, mandar duas bolhas numa
// leva de 15 pessoas (foi 37 mensagens numa hora que bloquearam a linha em 04/08),
// furar o teto e, desde 15/09, apresentar a pessoa errada no bom dia.

let fichas: any[] = [];
const enviadas: Array<{ phone: string; bolhas: string[]; maxBolhas?: number }> = [];
const updates: Array<{ id: number; campo: string }> = [];
const carimbos: string[] = [];
let tetoLivre = true;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        _update: null as any,
        select() { return q; },
        eq(col: string, v: any) {
          if (q._update) {
            updates.push({ id: v, campo: Object.keys(q._update)[0] });
            return Promise.resolve({ error: null });
          }
          q._filtros[col] = v; return q;
        },
        in(col: string, v: any[]) { q._filtros[`in_${col}`] = v; return q; },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          const donas: string[] = q._filtros['in_vendedor_nome'] ?? [];
          const status = q._filtros['status'];
          const piso = q._filtros['gte_quando'];
          return Promise.resolve({
            data: fichas.filter(f =>
              donas.includes(f.vendedor_nome) && f.status === status && String(f.quando) >= piso),
            error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoLivre),
}));
// Inbox da linha (MAIN). É daqui que sai "esta pessoa respondeu o bom dia".
let inbox: Array<{ telefone: string; momment: string }> = [];
let inboxQuebrado = false;
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === 'wa_mensagens') {
        const q: any = {
          _piso: '',
          select() { return q; },
          eq() { return q; },
          gte(_c: string, v: any) { q._piso = String(v); return q; },
          limit() {
            if (inboxQuebrado) return Promise.resolve({ data: null, error: { message: 'boom' } });
            return Promise.resolve({ data: inbox.filter(m => m.momment >= q._piso), error: null });
          },
        };
        return q;
      }
      return {
        upsert: async (r: any) => { carimbos.push(String(r.key)); return { error: null }; },
        // respostaEmCurso: o carimbo da resposta da Duda (ag5040_sent:<id>:1)
        select() {
          const q: any = {
            _k: '',
            eq(_c: string, v: any) { q._k = String(v); return q; },
            maybeSingle() { return Promise.resolve({ data: estadoSys.get(q._k) ?? null, error: null }); },
          };
          return q;
        },
      };
    },
  },
}));
// A conversa do contato (respostaEmCurso): o inbox acima nao tem .in/.range, entao o lerConversa e simulado inteiro.
let conversa: { msgs: any[]; completa: boolean } = { msgs: [], completa: true };
let conversaFalha: 'nao' | 'incompleta' | 'lanca' = 'nao';
const conversaLida: string[] = [];
const estadoSys = new Map<string, { value: any; updated_at: string }>();
vi.mock('../services/agentes5040/contexto', () => ({
  lerConversa: vi.fn(async (chave: string) => {
    conversaLida.push(chave);
    if (conversaFalha === 'lanca') throw new Error('boom');
    if (conversaFalha === 'incompleta') return { msgs: [], completa: false };
    return conversa;
  }),
}));
// O módulo importa o id da instância daqui; o resto do solarRespostas não entra no teste.
vi.mock('../services/io/solarRespostas', () => ({ INSTANCE_ID_IO: 'INSTANCIA_IO' }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[], _i: string, opts?: any) => {
    enviadas.push({ phone, bolhas, maxBolhas: opts?.maxBolhas });
  }),
}));

import {
  runSolarAgendaGiovannaTick, BOLHA_BOM_DIA, BOLHA_CINCO_MIN, SOLAR_GIOVANNA_PREFIX,
  DONAS, bolhaBomDia,
} from '../services/io/solarAgendaGiovanna';

/** ISO real de um horário de Brasília. -03:00 fixo: o Brasil não tem horário de verão. */
const brt = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00-03:00`).toISOString();

const ficha = (over: any = {}) => ({
  id: 1,
  cliente_nome: 'Fulano',
  cliente_telefone: '5534998112208',
  vendedor_nome: 'Giovanna',
  quando: brt('2026-09-14', '10:15'),
  status: 'agendado',
  created_by: 'lead-meta',
  bomdia_at: null,
  lembrete_5min_at: null,
  ...over,
});

/** Congela o relógio num horário de Brasília. */
const agoraBRT = (hhmm: string) => vi.setSystemTime(new Date(brt('2026-09-14', hhmm)));

beforeEach(() => {
  vi.useFakeTimers();
  fichas = []; enviadas.length = 0; updates.length = 0; carimbos.length = 0;
  inbox = []; inboxQuebrado = false;
  conversa = { msgs: [], completa: true }; conversaFalha = 'nao'; conversaLida.length = 0; estadoSys.clear();
  tetoLivre = true;
  delete process.env.SOLAR_GIOVANNA_OFF;
});
afterEach(() => { vi.useRealTimers(); });

describe('bom dia das 7h', () => {
  it('sai pra quem tem ligação hoje, numa bolha só', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(1);
    expect(enviadas).toHaveLength(1);
    // UMA bolha. Duas × 15 pessoas = 30 mensagens numa hora, que é a rajada de 04/08.
    expect(enviadas[0].bolhas).toEqual([BOLHA_BOM_DIA]);
    expect(enviadas[0].maxBolhas).toBe(1);
    expect(updates).toEqual([{ id: 1, campo: 'bomdia_at' }]);
  });

  it('a copy se apresenta e não fala de horário', () => {
    expect(BOLHA_BOM_DIA).toContain('Sou a Giovanna da energia solar');
    expect(BOLHA_BOM_DIA).not.toMatch(/\d{1,2}[:h]\d{2}/);
  });

  it('carimba o teto da linha (senão gasta o número sem aparecer na conta)', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    await runSolarAgendaGiovannaTick();
    expect(carimbos).toEqual([`${SOLAR_GIOVANNA_PREFIX}1:bom_dia`]);
  });

  it('não repete quem já recebeu', async () => {
    fichas = [ficha({ bomdia_at: brt('2026-09-14', '07:02') })];
    agoraBRT('07:30');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('não sai a menos de 30 min da ligação — aí quem fala é o toque de 5 min', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '08:15') })];
    agoraBRT('08:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(0);
  });

  it('fora da janela da manhã não sai', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '16:45') })];
    agoraBRT('11:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(0);
  });

  // 15/09: 32 ligações num dia não cabem entre 7 e 9h a 18 por hora. A janela
  // cresceu em horas, não em ritmo: aumentar o teto é a rajada de 04/08.
  it('ligação da tarde ainda recebe o bom dia às 10h', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '16:45') })];
    agoraBRT('10:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(1);
  });

  it('o bom dia deixa 4 vagas por hora pro toque de 5 min, que tem hora marcada', async () => {
    const { dentroDoTetoHorarioLinha } = await import('../services/agents/whatsapp/lineThrottle');
    vi.mocked(dentroDoTetoHorarioLinha).mockClear();
    fichas = [
      ficha({ id: 1, cliente_telefone: '5534990000001', quando: brt('2026-09-14', '10:15') }),
      ficha({ id: 2, cliente_telefone: '5534990000002', quando: brt('2026-09-14', '13:15') }),
    ];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(1);
    expect(r.bom_dia).toBe(1);
    const pisos = vi.mocked(dentroDoTetoHorarioLinha).mock.calls.map(c => c[0]?.pisoHora);
    expect(pisos).toEqual([18, 14]);
  });

  it('drena no máximo 2 por tick — a leva de 15 sai em ~16 min, não de uma vez', async () => {
    fichas = [1, 2, 3, 4, 5].map(id => ficha({ id, quando: brt('2026-09-14', '10:15') }));
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(2);
  });

  it('teto da linha estourado segura e não manda', async () => {
    fichas = [ficha()];
    tetoLivre = false;
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(0);
    expect(r.segurados_pelo_teto).toBe(1);
    expect(enviadas).toHaveLength(0);
  });
});

// Ordem do Thiago (15/09): a Nilce, "a partir de hoje 15/09 pra frente, nas
// mesmas regras da giovanna". O risco novo é o nome: a bolha diz quem vai ligar.
describe('a carteira da Nilce segue as mesmas regras', () => {
  it('as duas donas são exatamente Giovanna e Nilce', () => {
    expect([...DONAS].sort()).toEqual(['Giovanna', 'Nilce']);
  });

  it('cliente da Nilce recebe o bom dia com o nome DELA', async () => {
    fichas = [ficha({ vendedor_nome: 'Nilce' })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(1);
    expect(enviadas[0].bolhas).toEqual([bolhaBomDia('Nilce')]);
    expect(enviadas[0].bolhas[0]).toContain('Sou a Nilce da energia solar');
    expect(enviadas[0].bolhas[0]).not.toContain('Giovanna');
  });

  it('na mesma rodada, cada cliente ouve o nome de quem vai ligar pra ele', async () => {
    fichas = [
      ficha({ id: 1, vendedor_nome: 'Giovanna', cliente_telefone: '5534990000001', quando: brt('2026-09-14', '08:45') }),
      ficha({ id: 2, vendedor_nome: 'Nilce', cliente_telefone: '5534990000002', quando: brt('2026-09-14', '09:15') }),
    ];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick({ dry: true });
    expect(r.previa!.map(p => [p.id, p.dona, p.bolha])).toEqual([
      [1, 'Giovanna', bolhaBomDia('Giovanna')],
      [2, 'Nilce', bolhaBomDia('Nilce')],
    ]);
  });

  it('cliente da Nilce que respondeu o bom dia também não leva o toque de 5 min', async () => {
    fichas = [ficha({ vendedor_nome: 'Nilce', quando: brt('2026-09-14', '10:15'), bomdia_at: brt('2026-09-14', '07:02') })];
    inbox = [{ telefone: '5534998112208', momment: brt('2026-09-14', '07:20') }];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.ja_responderam).toBe(1);
    expect(enviadas).toHaveLength(0);
  });

  it('o copy da Giovanna continua byte a byte o de 11/09', () => {
    expect(BOLHA_BOM_DIA).toBe(
      'Oi, como vai?\nSou a Giovanna da energia solar, vou fazer seu atendimento e trazer a melhor solução.');
  });
});

describe('toque de 5 minutos antes', () => {
  it('sai na janela e carimba o lembrete', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '10:15') })];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(1);
    expect(enviadas[0].bolhas).toEqual([BOLHA_CINCO_MIN]);
    expect(updates).toEqual([{ id: 1, campo: 'lembrete_5min_at' }]);
  });

  it('não repete quem já recebeu', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '10:15'), lembrete_5min_at: brt('2026-09-14', '10:10') })];
    agoraBRT('10:11');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(0);
  });

  it('não sai muito antes da hora', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '10:15') })];
    agoraBRT('09:30');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(0);
  });
});

// Ordem do Thiago (11/09): o toque de 5 min vai APENAS pra quem não respondeu o
// das 7h. Quem respondeu está em conversa e a dona já foi avisada — o "Oi, como
// vai?" ali seria o robô falando por cima de gente, com a mesma frase que a
// pessoa acabou de responder.
describe('quem respondeu o bom dia não leva o toque de 5 min', () => {
  const comBomDia = (over: any = {}) => ficha({
    quando: brt('2026-09-14', '10:15'), bomdia_at: brt('2026-09-14', '07:02'), ...over,
  });

  it('respondeu depois do bom dia: fica de fora', async () => {
    fichas = [comBomDia()];
    inbox = [{ telefone: '5534998112208', momment: brt('2026-09-14', '07:20') }];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(0);
    expect(r.ja_responderam).toBe(1);
    expect(enviadas).toHaveLength(0);
    // Não carimba: ele simplesmente não recebe este toque, hoje nem depois.
    expect(updates).toHaveLength(0);
  });

  it('ficou calado: recebe normalmente', async () => {
    fichas = [comBomDia()];
    inbox = [];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(1);
    expect(r.ja_responderam).toBe(0);
    expect(enviadas[0].bolhas).toEqual([BOLHA_CINCO_MIN]);
  });

  it('conversa ANTERIOR ao bom dia não conta como resposta', async () => {
    fichas = [comBomDia()];
    inbox = [{ telefone: '5534998112208', momment: brt('2026-09-13', '15:00') }];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(1);
  });

  it('casa o telefone pelo fim do número, não byte a byte', async () => {
    fichas = [comBomDia({ cliente_telefone: '(34) 99811-2208' })];
    inbox = [{ telefone: '553499811 2208', momment: brt('2026-09-14', '07:20') }];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.ja_responderam).toBe(1);
  });

  it('quem nunca recebeu o bom dia continua recebendo o de 5 min', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '10:15'), bomdia_at: null })];
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(1);
  });

  it('inbox ilegível cala o toque em vez de arriscar falar por cima', async () => {
    fichas = [comBomDia()];
    inboxQuebrado = true;
    agoraBRT('10:10');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.cinco_min).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('fora da janela dos 5 min nem encosta no inbox', async () => {
    fichas = [comBomDia()];
    inboxQuebrado = true;   // se lesse, o tick ficaria cego e o bom dia sumiria junto
    agoraBRT('07:30');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(0);   // já tem bomdia_at
    expect(r.erros).toBe(0);
  });
});

describe('de quem este robô NÃO fala', () => {
  it('ficha de eletroposto não recebe copy de energia solar', async () => {
    fichas = [ficha({ created_by: 'lp_eletroposto' }), ficha({ id: 2, vendedor_nome: 'Nilce', created_by: 'lp_eletroposto' })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.candidatos).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('card MUDO do quiz (saiu sem marcar, 27/10/2026): sem bom dia e sem "oi" de 5 min, mesmo com os carimbos zerados; o card que FALA segue a régua', async () => {
    const mudo = 'LP SOLAR QUIZ · SAIU SEM MARCAR · MUDO · LIGAÇÃO\nOnde: Casa';
    const fala = 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO';
    fichas = [ficha({ id: 1, created_by: 'lp_solar', vendedor_nome: 'Nilce', observacao: mudo, quando: brt('2026-09-14', '10:15') })];
    agoraBRT('07:00');
    expect((await runSolarAgendaGiovannaTick()).candidatos).toBe(0);
    agoraBRT('10:10');
    expect((await runSolarAgendaGiovannaTick()).candidatos).toBe(0);
    expect(enviadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
    // O mesmo card com a 1ª linha normal (o cliente voltou e marcou) volta para a régua.
    fichas = [ficha({ id: 1, created_by: 'lp_solar', vendedor_nome: 'Nilce', observacao: fala, quando: brt('2026-09-14', '10:15') })];
    const r = await runSolarAgendaGiovannaTick();
    expect(r.candidatos).toBe(1);
  });

  it('carteira de quem não é dona não é assunto deste robô', async () => {
    fichas = [ficha({ vendedor_nome: 'Thiago' }), ficha({ id: 2, vendedor_nome: 'Diego' })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.candidatos).toBe(0);
  });

  it('quem teve desfecho não recebe "vou fazer seu atendimento"', async () => {
    fichas = [ficha({ status: 'nao_atendeu' }), ficha({ id: 2, status: 'sem_interesse' })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.candidatos).toBe(0);
  });

  it('reunião de outro dia não entra', async () => {
    fichas = [ficha({ quando: brt('2026-09-15', '10:15') })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.candidatos).toBe(0);
  });

  it('ficha sem telefone não quebra o tick', async () => {
    fichas = [ficha({ cliente_telefone: null })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.bom_dia).toBe(0);
    expect(r.erros).toBe(0);
  });
});

describe('travas', () => {
  it('kill-switch cala os dois toques', async () => {
    fichas = [ficha()];
    process.env.SOLAR_GIOVANNA_OFF = '1';
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.motivo).toBe('desligado');
    expect(enviadas).toHaveLength(0);
  });

  it('dry decide tudo e não toca em ninguém', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick({ dry: true });
    expect(r.previa).toHaveLength(1);
    expect(r.previa![0].toque).toBe('bom_dia');
    expect(enviadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(carimbos).toHaveLength(0);
  });

  it('dry funciona mesmo com o agente desligado — é como se revisa a copy', async () => {
    fichas = [ficha()];
    process.env.SOLAR_GIOVANNA_OFF = '1';
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick({ dry: true });
    expect(r.previa).toHaveLength(1);
  });
});

// 03/11/2026: o bom dia e o "oi" de 5 min ESPERAM 1 tick quando a resposta da Duda ao lead esta saindo (so espera: nada e gravado, nada e descartado).
describe('a resposta da Duda saindo segura o toque por 1 tick (respostaEmCurso)', () => {
  const ha = (seg: number): string => new Date(Date.now() - seg * 1000).toISOString();
  const msg = (id: number, from_me: boolean, momment: string) => ({ id, from_me, texto: 'x', tipo: 'text', momment });
  const reservado = (id: number, seg: number) => estadoSys.set(`ag5040_sent:${id}:1`, { value: { estado: 'reservado', em: ha(seg) }, updated_at: ha(seg) });
  const enviado = (id: number, seg: number) => estadoSys.set(`ag5040_sent:${id}:1`, { value: { estado: 'enviado' }, updated_at: ha(seg) });
  const nada = () => { expect(enviadas).toHaveLength(0); expect(updates).toEqual([]); expect(carimbos).toEqual([]); };

  it('bom dia: carimbo reservado ha 10 s: segurado, sem carimbo, sem bomdia_at, sem toque contado; no tick seguinte (a Duda ja falou) sai', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    conversa = { completa: true, msgs: [msg(10, false, ha(60))] };
    reservado(10, 10);
    const r = await runSolarAgendaGiovannaTick();
    expect(r).toMatchObject({ bom_dia: 0, cinco_min: 0, esperando_resposta: 1, segurados_pelo_teto: 0, ja_responderam: 0, erros: 0 });
    nada();
    expect(conversaLida).toHaveLength(1);
    // 07:03: a bolha da Duda ja esta na wa_mensagens ha 2 min 30 s, o carimbo virou `enviado`
    agoraBRT('07:03');
    conversa = { completa: true, msgs: [msg(10, false, ha(240)), msg(11, true, ha(150))] };
    enviado(10, 180);
    const r2 = await runSolarAgendaGiovannaTick();
    expect(r2).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
    expect(enviadas).toHaveLength(1);
    expect(updates).toEqual([{ id: 1, campo: 'bomdia_at' }]);
  });

  it('bom dia: fala nossa de 60 s atras segura; a de 3 min nao', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 0, esperando_resposta: 1 });
    nada();
    conversa = { completa: true, msgs: [msg(11, true, ha(180))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
  });

  it('bom dia: `enviado` ha 60 s sem fala nossa depois do lead segura; reservado velho (6 min), `falhou` ou lead de 11 min atras nao seguram', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    conversa = { completa: true, msgs: [msg(10, false, ha(90))] };
    enviado(10, 60);
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 0, esperando_resposta: 1 });
    nada();
    reservado(10, 6 * 60);
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
    fichas = [ficha({ bomdia_at: null })]; enviadas.length = 0; updates.length = 0; carimbos.length = 0;
    estadoSys.set('ag5040_sent:10:1', { value: { estado: 'falhou' }, updated_at: ha(60) });
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
    fichas = [ficha({ bomdia_at: null })]; enviadas.length = 0; updates.length = 0; carimbos.length = 0;
    conversa = { completa: true, msgs: [msg(10, false, ha(11 * 60))] };
    reservado(10, 10);
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
  });

  it('bom dia: com minutos 33 (o proximo tick ja nao serve) ou a menos de 4 min das 11h, sai mesmo com a resposta saindo', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '07:33') })];
    agoraBRT('07:00');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
    // minutos 34 ainda espera
    enviadas.length = 0; updates.length = 0; carimbos.length = 0;
    fichas = [ficha({ quando: brt('2026-09-14', '07:34') })];
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 0, esperando_resposta: 1 });
    nada();
    // 10h57 (3 min para as 11h): sai; 10h55 (5 min): espera
    fichas = [ficha({ quando: brt('2026-09-14', '14:00') })];
    agoraBRT('10:57');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
    enviadas.length = 0; updates.length = 0; carimbos.length = 0;
    fichas = [ficha({ quando: brt('2026-09-14', '14:00') })];
    agoraBRT('10:55');
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 0, esperando_resposta: 1 });
    nada();
  });

  it('"oi" de 5 min: com minutos 8 segura (sem lembrete_5min_at, sem carimbo, sem bloqueio); com minutos 3 sai', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '10:15'), bomdia_at: brt('2026-09-14', '07:02') })];
    agoraBRT('10:07');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ cinco_min: 0, esperando_resposta: 1, ja_responderam: 0, segurados_pelo_teto: 0 });
    nada();
    agoraBRT('10:12');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ cinco_min: 1, esperando_resposta: 0 });
    expect(updates).toEqual([{ id: 1, campo: 'lembrete_5min_at' }]);
  });

  it('"oi" de 5 min: o descarte de quem respondeu o bom dia continua como estava (ja_responderam), sem ler a conversa', async () => {
    fichas = [ficha({ quando: brt('2026-09-14', '10:15'), bomdia_at: brt('2026-09-14', '07:02') })];
    inbox = [{ telefone: '5534998112208', momment: brt('2026-09-14', '07:20') }];
    agoraBRT('10:07');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ cinco_min: 0, ja_responderam: 1, esperando_resposta: 0 });
    expect(conversaLida).toEqual([]);
  });

  it('leitura que falha (lanca, incompleta ou telefone sem chave): o toque sai como hoje', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    for (const modo of ['lanca', 'incompleta'] as const) {
      conversaFalha = modo; enviadas.length = 0; updates.length = 0;
      fichas = [ficha({ bomdia_at: null })];
      expect(await runSolarAgendaGiovannaTick(), modo).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
      expect(conversaLida.length).toBeGreaterThan(0);
    }
    // telefone que a chaveContato recusa: nem le a conversa, o toque sai
    conversaFalha = 'nao'; conversaLida.length = 0; enviadas.length = 0; updates.length = 0;
    fichas = [ficha({ cliente_telefone: '12345', bomdia_at: null })];
    expect(await runSolarAgendaGiovannaTick()).toMatchObject({ bom_dia: 1, esperando_resposta: 0 });
    expect(conversaLida).toEqual([]);
  });

  it('o dry tambem espera: a previa nao mostra o toque segurado e nada e gravado', async () => {
    fichas = [ficha()];
    agoraBRT('07:00');
    conversa = { completa: true, msgs: [msg(11, true, ha(60))] };
    const r = await runSolarAgendaGiovannaTick({ dry: true });
    expect(r.previa).toEqual([]);
    expect(r.esperando_resposta).toBe(1);
    nada();
    conversa = { completa: true, msgs: [] };
    expect((await runSolarAgendaGiovannaTick({ dry: true })).previa).toHaveLength(1);
  });
});
