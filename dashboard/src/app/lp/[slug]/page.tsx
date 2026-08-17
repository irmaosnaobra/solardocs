import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PRODUTOS_LOJA, produtoPorSlug } from '@/lib/produtos';
import { LpPublica } from './_Lp';

/**
 * LP PÚBLICA de um produto — a página de anúncio, servida pela própria
 * plataforma.
 *
 * Ela é EXTERNA no que importa: abre sem sessão, pra quem nunca ouviu falar da
 * SolarDoc. O `proxy.ts` libera `/lp/` justamente por isso. Cada ferramenta
 * vende sozinha e desemboca aqui dentro — sem site à parte, sem outro deploy e
 * sem a oferta envelhecendo em dois lugares.
 *
 * Esta camada é SERVIDOR só por causa da `generateMetadata`. Link de anúncio ou
 * de WhatsApp sem título e sem imagem aparece como um retângulo cinza e ninguém
 * clica — é a diferença entre uma página que vende e um link que morre no
 * compartilhamento. O miolo interativo vive em `_Lp.tsx`.
 */

/**
 * Uma rota por produto, geradas no build — menos as que só redirecionam. Gerar
 * HTML estático de uma página que nunca renderiza é trabalho jogado fora, e o
 * `redirect()` precisa rodar na requisição.
 */
export function generateStaticParams() {
  return PRODUTOS_LOJA.filter((p) => !p.lpPropria).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const p = produtoPorSlug(slug);
  if (!p) return { title: 'SolarDoc' };

  const url = `https://solardoc.app/lp/${p.slug}`;
  const titulo = `${p.nome} — SolarDoc`;
  // A promessa é a descrição: é a frase escrita pra vender, não um resumo
  // genérico. O que aparece no anúncio é o mesmo que aparece na página.
  const desc = p.promessa;

  return {
    title: titulo,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: 'SolarDoc',
      title: titulo,
      description: desc,
      locale: 'pt_BR',
      images: [{ url: 'https://solardoc.app/hero-produto.webp', width: 1200, height: 630, alt: p.nome }],
    },
    twitter: {
      card: 'summary_large_image',
      title: titulo,
      description: desc,
      images: ['https://solardoc.app/hero-produto.webp'],
    },
  };
}

export default async function LpPublicaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = produtoPorSlug(slug);
  if (!p) return notFound();
  // Produto com funil próprio: quem chega aqui vai pra página que JÁ vende, não
  // pra uma segunda versão dela. 307 (temporário) de propósito — 308 fica preso
  // no cache do navegador e não teria volta se um dia a página de cá for a boa.
  if (p.lpPropria) redirect(p.lpPropria);
  return <LpPublica slug={slug} />;
}
