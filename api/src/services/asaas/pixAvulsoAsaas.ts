// Parte do Pix AVULSO que só fala com o Asaas (chave Pix da conta e QR estático). Sem banco de propósito:
// a sonda de sandbox carrega só este arquivo e o asaasClient, que já escolhe entre produção e sandbox.

import { asaasFetch } from './asaasClient';
import { ApiError } from '../../utils/apiError';
import { PIX_MES_VALOR } from '../../utils/pixInfo';

const UMA_HORA_MS = 3600_000;
export const PIX_AVULSO_EXPIRA_SEG = 86400;
export const PIX_AVULSO_DESCRICAO = 'SolarDoc VIP mensal';

let cache: { chave: string; ate: number } | null = null;

/** Só para teste: esquece a chave guardada em memória. */
export function _resetChavePixAsaas(): void { cache = null; }

/**
 * Chave Pix ativa da conta Asaas (a primeira). Guarda 1 h em memória; a AUSÊNCIA de chave não é guardada.
 * O valor da chave nunca vai para log nem para a resposta.
 */
export async function chavePixAsaas(): Promise<string> {
  if (cache && cache.ate > Date.now()) return cache.chave;
  const r = await asaasFetch<{ data?: Array<{ key?: string; status?: string }> }>('/pix/addressKeys?status=ACTIVE');
  const ativa = (r?.data ?? []).find((k) => typeof k?.key === 'string' && k.key.trim() && (!k.status || k.status === 'ACTIVE'));
  if (!ativa?.key) throw new ApiError(503, 'Pix indisponível agora');
  cache = { chave: ativa.key.trim(), ate: Date.now() + UMA_HORA_MS };
  return cache.chave;
}

export interface QrEstaticoAsaas { id: string; payload: string; encodedImage: string; expirationDate?: string | null }

/** POST /pix/qrCodes/static: um QR de R$ 67 por checkout, pagamento único, sem cliente. */
export async function gerarQrEstatico(addressKey: string, externalReference: string): Promise<QrEstaticoAsaas> {
  const r = await asaasFetch<Partial<QrEstaticoAsaas>>('/pix/qrCodes/static', {
    method: 'POST',
    body: {
      addressKey,
      description: PIX_AVULSO_DESCRICAO,
      value: PIX_MES_VALOR,
      format: 'ALL',
      expirationSeconds: PIX_AVULSO_EXPIRA_SEG,
      allowsMultiplePayments: false,
      externalReference,
    },
  });
  if (!r?.id || !r.payload || !r.encodedImage) throw new ApiError(502, 'Pix indisponível agora');
  return { id: r.id, payload: r.payload, encodedImage: r.encodedImage, expirationDate: r.expirationDate ?? null };
}
