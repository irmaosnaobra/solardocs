'use client';

import { useSyncExternalStore } from 'react';

/**
 * O CEP de quem está comprando, guardado no navegador.
 *
 * Pergunta-se UMA vez e vale no site inteiro: a vitrine passa a dizer de onde
 * cada bike sai e a quantos quilômetros, e a página do produto já abre com a
 * entrega calculada. Sem isso, a pessoa só descobre o frete depois de escolher,
 * que é o momento mais caro para descobrir uma notícia ruim.
 *
 * Guarda também a coordenada, e é isso que evita 29 idas ao servidor: com o
 * ponto do cliente e o das bases, a distância de cada modelo é conta de
 * navegador.
 */

const CHAVE = 'corrente-entrega';
const EVENTO = 'corrente-entrega-mudou';
/** Quem fechou o convite sem responder não é convidado de novo. */
const CHAVE_PULOU = 'corrente-entrega-pulou';

export type Entrega = {
  /** Vazio quando a pessoa escolheu o estado em vez de digitar o CEP. */
  cep: string;
  cidade: string;
  uf: string;
  lat: number;
  lon: number;
  /**
   * True quando o ponto é da capital do estado, não do endereço. A loja então
   * mostra a distância com "≈" e não promete preço de frete: frete de
   * Presidente Prudente não é frete da capital de São Paulo.
   */
  aproximado?: boolean;
};

/**
 * O valor lido fica em cache pela STRING crua.
 *
 * `useSyncExternalStore` compara o retorno por identidade. Fazendo JSON.parse a
 * cada chamada, cada render devolvia um objeto novo, o React entendia que a
 * fonte tinha mudado e renderizava de novo, para sempre: "Maximum update depth
 * exceeded" e a página inteira caía no instante em que alguém digitava o CEP.
 */
let cacheBruto: string | null | undefined;
let cacheValor: Entrega | null = null;

function ler(): Entrega | null {
  let bruto: string | null;
  try {
    bruto = localStorage.getItem(CHAVE);
  } catch {
    // Aba anônima, armazenamento bloqueado: a loja funciona sem isto.
    return null;
  }

  if (bruto === cacheBruto) return cacheValor;
  cacheBruto = bruto;

  if (!bruto) {
    cacheValor = null;
    return null;
  }
  try {
    const e = JSON.parse(bruto) as Entrega;
    cacheValor = typeof e?.lat === 'number' && typeof e?.lon === 'number' ? e : null;
  } catch {
    cacheValor = null;
  }
  return cacheValor;
}

export function salvarEntrega(e: Entrega | null) {
  try {
    if (e) localStorage.setItem(CHAVE, JSON.stringify(e));
    else localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento, vale só nesta tela */
  }
  window.dispatchEvent(new Event(EVENTO));
}

/**
 * `useSyncExternalStore` em vez de estado com efeito: assim o cabeçalho e a
 * vitrine leem a MESMA fonte e mudam juntos quando o CEP troca, sem um contar
 * para o outro.
 */
export function useEntrega(): Entrega | null {
  return useSyncExternalStore(
    (avisar) => {
      window.addEventListener(EVENTO, avisar);
      window.addEventListener('storage', avisar);
      return () => {
        window.removeEventListener(EVENTO, avisar);
        window.removeEventListener('storage', avisar);
      };
    },
    ler,
    () => null,
  );
}

export function pularEntrega() {
  try {
    localStorage.setItem(CHAVE_PULOU, '1');
  } catch {
    /* sem armazenamento, o convite volta na próxima visita */
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function jaPulou(): boolean {
  try {
    return localStorage.getItem(CHAVE_PULOU) === '1';
  } catch {
    return false;
  }
}
