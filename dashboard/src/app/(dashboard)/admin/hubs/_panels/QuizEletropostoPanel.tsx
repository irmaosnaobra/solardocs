'use client';

// ───────────────────────────────────────────────────────────────────────────
// QUIZ DO ELETROPOSTO — em que pergunta a pessoa desiste.
//
// Lê /admin/eletroposto/quiz-funil. Quem cai no link de /io/eletroposto vê só
// o quiz, e até 22/09/2026 ele não contava nada para o nosso banco: sabia-se a
// ponta (~15% das visitas viravam reunião, ficha ou cadastro) e mais nada.
//
// Cada caminho (comércio, investidor com local, sem local, integrador) tem a
// própria lista de perguntas. A barra de cada pergunta é QUEM CHEGOU nela,
// dividida em quem seguiu adiante e quem PAROU ALI (a última pergunta vista de
// quem não terminou). A pergunta com mais gente parada é a que custa mais.
//
// A conta mora em api/src/services/io/quizFunil.ts, com teste.
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, LabelList,
} from 'recharts';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Passo { id: string; pergunta: string; curta: string; chegaram: number; pararam: number; erros: { msg: string; sessoes: number }[] }
interface Caminho { id: string; nome: string; sessoes: number; terminaram: number; destinos: Record<string, number>; passos: Passo[] }
interface Campanha { campanha: string; visitas: number; abriram: number; terminaram: number; reunioes: number }
interface LinhaConjunto {
  id: string; nome: string; status: string; gasto: number | null; visitas: number; abriram_quiz: number;
  reunioes: number; investidores: number; pontos: number; parceiros: number; fichas: number;
  custo_reuniao: number | null; custo_resultado: number | null; negocio: number; arrendamento: number; perdidas: number;
  pior: { passo: string; pergunta: string; pararam: number } | null;
}
interface Funil {
  medindo_desde: string; visitas: number; abriram: number; escolheram_porta: number; terminaram: number;
  destinos: Record<string, number>; caminhos: Caminho[]; campanhas: Campanha[];
  conjunto: string | null; por_conjunto: LinhaConjunto[]; meta_ok: boolean; meta_motivo: string | null;
}

const PERIODOS = [
  { k: 'hoje', label: 'Hoje' }, { k: 'ontem', label: 'Ontem' }, { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' }, { k: 'maximo', label: 'Desde 21/07' },
];
// O mesmo painel serve o quiz do eletroposto e o do solar (07/10/2026); muda o
// endereço da leitura, os destinos e algumas palavras.
type Produto = 'eletroposto' | 'solar';
const DESTINOS_POR: Record<Produto, [string, string][]> = {
  eletroposto: [
    ['reuniao', 'Reunião marcada'], ['arrendamento', 'Arrendamento'], ['investidor', 'Investidores'],
    ['curioso', 'Curioso'], ['parceiro', 'Parceiros'], ['curso', 'Curso /ponto-certo'],
  ],
  solar: [
    ['vistoria', 'Visita marcada'], ['video', 'Videochamada marcada'], ['ligacao', 'Ligação marcada'],
    ['nao_confirmou', 'Não confirmou presença'], ['ja_marcado', 'Já tinha horário'], ['sem_vitrine', 'Sem horário'],
    ['parceiro', 'Integrador'],
  ],
};
const DESTINOS: [string, string][] = [...DESTINOS_POR.eletroposto, ...DESTINOS_POR.solar.filter(([k]) => k !== 'parceiro')];
// Duas séries, as duas primeiras da paleta de referência (validadas juntas:
// CVD ΔE 24.7, contraste ≥ 3:1 no fundo claro). O texto nunca usa a cor da série.
const COR_SEGUIU = '#2a78d6';
const COR_PAROU = '#eb6834';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const reais = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 100 ? 0 : 2 }));
const SITUACAO: Record<string, string> = { PAUSED: 'pausado', CAMPAIGN_PAUSED: 'campanha pausada', ADSET_PAUSED: 'pausado', ARCHIVED: 'arquivado', DELETED: 'apagado' };
const dataBR = (iso: string) => iso.split('-').reverse().join('/');

function Dica({ active, payload }: { active?: boolean; payload?: { payload: Passo & { seguiram: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, maxWidth: 280 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>{p.pergunta}</div>
      <div style={{ color: 'var(--color-text)' }}>Chegaram: <b>{p.chegaram}</b></div>
      <div style={{ color: 'var(--color-text)' }}>Pararam aqui: <b>{p.pararam}</b> ({pct(p.pararam, p.chegaram)}% de quem chegou)</div>
      {p.erros[0] && (
        <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>Aviso que mais travou: “{p.erros[0].msg}” ({p.erros[0].sessoes})</div>
      )}
    </div>
  );
}

// ── MAPA DE CALOR ────────────────────────────────────────────────────────────
// Os cartões abaixo mostram um caminho de cada vez. Com seis caminhos e até treze
// perguntas, "onde o quiz mais perde" só aparece depois de comparar seis gráficos
// na cabeça. Aqui é uma grade só: pergunta na linha, caminho na coluna, e a cor
// diz quanta gente PAROU ali, em % de quem chegou naquela pergunta.
//
// Por que % e não o número cru: os caminhos têm tamanhos muito diferentes (o
// comércio é dezenas de vezes maior que o integrador), e a cor por quantidade
// pintaria só o caminho grande. A quantidade fica no número de dentro da célula
// e na dica.
//
// A cor é MAGNITUDE, então é uma rampa de um tom só, clara → escura (rampa azul
// 250→650 da paleta de referência; validada: L monótona, ΔL ≥ 0,06 entre degraus,
// ponta clara 2,11:1 no branco, um tom só). O número aparece em TODA célula: a
// cor é o resumo para a vista, o número é o dado — quem não distingue os tons lê
// igual. Célula vazia = a pergunta não existe naquele caminho.
const CALOR = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
/** Faixas de %: até 10, até 25, até 40, até 60, acima. Zero não entra na rampa. */
const FAIXAS = [10, 25, 40, 60];
const faixaDe = (p: number) => FAIXAS.findIndex((t) => p <= t) === -1 ? CALOR.length - 1 : FAIXAS.findIndex((t) => p <= t);
/** Nos três tons escuros o número vai em branco; nos dois claros, na tinta do tema. */
const tintaDaFaixa = (i: number) => (i >= 2 ? '#ffffff' : '#0B1220');

interface Celula { pct: number; chegaram: number; pararam: number; erro: string | null }

function MapaDeCalor({ caminhos }: { caminhos: Caminho[] }) {
  // A ordem das linhas é a ordem em que as perguntas aparecem na página. Monto
  // pelo caminho mais movimentado e vou juntando o que os outros têm de diferente,
  // na posição em que eles mostram — assim o mapa lê de cima para baixo como o quiz.
  const linhas: { id: string; curta: string; pergunta: string }[] = [];
  for (const c of caminhos) {
    let corte = 0;
    for (const p of c.passos) {
      const i = linhas.findIndex((l) => l.id === p.id);
      if (i >= 0) { corte = i + 1; continue; }
      linhas.splice(corte, 0, { id: p.id, curta: p.curta, pergunta: p.pergunta });
      corte += 1;
    }
  }
  const celula = (c: Caminho, id: string): Celula | null => {
    const p = c.passos.find((x) => x.id === id);
    if (!p || p.chegaram === 0) return null;
    return { pct: pct(p.pararam, p.chegaram), chegaram: p.chegaram, pararam: p.pararam, erro: p.erros[0]?.msg ?? null };
  };
  if (linhas.length === 0) return null;
  return (
    <div className={styles.card} style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Mapa de calor: onde cada caminho perde</div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 10px', maxWidth: 760 }}>
        Cada célula é a pergunta num caminho. O número é quanto, de quem CHEGOU naquela pergunta, parou ali — quanto mais
        escuro, mais gente parou. Passe o mouse para ver os totais e o aviso que mais travou.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table} style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Pergunta</th>
              {caminhos.map((c) => (
                <th key={c.id} style={{ textAlign: 'center', fontSize: 12, lineHeight: 1.2 }}>
                  {c.nome}<br /><span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>{c.sessoes}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{l.curta}</td>
                {caminhos.map((c) => {
                  const v = celula(c, l.id);
                  if (!v) return <td key={c.id} style={{ textAlign: 'center', color: 'var(--color-text-dim)' }}>—</td>;
                  if (v.pararam === 0) {
                    return (
                      <td key={c.id} title={`${l.pergunta} · ${c.nome}
Chegaram ${v.chegaram}, ninguém parou aqui`}
                        style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>0%</td>
                    );
                  }
                  const i = faixaDe(v.pct);
                  return (
                    <td key={c.id}
                      title={`${l.pergunta} · ${c.nome}
Chegaram ${v.chegaram}, pararam aqui ${v.pararam} (${v.pct}%)`
                        + (v.erro ? `
Aviso que mais travou: “${v.erro}”` : '')}
                      style={{ textAlign: 'center', background: CALOR[i], color: tintaDaFaixa(i), fontWeight: 700, borderRadius: 4 }}>
                      {v.pct}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
        <span>Pararam ali:</span>
        <span>0%</span>
        {CALOR.map((cor, i) => (
          <span key={cor} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 16, height: 12, background: cor, borderRadius: 3, display: 'inline-block' }} />
            {i === 0 ? 'até 10%' : i === CALOR.length - 1 ? 'mais de 60%' : `até ${FAIXAS[i]}%`}
          </span>
        ))}
        <span>· “—” = a pergunta não existe naquele caminho</span>
      </div>
    </div>
  );
}

function CaminhoCard({ c }: { c: Caminho }) {
  const dados = c.passos.filter((p) => p.chegaram > 0).map((p) => ({ ...p, seguiram: Math.max(0, p.chegaram - p.pararam) }));
  const pior = [...dados].sort((a, b) => b.pararam - a.pararam)[0];
  const destinos = DESTINOS.filter(([k]) => c.destinos[k]).map(([k, nome]) => `${nome} ${c.destinos[k]}`);
  return (
    <div className={styles.card} style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.nome}</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {c.sessoes} {c.sessoes === 1 ? 'pessoa' : 'pessoas'} · {c.terminaram} terminaram ({pct(c.terminaram, c.sessoes)}%)
          {destinos.length > 0 && <> · {destinos.join(' · ')}</>}
        </div>
      </div>
      {pior && pior.pararam > 0 && (
        <p style={{ fontSize: 13, margin: '0 0 10px', color: 'var(--color-text)' }}>
          Onde mais perde: <b>{pior.pergunta}</b>, {pior.pararam} {pior.pararam === 1 ? 'parou' : 'pararam'} ali ({pct(pior.pararam, c.sessoes)}% de quem entrou neste caminho).
        </p>
      )}
      {dados.length > 1 && (
        <ResponsiveContainer width="100%" height={dados.length * 30 + 56}>
          <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 0 }} barSize={16}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
            <YAxis type="category" dataKey="curta" width={128} tick={{ fontSize: 12, fill: 'var(--color-text)' }} interval={0} />
            <Tooltip content={<Dica />} cursor={{ fill: 'var(--color-border)', opacity: 0.35 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="seguiram" name="Seguiram adiante" stackId="a" fill={COR_SEGUIU} stroke="var(--color-surface)" strokeWidth={2} isAnimationActive={false} />
            <Bar dataKey="pararam" name="Pararam aqui" stackId="a" fill={COR_PAROU} stroke="var(--color-surface)" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="pararam" position="right" style={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                formatter={(v: unknown) => (Number(v) > 0 ? String(v) : '')} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className={styles.tableWrap} style={{ marginTop: 8 }}>
        <table className={styles.table}>
          <thead>
            <tr><th>Pergunta</th><th>Chegaram</th><th>Pararam aqui</th><th>% de quem chegou</th><th>Aviso que mais travou</th></tr>
          </thead>
          <tbody>
            {c.passos.map((p) => (
              <tr key={p.id} style={pior && p.id === pior.id && p.pararam > 0 ? { fontWeight: 700 } : undefined}>
                <td>{p.pergunta}</td>
                <td>{p.chegaram}</td>
                <td>{p.pararam}</td>
                <td>{p.chegaram ? `${pct(p.pararam, p.chegaram)}%` : '—'}</td>
                <td className={styles.mutedCell}>{p.erros[0] ? `“${p.erros[0].msg}” (${p.erros[0].sessoes})` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Tela estreita (celular): o eixo de nomes encolhe, senão as barras somem. Lido
// com useSyncExternalStore para não pintar diferente do servidor na primeira vez.
const ESTREITO = '(max-width: 640px)';
function useEstreito(): boolean {
  return useSyncExternalStore(
    (avisar) => { const m = window.matchMedia(ESTREITO); m.addEventListener('change', avisar); return () => m.removeEventListener('change', avisar); },
    () => window.matchMedia(ESTREITO).matches,
    () => false,
  );
}

// ── POR CONJUNTO ─────────────────────────────────────────────────────────────
// O número que decide verba é o custo por reunião, então ele é o gráfico. O
// resto (cadastros, o que a reunião virou, onde para no quiz) fica na tabela.
// Reunião, cadastro e gasto valem para qualquer período (o utm_term é gravado
// desde julho); "onde mais para" só existe a partir de 22/09.
function ConjuntosCard({ f, conjunto, escolher, produto = 'eletroposto' }: { f: Funil; conjunto: string; escolher: (id: string) => void; produto?: Produto }) {
  const solar = produto === 'solar';
  const um = solar ? 'horário marcado' : 'reunião', muitos = solar ? 'horários marcados' : 'reuniões';
  const linhas = f.por_conjunto;
  const estreito = useEstreito();
  // O nome inteiro fica na dica e na tabela; no eixo, o começo basta (os
  // conjuntos são numerados: "5 posto araguari…").
  const corte = estreito ? 18 : 30;
  const grafico = linhas
    .filter((l) => l.custo_reuniao !== null)
    .map((l) => ({ nome: l.nome.length > corte ? `${l.nome.slice(0, corte - 1)}…` : l.nome, completo: l.nome, custo: l.custo_reuniao as number, reunioes: l.reunioes, gasto: l.gasto }))
    .sort((a, b) => a.custo - b.custo);
  const confiaveis = linhas.filter((l) => l.custo_reuniao !== null && l.reunioes >= 3);
  const melhor = confiaveis.length > 1 ? [...confiaveis].sort((a, b) => (a.custo_reuniao as number) - (b.custo_reuniao as number))[0] : null;
  return (
    <div className={styles.card} style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Por conjunto de anúncios</div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 10px', maxWidth: 760 }}>
        De onde veio cada pessoa: o conjunto sai do link do anúncio (utm_term) e vale para visita, {um}{solar ? '' : ', ficha e cadastro'}.
        {melhor && <> O {um} mais barato do período veio de <b style={{ color: 'var(--color-text)' }}>{melhor.nome}</b>, a {reais(melhor.custo_reuniao)} cada.</>}
      </p>
      {!f.meta_ok && (
        <p style={{ fontSize: 13, margin: '0 0 10px' }}>A Meta não respondeu agora{f.meta_motivo ? ` (${f.meta_motivo})` : ''}: nome e gasto ficaram de fora, o resto está certo.</p>
      )}
      {grafico.length > 1 && (
        <ResponsiveContainer width="100%" height={grafico.length * 30 + 40}>
          <BarChart data={grafico} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 0 }} barSize={16}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={(v: number) => `R$ ${v}`} />
            {/* Rótulo desenhado à mão: o padrão do recharts quebra nome longo em
                duas linhas e encavala no vizinho. Aqui ele fica numa linha só. */}
            <YAxis type="category" dataKey="nome" width={estreito ? 118 : 200} interval={0}
              tick={(t) => (
                <text x={t.x} y={t.y} dy={4} textAnchor="end" fontSize={estreito ? 11 : 12} fill="var(--color-text)">{String(t.payload?.value ?? '')}</text>
              )} />
            <Tooltip cursor={{ fill: 'var(--color-border)', opacity: 0.35 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof grafico)[number];
              return (
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.completo}</div>
                  <div>Custo por {um}: <b>{reais(d.custo)}</b></div>
                  <div>{reais(d.gasto)} gastos · {d.reunioes} {d.reunioes === 1 ? um : muitos}</div>
                </div>
              );
            }} />
            <Bar dataKey="custo" name={`Custo por ${um}`} fill={COR_SEGUIU} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="custo" position="right" style={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                formatter={(v: unknown) => reais(Number(v))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className={styles.tableWrap} style={{ marginTop: 8 }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Conjunto</th><th>Gasto</th><th>Visitas</th><th>{solar ? 'Horários marcados' : 'Reuniões'}</th><th>Custo por {um}</th>
              {!solar && <><th>Investidores</th><th>Custo por resultado</th></>}<th>{solar ? 'O que já aconteceu' : 'Reuniões que já aconteceram'}</th><th>Onde mais para no quiz</th><th></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} style={conjunto === l.id ? { background: 'var(--color-border)' } : undefined}>
                <td>
                  {l.nome}
                  {SITUACAO[l.status] && <span className={styles.mutedCell}> ({SITUACAO[l.status]})</span>}
                </td>
                <td>{reais(l.gasto)}</td>
                <td>{l.visitas}</td>
                <td>{l.reunioes}</td>
                <td style={melhor && melhor.id === l.id ? { fontWeight: 700 } : undefined}>{reais(l.custo_reuniao)}</td>
                {!solar && <><td>{l.investidores}</td>
                <td>{reais(l.custo_resultado)}</td></>}
                <td className={styles.mutedCell}>
                  {l.negocio + l.arrendamento + l.perdidas === 0 ? '—'
                    : solar ? `${l.negocio} orçamento · ${l.perdidas} perdidas` : `${l.negocio} negócio · ${l.arrendamento} arrend. · ${l.perdidas} perdidas`}
                </td>
                <td className={styles.mutedCell}>{l.pior ? `${l.pior.pergunta} (${l.pior.pararam})` : '—'}</td>
                <td>
                  {l.abriram_quiz > 0 && (
                    <button className={styles.periodBtn} onClick={() => escolher(conjunto === l.id ? '' : l.id)}>
                      {conjunto === l.id ? 'Tirar filtro' : 'Ver no quiz'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
        Gasto é o do período na Meta. O conjunto é o do primeiro clique da pessoa (a UTM da primeira visita).
        {solar
          ? <>Orçamento = fez orçamento ou proposta apresentada; perdida = sem interesse, não atendeu, cancelou ou fechou com outro. O quiz solar conta desde 08/10/2026.</>
          : <>Custo por resultado = gasto ÷ (reuniões + investidores + pontos); a mesma pessoa pode contar em mais de uma coluna.
        Negócio = orçamento, proposta, chave na mão, meio a meio ou carregador; perdida = sem interesse, não atendeu, cancelou ou
        fechou com outro. A coluna “onde mais para no quiz” só existe a partir de 22/09.</>}
      </p>
    </div>
  );
}

export default function QuizEletropostoPanel({ produto = 'eletroposto' }: { produto?: Produto } = {}) {
  const [periodo, setPeriodo] = useState('7dias');
  const [f, setF] = useState<Funil | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);   // o ↻ Atualizar só incrementa isto
  const [conjunto, setConjunto] = useState('');   // '' = todos os conjuntos

  // O estado só muda na volta da leitura, nunca no corpo do efeito: é quem
  // CLICA que acende o "Atualizando…" (trocar/atualizar, logo abaixo).
  useEffect(() => {
    let vivo = true;
    api.get(`/admin/${produto}/quiz-funil?period=${periodo}${conjunto ? `&conjunto=${encodeURIComponent(conjunto)}` : ''}`)
      .then((r) => { if (vivo) { setF(r.data as Funil); setErro(''); } })
      .catch((e) => { if (vivo) { setF(null); setErro(String(e?.response?.data?.error || e?.message || e)); } })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [periodo, versao, conjunto, produto]);
  const trocar = (p: string) => { if (p === periodo) return; setCarregando(true); setPeriodo(p); };
  const atualizar = () => { setCarregando(true); setVersao((v) => v + 1); };
  const escolherConjunto = (id: string) => { setCarregando(true); setConjunto(id); };
  const nomeDoFiltro = f?.por_conjunto.find((l) => l.id === conjunto)?.nome || conjunto;

  const inicio = f?.caminhos.find((c) => c.id === 'inicio');
  const caminhos = (f?.caminhos ?? []).filter((c) => c.id !== 'inicio' && c.sessoes > 0).sort((a, b) => b.sessoes - a.sessoes);

  return (
    <div>
      <div className={styles.periodTabs}>
        {PERIODOS.map((p) => (
          <button key={p.k} className={periodo === p.k ? styles.periodActive : styles.periodBtn} onClick={() => trocar(p.k)}>{p.label}</button>
        ))}
        <button className={styles.periodBtn} disabled={carregando} onClick={atualizar} style={{ marginLeft: 'auto' }}>
          {carregando ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '10px 0 0', maxWidth: 760 }}>
        Quem abre o link de /io/{produto} vê só o quiz. Aqui aparece, pergunta por pergunta, quantos chegaram e quantos pararam ali.
        {f && <> As perguntas são contadas desde {dataBR(f.medindo_desde)}: antes disso a página não contava.</>}
      </p>

      {erro && <div className={styles.card} style={{ marginTop: 12 }}>Não consegui ler o funil: {erro}</div>}
      {!f && !erro && <div className={styles.card} style={{ marginTop: 12, color: 'var(--color-text-muted)' }}>Carregando…</div>}

      {f && (
        <>
          <div className={styles.cards} style={{ marginTop: 12 }}>
            <div className={styles.card}><div className={styles.cardLabel}>Visitas</div><div className={styles.cardValue}>{f.visitas}</div></div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Abriram o quiz</div><div className={styles.cardValue}>{f.abriram}</div>
              <div className={styles.cardSub}>{pct(f.abriram, f.visitas)}% das visitas</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>{produto === 'solar' ? 'Responderam a conta' : 'Escolheram uma porta'}</div><div className={styles.cardValue}>{f.escolheram_porta}</div>
              <div className={styles.cardSub}>{pct(f.escolheram_porta, f.abriram)}% de quem abriu</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Terminaram</div><div className={styles.cardValue}>{f.terminaram}</div>
              <div className={styles.cardSub}>{pct(f.terminaram, f.abriram)}% de quem abriu</div>
            </div>
          </div>

          <ConjuntosCard f={f} conjunto={conjunto} escolher={escolherConjunto} produto={produto} />

          {conjunto && (
            <div className={styles.card} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>Quiz mostrando só o conjunto <b>{nomeDoFiltro}</b>. Os números do topo também.</span>
              <button className={styles.periodBtn} onClick={() => escolherConjunto('')}>Ver todos os conjuntos</button>
            </div>
          )}

          {f.abriram === 0 ? (
            <div className={styles.card} style={{ marginTop: 12, color: 'var(--color-text-muted)' }}>
              Ninguém abriu o quiz neste período desde que a medição começou. Os números aparecem assim que as próximas visitas chegarem.
            </div>
          ) : (
            <>
              <div className={styles.card} style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Onde terminaram</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13 }}>
                  {DESTINOS_POR[produto].map(([k, nome]) => (
                    <span key={k}>{nome}: <b>{f.destinos[k] || 0}</b></span>
                  ))}
                </div>
                {inicio && inicio.sessoes > 0 && (
                  <p style={{ fontSize: 13, margin: '10px 0 0', color: 'var(--color-text)' }}>
                    <b>{inicio.sessoes}</b> abriram e saíram sem {produto === 'solar' ? 'responder a conta' : 'escolher uma porta'} ({pct(inicio.sessoes, f.abriram)}% de quem abriu).
                  </p>
                )}
              </div>

              <MapaDeCalor caminhos={caminhos} />

              {caminhos.map((c) => <CaminhoCard key={c.id} c={c} />)}

              {f.campanhas.length > 0 && (
                <div className={styles.card} style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Por campanha</div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th>Campanha</th><th>Visitas</th><th>Abriram</th><th>Terminaram</th><th>{produto === 'solar' ? 'Horários marcados' : 'Reuniões'}</th></tr></thead>
                      <tbody>
                        {f.campanhas.map((c) => (
                          <tr key={c.campanha}>
                            <td>{c.campanha}</td><td>{c.visitas}</td><td>{c.abriram}</td>
                            <td>{c.terminaram} <span className={styles.mutedCell}>({pct(c.terminaram, c.abriram)}%)</span></td>
                            <td>{c.reunioes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
