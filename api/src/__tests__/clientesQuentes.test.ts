import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sha256 } from '../utils/metaCapi';
import {
  consumoKwh, valorCapital, lerPlanilha, listaSolar, listaEletroposto, juntar, linhaPublico,
  lotesPublico, previa, TICKET_ELETRO, pesoBaseDoCard, PESO_BASE_SOLAR, PESO_BASE_ELETRO, ORIGENS_DE_LEAD, type Quente, type ListaQuentes,
} from '../services/meta/clientesQuentesPuro';
import { ehOrigemEletroposto } from '../services/agenda/origemEtiqueta';
import {
  PONTOS_QUIZ_BOM, valorDaVenda, nomesCompativeis, dataDaPlanilha, numeroDoCodigoSolar, JANELA_VENDA_RECENTE_DIAS,
  pisoDoValor, DIVISOR_PISO_DO_TETO, DIVISOR_PISO_DO_TICKET, type FontesDeValor, type VendaPlanilha,
} from '../services/meta/clientesQuentesPuro';
import { NOTA_MINIMA_SOLAR } from '../services/io/solarDescarte';

// O lead bom do Meta começa onde o quiz para de descartar: se um mudar sozinho, os dois se separam calados.
it('o corte do lead bom no Meta é o mesmo do descarte do quiz', () => {
  expect(PONTOS_QUIZ_BOM).toBe(NOTA_MINIMA_SOLAR);
});

// Cada linha aqui vira instrução para o algoritmo do Meta caçar mais gente
// parecida. O erro caro não é mandar de menos: é ensinar com cliente frio.

// ── Parte pura ───────────────────────────────────────────────────────────────
describe('consumo respondido', () => {
  const casos: Array<[string, number | null]> = [
    ['- 500', 500], ['500 a 700', 600], ['700 a 900', 800], ['900 a 1200', 1050], ['+ 1200', 1200],
    ['- 300,00', 300], ['300 ~ 600', 450], ['600 ~1000', 800], ['+ 1000', 1000],
    ['mais_de_r$1.100', 1095], ['R$ 900', 857], ['Mais de R$ 1.500', 1476], ['R$ 800 a R$ 1.500', 1095], // reais viram kWh pela tarifa 1,05
    ['R$ 1.050 a R$ 2.000 (~1452 kWh)', 1452], ['', null], ['não sei', null],
  ];
  it.each(casos)('%s', (txt, esperado) => { expect(consumoKwh(txt)).toBe(esperado); });

  it('quente é a partir de 900', () => {
    const quente = ['900 a 1200', '+ 1200', '+ 1000', 'mais_de_r$1.100', 'Mais de R$ 1.500', 'R$ 800 a R$ 1.500'];
    const frio = ['R$ 900', 'R$ 400 a R$ 800', '- 500', '500 a 700', '700 a 900', '- 300,00', '300 ~ 600', '600 ~1000', 'nada'];
    for (const t of quente) expect((consumoKwh(t) ?? 0) >= 900, t).toBe(true);
    for (const t of frio) expect((consumoKwh(t) ?? 0) >= 900, t).toBe(false);
  });
});

describe('capital da parceria', () => {
  const casos: Array<[string, number | null]> = [
    ['R$ 50 mil a R$ 100 mil', 50000], ['R$ 100 mil a R$ 200 mil', 100000], ['R$ 140 mil', 140000],
    ['Acima de R$ 200 mil', 200000], ['Depende do ponto', null], ['Até R$ 50 mil', 50000], ['R$ 70 mil', 70000],
    ['R$ 280 mil', 280000], ['R$ 100 mil', 100000], ['R$ 50 mil', 50000], ['Mais de R$ 500 mil', 500000],
    ['R$ 500 mil', 500000], [null as any, null],
  ];
  it.each(casos)('%s', (txt, esperado) => { expect(valorCapital(txt)).toBe(esperado); });
});

const CSV = [
  'J49,NOME CLIENTE,CONTATO,CIDADE,UF,VALOR DA VENDA,OUTRO',
  '#1,Ana Souza,(34) 99999-1111,Uberlândia,MG,"R$ 6.990,00",x',
  '#2,Beto Lima,34988882222,Araguari,MG,"R$ 13.010,00",x',
  '#3,Caio Sem Valor,34977773333,Uberaba,MG,,x',
  'total,,,,,"R$ 99.999,00",x',
  ',linha vazia,,,,,',
].join('\n');

describe('planilha com A1 quebrado', () => {
  it('acha as colunas pelo nome e as vendas pelo "#n"', async () => {
    const { parseCSV } = await import('../services/insightsService');
    const { vendas, ticket } = lerPlanilha(parseCSV(CSV));
    expect(vendas.map(v => v.nome)).toEqual(['Ana Souza', 'Beto Lima', 'Caio Sem Valor']);
    expect(vendas[0]).toMatchObject({ telefone: '(34) 99999-1111', cidade: 'Uberlândia', uf: 'MG', valor: 6990 });
    expect(ticket).toBe(10000); // média só de quem tem valor: (6990 + 13010) / 2
  });
  it('sem cabeçalho reconhecível devolve o ticket padrão', () => {
    expect(lerPlanilha([['a', 'b']])).toEqual({ vendas: [], ticket: 20000 });
  });
  // Uma venda de R$ 380 mil entre vendas de R$ 10 mil puxava sozinha o ticket e o
  // peso do público com valor. Teto: 3× a mediana.
  it('venda fora da curva vale no máximo 3× a mediana, e o ticket sai da conta já limitada', () => {
    const cab = ['J49', 'NOME CLIENTE', 'CONTATO', 'CIDADE', 'UF', 'VALOR DA VENDA'];
    const v = (n: number, valor: string) => [`#${n}`, `Cliente ${n}`, `3499999000${n}`, 'Uberlândia', 'MG', valor];
    const { vendas, ticket } = lerPlanilha([cab, v(1, 'R$ 10.000,00'), v(2, 'R$ 10.000,00'), v(3, 'R$ 12.000,00'), v(4, 'R$ 380.000,00')]);
    expect(vendas.map(x => x.valor)).toEqual([10000, 10000, 12000, 33000]); // mediana 11000 × 3
    expect(ticket).toBe(16250);
  });
});

const ag = (id: number, status: string, over: Record<string, unknown> = {}) => ({
  id, status, cliente_nome: `Cliente ${id} Silva`, cliente_telefone: `3499${String(1000000 + id).slice(-7)}`,
  cidade: 'Uberlândia', created_by: 'lead-meta', created_at: '2026-09-01T10:00:00Z', nota: null, capital_faixa: null, ...over,
});
const eletro = (id: number, status: string, over: Record<string, unknown> = {}) => ag(id, status, { created_by: 'eletroposto-quiz', ...over });
const lead = (over: Record<string, unknown>) => ({ lead_id: '1', nome: 'Lead Real Silva', whatsapp: '34911112222', cidade: 'Uberlândia', field_data: [], ...over });
const fd = (o: Record<string, string>) => Object.entries(o).map(([name, v]) => ({ name, values: [v] }));
const T = 10000;
const solar = (cards: any[] = [], leads: any[] = [], vendas: any[] = []) =>
  listaSolar({ cards, leads, vendas, ticket: T, ehEletro: ehOrigemEletroposto });
const valorDe = (l: ListaQuentes, id: number) => [...l.values()].find(q => q.nome.startsWith(`Cliente ${id} `));

describe('valor por status', () => {
  it('solar: escada de ticket', () => {
    const l = solar([ag(1, 'fechou'), ag(2, 'fechou_concorrente'), ag(3, 'fez_orcamento'), ag(4, 'proposta_apresentada'),
      ag(5, 'apalavrado'), ag(6, 'em_atendimento'), ag(7, 'agendado'), ag(8, 'sem_interesse')]);
    expect(valorDe(l, 1)).toMatchObject({ valor: 10000, motivo: 'fechou' });
    expect(valorDe(l, 2)!.valor).toBe(5000);
    expect(valorDe(l, 3)!.valor).toBe(3500);
    expect(valorDe(l, 4)!.valor).toBe(3500);
    expect(valorDe(l, 5)!.valor).toBe(3500);
    expect(valorDe(l, 6)!.valor).toBe(2000);
    // 29/10/2026: 'agendado' de um canal de lead entra no PÚBLICO com o peso base (0,1 do ticket); sem_interesse continua de fora.
    expect(valorDe(l, 7)).toMatchObject({ valor: 1000, motivo: 'card_de_lead' });
    expect(valorDe(l, 8)).toBeUndefined();
  });

  it('eletroposto: escada de ticket de R$ 150 mil', () => {
    const esperado: Record<string, number> = {
      fechou: 150000, apalavrado: 90000, chave_na_mao: 60000, meio_a_meio: 52500, cotista: 45000,
      proposta_apresentada: 45000, carregador: 30000, integrador: 22500, arrendamento: 22500, em_atendimento: 15000,
    };
    const status = Object.keys(esperado);
    const l = listaEletroposto({ cards: status.map((s, i) => eletro(i + 1, s)), parceria: [], ehEletro: ehOrigemEletroposto });
    status.forEach((s, i) => expect(valorDe(l, i + 1)!.valor, s).toBe(esperado[s]));
    expect(TICKET_ELETRO).toBe(150000);
  });

  it('cada família lê só os seus cards', () => {
    const cards = [ag(1, 'fechou'), eletro(2, 'fechou')];
    expect(solar(cards).size).toBe(1);
    expect(listaEletroposto({ cards, parceria: [], ehEletro: ehOrigemEletroposto }).size).toBe(1);
  });

  it('status que só existe no eletroposto não pontua no solar (só o peso base do lead)', () => {
    expect(valorDe(solar([ag(1, 'chave_na_mao')]), 1)).toMatchObject({ valor: 1000, motivo: 'card_de_lead' });
    expect(solar([ag(1, 'chave_na_mao', { created_by: 'cadastro_x' })]).size).toBe(0);
  });

  it('venda da planilha vale o próprio valor, ou o ticket se vier vazio', () => {
    const l = solar([], [], [
      { nome: 'Ana Souza', telefone: '34999991111', cidade: 'X', uf: 'MG', valor: 6990 },
      { nome: 'Caio Sem Valor', telefone: '34977773333', cidade: 'Y', uf: 'MG', valor: 0 },
    ]);
    expect(l.get('5534999991111')).toMatchObject({ valor: 6990, motivo: 'venda_planilha', uf: 'MG' });
    expect(l.get('5534977773333')!.valor).toBe(T);
  });

  it('lead do quiz com 80+ pontos e fora do "curioso" vale 0,25; consumo alto vale 0,15', () => {
    const quente = lead({ lead_id: 'quiz_34911112222', field_data: fd({ Pontos: '85', Caminho: 'pronto', Consumo: 'R$ 100 (~200 kWh)' }) });
    const curioso = lead({ lead_id: 'quiz_34922223333', whatsapp: '34922223333', field_data: fd({ Pontos: '95', Caminho: 'curioso' }) });
    const baixo = lead({ lead_id: 'quiz_34933334444', whatsapp: '34933334444', field_data: fd({ Pontos: '69', Caminho: 'pronto' }) });
    const grande = lead({ lead_id: '99', whatsapp: '34944445555', field_data: fd({ Consumo: '900 a 1200' }) });
    const grandeConsuma = lead({ lead_id: '98', whatsapp: '34955556666', field_data: fd({ Consuma: '+ 1200' }) });
    const pequeno = lead({ lead_id: '97', whatsapp: '34966667777', field_data: fd({ Consumo: '- 500' }) });
    const l = solar([], [quente, curioso, baixo, grande, grandeConsuma, pequeno]);
    expect(l.get('5534911112222')).toMatchObject({ valor: 2500, motivo: 'quiz_pontos_80' });
    expect(l.has('5534922223333')).toBe(false);
    expect(l.has('5534933334444')).toBe(false);
    expect(l.get('5534944445555')).toMatchObject({ valor: 1500, motivo: 'consumo_900kwh' });
    expect(l.get('5534955556666')!.valor).toBe(1500);
    expect(l.has('5534966667777')).toBe(false);
  });

  it('lead do quiz com nota de 70 a 79 e fora do "curioso" vale 0,15 (quiz_pontos_70)', () => {
    const bom = lead({ lead_id: 'quiz_34911112222', field_data: fd({ Pontos: '75', Caminho: 'pronto' }) });
    const borda = lead({ lead_id: 'quiz_34922223333', whatsapp: '34922223333', field_data: fd({ Pontos: '70', Caminho: 'pronto' }) });
    const abaixo = lead({ lead_id: 'quiz_34933334444', whatsapp: '34933334444', field_data: fd({ Pontos: '69', Caminho: 'pronto' }) });
    const curioso = lead({ lead_id: 'quiz_34944445555', whatsapp: '34944445555', field_data: fd({ Pontos: '75', Caminho: 'curioso' }) });
    const quente = lead({ lead_id: 'quiz_34955556666', whatsapp: '34955556666', field_data: fd({ Pontos: '85', Caminho: 'pronto' }) });
    const l = solar([], [bom, borda, abaixo, curioso, quente]);
    expect(l.get('5534911112222')).toMatchObject({ valor: 0.15 * T, motivo: 'quiz_pontos_70' });
    expect(l.get('5534922223333')).toMatchObject({ valor: 0.15 * T, motivo: 'quiz_pontos_70' });
    expect(l.has('5534933334444')).toBe(false);
    expect(l.has('5534944445555')).toBe(false);
    expect(l.get('5534955556666')).toMatchObject({ valor: 0.25 * T, motivo: 'quiz_pontos_80' });
  });

  it('eletroposto: capital >= R$ 100 mil vale 0,2 do capital; nota 3 vale 0,1 do ticket', () => {
    const par = [
      { lado: 'capital', nome: 'Rico Capital', telefone: '34911110001', cidade: 'X', capital_faixa: 'R$ 140 mil' },
      { lado: 'capital', nome: 'Pobre Capital', telefone: '34911110002', cidade: 'X', capital_faixa: 'R$ 50 mil a R$ 100 mil' },
      { lado: 'capital', nome: 'Indefinido', telefone: '34911110003', cidade: 'X', capital_faixa: 'Depende do ponto' },
      { lado: 'local', nome: 'Dono Do Ponto', telefone: '34911110004', cidade: 'X', capital_faixa: 'Acima de R$ 200 mil' },
    ];
    const l = listaEletroposto({ cards: [eletro(1, 'agendado', { nota: 3 }), eletro(2, 'agendado', { nota: 2 })], parceria: par, ehEletro: ehOrigemEletroposto });
    expect(l.get('5534911110001')).toMatchObject({ valor: 28000, motivo: 'parceria_capital' });
    expect(l.has('5534911110002')).toBe(false);
    expect(l.has('5534911110003')).toBe(false);
    expect(l.has('5534911110004')).toBe(false);
    expect(valorDe(l, 1)).toMatchObject({ valor: 15000, motivo: 'nota_3' });
    expect(valorDe(l, 2)).toBeUndefined();
  });
});

// ── PESO BASE DO LEAD (29/10/2026): todo card de canal de lead entra no público ──
describe('peso base do lead no público', () => {
  const SEM_PESO = ['agendado', 'confirmado', 'nao_atendeu', 'remarcado', 'em_contato'];
  it('card de lead sem peso próprio entra: solar 0,1 do ticket, eletroposto 0,05', () => {
    for (const st of SEM_PESO) {
      expect(valorDe(solar([ag(1, st)]), 1), `solar ${st}`).toMatchObject({ valor: 0.1 * T, motivo: 'card_de_lead' });
      const l = listaEletroposto({ cards: [ag(1, st, { created_by: 'lp_eletroposto' })], parceria: [], ehEletro: ehOrigemEletroposto });
      expect(valorDe(l, 1)!.valor, `eletro ${st}`).toBe(0.05 * TICKET_ELETRO);
    }
    expect(PESO_BASE_SOLAR).toBe(0.1);
    expect(PESO_BASE_ELETRO).toBe(0.05);
  });

  it('as sete origens de lead entram; cadastro_eletroposto, prosp_*, teste e gente do /gerador não', () => {
    expect([...ORIGENS_DE_LEAD].sort()).toEqual(['agente_eletroposto', 'indicacao', 'lead-meta', 'lp_eletroposto', 'lp_solar', 'manychat', 'manychat_eletroposto']);
    for (const o of ['lp_solar', 'manychat', 'lead-meta', 'indicacao']) expect(solar([ag(1, 'agendado', { created_by: o })]).size, o).toBe(1);
    for (const o of ['lp_eletroposto', 'manychat_eletroposto', 'agente_eletroposto']) {
      expect(listaEletroposto({ cards: [ag(1, 'agendado', { created_by: o })], parceria: [], ehEletro: ehOrigemEletroposto }).size, o).toBe(1);
    }
    for (const o of ['cadastro_eletroposto', 'prosp_eletroposto', 'convite_investidor_eletroposto']) {
      expect(listaEletroposto({ cards: [ag(1, 'agendado', { created_by: o })], parceria: [], ehEletro: ehOrigemEletroposto }).size, o).toBe(0);
    }
    for (const o of ['lp_solar_teste', 'Nilce', 'Thiago', null, '']) expect(solar([ag(1, 'agendado', { created_by: o })]).size, String(o)).toBe(0);
  });

  it('cancelado e sem_interesse ficam de fora; telefone inválido e nome de teste também', () => {
    expect(solar([ag(1, 'cancelado'), ag(2, 'sem_interesse'), ag(3, ' Cancelado ')]).size).toBe(0);
    expect(solar([ag(1, 'agendado', { cliente_telefone: '123' }), ag(2, 'agendado', { cliente_nome: 'Teste Interno' })]).size).toBe(0);
  });

  it('o peso base nunca rebaixa: o maior valor do telefone vence', () => {
    const l = solar([ag(1, 'agendado', { cliente_telefone: '34999990001' }), ag(2, 'fez_orcamento', { cliente_telefone: '34999990001' })]);
    expect(l.size).toBe(1);
    expect([...l.values()][0]).toMatchObject({ valor: 3500, motivo: 'fez_orcamento' });
  });

  it('pesoBaseDoCard: status com peso próprio não usa o base', () => {
    expect(pesoBaseDoCard('solar', 'lp_solar', 'fez_orcamento')).toBeNull();
    expect(pesoBaseDoCard('eletroposto', 'lp_eletroposto', 'apalavrado')).toBeNull();
    expect(pesoBaseDoCard('solar', 'lp_solar', 'agendado')).toBe(0.1);
  });
});

describe('junção por telefone', () => {
  it('fica o maior valor, com o motivo dele, e o melhor nome', () => {
    const l: ListaQuentes = new Map();
    juntar(l, { telefone: '(34) 99999-0000', nome: 'Ana', cidade: '', valor: 1500, motivo: 'consumo_900kwh' });
    juntar(l, { telefone: '5534999990000', nome: 'Ana Paula Souza', cidade: 'Uberlândia', uf: 'MG', valor: 3500, motivo: 'fez_orcamento' });
    juntar(l, { telefone: '34999990000', nome: 'Ana P', valor: 200, motivo: 'em_atendimento' });
    expect(l.size).toBe(1);
    expect(l.get('5534999990000')).toMatchObject({ nome: 'Ana Paula Souza', cidade: 'Uberlândia', uf: 'MG', valor: 3500, motivo: 'fez_orcamento' });
  });
  it('telefone inválido e nome com "teste" ficam de fora (sem acento nem caixa)', () => {
    const l: ListaQuentes = new Map();
    juntar(l, { telefone: '123', nome: 'Bom Nome', valor: 100, motivo: 'a' });
    juntar(l, { telefone: '34999990001', nome: 'TESTE da Silva', valor: 100, motivo: 'a' });
    juntar(l, { telefone: '34999990002', nome: 'Fulano Têste', valor: 100, motivo: 'a' });
    expect(l.size).toBe(0);
  });
  it('arredonda para reais inteiros e nunca vai a zero', () => {
    const l: ListaQuentes = new Map();
    juntar(l, { telefone: '34999990003', nome: 'A B', valor: 3499.6, motivo: 'a' });
    juntar(l, { telefone: '34999990004', nome: 'C D', valor: 0.2, motivo: 'a' });
    expect(l.get('5534999990003')!.valor).toBe(3500);
    expect(l.get('5534999990004')!.valor).toBe(1);
  });
  it('quem é quente nos dois produtos entra nas duas listas', () => {
    const cards = [ag(1, 'fechou', { cliente_telefone: '34988880000' }), eletro(2, 'fechou', { cliente_telefone: '34988880000' })];
    expect(solar(cards).has('5534988880000')).toBe(true);
    expect(listaEletroposto({ cards, parceria: [], ehEletro: ehOrigemEletroposto }).has('5534988880000')).toBe(true);
  });
});

const quente = (over: Partial<Quente> = {}): Quente => ({ telefone: '5534999990000', nome: 'Ana Paula Souza', cidade: 'Uberlândia', uf: 'MG', valor: 3500, motivo: 'x', ...over });

describe('payload do público', () => {
  it('colunas na ordem do esquema, tudo hasheado menos o valor', () => {
    const linha = linhaPublico(quente());
    expect(linha).toEqual([
      sha256('5534999990000'), sha256('ana'), sha256('souza'), sha256('uberlandia'), sha256('mg'), sha256('br'), 3500,
    ]);
    expect(typeof linha[6]).toBe('number');
  });
  it('campo vazio vai como string vazia, nunca como hash de vazio', () => {
    const linha = linhaPublico(quente({ nome: 'Ana', cidade: '', uf: '' }));
    expect(linha.slice(1, 5)).toEqual([sha256('ana'), '', '', '']);
  });
  it('UF vem do fim da cidade quando não há coluna', () => {
    expect(linhaPublico(quente({ uf: '', cidade: 'Uberlândia, MG' }))[4]).toBe(sha256('mg'));
  });
  it('sessão: lote único leva last_batch_flag; vários lotes incrementam o batch_seq', () => {
    const lista = Array.from({ length: 5 }, (_, i) => quente({ telefone: `553499999000${i}` }));
    const um = lotesPublico(lista, 123);
    expect(um).toHaveLength(1);
    expect(um[0].session).toEqual({ session_id: 123, batch_seq: 1, last_batch_flag: true, estimated_num_total: 5 });
    expect(um[0].payload.schema).toEqual(['PHONE', 'FN', 'LN', 'CT', 'ST', 'COUNTRY', 'LOOKALIKE_VALUE']);
    const tres = lotesPublico(lista, 123, 2);
    expect(tres.map(l => [l.session.batch_seq, l.session.last_batch_flag, l.payload.data.length]))
      .toEqual([[1, false, 2], [2, false, 2], [3, true, 1]]);
  });
  it('prévia mascara o telefone e conta por motivo', () => {
    const l: ListaQuentes = new Map();
    juntar(l, { telefone: '34999990000', nome: 'A B', valor: 500, motivo: 'm1' });
    juntar(l, { telefone: '34999990001', nome: 'C D', valor: 900, motivo: 'm2' });
    const p = previa(l);
    expect(p.porMotivo).toEqual({ m1: 1, m2: 1 });
    expect(p.amostra[0].telefone).toBe('*********0001');
    expect(JSON.stringify(p)).not.toContain('5534999990001');
  });
});

// ── Serviço (mocks de banco e rede) ──────────────────────────────────────────
const tabelas: Record<string, any[]> = {};
const inserts: Array<{ tabela: string; row: any }> = [];
let estado: Record<string, any> = {};
let falhaUpsert = false;
let falhaInsert = false;
const semOrdem: string[] = [];
const marcar = () => { estado.clientes_quentes_baseline = { feito: true }; };
const upserts: any[] = [];
const chamadas: Array<{ metodo: string; url: string; corpo: any }> = [];
let usersreplaceOk = true;
let metaEventoOk = true;
let planilhaOk = true;
let publicosExistentes: Array<{ id: string; name: string }> = [];
let paginar = false;
let fontesFalsas = { codigosDoCard: new Map<number, number[]>(), valorDaProposta: new Map<number, number>() };
let fontesTravadas = false;
vi.mock('../services/meta/clientesQuentesValor', () => ({ lerFontesDeValor: () => (fontesTravadas ? new Promise(() => {}) : Promise.resolve(fontesFalsas)) }));

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      let filtro: ((r: any) => boolean) | null = null;
      const ordens: string[] = [];
      const q: any = {
        select() { return q; },
        order(col: string) { ordens.push(col); return q; },
        like(col: string, pat: string) { const pre = pat.replace('%', ''); filtro = r => String(r[col]).startsWith(pre); return q; },
        range(a: number, b: number) {
          if (!ordens.length) semOrdem.push(tabela);
          const todas = (tabelas[tabela] ?? []).filter(filtro ?? (() => true));
          return Promise.resolve({ data: todas.slice(a, b + 1), error: null });
        },
        upsert(rows: any[], opts: any) {
          if (falhaUpsert) return Promise.resolve({ error: { message: 'queda no meio' } });
          for (const r of rows) {
            const t = (tabelas[tabela] ??= []);
            if (opts?.ignoreDuplicates && t.some(x => x.lead_id === r.lead_id && x.event_name === r.event_name)) continue;
            inserts.push({ tabela, row: r }); t.push(r);
          }
          return Promise.resolve({ error: null });
        },
        insert(row: any) {
          if (falhaInsert) return Promise.resolve({ error: { message: 'banco fora' } });
          for (const r of Array.isArray(row) ? row : [row]) { inserts.push({ tabela, row: r }); (tabelas[tabela] ??= []).push(r); }
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: () => Promise.resolve({ data: estado[k] ? { value: estado[k] } : null, error: null }) }) }),
      upsert: (row: any) => { upserts.push(row); estado[row.key] = row.value; return Promise.resolve({ error: null }); },
    }),
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const resp = (corpo: any, status = 200) => ({ ok: status < 400, status, json: async () => corpo, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });

function fetchFalso(url: string, init?: any) {
  const metodo = init?.method || 'GET';
  const corpo = init?.body ? JSON.parse(init.body) : undefined;
  if (url.includes('docs.google.com')) {
    return Promise.resolve(planilhaOk ? resp(CSV) : resp('erro', 500));
  }
  chamadas.push({ metodo, url, corpo });
  if (url.includes('/customaudiences') && metodo === 'GET') {
    if (paginar && !url.includes('after=2')) {
      return Promise.resolve(resp({ data: [{ id: '1', name: 'outro' }], paging: { next: url + '&after=2' } }));
    }
    return Promise.resolve(resp({ data: publicosExistentes }));
  }
  if (url.includes('/customaudiences') && metodo === 'POST') return Promise.resolve(resp({ id: `novo_${corpo.name.includes('Solar') ? 's' : 'e'}` }));
  if (url.includes('/usersreplace')) return Promise.resolve(usersreplaceOk ? resp({ num_received: 1 }) : resp({ error: { message: 'sem permissao' } }, 400));
  if (/\/users\?/.test(url)) return Promise.resolve(resp({ num_received: 1 }));
  if (url.includes('/events')) return Promise.resolve(metaEventoOk ? resp({ events_received: 1 }) : resp({ error: { message: 'recusado' } }, 400));
  return Promise.resolve(resp({}));
}

const envOriginal = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  inserts.length = 0; upserts.length = 0; chamadas.length = 0; estado = {}; falhaUpsert = false; falhaInsert = false; semOrdem.length = 0;
  usersreplaceOk = true; metaEventoOk = true; planilhaOk = true; publicosExistentes = []; paginar = false;
  fontesFalsas = { codigosDoCard: new Map(), valorDaProposta: new Map() }; fontesTravadas = false;
  process.env.META_SYSTEM_USER_TOKEN = 'tok_falso';
  delete process.env.CLIENTE_QUENTE_OFF; delete process.env.PUBLICO_QUENTE_OFF;
  vi.stubGlobal('fetch', vi.fn(fetchFalso));
});
afterEach(() => { process.env = { ...envOriginal }; vi.unstubAllGlobals(); vi.resetModules(); });

async function run(opts: any = {}) {
  const m = await import('../services/meta/clientesQuentes');
  return m.runClientesQuentes(opts);
}
const eventosEnviados = () => chamadas.filter(c => c.url.includes('/events'));
const dedup = () => inserts.filter(i => i.tabela === 'capi_conversoes_enviadas').map(i => i.row);

/** 25 cards solares com orçamento e 25 do eletroposto apalavrados: passam do piso de 20 do público. */
function base(n = 25) {
  tabelas.agendamentos = [
    ...Array.from({ length: n }, (_, i) => ag(i + 1, 'fez_orcamento')),
    ...Array.from({ length: n }, (_, i) => eletro(1000 + i, 'apalavrado')),
  ];
  tabelas.leads_meta = [];
  tabelas.eletroposto_parceria = [];
}

describe('B. eventos ao avançar o card', () => {
  it('primeira rodada: linha de base, sem chamar o Meta', async () => {
    base(5);
    const r = await run();
    expect(r.eventos.baseline).toBe(10);
    expect(r.eventos.enviados).toBe(0);
    expect(eventosEnviados()).toHaveLength(0);
    const linhas = dedup();
    expect(linhas).toHaveLength(10);
    expect(linhas[0]).toMatchObject({ lead_id: 'ag_1', event_name: 'ClienteQuente', meta_status: 0, origem: 'baseline:solar:fez_orcamento' });
    expect(linhas.find(l => l.lead_id === 'ag_1000')!.origem).toBe('baseline:eletroposto:apalavrado');
  });

  it('com a tabela já usada, card novo sai com valor, dados e event_id estáveis', async () => {
    base(0);
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [ag(1, 'fez_orcamento'), eletro(2, 'apalavrado'), ag(3, 'fechou')];
    const r = await run();
    expect(r.eventos.enviados).toBe(3);
    const ev = eventosEnviados().map(c => c.corpo.data[0]);
    const porId = Object.fromEntries(ev.map(e => [e.event_id, e]));
    expect(porId.quente_ag_1).toMatchObject({ event_name: 'ClienteQuente', action_source: 'system_generated', custom_data: { status: 'fez_orcamento', produto: 'solar', currency: 'BRL' } });
    expect(porId.quente_ag_1.custom_data.value).toBe(Math.round(0.35 * 10000)); // ticket = média da planilha (10.000)
    expect(porId.quente_ag_2.custom_data).toMatchObject({ produto: 'eletroposto', value: 90000 });
    expect(porId.venda_ag_3).toMatchObject({ event_name: 'Purchase' });
    expect(porId.venda_ag_3.custom_data.value).toBe(10000);
    // cada produto no seu pixel
    const urlDe = (id: string) => eventosEnviados().find(c => c.corpo.data[0].event_id === id)!.url;
    expect(urlDe('quente_ag_2')).toContain('/26788759654130722/events');
    expect(urlDe('quente_ag_1')).toContain('/446093469730871/events');
    // dedup gravado só depois do aceite
    expect(dedup().map(d => d.lead_id).sort()).toEqual(['ag_1', 'ag_2', 'ag_3']);
    expect(dedup().find(d => d.lead_id === 'ag_2')).toMatchObject({ origem: 'quente:eletroposto:apalavrado', telefone_core8: expect.stringMatching(/^\d{8}$/), meta_status: 200, meta_received: 1 });
  });

  it('par já enviado não é reenviado; Purchase depois do ClienteQuente do mesmo card é novo', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_1', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [ag(1, 'fez_orcamento'), ag(2, 'fechou')];
    let r = await run();
    expect(r.eventos.enviados).toBe(1);
    expect(eventosEnviados().map(c => c.corpo.data[0].event_id)).toEqual(['venda_ag_2']);
    // card 1 evolui para fechou: o Purchase é um par novo
    tabelas.agendamentos = [ag(1, 'fechou')];
    chamadas.length = 0;
    r = await run();
    expect(eventosEnviados().map(c => c.corpo.data[0].event_id)).toEqual(['venda_ag_1']);
  });

  it('recusa do Meta não grava dedup e volta na próxima', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [ag(1, 'fez_orcamento')];
    metaEventoOk = false;
    const r = await run();
    expect(r.eventos.enviados).toBe(0);
    expect(r.eventos.erros[0]).toMatchObject({ card: 'ag_1', erro: 'recusado' });
    expect(dedup()).toHaveLength(0);
  });

  it('teto de 40 por rodada, o resto fica em pendentes', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = Array.from({ length: 45 }, (_, i) => ag(i + 1, 'fez_orcamento'));
    const r = await run();
    expect(r.eventos.enviados).toBe(40);
    expect(r.eventos.pendentes).toBe(5);
    expect(eventosEnviados()).toHaveLength(40);
  });

  it('o peso base do lead NUNCA vira evento: agendado de canal de lead entra no público e não manda ClienteQuente nem Purchase', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [
      ag(1, 'agendado'), ag(2, 'confirmado', { created_by: 'lp_solar' }), ag(3, 'nao_atendeu', { created_by: 'manychat' }),
      eletro(4, 'agendado', { created_by: 'lp_eletroposto' }), eletro(5, 'agendado', { created_by: 'cadastro_eletroposto' }),
    ];
    tabelas.leads_meta = []; tabelas.eletroposto_parceria = [];
    const r = await run({ dry: true });
    expect(r.eventos.aEnviar ?? 0).toBe(0);
    expect(eventosEnviados()).toHaveLength(0);
    const real = await run();
    expect(real.eventos.enviados).toBe(0);
    expect(eventosEnviados()).toHaveLength(0);
    expect(dedup()).toHaveLength(0);
  });

  it('o público leva o card agendado de lead e deixa o cadastro_eletroposto de fora', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [
      ...Array.from({ length: 25 }, (_, i) => ag(i + 1, 'agendado', { created_by: 'lp_solar' })),
      ...Array.from({ length: 25 }, (_, i) => eletro(1000 + i, 'agendado', { created_by: 'lp_eletroposto' })),
      ...Array.from({ length: 25 }, (_, i) => eletro(2000 + i, 'agendado', { created_by: 'cadastro_eletroposto' })),
    ];
    tabelas.leads_meta = []; tabelas.eletroposto_parceria = [];
    const r = await run({ dry: true });
    // 25 cards de lead + as 3 vendas da planilha de teste
    expect(r.publico.solar!.pessoas).toBe(28);
    expect(r.publico.eletroposto!.pessoas).toBe(25);
    expect(r.previa!.solar!.porMotivo).toEqual({ card_de_lead: 25, venda_planilha: 3 });
    expect(eventosEnviados()).toHaveLength(0);
  });

  it('card sem telefone válido ou de teste não vira evento', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [ag(1, 'fez_orcamento', { cliente_telefone: '123' }), ag(2, 'fez_orcamento', { cliente_nome: 'Teste Interno' })];
    const r = await run();
    expect(r.eventos.enviados).toBe(0);
    expect(eventosEnviados()).toHaveLength(0);
  });

  it('paginação: mais de 1000 linhas de dedup são lidas até o fim', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = Array.from({ length: 1500 }, (_, i) => ({ lead_id: `ag_${i + 1}`, event_name: 'ClienteQuente' }));
    tabelas.agendamentos = [ag(1400, 'fez_orcamento')];
    const r = await run();
    expect(r.eventos.enviados).toBe(0); // ag_1400 estava na segunda página
    expect(r.eventos.baseline).toBe(0);
  });

  it('chave CLIENTE_QUENTE_OFF desliga os eventos mas não o público', async () => {
    base(25);
    process.env.CLIENTE_QUENTE_OFF = '1';
    const r = await run();
    expect(r.eventos.pulado).toBe('desligado');
    expect(dedup()).toHaveLength(0);
    expect(r.publico.solar!.pessoas).toBe(28); // 25 cards + 3 vendas da planilha
  });
});

describe('A. público com valor', () => {
  it('cria os dois públicos com valor, troca o conteúdo e grava o portão do dia', async () => {
    base();
    const r = await run();
    expect(r.publico.solar).toMatchObject({ pessoas: 28, enviadoPor: 'usersreplace', audienceId: 'novo_s' });
    expect(r.publico.eletroposto).toMatchObject({ pessoas: 25, enviadoPor: 'usersreplace', audienceId: 'novo_e' });
    const criados = chamadas.filter(c => c.metodo === 'POST' && c.url.includes('/customaudiences'));
    expect(criados.map(c => c.corpo.name)).toEqual([
      'IO Solar · clientes quentes (base com valor)', 'IO Eletroposto · clientes quentes (base com valor)']);
    expect(criados[0].corpo).toMatchObject({ subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', is_value_based: true });
    expect(criados[0].corpo.description).toBeTruthy();
    expect(criados[0].url).toContain('act_545732112868250');
    const sobe = chamadas.find(c => c.url.includes('/novo_s/usersreplace'))!;
    expect(sobe.url).toContain('access_token=tok_falso');
    expect(sobe.corpo.session).toMatchObject({ batch_seq: 1, last_batch_flag: true, estimated_num_total: 28 });
    expect(Number.isInteger(sobe.corpo.session.session_id)).toBe(true);
    expect(sobe.corpo.session.session_id).toBeGreaterThan(0);
    expect(sobe.corpo.payload.schema).toEqual(['PHONE', 'FN', 'LN', 'CT', 'ST', 'COUNTRY', 'LOOKALIKE_VALUE']);
    const linha = sobe.corpo.payload.data[0];
    expect(linha[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(linha[5]).toBe(sha256('br'));
    expect(sobe.corpo.payload.data.map((l: any[]) => l[6]).sort((a: number, b: number) => a - b)).toEqual([...Array(25).fill(3500), 6990, 10000, 13010].sort((a, b) => a - b)); // 25 orçamentos + 3 vendas
    expect(sobe.corpo.payload.data.every((l: any[]) => typeof l[6] === 'number')).toBe(true);
    const gate = upserts.filter(u => u.key === 'clientes_quentes_publico');
    expect(gate).toHaveLength(1);
    expect(gate[0].value.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('acha o público pelo nome exato, inclusive na segunda página, e não cria outro', async () => {
    base();
    paginar = true;
    publicosExistentes = [
      { id: '777', name: 'IO Solar · clientes quentes (base com valor)' },
      { id: '888', name: 'IO Eletroposto · clientes quentes (base com valor)' },
    ];
    const r = await run();
    expect(r.publico.solar!.audienceId).toBe('777');
    expect(r.publico.eletroposto!.audienceId).toBe('888');
    expect(chamadas.filter(c => c.metodo === 'POST' && c.url.includes('/customaudiences'))).toHaveLength(0);
    expect(chamadas.filter(c => c.metodo === 'GET' && c.url.includes('after=2')).length).toBeGreaterThan(0);
  });

  // Sem plano B aditivo (/users): ele deixaria no público quem esfriou. A recusa
  // vira erro no relatório e o portão do dia fica livre para a próxima rodada.
  it('usersreplace recusado: erro no relatório, nenhum /users, sem lançar', async () => {
    base();
    usersreplaceOk = false;
    const r = await run();
    expect(r.publico.solar!.erro).toMatch(/^usersreplace: /);
    expect(r.publico.solar!.enviadoPor).toBeUndefined();
    expect(chamadas.some(c => /\/users\?/.test(c.url))).toBe(false);
  });

  it('lista com menos de 20 pessoas não sobe', async () => {
    base(10);
    const r = await run();
    expect(r.publico.solar).toEqual({ pessoas: 13, erro: 'poucos' });
    expect(chamadas.filter(c => c.url.includes('/customaudiences'))).toHaveLength(0);
  });

  it('portão do dia: a segunda rodada no mesmo dia (BRT) pula, forcarPublico passa por cima', async () => {
    base();
    await run();
    chamadas.length = 0;
    const r2 = await run();
    expect(r2.publico.pulado).toBe('hoje_ja_rodou');
    expect(chamadas.filter(c => c.url.includes('usersreplace'))).toHaveLength(0);
    const r3 = await run({ forcarPublico: true });
    expect(r3.publico.solar!.enviadoPor).toBe('usersreplace');
  });

  it('o dia é o de Brasília, não o do servidor em UTC', async () => {
    const { diaBRT } = await import('../services/meta/clientesQuentes');
    expect(diaBRT(Date.parse('2026-10-10T02:30:00Z'))).toBe('2026-10-09'); // 23h30 em Brasília
    expect(diaBRT(Date.parse('2026-10-10T03:00:00Z'))).toBe('2026-10-10');
  });

  it('dia anterior no portão deixa rodar de novo', async () => {
    base();
    estado.clientes_quentes_publico = { dia: '2000-01-01' };
    const r = await run();
    expect(r.publico.solar!.enviadoPor).toBe('usersreplace');
  });

  it('PUBLICO_QUENTE_OFF desliga só o público', async () => {
    base();
    process.env.PUBLICO_QUENTE_OFF = '1';
    const r = await run();
    expect(r.publico.pulado).toBe('desligado');
    expect(chamadas.filter(c => c.url.includes('/customaudiences'))).toHaveLength(0);
    expect(r.eventos.baseline).toBe(50);
  });

  it('sem planilha o público do solar NÃO sobe (lista encolhida), o do eletroposto sim, e os eventos usam o ticket padrão', async () => {
    base();
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    planilhaOk = false;
    const r = await run();
    expect(r.publico.solar).toMatchObject({ erro: 'planilha' });
    expect(r.publico.solar!.enviadoPor).toBeUndefined();
    expect(chamadas.some(c => c.url.includes('novo_s'))).toBe(false);
    expect(r.publico.eletroposto).toMatchObject({ pessoas: 25, enviadoPor: 'usersreplace' });
    const ev = eventosEnviados().map(c => c.corpo.data[0]).find(e => e.event_id === 'quente_ag_1')!;
    expect(ev.custom_data.value).toBe(7000); // 0,35 x 20.000
  });

  it('planilha que vem sem nenhuma venda também barra o solar', async () => {
    base();
    (globalThis.fetch as any).mockImplementation((url: string, init?: any) =>
      url.includes('docs.google.com') ? Promise.resolve(resp('J49,NOME CLIENTE,CONTATO\n')) : fetchFalso(url, init));
    const r = await run();
    expect(r.publico.solar).toMatchObject({ erro: 'planilha' });
  });

  it('sem token não chama o Meta e informa', async () => {
    base();
    delete process.env.META_SYSTEM_USER_TOKEN; delete process.env.META_PIXEL_TOKEN;
    const r = await run();
    expect(r.publico.solar).toEqual({ pessoas: 28, erro: 'sem_token' });
  });
});

describe('dry', () => {
  it('monta tudo e não grava nem chama o Meta; prévia com telefone mascarado', async () => {
    base();
    const r = await run({ dry: true });
    expect(inserts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
    expect(chamadas).toHaveLength(0);
    expect(r.eventos.baseline).toBe(50);
    expect(r.publico.solar!.pessoas).toBe(28); // 25 cards + 3 vendas da planilha
    expect(r.previa!.solar!.porMotivo).toEqual({ fez_orcamento: 25, venda_planilha: 3 });
    expect(r.previa!.eletroposto!.porMotivo).toEqual({ apalavrado: 25 });
    expect(r.previa!.solar!.amostra).toHaveLength(5);
    expect(r.previa!.solar!.amostra[0].telefone).toMatch(/^\*+\d{4}$/);
  });

  it('dry com tabela já usada informa o que seria enviado, sem enviar', async () => {
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    tabelas.agendamentos = [ag(1, 'fez_orcamento')];
    tabelas.leads_meta = []; tabelas.eletroposto_parceria = [];
    const r = await run({ dry: true });
    expect(r.eventos.aEnviar).toBe(1);
    expect(eventosEnviados()).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('dry passa por cima do portão e das chaves de desligar', async () => {
    base();
    estado.clientes_quentes_publico = { dia: '2999-01-01' };
    process.env.PUBLICO_QUENTE_OFF = '1'; process.env.CLIENTE_QUENTE_OFF = '1';
    const r = await run({ dry: true });
    expect(r.publico.solar!.pessoas).toBe(28); // 25 cards + 3 vendas da planilha
    expect(r.eventos.pulado).toBeUndefined();
  });
});

describe('baseline com marca de conclusão', () => {
  it('só grava a marca depois de todas as linhas', async () => {
    base(5);
    await run();
    expect(estado.clientes_quentes_baseline).toMatchObject({ feito: true });
    expect(estado.clientes_quentes_baseline.em).toMatch(/^\d{4}-/);
  });

  it('baseline que morre no meio não grava a marca e a próxima rodada retoma sem mandar nada ao Meta', async () => {
    base(5);
    falhaUpsert = true;
    let r = await run({ forcarPublico: true });
    expect(r.eventos.erros[0].erro).toContain('baseline');
    expect(estado.clientes_quentes_baseline).toBeUndefined();
    falhaUpsert = false;
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_1', event_name: 'ClienteQuente' }]; // sobra da tentativa anterior
    r = await run({ forcarPublico: true });
    expect(eventosEnviados()).toHaveLength(0);
    expect(r.eventos.baseline).toBe(10);
    expect(estado.clientes_quentes_baseline).toBeDefined();
    // a linha que já estava não foi duplicada
    expect(tabelas.capi_conversoes_enviadas.filter(l => l.lead_id === 'ag_1')).toHaveLength(1);
  });

  it('com a marca gravada, dedup vazio NÃO refaz a baseline: o card sai como evento', async () => {
    marcar();
    tabelas.agendamentos = [ag(1, 'fez_orcamento')];
    tabelas.capi_conversoes_enviadas = [];
    const r = await run({ forcarPublico: true });
    expect(r.eventos.baseline).toBe(0);
    expect(r.eventos.enviados).toBe(1);
  });

  it('com a marca gravada, erro na leitura do dedup aborta os eventos', async () => {
    marcar();
    tabelas.agendamentos = [ag(1, 'fez_orcamento')];
    const gerador = await import('../utils/supabaseGerador');
    const orig = (gerador.supabaseGerador as any).from;
    (gerador.supabaseGerador as any).from = (t: string) => t === 'capi_conversoes_enviadas'
      ? { select: () => ({ like: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'timeout' } }) }) }) }) }
      : orig(t);
    const r = await run();
    (gerador.supabaseGerador as any).from = orig;
    expect(r.eventos.erros[0].erro).toContain('ler dedup');
    expect(r.eventos.baseline).toBe(0);
    expect(eventosEnviados()).toHaveLength(0);
  });
});

describe('portão do dia só quando algo subiu', () => {
  const portao = () => upserts.filter(u => u.key === 'clientes_quentes_publico');

  it('Meta recusando os dois caminhos: dia livre para a próxima rodada', async () => {
    base();
    (globalThis.fetch as any).mockImplementation((url: string, init?: any) =>
      /\/users(replace)?\?/.test(url) ? Promise.resolve(resp({ error: { message: 'negado' } }, 400)) : fetchFalso(url, init));
    await run();
    expect(portao()).toHaveLength(0);
  });

  it('sem token: dia livre', async () => {
    base();
    delete process.env.META_SYSTEM_USER_TOKEN; delete process.env.META_PIXEL_TOKEN;
    await run();
    expect(portao()).toHaveLength(0);
  });

  it('os dois abaixo do piso: dia marcado', async () => {
    base(5); // 8 no solar, 5 no eletroposto
    await run();
    expect(portao()).toHaveLength(1);
  });

  it('um subiu e o outro falhou: dia marcado', async () => {
    base();
    planilhaOk = false;
    await run();
    expect(portao()).toHaveLength(1);
  });
});

describe('erros que o dono precisa ver', () => {
  it('dedup que falha DEPOIS do Meta aceitar vai para eventos.erros', async () => {
    marcar();
    tabelas.agendamentos = [ag(1, 'fez_orcamento')];
    falhaInsert = true;
    const r = await run();
    expect(r.eventos.enviados).toBe(1);
    expect(r.eventos.erros[0]).toMatchObject({ card: 'ag_1' });
    expect(r.eventos.erros[0].erro).toContain('dedup insert');
  });
});

describe('leituras paginadas', () => {
  it('todo range tem order, inclusive eletroposto_parceria', async () => {
    base();
    await run({ forcarPublico: true });
    expect(semOrdem).toEqual([]);
  });
});

describe('orçamento de tempo', () => {
  it('passando de 120 s para de enviar e conta o resto como pendentes', async () => {
    marcar();
    tabelas.agendamentos = Array.from({ length: 10 }, (_, i) => ag(i + 1, 'fez_orcamento'));
    let agora = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => agora);
    (globalThis.fetch as any).mockImplementation((url: string, init?: any) => {
      if (url.includes('/events')) agora += 50_000; // Meta lento
      return fetchFalso(url, init);
    });
    const r = await run();
    vi.restoreAllMocks();
    expect(r.eventos.enviados).toBe(3); // 0 s, 50 s, 100 s enviam; aos 150 s para
    expect(r.eventos.pendentes).toBe(7);
  });

  it('o público roda antes dos eventos', async () => {
    base();
    marcar();
    tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }];
    await run();
    const iPublico = chamadas.findIndex(c => c.url.includes('/customaudiences'));
    const iEvento = chamadas.findIndex(c => c.url.includes('/events'));
    expect(iPublico).toBeGreaterThanOrEqual(0);
    expect(iEvento).toBeGreaterThan(iPublico);
  });
});

describe('consumo do formulário do Meta', () => {
  it('lê o campo de nome longo, não só Consumo/Consuma', () => {
    const l = listaSolar({
      cards: [], vendas: [], ticket: T, ehEletro: ehOrigemEletroposto,
      leads: [lead({ lead_id: '55', whatsapp: '34912340000', field_data: fd({ 'qual_seu_consumo_médio_de_energia_(conta_de_luz)?': '900 a 1200' }) })],
    });
    expect(l.get('5534912340000')).toMatchObject({ valor: 1500, motivo: 'consumo_900kwh' });
  });
  it('conta em reais baixa não vira quente', () => {
    const l = listaSolar({
      cards: [], vendas: [], ticket: T, ehEletro: ehOrigemEletroposto,
      leads: [lead({ lead_id: '56', whatsapp: '34912340001', field_data: fd({ Consumo: 'R$ 900' }) })],
    });
    expect(l.size).toBe(0);
  });
});


// ── O valor real da venda no Purchase (03/11/2026) ───────────────────────────
describe('valorDaVenda: o valor da venda, e na dúvida o ticket', () => {
  const venda = (codigo: number | null, valor: number, over: Partial<VendaPlanilha> = {}): VendaPlanilha =>
    ({ nome: 'Ana Souza', telefone: '34999990001', cidade: '', uf: '', valor, codigo, data: '2026-10-20', ...over });
  const fontes = (over: Partial<FontesDeValor> = {}): FontesDeValor => ({
    ticket: 10000, ehEletro: ehOrigemEletroposto, planilha: { ok: true, vendas: [], teto: 33000 },
    codigosDoCard: new Map(), valorDaProposta: new Map(), cards: [], agora: Date.parse('2026-11-03T12:00:00Z'), ...over,
  });
  const card = (id = 5, over: Record<string, unknown> = {}) => ag(id, 'fechou', { cliente_nome: 'Ana Souza', cliente_telefone: '34999990001', ...over });
  const ticket = { valor: 10000, origem: 'ticket' };

  it('o mesmo código: o valor da linha da planilha', () => {
    const f = fontes({ planilha: { ok: true, teto: 33000, vendas: [venda(65, 18500), venda(66, 9000)] }, codigosDoCard: new Map([[5, [65]]]) });
    expect(valorDaVenda(card(5), f)).toEqual({ valor: 18500, origem: 'planilha_codigo' });
  });
  it('o código manda mesmo com outro card no mesmo telefone (pai e filho)', () => {
    const vendas = [venda(65, 18500), venda(66, 9000, { nome: 'Cristiano' })];
    const f = fontes({ planilha: { ok: true, teto: 33000, vendas }, codigosDoCard: new Map([[5, [65]], [6, [66]]]) });
    expect(valorDaVenda(card(6, { cliente_nome: 'Cristiano Silva' }), f)).toEqual({ valor: 9000, origem: 'planilha_codigo' });
  });
  it('acima do teto vale o teto (planilha e proposta)', () => {
    const f = fontes({ planilha: { ok: true, teto: 33000, vendas: [venda(65, 380000)] }, codigosDoCard: new Map([[5, [65]]]) });
    expect(valorDaVenda(card(5), f)).toEqual({ valor: 33000, origem: 'planilha_codigo' });
    expect(valorDaVenda(card(7), fontes({ valorDaProposta: new Map([[7, 90000]]) }))).toEqual({ valor: 33000, origem: 'proposta' });
  });
  it('sem planilha lida (nula, fora do ar ou sem teto) é ticket, mesmo com código e proposta', () => {
    const extra = { codigosDoCard: new Map([[5, [65]]]), valorDaProposta: new Map([[5, 18000]]) };
    expect(valorDaVenda(card(5), fontes({ ...extra, planilha: null }))).toEqual(ticket);
    expect(valorDaVenda(card(5), fontes({ ...extra, planilha: { ok: false, vendas: [venda(65, 18500)], teto: 33000 } }))).toEqual(ticket);
    expect(valorDaVenda(card(5), fontes({ ...extra, planilha: { ok: true, vendas: [venda(65, 18500)], teto: null } }))).toEqual(ticket);
  });
  it('eletroposto fica no ticket do eletroposto, com qualquer fonte', () => {
    const c = eletro(5, 'fechou');
    const f = fontes({ planilha: { ok: true, teto: 33000, vendas: [venda(65, 18500)] }, codigosDoCard: new Map([[5, [65]]]), valorDaProposta: new Map([[5, 18000]]) });
    expect(valorDaVenda(c, f)).toEqual({ valor: TICKET_ELETRO, origem: 'ticket' });
  });
  it('sem código, sem proposta e sem telefone casado: ticket', () => {
    expect(valorDaVenda(card(5), fontes())).toEqual(ticket);
  });
  it('dúvida no código: dois códigos no card, linha repetida na planilha, valor zero ou negativo: ticket', () => {
    const v = (vendas: VendaPlanilha[], cod: number[]) => fontes({ planilha: { ok: true, teto: 33000, vendas }, codigosDoCard: new Map([[5, cod]]) });
    expect(valorDaVenda(card(5), v([venda(65, 18500), venda(66, 9000)], [65, 66]))).toEqual(ticket);
    expect(valorDaVenda(card(5), v([venda(65, 18500), venda(65, 9000)], [65]))).toEqual(ticket);
    expect(valorDaVenda(card(5), v([venda(65, 0)], [65]))).toEqual(ticket);
    expect(valorDaVenda(card(5), v([venda(65, -300)], [65]))).toEqual(ticket);
  });
  it('código ligado e ainda sem linha na planilha: cai na proposta, e sem ela fica no ticket (não vai pelo telefone)', () => {
    const base = { planilha: { ok: true, teto: 33000, vendas: [venda(null, 7000)] }, codigosDoCard: new Map([[5, [65]]]), cards: [card(5)] };
    expect(valorDaVenda(card(5), fontes({ ...base, valorDaProposta: new Map([[5, 21000]]) }))).toEqual({ valor: 21000, origem: 'proposta' });
    expect(valorDaVenda(card(5), fontes(base))).toEqual(ticket);
  });
  it('o piso: valor digitado sem o milhar (145 por 145.000) ou 0,01 vira ticket nos três caminhos', () => {
    expect(pisoDoValor(33000, 10000)).toBe(33000 / DIVISOR_PISO_DO_TETO); // 1100
    expect(pisoDoValor(null, 10000)).toBe(10000 / DIVISOR_PISO_DO_TICKET); // 1000
    expect(DIVISOR_PISO_DO_TETO).toBe(30);
    expect(DIVISOR_PISO_DO_TICKET).toBe(10);
    const porCodigo = (v: number) => valorDaVenda(card(5), fontes({ planilha: { ok: true, teto: 33000, vendas: [venda(65, v)] }, codigosDoCard: new Map([[5, [65]]]) }));
    const porProposta = (v: number) => valorDaVenda(card(5), fontes({ valorDaProposta: new Map([[5, v]]) }));
    const porTelefone = (v: number) => valorDaVenda(card(5), fontes({ planilha: { ok: true, teto: 33000, vendas: [venda(70, v)] }, cards: [card(5)] }));
    for (const por of [porCodigo, porProposta, porTelefone]) {
      expect(por(145)).toEqual(ticket);
      expect(por(0.01)).toEqual(ticket);
      expect(por(1099)).toEqual(ticket);
      expect(por(1100).origem).not.toBe('ticket'); // logo no piso: vale
      expect(por(1100).valor).toBe(1100);
      expect(por(1200).valor).toBe(1200); // logo acima do piso
    }
  });
  it('proposta com valor zero ou negativo: ticket', () => {
    expect(valorDaVenda(card(5), fontes({ valorDaProposta: new Map([[5, 0]]) }))).toEqual(ticket);
    expect(valorDaVenda(card(5), fontes({ valorDaProposta: new Map([[5, -10]]) }))).toEqual(ticket);
  });

  describe('pelo telefone (só com todas as travas)', () => {
    const tel = (vendas: VendaPlanilha[], cards: any[] = [card(5)], over: Partial<FontesDeValor> = {}) =>
      fontes({ planilha: { ok: true, teto: 33000, vendas }, cards, ...over });
    it('uma venda recente, um card fechado e nome compatível: o valor', () => {
      expect(valorDaVenda(card(5), tel([venda(70, 15000)]))).toEqual({ valor: 15000, origem: 'planilha_telefone' });
    });
    it('duas vendas no mesmo telefone: ticket', () => {
      expect(valorDaVenda(card(5), tel([venda(70, 15000), venda(71, 8000)]))).toEqual(ticket);
    });
    it('dois cards fechados no mesmo telefone (família): ticket', () => {
      const outro = ag(9, 'fechou', { cliente_nome: 'Ana Souza Filho', cliente_telefone: '34999990001' });
      expect(valorDaVenda(card(5), tel([venda(70, 15000)], [card(5), outro]))).toEqual(ticket);
    });
    it('pai e filho no mesmo número: o nome do outro não escolhe valor', () => {
      const pai = card(5, { cliente_nome: 'Hermantino Silva' });
      expect(valorDaVenda(pai, tel([venda(70, 15000, { nome: 'Cristiano' })], [pai]))).toEqual(ticket);
    });
    it('venda antiga, sem data ou de outro card: ticket', () => {
      expect(valorDaVenda(card(5), tel([venda(70, 15000, { data: '2026-05-01' })]))).toEqual(ticket);
      expect(valorDaVenda(card(5), tel([venda(70, 15000, { data: null })]))).toEqual(ticket);
      expect(valorDaVenda(card(5), tel([venda(70, 15000)], [card(5)], { codigosDoCard: new Map([[99, [70]]]) }))).toEqual(ticket);
    });
    it('o sufixo do nome impede o telefone: o pai não pega o valor do filho', () => {
      const pai = card(5, { cliente_nome: 'Hermantino Silva' });
      expect(valorDaVenda(pai, tel([venda(70, 15000, { nome: 'Hermantino Silva Filho' })], [pai]))).toEqual(ticket);
    });
    it('a janela de venda recente é de 60 dias', () => {
      expect(JANELA_VENDA_RECENTE_DIAS).toBe(60);
    });
  });
});

describe('peças da leitura da planilha', () => {
  it('o número do código e a data da venda', () => {
    expect(numeroDoCodigoSolar('#0065')).toBe(65);
    expect(numeroDoCodigoSolar('65')).toBe(65);
    expect(numeroDoCodigoSolar('#E001')).toBeNull();
    expect(dataDaPlanilha('25/10/2026')).toBe('2026-10-25');
    expect(dataDaPlanilha('2026-10-25')).toBe('2026-10-25');
    expect(dataDaPlanilha('31/02/2026')).toBeNull();
    expect(dataDaPlanilha('')).toBeNull();
  });
  it('nomes compatíveis: igual, ou duas palavras em comum, sem partículas e com o mesmo sufixo', () => {
    expect(nomesCompativeis('Ana Souza', 'ana souza')).toBe(true);
    expect(nomesCompativeis('José da Silva', 'Jose Silva')).toBe(true); // a partícula não conta
    expect(nomesCompativeis('Ana Maria Souza', 'Ana Souza')).toBe(true); // duas palavras em comum
    expect(nomesCompativeis('Ana', 'Ana Souza')).toBe(false); // só o primeiro nome não basta
    expect(nomesCompativeis('Ana Lima', 'Ana Souza')).toBe(false); // uma palavra só em comum
    expect(nomesCompativeis('Cristiano', 'Hermantino Silva')).toBe(false);
    expect(nomesCompativeis('', 'Ana Souza')).toBe(false);
  });
  it('o sufixo marca outra pessoa: Hermantino Silva x Hermantino Silva Filho é incompatível', () => {
    expect(nomesCompativeis('Hermantino Silva', 'Hermantino Silva Filho')).toBe(false);
    expect(nomesCompativeis('Hermantino Silva Filho', 'Hermantino Silva')).toBe(false);
    expect(nomesCompativeis('Hermantino Silva Jr', 'Hermantino Silva Junior')).toBe(false);
    expect(nomesCompativeis('Hermantino Silva Filho', 'hermantino silva filho')).toBe(true);
    expect(nomesCompativeis('Cristiano Souza Neto', 'Cristiano Neto Souza Lima')).toBe(true);
  });
  it('lerPlanilha devolve código, data e o teto de 3× a mediana', () => {
    const cab = ['J49', 'NOME CLIENTE', 'CONTATO', 'CIDADE', 'UF', 'VALOR DA VENDA', 'CADASTRO TRELLO'];
    const l = (cod: string, valor: string, data: string) => [cod, 'Ana', '34999990001', 'Uberlândia', 'MG', valor, data];
    const r = lerPlanilha([cab, l('#0065', 'R$ 10.000,00', '20/10/2026'), l('#66', 'R$ 10.000,00', ''), l('#67', 'R$ 380.000,00', '')]);
    expect(r.vendas.map(v => [v.codigo, v.data])).toEqual([[65, '2026-10-20'], [66, null], [67, null]]);
    expect(r.teto).toBe(30000);
    expect(r.vendas[2].valor).toBe(30000);
  });
});

describe('Purchase do solar com o valor real', () => {
  const comPurchase = () => { base(0); marcar(); tabelas.capi_conversoes_enviadas = [{ lead_id: 'ag_999', event_name: 'ClienteQuente' }]; };
  const venda = () => eventosEnviados().find(c => c.corpo.data[0].event_name === 'Purchase')!.corpo.data[0];

  it('card ligado ao código da planilha: o valor da linha e a origem no dedup', async () => {
    comPurchase();
    tabelas.agendamentos = [ag(3, 'fechou')];
    fontesFalsas.codigosDoCard.set(3, [2]); // a linha #2 da planilha vale R$ 13.010
    const r = await run();
    expect(r.eventos.enviados).toBe(1);
    expect(venda().custom_data.value).toBe(13010);
    expect(dedup()[0]).toMatchObject({ lead_id: 'ag_3', event_name: 'Purchase', valor: 13010, origem: 'quente:solar:fechou:planilha_codigo' });
  });
  it('proposta ligada: o valor da proposta', async () => {
    comPurchase();
    tabelas.agendamentos = [ag(3, 'fechou')];
    fontesFalsas.valorDaProposta.set(3, 18200);
    await run();
    expect(venda().custom_data.value).toBe(18200);
    expect(dedup()[0]).toMatchObject({ valor: 18200, origem: 'quente:solar:fechou:proposta' });
  });
  it('sem fonte: o ticket de sempre e a origem sem sufixo', async () => {
    comPurchase();
    tabelas.agendamentos = [ag(3, 'fechou')];
    await run();
    expect(venda().custom_data.value).toBe(10000);
    expect(dedup()[0]).toMatchObject({ valor: 10000, origem: 'quente:solar:fechou' });
  });
  it('planilha fora do ar: ticket padrão, mesmo com código ligado', async () => {
    comPurchase();
    planilhaOk = false;
    tabelas.agendamentos = [ag(3, 'fechou')];
    fontesFalsas.codigosDoCard.set(3, [2]);
    await run();
    expect(venda().custom_data.value).toBe(20000);
    expect(dedup()[0].origem).toBe('quente:solar:fechou');
  });
  it('leitura das fontes travada: passa de 20 s, loga uma linha e o Purchase sai com o ticket', async () => {
    comPurchase();
    tabelas.agendamentos = [ag(3, 'fechou')];
    fontesTravadas = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const p = run();
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(2000);
      const r = await p;
      expect(r.eventos.enviados).toBe(1);
      expect(venda().custom_data.value).toBe(10000);
      expect(dedup()[0].origem).toBe('quente:solar:fechou');
      const { logger } = await import('../utils/logger');
      expect((logger.warn as any).mock.calls.filter((c: any[]) => /passaram de 20 s/.test(String(c[1])))).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('dry: devolve o valor e a origem de cada Purchase do solar, sem enviar nem gravar', async () => {
    comPurchase();
    tabelas.agendamentos = [ag(3, 'fechou'), ag(4, 'fechou'), eletro(5, 'fechou'), ag(6, 'fez_orcamento')];
    fontesFalsas.codigosDoCard.set(3, [2]);
    const r = await run({ dry: true });
    expect(r.eventos.valoresDosPurchases).toEqual([
      { card: 'ag_3', valor: 13010, origem: 'planilha_codigo' },
      { card: 'ag_4', valor: 10000, origem: 'ticket' },
    ]);
    expect(r.eventos.aEnviar).toBe(4);
    expect(eventosEnviados()).toHaveLength(0);
    expect(dedup()).toHaveLength(0);
  });
  it('eletroposto e ClienteQuente não mudam de valor', async () => {
    comPurchase();
    tabelas.agendamentos = [eletro(2, 'fechou'), ag(1, 'fez_orcamento')];
    fontesFalsas.codigosDoCard.set(2, [2]); fontesFalsas.codigosDoCard.set(1, [2]);
    await run();
    const ev = Object.fromEntries(eventosEnviados().map(c => [c.corpo.data[0].event_id, c.corpo.data[0]]));
    expect(ev.venda_ag_2.custom_data.value).toBe(TICKET_ELETRO);
    expect(ev.quente_ag_1.custom_data.value).toBe(3500);
  });
});
