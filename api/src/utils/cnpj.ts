// CNPJ: só dígitos, dígito verificador e máscara. Puro, sem banco nem rede.
// Nasceu dentro do zod do companyController; saiu para cá para a Giovanna
// (giovannaFerramentas) validar o mesmo CNPJ pela mesma regra.

export function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** 14 dígitos, não todos iguais, e os dois dígitos verificadores batendo. */
export function cnpjValido(v: unknown): boolean {
  const c = soDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string, w: number[]) => {
    const s = w.reduce((a, x, i) => a + parseInt(base[i]) * x, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(c[12]) &&
         calc(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === parseInt(c[13]);
}

/** 54129446000140 vira 54.129.446/0001-40. Se não tiver 14 dígitos, devolve só os dígitos. */
export function formatarCnpj(v: unknown): string {
  const d = soDigitos(v);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
