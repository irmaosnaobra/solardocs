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
/** contract_id → { expira_em (ISO), segundos, fallback, em }: a validade REAL do código do 1º mês (ver pixAutoValidade.ts). Não é o `pix_auto_qr`, que é por conciliationIdentifier. */
export const chavePixAutoExp = (contractId: string) => `pix_auto_exp:${contractId}`;
/** hmac do telefone → { contractId, em }: o 1 código NOVO por conversa em 24 h (só insert). */
export const chavePixAutoConv = (hmac: string) => `pix_auto_conv:${hmac}`;
/** payment id do débito mensal → { authorization_id }. */
export const chavePixAutoPag = (paymentId: string) => `pix_auto_pag:${paymentId}`;
/** Claim só de inserção: 23505 = a adesão deste contrato já foi feita. */
export const chaveAdesaoAsaas = (contractKey: string) => `asaas_adesao:${contractKey}`;

// Pix AVULSO do funil (QR estático, 1 por checkout, sem CPF). Todas no system_state do banco principal.
/** uuid do checkout → { status, qrId, email, whatsapp, nome, origem, atrib, criado_em, expira_em }. */
export const chavePixAvulso = (id: string) => `pix_avulso:${id}`;
/** id do QR estático do Asaas → { id (uuid do checkout), em }. É a ligação do pagamento (payment.pixQrCodeId) com o checkout. */
export const chavePixAvulsoQr = (qrId: string) => `pix_avulso_qr:${qrId}`;
/** Claim só de inserção por pagamento: CONFIRMED e RECEIVED do mesmo payment.id creditam uma vez. */
export const chavePixAvulsoPag = (paymentId: string) => `pix_avulso_pag:${paymentId}`;
/** e-mail (minúsculo) → { id: uuid do último checkout avulso }. Reabrir o modal reaproveita o QR ainda válido. */
export const chavePixAvulsoEmail = (email: string) => `pix_avulso_email:${email}`;
/** Claim do aviso "Pix recebido sem dono": um aviso por pagamento. */
export const chavePixSemDono = (paymentId: string) => `pix_sem_dono:${paymentId}`;

