'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound, useRouter, useSearchParams } from 'next/navigation';
import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Lock, Search, Trophy, Zap, ArrowRight, Play,
} from 'lucide-react';
import api from '@/services/api';
import styles from '../curso.module.css';
import ConteudoLicao from '../_componentes/ConteudoLicao';
import Avaliacao, { type MinhaAvaliacao } from '../_componentes/Avaliacao';
import { Carregando, Bloqueado, ErroCarregar } from '../_componentes/CursoEstados';
import { useCursoAcesso } from '../_componentes/useCursoAcesso';
import { CONTAGENS } from '../_conteudo/kit-fechamento';
import {
  getCurso, licoesDo, licoesBase, conquistasDo, calcularProgresso, nivelPorXp, bonusLiberado,
  type Curso, type ModuloCurso, type Licao, type Missoes,
} from '../_conteudo/cursos.config';

// Início do curso e lição, na mesma rota. A lição tem endereço próprio
// (?licao=modulo:licao): o Voltar do celular volta para o início do curso, e o
// link da lição pode ser mandado para alguém.
//
// Esta tela serve QUALQUER curso do registro (cursos.config.ts). Curso novo não
// precisa de página nova. Visual: tema claro do app (tokens), sem modo escuro.

const SLUG_FECHA_VENDAS = 'kit-fechamento';

export default function CursoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const curso = getCurso(slug);
  if (!curso) notFound();
  // useSearchParams pede Suspense: sem ele o build da rota falha.
  return (
    <Suspense fallback={<div className={styles.pagina}><Carregando /></div>}>
      <CursoConteudo curso={curso} />
    </Suspense>
  );
}

function CursoConteudo({ curso }: { curso: Curso }) {
  const router = useRouter();
  const licaoId = useSearchParams().get('licao');
  const { estado, acesso, tentarDeNovo } = useCursoAcesso();

  const [missoes, setMissoes] = useState<Missoes | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<MinhaAvaliacao[]>([]);
  /** Lições concluídas nesta sessão. Antes de qualquer conclusão vale o que veio do servidor. */
  const [feitosLocal, setFeitosLocal] = useState<string[] | null>(null);
  /** Módulo aberto na lista. undefined = o da próxima lição. */
  const [aberto, setAberto] = useState<string | null | undefined>(undefined);
  const [ganhou, setGanhou] = useState<{ xp: number; conquista?: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  /** id da lição cujo "concluir" falhou ao salvar */
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  /** slug do módulo que acabou de ser concluído: abre a avaliação dele */
  const [avaliarModulo, setAvaliarModulo] = useState<string | null>(null);

  const liberado = estado === 'liberado';

  useEffect(() => {
    if (!liberado) return;
    // Missões da plataforma (empresa, cliente, documento) destravam o bônus.
    api.get('/kit/missoes').then(({ data }) => setMissoes(data)).catch(() => {});
    api.get(`/kit/avaliacoes?curso=${curso.slug}`)
      .then(({ data }) => setAvaliacoes(data.avaliacoes ?? []))
      .catch(() => {});
  }, [liberado, curso.slug]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [licaoId]);

  useEffect(() => {
    if (!ganhou) return;
    const t = setTimeout(() => setGanhou(null), 3600);
    return () => clearTimeout(t);
  }, [ganhou]);

  if (estado === 'carregando') return <div className={styles.pagina}><Carregando /></div>;
  if (estado === 'erro') return <div className={styles.pagina}><ErroCarregar aoTentar={tentarDeNovo} /></div>;
  if (estado === 'bloqueado') return <div className={styles.pagina}><Bloqueado nome={curso.nome} /></div>;

  const TODAS = licoesDo(curso);
  const BASE = licoesBase(curso);
  const CONQUISTAS = conquistasDo(curso);
  const feitos = feitosLocal ?? acesso?.progresso ?? [];
  const prog = calcularProgresso(curso, feitos);
  const nivel = nivelPorXp(curso, prog.xp);
  const liberadoBonus = (m: ModuloCurso) => bonusLiberado(m, curso, prog.feitos, missoes);
  const moduloDa = (id: string) => curso.modulos.find((m) => m.licoes.some((l) => l.id === id));
  const hrefInicio = `/cursos/${curso.slug}`;
  const hrefLicao = (id: string) => `${hrefInicio}?licao=${encodeURIComponent(id)}`;
  // "Continuar" nunca aponta para lição de módulo bônus ainda travado.
  const proxima = prog.proxima && !liberadoBonus(prog.proxima.modulo) ? null : prog.proxima;
  const feitasBase = BASE.filter((l) => prog.feitos.has(l.id)).length;
  const temRespostas = curso.slug === SLUG_FECHA_VENDAS;

  // ── Concluir uma lição: só vale quando o servidor confirma ────────────────
  async function concluir(licao: Licao, modulo: ModuloCurso) {
    if (prog.feitos.has(licao.id) || salvando) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      await api.post('/kit/progresso', { modulo: licao.id, concluido: true });
    } catch {
      // Não finge que salvou: a lição continua pendente e a pessoa tenta de novo.
      setErroSalvar(licao.id);
      setSalvando(false);
      return;
    }
    setSalvando(false);

    const novos = [...feitos, licao.id];
    setFeitosLocal(novos);
    const antes = new Set(feitos);
    const depois = new Set(novos);
    const nova = CONQUISTAS.find((c) => !c.ganhou(antes) && c.ganhou(depois));
    const fechouModulo = modulo.licoes.every((l) => depois.has(l.id));
    setGanhou({ xp: licao.xp + (fechouModulo ? modulo.bonusXp : 0), conquista: nova?.nome });

    // Fechou o módulo? É a hora de perguntar o que ele achou, no pico da
    // sensação de "consegui", não uma semana depois por e-mail.
    if (fechouModulo && !avaliacoes.some((a) => a.modulo_slug === modulo.slug)) {
      setAvaliarModulo(modulo.slug);
    }
  }

  // ═════════════════════════ Vista: uma lição ═════════════════════════════
  if (licaoId) {
    const modulo = moduloDa(licaoId);
    if (!modulo) {
      return (
        <div className={styles.pagina}>
          <div className={styles.estado}>
            <h1>Não achei essa lição</h1>
            <p>O endereço pode estar desatualizado. Volte ao início do curso e escolha a lição de novo.</p>
            <Link href={hrefInicio} className={styles.btnPrimario}>Ir para o início do curso</Link>
          </div>
        </div>
      );
    }
    if (modulo.bonus && !liberadoBonus(modulo)) {
      return (
        <div className={styles.pagina}>
          <div className={styles.estado}>
            <Lock size={32} strokeWidth={1.6} aria-hidden="true" />
            <h1>Este módulo ainda está fechado</h1>
            <p>O bônus abre quando você termina as lições e usa a plataforma. As missões que faltam estão no início do curso.</p>
            <Link href={hrefInicio} className={styles.btnPrimario}>Ver o que falta</Link>
          </div>
        </div>
      );
    }

    const idx = modulo.licoes.findIndex((l) => l.id === licaoId);
    const licao = modulo.licoes[idx];
    const feito = prog.feitos.has(licao.id);
    const pos = TODAS.findIndex((l) => l.id === licao.id);
    const seguinte = TODAS.slice(pos + 1).find((l) => {
      const m = moduloDa(l.id);
      return m && (!m.bonus || liberadoBonus(m));
    }) ?? null;

    return (
      <div className={`${styles.pagina} ${erroSalvar === licao.id ? styles.comRodapeErro : styles.comRodape}`}>
        {ganhou && <ToastXp ganhou={ganhou} />}

        <Link href={hrefInicio} replace className={styles.voltar}>
          <ChevronLeft size={18} aria-hidden="true" /> Início do curso
        </Link>

        <header className={styles.licaoCab}>
          <span className={styles.licaoModulo}>Módulo {modulo.numero}: {modulo.titulo}</span>
          <h1 className={styles.licaoTitulo}>{licao.titulo}</h1>
          <p className={styles.licaoResumo}>{licao.resumo}</p>
          <div className={styles.licaoPasso}>
            <span>Lição {idx + 1} de {modulo.licoes.length}</span>
            <div className={styles.barra} aria-hidden="true">
              <i style={{ width: `${((idx + 1) / modulo.licoes.length) * 100}%` }} />
            </div>
            <span className={styles.licaoMeta}><Clock size={13} aria-hidden="true" /> {licao.minutos} min</span>
          </div>
        </header>

        <ConteudoLicao id={licao.id} />

        {avaliarModulo === modulo.slug && (
          <Avaliacao
            cursoSlug={curso.slug}
            moduloSlug={modulo.slug}
            titulo={`Módulo ${modulo.numero} concluído. O que você achou?`}
            subtitulo="Leva 5 segundos e é o que faz o material melhorar."
            onSalvo={(a) => setAvaliacoes((prev) => [...prev.filter((x) => x.modulo_slug !== a.modulo_slug), a])}
          />
        )}

        <div className={styles.rodapeFixo}>
          <div className={styles.rodapeFixoInterno}>
            {erroSalvar === licao.id && (
              <div className={styles.erroSalvar} role="alert">
                <span>Não deu para salvar.</span>
                <button type="button" className={styles.btnLinha} onClick={() => concluir(licao, modulo)}>
                  Tentar de novo
                </button>
              </div>
            )}
            <div className={styles.rodapeBotoes}>
              <button
                type="button"
                className={feito ? styles.btnFeito : styles.btnPrimario}
                onClick={() => concluir(licao, modulo)}
                disabled={feito || salvando}
              >
                <Check size={18} aria-hidden="true" />
                {feito ? 'Lição concluída' : salvando ? 'Salvando…' : 'Concluir lição'}
              </button>
              {seguinte ? (
                // replace: o Voltar do celular continua levando ao início do curso, não à lição anterior.
                <button type="button" className={styles.btnSecundario} onClick={() => router.replace(hrefLicao(seguinte.id))}>
                  Próxima <ChevronRight size={18} aria-hidden="true" />
                </button>
              ) : (
                <Link href={hrefInicio} replace className={styles.btnSecundario}>Voltar ao início</Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════ Vista: início do curso ═══════════════════════
  const modulosBase = curso.modulos.filter((m) => !m.bonus);
  const bonus = curso.modulos.filter((m) => m.bonus);
  const abertoEfetivo = aberto === undefined ? proxima?.modulo.slug ?? null : aberto;
  const comecou = prog.licoesFeitas > 0;

  return (
    <div className={styles.pagina}>
      {ganhou && <ToastXp ganhou={ganhou} />}

      <header className={styles.topo}>
        <h1>{curso.nome}</h1>
        <p>{curso.descricao}</p>
      </header>

      {temRespostas && (
        <Link href={`${hrefInicio}/respostas`} className={styles.btnGrande}>
          <Search size={20} aria-hidden="true" /> Buscar uma objeção
        </Link>
      )}

      <section className={styles.continuar} aria-label="Seu progresso">
        <div className={styles.continuarTopo}>
          <strong>{proxima ? (comecou ? 'Continuar de onde parei' : 'Começar o curso') : 'Curso concluído'}</strong>
          <span>{feitasBase} de {BASE.length} lições</span>
        </div>
        <div
          className={styles.barra}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={BASE.length}
          aria-valuenow={feitasBase}
          aria-label="Lições concluídas"
        >
          <i style={{ width: `${BASE.length ? (feitasBase / BASE.length) * 100 : 0}%` }} />
        </div>
        {proxima ? (
          <>
            <p className={styles.proximaLabel}>Próxima: {proxima.licao.titulo}</p>
            <Link href={hrefLicao(proxima.licao.id)} className={styles.btnPrimario}>
              <Play size={16} aria-hidden="true" /> {comecou ? 'Continuar' : 'Começar'}
            </Link>
          </>
        ) : (
          <div className={styles.concluidoMsg}><Trophy size={20} aria-hidden="true" /> Você concluiu as {BASE.length} lições.</div>
        )}
      </section>

      <h2 className={styles.secaoTitulo}>Os módulos</h2>
      <p className={styles.contagens}>
        {BASE.length} lições em {modulosBase.length} módulos
        {bonus.length > 0 && <>, mais {bonus.reduce((n, m) => n + m.licoes.length, 0)} de bônus</>}.
        {temRespostas && <> Dentro delas, {CONTAGENS.objecoes} objeções e {CONTAGENS.mensagens} mensagens prontas.</>}
      </p>

      <ul className={styles.modulos}>
        {[...modulosBase, ...bonus].map((m) => {
          const feitasNoModulo = m.licoes.filter((l) => prog.feitos.has(l.id)).length;
          const completo = feitasNoModulo === m.licoes.length;
          const travado = !!m.bonus && !liberadoBonus(m);
          const expandido = abertoEfetivo === m.slug;
          const painel = `painel-${m.slug}`;

          return (
            <li key={m.slug} className={`${styles.modulo} ${completo ? styles.moduloCompleto : ''}`}>
              <button
                type="button"
                className={styles.moduloBtn}
                aria-expanded={expandido}
                aria-controls={painel}
                onClick={() => setAberto(expandido ? null : m.slug)}
              >
                <span className={styles.moduloNum} aria-hidden="true">
                  {travado ? <Lock size={16} /> : completo ? <Check size={16} strokeWidth={3} /> : m.bonus ? '+' : m.numero}
                </span>
                <span className={styles.moduloTxt}>
                  <span className={styles.moduloTitulo}>{m.titulo}</span>
                  <span className={styles.moduloSub}>{m.subtitulo}</span>
                  <span className={styles.moduloQtd}>
                    {travado
                      ? `${m.licoes.length} lições. Abre quando você usa a plataforma`
                      : `${feitasNoModulo} de ${m.licoes.length} ${m.licoes.length === 1 ? 'lição' : 'lições'}`}
                  </span>
                </span>
                <ChevronDown size={20} className={expandido ? `${styles.seta} ${styles.setaAberta}` : styles.seta} aria-hidden="true" />
              </button>

              {expandido && travado && (
                <div id={painel} className={styles.bonusInfo}>
                  <p>
                    Este módulo abre quando você termina o curso e usa a plataforma de verdade. São {m.licoes.length} lições
                    sobre vender para empresa: o projeto que vale por três residenciais.
                  </p>
                  <ul className={styles.missoes}>
                    {(m.requisitos ?? []).map((r) => {
                      const ok = requisitoFeito(r.id, BASE, prog.feitos, missoes);
                      return (
                        <li key={r.id} className={ok ? styles.missaoOk : ''}>
                          <span className={styles.missaoCheck} aria-hidden="true">{ok && <Check size={13} strokeWidth={3} />}</span>
                          <span className={styles.missaoTexto}>
                            <strong>{r.label}</strong>
                            <span>{r.dica}</span>
                          </span>
                          {!ok && r.href && (
                            <Link href={r.href} className={styles.missaoIr}>Fazer <ArrowRight size={13} aria-hidden="true" /></Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {expandido && !travado && (
                <div id={painel} className={styles.moduloLicoes}>
                  {m.licoes.map((l, i) => {
                    const feita = prog.feitos.has(l.id);
                    const atual = proxima?.licao.id === l.id;
                    return (
                      <Link
                        key={l.id}
                        href={hrefLicao(l.id)}
                        className={`${styles.licaoLink} ${feita ? styles.licaoFeita : ''} ${atual ? styles.licaoAtual : ''}`}
                      >
                        <span className={styles.licaoBolha} aria-hidden="true">{feita ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
                        <span className={styles.licaoInfo}>
                          <strong>{l.titulo}</strong>
                          <span>{l.resumo}</span>
                        </span>
                        <span className={styles.licaoMin}>{l.minutos} min</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Curso concluído e ainda sem avaliação: pede AQUI, onde ele volta depois de fechar a última lição. */}
      {prog.pctCurso === 100 && !avaliacoes.some((a) => a.modulo_slug === '') && (
        <Avaliacao
          cursoSlug={curso.slug}
          titulo="Você concluiu o curso. Vale 5 estrelas?"
          subtitulo="Sua avaliação ajuda outro integrador a decidir e nos diz o que melhorar."
          pedirAutorizacao
          onSalvo={(a) => setAvaliacoes((prev) => [...prev.filter((x) => x.modulo_slug !== ''), a])}
        />
      )}

      <details className={styles.rodapeXp}>
        <summary>
          <Zap size={14} aria-hidden="true" />
          <span>
            <b>{nivel.atual.nome}</b> · {prog.xp} XP · {prog.conquistas.length} de {CONQUISTAS.length} conquistas
          </span>
        </summary>
        <p className={styles.nota}>
          {nivel.proximo ? `Faltam ${nivel.faltam} XP para o nível ${nivel.proximo.nome}.` : 'Você está no nível máximo.'}
        </p>
        <div className={styles.medalhas}>
          {CONQUISTAS.map((c) => {
            const ganha = prog.conquistas.some((x) => x.id === c.id);
            return (
              <div key={c.id} className={`${styles.medalha} ${ganha ? styles.medalhaGanha : ''}`}>
                <strong>{c.nome}</strong>
                <span>{ganha ? 'Conquistada' : c.comoGanha}</span>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

/** As missões que o bônus pede: lições do curso e o que a pessoa já fez na plataforma. */
function requisitoFeito(id: string, base: Licao[], feitos: Set<string>, missoes: Missoes | null): boolean {
  if (id === 'licoes') return base.every((l) => feitos.has(l.id));
  if (id === 'empresa') return !!missoes?.empresa;
  if (id === 'cliente') return (missoes?.clientes ?? 0) > 0;
  if (id === 'documento') return (missoes?.documentos ?? 0) > 0;
  return false;
}

function ToastXp({ ganhou }: { ganhou: { xp: number; conquista?: string } }) {
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      Lição concluída. +{ganhou.xp} XP{ganhou.conquista ? `. Conquista: ${ganhou.conquista}` : ''}
    </div>
  );
}
