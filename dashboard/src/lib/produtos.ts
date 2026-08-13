/**
 * CATÁLOGO DA LOJA — o conteúdo que vende cada produto.
 *
 * O ACESSO vem do servidor (GET /produtos/acessos); aqui mora só o que a mini
 * LP mostra: promessa, o que a pessoa leva, preço e checkout. Espelha os ids de
 * api/src/services/produtos/catalogo.ts — produto novo entra nos dois.
 *
 * Regra de conteúdo: nada de depoimento inventado nem número que não saiu de
 * lugar nenhum. O que vende aqui é a ferramenta funcionando na frente da
 * pessoa; promessa inflada em produto de trabalho volta como reembolso.
 */

export type TipoProduto = 'ferramenta' | 'curso';

export interface ProdutoLoja {
  id: string;
  slug: string;
  nome: string;
  tipo: TipoProduto;
  /** Uma linha: o que muda no dia da pessoa. */
  promessa: string;
  /** O problema que ela vive hoje, na língua dela. */
  dorTexto: string;
  /** O que está incluso. */
  entrega: string[];
  preco: number;
  naAssinatura: boolean;
  rota: string;
  /** Checkout avulso. Sem link configurado, cai no WhatsApp. */
  checkout: string;
  /** Qual mockup a LP renderiza. */
  mockup: 'offgrid' | 'precificacao' | 'inventario' | 'curso';
  /** Só pra ferramenta que dá pra experimentar antes de comprar. */
  experimentar?: { rota: string; texto: string };
  /**
   * Produto que mora FORA do app (funil e área de membros próprios). Quem já
   * tem é mandado pra lá; sem isto, "Abrir" cairia numa rota que não existe.
   */
  abrirExterno?: string;
  cor: string;
}

const WHATS = 'https://wa.me/5534991360223?text=';

export const PRODUTOS_LOJA: ProdutoLoja[] = [
  {
    id: 'offgrid',
    slug: 'dimensionamento-off-grid',
    nome: 'Dimensionamento Off-Grid',
    tipo: 'ferramenta',
    promessa: 'Orçamento de sistema isolado pronto na frente do cliente, com a resposta que ele sempre pergunta.',
    dorTexto:
      'Off-grid é a venda que trava na pergunta "quanto tempo a bateria aguenta sem sol?". Chutar derruba a confiança; calcular na mão leva meia hora e ainda sai errado no mês de inverno.',
    entrega: [
      'Dimensionamento completo: painéis, banco de baterias, inversor e a ligação em série/paralelo',
      'A autonomia em três cenários com número — essencial, casa inteira e dia de chuva',
      'Preço de fornecimento do kit com frete até a obra',
      'Proposta em PDF com a sua marca, o seu preço e as suas parcelas',
      'Comparativo de 10 anos contra puxar rede e contra gerador a diesel',
      'Pedido do kit direto pra gente, com o orçamento travado',
    ],
    preco: 97,
    naAssinatura: false,
    rota: '/off-grid',
    checkout: process.env.NEXT_PUBLIC_OFFGRID_CHECKOUT_URL || 'https://pay.kiwify.com.br/Je9pKBV',
    mockup: 'offgrid',
    // A ferramenta fica aberta de propósito: dimensionar e ver a autonomia é
    // grátis. A melhor página de vendas dela é ela mesma funcionando.
    experimentar: { rota: '/off-grid', texto: 'Dimensionar um sistema agora, de graça' },
    cor: '#0F766E',
  },
  {
    id: 'precificacao',
    slug: 'precificacao-profissional',
    nome: 'Precificação Profissional',
    tipo: 'ferramenta',
    promessa: 'O preço que fecha a venda e ainda sobra margem — sem descobrir no fim do mês que trabalhou de graça.',
    dorTexto:
      'A conta feita no olho esquece deslocamento, ART, homologação, imposto e comissão. Aí o orçamento parece bom, o cliente aceita rápido demais, e o lucro some no meio da obra.',
    entrega: [
      'Todo custo na conta: kit, material CA, mão de obra, deslocamento, homologação e ART',
      'Nota fiscal modelada como dedução — sobre o serviço ou sobre o total',
      'Margem e comissão calculadas juntas, pra saber o que sobra de verdade',
      'O preço mínimo que ainda fecha, pra você negociar sabendo o piso',
    ],
    preco: 67,
    naAssinatura: true,
    rota: '/precificacao',
    checkout: process.env.NEXT_PUBLIC_PRECIFICACAO_CHECKOUT_URL || WHATS + encodeURIComponent('Quero liberar a Precificação Profissional no SolarDoc'),
    mockup: 'precificacao',
    cor: '#B45309',
  },
  {
    id: 'inventario',
    slug: 'inventario-empresa',
    nome: 'Inventário da Empresa',
    tipo: 'ferramenta',
    promessa: 'Saber onde está cada ferramenta e quanto vale o patrimônio da sua empresa.',
    dorTexto:
      'Furadeira que sumiu, andaime que ficou na obra do mês passado, EPI vencido. Quando você percebe, já comprou de novo o que já tinha.',
    entrega: [
      'Cadastro de ferramentas, EPI, veículos e equipamentos de obra',
      'Valor do patrimônio somado e atualizado',
      'Onde cada item está e com quem',
      'Alerta do que está acabando antes de faltar na obra',
    ],
    preco: 67,
    naAssinatura: true,
    rota: '/inventario',
    checkout: process.env.NEXT_PUBLIC_INVENTARIO_CHECKOUT_URL || WHATS + encodeURIComponent('Quero liberar o Inventário da Empresa no SolarDoc'),
    mockup: 'inventario',
    cor: '#1D4ED8',
  },
  {
    id: 'curso-fechamento',
    slug: 'kit-fecha-vendas',
    nome: 'Kit Fecha Vendas',
    tipo: 'curso',
    promessa: 'O passo a passo de quem vende solar todo dia — do primeiro contato até o cliente assinar.',
    dorTexto:
      'Orçamento enviado, cliente sumiu. O problema quase nunca é preço: é a conversa que não teve continuidade e a proposta que não respondeu o medo dele.',
    entrega: [
      'A trilha completa de fechamento, módulo por módulo',
      'Os textos que reativam quem sumiu depois do orçamento',
      'Como responder as objeções que aparecem em toda venda solar',
      'Módulo bônus liberado por missão dentro da plataforma',
    ],
    preco: 27,
    naAssinatura: true,
    rota: '/cursos/kit-fechamento',
    checkout: process.env.NEXT_PUBLIC_KIT_CHECKOUT_URL || WHATS + encodeURIComponent('Quero o Kit Fecha Vendas'),
    mockup: 'curso',
    cor: '#7C3AED',
  },
  {
    id: 'curso-limpapro',
    slug: 'limpapro',
    nome: 'LimpaPro',
    tipo: 'curso',
    promessa: 'Limpeza de placas como serviço recorrente: o que cobrar, como fazer e como vender de novo todo ano.',
    dorTexto:
      'Instalou, recebeu, acabou. A limpeza é a receita que volta sozinha do mesmo cliente — e quase todo integrador deixa na mesa.',
    entrega: [
      'O método de limpeza que não risca o vidro nem quebra a garantia',
      'Quanto cobrar por placa e como montar o contrato de manutenção',
      'Como voltar no cliente que você já instalou',
    ],
    preco: 47,
    naAssinatura: false,
    rota: '/produtos/limpapro',
    abrirExterno: process.env.NEXT_PUBLIC_LIMPAPRO_APP_URL || 'https://limpapro.solardoc.app',
    checkout: process.env.NEXT_PUBLIC_LIMPAPRO_CHECKOUT_URL || WHATS + encodeURIComponent('Quero o curso LimpaPro'),
    mockup: 'curso',
    cor: '#15803D',
  },
];

export const produtoPorSlug = (slug: string) => PRODUTOS_LOJA.find((p) => p.slug === slug);
export const produtoPorId = (id: string) => PRODUTOS_LOJA.find((p) => p.id === id);

/**
 * Link de checkout com o e-mail da conta pré-preenchido.
 *
 * A Kiwify casa a compra com a conta do SolarDoc PELO E-MAIL. Se a pessoa digita
 * outro no checkout, o webhook cria um usuário separado: ela paga, o acesso é
 * liberado — e não aparece nada na conta em que ela estava logada. Pré-preencher
 * não impede que ela troque, mas resolve o caso comum, que é o normal.
 */
export function checkoutCom(p: ProdutoLoja, email?: string | null): string {
  if (!email) return p.checkout;
  const sep = p.checkout.includes('?') ? '&' : '?';
  return `${p.checkout}${sep}email=${encodeURIComponent(email)}`;
}
