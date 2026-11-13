// ─────────────────────────────────────────────────────────────────────────────
// A HELENA: AGENTE DO ELETROPOSTO (10/10/2026; atende todo tipo de cliente desde 12/11/2026)
//
// Ordem do dono (10/10): chamar, um por vez, quem preencheu o formulário do eletroposto
// e declarou quanto pretende investir, confirmar se o plano continua de pé e
// marcar a reunião com o consultor. Começa em 11/10/2026, 08h de Brasília.
//
// ORDEM NOVA DO DONO (12/11/2026): "pegar todos os clientes de eletroposto e uma agente atender ele,
// com abordagem humanizada, entender muita coisa desse cliente e levar ele a uma reunião". A fila ganhou
// os quatro tipos (Investidor, Arrendamento, Parceiro, Curioso, nessa ordem estrita), mas só entra quem
// tem um card NÃO ATENDIDO na agenda (cancelado, nao_atendeu, lote mudo, reunião vencida) e nenhum card
// vivo. Ao agendar, a Helena REMARCA o mesmo card (investidorAgenteCard.ts), e o consultor recebe a ficha
// da conversa. Quem ela chamou há mais de 21 dias sem resposta volta como RETORNO. O resgate dos
// cancelados acabou: eles estão na fila normal, uma abertura por telefone.
//
// SÃO DUAS METADES, e elas têm freios diferentes:
//
//   ABERTURA (fria)   uma pessoa por chamada, UMA bolha (sendFrio). Passa por
//                     todos os portões abaixo antes de reivindicar a pessoa.
//   RESPOSTA (reativa) quem respondeu é atendido: a IA lê a conversa inteira,
//                     responde em até 2 bolhas e devolve uma ação. O número da
//                     oferta agenda direto, sem IA.
//
// ── Os portões da abertura, na ordem, todos ANTES do claim ──
//   1. chave de desligar (INVESTIDOR_AGENTE_OFF=1 ou `inv_agente_off` no banco)
//   2. disjuntor: 2 erros de envio seguidos param até alguém religar; 3 pedidos
//      de parada no mesmo dia param as aberturas até o dia seguinte
//   3. início (11/10/2026 08h) e janela própria, em Brasília
//   4. teto do dia PRÓPRIO (30 na largada, 20 depois; env e rampa só apertam)
//   5. teto e espaçamento da LINHA (lineThrottle, sem mexer nele)
//   6. fila: o primeiro. 7. pausa humana daquele telefone
// Portão que não consegue LER fecha: sem saber quanto já saiu, não sai mais nada.
//
// ── O estado ──
// Tudo em `system_state`, sem tabela nova:
//   inv_agente:<chave>            a sessão (o insert dela é o claim)
//   inv_agente_sent:<chave>:t1    o carimbo do envio (conta no teto da linha)
//   inv_agente_vez:<chave>:<ts>   a vez de responder uma leva de mensagens
//   inv_agente_parar:<dia>:<chave> pedido de parada (alimenta o disjuntor)
//   inv_agente_resgate:<chave>    abertura de RESGATE enviada (conta a cota do grupo)
//   inv_agente_parar_resgate:<dia>:<chave> parada vinda de sessão de resgate
//   inv_agente_audio:<id>         transcrição de um áudio (id = wa_mensagens.id): { texto, em }
//   inv_agente_off                chave de desligar
//   inv_agente_disjuntor          erros de envio seguidos
// A chave é DDD + 8 últimos dígitos (chaveContato), a mesma do resto da casa.
//
// ── Estado primeiro, mensagem depois ──
// Sessão, opt-out, status do cadastro e card são gravados ANTES de a mensagem
// correspondente sair. A exceção é o carimbo da abertura, que só existe com o
// envio feito: ele é a conta do teto, e carimbo sem envio gastaria a linha.
//
// ── O RESGATE DOS CANCELADOS (12/10/2026, ordem do Thiago) ──
// Um segundo grupo na fila: quem marcou reunião pela página e teve o horário
// liberado pela régua do SIM, há 14 dias ou mais. Mesmos portões, com os limites
// do parecer anti-ban: até 5 por dia DENTRO do teto, na 3ª, 8ª, 13ª, 18ª e 23ª
// abertura do dia, disjuntor próprio (2 paradas) e fecho aos 7 dias sem resposta.
// A regra de elegibilidade e a ordem moram em investidorAgentePuro.ts.
//
// Prévia sem enviar: GET /cron/investidor-agente?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from '../../utils/anthropicClient';
import { transcribeAudio } from '../../utils/mediaProcessor';
import { sendFrio, sendHuman, sendWhatsApp } from '../agents/zapiClient';
import {
  dentroDoTetoHorarioLinha, respeitaEspacamentoLinha, rampaReconexaoVigente,
} from '../agents/whatsapp/lineThrottle';
import {
  carregarSilenciados, carregarMudos, carregarBloqueados, silenciarContato, chaveContato,
} from '../agents/whatsapp/silenciar';
import { carregarPausas, podeFalarComLead, registrarBloqueio } from '../agents/whatsapp/pausaHumana';
import { pareceRoboDeles } from '../agents/whatsapp/roboDoOutroLado';
import { EQUIPE } from '../../routes/ioEletroposto';
import { INSTANCE_ID_IO } from './solarRespostas';
import { type LinhaOrigem } from './eletropostoPares';
import { carregarCompromissos, aindaLivre } from './eletropostoVagas';
import { agendaFechadaNoIso } from '../agenda/agendaFechada';
import { guardarTipoDoCard } from '../agenda/etiquetaCard';
import { TIPO_CARD_PREFIX } from '../agenda/salaDeEspera';
import { ehCardSemAvisoAutomatico, ORIGEM_CADASTRO_EP } from '../agenda/origemEtiqueta';
import { avisarMarcacao, iniciarRodadaDeAvisos, rodarAvisosDaEquipe } from './investidorAgenteAvisos';
import { cedeEmLote } from './investidorAgenteCede';
import { ORIGEM_LP_EP, ORIGEM_AGENTE_EP, consultaDoRodizio, donoDaVez, gravarCardEletroposto } from './eletropostoCard';
import { INV_SESSAO_PREFIX, sessaoEhDaHelena, type EstagioInvestidor, type PreparoDaSessao } from './investidorAgentePosse';
import { cedeAAgente } from '../agentes5040/posse';
import { carregarTelefonesConsultores, telefoneDoConsultor, telefoneDoDono } from '../agentes5040/fichaEnvio';
import { PREFIXO_ENV, conferirLinhaParaResposta, registrarBolhas, registrarFichaNaLinha, TEMPOS_DA_RESPOSTA } from './investidorAgenteLinha';
import { remarcarCardDaHelena } from './investidorAgenteCard';
import { contarErroDaLinha, zerarErrosDaLinha } from '../agentes5040/guardaDaLinha';
import {
  MOTIVO_EQUIPE_ASSUMIU, MOTIVO_SILENCIO, TEXTO_DO_SILENCIO, avaliarConvite, equipeAssumiu, sessaoEmConversaDaHelena, sessaoEntraNoConvite,
  silencioDepoisDoConvite, silencioVencido, textoDoConvite, textoEquipeAssumiu,
} from './investidorAgenteConvite';
import { reservarAvisoDaEquipe, rodarAvisosDaHelenaEquipe } from './investidorAgenteAvisosEquipe';
import {
  antesDoInicio, janelaAberta, janelaDeResposta, tetoDoDia, dataBrasilia, horaBrasiliaTexto, inicioDoDiaBrasiliaIso,
  montarFila, renderAbertura, textoDaAbertura, primeiroNome, tipoDaSessao, textoDaAberturaResgate,
  horariosDaOferta, textoOferta, textoConfirmacao, horarioCurto,
  textoPassagem, textoDespedida, textoParou, textoAdiado, textoEncerramentoPreparo, ehConviteDeHorario, textoNaoEntendi, escolhaPorNumero, pediuParar, montarObservacao,
  montarSistema, montarPedido, lerSaida, juntarDados, violaRegras, valoresLiberados, pedidoDeReescrita, SCHEMA_SAIDA_HELENA,
  type CandidatoInvestidor, type DadosDaConversa, type MsgDaConversa, type RefCadastro, type ResultadoFila, type TipoHelena,
  ehAudioSemTexto, type SaidaHelena, type ContextoHelena, type FonteDoFormulario,
  type CardDoContato, type CardEletroposto, cardReabre, REUNIAO_VENCIDA_MS,
  escolhaPendenteDe, dentroDaJanelaDeRecuperacao, RECUPERACOES_POR_RODADA, type EscolhaPendente,
  montarRetomadas, renderRetomada, lerChaveDeToque, limiteDeRetomadasHoje, tetoRetomadasDoDia, MARGEM_DO_TOQUE_MS,
  RETOMADAS_RESERVA_DE_ABERTURA, sessaoVoltaComoRetorno, ultimoEnvioDaSessao, varianteDoTipo,
  montarFichaConsultor, linhaDaFichaNoHistorico, TETO_DA_FICHA, primeiroNomeDoConsultor, FAIXAS, ORDEM_DOS_TIPOS,
  type CarimbosDosToques, type CandidatoRetomada, type ResultadoRetomadas,
} from './investidorAgentePuro';

const LOG = 'investidor-agente';

// ── Chaves em system_state ───────────────────────────────────────────────────
/** Carimbo de envio efetivado. Está em BOT_SENT_PREFIXES (lineThrottle.ts): conta
 *  como frio e entra no espaçamento, para os outros robôs frios enxergarem. */
export const INV_SENT_PREFIX = 'inv_agente_sent:';
const INV_VEZ_PREFIX = 'inv_agente_vez:';
const INV_PARAR_PREFIX = 'inv_agente_parar:';
/** Cache da transcrição de áudio: `inv_agente_audio:<id da wa_mensagens>` = { texto, em }. */
export const INV_AUDIO_PREFIX = 'inv_agente_audio:';
/** Pedido de parada vindo de sessão de resgate (as sessões de resgate que já existem seguem valendo). */
const INV_PARAR_RESGATE_PREFIX = 'inv_agente_parar_resgate:';
/** Pedidos pelo banco, lidos no começo da rodada (a sessão principal não tem o CRON_SECRET):
 *  `inv_agente_previa_pedido` grava a prévia em `inv_agente_previa`; `inv_agente_ligar_pedido` faz o ?ligar=1. */
export const INV_PREVIA_PEDIDO_KEY = 'inv_agente_previa_pedido';
export const INV_PREVIA_KEY = 'inv_agente_previa';
export const INV_LIGAR_PEDIDO_KEY = 'inv_agente_ligar_pedido';
/** A ficha ao consultor: `ficha_helena:<id do card>`, reservada por insert antes do envio (nunca duas por agendamento). */
export const FICHA_HELENA_PREFIX = 'ficha_helena:';
/** O marcador do robô de respostas da agenda (eletropostoAgenda.EP_RESPOSTA_PREFIX; cópia aqui para não criar import circular). */
const EP_RESPOSTA_PREFIXO = 'ep_resposta:';
/** Trava de chamada sobreposta: uma rodada por balde de 5 minutos (UTC). */
export const INV_LOCK_PREFIX = 'inv_agente_lock:';
const BALDE_DO_LOCK_MS = 5 * 60_000;
/** Falhas seguidas ao ler a conversa antes de desistir e passar para gente. */
const FALHAS_DE_HISTORICO_ATE_PASSAR = 3;
/** O registro da resposta atrasada (FRIO): `inv_agente_frio:<chave>:<ms>`. Está em BOT_SENT_PREFIXES (lineThrottle). */
export const INV_FRIO_PREFIX = 'inv_agente_frio:';
export const INV_OFF_KEY = 'inv_agente_off';
export const INV_DISJUNTOR_KEY = 'inv_agente_disjuntor';

// ── Limites ──────────────────────────────────────────────────────────────────
/** Erros de envio seguidos que param a abertura até alguém religar. */
const ERROS_ATE_ABRIR = 2;
/**
 * Pedidos de parada no mesmo dia que param o PRÓPRIO GRUPO até o dia seguinte (parecer do chefe anti-ban,
 * 12/11/2026): Investidor 3; Arrendamento, Parceiro, Curioso e Retorno 2. Dois erros de envio seguidos
 * continuam parando tudo.
 */
export const PARADAS_POR_GRUPO: Readonly<Record<string, number>> = Object.freeze({
  investidor: 3, arrendamento: 2, parceiro: 2, curioso: 2, retorno: 2,
});
/** Junta mensagens seguidas ("Sim" e logo "obrigado") numa leva só. */
const ESPERA_MS = 30_000;
/** A resposta só vale como RESPOSTA até 15 min depois da mensagem da pessoa (regulamento do chefe). Passou disso,
 *  responde como FRIO: na régua do frio (janela, vaga, espaço de 10 a 15 min), sem passar para o consultor por atraso. */
const RESPOSTA_VIVA_MS = 15 * 60_000;
/** Áudios transcritos por leva de uma pessoa. O resto fica como "[audio]". */
const AUDIOS_POR_LEVA = 3;
/** Tempo por áudio (a transcrição não tem tempo limite próprio). Passou, vale "[audio]".
 *  15 s: a rodada tem 300 s e a transcrição roda depois da vez gasta. */
const TEMPO_DO_AUDIO_MS = 15_000;
/** Conversas atendidas por chamada. */
const POR_TICK = 3;
/** Respostas da Helena por pessoa. Passou disso, é com gente. (16 até 11/11/2026; 30 com a conversa de descoberta.) */
const MAX_RESPOSTAS = 30;
/** Listas de horário por pessoa. Quem recusou três listas precisa de gente. */
const MAX_OFERTAS = 3;
/** Qualquer mensagem na linha nesta janela tira a pessoa da fila da abertura. */
const CONVERSA_RECENTE_MS = 7 * 86_400_000;
const PAGINA = 1000;

/** Modelo da conversa: as mesmas constantes da agente do quiz solar. O padrão é
 *  o Opus 5; se ele não responder, a mesma pergunta vai para o Sonnet 4.6. */
const MODELO = (process.env.INVESTIDOR_AGENTE_MODELO || 'claude-opus-5-5').trim();
const MODELO_RESERVA = 'claude-sonnet-4-6';

/** Esforço de raciocínio do modelo principal (11/10/2026: o dono quer a Helena
 *  entendendo contexto, então o padrão é alto). INVESTIDOR_AGENTE_ESFORCO aceita
 *  só low, medium ou high; qualquer outra coisa cai no padrão. */
type Esforco = 'low' | 'medium' | 'high';
const ESFORCOS: readonly Esforco[] = ['low', 'medium', 'high'];
const ESFORCO: Esforco = ESFORCOS.find(e => e === (process.env.INVESTIDOR_AGENTE_ESFORCO || '').trim().toLowerCase()) ?? 'high';
/** O raciocínio conta neste limite: com pouco, a resposta trunca e o JSON sai inválido. */
const MAX_TOKENS_PRINCIPAL = 16_000;
/** Tempo limite de CADA chamada ao modelo, sem repetição automática do SDK
 *  (ressalva da revisão de 11/10/2026). Sem isto uma chamada pendurada seguraria
 *  a rodada inteira, e o SDK repetiria sozinho por baixo. Estourou no principal,
 *  é falha dele e a pergunta vai para a reserva; estourou na reserva, `humano`. */
const OPCOES_DA_CHAMADA = { timeout: 45_000, maxRetries: 0 } as const;
/** Paradas do modelo que valem como falha: recusou, ou ficou sem espaço no meio. */
const PARADAS_QUE_SAO_FALHA: ReadonlySet<string> = new Set(['refusal', 'max_tokens']);

const desligadoPorEnv = (): boolean => (process.env.INVESTIDOR_AGENTE_OFF || '').trim() === '1';

// ── Sessão ───────────────────────────────────────────────────────────────────
export interface SessaoInvestidor {
  estagio: EstagioInvestidor;
  aberto_em: string;
  /** Índice da abertura enviada dentro da lista do tipo (0 a 2). */
  abertura: number;
  origem: 'parceria' | 'nota1' | 'agenda' | 'card';
  id: number;
  /** Todas as linhas de cadastro daquele telefone, nas três origens. */
  refs: RefCadastro[];
  /** O tipo do cadastro (12/11/2026). Sessão antiga, sem o campo, vale como `investidor`. */
  tipo?: TipoHelena;
  /** A abertura foi a de RETORNO (pessoa chamada há mais de 21 dias, sem resposta). */
  retorno?: boolean;
  /** O card que a Helena remarca ao agendar (um card parado da pessoa), ou null (aí ela cria um novo). */
  card_id?: number | null;
  /** O status do card quando a Helena abriu a conversa, e se era do lote mudo. Só informa a IA. */
  card_antigo?: { status: string; lote: boolean } | null;
  /** A nota interna do cadastro (só informa a IA, que nunca a cita). */
  nota?: number | null;
  /** O que o card dela traz (quarta fonte): valor, cidade e local. */
  fatos_do_card?: string[];
  /** Os ids de todos os cards do telefone quando a Helena abriu a conversa: o que não está aqui é card novo. */
  cards_conhecidos?: number[];
  /** A ficha ao consultor já saiu para este agendamento. */
  ficha_enviada_em?: string;
  /** A ficha ao consultor ESPEROU a linha (teto 60/h e 450/24 h, ou 1 por rodada): guarda o horário da reunião (ISO). O fecho dos preparos a manda numa rodada seguinte. */
  ficha_pendente?: string;
  /** PREPARO DEPOIS DE MARCAR (12/11/2026): enquanto existe, a sessão `agendado` ainda é da Helena. Ver `atenderPreparo`. */
  preparo?: PreparoDaSessao;
  /** Como e quando o preparo acabou. */
  preparo_fim?: { em: string; motivo: string };
  /** A RETOMADA DO CONVITE (13/11/2026, toque `c1`, uma por pessoa): quando saiu. Depois dela, 48 h de silêncio passam a sessão a `humano`. */
  convite_retomado_em?: string;
  /** Registro do CONVITE para a reunião (tela de acompanhamento): quando foi o último e quantos já saíram. */
  convidou_em?: string;
  convites?: number;
  telefone: string;
  nome: string | null;
  cidade: string | null;
  cadastro_em: string | null;
  valor_txt: string;
  consultor: string;
  /** Os 4 horários da oferta em aberto, em ISO. */
  oferta: string[];
  ofertas_feitas: number;
  agendamento_id: number | null;
  motivo: string | null;
  dados: DadosDaConversa;
  resumo: string;
  erro: string | null;
  /** Até onde a conversa já foi lida. */
  ate: string | null;
  respostas: number;
  /** Leituras da conversa que falharam em seguida (a vez não é gasta nelas). */
  falhas_historico?: number;
  /** Quando a pessoa pediu para ser procurada mais para frente (estágio `adiado`). */
  adiado_em?: string | null;
  /** Só nas sessões do RESGATE dos cancelados. A fila principal não ganha estes três. */
  grupo?: 'resgate';
  sem_retomada?: boolean;
  /** O `quando` (ISO) da reunião que não aconteceu. */
  reuniao_perdida_em?: string;
  /** A última fala dela que a recuperação da escolha pendente já reprocessou (nunca repete). */
  recuperado_ate?: string;
  /** Número do último toque que saiu (retomadas, 13/10/2026). Sessão antiga, sem o campo, vale 1. */
  toques?: number;
  /** Quando o último toque saiu. */
  ultimo_toque_em?: string;
  /** `outra_conversa`: mensagem nossa (outro robô, um humano) depois do toque anterior
   *  encerrou o ciclo de retomadas desta pessoa. O estágio não muda e ninguém é silenciado. */
  ciclo_encerrado?: 'outra_conversa';
  ciclo_encerrado_em?: string;
  atualizado_em: string;
}

const chaveDaSessao = (chave: string): string => `${INV_SESSAO_PREFIX}${chave}`;

async function gravarSessao(chave: string, s: SessaoInvestidor): Promise<void> {
  const em = new Date().toISOString();
  const { error } = await supabase.from('system_state')
    .upsert({ key: chaveDaSessao(chave), value: { ...s, atualizado_em: em }, updated_at: em }, { onConflict: 'key' });
  if (error) throw new Error(`gravar sessão ${chave}: ${error.message}`);
}

// ── Leitura paginada ─────────────────────────────────────────────────────────
// O PostgREST corta a resposta em 1000 linhas e ignora um .limit() maior (26/09:
// o placar publicou 41 locais em vez de 49, sem erro). Tudo que precisa vir
// inteiro vem por .range, em blocos, até a página voltar incompleta. Erro SOBE:
// lista incompleta aqui viraria mensagem para quem não devia receber.
type Pagina = PromiseLike<{ data: unknown; error: { message?: string } | null }>;

export async function lerTudo<T>(rotulo: string, pagina: (de: number, ate: number) => Pagina, teto = 60_000): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) throw new Error(`${rotulo}: ${error.message || 'falha de leitura'}`);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
    if (out.length >= teto) throw new Error(`${rotulo}: passou de ${teto} linhas, leitura interrompida`);
  }
}

async function lerSessoes(): Promise<Map<string, SessaoInvestidor>> {
  const linhas = await lerTudo<{ key: string; value: SessaoInvestidor }>('sessões da Helena', (de, ate) =>
    supabase.from('system_state').select('key, value')
      .like('key', `${INV_SESSAO_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  const mapa = new Map<string, SessaoInvestidor>();
  for (const l of linhas) mapa.set(String(l.key).slice(INV_SESSAO_PREFIX.length), (l.value ?? {}) as SessaoInvestidor);
  return mapa;
}

// ── Chave de desligar e disjuntor ────────────────────────────────────────────
export interface EstadoDesligar { off: boolean; por: 'env' | 'banco' | 'erro_de_leitura' | null }

/** Lida a cada chamada. Sem conseguir ler a chave do banco, vale como desligada. */
export async function lerChaveDesligar(): Promise<EstadoDesligar> {
  if (desligadoPorEnv()) return { off: true, por: 'env' };
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', INV_OFF_KEY).maybeSingle();
    if (error) throw error;
    const v = data?.value as { off?: unknown } | boolean | string | null | undefined;
    const ligada = v === true || v === '1' || (typeof v === 'object' && v !== null && (v.off === true || v.off === '1'));
    return ligada ? { off: true, por: 'banco' } : { off: false, por: null };
  } catch (err) {
    logger.error(LOG, 'ler a chave de desligar falhou: tratando como desligada', err);
    return { off: true, por: 'erro_de_leitura' };
  }
}

/** ?desligar=1 e ?ligar=1. Ligar também rearma o disjuntor de erros de envio. */
export async function definirChaveDesligar(desligar: boolean, por = 'cron'): Promise<{ ok: boolean; desligada: boolean; aviso?: string }> {
  const em = new Date().toISOString();
  if (desligar) {
    const { error } = await supabase.from('system_state')
      .upsert({ key: INV_OFF_KEY, value: { off: true, em, por }, updated_at: em }, { onConflict: 'key' });
    if (error) throw new Error(`gravar a chave de desligar: ${error.message}`);
    logger.info(LOG, 'agente DESLIGADA pela chave do banco');
    return { ok: true, desligada: true };
  }
  const { error } = await supabase.from('system_state').delete().in('key', [INV_OFF_KEY, INV_DISJUNTOR_KEY]);
  if (error) throw new Error(`remover a chave de desligar: ${error.message}`);
  logger.info(LOG, 'agente LIGADA: chave do banco removida e disjuntor rearmado');
  return desligadoPorEnv()
    ? { ok: true, desligada: true, aviso: 'A chave do banco saiu, mas INVESTIDOR_AGENTE_OFF=1 continua na Vercel e segue desligando.' }
    : { ok: true, desligada: false };
}

interface Disjuntor { erros_seguidos: number; aberto: boolean; em?: string; ultimo_erro?: string }

async function lerDisjuntor(): Promise<Disjuntor> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', INV_DISJUNTOR_KEY).maybeSingle();
  if (error) throw new Error(`ler disjuntor: ${error.message}`);
  const v = (data?.value ?? {}) as Partial<Disjuntor>;
  const erros = Number(v.erros_seguidos || 0);
  return { erros_seguidos: erros, aberto: v.aberto === true || erros >= ERROS_ATE_ABRIR, em: v.em, ultimo_erro: v.ultimo_erro };
}

async function gravarDisjuntor(d: Disjuntor): Promise<void> {
  const em = new Date().toISOString();
  await supabase.from('system_state')
    .upsert({ key: INV_DISJUNTOR_KEY, value: { ...d, em }, updated_at: em }, { onConflict: 'key' })
    .then(undefined, (e: unknown) => logger.error(LOG, 'gravar disjuntor falhou', e));
}

async function contarChaves(prefixo: string, desdeIso?: string): Promise<number> {
  let q = supabase.from('system_state').select('key', { count: 'exact', head: true }).like('key', `${prefixo}%`);
  if (desdeIso) q = q.gte('updated_at', desdeIso);
  const { count, error } = await q;
  if (error) throw new Error(`contar ${prefixo}: ${error.message}`);
  if (typeof count !== 'number') throw new Error(`contar ${prefixo}: resposta sem contagem`);
  return count;
}

/** Quantas aberturas saíram desde 00:00 de Brasília. Erro SOBE (falha fechada). */
const contarEnviadosHoje = (agora: Date): Promise<number> => contarChaves(INV_SENT_PREFIX, inicioDoDiaBrasiliaIso(agora));

/** Conta chaves por padrão LIKE completo (com `%` onde precisar), desde um instante. Erro SOBE. */
async function contarLike(padrao: string, desdeIso?: string): Promise<number> {
  let q = supabase.from('system_state').select('key', { count: 'exact', head: true }).like('key', padrao);
  if (desdeIso) q = q.gte('updated_at', desdeIso);
  const { count, error } = await q;
  if (error) throw new Error(`contar ${padrao}: ${error.message}`);
  if (typeof count !== 'number') throw new Error(`contar ${padrao}: resposta sem contagem`);
  return count;
}

/** Retomadas (toques 2 a 5) que saíram desde 00:00 de Brasília: todos os envios do dia menos os toques 1. */
export async function contarRetomadasHoje(agora: Date): Promise<number> {
  const desde = inicioDoDiaBrasiliaIso(agora);
  const [todos, aberturas] = await Promise.all([contarChaves(INV_SENT_PREFIX, desde), contarLike(`${INV_SENT_PREFIX}%:t1`, desde)]);
  return Math.max(0, todos - aberturas);
}

/** Aberturas (toque 1) que saíram desde 00:00 de Brasília. As retomadas não entram. */
export async function contarAberturasHoje(agora: Date): Promise<number> {
  return contarLike(`${INV_SENT_PREFIX}%:t1`, inicioDoDiaBrasiliaIso(agora));
}

// ── O disjuntor por grupo (parecer do chefe anti-ban, 12/11/2026) ────────────
/** O grupo de uma sessão para o disjuntor: `retorno` ou o tipo. Sessão antiga vale como `investidor`. */
export const grupoDaSessao = (s: { retorno?: boolean; tipo?: string }): string => (s.retorno ? 'retorno' : tipoDaSessao(s.tipo));

/** A chave do pedido de parada: `inv_agente_parar:<dia>:<grupo>:<chave>`. */
const chaveDaParada = (dia: string, grupo: string, chave: string): string => `${INV_PARAR_PREFIX}${dia}:${grupo}:${chave}`;

/**
 * Os grupos fechados hoje: os que chegaram ao limite de pedidos de parada do dia (3 no Investidor, 2 nos
 * outros). A chave antiga, sem grupo (`inv_agente_parar:<dia>:<chave>`), vale para o Investidor. Erro SOBE.
 */
export async function lerGruposFechados(agora: Date): Promise<{ fechados: Set<string>; paradas: Record<string, number> }> {
  const prefixo = `${INV_PARAR_PREFIX}${dataBrasilia(agora)}:`;
  const linhas = await lerTudo<{ key: string }>('pedidos de parada de hoje', (de, ate) =>
    supabase.from('system_state').select('key').like('key', `${prefixo}%`).order('key', { ascending: true }).range(de, ate));
  const paradas: Record<string, number> = {};
  for (const l of linhas) {
    const partes = String(l.key).slice(prefixo.length).split(':');
    const grupo = partes.length >= 2 ? partes[0]! : 'investidor';
    paradas[grupo] = (paradas[grupo] ?? 0) + 1;
  }
  const fechados = new Set(Object.entries(PARADAS_POR_GRUPO).filter(([g, max]) => (paradas[g] ?? 0) >= max).map(([g]) => g));
  return { fechados, paradas };
}

// ── A fila ───────────────────────────────────────────────────────────────────
export interface LeituraDaFila {
  resultado: ResultadoFila;
  sessoes: Map<string, SessaoInvestidor>;
  lidsSemMapa: number;
  /** Chaves de sessão antiga que voltam como retorno. */
  retorno: Set<string>;
  /** Grupos com o disjuntor de pedidos de parada aberto hoje. */
  gruposFechados: Set<string>;
  paradasPorGrupo: Record<string, number>;
  /** Quantas pessoas de cada fonte entraram na fila. */
  porFonte: Record<string, number>;
  /** Quantas de cada tipo e faixa. */
  porTipoEFaixa: Record<string, Record<string, number>>;
}

/** As fontes de CADASTRO da fila: o cadastro (com o lado integrador) e a ficha da LP, paginados. A agenda de
 *  arrendamento deixou de ser fonte em 12/11/2026 (o status `arrendamento` é do consultor: card vivo). */
async function lerOrigens(): Promise<LinhaOrigem[]> {
  const [cad, fic] = await Promise.all([
    lerTudo<Record<string, unknown>>('cadastros de parceria', (de, ate) =>
      supabaseGerador.from('eletroposto_parceria')
        // `cadastrado_em` é a data da ÚLTIMA vez que a pessoa se cadastrou (o upsert
        // mantém o `created_at` da primeira): é ela que o corte de 24h precisa ver.
        .select('id, nome, telefone, cidade, lado, ponto_relacao, ponto_tipo, ponto_endereco, capital_faixa, status, created_at, cadastrado_em')
        .in('lado', ['ponto', 'capital', 'integrador'])
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(de, ate)),
    lerTudo<Record<string, unknown>>('fichas da LP', (de, ate) =>
      supabaseGerador.from('eletroposto_nota1')
        .select('id, nome, telefone, cidade, ficha, valor_investir, pts, status, created_at')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(de, ate)),
  ]);
  return [
    ...cad.map(r => ({ origem: 'parceria' as const, r })),
    ...fic.map(r => ({ origem: 'nota1' as const, r })),
  ];
}

/** TODOS os cards da agenda por chave de contato (qualquer origem, qualquer status): quem tem card vivo
 *  fica fora, quem só tem card parado entra, e quem não tem card nenhum também fica fora. */
export async function lerCardsDoContato(agora: number = Date.now()): Promise<Map<string, CardDoContato[]>> {
  const linhas = await lerTudo<{
    id: number; cliente_telefone: string | null; status: string | null; quando: string | null; created_by: string | null; vendedor_nome: string | null;
  }>('cards da agenda', (de, ate) =>
    supabaseGerador.from('agendamentos').select('id, cliente_telefone, status, quando, created_by, vendedor_nome')
      .not('cliente_telefone', 'is', null).order('id', { ascending: true }).range(de, ate));
  // O histórico só dos agendados do lote de hoje em diante (a regra da reunião da equipe): são poucas centenas de linhas.
  const historicos = new Map<number, string | null>();
  for (const h of await lerTudo<{ id: number; historico: string | null }>('histórico dos agendados do lote', (de, ate) =>
    supabaseGerador.from('agendamentos').select('id, historico').ilike('created_by', ORIGEM_CADASTRO_EP).ilike('status', 'agendado')
      .gte('quando', new Date(agora - REUNIAO_VENCIDA_MS).toISOString()).order('id', { ascending: true }).range(de, ate))) historicos.set(Number(h.id), h.historico ?? null);
  const porChave = new Map<string, CardDoContato[]>();
  for (const l of linhas) {
    const k = chaveContato(l.cliente_telefone);
    if (!k) continue;
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k)!.push({
      id: Number(l.id), status: String(l.status ?? ''), quando: l.quando ?? null,
      origem: String(l.created_by ?? ''), vendedor: l.vendedor_nome ?? null,
      ...(historicos.has(Number(l.id)) ? { historico: historicos.get(Number(l.id)) } : {}),
    });
  }
  return porChave;
}

/** O tipo guardado de cada card (`tipo_card:<id>`): id -> cotista, arrendamento, integrador. */
async function lerTiposDosCards(): Promise<Map<number, string>> {
  const linhas = await lerTudo<{ key: string; value: unknown }>('tipos dos cards', (de, ate) =>
    supabase.from('system_state').select('key, value').like('key', `${TIPO_CARD_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  const mapa = new Map<number, string>();
  for (const l of linhas) {
    const id = Number(String(l.key).slice(TIPO_CARD_PREFIX.length));
    let v: unknown = l.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    const tipo = v && typeof v === 'object' ? String((v as { tipo?: unknown }).tipo ?? '').trim() : '';
    if (Number.isInteger(id) && tipo) mapa.set(id, tipo);
  }
  return mapa;
}

/** Os cards de eletroposto (qualquer `created_by` com "eletroposto"), com o tipo guardado: a QUARTA FONTE da fila. */
async function lerCardsEletroposto(): Promise<CardEletroposto[]> {
  const [linhas, tipos] = await Promise.all([
    lerTudo<{ id: number; cliente_telefone: string | null; cliente_nome: string | null; cidade: string | null; observacao: string | null; created_at: string | null }>(
      'cards de eletroposto', (de, ate) =>
        supabaseGerador.from('agendamentos').select('id, cliente_telefone, cliente_nome, cidade, observacao, created_at')
          .ilike('created_by', '%eletroposto%').not('cliente_telefone', 'is', null).order('id', { ascending: true }).range(de, ate)),
    lerTiposDosCards(),
  ]);
  return linhas.map(l => ({
    id: Number(l.id), telefone: l.cliente_telefone, nome: l.cliente_nome, cidade: l.cidade, observacao: l.observacao,
    criadoEm: String(l.created_at ?? ''), tipoCard: tipos.get(Number(l.id)) ?? null,
  }));
}

/** As chaves silenciadas só por `nunca_respondeu` (regra antiban de insistência, não pedido da pessoa). Quem a
 *  Helena já chamou e o ciclo fechou sem resposta entra na supressão por este motivo; o RETORNO pode falar com ela,
 *  e se ela responder a conversa não pode ser fechada como "pediu para parar". Erro SOBE. */
async function lerSilenciadosFracos(): Promise<Set<string>> {
  const linhas = await lerTudo<{ phone: string }>('supressão por falta de resposta', (de, ate) =>
    supabase.from('whatsapp_suppression').select('phone').eq('motivo', 'nunca_respondeu').order('phone', { ascending: true }).range(de, ate));
  const chaves = new Set<string>();
  for (const l of linhas) { const k = chaveContato(l.phone); if (k) chaves.add(k); }
  return chaves;
}

/**
 * Chaves com qualquer mensagem na linha nos últimos 7 dias, nossa ou dele.
 *
 * Quem digita pelo CELULAR da linha chega como LID (14 ou 15 dígitos), sem
 * telefone. Cruzar isso direto dá silêncio do lado errado: a conversa que a
 * Giovanna está tendo pareceria não existir. Então o LID é resolvido pelo mapa
 * `wa_lid_telefone` antes de virar chave. LID sem mapa é contado e aparece na
 * prévia: é conversa que esta trava não enxerga.
 */
async function lerChavesComConversa(agora: number): Promise<{ chaves: Set<string>; lidsSemMapa: number }> {
  const desde = new Date(agora - CONVERSA_RECENTE_MS).toISOString();
  const [msgs, mapa] = await Promise.all([
    lerTudo<{ telefone: string | null }>('mensagens dos últimos 7 dias', (de, ate) =>
      supabase.from('wa_mensagens').select('id, telefone')
        .eq('is_group', false).gte('momment', desde)
        .order('id', { ascending: true }).range(de, ate)),
    lerTudo<{ lid: string; chave: string | null; telefone: string | null }>('mapa de LID', (de, ate) =>
      supabase.from('wa_lid_telefone').select('lid, chave, telefone')
        .order('lid', { ascending: true }).range(de, ate)),
  ]);
  const chaveDoLid = new Map<string, string>();
  for (const m of mapa) {
    const k = String(m.chave || '') || chaveContato(m.telefone) || '';
    if (k) chaveDoLid.set(String(m.lid).replace(/\D/g, ''), k);
  }
  const chaves = new Set<string>();
  const semMapa = new Set<string>();
  for (const m of msgs) {
    const d = String(m.telefone ?? '').replace(/\D/g, '');
    if (!d) continue;
    if (d.length > 13) {
      const k = chaveDoLid.get(d);
      if (k) chaves.add(k); else semMapa.add(d);
      continue;
    }
    const k = chaveContato(d);
    if (k) chaves.add(k);
  }
  return { chaves, lidsSemMapa: semMapa.size };
}

/** As chaves de sessão antiga que voltam como retorno (mais de 21 dias sem resposta). */
function chavesDeRetorno(sessoes: ReadonlyMap<string, SessaoInvestidor>, carimbos: ReadonlyMap<string, CarimbosDosToques>, agoraMs: number): Set<string> {
  const out = new Set<string>();
  for (const [k, s] of sessoes) if (sessaoVoltaComoRetorno(s, ultimoEnvioDaSessao(s, carimbos.get(k)), agoraMs)) out.add(k);
  return out;
}

/** Monta a fila inteira. Qualquer leitura que falhar derruba a rodada: sem
 *  saber quem tem card, quem conversou ou quem pediu para parar, ninguém recebe. */
export async function lerFila(agora: number): Promise<LeituraDaFila> {
  const [linhas, cards, cardsEp, conversa, sessoes, carimbos, silenciado, mudo, bloqueado, pausa, fracos, grupos] = await Promise.all([
    lerOrigens(),
    lerCardsDoContato(agora),
    lerCardsEletroposto(),
    lerChavesComConversa(agora),
    lerSessoes(),
    lerCarimbosDeToque(),
    // Os quatro filtros da casa, lidos UMA vez por tick (o modelo é o
    // carregarBloqueioProativo do ioSend.ts). Mudo aqui é quem levou 2 toques
    // sem responder, mais apertado que o padrão de 3 (parecer anti-ban, 10/10).
    //
    // EM MODO ESTRITO (11/10/2026). O padrão destas quatro é falhar ABERTO: com
    // erro de leitura elas devolvem "ninguém barrado", o que serve para robô que
    // drena fila de quem já é nosso e não serve para abertura fria. Aqui o erro
    // SOBE, a fila não é montada e ninguém recebe (`erro_leitura_fila`; a prévia
    // mostra qual leitura falhou).
    carregarSilenciados({ estrito: true }),
    carregarMudos(2, 60, { estrito: true }),
    carregarBloqueados({ estrito: true }),
    carregarPausas({ estrito: true }),
    lerSilenciadosFracos(),
    lerGruposFechados(new Date(agora)),
  ]);
  // A sessão antiga que VOLTA (retorno) e a que não volta (tira a pessoa da fila).
  const retorno = new Set<string>();
  const comSessao = new Set<string>();
  for (const [k, s] of sessoes) {
    if (sessaoVoltaComoRetorno(s, ultimoEnvioDaSessao(s, carimbos.get(k)), agora)) retorno.add(k); else comSessao.add(k);
  }
  const resultado = montarFila(linhas, {
    cards, comSessao, retorno, comConversa: conversa.chaves,
    // O retorno fala com quem o ciclo antigo silenciou só por falta de resposta (`nunca_respondeu`).
    silenciado: (tel: string) => silenciado(tel) && !(fracos.has(chaveContato(tel) ?? '') && retorno.has(chaveContato(tel) ?? '')),
    mudo, bloqueado,
    comHumano: (tel: string) => !pausa(tel).pode,
    cardsEletroposto: cardsEp, agora,
  });
  const porFonte: Record<string, number> = {};
  const porTipoEFaixa: Record<string, Record<string, number>> = {};
  for (const c of resultado.fila) {
    porFonte[c.origem] = (porFonte[c.origem] ?? 0) + 1;
    const t = (porTipoEFaixa[c.tipo] ??= { card_parado: 0, lote_mudo: 0 });
    t[c.faixa] = (t[c.faixa] ?? 0) + 1;
  }
  return {
    resultado, sessoes, lidsSemMapa: conversa.lidsSemMapa, retorno,
    gruposFechados: grupos.fechados, paradasPorGrupo: grupos.paradas, porFonte, porTipoEFaixa,
  };
}

/**
 * O consultor desta pessoa quando ela NÃO tem card de eletroposto para remarcar: o rodízio Thiago e Diego da
 * LP (a contagem dos cards da LP, a mesma da rota, MAIS as sessões que a Helena já abriu), e o Parceiro vai
 * para a Giovanna (os integradores são dela desde 23/10/2026). Quem tem card fica com o dono do card.
 */
async function consultorDaVez(sessoesAbertas: number): Promise<string> {
  try {
    const { count, error } = await consultaDoRodizio([ORIGEM_LP_EP]);
    if (error) throw error;
    return donoDaVez((count || 0) + sessoesAbertas);
  } catch (err) {
    logger.warn(LOG, 'contagem do rodízio falhou: usando só as sessões da agente', { erro: String(err) });
    return donoDaVez(sessoesAbertas);
  }
}

/** O consultor de um candidato: o dono do card que ela remarca; sem card, a Giovanna para o Parceiro e o rodízio para os outros. */
export async function consultorDoCandidato(alvo: Pick<CandidatoInvestidor, 'card' | 'tipo'>, sessoesAbertas: number): Promise<string> {
  const doCard = String(alvo.card?.vendedor ?? '').trim();
  if (doCard) return doCard;
  if (alvo.tipo === 'parceiro') return 'Giovanna';
  return consultorDaVez(sessoesAbertas);
}

// ═════════════════════════════════════════════════════════════════════════════
// ABERTURA
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoAbertura { enviados: number; motivo?: string; fila?: number; para?: string; erro?: string; tipo?: TipoHelena; retorno?: boolean }

const semEnvio = (motivo: string, extra: Partial<ResultadoAbertura> = {}): ResultadoAbertura => ({ enviados: 0, motivo, ...extra });

/** Quantos da frente da fila a abertura olha antes de desistir da rodada (posse de agente da 5040, pausa humana). */
const CANDIDATOS_OLHADOS = 10;
/** Quem cede aos robôs de agenda NÃO gasta os candidatos olhados: o laço segue até este teto de pessoas por rodada. */
const CANDIDATOS_MAX_NA_RODADA = 30;

/** Um envio por chamada, sempre. */
export async function runInvestidorAberturaTick(opts: { agora?: Date } = {}): Promise<ResultadoAbertura> {
  const agora = opts.agora ?? new Date();

  // 1) Chave de desligar.
  const chave = await lerChaveDesligar();
  if (chave.off) return semEnvio(`desligada_${chave.por}`);

  // 2) Disjuntores. Dois erros de envio seguidos param tudo; pedidos de parada param só o grupo
  //    (Investidor 3 no dia, os outros 2). Sem conseguir ler, não envia.
  let disjuntor: Disjuntor;
  let gruposFechados: Set<string>;
  try {
    const [d, g] = await Promise.all([lerDisjuntor(), lerGruposFechados(agora)]);
    disjuntor = d; gruposFechados = g.fechados;
  } catch (err) {
    logger.error(LOG, 'ler o disjuntor falhou: abertura suspensa nesta rodada', err);
    return semEnvio('erro_leitura_disjuntor');
  }
  if (disjuntor.aberto) return semEnvio('disjuntor_erros_de_envio');

  // 3) Início e janela própria (feriado nacional fecha).
  if (antesDoInicio(agora)) return semEnvio('antes_do_inicio');
  if (!janelaAberta(agora)) return semEnvio('fora_da_janela');

  // 4) Teto do dia PRÓPRIO (20, só de teto de cima). A rampa de reconexão aperta: linha que acabou de
  //    voltar manda no ritmo dela. Falha de leitura da contagem fecha.
  const rampa = await rampaReconexaoVigente(agora);
  const teto = tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null);
  let enviadosHoje: number;
  try {
    enviadosHoje = await contarEnviadosHoje(agora);
  } catch (err) {
    logger.error(LOG, 'contar os envios de hoje falhou: abertura suspensa nesta rodada', err);
    return semEnvio('erro_leitura_teto');
  }
  if (enviadosHoje >= teto) return semEnvio('teto_do_dia');

  // 5) A linha. O frio é UM orçamento só da linha (parecer do chefe anti-ban, 12/11/2026): 6 por hora, 30 em
  //    24 h corridas, das 9h às 20h de segunda a sábado, 10 a 15 min de distância de qualquer envio. Sem
  //    piso por cima (o `pisoDia: maxPorDia()` saiu): o teto próprio da Helena só aperta.
  if (!(await dentroDoTetoHorarioLinha({ robo: 'investidor_agente_abertura' }))) return semEnvio('teto_da_linha');
  if (!(await respeitaEspacamentoLinha())) return semEnvio('espacamento_da_linha');

  // 6) A fila: o primeiro que passa nos portões de agora.
  let leitura: LeituraDaFila;
  try {
    leitura = await lerFila(agora.getTime());
  } catch (err) {
    logger.error(LOG, 'montar a fila falhou: ninguém recebe nesta rodada', err);
    return semEnvio('erro_leitura_fila');
  }
  const abertos = leitura.resultado.fila.filter(c => !gruposFechados.has(c.retorno ? 'retorno' : c.tipo));
  const tamanhoDaFila = abertos.length;
  if (!tamanhoDaFila) return semEnvio(leitura.resultado.fila.length ? 'grupos_fechados_hoje' : 'fila_vazia', { fila: 0 });

  // 7) Posse de agente da 5040 e pausa humana daquele telefone, conferidas de novo na hora de falar. Quem já é
  //    de outra agente (Duda, Carla, Helena da 5040) ou tem humano na conversa passa a vez ao próximo. O CLAIM
  //    também entra neste laço: o retorno que perde o claim (o `updated_at` da sessão antiga mudou) passa ao
  //    próximo candidato da mesma rodada, senão o mesmo ficaria na frente toda rodada (12/11/2026). Mesmo
  //    assim, o envio é UM por rodada.
  let alvo: CandidatoInvestidor | null = null;
  let abertura!: ReturnType<typeof renderAbertura>;
  let consultor = '';
  let sessao!: SessaoInvestidor;
  let antigaDoRetorno: SessaoInvestidor | null = null;
  let pulouPorPausa = false;
  let cedeuAAgenda = false;
  let motivoDoClaim: string | null = null;
  // Os robôs de agenda (reagenda, follow-up do não atendido, retorno) falam com alguma destas pessoas agora? Os cards e os
  // carimbos de todas são relidos de uma vez, ANTES do claim (investidorAgenteCede.ts).
  const doLote = abertos.slice(0, CANDIDATOS_MAX_NA_RODADA);
  const cedem = await cedeEmLote(doLote.map(c => ({ chave: c.chave, ids: c.cardsConhecidos })), agora.getTime());
  let olhados = 0;
  for (const c of doLote) {
    // Quem cede é PULADO sem gastar a rodada: a pessoa continua na fila e a próxima é a chamada.
    const cedeA = cedem.get(c.chave);
    if (cedeA) { logger.info(LOG, `abertura cede aos robôs de agenda (${cedeA}, final ${c.telefone.slice(-4)}): a pessoa fica na fila`); cedeuAAgenda = true; continue; }
    if (++olhados > CANDIDATOS_OLHADOS) break;
    if (await cedeAAgente(c.telefone)) continue;
    if (!(await podeFalarComLead(c.telefone)).pode) { await registrarBloqueio(c.telefone, LOG); pulouPorPausa = true; continue; }

    // CLAIM: o insert da sessão (ou, no retorno, o update da sessão antiga que ainda é a que foi lida).
    // 23505 = outra chamada já pegou esta pessoa.
    const aberturaC = renderAbertura(c.chave, c.nome, c.valorTxt, { tipo: c.tipo, cidade: c.cidade, retorno: c.retorno });
    const consultorC = await consultorDoCandidato(c, leitura.sessoes.size);
    const nowIso = new Date().toISOString();
    const sessaoC: SessaoInvestidor = {
      estagio: 'chamado', aberto_em: nowIso, abertura: aberturaC.indice,
      origem: c.origem, id: c.id, refs: c.refs,
      telefone: c.telefone, nome: c.nome, cidade: c.cidade, cadastro_em: c.criadoEm || null,
      valor_txt: c.valorTxt, consultor: consultorC,
      oferta: [], ofertas_feitas: 0, agendamento_id: null, motivo: null,
      dados: {}, resumo: '', erro: null, ate: null, respostas: 0, atualizado_em: nowIso,
      tipo: c.tipo, ...(c.retorno ? { retorno: true } : {}),
      card_id: c.card?.id ?? null,
      cards_conhecidos: c.cardsConhecidos,
      card_antigo: c.card ? { status: String(c.card.status), lote: ehCardSemAvisoAutomatico(c.card.origem) } : null,
      nota: c.nota,
      ...(c.fatosDoCard.length ? { fatos_do_card: c.fatosDoCard } : {}),
    };
    if (c.retorno) {
      const antiga = leitura.sessoes.get(c.chave);
      if (!antiga?.atualizado_em) { motivoDoClaim = 'sessao_antiga_sem_carimbo'; continue; }
      const { data, error: eTroca } = await supabase.from('system_state')
        .update({ value: sessaoC, updated_at: nowIso })
        .eq('key', chaveDaSessao(c.chave)).eq('updated_at', antiga.atualizado_em).select('key');
      if (eTroca) { logger.error(LOG, 'troca da sessão de retorno falhou', eTroca); return semEnvio('erro_claim'); }
      if (!((data ?? []) as unknown[]).length) { motivoDoClaim = 'ja_reivindicado'; continue; }
      antigaDoRetorno = antiga;
    } else {
      const { error: eClaim } = await supabase.from('system_state')
        .insert({ key: chaveDaSessao(c.chave), value: sessaoC, updated_at: nowIso });
      if (eClaim) {
        if (String((eClaim as { code?: string }).code) === '23505') return semEnvio('ja_reivindicado');
        logger.error(LOG, 'claim da sessão falhou', eClaim);
        return semEnvio('erro_claim');
      }
    }
    alvo = c; abertura = aberturaC; consultor = consultorC; sessao = sessaoC;
    break;
  }
  if (!alvo) return semEnvio(motivoDoClaim ?? (pulouPorPausa ? 'humano_na_conversa' : cedeuAAgenda ? 'robo_de_agenda_com_a_pessoa' : 'posse_de_agente_5040'), { fila: tamanhoDaFila });

  // O ciclo de toques recomeça pela abertura de retorno: os carimbos dos toques 2 a 5 do ciclo antigo saem,
  // senão a pessoa pareceria já no fim do ciclo e fecharia na hora. Só depois da tentativa de envio (saiu ou
  // errou), nunca quando a mensagem foi calada: aí a sessão antiga volta como estava.
  const limparToquesDoCicloAntigo = () => alvo!.retorno
    ? Promise.resolve(supabase.from('system_state').delete()
      .in('key', [2, 3, 4, 5].map(n => `${INV_SENT_PREFIX}${alvo!.chave}:t${n}`)))
      .then(undefined, (e: unknown) => logger.error(LOG, 'limpar os toques do ciclo antigo falhou', e))
    : Promise.resolve();

  // UMA bolha. Erro de envio fica na sessão e o tick PARA: não tenta o próximo.
  const fim4 = alvo.telefone.slice(-4);
  try {
    const saiu = await sendFrio(alvo.telefone, [abertura.texto], 'io');
    if (saiu === false) {
      // A pausa humana calou o envio na hora: NADA saiu. Sem carimbo e sem sessão (a pessoa fica para depois);
      // no retorno, a sessão antiga volta como estava.
      logger.warn(LOG, `abertura calada pela trava da linha (final ${fim4}): nada saiu, a pessoa fica para depois`);
      if (antigaDoRetorno) {
        await gravarSessao(alvo.chave, antigaDoRetorno).catch(e => logger.error(LOG, 'devolver a sessão antiga do retorno falhou', e));
      } else {
        const { error: eDesfazer } = await supabase.from('system_state').delete().eq('key', chaveDaSessao(alvo.chave));
        if (eDesfazer) logger.error(LOG, 'desfazer o claim da abertura calada falhou', eDesfazer);
      }
      return semEnvio('envio_calado_pela_linha', { fila: tamanhoDaFila });
    }
  } catch (err) {
    const erro = String((err as Error)?.message || err).slice(0, 300);
    logger.error(LOG, `abertura falhou para o final ${fim4}`, err);
    await limparToquesDoCicloAntigo();
    await gravarSessao(alvo.chave, { ...sessao, erro }).catch(e => logger.error(LOG, 'registrar o erro na sessão falhou', e));
    const erros = disjuntor.erros_seguidos + 1;
    await gravarDisjuntor({ erros_seguidos: erros, aberto: erros >= ERROS_ATE_ABRIR, ultimo_erro: erro });
    return semEnvio('erro_envio', { erro });
  }
  await limparToquesDoCicloAntigo();

  // Envio feito: agora sim o carimbo, uma chave por toque e por telefone.
  const carimbo = { key: `${INV_SENT_PREFIX}${alvo.chave}:t1`, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() };
  let { error: eCarimbo } = await supabase.from('system_state').upsert(carimbo, { onConflict: 'key' });
  if (eCarimbo) ({ error: eCarimbo } = await supabase.from('system_state').upsert(carimbo, { onConflict: 'key' }));
  if (eCarimbo) logger.error(LOG, `ENVIO FEITO SEM CARIMBO (final ${fim4}): o teto de hoje está contando um a menos`, eCarimbo);
  if (disjuntor.erros_seguidos > 0) await gravarDisjuntor({ erros_seguidos: 0, aberto: false });

  logger.info(LOG, `abertura${alvo.retorno ? ' de RETORNO' : ''} enviada (final ${fim4}, ${alvo.tipo}, ${alvo.origem} #${alvo.id}, consultor ${consultor})`);
  return { enviados: 1, fila: tamanhoDaFila - 1, para: `final ${fim4}`, tipo: alvo.tipo, ...(alvo.retorno ? { retorno: true } : {}) };
}

// ═════════════════════════════════════════════════════════════════════════════
// PRÉVIA (?dry=1): não envia, não grava, ignora janela e início.
// ═════════════════════════════════════════════════════════════════════════════

/** Quantas aberturas a prévia mostra por inteiro (o texto final, com o primeiro nome trocado por {nome}). */
const PROXIMAS_NA_PREVIA = 12;

/** O texto da abertura sem o primeiro nome da pessoa: o nome vira `{nome}`. Quem não tem nome que dê para usar
 *  já vem sem nome no texto. */
function textoSemOPrimeiroNome(c: CandidatoInvestidor): string {
  const texto = renderAbertura(c.chave, c.nome, c.valorTxt, { tipo: c.tipo, cidade: c.cidade, retorno: c.retorno }).texto;
  const p = primeiroNome(c.nome);
  return p ? texto.split(p).join('{nome}') : texto;
}

export async function previaInvestidorAgente(opts: { agora?: Date } = {}): Promise<Record<string, unknown>> {
  const agora = opts.agora ?? new Date();
  const tentar = async <T>(f: () => Promise<T>): Promise<T | { erro: string }> => {
    try { return await f(); } catch (e) { return { erro: String((e as Error)?.message || e) }; }
  };
  const [chave, disjuntor, enviados, aberturas, rampa, leitura] = await Promise.all([
    lerChaveDesligar(),
    tentar(lerDisjuntor),
    tentar(() => contarEnviadosHoje(agora)),
    tentar(() => contarAberturasHoje(agora)),
    rampaReconexaoVigente(agora),
    tentar(() => lerFila(agora.getTime())),
  ]);

  const teto = tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null);
  const base = {
    // Transcrições de áudio guardadas (chaves inv_agente_audio:*).
    transcricoes_em_cache: await tentar(() => contarChaves(INV_AUDIO_PREFIX)),
    hora_brasilia: horaBrasiliaTexto(agora),
    antes_do_inicio: antesDoInicio(agora),
    janela_aberta: janelaAberta(agora),
    desligada: chave,
    disjuntor,
    rampa_de_reconexao: rampa,
    teto_do_dia: teto,
    enviados_hoje: enviados,
    aberturas_hoje: aberturas,
  };
  if ('erro' in leitura) return { ...base, fila: null, erro_da_fila: leitura.erro };

  const { fila, excluidos, base: pessoas, porTipo } = leitura.resultado;
  const porEstagio: Record<string, number> = {};
  for (const s of leitura.sessoes.values()) porEstagio[String(s.estagio)] = (porEstagio[String(s.estagio)] ?? 0) + 1;

  return {
    ...base,
    pessoas_na_base: pessoas,
    fila: fila.length,
    fila_por_tipo: porTipo,
    // Por tipo e por faixa (card parado = já pediu reunião uma vez; lote mudo), e por fonte (parceria, nota1, card).
    fila_por_tipo_e_faixa: leitura.porTipoEFaixa,
    fila_por_fonte: leitura.porFonte,
    retornos_na_fila: leitura.retorno.size ? fila.filter(c => c.retorno).length : 0,
    ordem_dos_tipos: ORDEM_DOS_TIPOS,
    excluidos,
    // Conversa de humano pelo celular que o mapa de LID não resolveu: a trava
    // dos 7 dias não enxerga estas.
    lids_sem_mapa: leitura.lidsSemMapa,
    pedidos_de_parada_hoje: leitura.paradasPorGrupo,
    grupos_fechados_hoje: [...leitura.gruposFechados],
    sessoes_por_estagio: porEstagio,
    primeiros: fila.slice(0, 30).map((c: CandidatoInvestidor) => ({
      nome: primeiroNome(c.nome), telefone_final: c.telefone.slice(-2), tipo: c.tipo, faixa: c.faixa, retorno: c.retorno,
      valor: c.valorTxt || null, origem: `${c.origem}:${c.id}`,
    })),
    // As 12 próximas aberturas: sem telefone e sem o primeiro nome (vira {nome}).
    proximas_aberturas: fila.slice(0, PROXIMAS_NA_PREVIA).map(c => ({
      tipo: c.tipo, retorno: c.retorno, faixa: c.faixa, fonte: c.origem,
      tem_card: !!c.card, status_do_card: c.card ? String(c.card.status) : null,
      texto: textoSemOPrimeiroNome(c),
    })),
    retomadas: await tentar(() => previaDasRetomadas(leitura, agora, typeof enviados === 'number' ? enviados : null)),
    // A retomada do convite (13/11/2026): quem conversou, recebeu o convite (ou os horários) e parou de responder.
    convite_retomada: await tentar(() => previaDoConvite(leitura, agora)),
    // Escolhas de horário que se perderam (a sessão está em `ofertou`, a última fala é dela e ninguém
    // respondeu): quantas a recuperação reprocessaria.
    recuperacao_de_escolha: await tentar(async () => ({
      pendentes: (await acharEscolhasPendentes(leitura.sessoes, agora.getTime())).length,
      janela_aberta: dentroDaJanelaDeRecuperacao(agora),
      maximo_por_rodada: RECUPERACOES_POR_RODADA,
    })),
  };
}

/** A prévia que vai para o banco (`inv_agente_previa`): a mesma, SEM nome e SEM telefone de ninguém. */
export function previaParaGravar(previa: Record<string, unknown>): Record<string, unknown> {
  const { primeiros: _p, ...resto } = previa;
  const r = resto.retomadas as Record<string, unknown> | undefined;
  if (r && typeof r === 'object') {
    const { primeiros: _rp, textos: _rt, ...semNomes } = r;
    resto.retomadas = semNomes;
  }
  return resto;
}

/** O bloco `retomadas` da prévia: o que venceu, o que cabe hoje e o que sairia na próxima rodada. */
async function previaDasRetomadas(
  leitura: LeituraDaFila, agora: Date, enviadosNoDia: number | null,
): Promise<Record<string, unknown>> {
  const rampa = await rampaReconexaoVigente(agora);
  const teto = tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null);
  const [carimbos, retomadasHoje, silenciado, mudo, bloqueado, pausa] = await Promise.all([
    lerCarimbosDeToque(),
    contarRetomadasHoje(agora),
    carregarSilenciados({ estrito: true }),
    carregarMudos(3, 60, { estrito: true }),
    carregarBloqueados({ estrito: true }),
    carregarPausas({ estrito: true }),
  ]);
  const r = montarRetomadas(leitura.sessoes, carimbos, {
    silenciado, bloqueado, mudo, comHumano: (tel: string) => !pausa(tel).pode,
    retorno: leitura.retorno, gruposFechados: leitura.gruposFechados,
  }, agora.getTime());
  const limite = limiteDeRetomadasHoje(teto, process.env.INVESTIDOR_AGENTE_RETOMADAS_DIA);
  const cabe = (enviadosNoDia ?? 0) < teto && retomadasHoje < limite;
  return {
    vencidas_por_toque: r.vencidasPorToque,
    fechos_pendentes: r.fechos.length,
    passaram_nos_cortes: r.fila.length,
    // Sessões que saíram do ciclo porque alguém da casa escreveu depois do toque.
    ciclo_encerrado: [...leitura.sessoes.values()].filter(x => !!x.ciclo_encerrado).length,
    // Sessões antigas que NÃO recebem o toque atrasado: voltam pela fila como retorno.
    viram_retorno: leitura.retorno.size,
    excluidos: r.excluidos,
    enviadas_hoje: retomadasHoje,
    teto_por_dia: tetoRetomadasDoDia(process.env.INVESTIDOR_AGENTE_RETOMADAS_DIA),
    reserva_de_abertura: RETOMADAS_RESERVA_DE_ABERTURA,
    limite_hoje: limite,
    cabe_hoje: cabe,
    primeiros: r.fila.slice(0, 10).map(c => ({
      nome: primeiroNome(c.nome), telefone_final: c.telefone.slice(-2), tipo: c.tipo, toque: c.toque, vencida_ha_dias: c.vencidaHaDias,
    })),
    textos: r.fila.slice(0, 2).map(c => renderRetomada(c.toque, c.nome, c.tipo).texto),
    // A conversa nova desde o toque anterior só é conferida na hora de enviar.
    obs: 'a conversa nova desde o toque anterior é conferida no envio, não aqui',
  };
}

/**
 * O bloco `convite_retomada` da prévia: quantos candidatos a retomada do convite tem, quantos passam nos cortes e quantos já
 * estariam elegíveis pela conversa (24 h da última fala dela, nada depois). Só lê: não envia, não grava, sem nome nem telefone.
 */
async function previaDoConvite(leitura: LeituraDaFila, agora: Date): Promise<Record<string, unknown>> {
  const agoraMs = agora.getTime();
  const enviados = await lerConvitesJaEnviados();
  const base = [...leitura.sessoes.entries()].filter(([k, s]) => sessaoEntraNoConvite(s) && sessaoEhDaHelena(s, agoraMs) && !enviados.has(k));
  const [silenciado, mudo, bloqueado, pausa] = await Promise.all([
    carregarSilenciados({ estrito: true }), carregarMudos(3, 60, { estrito: true }),
    carregarBloqueados({ estrito: true }), carregarPausas({ estrito: true }),
  ]);
  const excluidos: Record<string, number> = {};
  const fora = (m: string) => { excluidos[m] = (excluidos[m] ?? 0) + 1; };
  const passam: Array<[string, SessaoInvestidor]> = [];
  for (const [k, s] of base) {
    if (leitura.gruposFechados.has(grupoDaSessao(s))) fora('grupo_fechado_hoje');
    else if (silenciado(s.telefone)) fora('opt_out');
    else if (bloqueado(s.telefone)) fora('bloqueado');
    else if (mudo(s.telefone)) fora('mudo');
    else if (!pausa(s.telefone).pode) fora('humano_na_conversa');
    else passam.push([k, s]);
  }
  let elegiveis = 0;
  const motivos: Record<string, number> = {};
  for (const [k, s] of passam.slice(0, 40)) {
    try {
      const conversa = await lerConversaAteAgora(k, s.telefone, agoraMs);
      const d = equipeAssumiu(conversa, s.aberto_em) ? { ok: false as const, motivo: 'equipe_assumiu' } : avaliarConvite(s, conversa, agoraMs, (await lerCarimbosDela(k)).momentos);
      if (d.ok) elegiveis++; else motivos[d.motivo] = (motivos[d.motivo] ?? 0) + 1;
    } catch { motivos.erro_leitura_conversa = (motivos.erro_leitura_conversa ?? 0) + 1; }
  }
  return {
    candidatos: base.length,
    passaram_nos_cortes: passam.length,
    elegiveis_agora: elegiveis,
    excluidos,
    motivos_da_conversa: motivos,
    ja_retomados: enviados.size,
    aguardando_silencio: [...leitura.sessoes.values()].filter(x => !!x.convite_retomado_em && sessaoEmConversaDaHelena(x.estagio)).length,
    obs: 'a conversa, os horários livres do consultor e o portão do frio são conferidos no envio',
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// RESPOSTAS
// ═════════════════════════════════════════════════════════════════════════════

export interface ResultadoRespostas {
  respondidas: number;
  agendadas: number;
  passadas: number;
  erros: number;
  motivo?: string;
  /** Respostas atrasadas (mais de 15 min) que saíram como frio nesta rodada. */
  frio?: number;
}

const semResposta = (motivo?: string): ResultadoRespostas =>
  ({ respondidas: 0, agendadas: 0, passadas: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** A Z-API às vezes entrega o número sem o nono dígito, ou sem o 55: pergunta por todas. */
function variantes(phone: string): string[] {
  const d = String(phone || '').replace(/\D/g, '');
  const out = new Set([d]);
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith('55')) out.add(d.slice(0, 4) + '9' + d.slice(4));
  for (const v of [...out]) if (v.startsWith('55') && v.length >= 12) out.add(v.slice(2));
  return [...out];
}

interface RespostaDoModelo { saida: SaidaHelena; modelo: string; stop_reason: string | null }

/**
 * Uma pergunta à IA: o modelo principal e, se ele falhar, a reserva.
 *
 * Falha do principal é: erro na chamada, parada por recusa (`refusal`), parada
 * por falta de espaço (`max_tokens`, que deixa o JSON pela metade) ou resposta
 * que não é o JSON combinado. Nas quatro a mesma pergunta vai para a reserva. Se
 * a reserva também falhar, a saída é inválida: a agente cala e o consultor, que
 * recebe o recado, assume.
 *
 * O campo `thinking` NÃO é enviado (neste modelo ele é sempre ligado, e pedir
 * para desligar devolve erro 400) e não há `tool_choice` forçado.
 */
async function perguntar(sistema: string, pedido: string): Promise<RespostaDoModelo> {
  const cliente = novoAnthropic();
  const textoDe = (r: Anthropic.Message) => r.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  try {
    const r = await cliente.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS_PRINCIPAL,
      system: sistema,
      output_config: { effort: ESFORCO, format: { type: 'json_schema', schema: SCHEMA_SAIDA_HELENA } },
      messages: [{ role: 'user', content: pedido }],
    }, OPCOES_DA_CHAMADA);
    const parada = String(r.stop_reason ?? '');
    if (PARADAS_QUE_SAO_FALHA.has(parada)) {
      logger.warn(LOG, `${MODELO} parou com stop_reason=${parada}: tentando a reserva`);
    } else {
      const saida = lerSaida(textoDe(r));
      if (saida.valido) return { saida, modelo: MODELO, stop_reason: r.stop_reason ?? null };
      logger.warn(LOG, `${MODELO} devolveu algo fora do formato (stop_reason=${parada || 'vazio'}): tentando a reserva`);
    }
  } catch (err) {
    logger.warn(LOG, `${MODELO} falhou, tentando a reserva`, { erro: String((err as Error)?.message || err).slice(0, 300) });
  }
  try {
    const r = await cliente.messages.create({
      model: MODELO_RESERVA,
      max_tokens: 1500,
      system: sistema,
      messages: [{ role: 'user', content: pedido }],
    }, OPCOES_DA_CHAMADA);
    const parada = String(r.stop_reason ?? '');
    if (PARADAS_QUE_SAO_FALHA.has(parada)) {
      logger.error(LOG, `a reserva ${MODELO_RESERVA} parou com stop_reason=${parada}: a IA não respondeu`);
      return { saida: lerSaida(''), modelo: MODELO_RESERVA, stop_reason: r.stop_reason ?? null };
    }
    return { saida: lerSaida(textoDe(r)), modelo: MODELO_RESERVA, stop_reason: r.stop_reason ?? null };
  } catch (err) {
    logger.error(LOG, 'a IA não respondeu', err);
    return { saida: lerSaida(''), modelo: MODELO_RESERVA, stop_reason: null };
  }
}

export interface Pensamento {
  /** Quem deu a resposta que valeu: o principal ou a reserva. */
  modelo: string;
  stop_reason: string | null;
  ms: number;
  saida: SaidaHelena;
  /** A resposta foi barrada pela trava de conteúdo, mesmo depois da reescrita. Com isto preenchido NADA sai para o cliente. */
  violacao: string | null;
  /** A primeira resposta foi barrada por isto, e a reescrita passou. */
  reescrita: string | null;
}

/**
 * O MIOLO DA CONVERSA, um só para a produção e para a sonda: pergunta ao modelo
 * (principal, reserva), lê a saída e passa a trava de conteúdo. Resposta que
 * promete rendimento, cita percentual, fala em cota ou põe site não sai: o
 * modelo ganha UMA chance de reescrever sabendo qual regra quebrou.
 *
 * Não grava, não envia e não lê banco: só fala com a IA.
 */
async function pensar(sistema: string, pedido: string, valoresDaPessoa: readonly number[]): Promise<Pensamento> {
  const inicio = Date.now();
  let r = await perguntar(sistema, pedido);
  let violacao: string | null = null;
  let reescrita: string | null = null;
  if (r.saida.valido && r.saida.acao === 'continuar') {
    const quebra = violaRegras(r.saida.bolhas, valoresDaPessoa);
    if (quebra) {
      logger.warn(LOG, `resposta da IA barrada (${quebra}): pedindo para reescrever`);
      const segunda = await perguntar(sistema, pedidoDeReescrita(pedido, quebra, r.saida.bolhas));
      const quebrouDeNovo = !segunda.saida.valido
        ? 'a reescrita não veio no formato combinado'
        : segunda.saida.acao === 'continuar' ? violaRegras(segunda.saida.bolhas, valoresDaPessoa) : null;
      if (quebrouDeNovo) {
        logger.warn(LOG, `a reescrita também foi barrada: ${quebrouDeNovo}`);
        violacao = `${quebra}; na reescrita, ${quebrouDeNovo}`;
      } else {
        reescrita = quebra;
        r = segunda;
      }
    }
  }
  return { modelo: r.modelo, stop_reason: r.stop_reason, ms: Date.now() - inicio, saida: r.saida, violacao, reescrita };
}

/**
 * SONDA: o que a Helena responderia a esta conversa, pelo MESMO caminho da
 * produção (montarSistema, montarPedido e o miolo `pensar`). Serve para provar o
 * comportamento com o modelo de verdade sem tocar em cliente nenhum: não grava,
 * não envia e não lê banco.
 */
export async function sondarHelena(
  ctx: ContextoHelena, historico: readonly MsgDaConversa[], novas: readonly MsgDaConversa[],
): Promise<{
  modelo: string; stop_reason: string | null; ms: number; valido: boolean;
  acao: SaidaHelena['acao']; bolhas: string[]; dados: DadosDaConversa; resumo: string; opcao: number;
  violacao: string | null; reescrita: string | null;
}> {
  const p = await pensar(montarSistema(ctx), montarPedido(historico, novas), valoresLiberados(ctx, historico, novas));
  return {
    modelo: p.modelo, stop_reason: p.stop_reason, ms: p.ms, valido: p.saida.valido,
    acao: p.saida.acao, bolhas: p.saida.bolhas, dados: p.saida.dados, resumo: p.saida.resumo, opcao: p.saida.opcao ?? 0,
    violacao: p.violacao, reescrita: p.reescrita,
  };
}

/** O recado no celular da equipe, do mesmo jeito que o eletropostoRespostas
 *  repassa: para o Thiago e para o Diego, com o nome de quem atende. */
const RODAPE_PASSOU = '_A Helena parou de responder nesta conversa. A partir daqui é com você._';
const RODAPE_ADIOU = '_A Helena não vai mais chamar esta pessoa por conta própria. Se ela escrever de novo, a Helena responde. Se você for procurar, a data que ela pediu está no resumo._';

/** O telefone só com dígitos, para comparar o celular do dono do card com a lista da equipe (pelos 8 últimos). */
const mesmoCelular = (a: string, b: string): boolean => {
  const x = String(a).replace(/\D/g, ''), y = String(b).replace(/\D/g, '');
  return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8);
};

/** O celular do consultor dono da conversa (tabela `consultores`, com a lista de reserva) e, sem ele, o do dono da casa. */
async function celularDoConsultor(consultor: string): Promise<string> {
  const lido = await carregarTelefonesConsultores();
  const doConsultor = telefoneDoConsultor(lido.ok ? lido.mapa : new Map(), consultor);
  return doConsultor ?? telefoneDoDono();
}

/** A pausa entre dois avisos à equipe: um por pessoa, em sequência, nunca em rajada (chefe anti-ban, 12/11/2026). */
const pausaEntreAvisosMs = (): number => 2000 + Math.floor(Math.random() * 3000);

/**
 * Manda os avisos UM POR PESSOA, em sequência, com 2 a 5 s entre eles (nunca em paralelo). Devolve quantos saíram.
 */
async function enviarEmSequencia(avisos: ReadonlyArray<{ tel: string; texto: string }>): Promise<number> {
  let ok = 0;
  for (let i = 0; i < avisos.length; i++) {
    if (i > 0) await TEMPOS_DA_RESPOSTA.dormir(pausaEntreAvisosMs());
    try { await sendWhatsApp(avisos[i]!.tel, avisos[i]!.texto, 'io'); ok++; } catch (e) { logger.error(LOG, 'um aviso à equipe não saiu', { erro: String(e).slice(0, 200) }); }
  }
  return ok;
}

async function avisarEquipe(
  s: SessaoInvestidor, titulo: string, novas: readonly MsgDaConversa[], extra = '', rodape: string = RODAPE_PASSOU,
): Promise<boolean> {
  const escreveu = novas.map(m => (m.texto || `[${m.tipo}]`)).join(' / ').slice(0, 600);
  const tipo = tipoDaSessao(s.tipo);
  const corpo = [
    `*HELENA (eletroposto) PASSOU PARA VOCÊ: ${titulo}*`,
    `*Cliente:* ${s.nome || 'sem nome'}${s.cidade ? ` (${s.cidade})` : ''}`,
    `*WhatsApp:* wa.me/${s.telefone}`,
    `*Tipo:* ${tipo}${s.retorno ? ' (retomada depois de um tempo)' : ''}`,
    s.valor_txt ? `*Valor que marcou:* ${s.valor_txt}` : '',
    `*Com:* ${s.consultor}`,
    s.resumo ? `*Resumo:* ${s.resumo}` : '',
    escreveu ? `*Escreveu:* ${escreveu}` : '',
    extra,
  ].filter(Boolean);
  const recado = [...corpo, '', rodape].join('\n');
  const avisos: Array<{ tel: string; texto: string }> = [];
  let equipe = Object.values(EQUIPE).map(String);
  // Conversa com card: o DONO do card recebe a ficha da conversa com o motivo (no lugar do recado seco), e
  // os outros da equipe recebem o recado. Cada pessoa recebe UMA mensagem.
  if (s.card_id) {
    const dono = await celularDoConsultor(s.consultor);
    avisos.push({
      tel: dono,
      texto: [montarFichaConsultor({
        nome: s.nome, telefone: s.telefone, tipo, retorno: s.retorno, consultor: primeiroNomeDoConsultor(s.consultor),
        motivo: [titulo, extra.replace(/^\*Motivo:\*\s*/, '')].filter(Boolean).join('. '), dados: s.dados, resumo: s.resumo,
      }), '', rodape].join('\n'),
    });
    equipe = equipe.filter(t => !mesmoCelular(t, dono));
  }
  for (const tel of equipe) avisos.push({ tel, texto: recado });
  const ok = await enviarEmSequencia(avisos);
  if (!ok) logger.error(LOG, `recado à equipe não chegou em ninguém (final ${s.telefone.slice(-4)})`);
  return ok > 0;
}

type StatusCadastro = 'falando' | 'conectado' | 'sem_interesse';
const TABELA_DO_CADASTRO: Record<string, string> = { parceria: 'eletroposto_parceria', nota1: 'eletroposto_nota1', agenda: 'agendamentos' };

/**
 * O status da linha de cadastro, nas tabelas daquele telefone.
 *
 * `falando` e `conectado` só sobem por cima de status "anterior" (vazio, novo,
 * falando): nunca apagam um `sem_interesse` que a equipe marcou à mão.
 * `sem_interesse` grava sempre, porque foi a própria pessoa quem disse.
 *
 * Origem `agenda` (card marcado ARRENDAMENTO): o status do card é do consultor, então só o
 * `sem_interesse` da própria pessoa chega nele, e só enquanto o card ainda é `arrendamento`.
 * Origem `card` (quarta fonte) não tem cadastro para marcar.
 */
async function marcarCadastro(s: SessaoInvestidor, status: StatusCadastro): Promise<void> {
  const refs = s.refs?.length ? s.refs : [{ origem: s.origem, id: s.id }];
  for (const ref of refs) {
    const tabela = TABELA_DO_CADASTRO[ref.origem];
    if (!tabela) continue;
    if (ref.origem === 'agenda' && status !== 'sem_interesse') continue;
    let q = supabaseGerador.from(tabela).update({ status }).eq('id', ref.id);
    if (ref.origem === 'agenda') q = q.eq('status', 'arrendamento');
    if (status === 'falando') q = q.or('status.is.null,status.eq.novo');
    if (status === 'conectado') q = q.or('status.is.null,status.in.(novo,falando)');
    const { error } = await q;
    if (error) logger.error(LOG, `marcar ${tabela} #${ref.id} como ${status} falhou`, error);
  }
}

/**
 * As linhas de cadastro da pessoa, cruas, nas duas tabelas: é de onde a IA fica
 * sabendo o que ela JÁ respondeu no formulário. Leitura por id, uma por linha.
 * Se uma falhar, a conversa segue sem aquelas respostas (a IA pode acabar
 * perguntando de novo, o que é pior, mas não é motivo para deixar a pessoa sem
 * resposta).
 */
async function lerFormulario(s: SessaoInvestidor): Promise<FonteDoFormulario[]> {
  const refs = s.refs?.length ? s.refs : [{ origem: s.origem, id: s.id }];
  const fontes: FonteDoFormulario[] = [];
  for (const ref of refs.slice(0, 4)) {
    if (ref.origem !== 'parceria' && ref.origem !== 'nota1') continue;   // card e agenda não são formulário
    const tabela = TABELA_DO_CADASTRO[ref.origem];
    if (!tabela) continue;
    try {
      const { data, error } = await supabaseGerador.from(tabela).select('*').eq('id', ref.id).maybeSingle();
      if (error) throw error;
      if (data) fontes.push({ origem: ref.origem, r: data as Record<string, unknown> });
    } catch (err) {
      logger.warn(LOG, `ler o formulário (${tabela} #${ref.id}) falhou: a IA segue sem essas respostas`, { erro: String((err as Error)?.message || err).slice(0, 200) });
    }
  }
  return fontes;
}

/**
 * Este telefone ganhou card na agenda por outra porta (LP, consultor)? Devolve o id do card, ou null.
 *
 * Desde 12/11/2026 todo cliente que a Helena chama JÁ tem card parado (é assim que entra na fila), então "tem card"
 * não quer dizer nada. Vale só o que mudou desde a abertura: um card que a sessão não conhecia (e que não seja
 * cancelado), ou um card conhecido que deixou de ser reabrível (o consultor o pôs em atendimento, a pessoa marcou
 * pela página). O card que a própria Helena remarcou não conta. Quem tem card por outra porta passa a vez para a
 * agenda: a Helena fecha a sessão.
 */
async function cardPorOutraPorta(s: SessaoInvestidor): Promise<number | null> {
  const tel = s.telefone;
  const chave = chaveContato(tel);
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('id, cliente_telefone, status, quando, created_by, vendedor_nome, historico').ilike('cliente_telefone', `%${tel.slice(-8)}`)
    .order('id', { ascending: false }).limit(50);
  if (error) throw new Error(`conferir card do telefone: ${error.message}`);
  const conhecidos = new Set(s.cards_conhecidos ?? []);
  const agora = Date.now();
  for (const a of (data ?? []) as Array<{ id: number; cliente_telefone: string | null; status: string | null; quando: string | null; created_by: string | null; vendedor_nome: string | null; historico?: string | null }>) {
    if (chaveContato(a.cliente_telefone) !== chave || a.id === s.agendamento_id) continue;
    const status = String(a.status ?? '').trim().toLowerCase();
    if (!conhecidos.has(a.id)) { if (status !== 'cancelado') return a.id; continue; }
    if (!cardReabre({ id: a.id, status, quando: a.quando, origem: String(a.created_by ?? ''), vendedor: a.vendedor_nome, historico: a.historico ?? null }, agora)) return a.id;
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// ÁUDIO (13/10/2026, ordem do dono: "quando responderem com áudio tem que ser
// transcrito e entendido"). Antes a Helena via "[audio]" e pedia para escrever.
//
// O endereço do arquivo é `wa_mensagens.media_url` (cópia do `audio.audioUrl` da
// Z-API, feita pelo trigger do webhook). A transcrição é `transcribeAudio` (Whisper,
// OPENAI_API_KEY) e fica em `system_state` (`inv_agente_audio:<id>`), para a mesma
// mensagem nunca ser paga duas vezes. NADA aqui lança: falhou, a mensagem segue
// "[audio]" e a regra de pedir para a pessoa escrever vale como antes (ela mora no bloco
// do redator, `REGRAS_DO_PROMPT`, e na frase técnica de `montarSistema`).
// A transcrição vai no campo `transcricao`, NUNCA em `texto`: `texto` decide o pedido
// de parada, o número solto de horário e a recuperação de escolha pendente.
// ═════════════════════════════════════════════════════════════════════════════

const chaveDoAudio = (id: unknown): string => `${INV_AUDIO_PREFIX}${id}`;
const temId = (m: MsgDaConversa): boolean => m.id !== null && m.id !== undefined && String(m.id) !== '';

/** As transcrições que já estão em cache, por id da mensagem. Erro de leitura NÃO sobe:
 *  sem cache a mensagem segue "[audio]". */
async function lerTranscricoes(ids: ReadonlyArray<string | number>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { data, error } = await supabase.from('system_state').select('key, value').in('key', ids.map(chaveDoAudio));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ key: string; value: { texto?: unknown } | null }>) {
      const texto = String(r.value?.texto ?? '').trim();
      if (texto) out.set(r.key.slice(INV_AUDIO_PREFIX.length), texto);
    }
  } catch (err) {
    logger.warn(LOG, 'ler o cache de transcrições falhou: os áudios seguem como [audio]', { erro: String((err as Error)?.message || err).slice(0, 200) });
  }
  return out;
}

/** O formato pelo endereço: a tabela não guarda o mimetype. Sem pista, é o ogg do WhatsApp. */
function mimeDoAudio(url: string): string {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(url.split(/[?#]/)[0]!)?.[1]?.toLowerCase();
  if (ext === 'mp3' || ext === 'mpeg') return 'audio/mpeg';
  if (ext === 'mp4' || ext === 'm4a') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'webm') return 'audio/webm';
  return 'audio/ogg';
}

/** Uma transcrição, com tempo limite próprio. Nunca lança: qualquer falha vira null. */
async function transcreverUm(url: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limite = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TEMPO_DO_AUDIO_MS); });
    const texto = await Promise.race([transcribeAudio(url, mimeDoAudio(url)), limite]);
    return String(texto ?? '').trim() || null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Põe a transcrição nos áudios novos da leva: cache primeiro; o que falta é
 * transcrito (no máximo AUDIOS_POR_LEVA por leva, em paralelo) e guardado. Mensagem sem
 * id, sem endereço, acima do teto, ou cuja transcrição falhou, veio vazia ou estourou o
 * tempo fica como veio (sem `transcricao`). Nunca lança.
 */
async function comTranscricoes(novas: readonly MsgDaConversa[]): Promise<MsgDaConversa[]> {
  try {
    const audios = novas.filter(m => ehAudioSemTexto(m) && temId(m));
    if (!audios.length) return [...novas];
    const emCache = await lerTranscricoes(audios.map(m => m.id as string | number));
    const faltam = audios
      .filter(m => !emCache.has(String(m.id)) && /^https?:\/\//i.test(String(m.media_url ?? '')))
      .slice(0, AUDIOS_POR_LEVA);
    await Promise.all(faltam.map(async m => {
      const t0 = Date.now();
      const texto = await transcreverUm(String(m.media_url));
      // Só o id, o tamanho e o tempo: a transcrição é fala de cliente e não vai para o log.
      logger.info(LOG, `áudio ${m.id}: ${texto ? `transcrito (${texto.length} caracteres)` : 'sem transcrição'} em ${Date.now() - t0} ms`);
      if (!texto) return;
      emCache.set(String(m.id), texto);
      const em = new Date().toISOString();
      const { error } = await supabase.from('system_state')
        .insert({ key: chaveDoAudio(m.id), value: { texto, em }, updated_at: em });
      // 23505: outra chamada gravou primeiro. Qualquer outro erro: a transcrição vale nesta
      // rodada, só não fica guardada.
      if (error && String((error as { code?: string }).code) !== '23505') {
        logger.warn(LOG, `áudio ${m.id}: guardar a transcrição falhou`, { erro: String(error.message).slice(0, 200) });
      }
    }));
    return novas.map(m => (ehAudioSemTexto(m) && temId(m) && emCache.has(String(m.id)) ? { ...m, transcricao: emCache.get(String(m.id))! } : m));
  } catch (err) {
    logger.warn(LOG, 'transcrever os áudios falhou: a leva segue como [audio]', { erro: String((err as Error)?.message || err).slice(0, 200) });
    return [...novas];
  }
}

/**
 * A conversa da linha com ESTA pessoa, mais antiga primeiro, até 20 mensagens.
 *
 * O `like '%<8 últimos>%'` sozinho traz gente demais: o mesmo final em outro DDD
 * é outra pessoa, e um LID de 15 dígitos pode conter esses 8 por acaso. Então,
 * depois de buscar, cada linha é conferida pela chave exata (DDD + 8). O que um
 * consultor digitou pelo celular fica gravado sob o LID do contato, e entra pela
 * lista de LIDs que o mapa `wa_lid_telefone` dá para esta chave: a IA precisa
 * ver o que a equipe já disse.
 *
 * Erro de leitura SOBE. Responder sem ter lido a conversa é a regra que a casa
 * proíbe (23/09, "se não sabe o que já foi dito, não fala").
 */
async function lerHistorico(chave: string, telefone: string, antesDe: string): Promise<MsgDaConversa[]> {
  const { data: mapa, error: eMapa } = await supabase
    .from('wa_lid_telefone').select('lid').eq('chave', chave).limit(50);
  if (eMapa) throw new Error(`mapa de LID: ${eMapa.message}`);
  const lids = new Set(((mapa ?? []) as Array<{ lid: string }>).map(m => String(m.lid).replace(/\D/g, '')).filter(Boolean));

  const base = () => supabase.from('wa_mensagens')
    .select('id, telefone, from_me, from_api, texto, tipo, momment')
    .eq('instancia', INSTANCE_ID_IO).eq('is_group', false)
    .lt('momment', antesDe)
    .order('momment', { ascending: false });
  const consultas = [base().like('telefone', `%${telefone.slice(-8)}%`).limit(60)];
  if (lids.size) consultas.push(base().in('telefone', [...lids]).limit(40));

  const linhas: Array<MsgDaConversa & { telefone: string | null }> = [];
  for (const r of await Promise.all(consultas)) {
    if (r.error) throw new Error(`conversa da linha: ${r.error.message}`);
    linhas.push(...((r.data ?? []) as Array<MsgDaConversa & { telefone: string | null }>));
  }
  const daPessoa = linhas.filter(m => {
    const d = String(m.telefone ?? '').replace(/\D/g, '');
    return d.length > 13 ? lids.has(d) : chaveContato(d) === chave;
  });
  const vistos = new Set<string>();
  const conversa = daPessoa
    .filter(m => { const k = `${m.momment}|${m.from_me}|${m.texto}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0))
    .slice(-20);
  // Áudio que já tem transcrição em cache aparece com ela (do cliente e nosso). Áudio sem
  // cache segue "[audio]". Só o áudio carrega `id` e `transcricao`; as outras linhas não mudam.
  const cache = await lerTranscricoes(conversa.filter(m => ehAudioSemTexto(m) && temId(m)).map(m => m.id as string | number));
  return conversa.map(({ id, from_me, from_api, texto, tipo, momment }) => {
    if (!(ehAudioSemTexto({ tipo, texto }) && id !== null && id !== undefined)) return { from_me, from_api, texto, tipo, momment };
    const transcricao = cache.get(String(id));
    return transcricao ? { id, from_me, from_api, texto, tipo, momment, transcricao } : { id, from_me, from_api, texto, tipo, momment };
  });
}

interface Contexto {
  chave: string;
  novas: MsgDaConversa[];
  ultima: string;
  res: ResultadoRespostas;
  /** A conversa até a primeira mensagem nova, já lida e conferida. */
  historico: MsgDaConversa[];
  /** A leva é de mensagem com mais de 15 min: a resposta sai como FRIO (1 bolha, sendFrio, registro próprio). */
  frio?: boolean;
  /** A linha falhou ao enviar: a rodada de respostas PARA (chefe anti-ban: erro de linha encerra a rodada). */
  linhaCaiu?: boolean;
}

/**
 * O ÚNICO ponto por onde a Helena fala com o cliente dentro de uma conversa.
 *
 *   · resposta NORMAL (até 15 min depois da mensagem dela): sendHuman, até 2 bolhas, 2 a 5 s entre elas, e uma chave
 *     `inv_agente_env:` por bolha (PREFIXOS_RESPOSTA_AGENTES) para o frio esperar 2 min e o teto de emergência enxergar;
 *   · resposta ATRASADA (`ctx.frio`): FRIO. UMA bolha de até 900 caracteres, por sendFrio, com o registro
 *     `inv_agente_frio:` (BOT_SENT_PREFIXES: conta no teto do frio e no espaço de 10 a 15 min). Nunca debaixo de
 *     `inv_agente_sent:`, que a Helena conta como toque e que comeria a cota dela.
 * Erro de envio sobe, e marca `ctx.linhaCaiu` para a rodada parar.
 */
export const TETO_DA_BOLHA_FRIA = 900;

/** Soma um erro de envio ao disjuntor (como a abertura faz). Sem conseguir ler, não derruba o chamador. */
async function contarErroDeEnvio(err: unknown): Promise<void> {
  try {
    const erro = String((err as Error)?.message || err).slice(0, 300);
    const erros = (await lerDisjuntor()).erros_seguidos + 1;
    await gravarDisjuntor({ erros_seguidos: erros, aberto: erros >= ERROS_ATE_ABRIR, ultimo_erro: erro });
  } catch (e) {
    logger.error(LOG, 'contar o erro de envio frio no disjuntor falhou', e);
  }
}

async function falarComOCliente(
  s: SessaoInvestidor, ctx: Contexto, bolhas: readonly string[], opts: { maxBolhas?: number; max?: number } = {},
): Promise<void> {
  try {
    if (ctx.frio) {
      const texto = bolhas.map(b => String(b).trim()).filter(Boolean).join(' ').slice(0, TETO_DA_BOLHA_FRIA);
      let saiu: boolean;
      try {
        saiu = await sendFrio(s.telefone, [texto], 'io');
      } catch (err) {
        // Erro de envio no frio conta no MESMO disjuntor da abertura (2 seguidos param tudo).
        await contarErroDeEnvio(err);
        throw err;
      }
      if (saiu === false) throw new Error('o envio frio foi calado pela trava da linha');
      const em = new Date().toISOString();
      const { error } = await supabase.from('system_state')
        .upsert({ key: `${INV_FRIO_PREFIX}${ctx.chave}:${Date.now()}`, value: { em }, updated_at: em }, { onConflict: 'key' });
      if (error) logger.error(LOG, `RESPOSTA FRIA ENVIADA SEM REGISTRO (final ${s.telefone.slice(-4)}): o teto do frio está contando a menos`, error);
      return;
    }
    await sendHuman(s.telefone, [...bolhas], 'io', { maxBolhas: opts.maxBolhas ?? 2, ...(opts.max ? { max: opts.max } : {}) });
    await registrarBolhas(ctx.chave, Math.min(opts.maxBolhas ?? 2, Math.max(1, bolhas.length)));
  } catch (err) {
    ctx.linhaCaiu = true;
    throw err;
  }
}

/** Fecha a conversa passando para gente: estado primeiro, depois o texto fixo
 *  (quando há o que dizer ao cliente) e o recado à equipe. */
async function passarParaHumano(
  s: SessaoInvestidor, ctx: Contexto, motivo: string, titulo: string,
  opts: { falarComOCliente: boolean; extra?: string },
): Promise<void> {
  const nova: SessaoInvestidor = { ...s, estagio: 'humano', motivo, ate: ctx.ultima };
  await gravarSessao(ctx.chave, nova);
  if (opts.falarComOCliente) {
    try {
      await falarComOCliente(s, ctx, [textoPassagem(ctx.chave)]);
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'texto de passagem não saiu', { erro: String(e) });
    }
  }
  if (await avisarEquipe(nova, titulo, ctx.novas, opts.extra ?? '')) ctx.res.passadas++;
}

/** Manda a lista de horários. `excluir` tira os que a pessoa já recusou. */
/**
 * UMA bolha curta do modelo que pode sair ANTES do texto fixo (`oferecer_horarios` e `sem_interesse`): responde a pergunta
 * que veio junto. Passa pelo `violaRegras`; barrada, vazia ou longa demais, sai só o texto fixo. Das bolhas do modelo,
 * vale a primeira (a resposta é uma só).
 */
export const BOLHA_ANTES_DO_FIXO_MAX = 300;
export function bolhaAntesDoTextoFixo(bolhas: readonly string[], valoresDaPessoa: readonly number[] = []): string | null {
  const b = String(bolhas.find(x => String(x ?? '').trim()) ?? '').trim();
  if (!b || b.length > BOLHA_ANTES_DO_FIXO_MAX) return null;
  return violaRegras([b], valoresDaPessoa) ? null : b;
}

async function oferecerHorarios(
  s: SessaoInvestidor, ctx: Contexto, opts: { foiOcupado?: boolean; bolhaDoModelo?: string | null } = {},
): Promise<void> {
  if ((s.ofertas_feitas ?? 0) >= MAX_OFERTAS) {
    await passarParaHumano(s, ctx, 'muitas_ofertas', 'NENHUM HORÁRIO SERVIU', { falarComOCliente: true });
    return;
  }
  const agora = Date.now();
  const compromissos = await carregarCompromissos(new Date(agora).toISOString(), new Date(agora + 22 * 86_400_000).toISOString());
  const horarios = compromissos ? horariosDaOferta(s.consultor, compromissos, agora, s.oferta ?? []) : [];
  if (horarios.length < 4) {
    await passarParaHumano(s, ctx, compromissos ? 'sem_vaga' : 'sem_leitura_da_agenda', 'QUER HORÁRIO E NÃO ACHEI 4 LIVRES', { falarComOCliente: true });
    return;
  }
  // Estado primeiro: a oferta fica gravada antes de a lista sair.
  const nova: SessaoInvestidor = {
    ...s, estagio: 'ofertou', oferta: horarios, ofertas_feitas: (s.ofertas_feitas ?? 0) + 1,
    ate: ctx.ultima, respostas: (s.respostas ?? 0) + 1,
  };
  await gravarSessao(ctx.chave, nova);
  try {
    // A lista é UMA bolha, com as 4 linhas numeradas inteiras (o teto de 900 não corta). Com a bolha do modelo antes
    // (responde a pergunta que veio junto do aceite) são no máximo 2 mensagens. Na resposta atrasada (frio, 1 mensagem
    // só, que cortaria a lista) a bolha do modelo não vai.
    const antes = ctx.frio ? null : (opts.bolhaDoModelo ?? null);
    const lista = textoOferta(ctx.chave, horarios, { foiOcupado: opts.foiOcupado });
    await falarComOCliente(s, ctx, antes ? [antes, lista] : [lista], { maxBolhas: antes ? 2 : 1, max: 900 });
    ctx.res.respondidas++;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'a lista de horários não saiu', { erro: String(e) });
    await passarParaHumano(nova, ctx, 'erro_envio_oferta', 'QUER HORÁRIO E A LISTA NÃO SAIU', { falarComOCliente: false });
  }
}

/** O `tipo_card` de cada tipo do cadastro (o que a agenda mostra como COTISTA, ARRENDAMENTO ou INTEGRADOR). O Curioso
 *  usa o mesmo que a LP grava quando não sabe: cotista. */
export const TIPO_DO_CARD_POR_TIPO: Readonly<Record<TipoHelena, string>> = {
  investidor: 'cotista', arrendamento: 'arrendamento', parceiro: 'integrador', curioso: 'cotista',
};

/**
 * A ficha ao consultor dono do card: UMA mensagem por agendamento, com o resumo e os campos preenchidos. A ficha_5040
 * das agentes da 5040 NÃO cobre o card da Helena (`agente_eletroposto` está fora de ORIGENS_COM_FICHA de propósito),
 * então o envio é feito aqui. "Nunca duas": a reserva `ficha_helena:<id do card>` é um insert, e quem perde a corrida
 * (23505) não manda. A ficha fica na sessão (`dados` e `resumo`) e numa linha do historico do card (feita em `agendar`).
 */
async function enviarFichaAoConsultor(s: SessaoInvestidor, cardId: number, iso: string): Promise<boolean> {
  const em = new Date().toISOString();
  const { error } = await supabase.from('system_state').insert({ key: `${FICHA_HELENA_PREFIX}${cardId}`, value: { em }, updated_at: em });
  if (error) {
    if (String((error as { code?: string }).code) !== '23505') logger.error(LOG, `reservar a ficha do card ${cardId} falhou: nada sai`, error);
    return false;
  }
  const texto = montarFichaConsultor({
    nome: s.nome, telefone: s.telefone, tipo: tipoDaSessao(s.tipo), retorno: s.retorno,
    consultor: primeiroNomeDoConsultor(s.consultor), quando: iso, dados: s.dados, resumo: s.resumo,
  }).slice(0, TETO_DA_FICHA);
  try {
    await sendWhatsApp(await celularDoConsultor(s.consultor), texto, 'io');
    // Entra na conta da linha como o `ficha_lead:` das agentes da 5040 (PREFIXOS_RESPOSTA_AGENTES): o teto de emergência a enxerga.
    await registrarFichaNaLinha(cardId);
    return true;
  } catch (e) {
    logger.error(LOG, `a ficha do card ${cardId} não saiu`, { erro: String(e).slice(0, 200) });
    return false;
  }
}

/**
 * Grava o horário escolhido. Com card parado, REMARCA o mesmo card (investidorAgenteCard.ts): nada de card em
 * duplicidade. Sem card de eletroposto, cria um novo, como sempre. Horário tomado no meio do caminho vira lista nova.
 */
async function agendar(s: SessaoInvestidor, ctx: Contexto, iso: string): Promise<void> {
  const muitoPerto = new Date(iso).getTime() < Date.now() + 30 * 60_000;
  // AGENDA FECHADA: a mesma última porta do POST /agendar da LP. Entre oferecer e
  // a pessoa responder passam horas, e nesse meio-tempo o dia pode ter sido
  // fechado (sócios fora). Dia fechado é tratado como horário ocupado.
  if (muitoPerto || agendaFechadaNoIso(iso) || !(await aindaLivre(iso, s.consultor))) {
    await oferecerHorarios(s, ctx, { foiOcupado: true });
    return;
  }
  const tipo = tipoDaSessao(s.tipo);
  const tipoDoCard = TIPO_DO_CARD_POR_TIPO[tipo];
  let cardId: number | null;
  if (s.card_id) {
    const r = await remarcarCardDaHelena({
      id: s.card_id, iso, agora: new Date(), tipoDoCard,
      linhasDoHistorico: [`Reunião marcada pela Helena no WhatsApp: ${horarioCurto(iso)}`, linhaDaFichaNoHistorico(s.dados, s.resumo)],
    });
    if (!r.ok) {
      if (r.motivo === 'horario_ocupado') { await oferecerHorarios(s, ctx, { foiOcupado: true }); return; }
      await passarParaHumano(s, ctx, r.motivo === 'card_mudou' ? 'card_mudou' : 'erro_gravar_card',
        r.motivo === 'card_mudou' ? 'ESCOLHEU HORÁRIO E O CARD DELA MUDOU' : 'ESCOLHEU HORÁRIO E O CARD NÃO GRAVOU', {
          falarComOCliente: true, extra: `*Horário escolhido:* ${horarioCurto(iso)}. Marque à mão.`,
        });
      return;
    }
    cardId = s.card_id;
  } else {
    const ficha: Record<string, unknown> = {
      vendedor_nome: s.consultor,
      quando: iso,
      cliente_nome: (s.nome || 'Cliente sem nome').slice(0, 120),
      cliente_telefone: s.telefone,
      cidade: (s.dados?.cidade || s.cidade || '').trim().slice(0, 120) || null,
      status: 'agendado',
      temperatura: 'morno',
      observacao: montarObservacao({
        valorTxt: s.valor_txt, dados: s.dados ?? {}, cidadeDoCadastro: s.cidade,
        origem: s.origem, tipo, id: s.id, cadastroEm: s.cadastro_em, resumo: s.resumo,
      }),
      // Origem própria. Os eventos do Meta (Schedule, LeadQuente) moram na rota da
      // LP e não saem daqui: reunião marcada por robô não é conversão de anúncio.
      created_by: ORIGEM_AGENTE_EP,
      src: null,
    };
    let gravado: { id: number | null; bloqueado: boolean };
    try {
      gravado = await gravarCardEletroposto(ficha);
    } catch (err) {
      // 23505 = o índice de horário: alguém marcou aquele horário neste intervalo.
      if (String((err as { code?: string })?.code) === '23505') {
        await oferecerHorarios(s, ctx, { foiOcupado: true });
        return;
      }
      logger.error(LOG, 'gravar o card falhou', err);
      await passarParaHumano(s, ctx, 'erro_gravar_card', 'ESCOLHEU HORÁRIO E O CARD NÃO GRAVOU', {
        falarComOCliente: true, extra: `*Horário escolhido:* ${horarioCurto(iso)}. Marque à mão.`,
      });
      return;
    }
    if (gravado.bloqueado) {
      // FORA DO PADRÃO: nenhuma ficha nasce para este telefone, e ninguém escreve.
      await gravarSessao(ctx.chave, { ...s, estagio: 'sem_interesse', motivo: 'fora_do_padrao', ate: ctx.ultima });
      return;
    }
    // O tipo fica guardado (`tipo_card:<id>`) para a agenda continuar dizendo COTISTA, ARRENDAMENTO ou INTEGRADOR
    // depois que o consultor mover o card de status. Nunca lança: o card já está gravado.
    await guardarTipoDoCard(gravado.id, tipoDoCard, 'helena');
    cardId = gravado.id;
  }
  const confirmacao = textoConfirmacao(ctx.chave, iso, s.consultor);
  const agoraMs = Date.now();
  const nowIso = new Date(agoraMs).toISOString();
  const base: SessaoInvestidor = {
    ...s, estagio: 'agendado', agendamento_id: cardId, motivo: null, oferta: [], ate: ctx.ultima,
    respostas: (s.respostas ?? 0) + 1,
  };
  // PREPARO DEPOIS DE MARCAR: a confirmação termina com a primeira pergunta de preparo (o modelo escreve, com a seção
  // DEPOIS DE MARCAR). Modelo falhou ou foi barrado, ou a reunião está perto demais: a confirmação sai sem pergunta e a
  // ficha ao consultor sai na hora, como antes.
  const ate = cardId ? limiteDoPreparo(iso, agoraMs) : null;
  const primeira = ate ? await primeiraPerguntaDePreparo(base, ctx, iso, confirmacao) : null;
  const sessaoFinal: SessaoInvestidor = primeira && ate
    ? { ...base, dados: juntarDados(base.dados, primeira.dados), resumo: primeira.resumo || base.resumo,
        preparo: { inicio_em: nowIso, reuniao_em: iso, ate_em: ate, perguntas: 1, pergunta_em: nowIso } }
    : base;
  await gravarSessao(ctx.chave, sessaoFinal);
  await marcarCadastro(s, 'conectado');
  ctx.res.agendadas++;
  logger.info(LOG, `reunião marcada (card ${cardId}${s.card_id ? ', remarcado' : ', novo'}, ${s.consultor}, ${horarioCurto(iso)}${primeira ? ', com preparo' : ''})`);
  let saiu = false;
  try {
    await falarComOCliente(s, ctx, primeira ? [confirmacao, primeira.pergunta] : [confirmacao]);
    ctx.res.respondidas++;
    saiu = true;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'a confirmação não saiu (o card está gravado)', { card: cardId, erro: String(e) });
  }
  // O aviso curto ao consultor (1 bolha, link dentro) sai agora, SÓ com o preparo em andamento: a trava, o carimbo e as
  // conferências da linha moram em investidorAgenteAvisos.ts. Nunca lança.
  if (cardId) {
    await avisarMarcacao({
      comPreparo: !!(primeira && saiu), cardId, iso, consultor: s.consultor, nome: s.nome, tipo,
      cidade: s.dados?.cidade || s.cidade, dados: sessaoFinal.dados,
    });
  }
  // Com preparo em andamento a ficha espera o fim dele. Sem preparo (ou se a mensagem não saiu), sai agora.
  if (primeira && saiu) return;
  const semBloco = primeira ? await fecharPreparoNaSessao(sessaoFinal, ctx.chave, 'envio_falhou') : sessaoFinal;
  if (cardId) await enviarFichaDoPreparo(semBloco, ctx.chave, iso);
}

// ═════════════════════════════════════════════════════════════════════════════
// PREPARO DEPOIS DE MARCAR (12/11/2026, rodada 2 da avaliação)
//
// Reunião marcada e confirmação enviada: a Helena ainda faz até 2 perguntas de preparo para o consultor (a primeira
// vai no fim da confirmação). A sessão fica `agendado` com `preparo` (ver investidorAgentePosse.ts): enquanto ele vale,
// a conversa é dela. A resposta da pessoa segue as mesmas regras de envio de qualquer resposta (até 15 min, 7h às 20h,
// registro `inv_agente_env:`, tetos 60/h e 450/24h; atrasada vira frio de 1 bolha), porque passa pelo mesmo laço.
//
// ACABA: na 2ª resposta dela (agradecimento), quando o modelo agradece em vez de perguntar, 30 min depois da última
// pergunta sem resposta, 24h depois de marcar, 3h antes da reunião. Acaba CALADO (sem mensagem e SEM ficha) quando o card
// muda (remarcado, cancelado, status de negócio) ou entra humano. A ficha ao consultor sai UMA vez, no fim do preparo
// (a reserva `ficha_helena:<card>` garante "nunca duas"); reunião a menos de 3h nem começa preparo, e a ficha sai na hora.
// ═════════════════════════════════════════════════════════════════════════════

const PREPARO_DURA_MS = 24 * 3600_000;
const PREPARO_FIM_ANTES_DA_REUNIAO_MS = 3 * 3600_000;
const PREPARO_DURACAO_MINIMA_MS = 30 * 60_000;
const PREPARO_SEM_RESPOSTA_MS = 30 * 60_000;
export const PREPARO_MAX_PERGUNTAS = 2;

/** Até quando o preparo vale (ISO), ou `null` quando não compensa começar (reunião perto demais). */
export function limiteDoPreparo(iso: string, agoraMs: number): string | null {
  const reuniao = Date.parse(iso);
  if (!Number.isFinite(reuniao)) return null;
  const ate = Math.min(agoraMs + PREPARO_DURA_MS, reuniao - PREPARO_FIM_ANTES_DA_REUNIAO_MS);
  return ate - agoraMs >= PREPARO_DURACAO_MINIMA_MS ? new Date(ate).toISOString() : null;
}

const terminaEmPergunta = (b: string): boolean => /\?\s*$/.test(b.trim());

/** Chama o modelo no modo preparo (a mesma trava de conteúdo e uma reescrita, como em toda resposta). */
async function pensarNoPreparo(
  s: SessaoInvestidor, historico: readonly MsgDaConversa[], novas: readonly MsgDaConversa[], preparo: NonNullable<ContextoHelena['preparo']>,
): Promise<{ saida: SaidaHelena; violacao: string | null }> {
  const ctxH: ContextoHelena = {
    nome: s.nome, valorTxt: s.valor_txt, cidade: s.cidade, consultor: s.consultor,
    tipo: tipoDaSessao(s.tipo), retorno: !!s.retorno, cardAntigo: s.card_antigo ?? null, nota: s.nota ?? null,
    cadastroEm: s.cadastro_em, fatosDoCard: s.fatos_do_card,
    oferta: [], dados: s.dados ?? {}, formulario: await lerFormulario(s), agora: new Date(), preparo,
  };
  const p = await pensar(montarSistema(ctxH), montarPedido(historico, novas), valoresLiberados(ctxH, historico, novas));
  return { saida: p.saida, violacao: p.violacao };
}

/** A primeira pergunta de preparo (a que termina a confirmação), ou `null` se o modelo falhou, foi barrado ou não perguntou. */
async function primeiraPerguntaDePreparo(
  s: SessaoInvestidor, ctx: Contexto, iso: string, confirmacao: string,
): Promise<{ pergunta: string; dados: DadosDaConversa; resumo: string } | null> {
  try {
    const { saida, violacao } = await pensarNoPreparo(s, ctx.historico, ctx.novas, { feitas: 0, quando: iso, encerrar: false, confirmacao });
    if (!saida.valido || violacao || saida.acao !== 'continuar') return null;
    const pergunta = saida.bolhas[saida.bolhas.length - 1];
    // Pergunta de verdade, e nunca sobre outro horário (o horário já está marcado).
    if (!pergunta || !terminaEmPergunta(pergunta) || /\bhor[aá]rios?\b/i.test(pergunta)) return null;
    return { pergunta, dados: saida.dados, resumo: saida.resumo };
  } catch (err) {
    logger.error(LOG, 'a pergunta de preparo falhou: a confirmação sai sem ela', err);
    return null;
  }
}

/** A sessão sem o bloco de preparo, com o motivo do fim. Sessão que não tem preparo volta como está. */
function semPreparo(s: SessaoInvestidor, motivo: string): SessaoInvestidor {
  if (!s.preparo) return s;
  const { preparo: _fim, ...resto } = s;
  return { ...resto, preparo_fim: { em: new Date().toISOString(), motivo } };
}

/** Estado primeiro: grava o fim do preparo. Devolve a sessão como ficou. */
async function fecharPreparoNaSessao(s: SessaoInvestidor, chave: string, motivo: string, extra: Partial<SessaoInvestidor> = {}): Promise<SessaoInvestidor> {
  const nova = { ...semPreparo(s, motivo), ...extra };
  // Acabado o preparo, a sessão deixa de ser da Helena e o robô de respostas da agenda volta a ler a conversa: sem o
  // marcador `ep_resposta:<card>` ele trataria as respostas do preparo (que a Helena já leu e respondeu) como novas e
  // mandaria recado à equipe. O marcador vai ANTES de a sessão soltar a pessoa, e só se ela escreveu DURANTE o preparo
  // (o marcador também vale como "a pessoa respondeu" para outras réguas: não pode nascer sem resposta).
  const lidaAte = String(nova.ate ?? '');
  if (s.preparo && s.agendamento_id && Date.parse(lidaAte) > Date.parse(s.preparo.inicio_em)) {
    await marcarLevaLidaParaAAgenda(s.agendamento_id, lidaAte);
  }
  await gravarSessao(chave, nova);
  return nova;
}

/**
 * A ficha ao consultor, UMA só por agendamento (a reserva `ficha_helena:<card>` e `ficha_enviada_em`). ANTES de enviar
 * confere os tetos de emergência da linha (60/h e 450/24 h, a mesma conta das respostas): linha cheia ou ilegível não
 * manda, e a ficha fica PENDENTE na sessão (`ficha_pendente`) para uma rodada seguinte do fecho dos preparos.
 * Devolve 'enviada', 'adiada' (esperou a linha) ou 'nada' (já tinha saído, falhou ou não há card).
 */
async function enviarFichaDoPreparo(s: SessaoInvestidor, chave: string, iso: string): Promise<'enviada' | 'adiada' | 'nada'> {
  if (!s.agendamento_id || s.ficha_enviada_em) return 'nada';
  const linha = await conferirLinhaParaResposta(chave);
  if (!linha.ok) {
    logger.warn(LOG, `a ficha do card ${s.agendamento_id} espera a linha (${linha.motivo}): fica para uma rodada seguinte`);
    await gravarSessao(chave, { ...s, ficha_pendente: iso })
      .catch(e => logger.error(LOG, 'anotar a ficha pendente na sessão falhou', e));
    return 'adiada';
  }
  if (await enviarFichaAoConsultor(s, s.agendamento_id, iso)) {
    const { ficha_pendente: _p, ...resto } = s;
    await gravarSessao(chave, { ...resto, ficha_enviada_em: new Date().toISOString() })
      .catch(e => logger.error(LOG, 'anotar a ficha enviada na sessão falhou', e));
    return 'enviada';
  }
  return 'nada';
}

/**
 * Antes de a Helena PASSAR a conversa do preparo para o consultor, avisa o robô de respostas da agenda de que esta
 * leva já foi lida: o marcador `ep_resposta:<card>` (a mesma chave dele, `ate` = a última mensagem lida) faz o robô
 * da agenda ignorar tudo até ali. Sem isso, a sessão em `humano` deixa de ser da Helena e o robô da agenda
 * (o card tem origem `agente_eletroposto`) respondia a MESMA mensagem logo depois. Devolve `false` se não gravou.
 */
async function marcarLevaLidaParaAAgenda(cardId: number, ate: string): Promise<boolean> {
  const em = new Date().toISOString();
  try {
    const { error } = await supabase.from('system_state')
      .upsert({ key: `${EP_RESPOSTA_PREFIXO}${cardId}`, value: { ate, avisado_em: em, por: 'helena' }, updated_at: em }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    logger.error(LOG, `marcar a leva como lida para a agenda falhou (card ${cardId}): a passagem sai sem mensagem para a pessoa`, e);
    return false;
  }
}

/** Grava `lead_resposta_at` no card (a hora da última mensagem da pessoa). Erro só vai para o log: a próxima leitura repete. */
async function gravarRespostaNoCard(cardId: number, momment: string): Promise<void> {
  const quando = Number.isFinite(Date.parse(momment)) ? new Date(momment).toISOString() : new Date().toISOString();
  try {
    const { error } = await supabaseGerador.from('agendamentos').update({ lead_resposta_at: quando }).eq('id', cardId);
    if (error) throw new Error(error.message);
  } catch (e) {
    logger.error(LOG, `gravar lead_resposta_at no card ${cardId} falhou`, e);
  }
}

/** A pessoa respondeu no preparo: uma pergunta a mais, ou o agradecimento que encerra. Nunca mais de 2 perguntas. */
async function atenderPreparo(s: SessaoInvestidor, ctx: Contexto, desligada: boolean): Promise<void> {
  const p = s.preparo!;
  const textos = ctx.novas.map(m => String(m.texto || '').trim()).filter(Boolean);
  const terminar = async (motivo: string, extra: Partial<SessaoInvestidor> = {}): Promise<void> => {
    const nova = await fecharPreparoNaSessao(s, ctx.chave, motivo, { ate: ctx.ultima, ...extra });
    await enviarFichaDoPreparo(nova, ctx.chave, p.reuniao_em);
  };
  // Mensagem velha demais com a política `consultor`, ou agente desligada: o preparo acaba calado, e a ficha sai.
  if (Date.now() - Date.parse(ctx.ultima) > RESPOSTA_VIVA_MS && !ctx.frio) { await terminar('resposta_atrasada'); return; }
  if (desligada) { await terminar('agente_desligada'); return; }
  // Pedido de parar: grava o opt-out e encerra calado.
  if (pediuParar(textos)) { await parar(semPreparo(s, 'pediu_parar'), ctx, { semMensagem: true }); return; }
  if (ctx.novas.some(m => ehAudioSemTexto(m))) ctx.novas = await comTranscricoes(ctx.novas);

  const encerrar = p.perguntas >= PREPARO_MAX_PERGUNTAS;
  const { saida, violacao } = await pensarNoPreparo(s, ctx.historico, ctx.novas, { feitas: p.perguntas, quando: p.reuniao_em, encerrar });
  if (!saida.valido || violacao) {
    if (!saida.valido) ctx.res.erros++;
    await terminar(saida.valido ? 'resposta_barrada' : 'ia_falhou');
    return;
  }
  const s2: SessaoInvestidor = { ...s, dados: juntarDados(s.dados, saida.dados), resumo: saida.resumo || s.resumo, respostas: (s.respostas ?? 0) + 1 };
  if (saida.acao === 'humano' || saida.acao === 'agendar' || saida.acao === 'oferecer_horarios') {
    // Só UM responde esta mensagem: a Helena (passagem + aviso à equipe). O robô da agenda a pula pelo marcador;
    // se o marcador não gravou, a Helena fica calada para a pessoa (o aviso à equipe sai) e a agenda responde.
    const agendaPula = s.agendamento_id ? await marcarLevaLidaParaAAgenda(s.agendamento_id, ctx.ultima) : true;
    await passarParaHumano(semPreparo(s2, 'pediu_humano'), ctx, 'pediu_humano', 'QUER FALAR COM VOCÊ', { falarComOCliente: agendaPula });
    return;
  }
  if (saida.acao === 'parar') { await parar(semPreparo(s2, 'pediu_parar'), ctx, { semMensagem: true }); return; }
  if (saida.acao !== 'continuar' || !saida.bolhas.length) {
    // adiar, sem_interesse ou nada a dizer: o preparo acaba calado e a ficha sai.
    const nova = await fecharPreparoNaSessao(s2, ctx.chave, saida.acao === 'continuar' ? 'sem_o_que_dizer' : saida.acao, { ate: ctx.ultima });
    await enviarFichaDoPreparo(nova, ctx.chave, p.reuniao_em);
    return;
  }
  const ultimaBolha = saida.bolhas[saida.bolhas.length - 1]!;
  const eraPergunta = terminaEmPergunta(ultimaBolha) && !/\bhor[aá]rios?\b/i.test(ultimaBolha);
  if (!encerrar && eraPergunta) {
    await gravarSessao(ctx.chave, { ...s2, ate: ctx.ultima, preparo: { ...p, perguntas: p.perguntas + 1, pergunta_em: new Date().toISOString() } });
    try {
      await falarComOCliente(s2, ctx, [ultimaBolha]);
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'a pergunta de preparo não saiu', { erro: String(e) });
    }
    return;
  }
  // Fim do preparo: agradecimento. O modelo que insistiu em perguntar depois da 2ª pergunta leva o texto fixo.
  const texto = eraPergunta ? textoEncerramentoPreparo(ctx.chave, primeiroNomeDoConsultor(s.consultor), p.reuniao_em) : ultimaBolha;
  const nova = await fecharPreparoNaSessao(s2, ctx.chave, 'concluido', { ate: ctx.ultima });
  try {
    await falarComOCliente(s, ctx, [texto]);
    ctx.res.respondidas++;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'o agradecimento do preparo não saiu', { erro: String(e) });
  }
  await enviarFichaDoPreparo(nova, ctx.chave, p.reuniao_em);
}

/**
 * O fecho dos preparos por tempo e por mudança do mundo, a cada rodada: 24h/3h (`ate_em`), 30 min sem resposta (só se ela
 * não escreveu nada que a rodada de respostas ainda não leu), card mudado ou humano na conversa (calado, sem ficha).
 * Nunca envia mensagem à pessoa. Erro de leitura deixa o preparo para a próxima rodada.
 */
export async function fecharPreparos(agora: number = Date.now()): Promise<{ fechados: number; fichas: number; erros: number; motivo?: string }> {
  let sessoes: Map<string, SessaoInvestidor>;
  try {
    sessoes = await lerSessoes();
  } catch (err) {
    logger.error(LOG, 'fecho dos preparos: ler as sessões falhou', err);
    return { fechados: 0, fichas: 0, erros: 1, motivo: 'erro_sessoes' };
  }
  const vivos = [...sessoes.entries()].filter(([, s]) => s.estagio === 'agendado' && !!s.preparo && !!s.telefone).slice(0, 20);
  let fechados = 0, fichas = 0, erros = 0;
  // No máximo UMA ficha ao consultor por rodada (a linha não leva 20 mensagens coladas). As que não couberem ficam
  // `ficha_pendente` na sessão e saem, uma por rodada, na ordem.
  let fichaNestaRodada = false;
  for (const [chave, s] of vivos) {
    try {
      const p = s.preparo!;
      let motivo: string | null = null;
      let ficha = true;
      // O mundo mudou? Card remarcado, cancelado ou com status de negócio, ou humano na conversa: acaba calado, sem ficha.
      const { data, error } = await supabaseGerador.from('agendamentos').select('id, status, quando').eq('id', s.agendamento_id ?? -1).maybeSingle();
      if (error) throw new Error(`ler o card do preparo: ${error.message}`);
      const card = data as { status: string | null; quando: string | null } | null;
      if (!card || String(card.status ?? '').trim().toLowerCase() !== 'agendado' || Date.parse(String(card.quando ?? '')) !== Date.parse(p.reuniao_em)) {
        motivo = 'card_mudou'; ficha = false;
      } else if (!(await podeFalarComLead(s.telefone)).pode) {
        motivo = 'humano_na_conversa'; ficha = false;
      } else if (agora >= Date.parse(p.ate_em)) {
        motivo = 'tempo';
      } else if (agora - Date.parse(p.pergunta_em) >= PREPARO_SEM_RESPOSTA_MS && !(await escreveuDepoisDe(s.telefone, p.pergunta_em))) {
        motivo = 'sem_resposta';
      }
      if (!motivo) continue;
      const nova = await fecharPreparoNaSessao(s, chave, motivo);
      fechados++;
      if (ficha && !nova.ficha_enviada_em) {
        if (fichaNestaRodada) {
          await gravarSessao(chave, { ...nova, ficha_pendente: p.reuniao_em });
        } else {
          const r = await enviarFichaDoPreparo(nova, chave, p.reuniao_em);
          if (r !== 'nada') fichaNestaRodada = true;
          if (r === 'enviada') fichas++;
        }
      }
    } catch (err) {
      erros++;
      logger.error(LOG, `fecho do preparo falhou (final ${s.telefone.slice(-2)})`, err);
    }
  }
  // A fila das fichas que esperaram: a mais antiga primeiro, só se esta rodada ainda não mandou nenhuma.
  if (!fichaNestaRodada) {
    const pendentes = [...sessoes.entries()]
      .filter(([, s]) => s.estagio === 'agendado' && !s.preparo && !!s.ficha_pendente && !s.ficha_enviada_em && !!s.agendamento_id && !!s.telefone)
      .sort((a, b) => String(a[1].atualizado_em ?? '').localeCompare(String(b[1].atualizado_em ?? '')));
    // A pendência pode ter ficado velha: antes de enviar, o card é lido de novo. Cancelado, sumido ou com outro dono:
    // não envia e apaga a pendência (a sessão fica como está, sem `ficha_pendente`). Erro de leitura deixa para a próxima.
    for (const [chave, s] of pendentes) {
      try {
        const { data, error } = await supabaseGerador.from('agendamentos').select('id, status, vendedor_nome').eq('id', s.agendamento_id ?? -1).maybeSingle();
        if (error) throw new Error(`ler o card da ficha pendente: ${error.message}`);
        const card = data as { status: string | null; vendedor_nome: string | null } | null;
        const mudouDeDono = !!card && primeiroNomeDoConsultor(String(card.vendedor_nome ?? '')) !== primeiroNomeDoConsultor(s.consultor);
        if (!card || String(card.status ?? '').trim().toLowerCase() === 'cancelado' || mudouDeDono) {
          logger.info(LOG, `ficha pendente do card ${s.agendamento_id} descartada (${!card ? 'card sumiu' : mudouDeDono ? 'mudou de dono' : 'cancelado'})`);
          const { ficha_pendente: _p, ...resto } = s;
          await gravarSessao(chave, resto);
          continue;
        }
        const r = await enviarFichaDoPreparo(s, chave, s.ficha_pendente!);
        if (r === 'enviada') fichas++;
        if (r !== 'nada') break;
      } catch (err) {
        erros++;
        logger.error(LOG, `ficha pendente falhou (final ${s.telefone.slice(-2)})`, err);
        break;
      }
    }
  }
  if (fechados) logger.info(LOG, `${fechados} preparo(s) encerrado(s), ${fichas} ficha(s) ao consultor`);
  return { fechados, fichas, erros };
}

/** Uma conversa, com a vez já reivindicada. */
async function atender(
  s0: SessaoInvestidor, ctx: Contexto, desligada: boolean,
  /** `recuperacao`: reprocessamento de uma escolha pendente (ver recuperarEscolhasPendentes). */
  opts: { recuperacao?: boolean } = {},
): Promise<void> {
  let s = s0;
  // Reunião marcada com o preparo em andamento: conversa própria (ver atenderPreparo).
  if (s.estagio === 'agendado' && s.preparo) { await atenderPreparo(s, ctx, desligada); return; }
  const textos = ctx.novas.map(m => String(m.texto || '').trim()).filter(Boolean);

  // Primeira resposta da pessoa: o cadastro passa para "falando".
  if (s.estagio === 'chamado') {
    await marcarCadastro(s, 'falando');
    s = { ...s, estagio: 'conversando' };
  }
  // Quem tinha adiado e voltou a escrever: a conversa segue normalmente.
  if (s.estagio === 'adiado') s = { ...s, estagio: 'conversando' };

  // Resposta velha demais (o relógio falhou por mais de uma hora), agente
  // desligada ou conversa longa demais: ninguém responde por robô, vai para gente.
  //
  // EXCEÇÃO da recuperação (12/10/2026): a mensagem antiga de quem escolheu um
  // horário ainda pode virar reunião. Ela passa por aqui, e só o resultado
  // `agendar` válido escapa do recado; todo o resto cai no mesmo tratamento de
  // mensagem antiga, mais abaixo.
  const velha = Date.now() - Date.parse(ctx.ultima) > RESPOSTA_VIVA_MS;
  // Mensagem com mais de 15 min: com a política `frio` (a vigente) a conversa SEGUE com a Helena, como frio
  // (`ctx.frio`, ver `destinoDaRespostaAtrasada`); só com a política `consultor` ela passa para a pessoa.
  if (velha && !opts.recuperacao && !ctx.frio) {
    await passarParaHumano(s, ctx, 'resposta_atrasada', 'RESPONDEU E FICOU SEM RESPOSTA', { falarComOCliente: false });
    return;
  }
  if (desligada) {
    await passarParaHumano(s, ctx, 'agente_desligada', 'RESPONDEU COM A AGENTE DESLIGADA', { falarComOCliente: false });
    return;
  }
  if ((s.respostas ?? 0) >= MAX_RESPOSTAS) {
    await passarParaHumano(s, ctx, 'conversa_longa', 'CONVERSA LONGA, PRECISA DE VOCÊ', { falarComOCliente: true });
    return;
  }

  // Pedido de parada escrito com todas as letras ("pare", "me tira da lista") não
  // depende da IA: se ela estiver fora do ar, o opt-out sai do mesmo jeito.
  if (pediuParar(textos)) {
    await parar(s, ctx);
    return;
  }

  // Áudio (13/10/2026): transcrito AGORA, depois dos portões que não usam o modelo e antes
  // do número solto. Leva com áudio transcrito sempre vai ao modelo, que tem a ação
  // `agendar` com `opcao`: o número solto vale só para mensagem DIGITADA.
  if (ctx.novas.some(m => ehAudioSemTexto(m))) ctx.novas = await comTranscricoes(ctx.novas);
  const comAudioTranscrito = ctx.novas.some(m => !!m.transcricao);

  // Escolheu um dos 4 horários: agenda direto, sem IA. SÓ o número solto vale
  // ("2", " 2 ", "2.", "opção 2"). Quem CITA o horário pode estar recusando
  // ("10h não consigo, tem outro?"), e isso é conversa para a IA, que pode pedir
  // outra lista. Bloqueante da revisão de 11/10/2026: recusa virava reunião.
  if (s.estagio === 'ofertou' && s.oferta?.length && !comAudioTranscrito) {
    const idx = escolhaPorNumero(textos, s.oferta.length);
    if (idx !== null && idx >= 0) {
      await agendar(s, ctx, s.oferta[idx]!);
      return;
    }
    if (idx === -1) {
      // Número solto que não está na lista ("7"): pede o número de 1 a 4.
      await gravarSessao(ctx.chave, { ...s, ate: ctx.ultima, respostas: (s.respostas ?? 0) + 1 });
      try {
        await falarComOCliente(s, ctx, [textoNaoEntendi(ctx.chave)]);
        ctx.res.respondidas++;
      } catch (e) {
        ctx.res.erros++;
        logger.error(LOG, 'pedido do número não saiu', { erro: String(e) });
      }
      return;
    }
    // Qualquer outra coisa (pergunta, "nenhum serve") segue para a IA, que sabe
    // que a lista está em aberto.
  }

  // A conversa: as últimas 20 mensagens da linha com esta pessoa, já lidas e
  // conferidas pela chave exata antes de a vez ser gasta (ver lerHistorico).
  const historico = [...ctx.historico];
  // A abertura tem que estar na conversa que a IA lê. Se o registro da linha
  // ainda não trouxe nenhuma fala nossa desde a abertura (ele atrasa), ela entra
  // aqui, do jeito que foi enviada e no lugar dela. Abertura cujo envio FALHOU
  // nunca entra: a IA não pode achar que disse o que não saiu.
  const desdeAAbertura = new Date(Date.parse(s.aberto_em) - 2 * 60_000).toISOString();
  if (!s.erro && !historico.some(m => m.from_me && m.momment >= desdeAAbertura)) {
    // Sessão antiga (sem `tipo`) abriu com um texto de outubro que já não existe: a conversa da linha o traz.
    const texto = s.grupo === 'resgate'
      ? textoDaAberturaResgate(s.abertura, s.nome, s.valor_txt, s.reuniao_perdida_em)
      : s.tipo ? textoDaAbertura(s.abertura, s.nome, s.valor_txt, { tipo: s.tipo, cidade: s.cidade, retorno: s.retorno }) : '';
    if (texto) historico.push({ from_me: true, tipo: 'texto', momment: s.aberto_em, texto });
    historico.sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0));
  }

  const formulario = await lerFormulario(s);
  const ctxHelena: ContextoHelena = {
    nome: s.nome, valorTxt: s.valor_txt, cidade: s.cidade, consultor: s.consultor,
    tipo: tipoDaSessao(s.tipo), retorno: !!s.retorno, cardAntigo: s.card_antigo ?? null, nota: s.nota ?? null,
    cadastroEm: s.cadastro_em, fatosDoCard: s.fatos_do_card,
    oferta: s.estagio === 'ofertou' ? s.oferta : [], dados: s.dados ?? {},
    // O que ela já respondeu no formulário e que dia é hoje: contexto que a IA
    // precisa para não perguntar de novo e para entender "amanhã de manhã".
    formulario, agora: new Date(),
    // Conversa de resgate: os fatos ganham o parágrafo "CONVERSA DE RESGATE".
    ...(s.grupo === 'resgate' ? { resgateEm: s.reuniao_perdida_em ?? null } : {}),
  };
  const sistema = montarSistema(ctxHelena);
  const pedido = montarPedido(historico, ctx.novas);
  // Os valores em reais que a PESSOA disse (formulário e conversa): são os únicos que a
  // trava deixa a Helena repetir. A fala dela mesma não conta.
  const valoresDaPessoa = valoresLiberados(ctxHelena, historico, ctx.novas);
  // O mesmo miolo que a sonda usa (sondarHelena): principal, reserva, leitura da
  // saída e trava de conteúdo com uma reescrita.
  const pensamento = await pensar(sistema, pedido, valoresDaPessoa);
  let saida = pensamento.saida;

  // IA falhou ou devolveu algo fora do combinado: não responde nada ao cliente,
  // avisa o consultor e a sessão vira `humano`.
  if (!saida.valido) {
    ctx.res.erros++;
    await passarParaHumano(s, ctx, 'ia_falhou', 'RESPONDEU E A IA NÃO SOUBE RESPONDER', { falarComOCliente: false });
    return;
  }

  // TRAVA DE CONTEÚDO (dentro do miolo): a resposta foi barrada e a reescrita
  // também. Nada sai para o cliente; a conversa vai para o consultor.
  if (pensamento.violacao) {
    await passarParaHumano(s, ctx, 'resposta_barrada', 'RESPONDEU E A RESPOSTA DA IA FOI BARRADA', {
      falarComOCliente: false, extra: `*Motivo:* ${pensamento.violacao}.`,
    });
    return;
  }
  s = { ...s, dados: juntarDados(s.dados, saida.dados), resumo: saida.resumo || s.resumo };

  // `agendar` (12/10/2026): a pessoa escolheu um horário da lista em palavras. O
  // código valida e grava pelo MESMO caminho do número solto: card, sessão
  // `agendado` e o texto fixo de confirmação, sem as bolhas do modelo.
  if (saida.acao === 'agendar') {
    if (s.estagio === 'ofertou' && s.oferta?.length) {
      const opcao = saida.opcao ?? 0;
      if (Number.isInteger(opcao) && opcao >= 1 && opcao <= s.oferta.length) {
        await agendar(s, ctx, s.oferta[opcao - 1]!);   // horário tomado ou dia fechado: ele mesmo oferece lista nova
      } else {
        logger.warn(LOG, `agendar com opcao ${opcao} fora da lista de ${s.oferta.length}: oferecendo lista nova`);
        await oferecerHorarios(s, ctx);
      }
      return;
    }
    // Sem lista em aberto não há o que agendar: vale como `continuar`. As bolhas
    // não passaram pela trava de conteúdo (ela só olha `continuar`), então passam aqui.
    saida = { ...saida, acao: 'continuar', bolhas: violaRegras(saida.bolhas, valoresDaPessoa) ? [] : saida.bolhas };
  }

  // Recuperação de mensagem antiga: só o `agendar` válido (acima) vira reunião.
  // Qualquer outro resultado é o tratamento que a mensagem antiga já tinha.
  if (opts.recuperacao) {
    // `continuar` SEM bolha: o modelo entendeu que não havia o que responder ("Ok,
    // obrigado", uma resposta automática depois da lista). A sessão segue em
    // `ofertou`, sem recado e sem mensagem; o `recuperado_ate` já está gravado, então
    // esta fala não volta a ser reprocessada, e o "2" que vier depois ainda agenda.
    if (saida.acao === 'continuar' && !saida.bolhas.length) {
      await gravarSessao(ctx.chave, { ...s, ate: ctx.ultima });
      return;
    }
    await passarParaHumano(s, ctx, 'resposta_atrasada', 'RESPONDEU E FICOU SEM RESPOSTA', { falarComOCliente: false });
    return;
  }

  if (saida.acao === 'continuar') {
    // Estado primeiro. Sem bolha (só "ok", "obrigado") ela não responde.
    // Registro do convite (tela de acompanhamento): o modelo marca `convite: true` e o código confere que a bolha
    // pergunta pelos horários. Na dúvida, não marca.
    const convidou = ehConviteDeHorario(saida, saida.bolhas);
    await gravarSessao(ctx.chave, {
      ...s, ate: ctx.ultima, respostas: (s.respostas ?? 0) + (saida.bolhas.length ? 1 : 0),
      ...(convidou ? { convidou_em: new Date().toISOString(), convites: (s.convites ?? 0) + 1 } : {}),
    });
    if (!saida.bolhas.length) return;
    try {
      await falarComOCliente(s, ctx, saida.bolhas);
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'falha ao responder', { erro: String(e) });
    }
    return;
  }

  // Nas quatro ações abaixo sai o texto fixo do redator. As bolhas do modelo são
  // ignoradas, para não sair mensagem dobrada, exceto UMA bolha curta antes da lista de horários e antes da despedida
  // (bolhaAntesDoTextoFixo).
  if (saida.acao === 'oferecer_horarios') {
    await oferecerHorarios(s, ctx, { bolhaDoModelo: bolhaAntesDoTextoFixo(saida.bolhas, valoresDaPessoa) });
    return;
  }
  if (saida.acao === 'humano') {
    await passarParaHumano(s, ctx, 'pediu_humano', 'QUER FALAR COM VOCÊ', { falarComOCliente: true });
    return;
  }
  if (saida.acao === 'adiar') {
    // "Mais para frente eu vejo": NÃO é desinteresse. A sessão vai para `adiado`
    // com o resumo guardado (é nele que a IA anotou quando a pessoa quer ser
    // procurada) e o cadastro fica com o status que tinha.
    // Daqui em diante a Helena não manda nada por conta própria; se a pessoa
    // escrever de novo em até 60 dias, é ela quem responde.
    const adiada: SessaoInvestidor = {
      ...s, estagio: 'adiado', motivo: 'adiou', adiado_em: new Date().toISOString(), ate: ctx.ultima,
      respostas: (s.respostas ?? 0) + 1,
    };
    await gravarSessao(ctx.chave, adiada);
    // A equipe fica sabendo (ressalva da revisão de 11/10/2026): o mesmo recado
    // do `humano`, com o resumo, que traz a data nas palavras da pessoa. Sem isso
    // "mês que vem eu te procuro" ficava guardado onde ninguém olha.
    await avisarEquipe(adiada, 'PEDIU PARA SER PROCURADA DEPOIS', ctx.novas, '', RODAPE_ADIOU)
      .catch(e => logger.error(LOG, 'o recado do adiamento não saiu', e));
    try {
      // A despedida é a bolha curta do modelo (ancorada no combinado), se passar pelo violaRegras; senão, o texto fixo.
      // No caminho frio também é UMA bolha só.
      const dele = bolhaAntesDoTextoFixo(saida.bolhas, valoresDaPessoa);
      await falarComOCliente(s, ctx, [dele ?? textoAdiado(ctx.chave)]);
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'a confirmação do adiamento não saiu', { erro: String(e) });
    }
    return;
  }
  if (saida.acao === 'sem_interesse') {
    await gravarSessao(ctx.chave, { ...s, estagio: 'sem_interesse', motivo: 'disse_nao', ate: ctx.ultima });
    await marcarCadastro(s, 'sem_interesse');
    try {
      // Uma bolha curta do modelo antes da despedida fixa (ex.: a resposta a quem só queria carregar o carro).
      const antes = ctx.frio ? null : bolhaAntesDoTextoFixo(saida.bolhas, valoresDaPessoa);
      await falarComOCliente(s, ctx, antes ? [antes, textoDespedida(ctx.chave)] : [textoDespedida(ctx.chave)]);
      ctx.res.respondidas++;
    } catch (e) {
      ctx.res.erros++;
      logger.error(LOG, 'a despedida não saiu', { erro: String(e) });
    }
    return;
  }
  await parar(s, ctx);
}

/** Pediu para parar: o opt-out da casa (whatsapp_suppression), a sessão fechada
 *  e o carimbo que alimenta o disjuntor do grupo. Só depois a confirmação (que não sai
 *  quando `semMensagem`: pedido de parada de noite ou de mensagem antiga grava o opt-out na hora e fica calado). */
async function parar(s: SessaoInvestidor, ctx: Contexto, opts: { semMensagem?: boolean } = {}): Promise<void> {
  await silenciarContato(s.telefone, 'opt_out', LOG);
  await gravarSessao(ctx.chave, { ...s, estagio: 'sem_interesse', motivo: 'pediu_parar', ate: ctx.ultima });
  const em = new Date().toISOString();
  // O pedido de parada conta no disjuntor do GRUPO da pessoa (Investidor 3 no dia, os outros 2). Parada de sessão
  // de resgate (as que já existem) alimenta SÓ o disjuntor do resgate.
  const chaveDaMarca = s.grupo === 'resgate'
    ? `${INV_PARAR_RESGATE_PREFIX}${dataBrasilia(new Date())}:${ctx.chave}`
    : chaveDaParada(dataBrasilia(new Date()), grupoDaSessao(s), ctx.chave);
  await supabase.from('system_state')
    .upsert({ key: chaveDaMarca, value: { em }, updated_at: em }, { onConflict: 'key' })
    .then(undefined, (e: unknown) => logger.error(LOG, 'carimbo de parada falhou', e));
  if (opts.semMensagem) return;
  try {
    await falarComOCliente(s, ctx, [textoParou(ctx.chave)]);
    ctx.res.respondidas++;
  } catch (e) {
    ctx.res.erros++;
    logger.error(LOG, 'a confirmação de parada não saiu', { erro: String(e) });
  }
}

/**
 * A REGRA DA MENSAGEM COM MAIS DE 15 MIN SEM RESPOSTA (parecer do chefe anti-ban, 12/11/2026). Um lugar só, fácil de trocar.
 *   · `frio` (a vigente, confirmada pelo chefe): NÃO bloqueia. A conversa segue com a Helena, e a resposta sai como FRIO
 *     (1 bolha de até 900 caracteres por sendFrio, registro `inv_agente_frio:`, teto do frio, janela de segunda a sábado
 *     das 9h às 19h59, 10 a 15 min de espaço), com prioridade sobre abertura e retomada, uma por rodada;
 *   · `consultor`: o comportamento de antes, a conversa passa para a pessoa (`resposta_atrasada`).
 * Trocar sem deploy: INVESTIDOR_RESPOSTA_ATRASADA=consultor.
 */
export type DestinoDaAtrasada = 'frio' | 'consultor';
export const destinoDaRespostaAtrasada = (): DestinoDaAtrasada =>
  (process.env.INVESTIDOR_RESPOSTA_ATRASADA || '').trim().toLowerCase() === 'consultor' ? 'consultor' : 'frio';

/** O portão do frio para a resposta atrasada: o disjuntor de erros de envio, a janela da linha (segunda a sábado,
 *  9h às 19h59), o teto do frio e o espaço. Disjuntor aberto, ou que não dá para ler, fecha: a leva espera. */
async function portaoDoFrio(agora: Date): Promise<boolean> {
  if (!janelaAberta(agora)) return false;
  try {
    if ((await lerDisjuntor()).aberto) return false;
    return (await dentroDoTetoHorarioLinha({ robo: 'investidor_agente_abertura' })) && (await respeitaEspacamentoLinha());
  } catch (err) {
    logger.error(LOG, 'portão do frio da resposta atrasada falhou: a leva espera a próxima rodada', err);
    return false;
  }
}

/** A pessoa escreveu DEPOIS da última mensagem desta leva (nos últimos 30 s, que a leitura ainda não pega)? */
async function escreveuDepoisDe(telefone: string, ultima: string): Promise<boolean> {
  const { data, error } = await supabase.from('wa_mensagens').select('momment')
    .eq('from_me', false).eq('is_group', false).eq('instancia', INSTANCE_ID_IO)
    .in('telefone', variantes(telefone)).gt('momment', ultima).limit(1);
  if (error) throw new Error(`reler a conversa: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Quem respondeu à Helena. Roda SEMPRE, com a agente ligada ou não: com ela
 * desligada ninguém recebe resposta de robô, mas a mensagem do investidor vira
 * recado para o consultor em vez de ficar parada.
 */
export async function runInvestidorRespostasTick(): Promise<ResultadoRespostas> {
  const agora = Date.now();
  let sessoes: Map<string, SessaoInvestidor>;
  try {
    sessoes = await lerSessoes();
  } catch (err) {
    logger.error(LOG, 'ler as sessões falhou', err);
    return { ...semResposta('erro_sessoes'), erros: 1 };
  }
  // A mesma régua que os outros robôs leem (sessaoEhDaHelena): abertura que
  // falhou e `chamado` sem resposta há mais de 10 dias já não são dela, e aí
  // quem atende é a recepção. As duas pontas não podem discordar.
  const daHelena = [...sessoes.entries()].filter(([, s]) => sessaoEhDaHelena(s, agora) && s.telefone);
  // AGENTES DA LINHA 5040 (Fase B): conversa que uma agente nova segura não é respondida por esta Helena.
  // Por lead (cedeAAgente lê a posse; sem *_vivo ligado devolve false sem ler nada).
  const cedeu = await Promise.all(daHelena.map(([, s]) => cedeAAgente(s.telefone)));
  const cedidas = new Set(daHelena.filter((_, n) => cedeu[n]).map(([k]) => k));
  const ativas = daHelena.filter(([k]) => !cedidas.has(k));
  if (!ativas.length) return semResposta('sem_conversa_ativa');

  // O que chegou na linha destas pessoas desde o que já foi lido. Filtrado por
  // telefone no servidor e paginado: consulta crescente truncada só vê o passado.
  const piso = ativas.map(([, s]) => s.ate || s.aberto_em).sort()[0]!;
  const teto = new Date(agora - ESPERA_MS).toISOString();
  const fones = [...new Set(ativas.flatMap(([, s]) => variantes(s.telefone)))];
  const entrada: Array<MsgDaConversa & { telefone: string }> = [];
  try {
    for (let i = 0; i < fones.length; i += 120) {
      const lote = fones.slice(i, i + 120);
      entrada.push(...await lerTudo<MsgDaConversa & { telefone: string }>('respostas na linha', (de, ate) =>
        supabase.from('wa_mensagens').select('id, telefone, texto, tipo, momment, from_me, media_url')
          .eq('from_me', false).eq('is_group', false).eq('instancia', INSTANCE_ID_IO)
          .in('telefone', lote).gte('momment', piso).lte('momment', teto)
          .order('momment', { ascending: true }).range(de, ate)));
    }
  } catch (err) {
    logger.error(LOG, 'ler a linha falhou', err);
    return { ...semResposta('erro_linha'), erros: 1 };
  }

  const novasDe = new Map<string, MsgDaConversa[]>();
  for (const m of entrada.sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0))) {
    const k = chaveContato(m.telefone);
    const s = k ? sessoes.get(k) : undefined;
    if (!k || !s || !sessaoEhDaHelena(s, agora) || cedidas.has(k)) continue;
    if (m.momment <= (s.ate || s.aberto_em)) continue;
    if (!novasDe.has(k)) novasDe.set(k, []);
    novasDe.get(k)!.push(m);
  }
  if (!novasDe.size) return semResposta('ninguem_escreveu');

  let silenciado: (tel: string) => boolean;
  let fracos: Set<string>;
  let chaveOff: EstadoDesligar;
  try {
    [silenciado, fracos, chaveOff] = await Promise.all([carregarSilenciados(), lerSilenciadosFracos(), lerChaveDesligar()]);
  } catch (err) {
    logger.error(LOG, 'ler o opt-out falhou: nada é respondido nesta rodada', err);
    return { ...semResposta('erro_supressao'), erros: 1 };
  }
  // `nunca_respondeu` é regra de toque proativo e não vale para RESPOSTA: quem a Helena chamou, ficou calada e agora
  // escreve é atendida. Só o pedido de parada de verdade (opt-out, denúncia) fecha a conversa.
  const pediuPararDeVerdade = (tel: string): boolean => silenciado(tel) && !fracos.has(chaveContato(tel) ?? '');
  const res = semResposta();
  let feitas = 0;
  let frioFeitos = 0;
  let linhaCaiu = false;
  const agoraDate = new Date(agora);
  const dentroDaJanelaDeResposta = janelaDeResposta(agoraDate);
  const destinoAtrasada = destinoDaRespostaAtrasada();

  for (const [chave, todas] of novasDe) {
    if (feitas >= POR_TICK || linhaCaiu) break;
    const s = sessoes.get(chave)!;
    const ultima = todas[todas.length - 1]!.momment;
    // Mensagem automática do outro lado (atendente de IA, ausência) não é a
    // pessoa: sai da leva. Sobrando só isso, a leitura anda e ninguém responde.
    const novas = todas.filter(m => pareceRoboDeles(String(m.texto || '')).nivel !== 'certeza');
    // A janela das respostas é das 7h às 20h, todos os dias. Pedido de PARADA escrito com todas as letras não espera
    // a janela: grava o opt-out na hora e nada sai depois (de noite, ou quando a mensagem já passou de 15 min).
    const velha = agora - Date.parse(ultima) > RESPOSTA_VIVA_MS;
    const quieta = pediuParar(novas.map(m => String(m.texto || '').trim()).filter(Boolean)) && (!dentroDaJanelaDeResposta || velha);
    // PREPARO: enquanto vale, a sessão é da Helena e o robô de respostas da agenda PULA a pessoa, então ninguém grava
    // `lead_resposta_at` no card. Sem ele, a régua do SIM cancela o horário de quem respondeu (marcou 19h50, respondeu
    // 20h05, às 8h ela conta 12h de silêncio). Grava aqui, ANTES da janela, porque a resposta fora das 7h às 20h não passa.
    if (s.estagio === 'agendado' && s.preparo && s.agendamento_id && novas.length) {
      await gravarRespostaNoCard(s.agendamento_id, novas[novas.length - 1]!.momment);
    }
    if (!dentroDaJanelaDeResposta && !quieta) continue;
    const frio = velha && !quieta && destinoAtrasada === 'frio';
    const ctx: Contexto = { chave, novas, ultima, res, historico: [], ...(frio ? { frio: true } : {}) };

    // Leituras ANTES de reivindicar a vez: se uma falhar, a leva fica para a
    // próxima chamada em vez de se perder.
    let card: number | null;
    try {
      card = await cardPorOutraPorta(s);
    } catch (err) {
      res.erros++;
      logger.error(LOG, 'conferir card falhou: a leva fica para a próxima chamada', err);
      continue;
    }
    const pausa = await podeFalarComLead(s.telefone);

    // A conversa, lida ANTES da vez. Se a leitura falhar, ela não responde e a
    // vez NÃO é gasta: a próxima chamada tenta de novo. Na terceira falha
    // seguida a conversa vai para gente (mais abaixo, já com a vez na mão).
    let semHistorico = false;
    let equipe = false;
    if (novas.length && !quieta) {
      try {
        ctx.historico = await lerHistorico(chave, s.telefone, novas[0]!.momment);
        // A EQUIPE ASSUMIU (13/11/2026): alguém escreveu pelo celular da linha depois da abertura. A leitura vai até agora, e não até a
        // primeira mensagem nova, para pegar também o que veio depois da leva. Ela herda a regra do `falhas_historico`: leitura que
        // falha não responde e não muda o estado; na terceira falha seguida a conversa vai para gente.
        if (sessaoEmConversaDaHelena(s.estagio)) {
          equipe = equipeAssumiu(await lerHistorico(chave, s.telefone, new Date(Date.now() + 60_000).toISOString()), s.aberto_em);
        }
      } catch (err) {
        const falhas = (s.falhas_historico ?? 0) + 1;
        res.erros++;
        logger.error(LOG, `ler a conversa falhou (${falhas}ª vez seguida, final ${s.telefone.slice(-2)})`, err);
        if (falhas < FALHAS_DE_HISTORICO_ATE_PASSAR) {
          await gravarSessao(chave, { ...s, falhas_historico: falhas })
            .catch(e => logger.error(LOG, 'anotar a falha de leitura não gravou', e));
          continue;
        }
        semHistorico = true;
      }
    }

    // Gente da equipe na conversa: ela sai ANTES de gastar a vez (depois dela a mensagem do cliente se perderia). Mas o pedido de PARAR
    // (opt-out e `sem_interesse`) e o card por outra porta (`agendado`) mandam mais: nesses dois casos o fluxo de sempre cuida (ele mesmo
    // grava a sessão e não manda nada de novo ao cliente). O pedido de parar com a equipe na conversa grava o opt-out SEM a confirmação).
    const textosDaLeva = novas.map(m => String(m.texto || '').trim()).filter(Boolean);
    if (equipe && pediuParar(textosDaLeva) && !pediuPararDeVerdade(s.telefone) && card === null) {
      // Pediu para parar e a equipe já assumiu: o opt-out vale, mas a confirmação da Helena NÃO sai (gente já está na conversa).
      await parar({ ...s, falhas_historico: 0 }, ctx, { semMensagem: true })
        .catch(e => { res.erros++; logger.error(LOG, `registrar o pedido de parar falhou (final ${s.telefone.slice(-2)})`, e); });
      continue;
    }
    if (equipe && !pediuParar(textosDaLeva) && !pediuPararDeVerdade(s.telefone) && card === null) {
      await equipeAssumiuNaConversa(chave, { ...s, falhas_historico: 0 }, ultima)
        .catch(e => { res.erros++; logger.error(LOG, `passar a conversa para a equipe falhou (final ${s.telefone.slice(-2)})`, e); });
      continue;
    }

    // Os portões do envio, ANTES de gastar a vez (a leva fica para a próxima rodada se algum fechar):
    //   · resposta NORMAL: os tetos de emergência da linha (60/h, 450/24 h) e 10 s entre conversas diferentes; linha
    //     cheia ou ilegível PARA a rodada;
    //   · resposta ATRASADA (frio): uma por rodada, na régua do frio; e a pessoa pode ter escrito de novo agora,
    //     o que a devolve a resposta normal na próxima rodada.
    let esperaMs = 0;
    if (!quieta) {
      if (frio) {
        if (frioFeitos >= 1 || !(await portaoDoFrio(agoraDate))) continue;
        try {
          if (await escreveuDepoisDe(s.telefone, ultima)) continue;
        } catch (err) {
          res.erros++;
          logger.error(LOG, 'reler a conversa antes da resposta fria falhou: a leva espera', err);
          continue;
        }
      } else {
        const linha = await conferirLinhaParaResposta(chave, agora);
        if (!linha.ok) { if (linha.motivo === 'leitura_falhou') res.erros++; break; }
        esperaMs = linha.esperaMs;
      }
    }

    // A vez: chave única por pessoa e última mensagem. Duas chamadas nunca
    // respondem a mesma leva.
    const { error: eVez } = await supabase.from('system_state')
      .insert({ key: `${INV_VEZ_PREFIX}${chave}:${ultima}`, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() });
    if (eVez) continue;
    feitas++;
    if (frio) { frioFeitos++; res.frio = frioFeitos; }
    if (esperaMs > 0) await TEMPOS_DA_RESPOSTA.dormir(esperaMs);

    try {
      if (quieta) {
        await parar({ ...s, falhas_historico: 0 }, ctx, { semMensagem: true });
        continue;
      }
      if (pediuPararDeVerdade(s.telefone)) {
        // Pediu para parar por outra trilha: a conversa fecha em silêncio.
        await gravarSessao(chave, { ...s, estagio: 'sem_interesse', motivo: 'opt_out_por_outra_trilha', ate: ultima });
        continue;
      }
      if (!pausa.pode) {
        // Humano entrou na conversa: a agente cala e a sessão vira `humano`.
        await registrarBloqueio(s.telefone, LOG);
        await gravarSessao(chave, { ...semPreparo(s, 'humano_entrou'), estagio: 'humano', motivo: 'humano_entrou', ate: ultima });
        continue;
      }
      if (card !== null) {
        // Ganhou card por outra porta (marcou pela página, o consultor cadastrou):
        // daqui em diante quem responde é a régua da agenda, não a Helena.
        await gravarSessao(chave, { ...semPreparo(s, 'card_por_outra_porta'), estagio: 'agendado', agendamento_id: card, motivo: 'card_por_outra_porta', ate: ultima });
        continue;
      }
      if (!novas.length) {
        await gravarSessao(chave, { ...s, ate: ultima });
        continue;
      }
      if (semHistorico) {
        await passarParaHumano({ ...s, falhas_historico: 0 }, ctx, 'historico_ilegivel', 'RESPONDEU E NÃO CONSEGUI LER A CONVERSA', { falarComOCliente: false });
        continue;
      }
      await atender({ ...s, falhas_historico: 0 }, ctx, chaveOff.off);
    } catch (err) {
      // A vez já foi gasta: esta leva não volta sozinha. Então ela vai para gente.
      res.erros++;
      logger.error(LOG, `atender falhou (final ${s.telefone.slice(-4)})`, err);
      await passarParaHumano(s, ctx, 'erro_interno', 'RESPONDEU E DEU ERRO NA AGENTE', { falarComOCliente: false })
        .catch(e => logger.error(LOG, 'nem o recado de erro saiu', e));
    } finally {
      // Erro de linha ao enviar encerra a rodada (parecer do chefe anti-ban, 12/11/2026).
      if (ctx.linhaCaiu) linhaCaiu = true;
    }
  }

  if (res.respondidas || res.agendadas || res.passadas) {
    logger.info(LOG, `${res.respondidas} resposta(s), ${res.agendadas} reunião(ões), ${res.passadas} passada(s) para o consultor`);
  }
  return res;
}

// ═════════════════════════════════════════════════════════════════════════════
// RECUPERAÇÃO DA ESCOLHA PENDENTE (12/10/2026)
//
// Bug em produção: a pessoa escolheu o horário em DUAS mensagens ("Pode ser
// terça-feira, amanhã às 10h." e logo "1"), a leva foi lida e não virou reunião,
// e ela ficou no vácuo com a sessão em `ofertou`. O conserto de fundo está em
// `escolhaPorNumero` (a última mensagem manda) e na ação `agendar`. Isto aqui
// recupera quem JÁ caiu no buraco e qualquer leva perdida no futuro.
//
// Sessão em `ofertou` cuja última fala é DELA, mais nova que a nossa, com mais de
// 10 minutos, já lida pelo cursor (`ate`) e ainda não reprocessada, é passada UMA
// vez pelo modelo, só entre 08h e 20h de Brasília, no máximo 2 por rodada. O
// carimbo `recuperado_ate` vai para a sessão ANTES da chamada, para nunca repetir.
// ═════════════════════════════════════════════════════════════════════════════

interface PendenteRecuperavel { chave: string; s: SessaoInvestidor; p: EscolhaPendente }

/** Quem está nessa condição agora (sem janela e sem limite por rodada). Leitura
 *  que falha numa sessão pula a sessão. */
async function acharEscolhasPendentes(sessoes: Map<string, SessaoInvestidor>, agoraMs: number): Promise<PendenteRecuperavel[]> {
  const candidatas = [...sessoes.entries()]
    .filter(([, s]) => s.estagio === 'ofertou' && !s.erro && !!s.telefone && !!s.oferta?.length && !!s.ate && sessaoEhDaHelena(s, agoraMs)
      && Date.parse(s.atualizado_em) >= agoraMs - 7 * 86_400_000)
    .sort((a, b) => (String(a[1].ate) < String(b[1].ate) ? -1 : 1));
  const out: PendenteRecuperavel[] = [];
  for (const [chave, s] of candidatas) {
    try {
      const conversa = await lerHistorico(chave, s.telefone, new Date(agoraMs + 60_000).toISOString());
      const p = escolhaPendenteDe(conversa, s.ate, s.recuperado_ate, agoraMs);
      if (p) out.push({ chave, s, p });
    } catch (err) {
      logger.warn(LOG, `recuperação: ler a conversa falhou (final ${s.telefone.slice(-2)})`, { erro: String((err as Error)?.message || err).slice(0, 200) });
    }
  }
  return out;
}

export interface ResultadoRecuperacao extends ResultadoRespostas { pendentes: number; reprocessadas: number }

export async function recuperarEscolhasPendentes(opts: { agora?: Date } = {}): Promise<ResultadoRecuperacao> {
  const agora = opts.agora ?? new Date();
  const res: ResultadoRecuperacao = { ...semResposta(), pendentes: 0, reprocessadas: 0 };
  if (!dentroDaJanelaDeRecuperacao(agora)) return { ...res, motivo: 'fora_da_janela' };
  let sessoes: Map<string, SessaoInvestidor>;
  try {
    sessoes = await lerSessoes();
  } catch (err) {
    logger.error(LOG, 'recuperação: ler as sessões falhou', err);
    return { ...res, erros: 1, motivo: 'erro_sessoes' };
  }
  const pendentes = await acharEscolhasPendentes(sessoes, agora.getTime());
  res.pendentes = pendentes.length;
  if (!pendentes.length) return { ...res, motivo: 'nenhuma_pendente' };

  let silenciado: (tel: string) => boolean;
  let chaveOff: EstadoDesligar;
  try {
    [silenciado, chaveOff] = await Promise.all([carregarSilenciados({ estrito: true }), lerChaveDesligar()]);
  } catch (err) {
    logger.error(LOG, 'recuperação: ler o opt-out falhou, nada é reprocessado', err);
    return { ...res, erros: 1, motivo: 'erro_leitura' };
  }

  for (const { chave, s, p } of pendentes) {
    if (res.reprocessadas >= RECUPERACOES_POR_RODADA) break;
    try {
      // Ganhou card por outra porta (marcou pela página, o consultor cadastrou):
      // a sessão fecha em vez de agendar em dobro.
      const card = await cardPorOutraPorta(s);
      if (card !== null) {
        await gravarSessao(chave, { ...s, estagio: 'agendado', agendamento_id: card, motivo: 'card_por_outra_porta', ate: p.ultima });
        continue;
      }
      if (silenciado(s.telefone)) {
        await gravarSessao(chave, { ...s, estagio: 'sem_interesse', motivo: 'opt_out_por_outra_trilha', ate: p.ultima });
        continue;
      }
      if (!(await podeFalarComLead(s.telefone)).pode) {
        await registrarBloqueio(s.telefone, LOG);
        await gravarSessao(chave, { ...s, estagio: 'humano', motivo: 'humano_entrou', ate: p.ultima });
        continue;
      }
    } catch (err) {
      res.erros++;
      logger.error(LOG, `recuperação: conferir a sessão falhou (final ${s.telefone.slice(-2)})`, err);
      continue;
    }

    // O carimbo ANTES de chamar o modelo: se algo cair no meio, não repete.
    const marcada: SessaoInvestidor = { ...s, recuperado_ate: p.ultima };
    try {
      await gravarSessao(chave, marcada);
    } catch (err) {
      res.erros++;
      logger.error(LOG, 'recuperação: gravar o carimbo falhou, não reprocessa', err);
      continue;
    }
    res.reprocessadas++;
    const ctx: Contexto = { chave, novas: p.novas, ultima: p.ultima, res, historico: p.historico };
    try {
      await atender({ ...marcada, falhas_historico: 0 }, ctx, chaveOff.off, { recuperacao: true });
    } catch (err) {
      res.erros++;
      logger.error(LOG, `recuperação: atender falhou (final ${s.telefone.slice(-4)})`, err);
      await passarParaHumano(marcada, ctx, 'erro_interno', 'RESPONDEU E DEU ERRO NA AGENTE', { falarComOCliente: false })
        .catch(e => logger.error(LOG, 'nem o recado de erro saiu', e));
    }
  }
  if (res.reprocessadas) {
    logger.info(LOG, `recuperação: ${res.reprocessadas} escolha(s) reprocessada(s), ${res.agendadas} reunião(ões), ${res.passadas} passada(s) para o consultor`);
  }
  return res;
}

// ═════════════════════════════════════════════════════════════════════════════
// FECHO DO RESGATE: quem não respondeu em 7 dias
// ═════════════════════════════════════════════════════════════════════════════

/** Sessões de resgate encerradas por rodada. */
const FECHOS_POR_RODADA = 5;
/** Sessão de resgate (as que já existem) em `chamado` há tanto tempo sem resposta é encerrada. */
const RESGATE_SEM_RESPOSTA_MS = 7 * 86_400_000;

/**
 * Sessão de RESGATE em `chamado` há 7 dias ou mais: a pessoa vai para o silêncio
 * da casa (`nunca_respondeu`) e a sessão para `sem_interesse` com motivo
 * `sem_resposta`. Não envia mensagem nenhuma. Vale SÓ para o resgate: as sessões
 * da fila principal seguem a regra de sempre (10 dias e a posse acaba).
 *
 * Antes de fechar, confere se chegou mensagem dela que a rodada de respostas
 * ainda não leu: nesse caso deixa para lá, é conversa. Erro de leitura também não
 * fecha. Sessão com `erro` (a abertura nem saiu) nunca é fechada aqui: silenciar
 * quem nunca foi chamado seria inventar um fato.
 *
 * Quem JÁ está na supressão não é regravado (12/10/2026, revisão): o upsert do
 * `silenciarContato` sobrescreve o motivo, e `nunca_respondeu` é o mais fraco, então
 * apagaria um `opt_out`, uma `denuncia` ou um `fora_do_padrao`. A sessão fecha do
 * mesmo jeito. Sem conseguir ler a supressão, nada fecha nesta rodada.
 */
export async function fecharResgatesSemResposta(
  agora: number = Date.now(),
): Promise<{ fechadas: number; erros: number; motivo?: string }> {
  let sessoes: Map<string, SessaoInvestidor>;
  try {
    sessoes = await lerSessoes();
  } catch (err) {
    logger.error(LOG, 'fecho do resgate: ler as sessões falhou', err);
    return { fechadas: 0, erros: 1, motivo: 'erro_sessoes' };
  }
  const vencidas = [...sessoes.entries()]
    .filter(([, s]) => s.grupo === 'resgate' && s.estagio === 'chamado' && !s.erro && !!s.telefone
      && Number.isFinite(Date.parse(s.aberto_em)) && agora - Date.parse(s.aberto_em) >= RESGATE_SEM_RESPOSTA_MS)
    .sort((a, b) => (a[1].aberto_em < b[1].aberto_em ? -1 : 1))
    .slice(0, FECHOS_POR_RODADA);
  return encerrarSemResposta(vencidas, 'resgate');
}

/**
 * O miolo do fecho, igual para o resgate e para as retomadas: a pessoa vai para o
 * silêncio da casa (sem regravar quem já está nele), a sessão vira `sem_interesse`
 * com motivo `sem_resposta`, e nenhuma mensagem sai. O status do cadastro não muda.
 */
async function encerrarSemResposta(
  vencidas: Array<[string, SessaoInvestidor]>, rotulo: 'resgate' | 'retomadas',
): Promise<{ fechadas: number; erros: number; motivo?: string }> {
  if (!vencidas.length) return { fechadas: 0, erros: 0 };
  let jaSilenciado: (tel: string) => boolean;
  try {
    jaSilenciado = await carregarSilenciados({ estrito: true });
  } catch (err) {
    logger.error(LOG, `fecho (${rotulo}): ler a supressão falhou, nada fecha nesta rodada`, err);
    return { fechadas: 0, erros: 1, motivo: 'erro_supressao' };
  }
  let fechadas = 0;
  let erros = 0;
  for (const [chave, s] of vencidas) {
    try {
      const { data, error } = await supabase.from('wa_mensagens').select('momment')
        .eq('from_me', false).eq('is_group', false).eq('instancia', INSTANCE_ID_IO)
        .in('telefone', variantes(s.telefone)).order('momment', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      const ultima = (data as Array<{ momment: string }> | null)?.[0]?.momment;
      if (ultima && ultima > (s.ate || s.aberto_em)) continue;   // escreveu: a rodada de respostas cuida
      if (!jaSilenciado(s.telefone)) await silenciarContato(s.telefone, 'nunca_respondeu', LOG);
      await gravarSessao(chave, { ...s, estagio: 'sem_interesse', motivo: 'sem_resposta' });
      fechadas++;
    } catch (err) {
      erros++;
      logger.error(LOG, `fecho (${rotulo}) falhou (final ${s.telefone.slice(-2)})`, err);
    }
  }
  if (fechadas) logger.info(LOG, `${fechadas} sessão(ões) de ${rotulo} encerradas por falta de resposta`);
  return { fechadas, erros };
}

/**
 * Fecho das RETOMADAS: 7 dias depois do toque 5 sem resposta, a sessão da fila
 * principal vira `sem_interesse` (`sem_resposta`), a pessoa entra na supressão como
 * `nunca_respondeu` (sem regravar quem já está nela) e nenhuma mensagem sai. No
 * máximo 5 por rodada. O status do cadastro não muda.
 */
export async function fecharRetomadasEsgotadas(
  agora: number = Date.now(),
): Promise<{ fechadas: number; erros: number; motivo?: string }> {
  let sessoes: Map<string, SessaoInvestidor>;
  let carimbos: Map<string, CarimbosDosToques>;
  try {
    [sessoes, carimbos] = await Promise.all([lerSessoes(), lerCarimbosDeToque()]);
  } catch (err) {
    logger.error(LOG, 'fecho das retomadas: ler sessões e carimbos falhou', err);
    return { fechadas: 0, erros: 1, motivo: 'erro_leitura' };
  }
  const nada = () => false;
  const { fechos } = montarRetomadas(sessoes, carimbos, { silenciado: nada, bloqueado: nada, mudo: nada, comHumano: nada }, agora);
  const candidatas = fechos.slice(0, FECHOS_POR_RODADA)
    .map(f => [f.chave, sessoes.get(f.chave)!] as [string, SessaoInvestidor]);
  // Quem tem card (que não seja cancelado) já tem reunião: a sessão fecha como
  // `card_por_outra_porta` e a pessoa NÃO é silenciada. Erro na leitura pula a pessoa.
  const vencidas: Array<[string, SessaoInvestidor]> = [];
  let errosDeCard = 0;
  for (const par of candidatas) {
    try {
      const card = await cardPorOutraPorta(par[1]);
      if (card === null) { vencidas.push(par); continue; }
      await fecharPorCardDeOutraPorta(par[0], card);
    } catch (err) {
      errosDeCard++;
      logger.error(LOG, 'fecho das retomadas: conferir o card falhou, a pessoa fica para a próxima rodada', err);
    }
  }
  const r = await encerrarSemResposta(vencidas, 'retomadas');
  return { ...r, erros: r.erros + errosDeCard };
}

// ═════════════════════════════════════════════════════════════════════════════
// RETOMADAS (13/10/2026): toques 2 a 5
//
// Quem recebeu a abertura e não respondeu volta a ser chamado, no máximo 15 por dia,
// dentro do teto do dia da agente e sempre sobrando 5 vagas dele para abertura. A
// regra de quem vence e quando mora no investidorAgentePuro.ts (`montarRetomadas`);
// aqui estão as leituras, os portões e o envio. Saem ANTES das aberturas, um envio
// por rodada, e a rodada segue para a abertura se nenhuma retomada passar.
// ═════════════════════════════════════════════════════════════════════════════

/** Os carimbos dos toques de todo mundo: chave -> { 1: updated_at, 2: ... }. Erro SOBE. */
export async function lerCarimbosDeToque(): Promise<Map<string, CarimbosDosToques>> {
  const linhas = await lerTudo<{ key: string; updated_at: string | null }>('carimbos dos toques', (de, ate) =>
    supabase.from('system_state').select('key, updated_at')
      .like('key', `${INV_SENT_PREFIX}%`).order('key', { ascending: true }).range(de, ate));
  const mapa = new Map<string, CarimbosDosToques>();
  for (const l of linhas) {
    const t = lerChaveDeToque(l.key);
    if (!t || !l.updated_at) continue;
    if (!mapa.has(t.chave)) mapa.set(t.chave, {});
    mapa.get(t.chave)![t.n] = String(l.updated_at);
  }
  return mapa;
}

/**
 * Há mensagem nesta conversa DEPOIS do toque anterior, nossa ou dela? O telefone é
 * comparado pela chave (DDD + 8 últimos), então a forma com e sem o nono dígito é
 * a mesma pessoa (a Z-API alterna, e a falha aqui é silenciosa); o LID de quem
 * digitou pelo celular é resolvido pelo mapa. A margem de 5 minutos deixa de fora o
 * próprio toque, cujo carimbo é gravado antes do envio. Erro SOBE: não saber é não falar.
 *
 * Mensagem DELA com data até o cursor `ate` da sessão NÃO conta: o tratador de
 * respostas já leu e decidiu não responder (a resposta automática do WhatsApp), e
 * quem só mandou isso vale como quem não respondeu. Depois do `ate` conta, porque o
 * tratador ainda vai ler. Mensagem NOSSA (outro robô, um humano) sempre conta, e ganha
 * de qualquer outra: devolve `nossa` (encerra o ciclo da pessoa), `dela` (só adia) ou null.
 */
async function conversaDepoisDoToque(
  chave: string, telefone: string, ultimoToqueIso: string, ate: string | null | undefined,
): Promise<'nossa' | 'dela' | null> {
  const corte = new Date(Date.parse(ultimoToqueIso) + MARGEM_DO_TOQUE_MS).toISOString();
  const { data: mapa, error: eMapa } = await supabase.from('wa_lid_telefone').select('lid').eq('chave', chave).limit(50);
  if (eMapa) throw new Error(`mapa de LID: ${eMapa.message}`);
  const lids = new Set(((mapa ?? []) as Array<{ lid: string }>).map(m => String(m.lid).replace(/\D/g, '')).filter(Boolean));
  const consultas = [
    supabase.from('wa_mensagens').select('telefone, momment, from_me').eq('is_group', false)
      .gte('momment', corte).like('telefone', `%${telefone.slice(-8)}%`).limit(100),
  ];
  if (lids.size) {
    consultas.push(supabase.from('wa_mensagens').select('telefone, momment, from_me').eq('is_group', false)
      .gte('momment', corte).in('telefone', [...lids]).limit(50));
  }
  let achou: 'nossa' | 'dela' | null = null;
  for (const r of await Promise.all(consultas)) {
    if (r.error) throw new Error(`conversa depois do toque: ${r.error.message}`);
    for (const m of (r.data ?? []) as Array<{ telefone: string | null; momment: string; from_me: boolean | null }>) {
      const d = String(m.telefone ?? '').replace(/\D/g, '');
      if (!(d.length > 13 ? lids.has(d) : chaveContato(d) === chave)) continue;
      if (!m.from_me && ate && m.momment <= ate) continue;   // dela, já lida pelo tratador
      if (m.from_me) return 'nossa';
      achou = 'dela';
    }
  }
  return achou;
}

/** Fecha a sessão como o tratador de respostas fecha quem ganhou card por outra porta:
 *  `agendado`, motivo `card_por_outra_porta`, sem mensagem. Relê a sessão antes de gravar. */
async function fecharPorCardDeOutraPorta(chave: string, card: number): Promise<void> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveDaSessao(chave)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.value) return;
  await gravarSessao(chave, { ...(data.value as SessaoInvestidor), estagio: 'agendado', agendamento_id: card, motivo: 'card_por_outra_porta' });
}

/** Marca o fim do ciclo de retomadas desta pessoa (`outra_conversa`). Estágio intacto, sem mensagem, sem silêncio. */
async function encerrarCicloDeRetomadas(chave: string): Promise<void> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveDaSessao(chave)).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.value) return;
  await gravarSessao(chave, { ...(data.value as SessaoInvestidor), ciclo_encerrado: 'outra_conversa', ciclo_encerrado_em: new Date().toISOString() });
}

export interface ResultadoRetomada { enviados: number; motivo?: string; toque?: number; para?: string; erro?: string; vencidas?: number }

/** Quantas vencidas olhamos a conversa por rodada (uma consulta cada, em paralelo). */
const CONVERSAS_CONFERIDAS_POR_RODADA = 40;

/** Um envio por chamada, sempre. */
export async function runInvestidorRetomadaTick(opts: { agora?: Date } = {}): Promise<ResultadoRetomada> {
  const agora = opts.agora ?? new Date();
  const sem = (motivo: string, extra: Partial<ResultadoRetomada> = {}): ResultadoRetomada => ({ enviados: 0, motivo, ...extra });

  // 1) Chave de desligar.
  const chave = await lerChaveDesligar();
  if (chave.off) return sem(`desligada_${chave.por}`);

  // 2) Disjuntores: dois erros de envio seguidos param tudo; os pedidos de parada param só o grupo da pessoa.
  //    Sem conseguir ler, não envia.
  let disjuntor: Disjuntor;
  let gruposFechados: Set<string>;
  try {
    const [d, g] = await Promise.all([lerDisjuntor(), lerGruposFechados(agora)]);
    disjuntor = d; gruposFechados = g.fechados;
  } catch (err) {
    logger.error(LOG, 'retomadas: ler o disjuntor falhou', err);
    return sem('erro_leitura_disjuntor');
  }
  if (disjuntor.aberto) return sem('disjuntor_erros_de_envio');

  // 3) Início e janela própria.
  if (antesDoInicio(agora)) return sem('antes_do_inicio');
  if (!janelaAberta(agora)) return sem('fora_da_janela');

  // 4) Teto do dia, que as retomadas dividem com as aberturas, e a cota delas: só
  //    enquanto `retomadas de hoje < min(15, teto - 5)`.
  const rampa = await rampaReconexaoVigente(agora);
  const teto = tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null);
  let enviadosHoje: number;
  let retomadasHoje: number;
  try {
    [enviadosHoje, retomadasHoje] = await Promise.all([contarEnviadosHoje(agora), contarRetomadasHoje(agora)]);
  } catch (err) {
    logger.error(LOG, 'retomadas: contar os envios de hoje falhou', err);
    return sem('erro_leitura_teto');
  }
  if (enviadosHoje >= teto) return sem('teto_do_dia');
  const limite = limiteDeRetomadasHoje(teto, process.env.INVESTIDOR_AGENTE_RETOMADAS_DIA);
  if (retomadasHoje >= limite) return sem('cota_de_retomadas', { vencidas: undefined });

  // 5) Quem venceu pelo calendário (sessões e carimbos). Sem ninguém, nem lê o resto.
  let sessoes: Map<string, SessaoInvestidor>;
  let carimbos: Map<string, CarimbosDosToques>;
  try {
    [sessoes, carimbos] = await Promise.all([lerSessoes(), lerCarimbosDeToque()]);
  } catch (err) {
    logger.error(LOG, 'retomadas: ler sessões e carimbos falhou', err);
    return sem('erro_leitura_retomadas');
  }
  const nada = () => false;
  // Sessão antiga (há mais de 21 dias) NÃO recebe o toque atrasado: volta pela fila, como retorno.
  const retorno = chavesDeRetorno(sessoes, carimbos, agora.getTime());
  if (!montarRetomadas(sessoes, carimbos, { silenciado: nada, bloqueado: nada, mudo: nada, comHumano: nada, retorno }, agora.getTime()).fila.length) {
    return sem('nenhuma_vencida');
  }

  // 6) A linha: os mesmos freios da abertura.
  //    O frio é um orçamento só da linha: sem `pisoDia` por cima (parecer do chefe anti-ban, 12/11/2026).
  if (!(await dentroDoTetoHorarioLinha({ robo: 'investidor_agente_abertura' }))) return sem('teto_da_linha');
  if (!(await respeitaEspacamentoLinha())) return sem('espacamento_da_linha');

  // 7) Os cortes, em modo estrito: erro de leitura derruba a rodada e ninguém recebe.
  //    O mudo aqui é o de 3 toques em 60 dias (parecer anti-ban), não o de 2 da abertura.
  let resultado: ResultadoRetomadas;
  try {
    const [silenciado, mudo, bloqueado, pausa] = await Promise.all([
      carregarSilenciados({ estrito: true }),
      carregarMudos(3, 60, { estrito: true }),
      carregarBloqueados({ estrito: true }),
      carregarPausas({ estrito: true }),
    ]);
    resultado = montarRetomadas(sessoes, carimbos, {
      silenciado, bloqueado, mudo, comHumano: (tel: string) => !pausa(tel).pode, retorno, gruposFechados,
    }, agora.getTime());
  } catch (err) {
    logger.error(LOG, 'retomadas: ler os cortes falhou, ninguém recebe nesta rodada', err);
    return sem('erro_leitura_cortes');
  }
  const vencidas = resultado.fila.length;
  if (!vencidas) return sem('nenhuma_passou_nos_cortes', { vencidas: 0 });

  // 8) A conversa desde o toque anterior. Mensagem DELA depois do cursor só adia (o
  //    tratador de respostas cuida). Mensagem NOSSA (pauta de outro robô, o consultor
  //    escrevendo) ENCERRA o ciclo de retomadas daquela pessoa: nunca mais recebe, a
  //    sessão não muda de estágio, nada é enviado e ninguém é silenciado. Conversa que
  //    não deu para ler adia: não saber é não falar.
  const olhadas = resultado.fila.slice(0, CONVERSAS_CONFERIDAS_POR_RODADA);
  const conversas = await Promise.all(olhadas.map(c =>
    conversaDepoisDoToque(c.chave, c.telefone, c.ultimoToqueEm, sessoes.get(c.chave)?.ate).then(
      (quem) => ({ quem, erro: false }),
      (err: unknown) => { logger.error(LOG, `retomadas: ler a conversa falhou (final ${c.telefone.slice(-2)})`, err); return { quem: 'dela' as const, erro: true }; },
    )));
  for (let i = 0; i < olhadas.length; i++) {
    if (conversas[i]!.quem !== 'nossa') continue;
    try {
      await encerrarCicloDeRetomadas(olhadas[i]!.chave);
      logger.info(LOG, `retomadas: ciclo encerrado, outra conversa (final ${olhadas[i]!.telefone.slice(-2)})`);
    } catch (err) {
      logger.error(LOG, 'retomadas: marcar o ciclo encerrado falhou', err);
    }
  }
  const livres = olhadas.filter((_, i) => conversas[i]!.quem === null);
  if (!livres.length) {
    return sem(conversas.every(c => c.erro) ? 'erro_leitura_conversa' : 'conversa_nova_desde_o_toque', { vencidas });
  }

  // 9) Card na agenda. Quem ganhou card por outra porta (o consultor falou por telefone e
  //    criou à mão) já tem reunião: não recebe, e a sessão fecha como o tratador fecha em
  //    `card_por_outra_porta`, sem mensagem. Card `cancelado` não conta. Erro de leitura não envia.
  let alvo: CandidatoRetomada | null = null;
  for (const c of livres) {
    let card: number | null;
    try {
      card = await cardPorOutraPorta(sessoes.get(c.chave)!);
    } catch (err) {
      logger.error(LOG, 'retomadas: conferir o card falhou, ninguém recebe nesta rodada', err);
      return sem('erro_leitura_card', { vencidas });
    }
    if (card === null) { alvo = c; break; }
    try {
      await fecharPorCardDeOutraPorta(c.chave, card);
      logger.info(LOG, `retomadas: card ${card} por outra porta, sessão fechada (final ${c.telefone.slice(-2)})`);
    } catch (err) {
      logger.error(LOG, 'retomadas: fechar a sessão por card falhou', err);
      return sem('erro_fechar_por_card', { vencidas });
    }
  }
  if (!alvo) return sem('card_por_outra_porta', { vencidas });

  // 10) Pausa humana daquele telefone, conferida de novo na hora de falar.
  if (!(await podeFalarComLead(alvo.telefone)).pode) {
    await registrarBloqueio(alvo.telefone, LOG);
    return sem('humano_na_conversa', { vencidas });
  }

  // CLAIM: o insert do carimbo do toque, ANTES do envio. 23505 = esse toque já saiu
  // (ou outra chamada o pegou): ele não sai duas vezes.
  const texto = renderRetomada(alvo.toque, alvo.nome, alvo.tipo);
  const nowIso = new Date().toISOString();
  const keyDoToque = `${INV_SENT_PREFIX}${alvo.chave}:t${alvo.toque}`;
  const { error: eClaim } = await supabase.from('system_state')
    .insert({ key: keyDoToque, value: { em: nowIso, retomada: true }, updated_at: nowIso });
  if (eClaim) {
    if (String((eClaim as { code?: string }).code) === '23505') return sem('ja_reivindicado', { toque: alvo.toque });
    logger.error(LOG, 'retomadas: claim do toque falhou', eClaim);
    return sem('erro_claim', { toque: alvo.toque });
  }

  // UMA bolha. Erro de envio: o carimbo não pode ficar sem mensagem (ele conta no
  // teto e marca o toque como dado), então sai, e o disjuntor de 2 erros seguidos conta.
  const fim4 = alvo.telefone.slice(-4);
  try {
    const saiu = await sendFrio(alvo.telefone, [texto.texto], 'io');
    if (saiu === false) {
      // A pausa humana (ou a linha) calou o envio na hora: NADA saiu. Sem carimbo, sem avançar o toque
      // (a sessão não é tocada) e sem contar erro: a pessoa fica para a próxima rodada.
      logger.warn(LOG, `retomada ${alvo.toque} calada pela trava da linha (final ${fim4}): nada saiu, a pessoa fica para a próxima rodada`);
      const { error: eDesfazer } = await supabase.from('system_state').delete().eq('key', keyDoToque);
      if (eDesfazer) logger.error(LOG, 'desfazer o carimbo da retomada calada falhou', eDesfazer);
      return sem('envio_calado_pela_linha', { toque: alvo.toque });
    }
  } catch (err) {
    const erro = String((err as Error)?.message || err).slice(0, 300);
    logger.error(LOG, `retomada ${alvo.toque} falhou para o final ${fim4}`, err);
    await supabase.from('system_state').delete().eq('key', keyDoToque)
      .then(undefined, (e: unknown) => logger.error(LOG, 'desfazer o carimbo do toque não funcionou', e));
    const erros = disjuntor.erros_seguidos + 1;
    await gravarDisjuntor({ erros_seguidos: erros, aberto: erros >= ERROS_ATE_ABRIR, ultimo_erro: erro });
    return sem('erro_envio', { erro, toque: alvo.toque });
  }

  // Envio feito: a sessão anota o toque (releitura, para não passar por cima do que
  // outra coisa tenha gravado nela desde a leitura de agora há pouco).
  try {
    const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveDaSessao(alvo.chave)).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.value) await gravarSessao(alvo.chave, { ...(data.value as SessaoInvestidor), toques: alvo.toque, ultimo_toque_em: nowIso });
  } catch (err) {
    logger.error(LOG, `retomada enviada (final ${fim4}) mas a sessão não anotou o toque: o carimbo vale`, err);
  }
  if (disjuntor.erros_seguidos > 0) await gravarDisjuntor({ erros_seguidos: 0, aberto: false });

  logger.info(LOG, `retomada ${alvo.toque} enviada (final ${fim4}, vencida há ${alvo.vencidaHaDias} dia(s))`);
  return { enviados: 1, toque: alvo.toque, para: `final ${fim4}`, vencidas };
}

// ═════════════════════════════════════════════════════════════════════════════
// A RETOMADA DO CONVITE, A PASSAGEM POR SILÊNCIO E A EQUIPE QUE ASSUMIU (13/11/2026)
//
// A regra pura mora em investidorAgenteConvite.ts; o aviso ao consultor, em investidorAgenteAvisosEquipe.ts. Aqui ficam as leituras, os
// portões, o claim e o envio. Parecer do chefe anti-ban: NÃO BLOQUEIA com as condições do plano.
//
//   · RETOMADA DO CONVITE (toque `c1`, 1 por pessoa para sempre): quem conversou, recebeu o convite (ou os horários) e parou de responder.
//     24 h depois da última fala da Helena, sem NENHUMA mensagem depois dela, volta 1 vez com 2 horários livres do consultor dono do card.
//     É um envio FRIO: 1 por rodada, pelo portão do frio (janela, disjuntor, teto da linha, espaço), no teto do dia e na cota das retomadas.
//     O claim é o insert de `inv_agente_sent:<chave>:c1` ANTES do envio (23505 = já saiu); a sessão vira `ofertou` ANTES, com os 2 horários.
//   · PASSAGEM POR SILÊNCIO: 48 h depois da retomada, sem ninguém escrever, a sessão vai a `humano` e o consultor recebe a ficha.
//   · EQUIPE ASSUMIU: `from_me` com `from_api` diferente de `true` depois da abertura. A Helena sai e o consultor recebe 1 aviso.
// ═════════════════════════════════════════════════════════════════════════════

/** Quantos candidatos da retomada do convite a rodada olha (cada um custa uma leitura da conversa). */
const CONVITE_CONFERIDOS_POR_RODADA = 10;
/** Quantas sessões a passagem por silêncio fecha por rodada. */
const SILENCIOS_POR_RODADA = 5;
/** Os horários que a retomada oferece: 2, escolhidos pela MESMA função da oferta normal, no mesmo horizonte de 22 dias. */
const HORARIOS_DO_CONVITE = 2;
/** O carimbo da retomada: `inv_agente_sent:<chave>:c1`. Entra na conta única pelo prefixo, e o regex dos toques o ignora. */
const chaveDoConvite = (chave: string): string => `${INV_SENT_PREFIX}${chave}:c1`;

export interface ResultadoConvite { enviados: number; motivo?: string; candidatos?: number; para?: string; erro?: string }
export interface ResultadoSilencio { passadas: number; equipe: number; erros: number; motivo?: string }

/** Quem já recebeu a retomada do convite (carimbo `c1`). Erro SOBE. */
async function lerConvitesJaEnviados(): Promise<Set<string>> {
  const linhas = await lerTudo<{ key: string }>('carimbos da retomada do convite', (de, ate) =>
    supabase.from('system_state').select('key').like('key', `${INV_SENT_PREFIX}%:c1`).order('key', { ascending: true }).range(de, ate));
  return new Set(linhas.map(l => l.key.slice(INV_SENT_PREFIX.length).split(':')[0]!));
}

async function relerSessao(chave: string): Promise<SessaoInvestidor | null> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', chaveDaSessao(chave)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as SessaoInvestidor | undefined) ?? null;
}

/** A sessão relida é a mesma que foi lida (mesmo estágio, mesmo `atualizado_em`)? */
const sessaoIgual = (a: SessaoInvestidor, b: SessaoInvestidor | null): boolean =>
  !!b && b.estagio === a.estagio && b.atualizado_em === a.atualizado_em;

/** A conversa inteira até agora, com `from_api` (a leitura que decide a retomada, o silêncio e a equipe). Erro SOBE. */
const lerConversaAteAgora = (chave: string, telefone: string, agoraMs: number): Promise<MsgDaConversa[]> =>
  lerHistorico(chave, telefone, new Date(agoraMs + 60_000).toISOString());

/** Devolve a sessão ao que era ANTES da retomada, com o `atualizado_em` de antes: ele marca a última fala da Helena. */
async function restaurarSessao(chave: string, antes: SessaoInvestidor): Promise<void> {
  const { error } = await supabase.from('system_state')
    .upsert({ key: chaveDaSessao(chave), value: antes, updated_at: antes.atualizado_em }, { onConflict: 'key' });
  if (error) logger.error(LOG, 'devolver a sessão a antes da retomada do convite falhou', error);
}

/**
 * A equipe assumiu: estado primeiro (`humano`, motivo `equipe_assumiu`), depois a trava `pendente` do aviso ao consultor dono do card
 * (quem envia é `rodarAvisosDaHelenaEquipe`, no máximo 1 por rodada). Nada sai para o cliente. 1 vez por sessão (a trava é um insert).
 */
async function equipeAssumiuNaConversa(chave: string, s: SessaoInvestidor, ate?: string): Promise<void> {
  // A trava do aviso nasce ANTES do estado: se ela não for gravada, o estado não muda e a Helena não responde nesta rodada (falha fechada).
  // `existia` (23505) é aviso já reservado antes: o estado muda do mesmo jeito, e o aviso não repete.
  const reserva = await reservarAvisoDaEquipe('assumiu', {
    chave, consultor: s.consultor, texto: textoEquipeAssumiu({ consultor: s.consultor, nome: s.nome, tipo: tipoDaSessao(s.tipo) }),
  });
  if (reserva === 'erro') throw new Error('reservar o aviso da equipe falhou: o estado não muda');
  await gravarSessao(chave, { ...s, estagio: 'humano', motivo: MOTIVO_EQUIPE_ASSUMIU, ...(ate ? { ate } : {}) });
  logger.info(LOG, `a equipe assumiu a conversa (final ${s.telefone.slice(-2)}): a Helena saiu`);
}

/**
 * Os carimbos da fala da Helena para esta chave: `inv_agente_env:<chave>:<ms>:<n>` (cada bolha de resposta, desde 12/11), `inv_agente_frio:` (resposta
 * atrasada) e `inv_agente_sent:<chave>:tN` / `:c1` (abertura, retomadas e a retomada do convite). Usa o `updated_at` de cada um. `c1`: a retomada
 * do convite foi reivindicada. Erro SOBE (não saber de quem é a última fala é não falar).
 */
async function lerCarimbosDela(chave: string): Promise<{ momentos: number[]; c1: boolean }> {
  const { data, error } = await supabase.from('system_state').select('key, updated_at')
    .or(`key.like.${PREFIXO_ENV}${chave}:%,key.like.${INV_FRIO_PREFIX}${chave}:%,key.like.${INV_SENT_PREFIX}${chave}:%`)
    .order('updated_at', { ascending: false }).limit(300);
  if (error) throw new Error(`carimbos da Helena: ${error.message}`);
  const linhas = (data ?? []) as Array<{ key: string; updated_at: string | null }>;
  return {
    momentos: linhas.map(l => Date.parse(String(l.updated_at ?? ''))).filter(Number.isFinite),
    c1: linhas.some(l => l.key === chaveDoConvite(chave)),
  };
}

const idsDoCardDaSessao = (s: SessaoInvestidor): number[] => [...new Set([...(s.cards_conhecidos ?? []), ...(s.card_id ? [s.card_id] : [])])];

/** Um envio por chamada, sempre. */
export async function runInvestidorConviteTick(opts: { agora?: Date } = {}): Promise<ResultadoConvite> {
  const agora = opts.agora ?? new Date();
  const agoraMs = agora.getTime();
  const sem = (motivo: string, extra: Partial<ResultadoConvite> = {}): ResultadoConvite => ({ enviados: 0, motivo, ...extra });

  // 1) Chave de desligar, disjuntores, início e janela: os mesmos da retomada. Sem conseguir ler, não envia.
  const chave = await lerChaveDesligar();
  if (chave.off) return sem(`desligada_${chave.por}`);
  let disjuntor: Disjuntor;
  let gruposFechados: Set<string>;
  try {
    const [d, g] = await Promise.all([lerDisjuntor(), lerGruposFechados(agora)]);
    disjuntor = d; gruposFechados = g.fechados;
  } catch (err) {
    logger.error(LOG, 'convite: ler o disjuntor falhou', err);
    return sem('erro_leitura_disjuntor');
  }
  if (disjuntor.aberto) return sem('disjuntor_erros_de_envio');
  if (antesDoInicio(agora)) return sem('antes_do_inicio');
  if (!janelaAberta(agora)) return sem('fora_da_janela');

  // 2) Teto do dia e cota das retomadas (o `c1` conta nas duas): o convite não come a reserva da abertura.
  const rampa = await rampaReconexaoVigente(agora);
  const teto = tetoDoDia(agora, process.env.INVESTIDOR_AGENTE_TETO, rampa?.dia ?? null);
  let enviadosHoje: number;
  let retomadasHoje: number;
  try {
    [enviadosHoje, retomadasHoje] = await Promise.all([contarEnviadosHoje(agora), contarRetomadasHoje(agora)]);
  } catch (err) {
    logger.error(LOG, 'convite: contar os envios de hoje falhou', err);
    return sem('erro_leitura_teto');
  }
  if (enviadosHoje >= teto) return sem('teto_do_dia');
  if (retomadasHoje >= limiteDeRetomadasHoje(teto, process.env.INVESTIDOR_AGENTE_RETOMADAS_DIA)) return sem('cota_de_retomadas');

  // 3) Quem entra: só a regra da sessão. Sem ninguém, nem toca na linha.
  let candidatos: Array<[string, SessaoInvestidor]>;
  try {
    const [sessoes, enviados] = await Promise.all([lerSessoes(), lerConvitesJaEnviados()]);
    candidatos = [...sessoes.entries()]
      .filter(([k, s]) => sessaoEntraNoConvite(s) && sessaoEhDaHelena(s, agoraMs) && !enviados.has(k) && !gruposFechados.has(grupoDaSessao(s)))
      .sort((a, b) => String(a[1].atualizado_em).localeCompare(String(b[1].atualizado_em)));
  } catch (err) {
    logger.error(LOG, 'convite: ler as sessões falhou', err);
    return sem('erro_leitura_sessoes');
  }
  if (!candidatos.length) return sem('nenhum_candidato', { candidatos: 0 });

  // 4) O portão do frio (janela, disjuntor, teto horário da linha e espaçamento) e os cortes, em modo estrito.
  if (!(await portaoDoFrio(agora))) return sem('portao_do_frio', { candidatos: candidatos.length });
  let liberados: Array<[string, SessaoInvestidor]>;
  try {
    const [silenciado, mudo, bloqueado, pausa] = await Promise.all([
      carregarSilenciados({ estrito: true }), carregarMudos(3, 60, { estrito: true }),
      carregarBloqueados({ estrito: true }), carregarPausas({ estrito: true }),
    ]);
    liberados = candidatos.filter(([, s]) => !silenciado(s.telefone) && !bloqueado(s.telefone) && !mudo(s.telefone) && pausa(s.telefone).pode);
  } catch (err) {
    logger.error(LOG, 'convite: ler os cortes falhou, ninguém recebe nesta rodada', err);
    return sem('erro_leitura_cortes');
  }
  if (!liberados.length) return sem('nenhuma_passou_nos_cortes', { candidatos: candidatos.length });

  // 5) Os robôs de agenda e a posse de agente da 5040, em lote e depois por pessoa (falha de leitura fecha).
  const lote = liberados.slice(0, CONVITE_CONFERIDOS_POR_RODADA);
  const cedem = await cedeEmLote(lote.map(([k, s]) => ({ chave: k, ids: idsDoCardDaSessao(s) })), agoraMs);
  let motivo = 'nenhuma_elegivel';
  for (const [k, s] of lote) {
    if (cedem.has(k)) { motivo = 'robo_de_agenda_com_a_pessoa'; continue; }
    if (await cedeAAgente(s.telefone)) { motivo = 'posse_de_agente_5040'; continue; }

    // 6) A conversa: 24 h da última fala dela e nada depois (cliente, robô, equipe). Erro de leitura não envia.
    let conversa: MsgDaConversa[];
    let carimbos: number[];
    try {
      conversa = await lerConversaAteAgora(k, s.telefone, agoraMs);
      carimbos = (await lerCarimbosDela(k)).momentos;
    } catch (err) {
      logger.error(LOG, `convite: ler a conversa falhou (final ${s.telefone.slice(-2)})`, err);
      motivo = 'erro_leitura_conversa';
      continue;
    }
    if (equipeAssumiu(conversa, s.aberto_em)) {
      await equipeAssumiuNaConversa(k, s).catch(e => logger.error(LOG, 'convite: passar a conversa para a equipe falhou', e));
      motivo = 'equipe_assumiu';
      continue;
    }
    const decisao = avaliarConvite(s, conversa, agoraMs, carimbos);
    if (!decisao.ok) { motivo = decisao.motivo; continue; }

    // 7) Card por outra porta: a pessoa já tem reunião. A sessão fecha como `agendado`, sem mensagem.
    let card: number | null;
    try {
      card = await cardPorOutraPorta(s);
    } catch (err) {
      logger.error(LOG, 'convite: conferir o card falhou, ninguém recebe nesta rodada', err);
      return sem('erro_leitura_card', { candidatos: candidatos.length });
    }
    if (card !== null) {
      try { await fecharPorCardDeOutraPorta(k, card); } catch (err) {
        logger.error(LOG, 'convite: fechar a sessão por card falhou', err);
        return sem('erro_fechar_por_card', { candidatos: candidatos.length });
      }
      motivo = 'card_por_outra_porta';
      continue;
    }

    // 8) A sessão relida tem que ser a mesma, e o consultor dono do card tem que ter 2 horários livres (:00 e :30).
    try {
      if (!sessaoIgual(s, await relerSessao(k))) { motivo = 'sessao_mudou'; continue; }
    } catch (err) {
      logger.error(LOG, 'convite: reler a sessão falhou', err);
      return sem('erro_leitura_sessao', { candidatos: candidatos.length });
    }
    const compromissos = await carregarCompromissos(new Date(agoraMs).toISOString(), new Date(agoraMs + 22 * 86_400_000).toISOString());
    const livres = compromissos ? horariosDaOferta(s.consultor, compromissos, agoraMs, s.oferta ?? []) : [];
    if (livres.length < HORARIOS_DO_CONVITE) { motivo = compromissos ? 'sem_2_horarios_livres' : 'sem_leitura_da_agenda'; continue; }
    const dois = livres.slice(0, HORARIOS_DO_CONVITE);

    // 9) Pausa humana daquele telefone, conferida de novo na hora de falar.
    if (!(await podeFalarComLead(s.telefone)).pode) { await registrarBloqueio(s.telefone, LOG); motivo = 'humano_na_conversa'; continue; }

    // CLAIM: o insert do carimbo ANTES do envio. 23505 = já saiu (ou outra chamada o pegou): pula.
    const texto = textoDoConvite(k, s.consultor, dois[0]!, dois[1]!);
    const nowIso = new Date().toISOString();
    const keyC1 = chaveDoConvite(k);
    const { error: eClaim } = await supabase.from('system_state')
      .insert({ key: keyC1, value: { em: nowIso, convite: true, variante: texto.variante }, updated_at: nowIso });
    if (eClaim) {
      // 23505: já saiu (ou outra chamada o pegou). A rodada ACABA aqui, como a retomada: com `continue` o laço tentaria o próximo candidato com o
      // portão do frio lido antes, e sairiam 2 frios em segundos.
      if (String((eClaim as { code?: string }).code) === '23505') return sem('ja_reivindicado', { candidatos: candidatos.length });
      logger.error(LOG, 'convite: claim falhou', eClaim);
      return sem('erro_claim', { candidatos: candidatos.length });
    }
    const apagarC1 = (): Promise<void> => Promise.resolve(supabase.from('system_state').delete().eq('key', keyC1))
      .then(({ error }) => { if (error) logger.error(LOG, 'desfazer o carimbo da retomada do convite falhou', error); },
        (e: unknown) => logger.error(LOG, 'desfazer o carimbo da retomada do convite falhou', e));

    // ESTADO PRIMEIRO: a sessão vira `ofertou` com os 2 horários (no formato da oferta normal) ANTES de a mensagem sair.
    try {
      await gravarSessao(k, { ...s, estagio: 'ofertou', oferta: dois, ofertas_feitas: (s.ofertas_feitas ?? 0) + 1, convite_retomado_em: nowIso });
    } catch (err) {
      logger.error(LOG, 'convite: gravar a sessão falhou, nada sai', err);
      await restaurarSessao(k, s);
      await apagarC1();
      return sem('erro_gravar_sessao', { candidatos: candidatos.length });
    }

    const fim4 = s.telefone.slice(-4);
    try {
      const saiu = await sendFrio(s.telefone, [texto.texto], 'io');
      if (saiu === false) {
        // A pausa humana calou o envio (o zapiClient só cala por ela): NADA saiu. Desfaz a sessão e o carimbo. Não é erro de linha (como a retomada):
        // contá-lo pausaria a linha, e a pausa da 5040 segura a agenda da Duda.
        logger.warn(LOG, `convite calado pela trava da linha (final ${fim4}): nada saiu`);
        await restaurarSessao(k, s);
        await apagarC1();
        return sem('envio_calado_pela_linha', { candidatos: candidatos.length });
      }
    } catch (err) {
      const erro = String((err as Error)?.message || err).slice(0, 300);
      logger.error(LOG, `convite falhou para o final ${fim4}`, err);
      await restaurarSessao(k, s);
      await apagarC1();
      await contarErroDaLinha(new Date(), err);
      const erros = disjuntor.erros_seguidos + 1;
      await gravarDisjuntor({ erros_seguidos: erros, aberto: erros >= ERROS_ATE_ABRIR, ultimo_erro: erro });
      return sem('erro_envio', { erro, candidatos: candidatos.length });
    }
    await zerarErrosDaLinha(new Date());
    if (disjuntor.erros_seguidos > 0) await gravarDisjuntor({ erros_seguidos: 0, aberto: false });
    logger.info(LOG, `retomada do convite enviada (final ${fim4}, variante ${texto.variante})`);
    return { enviados: 1, para: `final ${fim4}`, candidatos: candidatos.length };
  }
  return sem(motivo, { candidatos: candidatos.length });
}

/** A ficha da conversa para quem passou por silêncio: a de sempre, com a linha do silêncio logo depois do título. */
function fichaDoSilencio(s: SessaoInvestidor): string {
  const ficha = montarFichaConsultor({
    nome: s.nome, telefone: s.telefone, tipo: tipoDaSessao(s.tipo), retorno: s.retorno,
    consultor: primeiroNomeDoConsultor(s.consultor), dados: s.dados, resumo: s.resumo,
  }).split('\n');
  ficha.splice(1, 0, TEXTO_DO_SILENCIO);
  return ficha.join('\n').slice(0, TETO_DA_FICHA);
}

/**
 * A PASSAGEM POR SILÊNCIO: a retomada do convite fez 48 h ou mais, a sessão segue ativa e ninguém escreveu depois (cliente, robô ou
 * equipe). `humano`, motivo `silencio_depois_do_convite`, nada para o cliente; o consultor dono do card recebe a ficha (trava
 * `pendente`, o envio é de `rodarAvisosDaHelenaEquipe`). Conversa que não dá para ler não muda de estado.
 */
export async function runInvestidorSilencioTick(opts: { agora?: Date } = {}): Promise<ResultadoSilencio> {
  const agoraMs = (opts.agora ?? new Date()).getTime();
  const res: ResultadoSilencio = { passadas: 0, equipe: 0, erros: 0 };
  const chave = await lerChaveDesligar();
  if (chave.off) return { ...res, motivo: `desligada_${chave.por}` };
  let sessoes: Map<string, SessaoInvestidor>;
  try {
    sessoes = await lerSessoes();
  } catch (err) {
    logger.error(LOG, 'silêncio: ler as sessões falhou', err);
    return { ...res, erros: 1, motivo: 'erro_leitura_sessoes' };
  }
  const vencidas = [...sessoes.entries()]
    .filter(([, s]) => !!s.telefone && silencioVencido(s, agoraMs))
    .sort((a, b) => String(a[1].convite_retomado_em).localeCompare(String(b[1].convite_retomado_em)))
    .slice(0, SILENCIOS_POR_RODADA);
  for (const [k, s] of vencidas) {
    try {
      const conversa = await lerConversaAteAgora(k, s.telefone, agoraMs);
      const carimbos = await lerCarimbosDela(k);
      if (equipeAssumiu(conversa, s.aberto_em)) {
        if (!sessaoIgual(s, await relerSessao(k))) continue;
        await equipeAssumiuNaConversa(k, s);
        res.equipe++;
        continue;
      }
      // ENVIO REAL: o carimbo c1 existe e a última fala dela casa com um carimbo dela, feita desde a retomada. As 48 h contam dessa fala.
      if (silencioDepoisDoConvite(s, conversa, agoraMs, carimbos.momentos, carimbos.c1) !== 'passar') continue;
      if (!sessaoIgual(s, await relerSessao(k))) continue;
      // A trava do aviso nasce ANTES do estado (falha fechada: sem ela a sessão não muda).
      const reserva = await reservarAvisoDaEquipe('silencio', { chave: k, consultor: s.consultor, texto: fichaDoSilencio(s) });
      if (reserva === 'erro') throw new Error('reservar o aviso da equipe falhou: o estado não muda');
      await gravarSessao(k, { ...s, estagio: 'humano', motivo: MOTIVO_SILENCIO });
      res.passadas++;
      logger.info(LOG, `silêncio depois do convite (final ${s.telefone.slice(-2)}): a sessão passou para a equipe`);
    } catch (err) {
      res.erros++;
      logger.error(LOG, `silêncio: a passagem falhou (final ${s.telefone.slice(-2)}): a sessão não muda`, err);
    }
  }
  return res;
}

// ═════════════════════════════════════════════════════════════════════════════
// A RODADA: o que a rota do cron chama.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Trava de chamada sobreposta. Um insert por balde de 5 minutos (UTC): quem
 * chega depois no mesmo balde leva 23505 e sai sem fazer nada. Cobre o cron da
 * Vercel disparando em dobro e uma chamada à mão caindo junto com ele.
 *
 * Sem conseguir gravar a trava, a rodada também não roda: na dúvida, não fala.
 */
export async function reivindicarRodada(agora: number = Date.now()): Promise<{ ok: boolean; motivo?: string }> {
  const balde = new Date(Math.floor(agora / BALDE_DO_LOCK_MS) * BALDE_DO_LOCK_MS).toISOString().slice(0, 16);
  const key = `${INV_LOCK_PREFIX}${balde}`;
  const em = new Date(agora).toISOString();
  const { error } = await supabase.from('system_state').insert({ key, value: { em }, updated_at: em });
  if (error) {
    if (String((error as { code?: string }).code) === '23505') return { ok: false, motivo: 'outra_chamada_no_mesmo_balde' };
    logger.error(LOG, 'gravar a trava da rodada falhou: rodada suspensa', error);
    return { ok: false, motivo: 'erro_na_trava' };
  }
  // As travas velhas não servem para nada: saem aqui, para a tabela não juntar 288 por dia.
  await supabase.from('system_state').delete().like('key', `${INV_LOCK_PREFIX}%`).lt('key', key)
    .then(undefined, () => {});
  return { ok: true };
}

/**
 * OS PEDIDOS PELO BANCO (12/11/2026): a sessão principal não tem o CRON_SECRET, então o que o `?dry=1` e o `?ligar=1`
 * fazem também se pede por uma chave em `system_state`. Lidos no começo da rodada, ANTES de checar se a agente está
 * desligada (a prévia e o ligar existem justamente para esse estado):
 *   · `inv_agente_previa_pedido`: roda a mesma prévia do `?dry=1` e grava `inv_agente_previa` (sem nome e sem telefone);
 *     nunca envia nada; o pedido é apagado;
 *   · `inv_agente_ligar_pedido`: faz o `?ligar=1` (apaga `inv_agente_off` e `inv_agente_disjuntor`, que rearma o
 *     disjuntor de erros de envio); o pedido é apagado.
 * O pedido sai ANTES de ser atendido, e só é atendido se saiu de verdade (o `error` do delete é conferido): se a
 * prévia falhar, o erro fica gravado no resultado e o pedido não repete; se o delete falhar, nada é feito.
 */
export async function atenderPedidosDoBanco(agora: Date = new Date()): Promise<{ previa?: 'gravada' | 'erro'; ligar?: 'ligada' | 'erro' }> {
  const out: { previa?: 'gravada' | 'erro'; ligar?: 'ligada' | 'erro' } = {};
  let chaves: Set<string>;
  try {
    const { data, error } = await supabase.from('system_state').select('key').in('key', [INV_PREVIA_PEDIDO_KEY, INV_LIGAR_PEDIDO_KEY]);
    if (error) throw error;
    chaves = new Set(((data ?? []) as Array<{ key: string }>).map(r => r.key));
  } catch (err) {
    logger.error(LOG, 'ler os pedidos pelo banco falhou', err);
    return out;
  }
  // Apaga o pedido ANTES de agir e CONFERE o `error` do supabase (ele não rejeita: devolve `{error}`). Só age se o
  // pedido saiu: pedido que não se apaga repetiria a ação a cada 5 min (o "ligar" apagaria `inv_agente_off` e o
  // disjuntor toda vez).
  const apagou = async (key: string): Promise<boolean> => {
    try {
      const { error } = await supabase.from('system_state').delete().eq('key', key);
      if (error) { logger.error(LOG, `apagar o pedido ${key} falhou: o pedido não foi atendido`, error); return false; }
      return true;
    } catch (e) {
      logger.error(LOG, `apagar o pedido ${key} falhou: o pedido não foi atendido`, e);
      return false;
    }
  };
  if (chaves.has(INV_PREVIA_PEDIDO_KEY) && await apagou(INV_PREVIA_PEDIDO_KEY)) {
    const em = new Date().toISOString();
    try {
      const previa = await previaInvestidorAgente({ agora });
      const { error } = await supabase.from('system_state')
        .upsert({ key: INV_PREVIA_KEY, value: { gerada_em: em, previa: previaParaGravar(previa) }, updated_at: em }, { onConflict: 'key' });
      if (error) throw error;
      out.previa = 'gravada';
    } catch (err) {
      logger.error(LOG, 'gravar a prévia pedida pelo banco falhou', err);
      await supabase.from('system_state')
        .upsert({ key: INV_PREVIA_KEY, value: { gerada_em: em, erro: String((err as Error)?.message || err).slice(0, 300) }, updated_at: em }, { onConflict: 'key' })
        .then(undefined, () => {});
      out.previa = 'erro';
    }
  }
  if (chaves.has(INV_LIGAR_PEDIDO_KEY) && await apagou(INV_LIGAR_PEDIDO_KEY)) {
    try { await definirChaveDesligar(false, 'pedido_pelo_banco'); out.ligar = 'ligada'; }
    catch (err) { logger.error(LOG, 'ligar pelo pedido do banco falhou', err); out.ligar = 'erro'; }
  }
  return out;
}

/**
 * Uma rodada: quem respondeu (até 3 conversas) e depois UM envio frio, abertura ou retomada,
 * que se ALTERNAM (parecer do chefe anti-ban): quem já saiu mais hoje cede a vez, para a retomada
 * não comer o dia da abertura. As respostas primeiro, porque quem escreveu está esperando; a
 * resposta atrasada (frio, com prioridade) gasta o envio frio desta rodada. Falha numa metade não
 * impede a outra de rodar os portões dela.
 */
/** Os avisos da Helena ao consultor (pendentes da marcação e resumo do dia): respeitam a chave de desligar e o disjuntor, como os outros envios dela. */
async function avisosDaEquipeNaRodada(): Promise<Record<string, unknown>> {
  const chave = await lerChaveDesligar();
  if (chave.off) return { pulou: `desligada_${chave.por}` };
  if ((await lerDisjuntor()).aberto) return { pulou: 'disjuntor_erros_de_envio' };
  return rodarAvisosDaEquipe(new Date());
}

/** Os dois avisos novos da Helena (silêncio e equipe assumiu): chave de desligar e disjuntor, como os outros envios dela. */
async function avisosDaHelenaNaRodada(): Promise<Record<string, unknown>> {
  const chave = await lerChaveDesligar();
  if (chave.off) return { pulou: `desligada_${chave.por}` };
  if ((await lerDisjuntor()).aberto) return { pulou: 'disjuntor_erros_de_envio' };
  return rodarAvisosDaHelenaEquipe(new Date());
}

export async function rodarInvestidorAgente(): Promise<Record<string, unknown>> {
  const pedidos = await atenderPedidosDoBanco().catch((e) => ({ erro: String(e) }));
  const vez = await reivindicarRodada();
  if (!vez.ok) return { ok: true, pulou: vez.motivo, ...(Object.keys(pedidos).length ? { pedidos } : {}) };
  // Só depois do claim da rodada: quem perde a corrida (outra chamada no mesmo balde) não zera o "1 aviso por rodada" de quem ganhou.
  iniciarRodadaDeAvisos();
  const respostas = await runInvestidorRespostasTick().catch((e) => ({ error: String(e) }));
  const recuperacao = await recuperarEscolhasPendentes().catch((e) => ({ reprocessadas: 0, erros: 1, error: String(e) }));
  const fecho = await fecharResgatesSemResposta().catch((e) => ({ fechadas: 0, erros: 1, error: String(e) }));
  const fechoRetomadas = await fecharRetomadasEsgotadas().catch((e) => ({ fechadas: 0, erros: 1, error: String(e) }));
  const preparos = await fecharPreparos().catch((e) => ({ fechados: 0, fichas: 0, erros: 1, error: String(e) }));
  const avisos: Record<string, unknown> = await avisosDaEquipeNaRodada().catch((e) => ({ erro: String(e) }));
  // Quem ficou calado 48 h depois da retomada do convite vai para a equipe, e os dois avisos novos (silêncio e equipe assumiu) saem
  // DEPOIS dos avisos que já existiam: a rodada tem 1 aviso só, e a marcação e o resumo passam na frente.
  const silencio = await runInvestidorSilencioTick().catch((e) => ({ passadas: 0, equipe: 0, erros: 1, motivo: String(e) } as ResultadoSilencio));
  const avisosHelena: Record<string, unknown> = await avisosDaHelenaNaRodada().catch((e) => ({ erro: String(e) }));

  // Um envio frio por rodada. A resposta atrasada que saiu como frio já o gastou.
  const frioDaResposta = 'frio' in respostas && Number((respostas as { frio?: number }).frio) > 0;
  let retomada: ResultadoRetomada = { enviados: 0, motivo: frioDaResposta ? 'resposta_fria_enviada' : undefined };
  let abertura: Record<string, unknown> = { enviados: 0, motivo: frioDaResposta ? 'resposta_fria_enviada' : undefined };
  // A ordem do frio: resposta atrasada, retomada do convite, retomadas (toques 2 a 5), abertura. Um envio só por rodada.
  let convite: ResultadoConvite = { enviados: 0, motivo: frioDaResposta ? 'resposta_fria_enviada' : undefined };
  if (!frioDaResposta) convite = await runInvestidorConviteTick().catch((e) => ({ enviados: 0, erro: String(e) } as ResultadoConvite));
  // Convite que falhou no envio (`erro`, `erro_envio`) GASTA a vaga: o c1 foi apagado e o espaçamento não enxerga a tentativa, e um 5xx pode ter
  // entregado. Nessa rodada não roda retomada nem abertura (senão sairiam 2 frios colados).
  const conviteFalhou = !!convite.erro || convite.motivo === 'erro_envio';
  if (convite.enviados || conviteFalhou) {
    const porque = convite.enviados ? 'convite_enviado' : 'convite_falhou_vaga_gasta';
    retomada = { enviados: 0, motivo: porque };
    abertura = { enviados: 0, motivo: porque };
  } else if (!frioDaResposta) {
    // Quem saiu menos hoje vai primeiro; empate, a retomada (que tem prazo vencendo).
    let abertoPrimeiro = false;
    try {
      const agora = new Date();
      const [feitasAberturas, feitasRetomadas] = await Promise.all([contarAberturasHoje(agora), contarRetomadasHoje(agora)]);
      abertoPrimeiro = feitasRetomadas > feitasAberturas;
    } catch { /* sem contagem: a ordem de sempre */ }
    const rodaRetomada = () => runInvestidorRetomadaTick().catch((e) => ({ enviados: 0, erro: String(e) } as ResultadoRetomada));
    const rodaAbertura = (): Promise<Record<string, unknown>> => runInvestidorAberturaTick().then(r => ({ ...r })).catch((e) => ({ enviados: 0, error: String(e) }));
    if (abertoPrimeiro) {
      abertura = await rodaAbertura();
      if (!abertura.enviados) retomada = await rodaRetomada();
      else retomada = { enviados: 0, motivo: 'abertura_enviada' };
    } else {
      retomada = await rodaRetomada();
      if (!retomada.enviados) abertura = await rodaAbertura();
      else abertura = { enviados: 0, motivo: 'retomada_enviada' };
    }
  }
  return {
    ok: true, respostas, abertura,
    ...(Object.keys(pedidos).length ? { pedidos } : {}),
    ...(convite.enviados || convite.erro || convite.motivo === 'erro_envio' ? { convite } : {}),
    ...(silencio.passadas || silencio.equipe || silencio.erros ? { silencio } : {}),
    ...(avisosHelena.tipo || avisosHelena.erro ? { avisos_helena: avisosHelena } : {}),
    ...(retomada.enviados || retomada.erro || retomada.motivo === 'erro_envio' ? { retomada } : {}),
    ...(recuperacao.reprocessadas || recuperacao.erros ? { recuperacao } : {}),
    ...(fecho.fechadas || fecho.erros ? { fecho } : {}),
    ...(fechoRetomadas.fechadas || fechoRetomadas.erros ? { fecho_retomadas: fechoRetomadas } : {}),
    ...(preparos.fechados || preparos.erros ? { preparos } : {}),
    ...(avisos.marcada || avisos.erro || (avisos.resumo as { enviados?: number } | undefined)?.enviados ? { avisos } : {}),
  };
}
