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
import { asaasFetch } from './asaasClient';
import {
  chavePixAutoQr, chavePixAutoAtrib, chavePixAutoPag, chaveAdesaoAsaas, type AtribuicaoPixAuto,
} from './pixAutoChaves';

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
    status?: string; billingType?: string; externalReference?: string | null;
    dueDate?: string; paymentDate?: string;
    /** id do link de pagamento que gerou a cobrança — é assim que a venda de
     *  produto do PlugCash se identifica (campo conferido na API em 14/08/2026). */
    paymentLink?: string | null;
    /** Liga o pagamento do 1º mês do Pix Automático ao QR imediato (= authorization.immediateQrCode.conciliationIdentifier). */
    pixQrCodeId?: string | null;
    /** id da transação Pix no Asaas; é por ele que se busca o E2E (GET /pix/transactions/{id}). */
    pixTransaction?: string | null;
  } | null;
  authorization?: {
    id?: string; status?: string; customerId?: string; contractId?: string; subscriptionId?: string;
    value?: number; originType?: string; startDate?: string; endToEndIdentifier?: string;
    immediateQrCode?: { conciliationIdentifier?: string; expirationDate?: string } | null;
  } | null;
  paymentInstruction?: {
    id?: string; status?: string; dueDate?: string; paymentId?: string;
    authorization?: { id?: string } | null;
  } | null;
  eligibility?: { status?: string; ineligibleReasons?: unknown } | null;
}

const COLS = 'id, user_id, email, modo, authorization_id, subscription_id, contract_id, plano, valor, primeiro_mes, cupom, status, qr_payload, ultimo_pagamento_em, ultimo_pagamento_id, proximo_vencimento';

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

  // (Pagamento do 1º mês do Pix Automático e débito mensal com instrução NÃO passam por aqui: o case de
  // PAYMENT_* consulta pix_auto_pag e pix_auto_qr antes de chamar este resultado, para o QR vencer o
  // fallback por customer.)
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

// ── system_state: ligações que o Asaas não manda no evento (banco principal, sem migration) ──

async function lerEstado(key: string): Promise<Record<string, any> | null> {
  const { data } = await supabase.from('system_state').select('value').eq('key', key).maybeSingle();
  return (data as { value?: Record<string, any> | null } | null)?.value ?? null;
}

/** Claim só de inserção. 'existia' = 23505 (já feito); 'erro' = não gravou por outro motivo. */
async function gravarSoSeNovo(key: string, value: Record<string, unknown>): Promise<'novo' | 'existia' | 'erro'> {
  const { error } = await supabase.from('system_state').insert({ key, value });
  if (!error) return 'novo';
  if ((error as { code?: string }).code === '23505') return 'existia';
  logger.error('asaas-webhook', `system_state: não gravei ${key.split(':')[0]}`, error);
  return 'erro';
}

const soDigitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

async function contratoPor(coluna: 'contract_id' | 'authorization_id', valor: string): Promise<LinhaPixRecorrente | null> {
  const { data } = await supabase.from('asaas_pix_assinaturas').select(COLS).eq(coluna, valor).maybeSingle();
  return (data as LinhaPixRecorrente | null) ?? null;
}

/** 1º pagamento do Pix Automático: pixQrCodeId do pagamento = conciliationIdentifier do QR imediato. */
async function acharContratoPorQr(qrId: string): Promise<LinhaPixRecorrente | null> {
  const st = await lerEstado(chavePixAutoQr(qrId));
  return st?.contract_id ? contratoPor('contract_id', String(st.contract_id)) : null;
}

/** Débito mensal: a instrução (CREATED/SCHEDULED) guardou de qual autorização é o pagamento. */
async function acharContratoPorInstrucao(paymentId: string): Promise<LinhaPixRecorrente | null> {
  const st = await lerEstado(chavePixAutoPag(paymentId));
  return st?.authorization_id ? contratoPor('authorization_id', String(st.authorization_id)) : null;
}

// ── pagamento confirmado → mês de acesso ─────────────────────────────────────

/**
 * via: 'direto' = o contrato saiu de acharContrato; 'qr' = 1º mês do Pix Automático, ligado pelo
 * pixQrCodeId; 'instrucao' = débito mensal, ligado pela instrução (sempre renovação).
 */
async function creditarPagamento(
  b: AsaasWebhookBody, linha: LinhaPixRecorrente, via: 'direto' | 'qr' | 'instrucao' = 'direto',
): Promise<void> {
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

  // Só é CANDIDATO a adesão o pagamento do contrato 'pendente' ou o que chegou pelo QR imediato
  // (`pix_auto_qr`, inclusive a busca retroativa do ACTIVATED). Qualquer outro caminho é renovação: o
  // contrato real de 25/10 ficou 'ativo' com ultimo_pagamento_id vazio (quem creditou foi o comprovante), e
  // olhar "nunca pagou" faria o débito do mês 2 virar adesão (venda, Purchase e aviso em dobro, cartão
  // cancelado, 7 dias de folga). Entre os candidatos, quem decide é um claim só de inserção
  // (`asaas_adesao:<contrato>`; 23505 = já feita), que também segura a corrida entre dois eventos.
  // Claim que dá erro NÃO vira adesão: credita como renovação e grita no log.
  let primeiroPagamento = false;
  const candidataAAdesao = via === 'qr' || (via === 'direto' && linha.status === 'pendente');
  if (candidataAAdesao) {
    const r = await gravarSoSeNovo(chaveAdesaoAsaas(linha.contract_id), { payment_id: pagamentoId, em: new Date().toISOString() });
    primeiroPagamento = r === 'novo';
    if (r === 'erro') {
      logger.error('asaas-webhook', `claim de adesão falhou (${linha.contract_id}, pagamento ${pagamentoId}): credita como renovação, sem efeitos de adesão`);
    }
  }
  const atrib: AtribuicaoPixAuto | null = primeiroPagamento
    ? ((await lerEstado(chavePixAutoAtrib(linha.contract_id))) as AtribuicaoPixAuto | null)
    : null;
  const valorPago = Number(b.payment?.value ?? linha.primeiro_mes ?? linha.valor);

  // MESMO DINHEIRO PELO WHATSAPP: quem paga o QR também costuma mandar o comprovante, e o robô do
  // comprovante creditaria de novo. O E2E (`pix_e2e:`) é a trava que os dois dividem. Falhou a busca:
  // credita assim mesmo (melhor um mês em dobro, que o Thiago vê, do que cliente pago sem acesso).
  let e2eKey: string | null = null;
  if (primeiroPagamento && b.payment?.pixTransaction) {
    try {
      const t = await asaasFetch<{ endToEndIdentifier?: string }>(`/pix/transactions/${encodeURIComponent(b.payment.pixTransaction)}`);
      const { chaveE2e } = await import('../agents/whatsapp/pixComprovanteService');
      e2eKey = chaveE2e(t?.endToEndIdentifier, valorPago);
      if (!e2eKey) logger.warn('asaas-webhook', `sem E2E legível para o pagamento ${pagamentoId} (${linha.contract_id}): credita sem a trava do comprovante`);
    } catch (err) {
      logger.error('asaas-webhook', `busca do E2E falhou (${pagamentoId}, ${linha.contract_id}): credita assim mesmo`, err);
    }
  }
  if (e2eKey) {
    const reservada = await lerEstado(e2eKey);
    if (reservada) { await ligarSemCreditar(linha, b, reservada.user_id, e2eKey); return; }
  }

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

  // Conta nova (quiz): a pessoa pagou o QR antes de ter conta. Cria PENDENTE (sem senha) e o link de definir
  // senha segue por E-MAIL depois do crédito: nunca por WhatsApp e nunca pela rota pública de status.
  let tokenContaNova: string | null = null;
  let emailDeAcessoFalhou = false;
  if (!userId && primeiroPagamento) {
    try {
      const { getOrCreatePixUser } = await import('../agents/whatsapp/pixComprovanteService');
      // whatsappSoSeLivre: nunca sobrescreve o WhatsApp de uma conta que já existe (corrida com outra criação).
      const nova = await getOrCreatePixUser(linha.email, atrib?.nome ?? null, soDigitos(atrib?.whatsapp), { whatsappSoSeLivre: true });
      if (nova) {
        userId = nova.id;
        if (nova.criadaAgora && nova.reset_token) tokenContaNova = nova.reset_token;
      }
    } catch (err) {
      logger.error('asaas-webhook', `criar a conta pendente de ${linha.email} falhou`, err);
    }
  }

  if (!userId) {
    // Dinheiro entrou e não há conta pra creditar. Não some com isso.
    logger.error('asaas-webhook', `PAGAMENTO SEM CONTA: ${linha.email} pagou ${pagamentoId} e não achei usuário`, linha);
    await avisarThiago(`🚨 *Pix recorrente pago SEM CONTA*\n${linha.email} pagou R$ ${linha.valor} (${linha.contract_id}) e não existe usuário com esse e-mail. Cria a conta e libera na mão.`);
    return;
  }

  if (e2eKey) {
    const { e2eJaUsado } = await import('../agents/whatsapp/pixComprovanteService');
    if (await e2eJaUsado(e2eKey, valorPago, userId)) {
      // Perdeu a corrida para o robô do comprovante: ele já creditou este Pix.
      await ligarSemCreditar(linha, b, userId, e2eKey);
      return;
    }
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

  if (tokenContaNova) {
    emailDeAcessoFalhou = true;
    try {
      const { sendPixAutomaticoAcessoEmail } = await import('../../utils/mailer');
      const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
      await sendPixAutomaticoAcessoEmail({
        to: linha.email, nome: atrib?.nome ?? null,
        acessoUrl: `${dashboardUrl}/auth?mode=redefinir&token=${tokenContaNova}`,
      });
      emailDeAcessoFalhou = false;
    } catch (err) {
      // Sem WhatsApp extra: a falha vai como linha do aviso único ao Thiago (o da adesão, logo abaixo).
      logger.error('asaas-webhook', `e-mail de acesso não saiu para ${linha.email} (conta criada e mês creditado)`, err);
    }
  }

  // ANTI-COBRANÇA-DUPLA — só na adesão. Todos os chargebacks do SolarDoc vieram
  // de um e-mail com várias assinaturas vivas; somar um segundo provedor sem
  // encerrar o cartão repetiria o erro de outro jeito.
  //
  // EXCEÇÃO: contrato SEM user_id, ou criado pela rota PÚBLICA (pix_auto_atrib.rota = 'publica', que grava o
  // user_id quando o e-mail digitado já tem conta). Nos dois, quem paga pode ter digitado o e-mail de outra
  // pessoa e cancelaria o cartão dela: aqui não se cancela nada, e o cartão ativo vira linha do aviso único.
  let canceladas = 0;
  let cartaoAtivoSemDono = false;
  const viaRotaPublica = atrib?.rota === 'publica';
  const semDonoNoContrato = !linha.user_id;
  const naoCancelar = semDonoNoContrato || viaRotaPublica;
  if (primeiroPagamento && naoCancelar) {
    cartaoAtivoSemDono = billing_status === 'active' || billing_status === 'trialing';
  } else if (primeiroPagamento) {
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

  // ── A VENDA PRECISA EXISTIR FORA DAQUI (14/08/2026) ────────────────────────
  // Até aqui o Pix recorrente liberava acesso e avisava o dono, e parava nisso:
  // não entrava no ledger `sales`, não chegava no Meta e não aparecia na UTMify.
  // O efeito é o pior possível pra quem paga tráfego: a venda que o anúncio
  // gerou existe no extrato e NÃO existe no lugar onde se decide quanto investir.
  // O trilho do cartão faz as três coisas no checkout.session.completed; aqui
  // ficou de fora porque este webhook nasceu focado em "Pix vira acesso".
  //
  // Só na ADESÃO. Renovação não vira linha nova — é a mesma regra do cartão
  // (uma venda, uma linha; a renovação é aviso, não venda nova).
  // Nome e WhatsApp do cliente para o aviso do grupo de vendas (preenchidos abaixo, na adesão).
  let nomeDoCliente: string | null = null;
  let whatsDoCliente: string | null = null;
  if (primeiroPagamento) {
    try {
      const { upsertSale, sendPurchaseForSale } = await import('../salesLedger');
      const ehQuiz = atrib?.origem === 'quiz_solardoc';
      const { sendUtmifyOrder } = await import('../utmifyOrders');

      // Atribuição: quem assina no Pix já tem conta, então os UTMs da aquisição
      // estão no cadastro dele — é o rastro que casa a venda com o anúncio.
      const { data: attr } = await supabase
        .from('users')
        .select('nome, whatsapp, utm_source, utm_medium, utm_campaign, utm_content, utm_term')
        .eq('id', userId)
        .maybeSingle();
      const a = (attr ?? {}) as Record<string, string | null>;
      // A atribuição guardada na criação (quiz/anúncio) vale mais que o cadastro: a conta pode ter nascido agora.
      nomeDoCliente = atrib?.nome ?? a.nome ?? null;
      whatsDoCliente = atrib?.whatsapp ?? a.whatsapp ?? null;
      const pago = valorPago;

      const saleId = await upsertSale({
        // Chave estável e única por contrato: reentrega do webhook cai no mesmo
        // upsert em vez de criar uma segunda venda.
        checkout_session_id: `asaas:${linha.contract_id}`,
        subscription_id: linha.authorization_id || linha.subscription_id || null,
        email: linha.email,
        nome: nomeDoCliente,
        phone: whatsDoCliente,
        plano: info.plano,
        produto: info.nome,
        valor: pago,
        status: 'paid',
        cupom: linha.cupom ?? null,
        comDesconto: !!linha.cupom,
        utm_source: atrib?.utm_source ?? a.utm_source ?? null,
        utm_medium: atrib?.utm_medium ?? a.utm_medium ?? null,
        utm_campaign: atrib?.utm_campaign ?? a.utm_campaign ?? null,
        utm_content: atrib?.utm_content ?? a.utm_content ?? null,
        utm_term: atrib?.utm_term ?? a.utm_term ?? null,
        attribution_session_id: atrib?.lp_session ?? null,
        fbc: atrib?.fbc ?? null,
        fbp: atrib?.fbp ?? null,
        card_passed_at: new Date().toISOString(),
      });

      // Meta (CAPI). A própria função recusa recompra e venda de follow-up —
      // o pixel só conta venda nova, e essa regra vale igual pro Pix.
      // Venda do quiz: o Purchase sai pelo pixel do quiz (mesmo caminho e mesma chave do comprovante, então o
      // mesmo Pix pago pelos dois lados manda UM evento). Sem E2E, a chave é o contrato.
      if (ehQuiz) {
        const { dispararPurchasePixQuiz } = await import('../solardoc/purchasePixQuiz');
        const motivo = await dispararPurchasePixQuiz({
          telefone: whatsDoCliente ?? '', email: linha.email, nome: nomeDoCliente, valor: pago,
          chaveE2e: e2eKey, dedupKey: `asaas:${linha.contract_id}`, quando: new Date(),
        });
        logger.info('asaas-webhook', `Purchase do Pix automático no pixel do quiz: ${motivo}`);
      } else if (saleId) {
        await sendPurchaseForSale(saleId).catch((e) =>
          logger.error('asaas-webhook', `Purchase pro Meta falhou (acesso já liberado): ${linha.email}`, e));
      }

      await sendUtmifyOrder({
        orderId: `asaas:${linha.contract_id}`,
        status: 'paid',
        createdAt: new Date(),
        approvedDate: new Date(),
        email: linha.email,
        name: nomeDoCliente,
        phone: whatsDoCliente,
        productId: info.plano,
        productName: info.nome,
        priceInReais: pago,
        paymentMethod: 'pix',
        utm_source: atrib?.utm_source ?? a.utm_source ?? null,
        utm_medium: atrib?.utm_medium ?? a.utm_medium ?? null,
        utm_campaign: atrib?.utm_campaign ?? a.utm_campaign ?? null,
        utm_content: atrib?.utm_content ?? a.utm_content ?? null,
        utm_term: atrib?.utm_term ?? a.utm_term ?? null,
      });
    } catch (err) {
      // Nada aqui pode derrubar a liberação: o cliente já pagou e já tem acesso.
      // Mas também não pode sumir — venda fora do ledger é receita invisível.
      logger.error('asaas-webhook', `venda do Pix recorrente não foi registrada (acesso OK): ${linha.email}`, err);
      await avisarThiago(`⚠️ *Venda no Pix não entrou no ledger*\n${linha.email} · R$ ${linha.valor}\nO acesso foi liberado normalmente, mas a venda pode não aparecer no Meta nem na UTMify.`);
    }
  }

  await avisarThiago([
    primeiroPagamento ? '🟢 *Nova assinatura no Pix recorrente*' : '💰 *Renovação no Pix recorrente*',
    '',
    `Cliente: ${linha.email}`,
    `Plano: ${info.nome} · R$ ${linha.valor}`,
    `Trilho: ${linha.modo === 'automatico' ? 'Pix Automático (debita sozinho)' : 'assinatura Pix (QR todo mês)'}`,
    `Acesso até: ${vencComFolga.toLocaleDateString('pt-BR')}`,
    primeiroPagamento && !naoCancelar ? `Cartão na Stripe: ${canceladas} assinatura(s) cancelada(s)` : '',
    cartaoAtivoSemDono
      ? (viaRotaPublica
        ? '⚠️ Pix pela página pública com e-mail que tem cartão ativo na Stripe; conferir à mão (não cancelei).'
        : '⚠️ E-mail já tinha cartão ativo na Stripe; conferir à mão (não cancelei: o contrato não tinha conta).')
      : '',
    tokenContaNova ? 'Conta criada agora pelo pagamento (sem senha).' : '',
    emailDeAcessoFalhou ? '⚠️ O e-mail com o link de senha NÃO saiu. Reenvia o acesso na mão.' : '',
  ].filter(Boolean).join('\n'));

  // Grupo de vendas do SolarDoc (plano B1): UM A MAIS que o aviso acima (que nunca é dispensado), só na ADESÃO.
  // Renovação segue só com o Thiago. Isolado: nunca derruba nem atrasa o aviso ao Thiago.
  if (primeiroPagamento) {
    try {
      const { avisarCompra, idDeVenda } = await import('../solardoc/avisoGrupoSolardoc');
      const id = idDeVenda('asaas:', linha.contract_id, linha.authorization_id, linha.subscription_id, b.payment?.id);
      if (!id) {
        logger.error('asaas-webhook', 'venda do Pix sem id único (contrato, autorização, assinatura e pagamento vazios): aviso ao grupo de vendas pulado');
      } else {
        await avisarCompra({
          id, canal: 'asaas', planoAtivo: true,
          valor: valorPago,
          nome: nomeDoCliente, telefone: whatsDoCliente,
          lpSession: atrib?.lp_session ?? null, origemQuiz: atrib?.origem === 'quiz_solardoc',
        });
      }
    } catch (err) {
      logger.error('asaas-webhook', 'aviso ao grupo de vendas falhou (o do Thiago já saiu)', err);
    }
  }
}

/** O mesmo Pix já foi creditado pelo robô do comprovante: só liga o contrato (status, último pagamento, user_id). */
async function ligarSemCreditar(
  linha: LinhaPixRecorrente, b: AsaasWebhookBody, userIdDaReserva: unknown, e2eKey: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'ativo',
    ultimo_pagamento_em: new Date().toISOString(),
    proximo_vencimento: b.payment?.dueDate ?? null,
    updated_at: new Date().toISOString(),
  };
  const uid = (typeof userIdDaReserva === 'string' && userIdDaReserva) || linha.user_id;
  if (uid) patch.user_id = uid;
  await supabase.from('asaas_pix_assinaturas').update(patch).eq('id', linha.id);
  logger.info('asaas-webhook', `Pix ${b.payment?.id} de ${linha.email} já creditado pelo comprovante (${e2eKey.split(':')[0]}): contrato ligado, sem novo crédito`);
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

/**
 * ACTIVATED com cobrança imediata: grava a ligação QR -> contrato (se a criação não gravou) e procura, nos
 * eventos já recebidos, o pagamento do 1º mês que chegou sem ligação. Achando, credita agora.
 * Idempotente: o claim do pagamento e o da adesão seguram reentrega e corrida com o PAYMENT_RECEIVED.
 */
async function conciliarPrimeiroPagamento(b: AsaasWebhookBody, linha: LinhaPixRecorrente): Promise<void> {
  const qrId = b.authorization?.immediateQrCode?.conciliationIdentifier?.trim();
  if (!qrId) return;
  await gravarSoSeNovo(chavePixAutoQr(qrId), { contract_id: linha.contract_id, em: new Date().toISOString() });
  if (await lerEstado(chaveAdesaoAsaas(linha.contract_id))) return; // adesão já feita

  const { data } = await supabase
    .from('asaas_webhook_events')
    .select('event_id, event, recebido_em, payload')
    .in('event', ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'])
    .eq('payload->payment->>pixQrCodeId', qrId)
    .order('recebido_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  const pagamento = (data as { payload?: AsaasWebhookBody } | null)?.payload;
  if (!pagamento?.payment?.id) return;
  logger.info('asaas-webhook', `ACTIVATED achou o pagamento ${pagamento.payment.id} que chegou antes (${linha.contract_id})`);
  await creditarPagamento(pagamento, linha, 'qr');
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
      // Ordem das chaves do pagamento: (1) instrução do débito mensal, que SEMPRE é renovação; (2) QR do
      // 1º mês do Pix Automático, que chega com OUTRO customer e vence o fallback por customer;
      // (3) as chaves de sempre (acharContrato).
      let alvo: LinhaPixRecorrente | null = null;
      let via: 'direto' | 'qr' | 'instrucao' = 'direto';
      if (b.payment?.id) { alvo = await acharContratoPorInstrucao(b.payment.id); if (alvo) via = 'instrucao'; }
      if (!alvo && b.payment?.pixQrCodeId) { alvo = await acharContratoPorQr(b.payment.pixQrCodeId); if (alvo) via = 'qr'; }
      if (!alvo) alvo = linha;
      if (!alvo) return { tratado: false, motivo: 'pagamento fora do trilho Pix recorrente' };
      await creditarPagamento(b, alvo, via);
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
      // 1ª cobrança imediata: o PAYMENT_RECEIVED costuma chegar ANTES deste evento e sem ligação nenhuma.
      if (b.authorization?.originType === 'IMMEDIATE_PAYMENT_AND_RECURRING_QR_CODE') {
        await conciliarPrimeiroPagamento(b, linha);
      }
      return { tratado: true, motivo: 'autorização ativa' };
    }

    // Débito mensal: o pagamento chega depois só com o id dele. Guarda de qual autorização é.
    case 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED':
    case 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED': {
      const pagId = b.paymentInstruction?.paymentId;
      const autId = b.paymentInstruction?.authorization?.id;
      if (!pagId || !autId) return { tratado: false, motivo: 'instrução sem paymentId ou autorização' };
      await supabase.from('system_state').upsert(
        { key: chavePixAutoPag(pagId), value: { authorization_id: autId, em: new Date().toISOString() } },
        { onConflict: 'key' });
      return { tratado: true, motivo: 'instrução de débito registrada' };
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
