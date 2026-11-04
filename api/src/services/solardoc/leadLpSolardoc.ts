// ─────────────────────────────────────────────────────────────────────────────
// O LEAD DA LP DO SOLARDOC NO WHATSAPP (04/11/2026).
//
// Quem gera o Pix na LP (origem lp_solardoc) ganha um lead em `leads_meta` (banco do Gerador) com `form_id` NOVO, `lp_solardoc_pix`, e o MESMO
// lead_id do quiz (`sdquiz_<DDD+8>`). O `Código` gravado é o que o front da LP põe no wa.me: com ele a Carla reconhece quem já escreveu
// (`ja_falou`) mesmo por um LID sem mapa, e o porteiro (`sdquiz_`) manda a conversa para a Carla.
//
//   - Nunca sobrescreve: lead_id que já existe (o do quiz, ou o da LP de uma visita anterior) fica como está.
//   - É lido SÓ pelo `carregarPagto` da Carla (`form_id = lp_solardoc_pix`). A fila de 15 min, o tick de desistência e o aviso ao grupo
//     continuam lendo só `quiz_solardoc`: o lead da LP nunca entra neles.
//   - Falha aqui nunca derruba o Pix: devolve o código mesmo assim (ele sai do telefone).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { hmacDe } from '../agentes5040/hmac';
import { chaveDoTelefone, codigoDoQuiz, leadIdDoQuiz, normalizarTelefoneSd } from './quizSolardoc';

export const FORM_ID_LP_PIX = 'lp_solardoc_pix';

export interface EntradaLeadLp {
  whatsapp: string | null | undefined;
  nome: string | null | undefined;
  lp_session?: string | null;
  /** utm_* da atribuição (o `utm_term` serve de reserva ao link da recuperação). */
  utm?: Record<string, string | null | undefined>;
}

/** O código do wa.me da pessoa, ou null (telefone ilegível). */
export function codigoDaLp(whatsapp: string | null | undefined): string | null {
  const tel = normalizarTelefoneSd(whatsapp);
  return tel ? codigoDoQuiz(tel) : null;
}

/** Grava o lead da LP (insert que ignora duplicado). Devolve o código do wa.me, ou null se o telefone não vale. Nunca lança. */
export async function gravarLeadLp(e: EntradaLeadLp, agora: Date = new Date()): Promise<string | null> {
  const tel = normalizarTelefoneSd(e.whatsapp);
  if (!tel) return null;
  const codigo = codigoDoQuiz(tel);
  const leadId = leadIdDoQuiz(tel);
  try {
    const campos: Array<{ name: string; values: string[] }> = [
      { name: 'Origem', values: ['LP'] },
      { name: 'Código', values: [codigo] },
    ];
    if (e.lp_session) campos.push({ name: 'lp_session', values: [e.lp_session] });
    for (const [k, v] of Object.entries(e.utm ?? {})) if (v) campos.push({ name: k, values: [String(v)] });
    // O lead que já existe (quiz ou LP anterior) nunca é tocado: lê primeiro; o insert que bate num duplicado (23505) também é ignorado.
    const { data } = await supabaseGerador.from('leads_meta').select('lead_id').eq('lead_id', leadId).limit(1);
    if (data?.length) return codigo;
    const { error } = await supabaseGerador.from('leads_meta').insert({
      lead_id: leadId, created_time: agora.toISOString(), form_id: FORM_ID_LP_PIX, form_name: 'LP SolarDoc Pix',
      nome: String(e.nome ?? '').trim().slice(0, 120) || null, whatsapp: tel, cidade: null, fora_area: false, field_data: campos,
    });
    if (error && (error as { code?: string }).code !== '23505') throw error;
  } catch (err) {
    // O lead_id é o telefone: o log leva só um hash curto.
    const ref = (hmacDe(chaveDoTelefone(tel)) ?? 'sem-segredo').slice(0, 10);
    logger.error('pix-publico', `lead da LP ${ref} não gravou`, { erro: (err as { message?: string } | null)?.message ?? 'erro desconhecido' });
  }
  return codigo;
}
