// Banco falso em memória para os testes do ensaio e do replay. Nada de rede.
// Entende o suficiente do PostgREST: select/insert/upsert/update/delete, eq/neq/in/like/ilike/gte/lte/is,
// order/range/limit, maybeSingle, contagem com head, rpc e o Storage (upload sem upsert, download, list, remove).
// Registra TODA escrita por tabela, para o teste provar que nenhuma tabela proibida foi tocada.

export type Linha = Record<string, any>;

export interface Escrita { tabela: string; op: 'insert' | 'upsert' | 'update' | 'delete'; chaves?: string[] }

export interface BancoFalso {
  tabelas: Record<string, Linha[]>;
  escritas: Escrita[];
  /** Tabelas lidas (uma entrada por select executado). */
  leituras: string[];
  rpcs: Record<string, (args: any) => Linha[]>;
  objetos: Map<string, string>;
  bucket: { existe: boolean; publico: boolean; criado: boolean };
  /** Faz a próxima operação nesta tabela devolver este erro. */
  falhar: Record<string, { code?: string; message?: string } | undefined>;
  cliente: any;
}

const quebra = (v: unknown) => (v === undefined ? null : v);

function igual(a: unknown, b: unknown): boolean {
  return String(quebra(a)) === String(quebra(b));
}

function comoLike(padrao: string, ignorarCaixa: boolean): RegExp {
  const re = padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${re}$`, ignorarCaixa ? 'i' : '');
}

function valorDe(l: Linha, coluna: string): unknown {
  // "payload->externalAdReply" e afins: devolve o campo inteiro.
  return l[coluna.split('->')[0]!];
}

export function novoBanco(): BancoFalso {
  const banco: BancoFalso = {
    tabelas: {}, escritas: [], leituras: [], rpcs: {}, objetos: new Map(),
    bucket: { existe: false, publico: false, criado: false }, falhar: {}, cliente: null,
  };
  const tabela = (nome: string): Linha[] => (banco.tabelas[nome] ??= []);

  function consulta(nome: string) {
    type Filtro = (l: Linha) => boolean;
    const filtros: Filtro[] = [];
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let head = false;
    let contar = false;
    let ordem: Array<{ col: string; asc: boolean }> = [];
    let faixa: [number, number] | null = null;
    let teto: number | null = null;
    let unico: 'maybe' | 'single' | null = null;
    let onConflict = 'key';

    const b: any = {};
    const filtra = (f: Filtro) => { filtros.push(f); return b; };
    b.select = (_c?: string, o?: { count?: string; head?: boolean }) => { if (op === 'select') { head = !!o?.head; contar = !!o?.count; } return b; };
    b.insert = (p: any) => { op = 'insert'; payload = p; return b; };
    b.upsert = (p: any, o?: { onConflict?: string }) => { op = 'upsert'; payload = p; onConflict = o?.onConflict ?? 'key'; return b; };
    b.update = (p: any) => { op = 'update'; payload = p; return b; };
    b.delete = () => { op = 'delete'; return b; };
    b.eq = (c: string, v: unknown) => filtra(l => igual(valorDe(l, c), v));
    b.neq = (c: string, v: unknown) => filtra(l => !igual(valorDe(l, c), v));
    b.in = (c: string, vs: unknown[]) => filtra(l => vs.some(v => igual(valorDe(l, c), v)));
    b.like = (c: string, p: string) => filtra(l => comoLike(p, false).test(String(valorDe(l, c) ?? '')));
    b.ilike = (c: string, p: string) => filtra(l => comoLike(p, true).test(String(valorDe(l, c) ?? '')));
    b.gte = (c: string, v: any) => filtra(l => Date.parse(String(valorDe(l, c))) >= Date.parse(String(v)) || (typeof v === 'number' && Number(valorDe(l, c)) >= v));
    b.lte = (c: string, v: any) => filtra(l => Date.parse(String(valorDe(l, c))) <= Date.parse(String(v)) || (typeof v === 'number' && Number(valorDe(l, c)) <= v));
    b.is = (c: string, v: unknown) => filtra(l => igual(valorDe(l, c), v));
    b.not = () => b;
    b.or = () => b;
    b.order = (col: string, o?: { ascending?: boolean }) => { ordem.push({ col, asc: o?.ascending !== false }); return b; };
    b.range = (de: number, ate: number) => { faixa = [de, ate]; return b; };
    b.limit = (n: number) => { teto = n; return b; };
    b.maybeSingle = () => { unico = 'maybe'; return b; };
    b.single = () => { unico = 'single'; return b; };

    const executar = (): { data: any; error: any; count?: number | null } => {
      const falha = banco.falhar[nome];
      if (falha) return { data: null, error: { code: falha.code ?? 'XX000', message: falha.message ?? 'falha' } };
      const todas = tabela(nome);
      const casam = () => todas.filter(l => filtros.every(f => f(l)));
      if (op === 'insert') {
        const lista: Linha[] = Array.isArray(payload) ? payload : [payload];
        for (const novo of lista) {
          if (nome === 'system_state' && todas.some(l => l.key === novo.key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        for (const novo of lista) todas.push({ ...novo });
        banco.escritas.push({ tabela: nome, op: 'insert', chaves: lista.map(l => l.key).filter(Boolean) });
        return { data: null, error: null };
      }
      if (op === 'upsert') {
        const lista: Linha[] = Array.isArray(payload) ? payload : [payload];
        for (const novo of lista) {
          const i = todas.findIndex(l => l[onConflict] === novo[onConflict]);
          if (i >= 0) todas[i] = { ...todas[i], ...novo }; else todas.push({ ...novo });
        }
        banco.escritas.push({ tabela: nome, op: 'upsert', chaves: lista.map(l => l.key).filter(Boolean) });
        return { data: null, error: null };
      }
      if (op === 'update') {
        for (const l of casam()) Object.assign(l, payload);
        banco.escritas.push({ tabela: nome, op: 'update' });
        return { data: null, error: null };
      }
      if (op === 'delete') {
        const alvo = new Set(casam());
        banco.escritas.push({ tabela: nome, op: 'delete', chaves: [...alvo].map(l => l.key).filter(Boolean) });
        banco.tabelas[nome] = todas.filter(l => !alvo.has(l));
        return { data: null, error: null };
      }
      banco.leituras.push(nome);
      let r = casam();
      for (const o of [...ordem].reverse()) {
        r = [...r].sort((x, y) => {
          const a = valorDe(x, o.col) as any; const c = valorDe(y, o.col) as any;
          const da = Date.parse(String(a)); const dc = Date.parse(String(c));
          const cmp = Number.isFinite(da) && Number.isFinite(dc) && typeof a === 'string' && /\d{4}-\d{2}/.test(a)
            ? da - dc : (a > c ? 1 : a < c ? -1 : 0);
          return o.asc ? cmp : -cmp;
        });
      }
      const total = r.length;
      if (faixa) r = r.slice(faixa[0], faixa[1] + 1);
      if (teto !== null) r = r.slice(0, teto);
      if (head) return { data: null, error: null, count: total };
      const copia = r.map(l => ({ ...l }));
      if (unico) return { data: copia[0] ?? null, error: null };
      return { data: copia, error: null, count: contar ? total : null };
    };
    b.then = (ok: any, ko: any) => Promise.resolve(executar()).then(ok, ko);
    return b;
  }

  const storage = {
    getBucket: async (_n: string) => (banco.bucket.existe
      ? { data: { public: banco.bucket.publico }, error: null }
      : { data: null, error: { message: 'Bucket not found', statusCode: '404' } }),
    createBucket: async (_n: string, o: { public?: boolean }) => {
      banco.bucket = { existe: true, publico: !!o?.public, criado: true };
      return { data: {}, error: null };
    },
    from: (_b: string) => ({
      upload: async (caminho: string, corpo: Buffer, o?: { upsert?: boolean }) => {
        if (!banco.bucket.existe) return { data: null, error: { message: 'Bucket not found', statusCode: '404' } };
        if (banco.objetos.has(caminho) && !o?.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
        banco.objetos.set(caminho, Buffer.from(corpo).toString('utf8'));
        return { data: { path: caminho }, error: null };
      },
      download: async (caminho: string) => {
        const t = banco.objetos.get(caminho);
        return t === undefined
          ? { data: null, error: { message: 'Object not found', statusCode: '404' } }
          : { data: { text: async () => t }, error: null };
      },
      list: async (prefixo: string, o?: { limit?: number; offset?: number }) => {
        const base = prefixo ? `${prefixo}/` : '';
        const nomes = new Set<string>();
        for (const k of banco.objetos.keys()) if (k.startsWith(base)) nomes.add(k.slice(base.length).split('/')[0]!);
        const todos = [...nomes].sort().map(name => ({ name }));
        const off = o?.offset ?? 0;
        return { data: todos.slice(off, off + (o?.limit ?? 100)), error: null };
      },
      remove: async (caminhos: string[]) => { for (const c of caminhos) banco.objetos.delete(c); return { data: [], error: null }; },
    }),
  };

  banco.cliente = {
    from: (nome: string) => consulta(nome),
    rpc: (nome: string, args: unknown) => {
      const dados = banco.rpcs[nome] ? banco.rpcs[nome]!(args) : [];
      const b: any = { range: () => b, then: (ok: any, ko: any) => Promise.resolve({ data: dados, error: null }).then(ok, ko) };
      return b;
    },
    storage,
  };
  return banco;
}

/** Escritas feitas nas tabelas proibidas do ensaio. */
export const TABELAS_PROIBIDAS = ['whatsapp_sessions', 'agendamentos', 'atendimento_pausa', 'sdr_leads', 'message_queue'] as const;

export function escritasProibidas(b: BancoFalso): Escrita[] {
  return b.escritas.filter(e => (TABELAS_PROIBIDAS as readonly string[]).includes(e.tabela));
}

// ── a Anthropic falsa ────────────────────────────────────────────────────────

export interface ChamadaIA { body: any }

export function iaFalsa(responder: (body: any, n: number) => any | Promise<any>) {
  const chamadas: ChamadaIA[] = [];
  const cliente = {
    messages: {
      async create(body: any) {
        chamadas.push({ body });
        return responder(body, chamadas.length);
      },
    },
  };
  return { cliente, chamadas };
}

export const saidaJson = (bolhas: string[], extra: Record<string, unknown> = {}) => JSON.stringify({
  bolhas, acao: 'continuar', peca: null, dados: [], resumo: 'r', sabe_contexto: true, ...extra,
});

export const respostaIA = (texto: string, uso: Partial<Record<string, number>> = {}) => ({
  content: [{ type: 'text', text: texto }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5, ...uso },
});
