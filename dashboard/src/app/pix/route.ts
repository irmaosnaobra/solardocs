import { NextResponse } from 'next/server';

/**
 * solardoc.app/pix: o endereço curto do Pix (a Carla manda este link).
 *
 * Pergunta à api qual é o checkout Pix da Kiwify (GET /payments/pix-url, que lê a env
 * SOLARDOC_PIX_CHECKOUT_URL) e redireciona 302 para ele. Sem URL, ou com a api fora do ar, cai em
 * /assinar: quem clicou nunca fica diante de uma página quebrada. 302 (não 308) de propósito:
 * a URL de destino muda quando o checkout muda, e nenhum cache pode guardá-la.
 *
 * Pública: o proxy.ts libera exatamente '/pix' (e não o prefixo, que pegaria /pix-recorrente).
 */
export const dynamic = 'force-dynamic';

// Em produção, o host fixo da api (o mesmo alvo do rewrite /_api em vercel.json): nada de depender de
// NEXT_PUBLIC_API_URL, que pode apontar para um alias velho e fazer o /pix cair no /assinar calado.
const API_BASE =
  process.env.NODE_ENV === 'production'
    ? 'https://api.solardoc.app'
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function urlDoPix(): Promise<string | null> {
  try {
    const r = await fetch(`${API_BASE}/payments/pix-url`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { url?: unknown };
    const url = typeof j.url === 'string' ? j.url.trim() : '';
    return /^https:\/\/[^\s]+$/i.test(url) ? url : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const destino = await urlDoPix();
  return NextResponse.redirect(destino ?? new URL('/assinar', request.url), 302);
}
