'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import styles from '../admin.module.css';

interface Reuniao {
  id: string;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;
  empresa: string | null;
  regiao: string | null;
  slot_at: string;
  status: 'pending' | 'confirmed' | 'declined' | 'done';
  meet_link: string | null;
  created_at: string;
  confirmed_at: string | null;
  notify_email_ok: boolean | null;
  notify_wpp_ok: boolean | null;
}

// Formata o slot proposto em BRT (português).
function fmtBRT(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) + ' (BRT)';
}

const STATUS_LABEL: Record<string, string> = {
  pending: '⏳ Aguardando você', confirmed: '✅ Confirmada', declined: '✖ Recusada', done: '✔ Concluída',
};

export default function TrafegoPanel() {
  const [rows, setRows] = useState<Reuniao[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [meetLinks, setMeetLinks] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setErro('');
    try {
      const { data } = await api.get<{ reunioes: Reuniao[] }>('/trafego/admin/reunioes');
      setRows(data.reunioes ?? []);
    } catch {
      setErro('Erro ao carregar reuniões.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirmar(r: Reuniao) {
    const link = (meetLinks[r.id] || '').trim();
    if (!/^https?:\/\//.test(link)) {
      setMsg(m => ({ ...m, [r.id]: '⚠️ Cole o link do Meet (começando com https://)' }));
      return;
    }
    setActing(r.id); setMsg(m => ({ ...m, [r.id]: '' }));
    try {
      const { data } = await api.post('/trafego/admin/confirmar', { id: r.id, meet_link: link });
      const partes: string[] = [];
      if (data.tinha_email) partes.push(data.email_ok ? '✓ e-mail enviado' : '✗ e-mail FALHOU');
      if (data.tinha_whatsapp) partes.push(data.wpp_ok ? '✓ WhatsApp enviado' : '✗ WhatsApp FALHOU');
      if (!partes.length) partes.push('⚠️ cliente sem e-mail nem WhatsApp — avise você mesmo');
      setMsg(m => ({ ...m, [r.id]: partes.join(' · ') }));
      await load();
    } catch {
      setMsg(m => ({ ...m, [r.id]: '✗ Erro ao confirmar. Tenta de novo.' }));
    } finally { setActing(null); }
  }

  async function recusar(r: Reuniao) {
    if (!confirm('Recusar essa solicitação de reunião?')) return;
    setActing(r.id);
    try { await api.post('/trafego/admin/recusar', { id: r.id }); await load(); }
    catch { setMsg(m => ({ ...m, [r.id]: '✗ Erro ao recusar.' })); }
    finally { setActing(null); }
  }

  const all = rows ?? [];
  // pendentes primeiro (por slot), depois o resto (mais recente primeiro)
  const pendentes = all.filter(r => r.status === 'pending').sort((a, b) => a.slot_at.localeCompare(b.slot_at));
  const resto = all.filter(r => r.status !== 'pending').sort((a, b) => (b.confirmed_at || b.created_at).localeCompare(a.confirmed_at || a.created_at));

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>📈 Cria Funil — Tráfego Pago</h2>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {pendentes.length} aguardando · {all.length} no total
        </span>
        <button className="btn-secondary" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      {erro && <div style={{ padding: 16, background: 'var(--color-surface-2)', borderRadius: 10, marginBottom: 16 }}>{erro}</div>}

      {loading ? (
        <div className={styles.loading}>Carregando…</div>
      ) : all.length === 0 ? (
        <div className={styles.loading} style={{ textAlign: 'center', padding: '48px 24px' }}>
          Nenhuma solicitação de reunião ainda.
        </div>
      ) : (
        <>
          {/* PENDENTES */}
          {pendentes.map(r => (
            <div key={r.id} style={{ background: 'var(--color-surface)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 12, padding: 18, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{r.nome || '(sem nome)'} {r.empresa && <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>· {r.empresa}</span>}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {r.whatsapp ? <a href={`https://wa.me/55${String(r.whatsapp).replace(/\D/g,'').replace(/^55/,'')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>{r.whatsapp}</a> : 'sem WhatsApp'}
                    {r.email && <span> · {r.email}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#059669' }}>{fmtBRT(r.slot_at)}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{STATUS_LABEL[r.status]}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  placeholder="Cole o link do Google Meet aqui"
                  value={meetLinks[r.id] || ''}
                  onChange={e => setMeetLinks(m => ({ ...m, [r.id]: e.target.value }))}
                  style={{ flex: '1 1 240px', minWidth: 200, padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontFamily: 'inherit' }}
                />
                <button onClick={() => confirmar(r)} disabled={acting === r.id}
                  style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#10b981', color: '#053826', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {acting === r.id ? '…' : '✓ Confirmar e avisar'}
                </button>
                <button onClick={() => recusar(r)} disabled={acting === r.id}
                  style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Recusar
                </button>
              </div>
              {msg[r.id] && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: msg[r.id].includes('✗') || msg[r.id].includes('⚠️') ? 'var(--ink-red)' : 'var(--ink-green)' }}>{msg[r.id]}</div>}
            </div>
          ))}

          {/* HISTÓRICO */}
          {resto.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '24px 0 10px' }}>Histórico</h3>
              {resto.map(r => (
                <div key={r.id} style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 13.5 }}>
                    <strong>{r.nome || '(sem nome)'}</strong> · {fmtBRT(r.slot_at)}
                    {r.status === 'confirmed' && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {r.notify_email_ok ? '✓📧' : (r.email ? '✗📧' : '—')} {r.notify_wpp_ok ? '✓📱' : (r.whatsapp ? '✗📱' : '—')}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: r.status === 'confirmed' ? 'var(--ink-green)' : 'var(--color-text-muted)' }}>{STATUS_LABEL[r.status]}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
