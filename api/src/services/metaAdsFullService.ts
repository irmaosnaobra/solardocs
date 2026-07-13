// ─── Meta Ads FULL — puxa a foto completa da conta pra aba "Meta Ads" ────────
// Diferente do metaAdsService (só adset) e do monitorCriativos (só ad ativo),
// este traz campanha + conjunto + anúncio COM ROAS e compras calculados PELO
// PRÓPRIO META (action_values / purchase_roas). Isso funciona pros 2 produtos
// (LimpaPro e SolarDoc) sem depender da atribuição UTM do Supabase — que é
// furada na LimpaPro. O Supabase entra só pra receita-vs-meta e "qual criativo
// vendeu" (forte no SolarDoc). Ver memória limpasolar-copiloto-trafego.

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';
const ACCOUNT = process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250';

export type MetaLevel = 'campaign' | 'adset' | 'ad';
export type MetaDatePreset = 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'maximum';

// Campanhas de LEAD (não venda) — 0 compra é NORMAL. Match por substring no nome.
const LEAD_HINTS = (process.env.AUX_LEAD_HINTS || 'forms,lead,formul')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export function isLeadCampaign(name: string): boolean {
  const n = (name || '').toLowerCase();
  return LEAD_HINTS.some(h => n.includes(h));
}

export interface MetaEntity {
  level: MetaLevel;
  id: string;
  name: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  status: string;            // effective_status (ACTIVE, PAUSED, ...)
  is_lead: boolean;          // campanha de lead → não julgar por venda
  spend: number;             // R$
  impressions: number;
  clicks: number;
  ctr: number;               // %
  cpc: number;               // R$
  cpm: number;               // R$
  purchases: number;         // compras (pixel, do próprio Meta)
  purchase_value: number;    // receita atribuída pelo Meta (R$)
  roas: number;              // purchase_value / spend
  cpa: number;               // custo por compra = spend / purchases
  frequency: number;
}

function extractAction(actions: any[] | undefined, matcher: (t: string) => boolean): number {
  if (!Array.isArray(actions)) return 0;
  return actions.filter(a => typeof a.action_type === 'string' && matcher(a.action_type))
    .reduce((s, a) => s + (Number(a.value) || 0), 0);
}

// Puxa insights de um nível com todos os campos que importam. Ordena por gasto.
export async function fetchMetaEntities(level: MetaLevel, preset: MetaDatePreset): Promise<MetaEntity[]> {
  if (!TOKEN) throw new Error('META token ausente (META_SYSTEM_USER_TOKEN)');

  const baseFields = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency', 'actions', 'action_values'];
  const idFields =
    level === 'campaign' ? ['campaign_id', 'campaign_name']
    : level === 'adset'  ? ['campaign_id', 'campaign_name', 'adset_id', 'adset_name']
    : ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'];
  const fields = [...idFields, ...baseFields].join(',');

  const url = `${GRAPH}/${ACCOUNT}/insights?level=${level}&date_preset=${preset}` +
    `&fields=${fields}&limit=500&access_token=${TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta insights ${res.status}: ${(await res.text()).slice(0, 250)}`);
  const json = await res.json() as { data?: any[]; error?: { message: string } };
  if (json.error) throw new Error(`Meta API: ${json.error.message}`);

  const rows = (json.data ?? []).map((r): MetaEntity => {
    const spend = Number(r.spend) || 0;
    const purchases = extractAction(r.actions, t => t.includes('purchase'));
    const purchase_value = extractAction(r.action_values, t => t.includes('purchase'));
    const campaign_name = String(r.campaign_name ?? '');
    const id = level === 'campaign' ? String(r.campaign_id ?? '') : level === 'adset' ? String(r.adset_id ?? '') : String(r.ad_id ?? '');
    const name = level === 'campaign' ? campaign_name : level === 'adset' ? String(r.adset_name ?? '') : String(r.ad_name ?? '');
    return {
      level, id, name,
      campaign_id: String(r.campaign_id ?? ''), campaign_name,
      adset_id: level !== 'campaign' ? String(r.adset_id ?? '') : undefined,
      adset_name: level !== 'campaign' ? String(r.adset_name ?? '') : undefined,
      status: '',  // preenchido depois (insights não traz status) — resolvido via /entities se preciso
      is_lead: isLeadCampaign(campaign_name),
      spend,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      ctr: Number(r.ctr) || 0,
      cpc: Number(r.cpc) || 0,
      cpm: Number(r.cpm) || 0,
      purchases,
      purchase_value,
      roas: spend > 0 ? purchase_value / spend : 0,
      cpa: purchases > 0 ? spend / purchases : 0,
      frequency: Number(r.frequency) || 0,
    };
  });

  return rows.sort((a, b) => b.spend - a.spend);
}

// Busca o effective_status dos conjuntos/anúncios/campanhas (insights não traz).
// 1 chamada por nível — barato. Retorna mapa id→status.
export async function fetchStatuses(level: MetaLevel): Promise<Record<string, string>> {
  if (!TOKEN) return {};
  const edge = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  const url = `${GRAPH}/${ACCOUNT}/${edge}?fields=id,effective_status&limit=500&access_token=${TOKEN}`;
  try {
    const res = await fetch(url);
    const json = await res.json() as { data?: any[] };
    const map: Record<string, string> = {};
    for (const r of (json.data ?? [])) map[String(r.id)] = String(r.effective_status ?? '');
    return map;
  } catch { return {}; }
}

// ── Ordens de comando: converte números em AÇÃO recomendada ──────────────────
export type OrdemTipo = 'DUPLICAR' | 'AUMENTAR' | 'PAUSAR' | 'OBSERVAR' | 'MANTER';
export interface Ordem {
  tipo: OrdemTipo;
  entity: MetaEntity;
  motivo: string;       // por que essa ordem
  comoFazer: string;    // instrução em português simples
  prioridade: number;   // pra ordenar (menor = mais urgente)
}

const N = (v: string | undefined, def: number) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : def);
const DUP_ROAS   = N(process.env.AUX_DUP_ROAS, 2.5);
const DUP_VENDAS = N(process.env.AUX_DUP_VENDAS, 2);
const UP_ROAS    = N(process.env.AUX_UP_ROAS, 1.8);
const UP_VENDAS  = N(process.env.AUX_UP_VENDAS, 1);
const PAUSE_TICKET = N(process.env.AUX_TICKET, 45) * N(process.env.AUX_PAUSE_FATOR, 1.5);

// Gera ordens a partir dos CONJUNTOS (nível de decisão de orçamento).
export function gerarOrdens(adsets: MetaEntity[]): Ordem[] {
  const ordens: Ordem[] = [];
  for (const e of adsets) {
    // Campanha de lead: métrica é lead, não venda → só observa se gasta muito.
    if (e.is_lead) {
      if (e.spend >= PAUSE_TICKET * 2) {
        ordens.push({ tipo: 'OBSERVAR', entity: e, prioridade: 5,
          motivo: `campanha de LEAD gastou R$${e.spend.toFixed(0)} — confira custo por lead no Gerenciador`,
          comoFazer: 'É lead, não venda: abra a coluna "Custo por resultado" e veja se o lead tá saindo caro.' });
      }
      continue;
    }
    // DUPLICAR: ROAS forte + volume.
    if (e.purchases >= DUP_VENDAS && e.roas >= DUP_ROAS) {
      ordens.push({ tipo: 'DUPLICAR', entity: e, prioridade: 1,
        motivo: `ROAS ${e.roas.toFixed(1)}x · ${e.purchases} compras · CPA R$${e.cpa.toFixed(0)}`,
        comoFazer: 'Botão "..." no conjunto → Duplicar. Deixe os 2 rodando lado a lado por 3 dias.' });
    }
    // AUMENTAR 30%: ROAS bom, ainda não no nível de duplicar.
    else if (e.purchases >= UP_VENDAS && e.roas >= UP_ROAS) {
      ordens.push({ tipo: 'AUMENTAR', entity: e, prioridade: 2,
        motivo: `ROAS ${e.roas.toFixed(1)}x · ${e.purchases} compra(s) · CPA R$${e.cpa.toFixed(0)}`,
        comoFazer: 'Editar → Orçamento → suba 30%. Não mexa em mais nada por 2 dias.' });
    }
    // PAUSAR: gastou o suficiente pra julgar e não converteu.
    else if (e.spend >= PAUSE_TICKET && e.purchases === 0) {
      ordens.push({ tipo: 'PAUSAR', entity: e, prioridade: 1,
        motivo: `gastou R$${e.spend.toFixed(0)} · 0 compras · CTR ${e.ctr.toFixed(1)}%`,
        comoFazer: 'Sem venda com esse gasto: pause o conjunto e realoque a verba nos que têm ROAS alto.' });
    }
    // OBSERVAR: gastou, tem venda, mas ROAS fraco (< aumentar).
    else if (e.spend >= PAUSE_TICKET && e.roas > 0 && e.roas < UP_ROAS) {
      ordens.push({ tipo: 'OBSERVAR', entity: e, prioridade: 3,
        motivo: `ROAS ${e.roas.toFixed(1)}x (fraco) · CPA R$${e.cpa.toFixed(0)}`,
        comoFazer: 'Está no limite. Segure o orçamento e troque o criativo antes de escalar.' });
    }
    else {
      ordens.push({ tipo: 'MANTER', entity: e, prioridade: 4,
        motivo: e.purchases > 0 ? `ROAS ${e.roas.toFixed(1)}x · ${e.purchases} compra(s)` : 'ainda coletando dados',
        comoFazer: 'Deixe rodar. Sem gasto/dado suficiente pra decidir ainda.' });
    }
  }
  return ordens.sort((a, b) => a.prioridade - b.prioridade || b.entity.spend - a.entity.spend);
}
