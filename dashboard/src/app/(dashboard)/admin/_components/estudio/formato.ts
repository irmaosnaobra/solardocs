import type { Conta, Episodio, FabricaId, Metricas, Rede, Situacao, Snapshot } from './tipos';
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

// ── Versão 2: várias fábricas ───────────────────────────────────────────────

const ORDEM_PADRAO: Record<FabricaId, number> = { 'dentro-da-guerra': 1, 'irmaos-na-obra': 2, youtube: 3 };

export function idFabrica(f: Snapshot): FabricaId {
  return f.fabricaId ?? 'dentro-da-guerra';
}

export function nomeFabrica(f: Snapshot): string {
  return f.fabricaNome ?? f.serie.nome;
}

export function ordenarFabricas(lista: Snapshot[]): Snapshot[] {
  return [...lista].sort((a, b) => (a.ordem ?? ORDEM_PADRAO[idFabrica(a)] ?? 9) - (b.ordem ?? ORDEM_PADRAO[idFabrica(b)] ?? 9));
}

/** Contas da fábrica: o campo novo, senão as redes do snapshot antigo. */
export function contasFabrica(f: Snapshot): Conta[] {
  if (f.contas) return f.contas;
  return f.redes.map((r) => ({ rede: r.rede, handle: r.conta, url: r.url, seguidores: r.seguidores ?? undefined }));
}

export function horariosFabrica(f: Snapshot): string[] {
  if (f.horarios) return f.horarios;
  return f.serie.horario ? [f.serie.horario] : [];
}

export function situacaoFabrica(f: Snapshot): Situacao {
  return f.situacao ?? (f.serie.automatico ? 'no-ar' : 'pausada');
}

/** Item da pauta em ISO com o fuso de Brasília. */
export function isoPauta(i: { dia: string; hora: string }): string {
  return `${i.dia}T${i.hora}:00-03:00`;
}

const fmtSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short' });
const fmtDiaMes = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const fmtChave = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** { semana: "sex", data: "20/11" } de um 'YYYY-MM-DD'. */
export function partesDia(diaIso: string): { semana: string; data: string } {
  const d = new Date(`${diaIso}T12:00:00-03:00`);
  return { semana: fmtSemana.format(d).replace('.', ''), data: fmtDiaMes.format(d) };
}

/** 'YYYY-MM-DD' de hoje em Brasília. */
export function hojeChave(agora: number): string {
  return fmtChave.format(new Date(agora));
}

export interface ProximoPost { quando: string; titulo: string; linha?: string }

/** Próximo post da fábrica: programação, senão pauta, senão episódios agendados. */
export function proximoPost(f: Snapshot, agora: number): ProximoPost | null {
  const futuro = (iso: string) => new Date(iso).getTime() > agora;
  const prog = (f.programacao ?? [])
    .filter((p) => futuro(p.quando) && Object.values(p.redes).some((st) => st === 'agendado' || st === 'em-producao'))
    .sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime())[0];
  if (prog) return { quando: prog.quando, titulo: prog.titulo, linha: prog.linha };
  const pauta = (f.pauta?.itens ?? [])
    .filter((i) => i.etapa !== 'publicado' && futuro(isoPauta(i)))
    .sort((a, b) => isoPauta(a).localeCompare(isoPauta(b)))[0];
  if (pauta) return { quando: isoPauta(pauta), titulo: pauta.tema, linha: pauta.linha };
  const ep = agendados(f.episodios, agora).find((e) => futuro(e.quando));
  return ep ? { quando: ep.quando, titulo: ep.titulo } : null;
}

/** Vídeos da pauta que já passaram da avaliação (agendado ou publicado). */
export function prontosPauta(f: Snapshot): number {
  return (f.pauta?.itens ?? []).filter((i) => i.etapa === 'agendado' || i.etapa === 'publicado').length;
}

export const NOME_ETAPA: Record<string, string> = {
  fatos: 'Fatos',
  roteiro: 'Roteiro',
  voz: 'Voz',
  visual: 'Visual',
  avaliacao: 'Avaliação',
  agendado: 'Agendado',
  publicado: 'Publicado',
};

/** "8,9" */
export function nota(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Próximo episódio agendado (o mais cedo no futuro, ou o mais cedo de todos os agendados). */
export function agendados(eps: Episodio[], agora: number): Episodio[] {
  return eps
    .filter((e) => e.estado === 'agendado' || REDES.some((r) => e.redes[r]?.status === 'agendado'))
    .filter((e) => new Date(e.quando).getTime() > agora - 60 * 60000)
    .sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
}
