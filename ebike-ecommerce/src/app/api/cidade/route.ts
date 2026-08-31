import { NextResponse, type NextRequest } from 'next/server';

import { buscarCidades } from '../../../lib/cidades.ts';

/**
 * Busca de cidade para quem não sabe o CEP.
 *
 * A lista dos 5.571 municípios fica no servidor: são 226 KB, e mandar isso para
 * o celular de quem só quer ver bike seria dez vezes o peso da própria página.
 * Aqui descem as dez linhas que a pessoa vai ler.
 *
 * Cacheável de verdade: a resposta para "uberl" é a mesma hoje e daqui a um
 * ano. Município novo no Brasil é evento de anos, não de dias.
 */
export const revalidate = 86400;

export async function GET(req: NextRequest) {
  const termo = req.nextUrl.searchParams.get('q') ?? '';
  const cidades = buscarCidades(termo);

  return NextResponse.json(
    { ok: true, cidades },
    { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } },
  );
}
