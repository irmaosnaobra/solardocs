import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import {
  fetchMetaEntities, fetchStatuses, gerarOrdens, fetchBudgets,
  type MetaEntity, type MetaDatePreset, type Ordem,
} from '../services/metaAdsFullService';
import { computeAllSignals, type AdsetSignals } from '../services/metaSignalsService';

// ─── GET /admin/meta-ads ─────────────────────────────────────────────────────
// Payload 100% da aba "Meta Ads": campanhas + conjuntos + anúncios (com ROAS,
// compras, CTR, CPC do próprio Meta), ordens de comando, totais, e a escada de
// faturamento acumulado (10k→50k→100k→250k→500k→1M). SÓ LEITURA — não mexe no Meta.

const ESCADA_FATURAMENTO = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

const PRESETS: Record<string, MetaDatePreset> = {
  hoje: 'today', ontem: 'yesterday', '3d': 'last_3d', '7dias': 'last_7d',
  '14dias': 'last_14d', '30dias': 'last_30d', mes: 'this_month', maximo: 'maximum',
};

function agregaTotais(entities: MetaEntity[]) {
  const t = entities.reduce((a, e) => ({
    spend: a.spend + e.spend, impressions: a.impressions + e.impressions,
    clicks: a.clicks + e.clicks, purchases: a.purchases + e.purchases,
    purchase_value: a.purchase_value + e.purchase_value,
  }), { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchase_value: 0 });
  return {
    ...t,
    ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
    cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
    cpa: t.purchases > 0 ? t.spend / t.purchases : 0,
    roas: t.spend > 0 ? t.purchase_value / t.spend : 0,
  };
}

// Metas do dia por produto (Thiago 14/07): LimpaPro R$1200 receita/dia · SolarDoc
// 10 clientes/dia. Env override.
const N_ENV = (v: string | undefined, def: number) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : def);
const META_LIMPAPRO_DIA = N_ENV(process.env.AUX_META_LIMPAPRO, 1200);  // R$/dia
const META_SOLARDOC_DIA  = N_ENV(process.env.AUX_META_SOLARDOC, 10);   // clientes/dia

// Início do dia em BRT (ISO). en-CA + -03:00 (robusto, mesmo padrão do adminController).
function inicioDiaBRT(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return `${ymd}T00:00:00-03:00`;
}

// Faturamento REAL por produto (fonte da verdade = nossas vendas, não pixel Meta):
// acumulado (escada até 1M) + o DIA de hoje (meta diária). SolarDoc: sales.
// LimpaPro: limpapro_events. Metas diferentes por produto.
async function faturamentoPorProduto() {
  const hoje = inicioDiaBRT();
  const [sdTot, lpTot, sdHoje, lpHoje] = await Promise.all([
    supabase.from('sales').select('valor').not('card_passed_at', 'is', null),
    supabase.from('limpapro_events').select('amount_cents').eq('event_type', 'purchase').eq('status', 'paid'),
    supabase.from('sales').select('valor').gte('card_passed_at', hoje).not('card_passed_at', 'is', null),
    supabase.from('limpapro_events').select('amount_cents').eq('event_type', 'purchase').eq('status', 'paid').gte('created_at', hoje),
  ]);
  for (const r of [sdTot, lpTot, sdHoje, lpHoje]) if (r.error) logger.error('meta-ads', 'faturamento produto falhou', r.error);

  const sdAcum = (sdTot.data ?? []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const lpAcum = (lpTot.data ?? []).reduce((s, r) => s + (Number(r.amount_cents) || 0) / 100, 0);
  const sdVendasHoje = sdHoje.data?.length ?? 0;                          // SolarDoc: meta é CONTAGEM
  const sdReceitaHoje = (sdHoje.data ?? []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const lpReceitaHoje = (lpHoje.data ?? []).reduce((s, r) => s + (Number(r.amount_cents) || 0) / 100, 0); // LimpaPro: meta é RECEITA

  return {
    total: sdAcum + lpAcum,
    vendas: (sdTot.data?.length ?? 0) + (lpTot.data?.length ?? 0),
    solardoc: {
      acumulado: sdAcum,
      metaTipo: 'clientes' as const, metaAlvo: META_SOLARDOC_DIA,
      hoje: sdVendasHoje, receitaHoje: sdReceitaHoje,
      escada: montaEscada(sdAcum),
    },
    limpapro: {
      acumulado: lpAcum,
      metaTipo: 'receita' as const, metaAlvo: META_LIMPAPRO_DIA,
      hoje: lpReceitaHoje, vendasHoje: lpHoje.data?.length ?? 0,
      escada: montaEscada(lpAcum),
    },
  };
}

// MAPA DE ORIGEM das vendas SolarDoc (30d). Cruza sales × page_visits pela sessão
// pra saber de onde veio cada venda (pago / orgânico / direto). HONESTO: só Google
// e IG são origem externa CONFIRMADA; direto/interno/sem-sessão viram UMA bucket
// "não capturada" (não são canais). Amostra baixa (<10) = NÃO é conclusão.
// Guard: 1 visita por sessão (distinct on) pra não duplicar venda se page_visits
// virar 1-linha-por-pageview no futuro.
async function mapaOrigemVendas(): Promise<{ buckets: Array<{ origem: string; vendas: number; receita: number; amostraBaixa: boolean }>; totalVendas: number; limpapro: { vendas: number; cego: true } }> {
  const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
  // Vendas SolarDoc 30d + a visita (1 por sessão).
  const { data: vendas } = await supabase
    .from('sales')
    .select('valor, utm_source, utm_medium, attribution_session_id')
    .gte('card_passed_at', desde).not('card_passed_at', 'is', null);

  const sessoes = [...new Set((vendas ?? []).map(v => v.attribution_session_id).filter(Boolean))] as string[];
  const refBySession = new Map<string, string | null>();
  if (sessoes.length) {
    const { data: visitas } = await supabase
      .from('page_visits').select('session_id, referrer').in('session_id', sessoes);
    for (const v of (visitas ?? [])) if (!refBySession.has(v.session_id)) refBySession.set(v.session_id, v.referrer ?? null); // 1ª por sessão
  }

  const classifica = (v: any): string => {
    if (v.utm_medium === 'paid') return '🟠 Pago (Meta Ads)';
    if (v.utm_source) return `🔵 ${v.utm_source}`;
    const ref = (refBySession.get(v.attribution_session_id) || '').toLowerCase();
    if (ref.includes('google')) return '🟢 Google (busca)';
    if (ref.includes('instagram')) return '🟢 Instagram';
    if (ref.includes('youtube')) return '🟢 YouTube';
    // direto, interno (apresentação) e sem-sessão = origem NÃO capturada (não é canal).
    return '⚪ Origem não capturada';
  };

  const agg = new Map<string, { vendas: number; receita: number }>();
  for (const v of (vendas ?? [])) {
    const k = classifica(v);
    const cur = agg.get(k) ?? { vendas: 0, receita: 0 };
    cur.vendas++; cur.receita += Number(v.valor) || 0;
    agg.set(k, cur);
  }
  const buckets = [...agg.entries()]
    .map(([origem, x]) => ({ origem, ...x, amostraBaixa: x.vendas < 10 }))
    .sort((a, b) => b.vendas - a.vendas);

  // LimpaPro: 0% rastreado — origem cega (honesto, não finge).
  const { count: lpCount } = await supabase
    .from('limpapro_events').select('*', { count: 'exact', head: true })
    .eq('event_type', 'purchase').eq('status', 'paid').gte('created_at', desde);

  return { buckets, totalVendas: (vendas ?? []).length, limpapro: { vendas: lpCount ?? 0, cego: true } };
}

function montaEscada(total: number) {
  const degrauAtualIdx = ESCADA_FATURAMENTO.findIndex(v => total < v);
  const alvo = degrauAtualIdx === -1 ? ESCADA_FATURAMENTO[ESCADA_FATURAMENTO.length - 1] : ESCADA_FATURAMENTO[degrauAtualIdx];
  const anterior = degrauAtualIdx <= 0 ? 0 : ESCADA_FATURAMENTO[degrauAtualIdx - 1];
  const progresso = alvo > anterior ? Math.min(100, ((total - anterior) / (alvo - anterior)) * 100) : 100;
  return {
    degraus: ESCADA_FATURAMENTO.map(v => ({ valor: v, atingido: total >= v })),
    alvo, anterior, falta: Math.max(0, alvo - total),
    progresso: Number(progresso.toFixed(1)),
    total,
  };
}

export async function getMetaAds(req: Request, res: Response): Promise<void> {
  const token = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';
  if (!token) {
    res.json({ available: false, reason: 'Configure META_SYSTEM_USER_TOKEN nas variáveis de ambiente.' });
    return;
  }

  const periodo = String(req.query.period || 'hoje');
  const preset = PRESETS[periodo] ?? 'today';

  try {
    // Puxa os 3 níveis do período selecionado (tabela) + os conjuntos em 3d
    // (janela FIXA das ordens) + status + faturamento, em paralelo.
    // IMPORTANTE: as ORDENS sempre usam last_3d — os thresholds (PAUSAR se gastou
    // sem vender, DUPLICAR se ROAS≥2,5) são calibrados em 3 dias. Se usasse o
    // período da tabela, "hoje" mandaria pausar a máquina de ROAS-10x às 15h (0
    // conversão AINDA), e "máximo" mandaria duplicar tudo. Janela fixa = ordem honesta.
    // signals é o "especialista" (trajetória/fadiga/score do histórico diário).
    // Degrada gracioso: se falhar, a aba segue sem os sinais (não derruba tudo).
    const [campaigns, adsets, ads, adsets3d, statusCampaign, statusAdset, statusAd, faturamento, signals, mapaOrigem] = await Promise.all([
      fetchMetaEntities('campaign', preset),
      fetchMetaEntities('adset', preset),
      fetchMetaEntities('ad', preset),
      fetchMetaEntities('adset', 'last_3d'),
      fetchStatuses('campaign'),
      fetchStatuses('adset'),
      fetchStatuses('ad'),
      faturamentoPorProduto(),
      computeAllSignals(14).catch(err => { logger.error('meta-ads', 'signals falhou (segue sem)', err); return new Map<string, AdsetSignals>(); }),
      mapaOrigemVendas().catch(err => { logger.error('meta-ads', 'mapa origem falhou (segue sem)', err); return null; }),
    ]);

    // Carimba status em cada entidade.
    for (const c of campaigns) c.status = statusCampaign[c.id] ?? '';
    for (const a of adsets)    a.status = statusAdset[a.id] ?? '';
    for (const a of ads)       a.status = statusAd[a.id] ?? '';

    // Anexa os sinais de especialista em cada conjunto (tabela) e nas ordens.
    const adsetsComSinal = adsets.map(a => ({ ...a, signals: signals.get(a.id) ?? null }));
    // Cérebro único: ordens vêm do veredito multi-janela (signals), não de 3d.
    // budgets → CBO vira 1 ordem por campanha (não duplica por conjunto).
    const budgets = await fetchBudgets().catch(() => new Map());
    const ordens: Ordem[] = gerarOrdens(adsets3d, signals, budgets).map(o => ({ ...o, signals: signals.get(o.entity.id) ?? null }));
    const totais = agregaTotais(campaigns);
    const escada = montaEscada(faturamento.total);  // escada SOMADA (jornada total) — mantida

    // Contadores de ordem pra badge no topo.
    const resumoOrdens = ordens.reduce((acc, o) => { acc[o.tipo] = (acc[o.tipo] ?? 0) + 1; return acc; }, {} as Record<string, number>);

    res.json({
      available: true,
      periodo,
      atualizadoEm: new Date().toISOString(),
      conta: (process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250').replace('act_', ''),
      totais,
      campaigns,
      adsets: adsetsComSinal,
      ads,
      ordens,
      resumoOrdens,
      faturamento,
      escada,
      mapaOrigem,
    });
  } catch (err: any) {
    logger.error('meta-ads', 'getMetaAds falhou', err);
    res.status(500).json({ available: false, reason: String(err?.message || err) });
  }
}
