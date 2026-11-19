/**
 * As marcas de "a IA gravou" do valor, do pagamento e do prazo da venda (privado.venda.ia).
 * Só chave conhecida e slot em forma de chave. Vazio = sem a propriedade.
 * Mora fora de jornadaSolarBanco.ts por causa da trava de 350 linhas.
 */
export type MarcaIa = Partial<Record<'valor' | 'pagamento' | 'prazo', string>>;

export function marcaIa(v: unknown): { ia?: MarcaIa } {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const ia: MarcaIa = {};
  for (const k of ['valor', 'pagamento', 'prazo'] as const) {
    const bruto = o ? o[k] : undefined;
    const s = typeof bruto === 'string' ? bruto.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) : '';
    if (/^[a-z0-9_]{1,40}$/.test(s)) ia[k] = s;
  }
  return Object.keys(ia).length ? { ia } : {};
}
