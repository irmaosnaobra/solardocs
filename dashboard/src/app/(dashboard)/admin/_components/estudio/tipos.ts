// Contrato do GET /admin/estudio. Versão 1 (uma fábrica) mais os campos opcionais da
// versão 2 (várias fábricas). Métrica null = ainda sem dado.

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

// ── Versão 2: várias fábricas. Tudo opcional e só acrescenta. ─────────────────
export type FabricaId = 'dentro-da-guerra' | 'irmaos-na-obra' | 'youtube';
export type Situacao = 'no-ar' | 'em-montagem' | 'pausada';
export type Linha = 'solar' | 'energia' | 'historia' | 'eletroposto' | 'guerra';
export type StatusProgramado = 'em-producao' | 'agendado' | 'publicado' | 'falhou';

export interface Conta {
  rede: Rede;
  handle: string;
  url?: string;
  seguidores?: number;
}

export interface Programado {
  /** ISO com fuso -03:00 */
  quando: string;
  slug: string;
  titulo: string;
  capaUrl?: string;
  linha?: string;
  redes: Partial<Record<Rede, StatusProgramado>>;
  link?: string;
}

export interface ItemPauta {
  dia: string;
  hora: string;
  slug: string;
  tema: string;
  linha: string;
  etapa: string;
  nota?: number;
  capaUrl?: string;
}

export interface Pauta {
  /** 'YYYY-MM-DD', 1º dia da semana */
  semana: string;
  etapas: string[];
  itens: ItemPauta[];
}

export interface Personagem {
  nome?: string;
  imagemUrl?: string;
  descricao?: string;
}

export interface Plano {
  formato: string;
  cadencia: string;
  objetivo: string;
  esqueleto: { minuto: string; bloco: string }[];
  marcos: { titulo: string; feito: boolean }[];
  referencias: { canal: string; idioma: string; inscritos: number; mediaViews: number }[];
  riscos: string[];
}

export interface Snapshot {
  versao: number;
  atualizadoEm: string;
  serie: { nome: string; horario: string; automatico: boolean };
  redes: ContaRede[];
  fabrica: { etapas: Etapa[] };
  episodios: Episodio[];
  totais: Totais;
  fabricaId?: FabricaId;
  fabricaNome?: string;
  ordem?: number;
  situacao?: Situacao;
  contas?: Conta[];
  horarios?: string[];
  programacao?: Programado[];
  pauta?: Pauta;
  personagem?: Personagem;
  plano?: Plano;
}

export interface RespostaEstudio {
  snapshot: Snapshot | null;
  atualizadoEm?: string | null;
  /** Versão 2: uma por fábrica com snapshot gravado, já em ordem. */
  fabricas?: Snapshot[];
}
