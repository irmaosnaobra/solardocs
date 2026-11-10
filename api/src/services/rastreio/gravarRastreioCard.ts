// ─────────────────────────────────────────────────────────────────────────────
// A ORIGEM DO LEAD GRAVADA NO CARD DA AGENDA (10/11/2026).
//
// fbc, fbp, fbclid, IP, navegador, página e referrer vão para `agendamento_rastreio` (banco do Gerador), NUNCA para
// `agendamentos`: essa tabela é lida pela chave pública do /gerador, e a de rastreio tem RLS ligada, sem acesso da
// chave pública (só o servidor, com a service role, grava e lê). Migration: MIGRATION_rastreamento_nivel5.sql.
//
// Regras:
//  - NUNCA lança. A agenda não pode falhar por causa do rastreio: erro vira um console.warn sem dado pessoal.
//  - O primeiro registro vale (insert com on conflict do nothing).
//  - Tudo vazio = nada é gravado.
//  - O ctwaClid (clique em anúncio de WhatsApp) NÃO entra aqui, nem em banco nenhum: ver agentes5040/anuncio.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { cookieMeta } from '../../utils/metaCapi';
import { lerCapi } from '../meta/capiNavegador';

export interface DadosRastreio {
  fbc?: string | null;
  fbp?: string | null;
  fbclid?: string | null;
  client_ip?: string | null;
  user_agent?: string | null;
  landing_url?: string | null;
  referrer?: string | null;
}

/** Teto de espera: o rastreio nunca segura a resposta da agenda por mais que isto. */
const TETO_MS = 2_000;

const CAMPOS: Array<[keyof DadosRastreio, number]> = [
  ['fbc', 500], ['fbp', 500], ['fbclid', 500], ['client_ip', 64], ['user_agent', 1000], ['landing_url', 1000], ['referrer', 1000],
];

/** Texto aparado e cortado; vazio ou não-texto vira null. */
const limpo = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** O id do anúncio da Meta que vem no utm_content: só dígitos, 10 a 20. Qualquer outra coisa vira null. */
export function adIdDeUtmContent(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\d{10,20}$/.test(s) ? s : null;
}

/**
 * O que a requisição trouxe, na ordem: corpo, `_capi` do field_data (se vier), req.ip e o header user-agent.
 * fbc e fbp só passam no formato do Meta. Função pura: não lê nem grava nada.
 */
export function rastreioDaRequisicao(
  req: Pick<Request, 'ip' | 'headers'>, b: Record<string, unknown> = {}, fieldData?: unknown,
): DadosRastreio {
  const capi = fieldData === undefined ? null : lerCapi(fieldData);
  return {
    fbc: cookieMeta(b.fbc) ?? capi?.fbc ?? null,
    fbp: cookieMeta(b.fbp) ?? capi?.fbp ?? null,
    fbclid: limpo(b.fbclid, 500),
    client_ip: limpo(req.ip, 64) ?? capi?.client_ip_address ?? null,
    user_agent: limpo(String(req.headers?.['user-agent'] ?? ''), 1000) ?? capi?.client_user_agent ?? null,
    landing_url: limpo(b.landing_url, 1000) ?? capi?.event_source_url ?? null,
    referrer: limpo(b.referrer, 1000),
  };
}

/**
 * Grava o rastreio do card. Sem erro nunca: devolve sem fazer nada se tudo veio vazio, e engole qualquer falha.
 * `agendamentoId` inválido (não é número inteiro positivo) também não grava.
 */
export async function gravarRastreioCard(agendamentoId: number | string | null | undefined, dados: DadosRastreio | null | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = Number(agendamentoId);
    if (!Number.isInteger(id) || id <= 0 || !dados) return;
    const linha: Record<string, string | number> = {};
    for (const [campo, max] of CAMPOS) {
      const v = limpo(dados[campo], max);
      if (v) linha[campo] = v;
    }
    if (!Object.keys(linha).length) return;
    linha.agendamento_id = id;
    // Insert com on conflict do nothing: o primeiro registro vale.
    const r = await Promise.race([
      Promise.resolve(supabaseGerador.from('agendamento_rastreio').upsert(linha, { onConflict: 'agendamento_id', ignoreDuplicates: true })),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TETO_MS); }),
    ]);
    if (r === null) console.warn('gravarRastreioCard: passou do teto, a agenda seguiu sem esperar');
    else if (r?.error) console.warn(`gravarRastreioCard: o banco recusou (${String(r.error.code ?? 'sem codigo')})`);
  } catch {
    console.warn('gravarRastreioCard: falhou, a agenda seguiu sem o rastreio');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
