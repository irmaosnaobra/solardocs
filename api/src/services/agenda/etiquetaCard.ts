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
import { logger } from '../../utils/logger';
import { ETIQUETA_PREFIX, TIPO_CARD_PREFIX } from './salaDeEspera';

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

/**
 * Grava o TIPO com que o card nasceu: `tipo_card:<id>` → { tipo, em, por }.
 *
 * Nasce uma vez e fica: `ignoreDuplicates` faz o segundo gravador (outra tela, o
 * reenvio da LP) não sobrescrever o primeiro, e nenhuma rota apaga esta chave. É o
 * que mantém COTISTA ou INTEGRADOR no card depois que a agenda limpa a etiqueta
 * guardada. NUNCA lança: o card já está gravado, e o tipo é pílula de tela, não
 * motivo de erro. Devolve se gravou.
 */
export async function guardarTipoDoCard(id: number | null, tipo: string, por: string): Promise<boolean> {
  if (!id || !tipo) return false;
  try {
    const agora = new Date().toISOString();
    const { error } = await supabase.from('system_state').upsert(
      { key: `${TIPO_CARD_PREFIX}${id}`, value: { tipo, em: agora, por: String(por).slice(0, 60) }, updated_at: agora },
      { onConflict: 'key', ignoreDuplicates: true },
    );
    if (error) { logger.error('tipo-card', `tipo ${tipo} do card #${id} nao gravado`, error); return false; }
    return true;
  } catch (err) {
    logger.error('tipo-card', `tipo ${tipo} do card #${id} nao gravado`, err);
    return false;
  }
}

/** O tipo guardado do card, ou null (sem chave, valor torto ou leitura que falhou).
 *  NUNCA lança: quem chama cai no comportamento de antes. */
export async function lerTipoDoCard(id: number): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('system_state')
      .select('value').eq('key', `${TIPO_CARD_PREFIX}${id}`).maybeSingle();
    if (error) { logger.error('tipo-card', `leitura do tipo do card #${id} falhou`, error); return null; }
    let v: unknown = data?.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
    const t = v && typeof v === 'object' ? String((v as { tipo?: unknown }).tipo ?? '').trim() : '';
    return t || null;
  } catch (err) {
    logger.error('tipo-card', `leitura do tipo do card #${id} falhou`, err);
    return null;
  }
}
