'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { isAuthenticated } from '@/services/auth';
import {
  plugcashApi, money, duracao, MOTIVO_LABEL,
  type MeResposta, type Curso,
} from '@/services/plugcash';
import { Marca, Cadeado, Check } from '../Marca';
import { Chrome } from '../Chrome';
import styles from '../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard do aluno.
//
// A tela responde três perguntas, nesta ordem:
//   1. O que eu faço agora?  → bloco "seu próximo passo", UMA recomendação
//   2. O que eu já tenho?    → cursos liberados primeiro
//   3. O que está travado?   → cadeado, preço na cara, e o clique abre a página
//                              de venda daquele curso — comprável a qualquer hora
//
// O card travado mostra a GRADE DE AULAS INTEIRA. Não borramos o conteúdo pra
// criar curiosidade: saber exatamente o que está perdendo converte melhor que
// mistério, e mistério em produto técnico vira pedido de reembolso.
// ─────────────────────────────────────────────────────────────────────────────

const OBJETIVOS = [
  { id: 'entender',  texto: 'Quero entender como o mercado funciona' },
  { id: 'executar',  texto: 'Quero executar eletropostos para terceiros' },
  { id: 'investir',  texto: 'Quero investir no meu próprio eletroposto' },
  { id: 'monetizar', texto: 'Tenho um ponto e quero monetizar' },
];

const NIVEL_LABEL: Record<string, string> = {
  base: 'Base', integrador: 'Integrador', investidor: 'Investidor', projeto: 'Projeto',
};

export default function PlugcashApp() {
  return (
    <Suspense fallback={<div className={styles.pc} />}>
      <Painel />
    </Suspense>
  );
}

function Painel() {
  const router = useRouter();
  // Admin pode abrir com ?preview=1 pra ver o catálogo em rascunho. Quem decide
  // se o rascunho aparece é o servidor — aqui é só o pedido.
  const preview = useSearchParams().get('preview') === '1';
  const [dados, setDados] = useState<MeResposta | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await plugcashApi.me(preview);
      setDados(data);
    } catch {
      setErro('Não consegui carregar o seu painel. Recarregue a página.');
    }
  }, [preview]);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/plugcash/entrar?proximo=/plugcash/app'); return; }
    carregar();
    plugcashApi.evento('app_open');
  }, [router, carregar]);

  async function responderOnboarding(objetivo: string) {
    setSalvando(true);
    await plugcashApi.onboarding(objetivo).catch(() => {});
    await carregar();
    setSalvando(false);
  }

  if (erro) {
    return (
      <div className={styles.pc}>
        <div className={styles.wrap}><div className={styles.secao}><div className={styles.aviso}>{erro}</div></div></div>
      </div>
    );
  }

  if (!dados) {
    return <div className={styles.pc}><div className={styles.wrap}><div className={styles.secao} /></div></div>;
  }

  const { membro, catalogo, proximo_passo } = dados;
  const liberados = catalogo.filter((c) => c.liberado);
  const travados = catalogo.filter((c) => !c.liberado);

  // Onboarding é uma pergunta só, e ela define a trilha. Não vale enfileirar
  // cinco perguntas na porta de entrada de quem acabou de pagar.
  if (membro.onboarding_pendente) {
    return (
      <Chrome
        titulo="O que você quer fazer com eletroposto?"
        subtitulo="É a única pergunta. A resposta define o que aparece primeiro pra você."
        preview={dados.preview}
        admin={dados.admin}
      >
        <div style={{ maxWidth: 620 }}>
          <div className={styles.opcoes}>
              {OBJETIVOS.map((o) => (
                <button
                  key={o.id}
                  className={styles.opcao}
                  disabled={salvando}
                  onClick={() => responderOnboarding(o.id)}
                >
                  {o.texto}
                </button>
            ))}
          </div>
        </div>
      </Chrome>
    );
  }

  return (
    <Chrome
      titulo="Meu painel"
      subtitulo="O que fazer agora, o que já é seu e o que ainda está travado."
      nivel={NIVEL_LABEL[membro.nivel] || membro.nivel}
      preview={dados.preview}
      admin={dados.admin}
    >
      {proximo_passo && (
        <div className={styles.passo} style={{ marginBottom: 30 }}>
          <div>
            <p className={styles.passoRotulo}>Seu próximo passo</p>
            <h2 className={styles.passoTitulo}>{proximo_passo.curso.titulo}</h2>
            <p className={styles.passoPorque}>{textoDoPorque(proximo_passo, membro.motivo_descarte)}</p>
          </div>
          <Link
            href={`/plugcash/curso/${proximo_passo.curso.slug}${preview ? '?preview=1' : ''}`}
            className={`${styles.btn} ${styles.btnPrimario}`}
            onClick={() => plugcashApi.evento('proximo_passo_click', { slug: proximo_passo.curso.slug })}
          >
            Ver o que tem dentro
          </Link>
        </div>
      )}

      {/* O que ele JÁ TEM. É isso que o painel é: a mesa de trabalho de quem já
          comprou, não a vitrine de quem ainda não comprou. Os travados saíram
          daqui — nove cadeados na cara de quem acabou de pagar transforma a
          compra num aviso do que ele ainda não tem. */}
      {liberados.length > 0 ? (
        <section>
          <h2 className={styles.secaoTitulo}>
            {liberados.length === 1 ? 'Seu curso' : 'Seus cursos'}
          </h2>
          <p className={styles.secaoSub}>Continue de onde parou.</p>
          <div className={styles.grade}>
            {liberados.map((c) => <CardCurso key={c.id} curso={c} preview={preview} />)}
          </div>
        </section>
      ) : (
        <div className={styles.vazio}>
          Assim que a sua compra for confirmada, o curso aparece aqui.
        </div>
      )}

      {travados.length > 0 && (
        <p className={styles.secaoSub} style={{ marginTop: 28 }}>
          Existem outros {travados.length} cursos na trilha. Eles vão aparecer no
          momento certo — ou você pode ver todos agora no{' '}
          <Link href={`/plugcash/app/catalogo${preview ? '?preview=1' : ''}`}
                style={{ color: '#009B40', fontWeight: 700 }}>catálogo</Link>.
        </p>
      )}
    </Chrome>
  );
}

// Por que ESTE curso e não outro. Quando o motivo veio da régua do eletroposto, a
// frase repete a resposta que ele mesmo deu — é o que separa recomendação de
// anúncio. Sem motivo conhecido (usuário que entrou pelo SolarDoc, sem passar
// pela LP), a tela não inventa: fala do objetivo ou não fala nada.
function textoDoPorque(
  passo: NonNullable<MeResposta['proximo_passo']>,
  motivos: string[],
): string {
  if (passo.porque === 'motivo_descarte') {
    const casou = (passo.curso.resolve_motivo || []).find((m) => motivos.includes(m));
    const label = casou ? MOTIVO_LABEL[casou] : null;
    return label
      ? `No formulário você respondeu que ${label}. É exatamente o que este curso resolve.`
      : 'É o que resolve a falta que apareceu no seu formulário.';
  }
  if (passo.porque === 'objetivo') return 'Combina com o que você disse que quer fazer.';
  return 'É por onde a maioria começa.';
}

function CardCurso({ curso, preview }: { curso: Curso; preview?: boolean }) {
  const travado = !curso.liberado;
  const q = preview ? '?preview=1' : '';
  const destino = travado ? `/plugcash/curso/${curso.slug}${q}` : `/plugcash/app/curso/${curso.slug}`;

  return (
    <article className={`${styles.curso} ${travado ? styles.travado : ''}`}>
      <div className={styles.cursoThumb}>
        {curso.thumb_url
          ? <img src={curso.thumb_url} alt="" />
          : <Marca />}
        {travado && <span className={styles.cadeado}><Cadeado /></span>}
      </div>

      <div className={styles.cursoCorpo}>
        <h3 className={styles.cursoTitulo}>{curso.titulo}</h3>
        {curso.subtitulo && <p className={styles.cursoLinha}>{curso.subtitulo}</p>}

        {/* A grade de aulas NÃO entra aqui. Ela estava com quatro títulos por
            card; a 272px de largura, nove cards viravam uma parede de texto —
            e o lead que acabou de comprar não precisa escolher entre nove
            coisas. A grade inteira vive na página de venda, que é onde ela
            ajuda: lá a pessoa clicou de propósito pra saber o que tem dentro. */}

        <div className={styles.cursoRodape}>
          {travado ? (
            <>
              {curso.trava === 'nivel' ? (
                <span className={styles.badgeNivel}>{NIVEL_LABEL[curso.nivel_exigido || ''] || curso.nivel_exigido}</span>
              ) : (
                <span className={styles.badgePreco}>{money(curso.preco_centavos)}</span>
              )}
              <Link
                href={destino}
                className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
                style={{ marginTop: 12 }}
                onClick={() => plugcashApi.evento('cadeado_click', { slug: curso.slug })}
              >
                {curso.trava === 'nivel' ? 'Ver como liberar' : `Desbloquear — ${money(curso.preco_centavos)}`}
              </Link>
            </>
          ) : (
            <>
              <div className={styles.barra}>
                <div className={styles.barraFill} style={{ width: `${curso.progresso_pct || 0}%` }} />
              </div>
              <p className={styles.barraTexto}>{curso.progresso_pct || 0}% concluído</p>
              <Link
                href={destino}
                className={`${styles.btn} ${styles.btnPrimario} ${styles.btnBloco}`}
                style={{ marginTop: 12 }}
              >
                Continuar
              </Link>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
