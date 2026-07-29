'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  MessageSquareQuote, Map, Calculator, FileSignature, Send, Repeat,
  Check, ChevronLeft, ChevronRight, Lock, Play, Trophy, Zap, Clock, ArrowRight, Sparkles,
  Sprout, Flame, Crown, Target, ShieldCheck, Coins, FileCheck2, Medal,
  Wrench, Lightbulb, Users, ClipboardCheck, TrendingUp,
} from 'lucide-react';
import api from '@/services/api';
import styles from '../curso.module.css';
import ConteudoLicao from '../_componentes/ConteudoLicao';
import Avaliacao, { type MinhaAvaliacao } from '../_componentes/Avaliacao';
import {
  getCurso, licoesDo, licoesBase, xpTotalDo, minutosDo,
  conquistasDo, calcularProgresso, nivelPorXp, bonusLiberado,
  type ModuloCurso, type Licao, type NomeIcone, type Missoes,
} from '../_conteudo/cursos.config';

// A área de curso é DELIBERADAMENTE escura, diferente do resto do app (que é
// claro): é o "modo imersão" — quando o integrador entra aqui, ele saiu da
// ferramenta e entrou no treinamento. Cores fixas, não tokens, por isso mesmo.
//
// Esta tela serve QUALQUER curso do registro (cursos.config.ts). Curso novo não
// precisa de página nova.

const ICONES: Record<NomeIcone, typeof MessageSquareQuote> = {
  MessageSquareQuote, Map, Calculator, FileSignature, Send, Repeat,
  Sprout, Zap, Flame, Crown,
  Target, ShieldCheck, Coins, FileCheck2, Trophy,
  Wrench, Lightbulb, Users, ClipboardCheck, TrendingUp,
};

interface Acesso {
  temKit: boolean;
  plano: string;
  packTrialUntil: string | null;
  progresso: string[];
}

export default function CursoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const curso = getCurso(slug);
  if (!curso) notFound();

  const TODAS_LICOES = licoesDo(curso);
  const CONQUISTAS = conquistasDo(curso);

  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [missoes, setMissoes] = useState<Missoes | null>(null);
  const [loading, setLoading] = useState(true);
  const [feitos, setFeitos] = useState<string[]>([]);
  const [licaoAberta, setLicaoAberta] = useState<string | null>(null);
  const [ganhou, setGanhou] = useState<{ xp: number; conquista?: string } | null>(null);
  const [avaliacoes, setAvaliacoes] = useState<MinhaAvaliacao[]>([]);
  /** slug do módulo que acabou de ser concluído — abre a avaliação dele */
  const [avaliarModulo, setAvaliarModulo] = useState<string | null>(null);

  useEffect(() => {
    api.get('/kit/meu-acesso')
      .then(({ data }) => { setAcesso(data); setFeitos(data.progresso ?? []); })
      .catch(() => setAcesso(null))
      .finally(() => setLoading(false));
    // Missões da plataforma (empresa, cliente, documento) destravam o bônus.
    api.get('/kit/missoes').then(({ data }) => setMissoes(data)).catch(() => {});
    api.get(`/kit/avaliacoes?curso=${slug}`)
      .then(({ data }) => setAvaliacoes(data.avaliacoes ?? []))
      .catch(() => {});
  }, [slug]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [licaoAberta]);

  useEffect(() => {
    if (!ganhou) return;
    const t = setTimeout(() => setGanhou(null), 3600);
    return () => clearTimeout(t);
  }, [ganhou]);

  const prog = calcularProgresso(curso, feitos);
  const nivel = nivelPorXp(curso, prog.xp);
  const liberadoBonus = (m: ModuloCurso) => bonusLiberado(m, curso, prog.feitos, missoes);
  // "Continuar" nunca aponta para lição de módulo bônus ainda travado.
  const proxima = prog.proxima && !liberadoBonus(prog.proxima.modulo) ? null : prog.proxima;
  const liberado = !!acesso && (acesso.temKit || acesso.plano === 'pro' || acesso.plano === 'ilimitado');
  const emTrial = !!acesso?.packTrialUntil && new Date(acesso.packTrialUntil) > new Date();

  const concluir = useCallback((licao: Licao, modulo: ModuloCurso) => {
    if (feitos.includes(licao.id)) return;
    const novos = [...feitos, licao.id];
    setFeitos(novos);
    api.post('/kit/progresso', { modulo: licao.id, concluido: true }).catch(() => {});

    const antes = new Set(feitos);
    const depois = new Set(novos);
    const nova = CONQUISTAS.find((c) => !c.ganhou(antes) && c.ganhou(depois));
    const fechouModulo = modulo.licoes.every((l) => depois.has(l.id));
    const bonus = fechouModulo ? modulo.bonusXp : 0;
    setGanhou({ xp: licao.xp + bonus, conquista: nova?.nome });

    // Fechou o módulo? É a hora de perguntar o que ele achou — no pico da
    // sensação de "consegui", não uma semana depois por e-mail.
    if (fechouModulo && !avaliacoes.some((a) => a.modulo_slug === modulo.slug)) {
      setAvaliarModulo(modulo.slug);
    }
  }, [feitos, CONQUISTAS, avaliacoes]);

  if (loading) {
    return <div className={styles.canvas}><div className={styles.carregando}>Carregando seu curso…</div></div>;
  }

  if (!liberado) {
    return (
      <div className={styles.canvas}>
        <div className={styles.bloqueado}>
          <Lock size={38} strokeWidth={1.5} />
          <h1>Este curso ainda não está na sua conta</h1>
          <p>
            O {curso.nome} tem {TODAS_LICOES.length} lições sobre o que responder quando o cliente
            trava a venda — das objeções de preço à indicação depois da obra.
          </p>
          <a href="https://solardoc.app/kit" target="_blank" rel="noopener noreferrer" className={styles.btnPrimario}>
            Ver o curso <ArrowRight size={16} />
          </a>
          <span className={styles.bloqueadoNota}>Já é assinante PRO ou VIP? O curso entra junto no seu plano.</span>
        </div>
      </div>
    );
  }

  // ── Vista: uma lição aberta ───────────────────────────────────────────────
  if (licaoAberta) {
    const modulo = curso.modulos.find((m) => m.licoes.some((l) => l.id === licaoAberta))!;
    const idx = modulo.licoes.findIndex((l) => l.id === licaoAberta);
    const licao = modulo.licoes[idx];
    const feito = feitos.includes(licao.id);
    const posGlobal = TODAS_LICOES.findIndex((l) => l.id === licao.id);
    const proxGlobal = TODAS_LICOES[posGlobal + 1] ?? null;
    const antGlobal = TODAS_LICOES[posGlobal - 1] ?? null;

    return (
      <div className={styles.canvas}>
        {ganhou && <ToastXp ganhou={ganhou} />}

        <div className={styles.licaoTopo}>
          <button className={styles.voltar} onClick={() => setLicaoAberta(null)}>
            <ChevronLeft size={16} /> Trilha do curso
          </button>
          <div className={styles.licaoTopoDir}>
            <span className={styles.pilulaXp}><Zap size={13} /> {prog.xp} XP</span>
            <span className={styles.pilulaMin}><Clock size={13} /> {licao.minutos} min</span>
          </div>
        </div>

        <header className={styles.licaoHead} style={{ ['--cor' as string]: modulo.cor }}>
          <span className={styles.licaoModulo}>
            Módulo {modulo.numero} · {modulo.titulo}
          </span>
          <h1 className={styles.licaoTitulo}>{licao.titulo}</h1>
          <p className={styles.licaoResumo}>{licao.resumo}</p>
          <div className={styles.licaoPassos}>
            {modulo.licoes.map((l, i) => (
              <button
                key={l.id}
                className={`${styles.passoPonto} ${feitos.includes(l.id) ? styles.passoFeito : ''} ${i === idx ? styles.passoAtual : ''}`}
                onClick={() => setLicaoAberta(l.id)}
                title={l.titulo}
                aria-label={`Lição ${i + 1}: ${l.titulo}`}
              />
            ))}
            <span className={styles.passoLabel}>lição {idx + 1} de {modulo.licoes.length}</span>
          </div>
        </header>

        <ConteudoLicao id={licao.id} />

        <div className={styles.licaoRodape}>
          <button
            className={feito ? styles.btnFeito : styles.btnPrimario}
            onClick={() => concluir(licao, modulo)}
            disabled={feito}
          >
            {feito ? <><Check size={17} /> Lição concluída</> : <><Check size={17} /> Concluir e ganhar {licao.xp} XP</>}
          </button>

          <div className={styles.licaoNav}>
            {antGlobal && (
              <button className={styles.btnSecundario} onClick={() => setLicaoAberta(antGlobal.id)}>
                <ChevronLeft size={15} /> Anterior
              </button>
            )}
            {proxGlobal ? (
              <button className={styles.btnSecundario} onClick={() => setLicaoAberta(proxGlobal.id)}>
                Próxima lição <ChevronRight size={15} />
              </button>
            ) : (
              <button className={styles.btnSecundario} onClick={() => setLicaoAberta(null)}>
                Voltar para a trilha <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>

        {avaliarModulo === modulo.slug && (
          <Avaliacao
            cursoSlug={curso.slug}
            moduloSlug={modulo.slug}
            titulo={`Módulo ${modulo.numero} concluído. O que você achou?`}
            subtitulo="Leva 5 segundos e é o que faz o material melhorar."
            onSalvo={(a) => setAvaliacoes((prev) => [...prev.filter((x) => x.modulo_slug !== a.modulo_slug), a])}
          />
        )}
      </div>
    );
  }

  // ── Vista: trilha do curso ────────────────────────────────────────────────
  const IconeNivel = ICONES[nivel.atual.icone];

  return (
    <div className={styles.canvas}>
      {ganhou && <ToastXp ganhou={ganhou} />}

      <header className={styles.heroCurso}>
        <div className={styles.heroTxt}>
          <span className={styles.heroTag}>Curso · {TODAS_LICOES.length} lições · {minutosDo(curso)} min</span>
          <h1 className={styles.heroTitulo}>{curso.nome}</h1>
          <p className={styles.heroChamada}>{curso.descricao}</p>

          {proxima ? (
            <button className={styles.btnPrimario} onClick={() => setLicaoAberta(proxima.licao.id)}>
              <Play size={16} />
              {prog.licoesFeitas === 0 ? 'Começar o curso' : 'Continuar de onde parei'}
            </button>
          ) : (
            <div className={styles.concluido}>
              <Trophy size={20} /> Curso concluído — {prog.xp} XP
            </div>
          )}
          {proxima && (
            <span className={styles.proximaLabel}>
              Próxima: {proxima.licao.titulo}
            </span>
          )}
        </div>

        <div className={styles.painelNivel}>
          <div className={styles.nivelTopo}>
            <span className={styles.nivelIcone}><IconeNivel size={24} strokeWidth={1.9} /></span>
            <div>
              <strong className={styles.nivelNome}>{nivel.atual.nome}</strong>
              <span className={styles.nivelDesc}>{nivel.atual.descricao}</span>
            </div>
          </div>

          <div className={styles.xpBarra}>
            <div className={styles.xpFill} style={{ width: `${nivel.pct}%` }} />
          </div>
          <div className={styles.xpLinha}>
            <span><Zap size={13} /> {prog.xp} XP</span>
            <span>{nivel.proximo ? `faltam ${nivel.faltam} para ${nivel.proximo.nome}` : 'nível máximo'}</span>
          </div>

          <div className={styles.statsGrid}>
            <div><b>{prog.licoesFeitas}/{TODAS_LICOES.length}</b><span>lições</span></div>
            <div><b>{prog.modulosCompletos}/{curso.modulos.length}</b><span>módulos</span></div>
            <div><b>{prog.pctCurso}%</b><span>do curso</span></div>
          </div>
        </div>
      </header>

      <section className={styles.trilha}>
        <h2 className={styles.secaoTitulo}>Sua trilha</h2>

        {curso.modulos.map((m) => {
          const Icone = ICONES[m.icone];
          const feitasNoModulo = m.licoes.filter((l) => prog.feitos.has(l.id)).length;
          const completo = feitasNoModulo === m.licoes.length;
          const emAndamento = feitasNoModulo > 0 && !completo;

          // ── Módulo bônus ainda travado: mostra as missões que faltam ──
          if (m.bonus && !liberadoBonus(m)) {
            const feitoReq = (id: string) => {
              if (id === 'licoes') return licoesBase(curso).every((l) => prog.feitos.has(l.id));
              if (id === 'empresa') return !!missoes?.empresa;
              if (id === 'cliente') return (missoes?.clientes ?? 0) > 0;
              if (id === 'documento') return (missoes?.documentos ?? 0) > 0;
              return false;
            };
            const reqs = m.requisitos ?? [];
            const prontos = reqs.filter((r) => feitoReq(r.id)).length;

            return (
              <article key={m.slug} className={styles.moduloBonus} style={{ ['--cor' as string]: m.cor }}>
                <div className={styles.bonusTopo}>
                  <span className={styles.bonusCadeado}><Lock size={20} strokeWidth={1.9} /></span>
                  <div>
                    <span className={styles.bonusTag}>Módulo bônus · bloqueado</span>
                    <h3 className={styles.moduloTitulo}>{m.titulo}</h3>
                    <p className={styles.moduloSub}>{m.subtitulo}</p>
                  </div>
                  <span className={styles.bonusContador}>{prontos}/{reqs.length}</span>
                </div>

                <p className={styles.bonusIntro}>
                  Este módulo libera quando você terminar o curso <strong>e</strong> estiver usando a
                  plataforma de verdade. São {m.licoes.length} lições sobre vender para empresa —
                  o projeto que vale por três residenciais.
                </p>

                <ul className={styles.missoes}>
                  {reqs.map((r) => {
                    const ok = feitoReq(r.id);
                    return (
                      <li key={r.id} className={ok ? styles.missaoOk : ''}>
                        <span className={styles.missaoCheck}>
                          {ok ? <Check size={13} strokeWidth={3} /> : <span className={styles.missaoVazio} />}
                        </span>
                        <span className={styles.missaoTexto}>
                          <strong>{r.label}</strong>
                          <span>{r.dica}</span>
                        </span>
                        {!ok && r.href && (
                          <Link href={r.href} className={styles.missaoIr}>
                            fazer <ArrowRight size={13} />
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <div className={styles.bonusRodape}>
                  <span className={styles.bonus}>Ao destravar: <b>+{m.bonusXp} XP</b> e a conquista {m.conquista.nome}</span>
                </div>
              </article>
            );
          }

          return (
            <article
              key={m.slug}
              className={`${styles.modulo} ${completo ? styles.moduloCompleto : ''} ${emAndamento ? styles.moduloAtual : ''} ${m.bonus ? styles.moduloDestravado : ''}`}
              style={{ ['--cor' as string]: m.cor }}
            >
              <div className={styles.moduloBarra} />
              <div className={styles.moduloHead}>
                <span className={styles.moduloIcone}><Icone size={22} strokeWidth={1.7} /></span>
                <div className={styles.moduloTxt}>
                  <span className={styles.moduloNum}>
                    {m.bonus ? 'Módulo bônus · liberado' : `Módulo ${String(m.numero).padStart(2, '0')}`}
                    {completo && <span className={styles.seloCompleto}><Check size={11} /> completo</span>}
                  </span>
                  <h3 className={styles.moduloTitulo}>{m.titulo}</h3>
                  <p className={styles.moduloSub}>{m.subtitulo}</p>
                </div>
                <div className={styles.moduloProg}>
                  <span>{feitasNoModulo}/{m.licoes.length}</span>
                  <div className={styles.moduloProgBar}>
                    <div style={{ width: `${(feitasNoModulo / m.licoes.length) * 100}%` }} />
                  </div>
                </div>
              </div>

              <div className={styles.licoes}>
                {m.licoes.map((l, i) => {
                  const feito = prog.feitos.has(l.id);
                  const atual = prog.proxima?.licao.id === l.id;
                  return (
                    <button
                      key={l.id}
                      className={`${styles.licao} ${feito ? styles.licaoFeita : ''} ${atual ? styles.licaoAtual : ''}`}
                      onClick={() => setLicaoAberta(l.id)}
                    >
                      <span className={styles.licaoBolha}>
                        {feito ? <Check size={14} strokeWidth={3} /> : i + 1}
                      </span>
                      <span className={styles.licaoInfo}>
                        <strong>{l.titulo}</strong>
                        <span>{l.resumo}</span>
                      </span>
                      <span className={styles.licaoMeta}>
                        <span className={styles.tipoTag} data-tipo={l.tipo}>{l.tipo}</span>
                        <span className={styles.licaoXp}>+{l.xp} XP</span>
                        <span className={styles.licaoMin}>{l.minutos} min</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className={styles.moduloRodape}>
                <span className={styles.bonus}>Módulo completo: <b>+{m.bonusXp} XP</b> de bônus</span>
              </div>
            </article>
          );
        })}
      </section>

      {/* Curso concluído e ainda sem avaliação: pede AQUI, no topo da trilha,
          onde ele volta depois de fechar a última lição. */}
      {prog.pctCurso === 100 && !avaliacoes.some((a) => a.modulo_slug === '') && (
        <Avaliacao
          cursoSlug={curso.slug}
          titulo="Você concluiu o curso. Vale 5 estrelas?"
          subtitulo="Sua avaliação ajuda outro integrador a decidir — e nos diz o que melhorar."
          pedirAutorizacao
          onSalvo={(a) => setAvaliacoes((prev) => [...prev.filter((x) => x.modulo_slug !== ''), a])}
        />
      )}

      <section className={styles.conquistas}>
        <h2 className={styles.secaoTitulo}>
          Conquistas <span className={styles.contadorConq}>{prog.conquistas.length}/{CONQUISTAS.length}</span>
        </h2>
        <div className={styles.medalhas}>
          {CONQUISTAS.map((c) => {
            const ganha = prog.conquistas.some((x) => x.id === c.id);
            const I = ICONES[c.icone];
            return (
              <div key={c.id} className={`${styles.medalha} ${ganha ? styles.medalhaGanha : ''}`} title={c.comoGanha}>
                <span className={styles.medalhaIcone}>
                  {ganha ? <I size={22} strokeWidth={1.9} /> : <Lock size={20} strokeWidth={1.9} />}
                </span>
                <strong>{c.nome}</strong>
                <span>{c.comoGanha}</span>
              </div>
            );
          })}
        </div>
      </section>

      {(acesso?.plano === 'free' || emTrial) && (
        <div className={styles.conviteVip}>
          <Sparkles size={20} />
          <div>
            <h3>{emTrial ? 'Seu acesso VIP está correndo' : 'O contrato da lição 4, sem limite mensal'}</h3>
            <p>
              {emTrial
                ? 'Enquanto durar, seus documentos são ilimitados. Assinando o VIP por R$ 67/mês você não perde o acesso nem o que já gerou.'
                : 'No VIP você gera contrato, procuração, recibo e proposta sem teto, todos com a logo e o CNPJ da sua empresa.'}
            </p>
            <button onClick={() => window.dispatchEvent(new CustomEvent('limit-reached'))} className={styles.btnPrimario}>
              Ver o plano VIP <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      <p className={styles.rodapeCurso}>
        {xpTotalDo(curso)} XP no total · {TODAS_LICOES.length} lições · o material fica na sua conta e é
        atualizado sem custo adicional
      </p>
    </div>
  );
}

function ToastXp({ ganhou }: { ganhou: { xp: number; conquista?: string } }) {
  return (
    <div className={styles.toast} role="status">
      <span className={styles.toastXp}>+{ganhou.xp} XP</span>
      {ganhou.conquista
        ? <span className={styles.toastConq}><Medal size={14} strokeWidth={2} /> Conquista: {ganhou.conquista}</span>
        : <span className={styles.toastMsg}>boa! seguindo pra próxima</span>}
    </div>
  );
}
