// ─────────────────────────────────────────────────────────────────────────────
// OS DOIS AVISOS NOVOS DA HELENA AO CONSULTOR (13/11/2026, parecer do chefe anti-ban: NÃO BLOQUEIA com estas condições):
//
//   · SILÊNCIO: a pessoa não respondeu ao convite nem à retomada, e a sessão foi para `humano`. O consultor dono do card recebe a
//     ficha da conversa com a linha "Sem resposta ao convite..." no topo. Trava `inv_agente_aviso_silencio:<chave>`, carimbo
//     `ficha_lead:helena:silencio:<chave>` (não reaproveita o `ficha_lead:helena:<card>`, que a ficha da marcação grava por cima).
//   · EQUIPE ASSUMIU: alguém da equipe escreveu pelo celular da linha e a Helena saiu. 1 aviso por sessão ao consultor dono do card.
//     Trava `inv_agente_aviso_assumiu:<chave>`, carimbo `ficha_lead:helena:assumiu:<chave>`.
//
// Condições do chefe: SÓ pelo `enviarComConferencias` de investidorAgenteAvisos.ts (linha livre, menos de 40 carimbos na hora, menos
// de 6 proativas em 10 min, 25 s mais sorteio desde a última proativa; 1 bolha; só o celular do consultor dono do card; trava de
// `pendente` a `enviado`) e NUNCA por `passarParaHumano` nem `avisarEquipe` (mandam a 3 pessoas, seguem depois de erro e não
// carimbam). No máximo 1 aviso por rodada, somando estes dois, o da marcação e o resumo do dia (a flag da rodada é a mesma). Consultor
// sem celular: a trava vira `descartado` com motivo `sem_celular`; nunca cai no telefone do dono da casa.
//
// Quem detecta só RESERVA a trava (`pendente`); quem envia é `rodarAvisosDaHelenaEquipe`, depois dos avisos que já existem.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import {
  avisoDaRodadaGasto, celularSoDoConsultor, enviarComConferencias, gravarTrava, type Trava,
} from './investidorAgenteAvisos';

const LOG = 'investidor-agente-avisos-equipe';

export const PREFIXO_AVISO_SILENCIO = 'inv_agente_aviso_silencio:';
export const PREFIXO_AVISO_ASSUMIU = 'inv_agente_aviso_assumiu:';
export const CARIMBO_SILENCIO = 'ficha_lead:helena:silencio:';
export const CARIMBO_ASSUMIU = 'ficha_lead:helena:assumiu:';

/** Um pendente mais velho que isto não é mais lido: aviso é recado do momento, não fila. */
const PENDENTE_VALE_MS = 48 * 3_600_000;

export type TipoDoAviso = 'silencio' | 'assumiu';
const TRAVAS: Readonly<Record<TipoDoAviso, { trava: string; carimbo: string }>> = {
  silencio: { trava: PREFIXO_AVISO_SILENCIO, carimbo: CARIMBO_SILENCIO },
  assumiu: { trava: PREFIXO_AVISO_ASSUMIU, carimbo: CARIMBO_ASSUMIU },
};

interface Pendente extends Trava { chave: string; consultor: string; texto: string }

export type ReservaDoAviso = 'nova' | 'existia' | 'erro';

/**
 * Reserva a trava `pendente` do aviso (o insert é o claim: 1 por sessão, para sempre). `nova` = nasceu agora; `existia` = o aviso desta sessão
 * já foi reservado (23505): o estado pode mudar, o aviso não repete; `erro` = não deu para gravar (quem chama NÃO muda o estado). Nunca lança.
 */
export async function reservarAvisoDaEquipe(
  tipo: TipoDoAviso, e: { chave: string; consultor: string; texto: string }, agora: Date = new Date(),
): Promise<ReservaDoAviso> {
  try {
    const valor: Pendente = { estado: 'pendente', chave: e.chave, consultor: e.consultor, texto: e.texto };
    const { error } = await supabase.from('system_state').insert({ key: `${TRAVAS[tipo].trava}${e.chave}`, value: valor, updated_at: agora.toISOString() });
    if (!error) return 'nova';
    if (String((error as { code?: string }).code) === '23505') return 'existia';
    logger.error(LOG, 'reservar o aviso da equipe falhou: o estado não muda', error);
    return 'erro';
  } catch (err) {
    logger.error(LOG, 'reservar o aviso da equipe falhou: o estado não muda', err);
    return 'erro';
  }
}

const lerValor = (v: unknown): Record<string, unknown> | null => {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return null; } }
  return x && typeof x === 'object' ? x as Record<string, unknown> : null;
};

const FILTRO_DAS_TRAVAS = `key.like.${PREFIXO_AVISO_SILENCIO}%,key.like.${PREFIXO_AVISO_ASSUMIU}%`;
const tipoDaChave = (key: string): TipoDoAviso | null =>
  key.startsWith(PREFIXO_AVISO_SILENCIO) ? 'silencio' : key.startsWith(PREFIXO_AVISO_ASSUMIU) ? 'assumiu' : null;

/** Os pendentes dos dois tipos, do mais antigo ao mais novo. `velhos`: com mais de 48 h (ou só os de até 48 h). Erro de leitura sobe. */
async function lerPendentes(agora: Date, velhos: boolean): Promise<Array<{ key: string; tipo: TipoDoAviso; p: Pendente }>> {
  const corte = new Date(agora.getTime() - PENDENTE_VALE_MS).toISOString();
  const base = supabase.from('system_state').select('key, value').or(FILTRO_DAS_TRAVAS).eq('value->>estado', 'pendente');
  const { data, error } = await (velhos ? base.lt('updated_at', corte) : base.gte('updated_at', corte))
    .order('updated_at', { ascending: true }).limit(50);
  if (error) throw new Error(`ler os avisos pendentes da Helena: ${error.message}`);
  const out: Array<{ key: string; tipo: TipoDoAviso; p: Pendente }> = [];
  for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
    const v = lerValor(l.value);
    const tipo = tipoDaChave(l.key);
    if (!v || v.estado !== 'pendente' || !tipo) continue;
    if (!velhos && (typeof v.texto !== 'string' || !v.texto)) continue;
    out.push({ key: l.key, tipo, p: v as unknown as Pendente });
  }
  return out;
}

/** Pendente com mais de 48 h morre: aviso é recado do momento. Fica uma linha de log (sem telefone) para a perda não passar calada. */
async function descartarVelhos(agora: Date): Promise<void> {
  for (const { key, tipo, p } of await lerPendentes(agora, true)) {
    logger.warn(LOG, `[helena-aviso] aviso de ${tipo} descartado: pendente há mais de 48 h (sessão final ${String(p.chave ?? '').slice(-2)})`);
    await gravarTrava(key, { ...p, estado: 'descartado', motivo: 'velho' }, agora);
  }
}

/**
 * Tenta UM aviso pendente (o mais antigo). Chamada DEPOIS dos avisos da marcação e do resumo do dia: se um deles já gastou a vez
 * da rodada, não faz nada. Leitura da lista de celulares que falha deixa a trava pendente; consultor sem celular a descarta.
 */
export async function rodarAvisosDaHelenaEquipe(agora: Date = new Date(), sorteio?: () => number): Promise<Record<string, unknown>> {
  if (avisoDaRodadaGasto()) return { pulou: 'aviso_ja_saiu_na_rodada' };
  try {
    await descartarVelhos(agora);
    for (const { key, tipo, p } of await lerPendentes(agora, false)) {
      const { lido, tel } = await celularSoDoConsultor(p.consultor);
      if (!lido) { logger.warn(LOG, 'ler os celulares da equipe falhou: o aviso continua pendente'); continue; }
      if (!tel) {
        logger.warn(LOG, 'consultor sem celular cadastrado: o aviso é descartado');
        await gravarTrava(key, { ...p, estado: 'descartado', motivo: 'sem_celular' }, agora);
        continue;
      }
      const r = await enviarComConferencias({
        tel, texto: p.texto, trava: key, valor: p, carimbo: `${TRAVAS[tipo].carimbo}${p.chave}`, agora, sorteio,
      });
      return { tipo, enviados: r === 'enviado' ? 1 : 0, ...(r === 'pendente' ? { motivo: 'pendente' } : {}) };
    }
    return { nada: true };
  } catch (err) {
    logger.error(LOG, 'rodada dos avisos da Helena à equipe falhou', err);
    return { erro: String((err as Error)?.message || err).slice(0, 200) };
  }
}
