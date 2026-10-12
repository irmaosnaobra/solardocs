// ─────────────────────────────────────────────────────────────────────────────
// A MARCA DA ETIQUETA DE NEGÓCIO DO CARD, gravada num lugar só (12/10/2026).
//
// Morava dentro da rota `POST /gerador/etiqueta`. Saiu de lá porque a LP do
// eletroposto passou a criar o card JÁ com a etiqueta (arrendamento, cotista ou
// integrador) e a rota `/io/eletroposto/agendar` precisa gravar a mesma marca, no
// mesmo formato. A rota do gerador chama esta função com os mesmos argumentos de
// antes: `etiqueta_card:<id>` → { etiqueta, em, por }.
//
// Fica FORA de `salaDeEspera.ts` de propósito: aquele módulo é puro (só listas e
// contas de data) e é importado por teste sem banco. Este fala com o banco.
//
// A allowlist NÃO é checada aqui: cada rota tem a sua (a do gerador aceita as dez
// de `ETIQUETAS_DE_NEGOCIO`, a da LP só três) e recusa antes de chamar.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { ETIQUETA_PREFIX } from './salaDeEspera';

/** Grava (ou regrava) a marca da etiqueta do card. Erro do banco SOBE. */
export async function guardarEtiquetaDoCard(id: number, etiqueta: string, por: unknown): Promise<void> {
  const agora = new Date().toISOString();
  const { error } = await supabase.from('system_state').upsert(
    {
      key: `${ETIQUETA_PREFIX}${id}`,
      value: { etiqueta, em: agora, por: String(por ?? '').slice(0, 60) },
      updated_at: agora,
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
}
