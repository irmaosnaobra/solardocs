import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Agente de agendamento do eletroposto. Os riscos aqui são: mandar duas vezes o
// mesmo aviso, mandar pra quem teve a reunião CANCELADA (os 14 da reclassificação
// de 01/08) e prometer um link que quem manda é gente.

let fichas: any[] = [];
let consultores: any[] = [];
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const updates: Array<{ id: number; campo: string }> = [];

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        _update: null as any,
        select() { return q; },
        in(col: string, vals: any[]) { q._filtros[col] = vals; return q; },
        eq(col: string, v: any) {
          if (q._update) { updates.push({ id: v, campo: Object.keys(q._update)[0] }); return Promise.resolve({ error: null }); }
          q._filtros[col] = v; return q;
        },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        lte(col: string, v: any) { q._filtros[`lte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          if (tabela === 'consultores') return Promise.resolve({ data: consultores, error: null });
          const origens: string[] = q._filtros['created_by'] ?? [];
          const status = q._filtros['status'];
          const piso = new Date(q._filtros['gte_quando']).getTime();
          const teto = new Date(q._filtros['lte_quando']).getTime();
          return Promise.resolve({
            data: fichas.filter(f =>
              origens.includes(f.created_by) && f.status === status &&
              new Date(f.quando).getTime() >= piso && new Date(f.quando).getTime() <= teto),
            error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));

// 04/08/2026 (terça), 13h BRT = 16h UTC. Dentro da janela de 08–20h BRT.
const AGORA = new Date('2026-08-04T16:00:00.000Z');
const emMinutos = (m: number) => new Date(AGORA.getTime() + m * 60_000).toISOString();

function ficha(over: Partial<any> = {}) {
  return {
    id: 1, vendedor_nome: 'Diego', cliente_nome: 'Irineu de Almeida', cliente_telefone: '5577991110001',
    quando: emMinutos(60), created_by: 'lp_eletroposto', status: 'agendado',
    created_at: '2026-07-31T12:00:00.000Z',
    confirmacao_at: null, lembrete_1h_at: null, lembrete_5min_at: null, ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  enviadas.length = 0; updates.length = 0;
  fichas = [ficha()];
  consultores = [{ nome: 'Diego', whatsapp: '5534991360172' }, { nome: 'Thiago', whatsapp: '5534991360223' }];
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function mod() { return import('../services/io/eletropostoAgenda'); }
async function tick(opts: any = {}) { return (await mod()).runEletropostoAgendaTick(opts); }

describe('quem recebe, e quando', () => {
  it('reunião daqui a 1h recebe o aviso de 1h', async () => {
    const r = await tick();
    expect(r.lembretes_1h).toBe(1);
    expect(updates).toEqual([{ id: 1, campo: 'lembrete_1h_at' }]);
    expect(enviadas[0].bolhas.join(' ')).toContain('1 hora');
  });

  it('reunião daqui a 5 min recebe o chamado final', async () => {
    fichas = [ficha({ quando: emMinutos(5), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    const r = await tick();
    expect(r.lembretes_5min).toBe(1);
    expect(enviadas[0].bolhas.join(' ')).toContain('te esperando');
  });

  it('80 minutos antes ainda não é hora do aviso de 1h', async () => {
    fichas = [ficha({ quando: emMinutos(80) })];
    expect(await tick()).toMatchObject({ lembretes_1h: 0, confirmacoes: 0 });
    expect(enviadas).toHaveLength(0);
  });

  it('20 minutos antes ainda não é o chamado de 5 min', async () => {
    fichas = [ficha({ quando: emMinutos(20), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect(await tick()).toMatchObject({ lembretes_5min: 0 });
    expect(enviadas).toHaveLength(0);
  });

  it('cada aviso sai UMA vez — com a flag gravada, o tick seguinte não repete', async () => {
    fichas = [ficha({ lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect(await tick()).toMatchObject({ lembretes_1h: 0, lembretes_5min: 0 });
    expect(enviadas).toHaveLength(0);
  });

  it('reunião cancelada não recebe nada (os 14 da reclassificação)', async () => {
    fichas = [ficha({ status: 'cancelado' })];
    expect((await tick()).motivo).toBe('nenhuma_reuniao');
    expect(enviadas).toHaveLength(0);
  });

  it('ficha de solar não entra — a copy aqui é de eletroposto', async () => {
    fichas = [ficha({ created_by: 'lead-meta' })];
    expect((await tick()).motivo).toBe('nenhuma_reuniao');
  });

  it('ficha sem telefone é pulada sem quebrar o tick', async () => {
    fichas = [ficha({ cliente_telefone: null })];
    expect(await tick()).toMatchObject({ erros: 0, lembretes_1h: 0 });
  });
});

describe('confirmação ao marcar', () => {
  it('quem acabou de marcar confirma na hora', async () => {
    fichas = [ficha({ quando: emMinutos(3 * 24 * 60), created_at: new Date(AGORA.getTime() - 60_000).toISOString() })];
    const r = await tick();
    expect(r.confirmacoes).toBe(1);
    expect(updates).toEqual([{ id: 1, campo: 'confirmacao_at' }]);
  });

  it('backlog antigo entra em fila lenta: 1 por rodada', async () => {
    fichas = [1, 2, 3].map(id => ficha({ id, quando: emMinutos(3 * 24 * 60), cliente_telefone: `553499111000${id}` }));
    expect((await tick()).confirmacoes).toBe(1);
  });

  it('backlog não é confirmado de madrugada', async () => {
    vi.setSystemTime(new Date('2026-08-04T06:00:00.000Z'));  // 3h BRT
    fichas = [ficha({ quando: '2026-08-07T16:00:00.000Z' })];
    expect((await tick()).confirmacoes).toBe(0);
  });

  it('backlog com reunião em cima da hora não recebe confirmação atrasada', async () => {
    fichas = [ficha({ quando: emMinutos(90), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect((await tick()).confirmacoes).toBe(0);
  });

  it('já confirmado não confirma de novo', async () => {
    fichas = [ficha({ quando: emMinutos(3 * 24 * 60), confirmacao_at: '2026-08-01T12:00:00.000Z' })];
    expect((await tick()).confirmacoes).toBe(0);
  });
});

describe('o que ele fala', () => {
  it('a confirmação leva dia, hora, consultor e o pedido de SIM', async () => {
    const { bolhasConfirmacao } = await mod();
    const txt = bolhasConfirmacao('Irineu de Almeida', '2026-08-05T18:30:00.000Z', 'Diego').join(' ');
    expect(txt).toContain('Irineu');
    expect(txt).toContain('Diego');
    expect(txt).toContain('quarta-feira, 05/08 às 15h30');
    expect(txt).toContain('SIM');
    expect(txt).toContain('remarco');
  });

  it('nenhum toque afirma que o link JÁ foi enviado — quem manda é gente', async () => {
    const { bolhasConfirmacao, bolhas1h, bolhas5min } = await mod();
    for (const bolhas of [
      bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego'),
      bolhas1h('Irineu', '2026-08-05T18:30:00.000Z', 'Diego'),
      bolhas5min('Irineu', '2026-08-05T18:30:00.000Z', 'Diego'),
    ]) {
      const txt = bolhas.join(' ');
      expect(txt).toContain('link');
      expect(txt).not.toMatch(/link já (está|foi)|te mandei o link|link enviado/i);
    }
  });

  // O pedido de SIM é a única alavanca real contra o no-show. Ele é a 5ª de 6
  // partes da confirmação, e o sendHuman re-fatia tudo com teto de 5 bolhas — se
  // um dia esse reagrupamento passar a cortar, é ESTA linha que se perde primeiro.
  it('o pedido de SIM sobrevive ao fatiamento em bolhas do envio', async () => {
    const { emBolhas } = await import('../services/agents/bolhas');
    const { bolhasConfirmacao } = await mod();
    const saida = emBolhas(bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego', '5534991360172').join('||'));
    expect(saida.join(' ')).toContain('*SIM*');
    expect(saida.join(' ')).toContain('05/08 às 15h30');
    // Não basta sobreviver: tem que dar pra ler. Se o pedido de SIM for engolido
    // por um parágrafo de 400 caracteres, ninguém responde e a alavanca some.
    const bolhaDoSim = saida.find(b => b.includes('*SIM*'))!;
    expect(bolhaDoSim.length).toBeLessThan(260);
  });

  // Pedido do dono: a primeira reunião rende muito mais se o lead já mandar o
  // que tem. Sem isso o consultor gasta a hora perguntando onde é o ponto.
  it('a confirmação pede o material do eletroposto', async () => {
    const { bolhasConfirmacao } = await mod();
    const txt = bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego').join(' ');
    for (const pedaco of ['onde é', 'conta de luz', 'pesquisou', 'áudio']) {
      expect(txt).toContain(pedaco);
    }
  });

  it('sem nome utilizável, a mensagem não sai quebrada', async () => {
    const { bolhas5min } = await mod();
    expect(bolhas5min('lead', '2026-08-05T18:30:00.000Z', null)[0]).toMatch(/^É agora!/);
  });
});

// O lead precisa saber de qual número o consultor fala com ele — foi por não
// saber disso que a régua de solar virou "não solicitei nenhum serviço".
describe('telefone do consultor', () => {
  it('os três toques levam o WhatsApp do consultor, formatado', async () => {
    const { bolhasConfirmacao, bolhas1h, bolhas5min } = await mod();
    const q = '2026-08-05T18:30:00.000Z';
    for (const b of [
      bolhasConfirmacao('Irineu', q, 'Diego', '5534991360172'),
      bolhas1h('Irineu', q, 'Diego', '5534991360172'),
      bolhas5min('Irineu', q, 'Diego', '5534991360172'),
    ]) {
      expect(b.join(' ')).toContain('(34) 99136-0172');
    }
  });

  it('o número sai do cadastro `consultores`, casando pelo nome do vendedor', async () => {
    fichas = [ficha({ vendedor_nome: 'Thiago' })];
    await tick();
    expect(enviadas[0].bolhas.join(' ')).toContain('(34) 99136-0223');
  });

  it('consultor sem WhatsApp cadastrado: a frase some, não vira número quebrado', async () => {
    consultores = [{ nome: 'Diego', whatsapp: null }];
    await tick();
    const txt = enviadas[0].bolhas.join(' ');
    expect(txt).toContain('1 hora');
    expect(txt).not.toContain('()');
    expect(txt).not.toMatch(/WhatsApp dele é \*\*/);
  });

  it('número torto no cadastro não vira mensagem', async () => {
    const { telefoneBonito } = await mod();
    expect(telefoneBonito('5534991360172')).toBe('(34) 99136-0172');
    expect(telefoneBonito('3499136017')).toBe('(34) 9913-6017');
    expect(telefoneBonito('123')).toBe('');
    expect(telefoneBonito(null)).toBe('');
  });
});

describe('travas', () => {
  it('kill-switch desliga tudo', async () => {
    process.env.EP_LEMBRETES_OFF = '1';
    vi.resetModules();
    expect((await tick()).motivo).toBe('desligado');
    expect(enviadas).toHaveLength(0);
  });

  it('dry mostra o que sairia e não envia nem marca flag', async () => {
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('dry');
    expect(r.previa?.[0]).toMatchObject({ id: 1, toque: '1h' });
    expect(enviadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('teto de toques por rodada segura a rajada na linha', async () => {
    fichas = Array.from({ length: 10 }, (_, i) => ficha({
      id: i + 1, quando: emMinutos(60), cliente_telefone: `55349911100${String(i).padStart(2, '0')}`,
    }));
    expect((await tick()).lembretes_1h).toBe(6);
  });
});
