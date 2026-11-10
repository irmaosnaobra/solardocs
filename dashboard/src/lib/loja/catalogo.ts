/**
 * A LOJA "PARA CRESCER": os 4 produtos que se compram por Pix dentro do app, na ordem em que aparecem.
 *
 * O que é VENDA mora aqui (imagem, promessa, botões, o que dizer depois do pagamento). O que é ACESSO vem do servidor
 * (`/produtos/acessos`, pelo `useAcessos`). O que é PREÇO vem de `lib/produtos.ts`, que espelha o catálogo da api
 * (api/src/services/produtos/catalogo.ts): é a api quem cobra, e o valor nunca viaja do navegador.
 *
 * Os ids são os do catálogo da api. Texto visível: o que o redator aprovou em 10/11/2026.
 */

import { produtoPorId as produtoDoCatalogo } from '@/lib/produtos';

export type IdProdutoLoja = 'offgrid' | 'inventario' | 'curso-fechamento' | 'curso-limpapro';

export interface ProdutoDaLoja {
  id: IdProdutoLoja;
  /** O mesmo slug de `lib/produtos.ts`; é ele que vai na rota `/produtos/<slug>`. */
  slug: string;
  nome: string;
  /** Em reais, vindo de `lib/produtos.ts`. */
  preco: number;
  promessa: string;
  /** O botão que abre a página de venda ("Ver o Estoque em Dia"). */
  ver: string;
  /** Para onde a página de venda mora. O Off-Grid se vende dentro da própria ferramenta, que é aberta para testar. */
  hrefVer: string;
  imagem: string;
  imgAlt: string;
  larguraImg: number;
  alturaImg: number;
  /** A ferramenta, dentro do app. */
  rotaAbrir: string;
  /** "Abrir o Estoque em Dia", no "Pagamento confirmado". */
  abrirBotao: string;
  /** O próximo passo, no "Pagamento confirmado". */
  proximo: string;
}

const dados = (id: IdProdutoLoja) => {
  const p = produtoDoCatalogo(id);
  if (!p) throw new Error(`Produto ${id} fora de lib/produtos.ts`);
  return { slug: p.slug, preco: p.preco };
};

export const PRODUTOS_DA_LOJA: ProdutoDaLoja[] = [
  {
    id: 'offgrid', ...dados('offgrid'),
    nome: 'Venda Off-Grid',
    promessa: 'Dimensione o sistema isolado e gere a proposta com a sua marca.',
    ver: 'Ver o Off-Grid',
    hrefVer: '/off-grid',
    imagem: '/off-grid/folha-1.webp',
    imgAlt: 'Folha 1 da proposta Off-grid: projeto com placas, inversor, baterias e autonomia',
    larguraImg: 800, alturaImg: 1130,
    rotaAbrir: '/off-grid',
    abrirBotao: 'Abrir o Off-Grid',
    proximo: 'Informe o CEP da obra e gere a sua primeira proposta.',
  },
  {
    id: 'inventario', ...dados('inventario'),
    nome: 'Estoque em Dia',
    promessa: 'Saiba onde está cada ferramenta e quanto vale o seu estoque.',
    ver: 'Ver o Estoque em Dia',
    hrefVer: '/produtos/inventario-empresa',
    imagem: '/produtos/estoque-tela.webp',
    imgAlt: 'Tela do Estoque em Dia: total em equipamento e lista de itens com local e valor',
    larguraImg: 1120, alturaImg: 1024,
    rotaAbrir: '/inventario',
    abrirBotao: 'Abrir o Estoque em Dia',
    proximo: 'Cadastre o primeiro item, ou comece pelo inventário de exemplo.',
  },
  {
    id: 'curso-fechamento', ...dados('curso-fechamento'),
    nome: 'Fecha Vendas',
    promessa: 'Respostas prontas para as objeções que travam a sua venda.',
    ver: 'Ver o Fecha Vendas',
    hrefVer: '/produtos/kit-fecha-vendas',
    imagem: '/produtos/fv-licao.webp',
    imgAlt: 'Lição do Fecha Vendas: a objeção do cliente, o que ele quer dizer, o erro comum, a fala pronta e a versão de WhatsApp',
    larguraImg: 1200, alturaImg: 907,
    rotaAbrir: '/cursos/kit-fechamento',
    abrirBotao: 'Abrir o Fecha Vendas',
    proximo: 'Abra a trilha e comece pelas objeções de preço.',
  },
  {
    id: 'curso-limpapro', ...dados('curso-limpapro'),
    nome: 'LimpaPro',
    promessa: 'Curso para montar um serviço de limpeza de placas solares.',
    ver: 'Ver o LimpaPro',
    hrefVer: '/produtos/limpapro',
    imagem: '/produtos/limpapro-curso.webp',
    imgAlt: 'Curso LimpaPro: caixa, tela do curso no notebook e no celular e os 5 módulos',
    larguraImg: 840, alturaImg: 643,
    // A área de membros agora abre dentro do app, sem segundo login.
    rotaAbrir: '/limpapro',
    abrirBotao: 'Abrir o LimpaPro',
    proximo: 'Abra o curso e comece pelo módulo 1. Ele fica no menu, em Para crescer.',
  },
];

export const ORDEM_DA_LOJA: IdProdutoLoja[] = PRODUTOS_DA_LOJA.map((p) => p.id);

export function produtoDaLoja(id: string | null | undefined): ProdutoDaLoja | undefined {
  return PRODUTOS_DA_LOJA.find((p) => p.id === id);
}

export function produtoDaLojaPorSlug(slug: string): ProdutoDaLoja | undefined {
  return PRODUTOS_DA_LOJA.find((p) => p.slug === slug);
}

export const brl = (n: number): string => 'R$ ' + n.toLocaleString('pt-BR');

/** O que o /produtos/acessos diz sobre a conta. Só o que a loja precisa. */
export interface AcessosDaLoja {
  tem: (produto: string) => boolean;
  origem: Record<string, string>;
  plano: string;
  assinante: boolean;
}

export interface EstadoLiberado {
  titulo: string;
  texto: string;
}

/**
 * O que a loja escreve num produto que a pessoa já tem. `null` quando ela ainda não tem. Quem tem por posse, por
 * assinatura ou por plano anual NÃO vê preço nem botão de compra.
 *
 * O plano anual hoje não chega pronto do servidor: a posse do anual é uma linha comum de `entitlements`
 * (origem `compra`) e o `plano` do usuário vem como `ilimitado` nos dois ciclos. Por isso a frase do anual só
 * aparece quando o servidor diz (`origem` ou `plano` com "anual"). Sem o aviso, vale "Você já tem", que é verdade.
 */
export function estadoLiberado(id: IdProdutoLoja, ac: AcessosDaLoja): EstadoLiberado | null {
  if (!ac.tem(id)) return null;
  const p = produtoDaLoja(id);
  const nome = p?.nome ?? 'Este produto';
  const via = ac.origem[id] ?? '';
  if (via === 'assinatura') {
    return { titulo: 'Já vem na sua assinatura', texto: `O ${nome} está liberado enquanto a sua assinatura estiver ativa.` };
  }
  if (id === 'inventario' && (/anual/i.test(via) || (ac.assinante && /anual/i.test(ac.plano)))) {
    return { titulo: 'Já vem no seu plano anual', texto: `O ${nome} é seu enquanto a sua conta existir.` };
  }
  return { titulo: 'Você já tem', texto: 'Este produto já está liberado na sua conta.' };
}

/** Os produtos que a pessoa ainda não tem, na ordem da loja. `exceto` tira o produto da página aberta. */
export function quemFalta(tem: (produto: string) => boolean, exceto?: string | null): ProdutoDaLoja[] {
  return PRODUTOS_DA_LOJA.filter((p) => p.id !== exceto && !tem(p.id));
}

/** Resposta do GET /produtos/pix/:id traz o próximo produto a oferecer. Só serve se o produto existir na loja. */
export interface ProximoDaApi {
  produto: string;
  nome: string;
  preco: number;
}

export function produtoDoUpsell(proximo: ProximoDaApi | null | undefined): ProdutoDaLoja | null {
  return produtoDaLoja(proximo?.produto) ?? null;
}
