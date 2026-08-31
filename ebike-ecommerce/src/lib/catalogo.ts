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
import { MARGEM_EM_REAIS, precoDeVenda } from './preco.ts';
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

const lerFornecedor = unstable_cache(
  async (): Promise<Bruto & { origem: 'ao-vivo' | 'reserva'; erro?: string }> => {
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
    margem: MARGEM_EM_REAIS,
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

export async function bikePorSlug(slug: string): Promise<Bike | null> {
  const { bikes } = await catalogoPublico();
  const exata = bikes.find((b) => b.slug === slug);
  if (exata) return exata;

  // O slug termina no código do produto. Se o fornecedor renomear o modelo, o
  // começo do slug muda e todo link já mandado por WhatsApp quebraria; pelo
  // código a bike continua sendo encontrada.
  const codigo = slug.split('-').pop();
  return codigo ? (bikes.find((b) => b.codigo === codigo) ?? null) : null;
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
