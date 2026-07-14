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
  // ── Avaliação MULTI-JANELA (30d/14d/7d/3d/ontem/hoje) ──
  janelas: JanelasMulti;
  veredito: VeredictoCruzado;
}

// ROAS + volume por janela. n=0 → 'dados insuficientes' (não finge número).
export interface JanelaMetrica { n_dias: number; roas: number; purchases: number; spend: number; suficiente: boolean; }
export interface JanelasMulti { hoje: JanelaMetrica; ontem: JanelaMetrica; d3: JanelaMetrica; d7: JanelaMetrica; d14: JanelaMetrica; d30: JanelaMetrica; }
export type VerdictoTipo = 'DUPLICAR' | 'AUMENTAR' | 'PAUSAR' | 'SEGURAR' | 'OBSERVAR';
export interface VeredictoCruzado {
  tipo: VerdictoTipo;
  concordancia: 'alta' | 'media' | 'baixa';  // janelas apontam pro mesmo lado?
  frase: string;                              // leitura em português do cruzamento
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
      // 'purchase' EXATO — não includes (Meta duplica a mesma compra em ~7 types → inflava 7×).
      purchases: extractAction(r.actions, t => t === 'purchase'),
      purchase_value: extractAction(r.action_values, t => t === 'purchase'),
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

// Data-limite ISO (yyyy-mm-dd) de N dias atrás. Base no relógio do server (UTC);
// os dias do Meta vêm em date_start yyyy-mm-dd, comparação lexical funciona.
function limiteISO(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}
// Métrica de uma janela: fatia os dias >= limite, agrega. suficiente = tem gasto
// em ≥ MIN_DIAS dias reais (senão 'dados insuficientes' — não finge número).
const MIN_DIAS_JANELA = N(process.env.SIG_MIN_DIAS_JANELA, 2);
function janelaMetrica(dias: DiaAdset[], nDiasAtras: number, exigeMin = true): JanelaMetrica {
  const lim = limiteISO(nDiasAtras);
  const f = dias.filter(d => d.dia >= lim && d.spend > 0);
  const spend = f.reduce((s, d) => s + d.spend, 0);
  const purchases = f.reduce((s, d) => s + d.purchases, 0);
  const suficiente = exigeMin ? f.length >= MIN_DIAS_JANELA : f.length >= 1;
  return { n_dias: f.length, roas: roasDe(f), purchases, spend, suficiente };
}
function todasJanelas(dias: DiaAdset[]): JanelasMulti {
  return {
    hoje:  janelaMetrica(dias, 1, false),   // hoje/ontem: 1 dia já conta (mas é só contexto)
    ontem: janelaMetrica(dias, 2, false),
    d3:    janelaMetrica(dias, 3),
    d7:    janelaMetrica(dias, 7),
    d14:   janelaMetrica(dias, 14),
    d30:   janelaMetrica(dias, 30),
  };
}

// Contexto extra pro veredito: fadiga/dias (do próprio conjunto) + orçamento
// (pra decidir DUPLICAR só quem está no teto, e dizer o R$ alvo).
export interface VeredictoContexto {
  fadiga: boolean;
  diasRodando: number;
  budget?: { onde: 'conjunto' | 'campanha'; diarioBRL: number | null; nomeControla: string } | null;
}

// ── VEREDITO CRUZADO: conservador de verdade (proteger dinheiro) ─────────────
// FILOSOFIA (feedback Thiago 14/07): escalar um vencedor = AUMENTAR +30% no
// orçamento (conservador, não canibaliza). DUPLICAR é o AGRESSIVO (cópia
// recomeça learning + compete no leilão) → RESERVADO só pras estrelas que já
// estão NO TETO de confiança E de orçamento. Timing: escalar é limitado pelo
// pixel (~1d), pausar é tempo-real. 3d+7d decidem, 14d/30d confirmam, hoje/ontem
// só contexto. Concordância = confiança. "100% confiável" = TIER, não garantia.
const UP_ROAS_MIN = N(process.env.AUX_UP_ROAS, 1.7);        // piso pra AUMENTAR (Thiago: ~1,7)
const DUP_ROAS_MIN = N(process.env.AUX_DUP_ROAS, 3.0);      // duplicar exige ROAS bem forte
const TETO_ORCAMENTO = N(process.env.AUX_TETO_ORCAMENTO, 100); // "no teto" = orçamento diário ≥ isso (R$)

function sugereOrcamento(atual: number | null, pct: number): string {
  if (!atual || atual <= 0) return '';
  const novo = Math.round(atual * (1 + pct / 100));
  return ` de R$${atual.toFixed(0)} → *R$${novo}/dia*`;
}

function vereditoCruzado(j: JanelasMulti, ctx?: VeredictoContexto): VeredictoCruzado {
  const PAUSE_LIMIAR = N(process.env.AUX_TICKET, 45) * N(process.env.AUX_PAUSE_FATOR, 1.5);

  const dec7 = j.d7.suficiente ? j.d7.roas : null;    // 7d = decisor principal
  const dec3 = j.d3.suficiente ? j.d3.roas : null;    // 3d = confirma o curto
  const conf = j.d14.suficiente ? j.d14.roas : (j.d30.suficiente ? j.d30.roas : null); // 14/30 = tendência

  const b = ctx?.budget;
  const alvoNome = b?.onde === 'campanha' ? `a CAMPANHA "${b.nomeControla}"` : 'o conjunto';

  // Sem 7d confiável → não decide.
  if (dec7 === null) return { tipo: 'OBSERVAR', concordancia: 'baixa', frase: 'Dados insuficientes nas janelas que decidem (7d). Deixa juntar mais dados antes de escalar.' };

  // PAUSAR (tempo-real, key off spend magnitude — não recência): gastou e não vendeu.
  if (j.d7.spend >= PAUSE_LIMIAR && j.d7.purchases === 0) {
    return { tipo: 'PAUSAR', concordancia: conf !== null && conf < 1 ? 'alta' : 'media',
      frase: `🩸 Gastou R$${j.d7.spend.toFixed(0)} em 7d sem vender. ${conf !== null && conf < 1 ? 'Histórico também fraco → pausa, tá queimando dinheiro.' : 'Revisa e pausa antes de queimar mais.'}` };
  }

  // ── Confiança pra escalar (tier). 7d é o decisor. ──
  const escalavel = dec7 >= UP_ROAS_MIN;
  if (!escalavel) {
    if (dec7 > 0) return { tipo: 'OBSERVAR', concordancia: 'baixa', frase: `ROAS ${dec7.toFixed(1)}x em 7d — abaixo de ${UP_ROAS_MIN}x, não compensa escalar. Deixa rodar e observa.` };
    return { tipo: 'OBSERVAR', concordancia: 'baixa', frase: `Sem retorno no 7d. Observa (pode ser atribuição atrasada).` };
  }

  // 3d despencou ou histórico fraco → SEGURA (não escala em cima de pico).
  if (dec3 !== null && dec3 < UP_ROAS_MIN) {
    return { tipo: 'SEGURAR', concordancia: 'baixa',
      frase: `7d bom (${dec7.toFixed(1)}x) mas os últimos 3 dias caíram (${dec3.toFixed(1)}x) — pode estar esfriando. NÃO escala agora, observa 1-2 dias.` };
  }
  if (conf !== null && conf < UP_ROAS_MIN) {
    return { tipo: 'SEGURAR', concordancia: 'baixa',
      frase: `Bom no 7d (${dec7.toFixed(1)}x) mas o histórico é fraco (${conf.toFixed(1)}x) — pode ser pico, não sustentável. Segura antes de escalar.` };
  }

  // ── TIER TOPO pra DUPLICAR (o agressivo, só quem é 100%-confiável-possível): ──
  // ROAS bem forte + concordância alta (3d E histórico fortes) + volume + sem
  // fadiga + estabelecido + JÁ NO TETO de orçamento (duplicar só faz sentido se
  // não dá mais pra crescer aumentando). Senão → AUMENTAR (conservador).
  const concordaAlto = conf !== null && conf >= DUP_ROAS_MIN && dec3 !== null && dec3 >= DUP_ROAS_MIN;
  const forteDup = dec7 >= DUP_ROAS_MIN;
  const volumeOk = j.d7.purchases >= N(process.env.AUX_DUP_VENDAS, 5);
  const semFadiga = !ctx?.fadiga;
  const estabelecido = (ctx?.diasRodando ?? 0) >= 5;
  const noTeto = (b?.diarioBRL ?? 0) >= TETO_ORCAMENTO;

  if (forteDup && concordaAlto && volumeOk && semFadiga && estabelecido && noTeto) {
    return { tipo: 'DUPLICAR', concordancia: 'alta',
      frase: `⭐ ESTRELA: ROAS ${dec7.toFixed(1)}x consistente em 3d/7d/14d, ${j.d7.purchases} vendas, sem fadiga, e já no teto de orçamento (R$${b!.diarioBRL!.toFixed(0)}/dia). Duplica pra crescer sem canibalizar${b?.onde === 'campanha' ? ' — orçamento é da campanha (CBO).' : `. Deixa a cópia em R$${b!.diarioBRL!.toFixed(0)}/dia.`}` };
  }

  // ── PADRÃO CONSERVADOR: AUMENTAR +30% (não canibaliza, escala seguro) ──
  const pct = 30;
  const linhaR$ = b?.diarioBRL ? sugereOrcamento(b.diarioBRL, pct) : '';
  const porqueNaoDup = !noTeto && b?.diarioBRL ? ` (ainda dá pra crescer aumentando — só duplica no teto)` : '';
  return { tipo: 'AUMENTAR', concordancia: forteDup && concordaAlto ? 'alta' : 'media',
    frase: `ROAS ${dec7.toFixed(1)}x em 7d${conf !== null ? `, histórico ${conf.toFixed(1)}x` : ''} — sobe ${alvoNome}${linhaR$} (+${pct}%)${porqueNaoDup}. Espera 1-2 dias pra confirmar antes de subir de novo.` };
}

// Calcula todos os sinais de um conjunto a partir do histórico diário.
// budget (opcional) alimenta o veredito: DUPLICAR só no teto + sugere o R$ alvo.
export function computeSignals(adsetId: string, name: string, dias: DiaAdset[], budget?: VeredictoContexto['budget']): AdsetSignals {
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

  const jan = todasJanelas(dias);
  return {
    adset_id: adsetId, adset_name: name, dias_rodando: diasRodando,
    trajetoria, roas_recente: roasRecente, roas_anterior: roasAnterior,
    fadiga, frequencia: freqRecente, ctr_atual: ctrRecente, ctr_antes: ctrAntes,
    melhor_roas: melhorRoas, melhor_dia: melhorDia,
    score, score_breakdown: breakdown, leitura,
    janelas: jan,
    veredito: vereditoCruzado(jan, { fadiga, diasRodando, budget }),
  };
}

// Conveniência: sinais de todos os conjuntos, mapa por adset_id.
// Default 30 dias — precisa da janela longa pra o veredito cruzado confirmar tendência.
// Puxa o orçamento (ABO/CBO) em paralelo pra o veredito decidir DUPLICAR-vs-AUMENTAR.
export async function computeAllSignals(days: 14 | 30 = 30): Promise<Map<string, AdsetSignals>> {
  const { fetchBudgets } = await import('./metaAdsFullService');
  const [hist, budgets] = await Promise.all([
    fetchAdsetHistory(days),
    fetchBudgets().catch(() => new Map()),
  ]);
  const out = new Map<string, AdsetSignals>();
  for (const [id, { name, dias }] of hist) {
    const b = budgets.get(id);
    out.set(id, computeSignals(id, name, dias, b ? { onde: b.onde, diarioBRL: b.diarioBRL, nomeControla: b.nomeControla } : null));
  }
  return out;
}
