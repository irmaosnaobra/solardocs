import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth'];

export function proxy(request: NextRequest) {
  const token = request.cookies.get('solardoc_token')?.value;
  const { pathname } = request.nextUrl;

  const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path));

  if (!token && !isPublicPath) {
    return NextResponse.redirect(new URL('/auth?mode=login', request.url));
  }

  if (token && isPublicPath) {
    return NextResponse.redirect(new URL('/empresa', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|manifest.webmanifest|manifest.json).*)',
  ],
};
