'use client';

import { use, useEffect } from 'react';
import { notFound, useRouter, useSearchParams } from 'next/navigation';
import { produtoPorSlug } from '@/lib/produtos';
import { useAcessos } from '@/hooks/useAcessos';
import { LpConteudo } from '../_LpConteudo';

/**
 * Mini LP de um produto DENTRO do app — a página que o cadeado abre.
 *
 * O corpo vive em `_LpConteudo` e é o mesmo da LP pública (`/lp/[slug]`): duas
 * cópias da mesma oferta viram duas ofertas diferentes com o tempo.
 */
export default function ProdutoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const p = produtoPorSlug(slug);
  const { carregando, tem, assinante, email, bastidor } = useAcessos();
  const router = useRouter();
  /**
   * PRÉVIA DA OFERTA (?ver=oferta).
   *
   * Admin recebe TODOS os produtos automaticamente — é o certo pra usar a
   * plataforma, e é o que impedia o dono de ver a própria página de venda: ela
   * sempre abria no estado "você já tem, é só entrar".
   *
   * Só muda o que é DESENHADO. Não concede, não revoga, não grava nada.
   */
  const previa = useSearchParams().get('ver') === 'oferta';
  useEffect(() => {
    if (!carregando && !bastidor) router.replace('/dashboard');
  }, [carregando, bastidor, router]);

  if (!p) return notFound();

  return (
    <LpConteudo
      p={p}
      slug={slug}
      liberado={tem(p.id) && !previa}
      carregando={carregando}
      email={email}
      assinante={assinante}
      previa={previa}
      dentroDoApp
    />
  );
}
