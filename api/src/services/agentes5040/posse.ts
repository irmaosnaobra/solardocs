// ─────────────────────────────────────────────────────────────────────────────
// POSSE DA CONVERSA PELAS AGENTES DA LINHA 5040 (Fase B). NADA aqui envia mensagem.
//
// A posse é uma linha em whatsapp_sessions: tipo 'ag5040', phone = chaveContato(tel) (DDD + 8
// últimos, 10 dígitos), lead_data = { dona, estado, desde, ate_wa_id, respostas, imagens, links, ... }.
// A primeira posse nasce por INSERT (23505 = já tinha dona), nunca por upsert.
//
// Quem pergunta é o robô ANTIGO, em cada ponto de corte:
//   · cedeAAgente(phone): "esta conversa já é de uma agente nova? então eu calo" (corte de conversa);
//   · agenteAtendeEste(dona, phone): "a agente nova atende ESTE lead?" (corte de "não abre conversa
//     nova" e de tick, sempre por lead, nunca pelo interruptor sozinho).
//
// Import mínimo de propósito (adendo F): supabase, interruptores, hmac e chaveContato. Nada que
// puxe ia.ts, o SDK da Anthropic ou o zapiClient, porque o webhook e os robôs antigos importam este
// arquivo. Telefone cru nunca vai para o log.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { DONAS_LIBERADAS_PARA_TODOS, DONAS_VIVAS, interruptorDaDona, lerAlvoVivo, ligado, type AlvoVivo, type DonaViva } from './interruptores';
import { hmacDe, idChaveHmac } from './hmac';

export const TIPO_POSSE = 'ag5040';

export type DonaPosse = DonaViva | 'humano';
export type EstadoPosse = 'viva' | 'passou_humano' | 'nao_incomodar' | 'encerrada';

export interface DadosPosse {
  dona: DonaPosse;
  estado: EstadoPosse;
  desde: string;
  ate_wa_id: number | null;
  respostas: number;
  imagens: string[];
  links: string[];
  [extra: string]: unknown;
}

const DONAS_POSSE: readonly string[] = [...DONAS_VIVAS, 'humano'];
const ESTADOS: readonly string[] = ['viva', 'passou_humano', 'nao_incomodar', 'encerrada'];
/** Estados em que a agente (ou o humano que ela chamou) segura a conversa e os robôs antigos calam. */
const ESTADOS_QUE_CEDEM: readonly string[] = ['viva', 'passou_humano', 'nao_incomodar'];

// ── a posse da RETOMADA dos usuários (03/11/2026) ────────────────────────────
// A campanha solardoc/retomadaUsuarios.ts abre a conversa em nome da Carla com quem TEM conta e não paga. A posse leva
// `origem: 'retomada_usuarios'` e `retomada: { user_id, segmento, grupo, variacao, primeiro_nome, texto, em, ate }`. Ficam aqui (e não em
// solardoc/) porque este arquivo não pode importar de solardoc/ (cabeçalho). Sem essa origem, quem tem conta continua indo para a Giovanna.
export const ORIGEM_RETOMADA_USUARIOS = 'retomada_usuarios';
/** Quanto a posse da retomada vale desde o envio: 30 dias, renovados a cada resposta da Carla. Vencida, vale como se não existisse. */
export const RETOMADA_VALE_MS = 30 * 24 * 3_600_000;

export const ehPosseDaRetomada = (p: Readonly<Record<string, unknown>>): boolean =>
  p.dona === 'carla' && p.origem === ORIGEM_RETOMADA_USUARIOS;

// ── a posse do PEDIDO DE DEPOIMENTO (04/11/2026) ─────────────────────────────
// O robô pesquisa/depoimentoWhatsApp.ts pede o depoimento a um pagante e, no mesmo envio, abre a posse da Carla com
// `origem: 'pedido_depoimento'` e `pedido_depoimento: { user_id, link, em, ate }` (o link do formulário, com o token). Vale 7 dias. Quem responde é a
// Carla (o vivo.ts não fecha esta posse por "já tem conta") e a Giovanna não responde por cima. Vencida, vale como se não existisse.
export const ORIGEM_PEDIDO_DEPOIMENTO = 'pedido_depoimento';
export const PEDIDO_DEPOIMENTO_VALE_MS = 7 * 24 * 3_600_000;

export const ehPosseDoPedidoDeDepoimento = (p: Readonly<Record<string, unknown>>): boolean =>
  p.dona === 'carla' && p.origem === ORIGEM_PEDIDO_DEPOIMENTO;

export function pedidoDepoimentoVale(p: Readonly<Record<string, unknown>>, agoraMs: number): boolean {
  const ate = Date.parse(String((p.pedido_depoimento as { ate?: unknown } | null | undefined)?.ate ?? ''));
  return Number.isFinite(ate) && ate > agoraMs;
}

/** A posse da retomada ainda vale? `retomada.ate` ausente, ilegível ou no passado = não. */
export function retomadaVale(p: Readonly<Record<string, unknown>>, agoraMs: number): boolean {
  const ate = Date.parse(String((p.retomada as { ate?: unknown } | null | undefined)?.ate ?? ''));
  return Number.isFinite(ate) && ate > agoraMs;
}

/** Erro de banco com só o código (a mensagem do driver pode trazer telefone). */
export class ErroPosse extends Error {
  constructor(readonly codigo: string) { super(`posse: ${codigo}`); this.name = 'ErroPosse'; }
}

const codigoDe = (e: unknown): string => {
  if (e instanceof ErroPosse) return e.codigo;
  const c = (e as { code?: string } | null)?.code;
  return c ? String(c).slice(0, 20) : 'interno';
};

/** Todo formato de telefone (com 55, com 9, sem) cai na mesma chave de 10 dígitos. null = não é pessoa. */
export const chaveDaPosse = (telefone: string | null | undefined): string | null => chaveContato(telefone);

function dadosDe(v: unknown): DadosPosse | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!DONAS_POSSE.includes(String(o.dona)) || !ESTADOS.includes(String(o.estado))) return null;
  return {
    ...o,
    dona: o.dona as DonaPosse,
    estado: o.estado as EstadoPosse,
    desde: typeof o.desde === 'string' ? o.desde : '',
    ate_wa_id: typeof o.ate_wa_id === 'number' ? o.ate_wa_id : null,
    respostas: Number.isFinite(Number(o.respostas)) ? Number(o.respostas) : 0,
    imagens: Array.isArray(o.imagens) ? o.imagens.map(String) : [],
    links: Array.isArray(o.links) ? o.links.map(String) : [],
  };
}

/**
 * A posse desta conversa, ou null se não há. Erro de leitura LANÇA (ErroPosse): quem chama decide
 * o que fazer (cedeAAgente trata como "é da agente"). Posse com dado ilegível lança também.
 */
export async function lerPosse(telefoneOuChave: string): Promise<DadosPosse | null> {
  const chave = chaveDaPosse(telefoneOuChave);
  if (!chave) return null;
  const { data, error } = await supabase.from('whatsapp_sessions')
    .select('lead_data').eq('phone', chave).eq('tipo', TIPO_POSSE).maybeSingle();
  if (error) throw new ErroPosse(String(error.code ?? 'desconhecido'));
  if (!data) return null;
  const d = dadosDe((data as { lead_data?: unknown }).lead_data);
  if (!d) throw new ErroPosse('ilegivel');
  return d;
}

/**
 * Desfaz a posse que ESTA chamada acabou de criar (a abertura do quiz cujo enfileirar não gravou): apaga só a linha dessa dona
 * com esse `desde` e nada mais. Posse que já mudou (passou a outra dona, outro `desde`) fica. Nunca lança. true = a chamada correu sem erro.
 */
export async function desfazerPosseNova(telefoneOuChave: string, dona: DonaPosse, desde: string): Promise<boolean> {
  const chave = chaveDaPosse(telefoneOuChave);
  if (!chave) return false;
  try {
    const { error } = await supabase.from('whatsapp_sessions').delete()
      .eq('phone', chave).eq('tipo', TIPO_POSSE).eq('lead_data->>dona', dona).eq('lead_data->>desde', desde);
    if (error) throw new ErroPosse(String(error.code ?? 'desconhecido'));
    return true;
  } catch (e) {
    console.error('[agentes5040] desfazer a posse nova falhou', codigoDe(e));
    return false;
  }
}

export type ResultadoAssumir = 'assumida' | 'ja_tinha_dona' | 'erro';

/**
 * Primeira posse, por INSERT. 23505 (chave única phone+tipo) = a conversa já tinha dona.
 * `desde` (ISO) é a âncora da posse: sem ele vale a hora de agora. A porta passa o momento da mensagem que abriu
 * a conversa (menos 60 s), para o poll atrasado ainda enxergar essa fala. `extra` (opcional) são campos a mais de lead_data.
 */
export async function assumirPosse(
  telefoneOuChave: string, dona: DonaPosse, waId: number | null, desde?: string, extra?: Record<string, unknown>,
): Promise<ResultadoAssumir> {
  const chave = chaveDaPosse(telefoneOuChave);
  if (!chave || !DONAS_POSSE.includes(dona)) return 'erro';
  try {
    const agora = new Date().toISOString();
    const ancora = desde && Number.isFinite(Date.parse(desde)) ? new Date(Date.parse(desde)).toISOString() : agora;
    // `extra` (a retomada dos usuários) entra primeiro: os campos de base SEMPRE vencem, e quem já chama a função não muda.
    const lead_data: DadosPosse = { ...(extra ?? {}), dona, estado: 'viva', desde: ancora, ate_wa_id: waId, respostas: 0, imagens: [], links: [] };
    const { error } = await supabase.from('whatsapp_sessions').insert({
      phone: chave, tipo: TIPO_POSSE, nome: null, messages: [], lead_data, updated_at: agora,
    });
    if (!error) return 'assumida';
    if (String(error.code ?? '') === '23505') return 'ja_tinha_dona';
    console.error('[agentes5040] assumir a posse falhou', codigoDe(error));
    return 'erro';
  } catch (e) {
    console.error('[agentes5040] assumir a posse falhou', codigoDe(e));
    return 'erro';
  }
}

/**
 * Muda campos da posse (dona, estado, ate_wa_id, respostas, imagens, links, ...). Lê, junta e grava:
 * não é atômico, e não precisa ser (uma conversa tem um escritor por vez, a vez ag5040_vez).
 * true = gravou. Sem posse, ilegível ou erro = false.
 */
export async function atualizarPosse(telefoneOuChave: string, patch: Partial<DadosPosse>): Promise<boolean> {
  const chave = chaveDaPosse(telefoneOuChave);
  if (!chave) return false;
  try {
    const atual = await lerPosse(chave);
    if (!atual) return false;
    const novo = { ...atual, ...patch };
    if (!DONAS_POSSE.includes(novo.dona) || !ESTADOS.includes(novo.estado)) return false;
    const { error } = await supabase.from('whatsapp_sessions')
      .update({ lead_data: novo, updated_at: new Date().toISOString() })
      .eq('phone', chave).eq('tipo', TIPO_POSSE);
    if (error) throw new ErroPosse(String(error.code ?? 'desconhecido'));
    return true;
  } catch (e) {
    console.error('[agentes5040] atualizar a posse falhou', codigoDe(e));
    return false;
  }
}

/**
 * Avança o `ate_wa_id` da posse da RETOMADA dos usuários até `alvo`, SÓ se ela ainda for da retomada (dona carla, origem da retomada), estiver
 * `viva` e o `ate_wa_id` atual for MENOR que o alvo. O update é condicional no banco (o `ate_wa_id` lido e o estado vão no filtro): se a Carla
 * respondeu, encerrou ou passou a conversa ao humano entre a leitura e a escrita, nenhuma linha muda e devolve false. Só o primeiro dos
 * escritores concorrentes grava. true = já cobria o alvo ou gravou exatamente 1 linha. Nunca lança.
 */
export async function avancarAteWaIdDaRetomada(telefoneOuChave: string, alvo: number): Promise<boolean> {
  const chave = chaveDaPosse(telefoneOuChave);
  if (!chave || !Number.isFinite(alvo)) return false;
  try {
    const atual = await lerPosse(chave);
    if (!atual || !ehPosseDaRetomada(atual) || atual.estado !== 'viva') return false;
    if (atual.ate_wa_id !== null && atual.ate_wa_id >= alvo) return true;
    let q = supabase.from('whatsapp_sessions')
      .update({ lead_data: { ...atual, ate_wa_id: alvo }, updated_at: new Date().toISOString() })
      .eq('phone', chave).eq('tipo', TIPO_POSSE)
      .eq('lead_data->>dona', 'carla').eq('lead_data->>origem', ORIGEM_RETOMADA_USUARIOS).eq('lead_data->>estado', 'viva');
    q = atual.ate_wa_id === null ? q.is('lead_data->>ate_wa_id', null) : q.eq('lead_data->>ate_wa_id', String(atual.ate_wa_id));
    const { data, error } = await q.select('phone');
    if (error) throw new ErroPosse(String(error.code ?? 'desconhecido'));
    return (data?.length ?? 0) === 1;
  } catch (e) {
    console.error('[agentes5040] avançar o ate_wa_id da retomada falhou', codigoDe(e));
    return false;
  }
}

// ── escopo: quem a agente atende ─────────────────────────────────────────────

// DONAS_LIBERADAS_PARA_TODOS mora em interruptores.ts (a rota do painel a lê sem puxar este arquivo, que escreve
// em whatsapp_sessions) e sai daqui também: modo 'todos' só vale para dona nessa lista, senão vale como 'teste'.
export { DONAS_LIBERADAS_PARA_TODOS };

/** O lead está no escopo da dona? 'todos' (só para dona liberada) = sim; 'teste' (padrão) = só se o hmac da chave está na lista. */
function noEscopo(alvo: AlvoVivo, dona: DonaViva, chave: string): boolean {
  if ((alvo.modos[dona] ?? 'teste') === 'todos' && DONAS_LIBERADAS_PARA_TODOS.includes(dona)) return true;
  // Kid trocado: os hmacs gravados não são comparáveis com a chave em uso. Ninguém em teste.
  const kid = idChaveHmac();
  if (!kid || alvo.kid !== kid) return false;
  const h = hmacDe(chave);
  return !!h && alvo.hmacs.includes(h);
}

/**
 * A agente nova atende ESTE lead? = interruptor da dona ligado E (modo da dona = 'todos' OU o hmac
 * da chave do telefone está na lista). Erro ao ler o alvo = false (a agente não atende e os robôs
 * antigos seguem como hoje). Nunca lança. Interruptor desligado não lê o alvo.
 */
export async function agenteAtendeEste(dona: DonaViva, telefone: string | null | undefined): Promise<boolean> {
  try {
    if (!(await ligado(interruptorDaDona(dona)))) return false;
    const chave = chaveDaPosse(telefone);
    if (!chave) return false;
    const alvo = await lerAlvoVivo();
    return !!alvo && noEscopo(alvo, dona, chave);
  } catch {
    return false;
  }
}

/**
 * Corte de CONVERSA nos robôs antigos: devolve true quando o robô antigo deve calar porque uma
 * agente nova segura esta conversa. Ordem exata (adendo C):
 *   1. nenhum *_vivo ligado: false, sem ler posse nem alvo;
 *   2. o lead não está no escopo de nenhuma dona ligada (modo teste e hmac fora da lista, ou erro
 *      ao ler o alvo): false, sem ler a posse;
 *   3. lê a posse: dona X com agenteAtendeEste(X) e estado viva | passou_humano | nao_incomodar = true;
 *      'encerrada' ou sem posse = false. Dona 'humano' (a agente passou a conversa): cede se alguma
 *      dona ligada cobre o lead (o humano está falando, o robô antigo não entra por cima);
 *   4. erro ao ler a posse, com o lead no escopo de alguma dona ligada: true, com log do código.
 * Telefone sem chave (LID, grupo, curto) = false. Nunca lança.
 */
export async function cedeAAgente(telefone: string | null | undefined): Promise<boolean> {
  try {
    const ligadas: DonaViva[] = [];
    for (const d of DONAS_VIVAS) if (await ligado(interruptorDaDona(d))) ligadas.push(d);
    if (!ligadas.length) return false;
    const chave = chaveDaPosse(telefone);
    if (!chave) return false;
    const alvo = await lerAlvoVivo();
    if (!alvo) return false;
    const cobrem = ligadas.filter(d => noEscopo(alvo, d, chave));
    if (!cobrem.length) return false;
    let posse: DadosPosse | null;
    try {
      posse = await lerPosse(chave);
    } catch (e) {
      console.error('[agentes5040] ler a posse falhou: o robô antigo cala nesta mensagem', codigoDe(e));
      return true;
    }
    if (!posse || !ESTADOS_QUE_CEDEM.includes(posse.estado)) return false;
    // A posse da retomada VENCIDA vale como se não existisse (uma `viva` sem resposta não cala a Giovanna do suporte para sempre).
    if (ehPosseDaRetomada(posse) && posse.estado === 'viva' && !retomadaVale(posse, Date.now())) return false;
    if (ehPosseDoPedidoDeDepoimento(posse) && (posse.estado !== 'viva' || !pedidoDepoimentoVale(posse, Date.now()))) return false;
    if (posse.dona === 'humano') return true;
    return cobrem.includes(posse.dona);
  } catch {
    return false;
  }
}

/**
 * Corte da Giovanna para o PAGANTE que respondeu ao pedido de depoimento da Carla (04/11/2026). Mais estreito que o da retomada, de propósito:
 * a Carla precisa atender ESTE número (conferido PRIMEIRO), a posse é dela com a origem do pedido, está VIVA (passou_humano, nao_incomodar e
 * encerrada NUNCA cedem: o suporte do pagante é da Giovanna) e dentro dos 7 dias. Qualquer erro devolve false: na dúvida a Giovanna responde,
 * a mensagem de um pagante nunca some. Nunca lança.
 */
export async function cedeAoPedidoDeDepoimento(telefone: string | null | undefined): Promise<boolean> {
  try {
    if (!(await agenteAtendeEste('carla', telefone))) return false;
    const chave = chaveDaPosse(telefone);
    if (!chave) return false;
    const p = await lerPosse(chave);
    return !!p && ehPosseDoPedidoDeDepoimento(p) && p.estado === 'viva' && pedidoDepoimentoVale(p, Date.now());
  } catch {
    return false;
  }
}

/**
 * Corte da Giovanna para quem TEM conta: esta conversa é da RETOMADA da Carla (03/11/2026)? true = a Giovanna não responde por cima.
 * Vale quando a Carla atende ESTE lead, a posse é dela com a origem da retomada, está num estado que cede e ainda vale (30 dias), em
 * qualquer estado: a posse vencida vale como se não existisse.
 * Erro ao ler a posse devolve true (o mesmo critério do cedeAAgente): só importa para conta grátis, porque o chamador só pergunta com
 * `user.plano === 'free'`. Telefone sem chave e qualquer outra falha devolvem false. Nunca lança.
 */
export async function cedeARetomadaDaCarla(telefone: string | null | undefined): Promise<boolean> {
  try {
    if (!(await agenteAtendeEste('carla', telefone))) return false;
    const chave = chaveDaPosse(telefone);
    if (!chave) return false;
    let p: DadosPosse | null;
    try { p = await lerPosse(chave); }
    catch (e) { console.error('[agentes5040] ler a posse falhou: a Giovanna cala nesta mensagem', codigoDe(e)); return true; }
    // O prazo de 30 dias vale em TODO estado (D4): vencida em passou_humano ou nao_incomodar, a Giovanna volta a responder (a Carla não fala nesses estados).
    return !!p && ehPosseDaRetomada(p) && ESTADOS_QUE_CEDEM.includes(p.estado) && retomadaVale(p, Date.now());
  } catch {
    return false;
  }
}
