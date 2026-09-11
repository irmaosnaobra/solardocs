import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Os dois toques do dia da Giovanna. Os riscos aqui são concretos e cada um já
// custou caro em outro agente desta mesma linha: falar com quem não é dela, falar
// com ficha de eletroposto (o lead #584 respondeu "não solicitei nenhum serviço de
// energia solar"), repetir o toque, mandar duas bolhas numa leva de 15 pessoas
// (foi 37 mensagens numa hora que bloquearam a linha em 04/08) e furar o teto.

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
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          const dona = q._filtros['vendedor_nome'];
          const status = q._filtros['status'];
          const piso = q._filtros['gte_quando'];
          return Promise.resolve({
            data: fichas.filter(f =>
              f.vendedor_nome === dona && f.status === status && String(f.quando) >= piso),
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
      return { upsert: async (r: any) => { carimbos.push(String(r.key)); return { error: null }; } };
    },
  },
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
// das 7h. Quem respondeu está em conversa e a Giovanna já foi avisada — o "Oi,
// como vai?" ali seria o robô falando por cima de gente, com a mesma frase que a
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
    fichas = [ficha({ created_by: 'lp_eletroposto' })];
    agoraBRT('07:00');
    const r = await runSolarAgendaGiovannaTick();
    expect(r.candidatos).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('carteira de outro consultor não é assunto deste robô', async () => {
    fichas = [ficha({ vendedor_nome: 'Nilce' }), ficha({ id: 2, vendedor_nome: 'Thiago' })];
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
