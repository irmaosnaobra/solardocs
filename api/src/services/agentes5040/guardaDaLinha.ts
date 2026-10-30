// As três conferências da linha 5040 que a passagem por regra e os reenvios ao dono fazem ANTES de mandar uma ficha, e o
// contador do próprio erro. Moram aqui, e não no vivoEnvio.ts, de propósito: os testes trocam o vivoEnvio e o fichaEnvio por
// mocks que só têm o que eles usam, e um export novo ali chegaria `undefined` e mataria o caminho em silêncio.
// Os valores são os MESMOS do vivoEnvio.ts (CHAVE_LINHA_PAUSA, CHAVE_LINHA_ERROS, PREFIXO_CARIMBO, LIMITES); o teste
// agentes5040GuardaDaLinha confere que continuam iguais.
//
// Este arquivo NÃO envia nada: só lê e conta no system_state.

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { classificarErroEnvio } from '../chefe/decidir';
import { linhaIoEmCooldown } from './fichaEnvio';

const LOG = 'guarda-linha-5040';

export const GUARDA = Object.freeze({
  chavePausa: 'ag5040_linha_pausa',
  chaveErros: 'ag5040_linha_erros',
  prefixoCarimbo: 'ag5040_sent:',
  espacamentoMs: 10_000,
  errosParaPausar: 2,
  pausaMs: 15 * 60_000,
});

const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);

/**
 * A linha pode receber mais um envio agora? 'nao' = pausada pelos erros seguidos (ag5040_linha_pausa), em cooldown na memória
 * ou leitura que falhou (na dúvida, não manda). Quem pergunta deixa para a próxima rodada.
 */
export async function linhaLivre(agora: Date): Promise<'sim' | 'nao'> {
  if (linhaIoEmCooldown()) return 'nao';
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', GUARDA.chavePausa).maybeSingle();
    if (error) { logger.error(LOG, `leitura da pausa da linha falhou (${codigoDe(error)})`); return 'nao'; }
    const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
    return Number.isFinite(ate) && ate > agora.getTime() ? 'nao' : 'sim';
  } catch (err) {
    logger.error(LOG, `leitura da pausa da linha falhou (${codigoDe(err)})`);
    return 'nao';
  }
}

/**
 * Já passaram os 10 s do último ag5040_sent (o critério do envio de resposta)? 'falta' = a bolha seria recusada por
 * espaçamento; 'erro' = não deu para ler (o envio também recusaria). Só o 'ok' deixa mandar a ficha que vem antes da bolha.
 */
export async function espacamentoDoEnvio(agora: Date): Promise<'ok' | 'falta' | 'erro'> {
  try {
    const { data, error } = await supabase
      .from('system_state').select('updated_at').like('key', `${GUARDA.prefixoCarimbo}%`)
      .order('updated_at', { ascending: false }).limit(1);
    if (error) { logger.error(LOG, `leitura do último envio falhou (${codigoDe(error)})`); return 'erro'; }
    const ultimoEm = Date.parse(String(((data ?? []) as Array<{ updated_at?: string }>)[0]?.updated_at ?? ''));
    return Number.isFinite(ultimoEm) && agora.getTime() - ultimoEm < GUARDA.espacamentoMs ? 'falta' : 'ok';
  } catch (err) {
    logger.error(LOG, `leitura do último envio falhou (${codigoDe(err)})`);
    return 'erro';
  }
}

/**
 * Erro da linha: soma ao contador de erros seguidos; no 2º grava a pausa de 15 min (igual ao vivoEnvio). Nunca lança.
 * Erro do DESTINO (número inválido, 4xx que não é a instância fora) não conta: é a mesma régua do vivoEnvio (erroEhDoDestino).
 */
export async function contarErroDaLinha(agora: Date, erro?: unknown): Promise<void> {
  try {
    if (erro !== undefined && classificarErroEnvio(erro) === 'destino') return;
    const { data } = await supabase.from('system_state').select('value').eq('key', GUARDA.chaveErros).maybeSingle();
    const antes = Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0);
    const n = (Number.isFinite(antes) && antes > 0 ? Math.floor(antes) : 0) + 1;
    const { error } = await supabase.from('system_state').upsert(
      { key: GUARDA.chaveErros, value: { n, em: agora.toISOString() }, updated_at: agora.toISOString() }, { onConflict: 'key' });
    if (error) logger.error(LOG, `não gravei o contador de erros da linha (${codigoDe(error)})`);
    if (n >= GUARDA.errosParaPausar) {
      const ate = new Date(agora.getTime() + GUARDA.pausaMs).toISOString();
      const { error: e2 } = await supabase.from('system_state').upsert(
        { key: GUARDA.chavePausa, value: { ate, motivo: 'erros_seguidos', n }, updated_at: agora.toISOString() }, { onConflict: 'key' });
      if (e2) logger.error(LOG, `não gravei a pausa da linha (${codigoDe(e2)})`);
      else logger.error(LOG, `linha pausada ate ${ate} (${n} erros seguidos)`);
    }
  } catch (err) { logger.error(LOG, `contagem de erro da linha falhou (${codigoDe(err)})`); }
}

/** Envio ok: o contador de erros seguidos volta a zero (só escreve se havia algo a zerar). Nunca lança. */
export async function zerarErrosDaLinha(agora: Date): Promise<void> {
  try {
    const { data } = await supabase.from('system_state').select('value').eq('key', GUARDA.chaveErros).maybeSingle();
    const n = Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0);
    if (!Number.isFinite(n) || n <= 0) return;
    const { error } = await supabase.from('system_state').upsert(
      { key: GUARDA.chaveErros, value: { n: 0, em: agora.toISOString() }, updated_at: agora.toISOString() }, { onConflict: 'key' });
    if (error) logger.error(LOG, `não zerei o contador de erros da linha (${codigoDe(error)})`);
  } catch (err) { logger.error(LOG, `não zerei o contador de erros da linha (${codigoDe(err)})`); }
}
