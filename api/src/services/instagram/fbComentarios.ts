// ─────────────────────────────────────────────────────────────────────────────
// Comentário no FACEBOOK → resposta privada (05/08/2026).
//
// Por que existe: as três regras "Comentar para enviar mensagem" da Meta, que o
// Thiago desligou hoje, valiam pra Messenger E Instagram. O nosso motor só
// falava Instagram — então o Facebook ficou mudo, e é lá que estão comentários
// como "Fechamento." (duas vezes, no anúncio do Kit), "Gostaria de saber mais
// informações e fazer um orçamento" e "Tenho interesse, entra em contato".
//
// Mesmas automações, mesmo roteamento (`decidirComentario`), mesmo depósito de
// lead no CRM. O que muda é só o transporte:
//   • descoberta por VARREDURA, não por webhook — o app do Instagram tem
//     webhook próprio, e ligar webhook de Página exigiria mexer no painel da
//     Meta. A varredura roda no cron que já existe (5 em 5 minutos).
//   • envio pelo /{comment-id}/private_replies com token de PÁGINA.
//   • sem porteiro: no Facebook não existe "me segue" — o link vai direto.
//
// A Meta só aceita UMA resposta privada por comentário, e só até 7 dias depois
// dele. O dedup por `ig_events.ref` é o que garante a regra do "uma".
//
// Kill-switch: FB_COMENTARIOS_OFF='true'.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { loadAutomations, decidirComentario, depositarOuAvisar } from './igEngine';

const GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_ID = process.env.META_LEADS_PAGE_ID || '704395102766155';        // Irmãos Na Obra
const SU_TOKEN = process.env.META_SYSTEM_USER_TOKEN || '';

const MAX_POR_RODADA = 10;          // teto anti-ban por varredura
const SPACING_MS = 800;
const JANELA_DIAS = 7;              // private reply expira em 7 dias
const CHAVE_ESTADO = 'fb_coment_varredura';

const desligado = (): boolean => (process.env.FB_COMENTARIOS_OFF || '').trim() === 'true';

interface Comentario {
  id: string; message: string; created_time: string;
  fromId: string | null; fromName: string | null;
  postId: string; ehAnuncio: boolean;
}

async function graph(path: string, token: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${token}`);
  const t = await r.text();
  if (!r.ok) throw new Error(`graph ${path.split('?')[0]} ${r.status}: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return {}; }
}

/** Token da PÁGINA (o de sistema não posta resposta privada sozinho). */
async function pageToken(): Promise<string | null> {
  const j = await graph('me/accounts?fields=id,access_token&limit=50', SU_TOKEN);
  const pg = (j.data || []).find((p: any) => String(p.id) === String(PAGE_ID));
  return pg?.access_token || null;
}

/**
 * Posts que valem varredura: os publicados na Página + os posts dos anúncios
 * ATIVOS. O segundo é o que importa de verdade — anúncio é dark post, não
 * aparece no feed da Página (`/posts` devolve zero comentário nesses), e é ali
 * que o comentário caro acontece.
 *
 * As contas de anúncio vêm de `/me/adaccounts` em vez de env fixa: a casa roda
 * em duas (Ekent Pré-Paga e a "1"), e as duas têm anúncio ativo. O prefixo
 * `act_` é obrigatório no Graph — sem ele a chamada devolve lista vazia em
 * silêncio, que foi o que quase me fez concluir "não tem anúncio ativo".
 */
interface Alvo { id: string; ehAnuncio: boolean; destino: string }

// Destinos que não dizem nada sobre o produto (anúncio de clique-pra-Messenger).
const DESTINO_VAZIO = ['fb.me', 'm.me', 'facebook.com', 'instagram.com'];

/** host + caminho, sem query — é assim que o link do anúncio casa com o da automação. */
function chaveUrl(u: string | null | undefined): string {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    const x = new URL(s.startsWith('http') ? s : 'https://' + s);
    if (DESTINO_VAZIO.some(d => x.hostname.endsWith(d))) return '';
    return (x.hostname + x.pathname).replace(/\/+$/, '').toLowerCase();
  } catch { return ''; }
}

async function postsParaVarrer(token: string): Promise<Alvo[]> {
  const alvos = new Map<string, Alvo>();
  try {
    const feed = await graph(`${PAGE_ID}/published_posts?fields=id&limit=25`, token);
    for (const p of feed.data || []) alvos.set(p.id, { id: p.id, ehAnuncio: false, destino: '' });
  } catch (err) { logger.error('fb', 'feed da página falhou', err); }
  try {
    const contas = await graph('me/adaccounts?fields=id&limit=10', SU_TOKEN);
    for (const c of contas.data || []) {
      const act = String(c.id).startsWith('act_') ? String(c.id) : 'act_' + c.id;
      try {
        const ads = await graph(
          `${act}/ads?fields=effective_status,updated_time,creative{effective_object_story_id,object_story_spec}&limit=200`,
          SU_TOKEN,
        );
        for (const a of ads.data || []) {
          // Pausado recente entra também: o anúncio do Kit foi pausado há 6
          // dias e tem dois "Fechamento." de 4 dias esperando resposta — dentro
          // da janela de 7 dias da Meta. Pausado antigo fica de fora (a janela
          // já venceu e varrer 167 posts a cada 5 min estouraria o rate limit).
          const mexidoHa = a.updated_time ? Date.now() - new Date(a.updated_time).getTime() : Infinity;
          if (a.effective_status !== 'ACTIVE' && mexidoHa > JANELA_DIAS * 24 * 3600 * 1000) continue;
          const sid: string = a?.creative?.effective_object_story_id || '';
          // O id do post é "{pagina}_{post}". Anúncio de OUTRA página (a casa
          // tem mais de uma) não é nosso assunto e nem temos token dele.
          if (!sid || !sid.startsWith(PAGE_ID + '_')) continue;
          const spec = a?.creative?.object_story_spec || {};
          const destino = spec?.link_data?.link
            || spec?.video_data?.call_to_action?.value?.link
            || spec?.link_data?.call_to_action?.value?.link || '';
          alvos.set(sid, { id: sid, ehAnuncio: true, destino });   // anúncio ganha do orgânico
        }
      } catch (err) { logger.error('fb', `anúncios de ${act} falharam`, err); }
    }
  } catch (err) { logger.error('fb', 'lista de contas de anúncio falhou', err); }
  return [...alvos.values()];
}

/**
 * Anúncio manda no produto. Metade dos anúncios ativos da Página é LimpaPro
 * (limpapro.solardoc.app), que NÃO tem automação aqui — responder aqueles
 * comentários com o menu "SOLAR / ELETROPOSTO / BIKE" seria falar de outro
 * produto com quem perguntou de limpeza.
 *
 * Devolve: a automação do destino, `null` quando o destino não diz nada (o
 * roteamento por palavra-chave decide), ou 'pular' quando o destino é de um
 * produto que não é atendido aqui.
 */
export function automacaoDoDestino(destino: string, autos: any[]): any | null | 'pular' {
  const alvo = chaveUrl(destino);
  if (!alvo) return null;                                  // fb.me, vazio: sem pista
  for (const a of autos) {
    const l = chaveUrl(a.link_url);
    if (l && (alvo === l || alvo.startsWith(l) || l.startsWith(alvo))) return a;
  }
  return 'pular';                                          // produto sem automação (LimpaPro)
}

async function comentariosDoPost(postId: string, ehAnuncio: boolean, token: string): Promise<Comentario[]> {
  const j = await graph(
    `${postId}/comments?fields=id,message,created_time,from&filter=stream&order=reverse_chronological&limit=25`,
    token,
  );
  return (j.data || []).map((c: any) => ({
    id: c.id, message: c.message || '', created_time: c.created_time,
    fromId: c.from?.id || null, fromName: c.from?.name || null,
    postId, ehAnuncio,
  }));
}

async function jaRespondido(commentId: string): Promise<boolean> {
  const { data } = await supabase.from('ig_events').select('id').eq('ref', commentId).limit(1);
  return !!(data && data.length);
}

const RE_TELEFONE = /(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/;
function telefoneDe(texto: string): string | null {
  const m = (texto || '').match(RE_TELEFONE);
  if (!m) return null;
  const d = m[0].replace(/\D/g, '');
  return d.length >= 10 ? d : null;
}

async function responderPrivado(commentId: string, texto: string, token: string): Promise<any> {
  const r = await fetch(`${GRAPH}/${commentId}/private_replies`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: texto, access_token: token }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`private_replies ${r.status}: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return {}; }
}

async function responderPublico(commentId: string, texto: string, token: string): Promise<void> {
  try {
    await fetch(`${GRAPH}/${commentId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: texto, access_token: token }),
    });
  } catch (err) { logger.error('fb', 'resposta pública falhou', err); }
}

const pick = <T,>(arr: T[]): T | null => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

/** Varredura completa. Chamada pelo cron; devolve o que fez pro painel/log. */
export async function varrerComentariosFacebook(): Promise<{ respondidos: number; vistos: number; posts_pulados?: number; reason?: string }> {
  if (desligado()) return { respondidos: 0, vistos: 0, reason: 'desligado' };
  if (!SU_TOKEN) return { respondidos: 0, vistos: 0, reason: 'sem_token' };

  const token = await pageToken();
  if (!token) return { respondidos: 0, vistos: 0, reason: 'sem_token_de_pagina' };

  const autos = await loadAutomations();
  const posts = await postsParaVarrer(token);
  const limite = Date.now() - JANELA_DIAS * 24 * 3600 * 1000;

  let vistos = 0, respondidos = 0, pulados = 0;
  for (const post of posts) {
    if (respondidos >= MAX_POR_RODADA) break;

    // Produto do anúncio antes de tudo: se o destino é de um produto que não
    // tem automação aqui, o post inteiro fica de fora.
    const doDestino = automacaoDoDestino(post.destino, autos);
    if (doDestino === 'pular') { pulados++; continue; }

    let comentarios: Comentario[] = [];
    try { comentarios = await comentariosDoPost(post.id, post.ehAnuncio, token); }
    catch (err) { logger.error('fb', `comentários de ${post.id} falharam`, err); continue; }

    for (const c of comentarios) {
      if (respondidos >= MAX_POR_RODADA) break;
      if (!c.message.trim()) continue;
      if (c.fromId && String(c.fromId) === String(PAGE_ID)) continue;        // eco da própria Página
      if (new Date(c.created_time).getTime() < limite) continue;             // fora da janela de 7 dias
      vistos++;
      if (await jaRespondido(c.id)) continue;

      // Destino do anúncio ganha do texto (é a mesma regra do Instagram, onde
      // automação fixada na mídia ganha do roteamento por palavra-chave).
      const a = doDestino || decidirComentario(autos, { texto: c.message, mediaId: post.id, ehAnuncio: post.ehAnuncio });
      if (!a) continue;

      // Sem porteiro: no Facebook não existe "me segue" que valha o toque a
      // mais, então o link vai junto da primeira mensagem.
      const texto = (a.dm_boas_vindas || 'Oi! Aqui está o que você pediu:')
        + (a.link_url ? '\n\n' + a.link_url : '');

      try {
        const resp = await responderPrivado(c.id, texto, token);
        await supabase.from('ig_events').insert({
          tipo: 'fb_private_reply', ref: c.id,
          raw: { post: post.id, ehAnuncio: post.ehAnuncio, de: c.fromName, texto: c.message, automacao: a.id, resposta: resp },
        });
        respondidos++;
        const pub = pick<string>(a.respostas_publicas || []);
        if (pub) await responderPublico(c.id, pub, token);
      } catch (err: any) {
        // Não marca como respondido: erro aqui costuma ser janela vencida ou
        // pessoa sem Messenger, e na próxima varredura a gente tenta de novo.
        logger.error('fb', `resposta privada em ${c.id} falhou`, err);
        await supabase.from('ig_events').insert({
          tipo: 'fb_falha', ref: null,
          raw: { comentario: c.id, erro: String(err?.message || err).slice(0, 300) },
        });
      }

      const tel = telefoneDe(c.message);
      if (tel) {
        await depositarOuAvisar({
          produto: a.produto || (String(a.link_url || '').includes('/io/eletroposto') ? 'eletroposto' : 'solar'),
          nome: c.fromName || 'Lead Facebook',
          whatsapp: tel,
          contact_id: 'fb_' + (c.fromId || c.id),
          origem: 'comentário no Facebook',
        });
      }

      await new Promise(r => setTimeout(r, SPACING_MS));
    }
  }

  await supabase.from('system_state').upsert(
    { key: CHAVE_ESTADO, value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  return { respondidos, vistos, posts_pulados: pulados };
}
