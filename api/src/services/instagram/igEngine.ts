// ─────────────────────────────────────────────────────────────────────────────
// Motor de automação do Instagram (comentário→DM, story→DM). Substituto do
// ManyChat, integrado ao nosso CRM: quando a pessoa manda um WhatsApp na DM,
// deposita o lead no rodízio/agenda via ingestManychatLead (reaproveita tudo).
//
// Regras da Meta respeitadas:
//   • Resposta privada a comentário FURA a janela de 24h (needs_window=false).
//   • DM/followup só saem com a janela de 24h ABERTA (needs_window=true).
//   • Teto ~200 DMs/h e ~2/s (anti-derrubada de conta).
// Gate: IG_AUTOMACAO_ENABLED='true' + conta conectada (ig_config com token).
//
// ESCOLHA DA AUTOMAÇÃO (não é mais "a primeira que casar"):
//   1) automação fixada na mídia/anúncio do comentário ganha de todas;
//   2) depois, menor `prioridade`;
//   3) empate: palavra-chave mais específica (a mais longa que casou).
// Se nada casar e o comentário tiver sinal de interesse (ou telefone), entra a
// automação marcada como `fallback`. Em anúncio a régua é larga — o clique já
// foi pago; em post orgânico só passa quem pede preço/contato, pra piada e
// elogio continuarem sem DM.
//
// PORTEIRO DO LINK (04/08, encurtado em 05/08): automação com link não entrega
// no primeiro toque. Pede pra seguir → a pessoa responde → link → followup 1h
// depois (ver igGate.ts). O toque "clica no botão" que abria isso foi removido.
//
// ENVIO INCERTO (05/08/2026): a Meta devolve 500/code 1 e entrega a mensagem
// assim mesmo. Erro nesse formato não vira reenvio nem resposta pública — vira
// status 'incerto' (ver igFalha.ts). Era o que dobrava a DM do lead.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ingestManychatLead } from '../agenda/manychatLeadService';
import { sendWhatsApp } from '../agents/zapiClient';
import {
  igEnv, getIgConfig, sendPrivateReply, sendDM, replyToComment,
  refreshLongToken, saveIgConfig,
} from './igClient';
import {
  GateEstado, GateEtapa, GateAcao, gateAtivo, gateAberto, acaoNaAbertura, acaoNaResposta,
  etapaDepois, payloadSeguir, nudgeGate, lembrete1h, L1H_ATRASO_MS, repetiriaOToque, conviteSeguir,
} from './igGate';
import { classificarFalha } from './igFalha';

const IG_MAX_POR_HORA = Number(process.env.IG_MAX_POR_HORA || 180);
const MAX_POR_TICK = 15;
const SPACING_MS = 500;                 // ~2/s

interface Automation {
  id: string; nome: string; ativo: boolean;
  gatilhos: { comment?: boolean; story?: boolean; dm?: boolean };
  palavras_chave: string[]; match_tipo: string; post_id: string | null;
  respostas_publicas: string[]; dm_boas_vindas: string | null;
  botao_rotulo: string | null; link_url: string | null;
  lembrete_texto: string | null; lembrete_horas: number;
  prioridade: number; midias: string[]; fallback: boolean; produto: string | null;
  // Porteiro (igGate): copy opcional por automação; nulo = usa o padrão.
  gate_off?: boolean | null;
  gate_seguir_texto?: string | null; gate_seguir_botao?: string | null;
  lembrete_1h_texto?: string | null; lembrete_1h_off?: boolean | null;
}

type Gatilho = 'comment' | 'story' | 'dm';

function ligado(): boolean { return igEnv().enabled; }
const pick = <T,>(arr: T[]): T | null => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null);

/** minúsculas + sem acento — "orçamento" e "orcamento" viram a mesma coisa. */
const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const norm = (s: string): string => (s || '').toLowerCase().normalize('NFD').replace(ACENTOS, '').trim();

// Sinais de que a pessoa quer atendimento (alimentam a rede de segurança).
// Em ANÚNCIO a lista é larga: o clique já foi pago, não dá pra deixar passar.
const SINAIS_INTERESSE = [
  'interess', 'quanto', 'preco', 'valor', 'orcament', 'informac', 'info',
  'como funciona', 'quero', 'gostaria', 'manda', 'whats', 'zap', 'contato', 'saber mais',
  'desconto', 'a vista', 'financia', 'parcel', 'custa', 'disponi', 'me chama', 'simula',
  'tem como', 'instala', 'consegue', 'aceita',
];
// Em post ORGÂNICO a régua é mais dura — ali passa piada, elogio e conversa de
// amigo, e "quanto tempo demorou isso?" não é pedido de orçamento. Só entra
// quem pede preço, contato ou diz que quer. (05/08: as regras da Meta, que
// respondiam comentário no orgânico também, foram desligadas — a rede de
// segurança passou a cobrir esse chão, senão o comentário ficava órfão.)
const SINAIS_FORTES = [
  'interess', 'quanto custa', 'quanto fica', 'quanto sai', 'custa', 'preco', 'valor',
  'orcament', 'informac', 'como funciona', 'saber mais', 'quero', 'gostaria',
  'me chama', 'whats', 'zap', 'contato', 'simula', 'financia', 'parcel',
  'a vista', 'desconto', 'disponi', 'instala',
];

const RE_TELEFONE = /(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}/;
const telefoneDe = (texto: string): string | null => {
  const m = (texto || '').match(RE_TELEFONE);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
};

/** Casou? E com que especificidade (tamanho da palavra que casou — pro desempate). */
function matchKeyword(text: string, kws: string[], tipo: string): { ok: boolean; peso: number } {
  const t = norm(text);
  if (tipo === 'qualquer') return { ok: true, peso: 0 };
  const lista = (kws || []).map(norm).filter(Boolean);
  if (!lista.length) return { ok: false, peso: 0 };
  if (tipo === 'exato') return { ok: lista.includes(t), peso: t.length };
  let peso = 0;
  for (const k of lista) if (t.includes(k) && k.length > peso) peso = k.length;
  return { ok: peso > 0, peso };
}

/** As automações ativas. Exportada porque o Facebook (fbComentarios) roteia
 *  comentário pelas MESMAS regras — é o mesmo funil, só muda a rede social. */
export async function loadAutomations(): Promise<Automation[]> {
  const { data } = await supabaseGerador.from('ig_automations').select('*').eq('ativo', true);
  return ((data as Automation[]) || []).map(a => ({
    ...a,
    prioridade: Number.isFinite(Number(a.prioridade)) ? Number(a.prioridade) : 100,
    midias: a.midias || [],
    fallback: !!a.fallback,
  }));
}

/** Melhor automação pro texto/mídia — ver regra no cabeçalho. */
function escolher(autos: Automation[], gatilho: Gatilho, texto: string, mediaId?: string | null, adId?: string | null): Automation | null {
  let melhor: Automation | null = null;
  let melhorScore = -1;
  for (const a of autos) {
    if (a.fallback) continue;                                   // fallback só entra se nada casar
    if (!a.gatilhos?.[gatilho]) continue;
    const alvos = [a.post_id, ...(a.midias || [])].filter(Boolean) as string[];
    const casaAlvo = alvos.some(x => x === mediaId || x === adId);
    if (alvos.length && !casaAlvo) continue;                    // fixada em OUTRA mídia
    const { ok, peso } = matchKeyword(texto, a.palavras_chave, a.match_tipo);
    if (!ok) continue;
    const score = (casaAlvo ? 1_000_000 : 0) + (1000 - Math.min(a.prioridade, 999)) * 1000 + peso;
    if (score > melhorScore) { melhorScore = score; melhor = a; }
  }
  return melhor;
}

/**
 * Decisão completa pra um comentário: qual automação responde (ou nenhuma).
 * Exportada pra ter teste — é a regra que faz lead virar ou não atendimento.
 */
export function decidirComentario(
  autos: Automation[],
  c: { texto: string; mediaId?: string | null; adId?: string | null; ehAnuncio?: boolean },
): Automation | null {
  const direto = escolher(autos, 'comment', c.texto, c.mediaId, c.adId);
  if (direto) return direto;
  const t = norm(c.texto);
  const temTel = !!telefoneDe(c.texto);
  const temSinal = (c.ehAnuncio ? SINAIS_INTERESSE : SINAIS_FORTES).some(k => t.includes(k));
  if (temTel || temSinal) {
    return autos.find(x => x.fallback && x.gatilhos?.comment) || null;
  }
  return null;
}

async function jaVisto(ref: string): Promise<boolean> {
  if (!ref) return false;
  const { data } = await supabase.from('ig_events').select('id').eq('ref', ref).limit(1);
  return !!(data && data.length);
}
async function logEvent(tipo: string, ref: string | null, raw: any): Promise<void> {
  await supabase.from('ig_events').insert({ tipo, ref, raw });
}
async function upsertContact(igUserId: string, username: string | null, automationId: string | null, reply: boolean): Promise<void> {
  const patch: any = { ig_user_id: igUserId, updated_at: new Date().toISOString() };
  if (username) patch.username = username;
  if (automationId) patch.last_automation_id = automationId;
  if (reply) patch.last_reply_at = new Date().toISOString();
  await supabase.from('ig_contacts').upsert(patch, { onConflict: 'ig_user_id' });
}
async function enqueue(item: { tipo: string; automation_id: string | null; recipient: string; payload: any; needs_window: boolean; enviar_apos?: string }): Promise<void> {
  await supabase.from('ig_queue').insert({
    tipo: item.tipo, automation_id: item.automation_id, recipient: item.recipient,
    payload: item.payload, needs_window: item.needs_window, enviar_apos: item.enviar_apos || new Date().toISOString(),
  });
}

// ── ESTADO DO PORTEIRO (ig_contacts, projeto MAIN) ────────────────────────────
async function lerGate(igUserId: string): Promise<GateEstado | null> {
  const { data } = await supabase.from('ig_contacts')
    .select('gate_etapa, gate_automation_id, gate_em, gate_liberado_em')
    .eq('ig_user_id', igUserId).maybeSingle();
  return (data as GateEstado) || null;
}
// gate_liberado_em NUNCA é limpo aqui: quem já seguiu não passa pelo porteiro de
// novo, e quem decide isso é `acaoNaAbertura` antes de chegar nesta função.
async function abrirGate(igUserId: string, automationId: string): Promise<void> {
  const agora = new Date().toISOString();
  await supabase.from('ig_contacts')
    .update({ gate_etapa: 'seguir', gate_automation_id: automationId, gate_em: agora, updated_at: agora })
    .eq('ig_user_id', igUserId);
}
/** Automação saiu do ar no meio do fluxo — solta a pessoa em vez de prender. */
async function limparGate(igUserId: string): Promise<void> {
  await supabase.from('ig_contacts')
    .update({ gate_etapa: null, gate_automation_id: null, gate_em: null, updated_at: new Date().toISOString() })
    .eq('ig_user_id', igUserId);
}
/**
 * Avança a etapa SÓ se ninguém avançou antes. Dois toques no mesmo botão chegam
 * como duas mensagens (mids diferentes, então `jaVisto` não pega) e as duas leem
 * a mesma etapa — sem esta trava a pessoa recebe o mesmo texto duas vezes, que é
 * exatamente o bug que apareceu no print do ManyChat.
 */
async function claimGate(igUserId: string, de: GateEtapa, acao: GateAcao): Promise<boolean> {
  const agora = new Date().toISOString();
  const patch: any = { gate_etapa: etapaDepois(acao), gate_em: agora, updated_at: agora };
  if (acao === 'entregar') patch.gate_liberado_em = agora;   // seguiu: nunca pedir de novo
  const { data } = await supabase.from('ig_contacts').update(patch)
    .eq('ig_user_id', igUserId).eq('gate_etapa', de).select('ig_user_id');
  return !!(data && data.length);
}

// Card com botão só cabe em 80+80 caracteres (limite do Instagram). Copy maior
// que isso vira texto puro em vez de sair cortada no meio da frase.
const CARD_MAX = 160;

function welcomePayload(a: Automation): any {
  const text = a.dm_boas_vindas || 'Oi! Aqui está o que você pediu:';
  // Automação com rótulo de botão preenchido no painel entrega um CARD: a
  // pessoa toca e vai direto pro link, sem copiar URL. É o caso da bike, onde
  // a negociação é na hora e cada toque a menos conta.
  if (a.link_url && a.botao_rotulo && text.length <= CARD_MAX) {
    // No card não cabe convite: título e subtítulo somam 160 caracteres.
    return { text, button: { url: a.link_url, title: a.botao_rotulo } };
  }
  // Sem rótulo (ou copy longa): texto puro com o link embutido — o Instagram
  // deixa o link clicável do mesmo jeito.
  if (!a.link_url) return { text };
  // Link limpo, sem pedir nada em troca (decisão do dono, 05/08: "não estamos
  // dando nada em troca"). O "me segue" foi pro lembrete de 1h, depois que a
  // pessoa já recebeu o que pediu.
  return { text: text + '\n\n' + a.link_url };
}
function enqueueReminderIfAny(a: Automation, recipient: string): Promise<void> | null {
  if (!a.lembrete_texto) return null;
  const apos = new Date(Date.now() + (Number(a.lembrete_horas) || 24) * 3600 * 1000).toISOString();
  const payload: any = { text: a.lembrete_texto };
  // O texto do lembrete costuma trazer o link cru. Quem não passou pelo porteiro
  // recebe o nudge no lugar (a troca é feita na drenagem, com o estado na mão).
  if (gateAtivo(a)) payload.gate_nudge = nudgeGate(a);
  return enqueue({ tipo: 'followup', automation_id: a.id, recipient, payload, needs_window: true, enviar_apos: apos });
}

// ── COMENTÁRIO ────────────────────────────────────────────────────────────────
export async function handleComment(value: any, ownIgId?: string): Promise<void> {
  const commentId = value?.id;
  const text = value?.text || '';
  const fromId = value?.from?.id;
  const username = value?.from?.username || null;
  const mediaId = value?.media?.id || value?.media_id || null;
  const adId = value?.media?.ad_id || null;
  const ehAnuncio = (value?.media?.media_product_type || '') === 'AD' || !!adId;
  if (!commentId || !fromId) return;
  if (await jaVisto(commentId)) return;
  await logEvent('comment', commentId, value);

  // Anti-eco: a conta comenta no próprio post ("Digita ELETROPOSTO nos comentários")
  // e isso batia palavra-chave — o robô respondia a si mesmo e ainda postava
  // "Te chamei na DM!" embaixo do comentário do dono, escondendo quem ficou sem resposta.
  if (ownIgId && String(fromId) === String(ownIgId)) return;

  const autos = await loadAutomations();
  const tel = telefoneDe(text);
  const a = decidirComentario(autos, { texto: text, mediaId, adId, ehAnuncio });
  if (!a) return;

  await upsertContact(fromId, username, a.id, false);

  // Porteiro: automação com link pede pra seguir antes de entregar. Quem já
  // seguiu (gate_liberado_em) recebe direto — ninguém segue duas vezes.
  const estadoC = await lerGate(fromId);

  // Comentou de novo antes de responder a DM? O "me segue" já está de pé (cada
  // comentário tem id próprio, então o dedup por comentário não pega). Repetir
  // o mesmo toque é a bizarrice em dobro: fica em silêncio — nem DM, nem
  // resposta pública. O telefone, se veio, continua virando lead.
  if (repetiriaOToque(a, estadoC)) {
    if (tel) await depositarLead(fromId, tel, a, username);
    return;
  }

  const acao = acaoNaAbertura(a, estadoC);
  // Reabrir um fluxo que já anda zeraria o gate_em e poderia devolver a etapa
  // pro começo entre o clique da pessoa e a drenagem — o mesmo texto duas vezes.
  const jaAberto = gateAberto(estadoC) && estadoC?.gate_automation_id === a.id;
  if (acao !== 'entregar' && !jaAberto) await abrirGate(fromId, a.id);

  // DM privada (fura a janela de 24h). A resposta PÚBLICA só é enfileirada depois
  // que a DM sair de verdade (drainIgQueue) — senão a gente anuncia "olha no
  // direct" pra quem nunca recebeu nada.
  await enqueue({
    tipo: 'private_reply', automation_id: a.id, recipient: commentId, needs_window: false,
    payload: {
      ...(acao === 'seguir' ? payloadSeguir(a) : welcomePayload(a)),
      pub_ok: pick(a.respostas_publicas || []),
      pub_fail: username ? `@${username} me chama no direct que eu te mando tudo` : null,
      // O relógio do lembrete de 1h começa quando ESTA DM sair (a fila enfileira
      // o lembrete depois do envio confirmado, não agora).
      l1h: lembrete1h(a, fromId),
    },
  });
  await enqueueReminderIfAny(a, fromId);

  // Telefone no COMENTÁRIO também vira card no CRM (antes só DM depositava lead).
  if (tel) await depositarLead(fromId, tel, a, username);
}

// ── MENSAGEM (story reply / DM) ────────────────────────────────────────────────
export async function handleMessage(m: any, ownIgId: string): Promise<void> {
  const senderId = m?.sender?.id;
  const mid = m?.message?.mid;
  if (!senderId || senderId === ownIgId) return;         // ignora nossos próprios ecos
  if (m?.message?.is_echo) return;
  if (mid && await jaVisto(mid)) return;
  if (mid) await logEvent('message', mid, m);

  const text = m?.message?.text || '';
  const isStory = !!m?.message?.reply_to?.story;

  // Toda mensagem recebida ABRE a janela de 24h.
  await upsertContact(senderId, null, null, true);
  const tel = telefoneDe(text);

  // ── Porteiro aberto? Então esta resposta é o próximo toque do fluxo, seja ela
  // o clique no botão ("Seguindo") ou texto digitado. Não volta pro roteamento
  // por palavra-chave: o fluxo em andamento manda.
  const estado = await lerGate(senderId);
  const passo = acaoNaResposta(estado);
  if (passo) {
    const autos = await loadAutomations();
    const dona = autos.find(x => x.id === estado?.gate_automation_id) || null;
    if (dona) {
      if (await claimGate(senderId, estado!.gate_etapa as GateEtapa, passo)) {
        const payload = passo === 'seguir' ? payloadSeguir(dona) : welcomePayload(dona);
        await enqueue({ tipo: 'dm', automation_id: dona.id, recipient: senderId, payload, needs_window: false });
      }
      if (tel) await depositarLead(senderId, tel, dona, null);
      return;
    }
    // Automação pausada no meio do fluxo: solta a pessoa antes de cair no
    // roteamento normal, senão o texto do botão ("Seguindo") ficaria preso
    // num fluxo que não existe mais.
    await limparGate(senderId);
  }

  const autos = await loadAutomations();
  const a = escolher(autos, isStory ? 'story' : 'dm', text);
  if (a) {
    await upsertContact(senderId, null, a.id, false);
    // DM fria também passa pelo porteiro (o link é o mesmo, a regra é a mesma).
    const acao = acaoNaAbertura(a, estado);
    if (acao === 'seguir') await abrirGate(senderId, a.id);
    // Conversa já aberta → DM direta (não precisa de janela).
    const payload: any = acao === 'seguir' ? payloadSeguir(a) : welcomePayload(a);
    payload.l1h = lembrete1h(a, senderId);
    await enqueue({ tipo: 'dm', automation_id: a.id, recipient: senderId, payload, needs_window: false });
    await enqueueReminderIfAny(a, senderId);
  } else if (text.trim()) {
    // NENHUMA palavra-chave casou — é aqui que o lead morria (11 das 12
    // conversas de DM dos últimos 7 dias sem uma linha de resposta, incluindo
    // um "Me passa seu zap"). O menu automático existe mas nasce DESLIGADO:
    // a DM direta é atendimento manual por decisão do dono (05/08).
    await responderDmFria(senderId, text);
  }

  // Integração com o CRM: se a pessoa mandou um WhatsApp na DM, deposita o lead
  // no rodízio/agenda (reaproveita ingestManychatLead → avisa o consultor).
  if (tel) await depositarLead(senderId, tel, a, null);
}

/**
 * DM sem palavra-chave: manda o menu UMA vez e chama o humano.
 *
 * NASCE DESLIGADO de propósito: em 05/08 o dono disse "nesse caso de DM direta
 * vamos responder manualmente por enquanto". O código fica pronto pro dia em
 * que ele quiser ligar — `IG_DM_MENU_ON=true` na Vercel — e até lá a DM fria
 * continua sendo assunto de gente.
 *
 * Quando ligado, "uma vez" é a parte que importa: a pessoa costuma escrever
 * três linhas seguidas ("Bom dia" / "Firme" / "Me passa seu zap") e três menus
 * seriam pior que o silêncio. A trava é a própria fila — mesma automação pro
 * mesmo destinatário em 24h não repete.
 */
async function responderDmFria(senderId: string, texto: string): Promise<void> {
  if ((process.env.IG_DM_MENU_ON || '').trim() !== 'true') return;
  const autos = await loadAutomations();
  const menu = autos.find(x => x.fallback) || autos.find(x => !x.link_url && x.gatilhos?.dm) || null;
  if (!menu) return;

  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: jaFoi } = await supabase.from('ig_queue').select('id')
    .eq('recipient', senderId).eq('automation_id', menu.id).gte('criado_em', desde).limit(1);
  if (jaFoi && jaFoi.length) return;

  await enqueue({ tipo: 'dm', automation_id: menu.id, recipient: senderId, payload: welcomePayload(menu), needs_window: false });

  // O menu segura; quem fecha é gente. O time recebe o texto no WhatsApp.
  try {
    const { data: c } = await supabase.from('ig_contacts').select('username').eq('ig_user_id', senderId).maybeSingle();
    await sendWhatsApp(
      (process.env.IO_INDICACOES_NOTIFY || '34991360223').trim(),
      `*MENSAGEM NO INSTAGRAM* (Irmãos na Obra)\n\n` +
      `*De:* ${c?.username ? '@' + c.username : 'sem @ (chegou por DM)'}\n` +
      `*Disse:* ${texto.slice(0, 300)}\n\n` +
      `_O robô mandou o menu. Se for atendimento, responder pelo direct._`,
      'io',
    );
  } catch (err) { logger.error('ig', 'aviso do time (DM fria) falhou', err); }
}

/** Card no CRM com o produto certo (a automação sabe qual é; no escuro, solar). */
async function depositarLead(igUserId: string, telefone: string, a: Automation | null, username: string | null): Promise<void> {
  const link = a?.link_url || '';
  const produto = a?.produto || (link.includes('/io/eletroposto') ? 'eletroposto' : 'solar');
  try {
    await ingestManychatLead({
      produto,
      nome: username ? '@' + username : 'Lead Instagram',
      whatsapp: telefone,
      contact_id: 'ig_' + igUserId,
    });
  } catch (err) { logger.error('ig', 'deposito CRM falhou', err); }
}

/**
 * Lembrete 1h depois da primeira DM. Tipo próprio ('followup_1h') pra não
 * misturar com o lembrete longo da automação — e é ele que dá o dedup: quem
 * comenta três vezes no mesmo anúncio recebe UM lembrete, não três.
 */
async function agendarLembrete1h(automationId: string | null, l1h: { to: string; text: string; gate_nudge?: string }): Promise<void> {
  const { data: pendente } = await supabase.from('ig_queue').select('id')
    .eq('tipo', 'followup_1h').eq('recipient', l1h.to).eq('status', 'pending').limit(1);
  if (pendente && pendente.length) return;
  await enqueue({
    tipo: 'followup_1h', automation_id: automationId, recipient: l1h.to,
    payload: { text: l1h.text, ...(l1h.gate_nudge ? { gate_nudge: l1h.gate_nudge } : {}) },
    needs_window: true, enviar_apos: new Date(Date.now() + L1H_ATRASO_MS).toISOString(),
  });
}

// ── DRENAGEM DA FILA ────────────────────────────────────────────────────────────
export async function drainIgQueue(): Promise<{ enviados: number; pulados: number; incertos?: number; reason?: string }> {
  if (!ligado()) return { enviados: 0, pulados: 0, reason: 'desligado' };
  const cfg = await getIgConfig();
  if (!cfg?.access_token || !cfg.ig_user_id) return { enviados: 0, pulados: 0, reason: 'sem_conta' };
  const igId = cfg.ig_user_id, token = cfg.access_token;   // locais: o envio virou closure

  // Teto anti-ban por hora.
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  const { data: sentRows } = await supabase.from('system_state').select('key').like('key', 'ig_sent:%').gte('updated_at', desde).limit(IG_MAX_POR_HORA + 1);
  if ((sentRows?.length || 0) >= IG_MAX_POR_HORA) return { enviados: 0, pulados: 0, reason: 'teto_hora' };

  const nowIso = new Date().toISOString();
  const { data: fila } = await supabase.from('ig_queue').select('*')
    .eq('status', 'pending').lte('enviar_apos', nowIso)
    .order('criado_em', { ascending: true }).limit(MAX_POR_TICK);
  if (!fila || fila.length === 0) return { enviados: 0, pulados: 0, reason: 'fila_vazia' };

  let enviados = 0, pulados = 0, incertos = 0;
  for (const item of fila as any[]) {
    // Claim atômico.
    const { data: claimed } = await supabase.from('ig_queue')
      .update({ status: 'sending', claimed_at: new Date().toISOString(), tentativas: (item.tentativas || 0) + 1 })
      .eq('id', item.id).eq('status', 'pending').select('id');
    if (!claimed || !claimed.length) continue;

    // Janela de 24h + estado do porteiro (a mesma linha serve pras duas coisas).
    let contato: any = null;
    if (item.needs_window) {
      const { data: c } = await supabase.from('ig_contacts')
        .select('last_reply_at, gate_etapa, gate_liberado_em').eq('ig_user_id', item.recipient).maybeSingle();
      contato = c || null;
      const aberta = c?.last_reply_at && (Date.now() - new Date(c.last_reply_at).getTime()) < 24 * 3600 * 1000;
      if (!aberta) { await supabase.from('ig_queue').update({ status: 'skipped', erro: 'janela_24h_fechada' }).eq('id', item.id); pulados++; continue; }
    }

    // Lembrete de quem parou no porteiro não pode levar o link (o texto da
    // automação traz a URL crua) — vai o nudge pedindo pra seguir.
    let payload: any = item.payload;
    if (String(item.tipo).startsWith('followup') && payload?.gate_nudge && !contato?.gate_liberado_em) {
      payload = { text: payload.gate_nudge };
    }

    try {
      const enviar = (p: any): Promise<any> =>
        item.tipo === 'private_reply' ? sendPrivateReply(igId, item.recipient, p, token)
        : item.tipo === 'public_reply' ? replyToComment(item.recipient, p?.text || '', token)
        : sendDM(igId, item.recipient, p, token);                   // dm | followup
      let resp: any = {};
      let incerto: string | null = null;                            // saiu? a Meta não disse (ver igFalha.ts)
      try { resp = await enviar(payload); }
      catch (err: any) {
        const msg = String(err?.message || err);
        const falha = classificarFalha(msg);
        if (falha === 'sem_botao' && payload?.quick_replies) {
          // A Meta recusou o quick reply com todas as letras. Reenvia o MESMO
          // texto sem botão — a copy já ensina a responder digitando.
          logger.error('ig', 'quick_replies recusado, reenviando texto puro', err);
          try { resp = await enviar({ text: payload.text }); }
          catch (err2: any) {
            const msg2 = String(err2?.message || err2);
            if (classificarFalha(msg2) !== 'incerto') throw err2;
            incerto = msg2;
          }
        } else if (falha === 'incerto') {
          // NÃO reenvia: o 500/code 1 da Meta já entregou mensagem antes, e o
          // reenvio é que colocou a mesma DM duas vezes no celular do lead.
          incerto = msg;
        } else if (payload?.button?.url) {
          // Card recusado de vez (falha real, então nada saiu — não duplica).
          // A pessoa não pode ficar sem o link só porque o card não passou.
          logger.error('ig', 'card com botão recusado, reenviando texto com o link', err);
          resp = await enviar({ text: (payload.text || '') + '\n\n' + payload.button.url });
        } else {
          throw err;
        }
      }

      if (incerto) {
        // Nem 'sent' (seria mentira na métrica) nem 'failed' (dispararia o
        // "me chama no direct" público pra quem provavelmente JÁ recebeu).
        await supabase.from('ig_queue').update({ status: 'incerto', erro: incerto.slice(0, 300) }).eq('id', item.id);
        // Conta no teto anti-ban: pro Instagram, provavelmente saiu mesmo.
        await supabase.from('system_state').upsert({ key: 'ig_sent:' + item.id, value: '1', updated_at: new Date().toISOString() }, { onConflict: 'key' });
        await logEvent('incerto', item.id, { tipo: item.tipo, recipient: item.recipient, erro: incerto.slice(0, 300) });
        incertos++;
        // O lembrete continua agendado: ele exige janela de 24h aberta, então só
        // sai se a pessoa responder — e responder é a prova de que a DM chegou.
        if (item.payload?.l1h?.to) await agendarLembrete1h(item.automation_id, item.payload.l1h);
        await new Promise(r => setTimeout(r, SPACING_MS));
        continue;
      }

      // message_id é a prova de que a Meta criou a mensagem (200 sozinho não é).
      await supabase.from('ig_queue').update({ status: 'sent', message_id: resp?.message_id || resp?.id || null, resposta: resp || null }).eq('id', item.id);
      await supabase.from('system_state').upsert({ key: 'ig_sent:' + item.id, value: '1', updated_at: new Date().toISOString() }, { onConflict: 'key' });
      await logEvent('sent', item.id, { tipo: item.tipo, recipient: item.recipient, message_id: resp?.message_id || null });
      enviados++;
      // Só agora avisa publicamente "olha no direct" — a DM realmente saiu.
      if (item.tipo === 'private_reply' && item.payload?.pub_ok) {
        await enqueue({ tipo: 'public_reply', automation_id: item.automation_id, recipient: item.recipient, payload: { text: item.payload.pub_ok }, needs_window: false });
      }
      // …e agora começa a contar 1h pro lembrete. Aqui, e não no comentário,
      // porque o pedido do dono é "1h depois que a DM foi enviada".
      if (item.payload?.l1h?.to) await agendarLembrete1h(item.automation_id, item.payload.l1h);
    } catch (err: any) {
      await supabase.from('ig_queue').update({ status: 'failed', erro: String(err?.message || err).slice(0, 300) }).eq('id', item.id);
      logger.error('ig', `envio ${item.tipo} falhou`, err);
      // DM não entrou (comentário de anúncio costuma barrar): pede publicamente
      // pra pessoa chamar no direct, que aí a janela abre pelo lado dela.
      if (item.tipo === 'private_reply' && item.payload?.pub_fail) {
        await enqueue({ tipo: 'public_reply', automation_id: item.automation_id, recipient: item.recipient, payload: { text: item.payload.pub_fail }, needs_window: false });
      }
    }
    await new Promise(r => setTimeout(r, SPACING_MS));
  }
  return { enviados, pulados, incertos };
}

// ── REFRESH DO TOKEN (semanal) ──────────────────────────────────────────────────
export async function refreshIgToken(): Promise<{ ok: boolean; reason?: string }> {
  if (!ligado()) return { ok: false, reason: 'desligado' };
  const cfg = await getIgConfig();
  if (!cfg?.access_token) return { ok: false, reason: 'sem_token' };
  // Só renova se faltar menos de ~14 dias (token dura 60d).
  if (cfg.token_expires_at) {
    const faltam = new Date(cfg.token_expires_at).getTime() - Date.now();
    if (faltam > 14 * 24 * 3600 * 1000) return { ok: true, reason: 'ainda_valido' };
  }
  try {
    const { token, expiresIn } = await refreshLongToken(cfg.access_token);
    await saveIgConfig({ ...cfg, access_token: token, token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() });
    return { ok: true };
  } catch (err: any) { logger.error('ig', 'refresh token falhou', err); return { ok: false, reason: String(err?.message || err) }; }
}
