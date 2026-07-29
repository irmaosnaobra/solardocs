// Módulo BÔNUS do Kit de Fechamento — só destrava para quem terminou o curso E
// está usando a plataforma (empresa cadastrada, cliente cadastrado, documento
// gerado). É a recompensa que puxa o aluno para dentro do produto.
//
// Assunto: venda para PJ — o projeto que vale por três residenciais.

export type PassoPJ = {
  id: string;
  fase: string;
  titulo: string;
  texto: string;
  acoes: string[];
  fala?: string;
  armadilha: string;
};

export const PJ_PROSPECCAO: PassoPJ[] = [
  {
    id: 'quem-decide',
    fase: 'Antes do contato',
    titulo: 'Descubra quem assina antes de falar com alguém',
    texto:
      'Em casa quem decide é quem mora. Em empresa, quase nunca é quem atende o telefone. Errar essa pessoa é o que faz proposta comercial morrer em "vou passar para a diretoria".',
    acoes: [
      'Em comércio pequeno e médio: o dono decide, e ele costuma estar no balcão em algum horário do dia. Pergunte qual.',
      'Em empresa com sócios: quem decide é quem cuida do financeiro, não quem cuida da operação.',
      'Em indústria ou rede: existe processo de compra. Peça para falar com quem aprova investimento (CAPEX), não com manutenção.',
      'Anote o nome de quem te atendeu — ele vira sua ponte, não seu obstáculo.',
    ],
    fala:
      'Bom dia! Eu trabalho com energia solar para empresas aqui em [cidade]. Não quero tomar seu tempo: quem é a pessoa que olha os custos fixos daqui? É com ela que eu preciso falar cinco minutos.',
    armadilha:
      'Apresentar a proposta inteira para quem não decide. Além de perder a visita, você entrega seu argumento para ser mal repetido internamente.',
  },
  {
    id: 'conta-pj',
    fase: 'Diagnóstico',
    titulo: 'A conta de empresa não se lê como a de casa',
    texto:
      'Conta de PJ tem demanda contratada, horário de ponta e classificação tarifária. Se você dimensiona olhando só o consumo total, erra o projeto e perde credibilidade na primeira pergunta técnica.',
    acoes: [
      'Peça 12 meses de conta, não uma. Empresa tem sazonalidade forte.',
      'Identifique o grupo tarifário: baixa tensão (B) ou alta tensão (A) muda o projeto e a economia.',
      'Em grupo A, veja demanda contratada e consumo em ponta — o solar não resolve demanda, e prometer isso é enganar o cliente.',
      'Pergunte se há expansão prevista: máquina nova, turno extra, galpão a mais. Sistema subdimensionado vira reclamação em um ano.',
    ],
    fala:
      'Me manda as contas dos últimos 12 meses? Empresa varia muito de mês para mês, e eu prefiro dimensionar pelo ano inteiro a te vender um sistema que fica pequeno em três meses.',
    armadilha:
      'Prometer "zerar a conta" para cliente de grupo A. A parte de demanda continua sendo cobrada, e essa promessa quebrada custa a indicação que viria depois.',
  },
  {
    id: 'proposta-empresario',
    fase: 'Apresentação',
    titulo: 'Empresário não compra economia — compra retorno',
    texto:
      'Para o dono da casa, o argumento é a conta que sobe todo ano. Para o dono da empresa, é comparação de investimento: onde mais ele colocaria esse dinheiro e com que retorno.',
    acoes: [
      'Mostre o payback em meses e o que acontece depois dele — os anos de energia que ele não paga são o lucro do investimento.',
      'Traduza a economia mensal em algo da operação dele: "isso paga um funcionário", "isso é o aluguel de meio galpão".',
      'Fale do custo fixo: energia é uma das três maiores despesas fixas de comércio, e a única que dá para converter em ativo.',
      'Se a empresa é PJ com apuração no lucro real, mencione depreciação — e mande ele confirmar com o contador dele, não invente número tributário.',
      'Leve a proposta impressa E gere o contrato na hora se ele decidir. Empresário decide rápido quando o documento já está pronto.',
    ],
    fala:
      'Sua conta hoje é R$ [valor] por mês, R$ [ano] por ano — dinheiro que sai e não vira nada. O sistema custa R$ [preço] e se paga em [X] meses. Do mês [X+1] em diante, esse valor deixa de ser despesa. É o único custo fixo do seu negócio que você consegue transformar em patrimônio.',
    armadilha:
      'Apresentar TIR e VPL para quem não pediu. Se ele for de números, ele pede; se não for, você complicou uma conta que era simples.',
  },
  {
    id: 'fechamento-pj',
    fase: 'Fechamento',
    titulo: 'Contrato PJ, cronograma e a assinatura',
    texto:
      'Venda PJ trava por burocracia, não por preço. Quem chega com contrato pronto, dados corretos e cronograma escrito fecha enquanto o concorrente ainda está "montando a documentação".',
    acoes: [
      'Confirme razão social, CNPJ e quem assina pela empresa antes de gerar o documento.',
      'Gere o contrato aqui na plataforma com os dados da SUA empresa e os dele — em minutos, não em dias.',
      'Deixe explícito no contrato: prazo de obra, condição de pagamento, escopo de instalação e garantia.',
      'Combine a data da obra na mesma conversa. Empresa tem operação para não parar — data marcada é o que destrava.',
    ],
    fala:
      'Se estiver certo para você, eu já gero o contrato agora com os dados da [empresa] e a gente marca a obra para a semana de [data]. Precisa só do CNPJ e de quem assina.',
    armadilha:
      'Sumir entre o "sim" e a assinatura para "preparar a documentação". É nesse vão que a decisão esfria e alguém de dentro levanta objeção nova.',
  },
];

export const CHECKLIST_PJ = [
  '12 meses de conta de energia em mãos',
  'Grupo tarifário identificado (A ou B)',
  'Demanda contratada e consumo em ponta anotados (grupo A)',
  'Expansão prevista da operação perguntada',
  'Área de telhado ou solo medida, com estrutura avaliada',
  'Quem assina pela empresa confirmado (nome e cargo)',
  'Razão social e CNPJ conferidos',
  'Proposta com payback em meses, não só em percentual',
  'Contrato PJ pronto para gerar na hora do sim',
  'Data de obra oferecida na mesma conversa',
];
