const BASE = 'https://graph.facebook.com/v20.0';

export type MetaPeriod = 'today' | 'last_7d' | 'last_30d';

export interface MetaAdsetInsight {
  campaign_id:   string;
  campaign_name: string;
  adset_id:      string;
  adset_name:    string;
  impressions:   number;
  reach:         number;
  clicks:        number;
  spend:         number;   // BRL
  ctr:           number;   // %
  cpc:           number;   // BRL
  purchases:     number;
}

export interface MetaTotals {
  impressions: number;
  reach:       number;
  clicks:      number;
  spend:       number;
  ctr:         number;
  cpc:         number;
  purchases:   number;
}

function extractActions(actions: Array<{ action_type: string; value: string }> | undefined, type: string): number {
  if (!actions) return 0;
  return actions
    .filter(a => a.action_type === type)
    .reduce((s, a) => s + Number(a.value ?? 0), 0);
}

export async function fetchAdsetInsights(
  adAccountId: string,
  token: string,
  period: MetaPeriod = 'today',
): Promise<MetaAdsetInsight[]> {
  const fields = [
    'campaign_id', 'campaign_name',
    'adset_id', 'adset_name',
    'impressions', 'reach', 'clicks', 'spend', 'ctr', 'cpc',
    'actions',
  ].join(',');

  const params = new URLSearchParams({
    fields,
    level: 'adset',
    date_preset: period,
    access_token: token,
  });

  const res  = await fetch(`${BASE}/act_${adAccountId}/insights?${params}`);
  const json = await res.json() as { data?: Record<string, unknown>[]; error?: { message: string } };

  if (json.error) throw new Error(`Meta API: ${json.error.message}`);

  return (json.data ?? []).map(row => ({
    campaign_id:   String(row.campaign_id   ?? ''),
    campaign_name: String(row.campaign_name ?? ''),
    adset_id:      String(row.adset_id      ?? ''),
    adset_name:    String(row.adset_name    ?? ''),
    impressions:   Number(row.impressions   ?? 0),
    reach:         Number(row.reach         ?? 0),
    clicks:        Number(row.clicks        ?? 0),
    spend:         Number(row.spend         ?? 0),
    ctr:           Number(row.ctr           ?? 0),
    cpc:           Number(row.cpc           ?? 0),
    purchases:     extractActions(
      row.actions as Array<{ action_type: string; value: string }> | undefined,
      'purchase'
    ),
  }));
}

export function sumTotals(rows: MetaAdsetInsight[]): MetaTotals {
  const totals = rows.reduce((acc, r) => ({
    impressions: acc.impressions + r.impressions,
    reach:       acc.reach       + r.reach,
    clicks:      acc.clicks      + r.clicks,
    spend:       acc.spend       + r.spend,
    purchases:   acc.purchases   + r.purchases,
  }), { impressions: 0, reach: 0, clicks: 0, spend: 0, purchases: 0 });

  return {
    ...totals,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks      > 0 ? totals.spend / totals.clicks              : 0,
  };
}
