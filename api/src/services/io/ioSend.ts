// ─────────────────────────────────────────────────────────────────────────────
// Helpers COMPARTILHADOS de envio na linha física IO (34998165040).
//
// Extraído de broadcastTickService.ts pra que o motor de disparos do admin
// (runIoBroadcastTick) e o novo motor do Gerador (geradorAutomacaoService) usem
// EXATAMENTE o mesmo envio Z-API, a mesma humanização e a MESMA lista de bloqueio
// (anti-denúncia). Duplicar essas três coisas = risco de mandar pra quem pediu
// opt-out ou tomar ban — então elas moram aqui, num lugar só.
//
// Também vive aqui o LOCK DE LINHA compartilhado entre os dois motores de blast:
// os dois rodam pela MESMA linha e ambos são isentos do teto 12/h (blast é
// operador-iniciado). Sem coordenação, dois blasts simultâneos dobram o envio e
// arriscam ban. O lock deixa só UM motor de blast ativo por janela.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { carregarSilenciados } from '../agents/whatsapp/silenciar';

export type MediaType = 'image' | 'video' | 'audio';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Reescreve uma mensagem-base pra soar humana (Haiku). Fail-open: sem key, devolve a base. */
export async function humanizar(base: string, contexto: string | null): Promise<string> {
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

/** Envio Z-API pela linha IO (texto/imagem/vídeo/áudio). Áudio vai sozinho (nota de voz). */
export async function enviarZapiIO(
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
    // send-audio nao aceita caption: o audio vai sozinho, como nota de voz.
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

/**
 * Carrega a lista de bloqueio (whatsapp_suppression) e devolve um matcher.
 * Casa por DDD + 8 últimos dígitos, estável com ou sem o nono dígito e o DDI.
 * É o que impede re-contatar quem pediu opt-out ou denunciou.
 */
export async function carregarSupressao(): Promise<(phone: string) => boolean> {
  // Delega pro módulo único de silêncio. A implementação anterior morava aqui e
  // casava por `slice(-10)`, que QUEBRA no Brasil: a Z-API alterna o nono dígito
  // entre mensagens do mesmo contato, e 5534991360172 dava "4991360172" enquanto
  // 553491360172 dava "3491360172". Mesmo telefone, duas chaves, e quem pediu
  // pra parar num formato voltava a receber no outro. Falha de chave não dá
  // erro: dá silêncio do lado errado, e ninguém vê.
  //
  // A chave nova é DDD + 8 últimos dígitos, estável nas duas formas. Os 3.043
  // registros de 13 dígitos da base passam a casar com os de 12.
  return carregarSilenciados();
}

// ── Lock de linha compartilhado entre os motores de blast ────────────────────
// Guardado em system_state (MAIN), chave única. Best-effort (leitura+escrita não
// atômica, igual ao rodízio) — suficiente porque os dois crons pingam em
// instantes diferentes e o objetivo é só evitar dois blasts sobrepostos.
const LINE_LOCK_KEY = 'io_line_blast_lock';

/** Tenta pegar o lock de blast da linha pra `owner`. `true` = pegou (ou já era seu). */
export async function adquirirLockBlast(owner: string, ttlMs: number): Promise<boolean> {
  const agora = Date.now();
  const { data } = await supabase
    .from('system_state').select('value').eq('key', LINE_LOCK_KEY).maybeSingle();
  if (data?.value) {
    try {
      const cur = JSON.parse(String(data.value)) as { owner?: string; until?: number };
      if (cur.until && cur.until > agora && cur.owner && cur.owner !== owner) {
        return false; // outro motor está com a linha
      }
    } catch { /* valor corrompido → sobrescreve */ }
  }
  await supabase.from('system_state').upsert(
    { key: LINE_LOCK_KEY, value: JSON.stringify({ owner, until: agora + ttlMs }), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  return true;
}

/** Libera o lock de blast se for do `owner` (no-op se já expirou/é de outro). */
export async function liberarLockBlast(owner: string): Promise<void> {
  const { data } = await supabase
    .from('system_state').select('value').eq('key', LINE_LOCK_KEY).maybeSingle();
  if (!data?.value) return;
  try {
    const cur = JSON.parse(String(data.value)) as { owner?: string };
    if (cur.owner !== owner) return;
  } catch { return; }
  await supabase.from('system_state').upsert(
    { key: LINE_LOCK_KEY, value: JSON.stringify({ owner: null, until: 0 }), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}
