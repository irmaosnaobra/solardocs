// ─────────────────────────────────────────────────────────────────────────────
// Teto anti-ban ÚNICO da linha física IO (34998165040).
//
// A linha IO é COMPARTILHADA por mais de um agente automático:
//   • Bia (recuperação LimpaPro): prefixos `limpapro_recovery:`, `limpapro_cupom_sent:`
//     e `limpapro_fechamento_sent:` (opener, cupom e fechamento — os 3 toques)
//   • Followup do /gerador (energia solar): prefixo `gerador_followup:`
//
// TODOS esses envios saem pelo MESMO número. Se cada agente tivesse seu próprio teto,
// a linha mandaria N×MAX por hora e tomaria ban — derrubando a receita da Bia JUNTO.
// Por isso o orçamento anti-ban é UM SÓ pra linha inteira: esta função conta os envios
// de TODOS os agentes na última hora (via marcadores em system_state) e diz se ainda há
// folga. Os dois serviços (Bia + gerador) chamam ela antes de cada envio.
//
// IMPORTANTE: ao adicionar um novo agente automático nessa linha, ADICIONE o prefixo de
// "envio efetivado" dele em BOT_SENT_PREFIXES — senão ele fura o teto (foi exatamente o
// bug do cupom: o teto só contava `recovery:` e o cupom passava batido).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';

// Cap de segurança por hora na linha física (anti-ban). Compartilhado por todos os bots.
export const MAX_POR_HORA = 12;

// Prefixos de "envio efetivado" (1 chave = 1 mensagem que SAIU). NÃO inclui os `_pending`
// (esses são fila, não envio). O `:` literal no fim casa só o sufixo de enviado:
//   limpapro_recovery:<email>        → opener da Bia enviado
//   limpapro_cupom_sent:<email>      → cupom da Bia enviado
//   limpapro_fechamento_sent:<email> → 3º toque (fechamento) da Bia enviado
//   gerador_followup:<chave>         → toque do followup solar enviado
// (os `_pending` usam `_` no lugar do `:`, então não casam estes LIKE — provado no banco).
const BOT_SENT_PREFIXES = [
  'limpapro_recovery:',
  'limpapro_cupom_sent:',
  'limpapro_fechamento_sent:',
  'gerador_followup:',
] as const;

/**
 * Há folga no teto anti-ban da linha na última hora? Conta os envios de TODOS os bots.
 * `true` = pode enviar; `false` = estourou, segura pro próximo tick.
 */
export async function dentroDoTetoHorarioLinha(): Promise<boolean> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const orFilter = BOT_SENT_PREFIXES.map(p => `key.like.${p}%`).join(',');
  const { data } = await supabase
    .from('system_state').select('key')
    .or(orFilter)
    .gte('updated_at', desde)
    .limit(MAX_POR_HORA + 1);
  return (data?.length ?? 0) < MAX_POR_HORA;
}
