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

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { hmacDe } from '../agentes5040/hmac';
import { chaveDoTelefone, codigoDoQuiz, leadIdDoQuiz, normalizarTelefoneSd } from './quizSolardoc';
import { diaBRT } from './recuperacaoCarlaRegras';

export const FORM_ID_LP_PIX = 'lp_solardoc_pix';
/** Campo `Etapa` do lead gravado ANTES do "Gerar" (rota lead-lp): é o que põe a pessoa na fila do abandono da LP. O lead gravado ao gerar o Pix não leva este campo. */
export const ETAPA_LP_ABANDONO = 'abandono';
/** `lp_lead_sessao:<sessao>` = { hmac, lead_id, em }: 1 lead por sessão da LP. */
export const PREFIXO_LP_SESSAO = 'lp_lead_sessao:';
/** `lp_lead_subst:<hmac>` = número SUBSTITUÍDO por outro na mesma sessão: sai da fila do abandono (nada é apagado do Gerador). */
export const PREFIXO_LP_SUBST = 'lp_lead_subst:';
/** `lp_lead_ip:<hash do IP>:<dia BRT>` = { sessao, em }: só a 1ª sessão de cada IP no dia entra na fila do frio (freio do chefe anti-ban). Só o HASH do IP: o repo é público. */
export const PREFIXO_LP_IP = 'lp_lead_ip:';

/** HMAC do IP (nunca o IP). null = sem IP legível ou sem segredo de hash. */
export function hashDoIp(ip: string | null | undefined): string | null {
  const t = String(ip ?? '').trim();
  if (!t || t === 'sem-ip') return null;
  return hmacDe(`lp-ip|${t}`);
}

/**
 * O claim do IP no dia, SÓ por insert: o 1º número desse IP no dia ganha a etapa de recuperação (entra na fila do frio). A mesma `sessao` volta a ganhar (a correção do número
 * dentro da sessão vale); outra sessão do mesmo IP no dia não. `falhaAbre`: no /publico (que nunca bloqueia a geração) erro de leitura deixa passar; no lead-lp barra.
 */
export async function reivindicarIpDoDia(ipHash: string | null, sessao: string, agora: Date = new Date(), falhaAbre = false): Promise<boolean> {
  if (!ipHash) return falhaAbre;
  const chave = `${PREFIXO_LP_IP}${ipHash}:${diaBRT(agora.getTime())}`;
  try {
    const em = agora.toISOString();
    const { error } = await supabase.from('system_state').insert({ key: chave, value: { sessao, em }, updated_at: em });
    if (!error) return true;
    if ((error as { code?: string }).code !== '23505') return falhaAbre;
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    return (data as { value?: { sessao?: unknown } } | null)?.value?.sessao === sessao;
  } catch { return falhaAbre; }
}

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

/**
 * Celular brasileiro COMPLETO (DDD + 9 + 8 dígitos), com ou sem 55, pontuação e espaços. Devolve `55` + 11 dígitos, ou null (fixo, sem o 9, DDD inválido, curto
 * demais, comprido demais).
 */
export function celularBrCompleto(bruto: unknown): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 11 || !/^[1-9][1-9]9\d{8}$/.test(d)) return null;
  return '55' + d;
}

export interface EntradaLeadLpAbandono {
  whatsapp: string | null | undefined;
  nome?: string | null;
  email?: string | null;
  /** A sessão da LP: 1 lead por sessão. */
  sessao: string;
  /** O `lp_session` da atribuição (o que a marca do Pix leva). Sem ele vale a `sessao`. */
  lpSession?: string | null;
  utm?: Record<string, string | null | undefined>;
  /** HMAC do IP de quem digitou (nunca o IP). Sem ele o lead é gravado SEM a etapa: não entra na fila do frio. */
  ipHash?: string | null;
}

/**
 * O lead da LP ANTES do "Gerar" (05/11/2026). Mesmo lead_id, mesmo `Código` do wa.me e mesmo form_id do lead do Pix, com o campo `Etapa = abandono`.
 *   - Nunca sobrescreve um lead que já existe (o do quiz, ou o da LP de uma visita anterior): só grava se o lead_id é novo.
 *   - 1 lead por `sessao`: o número NOVO da mesma sessão substitui o anterior, e o anterior sai da fila do abandono pela marca `lp_lead_subst:<hmac>`
 *     (não há DELETE no Gerador).
 *   - Devolve o código do wa.me, ou null se o celular não vale. Falha de gravação nunca derruba a rota: o código sai do telefone, e fica no log só um hash curto.
 */
export async function gravarLeadLpAbandono(e: EntradaLeadLpAbandono, agora: Date = new Date()): Promise<string | null> {
  const tel = celularBrCompleto(e.whatsapp);
  if (!tel) return null;
  const codigo = codigoDoQuiz(tel);
  const leadId = leadIdDoQuiz(tel);
  const hmac = hmacDe(chaveDoTelefone(tel));
  const ref = (hmac ?? 'sem-segredo').slice(0, 10);
  const em = agora.toISOString();
  try {
    // 0. o freio do IP: só a 1ª sessão do IP no dia entra na fila do frio. As outras gravam o lead SEM a etapa, e o código do wa.me sai igual.
    const entraNaFila = await reivindicarIpDoDia(e.ipHash ?? null, e.sessao, agora, false);
    // 1. o lead (só se o lead_id é novo).
    const { data: existe } = await supabaseGerador.from('leads_meta').select('lead_id').eq('lead_id', leadId).limit(1);
    if (!existe?.length) {
      const campos: Array<{ name: string; values: string[] }> = [
        { name: 'Origem', values: ['LP'] }, { name: 'Código', values: [codigo] },
        { name: 'lp_session', values: [e.lpSession || e.sessao] },
      ];
      if (entraNaFila) campos.push({ name: 'Etapa', values: [ETAPA_LP_ABANDONO] });
      const mail = String(e.email ?? '').trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) campos.push({ name: 'E-mail', values: [mail.slice(0, 200)] });
      for (const [k, v] of Object.entries(e.utm ?? {})) if (v) campos.push({ name: k, values: [String(v)] });
      const { error } = await supabaseGerador.from('leads_meta').insert({
        lead_id: leadId, created_time: em, form_id: FORM_ID_LP_PIX, form_name: 'LP SolarDoc Pix',
        nome: String(e.nome ?? '').trim().slice(0, 120) || null, whatsapp: tel, cidade: null, fora_area: false, field_data: campos,
      });
      if (error && (error as { code?: string }).code !== '23505') throw error;
    }
    // 2. 1 lead por sessão: o número novo substitui o anterior.
    if (hmac) {
      const chave = `${PREFIXO_LP_SESSAO}${e.sessao}`;
      const { error: eIns } = await supabase.from('system_state').insert({ key: chave, value: { hmac, lead_id: leadId, em }, updated_at: em });
      if (eIns) {
        if ((eIns as { code?: string }).code !== '23505') throw eIns;
        const { data: atual } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
        const antigo = (atual as { value?: { hmac?: unknown } } | null)?.value?.hmac;
        if (typeof antigo === 'string' && antigo && antigo !== hmac) {
          const { error: eSub } = await supabase.from('system_state').insert({ key: `${PREFIXO_LP_SUBST}${antigo}`, value: { em, sessao: e.sessao }, updated_at: em });
          if (eSub && (eSub as { code?: string }).code !== '23505') throw eSub;
          const { error: eUp } = await supabase.from('system_state').update({ value: { hmac, lead_id: leadId, em }, updated_at: em }).eq('key', chave);
          if (eUp) throw eUp;
        }
      }
    }
  } catch (err) {
    logger.error('pix-publico', `lead da LP (antes do Gerar) ${ref} não gravou`, { erro: (err as { message?: string } | null)?.message ?? 'erro desconhecido' });
  }
  return codigo;
}
