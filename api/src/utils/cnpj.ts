// CNPJ: só dígitos, dígito verificador e máscara. Puro, sem banco nem rede.
// Nasceu dentro do zod do companyController; saiu para cá para a Giovanna
// (giovannaFerramentas) validar o mesmo CNPJ pela mesma regra.

export function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * CNPJ sem pontuação, em maiúsculas, mantendo as letras. O CNPJ alfanumérico (regra da Receita de
 * julho de 2026) tem 12 posições [0-9A-Z] e 2 dígitos verificadores numéricos: `soDigitos` perderia as letras.
 */
export function normalizarCnpj(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * 14 posições (12 em [0-9A-Z] + 2 dígitos), não todas iguais, e os dois dígitos verificadores batendo.
 * Valor de cada caractere = código ASCII - 48 (dígito vale ele mesmo, A vale 17), com os mesmos pesos
 * do CNPJ numérico. Todo CNPJ numérico antigo continua valendo.
 */
export function cnpjValido(v: unknown): boolean {
  const c = normalizarCnpj(v);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const calc = (base: string, w: number[]) => {
    const s = w.reduce((a, x, i) => a + (base.charCodeAt(i) - 48) * x, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(c[12]) &&
         calc(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(c[13]);
}

/** 54129446000140 vira 54.129.446/0001-40; as letras do CNPJ alfanumérico ficam. Se não tiver 14 posições, devolve só os dígitos. */
export function formatarCnpj(v: unknown): string {
  const d = normalizarCnpj(v);
  if (d.length !== 14) return soDigitos(v);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
