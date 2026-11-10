'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { brl, type EstadoLiberado, type ProdutoDaLoja } from '@/lib/loja/catalogo';
import s from './Loja.module.css';

/**
 * O cartão de um produto da loja. Duas caras:
 * - `liberado` vazio: imagem, nome, preço, promessa, "Liberar por R$ X" (abre o checkout) e "Ver ..." (página de venda).
 * - `liberado` preenchido: a pessoa já tem (posse, assinatura ou plano anual). Sem preço e sem compra: só "Abrir".
 */
export default function CartaoProduto({ produto: p, liberado, onLiberar }: {
  produto: ProdutoDaLoja;
  liberado?: EstadoLiberado | null;
  onLiberar?: (id: string) => void;
}) {
  const imagem = (
    <span className={s.imagem}>
      <Image src={p.imagem} alt={p.imgAlt} fill sizes="(max-width: 680px) 100vw, (max-width: 1180px) 50vw, 33vw" />
    </span>
  );

  if (liberado) {
    return (
      <article className={s.cartao} data-produto={p.id}>
        <Link href={p.rotaAbrir} aria-label={`Abrir ${p.nome}`} tabIndex={-1}>{imagem}</Link>
        <div className={s.corpo}>
          <span className={s.selo}><Check size={13} aria-hidden="true" />{liberado.titulo}</span>
          <h3>{p.nome}</h3>
          <p>{liberado.texto}</p>
          <div className={s.acoes}>
            <Link href={p.rotaAbrir} className={`${s.btn} ${s.btnPrim}`}>Abrir</Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={s.cartao} data-produto={p.id}>
      <Link href={p.hrefVer} aria-label={p.ver} tabIndex={-1}>{imagem}</Link>
      <div className={s.corpo}>
        <h3>{p.nome}</h3>
        <div className={s.preco}><strong>{brl(p.preco)}</strong><small>Um pagamento, sem mensalidade.</small></div>
        <p>{p.promessa}</p>
        <div className={s.acoes}>
          <button type="button" className={`${s.btn} ${s.btnPrim}`} onClick={() => onLiberar?.(p.id)}>
            Liberar por {brl(p.preco)}
          </button>
          <Link href={p.hrefVer} className={`${s.btn} ${s.btnSec}`}>{p.ver}</Link>
        </div>
      </div>
    </article>
  );
}
