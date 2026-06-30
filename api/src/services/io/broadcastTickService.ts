import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

type MediaType = 'image' | 'video' | 'audio';
interface Mensagem {
  slot: number;
  base: string;
  media_url?: string | null;
  media_type?: MediaType | null;
}
interface Broadcast {
  id: string;
  mensagens: Mensagem[];
  contatos: string[] | null;
  contexto_ai: string | null;
  usou_ia: boolean;
  cadencia_min: number;
  cadencia_max: number;
  sucesso: number;
  falha: number;
  ultimo_envio_em: string | null;
}

interface EnvioEnviado { phone: string; slot: number }

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanizar(base: string, contexto: string | null): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return base;
  const anthropic = new Anthropic({ apiKey: key });
  const ctx = (contexto || '').trim();
  const systemPrompt = [
    'Voce reformula uma mensagem-base do WhatsApp para soar como um humano brasileiro real escrevendo, nao como robo.',
    'Regras absolutas:',
    '- Mantenha o significado e a intencao da mensagem-base.',
    '- Frases curtas, naturais, coloquiais.',
    '- NUNCA use travessao (—) nem em-dash. Use virgula, ponto, ou simplesmente quebre a frase.',
    '- Sem emoji.',
    '- Variar sutilmente entre reformulacoes: ora "tudo bem?", ora vai direto; ora "Boa tarde", ora "Oi".',
    '- Nao adicione informacao nova que nao esteja na base.',
    '- Saida: APENAS a mensagem reformulada, sem aspas, sem prefixo, sem explicacao.',
    '',
    'Exemplo de reformulacao no tom certo:',
    'Base: Boa tarde, aqui e a Giovanna',
    'Saida: Boa tarde, e a Giovanna falando',
    ctx ? `\nContexto adicional do disparo: ${ctx}` : '',
  ].filter(Boolean).join('\n');

  const r = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    temperature: 0.9,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Mensagem-base: ${base}\n\nReformule.` }],
  });
  const c = r.content[0];
  if (c?.type === 'text') return c.text.trim().replace(/^["']|["']$/g, '') || base;
  return base;
}

async function enviarZapiIO(
  phone: string,
  message: string,
  mediaUrl?: string | null,
  mediaType?: MediaType | null,
): Promise<{ ok: boolean; zaapId?: string; messageId?: string; erro?: string }> {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) return { ok: false, erro: 'creds Z-API IO ausentes' };

  const cleanPhone = phone.replace(/\D/g, '');

  let path = 'send-text';
  let body: Record<string, unknown> = { phone: cleanPhone, message };
  if (mediaUrl && mediaType === 'image') {
    path = 'send-image';
    body = { phone: cleanPhone, image: mediaUrl, caption: message };
  } else if (mediaUrl && mediaType === 'video') {
    path = 'send-video';
    body = { phone: cleanPhone, video: mediaUrl, caption: message };
  } else if (mediaUrl && mediaType === 'audio') {
    // send-audio nao aceita caption: o audio vai sozinho, como nota de voz
    // "gravada so pra aquela pessoa" (waveform exibe as ondas sonoras).
    path = 'send-audio';
    body = { phone: cleanPhone, audio: mediaUrl, waveform: true };
  }

  const r = await fetch(`https://api.z-api.io/instances/${id}/token/${token}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': client },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) return { ok: false, erro: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
  try {
    const parsed = JSON.parse(txt) as { zaapId?: string; messageId?: string; id?: string };
    return { ok: true, zaapId: parsed.zaapId, messageId: parsed.messageId || parsed.id };
  } catch {
    return { ok: true };
  }
}

const MAX_ENVIOS_POR_TICK = 10;
const TICK_MAX_DURATION_MS = 240000; // 4 min (deixa 60s de buffer pro Vercel 300s)
const LOCK_DURATION_MS = 5 * 60 * 1000;

export async function runIoBroadcastTick(): Promise<{ processed: number; broadcast_id?: string; status?: string; reason?: string }> {
  const nowIso = new Date().toISOString();

  // 1. Encontra broadcast candidato (rodando, sem lock ativo). Ordena por ultimo_envio_em
  //    pra dar fairness se múltiplos ativos.
  const { data: candidatos, error: candErr } = await supabase
    .from('io_broadcasts')
    .select('*')
    .eq('status', 'rodando')
    .or(`tick_lock_until.is.null,tick_lock_until.lt.${nowIso}`)
    .order('ultimo_envio_em', { ascending: true, nullsFirst: true })
    .limit(1);

  if (candErr) { logger.error('broadcast-tick', 'erro buscando candidatos', candErr); return { processed: 0, reason: 'erro_busca' }; }
  if (!candidatos || candidatos.length === 0) return { processed: 0, reason: 'nada_rodando' };

  const broadcast = candidatos[0] as Broadcast;

  // Sanidade: precisa de contatos + mensagens
  if (!Array.isArray(broadcast.contatos) || broadcast.contatos.length === 0) {
    return { processed: 0, broadcast_id: broadcast.id, reason: 'sem_contatos' };
  }
  if (!Array.isArray(broadcast.mensagens) || broadcast.mensagens.length === 0) {
    return { processed: 0, broadcast_id: broadcast.id, reason: 'sem_mensagens' };
  }

  // 2. Adquire lock (set tick_lock_until = NOW + 5min)
  const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
  const { error: lockErr } = await supabase
    .from('io_broadcasts')
    .update({ tick_lock_until: lockUntil })
    .eq('id', broadcast.id);
  if (lockErr) { logger.error('broadcast-tick', 'erro lock', lockErr); return { processed: 0, reason: 'erro_lock' }; }

  let sucesso = broadcast.sucesso;
  let falha = broadcast.falha;
  let processed = 0;
  const tickStart = Date.now();

  try {
    // 3. Pega envios já feitos
    const { data: enviadosRows } = await supabase
      .from('io_broadcast_envios')
      .select('phone, slot')
      .eq('broadcast_id', broadcast.id);
    const enviadosSet = new Set<string>(
      (enviadosRows as EnvioEnviado[] | null ?? []).map((e) => `${e.phone}|${e.slot}`),
    );

    // 3.5. Lista de bloqueio (whatsapp_suppression): quem pediu pra NUNCA mais ser
    //      contatado (opt-out/denúncia). É o que impede re-contatar alguém cujo
    //      número foi raspado de novo do Google Maps. Casa por sufixo de 10 dígitos
    //      (com/sem 9º dígito/DDI). Anti-denúncia de verdade.
    const sufBloqueados = new Set<string>();
    {
      const { data: supRows } = await supabase.from('whatsapp_suppression').select('phone');
      for (const r of supRows ?? []) {
        const d = String(r.phone || '').replace(/\D/g, '');
        if (d.length >= 10) sufBloqueados.add(d.slice(-10));
      }
    }
    const estaBloqueado = (phone: string): boolean => {
      const d = String(phone || '').replace(/\D/g, '');
      return d.length >= 10 && sufBloqueados.has(d.slice(-10));
    };

    // 4. Constrói fila de pendentes (mensagens × contatos - enviados)
    const pendentes: Array<{ phone: string; slot: number; base: string; mediaUrl: string | null; mediaType: MediaType | null }> = [];
    let bloqueadosPulados = 0;
    for (const m of broadcast.mensagens) {
      const mt = m.media_type === 'image' || m.media_type === 'video' || m.media_type === 'audio' ? m.media_type : null;
      const mu = mt && m.media_url ? m.media_url : null;
      for (const phone of broadcast.contatos) {
        if (estaBloqueado(phone)) { bloqueadosPulados++; continue; } // nunca re-contatar
        if (!enviadosSet.has(`${phone}|${m.slot}`)) {
          pendentes.push({ phone, slot: m.slot, base: m.base, mediaUrl: mu, mediaType: mt });
        }
      }
    }
    if (bloqueadosPulados > 0) {
      logger.info('broadcast-tick', `${bloqueadosPulados} envio(s) pulado(s) por lista de bloqueio (anti-denúncia)`);
    }

    if (pendentes.length === 0) {
      await supabase.from('io_broadcasts').update({
        status: 'concluido',
        finalizado_em: new Date().toISOString(),
        tick_lock_until: null,
      }).eq('id', broadcast.id);
      return { processed: 0, broadcast_id: broadcast.id, status: 'concluido', reason: 'tudo_enviado' };
    }

    // 5. Respeita cadência relativa ao último envio: se ainda não passou cadencia_min,
    //    espera o tempo restante (mas só até consumir parte do orçamento do tick).
    if (broadcast.ultimo_envio_em) {
      const elapsed = Date.now() - new Date(broadcast.ultimo_envio_em).getTime();
      const minWait = broadcast.cadencia_min * 1000;
      if (elapsed < minWait) {
        const espera = Math.min(minWait - elapsed, 10000); // no max 10s pra não desperdiçar tick
        await sleep(espera);
      }
    }

    // 6. Processa até MAX_ENVIOS_POR_TICK respeitando timeout
    for (let i = 0; i < Math.min(MAX_ENVIOS_POR_TICK, pendentes.length); i++) {
      if (Date.now() - tickStart > TICK_MAX_DURATION_MS) break;

      const item = pendentes[i];

      if (i > 0) {
        const min = broadcast.cadencia_min;
        const max = broadcast.cadencia_max;
        const espera = Math.floor((Math.random() * (max - min) + min) * 1000);
        await sleep(espera);
        if (Date.now() - tickStart > TICK_MAX_DURATION_MS) break;
      }

      // Humanização — pula audio (vai sozinho, sem texto/caption); registra
      // placeholder pra auditoria/log ficar limpo.
      let mensagemFinal = item.base;
      if (item.mediaType === 'audio') {
        mensagemFinal = '[áudio]';
      } else if (broadcast.usou_ia) {
        try {
          mensagemFinal = await humanizar(item.base, broadcast.contexto_ai);
        } catch (err) {
          logger.error('broadcast-tick', `humanize falhou ${broadcast.id} ${item.phone} slot ${item.slot}`, err);
        }
      }

      // Envio Z-API
      let envioStatus: 'ok' | 'erro' = 'erro';
      let zaapId: string | null = null;
      let messageId: string | null = null;
      let erro: string | null = null;
      try {
        const r = await enviarZapiIO(item.phone, mensagemFinal, item.mediaUrl, item.mediaType);
        if (r.ok) {
          envioStatus = 'ok';
          zaapId = r.zaapId ?? null;
          messageId = r.messageId ?? null;
          sucesso++;
        } else {
          erro = r.erro ?? 'erro desconhecido';
          falha++;
        }
      } catch (err) {
        erro = err instanceof Error ? err.message : String(err);
        falha++;
      }

      await supabase.from('io_broadcast_envios').insert({
        broadcast_id: broadcast.id,
        phone: item.phone,
        slot: item.slot,
        mensagem_final: mensagemFinal,
        status: envioStatus,
        zaap_id: zaapId,
        message_id: messageId,
        erro,
      });

      // Silencia os agentes (Luma) pra esse contato: disparo é "só o que eu
      // envio". Marca human_takeover (mesmo flag do takeover manual). Só afeta
      // quem JÁ é lead — número novo não tem row e o UPDATE é no-op (não
      // polui sdr_leads com contatos frios). Reversível pelo "liberar" do grupo.
      if (envioStatus === 'ok') {
        try {
          await supabase.from('sdr_leads').update({
            human_takeover: true,
            human_takeover_at: new Date().toISOString(),
            aguardando_resposta: false,
            updated_at: new Date().toISOString(),
          }).eq('phone', item.phone).eq('human_takeover', false);
        } catch (err) {
          logger.error('broadcast-tick', `falha marcando human_takeover ${item.phone}`, err);
        }
      }

      processed++;
    }

    const enviadosTotal = enviadosSet.size + processed;
    const totalEsperado = broadcast.mensagens.length * broadcast.contatos.length;
    const concluido = enviadosTotal >= totalEsperado;

    const updatePayload: Record<string, unknown> = {
      sucesso,
      falha,
      ultimo_envio_em: new Date().toISOString(),
      tick_lock_until: null,
    };
    if (concluido) {
      updatePayload.status = 'concluido';
      updatePayload.finalizado_em = new Date().toISOString();
    }
    await supabase.from('io_broadcasts').update(updatePayload).eq('id', broadcast.id);

    return {
      processed,
      broadcast_id: broadcast.id,
      status: concluido ? 'concluido' : 'rodando',
      reason: concluido ? 'tudo_enviado' : 'tick_ok',
    };
  } catch (err) {
    logger.error('broadcast-tick', `erro fatal broadcast ${broadcast.id}`, err);
    // Libera lock pra próximo tick tentar
    await supabase.from('io_broadcasts').update({ tick_lock_until: null }).eq('id', broadcast.id);
    return { processed, broadcast_id: broadcast.id, reason: 'erro_fatal' };
  }
}
