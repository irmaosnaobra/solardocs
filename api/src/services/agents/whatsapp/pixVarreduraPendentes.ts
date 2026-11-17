// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA DOS COMPROVANTES PENDENTES (17/11/2026). Ordem do dono: "liberar por lá sempre", sem depender de alguém pedir o e-mail de novo.
//
// Caso real: o cliente mandou o e-mail às 16h16, o comprovante às 16h18, escreveu "Esse" e depois só áudio. O comprovante ficou guardado como pendente
// (`pix_solicitado:<telefone>`.comprovante) esperando um e-mail que já estava na conversa. Esta varredura roda no /process-messages (tick de 5 min):
//   1. lista os `pix_solicitado:%` com comprovante que PASSOU nas travas, criado nas últimas 72 h;
//   2. acha o último e-mail DO LEAD (nunca fala nossa) desde 48 h antes do comprovante até agora, só se for um e-mail único;
//   3. achou: aplica pelo MESMO caminho de quando o e-mail chega (aplicarComprovantePendente): a reserva do txid, a trava de dedup e o E2E impedem crédito dobrado,
//      e o pendente sai ao liberar;
//   4. não achou: não faz nada (o pedido de e-mail saiu na hora do comprovante; nada de lembrete).
// Anti-ban (17/11/2026, o chefe bloqueou a 1ª versão): cada liberação manda WhatsApp ao cliente, ao Thiago e ao grupo, então:
//   - UMA liberação por rodada (do pendente mais antigo ao mais novo; sem e-mail ou com fala humana não gasta a vez);
//   - trava da rodada `pix_varredura_tick:<faixa de 5 min>` por insert (o /process-messages tem mais de um relógio);
//   - linha de origem em cooldown ou caída (monitor `zapi_io_health`): pula a rodada inteira, o pendente fica para depois;
//   - fala NOSSA (from_me) para o telefone mais de 60 s depois do comprovante = alguém atendeu (liberação manual no /admin não apaga o pendente): pula;
//   - quem volta sem ser tratado ganha `pix_varredura_visto:<fone>` (chave paralela, o pendente não é regravado) e vai para o fim da fila.
// Nunca lança, loga o resultado. PIX_VARREDURA_OFF=true desliga.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { linhaEmCooldown } from '../zapiClient';
import type { ZapiInstance } from '../zapiClient';
import { reservarChave } from '../../agentes5040/cota';
import type { PixSolicitado } from './pixSolicitado';

const LOG = 'pix-varredura';
export const JANELA_PENDENTE_MS = 72 * 3_600_000;
/** Uma liberação por rodada: cada uma manda WhatsApp (cliente, Thiago e grupo). */
export const MAX_POR_RODADA = 1;
const FAIXA_MS = 5 * 60_000;
/** Fala nossa até 60 s depois do comprovante é a resposta automática do próprio fluxo ("Recebi seu comprovante..."). */
const FOLGA_RESPOSTA_AUTOMATICA_MS = 60_000;
const PREFIXO_TICK = 'pix_varredura_tick:';
const PREFIXO_VISTO = 'pix_varredura_visto:';
const PREFIXO_PENDENTE = 'pix_solicitado:';
/** A mesma linha IO que o whatsappAgentService usa para escolher a instância de resposta. */
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

export interface ResultadoVarredura {
  ligada: boolean; candidatos: number; liberados: number; semEmail: number; naoTratados: number; erros: number;
  comFalaNossa: number; pulouRodada: 'trava' | 'linha' | null;
}

const ehOff = (): boolean => ['true', '1'].includes(String(process.env.PIX_VARREDURA_OFF ?? '').trim().toLowerCase());

/** O telefone da chave `pix_solicitado:<DDD+número>` no formato que o fluxo normal usa (com 55). */
const telefoneDaChave = (chave: string): string => {
  const d = chave.slice(PREFIXO_PENDENTE.length).replace(/\D/g, '');
  return d.length <= 11 ? `55${d}` : d;
};

const variantes = (cleanPhone: string): string[] => {
  const d = cleanPhone.replace(/\D/g, '').replace(/^55/, '');
  return [cleanPhone, d, `55${d}`];
};

/** De qual linha este lead escreve? Pela última mensagem dele; sem informação, a do SolarDoc (o padrão do fluxo normal). */
async function instanciaDoLead(cleanPhone: string): Promise<ZapiInstance> {
  try {
    const { data } = await supabase.from('wa_mensagens').select('instancia, telefone')
      .in('telefone', variantes(cleanPhone)).eq('from_me', false).order('momment', { ascending: false }).limit(1);
    const inst = String((data as Array<{ instancia?: string | null }> | null)?.[0]?.instancia ?? '');
    return inst && inst === INSTANCE_ID_IO ? 'io' : 'solardoc';
  } catch { return 'solardoc'; }
}

/** Alguém nosso (equipe ou robô) falou com este telefone depois da resposta automática do comprovante? Erro de leitura = "não sei" = true (não libera às cegas). */
async function houveFalaNossaDepois(cleanPhone: string, emComprovante: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('wa_mensagens').select('momment')
      .in('telefone', variantes(cleanPhone)).eq('from_me', true)
      .gte('momment', new Date(emComprovante + FOLGA_RESPOSTA_AUTOMATICA_MS).toISOString()).limit(1);
    if (error) return true;
    return ((data ?? []) as unknown[]).length > 0;
  } catch { return true; }
}

/** A linha de origem está fora? Cooldown em memória (o mesmo do zapiPost) ou, para a IO, o monitor gravou queda (2 checagens seguidas). Fail-open na leitura do monitor, como o lineThrottle. */
async function linhaFora(inst: ZapiInstance, agoraMs: number): Promise<boolean> {
  try {
    if (linhaEmCooldown(inst)) return true;
    if (inst !== 'io') return false;
    const { data } = await supabase.from('system_state').select('value, updated_at').eq('key', 'zapi_io_health').maybeSingle();
    const { estadoDaLinha } = await import('../../gerador/caixaWhatsapp');
    const row = data as { value?: { downStreak?: number | null; ultimaConexao?: string | null } | null; updated_at?: string | null } | null;
    return estadoDaLinha(row?.value ?? null, row?.updated_at ?? null, agoraMs).estado === 'caida';
  } catch { return false; }
}

/** Marca (em chave paralela, o pendente não é regravado) que o pendente voltou sem ser tratado: vai para o fim da fila. */
async function marcarVisto(chave: string, agoraMs: number): Promise<void> {
  try {
    const iso = new Date(agoraMs).toISOString();
    await supabase.from('system_state').upsert(
      { key: `${PREFIXO_VISTO}${chave.slice(PREFIXO_PENDENTE.length)}`, value: { ultimaVarreduraEm: iso }, updated_at: iso },
      { onConflict: 'key' },
    );
  } catch { /* sem a marca o pendente só mantém o lugar na fila */ }
}

export async function varrerComprovantesPendentes(agoraMs: number = Date.now()): Promise<ResultadoVarredura> {
  const r: ResultadoVarredura = { ligada: !ehOff(), candidatos: 0, liberados: 0, semEmail: 0, naoTratados: 0, erros: 0, comFalaNossa: 0, pulouRodada: null };
  if (!r.ligada) return r;
  try {
    // Trava da rodada: o /process-messages é chamado por mais de um relógio; quem não reserva a faixa de 5 min não faz nada.
    const faixa = Math.floor(agoraMs / FAIXA_MS);
    const reserva = await reservarChave(`${PREFIXO_TICK}${faixa}`, { faixa }, new Date(agoraMs));
    if (reserva !== 'reservada') { r.pulouRodada = 'trava'; return r; }
    try {
      await supabase.from('system_state').delete().like('key', `${PREFIXO_TICK}%`).lt('updated_at', new Date(agoraMs - 2 * 3_600_000).toISOString());
    } catch { /* a próxima rodada leva */ }

    const { data, error } = await supabase.from('system_state').select('key, value').like('key', `${PREFIXO_PENDENTE}%`).limit(500);
    if (error) { logger.error(LOG, 'não consegui listar os comprovantes pendentes'); r.erros++; return r; }
    const vistos = new Map<string, number>();
    try {
      const { data: v } = await supabase.from('system_state').select('key, value').like('key', `${PREFIXO_VISTO}%`).limit(500);
      for (const x of (v ?? []) as Array<{ key: string; value: { ultimaVarreduraEm?: string } | null }>) {
        const t = Date.parse(String(x.value?.ultimaVarreduraEm ?? ''));
        if (Number.isFinite(t)) vistos.set(x.key.slice(PREFIXO_VISTO.length), t);
      }
    } catch { /* sem as marcas, vale só a ordem por comprovante */ }
    const visto = (chave: string): number => vistos.get(chave.slice(PREFIXO_PENDENTE.length)) ?? 0;
    // Nunca visto primeiro (do comprovante mais antigo ao mais novo); quem já voltou sem tratar vai para o fim (o visto há mais tempo antes).
    const pendentes = ((data ?? []) as Array<{ key: string; value: PixSolicitado | null }>)
      .filter(l => {
        const c = l.value?.comprovante;
        const em = Date.parse(String(c?.em ?? ''));
        return !!c && c.passou === true && Number.isFinite(em) && agoraMs - em <= JANELA_PENDENTE_MS;
      })
      .sort((a, b) => (visto(a.key) - visto(b.key)) || (Date.parse(String(a.value!.comprovante!.em)) - Date.parse(String(b.value!.comprovante!.em))));
    r.candidatos = pendentes.length;
    if (!pendentes.length) return r;
    const { emailDoLeadNoHistorico, aplicarComprovantePendente } = await import('./pixComprovanteService');
    for (const l of pendentes) {
      const cleanPhone = telefoneDaChave(l.key);
      try {
        const emComprovante = Date.parse(String(l.value!.comprovante!.em));
        // Passa o instante do comprovante: a janela de 48 h do helper vai dele para trás, e tudo que veio depois (até agora) também vale.
        const email = l.value!.email || await emailDoLeadNoHistorico(cleanPhone, emComprovante, true);
        if (!email) { r.semEmail++; continue; }
        if (await houveFalaNossaDepois(cleanPhone, emComprovante)) {
          r.comFalaNossa++;
          logger.info(LOG, `pulado: já houve fala nossa depois do comprovante (final ${cleanPhone.slice(-4)})`);
          continue;
        }
        const inst = await instanciaDoLead(cleanPhone);
        if (await linhaFora(inst, agoraMs)) {
          r.pulouRodada = 'linha';
          logger.info(LOG, `linha ${inst} em cooldown ou caída: rodada pulada, o pendente fica para depois`);
          break;
        }
        const res = await aplicarComprovantePendente(cleanPhone, email, l.value!.nome ?? null, inst);
        if (res.tratado) r.liberados++; else { r.naoTratados++; await marcarVisto(l.key, agoraMs); }
        break;   // no máximo UMA chamada por rodada
      } catch (err) {
        r.erros++;
        await marcarVisto(l.key, agoraMs);
        logger.error(LOG, `a varredura falhou num pendente (final ${cleanPhone.slice(-4)})`, err);
        break;
      }
    }
  } catch (err) {
    r.erros++;
    logger.error(LOG, 'a varredura falhou', err);
  }
  logger.info(LOG, `candidatos ${r.candidatos}, liberados ${r.liberados}, sem e-mail ${r.semEmail}, com fala nossa ${r.comFalaNossa}, não tratados ${r.naoTratados}, erros ${r.erros}${r.pulouRodada ? `, rodada pulada (${r.pulouRodada})` : ''}`);
  return r;
}
