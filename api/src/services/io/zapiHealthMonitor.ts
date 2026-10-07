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
//
// "No ar" também só com resposta EXPLÍCITA connected=true. Até 07/10/2026 bastava
// smartphoneConnected=true, e isso dava 'up' justamente na sessão caída com o
// celular vivo (connected=false + smartphoneConnected=true): a queda mais comum
// passava como linha sã. Agora esse caso é 'down', e celular sem connected é
// inconclusivo.
//
// Toda chamada externa daqui (Z-API, banco, e-mail) tem prazo de 8 s com
// AbortController. Sem isso uma Z-API pendurada segurava o /master até os 300 s
// da função. Prazo estourado no /status ou na leitura do estado = inconclusivo:
// sem alarme e sem gravar nada. No e-mail e na gravação, só loga e segue.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { sendOpsAlert } from '../../utils/mailer';
import { logger } from '../../utils/logger';

const STATE_KEY = 'zapi_io_health';
const REALERT_MS = 6 * 60 * 60 * 1000; // reavisa a cada 6h se seguir caída

/** Prazo de cada chamada externa do monitor (Z-API, banco, e-mail). */
export const ZAPI_HEALTH_TIMEOUT_MS = 8_000;

class PrazoEstourado extends Error {
  constructor(readonly rotulo: string, readonly ms: number) {
    super(`${rotulo}: sem resposta em ${ms} ms`);
    this.name = 'PrazoEstourado';
  }
}

/**
 * Roda `fn` com um AbortController que aborta em `ms` e corre contra o relógio.
 * A corrida existe porque nem todo cliente honra o sinal: quem ignora o abort
 * continua rodando por baixo, mas o monitor para de esperar. O relógio fica
 * armado até `fn` terminar inteira, então corpo de resposta travado também
 * estoura (não só o cabeçalho).
 */
async function comPrazo<T>(rotulo: string, ms: number, fn: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rejeita) => {
    timer = setTimeout(() => {
      const err = new PrazoEstourado(rotulo, ms);
      rejeita(err);      // primeiro o prazo, pra corrida terminar por ele
      ctrl.abort(err);
    }, ms);
  });
  try {
    const trabalho = Promise.resolve(fn(ctrl.signal));
    // Quem perde a corrida ainda rejeita depois (AbortError, e-mail que falha
    // tarde). O race já assina o trabalho, então hoje isso não fica solto; o
    // catch fica para a rejeição tardia nunca virar unhandled rejection (no
    // Node 24 ela derruba o processo) se alguém mexer na corrida.
    trabalho.catch(() => {});
    return await Promise.race([trabalho, prazo]);
  } finally {
    clearTimeout(timer);
  }
}

interface HealthState {
  downStreak?: number;
  alertadoEm?: string | null;   // ISO do último alerta de queda (dedup)
  ultimaConexao?: string | null;
  // ISO do momento em que a linha VOLTOU depois de estar caída. Não é apagado na
  // próxima checagem (ao contrário de downStreak/alertadoEm, que zeram): é ele que
  // arma a rampa de aquecimento do lineThrottle. A linha cai de dias em dias, então
  // depender de alguém lembrar de setar LINHA_RECONECTADA_EM à mão é depender do
  // esquecimento. O monitor já sabe a hora exata — passa a registrar.
  reconectadoEm?: string | null;
}

function ioCreds(): { id: string; token: string; client: string } | null {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  const client = (process.env.ZAPI_CLIENT_TOKEN_IO || process.env.ZAPI_CLIENT_TOKEN)?.trim();
  if (!id || !token || !client) return null;
  return { id, token, client };
}

// 'up' | 'down' | 'unknown'. 'up' só com connected=true explícito, 'down' só com
// connected=false explícito (mesmo com smartphoneConnected=true: é a sessão caída
// com o celular vivo). Resto, erro e prazo estourado = 'unknown'.
export async function checarConexaoZapi(
  c: { id: string; token: string; client: string },
  opts: { timeoutMs?: number } = {},
): Promise<'up' | 'down' | 'unknown'> {
  const ms = opts.timeoutMs ?? ZAPI_HEALTH_TIMEOUT_MS;
  try {
    const { ok, body } = await comPrazo('GET /status', ms, async (signal) => {
      const r = await fetch(`https://api.z-api.io/instances/${c.id}/token/${c.token}/status`, {
        headers: { 'Client-Token': c.client },
        signal,
      });
      const corpo: any = await r.json().catch(() => null);
      return { ok: r.ok, body: corpo };
    });
    if (!ok || !body || typeof body !== 'object') return 'unknown';
    if (body.connected === true) return 'up';
    if (body.connected === false) { logger.error('zapi-health', 'linha IO reportou connected=false', body); return 'down'; }
    // Shape inesperado (inclui smartphoneConnected sem connected) → NÃO alarma;
    // loga o corpo cru pra a gente ver o formato real e ajustar o parse.
    logger.info('zapi-health', 'status shape inesperado (sem alarme) — corpo cru', body);
    return 'unknown';
  } catch (err) {
    // Sem a URL no log: ela carrega o token da instância.
    if (err instanceof PrazoEstourado) {
      logger.error('zapi-health', `GET /status sem resposta em ${ms} ms (inconclusivo, sem alarme)`);
    } else {
      logger.error('zapi-health', 'fetch /status falhou (inconclusivo, sem alarme)', err);
    }
    return 'unknown';
  }
}

// null = não deu pra ler (erro ou prazo). Quem chama NÃO grava nada nesse caso:
// seguir com {} zeraria downStreak e apagaria o reconectadoEm que arma a rampa
// de 72h do lineThrottle.
async function loadState(ms: number): Promise<HealthState | null> {
  try {
    const { data, error } = await comPrazo('system_state (leitura)', ms, (signal) =>
      supabase.from('system_state').select('value').eq('key', STATE_KEY).abortSignal(signal).maybeSingle());
    if (error) { logger.error('zapi-health', 'leitura do estado falhou (rodada sem gravar)', error); return null; }
    return (data?.value as HealthState) ?? {};
  } catch (err) {
    logger.error('zapi-health', 'leitura do estado sem resposta (rodada sem gravar)', err instanceof Error ? err.message : err);
    return null;
  }
}
async function saveState(s: HealthState, ms: number): Promise<void> {
  try {
    const { error } = await comPrazo('system_state (gravação)', ms, (signal) =>
      supabase.from('system_state').upsert(
        { key: STATE_KEY, value: s, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      ).abortSignal(signal));
    if (error) logger.error('zapi-health', 'gravação do estado falhou', error);
  } catch (err) {
    logger.error('zapi-health', 'gravação do estado sem resposta', err instanceof Error ? err.message : err);
  }
}

// E-mail com prazo. O SDK do Resend não aceita sinal no tipo, então a requisição
// dele não é cancelada: o monitor só para de esperar por ela.
async function avisar(assunto: string, html: string, ms: number, rotulo: string): Promise<void> {
  await comPrazo(`e-mail "${rotulo}"`, ms, () => sendOpsAlert(assunto, html))
    .catch((err) => logger.error('zapi-health', `email "${rotulo}" falhou`, err instanceof Error ? err.message : err));
}

export async function runZapiHealthCheck(
  opts: { timeoutMs?: number } = {},
): Promise<{ status: string; alertou?: string; motivo?: string }> {
  const ms = opts.timeoutMs ?? ZAPI_HEALTH_TIMEOUT_MS;
  const c = ioCreds();
  if (!c) return { status: 'sem_credencial' };

  const conexao = await checarConexaoZapi(c, { timeoutMs: ms });
  if (conexao === 'unknown') return { status: 'inconclusivo' };

  const st = await loadState(ms);
  if (!st) return { status: 'inconclusivo', motivo: 'estado_ilegivel' };

  if (conexao === 'up') {
    // `voltou` = tinha QUALQUER sinal de queda (não só alerta já enviado): uma queda
    // curta, de uma checagem só, também deixa a linha frágil e merece aquecimento.
    const voltou = !!st.alertadoEm || (st.downStreak ?? 0) > 0;
    await saveState({
      downStreak: 0, alertadoEm: null, ultimaConexao: new Date().toISOString(),
      reconectadoEm: voltou ? new Date().toISOString() : (st.reconectadoEm ?? null),
    }, ms);
    if (voltou) {
      await avisar(
        '✅ Linha WhatsApp (IO) reconectou',
        `<p>A instância Z-API da linha IO <strong>voltou a conectar</strong>. Os envios (confirmações, lembretes, sequências, dunning, Bia) estão fluindo de novo.</p>
         <p><strong>Aquecimento armado automaticamente</strong>: nas próximas 72h a linha manda menos (2/h no 1º dia, 3/h no 2º, 4/h no 3º) e depois volta ao normal sozinha. Linha recém-reconectada é a mais frágil que existe.</p>`,
        ms, 'voltou',
      );
      return { status: 'up', alertou: 'reconectou' };
    }
    return { status: 'up' };
  }

  // conexao === 'down'
  const streak = (st.downStreak ?? 0) + 1;
  const alertadoMs = st.alertadoEm ? new Date(st.alertadoEm).getTime() : 0;
  const podeAlertar = streak >= 2 && (!alertadoMs || Date.now() - alertadoMs > REALERT_MS);

  if (podeAlertar) {
    await avisar(
      '🚨 Linha WhatsApp (IO) CAÍDA',
      `<p>A instância Z-API da linha IO está <strong>desconectada</strong> (${streak} checagens seguidas).</p>
       <p>Enquanto estiver assim, <strong>nenhuma mensagem sai</strong>: confirmações de agendamento, lembretes, sequências, dunning, Bia e avisos de rodízio ficam parados.</p>
       <p>Reconecte o WhatsApp da linha: confira se o celular está ligado, online e com bateria — e, se precisar, leia o QR code de novo no painel da Z-API.</p>`,
      ms, 'queda',
    );
    await saveState({ downStreak: streak, alertadoEm: new Date().toISOString(), ultimaConexao: st.ultimaConexao ?? null, reconectadoEm: st.reconectadoEm ?? null }, ms);
    return { status: 'down', alertou: 'sim' };
  }

  await saveState({ downStreak: streak, alertadoEm: st.alertadoEm ?? null, ultimaConexao: st.ultimaConexao ?? null, reconectadoEm: st.reconectadoEm ?? null }, ms);
  return { status: 'down' };
}
