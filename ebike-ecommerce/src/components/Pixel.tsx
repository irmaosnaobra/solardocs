'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { META_PIXEL } from '../config/pixel.ts';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Dispara um evento sem quebrar nada se o pixel estiver bloqueado. */
export function marcarNaMeta(evento: string, dados?: Record<string, unknown>) {
  try {
    window.fbq?.('track', evento, dados);
  } catch {
    /* bloqueador de anúncio: a loja segue igual */
  }
}

/**
 * O pixel da Meta, carregado depois que a página já está de pé.
 *
 * `afterInteractive` e não `beforeInteractive`: script de anúncio nunca pode
 * atrasar o que a pessoa veio ver. Numa loja feita para o 4G, a vitrine é a
 * prioridade e o pixel entra atrás.
 *
 * O PageView é disparado na TROCA DE ROTA também. A loja é uma aplicação de
 * página única: ir da vitrine para o modelo não recarrega nada, então o pixel
 * contaria uma visita e ficaria mudo pelo resto da navegação.
 *
 * O painel fica de fora: é tela interna, e mandar o acesso de vocês para a Meta
 * suja o público que ela usa para otimizar a entrega.
 */
export function Pixel() {
  const caminho = usePathname();
  const primeira = useRef(true);

  useEffect(() => {
    if (!caminho || caminho.startsWith('/painel')) return;
    // A primeira visita já é contada pelo `fbq('track','PageView')` de dentro do
    // script; repetir aqui contaria duas.
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    marcarNaMeta('PageView');
  }, [caminho]);

  if (caminho?.startsWith('/painel')) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
