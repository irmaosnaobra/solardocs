/**
 * ADICIONAIS NO PIX AUTOMÁTICO DO PLANO (o bump do checkout, pago junto com a mensalidade).
 *
 * A autorização do Asaas tem valor FIXO e não dá para alterar depois: o bump entra no `value` na criação
 * (R$ 67 + adicionais) e o que foi escolhido fica em `system_state` (`pix_auto_adic:<contrato>`, sem migration, como a
 * atribuição e a validade do QR). A coluna `valor` da linha do contrato continua sendo a mensalidade do plano (R$ 67):
 * o que soma é o adicional. Em cada pagamento confirmado o webhook estende os adicionais por 1 mês + 3 dias.
 *
 * Módulo pequeno e sem dependência dos serviços do Asaas de propósito: o criador do contrato e o webhook importam
 * daqui, e um import circular deixaria o `require` do dist pela metade.
 */

import { supabase } from '../../utils/supabase';
import { PRECOS, adicionaisLigado, comFolga, normalizarAdicionais, obsDoAdicional, produtosDoItem, somaMensal } from './adicionais';
import { concederOuEstender } from './acessos';

export const chaveAdicionaisDoPlano = (contractId: string) => `pix_auto_adic:${contractId}`;

/** O que do corpo da requisição vale: só com a flag ligada, e só ids conhecidos. Desligada devolve []. */
export function adicionaisDoPedido(entrada: unknown): string[] {
  return adicionaisLigado() ? normalizarAdicionais(entrada) : [];
}

export interface AdicionaisDoContrato { itens: string[]; valor: number }

export async function gravarAdicionaisDoPlano(contractId: string, itens: string[]): Promise<void> {
  if (!itens.length) return;
  const value: AdicionaisDoContrato = { itens, valor: somaMensal(itens, 'checkout') };
  const { error } = await supabase.from('system_state').upsert({ key: chaveAdicionaisDoPlano(contractId), value }, { onConflict: 'key' });
  if (error) console.error(`[adicionais] contrato ${contractId}: adicionais NAO gravados (${error.message}): estender na mao se pagar`);
}

export async function lerAdicionaisDoPlano(contractId: string): Promise<AdicionaisDoContrato | null> {
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', chaveAdicionaisDoPlano(contractId)).maybeSingle();
    const v = (data as { value?: Partial<AdicionaisDoContrato> } | null)?.value;
    const itens = normalizarAdicionais(v?.itens);
    return itens.length ? { itens, valor: somaMensal(itens, 'checkout') } : null;
  } catch {
    return null;
  }
}

/**
 * TRAVA do fallback por customer do webhook do Asaas: o pagamento chegou SEM ligação exata (sem assinatura nem referência) e o webhook ia
 * creditar o mês do PLANO pelo customer (o mesmo CPF tem a autorização do plano e a do adicional). Devolve true quando ele parece ser de
 * adicional: a descrição diz "adicional", ou o valor é o de um adicional do app (R$ 17 ou R$ 40) e NÃO bate com o que este contrato de
 * plano cobra (mensalidade, 1º mês, com ou sem o bump). Quem tem ligação exata (assinatura ou referência) nunca cai aqui.
 */
export async function pagamentoParecePixDeAdicional(
  p: { value?: number | null; description?: string | null; subscription?: string | null; externalReference?: string | null },
  contrato: { contract_id: string; valor: number | string; primeiro_mes?: number | string | null },
): Promise<boolean> {
  if (p.subscription || p.externalReference) return false;
  if (/adicional/i.test(String(p.description ?? ''))) return true;
  const valor = Number(p.value);
  if (!Number.isFinite(valor) || (valor !== PRECOS.avulso && valor !== PRECOS.pacoteApp)) return false;
  const ad = (await lerAdicionaisDoPlano(contrato.contract_id))?.valor ?? 0;
  const mensal = Number(contrato.valor);
  const primeiro = Number(contrato.primeiro_mes ?? contrato.valor);
  return ![mensal, primeiro, mensal + ad, primeiro + ad].some((v) => Math.abs(v - valor) < 0.005);
}

/**
 * Pagamento confirmado do contrato: cada ferramenta do bump vale por 1 mês + 3 dias a partir de agora (data absoluta,
 * então reentrega e renovação nunca empilham, e `concederOuEstender` nunca encurta). Devolve as ferramentas estendidas.
 */
export async function estenderAdicionaisDoPlano(userId: string, contractId: string): Promise<string[]> {
  const ad = await lerAdicionaisDoPlano(contractId);
  if (!ad) return [];
  const fim = new Date();
  fim.setMonth(fim.getMonth() + 1);
  const ate = comFolga(fim.getTime());
  const estendidos: string[] = [];
  for (const item of ad.itens) {
    for (const produto of produtosDoItem(item)) {
      await concederOuEstender({ userId, produto, ate, orderId: contractId, obs: obsDoAdicional('pix', item) });
      estendidos.push(produto);
    }
  }
  return estendidos;
}
