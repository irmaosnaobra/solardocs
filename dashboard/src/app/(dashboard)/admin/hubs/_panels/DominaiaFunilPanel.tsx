'use client';

// ───────────────────────────────────────────────────────────────────────────
// FUNIL DO QUIZ DA DOMINA IA: da primeira tela até a compra, quantos chegam e
// quantos saem em cada etapa.
//
// Lê GET /admin/dominaia/quiz-funil (contrato de 19/11/2026, tipo em
// hubDominaia.types.ts). A conta mora na api; aqui só se desenha.
//
// O desenho do funil é uma faixa por etapa, centralizada, em forma de trapézio:
// o topo tem a largura de quem chegou nesta etapa e a base a de quem chegou na
// próxima, e as faixas emendam num funil só. A etapa onde mais gente sai
// (em número de pessoas) fica pintada cheia e tem um aviso no topo do bloco.
//
// As porcentagens de etapa, recorte e conversão saem das contagens, não dos
// campos pct da resposta. Os pct da api (etapas e respostas) vão sempre de 0 a 100.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import s from './DominaiaFunilPanel.module.css';
import { Numero, Titulo, fmtData, fmtHora, fmtInt, fmtPct, fmtUsd } from './dominaiaComum';
import DominaiaFunilDesenho from './DominaiaFunilDesenho';
import DominaiaQuizCompacto from './DominaiaQuizCompacto';
import { DominaiaRecortes, DominaiaRespostas } from './DominaiaRecortes';
import DominaiaSessoesGaveta, { type AlvoSessoes } from './DominaiaSessoesGaveta';
import type { FunilDominaia } from './hubDominaia.types';

const PERIODOS = [
  { k: 'hoje', label: 'Hoje' }, { k: 'ontem', label: 'Ontem' }, { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' }, { k: 'maximo', label: 'Máximo' },
];
const APARELHO: Record<string, string> = { movil: 'Celular', tablet: 'Tablet', escritorio: 'Computador' };

// ── painel ──────────────────────────────────────────────────────────────────
// Dentro do hub Produtos o período vem de fora (o mesmo das outras sub-abas da Domina IA).
// onVisitas: quem está em volta recebe os visitantes por país da leitura sem filtro (a faixa de países usa).
export default function DominaiaFunilPanel({ periodo: periodoFora, onPeriodo, onVisitas }: {
  periodo?: string; onPeriodo?: (p: string) => void; onVisitas?: (periodo: string, porPais: Record<string, number>) => void;
} = {}) {
  const [periodoLocal, setPeriodoLocal] = useState('hoje');
  const periodo = periodoFora ?? periodoLocal;
  const setPeriodo = onPeriodo ?? setPeriodoLocal;
  const [pais, setPais] = useState('');
  const [disp, setDisp] = useState('');
  const [origem, setOrigem] = useState('');   // 'a:<id>' anúncio, 'c:<id>' conjunto, '' todos
  const [versao, setVersao] = useState(0);
  const [f, setF] = useState<FunilDominaia | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [gaveta, setGaveta] = useState<AlvoSessoes | null>(null);
  // As telas começam fechadas toda vez que a aba carrega; só abrem no clique (nada fica guardado).
  const [telasAbertas, setTelasAbertas] = useState(false);

  // O estado só muda na volta da leitura; quem clica acende o "Atualizando…".
  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ period: periodo });
    if (pais) q.set('pais', pais);
    if (disp) q.set('disp', disp);
    if (origem.startsWith('a:')) q.set('anuncio', origem.slice(2));
    if (origem.startsWith('c:')) q.set('conjunto', origem.slice(2));
    api.get(`/admin/dominaia/quiz-funil?${q.toString()}`)
      .then((r) => {
        if (!vivo) return;
        // 200 com corpo fora do formato (HTML de proxy, por exemplo) vira erro, não tela quebrada.
        const d = r.data as Partial<FunilDominaia> | null;
        const valido = !!d && typeof d === 'object' && Array.isArray(d.etapas) && !!d.totais && !!d.filtros
          && !!d.recortes && !!d.app && Array.isArray(d.respostas);
        if (valido) {
          setF(d as FunilDominaia); setErro('');
          if (onVisitas && !pais && !disp && !origem) {
            const porPais: Record<string, number> = {};
            for (const l of (d as FunilDominaia).recortes.pais ?? []) if (/^[A-Z]{2}$/.test(l.chave)) porPais[l.chave] = l.sessoes;
            onVisitas(periodo, porPais);
          }
        } else setErro('Resposta inesperada da api. Tente atualizar.');
      })
      .catch((e) => { if (vivo) setErro(String(e?.response?.data?.error || e?.message || e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [periodo, pais, disp, origem, versao, onVisitas]);

  const mudar = <T,>(set: (v: T) => void) => (v: T) => { setCarregando(true); set(v); };
  const trocarPeriodo = (p: string) => { if (p !== periodo) mudar(setPeriodo)(p); };
  const atualizar = () => { setCarregando(true); setVersao((v) => v + 1); };
  const limpar = () => { setCarregando(true); setPais(''); setDisp(''); setOrigem(''); };
  const filtrando = Boolean(pais || disp || origem);

  // Listas dos filtros: o que a api devolveu, mais o que está escolhido (para não sumir do seletor).
  const paises = f?.filtros.paises ?? [];
  const aparelhos = f?.filtros.aparelhos ?? [];
  const anuncios = [...(f?.filtros.anuncios ?? [])].sort((a, b) => b.sessoes - a.sessoes);
  // Os conjuntos vêm do que a api devolve; nenhum id de anúncio mora aqui.
  const conjuntos: { id: string; nome: string }[] = [];
  for (const l of f?.recortes.conjunto ?? []) if (l.chave && !conjuntos.some((c) => c.id === l.chave)) conjuntos.push({ id: l.chave, nome: l.rotulo });

  const t = f?.totais;
  const vazio = f && t && t.sessoes === 0;

  // A gaveta de quem passou usa os mesmos filtros do funil, escritos no subtítulo.
  const filtrosGaveta = useMemo(() => ({
    periodo, pais, disp,
    anuncio: origem.startsWith('a:') ? origem.slice(2) : '',
    conjunto: origem.startsWith('c:') ? origem.slice(2) : '',
  }), [periodo, pais, disp, origem]);
  const resumoFiltros = [
    PERIODOS.find((p) => p.k === periodo)?.label ?? periodo,
    pais ? (paises.find((p) => p.codigo === pais)?.nome ?? pais) : 'Todos os países',
    disp ? APARELHO[disp] : 'Todos os aparelhos',
    origem.startsWith('c:') ? (conjuntos.find((c) => `c:${c.id}` === origem)?.nome ?? 'Um conjunto')
      : origem.startsWith('a:') ? (anuncios.find((a) => `a:${a.id}` === origem)?.nome ?? 'Um anúncio') : 'Todos os anúncios',
  ].join(' · ');
  const nomeEtapa = (n: number) => f?.etapas.find((e) => e.n === n)?.rotulo ?? `Tela ${n}`;
  const ultimaEtapa = f ? Math.max(...f.etapas.map((e) => e.n)) : 0;

  return (
    <div className={s.raiz}>
      <div className={s.topo}>
        <div className={s.periodos} role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.k} type="button" aria-pressed={periodo === p.k}
              className={periodo === p.k ? admin.periodActive : admin.periodBtn} onClick={() => trocarPeriodo(p.k)}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className={`${admin.periodBtn} ${s.atualizar}`} disabled={carregando} onClick={atualizar}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <div className={s.filtros}>
        <label className={s.filtro}>
          <span>País</span>
          <select className="input-field" name="pais" value={pais} onChange={(e) => mudar(setPais)(e.target.value)}>
            <option value="">Todos os países</option>
            {pais && !paises.some((p) => p.codigo === pais) && <option value={pais}>{pais}</option>}
            {paises.map((p) => <option key={p.codigo} value={p.codigo}>{p.nome} ({fmtInt(p.sessoes)})</option>)}
          </select>
        </label>
        <label className={s.filtro}>
          <span>Aparelho</span>
          <select className="input-field" name="aparelho" value={disp} onChange={(e) => mudar(setDisp)(e.target.value)}>
            <option value="">Todos os aparelhos</option>
            {(['movil', 'tablet', 'escritorio'] as const).map((k) => {
              const a = aparelhos.find((x) => x.chave === k);
              return <option key={k} value={k}>{APARELHO[k]}{a ? ` (${fmtInt(a.sessoes)})` : ''}</option>;
            })}
          </select>
        </label>
        <label className={s.filtro}>
          <span>Anúncio ou conjunto</span>
          <select className="input-field" name="origem" value={origem} onChange={(e) => mudar(setOrigem)(e.target.value)}>
            <option value="">Todos os anúncios</option>
            {(conjuntos.length > 0 || origem.startsWith('c:')) && (
              <optgroup label="Conjuntos">
                {origem.startsWith('c:') && !conjuntos.some((c) => `c:${c.id}` === origem) && <option value={origem}>Conjunto {origem.slice(2)}</option>}
                {conjuntos.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.nome}</option>)}
              </optgroup>
            )}
            <optgroup label="Anúncios">
              {origem.startsWith('a:') && !anuncios.some((a) => `a:${a.id}` === origem) && <option value={origem}>Anúncio {origem.slice(2)}</option>}
              {anuncios.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.nome} ({fmtInt(a.sessoes)})</option>)}
            </optgroup>
          </select>
        </label>
      </div>

      <div className={s.linhaTempo}>
        {f && <span>{f.inicioRastreio ? `Contando desde ${fmtData(f.inicioRastreio, true)}` : 'O rastreio ainda não recebeu nenhum evento'}</span>}
        {f && f.atualizadoEm && <span>Atualizado às {fmtHora(f.atualizadoEm)}</span>}
        {filtrando && <button type="button" className={s.limpar} onClick={limpar}>Limpar filtros</button>}
      </div>

      {erro && <div className={`${admin.card} ${s.aviso}`} role="alert">Não consegui ler o funil: {erro}. Tente Atualizar.</div>}
      {!f && !erro && <div className={`${admin.card} ${s.aviso}`} style={{ color: 'var(--color-text-muted)' }}>Carregando o funil…</div>}
      {f?.truncado && (
        <div className={`${admin.card} ${s.aviso}`} role="status">
          O período passou de 200 mil eventos e a conta parou aí. Escolha um período menor para ver tudo.
        </div>
      )}

      {f && t && (
        <div className={s.funis}>
          <DominaiaQuizCompacto f={f} aberto={telasAbertas} aoAlternar={() => setTelasAbertas((a) => !a)} controla="dm-telas" className={s.funilQuiz} />
          <section className={`${s.bloco} ${s.funilApp}`} aria-labelledby="dm-app">
            <div className={s.blocoTopo}>
              <span id="dm-app">
                <Titulo dica="O que quem comprou faz no app, contado por pessoa.">
                  Depois da compra, no app
                </Titulo>
              </span>
            </div>
            <div className={s.pares}>
              <div className={s.par}><div className={s.parValor}>{fmtInt(f.app.abriram)}</div><div className={s.parRotulo}>Abriram</div></div>
              <div className={s.par}><div className={s.parValor}>{fmtInt(f.app.instalaram)}</div><div className={s.parRotulo}>Instalaram</div></div>
            </div>
          </section>
          {!vazio && (
            <section id="dm-telas" hidden={!telasAbertas} className={`${s.bloco} ${s.telas}`} aria-labelledby="dm-funil">
              {telasAbertas && (
                <>
                  <div className={s.blocoTopo}>
                    <span id="dm-funil">
                      <Titulo dica="Cada faixa é uma tela do quiz. A largura é quanta gente chegou nela. Entre uma tela e a próxima: quantos passaram e quantos saíram ali. Na oferta, saíram = não clicaram em comprar. Tempo = mediana até a próxima tela. Toque num número sublinhado para ver quem são.">
                        Cada tela do quiz
                      </Titulo>
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {fmtInt(t.sessoes)} entraram · {fmtInt(t.compras)} {t.compras === 1 ? 'comprou' : 'compraram'}
                    </span>
                  </div>
                  <DominaiaFunilDesenho
                    etapas={f.etapas}
                    total={t.sessoes}
                    onAbrir={(e, tipo) => setGaveta({ n: e.n, rotulo: e.rotulo, chegaram: e.chegaram, sairam: e.sairam, temSaida: e.n !== ultimaEtapa, tipo })}
                  />
                </>
              )}
            </section>
          )}
        </div>
      )}

      {f && t && !vazio && (
        <>
          <div className={s.numeros}>
            <Numero rotulo="Visitantes" valor={fmtInt(t.sessoes)} sub="Abriram o quiz" />
            <Numero rotulo="Leads (e-mail)" valor={fmtInt(t.leads)} sub={`${fmtPct(t.leads, t.sessoes)} dos visitantes`} />
            <Numero rotulo="Viram a oferta" valor={fmtInt(t.ofertas)} sub={`${fmtPct(t.ofertas, t.sessoes)} dos visitantes`} />
            <Numero rotulo="Clicaram em comprar" valor={fmtInt(t.checkouts)} sub={`${fmtPct(t.checkouts, t.ofertas)} de quem viu a oferta`} />
            <Numero rotulo="Compras" valor={fmtInt(t.compras)} sub="Pagaram a primeira cobrança" compra />
            <Numero rotulo="Conversão" valor={fmtPct(t.compras, t.sessoes, 1)} sub="Compras por visitante" />
            <Numero rotulo="Receita" valor={fmtUsd(t.receitaCentavos)} sub="Em dólar" />
            <Numero rotulo="Ticket médio" valor={t.compras ? fmtUsd(t.ticketMedioCentavos) : '—'} sub="Por compra" />
          </div>
          {!!((t.atalho ?? 0) + (t.voltas ?? 0)) && (
            <p className={s.linhaTempo}>
              {fmtInt(t.atalho ?? 0)} {t.atalho === 1 ? 'entrou' : 'entraram'} pelo atalho · {fmtInt(t.voltas ?? 0)} {t.voltas === 1 ? 'voltou' : 'voltaram'} direto para a oferta
            </p>
          )}

          <DominaiaRecortes f={f} />
          <DominaiaRespostas f={f} />
        </>
      )}

      <DominaiaSessoesGaveta
        alvo={gaveta}
        filtros={filtrosGaveta}
        resumoFiltros={resumoFiltros}
        nomeEtapa={nomeEtapa}
        aoFechar={() => setGaveta(null)}
      />
    </div>
  );
}
