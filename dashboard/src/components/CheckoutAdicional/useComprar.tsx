'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useCheckoutPix } from '@/components/CheckoutPix/useCheckoutPix';
import { ehAdicional, useOfertaAdicionais, type ItemAdicional } from '@/lib/loja/adicionais';
import CheckoutAdicional from './CheckoutAdicional';

/**
 * O botão de compra da loja, nos dois mundos:
 * - oferta mensal ligada: as 4 ferramentas (e o pacote) abrem o checkout do adicional mensal, cartão ou Pix;
 * - desligada, ou produto fora dos 4: o checkout Pix de compra única, como sempre.
 *
 *   const { abrir, modal } = useComprar();
 *   <button onClick={() => abrir('inventario')}>...</button>
 *   {modal}
 */
export function useComprar(onConfirmado?: (produto: string) => void): { abrir: (produto: string) => void; modal: ReactNode } {
  const oferta = useOfertaAdicionais();
  const pix = useCheckoutPix(onConfirmado);
  const abrirPix = pix.abrir;
  const [item, setItem] = useState<ItemAdicional | null>(null);

  const abrir = useCallback((id: string) => {
    if (oferta.ligado && (id === 'pacote' || ehAdicional(id))) setItem(id);
    else abrirPix(id);
  }, [oferta.ligado, abrirPix]);

  const modal = item
    ? <CheckoutAdicional key={item} item={item} onFechar={() => setItem(null)} onConfirmado={onConfirmado} />
    : pix.modal;
  return { abrir, modal };
}
