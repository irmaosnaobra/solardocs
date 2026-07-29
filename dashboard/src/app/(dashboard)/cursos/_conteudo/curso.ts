// Estrutura do curso: módulos → lições, XP, níveis e conquistas.
// O CONTEÚDO em si vive nos outros arquivos de _conteudo/ — aqui só a camada de
// jornada por cima dele. Progresso é gravado em kit_progresso por chave de lição
// (ex.: 'objecoes:preco'); nível, XP e conquistas são DERIVADOS dessas chaves,
// então nada disso precisa de tabela nova.

import { OBJECOES } from './objecoes';
import { ROTEIRO } from './roteiro';
import { PROSPECCAO } from './prospeccao';
import { POS_VENDA } from './posvenda';

export type TipoLicao = 'leitura' | 'pratica' | 'ferramenta';

export type Licao = {
  id: string;
  titulo: string;
  resumo: string;
  minutos: number;
  xp: number;
  tipo: TipoLicao;
};

export type ModuloCurso = {
  slug: string;
  numero: number;
  titulo: string;
  subtitulo: string;
  /** Nome do ícone lucide usado na trilha */
  icone: 'MessageSquareQuote' | 'Map' | 'Calculator' | 'FileSignature' | 'Send' | 'Repeat';
  cor: string;
  bonusXp: number;
  pdf?: string;
  licoes: Licao[];
};

const XP = { leitura: 100, ferramenta: 120, pratica: 150 } as const;

export const CURSO = {
  slug: 'kit-fechamento',
  nome: 'Kit de Fechamento do Integrador',
  chamada: 'O que dizer, na ordem, quando o cliente empaca',
  descricao:
    'Da primeira mensagem para um lead frio até a indicação depois da obra pronta. Cada lição termina com uma fala pronta que você usa na próxima visita.',
};

export const MODULOS: ModuloCurso[] = [
  {
    slug: 'objecoes',
    numero: 1,
    titulo: 'As objeções que travam a venda',
    subtitulo: 'A resposta pronta para as 26 frases que aparecem depois da proposta',
    icone: 'MessageSquareQuote',
    cor: '#f7a41c',
    bonusXp: 200,
    pdf: 'modulo-1-objecoes.pdf',
    licoes: OBJECOES.map((g) => ({
      id: `objecoes:${g.slug}`,
      titulo: g.titulo,
      resumo: `${g.itens.length} ${g.itens.length === 1 ? 'objeção' : 'objeções'} com fala pronta e versão de WhatsApp`,
      minutos: Math.max(4, Math.round(g.itens.length * 1.6)),
      xp: XP.leitura,
      tipo: 'leitura' as TipoLicao,
    })),
  },
  {
    slug: 'roteiro',
    numero: 2,
    titulo: 'Da primeira ligação à assinatura',
    subtitulo: 'O caminho inteiro da visita, etapa por etapa',
    icone: 'Map',
    cor: '#5cb8f7',
    bonusXp: 200,
    pdf: 'modulo-2-roteiro-da-visita.pdf',
    licoes: [
      {
        id: 'roteiro:etapas',
        titulo: 'As 6 etapas da visita',
        resumo: `De qualificar por telefone ao pós-assinatura, com a armadilha de cada etapa`,
        minutos: 9,
        xp: XP.leitura,
        tipo: 'leitura',
      },
      {
        id: 'roteiro:perguntas',
        titulo: 'As 5 perguntas para o cliente fazer',
        resumo: 'A lista que você entrega para ele comparar orçamentos — inclusive o seu',
        minutos: 4,
        xp: XP.ferramenta,
        tipo: 'ferramenta',
      },
    ],
  },
  {
    slug: 'preco',
    numero: 3,
    titulo: 'Preço e margem sem chute',
    subtitulo: 'Saber quanto sobra antes de dar desconto',
    icone: 'Calculator',
    cor: '#4ade80',
    bonusXp: 200,
    pdf: 'modulo-3-preco-e-margem.pdf',
    licoes: [
      {
        id: 'preco:custo',
        titulo: 'Para onde vai cada real',
        resumo: 'As 8 linhas de custo do projeto e a faixa de referência de cada uma',
        minutos: 6,
        xp: XP.leitura,
        tipo: 'leitura',
      },
      {
        id: 'preco:regras',
        titulo: 'Quatro regras que protegem a margem',
        resumo: 'O que fazer quando o cliente pede desconto — sem sair do seu bolso',
        minutos: 5,
        xp: XP.leitura,
        tipo: 'leitura',
      },
      {
        id: 'preco:planilha',
        titulo: 'Sua planilha de precificação',
        resumo: 'Baixe, preencha seus custos e veja o preço com a sua margem embutida',
        minutos: 7,
        xp: XP.ferramenta,
        tipo: 'ferramenta',
      },
    ],
  },
  {
    slug: 'documentos',
    numero: 4,
    titulo: 'Contrato, procuração e vistoria',
    subtitulo: 'Os documentos que fecham o negócio, com a sua marca',
    icone: 'FileSignature',
    cor: '#c084fc',
    bonusXp: 250,
    licoes: [
      {
        id: 'documentos:gerar',
        titulo: 'Gere seu primeiro contrato',
        resumo: 'Missão prática: cadastre a empresa e emita um documento com o seu CNPJ e a sua logo',
        minutos: 10,
        xp: XP.pratica,
        tipo: 'pratica',
      },
    ],
  },
  {
    slug: 'prospeccao',
    numero: 5,
    titulo: 'Prospecção e follow-up',
    subtitulo: 'Mensagem pronta para copiar, colar e mandar',
    icone: 'Send',
    cor: '#38bdf8',
    bonusXp: 200,
    pdf: 'modulo-5-prospeccao.pdf',
    licoes: PROSPECCAO.map((b) => ({
      id: `prospeccao:${b.slug}`,
      titulo: b.titulo,
      resumo: `${b.mensagens.length} mensagens com o momento certo de usar`,
      minutos: Math.max(4, b.mensagens.length * 2),
      xp: XP.leitura,
      tipo: 'leitura' as TipoLicao,
    })),
  },
  {
    slug: 'posvenda',
    numero: 6,
    titulo: 'Pós-venda, garantia e recorrência',
    subtitulo: 'Transformar uma venda em três',
    icone: 'Repeat',
    cor: '#fb7185',
    bonusXp: 250,
    pdf: 'modulo-6-pos-venda.pdf',
    licoes: [
      {
        id: 'posvenda:janelas',
        titulo: `As ${POS_VENDA.length} janelas depois do sim`,
        resumo: 'O que fazer nas 48h, na obra, na primeira conta, na manutenção e na ampliação',
        minutos: 8,
        xp: XP.leitura,
        tipo: 'leitura',
      },
      {
        id: 'posvenda:garantias',
        titulo: 'As três garantias, separadas',
        resumo: 'O que é do fabricante, o que é da assistência e o que é seu — no papel',
        minutos: 5,
        xp: XP.leitura,
        tipo: 'leitura',
      },
    ],
  },
];

export const TODAS_LICOES = MODULOS.flatMap((m) => m.licoes);
export const XP_TOTAL =
  TODAS_LICOES.reduce((s, l) => s + l.xp, 0) + MODULOS.reduce((s, m) => s + m.bonusXp, 0);
export const MINUTOS_TOTAL = TODAS_LICOES.reduce((s, l) => s + l.minutos, 0);

// ── Níveis ──────────────────────────────────────────────────────────────────
// `icone` é nome de ícone lucide (mesma família do resto do app) — nada de
// emoji colorido, que destoa da interface.
export type NomeIcone =
  | 'Sprout' | 'Zap' | 'Flame' | 'Crown'
  | 'Target' | 'ShieldCheck' | 'Map' | 'Coins' | 'FileCheck2' | 'Send' | 'Repeat' | 'Trophy';

export type Nivel = { nome: string; de: number; icone: NomeIcone; descricao: string };

export const NIVEIS: Nivel[] = [
  { nome: 'Aprendiz', de: 0, icone: 'Sprout', descricao: 'Começou a montar o repertório' },
  { nome: 'Vendedor', de: 700, icone: 'Zap', descricao: 'Já tem resposta para o que mais aparece' },
  { nome: 'Fechador', de: 1600, icone: 'Flame', descricao: 'Conduz a visita inteira sem improviso' },
  { nome: 'Mestre do Fechamento', de: 2600, icone: 'Crown', descricao: 'Domina da prospecção à indicação' },
];

export function nivelPorXp(xp: number): { atual: Nivel; proximo: Nivel | null; faltam: number; pct: number } {
  let idx = 0;
  for (let i = 0; i < NIVEIS.length; i++) if (xp >= NIVEIS[i].de) idx = i;
  const atual = NIVEIS[idx];
  const proximo = NIVEIS[idx + 1] ?? null;
  const faltam = proximo ? proximo.de - xp : 0;
  const base = atual.de;
  const teto = proximo ? proximo.de : Math.max(xp, 1);
  const pct = proximo ? Math.min(100, Math.round(((xp - base) / (teto - base)) * 100)) : 100;
  return { atual, proximo, faltam, pct };
}

// ── Conquistas (derivadas do progresso, sem tabela nova) ────────────────────
export type Conquista = {
  id: string;
  nome: string;
  icone: NomeIcone;
  comoGanha: string;
  ganhou: (feitos: Set<string>) => boolean;
};

const moduloCompleto = (slug: string) => (feitos: Set<string>) => {
  const m = MODULOS.find((x) => x.slug === slug);
  return !!m && m.licoes.every((l) => feitos.has(l.id));
};

export const CONQUISTAS: Conquista[] = [
  {
    id: 'primeira',
    nome: 'Primeira lição',
    icone: 'Target',
    comoGanha: 'Concluir qualquer lição',
    ganhou: (f) => TODAS_LICOES.some((l) => f.has(l.id)),
  },
  {
    id: 'escudo',
    nome: 'Escudo anti-objeção',
    icone: 'ShieldCheck',
    comoGanha: 'Concluir o módulo 1 inteiro',
    ganhou: moduloCompleto('objecoes'),
  },
  {
    id: 'roteirista',
    nome: 'Visita sem improviso',
    icone: 'Map',
    comoGanha: 'Concluir o módulo 2 inteiro',
    ganhou: moduloCompleto('roteiro'),
  },
  {
    id: 'margem',
    nome: 'Margem protegida',
    icone: 'Coins',
    comoGanha: 'Concluir o módulo 3 inteiro',
    ganhou: moduloCompleto('preco'),
  },
  {
    id: 'documento',
    nome: 'Documento com a sua marca',
    icone: 'FileCheck2',
    comoGanha: 'Fazer a missão prática do módulo 4',
    ganhou: (f) => f.has('documentos:gerar'),
  },
  {
    id: 'prospector',
    nome: 'Agenda cheia',
    icone: 'Send',
    comoGanha: 'Concluir o módulo 5 inteiro',
    ganhou: moduloCompleto('prospeccao'),
  },
  {
    id: 'recorrencia',
    nome: 'Cliente que volta',
    icone: 'Repeat',
    comoGanha: 'Concluir o módulo 6 inteiro',
    ganhou: moduloCompleto('posvenda'),
  },
  {
    id: 'completo',
    nome: 'Kit completo',
    icone: 'Trophy',
    comoGanha: 'Concluir as 17 lições do curso',
    ganhou: (f) => TODAS_LICOES.every((l) => f.has(l.id)),
  },
];

// ── Cálculo do progresso ────────────────────────────────────────────────────
export type Progresso = {
  feitos: Set<string>;
  xp: number;
  licoesFeitas: number;
  pctCurso: number;
  modulosCompletos: number;
  conquistas: Conquista[];
  /** Próxima lição a fazer — é o que o botão "Continuar" abre */
  proxima: { modulo: ModuloCurso; licao: Licao } | null;
};

export function calcularProgresso(chaves: string[]): Progresso {
  const feitos = new Set(chaves);
  let xp = 0;
  let licoesFeitas = 0;
  let modulosCompletos = 0;

  for (const m of MODULOS) {
    let todas = true;
    for (const l of m.licoes) {
      if (feitos.has(l.id)) { xp += l.xp; licoesFeitas++; } else { todas = false; }
    }
    if (todas) { xp += m.bonusXp; modulosCompletos++; }
  }

  let proxima: Progresso['proxima'] = null;
  for (const m of MODULOS) {
    const l = m.licoes.find((x) => !feitos.has(x.id));
    if (l) { proxima = { modulo: m, licao: l }; break; }
  }

  return {
    feitos,
    xp,
    licoesFeitas,
    pctCurso: Math.round((licoesFeitas / TODAS_LICOES.length) * 100),
    modulosCompletos,
    conquistas: CONQUISTAS.filter((c) => c.ganhou(feitos)),
    proxima,
  };
}
