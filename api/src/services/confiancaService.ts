// ─────────────────────────────────────────────────────────────────────────────
// CADÊNCIA DE CONFIANÇA — nutrição por e-mail do assinante NOVO.
//
// O buraco que ela tapa: quem acabou de pagar não recebe NADA nosso. As outras
// cadências ou pedem a venda (checkout, upgrade, curso) ou aparecem quando algo
// deu errado (dunning, inativo). Nos primeiros 30 dias — justamente quando o
// cliente decide se ficou bem servido — o silêncio é total.
//
// Por que 30 dias: medido em 24/08/2026, dos cancelamentos com venda casada a
// mediana é 14,1 dias, 4 de 8 saíram em ≤12 dias e 6 de 8 em ≤30. A janela que
// decide é o primeiro mês. (n=8 — é a base que existe, não uma amostra grande.)
//
// O que cada toque faz: entrega UMA coisa útil de verdade (um atalho, um ajuste,
// um documento que a pessoa não sabe que tem) e UMA fala de cliente real. Não
// vende nada. O único pedido da cadência inteira está no 5º toque e é "responde
// este e-mail" — porque o plano anual só existe na LP pública e mandar assinante
// pra lá cria Customer novo, que é a origem das assinaturas duplicadas.
//
// CANAL É E-MAIL, e isso foi escolha medida, não conveniência: os 185 usuários
// são alcançáveis por e-mail e nenhum está em opt-out, enquanto no WhatsApp
// sobram 50 contatos que JÁ absorveram de 3 a 5 toques da Giovanna sem nunca
// responder. Um sexto disparo pra essa lista é o perfil que já bloqueou a linha
// duas vezes.
//
// DESLIGADA POR PADRÃO. Só roda com CONFIANCA_ENABLED=true. Cadência que escreve
// pra cliente pagante não sobe ligada no mesmo empurrão em que foi escrita.
// Prévia sem enviar nada: GET /cron/confianca?seco=1
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../utils/supabase';
import { sendConfiancaEmail, CONFIANCA_TOQUES } from '../utils/mailer';
import { EMAIL_TETO_POR_RODADA, recebeuEmailRecente } from './followupService';
import { logger } from '../utils/logger';

/** Dias desde a primeira compra em que cada toque vence. */
const DIAS_DO_TOQUE = [1, 3, 7, 14, 30];

const DIA_MS = 24 * 60 * 60 * 1000;

export interface PrevistoConfianca {
  userId: string;
  email: string;
  nome: string | null;
  toque: number;
  diasDeCasa: number;
}

export interface ResultadoConfianca {
  enviados: number;
  previstos: number;
  semAncora: number;
  seco: boolean;
  fila?: PrevistoConfianca[];
  motivo?: string;
}

/**
 * Quando cada e-mail virou pagante. Âncora é a PRIMEIRA venda do e-mail em
 * `sales` — é o único carimbo confiável de "começou a pagar" (users não guarda
 * essa data). Quem pagou só por Pix pode não ter linha em `sales`; esses ficam
 * de fora e são contados em `semAncora` em vez de receberem o toque no dia
 * errado. Chutar a data seria mandar "dia 1" pra quem tem três meses de casa.
 */
export async function ancorasPorEmail(): Promise<Map<string, number>> {
  const { data } = await supabase.from('sales').select('email, created_at');
  const mapa = new Map<string, number>();
  for (const v of (data ?? []) as Array<{ email: string | null; created_at: string | null }>) {
    const mail = (v.email || '').trim().toLowerCase();
    if (!mail || !v.created_at) continue;
    const t = Date.parse(v.created_at);
    if (Number.isNaN(t)) continue;
    const atual = mapa.get(mail);
    if (atual == null || t < atual) mapa.set(mail, t);
  }
  return mapa;
}

export async function runConfiancaNutricao(opts: { seco?: boolean } = {}): Promise<ResultadoConfianca> {
  const seco = opts.seco === true;

  // Kill-switch. No modo seco a trava não vale: a prévia não manda nada, e é
  // justamente ela que serve pra decidir se liga.
  if (!seco && (process.env.CONFIANCA_ENABLED || '').trim().toLowerCase() !== 'true') {
    return { enviados: 0, previstos: 0, semAncora: 0, seco, motivo: 'CONFIANCA_ENABLED != true' };
  }

  const agora = Date.now();

  const { data: candidatos } = await supabase
    .from('users')
    .select('id, email, nome, plano, email_opt_out, confianca_count, confianca_last_sent_at, followup_email_last_sent_at, upgrade_nudge_last_sent_at, contract_reminder_last_sent_at')
    .neq('plano', 'free')
    .lt('confianca_count', CONFIANCA_TOQUES);

  if (!candidatos?.length) return { enviados: 0, previstos: 0, semAncora: 0, seco };

  const ancoras = await ancorasPorEmail();

  let enviados = 0;
  let semAncora = 0;
  const fila: PrevistoConfianca[] = [];

  for (const u of candidatos as Array<Record<string, any>>) {
    const email = (u.email || '').trim();
    if (!email) continue;
    if (u.email_opt_out === true) continue;

    const ancora = ancoras.get(email.toLowerCase());
    if (!ancora) { semAncora++; continue; }

    const count: number = u.confianca_count ?? 0;
    const diasDeCasa = Math.floor((agora - ancora) / DIA_MS);

    // ENTRAR e SEGUIR são duas regras diferentes, de propósito.
    //
    // Entrar (count = 0): a pessoa entra no toque que corresponde ao TEMPO DE
    // CASA dela. Sem isto, ligar a cadência mandaria "Dia 1 — comece por aqui,
    // economiza a primeira meia hora" pros 62 assinantes que já existem, um
    // deles com 47 dias. Quem tem 8 dias entra no toque do dia 7; quem passou
    // dos 30 recebe o último e a cadência se encerra pra ele.
    //
    // Seguir (count > 0): vai de um em um. Se a regra de entrada valesse aqui
    // também, uma rodada falha entre o dia 3 e o dia 7 faria a pessoa pular do
    // toque 1 direto pro 3 — e o toque 2, que é o de pôr a logo no documento,
    // sumiria sem ninguém ver. Atraso é aceitável; buraco no meio não.
    const jaVencidos = DIAS_DO_TOQUE.filter(d => diasDeCasa >= d).length;
    const proximo = count === 0 ? jaVencidos : count + 1;
    if (proximo < 1 || proximo > DIAS_DO_TOQUE.length) continue;
    if (diasDeCasa < DIAS_DO_TOQUE[proximo - 1]) continue;

    // Não empilha dois e-mails nossos no mesmo dia — a trava é compartilhada com
    // as outras cadências (ver recebeuEmailRecente no followupService).
    if (recebeuEmailRecente(u)) continue;

    fila.push({ userId: u.id, email, nome: u.nome ?? null, toque: proximo, diasDeCasa });
  }

  // Teto por rodada: o /master roda de hora em hora, então a fila escoa em rampa
  // em vez de sair tudo no mesmo minuto (que é assinatura de lista comprada).
  const lote = fila.slice(0, EMAIL_TETO_POR_RODADA);

  if (seco) {
    return { enviados: 0, previstos: fila.length, semAncora, seco: true, fila: lote };
  }

  for (const alvo of lote) {
    try {
      await sendConfiancaEmail(alvo.email, alvo.userId, alvo.toque, alvo.nome);
      await supabase.from('users').update({
        confianca_count: alvo.toque,
        confianca_last_sent_at: new Date().toISOString(),
      }).eq('id', alvo.userId);
      enviados++;
    } catch (err) {
      logger.error('confianca', `falha no toque ${alvo.toque} de ${alvo.email}`, err);
    }
  }

  if (enviados > 0) logger.info('confianca', `${enviados} e-mail(s) de confiança enviados (fila: ${fila.length})`);
  return { enviados, previstos: fila.length, semAncora, seco: false };
}
