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

// Faturamento acumulado REAL (fonte da verdade = nossas vendas, não pixel Meta).
// SolarDoc: tabela sales. LimpaPro: limpapro_events. Soma tudo desde sempre.
async function faturamentoAcumulado(): Promise<{ total: number; solardoc: number; limpapro: number; vendas: number }> {
  const [sd, lp] = await Promise.all([
    supabase.from('sales').select('valor').not('card_passed_at', 'is', null),
    supabase.from('limpapro_events').select('amount_cents').eq('event_type', 'purchase').eq('status', 'paid'),
  ]);
  if (sd.error) logger.error('meta-ads', 'faturamento sales falhou', sd.error);
  if (lp.error) logger.error('meta-ads', 'faturamento limpapro falhou', lp.error);
  const solardoc = (sd.data ?? []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const limpapro = (lp.data ?? []).reduce((s, r) => s + (Number(r.amount_cents) || 0) / 100, 0);
  const vendas = (sd.data?.length ?? 0) + (lp.data?.length ?? 0);
  return { total: solardoc + limpapro, solardoc, limpapro, vendas };
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
    const [campaigns, adsets, ads, adsets3d, statusCampaign, statusAdset, statusAd, faturamento, signals] = await Promise.all([
      fetchMetaEntities('campaign', preset),
      fetchMetaEntities('adset', preset),
      fetchMetaEntities('ad', preset),
      fetchMetaEntities('adset', 'last_3d'),
      fetchStatuses('campaign'),
      fetchStatuses('adset'),
      fetchStatuses('ad'),
      faturamentoAcumulado(),
      computeAllSignals(14).catch(err => { logger.error('meta-ads', 'signals falhou (segue sem)', err); return new Map<string, AdsetSignals>(); }),
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
    const escada = montaEscada(faturamento.total);

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
    });
  } catch (err: any) {
    logger.error('meta-ads', 'getMetaAds falhou', err);
    res.status(500).json({ available: false, reason: String(err?.message || err) });
  }
}
