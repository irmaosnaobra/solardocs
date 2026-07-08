import { supabase } from '../../../utils/supabase';
import { sendWhatsApp } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { PIX_DADOS } from '../../../utils/pixInfo';

// ─────────────────────────────────────────────────────────────────────────────
// Lembrete mensal de renovação VIP pago por Pix.
//
// VIP por Pix NÃO tem assinatura no Stripe — a renovação é manual (Thiago bumpa
// plano_expira_em +1 mês quando o cliente paga). Este serviço só AVISA o cliente
// que o VIP está vencendo e manda o valor + chave Pix. Não cobra, não renova.
//
// Decisões (jun/2026): só pro cliente 84994501564; dispara por plano_expira_em
// (~0-2 dias antes do vencimento), não por "dia 11 fixo" — assim o aviso segue
// a data real, para sozinho se ele deixar de ser VIP, e não dispara horas depois
// de ele já ter pago/renovado. Tom curto e direto (aprovado pelo Thiago).
//
// Best-effort: Z-API pode banir número que faz outbound automatizado, então
// qualquer falha de envio é logada e engolida (não derruba o cron master).
// ─────────────────────────────────────────────────────────────────────────────

// Janela do vencimento em que o lembrete dispara (dias à frente de agora).
const JANELA_DIAS = 2;
// Não repetir o lembrete dentro deste intervalo — cobre o mesmo ciclo mensal
// (a janela acima reabre todo mês quando plano_expira_em for empurrado +1 mês).
const COOLDOWN_DIAS = 20;

const DIA_MS = 24 * 60 * 60 * 1000;

function montarMensagem(nome: string | null): string {
  const oi = nome ? `Oi ${nome.split(' ')[0]}! ` : 'Oi! ';
  return [
    `${oi}Tudo bem? 😊`,
    '',
    'Seu acesso ao SolarDoc está *vencendo*.',
    'Pra renovar por mais um mês, é só fazer o Pix:',
    '',
    `🔑 Chave Pix (CNPJ): *${PIX_DADOS.chave}*`,
    `${PIX_DADOS.titular} · ${PIX_DADOS.banco} · Ag ${PIX_DADOS.agencia} · Conta ${PIX_DADOS.conta}`,
    '',
    'Assim que cair, me manda o *comprovante aqui* que eu confirmo o valor e libero na hora. Qualquer dúvida me chama! 🙌',
  ].join('\n');
}

export async function runPixVipReminder(): Promise<{ enviados: number; pulados: number; erros: number }> {
  let enviados = 0, pulados = 0, erros = 0;

  const agora = Date.now();
  const limite = new Date(agora + JANELA_DIAS * DIA_MS).toISOString();

  // Alvo: o cliente Pix-VIP, ainda ilimitado, com vencimento dentro da janela.
  // Alvo GERAL: qualquer cliente Pix (plano pago + plano_expira_em setado na
  // liberação manual) com vencimento dentro da janela. Antes era travado num
  // único número; agora vale pra todo mundo que paga por Pix.
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, plano, plano_expira_em, pix_reminder_last_sent_at')
    .neq('plano', 'free')
    .not('whatsapp', 'is', null)
    .not('plano_expira_em', 'is', null)
    .lte('plano_expira_em', limite);

  if (error) {
    logger.error('pix-vip-reminder', 'leitura de users falhou', error);
    return { enviados, pulados, erros: 1 };
  }
  if (!users?.length) return { enviados, pulados, erros };

  for (const u of users) {
    // Cooldown: não reenviar dentro do mesmo ciclo mensal.
    if (u.pix_reminder_last_sent_at) {
      const desde = agora - new Date(u.pix_reminder_last_sent_at).getTime();
      if (desde < COOLDOWN_DIAS * DIA_MS) { pulados++; continue; }
    }

    try {
      await sendWhatsApp(u.whatsapp, montarMensagem(u.nome), 'solardoc');
      await supabase
        .from('users')
        .update({ pix_reminder_last_sent_at: new Date().toISOString() })
        .eq('id', u.id);
      enviados++;
      logger.info('pix-vip-reminder', `lembrete enviado pra ${u.email} (vence ${u.plano_expira_em})`);
    } catch (err) {
      erros++;
      logger.error('pix-vip-reminder', `envio falhou pra ${u.email}`, err);
    }
  }

  return { enviados, pulados, erros };
}
