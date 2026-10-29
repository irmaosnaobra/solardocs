// Purchase do pixel SolarDoc quando a PRIMEIRA compra sai por Pix (comprovante liberado no WhatsApp ou liberação manual).
// Antes só o cartão e o Asaas mandavam Purchase; o Pix por comprovante não mandava nada e o Meta não aprendia
// quem comprou. Regras (as mesmas do envio feito à mão em 27/10/2026, ampliadas em 29/10/2026):
//   - lead do quiz (achado pelo telefone): leva fbc, fbp e navegador da LP; lead de teste nunca manda;
//   - comprador sem lead do quiz (29/10/2026, ordem do dono: toda venda nova vai ao Meta): manda mesmo assim, só com
//     telefone, e-mail e nome da entrada, sem fbc/fbp, como system_generated;
//   - renovação e pagamento parcial não chegam aqui (o gancho fica em avisarCompraNoGrupo, que já sai cedo nelas);
//   - event_id determinístico a partir da chave do comprovante: o mesmo Pix reenviado gera o mesmo id;
//   - claim só de inserção em system_state (banco principal): um Pix, um Purchase;
//   - nunca lança e nunca passa de 8 s: o pagamento já foi liberado e não espera nem quebra por causa disto.

import { createHash } from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { enviarEventoMeta, cookieMeta, type EventoMeta, type NavegadorMeta, type ResultadoMeta } from '../../utils/metaCapi';
import { lerLeadDoQuiz, campoDe, ehLeadDeTeste, type LeadQuizLinha } from './avisoGrupoSolardoc';

export const URL_PURCHASE_PIX_QUIZ = 'https://solardoc.app/diagnostico';
export const PREFIXO_CLAIM_PURCHASE_PIX = 'meta_purchase_pix:';
export const TETO_PURCHASE_PIX_MS = 8000;
/** Prazo (desde o início) para o Meta responder: estoura antes do teto, para o claim sair de `novo` e ficar `falhou`. */
export const PRAZO_ENVIO_PURCHASE_PIX_MS = 6000;

/** `pix_` + os 32 primeiros hex do sha256 (UTF-8) da chave inteira do system_state (`pix_e2e:<21>:<valor>`) ou, sem E2E, do dedupKey. */
export const idDoEventoPix = (chave: string): string =>
  'pix_' + createHash('sha256').update(chave, 'utf8').digest('hex').slice(0, 32);

export type MotivoPurchasePix =
  | 'enviado' | 'falhou' | 'nao_e_quiz' | 'teste' | 'duplicado' | 'sem_id' | 'sem_claim' | 'timeout' | 'erro';

export interface EntradaPurchasePix {
  telefone: string;
  email?: string | null;
  nome?: string | null;
  valor: number;
  /** Chave do E2E gravada no system_state (`pix_e2e:<21>:<valor>`), ou null. */
  chaveE2e?: string | null;
  dedupKey?: string | null;
  /** Hora da liberação. */
  quando?: Date | number | null;
}

export interface DepsPurchasePix {
  lerLead: (telefone: string) => Promise<LeadQuizLinha | null>;
  /** 'ok' gravou, 'duplicado' já existia, 'erro' não gravou. */
  claim: (chave: string, valor: Record<string, unknown>) => Promise<'ok' | 'duplicado' | 'erro'>;
  marcar: (chave: string, valor: Record<string, unknown>) => Promise<void>;
  navegador: (lpSession: string) => Promise<{ userAgent: string | null; ip: string | null }>;
  enviar: (ev: EventoMeta) => Promise<ResultadoMeta>;
  agora: () => Date;
}

const depsPadrao: DepsPurchasePix = {
  lerLead: telefone => lerLeadDoQuiz({ telefone }),
  claim: async (chave, valor) => {
    const em = new Date().toISOString();
    const { error } = await supabase.from('system_state').insert({ key: chave, value: valor, updated_at: em });
    if (!error) return 'ok';
    if ((error as { code?: string }).code === '23505') return 'duplicado';
    logger.error('purchase-pix-quiz', 'claim não gravou: Purchase não enviado', { erro: error.message });
    return 'erro';
  },
  marcar: async (chave, valor) => {
    const { error } = await supabase.from('system_state').update({ value: valor, updated_at: new Date().toISOString() }).eq('key', chave);
    if (error) logger.warn('purchase-pix-quiz', 'marcar o resultado do claim falhou', { erro: error.message });
  },
  navegador: async lpSession => {
    if (!/^[\w.:-]{1,100}$/.test(lpSession)) return { userAgent: null, ip: null };
    const { data } = await supabase.from('page_visits').select('user_agent, ip')
      .eq('session_id', lpSession).order('created_at', { ascending: true }).limit(1);
    const v = (data?.[0] ?? null) as { user_agent?: string | null; ip?: string | null } | null;
    return { userAgent: v?.user_agent || null, ip: v?.ip || null };
  },
  enviar: enviarEventoMeta,
  agora: () => new Date(),
};

/** Corre contra o prazo: estourou, vira recusa (`timeout_envio`) em vez de ficar pendurado. */
function withPrazo(p: Promise<ResultadoMeta>, ms: number): Promise<ResultadoMeta> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<ResultadoMeta>(resolve => { timer = setTimeout(() => resolve({ ok: false, status: 0, erro: 'timeout_envio' }), ms); });
  return Promise.race([p, limite]).finally(() => { if (timer) clearTimeout(timer); });
}

async function executar(e: EntradaPurchasePix, d: DepsPurchasePix): Promise<MotivoPurchasePix> {
  const inicio = Date.now();
  // Sem telefone legível não há o que procurar no quiz. Sem lead, o Purchase sai mesmo assim (comprador que não veio do quiz).
  const lead = /\d/.test(String(e.telefone ?? '')) ? await d.lerLead(e.telefone) : null;
  if (lead && ehLeadDeTeste(lead.field_data)) return 'teste';

  const chave = String(e.chaveE2e ?? '').trim() || String(e.dedupKey ?? '').trim();
  if (!chave) return 'sem_id';
  const eventId = idDoEventoPix(chave);
  const chaveClaim = `${PREFIXO_CLAIM_PURCHASE_PIX}${eventId}`;

  const c = await d.claim(chaveClaim, { estado: 'novo', em: d.agora().toISOString() });
  if (c === 'duplicado') return 'duplicado';
  if (c === 'erro') return 'sem_claim';

  const fd = lead?.field_data ?? [];
  const lpSession = campoDe(fd, 'lp_session');
  let nav: NavegadorMeta = lead ? { fbc: cookieMeta(campoDe(fd, 'fbc')), fbp: cookieMeta(campoDe(fd, 'fbp')) } : {};
  if (lpSession) {
    try {
      const v = await d.navegador(lpSession);
      nav = { ...nav, userAgent: v.userAgent, ip: v.ip };
    } catch { /* opcional */ }
  }

  const quandoMs = e.quando instanceof Date ? e.quando.getTime() : typeof e.quando === 'number' ? e.quando : d.agora().getTime();
  let ok = false;
  let erro: string | undefined;
  try {
    // Sem user agent (sem lead, lead sem lp_session ou sem linha em page_visits) o evento não prova navegador: system_generated.
    const r = await withPrazo(d.enviar({
      produto: 'solardoc', nome: 'Purchase', origem: nav.userAgent ? 'website' : 'system_generated', eventId,
      eventTime: Math.floor(quandoMs / 1000),
      urlDaPagina: URL_PURCHASE_PIX_QUIZ,
      pessoa: { telefone: e.telefone, email: e.email ?? undefined, nome: e.nome || lead?.nome || undefined },
      navegador: nav,
      valor: e.valor,
      dados: { content_name: 'VIP' },
    }), Math.max(500, PRAZO_ENVIO_PURCHASE_PIX_MS - (Date.now() - inicio)));
    ok = !!r?.ok;
    if (!ok) erro = r?.erro || `http_${r?.status}`;
  } catch (err) {
    erro = (err as Error)?.message || String(err);
  }
  const resultado: Record<string, unknown> = { estado: ok ? 'enviado' : 'falhou', em: d.agora().toISOString() };
  if (!ok) { resultado.erro = String(erro ?? '').slice(0, 200); logger.warn('purchase-pix-quiz', `Purchase recusado: ${resultado.erro}`); }
  try { await d.marcar(chaveClaim, resultado); } catch { /* o claim já existe: não reenvia */ }
  return ok ? 'enviado' : 'falhou';
}

/** Manda o Purchase do Pix do quiz. Nunca lança, devolve o motivo curto, e não passa de TETO_PURCHASE_PIX_MS. */
export async function dispararPurchasePixQuiz(e: EntradaPurchasePix, deps: Partial<DepsPurchasePix> = {}): Promise<MotivoPurchasePix> {
  const d: DepsPurchasePix = { ...depsPadrao, ...deps };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executar(e, d).catch((err): MotivoPurchasePix => {
        logger.warn('purchase-pix-quiz', `Purchase do Pix falhou: ${(err as Error)?.message || err}`);
        return 'erro';
      }),
      new Promise<MotivoPurchasePix>(resolve => {
        timer = setTimeout(() => {
          logger.warn('purchase-pix-quiz', `Purchase do Pix passou de ${TETO_PURCHASE_PIX_MS} ms: o pagamento seguiu sem esperar`);
          resolve('timeout');
        }, TETO_PURCHASE_PIX_MS);
      }),
    ]);
  } catch {
    return 'erro';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
