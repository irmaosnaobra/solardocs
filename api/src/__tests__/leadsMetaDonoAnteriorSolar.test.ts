import { describe, it, expect, vi, beforeEach } from 'vitest';

// 23/11/2026: o lead solar é dividido por conta de luz. Na porta do FORMULÁRIO DO META, o dono anterior do telefone vale para os
// quatro (a Giovanna volta a ser dona de solar: `donoQueAindaAtendeSolar`), e o lead NOVO vai para quem a divisão apontar
// (Nilce e Giovanna abaixo de R$ 800; Nilce, Thiago e Diego de R$ 800 para cima), pelo déficit da fatia nos últimos 30 dias.

const h = vi.hoisted(() => {
  process.env.META_SYSTEM_USER_TOKEN = 'token-de-teste';
  return { leadsDoForm: [] as any[] };
});

type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  agendamentos: [], agenda_bloqueios: [], cidades_atendimento: [], leads_meta: [],
  leads_meta_state: [{ id: 1, rodizio_idx: 0, cutoff_time: '2026-10-01T00:00:00.000Z' }],
};
let seqId = 1;

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'update' = 'select';
  let patch: Row | null = null;
  let pendente: Row[] = [];
  const linhas = () => (db[table] ??= []).filter(r => filtros.every(f => f(r)));
  function executa(): { data: any; error: any } {
    if (modo === 'update') { const alvo = linhas(); alvo.forEach(r => Object.assign(r, patch)); return { data: alvo, error: null }; }
    if (modo === 'insert') {
      const novas = pendente.map(p => { const row = { id: seqId++, ...p }; (db[table] ??= []).push(row); return row; });
      return { data: novas, error: null };
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
    not() { return api; },
    gte(col: string, val: any) { filtros.push(r => String(r[col] ?? '') >= String(val)); return api; },
    lte(col: string, val: any) { filtros.push(r => String(r[col] ?? '') <= String(val)); return api; },
    ilike(col: string, padrao: string) { const alvo = padrao.replace(/%/g, ''); filtros.push(r => String(r[col] ?? '').includes(alvo)); return api; },
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
vi.mock('../utils/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ ilike: () => ({ data: [], error: null }) }) }) }) },
}));
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  carregarBloqueados: vi.fn().mockResolvedValue(() => false),
}));
vi.mock('../services/agentes5040/chaves', () => ({ fichaSubstituiAviso: vi.fn().mockResolvedValue(true) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { syncLeadsMeta } from '../services/agenda/leadsMetaService';
import { _limparCacheDivisao } from '../services/agenda/divisaoSolar';

const TEL_CLIENTE = '5534988777001';

const leadDoForm = (id: string, tel: string, consumo: string) => ({
  id, created_time: '2026-10-25T12:00:00+0000',
  field_data: [
    { name: 'full_name', values: ['Cliente Teste'] },
    { name: 'phone_number', values: [tel] },
    { name: 'city', values: ['Uberlândia-MG'] },
    { name: 'qual_seu_consumo_médio_de_energia_(conta_de_luz)?', values: [consumo] },
  ],
});

beforeEach(() => {
  _limparCacheDivisao();
  delete process.env.SOLAR_DIVISAO_OFF;
  db.agendamentos = []; db.agenda_bloqueios = []; db.cidades_atendimento = []; db.leads_meta = [];
  db.leads_meta_state = [{ id: 1, rodizio_idx: 0, cutoff_time: '2026-10-01T00:00:00.000Z' }];
  seqId = 1;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const corpo = u.includes('fields=access_token') ? { access_token: 'pt' }
      : u.includes('/leadgen_forms') ? { data: [{ id: 'form1', status: 'ACTIVE' }] }
      : u.includes('/leads') ? { data: h.leadsDoForm }
      : {};
    return { json: async () => corpo } as Response;
  }));
});

/** Roda o sync com um cliente que JÁ tem card de `donoAnterior` e devolve o consultor do card novo. */
async function consultorDoCardNovo(donoAnterior: string, consumo: string): Promise<string | null> {
  db.agendamentos = [{ id: 500, vendedor_nome: donoAnterior, cliente_telefone: TEL_CLIENTE, quando: '2026-10-10T12:00:00.000Z', status: 'agendado' }];
  seqId = 600;
  h.leadsDoForm = [leadDoForm('lead-1', TEL_CLIENTE, consumo)];
  const r = await syncLeadsMeta();
  expect(r.erros).toBe(0);
  expect(r.agendados).toBe(1);
  const novo = db.agendamentos.find(a => a.id !== 500);
  expect(db.leads_meta[0]?.consultor).toBe(novo?.vendedor_nome);
  return novo?.vendedor_nome ?? null;
}

/** Um card de solar que já existe (para o déficit): origem do Meta, com a resposta de consumo na observação. */
const cardMeta = (vendedor: string, consumo: string, id: number) => ({
  id, vendedor_nome: vendedor, cliente_telefone: `5534977${String(100000 + id)}`, quando: '2026-11-20T12:00:00.000Z', status: 'agendado',
  created_by: 'lead-meta', created_at: new Date().toISOString(), observacao: `Consumo: ${consumo}`,
});

describe('formulário do Meta: dono anterior do telefone', () => {
  it('dono anterior Giovanna volta a valer: o card novo é da Giovanna, de qualquer conta', async () => {
    expect(await consultorDoCardNovo('Giovanna', '- 500')).toBe('Giovanna');
  });

  it('o mesmo com conta alta: o dono anterior vence a divisão', async () => {
    expect(await consultorDoCardNovo('Giovanna', '+ 1200')).toBe('Giovanna');
  });

  it('dono anterior Thiago continua valendo: o card novo é do Thiago', async () => {
    expect(await consultorDoCardNovo('Thiago', '- 500')).toBe('Thiago');
  });

  it('dono anterior Nilce continua valendo: o card novo é da Nilce', async () => {
    expect(await consultorDoCardNovo('Nilce', '- 500')).toBe('Nilce');
  });
});

describe('formulário do Meta: lead novo, dividido por conta de luz', () => {
  it('conta pequena: dois leads seguidos no mesmo sync alternam Nilce e Giovanna', async () => {
    h.leadsDoForm = [leadDoForm('l1', '5534988100001', '- 500'), leadDoForm('l2', '5534988100002', '- 500'), leadDoForm('l3', '5534988100003', '- 500')];
    const r = await syncLeadsMeta();
    expect(r.agendados).toBe(3);
    expect(db.leads_meta.map(l => l.consultor)).toEqual(['Nilce', 'Giovanna', 'Nilce']);
  });

  it('conta de 1.000 kWh com o Thiago abaixo da fatia: o card é do Thiago, não do Diego nem da Nilce', async () => {
    db.agendamentos = [...[1, 2, 3].map(i => cardMeta('Nilce', '1.000 a 1.400', i)), ...[4, 5, 6].map(i => cardMeta('Diego', '1.000 a 1.400', i))];
    seqId = 700;
    h.leadsDoForm = [leadDoForm('l1', '5534988200001', '1.000 a 1.400')];
    await syncLeadsMeta();
    expect(db.leads_meta[0]?.consultor).toBe('Thiago');
  });

  it('o horário do sócio sai da grade encaixada dele (nunca 10:00 nem 11:00)', async () => {
    db.agendamentos = [...[1, 2, 3].map(i => cardMeta('Nilce', '1.000 a 1.400', i)), ...[4, 5, 6].map(i => cardMeta('Diego', '1.000 a 1.400', i))];
    seqId = 700;
    h.leadsDoForm = [leadDoForm('l1', '5534988200002', '1.000 a 1.400')];
    await syncLeadsMeta();
    const novo = db.agendamentos.find(a => a.cliente_telefone === '5534988200002')!;
    expect(novo.vendedor_nome).toBe('Thiago');
    const hhmm = new Date(novo.quando).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    expect(['08:00', '08:30', '09:00', '09:30', '10:30', '11:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30']).toContain(hhmm);
  });

  it('com o freio SOLAR_DIVISAO_OFF=1, todo lead novo é da Nilce', async () => {
    process.env.SOLAR_DIVISAO_OFF = '1';
    h.leadsDoForm = [leadDoForm('l1', '5534988300001', '- 500'), leadDoForm('l2', '5534988300002', '+ 1200')];
    await syncLeadsMeta();
    expect(db.leads_meta.map(l => l.consultor)).toEqual(['Nilce', 'Nilce']);
  });
});
