import { supabase } from '../utils/supabase';
import { sendMetaEvent } from '../utils/metaPixel';
import { logger } from '../utils/logger';

const APP_URL = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

export interface SaleInput {
  checkout_session_id: string;
  subscription_id?: string | null;
  customer_id?: string | null;
  email?: string | null;
  nome?: string | null;
  phone?: string | null;
  plano: string;
  produto: string;
  valor: number;
  status?: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  attribution_session_id?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  /** código do cupom aplicado no checkout — é o carimbo do follow-up */
  cupom?: string | null;
  /** houve desconto na sessão. Vale MAIS que o código: o código pode não
   *  resolver (digitado no checkout, lookup na Stripe falhou) e o desconto não. */
  comDesconto?: boolean;
  card_passed_at?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DE ONDE A VENDA CHEGOU
//
// A origem continua sendo classificada (anúncio, follow-up, direto) só para o
// painel "De onde chegaram as vendas" e para o aviso do WhatsApp. Desde
// 29/10/2026 ela NÃO decide mais o envio ao Meta: toda venda vai (ver
// decisaoMeta). Até 14/08 o follow-up ficava de fora do pixel.
//
// O CUPOM manda mais que o fbc: quem clicou no anúncio, não comprou, e só fechou
// depois que a Giovanna mandou o código, foi fechado pelo follow-up.
// ─────────────────────────────────────────────────────────────────────────────

export type OrigemVenda = 'anuncio' | 'followup' | 'direto';

// utm_source dos nossos toques. `linkFollowup()` carimba 'followup'; os outros
// são apelidos que já circulam em link escrito à mão — cobrir todos custa nada.
const FOLLOWUP_SOURCES = new Set([
  'followup', 'follow-up', 'follow_up', 'whatsapp', 'wa', 'zap',
  'giovanna', 'bia', 'recuperacao', 'recuperação', 'abandono',
  'dunning', 'winback', 'sdr', 'crm', 'email', 'e-mail',
]);

const ANUNCIO_SOURCES = new Set([
  'fb', 'facebook', 'ig', 'instagram', 'meta', 'fbads', 'facebook_ads',
  'meta_ads', 'instagram_ads', 'an', 'audience_network',
]);

const ANUNCIO_MEDIUMS = new Set([
  'ads', 'ad', 'paid', 'cpc', 'ppc', 'paidsocial', 'paid_social', 'social_paid',
]);

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export type Classificacao = { origem: OrigemVenda; detalhe: string };

/**
 * Classifica a venda pela atribuição que sobrou nela. PURA — o gate do Meta, o
 * aviso do dono e o painel leem esta mesma função, senão um deles conta uma
 * história que o outro não seguiu.
 */
export function classificarOrigem(s: {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  cupom?: string | null;
  comDesconto?: boolean;
}): Classificacao {
  const source   = norm(s.utm_source);
  const medium   = norm(s.utm_medium);
  const campanha = String(s.utm_campaign ?? '').trim();
  const cupom    = String(s.cupom ?? '').trim().toUpperCase();

  // DESCONTO manda, com ou sem código. O código pode não resolver (o cupom
  // DIGITADO no checkout depende de um lookup na Stripe que pode falhar), e é
  // justamente aí que a venda de R$ 19 escaparia pro pixel como se fosse do
  // anúncio — que foi o evento que abriu esta investigação em 14/08.
  if (cupom || s.comDesconto) {
    return { origem: 'followup', detalhe: cupom ? `cupom ${cupom}` : 'desconto no checkout' };
  }

  if (FOLLOWUP_SOURCES.has(source) || FOLLOWUP_SOURCES.has(medium)) {
    return { origem: 'followup', detalhe: [source || medium, campanha].filter(Boolean).join(' · ') };
  }

  // Campanha só de dígitos = id de campanha do Meta (é o que a LP recebe do
  // anúncio). fbc/fbp = clique/browser id do Meta: prova de que veio de lá.
  const idDeCampanhaMeta = /^\d{6,}$/.test(campanha);
  if (s.fbc || s.fbp || ANUNCIO_SOURCES.has(source) || ANUNCIO_MEDIUMS.has(medium) || idDeCampanhaMeta) {
    return {
      origem: 'anuncio',
      detalhe: campanha ? `campanha ${campanha}` : (source || (s.fbc ? 'clique do Meta' : 'pixel')),
    };
  }

  return { origem: 'direto', detalhe: campanha ? `campanha ${campanha}` : 'sem UTM' };
}

export type MotivoSkip = 'teste' | 'duplicada';
/** Motivos que linhas ANTIGAS do banco ainda carregam (regra de 14/08/2026, extinta em 29/10/2026). */
export type MotivoSkipAntigo = 'followup' | 'recompra';

/** Janela em que o mesmo e-mail pagando de novo é cobrança repetida, não venda. */
export const JANELA_DUPLICADA_MS = 24 * 60 * 60 * 1000;

/** Teste do dono: a página abre com utm_source=raio-x-teste (também aceito em campaign/medium). */
export const UTM_VENDA_TESTE = 'raio-x-teste';
export function ehVendaDeTeste(s: {
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null;
}): boolean {
  return [s.utm_source, s.utm_medium, s.utm_campaign].some((v) => norm(v) === UTM_VENDA_TESTE);
}

/**
 * Esta venda vira Purchase no Meta?
 *
 * SIM, sempre, exceto em dois casos (ordem do dono, 29/10/2026): venda de teste
 * e cobrança repetida do mesmo e-mail em menos de 24 h. Follow-up e recompra
 * agora vão: quem decide se o anúncio leva o crédito é a janela de atribuição
 * do Meta, não a gente. `direto` (sem UTM) também vai.
 */
export function decisaoMeta(args: { teste: boolean; duplicada: boolean }):
  { envia: boolean; motivo: MotivoSkip | null } {
  if (args.teste)     return { envia: false, motivo: 'teste' };
  if (args.duplicada) return { envia: false, motivo: 'duplicada' };
  return { envia: true, motivo: null };
}

export const TEXTO_MOTIVO: Record<MotivoSkip | MotivoSkipAntigo, string> = {
  teste:     'venda de teste',
  duplicada: 'mesmo e-mail pagou de novo em menos de 24 h',
  // linhas antigas do banco ainda têm estes motivos
  followup:  'fechada no follow-up',
  recompra:  'este e-mail já tinha comprado',
};

export const TEXTO_ORIGEM: Record<OrigemVenda, string> = {
  anuncio:  'Anúncio',
  followup: 'Follow-up',
  direto:   'Direto/orgânico',
};

// Upsert idempotente por checkout_session_id (1 venda por cartão-passado).
// Só grava campos PRESENTES — re-entrega do webhook sem metadata NÃO apaga a
// atribuição/meta já gravada (colunas omitidas ficam intactas no ON CONFLICT).
export async function upsertSale(s: SaleInput): Promise<string | null> {
  const row: Record<string, unknown> = {
    checkout_session_id: s.checkout_session_id,
    plano:   s.plano,
    produto: s.produto,
    valor:   s.valor,
    status:  s.status || 'trialing',
    updated_at: new Date().toISOString(),
  };
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') row[k] = v; };
  put('subscription_id', s.subscription_id);
  put('customer_id', s.customer_id);
  put('email', s.email ? String(s.email).toLowerCase().trim() : null);
  put('nome', s.nome);
  put('phone', s.phone);
  put('utm_source', s.utm_source);
  put('utm_medium', s.utm_medium);
  put('utm_campaign', s.utm_campaign);
  put('utm_content', s.utm_content);
  put('utm_term', s.utm_term);
  put('attribution_session_id', s.attribution_session_id);
  put('fbc', s.fbc);
  put('fbp', s.fbp);
  put('card_passed_at', s.card_passed_at);

  // A origem é derivada, e obedece à MESMA regra das outras colunas aqui: só
  // entra no patch quando veio sinal. Uma re-entrega do webhook sem metadata
  // (at-least-once) recalcularia 'direto' e apagaria o 'anuncio' já gravado.
  const temSinal = !!(s.cupom || s.comDesconto || s.utm_source || s.utm_medium || s.utm_campaign || s.fbc || s.fbp);
  const cls = classificarOrigem(s);
  if (temSinal) {
    row.origem = cls.origem;
    row.origem_detalhe = cls.detalhe;
  }

  const { data, error } = await supabase
    .from('sales')
    .upsert(row, { onConflict: 'checkout_session_id' })
    .select('id')
    .single();
  if (error) { logger.error('sales', 'upsertSale falhou', error); return null; }

  // Venda sem sinal nenhum É 'direto' — mas só na PRIMEIRA gravação (`.is null`).
  // Sem este carimbo ela ficaria NULL e o painel a contaria como "venda antiga",
  // que é outra coisa.
  if (!temSinal && data?.id) {
    await supabase.from('sales')
      .update({ origem: 'direto', origem_detalhe: 'sem UTM' })
      .eq('id', data.id)
      .is('origem', null);
  }
  return data?.id ?? null;
}

/**
 * Este e-mail teve OUTRA venda nas 24 horas ANTES desta?
 *
 * Compara por TEMPO, não por "existe outra linha": o cron pode reprocessar uma
 * venda velha depois de uma nova ter entrado, e sem a comparação a primeira
 * cobrança viraria "duplicada" retroativamente. Só conta linha estritamente
 * anterior e a menos de 24 h (exatamente 24 h já é venda nova). Linha que foi
 * pulada por teste ou por duplicidade não conta: não foi venda de verdade.
 *
 * Falha de banco devolve `false` (= não é duplicada): perder um Purchase
 * legítimo é pior que mandar um a mais, e o erro fica no log.
 */
async function temVendaNas24hAnteriores(email: string, saleIdAtual: string): Promise<boolean> {
  const { data: atual } = await supabase
    .from('sales').select('card_passed_at, created_at').eq('id', saleIdAtual).single();
  const t = (r: { card_passed_at?: string | null; created_at?: string | null } | null) =>
    new Date(r?.card_passed_at || r?.created_at || 0).getTime();
  const tAtual = t(atual);
  if (!tAtual) return false;

  const { data, error } = await supabase
    .from('sales')
    .select('id, card_passed_at, created_at, meta_skip_motivo')
    .eq('email', email)
    .neq('id', saleIdAtual);
  if (error) {
    logger.error('sales', 'não deu pra conferir venda anterior do e-mail — tratando como venda nova', error);
    return false;
  }
  return (data ?? []).some((r) => {
    if (r.meta_skip_motivo === 'duplicada' || r.meta_skip_motivo === 'teste') return false;
    const tr = t(r);
    return !!tr && tr < tAtual && tAtual - tr < JANELA_DUPLICADA_MS;
  });
}

// user agent e IP do navegador da LP, para o Meta casar a venda com a pessoa.
// Opcional: qualquer falha devolve vazio e o Purchase sai sem eles.
async function navegadorDaSessao(sessionId: string | null | undefined): Promise<{ userAgent?: string; ip?: string }> {
  const sid = String(sessionId ?? '').trim();
  if (!sid || !/^[\w.:-]{1,100}$/.test(sid)) return {};
  try {
    const { data } = await supabase.from('page_visits').select('user_agent, ip')
      .eq('session_id', sid).order('created_at', { ascending: true }).limit(1);
    const v = (data?.[0] ?? null) as { user_agent?: string | null; ip?: string | null } | null;
    return { userAgent: v?.user_agent || undefined, ip: v?.ip || undefined };
  } catch {
    return {};
  }
}

// Dispara o Purchase pro Meta com a MELHOR correspondência possível (email +
// telefone + external_id + nome + fbc/fbp + ip/user agent da LP) e grava o status
// na linha. Idempotente por event_id (= checkout_session_id): reenviar NÃO
// duplica (Meta faz dedup).
export async function sendPurchaseForSale(saleId: string): Promise<boolean> {
  const { data: sale } = await supabase.from('sales').select('*').eq('id', saleId).single();
  if (!sale) return false;

  // ── TODA VENDA VAI AO META (29/10/2026) ────────────────────────────────────
  // Ordem do dono: antes só chegavam 4 de ~28 vendas desde 01/09, porque o gate
  // de 14/08 barrava follow-up (cupom/link da Giovanna) e recompra. Agora o
  // follow-up e a recompra também viram Purchase; quem decide se o anúncio leva
  // o crédito é a janela de atribuição do Meta. Só duas portas ficam fechadas:
  //   • teste     — utm_source = raio-x-teste: é o dono testando;
  //   • duplicada — o mesmo e-mail tem OUTRA venda nas 24 h anteriores: é
  //     cobrança repetida (checkout tentado 3x), não venda.
  // A renovação mensal continua fora: ela nem passa por aqui.
  //
  // O skip grava ESTADO TERMINAL (meta_response_ok = true + motivo). Sem isso o
  // reDrivePendingPurchases varreria a linha amanhã e mandaria pro Meta
  // justamente o que a gente decidiu não mandar.
  const teste = ehVendaDeTeste(sale);
  const duplicada = !teste && sale.email ? await temVendaNas24hAnteriores(sale.email, saleId) : false;
  const { envia, motivo } = decisaoMeta({ teste, duplicada });

  if (!envia) {
    await supabase.from('sales').update({
      meta_response_ok:      true,
      meta_skip_motivo:      motivo,
      meta_purchase_sent_at: new Date().toISOString(),
      meta_event_id:         sale.checkout_session_id,
      updated_at:            new Date().toISOString(),
    }).eq('id', saleId);
    logger.info('sales', `Purchase NÃO enviado (${motivo}) — venda ${saleId} segue só no painel e no WhatsApp`);
    return true;
  }

  const nome = (sale.nome || '').trim();
  const first = nome.split(/\s+/)[0] || undefined;
  const last  = nome.split(/\s+/).slice(1).join(' ') || undefined;
  const nav = await navegadorDaSessao(sale.attribution_session_id);

  const res = await sendMetaEvent('Purchase', {
    eventId:    sale.checkout_session_id,
    email:      sale.email || undefined,
    phone:      sale.phone || undefined,
    firstName:  first,
    lastName:   last,
    externalId: sale.email || sale.customer_id || undefined,
    fbc:        sale.fbc || undefined,
    fbp:        sale.fbp || undefined,
    ip:         nav.ip,
    userAgent:  nav.userAgent,
    eventTime:  sale.card_passed_at ? Math.floor(new Date(sale.card_passed_at).getTime() / 1000) : undefined,
    sourceUrl:  APP_URL,
    customData: { value: Number(sale.valor) || 0, currency: 'BRL', content_name: sale.produto },
  });

  // meta_skip_motivo volta a null em QUALQUER tentativa de envio (ok ou não): a
  // linha pulada pela regra antiga (followup/recompra) sai do estado "pulada" e,
  // se o Meta recusar, cai na fila normal de pendentes do re-drive.
  await supabase.from('sales').update({
    meta_response_ok:      res.ok,
    meta_skip_motivo:      null,
    meta_purchase_sent_at: new Date().toISOString(),
    meta_event_id:         sale.checkout_session_id,
    meta_attempts:         (sale.meta_attempts ?? 0) + 1,
    updated_at:            new Date().toISOString(),
  }).eq('id', saleId);

  return res.ok;
}

// RE-DRIVE: reenvia Purchases que ainda não confirmaram entrega (falha de rede/
// token, freeze serverless, ou backfill retroativo) e as que a regra ANTIGA
// pulou (meta_skip_motivo followup/recompra) — estas passam pela decisão nova.
// O Meta REJEITA evento com mais de 7 dias, então só tenta card_passed_at nos
// últimos 7 dias. Cap de 6 tentativas por venda pra não repetir infinitamente
// um evento que sempre falha.
export async function reDrivePendingPurchases(): Promise<{ tried: number; ok: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pend } = await supabase
    .from('sales')
    .select('id')
    .eq('meta_response_ok', false)
    .gte('card_passed_at', sevenDaysAgo)
    .lt('meta_attempts', 6)
    .limit(100);
  const { data: puladas } = await supabase
    .from('sales')
    .select('id')
    .in('meta_skip_motivo', ['followup', 'recompra'])
    .gte('card_passed_at', sevenDaysAgo)
    // O .lt do PostgREST descarta NULL; linha pulada pode nunca ter tido tentativa gravada.
    .or('meta_attempts.is.null,meta_attempts.lt.6')
    .limit(100);
  const ids = [...new Set([...(pend ?? []), ...(puladas ?? [])].map((p) => p.id as string))];
  if (!ids.length) return { tried: 0, ok: 0 };
  let ok = 0;
  for (const id of ids) { if (await sendPurchaseForSale(id)) ok++; }
  logger.info('sales', `re-drive Purchase: ${ok}/${ids.length} confirmados`);
  return { tried: ids.length, ok };
}
