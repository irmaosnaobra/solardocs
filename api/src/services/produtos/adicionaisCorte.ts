/**
 * O CORTE DO FECHA VENDAS: quem assina DEPOIS do corte não leva mais o curso de brinde.
 *
 * Só vale com ADICIONAIS_MENSAIS ligada e ADICIONAIS_CORTE definida (ISO). Desligada, ou sem data, devolve
 * sempre "o brinde vale": é o estado de hoje e o lado seguro (errar para dar acesso a mais, nunca para tirar de
 * quem já tinha).
 *
 * A data de início da assinatura NÃO é coluna de `users`. Duas fontes dizem quando ela começou:
 *   - `sales` (a venda do cartão e a adesão do Pix automático gravam `card_passed_at`);
 *   - `asaas_pix_assinaturas.created_at` (o contrato nasce ANTES do pagamento, e o webhook libera o curso antes
 *     de gravar a venda: sem esta, o 1º Pix depois do corte ainda levaria o curso).
 * Vale a mais antiga das duas. Sem nenhuma (conta antiga, comprovante manual, cortesia), cai na data de criação da
 * conta: conta nova depois do corte é assinatura nova. Qualquer erro de leitura vale "o brinde vale".
 *
 * Quem tem o curso POR POSSE (kit_pedidos pago, entitlement, `curso_vitalicio`) não passa por aqui: o curso
 * continua dele, com ou sem este corte.
 */

import { supabase } from '../../utils/supabase';
import { adicionaisLigado, corteDosAdicionais } from './adicionais';

let avisouSemCorte = false;

const ms = (v: unknown): number | null => {
  const t = typeof v === 'string' && v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Quando a assinatura deste e-mail começou (ms), ou null se nenhuma fonte soube dizer. */
export async function inicioDaAssinatura(email: string): Promise<number | null> {
  const emailLc = email.toLowerCase().trim();
  const datas: number[] = [];

  const { data: vendas } = await supabase.from('sales').select('card_passed_at, created_at').eq('email', emailLc);
  for (const v of (vendas ?? []) as Array<{ card_passed_at?: string | null; created_at?: string | null }>) {
    const t = ms(v.card_passed_at) ?? ms(v.created_at);
    if (t !== null) datas.push(t);
  }

  const { data: contratos } = await supabase.from('asaas_pix_assinaturas').select('created_at, status').eq('email', emailLc);
  for (const c of (contratos ?? []) as Array<{ created_at?: string | null; status?: string | null }>) {
    // QR que venceu sem pagamento não é assinatura: não pode "envelhecer" quem assinou depois.
    if (c.status === 'expirado' || c.status === 'recusado') continue;
    const t = ms(c.created_at);
    if (t !== null) datas.push(t);
  }

  if (datas.length) return Math.min(...datas);

  const { data: conta } = await supabase.from('users').select('created_at').eq('email', emailLc).maybeSingle();
  return ms((conta as { created_at?: string | null } | null)?.created_at);
}

/**
 * O assinante deste e-mail leva o Fecha Vendas de brinde? true = leva (como sempre foi). false = assinou depois
 * do corte e o curso só vem pela compra.
 */
export async function brindeFechaVendasVale(email: string | null | undefined): Promise<boolean> {
  if (!adicionaisLigado()) return true;
  const corte = corteDosAdicionais();
  if (corte === null) {
    if (!avisouSemCorte) {
      avisouSemCorte = true;
      console.warn('[adicionais] ADICIONAIS_MENSAIS ligada sem ADICIONAIS_CORTE valida: o Fecha Vendas segue de brinde para todos');
    }
    return true;
  }
  const mail = String(email ?? '').trim();
  if (!mail) return true;
  try {
    const inicio = await inicioDaAssinatura(mail);
    if (inicio === null) return true;
    return inicio < corte;
  } catch (err) {
    console.error('[adicionais] nao consegui ler o inicio da assinatura (o brinde vale):', err);
    return true;
  }
}

/** Para teste: o aviso de "sem corte" sai uma vez por instância. */
export function _resetarAvisoSemCorte(): void { avisouSemCorte = false; }
