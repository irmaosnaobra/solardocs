'use client';

import { useState, useEffect } from 'react';
import api from '@/services/api';

interface Lead {
  phone: string;
  nome: string | null;
  cidade: string | null;
  estado: string | null;
  temperatura: 'frio' | 'morno' | 'quente';
  ultima_mensagem: string | null;
  total_mensagens: number;
  created_at: string;
  updated_at: string;
}

const TEMP_CONFIG = {
  frio:   { label: 'Frio',   emoji: '🔵', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)' },
  morno:  { label: 'Morno',  emoji: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)' },
  quente: { label: 'Quente', emoji: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.3)' },
};

export default function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filtro, setFiltro] = useState<string>('todos');
  const [loading, setLoading] = useState(true);

  async function fetchLeads() {
    setLoading(true);
    try {
      const params = filtro !== 'todos' ? `?temperatura=${filtro}` : '';
      const { data } = await api.get(`/admin/sdr-leads${params}`);
      setLeads(data.leads);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { fetchLeads(); }, [filtro]);

  async function mudarTemp(phone: string, temperatura: string) {
    await api.patch(`/admin/sdr-leads/${phone}/temperatura`, { temperatura });
    fetchLeads();
  }

  const contagem = {
    todos: leads.length,
    frio: leads.filter(l => l.temperatura === 'frio').length,
    morno: leads.filter(l => l.temperatura === 'morno').length,
    quente: leads.filter(l => l.temperatura === 'quente').length,
  };

  function fmtPhone(p: string) {
    const d = p.replace(/\D/g, '');
    if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
    return p;
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  const leadsExibidos = filtro === 'todos' ? leads : leads.filter(l => l.temperatura === filtro);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--color-text)', margin: '0 0 4px' }}>
          📋 CRM — Leads SDR
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Leads qualificados pelo agente via WhatsApp</p>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {(['todos', 'quente', 'morno', 'frio'] as const).map(f => {
          const cfg = f === 'todos' ? null : TEMP_CONFIG[f];
          const count = contagem[f];
          const active = filtro === f;
          return (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                border: `1px solid ${active ? (cfg?.border ?? 'var(--color-primary)') : 'var(--color-border)'}`,
                background: active ? (cfg?.bg ?? 'rgba(99,179,237,0.1)') : 'transparent',
                color: active ? (cfg?.color ?? 'var(--color-primary)') : 'var(--color-text-muted)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {f === 'todos' ? '📋 Todos' : `${cfg!.emoji} ${cfg!.label}`}
              <span style={{ marginLeft: 6, opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
        <button onClick={fetchLeads} style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 999, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
          🔄 Atualizar
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 40 }}>Carregando...</p>
      ) : leadsExibidos.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 40 }}>Nenhum lead ainda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {leadsExibidos.map(lead => {
            const cfg = TEMP_CONFIG[lead.temperatura];
            return (
              <div key={lead.phone} style={{
                background: 'var(--color-surface)',
                border: `1px solid var(--color-border)`,
                borderLeft: `3px solid ${cfg.color}`,
                borderRadius: 14,
                padding: '16px 20px',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                alignItems: 'start',
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text)' }}>
                      {lead.nome || 'Sem nome'}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 999,
                      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
                      textTransform: 'uppercase', letterSpacing: 1,
                    }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8, flexWrap: 'wrap' }}>
                    <span>📱 {fmtPhone(lead.phone)}</span>
                    {lead.cidade && <span>📍 {lead.cidade}{lead.estado ? ` - ${lead.estado}` : ''}</span>}
                    <span>💬 {lead.total_mensagens} msg{lead.total_mensagens !== 1 ? 's' : ''}</span>
                    <span>🕐 {fmtDate(lead.updated_at)}</span>
                  </div>
                  {lead.ultima_mensagem && (
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>
                      "{lead.ultima_mensagem.slice(0, 120)}{lead.ultima_mensagem.length > 120 ? '...' : ''}"
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 110 }}>
                  <a
                    href={`https://wa.me/${lead.phone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ padding: '7px 12px', borderRadius: 8, background: '#25d366', color: '#fff', fontWeight: 700, fontSize: 12, textAlign: 'center', textDecoration: 'none' }}
                  >
                    💬 Abrir WA
                  </a>
                  <select
                    value={lead.temperatura}
                    onChange={e => mudarTemp(lead.phone, e.target.value)}
                    style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${cfg.border}`, background: cfg.bg, color: cfg.color, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                  >
                    <option value="frio">🔵 Frio</option>
                    <option value="morno">🟡 Morno</option>
                    <option value="quente">🔴 Quente</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
