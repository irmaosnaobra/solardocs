// ─────────────────────────────────────────────────────────────────────────────
// O LIVRO `ig_sent:` do Instagram: UMA linha por mensagem que saiu, no
// `system_state` do banco PRINCIPAL. O teto anti-ban de 180 por hora do
// igEngine (IG_MAX_POR_HORA) conta as linhas desse prefixo, então toda
// mensagem enviada pela página, venha do motor ou da prospecção, tem que
// carimbar aqui. Módulo à parte para o igEngine e a prospecção usarem a MESMA
// função sem import circular (o igEngine já importa a prospecção).
//
// A chave tem que ser única por mensagem: o teto conta linhas, e upsert com
// chave repetida vira uma linha só.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';

/** A chave do livro para o id (item da fila, ou outro id único da mensagem). */
export const chaveEnvioIg = (id: string): string => `ig_sent:${id}`;

/** Carimba uma mensagem enviada no livro. Devolve o erro do banco, se houver. */
export async function carimbarEnvioIg(id: string) {
  return supabase.from('system_state').upsert(
    { key: chaveEnvioIg(id), value: '1', updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}
