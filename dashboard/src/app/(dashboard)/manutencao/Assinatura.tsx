'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Check, RefreshCw } from 'lucide-react';

interface Ponto { x: number; y: number }

const ALTURA = 190;
// A assinatura é um documento: a tinta é escura sempre, porque o PNG vai para um relatório branco.
const TINTA = '#0b1220';

export interface AssinaturaProps {
  rotulo: string;
  /** Signed URL da assinatura já salva. */
  url?: string;
  nomeInicial: string;
  registroInicial?: string;
  comRegistro?: boolean;
  aviso?: string;
  onSalvar: (pngBase64: string, nome: string, registro: string) => Promise<string | null>;
  onRemover: () => Promise<string | null>;
}

export default function Assinatura({
  rotulo, url, nomeInicial, registroInicial = '', comRegistro = false, aviso, onSalvar, onRemover,
}: AssinaturaProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracos = useRef<Ponto[][]>([]);
  const desenhando = useRef(false);
  const largura = useRef(0);

  const [temTraco, setTemTraco] = useState(false);
  const [nome, setNome] = useState(nomeInicial);
  const [registro, setRegistro] = useState(registroInicial);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const redesenhar = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = TINTA;
    ctx.fillStyle = TINTA;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of tracos.current) {
      if (t.length === 1) {
        ctx.beginPath(); ctx.arc(t[0].x, t[0].y, 1.1, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(t[0].x, t[0].y);
      for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y);
      ctx.stroke();
    }
  }, []);

  // Ajusta o quadro à largura do contêiner e ao devicePixelRatio. Redimensionar o canvas
  // apaga o desenho, então só mexe quando a largura de fato muda e redesenha os traços guardados.
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c || url) return;
    const ajustar = () => {
      const w = Math.floor(wrap.clientWidth);
      if (!w || w === largura.current) return;
      largura.current = w;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr);
      c.height = Math.round(ALTURA * dpr);
      redesenhar();
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(wrap);
    return () => { ro.disconnect(); largura.current = 0; };
  }, [url, redesenhar]);

  function ponto(e: React.PointerEvent<HTMLCanvasElement>): Ponto {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inicio(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    desenhando.current = true;
    tracos.current.push([ponto(e)]);
    setTemTraco(true);
    redesenhar();
  }
  function meio(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const atual = tracos.current[tracos.current.length - 1];
    if (!atual) return;
    atual.push(ponto(e));
    redesenhar();
  }
  function fim() { desenhando.current = false; }

  function limpar() {
    tracos.current = [];
    setTemTraco(false);
    redesenhar();
  }

  async function salvar() {
    const c = canvasRef.current;
    if (!c || !temTraco) return;
    setErro(''); setOcupado(true);
    const png = c.toDataURL('image/png').split(',')[1] || '';
    const e = await onSalvar(png, nome.trim(), registro.trim());
    setOcupado(false);
    if (e) setErro(e);
    else limpar();
  }

  async function refazer() {
    setErro(''); setOcupado(true);
    const e = await onRemover();
    setOcupado(false);
    if (e) setErro(e);
  }

  return (
    <section className="mnt-card mnt-assin">
      <h3 className="mnt-h3">{rotulo}</h3>
      {aviso && <p className="mnt-hint">{aviso}</p>}

      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mnt-assinImg" src={url} alt={rotulo} />
          <p className="mnt-assinNome">
            <Check size={16} strokeWidth={3} /> Assinatura salva{nome ? `: ${nome}` : ''}
          </p>
          <button type="button" className="mnt-btn mnt-btnGhost" disabled={ocupado} onClick={refazer}>
            <RefreshCw size={17} /> Refazer assinatura
          </button>
        </>
      ) : (
        <>
          <div className="mnt-field">
            <label className="mnt-label">Nome de quem assina</label>
            <input className="mnt-input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
          </div>
          {comRegistro && (
            <div className="mnt-field">
              <label className="mnt-label">Registro (CREA, CFT ou CRT)</label>
              <input className="mnt-input" value={registro} onChange={(e) => setRegistro(e.target.value)} maxLength={60} />
            </div>
          )}
          <div className="mnt-quadroWrap" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              className="mnt-quadro"
              style={{ height: ALTURA }}
              aria-label={`Quadro para desenhar: ${rotulo}`}
              onPointerDown={inicio}
              onPointerMove={meio}
              onPointerUp={fim}
              onPointerCancel={fim}
            />
            {!temTraco && <span className="mnt-quadroDica">Assine aqui com o dedo</span>}
          </div>
          <div className="mnt-linha2">
            <button type="button" className="mnt-btn mnt-btnGhost" onClick={limpar} disabled={!temTraco || ocupado}>
              <Eraser size={17} /> Limpar
            </button>
            <button type="button" className="mnt-btn mnt-btnPrimary" onClick={salvar} disabled={!temTraco || !nome.trim() || ocupado}>
              <Check size={17} strokeWidth={2.6} /> {ocupado ? 'Salvando...' : 'Salvar assinatura'}
            </button>
          </div>
        </>
      )}
      {erro && <p className="mnt-erro" role="alert">{erro}</p>}
    </section>
  );
}
