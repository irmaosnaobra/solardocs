import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O card volta pro WhatsApp do consultor quando o repasse de 12h troca o dono.
//
// O risco número um é ligar o módulo e mandar o card de TODA reunião viva de uma
// vez — por isso ficha vista pela primeira vez só é carimbada, nunca enviada. O
// número dois é o contrário: engolir o reenvio quando o envio falha, e deixar o
// lead parado com um dono que não sabe que é dono.

let fichas: any[] = [];
const state = new Map<string, { key: string; value: any; updated_at: string }>();
const enviadas: Array<{ phone: string; texto: string }> = [];
let consultores: any[] = [];
let envioFalha = false;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        select() { return q; },
        eq(col: string, v: any) { q._filtros[col] = v; return q; },
        gte() { return q; }, lte() { return q; },
        limit() {
          if (q._filtros['status']) {
            return Promise.resolve({ data: fichas.filter(f => f.status === q._filtros['status']), error: null });
          }
          return Promise.resolve({ data: consultores, error: null });
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
    }),
  },
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => {
    if (envioFalha) throw new Error('linha fora');
    enviadas.push({ phone, texto });
  }),
}));
vi.mock('../routes/ioEletroposto', () => ({
  EQUIPE: { thiago: '34991360223', diego: '34991360172' },
  montarMensagem: (a: any) => `*NOVA REUNIÃO — ELETROPOSTO*\ncliente ${a.cliente_nome}`,
}));

const AGORA = new Date('2026-08-20T18:00:00.000Z');

function ficha(over: Partial<any> = {}) {
  return {
    id: 5, vendedor_nome: 'Diego', cliente_nome: 'Irineu de Almeida', cliente_telefone: '5577991110001',
    quando: new Date(AGORA.getTime() + 26 * 3600_000).toISOString(), cidade: 'Uberlândia',
    temperatura: 'quente', observacao: 'LP ELETROPOSTO — investidor', created_at: '2026-08-18T12:00:00.000Z',
    created_by: 'lp_eletroposto', status: 'agendado', ...over,
  };
}
const jaVisto = (dono: string) =>
  state.set('ep_card_dono:5', { key: 'ep_card_dono:5', value: { dono, em: '2026-08-19T12:00:00.000Z' }, updated_at: '2026-08-19T12:00:00.000Z' });

const envOriginal = { ...process.env };
beforeEach(() => {
  fichas = [ficha()]; state.clear(); enviadas.length = 0; envioFalha = false;
  consultores = [{ nome: 'Diego', whatsapp: '5534991360172' }, { nome: 'Thiago', whatsapp: '5534991360223' }];
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function tick(opts: any = {}) {
  return (await import('../services/io/eletropostoCardPing')).runEletropostoCardPingTick(opts);
}

describe('a primeira vez não manda nada', () => {
  it('ficha nunca vista só é carimbada — ligar o módulo não vira enxurrada de card', async () => {
    const r = await tick();
    expect(r.reenviados).toBe(0);
    expect(r.novos).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(state.get('ep_card_dono:5')?.value).toMatchObject({ dono: 'Diego' });
  });

  it('e no tick seguinte, com o mesmo dono, continua calado', async () => {
    await tick();
    expect((await tick()).reenviados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });
});

describe('quando o dono muda', () => {
  it('o card inteiro chega no WhatsApp de quem está com ele agora', async () => {
    jaVisto('Thiago');
    const r = await tick();
    expect(r.reenviados).toBe(1);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].phone).toBe('5534991360172');            // Diego, o dono novo
    expect(enviadas[0].texto).toContain('SEM AÇÃO EM 12H');
    expect(enviadas[0].texto).toContain('Thiago');              // de quem veio
    expect(enviadas[0].texto).toContain('NOVA REUNIÃO');        // o card de sempre, inteiro
    expect(state.get('ep_card_dono:5')?.value).toMatchObject({ dono: 'Diego' });
  });

  it('só pro dono — o outro não recebe card que não é dele', async () => {
    jaVisto('Thiago');
    await tick();
    expect(enviadas.map(e => e.phone)).toEqual(['5534991360172']);
  });

  it('envio que falha NÃO carimba: o card tenta de novo no próximo tick', async () => {
    jaVisto('Thiago');
    envioFalha = true;
    const r = await tick();
    expect(r.erros).toBe(1);
    expect(state.get('ep_card_dono:5')?.value).toMatchObject({ dono: 'Thiago' });
  });

  it('consultor sem WhatsApp: não manda, mas carimba pra não tentar a cada 5 minutos pra sempre', async () => {
    jaVisto('Thiago');
    fichas = [ficha({ vendedor_nome: 'Fulano' })];
    const r = await tick();
    expect(r.erros).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(state.get('ep_card_dono:5')?.value).toMatchObject({ dono: 'Fulano' });
  });

  it('avisa quando o LEAD ainda não sabe do horário novo', async () => {
    // O repasse zera `confirmacao_at` e a re-confirmação sai pela fila lenta —
    // pode levar horas. O consultor não pode cobrar presença de quem não foi
    // avisado achando que os dois combinaram o horário.
    jaVisto('Thiago');
    fichas = [ficha({ confirmacao_at: null })];
    await tick();
    expect(enviadas[0].texto).toContain('O LEAD AINDA NÃO SABE');
  });

  it('e cala essa linha quando ele já foi avisado', async () => {
    jaVisto('Thiago');
    fichas = [ficha({ confirmacao_at: '2026-08-20T12:00:00.000Z' })];
    await tick();
    expect(enviadas[0].texto).not.toContain('O LEAD AINDA NÃO SABE');
  });

  it('cadastro do CRM manda no telefone; a lista fixa é só a rede', async () => {
    jaVisto('Thiago');
    consultores = [{ nome: 'Diego', whatsapp: '5534900000000' }];
    await tick();
    expect(enviadas[0].phone).toBe('5534900000000');
  });

  it('sem cadastro nenhum, a lista fixa da equipe salva o card', async () => {
    jaVisto('Thiago');
    consultores = [];
    await tick();
    expect(enviadas[0].phone).toBe('34991360172');
  });
});

describe('quem fica de fora', () => {
  it('ficha de solar não é assunto deste card', async () => {
    jaVisto('Thiago');
    fichas = [ficha({ created_by: 'lead-meta' })];
    expect((await tick()).reenviados).toBe(0);
  });

  it('kill-switch', async () => {
    jaVisto('Thiago');
    process.env.EP_CARD_PING_OFF = '1';
    expect((await tick()).motivo).toBe('desligado');
  });

  it('dry lista a troca sem mandar e sem carimbar', async () => {
    jaVisto('Thiago');
    const r = await tick({ dry: true });
    expect(r.reenviados).toBe(1);
    expect(r.previa?.[0]).toMatchObject({ id: 5, de: 'Thiago', para: 'Diego' });
    expect(enviadas).toHaveLength(0);
    expect(state.get('ep_card_dono:5')?.value).toMatchObject({ dono: 'Thiago' });
  });
});
