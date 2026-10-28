'use client';

import { useRef } from 'react';
import { Camera, Image as ImagemIcon, ImageOff, X } from 'lucide-react';
import { LIMITE_FOTOS_GRUPO } from './tipos';

export interface FotoLocal {
  cid: string;
  path?: string;
  url?: string | null;
  preview?: string;
  uploading?: boolean;
  erro?: boolean;
}

export default function FotosGrupo({
  rotulo, fotos, onAdd, onRemove,
}: {
  rotulo: string;
  fotos: FotoLocal[];
  onAdd: (files: File[]) => void;
  onRemove: (foto: FotoLocal) => void;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const cheio = fotos.length >= LIMITE_FOTOS_GRUPO;

  function pegou(files: FileList | null) {
    if (files && files.length) onAdd(Array.from(files));
  }

  return (
    <div className="mnt-fotos">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { pegou(e.target.files); e.target.value = ''; }} />
      <input ref={galeria} type="file" accept="image/*" multiple hidden
        onChange={(e) => { pegou(e.target.files); e.target.value = ''; }} />

      {fotos.length > 0 && (
        <div className="mnt-galeria">
          {fotos.map((f) => (
            <div key={f.cid} className={`mnt-foto ${f.erro ? 'mnt-fotoErro' : ''}`}>
              {(f.url || f.preview) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview || f.url || undefined} alt={rotulo} />
              ) : (f.path && !f.uploading && !f.erro) ? (
                <div className="mnt-fotoSemUrl" role="img" aria-label={`Foto de ${rotulo} sem miniatura`}>
                  <ImageOff size={20} aria-hidden />
                  <span>Sem miniatura</span>
                </div>
              ) : null}
              {f.uploading && <div className="mnt-fotoSobe"><span className="mnt-spin" /></div>}
              {f.erro && <div className="mnt-fotoFalhou">Não subiu</div>}
              {!f.uploading && (
                <button type="button" className="mnt-fotoDel" aria-label={`Apagar foto de ${rotulo}`}
                  onClick={() => onRemove(f)}>
                  <span><X size={14} strokeWidth={3} /></span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mnt-linha2">
        <button type="button" className="mnt-btn mnt-btnGhost" disabled={cheio} onClick={() => cam.current?.click()}>
          <Camera size={18} /> Tirar foto
        </button>
        <button type="button" className="mnt-btn mnt-btnGhost" disabled={cheio} onClick={() => galeria.current?.click()}>
          <ImagemIcon size={18} /> Da galeria
        </button>
      </div>
      {cheio && <p className="mnt-hint">Limite de {LIMITE_FOTOS_GRUPO} fotos neste grupo.</p>}
    </div>
  );
}
