import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

// ─── Monitor de criativos ruins no Meta Ads ──────────────────────────────────
// Varre os anúncios ATIVOS da conta e alerta no WhatsApp do Thiago quando um
// criativo está ruim "hoje". NÃO pausa nada — só avisa, com link direto pro
// Gerenciador de Anúncios (o usuário pausa com 1 toque). Modo escolhido pelo
// Thiago: "alerta + link pra pausar".
//
// Critério (validado contra dados reais 06/2026, calibrado pelas médias da conta
// Ekent- Pré Paga: CTR médio 2,46% · CPC médio R$1,25):
//   Dois gatilhos INDEPENDENTES (OR) — porque "ruim" tem dois formatos distintos:
//     A) SANGRADOR  — gastou ≥ R$30 no dia E teve 0 compras (queima dinheiro;
//                     CTR pode até estar ok, mas não converte). Ex: Video 1.2.
//     B) CRIATIVO FRACO — CTR < 1,2% E CPC > R$2,00, com piso de gasto/impressões
//                     (pega o dud cedo, antes de gastar muito). Ex: Ads 10.
//   Bons com CTR alto e sem venda AINDA (Ads 8/Ads 6) caem fora dos dois → poupados.

const GRAPH = 'https://graph.facebook.com/v21.0';
const META_TOKEN   = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';
// Conta confirmada pelo Thiago como a que roda LimpaPro/SolarDoc.
const AD_ACCOUNT_ID = process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250';
// WhatsApp do Thiago (formato Z-API: DDI+DDD+número, só dígitos).
const ALERT_PHONE   = process.env.META_MONITOR_PHONE || '5534991360223';

// Limiares (env override pra calibrar sem deploy).
const N = (v: string | undefined, def: number) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : def);
const BLEED_SPEND_MIN = N(process.env.META_MON_BLEED_SPEND, 30);   // gatilho A: gasto mínimo no dia
const WEAK_CTR_MAX    = N(process.env.META_MON_WEAK_CTR, 1.2);     // gatilho B: CTR abaixo disso (%)
const WEAK_CPC_MIN    = N(process.env.META_MON_WEAK_CPC, 2.0);     // gatilho B: CPC acima disso (R$)
const WEAK_SPEND_MIN  = N(process.env.META_MON_WEAK_SPEND, 4);     // gatilho B: gasto mínimo pra julgar
const WEAK_IMPR_MIN   = N(process.env.META_MON_WEAK_IMPR, 150);    // gatilho B: impressões mínimas (não julga CTR cedo demais)

interface AdInsight {
  ad_id: string; ad_name: string; campaign_name: string;
  spend: number; impressions: number; clicks: number; ctr: number; cpc: number;
  purchases: number;
}

// Puxa insights de HOJE por anúncio, só dos ativos. Calcula compras a partir de actions.
async function fetchTodayInsights(): Promise<AdInsight[]> {
  const fields = 'ad_id,ad_name,campaign_name,spend,impressions,clicks,ctr,cpc,actions';
  const url = `${GRAPH}/${AD_ACCOUNT_ID}/insights?level=ad&date_preset=today` +
    `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }]))}` +
    `&fields=${fields}&limit=200&access_token=${META_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta insights ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json() as { data?: any[] };
  const rows = json.data ?? [];

  return rows.map(r => {
    let purchases = 0;
    for (const a of (r.actions ?? [])) {
      if (typeof a.action_type === 'string' && a.action_type.includes('purchase')) {
        purchases += Number(a.value) || 0;
      }
    }
    return {
      ad_id: String(r.ad_id),
      ad_name: String(r.ad_name ?? '—'),
      campaign_name: String(r.campaign_name ?? '—'),
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      ctr: Number(r.ctr) || 0,
      cpc: Number(r.cpc) || 0,
      purchases,
    };
  });
}

// Aplica os dois gatilhos. Retorna o motivo (ou null se o anúncio está saudável).
function avaliar(ad: AdInsight): { motivo: string } | null {
  // A) Sangrador: gastou e não vendeu.
  if (ad.spend >= BLEED_SPEND_MIN && ad.purchases === 0) {
    return { motivo: `gastou R$ ${ad.spend.toFixed(2)} hoje e 0 vendas` };
  }
  // B) Criativo fraco: CTR baixa + CPC alto, já com gasto/impressões suficientes pra julgar.
  if (ad.ctr < WEAK_CTR_MAX && ad.cpc > WEAK_CPC_MIN &&
      ad.spend >= WEAK_SPEND_MIN && ad.impressions >= WEAK_IMPR_MIN) {
    return { motivo: `CTR ${ad.ctr.toFixed(2)}% (baixa) + CPC R$ ${ad.cpc.toFixed(2)} (alto)` };
  }
  return null;
}

// Link direto pro Gerenciador de Anúncios filtrado nesse anúncio (1 toque pra pausar).
function adsManagerLink(adId: string): string {
  const acct = AD_ACCOUNT_ID.replace('act_', '');
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acct}&selected_ad_ids=${adId}`;
}

export async function runMonitorCriativos(opts: { dry?: boolean } = {}): Promise<{ avaliados: number; ruins: number; enviado: boolean }> {
  if (!META_TOKEN) {
    logger.error('cron', 'monitor-criativos: META token ausente');
    return { avaliados: 0, ruins: 0, enviado: false };
  }

  const ads = await fetchTodayInsights();
  const ruins = ads
    .map(ad => ({ ad, v: avaliar(ad) }))
    .filter(x => x.v !== null)
    .sort((a, b) => b.ad.spend - a.ad.spend);

  logger.info('cron', `monitor-criativos: ${ads.length} ads ativos, ${ruins.length} ruins`);

  if (ruins.length === 0) {
    return { avaliados: ads.length, ruins: 0, enviado: false };
  }

  // Monta a mensagem. Uma só por execução (não spamma 1 msg por anúncio).
  const linhas = ruins.map(({ ad, v }) =>
    `🔴 *${ad.ad_name}* (${ad.campaign_name})\n   ${v!.motivo}\n   👉 Pausar: ${adsManagerLink(ad.ad_id)}`
  );
  const msg =
    `⚠️ *Criativos ruins HOJE* (Ekent- Pré Paga)\n\n` +
    linhas.join('\n\n') +
    `\n\n_Você decide: clique no link pra pausar no Gerenciador. Nada foi pausado automaticamente._`;

  if (opts.dry) {
    logger.info('cron', `monitor-criativos DRY:\n${msg}`);
    return { avaliados: ads.length, ruins: ruins.length, enviado: false };
  }

  await sendWhatsApp(ALERT_PHONE, msg, 'solardoc');
  return { avaliados: ads.length, ruins: ruins.length, enviado: true };
}
