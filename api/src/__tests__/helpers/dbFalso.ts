// Supabase falso com estado em memória, para os testes de acesso e de compra.
//
// Não é um mock "sempre devolve null": guarda linhas de verdade e responde aos filtros que o código usa
// (eq, neq, not, in, gt, limit, single, maybeSingle, insert, upsert, update, delete), respeita o UNIQUE de
// users.email e o de kit_pedidos.order_id. Dá para simular uma coluna que não existe (migration atrasada) e
// uma tabela que quebra (relation does not exist), que são os dois jeitos de uma leitura falhar em produção.
//
// Os testes importam `db` e `limpar` daqui e instalam `supabaseFalso` com vi.mock('../utils/supabase').

type Row = Record<string, any>;

export const db: Record<string, Row[]> = {};
const emails = new Set<string>();
export const falhas = {
  /** colunas que "não existem": select que cita uma delas volta com erro 42703. */
  colunaAusente: new Set<string>(),
  /** tabelas que "não existem": qualquer consulta volta com erro 42P01. */
  tabelaQuebrada: new Set<string>(),
  /** tabelas que "caem" por um instante (timeout, rede): qualquer consulta volta com erro 57014, que nao e de schema. */
  tabelaInstavel: new Set<string>(),
  /** tabelas em que SO o insert/upsert volta com erro, com o code dado (ex.: 23514, violacao de CHECK). */
  erroInsercao: new Map<string, string>(),
  /** tabelas em que SÓ o select filtrado por e-mail (eq 'email') volta com erro: uma piscada de leitura. */
  leituraPorEmailQuebrada: new Set<string>(),
};

let contador = 0;
export function novoId(prefixo = 'id'): string {
  contador += 1;
  return `${prefixo}-${contador}`;
}

export function limpar(...tabelas: string[]): void {
  for (const k of Object.keys(db)) delete db[k];
  for (const t of tabelas) db[t] = [];
  emails.clear();
  falhas.colunaAusente.clear();
  falhas.tabelaQuebrada.clear();
  falhas.tabelaInstavel.clear();
  falhas.erroInsercao.clear();
  falhas.leituraPorEmailQuebrada.clear();
}

/** Insere direto no estado (semente de teste), respeitando o e-mail único de users. */
export function semear(tabela: string, row: Row): Row {
  db[tabela] = db[tabela] ?? [];
  const linha: Row = { id: novoId(tabela), ...row };
  if (tabela === 'users') emails.add(String(linha.email || '').toLowerCase());
  db[tabela].push(linha);
  return linha;
}

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let onConflict = '';
  let ignorarDuplicata = false;
  let colunas = '';
  let teto = Infinity;
  const colunasEq = new Set<string>();

  const linhas = () => (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (falhas.tabelaQuebrada.has(table)) {
      return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
    }
    if (falhas.tabelaInstavel.has(table)) {
      return { data: null, error: { code: '57014', message: `timeout em ${table}` } };
    }
    if (modo === 'select' && falhas.leituraPorEmailQuebrada.has(table) && colunasEq.has('email')) {
      return { data: null, error: { code: '57014', message: `leitura de ${table} por e-mail piscou` } };
    }
    for (const c of falhas.colunaAusente) {
      if (modo === 'select' && new RegExp(`(^|[\\s,])${c}($|[\\s,])`).test(colunas)) {
        return { data: null, error: { code: '42703', message: `column ${table}.${c} does not exist` } };
      }
    }
    if ((modo === 'insert' || modo === 'upsert') && falhas.erroInsercao.has(table)) {
      return { data: null, error: { code: falhas.erroInsercao.get(table), message: `erro ${falhas.erroInsercao.get(table)} em ${table}` } };
    }
    if (modo === 'insert' || modo === 'upsert') {
      const row = { ...pendente! };
      if (modo === 'upsert' && onConflict) {
        const existente = (db[table] ?? []).find((r) => r[onConflict] === row[onConflict]);
        if (existente && ignorarDuplicata) return { data: null, error: null };
        if (existente) {
          Object.assign(existente, row);
          return { data: existente, error: null };
        }
      }
      // system_state.key é a chave primária: insert repetido volta 23505 (é o "claim só de inserção" do código).
      if (table === 'system_state' && modo === 'insert' && (db[table] ?? []).some((r) => r.key === row.key)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      if (table === 'users') {
        const email = String(row.email || '').toLowerCase();
        if (emails.has(email)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        emails.add(email);
      }
      row.id = row.id || novoId(table);
      row.criado_em = row.criado_em || new Date().toISOString();
      db[table] = db[table] ?? [];
      db[table].push(row);
      return { data: row, error: null };
    }
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos, error: null };
    }
    if (modo === 'delete') {
      const alvos = new Set(linhas());
      db[table] = (db[table] ?? []).filter((r) => !alvos.has(r));
      return { data: null, error: null };
    }
    // Cópia rasa: a rede devolve JSON, não referência.
    return { data: linhas().slice(0, teto).map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: (cols?: string) => { colunas = cols ?? ''; return q; },
    insert: (row: Row) => { modo = 'insert'; pendente = row; return q; },
    upsert: (row: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      modo = 'upsert'; pendente = row; onConflict = opts?.onConflict || ''; ignorarDuplicata = !!opts?.ignoreDuplicates; return q;
    },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (col: string, val: any) => { colunasEq.add(col); filtros.push((r) => String(r[col]) === String(val)); return q; },
    neq: (col: string, val: any) => { filtros.push((r) => String(r[col]) !== String(val)); return q; },
    is: (col: string, val: any) => { filtros.push((r) => (val === null ? r[col] == null : r[col] === val)); return q; },
    in: (col: string, vals: any[]) => { filtros.push((r) => vals.map(String).includes(String(r[col]))); return q; },
    not: (col: string, op: string, val: any) => {
      if (op === 'is') filtros.push((r) => (val === null ? r[col] != null : r[col] !== val));
      else if (op === 'eq') filtros.push((r) => String(r[col]) !== String(val));
      return q;
    },
    gt: (col: string, val: any) => { filtros.push((r) => r[col] != null && String(r[col]) > String(val)); return q; },
    limit: (n: number) => { teto = n; return q; },
    order: () => q,
    maybeSingle: async () => {
      const { data, error } = executa();
      return { data: Array.isArray(data) ? data[0] ?? null : data, error };
    },
    single: async () => {
      const { data, error } = executa();
      const linha = Array.isArray(data) ? data[0] ?? null : data;
      return { data: linha, error: error ?? (linha ? null : { code: 'PGRST116', message: 'no rows' }) };
    },
    then: (resolve: (v: any) => void, rejeita?: (e: any) => void) => {
      try { resolve(executa()); } catch (e) { if (rejeita) rejeita(e); else throw e; }
    },
  };
  return q;
}

export const supabaseFalso = { from: (t: string) => query(t) };
