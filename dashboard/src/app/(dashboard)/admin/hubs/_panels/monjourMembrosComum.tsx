'use client';

// Peças pequenas da sub-aba Membros do Monjour: o plano em selo, a nota de uso e o "há 3 dias".
import r from './MonjourResumo.module.css';
import m from './MonjourMembros.module.css';
import type { Membro } from './hubMonjourJornadas.types';

const TZ = 'America/Sao_Paulo';
const diaSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

/** "hoje 08:12", "ontem 21:40", "há 4 dias", ou a data quando passa de 30 dias. */
export function fmtRelativo(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dias = Math.round((Date.parse(diaSP(agora)) - Date.parse(diaSP(d))) / 86_400_000);
  if (dias <= 0) return `hoje ${hora}`;
  if (dias === 1) return `ontem ${hora}`;
  if (dias <= 30) return `há ${dias} dias`;
  return d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function PlanoMembro({ x }: { x: Membro }) {
  if (x.cortesia) return <span className={`${r.selo} ${r.seloAtencao}`}>Cortesia</span>;
  if (x.plano === 'plus') return <span className={`${r.selo} ${r.seloPlus}`}>Plus</span>;
  if (x.plano === 'basico') return <span>Básico</span>;
  if (x.plano) return <span>{x.plano}</span>;
  return <span className={r.mudo}>Sem compra</span>;
}

/** A nota de 0 a 100 com um medidor curto ao lado. */
export function NotaUso({ nota }: { nota: number }) {
  const v = Math.max(0, Math.min(100, Math.round(nota)));
  return (
    <span className={m.nota}>
      <b>{v}</b>
      <span className={m.notaTrilho} aria-hidden="true"><span style={{ width: `${v}%` }} /></span>
    </span>
  );
}

export const nomeTipoReceita = (t?: string) =>
  ({ desayuno: 'café da manhã', almuerzo: 'almoço', cena: 'jantar', antojo: 'lanche' } as Record<string, string>)[t ?? ''] ?? t ?? '';
