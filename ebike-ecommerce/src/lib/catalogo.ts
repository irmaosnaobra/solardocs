/**
 * O catálogo como as telas consomem.
 *
 * Duas saídas, de propósito:
 *  - `catalogoPublico()`  -> sem custo, sem margem. É o que vai para o navegador.
 *  - `catalogoInterno()`  -> com custo e margem. Só o painel usa, e o painel é
 *                            renderizado no servidor atrás de senha.
 *
 * `server-only` no topo é a trava: se um componente de cliente importar este
 * arquivo (direta ou indiretamente), o build falha em vez de publicar a margem
 * dentro do JS da página.
 */

import 'server-only';
import { unstable_cache } from 'next/cache';

import reserva from '../data/snapshot.json';
import { buscarCatalogoNacional } from './montarCatalogo.ts';
import type { Base } from './montarCatalogo.ts';
import type { BikeNormalizada } from './normalizar.ts';
import { enderecoInterno } from './fotos.ts';
import { margemDoItem, precoDeVenda } from './preco.ts';
import type {
  Bike,
  BikeInterna,
  Cartao,
  Catalogo,
  CatalogoInterno,
  MetaCatalogo,
} from '../types/bike.ts';

export const TAG_CATALOGO = 'catalogo';

/** De quanto em quanto tempo a loja relê o fornecedor. Padrão: uma vez por dia. */
const SEGUNDOS_ENTRE_LEITURAS = Number(process.env.CATALOGO_REVALIDA_SEGUNDOS ?? 86400);

type Bruto = {
  bikes: BikeNormalizada[];
  bases: Base[];
  lidoEm: string;
  logado: boolean;
  cd: string;
  secao: string;
};

function daReserva(erro: string): Bruto & { origem: 'reserva'; erro: string } {
  const r = reserva as unknown as Bruto;
  return { ...r, origem: 'reserva', erro };
}

/**
 * Durante o BUILD, o catálogo sai da cópia de reserva. Nunca do fornecedor.
 *
 * O build reparte as 46 páginas entre sete processos, e `unstable_cache` não
 * atravessa processo: cada um refazia a leitura das 22 bases ao mesmo tempo.
 * São ~800 chamadas ao fornecedor num piscar, ele segura, e toda página estoura
 * o teto de 60 segundos — o build inteiro cai. Com uma base só a leitura levava
 * 2 segundos e isso nunca apareceu.
 *
 * Não é perda de frescor: `npm run sync` grava a reserva imediatamente antes de
 * publicar, e no ar a página volta a ler ao vivo na primeira revalidação.
 */
const NO_BUILD = process.env.NEXT_PHASE === 'phase-production-build';

const lerFornecedor = unstable_cache(
  async (): Promise<Bruto & { origem: 'ao-vivo' | 'reserva'; erro?: string }> => {
    if (NO_BUILD) return daReserva('Build: catálogo da cópia de reserva, por escolha.');
    try {
      const vivo = await buscarCatalogoNacional();
      if (vivo.bikes.length === 0) {
        return daReserva('O fornecedor respondeu, mas não veio nenhuma bike.');
      }
      return { ...vivo, origem: 'ao-vivo' };
    } catch (e) {
      return daReserva(e instanceof Error ? e.message : String(e));
    }
  },
  ['catalogo-soollar'],
  { tags: [TAG_CATALOGO], revalidate: SEGUNDOS_ENTRE_LEITURAS },
);

function paraInterna(b: BikeNormalizada): BikeInterna {
  const custo = b.custoEmReais ?? 0;
  return {
    id: b.id,
    slug: b.slug,
    codigo: b.codigo,
    titulo: b.titulo,
    nomeOriginal: b.nomeOriginal,
    marca: b.marca,
    linha: b.linha,
    cor: b.cor,
    categoria: b.categoria,
    potencia: b.potencia,
    bateria: b.bateria,
    autonomia: b.autonomia,
    velocidade: b.velocidade,
    recarga: b.recarga,
    ficha: b.ficha,
    // Passa pelo nosso /foto: o endereço do CDN entregaria o fornecedor.
    imagens: b.imagens.map(enderecoInterno),
    preco: precoDeVenda(custo),
    estoque: b.estoque,
    disponivel: b.disponivel,
    previsao: b.previsao,
    pesoKg: b.pesoKg,
    volumeM3: b.volumeM3,
    bases: b.bases,
    custo,
    margem: margemDoItem(custo),
    origemDoCusto: b.origemDoCusto,
  };
}

/**
 * Tira do objeto tudo que não pode atravessar para o navegador. É cópia por
 * campo, não `delete`: campo novo em `BikeInterna` só aparece na loja se for
 * escrito aqui de propósito.
 */
function paraPublica(b: BikeInterna): Bike {
  return {
    id: b.id,
    slug: b.slug,
    codigo: b.codigo,
    titulo: b.titulo,
    nomeOriginal: b.nomeOriginal,
    marca: b.marca,
    linha: b.linha,
    cor: b.cor,
    categoria: b.categoria,
    potencia: b.potencia,
    bateria: b.bateria,
    autonomia: b.autonomia,
    velocidade: b.velocidade,
    recarga: b.recarga,
    ficha: b.ficha,
    imagens: b.imagens,
    preco: b.preco,
    estoque: b.estoque,
    disponivel: b.disponivel,
    previsao: b.previsao,
    pesoKg: b.pesoKg,
    volumeM3: b.volumeM3,
    bases: b.bases,
  };
}

export async function catalogoInterno(): Promise<CatalogoInterno> {
  const bruto = await lerFornecedor();
  const bikes = bruto.bikes.map(paraInterna).sort((a, b) => a.preco - b.preco);
  const meta: MetaCatalogo = {
    atualizadoEm: bruto.lidoEm,
    origem: bruto.origem,
    logado: bruto.logado,
    cd: bruto.cd,
    secao: bruto.secao,
    total: bikes.length,
    ...(bruto.erro ? { erro: bruto.erro } : {}),
  };
  return { bikes, meta };
}

export async function catalogoPublico(): Promise<Catalogo> {
  const { bikes, meta } = await catalogoInterno();
  return { bikes: bikes.map(paraPublica), meta };
}

/** Recorta a bike para o que a listagem realmente usa. */
export function paraCartao(b: Bike): Cartao {
  return {
    id: b.id,
    slug: b.slug,
    codigo: b.codigo,
    titulo: b.titulo,
    marca: b.marca,
    linha: b.linha,
    cor: b.cor,
    categoria: b.categoria,
    potencia: b.potencia,
    autonomia: b.autonomia,
    velocidade: b.velocidade,
    preco: b.preco,
    estoque: b.estoque,
    previsao: b.previsao,
    bases: b.bases,
    capa: b.imagens[0] ?? '',
  };
}

/**
 * As bases do fornecedor, com coordenada. A vitrine mede distância com elas.
 *
 * A COORDENADA VEM DA CÓPIA DE RESERVA, não da leitura ao vivo. Ao vivo, a
 * montagem resolve os 22 CEPs no mesmo instante; em produção 21 voltaram vazios
 * e o dia inteiro ficou congelado no cache com UMA base no mapa — resultado: em
 * Uberlândia a loja anunciava que toda bike vinha do Paraná.
 *
 * Endereço de galpão não muda de um dia para o outro, então a lista boa é a que
 * o `npm run sync` gravou. A leitura ao vivo ainda vale para o texto (nome,
 * cidade) e para revelar base nova: ela entra sem coordenada e passa a medir
 * distância no próximo sync.
 */
export async function basesDoCatalogo(): Promise<Base[]> {
  const gravadas = ((reserva as unknown as { bases?: Base[] }).bases ?? []).filter(
    (b) => b.lat !== null && b.lon !== null,
  );
  const aoVivo = (await lerFornecedor()).bases ?? [];
  const porSlug = new Map(gravadas.map((b) => [b.slug, b]));

  for (const v of aoVivo) {
    const g = porSlug.get(v.slug);
    if (!g) {
      porSlug.set(v.slug, v);
      continue;
    }
    porSlug.set(v.slug, {
      ...g,
      nome: v.nome || g.nome,
      cidade: v.cidade || g.cidade,
      uf: v.uf || g.uf,
    });
  }
  return [...porSlug.values()];
}

/**
 * Os endereços que o build vai gerar, tirados da CÓPIA DE RESERVA.
 *
 * De propósito não é a leitura ao vivo. O build reparte as páginas entre vários
 * processos, e cada um lê o fornecedor por conta. Com 22 bases basta uma
 * responder diferente para o processo A prometer um endereço que o processo B
 * não acha — e aí o Next derruba o build inteiro no export. Foi exatamente o
 * que aconteceu com a Cappuccino Rosa/Bege.
 *
 * A reserva é arquivo commitado: todo processo lê a mesma coisa. Modelo que só
 * existe ao vivo continua abrindo, porque a página tem `dynamicParams`.
 */
/** Os códigos que a cópia de reserva conhece, para a revisão dizer o que mudou. */
export function codigosDaReserva(): Set<string> {
  return new Set(((reserva as unknown as Bruto).bikes ?? []).map((b) => b.codigo));
}

export function slugsDaReserva(): string[] {
  return ((reserva as unknown as Bruto).bikes ?? []).map((b) => b.slug);
}

export async function bikePorSlug(slug: string): Promise<Bike | null> {
  const { bikes, meta } = await catalogoPublico();
  // O slug termina no código do produto. Se o fornecedor renomear o modelo, o
  // começo do slug muda e todo link já mandado por WhatsApp quebraria; pelo
  // código a bike continua sendo encontrada.
  const codigo = slug.split('-').pop();
  const achar = (lista: Bike[]) =>
    lista.find((b) => b.slug === slug) ??
    (codigo ? lista.find((b) => b.codigo === codigo) : undefined);

  const viva = achar(bikes);
  if (viva) return viva;

  // Leitura AO VIVO que não achou = o modelo saiu do fornecedor. Some da loja,
  // e é para isso que o estoque é revisado duas vezes por dia: vender o que não
  // existe mais é pior do que uma página a menos.
  if (meta.origem === 'ao-vivo') return null;

  // Só quando a leitura falhou é que a reserva responde. Aí sim mostrar a ficha
  // de ontem é melhor do que página de erro em cima de um link que a pessoa
  // recebeu no WhatsApp — e é este caminho que faz o build passar, porque no
  // build o catálogo sai justamente da reserva.
  const guardadas = ((reserva as unknown as Bruto).bikes ?? []).map(paraInterna).map(paraPublica);
  return achar(guardadas) ?? null;
}

/** Marcas presentes no catálogo de hoje, com a contagem. Nunca uma lista fixa. */
export function marcasDe(
  bikes: Array<Bike | Cartao>,
): Array<{ marca: string; quantidade: number }> {
  const conta = new Map<string, number>();
  for (const b of bikes) conta.set(b.marca, (conta.get(b.marca) ?? 0) + 1);
  return [...conta]
    .map(([marca, quantidade]) => ({ marca, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.marca.localeCompare(b.marca, 'pt-BR'));
}

export function categoriasDe(
  bikes: Array<Bike | Cartao>,
): Array<{ categoria: string; quantidade: number }> {
  const conta = new Map<string, number>();
  for (const b of bikes) conta.set(b.categoria, (conta.get(b.categoria) ?? 0) + 1);
  return [...conta]
    .map(([categoria, quantidade]) => ({ categoria, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.categoria.localeCompare(b.categoria, 'pt-BR'));
}
