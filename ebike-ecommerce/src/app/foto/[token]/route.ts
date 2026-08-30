import { NextResponse } from 'next/server';

import { urlDoToken } from '../../../lib/fotos.ts';

/**
 * Serve a foto do produto pelo nosso domínio. O `next/image` consome esta rota,
 * então quem inspeciona a página vê `/foto/...` e não o CDN do fornecedor.
 *
 * A resposta é imutável: o token contém o caminho, e caminho novo é foto nova.
 */
export const revalidate = 604800;

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = urlDoToken(token);
  if (!url) return new NextResponse('foto não encontrada', { status: 404 });

  const origem = await fetch(url, { next: { revalidate: 604800 } });
  if (!origem.ok || !origem.body) {
    return new NextResponse('foto indisponível', { status: 502 });
  }

  return new NextResponse(origem.body, {
    headers: {
      'Content-Type': origem.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
