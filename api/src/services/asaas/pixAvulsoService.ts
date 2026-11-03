// ─────────────────────────────────────────────────────────────────────────────
// PIX AVULSO DO FUNIL (quiz e LP do SolarDoc): "gerar o código do Pix para copiar e pagar", R$ 67, sem CPF.
//
// O Pix Automático exige cliente com CPF; aqui não. Cada checkout ganha um QR ESTÁTICO do Asaas
// (POST /pix/qrCodes/static, sem cliente) e o pagamento volta ligado a ele por `payment.pixQrCodeId`.
// O webhook (asaasWebhookService) reconhece o QR por `pix_avulso_qr:<qrId>` e credita o mês.
//
// Estado no system_state do banco principal (sem migration):
//   pix_avulso:<uuid>      = { status, qrId, email, whatsapp, nome, origem, atrib, criado_em, expira_em }
//   pix_avulso_qr:<qrId>   = { id: <uuid>, em }
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/apiError';
import { PIX_MES_VALOR } from '../../utils/pixInfo';
import { AsaasError } from './asaasClient';
import { chavePixAsaas, gerarQrEstatico, PIX_AVULSO_EXPIRA_SEG } from './pixAvulsoAsaas';
import { chavePixAvulso, chavePixAvulsoQr, chavePixAvulsoEmail, type AtribuicaoPixAuto } from './pixAutoChaves';
import { lerEstado, gravarSoSeNovo } from './asaasWebhookService';
import { gravarEstado } from './pixRecorrenteService';

export { chavePixAsaas } from './pixAvulsoAsaas';

export interface PixAvulsoCriado {
  id: string;
  payload: string;
  /** PNG em base64 puro (sem o prefixo data:). */
  encodedImage: string;
  valor: number;
  /** ISO com fuso (Z). */
  expiraEm: string;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só reaproveita o QR que ainda tem mais que isto de validade (dá tempo de abrir o app do banco e pagar). */
const REUSO_MIN_VALIDADE_MS = 15 * 60_000;

export async function criarPixAvulso(args: {
  email: string; whatsapp: string; nome: string; origem: string; atribuicao: AtribuicaoPixAuto;
}): Promise<PixAvulsoCriado> {
  const agora = Date.now();

  // Quem fecha e reabre o modal (ou cai do automático no avulso) recebe o MESMO código, em vez de um QR novo a cada clique.
  const indice = await lerEstado(chavePixAvulsoEmail(args.email));
  if (indice?.id) {
    const antigo = await lerEstado(chavePixAvulso(String(indice.id)));
    const expira = Date.parse(String(antigo?.expira_em ?? ''));
    if (antigo && antigo.status === 'pendente' && antigo.payload && antigo.encodedImage
      && Number.isFinite(expira) && expira - agora > REUSO_MIN_VALIDADE_MS) {
      logger.info('pix-avulso', `checkout ${indice.id} reaproveitado (${args.origem})`);
      return { id: String(indice.id), payload: String(antigo.payload), encodedImage: String(antigo.encodedImage), valor: PIX_MES_VALOR, expiraEm: new Date(expira).toISOString() };
    }
  }

  const id = randomUUID();
  // O prazo é nosso (agora + 24 h, em UTC): o expirationDate do Asaas pode vir sem fuso.
  const expiraEm = new Date(agora + PIX_AVULSO_EXPIRA_SEG * 1000).toISOString();

  let qr;
  try {
    const addressKey = await chavePixAsaas();
    // Prefixo 'sdav:' nunca é 'pc:' (PlugCash olha externalReference 'pc:' e paymentLink), então o QR não vira venda de curso.
    qr = await gerarQrEstatico(addressKey, `sdav:${id}`);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof AsaasError) {
      logger.error('pix-avulso', `Asaas recusou o QR estático (HTTP ${err.status})`);
      throw new ApiError(502, 'Pix indisponível agora');
    }
    throw err;
  }

  // Sem as duas ligações gravadas o pagamento não acharia o checkout: melhor falhar antes de mostrar o código.
  const estado = await gravarSoSeNovo(chavePixAvulso(id), {
    status: 'pendente', qrId: qr.id, payload: qr.payload, encodedImage: qr.encodedImage, email: args.email, whatsapp: args.whatsapp, nome: args.nome,
    origem: args.origem, atrib: args.atribuicao, criado_em: new Date(agora).toISOString(), expira_em: expiraEm,
  });
  const ligacao = estado === 'novo' ? await gravarSoSeNovo(chavePixAvulsoQr(qr.id), { id, em: new Date(agora).toISOString() }) : 'erro';
  if (estado !== 'novo' || ligacao !== 'novo') {
    logger.error('pix-avulso', `não gravei o estado do checkout ${id} (estado ${estado}, ligação ${ligacao}): código não entregue`);
    throw new ApiError(502, 'Pix indisponível agora');
  }

  // Índice por e-mail: se não gravar, só perde o reuso (o checkout em si está salvo).
  await gravarEstado(chavePixAvulsoEmail(args.email), { id, em: new Date(agora).toISOString() }, 'avulso-email');

  logger.info('pix-avulso', `checkout ${id} criado (${args.origem})`);
  return { id, payload: qr.payload, encodedImage: qr.encodedImage, valor: PIX_MES_VALOR, expiraEm };
}

/** Status que a tela pergunta. `pago` vence o relógio; só pago/expirado/pendente saem daqui. */
export async function statusPixAvulso(id: string): Promise<{ status: 'pendente' | 'pago' | 'expirado'; valor: number } | null> {
  if (!UUID_RE.test(id)) return null;
  const reg = await lerEstado(chavePixAvulso(id));
  if (!reg) return null;
  if (reg.status === 'pago') return { status: 'pago', valor: PIX_MES_VALOR };
  const expira = Date.parse(String(reg.expira_em ?? ''));
  return { status: Number.isFinite(expira) && Date.now() > expira ? 'expirado' : 'pendente', valor: PIX_MES_VALOR };
}
