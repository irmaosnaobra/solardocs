// ─────────────────────────────────────────────────────────────────────────────
// HOMOLOGAÇÃO LIDA DO TRELLO (20/11/2026), o registro por obra no banco principal: `system_state`, chave `trello_homolog:<card>`. Sem dado pessoal
// (veja `trelloHomologPuro.ts`). Quem grava já tem a trava da obra; o `upsert` é de uma linha só.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { chaveRegistroHomolog, lerRegistroHomologBruto, type RegistroHomolog } from './trelloHomologPuro';

export async function lerRegistroHomolog(card: number): Promise<RegistroHomolog> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', chaveRegistroHomolog(card)).maybeSingle();
  if (error) throw new Error('registro_homolog_leitura');
  return lerRegistroHomologBruto((data as { value?: unknown } | null)?.value);
}

export async function gravarRegistroHomolog(card: number, reg: RegistroHomolog): Promise<void> {
  const { error } = await supabase.from('system_state').upsert(
    { key: chaveRegistroHomolog(card), value: reg, updated_at: new Date().toISOString() }, { onConflict: 'key' },
  );
  if (error) throw new Error('registro_homolog_gravacao');
}
