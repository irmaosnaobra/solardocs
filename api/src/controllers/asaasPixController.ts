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
  criarPixRecorrente, buscarAssinaturaAtiva, buscarAssinaturaPorId,
  cancelarPixRecorrente, docValido, soDigitos, PLANOS_PIX, type AtribuicaoPixAuto,
} from '../services/asaas/pixRecorrenteService';
import { processarWebhookAsaas, AsaasWebhookBody } from '../services/asaas/asaasWebhookService';
import { pixPublicoAtivo, pixAutoQuizAtivo, pixAutoLpAtivo, pixAvulsoFunilAtivo } from '../utils/pixInfo';
import { criarPixAvulso, statusPixAvulso } from '../services/asaas/pixAvulsoService';
import { gravarMarcaPagamento } from '../services/solardoc/marcaPagamentoQuiz';
import { codigoDaLp, gravarLeadLp } from '../services/solardoc/leadLpSolardoc';

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


// ─────────────────────────────────────────────────────────────────────────────
// CAMINHO PÚBLICO — quem abandonou o checkout da Stripe e ainda não tem conta.
//
// O trilho de Pix já nasceu preparado pra isto: `criarPixRecorrente` aceita
// `userId: null` e `asaas_pix_assinaturas.user_id` é nullable. O que faltava
// era a porta. Ela fica atrás de PIX_PUBLICO_ATIVO: rota sem login que cria
// cobrança de verdade não entra no ar no mesmo empurrão em que é escrita.
//
// Pagou sem conta, o webhook já sabe se virar: procura o dono pelo e-mail e,
// não achando, avisa o Thiago pra criar na mão em vez de engolir o pagamento.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * `utm_source` dos links que a casa manda SÓ ao cliente pagante (lembrete de renovação e dunning): quem chega por eles nunca vira lead de venda (sem marca
 * `quiz_pagto:` e sem lead `lp_solardoc_pix`). Os outros links (recuperação, Giovanna, SDR, link do Pix, e-mail) também falam com prospect: aí decide a conta.
 */
const UTM_SOURCE_DE_CLIENTE = new Set(['renovacao', 'dunning']);
/** Plano vencido há até 30 dias ainda é cliente (está renovando); depois disso volta a ser prospect. */
const CLIENTE_VENCIDO_TOLERANCIA_MS = 30 * 24 * 3600_000;

/** A conta é de cliente PAGANTE? `plano` diferente de `free`, ou `plano_expira_em` maior ou igual a agora menos 30 dias. Conta grátis sem plano vigente é prospect. */
export function contaEhDeClientePagante(u: { plano?: string | null; plano_expira_em?: string | null } | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!u) return false;
  const plano = String(u.plano ?? '').trim().toLowerCase();
  if (plano && plano !== 'free') return true;
  const expira = Date.parse(String(u.plano_expira_em ?? ''));
  return Number.isFinite(expira) && expira >= agoraMs - CLIENTE_VENCIDO_TOLERANCIA_MS;
}

/** Origem do quiz (trava PIX_AUTO_QUIZ) e da LP (trava PIX_AUTO_LP). Qualquer outro valor é ignorado. */
const ORIGEM_QUIZ_SOLARDOC = 'quiz_solardoc';
const ORIGEM_LP_SOLARDOC = 'lp_solardoc';

/** Só texto, aparado e com teto. Qualquer outro tipo (número, objeto, lista) vira vazio. */
function textoCurto(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

/** Atribuição de venda vinda de LP/anúncio (quiz). Só campos conhecidos; sem nenhum, undefined. */
function atribuicaoDoCorpo(b: Record<string, unknown>, origem: string | undefined): AtribuicaoPixAuto {
  // rota 'publica' SEMPRE (com ou sem quiz): é o que impede o webhook de cancelar o cartão de quem só digitou o e-mail de um cliente.
  const a: AtribuicaoPixAuto = { rota: 'publica' };
  const poe = (k: keyof AtribuicaoPixAuto, v: string | undefined) => { if (v) a[k] = v; };
  poe('origem', origem);
  poe('whatsapp', soDigitos(textoCurto(b.whatsapp, 30) || '').slice(0, 20) || undefined);
  poe('nome', textoCurto(b.nome, 120));
  poe('lp_session', textoCurto(b.lp_session, 80));
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbc', 'fbp'] as const) {
    poe(k, textoCurto(b[k], 200));
  }
  return a;
}

/** 10 ou 11 dígitos depois de tirar o 55 (DDD + número). */
function whatsappValido(v: unknown): boolean {
  let fone = soDigitos(typeof v === 'string' ? v : '');
  if (fone.length > 11 && fone.startsWith('55')) fone = fone.slice(2);
  return fone.length >= 10 && fone.length <= 11;
}

// POST /payments/pix-recorrente/publico — sem login.
export async function criarPixPublicoHandler(req: Request, res: Response): Promise<void> {
  try {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const { plan, email, nome, cpfCnpj, whatsapp, cupom } = corpo as Record<string, string>;
    const origem = corpo.origem === ORIGEM_QUIZ_SOLARDOC ? ORIGEM_QUIZ_SOLARDOC
      : corpo.origem === ORIGEM_LP_SOLARDOC ? ORIGEM_LP_SOLARDOC : undefined;
    const doFunil = (origem === ORIGEM_QUIZ_SOLARDOC && pixAutoQuizAtivo())
      || (origem === ORIGEM_LP_SOLARDOC && pixAutoLpAtivo());

    // Abre com a trava geral OU com a do funil (e só para chamada com a origem daquele funil).
    if (!pixPublicoAtivo() && !doFunil) throw new ApiError(503, 'Pagamento por Pix sem conta ainda não está disponível');
    if (!asaasHabilitado()) throw new ApiError(503, 'Pagamento por Pix recorrente ainda não está disponível');
    if (!PLANOS_PIX[plan]) throw new ApiError(400, 'Plano inválido');

    const mail = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) throw new ApiError(400, 'Informe um e-mail válido');
    if (!docValido(cpfCnpj)) throw new ApiError(400, 'Informe um CPF ou CNPJ válido');
    if (!(nome || '').trim()) throw new ApiError(400, 'Informe seu nome');
    // LP: o WhatsApp é a única forma de falar com quem gerou o código e não pagou.
    if (origem === ORIGEM_LP_SOLARDOC && !whatsappValido(whatsapp)) throw new ApiError(400, 'Informe o seu WhatsApp');

    // Já existe conta com esse e-mail? Amarra o contrato nela. Sem isto, quem
    // tem conta mas não estava logado pagaria e cairia no alerta de
    // "PAGAMENTO SEM CONTA" — dinheiro entrando e acesso preso na mão.
    const { data: jaTem } = await supabase
      .from('users').select('id, whatsapp, plano, plano_expira_em').eq('email', mail).maybeSingle();
    const dono = (jaTem as { id: string; whatsapp: string | null; plano?: string | null; plano_expira_em?: string | null } | null) ?? null;

    const atribuicao = atribuicaoDoCorpo(corpo, origem);

    const criado = await criarPixRecorrente({
      userId: dono?.id ?? null,
      email: mail,
      nome: nome.trim(),
      cpfCnpj,
      whatsapp: soDigitos(whatsapp) || dono?.whatsapp || null,
      planKey: plan,
      cupom,
      atribuicao,
      // Quiz e LP: só Pix Automático. Se não der, erro claro, nunca cair em assinatura.
      ...(origem ? { exigirAutomatico: true } : {}),
    });

    const fone = soDigitos(whatsapp);
    if (dono && fone && !dono.whatsapp) {
      await supabase.from('users').update({ whatsapp: fone }).eq('id', dono.id);
    }

    logger.info('pix-publico', `contrato ${criado.contractId} para ${mail} (${criado.modo}, conta ${dono ? 'existente' : 'ainda não criada'})`);

    // Contrato vivo reaproveitado já está autorizado: não há QR para pagar. A tela
    // do quiz distingue por status === 'ativo' (qrPayload nulo) e confere `modo`.
    const jaAtivo = Boolean(origem) && criado.status === 'ativo';

    // A marca de quem chegou no pagamento (quiz e LP): `quiz_pagto:<hmac>`. Só marca, não envia nada aqui; a rodada da Carla chama 5 min
    // depois, se a pessoa não pagou. Contrato já ativo não tem o que recuperar. Falha na marca nunca derruba a resposta.
    // Pix de teste (utm_source = raio-x-teste, o mesmo corte dos avisos do grupo) não gera marca: a Carla nunca chamaria um teste.
    const ehTeste = String(atribuicao.utm_source ?? '').trim().toLowerCase() === 'raio-x-teste';
    // Cliente PAGANTE (conta com plano, ou plano vencido há menos de 30 dias) ou quem chegou pelo link de renovação ou de dunning nunca vira lead de venda: nem marca,
    // nem lead da LP. Conta grátis sem plano vigente é prospect e ganha os dois, como qualquer um.
    const jaECliente = contaEhDeClientePagante(dono) || UTM_SOURCE_DE_CLIENTE.has(String(atribuicao.utm_source ?? '').trim().toLowerCase());
    if (origem && !jaAtivo && !ehTeste && !jaECliente) {
      await gravarMarcaPagamento({
        whatsapp: atribuicao.whatsapp ?? soDigitos(whatsapp), contratoId: criado.contractId, origem, email: mail,
        nome: nome.trim(), utm_term: atribuicao.utm_term, lp_session: atribuicao.lp_session,
      });
    }

    // LP: o lead no WhatsApp (leads_meta, form_id lp_solardoc_pix, sem sobrescrever o do quiz) e o `codigo` que o front põe no wa.me. Com o código
    // a Carla reconhece quem já escreveu; sem lead a marca da LP só recebe e-mail. Teste não grava lead. Falha no lead nunca derruba o Pix.
    let codigoLp: string | null = null;
    if (origem === ORIGEM_LP_SOLARDOC) {
      const foneLp = atribuicao.whatsapp ?? soDigitos(whatsapp);
      codigoLp = (jaAtivo || ehTeste || jaECliente) ? codigoDaLp(foneLp) : await gravarLeadLp({
        whatsapp: foneLp, nome: nome.trim(), lp_session: atribuicao.lp_session,
        utm: { utm_source: atribuicao.utm_source, utm_medium: atribuicao.utm_medium, utm_campaign: atribuicao.utm_campaign, utm_content: atribuicao.utm_content, utm_term: atribuicao.utm_term },
      });
    }

    res.json({
      ...criado,
      ...(jaAtivo ? { qrPayload: null, qrImagemBase64: null } : {}),
      ...(codigoLp ? { codigo: codigoLp } : {}),
      temConta: Boolean(dono),
      instrucao: criado.modo === 'automatico'
        ? `Pague este Pix${criado.cupom ? ` de R$ ${criado.primeiroMes}` : ''} no app do banco e autorize a cobrança mensal quando ele perguntar. Dos próximos meses em diante o débito é automático${criado.cupom ? `, de R$ ${criado.valor}` : ''}.`
        : `Pague este Pix${criado.cupom ? ` de R$ ${criado.primeiroMes}` : ''} pra liberar o acesso. Todo mês você recebe um novo código no WhatsApp e no e-mail${criado.cupom ? ` (R$ ${criado.valor} a partir do mês que vem)` : ''} — a confirmação é automática.`,
    });
  } catch (err) {
    responderErro(res, err, 'criar-publico');
  }
}

// GET /payments/pix-recorrente/publico/:id — a tela pergunta se já caiu.
// Chave é o uuid da linha, devolvido na criação. Responde SÓ o que a tela
// desenha: e-mail, CPF e ids do Asaas não saem daqui.
export async function statusPixPublicoHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!pixPublicoAtivo() && !pixAutoQuizAtivo() && !pixAutoLpAtivo()) throw new ApiError(503, 'Indisponível');
    const linha = await buscarAssinaturaPorId(String(req.params.id || ''));
    if (!linha) throw new ApiError(404, 'Contrato não encontrado');

    res.json({
      id: linha.id,
      status: linha.status,
      modo: linha.modo,
      plano: linha.plano,
      valor: Number(linha.valor),
      primeiroMes: Number(linha.primeiro_mes ?? linha.valor),
      cupom: linha.cupom,
      contractId: linha.contract_id,
      qrPayload: linha.qr_payload,
      proximoVencimento: linha.proximo_vencimento,
    });
  } catch (err) {
    responderErro(res, err, 'status-publico');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PIX AVULSO DO FUNIL — código copia e cola de R$ 67, sem CPF (quiz e LP do SolarDoc).
// Atrás de PIX_AVULSO_FUNIL e só para origem quiz_solardoc ou lp_solardoc. Não toca em PIX_PUBLICO_ATIVO.
// ─────────────────────────────────────────────────────────────────────────────

// POST /payments/pix-avulso/publico — sem login.
export async function criarPixAvulsoPublicoHandler(req: Request, res: Response): Promise<void> {
  try {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const origem = corpo.origem === ORIGEM_QUIZ_SOLARDOC ? ORIGEM_QUIZ_SOLARDOC
      : corpo.origem === ORIGEM_LP_SOLARDOC ? ORIGEM_LP_SOLARDOC : undefined;
    if (!pixAvulsoFunilAtivo() || !origem) throw new ApiError(503, 'Pagamento por Pix ainda não está disponível');
    if (!asaasHabilitado()) throw new ApiError(503, 'Pix indisponível agora');

    const mail = (textoCurto(corpo.email, 200) || '').toLowerCase();
    if (!EMAIL_RE.test(mail)) throw new ApiError(400, 'Informe um e-mail válido');
    // LP exige WhatsApp; o quiz já tem o dele e aqui ele é opcional.
    if (origem === ORIGEM_LP_SOLARDOC && !whatsappValido(corpo.whatsapp)) throw new ApiError(400, 'Informe o seu WhatsApp');

    const atribuicao = atribuicaoDoCorpo(corpo, origem);
    const criado = await criarPixAvulso({
      email: mail,
      whatsapp: soDigitos(textoCurto(corpo.whatsapp, 30) || '').slice(0, 20),
      nome: textoCurto(corpo.nome, 120) || 'Cliente',
      origem,
      atribuicao,
    });
    res.json(criado);
  } catch (err) {
    responderErro(res, err, 'criar-pix-avulso');
  }
}

// GET /payments/pix-avulso/publico/:id — a tela pergunta se já caiu. Só { status, valor }.
export async function statusPixAvulsoPublicoHandler(req: Request, res: Response): Promise<void> {
  try {
    if (!pixAvulsoFunilAtivo()) throw new ApiError(503, 'Indisponível');
    const r = await statusPixAvulso(String(req.params.id || ''));
    if (!r) throw new ApiError(404, 'Pagamento não encontrado');
    res.json(r);
  } catch (err) {
    responderErro(res, err, 'status-pix-avulso');
  }
}
