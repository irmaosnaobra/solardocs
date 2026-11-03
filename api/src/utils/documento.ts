// CPF e CNPJ do comprador: só dígitos, dígito verificador e máscara. Puro, sem banco nem rede.
// O CNPJ já mora em ./cnpj (companyController e giovannaFerramentas usam a mesma regra);
// aqui entra o CPF, e uma porta única que aceita um dos dois.

import { cnpjValido, formatarCnpj, soDigitos } from './cnpj';

/** 11 dígitos, não todos iguais, e os dois dígitos verificadores batendo. */
export function cpfValido(v: unknown): boolean {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (tam: number) => {
    let soma = 0;
    for (let i = 0; i < tam; i++) soma += parseInt(c[i], 10) * (tam + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(c[9], 10) && calc(10) === parseInt(c[10], 10);
}

/** 12345678909 vira 123.456.789-09. Se não tiver 11 dígitos, devolve só os dígitos. */
export function formatarCpf(v: unknown): string {
  const d = soDigitos(v);
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Um CPF ou um CNPJ de verdade, só com dígitos. Devolve null para o que não é nenhum dos dois
 * (vazio, tamanho errado, dígito verificador que não bate, sequência repetida): quem casa conta
 * por documento só usa o que passou aqui, nunca o que o comprador digitou por engano.
 */
export function documentoSoDigitos(v: unknown): string | null {
  const d = soDigitos(v);
  if (d.length === 11) return cpfValido(d) ? d : null;
  if (d.length === 14) return cnpjValido(d) ? d : null;
  return null;
}

/** Como o documento aparece no banco: só dígitos e com máscara (o `company.cnpj` tem as duas formas). */
export function formasDoDocumento(d: string): string[] {
  if (d.length === 14) return [d, formatarCnpj(d)];
  if (d.length === 11) return [d, formatarCpf(d)];
  return [];
}

/** Os 4 últimos dígitos, para log e alerta: o documento inteiro nunca vai para lá. */
export function finalDoDocumento(v: unknown): string {
  const d = soDigitos(v);
  return d.length >= 4 ? `final ${d.slice(-4)}` : '(curto)';
}
