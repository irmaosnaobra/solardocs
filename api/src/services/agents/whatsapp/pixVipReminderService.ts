import { supabase } from '../../../utils/supabase';
import { sendFrio } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { novaRodadaPortao, tomarChaveFria, soltarChaveFria } from '../../recuperacaoCheckoutPortao';

// ─────────────────────────────────────────────────────────────────────────────
// Lembrete mensal de renovação de quem paga por Pix.
//
// Pix NÃO tem assinatura no Stripe: a renovação era manual. Desde 04/11/2026 (ordem do dono: "todos o Pix será de
// recorrência... sempre oriente eles a utilizar o pix recorrente") o lembrete leva a pessoa para o PIX AUTOMÁTICO
// (Asaas): ela assina uma vez e o banco debita todo mês, sem comprovante. Não cobra, não renova.
//
// Dispara por plano_expira_em (~0-2 dias antes do vencimento), não por "dia 11 fixo": o aviso segue a data real, para
// sozinho se a pessoa deixar de ser cliente e não sai horas depois de ela já ter pago.
//
// PORTÃO ANTI-BAN (chefe-antiban, linha 5040): UMA bolha por sendFrio; antes de cada envio janela 9h-20h de segunda a sábado
// sem feriado, teto do frio, espaçamento, pausa humana, supressão e mudo (recuperacaoCheckoutPortao.ts); claim por INSERT
// `pix_vip_sent:<userId>:<vencimento>` ANTES de enviar (um por ciclo, e barra duas rodadas); UM envio por rodada, e a rodada
// para no erro. O cron roda de hora em hora: o que o portão segura sai na rodada seguinte.
// ─────────────────────────────────────────────────────────────────────────────

// Janela do vencimento em que o lembrete dispara (dias à frente de agora).
const JANELA_DIAS = 2;
// Não repetir o lembrete dentro deste intervalo — cobre o mesmo ciclo mensal
// (a janela acima reabre todo mês quando plano_expira_em for empurrado +1 mês).
const COOLDOWN_DIAS = 20;

const DIA_MS = 24 * 60 * 60 * 1000;
// Vencido há mais que isto não recebe o lembrete: é caso da retomada de quem parou de pagar.
const VENCIDO_MAX_DIAS = 3;

/** Link do Pix automático da renovação (sem utm_term). */
export const LINK_PIX_AUTOMATICO_RENOVACAO = 'https://solardoc.app/?pagar=pix&utm_source=renovacao&utm_medium=whatsapp';

/** O vencimento em dd/mm, no horário de Brasília. */
export function dataDdMm(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * O texto do lembrete, UMA bolha. Com nome: "Oi, Leo, aqui é a Carla..."; sem nome: "Oi, aqui é a Carla...".
 * Fica o nome só até o primeiro espaço.
 */
export function montarPartes(nome: string | null, expiraEm: string | Date, agora: number = Date.now()): string[] {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || '';
  const abertura = primeiro ? `Oi, ${primeiro}, aqui é a Carla, da SolarDoc.` : 'Oi, aqui é a Carla, da SolarDoc.';
  // Já venceu (1 a 3 dias): variante "venceu", para voltar a usar. Ainda vai vencer: a variante "vence".
  if (new Date(expiraEm).getTime() <= agora) {
    return [
      `${abertura} Seu acesso venceu em ${dataDdMm(expiraEm)}. Que tal assinar o Pix automático em ${LINK_PIX_AUTOMATICO_RENOVACAO}, para voltar a usar e não precisar pagar nem mandar comprovante todo mês? Na hora de assinar, use o e-mail da sua conta.`,
    ];
  }
  return [
    `${abertura} Seu acesso vence em ${dataDdMm(expiraEm)}. Que tal assinar o Pix automático em ${LINK_PIX_AUTOMATICO_RENOVACAO}, para não precisar pagar nem mandar comprovante todo mês? Na hora de assinar, use o e-mail da sua conta.`,
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
  const piso = new Date(agora - VENCIDO_MAX_DIAS * DIA_MS).toISOString();

  // Alvo: o cliente Pix-VIP, ainda ilimitado, com vencimento dentro da janela.
  // Alvo GERAL: qualquer cliente Pix (plano pago + plano_expira_em setado na
  // liberação manual) com vencimento dentro da janela. Antes era travado num
  // único número; agora vale pra todo mundo que paga por Pix.
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, plano, plano_expira_em, pix_reminder_last_sent_at, whatsapp_opt_out')
    .neq('plano', 'free')
    .not('whatsapp', 'is', null)
    .not('plano_expira_em', 'is', null)
    .gte('plano_expira_em', piso)
    .lte('plano_expira_em', limite);

  if (error) {
    logger.error('pix-vip-reminder', 'leitura de users falhou', error);
    return { enviados, pulados, erros: 1 };
  }
  if (!users?.length) return { enviados, pulados, erros };

  const automaticos = await contratosAutomaticosVivos();
  if (!automaticos) return { enviados, pulados, erros: 1 };

  const portao = novaRodadaPortao(undefined, { robo: 'pix_vip_lembrete' });
  for (const u of users) {
    // Pix automático vivo (ativo ou inadimplente): o banco cobra sozinho, não manda lembrete.
    if (automaticos.ids.has(u.id) || automaticos.emails.has(normEmail(u.email))) {
      pulados++; continue;
    }

    // Pediu para não receber WhatsApp.
    if (u.whatsapp_opt_out === true) { pulados++; continue; }

    // Cooldown: não reenviar dentro do mesmo ciclo mensal.
    if (u.pix_reminder_last_sent_at) {
      const desde = agora - new Date(u.pix_reminder_last_sent_at).getTime();
      if (desde < COOLDOWN_DIAS * DIA_MS) { pulados++; continue; }
    }

    // Portão da linha: fora da janela, teto, espaçamento, pausa humana, supressão, mudo, e o envio que já houve nesta rodada.
    const v = await portao.avaliar(u.whatsapp);
    if (!v.ok) { pulados++; continue; }

    // Claim por INSERT antes de enviar: um por usuário e por vencimento. Chave repetida = outra rodada já pegou (ou já saiu neste ciclo).
    const chave = `pix_vip_sent:${u.id}:${String(u.plano_expira_em).slice(0, 10)}`;
    const claim = await tomarChaveFria(chave);
    if (claim === 'ja') { pulados++; continue; }
    if (claim === 'erro') { erros++; break; }

    try {
      const saiu = await sendFrio(u.whatsapp, montarPartes(u.nome, u.plano_expira_em, agora), 'solardoc');
      if (!saiu) {
        // Calou por regra (pausa humana): nada saiu, o claim é desfeito e a rodada para.
        await soltarChaveFria(chave);
        pulados++;
        break;
      }
      portao.travarRodada('ja_enviou_na_rodada');
      const { error: erroCooldown } = await supabase
        .from('users')
        .update({ pix_reminder_last_sent_at: new Date().toISOString() })
        .eq('id', u.id);
      if (erroCooldown) logger.error('pix-vip-reminder', `cooldown não gravou pra ${u.email} (o claim segura o ciclo)`, erroCooldown);
      enviados++;
      logger.info('pix-vip-reminder', `lembrete enviado pra ${u.email} (vence ${u.plano_expira_em})`);
    } catch (err) {
      // Erro de envio: talvez saiu. O claim FICA (não repete neste ciclo) e a rodada para.
      erros++;
      logger.error('pix-vip-reminder', `envio falhou pra ${u.email}`, err);
      break;
    }
  }

  return { enviados, pulados, erros };
}
