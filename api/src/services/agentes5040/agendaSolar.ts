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
import { MARCA_QUIZ, MARCA_SAIU, ehCardSaiu, ehCardMudo, semMarcaSaiu } from '../agenda/solarRota';
import { ymdBRT, quandoDoAgora } from '../io/solarQuiz';
import { telKeySolar } from '../io/solarTelefone';
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
  /**
   * Só o card de quem saiu do quiz sem marcar (27/10/2026, solarQuizAviso).
   *  · 'mudo': nenhuma mensagem sai para o cliente. boas_vindas_at, bomdia_at e lembrete_5min_at nascem com agora.
   *  · 'fala': a abertura da Duda é a única mensagem. boas_vindas_at nasce nulo (explícito) e, se o card é de hoje, o bom dia nasce carimbado.
   */
  modo?: 'mudo' | 'fala';
}
/** Caminho da AGENTE: o horário é conferido na hora (livre E dentro da grade da faixa) antes do insert. */
export interface OpcoesGravarAgente {
  faixa: FaixaSolar;
  modo?: undefined;
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
    ...(opts.modo === 'mudo' ? { boas_vindas_at: agoraIso, lembrete_5min_at: agoraIso, bomdia_at: agoraIso }
      : opts.ligarAgora ? { lembrete_5min_at: agoraIso, bomdia_at: agoraIso }
      : (bomDiaJaDado || (opts.modo === 'fala' && ymdBRT(Date.parse(f.quando)) === ymdBRT(agoraMs))) ? { bomdia_at: agoraIso } : {}),
    ...(opts.modo === 'fala' ? { boas_vindas_at: null } : {}),
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

/** 2 horas de minutos ocupados, de 5 em 5. */
export const MAX_ENCAIXES = 24;

export type ResultadoEncaixe<T> =
  | { status: 'ok'; quandoMs: number; valor: T }
  | { status: 'sem_horario' }
  | { status: 'erro'; erro: unknown };

/**
 * O laço do encaixe do "agora" (era de routes/ioSolar.ts, /quiz/agora): tenta o próximo múltiplo de 5 min com 5 min de folga e,
 * se o minuto estava ocupado (índice único (vendedor, quando) recusou, 'horario_tomado'), soma 5 min e tenta de novo, até
 * MAX_ENCAIXES. `tentar` grava (card novo ou update do card existente) e diz o que aconteceu. Agenda nunca bloqueia: o minuto
 * ocupado empurra, não barra.
 */
export async function encaixarAgora<T>(
  agoraMs: number,
  tentar: (quandoMs: number) => Promise<{ status: 'ok'; valor: T } | { status: 'horario_tomado' } | { status: 'erro'; erro: unknown }>,
): Promise<ResultadoEncaixe<T>> {
  for (let encaixe = 0; encaixe < MAX_ENCAIXES; encaixe++) {
    const quandoMs = quandoDoAgora(agoraMs, encaixe);
    const r = await tentar(quandoMs);
    if (r.status === 'ok') return { status: 'ok', quandoMs, valor: r.valor };
    if (r.status === 'erro') return { status: 'erro', erro: r.erro };
  }
  return { status: 'sem_horario' };
}

/** O card do "agora" (ligarAgora) no primeiro minuto livre: o /quiz/agora e o tick do "saiu sem marcar". */
export function gravarCardAgora(
  f: Omit<FichaSolar, 'quando'>, agoraMs: number, opts: { modo?: 'mudo' | 'fala' } = {},
): Promise<ResultadoEncaixe<CardGravado>> {
  return encaixarAgora<CardGravado>(agoraMs, async (quandoMs) => {
    const g = await gravarCardSolar({ ...f, quando: new Date(quandoMs).toISOString() }, { ligarAgora: true, ...(opts.modo ? { modo: opts.modo } : {}) });
    return g.status === 'ok' ? { status: 'ok', valor: g.card } : g;
  });
}

/** Só o card SAIU SEM MARCAR criado há menos disto pode ser cancelado quando o cliente volta e marca. */
const CANCELA_SAIU_ATE_MS = 48 * 3_600_000;

/**
 * O cliente voltou ao quiz, marcou (horário ou "agora") e o card NOVO já nasceu e o lead já aponta para ele: CANCELA todo card
 * `SAIU SEM MARCAR` do mesmo telefone criado nas últimas 48 h, futuro ou passado, de qualquer dono, menos o `exceto` (o card novo).
 * Devolve os ids cancelados. Só mexe em 'agendado' cuja 1ª linha ainda é SAIU SEM MARCAR (card que gente já tocou, ou que virou outro,
 * não é cancelado) e só põe status 'cancelado' (nada de DELETE). Idempotente: rodar de novo não acha nada. Nunca lança (lista vazia se falhar).
 */
export async function cancelarCardsSaiuSemMarcar(alvo: string, exceto?: number): Promise<number[]> {
  try {
    const desde = new Date(Date.now() - CANCELA_SAIU_ATE_MS).toISOString();
    const { data, error } = await supabaseGerador.from('agendamentos')
      .select('id, cliente_telefone, observacao')
      .eq('status', 'agendado').gte('created_at', desde)
      .like('observacao', `${MARCA_SAIU}%`)
      .ilike('cliente_telefone', `%${alvo.slice(-8)}`)
      .limit(20);
    if (error) throw error;
    const ids = ((data ?? []) as Array<Record<string, any>>)
      .filter(a => Number(a.id) !== exceto && telKeySolar(a.cliente_telefone) === alvo && ehCardSaiu(a.observacao)).map(a => Number(a.id));
    if (!ids.length) return [];
    const { data: feitos, error: erroUp } = await supabaseGerador.from('agendamentos')
      .update({ status: 'cancelado' })
      .in('id', ids).eq('status', 'agendado').like('observacao', `${MARCA_SAIU}%`)
      .select('id');
    if (erroUp) throw erroUp;
    return ((feitos ?? []) as Array<Record<string, any>>).map(a => Number(a.id));
  } catch (err) {
    logger.error('agentes5040-agenda-solar', 'cancelar o card do saiu sem marcar falhou', err);
    return [];
  }
}

/**
 * O card SAIU que deveria FALAR e cuja abertura da Duda não saiu (passou dos 15 min sem boas_vindas_at, ou a abertura foi descartada na fila)
 * vira MUDO (chefe anti-ban): 1ª linha `${MARCA_SAIU} · MUDO · LIGAÇÃO` (o resto da observação fica igual) e boas_vindas_at, bomdia_at e
 * lembrete_5min_at carimbados com agora, para a régua do dia também não falar com ele. Só pega card cuja 1ª linha é SAIU e ainda não é MUDO
 * (card que já é MUDO, ou que o cliente marcou depois, não é tocado). true = rebaixou agora. Nunca lança.
 */
export async function rebaixarSaiuAMudo(cardId: number): Promise<boolean> {
  try {
    const { data: card, error: erroLeitura } = await supabaseGerador.from('agendamentos')
      .select('id, observacao').eq('id', cardId).maybeSingle();
    if (erroLeitura) throw erroLeitura;
    if (!card || !ehCardSaiu(card.observacao) || ehCardMudo(card.observacao)) return false;
    const linhas = String(card.observacao ?? '').split('\n');
    // O tipo do imóvel não se perde: sai da 1ª linha (`... SAIU SEM MARCAR · <tipo> · LIGAÇÃO`) para a linha `Onde:`, como no card que nasce MUDO.
    const tipo = linhas[0].split(' · ')[2] || 'Imóvel';
    const agoraIso = new Date().toISOString();
    try {
      // Filtra pela MARCA, não pela observação inteira: quem mexeu no texto no meio do caminho não faz o rebaixamento falhar.
      const { data, error } = await supabaseGerador.from('agendamentos')
        .update({
          observacao: [`${MARCA_SAIU} · MUDO · LIGAÇÃO`, `Onde: ${tipo}`, ...linhas.slice(1)].join('\n').slice(0, 4000),
          boas_vindas_at: agoraIso, bomdia_at: agoraIso, lembrete_5min_at: agoraIso,
        })
        .eq('id', cardId)
        .like('observacao', `${MARCA_SAIU}%`)
        .not('observacao', 'like', `${MARCA_SAIU} · MUDO%`)
        .select('id');
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    } catch (err) {
      // Não rebaixou: ao menos o bom dia e o "oi" de 5 min do dia ficam carimbados. boas_vindas_at fica nulo (quem chamou tenta de novo).
      logger.error('agentes5040-agenda-solar', `rebaixar o card ${cardId} (saiu sem marcar) a MUDO falhou`, err);
      // Só enquanto o card ainda é SAIU: um card que a Duda acabou de desmarcar não pode ter o bom dia e o "oi" calados.
      await supabaseGerador.from('agendamentos').update({ bomdia_at: agoraIso, lembrete_5min_at: agoraIso }).eq('id', cardId)
        .like('observacao', `${MARCA_SAIU}%`).then(undefined, () => undefined);
      return false;
    }
  } catch (err) {
    logger.error('agentes5040-agenda-solar', `rebaixar o card ${cardId} (saiu sem marcar) a MUDO falhou`, err);
    return false;
  }
}

/**
 * A Duda confirmou com o cliente o MESMO horário que o card SAIU SEM MARCAR já tinha (nada foi remarcado): o card deixa de ser SAIU (e MUDO), com a
 * 1ª linha normal; lembrete_5min_at volta a nulo e bomdia_at segue a regra da remarcação (nulo, ou agora se o card é de hoje e são menos de 11h),
 * para a régua da Giovanna falar no dia. boas_vindas_at não é tocado. true = trocou agora (card que não é SAIU: false). Nunca lança.
 */
export async function tirarMarcaSaiuDoCard(cardId: number): Promise<boolean> {
  try {
    const { data: card, error: erroLeitura } = await supabaseGerador.from('agendamentos')
      .select('id, quando, observacao, boas_vindas_at').eq('id', cardId).maybeSingle();
    if (erroLeitura) throw erroLeitura;
    if (!card || !ehCardSaiu(card.observacao)) return false;
    const agora = Date.now();
    const hojeAntesDas11 = ymdBRT(Date.parse(String(card.quando ?? ''))) === ymdBRT(agora) && new Date(agora - 3 * 3_600_000).getUTCHours() < 11;
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({
        observacao: semMarcaSaiu(card.observacao), lembrete_5min_at: null, bomdia_at: hojeAntesDas11 ? new Date(agora).toISOString() : null,
        // A Duda já falou com o cliente (é ela quem chama esta função): sem carimbo, a abertura da agenda mandaria um 2º "Ficou marcado".
        boas_vindas_at: card.boas_vindas_at ?? new Date(agora).toISOString(),
      })
      .eq('id', cardId).like('observacao', `${MARCA_SAIU}%`)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    logger.error('agentes5040-agenda-solar', `tirar a marca SAIU do card ${cardId} falhou`, err);
    return false;
  }
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
      .select('id, quando, vendedor_nome, status, historico, observacao, boas_vindas_at').eq('id', cardId).maybeSingle();
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
        // 27/10/2026: o card SAIU SEM MARCAR que o cliente combinou com a Duda deixa de ser SAIU (e MUDO): 1ª linha normal, no MESMO update.
        // boas_vindas_at: quem já tem carimbo fica com ele; o que estava nulo (a abertura pulada) é carimbado agora, porque a Duda JÁ confirmou
        // o horário com o cliente na conversa, e a abertura/confirmação da agenda (vivo.ts) não pode mandar um 2º "Ficou marcado".
        ...(ehCardSaiu(card.observacao) ? { observacao: semMarcaSaiu(card.observacao), boas_vindas_at: card.boas_vindas_at ?? new Date(agora).toISOString() } : {}),
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
