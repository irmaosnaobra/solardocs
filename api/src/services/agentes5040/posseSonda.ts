// ─────────────────────────────────────────────────────────────────────────────
// SONDA DO ÍNDICE ÚNICO DA POSSE (B1c-3). O parecer do chefe-antiban pediu a prova de que
// whatsapp_sessions tem índice único (phone, tipo): sem ele, o INSERT da posse não resolve a corrida
// entre webhook, fila e poll, e a conversa teria duas donas.
//
// Na chave FALSA '0000000001' (DDD 00, nenhum lead de verdade tem): limpa resto de sonda anterior, assume a
// posse duas vezes (a 1ª tem que ser 'assumida' e a 2ª 'ja_tinha_dona'), conta as linhas tipo ag5040 dessa
// chave (tem que ser 1), apaga a linha e confere 0. Nunca encosta em outra chave. Sem dado pessoal no retorno.
// Se a 2ª gravar (duas linhas), o resultado diz "falhou" e a Fase B NÃO liga: cria o índice por migration antes.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { assumirPosse, TIPO_POSSE } from './posse';

export const CHAVE_FALSA_DA_SONDA = '0000000001';

export interface ResultadoSondaPosse {
  ok: boolean;
  resultado: 'ok' | 'falhou';
  primeira: string;
  segunda: string;
  linhas_depois_de_2: number | null;
  linhas_depois_de_apagar: number | null;
  motivo?: string;
}

async function contar(): Promise<number | null> {
  const { count, error } = await supabase.from('whatsapp_sessions')
    .select('phone', { count: 'exact', head: true }).eq('phone', CHAVE_FALSA_DA_SONDA).eq('tipo', TIPO_POSSE);
  return error ? null : (count ?? 0);
}

async function apagar(): Promise<boolean> {
  const { error } = await supabase.from('whatsapp_sessions').delete().eq('phone', CHAVE_FALSA_DA_SONDA).eq('tipo', TIPO_POSSE);
  return !error;
}

export async function sondaPosse(): Promise<ResultadoSondaPosse> {
  const r: ResultadoSondaPosse = {
    ok: false, resultado: 'falhou', primeira: '-', segunda: '-', linhas_depois_de_2: null, linhas_depois_de_apagar: null,
  };
  try {
    await apagar();                                              // resto de uma sonda que morreu no meio
    r.primeira = await assumirPosse(CHAVE_FALSA_DA_SONDA, 'duda', null);
    r.segunda = await assumirPosse(CHAVE_FALSA_DA_SONDA, 'duda', null);
    r.linhas_depois_de_2 = await contar();
  } finally {
    const apagou = await apagar();
    r.linhas_depois_de_apagar = await contar();
    if (!apagou) r.motivo = 'nao_consegui_apagar_a_linha_da_sonda';
  }
  const bom = r.primeira === 'assumida' && r.segunda === 'ja_tinha_dona' && r.linhas_depois_de_2 === 1 && r.linhas_depois_de_apagar === 0;
  if (!bom && !r.motivo) {
    r.motivo = r.segunda === 'assumida' ? 'sem_indice_unico_a_segunda_gravou' : 'resultado_inesperado';
  }
  r.ok = bom;
  r.resultado = bom ? 'ok' : 'falhou';
  return r;
}
