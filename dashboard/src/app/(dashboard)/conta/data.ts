// Features da assinatura — explicadas com AIDA + SPIN.
// CTA condicional: quem não assina vê "Assinar" / assinante vê "Acessar agora".
//
// PREÇO ÚNICO: nenhuma dessas telas nomeia degrau de plano. Não existe "VIP" em
// oposição a "PRO" — existe conta grátis e conta assinante.

// Era um payment link cru da Stripe (buy.stripe.com/...), com o preço congelado
// dentro dele e sem passar por cupom nem InitiateCheckout. Com preço único, todo
// caminho de compra do app entra por /assinar — de lá o preço vem da API, então
// nenhuma tela guarda um valor que pode envelhecer em silêncio.
export const URL_ASSINAR = '/assinar';

export interface FeatureAssinatura {
  slug: string;
  nome: string;
  emoji: string;
  tag: string;            // "INCLUSO NA ASSINATURA" / etc
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
  ctaAtivo: string;        // texto do botão pra quem JÁ assina
  ctaFree: string;         // texto do botão pra quem é free (leva pro Stripe)
  acessoUrl?: string;      // pra onde mandar o assinante quando clica (placeholder/feature em construção)
  status: 'ativo' | 'em_breve';  // 'em_breve' mostra aviso "em desenvolvimento"
}

export const FEATURES_ASSINATURA: Record<string, FeatureAssinatura> = {

  'documentos': {
    slug: 'documentos',
    nome: 'Documentos Salvos na Nuvem',
    emoji: '',
    tag: 'INCLUSO NA ASSINATURA',
    attention: {
      eyebrow: 'INCLUSO NA ASSINATURA',
      headline: 'Seus contratos somem quando troca de PC. Assinando, não somem.',
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
    ctaAtivo: 'Acessar minha nuvem',
    ctaFree: 'Liberar minha nuvem',
    acessoUrl: '/historico',
    status: 'ativo',
  },

  'sugestoes': {
    slug: 'sugestoes',
    nome: 'Fórum de Sugestões',
    emoji: '',
    tag: 'INCLUSO NA ASSINATURA',
    attention: {
      eyebrow: 'INCLUSO NA ASSINATURA',
      headline: 'Toda boa ideia que você teve sobre a plataforma morreu na cabeça. Aqui ela vira realidade.',
      subtitulo: 'Mande sua sugestão, o admin aprova, vira tópico de fórum, outros assinantes comentam — e as ideias melhores entram no roadmap.',
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
      'Outros assinantes comentam, votam e validam',
      'Ideias mais votadas viram features reais',
      'Você acompanha o status: aprovada · em desenvolvimento · publicada',
    ],
    ctaAtivo: 'Mandar minha primeira ideia',
    ctaFree: 'Liberar o fórum',
    acessoUrl: '/sugestoes',
    status: 'ativo',
  },

  'mao-de-obra': {
    slug: 'mao-de-obra',
    nome: 'Cadastro de Mão de Obra',
    emoji: '',
    tag: 'INCLUSO NA ASSINATURA',
    attention: {
      eyebrow: 'INCLUSO NA ASSINATURA',
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
    ctaAtivo: 'Cadastrar meu time',
    ctaFree: 'Entrar na rede',
    acessoUrl: '/mao-de-obra',
    status: 'ativo',
  },

};
