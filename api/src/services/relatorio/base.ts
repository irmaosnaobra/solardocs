// Base compartilhada dos relatórios (vistoria e manutenção): escape de HTML, texto e datas em
// horário de Brasília. Módulo PURO: sem banco, sem logger, sem rede. Os templates importam este
// arquivo, então nada aqui pode puxar supabase nem logger (os renders e os testes de HTML
// dependem disso).

/** Escapa & < > " ' (o apóstrofo vira &#39;). Aceita qualquer valor; null e undefined viram ''. */
export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Primeira letra visível em maiúscula; o resto do texto fica como veio. */
export function ucfirst(s: unknown): string {
  const t = String(s ?? '');
  const i = t.search(/\S/);
  if (i < 0) return t;
  return t.slice(0, i) + t.charAt(i).toUpperCase() + t.slice(i + 1);
}

const RETICENCIAS = '…';

/**
 * Corta o texto em no máximo `n` caracteres, contando as reticências (U+2026) quando cortar.
 * Conta por caractere inteiro, então nunca parte um emoji ao meio. Nulo vira ''.
 */
export function cortar(s: unknown, n: number): string {
  const t = String(s ?? '').trim();
  if (!(n >= 1)) return '';
  const limite = Math.floor(n);
  const letras = Array.from(t);
  if (letras.length <= limite) return t;
  return letras.slice(0, limite - 1).join('').trimEnd() + RETICENCIAS;
}

// ── Datas em America/Sao_Paulo ──────────────────────────────────────────────

const FUSO = 'America/Sao_Paulo';
const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const COM_HORA = /^\d{4}-\d{2}-\d{2}[T ]/;

type Instante = string | Date | null | undefined;

let formato: Intl.DateTimeFormat | null = null;

/** Data de calendário "2026-10-27" (sem hora): não há fuso para aplicar, só confere se o dia existe. */
function dataDeCalendario(texto: string): string {
  const m = SO_DATA.exec(texto.trim());
  if (!m) return '';
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const existe = d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  return existe ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Texto ISO com hora, ou Date. Nulo, vazio, lixo e dia que não existe (30 de fevereiro) viram null. */
function instante(v: Instante): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!COM_HORA.test(t) || !dataDeCalendario(t.slice(0, 10))) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function partes(v: Instante): { dia: string; mes: string; ano: string; hora: string; minuto: string } | null {
  const d = instante(v);
  if (!d) return null;
  if (!formato) {
    // hourCycle h23: a meia-noite sai "00", nunca "24".
    formato = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
  const o: Record<string, string> = {};
  for (const p of formato.formatToParts(d)) o[p.type] = p.value;
  return { dia: o.day ?? '', mes: o.month ?? '', ano: o.year ?? '', hora: o.hour ?? '', minuto: o.minute ?? '' };
}

/** "27/10/2026". Data inválida devolve ''. Texto só com a data ("2026-10-27") sai sem mexer no dia. */
export function dataBR(iso: Instante): string {
  const p = partes(iso);
  if (p) return `${p.dia}/${p.mes}/${p.ano}`;
  return typeof iso === 'string' ? dataDeCalendario(iso) : '';
}

/** "14:12". Data inválida, ou sem hora, devolve ''. */
export function horaBR(iso: Instante): string {
  const p = partes(iso);
  return p ? `${p.hora}:${p.minuto}` : '';
}

/** "27/10/2026 às 14:12". Sem hora no texto, devolve só a data. Data inválida devolve ''. */
export function dataHoraAs(iso: Instante): string {
  const p = partes(iso);
  if (p) return `${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}`;
  return dataBR(iso);
}

// ── Links e códigos ─────────────────────────────────────────────────────────

/** Link público do relatório: /v/{id} (vistoria) ou /m/{id} (manutenção). Lê DASHBOARD_URL a cada chamada. */
export function urlPublica(prefixo: 'v' | 'm', id: string): string {
  const base = (process.env.DASHBOARD_URL || '').trim().replace(/\/+$/, '') || 'https://solardoc.app';
  return `${base}/${prefixo}/${id}`;
}

/** "VT-11111111": os 8 primeiros caracteres do id da vistoria, em maiúscula. */
export function codigoVistoria(id: string): string {
  return 'VT-' + String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
}
