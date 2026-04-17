// Horário de Brasília — UTC-3 fixo (sem dependência de TZ do runtime/browser)

export function toBrasilia(iso: string): Date {
  // TIMESTAMP columns return no TZ suffix — browser parses as local time.
  // Force UTC by appending Z before subtracting 3h.
  const utc = iso.includes('+') || iso.endsWith('Z') ? iso : iso.trim().replace(' ', 'T') + 'Z';
  return new Date(new Date(utc).getTime() - 3 * 3600 * 1000);
}

export function nowBrasilia(): Date {
  return new Date(Date.now() - 3 * 3600 * 1000);
}

export function fmtDateTimeBR(iso: string): string {
  const d = toBrasilia(iso);
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  const mo   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh   = String(d.getUTCHours()).padStart(2, '0');
  const mm   = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${yyyy}, ${hh}:${mm}`;
}

export function fmtDateBR(iso: string): string {
  const d = toBrasilia(iso);
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  const mo   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mo}/${yyyy}`;
}

export function daysDiffBR(iso: string): number {
  const a  = toBrasilia(iso);
  const b  = nowBrasilia();
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((db - da) / 86_400_000);
}
