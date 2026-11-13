// ─────────────────────────────────────────────────────────────────────────────
// Rotas dos adicionais mensais (13/11/2026). Tudo atrás de ADICIONAIS_MENSAIS: desligada, a oferta responde
// `ligado: false` e o resto responde 404 `adicionais_desligados`.
//   GET  /produtos/adicionais/oferta   público, sem login
//   GET  /produtos/adicional           { ativos, podeComprar }
//   POST /produtos/adicional           { item, meio: 'cartao' | 'pix', cpf? | usarCpfSalvo? }
//   POST /produtos/adicional/cancelar  { item }
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import Stripe from 'stripe';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/apiError';
import { adicionaisLigado, ehItemValido, ofertaPublica } from '../services/produtos/adicionais';
import { estadoDosAdicionais, posseDoAdicional } from '../services/produtos/adicionaisApp';
import { cancelarAdicionalCartao, comprarAdicionalCartao, emailDaConta } from '../services/produtos/adicionaisCartaoApp';
import { cancelarAdicionalPix, criarPixAdicional } from '../services/produtos/adicionaisPix';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

function responderErro(res: Response, err: unknown, contexto: string): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  logger.error('adicionais', `${contexto}: ${(err as Error)?.message ?? 'erro'}`, err);
  res.status(500).json({ error: 'Erro inesperado. Tente de novo.' });
}

const desligado = (res: Response): boolean => {
  if (adicionaisLigado()) return false;
  res.status(404).json({ error: 'adicionais_desligados' });
  return true;
};

/** GET /produtos/adicionais/oferta: o front decide pela resposta; se a chamada falhar, trata como desligado. */
export function ofertaHandler(_req: Request, res: Response): void {
  res.json(ofertaPublica());
}

/** GET /produtos/adicional */
export async function estadoHandler(req: Request, res: Response): Promise<void> {
  try {
    res.json(await estadoDosAdicionais(req.userId));
  } catch (err) {
    responderErro(res, err, 'estado');
  }
}

/** POST /produtos/adicional: cartão devolve { url } ou { ok: true }; Pix devolve o QR da autorização. O preço é o do servidor. */
export async function comprarHandler(req: Request, res: Response): Promise<void> {
  try {
    if (desligado(res)) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!ehItemValido(b.item)) throw new ApiError(400, 'Item inválido');
    const item = b.item as string;

    if (b.meio === 'cartao') {
      const email = await emailDaConta(req.userId);
      if (!email) throw new ApiError(404, 'Usuário não encontrado');
      const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
      res.json(await comprarAdicionalCartao(stripe, { userId: req.userId, email, item, dashboardUrl }));
      return;
    }
    if (b.meio === 'pix') {
      res.json(await criarPixAdicional({ userId: req.userId, item, cpf: b.cpf, usarCpfSalvo: b.usarCpfSalvo }));
      return;
    }
    throw new ApiError(400, 'Forma de pagamento inválida');
  } catch (err) {
    responderErro(res, err, 'comprar');
  }
}

/** POST /produtos/adicional/cancelar { item }: o acesso continua até o fim do período já pago. */
export async function cancelarHandler(req: Request, res: Response): Promise<void> {
  try {
    if (desligado(res)) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!ehItemValido(b.item)) throw new ApiError(400, 'Item inválido');
    const item = b.item as string;

    const noCartao = (await posseDoAdicional(req.userId, item, 'cartao')).length > 0;
    const cancelou = noCartao
      ? await cancelarAdicionalCartao(stripe, { userId: req.userId, item })
      : await cancelarAdicionalPix(req.userId, item);
    if (!cancelou) throw new ApiError(404, 'Você não tem este adicional ativo.');
    res.json({ ok: true, mensagem: 'Cancelado. Seu acesso continua até o fim do período já pago.' });
  } catch (err) {
    responderErro(res, err, 'cancelar');
  }
}
