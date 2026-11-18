// ─────────────────────────────────────────────────────────────────────────────
// AVISO DO PIX AUTOMÁTICO GERADO E NÃO PAGO (17/11/2026).
//
// Contrato de `asaas_pix_assinaturas` em `pendente`, criado há 30 min ou mais (e há menos de 16 h), sem pagamento: o grupo da equipe recebe UM aviso por
// contrato ("vale um humano chamar agora"), com a frase de se a Carla já chamou ou chama no próximo horário.
//
// Regras:
//   - Só das 9h às 20h de Brasília (hora cheia de 9 a 19:59). Fora disso não lê nem grava nada.
//   - O envio é SÓ pelo `emitir` de avisoGrupoSolardoc (avisarPixPendente): claim por contrato (`quiz_aviso:pixpend:<contrato>`), fica pendente e sai no cartão
//     do tick (descarregarPendentes), com o espaçamento, o teto da hora e a trava de 4xx dele, e o carimbo `solardoc_aviso_sent:`. Nunca `sendToGroup` direto.
//   - Contrato pago (status diferente de pendente, ou com pagamento gravado) nunca gera aviso. Lead de teste também não.
//   - No máximo 5 contratos por rodada; o claim já existente tira o contrato antes de gastar leitura de lead.
//   - AVISO_PIX_PENDENTE_OFF=true desliga (também 1).
// Roda como tarefa `['pix_pendente_aviso', ...]` do /process-messages (routes/cron.ts), ANTES do tick do cartão, que corre logo depois na mesma rodada.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { hmacDe } from '../agentes5040/hmac';
import { horaBRT as horaCheiaBRT } from '../agentes5040/relogio';
import { chaveDoTelefone, normalizarTelefoneSd } from './quizSolardoc';
import { avisarPixPendente, descartarPixPendente, campoDe, ehLeadDeTeste, lerLeadDoQuiz, PREFIXO_CLAIM_PIX_PENDENTE, type ResultadoAviso } from './avisoGrupoSolardoc';
import { PREFIXO_CARIMBO_REC, PREFIXO_PULOU_REC, horaBRT } from './recuperacaoCarlaRegras';
import { vendasRecentes, type VendasRecentes } from './compraQuizSolardoc';
import { contratoNaoPago, pessoaDoContratoPagou } from './pixPendentePagou';

export { contratoNaoPago };

/** O contrato precisa ter pelo menos isto de idade para o aviso. */
export const ESPERA_AVISO_PIX_MS = 30 * 60_000;
/** E no máximo isto: contrato velho demais já não é para chamar agora (a janela da noite ainda alcança o contrato de fim de tarde). */
export const VALE_AVISO_PIX_MS = 16 * 3600_000;
export const AVISOS_PIX_POR_RODADA = 5;
/** Um aviso por PESSOA (hmac do telefone) a cada 24 h, mesmo com vários contratos pendentes. A marca mora fora de `quiz_aviso:` (o cartão de pendentes não a lê). */
export const PREFIXO_PESSOA_PIX = 'quiz_aviso_pix_pessoa:';
export const JANELA_PESSOA_PIX_MS = 24 * 3600_000;
export const JANELA_AVISO_PIX = { abre: 9, fecha: 20 } as const;

export const FRASE_CARLA_CHAMOU = (hora: string): string => `A Carla já chamou às ${hora}.`;
export const FRASE_CARLA_CHAMA = 'A Carla ainda não chamou e chama no próximo horário da linha, das 9h às 20h.';
export const FRASE_CARLA_NAO_CHAMA = 'A Carla não vai chamar esta pessoa: falar à mão.';

export interface RelatorioAvisoPix {
  ok: boolean; motivo?: string; lidos: number; avisados: number; pulados: number; resultados: Record<string, number>;
}

type LinhaContrato = { contract_id: string | null; email?: string | null; user_id?: string | null; status: string | null; created_at: string | null; ultimo_pagamento_id?: unknown; ultimo_pagamento_em?: unknown };

const desligado = (): boolean => ['true', '1'].includes((process.env.AVISO_PIX_PENDENTE_OFF || '').trim().toLowerCase());

/** Dentro das 9h às 20h de Brasília? */
export const dentroDaJanelaDoAvisoPix = (agora: Date): boolean => {
  const h = horaCheiaBRT(agora);
  return h >= JANELA_AVISO_PIX.abre && h < JANELA_AVISO_PIX.fecha;
};

/** Toma a vez da pessoa: 'ok' se não foi avisada nas últimas 24 h (e grava a marca), 'ja' se foi, 'erro' se o banco falhou. */
async function tomarPessoa(hmac: string, agora: Date): Promise<'ok' | 'ja' | 'erro'> {
  const chave = `${PREFIXO_PESSOA_PIX}${hmac}`;
  const em = agora.toISOString();
  const { data, error } = await supabase.from('system_state').select('updated_at').eq('key', chave).maybeSingle();
  if (error) return 'erro';
  const ultima = Date.parse(String((data as { updated_at?: string } | null)?.updated_at ?? ''));
  if (data) {
    if (Number.isFinite(ultima) && agora.getTime() - ultima < JANELA_PESSOA_PIX_MS) return 'ja';
    const { error: eUp } = await supabase.from('system_state').update({ value: { em }, updated_at: em }).eq('key', chave);
    return eUp ? 'erro' : 'ok';
  }
  const { error: eIn } = await supabase.from('system_state').insert({ key: chave, value: { em }, updated_at: em });
  if (!eIn) return 'ok';
  return (eIn as { code?: string }).code === '23505' ? 'ja' : 'erro';
}

/** A frase de se a Carla já chamou: o carimbo do 1º toque (com `em` e sem estado `nao_saiu`), o pulo permanente, ou ainda não. */
export function linhaDaCarlaNoPix(carimbo: { em?: unknown; estado?: unknown } | null | undefined, pulou: boolean): string {
  const em = typeof carimbo?.em === 'string' ? Date.parse(carimbo.em) : NaN;
  if (carimbo && carimbo.estado !== 'nao_saiu' && Number.isFinite(em)) return FRASE_CARLA_CHAMOU(horaBRT(em));
  return pulou ? FRASE_CARLA_NAO_CHAMA : FRASE_CARLA_CHAMA;
}

export async function runAvisoPixPendenteTick(agora: Date = new Date()): Promise<RelatorioAvisoPix> {
  const r: RelatorioAvisoPix = { ok: true, lidos: 0, avisados: 0, pulados: 0, resultados: {} };
  if (desligado()) return { ...r, motivo: 'desligado' };
  if (!dentroDaJanelaDoAvisoPix(agora)) return { ...r, motivo: 'fora_da_janela' };
  try {
    const { data, error } = await supabase.from('asaas_pix_assinaturas')
      .select('contract_id, email, user_id, status, created_at, ultimo_pagamento_id, ultimo_pagamento_em').eq('status', 'pendente')
      .lte('created_at', new Date(agora.getTime() - ESPERA_AVISO_PIX_MS).toISOString())
      .gte('created_at', new Date(agora.getTime() - VALE_AVISO_PIX_MS).toISOString())
      .order('created_at', { ascending: true }).limit(60);
    if (error) return { ...r, ok: false, motivo: 'leitura_falhou' };
    const contratos = ((data ?? []) as LinhaContrato[]).filter(c => !!c.contract_id && contratoNaoPago(c));
    r.lidos = contratos.length;
    if (!contratos.length) return { ...r, motivo: 'nada' };

    // Quem já tem o claim sai antes de gastar leitura de lead e de atribuição.
    const claims = contratos.map(c => `${PREFIXO_CLAIM_PIX_PENDENTE}${c.contract_id}`);
    const { data: ja, error: eJa } = await supabase.from('system_state').select('key').in('key', claims);
    if (eJa) return { ...r, ok: false, motivo: 'leitura_dos_claims_falhou' };
    const jaAvisados = new Set(((ja ?? []) as Array<{ key: string }>).map(x => x.key));
    const novos = contratos.filter(c => !jaAvisados.has(`${PREFIXO_CLAIM_PIX_PENDENTE}${c.contract_id}`)).slice(0, AVISOS_PIX_POR_RODADA);

    // Quem já pagou por qualquer meio (venda, plano, conta vigente, outro contrato) fica de fora: lê as vendas uma vez por rodada.
    let vendas: VendasRecentes | null = null;
    if (novos.length) {
      try { vendas = await vendasRecentes(agora.getTime()); } catch { return { ...r, ok: false, motivo: 'leitura_das_vendas_falhou' }; }
    }

    for (const c of novos) {
      const id = c.contract_id as string;
      // O WhatsApp mora na atribuição do contrato. Sem ele não há para quem ligar: sem aviso e sem claim (a atribuição pode chegar na rodada seguinte).
      const { data: atr, error: eAtr } = await supabase.from('system_state').select('value').eq('key', `pix_auto_atrib:${id}`).maybeSingle();
      if (eAtr) { r.pulados++; continue; }
      const w = (atr as { value?: { whatsapp?: unknown } } | null)?.value?.whatsapp;
      const tel = normalizarTelefoneSd(typeof w === 'string' ? w : null);
      if (!tel) { r.pulados++; continue; }
      const hmac = hmacDe(chaveDoTelefone(tel));
      if (!hmac) { r.pulados++; continue; }

      // Já pagou por outro meio (cartão aos 20 min, outro contrato, plano liberado)? Sem aviso, e o contrato sai da fila com um claim `descartado`. Leitura que falha: sem claim, tenta na próxima.
      const pagou = await pessoaDoContratoPagou(c, agora.getTime(), vendas ?? undefined);
      if (pagou === 'erro') { r.pulados++; continue; }
      if (pagou === 'pagou') { await descartarPixPendente(id, 'pagou_por_outro_meio'); r.pulados++; r.resultados.pagou = (r.resultados.pagou ?? 0) + 1; continue; }
      const lead = await lerLeadDoQuiz({ telefone: tel });
      if (lead && ehLeadDeTeste(lead.field_data)) { r.pulados++; continue; }
      // O estado da Carla: carimbo do 1º toque (chamou), pulo permanente (não vai chamar) ou nada (chama no próximo horário).
      const kCarimbo = `${PREFIXO_CARIMBO_REC}${hmac}`;
      const kPulou = `${PREFIXO_PULOU_REC}${hmac}`;
      const { data: est, error: eEst } = await supabase.from('system_state').select('key, value').in('key', [kCarimbo, kPulou]);
      if (eEst) { r.pulados++; continue; }
      const linhas = (est ?? []) as Array<{ key: string; value: { em?: unknown; estado?: unknown } | null }>;
      const carimbo = linhas.find(l => l.key === kCarimbo)?.value ?? null;
      const pulou = linhas.some(l => l.key === kPulou);

      // Um aviso por pessoa a cada 24 h: o segundo contrato da mesma pessoa sai da fila sem aviso.
      const vez = await tomarPessoa(hmac, agora);
      if (vez === 'erro') { r.pulados++; continue; }
      if (vez === 'ja') { await descartarPixPendente(id, 'pessoa_avisada_24h'); r.pulados++; r.resultados.pessoa_ja_avisada = (r.resultados.pessoa_ja_avisada ?? 0) + 1; continue; }

      const minutos = Math.floor((agora.getTime() - Date.parse(String(c.created_at))) / 60_000);
      const res: ResultadoAviso = await avisarPixPendente({
        contratoId: id, minutos, nome: lead?.nome ?? null, empresa: lead ? campoDe(lead.field_data, 'Empresa') : null, telefone: tel,
        linhaCarla: linhaDaCarlaNoPix(carimbo, pulou),
      });
      r.resultados[res] = (r.resultados[res] ?? 0) + 1;
      if (res === 'pendente' || res === 'enviado') r.avisados++;
      // O claim não gravou: devolve a vez da pessoa, para a próxima rodada tentar.
      if (res === 'erro' || res === 'ignorado') await supabase.from('system_state').delete().eq('key', `${PREFIXO_PESSOA_PIX}${hmac}`);
      // `erro` (o claim não gravou) para a rodada: o banco está mal.
      if (res === 'erro') break;
    }
    return r;
  } catch (e) {
    logger.error('solardoc-aviso', 'tick do Pix pendente falhou', { erro: String(e).slice(0, 120) });
    return { ...r, ok: false, motivo: 'erro' };
  }
}
