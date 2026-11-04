// Endereço do cliente em partes (rua, número, complemento, bairro) e a linha
// completa que o resto do sistema (PDF, contratos, prompts) continua lendo em
// `clients.endereco`. Esta é a ÚNICA regra de montagem: a leitura da conta de
// luz e o cadastro do cliente usam esta mesma função.

export interface EnderecoPartes {
  logradouro?: unknown;
  numero?: unknown;
  complemento?: unknown;
  bairro?: unknown;
}

export const CAMPOS_ENDERECO = ['logradouro', 'numero', 'complemento', 'bairro'] as const;

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** "Rua das Flores, 123, Apto 4, Centro": partes vazias saem, a caixa fica como veio. */
export function montarEndereco(p: EnderecoPartes): string {
  return [p.logradouro, p.numero, p.complemento, p.bairro]
    .map(texto)
    .filter(Boolean)
    .join(', ');
}

/** Alguma das 4 partes veio no objeto (mesmo vazia)? Distingue "não mexeu" de "limpou". */
export function temParteDeEndereco(o: Record<string, unknown>): boolean {
  return CAMPOS_ENDERECO.some((c) => o[c] !== undefined);
}

function normalizarSegmento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Endereço para documento: "Linha do endereço, Bairro, Cidade/UF". Se a linha do
 * endereço já traz o bairro como um dos seus segmentos (separados por vírgula, sem
 * diferenciar maiúscula nem acento), o bairro não é repetido. Isso acontece depois
 * que `clients.endereco` passa a ser montado com o bairro dentro. Bairro vazio dá
 * a mesma saída de sempre. Sem nada, devolve '___'.
 */
export function enderecoCompleto(endereco?: string, bairro?: string, cidade?: string, uf?: string): string {
  const linha = (endereco || '').trim();
  const bairroTxt = (bairro || '').trim();
  const jaTemBairro = !!bairroTxt && linha
    .split(',')
    .some((seg) => normalizarSegmento(seg) === normalizarSegmento(bairroTxt));
  const cidadeUf = [cidade, uf].filter(Boolean).join('/');
  const parts = [linha, jaTemBairro ? '' : bairroTxt, cidadeUf].map((p) => (p || '').trim()).filter(Boolean);
  return parts.join(', ') || '___';
}
