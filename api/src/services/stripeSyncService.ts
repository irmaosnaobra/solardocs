import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { sendDunningDay0 } from './dunningService';
import { FREE_LIMIT } from './planService';
import { resolverPrecoAnual, precoAnualConhecido, FERRAMENTAS_DO_ANUAL } from './precoAnual';
import { concederAcesso } from './produtos/acessos';
import { sendOpsAlert } from '../utils/mailer';
import { carregarPonteEmailConta } from './stripeContaLink';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// price_id → plano interno + limite. Sincronizado com PLAN_MAP em
// paymentsController.ts — se mudar lá, mudar aqui.
// price_1TKPoS é o PRO antigo (R$47), mantido como alias pra clientes legados.
const PRICE_TO_PLAN: Record<string, { plano: 'pro' | 'ilimitado'; limite: number }> = {
  [(process.env.STRIPE_PRICE_PRO || 'price_1TKNtbCkkgzQ4IHeCr0mYSXn').trim()]: { plano: 'pro',       limite: 90 },
  [(process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim()]: { plano: 'ilimitado', limite: 999999 },
  // VIP PROMO (downsell LP, R$49) — ilimitado. Sem isto o cron REBAIXAVA esses clientes pra free.
  [(process.env.STRIPE_PRICE_VIP_PROMO || 'price_1TpYsLCkkgzQ4IHeSt3Oupwg').trim()]: { plano: 'ilimitado', limite: 999999 },
  'price_1TKPoSCkkgzQ4IHesK6wi3Qq': { plano: 'pro', limite: 90 },  // PRO antigo (R$47)
};

// Stripe statuses que mantêm acesso ao plano. past_due fica DENTRO porque
// o dunning preserva acesso por 5 dias (ver dunningService) — só rebaixa
// pra free quando o D5 cancela a sub ou quando vier subscription.deleted via webhook.
const ACTIVE_STATUSES = new Set<string>(['active', 'trialing', 'past_due']);

type StripeTruth = {
  plano: 'pro' | 'ilimitado';
  limite: number;
  status: string;
  trial_end: Date | null;  // Date se status='trialing', null caso contrário
  priceId: string;         // pra derivar produto (PRO/VIP/VIP PROMO) no ledger
  valorReais: number;      // unit_amount real da Stripe (R$) — corrige chute do backfill
};

// Preços pra distinguir VIP (R$67) de VIP PROMO (R$49) no ledger de vendas.
const SYNC_PRICE_VIP       = (process.env.STRIPE_PRICE_VIP || 'price_1TUh2yCkkgzQ4IHeZqy52Zu2').trim();
const SYNC_PRICE_VIP_PROMO = (process.env.STRIPE_PRICE_VIP_PROMO || 'price_1TpYsLCkkgzQ4IHeSt3Oupwg').trim();
function produtoFromPrice(priceId: string): 'PRO' | 'VIP' | 'VIP PROMO' | 'VIP ANUAL' {
  // Guarda do vazio: sem ela, um price desconhecido casaria com '' e viraria
  // "VIP ANUAL" — este `if` vem antes justamente porque o default é 'PRO'.
  const anual = precoAnualConhecido();
  if (anual && priceId === anual)        return 'VIP ANUAL';
  if (priceId === SYNC_PRICE_VIP_PROMO) return 'VIP PROMO';
  if (priceId === SYNC_PRICE_VIP)       return 'VIP';
  return 'PRO';
}

// Varre TODAS as subscriptions do Stripe (sem janela de data), monta um mapa
// email → plano real. Pra cada email só guarda a sub MAIS RECENTE (created desc)
// que esteja em status ativo — evita usar sub canceled antiga sobre a vigente.
//
// O email vem de DUAS fontes (ver services/stripeContaLink.ts): o e-mail da
// CONTA, achado no ledger `sales` pelo subscription_id/customer_id, e o e-mail
// do Customer da Stripe. Os dois são indexados. Quem paga por Apple Pay /
// Google Pay / Link tem no Customer o e-mail da CARTEIRA, que não é o e-mail da
// conta — e este cron, que trata "não achei" como "não assina", rebaixava esse
// assinante pra free na primeira varredura depois da compra (caso de 18/08/26).
/**
 * Além do `truth` (quem paga o quê), devolve o que a TRAVA precisa pra separar
 * "cancelou" de "não achei":
 *
 *  - `vistos`: todo e-mail que apareceu em QUALQUER assinatura, de qualquer
 *    status. Se a conta está aqui e não está no `truth`, a assinatura dela de
 *    fato acabou — rebaixar é correto. Se não está em lugar nenhum, a Stripe
 *    não disse "cancelou": ela não disse nada.
 *  - `ativas`: as assinaturas vivas com as chaves por onde cada uma pode ser
 *    encontrada, pra detectar assinatura ATIVA que não casa com conta nenhuma.
 */
interface VarreduraStripe {
  truth: Map<string, StripeTruth>;
  vistos: Set<string>;
  ativas: { id: string; keys: string[] }[];
}

async function fetchStripeTruth(): Promise<VarreduraStripe> {
  const truth = new Map<string, StripeTruth>();
  const seenEmail = new Set<string>();
  const vistos = new Set<string>();
  const ativas: { id: string; keys: string[] }[] = [];

  // O price anual é resolvido em runtime (services/precoAnual.ts), então ele não
  // cabe no mapa estático acima. `criar: false`: o cron LÊ preço, não inventa.
  //
  // SEM .catch DE PROPÓSITO. Se a Stripe piscar e isto virasse '', toda
  // assinatura anual sairia do `truth` e o laço lá embaixo REBAIXARIA cada uma
  // pra free — o bug do VIP_PROMO, mas disparado por um segundo de rede ruim.
  // Estourando aqui, o sync inteiro aborta sem tocar em ninguém.
  const anualId = await resolverPrecoAnual(stripe, { criar: false });

  // Ponte assinatura/cliente da Stripe → e-mail da conta. Uma consulta só, e
  // best-effort por dentro: mapa vazio devolve o comportamento antigo (casar
  // apenas pelo e-mail do Customer) em vez de derrubar o sync.
  const ponte = await carregarPonteEmailConta();
  const priceToPlan: typeof PRICE_TO_PLAN = {
    ...PRICE_TO_PLAN,
    // Chave vazia nunca entra: PRICE_TO_PLAN[''] devolveria 'ilimitado' pra
    // qualquer sub sem price.
    ...(anualId ? { [anualId]: { plano: 'ilimitado' as const, limite: 999999 } } : {}),
  };

  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const subs = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      starting_after: cursor,
      expand: ['data.customer'],
    });

    for (const s of subs.data) {
      const cust = s.customer as { id?: string; email?: string | null; deleted?: boolean } | string;
      const custId = typeof cust === 'string' ? cust : (cust.id ?? null);
      const emailDoCustomer = typeof cust === 'string' ? null : (cust.email ?? null);

      // ADITIVO: indexa pelos DOIS e-mails. O da conta (ledger) entra primeiro
      // porque é o que existe em `users`; o do Customer continua entrando pra
      // que nenhuma assinatura que casava antes deixe de casar agora.
      const emailDaConta = ponte.get(s.id) ?? (custId ? ponte.get(custId) : undefined) ?? null;
      const keys = [...new Set(
        [emailDaConta, emailDoCustomer]
          .filter((e): e is string => !!e)
          .map(e => e.toLowerCase()),
      )];
      if (!keys.length) continue;

      // CONTABILIDADE INDEPENDENTE — roda antes de qualquer `continue` de
      // negócio e não encosta em `seenEmail`/`truth`. Se dependesse do
      // bookkeeping abaixo, uma sub cancelada podia tomar a chave de uma viva.
      for (const k of keys) vistos.add(k);
      if (ACTIVE_STATUSES.has(s.status)) ativas.push({ id: s.id, keys });

      // Stripe lista por created desc → primeira sub ativa que aparecer pra esse
      // email é a vigente. Subs canceladas posteriores não devem sobrescrever.
      const pendentes = keys.filter(k => !seenEmail.has(k));
      if (!pendentes.length) continue;

      if (!ACTIVE_STATUSES.has(s.status)) continue;

      const priceId = s.items.data[0]?.price?.id ?? '';
      const planInfo = priceToPlan[priceId];
      if (!planInfo) continue;

      const unitAmount = s.items.data[0]?.price?.unit_amount ?? 0;
      const trialEnd = s.status === 'trialing' && s.trial_end
        ? new Date(s.trial_end * 1000)
        : null;
      const verdade: StripeTruth = { plano: planInfo.plano, limite: planInfo.limite, status: s.status, trial_end: trialEnd, priceId, valorReais: Math.round(unitAmount) / 100 };
      for (const k of pendentes) {
        truth.set(k, verdade);
        seenEmail.add(k);
      }
    }

    if (!subs.has_more) break;
    cursor = subs.data[subs.data.length - 1]?.id;
  }

  return { truth, vistos, ativas };
}

/**
 * A TRAVA: ausência não é cancelamento.
 *
 * O estrago de 18/08/2026 não foi o e-mail errado — foi `realPlano =
 * stripeTruth?.plano ?? 'free'`, que lê "não encontrei esta conta na Stripe"
 * como "esta conta não assina". Qualquer motivo futuro de não-encontrar
 * (e-mail de carteira, Customer apagado, página que faltou, timeout) volta a
 * rebaixar assinante pagante em silêncio.
 *
 * Só rebaixa com PROVA: a conta apareceu na Stripe com assinatura fora de
 * status ativo. Sumiu inteira E tem compra confirmada no ledger? Segura o
 * plano, não carimba a venda, e avisa. Preferir "acesso a mais por um dia" a
 * "tirar acesso de quem pagou" — o primeiro custa centavos, o segundo custa
 * o cliente.
 *
 * `compraConfirmada` NÃO pode olhar `sales.status`: quem escreve esse campo é
 * este mesmo cron (`salesStatus = realStatus ?? 'canceled'`), então a primeira
 * execução ruim envenenaria a própria trava na execução seguinte.
 */
export function deveSegurarRebaixamento(opts: {
  temAssinaturaViva: boolean;
  vistoNoStripe: boolean;
  compraConfirmada: boolean;
}): boolean {
  if (opts.temAssinaturaViva) return false;   // assina: nada a rebaixar
  if (opts.vistoNoStripe)     return false;   // a Stripe DISSE que acabou
  return opts.compraConfirmada;               // sumiu, mas pagou: não confio
}

export async function syncStripePlans(): Promise<{
  scanned: number; upgraded: number; downgraded: number; unchanged: number;
  past_due_caught: number; recovered: number; trial_converted: number; errors: number;
  // Contas que a TRAVA impediu de rebaixar (sumiram da Stripe mas têm compra
  // confirmada). Em operação normal é 0 — acima disso é bug de casamento, e
  // cada linha aqui é um cliente que teria perdido acesso pago em silêncio.
  segurados: number;
  // Assinatura ATIVA na Stripe que não casa com conta nenhuma. Dinheiro
  // entrando sem ninguém do outro lado.
  orfas: number;
  // Quantas ferramentas do anual o cron teve que REPOR. Em operação normal é 0:
  // qualquer número acima disso é webhook que não gravou — e é o único jeito de
  // essa falha aparecer, já que o cliente não sente falta enquanto assina.
  anual_ferramentas: number;
}> {
  let scanned = 0, upgraded = 0, downgraded = 0, unchanged = 0;
  let past_due_caught = 0, recovered = 0, trial_converted = 0, errors = 0;
  let anual_ferramentas = 0;
  const segurados: string[] = [];
  let blindados = 0;   // pix/pack/admin — fora do funil da Stripe DE PROPÓSITO

  let varredura: VarreduraStripe;
  try {
    varredura = await fetchStripeTruth();
  } catch (err) {
    logger.error('stripe-sync', 'fetchStripeTruth falhou — abortando', err);
    throw err;
  }
  const { truth, vistos, ativas } = varredura;

  // Contas com COMPRA CONFIRMADA no ledger. Campos que este cron nunca escreve:
  // `card_passed_at` (webhook do checkout) e `subscription_id` (nasce na venda).
  // `sales.status` está fora de propósito — é escrito aqui, e usá-lo faria a
  // trava confiar no resultado da execução anterior dela mesma.
  const compraConfirmada = new Set<string>();
  try {
    const { data: pagos } = await supabase
      .from('sales')
      .select('email, card_passed_at, subscription_id');
    for (const v of pagos || []) {
      const e = (v.email || '').trim().toLowerCase();
      if (e && (v.card_passed_at || v.subscription_id)) compraConfirmada.add(e);
    }
  } catch (err) {
    // Set vazio = trava inerte (nunca segura). Falha aqui não pode abortar o
    // sync, mas registra: sem ela a rede de proteção não existe nesta execução.
    logger.error('stripe-sync', 'leitura de compras confirmadas falhou — TRAVA INERTE nesta execução', err);
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, plano, limite_documentos, billing_status, past_due_since, trial_expires_at, is_admin, pack_trial_until, plano_expira_em');

  if (error || !users) {
    logger.error('stripe-sync', 'leitura de users falhou', error);
    throw error ?? new Error('users null');
  }

  for (const u of users) {
    // Admins não passam pelo funil de Stripe — têm plano vitalício gerenciado
    // manualmente. Sem este guard, o sync ia rebaixar admin pra free toda hora
    // (porque admin não tem sub no Stripe).
    if (u.is_admin) {
      blindados++;
      unchanged++;
      continue;
    }
    scanned++;
    const stripeTruth = truth.get(u.email.toLowerCase());

    // Trial Pack→SolarDoc (sem cartão, sem sub Stripe): enquanto vigente, o user
    // tem PRO e o sync NÃO pode rebaixar. Sai do funil do Stripe igual admin.
    const packTrialActive = u.pack_trial_until
      ? new Date(u.pack_trial_until).getTime() > Date.now()
      : false;
    if (packTrialActive && !stripeTruth) {
      // Garante PRO + billing trialing enquanto o trial Pack vale. Sem sub Stripe,
      // o cron pack-trial-expiry rebaixa no vencimento.
      if (u.plano !== 'pro' || u.billing_status !== 'trialing') {
        await supabase
          .from('users')
          .update({ plano: 'pro', limite_documentos: 90, billing_status: 'trialing' })
          .eq('id', u.id);
      }
      blindados++;
      unchanged++;
      continue;
    }

    // Liberação por Pix (sem cartão, sem sub Stripe): enquanto plano_expira_em
    // estiver no futuro, o acesso foi pago manualmente e o sync NÃO pode rebaixar.
    // Sai do funil do Stripe igual admin/pack_trial. Não há cron de expiração Pix —
    // o rebaixamento no vencimento é manual (ou via /schedule).
    const pixAccessActive = u.plano_expira_em
      ? new Date(u.plano_expira_em).getTime() > Date.now()
      : false;
    if (pixAccessActive && !stripeTruth) {
      blindados++;
      unchanged++;
      continue;
    }

    // ── TRAVA: ausência não é cancelamento ───────────────────────────────────
    // Vem ANTES do patch do ledger de propósito: se só o `users` fosse
    // protegido, a venda ainda seria carimbada `canceled` — o faturamento
    // mentiria E a leitura de `compraConfirmada` da próxima execução ficaria
    // envenenada. Segurando aqui, o cron não toca em NADA desta conta.
    if (deveSegurarRebaixamento({
      temAssinaturaViva: !!stripeTruth,
      vistoNoStripe:     vistos.has(u.email.toLowerCase()),
      compraConfirmada:  compraConfirmada.has(u.email.toLowerCase()),
    })) {
      segurados.push(u.email);
      logger.error('stripe-sync', `${u.email}: SUMIU da Stripe mas tem compra confirmada — plano ${u.plano} mantido, nada carimbado`);
      unchanged++;
      continue;
    }

    const realPlano  = stripeTruth?.plano  ?? 'free';
    const realLimite = stripeTruth?.limite ?? FREE_LIMIT;
    const realStatus = stripeTruth?.status ?? null;

    // Reconcilia o LEDGER de vendas (sales) com a Stripe — status SEMPRE; e
    // produto + valor quando há sub viva (corrige o chute do backfill: ex. um
    // 'ilimitado' que na verdade é VIP R$67, não VIP PROMO R$49). Assim o ledger
    // fica 100% igual à Stripe — sem erro de registro. Best-effort.
    const salesStatus = realStatus ?? 'canceled';
    const salesPatch: Record<string, unknown> = { status: salesStatus, updated_at: new Date().toISOString() };
    if (stripeTruth?.priceId) {
      salesPatch.produto = produtoFromPrice(stripeTruth.priceId);
      if (stripeTruth.valorReais > 0) salesPatch.valor = stripeTruth.valorReais;
    }
    await supabase
      .from('sales')
      .update(salesPatch)
      .eq('email', u.email.toLowerCase())
      .then(() => {}, () => {});

    // ── FERRAMENTAS DO ANUAL (backstop pro webhook) ──────────────────────────
    // O webhook concede Precificação e Inventário na venda do anual. Se ele
    // falhar, NINGUÉM PERCEBE: a assinatura viva já libera as duas por
    // `naAssinatura`, então o cliente entra e vê tudo no lugar. O erro só
    // apareceria daqui a um ano, no cancelamento — quando ele perdesse
    // justamente o que a página vendeu como "pra sempre".
    //
    // Por isso o cron repõe. `concederAcesso` é idempotente (não duplica linha
    // nem reinicia nada), então rodar toda manhã não custa mais que 2 SELECTs
    // por assinante anual. Best-effort: falhar aqui não pode abortar o sync do
    // plano, que é o trabalho principal desta função.
    const idAnual = precoAnualConhecido();
    if (idAnual && stripeTruth?.priceId === idAnual) {
      for (const ferramenta of FERRAMENTAS_DO_ANUAL) {
        try {
          const criou = await concederAcesso({
            userId: u.id,
            produto: ferramenta,
            origem: 'compra',
            obs: 'incluso no plano anual',
          });
          if (criou) {
            anual_ferramentas++;
            logger.info('stripe-sync', `anual: ${ferramenta} reposto pra ${u.email} (webhook não gravou)`);
          }
        } catch (err) {
          logger.error('stripe-sync', `anual: falha ao repor ${ferramenta} pra ${u.email}`, err);
        }
      }
    }

    // ── Reconcilia billing_status com Stripe (backstop pro webhook) ──
    // Mapeia status real do Stripe → billing_status que queremos no Supabase.
    // active (cobrado, fora de trial) → 'active' (assinante verde)
    // trialing                        → 'trialing' (em teste, ainda não cobrado)
    // past_due                        → 'past_due' (cobrança falhou, em dunning)
    // sem sub ativa                   → 'active' (free, livre, não em dunning)
    // Acesso pago por Pix manda no status: enquanto plano_expira_em está no
    // futuro o cliente está em dia, mesmo com uma sub de cartão morrendo no
    // Stripe. Sem isto o Caso D reescrevia 'past_due' toda manhã e o cliente
    // aparecia como inadimplente no painel depois de ter pago.
    const desiredBillingStatus =
      pixAccessActive              ? 'active'   :
      realStatus === 'trialing'    ? 'trialing' :
      realStatus === 'past_due'    ? 'past_due' :
      'active';
    const desiredTrialExpiresAt = stripeTruth?.trial_end?.toISOString() ?? null;

    // Caso A: Stripe diz past_due mas Supabase diz active → webhook perdeu o
    // invoice.payment_failed. Marca past_due_since=agora e dispara D0.
    //
    // MENOS quando o acesso está pago por Pix (plano_expira_em no futuro): aí o
    // cartão falhando no Stripe é justamente o motivo de o cliente ter migrado
    // pro Pix — vários não têm limite. Sem este guard o sync desfazia a liberação
    // manual toda manhã e mandava "sua cobrança falhou" pra quem tinha acabado de
    // pagar. O guard do Pix lá em cima não pega este caso porque a sub ainda
    // existe no Stripe (stripeTruth preenchido); o certo é cancelar a sub, mas
    // enquanto ela viver o cliente não pode ser cobrado nem rebaixado.
    if (realStatus === 'past_due' && !pixAccessActive && u.billing_status !== 'past_due' && !u.past_due_since) {
      await supabase
        .from('users')
        .update({
          billing_status: 'past_due',
          past_due_since: new Date().toISOString(),
          dunning_last_day_sent: null,
        })
        .eq('id', u.id);
      sendDunningDay0(u.id).catch(err =>
        logger.error('stripe-sync', `sendDunningDay0 falhou pra ${u.email}`, err),
      );
      past_due_caught++;
      logger.info('stripe-sync', `${u.email}: ghost-pro detectado, marcado past_due`);
    }
    // Caso B: Stripe diz active/trialing mas Supabase diz past_due/suspended →
    // webhook perdeu o invoice.payment_succeeded. Limpa estado de inadimplência.
    else if ((realStatus === 'active' || realStatus === 'trialing') &&
             (u.billing_status === 'past_due' || u.billing_status === 'suspended')) {
      await supabase
        .from('users')
        .update({
          billing_status: desiredBillingStatus,
          trial_expires_at: desiredTrialExpiresAt,
          past_due_since: null,
          dunning_last_day_sent: null,
        })
        .eq('id', u.id);
      recovered++;
      logger.info('stripe-sync', `${u.email}: recuperado, billing_status → ${desiredBillingStatus}`);
    }
    // Caso C: trial convertido em pagamento (trialing → active) — vira assinante verde.
    else if (realStatus === 'active' && u.billing_status === 'trialing') {
      await supabase
        .from('users')
        .update({
          billing_status: 'active',
          trial_expires_at: null,
        })
        .eq('id', u.id);
      trial_converted++;
      logger.info('stripe-sync', `${u.email}: trial convertido em assinante (active)`);
    }
    // Caso D: ajustes finos de billing_status/trial_expires_at sem mudança de classe
    // (ex: alguém marcado 'active' no Supabase mas continua em trial no Stripe;
    // ou trial_expires_at desatualizado).
    else if (
      u.billing_status !== desiredBillingStatus ||
      (u.trial_expires_at ?? null) !== desiredTrialExpiresAt
    ) {
      await supabase
        .from('users')
        .update({
          billing_status: desiredBillingStatus,
          trial_expires_at: desiredTrialExpiresAt,
        })
        .eq('id', u.id);
      logger.info('stripe-sync', `${u.email}: billing_status ${u.billing_status} → ${desiredBillingStatus}`);
    }

    // ── Reconcilia plano + limite ──
    if (u.plano === realPlano && u.limite_documentos === realLimite) {
      unchanged++;
      continue;
    }

    // Só reseta documentos_usados quando o plano de fato muda — senão usuário
    // perderia contagem mensal a cada execução horária.
    const patch: Record<string, unknown> = { plano: realPlano, limite_documentos: realLimite };
    if (u.plano !== realPlano) patch.documentos_usados = 0;
    // Trial Pack vencido (chegou aqui = packTrialActive false): limpa o carimbo
    // pra não reprocessar e deixar claro que acabou.
    if (realPlano === 'free' && u.pack_trial_until) patch.pack_trial_until = null;

    const { error: updErr } = await supabase.from('users').update(patch).eq('id', u.id);
    if (updErr) {
      errors++;
      logger.error('stripe-sync', `update user ${u.id} falhou`, updErr);
      continue;
    }

    if (realPlano === 'free') downgraded++;
    else upgraded++;

    logger.info('stripe-sync', `${u.email}: ${u.plano} → ${realPlano}`);
  }

  // ── SENTINELA: assinatura ATIVA que não casa com conta nenhuma ────────────
  // O outro lado da mesma moeda. A trava protege quem tem conta; isto acha o
  // dinheiro que entra sem ninguém do outro lado — inclusive por motivos que
  // ainda não aconteceram. Uma assinatura só é órfã quando NENHUMA das chaves
  // por onde ela pode ser encontrada bate com um usuário.
  const emailsDeContas = new Set(users.map(u => u.email.toLowerCase()));
  const orfas = ativas.filter(a => !a.keys.some(k => emailsDeContas.has(k)));

  // UM e-mail por execução, com as duas listas — nunca um por cliente
  // (ver o padrão da fila do WhatsApp). Silêncio aqui significa "conferi e
  // está tudo casando", por isso o relatório diz quantas contas foram
  // deliberadamente puladas: blindagem não pode passar por cobertura.
  if (segurados.length || orfas.length) {
    const bloco = (titulo: string, itens: string[]) =>
      itens.length
        ? `<p style="margin:0 0 6px;"><strong>${titulo} (${itens.length})</strong></p><ul style="margin:0 0 16px;padding-left:18px;">${itens.map(i => `<li>${i}</li>`).join('')}</ul>`
        : '';
    sendOpsAlert(
      `SolarDoc: ${segurados.length} assinante(s) sem par na Stripe`,
      [
        bloco('Pagaram e sumiram da Stripe — acesso MANTIDO, confira o casamento', segurados),
        bloco('Assinatura ativa sem conta — dinheiro entrando sem acesso', orfas.map(o => `${o.id} · ${o.keys.join(' / ')}`)),
        `<p style="color:#475569;font-size:13px;margin:0;">${scanned} contas conferidas · ${blindados} puladas de propósito (admin, trial Pack ou acesso Pix vigente) · ${downgraded} rebaixadas com prova de cancelamento.</p>`,
      ].join(''),
    ).catch(err => logger.error('stripe-sync', 'sendOpsAlert falhou', err));
  }

  const summary = { scanned, upgraded, downgraded, unchanged, past_due_caught, recovered, trial_converted, errors, anual_ferramentas, segurados: segurados.length, orfas: orfas.length };
  logger.info('stripe-sync', 'concluído', summary);
  return summary;
}
