import crypto from 'crypto';
import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { REGRAS_REDES } from '../../chefe/regulamento';
import { getIgConfig, replyToComment } from '../../instagram/igClient';
import { chaveRespostaGenteIg } from '../../instagram/igEngine';
import { responderComentarioFb, chaveRespostaGenteFb } from '../../instagram/fbComentarios';
import { dadosDoComentario } from './caixa';
import {
  chaveLigada, chaveDaResposta, reivindicar, apagarLinha, gravarValor, lerLinha, tomarFaixa, codigoDo, ErroLivro,
  lerErroMeta, erroDeRede, paradaVigente, registrarParada, textoDaParada, inicioDoProximoDiaBrt, type ErroMeta, type RedeMeta,
} from './comum';

// ─────────────────────────────────────────────────────────────────────────────
// RESPOSTA DE GENTE A COMENTÁRIO (fase 1 das redes, 14/10/2026). Um comentário e um
// texto por chamada. Sem resposta automática nova: o motor que já está no ar continua
// sendo o único que responde sozinho, e as duas respostas se enxergam no mesmo comentário.
//
// Regras do parecer do chefe anti-ban:
//   - 1 resposta de gente por comentário, por INSERT do carimbo (o claim):
//       Instagram  `ig_sent:gente:<comentário>`   no livro `ig_sent:` do motor
//       Facebook   `fb_gente:<comentário>`
//   - dentro do livro da hora SOMANDO o motor: Instagram 180/h (ou a env IG_MAX_POR_HORA,
//     se menor); Facebook 60/h, cada resposta privada do motor valendo 2 (DM e aviso público);
//   - no máximo 300 de gente em 24 h;
//   - 20 s entre respostas de gente (troca com versão);
//   - mesmo autor até 3 por hora; texto igual até 3 por hora na conta;
//   - os códigos 4, 17, 32, 368 e 613 da Meta param a conta por 15 min (a mesma parada da
//     publicação). Nada se refaz sozinho: queda de rede e 5xx contam como feito.
//
// O carimbo de gente NUNCA é gravado como `ig_events.ref`: isso calaria a DM do motor. A
// resposta PÚBLICA do motor é que pula o comentário que já tem resposta de gente.
//
// Autor e texto vêm do nosso lado (ig_events, cópia da leitura do Facebook), nunca do
// navegador. A Meta nem sempre devolve quem comentou no Facebook: com autor desconhecido
// o limite por autor NÃO se aplica (não há como contar), e a resposta avisa disso.
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'redes_respostas';
const CHAVE_ULTIMA = (rede: RedeMeta): string => `redes_resp_ultima:${rede}`;

export interface ResultadoResposta {
  ok: boolean;
  http: number;
  motivo: string;
  mensagem: string;
  abre_em?: string | null;
  incerto?: boolean;
  autor_desconhecido?: boolean;
  resposta_id?: string | null;
}

const MENSAGENS: Record<string, string> = {
  chave_desligada: 'A resposta nesta rede está desligada.',
  entrada_invalida: 'Pedido inválido.',
  sem_token: 'A conexão com a rede não está configurada.',
  ja_respondido: 'Este comentário já tem uma resposta da equipe.',
  comentario_desconhecido: 'Não achei este comentário na caixa. Atualize a lista e tente de novo.',
  espacamento: 'Espere 20 segundos entre uma resposta e outra.',
  teto_hora: 'A conta já respondeu muito na última hora. Tente daqui a pouco.',
  teto_dia: 'O limite de respostas da equipe nas últimas 24 horas foi usado.',
  mesmo_autor: 'Esta pessoa já recebeu 3 respostas na última hora.',
  mesmo_texto: 'Este mesmo texto já foi usado 3 vezes na última hora. Escreva uma resposta diferente.',
  erro_livro: 'Não consegui conferir os limites agora. Nada foi enviado.',
  nao_saiu: 'Não saiu. A rede recusou a resposta (o comentário pode ter sido apagado). Nada foi marcado como respondido.',
  incerto: 'Não sei se saiu. Confira o comentário na rede antes de tentar de novo: esta tela não repete sozinha.',
};

const sem = (http: number, motivo: string, extra: Partial<ResultadoResposta> = {}): ResultadoResposta =>
  ({ ok: false, http, motivo, mensagem: MENSAGENS[motivo] ?? 'Não foi possível agora.', ...extra });

const normalizar = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();
export const hashDoTexto = (t: string): string => crypto.createHash('sha256').update(normalizar(t)).digest('hex').slice(0, 16);

/** Teto por hora do livro da conta: o menor entre a env e o número do regulamento. */
export function tetoPorHora(rede: RedeMeta): number {
  const base = rede === 'instagram' ? REGRAS_REDES.resposta.igPorHora : REGRAS_REDES.resposta.fbPorHora;
  if (rede !== 'instagram') return base;
  const env = Number(process.env.IG_MAX_POR_HORA);
  return Number.isFinite(env) && env > 0 ? Math.min(env, base) : base;
}

const chaveGente = (rede: RedeMeta, id: string): string => (rede === 'instagram' ? chaveRespostaGenteIg(id) : chaveRespostaGenteFb(id));
const prefixoGente = (rede: RedeMeta): string => (rede === 'instagram' ? 'ig_sent:gente:' : 'fb_gente:');

interface CarimboGente { key: string; value: { autor?: string | null; texto_hash?: string }; updated_at: string }

/** Os carimbos de gente das últimas 24 h (no máximo 301: o teto é 300). */
async function carimbosDeGente24h(rede: RedeMeta, agora: number): Promise<CarimboGente[]> {
  const desde = new Date(agora - 24 * 3600_000).toISOString();
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at')
    .like('key', `${prefixoGente(rede)}%`).gte('updated_at', desde).limit(REGRAS_REDES.resposta.porDia + 1);
  if (error) throw new ErroLivro(codigoDo(error));
  return (data ?? []) as CarimboGente[];
}

/** O livro da hora SOMANDO o motor: Instagram conta os `ig_sent:`; Facebook, os de gente mais 2 por resposta privada do motor. */
async function usoDaHora(rede: RedeMeta, gente: CarimboGente[], agora: number): Promise<number> {
  const desde = new Date(agora - 3600_000).toISOString();
  if (rede === 'instagram') {
    const { data, error } = await supabase.from('system_state').select('key').like('key', 'ig_sent:%').gte('updated_at', desde).limit(tetoPorHora('instagram') + 1);
    if (error) throw new ErroLivro(codigoDo(error));
    return data?.length ?? 0;
  }
  const { data, error } = await supabase.from('ig_events').select('id').eq('tipo', 'fb_private_reply').gte('criado_em', desde).limit(tetoPorHora('facebook') + 1);
  if (error) throw new ErroLivro(codigoDo(error));
  const deGente = gente.filter(g => Date.parse(g.updated_at) >= agora - 3600_000).length;
  return (data?.length ?? 0) * REGRAS_REDES.resposta.fbPesoDoMotor + deGente;
}

type Resultado = ResultadoResposta | null;

/** As conferências de volume, na ordem do parecer. Devolve a recusa ou null. */
async function conferirVolume(rede: RedeMeta, autor: string | null, textoHash: string, agora: number): Promise<Resultado> {
  const gente = await carimbosDeGente24h(rede, agora);
  if (gente.length >= REGRAS_REDES.resposta.porDia) return sem(429, 'teto_dia', { abre_em: null });
  if ((await usoDaHora(rede, gente, agora)) >= tetoPorHora(rede)) return sem(429, 'teto_hora');
  const naHora = gente.filter(g => Date.parse(g.updated_at) >= agora - 3600_000);
  if (autor && naHora.filter(g => g.value?.autor === autor).length >= REGRAS_REDES.resposta.mesmoAutorPorHora) return sem(429, 'mesmo_autor');
  if (naHora.filter(g => g.value?.texto_hash === textoHash).length >= REGRAS_REDES.resposta.mesmoTextoPorHora) return sem(429, 'mesmo_texto');
  return null;
}

/** Resposta que nunca saiu (4xx) ou resultado incerto (queda de rede, timeout, 5xx)? */
const incertoDe = (e: ErroMeta): boolean => e.rede || e.http >= 500 || e.http === 408;

export async function responderComentario(p: {
  rede: unknown; comentario_id: unknown; texto: unknown; por: string; agora?: Date;
}): Promise<ResultadoResposta> {
  const agora = (p.agora ?? new Date()).getTime();
  const iso = new Date(agora).toISOString();
  if (p.rede !== 'instagram' && p.rede !== 'facebook') return sem(400, 'entrada_invalida');
  const rede: RedeMeta = p.rede;

  // 1) chave desta rede
  if (!chaveLigada(chaveDaResposta(rede))) return sem(403, 'chave_desligada');
  if (typeof p.comentario_id !== 'string' || !/^[0-9A-Za-z_-]{5,80}$/.test(p.comentario_id)) return sem(400, 'entrada_invalida');
  if (typeof p.texto !== 'string') return sem(400, 'entrada_invalida');
  const texto = p.texto.trim();
  if (!texto || texto.length > REGRAS_REDES.resposta.textoMax) {
    return sem(400, 'entrada_invalida', { mensagem: `A resposta tem de ter de 1 a ${REGRAS_REDES.resposta.textoMax} caracteres.` });
  }
  const id = p.comentario_id;

  let igToken: string | null = null;
  if (rede === 'instagram') {
    const cfg = await getIgConfig().catch(() => null);
    igToken = cfg?.access_token ?? null;
    if (!igToken) return sem(503, 'sem_token');
  } else if (!String(process.env.META_SYSTEM_USER_TOKEN || '').trim()) {
    return sem(503, 'sem_token');
  }

  let carimbo: string | null = null;
  let faixaMarca: string | null = null;
  let dados: { conhecido: boolean; autor: string | null; texto: string | null } = { conhecido: false, autor: null, texto: null };
  // O carimbo guarda o autor e o hash do texto: é com eles que o mesmo autor e o texto igual são contados depois.
  let registro: Record<string, unknown> = {};
  const desfazer = async (): Promise<void> => {
    if (carimbo) await apagarLinha(carimbo).catch(() => undefined);
    if (faixaMarca) {
      const f = await lerLinha<{ em?: string }>(CHAVE_ULTIMA(rede)).catch(() => null);
      if (f && f.value?.em === faixaMarca) await apagarLinha(CHAVE_ULTIMA(rede)).catch(() => undefined);
    }
  };

  try {
    // 2) parada vigente da conta (a mesma da publicação)
    const parada = await paradaVigente(rede, agora);
    if (parada) return sem(429, 'parada', { mensagem: textoDaParada(parada.motivo, parada.ate), abre_em: new Date(parada.ate).toISOString() });

    // 3) já tem resposta de gente? (leitura; o claim abaixo é quem vale)
    if (await lerLinha(chaveGente(rede, id))) return sem(409, 'ja_respondido');

    // 4) autor e texto do comentário, do nosso lado; 5) volume, somando o motor
    dados = await dadosDoComentario(rede, id);
    // Só se responde comentário que a caixa mostrou: id de post ou de outra coisa não vira comentário novo no topo.
    if (!dados.conhecido) return sem(404, 'comentario_desconhecido');
    const textoHash = hashDoTexto(texto);
    const recusa = await conferirVolume(rede, dados.autor, textoHash, agora);
    if (recusa) return recusa;

    // 6) CLAIM por insert do carimbo (1 por comentário), no livro da conta
    const chave = chaveGente(rede, id);
    registro = { autor: dados.autor, texto_hash: textoHash, por: p.por, em: iso, estado: 'reservado' };
    const cl = await reivindicar(chave, registro, iso);
    if (cl === 'duplicado') return sem(409, 'ja_respondido');
    if (cl === 'erro') return sem(502, 'erro_livro');
    carimbo = chave;

    // 7) 20 s entre respostas de gente, com versão
    const faixa = await tomarFaixa(CHAVE_ULTIMA(rede), REGRAS_REDES.resposta.entreMs, p.por, agora);
    if (!faixa.ok) { await desfazer(); return sem(429, 'espacamento', { abre_em: new Date(agora + faixa.esperaMs).toISOString() }); }
    faixaMarca = iso;
  } catch (err) {
    logger.error(LOG, 'conferir a resposta falhou', err instanceof ErroLivro ? { codigo: err.codigo } : err);
    await desfazer();
    return sem(502, 'erro_livro');
  }

  // 8) envio
  const autorDesconhecido = dados.autor === null;
  let erro: ErroMeta | null = null;
  let respostaId: string | null = null;
  if (rede === 'instagram') {
    try {
      const r = await replyToComment(id, texto, igToken!);
      respostaId = String((r as { id?: string }).id ?? '') || null;
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      const http = Number(/replyToComment (\d{3})/.exec(msg)?.[1] ?? 0);
      erro = http ? lerErroMeta(http, msg) : erroDeRede(msg);
    }
  } else {
    const r = await responderComentarioFb(id, texto);
    if (r.ok) respostaId = r.id;
    else erro = r.rede ? erroDeRede(r.corpo) : lerErroMeta(r.http, r.corpo);
  }

  if (erro) {
    await registrarParada(rede, erro, agora).catch(() => undefined);
    if (incertoDe(erro)) {
      // Pode ter saído: o carimbo FICA e nada se refaz sozinho.
      logger.error(LOG, `resposta ${rede} com resultado incerto (http ${erro.http})`);
      await gravarValor(carimbo!, { ...registro, estado: 'incerto' });
      return sem(202, 'incerto', { incerto: true, ...(autorDesconhecido ? { autor_desconhecido: true } : {}) });
    }
    // 4xx: a rede disse não. Nada saiu, então o carimbo e a faixa voltam.
    logger.error(LOG, `resposta ${rede} recusada: http ${erro.http}, código ${erro.codigo ?? '-'}`);
    await desfazer();
    return sem(502, 'nao_saiu');
  }
  await gravarValor(carimbo!, { ...registro, estado: 'enviado', resposta_id: respostaId });
  return {
    ok: true, http: 200, motivo: 'enviada', mensagem: 'Resposta enviada.', resposta_id: respostaId,
    ...(autorDesconhecido ? { autor_desconhecido: true } : {}),
  };
}

// ── a tela de limites ────────────────────────────────────────────────────────

export interface SituacaoResposta {
  ligado: boolean; pode: boolean; motivo: string | null; mensagem: string | null; abre_em: string | null;
  hora: { usadas: number | null; teto: number };
  dia: { usadas: number | null; teto: number };
}

/** O que a conta aguenta agora, sem chamar a Meta e sem gravar. */
export async function situacaoResposta(rede: RedeMeta, agora = Date.now()): Promise<SituacaoResposta> {
  const teto = tetoPorHora(rede);
  const base = { hora: { usadas: null as number | null, teto }, dia: { usadas: null as number | null, teto: REGRAS_REDES.resposta.porDia } };
  if (!chaveLigada(chaveDaResposta(rede))) return { ligado: false, pode: false, motivo: 'chave_desligada', mensagem: MENSAGENS.chave_desligada!, abre_em: null, ...base };
  try {
    const parada = await paradaVigente(rede, agora);
    const gente = await carimbosDeGente24h(rede, agora);
    const usadasHora = await usoDaHora(rede, gente, agora);
    const sit = { hora: { usadas: usadasHora, teto }, dia: { usadas: gente.length, teto: REGRAS_REDES.resposta.porDia } };
    if (parada) return { ligado: true, pode: false, motivo: parada.motivo, mensagem: textoDaParada(parada.motivo, parada.ate), abre_em: new Date(parada.ate).toISOString(), ...sit };
    if (gente.length >= REGRAS_REDES.resposta.porDia) return { ligado: true, pode: false, motivo: 'teto_dia', mensagem: MENSAGENS.teto_dia!, abre_em: null, ...sit };
    if (usadasHora >= teto) return { ligado: true, pode: false, motivo: 'teto_hora', mensagem: MENSAGENS.teto_hora!, abre_em: null, ...sit };
    const ultima = await lerLinha<{ em?: string }>(CHAVE_ULTIMA(rede));
    const t = Date.parse(String(ultima?.value?.em ?? ''));
    if (Number.isFinite(t) && agora - t < REGRAS_REDES.resposta.entreMs) {
      return { ligado: true, pode: false, motivo: 'espacamento', mensagem: MENSAGENS.espacamento!, abre_em: new Date(t + REGRAS_REDES.resposta.entreMs).toISOString(), ...sit };
    }
    return { ligado: true, pode: true, motivo: null, mensagem: null, abre_em: null, ...sit };
  } catch (err) {
    logger.error(LOG, 'ler os limites da resposta falhou', err instanceof ErroLivro ? { codigo: err.codigo } : err);
    return { ligado: true, pode: false, motivo: 'erro_livro', mensagem: MENSAGENS.erro_livro!, abre_em: null, ...base };
  }
}

/** Para o texto de "abre amanhã" quando só o dia seguinte resolve. */
export const proximoDia = (agora = Date.now()): string => new Date(inicioDoProximoDiaBrt(agora)).toISOString();
