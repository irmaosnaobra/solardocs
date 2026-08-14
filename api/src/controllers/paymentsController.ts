import { Request, Response } from 'express';
import Stripe from 'stripe';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { processarEventoPlugcash } from '../services/plugcashService';
import { sendDunningDay0, sendDunningRecovered } from '../services/dunningService';
import { sendCheckoutCompletionEmail } from '../utils/mailer';
import { sendActivationWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';
import { upsertSale, sendPurchaseForSale, classificarOrigem } from '../services/salesLedger';
import { avisarVendaAoDono, avisarRenovacaoAoDono, historicoDoCliente } from '../services/vendaAviso';
import { sendUtmifyOrder } from '../services/utmifyOrders';
import { concederCursoPorAssinatura } from '../services/kitIntegradorService';
import { pixCheckoutUrl, PIX_MES_VALOR } from '../utils/pixInfo';
import { asaasHabilitado } from '../services/asaas/asaasClient';
import { resolverPrecoAnual, precoAnualConhecido, ANUAL_VALOR, ANUAL_EQUIV_MES } from '../services/precoAnual';
import { concederAcesso } from '../services/produtos/acessos';
import {
  buscarCupomValido, aplicarCupom, garantirCupomStripe, garantirPromotionCode, cupomAtivoParaPlano,
  registrarUsoCupom, resumoPublicoCupom, normalizarCodigo, CupomAplicado,
} from '../services/cuponsService';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

// Trim defensivo + fallback hardcoded — env vars no Vercel às vezes
// vêm com \n no fim (paste com quebra de linha) e quebram o checkout.
function envPrice(key: string, fallback: string): string {
  const v = (process.env[key] || '').trim();
  return v || fallback;
}

// trialDias ausente = 7 (o padrão que sempre valeu). Uma oferta pode zerar com
// trialDias: 0 quando a contrapartida for cobrança imediata — hoje nenhuma usa.
const TRIAL_PADRAO_DIAS = 7;

const PLAN_MAP: Record<string, { priceId: string; plano: string; limite: number; valor: number; descricao: string; trialDias?: number }> = {
  pro: {
    priceId: envPrice('STRIPE_PRICE_PRO', 'price_1TKNtbCkkgzQ4IHeCr0mYSXn'),
    plano: 'pro',
    limite: 90,
    valor: 27, // preço mensal real (R$). Usado no value do Purchase (Meta CAPI).
    // Saiu da vitrine em 06/08/2026 (a LP vende só o plano único). Ainda é
    // comprável pelo UpgradeModal de quem está no free — e por isso também
    // cobra na hora: com o trial aqui, a tela de cadastro ("Plano Pro · acesso
    // imediato") e o roteiro das agentes estariam mentindo pra esse comprador.
    // Assinatura já criada não é afetada: trial só vale na criação do checkout.
    trialDias: 0,
    descricao: '📄 90 documentos por mês  •  Indicado para até 20 vendas mensais  •  Tudo do Iniciante  •  Histórico completo de documentos  •  Suporte prioritário',
  },
  ilimitado: {
    priceId: envPrice('STRIPE_PRICE_VIP', 'price_1TUh2yCkkgzQ4IHeZqy52Zu2'),
    plano: 'ilimitado',
    limite: 999999,
    valor: 67, // preço mensal real (R$) — espelha PRICE da Landing. Usado no value do Purchase (Meta CAPI).
    // PLANO ÚNICO (06/08/2026): a LP virou uma oferta só, R$ 67 com PAGAMENTO
    // IMEDIATO — o trial de 7 dias saiu. É este 0 que faz o Stripe cobrar no
    // ato (o checkout volta payment_status='paid', a sub nasce 'active' e o
    // webhook já grava a venda como paga em vez de 'trialing').
    trialDias: 0,
    descricao: '📄 Documentos ilimitados  •  Todos os 8 documentos com a sua marca  •  Histórico permanente  •  Calculadora e inventário  •  Garantia de 7 dias',
  },
  // Removido em 30/07/2026: 'vip_curso' era o VIP da campanha "o curso entra
  // junto", com cobrança imediata como contrapartida. Assinatura não libera mais
  // o curso, então a oferta deixou de existir. Assinaturas já criadas por ali
  // continuam válidas: o price era o MESMO do VIP, e planByPrice resolve pela
  // entrada 'ilimitado' acima.
  //
  // Downsell da LP: MESMO acesso ilimitado (VIP), preço promocional R$ 49/mês.
  // Oferecido no popup ao clicar no Pro. planByPrice() resolve isto pra plano
  // 'ilimitado' (libera VIP na plataforma) e valor 49 entra no Purchase da Meta
  // (CAPI) — NÃO 67. Trial de 7 dias é herdado do createPublicCheckout.
  // Preço R$ 49/mês LIVE criado no produto SolarDoc VIP (prod_UIzsfi8HDwqOvu) em
  // 04/jul/2026. Fallback já é o price_id real; STRIPE_PRICE_VIP_PROMO no Vercel
  // é opcional (sobrescreve o fallback, boa prática).
  vip_promo: {
    priceId: envPrice('STRIPE_PRICE_VIP_PROMO', 'price_1TpYsLCkkgzQ4IHeSt3Oupwg'),
    plano: 'ilimitado',
    limite: 999999,
    valor: 49,
    descricao: '📄 Documentos ilimitados  •  Dashboard completo  •  Acesso a toda expansão da plataforma  •  Suporte prioritário',
  },
  // ANUAL — a âncora. MESMO acesso do VIP, cobrado 12 meses de uma vez: R$ 564,
  // que dá R$ 47/mês contra os R$ 67 do mensal. Serve pra dois públicos ao mesmo
  // tempo: quem compra (caixa de um ano na hora) e quem NÃO compra (sai achando
  // o mensal barato, que é o trabalho da âncora).
  //
  // priceId vazio de propósito: o price é criado/resolvido em runtime pelo
  // lookup_key (ver services/precoAnual.ts) porque não dá pra mexer no painel da
  // Stripe daqui. STRIPE_PRICE_VIP_ANUAL na Vercel sobrescreve, se um dia existir.
  //
  // `valor` é 564 e NÃO 47: este campo alimenta o ledger `sales`, o value do
  // Purchase (Meta CAPI) e a UTMify. Botar 47 aqui sub-reportaria a receita em
  // 12× e envenenaria toda a conta de CAC. O 47 é número de vitrine, só.
  vip_anual: {
    priceId: envPrice('STRIPE_PRICE_VIP_ANUAL', ''),
    plano: 'ilimitado',
    limite: 999999,
    valor: ANUAL_VALOR,
    // Explícito, não herdado: `vip_promo` acima OMITE trialDias e por isso pega
    // os 7 dias padrão. Herdar aqui daria uma semana grátis numa cobrança de
    // R$ 564 — e o cliente entraria, baixaria tudo e cancelaria no 6º dia.
    trialDias: 0,
    descricao: `📄 Documentos ilimitados por 12 meses  •  Precificação Profissional e Inventário da Empresa liberados pra sempre  •  R$ ${ANUAL_EQUIV_MES}/mês em vez de R$ 67  •  Suporte prioritário`,
  },
};

// O texto do botão do checkout anual. Diz o preço CHEIO e o ciclo, porque é
// aqui que a pessoa confere antes de autorizar R$ 564 — o "R$ 47/mês" sozinho
// nessa tela é a receita pronta pra um chargeback de "achei que era mensal".
const TEXTO_SUBMIT_ANUAL =
  `R$ ${ANUAL_VALOR} agora, 12 meses de acesso — sai R$ ${ANUAL_EQUIV_MES}/mês em vez de R$ 67. ` +
  'Precificação Profissional e Inventário da Empresa ficam liberados pra sempre. Renova só daqui a um ano.';

// As duas ferramentas que o anual leva PRA SEMPRE (não expiram junto com a
// assinatura). É o que faz o anual valer mais do que "12 mensais com desconto":
// R$ 134 de ferramenta comprada, dentro de uma compra de R$ 564.
// O mensal continua com elas enquanto assina (`naAssinatura` no catálogo) —
// o anual é quem passa a ser DONO.
const FERRAMENTAS_DO_ANUAL = ['precificacao', 'inventario'];

// mapa invertido price_id → plano (para o webhook).
//
// ASSÍNCRONO por causa do anual: o price dele é resolvido em runtime, e uma
// instância FRIA do webhook ainda não o conhece. Devolver undefined aqui não
// "erra um rótulo" — pula o bloco INTEIRO da venda (criação de conta, ledger,
// aviso do dono, concessão das ferramentas). Num produto de baixo volume, a
// instância fria é o caso NORMAL, não a exceção.
async function planByPrice(priceId: string) {
  if (!priceId) return undefined;
  const estatico = Object.values(PLAN_MAP).find(p => p.priceId && p.priceId === priceId);
  if (estatico) return estatico;
  try {
    const anual = await resolverPrecoAnual(stripe, { criar: false });
    if (anual && anual === priceId) return PLAN_MAP.vip_anual;
  } catch (err) {
    console.error('[anual] não consegui resolver o price pra classificar a venda:', err);
  }
  return undefined;
}

/** O price que este plano vai cobrar. Só o anual precisa de ida à Stripe. */
async function priceDoPlano(planKey: string, planInfo: { priceId: string }): Promise<string> {
  if (planInfo.priceId) return planInfo.priceId;
  if (planKey === 'vip_anual') return resolverPrecoAnual(stripe);
  return '';
}

// ── CUPOM DIGITADO NO CHECKOUT ───────────────────────────────────────────────
// A Giovanna manda o cliente pra solardoc.app e pede pra ele DIGITAR o código.
// Pra esse caminho existir, o cupom e o promotion_code precisam já estar criados
// na Stripe QUANDO ele chega na tela — por isso a garantia acontece aqui, na
// criação do checkout, e não na primeira venda. Sem isto, o primeiro cliente
// digita o código e ouve "cupom inválido".
// Devolve true se o campo de digitar deve aparecer.
async function prepararCodigoDigitado(plano: string, precoCheio: number): Promise<boolean> {
  const vivo = aplicarCupom(await cupomAtivoParaPlano(plano), precoCheio);
  if (!vivo) return false;
  const couponId = await garantirCupomStripe(stripe, vivo, plano);
  return !!(await garantirPromotionCode(stripe, vivo, couponId));
}

// Descobre QUAL cupom foi usado quando ele foi digitado no checkout (aí não
// passa pelo nosso metadata). Só é chamado quando a sessão teve desconto.
// Ordem: o código do promotion_code (o texto que ele digitou) → o id do cupom,
// que é determinístico (`SD-<CODIGO>-<PLANO>-<CENTAVOS>`).
async function codigoDoDescontoDigitado(sessionId: string): Promise<string> {
  try {
    const full = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['total_details.breakdown.discounts'],
    });
    const d = (full.total_details as any)?.breakdown?.discounts?.[0]?.discount;
    if (!d) return '';

    const promoId = typeof d.promotion_code === 'string' ? d.promotion_code : d.promotion_code?.id;
    if (promoId) {
      const promo = await stripe.promotionCodes.retrieve(promoId);
      if (promo?.code) return normalizarCodigo(promo.code);
    }
    const couponId: string | undefined = typeof d.coupon === 'string' ? d.coupon : d.coupon?.id;
    const m = couponId ? /^SD-(.+)-(?:PRO|ILIMITADO)-\d+$/i.exec(couponId) : null;
    return m ? normalizarCodigo(m[1]) : '';
  } catch (err) {
    // Desconto existiu, mas não descobrimos o código. O valor cobrado (que é o
    // que importa pro caixa) continua certo; só a contagem de uso fica sem dono.
    console.error('[cupons] não consegui identificar o cupom digitado:', err);
    return '';
  }
}

// ── Vitrine do checkout (imagem + descrição do produto na Stripe) ────────────
// A imagem do produto é o card grande que o cliente vê no checkout hosted. A
// antiga trazia o selo "7 DIAS GRÁTIS" — que deixou de existir em 06/08/2026 e
// virava promessa quebrada na hora de pagar. A arte nova mora em /public do
// dashboard, então a URL só existe depois do deploy.
//
// Por que carimbar daqui e não pelo painel: não há acesso à conta da Stripe por
// script (a chave é só do ambiente da Vercel). Este sync roda UMA vez por
// instância fria da função — o primeiro checkout depois do deploy conserta o
// produto e os seguintes nem tocam na Stripe. Se falhar, o checkout continua
// normal (só a vitrine fica velha).
// v2 (06/08/2026): a arte v1 tinha marca + selo + headline + parágrafo +
// mockup + 2 chips. No desktop lia; no CELULAR a Stripe reduz isso a uma
// miniatura de ~110px e virou borrão. A v2 tem só o que sobrevive a 110px:
// ícone do app, nome e uma linha. Trocar o NOME do arquivo é de propósito —
// é o que faz o sync abaixo detectar diferença e recarimbar o produto.
const CHECKOUT_IMG = `${(process.env.DASHBOARD_URL || 'https://solardoc.app').trim()}/checkout-solardoc-2.jpg`;
// O nome do produto é o título do checkout ("Assinar ___"). Era "SolarDoc VIP",
// nome da época dos dois planos — hoje a página vende plano único. Decisão do
// Thiago (06/08/2026). Vale também na fatura de quem já assina, na próxima
// cobrança.
const CHECKOUT_NOME = 'SolarDoc.APP';
const vitrineFeita = new Set<string>();

async function garantirVitrineStripe(priceId: string, descricao: string): Promise<void> {
  if (vitrineFeita.has(priceId)) return;
  vitrineFeita.add(priceId); // marca antes: uma tentativa por price/instância, sem repique
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    const product = price.product as { id?: string; images?: string[]; name?: string } | null;
    if (!product?.id) return;
    // Sai fora só quando TUDO já está no lugar. Checar apenas a imagem deixaria
    // o nome velho pra sempre — a imagem já tinha sido carimbada antes dele.
    const jaOk = product.images?.[0] === CHECKOUT_IMG && product.name === CHECKOUT_NOME;
    if (jaOk) return;
    await stripe.products.update(product.id, {
      name: CHECKOUT_NOME,
      description: descricao,
      images: [CHECKOUT_IMG],
    });
    console.log('[stripe] vitrine do produto atualizada:', product.id);
  } catch (err) {
    console.error('[stripe] sync da vitrine falhou (checkout intacto):', err);
  }
}

// ── Assinatura dos eventos no endpoint da Stripe (auto-conserto) ────────────
// Bloco de webhook só roda se a Stripe ASSINAR aquele evento no endpoint — e
// isso é um checkbox no painel, não código. Foi assim que a recuperação de
// checkout abandonado nasceu morta: `checkout.session.expired` não estava na
// lista, `abandoned_checkouts` ficou 29 dias (08/07→06/08) com ZERO linhas e a
// cadência de 6 toques da Giovanna nunca teve semente. Um evento que falta não
// dá erro em lugar nenhum: o handler simplesmente nunca é chamado.
//
// Aqui, mesmo padrão do garantirVitrineStripe: uma conferida por instância fria,
// SOMA o que falta e nunca remove nada (a conta da Stripe é compartilhada com o
// Pack Solar — mexer na lista dos outros seria desligar o webhook alheio). Por
// isso também só toca endpoint cuja URL é a NOSSA rota.
const EVENTOS_NECESSARIOS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'customer.subscription.deleted',
];
let eventosConferidos = false;

type EndpointStripe = { id?: string; url?: string | null; status?: string | null; enabled_events?: string[] | null };

/** É um endpoint NOSSO e vivo? (a conta é compartilhada — não tocar em endpoint alheio) */
export function ehNossoEndpoint(ep: EndpointStripe): boolean {
  return (ep.url || '').includes('/payments/webhook') && ep.status === 'enabled';
}

/** O que falta assinar neste endpoint. `[]` = não mexer (já ok, ou escuta '*'). */
export function eventosFaltando(ep: EndpointStripe): string[] {
  const atuais = ep.enabled_events ?? [];
  if (atuais.includes('*')) return [];
  return EVENTOS_NECESSARIOS.filter((e) => !atuais.includes(e));
}

async function garantirEventosWebhook(): Promise<void> {
  if (eventosConferidos) return;
  eventosConferidos = true; // uma tentativa por instância fria, sem repique
  try {
    const lista = await stripe.webhookEndpoints.list({ limit: 100 });
    const nossos = lista.data.filter(ehNossoEndpoint);
    if (!nossos.length) {
      console.error('[stripe] nenhum endpoint de webhook casou com /payments/webhook — confere a URL no painel');
      return;
    }
    for (const ep of nossos) {
      const atuais = ep.enabled_events ?? [];
      const faltando = eventosFaltando(ep);
      console.log(`[stripe] webhook ${ep.id} (${ep.url}) assina [${atuais.join(', ')}] · faltando [${faltando.join(', ') || 'nada'}]`);
      if (!faltando.length) continue;
      // SOMA. Nunca substitui: o que já estava lá pode ser de outro produto.
      await stripe.webhookEndpoints.update(ep.id, {
        enabled_events: [...atuais, ...faltando] as any,
      });
      console.log(`[stripe] webhook ${ep.id}: ADICIONADOS ${faltando.join(', ')}`);
    }
  } catch (err) {
    console.error('[stripe] conferência dos eventos do webhook falhou (nada foi alterado):', err);
  }
}

// Campos de atribuição que viajam da LP → Stripe metadata → users.
// lp_session = sd_lp_session (session_id da landing, casa com page_visits).
// fbc/fbp = identificadores de clique do Meta (o que casa a venda com o anúncio).
// Viajam LP → Stripe metadata → webhook → user_data do Purchase (CAPI), pelo mesmo
// caminho dos UTMs. Sem eles a atribuição ao anúncio quase não acontecia.
const ATTRIBUTION_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','lp_session','fbc','fbp'] as const;

// Extrai só os campos de atribuição PRESENTES do body, como strings (Stripe
// exige string e limita 500 chars/valor). Campos ausentes não entram → o
// checkout sem UTM fica idêntico ao de hoje (aditivo, não pode quebrar nada).
function extractAttribution(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ATTRIBUTION_KEYS) {
    const v = body?.[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 480);
  }
  return out;
}

// Só os utm_* presentes no metadata (pra guardar no marcador órfão / value JSONB).
function utmsFromMetadata(meta: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    const v = meta?.[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

// Patch de atribuição pras colunas de `users`, montado SÓ com campos presentes
// no metadata do checkout. Re-entrega do webhook sem UTM → patch vazio (a menos
// do checkout_session_id) → nunca sobrescreve valor já gravado com null.
function attributionPatchFromMetadata(
  meta: Record<string, unknown> | null | undefined,
  checkoutSessionId: string,
): Record<string, string> {
  const utms = utmsFromMetadata(meta);
  const patch: Record<string, string> = { ...utms, checkout_session_id: checkoutSessionId };
  const lp = meta?.lp_session;
  if (typeof lp === 'string' && lp.trim()) patch.attribution_session_id = lp.trim();
  // Só carimba a data se de fato houve algum dado de atribuição (utm ou lp_session).
  if (Object.keys(utms).length || patch.attribution_session_id) {
    patch.attribution_captured_at = new Date().toISOString();
  }
  return patch;
}

export async function createCheckout(req: Request, res: Response): Promise<void> {
  const { plan, cupom } = req.body as { plan: string; cupom?: string };
  // Aceita 'vip' (alias do landing) → 'ilimitado'. 'anual' é o alias que volta
  // da tela /quase-la: o cancel_url carrega `plano=anual` e ela repassa o valor
  // cru — sem este apelido, quem desiste do anual e clica em "voltar pro cartão"
  // recebe "Plano inválido".
  const planKey = plan === 'vip' ? 'ilimitado' : plan === 'anual' ? 'vip_anual' : plan;
  const planInfo = PLAN_MAP[planKey];
  const trialDias = planInfo?.trialDias ?? TRIAL_PADRAO_DIAS;

  if (!planInfo) {
    res.status(400).json({ error: 'Plano inválido' });
    return;
  }

  const ehAnual = planKey === 'vip_anual';

  let priceId: string;
  try {
    priceId = await priceDoPlano(planKey, planInfo);
  } catch (err) {
    console.error('[anual] não consegui resolver o price do plano anual:', err);
    res.status(503).json({ error: 'Plano anual indisponível no momento' });
    return;
  }
  if (!priceId) {
    res.status(400).json({ error: 'Plano inválido' });
    return;
  }

  const { data: user } = await supabase
    .from('users')
    .select('email, plano')
    .eq('id', req.userId)
    .single();

  if (!user?.email) {
    res.status(400).json({ error: 'Usuário não encontrado' });
    return;
  }

  // O anual escapa desta trava de propósito: ele tem o MESMO `plano` interno do
  // mensal ('ilimitado'), então quem está em VIP — ou quem está suspenso ainda
  // marcado como VIP — bateria em "você já está nesse plano" e nunca conseguiria
  // migrar. O caso do assinante VIVO é tratado logo abaixo, separado.
  if (user.plano === planInfo.plano && !ehAnual) {
    res.status(400).json({ error: 'Você já está nesse plano' });
    return;
  }

  // Vitrine do produto (descrição + imagem do checkout). Era só a descrição
  // aqui, e por isso a imagem com "7 DIAS GRÁTIS" sobreviveu ao fim do trial.
  //
  // O ANUAL NÃO CARIMBA. Ele divide o produto com o mensal, e cada checkout
  // sobrescreveria a descrição do outro — o card do checkout ficaria alternando
  // entre as duas ofertas ao sabor de quem comprou por último. A mensagem
  // específica do anual sai no custom_text, que é por sessão.
  if (!ehAnual) await garantirVitrineStripe(priceId, planInfo.descricao);

  // Tem subscription ativa? Faz upgrade in-place com proração — cobra a diferença
  // imediatamente no cartão já cadastrado, sem novo checkout.
  try {
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer = customers.data[0];
    if (customer) {
      // 'all' e não 'active': quem está nos 7 dias grátis fica em 'trialing' e
      // quem atrasou fica em 'past_due'. Filtrar só por 'active' fazia essas
      // duas assinaturas SUMIREM daqui — o upgrade caía no checkout novo e
      // criava uma SEGUNDA assinatura, sob um Customer novo, cobrando os dois
      // planos. Com a oferta sem trial isso vira débito imediato, e a perna
      // antiga fica invisível no portal de cobrança (que lista 1 customer).
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'all',
        limit: 10,
      });
      const activeSub = subs.data.find(
        (s) => s.status === 'active' || s.status === 'trialing' || s.status === 'past_due',
      );
      if (activeSub && activeSub.items.data[0] && ehAnual) {
        // MENSAL VIVO → ANUAL não passa por aqui. O caminho in-place cobra na
        // hora com `always_invoice` e a Stripe NÃO emite checkout.session.completed
        // por ele: seriam ~R$ 564 entrando sem linha no ledger, sem aviso ao dono
        // e sem a concessão das ferramentas. Pra R$ 40 de PRO→VIP isso já era
        // ruim; pra R$ 564 é um buraco. E mandar pro checkout novo criaria uma
        // SEGUNDA assinatura sob outro Customer — a origem conhecida das 111
        // assinaturas pra 85 e-mails. Então: mão humana.
        res.status(409).json({
          error: 'assinatura_ativa',
          message: 'Você já tem uma assinatura ativa. Chama a gente no WhatsApp que a gente troca pro anual sem cobrar duas vezes.',
        });
        return;
      }

      if (activeSub && activeSub.items.data[0]) {
        await stripe.subscriptions.update(activeSub.id, {
          items: [{ id: activeSub.items.data[0].id, price: priceId }],
          proration_behavior: 'always_invoice',
          metadata: { userId: req.userId! },
        });

        await supabase
          .from('users')
          .update({ plano: planInfo.plano, limite_documentos: planInfo.limite, documentos_usados: 0 })
          .eq('id', req.userId);

        // Oferta "o curso vem junto": este caminho NÃO gera webhook (a Stripe só
        // atualiza a assinatura existente), então a concessão do curso tem que
        // acontecer AQUI. Sem isto o PRO que aceita a oferta é cobrado na hora e
        // continua batendo no cadeado do curso.
        if (planKey === 'vip_curso') {
          await concederCursoPorAssinatura(req.userId!, user.email).catch((e) => {
            console.error('[vip_curso] concessão do curso no upgrade in-place falhou:', e);
          });
        }

        res.json({ upgraded: true, plano: planInfo.plano });
        return;
      }
    }
  } catch (err) {
    console.error('upgrade in-place falhou, caindo no checkout normal:', err);
  }

  // Fluxo normal: usuário sem subscription ativa (FREE) → cria checkout
  // Com trial de 7 dias: cartão capturado, primeira cobrança só no 8º dia.
  const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

  // Mesmo cupom de primeiro mês do fluxo público, com o mesmo isolamento: se
  // qualquer parte falhar, a pessoa compra pelo preço cheio em vez de não
  // conseguir comprar (ver createPublicCheckout). O upgrade in-place lá em cima
  // NÃO passa por aqui — quem já tem assinatura viva troca de plano com
  // proração e não ganha desconto de adesão.
  //
  // O ANUAL NÃO ACEITA CUPOM — nem de link, nem digitado. Os cupons vivos são de
  // PRIMEIRO MÊS e foram calibrados contra os R$ 67 do mensal: o ACESSO19 passa
  // liso pelo aplicarCupom (19 < 564) e venderia um ANO por R$ 19. Cupom de
  // anual, quando existir, precisa nascer com esse valor em mente.
  let aplicado = null as CupomAplicado | null;
  let discounts: Array<{ coupon: string }> | undefined;
  let permitirCodigoDigitado = false;
  if (!ehAnual) {
    try {
      aplicado = aplicarCupom(await buscarCupomValido(cupom, planInfo.plano), planInfo.valor);
      if (aplicado) {
        discounts = [{ coupon: await garantirCupomStripe(stripe, aplicado, planInfo.plano) }];
      } else {
        permitirCodigoDigitado = await prepararCodigoDigitado(planInfo.plano, planInfo.valor);
      }
    } catch (err) {
      console.error(`[cupons] ${cupom} não aplicado — seguindo no preço cheio:`, err);
      aplicado = null;
      discounts = undefined;
      permitirCodigoDigitado = false;
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    ...(discounts ? { discounts } : permitirCodigoDigitado ? { allow_promotion_codes: true } : {}),
    customer_email: user.email,
    // Telefone: o checkout público já coletava, este NÃO — e é daqui que vem a
    // maioria dos abandonos (o UpgradeModal de quem já tem conta). Sem o número,
    // `abandoned_checkouts.phone` nascia null e a Giovanna nunca falava com
    // ninguém: 7 de 7 abandonos capturados até 14/08/2026 sem telefone.
    phone_number_collection: { enabled: true },
    // `oferta` é o que separa vip_curso de um VIP comum no webhook. Os dois usam
    // o MESMO price (STRIPE_PRICE_VIP), então planByPrice() não distingue — sem
    // este carimbo, ou ninguém recebe o curso, ou todo VIP recebe.
    metadata: {
      userId: req.userId!,
      // `plan` é o que a recuperação de abandono lê pra dizer se ele estava
      // assinando o PRO ou o VIP. Sem isso todo abandono daqui virava e-mail
      // dizendo "PRO" — inclusive pra quem estava comprando o VIP.
      plan: planInfo.plano,
      ...(planKey === 'vip_curso' ? { oferta: 'vip_curso' } : ehAnual ? { oferta: 'vip_anual' } : {}),
      ...(aplicado ? { cupom: aplicado.cupom.codigo } : {}),
    },
    subscription_data: {
      // trialDias: 0 = cobra agora (oferta sem trial). undefined = os 7 de sempre.
      ...(trialDias > 0 ? { trial_period_days: trialDias } : {}),
      metadata: {
        userId: req.userId!,
        ...(planKey === 'vip_curso' ? { oferta: 'vip_curso' } : ehAnual ? { oferta: 'vip_anual' } : {}),
        ...(aplicado ? { cupom: aplicado.cupom.codigo } : {}),
      },
    },
    // Pós-pagamento: cai em /documentos pra ele ver os tipos de doc, conhecer
    // a plataforma. Banner sugere (não obriga) cadastrar empresa. CompanyRequiredGate
    // só bloqueia quando ele clica num tipo específico de doc.
    success_url: `${dashboardUrl}/documentos?welcome=1&plan=${encodeURIComponent(planInfo.plano)}`,
    // Clicou em "voltar" no Stripe → cai numa tela que oferece o Pix na hora, em
    // vez da home (que ignorava `cancelado=1` desde sempre). Leva plano e cupom
    // junto: sem eles a tela mostraria outro preço do que ele acabou de ver.
    // NÃO cobre fechar a aba — aí só a cadência de abandono alcança.
    // `via=conta`: a tela precisa saber por onde refazer o cartão. Mandar quem já
    // tem conta pro checkout PÚBLICO criaria um Customer novo na Stripe — que é a
    // origem conhecida das assinaturas duplicadas (111 assinaturas p/ 85 e-mails).
    cancel_url:  `${dashboardUrl}/quase-la?cancelado=1&via=conta&plano=${encodeURIComponent(ehAnual ? 'anual' : planInfo.plano === 'ilimitado' ? 'vip' : planInfo.plano)}${aplicado ? `&cupom=${encodeURIComponent(aplicado.cupom.codigo)}` : ''}`,
    custom_text: {
      submit: {
        message: ehAnual
          ? TEXTO_SUBMIT_ANUAL
          : aplicado
            ? `Primeiro mês por R$ ${aplicado.primeiroMes} (cupom ${aplicado.cupom.codigo}). Depois R$ ${aplicado.precoCheio}/mês, cancele quando quiser.`
            : planInfo.descricao,
      },
    },
  });

  res.json({ url: session.url, cupom: aplicado?.cupom.codigo ?? null, primeiroMes: aplicado?.primeiroMes ?? null });
}

// Checkout PÚBLICO (sem login) — fluxo LP → Stripe → Cadastro.
// A pessoa escolhe o plano na LP e vai DIRETO pro Stripe (coleta email + cartão,
// 7 dias grátis). Só depois de aprovar o cartão ela cria a conta no cadastro
// (com o email do session_id). Sem free: quem não passa daqui não tem conta.
export async function createPublicCheckout(req: Request, res: Response): Promise<void> {
  const { plan, cupom } = req.body as { plan: string; cupom?: string };
  // Mesmos apelidos do createCheckout: 'vip' vem da LP, 'anual' volta da /quase-la.
  const planKey = plan === 'vip' ? 'ilimitado' : plan === 'anual' ? 'vip_anual' : plan;
  const planInfo = PLAN_MAP[planKey];
  const trialDias = planInfo?.trialDias ?? TRIAL_PADRAO_DIAS;

  if (!planInfo) {
    res.status(400).json({ error: 'Plano inválido' });
    return;
  }

  const ehAnual = planKey === 'vip_anual';

  try {
    const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

    // O price do anual é resolvido (ou criado) aqui, na primeira compra depois
    // do deploy. Falhou? 503 explícito — melhor a LP dizer "tenta de novo" do
    // que mandar a pessoa pra um checkout sem preço.
    let priceId: string;
    try {
      priceId = await priceDoPlano(planKey, planInfo);
    } catch (err) {
      console.error('[anual] não consegui resolver o price do plano anual:', err);
      res.status(503).json({ error: 'Plano anual indisponível no momento' });
      return;
    }
    if (!priceId) {
      res.status(400).json({ error: 'Plano inválido' });
      return;
    }

    // Imagem e descrição do produto no checkout — uma vez por instância fria.
    // O anual não carimba: divide o produto com o mensal (ver createCheckout).
    if (!ehAnual) await garantirVitrineStripe(priceId, planInfo.descricao);
    // Mesma janela: confere se o endpoint assina os eventos que o código trata.
    // Aqui é o gatilho que mais roda — a Stripe só nos chama quando há evento, e
    // um evento que falta é justamente o que não chega pra disparar a conferência.
    await garantirEventosWebhook();

    // Atribuição: a LP manda os UTMs + o session_id (sd_lp_session) no body.
    // Só entram no metadata se vierem preenchidos (campos ausentes = checkout
    // normal de hoje). Stripe exige valores string; truncamos por segurança.
    const attribution = extractAttribution(req.body);

    // CUPOM DE PRIMEIRO MÊS. Vale só na 1ª fatura (`duration: once` na Stripe);
    // da segunda em diante a assinatura cobra o preço cheio sozinha.
    //
    // TUDO isolado num try: cupom inválido, vencido, esgotado, de outro plano —
    // ou falha ao criar o cupom na Stripe — cai no preço cheio. Deixar a exceção
    // subir transformaria "não consegui aplicar o desconto" em "ninguém compra",
    // e quem descobriria seria o primeiro cliente que recebesse o link.
    //
    // O ANUAL FICA DE FORA (ver a nota longa no createCheckout): os cupons vivos
    // são de primeiro mês, calibrados contra R$ 67 — o ACESSO19 venderia um ano
    // inteiro por R$ 19 sem que nada aqui reclamasse.
    let aplicado = null as CupomAplicado | null;
    let discounts: Array<{ coupon: string }> | undefined;
    let permitirCodigoDigitado = false;
    if (!ehAnual) {
      try {
        aplicado = aplicarCupom(await buscarCupomValido(cupom, planInfo.plano), planInfo.valor);
        if (aplicado) {
          discounts = [{ coupon: await garantirCupomStripe(stripe, aplicado, planInfo.plano) }];
        } else {
          // Sem cupom no link: libera o campo "adicionar código promocional" pra
          // quem a Giovanna mandou digitar. Só quando EXISTE cupom vivo pro plano
          // — campo que recusa tudo o que for digitado é pior que campo nenhum.
          permitirCodigoDigitado = await prepararCodigoDigitado(planInfo.plano, planInfo.valor);
        }
      } catch (err) {
        console.error(`[cupons] ${cupom} não aplicado — seguindo no preço cheio:`, err);
        aplicado = null;       // metadata e texto do botão não podem prometer o desconto
        discounts = undefined;
        permitirCodigoDigitado = false;
      }
    }

    // O código vai no metadata porque é o webhook — não a criação da sessão —
    // que contabiliza o uso. Checkout aberto e abandonado não queima cupom.
    // `oferta: vip_anual` é o que separa o anual do mensal pra quem só lê
    // metadata: a recuperação de abandono (que senão manda copy de R$ 67 pra
    // quem abandonou R$ 564) e o webhook, que libera as ferramentas por ele.
    const baseMeta = {
      plan: planInfo.plano, source: 'public_checkout', ...attribution,
      ...(ehAnual ? { oferta: 'vip_anual' } : {}),
      ...(aplicado ? { cupom: aplicado.cupom.codigo } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      // Um ou outro: a Stripe não aceita desconto pronto E campo de digitar juntos.
      ...(discounts ? { discounts } : permitirCodigoDigitado ? { allow_promotion_codes: true } : {}),
      // Stripe coleta o email no próprio checkout (não temos user ainda).
      billing_address_collection: 'auto',
      // Coleta o WhatsApp no checkout → o webhook manda a boas-vindas da Giovanna
      // pelo número certo NA HORA do pagamento (não depende do cliente voltar e
      // preencher o cadastro). Vem em E.164 (+55...) em session.customer_details.phone.
      phone_number_collection: { enabled: true },
      subscription_data: {
        ...(trialDias > 0 ? { trial_period_days: trialDias } : {}),
        metadata: baseMeta,
      },
      metadata: baseMeta,
      // Pós-pagamento → cadastro com o session_id pra puxar o email e o plano.
      // &plano= é fallback: se o GET /checkout-info falhar, o RegisterForm ainda
      // sabe o plano e não mostra a tela enganosa de "criar conta grátis".
      success_url: `${dashboardUrl}/auth?mode=register&session={CHECKOUT_SESSION_ID}&plano=${encodeURIComponent(planInfo.plano === 'ilimitado' ? 'vip' : planInfo.plano)}`,
      // Ver a nota do outro checkout: "voltar" no Stripe cai na oferta de Pix,
      // com o mesmo plano e o mesmo cupom que ele estava levando.
      cancel_url:  `${dashboardUrl}/quase-la?cancelado=1&via=lp&plano=${encodeURIComponent(ehAnual ? 'anual' : planInfo.plano === 'ilimitado' ? 'vip' : planInfo.plano)}${aplicado ? `&cupom=${encodeURIComponent(aplicado.cupom.codigo)}` : ''}`,
      // Com cupom, o texto do botão diz o que acontece no mês 2 — é o que evita
      // a pessoa achar que R$ 19 é o preço da assinatura e contestar depois.
      // No anual, a mesma lógica com outro risco: quem lê só "R$ 47/mês" e vê
      // R$ 564 na fatura abre disputa. O texto diz o valor cheio e o ciclo.
      custom_text: {
        submit: {
          message: ehAnual
            ? TEXTO_SUBMIT_ANUAL
            : aplicado
              ? `Primeiro mês por R$ ${aplicado.primeiroMes} (cupom ${aplicado.cupom.codigo}). Depois R$ ${aplicado.precoCheio}/mês, cancele quando quiser.`
              : planInfo.descricao,
        },
      },
    });

    res.json({ url: session.url, cupom: aplicado?.cupom.codigo ?? null, primeiroMes: aplicado?.primeiroMes ?? null });
  } catch (err) {
    console.error('createPublicCheckout error:', err);
    res.status(500).json({ error: 'Falha ao iniciar o checkout' });
  }
}

// GET /payments/cupom/:codigo?plano=vip — consulta pública que a tela /assinar
// usa pra mostrar "primeiro mês R$ X" antes de mandar o cliente pro pagamento.
export async function getCupomInfo(req: Request, res: Response): Promise<void> {
  try {
    const planKey = String(req.query.plano || 'vip') === 'vip' ? 'ilimitado' : String(req.query.plano);
    const planInfo = PLAN_MAP[planKey];
    if (!planInfo) {
      res.status(400).json({ error: 'Plano inválido' });
      return;
    }
    res.json(await resumoPublicoCupom(String(req.params.codigo || ''), planInfo.plano, planInfo.valor));
  } catch (err) {
    console.error('getCupomInfo error:', err);
    res.status(500).json({ error: 'Falha ao consultar o cupom' });
  }
}

// GET /payments/pix-checkout — o caminho de Pix que está no ar, pra tela /quase-la
// (quem clica em "voltar" no Stripe) oferecer na hora. Público: é só um link de
// checkout, o mesmo que a Giovanna manda no WhatsApp.
//
// A URL mora SÓ na env do servidor de propósito. Uma cópia NEXT_PUBLIC_ no front
// seria um segundo lugar pra atualizar quando o produto mudar na Kiwify — e o dia
// em que os dois divergirem, um deles manda o cliente pra um checkout morto.
// `url: null` = trilho não configurado; a tela some com o botão em vez de exibir
// um botão que não leva a lugar nenhum.
export function getPixCheckoutInfo(_req: Request, res: Response): void {
  // `recorrente` = o trilho de débito automático (Asaas) está REALMENTE de pé
  // neste servidor. A tela não pode decidir isso sozinha pela env do front:
  // NEXT_PUBLIC_PIX_RECORRENTE ligada antes da ASAAS_API_KEY ofereceria
  // "assinar no Pix" e entregaria 503 na cara de quem está com a carteira na
  // mão. Quem sabe a verdade é quem tem a chave.
  res.json({
    url: pixCheckoutUrl() || null,
    valor: PIX_MES_VALOR,
    dias: 30,
    recorrente: asaasHabilitado(),
  });
}

export async function getCheckoutInfo(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId as any);

    // No trial de 7 dias NÃO há cobrança imediata: payment_status vem como
    // 'no_payment_required' e a sub fica 'trialing'. Então validamos que o
    // checkout foi COMPLETO (status complete) — não que houve pagamento.
    const paidOrTrialing = session.payment_status === 'paid'
      || session.payment_status === 'no_payment_required'
      || session.status === 'complete';
    if (!paidOrTrialing) {
      res.status(400).json({ error: 'Checkout não concluído' });
      return;
    }

    const email = session.customer_email ?? (session.customer_details as { email?: string })?.email ?? null;

    let planName: string | null = null;
    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = sub.items.data[0]?.price?.id ?? '';
      const info = await planByPrice(priceId);
      if (info) planName = info.plano;
    }

    res.json({ email, plan: planName });
  } catch {
    res.status(404).json({ error: 'Sessão não encontrada' });
  }
}

export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    res.status(400).send('Webhook signature inválida');
    return;
  }

  // Evento assinado é o que mantém o resto do arquivo vivo — confere na 1ª
  // chamada de cada instância. Não bloqueia nada: falhou, segue o evento.
  await garantirEventosWebhook();

  // ── DESVIO: compra do PlugCash ──
  // A conta do Stripe é compartilhada entre produtos, e o isolamento aqui é o
  // carimbo `pc_item_slug` que a sessão do PlugCash grava em metadata. Sem ele,
  // uma venda de curso cairia no bloco de assinatura do SolarDoc — que a
  // ignoraria por não ter priceId, e o comprador ficaria sem acesso e sem aviso.
  if (event.type === 'checkout.session.completed' && event.data.object?.metadata?.pc_item_slug) {
    const s = event.data.object as any;
    const md = s.metadata || {};
    const email = s.customer_email || s.customer_details?.email || '';
    const utm = Object.fromEntries(
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
        .map((k) => [k, md[k] || null]),
    );

    try {
      // O item principal e o bump são compras SEPARADAS, com gateway_ref
      // próprio — mesma regra da Kiwify. Chave única por pedido+item é o que
      // impede o bump de sobrescrever o curso.
      const itens: Array<[string, string, number]> = [['curso', md.pc_item_slug, 0]];
      if (md.pc_bump_slug) itens.push(['servico', md.pc_bump_slug, 0]);

      // O valor total da sessão não serve por item. Busca o preço de cada um no
      // catálogo, que é a fonte da verdade do que foi cobrado.
      for (const item of itens) {
        const tabela = item[0] === 'curso' ? 'pc_cursos' : 'pc_servicos';
        const { data } = await supabase.from(tabela)
          .select('preco_centavos').eq('slug', item[1]).maybeSingle();
        item[2] = (data as any)?.preco_centavos ?? 0;
      }
      // Escada de preço: o curso pode ter sido vendido num degrau (R$ 47, R$ 27).
      // O carimbo da sessão manda no valor do CURSO — o catálogo só sabe o cheio.
      // O bump não entra nisso: ele é cobrado sempre pelo preço dele.
      const valorDegrau = Number(md.pc_valor_centavos);
      if (Number.isFinite(valorDegrau) && valorDegrau >= 100) {
        const curso = itens.find((i) => i[0] === 'curso');
        if (curso) curso[2] = Math.round(valorDegrau);
      }

      for (const [tipo, slug, valor] of itens) {
        await processarEventoPlugcash({
          orderId: s.id,
          email,
          nome: s.customer_details?.name || null,
          telefone: s.customer_details?.phone || null,
          status: 'paid',
          produtoId: `stripe:${slug}`,
          produtoNome: null,
          valorCentavos: valor,
          checkoutLink: md.pc_origem || null,
          utm,
          payload: s,
          // Stripe carrega o item no metadata, então não precisa passar pelo
          // mapeamento de produto da Kiwify — o que foi vendido já é explícito.
          itemDireto: { item_tipo: tipo, item_slug: slug, gera_credito: tipo === 'curso' },
        } as any);
      }
      console.info(`[stripe:plugcash] ${md.pc_item_slug} · ${email}`);
    } catch (e) {
      console.error('[stripe:plugcash] processamento falhou:', e);
    }
    res.json({ received: true, plugcash: true });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const userId  = session.metadata?.userId;
    const email   = session.customer_email ?? (session.customer_details as any)?.email;

    let priceId = '';
    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      priceId = sub.items.data[0]?.price?.id ?? '';
    }

    const planInfo = await planByPrice(priceId);
    // Guard cross-produto: este bloco SÓ roda pra price PRO/VIP do SolarDoc.
    // Compra do Pack Solar é mode=payment, sem subscription → priceId='' →
    // planByPrice undefined → bloco pulado. Conta Stripe é compartilhada, então
    // o isolamento aqui é justamente o `if (planInfo)`.
    if (planInfo) {
      const { plano, limite } = planInfo;

      // ── CUPOM DE PRIMEIRO MÊS ──────────────────────────────────────────────
      // Dois caminhos chegam aqui: o do LINK (?cupom=…, que carimba o metadata) e
      // o DIGITADO no checkout (que não carimba nada — quem aplicou foi a Stripe).
      // O sinal que cobre os dois é o desconto na própria sessão.
      const descontou = Number(session.total_details?.amount_discount ?? 0) > 0;
      let codigoCupom = normalizarCodigo(session.metadata?.cupom);
      if (!codigoCupom && descontou) codigoCupom = await codigoDoDescontoDigitado(session.id);

      // Com cupom, o que entrou no caixa foi o valor com desconto (R$ 19), não o
      // preço de tabela. O ledger, o aviso ao dono, o Purchase da Meta e a UTMify
      // passam a usar o valor REAL só neste caso — sem desconto, tudo segue byte
      // a byte como antes (o `valor` de tabela do PLAN_MAP).
      const totalPago = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
      const valor = ((codigoCupom || descontou) && totalPago && totalPago > 0) ? totalPago : planInfo.valor;

      // Contabiliza o uso AQUI, no pagamento confirmado — não na criação da
      // sessão. `referencia` = session.id, que é único: reentrega do webhook
      // (at-least-once) não conta duas vezes. Cupom com teto pode estourar em
      // uma unidade se dois pagarem no mesmo segundo; é o trade-off aceito —
      // o dinheiro já entrou, recusar depois seria pior.
      if (codigoCupom) {
        await registrarUsoCupom({
          codigo: codigoCupom,
          email: email ?? null,
          origem: 'stripe',
          referencia: session.id,
          valor,
        });
      }

      // Com trial, o Stripe devolve 'no_payment_required' (nada foi cobrado) e a
      // assinatura nasce 'trialing'. Sem trial, vem 'paid' e o dinheiro já entrou.
      // Os três estados abaixo (conta, ledger, UTMify) derivam daqui em vez de
      // assumir que todo checkout começa em trial.
      const cobrouAgora = session.payment_status === 'paid';

      // Atribuição forward-only: lê os UTMs que createPublicCheckout gravou no
      // metadata. Só keys NÃO-vazias entram no patch — uma re-entrega do webhook
      // sem UTM (improvável, mas at-least-once) nunca zera o que já foi gravado.
      // Esta é a escrita de FALLBACK; a primária é no register (authController).
      const attrPatch = attributionPatchFromMetadata(session.metadata, session.id);

      if (userId) {
        await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0, ...attrPatch })
          .eq('id', userId);
      } else if (email) {
        // Normaliza p/ lowercase — o register grava e busca a conta em lowercase.
        // O UPDATE e o INSERT abaixo PRECISAM usar o mesmo case, senão o webhook
        // cria uma linha ("Foo@x.com") que o register não acha ("foo@x.com") e
        // vira DUPLICATA (users.email é UNIQUE case-sensitive).
        const emailLc = String(email).toLowerCase().trim();

        // UPDATE com .select() pra saber se casou alguma linha. Se a conta JÁ existe
        // (ex.: FREE que comprou depois), só atualiza o plano. Se 0 linhas casarem,
        // é o fluxo LP→Stripe→cadastro em que a pessoa ainda não tem conta → o bloco
        // abaixo (100% CADASTRO) CRIA a conta na hora e manda "defina sua senha".
        const { data: updated } = await supabase
          .from('users')
          .update({ plano, limite_documentos: limite, documentos_usados: 0, ...attrPatch })
          .eq('email', emailLc)
          .select('id');

        if (!updated?.length) {
          // ═══════════════════ 100% CADASTRO ═══════════════════
          // Pagou (sub trialing criada) mas AINDA não tem conta — fluxo
          // LP→Stripe→cadastro em que a pessoa fecha a aba antes de voltar. Em vez
          // de só marcar/avisar (que deixava o cliente invisível), CRIAMOS a conta
          // AGORA, com o email e o plano que a Stripe confirmou, e mandamos "defina
          // sua senha" por EMAIL (backbone) + WhatsApp (best-effort). Assim nenhum
          // pagante fica sem cadastro.
          //
          // IDEMPOTÊNCIA: users.email é UNIQUE → re-entrega do webhook (at-least-once)
          // ou corrida com o /register batem em 23505 e são ignoradas (não duplica
          // conta nem reenvia). ADITIVO E À PROVA DE ERRO: todo o bloco é try/catch;
          // qualquer falha aqui NÃO pode quebrar o Purchase/Meta abaixo nem o pagamento.
          try {
            const phone = ((session.customer_details as any)?.phone || '').replace(/\D/g, '') || null;
            const nome  = ((session.customer_details as any)?.name as string | null) || null;
            const token = crypto.randomBytes(32).toString('hex');
            // Expiração GENEROSA (30d) — é onboarding, não recuperação de senha de 1h.
            const expiresIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            const { data: created, error: insErr } = await supabase
              .from('users')
              .insert({
                email: emailLc,
                password_hash: null,          // conta PENDENTE — ativa quando o cliente definir a senha
                nome,
                plano,
                limite_documentos: limite,
                documentos_usados: 0,
                data_reset: expiresIso,
                whatsapp: phone,
                // Sem trial a assinatura já nasce cobrada — gravar 'trialing'
                // fixo colocaria o cliente num estado que ele nunca esteve.
                billing_status: cobrouAgora ? 'active' : 'trialing',
                reset_token: token,
                reset_token_expires: expiresIso,
                ...attrPatch,
              })
              .select('id')
              .single();

            if (insErr) {
              // 23505 = email já existe (re-entrega OU o /register acabou de criar) →
              // conta já tratada, não faz nada. Outro erro: loga e segue (não quebra).
              if ((insErr as { code?: string }).code !== '23505') {
                console.error('100%-cadastro: criação de conta no webhook falhou:', insErr);
              }
            } else if (created) {
              const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
              const resetUrl = `${dashboardUrl}/auth?mode=redefinir&token=${token}`;

              // EMAIL = backbone confiável (Resend nunca é banido). Await pra garantir
              // o envio antes de a função serverless encerrar.
              try {
                await sendCheckoutCompletionEmail({ to: emailLc, sessionId: session.id, plano, resetUrl });
              } catch (err) {
                console.error('100%-cadastro: email de ativação falhou:', err);
              }

              // WhatsApp = MELHOR-ESFORÇO (Z-API pode cair/banir). NUNCA trava a conta.
              // Só dispara se a Stripe coletou telefone no checkout.
              if (phone) {
                try {
                  await sendActivationWhatsApp(phone, resetUrl, plano, nome);
                  await supabase
                    .from('users')
                    .update({ whatsapp_welcome_sent_at: new Date().toISOString() })
                    .eq('id', created.id);
                } catch (err) {
                  console.error('100%-cadastro: WhatsApp de ativação falhou:', err);
                }
              }
            }
          } catch (err) {
            console.error('100%-cadastro: exceção no auto-create (pagamento intacto):', err);
          }
        }
      }

      // ═══════════════════ CURSO DA OFERTA "VIP COM O CURSO JUNTO" ═══════════
      // Só quem veio pela oferta `vip_curso` recebe — o carimbo está no metadata
      // porque vip_curso e o VIP comum compartilham o price, e planByPrice() não
      // os separa. VIP vindo da LP continua sem o curso (nunca foi prometido a
      // ele): pra esse, a tela do curso leva à página de venda.
      //
      // Aditivo e à prova de erro, como os blocos vizinhos: se falhar, o
      // pagamento e o Purchase seguem intactos e o cliente é recuperável pelo log.
      if ((session.metadata as Record<string, string | undefined> | null)?.oferta === 'vip_curso') {
        try {
          let alunoId = userId as string | undefined;
          const alunoEmail = String(email || '').toLowerCase().trim();
          if (!alunoId && alunoEmail) {
            const { data: u } = await supabase
              .from('users')
              .select('id')
              .eq('email', alunoEmail)
              .maybeSingle();
            alunoId = (u as { id?: string } | null)?.id;
          }
          if (alunoId && alunoEmail) {
            await concederCursoPorAssinatura(alunoId, alunoEmail);
          } else {
            console.error('[vip_curso] não consegui resolver o aluno pra conceder o curso', { userId, email });
          }
        } catch (err) {
          console.error('[vip_curso] concessão do curso no webhook falhou:', err);
        }
      }

      // ═══════════ FERRAMENTAS DO ANUAL (Precificação + Inventário) ═══════════
      // Quem comprou o anual leva as duas PRA SEMPRE — não é acesso derivado da
      // assinatura (esse o mensal já tem enquanto paga), é posse gravada em
      // `entitlements`. É o que a página de venda promete, e é o que separa o
      // anual de "12 mensais com desconto".
      //
      // O carimbo é o metadata, não o price: mesmo padrão do vip_curso. E o
      // bloco é isolado, como os vizinhos — falhar aqui não pode derrubar o
      // Purchase nem o ledger; o cliente fica recuperável pelo log.
      //
      // `concederAcesso` não tem `expira_em`: o trilho concede pra sempre. É
      // decisão consciente — a alternativa seria uma coluna de ciclo nova só
      // pra revogar duas ferramentas de R$ 67 de quem pagou R$ 564.
      if ((session.metadata as Record<string, string | undefined> | null)?.oferta === 'vip_anual') {
        try {
          let donoId = userId as string | undefined;
          const donoEmail = String(email || '').toLowerCase().trim();
          if (!donoId && donoEmail) {
            const { data: u } = await supabase
              .from('users').select('id').eq('email', donoEmail).maybeSingle();
            donoId = (u as { id?: string } | null)?.id;
          }
          if (donoId) {
            for (const produtoId of FERRAMENTAS_DO_ANUAL) {
              await concederAcesso({
                userId: donoId,
                produto: produtoId,
                origem: 'compra',
                orderId: session.id,
                obs: 'incluso no plano anual',
              });
            }
            console.info(`[anual] ferramentas liberadas pra ${donoEmail}: ${FERRAMENTAS_DO_ANUAL.join(', ')}`);
          } else {
            // Conta criada logo acima pelo 100%-CADASTRO já cairia no `donoId`.
            // Se nem assim apareceu, o log é o que permite conceder à mão.
            console.error('[anual] não consegui resolver o dono pra liberar as ferramentas', { userId, email });
          }
        } catch (err) {
          console.error('[anual] liberação das ferramentas falhou (pagamento intacto):', err);
        }
      }

      // ═══════════════════ VENDA (fonte única) + PURCHASE ═══════════════════
      // DURABLE-FIRST: grava a linha da venda no ledger `sales` ANTES de tentar o
      // Meta. Se a entrega falhar (rede/token/freeze serverless), o cron
      // reDrivePendingPurchases reenvia (idempotente por event_id = session.id →
      // Meta faz dedup, não duplica). O Purchase leva email + TELEFONE + external_id
      // + nome (+ fbc/fbp quando a Fase 4 popular) → correspondência forte; o email
      // sozinho quase não casava a venda com o anúncio. value = preço REAL do plano
      // (27/49/67) do PLAN_MAP. Aditivo e à prova de erro: nunca quebra o pagamento.
      try {
        const cd = session.customer_details as { name?: string | null; phone?: string | null } | null;
        // `precoAnualConhecido()` pode vir vazio numa instância que nunca
        // resolveu o anual — daí a guarda: sem ela, um priceId vazio casaria
        // com '' e toda compra sem price viraria "VIP ANUAL" no ledger.
        const idAnual = precoAnualConhecido();
        const produto = (idAnual && priceId === idAnual) ? 'VIP ANUAL'
          : priceId === PLAN_MAP.vip_promo.priceId ? 'VIP PROMO'
          : priceId === PLAN_MAP.ilimitado.priceId ? 'VIP' : 'PRO';
        const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
        // T0 da venda — usado no ledger E no createdAt da UTMify (tem que ser o
        // MESMO instante nos dois envios waiting_payment→paid, senão a UTMify recusa
        // a atualização por createdAt divergente).
        const cardPassedAt = new Date().toISOString();
        const saleId = await upsertSale({
          checkout_session_id: session.id,
          subscription_id: (session.subscription as string) ?? null,
          customer_id: (session.customer as string) ?? null,
          email: email ?? null,
          nome: cd?.name ?? null,
          phone: cd?.phone ? String(cd.phone).replace(/\D/g, '') : null,
          plano, produto, valor,
          status: cobrouAgora ? 'paid' : 'trialing',
          utm_source: meta.utm_source ?? null,
          utm_medium: meta.utm_medium ?? null,
          utm_campaign: meta.utm_campaign ?? null,
          utm_content: meta.utm_content ?? null,
          utm_term: meta.utm_term ?? null,
          attribution_session_id: meta.lp_session ?? null,
          fbc: meta.fbc ?? null,   // Fase 4 (LP) passa a popular
          fbp: meta.fbp ?? null,
          // Carimbo do follow-up: cupom só existe em link/código que a Giovanna
          // mandou. É ele que tira esta venda do Purchase da Meta (ver o gate em
          // salesLedger) e a deixa só no painel e no aviso do WhatsApp.
          cupom: codigoCupom ?? null,
          // `descontou` junto de propósito: o cupom DIGITADO no checkout só vira
          // código depois de um lookup na Stripe, e quando ele falha sobra só o
          // desconto. Sem este par, uma venda de R$ 19 iria pro pixel como se
          // fosse do anúncio.
          comDesconto: descontou,
          card_passed_at: cardPassedAt,
        });
        // AVISO DO DONO — antes do Meta/UTMify de propósito: dos três, é o único
        // que uma PESSOA lê. Isolado com .catch: aviso que falha nunca pode
        // derrubar o Purchase nem o espelho da venda.
        // Não cobre o upgrade in-place (PRO→VIP de quem já assina): aquele caminho
        // atualiza a assinatura direto e a Stripe não emite checkout.session.completed.
        // CLIENTE NOVO vs QUEM JÁ ASSINA (14/08/2026): o aviso tratava toda venda
        // como aquisição. Nos dois casos que o Thiago mostrou, isso era mentira em
        // um deles — o mesmo e-mail já tinha comprado em 22/05, cancelado e voltado
        // pelo cupom de R$19. E o caso pior é o inverso: recompra de quem JÁ paga é
        // o começo das 111 assinaturas pra 85 e-mails (a raiz dos chargebacks).
        // Fica FORA do try/catch de dentro? Não: mora aqui, isolado por .catch, e
        // devolve null quando não dá pra apurar — aviso sem histórico ainda é aviso.
        const historico = await historicoDoCliente({
          email: email ?? null,
          checkoutSessionIdAtual: session.id,
          subscriptionIdAtual: (session.subscription as string) ?? null,
          assinaturaViva: async (subId) => {
            const s = await stripe.subscriptions.retrieve(subId);
            return ['active', 'trialing', 'past_due'].includes(String(s.status));
          },
        }).catch(() => null);

        // Mesma classificação que o gate do Meta vai usar logo abaixo — uma
        // função só, senão o aviso promete "contabilizada" numa venda pulada.
        const cls = classificarOrigem({
          utm_source: meta.utm_source ?? null,
          utm_medium: meta.utm_medium ?? null,
          utm_campaign: meta.utm_campaign ?? null,
          fbc: meta.fbc ?? null,
          fbp: meta.fbp ?? null,
          cupom: codigoCupom ?? null,
          comDesconto: descontou,
        });

        await avisarVendaAoDono(saleId, {
          produto, valor,
          cobrouAgora,
          historico,
          email: email ?? null,
          nome: cd?.name ?? null,
          phone: cd?.phone ? String(cd.phone).replace(/\D/g, '') : null,
          utmSource: meta.utm_source ?? null,
          utmCampaign: meta.utm_campaign ?? null,
          utmContent: meta.utm_content ?? null,
          origem: cls.origem,
          origemDetalhe: cls.detalhe,
        }).catch((err) => console.error('[venda] aviso do dono falhou (venda intacta):', err));

        if (saleId) await sendPurchaseForSale(saleId);

        // Espelha a venda na UTMify como 'waiting_payment' (trial começou, ainda sem
        // cobrança). orderId = subscription_id → o invoice.payment_succeeded depois
        // ATUALIZA pra 'paid'. Mesmos UTMs do metadata → o painel casa o SolarDoc com
        // o anúncio. Não bloqueia nem quebra (sendUtmifyOrder engole o próprio erro).
        await sendUtmifyOrder({
          orderId: (session.subscription as string) || session.id,
          // A UTMify NÃO se auto-corrige (o ledger interno sim, pelo stripeSync).
          // Se a venda sem trial nascesse como 'waiting_payment' e o 'paid' nunca
          // viesse, a atribuição de mídia ficava errada pra sempre.
          status: cobrouAgora ? 'paid' : 'waiting_payment',
          createdAt: cardPassedAt,
          email: email ?? null,
          name: cd?.name ?? null,
          phone: cd?.phone ? String(cd.phone).replace(/\D/g, '') : null,
          productId: plano,
          productName: produto,
          priceInReais: valor,
          utm_source: meta.utm_source ?? null,
          utm_medium: meta.utm_medium ?? null,
          utm_campaign: meta.utm_campaign ?? null,
          utm_content: meta.utm_content ?? null,
          utm_term: meta.utm_term ?? null,
        });
      } catch (err) {
        console.error('ledger/Purchase falhou (pagamento intacto):', err);
      }
    }
  }

  // ═══════════════ RECUPERAÇÃO: checkout abandonado / cartão recusado ═══════════════
  // A sessão expirou SEM concluir (a pessoa fechou a aba, ou o cartão foi recusado e
  // ela desistiu). O email/telefone que a Stripe já coletou são salvos em
  // abandoned_checkouts pra uma cadência de recuperação (email + WhatsApp da Giovanna).
  // Só checkout DO SOLARDOC, e só se temos como falar com a pessoa (email OU
  // telefone) — bounce puro é irrecuperável. Idempotente por session.
  //
  // "Nosso" = carimbo que só os NOSSOS dois checkouts põem: `source` (o público da
  // LP) ou `userId` (o logado, de quem já tem conta no free e desistiu de assinar).
  // Era só o `source`, e isso jogava fora todo abandono de quem já era usuário — o
  // caminho do UpgradeModal. A conta da Stripe é compartilhada com o Pack Solar, que
  // não põe nenhum dos dois: por isso o filtro continua existindo em vez de aceitar
  // qualquer sessão expirada.
  // NOTA: só chega aqui se o webhook na Stripe ASSINAR checkout.session.expired —
  // garantirEventosWebhook() agora repõe essa assinatura sozinho.
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as any;
    const nosso = session.metadata?.source === 'public_checkout' || !!session.metadata?.userId;
    if (nosso) {
      const cd = session.customer_details as { email?: string | null; name?: string | null; phone?: string | null } | null;
      const email = session.customer_email ?? cd?.email ?? null;
      if (email || cd?.phone) {
        try {
          await supabase.from('abandoned_checkouts').upsert({
            session_id: session.id,
            email: email ? String(email).toLowerCase().trim() : null,
            phone: cd?.phone ? String(cd.phone).replace(/\D/g, '') : null,
            nome: cd?.name ?? null,
            plano: session.metadata?.plan ?? null,
            status: 'abandoned',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'session_id' });
        } catch (err) {
          console.error('abandoned_checkouts upsert falhou:', err);
        }
      }
    }
  }

  // Cancelamento da assinatura (cancelou nos 7 dias, ou Stripe encerrou após
  // retentativas). Modelo SEM FREE: BLOQUEIA (suspended) — a tela de suspensão
  // pede pra reativar/atualizar o cartão. Não vira mais free.
  if (event.type === 'customer.subscription.deleted') {
    const sub    = event.data.object as any;
    const custId = sub.customer as string;
    const customer = await stripe.customers.retrieve(custId) as any;
    if (customer.email) {
      // GUARD PIX: NÃO suspende quem tem acesso Pix ATIVO (plano_expira_em no futuro).
      // Caso real: cliente em dunning paga por Pix → a gente CANCELA a sub de cartão no
      // Stripe (anti-cobrança-dupla) → este evento dispara. Sem o guard, re-suspendia o
      // pagante (fica trancado fora do app). Só suspende quando o acesso Pix é nulo ou já
      // venceu — aí o cancelamento de cartão é fim de acesso de verdade (ex.: D5 do dunning).
      const nowIso = new Date().toISOString();
      await supabase
        .from('users')
        .update({
          billing_status: 'suspended',
          documentos_usados: 0,
          dunning_last_day_sent: null,
        })
        .eq('email', customer.email)
        .or(`plano_expira_em.is.null,plano_expira_em.lt.${nowIso}`);
    }
  }

  // Renovação da assinatura falhou — INICIA o fluxo de dunning de 7 dias.
  // NÃO corta acesso. Carimba past_due_since (idempotente, só na 1ª falha
  // pra não resetar o relógio em cada retentativa do Stripe Smart Retries)
  // e dispara o aviso D0 imediato por email + WhatsApp.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as any;
    const custId  = invoice.customer as string;

    // Só age em renovação. Primeira cobrança falha já é tratada pelo próprio
    // checkout (cliente vê o erro na hora e tenta de novo).
    if (invoice.billing_reason === 'subscription_cycle') {
      const customer = await stripe.customers.retrieve(custId) as any;
      if (customer.email) {
        // Idempotência: só carimba past_due_since se ainda for null. Cada
        // retentativa do Stripe dispara payment_failed de novo — sem o
        // guard, o usuário ganhava +7 dias de tolerância a cada falha.
        const { data: updated } = await supabase
          .from('users')
          .update({
            billing_status: 'past_due',
            past_due_since: new Date().toISOString(),
            dunning_last_day_sent: null,
          })
          .eq('email', customer.email)
          .is('past_due_since', null)
          .select('id')
          .maybeSingle();

        // Dispara D0 só na 1ª falha (quando o update acima de fato carimbou).
        if (updated?.id) {
          await sendDunningDay0(updated.id).catch(err =>
            console.error('sendDunningDay0 falhou:', err),
          );
        }
      }
    }
  }

  // Sincronização de status: Stripe muda subscription pra past_due/unpaid.
  // Só ATUALIZA billing_status (sem mexer em past_due_since/dunning — esses
  // são responsabilidade do invoice.payment_failed). Idempotente.
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as any;
    if (sub.status === 'past_due' || sub.status === 'unpaid') {
      const custId   = sub.customer as string;
      const customer = await stripe.customers.retrieve(custId) as any;
      if (customer.email) {
        await supabase
          .from('users')
          .update({ billing_status: 'past_due' })
          .eq('email', customer.email)
          .eq('billing_status', 'active'); // só se ainda estava active — evita
                                            // sobrescrever 'suspended' caso evento chegue fora de ordem
      }
    }
  }

  // Pagamento confirmado (cobrança recorrente OU retry bem-sucedido do
  // Smart Retries durante o dunning) — limpa estado de inadimplência e
  // notifica o cliente.
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as any;
    // 'subscription_create' entrou por causa da oferta SEM trial: nela a primeira
    // fatura chega com esse motivo, e sem ele o espelho 'paid' na UTMify nunca
    // dispararia pra esses clientes — a atribuição de mídia ficaria errada pra
    // sempre (a UTMify não se auto-corrige como o ledger interno).
    if (invoice.billing_reason === 'subscription_cycle'
        || invoice.billing_reason === 'subscription_update'
        || invoice.billing_reason === 'subscription_create') {
      const custId   = invoice.customer as string;
      const customer = await stripe.customers.retrieve(custId) as any;
      if (customer.email) {
        // Só notifica se o usuário estava de fato em dunning (past_due ou suspended).
        const { data: userBefore } = await supabase
          .from('users')
          .select('id, billing_status')
          .eq('email', customer.email)
          .single();

        await supabase
          .from('users')
          .update({
            billing_status: 'active',
            past_due_since: null,
            dunning_last_day_sent: null,
          })
          .eq('email', customer.email);

        const wasDunning = userBefore?.billing_status === 'past_due' || userBefore?.billing_status === 'suspended';
        if (wasDunning && userBefore?.id) {
          await sendDunningRecovered(userBefore.id).catch(err =>
            console.error('sendDunningRecovered falhou:', err),
          );
        }
      }

      // Espelha o pagamento REAL na UTMify → 'paid' (trial converteu ou renovou).
      // Reusa a venda já gravada em `sales` pelo subscription_id: mesmo orderId,
      // mesmos UTMs e o MESMO createdAt do envio 'waiting_payment' → a UTMify só
      // troca o status do pedido (não cria outro) e o SolarDoc passa a contar como
      // venda aprovada, atribuída ao anúncio. À prova de erro (não quebra o webhook).
      if ((invoice.amount_paid ?? 0) > 0 && invoice.subscription) {
        try {
          const subId = invoice.subscription as string;
          const { data: rows } = await supabase
            .from('sales')
            .select('*')
            .eq('subscription_id', subId)
            .order('updated_at', { ascending: false })
            .limit(1);
          const sale = rows?.[0];
          if (sale) {
            await sendUtmifyOrder({
              orderId: subId,
              status: 'paid',
              createdAt: sale.card_passed_at || sale.updated_at || new Date().toISOString(),
              approvedDate: new Date(),
              email: sale.email ?? null,
              name: sale.nome ?? null,
              phone: sale.phone ?? null,
              productId: sale.plano ?? 'solardoc',
              productName: sale.produto ?? 'SolarDoc',
              priceInReais: Number(sale.valor) || 0,
              utm_source: sale.utm_source ?? null,
              utm_medium: sale.utm_medium ?? null,
              utm_campaign: sale.utm_campaign ?? null,
              utm_content: sale.utm_content ?? null,
              utm_term: sale.utm_term ?? null,
            });
          }
        } catch (err) {
          console.error('utmify paid falhou (pagamento intacto):', err);
        }
      }

      // ══════════════════ AVISO DE RENOVAÇÃO (🔄RECORRENTE) ══════════════════
      // A plataforma é mensal: todo mês a Stripe cobra de novo. Até 14/08/2026
      // só a PRIMEIRA cobrança avisava o dono — do 2º mês em diante o dinheiro
      // entrava em silêncio, que é justamente a maior parte dele.
      //
      // SÓ 'subscription_cycle'. Os outros dois motivos que este bloco aceita
      // não são renovação: 'subscription_create' é a primeira fatura (o aviso
      // de VENDA já saiu por ela, e avisar aqui de novo dobraria toda venda
      // nova) e 'subscription_update' é troca de plano no meio do ciclo.
      //
      // O valor vem do que a Stripe COBROU, não do PLAN_MAP: quem entrou com o
      // ACESSO19 pagou R$19 e renova em R$67 — é neste aviso que o Thiago vê
      // que o cliente do cupom ficou.
      if (invoice.billing_reason === 'subscription_cycle' && (invoice.amount_paid ?? 0) > 0) {
        try {
          const custId   = invoice.customer as string;
          const customer = await stripe.customers.retrieve(custId) as any;
          const emailR   = (customer?.email as string | undefined)?.toLowerCase().trim() || null;

          // Tempo de casa = primeira compra deste E-MAIL, não desta assinatura:
          // quem cancelou e voltou (ou tem Customer novo por clique) continua
          // sendo cliente do mesmo tempo. Best-effort — sem isso o aviso sai
          // igual, só sem o "3º mês".
          let desde: string | null = null;
          let produto = 'assinatura';
          if (emailR) {
            const { data: rows } = await supabase
              .from('sales')
              .select('produto, card_passed_at, created_at, phone, nome')
              .eq('email', emailR);
            const datas = (rows ?? [])
              .map((r: any) => (r.card_passed_at || r.created_at) as string | null)
              .filter(Boolean) as string[];
            desde = datas.sort()[0] ?? null;
            produto = (rows ?? [])[0]?.produto || produto;
          }

          await avisarRenovacaoAoDono(invoice.id as string, {
            produto,
            valor: (invoice.amount_paid ?? 0) / 100,
            email: emailR,
            nome: (customer?.name as string | undefined) || null,
            phone: String(customer?.phone || '').replace(/\D/g, '') || null,
            clienteDesde: desde,
          });
        } catch (err) {
          console.error('[renovacao] aviso do dono falhou (cobrança intacta):', err);
        }
      }
    }
  }

  res.json({ received: true });
}

// Customer portal — link assinado pra o cliente atualizar cartão / cancelar
// assinatura. Usado pelo botão "Atualizar pagamento" na tela de suspensão.
export async function createBillingPortal(req: Request, res: Response): Promise<void> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', req.userId)
      .single();

    if (!user?.email) {
      res.status(400).json({ error: 'Usuário não encontrado' });
      return;
    }

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customer = customers.data[0];
    if (!customer) {
      res.status(404).json({ error: 'Nenhuma assinatura encontrada pra esse email' });
      return;
    }

    const dashboardUrl = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${dashboardUrl}/dashboard`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('createBillingPortal error:', err);
    res.status(500).json({ error: 'Falha ao criar sessão do portal' });
  }
}
