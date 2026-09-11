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

const LOG = 'prospeccao-ig';
const GRAPH = 'https://graph.instagram.com/v25.0';

const desligado = () => (process.env.PROSPECCAO_IA_OFF || '').trim() === 'true';

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

async function historico(contatoId: string) {
  const { data } = await supabaseGerador.from('prospeccao_conversas')
    .select('de, texto').eq('contato_id', contatoId)
    .order('criado_em', { ascending: true }).limit(20);
  return (data ?? []).map(m => ({ de: m.de as 'nos' | 'lead', texto: m.texto }));
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

  // FALA, PROVA, LINK — nesta ordem, sempre. A primeira mensagem prometeu
  // material; aqui a promessa é paga. A imagem vai por sendDM direto porque o
  // `enviar` que o webhook passa só sabe texto, e trocar a assinatura dele
  // mexeria em todo o fluxo de comentário→DM por causa da prospecção.
  const plano = planoDeEnvio(v, c.id, 'instagram');
  for (const passo of plano) {
    try {
      if (passo.tipo === 'texto') {
        await enviar(igsid, passo.texto);
        await guardar(c.id, 'nos', passo.texto, null);
      } else {
        await sendDM(igUserId, igsid, { image: { url: passo.url } }, token);
        await guardar(c.id, 'nos', `[imagem] ${MATERIAL[passo.chave].nome}`, null);
      }
      // Gente não manda três mensagens no mesmo segundo. Imagem demora mais
      // porque a Meta busca o arquivo antes de entregar.
      await new Promise(r => setTimeout(r, passo.tipo === 'imagem' ? 2600 : 1500));
    } catch (err) {
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
    obs: `IA(ig): ${v.intencao}${v.escalar ? ' · PRECISA DE HUMANO' : ''}`
      + `${v.material?.length ? ' · material: ' + v.material.join(',') : ''}`
      + `: ${v.motivo}`.slice(0, 400),
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
