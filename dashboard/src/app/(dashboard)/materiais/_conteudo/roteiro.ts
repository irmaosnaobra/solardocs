// Kit de Fechamento do Integrador — Módulo 2: roteiro da visita até a assinatura.

export type PassoRoteiro = {
  id: string;
  fase: string;
  titulo: string;
  objetivo: string;
  /** O que fazer, em ordem */
  acoes: string[];
  /** Fala pronta para o momento */
  fala?: string;
  /** Erro que mata a venda nesta etapa */
  armadilha: string;
};

export const ROTEIRO: PassoRoteiro[] = [
  {
    id: 'pre-visita',
    fase: 'Antes de sair de casa',
    titulo: 'Qualificar por telefone em 4 perguntas',
    objetivo:
      'Não gastar meio dia de carro com quem não vai comprar. Visita é o recurso mais caro que você tem.',
    acoes: [
      'Pergunte o valor médio da conta de luz dos últimos 3 meses (não o do mês passado — conta de verão engana).',
      'Pergunte se o imóvel é próprio e se o titular da conta é quem está falando com você.',
      'Pergunte o tipo de telhado: cerâmica, fibrocimento, metálico ou laje.',
      'Pergunte quando ele pretende instalar: este mês, este semestre ou "só olhando".',
      'Peça a foto da conta pelo WhatsApp antes da visita — você já chega com o dimensionamento pronto.',
    ],
    fala:
      'Antes de eu marcar a visita, me manda uma foto da sua conta de luz? Assim eu já chego com o projeto dimensionado em vez de gastar seu tempo tirando medida no escuro.',
    armadilha:
      'Marcar visita sem ver a conta. Você chega, faz cara de cálculo, promete mandar depois — e perde o momento de maior interesse do cliente, que é enquanto você está lá.',
  },
  {
    id: 'chegada',
    fase: 'Primeiros 10 minutos',
    titulo: 'Não fale de painel. Fale da conta dele.',
    objetivo: 'Fazer o cliente dizer em voz alta quanto ele odeia pagar energia.',
    acoes: [
      'Sente-se com a conta na mão, junto com ele.',
      'Aponte o histórico de 12 meses impresso na própria conta e some com ele o total do ano.',
      'Pergunte: "você lembra quanto era isso há três anos?"',
      'Só depois disso fale que existe solução.',
    ],
    fala:
      'Antes de eu falar de sistema, olha aqui: nos últimos doze meses você pagou R$ [total] para a distribuidora. Isso é [comparação: uma viagem, uma moto, uma reforma]. E esse número sobe todo ano, independente do que a gente faça hoje.',
    armadilha:
      'Abrir o notebook e começar por especificação técnica. Ninguém compra inversor; as pessoas compram parar de pagar conta.',
  },
  {
    id: 'vistoria',
    fase: 'Vistoria técnica',
    titulo: 'Subir no telhado com o cliente olhando',
    objetivo:
      'Transformar inspeção em prova de competência. É o momento em que você se diferencia de quem só manda PDF.',
    acoes: [
      'Fotografe: telhado inteiro, estrutura por dentro, padrão de entrada, disjuntor geral e o local do inversor.',
      'Meça a área útil e verifique a orientação (norte é o ideal no Brasil; leste/oeste perde pouco).',
      'Observe sombreamento em pelo menos dois horários — ou pergunte sobre árvores e prédios vizinhos.',
      'Cheque o padrão de entrada: monofásico, bifásico ou trifásico. Isso muda o projeto e às vezes exige troca de padrão.',
      'Narre em voz alta o que está vendo, mesmo o que está bom.',
    ],
    fala:
      'Vou te falando o que estou vendo: a estrutura está boa, a orientação é [direção] — vamos perder uns [X]% em relação ao norte puro, o que já entra no meu cálculo. O padrão de entrada é [tipo] e serve. Vou fotografar tudo e as fotos vão junto da proposta.',
    armadilha:
      'Fazer a vistoria sozinho e em silêncio. O cliente não vê valor no que não acompanha, e depois compara sua proposta com a de quem nem subiu no telhado.',
  },
  {
    id: 'proposta',
    fase: 'Apresentação',
    titulo: 'Apresentar três números, não trinta',
    objetivo:
      'Fazer o cliente entender a proposta sozinho, para que ele consiga defendê-la para o cônjuge ou sócio depois.',
    acoes: [
      'Número 1: quanto ele paga hoje por mês e por ano.',
      'Número 2: quanto vai pagar depois do sistema (taxa mínima + eventual excedente).',
      'Número 3: em quantos meses o sistema se paga.',
      'Só depois: marca dos equipamentos, garantias e prazo de obra.',
      'Entregue impresso. Papel na mão do cliente vale mais que PDF no WhatsApp.',
    ],
    fala:
      'São três números que importam. Hoje: R$ [A] por mês. Depois: R$ [B] por mês. Retorno: [C] meses. Todo o resto que está aqui — marca, garantia, prazo — serve para sustentar esses três.',
    armadilha:
      'Apresentar dez páginas de dados técnicos. Quanto mais complexa a proposta, mais o cliente decide pelo preço, porque é a única coisa que ele consegue comparar.',
  },
  {
    id: 'fechamento',
    fase: 'Fechamento',
    titulo: 'Pedir a assinatura com data de obra na mesa',
    objetivo: 'Sair com contrato ou com a próxima etapa marcada. Nunca com "vou pensar" solto.',
    acoes: [
      'Pergunte se ficou alguma dúvida antes de falar de pagamento.',
      'Ofereça duas datas de obra em vez de perguntar se ele quer fechar.',
      'Se ele hesitar, use o script "última dúvida" do Módulo 1.',
      'Se não fechar hoje, saia com data e hora marcadas para a próxima conversa — no calendário, na frente dele.',
    ],
    fala:
      'Ficou alguma dúvida? [pausa] Então me diz: obra na semana de [data A] ou de [data B]? Eu reservo a agenda e o equipamento com a assinatura, e o pagamento segue o cronograma que combinamos.',
    armadilha:
      'Encerrar com "qualquer coisa me chama". Isso transfere a responsabilidade do próximo passo para quem tem menos interesse em dar o próximo passo.',
  },
  {
    id: 'pos',
    fase: 'Pós-assinatura',
    titulo: 'Blindar as primeiras 48 horas',
    objetivo:
      'Evitar arrependimento. A maioria dos cancelamentos acontece depois que o cliente conta para alguém.',
    acoes: [
      'Mande no mesmo dia uma mensagem com o cronograma completo, etapa por etapa.',
      'Avise em cada etapa, mesmo quando não houver novidade.',
      'No dia da homologação, mande foto do protocolo.',
      'Uma semana depois de ligar o sistema, peça o depoimento — é o melhor momento, o cliente está encantado com a primeira conta baixa.',
    ],
    fala:
      'Te mandei o cronograma completo. Vou te avisar em cada etapa, mesmo que seja para dizer que está tudo correndo normal. Você não vai precisar me caçar para saber o que está acontecendo.',
    armadilha:
      'Sumir até o dia da obra. O silêncio é lido como problema, e cliente inseguro liga para o concorrente para "tirar uma dúvida".',
  },
];

export const CINCO_PERGUNTAS = {
  titulo: 'As 5 perguntas para o cliente fazer em todos os orçamentos',
  intro:
    'Entregue esta lista ao cliente que quer comparar propostas — inclusive para usar contra a sua. Quem tem proposta honesta ganha com a comparação; quem inflou o orçamento trava na pergunta 2.',
  perguntas: [
    'Qual a marca e a potência dos módulos e do inversor? (marca genérica ou "similar" é sinal de alerta)',
    'A garantia de instalação está escrita no contrato, com prazo e escopo? Posso ver a cláusula?',
    'Quem faz o projeto elétrico e a homologação na concessionária, e isso está incluso no preço?',
    'Qual a geração estimada em kWh por mês e qual o software usado para calcular?',
    'Me passa o endereço e o contato de dois clientes que vocês instalaram nos últimos seis meses.',
  ],
};
