'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  MessageSquareQuote, Map, Calculator, FileSignature, Send, Repeat,
  Check, ChevronLeft, ChevronRight, Lock, Play, Download, Trophy, Zap, Clock, ArrowRight, Sparkles,
} from 'lucide-react';
import api from '@/services/api';
import styles from '../curso.module.css';
import ConteudoLicao from '../_componentes/ConteudoLicao';
import {
  CURSO, MODULOS, TODAS_LICOES, XP_TOTAL, MINUTOS_TOTAL,
  CONQUISTAS, calcularProgresso, nivelPorXp,
  type ModuloCurso, type Licao,
} from '../_conteudo/curso';

// A área de curso é DELIBERADAMENTE escura, diferente do resto do app (que é
// claro): é o "modo imersão" — quando o integrador entra aqui, ele saiu da
// ferramenta e entrou no treinamento. Cores fixas, não tokens, por isso mesmo.

const ICONES = { MessageSquareQuote, Map, Calculator, FileSignature, Send, Repeat };

interface Acesso {
  temKit: boolean;
  plano: string;
  packTrialUntil: string | null;
  progresso: string[];
}

export default function CursoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  if (slug !== CURSO.slug) notFound();

  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [loading, setLoading] = useState(true);
  const [feitos, setFeitos] = useState<string[]>([]);
  const [licaoAberta, setLicaoAberta] = useState<string | null>(null);
  const [ganhou, setGanhou] = useState<{ xp: number; conquista?: string } | null>(null);

  useEffect(() => {
    api.get('/kit/meu-acesso')
      .then(({ data }) => { setAcesso(data); setFeitos(data.progresso ?? []); })
      .catch(() => setAcesso(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [licaoAberta]);

  useEffect(() => {
    if (!ganhou) return;
    const t = setTimeout(() => setGanhou(null), 3600);
    return () => clearTimeout(t);
  }, [ganhou]);

  const prog = calcularProgresso(feitos);
  const nivel = nivelPorXp(prog.xp);
  const liberado = !!acesso && (acesso.temKit || acesso.plano === 'pro' || acesso.plano === 'ilimitado');
  const emTrial = !!acesso?.packTrialUntil && new Date(acesso.packTrialUntil) > new Date();

  const concluir = useCallback((licao: Licao, modulo: ModuloCurso) => {
    if (feitos.includes(licao.id)) return;
    const novos = [...feitos, licao.id];
    setFeitos(novos);
    api.post('/kit/progresso', { modulo: licao.id, concluido: true }).catch(() => {});

    // Ganhou conquista com esta lição? Compara antes x depois.
    const antes = new Set(feitos);
    const depois = new Set(novos);
    const nova = CONQUISTAS.find((c) => !c.ganhou(antes) && c.ganhou(depois));
    const bonus = modulo.licoes.every((l) => depois.has(l.id)) ? modulo.bonusXp : 0;
    setGanhou({ xp: licao.xp + bonus, conquista: nova?.nome });
  }, [feitos]);

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
            O {CURSO.nome} tem {TODAS_LICOES.length} lições sobre o que responder quando o cliente
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
    const modulo = MODULOS.find((m) => m.licoes.some((l) => l.id === licaoAberta))!;
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

        {modulo.pdf && (
          <a className={styles.baixarModulo} href={`/kit/downloads/${modulo.pdf}`} download>
            <Download size={15} /> Baixar o módulo {modulo.numero} em PDF
          </a>
        )}
      </div>
    );
  }

  // ── Vista: trilha do curso ────────────────────────────────────────────────
  return (
    <div className={styles.canvas}>
      {ganhou && <ToastXp ganhou={ganhou} />}

      <header className={styles.heroCurso}>
        <div className={styles.heroTxt}>
          <span className={styles.heroTag}>Curso · {TODAS_LICOES.length} lições · {MINUTOS_TOTAL} min</span>
          <h1 className={styles.heroTitulo}>{CURSO.nome}</h1>
          <p className={styles.heroChamada}>{CURSO.descricao}</p>

          {prog.proxima ? (
            <button className={styles.btnPrimario} onClick={() => setLicaoAberta(prog.proxima!.licao.id)}>
              <Play size={16} />
              {prog.licoesFeitas === 0 ? 'Começar o curso' : 'Continuar de onde parei'}
            </button>
          ) : (
            <div className={styles.concluido}>
              <Trophy size={20} /> Curso concluído — {prog.xp} XP
            </div>
          )}
          {prog.proxima && (
            <span className={styles.proximaLabel}>
              Próxima: {prog.proxima.licao.titulo}
            </span>
          )}
        </div>

        <div className={styles.painelNivel}>
          <div className={styles.nivelTopo}>
            <span className={styles.nivelEmoji}>{nivel.atual.emoji}</span>
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
            <div><b>{prog.modulosCompletos}/{MODULOS.length}</b><span>módulos</span></div>
            <div><b>{prog.pctCurso}%</b><span>do curso</span></div>
          </div>
        </div>
      </header>

      <section className={styles.trilha}>
        <h2 className={styles.secaoTitulo}>Sua trilha</h2>

        {MODULOS.map((m) => {
          const Icone = ICONES[m.icone];
          const feitasNoModulo = m.licoes.filter((l) => prog.feitos.has(l.id)).length;
          const completo = feitasNoModulo === m.licoes.length;
          const emAndamento = feitasNoModulo > 0 && !completo;

          return (
            <article
              key={m.slug}
              className={`${styles.modulo} ${completo ? styles.moduloCompleto : ''} ${emAndamento ? styles.moduloAtual : ''}`}
              style={{ ['--cor' as string]: m.cor }}
            >
              <div className={styles.moduloBarra} />
              <div className={styles.moduloHead}>
                <span className={styles.moduloIcone}><Icone size={22} strokeWidth={1.7} /></span>
                <div className={styles.moduloTxt}>
                  <span className={styles.moduloNum}>
                    Módulo {String(m.numero).padStart(2, '0')}
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
                {m.pdf && (
                  <a className={styles.baixarPdf} href={`/kit/downloads/${m.pdf}`} download>
                    <Download size={14} /> PDF
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className={styles.conquistas}>
        <h2 className={styles.secaoTitulo}>
          Conquistas <span className={styles.contadorConq}>{prog.conquistas.length}/{CONQUISTAS.length}</span>
        </h2>
        <div className={styles.medalhas}>
          {CONQUISTAS.map((c) => {
            const ganha = prog.conquistas.some((x) => x.id === c.id);
            return (
              <div key={c.id} className={`${styles.medalha} ${ganha ? styles.medalhaGanha : ''}`} title={c.comoGanha}>
                <span className={styles.medalhaEmoji}>{ganha ? c.emoji : '🔒'}</span>
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
        {XP_TOTAL} XP no total · {TODAS_LICOES.length} lições · material atualizado sem custo adicional
      </p>
    </div>
  );
}

function ToastXp({ ganhou }: { ganhou: { xp: number; conquista?: string } }) {
  return (
    <div className={styles.toast} role="status">
      <span className={styles.toastXp}>+{ganhou.xp} XP</span>
      {ganhou.conquista
        ? <span className={styles.toastConq}>🏅 Conquista: {ganhou.conquista}</span>
        : <span className={styles.toastMsg}>boa! seguindo pra próxima</span>}
    </div>
  );
}
