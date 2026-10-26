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
//   - O tick SEGURA o lead para o robô só enquanto TRÊS coisas valem juntas (B2.1, 26/10/2026): o robô está ligado, a linha está dentro da
//     janela AGORA (9h às 20h, segunda a sábado) e o lead tem menos de 60 min. Segurado não gasta a conta das avaliações. O aviso sai pelo
//     caminho do robô ("A Carla falou às HH:MM", pendente, enviado por este tick no cartão).
//   - Fora disso o tick avisa JÁ, com uma linha de status: "A Carla chama no próximo horário da linha, de segunda a sábado, das 9h às 20h."
//     (linha fechada), "A Carla ainda não teve vaga para chamar." (60 min sem ela, linha aberta), a linha de motivo ("A Carla não vai
//     chamar: ainda sem CNPJ.", "A Carla está desligada agora.") ou o vencimento (48 h a 50 h, "A Carla não chamou: passou de 48 horas sem vaga.").
//     Depois do aviso de status a Carla ainda pode mandar a mensagem dela (marca quiz_rec_ainda), mas NÃO sai um segundo aviso: o claim vale.
//   - A Carla chamou (carimbo quiz_rec_sent) e o aviso dela não chegou a ser tomado por 5 min (o robô caiu depois do envio): este tick toma.
//     Carimbo com estado 'nao_saiu' (o sendFrio calou: nada foi enviado) é avisado na hora, com o motivo, nunca com "falou às".
//   - Antes de avisar, o tick RELÊ o carimbo do lead (a corrida com a rodada do robô): se a Carla acabou de chamar, o aviso é dela.
//
// LEITURA: do mais novo para o mais antigo, em páginas de 100, pulando quem já tem claim. Com o robô ligado, uma leitura à parte vai
// primeiro nos que acabaram de vencer (48 h a 50 h): os novos, que vêm primeiro, não deixam o vencido sem aviso.
//
// LIMITE: 10 TENTATIVAS por rodada (toda chamada ao aviso conta), no máximo 12 leads avaliados com leitura por rodada (as conferências
// sem banco e o lead segurado para o robô não gastam essa conta), e o primeiro
// `falhou` encerra a rodada. Sem id de grupo, no máximo UM e-mail de resumo por rodada.
//
// Quem chama o relógio: o `/process-messages`, DEPOIS do allSettled dos outros ticks e ANTES do robô da Carla (routes/cron.ts): o aviso
// que o robô acaba de deixar pendente só pode sair na rodada seguinte. A rota `/solar-agente?dry=1` confere sem gravar.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { normalizarTelefoneSd, chaveDoTelefone } from './quizSolardoc';
import { dentroDaJanelaDaBaseLinha } from '../agents/whatsapp/lineThrottle';
import { montarAviso } from './avisoGrupoTextos';
import {
  avisarDesistencia, camposDoLead, campoDe, descarregarPendentes, ehLeadDeTeste, emailResumoSemGrupo, emailResumoParada, marcarComprou,
  paradaDoGrupo, PREFIXO_CLAIM_QUIZ, type LeadQuizLinha, type ParadaDoGrupo,
} from './avisoGrupoSolardoc';
import { hmacDe } from '../agentes5040/hmac';
import { lerPosse } from '../agentes5040/posse';
import { comprouLead, temPlanoPago, vendasRecentes } from './compraQuizSolardoc';
import { avaliarLead, depsAvaliarReais, type DepsAvaliar } from './recuperacaoCarla';
import { estadoRecuperacaoCarla, lerLargada, type EstadoRecuperacao } from './recuperacaoCarlaEstado';
import {
  ESPERA_MIN_MS, FRASE_DO_MOTIVO, FRASE_FORA_DA_JANELA, FRASE_NAO_CONFERIU, FRASE_NAO_CONFIRMOU_ENVIO, FRASE_SEM_VAGA_AINDA, JANELA_LEITURA_COM_ROBO_MS, JANELA_MAX_MS,
  PREFIXO_AINDA_REC, PREFIXO_CARIMBO_REC, SEGURA_PARA_O_ROBO_MS, horaBRT, motivoSemBanco,
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

/** O que o carimbo `quiz_rec_sent` diz sobre o aviso: 'deixar' = é do robô (ele acabou de chamar); senão a hora ou o motivo. */
function decidirPeloCarimbo(c: CarimboRec, agora: number): 'deixar' | { hora: string | null; motivo: string | null } {
  // O robô calou (pausa humana) e nada saiu: ele não avisa, então o tick avisa na hora, com o motivo.
  if (c.value?.estado === 'nao_saiu') return { hora: null, motivo: FRASE_DO_MOTIVO.nao_saiu };
  // O carimbo existe: o robô reivindicou o lead. O aviso é dele; só assume se ele não o tomou em 5 min (caiu depois do envio).
  const quando = Date.parse(String(c.updated_at ?? ''));
  if (!Number.isFinite(quando) || agora - quando < AVISO_DO_ROBO_ATRASADO_MS) return 'deixar';
  if (c.value?.estado === 'incerto') return { hora: null, motivo: 'A Carla tentou chamar, mas não sei se a mensagem saiu.' };
  // "Falou às" só com envio provado (B2.2): o estado 'enviado' tem que estar escrito. Carimbo sem estado (o robô caiu antes de gravar, ou a
  // gravação do estado falhou) ou com estado desconhecido nunca vira "falou às" nem "não saiu": o aviso diz que não deu para confirmar.
  if (c.value?.estado !== 'enviado') return { hora: null, motivo: FRASE_NAO_CONFIRMOU_ENVIO };
  return { hora: horaBRT(quando), motivo: null };
}

/** Relê o carimbo de UM lead (a rodada do robô pode ter chamado depois da leitura da página). 'erro' = não deu para ler: pula o lead. */
async function lerCarimbo(h: string): Promise<CarimboRec | null | 'erro'> {
  try {
    const { data, error } = await supabase.from('system_state').select('key, updated_at, value').eq('key', `${PREFIXO_CARIMBO_REC}${h}`).maybeSingle();
    if (error) return 'erro';
    return (data as CarimboRec | null) ?? null;
  } catch { return 'erro'; }
}

/** Marca "avisei o time, mas a Carla ainda pode chamar". Já existir (23505) vale. false = não gravou: o lead não é avisado nesta rodada. */
async function marcarAindaChama(h: string): Promise<boolean> {
  try {
    const em = new Date().toISOString();
    const { error } = await supabase.from('system_state').insert({ key: `${PREFIXO_AINDA_REC}${h}`, value: { em }, updated_at: em });
    return !error || (error as { code?: string }).code === '23505';
  } catch { return false; }
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

  // A janela da linha vale para a rodada inteira (9h às 20h, segunda a sábado, fora de feriado): é o que segura o lead para o robô.
  const janelaAberta = dentroDaJanelaDaBaseLinha(new Date(agora));

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

      // Quem avisa este lead? (a decisão por lead do B2, regra de B2.1)
      let hora: string | null = null;
      let motivo: string | null = null;
      let aindaChama = false;   // o aviso é de status e a Carla ainda pode chamar: grava a marca antes
      let conferirPosse = false;   // o motivo é `posse`: confere de quem é antes de dizer "outra agente"
      const criado = Date.parse(String(l.created_time ?? '')) || agora;
      const idade = agora - criado;
      if (!estado.ligada) {
        motivo = FRASE_DO_MOTIVO.desligada;
      } else {
        const chamado = chamados.get(h);
        if (chamado) {
          const dec = decidirPeloCarimbo(chamado, agora);
          if (dec === 'deixar') { deixados++; continue; }
          ({ hora, motivo } = dec);
        } else {
          // 1) o que não lê banco (sem CNPJ, antes da largada): avisa já e não gasta a conta
          const semBanco = motivoSemBanco(l, largada);
          if (semBanco) {
            motivo = FRASE_DO_MOTIVO[semBanco];
          } else if (janelaAberta && idade < SEGURA_PARA_O_ROBO_MS) {
            // 2) segurado para o robô (ligado + janela aberta agora + menos de 60 min): não gasta a conta
            deixados++; continue;
          } else {
            // 3) o resto gasta a conta de avaliações por rodada
            if (avaliados >= AVALIACOES_POR_RODADA) continue;
            avaliados++;
            const av = await avaliarLead(l, { agoraMs: agora, largadaMs: largada, vendas }, depsAvaliacao);
            if (!av.ok) {
              // Teste, sem telefone e compra não geram aviso. O resto: a Carla não vai chamar, com o motivo.
              if (av.motivo === 'teste' || av.motivo === 'sem_telefone' || av.motivo === 'comprou') continue;
              // Leitura que falhou não é motivo: enquanto valem as 3 condições do segurar (robô ligado, janela aberta agora e menos de 60 min),
              // não toma o claim e tenta de novo na próxima rodada. Depois disso vale o teto universal (B2.2): o time é avisado.
              if (av.motivo === 'leitura_falhou') {
                if (idade > JANELA_MAX_MS) motivo = FRASE_DO_MOTIVO.vencido;   // já venceu: avisa, a Carla não vai mais chamar
                else if (janelaAberta && idade < SEGURA_PARA_O_ROBO_MS) { deixados++; continue; }
                else motivo = FRASE_NAO_CONFERIU;
              } else {
                motivo = FRASE_DO_MOTIVO[av.motivo];
                conferirPosse = av.motivo === 'posse';
              }
            } else if (idade > JANELA_MAX_MS) {
              motivo = FRASE_DO_MOTIVO.vencido;
            } else {
              // A Carla ainda pode chamar e o tick não segura: avisa o time já, com a linha de status.
              motivo = janelaAberta ? FRASE_SEM_VAGA_AINDA : FRASE_FORA_DA_JANELA;
              aindaChama = true;
            }
          }
          // Corrida com a rodada do robô: a leitura da página é anterior à avaliação. Relê o carimbo antes de avisar. Se a Carla acabou
          // de chamar (o robô grava o carimbo ANTES de tomar a posse), o aviso é dela, nunca "outra agente" nem "chama no próximo horário".
          const rec = await lerCarimbo(h);
          // Carimbo que não lê: segura só enquanto valem as 3 condições do segurar; depois avisa (teto universal, B2.2) com o motivo já decidido.
          if (rec === 'erro') {
            if (janelaAberta && idade < SEGURA_PARA_O_ROBO_MS) { deixados++; continue; }
            if (aindaChama) motivo = FRASE_NAO_CONFERIU;   // sem ler o carimbo não dá para afirmar "ainda não teve vaga": a Carla pode ter acabado de chamar
          }
          else if (rec) {
            const dec = decidirPeloCarimbo(rec, agora);
            if (dec === 'deixar') { deixados++; continue; }
            ({ hora, motivo } = dec); aindaChama = false; conferirPosse = false;
          }
          // Posse não é sempre "outra agente": a própria Carla (conversa que ela abriu com o lead) é a Carla, e posse que sumiu entre a
          // avaliação e agora é a rodada do robô que desistiu (sem aviso e sem claim; refaz na próxima rodada).
          if (conferirPosse) {
            let posse: Awaited<ReturnType<typeof lerPosse>>;
            try { posse = await lerPosse(String(l.whatsapp)); } catch { continue; }
            if (!posse) continue;
            if (posse.dona === 'carla' && posse.estado === 'viva') motivo = FRASE_DO_MOTIVO.ja_falou;
          }
        }
      }
      if (aindaChama && !opts.dry && !(await marcarAindaChama(h))) continue;

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
