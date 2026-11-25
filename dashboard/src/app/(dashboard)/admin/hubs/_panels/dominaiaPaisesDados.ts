// Os países do público da Domina IA: nome curto, fuso e bandeira (country-flag-icons, MIT).
// Só entram aqui as bandeiras usadas; país fora da lista aparece com a sigla no lugar.
import type { HTMLAttributes, JSX } from 'react';
import AR from 'country-flag-icons/react/3x2/AR';
import BO from 'country-flag-icons/react/3x2/BO';
import BR from 'country-flag-icons/react/3x2/BR';
import CA from 'country-flag-icons/react/3x2/CA';
import CL from 'country-flag-icons/react/3x2/CL';
import CO from 'country-flag-icons/react/3x2/CO';
import CR from 'country-flag-icons/react/3x2/CR';
import CU from 'country-flag-icons/react/3x2/CU';
import DO from 'country-flag-icons/react/3x2/DO';
import EC from 'country-flag-icons/react/3x2/EC';
import ES from 'country-flag-icons/react/3x2/ES';
import GQ from 'country-flag-icons/react/3x2/GQ';
import GT from 'country-flag-icons/react/3x2/GT';
import HN from 'country-flag-icons/react/3x2/HN';
import MX from 'country-flag-icons/react/3x2/MX';
import NI from 'country-flag-icons/react/3x2/NI';
import PA from 'country-flag-icons/react/3x2/PA';
import PE from 'country-flag-icons/react/3x2/PE';
import PR from 'country-flag-icons/react/3x2/PR';
import PT from 'country-flag-icons/react/3x2/PT';
import PY from 'country-flag-icons/react/3x2/PY';
import SV from 'country-flag-icons/react/3x2/SV';
import US from 'country-flag-icons/react/3x2/US';
import UY from 'country-flag-icons/react/3x2/UY';
import VE from 'country-flag-icons/react/3x2/VE';

type Bandeira = (props: HTMLAttributes<HTMLElement & SVGElement>) => JSX.Element;
export type PaisFixo = { codigo: string; curto: string; fuso: string; Bandeira?: Bandeira };

/** O público da campanha, na ordem da lista: aparece sempre, com ou sem venda. */
export const PUBLICO: PaisFixo[] = [
  { codigo: 'MX', curto: 'México', fuso: 'America/Mexico_City', Bandeira: MX },
  { codigo: 'CO', curto: 'Colômbia', fuso: 'America/Bogota', Bandeira: CO },
  { codigo: 'CL', curto: 'Chile', fuso: 'America/Santiago', Bandeira: CL },
  { codigo: 'PE', curto: 'Peru', fuso: 'America/Lima', Bandeira: PE },
  { codigo: 'EC', curto: 'Equador', fuso: 'America/Guayaquil', Bandeira: EC },
  { codigo: 'GT', curto: 'Guatemala', fuso: 'America/Guatemala', Bandeira: GT },
  { codigo: 'CR', curto: 'Costa Rica', fuso: 'America/Costa_Rica', Bandeira: CR },
  { codigo: 'PA', curto: 'Panamá', fuso: 'America/Panama', Bandeira: PA },
  { codigo: 'DO', curto: 'R. Dominicana', fuso: 'America/Santo_Domingo', Bandeira: DO },
  { codigo: 'UY', curto: 'Uruguai', fuso: 'America/Montevideo', Bandeira: UY },
  { codigo: 'BO', curto: 'Bolívia', fuso: 'America/La_Paz', Bandeira: BO },
  { codigo: 'PY', curto: 'Paraguai', fuso: 'America/Asuncion', Bandeira: PY },
  { codigo: 'HN', curto: 'Honduras', fuso: 'America/Tegucigalpa', Bandeira: HN },
  { codigo: 'SV', curto: 'El Salvador', fuso: 'America/El_Salvador', Bandeira: SV },
];

/** Quem pode aparecer de fora do público. Entra só quando há venda ou visita; os outros vêm sem bandeira e sem hora. */
export const EXTRAS: PaisFixo[] = [
  { codigo: 'AR', curto: 'Argentina', fuso: 'America/Argentina/Buenos_Aires', Bandeira: AR },
  { codigo: 'NI', curto: 'Nicarágua', fuso: 'America/Managua', Bandeira: NI },
  { codigo: 'PR', curto: 'Porto Rico', fuso: 'America/Puerto_Rico', Bandeira: PR },
  { codigo: 'GQ', curto: 'Guiné Equat.', fuso: 'Africa/Malabo', Bandeira: GQ },
  { codigo: 'US', curto: 'Estados Unidos', fuso: 'America/New_York', Bandeira: US },
  { codigo: 'ES', curto: 'Espanha', fuso: 'Europe/Madrid', Bandeira: ES },
  { codigo: 'BR', curto: 'Brasil', fuso: 'America/Sao_Paulo', Bandeira: BR },
  { codigo: 'VE', curto: 'Venezuela', fuso: 'America/Caracas', Bandeira: VE },
  { codigo: 'CU', curto: 'Cuba', fuso: 'America/Havana', Bandeira: CU },
  { codigo: 'PT', curto: 'Portugal', fuso: 'Europe/Lisbon', Bandeira: PT },
  { codigo: 'CA', curto: 'Canadá', fuso: 'America/Toronto', Bandeira: CA },
];

export const CONHECIDOS: Record<string, PaisFixo> = Object.fromEntries(
  [...PUBLICO, ...EXTRAS].map((p) => [p.codigo, p]),
);

// ── hora local ──────────────────────────────────────────────────────────────
export type Turno = 'madrugada' | 'manha' | 'tarde' | 'noite';
export const TURNO_NOME: Record<Turno, string> = { madrugada: 'madrugada', manha: 'manhã', tarde: 'tarde', noite: 'noite' };

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(fuso: string): Intl.DateTimeFormat | null {
  if (!formatos.has(fuso)) {
    try {
      formatos.set(fuso, new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    } catch { return null; }
  }
  return formatos.get(fuso) ?? null;
}

/** 07:58 e o turno, no fuso do país. Sem fuso conhecido, null. */
export function horaLocal(fuso: string | undefined, agora: number): { hora: string; turno: Turno } | null {
  const f = fuso ? formato(fuso) : null;
  if (!f) return null;
  const partes = f.formatToParts(agora);
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const m = partes.find((p) => p.type === 'minute')?.value ?? '00';
  const turno: Turno = h < 6 ? 'madrugada' : h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
  return { hora: `${String(h).padStart(2, '0')}:${m}`, turno };
}
