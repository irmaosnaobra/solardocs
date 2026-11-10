// ─────────────────────────────────────────────────────────────────────────────
// RECEPÇÃO DE USUÁRIOS NOVOS DA SOLARDOC (09/11/2026). Nos primeiros 15 dias da conta, até 3 lembretes pelo WhatsApp da linha SolarDoc (a Giovanna)
// e até 3 e-mails, sempre sobre o PRÓXIMO passo que falta (primeirosPassos.ts, a mesma fonte da tela). O plano passou pelo chefe-antiban.
// Robô `solardoc_novo_usuario` (frio P5). Modelo: a 2b do pós-venda (ativacaoPosVenda.ts).
//
// WHATSAPP (rodarRecepcaoWhatsApp), 1 envio por rodada, 1 bolha de até 900 caracteres, sem link:
//   público: conta dos últimos 15 dias com senha, WhatsApp válido, sem opt-out, fora de admin/teste e de parceiro da NEXUS.
//   toques por idade da conta: R1 20 h, R2 68 h, R3 164 h. Vale só o MAIS ALTO que venceu e não foi enviado nem pulado; os menores abertos viram
//   pulados. R1 e R2 só saem com próximo passo (com tudo pronto o toque vira pulado); o R3 sai para todos.
//   chaves exatas: `recep_sent:<userId>:rN` (claim por insert, carimbo do frio da linha) e `recep_pulo:<userId>:rN`.
//   por pessoa, ANTES do claim: a conversa da linha SolarDoc (toque nosso em 48 h ou fala da pessoa em 24 h = espera; 3 toques nossos sem resposta
//   = os toques restantes viram pulados para sempre; bolhas até 1 h da primeira de uma mensagem contam como 1 toque), depois o portão da linha (novaRodadaPortao: janela da Base, linha pausada, supressão, mudo,
//   pausa humana, teto frio com `robo` e espaçamento), o claim, a releitura dos passos e o sendFrio.
//   SONDA automática antes do 1º envio (padrão da Carla, `usu_rec_sonda_ok`): enquanto `recep_sonda_ok` não existir o robô não envia NADA nem grava
//   pulados (a 1ª rodada não carimba ninguém para sempre).
//   desliga com RECEPCAO_OFF=1.
//
// E-MAIL (rodarRecepcaoEmail), até 10 por rodada, fora do portão da linha: mesmo público por e-mail (email_opt_out), WhatsApp não exigido, e fora
// quem é free SEM empresa (a cadência de CNPJ do followupService já cobre). Chaves `recep_email:<userId>:eN` e `recep_email_pulo:<userId>:eN`.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendFrio, solardocViaIo } from '../agents/zapiClient';
import { respeitaEspacamentoLinha, vagasDoFrioLinha } from '../agents/whatsapp/lineThrottle';
import { chavesExistentes, reservarChave } from '../agentes5040/cota';
import { lerConversa } from '../agentes5040/contexto';
import { novaRodadaPortao, tomarChaveFria, soltarChaveFria } from '../recuperacaoCheckoutPortao';
import { ehContaDeTeste, falaDoLeadMaisRecente, telefoneDoUsuario, toqueNossoMaisRecente } from './retomadaUsuariosRegras';
import { registrarNaSessaoDaGiovanna, telefoneValido, tsMs, type ResultadoTick } from './ativacaoPosVenda';
import { chaveAtivProposta, nomeParaSaudar, PREFIXO_ATIV_PROPOSTA } from './ativacaoPosVendaTextos';
import { carregarPassosEmLote, carregarPassos, type PassosLidos } from './primeirosPassos';
import {
  CHAVE_RECEP_SONDA_FALHOU, CHAVE_RECEP_SONDA_OK, ESPERA_TOQUE_MS, JANELA_RECEPCAO_MS, PREFIXO_RECEP_SENT, TOQUES,
  chaveRecepEmail, chaveRecepEmailPulo, chaveRecepPulo, chaveRecepSent, escolherToque, textoRecepcao,
  type ToqueRecep,
} from './recepcaoNovoUsuarioTextos';

export * from './recepcaoNovoUsuarioTextos';

const LOG = 'recepcao-novo-usuario';
const HORA_MS = 3_600_000;

/** Nome estável do robô no CHEFE (CLASSE_POR_ROBO). */
export const ROBO_RECEPCAO = 'solardoc_novo_usuario';
/** Toque nosso (de qualquer robô) nas últimas 48 h tira a pessoa DESTA rodada. */
export const JANELA_TOQUE_NOSSO_MS = 48 * HORA_MS;
/** Fala da pessoa nas últimas 24 h tira a pessoa DESTA rodada. */
export const JANELA_FALA_PESSOA_MS = 24 * HORA_MS;
/** E-mails por rodada (mesmo teto de EMAIL_TETO_POR_RODADA do followupService). */
export const EMAIL_TETO_RECEPCAO_POR_RODADA = 10;

const desligada = (): boolean => process.env.RECEPCAO_OFF === '1';
const off = (): ResultadoTick => ({ enviados: 0, pulados: 0, erros: 0, motivo: 'desligado' });

// ── a conversa (pura) ────────────────────────────────────────────────────────

export type DecisaoConversa = 'ok' | 'esperar' | 'mudo';

/** Mensagens nossas que caem até 1 h depois da PRIMEIRA do grupo formam 1 toque (a boas-vindas de 3 bolhas é 1 toque). */
export const JANELA_DO_TOQUE_MS = HORA_MS;
/** Toques nossos seguidos, sem fala da pessoa depois do primeiro deles, que encerram a recepção para a pessoa. */
export const TOQUES_PARA_MUDO = 3;

type MsgsDaConversa = Parameters<typeof toqueNossoMaisRecente>[0];
const quandoMs = (m: MsgsDaConversa[number]): number => { const t = Date.parse(String(m.momment ?? '')); return Number.isFinite(t) ? t : 0; };

/**
 * Os TOQUES nossos (instante da primeira mensagem de cada um), do mais antigo ao mais novo. A âncora é sempre a primeira mensagem do toque, nunca a
 * anterior: bolhas encadeadas a cada 40 min não viram 1 toque só por estarem a menos de 1 h umas das outras.
 */
export function ancorasDosToquesNossos(msgs: MsgsDaConversa): number[] {
  const nossas = msgs.filter(m => m.autor !== 'lead').map(quandoMs).filter(t => t > 0).sort((a, b) => a - b);
  const ancoras: number[] = [];
  for (const t of nossas) {
    if (!ancoras.length || t - ancoras[ancoras.length - 1]! > JANELA_DO_TOQUE_MS) ancoras.push(t);
  }
  return ancoras;
}

/**
 * Toques nossos seguidos sem nenhuma fala da pessoa depois do primeiro deles: os toques cuja âncora é posterior à última fala da pessoa.
 * Só este robô conta TOQUES (e não bolhas); o `mudoPelaConversa` da Carla continua como é.
 */
export function toquesNossosSemResposta(msgs: MsgsDaConversa): number {
  const ultimaFala = falaDoLeadMaisRecente(msgs);
  return ancorasDosToquesNossos(msgs).filter(a => ultimaFala === null || a > ultimaFala).length;
}

/**
 * O que a conversa da linha SolarDoc diz sobre esta pessoa. Fica numa função só de propósito: é a regra mais sensível do robô.
 *   esperar = toque nosso (de robô ou da equipe) nas últimas 48 h, ou fala da pessoa nas últimas 24 h: pula SÓ esta rodada;
 *   mudo    = 3 toques nossos seguidos sem fala da pessoa depois do primeiro: os toques restantes viram pulados e nunca mais sai.
 */
export function decidirPelaConversa(msgs: MsgsDaConversa, agoraMs: number): DecisaoConversa {
  const toque = toqueNossoMaisRecente(msgs);
  if (toque !== null && agoraMs - toque <= JANELA_TOQUE_NOSSO_MS) return 'esperar';
  const fala = falaDoLeadMaisRecente(msgs);
  if (fala !== null && agoraMs - fala <= JANELA_FALA_PESSOA_MS) return 'esperar';
  if (toquesNossosSemResposta(msgs) >= TOQUES_PARA_MUDO) return 'mudo';
  return 'ok';
}

/** O id da instância Z-API que carrega a linha SolarDoc (com o desvio ZAPI_SOLARDOC_VIA_IO ligado, a linha física é a IO). Vazio = não sei. */
export function instanciaDaLinhaSolardoc(): string {
  return String((solardocViaIo() ? process.env.ZAPI_INSTANCE_ID_IO : process.env.ZAPI_INSTANCE_ID) ?? '').trim();
}

// ── o público ────────────────────────────────────────────────────────────────

interface UsuarioRecep {
  id: string; email: string | null; nome: string | null; whatsapp: string | null; plano: string | null; created_at: string | null;
  whatsapp_opt_out: boolean | null; email_opt_out: boolean | null; is_admin: boolean | null;
  // As 4 colunas da trava de "1 e-mail nosso por dia" (followupService.recebeuEmailRecente).
  followup_email_last_sent_at?: string | null; upgrade_nudge_last_sent_at?: string | null;
  contract_reminder_last_sent_at?: string | null; confianca_last_sent_at?: string | null;
}

const emLotes = <T>(lista: readonly T[], tamanho: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
};

/**
 * Contas dos últimos 15 dias com senha criada e com 20 h ou mais de idade (o R1 mais cedo), mais antigas primeiro, sem admin, teste nem parceiro da
 * NEXUS. Opt-out NÃO é filtrado aqui (o `neq(..., true)` do PostgREST derruba linhas NULL): cada canal filtra em JS. null = a leitura falhou.
 */
async function lerPublico(agoraMs: number): Promise<UsuarioRecep[] | null> {
  const { data, error } = await supabase.from('users')
    .select('id, email, nome, whatsapp, plano, created_at, whatsapp_opt_out, email_opt_out, is_admin, followup_email_last_sent_at, upgrade_nudge_last_sent_at, contract_reminder_last_sent_at, confianca_last_sent_at')
    .gte('created_at', new Date(agoraMs - JANELA_RECEPCAO_MS).toISOString())
    .not('password_hash', 'is', null)
    .order('created_at', { ascending: true }).limit(1000);
  if (error) { logger.error(LOG, 'leitura do público falhou', error); return null; }
  const base = ((data ?? []) as UsuarioRecep[]).filter(u => {
    const nasceu = tsMs(u.created_at);
    return nasceu > 0 && agoraMs - nasceu >= ESPERA_TOQUE_MS[1] && agoraMs - nasceu <= JANELA_RECEPCAO_MS
      && !ehContaDeTeste({ is_admin: u.is_admin, email: u.email, nome: u.nome });
  });
  if (!base.length) return [];

  // Conta da NEXUS: o cadastro do parceiro nasce sem as boas-vindas da SolarDoc (a marca `origem: 'nexus'` do authController vem no corpo do
  // pedido e NÃO fica no banco), então o critério daqui é ter linha em `nexus_parceiros`. Erro de leitura = ninguém é tratado (na dúvida, não fala).
  const parceiros = new Set<string>();
  for (const lote of emLotes(base.map(u => u.id), 100)) {
    const r = await supabase.from('nexus_parceiros').select('user_id').in('user_id', lote);
    if (r.error) { logger.error(LOG, 'leitura dos parceiros da NEXUS falhou', r.error); return null; }
    for (const p of (r.data ?? []) as Array<{ user_id: string }>) parceiros.add(p.user_id);
  }
  const semParceiros = base.filter(u => !parceiros.has(u.id));

  // Comprador avulso (kit, curso ou ferramenta, sem plano) não recebe nada: o R1 pedindo CNPJ vira reembolso. Mesmo critério do servidor e do layout
  // (tem_kit e tem_produto_avulso do /auth/me). Leitura que falha = ninguém é tratado (falha fechada).
  try {
    const avulsos = await compradoresAvulsos(semParceiros);
    return semParceiros.filter(u => !avulsos.has(u.id));
  } catch (err) {
    logger.error(LOG, 'leitura dos compradores avulsos falhou', err);
    return null;
  }
}

/**
 * Quem comprou algum produto fora da assinatura: entitlement de origem `compra` ou `cortesia` (comprouAlgumProduto) ou pedido pago do kit/curso em
 * `kit_pedidos` por user_id ou e-mail (acessoDoUsuario: temKit || itens). Em lote e com o erro de cada leitura LANÇANDO, o que as funções do
 * servidor (uma conta por vez, sem checar erro) não fazem.
 */
async function compradoresAvulsos(usuarios: readonly UsuarioRecep[]): Promise<Set<string>> {
  const avulsos = new Set<string>();
  for (const lote of emLotes(usuarios, 100)) {
    const ids = lote.map(u => u.id);
    const ent = await supabase.from('entitlements').select('user_id').in('user_id', ids).in('origem', ['compra', 'cortesia']);
    if (ent.error) throw new Error('leitura dos entitlements falhou');
    for (const e of (ent.data ?? []) as Array<{ user_id: string }>) avulsos.add(e.user_id);

    const porUser = await supabase.from('kit_pedidos').select('user_id').eq('status', 'paid').in('user_id', ids);
    if (porUser.error) throw new Error('leitura dos pedidos do kit falhou');
    for (const k of (porUser.data ?? []) as Array<{ user_id: string | null }>) if (k.user_id) avulsos.add(k.user_id);

    const idsPorEmail = new Map<string, string[]>();
    for (const u of lote) {
      const e = String(u.email ?? '').trim().toLowerCase();
      if (e) idsPorEmail.set(e, [...(idsPorEmail.get(e) ?? []), u.id]);
    }
    if (idsPorEmail.size) {
      const porEmail = await supabase.from('kit_pedidos').select('email').eq('status', 'paid').in('email', [...idsPorEmail.keys()]);
      if (porEmail.error) throw new Error('leitura dos pedidos do kit por e-mail falhou');
      for (const k of (porEmail.data ?? []) as Array<{ email: string | null }>) {
        for (const id of idsPorEmail.get(String(k.email ?? '').trim().toLowerCase()) ?? []) avulsos.add(id);
      }
    }
  }
  return avulsos;
}

/**
 * O instante (ms) do carimbo mais recente de WhatsApp frio desta pessoa: `recep_sent:<id>:rN` e `ativ_proposta_sent:<id>` (a 2b do pós-venda), pelo
 * `updated_at` da linha em system_state (a hora do claim). Chaves exatas. Esta é a trava de espaçamento que NÃO depende da conversa (wa_mensagens pode
 * não ter o envio). Erro de leitura LANÇA.
 */
async function ultimoCarimboDaPessoa(ids: readonly string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for (const lote of emLotes(ids, 25)) {
    const chaves = lote.flatMap(id => [...TOQUES.map(t => chaveRecepSent(id, t)), chaveAtivProposta(id)]);
    const { data, error } = await supabase.from('system_state').select('key, updated_at').in('key', chaves);
    if (error) throw new Error('leitura dos carimbos da pessoa falhou');
    for (const l of (data ?? []) as Array<{ key: string; updated_at: string | null }>) {
      const t = tsMs(l.updated_at);
      const id = l.key.startsWith(PREFIXO_ATIV_PROPOSTA) ? l.key.slice(PREFIXO_ATIV_PROPOSTA.length) : (l.key.slice(PREFIXO_RECEP_SENT.length).split(':')[0] ?? '');
      if (t > 0 && id && t > (mapa.get(id) ?? 0)) mapa.set(id, t);
    }
  }
  return mapa;
}

/** Para cada usuário, quais toques estão fechados (chave de enviado ou de pulado). Erro de leitura LANÇA. */
async function lerFechados(
  ids: readonly string[], chaveEnviado: (id: string, t: ToqueRecep) => string, chavePulo: (id: string, t: ToqueRecep) => string,
): Promise<Map<string, Set<ToqueRecep>>> {
  const todas: string[] = [];
  for (const id of ids) for (const t of TOQUES) todas.push(chaveEnviado(id, t), chavePulo(id, t));
  const existentes = await chavesExistentes(todas);
  const mapa = new Map<string, Set<ToqueRecep>>();
  for (const id of ids) {
    mapa.set(id, new Set(TOQUES.filter(t => existentes.has(chaveEnviado(id, t)) || existentes.has(chavePulo(id, t)))));
  }
  return mapa;
}

async function gravarPulos(userId: string, toques: readonly ToqueRecep[], chave: (id: string, t: ToqueRecep) => string, agora: Date, motivo: string): Promise<void> {
  for (const t of toques) {
    const v = await reservarChave(chave(userId, t), { motivo }, agora);
    if (v === 'erro') logger.error(LOG, `não gravei o pulado ${chave(userId, t)}`);
  }
}

// ── a sonda automática antes do 1º envio ─────────────────────────────────────
// Condições do chefe-antiban (padrão da Carla, usu_rec_sonda_ok). Prova, com a linha de verdade, que o carimbo `recep_sent:` come exatamente 1 vaga do
// frio, que o espaçamento o enxerga e que a chave sai sem rastro. Só então grava `recep_sonda_ok`. O carimbo de teste não leva telefone.

export type VagasFrio = { hora: { teto: number; usadas: number }; dia: { teto: number; usadas: number } };

export interface DepsSondaRecep {
  vagas(): Promise<VagasFrio | null>;
  inserir(chave: string, valor: Record<string, unknown>, agora: Date): Promise<'ok' | 'ja' | 'erro'>;
  apagar(chave: string): Promise<boolean>;
  /** respeitaEspacamentoLinha(): true = pode enviar. Lança se não leu. */
  espacamento(): Promise<boolean>;
  /** O `updated_at` da chave, como veio do banco, ou null se não existe ou não deu para ler. */
  atualizadoEm(chave: string): Promise<string | null>;
  /** Apaga a chave SÓ se o `updated_at` ainda é o lido (key E updated_at): dois ticks não apagam o claim novo um do outro. true = esta chamada apagou a linha. */
  apagarSeIgual(chave: string, atualizadoEm: string): Promise<boolean>;
  avisar(assunto: string, html: string): Promise<void>;
}

type Passada = { ok: true } | { ok: false; motivo: string; repetir: boolean; adiar?: boolean };

async function passadaDaSonda(agora: Date, d: DepsSondaRecep): Promise<Passada> {
  // 1) O espaçamento tem que dar true ANTES (se já dá false, a prova de "depois" não prova nada): não é falha, a próxima rodada tenta.
  let antes: boolean | null;
  try { antes = await d.espacamento(); } catch { antes = null; }
  // Antes de gravar qualquer coisa, leitura que falha é erro passageiro (a próxima rodada tenta de novo), não reprovação.
  if (antes === null) return { ok: false, motivo: 'espacamento_nao_leu', repetir: false, adiar: true };
  if (antes === false) return { ok: false, motivo: 'espacamento_ocupado_antes', repetir: false, adiar: true };

  const v0 = await d.vagas();
  if (!v0) return { ok: false, motivo: 'leitura_das_vagas', repetir: false, adiar: true };

  // 2) Grava o carimbo de teste (sem telefone).
  const chave = `${PREFIXO_RECEP_SENT}sonda:${agora.getTime()}`;
  const gravou = await d.inserir(chave, { sonda: true }, agora);
  if (gravou !== 'ok') {
    const limpou = await d.apagar(chave);
    return { ok: false, motivo: !limpou ? 'chave_da_sonda_ficou' : gravou === 'ja' ? 'carimbo_da_sonda_ja_existia' : 'carimbo_da_sonda_nao_gravou', repetir: false };
  }

  // 3) A vaga do dia subiu 1 e o espaçamento virou false.
  let v1: VagasFrio | null = null;
  let espacamento: boolean | null = null;
  let apagou = false;
  try {
    v1 = await d.vagas();
    try { espacamento = await d.espacamento(); } catch { espacamento = null; }
  } finally {
    // 4) Apaga a chave (sempre).
    apagou = await d.apagar(chave);
  }
  if (!apagou) return { ok: false, motivo: 'chave_da_sonda_ficou', repetir: false };
  if (!v1) return { ok: false, motivo: 'leitura_das_vagas', repetir: false };
  if (espacamento !== false) return { ok: false, motivo: espacamento === null ? 'espacamento_nao_leu' : 'espacamento_nao_viu_a_chave', repetir: false };
  // Outro frio pode ter entrado no meio: a diferença errada repete uma vez.
  if (v1.dia.usadas - v0.dia.usadas !== 1) return { ok: false, motivo: 'vaga_nao_caiu_exatamente_1', repetir: true };

  // 4b) Os dois voltaram (a vaga do dia e o espaçamento).
  const v2 = await d.vagas();
  if (!v2) return { ok: false, motivo: 'leitura_das_vagas', repetir: false };
  let depois: boolean | null;
  try { depois = await d.espacamento(); } catch { depois = null; }
  if (v2.dia.usadas !== v0.dia.usadas || depois !== true) return { ok: false, motivo: 'vaga_ou_espacamento_nao_voltou', repetir: true };
  return { ok: true };
}

const CHAVE_SONDA_CLAIM = 'recep_sonda_claim';
/** Claim da sonda com mais disto é de uma rodada que caiu no meio: é ignorado e retomado. */
export const CLAIM_DA_SONDA_VELHO_MS = 10 * 60_000;

/**
 * Roda a sonda. 'ok' = passou e gravou `recep_sonda_ok`; 'adiada' = a linha estava ocupada (tenta na próxima rodada); 'falhou' = reprovou (marca
 * `recep_sonda_falhou` com o motivo, log e e-mail ao dono; a recepção NÃO liga até alguém apagar a marca); 'ocupada' = outro tick está rodando;
 * 'erro' = nada ficou gravado (tenta na próxima). Nunca lança.
 */
export async function rodarSondaRecepcao(agora: Date, d: DepsSondaRecep): Promise<'ok' | 'adiada' | 'falhou' | 'ocupada' | 'erro'> {
  try {
    let claim = await d.inserir(CHAVE_SONDA_CLAIM, {}, agora);
    if (claim === 'ja') {
      // Claim com mais de 10 min não segura ninguém: apaga e tenta de novo uma vez.
      const lido = await d.atualizadoEm(CHAVE_SONDA_CLAIM);
      const desde = lido === null ? 0 : tsMs(lido);
      if (!desde || agora.getTime() - desde <= CLAIM_DA_SONDA_VELHO_MS) return 'ocupada';
      // Só apaga a linha que LEMOS (key e updated_at): se outro tick já a trocou por um claim novo, este não o apaga.
      if (!(await d.apagarSeIgual(CHAVE_SONDA_CLAIM, lido!))) return 'ocupada';
      logger.warn(LOG, 'claim da sonda velho retomado');
      claim = await d.inserir(CHAVE_SONDA_CLAIM, {}, agora);
      if (claim === 'ja') return 'ocupada';
    }
    if (claim === 'erro') return 'erro';
    let r: Passada = { ok: false, motivo: 'nao_rodou', repetir: false };
    let tentativas = 0;
    for (;;) {
      tentativas++;
      try { r = await passadaDaSonda(agora, d); } catch (e) {
        r = { ok: false, motivo: 'excecao', repetir: false };
        logger.error(LOG, `a sonda lançou (${String((e as Error)?.message ?? e).slice(0, 80)})`);
      }
      if (r.ok || !r.repetir || tentativas >= 2) break;
    }
    if (r.ok) {
      const grav = await d.inserir(CHAVE_RECEP_SONDA_OK, { tentativas }, agora);
      await d.apagar(CHAVE_SONDA_CLAIM).catch(() => false);
      if (grav === 'erro') { logger.error(LOG, 'a sonda passou e a marca ok não gravou: a recepção fica esperando'); return 'erro'; }
      logger.info(LOG, `sonda automática passou (tentativas ${tentativas}): a recepção pode enviar`);
      return 'ok';
    }
    if (r.adiar) {
      await d.apagar(CHAVE_SONDA_CLAIM).catch(() => false);
      logger.info(LOG, 'sonda adiada: já havia envio recente na linha');
      return 'adiada';
    }
    const motivo = r.motivo;
    const marca = await d.inserir(CHAVE_RECEP_SONDA_FALHOU, { motivo, tentativas }, agora);
    await d.apagar(CHAVE_SONDA_CLAIM).catch(() => false);
    logger.error(LOG, `a sonda reprovou (${motivo}): recepção parada`, { motivo, tentativas });
    await d.avisar('Recepção de usuários novos parada: a sonda de segurança reprovou', [
      `<p>A sonda automática da recepção de usuários novos da SolarDoc reprovou e o robô NÃO enviou nada. Motivo: ${motivo}.</p>`,
      motivo === 'chave_da_sonda_ficou'
        ? `<p>A chave de teste ${PREFIXO_RECEP_SENT}sonda:&lt;número&gt; pode ter ficado no system_state e come 1 vaga do frio por 24 horas. Apague-a à mão.</p>`
        : '<p>Nenhuma mensagem foi enviada e a chave de teste não ficou no banco.</p>',
      marca === 'ok'
        ? `<p>Para refazer a sonda, apague ${CHAVE_RECEP_SONDA_FALHOU} do system_state. Enquanto ela existir, a recepção fica parada.</p>`
        : '<p>A marca de falha não gravou: a sonda roda de novo na próxima rodada.</p>',
    ].join('')).catch(e => logger.error(LOG, `o e-mail de alerta da sonda não saiu (${String((e as Error)?.message ?? e).slice(0, 60)})`));
    return 'falhou';
  } catch (e) {
    logger.error(LOG, `a sonda falhou por exceção (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return 'erro';
  }
}

export function depsReaisSondaRecepcao(): DepsSondaRecep {
  return {
    async vagas() { try { return await vagasDoFrioLinha(); } catch { return null; } },
    async inserir(chave, valor, agora) {
      const v = await reservarChave(chave, valor, agora);
      return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro';
    },
    async apagar(chave) {
      try { const { error } = await supabase.from('system_state').delete().eq('key', chave); return !error; } catch { return false; }
    },
    espacamento: () => respeitaEspacamentoLinha(),
    async atualizadoEm(chave) {
      try {
        const { data, error } = await supabase.from('system_state').select('updated_at').eq('key', chave).maybeSingle();
        const v = (data as { updated_at?: string | null } | null)?.updated_at;
        return error || !v ? null : String(v);
      } catch { return null; }
    },
    async apagarSeIgual(chave, atualizadoEm) {
      try {
        const { data, error } = await supabase.from('system_state').delete().eq('key', chave).eq('updated_at', atualizadoEm).select('key');
        return !error && (data ?? []).length === 1;
      } catch { return false; }
    },
    // O mailer cria o cliente do Resend ao carregar: import tardio, só quando a sonda reprova.
    async avisar(assunto, corpo) { const { sendOpsAlert } = await import('../../utils/mailer'); await sendOpsAlert(assunto, corpo); },
  };
}

/** A sonda já passou? Se não, e não reprovou antes, roda agora. 'ok' libera o envio; qualquer outra coisa segura. */
async function sondaLiberada(agora: Date): Promise<{ ok: true } | { ok: false; motivo: string }> {
  let achadas: Set<string>;
  try { achadas = await chavesExistentes([CHAVE_RECEP_SONDA_OK, CHAVE_RECEP_SONDA_FALHOU]); } catch { return { ok: false, motivo: 'leitura_falhou' }; }
  if (achadas.has(CHAVE_RECEP_SONDA_OK)) return { ok: true };
  if (achadas.has(CHAVE_RECEP_SONDA_FALHOU)) return { ok: false, motivo: 'sonda_falhou' };
  const r = await rodarSondaRecepcao(agora, depsReaisSondaRecepcao());
  return r === 'ok' ? { ok: true } : { ok: false, motivo: `sonda_${r}` };
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

interface CandidataWhats { u: UsuarioRecep; tel: string; chave: string; idadeMs: number; fechados: Set<ToqueRecep> }

export async function enviarRecepcaoWhatsApp(agoraDate: Date = new Date()): Promise<ResultadoTick> {
  if (desligada()) return off();
  const r: ResultadoTick = { enviados: 0, pulados: 0, erros: 0 };
  const agora = agoraDate.getTime();

  const publico = await lerPublico(agora);
  if (!publico) return { ...r, erros: 1, motivo: 'leitura_falhou' };

  const base = publico.filter(u => u.whatsapp_opt_out !== true && !!telefoneValido(u.whatsapp) && !!telefoneDoUsuario({ whatsapp: u.whatsapp }));
  if (!base.length) return { ...r, motivo: 'sem_candidatos' };

  let fechadosPorId: Map<string, Set<ToqueRecep>>;
  let passos: Map<string, PassosLidos>;
  try {
    fechadosPorId = await lerFechados(base.map(u => u.id), chaveRecepSent, chaveRecepPulo);
    const abertas = base.filter(u => (fechadosPorId.get(u.id)?.size ?? 0) < TOQUES.length);
    passos = await carregarPassosEmLote(abertas.map(u => u.id));
  } catch (err) {
    logger.error(LOG, 'leitura dos toques ou dos passos falhou', err);
    return { ...r, erros: 1, motivo: 'leitura_falhou' };
  }

  // Quem tem algo a fazer agora (enviar ou pular), mais antigas primeiro (a leitura já vem ordenada por created_at).
  const cands: Array<CandidataWhats & { enviar: ToqueRecep | null; pular: ToqueRecep[] }> = [];
  for (const u of base) {
    const lidos = passos.get(u.id);
    if (!lidos) continue;
    const fechados = fechadosPorId.get(u.id) ?? new Set<ToqueRecep>();
    const idadeMs = agora - tsMs(u.created_at);
    const e = escolherToque(idadeMs, lidos.resultado.proximo, fechados);
    if (e.enviar === null && !e.pular.length) { r.pulados++; continue; }
    cands.push({ u, tel: telefoneValido(u.whatsapp)!, chave: telefoneDoUsuario({ whatsapp: u.whatsapp })!.chave, idadeMs, fechados, ...e });
  }
  if (!cands.length) return { ...r, motivo: 'sem_candidatos' };

  // Nada é gravado (nem pulado) nem enviado antes da sonda passar: a 1ª rodada não pode carimbar ninguém para sempre.
  const sonda = await sondaLiberada(agoraDate);
  if (!sonda.ok) return { ...r, motivo: sonda.motivo };

  // Toque que só vira pulado (tudo pronto): grava e segue, sem tocar na linha.
  for (const c of cands) {
    if (c.enviar !== null) continue;
    await gravarPulos(c.u.id, c.pular, chaveRecepPulo, agoraDate, 'tudo_pronto');
    r.pulados++;
  }

  // Trava que não depende da conversa: o último carimbo de WhatsApp frio desta pessoa (`recep_sent` ou `ativ_proposta_sent` da 2b) com menos de 48 h a segura nesta rodada.
  let ultimoCarimbo: Map<string, number>;
  try { ultimoCarimbo = await ultimoCarimboDaPessoa(cands.filter(c => c.enviar !== null).map(c => c.u.id)); }
  catch (err) { logger.error(LOG, 'leitura dos carimbos falhou', err); return { ...r, erros: r.erros + 1, motivo: 'leitura_falhou' }; }

  const instanciaId = instanciaDaLinhaSolardoc();
  const portao = novaRodadaPortao(() => new Date(agora), { robo: ROBO_RECEPCAO });
  for (const c of cands) {
    if (c.enviar === null) continue;
    const { u } = c;

    const carimbo = ultimoCarimbo.get(u.id);
    if (carimbo !== undefined && agora - carimbo <= JANELA_TOQUE_NOSSO_MS) { r.pulados++; if (!r.motivo) r.motivo = 'carimbo_recente'; continue; }

    // A conversa da linha SolarDoc, ANTES do claim. Conversa que não foi lida por inteiro = na dúvida, não fala.
    const conv = await lerConversa(c.chave, { instanciaId });
    if (!conv.completa) { r.pulados++; if (!r.motivo) r.motivo = 'conversa_nao_lida'; continue; }
    const decisao = decidirPelaConversa(conv.msgs, agora);
    if (decisao === 'mudo') {
      await gravarPulos(u.id, TOQUES.filter(t => !c.fechados.has(t)), chaveRecepPulo, agoraDate, 'mudo_pela_conversa');
      r.pulados++;
      continue;
    }
    if (decisao === 'esperar') { r.pulados++; if (!r.motivo) r.motivo = 'conversa_recente'; continue; }

    const v = await portao.avaliar(c.tel);
    if (!v.ok) { r.pulados++; if (!r.motivo) r.motivo = v.motivo; continue; }

    const chave = chaveRecepSent(u.id, c.enviar);
    const claim = await tomarChaveFria(chave, agoraDate);
    if (claim === 'ja') { r.pulados++; continue; }
    if (claim === 'erro') return { ...r, erros: r.erros + 1, motivo: 'claim_falhou' };

    let podeTerSaido = false;   // só vira true na linha do sendFrio: até lá, qualquer erro prova que nada saiu
    try {
      // Relê os passos logo antes de enviar: quem fez o passo no meio da rodada recebe o texto certo (ou nenhum).
      const frescos = await carregarPassos(u.id);
      if (!frescos) { await soltarChaveFria(chave); r.pulados++; continue; }
      const nova = escolherToque(c.idadeMs, frescos.proximo, c.fechados);
      if (nova.enviar !== c.enviar) { await soltarChaveFria(chave); r.pulados++; continue; }
      const proposta = frescos.passos.find(p => p.id === 'proposta')?.feito === true;
      const fotos = frescos.passos.find(p => p.id === 'fotos')?.feito === true;
      const texto = textoRecepcao(c.enviar, nomeParaSaudar(u.nome), { proximo: frescos.proximo, temProposta: proposta, fotosFeito: fotos });
      if (!texto) { await soltarChaveFria(chave); r.pulados++; continue; }
      podeTerSaido = true;
      const saiu = await sendFrio(c.tel, [texto], 'solardoc');
      if (!saiu) { await soltarChaveFria(chave); r.pulados++; continue; }
      portao.travarRodada('ja_enviou_na_rodada');
      r.enviados++;
      await gravarPulos(u.id, nova.pular, chaveRecepPulo, agoraDate, 'toque_maior_enviado');
      await registrarNaSessaoDaGiovanna(u.id, c.tel, texto, nomeParaSaudar(u.nome));
      break;                                                     // 1 por rodada
    } catch (err) {
      // Erro ANTES do sendFrio (leitura dos passos, texto): nada saiu, o claim é solto e a rodada para. Erro DO sendFrio: talvez saiu, o claim FICA.
      if (!podeTerSaido) await soltarChaveFria(chave);
      r.erros++;
      logger.error(LOG, `envio da recepção falhou (${u.id})`, err);
      break;
    }
  }
  return r;
}

// ── e-mail ───────────────────────────────────────────────────────────────────

export async function enviarRecepcaoEmail(agoraDate: Date = new Date()): Promise<ResultadoTick> {
  if (desligada()) return off();
  const r: ResultadoTick = { enviados: 0, pulados: 0, erros: 0 };
  const agora = agoraDate.getTime();

  const publico = await lerPublico(agora);
  if (!publico) return { ...r, erros: 1, motivo: 'leitura_falhou' };
  // 1 e-mail nosso por dia: quem levou e-mail de outra cadência nas últimas 23 h (as 4 colunas) fica para a próxima rodada. O followupService é
  // carregado só aqui (ele cria o cliente do Stripe ao carregar).
  const { recebeuEmailRecente } = await import('../followupService');
  const base = publico.filter(u => u.email_opt_out !== true && String(u.email ?? '').trim() !== '' && !recebeuEmailRecente(u as unknown as Record<string, unknown>));
  if (!base.length) return { ...r, motivo: 'sem_candidatos' };

  let fechadosPorId: Map<string, Set<ToqueRecep>>;
  let passos: Map<string, PassosLidos>;
  try {
    fechadosPorId = await lerFechados(base.map(u => u.id), chaveRecepEmail, chaveRecepEmailPulo);
    const abertas = base.filter(u => (fechadosPorId.get(u.id)?.size ?? 0) < TOQUES.length);
    passos = await carregarPassosEmLote(abertas.map(u => u.id));
  } catch (err) {
    logger.error(LOG, 'leitura dos e-mails ou dos passos falhou', err);
    return { ...r, erros: 1, motivo: 'leitura_falhou' };
  }

  for (const u of base) {
    if (r.enviados >= EMAIL_TETO_RECEPCAO_POR_RODADA) break;
    const lidos = passos.get(u.id);
    if (!lidos) continue;
    if (!emailDaRecepcaoPodeIr(lidos)) { r.pulados++; continue; }
    const e = escolherToque(agora - tsMs(u.created_at), lidos.resultado.proximo, fechadosPorId.get(u.id) ?? new Set<ToqueRecep>());
    if (e.enviar === null) {
      if (e.pular.length) await gravarPulos(u.id, e.pular, chaveRecepEmailPulo, agoraDate, 'tudo_pronto');
      r.pulados++;
      continue;
    }

    const chave = chaveRecepEmail(u.id, e.enviar);
    const claim = await tomarChaveFria(chave, agoraDate);
    if (claim === 'ja') { r.pulados++; continue; }
    if (claim === 'erro') return { ...r, erros: r.erros + 1, motivo: 'claim_falhou' };
    try {
      // O mailer cria o cliente do Resend ao carregar: import tardio.
      const { sendRecepcaoEmail } = await import('../../utils/mailer');
      const saiu = await sendRecepcaoEmail({ to: String(u.email), userId: u.id, nome: u.nome, toque: e.enviar, passos: lidos.resultado });
      if (!saiu) { await soltarChaveFria(chave); r.pulados++; continue; }
      r.enviados++;
      await gravarPulos(u.id, e.pular, chaveRecepEmailPulo, agoraDate, 'toque_maior_enviado');
    } catch (err) {
      // O envio falhou (Resend): nada saiu, solta o claim e para a rodada.
      await soltarChaveFria(chave);
      r.erros++;
      logger.error(LOG, `e-mail da recepção falhou (${u.id})`, err);
      break;
    }
  }
  return r;
}

/**
 * Free SEM empresa fica de fora do e-mail: a cadência de CNPJ do followupService já cobre essa pessoa (a audiência dela é plano free e nenhuma linha
 * em `company`). Quem tem empresa, ou paga, entra.
 */
export function emailDaRecepcaoPodeIr(p: Pick<PassosLidos, 'plano' | 'temLinhaEmpresa'>): boolean {
  return !(p.plano === 'free' && !p.temLinhaEmpresa);
}

// ── a entrada do cron ────────────────────────────────────────────────────────

/** O WhatsApp da recepção. Nunca lança. */
export async function rodarRecepcaoWhatsApp(agora: Date = new Date()): Promise<ResultadoTick> {
  try { return await enviarRecepcaoWhatsApp(agora); } catch (err) {
    logger.error(LOG, 'o WhatsApp da recepção caiu', err);
    return { enviados: 0, pulados: 0, erros: 1, motivo: 'excecao' };
  }
}

/** O e-mail da recepção. Nunca lança. */
export async function rodarRecepcaoEmail(agora: Date = new Date()): Promise<ResultadoTick> {
  try { return await enviarRecepcaoEmail(agora); } catch (err) {
    logger.error(LOG, 'o e-mail da recepção caiu', err);
    return { enviados: 0, pulados: 0, erros: 1, motivo: 'excecao' };
  }
}
