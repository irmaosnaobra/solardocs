import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { sendVideoStatus, linhaEmCooldown } from '../../agents/zapiClient';
import {
  dentroDaJanelaDiurna, dentroDoTetoHorarioLinha, respeitaEspacamentoLinha, diaDaRampaReconexao,
} from '../../agents/whatsapp/lineThrottle';
import { estadoDaLinha } from '../caixaWhatsapp';
import { dentroDaJanela, proximaAbertura, REGRAS_REDES } from '../../chefe/regulamento';
import { validarVideo, type VideoOk } from './video';
import {
  CHAVES, chaveLigada, diaBrt, inicioDoProximoDiaBrt, horaBrt, lerLinha, reivindicar, apagarLinha, gravarValor, tomarFaixa, codigoDo, ErroLivro,
} from './comum';

// ─────────────────────────────────────────────────────────────────────────────
// STATUS EM VÍDEO DA 5040 (fase 1 das redes, 14/10/2026).
//
// Parecer do chefe anti-ban: o status sai pelo zapiClient na instância 'io', sem
// retry, e CONTA COMO 1 FRIO da linha (carimbo `status_io_sent:` em BOT_SENT_PREFIXES,
// fora de PREFIXOS_AGENDA). Por isso as conferências, nesta ordem, todas ANTES do claim:
//
//   1  chave ligada (REDES_STATUS_5040_LIGADO)
//   2  linha de pé: monitor diz conectada, sem cooldown, fora do 1º dia da rampa
//   3  vídeo validado antes da Z-API (até 10 MB, mp4, link respondendo)
//   4  janela do frio (9h às 20h, segunda a sábado)
//   5  teto próprio do dia (3; 1 nas primeiras 168 h de uso e na rampa)
//   6  teto horário e do dia do frio da linha
//   7  espaçamento da linha (10 a 15 min sem carimbo)
//   8  claim por insert do carimbo, e 2 h desde o último status
//   9  envio
//
// Erro definitivo apaga o claim; erro incerto (5xx, timeout) mantém: nada se refaz sozinho.
// O 200 da Z-API não prova (é assíncrono). A prova é o messageId no webhook ou o celular.
//
// Carimbo: `status_io_sent:<dia BRT>:<n>`. O número do espaço é o que faz o INSERT impor o
// teto mesmo com dois cliques juntos. O vídeo ganha a própria chave (`status_io_video:<hash>`).
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'status_io';
const CHAVE_ULTIMO = 'redes_status_ultimo';
export const PREFIXO_CARIMBO = 'status_io_sent:';
const PREFIXO_VIDEO = 'status_io_video:';

export interface ResultadoStatus {
  ok: boolean;
  http: number;
  motivo: string;
  mensagem: string;
  /** Instante (ISO) em que a regra abre de novo, quando se sabe. */
  abre_em?: string | null;
  carimbo?: string;
  incerto?: boolean;
  zapi?: { messageId: string | null; zaapId: string | null };
}

const MENSAGENS: Record<string, string> = {
  chave_desligada: 'O status do WhatsApp está desligado.',
  entrada_invalida: 'Pedido inválido.',
  linha_fora: 'A linha 5040 não está conectada agora. Tente depois que ela voltar.',
  linha_cooldown: 'A linha 5040 acabou de recusar um envio. Espere um minuto.',
  linha_reconectou_hoje: 'A linha 5040 reconectou há menos de um dia. O status espera ela se firmar.',
  fora_da_janela: 'Status só das 9h às 20h, de segunda a sábado.',
  teto_do_dia: 'O limite de status de hoje já foi usado.',
  teto_da_linha: 'A linha 5040 já mandou muita coisa agora. Tente daqui a pouco.',
  espacamento_da_linha: 'A linha 5040 mandou mensagem agora há pouco. Tente em alguns minutos.',
  espacamento_entre_status: 'Tem que passar 2 horas entre um status e outro.',
  mesmo_video: 'Este vídeo já foi (ou pode ter ido) para o status. Para repetir, envie um arquivo novo.',
  erro_livro: 'Não consegui conferir os limites agora. Nada foi enviado.',
  zapi_recusou: 'A Z-API recusou o status. Nada foi publicado.',
  zapi_incerto: 'Não sei se o status saiu. Olhe o celular da linha antes de tentar de novo: esta tela não repete sozinha.',
};

const sem = (http: number, motivo: string, extra: Partial<ResultadoStatus> = {}): ResultadoStatus =>
  ({ ok: false, http, motivo, mensagem: MENSAGENS[motivo] ?? 'Não foi possível agora.', ...extra });

// ── conferências, uma por uma (a mesma lista serve a tela de limites) ────────

type Recusa = { motivo: string; http: number; abre_em?: number | null };

/** 2) A linha. Falha fechada: 'desconhecida' (monitor sem leitura nova) recusa igual a 'caida'. */
async function conferirLinha(agora: number): Promise<Recusa | null> {
  let estado: string;
  try {
    const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', 'zapi_io_health').maybeSingle();
    if (error) throw new ErroLivro(codigoDo(error));
    estado = estadoDaLinha((data as any)?.value ?? null, (data as any)?.updated_at ?? null, agora).estado;
  } catch (err) {
    logger.error(LOG, 'ler o estado da linha falhou', err);
    return { motivo: 'erro_livro', http: 502 };
  }
  if (estado !== 'conectada') return { motivo: 'linha_fora', http: 409 };
  if (linhaEmCooldown('io')) return { motivo: 'linha_cooldown', http: 409 };
  // Nunca no 1º dia depois de reconectar (compara com o dia 1 da rampa, não com a tabela de tetos dela).
  if ((await diaDaRampaReconexao(new Date(agora))) === 1) return { motivo: 'linha_reconectou_hoje', http: 409 };
  return null;
}

/** 4) Janela. A do frio da linha (com as chaves que afrouxam) E a do regulamento (que não afrouxa). */
function conferirJanela(agora: number): Recusa | null {
  if (dentroDaJanelaDiurna(new Date(agora)) && dentroDaJanela(REGRAS_REDES.status.janela, agora)) return null;
  return { motivo: 'fora_da_janela', http: 409, abre_em: proximaAbertura(REGRAS_REDES.status.janela, agora) };
}

/**
 * Quando saiu o primeiro status de verdade: o `em` do carimbo `status_io_sent:` mais antigo (ordem da chave, que
 * começa pelo dia) cujo estado é `enviado` ou `incerto`. Reservado e apagado não contam. null = nenhum ainda.
 * Erro de leitura LANÇA: quem chama trata como "primeira semana" (o lado que aperta).
 */
async function primeiroStatusEm(): Promise<number | null> {
  const { data, error } = await supabase.from('system_state').select('key, value')
    .like('key', `${PREFIXO_CARIMBO}%`).in('value->>estado', ['enviado', 'incerto']).order('key', { ascending: true }).limit(1);
  if (error) throw new ErroLivro(codigoDo(error));
  const em = Date.parse(String((data as Array<{ value?: { em?: string } }> | null)?.[0]?.value?.em ?? ''));
  return Number.isFinite(em) ? em : null;
}

/**
 * Teto do dia: 3; 1 por dia nas primeiras 168 h de uso (contadas do primeiro carimbo enviado) e nos dias 2 e 3 da
 * rampa. Sem nenhum carimbo enviado, ou sem conseguir ler, vale 1. A env só baixa.
 */
export async function tetoDoDia(agora: number): Promise<number> {
  const r = REGRAS_REDES.status;
  let teto: number = r.porDia;
  let primeiro: number | null = null;
  let leu = true;
  try { primeiro = await primeiroStatusEm(); } catch (err) { leu = false; logger.error(LOG, 'ler o primeiro status falhou: vale 1 por dia', err); }
  if (!leu || primeiro === null || agora - primeiro < r.primeiraSemanaHoras * 3600_000) teto = Math.min(teto, r.porDiaPrimeiraSemana);
  if ((await diaDaRampaReconexao(new Date(agora))) !== null) teto = Math.min(teto, r.porDiaRampa);
  const env = Number(process.env.REDES_STATUS_TETO_DIA);
  if (Number.isInteger(env) && env >= 0 && env < teto) teto = env;
  return teto;
}

async function usadosHoje(dia: string): Promise<number> {
  const { data, error } = await supabase.from('system_state').select('key').like('key', `${PREFIXO_CARIMBO}${dia}:%`).limit(20);
  if (error) throw new ErroLivro(codigoDo(error));
  return data?.length ?? 0;
}

async function conferirTeto(agora: number): Promise<Recusa | null> {
  try {
    const [teto, usados] = await Promise.all([tetoDoDia(agora), usadosHoje(diaBrt(agora))]);
    if (usados >= teto) return { motivo: 'teto_do_dia', http: 429, abre_em: inicioDoProximoDiaBrt(agora) };
    return null;
  } catch (err) {
    logger.error(LOG, 'ler o teto do dia falhou', err);
    return { motivo: 'erro_livro', http: 502 };
  }
}

/** 2 h desde o último status (leitura, sem gravar). Falha de leitura fecha. */
async function conferirDuasHoras(agora: number): Promise<Recusa | null> {
  try {
    const ultimo = await lerLinha<{ em?: string }>(CHAVE_ULTIMO);
    const t = Date.parse(String(ultimo?.value?.em ?? ''));
    if (Number.isFinite(t) && agora - t < REGRAS_REDES.status.entreMs) {
      return { motivo: 'espacamento_entre_status', http: 429, abre_em: t + REGRAS_REDES.status.entreMs };
    }
    return null;
  } catch (err) {
    logger.error(LOG, 'ler as 2 horas entre status falhou', err);
    return { motivo: 'erro_livro', http: 502 };
  }
}

/** 6 e 7) O frio da linha: teto horário e do dia (sem piso nenhum) e o espaçamento entre envios. */
async function conferirLinhaFria(): Promise<Recusa | null> {
  if (!(await dentroDoTetoHorarioLinha({ robo: 'status_5040' }))) return { motivo: 'teto_da_linha', http: 429 };
  if (!(await respeitaEspacamentoLinha())) return { motivo: 'espacamento_da_linha', http: 429 };
  return null;
}

const recusaParaResultado = (r: Recusa): ResultadoStatus =>
  sem(r.http, r.motivo, { abre_em: r.abre_em ? new Date(r.abre_em).toISOString() : null });

// ── o envio ──────────────────────────────────────────────────────────────────

/** O envio nunca saiu (credencial, cooldown, 4xx): o claim pode ser apagado. 5xx, timeout e rede: incerto. */
export function erroDefinitivoZapi(msg: string): boolean {
  if (/em cooldown|credenciais Z-API ausentes/i.test(msg)) return true;
  const m = /HTTP (\d{3})/.exec(msg);
  if (!m) return false;
  const c = Number(m[1]);
  return c >= 400 && c < 500 && c !== 408;
}

export async function publicarStatus(p: { video_url: unknown; legenda: unknown; por: string; agora?: Date }): Promise<ResultadoStatus> {
  const agora = (p.agora ?? new Date()).getTime();
  const iso = new Date(agora).toISOString();

  // 1) chave
  if (!chaveLigada(CHAVES.status)) return sem(403, 'chave_desligada');
  if (typeof p.legenda !== 'string' || p.legenda.length > REGRAS_REDES.status.legendaMax) {
    return sem(400, 'entrada_invalida', { mensagem: `A legenda tem de ter até ${REGRAS_REDES.status.legendaMax} caracteres.` });
  }
  const legenda = p.legenda.trim();

  // 2) linha
  const linha = await conferirLinha(agora);
  if (linha) return recusaParaResultado(linha);

  // 3) vídeo, ANTES da Z-API: 4xx dela põe a linha inteira em cooldown de 60 s.
  const v = await validarVideo(p.video_url, { maxBytes: REGRAS_REDES.status.videoMaxBytes, soMp4: true });
  if (!v.ok) return { ok: false, http: 400, motivo: v.motivo, mensagem: v.mensagem };

  // 4 a 7) janela, teto próprio, teto e espaçamento da linha
  const janela = conferirJanela(agora);
  if (janela) return recusaParaResultado(janela);
  const teto = await conferirTeto(agora);
  if (teto) return recusaParaResultado(teto);
  const fria = await conferirLinhaFria();
  if (fria) return recusaParaResultado(fria);

  // 8a) As 2 h desde o último status, LIDAS antes do claim: clique dentro das 2 h não grava carimbo nem por um instante.
  // O `tomarFaixa` dentro do claim segue como trava para dois cliques no mesmo segundo.
  const duasHoras = await conferirDuasHoras(agora);
  if (duasHoras) return recusaParaResultado(duasHoras);

  // 8b) claim
  return reivindicarEEnviar(v, legenda, p.por, agora, iso);
}

async function reivindicarEEnviar(v: VideoOk, legenda: string, por: string, agora: number, iso: string): Promise<ResultadoStatus> {
  const dia = diaBrt(agora);
  const chaveVideo = `${PREFIXO_VIDEO}${v.hash}`;
  let carimbo: string | null = null;
  let faixaMarca: string | null = null;
  const desfazer = async (manterFaixa = false): Promise<void> => {
    if (carimbo) await apagarLinha(carimbo).catch(() => undefined);
    await apagarLinha(chaveVideo).catch(() => undefined);
    if (faixaMarca && !manterFaixa) {
      const f = await lerLinha<{ em?: string }>(CHAVE_ULTIMO).catch(() => null);
      if (f && f.value?.em === faixaMarca) await apagarLinha(CHAVE_ULTIMO).catch(() => undefined);
    }
  };
  try {
    // O mesmo vídeo uma vez só.
    const rv = await reivindicar(chaveVideo, { por, em: iso, hash: v.hash }, iso);
    if (rv === 'duplicado') return sem(409, 'mesmo_video');
    if (rv === 'erro') return sem(502, 'erro_livro');

    // O espaço do dia: o INSERT impõe o teto mesmo com dois cliques juntos.
    const teto = await tetoDoDia(agora);
    const valor = { video_hash: v.hash, bytes: v.bytes, por, em: iso, estado: 'reservado' };
    for (let n = 1; n <= teto; n++) {
      const chave = `${PREFIXO_CARIMBO}${dia}:${n}`;
      const r = await reivindicar(chave, valor, iso);
      if (r === 'ok') { carimbo = chave; break; }
      if (r === 'erro') { await desfazer(); return sem(502, 'erro_livro'); }
    }
    if (!carimbo) { await desfazer(); return sem(429, 'teto_do_dia', { abre_em: new Date(inicioDoProximoDiaBrt(agora)).toISOString() }); }

    // 2 h desde o último status, com versão: dois vídeos diferentes juntos não passam os dois.
    const faixa = await tomarFaixa(CHAVE_ULTIMO, REGRAS_REDES.status.entreMs, por, agora);
    if (!faixa.ok) {
      await desfazer();
      return sem(429, 'espacamento_entre_status', { abre_em: new Date(agora + faixa.esperaMs).toISOString() });
    }
    faixaMarca = iso;
  } catch (err) {
    logger.error(LOG, 'claim do status falhou', err);
    await desfazer();
    return sem(502, 'erro_livro');
  }

  // 9) envio. Zero retry (está no zapiClient). Definitivo apaga o claim; incerto mantém.
  let resp: any = null;
  try {
    resp = await sendVideoStatus(v.url, legenda);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (erroDefinitivoZapi(msg)) {
      logger.error(LOG, 'a Z-API recusou o status', err);
      // 429 é a linha pedindo espera: o carimbo sai (nada foi publicado), mas as 2 h ficam, para o clique não voltar já.
      await desfazer(/HTTP 429/.test(msg));
      return sem(502, 'zapi_recusou');
    }
    logger.error(LOG, 'status com resultado incerto: o carimbo fica', err);
    await gravarValor(carimbo, { video_hash: v.hash, bytes: v.bytes, por, em: iso, estado: 'incerto' });
    return sem(202, 'zapi_incerto', { incerto: true, carimbo });
  }
  const messageId = String(resp?.messageId ?? resp?.id ?? '') || null;
  const zaapId = String(resp?.zaapId ?? '') || null;
  await gravarValor(carimbo, { video_hash: v.hash, bytes: v.bytes, por, em: iso, estado: 'enviado', messageId, zaapId });
  return {
    ok: true, http: 200, motivo: 'pedido_aceito', carimbo, zapi: { messageId, zaapId },
    mensagem: 'A Z-API aceitou o status. O aceite não prova que publicou: confira no celular da linha.',
  };
}

// ── a tela de limites ────────────────────────────────────────────────────────

export interface SituacaoStatus {
  ligado: boolean;
  pode: boolean;
  motivo: string | null;
  mensagem: string | null;
  abre_em: string | null;
  hoje: { usados: number | null; teto: number | null };
}

/** O que pode agora e quando abre. Mesmas conferências do envio, sem o vídeo e sem gravar nada. */
export async function situacaoStatus(agora = Date.now()): Promise<SituacaoStatus> {
  const base = { hoje: { usados: null as number | null, teto: null as number | null } };
  if (!chaveLigada(CHAVES.status)) return { ligado: false, pode: false, motivo: 'chave_desligada', mensagem: MENSAGENS.chave_desligada!, abre_em: null, ...base };
  const fim = (r: Recusa | null, hoje = base.hoje): SituacaoStatus => ({
    ligado: true, pode: !r, motivo: r?.motivo ?? null, mensagem: r ? (MENSAGENS[r.motivo] ?? null) : null,
    abre_em: r?.abre_em ? new Date(r.abre_em).toISOString() : null, hoje,
  });
  const linha = await conferirLinha(agora);
  if (linha) return fim(linha);
  const janela = conferirJanela(agora);
  if (janela) return fim(janela);
  try {
    const [teto, usados, ultimo] = await Promise.all([tetoDoDia(agora), usadosHoje(diaBrt(agora)), lerLinha<{ em?: string }>(CHAVE_ULTIMO)]);
    const hoje = { usados, teto };
    if (usados >= teto) return fim({ motivo: 'teto_do_dia', http: 429, abre_em: inicioDoProximoDiaBrt(agora) }, hoje);
    const t = Date.parse(String(ultimo?.value?.em ?? ''));
    if (Number.isFinite(t) && agora - t < REGRAS_REDES.status.entreMs) {
      return fim({ motivo: 'espacamento_entre_status', http: 429, abre_em: t + REGRAS_REDES.status.entreMs }, hoje);
    }
    const fria = await conferirLinhaFria();
    return fim(fria, hoje);
  } catch (err) {
    logger.error(LOG, 'ler os limites do status falhou', err);
    return fim({ motivo: 'erro_livro', http: 502 });
  }
}

export interface StatusRegistrado { id: string; rede: 'status'; estado: string; por: string | null; criado_em: string | null; zapi_message_id: string | null }

/** Os últimos status pedidos (o carimbo é o registro). Entra na lista de publicações da tela. */
export async function listarStatus(limite = 10): Promise<StatusRegistrado[]> {
  const { data, error } = await supabase.from('system_state').select('key, value')
    .like('key', `${PREFIXO_CARIMBO}%`).order('updated_at', { ascending: false }).limit(limite);
  if (error) throw new ErroLivro(codigoDo(error));
  return ((data ?? []) as Array<{ key: string; value: any }>).map(l => ({
    id: l.key, rede: 'status' as const, estado: String(l.value?.estado ?? 'reservado'),
    por: l.value?.por ?? null, criado_em: l.value?.em ?? null, zapi_message_id: l.value?.messageId ?? null,
  }));
}

/** Texto de "abre às HH:MM" para a tela, a partir do instante ISO. */
export const textoDeAbertura = (iso: string | null): string | null => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? `Abre às ${horaBrt(t)} (Brasília).` : null;
};
