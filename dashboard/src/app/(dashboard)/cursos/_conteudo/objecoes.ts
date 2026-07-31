// Conteúdo do Kit de Fechamento do Integrador — Módulo 1.
// Texto é produto: entregue ao comprador do kit dentro da plataforma.
// Editar aqui altera o material para todos os compradores (sem redeploy de dados).
//
// A CONTAGEM NÃO SE ESCREVE À MÃO em lugar nenhum: cada grupo vira uma lição e o
// total sai de TOTAL_OBJECOES (fim do arquivo), que o kit-fechamento.ts usa no
// subtítulo do módulo. Já teve "20 objeções" escrito aqui quando eram 26 — número
// de copy que envelhece sozinho é promessa que o cliente confere e não bate.

export type Objecao = {
  id: string;
  /** O que o cliente fala, nas palavras dele */
  gatilho: string;
  /** O que ele quer dizer de verdade */
  traducao: string;
  /** O erro que quase todo integrador comete aqui */
  erro: string;
  /** Fala pronta para visita/telefone */
  script: string;
  /** Versão curta para mandar no WhatsApp */
  whatsapp: string;
};

export type GrupoObjecoes = {
  slug: string;
  titulo: string;
  descricao: string;
  itens: Objecao[];
};

export const OBJECOES: GrupoObjecoes[] = [
  {
    slug: 'preco',
    titulo: 'Preço e concorrência',
    descricao:
      'As sete objeções que derrubam mais contrato no Brasil. Todas têm a mesma raiz: o cliente não consegue comparar duas propostas, então compara pelo único número que entende — o total.',
    itens: [
      {
        id: 'mais-barato',
        gatilho: 'Achei mais barato com outra empresa.',
        traducao:
          'Ele não está dizendo que você é caro. Está dizendo que as duas propostas parecem iguais no papel, e quando tudo parece igual, o preço decide sozinho.',
        erro:
          'Baixar o preço na hora. Você confirma que o valor era inflado, perde margem e ainda planta a dúvida: "se caiu agora, cai mais se eu insistir".',
        script:
          'Fico feliz que tenha pedido mais orçamentos, é o certo a fazer. Me manda a outra proposta que eu comparo com você — não para eu brigar por preço, mas porque em 9 de 10 casos as duas não estão vendendo a mesma coisa. Enquanto isso me responde três coisas do outro orçamento: qual a potência do módulo e a marca do inversor, quantos anos de garantia de instalação estão escritos no contrato, e quem faz a homologação na concessionária. Se estiver tudo igual ao meu e mais barato, eu mesmo te falo para fechar com eles.',
        whatsapp:
          'Show, é o certo pedir mais orçamentos. Me manda o outro que eu comparo com você. Só me responde 3 coisas de lá: marca do inversor, garantia de instalação no contrato, e quem faz a homologação. Se for tudo igual e mais barato, eu te falo pra fechar com eles.',
      },
      {
        id: 'vizinho-pagou-menos',
        gatilho: 'Meu vizinho pagou bem menos num sistema parecido.',
        traducao:
          'Ele tem um número na cabeça e usa como âncora, sem saber o que aquele número comprava.',
        erro: 'Duvidar do vizinho. Você chama o amigo dele de mentiroso e cria atrito de graça.',
        script:
          'Acredito, e sabe por quê? Preço de sistema solar mudou muito nos últimos anos, e cada telhado é um projeto diferente. Duas casas na mesma rua podem ter estruturas, distâncias de inversor e padrão de entrada completamente diferentes. Se você me passar quando foi a instalação dele e a potência, eu te mostro exatamente onde estão as diferenças — e se a dele for melhor, eu ajusto a minha.',
        whatsapp:
          'Acredito sim! Preço mudou muito e cada telhado é um projeto. Me fala quando foi a instalação dele e a potência que eu te mostro onde estão as diferenças pro seu caso.',
      },
      {
        id: 'internet-marketplace',
        gatilho: 'Vi um kit muito mais barato na internet.',
        traducao: 'Ele está comparando equipamento com serviço, e não sabe que são coisas diferentes.',
        erro: 'Falar mal do kit ou do site. Você parece defensivo.',
        script:
          'O kit é uma parte do sistema — importante, mas é a parte que você conseguiria comprar sozinho mesmo. O que você está contratando aqui é o projeto elétrico assinado, a instalação com garantia, a homologação junto à concessionária e alguém que atende quando der problema daqui a três anos. Se comprar só o kit, você vira o responsável técnico da obra. Quer que eu te mande uma proposta separando as duas coisas, equipamento e serviço, para você ver quanto é cada uma?',
        whatsapp:
          'O kit é só o equipamento. O que a gente entrega junto é projeto assinado, instalação com garantia e homologação na concessionária. Comprando só o kit, você vira o responsável pela obra. Quer que eu te mande separado, equipamento x serviço?',
      },
      {
        id: 'desconto-avista',
        gatilho: 'Qual seu melhor preço à vista?',
        traducao: 'Teste. Ele quer saber se o número que você deu era verdadeiro.',
        erro: 'Dar desconto imediato. Confirma que o primeiro preço era um chute.',
        script:
          'O valor que te passei já é o de quem fecha comigo. O que eu consigo fazer no à vista é antecipar a obra — em vez de entrar na fila normal, você entra na próxima janela de instalação. Se prazo te ajuda mais que centavos, isso vale mais dinheiro do que qualquer desconto: cada mês parado é uma conta de luz cheia que você paga.',
        whatsapp:
          'O valor já é o de fechamento. No à vista o que eu consigo é antecipar a obra pra próxima janela de instalação — cada mês parado é uma conta cheia que você paga.',
      },
      {
        id: 'juros-financiamento',
        gatilho: 'Com os juros do financiamento não compensa.',
        traducao: 'Ele olhou a parcela e o total pago, e não comparou com o que já gasta hoje.',
        erro:
          'Discutir taxa de juros. Você entra num terreno que o gerente do banco domina melhor que você.',
        script:
          'Vamos fazer diferente: esquece juros por um minuto. Hoje sua conta é de R$ [valor]. A parcela do financiamento ficaria em R$ [parcela]. Depois de quitado, sua conta vira a taxa mínima. A pergunta não é se tem juros — tem. É se você prefere pagar [parcela] por [prazo] anos e depois parar, ou pagar [valor] todo mês para sempre, subindo todo ano. Em [prazo] anos, você já terá pago à concessionária mais do que o sistema inteiro custa.',
        whatsapp:
          'Esquece os juros um minuto: hoje você paga R$ [valor] pra sempre, subindo todo ano. A parcela é R$ [parcela] e um dia acaba. A conta de luz nunca acaba.',
      },
      {
        id: 'esperar-baratear',
        gatilho: 'Vou esperar baratear mais / a tecnologia melhorar.',
        traducao: 'Ele não tem pressa porque ninguém mostrou o custo de esperar.',
        erro: 'Prometer que vai aumentar de preço. Se não aumentar, você queimou a credibilidade.',
        script:
          'Faz sentido, tecnologia sempre melhora. Só que enquanto você espera, você continua pagando R$ [valor] por mês para a distribuidora, e esse dinheiro não volta. Em doze meses de espera são R$ [valor×12] — que é mais ou menos [X]% do sistema. Esperar só compensa se o preço cair mais que isso no mesmo período, e ele não vem caindo nesse ritmo faz um bom tempo.',
        whatsapp:
          'Enquanto espera, você paga R$ [valor] por mês pra distribuidora e não volta. Em 12 meses são R$ [valor×12], quase [X]% do sistema. Só compensa esperar se o preço cair mais que isso.',
      },
      {
        id: 'muito-caro-generico',
        gatilho: 'Está fora do meu orçamento.',
        traducao:
          'Pode ser verdade, pode ser falta de valor percebido. Você precisa descobrir qual antes de responder.',
        erro: 'Cortar o sistema pela metade sem perguntar nada. Você entrega um sistema que não resolve e o cliente reclama depois.',
        script:
          'Entendo. Só para eu te ajudar direito: está fora do orçamento porque o valor total assusta, ou porque a parcela não cabe hoje? Se for a parcela, tenho como trabalhar prazo e entrada. Se for o total, a gente pode começar com um sistema menor que já corta [X]% da conta e deixar o telhado preparado para expandir no ano que vem — você não perde nada do que investir agora.',
        whatsapp:
          'Me ajuda a entender: é o valor total que assusta ou a parcela que não cabe? Se for parcela, trabalho prazo e entrada. Se for o total, começo menor cortando [X]% da conta e deixo preparado pra expandir.',
      },
    ],
  },
  {
    slug: 'adiamento',
    titulo: 'Enrolação e sumiço',
    descricao:
      'O "vou pensar" é a objeção mais cara do mercado, porque ninguém a trata como objeção. Estes seis scripts existem para transformar indecisão em data marcada.',
    itens: [
      {
        id: 'vou-pensar',
        gatilho: 'Vou pensar e te retorno.',
        traducao:
          'Quase sempre significa: tem uma dúvida que eu não falei em voz alta, ou tem alguém que preciso consultar.',
        erro: 'Aceitar e dizer "fico no aguardo". A partir daí, você virou refém do WhatsApp dele.',
        script:
          'Claro, é uma decisão importante e ninguém deve fechar na pressão. Só me ajuda numa coisa para eu não te encher: pensando bem, o que ainda está te travando — é o valor, é o prazo de obra, ou é confiar na empresa? Porque se for algo que eu consigo resolver agora, seria bobagem você ficar mais uma semana com a dúvida.',
        whatsapp:
          'Tranquilo, decisão importante. Só me diz o que ainda trava: é o valor, o prazo de obra ou confiar na empresa? Se for algo que eu resolvo agora, você não precisa ficar mais uma semana na dúvida.',
      },
      {
        id: 'manda-whatsapp',
        gatilho: 'Manda no WhatsApp que depois eu vejo.',
        traducao: 'Ele quer encerrar a conversa sem dizer não.',
        erro: 'Mandar o PDF e sumir. Proposta sem apresentação vira arquivo esquecido.',
        script:
          'Mando agora. Só que proposta de energia solar tem uns três números que, se eu não explicar, atrapalham mais do que ajudam — já vi cliente descartar sistema bom por ler errado. São dez minutos. Você prefere hoje às [hora] ou amanhã de manhã?',
        whatsapp:
          'Mandei! Tem uns 3 números aí que confundem se eu não explicar — já vi cliente descartar sistema bom por ler errado. 10 minutos: hoje às [hora] ou amanhã cedo?',
      },
      {
        id: 'falar-esposa-socio',
        gatilho: 'Preciso falar com minha esposa / meu sócio.',
        traducao: 'Legítimo — mas você acabou de perder o controle da apresentação.',
        erro:
          'Deixar ele apresentar sozinho. Ele vai repetir só o preço, e a decisão vai ser tomada sobre a pior versão da sua proposta.',
        script:
          'Perfeito, decisão de casa se toma junto mesmo. Só que se eu te mandar assim, você vai ter que explicar sozinho coisa que levei uma hora para te mostrar. Que tal a gente marcar quinze minutos com vocês dois juntos, pode ser por chamada de vídeo à noite? Aí ela pergunta direto para mim o que eu não souber responder você não fica no meio.',
        whatsapp:
          'Decisão de casa se toma junto mesmo. Faço 15 min por vídeo com vocês dois, pode ser à noite. Assim ela pergunta direto pra mim e você não fica no meio.',
      },
      {
        id: 'mais-orcamentos',
        gatilho: 'Quero ver mais dois ou três orçamentos.',
        traducao: 'Comportamento normal de compra. Não é rejeição.',
        erro: 'Desanimar e parar de acompanhar. Quem some vira o orçamento descartado.',
        script:
          'Faça isso mesmo, é o certo. E eu vou te ajudar: vou te mandar uma lista de cinco perguntas para fazer em todos os orçamentos, inclusive no meu. Se a empresa travar em alguma delas, é sinal de alerta. Quando tiver os outros em mãos, me chama que eu comparo tudo com você — comparar é a parte que ninguém faz direito.',
        whatsapp:
          'Faça sim. Vou te mandar 5 perguntas pra fazer em TODOS os orçamentos, inclusive no meu. Quando tiver os outros, me chama que eu comparo tudo com você.',
      },
      {
        id: 'sumiu',
        gatilho: 'Sumiu depois da proposta.',
        traducao: 'Não é desprezo. É que a proposta saiu do topo da lista dele.',
        erro:
          'Mandar "e aí, decidiu?" toda semana. Cobrança sem novidade cansa e te transforma em vendedor chato.',
        script:
          '[Nome], tudo bem? Não vim cobrar resposta. Passei porque saiu a leitura da sua conta deste mês e eu queria te mostrar uma coisa: a tarifa da [distribuidora] subiu de novo, e isso mudou o retorno da sua proposta de [X] para [Y] meses. Atualizei o cálculo, te mando aqui. Se você decidir não fazer agora, sem problema — só não quero que decida com número velho.',
        whatsapp:
          '[Nome], não vim cobrar resposta. A tarifa da [distribuidora] subiu e mudou o retorno da sua proposta de [X] pra [Y] meses. Atualizei o cálculo, tá aqui. Se decidir não fazer agora tudo bem, só não quero que decida com número velho.',
      },
      {
        id: 'ano-que-vem',
        gatilho: 'Ano que vem eu faço.',
        traducao: 'Adiamento com data inventada para encerrar a conversa educadamente.',
        erro: 'Aceitar e anotar "retornar em janeiro". Em janeiro ele nem lembra de você.',
        script:
          'Combinado. Só uma coisa para você levar em conta na hora de escolher o mês: instalação em [período de chuva/alta demanda da região] atrasa, e a fila da concessionária costuma engordar no fim do ano. Se a ideia é começar a economizar em [mês], o contrato precisa estar assinado uns dois meses antes. Posso te chamar em [mês-2] para a gente organizar? Aí você entra na fila no momento certo.',
        whatsapp:
          'Fechado. Só lembra: entre contrato e sistema gerando são uns 2 meses (projeto + obra + homologação). Se quer economizar a partir de [mês], te chamo em [mês-2] pra organizar?',
      },
    ],
  },
  {
    slug: 'confianca',
    titulo: 'Medo, risco e confiança',
    descricao:
      'Aqui o cliente não está discutindo dinheiro — está com medo de errar. Responder com número não resolve; responder com prova, sim.',
    itens: [
      {
        id: 'empresa-quebrar',
        gatilho: 'E se sua empresa fechar? Quem honra a garantia?',
        traducao: 'Objeção justa. O setor tem histórico de empresa que some.',
        erro: 'Jurar que nunca vai fechar. Ninguém acredita, e você soa ingênuo.',
        script:
          'Pergunta certíssima, e vou te responder com documento em vez de promessa. A garantia dos módulos é do fabricante, não minha — são [X] anos e valem mesmo se eu sumir. A do inversor é da [marca], que tem assistência no Brasil. O que é meu é a garantia de instalação, e ela está escrita no contrato com prazo e escopo. Além disso, o sistema fica homologado no seu CPF junto à concessionária: é seu, não meu. Quer que eu te mostre esses três documentos agora?',
        whatsapp:
          'Pergunta certa. Garantia dos módulos é do fabricante ([X] anos), a do inversor é da [marca] com assistência no Brasil, e a de instalação está escrita no meu contrato. O sistema é homologado no seu CPF. Te mando os 3 documentos?',
      },
      {
        id: 'granizo-tempestade',
        gatilho: 'E se cair granizo? E se der problema no telhado?',
        traducao: 'Ele está imaginando prejuízo, não questionando a tecnologia.',
        erro: 'Minimizar ("isso quase nunca acontece"). Você invalida o medo em vez de resolver.',
        script:
          'Acontece sim, e é por isso que existe seguro específico para sistema fotovoltaico — custa por volta de [X]% do valor ao ano e cobre granizo, vento, roubo e queda de raio. Eu já incluo a cotação junto da proposta. Sobre o telhado: antes da obra a gente faz vistoria e, se a estrutura precisar de reforço, isso entra no orçamento — eu prefiro te dizer isso agora do que descobrir com a obra começada.',
        whatsapp:
          'Acontece sim, por isso existe seguro fotovoltaico: ~[X]% do valor ao ano, cobre granizo, vento, roubo e raio. Já te mando a cotação junto. E o telhado a gente vistoria antes — se precisar reforço, entra no orçamento antes da obra.',
      },
      {
        id: 'lei-mudar',
        gatilho: 'Ouvi dizer que vão mudar a lei e acabar com a economia.',
        traducao:
          'Ele viu manchete de "taxação do sol" e não sabe separar o que já mudou do que ainda vai mudar.',
        erro:
          'Dizer "isso é fake news" — ou prometer uma regra de transição que não existe mais para quem entra hoje. A porta do direito adquirido fechou em 6 de janeiro de 2023, e o cliente confere isso em dois cliques no celular.',
        script:
          'Mudou, e já está valendo — é a Lei 14.300. Vou te falar exatamente como está: sobre a energia que SOBRA e vai para a rede você paga uma parte da tarifa de distribuição, o Fio B. Em 2026 é 60% dessa parcela, sobe para 75% em 2027 e 90% em 2028. Quem protocolou o pedido de acesso até 6 de janeiro de 2023 ficou fora dessa conta até 2045 — essa porta fechou, e eu não vou te prometer transição que não existe mais. O que muda no seu caso é outra coisa: a sua proposta já está calculada com a lei aplicada. O retorno de [X] anos que está ali é COM a taxa dentro, não sem ela. Quer que eu te mostre a linha?',
        whatsapp:
          'Mudou sim, Lei 14.300. Hoje o Fio B é 60% da parcela de distribuição, e só sobre o que sobra e vai pra rede — o que você usa na hora não paga nada. Sobe pra 75% em 2027 e 90% em 2028. Sua proposta já está calculada COM isso: retorno em [X] anos. Te mostro a linha?',
      },
      {
        id: 'vender-casa',
        gatilho: 'E se eu vender a casa?',
        traducao: 'Ele acha que o investimento fica preso no imóvel e ele perde.',
        erro: 'Responder "aí você leva o sistema". Tecnicamente possível, mas soa amador.',
        script:
          'Duas saídas, as duas boas. A primeira é que sistema instalado valoriza o imóvel — casa com conta de luz de R$ 60 vende mais rápido e por mais, é argumento de anúncio. A segunda é que dá para desinstalar e reinstalar no novo endereço, com custo de mão de obra. Na prática, quase todo mundo escolhe a primeira quando vê a diferença no valor de venda.',
        whatsapp:
          'Duas saídas: casa com conta de R$ 60 vende mais rápido e por mais (vira argumento de anúncio), ou a gente desinstala e reinstala no novo endereço. Quase todo mundo escolhe deixar.',
      },
      {
        id: 'nunca-ouvi-falar',
        gatilho: 'Nunca ouvi falar da sua empresa.',
        traducao: 'Ele quer prova social antes de assinar.',
        erro: 'Falar de si mesmo. "Somos sérios, temos anos de mercado" não prova nada.',
        script:
          'Justo. Em vez de eu falar de mim, faz assim: eu te passo o endereço de duas instalações que fiz aqui perto, e o telefone dos clientes. Liga para eles e pergunta o que quiser, inclusive se deu algum problema — vai dar, obra sempre tem, o que importa é como foi resolvido. E se quiser, eu te levo para ver um sistema funcionando antes de você assinar qualquer coisa.',
        whatsapp:
          'Justo! Te passo o endereço de 2 instalações aqui perto e o telefone dos clientes. Liga e pergunta o que quiser, inclusive se deu problema. Se quiser, te levo pra ver um sistema funcionando antes de assinar.',
      },
      {
        id: 'painel-dura-quanto',
        gatilho: 'Isso dura quanto tempo? Vale a pena mesmo?',
        traducao: 'Ele quer saber se vai trocar tudo daqui a cinco anos.',
        erro: 'Responder só "25 anos de garantia". Número solto não convence ninguém.',
        script:
          'O módulo tem garantia de performance de [X] anos — significa que o fabricante garante que ele ainda vai gerar pelo menos [Y]% no fim desse prazo. Ele não para de funcionar, só perde eficiência bem devagar. O que costuma ser trocado uma vez na vida do sistema é o inversor, por volta do [Z]º ano, e isso já está considerado no cálculo de retorno que eu te mostrei. Ou seja: mesmo trocando o inversor, o payback é o que está ali.',
        whatsapp:
          'Módulo tem garantia de performance de [X] anos ([Y]% no fim do prazo) — não para, só perde eficiência devagar. O inversor costuma ser trocado uma vez, lá pelo ano [Z], e isso já está no cálculo de retorno que te mandei.',
      },
    ],
  },
  // ATENÇÃO, REVISAR EM JANEIRO: este grupo e a objeção `lei-mudar` (grupo
  // 'confianca') citam o percentual do Fio B do ano corrente — 60% em 2026, 75%
  // em 2027, 90% em 2028, e depois disso o que a ANEEL definir. Em 1º de janeiro
  // as duas ficam erradas dentro de um produto pago. São os únicos textos do
  // curso presos ao calendário; o resto não envelhece.
  {
    slug: 'mercado-2026',
    titulo: 'O mercado de 2026: taxa, assinatura e bateria',
    descricao:
      'Objeções que não existiam há três anos. O cliente chega com elas já tendo lido alguma coisa — quase sempre pela metade. Quem explica primeiro, e explica direito, fica com a confiança.',
    itens: [
      {
        id: 'fio-b-taxa',
        gatilho: 'Agora tem taxa, né? A conta não zera mais.',
        traducao:
          'Ele viu "taxação do sol" em algum lugar e acha que a economia inteira foi embora.',
        erro:
          'Dizer que "quase não muda". Ele vai ver a linha na conta depois da obra e lembrar que você minimizou — é assim que se perde indicação.',
        script:
          'Tem sim, e eu vou te mostrar exatamente quanto. Chama Fio B: você paga uma parte da tarifa de rede sobre a energia que SOBRA e vai para a rede. Sobre a que você consome na hora em que gera, não incide nada. Hoje é 60% dessa parcela, em 2027 vai para 75% e em 2028 para 90%. Na sua proposta isso já está calculado: o retorno de [X] anos é com a taxa dentro. E tem um detalhe que quase ninguém te conta: quanto mais você usa energia no mesmo horário em que gera, menos sobra e menos Fio B você paga. Foi por isso que eu dimensionei do jeito que dimensionei.',
        whatsapp:
          'Tem sim, chama Fio B. Só que ele incide sobre o que SOBRA e vai pra rede — o que você usa na hora que gera não paga nada. Hoje é 60% dessa parcela. Sua proposta já está calculada COM a taxa: retorno em [X] anos. Te mostro a linha?',
      },
      {
        id: 'vizinho-isento',
        gatilho: 'Meu vizinho instalou antes e não paga essa taxa.',
        traducao:
          'Ele está certo, e está sentindo que perdeu o bonde. Se você negar, perde a confiança na hora.',
        erro:
          'Fingir que a regra é igual para todo mundo. Ele confirma com o vizinho no mesmo dia e você vira o vendedor que mentiu.',
        script:
          'Ele está certo, e é justo você saber: quem protocolou o pedido de acesso até 6 de janeiro de 2023 ficou com a regra antiga — 1 kWh injetado vale 1 kWh consumido — até 2045. Essa porta fechou e não volta. Agora repara no que isso muda de verdade para você: mesmo pagando o Fio B, o seu retorno é de [X] anos, e depois dele são mais de quinze anos de energia que você não paga. A pergunta não é se você conseguiu a regra do vizinho. É se, com a regra de hoje, ainda se paga. E se paga — está tudo na proposta, pode conferir comigo linha por linha.',
        whatsapp:
          'Ele tá certo: quem protocolou até 06/01/2023 ficou na regra antiga até 2045, e essa porta fechou. Mas veja o que importa pro seu caso: mesmo com o Fio B, seu retorno é [X] anos e depois são 15+ anos sem pagar energia. Confere comigo linha por linha?',
      },
      {
        id: 'assinatura-sem-investir',
        gatilho: 'Me ofereceram desconto na conta sem investir nada. Por que eu compraria?',
        traducao:
          'Ele comparou "20% de desconto de graça" com "R$ [preço] do meu bolso" e a conta pareceu óbvia.',
        erro:
          'Falar mal da empresa de assinatura. São modelos diferentes, e o cliente percebe na hora que você fugiu da comparação.',
        script:
          'É um modelo legítimo, e eu até te digo quando ele é melhor: quem aluga o imóvel, quem não tem telhado, quem não quer investir agora. Mas compara na régua certa, em dois pontos. Primeiro: aquele desconto incide só sobre a parcela de consumo da conta, não sobre a conta cheia — 20% anunciado costuma virar de 12% a 18% de verdade quando chega o boleto. Segundo, e é o que pesa: é desconto para sempre. Você paga todo mês, para sempre, e no fim não é dono de nada. O sistema tem fim: em [X] anos ele está pago, a economia passa a ser 100% sua e o imóvel valorizou. Faz o seguinte, pede o contrato deles e me manda. Eu monto os dois lado a lado em 25 anos. Se o deles ganhar no seu caso, eu mesmo te falo.',
        whatsapp:
          'Modelo legítimo — serve bem pra quem aluga ou não quer investir. Só compara certo: o desconto deles incide só sobre a parcela de consumo (20% anunciado vira 12-18% na conta cheia) e é pra sempre, você nunca fica dono. O seu sistema se paga em [X] anos e depois a economia é 100% sua. Me manda o contrato deles que eu comparo os dois em 25 anos.',
      },
      {
        id: 'so-com-bateria',
        gatilho: 'Só faço se vier com bateria.',
        traducao:
          'Ou ele quer autonomia no apagão, ou ouviu que bateria é o futuro e não quer comprar algo que já nasce velho.',
        erro:
          'Vender bateria só para não perder a venda. Você quase dobra o orçamento, estoura o payback e perde o cliente pelo preço — depois de ter tido o sim.',
        script:
          'Dá para fazer, e eu te mando as duas propostas. Antes me responde uma coisa: você quer bateria para não ficar sem luz quando cai, ou para economizar mais? Se for para não ficar sem luz, a gente dimensiona só para o essencial — geladeira, luz, internet, bomba — e sai bem mais barato do que segurar a casa inteira. Se for para economizar, eu vou ser honesto com você: na maioria dos casos a bateria ainda não se paga sozinha, o retorno dela fica entre 7 e 10 anos e só fecha bem em tarifa alta. Meu conselho é fazer o sistema agora e deixar o inversor preparado para receber bateria depois — o preço dela caiu quase 40% em um ano, e você compra quando fizer sentido, não agora.',
        whatsapp:
          'Dá pra fazer e te mando as duas propostas. Só me diz: bateria pra não ficar sem luz na queda, ou pra economizar mais? Pra não ficar sem luz dá pra dimensionar só o essencial (geladeira, luz, internet) e sai bem mais barato. Pra economizar, hoje ela ainda não se paga sozinha na maioria dos casos.',
      },
      {
        id: 'queda-de-energia',
        gatilho: 'Se faltar luz na rua, minha casa continua acesa, né?',
        traducao:
          'Quase todo cliente acha que sim. E se você deixar ele achar, a primeira queda de energia vira reclamação.',
        erro:
          'Deixar passar ou responder por cima. Essa é a decepção número um do pós-obra, e é 100% evitável em trinta segundos de visita.',
        script:
          'Não, e é muito melhor você saber isso hoje do que no primeiro apagão. Sistema conectado à rede desliga junto quando a energia cai, por segurança: se ele continuasse injetando, colocaria em risco o eletricista que está consertando o poste. É norma, vale para qualquer instalador, não é limitação do meu sistema. Para continuar com luz na queda existem duas saídas: bateria com inversor híbrido, ou gerador. Se isso é importante para você, eu já te faço a proposta com a bateria dimensionada só para o essencial. Se não for, você economiza esse dinheiro e a gente segue.',
        whatsapp:
          'Não — e é melhor saber hoje do que no primeiro apagão. Sistema ligado na rede desliga junto por segurança (pra não eletrocutar quem está consertando o poste). Vale pra qualquer instalador. Pra ter luz na queda, só com bateria ou gerador. Quer a proposta com bateria só pro essencial?',
      },
    ],
  },
  {
    slug: 'tecnica',
    titulo: 'Objeções técnicas do imóvel',
    descricao:
      'Sempre aparecem depois da visita. Quem responde com clareza aqui fecha; quem responde com jargão perde o cliente que não quis perguntar de novo.',
    itens: [
      {
        id: 'sem-espaco',
        gatilho: 'Meu telhado é pequeno / não tem espaço.',
        traducao: 'Ele viu uma foto de usina no Google e imaginou o telhado inteiro coberto.',
        erro: 'Confirmar sem medir. Você desiste de um cliente que caberia com módulo de maior potência.',
        script:
          'Vamos medir antes de descartar. Para o seu consumo de [X] kWh eu preciso de aproximadamente [Y] m², e hoje existe módulo de potência mais alta que ocupa menos área para a mesma geração. E se realmente não couber tudo, dá para fazer o sistema que cabe: em vez de zerar a conta, a gente corta [Z]% dela — que já paga o investimento.',
        whatsapp:
          'Vamos medir antes de descartar. Pro seu consumo preciso de ~[Y] m², e hoje tem módulo de mais potência que ocupa menos área. Se não couber tudo, faço o que cabe e corto [Z]% da conta.',
      },
      {
        id: 'telhado-velho',
        gatilho: 'Meu telhado é antigo, será que aguenta?',
        traducao: 'Preocupação legítima com goteira e reforma futura.',
        erro:
          'Garantir que aguenta sem subir no telhado. É assim que integrador entra em obra que dá prejuízo.',
        script:
          'Boa pergunta, e é exatamente por isso que a vistoria vem antes do contrato. Se a estrutura precisar de reforço ou troca de telha, eu te falo antes, com o custo. E vou ser direto: se o seu telhado for ser reformado nos próximos dois anos, o certo é fazer as duas coisas juntas — desinstalar e reinstalar depois custa dinheiro à toa.',
        whatsapp:
          'Por isso a vistoria vem antes do contrato. Se precisar reforço, te falo antes com o custo. E se você pretende reformar o telhado nos próximos 2 anos, o certo é fazer junto — desinstalar e reinstalar depois custa à toa.',
      },
      {
        id: 'sombra',
        gatilho: 'Tem uma árvore/prédio que faz sombra.',
        traducao: 'Ele acha que sombra inutiliza o sistema inteiro.',
        erro: 'Ignorar a sombra para não perder a venda. Ela aparece na geração e vira reclamação.',
        script:
          'Sombra atrapalha, mas hoje tem solução: com microinversor ou otimizador, o módulo sombreado não derruba a fileira inteira. O que eu faço é medir o sombreamento ao longo do dia e te mostrar a perda real em percentual — aí você decide com número na mão, não com achismo. Em muitos casos a perda é bem menor do que parece olhando de baixo.',
        whatsapp:
          'Sombra atrapalha, mas com microinversor/otimizador o módulo sombreado não derruba a fileira toda. Vou medir o sombreamento ao longo do dia e te mostrar a perda real em %, aí você decide com número.',
      },
      {
        id: 'conta-baixa',
        gatilho: 'Minha conta é baixa, não vale a pena.',
        traducao: 'Ele nunca somou 25 anos de conta baixa.',
        erro: 'Concordar e ir embora. Conta baixa com tarifa subindo ainda paga sistema pequeno.',
        script:
          'Vamos conferir juntos. Sua conta é de R$ [valor]. Em dez anos, só com o reajuste médio da [distribuidora], isso vira algo perto de R$ [total]. O sistema que atende você custa R$ [preço]. Mesmo com conta baixa, o retorno sai em [X] anos — e depois disso são mais de quinze anos de energia que você não paga. Conta baixa não é motivo para não fazer; é motivo para fazer um sistema menor.',
        whatsapp:
          'Vamos conferir: R$ [valor] por mês vira ~R$ [total] em 10 anos com reajuste. O sistema pro seu perfil custa R$ [preço] e se paga em [X] anos. Conta baixa não é motivo pra não fazer, é motivo pra fazer menor.',
      },
      {
        id: 'imovel-alugado',
        gatilho: 'A casa não é minha, eu alugo.',
        traducao:
          'Ele quer, mas acha que investir no telhado dos outros é jogar dinheiro fora. Do jeito que ele pensou, é mesmo.',
        erro:
          'Descartar o cliente na hora. Ele quase sempre tem outro imóvel no nome — ou te abre a porta do proprietário, que é quem você deveria estar visitando.',
        script:
          'Você tem razão em não querer investir no telhado de terceiro. Mas tem três caminhos aqui, e um deles quase sempre serve. Primeiro: você tem outro imóvel no seu nome? Como a compensação vale para o mesmo titular dentro da mesma distribuidora, dá para instalar lá e abater a conta daqui. Segundo: se você pretende ficar anos nesse endereço, o sistema é desinstalável — quando sair, vai com você, o custo é de mão de obra. Terceiro, o mais comum: eu converso com o proprietário. Sistema instalado valoriza o imóvel dele e ele pode compor parte do valor no aluguel — é uma conversa que muito locador já topou. Quer que eu prepare os números para você mostrar para ele?',
        whatsapp:
          'Certo em não investir no telhado de terceiro. Três saídas: (1) tem outro imóvel no seu nome? dá pra instalar lá e abater a conta daqui, mesma distribuidora; (2) o sistema é desinstalável e vai com você; (3) eu falo com o proprietário — valoriza o imóvel dele e ele pode compor no aluguel. Quer que eu prepare os números?',
      },
    ],
  },
  {
    slug: 'fechamento',
    titulo: 'Hora de assinar',
    descricao:
      'Três falas para o momento em que o cliente já disse sim com a cabeça mas ainda não assinou nada.',
    itens: [
      {
        id: 'fechamento-alternativa',
        gatilho: 'O cliente concordou com tudo e ficou em silêncio.',
        traducao: 'Ele está esperando você conduzir. Silêncio depois da apresentação é convite.',
        erro: 'Perguntar "e aí, o que achou?". Devolve a decisão para ele sem caminho.',
        script:
          'Pelo que a gente conversou, faz sentido para você. Então me diz só uma coisa: você prefere que eu já reserve o equipamento para a obra em [data A], ou prefere a janela de [data B]? Eu seguro a agenda com a assinatura do contrato — o pagamento segue o cronograma que combinamos.',
        whatsapp:
          'Faz sentido pra você então. Prefere que eu reserve a obra pra [data A] ou [data B]? Seguro a agenda com a assinatura e o pagamento segue o cronograma que combinamos.',
      },
      {
        id: 'ultima-duvida',
        gatilho: 'Ele hesita, mas não diz o motivo.',
        traducao: 'Existe uma última pedra no sapato que ele acha bobagem falar.',
        erro: 'Empurrar. Pressão em cima de dúvida não dita gera cancelamento depois.',
        script:
          'Sinto que ficou uma coisinha. Pode falar, mesmo que pareça bobagem — prefiro resolver agora do que você assinar com dúvida e ficar remoendo. O que é?',
        whatsapp:
          'Sinto que ficou uma coisinha. Pode falar mesmo que pareça bobagem — melhor resolver agora do que você assinar com dúvida.',
      },
      {
        id: 'pos-assinatura',
        gatilho: 'Assinou. E agora?',
        traducao:
          'O arrependimento mora nas 48 horas seguintes, quando ele conta para alguém e ouve uma opinião.',
        erro: 'Sumir até o dia da obra. É aí que nasce pedido de cancelamento.',
        script:
          'Parabéns, decisão certa. Agora o que acontece: hoje eu já protocolo o projeto, em até [X] dias sai a aprovação, a obra é em [data] e leva [Y] dias. Vou te mandar mensagem em cada uma dessas etapas, mesmo que não tenha novidade — você não vai ficar no escuro em momento nenhum. Qualquer dúvida antes disso, me chama direto.',
        whatsapp:
          'Parabéns! Hoje já protocolo o projeto, aprovação em até [X] dias, obra em [data] levando [Y] dias. Te aviso em cada etapa mesmo sem novidade — você não fica no escuro.',
      },
    ],
  },
];

export const TOTAL_OBJECOES = OBJECOES.reduce((n, g) => n + g.itens.length, 0);
