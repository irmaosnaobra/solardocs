// ─────────────────────────────────────────────────────────────────────────────
// MONITOR DE LINHA CAÍDA (instância Z-API da linha IO) — trava de segurança.
//
// TODA a mensageria (confirmações de agendamento, lembretes, sequências, dunning,
// Bia, avisos de rodízio) depende da instância Z-API conectada. Se ela cai (celular
// offline, sem bateria, QR expirado), o zapiClient só loga o erro e os envios somem
// em SILÊNCIO — ninguém percebe até a venda cair.
//
// Aqui: checa o /status da instância IO a cada hora (roda no /master). Se cair 2
// checagens seguidas, avisa o Thiago por EMAIL — a própria linha está morta, então
// não dá pra avisar por WhatsApp. Dedup: 1 alerta por episódio; reavisa a cada 6h
// se seguir caída; manda "voltou" quando reconecta. Conservador: só decide "caída"
// com resposta EXPLÍCITA connected=false (blip de rede / shape inesperado = não
// alarma — o Thiago não quer ping à toa).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { sendOpsAlert } from '../../utils/mailer';
import { logger } from '../../utils/logger';

const STATE_KEY = 'zapi_io_health';
const REALERT_MS = 6 * 60 * 60 * 1000; // reavisa a cada 6h se seguir caída

interface HealthState {
  downStreak?: number;
  alertadoEm?: string | null;   // ISO do último alerta de queda (dedup)
  ultimaConexao?: string | null;
}

function ioCreds(): { id: string; token: string; client: string } | null {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) return null;
  return { id, token, client };
}

// 'up' | 'down' | 'unknown'. Só decide 'down' com resposta EXPLÍCITA connected=false.
export async function checarConexaoZapi(c: { id: string; token: string; client: string }): Promise<'up' | 'down' | 'unknown'> {
  try {
    const r = await fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/status`, {
      headers: { 'Client-Token': c.client },
    });
    const body: any = await r.json().catch(() => null);
    if (!r.ok || !body || typeof body !== 'object') return 'unknown';
    if (body.connected === true || body.smartphoneConnected === true) return 'up';
    if (body.connected === false) { logger.error('zapi-health', 'linha IO reportou connected=false', body); return 'down'; }
    return 'unknown';
  } catch (err) {
    logger.error('zapi-health', 'fetch /status falhou (inconclusivo, sem alarme)', err);
    return 'unknown';
  }
}

async function loadState(): Promise<HealthState> {
  const { data } = await supabase.from('system_state').select('value').eq('key', STATE_KEY).maybeSingle();
  return (data?.value as HealthState) ?? {};
}
async function saveState(s: HealthState): Promise<void> {
  await supabase.from('system_state').upsert(
    { key: STATE_KEY, value: s, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

export async function runZapiHealthCheck(): Promise<{ status: string; alertou?: string }> {
  const c = ioCreds();
  if (!c) return { status: 'sem_credencial' };

  const conexao = await checarConexaoZapi(c);
  if (conexao === 'unknown') return { status: 'inconclusivo' };

  const st = await loadState();

  if (conexao === 'up') {
    const voltou = !!st.alertadoEm; // estava em alerta de queda → reconectou
    await saveState({ downStreak: 0, alertadoEm: null, ultimaConexao: new Date().toISOString() });
    if (voltou) {
      await sendOpsAlert(
        '✅ Linha WhatsApp (IO) reconectou',
        `<p>A instância Z-API da linha IO <strong>voltou a conectar</strong>. Os envios (confirmações, lembretes, sequências, dunning, Bia) estão fluindo de novo.</p>`,
      ).catch((err) => logger.error('zapi-health', 'email "voltou" falhou', err));
      return { status: 'up', alertou: 'reconectou' };
    }
    return { status: 'up' };
  }

  // conexao === 'down'
  const streak = (st.downStreak ?? 0) + 1;
  const alertadoMs = st.alertadoEm ? new Date(st.alertadoEm).getTime() : 0;
  const podeAlertar = streak >= 2 && (!alertadoMs || Date.now() - alertadoMs > REALERT_MS);

  if (podeAlertar) {
    await sendOpsAlert(
      '🚨 Linha WhatsApp (IO) CAÍDA',
      `<p>A instância Z-API da linha IO está <strong>desconectada</strong> (${streak} checagens seguidas).</p>
       <p>Enquanto estiver assim, <strong>nenhuma mensagem sai</strong>: confirmações de agendamento, lembretes, sequências, dunning, Bia e avisos de rodízio ficam parados.</p>
       <p>Reconecte o WhatsApp da linha: confira se o celular está ligado, online e com bateria — e, se precisar, leia o QR code de novo no painel da Z-API.</p>`,
    ).catch((err) => logger.error('zapi-health', 'email de alerta falhou', err));
    await saveState({ downStreak: streak, alertadoEm: new Date().toISOString(), ultimaConexao: st.ultimaConexao ?? null });
    return { status: 'down', alertou: 'sim' };
  }

  await saveState({ downStreak: streak, alertadoEm: st.alertadoEm ?? null, ultimaConexao: st.ultimaConexao ?? null });
  return { status: 'down' };
}
