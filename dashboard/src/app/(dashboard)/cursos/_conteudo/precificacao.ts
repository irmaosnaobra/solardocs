// Kit de Fechamento do Integrador — Módulo 3: precificação e margem.

export type LinhaCusto = {
  item: string;
  descricao: string;
  /** Faixa típica como % do preço final de venda — referência, não regra */
  faixa: string;
  atencao?: string;
};

export const ESTRUTURA_CUSTO: LinhaCusto[] = [
  {
    item: 'Kit (módulos + inversor)',
    descricao: 'Equipamento principal, cotado com o distribuidor.',
    faixa: '50–60%',
    atencao:
      'Trave a cotação por escrito com validade em dias. Câmbio e frete mudam e comem margem entre a proposta e a compra.',
  },
  {
    item: 'Estrutura de fixação',
    descricao: 'Perfis, ganchos, parafusos e acessórios conforme o tipo de telhado.',
    faixa: '4–8%',
    atencao: 'Telha de fibrocimento e metálica usam kits diferentes. Orçar errado aqui é prejuízo certo.',
  },
  {
    item: 'Material elétrico (CA/CC)',
    descricao: 'Cabos, conectores, string box, disjuntores, DPS, aterramento e eletrodutos.',
    faixa: '5–10%',
    atencao: 'A distância entre o telhado e o quadro é o que mais varia. Meça na vistoria, não estime.',
  },
  {
    item: 'Mão de obra de instalação',
    descricao: 'Equipe, dias de obra, andaime/plataforma quando necessário.',
    faixa: '8–15%',
    atencao: 'Calcule por dia de equipe, não por kWp. Telhado alto, íngreme ou com acesso difícil custa mais.',
  },
  {
    item: 'Projeto e homologação',
    descricao: 'ART do responsável técnico, projeto elétrico, protocolo e acompanhamento na distribuidora.',
    faixa: '3–6%',
    atencao: 'Inclua o retrabalho: parecer com exigência é rotina, não exceção.',
  },
  {
    item: 'Deslocamento e logística',
    descricao: 'Frete do kit, combustível, pedágio, hospedagem em obra fora da cidade.',
    faixa: '2–5%',
    atencao: 'Obra a mais de 100 km precisa de linha própria no orçamento, senão sai do seu bolso.',
  },
  {
    item: 'Impostos e taxa de cartão/financiamento',
    descricao: 'Regime tributário da sua empresa e custo do meio de pagamento.',
    faixa: '6–12%',
    atencao:
      'Se o cliente parcela no cartão, a taxa sai da sua margem — coloque na conta antes de dar desconto.',
  },
  {
    item: 'Margem líquida',
    descricao: 'O que sobra para a empresa depois de tudo acima.',
    faixa: '12–25%',
    atencao:
      'Abaixo de 12% você está trabalhando para o distribuidor. Uma obra com problema apaga a margem de três.',
  },
];

export const REGRAS_DE_MARGEM = [
  {
    titulo: 'Nunca dê desconto sem tirar escopo',
    texto:
      'Desconto puro sai inteiro da sua margem. Se precisar baixar o preço, tire algo junto: reduza a potência, mude a marca do inversor, retire o seguro do primeiro ano. O cliente entende trocar preço por escopo; o que ele não esquece é ter conseguido desconto — e vai pedir de novo na próxima.',
  },
  {
    titulo: 'Reajuste o orçamento por distância, não por simpatia',
    texto:
      'A tabela de preço deve ter faixas de deslocamento definidas antes da visita. Decidir na hora, olhando para o cliente, é como a maioria dos integradores perde dinheiro sem perceber.',
  },
  {
    titulo: 'Cobre a vistoria de telhado complexo',
    texto:
      'Se o telhado exige reforço estrutural, isso é obra civil e tem custo. Absorver "para não perder a venda" é a forma mais rápida de fechar o mês no vermelho com o cliente satisfeito.',
  },
  {
    titulo: 'Calcule o payback com a tarifa atual, não com a projetada',
    texto:
      'Prometer retorno usando reajuste futuro otimista gera cliente frustrado no ano 2. Use a tarifa de hoje: se o retorno já fecha assim, qualquer aumento vira bônus e você ganha a conversa em vez de perder a confiança.',
  },
];

export const CHECKLIST_ORCAMENTO = [
  'Conta de luz dos últimos 12 meses conferida (média, não o pico)',
  'Tipo de ligação: monofásica, bifásica ou trifásica',
  'Necessidade de troca do padrão de entrada verificada',
  'Área útil medida e orientação do telhado registrada',
  'Sombreamento avaliado',
  'Tipo de telha e estado da estrutura fotografados',
  'Distância do quadro até o local do inversor medida',
  'Distância da obra em km e custo de deslocamento aplicado',
  'Cotação do kit travada por escrito, com validade',
  'Margem líquida conferida DEPOIS de impostos e taxa de pagamento',
];
