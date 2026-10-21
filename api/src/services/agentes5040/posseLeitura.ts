// ─────────────────────────────────────────────────────────────────────────────
// LEITURA DA POSSE PARA O ENSAIO SOMBRA (B1c-3). SÓ LÊ. Existe porque o ensaio não pode importar posse.ts
// (posse.ts escreve em whatsapp_sessions, tabela proibida para tudo que o isolamento alcança).
//
// Pergunta que responde: "a rodada viva vai atender esta conversa?". Se vai, o ensaio pula a candidata,
// porque as duas usam a mesma reserva de vez (ag5040_vez:<waId>) e quem pegasse primeiro tiraria a
// conversa do outro, deixando o lead sem resposta.
//
// A regra de escopo copia posse.ts (noEscopo): interruptor da dona ligado E (modo 'todos' de dona liberada
// OU o hmac da chave na lista do alvo, com o mesmo kid). Se um dia mudar lá, muda aqui; o teste de
// agentes5040Ensaio cobre os dois lados.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { chaveContato } from '../agents/whatsapp/silenciar';
import {
  DONAS_LIBERADAS_PARA_TODOS, interruptorDaDona, lerAlvoVivo, ligado, type DonaViva,
} from './interruptores';
import { hmacDe, idChaveHmac } from './hmac';

/** Nesta fase a Duda e a Helena (B2) respondem na rodada viva; carla_vivo é ignorado, como na porta. */
export const DONAS_NA_RODADA: readonly DonaViva[] = ['duda', 'helena'];

/** As donas da rodada com o interruptor ligado. Sem nenhuma, a única leitura foi a do interruptor (cache de 60 s). */
export async function donasDaRodadaLigadas(): Promise<DonaViva[]> {
  const out: DonaViva[] = [];
  for (const d of DONAS_NA_RODADA) if (await ligado(interruptorDaDona(d))) out.push(d);
  return out;
}

/** A conversa tem posse VIVA de uma destas donas, e o lead está no escopo dela? Erro de leitura = true (o ensaio só pula). */
export async function posseVivaServida(telefoneOuChave: string, donas: readonly DonaViva[]): Promise<boolean> {
  try {
    if (!donas.length) return false;
    const chave = chaveContato(telefoneOuChave);
    if (!chave) return false;
    const alvo = await lerAlvoVivo();
    if (!alvo) return false;
    const kid = idChaveHmac();
    const h = hmacDe(chave);
    const noEscopo = (d: DonaViva): boolean => {
      if ((alvo.modos[d] ?? 'teste') === 'todos' && DONAS_LIBERADAS_PARA_TODOS.includes(d)) return true;
      return !!kid && alvo.kid === kid && !!h && alvo.hmacs.includes(h);
    };
    const cobrem = donas.filter(noEscopo);
    if (!cobrem.length) return false;
    const { data, error } = await supabase.from('whatsapp_sessions')
      .select('lead_data').eq('phone', chave).eq('tipo', 'ag5040').maybeSingle();
    if (error) { console.error('[agentes5040] ensaio: leitura da posse falhou', String(error.code ?? 'desconhecido').slice(0, 20)); return true; }
    const d = (data as { lead_data?: { dona?: string; estado?: string } } | null)?.lead_data;
    if (!d) return false;
    return d.estado === 'viva' && (cobrem as readonly string[]).includes(String(d.dona));
  } catch {
    return true;
  }
}
