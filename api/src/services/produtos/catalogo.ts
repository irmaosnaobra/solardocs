/**
 * CATÁLOGO DE PRODUTOS — o que existe pra vender dentro da plataforma.
 *
 * Fonte única do lado do servidor: quem concede acesso (webhook), quem confere
 * acesso (gate) e quem lista a loja falam todos com esta lista. Produto novo se
 * cadastra AQUI e no catálogo do front (conteúdo da mini LP) — em mais lugar
 * nenhum.
 *
 * Duas portas de entrada, de propósito:
 *   1. COMPRA AVULSA — gente de fora paga um produto só, na Kiwify, e usa pra
 *      sempre. É receita que entra sem passar pela assinatura.
 *   2. ASSINATURA — o integrador de dentro já paga a mensalidade e recebe o que
 *      está marcado como `naAssinatura`. Esse acesso vale ENQUANTO ele assina, e
 *      por isso é derivado na leitura (não vira linha em entitlements).
 *   3. PLANO ANUAL — `noPlanoAnual` marca o que o anual entrega como POSSE (o
 *      webhook grava em entitlements e o cron repõe). Não é derivado: sobrevive
 *      ao cancelamento, e é o que separa o anual de "12 mensais com desconto".
 */

export type TipoProduto = 'ferramenta' | 'curso';

export interface Produto {
  id: string;
  nome: string;
  tipo: TipoProduto;
  /** Preço da compra avulsa, em reais. */
  preco: number;
  /**
   * Vem junto com a assinatura ativa (qualquer ciclo)? Acesso DERIVADO: existe
   * enquanto a assinatura existir, não vira linha em entitlements.
   */
  naAssinatura: boolean;
  /**
   * Vem no plano ANUAL, como POSSE — `entitlements` gravado pelo webhook da
   * venda e reposto pelo cron de sincronia. Sobrevive ao cancelamento.
   *
   * Este campo é só pra COPY (loja, cadeado, página de venda): o gate continua
   * lendo entitlements, que é onde a posse mora. Marcar aqui sem o webhook
   * conceder daria uma promessa sem acesso — e o contrário (conceder sem marcar)
   * daria acesso que a loja não sabe explicar.
   */
  noPlanoAnual?: boolean;
  /** Rota da ferramenta/curso dentro do app. */
  rota: string;
  /**
   * IDs de produto na Kiwify (via env, exato e à prova de renomeação) e regex
   * do nome como rede de segurança. Mesmo padrão do kit: o pior cenário é o
   * webhook chegar e o comprador ficar sem acesso porque faltou configuração.
   */
  envIds: string;
  regexNome: RegExp;
  /**
   * Produto cujo acesso NÃO é gerido aqui (funil próprio, já no ar). Aparece na
   * loja e no cadeado, mas a concessão continua onde sempre esteve.
   */
  externo?: boolean;
}

export const PRODUTOS: Produto[] = [
  {
    id: 'offgrid',
    nome: 'Dimensionamento Off-Grid',
    tipo: 'ferramenta',
    preco: 97,
    naAssinatura: false,
    rota: '/off-grid',
    envIds: 'OFFGRID_KIWIFY_PRODUCT_IDS',
    // Mesmo motivo do OFFGRID_PRODUTO_REGEX: o produto se chama "Dimensionamento
    // Off-Grid" e a palavra vinha ANTES do "off-grid", entao a regra nao casava.
    regexNome: /off[\s-]*grid/i,
  },
  {
    id: 'precificacao',
    nome: 'Precificação Profissional',
    tipo: 'ferramenta',
    preco: 67,
    // EXCLUSIVA DO PLANO ANUAL desde 17/08/2026 (decisão do Thiago). O mensal
    // NÃO libera mais: sem `naAssinatura`, `produtosDaAssinatura()` para de
    // derivar acesso pra ele. Quem tem o anual continua entrando pela POSSE em
    // entitlements, que o webhook grava na venda.
    //
    // Quem já pagava o mensal e usava as duas NÃO perdeu: 49 posses `cortesia`
    // gravadas antes deste commit (obs 'grandfather 17/08/2026'), 18 de
    // precificação e 31 de inventário. A regra vale daqui pra frente — mesmo
    // princípio do piso duro da entrega do solar. Desfaz com um DELETE pelo obs.
    naAssinatura: false,
    noPlanoAnual: true,
    rota: '/precificacao',
    envIds: 'PRECIFICACAO_KIWIFY_PRODUCT_IDS',
    // Na Kiwify ela se chama "Calculadora Solar" — nome de tráfego frio. Manter
    // os dois: o de dentro da plataforma e o que o comprador vê no checkout.
    regexNome: /precifica[çc][aã]o\s*(profissional|pro)|calculadora\s*solar/i,
  },
  {
    id: 'inventario',
    nome: 'Inventário da Empresa',
    tipo: 'ferramenta',
    preco: 67,
    // Ver a nota da precificação: exclusiva do anual desde 17/08/2026.
    naAssinatura: false,
    noPlanoAnual: true,
    rota: '/inventario',
    envIds: 'INVENTARIO_KIWIFY_PRODUCT_IDS',
    // "Inventário Empresarial" é o nome na Kiwify.
    regexNome: /invent[áa]rio\s*(da\s*)?empresa(rial)?/i,
  },
  {
    id: 'curso-fechamento',
    nome: 'Kit Fecha Vendas',
    tipo: 'curso',
    preco: 27,
    naAssinatura: true,
    rota: '/cursos/kit-fechamento',
    envIds: 'KIT_KIWIFY_PRODUCT_IDS',
    // O acesso deste curso já é resolvido por kit_pedidos (isca de R$27 + a
    // concessão por assinatura). Duas fontes pra um acesso só é como se cria
    // cliente que pagou e não entra — então aqui ele é lido, não regravado.
    regexNome: /kit\s*(de\s*)?fecha(mento|\s*vendas)/i,
    externo: true,
  },
  {
    id: 'curso-limpapro',
    nome: 'LimpaPro',
    tipo: 'curso',
    preco: 47,
    naAssinatura: false,
    rota: '/cursos/limpapro',
    envIds: 'LIMPAPRO_KIWIFY_PRODUCT_IDS',
    regexNome: /limpa\s*pro/i,
    // Funil próprio, com membros casados por TELEFONE em limpapro_membros e
    // nomes de produto na Kiwify ainda não confirmados. Entra na loja pelo
    // checkout dele; mexer no grant seria remexer num funil vivo.
    externo: true,
  },
];

export const produtoPorId = (id: string): Produto | undefined =>
  PRODUTOS.find((p) => p.id === id);

/** Produtos que a assinatura ativa libera. */
export const produtosDaAssinatura = (): string[] =>
  PRODUTOS.filter((p) => p.naAssinatura).map((p) => p.id);

const idsDoEnv = (nome: string): string[] =>
  (process.env[nome] || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Classifica um produto vendido na Kiwify. ID do env primeiro (exato), nome
 * depois. Retorna null quando não é nada do nosso catálogo.
 */
export function classificarProduto(
  nomeProduto: string | null | undefined,
  idProduto: string | null | undefined,
): Produto | null {
  const id = (idProduto || '').trim();
  if (id) {
    for (const p of PRODUTOS) {
      if (idsDoEnv(p.envIds).includes(id)) return p;
    }
  }
  const nome = (nomeProduto || '').trim();
  if (!nome) return null;
  for (const p of PRODUTOS) {
    if (p.regexNome.test(nome)) return p;
  }
  return null;
}
