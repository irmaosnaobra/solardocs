// ─────────────────────────────────────────────────────────────────────────────
// CONHECIMENTO DA HELENA (NEXUS Eletropostos). Só o que a landing pública diz
// (dashboard/public/io/eletroposto/index.html): os cinco modelos e os valores
// públicos. O teste confere estes números contra o HTML.
// ─────────────────────────────────────────────────────────────────────────────

/** Valor público por potência (kW): R$. Só depois da qualificação. */
export const VALORES_PUBLICOS_ELETROPOSTO: Readonly<Record<number, number>> = {
  60: 135000,
  80: 145000,
  120: 195000,
};

export const REAIS_PUBLICOS_ELETROPOSTO: readonly number[] = Object.values(VALORES_PUBLICOS_ELETROPOSTO);

export const PAGAMENTO_ELETROPOSTO = {
  cartaoAteX: 18,
  financiamentoAteX: 72,
  carenciaDias: 90,
} as const;

export interface ModeloEletroposto { numero: number; nome: string; resumo: string }

export const MODELOS_ELETROPOSTO: readonly ModeloEletroposto[] = [
  { numero: 1, nome: 'Você cede o espaço', resumo: 'Nós investimos 100%, montamos e operamos o ponto; você recebe arrendamento pelo espaço, todo mês.' },
  { numero: 2, nome: 'Sociedade meio a meio', resumo: '50% nós, 50% você; os dois são sócios na operação e no faturamento. Obra, homologação e software são por nossa conta.' },
  { numero: 3, nome: 'Chave na mão', resumo: 'Você investe; o eletroposto e o faturamento são seus. Projeto com ART, obra, concessionária, equipamento, software e a primeira recarga são nossos.' },
  { numero: 4, nome: 'Só o equipamento', resumo: 'Você investe; carregador NEXUS com garantia de 2 anos, estoque próprio no Brasil e OCPP aberto, para quem já tem equipe de projeto e obra.' },
  { numero: 5, nome: 'Consultoria completa', resumo: 'Você investe; estudo de viabilidade, dimensionamento, caminho na concessionária, enquadramento e precificação da tarifa.' },
];

/**
 * Porcentagens que a landing usa nos modelos (100% no 01, 50% no 02). Lidas do TEXTO dos modelos,
 * nunca escritas à mão: se o texto mudar, a lista muda junto. Qualquer outra % a trava barra.
 */
export const PERCENTUAIS_PUBLICOS_ELETROPOSTO: readonly number[] = [...new Set(
  MODELOS_ELETROPOSTO.flatMap(m => [...m.resumo.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(x => Number(x[1]!.replace(',', '.')))),
)];

export const FRASES_PUBLICAS_ELETROPOSTO: readonly string[] = [
  'Não é franquia: sem taxa de entrada, sem royalties e sem exclusividade de território',
  'O ponto e o CNPJ são seus, e a tarifa por kWh quem define é você',
  'Projeto com ART de engenheiro habilitado',
  'Obra, homologação e comissionamento são nossos',
  'Equipamento com estoque próprio no Brasil',
];

function reais(v: number): string {
  return v.toLocaleString('pt-BR');
}

export function textoConhecimentoEletroposto(): string {
  const valores = Object.entries(VALORES_PUBLICOS_ELETROPOSTO)
    .map(([kw, v]) => `${kw} kW: R$ ${reais(v)}`).join('; ');
  return [
    'ELETROPOSTO, NEXUS (só isto pode ser afirmado):',
    ...MODELOS_ELETROPOSTO.map(m => `- Modelo 0${m.numero}, ${m.nome}: ${m.resumo}`),
    ...FRASES_PUBLICAS_ELETROPOSTO.map(f => `- ${f}`),
    `- Valores públicos (SÓ depois de perguntar imóvel, padrão de energia e vagas): ${valores}.`,
    `- Pagamento: cartão em até ${PAGAMENTO_ELETROPOSTO.cartaoAteX}x, financiamento em até ${PAGAMENTO_ELETROPOSTO.financiamentoAteX}x com carência de ${PAGAMENTO_ELETROPOSTO.carenciaDias} dias.`,
    '- Rendimento, retorno e payback: só na reunião. Nunca na conversa.',
  ].join('\n');
}
