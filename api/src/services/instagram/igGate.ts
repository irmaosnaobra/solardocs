// ─────────────────────────────────────────────────────────────────────────────
// Porteiro do link — padrão em TODA automação do Instagram (04/08/2026).
//
// Antes: comentário → DM com o link. Um toque só, e a pessoa saía sem seguir.
// Fluxo atual (05/08/2026, pedido do Thiago — era um toque a mais):
//   1) "me segue e toca no botão que eu libero o link"  → a pessoa responde
//   2) link;
//   3) 1h depois, o followup.
// A resposta da pessoa é o que abre a janela de 24h da Meta (todo followup
// depende dela) e ainda conta como interação pro alcance. O toque "clica no
// botão que eu te mando o link", que vinha antes deste, foi removido.
//
// Só entra em automação que TEM link (`link_url`). O Menu e a rede de segurança
// não têm — a resposta deles ("SOLAR"/"ELETROPOSTO") precisa continuar caindo no
// roteamento por palavra-chave, senão o porteiro engole o menu.
//
// Pede pra seguir UMA vez por pessoa (`gate_liberado_em` em ig_contacts): quem
// já passou recebe o link direto nas próximas.
//
// Botão = quick reply, não postback: o toque chega como mensagem normal
// (message.text = rótulo) e cai no handleMessage que já existe. Postback viria
// em `entry.messaging[].postback`, sem `message`, e exigiria reassinar o webhook.
// A copy ensina a responder digitando também — se a Meta recusar (ou engolir) o
// botão, o fluxo continua andando.
//
// Kill-switch: IG_GATE_OFF='true' desliga o porteiro em todas de uma vez.
// ─────────────────────────────────────────────────────────────────────────────

export type GateEtapa = 'pedido' | 'seguir' | 'entregue';

/** O que mandar agora: pedir o seguir, ou entregar o link. */
export type GateAcao = 'seguir' | 'entregar';

/** Só o que o porteiro precisa saber da automação. */
export interface GateAuto {
  id: string;
  link_url?: string | null;
  gate_off?: boolean | null;
  gate_seguir_texto?: string | null;
  gate_seguir_botao?: string | null;
  lembrete_1h_texto?: string | null;
  lembrete_1h_off?: boolean | null;
}

/** Estado guardado em ig_contacts (projeto MAIN). */
export interface GateEstado {
  gate_etapa?: GateEtapa | string | null;
  gate_automation_id?: string | null;
  gate_em?: string | null;
  gate_liberado_em?: string | null;
}

export interface GatePayload {
  text: string;
  quick_replies?: { title: string; payload: string }[];
}

// Porteiro esquecido: quem volta a falar 3 dias depois não está mais no fluxo.
export const GATE_VALIDADE_MS = 72 * 3600 * 1000;

// Copy padrão (a automação pode sobrescrever no painel). O "(ou responde …)"
// não é enfeite: é o caminho de quem não vê o botão.
// Este é o PRIMEIRO toque desde 05/08 — abre falando com quem acabou de
// comentar, então não pode começar com "quase lá".
const SEGUIR_TEXTO = 'Opa, e aí, beleza?\n\nEsse link é especial pra quem me segue. Me segue aqui e toca no botão abaixo (ou responde SEGUINDO) que eu mando na hora.';
const SEGUIR_BOTAO = 'Seguindo';
const NUDGE = 'Faltou só um passo pro seu link.\n\nMe segue aqui e responde SEGUINDO que eu mando na hora.';

const txt = (v: string | null | undefined, padrao: string): string => (v && v.trim() ? v.trim() : padrao);
// Quick reply da Meta corta em 20 caracteres — melhor cortar aqui do que ver o
// rótulo truncado no meio da palavra no celular da pessoa.
const rotulo = (v: string | null | undefined, padrao: string): string => txt(v, padrao).slice(0, 20);

/** Automação passa pelo porteiro? Sem link não há o que proteger. */
export function gateAtivo(a: GateAuto): boolean {
  if ((process.env.IG_GATE_OFF || '').trim() === 'true') return false;
  if (a.gate_off) return false;
  return !!(a.link_url && a.link_url.trim());
}

/** Fluxo em andamento (e ainda dentro da validade)? */
export function gateAberto(e: GateEstado | null | undefined, agora: number = Date.now()): boolean {
  if (!e || (e.gate_etapa !== 'pedido' && e.gate_etapa !== 'seguir')) return false;
  const em = e.gate_em ? new Date(e.gate_em).getTime() : 0;
  return !!em && agora - em < GATE_VALIDADE_MS;
}

/** Comentário novo (ou DM fria): abre o porteiro ou entrega direto. */
export function acaoNaAbertura(a: GateAuto, e: GateEstado | null | undefined, _agora: number = Date.now()): GateAcao {
  if (!gateAtivo(a)) return 'entregar';
  if (e?.gate_liberado_em) return 'entregar';   // já seguiu uma vez, não pede de novo
  return 'seguir';                              // toque único: pede o seguir e pronto
}

/**
 * O toque que sairia agora é o MESMO que já saiu pra esta pessoa?
 *
 * Comentar duas ou três vezes no mesmo reel antes de abrir a DM é comum, e cada
 * comentário chega com id próprio — o dedup por comentário não pega. Sem esta
 * pergunta, cada comentário rende um "me segue" novo (foi o print de 05/08).
 * Quem já passou pelo porteiro (`gate_liberado_em`) não entra aqui: essa pessoa
 * recebe o link direto, e link repetido não é bizarrice.
 *
 * Quem ficou parado na etapa 'pedido' é do fluxo antigo, de dois toques: pra
 * essa pessoa o "me segue" ainda é mensagem nova, então não é silêncio.
 */
export function repetiriaOToque(a: GateAuto, e: GateEstado | null | undefined, agora: number = Date.now()): boolean {
  if (!gateAtivo(a)) return false;
  if (e?.gate_liberado_em) return false;
  return gateAberto(e, agora) && e!.gate_automation_id === a.id && e!.gate_etapa === 'seguir';
}

/** Resposta na DM com o porteiro aberto. null = deixa o roteamento normal agir. */
export function acaoNaResposta(e: GateEstado | null | undefined, agora: number = Date.now()): GateAcao | null {
  if (!gateAberto(e, agora)) return null;
  // 'pedido' é herança do fluxo de dois toques: quem estava parado nele responde
  // e recebe o "me segue" — o mesmo lugar onde todo mundo entra agora.
  if (e!.gate_etapa === 'pedido') return 'seguir';
  return 'entregar';                            // gateAberto só deixa passar pedido|seguir
}

/** Etapa que fica gravada depois de executar a ação. */
export function etapaDepois(acao: GateAcao): GateEtapa {
  if (acao === 'seguir') return 'seguir';
  return 'entregue';
}

/**
 * Convite pra seguir — vai no LEMBRETE DE 1H, nunca junto do link.
 *
 * 05/08, decisão do dono em duas etapas: primeiro o porteiro caiu (entregava o
 * link pra 1 pessoa em 23 DMs, porque quem não responde nunca mais pode ser
 * tocado); depois o pedido saiu também da mensagem de entrega — "não estamos
 * dando nada em troca". Primeiro entrega o que a pessoa pediu; cobrar o seguir
 * vem depois, no toque de 1h.
 */
export function conviteSeguir(): string {
  return 'E me segue aqui que eu aviso quando tiver novidade.';
}

export function payloadSeguir(a: GateAuto): GatePayload {
  return {
    text: txt(a.gate_seguir_texto, SEGUIR_TEXTO),
    quick_replies: [{ title: rotulo(a.gate_seguir_botao, SEGUIR_BOTAO), payload: 'IG_GATE_SEGUINDO' }],
  };
}

/**
 * Lembrete de quem parou no meio. O texto original da automação leva o LINK
 * (ex.: "dá uma olhada: solardoc.app/io/eletroposto") — mandar isso pra quem não
 * passou pelo porteiro transforma o porteiro em quebra-molas.
 */
export function nudgeGate(_a: GateAuto): string { return NUDGE; }

// ── LEMBRETE DE 1 HORA ───────────────────────────────────────────────────────
// Sai 1h depois de a PRIMEIRA DM ter saído de verdade (não do comentário: o
// relógio começa no envio confirmado pela Meta).
//
// É AQUI que o "me segue" é cobrado (05/08): a entrega vem limpa, e o pedido
// só aparece depois que a pessoa já recebeu o que veio buscar.
//
// Limite que não é nosso: DM só sai com a janela de 24h aberta, e quem abre a
// janela é a RESPOSTA da pessoa. Então quem nunca respondeu a primeira DM não
// recebe lembrete nenhum — a fila marca 'janela_24h_fechada' e pula. Sem o
// porteiro, isso vira a regra e não a exceção: quem só clicou no link não
// recebe o pedido. É o preço de entregar primeiro, e foi decisão consciente.
export const L1H_ATRASO_MS = 3600_000;

const L1H_COM_LINK = 'Passei só pra saber: conseguiu abrir o link?\n\nSe quiser, é por aqui:';
const L1H_SEM_LINK = 'Passei só pra saber se você viu o que eu te mandei.\n\nQualquer dúvida, me chama por aqui!';

export interface Lembrete1h {
  to: string;                 // ig_user_id (a fila do private_reply guarda o comment_id)
  text: string;
  gate_nudge?: string;        // usado se a pessoa ainda não passou pelo porteiro
}

/** null = automação com o lembrete de 1h desligado. */
export function lembrete1h(a: GateAuto, to: string): Lembrete1h | null {
  if ((process.env.IG_LEMBRETE_1H_OFF || '').trim() === 'true') return null;
  if (a.lembrete_1h_off) return null;
  const link = (a.link_url || '').trim();
  const base = link ? `${L1H_COM_LINK}\n${link}` : L1H_SEM_LINK;
  // O pedido de seguir entra aqui, no fim — só na copy padrão. Copy escrita à
  // mão no painel manda: se o dono escreveu o texto, é o texto dele que sai.
  const padrao = `${base}\n\n${conviteSeguir()}`;
  const item: Lembrete1h = { to, text: txt(a.lembrete_1h_texto, padrao) };
  if (gateAtivo(a)) item.gate_nudge = NUDGE;
  return item;
}
