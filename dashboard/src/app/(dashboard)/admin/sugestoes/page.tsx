'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import '../../sugestoes/sugestoes.css';

interface Sugestao {
  id: string;
  titulo: string;
  descricao: string;
  status: string;
  votos_count: number;
  comentarios_count: number;
  created_at: string;
  autor_email: string | null;
}

const STATUS_OPCOES = [
  { v: 'recebido',           l: 'Recebido',          color: '#94a3b8' },
  { v: 'aprovada',           l: '✓ Aprovar',         color: '#22c55e' },
  { v: 'em_desenvolvimento', l: '🔨 Em construção',  color: '#f59e0b' },
  { v: 'publicada',          l: '🚀 Publicada',      color: '#1D9E75' },
  { v: 'rejeitada',          l: '× Rejeitar',        color: '#ef4444' },
];

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminSugestoesPage() {
  const [items, setItems] = useState<Sugestao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<string>('all');

  const loadAll = useCallback(async () => {
    try {
      const r = await api.get('/suggestions/admin/all');
      setItems(r.data.suggestions || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function mudarStatus(id: string, status: string) {
    // otimista
    setItems(prev => prev.map(x => x.id === id ? { ...x, status } : x));
    try {
      await api.patch(`/suggestions/admin/${id}/status`, { status });
    } catch {
      loadAll(); // rollback via reload
    }
  }

  const filtrados = filtro === 'all' ? items : items.filter(x => x.status === filtro);
  const counts = STATUS_OPCOES.reduce((acc, opt) => {
    acc[opt.v] = items.filter(x => x.status === opt.v).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="sug-wrap" style={{ maxWidth: 920 }}>
      <header className="sug-hero" style={{ marginBottom: 16 }}>
        <h1>⚙️ Moderação de Sugestões</h1>
        <p>Aprove, rejeite ou mova ideias do estágio.</p>
      </header>

      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16,
        justifyContent: 'center',
      }}>
        <button onClick={() => setFiltro('all')}
          style={btnStyle(filtro === 'all')}>
          Todas ({items.length})
        </button>
        {STATUS_OPCOES.map(o => (
          <button key={o.v} onClick={() => setFiltro(o.v)}
            style={btnStyle(filtro === o.v, o.color)}>
            {o.l} ({counts[o.v] || 0})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="sug-empty">Carregando...</p>
      ) : filtrados.length === 0 ? (
        <p className="sug-empty">Nada nesse status.</p>
      ) : (
        <ul className="sug-feed">
          {filtrados.map(s => {
            const statusInfo = STATUS_OPCOES.find(o => o.v === s.status);
            return (
              <li key={s.id} className="sug-item">
                <div className="sug-item-vote">
                  <span style={{ fontSize: 16 }}>▲</span>
                  <span className="sug-vote-count">{s.votos_count}</span>
                </div>
                <div className="sug-item-body">
                  <div className="sug-item-head">
                    <h3>{s.titulo}</h3>
                    <span className="sug-status" style={{
                      color: statusInfo?.color || '#94a3b8',
                      background: `${statusInfo?.color || '#94a3b8'}1f`,
                    }}>
                      {statusInfo?.l || s.status}
                    </span>
                  </div>
                  <p className="sug-item-desc">{s.descricao}</p>
                  <div className="sug-item-meta">
                    <span>por {s.autor_email?.split('@')[0] || 'anônimo'}</span>
                    <span>·</span>
                    <span>{fmtData(s.created_at)}</span>
                    <span>·</span>
                    <span>💬 {s.comentarios_count}</span>
                  </div>

                  {/* Botões de moderação */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {STATUS_OPCOES.filter(o => o.v !== s.status).map(o => (
                      <button key={o.v}
                        onClick={() => mudarStatus(s.id, o.v)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          background: 'transparent',
                          color: o.color,
                          border: `1px solid ${o.color}66`,
                          cursor: 'pointer',
                        }}>
                        {o.l}
                      </button>
                    ))}
                  </div>
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
