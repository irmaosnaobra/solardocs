import 'server-only';

import bruto from '../data/municipios.json';

/**
 * Os 5.571 municípios do Brasil, com a coordenada de cada um.
 *
 * Fica no SERVIDOR, não no navegador: são 226 KB, e a loja é feita para o
 * celular no 4G. A busca vira uma chamada curta a `/api/cidade` e o que desce
 * são as dez linhas que a pessoa vai ver.
 *
 * Arquivo estático, resolvido uma vez e commitado. Geocodificar cidade na hora
 * do pedido é exatamente o erro que deixou 21 das 22 bases sem coordenada e
 * congelou isso no cache por um dia inteiro.
 *
 * Por que cidade e não estado: o estado sozinho erra a base de origem em 7 de
 * 16 cidades testadas — inclusive a nossa. Quem tocasse "MG" estando em
 * Uberlândia seria informado de que a bike vem de Betim, a 609 km, com a bike
 * no galpão da própria cidade dele.
 */

export type Cidade = { nome: string; uf: string; lat: number; lon: number };

type Linha = [nome: string, uf: string, lat: number, lon: number, capital: 0 | 1];

const LINHAS = bruto as unknown as Linha[];

/** Sem acento e em minúscula, para "sao jose" achar "São José". */
function chave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Índice montado uma vez por processo, não a cada busca. */
const INDICE = LINHAS.map((l) => ({ l, k: chave(l[0]) }));

export const TETO_DE_RESULTADOS = 10;

/**
 * Busca por nome, aceitando "cidade/UF" e "cidade UF".
 *
 * A ordem importa mais do que parece: quem digita "sao" quer São Paulo antes de
 * São Domingos do Maranhão. Por isso começa-com ganha de contém, e capital
 * ganha no empate — é a aposta certa quando não há nada mais para desempatar.
 */
export function buscarCidades(termo: string, teto = TETO_DE_RESULTADOS): Cidade[] {
  const limpo = termo.trim();
  if (limpo.length < 2) return [];

  // "Uberlândia/MG", "Uberlandia MG" e "Uberlandia - MG" caem todos aqui.
  const m = limpo.match(/^(.*?)[\s,/-]+([A-Za-z]{2})$/);
  const alvo = chave(m ? m[1] : limpo);
  const uf = m ? m[2].toUpperCase() : null;
  if (!alvo) return [];

  const achados: Array<{ l: Linha; peso: number }> = [];
  for (const { l, k } of INDICE) {
    if (uf && l[1] !== uf) continue;
    let peso: number;
    if (k === alvo) peso = 0;
    else if (k.startsWith(alvo)) peso = 1;
    else if (k.includes(alvo)) peso = 2;
    else continue;
    achados.push({ l, peso: peso * 2 + (l[4] ? 0 : 1) });
  }

  achados.sort((a, b) => a.peso - b.peso || a.l[0].localeCompare(b.l[0], 'pt-BR'));
  return achados.slice(0, teto).map(({ l }) => ({ nome: l[0], uf: l[1], lat: l[2], lon: l[3] }));
}
