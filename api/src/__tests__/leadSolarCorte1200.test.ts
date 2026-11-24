import { describe, it, expect, vi, beforeEach } from 'vitest';

// 23/11/2026, decisão do dono: o lead solar NOVO é dividido por conta de luz (services/agenda/divisaoSolar.ts). Abaixo de R$ 800 (ou sem
// conta legível): Nilce 50% e Giovanna 50%. De R$ 800 para cima: Nilce 40%, Thiago 30% e Diego 30%. Escolhe quem está mais abaixo da
// fatia nos últimos 30 dias e, se ele não tem horário, cai no próximo. O `rodizio_idx` não manda mais no solar. De 24/10 a 23/11 era só
// a Nilce; o rodízio 50/25/25 (Thiago, Nilce, Diego, Nilce) valeu de 23/09 a 24/10.
//
// Regra do Thiago (23/09/2026): a NILCE RECEBE TODOS. Acima de 1.200 kWh/mês o
// lead entra no rodízio da conta alta, que é 50% dela, 25% do Thiago e 25% do
// Diego; abaixo do corte é todo dela, sem passar pelo rodízio.
//
// É uma regra de DINHEIRO e de agenda (a manhã dos sócios é o recurso escasso, 
// a tarde deles é do eletroposto), e ela quebra em silêncio: ninguém "vê" um
// lead de R$ 300 que foi parar no sócio. Por isso está travada aqui, com as
// faixas REAIS dos formulários no ar:
//   • Meta Lead Ads pergunta em kWh   → "500 a 700", "700 a 900", "+ 1200"
//   • DM/ManyChat e /simular em REAIS → "R$ 400 a R$ 800", "Mais de R$ 1.500"
//
// O corte já foi 700 kWh (12/08) e R$ 800 / 762 kWh (10/09). Os casos abaixo são
// os MESMOS das duas versões anteriores, com o resultado recalculado no corte
// novo, faixa que era dos sócios e agora não é mais está marcada, porque é
// exatamente aí que uma regressão apareceria.

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
    range() { return api; },
    limit() { return api; },
    single() { const r = executa(); return { data: (r.data || [])[0] ?? null, error: r.error }; },
    then(resolve: any) { return Promise.resolve(executa()).then(resolve); },
  };
  return api;
}

vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => query(t) } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue({}) }));
// O Supabase PRINCIPAL, onde mora `whatsapp_suppression`. Ele entrou no caminho
// em 03/10/2026, quando o FORA DO PADRAO passou a barrar lead de telefone
// bloqueado antes de criar ficha. Sem este duble a checagem tenta a REDE e o
// teste estoura em 5s — e o sintoma e "timeout", que nao diz nada sobre a causa.
vi.mock('../utils/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ ilike: () => ({ data: [], error: null }) }) }),
  }) },
}));

import {
  consumoTipico, ehContaAlta, consumoDaFicha, FieldItem,
  KWH_CORTE_TIME, CONTA_CORTE_REAIS,
} from '../services/agenda/leadSolarFicha';
import { ingestManychatLead } from '../services/agenda/manychatLeadService';
import { _limparCacheDivisao } from '../services/agenda/divisaoSolar';

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
  _limparCacheDivisao();
  delete process.env.SOLAR_DIVISAO_OFF;
  db.agendamentos = []; db.agenda_bloqueios = []; db.cidades_atendimento = [];
  db.leads_meta = []; db.leads_meta_state = [{ id: 1, rodizio_idx: 0 }];
  seqId = 1;
});

describe('consumo típico da faixa respondida', () => {
  // Faixa fechada = MEIO da faixa. É o único critério que acerta nas duas
  // unidades: pelo teto "1.000 a 1.500" viraria conta alta e pelo piso também
  // viraria conta baixa, dependendo de quem responde em quê.
  const casos: Array<[string, 'kwh' | 'reais', boolean]> = [
    ['- 500',               'kwh',   false],
    ['500 a 700',           'kwh',   false],  // meio 600
    ['700 a 900',           'kwh',   false],  // meio 800, ERA dos sócios até 22/09
    ['900 a 1200',          'kwh',   false],  // meio 1050, ERA dos sócios até 22/09
    ['1200 a 1500',         'kwh',   true],   // meio 1350
    ['+ 1200',              'kwh',   true],   // piso alto → 1201
    ['acima de 1000 kWh',   'kwh',   false],  // 1001, ERA dos sócios até 22/09
    ['acima de 2000 kWh',   'kwh',   true],
    ['1500',                'kwh',   true],   // resposta exata
    ['1200',                'kwh',   false],  // o corte é ACIMA de 1.200
    ['',                    'kwh',   false],  // não respondeu → Nilce
    ['- 300,00',            'kwh',   false],  // respostas com centavos existem no form
    ['R$ 1.800,00',         'reais', true],   // ",00" não pode virar faixa "1800 a 0"
    ['300 ~ 600',           'kwh',   false],  // outro form usa ~ no lugar de "a"
    ['600 ~1000',           'kwh',   false],  // meio 800, ERA dos sócios até 22/09
    ['1300 ~1900',          'kwh',   true],
    ['mais_de_r$1.100',     'kwh',   false],  // form que pergunta em R$ com nome de kWh
    ['Até R$ 200',          'reais', false],
    ['R$ 200 a R$ 400',     'reais', false],
    ['R$ 400 a R$ 800',     'reais', false],  // meio R$ 600 ≈ 571 kWh
    ['R$ 800 a R$ 1.500',   'reais', false],  // meio R$ 1.150 ≈ 1095 kWh, ERA dos sócios
    ['R$ 1.500 a R$ 2.000', 'reais', true],   // meio R$ 1.750 ≈ 1667 kWh
    ['Mais de R$ 1.500',    'reais', true],   // piso alto ≈ 1429 kWh
    ['',                    'reais', false],
  ];
  it.each(casos)('%s (%s) → conta alta = %s', (valor, unidade, esperado) => {
    expect(ehContaAlta(valor, unidade)).toBe(esperado);
  });

  it('reais viram kWh pela tarifa (R$ 1.260 = o corte de 1.200 kWh)', () => {
    expect(Math.round(consumoTipico(String(CONTA_CORTE_REAIS), 'reais'))).toBe(KWH_CORTE_TIME);
    expect(consumoTipico('1260', 'kwh')).toBe(1260);   // mesma string, outra unidade
  });

  it('o corte é 1.200 kWh, e os reais são derivados dele', () => {
    expect(KWH_CORTE_TIME).toBe(1200);
    expect(CONTA_CORTE_REAIS).toBe(1260);
  });
});

describe('lead do Meta Lead Ads: a ficha que chega de verdade', () => {
  // O cron do Meta é onde mora o volume. Ele não lê a string solta: lê o campo
  // "Consumo" DEPOIS que a ficha é organizada, e um dos formulários no ar tem
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
    ['700 a 900', false], ['900 a 1200', false], ['600 ~1000', false],
    ['+ 1200', true], ['1200 a 1600', true], ['acima de 2000', true],
  ] as Array<[string, boolean]>)('resposta "%s" → conta alta = %s', (resp, esperado) => {
    expect(kwhDoLead(fichaMeta(resp)) > KWH_CORTE_TIME).toBe(esperado);
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
    const fields = fichaMeta('1200 a 1600', 'qual_seu_consumo_médio_de_energia_(conta_de_luz)?');
    expect(kwhDoLead(fields)).toBe(1400);
  });
});

describe('lead de DM/formulário: quem recebe o card', () => {
  /** Uma faixa de conta alta, escrita como o lead escreve. ≈1.667 kWh. */
  const ALTA = 'R$ 1.500 a R$ 2.000';
  const donosDosCards = () => db.agendamentos.map(a => a.vendedor_nome);

  it('conta baixa alterna Nilce e Giovanna e NÃO gasta a vez do rodízio', async () => {
    expect((await leadSolar('R$ 200 a R$ 400')).consultor).toBe('Nilce');
    expect((await leadSolar('R$ 400 a R$ 800')).consultor).toBe('Giovanna');
    expect((await leadSolar('R$ 400 a R$ 800')).consultor).toBe('Nilce');
    expect(db.leads_meta_state[0].rodizio_idx).toBe(0);
    // o card gravado é dela mesmo, não só a resposta da API
    expect(donosDosCards()).toEqual(['Nilce', 'Giovanna', 'Nilce']);
  });

  it('a faixa que ERA da Nilce (R$ 800 a R$ 1.500) agora é do grupo maior: Nilce, Thiago e Diego', async () => {
    expect((await leadSolar('R$ 800 a R$ 1.500')).consultor).toBe('Nilce');
    expect((await leadSolar('R$ 800 a R$ 1.500')).consultor).toBe('Thiago');
    expect((await leadSolar('R$ 800 a R$ 1.500')).consultor).toBe('Diego');
    expect(db.leads_meta_state[0].rodizio_idx).toBe(0);   // o contador não gira mais
  });

  it('exatamente R$ 800 é do grupo maior; R$ 799 é do menor', async () => {
    expect(['Nilce', 'Thiago', 'Diego']).toContain((await leadSolar('R$ 800')).consultor);
    _limparCacheDivisao();
    db.agendamentos = []; db.leads_meta = [];
    expect(['Nilce', 'Giovanna']).toContain((await leadSolar('R$ 799')).consultor);
  });

  it('sem faixa respondida é do grupo menor (não gasta manhã de sócio no escuro)', async () => {
    expect(['Nilce', 'Giovanna']).toContain((await leadSolar('')).consultor);
  });

  it('conta alta divide 40/30/30 entre Nilce, Thiago e Diego, sem Giovanna', async () => {
    const donos: string[] = [];
    for (let i = 0; i < 10; i++) donos.push((await leadSolar(ALTA)).consultor as string);
    expect(donos).not.toContain('Giovanna');
    const conta = (n: string) => donos.filter(d => d === n).length;
    expect([conta('Nilce'), conta('Thiago'), conta('Diego')]).toEqual([4, 3, 3]);
    expect(donosDosCards()).toEqual(donos);
  });

  it('o Thiago abaixo da fatia recebe o próximo lead grande', async () => {
    const ontem = new Date().toISOString();
    const card = (v: string, i: number) => ({ id: 900 + i, vendedor_nome: v, cliente_telefone: '55349800' + String(1000 + i), quando: ontem, status: 'agendado', created_by: 'manychat', created_at: ontem, observacao: 'Consumo: R$ 1.500 a R$ 2.000' });
    db.agendamentos = [card('Nilce', 1), card('Nilce', 2), card('Nilce', 3), card('Diego', 4), card('Diego', 5), card('Diego', 6)];
    expect((await leadSolar(ALTA)).consultor).toBe('Thiago');
  });

  it('sócio sem horário nos próximos 14 dias: o card passa para o próximo da lista', async () => {
    const agora = Date.now();
    db.agenda_bloqueios = [{ id: 1, vendedor_nome: 'Thiago', inicio: new Date(agora - 86_400_000).toISOString(), fim: new Date(agora + 40 * 86_400_000).toISOString() }];
    expect((await leadSolar(ALTA)).consultor).toBe('Nilce');       // a vez da Nilce
    expect((await leadSolar(ALTA)).consultor).toBe('Diego');       // a vez era do Thiago, que está sem horário: cai no Diego
    expect(db.agendamentos.map(a => a.vendedor_nome)).toEqual(['Nilce', 'Diego']);
  });

  it('1 telefone = 1 consultor continua mandando mais que o tamanho da conta', async () => {
    const { tel } = await leadSolar(ALTA);
    db.agendamentos[db.agendamentos.length - 1].vendedor_nome = 'Thiago';   // cliente que já era do Thiago
    db.leads_meta = [];                                           // ManyChat manda de novo (lead_id repete)
    const volta = await ingestManychatLead({
      produto: 'solar', nome: 'Cliente Teste', whatsapp: tel,
      cidade: 'Uberlândia-MG', valor_conta: 'Até R$ 200', contact_id: 'outro' + tel,
    });
    expect(volta.consultor).toBe('Thiago');   // conta caiu, mas o cliente é dele
  });

  // 23/11/2026: o cliente que é da Giovanna fica com a Giovanna (os quatro valem como dono anterior).
  it('dono anterior Giovanna vale: o ManyChat manda para a Giovanna, de qualquer conta', async () => {
    for (const faixa of ['Até R$ 200', 'R$ 1.500 a R$ 2.000']) {
      db.agendamentos = []; db.leads_meta = [];
      _limparCacheDivisao();
      const { tel } = await leadSolar('Até R$ 200');
      db.agendamentos[db.agendamentos.length - 1].vendedor_nome = 'Giovanna';
      db.leads_meta = [];
      const volta = await ingestManychatLead({
        produto: 'solar', nome: 'Cliente Teste', whatsapp: tel,
        cidade: 'Uberlândia-MG', valor_conta: faixa, contact_id: 'g' + faixa + tel,
      });
      expect(volta.consultor, faixa).toBe('Giovanna');
      expect(db.agendamentos[db.agendamentos.length - 1].vendedor_nome, faixa).toBe('Giovanna');
    }
  });

  it('dry-run do ManyChat mostra o dono anterior, inclusive a Giovanna', async () => {
    const { tel } = await leadSolar('Até R$ 200');
    db.agendamentos[db.agendamentos.length - 1].vendedor_nome = 'Giovanna';
    const r = await ingestManychatLead({
      produto: 'solar', nome: 'Cliente Teste', whatsapp: tel,
      cidade: 'Uberlândia-MG', valor_conta: 'R$ 1.500 a R$ 2.000', test: true,
    });
    expect(r.consultor).toBe('Giovanna');
  });

  it('dono anterior Diego continua valendo no ManyChat', async () => {
    const { tel } = await leadSolar('Até R$ 200');
    db.agendamentos[db.agendamentos.length - 1].vendedor_nome = 'Diego';
    db.leads_meta = [];
    const volta = await ingestManychatLead({
      produto: 'solar', nome: 'Cliente Teste', whatsapp: tel,
      cidade: 'Uberlândia-MG', valor_conta: 'Até R$ 200', contact_id: 'd' + tel,
    });
    expect(volta.consultor).toBe('Diego');
  });

  it('lead novo: a conta baixa nunca vai para sócio e a conta alta nunca vai para a Giovanna', async () => {
    const baixos: string[] = [];
    const altos: string[] = [];
    for (let i = 0; i < 6; i++) baixos.push((await leadSolar('R$ 400 a R$ 800')).consultor as string);
    for (let i = 0; i < 6; i++) altos.push((await leadSolar(ALTA)).consultor as string);
    expect(new Set(baixos)).toEqual(new Set(['Nilce', 'Giovanna']));
    expect(altos).not.toContain('Giovanna');
    expect(baixos).not.toContain('Thiago');
    expect(baixos).not.toContain('Diego');
  });

  it('com o freio SOLAR_DIVISAO_OFF=1 todo lead novo volta a ser da Nilce', async () => {
    process.env.SOLAR_DIVISAO_OFF = '1';
    const donos: string[] = [];
    for (const faixa of ['Até R$ 200', 'R$ 400 a R$ 800', 'R$ 800 a R$ 1.500', ALTA, '']) donos.push((await leadSolar(faixa)).consultor as string);
    expect(donos).toEqual(Array(5).fill('Nilce'));
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
