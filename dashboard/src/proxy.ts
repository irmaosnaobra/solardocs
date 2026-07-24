import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth', '/_api', '/limpar-cache', '/p/', '/v/', '/gerador', '/io', '/apresentacao'];

export function proxy(request: NextRequest) {
  const token = request.cookies.get('solardoc_token')?.value;
  const { pathname } = request.nextUrl;

  const isHome = pathname === '/';
  const isPublicPath = isHome || PUBLIC_PATHS.some(path => pathname.startsWith(path));

  // Antes existia um curto-circuito VSL → cadastro: quem vinha da /apresentacao
  // era jogado direto no /auth?mode=register&plano=vip, pulando a LP. Removido:
  // agora o CTA da VSL cai na LP (home) e o próprio lead escolhe o plano.

  if (!token && !isPublicPath) {
    return NextResponse.redirect(new URL('/auth?mode=login', request.url));
  }

  // Usuário logado tentando ver login/cadastro → manda pra dentro do app.
  // A landing pública (/) NÃO entra nesse redirect — fica acessível mesmo logado.
  if (token && pathname.startsWith('/auth')) {
    return NextResponse.redirect(new URL('/empresa', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|manifest.webmanifest|manifest.json|sw.js|hero-produto.webp).*)',
  ],
};
