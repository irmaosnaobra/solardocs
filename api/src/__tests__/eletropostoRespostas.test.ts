import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Recado pra equipe quando o lead responde a automação da agenda. Os riscos:
// avisar duas vezes o mesmo recado, avisar conversa que o humano já estava tendo,
// e não avisar nada porque o telefone do inbound vem sem o 9º dígito.

const state = new Map<string, { key: string; value: any; updated_at: string }>();
let fichas: any[] = [];
let inbound: any[] = [];
const avisos: Array<{ phone: string; texto: string }> = [];
const presencas: Array<{ id: number; valor: string | null }> = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        select() { return q; },
        eq(col: string, v: any) { q._filtros[col] = v; return q; },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        lte(col: string, v: any) { q._filtros[`lte_${col}`] = v; return q; },
        like() { return q; },
        order() { return q; },
        upsert(p: any) { for (const r of (Array.isArray(p) ? p : [p])) state.set(r.key, r); return Promise.resolve({ error: null }); },
        limit() {
          if (tabela === 'system_state') return Promise.resolve({ data: [...state.values()], error: null });
          const de = q._filtros['gte_momment'], ate = q._filtros['lte_momment'];
          return Promise.resolve({
            data: inbound.filter(m => (!de || m.momment >= de) && (!ate || m.momment <= ate)), error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _update: null as any,
        select() { return q; }, in() { return q; }, gte() { return q; }, or() { return q; },
        update(patch: any) { q._update = patch; return q; },
        eq(_c: string, v: any) {
          if (q._update) { presencas.push({ id: v, valor: q._update.presenca_confirmada_at }); return Promise.resolve({ error: null }); }
          return q;
        },
        limit() { return Promise.resolve({ data: fichas, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (phone: string, texto: string) => { avisos.push({ phone, texto }); }),
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223', diego: '34991360172' } }));

const AGORA = new Date('2026-08-04T16:00:00.000Z');
const TOQUE = '2026-08-04T15:00:00.000Z';
const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString();

function ficha(over: Partial<any> = {}) {
  return {
    id: 1, cliente_nome: 'Irineu de Almeida', cliente_telefone: '5569984488158',
    quando: '2026-08-05T16:30:00.000Z', vendedor_nome: 'Diego',
    created_by: 'lp_eletroposto',
    confirmacao_at: TOQUE, lembrete_1h_at: null, lembrete_5min_at: null, ...over,
  };
}
// A Z-API entrega o inbound SEM o 9º dígito: 12 dígitos contra os 13 da ficha.
function msg(over: Partial<any> = {}) {
  return { telefone: '556984488158', texto: 'Sim', tipo: 'texto', momment: antes(5), ...over };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); avisos.length = 0; presencas.length = 0;
  fichas = [ficha()]; inbound = [msg()];
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function mod() { return import('../services/io/eletropostoRespostas'); }
async function tick(opts: any = {}) { return (await mod()).runEletropostoRespostasTick(opts); }

describe('quem vira recado', () => {
  it('telefone sem o 9º dígito casa com a ficha que tem', async () => {
    expect((await tick()).avisados).toBe(1);
    expect(avisos).toHaveLength(2);                       // Thiago e Diego
    expect(avisos[0].texto).toContain('Irineu de Almeida');
    expect(avisos[0].texto).toContain('Sim');
  });

  it('mensagem ANTERIOR ao toque da automação não vira aviso', async () => {
    inbound = [msg({ momment: '2026-08-04T14:00:00.000Z' })];   // antes do TOQUE
    expect((await tick()).avisados).toBe(0);
    expect(avisos).toHaveLength(0);
  });

  it('ficha que a automação nunca tocou fica de fora', async () => {
    fichas = [ficha({ confirmacao_at: null })];
    expect((await tick()).motivo).toBe('ninguem_tocado');
  });

  it('mensagem de quem não tem reunião é ignorada', async () => {
    inbound = [msg({ telefone: '5511999998888' })];
    expect((await tick()).motivo).toBe('ninguem_respondeu');
  });

  it('mensagem recém-chegada espera o próximo tick (não corta a frase no meio)', async () => {
    inbound = [msg({ momment: new Date(AGORA.getTime() - 5_000).toISOString() })];
    expect((await tick()).motivo).toBe('sem_inbound');
  });

  it('avisa uma vez: o marcador guarda até onde já foi', async () => {
    expect((await tick()).avisados).toBe(1);
    avisos.length = 0;
    expect((await tick()).motivo).toBe('ninguem_respondeu');
    expect(avisos).toHaveLength(0);
  });

  it('mensagem NOVA depois do aviso vira um aviso novo', async () => {
    await tick();
    avisos.length = 0;
    inbound.push(msg({ texto: 'mandei a foto do terreno', momment: antes(1) }));
    expect((await tick()).avisados).toBe(1);
    expect(avisos[0].texto).toContain('foto do terreno');
    expect(avisos[0].texto).not.toContain('• Sim');       // o que já foi avisado não repete
  });

  it('várias mensagens na mesma janela viram UM recado só', async () => {
    inbound = [msg({ texto: 'Sim' }), msg({ texto: 'tenho um posto na BR-354', momment: antes(4) })];
    expect((await tick()).avisados).toBe(1);
    expect(avisos).toHaveLength(2);                       // 2 destinatários, 1 recado
    expect(avisos[0].texto).toContain('BR-354');
  });
});

// "Confirmaram quando confirmar mesmo" (regra do dono, 04/08). O risco aqui é o
// painel encher de gente que não vai aparecer.
describe('o que conta como confirmar mesmo', () => {
  it('afirmativa inteira conta', async () => {
    const { confirmouMesmo } = await mod();
    for (const t of ['Sim', 'sim!', 'Ok', 'blz', 'combinado', '👍', 'Confirmado', 'Perfeito 👍', 'estarei']) {
      expect(confirmouMesmo([t]), t).toBe(true);
    }
  });

  it('verbo explícito conta mesmo no meio da frase', async () => {
    const { confirmouMesmo } = await mod();
    expect(confirmouMesmo(['Bom dia, confirmo a reunião de quarta'])).toBe(true);
    expect(confirmouMesmo(['pode deixar que eu vou estar lá'])).toBe(true);
  });

  it('afirmativa que vira pergunta NÃO conta', async () => {
    const { confirmouMesmo } = await mod();
    for (const t of ['ok, mas quanto vou gastar?', 'sim, e o financiamento?', 'certo. me manda o valor']) {
      expect(confirmouMesmo([t]), t).toBe(false);
    }
  });

  it('pedido de remarcar derruba a confirmação, mesmo começando com ok', async () => {
    const { confirmouMesmo, selo } = await mod();
    expect(confirmouMesmo(['ok', 'mas preciso remarcar'])).toBe(false);
    expect(selo(['ok, mas preciso remarcar']).titulo).toBe('PODE QUERER REMARCAR');
  });

  it('pergunta pura não é presença', async () => {
    const { confirmouMesmo } = await mod();
    expect(confirmouMesmo(['quanto vou gastar?'])).toBe(false);
    expect(confirmouMesmo(['tenho um terreno na BR-354'])).toBe(false);
  });
});

describe('o que o recado diz', () => {
  it('lê a intenção sem decidir por ela', async () => {
    const { selo } = await mod();
    expect(selo(['Sim']).titulo).toBe('CONFIRMOU PRESENÇA');
    expect(selo(['não vou conseguir, dá pra remarcar?']).titulo).toBe('PODE QUERER REMARCAR');
    expect(selo(['quanto vou gastar?']).titulo).toBe('RESPONDEU');
  });

  it('o recado leva reunião, consultor e link do WhatsApp', async () => {
    await tick();
    const t = avisos[0].texto;
    expect(t).toContain('quarta-feira, 05/08 às 13h30');
    expect(t).toContain('Diego');
    expect(t).toContain('wa.me/5569984488158');
  });

  it('áudio e foto aparecem contados — voz sobre o ponto não pode passar batido', async () => {
    inbound = [
      msg({ texto: '', tipo: 'audio' }),
      msg({ texto: '', tipo: 'imagem', momment: antes(4) }),
      msg({ texto: '', tipo: 'imagem', momment: antes(3) }),
    ];
    await tick();
    expect(avisos[0].texto).toContain('1 áudio');
    expect(avisos[0].texto).toContain('2 imagens');
    expect(avisos[0].texto).toContain('só mídia, sem texto');
  });
});

describe('presença na ficha', () => {
  it('quem confirma sobe o campo', async () => {
    await tick();
    expect(presencas).toEqual([{ id: 1, valor: expect.any(String) }]);
  });

  it('quem só pergunta não sobe nada', async () => {
    inbound = [msg({ texto: 'quanto vou gastar?' })];
    await tick();
    expect(presencas).toHaveLength(0);
  });

  it('quem confirmou e depois pediu remarcar CAI da conta', async () => {
    await tick();
    expect(presencas[0].valor).toEqual(expect.any(String));
    presencas.length = 0;
    inbound.push(msg({ texto: 'preciso remarcar, não vou conseguir', momment: antes(1) }));
    await tick();
    expect(presencas).toEqual([{ id: 1, valor: null }]);
  });
});

describe('travas', () => {
  it('kill-switch desliga', async () => {
    process.env.EP_RESPOSTAS_OFF = '1';
    vi.resetModules();
    expect((await tick()).motivo).toBe('desligado');
    expect(avisos).toHaveLength(0);
  });

  it('dry mostra o recado e não manda nem marca', async () => {
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('dry');
    expect(r.previa?.[0]).toMatchObject({ id: 1, mensagens: 1 });
    expect(avisos).toHaveLength(0);
    expect(state.size).toBe(0);
  });
});
