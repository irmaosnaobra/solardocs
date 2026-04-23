import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/auth?mode=login', '/auth?mode=register'];

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
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
