// Conteúdo das mentorias usando AIDA + SPIN.
// Cada produto tem 1 CTA principal verde com link WhatsApp pra Thiago (34 99136-0223).

export const WHATSAPP_THIAGO = '5534991360223';

export type CorTema = 'gold' | 'green' | 'purple' | 'coral';

export interface Produto {
  slug: string;
  nome: string;
  emoji: string;
  tag: string;            // "MAIS VENDIDO" / "COMBO IRRESISTÍVEL" / "EXCLUSIVO" / etc
  cor: CorTema;
  preco: number;          // em reais (0 = "A combinar")
  precoAncora?: number;
  precoLabel?: string;    // override quando preço é "A combinar"
  parcelamento?: string;  // "12x de R$ 149,70 ou à vista no PIX"
  duracao: string;
  attention: {
    eyebrow: string;      // "◆ MENTORIA SOLARDOC" / "⚡ COMBO IRRESISTÍVEL"
    headline: string;     // título principal
    subtitulo: string;    // sub do hero
  };
  spin: {
    situacao: string;
    problema: string;
    implicacao: string;
    necessidade: string;
  };
  bullets: string[];      // ~6 itens de Desire
  cta: string;            // "Quero a Planilha Mestre"
  whatsappMsg: string;    // já em linguagem natural; vai pro encodeURIComponent
  garantiaDias: number;
  vagasMes: number;
  exclusivo?: boolean;
  // Combo
  isCombo?: boolean;
  valueStack?: { label: string; valor: number }[];
  totalReal?: number;
  economia?: number;
  // Cross-sell pro COMBO (planilha-mestre + trello-homologacao mostram banner do combo)
  crossSellCombo?: boolean;
}

export const MENTORIAS: Record<string, Produto> = {
  'planilha-mestre': {
    slug: 'planilha-mestre',
    nome: 'Planilha Mestre',
    emoji: '📊',
    tag: 'MAIS VENDIDO',
    cor: 'gold',
    preco: 997,
    precoAncora: 1997,
    parcelamento: '12x de R$ 99,70 ou à vista no PIX',
    duracao: '40 min ao vivo',
    attention: {
      eyebrow: '◆ MENTORIA SOLARDOC',
      headline: 'Você fatura bem mas não sabe se está lucrando? A diferença entre fechar o ano no azul ou no vermelho está em UMA planilha.',
      subtitulo: 'A planilha financeira que eu uso na operação real da Irmãos na Obra. Entrego cópia + 40 min ao vivo configurando do seu jeito.',
    },
    spin: {
      situacao: 'Você vende solar, fecha contratos, tem volume — mas no fim do mês o dinheiro some.',
      problema: 'Sem controle de margem real por venda, custos ocultos engolem seu lucro silenciosamente.',
      implicacao: 'Em 12 meses isso vira R$ 50–150k que escaparam por falta de visibilidade. Você não sabe quais vendas deram lucro e quais deram prejuízo.',
      necessidade: 'Um sistema financeiro que mostre EXATAMENTE quanto cada venda lucrou, com precificação automática e controle de comissões.',
    },
    bullets: [
      'Planilha exata da minha empresa — sem versão diluída',
      '40 min ao vivo configurando junto com você',
      'Cópia entregue (acesso vitalício)',
      'Precificação automática com margem alvo',
      'Controle de comissões por consultor',
      'Suporte 7 dias após a sessão',
    ],
    cta: 'Quero a Planilha Mestre',
    whatsappMsg: 'Olá Thiago! Quero a *Planilha Mestre* (R$ 997) e agendar a apresentação de 40 min.',
    garantiaDias: 7,
    vagasMes: 4,
    crossSellCombo: true,
  },

  'trello-homologacao': {
    slug: 'trello-homologacao',
    nome: 'Trello Homologação',
    emoji: '📌',
    tag: 'CORAÇÃO DA ENGENHARIA',
    cor: 'purple',
    preco: 997,
    precoAncora: 1997,
    parcelamento: '12x de R$ 99,70 ou à vista no PIX',
    duracao: '45 min ao vivo',
    attention: {
      eyebrow: '◆ MENTORIA SOLARDOC',
      headline: 'Cansado de ver projetos parados na CEMIG por 3, 4, 5 meses? A homologação que destrava sua empresa existe.',
      subtitulo: 'Board Trello testado em 700+ homologações + 45 min ao vivo destravando o seu fluxo.',
    },
    spin: {
      situacao: 'Você é integrador, vende solar, mas a homologação trava tudo no caminho.',
      problema: 'Cliente reclamando, dinheiro preso, retrabalho infinito a cada projeto novo.',
      implicacao: 'Cada mês de atraso = R$ 2–5k em juros de capital parado e clientes que cancelam por desespero.',
      necessidade: 'Um sistema replicável pra todas as concessionárias, com checklists, modelos e atalhos de quem fez 700+ projetos.',
    },
    bullets: [
      'Board Trello completo (estrutura pronta)',
      'Fluxo testado em 700+ homologações reais',
      '45 min ao vivo aplicando no seu cenário',
      'Templates de documentos prontos',
      'Atalhos pra destravar projetos travados',
      'Independência da engenharia terceirizada',
    ],
    cta: 'Dominar Homologação',
    whatsappMsg: 'Olá Thiago! Quero dominar a *Homologação* com o Trello (R$ 997).',
    garantiaDias: 7,
    vagasMes: 4,
    crossSellCombo: true,
  },

  'gerador': {
    slug: 'gerador',
    nome: 'Gerador de Proposta',
    emoji: '📄',
    tag: 'PREMIUM',
    cor: 'green',
    preco: 1497,
    precoAncora: 2997,
    parcelamento: '12x de R$ 149,70 ou à vista no PIX',
    duracao: 'Setup completo + onboarding',
    attention: {
      eyebrow: '◆ MENTORIA SOLARDOC',
      headline: 'Pare de pagar mensalidade em ferramentas que travam suas vendas. Tenha seu próprio gerador com sua marca.',
      subtitulo: 'Sistema completo personalizado: sua identidade, seu catálogo, suas margens. Sem mensalidade.',
    },
    spin: {
      situacao: 'Você usa um gerador genérico de propostas que cobra mensalidade e limita features.',
      problema: 'Quando precisa fechar uma venda urgente, o sistema cai, fica lento ou exige upgrade de plano.',
      implicacao: 'Você perde vendas por causa da ferramenta — e ainda paga R$ 200–500/mês pra ter esse risco.',
      necessidade: 'Um gerador próprio, sua marca, seu domínio, sem mensalidade, com margens e catálogo configurados pro seu modelo.',
    },
    bullets: [
      'Sistema completo entregue — código + acesso',
      'Sua identidade visual aplicada',
      'Catálogo de painéis e inversores cadastrado',
      'Margens configuradas pra seu mercado',
      'Templates de proposta prontos',
      'Sem mensalidade — pago uma vez',
    ],
    cta: 'Quero o Gerador',
    whatsappMsg: 'Olá Thiago! Tenho interesse no *Gerador de Proposta* personalizado (R$ 1.497).',
    garantiaDias: 7,
    vagasMes: 4,
  },

  'trafego': {
    slug: 'trafego',
    nome: 'Tráfego Pago Solar',
    emoji: '📣',
    tag: 'ACELERADOR DE LEADS',
    cor: 'gold',
    preco: 1497,
    precoAncora: 2497,
    parcelamento: '12x de R$ 149,70 ou à vista no PIX',
    duracao: '1h ao vivo + 7 dias de suporte',
    attention: {
      eyebrow: '◆ MENTORIA SOLARDOC',
      headline: 'Você gasta com Meta Ads e ainda acha que CPL caro é só azar. Não é. É falta de método específico pra solar.',
      subtitulo: 'A estrutura de tráfego pago que rodo na minha operação — testada em milhares de leads do nicho solar.',
    },
    spin: {
      situacao: 'Você é integrador solar e tenta rodar Meta Ads sozinho ou com agência genérica.',
      problema: 'CPL alto, leads ruins, conversa não engata, nada vira venda. Anúncios queimam orçamento sem retorno.',
      implicacao: 'Cada R$ 5k em ads sem ROI = 1 mês de funcionário jogado fora. Em um ano, isso vira um carro.',
      necessidade: 'Estrutura testada de campanha + criativos validados + copy específica do nicho solar + funil que qualifica.',
    },
    bullets: [
      'Mentoria 1h ao vivo no seu ad account',
      'Estrutura de campanha validada (CBO, públicos, criativos)',
      'Criativos testados que viraram referência',
      'Copy de anúncios e WhatsApp pro nicho solar',
      'Funil de qualificação que filtra curioso',
      'KPIs pra ler painel sem se enganar',
    ],
    cta: 'Quero parar de queimar grana',
    whatsappMsg: 'Olá Thiago! Quero a mentoria de *Tráfego Pago* pra solar (R$ 1.497).',
    garantiaDias: 7,
    vagasMes: 4,
  },

  'parceiro-integrador': {
    slug: 'parceiro-integrador',
    nome: 'Parceiro Integrador',
    emoji: '🎯',
    tag: 'EXCLUSIVO',
    cor: 'coral',
    preco: 0,
    precoLabel: 'A combinar',
    duracao: 'Parceria de longo prazo',
    exclusivo: true,
    attention: {
      eyebrow: '◆ PARCERIA EXCLUSIVA',
      headline: 'Você instala. A gente entrega o cliente.',
      subtitulo: 'Tráfego especializado solar + leads qualificados no seu WhatsApp + exclusividade na sua região.',
    },
    spin: {
      situacao: 'Você é integrador competente mas não tem fluxo previsível de leads pra fechar volume.',
      problema: 'Depende de indicação, sazonalidade, ou paga agência cara que não entende solar.',
      implicacao: 'Em meses ruins você fica parado e o time ocioso come a margem dos meses bons.',
      necessidade: 'Parceria onde o tráfego e a captação ficam comigo — e você foca no que faz bem: instalar.',
    },
    bullets: [
      'Leads pré-qualificados direto no seu WhatsApp',
      'Tráfego pago especializado no nicho solar',
      'Exclusividade regional (1 parceiro por cidade)',
      'Direcionamento de fechamento e follow-up',
      'Sem mensalidade fixa — modelo de revenue share',
      'Mentoria de fechamento incluída',
    ],
    cta: 'Quero ser Parceiro',
    whatsappMsg: 'Olá Thiago! Tenho interesse em ser *Parceiro Integrador*. Minha cidade é:',
    garantiaDias: 0,
    vagasMes: 1,
  },

  'combo-financeiro-engenharia': {
    slug: 'combo-financeiro-engenharia',
    nome: 'COMBO Mestre + Trello',
    emoji: '⚡',
    tag: 'COMBO IRRESISTÍVEL',
    cor: 'gold',
    preco: 1497,
    precoAncora: 2491,
    parcelamento: '12x de R$ 149,70 ou à vista no PIX',
    duracao: '40min + 45min + 30min bônus ao vivo',
    isCombo: true,
    attention: {
      eyebrow: '⚡ COMBO IRRESISTÍVEL',
      headline: 'Não escolha entre lucrar mais ou homologar mais rápido. Faça os dois agora e pague menos do que custaria comprar uma só.',
      subtitulo: 'Os 2 pilares de uma operação solar real — financeiro e engenharia — em um único pacote.',
    },
    spin: {
      situacao: 'Você está construindo uma operação solar e precisa organizar os 2 pilares: dinheiro e engenharia.',
      problema: 'Comprar separado custa R$ 1.994. Comprar uma só deixa metade do problema sem solução.',
      implicacao: 'Empresa solar que organiza só uma das pontas continua sangrando pela outra. Financeiro forte com engenharia caótica = projetos atrasados que comem o lucro. E vice-versa.',
      necessidade: 'Resolver os 2 pilares de uma vez, com economia, mantendo o atendimento individual ao vivo.',
    },
    bullets: [
      'Planilha Mestre completa + 40 min ao vivo',
      'Trello Homologação completo + 45 min ao vivo',
      'BÔNUS: 30 min extras de tira-dúvidas',
      'Cópia da planilha + acesso ao board Trello',
      'Suporte 7 dias após cada sessão',
      'Garantia 7 dias incondicional',
    ],
    valueStack: [
      { label: 'Planilha Mestre + 40 min ao vivo', valor: 997 },
      { label: 'Trello Homologação + 45 min ao vivo', valor: 997 },
      { label: 'BÔNUS: Sessão extra de 30 min tira-dúvidas', valor: 497 },
    ],
    totalReal: 2491,
    economia: 994,
    cta: 'QUERO O COMBO COMPLETO',
    whatsappMsg: 'Olá Thiago! Quero o *COMBO Planilha Mestre + Trello Homologação* por R$ 1.497 (economia de R$ 994). Pode me passar os detalhes e agendar as duas sessões?',
    garantiaDias: 7,
    vagasMes: 4,
  },
};

export function buildWhatsappUrl(produto: Produto): string {
  const txt = encodeURIComponent(produto.whatsappMsg);
  return `https://wa.me/${WHATSAPP_THIAGO}?text=${txt}`;
}

export function fmtPreco(p: number): string {
  return p.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Cor visual por tema
export const TEMA_CORES: Record<CorTema, { primary: string; bg: string; border: string; text: string }> = {
  gold:   { primary: '#FAC775', bg: 'rgba(250,199,117,0.10)', border: 'rgba(250,199,117,0.45)', text: '#FAC775' },
  green:  { primary: '#1D9E75', bg: 'rgba(29,158,117,0.10)',  border: 'rgba(29,158,117,0.45)',  text: '#1D9E75' },
  purple: { primary: '#6E56CF', bg: 'rgba(110,86,207,0.10)',  border: 'rgba(110,86,207,0.45)',  text: '#6E56CF' },
  coral:  { primary: '#C04A35', bg: 'rgba(192,74,53,0.10)',   border: 'rgba(192,74,53,0.45)',   text: '#C04A35' },
};
