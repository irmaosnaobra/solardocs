// ─────────────────────────────────────────────────────────────────────────────
// PORTÃO ANTI-BAN DO WHATSAPP DA RECUPERAÇÃO DE CHECKOUT (followupService.recoverAbandonedCheckouts)
//
// O opener da Giovanna saía pela linha 5040 sem teto, sem espaçamento, sem carimbo, de madrugada e
// sem conferir pausa humana ou mudo, e duas rodadas do /cron/master (vercel.json e cron.yml) mandavam
// o mesmo toque duas vezes. Este módulo é o portão (mesmas funções da Carla do quiz,
// solardoc/recuperacaoCarla.ts) e o claim por INSERT.
//
// Veredito de cada telefone:
//   ok      → pode falar agora (janela 9h-20h seg-sáb sem feriado, teto do frio, espaçamento, pausa, mudo).
//   segura  → NÃO agora, mas pode depois: o toque não avança e o WhatsApp tenta no próximo tick
//             (fora da janela, teto cheio, espaçamento, humano na conversa, leitura que falhou).
//   corta   → esta PESSOA não recebe WhatsApp (supressão/mudo): o e-mail segue e o toque avança.
//
// Trava de linha (janela, teto, espaçamento ou um envio já feito) vale para o resto da rodada: não
// adianta repetir a consulta para o próximo checkout. A vaga é de UM envio por rodada (o espaçamento
// de 10 a 15 min da linha seguraria o segundo de qualquer jeito).
//
// O carimbo `rec_checkout_sent:<id do abandoned_checkout>:<toque>` mora em BOT_SENT_PREFIXES
// (lineThrottle.ts) como prefixo FRIO, para pesar no teto e no espaçamento da linha.
// ─────────────────────────────────────────────────────────────────────────────

import { dentroDaJanelaDaBaseLinha, dentroDoTetoHorarioLinha, respeitaEspacamentoLinha } from './agents/whatsapp/lineThrottle';
import { podeFalarComLead } from './agents/whatsapp/pausaHumana';
import { carregarMudos, motivosDaSupressao, TOQUES_ATE_DESISTIR } from './agents/whatsapp/silenciar';
import { reservarChave, liberarChave } from './agentes5040/cota';
import { CHAVE_LINHA_PAUSA } from './agentes5040/vivoEnvio';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';

export const PREFIXO_REC_CHECKOUT = 'rec_checkout_sent:';

export const chaveDoToqueRecuperacao = (id: string, toque: number): string => `${PREFIXO_REC_CHECKOUT}${id}:${toque}`;

export type VereditoPortao =
  | { ok: true }
  | { ok: false; acao: 'segura' | 'corta'; motivo: string };

/** Um claim sem marca de "enviado" e mais velho que isto é de uma rodada que caiu entre o claim e o envio: a rodada seguinte retoma. */
export const CLAIM_VELHO_MS = 60 * 60 * 1000;

/**
 * Claim do toque por INSERT (a hora fica em `updated_at` e em `value.em`).
 *   ok       → é nosso (inclusive um claim velho retomado): pode enviar.
 *   ja       → outra rodada está com o toque (ou o claim é recente): não envie.
 *   enviado  → o toque JÁ saiu (ou o envio lançou erro: `falhou`) numa rodada anterior e só faltou gravar o avanço: não envie, só avance.
 *   erro     → não deu para decidir: segura.
 * Retomada de claim velho: DELETE condicionado à mesma `updated_at` que lemos. O Postgres deixa uma rodada só apagar aquela
 * linha (a outra recebe zero linhas) e o INSERT seguinte é decidido pela chave única, então duas rodadas nunca retomam o mesmo claim.
 */
export async function tomarToqueRecuperacao(id: string, toque: number, agora: Date = new Date()): Promise<'ok' | 'ja' | 'enviado' | 'erro'> {
  const chave = chaveDoToqueRecuperacao(id, toque);
  const v = await reservarChave(chave, {}, agora);
  if (v === 'reservada') return 'ok';
  if (v === 'erro') return 'erro';
  try {
    const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', chave).maybeSingle();
    if (error) return 'erro';
    if (!data) return 'ja';   // sumiu entre o insert e a leitura (outra rodada desfez): o próximo tick decide
    const linha = data as { value?: { enviado?: boolean; falhou?: boolean } | null; updated_at?: string | null };
    // Claim com `enviado` ou `falhou` NUNCA é retomado (talvez a mensagem saiu): o toque só avança, sem WhatsApp.
    if (linha.value?.enviado || linha.value?.falhou) return 'enviado';
    const desde = Date.parse(String(linha.updated_at ?? ''));
    if (!Number.isFinite(desde)) return 'ja';
    if (agora.getTime() - desde <= CLAIM_VELHO_MS) return 'ja';
    const { data: apagadas, error: erroApagar } = await supabase.from('system_state').delete()
      .eq('key', chave).eq('updated_at', String(linha.updated_at)).select('key');
    if (erroApagar || (apagadas ?? []).length !== 1) return 'ja';
    logger.warn('rec-checkout', `claim velho retomado (${chave}, ${Math.round((agora.getTime() - desde) / 60_000)} min)`);
    const de_novo = await reservarChave(chave, { retomado: true }, agora);
    return de_novo === 'reservada' ? 'ok' : de_novo === 'ja_existe' ? 'ja' : 'erro';
  } catch {
    return 'erro';
  }
}

async function marcarClaim(id: string, toque: number, valor: Record<string, unknown>, agora: Date): Promise<void> {
  try {
    const iso = agora.toISOString();
    const { error } = await supabase.from('system_state').update({ value: { ...valor, em: iso }, updated_at: iso }).eq('key', chaveDoToqueRecuperacao(id, toque));
    if (error) logger.error('rec-checkout', 'marcar o claim do toque falhou');
  } catch { logger.error('rec-checkout', 'marcar o claim do toque falhou'); }
}

/** O WhatsApp deste toque saiu: marca no claim, para um claim velho nunca ser retomado e reenviado. Melhor esforço. */
export const marcarToqueEnviado = (id: string, toque: number, agora: Date = new Date()): Promise<void> => marcarClaim(id, toque, { enviado: true }, agora);

/** O sendFrio LANÇOU erro (transporte ou número): talvez saiu. O claim fica marcado `falhou` e nunca é retomado. */
export const marcarToqueFalhou = (id: string, toque: number, agora: Date = new Date()): Promise<void> => marcarClaim(id, toque, { falhou: true }, agora);

// ── falhas por pessoa (rec_checkout_falha:<id do abandoned_checkout>) ────────────────────────────────────────
// Número que dá erro no envio (4xx da Z-API) não pode travar a cadência nem a linha: o toque avança só com o e-mail e, com
// FALHAS_PARA_SO_EMAIL falhas, os toques seguintes dessa pessoa nem tentam o WhatsApp. Fora de BOT_SENT_PREFIXES (não é envio).
export const FALHAS_PARA_SO_EMAIL = 2;
const chaveDasFalhas = (id: string): string => `rec_checkout_falha:${id}`;

/** Quantas vezes o sendFrio lançou erro para este checkout. null = não deu para ler (quem chama segura). */
export async function lerFalhasWhats(id: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveDasFalhas(id)).maybeSingle();
    if (error) return null;
    return Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0) || 0;
  } catch { return null; }
}

export async function contarFalhaWhats(id: string, agora: Date = new Date()): Promise<void> {
  try {
    const n = ((await lerFalhasWhats(id)) ?? 0) + 1;
    const iso = agora.toISOString();
    const { error } = await supabase.from('system_state').upsert({ key: chaveDasFalhas(id), value: { n, em: iso }, updated_at: iso }, { onConflict: 'key' });
    if (error) logger.error('rec-checkout', 'contar a falha do WhatsApp falhou');
  } catch { logger.error('rec-checkout', 'contar a falha do WhatsApp falhou'); }
}

/** Desfaz o claim (o envio não saiu: o toque volta na próxima rodada). */
export async function soltarToqueRecuperacao(id: string, toque: number): Promise<void> {
  await liberarChave(chaveDoToqueRecuperacao(id, toque));
}

/** Uma rodada do cron. A lista de mudos é lida UMA vez e só fica em memória quando a leitura dá certo. */
export function novaRodadaPortao(agora: () => Date = () => new Date()) {
  let mudos: Promise<(telefone: string) => boolean> | null = null;
  let linhaTravada: string | null = null;

  const trava = (motivo: string): VereditoPortao => { linhaTravada = motivo; return { ok: false, acao: 'segura', motivo }; };
  const segura = (motivo: string): VereditoPortao => ({ ok: false, acao: 'segura', motivo });

  return {
    async avaliar(tel: string): Promise<VereditoPortao> {
      if (linhaTravada) return { ok: false, acao: 'segura', motivo: linhaTravada };
      if (!dentroDaJanelaDaBaseLinha(agora())) return trava('fora_da_janela');

      // Linha pausada (erros seguidos de envio, contados pela Carla do quiz): a 5040 inteira espera.
      try {
        const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
        if (error) return trava('leitura_falhou');
        const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
        if (Number.isFinite(ate) && ate > agora().getTime()) return trava('linha_pausada');
      } catch { return trava('leitura_falhou'); }

      // A pessoa: supressão (opt-out, denúncia...) e mudo cortam; erro de leitura segura (na dúvida, não fala).
      let supressao: string[];
      try { supressao = await motivosDaSupressao(tel); } catch { return segura('leitura_falhou'); }
      if (supressao.length) return { ok: false, acao: 'corta', motivo: 'suprimido' };
      try {
        if (!mudos) mudos = carregarMudos(Math.min(3, TOQUES_ATE_DESISTIR), 60, { estrito: true });
        if ((await mudos)(tel)) return { ok: false, acao: 'corta', motivo: 'mudo' };
      } catch { mudos = null; return segura('leitura_falhou'); }

      // Pausa humana: alguém da equipe está falando com ela. Passa o tempo e volta.
      try { if (!(await podeFalarComLead(tel)).pode) return segura('humano_na_conversa'); } catch { return segura('leitura_falhou'); }

      // A linha: teto do FRIO (não é transacional: ninguém pediu esta mensagem) e espaçamento.
      try {
        if (!(await dentroDoTetoHorarioLinha({ transacional: false }))) return trava('teto');
        if (!(await respeitaEspacamentoLinha())) return trava('espacamento');
      } catch { return trava('leitura_falhou'); }
      return { ok: true };
    },
    /** Saiu um WhatsApp (ou o sendFrio calou): o resto da rodada espera o próximo tick. */
    travarRodada(motivo: string): void { linhaTravada = motivo; },
  };
}
