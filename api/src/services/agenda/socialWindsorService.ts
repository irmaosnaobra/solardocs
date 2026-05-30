import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

// Puxa métricas sociais (Instagram + TikTok orgânico da Irmãos na Obra) da
// Windsor.ai e grava no Supabase do gerador, alimentando a aba "Redes" do
// /gerador. Roda 1x/dia pelo /cron/master — a Windsor atualiza insights de
// IG/TikTok ~1x/dia, então não há ganho em rodar mais frequente.
//
// Espelha o padrão de leadsMetaService.ts (mesmo client anon, upsert idempotente).

const WINDSOR = 'https://connectors.windsor.ai';
const API_KEY = process.env.WINDSOR_API_KEY || '';
const IG_ACCOUNT = process.env.WINDSOR_IG_ACCOUNT || '17841475845665007';

interface WindsorRow { [k: string]: any; }

// GET genérico na REST da Windsor. Retorna o array `data` (ou [] em erro).
async function windsor(connector: string, fields: string[], extra: Record<string, string> = {}): Promise<WindsorRow[]> {
  if (!API_KEY) throw new Error('WINDSOR_API_KEY ausente no ambiente');
  const qs = new URLSearchParams({ api_key: API_KEY, fields: fields.join(','), ...extra });
  const url = `${WINDSOR}/${connector}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Windsor ${connector} HTTP ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = (await r.json()) as { data?: WindsorRow[] };
  return Array.isArray(j.data) ? j.data : [];
}

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const numF = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Instagram: métricas diárias ────────────────────────────────────────────
async function syncInstagramDaily(): Promise<number> {
  // Métricas de alcance/views/engajamento aceitam janela longa (90d).
  const rows = await windsor('instagram',
    ['date', 'followers_count', 'reach', 'views',
     'total_interactions', 'accounts_engaged', 'comments', 'shares', 'profile_views'],
    { date_preset: 'last_90d', accounts: IG_ACCOUNT });

  // follower_count_1d (novos seguidores/dia) só é permitido nos últimos 30 dias
  // pela API da Windsor — buscado à parte e mesclado por dia.
  const novosPorDia: Record<string, number | null> = {};
  try {
    const nrows = await windsor('instagram', ['date', 'follower_count_1d'],
      { date_preset: 'last_30d', accounts: IG_ACCOUNT });
    for (const n of nrows) {
      if (n.date) novosPorDia[String(n.date).slice(0, 10)] = num(n.follower_count_1d);
    }
  } catch (e) {
    logger.warn('social-windsor', 'follower_count_1d indisponível', e);
  }

  const ups = rows
    .filter(r => r.date)
    .map(r => ({
      rede: 'instagram',
      dia: String(r.date).slice(0, 10),
      seguidores: num(r.followers_count),
      novos_seg: novosPorDia[String(r.date).slice(0, 10)] ?? null,
      alcance: num(r.reach),
      views: num(r.views),
      interacoes: num(r.total_interactions),
      contas_engaj: num(r.accounts_engaged),
      comentarios: num(r.comments),
      compart: num(r.shares),
      perfil_views: num(r.profile_views),
      atualizado_em: new Date().toISOString(),
    }));
  if (ups.length) {
    const { error } = await supabaseGerador.from('social_daily').upsert(ups, { onConflict: 'rede,dia' });
    if (error) throw new Error('upsert social_daily IG: ' + error.message);
  }
  return ups.length;
}

// ─── Instagram: posts (ranking) ─────────────────────────────────────────────
async function syncInstagramPosts(): Promise<number> {
  const rows = await windsor('instagram',
    ['media_id', 'media_caption', 'media_type', 'media_product_type', 'timestamp',
     'media_like_count', 'media_comments_count', 'media_reach', 'media_saved',
     'media_shares', 'media_permalink', 'media_thumbnail_url', 'media_views'],
    { date_preset: 'last_year', accounts: IG_ACCOUNT });

  const ups = rows
    .filter(r => r.media_id)
    .map(r => {
      const likes = num(r.media_like_count) || 0;
      const coments = num(r.media_comments_count) || 0;
      const salvos = num(r.media_saved) || 0;
      const compart = num(r.media_shares) || 0;
      return {
        media_id: String(r.media_id),
        rede: 'instagram',
        tipo: r.media_product_type || r.media_type || null,
        legenda: r.media_caption || null,
        publicado_em: r.timestamp || null,
        thumbnail_url: r.media_thumbnail_url || null,
        permalink: r.media_permalink || null,
        likes, comentarios: coments, salvos, compart,
        alcance: num(r.media_reach) || 0,
        views: num(r.media_views) || 0,
        engajamento: likes + coments + salvos + compart,
        atualizado_em: new Date().toISOString(),
      };
    });
  if (ups.length) {
    const { error } = await supabaseGerador.from('social_posts').upsert(ups, { onConflict: 'media_id' });
    if (error) throw new Error('upsert social_posts IG: ' + error.message);
  }
  return ups.length;
}

// ─── Instagram: audiência (idade/gênero + cidade) ───────────────────────────
async function syncInstagramAudience(): Promise<number> {
  const linhas: any[] = [];

  // idade/gênero — formato "F.25-34"
  const ga = await windsor('instagram',
    ['audience_gender_age_name', 'audience_gender_age_size'], { accounts: IG_ACCOUNT });
  for (const r of ga) {
    const nome = r.audience_gender_age_name;
    const tam = num(r.audience_gender_age_size);
    if (!nome || tam === null) continue;
    const [g, faixa] = String(nome).split('.');
    linhas.push({ rede: 'instagram', dimensao: 'genero_idade', rotulo: `${g === 'F' ? 'Mulheres' : g === 'M' ? 'Homens' : g} ${faixa || ''}`.trim(), valor: tam });
  }

  // cidade
  const ci = await windsor('instagram', ['city', 'audience_city_size'], { accounts: IG_ACCOUNT });
  for (const r of ci) {
    const tam = num(r.audience_city_size);
    if (!r.city || tam === null) continue;
    linhas.push({ rede: 'instagram', dimensao: 'cidade', rotulo: String(r.city).split(',')[0].trim(), valor: tam });
  }

  await supabaseGerador.from('social_audience').delete().eq('rede', 'instagram');
  if (linhas.length) {
    const stamped = linhas.map(l => ({ ...l, atualizado_em: new Date().toISOString() }));
    const { error } = await supabaseGerador.from('social_audience').upsert(stamped, { onConflict: 'rede,dimensao,rotulo' });
    if (error) throw new Error('upsert social_audience IG: ' + error.message);
  }
  return linhas.length;
}

// ─── TikTok: métricas diárias ───────────────────────────────────────────────
async function syncTiktokDaily(): Promise<number> {
  const rows = await windsor('tiktok_organic',
    ['date', 'total_followers_count', 'followers_count', 'video_views',
     'likes', 'comments', 'shares', 'profile_views'],
    { date_preset: 'last_90d' });

  const ups = rows
    .filter(r => r.date)
    .map(r => ({
      rede: 'tiktok',
      dia: String(r.date).slice(0, 10),
      seguidores: num(r.total_followers_count),
      novos_seg: num(r.followers_count),
      alcance: null as number | null,
      views: num(r.video_views),
      interacoes: (num(r.likes) || 0) + (num(r.comments) || 0) + (num(r.shares) || 0),
      contas_engaj: null as number | null,
      comentarios: num(r.comments),
      compart: num(r.shares),
      perfil_views: num(r.profile_views),
      atualizado_em: new Date().toISOString(),
    }));
  if (ups.length) {
    const { error } = await supabaseGerador.from('social_daily').upsert(ups, { onConflict: 'rede,dia' });
    if (error) throw new Error('upsert social_daily TikTok: ' + error.message);
  }
  return ups.length;
}

// ─── TikTok: vídeos (ranking) ───────────────────────────────────────────────
async function syncTiktokPosts(): Promise<number> {
  const rows = await windsor('tiktok_organic',
    ['video_id', 'video_caption', 'video_views_count', 'video_likes',
     'video_comments', 'video_shares', 'video_create_datetime', 'video_duration',
     'video_full_watched_rate', 'video_share_url', 'video_thumbnail_url'],
    { date_preset: 'last_year' });

  const ups = rows
    .filter(r => r.video_id)
    .map(r => {
      const likes = num(r.video_likes) || 0;
      const coments = num(r.video_comments) || 0;
      const compart = num(r.video_shares) || 0;
      return {
        media_id: 'tt_' + String(r.video_id),
        rede: 'tiktok',
        tipo: 'VIDEO',
        legenda: r.video_caption || null,
        publicado_em: r.video_create_datetime || null,
        thumbnail_url: r.video_thumbnail_url || null,
        permalink: r.video_share_url || null,
        likes, comentarios: coments, salvos: 0, compart,
        alcance: 0,
        views: num(r.video_views_count) || 0,
        duracao_seg: numF(r.video_duration),
        watch_full: numF(r.video_full_watched_rate),
        engajamento: likes + coments + compart,
        atualizado_em: new Date().toISOString(),
      };
    });
  if (ups.length) {
    const { error } = await supabaseGerador.from('social_posts').upsert(ups, { onConflict: 'media_id' });
    if (error) throw new Error('upsert social_posts TikTok: ' + error.message);
  }
  return ups.length;
}

// ─── YouTube: métricas diárias (canal) ──────────────────────────────────────
async function syncYoutubeDaily(): Promise<number> {
  // Métricas por vídeo/dia agregadas no nível de canal. subscriber_count e
  // view_count são totais do canal (snapshot); o resto soma por dia.
  const rows = await windsor('youtube',
    ['date', 'subscriber_count', 'view_count', 'views', 'estimated_minutes_watched',
     'likes', 'comments', 'shares', 'subscribers_gained'],
    { date_preset: 'last_90d' });

  // agrega por dia (a API traz por vídeo×dia)
  const porDia: Record<string, any> = {};
  for (const r of rows) {
    if (!r.date) continue;
    const dia = String(r.date).slice(0, 10);
    const d = porDia[dia] || { views: 0, likes: 0, comments: 0, shares: 0, novos: 0, sub: null };
    d.views += num(r.views) || 0;
    d.likes += num(r.likes) || 0;
    d.comments += num(r.comments) || 0;
    d.shares += num(r.shares) || 0;
    d.novos += num(r.subscribers_gained) || 0;
    if (r.subscriber_count != null) d.sub = num(r.subscriber_count);
    porDia[dia] = d;
  }
  const ups = Object.entries(porDia).map(([dia, d]: [string, any]) => ({
    rede: 'youtube', dia,
    seguidores: d.sub,
    novos_seg: d.novos,
    alcance: null as number | null,
    views: d.views,
    interacoes: d.likes + d.comments + d.shares,
    contas_engaj: null as number | null,
    comentarios: d.comments,
    compart: d.shares,
    perfil_views: null as number | null,
    atualizado_em: new Date().toISOString(),
  }));
  if (ups.length) {
    const { error } = await supabaseGerador.from('social_daily').upsert(ups, { onConflict: 'rede,dia' });
    if (error) throw new Error('upsert social_daily YouTube: ' + error.message);
  }
  return ups.length;
}

// ─── YouTube: vídeos (ranking) ──────────────────────────────────────────────
async function syncYoutubePosts(): Promise<number> {
  const rows = await windsor('youtube',
    ['video', 'video_title', 'published_at', 'views', 'likes', 'comments',
     'shares', 'average_view_percentage', 'videourl', 'videoimage', 'creator_content_type'],
    { date_preset: 'last_year' });

  // agrega métricas por vídeo (a API traz por vídeo×dia)
  const porVideo: Record<string, any> = {};
  for (const r of rows) {
    const vid = r.video;
    if (!vid) continue;
    const v = porVideo[vid] || { titulo: r.video_title, pub: r.published_at, url: r.videourl, img: r.videoimage, tipo: r.creator_content_type, views: 0, likes: 0, coments: 0, shares: 0, watch: numF(r.average_view_percentage) };
    v.views += num(r.views) || 0;
    v.likes += num(r.likes) || 0;
    v.coments += num(r.comments) || 0;
    v.shares += num(r.shares) || 0;
    porVideo[vid] = v;
  }
  const ups = Object.entries(porVideo).map(([vid, v]: [string, any]) => ({
    media_id: 'yt_' + vid,
    rede: 'youtube',
    tipo: v.tipo === 'shorts' ? 'SHORT' : 'VIDEO',
    legenda: v.titulo || null,
    publicado_em: v.pub || null,
    thumbnail_url: v.img || null,
    permalink: v.url || null,
    likes: v.likes, comentarios: v.coments, salvos: 0, compart: v.shares,
    alcance: 0,
    views: v.views,
    watch_full: v.watch,
    engajamento: v.likes + v.coments + v.shares,
    atualizado_em: new Date().toISOString(),
  }));
  if (ups.length) {
    const { error } = await supabaseGerador.from('social_posts').upsert(ups, { onConflict: 'media_id' });
    if (error) throw new Error('upsert social_posts YouTube: ' + error.message);
  }
  return ups.length;
}

// ─── Orquestrador (chamado pelo cron) ───────────────────────────────────────
// Cada etapa é isolada: se uma rede/seção falhar, as outras seguem.
export async function syncSocialWindsor(): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const steps: Array<[string, () => Promise<number>]> = [
    ['ig_daily', syncInstagramDaily],
    ['ig_posts', syncInstagramPosts],
    ['ig_audience', syncInstagramAudience],
    ['tt_daily', syncTiktokDaily],
    ['tt_posts', syncTiktokPosts],
    ['yt_daily', syncYoutubeDaily],
    ['yt_posts', syncYoutubePosts],
  ];
  for (const [nome, fn] of steps) {
    try {
      out[nome] = await fn();
    } catch (e) {
      out[nome] = 'erro';
      logger.error('social-windsor', `falha em ${nome}`, e);
    }
  }
  logger.info('social-windsor', 'sync social concluído', out);
  return out;
}
