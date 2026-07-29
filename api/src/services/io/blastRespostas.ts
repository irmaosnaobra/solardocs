// ─────────────────────────────────────────────────────────────────────────────
// O que acontece quando alguém RESPONDE a um disparo.
//
// Hoje: nada. O agente de SDR tem early-return para a linha 'io', o próprio
// blast marca human_takeover pra calar os bots, e a Bia só fala com quem já
// tinha conversa. Ou seja, a pessoa responde ao anúncio que a gente mandou e
// cai no vazio até alguém abrir o WhatsApp na mão.
//
// Este serviço faz o mínimo honesto, sem colocar robô pra conversar com lead
// frio (que é como se queima número e reputação):
//
//  1. Quem pede pra parar sai da lista NA HORA, sozinho — vai pra
//     whatsapp_suppression, a mesma lista que o motor de disparo já respeita.
//     É a diferença entre "insistente" e "denunciado".
//  2. Quem responde qualquer outra coisa vira FILA visível no /admin, com o
//     texto do que escreveu, pra atendimento humano. Uma vez por pessoa.
//
// Roda junto do stop-on-reply das sequências, no /process-messages.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

const INSTANCE_ID_IO = (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();

/** Janela pra considerar que a resposta é DO disparo, não de outra conversa. */
const HORAS_APOS_ENVIO = 72;

/** Mesma chave do CRM: DDD + últimos 8 (ignora 9º dígito e DDI). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

// Pedido de parada. Deliberadamente amplo: falso positivo aqui custa um contato
// a menos; falso negativo custa uma denúncia — e a linha já foi banida uma vez.
const RE_PARE = /\b(pare|para de|parar|nao quero|não quero|nao tenho interesse|não tenho interesse|sem interesse|remove|remover|descadastr|sair da lista|me tira|nao me manda|não me manda|nao perturbe|não perturbe|spam|denunc|bloquear|me exclu)/i;

export type ResultadoRespostas = {
  inbound: number;
  suprimidos: number;
  paraAtender: number;
};

export async function runBlastRespostas(): Promise<ResultadoRespostas> {
  const vazio: ResultadoRespostas = { inbound: 0, suprimidos: 0, paraAtender: 0 };

  // 1) Quem recebeu disparo recentemente. Sem ninguém na janela, não há o que
  //    cruzar — sai barato (é o caso de todo dia em que não há campanha).
  const desdeEnvio = new Date(Date.now() - HORAS_APOS_ENVIO * 3600_000).toISOString();
  const { data: envios, error: eEnvios } = await supabase
    .from('io_broadcast_envios')
    .select('phone, broadcast_id, enviado_em')
    .gte('enviado_em', desdeEnvio)
    .limit(5000);
  if (eEnvios) { logger.error('blast-resp', 'ler envios falhou', eEnvios); return vazio; }
  if (!envios || envios.length === 0) return vazio;

  const porChave = new Map<string, string>();  // telKey → broadcast_id
  for (const e of envios as Array<{ phone: string; broadcast_id: string }>) {
    const k = telKey(e.phone);
    if (k && !porChave.has(k)) porChave.set(k, e.broadcast_id);
  }

  // 2) Inbound real da linha nos últimos ~6 min (janela maior que o tick de 5).
  const desdeInbound = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data: rows, error: eRows } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', desdeInbound)
    .order('created_at', { ascending: false })
    .limit(300);
  if (eRows) { logger.error('blast-resp', 'ler webhook_debug falhou', eRows); return vazio; }

  type Resposta = { phone: string; chave: string; texto: string; broadcastId: string };
  const respostas = new Map<string, Resposta>();

  for (const r of rows ?? []) {
    const p = ((r as { payload: unknown }).payload ?? {}) as Record<string, any>;
    if (p.type !== 'ReceivedCallback') continue;
    if (p.instanceId !== INSTANCE_ID_IO) continue;
    if (p.isGroup === true || p.isGroup === 'true') continue;
    if (p.fromMe === true || p.fromMe === 'true') continue;   // é o nosso envio

    const phone = String(p.phone || p.senderPhone || '').replace(/\D/g, '');
    const k = telKey(phone);
    if (!k || !porChave.has(k)) continue;                      // não recebeu disparo: outra conversa

    const texto = String(
      p.text?.message ?? p.message?.text ?? p.body ?? p.caption ?? '',
    ).slice(0, 900);

    if (!respostas.has(k)) {
      respostas.set(k, { phone, chave: k, texto, broadcastId: porChave.get(k)! });
    }
  }

  if (respostas.size === 0) return vazio;

  let suprimidos = 0;
  let paraAtender = 0;

  for (const r of respostas.values()) {
    const querParar = RE_PARE.test(r.texto);

    if (querParar) {
      // Entra na MESMA lista que o motor de disparo já consulta antes de mandar.
      const { error } = await supabase.from('whatsapp_suppression').upsert(
        {
          phone: r.phone,
          motivo: 'pediu para parar (resposta a disparo)',
          origem: 'blast-io',
        },
        { onConflict: 'phone' },
      );
      if (error) logger.error('blast-resp', `supressão falhou pra ${r.phone}`, error);
      else suprimidos++;
    } else {
      paraAtender++;
    }

    // Registra a resposta nos dois casos: a negativa também é informação (diz se
    // a copy está irritando as pessoas).
    const { error: eIns } = await supabase.from('io_blast_respostas').insert({
      phone: r.phone,
      tel_key: r.chave,
      texto: r.texto || null,
      broadcast_id: r.broadcastId,
      classificacao: querParar ? 'negativa' : 'atender',
    });
    // 23505 = a mesma resposta já foi registrada num tick anterior.
    if (eIns && (eIns as { code?: string }).code !== '23505') {
      logger.error('blast-resp', 'registrar resposta falhou', eIns);
    }
  }

  if (suprimidos || paraAtender) {
    logger.info('blast-resp', `respostas ao disparo: ${paraAtender} pra atender, ${suprimidos} pediram parada`);
  }
  return { inbound: respostas.size, suprimidos, paraAtender };
}
