'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { plugcashApi, money, type MeResposta, type Curso } from '@/services/plugcash';
import { Marca, Cadeado } from '../../Marca';
import { Chrome } from '../../Chrome';
import styles from '../../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo — a trilha inteira, para quem FOI PROCURAR.
//
// Ele saiu do painel de propósito. Nove cadeados na cara de quem acabou de pagar
// transforma a compra num inventário do que a pessoa ainda não tem; e escolher
// entre nove coisas no primeiro minuto é a forma mais rápida de não escolher
// nenhuma.
//
// O caminho normal é outro: a oferta certa aparece no fim da aula que cria a
// dor, uma de cada vez. Esta página existe pra quem quer ver o mapa completo —
// e por isso mostra a ORDEM da trilha, não uma vitrine.
// ─────────────────────────────────────────────────────────────────────────────

export default function Catalogo() {
  return (
    <Suspense fallback={<div className={styles.pc} />}>
      <Lista />
    </Suspense>
  );
}

function Lista() {
  const preview = useSearchParams().get('preview') === '1';
  const [dados, setDados] = useState<MeResposta | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await plugcashApi.me(preview);
    setDados(data);
  }, [preview]);

  useEffect(() => { carregar().catch(() => {}); }, [carregar]);

  if (!dados) return <div className={styles.pc} />;

  return (
    <Chrome
      titulo="A trilha completa"
      subtitulo="Do primeiro entendimento até operar o ponto. Você não precisa fazer tudo, nem nesta ordem — mas ela é a ordem em que as coisas costumam travar."
      preview={dados.preview}
      admin={dados.admin}
    >
      {dados.catalogo.length === 0 ? (
        <div className={styles.vazio}>Nenhum curso publicado ainda.</div>
      ) : (
        <div className={styles.grade}>
          {dados.catalogo.map((c, i) => (
            <CardTrilha key={c.id} curso={c} passo={i + 1} preview={preview} />
          ))}
        </div>
      )}
    </Chrome>
  );
}

// Card enxuto: capa, título, UMA linha, preço e botão. A grade de aulas fica na
// página de venda — aqui ela só empilhava texto que ninguém lê a 272px.
function CardTrilha({ curso, passo, preview }: { curso: Curso; passo: number; preview?: boolean }) {
  const travado = !curso.liberado;
  const q = preview ? '?preview=1' : '';
  const destino = travado ? `/plugcash/curso/${curso.slug}${q}` : `/plugcash/app/curso/${curso.slug}`;

  return (
    <article className={`${styles.curso} ${travado ? styles.travado : ''}`}>
      <div className={styles.cursoThumb}>
        {curso.thumb_url
          ? /* eslint-disable-next-line @next/next/no-img-element */
            <img src={curso.thumb_url} alt="" />
          : <Marca />}
        {travado && <span className={styles.cadeado}><Cadeado /></span>}
      </div>

      <div className={styles.cursoCorpo}>
        <p className={styles.cursoLinha} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Passo {passo}
        </p>
        <h3 className={styles.cursoTitulo}>{curso.titulo}</h3>
        {curso.subtitulo && <p className={styles.cursoLinha}>{curso.subtitulo}</p>}

        <div className={styles.cursoRodape}>
          {travado ? (
            <Link href={destino} className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
                  onClick={() => plugcashApi.evento('cadeado_click', { slug: curso.slug, origem: 'catalogo' })}>
              {curso.trava === 'nivel' ? 'Ver como liberar' : `Ver — ${money(curso.preco_centavos)}`}
            </Link>
          ) : (
            <>
              <div className={styles.barra}>
                <div className={styles.barraFill} style={{ width: `${curso.progresso_pct || 0}%` }} />
              </div>
              <p className={styles.barraTexto}>{curso.progresso_pct || 0}% concluído</p>
              <Link href={destino} className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
                    style={{ marginTop: 12 }}>
                Continuar
              </Link>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
