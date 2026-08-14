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
  /**
   * BENEFÍCIO não é ENTREGA. `entrega` é a lista do que vem na caixa; isto aqui
   * é o que muda no dia da pessoa. Página de venda vive disto — sem, a mini LP
   * fica sendo ficha de produto.
   */
  beneficios?: { titulo: string; texto: string }[];
  /** Três números de prova, na tira embaixo do herói. */
  numeros?: { valor: string; rotulo: string }[];
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
    beneficios: [
      { titulo: 'Responde na hora a pergunta que trava tudo',
        texto: '"Quanto tempo aguenta sem sol?" sai com número, em três cenários: só o essencial, a casa inteira e chovendo o dia todo. Não é chute — é a mesma conta do dimensionamento, lida ao contrário.' },
      { titulo: 'O preço do kit já com o frete até a obra',
        texto: 'Sem pedir cotação e esperar dois dias. Você põe o CEP, a plataforma calcula o frete de Uberlândia até lá e mostra o fornecimento fechado, com a sua margem por cima.' },
      { titulo: 'A proposta sai com a sua marca',
        texto: 'PDF com a sua logo, as suas cores, o seu preço e as suas parcelas. O cliente não vê o nosso nome em lugar nenhum — quem vende é você.' },
      { titulo: 'Ganha a conversa do poste e do gerador',
        texto: 'O comparativo de 10 anos contra puxar rede e contra diesel vai junto na proposta. É o argumento que fecha obra em sítio, e ninguém tem na ponta da língua.' },
      { titulo: 'Não erra o inversor por causa do motor',
        texto: 'Bomba puxa de 3 a 5 vezes na partida. A ferramenta conta o surto e dimensiona pra ele — inversor que desarma quando a bomba liga é o defeito mais caro do off-grid mal especificado.' },
      { titulo: 'Os R$ 97 voltam no primeiro pedido',
        texto: 'Pediu o kit pra gente? O que você pagou pela ferramenta entra como abatimento. Na prática, quem usa não paga.' },
    ],
    numeros: [
      { valor: '70', rotulo: 'aparelhos no catálogo, da lâmpada à ordenhadeira' },
      { valor: '3', rotulo: 'cenários de autonomia, com número' },
      { valor: '10 anos', rotulo: 'de comparativo contra rede e diesel' },
    ],
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
    promessa: 'Você tem 15 segundos pra responder a objeção do cliente — e a resposta decide a venda.',
    dorTexto:
      'Três frases fazem você perder venda toda semana: "tá caro", "vou pensar" e "fulano fez por menos". O problema quase nunca é preço — é não ter a resposta pronta na hora em que ele fala.',
    entrega: [
      'Os 6 módulos completos, em 21 lições com progresso',
      '32 respostas de objeção e 15 mensagens prontas',
      'Contrato, procuração e vistoria gerados com a sua marca',
      'Trilha com XP, níveis e conquistas — uma lição por dia, no celular',
      'Módulo bônus que só abre quando você usa a plataforma',
      'Atualizações do material sem custo adicional',
    ],
    beneficios: [
      { titulo: 'A resposta pronta, na hora em que ele fala',
        texto: 'Cada objeção vem em quatro partes: o que o cliente realmente quis dizer, o erro que quase todo integrador comete, a fala pronta pra visita e a versão curta pra colar no WhatsApp.' },
      { titulo: 'Da primeira ligação até a assinatura',
        texto: 'As 6 etapas da visita: como qualificar por telefone, o que falar nos primeiros 10 minutos, como conduzir a vistoria e como pedir a assinatura com data de obra na mesa.' },
      { titulo: 'Preço e margem sem chute',
        texto: 'Pra onde vai cada real do orçamento, as quatro regras que protegem a margem e o checklist de 10 itens — mais a missão prática na calculadora da plataforma.' },
      { titulo: 'Mensagem pronta pra copiar, colar e mandar',
        texto: 'Da primeira mensagem pro lead de anúncio ao follow-up que não parece cobrança. Cada uma traz o momento certo de usar e o motivo de funcionar.' },
      { titulo: 'Não é pasta de arquivo que some na caixa de entrada',
        texto: 'Fica na sua conta, abre do celular na porta do cliente e mostra onde você parou. Quando a gente atualiza o material, você já entra na versão nova.' },
      { titulo: 'Documento sai com o SEU CNPJ',
        texto: 'Contrato, procuração e vistoria não são modelos em branco pra preencher à mão: saem prontos com o CNPJ, o endereço e a logo da sua empresa.' },
    ],
    numeros: [
      { valor: '21', rotulo: 'lições, em 6 módulos com progresso' },
      { valor: '32', rotulo: 'respostas de objeção, palavra por palavra' },
      { valor: '15', rotulo: 'mensagens de prospecção e follow-up' },
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
    promessa: 'Faturar limpando placa solar, começando do zero: o que cobrar, como fazer e como o mesmo cliente volta.',
    dorTexto:
      'Milhões de painéis instalados no Brasil e quase ninguém limpa. Instalou, recebeu, acabou — mas a placa suja gera menos, o dono vê na conta e não sabe pra quem ligar.',
    entrega: [
      'Módulo 1 — Técnica de limpeza segura, sem riscar o vidro nem quebrar a garantia',
      'Módulo 2 — Segurança e trabalho em altura',
      'Módulo 3 — Precificação inteligente: quanto cobrar e por quê',
      'Módulo 4 — Captação e fechamento de clientes',
      'Módulo 5 — Renda recorrente: o contrato que faz o cliente voltar',
    ],
    beneficios: [
      { titulo: 'Um mercado gigante que ninguém atende',
        texto: 'São milhões de painéis instalados e quase nenhum serviço de limpeza. A placa suja gera menos, o dono percebe na conta — e não tem pra quem ligar.' },
      { titulo: 'De R$ 200 a R$ 800 por atendimento',
        texto: 'O preço não é chute: o módulo de precificação mostra como fechar o valor pelo tamanho do telhado, pela altura e pelo deslocamento.' },
      { titulo: 'Menos de R$ 700 pra montar o equipamento',
        texto: 'Não precisa de veículo, ponto comercial nem estoque. É a entrada mais barata que existe no mercado de energia solar.' },
      { titulo: 'O mesmo cliente volta a cada 3 a 6 meses',
        texto: 'Não é venda de uma vez: é contrato de manutenção. A diferença entre correr atrás de cliente novo todo mês e ter uma carteira que se repete sozinha.' },
      { titulo: 'Serve mesmo sem nenhuma experiência',
        texto: 'Começa do zero — a técnica, a segurança em altura, o preço e a conversa de venda. Quem já trabalha com solar entra vendendo pra própria base instalada.' },
      { titulo: '15 dias de garantia',
        texto: 'Entrou, viu e não é pra você? A gente devolve. O risco de experimentar é nosso.' },
    ],
    numeros: [
      { valor: 'R$ 200–800', rotulo: 'por atendimento' },
      { valor: 'R$ 700', rotulo: 'pra montar o equipamento inteiro' },
      { valor: '3 a 6 meses', rotulo: 'e o mesmo cliente te chama de novo' },
    ],
    preco: 47,
    naAssinatura: false,
    rota: '/produtos/limpapro',
    // ATENÇÃO ao endereço: `limpapro.solardoc.app` (raiz) é a PÁGINA DE VENDA.
    // A área do aluno é `/membros` — conferido no ar, o <title> de cada uma diz
    // qual é qual. Sem a barra, quem já comprou clicava em "Abrir LimpaPro" e
    // caía na oferta do que acabou de pagar.
    abrirExterno: process.env.NEXT_PUBLIC_LIMPAPRO_APP_URL || 'https://limpapro.solardoc.app/membros',
    // O checkout de verdade é o mesmo que a LP do limpapro.solardoc.app usa.
    // Sem ele, o botão "Comprar" abria uma conversa no WhatsApp em vez de
    // cobrar — a pessoa estava com a carteira na mão e virava lead.
    checkout: process.env.NEXT_PUBLIC_LIMPAPRO_CHECKOUT_URL || 'https://pay.kiwify.com.br/ai1',
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
