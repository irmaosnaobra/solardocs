// Banco em memória para os testes da Giovanna. Cobre só o que o código dela usa do
// supabase-js: select (com count/head), insert, update, upsert, delete e os filtros
// eq, neq, in, is, gte, lt, like, not e or. `insert` em chave repetida devolve 23505
// (system_state.key e message_queue.id), igual ao Postgres.
//
// Não é arquivo de teste (não termina em .test.ts). Uso:
//   vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));

type Linha = Record<string, any>;
type Erro = { code?: string; message: string } | null;

const CHAVE_UNICA: Record<string, string> = { system_state: 'key', message_queue: 'id' };

export const banco = {
  tabelas: {} as Record<string, Linha[]>,
  /** Liga a projeção de colunas do select (select('a, b') devolve só a e b). Desligada por padrão: os testes antigos leem colunas que não pediram. */
  projeta: false,
  /** Cada escrita feita, para o teste provar que NÃO escreveu. */
  escritas: [] as Array<{ tabela: string; op: string; payload: any }>,
  /** 'tabela.op' -> erro a devolver (uma vez, se `uma`). */
  falhas: {} as Record<string, { erro: NonNullable<Erro>; uma?: boolean; pular?: number }>,
  /** Respostas forçadas de rpc(nome): o teste põe o que a função do banco devolveria. Sem entrada, vale o padrão de rpc(). */
  rpcs: {} as Record<string, (args: any) => { data: any; error: Erro }>,
  /** Cada rpc chamada, para o teste provar que a rota passou pela função. */
  rpcChamadas: [] as Array<{ nome: string; args: any }>,
  reset() {
    this.rpcs = {};
    this.rpcChamadas = [];
    this.tabelas = {};
    this.escritas = [];
    this.falhas = {};
    this.projeta = false;
  },
  linhas(t: string): Linha[] {
    return (this.tabelas[t] ??= []);
  },
  poe(t: string, ...rows: Linha[]) {
    for (const r of rows) this.linhas(t).push({ ...r });
  },
};

function caminho(r: Linha, coluna: string): any {
  // 'detail->>user_id' e 'detail->>causa'
  if (coluna.includes('->>')) {
    const [c, k] = coluna.split('->>');
    const v = r[c!];
    return v && typeof v === 'object' ? (v as Linha)[k!] : undefined;
  }
  return r[coluna];
}

function cmp(a: any, b: any): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function casaLike(valor: any, padrao: string): boolean {
  // Como o LIKE do Postgres: % = qualquer trecho, _ = um caractere, barra invertida escapa o próximo caractere.
  const lit = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re = '';
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i]!;
    if (c === '\\' && i + 1 < padrao.length) { re += lit(padrao[++i]!); continue; }
    re += c === '%' ? '.*' : c === '_' ? '.' : lit(c);
  }
  return new RegExp('^' + re + '$', 's').test(String(valor ?? ''));
}

class Consulta implements PromiseLike<any> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any = null;
  private filtros: Array<(r: Linha) => boolean> = [];
  private devolve = false;
  private contagem = false;
  private cabeca = false;
  private limite = Infinity;
  private deslocamento = 0;
  private ordem: { col: string; asc: boolean } | null = null;
  private onConflict = '';
  private colunas = '';

  constructor(private tabela: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.colunas = String(cols ?? '*');
      this.contagem = !!opts?.count;
      this.cabeca = !!opts?.head;
    } else {
      this.devolve = true;
    }
    return this;
  }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
  update(p: any) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: any, opts?: { onConflict?: string }) { this.op = 'upsert'; this.payload = p; this.onConflict = opts?.onConflict ?? ''; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(c: string, v: any) { this.filtros.push(r => caminho(r, c) === v); return this; }
  neq(c: string, v: any) { this.filtros.push(r => caminho(r, c) !== v); return this; }
  in(c: string, vs: any[]) { this.filtros.push(r => vs.includes(caminho(r, c))); return this; }
  is(c: string, v: any) { this.filtros.push(r => (v === null ? caminho(r, c) == null : caminho(r, c) === v)); return this; }
  gte(c: string, v: any) { this.filtros.push(r => caminho(r, c) != null && cmp(caminho(r, c), v) >= 0); return this; }
  lt(c: string, v: any) { this.filtros.push(r => caminho(r, c) != null && cmp(caminho(r, c), v) < 0); return this; }
  like(c: string, p: string) { this.filtros.push(r => casaLike(caminho(r, c), p)); return this; }
  /** ilike do PostgREST: `*` e `%` são curinga, sem diferenciar maiúscula. */
  ilike(c: string, p: string) {
    this.filtros.push(r => casaLike(String(caminho(r, c) ?? '').toLowerCase(), p.replace(/\*/g, '%').toLowerCase()));
    return this;
  }
  not(c: string, op: string, v: any) {
    if (op === 'is') this.filtros.push(r => (v === null ? caminho(r, c) != null : caminho(r, c) !== v));
    return this;
  }
  or(expr: string) {
    // 'key.like.a%,key.eq.b,detail->>causa.eq.x'
    const partes = expr.split(',').map(p => {
      const m = /^(.+?)\.(like|eq)\.(.*)$/.exec(p);
      if (!m) throw new Error('or() do banco falso não entende: ' + p);
      return { c: m[1]!, op: m[2]!, v: m[3]! };
    });
    this.filtros.push(r => partes.some(p => (p.op === 'like' ? casaLike(caminho(r, p.c), p.v) : String(caminho(r, p.c)) === p.v)));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.ordem = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.limite = n; return this; }
  /** range(de, ate) do PostgREST: ambos inclusivos. */
  range(de: number, ate: number) { this.deslocamento = de; this.limite = ate - de + 1; return this; }

  async maybeSingle() { const r = await this.executa(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; }
  async single() { const r = await this.maybeSingle(); return r.data ? r : { ...r, data: null, error: r.error ?? { message: 'sem linha', code: 'PGRST116' } }; }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.executa().then(ok, ko);
  }

  private falhou(): Erro {
    const chave = `${this.tabela}.${this.op}`;
    const f = banco.falhas[chave];
    if (!f) return null;
    if (f.pular && f.pular > 0) { f.pular--; return null; } // deixa as primeiras chamadas passarem
    if (f.uma) delete banco.falhas[chave];
    return f.erro;
  }

  private async executa(): Promise<{ data: any; error: Erro; count?: number | null }> {
    const t = banco.linhas(this.tabela);
    const erro = this.falhou();
    if (this.op !== 'select') banco.escritas.push({ tabela: this.tabela, op: this.op, payload: this.payload });
    if (erro) return { data: null, error: erro, count: null };

    const filtra = () => t.filter(r => this.filtros.every(f => f(r)));
    const unica = CHAVE_UNICA[this.tabela];

    if (this.op === 'insert') {
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((x: Linha) => ({ ...x }));
      for (const n of novas) {
        if (unica && t.some(r => r[unica] === n[unica])) {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.tabela}_pkey"` } };
        }
        if (this.tabela === 'system_state' && n.updated_at == null) n.updated_at = new Date().toISOString();
        if (n.created_at == null && this.tabela !== 'system_state') n.created_at = new Date().toISOString();
        if (this.tabela === 'tech_issues' && n.id == null) n.id = `ti-${t.length + 1}-xxxxxxxx`;
        if (this.tabela.startsWith('nexus_') && n.id == null) n.id = globalThis.crypto.randomUUID();
        t.push(n);
      }
      return { data: this.devolve ? novas : null, error: null };
    }
    if (this.op === 'upsert') {
      const cols = (this.onConflict || unica || 'id').split(',').map(c => c.trim());
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((x: Linha) => ({ ...x }));
      for (const n of novas) {
        const i = t.findIndex(r => cols.every(col => r[col] === n[col]));
        if (i >= 0) t[i] = { ...t[i], ...n }; else t.push(n);
      }
      return { data: this.devolve ? novas : null, error: null };
    }
    if (this.op === 'update') {
      const alvo = filtra();
      for (const r of alvo) Object.assign(r, this.payload);
      return { data: this.devolve ? alvo.map(r => ({ ...r })) : null, error: null };
    }
    if (this.op === 'delete') {
      const alvo = new Set(filtra());
      banco.tabelas[this.tabela] = t.filter(r => !alvo.has(r));
      return { data: null, error: null };
    }

    let rows = filtra();
    if (this.ordem) {
      const { col, asc } = this.ordem;
      rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(caminho(a, col), caminho(b, col)));
    }
    const total = rows.length;
    rows = rows.slice(this.deslocamento, this.deslocamento + this.limite);
    if (this.cabeca) return { data: null, error: null, count: total };
    const lista = banco.projeta && this.colunas.trim() !== '*' && this.colunas.trim() !== ''
      ? this.colunas.split(',').map(c => c.trim()).filter(Boolean)
      : null;
    const recorta = (r: Linha): Linha => {
      if (!lista) return { ...r };
      const o: Linha = {};
      for (const c of lista) if (c in r) o[c] = r[c];
      return o;
    };
    return { data: rows.map(recorta), error: null, count: this.contagem ? total : null };
  }
}

export const supabase = {
  from: (t: string) => new Consulta(t),
  rpc: async (nome: string, args?: any) => {
    banco.rpcChamadas.push({ nome, args });
    const forcada = banco.rpcs[nome];
    if (forcada) return forcada(args);
    if (nome === 'nexus_usar_pacote') return usarPacoteFalso(args);
    return { data: null, error: null };
  },
};

/**
 * nexus_usar_pacote do banco falso: a mesma conta da função SQL (comprados - usados > 0, insere 'aberta'). Roda sem await no meio,
 * então é atômica como a transação com advisory lock do Postgres.
 */
function usarPacoteFalso(args: { p_user: string; p_dados: Linha }): { data: any; error: Erro } {
  const comprados = banco.linhas('nexus_pedidos')
    .filter((p) => p.user_id === args.p_user && p.tipo === 'engenharia' && p.status === 'confirmado')
    .reduce((s, p) => s + (Number(p.pacote) || 0), 0);
  const usados = banco.linhas('nexus_solicitacoes')
    .filter((x) => x.user_id === args.p_user && x.tipo === 'engenharia' && x.status !== 'cancelada' && x.dados?.usa_pacote === true).length;
  if (comprados - usados <= 0) return { data: { ok: false, erro: 'sem_saldo' }, error: null };
  const id = globalThis.crypto.randomUUID();
  const agora = new Date().toISOString();
  banco.linhas('nexus_solicitacoes').push({ id, user_id: args.p_user, tipo: 'engenharia', dados: { ...args.p_dados }, status: 'aberta', created_at: agora, updated_at: agora });
  return { data: { ok: true, id }, error: null };
}
