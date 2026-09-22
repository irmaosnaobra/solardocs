// ───────────────────────────────────────────────────────────────────────────
// NOME, SITUAÇÃO E GASTO DOS CONJUNTOS, direto da Meta.
//
// O quiz e o banco sabem o conjunto só pelo número (utm_term = {{adset.id}}).
// Aqui o número vira nome ("5 posto araguari - cidades proximas"), situação
// (ativo/pausado) e gasto no MESMO intervalo do painel, que é o que permite
// dizer quanto custou cada reunião.
//
// Mesmo token e mesma conta da aba Meta Ads (metaAdsFullService). Se a Meta
// não responder, devolve o mapa vazio e `ok: false`: o painel continua de pé
// com os números, só sem nome e sem gasto. Nunca derruba a rota.
// ───────────────────────────────────────────────────────────────────────────
import type { MetaConjunto } from './quizFunil';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';
const ACCOUNT = process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250';

/** ID de objeto da Meta: só dígitos. O resto (vazio, "(sem)") nem vai. */
export const ehIdMeta = (id: string) => /^\d{10,20}$/.test(id);

async function lerJson(url: string, ms = 8000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j || j.error) throw new Error(j?.error?.message || `Meta ${r.status}`);
    return j;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param ids   números de conjunto vistos nas visitas e nos leads
 * @param desde dia inicial (AAAA-MM-DD, fuso de São Paulo)
 * @param ate   dia final, inclusive
 */
export async function buscarConjuntosMeta(ids: string[], desde: string, ate: string):
  Promise<{ ok: boolean; motivo?: string; conjuntos: Map<string, MetaConjunto> }> {
  const conjuntos = new Map<string, MetaConjunto>();
  const validos = [...new Set(ids.filter(ehIdMeta))].slice(0, 50);
  if (!TOKEN) return { ok: false, motivo: 'sem META_SYSTEM_USER_TOKEN', conjuntos };
  if (validos.length === 0) return { ok: true, conjuntos };

  try {
    // Nome e situação de todos, inclusive de quem não gastou no período.
    // Um ID que não é conjunto (lixo numa UTM) derruba o lote inteiro na Meta,
    // então o lote falho é refeito um a um.
    const campos = 'name,effective_status';
    let porId: Record<string, { name?: string; effective_status?: string }> = {};
    try {
      porId = await lerJson(`${GRAPH}/?ids=${validos.join(',')}&fields=${campos}&access_token=${TOKEN}`);
    } catch {
      const um = await Promise.all(validos.map((id) =>
        lerJson(`${GRAPH}/${id}?fields=${campos}&access_token=${TOKEN}`).then((j) => [id, j] as const).catch(() => null)));
      porId = Object.fromEntries(um.filter(Boolean) as [string, { name?: string; effective_status?: string }][]);
    }
    for (const [id, o] of Object.entries(porId)) {
      if (o && o.name) conjuntos.set(id, { id, nome: o.name, status: o.effective_status || '', gasto: 0 });
    }

    // Gasto no intervalo. Quem não aparece aqui não gastou: fica 0.
    const intervalo = encodeURIComponent(JSON.stringify({ since: desde, until: ate }));
    const filtro = encodeURIComponent(JSON.stringify([{ field: 'adset.id', operator: 'IN', value: [...conjuntos.keys()] }]));
    if (conjuntos.size > 0) {
      const ins = await lerJson(`${GRAPH}/${ACCOUNT}/insights?level=adset&time_range=${intervalo}` +
        `&filtering=${filtro}&fields=adset_id,adset_name,spend&limit=500&access_token=${TOKEN}`);
      for (const r of ins.data || []) {
        const id = String(r.adset_id || '');
        const atual = conjuntos.get(id);
        if (atual) atual.gasto = Number(r.spend) || 0;
      }
    }
    return { ok: true, conjuntos };
  } catch (err) {
    // Sem gasto confiável, nenhum gasto: null vira travessão, não zero.
    for (const c of conjuntos.values()) c.gasto = null;
    return { ok: false, motivo: String((err as Error)?.message || err).slice(0, 160), conjuntos };
  }
}
