// Folha sem imports: pode ser usada dentro de vi.mock('../utils/supabase') sem ciclo.

/** O banco falso não tem `lte`; os robôs antigos usam. Devolve o cliente com ele acrescentado. */
export function clienteComLte(supabase: { from: (t: string) => any }): { from: (t: string) => any } {
  return {
    ...supabase,
    from: (t: string) => {
      const q = supabase.from(t);
      q.lte = function (this: any, c: string, v: any) {
        this.filtros.push((r: any) => r[c] != null && String(r[c]) <= String(v));
        return this;
      };
      return q;
    },
  };
}
