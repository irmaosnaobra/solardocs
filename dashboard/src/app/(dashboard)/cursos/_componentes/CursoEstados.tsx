'use client';

// Telas de estado do curso: carregando, erro de rede e bloqueio.

import Link from 'next/link';
import { ArrowRight, Lock, WifiOff } from 'lucide-react';
import styles from '../curso.module.css';
import { produtoPorId } from '@/lib/produtos';
import { CONTAGENS } from '../_conteudo/kit-fechamento';

export function Carregando({ texto = 'Carregando o curso…' }: { texto?: string }) {
  return <div className={styles.carregando} role="status">{texto}</div>;
}

/** Falha de rede ou do servidor: mostra o erro e deixa tentar de novo. */
export function ErroCarregar({ aoTentar }: { aoTentar: () => void }) {
  return (
    <div className={styles.estado} role="alert">
      <WifiOff size={36} strokeWidth={1.6} aria-hidden="true" />
      <h1>Não deu para carregar o curso</h1>
      <p>Confira a sua internet. O seu acesso não mudou.</p>
      <button type="button" className={styles.btnPrimario} onClick={aoTentar}>Tentar de novo</button>
    </div>
  );
}

/** O servidor respondeu e o curso não está na conta: leva à página de venda interna. */
export function Bloqueado({ nome }: { nome: string }) {
  const produto = produtoPorId('curso-fechamento');
  const href = `/produtos/${produto?.slug ?? 'kit-fecha-vendas'}`;
  const preco = produto?.preco;
  return (
    <div className={styles.estado}>
      <Lock size={36} strokeWidth={1.6} aria-hidden="true" />
      <h1>O {nome} ainda não está na sua conta</h1>
      <p>
        {CONTAGENS.objecoes} objeções com fala pronta e versão de WhatsApp, {CONTAGENS.mensagens} mensagens
        de prospecção e follow-up, em {CONTAGENS.licoes} lições.
      </p>
      <Link href={href} className={styles.btnPrimario}>
        Ver o {nome} <ArrowRight size={16} aria-hidden="true" />
      </Link>
      <span className={styles.estadoNota}>
        Vem na sua assinatura enquanto ela estiver ativa.
        {preco ? ` Ou compre à parte por R$ ${preco}: nesse caso o acesso é seu enquanto sua conta existir.` : ''}
      </span>
    </div>
  );
}
