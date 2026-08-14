import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A auditoria de roteamento na Central. Ela existe porque a regra dos 700 kWh
// ficou 2 dias parada no disco sem ninguém perceber — 6 leads no consultor errado
// e 4 manhãs de dono gastas com conta pequena. Regra que ninguém confere é regra
// que some no próximo deploy.

let fichas: any[] = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select() { return q; }, or() { return q; }, eq() { return q; },
        like() { return q; }, order() { return q; }, gte() { return q; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _cols: '',
        select(cols?: string) { q._cols = String(cols || ''); return q; },
        in() { return q; }, eq() { return q; }, is() { return q; },
        not() { return q; }, gte() { return q; }, lt() { return q; }, order() { return q; },
        limit() {
          // Só a consulta da auditoria pede `observacao` junto de `status`.
          return Promise.resolve({
            data: q._cols.includes('observacao') && q._cols.includes('status') ? fichas : [],
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
  tetosVigentesLinha: vi.fn(async () => ({ hora: 6, dia: 40 })),
}));
vi.mock('../services/agents/whatsapp/carlaThrottle', () => ({ MAX_CARLA_POR_HORA: 4 }));
vi.mock('../services/agents/zapiClient', () => ({ solardocViaIo: () => false }));

const obs = (consumo: string) => `[Lead Instagram]\nConsumo: ${consumo}\nImóvel: Proprio`;
const ficha = (over: Partial<any> = {}) => ({
  id: 1, cliente_nome: 'Fulano', vendedor_nome: 'Nilce', status: 'agendado',
  // Depois de ROTEAMENTO_REGRA_INICIO: ficha anterior à regra não é auditada.
  observacao: obs('- 500'), created_at: '2026-08-14T18:00:00.000Z', ...over,
});

beforeEach(() => { fichas = []; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-14T15:00:00.000Z')); });
afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

async function card() {
  const { montarCentralAgentes } = await import('../services/io/centralAgentes');
  const payload = await montarCentralAgentes();
  return payload.agentes.find(a => a.id === 'roteamento_solar')!;
}
const metrica = (c: any, label: string) => c.metricas.find((m: any) => m.label.startsWith(label));

describe('quem está com o consultor errado', () => {
  it('conta pequena na mão do dono é acusada', async () => {
    fichas = [ficha({ id: 774, cliente_nome: 'Gerson', vendedor_nome: 'Thiago', observacao: obs('- 500') })];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(1);
    expect(c.alerta).toContain('#774 Gerson → Thiago');
  });

  it('conta grande fora do time também é acusada', async () => {
    fichas = [ficha({ id: 773, cliente_nome: 'Alceu', vendedor_nome: 'Nilce', observacao: obs('900 a 1200') })];
    expect(metrica(await card(), 'Fora da regra').valor).toBe(1);
  });

  it('ficha certa não acusa ninguém', async () => {
    fichas = [
      ficha({ id: 1, vendedor_nome: 'Nilce', observacao: obs('- 500') }),
      ficha({ id: 2, vendedor_nome: 'Diego', observacao: obs('+ 1200') }),
    ];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(0);
    expect(c.alerta).toBeUndefined();
  });

  // Ficha de ANTES da regra foi roteada pelo rodízio dos três e não violou nada.
  // Sem este corte a auditoria acusava 45 de 103 no primeiro minuto — gritaria por
  // um mês e depois apagaria porque as fichas velhas saíram da janela, não porque
  // o roteamento melhorou. Pego no ar, conferindo o card contra o banco.
  it('ficha anterior à entrada da regra não é auditada', async () => {
    fichas = [ficha({ vendedor_nome: 'Thiago', observacao: obs('- 500'), created_at: '2026-08-10T10:00:00.000Z' })];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(0);
    expect(c.alerta).toBeUndefined();
  });

  // Sem resposta de consumo a regra manda pra Nilce, mas não dá pra dizer que
  // quem está com outro consultor está errado — pode ter sido atribuição manual.
  it('ficha sem consumo respondido não acusa', async () => {
    fichas = [ficha({ vendedor_nome: 'Thiago', observacao: '[Lead Instagram]\nImóvel: Proprio' })];
    expect(metrica(await card(), 'Fora da regra').valor).toBe(0);
  });

  // O mesmo campo "Consumo" vem em kWh no formulário do Meta e em REAIS na DM.
  // Ler R$ 800 como 800 kWh acusaria a Nilce de estar com um lead grande.
  it('valor em reais é convertido antes de julgar', async () => {
    fichas = [ficha({ vendedor_nome: 'Nilce', observacao: obs('R$ 400 a R$ 800') })];
    expect(metrica(await card(), 'Fora da regra').valor).toBe(0);
  });
});

describe('a meta de conversão', () => {
  const lote = (n: number, vendas: number) =>
    Array.from({ length: n }, (_, i) =>
      ficha({ id: i + 1, status: i < vendas ? 'fechou' : 'agendado' }));

  it('acende abaixo de 3%', async () => {
    fichas = lote(100, 1);
    const c = await card();
    expect(metrica(c, 'Conversão').valor).toBe(1);
    expect(c.alerta).toContain('abaixo da meta de 3%');
  });

  it('fica quieta em cima da meta', async () => {
    fichas = lote(100, 4);
    const c = await card();
    expect(metrica(c, 'Conversão').valor).toBe(4);
    expect(c.alerta).toBeUndefined();
  });

  // 1 venda a menos em 10 leads derruba 10 pontos. Alerta que oscila assim
  // ninguém lê — e alerta que ninguém lê é o problema que esta tela resolve.
  it('não acende com amostra pequena demais pra sustentar o número', async () => {
    fichas = lote(10, 0);
    const c = await card();
    expect(metrica(c, 'Conversão').valor).toBe(0);
    expect(c.alerta).toBeUndefined();
  });

  it('sem lead nenhum a conversão é "—", não zero', async () => {
    fichas = [];
    expect(metrica(await card(), 'Conversão').valor).toBe(null);
  });
});
