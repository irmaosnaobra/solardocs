// ─────────────────────────────────────────────────────────────────────────────
// A CARLA RECUPERA QUEM DEIXOU O WHATSAPP NO QUIZ DO SOLARDOC E NÃO COMPROU (24/10/2026, plano B2).
// Robô `quiz_recuperacao_5040` (frio_receita_p4). UMA bolha, sem link, por sendFrio, pela linha 5040.
//
// LIGA E DESLIGA (recuperacaoCarlaEstado.ts): nasce LIGADO; a env QUIZ_RECUPERACAO_LIGADA='0' desliga (a env só desliga);
// a chave de banco `quiz_rec_pausa` (system_state) também. A chave é lida antes de CADA envio e leitura que falha vale desligado.
//
// SÓ LEAD NOVO: na 1ª rodada o robô grava uma vez `quiz_rec_largada` (insert que não sobrescreve). Só vale lead gravado depois dela.
//
// A RODADA (cada 10 min, UM envio no máximo; o /process-messages chama a cada 2 min e a vez de 10 min é por insert):
//   0. estado (ligada?) e segredo de HMAC;  1. a largada;
//   2. as travas, nesta ordem: janela 9h-20h BRT seg a sáb  >  ag5040_linha_pausa  >  teto do frio {robo}  >  espaçamento;
//   3. a vez (insert quiz_rec_vez:<faixa de 10 min>);
//   4. a fila: leads de leads_meta (form_id quiz_solardoc) gravados há 15 min ou mais e há até 48 h de idade útil (sem domingo e feriado; teto de 120 h de calendário), depois da largada, não de teste,
//      COM CNPJ, fora quem já tem claim (quiz_rec_sent ou quiz_aviso), ordenada por intenção e, dentro dela, do mais antigo ao mais novo;
//   5. por lead, ANTES do claim (avaliarLead): compra > posse > já falou com a linha > pausa humana e supressão;  depois phone-exists;
//   6. as travas de novo, o claim (quiz_rec_sent:<hmac>, para sempre), assumirPosse('carla'), releitura da conversa e da supressão
//      (qualquer sinal novo: desfaz a posse e apaga o claim), sendFrio;
//   7. o aviso de desistência ao grupo ("A Carla falou às HH:MM") entra PENDENTE; quem envia é o tick do B1, com o espaçamento dele.
//      O sendFrio devolve false quando a trava de pausa humana calou: nada saiu, então o aviso "falou às" NÃO é gravado. O carimbo fica
//      com estado 'nao_saiu' (trava de 1 por pessoa), a posse nova volta e o tick do B1 avisa com o motivo.
// O claim de desistência (quiz_aviso:<hmac>) NÃO barra a Carla (B2.1): o tick avisa o time na hora quando a linha está fechada ou passou
// 1 h sem vaga, e a Carla ainda pode chamar depois; o aviso dela cai como duplicado (um aviso por lead).
// Depois das 20h, nos dias em que a janela abriu, o lead elegível que ficou sem vaga ganha `avisarSemVaga` (UMA vez por lead, para sempre,
// e nunca se o time já recebeu a desistência dele).
//
// ERROS: o claim e a posse só voltam quando o erro PROVA que nada saiu (cooldown, credencial) ou o robô desistiu antes do envio.
// Erro de DESTINO (número inválido): o claim fica (nunca tenta de novo), a posse volta e NÃO conta como erro da linha. Timeout e 5xx
// podem ter saído: claim e posse ficam, o erro conta em ag5040_linha_erros e o aviso ao grupo não afirma que ela falou.
// Telefone cru nunca vai para system_state, log ou relatório: só hmac e o código do quiz.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { numeroTemWhatsApp, sendFrio } from '../agents/zapiClient';
import {
  dentroDaJanelaDaBaseLinha, dentroDoTetoHorarioLinha, respeitaEspacamentoLinha,
} from '../agents/whatsapp/lineThrottle';
import { podeFalarComLead } from '../agents/whatsapp/pausaHumana';
import { carregarMudos, motivosDaSupressao, TOQUES_ATE_DESISTIR } from '../agents/whatsapp/silenciar';
import { hmacDe } from '../agentes5040/hmac';
import { lerConversa, type ConversaLida } from '../agentes5040/contexto';
import { assumirPosse, desfazerPosseNova, lerPosse, chaveDaPosse, type ResultadoAssumir } from '../agentes5040/posse';
import { chavesExistentes, liberarChave, reservarChave } from '../agentes5040/cota';
import { CHAVE_LINHA_ERROS, CHAVE_LINHA_PAUSA, codigoDoErroDeEnvio, erroEhDoDestino } from '../agentes5040/vivoEnvio';
import { erroProvaQueNaoSaiu } from '../agentes5040/fichaEnvio';
import { modoPix } from '../agentes5040/modoPix';
import { chaveDoTelefone, codigoDoQuiz, normalizarTelefoneSd } from './quizSolardoc';
import { avisarDesistencia, avisarSemVaga, ehLeadDeTeste, fecharSemGrupo, PREFIXO_CLAIM_QUIZ, type ColetorSemGrupo, type ResultadoAviso } from './avisoGrupoSolardoc';
import { comprouLead, comprouPorEmail, vendasRecentes, type VendasRecentes } from './compraQuizSolardoc';
import { estadoRecuperacaoCarla, garantirLargada, lerLargada, type EstadoRecuperacao } from './recuperacaoCarlaEstado';
import {
  FRASE_DO_MOTIVO, ESPERA_MIN_MS, TETO_CALENDARIO_MS, PREFIXO_CARIMBO_REC, PREFIXO_VEZ_REC, ROBO_QUIZ_REC,
  campoFd, chaveVezRec, MOTIVOS_PERMANENTES_REC, PREFIXO_PULOU_REC, diaBRT, foraDoTempo, horaBRT, motivoSemBanco, ordenarFila, semCnpj, textoDaCarla, PREFIXO_AINDA_REC,
  PAGTO_ESPERA_MS, PAGTO_VALE_MS, PREFIXO_PAGTO, PREFIXO_PAGTO_EMAIL,
  empresaDoQuiz, faseDoCodigo, linkDoPagamento, marcaDeLinha, montarTextoPagamento, nomeDoPagamento,
  type LeadRec, type MarcaPagto, type MotivoNaoChama, type TextoPagto,
} from './recuperacaoCarlaRegras';

const LOG = 'quiz-rec';
/** No máximo estes leads são avaliados (leituras) por rodada: a rodada cabe na função e não vira varredura. */
const AVALIACOES_POR_RODADA = 8;
const SEM_VAGA_POR_RODADA = 5;
const SEM_VAGA_AVALIACOES = 15;
const ERROS_PARA_PAUSAR = 2;
const PAUSA_LINHA_MS = 15 * 60_000;
const JANELA_FECHA_H = 20;
/** O "sem vaga" é UMA vez por lead, para sempre: `quiz_aviso:<hmac>:semvaga`. */
const SUFIXO_SEM_VAGA = ':semvaga';

// ── a avaliação de um lead (a mesma para o robô, o tick do B1 e a sonda) ─────

export type MotivoSilencioso = 'teste' | 'sem_telefone' | 'comprou';
export type Avaliacao =
  | { ok: true; tel: string; chave: string; hmac: string; codigo: string }
  | { ok: false; motivo: MotivoNaoChama | MotivoSilencioso };

/** As leituras da avaliação. O robô e o tick passam as de verdade (depsAvaliarReais); os testes, um falso. */
export interface DepsAvaliar {
  /** Erro LANÇA. */
  compra(vendas: VendasRecentes, lp: string, chave: string): Promise<boolean>;
  posse(chave: string): Promise<'livre' | 'ocupada' | 'erro'>;
  conversa(chave: string): Promise<ConversaLida>;
  /** Alguém escreveu à 5040 com o código do quiz no texto (a mensagem pronta da página)? Pega o LID que o mapa não resolve. */
  mensagemComCodigo(codigo: string, desdeIso: string): Promise<boolean | 'erro'>;
  podeFalar(tel: string): Promise<'sim' | 'nao' | 'erro'>;
  supressao(tel: string): Promise<string[] | null>;
  /** Quem já levou 3 toques da linha sem responder em 60 dias (wa_mudos, estrito). 'erro' = não deu para ler. */
  mudo(tel: string): Promise<'sim' | 'nao' | 'erro'>;
}

export interface ContextoAvaliar {
  agoraMs: number; largadaMs: number | null; vendas: VendasRecentes;
  /**
   * Quem chegou na parte do pagamento (marca `quiz_pagto:`): a pessoa tentou pagar, então não vale "sem CNPJ", "antes da largada" nem a falta
   * de diagnóstico do quiz. Todo o resto (compra, posse, já falou, pausa humana, supressão, mudo) continua valendo. O tick de desistência
   * e a sonda nunca ligam isto.
   */
  viaPagamento?: boolean;
}

/** HMAC do telefone do lead (a chave do claim), ou null. */
export function hmacDoLeadRec(lead: Pick<LeadRec, 'whatsapp'>): string | null {
  const tel = normalizarTelefoneSd(lead.whatsapp);
  return tel ? hmacDe(chaveDoTelefone(tel)) : null;
}

/**
 * O lead já falou com a linha? Conversa ilegível ou incompleta (a lista de LIDs cortada, o banco falhou) vale "falou".
 * Qualquer fala do lead (from_me=false; recibo de leitura não conta, a leitura da conversa já os descarta) = 'ja_falou'; fala só
 * nossa (humano pelo celular, outro robô) = 'humano_na_conversa'. LID que o mapa não resolve não aparece na conversa: o código do
 * quiz no texto de uma mensagem recebida acha esse caso.
 */
export async function jaFalouComALinha(
  lead: LeadRec, tel: string, chave: string, d: DepsAvaliar,
): Promise<'nao' | 'ja_falou' | 'humano_na_conversa' | 'leitura_falhou'> {
  const conv = await d.conversa(chave);
  if (!conv.completa) return 'leitura_falhou';
  if (conv.msgs.some(m => m.autor === 'lead')) return 'ja_falou';
  if (conv.msgs.length) return 'humano_na_conversa';
  const codigo = campoFd(lead.field_data, 'Código') || codigoDoQuiz(tel);
  const desde = new Date((Date.parse(String(lead.created_time ?? '')) || Date.now()) - 60_000).toISOString();
  const achou = await d.mensagemComCodigo(codigo, desde);
  if (achou === 'erro') return 'leitura_falhou';
  return achou ? 'ja_falou' : 'nao';
}

/** Pausa humana e supressão (opt-out, denúncia, mudo, qualquer registro). Erro de leitura = não fala. */
export async function podeFalarAgora(tel: string, d: DepsAvaliar): Promise<'sim' | MotivoNaoChama> {
  const p = await d.podeFalar(tel);
  if (p === 'erro') return 'leitura_falhou';
  if (p === 'nao') return 'humano_na_conversa';
  const s = await d.supressao(tel);
  if (s === null) return 'leitura_falhou';
  return s.length ? 'suprimido' : 'sim';
}

/**
 * Tudo que dá para saber SEM falar com ninguém e sem o phone-exists: teste, telefone, CNPJ, largada, texto, compra, posse, já falou com a
 * linha, pausa humana, supressão e mudo (nesta ordem). O tempo (15 min a 48 h úteis, teto de 120 h) é de quem chama.
 */
export async function avaliarLead(lead: LeadRec, c: ContextoAvaliar, d: DepsAvaliar): Promise<Avaliacao> {
  if (ehLeadDeTeste(lead.field_data)) return { ok: false, motivo: 'teste' };
  const tel = normalizarTelefoneSd(lead.whatsapp);
  const hmac = tel ? hmacDe(chaveDoTelefone(tel)) : null;
  const chave = tel ? chaveDaPosse(tel) : null;
  if (!tel || !hmac || !chave) return { ok: false, motivo: 'sem_telefone' };
  if (!c.viaPagamento) {
    const semBanco = motivoSemBanco(lead, c.largadaMs);
    if (semBanco) return { ok: false, motivo: semBanco };
    if (!textoDaCarla(lead).ok) return { ok: false, motivo: 'sem_diagnostico' };
  }
  try {
    if (await d.compra(c.vendas, campoFd(lead.field_data, 'lp_session'), chaveDoTelefone(tel))) return { ok: false, motivo: 'comprou' };
  } catch { return { ok: false, motivo: 'leitura_falhou' }; }
  const posse = await d.posse(chave);
  if (posse === 'erro') return { ok: false, motivo: 'leitura_falhou' };
  if (posse === 'ocupada') return { ok: false, motivo: 'posse' };
  const falou = await jaFalouComALinha(lead, tel, chave, d);
  if (falou !== 'nao') return { ok: false, motivo: falou };
  const pode = await podeFalarAgora(tel, d);
  if (pode !== 'sim') return { ok: false, motivo: pode };
  const mudo = await d.mudo(tel);
  if (mudo === 'erro') return { ok: false, motivo: 'leitura_falhou' };
  if (mudo === 'sim') return { ok: false, motivo: 'mudo' };
  return { ok: true, tel, chave, hmac, codigo: campoFd(lead.field_data, 'Código') || codigoDoQuiz(tel) };
}

export function depsAvaliarReais(): DepsAvaliar {
  // A lista de mudos é lida UMA vez por instância destas dependências (uma rodada) e só fica em memória quando a leitura dá certo.
  let mudos: Promise<(telefone: string) => boolean> | null = null;
  return {
    compra: (vendas, lp, chave) => comprouLead(vendas, lp, chave),
    async posse(chave) {
      try { return (await lerPosse(chave)) ? 'ocupada' : 'livre'; } catch { return 'erro'; }
    },
    conversa: (chave) => lerConversa(chave),
    async mensagemComCodigo(codigo, desdeIso) {
      try {
        const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
        if (!inst) return 'erro';
        const { data, error } = await supabase.from('wa_mensagens').select('id')
          .eq('instancia', inst).eq('is_group', false).eq('from_me', false)
          .ilike('texto', `%${codigo}%`).gte('momment', desdeIso).limit(1);
        if (error) return 'erro';
        return (data ?? []).length > 0;
      } catch { return 'erro'; }
    },
    async podeFalar(tel) {
      try { return (await podeFalarComLead(tel)).pode ? 'sim' : 'nao'; } catch { return 'erro'; }
    },
    async supressao(tel) {
      try { return await motivosDaSupressao(tel); } catch { return null; }
    },
    async mudo(tel) {
      try {
        if (!mudos) mudos = carregarMudos(Math.min(3, TOQUES_ATE_DESISTIR), 60, { estrito: true });
        return (await mudos)(tel) ? 'sim' : 'nao';
      } catch { mudos = null; return 'erro'; }
    },
  };
}

// ── a rodada do robô ─────────────────────────────────────────────────────────

export interface DepsRec extends DepsAvaliar {
  estado(): Promise<EstadoRecuperacao>;
  segredoOk(): boolean;
  garantirLargada(agora: Date): Promise<number>;
  janela(agora: Date): boolean;
  linhaPausada(agora: Date): Promise<'sim' | 'nao' | 'erro'>;
  tetoHorario(): Promise<boolean>;
  espacamento(): Promise<boolean>;
  tomarVez(agora: Date): Promise<'tomada' | 'ocupada' | 'erro'>;
  limparVezes(agora: Date): Promise<void>;
  /** Leads do quiz gravados entre `desdeIso` e `ateIso`, do mais antigo ao mais novo. null = leitura falhou. */
  leads(desdeIso: string, ateIso: string): Promise<LeadRec[] | null>;
  /** Quais destas chaves de system_state existem. null = leitura falhou. */
  existentes(chaves: string[]): Promise<Set<string> | null>;
  vendas(agoraMs: number): Promise<VendasRecentes>;
  telefoneExiste(tel: string): Promise<'sim' | 'nao' | 'erro'>;
  claim(chave: string, agora: Date): Promise<'ok' | 'ja' | 'erro'>;
  apagarClaim(chave: string): Promise<void>;
  marcarClaim(chave: string, valor: Record<string, unknown>): Promise<void>;
  /** Grava a marca `quiz_rec_pulou:<hmac>` (lead descartado por motivo permanente). Opcional; erro é engolido: sem a marca o lead só é reavaliado. */
  marcarPulo?(chave: string, motivo: string, agora: Date): Promise<void>;
  /** As marcas `quiz_pagto:` gravadas desde `desdeIso` (quem chegou na parte do pagamento). null = leitura falhou. Opcional: sem ela não há caminho de pagamento. */
  marcasPagamento?(desdeIso: string): Promise<MarcaPagto[] | null>;
  /** O contrato da marca (status, idade, código) e o WhatsApp da atribuição dele. null = leitura falhou; `contrato: null` = não existe. */
  lerPagamento?(contratoId: string): Promise<DadosPagamento | null>;
  /** Comprou, pelo e-mail? Erro LANÇA. */
  compraPorEmail?(vendas: VendasRecentes, email: string): Promise<boolean>;
  /** Manda o e-mail do Pix que ficou esperando. Erro LANÇA (quem chama solta o claim). */
  enviarEmailPix?(para: string, link: string): Promise<void>;
  /** Espera entre a 1ª mensagem e o código (2 a 5 s, como as respostas fazem). Opcional: os testes não esperam. */
  esperar?(ms: number): Promise<void>;
  /** Avisa o Thiago (e-mail de operação). Erro é engolido. Opcional. */
  avisarThiago?(texto: string): Promise<void>;
  assumirPosse(chave: string, em: string): Promise<ResultadoAssumir>;
  posseAindaNossa(chave: string, em: string): Promise<boolean>;
  desfazerPosse(chave: string, em: string): Promise<boolean>;
  /** true = o envio foi feito. false (pausa humana calou, ou qualquer retorno que não prove envio) = nada saiu. Erro LANÇA. */
  enviar(tel: string, texto: string): Promise<boolean>;
  erroDeLinha(agora: Date): Promise<void>;
  envioOk(agora: Date): Promise<void>;
  avisarSaiu(lead: LeadRec, hora: string): Promise<ResultadoAviso>;
  avisarNaoChama(lead: LeadRec, frase: string): Promise<ResultadoAviso>;
  avisarSemVaga(lead: LeadRec): Promise<ResultadoAviso>;
  /** Fim da rodada (sempre, mesmo se ela falhou): manda UM e-mail com os avisos que ficaram sem grupo. Opcional: os testes não precisam dele. */
  fecharRodada?(): Promise<void>;
}

export interface DadosPagamento {
  contrato: { status: string; created_at: string | null; qr_payload: string | null; ultimo_pagamento_em: string | null; ultimo_pagamento_id?: string | null; email: string | null } | null;
  whatsapp: string | null;
}

export interface DecisaoRec { hmac8: string; resultado: string; motivo: string | null }

export interface RelatorioRec {
  ok: boolean;
  ligada: boolean;
  /** Por que a rodada parou (ou null). */
  motivo: string | null;
  candidatos: number;
  avaliados: number;
  enviou: boolean;
  semVaga: number;
  puladas: Record<string, number>;
  decisoes: DecisaoRec[];
}

export interface OpcoesRec { agora?: Date }

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };
const vazio = (extra: Partial<RelatorioRec> = {}): RelatorioRec => ({
  ok: true, ligada: true, motivo: null, candidatos: 0, avaliados: 0, enviou: false, semVaga: 0, puladas: {}, decisoes: [], ...extra,
});

/** O meio-dia de Brasília do dia de `agora`: serve para perguntar "a janela abriu hoje?" (segunda a sábado, fora de feriado). */
const meioDiaBRT = (agora: Date): Date => new Date(`${diaBRT(agora.getTime())}T15:00:00.000Z`);
const horaDeBRT = (agora: Date): number => Number(horaBRT(agora.getTime()).slice(0, 2));

/** As travas da linha, nesta ordem. Devolve o motivo da primeira que barra, ou null. */
async function travas(d: DepsRec, agora: Date, janelaJaConferida?: boolean): Promise<string | null> {
  if (!(janelaJaConferida ?? d.janela(agora))) return 'fora_da_janela';
  const pausa = await d.linhaPausada(agora);
  if (pausa !== 'nao') return pausa === 'sim' ? 'linha_pausada' : 'leitura_da_pausa_falhou';
  if (!(await d.tetoHorario())) return 'teto_da_linha';
  if (!(await d.espacamento())) return 'espacamento_da_linha';
  return null;
}

/**
 * Os leads do quiz que a Carla pode querer, na janela de tempo, já filtrados e sem quem ela já chamou (quiz_rec_sent). O claim de
 * desistência (quiz_aviso) NÃO barra a Carla quando o tick avisou só que ela "chama no próximo horário" ou "ainda não teve vaga"
 * (marca quiz_rec_ainda); o aviso por "ela não vai chamar" ou compra tira o lead da fila, para não gastar as avaliações da rodada (B2.1).
 * No "sem vaga" qualquer aviso tira o lead.
 */
async function lerFila(d: DepsRec, agora: Date, largadaMs: number, opts: { semAvisados?: boolean; excluir?: ReadonlySet<string> } = {}): Promise<{ fila: LeadRec[]; total: number } | null> {
  const agoraMs = agora.getTime();
  // Lê até o teto de calendário (120 h); quem vence pela idade útil (48 h sem domingo e feriado) o `foraDoTempo` tira logo abaixo.
  const desde = Math.max(largadaMs, agoraMs - TETO_CALENDARIO_MS);
  const lidos = await d.leads(new Date(desde).toISOString(), new Date(agoraMs - ESPERA_MIN_MS).toISOString());
  if (!lidos) return null;
  const candidatos = lidos.filter(l => !ehLeadDeTeste(l.field_data) && foraDoTempo(l, agoraMs) === null && !semCnpj(l.field_data) && !!hmacDoLeadRec(l)
    // Quem tem a marca do pagamento é do caminho do pagamento (a rodada chama com o texto dele, pelo mesmo claim): a mensagem de 15 min não o atropela.
    && !opts.excluir?.has(hmacDoLeadRec(l) as string));
  if (!candidatos.length) return { fila: [], total: lidos.length };
  const chaves = candidatos.flatMap(l => {
    const h = hmacDoLeadRec(l) as string;
    const base = [`${PREFIXO_CARIMBO_REC}${h}`, `${PREFIXO_CLAIM_QUIZ}${h}`, `${PREFIXO_AINDA_REC}${h}`, `${PREFIXO_PULOU_REC}${h}`];
    return opts.semAvisados ? [...base, `${PREFIXO_CLAIM_QUIZ}${h}${SUFIXO_SEM_VAGA}`] : base;
  });
  const tem = await d.existentes(chaves);
  if (!tem) return null;
  const livres = candidatos.filter(l => {
    const h = hmacDoLeadRec(l) as string;
    if (tem.has(`${PREFIXO_CARIMBO_REC}${h}`) || tem.has(`${PREFIXO_PULOU_REC}${h}`)) return false;
    if (opts.semAvisados) return !tem.has(`${PREFIXO_CLAIM_QUIZ}${h}`) && !tem.has(`${PREFIXO_CLAIM_QUIZ}${h}${SUFIXO_SEM_VAGA}`);
    return !tem.has(`${PREFIXO_CLAIM_QUIZ}${h}`) || tem.has(`${PREFIXO_AINDA_REC}${h}`);
  });
  return { fila: ordenarFila(livres), total: lidos.length };
}

// ── o caminho do pagamento (03/11/2026) ──────────────────────────────────────

/**
 * Quantos leads do pagamento entram por rodada. Menos que as 8 avaliações de propósito: marca que não sai do lugar (humano na conversa, por
 * exemplo) não pode tomar a rodada inteira e deixar a mensagem de 15 min sem vaga.
 */
const PAGTO_POR_RODADA = 4;
/** E-mails do pagamento por rodada. */
const EMAILS_POR_RODADA = 5;

/** O contrato foi pago? `ativo` e `inadimplente` já pagaram alguma vez; `ultimo_pagamento_em` e `ultimo_pagamento_id` (o webhook grava este antes do `ativo`) também provam. */
export function contratoPago(c: NonNullable<DadosPagamento['contrato']>): boolean {
  return c.status === 'ativo' || c.status === 'inadimplente' || !!c.ultimo_pagamento_em || !!c.ultimo_pagamento_id;
}

/** Um item da fila do pagamento: o lead do quiz (só quem fez o quiz vai ao WhatsApp) e o que a marca trouxe. */
interface ItemPagto { lead: LeadRec; marca: MarcaPagto; quiz: LeadRec; dados: DadosPagamento; utmTerm: string | null }
interface ItemFila { lead: LeadRec; pagto?: ItemPagto }

/** O que a rodada leu: TODAS as marcas vivas (120 h) e os leads do quiz por hmac. */
interface PagtoRodada { marcas: MarcaPagto[]; doQuiz: Map<string, LeadRec> }

/**
 * Lê UMA vez por rodada as marcas `quiz_pagto:` e, havendo marca, os leads do quiz (dão nome, empresa e utm_term, e dizem quem fez o quiz).
 * null = a leitura falhou: dentro da janela a rodada PARA (sem a marca, a mensagem de 15 min deixaria de pular quem está pagando).
 * Sem as dependências do pagamento (testes antigos) não há marca nenhuma.
 */
async function carregarPagto(d: DepsRec, agora: Date): Promise<PagtoRodada | null> {
  const vazioP: PagtoRodada = { marcas: [], doQuiz: new Map() };
  if (!d.marcasPagamento || !d.lerPagamento) return vazioP;
  const agoraMs = agora.getTime();
  const lidas = await d.marcasPagamento(new Date(agoraMs - PAGTO_VALE_MS).toISOString());
  if (!lidas) return null;
  const marcas = lidas.filter(m => agoraMs - Date.parse(m.em) <= PAGTO_VALE_MS);
  if (!marcas.length) return vazioP;
  const leads = await d.leads(new Date(agoraMs - TETO_CALENDARIO_MS).toISOString(), agora.toISOString());
  if (!leads) return null;
  const doQuiz = new Map<string, LeadRec>();
  for (const l of leads) { const h = hmacDoLeadRec(l); if (h && !doQuiz.has(h)) doQuiz.set(h, l); }
  return { marcas, doQuiz };
}

/** O telefone da marca: o da atribuição do contrato ou o do lead do quiz, o que bater com o hmac da chave. null = não dá para chamar. */
function telefoneDaMarca(m: MarcaPagto, dados: DadosPagamento | null, quiz: LeadRec | null): string | null {
  for (const bruto of [dados?.whatsapp, quiz?.whatsapp]) {
    const tel = normalizarTelefoneSd(bruto);
    if (tel && hmacDe(chaveDoTelefone(tel)) === m.hmac) return tel;
  }
  return null;
}

/** O lead da marca: o do quiz, ou um montado só com o que a marca sabe (serve às conferências do e-mail da LP). */
function leadDaMarca(m: MarcaPagto, quiz: LeadRec | null, tel: string): LeadRec {
  return quiz ?? {
    lead_id: `pagto_${m.contratoId}`, nome: m.nome, whatsapp: tel, cidade: null, created_time: m.em,
    field_data: m.lp_session ? [{ name: 'lp_session', values: [m.lp_session] }] : [],
  };
}

/** O `utm_term` da marca; sem ele, o do lead do quiz. */
function utmTermDaMarca(m: MarcaPagto, quiz: LeadRec | null): string | null {
  return m.utm_term ?? (quiz ? campoFd(quiz.field_data, 'utm_term') || null : null);
}

/** Comprou/pagou? Contrato pago, sessão da LP na venda ou e-mail com compra. Erro LANÇA (quem chama não envia). */
async function pagouPelaMarca(d: DepsRec, m: MarcaPagto, dados: DadosPagamento, vendas: VendasRecentes): Promise<boolean> {
  if (dados.contrato && contratoPago(dados.contrato)) return true;
  if (m.lp_session && vendas.sessoes.has(m.lp_session)) return true;
  const email = m.email ?? dados.contrato?.email ?? null;
  if (email && d.compraPorEmail && await d.compraPorEmail(vendas, email)) return true;
  return false;
}

/** Quem pagou ou reprovou por motivo permanente não volta: a chave `quiz_rec_pulou:` tira a marca da leitura das rodadas seguintes. */
async function pularMarca(d: DepsRec, hmac: string, motivo: string, agora: Date): Promise<void> {
  try { await d.marcarPulo?.(`${PREFIXO_PULOU_REC}${hmac}`, motivo, agora); } catch { /* sem a marca ele só é reavaliado */ }
}

/**
 * Quem fez o quiz, chegou na parte do pagamento e ainda não foi chamado: as marcas de 5 min a 120 h, sem o claim `quiz_rec_sent:` nem o
 * `quiz_rec_pulou:`, com o contrato lido, sem pagamento e com o código na fase certa (menos de 55 min = código; 65 min ou mais = link; no meio
 * espera). A marca SÓ DA LP (sem lead do quiz) não vai ao WhatsApp: o wa.me da LP não leva código, e quem escreveu por um LID sem mapa passaria como
 * "não falou". `hmacs` leva TODAS as marcas (até as de menos de 5 min): a mensagem de 15 min não atropela quem está pagando.
 */
async function lerFilaPagamento(d: DepsRec, agora: Date, p: PagtoRodada): Promise<{ itens: ItemPagto[]; hmacs: Set<string> }> {
  const hmacs = new Set(p.marcas.map(m => m.hmac));
  if (!d.lerPagamento) return { itens: [], hmacs };
  const agoraMs = agora.getTime();
  const prontas = p.marcas
    .filter(m => p.doQuiz.has(m.hmac) && agoraMs - Date.parse(m.em) >= PAGTO_ESPERA_MS)
    .sort((a, b) => Date.parse(b.em) - Date.parse(a.em));   // quem acabou de chegar primeiro: a marca parada não trava as novas
  if (!prontas.length) return { itens: [], hmacs };
  const tem = await d.existentes(prontas.flatMap(m => [`${PREFIXO_CARIMBO_REC}${m.hmac}`, `${PREFIXO_PULOU_REC}${m.hmac}`]));
  if (!tem) return { itens: [], hmacs };
  const itens: ItemPagto[] = [];
  for (const m of prontas) {
    if (itens.length >= PAGTO_POR_RODADA) break;
    if (tem.has(`${PREFIXO_CARIMBO_REC}${m.hmac}`) || tem.has(`${PREFIXO_PULOU_REC}${m.hmac}`)) continue;
    const dados = await d.lerPagamento(m.contratoId);
    if (!dados) continue;   // leitura falhou: tenta na próxima rodada (a marca segue segurando a mensagem de 15 min)
    if (!dados.contrato) { hmacs.delete(m.hmac); continue; }   // contrato sumiu: a marca não vale, a pessoa volta à fila de sempre
    if (contratoPago(dados.contrato)) { await pularMarca(d, m.hmac, 'pagou', agora); continue; }   // pagou: não é relida a cada rodada
    const quiz = p.doQuiz.get(m.hmac) as LeadRec;
    const tel = telefoneDaMarca(m, dados, quiz);
    if (!tel) { hmacs.delete(m.hmac); continue; }   // sem telefone que bata com o hmac: não dá para chamar por aqui
    if (faseDoCodigo(dados.contrato, agoraMs) === 'espera') continue;   // entre 55 e 65 min o código está no fim: espera
    itens.push({ lead: quiz, marca: m, quiz, dados, utmTerm: utmTermDaMarca(m, quiz) });
  }
  return { itens, hmacs };
}

/**
 * O e-mail do Pix que ficou esperando, UM por contrato (claim `quiz_pagto_email:<contratoId>`). Fora da janela do WhatsApp vai para todas as marcas;
 * dentro dela, só para a marca SÓ DA LP (que nunca vai ao WhatsApp). Antes do claim passa pelas mesmas conferências da mensagem (já falou com a
 * linha, supressão, mudo, pausa humana, posse, teste, compra e contrato pago); depois do claim e antes de enviar, lê de novo se a pessoa pagou.
 * Nunca lança.
 */
async function emailDoPagamento(d: DepsRec, agora: Date, r: RelatorioRec, p: PagtoRodada, foraDaJanela: boolean): Promise<void> {
  try {
    if (!d.lerPagamento || !d.enviarEmailPix) return;
    const agoraMs = agora.getTime();
    const prontas = p.marcas
      .filter(m => m.email && agoraMs - Date.parse(m.em) >= PAGTO_ESPERA_MS && (foraDaJanela || !p.doQuiz.has(m.hmac)))
      .sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
    if (!prontas.length) return;
    const tem = await d.existentes(prontas.flatMap(m => [
      `${PREFIXO_CARIMBO_REC}${m.hmac}`, `${PREFIXO_PULOU_REC}${m.hmac}`, `${PREFIXO_PAGTO_EMAIL}${m.contratoId}`,
    ]));
    if (!tem) return;
    let vendas: VendasRecentes;
    try { vendas = await d.vendas(agoraMs); } catch { return; }
    let enviados = 0;
    for (const m of prontas) {
      if (enviados >= EMAILS_POR_RODADA) break;
      // Já foi chamado pelo WhatsApp (claim), já saiu da fila (pulo) ou já recebeu o e-mail deste contrato: nada.
      if (tem.has(`${PREFIXO_CARIMBO_REC}${m.hmac}`) || tem.has(`${PREFIXO_PULOU_REC}${m.hmac}`) || tem.has(`${PREFIXO_PAGTO_EMAIL}${m.contratoId}`)) continue;
      const quiz = p.doQuiz.get(m.hmac) ?? null;
      let utmTerm: string | null;
      try {
        const dados = await d.lerPagamento(m.contratoId);
        if (!dados || !dados.contrato) continue;
        if (contratoPago(dados.contrato)) { await pularMarca(d, m.hmac, 'pagou', agora); continue; }
        const tel = telefoneDaMarca(m, dados, quiz);
        if (!tel) continue;   // sem telefone não dá para conferir a conversa: na dúvida, ninguém é incomodado
        if (await pagouPelaMarca(d, m, dados, vendas)) continue;
        const av = await avaliarLead(leadDaMarca(m, quiz, tel), { agoraMs, largadaMs: null, vendas, viaPagamento: true }, d);
        if (!av.ok) {
          if (MOTIVOS_PERMANENTES_REC.has(av.motivo)) await pularMarca(d, m.hmac, av.motivo, agora);
          continue;
        }
        utmTerm = utmTermDaMarca(m, quiz);
      } catch { continue; }   // na dúvida sobre a compra ou a conversa, ninguém é incomodado
      const chaveEmail = `${PREFIXO_PAGTO_EMAIL}${m.contratoId}`;
      const claim = await d.claim(chaveEmail, agora);
      if (claim !== 'ok') continue;
      // Depois do claim e antes de enviar: pagou nesse meio tempo?
      try {
        const fresco = await d.lerPagamento(m.contratoId);
        const vendas2 = await d.vendas(Date.now());
        if (!fresco || !fresco.contrato || await pagouPelaMarca(d, m, fresco, vendas2)) { await d.apagarClaim(chaveEmail); continue; }
      } catch { await d.apagarClaim(chaveEmail); continue; }
      try {
        await d.enviarEmailPix(m.email as string, linkDoPagamento(utmTerm, 'email'));
        enviados++;
        r.decisoes.push({ hmac8: m.hmac.slice(0, 8), resultado: 'email_pix', motivo: null });
      } catch (e) {
        await d.apagarClaim(chaveEmail);   // o e-mail não saiu: a próxima rodada tenta de novo
        logger.error(LOG, `e-mail do Pix falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`);
        break;
      }
    }
  } catch (e) {
    logger.error(LOG, `e-mail do Pix: a leitura falhou (${String((e as Error)?.message ?? e).slice(0, 60)})`);
  }
}

/** Telefone com a metade escondida para o aviso ao Thiago: "5534****0001". */
const mascarar = (tel: string): string => `${tel.slice(0, 4)}****${tel.slice(-4)}`;

export async function runQuizRecuperacaoTick(opts: OpcoesRec = {}, deps?: DepsRec): Promise<RelatorioRec> {
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReais();
  const r = vazio();
  try {
    // 0. ligada? (a chave do banco é lida aqui e de novo antes do envio)
    const est = await d.estado();
    if (!est.ligada) return { ...r, ligada: false, motivo: est.motivo };
    if (!d.segredoOk()) return { ...r, ok: false, motivo: 'sem_segredo_de_hmac' };

    // 1. a largada: a 1ª rodada grava e só lead gravado depois dela entra
    let largada: number;
    try { largada = await d.garantirLargada(agora); } catch (e) {
      logger.error(LOG, `largada falhou: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
      return { ...r, ok: false, motivo: 'largada_falhou' };
    }

    // Fora da janela: nada de envio. Depois das 20h, em dia que a janela abriu, o lead sem vaga ganha o aviso do grupo.
    const dentroDaJanela = d.janela(agora);
    // As marcas do pagamento, lidas uma vez. Dentro da janela, leitura que falha PARA a rodada: sem a marca, a mensagem de 15 min deixaria de
    // pular quem está pagando.
    const pagtoR = await carregarPagto(d, agora);
    if (dentroDaJanela && !pagtoR) return { ...r, ok: false, motivo: 'leitura_das_marcas_falhou' };
    if (!dentroDaJanela) {
      // Quem gerou o Pix e não pagou ganha o e-mail (1 por contrato) enquanto a janela do WhatsApp está fechada.
      if (pagtoR) await emailDoPagamento(d, agora, r, pagtoR, true);
      if (horaDeBRT(agora) >= JANELA_FECHA_H && d.janela(meioDiaBRT(agora))) await semVaga(d, agora, largada, r);
      return { ...r, motivo: 'fora_da_janela' };
    }

    // A marca SÓ DA LP não vai ao WhatsApp (o wa.me da LP não leva código): recebe o e-mail, também dentro da janela.
    await emailDoPagamento(d, agora, r, pagtoR as PagtoRodada, false);

    // 2. as travas, nesta ordem
    const barra = await travas(d, agora, true);
    if (barra) return { ...r, motivo: barra };

    // 3. a vez de 10 min
    const vez = await d.tomarVez(agora);
    if (vez !== 'tomada') return { ...r, motivo: vez === 'ocupada' ? 'vez_ocupada' : 'vez_nao_reservada' };
    await d.limparVezes(agora);

    // 4. a fila
    // Quem chegou na parte do pagamento vai ao TOPO, antes do corte de avaliações da rodada; a mensagem de 15 min não o atropela.
    const pagto = await lerFilaPagamento(d, agora, pagtoR as PagtoRodada);
    const lida = await lerFila(d, agora, largada, { excluir: pagto.hmacs });
    if (!lida) return { ...r, ok: false, motivo: 'leitura_da_fila_falhou' };
    const itens: ItemFila[] = [...pagto.itens.map(p => ({ lead: p.lead, pagto: p })), ...lida.fila.map(l => ({ lead: l }))];
    r.candidatos = itens.length;
    if (!itens.length) return r;

    let vendas: VendasRecentes;
    try { vendas = await d.vendas(agora.getTime()); } catch { return { ...r, ok: false, motivo: 'erro_compras' }; }
    const ctx: ContextoAvaliar = { agoraMs: agora.getTime(), largadaMs: largada, vendas };

    for (const { lead, pagto: pg } of itens) {
      if (r.avaliados >= AVALIACOES_POR_RODADA) { soma(r.puladas, 'limite_por_rodada'); break; }
      r.avaliados++;
      const hmac = hmacDoLeadRec(lead) as string;
      const hmac8 = hmac.slice(0, 8);
      const nota = (resultado: string, motivo: string | null): void => {
        r.decisoes.push({ hmac8, resultado, motivo });
        if (motivo) soma(r.puladas, motivo);
      };

      // 5. antes do claim: compra, posse, já falou, pausa humana e supressão; depois o phone-exists
      const av = await avaliarLead(lead, pg ? { ...ctx, viaPagamento: true } : ctx, d);
      if (!av.ok) {
        nota('pulou', av.motivo);
        if (MOTIVOS_PERMANENTES_REC.has(av.motivo)) { try { await d.marcarPulo?.(`${PREFIXO_PULOU_REC}${hmac}`, av.motivo, agora); } catch { /* sem a marca ele só é reavaliado */ } }
        continue;
      }
      // Quem marcou no quiz que prefere pagar no Pix ouve que dá para assinar no Pix por aqui (só se há Pix disponível agora).
      // Pagamento: contrato pago, sessão da LP na venda ou e-mail com compra tiram o lead antes de gastar o phone-exists.
      if (pg) {
        try {
          if (await pagouPelaMarca(d, pg.marca, pg.dados, vendas)) { await pularMarca(d, hmac, 'comprou', agora); nota('pulou', 'comprou'); continue; }
        } catch { nota('pulou', 'leitura_falhou'); continue; }
      }
      // O caminho do pagamento monta o texto DEPOIS do claim, com o contrato relido (a idade do código decide entre código e link).
      const pixPorAqui = campoFd(lead.field_data, 'pagamento') === 'pix' && modoPix() !== 'indisponivel';
      const texto = pg ? null : textoDaCarla(lead, { pixPorAqui });
      if (texto && !texto.ok) { nota('pulou', texto.motivo); continue; }
      const existe = await d.telefoneExiste(av.tel);
      if (existe === 'erro') { nota('parou', 'phone_exists_falhou'); break; }
      if (existe === 'nao') {
        // Sem WhatsApp: a Carla não chama nunca; o grupo é avisado (pendente, o tick do B1 envia).
        if (!pg || pg.quiz) await d.avisarNaoChama(lead, FRASE_DO_MOTIVO.sem_whatsapp);
        nota('pulou', 'sem_whatsapp');
        continue;
      }

      // 6. as travas de novo (a chave do banco também), o claim, a posse, a releitura e o envio
      const agoraEnvio = opts.agora ?? new Date();
      const est2 = await d.estado();
      if (!est2.ligada) { nota('parou', est2.motivo); r.ligada = false; break; }
      const barra2 = await travas(d, agoraEnvio);
      if (barra2) { nota('parou', barra2); break; }

      const chaveClaim = `${PREFIXO_CARIMBO_REC}${hmac}`;
      const claim = await d.claim(chaveClaim, agoraEnvio);
      if (claim === 'ja') { nota('pulou', 'ja_reivindicado'); continue; }
      if (claim === 'erro') { nota('parou', 'erro_no_claim'); break; }

      const em = agoraEnvio.toISOString();
      let posse = await d.assumirPosse(av.chave, em);
      if (posse === 'erro') posse = (await d.posseAindaNossa(av.chave, em)) ? 'assumida' : 'erro';
      if (posse !== 'assumida') {
        await d.apagarClaim(chaveClaim);
        nota(posse === 'ja_tinha_dona' ? 'pulou' : 'parou', posse === 'ja_tinha_dona' ? 'posse_tomada_agora' : 'posse_falhou');
        if (posse === 'erro') break;
        continue;
      }
      const desfazer = async (): Promise<void> => { await d.desfazerPosse(av.chave, em); await d.apagarClaim(chaveClaim); };

      // Releitura logo antes do envio: o lead ou um humano escreveu, ou alguém tomou a posse? Aborta.
      let reler: string | null;
      try {
        const falou = await jaFalouComALinha(lead, av.tel, av.chave, d);
        if (falou !== 'nao') reler = falou;
        else {
          const pode = await podeFalarAgora(av.tel, d);
          reler = pode === 'sim' ? ((await d.posseAindaNossa(av.chave, em)) ? null : 'posse_perdida') : pode;
        }
      } catch { reler = 'leitura_falhou'; }
      // Pagamento: depois do claim e ANTES de enviar, lê de novo se a pessoa pagou (contrato, venda e e-mail) e fixa o texto pelo contrato de agora.
      let textoPg: TextoPagto | null = null;
      if (!reler && pg) {
        try {
          const fresco = await d.lerPagamento?.(pg.marca.contratoId);
          if (!fresco || !fresco.contrato) reler = 'pagamento_falhou';
          else {
            const vendas2 = await d.vendas(agoraEnvio.getTime());
            const lp = campoFd(lead.field_data, 'lp_session') || pg.marca.lp_session || '';
            if (await pagouPelaMarca(d, pg.marca, fresco, vendas2) || await d.compra(vendas2, lp, chaveDoTelefone(av.tel))) reler = 'pagou';
            else {
              const c = fresco.contrato;
              // Menos de 55 min = código; 65 min ou mais = link; no meio o código está no fim e a rodada espera (o claim volta).
              const fase = faseDoCodigo(c, agoraEnvio.getTime());
              if (fase === 'espera') reler = 'aguardando_codigo';
              else {
                textoPg = montarTextoPagamento({
                  codigoVivo: fase === 'codigo',
                  qrPayload: c.qr_payload,
                  nome: nomeDoPagamento(pg.quiz.nome, pg.marca.nome),
                  empresa: empresaDoQuiz(pg.quiz.field_data),
                  utmTerm: pg.utmTerm,
                  horaBrt: horaDeBRT(agoraEnvio),
                });
              }
            }
          }
        } catch { reler = 'pagamento_falhou'; }
      }
      if (reler) { await desfazer(); nota('abortou', `releitura_${reler}`); continue; }

      // O sendFrio devolve false (calado) quando há pausa humana: o aviso "falou às" só sai depois de um envio que de fato foi feito.
      let saiu = false;
      try {
        saiu = await d.enviar(av.tel, textoPg ? textoPg.texto : (texto as { texto: string }).texto);
      } catch (err) {
        const cod = codigoDoErroDeEnvio(err);
        logger.error(LOG, `envio ${hmac8} falhou (${cod})`);
        if (erroEhDoDestino(err)) {
          // Número ruim: o claim FICA (nunca tenta de novo), a posse volta, não conta como erro da linha.
          await d.desfazerPosse(av.chave, em);
          if (!pg || pg.quiz) await d.avisarNaoChama(lead, FRASE_DO_MOTIVO.sem_whatsapp);
          nota('envio_falhou', 'destino');
        } else if (erroProvaQueNaoSaiu(err)) {
          await desfazer();
          await d.erroDeLinha(agoraEnvio);
          nota('envio_falhou', cod);
        } else {
          // Timeout e 5xx podem ter saído: claim e posse ficam, o erro conta e o grupo recebe um aviso que não afirma nada.
          await d.erroDeLinha(agoraEnvio);
          await d.marcarClaim(chaveClaim, { em, estado: 'incerto' });
          if (!pg || pg.quiz) await d.avisarNaoChama(lead, 'A Carla tentou chamar, mas não sei se a mensagem saiu.');
          nota('envio_falhou', cod);
        }
        break;
      }
      if (!saiu) {
        // Nada saiu. O carimbo FICA (1 por pessoa) mas marcado, para o tick não escrever "falou às"; a posse nova volta; o tick avisa com o motivo.
        await d.desfazerPosse(av.chave, em);
        await d.marcarClaim(chaveClaim, { em, estado: 'nao_saiu' });
        nota('nao_enviou', 'envio_nao_saiu');
        break;
      }
      // Envio provado: o carimbo ganha o estado 'enviado', que é o que deixa o tick escrever "A Carla falou às".
      await d.marcarClaim(chaveClaim, { em, estado: 'enviado' });
      await d.envioOk(agoraEnvio);
      // O código do Pix vai sozinho, na mensagem seguinte, e só porque a primeira saiu. Se esta falhar a primeira já foi: o claim fica como 'enviado'.
      if (textoPg?.segundo) {
        let segundoSaiu = false;
        try {
          await d.esperar?.(2000 + Math.floor(Math.random() * 3000));   // 2 a 5 s, como as respostas
          segundoSaiu = await d.enviar(av.tel, textoPg.segundo);
        } catch (err) {
          logger.error(LOG, `2ª mensagem (código) de ${hmac8} falhou (${codigoDoErroDeEnvio(err)})`);
          // Erro que não é do destino conta na linha (regra 16); o do destino não.
          if (!erroEhDoDestino(err)) await d.erroDeLinha(agoraEnvio);
        }
        if (!segundoSaiu) {
          try { await d.avisarThiago?.(`A Carla mandou a 1ª mensagem do Pix a ${mascarar(av.tel)}, mas o código não saiu: a 1ª prometia o código.`); } catch { /* só avisa */ }
        }
      }
      if (!pg || pg.quiz) await d.avisarSaiu(lead, horaBRT(agoraEnvio.getTime()));
      r.enviou = true;
      nota('enviada', null);
      break;
    }
    return r;
  } catch (e) {
    logger.error(LOG, `a rodada falhou (${String((e as Error)?.message ?? e).slice(0, 80)})`);
    return { ...r, ok: false, motivo: 'a_rodada_falhou' };
  } finally {
    // UM e-mail por rodada com os avisos sem grupo; nunca derruba a rodada.
    // Limite conhecido: se a função estourar o `maxDuration` da Vercel, o `finally` não roda e os claims coletados ficam `sem_grupo` (sem e-mail).
    // Para a rodada do robô (no máximo 8 avaliações e 1 envio) isso é raro; o `sem_grupo` continua contando como avisado só na desistência.
    try { await d.fecharRodada?.(); } catch (e) { logger.error(LOG, `fechar a rodada falhou (${String((e as Error)?.message ?? e).slice(0, 80)})`); }
  }
}

/**
 * Depois das 20h de um dia em que a janela abriu: o lead que a Carla poderia chamar e não recebeu ganha o "sem vaga hoje" no grupo,
 * UMA vez por lead, para sempre (quiz_aviso:<hmac>:semvaga), e nunca se o time já recebeu a desistência dele (lerFila tira quem tem
 * quiz_aviso). Só vale lead gravado antes das 20h de hoje. Nunca envia ao lead.
 */
async function semVaga(d: DepsRec, agora: Date, largada: number, r: RelatorioRec): Promise<void> {
  try {
    const corte = Date.parse(`${diaBRT(agora.getTime())}T23:00:00.000Z`);   // 20h de Brasília de hoje
    const lida = await lerFila(d, agora, largada, { semAvisados: true });
    if (!lida || !lida.fila.length) return;
    const novos = lida.fila.filter(l => (Date.parse(String(l.created_time ?? '')) || 0) < corte);
    if (!novos.length) return;
    let vendas: VendasRecentes;
    try { vendas = await d.vendas(agora.getTime()); } catch { return; }
    const ctx: ContextoAvaliar = { agoraMs: agora.getTime(), largadaMs: largada, vendas };
    let avaliados = 0;
    for (const lead of novos) {
      if (r.semVaga >= SEM_VAGA_POR_RODADA || avaliados >= SEM_VAGA_AVALIACOES) break;
      avaliados++;
      const av = await avaliarLead(lead, ctx, d);
      if (!av.ok) continue;
      const res = await d.avisarSemVaga(lead);
      if (res === 'enviado' || res === 'pendente' || res === 'sem_grupo' || res === 'por_email') r.semVaga++;
      r.decisoes.push({ hmac8: av.hmac.slice(0, 8), resultado: 'sem_vaga', motivo: res });
    }
  } catch (e) {
    logger.warn(LOG, `sem vaga falhou (${String((e as Error)?.message ?? e).slice(0, 80)})`);
  }
}

// ── as dependências de verdade ───────────────────────────────────────────────

const colunas = 'lead_id, nome, whatsapp, cidade, field_data, created_time';

export function depsReais(): DepsRec {
  const base = depsAvaliarReais();
  // Os avisos desta rodada que ficarem sem id de grupo (opt-in do robô): saem em UM e-mail no fim (`fecharRodada`).
  const semGrupo: ColetorSemGrupo = [];
  return {
    ...base,
    fecharRodada: () => fecharSemGrupo(semGrupo),
    estado: () => estadoRecuperacaoCarla(),
    segredoOk: () => !!hmacDe('quiz-rec'),
    garantirLargada: (agora) => garantirLargada(agora),
    janela: (agora) => dentroDaJanelaDaBaseLinha(agora),
    async linhaPausada(agora) {
      const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
      if (error) return 'erro';
      const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
      return Number.isFinite(ate) && ate > agora.getTime() ? 'sim' : 'nao';
    },
    tetoHorario: () => dentroDoTetoHorarioLinha({ robo: ROBO_QUIZ_REC }),
    espacamento: () => respeitaEspacamentoLinha(),
    async tomarVez(agora) {
      const v = await reservarChave(chaveVezRec(agora), {}, agora);
      return v === 'reservada' ? 'tomada' : v === 'ja_existe' ? 'ocupada' : 'erro';
    },
    /** As vezes de 10 min ficam 2 h e saem. */
    async limparVezes(agora) {
      try {
        await supabase.from('system_state').delete().like('key', `${PREFIXO_VEZ_REC}%`).lt('updated_at', new Date(agora.getTime() - 2 * 3_600_000).toISOString());
      } catch { /* sobra no máximo 12 linhas por hora */ }
    },
    async leads(desdeIso, ateIso) {
      try {
        const { data, error } = await supabaseGerador.from('leads_meta').select(colunas)
          .eq('form_id', 'quiz_solardoc').gte('created_time', desdeIso).lte('created_time', ateIso)
          .order('created_time', { ascending: false }).limit(300);   // do mais novo: a leitura larga (120 h) nunca corta o lead fresco; `ordenarFila` reordena
        if (error) return null;
        return (data ?? []) as LeadRec[];
      } catch { return null; }
    },
    async existentes(chaves) {
      try { return chaves.length ? await chavesExistentes(chaves) : new Set<string>(); } catch { return null; }
    },
    vendas: (agoraMs) => vendasRecentes(agoraMs),
    telefoneExiste: (tel) => numeroTemWhatsApp(tel, 'io'),
    claim: async (chave, agora) => {
      const v = await reservarChave(chave, { em: agora.toISOString() }, agora);
      return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro';
    },
    apagarClaim: (chave) => liberarChave(chave),
    async marcarPulo(chave, motivo, agora) { await reservarChave(chave, { em: agora.toISOString(), motivo }, agora); },
    async marcasPagamento(desdeIso) {
      try {
        const { data, error } = await supabase.from('system_state').select('key, value')
          .like('key', `${PREFIXO_PAGTO}%`).gte('updated_at', desdeIso).order('updated_at', { ascending: false }).limit(300);
        if (error) return null;
        return ((data ?? []) as Array<{ key: string; value: unknown }>).flatMap(l => { const m = marcaDeLinha(l.key, l.value); return m ? [m] : []; });
      } catch { return null; }
    },
    async lerPagamento(contratoId) {
      try {
        const { data, error } = await supabase.from('asaas_pix_assinaturas')
          .select('status, created_at, qr_payload, ultimo_pagamento_em, ultimo_pagamento_id, email').eq('contract_id', contratoId).maybeSingle();
        if (error) return null;
        // O WhatsApp mora na atribuição do contrato (a marca só leva o hmac); a leitura dela que falhar vale "sem telefone".
        let whatsapp: string | null = null;
        try {
          const { data: atr } = await supabase.from('system_state').select('value').eq('key', `pix_auto_atrib:${contratoId}`).maybeSingle();
          const w = (atr as { value?: { whatsapp?: unknown } } | null)?.value?.whatsapp;
          whatsapp = typeof w === 'string' && w.trim() ? w.trim() : null;
        } catch { whatsapp = null; }
        return { contrato: (data as DadosPagamento['contrato']) ?? null, whatsapp };
      } catch { return null; }
    },
    compraPorEmail: (vendas, email) => comprouPorEmail(vendas, email),
    esperar: (ms) => new Promise<void>(ok => setTimeout(ok, ms)),
    async avisarThiago(texto) {
      const { sendOpsAlert } = await import('../../utils/mailer');
      await sendOpsAlert('Carla: o código do Pix não saiu', `<p>${texto}</p>`);
    },
    async enviarEmailPix(para, link) {
      const { sendPixEsperandoEmail } = await import('../../utils/mailer');
      await sendPixEsperandoEmail({ to: para, link });
    },
    async marcarClaim(chave, valor) {
      // O update devolve { error } sem lançar: conferir os dois (exceção e erro). O claim fica como está; o tick trata carimbo sem estado como "não saiu".
      try {
        const { error } = await supabase.from('system_state').update({ value: valor, updated_at: new Date().toISOString() }).eq('key', chave);
        if (error) logger.error(LOG, `marcar o carimbo falhou (${String((error as { code?: string; message?: string }).code ?? (error as { message?: string }).message ?? 'erro').slice(0, 40)})`);
      } catch (e) { logger.error(LOG, `marcar o carimbo falhou (${String((e as Error)?.message ?? e).slice(0, 40)})`); }
    },
    assumirPosse: (chave, em) => assumirPosse(chave, 'carla', null, em),
    async posseAindaNossa(chave, em) {
      try {
        const p = await lerPosse(chave);
        return !!p && p.dona === 'carla' && p.estado === 'viva' && Date.parse(p.desde) === Date.parse(em);
      } catch { return false; }
    },
    desfazerPosse: (chave, em) => desfazerPosseNova(chave, 'carla', em),
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
    // O aviso entra PENDENTE: quem envia ao grupo é o tick do B1, com o espaçamento dele (nunca na mesma rodada).
    avisarSaiu: (lead, hora) => avisarDesistencia(lead, { horaCarla: hora, soReivindicar: true, coletorSemGrupo: semGrupo }),
    avisarNaoChama: (lead, frase) => avisarDesistencia(lead, { motivoCarla: frase, soReivindicar: true, coletorSemGrupo: semGrupo }),
    avisarSemVaga: (lead) => avisarSemVaga(lead, { coletorSemGrupo: semGrupo }),
  };
}

// ── a sonda de admin: só lê, nunca envia ─────────────────────────────────────

export interface LinhaSonda { hmac8: string; codigo: string; nome: string; idade_min: number | null; intencao: string; situacao: string; motivo: string | null; posicao?: number }

export interface RelatorioSonda {
  estado: { ligada: boolean; motivo: string };
  largada: string | null;
  janela_agora: boolean;
  linha_pausada: string;
  vagas_do_frio: { hora: { teto: number; usadas: number }; dia: { teto: number; usadas: number } } | null;
  leads: LinhaSonda[];
}

/**
 * Cada lead do quiz das últimas 50 h com o motivo: elegível (e a posição na fila) ou por que não. Só leitura: não chama o phone-exists,
 * não toma vez, claim nem posse e não envia. Avalia no máximo 40 leads com as leituras de verdade; o resto vai só com o motivo do que é puro.
 */
export async function sondarRecuperacaoQuiz(opts: { agora?: Date; vagas?: () => Promise<RelatorioSonda['vagas_do_frio']> } = {}, deps?: DepsRec): Promise<RelatorioSonda> {
  const agora = opts.agora ?? new Date();
  const d = deps ?? depsReais();
  const estado = await d.estado();
  let largada: number | null = null;
  try { largada = await lerLargada(); } catch { /* largada ilegível: tudo vale "antes da largada" */ }
  const pausa = await d.linhaPausada(agora);
  const relatorio: RelatorioSonda = {
    estado: { ligada: estado.ligada, motivo: estado.motivo },
    largada: largada === null ? null : new Date(largada).toISOString(),
    janela_agora: d.janela(agora),
    linha_pausada: pausa === 'sim' ? 'sim' : pausa === 'nao' ? 'nao' : 'leitura falhou',
    vagas_do_frio: opts.vagas ? await opts.vagas().catch(() => null) : null,
    leads: [],
  };
  const agoraMs = agora.getTime();
  const lidos = await d.leads(new Date(agoraMs - TETO_CALENDARIO_MS - 2 * 3600_000).toISOString(), agora.toISOString());
  if (!lidos) return relatorio;
  let vendas: VendasRecentes | null = null;
  try { vendas = await d.vendas(agoraMs); } catch { vendas = null; }
  const tem = await d.existentes(lidos.flatMap(l => { const h = hmacDoLeadRec(l); return h ? [`${PREFIXO_CARIMBO_REC}${h}`, `${PREFIXO_CLAIM_QUIZ}${h}`, `${PREFIXO_AINDA_REC}${h}`] : []; }));
  let posicao = 0;
  let avaliados = 0;
  for (const lead of ordenarFila(lidos.filter(l => !ehLeadDeTeste(l.field_data)))) {
    const h = hmacDoLeadRec(lead);
    const tel = normalizarTelefoneSd(lead.whatsapp);
    const idade = Date.parse(String(lead.created_time ?? ''));
    const linha: LinhaSonda = {
      hmac8: (h ?? 'sem-hmac').slice(0, 8), codigo: tel ? codigoDoQuiz(tel) : '', nome: String(lead.nome ?? '').trim().split(/\s+/)[0]?.slice(0, 20) ?? '',
      idade_min: Number.isFinite(idade) ? Math.round((agoraMs - idade) / 60_000) : null,
      intencao: campoFd(lead.field_data, 'quando_comecar') || 'sem resposta', situacao: 'nao_elegivel', motivo: null,
    };
    relatorio.leads.push(linha);
    if (!h) { linha.motivo = 'sem_telefone'; continue; }
    if (tem?.has(`${PREFIXO_CARIMBO_REC}${h}`)) { linha.situacao = 'ja_chamado'; continue; }
    if (tem?.has(`${PREFIXO_CLAIM_QUIZ}${h}`) && !tem.has(`${PREFIXO_AINDA_REC}${h}`)) { linha.situacao = 'ja_avisado_ao_grupo'; continue; }
    const tempo = foraDoTempo(lead, agoraMs);
    if (tempo) { linha.motivo = tempo === 'cedo' ? 'menos_de_15_min' : 'vencido_48h'; continue; }
    if (!vendas || avaliados >= 40) { linha.motivo = vendas ? 'nao_avaliado_limite_da_sonda' : 'leitura_de_compras_falhou'; continue; }
    avaliados++;
    const av = await avaliarLead(lead, { agoraMs, largadaMs: largada, vendas }, d);
    if (!av.ok) { linha.motivo = av.motivo; continue; }
    linha.situacao = 'elegivel';
    if (tem?.has(`${PREFIXO_CLAIM_QUIZ}${h}`)) linha.motivo = 'ja_avisado_ao_grupo';   // o time já foi avisado, mas a Carla ainda pode chamar (marca quiz_rec_ainda)
    linha.posicao = ++posicao;
  }
  return relatorio;
}
