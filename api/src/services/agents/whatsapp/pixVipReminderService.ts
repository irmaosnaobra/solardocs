import { supabase } from '../../../utils/supabase';
import { sendHuman } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { gerarPixCopiaECola } from '../../../utils/pixBrCode';
import { pixCheckoutUrl, PIX_MES_VALOR } from '../../../utils/pixInfo';

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

// Valor da renovação mensal por Pix: R$ 67 para TODO plano, desde 20/10/2026 (regra do
// dono). Antes era por plano (PRO pagava 27); hoje quem manda 27 recebe o aviso de que
// faltam R$ 40 e o Pix do restante (ver aplicarPagamentoPix).
const VALOR_RENOVACAO = PIX_MES_VALOR;

// Partes da mensagem de renovação: pitch + copia-e-cola (sozinho, fácil de copiar) +
// instrução do comprovante. O cliente paga e manda o comprovante → pixComprovanteService
// lê, valida e empurra o plano_expira_em +1 mês na hora.
const AVISO_PRO = 'A partir de agora a renovação no Pix é R$ 67,00, já com o plano Ilimitado.';

export function montarPartes(nome: string | null, valor: number = VALOR_RENOVACAO, plano: string | null = null): string[] {
  // Quem ainda está no PRO de R$ 27 é avisado da mudança NA MESMA bolha do pedido (sem bolha nova).
  const aviso = (plano || '').toLowerCase() === 'pro' ? ` ${AVISO_PRO}` : '';
  const oi = nome ? `Oi ${nome.split(' ')[0]}! ` : 'Oi! ';

  // RENOVAÇÃO EM UM CLIQUE. O checkout da Kiwify cobra, o webhook empilha mais 30
  // dias em cima do que resta (concederMesPago) e ninguém confere comprovante —
  // o mesmo trilho que a recuperação de abandono usa.
  // O valor é sempre R$ 67 (o do produto lá), então o link vale para todo plano.
  const link = pixCheckoutUrl();
  if (link && valor === PIX_MES_VALOR) {
    return [
      `${oi}Tudo bem? 😊 Seu acesso ao SolarDoc está *vencendo*.`,
      `Pra renovar por mais um mês (R$ ${valor}), é só pagar por aqui 👇${aviso}`,
      link,
      'Escolhe *Pix* na página que o QR aparece na hora. Seu acesso é estendido sozinho quando o pagamento cair — não precisa mandar comprovante 🙌',
    ];
  }

  const copia = gerarPixCopiaECola({ valor, txid: 'SOLARDOCVIP' });
  return [
    `${oi}Tudo bem? 😊 Seu acesso ao SolarDoc está *vencendo*.`,
    `Pra renovar por mais um mês (R$ ${valor}), é só copiar o Pix abaixo e pagar no app do seu banco 👇${aviso}`,
    copia,
    'Assim que pagar, me manda o *comprovante aqui* que eu confirmo e libero na hora. Qualquer dúvida me chama! 🙌',
  ];
}

const normEmail = (e: unknown): string => String(e ?? '').trim().toLowerCase();

/**
 * Quem tem Pix AUTOMÁTICO vivo (asaas_pix_assinaturas, modo 'automatico', status 'ativo' OU
 * 'inadimplente') não recebe o lembrete de "copie o Pix e pague": 'ativo' é debitado pelo
 * banco todo mês, e 'inadimplente' é o banco tentando de novo por 7 dias, então o lembrete faria
 * a pessoa pagar em dobro. Contrato 'pendente' (nunca autorizou) continua recebendo.
 * Casa por user_id OU por e-mail (contrato do quiz nasce sem conta), e-mail em minúsculas e sem
 * espaços dos dois lados. Lido UMA vez por rodada. Se a leitura falhar devolve null e a rodada
 * NÃO envia nada: na dúvida, calar é mais barato do que cobrar em dobro.
 */
async function contratosAutomaticosVivos(): Promise<{ ids: Set<string>; emails: Set<string> } | null> {
  const ids = new Set<string>();
  const emails = new Set<string>();
  const PAGINA = 1000; // PostgREST corta em 1000 linhas
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('asaas_pix_assinaturas')
      .select('user_id, email')
      .eq('modo', 'automatico')
      .in('status', ['ativo', 'inadimplente'])
      .range(de, de + PAGINA - 1);
    if (error) {
      logger.error('pix-vip-reminder', 'leitura de contratos automáticos falhou — rodada sem envio', error);
      return null;
    }
    for (const c of (data ?? []) as Array<{ user_id: string | null; email: string | null }>) {
      if (c.user_id) ids.add(c.user_id);
      const m = normEmail(c.email);
      if (m) emails.add(m);
    }
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return { ids, emails };
}

export async function runPixVipReminder(): Promise<{ enviados: number; pulados: number; erros: number }> {
  let enviados = 0, pulados = 0, erros = 0;

  // Kill-switch: PIX_MENSAL_OFF=true pausa a cobrança mensal por Pix sem deploy.
  if ((process.env.PIX_MENSAL_OFF || '').toLowerCase() === 'true') {
    logger.info('pix-vip-reminder', 'PIX_MENSAL_OFF=true — cobrança mensal por Pix pausada');
    return { enviados, pulados, erros };
  }

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

  const automaticos = await contratosAutomaticosVivos();
  if (!automaticos) return { enviados, pulados, erros: 1 };

  for (const u of users) {
    // Pix automático vivo (ativo ou inadimplente): o banco cobra sozinho, não manda código de renovação.
    if (automaticos.ids.has(u.id) || automaticos.emails.has(normEmail(u.email))) {
      pulados++; continue;
    }

    // Cooldown: não reenviar dentro do mesmo ciclo mensal.
    if (u.pix_reminder_last_sent_at) {
      const desde = agora - new Date(u.pix_reminder_last_sent_at).getTime();
      if (desde < COOLDOWN_DIAS * DIA_MS) { pulados++; continue; }
    }

    try {
      await sendHuman(u.whatsapp, montarPartes(u.nome, VALOR_RENOVACAO, u.plano), 'solardoc');
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
