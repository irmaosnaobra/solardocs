// ─────────────────────────────────────────────────────────────────────────────
// DEPOIMENTOS DA LANDING (dashboard/src/components/Landing/Landing.tsx), por perfil.
//
// A FALA NÃO ENTRA AQUI, de propósito: a agente nunca escreve a fala de um
// depoimento. Ela só pode mandar o CARD em imagem (JPG 1080x1080), e os 11 cards
// existem em dashboard/public/depoimentos/. Depoimento sem arquivo (cardArquivo =
// null) não pode ser enviado.
// ─────────────────────────────────────────────────────────────────────────────

export type Regiao = 'norte' | 'nordeste' | 'centro-oeste' | 'sudeste' | 'sul';

export interface Depoimento {
  slug: string;
  nome: string;
  empresa: string;
  cidade: string;
  uf: string;
  regiao: Regiao;
  /** Arquivo em dashboard/public/depoimentos/, ou null se o card ainda não existe. */
  cardArquivo: string | null;
}

const REGIAO_DA_UF: Record<string, Regiao> = {
  AC: 'norte', AP: 'norte', AM: 'norte', PA: 'norte', RO: 'norte', RR: 'norte', TO: 'norte',
  AL: 'nordeste', BA: 'nordeste', CE: 'nordeste', MA: 'nordeste', PB: 'nordeste', PE: 'nordeste',
  PI: 'nordeste', RN: 'nordeste', SE: 'nordeste',
  DF: 'centro-oeste', GO: 'centro-oeste', MT: 'centro-oeste', MS: 'centro-oeste',
  ES: 'sudeste', MG: 'sudeste', RJ: 'sudeste', SP: 'sudeste',
  PR: 'sul', RS: 'sul', SC: 'sul',
};

export const regiaoDaUF = (uf: string | null | undefined): Regiao | null =>
  REGIAO_DA_UF[String(uf ?? '').trim().toUpperCase()] ?? null;

const d = (slug: string, nome: string, empresa: string, cidade: string, uf: string, cardArquivo: string | null = null): Depoimento =>
  ({ slug, nome, empresa, cidade, uf, regiao: REGIAO_DA_UF[uf]!, cardArquivo });

export const DEPOIMENTOS: readonly Depoimento[] = [
  d('juliano-grilo-energia', 'Juliano Grilo', 'Grilo Energia Solar', 'Artur Nogueira', 'SP', 'card-juliano-grilo-energia.jpg'),
  d('vanderlei-american-energy', 'Vanderlei', 'American Energy Solar', 'Rondonópolis', 'MT', 'card-vanderlei-american-energy.jpg'),
  d('lucas-rsc-solar', 'Lucas Paulino', 'RSC Solar', 'Londrina', 'PR', 'card-lucas-rsc-solar.jpg'),
  d('alessandro-forca-solar', 'Alessandro Goulart', 'Força Solar', 'Feliz', 'RS', 'card-alessandro-forca-solar.jpg'),
  d('gsi-energia-solar', 'GSI Energia Solar', '', 'Unaí', 'MG', 'card-gsi-energia-solar.jpg'),
  d('ronailson-alves-cardoso', 'Ronailson Klesley', 'Alves Cardoso Solar', 'Abreulândia', 'TO', 'card-ronailson-alves-cardoso.jpg'),
  d('vicente-vff-energia', 'Vicente', 'VFF Energia Solar', 'Campinas', 'SP', 'card-vicente-vff-energia.jpg'),
  d('antonio-exxel-solar', 'Antônio Henrique', 'Exxel Solar', 'Xique-Xique', 'BA', 'card-antonio-exxel-solar.jpg'),
  d('eduardo-eclipse-solar', 'Eduardo Boso', 'Eclipse Solar', 'Sarandi', 'PR', 'card-eduardo-eclipse-solar.jpg'),
  d('carlos-vs-solar', 'Carlos Vinícius', 'VS Solar Energia Solar', 'Piripiri', 'PI', 'card-carlos-vs-solar.jpg'),
  d('gedalih-energia-solar', 'Gedalih Energia Solar', '', 'Varginha', 'MG', 'card-gedalih-energia-solar.jpg'),
];

export const MAX_DEPOIMENTOS_POR_CONVERSA = 2;

const norm = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Cards que a agente pode mandar, do mais parecido com o lead ao menos: mesma cidade,
 * mesmo estado, mesma região, o resto. Só os que têm arquivo. `jaEnviados` (slugs) saem.
 */
export function cardsParaLead(
  perfil: { cidade?: string | null; uf?: string | null },
  jaEnviados: readonly string[] = [],
): Depoimento[] {
  const cidade = norm(perfil.cidade);
  const uf = String(perfil.uf ?? '').trim().toUpperCase();
  const regiao = regiaoDaUF(uf);
  const nota = (x: Depoimento): number =>
    cidade && norm(x.cidade) === cidade ? 0 : uf && x.uf === uf ? 1 : regiao && x.regiao === regiao ? 2 : 3;
  return DEPOIMENTOS
    .filter(x => x.cardArquivo && !jaEnviados.includes(x.slug))
    .map((x, i) => ({ x, i }))
    .sort((a, b) => nota(a.x) - nota(b.x) || a.i - b.i)
    .map(({ x }) => x);
}
