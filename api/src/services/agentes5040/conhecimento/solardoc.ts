// ─────────────────────────────────────────────────────────────────────────────
// CONHECIMENTO DA CARLA (SolarDoc). Preço único e produtos avulsos.
//
// Os preços dos avulsos NÃO são escritos aqui: vêm de produtos/catalogo.ts, a fonte
// única da loja. Só o plano mensal (R$ 67) mora neste arquivo, porque não é produto
// do catálogo (é a assinatura do SaaS).
// ─────────────────────────────────────────────────────────────────────────────

import { produtoPorId } from '../../produtos/catalogo';
import { PRECOS, adicionaisLigado } from '../../produtos/adicionais';

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

/** Todo valor em reais que a Carla pode escrever: o plano e os preços dos avulsos (os de hoje, com ADICIONAIS_MENSAIS desligada). */
export const VALORES_PERMITIDOS_CARLA: readonly number[] = [
  PLANO_MENSAL.valor,
  ...AVULSOS.map(a => a.preco),
].filter((v, i, a) => a.indexOf(v) === i);

/**
 * A lista que vale AGORA. Com ADICIONAIS_MENSAIS ligada, Venda Off-Grid, Estoque em Dia e Fecha Vendas passam a ser adicionais por mês:
 * entram R$ 17 (cada), R$ 30 (as 4 no checkout do plano) e R$ 40 (as 4 no app) e saem R$ 27 e R$ 97, que eram os preços de compra única.
 * O R$ 67 fica (plano e Precificação avulsa). A trava lê esta função, não a constante.
 */
export function valoresPermitidosCarla(): readonly number[] {
  if (!adicionaisLigado()) return VALORES_PERMITIDOS_CARLA;
  return [PLANO_MENSAL.valor, PRECOS.avulso, PRECOS.pacoteCheckout, PRECOS.pacoteApp]
    .filter((v, i, a) => a.indexOf(v) === i);
}

/** Texto das ferramentas adicionais (Carla, com a flag ligada). Não nomeia o LimpaPro: o teste do conhecimento proíbe. */
export const TEXTO_ADICIONAIS_CARLA =
  `Ferramentas adicionais, só quando a conversa pede e de preferência depois que pagou o plano: Venda Off-Grid, Estoque em Dia e Fecha Vendas, R$ ${PRECOS.avulso} por mês cada, ` +
  `ou as 4 ferramentas da loja do app por R$ ${PRECOS.pacoteApp} por mês. Valem enquanto ele paga e cancela quando quiser. ` +
  `Quem vai assinar vê as ferramentas no checkout do plano: R$ ${PRECOS.avulso} por mês cada, ou as 4 por R$ ${PRECOS.pacoteCheckout} por mês. ` +
  'Quem já tem uma delas continua com ela, sem cobrança nova. A Precificação Profissional segue avulsa, R$ 67.';

/** Promessa permitida, só para quem fecha no mesmo dia e sem dar data de lançamento. */
export const PROMESSA_PLANILHA_ELETROPOSTO =
  'Logo teremos a planilha de eletroposto, e quem fechar hoje terá acesso a ela.';

/**
 * O que NÃO vem no plano mensal: fica em "Para crescer" e é vendido à parte. Os rótulos do app. A retomada dos usuários (03/11/2026) cita
 * esta lista; ela NÃO entra em textoConhecimentoSolarDoc() porque o teste proíbe o LimpaPro ali.
 */
export const PARA_LIBERAR: readonly string[] = ['Venda Off-Grid', 'Estoque em Dia', 'Precificação', 'Fecha Vendas', 'LimpaPro'];

/**
 * As novidades que a Carla pode afirmar a quem voltou (texto do redator, 31/10/2026). Entram SÓ as que o orquestrador confirmou NO AR
 * (página ao vivo, depois de um deploy READY) e marcou. Vazia = os fatos da retomada saem sem o bloco de novidades e a Carla fala só do
 * que já está no conhecimento. Cada linha começa com maiúscula, sem preço, sem "menu", sem Pix e sem NEXUS (o Pix vai pelo modo).
 */
export const NOVIDADES_SOLARDOC: readonly string[] = [
  'Tela de atalhos no celular com a cor e a logo da sua empresa: Nova proposta e Ler conta de luz logo no topo, e os últimos documentos a um toque.',
  'Tudo organizado pelo que mais se usa, e a pasta Arquivos guarda todos os documentos, agora com opção de excluir.',
  'Manutenção preventiva: o registro das visitas de manutenção de cada cliente.',
];

/**
 * O conhecimento EXTRA da retomada, impresso só nos fatos de quem recebeu a mensagem de retomada. As regras de preço, de IA, de urgência e
 * da Giovanna não se repetem aqui: já estão no SISTEMA_FIXO_CARLA e na trava ("plataforma inteira por esse preço" reprova).
 */
export function textoRetomadaSolarDoc(): string[] {
  const l: string[] = [];
  if (NOVIDADES_SOLARDOC.length) {
    l.push('NOVIDADES DA PLATAFORMA (só estas, uma por vez, sem inventar outra):');
    for (const n of NOVIDADES_SOLARDOC) l.push(`- ${n}`);
  }
  if (adicionaisLigado()) {
    l.push(`Não vêm no plano de R$ ${PLANO_MENSAL.valor} e ficam na loja do app: ${PARA_LIBERAR.join(', ')}. Venda Off-Grid, Estoque em Dia, Fecha Vendas e LimpaPro saem por R$ ${PRECOS.avulso} por mês cada, ou as 4 por R$ ${PRECOS.pacoteApp} por mês, e valem enquanto ele paga. A Precificação é avulsa. Assinar o plano não libera nenhum deles.`);
    return l;
  }
  l.push(`Não vêm no plano de R$ ${PLANO_MENSAL.valor} e ficam em Para crescer, vendidos à parte: ${PARA_LIBERAR.join(', ')}. Assinar não libera nenhum deles.`);
  return l;
}

export function textoConhecimentoSolarDoc(): string {
  const avulsos = AVULSOS.map(a => `${a.nome}: R$ ${a.preco}`).join('; ');
  return [
    'SOLARDOC (o que você pode afirmar):',
    `- Plano único: R$ ${PLANO_MENSAL.valor} por mês, cobrado na hora, garantia de ${PLANO_MENSAL.garantiaDias} dias, cancela quando quiser.`,
    `- Os ${DOCUMENTOS_SOLARDOC.length} documentos, todos com a marca do integrador: ${DOCUMENTOS_SOLARDOC.join(', ')}.`,
    '- O carro-chefe é o orçamento de 1 página: investimento, economia por mês em reais e tempo de retorno numa folha só. Marca própria: a logo, a cor e o CNPJ do integrador em tudo, não a nossa.',
    '- Não existe cupom, nem desconto, nem Pix de R$ 19, nem plano anual.',
    adicionaisLigado()
      ? `- ${TEXTO_ADICIONAIS_CARLA}`
      : `- Produtos avulsos (Kiwify, o acesso chega sozinho), só quando a conversa pede e depois que pagou: ${avulsos}.`,
    `- Promessa permitida só para quem fecha no mesmo dia, sem data: "${PROMESSA_PLANILHA_ELETROPOSTO}"`,
    '- Pix: só o Pix automático (peça pix_automatico), que cobra na conta da pessoa todo mês. O sistema manda o código dessa pessoa (ou pede o CPF). Sem chave escrita por você, sem código escrito por você e sem comprovante.',
    '- Cartão de crédito: aceito. Pelo link de assinatura só para quem não tem conta; quem já tem conta assina por dentro do app.',
    '- Reembolso é com a Giovanna (pessoa). Nunca diga que devolveu ou que vai devolver.',
  ].join('\n');
}
