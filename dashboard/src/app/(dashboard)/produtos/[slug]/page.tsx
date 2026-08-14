'use client';

import { use, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { produtoPorSlug } from '@/lib/produtos';

/**
 * ROTA ANTIGA da mini LP. Hoje a página de venda é UMA só: a pública, em
 * `/lp/<slug>` — é ela que o anúncio abre e é pra ela que o cadeado leva.
 *
 * Esta rota continua existindo só pra não quebrar link já mandado (e-mail,
 * WhatsApp, print de conversa). Manda pra LP preservando `?ver=oferta`, que é
 * a prévia usada por quem já tem o produto.
 */
export default function ProdutoRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const previa = useSearchParams().get('ver') === 'oferta' ? '?ver=oferta' : '';
  const existe = !!produtoPorSlug(slug);

  useEffect(() => {
    router.replace(existe ? `/lp/${slug}${previa}` : '/produtos');
  }, [router, slug, previa, existe]);

  return null;
}
