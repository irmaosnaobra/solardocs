/**
 * Vai no fornecedor e devolve o catálogo já normalizado, sem preço de venda.
 *
 * Fica separado de `catalogo.ts` porque este arquivo também roda fora do Next
 * (o `scripts/sync.mjs` importa daqui para gerar a cópia de reserva), e
 * `catalogo.ts` é `server-only`.
 */

import { abrirSessao, ErroSoollar } from './soollar.ts';
import type { CD, ProdutoBruto } from './soollar.ts';
import { enderecoDoCep } from './geo.ts';
import { normalizar } from './normalizar.ts';
import type { BikeNormalizada } from './normalizar.ts';

export const CD_PADRAO = 'cduberlandiamg';
/**
 * A loja mostra o catálogo do BRASIL INTEIRO, não o de um galpão.
 *
 * Uberlândia tem 29 modelos; somando as 22 bases são 46. Os 17 que faltavam
 * quase todos estão em Goiânia, e não havia motivo para escondê-los de quem
 * está em Goiás — ou de quem está em Uberlândia e topa esperar.
 *
 * Ler base por base seria 22 leituras completas. Não precisa: o fornecedor
 * responde, para cada produto, em quais CDs ele existe (`cdsComOProduto`).
 * Então são 22 LISTAGENS (baratas) e ficha só dos modelos únicos.
 */
export const CATALOGO_NACIONAL = true;
export const SECAO_PADRAO = 'ebike';

/** Uma base do fornecedor, com a coordenada já resolvida a partir do CEP. */
export type Base = {
  slug: string;
  nome: string;
  cidade: string;
  uf: string;
  cep: string;
  lat: number | null;
  lon: number | null;
};

export type CatalogoBruto = {
  bikes: BikeNormalizada[];
  bases: Base[];
  lidoEm: string;
  logado: boolean;
  cd: string;
  secao: string;
};

/** Roda as promessas em lotes para não martelar o fornecedor. */
/**
 * Resolve o CEP de cada base uma vez por leitura. São pouco mais de dez bases e
 * o endereço delas não muda; sem a coordenada aqui, não há como dizer de qual
 * base a bike sai mais perto do cliente.
 */
async function comCoordenada(cds: CD[]): Promise<Base[]> {
  // Em lotes: as 22 de uma vez levavam limite do serviço de CEP e voltavam sem
  // coordenada, o que apaga a base do mapa da loja.
  const bases = await emLotes(cds, 4, async (cd) => {
    const cep = (cd.zipCode ?? '').replace(/\D/g, '');
    const e = cep ? await enderecoDoCep(cep).catch(() => null) : null;
    return {
      slug: cd.slug,
      nome: cd.name,
      cidade: e?.cidade ?? cd.city ?? '',
      uf: e?.uf ?? cd.state ?? '',
      cep,
      lat: e?.ponto?.lat ?? null,
      lon: e?.ponto?.lon ?? null,
    };
  });
  return bases.filter((b) => b.cep);
}

async function emLotes<T, R>(
  itens: T[],
  tamanho: number,
  tarefa: (item: T) => Promise<R>,
): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(tarefa))));
  }
  return saida;
}

/**
 * Parte do cadastro do fornecedor esquece o "MARCA X" no nome. A Voyager, por
 * exemplo, aparece com e sem. Quando o MESMO modelo tem marca em outro item e
 * todos concordam, a gente completa. Se houver divergência, fica "Não informada":
 * é melhor a loja não dizer a marca do que dizer a errada.
 */
function completarMarcas(bikes: BikeNormalizada[]): BikeNormalizada[] {
  const SEM_MARCA = 'Não informada';
  const porModelo = new Map<string, Set<string>>();
  const modeloDe = (b: BikeNormalizada) =>
    b.titulo.split(/\s+/).slice(0, 4).join(' ').toLowerCase();

  for (const b of bikes) {
    if (b.marca === SEM_MARCA) continue;
    const chave = modeloDe(b);
    if (!porModelo.has(chave)) porModelo.set(chave, new Set());
    porModelo.get(chave)!.add(b.marca);
  }

  return bikes.map((b) => {
    if (b.marca !== SEM_MARCA) return b;
    const candidatas = porModelo.get(modeloDe(b));
    if (candidatas?.size !== 1) return b;
    return { ...b, marca: [...candidatas][0] };
  });
}

export async function buscarNoFornecedor(opcoes?: {
  cdSlug?: string;
  secaoSlug?: string;
  email?: string;
  senha?: string;
  comFicha?: boolean;
}): Promise<CatalogoBruto> {
  const cdSlug = opcoes?.cdSlug ?? process.env.SOOLLAR_CD ?? CD_PADRAO;
  const secaoSlug = opcoes?.secaoSlug ?? process.env.SOOLLAR_SECAO ?? SECAO_PADRAO;
  const email = opcoes?.email ?? process.env.SOOLLAR_EMAIL;
  const senha = opcoes?.senha ?? process.env.SOOLLAR_SENHA;

  const { sessao, cd, secao, todosOsCds } = await abrirSessao({
    cdSlug,
    secaoSlug,
    email,
    senha,
  });
  const lista = await sessao.listarProdutos(cd.distributionCenterId, secao.sectionId);
  const bases = await comCoordenada(todosOsCds);

  // A ficha técnica completa só vem no detalhe, um produto por chamada.
  const fichas = new Map<string, ProdutoBruto | null>();
  const basesDoProduto = new Map<string, string[]>();
  if (opcoes?.comFicha !== false) {
    const detalhes = await emLotes(lista, 5, async (p) => {
      try {
        return [p.id, await sessao.produto(p.id)] as const;
      } catch {
        // Um detalhe que falha não derruba o catálogo: o item fica com a ficha
        // curta da listagem, que já traz bateria, velocidade e autonomia.
        return [p.id, null] as const;
      }
    });
    for (const [id, d] of detalhes) fichas.set(id, d);

    // Em quais bases o item existe. O fornecedor responde isso mesmo deslogado,
    // e é o que permite dizer de onde a bike sai mais perto de quem comprou.
    const ondeTem = await emLotes(lista, 5, async (p) => {
      try {
        return [p.id, (await sessao.cdsComOProduto(p.id)).map((c) => c.slug)] as const;
      } catch {
        return [p.id, [] as string[]] as const;
      }
    });
    for (const [id, slugs] of ondeTem) basesDoProduto.set(id, slugs);
  }

  const bikes = completarMarcas(
    lista.map((p) => normalizar(p, fichas.get(p.id), basesDoProduto.get(p.id) ?? [cd.slug])),
  ).filter((b) => b.custoEmReais !== null && b.imagens.length > 0);

  return {
    bikes,
    bases,
    lidoEm: new Date().toISOString(),
    logado: sessao.logado,
    cd: cd.name,
    secao: secao.name,
  };
}

/**
 * O catálogo do Brasil inteiro: as 22 bases numa lista só.
 *
 * Uma sessão, trocando o cookie de CD entre as listagens. Sessão por base seria
 * 22 logins, e o login é a parte cara.
 *
 * A linha que vale é a da NOSSA base quando o modelo existe lá. Preço é igual
 * em todas (conferido: 35 modelos repetidos, zero divergência), mas
 * `availableQuantity` é por galpão — e quando o login do fornecedor entrar, é
 * o estoque de Uberlândia que a gente quer mostrar, não o de Cuiabá.
 */
export async function buscarCatalogoNacional(opcoes?: {
  secaoSlug?: string;
  email?: string;
  senha?: string;
  comFicha?: boolean;
}): Promise<CatalogoBruto> {
  const secaoSlug = opcoes?.secaoSlug ?? process.env.SOOLLAR_SECAO ?? SECAO_PADRAO;
  const email = opcoes?.email ?? process.env.SOOLLAR_EMAIL;
  const senha = opcoes?.senha ?? process.env.SOOLLAR_SENHA;

  const {
    sessao,
    cd: cdPadrao,
    secao,
    todosOsCds,
  } = await abrirSessao({
    cdSlug: CD_PADRAO,
    secaoSlug,
    email,
    senha,
  });
  const bases = await comCoordenada(todosOsCds);

  // Sequencial de propósito: o cookie de CD é da sessão, então duas listagens
  // ao mesmo tempo brigariam por ele e uma delas leria o galpão errado.
  const linhas = new Map<string, ProdutoBruto>();
  const ondeVimos = new Map<string, Set<string>>();
  const falhas: string[] = [];

  for (const cd of todosOsCds) {
    try {
      sessao.usarCD(cd);
      const lista = await sessao.listarProdutos(cd.distributionCenterId, secao.sectionId);
      for (const p of lista) {
        const codigo = String(p.ref ?? p.referenceCode ?? p.id);
        if (!ondeVimos.has(codigo)) ondeVimos.set(codigo, new Set());
        ondeVimos.get(codigo)!.add(cd.slug);
        // A nossa base ganha; fora dela, a primeira que aparecer.
        if (!linhas.has(codigo) || cd.slug === CD_PADRAO) linhas.set(codigo, p);
      }
    } catch {
      // Uma base fora do ar não derruba o catálogo inteiro: as outras 21
      // continuam valendo, e o item que só existia nela some da vitrine em vez
      // de aparecer sem preço.
      falhas.push(cd.slug);
    }
  }

  if (falhas.length) console.warn(`Bases que não responderam: ${falhas.join(', ')}`);

  const unicos = [...linhas.values()];
  // Volta para a nossa base: o resto da leitura (ficha, detalhe) é feito com o
  // cookie apontando para casa, que é o estado que o restante do código assume.
  sessao.usarCD(cdPadrao);

  const fichas = new Map<string, ProdutoBruto | null>();
  const basesDoProduto = new Map<string, string[]>();

  if (opcoes?.comFicha !== false) {
    const detalhes = await emLotes(unicos, 5, async (p) => {
      try {
        return [p.id, await sessao.produto(p.id)] as const;
      } catch {
        return [p.id, null] as const;
      }
    });
    for (const [id, d] of detalhes) fichas.set(id, d);

    const ondeTem = await emLotes(unicos, 5, async (p) => {
      try {
        return [p.id, (await sessao.cdsComOProduto(p.id)).map((c) => c.slug)] as const;
      } catch {
        return [p.id, [] as string[]] as const;
      }
    });
    for (const [id, slugs] of ondeTem) basesDoProduto.set(id, slugs);
  }

  const bikes = completarMarcas(
    unicos.map((p) => {
      const codigo = String(p.ref ?? p.referenceCode ?? p.id);
      // O que o fornecedor responde vale mais; se ele não responder, vale o que
      // a gente VIU, que agora é a lista completa das 22 listagens.
      const doFornecedor = basesDoProduto.get(p.id) ?? [];
      const vistas = [...(ondeVimos.get(codigo) ?? [])];
      return normalizar(p, fichas.get(p.id), doFornecedor.length ? doFornecedor : vistas);
    }),
  ).filter((b) => b.custoEmReais !== null && b.imagens.length > 0);

  return {
    bikes,
    bases,
    lidoEm: new Date().toISOString(),
    logado: sessao.logado,
    cd: 'Brasil (22 bases)',
    secao: secao.name,
  };
}

export { ErroSoollar };
