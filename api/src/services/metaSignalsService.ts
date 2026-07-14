// ─── Sinais de "especialista de tráfego" por conjunto ────────────────────────
// Porta a inteligência do GERENCIADOR META (engine.ts) — trajetória, fadiga,
// score de saúde — ADAPTADA pra VENDA/ROAS (o GME media CPL/leads; aqui é
// compra/ROAS, que é o negócio do Thiago). Usa histórico diário do Meta
// (time_increment=1), sem depender de tabela nova nem do app do GME (que está
// bloqueado). Determinístico e explicável — nunca "a IA mandou".
// Ver memória limpasolar-copiloto-trafego.

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';
const ACCOUNT = process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250';

const N = (v: string | undefined, def: number) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : def);
// Limiares (env override). Calibrados pra conta Ekent (CTR ~2-5%, ROAS alto).
const FREQ_MAX     = N(process.env.SIG_FREQ_MAX, 3.0);    // fadiga: frequência acima disso
const FADIGA_CTR_QUEDA = N(process.env.SIG_FADIGA_CTR, 0.75); // fadiga: CTR caiu abaixo de 75% do que era
const IMPR_MIN     = N(process.env.SIG_IMPR_MIN, 500);    // piso de impressões pra julgar

// Um dia de histórico de um conjunto.
interface DiaAdset {
  dia: string; spend: number; impressions: number; clicks: number;
  ctr: number; frequency: number; purchases: number; purchase_value: number;
}

export type Trajetoria = 'subindo' | 'caindo' | 'estavel' | 'novo';

export interface AdsetSignals {
  adset_id: string;
  adset_name: string;
  dias_rodando: number;        // quantos dias com entrega no histórico
  // Trajetória do ROAS (janela recente vs anterior)
  trajetoria: Trajetoria;
  roas_recente: number;        // ROAS média dos últimos ~3 dias com venda
  roas_anterior: number;       // ROAS média da janela anterior
  // Fadiga de criativo
  fadiga: boolean;
  frequencia: number;
  ctr_atual: number;
  ctr_antes: number;
  // Melhor-vs-agora
  melhor_roas: number;         // melhor ROAS diário já registrado na janela
  melhor_dia: string | null;
  // Score de saúde 0-100
  score: number;
  score_breakdown: Record<string, number>;
  // Frase de especialista (o "porquê")
  leitura: string;
}

function extractAction(actions: any[] | undefined, matcher: (t: string) => boolean): number {
  if (!Array.isArray(actions)) return 0;
  return actions.filter(a => typeof a.action_type === 'string' && matcher(a.action_type))
    .reduce((s, a) => s + (Number(a.value) || 0), 0);
}

// Puxa o histórico diário de TODOS os conjuntos (1 request) e agrupa por adset.
export async function fetchAdsetHistory(days: 14 | 30 = 14): Promise<Map<string, { name: string; dias: DiaAdset[] }>> {
  if (!TOKEN) throw new Error('META token ausente');
  const preset = days === 30 ? 'last_30d' : 'last_14d';
  const fields = 'adset_id,adset_name,spend,impressions,clicks,ctr,frequency,actions,action_values';
  const url = `${GRAPH}/${ACCOUNT}/insights?level=adset&time_increment=1&date_preset=${preset}&fields=${fields}&limit=1000&access_token=${TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta history ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as { data?: any[] };

  const map = new Map<string, { name: string; dias: DiaAdset[] }>();
  for (const r of (json.data ?? [])) {
    const id = String(r.adset_id ?? '');
    if (!id) continue;
    const entry = map.get(id) ?? { name: String(r.adset_name ?? '—'), dias: [] };
    entry.dias.push({
      dia: String(r.date_start ?? ''),
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      ctr: Number(r.ctr) || 0,
      frequency: Number(r.frequency) || 0,
      purchases: extractAction(r.actions, t => t.includes('purchase')),
      purchase_value: extractAction(r.action_values, t => t.includes('purchase')),
    });
    map.set(id, entry);
  }
  // ordena cada série por dia
  for (const e of map.values()) e.dias.sort((a, b) => a.dia.localeCompare(b.dia));
  return map;
}

// ROAS agregado de um conjunto de dias.
function roasDe(dias: DiaAdset[]): number {
  const spend = dias.reduce((s, d) => s + d.spend, 0);
  const val = dias.reduce((s, d) => s + d.purchase_value, 0);
  return spend > 0 ? val / spend : 0;
}

// Calcula todos os sinais de um conjunto a partir do histórico diário.
export function computeSignals(adsetId: string, name: string, dias: DiaAdset[]): AdsetSignals {
  const comEntrega = dias.filter(d => d.impressions > 0);
  const diasRodando = comEntrega.length;

  // ── Trajetória: ROAS dos últimos 3 dias (com gasto) vs 3 anteriores ──
  const comGasto = dias.filter(d => d.spend > 0);
  const recentes = comGasto.slice(-3);
  const anteriores = comGasto.slice(-6, -3);
  const roasRecente = roasDe(recentes);
  const roasAnterior = roasDe(anteriores);
  let trajetoria: Trajetoria;
  if (comGasto.length < 3) trajetoria = 'novo';
  else if (roasAnterior === 0 && roasRecente === 0) trajetoria = 'estavel';
  else if (roasRecente >= roasAnterior * 1.2) trajetoria = 'subindo';
  else if (roasRecente <= roasAnterior * 0.8) trajetoria = 'caindo';
  else trajetoria = 'estavel';

  // ── Fadiga: frequência alta + CTR caindo (janela recente vs anterior) ──
  const ctrRecente = recentes.length ? recentes.reduce((s, d) => s + d.ctr, 0) / recentes.length : 0;
  const ctrAntes = anteriores.length ? anteriores.reduce((s, d) => s + d.ctr, 0) / anteriores.length : 0;
  const freqRecente = recentes.length ? recentes.reduce((s, d) => s + d.frequency, 0) / recentes.length : 0;
  const imprRecente = recentes.reduce((s, d) => s + d.impressions, 0);
  const fadiga = freqRecente > FREQ_MAX && ctrAntes > 0.5 &&
    ctrRecente < ctrAntes * FADIGA_CTR_QUEDA && imprRecente >= IMPR_MIN;

  // ── Melhor-vs-agora: melhor ROAS diário na janela ──
  let melhorRoas = 0, melhorDia: string | null = null;
  for (const d of comGasto) {
    const r = d.spend > 0 ? d.purchase_value / d.spend : 0;
    if (r > melhorRoas) { melhorRoas = r; melhorDia = d.dia; }
  }

  // ── Score de saúde 0-100 (adaptado do GME, medindo ROAS/venda) ──
  const breakdown: Record<string, number> = {};
  const totalSpend = comGasto.reduce((s, d) => s + d.spend, 0);
  const totalPur = comGasto.reduce((s, d) => s + d.purchases, 0);
  const roasGeral = roasDe(comGasto);

  // ROAS (40 pts): ROAS 2.5x+ = cheio. 0 venda com gasto = 0.
  if (totalPur > 0) breakdown.roas = Math.max(0, Math.min(40, Math.round(40 * Math.min(1, roasGeral / 2.5))));
  else if (totalSpend > 50) breakdown.roas = 0;
  else breakdown.roas = 20;
  // CTR (25 pts): 3%+ = cheio.
  breakdown.ctr = Math.max(0, Math.min(25, Math.round(25 * Math.min(1, ctrRecente / 3))));
  // Volume (15 pts): 20 compras/janela = cheio.
  breakdown.volume = Math.min(15, Math.round((totalPur / 20) * 15));
  // Frequência (10 pts): penaliza fadiga.
  breakdown.frequencia = freqRecente === 0 ? 10 : freqRecente < FREQ_MAX * 0.7 ? 10 : freqRecente < FREQ_MAX ? 7 : freqRecente < FREQ_MAX * 1.3 ? 4 : 0;
  // Tendência (10 pts): subindo é bom.
  breakdown.tendencia = trajetoria === 'subindo' ? 10 : trajetoria === 'estavel' ? 7 : trajetoria === 'novo' ? 5 : 0;
  const score = Object.values(breakdown).reduce((s, v) => s + v, 0);

  // ── Leitura de especialista (o "porquê" humano) ──
  const partes: string[] = [];
  if (trajetoria === 'subindo') partes.push('📈 ROAS subindo');
  else if (trajetoria === 'caindo') partes.push('📉 ROAS caindo');
  else if (trajetoria === 'novo') partes.push('🌱 ainda coletando');
  if (fadiga) partes.push('😴 fadiga de criativo (troca)');
  else if (freqRecente > 0 && freqRecente < FREQ_MAX * 0.8 && diasRodando >= 3) partes.push('público fresco');
  if (melhorRoas > roasRecente * 1.5 && roasRecente > 0) partes.push(`já fez ${melhorRoas.toFixed(0)}x`);
  const leitura = partes.length ? partes.join(' · ') : 'sem sinal forte ainda';

  return {
    adset_id: adsetId, adset_name: name, dias_rodando: diasRodando,
    trajetoria, roas_recente: roasRecente, roas_anterior: roasAnterior,
    fadiga, frequencia: freqRecente, ctr_atual: ctrRecente, ctr_antes: ctrAntes,
    melhor_roas: melhorRoas, melhor_dia: melhorDia,
    score, score_breakdown: breakdown, leitura,
  };
}

// Conveniência: sinais de todos os conjuntos, mapa por adset_id.
export async function computeAllSignals(days: 14 | 30 = 14): Promise<Map<string, AdsetSignals>> {
  const hist = await fetchAdsetHistory(days);
  const out = new Map<string, AdsetSignals>();
  for (const [id, { name, dias }] of hist) out.set(id, computeSignals(id, name, dias));
  return out;
}
