// ─────────────────────────────────────────────────────────────────────────────
// A RODADA VIVA DAS AGENTES DA 5040 (Fase B, B1c-3). Roda de 2 em 2 minutos (cron próprio) e responde,
// DE VERDADE, só as conversas que têm posse viva de uma agente ligada e no escopo (agenteAtendeEste).
//
// Este arquivo NÃO importa o zapiClient. Só alcança o envio por dois lugares: vivoEnvio.ts (a fala ao lead,
// com todas as condições do chefe-antiban) e fichaEnvio.ts (a ficha ao consultor).
//
// A Duda, a Helena (B2, eletroposto) e a Carla (B3b, SolarDoc) respondem. As regras da Helena (ordem com o ep_respostas, quem
// cala, o card sem card) moram em helenaEp.ts e rodam ANTES da IA. A Carla (carlaVivo.ts): lead que JÁ tem conta = a posse
// dela fecha (estado encerrada) antes da IA e a Giovanna atende pelo caminho de hoje; a peça (assinatura, Pix, avulso,
// depoimento) sai do peca.id pela peça única do vivoEnvio; prometer_planilha só registra o direito (planilhaBonus).
//
// Rodada, na ordem:
//   · nenhuma dona da rodada ligada: sai, e a única leitura foi a do interruptor (cache de 60 s);
//   · trava única ag5040_vivo_lock (validade de 300 s pelo updated_at, compare-and-set: insert, e update
//     condicional no 23505 se a trava expirou), com um TOKEN aleatório no value: quem solta casa pelo token
//     (um gatilho que reescreva updated_at não prende a trava); o dry não trava;
//   · prazo de envio de 110 s: nenhuma chamada ao modelo nem envio começa depois dele;
//   · candidatas = última fala do lead na última hora; posse viva de dona ligada e no escopo; a fala é
//     posterior à posse (ate_wa_id; sem ele, âncora em posse.desde com folga de 15 min: a porta grava desde =
//     momento da mensagem - 60 s, e o prazo de 15 min do envio mais o "qualquer from_me depois da fala tira da
//     fila" seguram fala velha); QUALQUER mensagem
//     nossa (robô antigo, humano no celular ou a própria agente) depois da fala do lead tira a conversa da
//     fila e só atualiza ate_wa_id; rajada de 45 s; prazo de 15 min; no máximo 3 conversas por rodada;
//   · por conversa: vez PRÓPRIA ag5040_vez_vivo:<waId> (o ensaio sombra usa ag5040_vez:<waId> e pula conversa
//     com posse viva; assim uma vez reservada pelo ensaio, antes da posse, não prende a rodada viva), contexto,
//     pensarTurno (trava da Fase A), RELEITURA do último id antes de qualquer saída (chegou fala nova = solta
//     a vez e tenta na próxima), e então:
//        - fala comum: enviarResposta (1 bolha, peça de link ou Pix na 2ª chamada);
//        - ação que exige ferramenta (marcar, ligar agora, suporte, passar): ficha ao consultor e, SÓ se a
//          ficha saiu, uma bolha fixa dizendo que a consultora vai falar (a de agenda para marcar/remarcar, a
//          genérica para o resto); a bolha do modelo nunca vai (ela
//          prometeria o que ninguém fez); estado passou_humano;
//        - não incomodar: estado nao_incomodar, despedida pelo enviarResposta e SÓ DEPOIS o silenciarContato
//          (silenciado antes, o enviarResposta recusaria a despedida como 'mudo'). O estado é gravado ANTES da
//          despedida de propósito (cala do lado seguro) e a despedida recusada não é tentada de novo;
//        - 10 respostas na posse, 3ª falha de IA, trava sem fala segura, bolha inválida, ou fala que passou de
//          15 min: passou_humano com ficha (sem bolha quando passou de 15 min); 'pediu_humano' (supressão do
//          telefone): ficha, SEM bolha; 'erro_linha' PARA a rodada inteira.
//   · Pausa humana (pacote 2b): depois da rajada e ANTES de qualquer regra ou modelo, a mesma checagem do vivoEnvio (podeFalarComLead,
//     com o telefone resolvido). Em pausa: só marca ate_wa_id, nada de modelo nem de ficha (puladas.pausa_humana).
//   · B1d-2c, SÓ a Duda: marcar_horario (card novo ou remarca o MESMO card; a bolha do turno confirma; recusa = fila de agenda),
//     ligar_agora (ficha com reserva própria ANTES da bolha; ficha que não saiu desfaz o card e chama a IA de novo),
//     suporte_giovanna (ficha à Giovanna) e, no fim de cada rodada, a volta honesta do ligar agora, o reenvio do suporte ao
//     dono (a fila de agenda tem rota e relógio próprios: agendaEnvio.runAgendaTick). As peças puras moram em acoesVivo.ts. Depois que o card foi escrito
//     ou a ficha saiu, nenhuma saída solta a vez (repetir a fala gravaria outro card ou mandaria outra ficha).
//   · B1d-3, a ABERTURA do card do quiz solar (abrirCardsDoQuiz, no começo da rodada, só com a Duda ligada, SEM IA): card lp_solar com a
//     marca do quiz, status agendado, `quando`, sem boas_vindas_at, criado há até 10 min, das 7h às 21h (Brasília), lead no escopo da
//     Duda e SEM posse de ninguém. No máximo 3 por rodada. Ordem: monta e valida a bolha fixa (textosAgenda, até 160) > reserva
//     boas_vindas_at (UPDATE ... IS NULL) > assume a posse da Duda > enfileira o tipo `abertura` da fila de agenda (quem ENTREGA é
//     o agendaEnvio.ts, com a janela, a pausa humana e os 10 s). Só se a fila NÃO gravou, devolve a reserva e desfaz a posse criada
//     agora; depois de enfileirado nada desfaz. Bolha que não cabe nos 160 = nada reservado, e o tick antigo manda depois dos 15 min.
//   · envio ok = atualizarPosse({ate_wa_id, respostas + 1}) e gravarTurno (origem 'vivo', campo enviado).
//   · dry: faz tudo, menos reservar, enviar, atualizar a posse, gravar e mandar ficha. Respeita o interruptor
//     e o escopo (é a sonda do que a rodada viva faria), e passa dry:true ao enviarResposta, que roda todas as
//     condições e devolve 'dry' como veredito.
//
// Telefone cru nunca vai para log, chave de system_state nem relatório: relatório leva hmac8, ids e contagens.
// O número de ENVIO sai de wa_mensagens (ou do mapa de LID), nunca da chave da posse (ela perdeu o nono dígito).
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from '../../utils/anthropicClient';
import { chaveContato, silenciarContato } from '../agents/whatsapp/silenciar';
import { podeFalarComLead } from '../agents/whatsapp/pausaHumana';
import {
  acharVaga, alvoDaAgenda, BOLHA_ORCAMENTO_ESCRITO, bolhaLigarAgoraOk, cardSolarDe, citaAHora, dadosDoLeadParaFicha, desfazerCardSolar,
  destinoDaRecusa, horariosPorExtenso, kwhDoLead, lerCardParaFicha, linhasDoOrcamentoEscrito, observacaoDoCardDaDuda, ofertaDeHorarios,
  primeiroNome, situacaoDoCard, topoDoOrcamentoEscrito, type Oferta,
} from './acoesVivo';
import { avisosDaCarla, planejarCarla, type PlanoCarla } from './carlaVivo';
import { juntarBase, lerBaseDaPosse, pareceOptOut, patchDoEstacionar, pedeParaPararDeReceber, planejarEstacionar, type PlanoEstacionar } from './baseRegras';
import { bolhaDeConfirmacao, chaveFila, enfileirarAgenda, type TipoAgenda } from './agendaEnvio';
import { devolverBoasVindas, gravarCardSolar, marcarBoasVindasEnviada, remarcarCardSolar, reservarBoasVindas, silenciarLembretesDoCard, tirarMarcaSaiuDoCard } from './agendaSolar';
import { gravarMidiaCache, gravarTurno, lerMidiaCache, lerTurnos, type TurnoGravado } from './armazem';
import { lerCards, lerConversa, montarContexto } from './contexto';
import { clienteComCota, disjuntorAberto, liberarChave, reservarChave, type EstadoCota } from './cota';
import { anuncioDaMensagem } from './anuncioDoLead';
import { lerCandidatas, ultimoBlocoDoLead, type Candidata } from './ensaio';
import {
  blocoSeguro, fichaDeCampos, montarFicha, produtoDoCard, quandoBR, textoDaMensagem, type CardDaFicha,
} from './ficha';
import {
  carregarTelefonesConsultores, enviarFichaAoConsultor, erroProvaQueNaoSaiu, leadEhDeTeste, linhaIoEmCooldown, telefoneDoConsultor,
  telefoneDoDono, tetoDaLinhaPermiteFicha,
} from './fichaEnvio';
import { hmacDe } from './hmac';
import { contarErroDaLinha, espacamentoDoEnvio, linhaLivre, zerarErrosDaLinha } from './guardaDaLinha';
import { motivoDePassagem } from './passagemPorRegra';
import {
  PREFIXO_PRESENCA, acharVagaEp, aindaLivreEp, bolhaCardCriado, bolhaPresencaAnotada, bolhaSemDetalhe, cardResumoDe, consultorDoCardNovo,
  CONSULTORES_EP, fichaDoCardEp, funcoesEp, gravarCardSeNaoHouver, pendenciaEpDevida, provaDaPresenca, regrasDaHelena, situacaoDaConfirmacao,
  pedeRemarcar, vagasDoConsultor, violacaoDaBolha, type EpMarcou, type Veredicto,
} from './helenaEp';
import type { ClienteIA } from './ia';
import type { DonaViva } from './interruptores';
import { ehMidia } from './midia';
import { agenteAtendeEste, assumirPosse, atualizarPosse, desfazerPosseNova, lerPosse, type DadosPosse } from './posse';
import { DONAS_NA_RODADA, donasDaRodadaLigadas } from './posseLeitura';
import { diaBRT, horaBRT, horarioComercial } from './relogio';
import {
  comTranscricoes, falhaDeInfra, juntarDados, montarGravado, pensarTurno, textosDoLead, valoresDaPessoaDe, type ResultadoTurno,
} from './turno';
import { bolhaDeAbertura, CAMINHOS_ABERTURA } from './textosAgenda';
import { ACAO_ESTACIONAR, type CardResumo, type ContextoLead, type Persona, type SaidaAgente } from './tipos';
import { enviarResposta, type PecaEnvio, type PedidoEnvio, type ResultadoEnvio } from './vivoEnvio';
import { AVISO_IA_NA_PRIMEIRA_MSG, avisoDeApresentacao, comAvisoSeFaltar } from './avisoIA';

/** Este lead já foi apresentado, ou o aviso de IA está desligado (então ninguém precisa dele)? Lê a chave na hora da chamada. */
const jaApresentada = (posse: Readonly<Record<string, unknown>> | null | undefined): boolean =>
  !AVISO_IA_NA_PRIMEIRA_MSG || posse?.apresentada === true;
import type { DecisaoPorteiro } from './porteiro';
import { caminhoDaFicha, ehCardSaiu, semMarcaSaiu } from '../agenda/solarRota';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

const LOG = 'vivo-5040';

export const CHAVE_TRAVA = 'ag5040_vivo_lock';
export const LIMITES_VIVO = Object.freeze({
  travaMs: 300_000,
  prazoEnvioMs: 110_000,
  rajadaMs: 45_000,
  prazoFalaMs: 15 * 60_000,
  buscaMs: 60 * 60_000,
  ancoraFolgaMs: 15 * 60_000,
  maxConversas: 3,
  respostasPorPessoa: Object.freeze({ duda: 10, helena: 10, carla: 20 }) as Readonly<Record<DonaViva, number>>,
  falhasDeIAAteHumano: 3,
  /** Volta honesta do "ligar agora": 15 min sem sinal da consultora (com 5 min ela ofereceu horário a quem a consultora já tinha ligado); a bolha de agenda vale 40 min depois do aviso (15 de espera + 25 de folga para enfileirar). */
  voltaHonestaMs: 15 * 60_000,
  voltaValidadeMs: 40 * 60_000,
  /** Suporte: 10 min sem fala da Giovanna e a mesma ficha vai ao dono, uma vez. */
  suporteDonoMs: 10 * 60_000,
  /** Posses com pendência (volta ou suporte) olhadas por rodada, e até quando se olha (updated_at da posse). */
  pendenciasPorRodada: 5,
  pendenciaJanelaMs: 6 * 3_600_000,
  /**
   * "Ficha remarcado" que saiu adiada ou incerta: retenta até o horário do card passar (ou o card mudar), com espaço
   * crescente entre as tentativas (2, 4, 8, 15 min e, daí em diante, a cada 15 min). A espera conta da última tentativa.
   */
  remarcadoEsperasMs: Object.freeze([2 * 60_000, 4 * 60_000, 8 * 60_000, 15 * 60_000]) as readonly number[],
});

/** A abertura do card do quiz (B1d-3): idade máxima do card, máximo por rodada e a janela de Brasília (7h inclusive, 21h exclusive). */
export const LIMITES_ABERTURA = Object.freeze({ idadeMs: 10 * 60_000, porRodada: 3, horaDe: 7, horaAte: 21, leitura: 20 });

/** Quanto esperar depois da tentativa de número `tentativas` (1 = a primeira) antes de retentar a ficha "remarcado". */
export const esperaDoRemarcadoMs = (tentativas: number): number => {
  const e = LIMITES_VIVO.remarcadoEsperasMs;
  const i = Math.min(Math.max(Math.trunc(Number(tentativas)) || 1, 1), e.length) - 1;
  return e[i]!;
};

/** 1ª linha da ficha que vai só ao dono: número de teste de verdade, ou alvo que não deu para ler (não prova que é teste). */
const PREFIXO_TESTE = 'Lead de teste: esta ficha vai só para o dono.';
const PREFIXO_ALVO_ILEGIVEL = 'Não consegui conferir se este lead é de teste. Encaminhe à consultora.';

/** Ações do modelo que exigem uma ferramenta que a B1c ainda não tem (B1d): viram ficha ao consultor. */
export const ACOES_COM_FERRAMENTA: readonly string[] = [
  'marcar_horario', 'remarcar_horario', 'ligar_agora', 'suporte_giovanna', 'confirmar_presenca',
  'passar_carla', 'passar_duda', 'passar_helena', 'orcamento_escrito',
];

/**
 * As bolhas fixas depois da ficha. Não prometem horário nem ação: só dizem que a consultora vai falar.
 * Genérica: trava sem fala segura, bolha inválida, 10 respostas, 3ª falha de IA e as ações com ferramenta que não
 * são de agenda. Agenda: a IA pediu marcar ou remarcar. Cada uma cabe nos 160 caracteres e não tem travessão.
 */
export const BOLHA_PASSAGEM_GENERICA = 'Vou deixar a consultora cuidar daqui. Já mandei a nossa conversa toda pra ela, e ela te responde por aqui mesmo em breve.';
export const BOLHA_PASSAGEM_AGENDA = 'Pra acertar o horário, a consultora fala com você. Já mandei a nossa conversa pra ela, e ela te chama por aqui em breve.';
/** As mesmas bolhas, no masculino: os consultores do eletroposto são o Thiago e o Diego (COPY PARA O REDATOR). */
export const BOLHA_PASSAGEM_GENERICA_EP = 'Vou passar a conversa pro consultor. Já mandei tudo o que a gente falou, e ele te responde por aqui em breve.';
export const BOLHA_PASSAGEM_AGENDA_EP = 'Pra acertar o horário, o consultor fala com você. Já mandei a conversa pra ele, e ele te chama por aqui em breve.';
/** A passagem curta, para quem a agente ainda não se apresentou: cabe junto da frase do aviso de IA nos 160 (COPY PARA O REDATOR). */
export const BOLHA_PASSAGEM_CURTA = 'Vou chamar a consultora, que te responde por aqui em breve.';
export const BOLHA_PASSAGEM_CURTA_EP = 'Vou chamar o consultor, que te responde por aqui em breve.';
const ACOES_DE_AGENDA: readonly string[] = ['marcar_horario', 'remarcar_horario'];
/** As ações que a Duda executa de verdade na B1d-2c (o resto de ACOES_COM_FERRAMENTA segue virando ficha e passagem). */
const ACOES_DA_DUDA_COM_AGENDA: readonly string[] = ['marcar_horario', 'ligar_agora', 'suporte_giovanna', 'orcamento_escrito'];
const bolhaDaPassagem = (acao?: string, dona?: string, apresentada = true): string => {
  if (!apresentada) return dona === 'helena' ? BOLHA_PASSAGEM_CURTA_EP : BOLHA_PASSAGEM_CURTA;
  const agenda = !!acao && ACOES_DE_AGENDA.includes(acao);
  if (dona === 'helena') return agenda ? BOLHA_PASSAGEM_AGENDA_EP : BOLHA_PASSAGEM_GENERICA_EP;
  return agenda ? BOLHA_PASSAGEM_AGENDA : BOLHA_PASSAGEM_GENERICA;
};

const MOTIVO_LEGIVEL: Record<string, string> = {
  prazo: 'o cliente esperou mais de 15 minutos sem resposta',
  limite_respostas: 'a conversa chegou ao limite de respostas da agente',
  falha_ia: 'a agente não conseguiu responder por falha técnica',
  trava: 'a agente não achou uma resposta segura para dar',
  pediu_humano: 'o cliente pediu para falar com uma pessoa',
  helena_remarcar: 'o cliente pediu para remarcar ou cancelar e nenhum robô da agenda cobre este card',
  helena_sem_confirmacao: 'a confirmação oficial da reunião não saiu em 10 minutos',
};
const NOME_DA_DONA: Record<string, string> = { duda: 'Duda', helena: 'Helena', carla: 'Carla' };

export interface OpcoesVivo {
  dry?: boolean;
  agora?: Date;
  /** Cliente da IA (testes passam um falso). Padrão: o SDK de verdade, criado só se algum modelo for chamado. */
  cliente?: ClienteIA;
}

export interface DecisaoVivo {
  hmac8: string;
  wa_id: number;
  dona: string;
  acao: string | null;
  resultado: string;
  motivo: string | null;
  n_bolhas: number;
  tamanho: number;
  /** Só no dry: as bolhas que sairiam. */
  sairia?: string[];
  ficha?: 'enviada' | 'ficharia' | 'adiada' | 'lead_ja_avisado' | 'falhou';
}

/** A abertura do card do quiz (B1d-3). Sem telefone: só ids de card e contagens. */
export interface RelatorioAbertura {
  vistos: number;
  /** Cards que passaram por todos os filtros e chegaram à reserva (ou, no dry, à bolha). */
  tentados: number;
  /** Abertura entrou na fila de agenda. */
  abertos: number;
  /** Card do quiz de quem já tem posse viva da Duda: a confirmação (tipo `confirma`) entrou na fila de agenda. */
  confirmados?: number;
  puladas: Record<string, number>;
  /** Só no dry: o card e a bolha que sairiam. */
  sairia?: Array<{ card_id: number; bolha: string }>;
}

export interface RelatorioVivo {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  motivo?: string;
  ocupada?: boolean;
  conversasVistas: number;
  elegiveis: number;
  processadas: number;
  enviadas: number;
  puladas: Record<string, number>;
  parou: EstadoCota['parou'] | 'espacamento' | 'erro_linha' | null;
  chamadasIA: number;
  janelaTruncada: boolean;
  decisoes: DecisaoVivo[];
  /** Pendências olhadas nesta rodada: volta honesta do "ligar agora" e reenvio do suporte ao dono. */
  pendencias?: { voltas: number; reenvios: number; olhadas: number };
  /** A abertura do card do quiz solar (B1d-3); ausente quando a Duda não está ligada na rodada. */
  abertura?: RelatorioAbertura;
}

const vazio = (dry: boolean, extra: Partial<RelatorioVivo> = {}): RelatorioVivo => ({
  ok: true, ligado: true, dry, conversasVistas: 0, elegiveis: 0, processadas: 0, enviadas: 0, puladas: {}, parou: null,
  chamadasIA: 0, janelaTruncada: false, decisoes: [], ...extra,
});

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };
const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);
const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

// ── a trava única ────────────────────────────────────────────────────────────

/**
 * Insert; no 23505, update condicional (só se a trava passou da validade): quem chega primeiro leva. A trava leva um
 * TOKEN aleatório no value: quem solta casa pelo token, não pelo updated_at (um gatilho do banco que reescreva o
 * updated_at deixaria a trava presa até expirar). A validade de 300 s segue medida pelo updated_at.
 */
async function tomarTrava(agora: Date, token: string): Promise<'tomada' | 'ocupada' | 'erro'> {
  const iso = agora.toISOString();
  const ins = await supabase.from('system_state').insert({ key: CHAVE_TRAVA, value: { em: iso, token }, updated_at: iso });
  if (!ins.error) return 'tomada';
  if (codigoDe(ins.error) !== '23505') { logger.error(LOG, `trava: insert falhou (${codigoDe(ins.error)})`); return 'erro'; }
  const corte = new Date(agora.getTime() - LIMITES_VIVO.travaMs).toISOString();
  const up = await supabase.from('system_state').update({ value: { em: iso, token }, updated_at: iso })
    .eq('key', CHAVE_TRAVA).lte('updated_at', corte).select('key');
  if (up.error) { logger.error(LOG, `trava: takeover falhou (${codigoDe(up.error)})`); return 'erro'; }
  return Array.isArray(up.data) && up.data.length > 0 ? 'tomada' : 'ocupada';
}

/** Solta só a trava que é minha (o token é o meu): trava tomada por outra rodada depois do meu prazo não cai. */
async function soltarTrava(token: string): Promise<void> {
  try { await supabase.from('system_state').delete().eq('key', CHAVE_TRAVA).eq('value->>token', token); }
  catch (err) { logger.error(LOG, 'não soltei a trava (vence sozinha em 300 s)', err); }
}

// ── leituras ─────────────────────────────────────────────────────────────────

const DONAS_DA_POSSE = ['duda', 'helena', 'carla', 'humano'];
const ESTADOS_DA_POSSE = ['viva', 'passou_humano', 'nao_incomodar', 'encerrada'];

/** As posses (tipo ag5040) destas chaves, em lotes de 100. Erro sobe. Dado ilegível fica de fora. */
async function lerPossesEmLote(chaves: readonly string[]): Promise<Map<string, DadosPosse>> {
  const mapa = new Map<string, DadosPosse>();
  for (let i = 0; i < chaves.length; i += 100) {
    const { data, error } = await supabase.from('whatsapp_sessions')
      .select('phone, lead_data').eq('tipo', 'ag5040').in('phone', chaves.slice(i, i + 100));
    if (error) throw new Error(`leitura das posses falhou (${codigoDe(error)})`);
    for (const l of (data ?? []) as Array<{ phone: string; lead_data: Record<string, unknown> | null }>) {
      const o = l.lead_data;
      if (!o || typeof o !== 'object' || !DONAS_DA_POSSE.includes(String(o.dona)) || !ESTADOS_DA_POSSE.includes(String(o.estado))) continue;
      mapa.set(l.phone, {
        ...o,
        dona: o.dona as DadosPosse['dona'],
        estado: o.estado as DadosPosse['estado'],
        desde: typeof o.desde === 'string' ? o.desde : '',
        ate_wa_id: typeof o.ate_wa_id === 'number' ? o.ate_wa_id : null,
        respostas: Number.isFinite(Number(o.respostas)) ? Number(o.respostas) : 0,
        imagens: Array.isArray(o.imagens) ? o.imagens.map(String) : [],
        links: Array.isArray(o.links) ? o.links.map(String) : [],
      });
    }
  }
  return mapa;
}

/** O número de ENVIO da conversa: o da própria fala (wa_mensagens) ou, se for LID, o do mapa. null = não dá para falar. */
async function telefoneParaEnviar(chave: string, waId: number): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('wa_mensagens').select('telefone').eq('id', waId).maybeSingle();
    if (error) return null;
    const d = soDigitos((data as { telefone?: string | null } | null)?.telefone);
    if (d && chaveContato(d) === chave) return d;
    const lid = await supabase.from('wa_lid_telefone').select('telefone').eq('chave', chave).limit(1);
    if (lid.error) return null;
    const t = soDigitos(((lid.data ?? []) as Array<{ telefone?: string | null }>)[0]?.telefone);
    return t && chaveContato(t) === chave ? t : null;
  } catch {
    return null;
  }
}

/** Falhas de IA desta fala: 1, 2 ou 3 (reserva ag5040_tent:<waId>:<n> por insert; a faxina da cota limpa em 7 dias). */
async function contarFalhaDeIA(waId: number, agora: Date): Promise<number> {
  for (let n = 1; n <= LIMITES_VIVO.falhasDeIAAteHumano; n++) {
    const r = await reservarChave(`ag5040_tent:${waId}:${n}`, {}, agora);
    if (r === 'reservada') return n;
    if (r === 'erro') return 1;
  }
  return LIMITES_VIVO.falhasDeIAAteHumano;
}

// ── a rodada ─────────────────────────────────────────────────────────────────

interface G {
  agora: Date;
  agoraEnvio: () => Date;
  dry: boolean;
  inicio: number;
  r: RelatorioVivo;
  cliente: ClienteIA;
  estado: EstadoCota;
  semModelo: boolean;
  /** As donas ligadas nesta rodada (as pendências de tempo só rodam para elas). */
  donas: readonly string[];
}

export async function runVivoTick(opts: OpcoesVivo = {}): Promise<RelatorioVivo> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const inicio = Date.now();
  let travaToken: string | null = null;
  try {
    // 1. nada ligado: sai sem ler o banco (a única leitura possível é a do interruptor, com cache)
    const donas = await donasDaRodadaLigadas();
    if (!donas.length) return vazio(dry, { ligado: false, motivo: 'nenhuma dona ligada na rodada' });
    if (!hmacDe('vivo-5040')) return vazio(dry, { ok: false, motivo: 'sem segredo de HMAC: a rodada viva não roda' });
    const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
    if (!inst) return vazio(dry, { ok: false, motivo: 'sem a instância da linha IO' });

    // 2. a trava única (o dry não trava: não escreve nada)
    if (!dry) {
      const token = randomBytes(12).toString('hex');
      const t = await tomarTrava(agora, token);
      if (t === 'ocupada') return vazio(dry, { ocupada: true, motivo: 'outra rodada viva está em andamento' });
      if (t === 'erro') return vazio(dry, { ok: false, motivo: 'não consegui tomar a trava da rodada' });
      travaToken = token;
    }

    const r = vazio(dry);
    // Disjuntor aberto: ninguém chama o modelo, mas as passagens para o humano (que não usam IA) seguem.
    const semModelo = await disjuntorAberto(agora);
    if (semModelo) r.parou = 'disjuntor';

    let base: ClienteIA | null = null;
    const lazy: ClienteIA = {
      messages: { create: (body: any, o?: any) => (base ??= opts.cliente ?? (novoAnthropic() as unknown as ClienteIA)).messages.create(body, o) },
    };
    // Cota PRÓPRIA da resposta viva ('resposta', 300/dia): o ensaio sombra ('vivo', 120/dia) não gasta a dela.
    const { cliente, estado } = clienteComCota(dry ? 'dry' : 'resposta', () => new Date(), lazy, inicio + LIMITES_VIVO.prazoEnvioMs);
    const g: G = { agora, agoraEnvio: () => opts.agora ?? new Date(), dry, inicio, r, cliente, estado, semModelo, donas: donas as readonly string[] };

    // 2b. a abertura do card do quiz (B1d-3). Só a Duda, sem IA (não depende do disjuntor). Erro aqui nunca derruba a rodada.
    if ((donas as readonly string[]).includes('duda')) await abrirCardsDoQuiz(g);

    // 3. candidatas: a última fala do lead de cada conversa da última hora, com posse viva
    const desde = new Date(agora.getTime() - LIMITES_VIVO.buscaMs).toISOString();
    const lidas = await lerCandidatas(inst, desde, agora.toISOString());
    r.conversasVistas = lidas.candidatas.length;
    r.janelaTruncada = lidas.truncado;
    // Mais antigas primeiro: quem espera há mais tempo é atendido antes (e as vencidas vão para o humano).
    const candidatas = [...lidas.candidatas].reverse();
    const posses = candidatas.length ? await lerPossesEmLote(candidatas.map(c => c.chave)) : new Map<string, DadosPosse>();

    for (const c of candidatas) {
      if (Date.now() - inicio > LIMITES_VIVO.prazoEnvioMs) { r.parou = 'prazo'; break; }
      const posse = posses.get(c.chave);
      if (!posse || posse.estado !== 'viva') { soma(r.puladas, 'sem_posse_viva'); continue; }
      const dona = posse.dona;
      if (dona === 'humano' || !(DONAS_NA_RODADA as readonly string[]).includes(dona) || !(donas as readonly string[]).includes(dona)) {
        soma(r.puladas, 'dona_fora_da_rodada'); continue;
      }
      if (!(await agenteAtendeEste(dona as DonaViva, c.chave))) { soma(r.puladas, 'fora_do_escopo'); continue; }
      r.elegiveis++;
      const seguir = await processar(c, posse, g);
      if (seguir === 'parar') break;
    }
    if (g.estado.parou && !r.parou) r.parou = g.estado.parou;
    r.chamadasIA = g.estado.chamadas;
    // Pendências de tempo (volta honesta e reenvio do suporte) e a fila de agenda. Nada disso gasta o modelo.
    // Linha com problema (erro_linha): a rodada para por inteiro e as pendências esperam a próxima (2 min). A fila de agenda
    // NÃO é entregue aqui: tem rota e relógio próprios (/cron/agentes-5040/agenda, agendaEnvio.runAgendaTick).
    if (((donas as readonly string[]).includes('duda') || (donas as readonly string[]).includes('helena') || (donas as readonly string[]).includes('carla')) && r.parou !== 'erro_linha' && Date.now() - inicio <= LIMITES_VIVO.prazoEnvioMs) await varrerPendencias(g);
    return r;
  } catch (e) {
    logger.error(LOG, `a rodada falhou (${codigoDe(e)})`);
    return vazio(dry, { ok: false, motivo: 'a rodada falhou' });
  } finally {
    if (travaToken) await soltarTrava(travaToken);
  }
}

// ── a abertura do card do quiz solar (B1d-3) ─────────────────────────────────

type CardDaAbertura = {
  id: number; cliente_nome: string | null; cliente_telefone: string | null; quando: string | null; observacao: string | null;
  vendedor_nome: string | null; created_at: string | null; created_by: string | null; status: string | null; boas_vindas_at: string | null;
};

async function abrirCardsDoQuiz(g: G): Promise<void> {
  const { r, dry, agora } = g;
  const ab: RelatorioAbertura = { vistos: 0, tentados: 0, abertos: 0, puladas: {} };
  r.abertura = ab;
  try {
    const hora = horaBRT(agora);
    if (hora < LIMITES_ABERTURA.horaDe || hora >= LIMITES_ABERTURA.horaAte) { soma(ab.puladas, 'fora_das_7_as_21'); return; }
    const desde = new Date(agora.getTime() - LIMITES_ABERTURA.idadeMs).toISOString();
    const { data, error } = await supabaseGerador.from('agendamentos')
      .select('id, cliente_nome, cliente_telefone, quando, observacao, vendedor_nome, created_at, created_by, status, boas_vindas_at')
      .eq('created_by', 'lp_solar').eq('status', 'agendado').not('quando', 'is', null).is('boas_vindas_at', null)
      .gte('created_at', desde).order('created_at', { ascending: true }).limit(LIMITES_ABERTURA.leitura);
    if (error) { logger.error(LOG, `abertura: leitura dos cards falhou (${codigoDe(error)})`); soma(ab.puladas, 'leitura_falhou'); return; }
    const cards = (data ?? []) as CardDaAbertura[];
    ab.vistos = cards.length;
    for (const card of cards) {
      if (ab.tentados >= LIMITES_ABERTURA.porRodada) { soma(ab.puladas, 'limite_por_rodada'); break; }
      if (Date.now() - g.inicio > LIMITES_VIVO.prazoEnvioMs) { soma(ab.puladas, 'prazo'); break; }
      // Os filtros do banco refeitos aqui: se a consulta mudar (ou devolver a mais), o card errado não recebe abertura.
      if (card.created_by !== 'lp_solar' || String(card.status ?? '').trim().toLowerCase() !== 'agendado' || card.boas_vindas_at) { soma(ab.puladas, 'card_fora_do_molde'); continue; }
      const caminho = caminhoDaFicha(card.observacao);
      if (!caminho || !CAMINHOS_ABERTURA.includes(caminho)) { soma(ab.puladas, 'nao_e_do_quiz'); continue; }
      const criado = Date.parse(String(card.created_at ?? ''));
      if (!Number.isFinite(criado) || criado < agora.getTime() - LIMITES_ABERTURA.idadeMs) { soma(ab.puladas, 'card_velho'); continue; }
      const quandoMs = Date.parse(String(card.quando ?? ''));
      if (!Number.isFinite(quandoMs)) { soma(ab.puladas, 'sem_horario'); continue; }
      if (quandoMs <= agora.getTime()) { soma(ab.puladas, 'horario_passado'); continue; }
      const consultora = primeiroNome(card.vendedor_nome);
      if (!consultora) { soma(ab.puladas, 'sem_consultora'); continue; }
      const tel = soDigitos(card.cliente_telefone);
      const chave = chaveContato(tel);
      if (!chave) { soma(ab.puladas, 'sem_chave'); continue; }
      // 27/10/2026: card de quem SAIU SEM MARCAR só recebe a abertura da Duda quando ela cobre o lead E a conversa não tem posse. Com posse
      // (ou com a Carla e a Helena), o cliente não escolheu horário, então nenhuma "confirmação" sai: o card fica para o solarBoasVindas,
      // que o fecha sem enviar depois dos 15 min.
      if (ehCardSaiu(card.observacao)) {
        let posseSaiu: DadosPosse | null;
        try { posseSaiu = await lerPosse(chave); } catch { soma(ab.puladas, 'posse_ilegivel'); continue; }
        if (posseSaiu || !(await agenteAtendeEste('duda', tel))) { soma(ab.puladas, 'saiu_sem_abertura'); continue; }
      }
      if (!(await agenteAtendeEste('duda', tel))) {
        // A Duda não cobre este lead. Se a conversa é da Carla ou da Helena (posse viva, agente ligada e no escopo dela), o cliente
        // marcou pelo quiz e também precisa da confirmação do horário (24/10/2026): a mesma `confirma` da fila, SEM assumirPosse.
        let posseOutra: DadosPosse | null = null;
        try { posseOutra = await lerPosse(chave); } catch { soma(ab.puladas, 'posse_ilegivel'); continue; }
        const outra = posseOutra?.dona;
        if (posseOutra && posseOutra.estado === 'viva' && (outra === 'carla' || outra === 'helena') && (await agenteAtendeEste(outra, tel))) {
          if (ab.tentados >= LIMITES_ABERTURA.porRodada) { soma(ab.puladas, 'limite_por_rodada'); break; }
          await confirmarCardDeQuemJaTemPosse(g, ab, { card, quandoIso: new Date(quandoMs).toISOString(), consultora, tel });
          continue;
        }
        soma(ab.puladas, 'fora_do_escopo'); continue;
      }
      // Qualquer posse (a da Duda inclusive) = a conversa já é de alguém. O card que a própria Duda grava em acaoMarcar também é
      // lp_solar e nasce com boas_vindas_at nulo: é a posse que o tira daqui (a confirmação dele sai pelo tipo `confirma`).
      let posseDoLead: DadosPosse | null;
      try { posseDoLead = await lerPosse(chave); } catch { soma(ab.puladas, 'posse_ilegivel'); continue; }
      if (posseDoLead) {
        // Posse VIVA da própria Duda: o lead já conversa com ela e agora marcou pelo quiz. A abertura não vale (a conversa já começou),
        // mas ele ficaria sem a confirmação do horário: sai a confirmação (tipo `confirma`) pela mesma fila. Outra dona, passou_humano,
        // nao_incomodar ou encerrada = não mexe (o robô antigo e o humano seguem como hoje).
        // Carla e Helena com posse VIVA também (24/10/2026): `nao_incomodar`, `passou_humano` e `encerrada` seguem pulando (com_posse).
        if ((posseDoLead.dona === 'duda' || posseDoLead.dona === 'carla' || posseDoLead.dona === 'helena') && posseDoLead.estado === 'viva') {
          if (ab.tentados >= LIMITES_ABERTURA.porRodada) { soma(ab.puladas, 'limite_por_rodada'); break; }
          await confirmarCardDeQuemJaTemPosse(g, ab, { card, quandoIso: new Date(quandoMs).toISOString(), consultora, tel });
          continue;
        }
        soma(ab.puladas, 'com_posse'); continue;
      }
      // A bolha vem ANTES de qualquer escrita: a que não cabe nos 160 nem sem nome e sem asteriscos deixa o card para o tick antigo.
      const quandoIso = new Date(quandoMs).toISOString();
      const bolha = bolhaDeAbertura(caminho, card.cliente_nome, quandoIso, consultora, agora.toISOString(), ehCardSaiu(card.observacao));
      if (!bolha) { soma(ab.puladas, 'bolha_nao_cabe'); continue; }
      ab.tentados++;
      if (dry) { (ab.sairia ??= []).push({ card_id: card.id, bolha }); continue; }

      // 1) a reserva: o mesmo UPDATE ... IS NULL do tick antigo. Perdeu = outra rodada pegou o card.
      const em = g.agoraEnvio().toISOString();
      const reserva = await reservarBoasVindas(card.id, em);
      if (reserva === 'perdeu') { soma(ab.puladas, 'reserva_perdida'); continue; }
      if (reserva === 'erro') { await devolverBoasVindas(card.id, em); soma(ab.puladas, 'reserva_falhou'); continue; }
      // 2) a posse da Duda (sem wa_id: o lead ainda não falou; a âncora é `em`). Sem ela, a reserva volta.
      let posse = await assumirPosse(chave, 'duda', null, em);
      if (posse === 'erro') {
        // O INSERT pode ter entrado e a resposta se perdido: relê. A posse da Duda com a nossa âncora = vale; sem posse = a reserva volta;
        // posse de outra dona ou de outra âncora = a conversa já era de alguém; leitura que falha = não mexe em nada (o alarme acusa).
        let atual: DadosPosse | null;
        try { atual = await lerPosse(chave); } catch {
          soma(ab.puladas, 'posse_incerta');
          logger.error(LOG, `abertura: não deu para reler a posse do card ${card.id}; a reserva fica e nada é enfileirado`);
          continue;
        }
        posse = !atual ? 'erro' : (atual.dona === 'duda' && atual.desde === em ? 'assumida' : 'ja_tinha_dona');
      }
      if (posse !== 'assumida') {
        await devolverBoasVindas(card.id, em);
        soma(ab.puladas, posse === 'ja_tinha_dona' ? 'posse_tomada_agora' : 'posse_falhou');
        continue;
      }
      // 3) a fila de agenda: ela guarda e reenvia. Só desfaz o que a fila NÃO gravou.
      let enf: Awaited<ReturnType<typeof enfileirarAgenda>>;
      try {
        enf = await enfileirarAgenda({
          tipo: 'abertura', cardId: card.id, telefone: tel, quando: quandoIso, validoAte: quandoIso, consultora, caminho,
          nome: primeiroNome(card.cliente_nome), ...(ehCardSaiu(card.observacao) ? { saiu: true } : {}),
        }, g.agoraEnvio());
      } catch { enf = { ok: false, motivo: 'erro' }; }
      if (enf.ok) { ab.abertos++; continue; }
      // 'ja_enviado' = o carimbo da abertura existe: ela SAIU, então a reserva e a posse ficam (devolver mandaria as boas-vindas de novo).
      if (enf.motivo === 'ja_enviado') { soma(ab.puladas, 'abertura_ja_enviada'); continue; }
      if (enf.motivo === 'erro') {
        // 'erro' não prova que a fila não gravou (o upsert pode ter entrado e a resposta se perdido): a fila manda. Relê a chave do item;
        // existe, ou a releitura falhou = nada é desfeito (nem reserva nem posse). Só desfaz se a releitura CONFIRMA que o item não está lá.
        const naFila = await itemNaFila(chaveFila(card.id, 'abertura', quandoIso));
        if (naFila === true) { ab.abertos++; soma(ab.puladas, 'fila_gravou_e_respondeu_erro'); continue; }
        if (naFila === null) {
          soma(ab.puladas, 'fila_incerta');
          logger.error(LOG, `abertura: a fila respondeu erro e não deu para reler o item do card ${card.id}; reserva e posse ficam`);
          continue;
        }
        // O item pode ter sumido porque a fila JÁ entregou e apagou no meio da releitura: com o carimbo da abertura de pé, nada é desfeito.
        const carimbo = await carimboDeAberturaExiste(card.id);
        if (carimbo !== false) {
          if (carimbo) ab.abertos++;
          soma(ab.puladas, carimbo ? 'fila_ja_entregou' : 'fila_incerta');
          continue;
        }
      }
      // A fila não gravou. A posse sai primeiro: se ela não sair, a reserva FICA (o card marcado sem envio é o que faz o alarme do
      // solarBoasVindas acusar; devolver a reserva com a posse ainda de pé deixaria a conversa presa sem ninguém saber).
      const posseDesfeita = await desfazerPosseNova(chave, 'duda', em);
      if (!posseDesfeita) {
        soma(ab.puladas, `fila_recusou_${enf.motivo}_posse_ficou`);
        logger.error(LOG, `abertura: a fila não gravou o card ${card.id} (${enf.motivo}) e a posse não saiu; a reserva fica para o alarme acusar`);
        continue;
      }
      await devolverBoasVindas(card.id, em);
      soma(ab.puladas, `fila_recusou_${enf.motivo}`);
      logger.error(LOG, `abertura: a fila não gravou o card ${card.id} (${enf.motivo}); reserva e posse desfeitas`);
    }
  } catch (e) {
    logger.error(LOG, `abertura: erro interno (${codigoDe(e)})`);
    soma(ab.puladas, 'erro_interno');
  }
}

/**
 * Card do quiz de quem JÁ tem posse viva da Duda (a abertura pula: a conversa já começou). Reserva o boas_vindas_at (o mesmo UPDATE ... IS NULL)
 * e enfileira um `confirma` com o horário do card, pelo mesmo enfileirarAgenda. Só desfaz a reserva se a fila NÃO gravou; a posse nunca é
 * tocada aqui. O card que a própria Duda gravou na conversa (marca "Origem: conversa com a Duda") ou que já tem confirma na fila ou
 * carimbado não entra: a confirmação dele é a do acaoMarcar. Nunca lança.
 */
async function confirmarCardDeQuemJaTemPosse(
  g: G, ab: RelatorioAbertura, p: { card: CardDaAbertura; quandoIso: string; consultora: string; tel: string },
): Promise<void> {
  const { card, quandoIso, consultora, tel } = p;
  if (/Origem:\s*conversa com a Duda/i.test(String(card.observacao ?? ''))) { soma(ab.puladas, 'card_da_propria_duda'); return; }
  const jaTem = await confirmaDoCardExiste(card.id);
  if (jaTem !== false) { soma(ab.puladas, jaTem ? 'confirma_ja_existe' : 'confirma_incerta'); return; }
  const bolha = bolhaDeConfirmacao('confirma', quandoIso, consultora, g.agora.toISOString());
  if (!bolha) { soma(ab.puladas, 'bolha_nao_cabe'); return; }
  ab.tentados++;
  if (g.dry) { (ab.sairia ??= []).push({ card_id: card.id, bolha }); return; }
  const em = g.agoraEnvio().toISOString();
  const reserva = await reservarBoasVindas(card.id, em);
  if (reserva === 'perdeu') { soma(ab.puladas, 'reserva_perdida'); return; }
  if (reserva === 'erro') { await devolverBoasVindas(card.id, em); soma(ab.puladas, 'reserva_falhou'); return; }
  let enf: Awaited<ReturnType<typeof enfileirarAgenda>>;
  try {
    enf = await enfileirarAgenda({ tipo: 'confirma', cardId: card.id, telefone: tel, quando: quandoIso, validoAte: quandoIso, consultora }, g.agoraEnvio());
  } catch { enf = { ok: false, motivo: 'erro' }; }
  if (enf.ok) { ab.confirmados = (ab.confirmados ?? 0) + 1; return; }
  if (enf.motivo === 'ja_enviado') { soma(ab.puladas, 'confirma_ja_enviada'); return; }
  if (enf.motivo === 'erro') {
    // 'erro' não prova que a fila não gravou: relê. Item na fila, releitura que falha ou carimbo de pé = nada é desfeito.
    const naFila = await itemNaFila(chaveFila(card.id, 'confirma', quandoIso));
    if (naFila === true) { ab.confirmados = (ab.confirmados ?? 0) + 1; soma(ab.puladas, 'fila_gravou_e_respondeu_erro'); return; }
    if (naFila === null) {
      soma(ab.puladas, 'fila_incerta');
      logger.error(LOG, `confirma do quiz: a fila respondeu erro e não deu para reler o item do card ${card.id}; a reserva fica`);
      return;
    }
    if ((await confirmaDoCardExiste(card.id)) !== false) { soma(ab.puladas, 'fila_incerta'); return; }
  }
  await devolverBoasVindas(card.id, em);
  soma(ab.puladas, `fila_recusou_${enf.motivo}`);
  logger.error(LOG, `confirma do quiz: a fila não gravou o card ${card.id} (${enf.motivo}); a reserva foi desfeita`);
}

/** Há `confirma` deste card na fila ou carimbado (qualquer estado)? true | false | null (a leitura falhou). Nunca lança. */
async function confirmaDoCardExiste(cardId: number): Promise<boolean | null> {
  try {
    // ag5040_agenda_fila:<id>:confirma:... e ag5040_agenda_sent:<id>:confirma:... num padrão só (o `_` do LIKE casa qualquer letra: aqui só casa as duas).
    const { data, error } = await supabase.from('system_state').select('key').like('key', `ag5040_agenda_%:${cardId}:confirma:%`).limit(1);
    if (error) return null;
    return Array.isArray(data) && data.length > 0;
  } catch { return null; }
}

/** O item da fila de agenda existe? true | false (releitura confirmou que não) | null (a releitura falhou). Nunca lança. */
async function itemNaFila(chave: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from('system_state').select('key').eq('key', chave).maybeSingle();
    if (error) return null;
    return !!data;
  } catch { return null; }
}

/** Existe carimbo de abertura deste card (em qualquer estado)? true | false | null (a leitura falhou). Nunca lança. */
async function carimboDeAberturaExiste(cardId: number): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from('system_state').select('key')
      .like('key', `ag5040_agenda_sent:${cardId}:abertura:%`).limit(1);
    if (error) return null;
    return Array.isArray(data) && data.length > 0;
  } catch { return null; }
}

/**
 * O carimbo de ABERTURA deste card está ENVIADO? A abertura do quiz já leva o aviso de IA, então abertura enviada = apresentada.
 * true | false | null (a leitura falhou). Nunca lança.
 */
async function aberturaEnviada(cardId: number): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `ag5040_agenda_sent:${cardId}:abertura:%`).limit(10);
    if (error) return null;
    return (Array.isArray(data) ? data : []).some(l => (l as { value?: { estado?: unknown } | null }).value?.estado === 'enviado');
  } catch { return null; }
}

/**
 * O ÚNICO caminho de envio ao lead da rodada viva. A primeira mensagem de cada agente para um lead traz o aviso de IA
 * (decisão do dono, 22/10/2026): enquanto lead_data.apresentada não é true, a bolha sem o aviso ganha a frase na frente (texto fixo
 * do sistema, se couber nos 160) ou é RECUSADA ('bolha_invalida:sem_aviso_ia'); nunca sai bolha sem aviso na primeira mensagem.
 * Saiu com o aviso: grava apresentada = true na posse (e no objeto em memória, para o resto da conversa).
 */
async function enviarAoLead(chave: string, posse: DadosPosse, pedido: PedidoEnvio, agora: Date): Promise<ResultadoEnvio> {
  const ja = jaApresentada(posse);
  const bolha = comAvisoSeFaltar(pedido.bolha, pedido.dona, ja);
  if (bolha === null) return { ok: false, motivo: 'bolha_invalida', detalhe: 'sem_aviso_ia' };
  const res = await enviarResposta({ ...pedido, bolha }, agora);
  if (res.ok && !ja && !pedido.dry) {
    posse.apresentada = true;
    await atualizarPosse(chave, { apresentada: true });
  }
  return res;
}

type Seguir = 'seguir' | 'parar';

async function processar(c: Candidata, posse: DadosPosse, g: G): Promise<Seguir> {
  const { r, dry, agora } = g;
  const chave = c.chave;
  const hmac = hmacDe(chave);
  if (!hmac) { soma(r.puladas, 'sem_hmac'); return 'seguir'; }
  const hmac8 = hmac.slice(0, 8);
  const dona = posse.dona as DonaViva;
  const agoraMs = agora.getTime();

  // 1. a conversa e a última fala do lead
  const conv = await lerConversa(chave);
  if (!conv.completa) { soma(r.puladas, 'conversa_incompleta'); return 'seguir'; }
  const msgs = conv.msgs;
  let iL = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]!.autor === 'lead') { iL = i; break; }
  if (iL < 0) { soma(r.puladas, 'sem_fala_do_lead'); return 'seguir'; }
  const L = msgs[iL]!;

  // 2. a fala é posterior à posse. Sem ate_wa_id (a porta não conhece o id), a âncora é posse.desde, com folga de 15 min.
  if (posse.ate_wa_id !== null) {
    if (L.id <= posse.ate_wa_id) { soma(r.puladas, 'ja_atendida'); return 'seguir'; }
  } else {
    const desde = Date.parse(posse.desde);
    if (Number.isFinite(desde) && Date.parse(L.momment) < desde - LIMITES_VIVO.ancoraFolgaMs) { soma(r.puladas, 'fala_antes_da_posse'); return 'seguir'; }
  }

  // 2b. O lead escreveu de novo com a posse estacionada (B4b): a conversa voltou. Zera o estacionado (vale a regra normal das 48 h
  // e das 2 retomadas). Se ele pedir de novo para esperar, a ação estacionar grava outra data mais abaixo. O dry não grava.
  const baseDaPosse = lerBaseDaPosse(posse as unknown as Record<string, unknown>);
  if (baseDaPosse.estacionado_ate && Date.parse(baseDaPosse.estacionado_ate) > agoraMs && !dry) {
    const atual = await lerPosse(chave).catch(() => null);
    if (atual) await atualizarPosse(chave, { base: juntarBase(atual, { estacionado_ate: null, estacionado_motivo: null, ultima: false }) });
  }

  // 3. QUALQUER mensagem nossa depois da fala do lead (robô antigo, humano no celular, a própria agente):
  // a agente não fala por cima. Só marca a fala como vista.
  if (iL < msgs.length - 1) {
    if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
    soma(r.puladas, 'ja_respondida_por_nos');
    return 'seguir';
  }

  const idade = agoraMs - Date.parse(L.momment);
  if (!Number.isFinite(idade)) { soma(r.puladas, 'momento_invalido'); return 'seguir'; }
  if (idade < LIMITES_VIVO.rajadaMs) { soma(r.puladas, 'rajada'); return 'seguir'; }

  const base = { hmac8, wa_id: L.id, dona };
  const dec = (d: Partial<DecisaoVivo> & { resultado: string }): void => {
    r.decisoes.push({ ...base, acao: null, motivo: null, n_bolhas: 0, tamanho: 0, ...d });
  };

  // 3a. PAUSA HUMANA antes de qualquer regra e do modelo (pacote 2b): com humano na conversa a rodada chamava o modelo, caía na trava
  // e mandava ao dono uma ficha vazia. É a MESMA checagem do vivoEnvio (podeFalarComLead, telefone resolvido); a do vivoEnvio segue
  // como última guarda. Sem telefone resolvido não há o que conferir aqui: o passo 5 trata ('sem_telefone').
  const tel = await telefoneParaEnviar(chave, L.id);
  if (tel) {
    const gate = await podeFalarComLead(tel);
    if (!gate.pode) {
      if (!dry) {
        await atualizarPosse(chave, { ate_wa_id: L.id });
        // Quem pede para parar durante a pausa não pode ficar sem registro: o opt-out é gravado mesmo sem modelo e sem envio.
        if (pedeParaPararDeReceber(ultimoBlocoDoLead(msgs).map(m => String(m.texto ?? '').trim()).filter(Boolean))) {
          await silenciarContato(tel, 'opt_out', 'agentes5040-vivo');
        }
      }
      soma(r.puladas, 'pausa_humana');
      dec({ resultado: 'recusada', motivo: 'pausa_humana' });
      return 'seguir';
    }
  }

  // 3b. A HELENA (B2): as regras que vêm antes de tudo (limite de conversas, prazo, vez e IA). Cala e espera não gastam nada.
  // Espera passa dos 15 min = o robô da agenda não leu a tempo: cai no prazo abaixo, que passa ao humano com ficha.
  let preparoH: Extract<Veredicto, { tipo: 'seguir' }> | null = null;
  const textosDaFala = ultimoBlocoDoLead(msgs).map(m => String(m.texto ?? '').trim()).filter(Boolean);
  if (dona === 'helena') {
    const v = await regrasDaHelena({ chave, fala: L, textos: textosDaFala, agoraMs });
    if (v.tipo === 'cala') {
      if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
      soma(r.puladas, `helena_cala_${v.motivo}`);
      dec({ resultado: 'calou', motivo: v.motivo });
      return 'seguir';
    }
    if (v.tipo === 'espera' && idade <= LIMITES_VIVO.prazoFalaMs) {
      soma(r.puladas, `helena_espera_${v.motivo}`);
      dec({ resultado: 'espera', motivo: v.motivo });
      return 'seguir';
    }
    if (v.tipo === 'humano') {
      if (r.processadas >= LIMITES_VIVO.maxConversas) { soma(r.puladas, 'limite_de_conversas'); return 'seguir'; }
      r.processadas++;
      await passarAoHumano(g, {
        chave, tel, L, posse, hmac, motivo: 'helena_remarcar', bolha: true, acao: 'remarcar_horario', card: null, buscarCard: true,
        nome: null, dec, detalhe: v.motivo,
      });
      return 'seguir';
    }
    if (v.tipo === 'seguir') preparoH = v;
  }

  if (r.processadas >= LIMITES_VIVO.maxConversas) { soma(r.puladas, 'limite_de_conversas'); return 'seguir'; }

  // 4. fala vencida, ou limite de respostas: passa ao humano sem gastar modelo (e sem depender da vez)
  if (idade > LIMITES_VIVO.prazoFalaMs) {
    r.processadas++;
    await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'prazo', bolha: false, card: null, buscarCard: true, nome: null, dec });
    return 'seguir';
  }
  if (posse.respostas >= LIMITES_VIVO.respostasPorPessoa[dona]) {
    r.processadas++;
    await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'limite_respostas', bolha: true, card: null, buscarCard: true, nome: null, dec });
    return 'seguir';
  }

  // 5. daqui para baixo é preciso falar com o lead e com o modelo
  if (!tel) { soma(r.puladas, 'sem_telefone'); return 'seguir'; }
  if (g.semModelo || g.estado.parou) { soma(r.puladas, 'ia_parada'); return 'parar'; }
  if (dona === 'helena' && !preparoH) { soma(r.puladas, 'helena_sem_preparo'); return 'seguir'; }

  // Vez PRÓPRIA da rodada viva: a do ensaio sombra (ag5040_vez:<waId>) pode já estar reservada, por um lead que chegou
  // pelo poll antes da posse, e não pode prender esta rodada.
  const vezKey = `ag5040_vez_vivo:${L.id}`;
  if (!dry) {
    const vez = await reservarChave(vezKey, {}, agora);
    if (vez !== 'reservada') { soma(r.puladas, vez === 'ja_existe' ? 'vez_ocupada' : 'vez_nao_reservada'); return 'seguir'; }
  }
  r.processadas++;
  const soltar = async (): Promise<void> => { if (!dry) await liberarChave(vezKey); };

  try {
    // 6. contexto
    const ctx0 = await montarContexto(chave, { msgs, completa: true }, { agora: agora.toISOString() });
    if (!ctx0.completa) { await soltar(); soma(r.puladas, 'contexto_incompleto'); return 'seguir'; }
    // A Carla não atende quem já tem conta (lerEhCliente, dentro do montarContexto): a posse dela fecha antes da IA e a
    // Giovanna atende pelo caminho de hoje (encerrada não cede, os robôs antigos voltam).
    // A fala dele NÃO pode sumir: ficha à Giovanna pelo caminho do suporte (reserva ag5040_suporte:<hmac>:<waId>; número de
    // teste vai ao dono), SEM bolha ao lead. Ficha adiada (cooldown, teto) = a posse fica viva e a próxima rodada tenta.
    if (dona === 'carla' && ctx0.ehClienteSolarDoc) {
      const rf = dry ? null : await fichaDoClienteComConta(g, { chave, tel, L, hmac, ctx0 });
      if (rf === 'adiada') {
        await soltar();
        soma(r.puladas, 'ficha_adiada');
        dec({ resultado: 'ficha_adiada', motivo: 'cliente_com_conta', ficha: 'adiada' });
        return 'seguir';
      }
      if (!dry) await atualizarPosse(chave, { estado: 'encerrada', ate_wa_id: L.id });
      await soltar();
      soma(r.puladas, 'carla_lead_ja_e_cliente');
      dec({
        resultado: dry ? 'encerraria_a_posse' : 'posse_encerrada', motivo: 'cliente_com_conta',
        ...(rf ? { ficha: rf === 'enviada' ? 'enviada' : rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou' } : dry ? { ficha: 'ficharia' } : {}),
      });
      return 'seguir';
    }
    // O aviso de IA (22/10/2026): a agente se apresenta na PRIMEIRA mensagem dela a este lead. Abertura do quiz ENVIADA = apresentada
    // (a bolha da abertura já leva o aviso): vale, e é gravada na posse, mesmo que nenhuma resposta saia agora (a Base lê a posse).
    if (AVISO_IA_NA_PRIMEIRA_MSG && posse.apresentada !== true && dona === 'duda') {
      const cs = cardSolarDoCtx(ctx0);
      if (cs && await aberturaEnviada(cs.id) === true) {
        posse.apresentada = true;
        if (!dry) await atualizarPosse(chave, { apresentada: true });
      }
    }
    const exigeAviso = !jaApresentada(posse);
    const primeiro = msgs.find(m => m.autor === 'lead');
    const anuncio = primeiro ? await anuncioDaMensagem(primeiro.id) : { ok: true, anuncio: null };
    let turnosAntes: TurnoGravado[];
    try { turnosAntes = (await lerTurnos(hmac)).filter(t => t.wa_id < L.id); }
    catch { await soltar(); soma(r.puladas, 'armazem_falhou'); return 'seguir'; }
    const entrada = ultimoBlocoDoLead(msgs);
    const audiosAntigos = msgs.filter(m => m.autor === 'lead' && m.tipo === 'audio' && m.media_url).slice(-10).map(m => m.id);
    const idsMidia = [...new Set([...audiosAntigos, ...entrada.filter(ehMidia).map(m => m.id)])];
    const cacheMidia = await lerMidiaCache(idsMidia);
    const dadosAnt = juntarDados(turnosAntes.filter(t => t.falou).map(t => t.dados));
    // Horários livres (B1d-2c): só a Duda, e só com consultora definida: a do card que ela remarca, ou a da faixa de kWh
    // que o lead já disse. Sem uma nem outra a lista vai vazia e a persona pergunta manhã ou tarde (pedir_horarios).
    // O texto vai com o `agora` do turno e é com essa mesma lista que a escolha da IA é casada depois.
    let oferta: Oferta = { alvo: null, vagas: [] };
    if (dona === 'duda') {
      const textos = textosDoLead(comTranscricoes(msgs, cacheMidia));
      oferta = await ofertaDeHorarios(alvoDaAgenda(cardSolarDoCtx(ctx0), kwhDoLead(dadosAnt, valoresDaPessoaDe(textos, dadosAnt))), ctx0.agora);
    }
    // A Helena (B2): o card dela é o de ELETROPOSTO (nunca o do solar); sem card, o consultor e os horários saem daqui, uma vez só.
    const ofertaH: { dono: string | null; vagas: string[] } = { dono: null, vagas: [] };
    if (dona === 'helena' && preparoH) {
      ctx0.card = preparoH.cardAlvo ? cardResumoDe(preparoH.cardAlvo) : null;
      ctx0.cardSolar = null;
      if (preparoH.semCard) {
        const guardado = String(posse.ep_dono ?? '');
        ofertaH.dono = CONSULTORES_EP.includes(guardado) ? guardado : await consultorDoCardNovo(tel);
        if (ofertaH.dono && ofertaH.dono !== guardado && !dry) await atualizarPosse(chave, { ep_dono: ofertaH.dono });
        ofertaH.vagas = ofertaH.dono ? await vagasDoConsultor(ofertaH.dono, g.agoraEnvio().getTime()) : [];
      }
    }
    const avisosDaHelena = (): string[] => (dona !== 'helena' || !preparoH ? [] : [
      AVISO_HELENA_VIVA,
      ...(preparoH.semCard && ofertaH.vagas.length ? [AVISO_HELENA_MARCAR] : []),
    ]);
    const ctx: ContextoLead = {
      ...ctx0, anuncio: anuncio.anuncio,
      horariosLivres: horariosPorExtenso(dona === 'helena' ? ofertaH.vagas : oferta.vagas, ctx0.agora),
      ...(dona === 'helena' ? { avisosDoSistema: avisosDaHelena() } : {}),
      ...(dona === 'carla' ? { avisosDoSistema: avisosDaCarla(posse, g.agoraEnvio()) } : {}),
    };
    // Todo chamado ao modelo (inclusive a segunda chance de agenda, de peça e de bolha barrada) leva o aviso do sistema e a
    // exigência da trava enquanto a agente não se apresentou: o aviso é somado AQUI, para nenhuma reconstrução de `avisosDoSistema` o perder.
    /** Quantas vezes o modelo DA AGENTE foi chamado neste turno (a ficha também usa o g.cliente, e essas chamadas não contam aqui). */
    let chamadasDoPensar = 0;
    const pensar = (c0: ContextoLead): Promise<ResultadoTurno> => {
      chamadasDoPensar++;
      return pensarTurno({
        persona: dona as Persona,
        ctx: exigeAviso ? { ...c0, avisosDoSistema: [...(c0.avisosDoSistema ?? []), avisoDeApresentacao(dona as Persona)] } : c0,
        ...(exigeAviso ? { exigeAviso: true } : {}),
        novas: entrada, dadosAnteriores: dadosAnt, abertura: false, cliente: g.cliente, cacheMidia,
        ...(dona === 'carla' ? { depoimentosJaEnviados: posse.imagens.length } : {}),
      });
    };

    // 7. o modelo. `tratar` é o resto do turno; a ação de agenda que não deu certo chama o modelo de novo, UMA vez
    // (volta = 1), com um aviso do sistema e as vagas novas.
    const tratar = async (resultado: ResultadoTurno, volta: 0 | 1, ofertaDaVez: Oferta): Promise<Seguir> => {
      const pens = resultado.pensamento;
      if (g.estado.parou) {                       // crédito, chave, teto, disjuntor ou prazo: a rodada para e a vez é solta
        await soltar();
        r.parou = g.estado.parou;
        dec({ resultado: 'ia_parou', motivo: g.estado.parou });
        return 'parar';
      }
      if (falhaDeInfra(pens)) {
        await soltar();
        const n = dry ? 0 : await contarFalhaDeIA(L.id, agora);
        if (n < LIMITES_VIVO.falhasDeIAAteHumano) { soma(r.puladas, 'ia_indisponivel'); dec({ resultado: 'ia_indisponivel', motivo: dry ? 'dry' : `falha ${n}` }); return 'seguir'; }
        await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'falha_ia', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec });
        return 'seguir';
      }
      if (!dry) for (const b of resultado.midiasNovas) await gravarMidiaCache(b);

      const decisao: DecisaoPorteiro = { dona, passo: 2, motivo: 'posse viva (rodada viva)' };
      const registrar = async (enviado: boolean, motivoSilencio?: string): Promise<void> => {
        if (dry) return;
        try {
          const turno: TurnoGravado = {
            ...montarGravado({
              origem: 'vivo', hmac, kind: 'resposta', waId: L.id, momento: L.momment, decisao, persona: dona as Persona,
              resultado, entrada, nHistorico: msgs.length, real: null, agora,
            }),
            enviado,
          };
          if (motivoSilencio) turno.motivo_silencio = motivoSilencio;
          await gravarTurno(turno);
        } catch (err) { logger.error(LOG, `não gravei o turno ${L.id} (${codigoDe(err)})`); }
      };

      // 8. fala nova depois do modelo: solta e tenta na próxima rodada
      const rele = await lerConversa(chave);
      if (!rele.completa || rele.msgs[rele.msgs.length - 1]?.id !== L.id) {
        await soltar();
        soma(r.puladas, 'fala_nova_antes_do_envio');
        dec({ resultado: 'fala_nova', motivo: 'chegou mensagem depois do modelo' });
        return 'seguir';
      }
      if (Date.now() - g.inicio > LIMITES_VIVO.prazoEnvioMs) {
        await soltar();
        r.parou = 'prazo';
        dec({ resultado: 'prazo_da_rodada' });
        return 'parar';
      }

      // 9. o modelo não achou fala segura (trava): passa ao humano
      if (!pens.falou) {
        await registrar(false);
        // Sem o aviso de IA na 2ª tentativa (ou qualquer outra trava) com o lead ainda não apresentado: ficha ao humano, SEM bolha.
        await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: exigeAviso ? false : true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: pens.motivo,
          // A ficha da trava leva o que a posse e o contexto já têm (cidade, conta, kWh); sem isto chegava vazia ao consultor.
          dados: dadosDoLeadParaFicha({
            dados: dadosAnt, cidades: [ctx0.card?.cidade, ctx0.leadsMeta?.cidade, ...ctx0.cadastros.map(c => c.cidade)],
            kwh: kwhDoLead(dadosAnt, resultado.valoresDaPessoa),
          }),
        });
        return 'seguir';
      }
      const saida = pens.saida;
      const base2 = { acao: saida.acao, n_bolhas: saida.bolhas.length, tamanho: saida.bolhas.reduce((n, b) => n + b.length, 0) };

      // 9-pre. ESTACIONAR (B4b, só Duda e Helena): o PRÓPRIO lead disse que agora não dá, ou pediu para chamar numa data. Pedido de
      // parar ("não quero", "para", "não me chama") NUNCA estaciona: uma nova chamada ao modelo com o aviso e, na segunda vez, o
      // silêncio sem bolha (a pessoa pediu para parar e não pode ser retomada). Sem data dita, ou data torta, o prazo é o fixo de 30
      // dias e a retomada do dia é a última (baseRegras.planejarEstacionar). O `base` é gravado ANTES da bolha, como o nao_incomodar:
      // lado seguro (a bolha recusada pelo envio não desfaz o estacionado, que só reduz envio).
      let planoE: PlanoEstacionar | null = null;
      if (saida.acao === ACAO_ESTACIONAR && (dona === 'duda' || dona === 'helena')) {
        const doBloco = new Set(entrada.map(m => m.id));
        const midiasE = [...cacheMidia.values(), ...resultado.midiasNovas].filter(b => doBloco.has(b.msgId));
        const textosE = textosDoLead(comTranscricoes(entrada, cacheMidia), midiasE);
        if (pareceOptOut(textosE)) {
          if (volta === 0) return tratar(await pensar({ ...ctx, avisosDoSistema: [...(ctx.avisosDoSistema ?? []), AVISO_PARAR] }), 1, ofertaDaVez);
          if (!dry) {
            await atualizarPosse(chave, { estado: 'nao_incomodar', ate_wa_id: L.id });
            await silenciarContato(tel, 'opt_out', 'agentes5040-vivo');
          }
          await registrar(false, 'estacionar_com_pedido_de_parar');
          dec({ resultado: dry ? 'silenciaria' : 'silenciado', ...base2, motivo: 'estacionar_com_pedido_de_parar' });
          return 'seguir';
        }
        planoE = planejarEstacionar({ dados: saida.dados, textos: textosE, agora: g.agoraEnvio() });
        if (!dry) {
          const atual = await lerPosse(chave).catch(() => null);
          const gravou = !!atual && await atualizarPosse(chave, { base: juntarBase(atual, patchDoEstacionar(planoE, g.agoraEnvio())) });
          if (!gravou) {
            await soltar();
            soma(r.puladas, 'estacionar_nao_gravou');
            dec({ resultado: 'recusada', ...base2, motivo: 'posse_nao_gravou' });
            return 'seguir';
          }
        }
      }

      // 9a. A Helena (B2): suporte, presença e marcar sem card são dela; o resto (passar_*, calar, fala comum) cai nas rotas de baixo
      if (dona === 'helena' && preparoH) {
        const AH: ContextoAcao = {
          g, chave, tel, L, posse, hmac, ctx0, oferta: { alvo: null, vagas: ofertaH.vagas }, dadosAnt, resultado, saida, base2, dec, registrar, soltar,
          ep: { preparo: preparoH, dono: ofertaH.dono, vagas: ofertaH.vagas, textos: textosDaFala },
          refazer: async (aviso: string): Promise<Seguir> => {
            if (volta === 1) return AH.humano(`ferramenta:${saida.acao}`, 'segunda_tentativa');
            const novas = ofertaH.dono ? await vagasDoConsultor(ofertaH.dono, g.agoraEnvio().getTime(), 4) : [];
            if (!novas.length) return AH.humano(`ferramenta:${saida.acao}`, 'sem_horarios');
            ofertaH.vagas = novas;
            const ctx2: ContextoLead = { ...ctx, horariosLivres: horariosPorExtenso(novas, ctx0.agora), avisosDoSistema: [...avisosDaHelena(), aviso] };
            return tratar(await pensar(ctx2), 1, oferta);
          },
          humano: async (motivo: string, detalhe?: string): Promise<Seguir> => {
            await registrar(false, motivo);
            await passarAoHumano(g, {
              chave, tel, L, posse, hmac, motivo, bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec,
              resumo: saida.resumo, dados: saida.dados, acao: saida.acao, ...(detalhe ? { detalhe } : {}),
            });
            return 'seguir';
          },
        };
        // Remarcar ou cancelar DITO EM ÁUDIO: o ep_respostas e a regra de antes da IA só leem texto. Com card, nenhum robô cobre
        // isto, então vai ao humano com a ficha (depois da transcrição, que só existe agora).
        if (!preparoH.semCard) {
          const doBloco = new Set(entrada.map(m => m.id));
          const midias = [...cacheMidia.values(), ...resultado.midiasNovas].filter(b => doBloco.has(b.msgId));
          const ditos = textosDoLead(comTranscricoes(entrada, cacheMidia), midias).filter(t => !textosDaFala.includes(t));
          if (ditos.length && await pedeRemarcar(ditos)) {
            await registrar(false, 'helena_remarcar:audio');
            await passarAoHumano(g, {
              chave, tel, L, posse, hmac, motivo: 'helena_remarcar', bolha: true, acao: 'remarcar_horario', card: ctx0.card, buscarCard: false,
              nome: ctx0.nome, dec, detalhe: 'remarcar_em_audio',
            });
            return 'seguir';
          }
        }
        // O lead com card de eletroposto que CONFIRMOU DE VERDADE (a regra do ep_respostas) é sempre da resposta ao SIM, qualquer
        // que seja a ação que a IA devolveu: a prova, a releitura do card e a reserva por card vivem em acaoPresenca.
        if (!preparoH.semCard && !preparoH.presencaRespondida && (await funcoesEp()).confirmouMesmo([...textosDaFala])) return acaoPresenca(AH);
        const pedeComHorario = saida.acao === 'pedir_horarios' && (!preparoH.semCard || !!acharVagaEp(saida.dados.horario, ofertaH.vagas, ctx0.agora));
        const vaiFalar = saida.acao === 'continuar' || saida.acao === 'nao_incomodar' || saida.acao === 'suporte_giovanna' || saida.acao === ACAO_ESTACIONAR
          || (saida.acao === 'pedir_horarios' && !pedeComHorario);
        if (vaiFalar) {
          // A bolha que a persona ainda escreve pelo roteiro antigo (pedir SIM, prometer lembrete, dizer "confirmado") não sai:
          // uma nova chance, e na segunda vez passa ao humano.
          const viol = saida.bolhas.map(b => violacaoDaBolha(b, false)).find(Boolean);
          if (viol) {
            if (volta === 0) return tratar(await pensar({ ...ctx, avisosDoSistema: [...avisosDaHelena(), AVISO_BOLHA_BARRADA(viol)] }), 1, oferta);
            return AH.humano('trava', `helena_bolha:${viol}`);
          }
        }
        if (saida.acao === 'suporte_giovanna') return acaoSuporte(AH);
        if (saida.acao === 'confirmar_presenca') return acaoPresenca(AH);
        if (saida.acao === 'marcar_horario' || pedeComHorario) return acaoMarcarEp(AH);
      }

      // 9b. a Duda marca, remarca, liga agora e passa o suporte (B1d-2c); a Carla passa o suporte (ficha à Giovanna, B3b)
      if ((dona === 'duda' && ACOES_DA_DUDA_COM_AGENDA.includes(saida.acao)) || (dona === 'carla' && saida.acao === 'suporte_giovanna')) {
        const A: ContextoAcao = {
          g, chave, tel, L, posse, hmac, ctx0, oferta: ofertaDaVez, dadosAnt, resultado, saida, base2, dec, registrar, soltar,
          refazer: async (aviso: string, n = 4): Promise<Seguir> => {
            if (volta === 1) return A.humano(`ferramenta:${saida.acao}`, 'segunda_tentativa');
            const alvo = ofertaDaVez.alvo ?? alvoDaAgenda(cardSolarDoCtx(ctx0), kwhDoLead({ ...dadosAnt, ...saida.dados }, resultado.valoresDaPessoa));
            const nova = await ofertaDeHorarios(alvo, ctx0.agora, n);
            if (!nova.vagas.length) return A.humano(`ferramenta:${saida.acao}`, 'sem_horarios');
            const ctx2: ContextoLead = { ...ctx, horariosLivres: horariosPorExtenso(nova.vagas, ctx0.agora), avisosDoSistema: [aviso] };
            return tratar(await pensar(ctx2), 1, nova);
          },
          humano: async (motivo: string, detalhe?: string): Promise<Seguir> => {
            await registrar(false, motivo);
            await passarAoHumano(g, {
              chave, tel, L, posse, hmac, motivo, bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec,
              resumo: saida.resumo, dados: saida.dados, acao: saida.acao, ...(detalhe ? { detalhe } : {}),
            });
            return 'seguir';
          },
        };
        if (saida.acao === 'suporte_giovanna') return acaoSuporte(A);
        if (saida.acao === 'orcamento_escrito') return acaoOrcamentoEscrito(A);
        if (volta === 1) return A.humano(`ferramenta:${saida.acao}`, 'segunda_tentativa');
        return saida.acao === 'marcar_horario' ? acaoMarcar(A) : acaoLigarAgora(A);
      }

      // 10. ação que exige ferramenta: ficha + bolha fixa (só se a ficha saiu)
      if (ACOES_COM_FERRAMENTA.includes(saida.acao)) {
        await registrar(false, `ferramenta:${saida.acao}`);
        await passarAoHumano(g, {
          chave, tel, L, posse, hmac, motivo: `ferramenta:${saida.acao}`, bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec,
          resumo: saida.resumo, dados: saida.dados, acao: saida.acao,
        });
        return 'seguir';
      }

      // 11. calar / sem bolha: marca a fala como vista e fica quieta
      if (saida.acao === 'calar' || !saida.bolhas.length) {
        if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
        await registrar(false, 'calar');
        dec({ resultado: 'calou', ...base2 });
        return 'seguir';
      }

      // 12. fala comum ou despedida
      const bolha = saida.bolhas[0]!;
      const segunda = saida.bolhas[1];
      let peca: PecaEnvio | undefined = saida.peca && (saida.peca.tipo === 'link' || saida.peca.tipo === 'pix') && segunda
        ? { tipo: saida.peca.tipo, texto: segunda } : undefined;
      const naoIncomodar = saida.acao === 'nao_incomodar';
      if (planoE) peca = undefined;                // estacionar é só a bolha: nunca link, Pix nem imagem

      // A Carla (B3b): a peça sai do peca.id (carlaVivo), nunca do texto da 2ª bolha. Peça recusada pelo portão = uma nova
      // chamada ao modelo com o aviso; na segunda vez, humano com ficha (a bolha que anuncia a peça não sai sozinha).
      let planoC: PlanoCarla | null = null;
      if (dona === 'carla') {
        peca = undefined;
        if (!naoIncomodar) {
          const pl = planejarCarla({ saida, posse, msgs: ctx0.msgs, fala: L, textosDoLead: textosDaFala });
          if (!pl.ok) {
            if (volta === 0) return tratar(await pensar({ ...ctx, avisosDoSistema: [...(ctx.avisosDoSistema ?? []), pl.aviso] }), 1, oferta);
            await registrar(false, `carla_peca:${pl.motivo}`);
            await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: `carla_peca:${pl.motivo}` });
            return 'seguir';
          }
          planoC = pl;
          peca = pl.peca;
          // O registro da imagem vai para a posse ANTES do envio; se não gravou, a imagem não sai.
          if (pl.antes && !dry && !(await atualizarPosse(chave, pl.antes))) {
            await soltar();
            soma(r.puladas, 'carla_posse_nao_gravou');
            dec({ resultado: 'recusada', ...base2, motivo: 'posse_nao_gravou' });
            return 'seguir';
          }
        }
      }

      // O estado nao_incomodar é gravado ANTES da despedida: se algo falhar daqui em diante, a conversa já está calada
      // (lado seguro). Em troca, uma despedida recusada pelo envio NÃO é tentada de novo: a pessoa pediu para parar.
      if (naoIncomodar && !dry) await atualizarPosse(chave, { estado: 'nao_incomodar', ate_wa_id: L.id });
      const res: ResultadoEnvio = await enviarAoLead(chave, posse, {
        dona, telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, ...(peca && !naoIncomodar ? { peca } : {}), dry,
      }, g.agoraEnvio());
      // O silêncio vem DEPOIS da despedida (o enviarResposta barraria uma fala a quem já está no opt-out).
      if (naoIncomodar && !dry) await silenciarContato(tel, 'opt_out', 'agentes5040-vivo');

      // Os efeitos da peça e da promessa da Carla (pagamento registrado, promessa, card liberado de novo) e o patch da posse.
      let patchCarla: Partial<DadosPosse> = {};
      if (planoC && !dry) {
        try { patchCarla = await planoC.depois(res, { tel, nome: ctx0.nome, agora: g.agoraEnvio() }); }
        catch (err) { logger.error(LOG, `conversa ${L.id}: efeitos da peça da Carla falharam (${codigoDe(err)})`); }
        if (!res.ok && Object.keys(patchCarla).length) await atualizarPosse(chave, patchCarla);
      }

      if (res.ok) {
        if (!dry) {
          if (!naoIncomodar) await atualizarPosse(chave, { ate_wa_id: L.id, respostas: posse.respostas + 1, ...patchCarla });
          await registrar(true);
        }
        r.enviadas++;
        dec({ resultado: naoIncomodar ? 'despedida_enviada' : 'enviada', ...base2 });
        return 'seguir';
      }
      const m = res.motivo;
      const extra = { ...base2, motivo: res.detalhe ? `${m}:${res.detalhe}` : m };
      switch (m) {
        case 'dry':
          dec({ resultado: naoIncomodar ? 'despedida_sairia' : 'sairia', ...extra, motivo: null, sairia: [bolha, ...(peca && !naoIncomodar ? [peca.tipo === 'imagem' ? `[imagem ${peca.slug}]` : peca.texto] : [])] });
          return 'seguir';
        case 'ja_respondido':
          if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
          dec({ resultado: 'ja_respondido', ...extra });
          return 'seguir';
        case 'espacamento':
          await soltar();
          r.parou = 'espacamento';
          dec({ resultado: 'espacamento', ...extra });
          return 'parar';
        case 'prazo':
          // Passou de 15 min durante a conversa com o modelo: ficha ao humano, sem bolha.
          await registrar(false, 'prazo');
          await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'prazo', bolha: false, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec });
          return 'seguir';
        case 'linha_pausada': case 'teto_agentes': case 'teto_linha':
          await soltar();                         // passageiro: a próxima rodada tenta de novo, dentro dos 15 min
          soma(r.puladas, `recusa_${m}`);
          dec({ resultado: 'recusada', ...extra });
          return 'seguir';
        case 'erro_linha':
          // O carimbo fica e a vez também: repetir só devolveria ja_respondido. Passou de 15 min, a fila vira ficha.
          // A linha está com problema: PARA a rodada inteira (não segue para a próxima conversa).
          await registrar(false, 'erro_linha');
          soma(r.puladas, 'recusa_erro_linha');
          r.parou = 'erro_linha';
          dec({ resultado: 'recusada', ...extra });
          return 'parar';
        case 'pediu_humano':
          // A supressão do telefone diz que a pessoa pediu gente: a agente não fala, e a conversa passa ao humano com
          // ficha, SEM bolha (a bolha seria uma fala do robô a quem pediu para não falar com robô).
          await registrar(false, 'pediu_humano');
          await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'pediu_humano', bolha: false, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec });
          return 'seguir';
        case 'bolha_invalida':
          // Sem fala segura (a bolha do modelo não passou nas regras do envio): é a trava, passa ao humano com ficha e,
          // só se a ficha saiu, a bolha fixa.
          await registrar(false, 'bolha_invalida');
          await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: res.detalhe !== 'sem_aviso_ia', card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: `bolha_invalida:${res.detalhe ?? ''}` });
          return 'seguir';
        default:                                   // pausa_humana, bloqueado, mudo, robo_do_outro_lado
          if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
          await registrar(false, m);
          soma(r.puladas, `recusa_${m}`);
          dec({ resultado: 'recusada', ...extra });
          return 'seguir';
      }
    };

    // 6b. A PASSAGEM POR REGRA (29/10/2026), antes do modelo: reembolso, ameaça jurídica e (só a Duda, em horário comercial) o pedido
    // de falar com uma pessoa são decididos aqui, por código. Com motivo o modelo NÃO é chamado: a saída sintética segue pelo MESMO
    // caminho de depois do modelo (releitura, ação, ficha antes da bolha, reservas, adiada e incerta). Sem motivo, ou com a regra
    // sem condição de agir (Carla/Helena no pedido de pessoa, fora do horário, sem nome da consultora), o modelo decide como sempre.
    const textosRegra = textosDoLead(comTranscricoes(entrada, cacheMidia));
    const valoresRegra = dona === 'duda' ? valoresDaPessoaDe(textosDoLead(comTranscricoes(msgs, cacheMidia)), dadosAnt) : [];
    let regra = motivoDePassagem(textosRegra.join(' '), dona as Persona, g.agoraEnvio());
    let bolhaRegra = '';
    if (regra?.motivo === 'pessoa') {
      const alvoR = oferta.alvo ?? alvoDaAgenda(cardSolarDoCtx(ctx0), kwhDoLead(dadosAnt, valoresRegra));
      const b = alvoR ? bolhaLigarAgoraOk(alvoR.dono) : null;
      // Sem consultora definida ou sem bolha fixa que caiba com o aviso de IA: a ficha sairia e a bolha seria recusada.
      if (!b || comAvisoSeFaltar(b, 'duda', jaApresentada(posse)) === null) regra = null; else bolhaRegra = b;
    } else if (regra) {
      bolhaRegra = bolhaDaPassagem(undefined, dona, jaApresentada(posse));
    }
    if (regra) {
      if (!dry) {
        // Condição do chefe anti-ban: a ficha sai ANTES da bolha, e a bolha é recusada se faltar espaço dos 10 s contra o último
        // ag5040_sent. Faltando (ou sem ler), nada sai: solta a vez e a próxima rodada tenta, ainda dentro dos 15 min.
        const esp = await espacamentoDoEnvio(g.agoraEnvio());
        if (esp !== 'ok') {
          await soltar();
          r.parou = 'espacamento';
          dec({ resultado: 'espacamento', motivo: `regra_${regra.motivo}:${esp}` });
          return 'parar';
        }
        if (await linhaLivre(g.agoraEnvio()) !== 'sim') {
          await soltar();
          soma(r.puladas, 'regra_linha_pausada');
          dec({ resultado: 'recusada', motivo: `regra_${regra.motivo}:linha_pausada` });
          return 'seguir';
        }
      }
      const saidaRegra: SaidaAgente = {
        bolhas: [bolhaRegra], acao: regra.motivo === 'pessoa' ? 'ligar_agora' : 'suporte_giovanna', peca: null, dados: {},
        resumo: `Regra ${regra.motivo}: ${regra.trecho}`, sabe_contexto: true,
      };
      const feitaPorRegra: ResultadoTurno = {
        pensamento: { falou: true, saida: saidaRegra, modelo: `regra:${regra.motivo}`, stop_reason: null, uso: { entrada: 0, cache_criado: 0, cache_lido: 0, saida: 0 } },
        qualificado: false, valoresDaPessoa: valoresRegra, midiasNovas: [],
      };
      const fim = await tratar(feitaPorRegra, 0, oferta);
      // O rastro da regra na posse SÓ se a passagem aconteceu de fato: a ação marcou esta fala como atendida (ate_wa_id) e nenhuma
      // chamada ao modelo da agente (`pensar`) entrou no meio. Ficha adiada, fala nova e prazo da rodada soltam a vez e deixam a posse como estava.
      if (!dry && chamadasDoPensar === 0) {
        const atual = await lerPosse(chave).catch(() => null);
        if (atual && atual.ate_wa_id === L.id) {
          await atualizarPosse(chave, { regra: { motivo: regra.motivo, em: g.agoraEnvio().toISOString() } });
        }
      }
      return fim;
    }

    return await tratar(await pensar(ctx), 0, oferta);
  } catch (err) {
    await soltar();
    logger.error(LOG, `conversa ${L.id}: erro interno (${codigoDe(err)})`);
    soma(r.puladas, 'erro_interno');
    return 'seguir';
  }
}

// ── passar ao humano: a ficha ao consultor ───────────────────────────────────

interface PedidoHumano {
  chave: string;
  tel: string | null;
  L: { id: number; momment: string };
  posse: DadosPosse;
  hmac: string;
  motivo: string;
  /** Mandar a bolha fixa depois da ficha (só sai se a ficha saiu). */
  bolha: boolean;
  card: CardResumo | null;
  /** Sem contexto montado: procura o card do telefone. */
  buscarCard: boolean;
  nome: string | null;
  dec: (d: Partial<DecisaoVivo> & { resultado: string }) => void;
  resumo?: string;
  dados?: Record<string, string>;
  acao?: string;
  detalhe?: string;
}

function textoDaFicha(p: PedidoHumano, card: CardResumo | null, destinoDono: string): string {
  const semCard = !card;
  const pseudo: CardDaFicha = card
    ? { id: card.id, vendedor_nome: card.vendedor_nome, quando: card.quando, cliente_nome: card.cliente_nome, cidade: card.cidade,
        observacao: card.observacao, created_by: card.created_by, created_at: card.created_at, status: card.status }
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: p.nome, cidade: null, observacao: null, created_by: 'lp_solar' };
  const base = p.motivo.startsWith('ferramenta:') ? `o cliente pediu algo que só a consultora faz (${p.motivo.slice('ferramenta:'.length)})` : (MOTIVO_LEGIVEL[p.motivo] ?? p.motivo);
  const extra = [
    `Conversa passada pela ${p.posse.dona === 'duda' || p.posse.dona === 'helena' ? NOME_DA_DONA[p.posse.dona] : 'agente'}: ${base}`,
    ...(semCard ? ['Ainda sem card na agenda'] : []),
    ...(p.resumo ? [`Resumo: ${p.resumo}`] : []),
    ...Object.entries(p.dados ?? {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`),
  ];
  const linhas = fichaDeCampos(pseudo, extra).linhas.filter(l => !(semCard && l.startsWith('Conversa completa:')));
  const topo = p.acao === 'orcamento_escrito' ? topoDoOrcamentoEscrito(card?.quando, Date.now()) : '';
  return textoDaMensagem(blocoSeguro(linhas), p.tel, [topo, destinoDono].filter(Boolean).join(' '));
}

const chaveFichaDaFala = (h: string): string => `ficha_lead:${h}`;

/**
 * Ficha ao consultor dono do card (ou ao dono, com o motivo na 1ª linha) e, só se ela saiu, a bolha fixa. A
 * reserva é POR FALA (ficha_lead:<hmac(chave|vivo|waId)>): repetir a rodada nunca manda duas fichas, e a ficha do
 * card (fichaTick) segue livre para o mesmo cliente. Ficha que PROVOU não sair (cooldown, credencial) desfaz a
 * reserva e deixa a posse viva (a próxima rodada tenta); ficha incerta (5xx, timeout) vira passou_humano sem bolha.
 */
async function passarAoHumano(g: G, p: PedidoHumano): Promise<void> {
  const { r, dry, agora } = g;
  let card = p.card;
  if (p.buscarCard) {
    try {
      const lista = await lerCards(p.chave);
      // A Helena passa o card de ELETROPOSTO (o do solar é de outro consultor).
      card = (p.posse.dona === 'helena' ? lista.find(c => ehOrigemEletroposto(c.created_by)) : lista[0]) ?? null;
    } catch { card = null; }
  }
  const nome = p.nome ?? card?.cliente_nome ?? null;
  const dec = (d: Partial<DecisaoVivo> & { resultado: string }): void =>
    p.dec({ acao: p.acao ?? null, motivo: p.detalhe ? `${p.motivo}:${String(p.detalhe).slice(0, 80)}` : p.motivo, ...d });
  const pedido = { ...p, nome };

  const hl = hmacDe(`${p.chave}|vivo|${p.L.id}`);
  const quem = String(card?.vendedor_nome ?? '').trim();
  let telCons: string | null = null;
  // Número de teste (hmac em ag5040_vivo_alvo.hmacs) ou alvo ilegível: a ficha vai SÓ ao dono, nunca à consultora.
  const ehTeste = dry ? false : await leadEhDeTeste(p.chave);
  const teste = !dry && ehTeste !== false;
  if (!dry && quem && !teste) {
    const t = await carregarTelefonesConsultores();
    telCons = telefoneDoConsultor(t.ok ? t.mapa : new Map(), quem);
  }
  const motivoDono = quem ? `Sem telefone cadastrado para o consultor ${quem.replace(/\s+/g, ' ').slice(0, 40)}.` : 'Card sem consultor dono.';
  const prefixoDono = teste ? (ehTeste === null ? PREFIXO_ALVO_ILEGIVEL : PREFIXO_TESTE) : telCons ? '' : `${motivoDono} Encaminhe esta ficha ao consultor certo.`;
  const texto = textoDaFicha(pedido, card, prefixoDono);

  if (dry) { dec({ resultado: 'passaria_ao_humano', ficha: 'ficharia', ...(p.bolha ? { sairia: [bolhaDaPassagem(p.acao, p.posse.dona, jaApresentada(p.posse))] } : {}) }); return; }

  const adiar = (): void => { soma(r.puladas, 'ficha_adiada'); dec({ resultado: 'ficha_adiada', ficha: 'adiada' }); };
  if (!hl || linhaIoEmCooldown()) { adiar(); return; }
  const chaveFicha = chaveFichaDaFala(hl);
  const reserva = await reservarChave(chaveFicha, { estado: 'reservada' }, agora);
  if (reserva === 'erro') { adiar(); return; }
  if (reserva === 'ja_existe') {
    // Já houve ficha (ou tentativa incerta) para esta fala: não manda outra, não promete nada, e a conversa sai da fila.
    await atualizarPosse(p.chave, { estado: 'passou_humano', ate_wa_id: p.L.id });
    dec({ resultado: 'passou_ao_humano', ficha: 'lead_ja_avisado' });
    return;
  }

  const destino = telCons ?? telefoneDoDono();
  try {
    await enviarFichaAoConsultor(destino, texto);
  } catch (err) {
    if (erroProvaQueNaoSaiu(err)) {
      await liberarChave(chaveFicha);
      adiar();
      return;
    }
    logger.error(LOG, `ficha da fala ${p.L.id} falhou (${codigoDe(err)}); pode ter saído`);
    await atualizarPosse(p.chave, { estado: 'passou_humano', ate_wa_id: p.L.id });
    dec({ resultado: 'passou_ao_humano', ficha: 'falhou' });
    return;
  }
  try { await supabase.from('system_state').update({ value: { estado: 'enviada' } }).eq('key', chaveFicha); } catch { /* o carimbo já existe */ }

  let patch: Partial<DadosPosse> = { estado: 'passou_humano', ate_wa_id: p.L.id };
  let enviadas = 0;
  const bolhaFixa = bolhaDaPassagem(p.acao, p.posse.dona, jaApresentada(p.posse));
  if (p.bolha && p.tel) {
    const res = await enviarAoLead(p.chave, p.posse, {
      dona: p.posse.dona as DonaViva, telefone: p.tel, waIdAlvo: p.L.id, momentoFalaLead: p.L.momment,
      bolha: bolhaFixa, dry: false,
    }, g.agoraEnvio());
    if (res.ok) { enviadas = 1; patch = { ...patch, respostas: p.posse.respostas + 1 }; }
    else dec({ resultado: 'bolha_recusada', motivo: res.motivo });
  }
  await atualizarPosse(p.chave, patch);
  r.enviadas += enviadas;
  dec({ resultado: 'passou_ao_humano', ficha: 'enviada', n_bolhas: enviadas, tamanho: enviadas ? bolhaFixa.length : 0 });
}

// ── as ações da Duda (B1d-2c): marcar, remarcar, ligar agora e suporte ───────────

const AVISO_HORARIO = 'AVISO DO SISTEMA: o horário que ele escolheu não pôde ser marcado (outra pessoa pegou antes, ou já não está livre). Diga isso numa frase curta e ofereça dois dos horários livres abaixo, e nenhum outro. Nesta resposta use a ação continuar.';
const AVISO_HELENA_VIVA = 'AVISO DO SISTEMA: o pedido de confirmação da reunião e o lembrete saem de outro sistema, e valem por cima do roteiro. Você nunca pede SIM, nunca promete lembrete e nunca escreve "confirmado" (só na ação confirmar_presenca, quando ele respondeu SIM e o sistema liberar). Remarcar e cancelar não são com você.';
const AVISO_HELENA_MARCAR = 'AVISO DO SISTEMA: ele ainda não tem reunião. Se escolher um horário da lista, use marcar_horario com dados horario igual ao texto da lista, e a sua bolha NÃO repete dia, hora nem consultor: diga só que a mensagem com os detalhes da reunião chega por aqui.';
const AVISO_HORARIO_EP = 'AVISO DO SISTEMA: o horário que ele escolheu não pôde ser marcado (outra pessoa pegou antes, ou já não está livre). Diga isso numa frase curta e ofereça dois dos horários livres abaixo, e nenhum outro. Nesta resposta use a ação continuar.';
const AVISO_PARAR = 'AVISO DO SISTEMA: o cliente pediu para parar ou não quer mais contato. Isso NÃO é estacionar. Use a ação nao_incomodar com uma despedida curta, sem pergunta e sem gancho.';
const AVISO_BOLHA_BARRADA = (motivo: string): string => `AVISO DO SISTEMA: a sua resposta foi barrada (${motivo}) e NÃO foi enviada. Reescreva sem pedir SIM, sem prometer lembrete e sem escrever "confirmado". Nesta resposta use a ação continuar.`;
const AVISO_LIGAR_INDISPONIVEL = 'AVISO DO SISTEMA: a ligação imediata NÃO está disponível agora (não deu para avisar a consultora). Não use ligar_agora e não prometa ligação em instantes. Explique numa frase e ofereça dois dos horários livres abaixo, e nenhum outro. Nesta resposta use a ação continuar.';
const AVISO_FORA_DO_HORARIO = 'AVISO DO SISTEMA: o horário comercial acabou, então a ligação imediata NÃO está disponível. Não use ligar_agora. Diga que a consultora liga no próximo dia útil e ofereça dois dos horários livres abaixo, e nenhum outro. Nesta resposta use a ação continuar.';

/** O que cada ação precisa saber do turno (o vivo monta uma vez por conversa e por tentativa). */
interface ContextoAcao {
  g: G;
  chave: string;
  tel: string;
  L: { id: number; momment: string };
  posse: DadosPosse;
  /** hmacDe(chave), inteiro. */
  hmac: string;
  ctx0: ContextoLead;
  /** As vagas que foram aos fatos DESTA tentativa: é com elas que a escolha da IA é casada. */
  oferta: Oferta;
  dadosAnt: Record<string, string>;
  resultado: ResultadoTurno;
  saida: SaidaAgente;
  base2: { acao: string; n_bolhas: number; tamanho: number };
  dec: (d: Partial<DecisaoVivo> & { resultado: string }) => void;
  registrar: (enviado: boolean, motivoSilencio?: string) => Promise<void>;
  soltar: () => Promise<void>;
  /** Nova chamada ao modelo com um aviso do sistema e as vagas novas (1 vez por fala). Sem vagas ou na 2ª vez: humano. */
  refazer: (aviso: string, n?: number) => Promise<Seguir>;
  /** Ficha ao consultor e a bolha fixa de passagem (a de sempre). */
  humano: (motivo: string, detalhe?: string) => Promise<Seguir>;
  /** Só a Helena (B2): o que as regras dela decidiram, o consultor e as vagas desta tentativa, e o que o lead escreveu. */
  ep?: { preparo: Extract<Veredicto, { tipo: 'seguir' }>; dono: string | null; vagas: string[]; textos: string[] };
}

type ResultadoFicha = 'enviada' | 'adiada' | 'ja_avisada' | 'incerta';

/**
 * UMA ficha da B1d ao consultor (ou ao dono). Ordem: linha em cooldown? > teto de emergência da linha (60/h e 450/24h,
 * a mesma conta do vivoEnvio) > reserva PRÓPRIA da ação por INSERT > ficha_lead:<hmac(chave|ação|card|n)> por INSERT >
 * envio. 'adiada' = PROVOU que nada saiu (a reserva volta); 'incerta' = 5xx ou timeout, pode ter saído (as reservas ficam);
 * 'ja_avisada' = a reserva já existia, nada é reenviado.
 */
async function enviarFichaVivo(g: G, p: {
  chave: string; acao: string; cardId: number; n: string; reserva: string; destino: string; texto: string;
  /** Quem chama quer o erro de uma ficha que ficou incerta (o reenvio ao dono conta o erro da linha, menos o do destino). */
  onErro?: (err: unknown) => void;
}): Promise<ResultadoFicha> {
  const hl = hmacDe(`${p.chave}|${p.acao}|${p.cardId}|${p.n}`);
  if (!hl || linhaIoEmCooldown()) return 'adiada';
  const teto = await tetoDaLinhaPermiteFicha(g.agoraEnvio());
  if (teto !== 'ok') { logger.error(LOG, `ficha ${p.acao} adiada: teto da linha (${teto})`); return 'adiada'; }
  const r1 = await reservarChave(p.reserva, { estado: 'reservada', acao: p.acao }, g.agora);
  if (r1 === 'erro') return 'adiada';
  if (r1 === 'ja_existe') return 'ja_avisada';
  const chaveLead = chaveFichaDaFala(hl);
  const r2 = await reservarChave(chaveLead, { estado: 'reservada', acao: p.acao }, g.agora);
  if (r2 === 'erro') { await liberarChave(p.reserva); return 'adiada'; }
  if (r2 === 'ja_existe') return 'ja_avisada';
  try {
    await enviarFichaAoConsultor(p.destino, p.texto);
  } catch (err) {
    if (erroProvaQueNaoSaiu(err)) { await liberarChave(p.reserva); await liberarChave(chaveLead); return 'adiada'; }
    logger.error(LOG, `ficha ${p.acao} falhou (${codigoDe(err)}); pode ter saído`);
    p.onErro?.(err);
    return 'incerta';
  }
  for (const k of [p.reserva, chaveLead]) {
    try { await supabase.from('system_state').update({ value: { estado: 'enviada', acao: p.acao } }).eq('key', k); } catch { /* o carimbo já existe */ }
  }
  return 'enviada';
}

/** O card do SOLAR do contexto: o mais novo DO SOLAR (o `card` do contexto pode ser de eletroposto e a Duda nunca mexe nele). */
const cardSolarDoCtx = (c: ContextoLead): CardResumo | null => (c.cardSolar !== undefined ? c.cardSolar : cardSolarDe(c.card));

/**
 * Para onde a ficha vai: o celular do consultor, ou o do dono com o motivo na 1ª linha. Lead que é NÚMERO DE TESTE (hmac em
 * ag5040_vivo_alvo.hmacs) vai SEMPRE ao dono, nunca à consultora; alvo ilegível também (o lead estava no escopo da rodada).
 */
async function destinoDaFicha(vendedor: string | null | undefined, chave: string): Promise<{ destino: string; prefixoDono: string }> {
  const ehTeste = await leadEhDeTeste(chave);
  if (ehTeste !== false) return { destino: telefoneDoDono(), prefixoDono: ehTeste === null ? PREFIXO_ALVO_ILEGIVEL : PREFIXO_TESTE };
  const quem = String(vendedor ?? '').trim();
  let telCons: string | null = null;
  if (quem) {
    const t = await carregarTelefonesConsultores();
    telCons = telefoneDoConsultor(t.ok ? t.mapa : new Map(), quem);
  }
  const motivo = quem ? `Sem telefone cadastrado para o consultor ${quem.replace(/\s+/g, ' ').slice(0, 40)}.` : 'Card sem consultor dono.';
  return { destino: telCons ?? telefoneDoDono(), prefixoDono: telCons ? '' : `${motivo} Encaminhe esta ficha ao consultor certo.` };
}

const linhasDoModelo = (s: SaidaAgente): string[] => [
  ...(s.resumo ? [`Resumo: ${s.resumo}`] : []),
  ...Object.entries(s.dados ?? {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`),
];

const cardDaFichaDe = (card: CardResumo): CardDaFicha => ({
  id: card.id, vendedor_nome: card.vendedor_nome, quando: card.quando, cliente_nome: card.cliente_nome, cidade: card.cidade,
  observacao: card.observacao, created_by: card.created_by, created_at: card.created_at, status: card.status,
});

const cidadeDoLead = (...fontes: Array<Record<string, string>>): string | null => {
  for (const f of fontes) {
    const c = String(f.cidade ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (c) return c;
  }
  return null;
};

/**
 * A ficha "remarcado" ao consultor do card, com reserva ficha_card:<id>:<novoIso>. `reenvio` usa o sufixo `:re` nas duas
 * reservas: é o 2º e último envio de uma ficha que saiu INCERTA (5xx, timeout), que com as mesmas chaves devolveria ja_avisada.
 */
async function enviarFichaRemarcada(g: G, p: {
  chave: string; tel: string; cardId: number; quandoAntes: string | null; iso: string; reenvio: boolean;
}): Promise<ResultadoFicha> {
  const card = await lerCardParaFicha(p.cardId);
  if (!card) return 'adiada';
  const { destino, prefixoDono } = await destinoDaFicha(card.vendedor_nome, p.chave);
  const extras = [`Remarcado pela Duda: ${p.quandoAntes ? `de ${quandoBR(p.quandoAntes)} ` : ''}para ${quandoBR(p.iso)}, a pedido do cliente`];
  const texto = textoDaMensagem(
    blocoSeguro(fichaDeCampos(card, extras).linhas), p.tel,
    ['REMARCADO: o cliente mudou o horário da ligação pelo WhatsApp.', prefixoDono].filter(Boolean).join(' '),
  );
  const sufixo = p.reenvio ? ':re' : '';
  return enviarFichaVivo(g, {
    chave: p.chave, acao: 'remarcar', cardId: p.cardId, n: `${p.iso}${sufixo}`, reserva: `ficha_card:${p.cardId}:${p.iso}${sufixo}`, destino, texto,
  });
}

/**
 * marcar_horario. O horário que a IA escolheu (dados.horario) é casado com a lista que foi aos fatos; o card é gravado
 * (ou o MESMO card do SOLAR é remarcado) ANTES de a bolha sair; a bolha do turno confirma (P1) e TEM que citar a hora do card
 * (senão sai o texto fixo de confirma ou remarca, pelo mesmo caminho). Depois que o card foi escrito, NENHUMA saída solta a
 * vez: repetir a fala gravaria outro card. Bolha recusada: só a recusa passageira vai para a fila de agenda (com texto de
 * reforço se o erro pode ter chegado); as outras passam ao humano, sem bolha e sem fila.
 */
async function acaoMarcar(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, resultado, dadosAnt, chave, tel, L, posse, hmac, dec } = A;
  const { r, dry } = g;
  const cardSol = cardSolarDoCtx(ctx0);
  const situacao = situacaoDoCard(cardSol);
  if (situacao === 'bloqueado') return A.humano('ferramenta:marcar_horario', 'card_de_gente');
  const kwh = kwhDoLead({ ...dadosAnt, ...saida.dados }, resultado.valoresDaPessoa);
  const alvo = A.oferta.alvo ?? alvoDaAgenda(cardSol, kwh);
  if (!alvo) return A.humano('ferramenta:marcar_horario', 'sem_gasto');
  const vagas = A.oferta.alvo ? A.oferta.vagas : (await ofertaDeHorarios(alvo, ctx0.agora)).vagas;
  const iso = acharVaga(saida.dados.horario, vagas, ctx0.agora);
  const bolha = saida.bolhas[0] ?? '';
  if (dry) {
    dec({ resultado: iso ? 'marcaria' : 'marcaria_sem_horario', ...A.base2, ...(iso && bolha ? { sairia: [bolha] } : {}) });
    return 'seguir';
  }
  if (!iso) return A.refazer(AVISO_HORARIO);

  const card = cardSolarDe(cardSol);
  let cardId = 0;
  let criado = false;
  let tipo: 'confirma' | 'remarca' = 'confirma';
  let quandoAntes: string | null = null;
  let remarcou = false;
  if (situacao === 'remarcavel' && card) {
    cardId = card.id;
    // 27/10/2026: card SAIU SEM MARCAR (o cliente nunca escolheu horário): a mensagem é sempre `confirma` ("Ficou marcado para..."), nunca
    // `remarca` ("mudei sua ligação" fala de um horário que ele nunca soube), e o card perde a marca SAIU/MUDO.
    const eraSaiu = ehCardSaiu(card.observacao);
    if (Date.parse(String(card.quando ?? '')) !== Date.parse(iso)) {
      const rr = await remarcarCardSolar(card.id, iso, { faixa: alvo.faixa });
      if (rr === 'horario_tomado' || rr === 'horario_fora_da_grade') return A.refazer(AVISO_HORARIO);
      if (rr !== 'ok') return A.humano('ferramenta:marcar_horario', `remarcar:${rr}`);
      remarcou = true;
      if (!eraSaiu) tipo = 'remarca';
      quandoAntes = card.quando;
    } else if (eraSaiu) {
      // O MESMO horário do card: nada é remarcado, mas a marca SAIU sai do mesmo jeito (e bom dia e "oi" de 5 min voltam à régua do dia).
      // Sem tirar a marca (e carimbar boas_vindas_at) a abertura da agenda ainda mandaria um 2º "Ficou marcado": passa ao humano, sem bolha.
      if (!(await tirarMarcaSaiuDoCard(card.id))) return A.humano('ferramenta:marcar_horario', 'tirar_marca:erro');
    }
  } else {
    const gr = await gravarCardSolar({
      dono: alvo.dono, quando: iso, nome: String(ctx0.nome ?? '').trim() || 'Cliente', tel,
      cidade: cidadeDoLead(saida.dados, dadosAnt), observacao: observacaoDoCardDaDuda(kwh),
    }, { faixa: 'novo' });
    if (gr.status === 'horario_tomado' || gr.status === 'horario_fora_da_grade') return A.refazer(AVISO_HORARIO);
    if (gr.status === 'erro') return A.humano('ferramenta:marcar_horario', 'gravar:erro');
    cardId = gr.card.id;
    criado = true;
  }

  // A PARTIR DAQUI O CARD ESTÁ ESCRITO: nada solta a vez, e erro nenhum sobe para o catch da conversa.
  let parar: 'erro_linha' | 'espacamento' | null = null;
  const agoraE = g.agoraEnvio();
  // A fala do modelo só vai se citar a hora do card (14h30, 14:30, 14h). Senão sai o texto fixo, pelo mesmo caminho.
  const fixa = bolhaDeConfirmacao(tipo, iso, alvo.dono, agoraE.toISOString());
  const bolhaFinal = citaAHora(bolha, iso) ? bolha : (fixa ?? '');
  try {
    const res: ResultadoEnvio = bolhaFinal
      ? await enviarAoLead(chave, posse, { dona: 'duda', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha: bolhaFinal, dry: false }, agoraE)
      : { ok: false, motivo: 'bolha_invalida', detalhe: 'sem_bolha' };
    if (res.ok) {
      if (criado) await marcarBoasVindasEnviada(cardId);
      await atualizarPosse(chave, { ate_wa_id: L.id, respostas: posse.respostas + 1 });
      await A.registrar(true);
      r.enviadas++;
      dec({ resultado: tipo === 'remarca' ? 'remarcou' : 'marcou', ...A.base2, ...(bolhaFinal !== bolha ? { motivo: 'bolha_fixa' } : {}) });
    } else {
      const destino = destinoDaRecusa(res);
      const motivo = res.detalhe ? `${res.motivo}:${res.detalhe}` : res.motivo;
      soma(r.puladas, `acao_recusa_${res.motivo}`);
      await A.registrar(false, `acao_recusada:${res.motivo}`);
      if (destino === 'humano') {
        // Recusa que não é passageira: o card fica, a conversa passa ao humano com ficha e SEM bolha nem fila.
        await passarAoHumano(g, {
          chave, tel, L, posse, hmac, motivo: 'ferramenta:marcar_horario', bolha: false, card: null, buscarCard: true, nome: ctx0.nome, dec,
          resumo: saida.resumo, dados: saida.dados, acao: saida.acao, detalhe: `recusa:${res.motivo}`,
        });
      } else {
        // A confirmação não se perde: a fila de agenda leva a bolha fixa (e o vivo não tenta de novo a mesma fala).
        const enf = await enfileirarAgenda({
          tipo, cardId, telefone: tel, quando: iso, validoAte: iso, consultora: primeiroNome(alvo.dono),
          ...(destino === 'fila_reforco' ? { reforco: true } : {}),
        }, agoraE);
        await atualizarPosse(chave, { ate_wa_id: L.id });
        if (!enf.ok) logger.error(LOG, `a confirmação do card ${cardId} não entrou na fila (${enf.motivo})`);
        dec({ resultado: enf.ok ? 'confirmacao_enfileirada' : 'confirmacao_nao_enfileirada', ...A.base2, motivo });
      }
      if (res.motivo === 'erro_linha' || res.motivo === 'espacamento') parar = res.motivo;
    }
    if (remarcou) {
      const rf = await enviarFichaRemarcada(g, { chave, tel, cardId, quandoAntes, iso, reenvio: false });
      dec({ resultado: 'ficha_remarcado', ficha: rf === 'enviada' ? 'enviada' : rf === 'adiada' ? 'adiada' : rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou' });
      // Saiu adiada (teto, cooldown) ou incerta: vira pendência na posse e a varredura da rodada tenta de novo.
      if (rf === 'adiada' || rf === 'incerta') {
        await atualizarPosse(chave, { remarcado: { cardId, de: quandoAntes, para: iso, wa_id: L.id, tentativas: 1, incerta: rf === 'incerta', em: agoraE.toISOString() } });
      }
    }
  } catch (err) {
    logger.error(LOG, `conversa ${L.id}: erro depois de gravar o card ${cardId} (${codigoDe(err)})`);
    soma(r.puladas, 'erro_depois_de_gravar');
    await atualizarPosse(chave, { ate_wa_id: L.id });
  }
  if (parar) { r.parou = parar; return 'parar'; }
  return 'seguir';
}

/**
 * ligar_agora (só em horário comercial). Card existente do SOLAR, ou card novo com lembrete e bom dia já preenchidos; a ficha
 * "LIGAR AGORA" sai ANTES da bolha, com reserva PRÓPRIA por dia (ag5040_ligar:<cardId>:<dia>); só se ela saiu a bolha promete
 * a ligação. Ficha que PROVOU não sair (adiada): o card criado agora é desfeito e a IA é chamada de novo, sem a opção de
 * ligar agora. Ficha INCERTA (5xx, timeout) ou já avisada: o card fica e a conversa passa ao humano, sem bolha e sem negar.
 */
async function acaoLigarAgora(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, resultado, dadosAnt, chave, tel, L, posse, dec } = A;
  const { r, dry } = g;
  const cardSol = cardSolarDoCtx(ctx0);
  const situacao = situacaoDoCard(cardSol);
  if (situacao === 'bloqueado') return A.humano('ferramenta:ligar_agora', 'card_de_gente');
  const kwh = kwhDoLead({ ...dadosAnt, ...saida.dados }, resultado.valoresDaPessoa);
  const alvo = A.oferta.alvo ?? alvoDaAgenda(cardSol, kwh);
  if (!alvo) return A.humano('ferramenta:ligar_agora', 'sem_gasto');
  const agoraE = g.agoraEnvio();
  const bolha = saida.bolhas[0] || bolhaLigarAgoraOk(alvo.dono) || '';
  if (!horarioComercial(agoraE)) {
    if (dry) { dec({ resultado: 'ligaria_fora_do_horario', ...A.base2 }); return 'seguir'; }
    return A.refazer(AVISO_FORA_DO_HORARIO, 2);   // fora do horário comercial: vira marcar (2 vagas)
  }
  if (dry) { dec({ resultado: 'ligaria_agora', ...A.base2, ...(bolha ? { sairia: [bolha] } : {}) }); return 'seguir'; }

  const card = cardSolarDe(cardSol);
  let cardId = 0;
  let criado = false;
  let cardFicha: CardDaFicha | null = null;
  if (situacao === 'remarcavel' && card) {
    cardId = card.id;
    cardFicha = cardDaFichaDe(card);
    // 27/10/2026: card SAIU SEM MARCAR em "ligar agora": o TEXTO da ficha da consultora sai com a 1ª linha normal. A marca do card só sai
    // DEPOIS que a ficha saiu (depoisDaFicha): ficha adiada ou já avisada deixa o card como estava.
    if (ehCardSaiu(card.observacao)) cardFicha = { ...cardFicha, observacao: semMarcaSaiu(card.observacao) };
  } else {
    // Ligar agora não tem grade: o horário é "agora". A rota da LP não confere nada aqui (sem faixa).
    const gr = await gravarCardSolar({
      dono: alvo.dono, quando: agoraE.toISOString(), nome: String(ctx0.nome ?? '').trim() || 'Cliente', tel,
      cidade: cidadeDoLead(saida.dados, dadosAnt), observacao: observacaoDoCardDaDuda(kwh),
    }, { ligarAgora: true });
    if (gr.status !== 'ok') return A.humano('ferramenta:ligar_agora', `gravar:${gr.status}`);
    cardId = gr.card.id;
    criado = true;
    cardFicha = (await lerCardParaFicha(cardId))
      ?? { id: cardId, vendedor_nome: alvo.dono, quando: agoraE.toISOString(), cliente_nome: String(ctx0.nome ?? '') || null, cidade: null, observacao: null, created_by: 'lp_solar' };
  }

  const { destino, prefixoDono } = await destinoDaFicha(alvo.dono, chave);
  const extras = ['Pedido: o cliente aceitou receber a ligação AGORA e espera o telefone tocar', ...linhasDoModelo(saida)];
  const texto = textoDaMensagem(
    blocoSeguro(fichaDeCampos(cardFicha, extras).linhas), tel,
    ['LIGAR AGORA: ligue para este cliente em instantes.', prefixoDono].filter(Boolean).join(' '),
  );
  const rf = await enviarFichaVivo(g, {
    chave, acao: 'ligar', cardId, n: String(L.id), reserva: `ag5040_ligar:${cardId}:${diaBRT(agoraE)}`, destino, texto,
  });
  const avisadoEm = agoraE.toISOString();
  const ligar = {
    cardId, avisado_em: avisadoEm, dono: alvo.dono, faixa: alvo.faixa, criado,
    status_inicial: String(card?.status ?? 'agendado'),
  };
  /** Ficha que saiu (ou pode ter saído): o card não recebe boas-vindas nem lembrete de 5 min por cima do aviso. */
  const depoisDaFicha = async (): Promise<void> => {
    if (criado) await marcarBoasVindasEnviada(cardId);
    else {
      // Card SAIU: tira a marca (e carimba boas_vindas_at) ANTES de silenciar; o silenciar recarimba o bom dia e o "oi" que o tirar zerou.
      if (card && ehCardSaiu(card.observacao)) await tirarMarcaSaiuDoCard(cardId);
      await silenciarLembretesDoCard(cardId);
    }
  };

  if (rf === 'adiada') {
    // PROVADO que nada saiu: desfaz o card criado agora e oferece horário.
    let desfeito = true;
    if (criado) {
      desfeito = await desfazerCardSolar(cardId);
      // O fichaTick não manda ficha de um card que a Duda acabou de negar ao cliente (ele já ignora 'cancelado'; a reserva é a rede).
      await reservarChave(`ficha_card:${cardId}`, { estado: 'card_desfeito' }, g.agora);
      if (!desfeito) logger.error(LOG, `o card ${cardId} do ligar agora não foi desfeito`);
    }
    soma(r.puladas, 'ligar_ficha_nao_saiu');
    dec({ resultado: 'ligar_ficha_nao_saiu', ...A.base2, ficha: 'adiada', ...(desfeito ? {} : { motivo: 'card_nao_desfeito' }) });
    return A.refazer(AVISO_LIGAR_INDISPONIVEL, 2);
  }
  if (rf !== 'enviada') {
    // INCERTA (5xx, timeout) ou já avisada: a consultora pode ter a ficha. O card FICA, nada é negado ao cliente e nenhuma
    // promessa nova sai: passa ao humano. Com ficha incerta a volta honesta cobre o silêncio (15 min depois, sem sinal).
    try {
      if (rf === 'incerta') await depoisDaFicha();
      // Plano B: `incerta` + o que o reenvio ao dono precisa (wa_id da fala, resumo). 10 min sem sinal da ligação e o dono recebe a ficha.
      await atualizarPosse(chave, {
        estado: 'passou_humano', ate_wa_id: L.id,
        ...(rf === 'incerta' ? { ligar: { ...ligar, incerta: true, wa_id: L.id, resumo: String(saida.resumo ?? '').slice(0, 200) } } : {}),
      });
      await A.registrar(false, `ligar_ficha_${rf}`);
    } catch (err) {
      logger.error(LOG, `conversa ${L.id}: erro depois da ficha incerta do ligar agora (${codigoDe(err)})`);
      soma(r.puladas, 'erro_depois_de_gravar');
      await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id });
    }
    soma(r.puladas, `ligar_ficha_${rf}`);
    dec({ resultado: 'passou_ao_humano', ...A.base2, ficha: rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou', motivo: `ligar_ficha_${rf}` });
    return 'seguir';
  }

  // A FICHA SAIU: a consultora foi avisada. Daqui nada solta a vez.
  let parar: 'erro_linha' | 'espacamento' | null = null;
  try {
    await depoisDaFicha();
    // O fichaTick não duplica: o card novo já tem a sua ficha.
    if (criado) await reservarChave(`ficha_card:${cardId}`, { estado: 'enviada', origem: 'ligar_agora' }, g.agora);
    const res: ResultadoEnvio = bolha
      ? await enviarAoLead(chave, posse, { dona: 'duda', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, agoraE)
      : { ok: false, motivo: 'bolha_invalida', detalhe: 'sem_bolha' };
    await atualizarPosse(chave, { ate_wa_id: L.id, ligar, ...(res.ok ? { respostas: posse.respostas + 1 } : {}) });
    await A.registrar(res.ok, res.ok ? undefined : `acao_recusada:${res.motivo}`);
    if (res.ok) { r.enviadas++; dec({ resultado: 'ligar_agora', ...A.base2, ficha: 'enviada' }); }
    else {
      soma(r.puladas, `acao_recusa_${res.motivo}`);
      dec({ resultado: 'ligar_bolha_recusada', ...A.base2, ficha: 'enviada', motivo: res.detalhe ? `${res.motivo}:${res.detalhe}` : res.motivo });
      if (res.motivo === 'erro_linha' || res.motivo === 'espacamento') parar = res.motivo;
    }
  } catch (err) {
    logger.error(LOG, `conversa ${L.id}: erro depois da ficha do ligar agora (${codigoDe(err)})`);
    soma(r.puladas, 'erro_depois_de_gravar');
    await atualizarPosse(chave, { ate_wa_id: L.id });
  }
  if (parar) { r.parou = parar; return 'parar'; }
  return 'seguir';
}

/**
 * orçamento por escrito (só a Duda). O cliente pediu o orçamento por mensagem e NÃO quer ligação: a ficha vai à consultora do solar
 * (a MESMA escolha do ligar_agora: o dono do card remarcável, ou a da faixa de kWh) com "PEDIU ORÇAMENTO POR ESCRITO, NÃO LIGAR" no
 * topo, e SÓ se a ficha saiu a bolha FIXA diz que a consultora manda o orçamento por aqui. A bolha do modelo nunca vai. Não cria card
 * (criar dispararia boas-vindas e lembrete de ligação). O link da conversa só existe com card. Sem consultora definida (sem card e
 * sem kWh) ou card de gente: passa ao humano pelo caminho de sempre. Ficha adiada: solta a vez e tenta na próxima rodada. Ficha
 * incerta ou já avisada: passou_humano sem bolha. Nos finais com ficha a posse vai para passou_humano. A agenda nunca bloqueia: o card
 * NÃO é silenciado (bom dia e toque de 5 min seguem); com reunião futura a ficha avisa a consultora para combinar com ele.
 */
async function acaoOrcamentoEscrito(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, resultado, dadosAnt, chave, tel, L, posse, hmac, dec } = A;
  const { r, dry } = g;
  const cardSol = cardSolarDoCtx(ctx0);
  const situacao = situacaoDoCard(cardSol);
  if (situacao === 'bloqueado') return A.humano('ferramenta:orcamento_escrito', 'card_de_gente');
  const dadosJuntos = { ...dadosAnt, ...saida.dados };
  const kwh = kwhDoLead(dadosJuntos, resultado.valoresDaPessoa);
  const alvo = A.oferta.alvo ?? alvoDaAgenda(cardSol, kwh);
  if (!alvo) return A.humano('ferramenta:orcamento_escrito', 'sem_gasto');
  const bolha = BOLHA_ORCAMENTO_ESCRITO;
  if (dry) { dec({ resultado: 'passaria_orcamento_escrito', ...A.base2, ficha: 'ficharia', sairia: [bolha] }); return 'seguir'; }

  const card = situacao === 'remarcavel' ? cardSolarDe(cardSol) : null;
  const dados = dadosDoLeadParaFicha({
    dados: dadosJuntos, cidades: [card?.cidade, ctx0.leadsMeta?.cidade, ...ctx0.cadastros.map(c => c.cidade)], kwh,
  });
  const nome = String(ctx0.nome ?? '').trim();
  const cardFicha: CardDaFicha = card
    ? cardDaFichaDe(card)
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: nome || null, cidade: dados['Cidade'] ?? null, observacao: null, created_by: 'lp_solar' };
  const temFoto = ctx0.msgs.some(m => m.autor === 'lead' && (m.tipo === 'image' || m.tipo === 'imagem'));
  const { destino, prefixoDono } = await destinoDaFicha(alvo.dono, chave);
  const linhas = fichaDeCampos(cardFicha, linhasDoOrcamentoEscrito({ dados, temFoto, comLigacaoMarcada: Date.parse(String(card?.quando ?? '')) > g.agoraEnvio().getTime() })).linhas.filter(l => !(!card && l.startsWith('Conversa completa:')));
  const texto = textoDaMensagem(blocoSeguro(linhas), tel, [topoDoOrcamentoEscrito(card?.quando, g.agoraEnvio().getTime()), prefixoDono].filter(Boolean).join(' '));
  const rf = await enviarFichaVivo(g, {
    chave, acao: 'orcamento', cardId: card?.id ?? 0, n: String(L.id), reserva: `ag5040_orcamento:${hmac}:${L.id}`, destino, texto,
  });
  if (rf === 'adiada') {
    await A.soltar();                      // nada saiu: a próxima rodada tenta de novo, dentro dos 15 min
    soma(r.puladas, 'ficha_adiada');
    dec({ resultado: 'ficha_adiada', ...A.base2, ficha: 'adiada' });
    return 'seguir';
  }
  if (rf !== 'enviada') {
    // Já avisada ou incerta: a consultora pode ter a ficha, e uma bolha prometeria o que não se confirmou. Sem bolha.
    await A.registrar(false, 'ferramenta:orcamento_escrito');
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id });
    dec({ resultado: 'passou_ao_humano', ...A.base2, ficha: rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou' });
    return 'seguir';
  }
  let parar: 'erro_linha' | 'espacamento' | null = null;
  try {
    const res = await enviarAoLead(chave, posse, { dona: 'duda', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, g.agoraEnvio());
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id, ...(res.ok ? { respostas: posse.respostas + 1 } : {}) });
    await A.registrar(res.ok, res.ok ? undefined : `acao_recusada:${res.motivo}`);
    if (res.ok) r.enviadas++;
    else if (res.motivo === 'erro_linha' || res.motivo === 'espacamento') parar = res.motivo;
    dec({
      resultado: 'orcamento_escrito', ...A.base2, ficha: 'enviada', n_bolhas: res.ok ? 1 : 0, tamanho: res.ok ? bolha.length : 0,
      ...(res.ok ? {} : { motivo: `bolha_recusada:${res.motivo}` }),
    });
  } catch (err) {
    logger.error(LOG, `conversa ${L.id}: erro depois da ficha do orçamento por escrito (${codigoDe(err)})`);
    soma(r.puladas, 'erro_depois_de_gravar');
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id });
  }
  if (parar) { r.parou = parar; return 'parar'; }
  return 'seguir';
}

// ── as ações da Helena (B2): marcar sem card e responder o SIM ───────────────

/**
 * marcar_horario da Helena. SÓ para quem não tem card de eletroposto em NENHUM status (as regras de helenaEp.ts já mandaram
 * quem tem card para o robô de remarcação ou para o humano). O consultor saiu do donoDoTelefone/rodízio ANTES da IA e é o
 * mesmo das vagas; o horário que a IA nomeou é casado com a lista, conferido com aindaLivre logo antes e gravado por
 * gravarCardEletroposto (created_by agente_eletroposto, confirmacao_at NULO: é o gatilho da confirmação oficial do ep_agenda,
 * que é quem pede o SIM). Horário tomado (23505) = no máximo UMA nova chamada à IA. A bolha sai na MESMA rodada, logo depois
 * do insert, sem dia, hora, consultor, "confirmado" nem SIM; recusada, não vai para fila nenhuma (o ep_agenda confirma de
 * qualquer jeito). Card escrito: nenhuma saída solta a vez. A pendência de 10 minutos fica na posse (ep_marcou).
 */
async function acaoMarcarEp(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, dadosAnt, chave, tel, L, posse, dec } = A;
  const { r, dry } = g;
  const ep = A.ep!;
  if (!ep.preparo.semCard) return A.humano(`ferramenta:${saida.acao}`, 'helena_com_card');
  if (!ep.dono) return A.humano(`ferramenta:${saida.acao}`, 'sem_consultor');
  const iso = acharVagaEp(saida.dados.horario, ep.vagas, ctx0.agora);
  const nome = String(ctx0.nome ?? '').trim();
  const bolhaIa = saida.bolhas[0] ?? '';
  const bolha = bolhaIa && bolhaSemDetalhe(bolhaIa) ? bolhaIa : bolhaCardCriado(nome);
  if (dry) {
    dec({ resultado: iso ? 'marcaria' : 'marcaria_sem_horario', ...A.base2, ...(iso ? { sairia: [bolha] } : {}) });
    return 'seguir';
  }
  if (!iso) return A.refazer(AVISO_HORARIO_EP);
  if (!(await aindaLivreEp(iso, ep.dono))) return A.refazer(AVISO_HORARIO_EP);

  const cidade = cidadeDoLead(saida.dados, dadosAnt) ?? ctx0.cadastros.find(c => c.cidade)?.cidade ?? ctx0.leadsMeta?.cidade ?? null;
  // Relê os cards do telefone logo antes de gravar: card que nasceu depois das regras vai ao humano com a ficha.
  const gr = await gravarCardSeNaoHouver(chave, fichaDoCardEp({ dono: ep.dono, iso, nome, tel, cidade, dados: { ...dadosAnt, ...saida.dados } }));
  if (gr.status === 'ja_tem_card') return A.humano(`ferramenta:${saida.acao}`, 'helena_com_card');
  if (gr.status === 'tomado') return A.refazer(AVISO_HORARIO_EP);
  if (gr.status === 'bloqueado') {
    // Fora do padrão: nenhuma ficha nasce e ninguém escreve.
    await atualizarPosse(chave, { ate_wa_id: L.id });
    await A.registrar(false, 'bloqueado');
    soma(r.puladas, 'helena_bloqueado');
    dec({ resultado: 'calou', ...A.base2, motivo: 'bloqueado' });
    return 'seguir';
  }
  if (gr.status === 'erro') return A.humano('ferramenta:marcar_horario', 'gravar:erro');

  // A PARTIR DAQUI O CARD ESTÁ ESCRITO: nada solta a vez, e erro nenhum sobe para o catch da conversa.
  let parar: 'erro_linha' | 'espacamento' | null = null;
  const agoraE = g.agoraEnvio();
  try {
    const marcou: EpMarcou = { cardId: gr.id, em: agoraE.toISOString(), wa_id: L.id, dono: ep.dono };
    await atualizarPosse(chave, { ep_marcou: marcou });
    const res: ResultadoEnvio = await enviarAoLead(chave, posse, { dona: 'helena', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, agoraE);
    if (res.ok) {
      await atualizarPosse(chave, { ate_wa_id: L.id, respostas: posse.respostas + 1 });
      await A.registrar(true);
      r.enviadas++;
      dec({ resultado: 'marcou', ...A.base2, n_bolhas: 1, tamanho: bolha.length, ...(bolha !== bolhaIa ? { motivo: 'bolha_fixa' } : {}) });
    } else {
      // Sem fila: a confirmação oficial do ep_agenda sai de qualquer jeito.
      await atualizarPosse(chave, { ate_wa_id: L.id });
      await A.registrar(false, `acao_recusada:${res.motivo}`);
      soma(r.puladas, `acao_recusa_${res.motivo}`);
      dec({ resultado: 'marcou_sem_bolha', ...A.base2, motivo: res.detalhe ? `${res.motivo}:${res.detalhe}` : res.motivo });
      if (res.motivo === 'erro_linha' || res.motivo === 'espacamento') parar = res.motivo;
    }
  } catch (err) {
    logger.error(LOG, `conversa ${L.id}: erro depois de gravar o card ${gr.id} (${codigoDe(err)})`);
    soma(r.puladas, 'erro_depois_de_gravar');
    await atualizarPosse(chave, { ate_wa_id: L.id });
  }
  if (parar) { r.parou = parar; return 'parar'; }
  return 'seguir';
}

/**
 * confirmar_presenca da Helena = SÓ a bolha (quem grava a presença é o ep_respostas). Sai se, e só se: a fala é afirmativa de
 * verdade (confirmouMesmo, a regra dele), o card relido está 'agendado' com presenca_confirmada_at já gravada, e é a 1ª vez
 * neste card (ag5040_helena_presenca:<id> por INSERT). Qualquer outra coisa = silêncio: nunca diz "confirmado" sem prova.
 */
async function acaoPresenca(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, chave, tel, L, posse, dec } = A;
  const { r, dry } = g;
  const ep = A.ep!;
  const calar = async (motivo: string): Promise<Seguir> => {
    if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
    await A.registrar(false, `presenca:${motivo}`);
    soma(r.puladas, `helena_presenca_${motivo}`);
    dec({ resultado: 'calou', ...A.base2, motivo });
    return 'seguir';
  };
  const prova = await provaDaPresenca(ep.preparo.cards, ep.textos);
  if (!prova.ok) return calar(prova.motivo);
  // A bolha da IA só vale quando a ação dela foi confirmar_presenca; em qualquer outra, a fala era de outro assunto.
  const bolhaIa = saida.acao === 'confirmar_presenca' ? (saida.bolhas[0] ?? '') : '';
  const bolha = bolhaIa && violacaoDaBolha(bolhaIa, true) === null ? bolhaIa : bolhaPresencaAnotada(ctx0.nome);
  if (dry) { dec({ resultado: 'responderia_sim', ...A.base2, sairia: [bolha] }); return 'seguir'; }

  const chaveReserva = `${PREFIXO_PRESENCA}${prova.cardId}`;
  const reserva = await reservarChave(chaveReserva, { estado: 'reservada' }, g.agora);
  if (reserva === 'ja_existe') return calar('ja_respondida');
  if (reserva === 'erro') { await A.soltar(); soma(r.puladas, 'helena_presenca_reserva_falhou'); dec({ resultado: 'recusada', ...A.base2, motivo: 'reserva_falhou' }); return 'seguir'; }

  const res: ResultadoEnvio = await enviarAoLead(chave, posse, { dona: 'helena', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, g.agoraEnvio());
  if (res.ok) {
    await atualizarPosse(chave, { ate_wa_id: L.id, respostas: posse.respostas + 1 });
    await A.registrar(true);
    r.enviadas++;
    dec({ resultado: 'enviada', ...A.base2, n_bolhas: 1, tamanho: bolha.length });
    return 'seguir';
  }
  const m = res.motivo;
  const extra = { ...A.base2, motivo: res.detalhe ? `${m}:${res.detalhe}` : m };
  switch (m) {
    case 'linha_pausada': case 'teto_agentes': case 'teto_linha': case 'espacamento':
      // Passageira: nada saiu. Devolve a reserva e a vez; a próxima rodada tenta de novo, dentro dos 15 min.
      await liberarChave(chaveReserva);
      await A.soltar();
      soma(r.puladas, `recusa_${m}`);
      dec({ resultado: 'recusada', ...extra });
      if (m === 'espacamento') { r.parou = 'espacamento'; return 'parar'; }
      return 'seguir';
    case 'erro_linha':
      await A.registrar(false, 'erro_linha');
      soma(r.puladas, 'recusa_erro_linha');
      r.parou = 'erro_linha';
      dec({ resultado: 'recusada', ...extra });
      return 'parar';
    default:                                   // ja_respondido, prazo, pausa_humana, bloqueado, mudo, robo_do_outro_lado, bolha_invalida...
      await atualizarPosse(chave, { ate_wa_id: L.id });
      await A.registrar(false, m);
      soma(r.puladas, `recusa_${m}`);
      dec({ resultado: 'recusada', ...extra });
      return 'seguir';
  }
}

/**
 * suporte_giovanna. Ficha completa à Giovanna (reserva ag5040_suporte:<hmac>:<waId>); só se ela saiu a bolha do turno
 * diz que a Giovanna fala com ele; a posse passa a humano e lead_data.suporte guarda o aviso (o reenvio ao dono vem depois).
 * Número de teste: a ficha vai ao dono, não à Giovanna.
 */
/** Destino da ficha de suporte: a Giovanna (ou o dono, com o motivo na 1ª linha, se o lead é de teste, o alvo é ilegível ou falta o telefone dela). */
async function destinoDoSuporte(chave: string): Promise<{ destino: string; prefixoDono: string }> {
  let destino = telefoneDoDono();
  const ehTeste = await leadEhDeTeste(chave);
  let prefixoDono = ehTeste === null ? PREFIXO_ALVO_ILEGIVEL : PREFIXO_TESTE;
  if (ehTeste === false) {
    const t = await carregarTelefonesConsultores();
    const telGiovanna = telefoneDoConsultor(t.ok ? t.mapa : new Map(), 'Giovanna');
    destino = telGiovanna ?? telefoneDoDono();
    prefixoDono = telGiovanna ? '' : 'Sem telefone cadastrado para a Giovanna. Encaminhe esta ficha a ela.';
  }
  return { destino, prefixoDono };
}

/**
 * A Carla viu que o lead já tem conta: a fala dele vai à Giovanna como suporte, sem bolha ao lead e sem IA. A reserva é a
 * mesma do suporte (ag5040_suporte:<hmac>:<waId>), então repetir a rodada nunca manda duas fichas.
 */
async function fichaDoClienteComConta(g: G, p: {
  chave: string; tel: string | null; L: { id: number; momment: string }; hmac: string; ctx0: ContextoLead;
}): Promise<ResultadoFicha> {
  const { destino, prefixoDono } = await destinoDoSuporte(p.chave);
  const card = p.ctx0.card;
  const cardFicha: CardDaFicha = card
    ? cardDaFichaDe(card)
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: p.ctx0.nome, cidade: null, observacao: null, created_by: 'lp_solar' };
  const ultima = [...p.ctx0.msgs].reverse().find(m => m.autor === 'lead' && String(m.texto ?? '').trim());
  const extras = [
    'Conversa passada pela Carla: o lead já tem conta no SolarDoc e a conversa saiu da Carla. A fala dele ficou sem resposta, atenda',
    ...(ultima ? [`Última fala dele: ${String(ultima.texto).replace(/\s+/g, ' ').trim().slice(0, 200)}`] : []),
  ];
  const linhas = fichaDeCampos(cardFicha, extras).linhas.filter(l => !(!card && l.startsWith('Conversa completa:')));
  const texto = textoDaMensagem(
    blocoSeguro(linhas), p.tel,
    ['SUPORTE: a Carla passou este cliente para a Giovanna.', prefixoDono].filter(Boolean).join(' '),
  );
  return enviarFichaVivo(g, { chave: p.chave, acao: 'suporte', cardId: card?.id ?? 0, n: String(p.L.id), reserva: `ag5040_suporte:${p.hmac}:${p.L.id}`, destino, texto });
}

async function acaoSuporte(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, chave, tel, L, posse, hmac, dec } = A;
  const { r, dry } = g;
  const donaNome = NOME_DA_DONA[posse.dona] ?? 'agente';
  const bolha = saida.bolhas[0] || bolhaDaPassagem(undefined, posse.dona, jaApresentada(posse));
  if (dry) { dec({ resultado: 'passaria_ao_humano', ...A.base2, ficha: 'ficharia', sairia: [bolha] }); return 'seguir'; }

  const { destino, prefixoDono } = await destinoDoSuporte(chave);
  const card = ctx0.card;
  const cardFicha: CardDaFicha = card
    ? cardDaFichaDe(card)
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: ctx0.nome, cidade: null, observacao: null, created_by: 'lp_solar' };
  const ficha = await montarFicha(cardFicha, ctx0, { cliente: g.cliente });
  const extras = [`Conversa passada pela ${donaNome}: o cliente precisa de suporte (cliente do SolarDoc, reembolso, cobrança ou reclamação)`, ...linhasDoModelo(saida)];
  const linhas = ficha.linhas.filter(l => !(!card && l.startsWith('Conversa completa:')));
  const iLink = linhas.findIndex(l => l.startsWith('Conversa completa:'));
  const comExtras = iLink >= 0 ? [...linhas.slice(0, iLink), ...extras, ...linhas.slice(iLink)] : [...linhas, ...extras];
  const texto = textoDaMensagem(
    blocoSeguro(comExtras), tel,
    [`SUPORTE: a ${donaNome} passou este cliente para a Giovanna.`, prefixoDono].filter(Boolean).join(' '),
  );
  const rf = await enviarFichaVivo(g, { chave, acao: 'suporte', cardId: card?.id ?? 0, n: String(L.id), reserva: `ag5040_suporte:${hmac}:${L.id}`, destino, texto });
  if (rf === 'adiada') {
    await A.soltar();                      // nada saiu: a próxima rodada tenta de novo, dentro dos 15 min
    soma(r.puladas, 'ficha_adiada');
    dec({ resultado: 'ficha_adiada', ...A.base2, ficha: 'adiada' });
    return 'seguir';
  }
  const avisadoEm = g.agoraEnvio().toISOString();
  /** O aviso que o reenvio ao dono lê (10 min sem fala da Giovanna). `incerta` = a ficha pode não ter chegado a ela. */
  const suporteGravado = (incerta: boolean) => ({
    avisado_em: avisadoEm, wa_id: L.id, resumo: String(saida.resumo ?? '').slice(0, 200), ...(incerta ? { incerta: true } : {}),
  });
  if (rf !== 'enviada') {
    // Já avisada ou incerta: a Giovanna pode ter a ficha, e uma 2ª bolha prometeria o que não se confirmou. Sem bolha. A ficha INCERTA
    // grava também o aviso (plano B): se a equipe não falar em 10 min, o dono recebe a ficha com a ressalva de que pode não ter chegado.
    await A.registrar(false, 'ferramenta:suporte_giovanna');
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id, ...(rf === 'incerta' ? { suporte: suporteGravado(true) } : {}) });
    dec({ resultado: 'passou_ao_humano', ...A.base2, ficha: rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou' });
    return 'seguir';
  }
  let parar: 'erro_linha' | 'espacamento' | null = null;
  try {
    const res = await enviarAoLead(chave, posse, { dona: posse.dona as DonaViva, telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, g.agoraEnvio());
    await atualizarPosse(chave, {
      estado: 'passou_humano', ate_wa_id: L.id, ...(res.ok ? { respostas: posse.respostas + 1 } : {}),
      suporte: suporteGravado(false),
    });
    await A.registrar(res.ok, res.ok ? undefined : `acao_recusada:${res.motivo}`);
    if (res.ok) r.enviadas++;
    else if (res.motivo === 'erro_linha' || res.motivo === 'espacamento') parar = res.motivo;
    dec({
      resultado: 'passou_ao_humano', ...A.base2, ficha: 'enviada', n_bolhas: res.ok ? 1 : 0, tamanho: res.ok ? bolha.length : 0,
      ...(res.ok ? {} : { motivo: `bolha_recusada:${res.motivo}` }),
    });
  } catch (err) {
    logger.error(LOG, `conversa ${L.id}: erro depois da ficha do suporte (${codigoDe(err)})`);
    soma(r.puladas, 'erro_depois_de_gravar');
    // A ficha JÁ saiu (rf === 'enviada'): o aviso vai à posse sem `incerta` (o texto "pode não ter chegado" seria falso), e o reenvio ao dono cobre o silêncio.
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id, suporte: suporteGravado(false) });
  }
  if (parar) { r.parou = parar; return 'parar'; }
  return 'seguir';
}

// ── pendências de tempo: a volta honesta e o reenvio do suporte ──────────────

interface PosseComPendencia { chave: string; posse: DadosPosse }

/** Reenvio ao dono: no máximo UM por rodada (suporte e ligar somados). `feito` vira true quando a ficha saiu ou ficou incerta. */
interface PortaoDoDono { feito: boolean }
/** `enviou` = a ficha saiu; `parar` = incerta ou erro, e o laço de pendências da rodada termina. */
interface ResultadoReenvio { enviou: boolean; parar: boolean }
const NADA: ResultadoReenvio = { enviou: false, parar: false };

/** Exceção dentro de um reenvio ao dono encerra o laço de pendências da rodada (chefe anti-ban): nada de tentar o próximo às cegas. */
async function reenvioAoDono(fazer: () => Promise<ResultadoReenvio>, gate: PortaoDoDono): Promise<ResultadoReenvio> {
  try { return await fazer(); }
  catch (err) {
    logger.error(LOG, `reenvio ao dono falhou (${codigoDe(err)}); o laço de pendências para`);
    gate.feito = true;
    return { enviou: false, parar: true };
  }
}

/** A pendência da ficha "remarcado" na posse (sem telefone). `ultima_em` = a última retentativa; sem ela, vale `em`. */
interface RemarcadoPendente {
  cardId: number; de: string | null; para: string; wa_id: number; tentativas: number; incerta?: boolean; em?: string; ultima_em?: string;
}

/** Já passou a espera crescente desde a última tentativa da ficha "remarcado"? Datas ilegíveis = sim (a rodada resolve a malformada). */
const remarcadoDevida = (rem: RemarcadoPendente, agoraMs: number): boolean => {
  const baseMs = Date.parse(String(rem.ultima_em ?? rem.em ?? ''));
  return !Number.isFinite(baseMs) || agoraMs - baseMs >= esperaDoRemarcadoMs(rem.tentativas);
};

/**
 * Esta posse tem pendência para tratar AGORA? Fora ficam as resolvidas e as que ainda esperam (volta antes dos 15 min, suporte
 * antes dos 10, ficha "remarcado" dentro da espera crescente), para não ocuparem as vagas da rodada. A vencida (volta passada
 * da validade, horário do card que passou) FICA: um passo a resolve e libera a vaga.
 */
export function pendenciaDevida(posse: DadosPosse, agoraMs: number): boolean {
  const lig = posse.ligar as { avisado_em?: string; volta_em?: string; resolvido_em?: string; incerta?: boolean; dono_em?: string } | undefined;
  if (lig && !lig.volta_em && !lig.resolvido_em) {
    const t = Date.parse(String(lig.avisado_em ?? ''));
    if (Number.isFinite(t) && agoraMs - t >= LIMITES_VIVO.voltaHonestaMs) return true;
    // Ficha do "ligar agora" INCERTA: aos 10 min, sem sinal da ligação, o dono recebe um reenvio (uma vez só).
    if (lig.incerta === true && !lig.dono_em && Number.isFinite(t) && agoraMs - t >= LIMITES_VIVO.suporteDonoMs) return true;
  }
  const sup = posse.suporte as { avisado_em?: string; dono_em?: string; resolvido_em?: string } | undefined;
  if (sup && !sup.dono_em && !sup.resolvido_em) {
    const t = Date.parse(String(sup.avisado_em ?? ''));
    if (Number.isFinite(t) && agoraMs - t >= LIMITES_VIVO.suporteDonoMs) return true;
  }
  const rem = posse.remarcado as RemarcadoPendente | undefined;
  if (rem && !(rem as { resolvido_em?: string }).resolvido_em && remarcadoDevida(rem, agoraMs)) return true;
  if (posse.dona === 'helena' && pendenciaEpDevida(posse, agoraMs)) return true;
  return false;
}

/** As posses da Duda (e da Helena: suporte e card marcado sem confirmação) com volta, suporte ou ficha "remarcado" pendente (lidas por tipo e janela, filtradas aqui: o corte de 1000 linhas e o .or). */
async function lerPendencias(g: G): Promise<PosseComPendencia[]> {
  const corte = new Date(g.agora.getTime() - LIMITES_VIVO.pendenciaJanelaMs).toISOString();
  const achadas: PosseComPendencia[] = [];
  for (let de = 0; de < 5000; de += 1000) {
    const { data, error } = await supabase.from('whatsapp_sessions').select('phone, lead_data')
      .eq('tipo', 'ag5040').gte('updated_at', corte).order('updated_at', { ascending: false }).range(de, de + 999);
    if (error) throw new Error(`leitura das pendências falhou (${codigoDe(error)})`);
    const lote = (data ?? []) as Array<{ phone: string; lead_data: Record<string, any> | null }>;
    for (const l of lote) {
      const o = l.lead_data;
      if (!o || typeof o !== 'object' || (o.dona !== 'duda' && o.dona !== 'helena' && o.dona !== 'carla')) continue;
      const ligar = o.ligar && typeof o.ligar === 'object' ? o.ligar : null;
      const suporte = o.suporte && typeof o.suporte === 'object' ? o.suporte : null;
      const remarcado = o.remarcado && typeof o.remarcado === 'object' ? o.remarcado : null;
      const volta = ligar && !ligar.volta_em && !ligar.resolvido_em;
      const reenvio = suporte && !suporte.dono_em && !suporte.resolvido_em;
      const fichaRemarcada = remarcado && !remarcado.resolvido_em;
      const epMarcou = o.dona === 'helena' && o.ep_marcou && typeof o.ep_marcou === 'object' && !o.ep_marcou.resolvido_em;
      if (!volta && !reenvio && !fichaRemarcada && !epMarcou) continue;
      if (!ESTADOS_DA_POSSE.includes(String(o.estado))) continue;
      achadas.push({ chave: l.phone, posse: { ...o, dona: o.dona, estado: o.estado, desde: String(o.desde ?? ''), ate_wa_id: typeof o.ate_wa_id === 'number' ? o.ate_wa_id : null,
        respostas: Number(o.respostas) || 0, imagens: [], links: [] } as DadosPosse });
    }
    if (lote.length < 1000) break;
  }
  return achadas;
}

/** A consultora falou? Fala do tipo `equipe` (humano no celular, não a nossa bolha de API) depois do aviso. */
const equipeFalouDepois = (msgs: ReadonlyArray<{ autor: string; momment: string }>, desdeMs: number): boolean =>
  msgs.some(m => m.autor === 'equipe' && Date.parse(m.momment) > desdeMs);

async function varrerPendencias(g: G): Promise<void> {
  const { r, dry } = g;
  let lista: PosseComPendencia[];
  try { lista = await lerPendencias(g); }
  catch (err) { logger.error(LOG, `pendências: ${String((err as Error)?.message ?? err).slice(0, 80)}`); return; }
  // Resolvidas e ainda-sem-vez saem ANTES do corte das mais recentes: senão 5 pendências em espera calariam as que já podem agir.
  const devidas = lista.filter(p => g.donas.includes(p.posse.dona) && pendenciaDevida(p.posse, g.agora.getTime()));
  if (!devidas.length) return;
  const cont = (r.pendencias ??= { voltas: 0, reenvios: 0, olhadas: 0 });
  // No máximo UM reenvio ao dono por rodada (suporte e ligar somados); o primeiro incerta ou erro encerra o laço (chefe anti-ban).
  const gate: PortaoDoDono = { feito: false };
  for (const p of devidas.slice(0, LIMITES_VIVO.pendenciasPorRodada)) {
    if (Date.now() - g.inicio > LIMITES_VIVO.prazoEnvioMs) { r.parou ??= 'prazo'; return; }
    cont.olhadas++;
    try {
      if (p.posse.ligar && !(p.posse.ligar as any).volta_em && !(p.posse.ligar as any).resolvido_em) {
        if ((p.posse.ligar as any).incerta === true && !(p.posse.ligar as any).dono_em) {
          const rl = await reenvioAoDono(() => reenvioLigar(g, p, gate), gate);
          if (rl.enviou) cont.reenvios++;
          if (rl.parar) return;
        }
        if (await voltaHonesta(g, p)) cont.voltas++;
      }
      if (p.posse.suporte && !(p.posse.suporte as any).dono_em && !(p.posse.suporte as any).resolvido_em) {
        const rs = await reenvioAoDono(() => reenvioSuporte(g, p, gate), gate);
        if (rs.enviou) cont.reenvios++;
        if (rs.parar) return;
      }
      if (p.posse.remarcado && !(p.posse.remarcado as any).resolvido_em) {
        await retentarFichaRemarcada(g, p);
      }
      if (p.posse.dona === 'helena' && pendenciaEpDevida(p.posse, g.agora.getTime())) await pendenciaDaConfirmacao(g, p);
    } catch (err) {
      logger.error(LOG, `pendência de uma posse falhou (${codigoDe(err)})`);
    }
  }
  void dry;
}

/**
 * A ligação do "ligar agora" aconteceu? Sinal = status do card mudou, OU fala dela ao lead (autor equipe, nunca a nossa bolha de
 * API), OU resposta dela à ficha no chat dela com a 5040. 'erro' = uma leitura falhou (não se faz nada); 'sem_card' = o card sumiu.
 * É a MESMA régua da volta honesta e do reenvio ao dono.
 */
type SinalDaLigacao = { tipo: 'erro' } | { tipo: 'sem_card' } | { tipo: 'sinal'; telefone: string } | { tipo: 'sem_sinal'; telefone: string };
async function sinalDaLigacao(
  chave: string, lig: { cardId: number; dono: string; status_inicial?: string }, avisadoMs: number,
): Promise<SinalDaLigacao> {
  const { data: card, error } = await supabaseGerador.from('agendamentos').select('status, cliente_telefone').eq('id', Number(lig.cardId)).maybeSingle();
  if (error) return { tipo: 'erro' };
  if (!card) return { tipo: 'sem_card' };
  const telefone = String((card as { cliente_telefone?: string | null }).cliente_telefone ?? '');
  const statusAgora = String((card as { status?: string | null }).status ?? '').trim().toLowerCase();
  let sinal = statusAgora !== String(lig.status_inicial ?? 'agendado').trim().toLowerCase();

  if (!sinal) {
    const conv = await lerConversa(chave);
    if (!conv.completa) return { tipo: 'erro' };
    sinal = equipeFalouDepois(conv.msgs, avisadoMs);
  }
  if (!sinal) {
    const tc = await carregarTelefonesConsultores();
    const telCons = telefoneDoConsultor(tc.ok ? tc.mapa : new Map(), lig.dono);
    const chaveCons = telCons ? chaveContato(telCons) : null;
    if (chaveCons) {
      const dela = await lerConversa(chaveCons);
      if (!dela.completa) return { tipo: 'erro' };
      sinal = dela.msgs.some(m => m.autor === 'lead' && Date.parse(m.momment) > avisadoMs);   // ela escreveu para a 5040
    }
  }
  return sinal ? { tipo: 'sinal', telefone } : { tipo: 'sem_sinal', telefone };
}

/**
 * Volta honesta do "ligar agora": 15 min depois do aviso, sem sinal da consultora, 1 bolha de agenda (duda_agenda_5040,
 * tipo volta) com dois horários, e a conversa passa ao humano. Sinal = fala dela ao lead (autor equipe, nunca a nossa
 * bolha de API), OU resposta dela à ficha no chat dela com a 5040, OU o status do card mudou. Leitura que falha = nada.
 * true = enfileirou (ou venceu a validade).
 */
async function voltaHonesta(g: G, p: PosseComPendencia): Promise<boolean> {
  const { dry, agora } = g;
  const lig = p.posse.ligar as { cardId: number; avisado_em: string; dono: string; faixa: 'novo' | 'remarcacao'; status_inicial?: string };
  const avisadoMs = Date.parse(String(lig.avisado_em ?? ''));
  const cardId = Number(lig.cardId);
  if (!Number.isFinite(avisadoMs) || !Number.isInteger(cardId) || cardId <= 0) return false;
  if (agora.getTime() - avisadoMs < LIMITES_VIVO.voltaHonestaMs) return false;
  const hmac8 = (hmacDe(p.chave) ?? '').slice(0, 8);
  // Quem pediu para parar (ou a conversa encerrada) não ganha bolha de volta e NÃO perde o estado da posse: só se resolve.
  if (p.posse.estado === 'nao_incomodar' || p.posse.estado === 'encerrada') {
    if (!dry) await atualizarPosse(p.chave, { ligar: { ...lig, resolvido_em: agora.toISOString() } });
    g.r.decisoes.push({ hmac8, wa_id: 0, dona: 'duda', acao: null, resultado: 'volta_dispensada', motivo: p.posse.estado, n_bolhas: 0, tamanho: 0 });
    return false;
  }
  const marcar = async (extra: Record<string, unknown>, estado?: 'passou_humano'): Promise<void> => {
    await atualizarPosse(p.chave, { ligar: { ...lig, ...extra }, ...(estado ? { estado } : {}) });
  };

  const sin = await sinalDaLigacao(p.chave, lig, avisadoMs);
  if (sin.tipo === 'erro') return false;
  if (sin.tipo === 'sem_card') { if (!dry) await marcar({ resolvido_em: agora.toISOString() }); return false; }
  if (sin.tipo === 'sinal') {
    if (!dry) await marcar({ resolvido_em: agora.toISOString() });
    g.r.decisoes.push({ hmac8, wa_id: 0, dona: 'duda', acao: null, resultado: 'volta_dispensada', motivo: 'sinal da consultora', n_bolhas: 0, tamanho: 0 });
    return false;
  }

  const validoAte = avisadoMs + LIMITES_VIVO.voltaValidadeMs;
  const vazio = { hmac8, wa_id: 0, dona: 'duda', acao: null, n_bolhas: 0, tamanho: 0 } as const;
  if (agora.getTime() >= validoAte) {
    if (!dry) await marcar({ volta_em: agora.toISOString(), volta: 'vencida' }, 'passou_humano');
    g.r.decisoes.push({ ...vazio, resultado: 'volta_vencida', motivo: null });
    return false;
  }
  const alvo = { dono: String(lig.dono ?? ''), faixa: lig.faixa === 'remarcacao' ? 'remarcacao' as const : 'novo' as const, origem: 'card' as const };
  const oferta = await ofertaDeHorarios(alvo, agora.toISOString(), 2);
  if (oferta.vagas.length < 2) {
    if (!dry) await marcar({ volta_em: agora.toISOString(), volta: 'sem_vagas' }, 'passou_humano');
    g.r.decisoes.push({ ...vazio, resultado: 'volta_sem_vagas', motivo: null });
    return false;
  }
  if (dry) { g.r.decisoes.push({ ...vazio, resultado: 'volta_enfileiraria', motivo: null }); return false; }
  // O item guarda os ISOs (o aviso e as duas vagas); "amanhã às 9h" é montado na hora do envio, e a volta morre 2 h depois do aviso.
  const enf = await enfileirarAgenda({
    tipo: 'volta', cardId, telefone: sin.telefone, quando: new Date(avisadoMs).toISOString(),
    validoAte: new Date(validoAte).toISOString(), consultora: primeiroNome(lig.dono), opcoes: [oferta.vagas[0]!, oferta.vagas[1]!],
  }, g.agoraEnvio());
  if (!enf.ok && enf.motivo === 'erro') return false;            // tenta de novo na próxima rodada
  await marcar({ volta_em: agora.toISOString(), volta: enf.ok ? 'enfileirada' : enf.motivo }, 'passou_humano');
  g.r.decisoes.push({ ...vazio, resultado: 'volta_enfileirada', motivo: enf.ok ? null : enf.motivo });
  return enf.ok;
}

/**
 * A ficha "remarcado" que saiu adiada (teto, cooldown) ou incerta (5xx, timeout) fica na posse (lead_data.remarcado, sem
 * telefone) e é retentada por aqui, no máximo uma vez por rodada e com espaço crescente. Morre quando o card mudou de
 * horário, o horário passou ou o card foi cancelado (não há limite de tentativas: o horário do card é o prazo). Adiada (nada saiu) repete as mesmas chaves; incerta (pode ter saído) ganha UM reenvio
 * com o sufixo `:re`, porque as mesmas chaves devolveriam ja_avisada sem enviar nada. O telefone vem de wa_mensagens.
 */
async function retentarFichaRemarcada(g: G, p: PosseComPendencia): Promise<boolean> {
  const { dry, agora } = g;
  const rem = p.posse.remarcado as RemarcadoPendente;
  const cardId = Number(rem.cardId);
  const paraMs = Date.parse(String(rem.para ?? ''));
  const waId = Number(rem.wa_id);
  const hmac8 = (hmacDe(p.chave) ?? '').slice(0, 8);
  const reg = (resultado: string, motivo: string | null): void => {
    g.r.decisoes.push({ hmac8, wa_id: waId, dona: 'duda', acao: null, resultado, motivo, n_bolhas: 0, tamanho: 0 });
  };
  const resolver = async (como: string): Promise<void> => {
    if (!dry) await atualizarPosse(p.chave, { remarcado: { ...rem, resolvido_em: agora.toISOString(), como } });
  };
  // Espaço crescente entre as tentativas (2, 4, 8, 15 min, depois a cada 15), contado da última; a que nasceu agora espera 2 min.
  if (!remarcadoDevida(rem, agora.getTime())) return false;
  if (!Number.isInteger(cardId) || cardId <= 0 || !Number.isFinite(paraMs) || !Number.isInteger(waId) || waId <= 0) { await resolver('malformada'); return false; }
  if (paraMs <= agora.getTime()) { await resolver('horario_passou'); reg('ficha_remarcado_dispensada', 'horario_passou'); return false; }
  const card = await lerCardParaFicha(cardId);
  if (!card) return false;                                          // leitura falhou: tenta na próxima rodada
  if (String(card.status ?? '').trim().toLowerCase() === 'cancelado' || Date.parse(String(card.quando ?? '')) !== paraMs) {
    await resolver('card_mudou'); reg('ficha_remarcado_dispensada', 'card_mudou'); return false;
  }
  if (dry) { reg('ficha_remarcado_reenviaria', null); return false; }
  const tel = await telefoneParaEnviar(p.chave, waId);
  if (!tel) return false;
  const reenvio = rem.incerta === true;
  const rf = await enviarFichaRemarcada(g, { chave: p.chave, tel, cardId, quandoAntes: rem.de ?? null, iso: rem.para, reenvio });
  reg('ficha_remarcado_reenviada', rf);
  if (rf === 'adiada') {
    await atualizarPosse(p.chave, { remarcado: { ...rem, tentativas: (Number(rem.tentativas) || 1) + 1, ultima_em: agora.toISOString() } });
    return false;
  }
  // enviada, ja_avisada ou incerta de novo (o reenvio já foi o único): resolvida.
  await resolver(rf);
  return rf === 'enviada';
}

/**
 * Suporte: 10 min depois do aviso, sem fala da Giovanna ao cliente, a mesma ficha vai ao dono, UMA vez (reserva
 * ag5040_suporte_dono:<hmac>:<waId>). Fala dela = autor equipe depois do aviso. true = a ficha saiu.
 */
async function reenvioSuporte(g: G, p: PosseComPendencia, gate: PortaoDoDono): Promise<ResultadoReenvio> {
  const { dry, agora } = g;
  const sup = p.posse.suporte as { avisado_em: string; wa_id: number; resumo?: string; incerta?: boolean };
  const avisadoMs = Date.parse(String(sup.avisado_em ?? ''));
  const waId = Number(sup.wa_id);
  if (!Number.isFinite(avisadoMs) || !Number.isInteger(waId) || waId <= 0) return NADA;
  if (agora.getTime() - avisadoMs < LIMITES_VIVO.suporteDonoMs) return NADA;
  const hmac = hmacDe(p.chave);
  if (!hmac) return NADA;
  const marcar = async (extra: Record<string, unknown>): Promise<void> => { await atualizarPosse(p.chave, { suporte: { ...sup, ...extra } }); };
  if (p.posse.estado === 'nao_incomodar' || p.posse.estado === 'encerrada') {
    if (!dry) await marcar({ resolvido_em: agora.toISOString() });
    g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: waId, dona: p.posse.dona, acao: null, resultado: 'suporte_dispensado', motivo: p.posse.estado, n_bolhas: 0, tamanho: 0 });
    return NADA;
  }

  const conv = await lerConversa(p.chave);
  if (!conv.completa) return NADA;
  if (equipeFalouDepois(conv.msgs, avisadoMs)) {
    if (!dry) await marcar({ resolvido_em: agora.toISOString() });
    g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: waId, dona: p.posse.dona, acao: null, resultado: 'suporte_atendido', motivo: null, n_bolhas: 0, tamanho: 0 });
    return NADA;
  }
  if (dry) { g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: waId, dona: p.posse.dona, acao: null, resultado: 'suporte_reenviaria', motivo: null, n_bolhas: 0, tamanho: 0 }); return NADA; }
  // Regras do chefe: 1 reenvio ao dono por rodada, e linha pausada ou em cooldown deixa para depois (sem gravar nada).
  if (gate.feito) return NADA;
  if (await linhaLivre(g.agoraEnvio()) !== 'sim') return NADA;
  const tel = await telefoneParaEnviar(p.chave, waId);
  let card: CardResumo | null = null;
  try { card = (await lerCards(p.chave))[0] ?? null; } catch { card = null; }
  const cardFicha: CardDaFicha = card
    ? cardDaFichaDe(card)
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: null, cidade: null, observacao: null, created_by: 'lp_solar' };
  const extras = [
    `Conversa passada pela ${NOME_DA_DONA[p.posse.dona] ?? 'agente'}: o cliente precisa de suporte (cliente do SolarDoc, reembolso, cobrança ou reclamação)`,
    ...(sup.resumo ? [`Resumo: ${sup.resumo}`] : []),
  ];
  const linhas = fichaDeCampos(cardFicha, extras).linhas.filter(l => !(!card && l.startsWith('Conversa completa:')));
  const texto = textoDaMensagem(
    blocoSeguro(linhas), tel,
    sup.incerta === true
      ? 'REENVIO: o aviso à Giovanna pode não ter chegado, e ela ainda não falou com este cliente depois de 10 minutos. Atenda ou encaminhe.'
      : 'REENVIO: a Giovanna ainda não falou com este cliente depois de 10 minutos. Atenda ou encaminhe.',
  );
  let erroDoEnvio: unknown;
  const rf = await enviarFichaVivo(g, {
    chave: p.chave, acao: 'suporte_dono', cardId: card?.id ?? 0, n: String(waId), reserva: `ag5040_suporte_dono:${hmac}:${waId}`, destino: telefoneDoDono(), texto,
    onErro: e => { erroDoEnvio = e; },
  });
  if (rf !== 'adiada') gate.feito = true;                          // o portão fecha NA HORA: uma exceção daqui para baixo não abre um 2º reenvio
  g.r.decisoes.push({
    hmac8: hmac.slice(0, 8), wa_id: waId, dona: p.posse.dona, acao: null, resultado: 'suporte_reenviado_ao_dono', motivo: rf, n_bolhas: 0, tamanho: 0,
    ficha: rf === 'enviada' ? 'enviada' : rf === 'adiada' ? 'adiada' : rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou',
  });
  if (rf === 'adiada') return NADA;                                // nada saiu: tenta na próxima rodada
  await marcar({ dono_em: agora.toISOString(), dono: rf });
  if (rf === 'ja_avisada') return NADA;
  if (rf === 'incerta') { await contarErroDaLinha(g.agoraEnvio(), erroDoEnvio); return { enviou: false, parar: true }; }
  await zerarErrosDaLinha(g.agoraEnvio());                          // envio ok zera os erros seguidos, como o vivoEnvio
  return { enviou: true, parar: false };
}

/**
 * "Ligar agora" com ficha INCERTA (5xx, timeout): 10 min depois do aviso, se NENHUM sinal mostrar que a ligação aconteceu (status do
 * card, fala da consultora ao lead, resposta dela à 5040), o dono recebe UM reenvio próprio ("LIGAR AGORA", não a Giovanna), com o
 * conteúdo da ficha. Reserva ag5040_ligar_dono:<hmac>:<waId>; marca ligar.dono_em e nunca reenvia de novo, nem com a posse em
 * nao_incomodar ou encerrada. Linha pausada ou em cooldown, ou o portão da rodada já usado, deixa para depois sem gravar nada.
 */
async function reenvioLigar(g: G, p: PosseComPendencia, gate: PortaoDoDono): Promise<ResultadoReenvio> {
  const { dry, agora } = g;
  const lig = p.posse.ligar as {
    cardId: number; avisado_em: string; dono: string; status_inicial?: string; incerta?: boolean; dono_em?: string; wa_id?: number; resumo?: string;
  };
  const avisadoMs = Date.parse(String(lig.avisado_em ?? ''));
  const cardId = Number(lig.cardId);
  const waId = Number(lig.wa_id);
  const hmac = hmacDe(p.chave);
  if (!hmac || !Number.isFinite(avisadoMs) || !Number.isInteger(cardId) || cardId <= 0) return NADA;
  if (agora.getTime() - avisadoMs < LIMITES_VIVO.suporteDonoMs) return NADA;
  const reg = (resultado: string, motivo: string | null): void => {
    g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: Number.isFinite(waId) ? waId : 0, dona: 'duda', acao: null, resultado, motivo, n_bolhas: 0, tamanho: 0 });
  };
  /** Grava dono_em (nunca mais reenvia) e deixa a posse em memória igual, para a volta honesta da mesma passada não apagá-lo. */
  const marcar = async (dono: string): Promise<void> => {
    const novo = { ...lig, dono_em: agora.toISOString(), dono };
    p.posse.ligar = novo;
    await atualizarPosse(p.chave, { ligar: novo });
  };
  if (p.posse.estado === 'nao_incomodar' || p.posse.estado === 'encerrada') {
    if (!dry) await marcar('dispensado');
    reg('ligar_dono_dispensado', p.posse.estado);
    return NADA;
  }
  if (!Number.isInteger(waId) || waId <= 0) { if (!dry) await marcar('malformada'); return NADA; }
  const sin = await sinalDaLigacao(p.chave, lig, avisadoMs);
  if (sin.tipo === 'erro') return NADA;                              // leitura falhou: tenta na próxima rodada
  if (sin.tipo === 'sem_card' || sin.tipo === 'sinal') {
    if (!dry) await marcar(sin.tipo);
    reg('ligar_dono_dispensado', sin.tipo);
    return NADA;
  }
  if (dry) { reg('ligar_dono_reenviaria', null); return NADA; }
  if (gate.feito) return NADA;
  if (await linhaLivre(g.agoraEnvio()) !== 'sim') return NADA;
  const tel = await telefoneParaEnviar(p.chave, waId);
  if (!tel) return NADA;
  const cardFicha: CardDaFicha = (await lerCardParaFicha(cardId))
    ?? { id: cardId, vendedor_nome: lig.dono, quando: null, cliente_nome: null, cidade: null, observacao: null, created_by: 'lp_solar' };
  const extras = ['Pedido: o cliente aceitou receber a ligação AGORA e espera o telefone tocar', ...(lig.resumo ? [`Resumo: ${lig.resumo}`] : [])];
  const texto = textoDaMensagem(
    blocoSeguro(fichaDeCampos(cardFicha, extras).linhas), tel,
    'LIGAR AGORA (REENVIO): o aviso à consultora pode não ter chegado, e nenhum sinal mostra que a ligação aconteceu depois de 10 minutos. Ligue para este cliente ou encaminhe.',
  );
  let erroDoEnvio: unknown;
  const rf = await enviarFichaVivo(g, {
    chave: p.chave, acao: 'ligar_dono', cardId, n: String(waId), reserva: `ag5040_ligar_dono:${hmac}:${waId}`, destino: telefoneDoDono(), texto,
    onErro: e => { erroDoEnvio = e; },
  });
  reg('ligar_reenviado_ao_dono', rf);
  if (rf === 'adiada') return NADA;                                 // nada saiu: tenta na próxima rodada
  gate.feito = true;                                                // o portão fecha NA HORA, antes de gravar qualquer coisa
  await marcar(rf);
  if (rf === 'ja_avisada') return NADA;
  if (rf === 'incerta') { await contarErroDaLinha(g.agoraEnvio(), erroDoEnvio); return { enviou: false, parar: true }; }
  await zerarErrosDaLinha(g.agoraEnvio());
  return { enviou: true, parar: false };
}

/**
 * A Helena marcou um card sem card prévio e a confirmação oficial (ep_agenda) é o que pede o SIM: 10 minutos depois, com
 * confirmacao_at ainda nulo, a conversa passa ao humano com a ficha (sem bolha da IA). Confirmada, cancelada ou card que
 * sumiu = só resolve. Ficha adiada (teto, cooldown) NÃO resolve: a próxima rodada tenta de novo.
 */
async function pendenciaDaConfirmacao(g: G, p: PosseComPendencia): Promise<void> {
  const { dry, agora } = g;
  const m = p.posse.ep_marcou as EpMarcou;
  const hmac = hmacDe(p.chave);
  const cardId = Number(m.cardId);
  const waId = Number(m.wa_id);
  if (!hmac || !Number.isInteger(cardId) || cardId <= 0 || !Number.isInteger(waId) || waId <= 0) {
    if (!dry) await atualizarPosse(p.chave, { ep_marcou: { ...m, resolvido_em: agora.toISOString(), como: 'malformada' } });
    return;
  }
  const hmac8 = hmac.slice(0, 8);
  const reg = (resultado: string, motivo: string | null): void => {
    g.r.decisoes.push({ hmac8, wa_id: waId, dona: 'helena', acao: null, resultado, motivo, n_bolhas: 0, tamanho: 0 });
  };
  const sit = await situacaoDaConfirmacao(cardId);
  if (sit === null) return;                                         // leitura falhou: tenta na próxima rodada
  if (sit !== 'ainda_nao') {
    if (!dry) await atualizarPosse(p.chave, { ep_marcou: { ...m, resolvido_em: agora.toISOString(), como: sit } });
    reg('confirmacao_dispensada', sit);
    return;
  }
  const tel = await telefoneParaEnviar(p.chave, waId);
  let adiada = false;
  await passarAoHumano(g, {
    chave: p.chave, tel, L: { id: waId, momment: m.em }, posse: p.posse, hmac, motivo: 'helena_sem_confirmacao', bolha: false,
    card: null, buscarCard: true, nome: null, acao: 'marcar_horario',
    dec: d => { if (d.resultado === 'ficha_adiada') adiada = true; g.r.decisoes.push({ hmac8, wa_id: waId, dona: 'helena', acao: null, motivo: null, n_bolhas: 0, tamanho: 0, ...d }); },
  });
  if (adiada) return;
  if (!dry) await atualizarPosse(p.chave, { ep_marcou: { ...m, resolvido_em: agora.toISOString(), como: 'passou_ao_humano' } });
}
