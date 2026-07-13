import { sendWhatsApp } from '../agents/zapiClient';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { fetchMetaEntities, gerarOrdens } from '../metaAdsFullService';

// ─── Copiloto de tráfego 24h (alert-only) ────────────────────────────────────
// Roda de HORA EM HORA (master cron). SÓ AVISA no WhatsApp do Thiago — nunca
// mexe no Meta. Manda mensagem apenas quando há AÇÃO a tomar (escalar, pausar,
// bateu meta, criativo vendendo) → dia parado = silêncio. Espelha o
// monitorCriativosService (mesma conta/token/instância/dedup).
//
// Metas (definidas 13/07, ver memória limpasolar-copiloto-trafego):
//   • LimpaPro  → R$ 1.200 de VENDAS/dia (receita). Escada 1.200→1.800→2.600.
//   • SolarDoc  → 10 clientes/dia (contagem).
//
// Fontes de venda (Supabase solardoc-pro):
//   • SolarDoc: tabela `sales` (utm_campaign=campaign_id, utm_term=adset_id,
//     utm_content=ad_id → atribuição por criativo FUNCIONA).
//   • LimpaPro: tabela `limpapro_events` (purchase/paid, amount_cents). UTM 100%
//     NULL → mede receita/meta mas NÃO sabe qual criativo vendeu (furo conhecido).
//
// Meta Ads: conta act_545732112868250, token META_SYSTEM_USER_TOKEN.
// Thresholds AGRESSIVOS (escolha do Thiago), em ROAS — não custo cru.

const AD_ACCOUNT_ID = process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250';
const ALERT_PHONE   = process.env.META_MONITOR_PHONE || '5534991360223';
const META_TOKEN    = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';

const N = (v: string | undefined, def: number) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : def);

// ── Metas ──
const META_LIMPAPRO_RECEITA = N(process.env.AUX_META_LIMPAPRO, 1200);   // R$/dia
const META_SOLARDOC_VENDAS  = N(process.env.AUX_META_SOLARDOC, 10);     // clientes/dia
// Escada de receita LimpaPro: ao bater, a próxima vira alvo.
const ESCADA = [1200, 1800, 2600, 3600, 5000];
// Gatilhos de escala/pausa (DUP/UP/PAUSE) vivem em metaAdsFullService.gerarOrdens
// (dirigidos pelos números do próprio Meta), reusados aqui e na aba do dashboard.

// Dedup: cron roda de hora em hora. Só re-alerta a mesma "chave de ação" após N horas.
const DEDUP_KEY   = 'auxiliar_trafego:dedup';
const DEDUP_HOURS = N(process.env.AUX_DEDUP_HOURS, 12);

// Janela de silêncio da madrugada (BRT). Alertas de ação nascidos entre
// QUIET_START e QUIET_END ficam guardados e saem no 1º tick após QUIET_END.
// Exceção: o lembrete de meia-noite (00h) sempre sai.
const QUIET_START = N(process.env.AUX_QUIET_START, 0);   // 0h
const QUIET_END   = N(process.env.AUX_QUIET_END, 7);     // 7h

// ── Tipos ──
interface Sale { produto: string; valor: number; campaign_id: string | null; adset_id: string | null; ad_id: string | null; }

// Hora atual em BRT (0-23).
function horaBRT(): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).formatToParts(new Date());
  return parseInt(p.find(x => x.type === 'hour')?.value || '0', 10);
}
function naMadrugada(): boolean {
  const h = horaBRT();
  return h >= QUIET_START && h < QUIET_END;
}

// Link direto pro Gerenciador filtrado no conjunto (1 toque pra editar/pausar).
function linkAdset(adsetId: string): string {
  const acct = AD_ACCOUNT_ID.replace('act_', '');
  return `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${acct}&selected_adset_ids=${adsetId}`;
}
function linkCampanhas(): string {
  const acct = AD_ACCOUNT_ID.replace('act_', '');
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acct}`;
}

// ── Vendas SolarDoc (tabela sales) numa janela ──
// Checa error (bug achado 13/07: engolir error retornava 0 silenciosamente).
async function salesSolarDoc(sinceIso: string): Promise<Sale[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('produto, valor, utm_campaign, utm_term, utm_content')
    .gte('card_passed_at', sinceIso)
    .not('card_passed_at', 'is', null);
  if (error) { logger.error('cron', 'auxiliar-trafego: salesSolarDoc falhou', error); throw new Error(`salesSolarDoc: ${error.message}`); }
  return (data ?? []).map(r => ({
    produto: String(r.produto ?? ''), valor: Number(r.valor) || 0,
    campaign_id: r.utm_campaign ?? null, adset_id: r.utm_term ?? null, ad_id: r.utm_content ?? null,
  }));
}

// ── Vendas LimpaPro (tabela limpapro_events) numa janela ──
async function salesLimpaPro(sinceIso: string): Promise<{ receita: number; vendas: number }> {
  const { data, error } = await supabase
    .from('limpapro_events')
    .select('amount_cents')
    .eq('event_type', 'purchase').eq('status', 'paid')
    .gte('created_at', sinceIso);
  if (error) { logger.error('cron', 'auxiliar-trafego: salesLimpaPro falhou', error); throw new Error(`salesLimpaPro: ${error.message}`); }
  const rows = data ?? [];
  return { vendas: rows.length, receita: rows.reduce((s, r) => s + (Number(r.amount_cents) || 0) / 100, 0) };
}

// Início do dia BRT em ISO. Usa en-CA + offset -03:00 fixo (mesmo padrão robusto
// do adminController.spStartOfToday). NÃO usar new Date(toLocaleString('en-US'))
// — o ICU do runtime da Vercel pode emitir U+202F antes do AM/PM → Invalid Date →
// timestamp "NaN-NaN-NaN" → query Supabase quebra → copiloto não manda nada.
function inicioDoDiaBRT(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return `${ymd}T00:00:00-03:00`;
}

// Próximo degrau da escada acima do valor atingido.
function proximaMeta(receitaHoje: number): number {
  for (const nivel of ESCADA) if (receitaHoje < nivel) return nivel;
  return ESCADA[ESCADA.length - 1];
}

// ── Dedup ──
async function getDedup(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', DEDUP_KEY).maybeSingle();
    const v = (data?.value ?? {}) as Record<string, string>;
    return typeof v === 'object' && v ? v : {};
  } catch { return {}; }
}
async function saveDedup(map: Record<string, string>): Promise<void> {
  try {
    await supabase.from('system_state').upsert({ key: DEDUP_KEY, value: map, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch (err) { logger.error('cron', 'auxiliar-trafego: saveDedup falhou', err); }
}

export interface AuxResult {
  enviado: boolean;
  motivos: string[];          // chaves de ação disparadas
  msg: string | null;         // texto montado (pra dry inspecionar)
  matchRate: string;          // "X/Y vendas resolveram nome" (canário)
  meta: { limpapro: { receita: number; alvo: number }; solardoc: { vendas: number; alvo: number } };
}

export async function runAuxiliarTrafego(opts: { dry?: boolean; force?: boolean } = {}): Promise<AuxResult> {
  const vazio: AuxResult = { enviado: false, motivos: [], msg: null, matchRate: '0/0', meta: { limpapro: { receita: 0, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: 0, alvo: META_SOLARDOC_VENDAS } } };
  if (!META_TOKEN) { logger.error('cron', 'auxiliar-trafego: META token ausente'); return vazio; }

  const hora = horaBRT();
  const dedup = await getDedup();
  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const cutoffMs = nowMs - DEDUP_HOURS * 3600_000;
  // Só dispara uma chave se não foi avisada nas últimas DEDUP_HOURS.
  const podeAvisar = (chave: string) => opts.force || !dedup[chave] || new Date(dedup[chave]).getTime() < cutoffMs;

  const blocos: string[] = [];
  const motivos: string[] = [];
  let matchOk = 0, matchTot = 0;

  // ── 1) PROGRESSO DE META (hoje) ──────────────────────────────────────────
  // DEGRADA se o Supabase falhar: pula o placar do dia MAS não derruba as ordens
  // do Meta (seções 2+3), que nem dependem do Supabase. Antes, um hiccup do banco
  // matava o copiloto inteiro toda hora.
  let lpHoje = { receita: 0, vendas: 0 };
  let sdVendasHoje = 0;
  let placarOk = false;
  try {
    const inicioHoje = inicioDoDiaBRT();
    const [lp, sdSales] = await Promise.all([salesLimpaPro(inicioHoje), salesSolarDoc(inicioHoje)]);
    lpHoje = lp; sdVendasHoje = sdSales.length; placarOk = true;

    if (lpHoje.receita >= META_LIMPAPRO_RECEITA && podeAvisar('limpapro:meta_batida')) {
      const prox = proximaMeta(lpHoje.receita);
      blocos.push(`🏆 *LimpaPro BATEU A META!*\nR$ ${lpHoje.receita.toFixed(0)} hoje (meta era R$ ${META_LIMPAPRO_RECEITA}).\n➡️ Nova meta: *R$ ${prox}/dia*. Segura o ROAS e sobe o orçamento das máquinas.`);
      motivos.push('limpapro:meta_batida');
    }
    if (sdVendasHoje >= META_SOLARDOC_VENDAS && podeAvisar('solardoc:meta_batida')) {
      blocos.push(`🏆 *SolarDoc BATEU A META!*\n${sdVendasHoje} clientes hoje (meta era ${META_SOLARDOC_VENDAS}).\n➡️ Bora pra 15/dia. Duplica o conjunto que mais trouxe.`);
      motivos.push('solardoc:meta_batida');
    }
  } catch (err) {
    logger.error('cron', 'auxiliar-trafego: placar do dia falhou (segue com ordens Meta)', err);
  }

  // ── 2+3) ORDENS DE COMANDO (por conjunto, últimos 3d) ────────────────────
  // Gatilhos vêm dos NÚMEROS DO PRÓPRIO META (compras + ROAS que o Meta calcula),
  // não do join Supabase — que é furado na LimpaPro (utm null) e daria falso
  // "0 vendas" na máquina que mais fatura. gerarOrdens já exclui campanhas de lead.
  const adsets3d = await fetchMetaEntities('adset', 'last_3d');
  matchTot = adsets3d.filter(a => !a.is_lead && a.spend > 0).length;
  matchOk = adsets3d.filter(a => !a.is_lead && a.purchases > 0).length;
  const ordens = gerarOrdens(adsets3d);

  const escalaLinhas: string[] = [];
  const pausaLinhas: string[] = [];
  for (const o of ordens) {
    const e = o.entity;
    if (o.tipo === 'DUPLICAR' && podeAvisar(`dup:${e.id}`)) {
      escalaLinhas.push(`🟢 *DUPLICAR:* ${e.name}\n   ${o.motivo}\n   👉 ${linkAdset(e.id)}\n   _${o.comoFazer}_`);
      motivos.push(`dup:${e.id}`);
    } else if (o.tipo === 'AUMENTAR' && podeAvisar(`up:${e.id}`)) {
      escalaLinhas.push(`🔼 *AUMENTAR 30%:* ${e.name}\n   ${o.motivo}\n   👉 ${linkAdset(e.id)}\n   _${o.comoFazer}_`);
      motivos.push(`up:${e.id}`);
    } else if (o.tipo === 'PAUSAR' && podeAvisar(`pause:${e.id}`)) {
      pausaLinhas.push(`🔴 *${e.name}* (${e.campaign_name})\n   ${o.motivo}\n   👉 ${linkAdset(e.id)}\n   _${o.comoFazer}_`);
      motivos.push(`pause:${e.id}`);
    }
  }
  if (escalaLinhas.length) blocos.push(`📈 *Hora de escalar (ROAS forte):*\n\n` + escalaLinhas.join('\n\n'));
  if (pausaLinhas.length) blocos.push(`🩸 *Gastando sem vender (revisar/pausar):*\n\n` + pausaLinhas.join('\n\n'));

  // ── 4) LEMBRETE MEIA-NOITE (só à 0h; sempre passa a madrugada) ───────────
  if (hora === 0 && podeAvisar('meia_noite')) {
    blocos.push(`🌙 *Meia-noite:* hora de ligar as campanhas da madrugada, se você desligou.\n👉 ${linkCampanhas()}`);
    motivos.push('meia_noite');
  }

  const matchRate = `${matchOk}/${matchTot}`;

  // ── Nada a dizer → silêncio (é o comportamento "só quando tem ação") ─────
  if (blocos.length === 0) {
    logger.info('cron', `auxiliar-trafego: nada a alertar (LP hoje R$${lpHoje.receita.toFixed(0)}/${META_LIMPAPRO_RECEITA}, SD ${sdVendasHoje}/${META_SOLARDOC_VENDAS}, match ${matchRate})`);
    return { ...vazio, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
  }

  // ── Cabeçalho com placar do dia (só se o Supabase respondeu — não mostra
  //    "R$0/1200" falso quando o banco falhou) ──────────────────────────────
  const faltaLP = Math.max(0, META_LIMPAPRO_RECEITA - lpHoje.receita);
  const cabecalho = placarOk
    ? `🤖 *Copiloto de Tráfego*\n` +
      `LimpaPro: R$ ${lpHoje.receita.toFixed(0)} / ${META_LIMPAPRO_RECEITA}` + (faltaLP > 0 ? ` (faltam R$ ${faltaLP.toFixed(0)})` : ` ✅`) + `\n` +
      `SolarDoc: ${sdVendasHoje} / ${META_SOLARDOC_VENDAS} clientes` + (sdVendasHoje >= META_SOLARDOC_VENDAS ? ` ✅` : ``)
    : `🤖 *Copiloto de Tráfego*`;
  const rodape = `\n\n_Nada foi mexido automaticamente — você decide e toca no link._`;
  const msg = cabecalho + `\n\n` + blocos.join('\n\n') + rodape;

  // ── Silêncio de madrugada: guarda pra soltar às 7h (exceto meia-noite) ───
  const soMeiaNoite = motivos.length === 1 && motivos[0] === 'meia_noite';
  if (naMadrugada() && !soMeiaNoite && !opts.force) {
    logger.info('cron', `auxiliar-trafego: madrugada (${hora}h) — segurando ${motivos.length} alerta(s) pra 7h`);
    return { ...vazio, motivos, msg, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
  }

  logger.info('cron', `auxiliar-trafego: ${motivos.length} alerta(s) — ${motivos.join(', ')} (match ${matchRate})`);

  if (opts.dry) {
    logger.info('cron', `auxiliar-trafego DRY:\n${msg}`);
    return { enviado: false, motivos, msg, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
  }

  await sendWhatsApp(ALERT_PHONE, msg, 'solardoc');

  // Carimba as chaves enviadas + poda vencidas.
  for (const m of motivos) dedup[m] = nowIso;
  for (const k of Object.keys(dedup)) if (new Date(dedup[k]).getTime() < cutoffMs) delete dedup[k];
  await saveDedup(dedup);

  return { enviado: true, motivos, msg, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
}
