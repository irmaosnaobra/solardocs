import api from './api';

// Cliente do PlugCash. Usa o MESMO axios do SolarDoc: mesma base (/_api em
// produção) e o mesmo Bearer do cookie `solardoc_token` — quem já está logado no
// SolarDoc já chega logado aqui, que é a regra do projeto.

export type Aula = {
  id: string;
  curso_id: string;
  ordem: number;
  titulo: string;
  descricao: string | null;
  duracao_seg: number | null;
  gratuita: boolean;
  video_url?: string | null;
  material_url?: string | null;
  status?: string;
  progresso?: { pct: number; concluida: boolean } | null;
};

export type Curso = {
  id: string;
  slug: string;
  titulo: string;
  subtitulo: string | null;
  descricao: string | null;
  thumb_url: string | null;
  preco_centavos: number;
  preco_de_centavos: number | null;
  parcelas: number;
  checkout_url?: string | null;
  nivel_exigido: string | null;
  resolve_motivo: string[];
  ordem: number;
  status?: string;
  indexavel?: boolean;
  copy: {
    dor?: string[];
    entregas?: string[];
    para_quem?: string[];
    nao_e_para?: string[];
    faq?: { p: string; r: string }[];
    garantia?: string;
    video_url?: string;
  };
  aulas: Aula[];
  // só vêm do /me (visão do aluno)
  liberado?: boolean;
  trava?: 'preco' | 'nivel' | null;
  progresso_pct?: number;
};

export type Membro = {
  nivel: string;
  objetivo: string | null;
  nota: number | null;
  motivo_descarte: string[];
  onboarding_pendente: boolean;
};

export type MeResposta = {
  membro: Membro;
  catalogo: Curso[];
  proximo_passo: { curso: Curso; porque: 'motivo_descarte' | 'objetivo' | 'ordem' } | null;
};

export const plugcashApi = {
  catalogo: () => api.get<{ cursos: Curso[] }>('/plugcash/catalogo'),
  curso: (slug: string) => api.get<{ curso: Curso }>(`/plugcash/curso/${slug}`),
  me: () => api.get<MeResposta>('/plugcash/me'),
  onboarding: (objetivo: string) => api.post('/plugcash/onboarding', { objetivo }),
  aula: (id: string) => api.get<{ aula: Aula }>(`/plugcash/aula/${id}`),
  progresso: (aula_id: string, pct: number) => api.post('/plugcash/progresso', { aula_id, pct }),
  resolvi: (motivos: string[]) => api.post('/plugcash/resolvi', { motivos }),
  // telemetria do funil — nunca deve derrubar navegação, por isso engole o erro
  evento: (tipo: string, payload?: unknown) =>
    api.post('/plugcash/evento', { tipo, payload }).catch(() => {}),

  adminCursos: () => api.get<{ cursos: Curso[] }>('/plugcash/admin/cursos'),
  adminSalvarCurso: (curso: Partial<Curso> & { id?: string }) =>
    api.post<{ curso: Curso }>('/plugcash/admin/cursos', curso),
  adminSalvarAula: (aula: Partial<Aula> & { id?: string }) =>
    api.post<{ aula: Aula }>('/plugcash/admin/aulas', aula),
  adminRemoverAula: (id: string) => api.delete(`/plugcash/admin/aulas/${id}`),
  adminMetricas: () => api.get('/plugcash/admin/metricas'),
};

// ── Formatação ──────────────────────────────────────────────────────────────
// Preço mora no banco em centavos; a tela nunca calcula preço, só formata.
export const money = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const duracao = (seg: number | null) => {
  if (!seg) return '';
  const m = Math.round(seg / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

// Rótulo humano do que faltou na régua do eletroposto. Estes quatro slugs são os
// mesmos que o banco grava em `motivo_descarte` (ver ep_motivos no gerador).
export const MOTIVO_LABEL: Record<string, string> = {
  sem_ponto:   'ainda não tem o ponto definido',
  sem_capital: 'o capital ainda não está disponível',
  nao_decisor: 'a decisão não é só sua',
  fluxo_baixo: 'o local não traz fluxo próprio',
};
