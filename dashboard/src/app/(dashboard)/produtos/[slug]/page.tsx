'use client';

import { use, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { produtoPorSlug } from '@/lib/produtos';
import { produtoDaLojaPorSlug } from '@/lib/loja/catalogo';
import { PAGINAS_DE_VENDA } from '@/lib/loja/paginasVenda';
import PaginaVenda from './PaginaVenda';

/**
 * `/produtos/<slug>`: a página de venda interna dos produtos da loja "Para crescer" (Estoque em Dia, Fecha Vendas e
 * LimpaPro). O cadeado do menu, o "Ver ..." da loja e o "Veja também" levam para cá.
 *
 * O resto continua como era, para não quebrar link já mandado (e-mail, WhatsApp, print de conversa):
 * - Venda Off-Grid: a venda mora dentro da própria ferramenta, que é aberta para testar (`/off-grid`).
 * - Qualquer outro produto do catálogo (Precificação): repassa para `/lp/<slug>`, preservando `?ver=oferta`.
 * - Slug que não existe: volta para a loja.
 */
export default function ProdutoPagina({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const loja = produtoDaLojaPorSlug(slug);
  const pagina = loja ? PAGINAS_DE_VENDA[loja.id] : undefined;
  const router = useRouter();
  const previa = useSearchParams().get('ver') === 'oferta' ? '?ver=oferta' : '';
  const destino = pagina ? null
    : loja ? loja.hrefVer
    : produtoPorSlug(slug) ? `/lp/${slug}${previa}`
    : '/produtos';

  useEffect(() => {
    if (destino) router.replace(destino);
  }, [router, destino]);

  if (!loja || !pagina) return null;
  return <PaginaVenda produto={loja} pagina={pagina} />;
}
