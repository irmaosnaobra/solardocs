// ─────────────────────────────────────────────────────────────────────────────
// DESISTÊNCIA DO QUIZ DO SOLARDOC, SEM ROBÔ (24/10/2026, plano B1).
//
// No molde de runSolarQuizLeadsTick (solarBoasVindas.ts). Pega os leads de
// `leads_meta` com form_id 'quiz_solardoc' gravados há 15 min ou mais e há 48 h
// ou menos, SEM compra, e avisa o grupo uma vez por pessoa (claim no módulo).
//
// LEITURA: do mais novo para o mais antigo, em páginas de 100, pulando quem já tem
// claim, até juntar 10 tentativas. Com mais de 100 leads em 48 h, os novos não
// ficam de fora.
//
// COMPRA casa de três jeitos (o quiz não coleta e-mail, então e-mail não casa):
//   1. `sales.attribution_session_id` = o `lp_session` gravado no lead (o mesmo
//      valor que vai no metadata da sessão da Stripe);
//   2. `sales.phone` com a mesma chave do contato (DDD + 8 últimos): Stripe e Asaas;
//   3. `users.whatsapp` com plano que não é 'free': cobre o Pix por comprovante,
//      que não escreve em `sales`, e quem já era cliente.
//
// LIMITE: 10 TENTATIVAS por rodada (toda chamada ao aviso conta, enviada, pendente ou
// não), e o primeiro `falhou` encerra a rodada. Sem id de grupo, no máximo UM e-mail
// de resumo por rodada.
//
// Quem chama o relógio: o `/process-messages` (a cada 5 min), DEPOIS do allSettled
// dos outros ticks (routes/cron.ts), e a rota `/solar-agente?dry=1` para conferir sem
// gravar.
//
// Quando o robô da Carla estiver ligado (QUIZ_RECUPERACAO_LIGADA=1), a desistência
// passa a ser avisada por ele, 25 a 60 s depois da mensagem dela, com a hora: este
// tick só descarrega os pendentes, para não avisar aos 15 min com o texto errado.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveDoContato } from '../chefe/destinos';
import { variantesDaChave } from '../gerador/caixaWhatsapp';
import { hmacDe } from '../agentes5040/hmac';
import { normalizarTelefoneSd, chaveDoTelefone } from './quizSolardoc';
import { montarAviso } from './avisoGrupoTextos';
import {
  avisarDesistencia, camposDoLead, campoDe, descarregarPendentes, ehLeadDeTeste, emailResumoSemGrupo, emailResumoParada, paradaDoGrupo,
  PREFIXO_CLAIM_QUIZ, type LeadQuizLinha, type ParadaDoGrupo,
} from './avisoGrupoSolardoc';

export const ESPERA_MIN_MS = 15 * 60_000;
export const JANELA_MAX_MS = 48 * 3600_000;
export const TENTATIVAS_POR_RODADA = 10;
const PAGINA = 100;
const PAGINAS_MAX = 5;

export interface ResultadoDesistencia {
  avisados: number;
  tentativas?: number;
  pendentes: number;
  motivo?: string;
  previa?: Array<{ lead: string; texto: string }>;
}

interface VendaLinha { phone?: string | null; attribution_session_id?: string | null }

/** Quem comprou: sessões e chaves de telefone das vendas recentes do ledger. */
async function vendasRecentes(agora: number): Promise<{ sessoes: Set<string>; chaves: Set<string> }> {
  const sessoes = new Set<string>();
  const chaves = new Set<string>();
  const desde = new Date(agora - JANELA_MAX_MS - 3600_000).toISOString();
  const { data, error } = await supabase.from('sales').select('phone, attribution_session_id').gte('created_at', desde).limit(2000);
  if (error) throw new Error(`ler vendas: ${error.message}`);
  for (const v of (data ?? []) as VendaLinha[]) {
    if (v.attribution_session_id) sessoes.add(String(v.attribution_session_id));
    const k = chaveDoContato(v.phone);
    if (k) chaves.add(k);
  }
  return { sessoes, chaves };
}

/** Já tem plano pago com este número? (cobre o Pix por comprovante.) Erro sobe: na dúvida, ninguém é avisado. */
async function temPlanoPago(chave: string): Promise<boolean> {
  const variantes = variantesDaChave(chave);
  if (!variantes.length) return false;
  const { data, error } = await supabase.from('users').select('id').in('whatsapp', variantes).neq('plano', 'free').limit(1);
  if (error) throw new Error(`ler users: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function runSolardocQuizDesistenciaTick(opts: { dry?: boolean } = {}): Promise<ResultadoDesistencia> {
  const agora = Date.now();

  // 1) Os pendentes saem ANTES de qualquer interruptor: com QUIZ_DESISTENCIA_OFF ou com o robô da Carla ligado eles
  //    não podem ficar parados até vencer (e o que passou de 24 h vira e-mail, dentro do descarregarPendentes).
  // Trava de 4xx e pausa da linha: o que não pode esperar (desistência e sem vaga) vira UM e-mail de resumo por rodada,
  // somado aos itens novos desta rodada, e sai da fila (nunca vai ao grupo depois). O e-mail só sai no fim.
  let pendentes = 0;
  const porEmail: string[] = [];
  let parada: ParadaDoGrupo = null;
  if (!opts.dry) {
    try {
      const r = await descarregarPendentes({ emailAgora: false });
      pendentes = r.enviados;
      if (r.porEmail?.length) { porEmail.push(...r.porEmail); parada = r.parada ?? null; }
    } catch (e) { logger.warn('solardoc-aviso', 'descarregar pendentes falhou', { erro: String(e) }); }
  }
  const fecharEmail = async (): Promise<void> => {
    if (!porEmail.length) return;
    await emailResumoParada(porEmail, parada ?? await paradaDoGrupo());
  };
  if ((process.env.QUIZ_DESISTENCIA_OFF || '').trim() === '1') { await fecharEmail(); return { avisados: 0, pendentes, motivo: 'desligado' }; }
  if ((process.env.QUIZ_RECUPERACAO_LIGADA || '').trim() === '1') { await fecharEmail(); return { avisados: 0, pendentes, motivo: 'robo_da_carla_avisa' }; }

  let vendas: Awaited<ReturnType<typeof vendasRecentes>>;
  try { vendas = await vendasRecentes(agora); } catch (e) {
    logger.error('solardoc-aviso', 'conferir compras falhou: ninguém é avisado nesta rodada', { erro: String(e) });
    await fecharEmail();
    return { avisados: 0, pendentes, motivo: 'erro_compras' };
  }

  let avisados = 0;
  let tentativas = 0;
  let encerrar = false;
  const semGrupo: string[] = [];
  const previa: NonNullable<ResultadoDesistencia['previa']> = [];

  for (let pagina = 0; pagina < PAGINAS_MAX && !encerrar && tentativas < TENTATIVAS_POR_RODADA; pagina++) {
    // Do mais novo para o mais antigo.
    const { data, error } = await supabaseGerador.from('leads_meta')
      .select('lead_id, nome, whatsapp, cidade, field_data, created_time')
      .eq('form_id', 'quiz_solardoc')
      .gte('created_time', new Date(agora - JANELA_MAX_MS).toISOString())
      .lte('created_time', new Date(agora - ESPERA_MIN_MS).toISOString())
      .order('created_time', { ascending: false })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) { logger.error('solardoc-aviso', 'ler leads do quiz falhou', error); await fecharEmail(); return { avisados, tentativas, pendentes, motivo: 'erro_leitura' }; }
    const linhas = (data ?? []) as LeadQuizLinha[];
    if (!linhas.length) break;

    const hmacs = new Map<string, LeadQuizLinha>();
    for (const l of linhas) {
      if (ehLeadDeTeste(l.field_data)) continue;
      const tel = normalizarTelefoneSd(l.whatsapp);
      const h = tel ? hmacDe(chaveDoTelefone(tel)) : null;
      if (h && !hmacs.has(h)) hmacs.set(h, l);
    }
    if (hmacs.size) {
      // Quem já tem o claim de desistência (uma leitura por página).
      const { data: claims } = await supabase.from('system_state').select('key').in('key', [...hmacs.keys()].map(h => `${PREFIXO_CLAIM_QUIZ}${h}`));
      const jaTem = new Set(((claims ?? []) as Array<{ key: string }>).map(c => c.key));

      for (const [h, l] of hmacs) {
        if (tentativas >= TENTATIVAS_POR_RODADA || encerrar) break;
        if (jaTem.has(`${PREFIXO_CLAIM_QUIZ}${h}`)) continue;
        const tel = normalizarTelefoneSd(l.whatsapp) as string;
        const chave = chaveDoTelefone(tel);
        const lp = campoDe(l.field_data, 'lp_session');
        if ((lp && vendas.sessoes.has(lp)) || vendas.chaves.has(chave)) continue;
        try { if (await temPlanoPago(chave)) continue; } catch (e) {
          logger.warn('solardoc-aviso', 'conferir plano do lead falhou: pulado', { erro: String(e) });
          continue;
        }
        tentativas++;
        if (opts.dry) { previa.push({ lead: String(l.lead_id), texto: montarAviso('desistencia', camposDoLead(l)) }); avisados++; continue; }
        const r = await avisarDesistencia(l);
        if (r === 'enviado' || r === 'pendente') avisados++;
        else if (r === 'sem_grupo') semGrupo.push(montarAviso('desistencia', camposDoLead(l)));
        else if (r === 'por_email') porEmail.push(montarAviso('desistencia', camposDoLead(l)));
        else if (r === 'falhou') encerrar = true;   // o primeiro erro de envio encerra a rodada
      }
    }
    if (linhas.length < PAGINA) break;
  }

  // Sem id de grupo: UM e-mail de resumo por rodada, nunca um por lead.
  if (semGrupo.length) await emailResumoSemGrupo(semGrupo);
  await fecharEmail();
  if (avisados && !opts.dry) logger.info('solardoc-aviso', `${avisados} desistência(s) do quiz avisada(s) ao grupo`);
  return { avisados, tentativas, pendentes, ...(opts.dry ? { motivo: 'dry', previa } : {}), ...(encerrar ? { motivo: 'envio_falhou' } : {}) };
}
