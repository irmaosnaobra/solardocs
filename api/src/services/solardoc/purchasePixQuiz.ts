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

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { enviarEventoMeta, cookieMeta, type EventoMeta, type NavegadorMeta, type ResultadoMeta } from '../../utils/metaCapi';
import { lerLeadDoQuiz, campoDe, ehLeadDeTeste, type LeadQuizLinha } from './avisoGrupoSolardoc';
import {
  idDoEventoPix, PREFIXO_CLAIM_PURCHASE_PIX, camposDoVinculo, ligarVendaAoClaim,
  type VinculoClaim, type ClaimEnviado,
} from './purchasePixVinculo';
import type { SaleInput } from '../salesLedger';

// O id e o prefixo moram em purchasePixVinculo (módulo leve); daqui seguem exportados.
export { idDoEventoPix, PREFIXO_CLAIM_PURCHASE_PIX };
export const URL_PURCHASE_PIX_QUIZ = 'https://solardoc.app/diagnostico';
export const TETO_PURCHASE_PIX_MS = 8000;
/** Prazo (desde o início) para o Meta responder: estoura antes do teto, para o claim sair de `novo` e ficar `falhou`. */
export const PRAZO_ENVIO_PURCHASE_PIX_MS = 6000;

export type MotivoPurchasePix =
  | 'enviado' | 'falhou' | 'nao_e_quiz' | 'teste' | 'duplicado' | 'sem_id' | 'sem_claim' | 'timeout' | 'erro';

/**
 * A venda do ledger que anda junto com este Purchase. `checkoutSessionId` é a chave da linha em `sales`.
 * Com `criar`, a linha é criada (upsertSale) quando o claim está `enviado` e já nasce marcada como enviada, com o id do
 * claim: é o caso do Pix por comprovante e do /pix-liberar, que antes mandavam Purchase sem linha em `sales`.
 */
export interface VendaDoPurchasePix extends VinculoClaim {
  checkoutSessionId: string;
  criar?: { plano: string; produto: string } | null;
}

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
  /** Venda do ledger ligada a este Purchase (ver VendaDoPurchasePix). Sem ela, nada de `sales` é tocado. */
  venda?: VendaDoPurchasePix | null;
}

export interface DepsPurchasePix {
  lerLead: (telefone: string) => Promise<LeadQuizLinha | null>;
  /** 'ok' gravou, 'duplicado' já existia, 'erro' não gravou. */
  claim: (chave: string, valor: Record<string, unknown>) => Promise<'ok' | 'duplicado' | 'erro'>;
  marcar: (chave: string, valor: Record<string, unknown>) => Promise<void>;
  /** Lê o valor do claim (estado e hora). null = não existe. */
  lerClaim: (chave: string) => Promise<{ estado?: string; em?: string } | null>;
  /** Claim `enviado`: marca (e, com `criar`, cria) a linha `sales` com o id do claim. Nunca lança. */
  ligarVenda: (a: { checkoutSessionId: string; claim: ClaimEnviado; criar: SaleInput | null }) => Promise<void>;
  /** Cria (upsert por checkout_session_id: nunca 2 linhas) a linha `sales` SEM marcá-la como enviada. Nunca lança. */
  criarVenda: (criar: SaleInput) => Promise<void>;
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
  lerClaim: async chave => {
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    return (data as { value?: { estado?: string; em?: string } | null } | null)?.value ?? null;
  },
  ligarVenda: async ({ checkoutSessionId, claim, criar }) => {
    try {
      if (criar) { const { upsertSale } = await import('../salesLedger'); await upsertSale(criar); }
      await ligarVendaAoClaim(checkoutSessionId, claim);
    } catch (err) {
      logger.warn('purchase-pix-quiz', 'ligar a venda ao claim do Pix falhou (o Purchase já foi)', { erro: String(err) });
    }
  },
  criarVenda: async criar => {
    try {
      const { upsertSale } = await import('../salesLedger');
      await upsertSale(criar);
    } catch (err) {
      logger.warn('purchase-pix-quiz', 'criar a linha da venda do Pix falhou (o Purchase segue)', { erro: String(err) });
    }
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

  const fd = lead?.field_data ?? [];
  const lpSession = campoDe(fd, 'lp_session');
  let nav: NavegadorMeta = lead ? { fbc: cookieMeta(campoDe(fd, 'fbc')), fbp: cookieMeta(campoDe(fd, 'fbp')) } : {};
  const quandoMs = e.quando instanceof Date ? e.quando.getTime() : typeof e.quando === 'number' ? e.quando : d.agora().getTime();

  // A venda do ledger que anda com este Purchase (1 Pix = 1 evento = 1 linha em `sales`, com o MESMO id).
  const venda = e.venda?.checkoutSessionId ? e.venda : null;
  const extras = venda ? camposDoVinculo(venda, e.chaveE2e) : {};
  const criar = (): SaleInput | null => venda?.criar ? {
    checkout_session_id: venda.checkoutSessionId, email: e.email ?? null, nome: e.nome || lead?.nome || null,
    phone: e.telefone || null, plano: venda.criar.plano, produto: venda.criar.produto, valor: e.valor, status: 'paid',
    fbc: nav.fbc ?? null, fbp: nav.fbp ?? null, attribution_session_id: lpSession || null,
    card_passed_at: new Date(quandoMs).toISOString(),
    // Nasce com o id do claim: o re-drive do ledger confere o claim (`enviado`: fecha a linha; `novo` recente: espera;
    // `falhou` ou `novo` velho: reenvia com o MESMO id). `meta_response_ok` não é tocado aqui: o banco o cria `false`.
    meta_event_id: eventId,
  } : null;
  const criarPendente = async (): Promise<void> => {
    const nova = criar();
    if (nova) await d.criarVenda(nova);
  };
  const ligar = async (claim: ClaimEnviado): Promise<void> => {
    if (venda) await d.ligarVenda({ checkoutSessionId: venda.checkoutSessionId, claim, criar: criar() });
  };

  const c = await d.claim(chaveClaim, { estado: 'novo', em: d.agora().toISOString(), ...extras });
  if (c === 'duplicado') {
    // O claim já existia (outro caminho mandou este mesmo Pix). Se ele FOI enviado, a venda tem que sair marcada com o id
    // dele: sem isso o re-drive do ledger a mandaria de novo, com outro id.
    if (venda) {
      try {
        const st = await d.lerClaim(chaveClaim);
        if (st?.estado === 'enviado') await ligar({ eventId, em: String(st.em || d.agora().toISOString()) });
        // Claim `novo` (outro envio em andamento) ou `falhou`: a linha nasce mesmo assim, pendente (meta_response_ok = false,
        // sem hora de envio), e o re-drive reenvia com o mesmo id se for o caso. O upsert por checkout_session_id evita linha dobrada.
        else await criarPendente();
      } catch { /* o Purchase não depende disto */ }
    }
    return 'duplicado';
  }
  if (c === 'erro') return 'sem_claim';

  if (lpSession) {
    try {
      const v = await d.navegador(lpSession);
      nav = { ...nav, userAgent: v.userAgent, ip: v.ip };
    } catch { /* opcional */ }
  }

  // A linha `sales` nasce ANTES do envio, pendente: se o Meta recusar ou o prazo estourar, o re-drive do ledger a reenvia com o
  // MESMO id. Com o envio certo, `ligar` a marca como enviada (mesma linha: o upsert é por checkout_session_id).
  await criarPendente();

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
  const resultado: Record<string, unknown> = { estado: ok ? 'enviado' : 'falhou', em: d.agora().toISOString(), ...extras };
  if (!ok) { resultado.erro = String(erro ?? '').slice(0, 200); logger.warn('purchase-pix-quiz', `Purchase recusado: ${resultado.erro}`); }
  try { await d.marcar(chaveClaim, resultado); } catch { /* o claim já existe: não reenvia */ }
  // Enviado: a linha `sales` do mesmo pagamento (se houver, ou se for para criar) sai marcada com o id e a hora do claim.
  if (ok) await ligar({ eventId, em: String(resultado.em) });
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
