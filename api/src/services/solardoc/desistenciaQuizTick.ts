// ─────────────────────────────────────────────────────────────────────────────
// DESISTÊNCIA DO QUIZ DO SOLARDOC (24/10/2026, planos B1 e B2).
//
// No molde de runSolarQuizLeadsTick (solarBoasVindas.ts). Pega os leads de `leads_meta` com form_id
// 'quiz_solardoc' gravados há 15 min ou mais, SEM compra, e avisa o grupo UMA VEZ por pessoa (o claim
// `quiz_aviso:<hmac>` é a trava de todos os caminhos).
//
// QUEM AVISA O QUÊ, decidido POR LEAD (B2). Um aviso por lead e só um caminho manda:
//   - Robô da Carla DESLIGADO (env '0' ou chave quiz_rec_pausa; função estadoRecuperacaoCarla):
//     o tick avisa aos 15 min com a linha "A Carla está desligada agora." Lê até 48 h, como no B1.
//   - Robô LIGADO e a Carla ainda PODE chamar o lead (elegível, avaliarLead ok, até 48 h): o tick NÃO avisa.
//     O aviso sai pelo caminho do robô ("A Carla falou às HH:MM", pendente, enviado por este tick no cartão),
//     pelo "sem vaga" do fim do dia, ou por este tick quando o lead VENCE (48 h a 50 h, "A Carla não chamou: passou de 48 horas sem vaga.").
//   - Robô LIGADO e a Carla NÃO vai chamar (sem CNPJ, antes da largada, já falou com a linha, suprimido, posse, pausa humana):
//     o tick avisa aos 15 min com uma linha de motivo ("A Carla não vai chamar: ainda sem CNPJ.") e a responsável é a Giovanna.
//   - A Carla chamou (carimbo quiz_rec_sent) e o aviso dela não chegou a ser tomado por 5 min (o robô caiu depois do envio): este tick toma.
//
// LEITURA: do mais novo para o mais antigo, em páginas de 100, pulando quem já tem claim. Com o robô ligado, uma leitura à parte vai
// primeiro nos que acabaram de vencer (48 h a 50 h): os novos, que vêm primeiro, não deixam o vencido sem aviso.
//
// LIMITE: 10 TENTATIVAS por rodada (toda chamada ao aviso conta), no máximo 12 leads avaliados com leitura por rodada, e o primeiro
// `falhou` encerra a rodada. Sem id de grupo, no máximo UM e-mail de resumo por rodada.
//
// Quem chama o relógio: o `/process-messages`, DEPOIS do allSettled dos outros ticks e ANTES do robô da Carla (routes/cron.ts): o aviso
// que o robô acaba de deixar pendente só pode sair na rodada seguinte. A rota `/solar-agente?dry=1` confere sem gravar.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { normalizarTelefoneSd, chaveDoTelefone } from './quizSolardoc';
import { montarAviso } from './avisoGrupoTextos';
import {
  avisarDesistencia, camposDoLead, campoDe, descarregarPendentes, ehLeadDeTeste, emailResumoSemGrupo, emailResumoParada, marcarComprou,
  paradaDoGrupo, PREFIXO_CLAIM_QUIZ, type LeadQuizLinha, type ParadaDoGrupo,
} from './avisoGrupoSolardoc';
import { hmacDe } from '../agentes5040/hmac';
import { comprouLead, temPlanoPago, vendasRecentes } from './compraQuizSolardoc';
import { avaliarLead, depsAvaliarReais, type DepsAvaliar } from './recuperacaoCarla';
import { estadoRecuperacaoCarla, lerLargada, type EstadoRecuperacao } from './recuperacaoCarlaEstado';
import {
  ESPERA_MIN_MS, FRASE_DO_MOTIVO, JANELA_LEITURA_COM_ROBO_MS, JANELA_MAX_MS, PREFIXO_CARIMBO_REC, horaBRT,
} from './recuperacaoCarlaRegras';

export { ESPERA_MIN_MS, JANELA_MAX_MS };
export const TENTATIVAS_POR_RODADA = 10;
const AVALIACOES_POR_RODADA = 12;
const PAGINA = 100;
const PAGINAS_MAX = 5;
/** O robô enviou e o aviso dele não foi tomado em tanto tempo: o tick assume (o robô caiu entre o envio e o aviso). */
const AVISO_DO_ROBO_ATRASADO_MS = 5 * 60_000;

export interface ResultadoDesistencia {
  avisados: number;
  tentativas?: number;
  pendentes: number;
  /** Leads que o robô ainda pode chamar: o tick deixa para ele. */
  deixadosAoRobo?: number;
  motivo?: string;
  previa?: Array<{ lead: string; texto: string }>;
}

export { temPlanoPago, vendasRecentes };

type CarimboRec = { key: string; updated_at?: string; value?: { estado?: string } };

const COLUNAS = 'lead_id, nome, whatsapp, cidade, field_data, created_time';

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

  // O estado do robô vale para a rodada inteira (lido uma vez). Chave do banco que não lê vale desligado: o tick avisa com a linha "desligada".
  const estado: EstadoRecuperacao = await estadoRecuperacaoCarla();
  let largada: number | null = null;
  if (estado.ligada) {
    try { largada = await lerLargada(); } catch (e) {
      logger.error('solardoc-aviso', 'ler a largada do robô falhou: ninguém é avisado nesta rodada', { erro: String(e) });
      await fecharEmail();
      return { avisados: 0, pendentes, motivo: 'erro_largada' };
    }
  }

  let vendas: Awaited<ReturnType<typeof vendasRecentes>>;
  try { vendas = await vendasRecentes(agora); } catch (e) {
    logger.error('solardoc-aviso', 'conferir compras falhou: ninguém é avisado nesta rodada', { erro: String(e) });
    await fecharEmail();
    return { avisados: 0, pendentes, motivo: 'erro_compras' };
  }
  // A compra já é conferida aqui, uma vez: a avaliação do robô não repete a consulta.
  const depsAvaliacao: DepsAvaliar = { ...depsAvaliarReais(), compra: async () => false };

  let avisados = 0;
  let tentativas = 0;
  let avaliados = 0;
  let deixados = 0;
  let encerrar = false;
  const semGrupo: string[] = [];
  const previa: NonNullable<ResultadoDesistencia['previa']> = [];

  const processar = async (linhas: LeadQuizLinha[]): Promise<void> => {
    const hmacs = new Map<string, LeadQuizLinha>();
    for (const l of linhas) {
      if (ehLeadDeTeste(l.field_data)) continue;
      const tel = normalizarTelefoneSd(l.whatsapp);
      const h = tel ? hmacDe(chaveDoTelefone(tel)) : null;
      if (h && !hmacs.has(h)) hmacs.set(h, l);
    }
    if (!hmacs.size) return;
    // Quem já tem o claim de desistência (uma leitura por página) e quem o robô já chamou.
    const { data: claims } = await supabase.from('system_state').select('key').in('key', [...hmacs.keys()].map(h => `${PREFIXO_CLAIM_QUIZ}${h}`));
    const jaTem = new Set(((claims ?? []) as Array<{ key: string }>).map(c => c.key));
    const chamados = new Map<string, CarimboRec>();
    if (estado.ligada) {
      const { data: car } = await supabase.from('system_state').select('key, updated_at, value').in('key', [...hmacs.keys()].map(h => `${PREFIXO_CARIMBO_REC}${h}`));
      for (const c of (car ?? []) as CarimboRec[]) chamados.set(c.key.slice(PREFIXO_CARIMBO_REC.length), c);
    }

    for (const [h, l] of hmacs) {
      if (tentativas >= TENTATIVAS_POR_RODADA || encerrar) break;
      if (jaTem.has(`${PREFIXO_CLAIM_QUIZ}${h}`)) continue;
      const tel = normalizarTelefoneSd(l.whatsapp) as string;
      const chave = chaveDoTelefone(tel);
      const lp = campoDe(l.field_data, 'lp_session');
      // Quem comprou ganha o claim `comprou` (sem envio e sem contar tentativa): a próxima rodada pula sem consultar `sales` e `users`.
      try {
        if (await comprouLead(vendas, lp, chave)) { if (!opts.dry) await marcarComprou(h); continue; }
      } catch (e) {
        logger.warn('solardoc-aviso', 'conferir plano do lead falhou: pulado', { erro: String(e) });
        continue;
      }

      // Quem avisa este lead? (a decisão por lead do B2)
      let hora: string | null = null;
      let motivo: string | null = null;
      if (!estado.ligada) {
        motivo = FRASE_DO_MOTIVO.desligada;
      } else {
        const chamado = chamados.get(h);
        if (chamado) {
          // A Carla chamou. O aviso é do robô; só assume se ele não o tomou em 5 min (caiu depois do envio).
          const quando = Date.parse(String(chamado.updated_at ?? ''));
          if (!Number.isFinite(quando) || agora - quando < AVISO_DO_ROBO_ATRASADO_MS) { deixados++; continue; }
          if (chamado.value?.estado === 'incerto') motivo = 'A Carla tentou chamar, mas não sei se a mensagem saiu.';
          else hora = horaBRT(quando);
        } else {
          if (avaliados >= AVALIACOES_POR_RODADA) continue;
          avaliados++;
          const av = await avaliarLead(l, { agoraMs: agora, largadaMs: largada, vendas }, depsAvaliacao);
          if (!av.ok) {
            // Teste, sem telefone e compra não geram aviso. O resto: a Carla não vai chamar, com o motivo.
            if (av.motivo === 'teste' || av.motivo === 'sem_telefone' || av.motivo === 'comprou') continue;
            // Leitura que falhou não é motivo: não toma o claim (o robô ainda pode chamar) e tenta de novo na próxima rodada.
            if (av.motivo === 'leitura_falhou') {
              if (agora - (Date.parse(String(l.created_time ?? '')) || agora) > JANELA_MAX_MS) motivo = FRASE_DO_MOTIVO.vencido;   // já venceu: avisa, a Carla não vai mais chamar
              else continue;
            } else
            motivo = FRASE_DO_MOTIVO[av.motivo];
          } else if (agora - (Date.parse(String(l.created_time ?? '')) || agora) > JANELA_MAX_MS) {
            motivo = FRASE_DO_MOTIVO.vencido;
          } else { deixados++; continue; }   // o robô ainda pode chamar: o aviso sai pelo caminho dele
        }
      }

      tentativas++;
      if (opts.dry) { previa.push({ lead: String(l.lead_id), texto: montarAviso('desistencia', { ...camposDoLead(l), hora_carla: hora, motivo_carla: motivo }) }); avisados++; continue; }
      const r = await avisarDesistencia(l, { horaCarla: hora, motivoCarla: motivo });
      const texto = (): string => montarAviso('desistencia', { ...camposDoLead(l), hora_carla: hora, motivo_carla: motivo });
      if (r === 'enviado' || r === 'pendente') avisados++;
      else if (r === 'sem_grupo') semGrupo.push(texto());
      else if (r === 'por_email') porEmail.push(texto());
      else if (r === 'falhou') encerrar = true;   // o primeiro erro de envio encerra a rodada
    }
  };

  const ler = async (de: number, ate: number, ordem: 'novo' | 'antigo', limite: number, inicio = 0): Promise<LeadQuizLinha[] | null> => {
    const { data, error } = await supabaseGerador.from('leads_meta').select(COLUNAS)
      .eq('form_id', 'quiz_solardoc')
      .gte('created_time', new Date(agora - de).toISOString())
      .lte('created_time', new Date(agora - ate).toISOString())
      .order('created_time', { ascending: ordem === 'antigo' })
      .range(inicio, inicio + limite - 1);
    if (error) { logger.error('solardoc-aviso', 'ler leads do quiz falhou', error); return null; }
    return (data ?? []) as LeadQuizLinha[];
  };

  // Robô ligado: primeiro os que acabaram de vencer (48 h a 50 h), do mais antigo ao mais novo.
  if (estado.ligada) {
    const vencidos = await ler(JANELA_LEITURA_COM_ROBO_MS, JANELA_MAX_MS, 'antigo', 50);
    if (vencidos === null) { await fecharEmail(); return { avisados, tentativas, pendentes, motivo: 'erro_leitura' }; }
    if (vencidos.length) await processar(vencidos);
  }
  for (let pagina = 0; pagina < PAGINAS_MAX && !encerrar && tentativas < TENTATIVAS_POR_RODADA; pagina++) {
    // Do mais novo para o mais antigo (até 48 h).
    const linhas = await ler(JANELA_MAX_MS, ESPERA_MIN_MS, 'novo', PAGINA, pagina * PAGINA);
    if (linhas === null) { await fecharEmail(); return { avisados, tentativas, pendentes, motivo: 'erro_leitura' }; }
    if (!linhas.length) break;
    await processar(linhas);
    if (linhas.length < PAGINA) break;
  }

  // Sem id de grupo: UM e-mail de resumo por rodada, nunca um por lead.
  if (semGrupo.length) await emailResumoSemGrupo(semGrupo);
  await fecharEmail();
  if (avisados && !opts.dry) logger.info('solardoc-aviso', `${avisados} desistência(s) do quiz avisada(s) ao grupo`);
  return {
    avisados, tentativas, pendentes, ...(deixados ? { deixadosAoRobo: deixados } : {}),
    ...(opts.dry ? { motivo: 'dry', previa } : {}), ...(encerrar ? { motivo: 'envio_falhou' } : {}),
  };
}
