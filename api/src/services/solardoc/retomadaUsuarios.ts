// ─────────────────────────────────────────────────────────────────────────────
// A CARLA RETOMA OS USUÁRIOS DA SOLARDOC QUE NÃO PAGAM (03/11/2026). Robô `carla_retomada_usuarios` (frio_p5). UMA bolha, sem link, por
// sendFrio, pela linha 5040, uma vez por pessoa, para sempre.
//
// Pedido do dono: "a agente responsável pela venda da SolarDoc continue o follow-up com nossos usuários, mostrar as novidades e recuperar
// o máximo possível de usuário, vou acompanhar o atendimento dela, pode iniciar." Molde: solardoc/recuperacaoCarla.ts (o robô do quiz).
//
// PÚBLICO: conta de `users` com WhatsApp que NÃO paga hoje (grátis que nunca pagou, ou ex-assinante). Fica fora: assinante ativo e quem
// está em cobrança, opt-out, supressão, pausa humana, o mudo, quem levou toque da linha em 14 dias, quem tem conversa com outra dona,
// conta de admin ou de teste e telefone de linha nossa (as regras e a ordem moram em retomadaUsuariosRegras.ts).
//
// LIGA E DESLIGA (retomadaUsuariosEstado.ts): nasce LIGADO; a env CARLA_RETOMADA_USUARIOS_OFF='1' desliga; a chave de banco
// `usu_rec_pausa` (system_state) também. A chave é lida antes de CADA envio e leitura que falha vale desligado.
//
// A RODADA (cada 10 min, UM envio no máximo; o /process-messages chama a cada 2 min e a vez de 10 min é por insert):
//   0. estado (ligada?), segredo de HMAC e o texto do redator (sem texto não envia);   1. a largada (gravada na 1ª rodada);
//   2. o início: nunca antes do piso e nunca no dia do deploy (inicioEfetivoMs), depois a janela 9h-20h BRT, segunda a sábado;
//   3. as travas, nesta ordem: a Carla atende todos > IA > linha pausada > teto do frio {robo} > espaçamento > CEDE À AGENDA >
//      teto de 25 em 24 h;   4. a vez (insert usu_rec_vez:<faixa de 10 min>);
//   5. o público (uma leitura por rodada), a fila e o resumo;   6. por pessoa, ANTES do claim e do barato ao caro: supressão, bloqueio,
//      número de teste, posse, conversa, pausa humana, outro robô, Carla atende, texto; depois o phone-exists;
//   7. as travas de novo (a janela e a chave do banco também), o claim (usu_rec_sent:<hmac>, para sempre), assumirPosse('carla') com a
//      origem da retomada, releitura da conversa e da supressão (qualquer sinal novo: desfaz a posse e apaga o claim) e sendFrio.
// A trava `cede_a_agenda` (D28): a campanha não sai quando a linha INTEIRA já tem, na última hora, tantos carimbos quanto o limite
// (no máximo 4). A confirmação de ficha atrasada da agenda só sai com a linha abaixo do teto da hora; a agenda vem primeiro.
//
// ERROS: o claim e a posse só voltam quando o erro PROVA que nada saiu (cooldown, credencial) ou o robô desistiu antes do envio.
// Erro de DESTINO (número inválido): o claim fica (nunca tenta de novo), a posse volta e NÃO conta como erro da linha. Timeout e 5xx
// podem ter saído: claim e posse ficam e o erro conta. Dois erros de linha seguidos pausam a linha (15 min) E a campanha (à mão).
// Telefone cru nunca vai para system_state, log ou relatório: só hmac, o id da conta e o primeiro nome (no seco, só para o dono ver).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { numeroTemWhatsApp, sendFrio } from '../agents/zapiClient';
import {
  carimbosDaLinhaNaHora, dentroDaJanelaDaBaseLinha, dentroDoTetoHorarioLinha, respeitaEspacamentoLinha, vagasDoFrioLinha,
} from '../agents/whatsapp/lineThrottle';
import { carregarPausas } from '../agents/whatsapp/pausaHumana';
import { motivosDaSupressao } from '../agents/whatsapp/silenciar';
import { hmacDe } from '../agentes5040/hmac';
import {
  carregarListasDeBarragem, lerConversa, lerFatosPorteiro, type ConversaLida, type ListasDeBarragem,
} from '../agentes5040/contexto';
import {
  ORIGEM_RETOMADA_USUARIOS, RETOMADA_VALE_MS, agenteAtendeEste, assumirPosse, desfazerPosseNova, lerPosse, type ResultadoAssumir,
} from '../agentes5040/posse';
import { chavesExistentes, liberarChave, reservarChave } from '../agentes5040/cota';
import { CHAVE_LINHA_ERROS, CHAVE_LINHA_PAUSA, codigoDoErroDeEnvio, erroEhDoDestino } from '../agentes5040/vivoEnvio';
import {
  TELEFONES_DE_RESERVA, carregarTelefonesConsultores, erroProvaQueNaoSaiu, leadEhDeTeste, telefoneDoDono,
} from '../agentes5040/fichaEnvio';
import type { FatosPorteiro } from '../agentes5040/tipos';
import { primeiroNome } from '../nexus/email';
import {
  ADIANTO_DO_DOCUMENTO_MS, AVALIACOES_POR_RODADA, CHAVE_RESUMO_RET, JANELA_DOC_ATIVO_MS, PREFIXO_CARIMBO_RET, PREFIXO_FORA_RET, PREFIXO_VEZ_RET,
  ROBO_RETOMADA_USUARIOS, TELEFONE_DA_LINHA_5040, RESERVA_DO_QUIZ_24H, TETO_CAMPANHA_24H, chaveVezRet, chavesRepetidas, classificarUsuario, cnpjDe14, inicioEfetivoMs,
  limiteCedeAAgenda, marcaDoMotivo, montarChavesDaCasa, motivoDaConversa, ordenarFila, pagaHoje, pisoDoCodigoMs, telefoneDoUsuario, textoDaRetomada,
  textosVazios, type Classificacao, type ExtrasRet, type MarcaForaRet, type UsuarioRet, type VendaRet,
} from './retomadaUsuariosRegras';
import {
  estadoRetomadaUsuarios, garantirLargadaRet, lerCarlaAtendeTodos, lerIaParada, lerLargadaRet, lerLinhaPausada, pausarRetomada,
  type EstadoRetomada,
} from './retomadaUsuariosEstado';

const LOG = 'retomada-usuarios';
const ERROS_PARA_PAUSAR = 2;
const PAUSA_LINHA_MS = 15 * 60_000;
const PAGINA = 1000;
/** Defesa: nenhuma leitura paginada passa de tantas páginas (o PostgREST corta em 1000 linhas por chamada). */
const MAX_PAGINAS = 100;

// ── o público lido e a fila ──────────────────────────────────────────────────

export const EXTRAS_VAZIOS: ExtrasRet = Object.freeze({
  vendas: [], ultimoDocumentoBrutoMs: null, temCnpj: false, toquesCurso19: 0, nexusConviteEmMs: null, jaNaCampanha: false, marcaFora: null,
});

/** O que a leitura traz: os usuários com WhatsApp e, para quem chegou até o fim das exclusões baratas, o que veio de outras tabelas. */
export interface PublicoLido {
  usuarios: UsuarioRet[];
  extras: (u: UsuarioRet) => ExtrasRet;
  chavesDaCasa: ReadonlySet<string>;
}

export type ItemFila = Extract<Classificacao, { ok: true }> & { u: UsuarioRet };

export interface FilaMontada { fila: ItemFila[]; porMotivo: Record<string, number>; total: number }

/** Classifica todo mundo (a mesma função para o robô e para o seco) e ordena quem entra. */
export function montarFila(pub: PublicoLido, agoraMs: number, largadaMs: number): FilaMontada {
  const repetidas = chavesRepetidas(pub.usuarios);
  const porMotivo: Record<string, number> = {};
  const fila: ItemFila[] = [];
  for (const u of pub.usuarios) {
    const t = telefoneDoUsuario(u);
    const hmac = t ? hmacDe(t.chave) : null;
    const c = classificarUsuario(u, pub.extras(u), { agoraMs, largadaMs, chavesDaCasa: pub.chavesDaCasa, repetidas, hmac });
    if (c.ok) fila.push({ ...c, u });
    else porMotivo[c.motivo] = (porMotivo[c.motivo] ?? 0) + 1;
  }
  return { fila: ordenarFila(fila), porMotivo, total: pub.usuarios.length };
}

// ── a avaliação de uma pessoa (a mesma para o robô e para o seco) ────────────

/** As leituras da avaliação 1 a 11 de cada pessoa. O robô passa as de verdade; os testes, um falso. */
export interface DepsAvaliarRet {
  ehNumeroDeTeste(chave: string): Promise<boolean | null>;
  /** 'livre', o estado da posse que já existe (qualquer dona) ou 'erro'. */
  posse(chave: string): Promise<'livre' | { estado: string } | 'erro'>;
  conversa(chave: string): Promise<ConversaLida>;
  fatosPorteiro(chave: string, msgs: ConversaLida['msgs'], listas: ListasDeBarragem, agora: Date): Promise<FatosPorteiro>;
  carlaAtende(tel: string): Promise<boolean>;
  primeiroNome(nome: string | null | undefined): string;
}

export type AvaliacaoRet =
  | { ok: true; texto: string; variacao: number; primeiro: string; ultimoId: number }
  | { ok: false; motivo: string; marca: { ate?: string } | null };

const recusar = (motivo: string, agoraMs: number, extra: { toqueMs?: number; falaMs?: number } = {}): AvaliacaoRet =>
  ({ ok: false, motivo, marca: marcaDoMotivo(motivo, agoraMs, extra) });

/**
 * Tudo que dá para saber SEM falar com ninguém e sem o phone-exists, do barato ao caro (plano 5.4, linhas 1 a 11): supressão, bloqueio,
 * número de teste, posse que já existe, conversa, toque recente, fala recente, mudo pela conversa, pausa humana e equipe, outro robô,
 * conta que casa com o telefone, a Carla atende este lead e o texto. O primeiro motivo vale e traz a marca de `usu_rec_fora`.
 */
export async function avaliarPessoa(
  item: ItemFila, ctx: { agora: Date; listas: ListasDeBarragem }, d: DepsAvaliarRet,
): Promise<AvaliacaoRet> {
  const agoraMs = ctx.agora.getTime();
  if (ctx.listas.silenciado(item.tel)) return recusar('suprimido', agoraMs);
  if (ctx.listas.bloqueado(item.tel)) return recusar('bloqueado', agoraMs);
  const teste = await d.ehNumeroDeTeste(item.chave);
  if (teste === null) return recusar('leitura_falhou', agoraMs);
  if (teste) return recusar('numero_de_teste', agoraMs);
  const posse = await d.posse(item.chave);
  if (posse === 'erro') return recusar('leitura_falhou', agoraMs);
  if (posse !== 'livre') return recusar(`posse_existente:${String(posse.estado).slice(0, 30)}`, agoraMs);
  const conv = await d.conversa(item.chave);
  if (!conv.completa) return recusar('leitura_falhou', agoraMs);
  const dela = motivoDaConversa(conv.msgs, agoraMs);
  if (dela) return recusar(dela.motivo, agoraMs, { toqueMs: dela.toqueMs, falaMs: dela.falaMs });
  const fatos = await d.fatosPorteiro(item.chave, conv.msgs, ctx.listas, ctx.agora);
  if (!fatos.leituraOk) return recusar('leitura_falhou', agoraMs);
  if (fatos.humanoNaConversa) return recusar('humano_na_conversa', agoraMs);
  if (fatos.outroRoboAtivo) return recusar('outro_robo', agoraMs);
  // Reunião de eletroposto marcada: o "SIM" ou o "quero remarcar" dele é dos robôs da agenda, que não leem a posse da Carla. Duas respostas para uma mensagem.
  if (fatos.reuniaoEletroposto) return recusar('reuniao_ativa', agoraMs);
  if (!fatos.ehClienteSolarDoc) return recusar('telefone_nao_casa_com_a_conta', agoraMs);
  if (!(await d.carlaAtende(item.tel))) return recusar('carla_nao_atende', agoraMs);
  const primeiro = d.primeiroNome(item.u.nome);
  const texto = textoDaRetomada(item.grupo, primeiro, item.hmac);
  if (!texto.ok) return recusar(texto.motivo, agoraMs);
  return {
    ok: true, texto: texto.texto, variacao: texto.variacao, primeiro,
    ultimoId: conv.msgs.reduce((m, x) => Math.max(m, x.id), 0),
  };
}

// ── a rodada do robô ─────────────────────────────────────────────────────────

/** Os campos da conta que a releitura antes do envio confere: os mesmos do opt-out e do pagaHoje da 1ª leitura. */
export type ContaAgoraRet = Pick<UsuarioRet, 'plano' | 'billing_status' | 'plano_expira_em' | 'whatsapp_opt_out'>;

export interface ResumoRet { em: string; fila: number; por_motivo: Record<string, number>; avaliados: number; enviou: boolean }

export interface DepsRet extends DepsAvaliarRet {
  estado(): Promise<EstadoRetomada>;
  segredoOk(): boolean;
  carlaAtendeTodos(): Promise<boolean>;
  iaParada(agora: Date): Promise<boolean>;
  lerLargada(): Promise<number | null>;
  garantirLargada(agora: Date): Promise<number>;
  /** O piso do início (D35): `Date.parse(INICIO_RETOMADA_ISO)`. O teste injeta o piso que quiser. */
  pisoInicioMs(): number;
  janela(agora: Date): boolean;
  linhaPausada(agora: Date): Promise<'sim' | 'nao' | 'erro'>;
  tetoHorario(): Promise<boolean>;
  espacamento(): Promise<boolean>;
  /** Carimbos da linha inteira na última hora (no máximo 5). O erro LANÇA. */
  linhaNaHora(agora: Date): Promise<number>;
  /** O limite da trava de ceder à agenda, lido a cada chamada. */
  limiteAgenda(): number;
  tetoCampanha(agora: Date): Promise<'ok' | 'cheio' | 'erro'>;
  vagasDoFrio(): Promise<{ hora: { teto: number; usadas: number }; dia: { teto: number; usadas: number } } | null>;
  tomarVez(agora: Date): Promise<'tomada' | 'ocupada' | 'erro'>;
  limparVezes(agora: Date): Promise<void>;
  lerPublico(agora: Date, largadaMs: number): Promise<PublicoLido | null>;
  listas(): Promise<ListasDeBarragem>;
  telefoneExiste(tel: string): Promise<'sim' | 'nao' | 'erro'>;
  claim(chave: string, valor: Record<string, unknown>, agora: Date): Promise<'ok' | 'ja' | 'erro'>;
  apagarClaim(chave: string): Promise<void>;
  marcarClaim(chave: string, valor: Record<string, unknown>): Promise<void>;
  marcarFora(hmac: string, motivo: string, marca: { ate?: string }, agora: Date): Promise<void>;
  assumirPosse(chave: string, em: string, extra: Record<string, unknown>): Promise<ResultadoAssumir>;
  posseAindaNossa(chave: string, em: string): Promise<boolean>;
  desfazerPosse(chave: string, em: string): Promise<boolean>;
  /** Pausa humana estrita, lida na hora. 'sim' = pode falar, 'nao' = tem gente na conversa, 'erro' = não deu para ler. */
  podeFalarAgora(tel: string): Promise<'sim' | 'nao' | 'erro'>;
  supressao(tel: string): Promise<string[] | null>;
  /**
   * A conta relida pelo id, logo antes do envio: o opt-out e o pagamento podem ter mudado depois da leitura do público. 'sumiu' = a conta
   * não existe mais (o opt-out da Giovanna apaga a conta grátis). null = não deu para ler. Nunca lança.
   */
  contaAgora(userId: string): Promise<ContaAgoraRet | 'sumiu' | null>;
  /** true = o envio foi feito. false (a pausa humana calou, ou qualquer retorno que não prove envio) = nada saiu. Erro LANÇA. */
  enviar(tel: string, texto: string): Promise<boolean>;
  erroDeLinha(agora: Date): Promise<void>;
  envioOk(agora: Date): Promise<void>;
  gravarResumo(r: ResumoRet): Promise<void>;
}

export interface DecisaoRet { hmac8: string; resultado: string; motivo: string | null }

export interface RelatorioRet {
  ok: boolean;
  ligada: boolean;
  /** Por que a rodada parou (ou null). */
  motivo: string | null;
  candidatos: number;
  avaliados: number;
  enviou: boolean;
  puladas: Record<string, number>;
  decisoes: DecisaoRet[];
}

export interface OpcoesRet { agora?: Date }

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };
const vazio = (extra: Partial<RelatorioRet> = {}): RelatorioRet => ({
  ok: true, ligada: true, motivo: null, candidatos: 0, avaliados: 0, enviou: false, puladas: {}, decisoes: [], ...extra,
});

/** O horário: ainda antes do início (o piso e o dia do deploy) ou fora da janela? Roda nas DUAS passadas (a rodada pode atravessar as 20h). */
function portaoDeHorario(d: DepsRet, agora: Date, inicio: number): string | null {
  if (agora.getTime() < inicio) return 'antes_do_inicio';
  if (!d.janela(agora)) return 'fora_da_janela';
  return null;
}

/** As travas da linha e da campanha, nesta ordem. Devolve o motivo da primeira que barra, ou null. */
async function travas(d: DepsRet, agora: Date): Promise<string | null> {
  if (!(await d.carlaAtendeTodos())) return 'carla_nao_atende_todos';
  if (await d.iaParada(agora)) return 'ia_parada';
  const pausa = await d.linhaPausada(agora);
  if (pausa !== 'nao') return pausa === 'sim' ? 'linha_pausada' : 'leitura_da_pausa_falhou';
  if (!(await d.tetoHorario())) return 'teto_da_linha';
  if (!(await d.espacamento())) return 'espacamento_da_linha';
  // A agenda primeiro (D28): a linha inteira (frio e agenda) com o limite de carimbos na hora cede a vez. Leitura que falha não envia.
  let naHora: number;
  try { naHora = await d.linhaNaHora(agora); } catch { return 'leitura_da_linha_falhou'; }
  if (naHora >= d.limiteAgenda()) return 'cede_a_agenda';
  const teto = await d.tetoCampanha(agora);
  if (teto !== 'ok') return teto === 'cheio' ? 'teto_da_campanha' : 'leitura_do_teto_falhou';
  // A reserva do quiz: o frio da linha inteira em 24 h (retomada, quiz, checkout) divide o mesmo teto; a campanha para antes do fim e deixa vaga ao quiz.
  let vagas: Awaited<ReturnType<DepsRet['vagasDoFrio']>>;
  try { vagas = await d.vagasDoFrio(); } catch { vagas = null; }
  if (!vagas) return 'leitura_do_teto_falhou';
  if (vagas.dia.usadas >= vagas.dia.teto - RESERVA_DO_QUIZ_24H) return 'reserva_do_quiz';
  return null;
}

export async function runRetomadaUsuariosTick(opts: OpcoesRet = {}, deps?: DepsRet): Promise<RelatorioRet> {
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReais();
  const r = vazio();
  try {
    // 0. ligada? (a chave do banco é lida aqui e de novo antes do envio). Sem o texto do redator é trava GLOBAL: não gasta avaliação.
    const est = await d.estado();
    if (!est.ligada) return { ...r, ligada: false, motivo: est.motivo };
    if (!d.segredoOk()) return { ...r, ok: false, motivo: 'sem_segredo_de_hmac' };
    if (textosVazios()) return { ...r, motivo: 'sem_texto' };

    // 1. o piso primeiro: sem data de início nada sai e a largada NÃO é gravada (o 1º tick depois do deploy não gasta a rede "nunca no dia do deploy")
    if (!Number.isFinite(d.pisoInicioMs())) return { ...r, motivo: 'sem_data_de_inicio' };
    // a largada: a 1ª rodada grava e conta criada depois dela fica fora
    let largada: number;
    try { largada = await d.garantirLargada(agora); } catch (e) {
      logger.error(LOG, `largada falhou: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
      return { ...r, ok: false, motivo: 'largada_falhou' };
    }

    // 2. o início (o piso e o dia do deploy) e a janela
    const inicio = inicioEfetivoMs(largada, d.pisoInicioMs());
    if (inicio === Infinity) return { ...r, motivo: 'sem_data_de_inicio' };
    const horario = portaoDeHorario(d, agora, inicio);
    if (horario) return { ...r, motivo: horario };

    // 3. as travas, nesta ordem
    const barra = await travas(d, agora);
    if (barra) return { ...r, motivo: barra };

    // 4. a vez de 10 min
    const vez = await d.tomarVez(agora);
    if (vez !== 'tomada') return { ...r, motivo: vez === 'ocupada' ? 'vez_ocupada' : 'vez_nao_reservada' };
    await d.limparVezes(agora);

    // 5. o público, a fila e o resumo
    const pub = await d.lerPublico(agora, largada);
    if (!pub) return { ...r, ok: false, motivo: 'leitura_do_publico_falhou' };
    const lida = montarFila(pub, agora.getTime(), largada);
    r.candidatos = lida.fila.length;
    await d.gravarResumo({ em: agora.toISOString(), fila: lida.fila.length, por_motivo: lida.porMotivo, avaliados: 0, enviou: false });
    if (!lida.fila.length) return r;

    // 6. as listas estritas de barragem (uma vez por rodada). Falhou: não envia.
    let listas: ListasDeBarragem;
    try { listas = await d.listas(); } catch { return { ...r, ok: false, motivo: 'listas_de_barragem_falhou' }; }

    for (const item of lida.fila) {
      if (r.avaliados >= AVALIACOES_POR_RODADA) { soma(r.puladas, 'limite_por_rodada'); break; }
      r.avaliados++;
      const hmac8 = item.hmac.slice(0, 8);
      const nota = (resultado: string, motivo: string | null): void => {
        r.decisoes.push({ hmac8, resultado, motivo });
        if (motivo) soma(r.puladas, motivo);
      };

      // 7. antes do claim: as conferências, o texto e o phone-exists
      const av = await avaliarPessoa(item, { agora, listas }, d);
      if (!av.ok) {
        if (av.marca) await d.marcarFora(item.hmac, av.motivo, av.marca, agora).catch(() => undefined);
        nota('pulou', av.motivo);
        continue;
      }
      const existe = await d.telefoneExiste(item.tel);
      if (existe === 'erro') { nota('parou', 'phone_exists_falhou'); break; }
      if (existe === 'nao') {
        // Sem WhatsApp: a Carla não chama nunca (marca sem prazo). Não grava usu_rec_sent, então não pesa no frio.
        await d.marcarFora(item.hmac, 'sem_whatsapp', {}, agora).catch(() => undefined);
        nota('pulou', 'sem_whatsapp');
        continue;
      }

      // 8. as travas de novo: a chave do banco, o início e a JANELA (a rodada pode ter atravessado as 20h) e as sete travas da linha
      const agoraEnvio = opts.agora ?? new Date();
      const est2 = await d.estado();
      if (!est2.ligada) { nota('parou', est2.motivo); r.ligada = false; break; }
      const horario2 = portaoDeHorario(d, agoraEnvio, inicio);
      if (horario2) { nota('parou', horario2); break; }
      const barra2 = await travas(d, agoraEnvio);
      if (barra2) { nota('parou', barra2); break; }

      // 9. o claim (por INSERT), a posse da Carla, a releitura e o envio
      const base = { user_id: item.u.id, segmento: item.segmento, grupo: item.grupo, variacao: av.variacao };
      const chaveClaim = `${PREFIXO_CARIMBO_RET}${item.hmac}`;
      const claim = await d.claim(chaveClaim, { ...base, estado: 'reservado' }, agoraEnvio);
      if (claim === 'ja') { nota('pulou', 'ja_reivindicado'); continue; }
      if (claim === 'erro') { nota('parou', 'erro_no_claim'); break; }

      const em = agoraEnvio.toISOString();
      const retomada = {
        ...base, primeiro_nome: av.primeiro || null, texto: av.texto, em,
        ate: new Date(Date.parse(em) + RETOMADA_VALE_MS).toISOString(),
      };
      let posse = await d.assumirPosse(item.chave, em, { origem: ORIGEM_RETOMADA_USUARIOS, retomada });
      if (posse === 'erro') posse = (await d.posseAindaNossa(item.chave, em)) ? 'assumida' : 'erro';
      if (posse !== 'assumida') {
        await d.apagarClaim(chaveClaim);
        nota(posse === 'ja_tinha_dona' ? 'pulou' : 'parou', posse === 'ja_tinha_dona' ? 'posse_tomada_agora' : 'posse_falhou');
        if (posse === 'erro') break;
        continue;
      }
      const desfazer = async (): Promise<void> => { await d.desfazerPosse(item.chave, em); await d.apagarClaim(chaveClaim); };

      // Releitura logo antes do envio: mensagem nova na conversa, gente da equipe, supressão, conta que pediu para parar ou passou a pagar, ou
      // posse que deixou de ser nossa? Aborta.
      let reler: string | null;
      try {
        const conv2 = await d.conversa(item.chave);
        if (!conv2.completa) reler = 'leitura_falhou';
        else if (conv2.msgs.some(m => m.id > av.ultimoId)) reler = 'mensagem_nova';
        else {
          const pode = await d.podeFalarAgora(item.tel);
          if (pode !== 'sim') reler = pode === 'nao' ? 'humano_na_conversa' : 'leitura_falhou';
          else {
            const sup = await d.supressao(item.tel);
            if (sup === null) reler = 'leitura_falhou';
            else if (sup.length) reler = 'suprimido';
            else {
              // A conta de novo: pediu para parar ou passou a pagar desde a leitura do público? Não envia.
              const conta = await d.contaAgora(item.u.id);
              if (conta === null) reler = 'leitura_falhou';
              else if (conta === 'sumiu' || conta.whatsapp_opt_out === true) reler = 'opt_out';
              else if (pagaHoje(conta, agoraEnvio.getTime())) reler = 'paga_hoje';
              else reler = (await d.posseAindaNossa(item.chave, em)) ? null : 'posse_perdida';
            }
          }
        }
      } catch { reler = 'leitura_falhou'; }
      if (reler) { await desfazer(); nota('abortou', `releitura_${reler}`); continue; }

      // O sendFrio devolve false (calado) quando há pausa humana: o carimbo só vira `enviado` depois de um envio que de fato foi feito.
      let saiu = false;
      try {
        saiu = await d.enviar(item.tel, av.texto);
      } catch (err) {
        const cod = codigoDoErroDeEnvio(err);
        logger.error(LOG, `envio ${hmac8} falhou (${cod})`);
        if (erroEhDoDestino(err)) {
          // Número ruim: o claim FICA (nunca tenta de novo), a posse volta, não conta como erro da linha.
          await d.desfazerPosse(item.chave, em);
          await d.marcarClaim(chaveClaim, { ...base, em, estado: 'destino' });
          nota('envio_falhou', 'destino');
        } else if (erroProvaQueNaoSaiu(err)) {
          await desfazer();
          await d.erroDeLinha(agoraEnvio);
          nota('envio_falhou', cod);
        } else {
          // Timeout e 5xx podem ter saído: claim e posse ficam, o erro conta.
          await d.erroDeLinha(agoraEnvio);
          await d.marcarClaim(chaveClaim, { ...base, em, estado: 'incerto' });
          nota('envio_falhou', cod);
        }
        break;
      }
      if (!saiu) {
        // Nada saiu. O carimbo FICA (1 por pessoa) mas marcado; a posse nova volta.
        await d.desfazerPosse(item.chave, em);
        await d.marcarClaim(chaveClaim, { ...base, em, estado: 'nao_saiu' });
        nota('nao_enviou', 'envio_nao_saiu');
        break;
      }
      await d.marcarClaim(chaveClaim, { ...base, em, estado: 'enviado' });
      await d.envioOk(agoraEnvio);
      r.enviou = true;
      nota('enviada', null);
      break;
    }
    if (r.avaliados > 0 || r.enviou) {
      await d.gravarResumo({
        em: agora.toISOString(), fila: lida.fila.length, por_motivo: lida.porMotivo, avaliados: r.avaliados, enviou: r.enviou,
      }).catch(() => undefined);
    }
    return r;
  } catch (e) {
    logger.error(LOG, `a rodada falhou (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return { ...r, ok: false, motivo: 'a_rodada_falhou' };
  }
}

// ── o modo seco: só lê, nunca envia ──────────────────────────────────────────

export interface LinhaSeco {
  posicao: number;
  hmac8: string;
  nome: string;
  segmento: string;
  grupo: string;
  respondeu: boolean;
  situacao: 'elegivel' | 'pulado';
  motivo: string | null;
  /** A mensagem exata que sairia (só no elegível). */
  texto: string | null;
}

export interface RelatorioSeco {
  estado: { ligada: boolean; motivo: string };
  largada: string | null;
  /** O início efetivo (D35) em ISO, ou null quando falta o piso ou a data. */
  inicio: string | null;
  janela_agora: boolean;
  linha_pausada: 'sim' | 'nao' | 'leitura falhou';
  vagas_do_frio: { hora: { teto: number; usadas: number }; dia: { teto: number; usadas: number } } | null;
  linha_na_hora: number | null;
  linha_limite: number;
  teto_campanha: 'ok' | 'cheio' | 'erro';
  carla_atende_todos: boolean;
  ia_parada: boolean;
  sem_texto: boolean;
  total_lido: number;
  na_fila: number;
  por_motivo: Record<string, number>;
  linhas: LinhaSeco[];
}

/**
 * O MODO SECO. Lê o estado, a largada (ausente vale "agora"), o início efetivo, a janela, a linha, a agenda e o teto; lê o público,
 * classifica todo mundo e devolve as contagens por motivo; pega os N primeiros da ordem (1 a 40) e roda as conferências 1 a 11 de cada
 * um, com a mensagem exata. NÃO faz o phone-exists, não toma a vez, não faz claim nem posse, não marca e não envia. Nunca devolve
 * telefone nem e-mail. Cada leitura que falha vira "sem número", nunca um zero inventado.
 */
export async function sondarRetomadaUsuarios(opts: { n?: number; agora?: Date } = {}, deps?: DepsRet): Promise<RelatorioSeco> {
  const agora = opts.agora ?? new Date();
  const agoraMs = agora.getTime();
  const d = deps ?? depsReais();
  const n = Math.max(1, Math.min(40, Math.floor(Number(opts.n) || 20)));
  const tenta = async <T>(f: () => Promise<T>, senao: T): Promise<T> => { try { return await f(); } catch { return senao; } };

  const estado = await d.estado();
  const largadaLida = await tenta(() => d.lerLargada(), null);
  const largadaMs = largadaLida ?? agoraMs;
  const inicio = inicioEfetivoMs(largadaMs, d.pisoInicioMs());
  const pausa = await d.linhaPausada(agora);
  const naHora = await tenta<number | null>(() => d.linhaNaHora(agora), null);
  const rel: RelatorioSeco = {
    estado: { ligada: estado.ligada, motivo: estado.motivo },
    largada: largadaLida === null ? null : new Date(largadaLida).toISOString(),
    inicio: Number.isFinite(inicio) ? new Date(inicio).toISOString() : null,
    janela_agora: d.janela(agora),
    linha_pausada: pausa === 'sim' ? 'sim' : pausa === 'nao' ? 'nao' : 'leitura falhou',
    vagas_do_frio: await tenta(() => d.vagasDoFrio(), null),
    linha_na_hora: naHora,
    linha_limite: d.limiteAgenda(),
    teto_campanha: await tenta(() => d.tetoCampanha(agora), 'erro' as const),
    carla_atende_todos: await tenta(() => d.carlaAtendeTodos(), false),
    ia_parada: await tenta(() => d.iaParada(agora), true),
    sem_texto: textosVazios(),
    total_lido: 0, na_fila: 0, por_motivo: {}, linhas: [],
  };

  const pub = await tenta(() => d.lerPublico(agora, largadaMs), null);
  if (!pub) return rel;
  const lida = montarFila(pub, agoraMs, largadaMs);
  rel.total_lido = lida.total;
  rel.na_fila = lida.fila.length;
  rel.por_motivo = lida.porMotivo;
  const listas = await tenta<ListasDeBarragem | null>(() => d.listas(), null);
  if (!listas) return rel;
  let posicao = 0;
  for (const item of lida.fila.slice(0, n)) {
    posicao++;
    const av = await avaliarPessoa(item, { agora, listas }, d);
    const nome = String(item.u.nome ?? '').trim().split(/\s+/)[0]?.slice(0, 20) ?? '';
    rel.linhas.push({
      posicao, hmac8: item.hmac.slice(0, 8), nome, segmento: item.segmento, grupo: item.grupo, respondeu: item.respondeu,
      situacao: av.ok ? 'elegivel' : 'pulado', motivo: av.ok ? null : av.motivo, texto: av.ok ? av.texto : null,
    });
  }
  return rel;
}

// ── as dependências de verdade ───────────────────────────────────────────────

const COLUNAS_USUARIO = 'id, email, nome, whatsapp, plano, billing_status, plano_expira_em, created_at, whatsapp_opt_out, whatsapp_replied_at, is_admin, carla_sem_cnpj_count, carla_inativo_count, last_canceled_at';

/** Lê tudo de uma consulta paginada (o PostgREST corta em 1000 linhas e ignora o .limit()). Erro LANÇA: lista cortada também é "não saber". */
async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await pagina(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error('leitura paginada falhou');
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
  throw new Error('leitura paginada passou do limite');
}

const emLotes = <T>(lista: readonly T[], tamanho: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
};

const tempoDe = (v: unknown): number | null => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

/** Lê o que não está em `users` só para quem chegou até o fim das exclusões baratas. Qualquer erro LANÇA (a rodada não envia). */
async function lerExtras(candidatos: readonly UsuarioRet[], agora: Date): Promise<Map<string, ExtrasRet>> {
  const mapa = new Map<string, ExtrasRet>();
  if (!candidatos.length) return mapa;
  const ids = candidatos.map(u => u.id);
  const emails = [...new Set(candidatos.map(u => String(u.email ?? '').trim().toLowerCase()).filter(Boolean))];

  const vendas = new Map<string, VendaRet[]>();
  for (const lote of emLotes(emails, 50)) {
    const { data, error } = await supabase.from('sales').select('email, valor, status, subscription_id').in('email', lote);
    if (error) throw new Error('ler as vendas falhou');
    for (const v of (data ?? []) as VendaRet[]) {
      const k = String(v.email ?? '').toLowerCase();
      vendas.set(k, [...(vendas.get(k) ?? []), v]);
    }
  }

  const desde60 = new Date(agora.getTime() - JANELA_DOC_ATIVO_MS - ADIANTO_DO_DOCUMENTO_MS).toISOString();
  const docs = new Map<string, number>();
  for (const lote of emLotes(ids, 100)) {
    const linhas = await lerTudo<{ user_id: string; created_at: string }>((de, ate) =>
      supabase.from('documents').select('user_id, created_at').in('user_id', lote).gte('created_at', desde60)
        .order('created_at', { ascending: false }).range(de, ate));
    for (const l of linhas) {
      const t = tempoDe(l.created_at);
      if (t !== null && t > (docs.get(l.user_id) ?? -Infinity)) docs.set(l.user_id, t);
    }
  }

  const comCnpj = new Set<string>();
  for (const lote of emLotes(ids, 100)) {
    const { data, error } = await supabase.from('company').select('user_id, cnpj').in('user_id', lote);
    if (error) throw new Error('ler as empresas falhou');
    for (const c of (data ?? []) as Array<{ user_id: string; cnpj: unknown }>) if (cnpjDe14(c.cnpj)) comCnpj.add(c.user_id);
  }

  const curso = new Map<string, number>();
  const linhasCurso = await lerTudo<{ key: string; value: { count?: unknown } | null }>((de, ate) =>
    supabase.from('system_state').select('key, value').like('key', 'curso19:%').order('key', { ascending: true }).range(de, ate));
  for (const l of linhasCurso) curso.set(l.key.slice('curso19:'.length), Number(l.value?.count) || 0);

  const nexus = new Map<string, number>();
  for (const lote of emLotes(ids, 100)) {
    const { data, error } = await supabase.from('system_state').select('key, updated_at').in('key', lote.map(id => `nexus_convite_email:${id}`));
    if (error) throw new Error('ler os convites da NEXUS falhou');
    for (const l of (data ?? []) as Array<{ key: string; updated_at: string }>) {
      const t = tempoDe(l.updated_at);
      if (t !== null) nexus.set(l.key.slice('nexus_convite_email:'.length), t);
    }
  }

  const hmacs = new Map<string, string>();
  for (const u of candidatos) {
    const t = telefoneDoUsuario(u);
    const h = t ? hmacDe(t.chave) : null;
    if (h) hmacs.set(u.id, h);
  }
  const jaFoi = await chavesExistentes([...hmacs.values()].map(h => `${PREFIXO_CARIMBO_RET}${h}`));

  const marcas = new Map<string, MarcaForaRet>();
  const linhasMarca = await lerTudo<{ key: string; value: MarcaForaRet | null }>((de, ate) =>
    supabase.from('system_state').select('key, value').like('key', `${PREFIXO_FORA_RET}%`).order('key', { ascending: true }).range(de, ate));
  for (const l of linhasMarca) marcas.set(l.key.slice(PREFIXO_FORA_RET.length), l.value ?? {});

  for (const u of candidatos) {
    const h = hmacs.get(u.id) ?? '';
    mapa.set(u.id, {
      vendas: vendas.get(String(u.email ?? '').trim().toLowerCase()) ?? [],
      ultimoDocumentoBrutoMs: docs.get(u.id) ?? null,
      temCnpj: comCnpj.has(u.id),
      toquesCurso19: curso.get(u.id) ?? 0,
      nexusConviteEmMs: nexus.get(u.id) ?? null,
      jaNaCampanha: !!h && jaFoi.has(`${PREFIXO_CARIMBO_RET}${h}`),
      marcaFora: h ? (marcas.get(h) ?? null) : null,
    });
  }
  return mapa;
}

export function depsReais(): DepsRet {
  return {
    estado: () => estadoRetomadaUsuarios(),
    segredoOk: () => !!hmacDe('retomada-usuarios'),
    carlaAtendeTodos: () => lerCarlaAtendeTodos(),
    iaParada: (agora) => lerIaParada(agora),
    lerLargada: () => lerLargadaRet(),
    garantirLargada: (agora) => garantirLargadaRet(agora),
    pisoInicioMs: () => pisoDoCodigoMs(),
    janela: (agora) => dentroDaJanelaDaBaseLinha(agora),
    linhaPausada: (agora) => lerLinhaPausada(agora),
    tetoHorario: () => dentroDoTetoHorarioLinha({ robo: ROBO_RETOMADA_USUARIOS }),
    espacamento: () => respeitaEspacamentoLinha(),
    linhaNaHora: (agora) => carimbosDaLinhaNaHora(agora, 5),
    limiteAgenda: () => limiteCedeAAgenda(process.env.EP_CONFIRMA_TETO_HORA),
    async tetoCampanha(agora) {
      try {
        const { data, error } = await supabase.from('system_state').select('key').like('key', `${PREFIXO_CARIMBO_RET}%`)
          .gte('updated_at', new Date(agora.getTime() - 24 * 3_600_000).toISOString()).limit(TETO_CAMPANHA_24H + 1);
        if (error) return 'erro';
        return (data?.length ?? 0) >= TETO_CAMPANHA_24H ? 'cheio' : 'ok';
      } catch { return 'erro'; }
    },
    async vagasDoFrio() { try { return await vagasDoFrioLinha(); } catch { return null; } },
    async tomarVez(agora) {
      const v = await reservarChave(chaveVezRet(agora), {}, agora);
      return v === 'reservada' ? 'tomada' : v === 'ja_existe' ? 'ocupada' : 'erro';
    },
    /** As vezes de 10 min ficam 2 h e saem. */
    async limparVezes(agora) {
      try {
        await supabase.from('system_state').delete().like('key', `${PREFIXO_VEZ_RET}%`).lt('updated_at', new Date(agora.getTime() - 2 * 3_600_000).toISOString());
      } catch { /* sobra no máximo 12 linhas por hora */ }
    },
    async lerPublico(agora, largadaMs) {
      try {
        const agoraMs = agora.getTime();
        const usuarios = await lerTudo<UsuarioRet>((de, ate) =>
          supabase.from('users').select(COLUNAS_USUARIO).not('whatsapp', 'is', null).neq('whatsapp', '').order('id', { ascending: true }).range(de, ate));
        const consultores = await carregarTelefonesConsultores();
        if (!consultores.ok) return null;
        const chavesDaCasa = montarChavesDaCasa([TELEFONE_DA_LINHA_5040, ...Object.values(TELEFONES_DE_RESERVA), telefoneDoDono(), ...consultores.mapa.values()]);
        const repetidas = chavesRepetidas(usuarios);
        // 1ª passada, sem nada de fora de `users`: só quem chega até o fim das exclusões baratas gasta leitura em outras tabelas.
        const candidatos = usuarios.filter(u => {
          const t = telefoneDoUsuario(u);
          return classificarUsuario(u, EXTRAS_VAZIOS, { agoraMs, largadaMs, chavesDaCasa, repetidas, hmac: t ? hmacDe(t.chave) : null }).ok;
        });
        const porUsuario = await lerExtras(candidatos, agora);
        return { usuarios, extras: (u) => porUsuario.get(u.id) ?? EXTRAS_VAZIOS, chavesDaCasa };
      } catch (e) {
        logger.error(LOG, `ler o público falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
        return null;
      }
    },
    listas: () => carregarListasDeBarragem(),
    ehNumeroDeTeste: (chave) => leadEhDeTeste(chave),
    async posse(chave) {
      try { const p = await lerPosse(chave); return p ? { estado: p.estado } : 'livre'; } catch { return 'erro'; }
    },
    conversa: (chave) => lerConversa(chave),
    fatosPorteiro: (chave, msgs, listas, agora) => lerFatosPorteiro(chave, msgs, null, { completa: true, listas, agora }),
    carlaAtende: (tel) => agenteAtendeEste('carla', tel),
    primeiroNome: (nome) => primeiroNome(nome),
    telefoneExiste: (tel) => numeroTemWhatsApp(tel, 'io'),
    claim: async (chave, valor, agora) => {
      const v = await reservarChave(chave, valor, agora);
      return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro';
    },
    apagarClaim: (chave) => liberarChave(chave),
    async marcarClaim(chave, valor) {
      // O update devolve { error } sem lançar: conferir os dois (exceção e erro). O claim fica como está; o painel ignora carimbo sem estado.
      try {
        const { error } = await supabase.from('system_state').update({ value: valor, updated_at: new Date().toISOString() }).eq('key', chave);
        if (error) logger.error(LOG, `marcar o carimbo falhou (${String((error as { code?: string; message?: string }).code ?? (error as { message?: string }).message ?? 'erro').slice(0, 40)})`);
      } catch (e) { logger.error(LOG, `marcar o carimbo falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`); }
    },
    async marcarFora(hmac, motivo, marca, agora) {
      const iso = agora.toISOString();
      try {
        const { error } = await supabase.from('system_state').upsert(
          { key: `${PREFIXO_FORA_RET}${hmac}`, value: { motivo: motivo.slice(0, 60), em: iso, ...(marca.ate ? { ate: marca.ate } : {}) }, updated_at: iso },
          { onConflict: 'key' },
        );
        if (error) logger.error(LOG, `gravar a marca de fora falhou (${String((error as { code?: string }).code ?? 'erro').slice(0, 20)})`);
      } catch (e) { logger.error(LOG, `gravar a marca de fora falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`); }
    },
    assumirPosse: (chave, quando, extra) => assumirPosse(chave, 'carla', null, quando, extra),
    async posseAindaNossa(chave, quando) {
      try {
        const p = await lerPosse(chave);
        return !!p && p.dona === 'carla' && p.estado === 'viva' && Date.parse(p.desde) === Date.parse(quando);
      } catch { return false; }
    },
    desfazerPosse: (chave, quando) => desfazerPosseNova(chave, 'carla', quando),
    async podeFalarAgora(tel) {
      try { return (await carregarPausas({ estrito: true }))(tel).pode ? 'sim' : 'nao'; } catch { return 'erro'; }
    },
    async supressao(tel) {
      try { return await motivosDaSupressao(tel); } catch { return null; }
    },
    async contaAgora(userId) {
      try {
        const { data, error } = await supabase.from('users').select('plano, billing_status, plano_expira_em, whatsapp_opt_out').eq('id', userId).maybeSingle();
        if (error) return null;
        return data ? (data as ContaAgoraRet) : 'sumiu';
      } catch { return null; }
    },
    enviar: async (tel, texto) => (await sendFrio(tel, [texto], 'io')) === true,
    async erroDeLinha(agora) {
      try {
        const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
        const n = (Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0) || 0) + 1;
        const iso = agora.toISOString();
        await supabase.from('system_state').upsert({ key: CHAVE_LINHA_ERROS, value: { n, em: iso }, updated_at: iso }, { onConflict: 'key' });
        if (n >= ERROS_PARA_PAUSAR) {
          await supabase.from('system_state').upsert({
            key: CHAVE_LINHA_PAUSA, value: { ate: new Date(agora.getTime() + PAUSA_LINHA_MS).toISOString(), motivo: 'erros_seguidos', n }, updated_at: iso,
          }, { onConflict: 'key' });
          // A campanha também para, sem prazo: volta à mão, pelo painel (D13). É o perfil de agosto.
          await pausarRetomada({ motivo: 'dois_erros_de_linha', n }, agora);
        }
      } catch (e) { logger.error(LOG, `contagem de erro da linha falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`); }
    },
    async envioOk(agora) {
      try {
        const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
        if ((Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0) || 0) > 0) {
          const iso = agora.toISOString();
          await supabase.from('system_state').upsert({ key: CHAVE_LINHA_ERROS, value: { n: 0, em: iso }, updated_at: iso }, { onConflict: 'key' });
        }
      } catch { /* o contador só pausa a linha */ }
    },
    async gravarResumo(res) {
      try {
        await supabase.from('system_state').upsert({ key: CHAVE_RESUMO_RET, value: res, updated_at: res.em }, { onConflict: 'key' });
      } catch (e) { logger.error(LOG, `gravar o resumo falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`); }
    },
  };
}

