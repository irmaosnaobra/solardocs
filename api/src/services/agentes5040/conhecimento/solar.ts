// ─────────────────────────────────────────────────────────────────────────────
// CONHECIMENTO DA DUDA (energia solar, Irmãos na Obra). SÓ o que a página pública
// diz (dashboard/public/irmaosnaobra/index.html). Nada de preço, parcela, economia
// em reais nem prazo de instalação.
// ─────────────────────────────────────────────────────────────────────────────

import { BASE_DO_SOCIO, KWH_GIOVANNA, KWH_VISITA, QUEM } from '../../agenda/solarRota';

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
    `- Quem atende (regra de agenda/solarRota.ts): até ${KWH_GIOVANNA} kWh, ${QUEM.pequena}; de ${KWH_GIOVANNA} a ${KWH_VISITA.toLocaleString('pt-BR')} kWh, ${QUEM.media} (às vezes ${QUEM.pequena}); acima de ${KWH_VISITA.toLocaleString('pt-BR')} kWh, ${QUEM.visita} com visita (base em ${BASE_DO_SOCIO.Diego}) ou ${QUEM.grande} em reunião.`,
    '- NUNCA diga preço, parcela, economia em reais nem prazo de instalação. Diga que o orçamento é grátis e que a consultora mostra os números.',
  ].join('\n');
}
