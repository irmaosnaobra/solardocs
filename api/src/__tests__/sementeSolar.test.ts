import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SEMENTE — nutrição de quem não fechou. O risco desta campanha não é errar a
// copy: é falar com quem não devia (quem já disse pra parar, quem tem reunião
// marcada, quem já fechou) ou falar demais. Os testes trancam exatamente isso.

const state = new Map<string, { key: string; value: any; updated_at: string }>();
let fichas: any[] = [];
let suprimidos: string[] = [];
let tetoOk = true;
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _like: null as string | null, _key: null as string | null,
        select() { return q; },
        like(_c: string, p: string) { q._like = p.replace(/%$/, ''); return q; },
        gte() { return q; },
        eq(_c: string, v: string) { q._key = v; return q; },
        limit() {
          const linhas = [...state.values()].filter(r => !q._like || r.key.startsWith(q._like));
          return Promise.resolve({ data: linhas, error: null });
        },
        maybeSingle() { return Promise.resolve({ data: q._key ? state.get(q._key) ?? null : null, error: null }); },
        upsert(p: any) { for (const r of (Array.isArray(p) ? p : [p])) state.set(r.key, r); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        select() { return q; }, gte() { return q; }, order() { return q; },
        limit() { return Promise.resolve({ data: fichas, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoOk),
}));
vi.mock('../services/io/ioSend', () => ({
  carregarSupressao: vi.fn(async () => (tel: string) => suprimidos.some(s => tel.includes(s))),
  // Portão de disparo proativo: no runtime junta o opt-out com quem nunca
  // respondeu e já levou toque demais. No teste, a mesma lista, porque o que
  // se verifica aqui é que o chamador RESPEITA o portão.
  carregarBloqueioProativo: vi.fn(async () => (tel: string) => suprimidos.some(s => tel.includes(s))),
}));

const DENTRO = new Date('2026-08-05T15:00:00.000Z');   // 12h BRT
const FORA = new Date('2026-08-05T23:30:00.000Z');     // 20h30 BRT
const HA_60_DIAS = '2026-06-06T12:00:00.000Z';
const ONTEM = '2026-08-04T12:00:00.000Z';

function ficha(over: Partial<any> = {}) {
  return {
    cliente_nome: 'Maria Silva', cliente_telefone: '5534991110001',
    status: 'fez_orcamento', quando: null, created_at: HA_60_DIAS, ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); enviadas.length = 0; suprimidos = []; tetoOk = true;
  fichas = [ficha()];
  process.env.SEMENTE_ON = 'true';
  vi.useFakeTimers(); vi.setSystemTime(DENTRO);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

async function mod() { return import('../services/io/sementeSolarService'); }
async function tick() { return (await mod()).runSementeTick(); }
async function publico() { return (await mod()).publicoSemente(); }

describe('semente — quem entra', () => {
  it('quem pediu orçamento e não fechou entra', async () => {
    expect((await publico()).map(p => p.status)).toEqual(['fez_orcamento']);
  });

  it('quem já fechou, está em atendimento ou tem reunião marcada NÃO entra', async () => {
    fichas = [
      ficha({ cliente_telefone: '5534991110002', status: 'fechou' }),
      ficha({ cliente_telefone: '5534991110003', status: 'em_atendimento' }),
      ficha({ cliente_telefone: '5534991110004', status: 'falando_whatsapp' }),
      ficha({ cliente_telefone: '5534991110005', status: 'fez_orcamento', quando: '2026-09-01T12:00:00.000Z' }),
    ];
    expect(await publico()).toHaveLength(0);
  });

  // A lista daqui é de EXCLUSÃO: origem nova de agendamento entra na semente por
  // padrão. Quem foi PROSPECTADO (lista fria trabalhada no /gerador/prospeccao) é
  // empresa e nunca pediu contato — ouvir "a gente conversou sobre energia solar"
  // é o mesmo erro do lead #584, que respondeu "não solicitei nenhum serviço".
  it('lead de eletroposto e de prospecção ativa nunca entram na semente', async () => {
    fichas = [
      ficha({ cliente_telefone: '5534991110011', created_by: 'lp_eletroposto' }),
      ficha({ cliente_telefone: '5534991110012', created_by: 'manychat_eletroposto' }),
      ficha({ cliente_telefone: '5534991110013', created_by: 'prosp_eletroposto' }),
      ficha({ cliente_telefone: '5534991110014', created_by: 'prosp_solar' }),
    ];
    expect(await publico()).toHaveLength(0);
  });

  it('"sem interesse" fica fora por padrão e só entra se o dono ligar', async () => {
    fichas = [ficha({ status: 'sem_interesse' })];
    expect(await publico()).toHaveLength(0);

    process.env.SEMENTE_STATUS = 'sem_interesse';
    vi.resetModules();
    expect(await publico()).toHaveLength(1);
  });

  it('quem pediu PARAR (supressão) nunca recebe', async () => {
    suprimidos = ['991110001'];
    expect(await publico()).toHaveLength(0);
  });

  it('ficha nova demais (menos de 30 dias) espera', async () => {
    fichas = [ficha({ created_at: ONTEM })];
    expect(await publico()).toHaveLength(0);
  });

  it('vale a ficha MAIS RECENTE: quem voltou a agendar sai do público', async () => {
    fichas = [
      ficha({ status: 'agendado', created_at: ONTEM }),                    // a mais nova
      ficha({ status: 'fez_orcamento', created_at: HA_60_DIAS }),
    ];
    expect(await publico()).toHaveLength(0);
  });
});

describe('semente — quanto fala', () => {
  it('para no 4º toque e nunca mais procura', async () => {
    state.set('semente:3491110001', {
      key: 'semente:3491110001', value: { n: 4, ultimo: HA_60_DIAS }, updated_at: HA_60_DIAS,
    });
    expect(await publico()).toHaveLength(0);
  });

  it('respeita os 30 dias entre um toque e outro', async () => {
    state.set('semente:3491110001', {
      key: 'semente:3491110001', value: { n: 1, ultimo: ONTEM }, updated_at: ONTEM,
    });
    expect(await publico()).toHaveLength(0);
  });

  it('não envia fora da janela de horário', async () => {
    vi.setSystemTime(FORA);
    expect((await tick()).motivo).toBe('fora_da_janela');
    expect(enviadas).toHaveLength(0);
  });

  it('respeita o teto da linha', async () => {
    tetoOk = false;
    expect((await tick()).motivo).toBe('teto_linha');
  });

  it('desligada por padrão (SEMENTE_ON)', async () => {
    delete process.env.SEMENTE_ON;
    vi.resetModules();
    const r = await tick();
    expect(r.motivo).toContain('desligada');
    expect(enviadas).toHaveLength(0);
  });
});

describe('semente — o que fala', () => {
  it('envia o toque 1 e marca a pessoa', async () => {
    const r = await tick();
    expect(r.enviados).toBe(1);
    expect(state.get('semente:3491110001')?.value.n).toBe(1);
  });

  it('toda mensagem leva o Instagram e a saída PARAR', async () => {
    const { bolhasSemente } = await mod();
    for (const t of [1, 2, 3, 4]) {
      const texto = bolhasSemente(t, 'Maria').join(' ');
      expect(texto).toContain('@irmaosnaobra__');
      expect(texto).toContain('PARAR');
    }
  });

  it('cada toque tem um ângulo diferente — nada de repetir a mesma frase', async () => {
    const { bolhasSemente } = await mod();
    const aberturas = [1, 2, 3, 4].map(t => bolhasSemente(t, 'Maria')[1]);
    expect(new Set(aberturas).size).toBe(4);
  });
});
