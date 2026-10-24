// ─────────────────────────────────────────────────────────────────────────────
// A AGENDA DO SOLAR PARA A DUDA E PARA O QUIZ (B1d-1, 21/10/2026). AS ESCRITAS.
//
// · gravarCardSolar: o insert do card `lp_solar` que antes morava dentro de routes/ioSolar.ts
//   (/quiz/agendar). Agora é UMA função, usada pela rota do quiz (comportamento idêntico) e pela
//   agente. Sem opções, faz exatamente o que a rota fazia: mesmos campos, created_by lp_solar,
//   o 23505 do índice (vendedor, quando) vira 'horario_tomado'. Com `faixa` (caminho da agente) o horário
//   é conferido na hora (livre e dentro da grade) e as boas-vindas nascem nulas.
// · marcarBoasVindasEnviada: o carimbo das boas-vindas, que o vivo grava DEPOIS que a confirmação saiu.
// · remarcarCardSolar: UPDATE do MESMO card (nunca card novo), só de card 'agendado' ou 'nao_atendeu', com o
//   horário dentro da grade da faixa de remarcação. Zera bomdia_at e lembrete_5min_at para a régua do bom dia
//   e do "oi" de 5 min falar no dia novo (molde: reagendaSolarNaoAtendido.ts) e deixa a linha no historico.
//
// A leitura (vagasSolar, aindaLivreSolar, consultoraDaFaixa) mora em agendaSolarVagas.ts, que o
// contexto.ts importa; este arquivo escreve em `agendamentos` e por isso NÃO pode entrar no percurso do
// ensaio (agentes5040Isolamento.test.ts). Nada aqui envia mensagem nem importa módulo de envio.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { MARCA_QUIZ } from '../agenda/solarRota';
import { ymdBRT } from '../io/solarQuiz';
import { aindaLivreSolar, vagasSolar, type FaixaSolar } from './agendaSolarVagas';

export { vagasSolar, consultoraDaFaixa, aindaLivreSolar, type FaixaSolar } from './agendaSolarVagas';

/** O que o card leva. `observacao` e as UTMs já vêm prontas de quem chama. */
export interface FichaSolar {
  dono: string;
  /** ISO. */
  quando: string;
  nome: string;
  tel: string;
  cidade: string | null;
  observacao: string;
  /** Já validado por quem chama (a rota confere o formato); null = sem src. */
  src?: string | null;
  utm?: Record<string, string>;
  /** Só a sonda do quiz (24/10/2026): 'lp_solar_teste' nasce com tudo carimbado e é cancelada logo depois. Padrão: 'lp_solar'. */
  createdBy?: 'lp_solar' | 'lp_solar_teste';
}

/** Caminho da rota do quiz: nada é conferido aqui (a rota já leu a agenda na hora). */
export interface OpcoesGravarSolar {
  faixa?: undefined;
  /** Ver OpcoesGravarAgente.ligarAgora. */
  ligarAgora?: boolean;
}
/** Caminho da AGENTE: o horário é conferido na hora (livre E dentro da grade da faixa) antes do insert. */
export interface OpcoesGravarAgente {
  faixa: FaixaSolar;
  /**
   * "Ela te liga agora": o card nasce com lembrete_5min_at e bomdia_at já preenchidos (agora), para o lembrete
   * de 5 min e o bom dia do solarAgendaGiovanna não saírem por cima do aviso.
   */
  ligarAgora?: boolean;
}

export type CardGravado = { id: number } & Record<string, any>;
export type ResultadoGravarSolar =
  | { status: 'ok'; card: CardGravado }
  | { status: 'horario_tomado' }
  | { status: 'erro'; erro: unknown };
export type ResultadoGravarAgente = ResultadoGravarSolar | { status: 'horario_fora_da_grade' };

/** O mesmo select que a rota usa: o aviso à equipe (avisoDaEquipe) e a ficha leem estes campos. */
const COLUNAS_DO_CARD = 'id, vendedor_nome, quando, cliente_nome, cliente_telefone, observacao, utm_source, utm_campaign';

/** A primeira linha da observação tem que começar com a MARCA_QUIZ: é por ela que caminhoDaFicha e
 *  ocupacaoDaFichaSolar reconhecem o card. A do quiz já vem assim; a da agente ganha uma linha de ligação. */
const comMarca = (obs: string): string =>
  String(obs ?? '').split('\n')[0].toUpperCase().startsWith(MARCA_QUIZ) ? obs : `${MARCA_QUIZ} · LIGAÇÃO\n${obs ?? ''}`;

/** Pede a lista inteira que a faixa oferece (DIAS_VARRIDOS dias) para conferir se o horário está nela. */
const TODAS_AS_VAGAS = 1000;

/**
 * Confere AGORA, para o dono e a faixa, se o horário está livre e é um dos que a grade oferece.
 * `ignorarIso` = o card que está sendo remarcado (o horário antigo dele não conta como ocupado).
 */
async function conferirHorario(
  iso: string, dono: string, faixa: FaixaSolar, ignorarIso?: string | null,
): Promise<'ok' | 'horario_tomado' | 'horario_fora_da_grade' | 'erro'> {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'horario_fora_da_grade';
  const livre = await aindaLivreSolar(iso, dono, { ignorarIso });
  if (livre === null) return 'erro';
  if (!livre) return 'horario_tomado';
  const vagas = await vagasSolar({ dono, caminho: 'ligacao', n: TODAS_AS_VAGAS, agora: Date.now(), faixa, ignorarIso });
  if (vagas === null) return 'erro';
  return vagas.some(v => Date.parse(v) === t) ? 'ok' : 'horario_fora_da_grade';
}

export async function gravarCardSolar(f: FichaSolar, opts: OpcoesGravarAgente): Promise<ResultadoGravarAgente>;
export async function gravarCardSolar(f: FichaSolar, opts?: OpcoesGravarSolar): Promise<ResultadoGravarSolar>;
export async function gravarCardSolar(
  f: FichaSolar, opts: OpcoesGravarSolar | OpcoesGravarAgente = {},
): Promise<ResultadoGravarAgente> {
  const faixa = opts.faixa;
  if (faixa) {
    const conf = await conferirHorario(f.quando, f.dono, faixa);
    if (conf === 'erro') return { status: 'erro', erro: new Error('não deu para conferir a agenda') };
    if (conf !== 'ok') return { status: conf };
  }
  const agoraMs = Date.now();
  const agoraIso = new Date(agoraMs).toISOString();
  // Caminho da agente: card de HOJE criado antes das 11h (Brasília) já nasce com o bom dia carimbado. A janela do bom dia
  // (7h às 11h, solarAgendaGiovanna) está aberta e ele sairia por cima da confirmação. A rota do quiz não entra aqui.
  const bomDiaJaDado = !!faixa && ymdBRT(Date.parse(f.quando)) === ymdBRT(agoraMs) && new Date(agoraMs - 3 * 3_600_000).getUTCHours() < 11;
  const { data, error } = await supabaseGerador.from('agendamentos').insert({
    vendedor_nome: f.dono,
    quando: f.quando,
    cliente_nome: f.nome,
    cliente_telefone: f.tel,
    cidade: f.cidade,
    status: 'agendado',
    observacao: comMarca(f.observacao).slice(0, 4000),
    created_by: f.createdBy === 'lp_solar_teste' ? 'lp_solar_teste' : 'lp_solar',
    ...(f.src ? { src: f.src } : {}),
    ...(f.utm ?? {}),
    // Da agente as boas-vindas nascem NULAS: quem carimba é marcarBoasVindasEnviada, depois que a confirmação saiu.
    ...(faixa ? { boas_vindas_at: null } : {}),
    ...(opts.ligarAgora ? { lembrete_5min_at: agoraIso, bomdia_at: agoraIso } : bomDiaJaDado ? { bomdia_at: agoraIso } : {}),
    // A sonda não pode receber nada: as boas-vindas nascem carimbadas.
    ...(f.createdBy === 'lp_solar_teste' ? { boas_vindas_at: agoraIso, lembrete_5min_at: agoraIso, bomdia_at: agoraIso } : {}),
  }).select(COLUNAS_DO_CARD).single();
  if (error) {
    // 23505 = o índice (vendedor, quando) recusou: alguém marcou no mesmo instante.
    if ((error as { code?: string }).code === '23505') return { status: 'horario_tomado' };
    return { status: 'erro', erro: error };
  }
  return { status: 'ok', card: data as CardGravado };
}

/**
 * Carimba as boas-vindas como enviadas, DEPOIS que a confirmação saiu. Só pega card ainda nulo: quem já foi
 * carimbado (pelo fluxo antigo ou por uma chamada anterior) não muda. true = carimbou agora.
 */
export async function marcarBoasVindasEnviada(cardId: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({ boas_vindas_at: new Date().toISOString() })
      .eq('id', cardId)
      .is('boas_vindas_at', null)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    logger.error('agentes5040-agenda-solar', `carimbar as boas-vindas do card ${cardId} falhou`, err);
    return false;
  }
}

/**
 * A RESERVA das boas-vindas da abertura do quiz: grava boas_vindas_at SÓ se ainda estiver vazio (o mesmo UPDATE ... IS NULL do
 * reservarFicha do solarBoasVindas, que é o que impede o tick antigo de mandar as boas-vindas por cima). 'reservada' = foi esta
 * chamada que gravou; 'perdeu' = outra rodada pegou antes ou o card sumiu; 'erro' = o banco falhou (nada a desfazer garantido: quem
 * chama tenta devolver pelo carimbo). Nunca lança.
 */
export async function reservarBoasVindas(cardId: number, emIso: string): Promise<'reservada' | 'perdeu' | 'erro'> {
  try {
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({ boas_vindas_at: emIso })
      .eq('id', cardId)
      .is('boas_vindas_at', null)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0 ? 'reservada' : 'perdeu';
  } catch (err) {
    logger.error('agentes5040-agenda-solar', `reservar as boas-vindas do card ${cardId} falhou`, err);
    return 'erro';
  }
}

/** Devolve a reserva, mas só a desta chamada (confere o carimbo `emIso`). Duas tentativas. true = devolveu (ou não havia o que devolver). */
export async function devolverBoasVindas(cardId: number, emIso: string): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const { error } = await supabaseGerador.from('agendamentos')
        .update({ boas_vindas_at: null })
        .eq('id', cardId)
        .eq('boas_vindas_at', emIso);
      if (!error) return true;
    } catch { /* tenta de novo */ }
  }
  logger.error('agentes5040-agenda-solar', `A ABERTURA NÃO SAIU E O CARD ${cardId} FICOU COM AS BOAS-VINDAS MARCADAS, desmarcar na mão`);
  return false;
}

/**
 * "Ligar agora" em card que JÁ existia: o lembrete de 5 min e o bom dia saem do ar (lembrete_5min_at e bomdia_at = agora),
 * senão sairiam por cima do aviso à consultora. true SÓ se o banco devolveu a linha atualizada. Nunca lança.
 */
export async function silenciarLembretesDoCard(cardId: number): Promise<boolean> {
  try {
    const agoraIso = new Date().toISOString();
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({ lembrete_5min_at: agoraIso, bomdia_at: agoraIso })
      .eq('id', cardId)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    logger.error('agentes5040-agenda-solar', `silenciar os lembretes do card ${cardId} falhou`, err);
    return false;
  }
}

export type ResultadoRemarcarSolar =
  | 'ok' | 'horario_tomado' | 'horario_fora_da_grade' | 'status_nao_permite' | 'nao_achou' | 'erro';

/** Só estes dois status podem ser remarcados pela agente; os demais (negociação, vendido, etc.) são de gente. */
const STATUS_REMARCAVEIS = ['agendado', 'nao_atendeu'];

const TZ = 'America/Sao_Paulo';
const horaBonita = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', '');

/** A linha do historico, no formato de reagendaSolarNaoAtendido.linhaDoHistorico: "[dd/mm · hh:mm · Sistema] 🔁 ...".
 *  Não casa o regex de vermelhasNoHistorico ("Remarcação automática N/M: não atendeu em"), então não conta como volta. */
function linhaDaRemarcacao(deIso: string, paraIso: string): string {
  const carimbo = new Date().toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', ' ·');
  return `[${carimbo} · Sistema] 🔁 Remarcação pela agente (Duda): a ligação de ${horaBonita(deIso)} `
    + `passou para ${horaBonita(paraIso)}, a pedido do cliente, com o mesmo consultor.`;
}

/**
 * Remarca o MESMO card: quando novo e status 'agendado' (o 'nao_atendeu' volta pra 'agendado'), com a linha no
 * historico. Só mexe em card 'agendado' ou 'nao_atendeu'; outro status = 'status_nao_permite', sem gravar. O horário
 * novo tem que estar livre (sem contar o próprio card) e ser um dos da faixa (padrão 'remarcacao', :15/:45), lido
 * na hora. O UPDATE só pega a linha se horário E status continuam os que foram lidos: quem mexeu no card no meio do
 * caminho, manda.
 *
 * bomdia_at e lembrete_5min_at voltam a nulo para a régua falar no dia novo, EXCETO remarcação para HOJE com a hora
 * de agora antes das 11h (Brasília): a janela do bom dia (7h às 11h, solarAgendaGiovanna) está aberta e ele sairia
 * por cima da confirmação, então bomdia_at já nasce com a hora de agora.
 */
export async function remarcarCardSolar(
  cardId: number, novoIso: string, opts: { faixa?: FaixaSolar } = {},
): Promise<ResultadoRemarcarSolar> {
  try {
    const { data: card, error: erroLeitura } = await supabaseGerador.from('agendamentos')
      .select('id, quando, vendedor_nome, status, historico').eq('id', cardId).maybeSingle();
    if (erroLeitura) throw erroLeitura;
    if (!card) return 'nao_achou';
    const lido = String(card.quando ?? '');
    const dono = String(card.vendedor_nome ?? '');
    const statusLido = String(card.status ?? '');
    if (!lido || !dono) return 'nao_achou';
    if (!STATUS_REMARCAVEIS.includes(statusLido)) return 'status_nao_permite';
    const conf = await conferirHorario(novoIso, dono, opts.faixa ?? 'remarcacao', lido);
    if (conf === 'erro') return 'erro';
    if (conf !== 'ok') return conf;

    const agora = Date.now();
    const horaBRT = new Date(agora - 3 * 3_600_000).getUTCHours();   // Brasília é UTC-3 cheio
    const hojeAntesDas11 = ymdBRT(Date.parse(novoIso)) === ymdBRT(agora) && horaBRT < 11;
    const linha = linhaDaRemarcacao(lido, novoIso);
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({
        quando: novoIso,
        status: 'agendado',
        bomdia_at: hojeAntesDas11 ? new Date(agora).toISOString() : null,
        lembrete_5min_at: null,
        historico: card.historico ? `${linha}\n\n${card.historico}` : linha,
      })
      .eq('id', cardId)
      .eq('quando', lido)
      .eq('status', statusLido)
      .select('id');
    if (error) {
      if ((error as { code?: string }).code === '23505') return 'horario_tomado';
      throw error;
    }
    return Array.isArray(data) && data.length ? 'ok' : 'nao_achou';
  } catch (err) {
    logger.error('agentes5040-agenda-solar', `remarcar o card ${cardId} falhou`, err);
    return 'erro';
  }
}
