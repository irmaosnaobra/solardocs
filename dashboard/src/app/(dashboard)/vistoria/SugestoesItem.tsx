'use client';

import { ChevronRight, ShoppingCart } from 'lucide-react';
import { TEXTOS_COMPRAS } from './comprasTextos';
import { preencher } from './useCompras';

// Faixa por item (seção 7.5, item 7): aparece abaixo dos botões de status quando o item está em Atenção ou Não
// conforme e abre a folha da lista filtrada naquele item. 48 px de altura, largura total.
//
//   sugestões e nada na lista  "Sugestões de compra: 4"
//   as duas coisas             "Na lista: 2. Sugestões: 4"
//   só linhas na lista         "Na lista: 2"
//   nenhuma das duas           não aparece
export default function SugestoesItem({
  sugestoes, naLista, aoAbrir,
}: {
  /** Quantas entradas do catálogo este item dispara e ainda não estão na lista nem foram dispensadas. */
  sugestoes: number;
  /** Quantas linhas da lista estão ligadas a este item. */
  naLista: number;
  aoAbrir: () => void;
}) {
  if (sugestoes <= 0 && naLista <= 0) return null;
  const texto = sugestoes > 0 && naLista > 0
    ? preencher(TEXTOS_COMPRAS.faixaAmbas, { a: naLista, n: sugestoes })
    : sugestoes > 0
      ? preencher(TEXTOS_COMPRAS.faixaSo, { n: sugestoes })
      : preencher(TEXTOS_COMPRAS.faixaLista, { a: naLista });
  return (
    <button type="button" className="vst-cmpFaixa" onClick={aoAbrir}>
      <ShoppingCart size={17} aria-hidden="true" />
      <span className="vst-cmpFaixaTxt">{texto}</span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  );
}
