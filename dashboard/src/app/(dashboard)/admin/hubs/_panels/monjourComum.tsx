'use client';

// Peças comuns do painel do funil Monjour: formatos, o (?) dos títulos e o cartão de número.
import { useSyncExternalStore } from 'react';
import InfoHint from '@/components/InfoHint/InfoHint';
import s from './MonjourFunilPanel.module.css';

export const TIPO: Record<string, string> = {
  info: 'texto', multipla: 'múltipla', numero: 'número', campo: 'campo', email: 'e-mail',
  carregando: 'carregando', oferta: 'oferta',
};
// Barras dos gráficos: a jamaica da marca Monjour (7,1:1 no branco).
export const COR_BARRA = '#9C2C48';

// ── formatos ────────────────────────────────────────────────────────────────
export const fmtInt = (n: number) => n.toLocaleString('pt-BR');
export const fmtPct = (n: number, d: number, casas = 0) => {
  if (!d) return '—';
  const v = (n / d) * 100;
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: v > 0 && v < 10 ? casas : 0, maximumFractionDigits: v > 0 && v < 10 ? casas : 0 })}%`;
};
export const fmtUsd = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'USD' });
export const fmtTempo = (seg: number | null) => {
  if (seg === null || !Number.isFinite(seg)) return '—';
  const t = Math.round(seg);
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60), r = t % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
};
const TZ = 'America/Sao_Paulo';
export function fmtData(iso: string | null, comHora = false): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!comHora) return dia;
  return `${dia} às ${d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`;
}
export function fmtHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

// Celular: o gráfico de dia e hora encolhe o eixo. Lido sem pintar diferente do servidor.
const ESTREITO = '(max-width: 760px)';
export function useEstreito(): boolean {
  return useSyncExternalStore(
    (avisar) => { const m = window.matchMedia(ESTREITO); m.addEventListener('change', avisar); return () => m.removeEventListener('change', avisar); },
    () => window.matchMedia(ESTREITO).matches,
    () => false,
  );
}

// ── peças pequenas ──────────────────────────────────────────────────────────
export function Titulo({ children, dica }: { children: React.ReactNode; dica: React.ReactNode }) {
  return (
    <h3 className={s.blocoTitulo}>
      {children}
      <InfoHint>{dica}</InfoHint>
    </h3>
  );
}

export function Numero({ rotulo, valor, sub, compra }: { rotulo: string; valor: string; sub?: string; compra?: boolean }) {
  return (
    <div className={`${s.numero} ${compra ? s.numeroCompra : ''}`}>
      <div className={s.numeroRotulo}>{rotulo}</div>
      <div className={s.numeroValor}>{valor}</div>
      {sub && <div className={s.numeroSub}>{sub}</div>}
    </div>
  );
}

export const conv = (l: { compras: number; sessoes: number }) => (l.sessoes ? l.compras / l.sessoes : 0);
