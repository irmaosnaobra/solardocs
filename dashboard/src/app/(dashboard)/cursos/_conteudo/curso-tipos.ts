// ═══════════════════════════════════════════════════════════════════════════
// A CASCA DOS CURSOS — tipos e todo o cálculo (XP, níveis, conquistas, progresso).
//
// Fica separado do registro (cursos.config.ts) de propósito: o arquivo de cada
// curso importa DAQUI, e o registro importa os cursos. Se tudo morasse junto,
// curso → config → curso viraria dependência circular e o build quebra.
//
// Regras que valem para TODO curso:
//  1. O conteúdo mora na plataforma. Nada de arquivo para baixar: o aluno entra,
//     lê e marca. É isso que faz ele voltar e ver o resto do produto.
//  2. Cada módulo declara sua conquista; cada lição, seu XP e tempo.
//  3. Os 4 níveis são proporcionais ao XP total do curso (0/25/55/85%), então
//     mudar o conteúdo não quebra a escada de progressão.
//  4. Ícones são lucide — sem emoji.
// Passo a passo em COMO-ADICIONAR-CURSO.md.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoLicao = 'leitura' | 'pratica' | 'ferramenta';

/** Ícones lucide liberados para curso (precisam estar no mapa da página). */
export type NomeIcone =
  | 'MessageSquareQuote' | 'Map' | 'Calculator' | 'FileSignature' | 'Send' | 'Repeat'
  | 'Sprout' | 'Zap' | 'Flame' | 'Crown'
  | 'Target' | 'ShieldCheck' | 'Coins' | 'FileCheck2' | 'Trophy'
  | 'Wrench' | 'Lightbulb' | 'Users' | 'ClipboardCheck' | 'TrendingUp';

export type Licao = {
  /** Chave gravada em kit_progresso. Formato: 'modulo:licao' */
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
  icone: NomeIcone;
  cor: string;
  bonusXp: number;
  /** Conquista que o aluno ganha ao completar o módulo inteiro */
  conquista: { nome: string; icone: NomeIcone };
  licoes: Licao[];
};

export type Curso = {
  slug: string;
  nome: string;
  descricao: string;
  /** Nomes dos 4 níveis, do mais baixo ao mais alto. Opcional: há um padrão. */
  niveis?: [string, string, string, string];
  modulos: ModuloCurso[];
};

/** XP por tipo de lição — a mesma régua em todos os cursos. */
export const XP_POR_TIPO: Record<TipoLicao, number> = {
  leitura: 100,
  ferramenta: 120,
  pratica: 150,
};

// ── Derivações ──────────────────────────────────────────────────────────────
export const licoesDo = (c: Curso): Licao[] => c.modulos.flatMap((m) => m.licoes);

export const xpTotalDo = (c: Curso): number =>
  licoesDo(c).reduce((s, l) => s + l.xp, 0) + c.modulos.reduce((s, m) => s + m.bonusXp, 0);

export const minutosDo = (c: Curso): number => licoesDo(c).reduce((s, l) => s + l.minutos, 0);

// ── Níveis ──────────────────────────────────────────────────────────────────
const NOMES_PADRAO: [string, string, string, string] = ['Aprendiz', 'Praticante', 'Avançado', 'Mestre'];
const ICONES_NIVEL: NomeIcone[] = ['Sprout', 'Zap', 'Flame', 'Crown'];
const DESCRICOES_NIVEL = [
  'Começou a montar o repertório',
  'Já tem resposta para o que mais aparece',
  'Conduz o processo inteiro sem improviso',
  'Domina do começo ao fim',
];
/** Frações do XP total em que cada nível começa. */
const CORTES = [0, 0.25, 0.55, 0.85];

export type Nivel = { nome: string; icone: NomeIcone; descricao: string; de: number };

export function niveisDo(c: Curso): Nivel[] {
  const total = xpTotalDo(c);
  const nomes = c.niveis ?? NOMES_PADRAO;
  return CORTES.map((f, i) => ({
    nome: nomes[i],
    icone: ICONES_NIVEL[i],
    descricao: DESCRICOES_NIVEL[i],
    de: Math.round((total * f) / 50) * 50, // arredonda em 50 pra ficar redondo na tela
  }));
}

export function nivelPorXp(c: Curso, xp: number): {
  atual: Nivel; proximo: Nivel | null; faltam: number; pct: number;
} {
  const niveis = niveisDo(c);
  let idx = 0;
  for (let i = 0; i < niveis.length; i++) if (xp >= niveis[i].de) idx = i;
  const atual = niveis[idx];
  const proximo = niveis[idx + 1] ?? null;
  const faltam = proximo ? proximo.de - xp : 0;
  const teto = proximo ? proximo.de : Math.max(xp, 1);
  const pct = proximo ? Math.min(100, Math.round(((xp - atual.de) / (teto - atual.de)) * 100)) : 100;
  return { atual, proximo, faltam, pct };
}

// ── Conquistas ──────────────────────────────────────────────────────────────
// Geradas a partir dos módulos: "primeira lição" + uma por módulo + "curso
// completo". Curso novo ganha as conquistas sem escrever uma linha a mais.
export type Conquista = {
  id: string;
  nome: string;
  icone: NomeIcone;
  comoGanha: string;
  ganhou: (feitos: Set<string>) => boolean;
};

export function conquistasDo(c: Curso): Conquista[] {
  const licoes = licoesDo(c);
  return [
    {
      id: 'primeira',
      nome: 'Primeira lição',
      icone: 'Target',
      comoGanha: 'Concluir qualquer lição',
      ganhou: (f) => licoes.some((l) => f.has(l.id)),
    },
    ...c.modulos.map((m) => ({
      id: `modulo-${m.slug}`,
      nome: m.conquista.nome,
      icone: m.conquista.icone,
      comoGanha: `Concluir o módulo ${m.numero} inteiro`,
      ganhou: (f: Set<string>) => m.licoes.every((l) => f.has(l.id)),
    })),
    {
      id: 'completo',
      nome: 'Curso completo',
      icone: 'Trophy',
      comoGanha: `Concluir as ${licoes.length} lições`,
      ganhou: (f) => licoes.every((l) => f.has(l.id)),
    },
  ];
}

// ── Progresso ───────────────────────────────────────────────────────────────
export type Progresso = {
  feitos: Set<string>;
  xp: number;
  licoesFeitas: number;
  pctCurso: number;
  modulosCompletos: number;
  conquistas: Conquista[];
  proxima: { modulo: ModuloCurso; licao: Licao } | null;
};

export function calcularProgresso(c: Curso, chaves: string[]): Progresso {
  const feitos = new Set(chaves);
  let xp = 0;
  let licoesFeitas = 0;
  let modulosCompletos = 0;

  for (const m of c.modulos) {
    let todas = true;
    for (const l of m.licoes) {
      if (feitos.has(l.id)) { xp += l.xp; licoesFeitas++; } else { todas = false; }
    }
    if (todas) { xp += m.bonusXp; modulosCompletos++; }
  }

  let proxima: Progresso['proxima'] = null;
  for (const m of c.modulos) {
    const l = m.licoes.find((x) => !feitos.has(x.id));
    if (l) { proxima = { modulo: m, licao: l }; break; }
  }

  const total = licoesDo(c).length;
  return {
    feitos,
    xp,
    licoesFeitas,
    pctCurso: total ? Math.round((licoesFeitas / total) * 100) : 0,
    modulosCompletos,
    conquistas: conquistasDo(c).filter((q) => q.ganhou(feitos)),
    proxima,
  };
}
