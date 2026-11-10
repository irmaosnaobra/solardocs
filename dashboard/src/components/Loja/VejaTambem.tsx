'use client';

import { useAcessos } from '@/hooks/useAcessos';
import { quemFalta } from '@/lib/loja/catalogo';
import CartaoProduto from './CartaoProduto';
import s from './Loja.module.css';

/**
 * "Veja também": no fim de cada página de venda, os outros produtos que a pessoa ainda não tem. Ao abrir um produto
 * ela vê os demais, com cartão e botão de compra. Quem já tem tudo (ou ainda não foi respondida pelo servidor) não vê
 * a seção, nunca um cartão de compra para o que já é dela.
 */
export default function VejaTambem({ atual, onLiberar }: { atual: string; onLiberar: (id: string) => void }) {
  const { carregando, tem, bastidor } = useAcessos();
  if (carregando || !bastidor) return null;
  const faltam = quemFalta(tem, atual);
  if (faltam.length === 0) return null;
  return (
    <section className={s.veja} aria-labelledby="veja-tambem">
      <h2 id="veja-tambem">Veja também</h2>
      <p>Outras ferramentas e cursos que você ainda não tem.</p>
      <div className={s.grade}>
        {faltam.map((p) => <CartaoProduto key={p.id} produto={p} onLiberar={onLiberar} />)}
      </div>
    </section>
  );
}
