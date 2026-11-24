// ─────────────────────────────────────────────────────────────────────────────
// CONHECIMENTO DA DUDA (energia solar, Irmãos na Obra). SÓ o que a página pública
// diz (dashboard/public/irmaosnaobra/index.html). Nada de preço, parcela, economia
// em reais nem prazo de instalação.
// ─────────────────────────────────────────────────────────────────────────────


export const FRASES_PUBLICAS_SOLAR: readonly string[] = [
  '25 anos de garantia de geração',
  'Módulos de 600W',
  'Inversor SAJ, Deye ou Sungrow',
  'Monitoramento por app',
  'Orçamento e visita grátis',
  'Homologação na concessionária',
  'Equipe própria',
  'Atende o Triângulo Mineiro e Catalão',
];

/** Onde a Duda pode dizer que atende (página pública). */
export const CIDADES_ATENDIDAS = ['Uberlândia', 'Araguari', 'Uberaba', 'Ituiutaba', 'Catalão'] as const;

/** Perguntas de qualificação, uma por vez e no contexto. */
export const PERGUNTAS_DUDA = [
  'onde mora',
  'quanto gasta de luz por mês (ou a foto da conta)',
  'quando pensa em montar',
] as const;

export function textoConhecimentoSolar(): string {
  return [
    'ENERGIA SOLAR, IRMÃOS NA OBRA (só isto pode ser afirmado):',
    ...FRASES_PUBLICAS_SOLAR.map(f => `- ${f}`),
    `- Cidades: ${CIDADES_ATENDIDAS.join(', ')} e região.`,
    '- Quem atende (regra de agenda/solarRota.ts, desde 23/11/2026): o consultor do card, por ligação. A equipe é a Nilce, a Giovanna, o Thiago e o Diego, divididos pela conta de luz do cliente. Cite só o nome que estiver nos fatos; sem nome nos fatos, diga "um consultor".',
    '- NUNCA diga preço, parcela, economia em reais nem prazo de instalação. Diga que o orçamento é grátis e que a consultora mostra os números.',
  ].join('\n');
}
