'use client';

// ─────────────────────────────────────────────────────────────────────────────
// RETENÇÃO DA VSL — a curva "quantos ainda estavam assistindo no segundo X",
// no espírito do gráfico do Panda Video. Fica embaixo da jornada da LP porque
// play só quer dizer alguma coisa ao lado de visita: 40 plays é ótimo em 50
// visitas e péssimo em 900.
//
// Lê /admin/vsl (lp_events 'vsl' + page_visits). Endpoint fora do ar devolve
// "—" em vez de gráfico de zeros: painel que desenha zero mente dizendo que
// ninguém assistiu, quando na verdade ele é que não perguntou.
//
// O que a curva responde, na prática: onde a pessoa desiste. Queda vertical nos
// primeiros segundos é abertura fraca; degrau no meio é a parte que dá pra
// cortar; trecho rebobinado (tocado mais de uma vez) é onde ela não entendeu —
// ou onde está o preço.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Ponto { s: number; views: number; pct: number; rep: number }
interface Retencao {
  visitas: number; plays: number; comSom: number; viramCta: number;
  cliqueCta: number; cliqueSemPlay: number; pularam: number; completaram: number; cliqueSegundo: number | null;
  assistidoMedio: number | null; assistidoMediano: number | null;
  duracao: number | null; bucket: number | null; curva: Ponto[];
}

const PERIODS = [
  { k: 'hoje', label: 'Hoje' }, { k: '7dias', label: '7 dias' },
  { k: 'mes', label: 'Mês' }, { k: 'maximo', label: 'Máx' },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// Geometria do gráfico. viewBox fixo + width:100% deixa o SVG responsivo sem
// media query; os traços não engordam porque usam vector-effect.
const L = 46, R = 14, T = 16, B = 28, W = 1000, H = 300;
const px = (i: number, n: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
const py = (p: number) => T + (1 - p / 100) * (H - T - B);

export default function VslPanel({ lp }: { lp: string }) {
  const [period, setPeriod] = useState('7dias');
  const [dados, setDados] = useState<Retencao | null>(null);
  const [erro, setErro] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const load = useCallback((p: string) => {
    setLoading(true); setErro(false);
    api.get(`/admin/vsl?lp=${lp}&period=${p}`)
      .then((r) => setDados(r.data as Retencao))
      .catch(() => { setDados(null); setErro(true); })
      .finally(() => setLoading(false));
  }, [lp]);
  useEffect(() => { load(period); }, [period, load]);

  const curva = dados?.curva ?? [];
  const plays = dados?.plays ?? 0;
  const bucket = dados?.bucket ?? 5;

  // Hover: converte o x do mouse no índice do ponto. Alvo é a faixa inteira do
  // gráfico, não o marcador — mira de 4px é mira que ninguém acerta.
  function mover(e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) {
    const svg = svgRef.current; if (!svg || curva.length === 0) return;
    const box = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    if (clientX == null) return;
    const x = ((clientX - box.left) / box.width) * W;
    const t = (x - L) / (W - L - R);
    setHover(Math.max(0, Math.min(curva.length - 1, Math.round(t * (curva.length - 1)))));
  }

  const marcos = curva.length
    ? [0, 0.25, 0.5, 0.75, 0.99].map((f) => curva[Math.min(curva.length - 1, Math.round(f * (curva.length - 1)))])
    : [];

  return (
    <div className={styles.card} style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ fontWeight: 700 }}>Vídeo de entrada (VSL)</div>
        <div className={styles.periodTabs} style={{ marginLeft: 'auto' }}>
          {PERIODS.map((p) => (
            <button key={p.k} className={period === p.k ? styles.periodActive : styles.periodBtn} onClick={() => setPeriod(p.k)}>{p.label}</button>
          ))}
        </div>
      </div>

      {erro ? (
        <p className={styles.empty} style={{ margin: 0 }}>
          Não consegui ler <code>/admin/vsl</code> — sem resposta do endpoint. Os números
          continuam sendo gravados; é a leitura que está fora.
        </p>
      ) : plays === 0 ? (
        <p className={styles.empty} style={{ margin: 0 }}>
          {loading ? 'Carregando…' : 'Nenhum play registrado no período.'}
          {!loading && dados?.cliqueSemPlay
            ? ` ${dados.cliqueSemPlay} abriram a página sem o vídeo chegar a rodar — navegador recusando o autoplay.`
            : ''}
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(126px,1fr))', gap: 12, margin: '14px 0 20px' }}>
            <Tile label="Deram play" valor={plays.toLocaleString('pt-BR')}
              sub={dados!.visitas > 0 ? `${pct(plays, dados!.visitas)}% de ${dados!.visitas} visitas` : 'sem visita casada'} />
            <Tile label="Ligaram o som" valor={dados!.comSom.toLocaleString('pt-BR')} sub={`${pct(dados!.comSom, plays)}% de quem deu play`} />
            {/* Foi "Viram o botão" até 19/08. O botão passou a nascer aceso, e a
                pergunta que sobrou de pé é a retenção do começo do vídeo. */}
            <Tile label="Passaram dos 5s" valor={dados!.viramCta.toLocaleString('pt-BR')} sub={`${pct(dados!.viramCta, plays)}% de quem deu play`} />
            {/* O botão do portão não agenda: ele abre a LP. Aqui separa quem viu
                o vídeo e ENTROU na página de quem viu e foi embora. */}
            <Tile label="Abriram a página" valor={dados!.cliqueCta ? dados!.cliqueCta.toLocaleString('pt-BR') : '—'}
              sub={dados!.cliqueCta
                ? `${pct(dados!.cliqueCta, plays)}% de quem deu play${dados!.cliqueSegundo != null ? ` · mediana aos ${mmss(dados!.cliqueSegundo)}` : ''}`
                : 'ninguém apertou o botão'} />
            <Tile label="Tempo assistido" valor={dados!.assistidoMedio != null ? mmss(dados!.assistidoMedio) : '—'}
              sub={dados!.duracao ? `de ${mmss(dados!.duracao)} · mediana ${mmss(dados!.assistidoMediano ?? 0)}` : 'média por sessão'} />
            <Tile label="Foram até o fim" valor={dados!.completaram.toLocaleString('pt-BR')} sub={`${pct(dados!.completaram, plays)}% de quem deu play`} />
          </div>

          {/* Em tela estreita o gráfico rola de lado em vez de encolher: 300px de
              altura espremidos em 380 de largura viram um risco ilegível. */}
          <div style={{ position: 'relative', overflowX: 'auto' }}>
            <svg
              ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
              aria-label={`Curva de retenção do vídeo: ${plays} plays, ${curva.length} pontos`}
              style={{ display: 'block', minWidth: 620, touchAction: 'pan-y', cursor: 'crosshair' }}
              onMouseMove={mover} onMouseLeave={() => setHover(null)} onTouchStart={mover} onTouchMove={mover}
            >
              <defs>
                <linearGradient id="vslArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* grade recessiva — presente pra ler o valor, silenciosa o bastante
                  pra não competir com a curva */}
              {[0, 25, 50, 75, 100].map((g) => (
                <g key={g}>
                  <line x1={L} x2={W - R} y1={py(g)} y2={py(g)} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <text x={L - 10} y={py(g) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-muted)">{g}%</text>
                </g>
              ))}

              {/* Trechos rebobinados: onde quem viu tocou mais de uma vez. É o
                  pedaço que não entrou de primeira — ou onde está o preço. */}
              {curva.map((p, i) => (p.rep >= 1.15 ? (
                <rect key={`r${i}`} x={px(i, curva.length) - (W - L - R) / (curva.length * 2)}
                  y={T} width={(W - L - R) / curva.length} height={H - T - B}
                  fill="var(--color-primary)" opacity="0.07" />
              ) : null))}

              <path d={`M ${px(0, curva.length)} ${py(curva[0]?.pct ?? 0)} ${curva.map((p, i) => `L ${px(i, curva.length)} ${py(p.pct)}`).join(' ')} L ${px(curva.length - 1, curva.length)} ${py(0)} L ${px(0, curva.length)} ${py(0)} Z`} fill="url(#vslArea)" />
              <path d={`M ${curva.map((p, i) => `${i ? 'L' : ''} ${px(i, curva.length)} ${py(p.pct)}`).join(' ')}`}
                fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

              {/* Marco dos 5s: o corte que separa quem só espiou de quem ficou. */}
              {dados!.duracao ? (() => {
                const i5 = Math.min(curva.length - 1, Math.round(5 / bucket));
                return (
                  <g>
                    <line x1={px(i5, curva.length)} x2={px(i5, curva.length)} y1={T} y2={H - B}
                      stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                    <text x={px(i5, curva.length) + 6} y={H - B - 7} fontSize="10.5" fill="var(--color-text-muted)">5s</text>
                  </g>
                );
              })() : null}

              {/* eixo do tempo */}
              {curva.length > 1 && [0, 0.25, 0.5, 0.75, 1].map((f) => {
                const i = Math.round(f * (curva.length - 1));
                return <text key={f} x={px(i, curva.length)} y={H - 8} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize="11" fill="var(--color-text-muted)">{mmss(curva[i].s)}</text>;
              })}

              {hover != null && curva[hover] && (
                <g>
                  <line x1={px(hover, curva.length)} x2={px(hover, curva.length)} y1={T} y2={H - B} stroke="var(--color-text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  <circle cx={px(hover, curva.length)} cy={py(curva[hover].pct)} r="5" fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth="2" />
                </g>
              )}
            </svg>

            {hover != null && curva[hover] && (
              <div style={{
                position: 'absolute', top: 6, pointerEvents: 'none',
                left: `${(px(hover, curva.length) / W) * 100}%`,
                transform: hover > curva.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
                background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                borderRadius: 8, padding: '8px 11px', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'nowrap',
              }}>
                <div style={{ color: 'var(--color-text-muted)' }}>{mmss(curva[hover].s)}</div>
                <div style={{ fontWeight: 700 }}>{curva[hover].pct}% ainda assistindo</div>
                <div style={{ color: 'var(--color-text-muted)' }}>{curva[hover].views} de {plays} sessões</div>
                {curva[hover].rep >= 1.15 && (
                  <div style={{ color: 'var(--color-text-muted)' }}>rebobinado ({curva[hover].rep.toFixed(1)}× em média)</div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Passe o mouse na curva. Faixa clara = trecho que as pessoas voltaram pra rever.
            </span>
            <button className={styles.periodBtn} onClick={() => setTabela((v) => !v)} style={{ marginLeft: 'auto' }}>
              {tabela ? 'Esconder tabela' : 'Ver em tabela'}
            </button>
            <button className={styles.periodBtn} disabled={loading} onClick={() => load(period)}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
          </div>

          {tabela && (
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <table className={styles.table}>
                <thead><tr><th>Momento</th><th style={{ textAlign: 'right' }}>Ainda assistindo</th><th style={{ textAlign: 'right' }}>Sessões</th></tr></thead>
                <tbody>
                  {marcos.map((p, i) => (
                    <tr key={i}><td>{mmss(p.s)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{p.pct}%</td><td style={{ textAlign: 'right' }}>{p.views}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
            Fonte: <code>/admin/vsl</code> — baldes de {bucket}s enviados pela própria LP.
            {dados!.cliqueSemPlay ? ` Fora da conta: ${dados!.cliqueSemPlay} abriram a página sem o vídeo rodar (autoplay recusado).` : ''}
            {dados!.pularam ? ` ${dados!.pularam} usaram a saída discreta, que existiu até 19/08.` : ''}
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, valor, sub }: { label: string; valor: string; sub: string }) {
  return (
    <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px' }}>
      <div className={styles.cardLabel} style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{valor}</div>
      <div className={styles.cardSub}>{sub}</div>
    </div>
  );
}
