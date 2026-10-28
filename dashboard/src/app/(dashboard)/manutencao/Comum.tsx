'use client';

import { AlertTriangle, CheckCircle2, Wrench, XCircle, Loader2, Check } from 'lucide-react';
import { SELOS, type Selo } from './tipos';

export function SeloChip({ selo, grande = false }: { selo: Selo | null; grande?: boolean }) {
  if (!selo) return null;
  const Icone = selo === 'conforme' ? CheckCircle2 : selo === 'atencao' ? AlertTriangle : XCircle;
  return (
    <span className={`mnt-selo mnt-selo-${selo} ${grande ? 'mnt-seloGrande' : ''}`}>
      <Icone size={grande ? 20 : 15} strokeWidth={2.4} /> {SELOS[selo].titulo}
    </span>
  );
}

export function EstadoCarregando({ texto = 'Carregando...' }: { texto?: string }) {
  return (
    <div className="mnt-estado" role="status" aria-live="polite">
      <span className="mnt-spin mnt-spinGrande" />
      <p>{texto}</p>
    </div>
  );
}

export function EstadoMigracao() {
  return (
    <div className="mnt-estado">
      <span className="mnt-estadoIcone"><Wrench size={28} /></span>
      <h2 className="mnt-h2">A manutenção está sendo liberada.</h2>
      <p>Volte em alguns minutos.</p>
    </div>
  );
}

export function EstadoErro({ texto, onTentar }: { texto: string; onTentar?: () => void }) {
  return (
    <div className="mnt-estado" role="alert">
      <span className="mnt-estadoIcone mnt-estadoIconeErro"><AlertTriangle size={28} /></span>
      <h2 className="mnt-h2">{texto}</h2>
      {onTentar && <button type="button" className="mnt-btn mnt-btnGhost mnt-btnAuto" onClick={onTentar}>Tentar de novo</button>}
    </div>
  );
}

export type EstadoSalvar = 'salvo' | 'salvando' | 'erro';

export function Salvamento({ estado, onTentar }: { estado: EstadoSalvar; onTentar: () => void }) {
  if (estado === 'erro') {
    return (
      <button type="button" className="mnt-salvaErro" onClick={onTentar}>
        <AlertTriangle size={15} /> Não salvou. Tentar de novo
      </button>
    );
  }
  return (
    <span className={`mnt-salva ${estado === 'salvo' ? 'mnt-salvaOk' : ''}`} role="status" aria-live="polite">
      {estado === 'salvando' ? <><Loader2 size={15} className="mnt-gira" /> Salvando...</> : <><Check size={15} strokeWidth={3} /> Salvo</>}
    </span>
  );
}
