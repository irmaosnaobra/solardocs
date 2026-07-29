// Kit de Fechamento do Integrador — Módulo 5: prospecção e follow-up.
// Mensagens para copiar, colar e adaptar. Cada uma diz QUANDO usar e POR QUE
// funciona — quem entende o porquê adapta; quem só copia trava na primeira
// resposta diferente.

export type Mensagem = {
  id: string;
  situacao: string;
  quando: string;
  texto: string;
  porque: string;
};

export type BlocoMensagens = {
  slug: string;
  titulo: string;
  descricao: string;
  mensagens: Mensagem[];
};

export const PROSPECCAO: BlocoMensagens[] = [
  {
    slug: 'primeiro-contato',
    titulo: 'Primeiro contato',
    descricao:
      'A primeira mensagem tem um único trabalho: conseguir a segunda. Nenhuma delas tenta vender sistema — todas pedem uma informação pequena, porque pergunta fácil é respondida.',
    mensagens: [
      {
        id: 'indicacao',
        situacao: 'Veio por indicação',
        quando: 'Até 2 horas depois de receber o contato. Indicação esfria em um dia.',
        texto:
          'Oi [Nome], tudo bem? Aqui é o [Seu nome], da [Empresa]. O [quem indicou] me passou seu contato — falou que você tava querendo entender melhor essa parte de energia solar. Posso te mandar uma simulação rápida do quanto ficaria a sua conta? Só preciso de uma foto da conta de luz.',
        porque:
          'Cita quem indicou logo na primeira linha: é o que separa você de um número desconhecido. E o pedido é uma foto, não uma reunião.',
      },
      {
        id: 'lead-anuncio',
        situacao: 'Preencheu formulário / clicou no anúncio',
        quando: 'Nos primeiros 5 minutos. Depois de 1 hora a chance de resposta despenca.',
        texto:
          'Oi [Nome]! Vi que você pediu a simulação de energia solar aqui no [Instagram/Facebook]. Sou o [Seu nome], da [Empresa], aqui de [cidade]. Me manda uma foto da sua conta de luz que eu já te falo quanto você economizaria por mês — leva uns 10 minutos pra eu montar.',
        porque:
          'Diz de onde veio o contato (tira o clima de spam), localiza você na mesma cidade e dá um prazo curto e concreto.',
      },
      {
        id: 'sem-resposta-lead',
        situacao: 'Lead novo que não respondeu a primeira',
        quando: 'No dia seguinte, em horário diferente do primeiro contato.',
        texto:
          '[Nome], passando aqui rapidinho — sei que mensagem de número desconhecido a gente deixa pra depois. Sobre a simulação de energia solar que você pediu: quer que eu mande um exemplo de uma casa parecida com a sua aqui em [cidade]? Sem compromisso nenhum, é só pra você ter ideia do número.',
        porque:
          'Reconhece o motivo real do silêncio em vez de cobrar. E troca o pedido: em vez de você querer algo dele, você oferece algo.',
      },
      {
        id: 'porta-a-porta',
        situacao: 'Bairro onde você acabou de instalar',
        quando: 'Enquanto a obra ainda está montada no telhado do vizinho.',
        texto:
          'Oi [Nome], boa tarde! Sou o [Seu nome], da [Empresa]. Estamos instalando o sistema solar aqui na [rua], na casa do [vizinho, se ele autorizar], e vi que a sua casa tem uma boa área de telhado voltada pro lado certo. Já que a equipe está no bairro, consigo fazer sua simulação sem custo esta semana. Quer que eu faça?',
        porque:
          'Prova social do lado geográfico ("na sua rua") + motivo legítimo de urgência (a equipe está aqui agora). Nunca cite o vizinho sem a autorização dele.',
      },
      {
        id: 'comercio',
        situacao: 'Comércio ou pequena indústria',
        quando: 'Horário comercial, começo da manhã.',
        texto:
          'Bom dia! Falo com o responsável pelo [nome do estabelecimento]? Sou o [Seu nome], da [Empresa]. Trabalho com energia solar para comércio aqui em [cidade] e a conta de energia costuma ser uma das três maiores despesas de um negócio como o seu. Me passa o valor médio da conta que eu te mostro, em números, quanto sairia do seu custo fixo todo mês.',
        porque:
          'Para PJ o argumento não é economia doméstica, é custo fixo. E a pergunta vai direto ao número que o dono conhece de cabeça.',
      },
    ],
  },
  {
    slug: 'follow-up',
    titulo: 'Follow-up depois da proposta',
    descricao:
      'A regra: toda mensagem de follow-up precisa levar uma informação NOVA. "E aí, decidiu?" três vezes seguidas ensina o cliente a te ignorar.',
    mensagens: [
      {
        id: 'toque-1',
        situacao: 'Toque 1 — 24 a 48 horas depois da proposta',
        quando: 'No dia seguinte, à tarde.',
        texto:
          '[Nome], boa tarde! Consegui olhar sua proposta com calma de novo e refiz o dimensionamento pensando naquele ponto que você comentou sobre [ar-condicionado / chuveiro / a obra que vai fazer]. Deu pra ajustar. Te mando a versão nova?',
        porque:
          'Traz novidade e mostra que você lembrou de um detalhe da conversa. Termina em pergunta fechada, que é fácil de responder.',
      },
      {
        id: 'toque-2',
        situacao: 'Toque 2 — 4 a 5 dias',
        quando: 'Começo da semana, de manhã.',
        texto:
          '[Nome], bom dia! Terminei uma instalação em [bairro/cidade] essa semana, num telhado bem parecido com o seu. Tirei umas fotos, quer ver como ficou? Assim você vê o acabamento antes de decidir qualquer coisa.',
        porque:
          'Prova visual em vez de cobrança. Foto de obra recente responde à dúvida que ele não fala em voz alta: "será que fica feio no meu telhado?".',
      },
      {
        id: 'toque-3',
        situacao: 'Toque 3 — 8 a 10 dias',
        quando: 'Quando o preço do kit ou a tarifa mudar. Se nada mudou, não invente.',
        texto:
          '[Nome], tudo bem? Duas coisas mudaram desde a nossa conversa: [a tarifa da distribuidora subiu / o preço do kit foi reajustado]. Refiz sua proposta com os números de hoje — o retorno passou de [X] pra [Y] meses. Te mando o arquivo atualizado, e se você decidir não fazer agora, sem problema: só não quero que decida com número velho.',
        porque:
          'Urgência real, não inventada. E dá permissão explícita pra dizer não — o que costuma destravar quem estava sumindo por constrangimento.',
      },
      {
        id: 'toque-final',
        situacao: 'Toque final — 15 dias, quando não houve resposta nenhuma',
        quando: 'Uma vez. Depois disso, só reativação daqui a alguns meses.',
        texto:
          '[Nome], vou parar de te chamar pra não virar chateação. Deixo sua proposta salva aqui por 30 dias — se mudar de ideia, é só me mandar um "oi" que eu retomo do ponto em que a gente parou, sem precisar refazer nada. Sucesso aí!',
        porque:
          'Encerrar com elegância recupera uma parte relevante dos silenciosos. Quem não responde a essa, realmente não ia comprar agora.',
      },
    ],
  },
  {
    slug: 'reativacao',
    titulo: 'Reativação de orçamento antigo',
    descricao:
      'Sua lista de orçamentos perdidos é o lead mais barato que existe: já sabe o que é, já viu preço, já confiou em você o suficiente pra receber uma proposta.',
    mensagens: [
      {
        id: 'reativa-3-meses',
        situacao: 'Orçamento de 3 a 6 meses atrás',
        quando: 'Depois de qualquer aumento de tarifa. É o gancho perfeito.',
        texto:
          'Oi [Nome], tudo bem? Aqui é o [Seu nome], da [Empresa] — fiz sua proposta de energia solar em [mês]. Passando porque a tarifa da [distribuidora] subiu de novo, e isso mudou seus números: o sistema que na época se pagava em [X] meses agora se paga em [Y]. Quer que eu atualize a proposta pra você ver?',
        porque:
          'O aumento de tarifa é um fato externo, verificável, que muda a conta — e não é você pedindo nada.',
      },
      {
        id: 'reativa-1-ano',
        situacao: 'Orçamento de mais de 1 ano',
        quando: 'Uma vez por ano, em lote.',
        texto:
          '[Nome], quanto tempo! Aqui é o [Seu nome], da [Empresa]. Estou revisando os orçamentos antigos e o seu apareceu aqui. De lá pra cá mudou bastante coisa: [equipamento melhor / preço / financiamento]. Se ainda fizer sentido pra você, refaço sua simulação com os números de hoje — leva 10 minutos e não custa nada.',
        porque:
          'Honesto sobre o motivo do contato ("estou revisando os antigos") e sem fingir intimidade que não existe mais.',
      },
      {
        id: 'reativa-perdeu',
        situacao: 'Fechou com o concorrente',
        quando: 'De 6 a 12 meses depois. Sem ressentimento na mensagem.',
        texto:
          'Oi [Nome], tudo certo? Aqui é o [Seu nome], da [Empresa]. Você fechou seu sistema com outra empresa na época e espero que esteja gerando bem! Passando só pra deixar meu contato: se precisar de manutenção, limpeza dos módulos ou de alguém pra olhar a geração, pode me chamar. Faço isso pra clientes de qualquer empresa.',
        porque:
          'Abandona a venda perdida e abre uma porta de serviço. Uma parte relevante desses clientes é mal atendida no pós-venda — e vira cliente de manutenção, depois de indicação.',
      },
    ],
  },
  {
    slug: 'indicacao',
    titulo: 'Pedir indicação sem constrangimento',
    descricao:
      'A hora certa de pedir indicação é uma só: quando o cliente está encantado. Isso acontece duas vezes, e as duas passam rápido.',
    mensagens: [
      {
        id: 'pedido-pos-obra',
        situacao: 'No dia em que o sistema é ligado',
        quando: 'Presencialmente, com o app de monitoramento aberto na frente dele.',
        texto:
          '[Nome], seu sistema já está gerando — olha aqui. Vou te pedir um favor: se você conhece alguém que também anda reclamando da conta de luz, me apresenta? Não precisa vender nada, só manda meu contato ou me passa o dele que eu faço a simulação sem compromisso.',
        porque:
          'Pedido específico e sem esforço para ele ("só manda meu contato"). Pedido vago tipo "indica pra alguém" não gera ação.',
      },
      {
        id: 'pedido-primeira-conta',
        situacao: 'Quando chega a primeira conta baixa',
        quando: '30 a 45 dias depois de ligar. Pergunte o valor antes de pedir.',
        texto:
          '[Nome], chegou a primeira conta depois do sistema? Quanto veio? [espera a resposta] Boa! Posso te pedir uma coisa: manda um print dessa conta pra alguém que você sabe que paga caro. É o argumento mais forte que existe, e vem de você, não de mim.',
        porque:
          'Esse é o pico de satisfação do cliente. O print da conta baixa circulando no WhatsApp dele vale mais que qualquer anúncio seu.',
      },
      {
        id: 'depoimento',
        situacao: 'Pedir o depoimento em vídeo',
        quando: 'Junto do pedido da primeira conta, nunca antes.',
        texto:
          '[Nome], me ajuda em 30 segundos? Grava um vídeo curto no celular falando três coisas: quanto era sua conta antes, quanto é agora, e como foi a instalação. Pode ser sem edição, quanto mais simples melhor — vídeo produzido demais ninguém acredita.',
        porque:
          'Dá o roteiro pronto (as três perguntas) e tira a pressão da produção. Sem roteiro, o cliente trava e não grava.',
      },
    ],
  },
];

export const TOTAL_MENSAGENS = PROSPECCAO.reduce((n, b) => n + b.mensagens.length, 0);
