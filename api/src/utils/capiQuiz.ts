// ── API DE CONVERSÕES DOS QUIZZES (09/10/2026) ───────────────────────────────
// Cola entre as rotas dos quizzes (/io/solar e /io/eletroposto) e o util comum
// metaCapi.ts. As rotas só dizem O QUE aconteceu; aqui ficam as três regras que
// não podem ser repetidas em cada uma:
//   1. chave de desligar (CAPI_QUIZ_OFF=1), lida na hora da chamada;
//   2. teto de tempo: o lead espera a resposta da rota, e o Meta lento não pode
//      segurar a tela de "marcado" mais que ~1,5 s;
//   3. nunca lançar: Meta fora do ar não derruba quiz nenhum.
// A chamada só acontece DEPOIS de o banco gravar. Evento de lead que não existe
// ensinaria o Meta a procurar gente que não se cadastrou.

import type { Request } from 'express';
import { enviarEventoMeta, cookieMeta, sha256, normFone, type EventoMeta, type NavegadorMeta } from './metaCapi';
import { logger } from './logger';

/** Teto de espera da rota pelo Meta. A chamada segue viva depois dele, mas a resposta ao lead não. */
export const TETO_CAPI_MS = 1500;

export const capiQuizLigado = (): boolean => (process.env.CAPI_QUIZ_OFF || '').trim() !== '1';

/** Mesmo id que a página passou ao fbq (4º argumento). Fora do formato, sai sem id (o Meta não junta, mas conta). */
export function eventIdDe(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  return /^[\w-]{6,64}$/.test(s) ? s : undefined;
}

/**
 * Pedaço do telefone que vai dentro do event_id. O Meta NÃO faz hash do event_id e
 * ele aparece no Gerenciador de Eventos, então o número do cliente nunca vai em
 * texto puro. O hash é estável por telefone (com 55), e o reenvio continua dedup.
 */
export const idDoTelefone = (tel: unknown): string =>
  sha256(normFone(tel) ?? String(tel ?? '').replace(/\D/g, '')).slice(0, 24);

/** fbc/fbp só se tiverem o formato do Meta; IP e navegador vêm da própria requisição. */
export function navegadorDe(req: Request, b: Record<string, unknown>): NavegadorMeta {
  return {
    fbc: cookieMeta(b.fbc),
    fbp: cookieMeta(b.fbp),
    ip: req.ip || null,
    userAgent: String(req.headers?.['user-agent'] || '') || null,
  };
}

/**
 * Manda o evento sem nunca lançar e sem passar de TETO_CAPI_MS. Chamar com await
 * antes de responder (a Vercel corta o que roda depois da resposta).
 */
export async function enviarQuizMeta(ev: EventoMeta, onde: string): Promise<void> {
  if (!capiQuizLigado()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      enviarEventoMeta(ev),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TETO_CAPI_MS); }),
    ]);
    if (r === null) logger.warn(onde, `Meta CAPI ${ev.nome}: passou de ${TETO_CAPI_MS} ms, a rota seguiu sem esperar`);
    else if (!r.ok) logger.warn(onde, `Meta CAPI ${ev.nome} recusado: ${r.erro || r.status}`);
  } catch (err) {
    logger.warn(onde, `Meta CAPI ${ev.nome} falhou: ${(err as Error)?.message || err}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Limite inferior, em reais, de um rótulo de faixa de capital. "R$ 100 mil a R$ 200 mil"
 * vale 100000; "R$ 140 mil" vale 140000; "Acima de R$ 200 mil" e "Mais de R$ 500 mil"
 * valem o número que aparece. "Menos de" e "Até" têm TETO, não piso, e "Ainda não
 * sei" não tem número: os dois dão null, ou seja, não são quentes.
 */
export function capitalMinimo(rotulo: unknown): number | null {
  const s = String(rotulo ?? '').trim();
  if (!s || /^(menos|at[eé]|abaixo)\b/i.test(s)) return null;
  const m = s.match(/R\$\s*(\d+(?:[.,]\d+)?)\s*(mil(?:h[aãõ]\w*)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (/^milh/i.test(m[2]) ? 1_000_000 : 1_000));
}

export const CAPITAL_QUENTE = 100_000;
