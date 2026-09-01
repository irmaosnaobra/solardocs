'use client';

import { useEffect, useRef, useState } from 'react';

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
  // O MESMO id vai no evento do navegador e no do servidor. É ele que faz a
  // Meta entender que os dois avisos são um lead só; sem ele, ela conta em
  // dobro e otimiza a entrega por um número inventado.
  const [eventoId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `e${Date.now()}${Math.round(Math.random() * 1e6)}`,
  );

  useEffect(() => {
    const form = ancora.current?.closest('form');
    if (!form) return;

    const aoEnviar = () => {
      marcarNaMeta(
        'Lead',
        { content_ids: [codigo], content_type: 'product', currency: 'BRL', value: preco },
        eventoId,
      );
    };
    // `submit` e não `click`: pega o Enter no teclado do celular também, e não
    // dispara quando o navegador barra o formulário por falta da forma de
    // pagamento.
    form.addEventListener('submit', aoEnviar);
    return () => form.removeEventListener('submit', aoEnviar);
  }, [codigo, preco, eventoId]);

  return (
    <>
      <input type="hidden" name="evento_id" value={eventoId} />
      <span ref={ancora} hidden />
    </>
  );
}
