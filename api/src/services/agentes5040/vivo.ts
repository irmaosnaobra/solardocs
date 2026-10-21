// ─────────────────────────────────────────────────────────────────────────────
// A RODADA VIVA DAS AGENTES DA 5040 (Fase B, B1c-3). Roda de 2 em 2 minutos (cron próprio) e responde,
// DE VERDADE, só as conversas que têm posse viva de uma agente ligada e no escopo (agenteAtendeEste).
//
// Este arquivo NÃO importa o zapiClient. Só alcança o envio por dois lugares: vivoEnvio.ts (a fala ao lead,
// com todas as condições do chefe-antiban) e fichaEnvio.ts (a ficha ao consultor).
//
// Nesta fase só a Duda responde: helena_vivo e carla_vivo são ignorados aqui, como na porta (entrada.ts).
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
import {
  acharVaga, alvoDaAgenda, bolhaLigarAgoraOk, cardSolarDe, citaAHora, desfazerCardSolar, destinoDaRecusa, horariosPorExtenso, kwhDoLead,
  lerCardParaFicha, observacaoDoCardDaDuda, ofertaDeHorarios, primeiroNome, situacaoDoCard, type Oferta,
} from './acoesVivo';
import { bolhaDeConfirmacao, chaveFila, enfileirarAgenda, type TipoAgenda } from './agendaEnvio';
import { devolverBoasVindas, gravarCardSolar, marcarBoasVindasEnviada, remarcarCardSolar, reservarBoasVindas, silenciarLembretesDoCard } from './agendaSolar';
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
import type { CardResumo, ContextoLead, Persona, SaidaAgente } from './tipos';
import { enviarResposta, type ResultadoEnvio } from './vivoEnvio';
import type { DecisaoPorteiro } from './porteiro';
import { caminhoDaFicha } from '../agenda/solarRota';

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
  /** Volta honesta do "ligar agora": 5 min sem sinal da consultora; a bolha de agenda vale 30 min depois do aviso. */
  voltaHonestaMs: 5 * 60_000,
  voltaValidadeMs: 30 * 60_000,
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
  'passar_carla', 'passar_duda', 'passar_helena',
];

/**
 * As bolhas fixas depois da ficha. Não prometem horário nem ação: só dizem que a consultora vai falar.
 * Genérica: trava sem fala segura, bolha inválida, 10 respostas, 3ª falha de IA e as ações com ferramenta que não
 * são de agenda. Agenda: a IA pediu marcar ou remarcar. Cada uma cabe nos 160 caracteres e não tem travessão.
 */
export const BOLHA_PASSAGEM_GENERICA = 'Vou deixar a consultora cuidar daqui. Já mandei a nossa conversa toda pra ela, e ela te responde por aqui mesmo em breve.';
export const BOLHA_PASSAGEM_AGENDA = 'Pra acertar o horário, a consultora fala com você. Já mandei a nossa conversa pra ela, e ela te chama por aqui em breve.';
const ACOES_DE_AGENDA: readonly string[] = ['marcar_horario', 'remarcar_horario'];
/** As ações que a Duda executa de verdade na B1d-2c (o resto de ACOES_COM_FERRAMENTA segue virando ficha e passagem). */
const ACOES_DA_DUDA_COM_AGENDA: readonly string[] = ['marcar_horario', 'ligar_agora', 'suporte_giovanna'];
const bolhaDaPassagem = (acao?: string): string => (acao && ACOES_DE_AGENDA.includes(acao) ? BOLHA_PASSAGEM_AGENDA : BOLHA_PASSAGEM_GENERICA);

const MOTIVO_LEGIVEL: Record<string, string> = {
  prazo: 'o cliente esperou mais de 15 minutos sem resposta',
  limite_respostas: 'a conversa chegou ao limite de respostas da agente',
  falha_ia: 'a agente não conseguiu responder por falha técnica',
  trava: 'a agente não achou uma resposta segura para dar',
  pediu_humano: 'o cliente pediu para falar com uma pessoa',
};

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
    const g: G = { agora, agoraEnvio: () => opts.agora ?? new Date(), dry, inicio, r, cliente, estado, semModelo };

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
    if ((donas as readonly string[]).includes('duda') && r.parou !== 'erro_linha' && Date.now() - inicio <= LIMITES_VIVO.prazoEnvioMs) await varrerPendencias(g);
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
      if (!(await agenteAtendeEste('duda', tel))) { soma(ab.puladas, 'fora_do_escopo'); continue; }
      // Qualquer posse (a da Duda inclusive) = a conversa já é de alguém. O card que a própria Duda grava em acaoMarcar também é
      // lp_solar e nasce com boas_vindas_at nulo: é a posse que o tira daqui (a confirmação dele sai pelo tipo `confirma`).
      try {
        if (await lerPosse(chave)) { soma(ab.puladas, 'com_posse'); continue; }
      } catch { soma(ab.puladas, 'posse_ilegivel'); continue; }
      // A bolha vem ANTES de qualquer escrita: a que não cabe nos 160 nem sem nome e sem asteriscos deixa o card para o tick antigo.
      const quandoIso = new Date(quandoMs).toISOString();
      const bolha = bolhaDeAbertura(caminho, card.cliente_nome, quandoIso, consultora, agora.toISOString());
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
          nome: primeiroNome(card.cliente_nome),
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
  if (r.processadas >= LIMITES_VIVO.maxConversas) { soma(r.puladas, 'limite_de_conversas'); return 'seguir'; }

  const tel = await telefoneParaEnviar(chave, L.id);
  const base = { hmac8, wa_id: L.id, dona };
  const dec = (d: Partial<DecisaoVivo> & { resultado: string }): void => {
    r.decisoes.push({ ...base, acao: null, motivo: null, n_bolhas: 0, tamanho: 0, ...d });
  };

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
    const ctx: ContextoLead = { ...ctx0, anuncio: anuncio.anuncio, horariosLivres: horariosPorExtenso(oferta.vagas, ctx0.agora) };
    const pensar = (c: ContextoLead): Promise<ResultadoTurno> => pensarTurno({
      persona: dona as Persona, ctx: c, novas: entrada, dadosAnteriores: dadosAnt, abertura: false, cliente: g.cliente, cacheMidia,
    });

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
        await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: pens.motivo });
        return 'seguir';
      }
      const saida = pens.saida;
      const base2 = { acao: saida.acao, n_bolhas: saida.bolhas.length, tamanho: saida.bolhas.reduce((n, b) => n + b.length, 0) };

      // 9b. a Duda marca, remarca, liga agora e passa o suporte (B1d-2c)
      if (dona === 'duda' && ACOES_DA_DUDA_COM_AGENDA.includes(saida.acao)) {
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
      const peca = saida.peca && (saida.peca.tipo === 'link' || saida.peca.tipo === 'pix') && segunda
        ? { tipo: saida.peca.tipo, texto: segunda } : undefined;
      const naoIncomodar = saida.acao === 'nao_incomodar';

      // O estado nao_incomodar é gravado ANTES da despedida: se algo falhar daqui em diante, a conversa já está calada
      // (lado seguro). Em troca, uma despedida recusada pelo envio NÃO é tentada de novo: a pessoa pediu para parar.
      if (naoIncomodar && !dry) await atualizarPosse(chave, { estado: 'nao_incomodar', ate_wa_id: L.id });
      const res: ResultadoEnvio = await enviarResposta({
        dona, telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, ...(peca && !naoIncomodar ? { peca } : {}), dry,
      }, g.agoraEnvio());
      // O silêncio vem DEPOIS da despedida (o enviarResposta barraria uma fala a quem já está no opt-out).
      if (naoIncomodar && !dry) await silenciarContato(tel, 'opt_out', 'agentes5040-vivo');

      if (res.ok) {
        if (!dry) {
          if (!naoIncomodar) await atualizarPosse(chave, { ate_wa_id: L.id, respostas: posse.respostas + 1 });
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
          dec({ resultado: naoIncomodar ? 'despedida_sairia' : 'sairia', ...extra, motivo: null, sairia: [bolha, ...(peca && !naoIncomodar ? [peca.texto] : [])] });
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
          await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: `bolha_invalida:${res.detalhe ?? ''}` });
          return 'seguir';
        default:                                   // pausa_humana, bloqueado, mudo, robo_do_outro_lado
          if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
          await registrar(false, m);
          soma(r.puladas, `recusa_${m}`);
          dec({ resultado: 'recusada', ...extra });
          return 'seguir';
      }
    };

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
    `Conversa passada pela ${p.posse.dona === 'duda' ? 'Duda' : 'agente'}: ${base}`,
    ...(semCard ? ['Ainda sem card na agenda'] : []),
    ...(p.resumo ? [`Resumo: ${p.resumo}`] : []),
    ...Object.entries(p.dados ?? {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`),
  ];
  const linhas = fichaDeCampos(pseudo, extra).linhas.filter(l => !(semCard && l.startsWith('Conversa completa:')));
  return textoDaMensagem(blocoSeguro(linhas), p.tel, destinoDono);
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
  if (p.buscarCard) { try { card = (await lerCards(p.chave))[0] ?? null; } catch { card = null; } }
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

  if (dry) { dec({ resultado: 'passaria_ao_humano', ficha: 'ficharia', ...(p.bolha ? { sairia: [bolhaDaPassagem(p.acao)] } : {}) }); return; }

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
  const bolhaFixa = bolhaDaPassagem(p.acao);
  if (p.bolha && p.tel) {
    const res = await enviarResposta({
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
  if (situacao === 'remarcavel' && card) {
    cardId = card.id;
    if (Date.parse(String(card.quando ?? '')) !== Date.parse(iso)) {
      const rr = await remarcarCardSolar(card.id, iso, { faixa: alvo.faixa });
      if (rr === 'horario_tomado' || rr === 'horario_fora_da_grade') return A.refazer(AVISO_HORARIO);
      if (rr !== 'ok') return A.humano('ferramenta:marcar_horario', `remarcar:${rr}`);
      tipo = 'remarca';
      quandoAntes = card.quando;
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
      ? await enviarResposta({ dona: 'duda', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha: bolhaFinal, dry: false }, agoraE)
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
    if (tipo === 'remarca') {
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
    else await silenciarLembretesDoCard(cardId);
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
    // promessa nova sai: passa ao humano. Com ficha incerta a volta honesta cobre o silêncio (5 min depois, sem sinal).
    try {
      if (rf === 'incerta') await depoisDaFicha();
      await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id, ...(rf === 'incerta' ? { ligar } : {}) });
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
      ? await enviarResposta({ dona: 'duda', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, agoraE)
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
 * suporte_giovanna. Ficha completa à Giovanna (reserva ag5040_suporte:<hmac>:<waId>); só se ela saiu a bolha do turno
 * diz que a Giovanna fala com ele; a posse passa a humano e lead_data.suporte guarda o aviso (o reenvio ao dono vem depois).
 * Número de teste: a ficha vai ao dono, não à Giovanna.
 */
async function acaoSuporte(A: ContextoAcao): Promise<Seguir> {
  const { g, saida, ctx0, chave, tel, L, posse, hmac, dec } = A;
  const { r, dry } = g;
  const bolha = saida.bolhas[0] || BOLHA_PASSAGEM_GENERICA;
  if (dry) { dec({ resultado: 'passaria_ao_humano', ...A.base2, ficha: 'ficharia', sairia: [bolha] }); return 'seguir'; }

  let destino = telefoneDoDono();
  const ehTeste = await leadEhDeTeste(chave);
  let prefixoDono = ehTeste === null ? PREFIXO_ALVO_ILEGIVEL : PREFIXO_TESTE;
  if (ehTeste === false) {
    const t = await carregarTelefonesConsultores();
    const telGiovanna = telefoneDoConsultor(t.ok ? t.mapa : new Map(), 'Giovanna');
    destino = telGiovanna ?? telefoneDoDono();
    prefixoDono = telGiovanna ? '' : 'Sem telefone cadastrado para a Giovanna. Encaminhe esta ficha a ela.';
  }
  const card = ctx0.card;
  const cardFicha: CardDaFicha = card
    ? cardDaFichaDe(card)
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: ctx0.nome, cidade: null, observacao: null, created_by: 'lp_solar' };
  const ficha = await montarFicha(cardFicha, ctx0, { cliente: g.cliente });
  const extras = ['Conversa passada pela Duda: o cliente precisa de suporte (cliente do SolarDoc, reembolso, cobrança ou reclamação)', ...linhasDoModelo(saida)];
  const linhas = ficha.linhas.filter(l => !(!card && l.startsWith('Conversa completa:')));
  const iLink = linhas.findIndex(l => l.startsWith('Conversa completa:'));
  const comExtras = iLink >= 0 ? [...linhas.slice(0, iLink), ...extras, ...linhas.slice(iLink)] : [...linhas, ...extras];
  const texto = textoDaMensagem(
    blocoSeguro(comExtras), tel,
    ['SUPORTE: a Duda passou este cliente para a Giovanna.', prefixoDono].filter(Boolean).join(' '),
  );
  const rf = await enviarFichaVivo(g, { chave, acao: 'suporte', cardId: card?.id ?? 0, n: String(L.id), reserva: `ag5040_suporte:${hmac}:${L.id}`, destino, texto });
  if (rf === 'adiada') {
    await A.soltar();                      // nada saiu: a próxima rodada tenta de novo, dentro dos 15 min
    soma(r.puladas, 'ficha_adiada');
    dec({ resultado: 'ficha_adiada', ...A.base2, ficha: 'adiada' });
    return 'seguir';
  }
  if (rf !== 'enviada') {
    // Já avisada ou incerta: a Giovanna pode ter a ficha, e uma 2ª bolha prometeria o que não se confirmou. Sem bolha.
    await A.registrar(false, 'ferramenta:suporte_giovanna');
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id });
    dec({ resultado: 'passou_ao_humano', ...A.base2, ficha: rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou' });
    return 'seguir';
  }
  let parar: 'erro_linha' | 'espacamento' | null = null;
  const avisadoEm = g.agoraEnvio().toISOString();
  try {
    const res = await enviarResposta({ dona: 'duda', telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, dry: false }, g.agoraEnvio());
    await atualizarPosse(chave, {
      estado: 'passou_humano', ate_wa_id: L.id, ...(res.ok ? { respostas: posse.respostas + 1 } : {}),
      suporte: { avisado_em: avisadoEm, wa_id: L.id, resumo: String(saida.resumo ?? '').slice(0, 200) },
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
    await atualizarPosse(chave, { estado: 'passou_humano', ate_wa_id: L.id });
  }
  if (parar) { r.parou = parar; return 'parar'; }
  return 'seguir';
}

// ── pendências de tempo: a volta honesta e o reenvio do suporte ──────────────

interface PosseComPendencia { chave: string; posse: DadosPosse }

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
 * Esta posse tem pendência para tratar AGORA? Fora ficam as resolvidas e as que ainda esperam (volta antes dos 5 min, suporte
 * antes dos 10, ficha "remarcado" dentro da espera crescente), para não ocuparem as vagas da rodada. A vencida (volta passada
 * da validade, horário do card que passou) FICA: um passo a resolve e libera a vaga.
 */
export function pendenciaDevida(posse: DadosPosse, agoraMs: number): boolean {
  const lig = posse.ligar as { avisado_em?: string; volta_em?: string; resolvido_em?: string } | undefined;
  if (lig && !lig.volta_em && !lig.resolvido_em) {
    const t = Date.parse(String(lig.avisado_em ?? ''));
    if (Number.isFinite(t) && agoraMs - t >= LIMITES_VIVO.voltaHonestaMs) return true;
  }
  const sup = posse.suporte as { avisado_em?: string; dono_em?: string; resolvido_em?: string } | undefined;
  if (sup && !sup.dono_em && !sup.resolvido_em) {
    const t = Date.parse(String(sup.avisado_em ?? ''));
    if (Number.isFinite(t) && agoraMs - t >= LIMITES_VIVO.suporteDonoMs) return true;
  }
  const rem = posse.remarcado as RemarcadoPendente | undefined;
  if (rem && !(rem as { resolvido_em?: string }).resolvido_em && remarcadoDevida(rem, agoraMs)) return true;
  return false;
}

/** As posses da Duda com volta, suporte ou ficha "remarcado" pendente (lidas por tipo e janela, filtradas aqui: o corte de 1000 linhas e o .or). */
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
      if (!o || typeof o !== 'object' || o.dona !== 'duda') continue;
      const ligar = o.ligar && typeof o.ligar === 'object' ? o.ligar : null;
      const suporte = o.suporte && typeof o.suporte === 'object' ? o.suporte : null;
      const remarcado = o.remarcado && typeof o.remarcado === 'object' ? o.remarcado : null;
      const volta = ligar && !ligar.volta_em && !ligar.resolvido_em;
      const reenvio = suporte && !suporte.dono_em && !suporte.resolvido_em;
      const fichaRemarcada = remarcado && !remarcado.resolvido_em;
      if (!volta && !reenvio && !fichaRemarcada) continue;
      if (!ESTADOS_DA_POSSE.includes(String(o.estado))) continue;
      achadas.push({ chave: l.phone, posse: { ...o, dona: 'duda', estado: o.estado, desde: String(o.desde ?? ''), ate_wa_id: typeof o.ate_wa_id === 'number' ? o.ate_wa_id : null,
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
  const devidas = lista.filter(p => pendenciaDevida(p.posse, g.agora.getTime()));
  if (!devidas.length) return;
  const cont = (r.pendencias ??= { voltas: 0, reenvios: 0, olhadas: 0 });
  for (const p of devidas.slice(0, LIMITES_VIVO.pendenciasPorRodada)) {
    if (Date.now() - g.inicio > LIMITES_VIVO.prazoEnvioMs) { r.parou ??= 'prazo'; return; }
    cont.olhadas++;
    try {
      if (p.posse.ligar && !(p.posse.ligar as any).volta_em && !(p.posse.ligar as any).resolvido_em) {
        if (await voltaHonesta(g, p)) cont.voltas++;
      }
      if (p.posse.suporte && !(p.posse.suporte as any).dono_em && !(p.posse.suporte as any).resolvido_em) {
        if (await reenvioSuporte(g, p)) cont.reenvios++;
      }
      if (p.posse.remarcado && !(p.posse.remarcado as any).resolvido_em) {
        await retentarFichaRemarcada(g, p);
      }
    } catch (err) {
      logger.error(LOG, `pendência de uma posse falhou (${codigoDe(err)})`);
    }
  }
  void dry;
}

/**
 * Volta honesta do "ligar agora": 5 min depois do aviso, sem sinal da consultora, 1 bolha de agenda (duda_agenda_5040,
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

  const { data: card, error } = await supabaseGerador.from('agendamentos').select('status, cliente_telefone').eq('id', cardId).maybeSingle();
  if (error) return false;
  if (!card) { if (!dry) await marcar({ resolvido_em: agora.toISOString() }); return false; }
  const statusAgora = String((card as { status?: string | null }).status ?? '').trim().toLowerCase();
  let sinal = statusAgora !== String(lig.status_inicial ?? 'agendado').trim().toLowerCase();

  if (!sinal) {
    const conv = await lerConversa(p.chave);
    if (!conv.completa) return false;
    sinal = equipeFalouDepois(conv.msgs, avisadoMs);
  }
  if (!sinal) {
    const tc = await carregarTelefonesConsultores();
    const telCons = telefoneDoConsultor(tc.ok ? tc.mapa : new Map(), lig.dono);
    const chaveCons = telCons ? chaveContato(telCons) : null;
    if (chaveCons) {
      const dela = await lerConversa(chaveCons);
      if (!dela.completa) return false;
      sinal = dela.msgs.some(m => m.autor === 'lead' && Date.parse(m.momment) > avisadoMs);   // ela escreveu para a 5040
    }
  }
  if (sinal) {
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
    tipo: 'volta', cardId, telefone: String((card as { cliente_telefone?: string | null }).cliente_telefone ?? ''), quando: new Date(avisadoMs).toISOString(),
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
async function reenvioSuporte(g: G, p: PosseComPendencia): Promise<boolean> {
  const { dry, agora } = g;
  const sup = p.posse.suporte as { avisado_em: string; wa_id: number; resumo?: string };
  const avisadoMs = Date.parse(String(sup.avisado_em ?? ''));
  const waId = Number(sup.wa_id);
  if (!Number.isFinite(avisadoMs) || !Number.isInteger(waId) || waId <= 0) return false;
  if (agora.getTime() - avisadoMs < LIMITES_VIVO.suporteDonoMs) return false;
  const hmac = hmacDe(p.chave);
  if (!hmac) return false;
  const marcar = async (extra: Record<string, unknown>): Promise<void> => { await atualizarPosse(p.chave, { suporte: { ...sup, ...extra } }); };
  if (p.posse.estado === 'nao_incomodar' || p.posse.estado === 'encerrada') {
    if (!dry) await marcar({ resolvido_em: agora.toISOString() });
    g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: waId, dona: 'duda', acao: null, resultado: 'suporte_dispensado', motivo: p.posse.estado, n_bolhas: 0, tamanho: 0 });
    return false;
  }

  const conv = await lerConversa(p.chave);
  if (!conv.completa) return false;
  if (equipeFalouDepois(conv.msgs, avisadoMs)) {
    if (!dry) await marcar({ resolvido_em: agora.toISOString() });
    g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: waId, dona: 'duda', acao: null, resultado: 'suporte_atendido', motivo: null, n_bolhas: 0, tamanho: 0 });
    return false;
  }
  if (dry) { g.r.decisoes.push({ hmac8: hmac.slice(0, 8), wa_id: waId, dona: 'duda', acao: null, resultado: 'suporte_reenviaria', motivo: null, n_bolhas: 0, tamanho: 0 }); return false; }
  const tel = await telefoneParaEnviar(p.chave, waId);
  let card: CardResumo | null = null;
  try { card = (await lerCards(p.chave))[0] ?? null; } catch { card = null; }
  const cardFicha: CardDaFicha = card
    ? cardDaFichaDe(card)
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: null, cidade: null, observacao: null, created_by: 'lp_solar' };
  const extras = [
    'Conversa passada pela Duda: o cliente precisa de suporte (cliente do SolarDoc, reembolso, cobrança ou reclamação)',
    ...(sup.resumo ? [`Resumo: ${sup.resumo}`] : []),
  ];
  const linhas = fichaDeCampos(cardFicha, extras).linhas.filter(l => !(!card && l.startsWith('Conversa completa:')));
  const texto = textoDaMensagem(
    blocoSeguro(linhas), tel,
    'REENVIO: a Giovanna ainda não falou com este cliente depois de 10 minutos. Atenda ou encaminhe.',
  );
  const rf = await enviarFichaVivo(g, {
    chave: p.chave, acao: 'suporte_dono', cardId: card?.id ?? 0, n: String(waId), reserva: `ag5040_suporte_dono:${hmac}:${waId}`, destino: telefoneDoDono(), texto,
  });
  g.r.decisoes.push({
    hmac8: hmac.slice(0, 8), wa_id: waId, dona: 'duda', acao: null, resultado: 'suporte_reenviado_ao_dono', motivo: rf, n_bolhas: 0, tamanho: 0,
    ficha: rf === 'enviada' ? 'enviada' : rf === 'adiada' ? 'adiada' : rf === 'ja_avisada' ? 'lead_ja_avisado' : 'falhou',
  });
  if (rf === 'adiada') return false;                                // nada saiu: tenta na próxima rodada
  await marcar({ dono_em: agora.toISOString(), dono: rf });
  return rf === 'enviada';
}
