'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { plugcashApi, money, duracao, type Curso } from '@/services/plugcash';
import { Marca, Cadeado, Check } from '../../Marca';
import styles from '../../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Página de venda de UM curso — a tela que o cadeado abre.
//
// Mesma estrutura pra todos os cursos, conteúdo vindo do banco (`pc_cursos.copy`,
// editável pelo /admin). É pública e serve tanto pro aluno logado que clicou no
// cadeado quanto pra tráfego externo com link direto.
//
// O que NÃO existe nesta página, por decisão do projeto: contador regressivo,
// vaga fictícia, depoimento inventado e "de R$ X por R$ Y" sem que o preço cheio
// tenha existido — este último é impedido pelo próprio banco (CHECK em
// pc_cursos). O público chegou de uma peça técnica de 7 minutos; artifício aqui
// contamina a marca principal, que é onde mora a venda de R$ 160 mil.
//
// A grade de aulas aparece INTEIRA, com duração. Transparência total: é o que
// separa "sei o que estou comprando" de "comprei no escuro e pedi reembolso".
// ─────────────────────────────────────────────────────────────────────────────

export default function PaginaDeVenda() {
  const { slug } = useParams<{ slug: string }>();
  const [curso, setCurso] = useState<Curso | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'nao_encontrado'>('carregando');

  useEffect(() => {
    plugcashApi.curso(slug)
      .then(({ data }) => { setCurso(data.curso); setEstado('ok'); plugcashApi.evento('curso_venda_view', { slug }); })
      .catch(() => setEstado('nao_encontrado'));
  }, [slug]);

  if (estado === 'carregando') return <div className={styles.pc} />;

  if (estado === 'nao_encontrado' || !curso) {
    return (
      <div className={styles.pc}>
        <div className={styles.wrap}>
          <header className={styles.topo}><Marca /></header>
          <div className={styles.secao}>
            <div className={styles.vazio}>
              Este curso ainda não está aberto. Volte pelo <Link href="/plugcash/app">seu painel</Link>.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const copy = curso.copy || {};
  const total = curso.aulas.reduce((s, a) => s + (a.duracao_seg || 0), 0);
  const parcela = curso.parcelas > 0 ? curso.preco_centavos / curso.parcelas : 0;

  return (
    <div className={styles.pc}>
      {/* 1 · Hero — fundo preto */}
      <section className={styles.vendaHero}>
        <div className={styles.wrap}>
          <header className={styles.topo} style={{ borderBottom: 0, marginBottom: 24 }}>
            <Marca escuro />
            <Link href="/plugcash/app" className={`${styles.btn} ${styles.btnFantasma}`}>Meu painel</Link>
          </header>

          <div className={styles.vendaGrid}>
            <div>
              <h1 className={styles.heroTitulo}>{curso.titulo}</h1>
              {curso.subtitulo && <p className={styles.heroSub}>{curso.subtitulo}</p>}
              <div className={styles.heroAcoes}>
                <BotaoComprar curso={curso} />
                <span style={{ color: '#cfcfcf', fontSize: 14 }}>
                  {curso.aulas.length} aulas{total ? ` · ${duracao(total)}` : ''}
                </span>
              </div>
            </div>

            {/* Vídeo de vendas (3–4 min). Sem URL cadastrada, o espaço não vira
                player quebrado nem "em breve": simplesmente não aparece. */}
            {copy.video_url && (
              <div>
                <video src={copy.video_url} controls playsInline
                       style={{ width: '100%', borderRadius: 20, background: '#000' }} />
              </div>
            )}
          </div>
        </div>
      </section>

      <div className={styles.wrap}>
        {/* 2 · A dor */}
        {!!copy.dor?.length && (
          <section className={styles.vendaBloco}>
            <h2 className={styles.secaoTitulo}>Se isso é o seu dia hoje</h2>
            <p className={styles.secaoSub}>É exatamente aqui que este curso entra.</p>
            <ul className={styles.lista}>{copy.dor.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </section>
        )}

        {/* 3 · Grade de aulas — completa, com duração */}
        {curso.aulas.length > 0 && (
          <section className={styles.vendaBloco}>
            <h2 className={styles.secaoTitulo}>O que você vai assistir</h2>
            <p className={styles.secaoSub}>A grade inteira, sem surpresa depois da compra.</p>
            <ul className={styles.aulas} style={{ gap: 10 }}>
              {curso.aulas.map((a) => (
                <li key={a.id} className={styles.aula} style={{ fontSize: 15, color: '#0A0A0A' }}>
                  {a.gratuita ? <Check /> : <Cadeado />}
                  <span>{a.titulo}</span>
                  <span className={styles.aulaDuracao}>{duracao(a.duracao_seg)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 4 · O que vem junto */}
        {!!copy.entregas?.length && (
          <section className={styles.vendaBloco}>
            <h2 className={styles.secaoTitulo}>O que vem junto</h2>
            <ul className={styles.lista}>{copy.entregas.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </section>
        )}

        {/* 5 · Para quem é e para quem NÃO é.
            O bloco "não é" precisa ser honesto de verdade — é ele que evita o
            reembolso, e reembolso aqui queima a base do SolarDoc junto. */}
        {(!!copy.para_quem?.length || !!copy.nao_e_para?.length) && (
          <section className={styles.vendaBloco}>
            <div className={styles.duasColunas}>
              {!!copy.para_quem?.length && (
                <div className={styles.card}>
                  <h3 className={styles.secaoTitulo} style={{ fontSize: 18 }}>É para você se…</h3>
                  <ul className={styles.lista} style={{ fontSize: 15 }}>
                    {copy.para_quem.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
              {!!copy.nao_e_para?.length && (
                <div className={styles.card}>
                  <h3 className={styles.secaoTitulo} style={{ fontSize: 18 }}>Não é para você se…</h3>
                  <ul className={styles.lista} style={{ fontSize: 15 }}>
                    {copy.nao_e_para.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 6 · Preço */}
        <section className={styles.vendaBloco}>
          <h2 className={styles.secaoTitulo}>Preço</h2>
          <p className={styles.precoGrande}>{money(curso.preco_centavos)}</p>
          {curso.parcelas > 1 && (
            <p className={styles.precoNota}>
              ou {curso.parcelas}× de {money(Math.round(parcela))} no cartão
            </p>
          )}
          <p className={styles.precoNota}>
            O valor pago aqui abate no upgrade para Credenciamento Integrador ou Mentoria Investidor.
          </p>
          <div style={{ marginTop: 20 }}><BotaoComprar curso={curso} /></div>
        </section>

        {/* 7 · Garantia */}
        <section className={styles.vendaBloco}>
          <h2 className={styles.secaoTitulo}>Garantia</h2>
          <p className={styles.secaoSub} style={{ fontSize: 16 }}>
            {copy.garantia
              || '7 dias. Não serviu, você pede o reembolso integral e fica com o material que já baixou.'}
          </p>
        </section>

        {/* 8 · FAQ */}
        {!!copy.faq?.length && (
          <section className={styles.vendaBloco}>
            <h2 className={styles.secaoTitulo}>Perguntas</h2>
            {copy.faq.map((f, i) => (
              <details key={i} className={styles.faq}>
                <summary>{f.p}</summary>
                <p>{f.r}</p>
              </details>
            ))}
          </section>
        )}

        {/* 9 · CTA final */}
        <section className={styles.vendaBloco} style={{ textAlign: 'center' }}>
          <BotaoComprar curso={curso} />
        </section>
      </div>
    </div>
  );
}

// O link de checkout vem do banco, nunca do código. Enquanto ele não estiver
// cadastrado no /admin, o botão não finge que compra — dizer "checkout em breve"
// e levar a lugar nenhum é o jeito mais rápido de perder a venda e a confiança.
function BotaoComprar({ curso }: { curso: Curso }) {
  if (!curso.checkout_url) {
    return (
      <span className={`${styles.btn} ${styles.btnPrimario}`} style={{ opacity: 0.5, cursor: 'default' }}>
        Checkout ainda não configurado
      </span>
    );
  }
  return (
    <a
      href={curso.checkout_url}
      className={`${styles.btn} ${styles.btnPrimario}`}
      onClick={() => plugcashApi.evento('checkout_start', { slug: curso.slug, valor: curso.preco_centavos })}
    >
      Desbloquear — {money(curso.preco_centavos)}
    </a>
  );
}
