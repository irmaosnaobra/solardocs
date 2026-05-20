'use client';

import { useMemo, useRef, useState } from 'react';
import api from '@/services/api';

interface LogLine {
  id: string;
  ts: string;
  phone: string;
  slot: number;
  status: 'ok' | 'err' | 'skip';
  detail: string;
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

  const [rodando, setRodando] = useState(false);
  const stopRef = useRef(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });

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
    if (!confirm(`Disparar ${mensagens.length} mensagem(ns) para ${contatosFinais.length} contato(s)? Total: ${mensagens.length * contatosFinais.length} envios.`)) return;

    stopRef.current = false;
    setRodando(true);
    setLog([]);
    const total = mensagens.length * contatosFinais.length;
    setProgresso({ feitos: 0, total });

    let feitos = 0;
    for (let slotIdx = 0; slotIdx < mensagens.length; slotIdx++) {
      const slot = slotIdx + 1;
      const base = mensagens[slotIdx];
      pushLog({ phone: '—', slot, status: 'ok', detail: `=== INICIANDO RODADA ${slot} (${contatosFinais.length} contatos) ===` });

      for (const phone of contatosFinais) {
        if (stopRef.current) {
          pushLog({ phone, slot, status: 'skip', detail: 'PARADO pelo usuario' });
          setRodando(false);
          return;
        }

        let textoFinal = base;
        if (usarIA) {
          try {
            const r = await api.post('/admin/io/humanize', { base, context: contextoIA });
            textoFinal = (r.data?.message || base).trim();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'erro humanize';
            pushLog({ phone, slot, status: 'err', detail: `Humanize falhou (usando base): ${msg}` });
            textoFinal = base;
          }
        }

        try {
          const r = await api.post('/admin/io/send-text', { phone, message: textoFinal });
          const ok = r.status >= 200 && r.status < 300;
          pushLog({
            phone,
            slot,
            status: ok ? 'ok' : 'err',
            detail: `→ "${textoFinal.slice(0, 80)}${textoFinal.length > 80 ? '...' : ''}"`,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'erro envio';
          pushLog({ phone, slot, status: 'err', detail: `Envio falhou: ${msg}` });
        }

        feitos++;
        setProgresso({ feitos, total });

        const espera = Math.floor((Math.random() * (cadMax - cadMin) + cadMin) * 1000);
        await sleep(espera);
      }
    }

    pushLog({ phone: '—', slot: 0, status: 'ok', detail: 'TODOS OS ROUNDS CONCLUIDOS' });
    setRodando(false);
  }

  function parar() {
    stopRef.current = true;
  }

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
          Linha 34998165040 · cadência aleatória + reescrita por IA = baixa chance de bloqueio anti-spam.
        </p>
      </header>

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
    </div>
  );
}
