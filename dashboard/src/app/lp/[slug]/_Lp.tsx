'use client';

import Link from 'next/link';
import Logo from '@/components/Logo/Logo';
import { produtoPorSlug } from '@/lib/produtos';
import { useAcessos } from '@/hooks/useAcessos';
import { LpConteudo } from '../../(dashboard)/produtos/_LpConteudo';
import styles from './lp.module.css';

/**
 * Miolo da LP pública. Fica separado do `page.tsx` porque a página precisa ser
 * SERVIDOR pra exportar `generateMetadata` — e uma página de anúncio sem título
 * e sem imagem de prévia é um link que ninguém clica: colado no WhatsApp
 * aparece cinza, sem nada.
 */
export function LpPublica({ slug }: { slug: string }) {
  const p = produtoPorSlug(slug);
  const { carregando, tem, assinante, email } = useAcessos();
  if (!p) return null;

  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <Link href="/" className={styles.marca} aria-label="SolarDoc">
          <Logo className={styles.marcaImg} />
        </Link>
        {/* Esta LP é a MESMA página que o cadeado abre por dentro do app. Quem
            chega aqui logado não pode ler "Entrar" — ele já entrou, e o botão
            certo é o caminho de volta pro trabalho dele. O `email` só existe
            quando há sessão. */}
        {email
          ? <Link href="/dashboard" className={styles.entrar}>Voltar ao app</Link>
          : <Link href="/auth" className={styles.entrar}>Entrar</Link>}
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
