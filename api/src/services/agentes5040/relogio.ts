// ─────────────────────────────────────────────────────────────────────────────
// RELÓGIO DE BRASÍLIA. O relógio do servidor é UTC; toda janela do negócio é BRT
// (UTC-3, sem horário de verão desde 2019). Nada aqui lê `new Date()` sozinho:
// quem chama passa o instante, o que deixa os testes determinísticos.
// ─────────────────────────────────────────────────────────────────────────────

import { ehFeriadoBR } from '../../utils/feriadosBR';

const TRES_HORAS_MS = 3 * 3600_000;
const p2 = (n: number): string => String(n).padStart(2, '0');

export type Instante = Date | string | number;

/** Date "deslocado": os campos getUTC* dele são a hora de parede em Brasília. */
function brt(d: Instante): Date | null {
  const t = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(String(d));
  if (!Number.isFinite(t)) return null;
  return new Date(t - TRES_HORAS_MS);
}

/** Dia em Brasília, YYYY-MM-DD. Instante inválido devolve texto vazio. */
export function diaBRT(d: Instante): string {
  const b = brt(d);
  return b ? `${b.getUTCFullYear()}-${p2(b.getUTCMonth() + 1)}-${p2(b.getUTCDate())}` : '';
}

/** Hora cheia em Brasília (0 a 23). Instante inválido devolve -1. */
export function horaBRT(d: Instante): number {
  const b = brt(d);
  return b ? b.getUTCHours() : -1;
}

/** Dia da semana em Brasília (0 = domingo). Inválido devolve -1. */
export function diaDaSemanaBRT(d: Instante): number {
  const b = brt(d);
  return b ? b.getUTCDay() : -1;
}

/** Horário em que a Nilce pode ligar agora: 8h às 18h (exclusivo), segunda a sexta, fora de feriado nacional. */
export function horarioComercial(d: Instante): boolean {
  const b = brt(d);
  if (!b) return false;
  const dow = b.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const h = b.getUTCHours();
  if (h < 8 || h >= 18) return false;
  return !ehFeriadoBR(diaBRT(d));
}

/** Carimbo "[18/09 14:32] " para a frente de cada linha da conversa. Só ISO de verdade; senão texto vazio. */
export function carimboBR(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(iso ?? ''))) return '';
  const b = brt(iso);
  if (!b) return '';
  return `[${p2(b.getUTCDate())}/${p2(b.getUTCMonth() + 1)} ${p2(b.getUTCHours())}:${p2(b.getUTCMinutes())}] `;
}

/** O dia anterior ao de `d`, em Brasília (YYYY-MM-DD). Instante inválido devolve texto vazio. */
export function ontemBRT(d: Instante): string {
  const b = brt(d);
  if (!b) return '';
  return diaBRT(new Date(b.getTime() - 86_400_000 + TRES_HORAS_MS));
}

/**
 * Os limites de um dia de Brasília como instantes ISO: `desde` é a meia-noite local (inclusive) e `ate` é um
 * milissegundo antes da seguinte. Texto que não é AAAA-MM-DD devolve null.
 */
export function janelaDoDiaBRT(dia: string): { desde: string; ate: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia ?? ''))) return null;
  const inicio = Date.parse(`${dia}T00:00:00.000Z`);
  if (!Number.isFinite(inicio) || diaBRT(inicio + TRES_HORAS_MS) !== dia) return null;
  const desde = inicio + TRES_HORAS_MS;
  return { desde: new Date(desde).toISOString(), ate: new Date(desde + 86_400_000 - 1).toISOString() };
}
