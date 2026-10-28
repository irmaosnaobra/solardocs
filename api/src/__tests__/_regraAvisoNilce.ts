import { expect } from 'vitest';

// A regra de escrita dos avisos da Nilce (T1, T2, T3, T4 e T7), de 27/10/2026: emoji só na 1ª linha e nos títulos de seção
// (`<um emoji> *TÍTULO EM MAIÚSCULAS*`, sozinho na linha); linha de dado nunca leva emoji; sem travessão; toda linha começa
// com maiúscula (linha em branco vale; `*`, `_` e dígito passam). `lista` = o T3, onde o cabeçalho de cada cliente também leva
// o emoji da nota (`<emoji> *Nome · NOTA 80*`).
const EMOJI = /\p{Extended_Pictographic}/u;
export const TITULO_DE_SECAO = /^\S+ \*[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]+\*$/;
const CABECALHO_DE_CLIENTE = /^\S+ \*.+ · NOTA \d+\*$/;

export function confereRegraDoAviso(texto: string, opcoes: { lista?: boolean } = {}): void {
  const linhas = texto.split('\n');
  linhas.forEach((l, i) => {
    if (EMOJI.test(l) && i !== 0) {
      const ok = TITULO_DE_SECAO.test(l) || (opcoes.lista === true && CABECALHO_DE_CLIENTE.test(l));
      expect(ok, `emoji fora do lugar na linha ${i + 1}: ${l}`).toBe(true);
    }
    if (l) expect(l[0], `linha ${i + 1} não começa com maiúscula: ${l}`).toBe(l[0].toUpperCase());
  });
  expect(texto).not.toMatch(/[—–]/);
}
