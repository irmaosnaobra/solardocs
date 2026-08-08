// ─────────────────────────────────────────────────────────────────────────────
// Endpoints do Pix recorrente (Asaas). O Stripe segue dono do cartão; este
// arquivo não toca em nada dele além de cancelar assinatura duplicada no webhook.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/apiError';
import { asaasHabilitado } from '../services/asaas/asaasClient';
import {
  criarPixRecorrente, buscarAssinaturaAtiva, cancelarPixRecorrente, docValido, soDigitos, PLANOS_PIX,
} from '../services/asaas/pixRecorrenteService';
import { processarWebhookAsaas, AsaasWebhookBody } from '../services/asaas/asaasWebhookService';

function responderErro(res: Response, err: unknown, contexto: string): void {
  const status = (err as { statusCode?: number; status?: number })?.statusCode
    ?? (err as { status?: number })?.status ?? 500;
  const msg = (err as Error)?.message || 'Erro inesperado';
  if (status >= 500) logger.error('pix-recorrente', `${contexto}: ${msg}`, err);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
}

// POST /payments/pix-recorrente — cria (ou devolve) o contrato do cliente logado.
export async function criarPixRecorrenteHandler(req: Request, res: Response): Promise<void> {
  try {
    const { plan, cpfCnpj, nome, whatsapp, cupom } = (req.body ?? {}) as Record<string, string>;

    if (!asaasHabilitado()) throw new ApiError(503, 'Pagamento por Pix recorrente ainda não está disponível');
    if (!PLANOS_PIX[plan]) throw new ApiError(400, 'Plano inválido');
    if (!docValido(cpfCnpj)) throw new ApiError(400, 'Informe um CPF ou CNPJ válido');

    const { data: user } = await supabase
      .from('users').select('id, email, nome, whatsapp').eq('id', req.userId).maybeSingle();
    if (!user) throw new ApiError(404, 'Usuário não encontrado');

    const u = user as { id: string; email: string; nome: string | null; whatsapp: string | null };

    const criado = await criarPixRecorrente({
      userId: u.id,
      email: u.email,
      nome: (nome || u.nome || u.email).trim(),
      cpfCnpj,
      whatsapp: soDigitos(whatsapp) || u.whatsapp,
      planKey: plan,
      cupom,
    });

    // Guarda o telefone informado aqui — é por ele que a Giovanna avisa o
    // vencimento depois. Nunca apaga o que já existe.
    const fone = soDigitos(whatsapp);
    if (fone && !u.whatsapp) {
      await supabase.from('users').update({ whatsapp: fone }).eq('id', u.id);
    }

    res.json({
      ...criado,
      // A instrução muda com o trilho e o cliente PRECISA saber em qual está:
      // num ele não faz mais nada, no outro ele paga um QR todo mês.
      instrucao: criado.modo === 'automatico'
        ? `Pague este Pix${criado.cupom ? ` de R$ ${criado.primeiroMes}` : ''} no app do banco e autorize a cobrança mensal quando ele perguntar. Dos próximos meses em diante o débito é automático${criado.cupom ? `, de R$ ${criado.valor}` : ''}.`
        : `Pague este Pix${criado.cupom ? ` de R$ ${criado.primeiroMes}` : ''} pra liberar o acesso. Todo mês você recebe um novo código no WhatsApp e no e-mail${criado.cupom ? ` (R$ ${criado.valor} a partir do mês que vem)` : ''} — a confirmação é automática.`,
    });
  } catch (err) {
    responderErro(res, err, 'criar');
  }
}

// GET /payments/pix-recorrente — estado atual pra tela consultar/poll.
export async function statusPixRecorrenteHandler(req: Request, res: Response): Promise<void> {
  try {
    const linha = await buscarAssinaturaAtiva(req.userId);
    if (!linha) {
      res.json({ ativo: false, contrato: null, disponivel: asaasHabilitado() });
      return;
    }
    const { data: user } = await supabase
      .from('users').select('plano, plano_expira_em').eq('id', req.userId).maybeSingle();

    res.json({
      ativo: linha.status === 'ativo',
      disponivel: asaasHabilitado(),
      contrato: {
        modo: linha.modo,
        status: linha.status,
        plano: linha.plano,
        valor: Number(linha.valor),
        qrPayload: linha.qr_payload,
        ultimoPagamentoEm: linha.ultimo_pagamento_em,
        proximoVencimento: linha.proximo_vencimento,
      },
      acessoAte: (user as { plano_expira_em?: string | null } | null)?.plano_expira_em ?? null,
    });
  } catch (err) {
    responderErro(res, err, 'status');
  }
}

// POST /payments/pix-recorrente/cancelar
export async function cancelarPixRecorrenteHandler(req: Request, res: Response): Promise<void> {
  try {
    const cancelou = await cancelarPixRecorrente(req.userId);
    res.json({
      cancelado: cancelou,
      // Cancelou ≠ perdeu acesso: o mês já pago continua valendo.
      mensagem: cancelou
        ? 'Cobrança cancelada. Seu acesso continua até o fim do período já pago.'
        : 'Você não tem cobrança por Pix ativa.',
    });
  } catch (err) {
    responderErro(res, err, 'cancelar');
  }
}

// POST /payments/asaas/webhook — chamado pelo Asaas, sem auth de usuário.
export async function asaasWebhookHandler(req: Request, res: Response): Promise<void> {
  const esperado = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  const recebido = String(req.headers['asaas-access-token'] || '').trim();

  // FECHADO POR PADRÃO: sem token configurado, ninguém libera plano por aqui.
  if (!esperado) {
    logger.error('asaas-webhook', 'ASAAS_WEBHOOK_TOKEN não configurado — webhook recusado');
    res.status(503).json({ error: 'webhook não configurado' });
    return;
  }
  if (recebido !== esperado) {
    logger.error('asaas-webhook', 'token inválido no webhook do Asaas');
    res.status(401).json({ error: 'token inválido' });
    return;
  }

  try {
    const resultado = await processarWebhookAsaas((req.body ?? {}) as AsaasWebhookBody);
    res.json({ received: true, ...resultado });
  } catch (err) {
    // 5xx faz o Asaas reenviar (e pausar a fila após 15 falhas seguidas) — é o
    // que queremos: melhor reprocessar depois do que engolir um pagamento. As
    // travas de idempotência seguram a reentrega.
    logger.error('asaas-webhook', 'processamento falhou — devolvendo 500 pro Asaas reenviar', err);
    res.status(500).json({ error: 'falha ao processar' });
  }
}
