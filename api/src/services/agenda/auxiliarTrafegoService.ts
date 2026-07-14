import { sendWhatsApp } from '../agents/zapiClient';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sincronizarOrdens, ordensPendentesNaoAlertadas, marcarAlertadas } from '../metaOrdensService';
import { computeAllSignals } from '../metaSignalsService';

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

// "Sempre enviar" (decisão Thiago 14/07): de hora em hora SEMPRE chega algo —
// a instrução quando há ação, ou um RESUMO consultivo quando não há. 24h, sem
// janela de silêncio de madrugada. Interruptor: AUX_ALWAYS_SEND=false volta ao
// modo antigo (só fala quando há ação) sem redeploy — útil se cansar do volume
// ou a linha Z-API tomar ban (ver feedback_zapi_ban).
const ALWAYS_SEND = (process.env.AUX_ALWAYS_SEND ?? 'true').toLowerCase() !== 'false';

// ── Tipos ──
interface Sale { produto: string; valor: number; campaign_id: string | null; adset_id: string | null; ad_id: string | null; }

// Hora atual em BRT (0-23). Usada pelo lembrete de meia-noite e pela chave de
// dedup horária do resumo.
function horaBRT(): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).formatToParts(new Date());
  return parseInt(p.find(x => x.type === 'hour')?.value || '0', 10);
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

// ── Leitura do robô (resumo quando NÃO há ação) ──────────────────────────────
// Só entra em tick ocioso. Camada 1 (leituraSimples): derivada só do placar já
// buscado — zero request. Camada 2 (lerRoboSeguro): computeAllSignals p/ ROAS
// médio + "conjunto esfriando"; se falhar/estourar, cai na 1. NUNCA lança,
// NUNCA volta vazio (garante o "sempre envia").

type LeituraCtx = { placarOk: boolean; lpHoje: { receita: number; vendas: number }; sdVendasHoje: number };

// Promise.race com timeout — a leitura rica nunca segura o envio garantido.
function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// A ressalva de LimpaPro-cega. LAG de registro (venda existe mas o webhook Kiwify
// atrasou → limpapro_events ainda vazio) é DIFERENTE de atribuição (qual criativo
// vendeu). Quando o placar marca R$0, isso pode ser lag — NUNCA afirmar "não
// vendeu". Ver reference_limpapro_funil_kiwify + fccabea (LimpaPro nunca foi cega).
function ressalvaLimpaProZero(lpReceita: number): string | null {
  return lpReceita === 0
    ? `_⚠️ LimpaPro em R$ 0 pode ser atraso do Kiwify (o Meta não vê a venda dela) — confere no Kiwify antes de concluir que não vendeu._`
    : null;
}

// Camada 1: zero request novo. LimpaPro a R$0 NUNCA vira "não vendeu".
function leituraSimples(ctx: LeituraCtx): string {
  if (!ctx.placarOk) return `🔎 *Leitura do robô:* sem placar do banco agora — confiro de novo na próxima hora.`;
  const { lpHoje, sdVendasHoje } = ctx;
  const p: string[] = [];
  if (lpHoje.receita >= META_LIMPAPRO_RECEITA) p.push(`LimpaPro já bateu a meta 🏆`);
  else if (lpHoje.receita > 0)                 p.push(`LimpaPro em R$ ${lpHoje.receita.toFixed(0)}, subindo`);
  else                                         p.push(`LimpaPro sem venda registrada ainda`);
  if (sdVendasHoje >= META_SOLARDOC_VENDAS) p.push(`SolarDoc bateu a meta ✅`);
  else if (sdVendasHoje > 0)                p.push(`SolarDoc com ${sdVendasHoje} cliente(s)`);
  else                                      p.push(`SolarDoc ainda sem cliente hoje`);
  const ress = ressalvaLimpaProZero(lpHoje.receita);
  return `🔎 *Leitura do robô:* ${p.join(' · ')}. Nada pedindo ação agora.` + (ress ? `\n${ress}` : '');
}

// Camada 2: best-effort. ROAS médio SÓ dos conjuntos COM rastreio (SolarDoc);
// LimpaPro fica de fora (o Meta não atribui as vendas dela → entraria a 0x e
// mentiria "ROAS baixo"). Spend-weighted (não média simples) pra um conjunto
// minúsculo a 8x não fingir "tudo saudável". Cai na camada 1 se o Meta falhar.
async function lerRoboSeguro(ctx: LeituraCtx): Promise<string> {
  const base = leituraSimples(ctx);
  if (!ctx.placarOk) return base;   // banco caiu: não puxa Meta, não inventa ROAS

  try {
    const sig = await comTimeout(computeAllSignals(14), 8000);   // 1 request Meta
    // Só conjuntos que PODEM ter ROAS de verdade: fora LimpaPro (Meta não atribui)
    // e fora lead/Forms (estruturalmente não emitem 'purchase' → 0x não é "ruim").
    const comRastreio = [...sig.values()].filter(s => !s.sem_rastreio && !s.is_lead && s.janelas.d7.suficiente && s.janelas.d7.spend > 0);
    if (!comRastreio.length) return base;   // nada com venda rastreada rodando → placar simples

    const spendTot   = comRastreio.reduce((a, s) => a + s.janelas.d7.spend, 0);
    const receitaTot = comRastreio.reduce((a, s) => a + s.janelas.d7.roas * s.janelas.d7.spend, 0);
    const roasMedio  = spendTot > 0 ? receitaTot / spendTot : 0;
    const cegos      = [...sig.values()].filter(s => s.sem_rastreio).length;
    const esfriando  = comRastreio.filter(s => s.trajetoria === 'caindo')
      .sort((a, b) => b.janelas.d7.spend - a.janelas.d7.spend)[0];

    const linhas: string[] = [`ROAS médio ${roasMedio.toFixed(1)}x nos ${comRastreio.length} conjunto(s) com venda rastreada.`];
    if (esfriando) linhas.push(`⚠️ "${esfriando.adset_name}" esfriando (ROAS caindo) — de olho, ainda não é ordem.`);
    else           linhas.push(`Nada gritando: sem conjunto esfriando. Deixa rodar.`);
    if (cegos > 0) linhas.push(`_ℹ️ ${cegos} conj. da LimpaPro ficam de fora dessa média — o Meta não atribui as vendas dela; o R$ da LimpaPro no placar vem do Kiwify._`);
    const ress = ressalvaLimpaProZero(ctx.lpHoje.receita);
    if (ress) linhas.push(ress);   // R$0 do dia SEMPRE ganha a ressalva de lag, mesmo no caminho rico
    return `🔎 *Leitura do robô:*\n${linhas.join('\n')}`;
  } catch (err) {
    logger.warn('cron', 'auxiliar-trafego: leitura rica indisponível (usa placar)', err);
    return base;
  }
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

  // ── 2+3) ORDENS DE COMANDO — lidas da FILA persistida (mm_ordens) ────────
  // Fonte da verdade ÚNICA: painel E robô leem daqui. sincronizarOrdens abre as
  // novas (dedup + cooldown), e aqui pegamos as PENDENTES ainda não alertadas.
  // Motivo/como/leitura vêm da linha → WhatsApp e painel dizem o MESMO. Ordem
  // feita/perdida some da fila → nunca re-alerta. (Substitui o dedup system_state.)
  let ordensAlertadasIds: string[] = [];
  try {
    await sincronizarOrdens();
    const pend = await ordensPendentesNaoAlertadas();
    const escalaLinhas: string[] = [];
    const pausaLinhas: string[] = [];
    for (const o of pend) {
      // Horário-limite como relógio ("faça até 23h07") — passou = não executado.
      const ate = new Date(o.expira_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
      // o.motivo já é o PORQUÊ (explicação do cruzamento de janelas = escola).
      const linhas = `\n   ⏰ faça até *${ate}*\n   🧠 ${o.motivo}\n   👉 ${linkAdset(o.adset_id)}\n   _${o.como_fazer}_`;
      if (o.tipo === 'DUPLICAR') { escalaLinhas.push(`🟢 *DUPLICAR:* ${o.adset_nome}${linhas}`); ordensAlertadasIds.push(o.id); }
      else if (o.tipo === 'AUMENTAR') { escalaLinhas.push(`🔼 *AUMENTAR 30%:* ${o.adset_nome}${linhas}`); ordensAlertadasIds.push(o.id); }
      else if (o.tipo === 'PAUSAR') { pausaLinhas.push(`🔴 *${o.adset_nome}* (${o.campanha_nome})${linhas}`); ordensAlertadasIds.push(o.id); }
    }
    if (escalaLinhas.length) { blocos.push(`📈 *Hora de escalar (ROAS forte):*\n\n` + escalaLinhas.join('\n\n')); motivos.push('fila:escalar'); }
    if (pausaLinhas.length) { blocos.push(`🩸 *Gastando sem vender (revisar/pausar):*\n\n` + pausaLinhas.join('\n\n')); motivos.push('fila:pausar'); }
    matchTot = pend.length; matchOk = ordensAlertadasIds.length;
  } catch (err) {
    logger.error('cron', 'auxiliar-trafego: fila de ordens falhou (segue)', err);
  }

  // ── 4) LEMBRETE MEIA-NOITE (só à 0h; sempre passa a madrugada) ───────────
  if (hora === 0 && podeAvisar('meia_noite')) {
    blocos.push(`🌙 *Meia-noite:* hora de ligar as campanhas da madrugada, se você desligou.\n👉 ${linkCampanhas()}`);
    motivos.push('meia_noite');
  }

  const matchRate = `${matchOk}/${matchTot}`;

  // ── Sem ação → em vez de silêncio, monta um RESUMO consultivo (24h) ───────
  // Fall-through: empurra a leitura SÓ em `blocos` (não em `ordensAlertadasIds`,
  // que é de ordem). Ganha uma chave de dedup HORÁRIA própria (`resumo:dia:hora`)
  // pra um 2º disparo do cron na mesma hora não duplicar o resumo (o master não
  // tem lock — GitHub Action pode retentar). A chave é gravada SÓ após envio ok
  // (mais abaixo), então falha de Z-API reenvia no próximo tick.
  // ALWAYS_SEND=false → volta ao modo antigo (silêncio quando não há ação).
  let ehResumo = false;
  if (blocos.length === 0) {
    if (!ALWAYS_SEND) {
      logger.info('cron', `auxiliar-trafego: nada a alertar e ALWAYS_SEND off — silêncio (LP R$${lpHoje.receita.toFixed(0)}/${META_LIMPAPRO_RECEITA}, SD ${sdVendasHoje}/${META_SOLARDOC_VENDAS})`);
      return { ...vazio, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
    }
    const chaveResumo = `resumo:${inicioDoDiaBRT().slice(0, 10)}:${hora}`;
    if (!opts.force && dedup[chaveResumo]) {
      logger.info('cron', `auxiliar-trafego: resumo da hora ${hora} já enviado — 2º disparo ignorado`);
      return { ...vazio, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
    }
    ehResumo = true;
    motivos.push(chaveResumo);   // entra em motivos → dedup gravado pós-envio (barra o 2º fire da hora)
    blocos.push(await lerRoboSeguro({ placarOk, lpHoje, sdVendasHoje }));
    logger.info('cron', `auxiliar-trafego: RESUMO hora ${hora} (LP R$${lpHoje.receita.toFixed(0)}/${META_LIMPAPRO_RECEITA}, SD ${sdVendasHoje}/${META_SOLARDOC_VENDAS})`);
  }

  // ── Cabeçalho com placar do dia (só se o Supabase respondeu — não mostra
  //    "R$0/1200" falso quando o banco falhou). LimpaPro a R$0 NÃO leva "(faltam
  //    R$X)" afirmativo — pode ser lag do Kiwify (ver ressalvaLimpaProZero). ──
  const faltaLP = Math.max(0, META_LIMPAPRO_RECEITA - lpHoje.receita);
  const linhaLP = lpHoje.receita === 0
    ? `LimpaPro: R$ 0 / ${META_LIMPAPRO_RECEITA} (sem venda registrada ainda)`
    : `LimpaPro: R$ ${lpHoje.receita.toFixed(0)} / ${META_LIMPAPRO_RECEITA}` + (faltaLP > 0 ? ` (faltam R$ ${faltaLP.toFixed(0)})` : ` ✅`);
  const cabecalho = placarOk
    ? `🤖 *Copiloto de Tráfego*\n` +
      linhaLP + `\n` +
      `SolarDoc: ${sdVendasHoje} / ${META_SOLARDOC_VENDAS} clientes` + (sdVendasHoje >= META_SOLARDOC_VENDAS ? ` ✅` : ``)
    : `🤖 *Copiloto de Tráfego*`;
  const rodape = ehResumo
    ? `\n\n_Leitura automática do robô. Nada pedindo ação agora — só radar._`
    : `\n\n_Nada foi mexido automaticamente — você decide e toca no link._`;
  const msg = cabecalho + `\n\n` + blocos.join('\n\n') + rodape;

  logger.info('cron', `auxiliar-trafego: ${ehResumo ? 'resumo' : 'acao'} — ${motivos.join(', ')} (match ${matchRate})`);

  if (opts.dry) {
    logger.info('cron', `auxiliar-trafego DRY [${ehResumo ? 'resumo' : 'acao'}]:\n${msg}`);
    return { enviado: false, motivos, msg, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
  }

  // ── Envio: try/catch pra falha de Z-API (linha caída de madrugada, ban, etc)
  //    não estourar exceção pro master cron nem marcar dedup falsamente. Falhou
  //    → retorna enviado:false SEM carimbar → próximo tick horário reenvia. ────
  try {
    await sendWhatsApp(ALERT_PHONE, msg, 'solardoc');
  } catch (err) {
    logger.error('cron', `auxiliar-trafego: envio Z-API falhou [${ehResumo ? 'resumo' : 'acao'}] — nada marcado, retenta no próximo tick`, err);
    return { ...vazio, motivos, msg, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
  }

  // Só chega aqui se ENVIOU de verdade. Carimba as ORDENS da fila como alertadas
  // (fonte da verdade = mm_ordens; resumo tem lista vazia → no-op). E grava o
  // dedup system_state (meta_batida, meia_noite E a chave horária do resumo).
  if (ordensAlertadasIds.length) await marcarAlertadas(ordensAlertadasIds);
  for (const m of motivos) dedup[m] = nowIso;
  for (const k of Object.keys(dedup)) if (new Date(dedup[k]).getTime() < cutoffMs) delete dedup[k];
  await saveDedup(dedup);

  return { enviado: true, motivos, msg, matchRate, meta: { limpapro: { receita: lpHoje.receita, alvo: META_LIMPAPRO_RECEITA }, solardoc: { vendas: sdVendasHoje, alvo: META_SOLARDOC_VENDAS } } };
}
