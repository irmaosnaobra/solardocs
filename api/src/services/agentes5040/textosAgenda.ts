// ─────────────────────────────────────────────────────────────────────────────
// OS TEXTOS CURTOS DA AGENDA DA DUDA (puros, sem banco e sem envio). Moram aqui, e não no acoesVivo.ts, para o
// agendaEnvio.ts montar "hoje", "amanhã" e "14h30" NA HORA DO ENVIO sem puxar o resto das ações (B1d-2, correção 1).
// ─────────────────────────────────────────────────────────────────────────────

import type { Caminho } from '../agenda/solarRota';
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

// ── a ABERTURA do card do quiz solar (21/10/2026): a confirmação do horário que o cliente escolheu na página ──

/** O limite de uma bolha da agenda. */
export const MAX_BOLHA_ABERTURA = 160;

/** Os caminhos do quiz que têm bolha de abertura (o curioso não tem horário marcado). */
export type CaminhoAbertura = Extract<Caminho, 'ligacao' | 'video' | 'vistoria'>;
export const CAMINHOS_ABERTURA: readonly string[] = ['ligacao', 'video', 'vistoria'];

/** O primeiro nome limpo para a bolha: sem formatação do WhatsApp nem separador. Vazio quando não sobra letra. */
const nomeDaAbertura = (nome: string | null | undefined): string => {
  const n = primeiroNome(nome).replace(/[*_~`|]/g, '').trim();
  return /\p{L}/u.test(n) ? n : '';
};

/**
 * A bolha fixa de abertura, com {quando} já por extenso ("amanhã às 14h30"). Passou de 160: tira o nome; ainda passou: tira os
 * asteriscos; ainda passou, ou faltou consultora, ou o caminho não existe: null (quem chama não enfileira).
 */
export function textoDeAbertura(
  caminho: string | null | undefined, nome: string | null | undefined, quando: string, consultora: string,
): string | null {
  const c = primeiroNome(consultora).replace(/[*_~`|]/g, '');
  const q = String(quando ?? '').trim();
  if (!c || !q || !CAMINHOS_ABERTURA.includes(String(caminho))) return null;
  const n = nomeDaAbertura(nome);
  const monta = (comNome: boolean, a: string): string => {
    const oi = comNome && n ? `Oi, ${n}!` : 'Oi!';
    const quem = `${a}${c}${a}`;
    const hora = `${a}${q}${a}`;
    if (caminho === 'ligacao') return `${oi} Sou a Duda, da Irmãos na Obra. Já está marcado: ${quem} te liga ${hora}. É uma ligação curta para entender sua conta.`;
    if (caminho === 'video') return `${oi} Sou a Duda, da Irmãos na Obra. Marcado: ${quem} te chama por vídeo ${q}, com o estudo na tela. Responda SIM para confirmar.`;
    return `${oi} Sou a Duda, da Irmãos na Obra. Marcado: ${quem} vai aí ${q}, visita técnica de uns 40 minutos. Responda SIM para confirmar.`;
  };
  for (const [comNome, a] of [[true, '*'], [false, '*'], [false, '']] as Array<[boolean, string]>) {
    const t = monta(comNome, a);
    if (t.length <= MAX_BOLHA_ABERTURA && !/[—–]/.test(t) && !t.includes('||')) return t;
  }
  return null;
}

/** A abertura montada a partir do ISO do horário do card (Brasília, relativo a `agoraIso`). */
export const bolhaDeAbertura = (
  caminho: string | null | undefined, nome: string | null | undefined, quandoIso: string, consultora: string, agoraIso: string,
): string | null => (diaCurto(quandoIso, agoraIso) && horaPorExtenso(quandoIso)
  ? textoDeAbertura(caminho, nome, opcaoPorExtenso(quandoIso, agoraIso), consultora) : null);
