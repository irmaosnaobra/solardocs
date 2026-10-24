import { describe, it, expect, vi, beforeEach } from 'vitest';

// 24/10/2026: só a Nilce atende solar. Na porta do FORMULÁRIO DO META, o dono
// anterior do telefone vale como sempre, EXCETO a Giovanna: o cliente dela vale
// como cliente novo e cai na Nilce (a mesma regra do quiz e do ManyChat, de
// `donoQueAindaAtendeSolar`). Thiago, Diego e Nilce seguem como hoje.

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

describe('formulário do Meta: dono anterior do telefone', () => {
  it('dono anterior Giovanna vale como sem dono: o card novo é da Nilce, de qualquer conta', async () => {
    expect(await consultorDoCardNovo('Giovanna', '- 500')).toBe('Nilce');
  });

  it('o mesmo com conta alta (que antes entrava no rodízio dos sócios)', async () => {
    expect(await consultorDoCardNovo('Giovanna', '+ 1200')).toBe('Nilce');
  });

  it('dono anterior Thiago continua valendo: o card novo é do Thiago', async () => {
    expect(await consultorDoCardNovo('Thiago', '- 500')).toBe('Thiago');
  });

  it('dono anterior Nilce continua valendo: o card novo é da Nilce', async () => {
    expect(await consultorDoCardNovo('Nilce', '- 500')).toBe('Nilce');
  });
});
