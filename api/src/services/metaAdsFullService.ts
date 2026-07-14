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
    // BUG GRAVE consertado 14/07: o Meta retorna a MESMA compra sob ~7 action_types
    // (purchase, omni_purchase, onsite_web_purchase, offsite_conversion.fb_pixel_purchase...
    // TODOS com o mesmo valor). includes('purchase') somava os 7 → inflava 7×
    // (39 compras viravam 273, ROAS 1,2x virava 8,7x). O certo é o 'purchase' EXATO
    // (que casa com o Purchase da CAPI própria da LimpaPro/SolarDoc = 1 pedido).
    const purchases = extractAction(r.actions, t => t === 'purchase');
    const purchase_value = extractAction(r.action_values, t => t === 'purchase');
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

// ── Orçamento por conjunto: detecta ABO (orçamento no conjunto) vs CBO (na
// campanha). Pra a ordem dizer "deixa em R$X". spend ≠ budget — usa o campo
// budget de verdade. Retorna mapa adset_id → info de orçamento.
export interface BudgetInfo {
  onde: 'conjunto' | 'campanha';   // ABO = conjunto controla; CBO = campanha controla
  diarioBRL: number | null;        // orçamento diário em R$ (null se for lifetime)
  vitalicioBRL: number | null;     // orçamento total em R$ (lifetime)
  nomeControla: string;            // nome do conjunto (ABO) ou da campanha (CBO)
}
export async function fetchBudgets(): Promise<Map<string, BudgetInfo>> {
  const map = new Map<string, BudgetInfo>();
  if (!TOKEN) return map;
  const fields = 'id,name,daily_budget,lifetime_budget,campaign{id,name,daily_budget,lifetime_budget}';
  const url = `${GRAPH}/${ACCOUNT}/adsets?fields=${fields}&limit=500&access_token=${TOKEN}`;
  try {
    const res = await fetch(url);
    const json = await res.json() as { data?: any[] };
    for (const a of (json.data ?? [])) {
      const adDaily = a.daily_budget ? Number(a.daily_budget) / 100 : null;
      const adLife  = a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null;
      if (adDaily || adLife) {
        // ABO: o conjunto tem orçamento próprio.
        map.set(String(a.id), { onde: 'conjunto', diarioBRL: adDaily, vitalicioBRL: adLife, nomeControla: String(a.name ?? '') });
      } else if (a.campaign) {
        // CBO: orçamento mora na campanha.
        const cDaily = a.campaign.daily_budget ? Number(a.campaign.daily_budget) / 100 : null;
        const cLife  = a.campaign.lifetime_budget ? Number(a.campaign.lifetime_budget) / 100 : null;
        map.set(String(a.id), { onde: 'campanha', diarioBRL: cDaily, vitalicioBRL: cLife, nomeControla: String(a.campaign.name ?? '') });
      }
    }
  } catch { /* budget é opcional — degrada sem ele */ }
  return map;
}

// ── Ordens de comando: converte o VEREDITO MULTI-JANELA em AÇÃO ──────────────
// CÉREBRO ÚNICO: a ordem vem do vereditoCruzado (30d/14d/7d/3d), não mais de
// thresholds só de 3d. Assim painel, robô, fila e expiração NUNCA se contradizem
// (antes: card "DUPLICAR" de 3d ao lado de texto "SEGURA" de 7d). SEGURAR/OBSERVAR
// não viram ordem acionável — são "não escala ainda". Ver metaSignalsService.
export type OrdemTipo = 'DUPLICAR' | 'AUMENTAR' | 'PAUSAR' | 'OBSERVAR' | 'MANTER';
export interface Ordem {
  tipo: OrdemTipo;
  entity: MetaEntity;
  motivo: string;       // por que essa ordem (leitura do cruzamento de janelas)
  comoFazer: string;    // instrução em português simples
  prioridade: number;   // pra ordenar (menor = mais urgente)
}

// Sinal mínimo que gerarOrdens consome (o veredito cruzado do metaSignalsService).
export interface SinalVeredito {
  veredito: { tipo: 'DUPLICAR' | 'AUMENTAR' | 'PAUSAR' | 'SEGURAR' | 'OBSERVAR'; concordancia: string; frase: string };
}

const COMO: Record<string, string> = {
  DUPLICAR: 'Botão "..." no conjunto → Duplicar. Deixe os 2 rodando lado a lado por 3 dias.',
  AUMENTAR: 'Editar → Orçamento → suba 30%. Não mexa em mais nada por 2 dias.',
  PAUSAR: 'Sem venda com esse gasto: pause o conjunto e realoque a verba nos que têm ROAS alto.',
};

// Gera ordens a partir do VEREDITO de cada conjunto. Recebe sinais (por adset_id)
// e budgets (ABO/CBO). CBO: o orçamento é da CAMPANHA e VÁRIOS conjuntos dividem —
// então AUMENTAR/DUPLICAR de conjuntos da MESMA campanha CBO viram UMA ordem só
// (senão o usuário aumentaria a mesma campanha 2x = dobro, "perder dinheiro").
export function gerarOrdens(
  adsets: MetaEntity[],
  sinais?: Map<string, SinalVeredito | { veredito: SinalVeredito['veredito'] }>,
  budgets?: Map<string, BudgetInfo>,
): Ordem[] {
  const ordens: Ordem[] = [];
  const cboJaVisto = new Set<string>();  // campaign_id de CBO que já virou ordem de orçamento
  for (const e of adsets) {
    if (e.is_lead) continue; // lead não vira ordem de escala/pausa (métrica é lead)

    const v = sinais?.get(e.id)?.veredito;
    if (!v) continue; // sem veredito multi-janela → não gera ordem (evita decidir cego)
    if (v.tipo !== 'DUPLICAR' && v.tipo !== 'AUMENTAR' && v.tipo !== 'PAUSAR') continue; // SEGURAR/OBSERVAR = "não escala ainda"

    // CBO + ordem de ORÇAMENTO (AUMENTAR/DUPLICAR): dedup por CAMPANHA. PAUSAR é
    // por conjunto sempre (pausa o conjunto, não a campanha).
    const b = budgets?.get(e.id);
    const ehOrcamento = v.tipo === 'AUMENTAR' || v.tipo === 'DUPLICAR';
    if (b?.onde === 'campanha' && ehOrcamento && e.campaign_id) {
      if (cboJaVisto.has(e.campaign_id)) continue; // já tem ordem pra essa campanha CBO
      cboJaVisto.add(e.campaign_id);
    }

    ordens.push({
      tipo: v.tipo, entity: e,
      prioridade: v.tipo === 'PAUSAR' ? 1 : v.tipo === 'DUPLICAR' ? (v.concordancia === 'alta' ? 1 : 2) : 3,
      motivo: v.frase,                          // a explicação do cruzamento = o "porquê" (escola)
      comoFazer: COMO[v.tipo],
    });
  }
  return ordens.sort((a, b) => a.prioridade - b.prioridade || b.entity.spend - a.entity.spend);
}

