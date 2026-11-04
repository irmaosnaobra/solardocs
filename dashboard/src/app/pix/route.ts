import { NextResponse } from 'next/server';

/**
 * solardoc.app/pix: o endereço curto do Pix (a Carla manda este link).
 *
 * Todo Pix do funil é o Pix automático do Asaas, que abre num modal da própria LP:
 * este endereço só redireciona para /?pagar=pix, sem consultar a api. Mantém a query que veio
 * (as UTMs) e, se não veio utm_source, marca utm_source=link_pix. 307 (não permanente) de
 * propósito: o destino pode mudar e nenhum cache deve guardá-lo.
 *
 * Pública: o proxy.ts libera exatamente '/pix' (e não o prefixo, que pegaria /pix-recorrente).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const entrada = new URL(request.url);
  const destino = new URL('/', request.url);
  entrada.searchParams.forEach((v, k) => { if (k !== 'pagar') destino.searchParams.append(k, v); });
  if (!destino.searchParams.get('utm_source')) destino.searchParams.set('utm_source', 'link_pix');
  destino.searchParams.set('pagar', 'pix');
  return NextResponse.redirect(destino, 307);
}
