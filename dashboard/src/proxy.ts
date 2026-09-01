import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// '/oferta' = páginas de campanha que chegam por e-mail pra base inteira. Muita
// gente abre no celular deslogada; exigir sessão jogaria todo mundo no login e a
// oferta sumiria no caminho.
// '/kit' = LP de venda do Kit de Fechamento (public/kit/index.html). É página de
// venda para quem AINDA não tem conta — sem isto o proxy manda o visitante do
// anúncio direto pro login e a isca não vende nada.
// '/orc/' é o link do orçamento que o consultor manda pro cliente — quem abre
// não tem conta nenhuma. Sem estar aqui, o proxy devolve 307 pro /auth e o
// crawler do WhatsApp lê a tela de login em vez das og: tags do produto.
// '/eletroposto' = site institucional da Irmãos na Obra Mobilidade Elétrica
// (public/eletroposto/index.html). Existe pra ser achado no Google por quem
// nunca ouviu falar da empresa — sem estar aqui, o visitante e o robô do Google
// caem no /auth e a página não indexa nunca.
// '/robots.txt' e '/sitemap.xml' pelo mesmo motivo, e é pior: o Google PEDE os
// dois e recebia 307 pra tela de login. Arquivo estático de /public só é
// entregue se o proxy deixar passar.
// '/lib' = scripts compartilhados das páginas estáticas (telemetria.js). Toda LP
// pública pede esse arquivo deslogada; fora daqui o proxy responde 307 pro /auth
// e o <script> quebra calado em TODA página pública ao mesmo tempo.
// '/plugcash' = app do mercado de eletroposto. A landing e a página de venda de
// cada curso (/plugcash/curso/[slug]) são PÚBLICAS de propósito: o lead que foi
// desqualificado na LP compra sem ter conta ainda, e é o cadeado dentro do app
// que leva pra elas. As telas logadas (/plugcash/app, /plugcash/admin) não ficam
// desprotegidas por isso — cada uma confere o token e, principalmente, a API só
// devolve dado com Bearer válido. Sem esta linha, quem clica no cadeado toma 307
// pro login do SolarDoc e a venda morre na porta.
// '/assinar' = a página do link que a Giovanna manda com o cupom
// (solardoc.app/assinar?cupom=ACESSO19). Quem recebe NÃO tem conta — é isso que
// ela está indo criar. Sem esta linha o lead que clica no link cai no /auth, vê
// uma tela de login de um produto que ele ainda não assinou, e a venda morre na
// porta. Conferido em produção: sem ela, 307 pro /auth?mode=login.
// '/quase-la' = onde a Stripe joga quem clicou em "voltar" no checkout. Mesmo
// caso do /assinar, e o mais caro de todos: a pessoa está com a carteira na mão,
// veio da LP e AINDA NÃO TEM CONTA (no fluxo público a conta nasce depois do
// pagamento). Sem esta linha ela desiste do cartão e cai numa tela de login —
// conferido rodando o build local: 307 pro /auth?mode=login.
// '/lp/' = a LP pública de cada produto da loja, servida DENTRO da plataforma
// (src/app/lp/[slug]). É a mesma página que o cadeado abre por dentro, só que
// sem sessão: quem chega do anúncio não tem conta, e sem esta linha o proxy
// mandaria o visitante pro login antes de ele ver a oferta. Foi o motivo de o
// Kit e o LimpaPro terem precisado de site à parte até hoje.
// LP externa entra AQUI ou ela não existe pro visitante: sem token e fora desta
// lista, o proxy manda pro /auth e a página de venda vira tela de login — foi o
// "caiu na autenticação, todas, todas e todas" de antes.
// `/inventario-empresarial` não colide com a ferramenta `/inventario`: o
// startsWith é do mais específico pro mais curto, e '/inventario' não está na
// lista justamente porque é rota logada.
const PUBLIC_PATHS = ['/lp/', '/auth', '/_api', '/limpar-cache', '/p/', '/v/', '/orc/', '/gerador', '/io', '/apresentacao', '/privacidade', '/exclusao-de-dados', '/simular', '/kit', '/dimensionamento', '/calculadora', '/inventario-empresarial', '/oferta', '/eletroposto', '/ponto-certo', '/plugcash', '/assinar', '/quase-la', '/pix-automatico', '/lib', '/bike', '/kilova', '/robots.txt', '/sitemap.xml'];

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
  // O app tem que abrir SEMPRE na tela de atalho: no celular, todo acesso logado
  // via /auth (start_url antigo de instalações já existentes, ou pós-login) cai
  // no launcher /inicio. No PC segue pra plataforma como antes.
  if (token && pathname.startsWith('/auth')) {
    const ua = request.headers.get('user-agent') || '';
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return NextResponse.redirect(new URL(isMobile ? '/inicio' : '/empresa', request.url));
  }

  return NextResponse.next();
}

// Imagem estática NUNCA passa pelo proxy. Era lista de nome de arquivo (só o
// hero-produto.webp estava lá) e por isso as fotos novas da LP (founder-*.webp)
// levaram 307 pro /auth e apareceram quebradas pro visitante deslogado — o
// arquivo existia em /public, quem barrava era este matcher. Regra por extensão
// mata a classe do bug: toda imagem nova entra sozinha.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|manifest.json|sw.js|.*\\.(?:webp|png|jpg|jpeg|gif|svg|ico)$).*)',
  ],
};
