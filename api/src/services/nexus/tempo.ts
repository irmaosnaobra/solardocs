// Datas do Portal do Parceiro em horário de Brasília. O relógio da máquina está em UTC, então "o dia", "o mês" e
// "o ano" não podem sair de getUTC* nem de toISOString().slice(): perto da meia-noite (e da virada do ano) erram.
// Brasília não tem horário de verão desde 2019: é UTC-3 fixo.

const BRT_MS = 3 * 60 * 60 * 1000;

/** Partes de calendário de Brasília para o instante dado. */
export function partesBRT(d: Date = new Date()): { ano: number; mes: number; dia: number } {
  const x = new Date(d.getTime() - BRT_MS);
  return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1, dia: x.getUTCDate() };
}

export function anoBRT(d: Date = new Date()): number {
  return partesBRT(d).ano;
}

/** AAAA-MM-DD em Brasília. */
export function diaBRT(d: Date = new Date()): string {
  const { ano, mes, dia } = partesBRT(d);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Instante (UTC) em que o mês corrente de Brasília começou. */
export function inicioMesBRT(d: Date = new Date()): Date {
  const { ano, mes } = partesBRT(d);
  return new Date(Date.UTC(ano, mes - 1, 1) + BRT_MS);
}

/** Instante (UTC) da meia-noite de Brasília do dia AAAA-MM-DD, ou null se o texto não é uma data. */
export function inicioDiaBRT(dia: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t + BRT_MS);
  return Number.isNaN(d.getTime()) || diaBRT(d) !== dia ? null : d;
}

/** "dd/mm/aaaa às HH:MM" em Brasília, para texto de e-mail e de tela. Sem Intl: o relógio da máquina está em UTC. */
export function formatarBRT(d: Date | string): string {
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return '';
  const x = new Date(t.getTime() - BRT_MS);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(x.getUTCDate())}/${dois(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} às ${dois(x.getUTCHours())}:${dois(x.getUTCMinutes())}`;
}
