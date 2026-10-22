// ─────────────────────────────────────────────────────────────────────────────
// O ROBÔ DE AGENDA DA DUDA (B1d-2a). Terceiro e ÚLTIMO arquivo da pasta agentes5040/ que importa o zapiClient
// (os outros são fichaEnvio.ts e vivoEnvio.ts). Quem ENFILEIRA é o vivo.ts; quem ENTREGA é a rota
// /cron/agentes-5040/agenda (runAgendaTick, relógio próprio de 2 em 2 minutos, independente de qualquer *_vivo ligado).
//
// Robô `duda_agenda_5040` (transacional_agenda_p3, agenda: true, P3 subprioridade 1, janela transacional,
// respeitaPausa, podeTerPrazo, 1 bolha FIXA de até 160, pela instância 'io'). É o que fala quando a bolha do
// turno (P1) não pôde sair: a confirmação do horário marcado ou remarcado, e a volta honesta do "ligar agora".
//
// Regra do dono "agenda nunca bloqueia" (memória agenda-nunca-bloqueia.md): este robô NÃO é segurado pelo teto
// das agentes (20/1h e 120/24h), pelo teto de emergência da linha (60/450) nem pelo prazo de 15 min. O carimbo
// dele (ag5040_agenda_sent:<cardId>:<tipo>:<iso>) conta nesses tetos, porque está em PREFIXOS_AGENDA e em BOT_SENT_PREFIXES.
// Só param este robô: pausa humana (mantém na fila; se já passou do validoAte, descarta), linha caída (mantém na
// fila para a volta), chave repetida (o carimbo já existe), opt-out/denúncia/bloqueio, card cancelado ou mudado, sem
// telefone ou com número trocado, o horário que já passou, e o espaçamento contra QUALQUER envio da linha: 25 s mais um sorteio de
// 0 a 35 s (a rajada de bolhas de confirmação, uma colada na outra, é assinatura de robô), ou só 10 s no ÚLTIMO MOMENTO ÚTIL (validoAte
// em menos de 30 min). A fila sai na ordem do validoAte (o que vence antes sai antes) e nunca é segurada por teto.
// O prazo (validoAte) NÃO descarta: no fim útil o item sai, só com os 10 s.
//
// A FILA mora em system_state: ag5040_agenda_fila:<cardId>:<tipo>:<iso compacto>. O value NÃO leva telefone: leva o HMAC
// dele (para saber se o card mudou de número) e o cardId. Na hora de enviar, o telefone é lido do card em `agendamentos`.
// O item guarda o ISO do horário (quando), NUNCA o texto pronto: "hoje", "amanhã", o dia e a hora são montados NO ENVIO
// (Brasília), e o card é relido: horário diferente do pedido ou já passado = descarta. O ISO entra na chave da fila e do
// carimbo (ag5040_agenda_sent:<cardId>:<tipo>:<iso>), então a 2ª remarcação não colide com a 1ª.
// A fila só é entregue das 7h às 21h (Brasília), a janela do transacional. O carimbo e o log nunca levam telefone.
//
// O tipo `abertura` (21/10/2026) é a confirmação do horário que o cliente escolheu no quiz solar, enfileirada pela rodada viva
// (vivo.ts, abrirCardsDoQuiz) logo depois que o card nasce. Mesmas regras dos outros tipos: agenda de verdade, nenhum teto a segura,
// quando = o horário do card, e card mudado ou horário passado descarta. O item leva também o caminho (ligacao, video, vistoria)
// e o primeiro nome do cliente (nunca o telefone). Quem reserva boas_vindas_at é o vivo; aqui, depois que sai, nada é carimbado.
// Abertura DESCARTADA na hora do envio (opt-out, pausa vencida, card mudado, cancelado ou com status que não recebe, horário passado,
// número inválido) grava solar_bv_dedup:<cardId>: é o marcador que o alarme de reservas sem envio do solarBoasVindas já aceita (não entra
// em nenhum teto). NUNCA com o prefixo do carimbo da agenda, que conta nos tetos e diria "enviado".
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman, linhaEmCooldown } from '../agents/zapiClient';
import { podeFalarComLead } from '../agents/whatsapp/pausaHumana';
import { chaveContato, estaBloqueado, motivosDaSupressao } from '../agents/whatsapp/silenciar';
import { prefixosDaLinha, PREFIXOS_AGENDA } from '../agents/whatsapp/lineThrottle';
import { hmacDe, idChaveHmac } from './hmac';
import { codigoDoErroDeEnvio, erroEhDoDestino, CHAVE_LINHA_PAUSA, CHAVE_LINHA_ERROS, PREFIXO_FICHA, LIMITES as LIMITES_VIVO } from './vivoEnvio';
import { erroProvaQueNaoSaiu } from './fichaEnvio';
import { marcarBoasVindasEnviada } from './agendaSolar';
import { horaBRT } from './relogio';
import { STATUS_QUE_NAO_RECEBEM, SOLAR_BV_DEDUP_PREFIX } from '../agenda/solarStatus';
import { camposDeHorario, opcaoPorExtenso, primeiroNome, textoDeAbertura, CAMINHOS_ABERTURA } from './textosAgenda';
import { fraseDeApresentacao } from './avisoIA';
import { atualizarPosse, lerPosse } from './posse';

const LOG = 'agenda-envio-5040';

export type TipoAgenda = 'confirma' | 'remarca' | 'volta' | 'abertura';

export interface CamposAgenda {
  /** hoje | amanhã | "quinta, 23/10". */
  dia: string;
  /** "14h30". */
  hora: string;
  /** Primeiro nome da consultora. */
  consultora: string;
  /** "amanhã às 9h" (só o tipo volta). */
  opcao1?: string;
  opcao2?: string;
  /** Só a abertura: ligacao | video | vistoria, o primeiro nome do cliente e o horário por extenso ("amanhã às 14h30"). */
  caminho?: string;
  nome?: string;
  quando?: string;
}

export interface PedidoAgenda {
  tipo: TipoAgenda;
  cardId: number;
  /** Só serve para guardar o HMAC (confere se o card mudou de número). Nunca é gravado. */
  telefone: string;
  /**
   * ISO. confirma e remarca: o horário da ligação (o item morre quando ele passa ou quando o card muda de horário).
   * volta: o instante do aviso do "ligar agora" (o item morre 2 h depois). Entra na chave da fila e do carimbo.
   */
  quando: string;
  /** ISO. Pausa humana ainda ativa depois disso = descarta. NÃO descarta por tempo quando a pausa não existe. */
  validoAte: string;
  /** Primeiro nome da consultora. */
  consultora: string;
  /** Só a volta: as duas vagas oferecidas (ISO). O texto ("amanhã às 9h") é montado no envio. */
  opcoes?: [string, string];
  /** Reenvio de quem pode ter chegado (5xx ou timeout na bolha do turno): sai "Só reforçando: ...". */
  reforco?: boolean;
  /** Só a abertura: ligacao | video | vistoria (o mesmo que o solarBoasVindas descobre pela observação do card). */
  caminho?: string;
  /** Só a abertura: o primeiro nome do cliente. Vazio = a bolha sai sem nome. */
  nome?: string;
}

export const PREFIXO_FILA = 'ag5040_agenda_fila:';
export const PREFIXO_CARIMBO_AGENDA = 'ag5040_agenda_sent:';
export const PREFIXO_CARIMBO_AGENTES = 'ag5040_sent:';
export const CHAVE_TRAVA_AGENDA = 'ag5040_agenda_trava';

export const LIMITES_AGENDA = Object.freeze({
  /**
   * Quantos envios a chamada faz. O cron é de 2 em 2 minutos e a função vive 300 s: cada envio espera até 25 + 35 = 60 s,
   * então 3 envios cabem em ~180 s + digitação, e o orcamentoMs abaixo corta a chamada antes de passar disso.
   */
  porChamada: 3,
  /** Espaçamento padrão contra o último envio da linha (qualquer robô), mais um sorteio de 0 a sorteioMs. */
  espacamentoMs: 25_000,
  sorteioMs: 35_000,
  /** No último momento útil (validoAte em menos de ultimoMomentoMs) vale só este espaçamento, sem sorteio. */
  espacamentoUrgenteMs: 10_000,
  ultimoMomentoMs: 30 * 60_000,
  /** Soma máxima das esperas de espaçamento de uma chamada: o item que passaria disto fica na fila para a próxima (nada é perdido). */
  orcamentoMs: 150_000,
  maxCaracteresBolha: 160,
  /** Quantos itens da fila a chamada olha (os mantidos na fila não podem esconder os outros). */
  leituraDaFila: 200,
  /** A volta honesta morre 2 h depois do aviso do "ligar agora". */
  voltaVidaMs: 2 * 3_600_000,
  /** A fila só é entregue das 7h às 21h (Brasília). */
  entregaDe: 7,
  entregaAte: 21,
  /** Validade da trava da rodada da fila. A rodada dura até ~orcamentoMs + envios (~3 min); abaixo dos 300 s da função. */
  travaMs: 240_000,
});

/** Espera para completar o espaçamento (<= espacamentoMs + sorteioMs) e o sorteio dele. Os testes trocam os dois. */
export const TEMPOS_AGENDA = {
  esperar: (ms: number): Promise<void> => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve()),
  /** Inteiro de 0 a maxMs. */
  sorteio: (maxMs: number): number => Math.floor(Math.random() * (maxMs + 1)),
};

/** 2026-10-23T17:30:00.000Z (ou +00:00) vira 20261023T173000Z: a mesma chave para o mesmo instante. */
export const isoCompacto = (iso: string): string => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '') : 'invalido';
};
export const chaveFila = (cardId: number, tipo: TipoAgenda, quando: string): string => `${PREFIXO_FILA}${cardId}:${tipo}:${isoCompacto(quando)}`;
export const chaveCarimboAgenda = (cardId: number, tipo: TipoAgenda, quando: string): string => `${PREFIXO_CARIMBO_AGENDA}${cardId}:${tipo}:${isoCompacto(quando)}`;

const TIPOS: readonly TipoAgenda[] = ['confirma', 'remarca', 'volta', 'abertura'];
const TRAVESSAO = /[—–]/;
const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);
const texto = (v: unknown): string => String(v ?? '').trim();

// ── as bolhas fixas (redator, 21/10) ─────────────────────────────────────────

/**
 * A bolha FIXA do tipo, com as chaves preenchidas. null = campo faltando, bolha vazia, com travessão, com
 * separador de bolhas ou acima de 160 (quem chama descarta o item: um texto que nunca passa não pode travar a fila).
 *
 * `comAviso` (22/10/2026, aviso de IA): confirma, remarca e volta saem com "Aqui é a Duda, do atendimento com IA da Irmãos na Obra."
 * na frente. Não cabe nos 160: tenta a versão curta do texto (sem o nome da consultora) e, por último, só a frase mais o horário
 * ("Ficou marcado para {dia} às {hora}."). A abertura já traz o aviso e ignora este parâmetro.
 */
export function montarBolhaAgenda(tipo: TipoAgenda, campos: Partial<CamposAgenda> | null | undefined, reforco = false, comAviso = false): string | null {
  const c = campos ?? {};
  const dia = texto(c.dia), hora = texto(c.hora), consultora = texto(c.consultora);
  const opcao1 = texto(c.opcao1), opcao2 = texto(c.opcao2);
  let bolha: string;
  // Do mais completo ao mais curto; sem aviso vale só o primeiro.
  let degraus: string[];
  if ((tipo === 'confirma' || tipo === 'remarca') && reforco) {
    // Reenvio único depois de um erro 5xx/timeout: lembrete atrasado, o mesmo texto para os dois tipos.
    if (!dia || !hora || !consultora) return null;
    bolha = `Só reforçando: a sua ligação ficou para ${dia} às ${hora}, com a ${consultora}.`;
    degraus = [bolha, `Só reforçando: a sua ligação ficou para ${dia} às ${hora}.`, `Ficou marcado para ${dia} às ${hora}.`];
  } else if (tipo === 'confirma') {
    if (!dia || !hora || !consultora) return null;
    bolha = `Ficou marcado para ${dia} às ${hora}. A ${consultora} te liga nesse horário.`;
    degraus = [bolha, `Ficou marcado para ${dia} às ${hora}. Te ligamos nesse horário.`, `Ficou marcado para ${dia} às ${hora}.`];
  } else if (tipo === 'remarca') {
    if (!dia || !hora || !consultora) return null;
    bolha = `Pronto, mudei sua ligação para ${dia} às ${hora}. Quem liga é a ${consultora}.`;
    degraus = [bolha, `Pronto, mudei sua ligação para ${dia} às ${hora}.`, `Ficou marcado para ${dia} às ${hora}.`];
  } else if (tipo === 'volta') {
    if (!opcao1 || !opcao2) return null;
    bolha = `Consigo deixar a ligação marcada pra você: ${opcao1} ou ${opcao2}. Qual fica melhor?`;
    degraus = [bolha, `Posso ligar ${opcao1} ou ${opcao2}? Qual fica melhor?`];
  } else if (tipo === 'abertura') {
    // A abertura do card do quiz (textosAgenda.ts): ignora o reforço (o reenvio sai com o mesmo texto) e já se corta sozinha em 160.
    const t = textoDeAbertura(c.caminho, c.nome, texto(c.quando), consultora);
    if (!t) return null;
    bolha = t;
    degraus = [bolha];
  } else return null;
  const serve = (b: string): boolean => !TRAVESSAO.test(b) && !b.includes('||') && b.length <= LIMITES_AGENDA.maxCaracteresBolha;
  if (comAviso && tipo !== 'abertura') {
    const frase = fraseDeApresentacao('duda');
    for (const d of degraus) { const b = `${frase} ${d}`; if (serve(b)) return b; }
    return null;
  }
  return serve(bolha) ? bolha : null;
}

/** Os campos do texto, montados AGORA (Brasília) a partir dos ISOs do item. */
function camposNoEnvio(
  tipo: TipoAgenda, quando: string, consultora: string, opcoes: readonly string[] | undefined, agoraIso: string,
  abertura?: { caminho?: string; nome?: string },
): Partial<CamposAgenda> {
  if (tipo === 'abertura') {
    return { consultora: primeiroNome(consultora), caminho: abertura?.caminho ?? '', nome: abertura?.nome ?? '', quando: opcaoPorExtenso(quando, agoraIso) };
  }
  if (tipo === 'volta') {
    return {
      consultora: primeiroNome(consultora),
      opcao1: opcoes?.[0] ? opcaoPorExtenso(opcoes[0], agoraIso) : '',
      opcao2: opcoes?.[1] ? opcaoPorExtenso(opcoes[1], agoraIso) : '',
    };
  }
  return camposDeHorario(quando, agoraIso, consultora);
}

/** A bolha fixa de confirma ou remarca para este horário, montada agora (a vivo.ts a usa quando a fala do modelo não cita a hora). */
export function bolhaDeConfirmacao(tipo: 'confirma' | 'remarca', quando: string, consultora: string, agoraIso: string): string | null {
  return montarBolhaAgenda(tipo, camposNoEnvio(tipo, quando, consultora, undefined, agoraIso));
}

// ── a fila ───────────────────────────────────────────────────────────────────

interface ItemDaFila {
  tipo: TipoAgenda;
  card_id: number;
  /** ISO do horário (confirma, remarca) ou do aviso (volta). */
  quando: string;
  /** Depois disto o item não sai mais: o horário passou (confirma, remarca) ou o aviso tem mais de 2 h (volta). */
  descarta_em: string;
  consultora: string;
  opcoes?: [string, string];
  reforco?: boolean;
  caminho?: string;
  nome?: string;
  /** HMAC do telefone (chaveContato) e o id da chave que o gerou; null sem segredo. */
  tel_hmac: string | null;
  hmac_id: string | null;
  valido_ate: string;
  em: string;
}

export type ResultadoEnfileirar =
  | { ok: true; chave: string }
  | { ok: false; motivo: 'pedido_invalido' | 'bolha_invalida' | 'ja_enviado' | 'erro' };

/**
 * Põe 1 bolha fixa na fila. Pedido repetido da mesma chave antes de sair troca o conteúdo (vale o mais novo);
 * depois de sair (o carimbo existe), recusa. O value da fila nunca leva o telefone nem o texto pronto.
 */
export async function enfileirarAgenda(p: PedidoAgenda, agora: Date = new Date()): Promise<ResultadoEnfileirar> {
  const cardId = Number(p?.cardId);
  if (!TIPOS.includes(p?.tipo) || !Number.isInteger(cardId) || cardId <= 0) return { ok: false, motivo: 'pedido_invalido' };
  if (!Number.isFinite(Date.parse(String(p.validoAte ?? ''))) || !Number.isFinite(Date.parse(String(p.quando ?? '')))) return { ok: false, motivo: 'pedido_invalido' };
  const opcoes = p.tipo === 'volta' && Array.isArray(p.opcoes) && p.opcoes.length >= 2 && p.opcoes.slice(0, 2).every(o => Number.isFinite(Date.parse(String(o))))
    ? [new Date(Date.parse(p.opcoes[0]!)).toISOString(), new Date(Date.parse(p.opcoes[1]!)).toISOString()] as [string, string]
    : undefined;
  if (p.tipo === 'volta' && !opcoes) return { ok: false, motivo: 'pedido_invalido' };
  if (p.tipo === 'abertura' && !CAMINHOS_ABERTURA.includes(String(p.caminho))) return { ok: false, motivo: 'pedido_invalido' };
  const quando = new Date(Date.parse(p.quando)).toISOString();
  const consultora = primeiroNome(p.consultora);
  const nome = p.tipo === 'abertura' ? primeiroNome(p.nome) : '';
  const abertura = p.tipo === 'abertura' ? { caminho: p.caminho, nome } : undefined;
  if (!montarBolhaAgenda(p.tipo, camposNoEnvio(p.tipo, quando, consultora, opcoes, agora.toISOString(), abertura), p.reforco === true)) return { ok: false, motivo: 'bolha_invalida' };
  const chave = chaveFila(cardId, p.tipo, quando);
  try {
    const { data: saiu, error: erroLeitura } = await supabase.from('system_state').select('key').eq('key', chaveCarimboAgenda(cardId, p.tipo, quando)).maybeSingle();
    if (erroLeitura) { logger.error(LOG, `leitura do carimbo falhou (${codigoDe(erroLeitura)})`); return { ok: false, motivo: 'erro' }; }
    if (saiu) return { ok: false, motivo: 'ja_enviado' };
    const ck = chaveContato(p.telefone);
    const item: ItemDaFila = {
      tipo: p.tipo, card_id: cardId, quando,
      descarta_em: new Date(p.tipo === 'volta' ? Date.parse(quando) + LIMITES_AGENDA.voltaVidaMs : Date.parse(quando)).toISOString(),
      consultora,
      ...(opcoes ? { opcoes } : {}),
      ...(p.reforco === true ? { reforco: true } : {}),
      ...(p.tipo === 'abertura' ? { caminho: String(p.caminho), ...(nome ? { nome } : {}) } : {}),
      tel_hmac: ck ? hmacDe(ck) : null, hmac_id: ck ? idChaveHmac() : null,
      valido_ate: new Date(Date.parse(p.validoAte)).toISOString(),
      em: agora.toISOString(),
    };
    const { error } = await supabase.from('system_state').upsert({ key: chave, value: item, updated_at: agora.toISOString() }, { onConflict: 'key' });
    if (error) { logger.error(LOG, `não enfileirei (${codigoDe(error)})`); return { ok: false, motivo: 'erro' }; }
    return { ok: true, chave };
  } catch (err) {
    logger.error(LOG, `enfileirar falhou (${codigoDe(err)})`);
    return { ok: false, motivo: 'erro' };
  }
}

// ── o envio ──────────────────────────────────────────────────────────────────

export interface ResultadoAgenda {
  /** Bolhas que saíram nesta chamada (no dry: as que sairiam). */
  enviadas: number;
  /** Tirados da fila sem enviar (já enviado, card sumido, cancelado ou mudado, horário passado, número trocado, bolha inválida, opt-out, pausa vencida...). */
  descartadas: number;
  /** Ficaram na fila (pausa humana, linha caída, leitura que falhou, erro de envio que permite reenvio). */
  mantidas: number;
  /** Por que a chamada parou antes do fim da fila, se parou. */
  parou?: 'linha_pausada' | 'leitura_falhou' | 'erro_de_envio' | 'limite' | 'fora_da_janela' | 'tempo';
}

type Linha = { key: string; value: any; updated_at: string };

/** A linha pausada pelos erros seguidos (ag5040_linha_pausa) ou em cooldown na memória? Relida antes de CADA envio. */
async function linhaCaida(agora: number): Promise<'sim' | 'nao' | 'erro'> {
  if (linhaEmCooldown('io')) return 'sim';
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
  if (error) { logger.error(LOG, `leitura da pausa da linha falhou (${codigoDe(error)})`); return 'erro'; }
  const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
  return Number.isFinite(ate) && ate > agora ? 'sim' : 'nao';
}

/** Tudo que a linha conta: o prefixosDaLinha() do HEAD, a agenda, as respostas das agentes e a ficha ao consultor (sem repetir). */
const prefixosDeEnvioDaLinha = (): string[] => [...new Set([...prefixosDaLinha(), ...PREFIXOS_AGENDA, PREFIXO_CARIMBO_AGENTES, PREFIXO_FICHA])];

/** Quando saiu o último envio de QUALQUER robô da linha (no banco). null = não deu para ler. */
async function ultimoEnvioEm(): Promise<number | null | 'nenhum'> {
  const filtro = prefixosDeEnvioDaLinha().map(p => `key.like.${p}%`).join(',');
  const { data, error } = await supabase.from('system_state').select('updated_at').or(filtro)
    .order('updated_at', { ascending: false }).limit(1);
  if (error) { logger.error(LOG, `leitura do último envio falhou (${codigoDe(error)})`); return null; }
  const t = Date.parse(String(((data ?? []) as Array<{ updated_at?: string }>)[0]?.updated_at ?? ''));
  return Number.isFinite(t) ? t : 'nenhum';
}

// ── erros de linha (os mesmos contadores do vivoEnvio.ts: 2 seguidos pausam a linha por 15 min; envio ok zera) ──

async function lerErrosSeguidos(): Promise<number> {
  const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
  const n = Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function gravarErros(n: number, quando: Date): Promise<void> {
  const { error } = await supabase.from('system_state').upsert(
    { key: CHAVE_LINHA_ERROS, value: { n, em: quando.toISOString() }, updated_at: quando.toISOString() }, { onConflict: 'key' });
  if (error) logger.error(LOG, `não gravei o contador de erros da linha (${codigoDe(error)})`);
}

async function zerarErros(quando: Date): Promise<void> {
  try { if ((await lerErrosSeguidos()) > 0) await gravarErros(0, quando); } catch (err) { logger.error(LOG, `não zerei o contador de erros (${codigoDe(err)})`); }
}

async function contarErroDeLinha(quando: Date): Promise<void> {
  try {
    const n = (await lerErrosSeguidos()) + 1;
    await gravarErros(n, quando);
    if (n >= LIMITES_VIVO.errosParaPausar) {
      const ate = new Date(quando.getTime() + LIMITES_VIVO.pausaMs).toISOString();
      const { error } = await supabase.from('system_state').upsert(
        { key: CHAVE_LINHA_PAUSA, value: { ate, motivo: 'erros_seguidos', n }, updated_at: quando.toISOString() }, { onConflict: 'key' });
      if (error) logger.error(LOG, `não gravei a pausa da linha (${codigoDe(error)})`);
      else logger.error(LOG, `linha pausada ate ${ate} (${n} erros seguidos)`);
    }
  } catch (err) { logger.error(LOG, `contagem de erro da linha falhou (${codigoDe(err)})`); }
}

/** O erro de envio pode ter chegado ao lead e dar certo num reenvio? 5xx e timeout sim; 4xx e o resto não. */
const permiteReenvio = (cod: string): boolean => /^http_5\d\d$/.test(cod) || cod === 'timeout';

/**
 * A abertura que a fila descartou de propósito (nada saiu): grava solar_bv_dedup:<cardId>, o marcador que o alarme de reservas sem
 * envio do solarBoasVindas aceita no lugar do carimbo de envio. Fica de fora de todo teto (prefixo próprio). Nunca lança; o value
 * não leva telefone.
 */
async function marcarAberturaDescartada(cardId: number, motivo: string, quando: Date): Promise<void> {
  try {
    const em = quando.toISOString();
    const { error } = await supabase.from('system_state').upsert(
      { key: `${SOLAR_BV_DEDUP_PREFIX}${cardId}`, value: { em, origem: 'abertura_descartada', motivo }, updated_at: em }, { onConflict: 'key' });
    if (error) logger.error(LOG, `não gravei o marcador da abertura descartada do card ${cardId} (${codigoDe(error)})`);
  } catch (err) { logger.error(LOG, `marcador da abertura descartada falhou (${codigoDe(err)})`); }
}

export interface OpcoesEnvioAgenda {
  /** Faz tudo menos escrever e enviar: devolve as contagens do que aconteceria. */
  dry?: boolean;
}

export async function enviarAgendaPendente(agora: Date = new Date(), opts: OpcoesEnvioAgenda = {}): Promise<ResultadoAgenda> {
  const dry = opts.dry === true;
  const res: ResultadoAgenda = { enviadas: 0, descartadas: 0, mantidas: 0 };
  // A fila é transacional proativa: só na janela do transacional (7h às 21h em Brasília). Fora dela, nada é lido nem enviado.
  const hora = horaBRT(agora);
  if (!(hora >= LIMITES_AGENDA.entregaDe && hora < LIMITES_AGENDA.entregaAte)) return { ...res, parou: 'fora_da_janela' };
  // Relógio da chamada: o `agora` injetado mais o que esperamos pelo espaçamento (a marca do carimbo usa ele).
  let t = agora.getTime();
  // Erros de destino (4xx) SEGUIDOS nesta chamada. O 1º é do número e só descarta o item; o 2º seguido pode ser configuração
  // do Z-API (token, instância) e esvaziaria a fila: para a chamada, devolve o resto intacto e conta os dois na linha.
  let errosDestinoSeguidos = 0;

  const { data: fila, error: erroFila } = await supabase.from('system_state').select('key, value, updated_at')
    .like('key', `${PREFIXO_FILA}%`).order('updated_at', { ascending: true }).limit(LIMITES_AGENDA.leituraDaFila);
  if (erroFila) { logger.error(LOG, `leitura da fila falhou (${codigoDe(erroFila)})`); return { ...res, parou: 'leitura_falhou' }; }
  // A ordem é a do validoAte (o que vence antes sai antes); empate pela entrada na fila (a leitura já vem por updated_at, e o sort é estável).
  // Item malformado (sem valido_ate legível) vai na frente: sai da fila no passo 1 sem custar nada.
  const venceEm = (l: Linha): number => { const x = Date.parse(String((l.value as { valido_ate?: string } | null)?.valido_ate ?? '')); return Number.isFinite(x) ? x : -Infinity; };
  const itens = ((fila ?? []) as Linha[]).map((l, i) => ({ l, i })).sort((a, b) => {
    const va = venceEm(a.l), vb = venceEm(b.l);
    return va === vb ? a.i - b.i : va < vb ? -1 : 1;
  }).map(x => x.l);
  const inicio = t;
  // O orçamento mede também o tempo REAL da chamada (envio, digitação e leituras também gastam os 300 s da função), não só as esperas simuladas.
  const inicioReal = Date.now();
  const tirarDaFila = async (chave: string): Promise<void> => {
    if (dry) return;
    try { await supabase.from('system_state').delete().eq('key', chave); } catch { /* o próximo giro descarta de novo */ }
  };
  // Tira o item da fila por decisão (nada saiu). Abertura: antes, marca o card com solar_bv_dedup para o alarme de reservas sem envio calar.
  // Horário mudado é exceção: o card ficou sem confirmação nenhuma (a reserva e a posse seguram o robô antigo), então o alarme tem que acusar.
  const descartar = async (chaveDaFila: string, cardId: number, tipo: TipoAgenda, motivo: string): Promise<void> => {
    if (tipo === 'abertura' && !dry && motivo !== 'horario_mudou') await marcarAberturaDescartada(cardId, motivo, new Date(t));
    await tirarDaFila(chaveDaFila);
    res.descartadas++;
  };

  for (const linha of itens) {
    if (res.enviadas >= LIMITES_AGENDA.porChamada) { res.parou = 'limite'; break; }
    const v = (linha.value ?? {}) as Partial<ItemDaFila>;
    const cardId = Number(v.card_id);
    const tipo = v.tipo as TipoAgenda;

    // 1. item malformado: sai da fila. O prazo (valido_ate) NÃO descarta (agenda nunca bloqueia): só serve à pausa humana, adiante.
    const validoAte = Date.parse(String(v.valido_ate ?? ''));
    const quandoMs = Date.parse(String(v.quando ?? ''));
    const descartaEm = Date.parse(String(v.descarta_em ?? ''));
    if (!TIPOS.includes(tipo) || !Number.isInteger(cardId) || cardId <= 0 || !Number.isFinite(validoAte)
      || !Number.isFinite(quandoMs) || !Number.isFinite(descartaEm) || linha.key !== chaveFila(cardId, tipo, String(v.quando))) {
      logger.error(LOG, 'item malformado na fila, descartado');
      await tirarDaFila(linha.key); res.descartadas++; continue;
    }

    // 2. o horário passou (confirma, remarca) ou a volta tem mais de 2 h: a bolha perdeu o sentido
    if (t >= descartaEm) { await descartar(linha.key, cardId, tipo, 'horario_passou'); continue; }

    // 3. a bolha fixa, com dia e hora montados AGORA. Uma vaga da volta que já passou também mata o item.
    if (tipo === 'volta' && (v.opcoes ?? []).some(o => !(Date.parse(String(o)) > t))) { await descartar(linha.key, cardId, tipo, 'vaga_passou'); continue; }
    // O aviso de IA: ligado só depois de ler a posse (passo 9b), logo antes do envio. Os passos de conferência usam a bolha sem ele.
    let comAviso = false;
    let consultoraDoEnvio = String(v.consultora ?? '');
    const montar = (reforco: boolean, consultora: string = String(v.consultora ?? '')): string | null => montarBolhaAgenda(
      tipo, camposNoEnvio(tipo, String(v.quando), consultora, v.opcoes, new Date(t).toISOString(), { caminho: v.caminho, nome: v.nome }), reforco, comAviso);
    if (!montar(v.reforco === true)) {
      logger.error(LOG, `bolha inválida (${tipo}), descartada`); await descartar(linha.key, cardId, tipo, 'bolha_invalida'); continue;
    }

    // 4. linha caída, relida antes de CADA envio: mantém e para (as próximas teriam o mesmo destino)
    const caida = await linhaCaida(t);
    if (caida !== 'nao') {
      res.mantidas += itens.length - itens.indexOf(linha); res.parou = caida === 'sim' ? 'linha_pausada' : 'leitura_falhou';
      break;
    }

    // 5. chave repetida: o carimbo já existe. Só um envio que FALHOU com 5xx/timeout ganha 1 reenvio (carimbo `:re`).
    const carimbo = chaveCarimboAgenda(cardId, tipo, String(v.quando));
    const carimboReenvio = `${carimbo}:re`;
    const { data: ja, error: erroJa } = await supabase.from('system_state').select('key, value').eq('key', carimbo).maybeSingle();
    if (erroJa) { logger.error(LOG, `leitura do carimbo falhou (${codigoDe(erroJa)})`); res.mantidas++; res.parou = 'leitura_falhou'; break; }
    let reenvio = false;
    if (ja) {
      const vc = ((ja as { value?: { estado?: string; reenviavel?: boolean } }).value ?? {});
      if (!(vc.estado === 'falhou' && vc.reenviavel === true)) { await tirarDaFila(linha.key); res.descartadas++; continue; }
      const { data: jaRe, error: erroRe } = await supabase.from('system_state').select('key').eq('key', carimboReenvio).maybeSingle();
      if (erroRe) { logger.error(LOG, `leitura do carimbo do reenvio falhou (${codigoDe(erroRe)})`); res.mantidas++; res.parou = 'leitura_falhou'; break; }
      if (jaRe) { await tirarDaFila(linha.key); res.descartadas++; continue; }
      reenvio = true;
    }
    let bolha = montar(reenvio || v.reforco === true);
    if (!bolha) { logger.error(LOG, `bolha de reenvio inválida (${tipo}), descartada`); await descartar(linha.key, cardId, tipo, 'bolha_invalida'); continue; }

    // 6. o telefone vem do card, nunca da fila. O card mudou (cancelado, outro horário, outro número)? Então o pedido morreu.
    const { data: card, error: erroCard } = await supabaseGerador.from('agendamentos').select('id, cliente_telefone, status, quando, vendedor_nome').eq('id', cardId).maybeSingle();
    if (erroCard) { logger.error(LOG, `leitura do card falhou (${codigoDe(erroCard)})`); res.mantidas++; continue; }
    const c = card as { cliente_telefone?: string | null; status?: string | null; quando?: string | null; vendedor_nome?: string | null } | null;
    // O status é relido contra a MESMA lista do solarBoasVindas (agenda/solarStatus): quem já disse não, fechou, recebeu proposta ou
    // está apalavrado não recebe a abertura nem a confirmação. A volta (card do "ligar agora") só morre se o card foi cancelado.
    const statusDoCard = String(c?.status ?? '').trim().toLowerCase();
    if (!c || statusDoCard === 'cancelado' || (tipo !== 'volta' && STATUS_QUE_NAO_RECEBEM.includes(statusDoCard))) {
      await descartar(linha.key, cardId, tipo, c ? 'status_nao_recebe' : 'card_sumiu'); continue;
    }
    // confirma e remarca: o card tem que seguir no horário do pedido (a volta não compara: o card do "ligar agora" não tem horário próprio)
    if (tipo !== 'volta' && Date.parse(String(c.quando ?? '')) !== quandoMs) {
      logger.error(LOG, `o horário do card ${cardId} mudou depois do pedido, descartado`);
      await descartar(linha.key, cardId, tipo, 'horario_mudou'); continue;
    }
    const tel = String(c.cliente_telefone ?? '').replace(/\D/g, '');
    const ck = chaveContato(tel);
    if (!ck) { logger.error(LOG, 'card sem telefone válido, descartado'); await descartar(linha.key, cardId, tipo, 'sem_telefone'); continue; }
    // O card mudou de número depois do pedido? (só compara se os dois HMACs são da mesma chave)
    if (v.tel_hmac && v.hmac_id && v.hmac_id === idChaveHmac() && hmacDe(ck) !== v.tel_hmac) {
      logger.error(LOG, 'o telefone do card mudou depois do pedido, descartado');
      await descartar(linha.key, cardId, tipo, 'telefone_mudou'); continue;
    }
    // A consultora é relida do card (a ficha pode ter trocado de mãos desde o pedido). Vazia no card = vale a do item.
    if (tipo !== 'volta') {
      const atual = primeiroNome(c.vendedor_nome);
      if (atual) {
        const nova = montar(reenvio || v.reforco === true, atual);
        if (!nova) { logger.error(LOG, `bolha inválida (${tipo}) com a consultora do card, descartada`); await descartar(linha.key, cardId, tipo, 'bolha_invalida'); continue; }
        bolha = nova;
        consultoraDoEnvio = atual;
      }
    }

    // 7. pausa humana (o gate falha aberto; LID cru não passa na chaveContato acima). Ativa: mantém até o validoAte;
    //    passado o validoAte com a pausa ainda ativa, a bolha perdeu o sentido e sai da fila.
    const gate = await podeFalarComLead(tel);
    if (!gate.pode) {
      if (validoAte <= t) await descartar(linha.key, cardId, tipo, 'pausa_vencida'); else res.mantidas++;
      continue;
    }

    // 8. quem pediu para parar não recebe confirmação: descarta (opt-out, denúncia, fora do padrão). Leitura que falha segura.
    if (await estaBloqueado(tel)) { await descartar(linha.key, cardId, tipo, 'bloqueado'); continue; }
    let motivos: string[];
    try { motivos = await motivosDaSupressao(tel); } catch (err) {
      logger.error(LOG, `leitura da supressão falhou (${codigoDe(err)})`); res.mantidas++; continue;
    }
    if (motivos.includes('opt_out') || motivos.includes('denuncia') || motivos.includes('fora_do_padrao')) {
      await descartar(linha.key, cardId, tipo, 'opt_out'); continue;
    }

    // 9. espaçamento contra o último envio de QUALQUER robô da linha (no banco; o carimbo dos envios desta chamada também conta):
    //    25 s mais um sorteio de 0 a 35 s, ou só 10 s no último momento útil (validoAte em menos de 30 min, vencido inclusive).
    //    Completa a espera. Nunca segura por teto; só o orçamento de tempo da chamada deixa o item para a próxima rodada.
    const ultimo = await ultimoEnvioEm();
    if (ultimo === null) { res.mantidas++; res.parou = 'leitura_falhou'; break; }
    const urgente = validoAte - t < LIMITES_AGENDA.ultimoMomentoMs;
    const alvoMs = urgente ? LIMITES_AGENDA.espacamentoUrgenteMs : LIMITES_AGENDA.espacamentoMs + TEMPOS_AGENDA.sorteio(LIMITES_AGENDA.sorteioMs);
    if (ultimo !== 'nenhum' && t - ultimo < alvoMs) {
      const falta = alvoMs - (t - ultimo);
      if (falta > alvoMs) { res.mantidas++; continue; } // relógio do banco à frente do nosso: não espera
      if (!dry && Math.max(t - inicio, Date.now() - inicioReal) + falta > LIMITES_AGENDA.orcamentoMs) {
        // a espera não cabe no tempo da chamada: este e o resto ficam na fila para o próximo giro (*/2)
        res.mantidas += itens.length - itens.indexOf(linha); res.parou = 'tempo'; break;
      }
      if (!dry) { await TEMPOS_AGENDA.esperar(falta); t += falta; }
    }

    // 9b. o aviso de IA (22/10/2026): enquanto a posse não tem apresentada === true, confirma, remarca e volta saem com a frase na
    //     frente. Posse ausente ou leitura que falha = com o aviso (o lado seguro). A abertura já traz o aviso.
    if (tipo !== 'abertura') {
      let apresentada = false;
      try { apresentada = (await lerPosse(ck))?.apresentada === true; } catch { apresentada = false; }
      comAviso = !apresentada;
      if (comAviso) {
        const comFrase = montar(reenvio || v.reforco === true, tipo === 'volta' ? undefined : consultoraDoEnvio);
        if (!comFrase) { logger.error(LOG, `bolha inválida (${tipo}) com o aviso de IA, descartada`); await descartar(linha.key, cardId, tipo, 'bolha_invalida'); continue; }
        bolha = comFrase;
      }
    }

    // dry: tudo conferido, nada reservado nem enviado
    if (dry) { res.enviadas++; continue; }

    // 10. reserva por INSERT (23505 = já saiu)
    const chaveReserva = reenvio ? carimboReenvio : carimbo;
    const { error: erroReserva } = await supabase.from('system_state').insert({
      key: chaveReserva, value: { tipo, card_id: cardId, em: new Date(t).toISOString(), estado: 'reservado' }, updated_at: new Date(t).toISOString(),
    });
    if (erroReserva) {
      if (codigoDe(erroReserva) === '23505') { await tirarDaFila(linha.key); res.descartadas++; continue; }
      logger.error(LOG, `reserva falhou (${codigoDe(erroReserva)})`); res.mantidas++; continue;
    }

    // 11. a bolha
    try {
      await sendHuman(tel, [bolha], 'io', { maxBolhas: 1, max: LIMITES_AGENDA.maxCaracteresBolha });
    } catch (err) {
      const cod = codigoDoErroDeEnvio(err);
      logger.error(LOG, `envio ${tipo}${reenvio ? ' (reenvio)' : ''} do card ${cardId} falhou: ${cod}`);
      // Número inválido é do destino: não conta nos 2 erros seguidos que pausam a linha (correção 13 do B1d-2).
      const doDestino = erroEhDoDestino(err);
      if (!doDestino) { await contarErroDeLinha(new Date(t)); res.parou = 'erro_de_envio'; }
      if (erroProvaQueNaoSaiu(err)) {
        // Provado que nada saiu (cooldown, credencial): apaga a reserva e o item espera a linha voltar.
        try { await supabase.from('system_state').delete().eq('key', chaveReserva); } catch { /* pior caso: o carimbo fica */ }
        res.mantidas++;
        break;
      }
      // 5xx/timeout: pode ter chegado. O carimbo FICA, marcado como falhou, e o item ganha 1 reenvio (só depois do 1º envio).
      const reenviavel = !reenvio && permiteReenvio(cod);
      try {
        await supabase.from('system_state').update({
          value: { tipo, card_id: cardId, estado: 'falhou', erro: cod, ...(reenviavel ? { reenviavel: true } : {}) },
        }).eq('key', chaveReserva);
      } catch { /* o carimbo já está lá */ }
      if (reenviavel) res.mantidas++;
      else if (doDestino) await descartar(linha.key, cardId, tipo, 'numero_invalido');   // 4xx: o número não recebe, nada saiu
      else { await tirarDaFila(linha.key); res.descartadas++; }                          // 5xx repetido: pode ter chegado, o alarme segue
      if (doDestino) {
        errosDestinoSeguidos++;
        if (errosDestinoSeguidos < 2) continue;   // o 1º é deste número, não da linha: segue com os outros
        // o 2º seguido pode ser a configuração: os dois contam como erro de linha (a pausa de 15 min vale) e o resto fica na fila
        await contarErroDeLinha(new Date(t)); await contarErroDeLinha(new Date(t));
        res.mantidas += itens.length - itens.indexOf(linha) - 1;
        res.parou = 'erro_de_envio';
        break;
      }
      break;                     // linha com problema: não insiste com o resto na mesma chamada
    }
    errosDestinoSeguidos = 0;
    // Saiu com o aviso: a posse passa a apresentada (a conversa seguinte não repete a frase). Nunca lança.
    if (comAviso) { try { await atualizarPosse(ck, { apresentada: true }); } catch { /* o próximo envio leva o aviso de novo, sem dano */ } }
    try {
      await supabase.from('system_state').update({ value: { tipo, card_id: cardId, estado: 'enviado', ...(reenvio ? { reenvio: true } : {}) } }).eq('key', chaveReserva);
    } catch { /* idem */ }
    await zerarErros(new Date(t));
    await tirarDaFila(linha.key);
    res.enviadas++;
    // A confirmação do card novo saiu: só agora as boas-vindas do card ficam carimbadas (UPDATE ... boas_vindas_at IS NULL).
    if (tipo === 'confirma') await marcarBoasVindasEnviada(cardId);
  }
  return res;
}

// ── a rodada da fila (a rota /cron/agentes-5040/agenda) ───────────────────────

export interface RelatorioAgenda {
  ok: boolean;
  dry: boolean;
  /** Dentro das 7h às 21h (Brasília)? Fora, a rodada não lê a fila. */
  janela: boolean;
  /** Outra rodada da fila está em andamento. */
  ocupada?: boolean;
  motivo?: string;
  /** Havia algum item na fila ao olhar? */
  comFila: boolean;
  agenda?: ResultadoAgenda;
}

async function tomarTrava(agora: Date, token: string): Promise<'tomada' | 'ocupada' | 'erro'> {
  const iso = agora.toISOString();
  const ins = await supabase.from('system_state').insert({ key: CHAVE_TRAVA_AGENDA, value: { em: iso, token }, updated_at: iso });
  if (!ins.error) return 'tomada';
  if (codigoDe(ins.error) !== '23505') { logger.error(LOG, `trava: insert falhou (${codigoDe(ins.error)})`); return 'erro'; }
  const corte = new Date(agora.getTime() - LIMITES_AGENDA.travaMs).toISOString();
  const up = await supabase.from('system_state').update({ value: { em: iso, token }, updated_at: iso })
    .eq('key', CHAVE_TRAVA_AGENDA).lte('updated_at', corte).select('key');
  if (up.error) { logger.error(LOG, `trava: takeover falhou (${codigoDe(up.error)})`); return 'erro'; }
  return Array.isArray(up.data) && up.data.length > 0 ? 'tomada' : 'ocupada';
}

/**
 * A rodada da fila, com relógio PRÓPRIO (independe de qualquer *_vivo ligado): fora das 7h às 21h sai sem ler nada; fila
 * vazia custa 1 leitura; com fila, trava com TOKEN (como a rodada viva) e entrega. O dry não trava e não escreve.
 */
export async function runAgendaTick(opts: { dry?: boolean; agora?: Date; token?: string } = {}): Promise<RelatorioAgenda> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const hora = horaBRT(agora);
  const janela = hora >= LIMITES_AGENDA.entregaDe && hora < LIMITES_AGENDA.entregaAte;
  if (!janela) return { ok: true, dry, janela: false, comFila: false, motivo: 'fora da janela das 7h às 21h' };
  let token: string | null = null;
  try {
    const { data, error } = await supabase.from('system_state').select('key').like('key', `${PREFIXO_FILA}%`).limit(1);
    if (error) { logger.error(LOG, `leitura da fila falhou (${codigoDe(error)})`); return { ok: false, dry, janela, comFila: false, motivo: 'leitura da fila falhou' }; }
    if (!((data ?? []) as unknown[]).length) return { ok: true, dry, janela, comFila: false };
    if (!dry) {
      const meu = opts.token ?? `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
      const t = await tomarTrava(agora, meu);
      if (t === 'ocupada') return { ok: true, dry, janela, comFila: true, ocupada: true, motivo: 'outra rodada da fila está em andamento' };
      if (t === 'erro') return { ok: false, dry, janela, comFila: true, motivo: 'não consegui tomar a trava da fila' };
      token = meu;
    }
    const agenda = await enviarAgendaPendente(agora, { dry });
    return { ok: true, dry, janela, comFila: true, agenda };
  } catch (err) {
    logger.error(LOG, `a rodada da fila falhou (${codigoDe(err)})`);
    return { ok: false, dry, janela, comFila: false, motivo: 'a rodada da fila falhou' };
  } finally {
    if (token) {
      try { await supabase.from('system_state').delete().eq('key', CHAVE_TRAVA_AGENDA).eq('value->>token', token); }
      catch (err) { logger.error(LOG, `não soltei a trava da fila (${codigoDe(err)})`); }
    }
  }
}
