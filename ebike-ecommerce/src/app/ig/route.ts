import { NextResponse, type NextRequest } from 'next/server';

import { BASE_PATH } from '../../config/basePath.mjs';

/**
 * `solardoc.app/bike/ig` — o endereço curto para o Instagram.
 *
 * Em comentário do Instagram link não é clicável: a pessoa LÊ e DIGITA. Uma URL
 * com `?utm_source=instagram&utm_medium=...` nunca sobrevive a isso — ou ela
 * desiste no meio, ou digita errado, ou digita só a parte antes do "?". Nos
 * três casos a visita chega sem origem e a gente não sabe se o comentário
 * funcionou.
 *
 * Então o curto é o que vai no comentário, e é aqui que a etiqueta é colada.
 * Quem digita `solardoc.app/bike/ig` entra marcado como Instagram e aparece
 * separado no funil do painel.
 */
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  // Atrás do rewrite do domínio, `req.nextUrl.origin` é o host da Vercel, não
  // o solardoc.app — a pessoa cairia num endereço que não reconhece, vindo de
  // um link que ela digitou à mão. SITE_URL é o endereço que o cliente vê.
  const base = process.env.SITE_URL ?? req.nextUrl.origin;
  const destino = new URL(`${BASE_PATH}/`, base);
  destino.searchParams.set('utm_source', 'instagram');
  destino.searchParams.set('utm_campaign', 'bike');
  // De qual toque veio: `comentario` é o padrão; a DM da automação manda `?de=dm`.
  const de = req.nextUrl.searchParams.get('de');
  destino.searchParams.set('utm_medium', de === 'dm' ? 'dm' : 'comentario');

  return NextResponse.redirect(destino, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
