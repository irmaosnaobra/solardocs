// ─────────────────────────────────────────────────────────────────────────────
// A RECEPÇÃO É LIDA PELO CRON, NÃO PELO WEBHOOK. E isto foi medido, não achado.
//
// O `/webhook/io` responde 200 pro Z-API e faz o trabalho num `(async () => …)()`
// solto. A invocação pode ser encerrada assim que a resposta sai, e é o que
// acontece na prática. Os dois testes em produção de 11/09/2026:
//
//   1ª rodada  volta 1 respondeu inteira; volta 2 gerou a fala, MANDOU as duas
//              bolhas (o Z-API confirmou a entrega às 16:16:04 e 16:16:11, 65s e
//              72s depois do POST) e morreu antes de gravar o estado e avisar o
//              consultor
//   2ª rodada  as duas mensagens entraram em `webhook_debug` e NADA mais
//              aconteceu: nem sessão, nem resposta, nem uma linha de log
//
// Duas execuções, dois pontos de morte diferentes. Não é bug de lógica, é o
// background da rota sendo cortado em lugar imprevisível. Robô de recepção que
// funciona às vezes é pior que recepção nenhuma: a pessoa fica esperando.
//
// A casa já sabia disso. A Bia (`pollBiaRecuperacao`) e a trilha do LimpaPro
// (`pollLimpaproAtendimento`) atendem inbound da linha IO pelo CRON, lendo
// `webhook_debug`, exatamente por isso. No cron a promessa é aguardada até o
// fim, porque a resposta HTTP só sai quando o tick termina.
//
// O CUSTO é latência: até ~1 minuto pra responder, que é o intervalo do tick.
// Contra as 24h de silêncio que 117 pessoas receberam em 30 dias, é barato.
//
// Este arquivo fica separado do `recepcaoIo.ts` de propósito: é aqui que moram
// os detectores de dono das outras trilhas (Bia, LimpaPro, vendedora), e mantê-los
// fora do serviço evita ciclo de import e deixa claro que a ORDEM de quem atende
// é decisão de roteamento, não da recepção.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { tryClaimMessage } from '../agents/sdr/sdrAgentService';
import { ehLeadRecuperacao } from '../agents/whatsapp/biaInboundService';
import { ehAlunoLimpapro } from '../agents/whatsapp/limpaproAtendimentoService';
import { ehGatilhoSolarDoc, vendedoraJaAtende } from '../agents/whatsapp/whatsappAgentService';
import { handleRecepcaoIo, recepcaoJaAtende } from './recepcaoIo';

/** Instância Z-API da linha Irmãos na Obra. Mesmo valor que o poll da Bia usa. */
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

/** Janela de leitura: cobre o tick de 1 min com folga pra atraso e falha pontual. */
const JANELA_MS = 6 * 60 * 1000;

const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

function textoDe(p: Record<string, any>): string {
  return String(
    p.text?.message
    ?? (typeof p.text === 'string' ? p.text : '')
    ?? p.message?.conversation
    ?? p.body
    ?? '',
  ).trim();
}

/**
 * Atende quem escreveu na linha e não é de mais ninguém.
 *
 * A ORDEM aqui espelha a cascata do `/webhook/io`, e isso não é estilo: cada um
 * desses donos é uma trilha que já foi atropelada uma vez. A recepção é a
 * ÚLTIMA da fila, e só pega quem sobrou.
 */
export async function pollRecepcaoIo(): Promise<{ atendidos: number; pulados: number; erros: number }> {
  const desde = new Date(Date.now() - JANELA_MS).toISOString();
  const { data: rows, error } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    logger.error('recepcao-poll', 'ler webhook_debug falhou', error);
    return { atendidos: 0, pulados: 0, erros: 1 };
  }

  let atendidos = 0, pulados = 0, erros = 0;

  for (const r of rows ?? []) {
    const p = (r.payload ?? {}) as Record<string, any>;

    if (p.type !== 'ReceivedCallback' || p.instanceId !== INSTANCE_ID_IO) { pulados++; continue; }
    if (p.isGroup === true || p.isGroup === 'true') { pulados++; continue; }
    if (p.fromMe === true || p.fromMe === 'true') { pulados++; continue; }

    const phone = soDigitos(p.phone || p.senderPhone);
    const texto = textoDe(p);
    if (!phone || !texto) { pulados++; continue; }

    try {
      // Se a recepção JÁ é dona, ela continua sem perguntar nada a ninguém: a
      // triagem aberta vale mais que qualquer gatilho que apareça no meio dela.
      if (!(await recepcaoJaAtende(phone))) {
        if (ehGatilhoSolarDoc(texto) || await vendedoraJaAtende(phone)) { pulados++; continue; }
        if (await ehLeadRecuperacao(phone)) { pulados++; continue; }
        if (await ehAlunoLimpapro(phone)) { pulados++; continue; }
      }

      // Dedup com namespace próprio. O `whk:` do webhook é outro espaço de
      // propósito: se o webhook morrer no meio (que é a razão deste arquivo
      // existir), o claim dele não pode impedir o cron de terminar o serviço.
      const messageId = p.messageId || p.zaapId || p.id || null;
      if (messageId) {
        const claimed = await tryClaimMessage(`recep:${messageId}`, phone, 'poll');
        if (!claimed) { pulados++; continue; }
      }

      await handleRecepcaoIo(phone, texto, p.senderName || p.pushname || null);
      atendidos++;
    } catch (err) {
      erros++;
      logger.error('recepcao-poll', `falhou pra ${phone}`, err);
    }
  }

  if (atendidos) logger.info('recepcao-poll', `${atendidos} mensagem(ns) atendida(s) pela recepção`);
  return { atendidos, pulados, erros };
}
