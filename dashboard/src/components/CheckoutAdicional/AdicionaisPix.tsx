'use client';

import { useSearchParams } from 'next/navigation';
import { ehAdicional, useOfertaAdicionais, type ItemAdicional } from '@/lib/loja/adicionais';

/**
 * As ferramentas marcadas no order bump do /assinar chegam ao Pix do plano pela URL (`?adicionais=offgrid,inventario`
 * ou `?adicionais=pacote`). Aqui ficam a leitura e a linha do total, para a tela do Pix só repassar.
 */

/** Só ids conhecidos, sem repetição. O pacote cobre as 4 e anda sozinho. */
function lerItens(bruto: string | null): ItemAdicional[] {
  const itens = (bruto || '').split(',').map((x) => x.trim())
    .filter((x): x is ItemAdicional => x === 'pacote' || ehAdicional(x));
  return itens.includes('pacote') ? ['pacote'] : [...new Set(itens)];
}

/**
 * O pedaço do corpo do início do Pix com as ferramentas. Lido na hora do clique. Com a oferta desligada a api
 * ignora o campo, então não há o que conferir aqui.
 */
export function corpoAdicionaisDaUrl(): { adicionais?: ItemAdicional[] } {
  if (typeof window === 'undefined') return {};
  const itens = lerItens(new URLSearchParams(window.location.search).get('adicionais'));
  return itens.length ? { adicionais: itens } : {};
}

/** "Hoje você paga ..." com as ferramentas somadas. Nada quando não há ferramenta ou a oferta está desligada. */
export function LinhaAdicionaisPix({ plano, cupom, className }: {
  plano: number;
  cupom: { primeiroMes: number; precoCheio: number } | null;
  className?: string;
}) {
  const oferta = useOfertaAdicionais();
  const itens = lerItens(useSearchParams().get('adicionais'));
  if (!oferta.ligado || itens.length === 0) return null;
  const valor = itens.includes('pacote') ? oferta.precos.pacoteCheckout : itens.length * oferta.precos.avulso;
  // O cupom desconta só o plano; as ferramentas entram cheias desde o primeiro mês.
  return (
    <p className={className}>
      {cupom
        ? <>Hoje você paga <strong>R$ {cupom.primeiroMes + valor}.</strong> Depois, R$ {cupom.precoCheio + valor} por mês.</>
        : <>Hoje você paga <strong>R$ {plano + valor} por mês.</strong> R$ {plano} do plano e R$ {valor} das ferramentas.</>}
    </p>
  );
}
