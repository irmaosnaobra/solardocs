// ─────────────────────────────────────────────────────────────────────────────
// A MARCA DE SILÊNCIO DO CARD, gravada num lugar só (13/10/2026).
//
// Morava dentro da rota `POST /gerador/mudo`. Saiu de lá porque a agenda em lote
// (`agendaEmLote.ts`) precisa gravar a MESMA marca, no mesmo formato, e duas cópias
// do formato é convite para divergirem. A rota chama esta função com os mesmos
// argumentos de antes: `ep_mudo:<id>` → { quando, em, por }.
//
// O que a marca faz: o tick da agenda dá `continue` antes de qualquer toque quando
// o `quando` dela casa com o do card, e a régua do SIM ignora a ficha. Ela vale
// SÓ para esse horário (ver `eletropostoReagendaAuto.EP_MUDO_PREFIX`).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { EP_MUDO_PREFIX } from './eletropostoReagendaAuto';

/** Grava (ou regrava) a marca. `quandoIso` é o `quando` do card; vira ISO UTC. Erro do banco SOBE. */
export async function gravarMarcaMuda(id: number, quandoIso: string, por: unknown): Promise<string> {
  const quando = new Date(quandoIso).toISOString();
  const agoraIso = new Date().toISOString();
  const { error } = await supabase.from('system_state').upsert(
    {
      key: `${EP_MUDO_PREFIX}${id}`,
      value: { quando, em: agoraIso, por: String(por ?? '').trim().slice(0, 60) },
      updated_at: agoraIso,
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
  return quando;
}
