'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ClipboardCheck, Camera, Paperclip, Check, X, RefreshCw, Share2, Copy, Plus, Trash2, FileText, Download,
} from 'lucide-react';
import api from '@/services/api';
import ClientModal from '@/components/ClientModal/ClientModal';
import './vistoria.css';

// Telemetria de uso (não abate crédito — vistoria é ferramenta de campo).
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'vistoria', event_type }).catch(() => {});
}

interface Client { id: string; nome: string }
interface Grupo { empresa: string; clientes: Client[] }

// Uma foto/arquivo no estado do cliente. `url` só existe depois de subir.
interface Foto {
  cid: string;                 // id client-side (chave de render/estado)
  url?: string;                // caminho no Storage (vem do servidor)
  signed?: string | null;      // signed url pra exibir (vem do servidor)
  preview?: string;            // data URL local (imagem) pra mostrar na hora
  tipo: 'image' | 'file';
  nome?: string;
  uploading?: boolean;
  error?: boolean;
}

interface Item { key: string; label: string; dica: string; obs: string; fotos: Foto[] }
interface Vistoria { id: string; cliente_id: string | null; cliente_nome: string | null; status: string; itens: Item[] }

const MAX_DIM = 1568;
let CID = 0;
const novoCid = () => `f${Date.now()}_${CID++}`;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Não consegui abrir o arquivo.'));
    r.readAsDataURL(file);
  });
}

// Imagem: redimensiona e recomprime pra JPEG leve. Devolve base64 + preview.
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
    w = Math.round(w * s); h = Math.round(h * s);
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

type Modo = 'nome' | 'cadastrado' | 'novo';

export default function VistoriaPage() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [modo, setModo] = useState<Modo>('cadastrado');
  const [clienteId, setClienteId] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [vistoria, setVistoria] = useState<Vistoria | null>(null);
  const [starting, setStarting] = useState(false);
  const [concluida, setConcluida] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [lightbox, setLightbox] = useState<{ itemKey: string; foto: Foto } | null>(null);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const obsTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const opened = useRef(false);

  const carregarGrupos = useCallback(() => {
    api.get('/vistorias/clientes').then((r) => setGrupos(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!opened.current) { opened.current = true; logUso('open'); }
    carregarGrupos();
  }, [carregarGrupos]);

  // ── Mutação de estado: mexe nas fotos de um item ──
  function setItemFotos(itemKey: string, fn: (fotos: Foto[]) => Foto[]) {
    setVistoria((v) => v && ({ ...v, itens: v.itens.map((it) => it.key === itemKey ? { ...it, fotos: fn(it.fotos) } : it) }));
  }

  async function iniciar() {
    setErro(''); setStarting(true);
    try {
      const body =
        modo === 'nome' ? { cliente_nome: clienteNome.trim() || null } :
        clienteId ? { cliente_id: clienteId } : { cliente_nome: null };
      const r = await api.post('/vistorias', body);
      const v = r.data as Vistoria;
      v.itens = v.itens.map((it) => ({ ...it, fotos: [] }));
      setVistoria(v);
      logUso('start');
    } catch (err) {
      setErro(apiError(err) || 'Não consegui iniciar a vistoria. Tente de novo.');
    } finally {
      setStarting(false);
    }
  }

  // Cliente novo cadastrado no modal → seleciona e vira modo "cadastrado".
  function onClienteCriado(c: Client) {
    setModalOpen(false);
    setClienteId(c.id);
    setClienteNome(c.nome);
    setModo('cadastrado');
    carregarGrupos(); // recarrega a lista agrupada já com o novo cliente
  }

  const addArquivo = useCallback(async (itemKey: string, file: File) => {
    if (!vistoria) return;
    setErro('');
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const cid = novoCid();
    let base64 = ''; let preview = ''; let media_type = 'image/jpeg';
    try {
      if (isPdf) {
        base64 = (await readAsDataUrl(file)).split(',')[1] || '';
        media_type = 'application/pdf';
      } else {
        const c = await compress(file);
        base64 = c.base64; preview = c.preview;
      }
    } catch {
      setErro('Não consegui processar esse arquivo. Tente outro.');
      return;
    }
    // Otimista: mostra na hora, marcado como subindo.
    setItemFotos(itemKey, (f) => [...f, { cid, preview, tipo: isPdf ? 'file' : 'image', nome: file.name, uploading: true }]);
    try {
      const r = await api.post(`/vistorias/${vistoria.id}/foto`, { item_key: itemKey, base64, media_type, nome: file.name });
      const foto = r.data.foto as { url: string; signed: string | null; tipo: 'image' | 'file'; nome?: string };
      setItemFotos(itemKey, (f) => f.map((x) => x.cid === cid
        ? { ...x, url: foto.url, signed: foto.signed, tipo: foto.tipo, nome: foto.nome, uploading: false }
        : x));
    } catch (err) {
      setItemFotos(itemKey, (f) => f.map((x) => x.cid === cid ? { ...x, uploading: false, error: true } : x));
      setErro(apiError(err) || 'Um arquivo não subiu. Toque no X pra remover e tente de novo.');
    }
  }, [vistoria]);

  function onPick(itemKey: string, files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => addArquivo(itemKey, f));
  }

  async function removeFoto(itemKey: string, foto: Foto) {
    setItemFotos(itemKey, (f) => f.filter((x) => x.cid !== foto.cid));
    setLightbox(null);
    if (foto.url && vistoria) {
      api.delete(`/vistorias/${vistoria.id}/foto`, { data: { item_key: itemKey, url: foto.url } }).catch(() => {});
    }
  }

  function salvarObs(itemKey: string, obs: string) {
    setVistoria((v) => v && ({ ...v, itens: v.itens.map((it) => it.key === itemKey ? { ...it, obs } : it) }));
    clearTimeout(obsTimers.current[itemKey]);
    obsTimers.current[itemKey] = setTimeout(() => {
      if (vistoria) api.patch(`/vistorias/${vistoria.id}/item`, { item_key: itemKey, obs }).catch(() => {});
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
    setVistoria(null); setConcluida(false); setErro('');
    setModo('nome'); setClienteId(''); setClienteNome('');
  }

  const total = vistoria?.itens.length ?? 0;
  const feitos = vistoria?.itens.filter((i) => i.fotos.length > 0).length ?? 0;
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  const reportUrl = vistoria && typeof window !== 'undefined' ? `${window.location.origin}/v/${vistoria.id}` : '';

  function copiar() {
    if (!reportUrl) return;
    navigator.clipboard?.writeText(reportUrl).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }).catch(() => {});
  }
  const waMsg = encodeURIComponent(`Vistoria${vistoria?.cliente_nome ? ' de ' + vistoria.cliente_nome : ''} — relatório com as fotos:\n${reportUrl}`);

  // ── Tela inicial ──
  if (!vistoria) {
    return (
      <div className="vst-page">
        {modalOpen && <ClientModal client={null} onClose={() => setModalOpen(false)} onSave={onClienteCriado} />}
        <header className="vst-hero">
          <div className="vst-heroBadge"><ClipboardCheck size={16} strokeWidth={2.2} /> Vistoria Solar</div>
          <h1 className="vst-heroTitle">Faça a vistoria pelo celular, foto por foto</h1>
          <p className="vst-heroSub">
            Cada item abre a câmera (ou anexa arquivo do PC). Tudo sobe na hora e no fim você recebe um link com o relatório pra mandar no WhatsApp.
          </p>
        </header>

        <div className="vst-card">
          <label className="vst-label">Cliente</label>
          <div className="vst-seg">
            <button className={`vst-segBtn ${modo === 'novo' ? 'on' : ''}`} onClick={() => { setModo('novo'); setModalOpen(true); }}>Cadastrar Cliente</button>
            <button className={`vst-segBtn ${modo === 'cadastrado' ? 'on' : ''}`} onClick={() => setModo('cadastrado')}>Cliente Cadastrado</button>
            <button className={`vst-segBtn ${modo === 'nome' ? 'on' : ''}`} onClick={() => setModo('nome')}>Apenas Nome</button>
          </div>

          {modo === 'cadastrado' && (
            grupos.some((g) => g.clientes.length > 0) ? (
              <select className="vst-select" value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ marginBottom: 14 }}>
                <option value="">— Escolha um cliente —</option>
                {grupos.filter((g) => g.clientes.length > 0).map((g) => (
                  <optgroup key={g.empresa} label={g.empresa}>
                    {g.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </optgroup>
                ))}
              </select>
            ) : (
              <p className="vst-heroSub" style={{ marginBottom: 14 }}>Nenhum cliente cadastrado ainda. Use “Cadastrar Cliente” ou “Apenas Nome”.</p>
            )
          )}
          {modo === 'nome' && (
            <input className="vst-input" placeholder="Nome do cliente ou do imóvel (opcional)"
              value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} style={{ marginBottom: 14 }} />
          )}
          {modo === 'novo' && (
            <div style={{ marginBottom: 14 }}>
              {clienteId
                ? <p className="vst-heroSub">Selecionado: <strong>{clienteNome}</strong></p>
                : <button className="vst-ghostBtn" onClick={() => setModalOpen(true)}><Plus size={15} /> Cadastrar novo cliente</button>}
            </div>
          )}

          <button className="vst-primaryBtn" onClick={iniciar}
            disabled={starting || (modo === 'cadastrado' && !clienteId) || (modo === 'novo' && !clienteId)}>
            {starting ? 'Iniciando…' : <><Plus size={18} strokeWidth={2.4} /> Iniciar vistoria</>}
          </button>
          {erro && <p className="vst-err">{erro}</p>}
        </div>
      </div>
    );
  }

  // ── Tela de conclusão ──
  if (concluida) {
    return (
      <div className="vst-page">
        <div className="vst-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <h1 className="vst-heroTitle" style={{ marginTop: 8 }}>Vistoria concluída!</h1>
          <p className="vst-heroSub">{feitos} de {total} itens registrados{vistoria.cliente_nome ? ` — ${vistoria.cliente_nome}` : ''}.</p>
          <div className="vst-linkBox">
            <input className="vst-input" readOnly value={reportUrl} onFocus={(e) => e.target.select()} />
            <button className="vst-copyBtn" onClick={copiar}><Copy size={15} /></button>
          </div>
          {copiado && <p className="vst-toast">Link copiado!</p>}
          <a className="vst-wa" href={`https://wa.me/?text=${waMsg}`} target="_blank" rel="noopener noreferrer"><Share2 size={18} /> Enviar no WhatsApp</a>
          <a className="vst-primaryBtn" href={`${reportUrl}/fotos.zip`} style={{ marginTop: 10, textDecoration: 'none' }}><Download size={18} strokeWidth={2.4} /> Baixar todas as fotos</a>
          <a className="vst-ghostBtn" href={reportUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>Abrir relatório</a>
          <button className="vst-ghostBtn" onClick={reset} style={{ marginTop: 10 }}><RefreshCw size={15} /> Nova vistoria</button>
        </div>
      </div>
    );
  }

  // ── Tela do checklist ──
  return (
    <div className="vst-page">
      {lightbox && (
        <div className="vst-lightbox" onClick={() => setLightbox(null)}>
          {lightbox.foto.tipo === 'image'
            ? <img src={lightbox.foto.signed || lightbox.foto.preview} alt="Conferência" onClick={(e) => e.stopPropagation()} />
            : <div className="vst-card" onClick={(e) => e.stopPropagation()}><FileText size={48} /><p>{lightbox.foto.nome || 'Arquivo'}</p></div>}
          <div className="vst-lbActions" onClick={(e) => e.stopPropagation()}>
            <button className="vst-lbBtn vst-lbDel" onClick={() => removeFoto(lightbox.itemKey, lightbox.foto)}><Trash2 size={15} /> Não ficou boa</button>
            <button className="vst-lbBtn vst-lbClose" onClick={() => setLightbox(null)}>Fechar</button>
          </div>
        </div>
      )}

      <header className="vst-hero" style={{ paddingBottom: 4 }}>
        <div className="vst-heroBadge"><ClipboardCheck size={16} strokeWidth={2.2} /> Vistoria Solar</div>
        <h1 className="vst-heroTitle" style={{ fontSize: 20 }}>{vistoria.cliente_nome || 'Vistoria avulsa'}</h1>
      </header>

      <div className="vst-progressWrap">
        <div className="vst-progressHead">
          <strong>{feitos}/{total} itens</strong>
          <span>Câmera ou arquivo · várias por item</span>
        </div>
        <div className="vst-progressBar"><div className="vst-progressFill" style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="vst-items">
        {vistoria.itens.map((item, idx) => {
          const done = item.fotos.some((f) => f.url);
          return (
            <div key={item.key} className={`vst-item2 ${done ? 'vst-done' : ''}`}>
              {/* inputs escondidos: câmera (mobile) e arquivo (PC/galeria + PDF) */}
              <input ref={(el) => { inputRefs.current[`${item.key}-cam`] = el; }} type="file" accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={(e) => { onPick(item.key, e.target.files); e.target.value = ''; }} />
              <input ref={(el) => { inputRefs.current[`${item.key}-file`] = el; }} type="file" accept="image/*,application/pdf" multiple
                style={{ display: 'none' }} onChange={(e) => { onPick(item.key, e.target.files); e.target.value = ''; }} />

              <div className="vst-itemTitle">
                <span className={`vst-itemNum ${done ? 'done' : ''}`}>{done ? <Check size={13} strokeWidth={3} /> : idx + 1}</span>
                {item.label}
              </div>
              <p className="vst-itemDica">{item.dica}</p>

              {item.fotos.length > 0 && (
                <div className="vst-gallery">
                  {item.fotos.map((foto) => (
                    <div key={foto.cid} className="vst-photo"
                      onClick={() => { if (!foto.uploading && !foto.error) setLightbox({ itemKey: item.key, foto }); }}>
                      {foto.tipo === 'image'
                        ? <img src={foto.signed || foto.preview} alt={item.label} />
                        : <div className="vst-fileChip"><FileText size={22} />{foto.nome?.slice(0, 18) || 'arquivo'}</div>}
                      {foto.uploading && <div className="vst-photoUp"><span className="vst-spin" /></div>}
                      {foto.error && <div className="vst-photoErr">falhou</div>}
                      {!foto.uploading && (
                        <button className="vst-photoDel" onClick={(e) => { e.stopPropagation(); removeFoto(item.key, foto); }}><X size={13} /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="vst-addBtns">
                <button className="vst-addBtn" onClick={() => inputRefs.current[`${item.key}-cam`]?.click()}><Camera size={16} /> Câmera</button>
                <button className="vst-addBtn" onClick={() => inputRefs.current[`${item.key}-file`]?.click()}><Paperclip size={16} /> Arquivo</button>
              </div>

              <textarea className="vst-obs" placeholder="Observação (opcional)" defaultValue={item.obs}
                onChange={(e) => salvarObs(item.key, e.target.value)} style={{ marginTop: 10 }} />
            </div>
          );
        })}
      </div>

      {erro && <p className="vst-err">{erro}</p>}

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560, marginInline: 'auto' }}>
        <button className="vst-primaryBtn" onClick={concluir}><Check size={18} strokeWidth={2.4} /> Concluir e gerar link</button>
        <Link href="/clientes" className="vst-ghostBtn">Sair sem concluir</Link>
      </div>
    </div>
  );
}
