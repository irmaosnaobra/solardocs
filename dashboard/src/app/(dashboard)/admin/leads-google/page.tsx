'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';

interface Lead {
  id: string;
  search_id: string;
  place_id: string;
  nome: string | null;
  telefone: string | null;
  telefone_internacional: string | null;
  endereco: string | null;
  website: string | null;
  rating: number | null;
  reviews_count: number | null;
  types: string[] | null;
  latitude: number | null;
  longitude: number | null;
}

interface SearchRow {
  id: string;
  criado_em: string;
  query: string;
  total_resultados: number;
  com_telefone: number;
  status: string;
}

function digits(p: string | null | undefined): string {
  return (p || '').replace(/\D/g, '');
}

export default function LeadsGooglePage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [maxPages, setMaxPages] = useState(3);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [searchAtual, setSearchAtual] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>({});
  const [somenteComTelefone, setSomenteComTelefone] = useState(true);

  const loadSearches = useCallback(async () => {
    try {
      const r = await api.get('/admin/leads/google/searches?limit=30');
      setSearches(r.data?.searches ?? []);
    } catch {
      setSearches([]);
    }
  }, []);

  const loadLeadsDe = useCallback(async (searchId: string) => {
    setSearchAtual(searchId);
    try {
      const r = await api.get(`/admin/leads/google/searches/${searchId}`);
      const list: Lead[] = r.data?.leads ?? [];
      setLeads(list);
      const sel: Record<string, boolean> = {};
      list.forEach(l => { sel[l.id] = !!l.telefone; });
      setSelecionados(sel);
    } catch {
      setLeads([]);
    }
  }, []);

  useEffect(() => { loadSearches(); }, [loadSearches]);

  async function buscar() {
    if (!query.trim()) return;
    setBuscando(true);
    setErro(null);
    try {
      const r = await api.post('/admin/leads/google/search', { query: query.trim(), max_pages: maxPages });
      const list: Lead[] = r.data?.leads ?? [];
      setSearchAtual(r.data?.search_id ?? null);
      setLeads(list);
      const sel: Record<string, boolean> = {};
      list.forEach(l => { sel[l.id] = !!l.telefone; });
      setSelecionados(sel);
      loadSearches();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { error?: string; detail?: string; body?: unknown } } })?.response?.data;
      setErro(detail?.error || (e instanceof Error ? e.message : 'Erro na busca'));
    } finally {
      setBuscando(false);
    }
  }

  async function deletarBusca(id: string) {
    if (!confirm('Apagar essa busca e todos os leads?')) return;
    try {
      await api.delete(`/admin/leads/google/searches/${id}`);
      if (searchAtual === id) { setSearchAtual(null); setLeads([]); }
      loadSearches();
    } catch {/* ignore */}
  }

  const visiveis = useMemo(() => {
    return somenteComTelefone ? leads.filter(l => l.telefone) : leads;
  }, [leads, somenteComTelefone]);

  function toggleTodos() {
    const todosSelecionados = visiveis.every(l => selecionados[l.id]);
    const novo: Record<string, boolean> = { ...selecionados };
    visiveis.forEach(l => { novo[l.id] = !todosSelecionados; });
    setSelecionados(novo);
  }

  function enviarParaDisparos() {
    const fones = leads
      .filter(l => selecionados[l.id])
      .map(l => digits(l.telefone))
      .filter(Boolean);
    if (fones.length === 0) { alert('Selecione pelo menos 1 lead com telefone'); return; }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('disparos_telefones_prefill', fones.join('\n'));
    }
    router.push('/admin/disparos');
  }

  const totalSelecionados = useMemo(
    () => leads.filter(l => selecionados[l.id]).length,
    [leads, selecionados],
  );

  // ── estilos inline (mesmo padrao do /admin/disparos) ─────────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6, display: 'block' };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 10,
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    fontSize: 14,
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  };
  const btnPrimary: React.CSSProperties = {
    background: 'var(--color-primary, #F59E0B)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 18px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 14,
  };
  const btnGhost: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    padding: '8px 14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontSize: 13,
  };

  return (
    <div style={{ maxWidth: 1100, padding: '0 16px 32px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Extrator de leads (Google)</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 4 }}>
          Busca estabelecimentos no Google Maps por palavra-chave. Telefones recuperados podem ser enviados direto pra /admin/disparos.
        </p>
      </header>

      {/* Busca */}
      <div style={cardStyle}>
        <label style={labelStyle}>Termo de busca</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input
            type="text"
            style={{ ...inputStyle, flex: '1 1 280px' }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Ex: padaria uberlandia, oficina mecanica goiania, etc'
            onKeyDown={e => { if (e.key === 'Enter' && !buscando) buscar(); }}
            disabled={buscando}
          />
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Páginas (20/pág)</label>
            <select
              value={maxPages}
              onChange={e => setMaxPages(Number(e.target.value))}
              style={{ ...inputStyle, width: 100 }}
              disabled={buscando}
            >
              <option value={1}>1 (até 20)</option>
              <option value={2}>2 (até 40)</option>
              <option value={3}>3 (até 60)</option>
            </select>
          </div>
          <button style={btnPrimary} onClick={buscar} disabled={buscando || !query.trim()}>
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        {erro && (
          <p style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>
            {erro}
          </p>
        )}
        <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12 }}>
          Custo aproximado: ~R$0,15 por lead com telefone. Nem todo estabelecimento tem telefone público.
        </p>
      </div>

      {/* Resultados */}
      {leads.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div>
              <strong>{visiveis.length}</strong> de {leads.length} leads
              {' · '}
              <strong>{totalSelecionados}</strong> selecionados
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={somenteComTelefone} onChange={e => setSomenteComTelefone(e.target.checked)} />
                só com telefone
              </label>
              <button style={btnGhost} onClick={toggleTodos}>
                {visiveis.every(l => selecionados[l.id]) ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
              <button style={btnPrimary} onClick={enviarParaDisparos} disabled={totalSelecionados === 0}>
                Enviar {totalSelecionados} pra /disparos →
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                  <th style={{ padding: 8, width: 30 }}></th>
                  <th style={{ padding: 8 }}>Nome</th>
                  <th style={{ padding: 8 }}>Telefone</th>
                  <th style={{ padding: 8 }}>Endereço</th>
                  <th style={{ padding: 8 }}>Rating</th>
                  <th style={{ padding: 8 }}>Site</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px dashed var(--color-border)' }}>
                    <td style={{ padding: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!selecionados[l.id]}
                        onChange={() => setSelecionados(prev => ({ ...prev, [l.id]: !prev[l.id] }))}
                        disabled={!l.telefone}
                      />
                    </td>
                    <td style={{ padding: 8, fontWeight: 600 }}>{l.nome || '—'}</td>
                    <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                      {l.telefone ? l.telefone : <span style={{ color: 'var(--color-text-muted)' }}>sem telefone</span>}
                    </td>
                    <td style={{ padding: 8, color: 'var(--color-text-muted)', fontSize: 12, maxWidth: 280 }}>
                      {l.endereco || '—'}
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                      {l.rating != null ? `★ ${l.rating.toFixed(1)} (${l.reviews_count ?? 0})` : '—'}
                    </td>
                    <td style={{ padding: 8 }}>
                      {l.website ? (
                        <a href={l.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary, #F59E0B)' }}>
                          abrir
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Histórico de buscas */}
      <div style={cardStyle}>
        <label style={labelStyle}>Buscas anteriores ({searches.length})</label>
        {searches.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>Nenhuma busca ainda.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searches.map(s => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 10,
                  border: `1px solid ${searchAtual === s.id ? 'var(--color-primary, #F59E0B)' : 'var(--color-border)'}`,
                  borderRadius: 8,
                  background: searchAtual === s.id ? 'rgba(245,158,11,0.06)' : 'transparent',
                }}
              >
                <button
                  onClick={() => loadLeadsDe(s.id)}
                  style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.query}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {new Date(s.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{s.total_resultados} leads · {s.com_telefone} com telefone
                  </div>
                </button>
                <button onClick={() => deletarBusca(s.id)} style={{ ...btnGhost, color: '#dc2626', padding: '4px 10px' }}>
                  apagar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
