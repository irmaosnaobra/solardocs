// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO × INSTAGRAM — a ponte que fecha o laço.
//
// A primeira DM sai pelo navegador (a API da Meta não abre conversa com quem
// nunca respondeu). Da resposta em diante é AQUI: a Meta entrega a mensagem no
// webhook, esta função descobre de quem é, monta o histórico, chama a mesma IA
// que já responde no WhatsApp, e devolve pela API oficial.
//
// Por que não raspar a tela: testei contra o Instagram real e o botão "Message"
// no perfil abre só um compositor, sem o histórico. A caixa de entrada voltou
// vazia. O webhook não tem esse problema — a Meta entrega o texto pronto, e não
// quebra quando o layout muda.
//
// O PULO DO GATO é o vínculo: o webhook dá um IGSID numérico e a ficha tem o @.
// A Graph API resolve um pelo outro, UMA vez, e o vínculo fica gravado.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { decidirResposta, planoDeEnvio, MATERIAL } from './prospeccaoResposta';
import { sendDM } from '../instagram/igClient';
import { carimbarEnvioIg } from '../instagram/igLivro';

const LOG = 'prospeccao-ig';
const GRAPH = 'https://graph.instagram.com/v25.0';

const desligado = () => (process.env.PROSPECCAO_IA_OFF || '').trim() === 'true';

/** Espera sorteada entre duas mensagens do mesmo turno: de 2 a 6 s. Só ENTRE mensagens, nunca depois da última. */
export const esperaEntreMensagensMs = () => 2000 + Math.floor(Math.random() * 4001);

/** Quem é esse IGSID? Primeiro no banco; só chama a Meta se for desconhecido. */
async function acharContato(igsid: string, token: string) {
  const { data: porId } = await supabaseGerador
    .from('prospeccao_contatos')
    .select('id, empresa, cidade, instagram, bloqueado, lista_id')
    .eq('ig_user_id', igsid).limit(1);
  if (porId?.[0]) return porId[0];

  // Desconhecido: pergunta o @ pra Meta e casa com a ficha.
  let username = '';
  try {
    const r = await fetch(`${GRAPH}/${igsid}?fields=username&access_token=${encodeURIComponent(token)}`);
    if (r.ok) username = String(((await r.json()) as { username?: string })?.username || '');
  } catch (err) { logger.error(LOG, 'resolver username falhou', err); }
  if (!username) return null;

  const { data: porUser } = await supabaseGerador
    .from('prospeccao_contatos')
    .select('id, empresa, cidade, instagram, bloqueado, lista_id')
    .ilike('instagram', username).limit(1);
  if (!porUser?.[0]) return null;

  // Grava o vínculo: da próxima vez não precisa perguntar de novo.
  await supabaseGerador.from('prospeccao_contatos')
    .update({ ig_user_id: igsid }).eq('id', porUser[0].id);
  return porUser[0];
}

async function guardar(contatoId: string, de: 'nos' | 'lead', texto: string, mid?: string | null) {
  const { error } = await supabaseGerador.from('prospeccao_conversas')
    .insert({ contato_id: contatoId, canal: 'instagram', de, texto: texto.slice(0, 2000), mid: mid || null });
  // Erro de chave duplicada = webhook reentregou a mesma mensagem. É esperado.
  if (error && !String(error.message || '').includes('duplicate')) {
    logger.error(LOG, 'guardar mensagem falhou', error);
  }
  return !error;
}

// O link do diagnóstico (quiz) tem sempre este trecho. Marca a "saída do link" no histórico.
const FRAGMENTO_LINK = 'solardoc.app/diagnostico';
const JANELA_LINK_MS = 2 * 60 * 1000;

/**
 * Reserva a saída do link: grava a mensagem de saída em prospeccao_conversas (sem DDL, com um
 * `mid` próprio) e relê os links gravados nos últimos 2 minutos. Só segue quem ficou em PRIMEIRO.
 * Devolve o `mid` da reserva (para desfazer se o envio falhar) ou null se outra chamada chegou antes.
 */
export async function reservarEnvioLink(contatoId: string, texto: string): Promise<string | null> {
  const mid = `link:${contatoId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await supabaseGerador.from('prospeccao_conversas')
    .insert({ contato_id: contatoId, canal: 'instagram', de: 'nos', texto: texto.slice(0, 2000), mid });
  if (error) { logger.error(LOG, 'reservar o link falhou', error); return null; }   // sem a trava, não envia
  const desde = new Date(Date.now() - JANELA_LINK_MS).toISOString();
  const { data, error: e2 } = await supabaseGerador.from('prospeccao_conversas')
    .select('mid, texto, criado_em').eq('contato_id', contatoId).eq('de', 'nos')
    .gte('criado_em', desde).order('criado_em', { ascending: true }).limit(50);
  if (e2) { logger.error(LOG, 'reler o link falhou', e2); await marcarLinkNaoEnviado(mid); return null; }
  const links = ((data ?? []) as Array<{ mid?: string | null; texto?: string; criado_em?: string }>)
    .filter(l => String(l.texto || '').includes(FRAGMENTO_LINK))
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)) || String(a.mid).localeCompare(String(b.mid)));
  if (links[0]?.mid === mid) return mid;
  await marcarLinkNaoEnviado(mid);
  return null;
}

/** A reserva não virou envio (perdeu a corrida ou o envio falhou): APAGA a própria linha, pelo mid, para
 *  que ela não conte como "link já enviado". Se o delete falhar, registra no log. */
async function marcarLinkNaoEnviado(mid: string) {
  const { error } = await supabaseGerador.from('prospeccao_conversas').delete().eq('mid', mid);
  if (error) logger.error(LOG, `apagar a reserva do link (${mid}) falhou`, error);
}

// Restos de versões anteriores: esta marca nunca vai para a IA.
const MARCA_LINK_NAO_ENVIADO = '[link não enviado]';

// As 20 MAIS RECENTES, em ordem de conversa. Ler em ordem crescente com limite
// devolveria as 20 mais antigas, e "a última fala nossa foi a oferta?" erraria
// em conversa longa.
async function historico(contatoId: string) {
  const { data } = await supabaseGerador.from('prospeccao_conversas')
    .select('de, texto').eq('contato_id', contatoId)
    .order('criado_em', { ascending: false }).limit(20);
  return (data ?? []).filter(m => m.texto !== MARCA_LINK_NAO_ENVIADO)
    .map(m => ({ de: m.de as 'nos' | 'lead', texto: m.texto })).reverse();
}

/**
 * Chamado pelo webhook a cada DM recebida.
 * Devolve true se ESTA mensagem era de um contato da prospecção e foi tratada —
 * aí o fluxo de comentário→DM não mexe nela.
 */
export async function tratarRespostaProspeccao(
  igsid: string, texto: string, mid: string | null,
  igUserId: string, token: string,
  enviar: (recipiente: string, texto: string) => Promise<void>,
): Promise<boolean> {
  if (!texto?.trim()) return false;

  const c = await acharContato(igsid, token);
  if (!c) return false;                       // não é da prospecção — segue o fluxo normal

  const novo = await guardar(c.id, 'lead', texto, mid);
  if (!novo) return true;                     // já tratada; consome pra não duplicar

  if (c.bloqueado) {
    logger.info(LOG, `${c.empresa} está bloqueado — não respondo`);
    return true;
  }
  if (desligado()) { logger.warn(LOG, 'PROSPECCAO_IA_OFF=true — guardei e não respondo'); return true; }

  const hist = await historico(c.id);
  const v = await decidirResposta({
    empresa: c.empresa, cidade: c.cidade, produto_id: 'solardoc',
    contato_id: c.id, canal: 'instagram', historico: hist,
  });
  if (!v) { logger.error(LOG, `IA não respondeu sobre ${c.empresa} — fica pro humano`); return true; }

  // Resposta automática do perfil: a mensagem recebida já foi guardada lá em cima
  // (guardar). Não envia nada e NÃO grava toque: qualquer resultado diferente de
  // "enviei" trava o contato para sempre no robô, e quem escreveu foi um robô.
  if (v.nao_enviar) {
    logger.info(LOG, `${c.empresa}: resposta automática do perfil — não respondo e não gravo toque`);
    return true;
  }

  // FALA, PROVA, LINK — nesta ordem, sempre. A primeira mensagem prometeu
  // material; aqui a promessa é paga. A imagem vai por sendDM direto porque o
  // `enviar` que o webhook passa só sabe texto, e trocar a assinatura dele
  // mexeria em todo o fluxo de comentário→DM por causa da prospecção.
  const plano = planoDeEnvio(v, c.id, 'instagram');
  let n = 0;
  let linkSaiu = false;
  for (const passo of plano) {
    // Gente não manda duas mensagens no mesmo segundo: de 2 a 6 s ENTRE elas,
    // sorteado. Não espera depois da última.
    if (n > 0) await new Promise(r => setTimeout(r, esperaEntreMensagensMs()));
    n++;
    const ehLink = passo.tipo === 'texto' && passo.texto.includes(FRAGMENTO_LINK);
    let midLink: string | null = null;
    try {
      if (ehLink && passo.tipo === 'texto') {
        // Corrida do link duplo: grava a saída do link ANTES de enviar e relê. Se outra
        // chamada já gravou um link nos últimos 2 minutos, este não sai.
        midLink = await reservarEnvioLink(c.id, passo.texto);
        if (!midLink) { logger.warn(LOG, `${c.empresa}: link já enviado há pouco por outra chamada — não envio de novo`); continue; }
      }
      if (passo.tipo === 'texto') {
        await enviar(igsid, passo.texto);
        // A oferta fixa fica gravada como fala nossa com o texto exato: é assim
        // que o código reconhece, no turno seguinte, que o "sim" é à oferta.
        // O link já foi gravado na reserva, acima.
        if (!ehLink) await guardar(c.id, 'nos', passo.texto, null);
        else linkSaiu = true;
      } else {
        await sendDM(igUserId, igsid, { image: { url: passo.url } }, token);
        await guardar(c.id, 'nos', `[imagem] ${MATERIAL[passo.chave].nome}`, null);
      }
      // Toda mensagem que saiu pela página conta no teto de 180/h do igEngine:
      // mesmo livro `ig_sent:`, uma chave única por mensagem.
      // O upsert não lança: o erro vem em { error }. Registra e segue, sem derrubar o envio.
      try {
        const r = await carimbarEnvioIg(`prosp:${c.id}:${Date.now()}:${n}`);
        if (r?.error) console.warn(`[${LOG}] carimbo ig_sent falhou para ${c.empresa} (${c.id}): ${String(r.error.message || r.error)}`);
      } catch (e) { console.warn(`[${LOG}] carimbo ig_sent explodiu para ${c.empresa} (${c.id}):`, e); }
    } catch (err) {
      if (midLink) await marcarLinkNaoEnviado(midLink);
      // Uma imagem que não sobe NÃO pode engolir o link que vem depois: a
      // pessoa pediu pra ver e ficaria sem nada. Só texto que falha interrompe.
      logger.error(LOG, `envio pra ${c.empresa} falhou (${passo.tipo})`, err);
      if (passo.tipo === 'texto') break;
    }
  }

  // O desfecho vai pro MESMO log de toques da tela — funil, disjuntor e radar
  // continuam batendo. Resposta não consome o teto de abordagem fria.
  await supabaseGerador.from('prospeccao_toques').insert({
    contato_id: c.id, lista_id: c.lista_id, produto_id: 'solardoc',
    consultor: process.env.PROSPECCAO_CONSULTOR || 'irmaosnaobra__',
    resultado: v.resultado, valor: 0,
    obs: (`IA(ig): ${v.intencao}${v.escalar ? ' · PRECISA DE HUMANO' : ''}`
      + `${v.oferta ? ' · oferta' : ''}${linkSaiu ? ' · link' : ''}`
      + `${v.material?.length ? ' · material: ' + v.material.join(',') : ''}`
      + `: ${v.motivo}`).slice(0, 400),
  });

  if (v.resultado === 'nao_perturbar') {
    await supabaseGerador.from('prospeccao_contatos').update({ bloqueado: true }).eq('id', c.id);
    logger.info(LOG, `${c.empresa} pediu pra parar — bloqueado em todas as listas`);
  }
  if (v.escalar) logger.warn(LOG, `ESCALADO: ${c.empresa} — ${v.motivo}`);

  logger.info(LOG, `respondi ${c.empresa}: ${v.intencao} / ${v.resultado}`
    + `${v.material?.length ? ` · mandei ${v.material.length} imagem(ns)` : ''}`);
  return true;
}
