// Banco falso em memória para os testes do quiz solar (24/10/2026). Imita o suficiente do query builder do Supabase:
// filtros (eq, neq, in, is, not, gte, lte, ilike, like), order, limit, range, single, maybeSingle, insert, update, delete,
// upsert, e o índice único (vendedor_nome, quando) onde status <> 'cancelado' da tabela agendamentos (erro 23505).

export type Linha = Record<string, any>;

export class BancoFalso {
  tabelas: Record<string, Linha[]> = {};
  proximoId = 1000;
  /** Chaves únicas por tabela. */
  unicas: Record<string, string> = { system_state: 'key', leads_meta: 'lead_id' };

  tabela(nome: string): Linha[] { return (this.tabelas[nome] ??= []); }
  zerar(): void { this.tabelas = {}; this.proximoId = 1000; }

  from(nome: string): any {
    const banco = this;
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: Linha | Linha[] | null = null;
    let ordem: Array<[string, boolean]> = [];
    let faixa: [number, number] | null = null;
    let limite: number | null = null;
    let pedeLinhas = false;
    let conflito: string | undefined;

    const like = (valor: unknown, padrao: string, ci: boolean) => {
      const re = new RegExp('^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', ci ? 'i' : '');
      return re.test(String(valor ?? ''));
    };

    function executar(): { data: any; error: any } {
      const linhas = banco.tabela(nome);
      const casa = (l: Linha) => filtros.every(f => f(l));
      if (op === 'insert' || op === 'upsert') {
        const novas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
        const saida: Linha[] = [];
        for (const n of novas) {
          const chave = banco.unicas[nome];
          const existente = chave ? linhas.find(l => l[chave] === n[chave]) : undefined;
          if (existente) {
            if (op === 'upsert') { Object.assign(existente, n); saida.push(existente); continue; }
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          if (nome === 'agendamentos' && n.status !== 'cancelado'
            && linhas.some(l => l.status !== 'cancelado' && l.vendedor_nome === n.vendedor_nome && l.quando === n.quando)) {
            return { data: null, error: { code: '23505', message: 'duplicate key (vendedor, quando)' } };
          }
          const linha: Linha = { ...n };
          if (nome === 'agendamentos') { linha.id ??= banco.proximoId++; linha.created_at ??= new Date().toISOString(); }
          linhas.push(linha);
          saida.push(linha);
        }
        return { data: saida, error: null };
      }
      if (op === 'update') {
        const alvo = linhas.filter(casa);
        for (const l of alvo) Object.assign(l, payload);
        return { data: alvo, error: null };
      }
      if (op === 'delete') {
        const alvo = linhas.filter(casa);
        banco.tabelas[nome] = linhas.filter(l => !alvo.includes(l));
        return { data: alvo, error: null };
      }
      let r = linhas.filter(casa);
      for (const [col, asc] of [...ordem].reverse()) r = [...r].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      if (faixa) r = r.slice(faixa[0], faixa[1] + 1);
      if (limite !== null) r = r.slice(0, limite);
      return { data: r, error: null };
    }

    const q: any = {
      select: () => { if (op === 'insert' || op === 'update' || op === 'upsert' || op === 'delete') pedeLinhas = true; return q; },
      insert: (p: Linha | Linha[]) => { op = 'insert'; payload = p; return q; },
      upsert: (p: Linha | Linha[], o?: { onConflict?: string }) => { op = 'upsert'; payload = p; conflito = o?.onConflict; void conflito; return q; },
      update: (p: Linha) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (c: string, v: unknown) => { filtros.push(l => l[c] === v); return q; },
      neq: (c: string, v: unknown) => { filtros.push(l => l[c] !== v); return q; },
      in: (c: string, vs: unknown[]) => { filtros.push(l => vs.includes(l[c])); return q; },
      is: (c: string, v: unknown) => { filtros.push(l => (v === null ? l[c] === null || l[c] === undefined : l[c] === v)); return q; },
      not: (c: string, o: string, v: string) => {
        if (o === 'in') { const lista = String(v).replace(/[()]/g, '').split(','); filtros.push(l => !lista.includes(String(l[c]))); }
        else if (o === 'is') filtros.push(l => !(v === null ? l[c] === null || l[c] === undefined : l[c] === v));
        return q;
      },
      gte: (c: string, v: any) => { filtros.push(l => l[c] !== undefined && l[c] !== null && l[c] >= v); return q; },
      lte: (c: string, v: any) => { filtros.push(l => l[c] !== undefined && l[c] !== null && l[c] <= v); return q; },
      lt: (c: string, v: any) => { filtros.push(l => l[c] !== undefined && l[c] !== null && l[c] < v); return q; },
      ilike: (c: string, p: string) => { filtros.push(l => like(l[c], p, true)); return q; },
      like: (c: string, p: string) => { filtros.push(l => like(l[c], p, false)); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { ordem.push([c, o?.ascending !== false]); return q; },
      limit: (n: number) => { limite = n; return q; },
      range: (a: number, b: number) => { faixa = [a, b]; return q; },
      single: () => {
        const r = executar();
        const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
        return Promise.resolve(r.error ? r : { data: d, error: d ? null : { message: 'sem linha' } });
      },
      maybeSingle: () => {
        const r = executar();
        return Promise.resolve(r.error ? r : { data: (Array.isArray(r.data) ? r.data[0] : r.data) ?? null, error: null });
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const r = executar();
        void pedeLinhas;
        return Promise.resolve(r).then(ok, ko);
      },
    };
    return q;
  }
}
