'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import './sugestoes.css';

interface Sugestao {
  id: string;
  titulo: string;
  descricao: string;
  status: 'recebido' | 'aprovada' | 'em_desenvolvimento' | 'publicada' | 'rejeitada';
  votos_count: number;
  comentarios_count: number;
  created_at: string;
  autor_email: string | null;
  voted: boolean;
}

interface Comentario {
  id: string;
  texto: string;
  created_at: string;
  autor_email: string | null;
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  aprovada:           { label: '✓ Aprovada',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  em_desenvolvimento: { label: '🔨 Em construção', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  publicada:          { label: '🚀 Publicada',     color: '#1D9E75', bg: 'rgba(29,158,117,0.15)' },
};

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function autorLabel(email: string | null) {
  if (!email) return 'anônimo';
  return email.split('@')[0];
}

export default function SugestoesPage() {
  const { user } = useDashboard();
  const isVip = user?.plano === 'ilimitado' || (user as any)?.is_admin;

  const [feed, setFeed] = useState<Sugestao[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Comentario[]>([]);
  const [novoComentario, setNovoComentario] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);

  const loadFeed = useCallback(async () => {
    try {
      const r = await api.get('/suggestions/feed');
      setFeed(r.data.suggestions || []);
    } catch {
      setFeed([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  async function enviarIdeia(e: React.FormEvent) {
    e.preventDefault();
    if (titulo.trim().length < 3 || descricao.trim().length < 10) return;
    setEnviando(true);
    try {
      await api.post('/suggestions', { titulo: titulo.trim(), descricao: descricao.trim() });
      setTitulo(''); setDescricao(''); setShowForm(false);
      alert('Sua ideia foi enviada! Vai passar por aprovação do admin antes de aparecer no fórum.');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao enviar');
    } finally {
      setEnviando(false);
    }
  }

  async function votar(s: Sugestao) {
    if (!isVip) {
      alert('Votar é exclusivo do plano VIP. Faça upgrade pra participar!');
      return;
    }
    // otimista
    setFeed(prev => prev.map(x => x.id === s.id ? {
      ...x,
      voted: !x.voted,
      votos_count: x.voted ? x.votos_count - 1 : x.votos_count + 1,
    } : x));
    try {
      const r = await api.post(`/suggestions/${s.id}/vote`);
      setFeed(prev => prev.map(x => x.id === s.id ? { ...x, voted: r.data.voted, votos_count: r.data.votos_count } : x));
    } catch {
      // rollback
      setFeed(prev => prev.map(x => x.id === s.id ? s : x));
    }
  }

  async function abrirComentarios(id: string) {
    if (openComments === id) {
      setOpenComments(null);
      return;
    }
    setOpenComments(id);
    setLoadingComments(true);
    try {
      const r = await api.get(`/suggestions/${id}/comments`);
      setComments(r.data.comments || []);
    } catch {
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  }

  async function comentar(suggestionId: string) {
    if (!isVip) {
      alert('Comentar é exclusivo do plano VIP.');
      return;
    }
    if (novoComentario.trim().length < 3) return;
    try {
      const r = await api.post(`/suggestions/${suggestionId}/comment`, { texto: novoComentario.trim() });
      const novo: Comentario = {
        id: r.data.comment.id,
        texto: r.data.comment.texto,
        created_at: r.data.comment.created_at,
        autor_email: user?.email || null,
      };
      setComments(prev => [...prev, novo]);
      setFeed(prev => prev.map(x => x.id === suggestionId ? { ...x, comentarios_count: x.comentarios_count + 1 } : x));
      setNovoComentario('');
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao comentar');
    }
  }

  return (
    <div className="sug-wrap">
      <header className="sug-hero">
        <h1>💡 Fórum de Sugestões</h1>
        <p>Ideias que melhoram a SolarDoc — votadas e debatidas pela comunidade VIP.</p>
        {isVip && (
          <button className="sug-btn-primary" onClick={() => setShowForm(s => !s)}>
            {showForm ? '× Fechar' : '✨ Mandar nova ideia'}
          </button>
        )}
        {!isVip && (
          <p className="sug-vip-cta">
            <a href="/conta/sugestoes">★ Liberar fórum com VIP</a>
          </p>
        )}
      </header>

      {showForm && isVip && (
        <form className="sug-form" onSubmit={enviarIdeia}>
          <input
            type="text"
            placeholder="Título da ideia (ex: Adicionar suporte a múltiplos UCs no contrato)"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            required
            minLength={3}
          />
          <textarea
            placeholder="Descreva o que você quer e por quê. Quanto mais detalhe, mais chance de ser implementada."
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            required
            minLength={10}
            rows={5}
          />
          <button type="submit" disabled={enviando} className="sug-btn-primary">
            {enviando ? 'Enviando...' : 'Enviar pra aprovação'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="sug-empty">Carregando...</p>
      ) : feed.length === 0 ? (
        <div className="sug-empty">
          <p>Nenhuma ideia aprovada ainda. {isVip ? 'Seja o primeiro a mandar a sua!' : 'Volte em breve.'}</p>
        </div>
      ) : (
        <ul className="sug-feed">
          {feed.map(s => (
            <li key={s.id} className="sug-item">
              <div className="sug-item-vote">
                <button
                  className={`sug-vote-btn ${s.voted ? 'voted' : ''}`}
                  onClick={() => votar(s)}
                  title={s.voted ? 'Remover voto' : 'Votar'}
                >
                  ▲
                </button>
                <span className="sug-vote-count">{s.votos_count}</span>
              </div>
              <div className="sug-item-body">
                <div className="sug-item-head">
                  <h3>{s.titulo}</h3>
                  {STATUS_LABEL[s.status] && (
                    <span
                      className="sug-status"
                      style={{ color: STATUS_LABEL[s.status].color, background: STATUS_LABEL[s.status].bg }}
                    >
                      {STATUS_LABEL[s.status].label}
                    </span>
                  )}
                </div>
                <p className="sug-item-desc">{s.descricao}</p>
                <div className="sug-item-meta">
                  <span>por {autorLabel(s.autor_email)}</span>
                  <span>·</span>
                  <span>{fmtData(s.created_at)}</span>
                  <span>·</span>
                  <button className="sug-comments-toggle" onClick={() => abrirComentarios(s.id)}>
                    💬 {s.comentarios_count} {s.comentarios_count === 1 ? 'comentário' : 'comentários'}
                  </button>
                </div>

                {openComments === s.id && (
                  <div className="sug-comments-block">
                    {loadingComments ? (
                      <p className="sug-empty-small">Carregando comentários...</p>
                    ) : comments.length === 0 ? (
                      <p className="sug-empty-small">Nenhum comentário ainda. {isVip && 'Seja o primeiro!'}</p>
                    ) : (
                      <ul className="sug-comments-list">
                        {comments.map(c => (
                          <li key={c.id}>
                            <strong>{autorLabel(c.autor_email)}</strong>
                            <span className="sug-comment-date">{fmtData(c.created_at)}</span>
                            <p>{c.texto}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {isVip && (
                      <div className="sug-comment-form">
                        <input
                          type="text"
                          placeholder="Comentar..."
                          value={novoComentario}
                          onChange={e => setNovoComentario(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') comentar(s.id); }}
                        />
                        <button onClick={() => comentar(s.id)} disabled={novoComentario.trim().length < 3}>
                          Enviar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
