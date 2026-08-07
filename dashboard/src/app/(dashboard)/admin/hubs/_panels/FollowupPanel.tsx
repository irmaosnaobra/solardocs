'use client';

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOWUP — "acompanhar os agentes trabalhando". Lê /admin/hub-followup?produto=X
// (whatsapp_sessions do agente do produto): quantos ativos, em conversa, com handoff
// (humano assumiu), opt-out, e a atividade recente. Só exibe.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import type { HubFollowup, HubConversaoBloco, HubHistorico, HubHistoricoBloco } from './hubFollowup.types';

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtMes = (m: string) => {
  const [a, mm] = m.split('-');
  return `${MESES_PT[Number(mm) - 1] ?? m}/${a?.slice(2) ?? ''}`;
};
const pct = (v: number | null) => (v === null ? '—' : `${v.toString().replace('.', ',')}%`);
const brl = (v: number | null) =>
  // minimumFractionDigits explícito: BRL assume 2 e o máximo não pode ser menor que o
  // mínimo — passar só o máximo=0 pode virar RangeError e derrubar a aba inteira.
  v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtWhen = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 999, padding: '2px 8px', marginRight: 5 }}>
      {label}
    </span>
  );
}

// Funil do agente. O que não dá pra medir aparece como "—" — nunca como 0.
function FunilConversao({ b }: { b: HubConversaoBloco }) {
  const medivel = b.converteram !== null;
  const passos = [
    { label: 'Abordados', value: String(b.abordados), color: 'var(--color-text)' },
    { label: 'Responderam', value: String(b.responderam), color: '#2C9C67' },
    { label: b.rotulo_conv || 'Converteram', value: medivel ? String(b.converteram) : '—', color: medivel ? 'var(--color-primary)' : 'var(--color-text-muted)' },
    { label: 'Taxa de sucesso', value: pct(b.taxa_pct), color: b.taxa_pct !== null ? 'var(--color-primary)' : 'var(--color-text-muted)' },
    { label: 'Entrou de grana', value: brl(b.receita), color: b.receita ? '#2C9C67' : 'var(--color-text-muted)' },
  ];
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>{b.rotulo} · agora</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
        Base: sessões vivas do agente. Converteu = {b.medida}. (O histórico abaixo usa outra base — os números não batem de propósito.)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        {passos.map((p, i) => (
          <div key={i}>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{p.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: p.color }}>{p.value}</div>
          </div>
        ))}
      </div>
      {!medivel && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
          Sem sessão nesse recorte pra medir conversão ainda.
        </div>
      )}
    </div>
  );
}

// Balão do histórico: taxa mês a mês. A barra é relativa ao melhor mês do próprio bloco
// (é comparação interna — "melhorou ou piorou?", não uma escala absoluta).
function BalaoHistorico({ b }: { b: HubHistoricoBloco }) {
  const topo = Math.max(1, ...b.meses.map((m) => m.taxa_pct ?? 0));
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{b.rotulo} · histórico</div>
        {b.total && (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            Desde o começo: <strong style={{ color: 'var(--color-text)' }}>{b.total.converteram} clientes de {b.total.abordados}</strong> ({pct(b.total.taxa_pct)}) ·{' '}
            <strong style={{ color: '#2C9C67' }}>{brl(b.total.receita)}</strong>
          </div>
        )}
      </div>

      {b.nao_medivel ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-muted)' }}>—</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{b.nao_medivel}</div>
        </div>
      ) : b.meses.length === 0 ? (
        <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-text-muted)' }}>Nenhuma abordagem registrada ainda.</div>
      ) : (
        <>
          <table className={styles.table} style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Mês</th><th style={{ textAlign: 'right' }}>Abordados</th>
                <th style={{ textAlign: 'right' }}>Clientes</th>
                <th style={{ textAlign: 'right' }}>Grana</th><th style={{ width: '38%' }}>Taxa</th>
              </tr>
            </thead>
            <tbody>
              {b.meses.map((m) => (
                <tr key={m.mes}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtMes(m.mes)}</td>
                  <td style={{ textAlign: 'right' }}>{m.abordados}</td>
                  <td style={{ textAlign: 'right', color: m.converteram > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>{m.converteram}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: m.receita > 0 ? '#2C9C67' : 'var(--color-text-muted)' }}>{m.receita > 0 ? brl(m.receita) : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(((m.taxa_pct ?? 0) / topo) * 100)}%`, height: '100%', background: 'var(--color-primary)' }} />
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 48, textAlign: 'right' }}>{pct(m.taxa_pct)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-muted)' }}>
            Base: {b.base}. Converteu = {b.medida}.
          </div>
        </>
      )}
    </div>
  );
}

export default function FollowupPanel({ produto }: { produto: string }) {
  const [data, setData] = useState<HubFollowup | null>(null);
  const [hist, setHist] = useState<HubHistorico | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const p = encodeURIComponent(produto);
    // Histórico em request própria: é varredura pesada e não pode segurar o funil do topo.
    api.get(`/admin/hub-followup-historico?produto=${p}`)
      .then((r) => setHist(r.data as HubHistorico)).catch(() => setHist(null));
    api.get(`/admin/hub-followup?produto=${p}`)
      .then((r) => setData(r.data as HubFollowup)).catch(() => {}).finally(() => setLoading(false));
  }, [produto]);
  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const cards = [
    { label: 'Sessões ativas', value: s?.total ?? 0, color: 'var(--color-primary)' },
    { label: 'Handoff (humano)', value: s?.handoff ?? 0, color: '#C87A1E' },
    { label: 'Opt-out / perdido', value: s?.opt_out ?? 0, color: '#B4544B' },
    { label: 'Últimas 24h', value: s?.ultimas24h ?? 0, color: 'var(--color-text)' },
    { label: 'Últimos 7d', value: s?.ultimos7d ?? 0, color: 'var(--color-text)' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      {data?.conversao
        ? data.conversao.map((b, i) => <FunilConversao key={i} b={b} />)
        : (
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>Sucesso de conversão</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-muted)' }}>—</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {loading ? 'Carregando…' : 'Este produto ainda não tem agente de followup — não há o que medir.'}
            </div>
          </div>
        )}

      {hist?.blocos?.map((b, i) => <BalaoHistorico key={i} b={b} />)}

      <div className={styles.cards}>
        {cards.map((c, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.cardLabel}>{c.label}</div>
            <div className={styles.cardValue} style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead><tr><th>Cliente</th><th>Última mensagem</th><th>Situação</th><th>Resultado</th><th style={{ textAlign: 'right' }}>Atualizado</th></tr></thead>
          <tbody>
            {(data?.sessions ?? []).length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>{loading ? 'Carregando…' : 'Nenhuma sessão do agente no período.'}</td></tr>
            )}
            {(data?.sessions ?? []).map((row, i) => (
              <tr key={i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{row.nome || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{row.phone}</div>
                </td>
                <td style={{ maxWidth: 340, color: 'var(--color-text-muted)', fontSize: 13 }}>
                  {row.last_role === 'user' ? '👤 ' : row.last_role === 'assistant' ? '🤖 ' : ''}
                  {row.last_msg || '—'}
                </td>
                <td>
                  {row.handed_off && <Badge label="handoff" color="#C87A1E" />}
                  {row.opt_out && <Badge label="opt-out" color="#B4544B" />}
                  {!row.handed_off && !row.opt_out && <Badge label="ativo" color="#2C9C67" />}
                </td>
                <td>
                  {row.converteu === true && <Badge label="converteu" color="var(--color-primary)" />}
                  {row.converteu === false && row.respondeu && <Badge label="respondeu" color="#2C9C67" />}
                  {row.converteu === false && !row.respondeu && <span style={{ color: 'var(--color-text-muted)' }}>sem resposta</span>}
                  {row.converteu === null && <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtWhen(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12.5 }}>
        Fonte: <code>/admin/hub-followup</code> (whatsapp_sessions do agente do produto, cruzado com a compra/agenda de cada
        produto pro &quot;converteu&quot;). Só leitura — não dispara nada.
      </p>
    </div>
  );
}
