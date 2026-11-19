import type { Episodio, Metricas, Rede } from './tipos';
import { REDES } from './tipos';

const TZ = 'America/Sao_Paulo';
const inteiro = new Intl.NumberFormat('pt-BR');
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** Número com milhar. null vira "–", nunca 0. */
export function num(n: number | null | undefined): string {
  return n == null ? '–' : inteiro.format(n);
}

/** Número curto (12,3 mil) para espaço apertado. */
export function numCurto(n: number | null | undefined): string {
  if (n == null) return '–';
  return n < 10000 ? inteiro.format(n) : compacto.format(n);
}

export const NOME_REDE: Record<Rede, string> = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };

const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** "sáb 21/11" */
export function dia(iso: string): string {
  return fmtDia.format(new Date(iso)).replace('.', '').replace(',', '');
}

/** "19:00" */
export function hora(iso: string): string {
  return fmtHora.format(new Date(iso));
}

/** "há 4 min", "há 2 h", "agora". */
export function haQuanto(iso: string, agora: number): string {
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

/** "em 2 d 4 h", "em 35 min", "agora". */
export function emQuanto(iso: string, agora: number): string {
  const min = Math.round((new Date(iso).getTime() - agora) / 60000);
  if (min <= 0) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `em ${h} h ${min % 60} min`;
  return `em ${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Soma das métricas de um episódio nas redes. Fica null se nenhuma rede tem o dado. */
export function totalEpisodio(ep: Episodio): Metricas {
  const soma = (k: keyof Metricas) => {
    let t: number | null = null;
    for (const r of REDES) {
      const v = ep.redes[r]?.[k];
      if (v != null) t = (t ?? 0) + v;
    }
    return t;
  };
  return { views: soma('views'), curtidas: soma('curtidas'), comentarios: soma('comentarios') };
}

/** Próximo episódio agendado (o mais cedo no futuro, ou o mais cedo de todos os agendados). */
export function agendados(eps: Episodio[], agora: number): Episodio[] {
  return eps
    .filter((e) => e.estado === 'agendado' || REDES.some((r) => e.redes[r]?.status === 'agendado'))
    .filter((e) => new Date(e.quando).getTime() > agora - 60 * 60000)
    .sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
}
