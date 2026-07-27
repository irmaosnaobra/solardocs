// ─────────────────────────────────────────────────────────────────────────────
// STOP-ON-REPLY das Sequências (Central de Automação) — trava de segurança nº1.
//
// O motor de sequências (runGeradorSequenciasConsumer) só encerra uma inscrição se
// a sequência for apagada, o número sair do CRM ou entrar na supressão — NUNCA
// quando o cliente RESPONDE. Sem isto, o passo 2 do drip pode cair em cima de quem
// já respondeu (cringe + risco de denúncia/ban). É a base que deixa qualquer
// auto-enroll de sequência ser ligado com segurança.
//
// A cada tick do /process-messages: olha o inbound REAL da linha IO (webhook_debug,
// fromMe=false) e marca 'parado' toda inscrição ATIVA daquele telefone. Só PARA
// envios — nunca dispara nada. Idempotente. Curto-circuita quando não há inscrição
// ativa (o caso de hoje, com 0 sequências) → custo ~1 query e sai.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

// Instância Z-API da linha IO (mesma const do geradorInboundService, com override por env).
const INSTANCE_ID_IO = (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();

// Mesma chave do CRM (reagendarDigest.telKey): só dígitos, tira 55, DDD + últimos 8
// (ignora o 9º dígito, que a Z-API às vezes grava e às vezes não).
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

export async function runSequenciaStopOnReply(): Promise<{ paradas: number; inbound: number }> {
  // 1) Só faz trabalho se existir inscrição ATIVA (hoje = 0 → no-op barato).
  const { data: ativas, error: eAtivas } = await supabaseGerador
    .from('sequencia_inscricoes')
    .select('id, phone')
    .eq('status', 'ativo');
  if (eAtivas) { logger.error('seq-stop', 'ler inscricoes ativas falhou', eAtivas); return { paradas: 0, inbound: 0 }; }
  if (!ativas || ativas.length === 0) return { paradas: 0, inbound: 0 };

  // 2) Inbound REAL da linha IO nos últimos ~6min (janela > tick de 5min).
  const desde = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data: rows, error: eRows } = await supabase
    .from('webhook_debug')
    .select('payload')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(300);
  if (eRows) { logger.error('seq-stop', 'ler webhook_debug falhou', eRows); return { paradas: 0, inbound: 0 }; }

  const respondeuKeys = new Set<string>();
  for (const r of rows ?? []) {
    const p = (r.payload ?? {}) as Record<string, any>;
    if (p.type !== 'ReceivedCallback') continue;
    if (p.instanceId !== INSTANCE_ID_IO) continue;
    if (p.isGroup === true || p.isGroup === 'true') continue;
    // fromMe pode vir string — mesma coerção do geradorInboundService.
    if (p.fromMe === true || p.fromMe === 'true') continue; // é NOSSO envio, não resposta do cliente
    const phone = String(p.phone || p.senderPhone || '').replace(/\D/g, '');
    const k = telKey(phone);
    if (k) respondeuKeys.add(k);
  }
  if (respondeuKeys.size === 0) return { paradas: 0, inbound: 0 };

  // 3) Marca 'parado' as inscrições ativas cujo telefone respondeu.
  const idsParar = (ativas as { id: string; phone: string | null }[])
    .filter((i) => { const k = telKey(i.phone); return k !== null && respondeuKeys.has(k); })
    .map((i) => i.id);
  if (idsParar.length === 0) return { paradas: 0, inbound: respondeuKeys.size };

  const { error: eUpd } = await supabaseGerador
    .from('sequencia_inscricoes')
    .update({ status: 'parado' })
    .in('id', idsParar)
    .eq('status', 'ativo'); // guarda contra corrida
  if (eUpd) { logger.error('seq-stop', 'update parado falhou', eUpd); return { paradas: 0, inbound: respondeuKeys.size }; }

  logger.info('seq-stop', `stop-on-reply: ${idsParar.length} inscrição(ões) parada(s) por resposta do cliente`);
  return { paradas: idsParar.length, inbound: respondeuKeys.size };
}
