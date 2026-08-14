import api from './api';

// Cliente do PlugCash. Usa o MESMO axios do SolarDoc: mesma base (/_api em
// produção) e o mesmo Bearer do cookie `solardoc_token` — quem já está logado no
// SolarDoc já chega logado aqui, que é a regra do projeto.

// Uma página da aula ilustrada. `svg` é o diagrama inline — é o que substitui
// o parágrafo, não o que decora. Tudo é opcional menos título: a página se monta
// com o que tiver.
export type Pagina = {
  ordem: number;
  titulo: string;
  texto?: string;
  lista?: string[];
  svg?: string;
  legenda?: string;
  /** A frase que a pessoa leva da página. Uma por página, no máximo. */
  destaque?: string;
};

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
  // CONTEÚDO PAGO: só vem de GET /aula/:id, depois da checagem de acesso.
  paginas?: Pagina[];
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
    checkout_bump_url?: string;
    bump_texto?: string;
    // Slug do serviço que resolve a mesma dor. O preço vem de pc_servicos, não
    // daqui — preço duplicado desatualiza e a página anuncia valor que o
    // checkout não cobra mais.
    servico_slug?: string;
    servico_nota?: string;
    // Política de crédito de abatimento — uma frase só, igual em todos os cursos.
    credito?: string;
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
  preview?: boolean;
  admin?: boolean;
  membro: Membro;
  catalogo: Curso[];
  proximo_passo: { curso: Curso; porque: 'motivo_descarte' | 'objetivo' | 'ordem' } | null;
};

export type Servico = {
  id: string;
  slug: string;
  titulo: string;
  descricao: string | null;
  preco_centavos: number;
  checkout_url: string | null;
  capacidade_mensal: number | null;
  resolve_motivo: string[];
  nivel_exigido: string | null;
  ordem: number;
  status?: string;
  entrega: string | null;
  prazo_dias: number | null;
  copy?: { inclui?: string[]; nao_inclui?: string[] };
  // calculados pela API
  capacidade_usada?: number;
  disponivel?: boolean;
  vagas_restantes?: number | null;
  liberado_pelo_nivel?: boolean;
  prioritario?: boolean;
};

// A oferta que uma aula específica justifica. Uma só, e só quando a pessoa
// ainda não tem o item — quem comprou o Ponto Zero não vê "compre o Ponto Zero".
export type Oferta = {
  tipo: 'servico' | 'curso';
  slug: string;
  titulo: string;
  subtitulo?: string | null;
  descricao?: string | null;
  preco_centavos: number;
  checkout_url: string | null;
  entrega?: string | null;
  prazo_dias?: number | null;
};

export type Compra = {
  id: string;
  item_tipo: string;
  item_slug: string;
  valor_centavos: number;
  status: string;
  created_at: string;
};

export type ContaResposta = {
  usuario: { email: string; nome: string | null; whatsapp: string | null } | null;
  membro: {
    nivel: string;
    objetivo: string | null;
    motivo_descarte: string[];
    resolveu_em: string | null;
    resolveu_o_que: string[];
  };
  compras: Compra[];
  credito_centavos: number;
  creditos: { id: string; valor_centavos: number; validade: string | null }[];
};

export type GatewayProduto = {
  id: string;
  gateway: string;
  produto_id: string | null;
  produto_nome: string | null;
  item_tipo: string;
  item_slug: string;
  concede_nivel: string | null;
  gera_credito: boolean;
  ativo: boolean;
};

export type Elegivel = {
  user_id: string;
  telefone: string | null;
  nivel: string;
  nota: number | null;
  motivo_descarte: string[] | null;
  resolveu_o_que: string[] | null;
  resolveu_em: string;
  cidade: string | null;
  usuario: { id: string; email: string; nome: string | null; whatsapp: string | null } | null;
};

// `?preview=1` faz o rascunho aparecer — mas quem decide é o servidor, que
// confere o token e lê `is_admin` do banco. O parâmetro aqui é só o pedido.
const pv = (preview?: boolean) => (preview ? '?preview=1' : '');

export const plugcashApi = {
  catalogo: (preview?: boolean) =>
    api.get<{ cursos: Curso[]; preview: boolean }>(`/plugcash/catalogo${pv(preview)}`),
  curso: (slug: string, preview?: boolean) =>
    api.get<{ curso: Curso; servico: Servico | null; preview: boolean }>(
      `/plugcash/curso/${slug}${pv(preview)}`),
  me: (preview?: boolean) => api.get<MeResposta>(`/plugcash/me${pv(preview)}`),
  onboarding: (objetivo: string) => api.post('/plugcash/onboarding', { objetivo }),
  aula: (id: string, preview?: boolean) =>
    api.get<{ aula: Aula; oferta: Oferta | null }>(`/plugcash/aula/${id}${pv(preview)}`),
  progresso: (aula_id: string, pct: number) => api.post('/plugcash/progresso', { aula_id, pct }),
  resolvi: (motivos: string[]) => api.post('/plugcash/resolvi', { motivos }),
  // telemetria do funil — nunca deve derrubar navegação, por isso engole o erro
  evento: (tipo: string, payload?: unknown) =>
    api.post('/plugcash/evento', { tipo, payload }).catch(() => {}),

  servicos: (preview?: boolean) =>
    api.get<{ servicos: Servico[]; preview: boolean }>(`/plugcash/servicos${pv(preview)}`),
  conta: () => api.get<ContaResposta>('/plugcash/conta'),
  obrigado: (slug: string) => api.get<{ curso: Curso | null }>(`/plugcash/obrigado/${slug}`),

  adminCursos: () => api.get<{ cursos: Curso[] }>('/plugcash/admin/cursos'),
  adminServicos: () => api.get<{ servicos: Servico[] }>('/plugcash/admin/servicos'),
  adminSalvarServico: (s: Partial<Servico> & { id?: string }) =>
    api.post<{ servico: Servico }>('/plugcash/admin/servicos', s),
  adminGateway: () => api.get<{ produtos: GatewayProduto[] }>('/plugcash/admin/gateway'),
  adminSalvarGateway: (p: Partial<GatewayProduto> & { id?: string }) =>
    api.post<{ produto: GatewayProduto }>('/plugcash/admin/gateway', p),
  adminRemoverGateway: (id: string) => api.delete(`/plugcash/admin/gateway/${id}`),
  adminReagendar: () => api.get<{ elegiveis: Elegivel[] }>('/plugcash/admin/reagendar'),
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
  // "fechado" e não "definido": desde 14/08 este slug também cobre quem tem um local
  // em vista mas ainda não conversou com o dono — dizer que ele "não tem ponto" seria
  // desmentir a resposta que ele deu no formulário.
  sem_ponto:   'ainda não fechou o ponto',
  sem_capital: 'o capital ainda não está disponível',
  nao_decisor: 'a decisão não é só sua',
  fluxo_baixo: 'o local não traz fluxo próprio',
};
