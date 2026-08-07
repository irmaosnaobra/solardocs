'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthenticated, removeToken } from '@/services/auth';
import {
  plugcashApi, money, duracao, MOTIVO_LABEL,
  type MeResposta, type Curso,
} from '@/services/plugcash';
import { Marca, Cadeado, Check } from '../Marca';
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
  const router = useRouter();
  const [dados, setDados] = useState<MeResposta | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await plugcashApi.me();
      setDados(data);
    } catch {
      setErro('Não consegui carregar o seu painel. Recarregue a página.');
    }
  }, []);

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

  function sair() {
    removeToken();
    router.replace('/plugcash/entrar');
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
      <div className={styles.pc}>
        <div className={styles.wrap}>
          <header className={styles.topo}><Marca /></header>
          <div className={styles.secao}>
            <h1 className={styles.secaoTitulo}>O que você quer fazer com eletroposto?</h1>
            <p className={styles.secaoSub}>
              É a única pergunta. A resposta define o que aparece primeiro pra você.
            </p>
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
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pc}>
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca />
          <div className={styles.topoAcoes}>
            <span className={styles.nivel}>{NIVEL_LABEL[membro.nivel] || membro.nivel}</span>
            <Link href="/plugcash/app/servicos" className={`${styles.btn} ${styles.btnFantasma}`}>Serviços</Link>
            <Link href="/plugcash/app/conta" className={`${styles.btn} ${styles.btnFantasma}`}>Conta</Link>
            <button className={`${styles.btn} ${styles.btnFantasma}`} onClick={sair}>Sair</button>
          </div>
        </header>

        {proximo_passo && (
          <div className={styles.secao}>
            <div className={styles.passo}>
              <div>
                <p className={styles.passoRotulo}>Seu próximo passo</p>
                <h2 className={styles.passoTitulo}>{proximo_passo.curso.titulo}</h2>
                <p className={styles.passoPorque}>{textoDoPorque(proximo_passo, membro.motivo_descarte)}</p>
              </div>
              <Link
                href={`/plugcash/curso/${proximo_passo.curso.slug}`}
                className={`${styles.btn} ${styles.btnPrimario}`}
                onClick={() => plugcashApi.evento('proximo_passo_click', { slug: proximo_passo.curso.slug })}
              >
                Ver o que tem dentro
              </Link>
            </div>
          </div>
        )}

        {liberados.length > 0 && (
          <section className={styles.secao}>
            <h2 className={styles.secaoTitulo}>Continue de onde parou</h2>
            <p className={styles.secaoSub}>O que já é seu.</p>
            <div className={styles.grade}>
              {liberados.map((c) => <CardCurso key={c.id} curso={c} />)}
            </div>
          </section>
        )}

        <section className={styles.secao}>
          <h2 className={styles.secaoTitulo}>Catálogo</h2>
          <p className={styles.secaoSub}>
            Clique no cadeado pra ver a grade completa, o preço e o que o curso resolve.
          </p>
          {catalogo.length === 0 ? (
            <div className={styles.vazio}>
              Nenhum curso publicado ainda. Assim que a primeira trilha for gravada, ela aparece aqui.
            </div>
          ) : (
            <div className={styles.grade}>
              {travados.map((c) => <CardCurso key={c.id} curso={c} />)}
            </div>
          )}
        </section>
      </div>
    </div>
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

function CardCurso({ curso }: { curso: Curso }) {
  const travado = !curso.liberado;
  const destino = travado ? `/plugcash/curso/${curso.slug}` : `/plugcash/app/curso/${curso.slug}`;

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

        {/* Grade completa, com cadeado em cada aula quando travado. */}
        {curso.aulas.length > 0 && (
          <ul className={styles.aulas}>
            {curso.aulas.slice(0, 4).map((a) => (
              <li key={a.id} className={styles.aula}>
                {travado && !a.gratuita ? <Cadeado /> : <Check />}
                <span>{a.titulo}</span>
                <span className={styles.aulaDuracao}>{duracao(a.duracao_seg)}</span>
              </li>
            ))}
            {curso.aulas.length > 4 && (
              <li className={styles.aula}><span>+ {curso.aulas.length - 4} aulas</span></li>
            )}
          </ul>
        )}

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
