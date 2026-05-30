import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth', '/_api', '/limpar-cache', '/p/', '/gerador', '/io', '/apresentacao'];

export function proxy(request: NextRequest) {
  const token = request.cookies.get('solardoc_token')?.value;
  const { pathname } = request.nextUrl;

  const isHome = pathname === '/';
  const isPublicPath = isHome || PUBLIC_PATHS.some(path => pathname.startsWith(path));

  // Curto-circuito VSL → cadastro. Quem veio da /apresentacao já foi vendido
  // pelo vídeo — a LP entre VSL e cadastro só atrapalha e vaza gente. Manda
  // direto pro fluxo de cadastro com plano VIP pré-selecionado. LP segue
  // acessível pra tráfego frio (Google/indicação) que não tem esse referer.
  if (isHome && !token) {
    const referer = request.headers.get('referer') || '';
    if (referer.includes('/apresentacao')) {
      return NextResponse.redirect(new URL('/auth?mode=register&plano=vip', request.url));
    }
  }

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
    '/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|manifest.webmanifest|manifest.json|sw.js).*)',
  ],
};
