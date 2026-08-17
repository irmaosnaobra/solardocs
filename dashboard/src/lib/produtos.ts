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
  /**
   * A HEADLINE do herói, no padrão da home: uma frase que termina com o remate
   * em âmbar. Na home é "O melhor Gerador de Proposta do Brasil — **com a sua
   * marca.**" — a primeira parte diz o que é, a segunda dá a virada.
   */
  headline: { antes: string; destaque: string };
  /**
   * O parágrafo embaixo da headline. TEM que ser texto diferente da headline:
   * a `promessa` foi de onde a headline saiu, então repetir ela aqui faz a
   * pessoa ler a mesma frase duas vezes em cima da outra. Aqui é o "como",
   * concreto — igual à home, que abre com a promessa e explica embaixo.
   */
  subHeadline: string;
  /** Só de curso: as 4 primeiras lições, pra trilha do mockup ser a de verdade. */
  licoes?: string[];
  /** O problema que ela vive hoje, na língua dela. */
  dorTexto: string;
  /** O que está incluso. */
  entrega: string[];
  preco: number;
  naAssinatura: boolean;
  rota: string;
  /** Checkout avulso. Sem link configurado, cai no WhatsApp. */
  checkout: string;
  /**
   * PÁGINA DE VENDA QUE JÁ EXISTE, fora daqui. Dois produtos nasceram com funil
   * próprio antes desta loja: o Kit em `solardoc.app/kit` (indexada, com os
   * criativos apontando pra ela) e o LimpaPro em `limpapro.solardoc.app`.
   *
   * Quando existe, `/lp/<slug>` redireciona pra ela em vez de servir uma
   * segunda oferta do mesmo produto. Duas páginas de venda pro mesmo curso é
   * como o preço sobe numa e não na outra — e quem descobre é o cliente.
   */
  lpPropria?: string;
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
  /** Como a ferramenta funciona, em 3 passos — o "como" antes do "quanto". */
  comoFunciona?: { titulo: string; texto: string }[];
  /**
   * As objeções reais, respondidas. Página de venda sem FAQ empurra a dúvida
   * pro WhatsApp — e dúvida que vira mensagem quase nunca vira compra.
   */
  faq?: { p: string; r: string }[];
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
    subHeadline:
      'Marque o que o cliente vai ligar, diga quantos dias sem sol ele precisa aguentar, e saia com o kit dimensionado, a autonomia em número, o preço com frete até a obra e o PDF com a sua marca.',
    headline: { antes: 'Orçamento de sistema off-grid pronto', destaque: 'na frente do cliente.' },
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
    comoFunciona: [
      { titulo: 'Marque o que vai ligar',
        texto: 'Abra a lista e vá marcando: geladeira, luz, bomba, ar. São 70 aparelhos com a potência já preenchida — ou digite o kWh da conta, se preferir.' },
      { titulo: 'Diga quantos dias sem sol',
        texto: 'Um dia? Três? Só o essencial ou a casa inteira? É a escolha que mais mexe no preço, e a tela mostra o efeito dela na hora.' },
      { titulo: 'Leve a proposta pronta',
        texto: 'Sai o kit dimensionado, a autonomia com número, o preço com frete até a obra e o PDF com a sua marca. Na frente do cliente, em minutos.' },
    ],
    faq: [
      { p: 'Preciso entender de cálculo pra usar?',
        r: 'Não. Você marca aparelho e responde duas perguntas; a conta é da ferramenta. O que ela pede é o que o cliente já te falou — o que ele quer ligar e quanto tempo precisa aguentar sem sol.' },
      { p: 'O preço do kit é o que eu vendo?',
        r: 'Não. O preço que aparece é o nosso fornecimento com frete. Você põe a sua margem em cima, e a proposta sai com o SEU preço. Custo e margem ficam na sua tela, nunca no PDF do cliente.' },
      { p: 'Sou obrigado a comprar o kit de vocês?',
        r: 'Não. Dimensionar e ver a autonomia é grátis pra todo mundo, e você pode comprar o material onde quiser. Se pedir pra gente, os R$ 97 da ferramenta voltam como abatimento no primeiro pedido.' },
      { p: 'Serve pra sistema híbrido, com rede?',
        r: 'A ferramenta foi feita pro isolado — sítio, chácara, ponto sem rede. Num híbrido ela ajuda a dimensionar o banco, mas a conta de compensação da rede não entra.' },
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
    subHeadline:
      'Kit, mão de obra, deslocamento, ART, imposto e comissão numa tela só. Você arrasta a margem, vê a sua sobra na hora e manda o preço sabendo quanto entra no bolso.',
    headline: { antes: 'O preço que fecha a venda', destaque: 'e ainda sobra margem.' },
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
    beneficios: [
      { titulo: 'O custo inteiro na conta, não só o kit',
        texto: 'Material CA, mão de obra, deslocamento, ART e homologação entram junto. É o que some quando se calcula no olho — e é onde o lucro vai embora.' },
      { titulo: 'Você vê a sobra antes de mandar o preço',
        texto: 'Arrasta a margem e o número da sua sobra muda na hora. Dá pra negociar sabendo exatamente até onde pode ir.' },
      { titulo: 'A nota fiscal deixa de ser surpresa',
        texto: 'Escolhe se a NF é sobre o serviço ou sobre o total, e o imposto já sai descontado. Sem isso, o preço parece bom e o boleto do contador desmente.' },
      { titulo: 'O piso que ainda fecha',
        texto: 'A ferramenta mostra o preço mínimo que ainda dá lucro. Quando o cliente apertar, você sabe onde parar em vez de chutar com medo.' },
      { titulo: 'Comissão calculada junto',
        texto: 'Vendedor comissionado entra na conta antes, não depois. Assim a margem que você vê é a que sobra de verdade.' },
      { titulo: 'Mesma conta em toda proposta',
        texto: 'O time inteiro precifica pelo mesmo critério. Acaba a proposta que cada um fez de um jeito e ninguém sabe explicar depois.' },
    ],
    numeros: [
      { valor: '68', rotulo: 'integradores usando na plataforma hoje' },
      { valor: '6', rotulo: 'custos que entram além do kit' },
      { valor: '1 tela', rotulo: 'do custo ao preço final, sem planilha' },
    ],
    comoFunciona: [
      { titulo: 'Lance os custos da obra',
        texto: 'Kit, material CA, mão de obra, deslocamento, ART e homologação. Cada campo tem o que ele significa escrito do lado.' },
      { titulo: 'Escolha imposto e comissão',
        texto: 'NF sobre o serviço ou sobre o total, e a comissão do vendedor. As duas coisas que quase todo mundo esquece de somar.' },
      { titulo: 'Arraste a margem e veja a sobra',
        texto: 'O preço ao cliente e a sua sobra mudam juntos, na hora. Você fecha sabendo quanto entra no bolso.' },
    ],
    faq: [
      { p: 'É uma planilha?',
        r: 'Não. É uma tela dentro da plataforma, que abre do celular na frente do cliente. Planilha quebra quando alguém arrasta uma célula — aqui a conta é a mesma sempre.' },
      { p: 'Serve pra qualquer tamanho de obra?',
        r: 'Serve. A conta é a mesma pra residencial pequeno e pra usina — o que muda são os números que você lança.' },
      { p: 'Preciso assinar o SolarDoc?',
        r: 'Não. A compra é à parte e o acesso é seu enquanto a conta existir. Ela também vem inclusa na assinatura, se um dia fizer sentido.' },
      { p: 'Já usava de graça. Vou perder?',
        r: 'Não. Quem já usava continua usando, de graça, pra sempre. A cobrança vale pra quem chega agora.' },
    ],
    rota: '/precificacao',
    // Na Kiwify o produto se chama "Calculadora Solar", R$ 67.
    checkout: process.env.NEXT_PUBLIC_PRECIFICACAO_CHECKOUT_URL || 'https://pay.kiwify.com.br/duOCDd0',
    mockup: 'precificacao',
    cor: '#B45309',
  },
  {
    id: 'inventario',
    slug: 'inventario-empresa',
    subHeadline:
      'Cada ferramenta, painel e cabo com valor, local e estoque mínimo. O patrimônio soma sozinho, o aviso de repor chega antes de faltar na obra e sai um PDF pra contabilidade.',
    headline: { antes: 'Saiba onde está cada ferramenta', destaque: 'e quanto vale a sua empresa.' },
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
    beneficios: [
      { titulo: 'Você sabe quanto vale a sua empresa',
        texto: 'O patrimônio total soma sozinho, item por item. É o número que o contador pede e que a seguradora exige na apólice.' },
      { titulo: 'Avisa antes de faltar na obra',
        texto: 'Diga o mínimo de cada material. Quando encostar, a linha fica vermelha e o aviso sobe no topo — antes de você descobrir no telhado.' },
      { titulo: 'Entrada e saída viram histórico',
        texto: 'Chegou material, saiu pra obra: dois toques. Corrigir o número na mão apaga a história do item, e é assim que ninguém sabe quem levou a furadeira.' },
      { titulo: 'Cada lugar no seu lugar',
        texto: 'Escritório, montagem, depósito, veículos — e você cria os seus. Saber onde a ferramenta está vale mais que saber que ela existe.' },
      { titulo: 'Vira PDF pra contabilidade',
        texto: 'Um botão gera o documento separado por local, com os totais. É o que você manda pro contador ou anexa num seguro.' },
      { titulo: 'Começa preenchido',
        texto: 'Um toque monta um inventário de exemplo com 14 itens que toda equipe tem, já com valor e estoque mínimo. Você ajusta em vez de começar do zero.' },
    ],
    numeros: [
      { valor: '46', rotulo: 'empresas usando na plataforma hoje' },
      { valor: '46', rotulo: 'materiais no catálogo pronto' },
      { valor: '14 itens', rotulo: 'no inventário de exemplo, num toque' },
    ],
    comoFunciona: [
      { titulo: 'Escolha o local e o material',
        texto: 'A lista já vem pronta com o que costuma ter em cada lugar — do alicate crimpador MC4 ao painel solar. Ou digite o que não está nela.' },
      { titulo: 'Preencha valor e estoque mínimo',
        texto: 'O valor alimenta o patrimônio total; o mínimo é o que dispara o aviso de repor.' },
      { titulo: 'Lance movimento, não digitação',
        texto: 'As setas de entrada e saída registram o que chegou e o que foi pra obra, mantendo a história de cada item.' },
    ],
    faq: [
      { p: 'Preciso cadastrar tudo de uma vez?',
        r: 'Não. Dá pra começar com um botão que monta um inventário de exemplo e ir ajustando, ou cadastrar só o que importa agora. Nada trava por estar incompleto.' },
      { p: 'Funciona no celular, no galpão?',
        r: 'Funciona. Foi refeito pra isso: no telefone cada material vira um cartão, sem rolar pro lado, e os botões são do tamanho do dedo.' },
      { p: 'Serve pra controlar obra, não só empresa?',
        r: 'Serve. Você cria o local que quiser — "Obra do João", "Almoxarifado" — e controla o material lá dentro do mesmo jeito.' },
      { p: 'Já usava de graça. Vou perder?',
        r: 'Não. Quem já usava continua usando, de graça, pra sempre. A cobrança vale pra quem chega agora.' },
    ],
    rota: '/inventario',
    // Na Kiwify o produto se chama "Inventário Empresarial", R$ 67.
    checkout: process.env.NEXT_PUBLIC_INVENTARIO_CHECKOUT_URL || 'https://pay.kiwify.com.br/ABSMgCu',
    mockup: 'inventario',
    cor: '#1D4ED8',
  },
  {
    id: 'curso-fechamento',
    slug: 'kit-fecha-vendas',
    licoes: [
      'O primeiro contato',
      'A proposta que responde o medo',
      'Reativar quem sumiu',
      'Objeção de preço',
    ],
    subHeadline:
      'As 21 lições que respondem "tá caro", "vou pensar" e "meu primo faz mais barato" — com a fala pronta pra usar na visita e o contrato saindo com o CNPJ da sua empresa.',
    headline: { antes: '“Tá caro.” Você tem 15 segundos', destaque: 'pra não perder a venda.' },
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
    comoFunciona: [
      { titulo: 'Uma lição por dia, no celular',
        texto: 'A trilha mostra onde você parou e o que falta. Dá pra fazer na fila do banco ou esperando o cliente descer.' },
      { titulo: 'Copia a fala e usa na visita',
        texto: 'Cada objeção vem com a resposta pronta pra falar e a versão curta pra colar no WhatsApp. Não é teoria: é o que dizer quando ele falar.' },
      { titulo: 'Gera o documento com a sua marca',
        texto: 'Contrato, procuração e vistoria saem prontos com o CNPJ e a logo da sua empresa, direto da plataforma.' },
    ],
    faq: [
      { p: 'É vídeo ou é PDF?',
        r: 'É trilha dentro da plataforma, com progresso: você abre do celular, vê onde parou e continua. Não é pasta de arquivo que some quando troca de aparelho nem PDF que fica desatualizado.' },
      { p: 'Serve pra quem está começando?',
        r: 'Serve — ele começa na primeira ligação e vai até a assinatura. Quem já vende costuma usar mais os módulos de objeção e de preço, que são os que travam venda de quem já tem rodagem.' },
      { p: 'Quanto tempo leva pra terminar?',
        r: 'São 21 lições curtas. Fazendo uma por dia, três semanas. Mas ele é feito pra consulta também: dá pra ir direto na objeção que apareceu ontem.' },
      { p: 'Preciso assinar o SolarDoc pra usar?',
        r: 'Não. A compra é à parte e o acesso é seu enquanto a conta existir. Ele também vem incluso na assinatura, se um dia você assinar.' },
    ],
    numeros: [
      { valor: '21', rotulo: 'lições, em 6 módulos com progresso' },
      { valor: '32', rotulo: 'respostas de objeção, palavra por palavra' },
      { valor: '15', rotulo: 'mensagens de prospecção e follow-up' },
    ],
    preco: 27,
    naAssinatura: true,
    rota: '/cursos/kit-fechamento',
    // "Kit Fechamento - SolarDoc", R$ 27 — o mesmo checkout que a LP de
    // solardoc.app/kit usa desde 28/jul. Não é link novo: já vendia.
    checkout: process.env.NEXT_PUBLIC_KIT_CHECKOUT_URL || 'https://pay.kiwify.com.br/TGvxMl0',
    lpPropria: '/kit',
    mockup: 'curso',
    cor: '#7C3AED',
  },
  {
    id: 'curso-limpapro',
    slug: 'limpapro',
    licoes: [
      'A técnica que não risca o vidro',
      'Segurança em altura',
      'Quanto cobrar por telhado',
      'O contrato de manutenção',
    ],
    subHeadline:
      'A técnica sem riscar o vidro, a segurança em altura, quanto cobrar por telhado e como o mesmo cliente vira contrato de manutenção. Menos de R$ 700 de equipamento pra começar.',
    headline: { antes: 'Fature limpando placa solar,', destaque: 'começando do zero.' },
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
    comoFunciona: [
      { titulo: 'Aprenda a técnica e a segurança',
        texto: 'Como limpar sem riscar o vidro e sem quebrar a garantia do painel, e como trabalhar em altura sem se arriscar.' },
      { titulo: 'Saiba quanto cobrar',
        texto: 'O preço sai do tamanho do telhado, da altura e do deslocamento — não do chute. É o módulo que separa quem fatura de quem trabalha de graça.' },
      { titulo: 'Transforme em cliente que volta',
        texto: 'O contrato de manutenção faz o mesmo telhado te chamar a cada 3 ou 6 meses. É a diferença entre correr atrás de cliente novo e ter carteira.' },
    ],
    faq: [
      { p: 'Preciso ter experiência com solar?',
        r: 'Não. O curso começa do zero: técnica, segurança em altura, preço e a conversa de venda. Quem já trabalha com solar sai na frente porque já tem a base instalada pra oferecer.' },
      { p: 'Quanto preciso investir pra começar?',
        r: 'Menos de R$ 700 no equipamento. Não precisa de veículo próprio, ponto comercial nem estoque — é a entrada mais barata do mercado de energia solar.' },
      { p: 'Onde eu assisto?',
        r: 'Na área de aluno do LimpaPro, que abre do computador e do celular. Depois de pagar você recebe o e-mail com o link.' },
      { p: 'E se não for pra mim?',
        r: 'Você tem 15 dias de garantia. Entrou, viu e não serviu, a gente devolve.' },
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
    //
    // ERA `/ai1`, e `/ai1` NÃO É CHECKOUT: é a página de taxas e FAQ da própria
    // Kiwify. Truncamento de `ai1ESlS` que passou meses fingindo funcionar,
    // porque responde 200 e abre um site bonito. Quem clicava em "Comprar
    // LimpaPro" dentro do app não tinha como pagar.
    //
    // A LP oferece TRÊS degraus do mesmo curso: FUnHg3d R$ 47, ai1ESlS R$ 60 e
    // ZDGTGk2 R$ 77. Aqui vai o de R$ 47 porque é o preço que este card anuncia
    // — cobrar R$ 60 num card escrito R$ 47 é pior do que o botão quebrado.
    checkout: process.env.NEXT_PUBLIC_LIMPAPRO_CHECKOUT_URL || 'https://pay.kiwify.com.br/FUnHg3d',
    lpPropria: 'https://limpapro.solardoc.app',
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
