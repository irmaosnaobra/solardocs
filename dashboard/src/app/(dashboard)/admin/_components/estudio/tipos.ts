// Contrato do GET /admin/estudio (versão 1). Métrica null = ainda sem dado.

export type Rede = 'instagram' | 'youtube' | 'tiktok';
export const REDES: Rede[] = ['instagram', 'youtube', 'tiktok'];

export type StatusPost = 'publicado' | 'agendado' | 'pendente' | 'erro' | 'ausente';
export type EstadoEpisodio = 'publicado' | 'agendado' | 'parcial';

export interface Metricas {
  views: number | null;
  curtidas: number | null;
  comentarios: number | null;
}

export interface PostRede extends Metricas {
  status: StatusPost;
  link: string | null;
}

export interface Episodio {
  slug: string;
  numero: number;
  titulo: string;
  quando: string;
  estado: EstadoEpisodio;
  capaUrl: string | null;
  redes: Partial<Record<Rede, PostRede>>;
}

export interface ContaRede {
  rede: Rede;
  conta: string;
  url: string;
  seguidores: number | null;
  ligada: boolean;
  via: string;
}

export interface Etapa {
  id: string;
  nome: string;
}

export interface Totais {
  views: number;
  curtidas: number;
  comentarios: number;
  porRede: Partial<Record<Rede, { views: number; curtidas: number; comentarios: number }>>;
}

export interface Snapshot {
  versao: number;
  atualizadoEm: string;
  serie: { nome: string; horario: string; automatico: boolean };
  redes: ContaRede[];
  fabrica: { etapas: Etapa[] };
  episodios: Episodio[];
  totais: Totais;
}

export interface RespostaEstudio {
  snapshot: Snapshot | null;
  atualizadoEm?: string | null;
}
