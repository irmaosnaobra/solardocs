// Textos do link rastreado da proposta (aberturas e validade). Horário sempre de Brasília.
//
// Não usa o brasilia.ts de propósito: ele só entende "Z" ou "+hh:mm" e trata o resto como UTC,
// então um ISO com "-03:00" (que é o que a api devolve na validade) virava data inválida.

const FUSO = 'America/Sao_Paulo';
const DATA_NO_INICIO = /^(\d{4})-(\d{2})-(\d{2})/;
const TEM_FUSO = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

// Instante em ms. Texto com fuso (Z, +hh:mm, -hh:mm) vale como está; sem fuso, vale UTC. Inválido vira NaN.
function instante(iso: string): number {
  let base = iso.trim().replace(' ', 'T');
  if (base.length === 10) base += 'T00:00:00';
  const completo = TEM_FUSO.test(base.replace(DATA_NO_INICIO, '')) ? base : `${base}Z`;
  return new Date(completo).getTime();
}

function partesBrasilia(ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).forEach((p) => { out[p.type] = p.value; });
  return out;
}

function diaBrasilia(ms: number): number {
  const p = partesBrasilia(ms);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
}

/** "há 5 min", "há 2 h", "ontem" ou a data (DD/MM/AAAA). Texto inválido devolve vazio. */
export function tempoRelativo(iso: string): string {
  const ms = instante(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(1, Math.floor((Date.now() - ms) / 60000));
  const dias = Math.round((diaBrasilia(Date.now()) - diaBrasilia(ms)) / 86_400_000);
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60 && dias === 0) return `há ${Math.floor(min / 60)} h`;
  if (dias === 1) return 'ontem';
  const p = partesBrasilia(ms);
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * Data de validade do link, DD/MM/AAAA, ou vazio se não der para ler.
 * A api manda o fim do dia já em Brasília ("2026-11-11T23:59:59-03:00"): vale o dia escrito
 * nos 10 primeiros caracteres, sem passar por fuso (senão recuaria ou avançaria um dia).
 */
export function fmtExpira(valor: string): string {
  const m = DATA_NO_INICIO.exec(valor.trim());
  if (!m) return '';
  const [, a, mes, d] = m;
  if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return '';
  return `${d}/${mes}/${a}`;
}

export interface AberturaResumo {
  em: string;
  cidade?: string | null;
  uf?: string | null;
  vencida?: boolean;
}

/** "Aberta 3x · última em Goiânia-GO há 2 h · vencida". Sem cidade, omite esse pedaço. */
export function linhaDeAberturas(total: number, ultima: AberturaResumo | null | undefined): string {
  const partes = [`Aberta ${total}x`];
  if (ultima) {
    const cidade = ultima.cidade ? (ultima.uf ? `${ultima.cidade}-${ultima.uf}` : ultima.cidade) : '';
    const quando = tempoRelativo(ultima.em);
    const ultimaTxt = [cidade ? `em ${cidade}` : '', quando].filter(Boolean).join(' ');
    partes.push(ultimaTxt ? `última ${ultimaTxt}` : '');
    if (ultima.vencida) partes.push('vencida');
  }
  return partes.filter(Boolean).join(' · ');
}

/** "04/11/2026, 14:30" em Brasília. Texto inválido devolve vazio. */
export function dataHoraAbertura(iso: string): string {
  const ms = instante(iso);
  if (!Number.isFinite(ms)) return '';
  const p = partesBrasilia(ms);
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}`;
}
