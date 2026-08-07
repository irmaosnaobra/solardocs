'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { isAuthenticated } from '@/services/auth';
import { Marca } from './Marca';
import styles from './pc.module.css';

// Landing do PlugCash. Deliberadamente sobre: quem chega aqui já veio de algum
// lugar (e-mail da compra, link do painel, atalho salvo). A venda de verdade
// acontece na página de desqualificação e nas páginas de cada curso.
//
// O que esta tela NÃO faz: mostrar preço da oferta de entrada. Ela existe só
// depois da desqualificação — se vazar pra cá, o lead que ia comprar um
// eletroposto de R$ 160 mil compra um curso e some da agenda.
export default function PlugcashHome() {
  // O cookie só existe no browser. useSyncExternalStore lê o valor do cliente sem
  // divergir do HTML do servidor (que sempre renderiza "deslogado") — é a leitura
  // que o React sabe reconciliar, ao contrário de setState dentro de efeito.
  const logado = useSyncExternalStore(
    () => () => {},
    () => isAuthenticated(),
    () => false,
  );

  return (
    <div className={`${styles.pc} ${styles.pcDark}`}>
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca escuro />
          <Link href={logado ? '/plugcash/app' : '/plugcash/entrar'}
                className={`${styles.btn} ${styles.btnFantasma}`}>
            {logado ? 'Meu painel' : 'Entrar'}
          </Link>
        </header>
      </div>

      <section className={styles.hero}>
        <div className={styles.wrap}>
          <h1 className={styles.heroTitulo}>
            O mercado de recarga elétrica, do ponto ao faturamento.
          </h1>
          <p className={styles.heroSub}>
            Conteúdo, engenharia e rede de fornecedores para quem quer instalar, operar
            ou executar eletropostos no Brasil.
          </p>
          <div className={styles.heroAcoes}>
            <Link href={logado ? '/plugcash/app' : '/plugcash/entrar'}
                  className={`${styles.btn} ${styles.btnPrimario}`}>
              {logado ? 'Ir para o meu painel' : 'Entrar na minha conta'}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
