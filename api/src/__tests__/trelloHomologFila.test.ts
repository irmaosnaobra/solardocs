import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Homologação lida do Trello na fila das 08:00 (20/11/2026): só as obras com a etapa 3 aberta são sincronizadas com o cartão ANTES da fila, com a
// informação de a fila do Thiago ou a do Diego do dia já ter saído (decide o autor da conclusão: `leitura` enquanto não saiu, `trello` se saiu).
// A sincronia em si é provada em trelloHomologObra.test.ts; aqui o gatilho. Banco, Trello e envio SIMULADOS; nada sai de verdade.

const h = vi.hoisted(() => ({
  chamadas: [] as Array<{ card: number; fila: boolean }>,
  travadas: new Set<string>() as Set<string> | null,
  leiturasDeTravas: 0,
  novos: new Map<number, any>(),
  homologFalha: false,
  pendurar: false,
  iniciadas: [] as number[],
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../routes/geradorJornadaHomolog', () => ({
  homologarDaFila: vi.fn(async (card: number, _js: unknown, _jo: unknown, fila: boolean) => {
    h.iniciadas.push(card);
    if (h.pendurar) return new Promise<void>(() => undefined);   // a homologação que não termina
    if (h.homologFalha) throw new Error('quebrou');
    h.chamadas.push({ card, fila });
  }),
}));
vi.mock('../services/io/jornadaMensagensBase', async (orig) => ({
  ...(await orig<typeof import('../services/io/jornadaMensagensBase')>()),
  jaTravadas: vi.fn(async () => { h.leiturasDeTravas++; return h.travadas; }),
}));
vi.mock('../services/gerador/jornadaSolarBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/jornadaSolarBanco')>()),
  lerJornadaComVersao: vi.fn(async (card: number) => ({ estado: h.novos.get(card) ?? null, versao: 'v' })),
}));

import { sincronizarPortoesDaFila } from '../services/io/jornadaPortoesFila';
import { chaveFila, type ObraFila } from '../services/io/jornadaMensagensPuro';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';
import { diaBRT } from '../services/agentes5040/relogio';

const AG = new Date('2026-11-20T11:00:30.000Z');   // 08:00 em Brasília
const EM = '2026-11-19T12:00:00.000Z';
const obra = (card: number, etapa: number, o: Partial<ObraFila> = {}): ObraFila => ({
  card, codigo: `#00${card}`, cliente: `Cliente ${card}`, cidade: 'Uberlândia-MG', vendedor: 'nilce',
  js: { ...estadoMaterializado(card, 'nilce', etapa, EM), origem: 'vendido' as const }, jo: null, cancelada: false, ...o,
});

// O código sob teste importa o módulo da homologação com `import()` (ciclo de módulos): carregar a versão simulada uma vez antes evita corrida de dois `import()` juntos.
beforeAll(async () => { await import('../routes/geradorJornadaHomolog'); });

beforeEach(() => {
  h.chamadas = []; h.travadas = new Set(); h.leiturasDeTravas = 0; h.novos = new Map(); h.homologFalha = false; h.pendurar = false; h.iniciadas = [];
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
});

describe('o gatilho da fila das 08:00', () => {
  it('só as obras com a etapa 3 aberta são sincronizadas com o Trello; as outras nem acionam o gatilho', async () => {
    await sincronizarPortoesDaFila([obra(1, 3), obra(2, 4), obra(3, 2), obra(4, 3, { jo: { fechada: true } as any }), obra(5, 3, { js: { ...obra(5, 3).js!, cancelada: { em: EM, por: 'x', etapa: 3, com_numero: true } } })], AG);
    expect(h.chamadas.map((c) => c.card)).toEqual([1]);
  });
  it('sem nenhuma obra na etapa 3, nem lê as travas da fila', async () => {
    await sincronizarPortoesDaFila([obra(2, 4), obra(3, 2)], AG);
    expect(h.chamadas).toEqual([]);
    expect(h.leiturasDeTravas).toBe(0);
  });
  it('a fila do Thiago e a do Diego ainda por sair: filaDosDonosSaiu = false (a conclusão leva `leitura`)', async () => {
    h.travadas = new Set([chaveFila(diaBRT(AG), 'giovanna')]);   // a da Giovanna saiu; não é dono da etapa 4
    await sincronizarPortoesDaFila([obra(1, 3)], AG);
    expect(h.chamadas).toEqual([{ card: 1, fila: false }]);
    expect(h.leiturasDeTravas).toBe(1);   // uma leitura só, para todas as obras
  });
  it('a fila do Thiago OU a do Diego já saiu: filaDosDonosSaiu = true (a conclusão leva `trello`)', async () => {
    for (const quem of ['thiago', 'diego']) {
      h.chamadas = [];
      h.travadas = new Set([chaveFila(diaBRT(AG), quem)]);
      await sincronizarPortoesDaFila([obra(1, 3), obra(7, 3)], AG);
      expect(h.chamadas).toEqual([{ card: 1, fila: true }, { card: 7, fila: true }]);
    }
  });
  it('a fila de OUTRO dia não conta; leitura das travas que falha vale "não saiu" (o lado silencioso)', async () => {
    h.travadas = new Set([chaveFila('2026-11-19', 'thiago')]);
    await sincronizarPortoesDaFila([obra(1, 3)], AG);
    h.travadas = null;
    await sincronizarPortoesDaFila([obra(2, 3)], AG);
    expect(h.chamadas).toEqual([{ card: 1, fila: false }, { card: 2, fila: false }]);
  });
  it('depois da sincronia a obra volta com o estado RELIDO (concluída pelo Trello, a fila já a vê na etapa 4)', async () => {
    h.novos.set(1, { ...estadoMaterializado(1, 'nilce', 4, EM), origem: 'vendido' as const });
    const [a, b] = await sincronizarPortoesDaFila([obra(1, 3), obra(2, 3)], AG);
    expect(a.js!.etapas[3].concluida_em).not.toBeNull();   // relido: a 3 concluiu
    expect(b.js!.etapas[3].concluida_em).toBeNull();       // sem estado novo: segue como estava
  });
  it('erro no gatilho (ou na releitura) nunca derruba a fila: a obra segue como estava', async () => {
    h.homologFalha = true;
    const o = obra(1, 3);
    const [r] = await sincronizarPortoesDaFila([o], AG);
    expect(r).toEqual(o);
  });
  it('ORÇAMENTO de tempo: homologação que não termina não segura a fila; estourado o teto, as obras seguintes passam sem ela', async () => {
    h.pendurar = true;
    const obras = [1, 2, 3, 4, 5].map((n) => obra(n, 3));
    const t0 = Date.now();
    const r = await sincronizarPortoesDaFila(obras, AG, 60);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r).toHaveLength(5);
    expect(h.iniciadas).toEqual([1, 2, 3, 4]);   // o 1º lote gastou o orçamento; a 5ª nem começou
  });
});
