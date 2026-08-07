'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { plugcashApi, money, MOTIVO_LABEL, type Servico } from '@/services/plugcash';
import { Marca, FaixaPreview } from '../../Marca';
import styles from '../../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Esteira de serviços — onde o negócio ganha margem.
//
// O conteúdo é aquisição; o dinheiro de verdade está no que a engenharia entrega:
// viabilidade, projeto, homologação, cotação pela rede de fornecedores.
//
// Duas decisões visíveis nesta tela:
//
// 1. PREÇO PÚBLICO E FIXO. Nada de "solicite um orçamento" dentro do
//    autoatendimento — quem entrou aqui não quer conversar, quer comprar.
// 2. CAPACIDADE REAL. Cada item tem teto mensal de entrega. Atingido o teto,
//    vira lista de espera e diz isso na cara. Não é gatilho de escassez: é o
//    número que a equipe aguenta sem estourar prazo, e estourar prazo aqui
//    contamina a marca que vende eletroposto de R$ 160 mil.
// ─────────────────────────────────────────────────────────────────────────────

export default function Esteira() {
  return (
    <Suspense fallback={<div className={styles.pc} />}>
      <Lista />
    </Suspense>
  );
}

function Lista() {
  const preview = useSearchParams().get('preview') === '1';
  const [servicos, setServicos] = useState<Servico[] | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const { data } = await plugcashApi.servicos(preview);
      setServicos(data.servicos);
    } catch {
      setErro('Não consegui carregar os serviços. Recarregue a página.');
    }
  }, [preview]);

  useEffect(() => { carregar(); plugcashApi.evento('esteira_view'); }, [carregar]);

  return (
    <div className={styles.pc}>
      {preview && <FaixaPreview />}
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca />
          <Link href="/plugcash/app" className={`${styles.btn} ${styles.btnFantasma}`}>Meu painel</Link>
        </header>

        <section className={styles.secao}>
          <h1 className={styles.secaoTitulo}>Serviços</h1>
          <p className={styles.secaoSub}>
            Quando você não quer aprender a fazer — quer que seja feito. Preço fechado,
            prazo declarado, executado pela nossa engenharia.
          </p>

          {erro && <div className={styles.aviso}>{erro}</div>}

          {servicos && servicos.length === 0 && (
            <div className={styles.vazio}>
              Nenhum serviço publicado ainda.
            </div>
          )}

          {servicos && servicos.length > 0 && (
            <div className={styles.grade}>
              {servicos.map((s) => <CardServico key={s.id} servico={s} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CardServico({ servico }: { servico: Servico }) {
  const esgotado = servico.disponivel === false;
  const travadoPorNivel = servico.liberado_pelo_nivel === false;

  return (
    <article className={`${styles.curso} ${esgotado ? styles.travado : ''}`}>
      <div className={styles.cursoCorpo} style={{ paddingTop: 20 }}>
        {servico.prioritario && (
          <span className={styles.badgePreco}>Resolve o seu caso</span>
        )}

        <h3 className={styles.cursoTitulo}>{servico.titulo}</h3>
        {servico.descricao && <p className={styles.cursoLinha}>{servico.descricao}</p>}

        {servico.entrega && (
          <p className={styles.cursoLinha}>
            <strong>Você recebe:</strong> {servico.entrega}
            {servico.prazo_dias ? ` · em até ${servico.prazo_dias} dias úteis` : ''}
          </p>
        )}

        {(servico.resolve_motivo || []).length > 0 && (
          <p className={styles.cursoLinha}>
            Para quem {servico.resolve_motivo.map((m) => MOTIVO_LABEL[m] || m).join(' ou ')}.
          </p>
        )}

        <div className={styles.cursoRodape}>
          <span className={styles.badgePreco}>{money(servico.preco_centavos)}</span>

          {/* A capacidade só aparece quando está apertando. Mostrar "12 de 30
              vagas" o mês inteiro seria transformar um limite operacional em
              teatro de escassez. */}
          {servico.vagas_restantes != null && servico.vagas_restantes <= 3 && !esgotado && (
            <p className={styles.barraTexto}>
              {servico.vagas_restantes === 1
                ? 'Resta 1 entrega na agenda deste mês.'
                : `Restam ${servico.vagas_restantes} entregas na agenda deste mês.`}
            </p>
          )}

          {esgotado ? (
            <>
              <p className={styles.barraTexto}>
                A agenda deste mês fechou. É o limite que a equipe entrega sem atrasar
                quem já contratou.
              </p>
              <a
                href={`https://wa.me/5534991360223?text=${encodeURIComponent(
                  `Quero entrar na lista de espera de: ${servico.titulo}`)}`}
                className={`${styles.btn} ${styles.btnFantasma} ${styles.btnBloco}`}
                style={{ marginTop: 12 }}
                onClick={() => plugcashApi.evento('servico_lista_espera', { slug: servico.slug })}
              >
                Entrar na lista de espera
              </a>
            </>
          ) : travadoPorNivel ? (
            <>
              <span className={styles.badgeNivel}>{servico.nivel_exigido}</span>
              <p className={styles.barraTexto}>
                Disponível no nível {servico.nivel_exigido}.
              </p>
            </>
          ) : servico.checkout_url ? (
            <a
              href={servico.checkout_url}
              className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
              style={{ marginTop: 12 }}
              onClick={() => plugcashApi.evento('checkout_start', {
                slug: servico.slug, tipo: 'servico', valor: servico.preco_centavos,
              })}
            >
              Contratar — {money(servico.preco_centavos)}
            </a>
          ) : (
            <span
              className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
              style={{ marginTop: 12, opacity: 0.5, cursor: 'default' }}
            >
              Checkout ainda não configurado
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
