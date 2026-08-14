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
  card_passed_at?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DE ONDE A VENDA CHEGOU
//
// Decisão do Thiago em 14/08/2026: o Meta só recebe VENDA NOVA. Venda que o
// follow-up fechou (cupom da Giovanna, link de recuperação/dunning/winback)
// aparece só aqui dentro e no aviso do WhatsApp — o pixel não pode aprender que
// aquilo foi o anúncio, senão ele otimiza pro público que a gente já tinha.
//
// O CUPOM manda mais que o fbc: quem clicou no anúncio, não comprou, e só fechou
// depois que a Giovanna mandou o código, foi fechado pelo follow-up. Essa é a
// venda que o Meta contava como dele.
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
}): Classificacao {
  const source   = norm(s.utm_source);
  const medium   = norm(s.utm_medium);
  const campanha = String(s.utm_campaign ?? '').trim();
  const cupom    = String(s.cupom ?? '').trim().toUpperCase();

  if (cupom) return { origem: 'followup', detalhe: `cupom ${cupom}` };

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

export type MotivoSkip = 'followup' | 'recompra';

/**
 * Esta venda vira Purchase no Meta?
 *
 * SIM só pra venda NOVA que não foi fechada pelo follow-up. `direto` (sem UTM
 * nenhuma) CONTINUA indo: é venda nova de verdade — o que ela não tem é rastro,
 * e cortar o pixel por falta de rastro apagaria metade da aquisição orgânica.
 */
export function decisaoMeta(args: { origem: OrigemVenda; clienteNovo: boolean }):
  { envia: boolean; motivo: MotivoSkip | null } {
  if (args.origem === 'followup') return { envia: false, motivo: 'followup' };
  if (!args.clienteNovo)          return { envia: false, motivo: 'recompra' };
  return { envia: true, motivo: null };
}

export const TEXTO_MOTIVO: Record<MotivoSkip, string> = {
  followup: 'fechada no follow-up',
  recompra: 'este e-mail já tinha comprado',
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
  const temSinal = !!(s.cupom || s.utm_source || s.utm_medium || s.utm_campaign || s.fbc || s.fbp);
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
 * Este e-mail já tinha comprado ANTES desta venda?
 *
 * Compara por TEMPO, não por "existe outra linha": o cron pode reprocessar uma
 * venda velha depois de uma nova ter entrado, e sem a comparação a primeira
 * compra da pessoa viraria "recompra" retroativamente.
 *
 * Falha de banco devolve `false` (= trata como cliente novo): perder um Purchase
 * legítimo é pior que mandar um a mais, e o erro fica no log.
 */
async function temVendaAnterior(email: string, saleIdAtual: string): Promise<boolean> {
  const { data: atual } = await supabase
    .from('sales').select('card_passed_at, created_at').eq('id', saleIdAtual).single();
  const t = (r: { card_passed_at?: string | null; created_at?: string | null } | null) =>
    new Date(r?.card_passed_at || r?.created_at || 0).getTime();
  const tAtual = t(atual);

  const { data, error } = await supabase
    .from('sales')
    .select('id, card_passed_at, created_at')
    .eq('email', email)
    .neq('id', saleIdAtual);
  if (error) {
    logger.error('sales', 'não deu pra conferir compra anterior — tratando como cliente novo', error);
    return false;
  }
  return (data ?? []).some((r) => t(r) < tAtual);
}

// Dispara o Purchase pro Meta com a MELHOR correspondência possível (email +
// telefone + external_id + nome + fbc/fbp) e grava o status na linha. Idempotente
// por event_id (= checkout_session_id): reenviar NÃO duplica (Meta faz dedup).
export async function sendPurchaseForSale(saleId: string): Promise<boolean> {
  const { data: sale } = await supabase.from('sales').select('*').eq('id', saleId).single();
  if (!sale) return false;

  // ── O PIXEL SÓ RECEBE VENDA NOVA (14/08/2026) ──────────────────────────────
  // Duas portas se fecham aqui:
  //   • follow-up  — cupom/link nosso: quem fechou foi a Giovanna, não o anúncio;
  //   • recompra   — este e-mail JÁ tem linha no ledger (inclusive a pessoa que
  //     tentou o checkout 3x, que era o caso do dedup de 30 dias que isto
  //     substitui — agora sem janela: comprou uma vez, conta uma vez).
  //
  // O skip grava ESTADO TERMINAL (meta_response_ok = true + motivo). Sem isso o
  // reDrivePendingPurchases varreria a linha amanhã e mandaria pro Meta
  // justamente o que a gente decidiu não mandar.
  const clienteNovo = sale.email ? !(await temVendaAnterior(sale.email, saleId)) : true;
  // Linha antiga (anterior à migração) não tem `origem` gravada — reclassifica
  // na hora pelo que ela guardou de UTM/fbc.
  const origem: OrigemVenda = (sale.origem as OrigemVenda | null) ?? classificarOrigem(sale).origem;
  const { envia, motivo } = decisaoMeta({ origem, clienteNovo });

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

  const res = await sendMetaEvent('Purchase', {
    eventId:    sale.checkout_session_id,
    email:      sale.email || undefined,
    phone:      sale.phone || undefined,
    firstName:  first,
    lastName:   last,
    externalId: sale.email || sale.customer_id || undefined,
    fbc:        sale.fbc || undefined,
    fbp:        sale.fbp || undefined,
    eventTime:  sale.card_passed_at ? Math.floor(new Date(sale.card_passed_at).getTime() / 1000) : undefined,
    sourceUrl:  APP_URL,
    customData: { value: Number(sale.valor) || 0, currency: 'BRL', content_name: sale.produto },
  });

  await supabase.from('sales').update({
    meta_response_ok:      res.ok,
    meta_purchase_sent_at: new Date().toISOString(),
    meta_event_id:         sale.checkout_session_id,
    meta_attempts:         (sale.meta_attempts ?? 0) + 1,
    updated_at:            new Date().toISOString(),
  }).eq('id', saleId);

  return res.ok;
}

// RE-DRIVE: reenvia Purchases que ainda não confirmaram entrega (falha de rede/
// token, freeze serverless, ou backfill retroativo). O Meta REJEITA evento com
// mais de 7 dias, então só tenta card_passed_at nos últimos 7 dias. Cap de 6
// tentativas por venda pra não repetir infinitamente um evento que sempre falha.
export async function reDrivePendingPurchases(): Promise<{ tried: number; ok: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pend } = await supabase
    .from('sales')
    .select('id')
    .eq('meta_response_ok', false)
    .gte('card_passed_at', sevenDaysAgo)
    .lt('meta_attempts', 6)
    .limit(100);
  if (!pend?.length) return { tried: 0, ok: 0 };
  let ok = 0;
  for (const p of pend) { if (await sendPurchaseForSale(p.id)) ok++; }
  logger.info('sales', `re-drive Purchase: ${ok}/${pend.length} confirmados`);
  return { tried: pend.length, ok };
}
