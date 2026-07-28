// Conteúdo do Kit de Fechamento do Integrador — Módulo 1: 20 objeções.
// Texto é produto: entregue ao comprador do kit (R$27) dentro da plataforma.
// Editar aqui altera o material para todos os compradores (sem redeploy de dados).

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
        traducao: 'Ele viu manchete sobre a Lei 14.300 e não sabe como ela funciona.',
        erro: 'Dizer "isso é fake news". Você trata o cliente como desinformado e ele fecha.',
        script:
          'Você ouviu certo, mudou mesmo — a Lei 14.300 criou uma cobrança gradual sobre a energia injetada na rede. Duas coisas importantes: primeiro, quem homologa o sistema entra numa regra de transição que garante condição melhor por anos; segundo, essa cobrança é sobre o excedente, não sobre o que você consome direto. É por isso, aliás, que quanto antes homologar, melhor a sua regra. Quer que eu te mostre na proposta como a lei já está calculada no seu retorno?',
        whatsapp:
          'Mudou sim, é a Lei 14.300. Mas quem homologa antes entra na regra de transição, e a cobrança é só sobre o excedente injetado. Sua proposta já está calculada com a lei — te mostro onde?',
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
