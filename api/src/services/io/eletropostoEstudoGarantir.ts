// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO DO LOCAL, a porta de entrada: cria a linha e devolve o link.
//
// Fica separado do tick para o /alerta e o card poderem importar sem puxar Google,
// IA e WhatsApp junto (e sem ciclo de import com routes/ioEletroposto).
//
// Kill-switch: EP_ESTUDO_OFF=1 (card sai sem link, tick responde "desligado").
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { bancoConfigurado, garantirLinha, listar, type OrigemEstudo } from './eletropostoEstudoBanco';
import { extrairFicha, preNota, urlDoEstudo } from './eletropostoEstudoPuro';
import { avaliarPortao } from './eletropostoPortao';

/**
 * A rede de segurança do tick só cria estudo para ficha nascida depois disto. As
 * reuniões que já estavam na agenda quando o estudo entrou no ar vão pelo backfill,
 * que não manda aviso nenhum.
 */
export const ESTUDO_NO_AR_EM = '2026-09-15T18:00:00-03:00';

export const estudoDesligado = (): boolean => (process.env.EP_ESTUDO_OFF || '').trim() === '1';

/** Só ficha com a linha "Endereço:" tem terreno para estudar. */
export const temEndereco = (observacao: string | null | undefined): boolean =>
  /^Endereço:/m.test(String(observacao ?? ''));

/**
 * Garante a linha do estudo da reunião e devolve o link. Idempotente: chamar duas
 * vezes devolve o mesmo token. Nunca lança: sem estudo, o card sai como sempre saiu.
 */
export async function garantirEstudo(
  ag: { id: number; observacao: string | null },
  origem: OrigemEstudo = 'alerta',
  o: { avisoEnviado?: boolean } = {},
): Promise<{ token: string; url: string } | null> {
  if (estudoDesligado() || !bancoConfigurado() || !temEndereco(ag.observacao)) return null;
  try {
    const token = await garantirLinha({
      agendamentoId: ag.id,
      token: crypto.randomBytes(32).toString('hex'),
      origem,
      dados: { portao: avaliarPortao(extrairFicha(ag.observacao)) },
      avisoEnviado: o.avisoEnviado,
    });
    return token ? { token, url: urlDoEstudo(token) } : null;
  } catch (e) {
    logger.error('ep-estudo', 'não criou a linha do estudo', { id: ag.id, erro: String((e as Error)?.message || e).slice(0, 200) });
    return null;
  }
}

/**
 * As duas linhas que o card NOVA REUNIÃO ganha. A pré-nota sai da ficha na hora
 * (não depende do estudo); o link só existe quando a linha do estudo existe.
 */
export function extraDoCard(observacao: string | null | undefined, token?: string | null): { estudoUrl?: string; preNota?: number } {
  if (!temEndereco(observacao)) return {};
  return {
    preNota: preNota(extrairFicha(observacao)).valor,
    ...(token ? { estudoUrl: urlDoEstudo(token) } : {}),
  };
}

/** Tokens das reuniões que já têm estudo. Falha vira mapa vazio: o card sai sem o link. */
export async function tokensDasReunioes(ids: number[]): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  if (!ids.length || estudoDesligado() || !bancoConfigurado()) return mapa;
  try {
    for (const l of await listar('por_agendamentos', { ids, limite: 200 })) {
      if (l.status !== 'descartado') mapa.set(Number(l.agendamento_id), l.token);
    }
  } catch (e) {
    logger.warn('ep-estudo', 'não leu os tokens do estudo', String((e as Error)?.message || e).slice(0, 200));
  }
  return mapa;
}
