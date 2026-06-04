'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  tipo?: string;
  uf?: string | null;
  categoria?: string | null;
  municipios_total?: number;
  municipios_processados?: number;
  requests_feitos?: number;
}

interface ScanProgress {
  status: string;
  municipios_total: number;
  municipios_processados: number;
  requests_feitos: number;
  total_resultados: number;
  com_telefone: number;
}

const UFS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// Custo estimado por request à Google Places (≈ R$0,18). É só um indicador —
// rótulo "estimado" no rodapé. A salvaguarda real de gasto é o botão Parar.
const CUSTO_POR_REQUEST = 0.18;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function digits(p: string | null | undefined): string {
  return (p || '').replace(/\D/g, '');
}

// Detecta se o número (no formato bruto vindo da Google: "(34) 99990-0094" ou
// "(34) 3212-5320") é um celular brasileiro. Fixo não tem WhatsApp, então o
// disparo via Z-API vai falhar em 100% dos casos.
function isCelularBR(rawPhone: string | null | undefined): boolean {
  const d = digits(rawPhone);
  if (!d) return false;
  // Sem prefixo de país: 11 dígitos com 3º dígito = 9 (formato moderno)
  if (d.length === 11 && d[2] === '9') return true;
  // 10 dígitos: pré-2012, 3º dígito = 6/7/8/9
  if (d.length === 10 && '6789'.includes(d[2])) return true;
  // Com 55: 13 dígitos com 5º dígito = 9
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') return true;
  return false;
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
  const [somenteCelular, setSomenteCelular] = useState(true);

  // ── Varredura por estado (job resumível dirigido pela aba) ──────────────
  const [scanUf, setScanUf] = useState('GO');
  const [scanCategoria, setScanCategoria] = useState('');
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null); // 'rodando'|'concluido'|'parado'|'erro'
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanErro, setScanErro] = useState<string | null>(null);
  const loopAtivoRef = useRef(false);

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
      list.forEach(l => { sel[l.id] = somenteCelular ? isCelularBR(l.telefone) : !!l.telefone; });
      setSelecionados(sel);
    } catch {
      setLeads([]);
    }
  }, [somenteCelular]);

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  // Loop de driving: a aba aberta chama /tick em sequência até done/erro.
  // Cada tick processa uma fatia de municípios no servidor. Interrompível via
  // loopAtivoRef (botão Parar / desmontagem).
  const driveLoop = useCallback(async (id: string) => {
    loopAtivoRef.current = true;
    setScanStatus('rodando');
    while (loopAtivoRef.current) {
      let data: (ScanProgress & { claimed?: boolean; done?: boolean; retry?: boolean }) | null = null;
      try {
        const r = await api.post(`/admin/leads/google/scan/${id}/tick`);
        data = r.data;
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { error?: string } } })?.response?.data;
        setScanErro(detail?.error || 'Erro no tick — tentando de novo');
        await sleep(3000);
        continue; // blip de rede: tenta de novo (servidor é idempotente)
      }
      if (!data) { await sleep(1500); continue; }

      // Outra aba segurando o lock → backoff curto e tenta de novo.
      if (data.claimed === false && data.status === 'rodando') { await sleep(1500); continue; }
      // Blip do IBGE no servidor → retry sem avançar.
      if (data.retry) { await sleep(2000); continue; }

      if (typeof data.municipios_total === 'number') {
        setScanProgress({
          status: data.status,
          municipios_total: data.municipios_total,
          municipios_processados: data.municipios_processados,
          requests_feitos: data.requests_feitos ?? 0,
          total_resultados: data.total_resultados ?? 0,
          com_telefone: data.com_telefone ?? 0,
        });
      }
      if (data.status) setScanStatus(data.status);

      if (data.done || data.status !== 'rodando') {
        loopAtivoRef.current = false;
        await loadLeadsDe(id);
        loadSearches();
        break;
      }
    }
  }, [loadLeadsDe, loadSearches]);

  async function iniciarVarredura() {
    const cat = scanCategoria.trim();
    if (!cat) { setScanErro('Digite a categoria'); return; }
    setScanErro(null);
    setScanProgress(null);
    try {
      const r = await api.post('/admin/leads/google/scan/start', { uf: scanUf, categoria: cat });
      const id: string = r.data?.search_id;
      const total: number = r.data?.municipios_total ?? 0;
      setScanId(id);
      setScanProgress({ status: 'rodando', municipios_total: total, municipios_processados: 0, requests_feitos: 0, total_resultados: 0, com_telefone: 0 });
      driveLoop(id);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { error?: string } } })?.response?.data;
      setScanErro(detail?.error || 'Erro iniciando varredura');
    }
  }

  async function pararVarredura() {
    loopAtivoRef.current = false;
    setScanStatus('parado');
    if (scanId) { try { await api.post(`/admin/leads/google/scan/${scanId}/cancel`); } catch {/* ignore */} }
  }

  // Retoma uma varredura 'parado'/'erro'/'rodando' (aba fechada): re-arma no
  // servidor (limpa cancelar/lock) e continua o loop do cursor atual.
  async function retomarVarredura(id: string) {
    setScanId(id);
    setScanErro(null);
    try {
      const r = await api.post(`/admin/leads/google/scan/${id}/resume`);
      const d = r.data ?? {};
      setScanProgress({
        status: 'rodando',
        municipios_total: d.municipios_total ?? 0,
        municipios_processados: d.municipios_processados ?? 0,
        requests_feitos: d.requests_feitos ?? 0,
        total_resultados: d.total_resultados ?? 0,
        com_telefone: d.com_telefone ?? 0,
      });
      driveLoop(id);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { error?: string } } })?.response?.data;
      setScanErro(detail?.error || 'Não foi possível retomar');
    }
  }

  useEffect(() => { loadSearches(); }, [loadSearches]);

  // Para o loop se o componente desmontar (não deixar fetch órfão rodando).
  useEffect(() => () => { loopAtivoRef.current = false; }, []);

  async function buscar() {
    if (!query.trim()) return;
    setBuscando(true);
    setErro(null);
    try {
      const r = await api.post('/admin/leads/google/search', { query: query.trim(), max_pages: maxPages });
      const list: Lead[] = r.data?.leads ?? [];
      setSearchAtual(r.data?.search_id ?? null);
      setLeads(list);
      // Default selecionado: só os celulares (se o filtro tá ON)
      const sel: Record<string, boolean> = {};
      list.forEach(l => {
        sel[l.id] = somenteCelular ? isCelularBR(l.telefone) : !!l.telefone;
      });
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
    if (somenteCelular) return leads.filter(l => isCelularBR(l.telefone));
    return leads.filter(l => l.telefone);
  }, [leads, somenteCelular]);

  const totaisDebug = useMemo(() => {
    const comTelefone = leads.filter(l => l.telefone).length;
    const celulares = leads.filter(l => isCelularBR(l.telefone)).length;
    return { total: leads.length, comTelefone, celulares };
  }, [leads]);

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

      {/* ── Varredura por estado (varre cidade por cidade da UF) ───────────── */}
      <div style={cardStyle}>
        <label style={{ ...labelStyle, fontSize: 15 }}>🗺️ Varredura por estado</label>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '0 0 12px' }}>
          Varre TODAS as cidades da UF (lista do IBGE) rodando “{scanCategoria.trim() || 'categoria'} cidade {scanUf}” em cada uma.
          Junta tudo numa busca só, sem repetir. Pode levar minutos — deixe a aba aberta.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ ...labelStyle, marginBottom: 4 }}>Estado</label>
            <select
              value={scanUf}
              onChange={e => setScanUf(e.target.value)}
              style={{ ...inputStyle, width: 90 }}
              disabled={scanStatus === 'rodando'}
            >
              {UFS_BR.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <input
            type="text"
            style={{ ...inputStyle, flex: '1 1 240px' }}
            value={scanCategoria}
            onChange={e => setScanCategoria(e.target.value)}
            placeholder="Categoria — ex: oficina mecânica, padaria, clínica"
            onKeyDown={e => { if (e.key === 'Enter' && scanStatus !== 'rodando') iniciarVarredura(); }}
            disabled={scanStatus === 'rodando'}
          />
          {scanStatus === 'rodando' ? (
            <button style={{ ...btnPrimary, background: '#dc2626' }} onClick={pararVarredura}>
              ■ Parar
            </button>
          ) : (
            <button style={btnPrimary} onClick={iniciarVarredura} disabled={!scanCategoria.trim()}>
              Iniciar varredura
            </button>
          )}
        </div>

        {/* Progresso ao vivo */}
        {scanProgress && (
          <div style={{ marginTop: 14 }}>
            <div style={{ height: 8, background: 'var(--color-border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${scanProgress.municipios_total ? Math.round(100 * scanProgress.municipios_processados / scanProgress.municipios_total) : 0}%`,
                background: scanStatus === 'erro' ? '#dc2626' : 'var(--color-primary, #F59E0B)',
                transition: 'width .3s',
              }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 13, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>
                <strong>{scanProgress.municipios_processados}</strong> / {scanProgress.municipios_total} cidades
                {scanStatus === 'rodando' && <span style={{ color: 'var(--color-text-muted)' }}> · varrendo…</span>}
                {scanStatus === 'concluido' && <span style={{ color: '#16a34a' }}> · concluído ✓</span>}
                {scanStatus === 'parado' && <span style={{ color: '#dc2626' }}> · parado</span>}
                {scanStatus === 'erro' && <span style={{ color: '#dc2626' }}> · erro</span>}
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                <strong style={{ color: 'var(--color-text)' }}>{scanProgress.total_resultados}</strong> leads ·{' '}
                {scanProgress.com_telefone} com telefone
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {scanProgress.requests_feitos} requests · ~{brl(scanProgress.requests_feitos * CUSTO_POR_REQUEST)} (estimado)
              </span>
            </div>
          </div>
        )}

        {/* Projeção antes de iniciar */}
        {!scanProgress && scanCategoria.trim() && (
          <p style={{ marginTop: 10, color: 'var(--color-text-muted)', fontSize: 12 }}>
            Ao iniciar, varre as cidades de {scanUf}. Sem teto: o botão Parar é o limite. Custo ~R$0,18 por request (≈ 3 requests por cidade).
          </p>
        )}

        {scanErro && <p style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>{scanErro}</p>}
      </div>

      {/* Busca rápida (1 termo, até 60 leads) */}
      <div style={cardStyle}>
        <label style={{ ...labelStyle, fontSize: 15 }}>⚡ Busca rápida</label>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 12, margin: '0 0 10px' }}>
          1 termo, resultado na hora (até ~60 leads). Pra escala estadual use a varredura acima.
        </p>
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

        <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={somenteCelular}
              onChange={e => setSomenteCelular(e.target.checked)}
              disabled={buscando}
            />
            <strong>Só celular (com WhatsApp)</strong>
          </label>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Telefones fixos não recebem WhatsApp — disparo falharia 100%
          </span>
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
            <div style={{ fontSize: 13 }}>
              Mostrando <strong>{visiveis.length}</strong> de {totaisDebug.total} ·{' '}
              <span style={{ color: 'var(--color-text-muted)' }}>
                {totaisDebug.celulares} celulares · {totaisDebug.comTelefone - totaisDebug.celulares} fixos · {totaisDebug.total - totaisDebug.comTelefone} sem telefone
              </span>
              {' · '}
              <strong>{totalSelecionados}</strong> selecionados
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={btnGhost} onClick={toggleTodos}>
                {visiveis.every(l => selecionados[l.id]) ? 'Desmarcar todos' : 'Marcar todos'}
              </button>
              <button style={btnPrimary} onClick={enviarParaDisparos} disabled={totalSelecionados === 0}>
                Enviar {totalSelecionados} pra /disparos →
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                  <th style={{ padding: 10, width: 30 }}></th>
                  <th style={{ padding: 10 }}>Nome</th>
                  <th style={{ padding: 10 }}>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px dashed var(--color-border)' }}>
                    <td style={{ padding: 10 }}>
                      <input
                        type="checkbox"
                        checked={!!selecionados[l.id]}
                        onChange={() => setSelecionados(prev => ({ ...prev, [l.id]: !prev[l.id] }))}
                        disabled={!l.telefone}
                      />
                    </td>
                    <td style={{ padding: 10, fontWeight: 600 }}>{l.nome || '—'}</td>
                    <td style={{ padding: 10, fontFamily: 'monospace' }}>
                      {l.telefone ? l.telefone : <span style={{ color: 'var(--color-text-muted)' }}>sem telefone</span>}
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
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {s.tipo === 'varredura' && <span style={{ fontSize: 11, marginRight: 6, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: 'var(--color-primary, #F59E0B)' }}>🗺️ {s.uf}</span>}
                    {s.query}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {new Date(s.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{s.total_resultados} leads · {s.com_telefone} com telefone
                    {s.tipo === 'varredura' && typeof s.municipios_total === 'number' && (
                      <> · {s.municipios_processados}/{s.municipios_total} cidades{s.status === 'parado' ? ' (parado)' : s.status === 'erro' ? ' (erro)' : ''}</>
                    )}
                  </div>
                </button>
                {s.tipo === 'varredura' && (s.status === 'rodando' || s.status === 'parado') && scanStatus !== 'rodando' && (
                  <button onClick={() => retomarVarredura(s.id)} style={{ ...btnGhost, color: 'var(--color-primary, #F59E0B)', padding: '4px 10px' }}>
                    retomar
                  </button>
                )}
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
