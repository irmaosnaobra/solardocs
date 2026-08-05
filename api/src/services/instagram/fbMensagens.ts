// ─────────────────────────────────────────────────────────────────────────────
// INBOUND do Messenger (05/08/2026) — a outra metade do Facebook.
//
// Sem isto, o que fizemos hoje seria meio caminho: a gente responde o
// comentário no direct e não escuta a resposta. Quem escreve "quero" no
// Messenger cai num inbox que ninguém abre — exatamente o buraco que existia
// no Instagram (11 conversas de DM sem resposta em 7 dias).
//
// Como funciona: varredura das conversas da Página no mesmo cron de 5 min
// (webhook de Página exigiria configurar outro app no painel da Meta).
//   • mensagem nova → roteia pelas MESMAS automações (gatilho `dm`);
//   • não casou nada → manda o menu UMA vez e avisa o Thiago no WhatsApp, que
//     é o que transforma "lead no vácuo" em atendimento humano;
//   • telefone na conversa → card no CRM, igual ao Instagram.
//
// Janela de 24h da Meta vale aqui também: só respondemos quem falou com a
// gente, então toda resposta desta varredura é permitida.
//
// Kill-switch: FB_INBOX_OFF='true'.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { ingestManychatLead } from '../agenda/manychatLeadService';
import { sendWhatsApp } from '../agents/zapiClient';
import { loadAutomations } from './igEngine';

const GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_ID = process.env.META_LEADS_PAGE_ID || '704395102766155';
const SU_TOKEN = process.env.META_SYSTEM_USER_TOKEN || '';
const NOTIFY = (process.env.IO_INDICACOES_NOTIFY || '34991360223').trim();

const MAX_POR_RODADA = 12;
const SPACING_MS = 700;

const desligado = (): boolean => (process.env.FB_INBOX_OFF || '').trim() === 'true';

const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const norm = (s: string): string => (s || '').toLowerCase().normalize('NFD').replace(ACENTOS, '').trim();

const RE_TELEFONE = /(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/;
function telefoneDe(texto: string): string | null {
  const m = (texto || '').match(RE_TELEFONE);
  if (!m) return null;
  const d = m[0].replace(/\D/g, '');
  return d.length >= 10 ? d : null;
}

async function graph(path: string, token: string): Promise<any> {
  const r = await fetch(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${token}`);
  const t = await r.text();
  if (!r.ok) throw new Error(`graph ${path.split('?')[0]} ${r.status}: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return {}; }
}

async function pageToken(): Promise<string | null> {
  const j = await graph('me/accounts?fields=id,access_token&limit=50', SU_TOKEN);
  return (j.data || []).find((p: any) => String(p.id) === String(PAGE_ID))?.access_token || null;
}

async function jaVisto(ref: string): Promise<boolean> {
  const { data } = await supabase.from('ig_events').select('id').eq('ref', ref).limit(1);
  return !!(data && data.length);
}

/** Casou palavra-chave de alguma automação com gatilho de DM? */
function escolherPorTexto(autos: any[], texto: string): any | null {
  const t = norm(texto);
  let melhor: any = null, melhorScore = -1;
  for (const a of autos) {
    if (!a.gatilhos?.dm) continue;
    if (a.fallback) continue;
    if (a.match_tipo === 'qualquer') continue;            // fixada em mídia; não vale pra DM solta
    let peso = 0;
    for (const k of (a.palavras_chave || []).map(norm).filter(Boolean)) {
      if (t.includes(k) && k.length > peso) peso = k.length;
    }
    if (!peso) continue;
    const score = (1000 - Math.min(a.prioridade ?? 100, 999)) * 1000 + peso;
    if (score > melhorScore) { melhorScore = score; melhor = a; }
  }
  return melhor;
}

/** O menu ("SOLAR / ELETROPOSTO / BIKE") — a pergunta que o dono pediu. */
function menuDe(autos: any[]): any | null {
  return autos.find(a => a.fallback) || autos.find(a => !a.link_url && a.gatilhos?.dm) || null;
}

async function responder(psid: string, texto: string, token: string): Promise<any> {
  const r = await fetch(`${GRAPH}/${PAGE_ID}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: psid }, message: { text: texto }, messaging_type: 'RESPONSE', access_token: token }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`messages ${r.status}: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return {}; }
}

/** Aviso pro humano: lead que o robô não soube responder não pode morrer no inbox. */
async function avisarTime(nome: string, texto: string): Promise<void> {
  try {
    await sendWhatsApp(
      NOTIFY,
      `*MENSAGEM NO FACEBOOK* (Irmãos na Obra)\n\n` +
      `*De:* ${nome || 'sem nome'}\n` +
      `*Disse:* ${texto.slice(0, 300)}\n\n` +
      `_O robô mandou o menu. Se for atendimento, responder pela caixa de entrada da Página._`,
      'io',
    );
  } catch (err) { logger.error('fb-inbox', 'aviso do time falhou', err); }
}

/** Varredura do inbox da Página. Chamada pelo cron. */
export async function varrerInboxFacebook(): Promise<{ respondidos: number; novos: number; reason?: string }> {
  if (desligado()) return { respondidos: 0, novos: 0, reason: 'desligado' };
  if (!SU_TOKEN) return { respondidos: 0, novos: 0, reason: 'sem_token' };
  const token = await pageToken();
  if (!token) return { respondidos: 0, novos: 0, reason: 'sem_token_de_pagina' };

  let conversas: any[] = [];
  try {
    const j = await graph(
      `${PAGE_ID}/conversations?fields=id,updated_time,participants,messages.limit(6){id,message,from,created_time}&limit=25`,
      token,
    );
    conversas = j.data || [];
  } catch (err) { logger.error('fb-inbox', 'conversas falharam', err); return { respondidos: 0, novos: 0, reason: 'erro' }; }

  const autos = await loadAutomations();
  const menu = menuDe(autos);
  let respondidos = 0, novos = 0;

  for (const conv of conversas) {
    if (respondidos >= MAX_POR_RODADA) break;
    const msgs = (conv?.messages?.data || []).slice().reverse();   // mais antiga primeiro
    const ultima = msgs[msgs.length - 1];
    if (!ultima) continue;
    // A última palavra é nossa? Então já foi respondido — não insiste.
    if (String(ultima?.from?.id) === String(PAGE_ID)) continue;

    const psid = ultima?.from?.id;
    const nome = ultima?.from?.name || '';
    if (!psid) continue;
    if (await jaVisto(ultima.id)) continue;
    novos++;

    const texto = String(ultima.message || '').trim();
    await supabase.from('ig_events').insert({
      tipo: 'fb_message', ref: ultima.id,
      raw: { conversa: conv.id, de: nome, psid, texto },
    });
    if (!texto) continue;

    const a = escolherPorTexto(autos, texto);
    const escolhida = a || menu;
    if (!escolhida) continue;

    const corpo = (escolhida.dm_boas_vindas || 'Oi! Me conta o que você procura que eu te ajudo.')
      + (escolhida.link_url ? '\n\n' + escolhida.link_url : '');

    try {
      await responder(psid, corpo, token);
      respondidos++;
      await supabase.from('ig_events').insert({
        tipo: 'fb_message_reply', ref: null,
        raw: { psid, automacao: escolhida.id, casou: !!a },
      });
      // Sem palavra-chave = o robô não sabe o produto. O menu já foi, mas quem
      // fecha venda é gente: o Thiago recebe o texto no WhatsApp.
      if (!a) await avisarTime(nome, texto);
    } catch (err) {
      logger.error('fb-inbox', `resposta a ${psid} falhou`, err);
      await avisarTime(nome, texto);                 // não conseguiu responder: humano assume
    }

    const tel = telefoneDe(texto);
    if (tel) {
      try {
        await ingestManychatLead({
          produto: escolhida.produto || (String(escolhida.link_url || '').includes('/io/eletroposto') ? 'eletroposto' : 'solar'),
          nome: nome || 'Lead Facebook',
          whatsapp: tel,
          contact_id: 'fbm_' + psid,
        });
      } catch (err) { logger.error('fb-inbox', 'depósito no CRM falhou', err); }
    }

    await new Promise(r => setTimeout(r, SPACING_MS));
  }

  return { respondidos, novos };
}
