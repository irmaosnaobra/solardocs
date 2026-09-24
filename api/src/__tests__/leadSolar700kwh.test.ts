import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regra do Thiago (12/08/2026): lead SOLAR só vai pro Thiago ou pro Diego acima
// de 700 kWh/mês; abaixo disso pula pra Nilce. É uma regra de DINHEIRO e de
// agenda (a manhã dos dois é o recurso escasso — a tarde deles é do eletroposto),
// e ela quebra em silêncio: ninguém "vê" um lead de R$ 300 que foi parar no
// sócio. Por isso está travada aqui, com as faixas REAIS dos formulários no ar:
//   • Meta Lead Ads pergunta em kWh   → "500 a 700", "700 a 900", "+ 1200"
//   • DM/ManyChat e /simular em REAIS → "R$ 400 a R$ 800", "Mais de R$ 1.500"

type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  agendamentos: [], agenda_bloqueios: [], cidades_atendimento: [],
  leads_meta: [], leads_meta_state: [{ id: 1, rodizio_idx: 0 }],
};
let seqId = 1;

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'update' = 'select';
  let patch: Row | null = null;
  let pendente: Row[] = [];

  const linhas = () => db[table].filter(r => filtros.every(f => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'update') {
      const alvo = linhas();
      alvo.forEach(r => Object.assign(r, patch));
      return { data: alvo, error: null };
    }
    if (modo === 'insert') {
      const inseridas = pendente.map(p => { const row = { id: seqId++, ...p }; db[table].push(row); return row; });
      return { data: inseridas, error: null };
    }
    return { data: linhas(), error: null };
  }

  const api: any = {
    select() { return api; },
    insert(v: Row | Row[]) { modo = 'insert'; pendente = Array.isArray(v) ? v : [v]; return api; },
    update(v: Row) { modo = 'update'; patch = v; return api; },
    eq(col: string, val: any) { filtros.push(r => r[col] === val); return api; },
    neq(col: string, val: any) { filtros.push(r => r[col] !== val); return api; },
    in(col: string, vals: any[]) { filtros.push(r => vals.includes(r[col])); return api; },
    gte(col: string, val: any) { filtros.push(r => String(r[col] ?? '') >= String(val)); return api; },
    lte(col: string, val: any) { filtros.push(r => String(r[col] ?? '') <= String(val)); return api; },
    ilike(col: string, padrao: string) {
      const alvo = padrao.replace(/%/g, '');
      filtros.push(r => String(r[col] ?? '').includes(alvo));
      return api;
    },
    order() { return api; },
    limit() { return api; },
    single() { const r = executa(); return { data: (r.data || [])[0] ?? null, error: r.error }; },
    then(resolve: any) { return Promise.resolve(executa()).then(resolve); },
  };
  return api;
}

vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => query(t) } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue({}) }));

import { consumoTipico, ehContaAlta, consumoDaFicha, FieldItem } from '../services/agenda/leadSolarFicha';
import { ingestManychatLead } from '../services/agenda/manychatLeadService';

// DDD 34 = área de atendimento (não depende da tabela de cidades).
let telSeq = 0;
const novoTel = () => '5534988' + String(100000 + (++telSeq)).slice(-6);

async function leadSolar(valorConta: string, tel = novoTel()) {
  const r = await ingestManychatLead({
    produto: 'solar', nome: 'Cliente Teste', whatsapp: tel,
    cidade: 'Uberlândia-MG', valor_conta: valorConta, contact_id: 'ct' + tel,
  });
  return { consultor: r.consultor, tel };
}

beforeEach(() => {
  db.agendamentos = []; db.agenda_bloqueios = []; db.cidades_atendimento = [];
  db.leads_meta = []; db.leads_meta_state = [{ id: 1, rodizio_idx: 0 }];
  seqId = 1;
});

describe('consumo típico da faixa respondida', () => {
  // Faixa fechada = MEIO da faixa. É o único critério que acerta nas duas
  // unidades: pelo teto "R$ 400 a R$ 800" viraria conta alta (≈762 kWh) e pelo
  // piso "700 a 900" viraria conta baixa.
  const casos: Array<[string, 'kwh' | 'reais', boolean]> = [
    ['- 500',              'kwh',   false],
    ['500 a 700',          'kwh',   false],   // meio 600 → Nilce
    ['700 a 900',          'kwh',   true],    // meio 800 → sócios
    ['+ 1200',             'kwh',   true],
    ['acima de 1000 kWh',  'kwh',   true],
    ['800',                'kwh',   true],    // resposta exata
    ['700',                'kwh',   false],   // o corte é ACIMA de 700
    ['',                   'kwh',   false],   // não respondeu → Nilce
    ['- 300,00',           'kwh',   false],   // respostas com centavos existem no form
    ['R$ 900,00',          'reais', true],    // ",00" não pode virar faixa "900 a 0"
    ['300 ~ 600',          'kwh',   false],   // outro form usa ~ no lugar de "a"
    ['600 ~1000',          'kwh',   true],
    ['mais_de_r$1.100',    'kwh',   true],    // form que pergunta em R$ com nome de kWh
    ['Até R$ 200',         'reais', false],
    ['R$ 200 a R$ 400',    'reais', false],
    ['R$ 400 a R$ 800',    'reais', false],   // meio R$ 600 ≈ 571 kWh → Nilce
    ['R$ 800 a R$ 1.500',  'reais', true],    // meio R$ 1.150 ≈ 1095 kWh → sócios
    ['Mais de R$ 1.500',   'reais', true],
    ['',                   'reais', false],
  ];
  it.each(casos)('%s (%s) → conta alta = %s', (valor, unidade, esperado) => {
    expect(ehContaAlta(valor, unidade)).toBe(esperado);
  });

  it('reais viram kWh pela tarifa (R$ 735 ≈ o corte de 700 kWh)', () => {
    expect(Math.round(consumoTipico('735', 'reais'))).toBe(700);
    expect(consumoTipico('735', 'kwh')).toBe(735);   // mesma string, outra unidade
  });
});

describe('lead do Meta Lead Ads: a ficha que chega de verdade', () => {
  // O cron do Meta é onde mora o volume. Ele não lê a string solta: lê o campo
  // "Consumo" DEPOIS que a ficha é organizada — e um dos formulários no ar tem
  // um campo "Aumentar Consumo" (resposta "Sim"/"Não") que, se vazasse pro slot
  // errado, roteava todo mundo pela palavra errada.
  const fichaMeta = (consumo: string, nomeDoCampo = 'Consumo'): FieldItem[] => [
    { name: 'first_name', values: ['Cliente'] },
    { name: 'whatsapp_number', values: ['5534988110000'] },
    { name: 'Aumentar Consumo', values: ['Sim'] },
    { name: nomeDoCampo, values: [consumo] },
    { name: 'Qual o melhor horário', values: ['manhã'] },
  ];
  const kwhDoLead = (fields: FieldItem[]) => consumoTipico(consumoDaFicha(fields), 'kwh');

  it.each([
    ['- 500', false], ['500 a 700', false], ['300 ~ 600', false], ['- 300,00', false],
    ['700 a 900', true], ['900 a 1200', true], ['+ 1200', true], ['600 ~1000', true],
  ] as Array<[string, boolean]>)('resposta "%s" → conta alta = %s', (resp, esperado) => {
    expect(kwhDoLead(fichaMeta(resp)) > 700).toBe(esperado);
  });

  it('"Aumentar Consumo: Sim" não é lido como consumo', () => {
    const so_aumentar: FieldItem[] = [
      { name: 'first_name', values: ['Cliente'] },
      { name: 'Aumentar Consumo', values: ['Sim'] },
    ];
    expect(consumoDaFicha(so_aumentar)).toBe('');   // sem consumo → Nilce
    expect(kwhDoLead(so_aumentar)).toBe(0);
  });

  it('formulário com nome comprido de campo também é lido', () => {
    const fields = fichaMeta('700 a 900', 'qual_seu_consumo_médio_de_energia_(conta_de_luz)?');
    expect(kwhDoLead(fields)).toBe(800);
  });
});

describe('lead de DM/formulário: quem recebe o card', () => {
  it('conta baixa vai pra Nilce e NÃO gasta a vez do rodízio', async () => {
    expect((await leadSolar('R$ 200 a R$ 400')).consultor).toBe('Nilce');
    expect((await leadSolar('R$ 400 a R$ 800')).consultor).toBe('Nilce');
    expect(db.leads_meta_state[0].rodizio_idx).toBe(0);
    // o card gravado é dela mesmo, não só a resposta da API
    expect(db.agendamentos.map(a => a.vendedor_nome)).toEqual(['Nilce', 'Nilce']);
  });

  it('sem faixa respondida também é da Nilce (não gasta manhã de sócio no escuro)', async () => {
    expect((await leadSolar('')).consultor).toBe('Nilce');
  });

  it('conta alta alterna Thiago → Diego → Thiago', async () => {
    expect((await leadSolar('R$ 800 a R$ 1.500')).consultor).toBe('Thiago');
    expect((await leadSolar('Mais de R$ 1.500')).consultor).toBe('Diego');
    expect((await leadSolar('R$ 800 a R$ 1.500')).consultor).toBe('Thiago');
    expect(db.leads_meta_state[0].rodizio_idx).toBe(3);
  });

  it('lead pequeno no meio não desalinha o rodízio dos sócios', async () => {
    expect((await leadSolar('Mais de R$ 1.500')).consultor).toBe('Thiago');
    await leadSolar('Até R$ 200');            // Nilce, não gira nada
    await leadSolar('R$ 400 a R$ 800');       // Nilce, não gira nada
    expect((await leadSolar('Mais de R$ 1.500')).consultor).toBe('Diego');
  });

  it('1 telefone = 1 consultor continua mandando mais que o tamanho da conta', async () => {
    const { tel } = await leadSolar('Mais de R$ 1.500');          // vira card do Thiago
    db.leads_meta = [];                                           // ManyChat manda de novo (lead_id repete)
    const volta = await ingestManychatLead({
      produto: 'solar', nome: 'Cliente Teste', whatsapp: tel,
      cidade: 'Uberlândia-MG', valor_conta: 'Até R$ 200', contact_id: 'outro' + tel,
    });
    expect(volta.consultor).toBe('Thiago');   // conta caiu, mas o cliente é dele
  });

  it('dry-run mostra o roteamento de verdade, sem gravar', async () => {
    const r = await ingestManychatLead({
      produto: 'solar', nome: 'Cliente Teste', whatsapp: novoTel(),
      cidade: 'Uberlândia-MG', valor_conta: 'R$ 200 a R$ 400', test: true,
    });
    expect(r.consultor).toBe('Nilce');
    expect(db.agendamentos).toHaveLength(0);
    expect(db.leads_meta_state[0].rodizio_idx).toBe(0);
  });
});
