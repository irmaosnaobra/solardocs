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
  card_passed_at?: string | null;
}

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

  const { data, error } = await supabase
    .from('sales')
    .upsert(row, { onConflict: 'checkout_session_id' })
    .select('id')
    .single();
  if (error) { logger.error('sales', 'upsertSale falhou', error); return null; }
  return data?.id ?? null;
}

// Dispara o Purchase pro Meta com a MELHOR correspondência possível (email +
// telefone + external_id + nome + fbc/fbp) e grava o status na linha. Idempotente
// por event_id (= checkout_session_id): reenviar NÃO duplica (Meta faz dedup).
export async function sendPurchaseForSale(saleId: string): Promise<boolean> {
  const { data: sale } = await supabase.from('sales').select('*').eq('id', saleId).single();
  if (!sale) return false;

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
