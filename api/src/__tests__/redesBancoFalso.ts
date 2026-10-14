// Banco falso em memória para os testes das redes (fase 1). Entende só o que o código das redes usa:
// from(tabela).select/insert/update/upsert/delete + eq, in, like, gte, is, order, limit, maybeSingle.
// A tabela system_state tem `key` como chave; as outras têm `id` gerado. Não é o PostgREST: é o suficiente
// para provar claim por insert (23505), troca com versão e contagens por janela.

type Linha = Record<string, any>;

export interface Banco {
  tabelas: Record<string, Linha[]>;
  /** Devolve um código de erro para falhar a operação (ou null). */
  falha: ((tabela: string, op: string) => string | null) | null;
  /** Roda uma vez antes da próxima leitura com `eq` (simula outra chamada no meio). */
  noMeio: (() => void) | null;
  /** Liga o relógio do SERVIDOR: todo update grava um updated_at próprio (o do cliente é ignorado), como o banco de verdade pode fazer. */
  relogioServidor: boolean;
  storage: {
    bucket: { existe: boolean; publico: boolean; erroLeitura: boolean; limite?: number | null; tipos?: string[] | null; erroAtualizar?: boolean };
    criados: string[];
    opcoes: any[];
    atualizados: any[];
    assinados: string[];
  };
  from(tabela: string): any;
  reiniciar(): void;
}

const casaLike = (valor: unknown, padrao: string): boolean => {
  const re = new RegExp('^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
  return re.test(String(valor ?? ''));
};

const comparar = (a: unknown, b: unknown): number => {
  const ta = typeof a === 'string' ? Date.parse(a) : NaN;
  const tb = typeof b === 'string' ? Date.parse(b) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

let contador = 0;

/** Lê a coluna; `value->>estado` entra no JSON, como no PostgREST. */
const col = (r: Linha, nome: string): any => (nome.includes('->>') ? nome.split('->>').reduce((x: any, k, i) => (i === 0 ? r[k] : x?.[k]), null) : r[nome]);

class Consulta {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private carga: any = null;
  private filtros: Array<(r: Linha) => boolean> = [];
  private ordem: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private retorno = false;
  private uma = false;
  private opcoes: any = null;

  constructor(private db: Banco, private tabela: string) {}

  select(_cols?: string): this { if (this.op !== 'select') this.retorno = true; return this; }
  insert(p: Linha | Linha[]): this { this.op = 'insert'; this.carga = p; return this; }
  update(p: Linha): this { this.op = 'update'; this.carga = p; return this; }
  upsert(p: Linha, o?: any): this { this.op = 'upsert'; this.carga = p; this.opcoes = o; return this; }
  delete(): this { this.op = 'delete'; return this; }
  eq(c: string, v: unknown): this {
    this.filtros.push(r => col(r, c) === v);
    return this;
  }
  in(c: string, vs: unknown[]): this { this.filtros.push(r => vs.includes(col(r, c))); return this; }
  like(col: string, p: string): this { this.filtros.push(r => casaLike(r[col], p)); return this; }
  gte(col: string, v: unknown): this { this.filtros.push(r => r[col] !== undefined && r[col] !== null && comparar(r[col], v) >= 0); return this; }
  lte(col: string, v: unknown): this { this.filtros.push(r => r[col] !== undefined && r[col] !== null && comparar(r[col], v) <= 0); return this; }
  is(col: string, v: unknown): this { this.filtros.push(r => (v === null ? r[col] === null || r[col] === undefined : r[col] === v)); return this; }
  order(col: string, o?: { ascending?: boolean }): this { this.ordem = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number): this { this.lim = n; return this; }
  maybeSingle(): this { this.uma = true; return this; }

  private executar(): { data: any; error: any } {
    const falha = this.db.falha?.(this.tabela, this.op);
    if (falha) return { data: null, error: { code: falha, message: 'VALOR-SECRETO-NO-ERRO' } };
    const tab = (this.db.tabelas[this.tabela] ??= []);
    const chave = this.tabela === 'system_state' ? 'key' : 'id';
    const agora = new Date().toISOString();
    if (this.db.noMeio && this.filtros.length) { const f = this.db.noMeio; this.db.noMeio = null; f(); }
    const casa = (r: Linha): boolean => this.filtros.every(f => f(r));

    if (this.op === 'insert') {
      const linhas: Linha[] = Array.isArray(this.carga) ? this.carga : [this.carga];
      for (const l of linhas) {
        if (chave === 'key' && tab.some(r => r.key === l.key)) return { data: null, error: { code: '23505', message: 'dup' } };
        tab.push({ ...(chave === 'id' ? { id: `id${++contador}`, criado_em: agora } : { updated_at: agora }), ...(this.tabela === 'ig_queue' ? { status: 'pending', enviar_apos: agora, tentativas: 0 } : {}), ...l });
      }
      return { data: null, error: null };
    }
    if (this.op === 'upsert') {
      const l = this.carga as Linha;
      const i = tab.findIndex(r => r[chave] === l[chave]);
      if (i >= 0) tab[i] = { ...tab[i], ...l }; else tab.push({ updated_at: agora, ...l });
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      const alvo = tab.filter(casa);
      for (const r of alvo) {
        Object.assign(r, this.carga);
        if (this.db.relogioServidor && this.tabela === 'system_state') r.updated_at = `2026-10-15T15:00:00.${String(++contador).padStart(6, '0')}+00:00`;
      }
      return { data: this.retorno ? alvo.map(r => ({ ...r })) : null, error: null };
    }
    if (this.op === 'delete') {
      const manter = tab.filter(r => !casa(r));
      this.db.tabelas[this.tabela] = manter;
      return { data: null, error: null };
    }
    let rs = tab.filter(casa).map(r => ({ ...r }));
    if (this.ordem) { const { col, asc } = this.ordem; rs.sort((a, b) => (asc ? 1 : -1) * comparar(a[col], b[col])); }
    if (this.lim !== null) rs = rs.slice(0, this.lim);
    return { data: this.uma ? (rs[0] ?? null) : rs, error: null };
  }

  then(ok: (v: any) => any, ko?: (e: any) => any): Promise<any> {
    return Promise.resolve().then(() => this.executar()).then(ok, ko);
  }
}

export function criarBanco(): Banco {
  const banco: Banco = {
    tabelas: {},
    falha: null,
    noMeio: null,
    relogioServidor: false,
    storage: { bucket: { existe: false, publico: true, erroLeitura: false }, criados: [], opcoes: [], atualizados: [], assinados: [] },
    from(tabela: string) { return new Consulta(banco, tabela); },
    reiniciar() {
      banco.tabelas = {}; banco.falha = null; banco.noMeio = null; banco.relogioServidor = false;
      banco.storage = { bucket: { existe: false, publico: true, erroLeitura: false }, criados: [], opcoes: [], atualizados: [], assinados: [] };
    },
  };
  return banco;
}

/** O `supabase` falso: banco + storage (getBucket, createBucket, createSignedUploadUrl). */
export function criarSupabaseFalso(banco: Banco): any {
  return {
    from: (t: string) => banco.from(t),
    storage: {
      getBucket: async (nome: string) => {
        if (banco.storage.bucket.erroLeitura) return { data: null, error: { message: 'timeout', statusCode: '500' } };
        return banco.storage.bucket.existe
          ? { data: { id: nome, name: nome, public: banco.storage.bucket.publico, file_size_limit: banco.storage.bucket.limite ?? null, allowed_mime_types: banco.storage.bucket.tipos ?? null }, error: null }
          : { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
      },
      createBucket: async (nome: string, opcoes?: any) => {
        banco.storage.criados.push(nome);
        banco.storage.opcoes.push(opcoes);
        banco.storage.bucket = { ...banco.storage.bucket, existe: true, publico: !!opcoes?.public, limite: opcoes?.fileSizeLimit ?? null, tipos: opcoes?.allowedMimeTypes ?? null };
        return { data: { name: nome }, error: null };
      },
      updateBucket: async (nome: string, opcoes?: any) => {
        banco.storage.atualizados.push({ nome, opcoes });
        if (banco.storage.bucket.erroAtualizar) return { data: null, error: { message: 'falhou', statusCode: '500' } };
        banco.storage.bucket = { ...banco.storage.bucket, publico: !!opcoes?.public, limite: opcoes?.fileSizeLimit ?? null, tipos: opcoes?.allowedMimeTypes ?? null };
        return { data: { message: 'ok' }, error: null };
      },
      from: (nome: string) => ({
        createSignedUploadUrl: async (caminho: string) => {
          banco.storage.assinados.push(`${nome}/${caminho}`);
          return { data: { signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/${nome}/${caminho}?token=t`, token: 't', path: caminho }, error: null };
        },
      }),
    },
  };
}

/** Linhas de system_state com a chave começando por `prefixo`. */
export function chaves(banco: Banco, prefixo: string): string[] {
  return (banco.tabelas.system_state ?? []).filter(r => r.key.startsWith(prefixo)).map(r => r.key).sort();
}
export function valorDe(banco: Banco, chave: string): any {
  return (banco.tabelas.system_state ?? []).find(r => r.key === chave)?.value;
}

/** Instância única: o `vi.mock` do teste e o próprio teste enxergam o mesmo banco. */
export const banco: Banco = criarBanco();
export const supabaseFalso = criarSupabaseFalso(banco);
