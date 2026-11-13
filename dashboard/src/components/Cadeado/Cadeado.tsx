'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useAcessos } from '@/hooks/useAcessos';
import { produtoPorId } from '@/lib/produtos';
import { ehAdicional, useOfertaAdicionais } from '@/lib/loja/adicionais';
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
  const acessos = useAcessos();
  const { tem, bastidor } = acessos;
  const p = produtoPorId(produto);
  // Com a oferta mensal ligada, as 4 ferramentas da loja viram adicional por mês. A Precificação segue avulsa.
  const oferta = useOfertaAdicionais();
  const carregando = acessos.carregando || oferta.carregando;
  const mensal = oferta.ligado && ehAdicional(produto);

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
          <Lock size={13} /> {p.tipo === 'curso' ? 'Curso' : 'Ferramenta'} · {mensal ? 'adicional mensal' : 'acesso liberado por compra'}
        </div>
        <h1>{p.nome}</h1>
        <p className={styles.promessa}>{p.promessa}</p>

        <div className={styles.acoes}>
          {/* Para a página de venda de DENTRO do app, a mesma do cadeado do menu: ali a pessoa compra por Pix
              sem sair. Quem não tem página interna (Precificação) é repassado para a /lp/ pela própria rota. */}
          <Link href={`/produtos/${p.slug}`} className={styles.btnPrimary}>
            Ver o que tem dentro
          </Link>
          {p.experimentar && (
            <Link href={p.experimentar.rota} className={styles.btnGhost}>
              {p.experimentar.texto}
            </Link>
          )}
        </div>

        <p className={styles.nota}>
          {mensal
            ? p.naAssinatura
              ? `Adicional de R$ ${oferta.precos.avulso} por mês, ou as 4 ferramentas por R$ ${oferta.precos.pacoteApp} por mês. O acesso vale enquanto você paga.`
              : p.noPlanoAnual
                ? `Vem inclusa no plano ANUAL do SolarDoc, e nesse caso fica sua pra sempre. Ou assine só esta ferramenta por R$ ${oferta.precos.avulso} por mês.`
                : `Adicional de R$ ${oferta.precos.avulso} por mês. O acesso vale enquanto você paga.`
          : p.naAssinatura
            ? 'Já vem incluso pra quem assina o SolarDoc — ou compre só esta ferramenta, uma vez, e use pra sempre.'
            : p.noPlanoAnual
              // O mensal não libera: dizer "vem na assinatura" aqui seria mandar
              // a pessoa procurar num lugar onde ela não vai achar.
              ? 'Vem inclusa no plano ANUAL do SolarDoc, e nesse caso fica sua pra sempre — ou compre só esta ferramenta, uma vez.'
              : 'Compra única. O acesso é seu enquanto sua conta existir.'}
        </p>
      </div>
    </div>
  );
}
