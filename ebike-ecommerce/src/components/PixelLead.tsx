'use client';

import { useEffect, useRef } from 'react';

import { marcarNaMeta } from './Pixel.tsx';

/**
 * Avisa a Meta quando a pessoa vai falar com o vendedor.
 *
 * É O evento que importa: a Meta otimiza a entrega do anúncio pelo que ela vê
 * acontecer, e o que acontece nesta loja é conversa no WhatsApp, não compra no
 * carrinho. Sem `Lead`, ela gasta o dinheiro procurando quem clica, não quem
 * compra.
 *
 * OUVE o formulário em vez de virar o botão: o botão que leva o lead embora é a
 * peça que não pode falhar, e o formulário é HTML puro de propósito. Se este
 * script não carregar, o clique continua funcionando — perde-se o evento, não a
 * venda.
 */
export function PixelLead({ codigo, preco }: { codigo: string; preco: number }) {
  const ancora = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = ancora.current?.closest('form');
    if (!form) return;

    const aoEnviar = () => {
      marcarNaMeta('Lead', {
        content_ids: [codigo],
        content_type: 'product',
        currency: 'BRL',
        value: preco,
      });
    };
    // `submit` e não `click`: pega o Enter no teclado do celular também, e não
    // dispara quando o navegador barra o formulário por falta da forma de
    // pagamento.
    form.addEventListener('submit', aoEnviar);
    return () => form.removeEventListener('submit', aoEnviar);
  }, [codigo, preco]);

  return <span ref={ancora} hidden />;
}
