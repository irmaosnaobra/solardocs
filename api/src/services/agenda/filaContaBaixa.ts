// ─────────────────────────────────────────────────────────────────────────────
// A FILA DA CONTA BAIXA — 3 Nilce, 1 Giovanna.
//
// Ordem do Thiago (17/08/2026, valendo a partir de 18/08): o perfil da Nilce
// (solar abaixo de 700 kWh/mês, e quem não respondeu o consumo) passa a ser
// dividido com a Giovanna, numa proporção de 3 pra 1, "pra ela iniciar os
// atendimentos". A Nilce segue com o grosso — e, com a varredura das 19h
// (nilceParaGiovanna.ts) tirando dela o que esfriou, fica com o que é novo.
//
// ── Por que o contador é uma CONTAGEM e não uma coluna ──
// O 3:1 tem que valer no total, não por canal: o lead entra por três portas
// (formulário do Meta, DM do ManyChat e a página de venda) e três contadores
// separados dariam três rodízios independentes — a Giovanna receberia 1 a cada 4
// de CADA porta, e a proporção real dependeria do mix do dia. Contar as fichas
// que já existem resolve isso sem coluna nova e sem estado pra sincronizar: as
// três portas fazem a mesma pergunta ao banco e chegam na mesma resposta.
//
// A contagem também é o que faz o "começa amanhã" funcionar sozinho: ela só olha
// ficha criada a partir do INICIO. Sem esse piso, o resto da divisão sairia de
// centenas de fichas históricas da Nilce e a fila começaria numa fase aleatória.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { FILA_CONTA_BAIXA, TIME_CONTA_BAIXA, CONTA_BAIXA_INICIO } from './leadSolarFicha';

/**
 * Quem recebe o PRÓXIMO lead de conta baixa. Nunca lança: se a contagem falhar,
 * cai na Nilce — errar pro lado de quem já atende é melhor que errar pro lado de
 * quem está aprendendo, e melhor ainda que deixar o lead sem dono.
 */
export async function proximoDaContaBaixa(): Promise<string> {
  try {
    const { count, error } = await supabaseGerador
      .from('agendamentos')
      .select('id', { count: 'exact', head: true })
      .in('vendedor_nome', TIME_CONTA_BAIXA)
      .gte('created_at', CONTA_BAIXA_INICIO);
    if (error) throw error;
    return FILA_CONTA_BAIXA[(count || 0) % FILA_CONTA_BAIXA.length];
  } catch (e) {
    logger.error('fila-conta-baixa', 'contagem falhou, caindo na Nilce', { erro: String(e) });
    return FILA_CONTA_BAIXA[0];
  }
}
