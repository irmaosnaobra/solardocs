// ─────────────────────────────────────────────────────────────────────────────
// DE QUEM É A CONVERSA: a posse da Helena (agente de investidores, 10/10/2026).
//
// Arquivo PEQUENO de propósito. Quem pergunta "esta conversa é da Helena?" são os
// outros robôs da linha (a Duda da recepção, o leitor do Curioso, o agente de
// respostas da agenda), e eles não podem carregar a agente inteira (IA, agenda,
// rota) só para fazer essa pergunta. Aqui só entram o banco e a chave de contato.
//
// A sessão mora em `system_state`, chave `inv_agente:<DDD + 8 últimos>`.
//
// A CONVERSA É DELA ENQUANTO:
//   · a sessão está em `chamado`, `conversando` ou `ofertou`; ou
//   · ela passou para o consultor (`humano`) há menos de 48h. Neste segundo caso
//     ELA não fala mais, mas os outros robôs também não: quem pediu gente e
//     recebe "Oi! Sou a Duda, como posso te ajudar?" é a falha que esta linha já
//     pagou (regra de 23/09, o robô lê o contexto antes de falar).
//
// Depois de `agendado` quem cuida é a régua da agenda, que já reconhece o card
// pela família da origem. Depois de `sem_interesse` a conversa não é de ninguém.
//
// FALHA FECHADA. Se a leitura falhar (depois de uma segunda tentativa), a
// resposta é "é dela": o outro robô cala naquela rodada. Dois robôs respondendo
// a mesma pessoa é pior do que um robô atrasar.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';

export const INV_SESSAO_PREFIX = 'inv_agente:';

export type EstagioInvestidor = 'chamado' | 'conversando' | 'ofertou' | 'adiado' | 'agendado' | 'sem_interesse' | 'humano';

/** Estágios em que a Helena ainda responde. */
export const ESTAGIOS_ATIVOS: readonly EstagioInvestidor[] = ['chamado', 'conversando', 'ofertou'];

/** Por quanto tempo a passagem para o consultor segura os outros robôs. */
export const POSSE_DEPOIS_DA_PASSAGEM_MS = 48 * 3600_000;

export const sessaoAtiva = (estagio: unknown): boolean =>
  (ESTAGIOS_ATIVOS as readonly string[]).includes(String(estagio ?? ''));

/** Abertura sem resposta há mais que isto deixa de ser conversa da Helena. */
export const CHAMADO_SEM_RESPOSTA_MS = 10 * 86_400_000;

/**
 * Quem ADIOU ("mês que vem eu te procuro") continua sendo conversa da Helena por
 * este prazo, contado do adiamento: ela não manda mais nada por conta própria,
 * mas se a pessoa escrever é ela quem responde, e não a recepção se
 * apresentando do zero. Passado o prazo a posse acaba.
 */
export const ADIADO_VALE_MS = 60 * 86_400_000;

/**
 * A conversa AINDA É DA HELENA? (puro: recebe o valor gravado e a hora)
 *
 * É a mesma pergunta para os dois lados: se a resposta é sim, ela responde e os
 * outros robôs calam; se é não, ela não responde e a recepção volta a atender.
 * As duas pontas leem daqui para nunca discordarem (11/10/2026).
 *
 * Deixa de ser dela, mesmo em estágio ativo:
 *   · quando o envio da abertura FALHOU (`erro`): a pessoa nunca foi chamada, e
 *     se ela escrever é contato novo, da recepção;
 *   · quando está em `chamado` há mais de 10 dias: quem não respondeu em dez
 *     dias e escreve agora quase sempre fala de outra coisa.
 */
export function sessaoEhDaHelena(valor: unknown, agora: number = Date.now()): boolean {
  const v = (valor ?? {}) as { estagio?: unknown; aberto_em?: unknown; erro?: unknown; adiado_em?: unknown; atualizado_em?: unknown };
  if (v.erro) return false;
  if (v.estagio === 'adiado') {
    const adiou = Date.parse(String(v.adiado_em || v.atualizado_em || ''));
    return Number.isFinite(adiou) && agora - adiou <= ADIADO_VALE_MS;
  }
  if (!sessaoAtiva(v.estagio)) return false;
  if (v.estagio === 'chamado') {
    const aberto = Date.parse(String(v.aberto_em || ''));
    if (Number.isFinite(aberto) && agora - aberto > CHAMADO_SEM_RESPOSTA_MS) return false;
  }
  return true;
}

/** A sessão segura os outros robôs? (puro: recebe o valor gravado e a hora) */
export function sessaoSeguraOutrosRobos(valor: unknown, agora: number = Date.now()): boolean {
  const v = (valor ?? {}) as { estagio?: unknown; atualizado_em?: unknown; aberto_em?: unknown };
  if (sessaoAtiva(v.estagio) || v.estagio === 'adiado') return sessaoEhDaHelena(valor, agora);
  if (v.estagio !== 'humano') return false;
  const quando = Date.parse(String(v.atualizado_em || v.aberto_em || ''));
  return Number.isFinite(quando) && agora - quando < POSSE_DEPOIS_DA_PASSAGEM_MS;
}

/** Este telefone está em conversa com a Helena? Uma leitura de uma linha, pela chave. */
export async function investidorAtende(phone: string | null | undefined): Promise<boolean> {
  const k = chaveContato(phone);
  if (!k) return false;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const { data, error } = await supabase
        .from('system_state').select('value').eq('key', `${INV_SESSAO_PREFIX}${k}`).maybeSingle();
      if (error) throw error;
      return data ? sessaoSeguraOutrosRobos(data.value) : false;
    } catch (err) {
      if (tentativa === 2) {
        logger.error('investidor-agente', 'conferir a posse falhou duas vezes: o outro robô cala nesta rodada', err);
        return true;
      }
    }
  }
  return true;
}

/**
 * As chaves das conversas em que a Helena AINDA RESPONDE (`chamado`,
 * `conversando`, `ofertou`), para quem está num laço e não pode fazer uma leitura
 * por pessoa. `null` = não deu para ler, e quem chama PARA a rodada (a próxima
 * tenta de novo).
 *
 * As 48h depois da passagem para o consultor NÃO entram aqui, de propósito: quem
 * usa esta lista são os leitores da agenda e do Curioso, e a pessoa que o
 * consultor assumiu pode ganhar reunião no dia seguinte. Segurar a régua da
 * agenda por 48h deixaria o "SIM" dela sem ninguém ler. As 48h valem só para a
 * recepção (`investidorAtende`), que é quem se apresentaria do zero.
 */
export async function chavesDaHelena(): Promise<Set<string> | null> {
  const chaves = new Set<string>();
  const PAGINA = 1000;
  try {
    for (let de = 0; de < 50_000; de += PAGINA) {
      const { data, error } = await supabase
        .from('system_state').select('key, value')
        .like('key', `${INV_SESSAO_PREFIX}%`)
        .order('key', { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) throw error;
      const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
      const agora = Date.now();
      for (const r of lote) {
        if (sessaoEhDaHelena(r.value, agora)) chaves.add(String(r.key).slice(INV_SESSAO_PREFIX.length));
      }
      if (lote.length < PAGINA) break;
    }
    return chaves;
  } catch (err) {
    logger.error('investidor-agente', 'ler as sessões da Helena falhou', err);
    return null;
  }
}
