'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useAcessos } from '@/hooks/useAcessos';
import { produtoPorId } from '@/lib/produtos';
import styles from './Cadeado.module.css';

/**
 * Envolve a tela de um produto pago.
 *
 * Três estados, nessa ordem de importância:
 *   1. carregando — não mostra nada. Piscar "compre" na cara de quem já pagou
 *      é o jeito mais rápido de gerar chamado no suporte.
 *   2. tem acesso — a tela, sem nenhuma casca em volta.
 *   3. não tem — o convite, com o caminho pra mini LP. Nunca um beco sem saída.
 *
 * A tela do produto NÃO decide nada: quem responde é o servidor
 * (GET /produtos/acessos). Isto aqui é a cara do "não", não a tranca.
 */
export default function Cadeado({
  produto,
  children,
}: {
  produto: string;
  children: React.ReactNode;
}) {
  const { carregando, tem, bastidor } = useAcessos();
  const p = produtoPorId(produto);

  if (carregando) {
    return (
      <div className={styles.esperando}>
        <div className={styles.spinner} />
      </div>
    );
  }

  // Lançamento restrito: pra quem está fora, a ferramenta continua exatamente
  // como era ontem — sem cadeado, sem oferta, sem novidade nenhuma.
  if (!bastidor || tem(produto) || !p) return <>{children}</>;

  return (
    <div className={styles.wrap}>
      <div className={styles.card} style={{ ['--cor' as string]: p.cor }}>
        <div className={styles.selo}>
          <Lock size={13} /> {p.tipo === 'curso' ? 'Curso' : 'Ferramenta'} · acesso liberado por compra
        </div>
        <h1>{p.nome}</h1>
        <p className={styles.promessa}>{p.promessa}</p>

        <div className={styles.acoes}>
          {/* Vai direto pra LP publica (/lp/), como o cadeado do menu. A rota
              antiga ainda redireciona pra la', mas mandar direto poupa um salto
              — e a pagina de venda e' uma so'. */}
          <Link href={`/lp/${p.slug}`} className={styles.btnPrimary}>
            Ver o que tem dentro
          </Link>
          {p.experimentar && (
            <Link href={p.experimentar.rota} className={styles.btnGhost}>
              {p.experimentar.texto}
            </Link>
          )}
        </div>

        <p className={styles.nota}>
          {p.naAssinatura
            ? 'Já vem incluso pra quem assina o SolarDoc — ou compre só esta ferramenta, uma vez, e use pra sempre.'
            : 'Compra única. O acesso é seu enquanto sua conta existir.'}
        </p>
      </div>
    </div>
  );
}
