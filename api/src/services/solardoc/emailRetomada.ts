// ─────────────────────────────────────────────────────────────────────────────
// RETOMADA DA BASE POR E-MAIL (18/11/2026). Pedido do dono: vender 5 SolarDoc por dia; o follow-up tem que funcionar.
//
// UM e-mail por pessoa, para sempre, para a base que não paga: grátis que já gerou documento (e-mail 1), grátis que nunca gerou (e-mail 2) e
// ex-assinante (e-mail 3). Os textos e o HTML moram em emailRetomadaTextos.ts; o envio é `sendEmailRetomadaBase` (utils/mailer.ts), com o descadastro.
//
// DESLIGADA POR PADRÃO: só roda com a env EMAIL_RETOMADA_LIGADA=true (ausente ou qualquer outro valor = desligada, nenhuma leitura de banco).
// Roda na lista do /cron/master (de hora em hora), como a tarefa 'email-retomada'. Só das 8h às 20h de Brasília, no máximo 25 por rodada.
//
// QUEM ENTRA: as MESMAS regras da retomada pelo WhatsApp (retomadaUsuariosRegras.ts: segmentoDaConta, pagaHoje, conta de teste ou admin,
// kit-integrador, PlugCash, saiu há menos de 14 dias, estorno ou contestação), com `email_opt_out` no lugar de `whatsapp_opt_out` e SEM exigir WhatsApp.
// Mais: e-mail inválido, quem já recebeu esta campanha (claim) e conta criada há menos de 14 dias (a recepção de usuários novos ainda fala com ela).
//
// O CLAIM `email_retomada_sent:<user_id>` é um insert ANTES de enviar (a chave única decide a corrida): só o erro DO DESTINATÁRIO (Resend `validation_error`, endereço
// recusado) mantém o claim; qualquer outro erro (rede, cota, remetente, chave, desconhecido) solta o claim e encerra a rodada.
// A rodada lê a base em páginas e PARA ao juntar 25 aptos; uma rodada completa sem ninguém apto grava `email_retomada_esgotada` e as seguintes saem cedo por 24 h. Nunca grava e-mail no log nem em system_state.
//
// MEDIR O ALVO SEM ENVIAR: `contarEmailRetomada()` devolve quantos estão aptos por segmento e os motivos de quem ficou fora.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger';
import { horaBRT } from '../agentes5040/relogio';
import { primeiroNome } from '../nexus/email';
import {
  JANELA_RECEPCAO_RECENTE_MS, JANELA_SAIU_HA_POUCO_MS, ESTORNO_OU_CONTESTACAO, ehContaDeTeste, nomeParaTexto, pagaHoje, segmentoDaConta, usouAPlataforma,
  type UsuarioRet, type VendaRet,
} from './retomadaUsuariosRegras';
import { varianteDoUsuario, type SegmentoEmailRetomada, type VarianteEmail } from './emailRetomadaTextos';

const LOG = 'email-retomada';

/** O claim de quem já recebeu. Um por pessoa, para sempre. Fora da faxina de 7 dias (o prefixo não está na lista dela). */
export const PREFIXO_CLAIM_EMAIL_RETOMADA = 'email_retomada_sent:';
export const TETO_EMAIL_RETOMADA_POR_RODADA = 25;
export const HORA_INICIO_EMAIL_RETOMADA = 8;
export const HORA_FIM_EMAIL_RETOMADA = 20;

/** Só `true` liga. Lida a cada chamada. */
export const emailRetomadaLigada = (env: string | undefined = process.env.EMAIL_RETOMADA_LIGADA): boolean => String(env ?? '').trim().toLowerCase() === 'true';

export const dentroDaJanelaDoEmail = (agora: Date): boolean => {
  const h = horaBRT(agora);
  return h >= HORA_INICIO_EMAIL_RETOMADA && h < HORA_FIM_EMAIL_RETOMADA;
};

// ── a classificação (pura) ───────────────────────────────────────────────────

/** A linha de `users` desta campanha: a da retomada, com a coluna do descadastro por e-mail. */
export type UsuarioEmail = UsuarioRet & { email_opt_out?: boolean | null };

export interface ExtrasEmail { vendas: readonly VendaRet[]; temDocumento: boolean }

export type MotivoForaEmail =
  | 'email_invalido' | 'admin_ou_teste' | 'paga_hoje' | 'email_opt_out' | 'kit_integrador' | 'plugcash' | 'saiu_ha_pouco'
  | 'data_ilegivel' | 'conta_recente' | 'estorno_ou_contestacao' | 'ja_recebeu';

export type ClassificacaoEmail = { ok: true; segmento: SegmentoEmailRetomada } | { ok: false; motivo: MotivoForaEmail };

const EMAIL_OK = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const ms = (v: unknown): number | null => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

/** As exclusões baratas (só a linha de `users` e o claim), na ordem do plano. Antes de ler `sales` e `documents`. */
export function exclusaoBarata(u: UsuarioEmail, agoraMs: number, jaRecebeu: boolean): MotivoForaEmail | null {
  if (!EMAIL_OK.test(String(u.email ?? '').trim())) return 'email_invalido';
  if (ehContaDeTeste(u)) return 'admin_ou_teste';
  if (pagaHoje(u, agoraMs)) return 'paga_hoje';
  if (u.email_opt_out === true) return 'email_opt_out';
  const origem = String(u.origem_aquisicao ?? '').trim().toLowerCase();
  if (origem === 'kit-integrador') return 'kit_integrador';
  if (origem === 'plugcash') return 'plugcash';
  const cancelou = ms(u.last_canceled_at);
  if (cancelou !== null && agoraMs - cancelou < JANELA_SAIU_HA_POUCO_MS) return 'saiu_ha_pouco';
  const criada = ms(u.created_at);
  if (criada === null) return 'data_ilegivel';
  if (agoraMs - criada < JANELA_RECEPCAO_RECENTE_MS) return 'conta_recente';
  if (jaRecebeu) return 'ja_recebeu';
  return null;
}

/**
 * Quem entra e em qual e-mail: ex-assinante (segmentoDaConta) = e-mail 3; grátis que já gerou documento (contador ou linha em `documents`) = e-mail 1;
 * grátis que nunca gerou = e-mail 2. Quem saiu com estorno ou contestação fica fora (o mesmo filtro da retomada pelo WhatsApp).
 */
export function classificarParaEmail(u: UsuarioEmail, x: ExtrasEmail, agoraMs: number, jaRecebeu = false): ClassificacaoEmail {
  const barata = exclusaoBarata(u, agoraMs, jaRecebeu);
  if (barata) return { ok: false, motivo: barata };
  if (x.vendas.some(v => ESTORNO_OU_CONTESTACAO.test(String(v.status ?? '')))) return { ok: false, motivo: 'estorno_ou_contestacao' };
  const s = segmentoDaConta(u, { vendas: x.vendas, ultimoDocumentoBrutoMs: null, temCnpj: false }, agoraMs);
  if (s.segmento === 'ex_assinante') return { ok: true, segmento: 'ex_assinante' };
  return { ok: true, segmento: usouAPlataforma(u, x.temDocumento) ? 'gratis_usou' : 'gratis_nunca_usou' };
}

// ── as leituras e o envio (injetáveis, para o teste) ─────────────────────────

export interface DepsEmailRetomada {
  /** Uma página dos usuários que não são pagantes de plano (users.plano = free), pela ordem do id: as linhas de `de` a `ate` (inclusive). Menos que a página = a última. */
  lerPagina(de: number, ate: number): Promise<UsuarioEmail[]>;
  /** Tamanho da página (padrão 1000, o corte do PostgREST). Só o teste muda. */
  tamanhoPagina?: number;
  /** Quando a última rodada completa não achou ninguém apto (`email_retomada_esgotada`), em ms. null = nunca (ou não deu para ler). */
  lerEsgotada(): Promise<number | null>;
  gravarEsgotada(agora: Date): Promise<void>;
  /** Dos ids, quais já têm o claim `email_retomada_sent:<id>`. */
  jaReceberam(ids: readonly string[]): Promise<Set<string>>;
  /** `sales` (por e-mail) e `documents` (por user_id) só de quem passou nas exclusões baratas. */
  lerExtras(usuarios: readonly UsuarioEmail[]): Promise<Map<string, ExtrasEmail>>;
  /** Insert do claim: 'reservada' = a vez é nossa; 'ja_existe' = outra rodada já tem; 'erro' = não gravou (não envia). */
  reservar(chave: string, valor: Record<string, unknown>, agora: Date): Promise<'reservada' | 'ja_existe' | 'erro'>;
  liberar(chave: string): Promise<void>;
  enviar(a: { to: string; userId: string; nome: string; segmento: SegmentoEmailRetomada; variante: VarianteEmail }): Promise<void>;
}

export interface AptoEmail { u: UsuarioEmail; segmento: SegmentoEmailRetomada; variante: VarianteEmail }
export interface FilaEmail {
  aptos: AptoEmail[]; porMotivo: Record<string, number>; lidos: number;
  /** A base inteira foi lida (não parou no teto de aptos). */
  completa: boolean;
}

const RANK: Readonly<Record<SegmentoEmailRetomada, number>> = { ex_assinante: 0, gratis_usou: 1, gratis_nunca_usou: 2 };
export const PAGINA_EMAIL_RETOMADA = 1000;
/** A chave da "base esgotada": a última rodada completa não achou ninguém apto. As rodadas seguintes saem cedo por este tempo. */
export const CHAVE_EMAIL_RETOMADA_ESGOTADA = 'email_retomada_esgotada';
export const ESGOTADA_VALE_MS = 24 * 3_600_000;

/**
 * Lê o público (página por página) e separa quem entra. Para de ler quando já tem `max` aptos (a rodada envia 25 e não precisa do resto);
 * `contarEmailRetomada` passa Infinity e lê tudo. Ordem dos aptos: ex-assinante, grátis que usou, grátis que nunca usou; dentro de cada um, a conta mais nova primeiro.
 * Erro de leitura LANÇA.
 */
export async function montarFilaEmail(agora: Date, d: DepsEmailRetomada, max: number = Infinity): Promise<FilaEmail> {
  const agoraMs = agora.getTime();
  const tam = d.tamanhoPagina ?? PAGINA_EMAIL_RETOMADA;
  const porMotivo: Record<string, number> = {};
  const fora = (m: string): void => { porMotivo[m] = (porMotivo[m] ?? 0) + 1; };
  const aptos: AptoEmail[] = [];
  let lidos = 0;
  let completa = true;
  for (let pag = 0; pag < 1000; pag++) {
    const usuarios = await d.lerPagina(pag * tam, pag * tam + tam - 1);
    lidos += usuarios.length;
    const recebeu = await d.jaReceberam(usuarios.map(u => u.id));
    const passaram: UsuarioEmail[] = [];
    for (const u of usuarios) {
      const m = exclusaoBarata(u, agoraMs, recebeu.has(u.id));
      if (m) fora(m); else passaram.push(u);
    }
    const extras = passaram.length ? await d.lerExtras(passaram) : new Map<string, ExtrasEmail>();
    for (const u of passaram) {
      const c = classificarParaEmail(u, extras.get(u.id) ?? { vendas: [], temDocumento: false }, agoraMs, false);
      if (c.ok) aptos.push({ u, segmento: c.segmento, variante: varianteDoUsuario(u.id) }); else fora(c.motivo);
    }
    if (usuarios.length < tam) break;
    if (aptos.length >= max) { completa = false; break; }
  }
  aptos.sort((a, b) => RANK[a.segmento] - RANK[b.segmento] || (ms(b.u.created_at) ?? 0) - (ms(a.u.created_at) ?? 0) || (a.u.id < b.u.id ? -1 : 1));
  return { aptos, porMotivo, lidos, completa };
}

export interface ContagemEmailRetomada {
  total: number;
  por_segmento: Record<SegmentoEmailRetomada, number>;
  /** Quantos dos aptos caem no assunto A e no B. */
  por_variante: Record<VarianteEmail, number>;
  por_motivo: Record<string, number>;
  lidos: number;
}

/** O alvo agora, SEM enviar nem gravar nada: quantos estão aptos por segmento e por que os outros ficaram fora. Independe da env, da janela e do teto. */
export async function contarEmailRetomada(agora: Date = new Date(), deps?: DepsEmailRetomada): Promise<ContagemEmailRetomada> {
  const d = deps ?? (await import('./emailRetomadaDados')).depsReaisEmail();
  const f = await montarFilaEmail(agora, d);
  const por_segmento: Record<SegmentoEmailRetomada, number> = { gratis_usou: 0, gratis_nunca_usou: 0, ex_assinante: 0 };
  const por_variante: Record<VarianteEmail, number> = { A: 0, B: 0 };
  for (const a of f.aptos) { por_segmento[a.segmento]++; por_variante[a.variante]++; }
  return { total: f.aptos.length, por_segmento, por_variante, por_motivo: f.porMotivo, lidos: f.lidos };
}

// ── a rodada ─────────────────────────────────────────────────────────────────

export interface ResultadoEmailRetomada {
  enviados: number;
  erros: number;
  motivo?: 'desligada' | 'fora_da_janela' | 'esgotada' | 'sem_apto' | 'erro_leitura' | 'erro_envio';
  /** Aptos no momento da rodada (antes do teto). */
  aptos?: number;
  por_segmento?: Partial<Record<SegmentoEmailRetomada, number>>;
}

/**
 * O erro é DO DESTINATÁRIO (o Resend recusou o endereço: `validation_error`)? Só aí o claim FICA (a pessoa nunca é tentada de novo). Qualquer outro erro
 * (rede, cota diária ou mensal, remetente inválido, chave inválida, desconhecido) é NOSSO: o claim volta e a rodada para.
 */
export const erroDoDestinatario = (e: unknown): boolean =>
  /\b(validation_error|invalid_to_address|invalid_recipient)\b/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/**
 * A rodada de hora em hora (tarefa 'email-retomada' do /cron/master). Desligada, fora das 8h às 20h de Brasília ou sem ninguém apto: não envia. Nunca lança.
 */
export async function rodarEmailRetomada(agora: Date = new Date(), deps?: DepsEmailRetomada): Promise<ResultadoEmailRetomada> {
  if (!emailRetomadaLigada()) return { enviados: 0, erros: 0, motivo: 'desligada' };
  if (!dentroDaJanelaDoEmail(agora)) return { enviados: 0, erros: 0, motivo: 'fora_da_janela' };
  let fila: FilaEmail;
  let d: DepsEmailRetomada;
  try {
    d = deps ?? (await import('./emailRetomadaDados')).depsReaisEmail();
    const esgotada = await d.lerEsgotada();
    if (esgotada !== null && agora.getTime() >= esgotada && agora.getTime() - esgotada < ESGOTADA_VALE_MS) return { enviados: 0, erros: 0, motivo: 'esgotada' };
    fila = await montarFilaEmail(agora, d, TETO_EMAIL_RETOMADA_POR_RODADA);
  } catch (e) {
    logger.error(LOG, 'ler o público da retomada por e-mail falhou: nada enviado', { erro: String(e) });
    return { enviados: 0, erros: 1, motivo: 'erro_leitura' };
  }
  if (!fila.aptos.length) {
    // Uma rodada COMPLETA (leu a base toda) sem ninguém apto: as próximas saem cedo por 24 h, sem reler a base.
    if (fila.completa) await d.gravarEsgotada(agora).catch(() => undefined);
    return { enviados: 0, erros: 0, motivo: 'sem_apto', aptos: 0 };
  }

  let enviados = 0;
  let erros = 0;
  const por_segmento: Partial<Record<SegmentoEmailRetomada, number>> = {};
  for (const a of fila.aptos) {
    if (enviados >= TETO_EMAIL_RETOMADA_POR_RODADA) break;
    const chave = `${PREFIXO_CLAIM_EMAIL_RETOMADA}${a.u.id}`;
    const r = await d.reservar(chave, { segmento: a.segmento, variante: a.variante }, agora);
    if (r === 'ja_existe') continue;          // outra rodada já falou com ela: não conta no teto
    if (r === 'erro') { erros++; break; }     // sem o claim não se envia nada
    try {
      await d.enviar({
        to: String(a.u.email).trim(), userId: a.u.id, nome: nomeParaTexto(primeiroNome(a.u.nome)), segmento: a.segmento, variante: a.variante,
      });
      enviados++;
      por_segmento[a.segmento] = (por_segmento[a.segmento] ?? 0) + 1;
    } catch (e) {
      erros++;
      logger.error(LOG, 'o envio da retomada por e-mail falhou', { usuario: a.u.id, segmento: a.segmento, erro: String(e) });
      if (!erroDoDestinatario(e)) { await d.liberar(chave); break; }   // erro nosso: o claim volta e a rodada para
    }
  }
  if (enviados) logger.info(LOG, `retomada por e-mail: ${enviados} enviados`, { por_segmento });
  return { enviados, erros, aptos: fila.aptos.length, por_segmento, ...(erros && !enviados ? { motivo: 'erro_envio' as const } : {}) };
}
