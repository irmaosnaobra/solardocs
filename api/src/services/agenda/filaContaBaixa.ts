// ─────────────────────────────────────────────────────────────────────────────
// A FILA DA CONTA BAIXA — quem recebe o próximo lead abaixo do corte.
//
// ── 15/09/2026: ESTA SEMANA É TODA DA NILCE, DEPOIS VOLTA O 3:1 ──────────────
// Ordem do Thiago: a Giovanna recebeu as 180 fichas da ação de 11/09 e está com a
// semana cheia (15 ligações por dia até 18/09), então "essa semana dela não mexe",
// e a Nilce recebe os leads "a partir de hoje". De 15/09 até domingo 20/09, todo
// lead novo de conta baixa vai pra Nilce. A partir de segunda 21/09 volta o
// rodízio de 3 Nilce pra 1 Giovanna (escolha do Thiago no mesmo dia).
//
// Os números de antes explicam a ordem: de 07 a 14/09 a Giovanna ficou com 13
// fichas de lead novo e a Nilce com 7, porque a passagem das 19h tirava da Nilce
// o que ela não tinha atendido. Essa passagem foi desligada no mesmo dia.
//
// ── A REGRA MORA AQUI, E SÓ AQUI ────────────────────────────────────────────
// Eram três cópias da fila: este módulo (via leadSolarFicha), a rota da página do
// solar (routes/ioSolar.ts) e o HTML da página. Mudar a proporção pedia mexer nas
// três de uma vez, e esquecer uma dava dois rodízios discordando. Agora a rota
// pergunta a este módulo. O HTML ainda tem uma lista, mas só como reserva pra
// quando a API não responde, e a reserva é 'Nilce', que é o certo nas duas fases.
//
// `FILA_CONTA_BAIXA` e `CONTA_BAIXA_INICIO` do leadSolarFicha.ts NÃO são mais
// lidos: a fila de 21/09 em diante é `FILA_DEPOIS_DA_SEMANA`, logo abaixo.
//
// ── Por que o contador é uma CONTAGEM e não uma coluna ──
// A proporção tem que valer no total, não por canal: o lead entra por três portas
// (formulário do Meta, DM do ManyChat e a página de venda) e três contadores
// separados dariam três rodízios independentes, com a proporção real dependendo
// do mix do dia. Contar as fichas que já existem resolve isso sem coluna nova e
// sem estado pra sincronizar: as três portas fazem a mesma pergunta ao banco e
// chegam na mesma resposta.
//
// O piso da contagem é o que faz a data valer sozinha. Ele é 21/09, e não o
// 18/08 de antes: contando desde agosto, o 3:1 recomeçaria numa fase qualquer, e
// o primeiro lead de segunda podia cair na Giovanna. Com o piso novo, a primeira
// ficha de 21/09 é da Nilce.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { TIME_CONTA_BAIXA } from './leadSolarFicha';

/** Até este instante (exclusive), todo lead de conta baixa é da Nilce. Segunda,
 *  21/09/2026, 00:00 em Brasília. É também o piso da contagem do 3:1. */
export const SEMANA_DA_NILCE_ATE = '2026-09-21T00:00:00-03:00';

/** De 21/09 em diante: 3 Nilce, 1 Giovanna. É o TAMANHO desta lista que define a
 *  proporção, e a ordem literal é a ordem do rodízio. */
export const FILA_DEPOIS_DA_SEMANA = ['Nilce', 'Nilce', 'Nilce', 'Giovanna'];

const semanaDaNilce = (agora: Date): boolean =>
  agora.getTime() < new Date(SEMANA_DA_NILCE_ATE).getTime();

/**
 * A regra sem banco: dado o momento e quantas fichas das duas já foram criadas
 * desde 21/09, de quem é a vez.
 */
export function donaDaContaBaixa(agora: Date, fichasDesdeOPiso: number): string {
  if (semanaDaNilce(agora)) return 'Nilce';
  return FILA_DEPOIS_DA_SEMANA[fichasDesdeOPiso % FILA_DEPOIS_DA_SEMANA.length];
}

/**
 * Quem recebe o PRÓXIMO lead de conta baixa. Nunca lança: se a contagem falhar,
 * cai na Nilce. Errar pro lado de quem atende o grosso é melhor que deixar o lead
 * sem dono.
 */
export async function proximoDaContaBaixa(agora: Date = new Date()): Promise<string> {
  // Nesta semana a resposta não depende de contagem, então nem encosta no banco.
  if (semanaDaNilce(agora)) return 'Nilce';
  try {
    const { count, error } = await supabaseGerador
      .from('agendamentos')
      .select('id', { count: 'exact', head: true })
      .in('vendedor_nome', TIME_CONTA_BAIXA)
      .gte('created_at', SEMANA_DA_NILCE_ATE);
    if (error) throw error;
    return donaDaContaBaixa(agora, count || 0);
  } catch (e) {
    logger.error('fila-conta-baixa', 'contagem falhou, caindo na Nilce', { erro: String(e) });
    return FILA_DEPOIS_DA_SEMANA[0];
  }
}
