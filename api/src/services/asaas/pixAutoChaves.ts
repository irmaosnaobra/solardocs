// Chaves e forma da atribuição do Pix Automático em system_state (banco principal, sem migration).
// Módulo à parte de propósito: não importa nada e é usado pelo criador (pixRecorrenteService) e pelo webhook.

// Atribuição da venda (quiz, anúncio) guardada na criação e lida pelo webhook. Mora em
// system_state (sem migration): a tabela asaas_pix_assinaturas não ganha coluna.
export interface AtribuicaoPixAuto {
  /** 'publica' = veio da rota pública (sem login): o e-mail digitado pode ser de outra pessoa. */
  rota?: string | null;
  origem?: string | null; whatsapp?: string | null; nome?: string | null; lp_session?: string | null;
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null;
  utm_content?: string | null; utm_term?: string | null; fbc?: string | null; fbp?: string | null;
}

const CAMPOS_ATRIBUICAO: Array<keyof AtribuicaoPixAuto> = [
  'rota', 'origem', 'whatsapp', 'nome', 'lp_session', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'fbc', 'fbp',
];

/** Só os campos conhecidos, só texto, aparado e com teto. Vazio vira null (nada a gravar). */
export function limparAtribuicao(a: AtribuicaoPixAuto | null | undefined): AtribuicaoPixAuto | null {
  if (!a || typeof a !== 'object') return null;
  const out: AtribuicaoPixAuto = {};
  for (const k of CAMPOS_ATRIBUICAO) {
    const v = (a as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

// Chaves de system_state do Pix Automático (todas no banco principal).
/** conciliationIdentifier do QR imediato → { contract_id, em }. É a ligação do PAYMENT_RECEIVED com o contrato. */
export const chavePixAutoQr = (conciliationIdentifier: string) => `pix_auto_qr:${conciliationIdentifier}`;
/** contract_id → atribuição (origem, whatsapp, nome, lp_session, utm_*, fbc, fbp). */
export const chavePixAutoAtrib = (contractId: string) => `pix_auto_atrib:${contractId}`;
/** payment id do débito mensal → { authorization_id }. */
export const chavePixAutoPag = (paymentId: string) => `pix_auto_pag:${paymentId}`;
/** Claim só de inserção: 23505 = a adesão deste contrato já foi feita. */
export const chaveAdesaoAsaas = (contractKey: string) => `asaas_adesao:${contractKey}`;

