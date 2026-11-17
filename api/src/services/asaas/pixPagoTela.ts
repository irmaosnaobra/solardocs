// ─────────────────────────────────────────────────────────────────────────────
// O Pix foi pago? A resposta que as telas (quiz, LP, /pix-automatico, /pix-recorrente) leem para dizer "Pix pago".
//
// Reaproveita `pagamentoValeDesde` (a mesma regra que a Carla usa para "já pagou"), com duas travas a mais:
//   • `inadimplente` e `cancelado` NUNCA contam: o pagamento deles é de um mês antigo, de um contrato que a tela não está cobrando agora.
//   • `ativo` só conta com pagamento gravado (ativo sem pagamento vem do comprovante do WhatsApp ou de contrato velho: a tela segue pelo status).
// Pagamento de ANTES de o contrato nascer (contrato reaproveitado) também não conta: `ultimo_pagamento_em >= created_at`.
// Nunca devolve ultimo_pagamento_id, e-mail nem CPF.
// ─────────────────────────────────────────────────────────────────────────────
import { lerExpiracaoDoContrato } from './pixRecorrenteService';
import { pagamentoValeDesde, validadeDoCodigoMs } from './pixAutoValidade';
import { qrPngBase64 } from './qrPixImagem';

export type SituacaoPix = 'pago' | 'esperando' | 'vencido' | 'recusado' | 'cancelado' | 'inadimplente' | 'ativo';

export interface LinhaPagamentoPix {
  status: string;
  modo?: string | null;
  contract_id?: string | null;
  qr_payload?: string | null;
  created_at?: string | null;
  ultimo_pagamento_em?: string | null;
  ultimo_pagamento_id?: string | null;
}

export interface PagamentoPixTela {
  pago: boolean;
  pagoEm: string | null;
  situacao: SituacaoPix;
}

export interface CamposPixTela extends PagamentoPixTela {
  criadoEm: string | null;
  expiraEm: string | null;
}

function iso(v: string | null | undefined): string | null {
  const ms = Date.parse(String(v ?? ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function calcularPagamentoPix(l: LinhaPagamentoPix): PagamentoPixTela {
  const temPagamento = !!String(l.ultimo_pagamento_id ?? '').trim() || iso(l.ultimo_pagamento_em) !== null;
  let pago = false;
  if (l.status !== 'inadimplente' && l.status !== 'cancelado' && temPagamento) {
    const criadoMs = Date.parse(String(l.created_at ?? ''));
    // `pagamentoValeDesde` compara com `>`: um milissegundo a menos faz o empate valer (>= created_at).
    pago = pagamentoValeDesde({ ...l, status: l.status === 'ativo' ? 'pendente' : l.status }, (Number.isFinite(criadoMs) ? criadoMs : 0) - 1);
  }
  const situacao: SituacaoPix = pago ? 'pago'
    : l.status === 'expirado' ? 'vencido'
    : l.status === 'recusado' || l.status === 'cancelado' || l.status === 'inadimplente' || l.status === 'ativo' ? l.status
    : 'esperando';
  return { pago, pagoEm: pago ? iso(l.ultimo_pagamento_em) : null, situacao };
}

/**
 * A validade real do QR (chave pix_auto_exp, lida por `lerExpiracaoDoContrato`) quando existe; sem ela, a mesma regra da criação.
 * Só para contrato automático pendente com QR: nos demais casos nem lê o banco.
 */
async function expiraEmDoContrato(l: LinhaPagamentoPix): Promise<string | null> {
  if (l.modo !== 'automatico' || l.status !== 'pendente' || !l.qr_payload) return null;
  let expiraEm: string | null = null;
  if (l.contract_id) {
    const exp = await lerExpiracaoDoContrato(l.contract_id);
    if (exp.estado === 'ok') expiraEm = exp.expira_em; // 'ausente' ou 'erro': vale a regra da criação
  }
  const ms = validadeDoCodigoMs({ created_at: l.created_at, expira_em: expiraEm });
  return ms === null ? null : new Date(ms).toISOString();
}

export async function camposPixParaTela(l: LinhaPagamentoPix): Promise<CamposPixTela> {
  return { ...calcularPagamentoPix(l), criadoEm: iso(l.created_at), expiraEm: await expiraEmDoContrato(l) };
}

/** A imagem do QR (PNG em base64, sem prefixo) para a tela que pediu `?qr=1`. Só com o contrato pendente e com copia e cola. */
export function qrImagemParaTela(l: LinhaPagamentoPix, pediu: unknown): string | null {
  const quer = Array.isArray(pediu) ? pediu[0] : pediu;
  if (String(quer ?? '') !== '1') return null;
  if (l.status !== 'pendente' || !l.qr_payload) return null;
  return qrPngBase64(l.qr_payload);
}
