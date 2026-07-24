'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ClipboardCheck, Camera, Check, X, RefreshCw, Share2, Copy, Plus,
} from 'lucide-react';
import api from '@/services/api';
import './vistoria.css';

// Telemetria de uso (não abate crédito — vistoria é ferramenta de campo).
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'vistoria', event_type }).catch(() => {});
}

interface Client { id: string; nome: string }

interface Item {
  key: string;
  label: string;
  dica: string;
  foto_url: string | null;
  obs: string;
  ts: string | null;
}

interface Vistoria {
  id: string;
  cliente_nome: string | null;
  status: string;
  itens: Item[];
}

// Status de upload por item (client-side, não vem do banco).
type UpState = 'idle' | 'uploading' | 'ok' | 'error';

const MAX_DIM = 1568; // maior lado; mantém a foto leve pra subir rápido no campo

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Não consegui abrir o arquivo.'));
    r.readAsDataURL(file);
  });
}

// Redimensiona e recomprime pra JPEG leve. Devolve base64 (sem prefixo) + preview.
async function compress(file: File): Promise<{ base64: string; preview: string }> {
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new window.Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Imagem inválida.'));
    im.src = dataUrl;
  });
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_DIM) {
    const s = MAX_DIM / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Navegador sem suporte a canvas.');
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: jpeg.split(',')[1] || '', preview: jpeg };
}

function apiError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || '';
}

export default function VistoriaPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [vistoria, setVistoria] = useState<Vistoria | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [upStates, setUpStates] = useState<Record<string, UpState>>({});
  const [starting, setStarting] = useState(false);
  const [concluida, setConcluida] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);

  // Um input de câmera por item (ref por key).
  const camRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const obsTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) { opened.current = true; logUso('open'); }
    api.get('/clients').then((r) => setClients(r.data || [])).catch(() => {});
  }, []);

  async function iniciar() {
    setErro('');
    setStarting(true);
    try {
      const body = clienteId
        ? { cliente_id: clienteId }
        : { cliente_nome: clienteNome.trim() || null };
      const r = await api.post('/vistorias', body);
      setVistoria(r.data);
      logUso('start');
    } catch (err) {
      setErro(apiError(err) || 'Não consegui iniciar a vistoria. Tente de novo.');
    } finally {
      setStarting(false);
    }
  }

  const enviarFoto = useCallback(async (item: Item, file: File) => {
    setErro('');
    let payload: { base64: string; preview: string };
    try {
      payload = await compress(file);
    } catch {
      setErro('Não consegui processar essa foto. Tente outra.');
      return;
    }
    // Preview local imediato (o técnico vê a foto na hora, mesmo antes de subir).
    setPreviews((p) => ({ ...p, [item.key]: payload.preview }));
    setUpStates((s) => ({ ...s, [item.key]: 'uploading' }));

    try {
      const r = await api.post(`/vistorias/${vistoria!.id}/foto`, {
        item_key: item.key,
        base64: payload.base64,
        media_type: 'image/jpeg',
      });
      const fotoUrl = r.data?.foto_url ?? 'set';
      setUpStates((s) => ({ ...s, [item.key]: 'ok' }));
      setVistoria((v) => v && ({
        ...v,
        itens: v.itens.map((it) => it.key === item.key ? { ...it, foto_url: fotoUrl } : it),
      }));
    } catch (err) {
      setUpStates((s) => ({ ...s, [item.key]: 'error' }));
      setErro(apiError(err) || 'Uma foto não subiu. Toque em "tentar de novo" no item.');
    }
  }, [vistoria]);

  function onPick(item: Item, files: FileList | null) {
    const f = files?.[0];
    if (f) enviarFoto(item, f);
  }

  function salvarObs(item: Item, obs: string) {
    setVistoria((v) => v && ({ ...v, itens: v.itens.map((it) => it.key === item.key ? { ...it, obs } : it) }));
    clearTimeout(obsTimers.current[item.key]);
    obsTimers.current[item.key] = setTimeout(() => {
      api.patch(`/vistorias/${vistoria!.id}/item`, { item_key: item.key, obs }).catch(() => {});
    }, 700);
  }

  async function concluir() {
    setErro('');
    try {
      await api.post(`/vistorias/${vistoria!.id}/concluir`);
      setConcluida(true);
      logUso('complete');
    } catch (err) {
      setErro(apiError(err) || 'Não consegui concluir. Tente de novo.');
    }
  }

  function reset() {
    setVistoria(null); setPreviews({}); setUpStates({}); setConcluida(false);
    setClienteId(''); setClienteNome(''); setErro('');
  }

  const total = vistoria?.itens.length ?? 0;
  const feitos = vistoria?.itens.filter((i) => i.foto_url).length ?? 0;
  const pct = total ? Math.round((feitos / total) * 100) : 0;

  const reportUrl = vistoria && typeof window !== 'undefined'
    ? `${window.location.origin}/v/${vistoria.id}`
    : '';

  function copiar() {
    if (!reportUrl) return;
    navigator.clipboard?.writeText(reportUrl).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }).catch(() => {});
  }

  const waMsg = encodeURIComponent(
    `Vistoria${vistoria?.cliente_nome ? ' de ' + vistoria.cliente_nome : ''} — relatório com as fotos:\n${reportUrl}`,
  );

  // ── Tela inicial: escolher cliente e iniciar ──
  if (!vistoria) {
    return (
      <div className="vst-page">
        <header className="vst-hero">
          <div className="vst-heroBadge"><ClipboardCheck size={16} strokeWidth={2.2} /> Vistoria Solar</div>
          <h1 className="vst-heroTitle">Faça a vistoria pelo celular, foto por foto</h1>
          <p className="vst-heroSub">
            Cada item abre a câmera e a foto sobe na hora. No fim, você recebe um link com o relatório completo pra mandar no WhatsApp.
          </p>
        </header>

        <div className="vst-card">
          <label className="vst-label">Cliente (opcional)</label>
          {clients.length > 0 && (
            <select
              className="vst-select"
              value={clienteId}
              onChange={(e) => { setClienteId(e.target.value); setClienteNome(''); }}
              style={{ marginBottom: 10 }}
            >
              <option value="">— Sem cliente / avulsa —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          )}
          {!clienteId && (
            <input
              className="vst-input"
              placeholder="Ou digite o nome do cliente/imóvel"
              value={clienteNome}
              onChange={(e) => setClienteNome(e.target.value)}
              style={{ marginBottom: 14 }}
            />
          )}
          <button className="vst-primaryBtn" onClick={iniciar} disabled={starting}>
            {starting ? 'Iniciando…' : <><Plus size={18} strokeWidth={2.4} /> Iniciar vistoria</>}
          </button>
          {erro && <p className="vst-err">{erro}</p>}
        </div>
      </div>
    );
  }

  // ── Tela de conclusão: link + WhatsApp ──
  if (concluida) {
    return (
      <div className="vst-page">
        <div className="vst-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <h1 className="vst-heroTitle" style={{ marginTop: 8 }}>Vistoria concluída!</h1>
          <p className="vst-heroSub">{feitos} de {total} itens fotografados.</p>

          <div className="vst-linkBox">
            <input className="vst-input" readOnly value={reportUrl} onFocus={(e) => e.target.select()} />
            <button className="vst-copyBtn" onClick={copiar}><Copy size={15} /></button>
          </div>
          {copiado && <p className="vst-toast">Link copiado!</p>}

          <a className="vst-wa" href={`https://wa.me/?text=${waMsg}`} target="_blank" rel="noopener noreferrer">
            <Share2 size={18} /> Enviar no WhatsApp
          </a>
          <a className="vst-ghostBtn" href={reportUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>
            Abrir relatório
          </a>
          <button className="vst-ghostBtn" onClick={reset} style={{ marginTop: 10 }}>
            <RefreshCw size={15} /> Nova vistoria
          </button>
        </div>
      </div>
    );
  }

  // ── Tela do checklist ──
  return (
    <div className="vst-page">
      <header className="vst-hero" style={{ paddingBottom: 4 }}>
        <div className="vst-heroBadge"><ClipboardCheck size={16} strokeWidth={2.2} /> Vistoria Solar</div>
        <h1 className="vst-heroTitle" style={{ fontSize: 20 }}>
          {vistoria.cliente_nome || 'Vistoria avulsa'}
        </h1>
      </header>

      <div className="vst-progressWrap">
        <div className="vst-progressHead">
          <strong>{feitos}/{total} itens</strong>
          <span>Toque na foto de cada item</span>
        </div>
        <div className="vst-progressBar"><div className="vst-progressFill" style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="vst-items">
        {vistoria.itens.map((item) => {
          const up = upStates[item.key] ?? (item.foto_url ? 'ok' : 'idle');
          const preview = previews[item.key];
          const done = up === 'ok' || (!!item.foto_url && up !== 'uploading' && up !== 'error');
          return (
            <div key={item.key} className={`vst-item ${done ? 'vst-done' : ''}`}>
              <input
                ref={(el) => { camRefs.current[item.key] = el; }}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => { onPick(item, e.target.files); e.target.value = ''; }}
              />
              <div className="vst-thumb" onClick={() => camRefs.current[item.key]?.click()}>
                {preview ? <img src={preview} alt={item.label} /> : (
                  <span className="vst-thumbCam"><Camera size={20} strokeWidth={1.8} />foto</span>
                )}
                {up === 'uploading' && <span className="vst-thumbSpinner"><span className="vst-spin" /></span>}
                {up === 'ok' && <span className="vst-thumbBadge ok"><Check size={13} strokeWidth={3} /></span>}
                {up === 'error' && <span className="vst-thumbBadge err"><X size={13} strokeWidth={3} /></span>}
              </div>

              <div className="vst-itemBody">
                <div className="vst-itemTitle">{item.label}</div>
                <p className="vst-itemDica">{item.dica}</p>
                <textarea
                  className="vst-obs"
                  placeholder="Observação (opcional)"
                  defaultValue={item.obs}
                  onChange={(e) => salvarObs(item, e.target.value)}
                />
                {up === 'error' && (
                  <button className="vst-retry" onClick={() => camRefs.current[item.key]?.click()}>
                    Não subiu — tentar de novo
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {erro && <p className="vst-err">{erro}</p>}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="vst-primaryBtn" onClick={concluir}>
          <Check size={18} strokeWidth={2.4} /> Concluir e gerar link
        </button>
        <Link href="/clientes" className="vst-ghostBtn">Sair sem concluir</Link>
      </div>
    </div>
  );
}
