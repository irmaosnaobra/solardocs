'use client';

// ───────────────────────────────────────────────────────────────────────────
// FUNIL DO QUIZ MONJOUR: da primeira tela até a compra, quantos chegam e
// quantos saem em cada etapa.
//
// Lê GET /admin/monjour/quiz-funil (contrato de 19/11/2026, tipo em
// hubMonjour.types.ts). A conta mora na api; aqui só se desenha.
//
// O desenho do funil é uma faixa por etapa, centralizada, em forma de trapézio:
// o topo tem a largura de quem chegou nesta etapa e a base a de quem chegou na
// próxima, e as 32 faixas emendam num funil só. A etapa onde mais gente sai
// (em número de pessoas) fica pintada cheia e tem um aviso no topo do bloco.
//
// As porcentagens de etapa, recorte e conversão saem das contagens, não dos
// campos pct da resposta, para não depender da escala (0 a 1 ou 0 a 100).
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import s from './MonjourFunilPanel.module.css';
import { Numero, Titulo, fmtData, fmtHora, fmtInt, fmtPct, fmtUsd } from './monjourComum';
import MonjourFunilDesenho from './MonjourFunilDesenho';
import { MonjourRecortes, MonjourRespostas } from './MonjourRecortes';
import MonjourSessoesGaveta, { type AlvoSessoes } from './MonjourSessoesGaveta';
import type { FunilMonjour } from './hubMonjour.types';

const PERIODOS = [
  { k: 'hoje', label: 'Hoje' }, { k: 'ontem', label: 'Ontem' }, { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' }, { k: 'maximo', label: 'Máximo' },
];
const APARELHO: Record<string, string> = { movil: 'Celular', tablet: 'Tablet', escritorio: 'Computador' };
// Os três conjuntos da campanha monjour-abo3. O filtro também aceita os que a api devolver.
const CONJUNTOS: { id: string; nome: string }[] = [
  { id: '120256011160400271', nome: 'CJ1 - Imagens' },
  { id: '120256011163980271', nome: 'CJ2 - Videos 1' },
  { id: '120256011166130271', nome: 'CJ3 - Videos 2' },
];

// ── painel ──────────────────────────────────────────────────────────────────
// Dentro do hub Produtos o período vem de fora (o mesmo das outras sub-abas do Monjour).
// onVisitas: quem está em volta recebe os visitantes por país da leitura sem filtro (a faixa de países usa).
export default function MonjourFunilPanel({ periodo: periodoFora, onPeriodo, onVisitas }: {
  periodo?: string; onPeriodo?: (p: string) => void; onVisitas?: (periodo: string, porPais: Record<string, number>) => void;
} = {}) {
  const [periodoLocal, setPeriodoLocal] = useState('hoje');
  const periodo = periodoFora ?? periodoLocal;
  const setPeriodo = onPeriodo ?? setPeriodoLocal;
  const [pais, setPais] = useState('');
  const [disp, setDisp] = useState('');
  const [origem, setOrigem] = useState('');   // 'a:<id>' anúncio, 'c:<id>' conjunto, '' todos
  const [versao, setVersao] = useState(0);
  const [f, setF] = useState<FunilMonjour | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [gaveta, setGaveta] = useState<AlvoSessoes | null>(null);

  // O estado só muda na volta da leitura; quem clica acende o "Atualizando…".
  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ period: periodo });
    if (pais) q.set('pais', pais);
    if (disp) q.set('disp', disp);
    if (origem.startsWith('a:')) q.set('anuncio', origem.slice(2));
    if (origem.startsWith('c:')) q.set('conjunto', origem.slice(2));
    api.get(`/admin/monjour/quiz-funil?${q.toString()}`)
      .then((r) => {
        if (!vivo) return;
        // 200 com corpo fora do formato (HTML de proxy, por exemplo) vira erro, não tela quebrada.
        const d = r.data as Partial<FunilMonjour> | null;
        const valido = !!d && typeof d === 'object' && Array.isArray(d.etapas) && !!d.totais && !!d.filtros
          && !!d.recortes && !!d.saidas && !!d.app && Array.isArray(d.respostas);
        if (valido) {
          setF(d as FunilMonjour); setErro('');
          if (onVisitas && !pais && !disp && !origem) {
            const porPais: Record<string, number> = {};
            for (const l of (d as FunilMonjour).recortes.pais ?? []) if (/^[A-Z]{2}$/.test(l.chave)) porPais[l.chave] = l.sessoes;
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

  // Escala dos campos pct da resposta (0 a 1 ou 0 a 100): a primeira etapa é sempre 100% do início.
  const escala = f && f.etapas.length && f.etapas[0].pctInicio > 1.5 ? 1 : 100;

  // Listas dos filtros: o que a api devolveu, mais o que está escolhido (para não sumir do seletor).
  const paises = f?.filtros.paises ?? [];
  const aparelhos = f?.filtros.aparelhos ?? [];
  const anuncios = [...(f?.filtros.anuncios ?? [])].sort((a, b) => b.sessoes - a.sessoes);
  const conjuntos = [...CONJUNTOS];
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
            <optgroup label="Conjuntos">
              {conjuntos.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.nome}</option>)}
            </optgroup>
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

      {f && t && vazio && (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Ainda sem dados neste período.</strong>
          <span>{f.inicioRastreio ? `O rastreio começou em ${fmtData(f.inicioRastreio)}.` : 'O rastreio ainda não recebeu nenhum evento.'}</span>
        </div>
      )}

      {f && t && !vazio && (
        <>
          <div className={s.numeros}>
            <Numero rotulo="Visitantes" valor={fmtInt(t.sessoes)} sub="Abriram o quiz" />
            <Numero rotulo="Leads (e-mail)" valor={fmtInt(t.leads)} sub={`${fmtPct(t.leads, t.sessoes)} dos visitantes`} />
            <Numero rotulo="Viram a oferta" valor={fmtInt(t.ofertas)} sub={`${fmtPct(t.ofertas, t.sessoes)} dos visitantes`} />
            <Numero rotulo="Clicaram em comprar" valor={fmtInt(t.checkouts)} sub={`${fmtPct(t.checkouts, t.ofertas)} de quem viu a oferta`} />
            <Numero rotulo="Compras" valor={fmtInt(t.compras)} sub={`Básico ${fmtInt(t.comprasBasico)} · Plus ${fmtInt(t.comprasPlus)}`} compra />
            <Numero rotulo="Conversão" valor={fmtPct(t.compras, t.sessoes, 1)} sub="Compras por visitante" />
            <Numero rotulo="Receita" valor={fmtUsd(t.receitaCentavos)} sub={t.upgrades ? `Com ${fmtInt(t.upgrades)} upgrade${t.upgrades === 1 ? '' : 's'}` : 'Em dólar'} />
            <Numero rotulo="Ticket médio" valor={t.compras ? fmtUsd(t.ticketMedioCentavos) : '—'} sub="Por compra" />
          </div>

          <section className={s.bloco} aria-labelledby="mj-funil">
            <div className={s.blocoTopo}>
              <span id="mj-funil">
                <Titulo dica="Cada faixa é uma tela do quiz. A largura é quanta gente chegou nela. Entre uma tela e a próxima: quantos passaram e quantos saíram ali. Na oferta, saíram = não clicaram em comprar. Tempo = mediana até a próxima tela. Toque num número sublinhado para ver quem são.">
                  Funil do quiz
                </Titulo>
              </span>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                {fmtInt(t.sessoes)} entraram · {fmtInt(t.compras)} {t.compras === 1 ? 'comprou' : 'compraram'}
              </span>
            </div>
            <MonjourFunilDesenho
              etapas={f.etapas}
              total={t.sessoes}
              onAbrir={(e, tipo) => setGaveta({ n: e.n, rotulo: e.rotulo, chegaram: e.chegaram, sairam: e.sairam, temSaida: e.n !== ultimaEtapa, tipo })}
            />
          </section>

          <div className={s.duas}>
            <section className={s.bloco} aria-labelledby="mj-saidas">
              <div className={s.blocoTopo}>
                <span id="mj-saidas">
                  <Titulo dica="Quem o próprio quiz encerra antes da oferta. Segurança: marcou gravidez ou amamentação. Ponto de partida: a conta do peso não deixou seguir.">
                    Saídas pelo próprio quiz
                  </Titulo>
                </span>
              </div>
              <div className={s.pares}>
                <div className={s.par}><div className={s.parValor}>{fmtInt(f.saidas.finSeguridad)}</div><div className={s.parRotulo}>Na tela de segurança</div></div>
                <div className={s.par}><div className={s.parValor}>{fmtInt(f.saidas.partidaSemSaida)}</div><div className={s.parRotulo}>Ponto de partida sem saída</div></div>
              </div>
            </section>
            <section className={s.bloco} aria-labelledby="mj-app">
              <div className={s.blocoTopo}>
                <span id="mj-app">
                  <Titulo dica="O que quem comprou faz no app, contado por pessoa. Upgrade = pagou a diferença para o Plus.">
                    Depois da compra, no app
                  </Titulo>
                </span>
              </div>
              <div className={s.pares}>
                <div className={s.par}><div className={s.parValor}>{fmtInt(f.app.abriram)}</div><div className={s.parRotulo}>Abriram</div></div>
                <div className={s.par}><div className={s.parValor}>{fmtInt(f.app.instalaram)}</div><div className={s.parRotulo}>Instalaram</div></div>
                <div className={s.par}><div className={s.parValor}>{fmtInt(f.app.upgradeClicks)}</div><div className={s.parRotulo}>Clicaram no upgrade</div></div>
                <div className={s.par}><div className={s.parValor}>{fmtInt(t.upgrades)}</div><div className={s.parRotulo}>Upgrades pagos</div></div>
              </div>
            </section>
          </div>

          <MonjourRecortes f={f} />
          <MonjourRespostas f={f} escala={escala} />
        </>
      )}

      <MonjourSessoesGaveta
        alvo={gaveta}
        filtros={filtrosGaveta}
        resumoFiltros={resumoFiltros}
        nomeEtapa={nomeEtapa}
        aoFechar={() => setGaveta(null)}
      />
    </div>
  );
}
