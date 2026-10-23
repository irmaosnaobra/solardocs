// ─────────────────────────────────────────────────────────────────────────────
// CONHECIMENTO DA CARLA (SolarDoc). Preço único e produtos avulsos.
//
// Os preços dos avulsos NÃO são escritos aqui: vêm de produtos/catalogo.ts, a fonte
// única da loja. Só o plano mensal (R$ 67) mora neste arquivo, porque não é produto
// do catálogo (é a assinatura do SaaS).
// ─────────────────────────────────────────────────────────────────────────────

import { produtoPorId } from '../../produtos/catalogo';

/**
 * Os 8 documentos que a landing do SolarDoc promete, na ordem da esteira.
 * Fonte: dashboard/src/components/Landing/Landing.tsx:302-310 (ESTEIRA) e :941-944
 * ("8 documentos num lugar só: Proposta, contrato, procuração, financiamento, recibo, vistoria").
 */
export const DOCUMENTOS_SOLARDOC: readonly string[] = [
  'Orçamento de 1 página',
  'Proposta comercial',
  'Contrato de compra e venda',
  'Procuração',
  'Recibo de pagamento',
  'Prestação de serviço',
  'Checklist de vistoria',
  'Proposta pro banco',
];

/** Plano único. Sem cupom, sem ACESSO19, sem Pix de R$ 19, sem anual. */
export const PLANO_MENSAL = {
  valor: 67,
  garantiaDias: 7,
  cobradoNaHora: true,
  cancelaQuandoQuiser: true,
} as const;

/** Avulsos que a Carla pode oferecer: só quando a conversa pede e depois que pagou. */
export const IDS_AVULSOS = ['curso-fechamento', 'offgrid', 'precificacao', 'inventario'] as const;

export interface Avulso { id: string; nome: string; preco: number }

export const AVULSOS: readonly Avulso[] = IDS_AVULSOS.map(id => {
  const p = produtoPorId(id);
  if (!p) throw new Error(`produto ${id} saiu do catálogo`);
  return { id, nome: p.nome, preco: p.preco };
});

/** Todo valor em reais que a Carla pode escrever: o plano e os preços dos avulsos. */
export const VALORES_PERMITIDOS_CARLA: readonly number[] = [
  PLANO_MENSAL.valor,
  ...AVULSOS.map(a => a.preco),
].filter((v, i, a) => a.indexOf(v) === i);

/** Promessa permitida, só para quem fecha no mesmo dia e sem dar data de lançamento. */
export const PROMESSA_PLANILHA_ELETROPOSTO =
  'Logo teremos a planilha de eletroposto, e quem fechar hoje terá acesso a ela.';

export function textoConhecimentoSolarDoc(): string {
  const avulsos = AVULSOS.map(a => `${a.nome}: R$ ${a.preco}`).join('; ');
  return [
    'SOLARDOC (o que você pode afirmar):',
    `- Plano único: R$ ${PLANO_MENSAL.valor} por mês, cobrado na hora, garantia de ${PLANO_MENSAL.garantiaDias} dias, cancela quando quiser.`,
    `- Os ${DOCUMENTOS_SOLARDOC.length} documentos, todos com a marca do integrador: ${DOCUMENTOS_SOLARDOC.join(', ')}.`,
    '- O carro-chefe é o orçamento de 1 página: investimento, economia por mês em reais e tempo de retorno numa folha só. Marca própria: a logo, a cor e o CNPJ do integrador em tudo, não a nossa.',
    '- Não existe cupom, nem desconto, nem Pix de R$ 19, nem plano anual.',
    `- Produtos avulsos (Kiwify, o acesso chega sozinho), só quando a conversa pede e depois que pagou: ${avulsos}.`,
    `- Promessa permitida só para quem fecha no mesmo dia, sem data: "${PROMESSA_PLANILHA_ELETROPOSTO}"`,
    '- Pix: ofereça primeiro o link da Kiwify. Quem paga na chave e manda a foto do comprovante continua liberado pela foto.',
    '- Reembolso é com a Giovanna (pessoa). Nunca diga que devolveu ou que vai devolver.',
  ].join('\n');
}
