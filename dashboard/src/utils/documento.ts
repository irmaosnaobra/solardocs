/** CPF e CNPJ: máscara de digitação e conferência dos dígitos verificadores.
 *  Mesma regra do servidor: tamanho certo, não aceita todos os dígitos iguais. */

export function soDigitos(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** 12345678901 vira "123.456.789-01", conforme digita. */
export function maskCpf(raw: string): string {
  const d = soDigitos(raw).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Letras e números em maiúsculas, sem pontuação. */
export function soAlfanum(v: string | null | undefined): string {
  return String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** CNPJ conforme digita. Desde julho de 2026 as 12 primeiras posições aceitam letras (A a Z, em
 *  maiúsculas); os 2 dígitos verificadores são sempre números. 12345678000190 vira
 *  "12.345.678/0001-90" e "12ABC34501DE35" vira "12.ABC.345/01DE-35". */
export function maskCnpj(raw: string): string {
  let d = '';
  for (const ch of soAlfanum(raw)) {
    if (d.length >= 14) break;
    if (d.length >= 12 && !/\d/.test(ch)) continue;
    d += ch;
  }
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function cpfValido(valor: string | null | undefined): boolean {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/** CNPJ numérico ou alfanumérico: 12 posições [0-9A-Z] e 2 dígitos verificadores numéricos.
 *  Valor de cada caractere = código ASCII menos 48, com os mesmos pesos do CNPJ numérico. */
export function cnpjValido(valor: string | null | undefined): boolean {
  const c = soAlfanum(valor);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + (c.charCodeAt(i) - 48) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}
