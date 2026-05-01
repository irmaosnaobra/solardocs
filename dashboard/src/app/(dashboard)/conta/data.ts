// Features inclusas no plano VIP — explicadas com AIDA + SPIN.
// CTA condicional: free vê "Fazer upgrade pro VIP" / VIP vê "Acessar agora".

export const STRIPE_VIP = 'https://buy.stripe.com/bJe7sK6el9hmgNe0KDfrW02';

export interface FeatureVip {
  slug: string;
  nome: string;
  emoji: string;
  tag: string;            // "INCLUSO NO VIP" / etc
  attention: {
    eyebrow: string;
    headline: string;
    subtitulo: string;
  };
  spin: {
    situacao: string;
    problema: string;
    implicacao: string;
    necessidade: string;
  };
  bullets: string[];
  ctaVip: string;          // texto do botão pra quem JÁ é VIP
  ctaFree: string;         // texto do botão pra quem é free (leva pro Stripe)
  acessoUrl?: string;      // pra onde mandar o VIP quando clica (placeholder/feature em construção)
  status: 'ativo' | 'em_breve';  // 'em_breve' mostra aviso "em desenvolvimento"
}

export const FEATURES_VIP: Record<string, FeatureVip> = {

  'documentos': {
    slug: 'documentos',
    nome: 'Documentos Salvos na Nuvem',
    emoji: '💾',
    tag: 'EXCLUSIVO VIP',
    attention: {
      eyebrow: '★ INCLUSO NO PLANO VIP',
      headline: 'Seus contratos somem quando troca de PC. Não acontece com VIP.',
      subtitulo: 'Todos os documentos gerados ficam salvos na nuvem. Acessa, baixa e reenvia de qualquer lugar.',
    },
    spin: {
      situacao: 'Você gera dezenas de contratos, propostas e procurações por mês na SolarDoc.',
      problema: 'Hoje cada documento gerado vive só no seu navegador — formatou o PC, perdeu tudo. Reinstalar = começar do zero.',
      implicacao: 'Cliente pede pra reenviar contrato de 6 meses atrás → você não tem. Liga pra recuperar = cara de amador. Auditoria fiscal pede histórico → sem prova.',
      necessidade: 'Storage em nuvem com tudo arquivado, busca rápida por cliente/data/tipo, download sob demanda em PDF.',
    },
    bullets: [
      'Todos os documentos gerados salvos automaticamente na nuvem',
      'Acesso de qualquer dispositivo (PC, celular, tablet)',
      'Busca por cliente, data, tipo ou número do contrato',
      'Download em PDF a qualquer momento',
      'Histórico permanente — nunca expira',
      'Backup automático — você nunca perde nada',
    ],
    ctaVip: 'Acessar minha nuvem',
    ctaFree: 'Liberar nuvem com VIP',
    acessoUrl: '/historico',
    status: 'ativo',
  },

  'sugestoes': {
    slug: 'sugestoes',
    nome: 'Fórum de Sugestões',
    emoji: '💡',
    tag: 'EXCLUSIVO VIP',
    attention: {
      eyebrow: '★ INCLUSO NO PLANO VIP',
      headline: 'Toda boa ideia que você teve sobre a plataforma morreu na cabeça. Aqui ela vira realidade.',
      subtitulo: 'Mande sua sugestão, o admin aprova, vira tópico de fórum, outros VIPs comentam — e as ideias melhores entram no roadmap.',
    },
    spin: {
      situacao: 'Você usa a SolarDoc todos os dias e enxerga buracos, melhorias, features que faltam.',
      problema: 'Hoje suas sugestões nunca chegam ao desenvolvedor — viram comentário no WhatsApp e somem.',
      implicacao: 'A plataforma evolui sem te ouvir. Você sente que paga uma ferramenta que não te escuta — e a feature que você precisa nunca vem.',
      necessidade: 'Um canal direto onde sua ideia é avaliada, aprovada, debatida com outros usuários e implementada.',
    },
    bullets: [
      'Envie ideias direto pra equipe SolarDoc',
      'Sua sugestão passa por aprovação do admin',
      'Aprovada → vira tópico de fórum aberto',
      'Outros VIPs comentam, votam e validam',
      'Ideias mais votadas viram features reais',
      'Você acompanha o status: aprovada · em desenvolvimento · publicada',
    ],
    ctaVip: 'Mandar minha primeira ideia',
    ctaFree: 'Liberar fórum com VIP',
    status: 'em_breve',
  },

  'mao-de-obra': {
    slug: 'mao-de-obra',
    nome: 'Cadastro de Mão de Obra',
    emoji: '🔧',
    tag: 'EXCLUSIVO VIP',
    attention: {
      eyebrow: '★ INCLUSO NO PLANO VIP',
      headline: 'Cadastra seu time. A gente capta a venda. Você instala e fatura.',
      subtitulo: 'Quando temos venda fechada na sua região, você é acionado pra executar a obra. Cliente já fechado e pago.',
    },
    spin: {
      situacao: 'Você é instalador solar com time pronto, mas falta volume contínuo de obras pra manter o time rodando.',
      problema: 'Mês ruim de captação = equipe ociosa comendo a margem dos meses bons. Sem prospecção, ninguém te chama.',
      implicacao: 'Em 12 meses isso vira um carro perdido em folha de pagamento sem retorno. E o time desmotivado migra pra concorrência.',
      necessidade: 'Receber obras por região, com cliente já fechado, só executar e faturar — sem precisar prospectar.',
    },
    bullets: [
      'Cadastro do seu time pelas regiões que atende',
      'Match automático quando temos venda na sua área',
      'Cliente vem fechado e pago — você só executa',
      'Comissão clara antes de aceitar a obra',
      'Padrão SolarDoc auditado — qualidade garantida',
      'Sem prospecção, foco total em executar bem',
    ],
    ctaVip: 'Cadastrar meu time',
    ctaFree: 'Entrar na rede com VIP',
    status: 'em_breve',
  },

};
