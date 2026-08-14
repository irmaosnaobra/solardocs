// ─────────────────────────────────────────────────────────────────────────────
// Webhook do Asaas — é aqui que o Pix vira acesso, sem ninguém ler comprovante.
//
// Entrega "at least once": o Asaas reenvia por até 14 dias enquanto não receber
// 2xx, e reenvia também o que já entregou. Duas travas contra creditar duas vezes:
//   1) asaas_webhook_events.event_id é PK  → reentrega do MESMO evento morre aqui;
//   2) asaas_pix_assinaturas.ultimo_pagamento_id → PAYMENT_CONFIRMED e
//      PAYMENT_RECEIVED são eventos diferentes do MESMO pagamento; só quem grava
//      o payment id primeiro credita o mês.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { PLANOS_PIX, LinhaPixRecorrente } from './pixRecorrenteService';
import { acharOfertaDoPagamento, clienteDoAsaas, logLink } from './asaasPlugcashLink';
import { processarEventoPlugcash } from '../plugcashService';

const THIAGO_PHONE = '34991360223';

// Folga em cima do mês pago. O Pix Automático debita no ciclo + 3 dias (o banco
// avisa antes) e ainda pode retentar por 3. Sem esta folga o acesso cai enquanto
// um débito legítimo está a caminho.
const GRACE_DIAS = 7;

export interface AsaasWebhookBody {
  id?: string;
  event?: string;
  dateCreated?: string;
  payment?: {
    id?: string; customer?: string; subscription?: string; value?: number;
    status?: string; billingType?: string; externalReference?: string;
    dueDate?: string; paymentDate?: string;
    /** id do link de pagamento que gerou a cobrança — é assim que a venda de
     *  produto do PlugCash se identifica (campo conferido na API em 14/08/2026). */
    paymentLink?: string | null;
  } | null;
  authorization?: { id?: string; status?: string; customerId?: string; contractId?: string } | null;
  paymentInstruction?: { id?: string; status?: string; dueDate?: string } | null;
  eligibility?: { status?: string; ineligibleReasons?: unknown } | null;
}

const COLS = 'id, user_id, email, modo, authorization_id, subscription_id, contract_id, plano, valor, primeiro_mes, cupom, status, qr_payload, ultimo_pagamento_em, proximo_vencimento';

async function avisarThiago(texto: string): Promise<void> {
  try {
    const { sendWhatsApp } = await import('../agents/zapiClient');
    await sendWhatsApp(THIAGO_PHONE, texto, 'solardoc');
  } catch (err) {
    logger.error('asaas-webhook', 'aviso ao Thiago falhou', err);
  }
}

// ── acha o contrato que o evento está falando ────────────────────────────────
// Três chaves em ordem de confiança: id da autorização/assinatura (exato) →
// externalReference (nosso contractId) → customer (última linha viva dele).
async function acharContrato(b: AsaasWebhookBody): Promise<LinhaPixRecorrente | null> {
  const p = b.payment ?? null;
  const a = b.authorization ?? null;

  if (a?.id) {
    const { data } = await supabase.from('asaas_pix_assinaturas').select(COLS).eq('authorization_id', a.id).maybeSingle();
    if (data) return data as LinhaPixRecorrente;
  }
  if (p?.subscription) {
    const { data } = await supabase.from('asaas_pix_assinaturas').select(COLS).eq('subscription_id', p.subscription).maybeSingle();
    if (data) return data as LinhaPixRecorrente;
  }
  const ref = p?.externalReference || a?.contractId;
  if (ref) {
    const { data } = await supabase.from('asaas_pix_assinaturas').select(COLS).eq('contract_id', ref).maybeSingle();
    if (data) return data as LinhaPixRecorrente;
  }
  const cliente = p?.customer || a?.customerId;
  if (cliente) {
    const { data } = await supabase
      .from('asaas_pix_assinaturas').select(COLS)
      .eq('asaas_customer_id', cliente)
      .in('status', ['pendente', 'ativo', 'inadimplente'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data as LinhaPixRecorrente;
  }
  return null;
}

// ── pagamento confirmado → mês de acesso ─────────────────────────────────────

async function creditarPagamento(b: AsaasWebhookBody, linha: LinhaPixRecorrente): Promise<void> {
  const pagamentoId = b.payment?.id;
  if (!pagamentoId) {
    logger.error('asaas-webhook', `evento de pagamento sem payment.id (${linha.contract_id})`, b);
    return;
  }

  // Reivindica o pagamento: UPDATE ... WHERE ultimo_pagamento_id <> $id. Um
  // filtro só, atômico — ler antes e escrever depois abriria janela pros dois
  // eventos do mesmo pagamento (CONFIRMED/RECEIVED) creditarem dois meses.
  // Funciona porque a coluna é NOT NULL DEFAULT '' (com NULL, o <> nunca casaria
  // na primeira cobrança e ninguém conseguiria creditar).
  const { data: claim } = await supabase
    .from('asaas_pix_assinaturas')
    .update({ ultimo_pagamento_id: pagamentoId, updated_at: new Date().toISOString() })
    .eq('id', linha.id)
    .neq('ultimo_pagamento_id', pagamentoId)
    .select('id');

  if (!claim?.length) {
    logger.info('asaas-webhook', `pagamento ${pagamentoId} já creditado antes (${linha.contract_id}) — ignorando`);
    return;
  }

  const info = PLANOS_PIX[linha.plano] ?? PLANOS_PIX.ilimitado;
  const primeiroPagamento = linha.status === 'pendente';

  // Acha o dono. user_id é o caminho normal (a tela exige login); o e-mail é a
  // rede pra contrato criado antes de a conta existir.
  let userId = linha.user_id;
  let plano_expira_em: string | null = null;
  let billing_status: string | null = null;

  const { data: u } = userId
    ? await supabase.from('users').select('id, plano_expira_em, billing_status').eq('id', userId).maybeSingle()
    : await supabase.from('users').select('id, plano_expira_em, billing_status').eq('email', linha.email).maybeSingle();

  if (u) {
    userId = (u as { id: string }).id;
    plano_expira_em = (u as { plano_expira_em: string | null }).plano_expira_em;
    billing_status = (u as { billing_status: string | null }).billing_status;
  }

  if (!userId) {
    // Dinheiro entrou e não há conta pra creditar. Não some com isso.
    logger.error('asaas-webhook', `PAGAMENTO SEM CONTA: ${linha.email} pagou ${pagamentoId} e não achei usuário`, linha);
    await avisarThiago(`🚨 *Pix recorrente pago SEM CONTA*\n${linha.email} pagou R$ ${linha.valor} (${linha.contract_id}) e não existe usuário com esse e-mail. Cria a conta e libera na mão.`);
    return;
  }

  // liberarAcessoPix empurra +1 mês e, no VIP, concede o curso (desde 30/jul o
  // plano sozinho não abre mais o Kit de Fechamento). Reaproveitado pra não ter
  // duas regras de "Pix vira acesso" no projeto.
  //
  // A base do +1 mês é a data SEM a folga: a renovação anterior já tinha somado
  // GRACE_DIAS, e empilhar de novo daria ao cliente uma semana de brinde por mês
  // (seis meses depois, mais de um mês grátis). Só desconta em renovação — na
  // adesão, a data que estiver lá veio de outro trilho (Pix manual, cartão) e
  // não tem folga nossa pra tirar.
  const baseDoMes = (!primeiroPagamento && plano_expira_em)
    ? new Date(new Date(plano_expira_em).getTime() - GRACE_DIAS * 24 * 60 * 60 * 1000).toISOString()
    : plano_expira_em;

  const { liberarAcessoPix } = await import('../agents/whatsapp/pixComprovanteService');
  const venc = await liberarAcessoPix(userId, baseDoMes, info.plano, info.limite);

  // Folga por cima do +1 mês (ver GRACE_DIAS).
  const vencComFolga = new Date(venc.getTime() + GRACE_DIAS * 24 * 60 * 60 * 1000);
  await supabase.from('users').update({ plano_expira_em: vencComFolga.toISOString() }).eq('id', userId);

  await supabase.from('asaas_pix_assinaturas').update({
    status: 'ativo',
    user_id: userId,
    ultimo_pagamento_em: new Date().toISOString(),
    proximo_vencimento: b.payment?.dueDate ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', linha.id);

  // ANTI-COBRANÇA-DUPLA — só na adesão. Todos os chargebacks do SolarDoc vieram
  // de um e-mail com várias assinaturas vivas; somar um segundo provedor sem
  // encerrar o cartão repetiria o erro de outro jeito.
  let canceladas = 0;
  if (primeiroPagamento) {
    try {
      const { cancelStripeSubsForEmail } = await import('../dunningService');
      canceladas = await cancelStripeSubsForEmail(linha.email);
      if (canceladas > 0) {
        await supabase.from('users').update({ past_due_since: null, dunning_last_day_sent: null }).eq('id', userId);
      }
    } catch (err) {
      logger.error('asaas-webhook', `cancelar sub de cartão de ${linha.email} falhou — risco de cobrança dupla`, err);
      await avisarThiago(`⚠️ *${linha.email}* assinou no Pix recorrente mas NÃO consegui cancelar o cartão na Stripe. Confere pra ele não pagar em dobro.`);
    }
    // Era assinante de cartão e nada foi cancelado → o cartão pode seguir cobrando.
    if (canceladas === 0 && (billing_status === 'active' || billing_status === 'trialing')) {
      await avisarThiago(`⚠️ *${linha.email}* estava como ${billing_status} no cartão e assinou no Pix. Não achei sub pra cancelar na Stripe — confere manualmente.`);
    }
  }

  // Cupom de adesão: conta o uso só quando o dinheiro entra, e só na adesão —
  // a referência é o contract_id, que é único, então reentrega não conta de novo
  // e as renovações do mês seguinte não somam usos novos.
  if (linha.cupom && primeiroPagamento) {
    const { registrarUsoCupom } = await import('../cuponsService');
    await registrarUsoCupom({
      codigo: linha.cupom,
      email: linha.email,
      origem: 'pix',
      referencia: linha.contract_id,
      valor: b.payment?.value ?? Number(linha.primeiro_mes ?? linha.valor),
    });
  }

  logger.info('asaas-webhook', `Pix recorrente creditado: ${linha.email} ${info.nome} até ${vencComFolga.toISOString().slice(0, 10)} (${linha.modo})`);

  await avisarThiago([
    primeiroPagamento ? '🟢 *Nova assinatura no Pix recorrente*' : '💰 *Renovação no Pix recorrente*',
    '',
    `Cliente: ${linha.email}`,
    `Plano: ${info.nome} · R$ ${linha.valor}`,
    `Trilho: ${linha.modo === 'automatico' ? 'Pix Automático (debita sozinho)' : 'assinatura Pix (QR todo mês)'}`,
    `Acesso até: ${vencComFolga.toLocaleDateString('pt-BR')}`,
    primeiroPagamento ? `Cartão na Stripe: ${canceladas} assinatura(s) cancelada(s)` : '',
  ].filter(Boolean).join('\n'));
}

// ── venda de produto do PlugCash (link de pagamento) ─────────────────────────
// O link do Asaas vende curso avulso: Pix, cartão ou boleto na página deles. Aqui
// a venda vira conta, acesso, crédito e e-mail — pelo MESMO caminho da Kiwify e do
// Stripe (`processarEventoPlugcash`), não por uma segunda liberação paralela.
//
// Idempotência: o `gateway_ref` é `asaas:<payment.id>:<slug>`, e CONFIRMED e
// RECEIVED são dois eventos do MESMO pagamento — então o segundo cai no upsert do
// primeiro em vez de liberar duas vezes.
//
// Devolve null quando o pagamento NÃO é de produto do PlugCash: aí o fluxo segue
// pro trilho de assinatura, como sempre foi.
const EVENTOS_VENDA: Record<string, string> = {
  PAYMENT_CONFIRMED: 'paid',
  PAYMENT_RECEIVED: 'paid',
  PAYMENT_REFUNDED: 'refunded',
  PAYMENT_PARTIALLY_REFUNDED: 'refunded',
  PAYMENT_CHARGEBACK_REQUESTED: 'chargeback',
  PAYMENT_CHARGEBACK_DISPUTE: 'chargeback',
};

async function tratarVendaPlugcash(
  evento: string,
  b: AsaasWebhookBody,
): Promise<{ tratado: boolean; motivo: string } | null> {
  const status = EVENTOS_VENDA[evento];
  const p = b.payment;
  if (!status || !p?.id) return null;

  const oferta = await acharOfertaDoPagamento({
    paymentLink: (p as { paymentLink?: string | null }).paymentLink ?? null,
    externalReference: p.externalReference ?? null,
  });
  if (!oferta) return null;

  // O webhook manda só o id do cliente; nome e e-mail vêm de uma segunda chamada.
  // Sem e-mail não há conta pra liberar: em vez de gravar uma venda órfã, ESTOURA
  // — o handler devolve 500 e o Asaas reentrega por até 14 dias. Errar pro lado de
  // "tenta de novo" é o certo aqui; o outro lado é cliente pagante sem acesso.
  const cliente = await clienteDoAsaas(p.customer || '');
  if (!cliente.email) {
    // O Asaas desiste depois de 14 dias. Se ninguém for avisado, isso vira um
    // cliente pagante parado, sem acesso e sem rastro fora do log.
    await avisarThiago([
      '🔴 *Venda no Asaas sem e-mail do cliente*',
      `${oferta.slug} · pagamento ${p.id} · R$ ${(p.value ?? 0).toFixed(2)}`,
      'O acesso NÃO saiu. O Asaas reenvia por 14 dias; depois disso, liberação na mão.',
    ].join('\n'));
    throw new Error(`asaas: pagamento ${p.id} sem e-mail do cliente (${p.customer}) — devolvendo erro pro Asaas reenviar`);
  }

  const r = await processarEventoPlugcash({
    orderId: p.id,
    email: cliente.email,
    nome: cliente.nome,
    telefone: cliente.telefone,
    status,
    produtoId: `asaas:${oferta.slug}`,
    produtoNome: null,
    // O valor é o que o Asaas COBROU, não o do catálogo: é o degrau da escada
    // (R$ 67, R$ 47 ou R$ 27) que define o crédito de abatimento do cliente.
    valorCentavos: Math.round((p.value ?? 0) * 100) || oferta.centavos || null,
    checkoutLink: oferta.ofertaId ? `asaas:${oferta.ofertaId}` : null,
    utm: {},
    payload: b as unknown as Record<string, unknown>,
    itemDireto: { item_tipo: 'curso', item_slug: oferta.slug, gera_credito: true },
    gateway: 'asaas',
  } as never);

  logLink(`${evento} · ${oferta.slug}/${oferta.ofertaId} · ${cliente.email} · ${r.acao}`);
  if (status === 'paid' && r.acao !== 'ignorado') {
    await avisarThiago([
      '🟢 *Venda PlugCash pelo Asaas*',
      `${oferta.slug} · degrau ${oferta.ofertaId || '—'}`,
      `${cliente.email} · R$ ${(p.value ?? 0).toFixed(2)} · ${p.billingType || '—'}`,
    ].join('\n'));
  }
  return { tratado: true, motivo: `venda plugcash ${status} (${r.acao})` };
}

// ── entrada única ────────────────────────────────────────────────────────────

export async function processarWebhookAsaas(b: AsaasWebhookBody): Promise<{ tratado: boolean; motivo: string }> {
  const evento = (b.event || '').toUpperCase();
  // Evento sem id não deveria existir; se vier, monta uma chave estável pra não
  // perder a trava de idempotência.
  const eventId = b.id || `${evento}:${b.payment?.id || b.authorization?.id || ''}:${b.dateCreated || ''}`;

  const { error: dupErr } = await supabase
    .from('asaas_webhook_events')
    .insert({ event_id: eventId, event: evento, payload: b as unknown as Record<string, unknown> });

  if (dupErr) {
    // 23505 = já processamos este evento. Qualquer outro erro segue o baile: é
    // melhor arriscar reprocessar (as travas de pagamento seguram) do que perder.
    if ((dupErr as { code?: string }).code === '23505') return { tratado: false, motivo: 'evento repetido' };
    logger.error('asaas-webhook', `não gravei o evento ${eventId} (segue o processamento)`, dupErr);
  }

  // ── PlugCash ANTES da assinatura ───────────────────────────────────────────
  // Venda de produto (curso pago por Pix/cartão no link do Asaas) não tem
  // contrato em `asaas_pix_assinaturas`: `acharContrato` devolveria null e o
  // evento morreria como "fora do trilho" — com o cliente pago e sem acesso, que
  // é o pior defeito possível aqui. Por isso este ramo vem primeiro e, quando
  // reconhece a venda, ENCERRA o processamento.
  const daVenda = await tratarVendaPlugcash(evento, b);
  if (daVenda) return daVenda;

  const linha = await acharContrato(b);

  switch (evento) {
    // PIX cai como CONFIRMED e depois RECEIVED; a trava por payment id garante
    // um mês só. Escutar os dois é de propósito: se um se perder, o outro credita.
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED': {
      if (!linha) return { tratado: false, motivo: 'pagamento fora do trilho Pix recorrente' };
      await creditarPagamento(b, linha);
      return { tratado: true, motivo: 'pagamento creditado' };
    }

    case 'PAYMENT_OVERDUE': {
      if (!linha) return { tratado: false, motivo: 'cobrança fora do trilho' };
      await supabase.from('asaas_pix_assinaturas')
        .update({ status: 'inadimplente', updated_at: new Date().toISOString() })
        .eq('id', linha.id);
      // Acesso NÃO cai aqui: plano_expira_em ainda tem a folga, e o Pix Automático
      // retenta sozinho por até 7 dias. Quem avisa o cliente é a Giovanna.
      await avisarThiago(`🔴 *Pix recorrente venceu sem pagar*\n${linha.email} · R$ ${linha.valor} · ${linha.contract_id}\nO acesso segue até ${linha.proximo_vencimento ?? 'o fim do mês pago'}.`);
      return { tratado: true, motivo: 'marcado inadimplente' };
    }

    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED': {
      if (!linha) return { tratado: false, motivo: 'autorização desconhecida' };
      await supabase.from('asaas_pix_assinaturas')
        .update({ status: 'ativo', updated_at: new Date().toISOString() })
        .eq('id', linha.id);
      logger.info('asaas-webhook', `autorização ativa: ${linha.email} (${linha.contract_id})`);
      return { tratado: true, motivo: 'autorização ativa' };
    }

    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED':
    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED':
    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED': {
      if (!linha) return { tratado: false, motivo: 'autorização desconhecida' };
      const status = evento.endsWith('CANCELLED') ? 'cancelado' : evento.endsWith('EXPIRED') ? 'expirado' : 'recusado';
      await supabase.from('asaas_pix_assinaturas')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', linha.id);
      // O cliente cancelou no app do banco (ou o banco recusou) — ninguém mais
      // vai debitar. Sem este aviso a assinatura morre em silêncio.
      await avisarThiago(`⚠️ *Pix Automático ${status}*\n${linha.email} · ${PLANOS_PIX[linha.plano]?.nome ?? linha.plano} · R$ ${linha.valor}\nNão haverá mais débito automático. Vale um toque pra reativar.`);
      return { tratado: true, motivo: `autorização ${status}` };
    }

    case 'PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED': {
      const st = (b.eligibility?.status || '').toUpperCase();
      const elegivel = st.includes('ELIGIBLE') && !st.includes('INELIGIBLE');
      await supabase.from('system_state').upsert({
        key: 'asaas_pix_automatico_elegibilidade',
        value: { status: st, motivos: b.eligibility?.ineligibleReasons ?? null, em: new Date().toISOString() },
      }, { onConflict: 'key' });
      if (!elegivel) {
        // Perder elegibilidade cancela TODAS as autorizações ativas de uma vez.
        await avisarThiago(`🚨 *A conta perdeu elegibilidade ao Pix Automático*\nStatus: ${st || '—'}\nIsso CANCELA todas as autorizações ativas. Novas adesões vão cair na assinatura Pix (QR mensal).`);
      }
      return { tratado: true, motivo: 'elegibilidade registrada' };
    }

    default:
      return { tratado: false, motivo: `evento ignorado (${evento})` };
  }
}
