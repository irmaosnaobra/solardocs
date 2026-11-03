// Supabase falso com estado em memória, para os testes de acesso e de compra.
//
// Não é um mock "sempre devolve null": guarda linhas de verdade e responde aos filtros que o código usa
// (eq, neq, in, gt, limit, single, maybeSingle, insert, upsert, update, delete), respeita o UNIQUE de
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
  let colunas = '';
  let teto = Infinity;

  const linhas = () => (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (falhas.tabelaQuebrada.has(table)) {
      return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
    }
    for (const c of falhas.colunaAusente) {
      if (modo === 'select' && new RegExp(`(^|[\\s,])${c}($|[\\s,])`).test(colunas)) {
        return { data: null, error: { code: '42703', message: `column ${table}.${c} does not exist` } };
      }
    }
    if (modo === 'insert' || modo === 'upsert') {
      const row = { ...pendente! };
      if (modo === 'upsert' && onConflict) {
        const existente = (db[table] ?? []).find((r) => r[onConflict] === row[onConflict]);
        if (existente) {
          Object.assign(existente, row);
          return { data: existente, error: null };
        }
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
    upsert: (row: Row, opts?: { onConflict?: string }) => {
      modo = 'upsert'; pendente = row; onConflict = opts?.onConflict || ''; return q;
    },
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (col: string, val: any) => { filtros.push((r) => String(r[col]) === String(val)); return q; },
    neq: (col: string, val: any) => { filtros.push((r) => String(r[col]) !== String(val)); return q; },
    in: (col: string, vals: any[]) => { filtros.push((r) => vals.map(String).includes(String(r[col]))); return q; },
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
