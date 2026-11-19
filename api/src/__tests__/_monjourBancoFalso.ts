// Banco falso de lp_events para os testes das rotas /admin/monjour: entende os filtros que as
// leituras usam (in, eq, not is null, gte, lt, order, range) e os campos tirados do JSON com `alias:event_data->>chave`.
export interface LinhaLp { id: number; session_id: string; event_type: string; event_data: Record<string, unknown>; created_at: string }

// `atrasoMs` faz cada página demorar, como o banco de verdade (para testar leitura que para no meio).
export const banco = { linhas: [] as LinhaLp[], consultas: [] as { colunas: string; de?: number; ate?: number }[], erro: false, atrasoMs: 0 };

let seq = 0;
export function evento(session_id: string, event_type: string, event_data: Record<string, unknown>, created_at: string): LinhaLp {
  return { id: ++seq, session_id, event_type, event_data, created_at };
}

const caminho = (col: string): string | null => (col.startsWith('event_data->>') ? col.slice('event_data->>'.length) : null);

function projetar(l: LinhaLp, colunas: string): Record<string, unknown> {
  if (!colunas.includes('->>')) return { session_id: l.session_id, event_type: l.event_type, event_data: l.event_data, created_at: l.created_at };
  const saida: Record<string, unknown> = {};
  for (const parte of colunas.split(',').map((x) => x.trim())) {
    const m = /^(\w+):event_data->>(\w+)$/.exec(parte);
    if (m) { const v = l.event_data[m[2]]; saida[m[1]] = v === undefined || v === null ? null : String(v); } else saida[parte] = (l as unknown as Record<string, unknown>)[parte];
  }
  return saida;
}

export function consultaFalsa() {
  let colunas = '';
  const filtros: ((l: LinhaLp) => boolean)[] = [];
  let desc = false;
  const valor = (l: LinhaLp, col: string): unknown => {
    const c = caminho(col);
    return c ? (l.event_data[c] === undefined ? null : String(l.event_data[c])) : (l as unknown as Record<string, unknown>)[col];
  };
  const q: Record<string, unknown> = {
    select: (c: string) => { colunas = c; return q; },
    in: (col: string, vs: unknown[]) => { filtros.push((l) => vs.includes(valor(l, col))); return q; },
    eq: (col: string, v: unknown) => { filtros.push((l) => valor(l, col) === v); return q; },
    not: (col: string, _op: string, _v: unknown) => { filtros.push((l) => valor(l, col) !== null); return q; },
    gte: (col: string, v: string) => { filtros.push((l) => Date.parse(String(valor(l, col))) >= Date.parse(v)); return q; },
    lt: (col: string, v: string) => { filtros.push((l) => Date.parse(String(valor(l, col))) < Date.parse(v)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { if (col === 'created_at') desc = o?.ascending === false; return q; },
    limit: () => q,
    range: (de: number, ate: number) => {
      banco.consultas.push({ colunas, de, ate });
      if (banco.erro) return Promise.resolve({ data: null, error: new Error('banco fora') });
      const ordenadas = banco.linhas.filter((l) => filtros.every((f) => f(l)))
        .sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) * (desc ? -1 : 1) || (a.id - b.id) * (desc ? -1 : 1));
      const resultado = { data: ordenadas.slice(de, ate + 1).map((l) => projetar(l, colunas)), error: null };
      return banco.atrasoMs ? new Promise((ok) => setTimeout(() => ok(resultado), banco.atrasoMs)) : Promise.resolve(resultado);
    },
  };
  return q;
}

export const iso = (t: number): string => new Date(t).toISOString();
export const respostaJson = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
