// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS CURTOS DA AGENDA DA DUDA (puros, sem banco e sem envio). Moram aqui, e não no acoesVivo.ts, para o
// agendaEnvio.ts montar "hoje", "amanhã" e "14h30" NA HORA DO ENVIO sem puxar o resto das ações (B1d-2, correção 1).
// ─────────────────────────────────────────────────────────────────────────────

import { horaPorExtenso } from './personas/comum';
import { diaBRT, diaDaSemanaBRT, horaBRT } from './relogio';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

const minutoBRT = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t - 3 * 3_600_000).getUTCMinutes() : -1;
};

export const primeiroNome = (nome: string | null | undefined): string => String(nome ?? '').trim().split(/\s+/)[0] ?? '';

/** hoje | amanhã | "quinta, 23/10" (Brasília, relativo a `agoraIso`). */
export function diaCurto(iso: string, agoraIso: string): string {
  const dia = diaBRT(iso);
  if (!dia) return '';
  const hoje = diaBRT(agoraIso);
  if (dia === hoje) return 'hoje';
  if (hoje && dia === diaBRT(Date.parse(agoraIso) + 24 * 3_600_000)) return 'amanhã';
  const [, mes, dd] = dia.split('-');
  return `${DIAS[diaDaSemanaBRT(iso)]}, ${dd}/${mes}`;
}

/** Os campos das bolhas de confirma e remarca: { dia, hora, consultora }. */
export function camposDeHorario(iso: string, agoraIso: string, dono: string): { dia: string; hora: string; consultora: string } {
  return { dia: diaCurto(iso, agoraIso), hora: horaPorExtenso(iso), consultora: primeiroNome(dono) };
}

/** "amanhã às 9h" (a bolha de volta). Curto de propósito: o quandoPorExtenso estouraria os 160 caracteres. */
export const opcaoPorExtenso = (iso: string, agoraIso: string): string => `${diaCurto(iso, agoraIso)} às ${horaPorExtenso(iso)}`;

/**
 * A fala cita a HORA do horário marcado? Aceita "14h30", "14:30", "14h 30" e, nas horas cheias, "14h", "14:00", "14 horas".
 * "4h30" não vale por 14h30 e "14h" não vale por 14h30. Sem o horário legível, false.
 */
export function citaAHora(texto: string | null | undefined, iso: string): boolean {
  const h = horaBRT(iso);
  const m = minutoBRT(iso);
  if (h < 0 || m < 0) return false;
  const t = String(texto ?? '');
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const hora = h < 10 ? `0?${h}` : hh;
  const partes = [String.raw`${hora}\s?h\s?${mm}`, `${hora}:${mm}`];
  if (m === 0) partes.push(String.raw`${hora}\s?h(?!\s?\d)`, String.raw`${hora}\s?horas?\b`);
  return new RegExp(String.raw`(?<![\d:])(?:${partes.join('|')})(?!\d)`, 'i').test(t);
}
