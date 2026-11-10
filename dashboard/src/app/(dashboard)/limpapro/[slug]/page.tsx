'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Lock } from 'lucide-react';
import api from '@/services/api';
import {
  aulaSeguinte, diasAte, textoDias,
  type AulaCurso, type AulaResposta, type CursoResposta, type Pergunta,
} from '@/lib/limpapro/tipos';
import '../limpapro.css';

type Falha = { motivo: 'premium' | 'espera' | 'item' | 'sem_acesso' | 'erro'; liberaEm?: string };

function Prova({ quiz, onAprovou }: { quiz: Pergunta[]; onAprovou: () => void }) {
  const [resp, setResp] = useState<Record<number, number>>({});
  const [corrigida, setCorrigida] = useState(false);
  const [falta, setFalta] = useState(false);
  const total = quiz.length;
  const acertos = quiz.reduce((n, q, i) => n + (resp[i] === q.c ? 1 : 0), 0);
  const pct = Math.round((acertos / total) * 100);
  const passou = pct >= 70;
  const respondidas = Object.keys(resp).length;

  const corrigir = () => {
    if (respondidas < total) { setFalta(true); return; }
    setFalta(false);
    setCorrigida(true);
    if (quiz.reduce((n, q, i) => n + (resp[i] === q.c ? 1 : 0), 0) / total >= 0.7) onAprovou();
  };

  return (
    <section className="lp-prova" aria-labelledby="lp-prova-h">
      <h2 id="lp-prova-h">Prova do módulo</h2>
      <p className="lp-prova-sub">{total} perguntas. Escolha 1 resposta em cada.</p>
      {quiz.map((q, i) => (
        <div className="lp-q" key={i}>
          <b>{i + 1}. {q.q}</b>
          <div className="lp-opts">
            {q.o.map((op, j) => {
              let cls = 'lp-opt';
              if (corrigida) { if (j === q.c) cls += ' ok'; else if (resp[i] === j) cls += ' err'; } else if (resp[i] === j) cls += ' sel';
              return (
                <button type="button" key={j} className={cls} disabled={corrigida}
                  onClick={() => setResp((r) => ({ ...r, [i]: j }))}>
                  <i aria-hidden="true">{String.fromCharCode(65 + j)}</i><span>{op}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {corrigida ? (
        <div className={`lp-nota${passou ? ' passou' : ''}`} role="status">
          <strong>{acertos}/{total}</strong>
          <p>{passou ? `Aprovado, ${pct}% de acerto. O módulo foi marcado como feito.` : `${pct}% de acerto. Releia a aula e refaça a prova.`}</p>
          <button type="button" className="lp-btn lp-btn-claro" onClick={() => { setResp({}); setCorrigida(false); }}>Refazer a prova</button>
        </div>
      ) : (
        <>
          {falta && <p className="lp-aviso-salvar" role="alert">Responda todas as perguntas. Faltam {total - respondidas}.</p>}
          <button type="button" className="lp-btn lp-btn-primario" onClick={corrigir}>Corrigir a prova ({respondidas}/{total})</button>
        </>
      )}
    </section>
  );
}

export default function AulaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [aula, setAula] = useState<AulaResposta | null>(null);
  const [curso, setCurso] = useState<CursoResposta | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [feita, setFeita] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState(false);
  const corpo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    setAula(null); setFalha(null);
    Promise.allSettled([
      api.get<AulaResposta>(`/limpapro/aulas/${encodeURIComponent(slug)}`),
      api.get<CursoResposta>('/limpapro/curso'),
    ]).then(([a, c]) => {
      if (!vivo) return;
      if (c.status === 'fulfilled') setCurso(c.value.data);
      if (a.status === 'fulfilled') { setAula(a.value.data); setFeita(a.value.data.feita); return; }
      const e = a.reason as { response?: { status?: number; data?: { motivo?: Falha['motivo']; liberaEm?: string } } };
      if (e.response?.status === 403 || e.response?.status === 404) {
        setFalha({ motivo: e.response.data?.motivo ?? 'sem_acesso', liberaEm: e.response.data?.liberaEm });
      } else setFalha({ motivo: 'erro' });
    });
    return () => { vivo = false; };
  }, [slug]);

  // O HTML da aula é string do servidor, já limpa. O objeto só muda quando a string muda: o React não refaz o innerHTML
  // (e não desmarca os itens do checklist) a cada render.
  const html = useMemo(() => ({ __html: aula?.html ?? '' }), [aula?.html]);

  // Checklists da aula: marcados vêm do servidor e cada clique é gravado em "chk:<aula>:<n>".
  useEffect(() => {
    const raiz = corpo.current;
    if (!raiz || !aula) return;
    const caixas = Array.from(raiz.querySelectorAll<HTMLInputElement>('.aula-check input[type=checkbox]'));
    const ouvintes = caixas.map((el, i) => {
      el.checked = aula.marcados.includes(i);
      const fn = () => {
        api.post('/limpapro/progresso', { aula: aula.slug, item: i, marcado: el.checked }).catch(() => { el.checked = !el.checked; });
      };
      el.addEventListener('change', fn);
      return [el, fn] as const;
    });
    return () => ouvintes.forEach(([el, fn]) => el.removeEventListener('change', fn));
  }, [aula]);

  const gravar = useCallback(async (concluida: boolean) => {
    if (!aula) return;
    setSalvando(true); setErroSalvar(false);
    try {
      await api.post('/limpapro/progresso', { aula: aula.slug, concluida });
      setFeita(concluida);
      // Mantém a lista (usada em "Próxima aula") em dia sem nova chamada.
      setCurso((c) => (c && c.aulas ? {
        ...c, aulas: c.aulas.map((a) => (a.slug === aula.slug ? { ...a, feita: concluida } : a)),
      } : c));
    } catch {
      setErroSalvar(true);
    } finally {
      setSalvando(false);
    }
  }, [aula]);

  if (falha) {
    const m = falha.motivo;
    return (
      <div className="lp-wrap">
        <Link href="/limpapro" className="lp-voltar"><ArrowLeft size={16} /> Voltar ao curso</Link>
        <div className="lp-bloqueada" role="alert">
          <Lock size={30} aria-hidden="true" />
          <h1>
            {m === 'premium' ? 'Este bônus é do plano Completo.'
              : m === 'espera' ? `Esta aula abre em ${textoDias(diasAte(falha.liberaEm))}.`
              : m === 'erro' ? 'Não foi possível abrir a aula agora.'
              : 'Esta aula não está no seu acesso.'}
          </h1>
          <p>
            {m === 'espera' ? 'Algumas aulas abrem alguns dias depois da compra. Volte nessa data.'
              : m === 'erro' ? 'Atualize a página em instantes.'
              : 'Veja no curso o que está aberto para você.'}
          </p>
          <Link href="/limpapro" className="lp-btn lp-btn-claro">Ir para o curso</Link>
        </div>
      </div>
    );
  }
  if (!aula) return <div className="lp-wrap"><div className="lp-carregando">Abrindo a aula...</div></div>;

  const lista: AulaCurso[] = curso?.aulas ?? [];
  const proxima = aulaSeguinte(lista, aula.slug);
  const total = curso?.modulosTotal ?? 5;
  const rotulo = aula.grupo === 'modulo' ? `Módulo ${aula.modulo} de ${total}`
    : aula.grupo === 'bonus' ? 'Bônus do plano Completo'
    : aula.grupo === 'incluso' ? 'Também incluído' : 'Material extra';

  return (
    <div className="lp-wrap">
      <Link href="/limpapro" className="lp-voltar"><ArrowLeft size={16} /> Voltar ao curso</Link>
      <header className="lp-aula-topo">
        <small>{rotulo}</small>
        <h1>{aula.titulo}</h1>
        <span>{aula.minutos} min de leitura</span>
      </header>

      <article className="lp-leitura">
        <div className="lp-aula" ref={corpo} dangerouslySetInnerHTML={html} />
        {aula.quiz.length > 0 && <Prova quiz={aula.quiz} onAprovou={() => { if (!feita) void gravar(true); }} />}
      </article>

      {erroSalvar && <p className="lp-aviso-salvar" role="alert">Não foi possível salvar agora. Tente de novo.</p>}
      <div className="lp-rodape">
        <button type="button" className={`lp-btn ${feita ? 'lp-btn-feita' : 'lp-btn-claro'}`} disabled={salvando}
          aria-pressed={feita} onClick={() => gravar(!feita)}>
          <Check size={18} aria-hidden="true" /> {feita ? 'Feita' : 'Marcar como feita'}
        </button>
        {proxima ? (
          <Link href={`/limpapro/${proxima.slug}`} className="lp-btn lp-btn-primario">
            Próxima aula <ArrowRight size={18} aria-hidden="true" />
          </Link>
        ) : (
          <Link href="/limpapro" className="lp-btn lp-btn-primario">Voltar ao curso</Link>
        )}
      </div>
    </div>
  );
}
