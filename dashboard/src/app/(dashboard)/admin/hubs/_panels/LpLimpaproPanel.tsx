'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DE VENDA (LP) — LimpaPro. A jornada real do lead na landing: até onde
// rolou, quanto tempo ficou em cada bloco, que dúvida abriu, que botão clicou.
//
// Vem de /admin/jornada-limpapro, que agrega no servidor a coluna `raw` dos
// eventos `sessao` (um por visita, mandado quando a aba some).
//
// A medição começou em 07/08/2026 — antes disso o backend achatava todo evento em
// 'pageview', então a base anterior não separa clique de visita e NÃO entra aqui.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Jornada {
  dias: number;
  gerado_em: string;
  funil: {
    sessoes: number; com_perfil: number; chegou_no_preco: number; clicou: number;
    pct_chegou: number; pct_clicou: number; pct_clicou_de_quem_viu: number;
    profundidade_media: number; segundos_medios: number;
  };
  parada: { id: string; nome: string; sessoes: number; pct: number }[];
  blocos: { id: string; nome: string; sessoes: number; media: number; alcance: number }[];
  duvidas: { duvida: string; sessoes: number; pct: number }[];
  ctas: { cta: string; sessoes: number; segundo_medio: number }[];
  popup: { estado: string; sessoes: number; pct: number }[];
  conta: { faixa: string; sessoes: number; clicou: number; pct_clicou: number }[];
  aparelhos: { aparelho: string; sessoes: number; clicou: number; pct_clicou: number }[];
}

const PERIODS: { k: number; label: string }[] = [
  { k: 1, label: 'Hoje' }, { k: 7, label: '7 dias' }, { k: 30, label: '30 dias' },
];

export default function LpLimpaproPanel() {
  const [dias, setDias] = useState(7);
  const [data, setData] = useState<Jornada | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((d: number) => {
    setLoading(true);
    api.get(`/admin/jornada-limpapro?dias=${d}`)
      .then((r) => setData(r.data as Jornada))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(dias); }, [dias, load]);

  const f = data?.funil;
  // O funil desenha sobre as sessões COM jornada registrada — só elas têm o detalhe.
  const base = f?.com_perfil ?? 0;
  const passos = f ? [
    { label: 'Visitas com jornada', value: f.com_perfil },
    { label: 'Chegou no preço', value: f.chegou_no_preco },
    { label: 'Clicou em comprar', value: f.clicou },
  ] : [];
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const maxBloco = Math.max(...(data?.blocos ?? []).map((b) => b.media), 1);

  return (
    <div>
      <div className={styles.periodTabs}>
        {PERIODS.map((p) => (
          <button key={p.k} className={dias === p.k ? styles.periodActive : styles.periodBtn}
                  onClick={() => setDias(p.k)}>{p.label}</button>
        ))}
        <button className={styles.periodBtn} disabled={loading} onClick={() => load(dias)} style={{ marginLeft: 'auto' }}>
          {loading ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      {/* números do topo */}
      <div className={styles.cards} style={{ marginTop: 12 }}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Visitas</div>
          <div className={styles.cardValue}>{(f?.sessoes ?? 0).toLocaleString('pt-BR')}</div>
          <div className={styles.cardSub}>{f?.com_perfil ?? 0} com jornada registrada</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Chegou no preço</div>
          <div className={styles.cardValue}>{f?.pct_chegou ?? 0}%</div>
          <div className={styles.cardSub}>{f?.chegou_no_preco ?? 0} visitas</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Clicou em comprar</div>
          <div className={styles.cardValue}>{f?.pct_clicou ?? 0}%</div>
          <div className={styles.cardSub}>{f?.pct_clicou_de_quem_viu ?? 0}% de quem viu o preço</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Leitura média</div>
          <div className={styles.cardValue}>{f?.profundidade_media ?? 0}%</div>
          <div className={styles.cardSub}>da página · {f?.segundos_medios ?? 0}s lendo</div>
        </div>
      </div>

      {/* funil */}
      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Visita → preço → clique</div>
        {base === 0 ? (
          <p className={styles.empty}>
            {loading ? 'Carregando…' : 'Sem jornada registrada no período. A medição começou em 07/08/2026.'}
          </p>
        ) : (
          <div className={styles.funnelSteps}>
            {passos.map((s, i) => (
              <div key={i} className={styles.funnelStep}>
                <div className={styles.funnelLabel}>{s.label}</div>
                <div className={styles.funnelBar}>
                  <div className={styles.funnelFill} style={{ width: `${pct(s.value, base)}%` }} />
                </div>
                <div className={styles.funnelValue}>
                  {s.value.toLocaleString('pt-BR')} <span className={styles.funnelPct}>{pct(s.value, base)}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* quanto tempo cada bloco segura — é isto que diz qual seção cortar */}
      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Quanto tempo cada bloco segura</div>
        <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 12.5 }}>
          Bloco que ninguém olha 2 segundos não está vendendo — está atrasando. A página tem 23.373px.
        </p>
        {(data?.blocos ?? []).length === 0 ? (
          <p className={styles.empty}>{loading ? 'Carregando…' : 'Sem dados no período.'}</p>
        ) : (
          <div className={styles.funnelSteps}>
            {(data?.blocos ?? []).map((b) => (
              <div key={b.id} className={styles.funnelStep}>
                <div className={styles.funnelLabel}>{b.nome}</div>
                <div className={styles.funnelBar}>
                  <div className={styles.funnelFill} style={{ width: `${Math.round((b.media / maxBloco) * 100)}%` }} />
                </div>
                <div className={styles.funnelValue}>
                  {b.media}s <span className={styles.funnelPct}>{b.alcance}% viram</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* onde param + qual botão */}
      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Onde param de rolar</th><th style={{ textAlign: 'right' }}>Visitas</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
          <tbody>
            {(data?.parada ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Sem dados no período.'}</td></tr>
            )}
            {(data?.parada ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td style={{ textAlign: 'right' }}>{p.sessoes}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{p.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Botão clicado</th><th style={{ textAlign: 'right' }}>Cliques</th><th style={{ textAlign: 'right' }}>Segundo médio</th></tr></thead>
          <tbody>
            {(data?.ctas ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Ninguém clicou no período.'}</td></tr>
            )}
            {(data?.ctas ?? []).map((c) => (
              <tr key={c.cta}>
                <td>{c.cta}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{c.sessoes}</td>
                <td style={{ textAlign: 'right' }}>{c.segundo_medio}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* as objeções, escritas pelo próprio cliente */}
      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Dúvida que ele abriu no FAQ</th><th style={{ textAlign: 'right' }}>Vezes</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
          <tbody>
            {(data?.duvidas ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Ninguém abriu dúvida no período.'}</td></tr>
            )}
            {(data?.duvidas ?? []).map((d, i) => (
              <tr key={i}>
                <td>{d.duvida}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{d.sessoes}</td>
                <td style={{ textAlign: 'right' }}>{d.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* a conta do bairro convence? + popup + aparelho */}
      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Leitura da conta do bairro</th><th style={{ textAlign: 'right' }}>Visitas</th><th style={{ textAlign: 'right' }}>Clicou</th></tr></thead>
          <tbody>
            {(data?.conta ?? []).filter((c) => c.sessoes > 0).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Sem dados no período.'}</td></tr>
            )}
            {(data?.conta ?? []).filter((c) => c.sessoes > 0).map((c, i) => (
              <tr key={i}>
                <td>{c.faixa}</td>
                <td style={{ textAlign: 'right' }}>{c.sessoes}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{c.pct_clicou}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Popup de R$ 60</th><th style={{ textAlign: 'right' }}>Visitas</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
          <tbody>
            {(data?.popup ?? []).map((p, i) => (
              <tr key={i}>
                <td>{p.estado}</td>
                <td style={{ textAlign: 'right' }}>{p.sessoes}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{p.pct}%</td>
              </tr>
            ))}
            {(data?.popup ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Sem dados no período.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Aparelho</th><th style={{ textAlign: 'right' }}>Visitas</th><th style={{ textAlign: 'right' }}>Clicou</th></tr></thead>
          <tbody>
            {(data?.aparelhos ?? []).map((a, i) => (
              <tr key={i}>
                <td>{a.aparelho}</td>
                <td style={{ textAlign: 'right' }}>{a.sessoes}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{a.pct_clicou}%</td>
              </tr>
            ))}
            {(data?.aparelhos ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>{loading ? 'Carregando…' : 'Sem dados no período.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        A jornada é registrada quando a pessoa sai da página, então visita em andamento ainda não
        aparece. Medindo desde 07/08/2026 — a base anterior misturava clique com visita e não entra
        nesta conta.
      </p>
    </div>
  );
}
