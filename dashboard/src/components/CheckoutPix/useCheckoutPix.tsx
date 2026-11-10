'use client';

import { useCallback, useState, type ReactNode } from 'react';
import CheckoutPix from './CheckoutPix';

/**
 * Como uma tela abre o checkout:
 *
 *   const { abrir, modal } = useCheckoutPix();
 *   <button onClick={() => abrir('inventario')}>Liberar por R$ 67</button>
 *   {modal}
 *
 * `onConfirmado` roda quando o Pix cai, para a tela se atualizar (o menu e a loja destravam sozinhos).
 */
export function useCheckoutPix(onConfirmado?: (produto: string) => void): { abrir: (produto: string) => void; modal: ReactNode } {
  const [produto, setProduto] = useState<string | null>(null);
  const abrir = useCallback((id: string) => setProduto(id), []);
  const modal = produto
    ? <CheckoutPix key={produto} produto={produto} onFechar={() => setProduto(null)} onConfirmado={onConfirmado} />
    : null;
  return { abrir, modal };
}
