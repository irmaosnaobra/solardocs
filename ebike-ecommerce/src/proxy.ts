import { NextResponse, type NextRequest } from 'next/server';

import { COOKIE_PAINEL, crachaValido, senhaConfigurada, sitePrivado } from './lib/portaria.ts';

/**
 * Duas portarias:
 *
 *  - `/painel` sempre exige senha. É onde aparecem custo e margem.
 *  - Com `SITE_PRIVADO=1`, a loja inteira também exige. Serve para deixar a
 *    página no ar só para nós enquanto ela não é divulgada.
 *
 * A entrada e o cron ficam de fora, senão não haveria como entrar nem atualizar.
 */
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const livre =
    pathname.startsWith('/painel/entrar') ||
    pathname.startsWith('/api/sync') ||
    // O otimizador de imagem do Next busca /foto pelo servidor, sem o cookie do
    // visitante. Barrar aqui quebraria todas as fotos com o site privado.
    pathname.startsWith('/foto/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';
  if (livre) return NextResponse.next();

  const protegido = pathname.startsWith('/painel') || sitePrivado();
  if (!protegido) return NextResponse.next();

  if (await crachaValido(req.cookies.get(COOKIE_PAINEL)?.value)) return NextResponse.next();

  const destino = req.nextUrl.clone();
  destino.pathname = '/painel/entrar';
  destino.search = `?de=${encodeURIComponent(pathname)}`;
  // Sem senha configurada ninguém entra, e a tela de entrada explica o porquê.
  if (!senhaConfigurada()) destino.searchParams.set('semSenha', '1');
  return NextResponse.redirect(destino);
}

export const config = {
  // O '/' solto não é luxo: com basePath o Next prefixa os matchers, e
  // '/((?!...).*)' vira '/bike/(...)', que exige a barra e mais alguma coisa.
  // Sem esta primeira entrada a home ficava aberta com o site privado ligado,
  // e só ela.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
