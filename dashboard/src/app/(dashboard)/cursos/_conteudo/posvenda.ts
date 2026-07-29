// Kit de Fechamento do Integrador — Módulo 6: pós-venda, garantia e recorrência.
// O que acontece depois do "sim" define se você vende uma vez ou se aquele
// cliente vira três vendas.

export type EtapaPos = {
  id: string;
  janela: string;
  titulo: string;
  oQueFazer: string[];
  mensagem?: string;
  risco: string;
};

export const POS_VENDA: EtapaPos[] = [
  {
    id: 'primeiras-48h',
    janela: 'Primeiras 48 horas',
    titulo: 'Blindar o arrependimento',
    oQueFazer: [
      'Mande o cronograma completo no mesmo dia da assinatura, com as datas de cada etapa.',
      'Explique o que pode atrasar e por quê (parecer de acesso da distribuidora é o principal).',
      'Diga em que dias ele vai ouvir de você — e cumpra, mesmo quando não houver novidade.',
      'Adicione o cliente num grupo com você e o responsável técnico, se sua operação permitir.',
    ],
    mensagem:
      '[Nome], contrato assinado! Como vai ser daqui pra frente: hoje eu protocolo o projeto na [distribuidora], o parecer sai em até [X] dias úteis, a obra está marcada pra [data] e leva [Y] dias. Depois disso vem a vistoria e a troca do medidor, que é a parte que depende só deles. Vou te avisar em cada etapa, mesmo que seja pra dizer que está tudo correndo normal.',
    risco:
      'É nas 48 horas seguintes que ele conta pra alguém e ouve "poxa, eu teria pesquisado mais". Silêncio nesse intervalo é o que vira pedido de cancelamento.',
  },
  {
    id: 'durante-obra',
    janela: 'Durante o projeto e a obra',
    titulo: 'Comunicar antes de ser cobrado',
    oQueFazer: [
      'Avise no dia do protocolo e mande o número dele.',
      'Se vier exigência da distribuidora, comunique no mesmo dia — com a data nova, não só o problema.',
      'Mande foto da equipe montando no telhado dele. Cliente adora ver a obra andando.',
      'No dia de ligar, esteja presente e mostre o app de monitoramento funcionando.',
    ],
    mensagem:
      '[Nome], atualização: a distribuidora pediu um ajuste no projeto (isso é rotina, acontece em boa parte dos casos). Já reenviei hoje. A previsão nova de parecer é [data] — o resto do cronograma segue igual.',
    risco:
      'Cliente que descobre atraso perguntando é cliente que perde a confiança. O mesmo atraso comunicado por você antes vira competência.',
  },
  {
    id: 'primeira-conta',
    janela: '30 a 45 dias depois de ligar',
    titulo: 'A primeira conta é o seu melhor material de marketing',
    oQueFazer: [
      'Pergunte o valor da primeira conta e comemore junto.',
      'Explique a taxa mínima (custo de disponibilidade) ANTES que ele estranhe — é a reclamação nº 1 do pós-venda.',
      'Peça o print da conta e o depoimento em vídeo neste momento, não depois.',
      'Peça a indicação aqui: é o pico de satisfação da relação inteira.',
    ],
    mensagem:
      '[Nome], chegou a conta desse mês? Me manda o valor! E já adianto uma coisa pra você não estranhar: mesmo gerando tudo, a conta nunca zera — fica a taxa mínima da distribuidora, que é de [valor] pra ligação [mono/bi/trifásica]. É cobrança dela pra manter a rede disponível, não é erro do sistema.',
    risco:
      'Quem não explica a taxa mínima recebe uma mensagem irritada no segundo mês. Explicar antes transforma a mesma informação em prova de transparência.',
  },
  {
    id: 'recorrencia',
    janela: 'A cada 6 meses',
    titulo: 'Transformar cliente em receita recorrente',
    oQueFazer: [
      'Monte uma agenda de limpeza e revisão semestral da sua base inteira.',
      'Cobre pelo serviço: limpeza e inspeção têm preço, e o cliente paga quando entende a perda de geração.',
      'Use a visita para checar a geração no app e mostrar o que ele economizou no período.',
      'Toda visita de manutenção é uma oportunidade de indicação e de ampliação do sistema.',
    ],
    mensagem:
      '[Nome], tudo bem? Já faz [X] meses da instalação e é a janela de limpeza e revisão do sistema. Placa suja pode derrubar a geração e a maioria das pessoas nem percebe, porque a queda é gradual. Consigo passar aí em [data] — faço a limpeza, confiro as conexões e te mando um relatório da geração do período.',
    risco:
      'Sem agenda ativa, esse cliente só volta a falar com você quando der problema. E aí a conversa começa no lugar errado.',
  },
  {
    id: 'ampliacao',
    janela: 'Entre 12 e 24 meses',
    titulo: 'A segunda venda para o mesmo cliente',
    oQueFazer: [
      'Monitore quem passou a gerar menos do que consome (comprou ar-condicionado, carro elétrico, teve filho).',
      'Ofereça ampliação com base no dado, não no achismo: mostre o gráfico do próprio sistema dele.',
      'Ofereça o sistema para o outro imóvel — chácara, casa dos pais, ponto comercial.',
      'Peça indicação de novo, agora com autoridade de quem entregou e acompanhou.',
    ],
    mensagem:
      '[Nome], olhei sua geração dos últimos meses e seu consumo subiu — você está usando mais do que o sistema produz e voltou a pagar energia acima da mínima. Dá pra ampliar com [X] módulos e voltar a zerar. Quer que eu faça a conta?',
    risco:
      'Se você não fizer essa oferta, ela vai ser feita — por outra empresa, que vai levar seu cliente e a manutenção junto.',
  },
];

export const GARANTIAS = {
  titulo: 'O que dizer quando perguntarem de garantia',
  intro:
    'Garantia é o assunto em que o integrador mais fala bobagem por não separar as três coisas. São três, com donos diferentes:',
  itens: [
    {
      tipo: 'Garantia dos módulos',
      dono: 'Fabricante',
      texto:
        'São duas coisas juntas: garantia contra defeito de fabricação e garantia de PERFORMANCE (o fabricante garante um percentual mínimo de geração ao fim do prazo). Confira sempre os dois números na ficha técnica do modelo que você vende — e diga o número, não "vinte e cinco anos" genérico.',
    },
    {
      tipo: 'Garantia do inversor',
      dono: 'Fabricante / assistência no Brasil',
      texto:
        'Prazo menor que o dos módulos, e é a peça que costuma ser trocada uma vez na vida do sistema. Confirme se a marca tem assistência no país e se a extensão de garantia vale a pena. Isso muda a conversa de preço com o cliente.',
    },
    {
      tipo: 'Garantia de instalação',
      dono: 'Você',
      texto:
        'A única que é sua. Precisa estar ESCRITA no contrato, com prazo e escopo — o que cobre (infiltração causada pela fixação, mau contato, ajuste de estrutura) e o que não cobre (dano por granizo, reforma do telhado feita por terceiros). É essa cláusula que responde à objeção "e se sua empresa fechar".',
    },
  ],
  fechamento:
    'Regra prática: nunca prometa em palavra o que não está no papel. Mostre a cláusula do contrato na tela, no momento da objeção — vale mais que qualquer discurso.',
};
