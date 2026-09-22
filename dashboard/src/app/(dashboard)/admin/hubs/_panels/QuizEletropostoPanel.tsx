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
import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, LabelList,
} from 'recharts';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Passo { id: string; pergunta: string; curta: string; chegaram: number; pararam: number; erros: { msg: string; sessoes: number }[] }
interface Caminho { id: string; nome: string; sessoes: number; terminaram: number; destinos: Record<string, number>; passos: Passo[] }
interface Campanha { campanha: string; visitas: number; abriram: number; terminaram: number; reunioes: number }
interface Funil {
  medindo_desde: string; visitas: number; abriram: number; escolheram_porta: number; terminaram: number;
  destinos: Record<string, number>; caminhos: Caminho[]; campanhas: Campanha[];
}

const PERIODOS = [
  { k: 'hoje', label: 'Hoje' }, { k: 'ontem', label: 'Ontem' }, { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' }, { k: 'maximo', label: 'Desde o início' },
];
const DESTINOS: [string, string][] = [
  ['reuniao', 'Reunião marcada'], ['arrendamento', 'Arrendamento'], ['investidor', 'Investidores'],
  ['curioso', 'Curioso'], ['parceiro', 'Parceiros'], ['curso', 'Curso /ponto-certo'],
];
// Duas séries, as duas primeiras da paleta de referência (validadas juntas:
// CVD ΔE 24.7, contraste ≥ 3:1 no fundo claro). O texto nunca usa a cor da série.
const COR_SEGUIU = '#2a78d6';
const COR_PAROU = '#eb6834';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
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

export default function QuizEletropostoPanel() {
  const [periodo, setPeriodo] = useState('7dias');
  const [f, setF] = useState<Funil | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);   // o ↻ Atualizar só incrementa isto

  // O estado só muda na volta da leitura, nunca no corpo do efeito: é quem
  // CLICA que acende o "Atualizando…" (trocar/atualizar, logo abaixo).
  useEffect(() => {
    let vivo = true;
    api.get(`/admin/eletroposto/quiz-funil?period=${periodo}`)
      .then((r) => { if (vivo) { setF(r.data as Funil); setErro(''); } })
      .catch((e) => { if (vivo) { setF(null); setErro(String(e?.response?.data?.error || e?.message || e)); } })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [periodo, versao]);
  const trocar = (p: string) => { if (p === periodo) return; setCarregando(true); setPeriodo(p); };
  const atualizar = () => { setCarregando(true); setVersao((v) => v + 1); };

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
        Quem abre o link de /io/eletroposto vê só o quiz. Aqui aparece, pergunta por pergunta, quantos chegaram e quantos pararam ali.
        {f && <> Medindo desde {dataBR(f.medindo_desde)}: antes disso a página não contava.</>}
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
              <div className={styles.cardLabel}>Escolheram uma porta</div><div className={styles.cardValue}>{f.escolheram_porta}</div>
              <div className={styles.cardSub}>{pct(f.escolheram_porta, f.abriram)}% de quem abriu</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Terminaram</div><div className={styles.cardValue}>{f.terminaram}</div>
              <div className={styles.cardSub}>{pct(f.terminaram, f.abriram)}% de quem abriu</div>
            </div>
          </div>

          {f.abriram === 0 ? (
            <div className={styles.card} style={{ marginTop: 12, color: 'var(--color-text-muted)' }}>
              Ninguém abriu o quiz neste período desde que a medição começou. Os números aparecem assim que as próximas visitas chegarem.
            </div>
          ) : (
            <>
              <div className={styles.card} style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Onde terminaram</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13 }}>
                  {DESTINOS.map(([k, nome]) => (
                    <span key={k}>{nome}: <b>{f.destinos[k] || 0}</b></span>
                  ))}
                </div>
                {inicio && inicio.sessoes > 0 && (
                  <p style={{ fontSize: 13, margin: '10px 0 0', color: 'var(--color-text)' }}>
                    <b>{inicio.sessoes}</b> abriram e saíram sem escolher uma porta ({pct(inicio.sessoes, f.abriram)}% de quem abriu).
                  </p>
                )}
              </div>

              {caminhos.map((c) => <CaminhoCard key={c.id} c={c} />)}

              {f.campanhas.length > 0 && (
                <div className={styles.card} style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Por campanha</div>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th>Campanha</th><th>Visitas</th><th>Abriram</th><th>Terminaram</th><th>Reuniões</th></tr></thead>
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
