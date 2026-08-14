'use client';

import { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Logo from '@/components/Logo/Logo';
import { produtoPorSlug } from '@/lib/produtos';
import { useAcessos } from '@/hooks/useAcessos';
import { LpConteudo } from '../../(dashboard)/produtos/_LpConteudo';
import styles from './lp.module.css';

/**
 * LP PÚBLICA de um produto — a página de anúncio, DENTRO da plataforma.
 *
 * O pedido foi "não quero que a pessoa saia daqui". Antes, vender pra tráfego
 * frio exigia um site à parte (foi assim com o Kit e com o LimpaPro): outro
 * projeto, outro deploy, outro CSS, e a oferta envelhecendo em dois lugares.
 *
 * Aqui é a MESMA página da loja (`_LpConteudo`), servida numa rota que o
 * `proxy.ts` deixa passar sem sessão. Quem chega do anúncio vê a oferta e
 * compra; quem já é da casa e cai aqui logado vê o estado real da conta dele —
 * o mesmo componente resolve os dois porque o `useAcessos` falha pro lado do
 * cadeado quando não há sessão (sem token, nenhum produto: mostra a oferta).
 *
 * O que NÃO tem aqui de propósito: barra lateral, portão de CNPJ e limite de
 * plano. Nada disso faz sentido pra quem ainda não tem conta.
 */
export default function LpPublicaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const p = produtoPorSlug(slug);
  const { carregando, tem, assinante, email } = useAcessos();

  if (!p) return notFound();

  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <Link href="/" className={styles.marca} aria-label="SolarDoc">
          <Logo className={styles.marcaImg} />
        </Link>
        {/* Sem sessão isto leva pro cadastro; com sessão, pro app. O texto não
            promete "entrar" pra quem não tem conta. */}
        <Link href="/auth" className={styles.entrar}>Entrar</Link>
      </header>

      <main className={styles.corpo}>
        <LpConteudo
          p={p}
          slug={slug}
          liberado={tem(p.id)}
          carregando={carregando}
          email={email}
          assinante={assinante}
          dentroDoApp={false}
        />
      </main>

      <footer className={styles.rodape}>
        <span>SolarDoc · Irmãos na Obra</span>
        <span className={styles.rodapeLinks}>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/">Conhecer a plataforma</Link>
        </span>
      </footer>
    </div>
  );
}
