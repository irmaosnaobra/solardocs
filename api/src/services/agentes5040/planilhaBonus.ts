// ─────────────────────────────────────────────────────────────────────────────
// BÔNUS DA PLANILHA (B3c). NADA aqui envia mensagem: a planilha prometida é entregue por
// e-mail ou no app quando existir, nunca pelo WhatsApp. Aqui só se REGISTRA quem tem direito.
//
//  · registrarPromessa(telefone, agora): a Carla prometeu a planilha a quem fechar HOJE.
//    Grava system_state `ag5040_planilha_prometida:<hmac do contato>` = { dia } (dia em Brasília).
//    Sem telefone cru na chave nem no valor: a chave leva o HMAC (hmac.ts).
//  · concederSeFechouNoDia({ userId, telefone, origem, agora }): chamado DEPOIS de um pagamento
//    já processado e gravado. Só se a promessa é do MESMO dia, grava (INSERT, nunca sobrescreve)
//    `ag5040_bonus_planilha:<userId>` = { dia, origem }. Devolve true só quando concedeu agora.
//  · fecharPosseDaCarla(telefones): quem pagou deixa de ser lead da Carla. Só posse dona carla + estado viva
//    vira encerrada; Duda, Helena e humano nunca são tocadas. Roda dentro do gancho abaixo.
//  · tentarBonusPosPagamento(...): o gancho dos três caminhos de pagamento. Resolve o telefone
//    do usuário (users.whatsapp, 1 leitura simples), tem prazo curto e NUNCA lança: o pagamento
//    não pode mudar por causa do bônus (nem status, nem valor, nem plano, nem liberação).
//
// Import mínimo de propósito (o webhook de pagamento importa este arquivo): supabase, hmac,
// relogio e o chaveContato (que só puxa supabase e logger). Todas as funções NUNCA lançam.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { hmacDe } from './hmac';
import { diaBRT, type Instante } from './relogio';
import { atualizarPosse, chaveDaPosse, lerPosse } from './posse';

export const PREFIXO_PROMESSA = 'ag5040_planilha_prometida:';
export const PREFIXO_BONUS = 'ag5040_bonus_planilha:';

/** Prazo do gancho: leitura/gravação simples, e o webhook segue de qualquer jeito. */
export const PRAZO_GANCHO_MS = 2500;

export type OrigemBonus = 'stripe' | 'kiwify_pix' | 'pix_comprovante';

/** A chave da promessa: HMAC da chave do contato (DDD + 8 últimos). null = telefone inútil ou sem segredo. */
function chavePromessa(telefone: string | null | undefined): string | null {
  const ck = chaveContato(telefone);
  if (!ck) return null;
  const h = hmacDe(`planilha|${ck}`);
  return h ? PREFIXO_PROMESSA + h : null;
}

const chaveBonus = (userId: string): string => PREFIXO_BONUS + userId;

/** Registra que a Carla prometeu a planilha a este contato hoje. true = gravou. Nunca lança. */
export async function registrarPromessa(telefone: string | null | undefined, agora: Instante): Promise<boolean> {
  try {
    const chave = chavePromessa(telefone);
    const dia = diaBRT(agora);
    if (!chave || !dia) return false;
    const { error } = await supabase
      .from('system_state')
      .upsert({ key: chave, value: { dia }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return !error;
  } catch {
    return false;
  }
}

/** Concede o bônus se a promessa do contato é do mesmo dia (Brasília) do fechamento. true = concedeu agora. Nunca lança. */
export async function concederSeFechouNoDia(a: {
  userId: string | null | undefined;
  telefone: string | null | undefined;
  origem: OrigemBonus;
  agora: Instante;
}): Promise<boolean> {
  try {
    const userId = String(a.userId ?? '').trim();
    const chave = chavePromessa(a.telefone);
    const hoje = diaBRT(a.agora);
    if (!userId || !chave || !hoje) return false;

    const { data, error } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    if (error) return false;
    const dia = (data as { value?: { dia?: unknown } } | null)?.value?.dia;
    if (typeof dia !== 'string' || dia !== hoje) return false;

    // INSERT, não upsert: reentrega do webhook ou 2º caminho de pagamento no mesmo dia não regrava.
    const { error: erroBonus } = await supabase
      .from('system_state')
      .insert({ key: chaveBonus(userId), value: { dia: hoje, origem: a.origem }, updated_at: new Date().toISOString() });
    return !erroBonus;
  } catch {
    return false;
  }
}

/**
 * Quem pagou não é mais lead da Carla: se a posse deste telefone é da Carla e está viva, ela fecha (estado encerrada).
 * Posse de Duda, Helena ou humano nunca é tocada. Telefones iguais depois da normalização (55, 9º dígito) contam uma vez.
 * Nunca lança: o pagamento já foi processado e não pode mudar por causa disto.
 */
export async function fecharPosseDaCarla(telefones: ReadonlyArray<string | null | undefined>): Promise<boolean> {
  let fechou = false;
  const vistos = new Set<string>();
  for (const t of telefones) {
    try {
      const ck = chaveDaPosse(t);
      if (!ck || vistos.has(ck)) continue;
      vistos.add(ck);
      const p = await lerPosse(ck);
      if (p && p.dona === 'carla' && p.estado === 'viva' && await atualizarPosse(ck, { estado: 'encerrada' })) fechou = true;
    } catch {
      /* erro de leitura ou de gravação: segue sem mudar nada */
    }
  }
  return fechou;
}

/**
 * O gancho dos pagamentos. Chamar DEPOIS de o pagamento estar processado e gravado.
 * `telefone` é o plano B (o do próprio pagamento) quando o usuário não tem users.whatsapp.
 * Sempre resolve (nunca lança, nunca passa de PRAZO_GANCHO_MS): devolve true só se concedeu.
 */
export async function tentarBonusPosPagamento(a: {
  userId?: string | null;
  email?: string | null;
  telefone?: string | null;
  origem: OrigemBonus;
  agora?: Instante;
}): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const trabalho = (async (): Promise<boolean> => {
      let userId = String(a.userId ?? '').trim();
      let whatsapp: string | null = null;
      const email = String(a.email ?? '').toLowerCase().trim();
      if (userId || email) {
        const q = supabase.from('users').select('id, whatsapp');
        const { data } = await (userId ? q.eq('id', userId) : q.eq('email', email)).maybeSingle();
        const u = data as { id?: string | null; whatsapp?: string | null } | null;
        if (u?.id) userId = String(u.id);
        whatsapp = u?.whatsapp ?? null;
      }
      // A posse da Carla fecha quando o pagamento entra (a Giovanna atende daqui em diante), com ou sem direito ao bônus.
      await fecharPosseDaCarla([whatsapp, a.telefone ?? null]);
      if (!userId) return false;
      const agora = a.agora ?? new Date();
      const candidatos = [whatsapp, a.telefone ?? null].filter((t): t is string => !!chaveContato(t));
      const vistos = new Set<string>();
      for (const t of candidatos) {
        const ck = chaveContato(t) as string;
        if (vistos.has(ck)) continue;
        vistos.add(ck);
        if (await concederSeFechouNoDia({ userId, telefone: t, origem: a.origem, agora })) return true;
      }
      return false;
    })();
    const prazo = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), PRAZO_GANCHO_MS); });
    return await Promise.race([trabalho.catch(() => false), prazo]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
