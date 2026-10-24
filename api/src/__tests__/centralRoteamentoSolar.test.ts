import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A auditoria de roteamento na Central. Ela existe porque a regra do corte ficou
// 2 dias parada no disco sem ninguém perceber, 6 leads no consultor errado e 4
// manhãs de dono gastas com conta pequena. Regra que ninguém confere é regra que
// some no próximo deploy.
//
// A REGRA AUDITADA É A DE 23/09/2026: acima de 1.200 kWh/mês o lead é do time da
// conta alta (Thiago, Diego e a Nilce, que leva metade deles); abaixo do corte é
// do time da conta baixa (Nilce e a carteira antiga da Giovanna).
//
// As datas aqui embaixo NÃO são decoração: a auditoria só olha ficha criada
// depois do ROTEAMENTO_REGRA_INICIO, e esse piso anda junto com o corte. Mexeu
// no corte? Este arquivo tem que andar junto, senão ele passa a testar uma
// janela vazia e fica verde sem auditar nada.

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
  observacao: obs('- 500'), created_at: '2026-09-23T12:00:00.000Z', ...over,
});

beforeEach(() => { fichas = []; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T15:00:00.000Z')); });
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
    expect(c.alerta).toContain('#774 → Thiago');
    // A resposta da Central é pública e AGREGADA: o card aponta a ficha pelo número
    // e nunca devolve o nome do cliente.
    expect(JSON.stringify(c)).not.toContain('Gerson');
  });

  // A Nilce NÃO serve mais de exemplo aqui: desde 10/09 ela está no time da conta
  // alta e desde 23/09 leva metade dos leads grandes. Quem sobra fora do time é a
  // Giovanna, que só atende a carteira antiga e não recebe lead novo.
  it('conta grande fora do time também é acusada', async () => {
    fichas = [ficha({ id: 773, cliente_nome: 'Alceu', vendedor_nome: 'Giovanna', observacao: obs('1200 a 1600') })];
    expect(metrica(await card(), 'Fora da regra').valor).toBe(1);
  });

  // O contrário disso, e é a metade da regra nova: lead grande COM a Nilce está
  // certo. Antes de 23/09 esta mesma ficha seria acusada.
  it('lead grande com a Nilce está certo, ela leva metade deles', async () => {
    fichas = [ficha({ id: 775, vendedor_nome: 'Nilce', observacao: obs('1200 a 1600') })];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(0);
    expect(c.alerta).toBeUndefined();
  });

  // A faixa que mudou de lado no corte de 23/09: 800 kWh era dos sócios, virou
  // conta baixa. É o caso que um corte esquecido em 762 deixaria passar.
  it('lead de 800 kWh com um sócio é acusado: o corte agora é 1.200', async () => {
    fichas = [ficha({ id: 776, cliente_nome: 'Moacir', vendedor_nome: 'Diego', observacao: obs('700 a 900') })];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(1);
    expect(c.alerta).toContain('#776 → Diego');
    expect(JSON.stringify(c)).not.toContain('Moacir');
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
    fichas = [ficha({ vendedor_nome: 'Thiago', observacao: obs('- 500'), created_at: '2026-09-22T10:00:00.000Z' })];
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

  // A observação existe em DOIS formatos, e o de linha única quase custou uma
  // acusação errada: sem cortar no "·", o "30" de "30 dias" entrava na conta e
  // "700 a 900" virava 365 — lead grande, com o consultor certo, acusado de
  // conta pequena. Achado ao consultar o banco, não pelo teste.
  it('observação de linha única não deixa o resto do texto entrar na conta', async () => {
    // Lido certo: meio de 1.200 a 1.600 = 1.400 → conta alta.
    // Lido errado (sem cortar no "·"): o "30" de "30 dias" entra e o meio vira
    // (1200+30)/2 = 615 → conta baixa, e as duas acusações abaixo TROCAM de lado.
    const linhaUnica = 'Consumo: 1200 a 1600 · Telhado: Cimento · Padrão: Bi · Urgencia: 30 dias';
    fichas = [
      ficha({ id: 1, vendedor_nome: 'Diego', observacao: linhaUnica }),      // grande com o time: certo
      ficha({ id: 2, vendedor_nome: 'Giovanna', observacao: linhaUnica }),   // grande fora do time: errado
    ];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(1);
    expect(c.alerta).toContain('#2');
    expect(c.alerta).not.toContain('#1');   // quem seria acusado se o "·" vazasse
  });
});

// 24/10/2026: SÓ A NILCE ATENDE SOLAR. Ficha criada a partir de SOLAR_SO_NILCE_INICIO
// é julgada pela regra nova (dono diferente da Nilce é acusado, menos cliente que
// voltou). Ficha de 23/09 a 24/10 continua julgada pela regra antiga: os cards
// antigos do Thiago, do Diego e da Giovanna NÃO viram enxurrada de alertas.
describe('a regra de 24/10/2026: lead novo é só da Nilce', () => {
  const NOVA = '2026-10-24T12:00:00.000Z';

  it('lead novo com um sócio é acusado, seja a conta grande ou pequena', async () => {
    fichas = [
      ficha({ id: 901, vendedor_nome: 'Thiago', observacao: obs('1200 a 1600'), created_at: NOVA, cliente_telefone: '5534991110001' }),
      ficha({ id: 902, vendedor_nome: 'Diego', observacao: obs('- 500'), created_at: NOVA, cliente_telefone: '5534991110002' }),
      ficha({ id: 903, vendedor_nome: 'Giovanna', observacao: obs('700 a 900'), created_at: NOVA, cliente_telefone: '5534991110003' }),
    ];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(3);
    expect(c.alerta).toContain('#901 → Thiago');
  });

  it('lead novo com a Nilce, de qualquer tamanho, está certo', async () => {
    fichas = [
      ficha({ id: 1, vendedor_nome: 'Nilce', observacao: obs('+ 1200'), created_at: NOVA, cliente_telefone: '5534991110004' }),
      ficha({ id: 2, vendedor_nome: 'Nilce', observacao: obs('- 500'), created_at: NOVA, cliente_telefone: '5534991110005' }),
    ];
    expect(metrica(await card(), 'Fora da regra').valor).toBe(0);
  });

  it('cliente que voltou (o telefone já tinha ficha antes) fica com o dono e não é acusado', async () => {
    fichas = [
      ficha({ id: 10, vendedor_nome: 'Thiago', observacao: obs('+ 1200'), created_at: '2026-10-10T12:00:00.000Z', cliente_telefone: '5534991110006' }),
      ficha({ id: 11, vendedor_nome: 'Thiago', observacao: obs('+ 1200'), created_at: NOVA, cliente_telefone: '55 34 99111-0006' }),
    ];
    expect(metrica(await card(), 'Fora da regra').valor).toBe(0);
  });

  it('ficha de 23/09 a 24/10 segue a regra antiga: sócio com conta grande não é acusado, sem enxurrada', async () => {
    fichas = [
      ficha({ id: 20, vendedor_nome: 'Thiago', observacao: obs('+ 1200'), created_at: '2026-10-20T12:00:00.000Z', cliente_telefone: '5534991110007' }),
      ficha({ id: 21, vendedor_nome: 'Diego', observacao: obs('1200 a 1600'), created_at: '2026-10-23T23:00:00.000Z', cliente_telefone: '5534991110008' }),
    ];
    const c = await card();
    expect(metrica(c, 'Fora da regra').valor).toBe(0);
    expect(c.alerta).toBeUndefined();
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
