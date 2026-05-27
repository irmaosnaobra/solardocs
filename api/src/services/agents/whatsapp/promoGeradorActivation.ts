// ════════════════════════════════════════════════════════════
// PROMO GERADOR — ATIVAÇÃO AUTOMÁTICA DE 10 CRÉDITOS
// ════════════════════════════════════════════════════════════
// Chamada pelo handleIncomingWhatsApp ANTES da Dani responder.
// Se o user recebeu a promo nas últimas 48h e mandou um e-mail
// válido na mensagem atual, ativa 10 créditos (limite_documentos)
// e retorna contexto pra Dani confirmar naturalmente.
//
// Idempotente: UPDATE atômico com WHERE promo_gerador_creditos_em IS NULL
// garante que mesmo se o user mandar 3 e-mails, só ativa 1 vez.
// ════════════════════════════════════════════════════════════

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';

const PROMO_WINDOW_HOURS = 48;
const CREDITOS_ATIVAR = 10;

// Regex relativamente permissiva — quer pegar e-mails reais sem capturar
// "moro na rua x@123" ou "x@y" (sem TLD).
const EMAIL_RX = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/;

export interface PromoActivationResult {
  ativado: boolean;
  ja_ativado_antes?: boolean;
  email?: string;
  motivo?: string;
}

export async function detectAndActivatePromoCredits(
  userId: string,
  text: string,
): Promise<PromoActivationResult> {
  // 1. Achou e-mail na mensagem?
  const match = text.match(EMAIL_RX);
  if (!match) return { ativado: false, motivo: 'sem_email_na_msg' };
  const email = match[1].toLowerCase();

  // 2. User está dentro da janela da promo e ainda não ativou?
  const { data: u, error } = await supabase
    .from('users')
    .select('id, promo_gerador_sent_at, promo_gerador_creditos_em, limite_documentos')
    .eq('id', userId)
    .single();

  if (error || !u) return { ativado: false, motivo: 'user_not_found' };

  if (!u.promo_gerador_sent_at) return { ativado: false, motivo: 'sem_promo' };
  if (u.promo_gerador_creditos_em) {
    return { ativado: false, ja_ativado_antes: true, email, motivo: 'ja_ativado' };
  }

  const sentAt = new Date(u.promo_gerador_sent_at).getTime();
  const ageHours = (Date.now() - sentAt) / 36e5;
  if (ageHours > PROMO_WINDOW_HOURS) {
    return { ativado: false, motivo: 'janela_expirada' };
  }

  // 3. UPDATE atômico — só atualiza se ainda não foi ativado por outra mensagem
  //    simultânea. Se 2 msgs chegarem ao mesmo tempo, só 1 ganha o lock.
  const { data: updated, error: updErr } = await supabase
    .from('users')
    .update({
      limite_documentos: CREDITOS_ATIVAR,
      promo_gerador_creditos_em: new Date().toISOString(),
      promo_gerador_email_capturado: email,
    })
    .eq('id', userId)
    .is('promo_gerador_creditos_em', null)
    .select('id');

  if (updErr) {
    logger.error('promo-activation', `update falhou pra ${userId}`, updErr);
    return { ativado: false, motivo: 'db_error' };
  }

  if (!updated || updated.length === 0) {
    // Lost the race — outra mensagem simultânea ativou primeiro.
    return { ativado: false, ja_ativado_antes: true, email, motivo: 'race_lost' };
  }

  logger.info('promo-activation', `+${CREDITOS_ATIVAR} créditos ativados pra ${userId} (email: ${email})`);
  return { ativado: true, email };
}
