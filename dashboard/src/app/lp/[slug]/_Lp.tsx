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
      {/* O TOPO É DO PRODUTO, não da plataforma.
          Quem chega aqui de um anúncio de Precificação nunca ouviu falar da
          SolarDoc: abrir com a marca dela em cima obriga a pessoa a entender uma
          plataforma antes de entender o que ela veio comprar. O nome do produto
          vem primeiro; a SolarDoc entra como o lugar ONDE a ferramenta roda —
          que é um argumento (não some quando troca de celular), não a moldura. */}
      <header className={styles.topo}>
        <span className={styles.marca}>
          <span className={styles.marcaNome} style={{ ['--cor' as string]: p.cor }}>{p.nome}</span>
          <span className={styles.marcaSub}>
            <Logo className={styles.marcaImg} /> funciona dentro da SolarDoc
          </span>
        </span>
        {/* Quem chega logado (veio do cadeado) não pode ler "Entrar" — ele já
            entrou. O `email` só existe quando há sessão. */}
        {email
          ? <Link href="/dashboard" className={styles.entrar}>Voltar ao app</Link>
          : <Link href="/auth" className={styles.entrar}>Já tenho conta</Link>}
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

        {/* SÓ PRA QUEM NÃO TEM CONTA. Quem já é da casa sabe como entra; quem
            veio do anúncio precisa saber o que acontece depois do cartão — é a
            dúvida que segura o clique num produto que ela nunca viu. */}
        {!email && !carregando && (
          <section className={styles.depois}>
            <h2 className={styles.depoisH2}>Como funciona depois que você compra</h2>
            <ol className={styles.passos}>
              <li>
                <span>1</span>
                <div>
                  <strong>Você paga e recebe um e-mail</strong>
                  <em>Com o link pra criar a sua senha. A conta nasce da compra — você não precisa se cadastrar antes.</em>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Entra e usa {p.nome}</strong>
                  <em>Abre do computador ou do celular, sem instalar nada. O acesso vale enquanto a sua conta existir.</em>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>O resto fica lá, se você quiser</strong>
                  <em>
                    Dentro da conta ficam as outras ferramentas e cursos, cada um comprado à parte — e a
                    assinatura da SolarDoc, se um dia fizer sentido. Você paga só pelo que usa, e nada
                    disso é obrigatório pra usar o que comprou hoje.
                  </em>
                </div>
              </li>
            </ol>
          </section>
        )}
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
