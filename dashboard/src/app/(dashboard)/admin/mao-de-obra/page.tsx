'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import '../../mao-de-obra/mao-de-obra.css';

interface Regiao { cidade: string; estado: string; }

interface Prestador {
  id: string;
  user_id: string;
  autor_email: string | null;
  nome_empresa: string | null;
  responsavel: string;
  whatsapp: string;
  anos_experiencia: number | null;
  time_size: number | null;
  especialidade: string | null;
  capacidade_kwp_mes: number | null;
  observacoes: string | null;
  ativo: boolean;
  status: 'pendente' | 'aprovado' | 'suspenso';
  created_at: string;
  regioes: Regiao[];
}

const STATUS_OPCOES = [
  { v: 'pendente', l: '⏳ Pendente', color: '#f59e0b' },
  { v: 'aprovado', l: '✓ Aprovado', color: '#22c55e' },
  { v: 'suspenso', l: '⏸ Suspenso', color: '#ef4444' },
];

const ESPECIALIDADE_LABEL: Record<string, string> = {
  instalacao_solar: 'Instalação Solar',
  manutencao: 'Manutenção',
  ambos: 'Instalação + Manutenção',
};

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function AdminMaoDeObraPage() {
  const [items, setItems] = useState<Prestador[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<string>('all');

  const loadAll = useCallback(async () => {
    try {
      const r = await api.get('/prestadores/admin/all');
      setItems(r.data.prestadores || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function mudarStatus(id: string, status: string) {
    setItems(prev => prev.map(x => x.id === id ? { ...x, status: status as any } : x));
    try {
      await api.patch(`/prestadores/admin/${id}/status`, { status });
    } catch {
      loadAll();
    }
  }

  const filtrados = filtro === 'all' ? items : items.filter(x => x.status === filtro);
  const counts = STATUS_OPCOES.reduce((acc, opt) => {
    acc[opt.v] = items.filter(x => x.status === opt.v).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="mob-wrap" style={{ maxWidth: 920 }}>
      <header className="mob-hero" style={{ marginBottom: 16 }}>
        <h1>⚙️ Moderação de Prestadores</h1>
        <p>Aprove, suspenda ou revise cadastros da rede de mão de obra.</p>
      </header>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, justifyContent: 'center' }}>
        <button onClick={() => setFiltro('all')} style={btnStyle(filtro === 'all')}>
          Todos ({items.length})
        </button>
        {STATUS_OPCOES.map(o => (
          <button key={o.v} onClick={() => setFiltro(o.v)} style={btnStyle(filtro === o.v, o.color)}>
            {o.l} ({counts[o.v] || 0})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mob-loading">Carregando...</p>
      ) : filtrados.length === 0 ? (
        <p className="mob-loading">Nada nesse filtro.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtrados.map(p => {
            const s = STATUS_OPCOES.find(o => o.v === p.status);
            return (
              <li key={p.id} style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
                      {p.nome_empresa || p.responsavel}
                    </h3>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {p.responsavel} · {p.whatsapp} · {p.autor_email?.split('@')[0]} · {fmtData(p.created_at)}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
                    color: s?.color, background: `${s?.color}1f`,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {s?.l}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--color-text)', marginBottom: 8, flexWrap: 'wrap' }}>
                  {p.especialidade && <span><strong>Especialidade:</strong> {ESPECIALIDADE_LABEL[p.especialidade] || p.especialidade}</span>}
                  {p.time_size != null && <span><strong>Time:</strong> {p.time_size} pessoas</span>}
                  {p.anos_experiencia != null && <span><strong>Experiência:</strong> {p.anos_experiencia} anos</span>}
                  {p.capacidade_kwp_mes != null && <span><strong>Capacidade:</strong> {p.capacidade_kwp_mes} kWp/mês</span>}
                </div>

                {p.regioes.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                    {p.regioes.map((r, i) => (
                      <span key={i} style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 999,
                        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                      }}>
                        📍 {r.cidade}/{r.estado}
                      </span>
                    ))}
                  </div>
                )}

                {p.observacoes && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 8px', fontStyle: 'italic' }}>
                    "{p.observacoes}"
                  </p>
                )}

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {STATUS_OPCOES.filter(o => o.v !== p.status).map(o => (
                    <button key={o.v}
                      onClick={() => mudarStatus(p.id, o.v)}
                      style={{
                        padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                        background: 'transparent', color: o.color,
                        border: `1px solid ${o.color}66`, cursor: 'pointer',
                      }}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function btnStyle(active: boolean, color = '#6E56CF'): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    background: active ? `${color}1f` : 'transparent',
    color: active ? color : 'var(--color-text-muted)',
    border: `1px solid ${active ? color : 'var(--color-border)'}`,
    cursor: 'pointer',
  };
}
