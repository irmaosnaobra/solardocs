// Numeração e referência das fotos dos relatórios (vistoria e manutenção). Módulo PURO: sem banco,
// sem logger, sem rede. A numeração é global e contínua no documento inteiro, então a legenda
// "Foto 7" de uma foto e a referência "Fotos 6 e 7" no cartão do item sempre concordam.

/** Quantidade de fotos de um grupo: inteiro maior que zero, ou 0 para qualquer outra coisa. */
function quantidade(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Numera as fotos na ordem dada, de forma contínua, começando em `inicio`.
 * Grupo sem foto não aparece no mapa. Grupo repetido na ordem conta uma vez só.
 * Exemplo: ordem ['antes', 'depois'], contagem { antes: 2, depois: 1 } vira antes [1, 2], depois [3].
 */
export function numerarGrupos(
  ordem: string[],
  contagem: Record<string, number>,
  inicio = 1,
): Map<string, number[]> {
  const mapa = new Map<string, number[]>();
  let proximo = Number.isFinite(inicio) ? Math.floor(inicio) : 1;
  for (const grupo of ordem) {
    if (mapa.has(grupo)) continue;
    const n = quantidade(contagem[grupo]);
    if (n === 0) continue;
    const nums: number[] = [];
    for (let i = 0; i < n; i++) nums.push(proximo++);
    mapa.set(grupo, nums);
  }
  return mapa;
}

/**
 * Texto curto que aponta para as fotos: "Foto 3", "Fotos 3 e 4", "Fotos 1, 2 e 5", "Fotos 1 a 3 e 5".
 * Três números seguidos ou mais viram "x a y"; dois seguidos ficam escritos um a um.
 * O rótulo 'Documento' dá "Documento 1" e "Documentos 1 e 2". Lista vazia devolve ''.
 */
export function refFotos(nums: number[], rotulo: 'Foto' | 'Documento' = 'Foto'): string {
  const lista = Array.from(new Set((nums ?? []).filter((n) => Number.isInteger(n)))).sort((a, b) => a - b);
  if (lista.length === 0) return '';

  const trechos: string[] = [];
  let i = 0;
  while (i < lista.length) {
    let j = i;
    while (j + 1 < lista.length && lista[j + 1] === lista[j]! + 1) j++;
    if (j - i + 1 >= 3) {
      trechos.push(`${lista[i]} a ${lista[j]}`);
    } else {
      for (let k = i; k <= j; k++) trechos.push(String(lista[k]));
    }
    i = j + 1;
  }

  const ultimo = trechos[trechos.length - 1]!;
  const texto = trechos.length === 1 ? ultimo : `${trechos.slice(0, -1).join(', ')} e ${ultimo}`;
  return `${rotulo}${lista.length > 1 ? 's' : ''} ${texto}`;
}

/**
 * Separa os `n` primeiros itens (que ficam juntos do título e da observação) do resto.
 * Não altera a lista de entrada. `n` maior que a lista deixa tudo em `junto`.
 */
export function dividirJunto<T>(lista: T[], n: number): { junto: T[]; resto: T[] } {
  const k = Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
  return { junto: lista.slice(0, k), resto: lista.slice(k) };
}
