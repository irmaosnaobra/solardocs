// Máscara e conferência de CPF/CNPJ e de telefone do modal de Pix automático.
// Mesma regra do quiz (/diagnostico): só dígitos vão para a API.

export function soDigitos(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

// CPF até 11 dígitos (000.000.000-00); a partir do 12º vira CNPJ (00.000.000/0000-00).
export function mascaraDoc(v: string): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d.slice(0, 3)
      + (d.length > 3 ? '.' + d.slice(3, 6) : '')
      + (d.length > 6 ? '.' + d.slice(6, 9) : '')
      + (d.length > 9 ? '-' + d.slice(9, 11) : '');
  }
  return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12)
    + (d.length > 12 ? '-' + d.slice(12, 14) : '');
}

function digitoVerificador(base: string, pesos: number[]): number {
  let t = 0;
  for (let i = 0; i < pesos.length; i++) t += Number(base[i]) * pesos[i];
  const r = t % 11;
  return r < 2 ? 0 : 11 - r;
}

// Confere os dígitos verificadores. Sequência repetida (11111111111) é inválida.
export function docValido(d: string): boolean {
  if (!/^\d+$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  if (d.length === 11) {
    return digitoVerificador(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[9])
      && digitoVerificador(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[10]);
  }
  if (d.length === 14) {
    return digitoVerificador(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12])
      && digitoVerificador(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
  }
  return false;
}

// Só os dígitos de DDD + número (10 ou 11). Tira o 55 de quem cola com código do país.
export function digitosFone(v: string): string {
  let d = soDigitos(v);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.slice(0, 11);
}

// (34) 99999-9999 ou (34) 9999-9999
export function mascaraFone(v: string): string {
  const d = digitosFone(v);
  // Até o DDD fica sem parêntese: assim o apagar do teclado não é desfeito pela máscara.
  if (d.length <= 2) return d;
  const resto = d.slice(2);
  const corte = d.length > 10 ? 5 : 4;
  return '(' + d.slice(0, 2) + ') ' + resto.slice(0, corte) + (resto.length > corte ? '-' + resto.slice(corte) : '');
}

export function foneValido(d: string): boolean {
  return /^\d{10,11}$/.test(d) && Number(d.slice(0, 2)) >= 11;
}
