'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '@/services/api';

interface LogLine {
  id: string;
  ts: string;
  phone: string;
  slot: number;
  status: 'ok' | 'err' | 'skip';
  detail: string;
}

interface BroadcastRow {
  id: string;
  criado_em: string;
  mensagens: { slot: number; base: string }[];
  total: number;
  sucesso: number;
  falha: number;
  status: string;
  finalizado_em: string | null;
  usou_ia: boolean;
  cadencia_min: number;
  cadencia_max: number;
}

interface NumberParseResult {
  validos: string[];           // E.164 sem +, ex: 5534999999999
  invalidos: string[];         // strings originais que nao deram pra normalizar
  porDDD: Record<string, string[]>;
}

function normalizarTelefones(raw: string): NumberParseResult {
  const lines = raw
    .split(/[\n,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const validos: string[] = [];
  const invalidos: string[] = [];

  for (const line of lines) {
    const digits = line.replace(/\D/g, '');
    if (!digits) continue;
    let e164: string | null = null;

    if (digits.length === 13 && digits.startsWith('55')) {
      e164 = digits;
    } else if (digits.length === 12 && digits.startsWith('55')) {
      // 55 + DDD + 8 digits (mobile sem o 9 inicial). Adiciona 9.
      const ddd = digits.slice(2, 4);
      const rest = digits.slice(4);
      e164 = `55${ddd}9${rest}`;
    } else if (digits.length === 11) {
      // DDD + 9 + 8 digits — prepend 55
      e164 = `55${digits}`;
    } else if (digits.length === 10) {
      // DDD + 8 digits — add 9 mobile + prepend 55
      const ddd = digits.slice(0, 2);
      const rest = digits.slice(2);
      e164 = `55${ddd}9${rest}`;
    } else {
      invalidos.push(line);
      continue;
    }

    if (!validos.includes(e164)) validos.push(e164);
  }

  const porDDD: Record<string, string[]> = {};
  for (const v of validos) {
    const ddd = v.slice(2, 4);
    if (!porDDD[ddd]) porDDD[ddd] = [];
    porDDD[ddd].push(v);
  }

  return { validos, invalidos, porDDD };
}

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function sleep(ms: number) {
  return new Promise<void>(res => setTimeout(res, ms));
}

export default function DisparosPage() {
  const [msg1, setMsg1] = useState('');
  const [msg2, setMsg2] = useState('');
  const [msg3, setMsg3] = useState('');
  const [contatosRaw, setContatosRaw] = useState('');
  const [contextoIA, setContextoIA] = useState(
    'Sou a Giovanna, consultora da Irmaos na Obra Energia Solar. Estou prospectando contatos de quem demonstrou interesse em energia solar. Tom: simpatico, direto, sem ser invasivo.'
  );
  const [usarIA, setUsarIA] = useState(true);
  const [cadMin, setCadMin] = useState(4);
  const [cadMax, setCadMax] = useState(8);

  const [parsed, setParsed] = useState<NumberParseResult | null>(null);
  const [dddsAtivos, setDddsAtivos] = useState<Record<string, boolean>>({});

  // Broadcast em execução (server-side). null = ocioso.
  const [broadcastAtivoId, setBroadcastAtivoId] = useState<string | null>(null);
  const rodando = broadcastAtivoId !== null;
  const [log, setLog] = useState<LogLine[]>([]);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });
  const lastEnvioTsRef = useRef<string | null>(null);
  const seenEnvioIdsRef = useRef<Set<string>>(new Set());
  const [historico, setHistorico] = useState<BroadcastRow[]>([]);
  const [historicoLoading, setHistoricoLoading] = useState(false);

  const loadHistorico = useCallback(async () => {
    setHistoricoLoading(true);
    try {
      const r = await api.get('/admin/io/broadcasts?limit=20');
      setHistorico(r.data?.broadcasts ?? []);
    } catch {
      setHistorico([]);
    } finally {
      setHistoricoLoading(false);
    }
  }, []);

  useEffect(() => { loadHistorico(); }, [loadHistorico]);

  // Pré-preenche contatos vindo do /admin/leads-google via localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prefill = window.localStorage.getItem('disparos_telefones_prefill');
    if (prefill) {
      setContatosRaw(prefill);
      window.localStorage.removeItem('disparos_telefones_prefill');
    }
  }, []);

  const mensagens = useMemo(() => [msg1, msg2, msg3].filter(m => m.trim().length > 0), [msg1, msg2, msg3]);

  const contatosFinais = useMemo(() => {
    if (!parsed) return [];
    return parsed.validos.filter(v => dddsAtivos[v.slice(2, 4)] !== false);
  }, [parsed, dddsAtivos]);

  function padronizar() {
    const r = normalizarTelefones(contatosRaw);
    setParsed(r);
    const ativos: Record<string, boolean> = {};
    Object.keys(r.porDDD).forEach(d => { ativos[d] = true; });
    setDddsAtivos(ativos);
  }

  function toggleDDD(ddd: string) {
    setDddsAtivos(prev => ({ ...prev, [ddd]: !prev[ddd] }));
  }

  function pushLog(line: Omit<LogLine, 'id' | 'ts'>) {
    setLog(prev => [...prev, { ...line, id: crypto.randomUUID(), ts: nowHM() }]);
  }

  async function dispararTudo() {
    if (mensagens.length === 0) { alert('Adicione pelo menos uma mensagem'); return; }
    if (contatosFinais.length === 0) { alert('Nenhum contato para disparar'); return; }
    if (cadMin > cadMax) { alert('Cadência min deve ser <= max'); return; }
    const total = mensagens.length * contatosFinais.length;
    if (!confirm(`Disparar ${mensagens.length} mensagem(ns) para ${contatosFinais.length} contato(s)? Total: ${total} envios.\n\nO servidor processa em background — pode fechar a aba que continua.`)) return;

    setLog([]);
    setProgresso({ feitos: 0, total });
    lastEnvioTsRef.current = null;
    seenEnvioIdsRef.current = new Set();

    let broadcastId: string | null = null;
    try {
      const r = await api.post('/admin/io/broadcasts', {
        mensagens: mensagens.map((base, i) => ({ slot: i + 1, base })),
        contatos: contatosFinais,
        contexto_ai: usarIA ? contextoIA : null,
        usou_ia: usarIA,
        cadencia_min: cadMin,
        cadencia_max: cadMax,
        total,
      });
      broadcastId = r.data?.id ?? null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'erro ao criar broadcast';
      alert(`Erro: ${msg}`);
      return;
    }
    if (!broadcastId) { alert('Erro: backend não retornou broadcast id'); return; }

    setBroadcastAtivoId(broadcastId);
    pushLog({ phone: '—', slot: 0, status: 'ok', detail: `Broadcast criado (${broadcastId.slice(0, 8)}...). Disparando primeiro tick.` });

    // Kick-off imediato (fire-and-forget). O cron continua daí.
    api.post(`/admin/io/broadcasts/${broadcastId}/tick`).catch(() => {
      /* tick pode demorar até 4 min; ignoramos resposta */
    });
  }

  async function parar() {
    if (!broadcastAtivoId) return;
    if (!confirm('Parar disparo? Envios já feitos ficam, os restantes não vão.')) return;
    try {
      await api.patch(`/admin/io/broadcasts/${broadcastAtivoId}`, { status: 'parado' });
      pushLog({ phone: '—', slot: 0, status: 'skip', detail: 'PARANDO… aguardando confirmação do servidor' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'erro ao parar';
      alert(`Falha ao parar: ${msg}`);
    }
  }

  // Polling do broadcast ativo (status + novos envios) a cada 3s
  useEffect(() => {
    if (!broadcastAtivoId) return;
    let cancelled = false;

    async function tick() {
      try {
        const [bRes, eRes] = await Promise.all([
          api.get(`/admin/io/broadcasts/${broadcastAtivoId}`),
          api.get(`/admin/io/broadcasts/${broadcastAtivoId}/envios?limit=50${lastEnvioTsRef.current ? `&since=${encodeURIComponent(lastEnvioTsRef.current)}` : ''}`),
        ]);
        if (cancelled) return;

        const b = bRes.data?.broadcast;
        if (b) {
          setProgresso({ feitos: (b.sucesso || 0) + (b.falha || 0), total: b.total || 0 });
        }

        const envios = (eRes.data?.envios ?? []) as Array<{
          id: string; enviado_em: string; phone: string; slot: number;
          mensagem_final: string; status: string; erro: string | null;
        }>;
        // Ordena cronologicamente
        const ordenados = [...envios].sort((a, b) => a.enviado_em.localeCompare(b.enviado_em));
        for (const env of ordenados) {
          if (seenEnvioIdsRef.current.has(env.id)) continue;
          seenEnvioIdsRef.current.add(env.id);
          lastEnvioTsRef.current = env.enviado_em;
          pushLog({
            phone: env.phone,
            slot: env.slot,
            status: env.status === 'ok' ? 'ok' : 'err',
            detail: env.status === 'ok'
              ? `→ "${env.mensagem_final.slice(0, 80)}${env.mensagem_final.length > 80 ? '...' : ''}"`
              : `Erro: ${env.erro || 'desconhecido'}`,
          });
        }

        if (b && (b.status === 'concluido' || b.status === 'parado' || b.status === 'erro')) {
          pushLog({
            phone: '—',
            slot: 0,
            status: b.status === 'concluido' ? 'ok' : 'skip',
            detail: `DISPARO ${b.status.toUpperCase()} · ${b.sucesso}/${b.total} sucessos · ${b.falha} falhas`,
          });
          setBroadcastAtivoId(null);
          loadHistorico();
        }
      } catch {
        /* tenta de novo no próximo tick */
      }
    }

    tick();
    const id = window.setInterval(tick, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [broadcastAtivoId, loadHistorico]);

  // Detecta broadcast pendente do histórico (em status='rodando') e oferece retomar
  const pendenteDoHistorico = useMemo(
    () => historico.find(h => h.status === 'rodando'),
    [historico],
  );

  function retomarPendente() {
    if (!pendenteDoHistorico) return;
    setBroadcastAtivoId(pendenteDoHistorico.id);
    setLog([]);
    setProgresso({ feitos: pendenteDoHistorico.sucesso + pendenteDoHistorico.falha, total: pendenteDoHistorico.total });
    lastEnvioTsRef.current = null;
    seenEnvioIdsRef.current = new Set();
    pushLog({ phone: '—', slot: 0, status: 'ok', detail: 'Reanexando ao disparo em andamento + chamando próximo tick' });
    api.post(`/admin/io/broadcasts/${pendenteDoHistorico.id}/tick`).catch(() => { /* ignora */ });
  }

  // Aviso ao tentar sair com disparo rodando (mesmo que server continue,
  // o user pode querer ficar vendo o progresso)
  useEffect(() => {
    if (!rodando) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [rodando]);

  // ── estilos inline (mantem padrao das outras admin pages) ─────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6, display: 'block' };
  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 70,
    padding: 10,
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 14,
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    resize: 'vertical',
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
  const btnDanger: React.CSSProperties = { ...btnPrimary, background: '#dc2626' };

  return (
    <div style={{ maxWidth: 1000, padding: '0 16px 32px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Disparos em massa (Irmãos na Obra)</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 4 }}>
          Linha 34998165040 · servidor processa em background — pode fechar a aba que continua.
        </p>
      </header>

      {/* Retomar pendente */}
      {!broadcastAtivoId && pendenteDoHistorico && (
        <div style={{
          padding: 14,
          marginBottom: 16,
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid #3b82f6',
          borderRadius: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: '#3b82f6' }}>Disparo pendente</strong>{' '}
            de {new Date(pendenteDoHistorico.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}
            {pendenteDoHistorico.sucesso}/{pendenteDoHistorico.total} enviados.
            O servidor continua processando automaticamente; clique pra acompanhar.
          </div>
          <button style={btnPrimary} onClick={retomarPendente}>
            Acompanhar
          </button>
        </div>
      )}

      {/* Mensagens */}
      <div style={cardStyle}>
        <label style={labelStyle}>Mensagem 1 (obrigatória)</label>
        <textarea
          style={textareaStyle}
          value={msg1}
          onChange={e => setMsg1(e.target.value)}
          placeholder="Ex: Boa tarde, aqui é a Giovanna"
          disabled={rodando}
        />
        <label style={{ ...labelStyle, marginTop: 14 }}>Mensagem 2 (opcional)</label>
        <textarea
          style={textareaStyle}
          value={msg2}
          onChange={e => setMsg2(e.target.value)}
          placeholder="Ex: A energia solar é uma prioridade pra você?"
          disabled={rodando}
        />
        <label style={{ ...labelStyle, marginTop: 14 }}>Mensagem 3 (opcional)</label>
        <textarea
          style={textareaStyle}
          value={msg3}
          onChange={e => setMsg3(e.target.value)}
          placeholder="Ex: Quero marcar uma ligação, qual melhor dia e horário?"
          disabled={rodando}
        />
      </div>

      {/* Contatos */}
      <div style={cardStyle}>
        <label style={labelStyle}>Contatos (cole de qualquer jeito — vírgula, quebra de linha, formato livre)</label>
        <textarea
          style={{ ...textareaStyle, minHeight: 140, fontFamily: 'monospace' }}
          value={contatosRaw}
          onChange={e => setContatosRaw(e.target.value)}
          placeholder="34999785803&#10;5534988191051&#10;(34) 99785-0803"
          disabled={rodando}
        />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btnGhost} onClick={padronizar} disabled={rodando}>
            Padronizar e extrair DDDs
          </button>
          {parsed && (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {parsed.validos.length} válidos · {parsed.invalidos.length} inválidos
            </span>
          )}
        </div>

        {parsed && Object.keys(parsed.porDDD).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>DDDs encontrados (desmarque pra excluir)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(parsed.porDDD)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([ddd, list]) => {
                  const ativo = dddsAtivos[ddd] !== false;
                  return (
                    <label
                      key={ddd}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: `1px solid ${ativo ? 'var(--color-primary, #F59E0B)' : 'var(--color-border)'}`,
                        background: ativo ? 'rgba(245,158,11,0.08)' : 'transparent',
                        cursor: rodando ? 'not-allowed' : 'pointer',
                        fontSize: 13,
                        opacity: rodando ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={ativo}
                        onChange={() => toggleDDD(ddd)}
                        disabled={rodando}
                      />
                      <strong>{ddd}</strong>
                      <span style={{ color: 'var(--color-text-muted)' }}>({list.length})</span>
                    </label>
                  );
                })}
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-muted)' }}>
              Selecionados: <strong style={{ color: 'var(--color-text)' }}>{contatosFinais.length}</strong> contatos
            </div>
          </div>
        )}

        {parsed && parsed.invalidos.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#dc2626' }}>
              {parsed.invalidos.length} entradas inválidas (clique pra ver)
            </summary>
            <pre style={{ fontSize: 12, marginTop: 6, padding: 8, background: 'var(--color-bg)', borderRadius: 6, maxHeight: 120, overflow: 'auto' }}>
              {parsed.invalidos.join('\n')}
            </pre>
          </details>
        )}
      </div>

      {/* IA + cadência */}
      <div style={cardStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={usarIA} onChange={e => setUsarIA(e.target.checked)} disabled={rodando} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Reescrever cada mensagem com IA (anti-robô)</span>
        </label>

        {usarIA && (
          <>
            <label style={labelStyle}>Contexto pra IA</label>
            <textarea
              style={textareaStyle}
              value={contextoIA}
              onChange={e => setContextoIA(e.target.value)}
              disabled={rodando}
            />
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              A IA mantém o significado, mas varia sutilmente cada envio. Sem travessão, sem emoji, frases curtas.
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Cadência mín (seg)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={cadMin}
              onChange={e => setCadMin(Number(e.target.value))}
              disabled={rodando}
              style={{ width: 90, padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14, background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Cadência máx (seg)</label>
            <input
              type="number"
              min={1}
              max={120}
              value={cadMax}
              onChange={e => setCadMax(Number(e.target.value))}
              disabled={rodando}
              style={{ width: 90, padding: 8, border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14, background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Cada envio espera entre {cadMin}s e {cadMax}s
          </div>
        </div>
      </div>

      {/* Botões + progresso */}
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!rodando ? (
            <button style={btnPrimary} onClick={dispararTudo}>
              Disparar {mensagens.length > 0 && contatosFinais.length > 0
                ? `${mensagens.length * contatosFinais.length} envios`
                : ''}
            </button>
          ) : (
            <button style={btnDanger} onClick={parar}>
              Parar disparo
            </button>
          )}

          {rodando && (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {progresso.feitos} / {progresso.total} envios
            </span>
          )}
        </div>

        {rodando && progresso.total > 0 && (
          <div style={{ width: '100%', height: 8, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${(progresso.feitos / progresso.total) * 100}%`,
                height: '100%',
                background: 'var(--color-primary, #F59E0B)',
                transition: 'width 0.3s',
              }}
            />
          </div>
        )}
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={cardStyle}>
          <label style={labelStyle}>Log do disparo ({log.length} linhas)</label>
          <div style={{
            maxHeight: 360,
            overflow: 'auto',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 10,
            fontFamily: 'monospace',
            fontSize: 12,
          }}>
            {log.slice().reverse().map(l => (
              <div key={l.id} style={{
                padding: '3px 0',
                borderBottom: '1px dashed var(--color-border)',
                color: l.status === 'err' ? '#dc2626' : l.status === 'skip' ? '#f59e0b' : 'var(--color-text)',
              }}>
                <span style={{ color: 'var(--color-text-muted)' }}>[{l.ts}]</span>{' '}
                {l.slot > 0 && <span style={{ color: 'var(--color-text-muted)' }}>R{l.slot}</span>}{' '}
                <strong>{l.phone}</strong> {l.detail}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Histórico */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ ...labelStyle, margin: 0 }}>Histórico (últimos 20 disparos)</label>
          <button style={btnGhost} onClick={loadHistorico} disabled={historicoLoading || rodando}>
            {historicoLoading ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
        {historico.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
            {historicoLoading ? 'Carregando...' : 'Nenhum disparo registrado ainda.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {historico.map(b => {
              const data = new Date(b.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
              const cor = b.status === 'concluido' ? '#22c55e' : b.status === 'parado' ? '#f59e0b' : b.status === 'rodando' ? '#3b82f6' : '#dc2626';
              const taxa = b.total > 0 ? Math.round((b.sucesso / b.total) * 100) : 0;
              const preview = (b.mensagens?.[0]?.base || '').slice(0, 60);
              return (
                <details key={b.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10 }}>
                  <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flex: 1 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, background: cor, color: '#fff', fontSize: 11, fontWeight: 700 }}>
                        {b.status.toUpperCase()}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{data}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{preview}{(b.mensagens?.[0]?.base || '').length > 60 ? '...' : ''}"
                      </span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {b.sucesso}/{b.total} ({taxa}%)
                    </span>
                  </summary>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <div><strong>Mensagens ({b.mensagens?.length || 0}):</strong></div>
                    <ul style={{ margin: '4px 0 8px 18px', padding: 0 }}>
                      {(b.mensagens || []).map(m => (
                        <li key={m.slot}>R{m.slot}: {m.base}</li>
                      ))}
                    </ul>
                    <div>IA: {b.usou_ia ? 'sim' : 'não'} · Cadência: {b.cadencia_min}-{b.cadencia_max}s · Falhas: {b.falha}</div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
