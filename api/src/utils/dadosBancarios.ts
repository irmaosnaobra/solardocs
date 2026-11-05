// Dados para pagamento da empresa (company.dados_bancarios, jsonb). Puro, sem banco nem rede.
// O controller normaliza ao salvar e o modelo 4 da proposta normaliza de novo ao ler,
// então um jsonb sujo (editado à mão, versão antiga) nunca chega ao HTML.

export interface DadosBancarios {
  banco?: string;
  agencia?: string;
  conta?: string;
  tipo_conta?: 'corrente' | 'poupanca';
  titular?: string;
  documento?: string;
  pix?: string;
}

const LIMITES: Array<[Exclude<keyof DadosBancarios, 'tipo_conta'>, number]> = [
  ['banco', 60], ['agencia', 12], ['conta', 20], ['titular', 120], ['documento', 20], ['pix', 120],
];

/** Strings aparadas e cortadas no máximo; vazio sai; sem nada, null. */
export function normalizarDadosBancarios(v: unknown): DadosBancarios | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: DadosBancarios = {};
  for (const [k, max] of LIMITES) {
    const x = src[k];
    if (typeof x !== 'string') continue;
    const t = x.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max).trim();
    if (t) out[k] = t;
  }
  if (src.tipo_conta === 'corrente' || src.tipo_conta === 'poupanca') out.tipo_conta = src.tipo_conta;
  return Object.keys(out).length ? out : null;
}

/** A folha só mostra o bloco com banco, agência e conta juntos, ou com a chave Pix. */
export function dadosBancariosCompletos(d: DadosBancarios | null): boolean {
  if (!d) return false;
  return !!(d.banco && d.agencia && d.conta) || !!d.pix;
}
