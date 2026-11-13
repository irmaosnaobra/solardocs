// ─────────────────────────────────────────────────────────────────────────────
// A HELENA REMARCA O CARD QUE JÁ EXISTE (12/11/2026).
//
// Todo cliente de eletroposto que a Helena chama já tem um card parado na agenda (cancelado, não
// atendeu, o lote mudo ou uma reunião vencida). Regra do dono para agentes: não duplicar card. Quando a
// pessoa escolhe o horário, o MESMO card ganha o horário novo e passa a ser da Helena, para os robôs da
// agenda tratarem como um card novo dela:
//
//   · `quando` = o horário escolhido, `status` = agendado, `created_by` = agente_eletroposto (sai do lote
//     mudo: a origem `cadastro_eletroposto` calava todos os robôs de agenda);
//   · os carimbos de lembrete e confirmação voltam a zero (mesma lista do reagenda automático e do repasse
//     de 12h: confirmacao_at, lembrete_3h/1h/5min_at, presenca_confirmada_at, lead_resposta_at);
//   · uma linha no `historico`: "Reunião marcada pela Helena no WhatsApp" (e a ficha da conversa). A
//     `observacao` NÃO é tocada: a primeira linha dela e as linhas "NOTA n ·" são lidas pelo trigger do banco;
//   · as marcas do ciclo anterior no system_state saem (ep_mudo, a régua do SIM, o "não atendeu" automático);
//   · `vendedor_nome` NÃO muda: trocar o dono dispara o aviso do eletropostoCardPing.
//
// O QUE A REMARCAÇÃO DISPARA NO BANCO, conferido nos arquivos MIGRATION_repasse_*.sql: o trigger recalcula
// `repassar_em` quando `quando` ou `status` mudam, para `quando + 12h` em horário comercial (o mesmo que acontece
// com o card novo que a Helena já criava). Nada vence agora: o repasse só olha card `agendado` cujo
// `repassar_em` já passou, e o corte de idade ignora reunião de mais de 21 dias atrás. A Giovanna não circula
// (carteira fixa).
//
// Segurança: o update só pega a linha se o status e o horário ainda forem os que foram lidos. Alguém
// mexeu no card no meio do caminho (o consultor o pôs em atendimento, por exemplo)? Zero linhas, e a Helena
// passa a conversa para a pessoa em vez de passar por cima.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { guardarTipoDoCard } from '../agenda/etiquetaCard';
import { ORIGEM_AGENTE_EP } from './eletropostoCard';
import { cardReabre, carimboDoHistorico } from './investidorAgentePuro';

/** Colunas de carimbo da agenda que voltam a zero (a mesma lista do reagendaAuto e do `processar_repasses`). */
export const CARIMBOS_ZERADOS = [
  'confirmacao_at', 'lembrete_3h_at', 'lembrete_1h_at', 'lembrete_5min_at', 'presenca_confirmada_at', 'lead_resposta_at',
] as const;

/** As marcas do system_state do ciclo anterior do card. Os prefixos moram em eletropostoReagendaAuto.ts
 *  (`limparCarimbos`), epMudo.ts e eletropostoCobraSim.ts; estão aqui como texto para não puxar os envios
 *  desses módulos para o caminho da Helena. */
export function marcasDoCicloAnterior(id: number): string[] {
  return [
    `ep_mudo:${id}`, `ep_nao_atendeu_auto:${id}`, `ep_agenda_sent:${id}:manha`, `ep_remarcar:${id}`,
    `ep_cobra_sim:${id}:c1`, `ep_cobra_sim:${id}:c2`, `ep_cobra_sim:${id}:liberou`, `ep_liberado_sim:${id}`,
  ];
}

export type ResultadoDaRemarcacao =
  | { ok: true }
  | { ok: false; motivo: 'horario_ocupado' | 'card_mudou' | 'erro'; detalhe?: string };

interface CardLido {
  id: number; status: string | null; quando: string | null; created_by: string | null; vendedor_nome: string | null; historico: string | null;
}

/**
 * Remarca o card para `iso`. `tipoDoCard` é o `tipo_card` (cotista, arrendamento, integrador): só grava se o
 * card ainda não tem (o tipo nasce uma vez e fica). Nunca lança: o resultado diz o que houve.
 */
export async function remarcarCardDaHelena(i: {
  id: number; iso: string; agora: Date; tipoDoCard: string; linhasDoHistorico: readonly string[];
}): Promise<ResultadoDaRemarcacao> {
  let lido: CardLido | null;
  try {
    const { data, error } = await supabaseGerador.from('agendamentos')
      .select('id, status, quando, created_by, vendedor_nome, historico').eq('id', i.id).maybeSingle();
    if (error) throw error;
    lido = (data ?? null) as CardLido | null;
  } catch (err) {
    logger.error('investidor-agente', `ler o card ${i.id} para remarcar falhou`, err);
    return { ok: false, motivo: 'erro', detalhe: 'leitura' };
  }
  // O card ainda é um daqueles que a Helena reabre? Se não, alguém o moveu: não passa por cima.
  if (!lido || !ehOrigemEletroposto(lido.created_by)
    || !cardReabre({ id: lido.id, status: String(lido.status ?? ''), quando: lido.quando, origem: String(lido.created_by ?? ''), vendedor: lido.vendedor_nome, historico: lido.historico }, i.agora.getTime())) {
    return { ok: false, motivo: 'card_mudou' };
  }

  const bloco = i.linhasDoHistorico.map(l => `[${carimboDoHistorico(i.agora)} · Helena] ${l}`).join('\n');
  const patch: Record<string, unknown> = {
    quando: i.iso, status: 'agendado', created_by: ORIGEM_AGENTE_EP,
    historico: lido.historico ? `${bloco}\n\n${lido.historico}` : bloco,
  };
  for (const c of CARIMBOS_ZERADOS) patch[c] = null;

  let q = supabaseGerador.from('agendamentos').update(patch).eq('id', i.id).eq('status', String(lido.status));
  q = lido.quando === null ? q.is('quando', null) : q.eq('quando', lido.quando);
  const { data, error } = await q.select('id');
  if (error) {
    if (String((error as { code?: string }).code) === '23505') return { ok: false, motivo: 'horario_ocupado' };
    logger.error('investidor-agente', `remarcar o card ${i.id} falhou`, error);
    return { ok: false, motivo: 'erro', detalhe: 'gravacao' };
  }
  if (!((data ?? []) as unknown[]).length) return { ok: false, motivo: 'card_mudou' };

  // O card já está remarcado: o resto é limpeza e nunca derruba a conversa.
  await supabase.from('system_state').delete().in('key', marcasDoCicloAnterior(i.id))
    .then(undefined, (e: unknown) => logger.error('investidor-agente', `limpar as marcas do card ${i.id} falhou`, e));
  await guardarTipoDoCard(i.id, i.tipoDoCard, 'helena');
  return { ok: true };
}
