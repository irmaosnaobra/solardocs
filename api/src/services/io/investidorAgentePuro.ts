// ─────────────────────────────────────────────────────────────────────────────
// A HELENA, AGENTE DE INVESTIDORES: A PARTE PURA (10/10/2026).
//
// Tudo aqui é função de dado: recebe o que já foi lido e devolve a decisão.
// Nenhuma leitura de banco, nenhum envio, nenhum relógio escondido (a hora entra
// por parâmetro). É o que os testes cobrem.
//
//   · relógio      início, janela própria e teto do dia, sempre em Brasília
//   · fila         quem recebe a abertura, em que ordem, e quem fica de fora
//   · textos       a abertura com o nome e o valor que a pessoa marcou
//   · horários     os 4 horários da oferta e a linha "1. Terça 13/10 às 10:00"
//   · observação   o texto do card, no contrato que o banco lê linha a linha
//   · IA           o que vai para o modelo e a leitura do que volta dele
//
// O orquestrador (banco, envio, IA) é o investidorAgente.ts. Os textos que o
// cliente lê moram em investidorAgenteTextos.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { chaveContato } from '../agents/whatsapp/silenciar';
import { dentroDaJanelaDiurna } from '../agents/whatsapp/lineThrottle';
import { agruparPorDestino, destinoDe, valorEmMil, type LinhaOrigem } from './eletropostoPares';
import { agendaAbre, diaBRT, horasDoDia, livrePara, type Compromisso } from './eletropostoVagas';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import {
  ABERTURAS, ABERTURA_SEM_NOME, REGRAS_DO_PROMPT, OFERTA_HORARIOS, CONFIRMACAO,
  NAO_ENTENDI_O_NUMERO, PASSAGEM_PARA_O_CONSULTOR, DESPEDIDA, PAROU, ADIADO, HORARIO_FOI_OCUPADO,
  ABERTURAS_RESGATE, ABERTURA_RESGATE_SEM_NOME, CONVERSA_DE_RESGATE, RETOMADAS,
} from './investidorAgenteTextos';

// ═════════════════════════════════════════════════════════════════════════════
// RELÓGIO: tudo em Brasília (UTC menos 3, sem horário de verão desde 2019).
// O relógio da máquina e o da Vercel são UTC; por isso a conta é feita aqui, à
// mão, e nunca com `getHours()`.
// ═════════════════════════════════════════════════════════════════════════════

const TRES_HORAS_MS = 3 * 3600_000;

/** Nada sai antes disto: domingo 11/10/2026, 08h de Brasília. */
export const INICIO_ISO = '2026-10-11T11:00:00Z';

/** As duas datas da largada (ordem do dono): janela e teto próprios. */
export const DATAS_DA_LARGADA: ReadonlySet<string> = new Set(['2026-10-11', '2026-10-12']);
export const TETO_NA_LARGADA = 30;
export const TETO_PADRAO = 20;
/** Na largada a janela é das 08:00 às 19:59. */
const LARGADA_INICIO_H = 8;
const LARGADA_FIM_H = 20;

const noFusoDeBrasilia = (agora: Date): Date => new Date(agora.getTime() - TRES_HORAS_MS);

/** "2026-10-11" em Brasília. */
export function dataBrasilia(agora: Date): string {
  return noFusoDeBrasilia(agora).toISOString().slice(0, 10);
}

/** "2026-10-11 08:00" em Brasília, para a prévia. */
export function horaBrasiliaTexto(agora: Date): string {
  return noFusoDeBrasilia(agora).toISOString().slice(0, 16).replace('T', ' ');
}

/** 00:00 de hoje em Brasília, em ISO. É o corte da contagem do teto do dia. */
export function inicioDoDiaBrasiliaIso(agora: Date): string {
  return new Date(`${dataBrasilia(agora)}T00:00:00-03:00`).toISOString();
}

export function antesDoInicio(agora: Date): boolean {
  return agora.getTime() < Date.parse(INICIO_ISO);
}

/**
 * A janela da Helena está aberta agora?
 *
 * Nas duas datas da largada vale das 08:00 às 19:59, domingo inclusive (ordem
 * do dono). Em qualquer outra data vale a janela da linha, como ela está:
 * `dentroDaJanelaDiurna` não foi tocada e nenhuma variável global é usada para
 * cumprir isto (JANELA_DOMINGO_ON abriria o domingo para todos os robôs).
 */
export function janelaAberta(agora: Date): boolean {
  if (DATAS_DA_LARGADA.has(dataBrasilia(agora))) {
    const h = noFusoDeBrasilia(agora).getUTCHours();
    return h >= LARGADA_INICIO_H && h < LARGADA_FIM_H;
  }
  return dentroDaJanelaDiurna(agora);
}

/**
 * O teto de aberturas de hoje.
 *
 * 30 nas duas datas da largada, 20 em qualquer outra. A variável
 * INVESTIDOR_AGENTE_TETO só APERTA (vale o menor dos dois), e a rampa de
 * reconexão da linha também: linha que acabou de voltar manda no ritmo dela.
 * O teto é teto, não meta: o que não saiu hoje não é compensado amanhã.
 */
export function tetoDoDia(agora: Date, env?: string | null, rampaDia?: number | null): number {
  let teto = DATAS_DA_LARGADA.has(dataBrasilia(agora)) ? TETO_NA_LARGADA : TETO_PADRAO;
  const daEnv = String(env ?? '').trim();
  if (/^\d+$/.test(daEnv)) teto = Math.min(teto, Number(daEnv));
  if (typeof rampaDia === 'number' && Number.isFinite(rampaDia) && rampaDia >= 0) teto = Math.min(teto, rampaDia);
  return teto;
}

// ═════════════════════════════════════════════════════════════════════════════
// NOME, TELEFONE E VALOR
// ═════════════════════════════════════════════════════════════════════════════

/** Telefone que a Z-API aceita: Brasil, com 55, 12 ou 13 dígitos. Cadastro sem o
 *  55 (10 ou 11 dígitos) ganha o 55. O resto não é telefone. */
export function telefoneZap(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  const com55 = d.length === 10 || d.length === 11 ? `55${d}` : d;
  if (com55.length < 12 || com55.length > 13 || !com55.startsWith('55')) return null;
  return chaveContato(com55) ? com55 : null;
}

const NAO_E_NOME = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'eng', 'prof', 'teste', 'cliente', 'lead', 'contato',
  'whatsapp', 'sem', 'nome', 'oi', 'ola', 'olá', 'tudo', 'investidor', 'empresa',
]);

/** Minúsculo e sem acento, para comparar palavra sem depender de como foi digitada. */
const semAcento = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Pedaços que denunciam empresa ou cadastro que não é nome de gente. Na prova
// com dado real (11/10/2026) apareceu o cadastro "Eletro posto", que viraria
// "Olá, Eletro!". "mei" e "auto" só valem como começo de palavra: soltos no meio
// eles moram em Almeida e em Mauto.
const RE_NAO_E_PESSOA = /eletro|posto|solar|energia|ltda|eireli|\bmei\b|comercio|servicos|engenharia|grupo|empresa|loja|\bauto|oficina|transport|construt|imobili|consult|\d/;

/** O cadastro parece empresa, ou não é nome? Olha o nome INTEIRO, não só a primeira palavra. */
export function naoPareceNomeDePessoa(nome: unknown): boolean {
  return RE_NAO_E_PESSOA.test(semAcento(nome));
}

/** O primeiro nome, com a inicial maiúscula. `null` quando não dá para chamar a
 *  pessoa por ele (vazio, arroba, apelido com número, título): aí vai a abertura
 *  reserva, que não usa nome. */
export function primeiroNome(nome: unknown): string | null {
  if (naoPareceNomeDePessoa(nome)) return null;
  const p = (String(nome ?? '').trim().replace(/^@/, '').split(/\s+/)[0] ?? '').replace(/[.,;:!?]+$/, '');
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ]{2,20}$/.test(p)) return null;
  if (NAO_E_NOME.has(p.toLocaleLowerCase('pt-BR'))) return null;
  return p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');
}

/** Ficha de teste: o telefone dela costuma ser o nosso. */
export const ehNomeDeTeste = (nome: unknown): boolean => /^\s*teste/i.test(String(nome ?? ''));

/**
 * O valor como entra na frase: o TEXTO que a pessoa marcou, nunca um número
 * calculado. Quando começa com palavra ("Até", "Mais de", "Acima de") a primeira
 * letra vai minúscula, porque ele cai no meio da frase. "R$" fica como está.
 */
export function valorNaFrase(texto: unknown): string {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim().replace(/[.;,]+$/, '');
  if (!t) return '';
  if (/^R\$/i.test(t) || !/^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t)) return t;
  return t.charAt(0).toLocaleLowerCase('pt-BR') + t.slice(1);
}

/** O valor dá para ler E dá para citar numa mensagem? Texto longo ou sem "R$"
 *  nem "mil" é resposta solta de conversa, e citá-la de volta soaria torto. */
export function valorLegivel(texto: unknown): boolean {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 40) return false;
  if (!/R\$|\bmil\b|milh/i.test(t)) return false;
  return valorEmMil(t) !== null;
}

/** O valor declarado, como a pessoa o viu, em cada origem. */
export function valorDeclarado(origem: 'parceria' | 'nota1' | 'agenda', r: Record<string, unknown>): string {
  if (origem === 'parceria') return String(r.capital_faixa ?? '').trim();
  if (origem === 'nota1') {
    const col = String(r.valor_investir ?? '').trim();
    if (col) return col;
    const m = String(r.ficha ?? '').match(/Quanto pretende investir:\s*([^\n]+)/i);
    return m ? m[1]!.trim() : '';
  }
  return '';
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCOLHA DETERMINÍSTICA: a mesma pessoa recebe sempre a mesma versão.
// ═════════════════════════════════════════════════════════════════════════════

/** Soma dos dígitos da chave, módulo N. */
export function indicePorChave(chave: string, n: number): number {
  if (n <= 0) return 0;
  let soma = 0;
  for (const c of String(chave)) if (c >= '0' && c <= '9') soma += Number(c);
  return soma % n;
}

const variacao = (lista: readonly string[], chave: string): string => lista[indicePorChave(chave, lista.length)]!;

/**
 * O texto de uma abertura pelo ÍNDICE dela (-1, ou sem nome que dê para usar, é
 * a reserva). Serve para a escolha de agora e para reconstituir, na conversa que
 * a IA lê, exatamente a abertura que a sessão registrou ter enviado.
 */
export function textoDaAbertura(indice: number, nome: unknown, valorTxt: unknown): string {
  const valor = valorNaFrase(valorTxt);
  const p = primeiroNome(nome);
  const molde = indice >= 0 && indice < ABERTURAS.length && p ? ABERTURAS[indice]! : ABERTURA_SEM_NOME;
  return molde.split('{nome}').join(p ?? '').split('{valor}').join(valor);
}

/** A abertura desta pessoa. `indice` -1 = a reserva, sem nome. */
export function renderAbertura(chave: string, nome: unknown, valorTxt: unknown): { indice: number; texto: string } {
  const indice = primeiroNome(nome) ? indicePorChave(chave, ABERTURAS.length) : -1;
  return { indice, texto: textoDaAbertura(indice, nome, valorTxt) };
}

export const textoPassagem = (chave: string): string => variacao(PASSAGEM_PARA_O_CONSULTOR, chave);
export const textoDespedida = (chave: string): string => variacao(DESPEDIDA, chave);
export const textoParou = (chave: string): string => variacao(PAROU, chave);
export const textoAdiado = (chave: string): string => variacao(ADIADO, chave);
export const textoNaoEntendi = (chave: string): string => variacao(NAO_ENTENDI_O_NUMERO, chave);

// ═════════════════════════════════════════════════════════════════════════════
// FILA
// ═════════════════════════════════════════════════════════════════════════════

export interface RefCadastro { origem: 'parceria' | 'nota1'; id: number }

export interface CandidatoInvestidor {
  chave: string;
  telefone: string;
  nome: string | null;
  valorTxt: string;
  valorMil: number;
  origem: 'parceria' | 'nota1';
  id: number;
  criadoEm: string;
  cidade: string | null;
  /** Status do cadastro (novo, falando, conectado). Só informa: não tira da fila. */
  status: string | null;
  /** Todas as linhas de cadastro daquele telefone, nas duas tabelas. */
  refs: RefCadastro[];
}

export interface FiltrosDaFila {
  /** Chaves (DDD + 8) com QUALQUER card em `agendamentos`, em qualquer status. */
  comCard: ReadonlySet<string>;
  /** Chaves que já têm sessão da Helena. */
  comSessao: ReadonlySet<string>;
  /** Chaves com qualquer mensagem na linha nos últimos 7 dias, nossa ou dele. */
  comConversa: ReadonlySet<string>;
  silenciado: (tel: string) => boolean;
  bloqueado: (tel: string) => boolean;
  mudo: (tel: string) => boolean;
  /** Tem humano dentro da conversa agora (pausa humana). */
  comHumano: (tel: string) => boolean;
  /**
   * O relógio da rodada, em ms. Liga o corte `cadastro_recente` da fila principal.
   * Sem ele (testes antigos, fila do resgate) o corte não roda.
   */
  agora?: number;
}

/**
 * O CADASTRO PRECISA TER 24 HORAS (12/10/2026).
 *
 * Desde a regra da agenda de 13/10 a LP grava o cadastro do investidor ANTES de
 * ele escolher o horário. Nesse intervalo ele já está na fila (tem valor, não tem
 * card ainda) e a abertura da Helena chegaria com a pessoa na tela da agenda.
 * Um dia de espera cobre quem marca na hora e quem volta mais tarde para marcar.
 */
export const CADASTRO_MINIMO_MS = 24 * 3600_000;

export type MotivoForaDaFila =
  | 'telefone_invalido' | 'nome_teste' | 'sem_valor_legivel' | 'pode_ceder_local'
  | 'sem_interesse_no_cadastro' | 'tem_card' | 'tem_sessao' | 'opt_out' | 'bloqueado'
  | 'mudo' | 'humano_na_conversa' | 'conversa_7_dias' | 'duplicado' | 'cadastro_recente';

export interface ResultadoFila {
  fila: CandidatoInvestidor[];
  excluidos: Partial<Record<MotivoForaDaFila, number>>;
  /** Tamanho do grupo Investidores antes de qualquer corte. */
  base: number;
}

const telDaLinha = (l: LinhaOrigem): unknown => (l.origem === 'agenda' ? l.r.cliente_telefone : l.r.telefone);

/**
 * A fila da abertura.
 *
 * Base: o grupo `capital` do `agruparPorDestino`, com as mesmas três origens da
 * aba Investidores. Ordem: maior valor primeiro; no empate, cadastro mais novo
 * primeiro. Uma pessoa uma vez, pela chave DDD + 8 últimos (a mesma pessoa pode
 * estar no cadastro E na ficha, com e sem o nono dígito).
 *
 * DOIS CORTES QUE NÃO ESTAVAM NA LISTA DO PEDIDO e vêm de regra da casa:
 *   · `sem_interesse_no_cadastro`: a equipe marcou que a pessoa disse não (ordem
 *     do dono de 05/10/2026, "não quero falar com essa pessoa por agora").
 *   · `pode_ceder_local`: o `agruparPorDestino` junta por telefone cru, então o
 *     mesmo número escrito de dois jeitos escapa do "melhor destino". Quem pode
 *     ceder um local em OUTRA linha é conversa de arrendamento, não desta agente.
 */
export function montarFila(linhas: LinhaOrigem[], f: FiltrosDaFila): ResultadoFila {
  const refsDe = new Map<string, RefCadastro[]>();
  const podeCeder = new Set<string>();
  const disseNao = new Set<string>();
  // O cadastro MAIS NOVO de cada pessoa, nas duas tabelas. Vale a pessoa e não a
  // linha: quem tem ficha antiga e acabou de se cadastrar de novo pela LP está
  // escolhendo horário agora. `cadastrado_em` entra porque o cadastro de parceria
  // é upsert por (lado, telefone): quem volta mantém o `created_at` antigo.
  const cadastroMaisNovo = new Map<string, number>();
  for (const l of linhas) {
    const tel = telefoneZap(telDaLinha(l));
    const k = tel ? chaveContato(tel) : null;
    if (!k) continue;
    if (destinoDe(l.origem, l.r) === 'ponto') podeCeder.add(k);
    if (l.origem === 'agenda') continue;
    for (const campo of [l.r.created_at, l.r.cadastrado_em]) {
      const t = Date.parse(String(campo ?? ''));
      if (Number.isFinite(t) && t > (cadastroMaisNovo.get(k) ?? 0)) cadastroMaisNovo.set(k, t);
    }
    if (String(l.r.status ?? '') === 'sem_interesse') disseNao.add(k);
    const id = Number(l.r.id);
    if (!Number.isInteger(id)) continue;
    if (!refsDe.has(k)) refsDe.set(k, []);
    refsDe.get(k)!.push({ origem: l.origem, id });
  }

  const excluidos: ResultadoFila['excluidos'] = {};
  const fora = (m: MotivoForaDaFila) => { excluidos[m] = (excluidos[m] ?? 0) + 1; };
  const capital = agruparPorDestino(linhas).capital;
  const passaram: CandidatoInvestidor[] = [];
  // Data ilegível ou ausente NÃO tira ninguém: o corte só vale para o que se sabe.
  const cadastroRecente = (chave: string): boolean => {
    if (f.agora === undefined) return false;
    const t = cadastroMaisNovo.get(chave);
    return t !== undefined && f.agora - t < CADASTRO_MINIMO_MS;
  };

  for (const l of capital) {
    if (l.origem === 'agenda') continue;   // o grupo capital não tem linha de agenda; é só trava de tipo
    const tel = telefoneZap(l.r.telefone);
    const chave = tel ? chaveContato(tel) : null;
    if (!tel || !chave) { fora('telefone_invalido'); continue; }
    if (ehNomeDeTeste(l.r.nome)) { fora('nome_teste'); continue; }
    const valorTxt = valorDeclarado(l.origem, l.r);
    const valorMil = valorEmMil(valorTxt);
    if (valorMil === null || !valorLegivel(valorTxt)) { fora('sem_valor_legivel'); continue; }
    if (podeCeder.has(chave)) { fora('pode_ceder_local'); continue; }
    if (disseNao.has(chave)) { fora('sem_interesse_no_cadastro'); continue; }
    if (f.comCard.has(chave)) { fora('tem_card'); continue; }
    if (f.comSessao.has(chave)) { fora('tem_sessao'); continue; }
    // Depois de `tem_card` e `tem_sessao` de propósito: o número deste motivo na
    // prévia é quem se cadastrou há menos de um dia e AINDA não marcou.
    if (cadastroRecente(chave)) { fora('cadastro_recente'); continue; }
    if (f.silenciado(tel)) { fora('opt_out'); continue; }
    if (f.bloqueado(tel)) { fora('bloqueado'); continue; }
    if (f.mudo(tel)) { fora('mudo'); continue; }
    if (f.comHumano(tel)) { fora('humano_na_conversa'); continue; }
    if (f.comConversa.has(chave)) { fora('conversa_7_dias'); continue; }
    passaram.push({
      chave, telefone: tel,
      nome: String(l.r.nome ?? '').trim() || null,
      valorTxt, valorMil,
      origem: l.origem, id: Number(l.r.id),
      criadoEm: String(l.r.created_at ?? ''),
      cidade: String(l.r.cidade ?? '').trim() || null,
      status: String(l.r.status ?? '').trim() || null,
      refs: refsDe.get(chave) ?? [{ origem: l.origem, id: Number(l.r.id) }],
    });
  }

  passaram.sort((a, b) => (b.valorMil - a.valorMil) || (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));

  // Uma pessoa uma vez: fica a primeira linha dela na ordem acima. O telefone é o
  // mais completo que ela tiver entre as linhas (com o nono dígito), porque a
  // mesma pessoa costuma estar gravada dos dois jeitos.
  const porChave = new Map<string, CandidatoInvestidor>();
  const fila: CandidatoInvestidor[] = [];
  for (const c of passaram) {
    const ja = porChave.get(c.chave);
    if (ja) {
      if (c.telefone.length > ja.telefone.length) ja.telefone = c.telefone;
      fora('duplicado');
      continue;
    }
    porChave.set(c.chave, c);
    fila.push(c);
  }
  return { fila, excluidos, base: capital.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// RESGATE DOS CANCELADOS (12/10/2026)
//
// Ordem do dono: "libera os cancelados para a Helena enviar msg e tentar resgatar
// alguém". Cancelado aqui é quem marcou reunião pela página, não confirmou e teve o
// horário liberado pela régua do SIM (eletropostoCobraSim.ts), que grava
// `status = 'cancelado'` no card e o carimbo `ep_liberado_sim:<id>`. O parecer
// anti-ban liberou com limites, e TODOS estão aqui ou no orquestrador:
//   · 14 dias ou mais desde a liberação mais recente;
//   · no máximo 5 aberturas de resgate por dia, DENTRO do teto do dia da Helena;
//   · intercalado: a 3ª, 8ª, 13ª, 18ª e 23ª abertura do dia, nunca em bloco;
//   · disjuntor próprio do grupo (2 pedidos de parada no dia).
// A fila principal (montarFila) não foi tocada.
// ═════════════════════════════════════════════════════════════════════════════

/** Aberturas de resgate por dia de Brasília. A env só APERTA. */
export const RESGATE_POR_DIA = 5;
/** A liberação mais recente tem que ter, no mínimo, esta idade. */
export const RESGATE_DIAS_MINIMOS = 14;
export const RESGATE_MS_MINIMO = RESGATE_DIAS_MINIMOS * 86_400_000;
/** Pedidos de parada vindos de sessões de resgate, no mesmo dia, que desligam SÓ o resgate. */
export const PARADAS_RESGATE_ATE_PARAR = 2;
/** Sessão de resgate em `chamado` há tanto tempo sem resposta é encerrada. */
export const RESGATE_SEM_RESPOSTA_MS = 7 * 86_400_000;

/** O teto de resgate de hoje: 5, ou menos se INVESTIDOR_AGENTE_RESGATE_DIA apertar. */
export function tetoResgateDoDia(env?: string | null): number {
  let teto = RESGATE_POR_DIA;
  const daEnv = String(env ?? '').trim();
  if (/^\d+$/.test(daEnv)) teto = Math.min(teto, Number(daEnv));
  return teto;
}

/** As posições do dia que são do resgate, contadas SÓ entre as aberturas (toque 1, fila
 *  principal mais resgate): a 2ª, a 4ª, a 7ª, a 10ª e a 13ª. (13/10/2026: antes eram a 3ª,
 *  8ª, 13ª, 18ª e 23ª de TODOS os envios, e com as retomadas saindo primeiro o resgate
 *  encolhia para 1 por dia.) */
export const POSICOES_DO_RESGATE: ReadonlySet<number> = new Set([2, 4, 7, 10, 13]);

/** A abertura de número `n` do dia (1ª, 2ª...) é a vez do resgate? */
export const ehVezDoResgate = (n: number): boolean => Number.isInteger(n) && POSICOES_DO_RESGATE.has(n);

export type GrupoDaAbertura = 'principal' | 'resgate';

/**
 * Quem sai nesta abertura. `posicao` é a posição dela entre as ABERTURAS do dia (aberturas
 * de hoje + 1; as retomadas não entram na conta).
 *   · vez do resgate, com cota e elegível: resgate;
 *   · senão, a fila principal, se tiver alguém;
 *   · fila principal vazia: o resgate usa a vez mesmo fora da posição, ainda
 *     limitado pela cota (sem isto, com a principal vazia o dia nunca andaria até
 *     a próxima posição de resgate);
 *   · nada: `null`.
 */
export function escolherGrupo(i: {
  posicao: number; resgateLigado: boolean; cotaDeResgate: boolean; resgateElegivel: boolean; principalTem: boolean;
}): GrupoDaAbertura | null {
  const podeResgate = i.resgateLigado && i.cotaDeResgate && i.resgateElegivel;
  if (podeResgate && ehVezDoResgate(i.posicao)) return 'resgate';
  if (i.principalTem) return 'principal';
  return podeResgate ? 'resgate' : null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** O mês de um instante, em Brasília, por extenso e minúsculo. '' se a data não vale. */
export function mesPorExtenso(iso: unknown): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  return MESES[new Date(t - TRES_HORAS_MS).getUTCMonth()]!;
}

/** Um card da agenda, só o que o resgate precisa. */
export interface CardDaAgenda { id: number; status: string; quando: string | null; escreveu: boolean }

export interface CandidatoResgate extends CandidatoInvestidor {
  /** Algum card dele tem `lead_resposta_at`: já escreveu para a gente alguma vez. */
  escreveu: boolean;
  /** O `quando` do card cancelado mais recente (ISO): a reunião que não aconteceu. */
  reuniaoPerdidaEm: string;
  /** `updated_at` do carimbo de liberação mais recente. */
  liberadoEm: string;
}

export type MotivoForaDoResgate =
  | Exclude<MotivoForaDaFila, 'tem_card' | 'mudo'>
  | 'card_em_outro_status' | 'sem_carimbo_de_liberacao' | 'menos_de_14_dias' | 'sem_data_da_reuniao';

export interface ResultadoFilaResgate {
  fila: CandidatoResgate[];
  excluidos: Partial<Record<MotivoForaDoResgate, number>>;
}

export interface DadosDoResgate {
  /** Todos os cards de cada chave (DDD + 8), em qualquer status. */
  cards: ReadonlyMap<string, readonly CardDaAgenda[]>;
  /** `updated_at` do carimbo `ep_liberado_sim:<id>`, por id de card. */
  liberados: ReadonlyMap<number, string>;
  agora: number;
}

/**
 * A fila do resgate. Mesma base e mesmos cortes da fila principal, na mesma
 * ordem, com DUAS diferenças:
 *   · o corte `tem_card` vira a regra do resgate: todos os cards da pessoa
 *     cancelados, algum com carimbo de liberação, o mais recente com 14 dias ou
 *     mais. Quem não tem card nenhum não é resgate (é da fila principal) e não
 *     entra nem na contagem de excluídos.
 *   · o corte de `mudo` NÃO se aplica. EXCEÇÃO com dono: ordem do Thiago,
 *     12/10/2026 (esta gente levou toques da régua do SIM sem responder, e é por
 *     isso mesmo que o resgate existe). `f.mudo` é ignorado de propósito; o
 *     `f.comCard` também, porque os cards vêm em `r.cards`.
 * Ordem: quem já escreveu alguma vez primeiro; dentro de cada parte, maior valor
 * declarado e, no empate, cadastro mais novo.
 */
export function montarFilaResgate(linhas: LinhaOrigem[], f: FiltrosDaFila, r: DadosDoResgate): ResultadoFilaResgate {
  const podeCeder = new Set<string>();
  const disseNao = new Set<string>();
  const refsDe = new Map<string, RefCadastro[]>();
  for (const l of linhas) {
    const tel = telefoneZap(telDaLinha(l));
    const k = tel ? chaveContato(tel) : null;
    if (!k) continue;
    if (destinoDe(l.origem, l.r) === 'ponto') podeCeder.add(k);
    if (l.origem === 'agenda') continue;
    if (String(l.r.status ?? '') === 'sem_interesse') disseNao.add(k);
    const id = Number(l.r.id);
    if (!Number.isInteger(id)) continue;
    if (!refsDe.has(k)) refsDe.set(k, []);
    refsDe.get(k)!.push({ origem: l.origem, id });
  }

  const excluidos: ResultadoFilaResgate['excluidos'] = {};
  const fora = (m: MotivoForaDoResgate) => { excluidos[m] = (excluidos[m] ?? 0) + 1; };
  const passaram: CandidatoResgate[] = [];

  for (const l of agruparPorDestino(linhas).capital) {
    if (l.origem === 'agenda') continue;
    const tel = telefoneZap(l.r.telefone);
    const chave = tel ? chaveContato(tel) : null;
    if (!tel || !chave) continue;                       // o motivo já é contado pela fila principal
    const cards = r.cards.get(chave);
    if (!cards || !cards.length) continue;              // sem card: é da fila principal
    if (ehNomeDeTeste(l.r.nome)) { fora('nome_teste'); continue; }
    const valorTxt = valorDeclarado(l.origem, l.r);
    const valorMil = valorEmMil(valorTxt);
    if (valorMil === null || !valorLegivel(valorTxt)) { fora('sem_valor_legivel'); continue; }
    if (podeCeder.has(chave)) { fora('pode_ceder_local'); continue; }
    if (disseNao.has(chave)) { fora('sem_interesse_no_cadastro'); continue; }

    // A regra do resgate.
    if (cards.some(c => String(c.status ?? '').trim().toLowerCase() !== 'cancelado')) { fora('card_em_outro_status'); continue; }
    let liberadoEm = '';
    for (const c of cards) {
      const em = r.liberados.get(c.id);
      if (em && Number.isFinite(Date.parse(em)) && em > liberadoEm) liberadoEm = em;
    }
    if (!liberadoEm) { fora('sem_carimbo_de_liberacao'); continue; }
    if (r.agora - Date.parse(liberadoEm) < RESGATE_MS_MINIMO) { fora('menos_de_14_dias'); continue; }
    let reuniaoPerdidaEm = '';
    for (const c of cards) if (c.quando && Number.isFinite(Date.parse(c.quando)) && c.quando > reuniaoPerdidaEm) reuniaoPerdidaEm = c.quando;
    if (!reuniaoPerdidaEm) { fora('sem_data_da_reuniao'); continue; }

    if (f.comSessao.has(chave)) { fora('tem_sessao'); continue; }
    if (f.silenciado(tel)) { fora('opt_out'); continue; }
    if (f.bloqueado(tel)) { fora('bloqueado'); continue; }
    // (mudo: não se aplica ao resgate, ver o cabeçalho.)
    if (f.comHumano(tel)) { fora('humano_na_conversa'); continue; }
    if (f.comConversa.has(chave)) { fora('conversa_7_dias'); continue; }
    passaram.push({
      chave, telefone: tel,
      nome: String(l.r.nome ?? '').trim() || null,
      valorTxt, valorMil,
      origem: l.origem, id: Number(l.r.id),
      criadoEm: String(l.r.created_at ?? ''),
      cidade: String(l.r.cidade ?? '').trim() || null,
      status: String(l.r.status ?? '').trim() || null,
      refs: refsDe.get(chave) ?? [{ origem: l.origem, id: Number(l.r.id) }],
      escreveu: cards.some(c => c.escreveu),
      reuniaoPerdidaEm, liberadoEm,
    });
  }

  passaram.sort((a, b) =>
    (Number(b.escreveu) - Number(a.escreveu)) || (b.valorMil - a.valorMil)
    || (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));

  const porChave = new Map<string, CandidatoResgate>();
  const fila: CandidatoResgate[] = [];
  for (const c of passaram) {
    const ja = porChave.get(c.chave);
    if (ja) {
      if (c.telefone.length > ja.telefone.length) ja.telefone = c.telefone;
      fora('duplicado');
      continue;
    }
    porChave.set(c.chave, c);
    fila.push(c);
  }
  return { fila, excluidos };
}

/** O texto de uma abertura de resgate pelo índice (-1, ou sem nome que dê para
 *  usar, é a reserva). Serve para a escolha de agora e para reconstituir, na
 *  conversa que a IA lê, a abertura que a sessão registrou ter enviado. */
export function textoDaAberturaResgate(indice: number, nome: unknown, valorTxt: unknown, reuniaoPerdidaEm: unknown): string {
  const valor = valorNaFrase(valorTxt);
  const p = primeiroNome(nome);
  const molde = indice >= 0 && indice < ABERTURAS_RESGATE.length && p ? ABERTURAS_RESGATE[indice]! : ABERTURA_RESGATE_SEM_NOME;
  return molde.split('{nome}').join(p ?? '').split('{valor}').join(valor).split('{mes}').join(mesPorExtenso(reuniaoPerdidaEm));
}

/** A abertura de resgate desta pessoa, escolhida pela chave. */
export function renderAberturaResgate(
  chave: string, nome: unknown, valorTxt: unknown, reuniaoPerdidaEm: unknown,
): { indice: number; texto: string } {
  const indice = primeiroNome(nome) ? indicePorChave(chave, ABERTURAS_RESGATE.length) : -1;
  return { indice, texto: textoDaAberturaResgate(indice, nome, valorTxt, reuniaoPerdidaEm) };
}

/** O parágrafo "CONVERSA DE RESGATE" dos fatos do sistema, com o mês preenchido. */
export const paragrafoDeResgate = (reuniaoPerdidaEm: unknown): string =>
  CONVERSA_DE_RESGATE.split('{mes}').join(mesPorExtenso(reuniaoPerdidaEm));

// ═════════════════════════════════════════════════════════════════════════════
// HORÁRIOS
// ═════════════════════════════════════════════════════════════════════════════

/** Nada com menos de 3 horas de antecedência. */
export const ANTECEDENCIA_OFERTA_MS = 3 * 3600_000;
const DIAS_VARRIDOS = 21;
const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const p2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Todos os horários livres do consultor, em ordem, na faixa de lead NOVO
 * (:00 e :30, a grade que a LP vende; a faixa dos quinze é de remarcação).
 *
 * A régua é a da casa, sem cópia: `agendaAbre` (fecha sábado, domingo, feriado
 * e dia em que os sócios estão fora), `horasDoDia` (a grade de cada dia) e
 * `livrePara` (ocupação daquele consultor). O que é daqui: a antecedência de 3h
 * e o filtro que só deixa passar :00 e :30, que hoje é redundante com a grade e
 * continua valendo se a grade mudar.
 */
export function vagasLivres(
  dono: string, compromissos: Compromisso[], agora: number, excluir: readonly string[] = [],
): string[] {
  const limite = agora + ANTECEDENCIA_OFERTA_MS;
  const fora = new Set(excluir.map(iso => new Date(iso).getTime()));
  const vagas: string[] = [];
  const diasVistos = new Set<string>();
  for (let i = 0; i < DIAS_VARRIDOS; i++) {
    const ymd = diaBRT(agora + i * 86_400_000);
    if (diasVistos.has(ymd)) continue;
    diasVistos.add(ymd);
    if (!agendaAbre(ymd)) continue;
    for (const h of horasDoDia(ymd, 'novo')) {
      if (!/^\d{2}:(00|30)$/.test(h)) continue;
      const t = new Date(`${ymd}T${h}:00-03:00`).getTime();
      if (!Number.isFinite(t) || t < limite || fora.has(t)) continue;
      const iso = new Date(t).toISOString();
      if (livrePara(iso, dono, compromissos)) vagas.push(iso);
    }
  }
  return vagas;
}

const horaBrt = (iso: string): number => new Date(new Date(iso).getTime() - TRES_HORAS_MS).getUTCHours();

/**
 * Os 4 da oferta: os 2 dias mais próximos com vaga, 2 horários em cada (um de
 * manhã e um à tarde quando o dia tem os dois; senão o primeiro e outro pelo
 * menos 2 horas depois, para dar escolha). Se não fechar 4 assim, os 4 próximos
 * livres. Menos de 4 livres devolve o que houver, e quem chama decide.
 */
export function escolherQuatro(livres: readonly string[]): string[] {
  const ordenados = [...livres].sort();
  const porDia = new Map<string, string[]>();
  for (const iso of ordenados) {
    const ymd = diaBRT(iso);
    if (!porDia.has(ymd)) porDia.set(ymd, []);
    porDia.get(ymd)!.push(iso);
  }
  const escolhidos: string[] = [];
  for (const doDia of [...porDia.values()].slice(0, 2)) {
    const manha = doDia.filter(iso => horaBrt(iso) < 12);
    const tarde = doDia.filter(iso => horaBrt(iso) >= 12);
    if (manha.length && tarde.length) { escolhidos.push(manha[0]!, tarde[0]!); continue; }
    const primeiro = doDia[0]!;
    const depois = doDia.find(iso => new Date(iso).getTime() - new Date(primeiro).getTime() >= 2 * 3600_000) ?? doDia[1];
    escolhidos.push(primeiro);
    if (depois) escolhidos.push(depois);
  }
  if (escolhidos.length === 4) return escolhidos.sort();
  return ordenados.slice(0, 4);
}

export function horariosDaOferta(
  dono: string, compromissos: Compromisso[], agora: number, excluir: readonly string[] = [],
): string[] {
  return escolherQuatro(vagasLivres(dono, compromissos, agora, excluir));
}

/** "Terça 13/10 às 10:00" */
export function horarioCurto(iso: string): string {
  const d = new Date(new Date(iso).getTime() - TRES_HORAS_MS);
  return `${SEMANA[d.getUTCDay()]} ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)} às ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** "1. Terça 13/10 às 10:00" */
export const linhaDoHorario = (iso: string, i: number): string => `${i + 1}. ${horarioCurto(iso)}`;

/** O horário no meio de uma frase: "terça 13/10 às 10:00". */
export function horarioNaFrase(iso: string): string {
  const t = horarioCurto(iso);
  return t.charAt(0).toLocaleLowerCase('pt-BR') + t.slice(1);
}

/** A bolha da oferta: UMA mensagem, com os 4 horários numerados. O texto do
 *  redator já traz o "1." a "4."; aqui só entra o horário de cada linha. */
export function textoOferta(chave: string, horarios: readonly string[], opts: { foiOcupado?: boolean } = {}): string {
  let texto = variacao(OFERTA_HORARIOS, chave);
  horarios.slice(0, 4).forEach((iso, i) => { texto = texto.split(`{h${i + 1}}`).join(horarioCurto(iso)); });
  return opts.foiOcupado ? `${HORARIO_FOI_OCUPADO}\n${texto}` : texto;
}

export function textoConfirmacao(chave: string, iso: string, consultor: string): string {
  return variacao(CONFIRMACAO, chave).split('{quando}').join(horarioNaFrase(iso)).split('{consultor}').join(consultor);
}

/** A mensagem inteira é um número solto ("2", "opção 2", "a 3")? Devolve o
 *  número. Serve para separar "5" (fora da lista) de uma frase qualquer. */
export function numeroSolto(texto: unknown): number | null {
  const m = /^(?:op[çc][ãa]o\s*|a\s*|o\s*|n[ºo°]?\s*)?(\d{1,2})[\s!.,)º°]*$/i.exec(String(texto ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** Cortesia que pode vir junto do número sem mudar a escolha. */
const RE_SO_CORTESIA = /^(?:ok|okay|obrigad[oa]|obg|valeu|vlw|por favor|pfv|blz|beleza|grat[oa]|pode ser|esse|essa|isso)[\s.!,]*$/i;

/**
 * A pessoa escolheu um horário da lista? Só vale o NÚMERO SOLTO, de 1 a `n`,
 * como mensagem inteira ("2", " 2 ", "2.", "opção 2", "a 2"), sozinho na leva ou
 * acompanhado só de cortesia ("2" e logo "obrigado").
 *
 * Devolve o índice (0 a n-1), -1 quando é um número solto FORA da lista, e
 * `null` para todo o resto, que vai para a IA.
 *
 * POR QUE TÃO ESTREITO (bloqueante da revisão de 11/10/2026): a primeira versão
 * casava dia e hora soltos no texto, e recusa virava reunião. "10h não consigo,
 * tem outro?" agendava a opção das 10h; "Nenhum serve, trabalho até as 15"
 * agendava a das 15h. Quem cita o horário pode estar recusando; quem manda só o
 * número está escolhendo.
 */
/** Negação ou dúvida (texto já sem acento e em minúsculo). */
const RE_NEGACAO_OU_DUVIDA = /(?<![a-z])(?:nao|nenhum|nenhuma|nem|talvez|depende)(?![a-z])|\?/;

export function escolhaPorNumero(textos: readonly string[], n: number): number | null {
  const limpos = textos.map(t => String(t ?? '').trim()).filter(Boolean);
  if (!limpos.length) return null;
  const numeros: number[] = [];
  let achouFrase = false;
  for (const t of limpos) {
    const num = numeroSolto(t);
    if (num !== null) { numeros.push(num); continue; }
    if (!RE_SO_CORTESIA.test(t)) achouFrase = true;   // tem frase de verdade na leva
  }
  const foraDaLista = (k: number): number => (k >= 1 && k <= n ? k - 1 : -1);
  if (!achouFrase) {
    if (numeros.length !== 1) return null;      // nenhum número, ou dois números diferentes
    return foraDaLista(numeros[0]!);
  }
  // A ÚLTIMA MENSAGEM MANDA (12/10/2026). A pessoa escreveu "Pode ser terça-feira,
  // amanhã às 10h." e logo depois "1": a leva tinha uma frase e um número, a regra
  // antiga devolvia `null` e a escolha se perdeu. Agora, se a última mensagem não
  // vazia é um número solto, é a escolha, mesmo com texto antes. Frase com número
  // no meio ("10h não consigo, tem outro?") continua não sendo escolha, porque aí a
  // última mensagem é a frase. Dois números soltos DIFERENTES na leva seguem
  // ambíguos (vai para a IA), porque a pessoa pode estar se corrigindo ou comparando.
  const ultimoNumero = numeroSolto(limpos[limpos.length - 1]!);
  if (ultimoNumero === null) return null;
  if (numeros.some(x => x !== ultimoNumero)) return null;
  // Negação ou dúvida antes do número ("10h não dá" e depois "1"; "vou com meu sócio?"
  // e depois "2"): o número pode ser outra coisa que não a escolha. Vai para a IA.
  if (limpos.slice(0, -1).some(t => RE_NEGACAO_OU_DUVIDA.test(semAcento(t)))) return null;
  return foraDaLista(ultimoNumero);
}

const RE_PARAR_SOZINHO =/^(?:parar|pare|para|p[áa]ra|stop|sair|remover|descadastrar)[\s.!]*$/i;
// "Não me mande mais" só vale quando é o pedido inteiro, ou fala de mensagem:
// "não me mande mais horários" é outra conversa.
const RE_PARAR_NA_FRASE = /(?:n[ãa]o (?:me )?(?:mand|envi|cham|escrev)\w* mais(?: (?:mensage\w*|msg\w*|nada|isso))?[\s.!]*$|par(?:a|e|ar|em) de (?:me )?(?:mandar|enviar|chamar|escrever)|me tir[ae] d(?:a|essa|esta) lista|n[ãa]o quero (?:mais )?receber (?:mais )?(?:mensage\w*|msg\w*|nada|isso))/i;

/**
 * A pessoa pediu para parar, com todas as letras? Forma FECHADA de propósito:
 * a palavra sozinha ("pare", "sair") ou o pedido escrito ("não me mande mais",
 * "me tira da lista"). Todo o resto ("não tenho interesse", "agora não") é da
 * IA, que separa desinteresse de pedido de parada. Existe para o opt-out não
 * depender de a IA estar no ar.
 */
export function pediuParar(textos: readonly string[]): boolean {
  return textos.some(t => {
    const s = String(t ?? '').trim();
    return RE_PARAR_SOZINHO.test(s) || RE_PARAR_NA_FRASE.test(s);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// RETOMADAS (13/10/2026): toques 2 a 5 para quem recebeu a abertura e não respondeu
//
// Só a fila PRINCIPAL (sessão sem `grupo`; o resgate tem `sem_retomada` e nunca
// recebe). Os limites são do parecer anti-ban e todos valem:
//   · toque 2: 3 dias depois do toque 1;     toque 3: 4 dias depois do toque 2;
//   · toque 4: 60 dias depois do toque 1;    toque 5: 7 dias depois do toque 4;
//   · fecho: 7 dias depois do toque 5 sem resposta.
// Cada prazo conta do carimbo do toque ANTERIOR que saiu (o `updated_at` dele),
// nunca do dia 0. No máximo 15 retomadas por dia, dentro do teto do dia e sempre
// sobrando 5 vagas dele para abertura.
// ═════════════════════════════════════════════════════════════════════════════

/** Retomadas por dia de Brasília. A env INVESTIDOR_AGENTE_RETOMADAS_DIA só APERTA. */
export const RETOMADAS_POR_DIA = 15;
/** Vagas do teto do dia que a retomada nunca ocupa: ficam para abertura. */
export const RETOMADAS_RESERVA_DE_ABERTURA = 5;
const DIA_MS = 86_400_000;
/** Dias de espera antes de cada passo, e de qual toque anterior se conta. O "6" é o
 *  FECHO: nenhuma mensagem sai. */
export const REGRA_DOS_TOQUES: Readonly<Record<2 | 3 | 4 | 5 | 6, { dias: number; aPartirDo: 1 | 2 | 3 | 4 | 5 }>> = {
  2: { dias: 3, aPartirDo: 1 },
  3: { dias: 4, aPartirDo: 2 },
  4: { dias: 60, aPartirDo: 1 },
  5: { dias: 7, aPartirDo: 4 },
  6: { dias: 7, aPartirDo: 5 },
};
/** Nenhuma retomada sai com menos de 3 dias do toque anterior da Helena para a mesma
 *  pessoa; o toque 4 espera 7 dias do toque 3 (se o 3 atrasou, o 4 não vence na hora). */
export const INTERVALO_MINIMO_DOS_TOQUES_DIAS = 3;
export const INTERVALO_MINIMO_DO_TOQUE_4_DIAS = 7;
/** Mensagem a até esta distância do carimbo do toque é o próprio toque (o carimbo
 *  dos toques 2 a 5 é gravado ANTES do envio), e não conversa nova. */
export const MARGEM_DO_TOQUE_MS = 5 * 60_000;
/** Com tantos carimbos nos últimos 60 dias a pessoa já levou toque demais. */
export const TOQUES_EM_60_DIAS_ATE_PARAR = 3;
export const JANELA_DOS_TOQUES_MS = 60 * DIA_MS;

/** O teto de retomadas de hoje, antes da reserva: 15, ou menos se a env apertar. */
export function tetoRetomadasDoDia(env?: string | null): number {
  let teto = RETOMADAS_POR_DIA;
  const daEnv = String(env ?? '').trim();
  if (/^\d+$/.test(daEnv)) teto = Math.min(teto, Number(daEnv));
  return teto;
}

/** Retomadas que cabem hoje: só enquanto `retomadas de hoje < min(15, teto do dia - 5)`. */
export const limiteDeRetomadasHoje = (tetoDoDiaAtual: number, env?: string | null): number =>
  Math.max(0, Math.min(tetoRetomadasDoDia(env), tetoDoDiaAtual - RETOMADAS_RESERVA_DE_ABERTURA));

export type NumeroDoToque = 1 | 2 | 3 | 4 | 5;
/** Quando cada toque saiu: o `updated_at` do carimbo `inv_agente_sent:<chave>:tN`. */
export type CarimbosDosToques = Partial<Record<NumeroDoToque, string>>;

/** "inv_agente_sent:3499990001:t2" -> { chave, n }. Qualquer outra chave -> null. */
export function lerChaveDeToque(key: unknown): { chave: string; n: NumeroDoToque } | null {
  const m = /^inv_agente_sent:(\d{10}):t([1-5])$/.exec(String(key ?? ''));
  return m ? { chave: m[1]!, n: Number(m[2]) as NumeroDoToque } : null;
}

export interface PassoDaRetomada {
  /** O próximo toque (2 a 5), ou `fecho` depois do toque 5. */
  passo: 2 | 3 | 4 | 5 | 'fecho';
  /** Quando ele vence (ms). */
  venceEm: number;
  /** O carimbo do toque mais recente (ISO). */
  ultimoToqueEm: string;
}

/** O que vem depois do último toque que saiu, e quando vence. `null` sem carimbo do toque 1. */
export function proximoPassoDaRetomada(c: CarimbosDosToques): PassoDaRetomada | null {
  if (!c[1]) return null;
  let n: NumeroDoToque = 1;
  for (const k of [2, 3, 4, 5] as const) if (c[k]) n = k;
  const regra = REGRA_DOS_TOQUES[(n + 1) as 2 | 3 | 4 | 5 | 6];
  const base = Date.parse(String(c[regra.aPartirDo] ?? c[n]));
  const ultimo = Date.parse(String(c[n]));
  if (!Number.isFinite(base) || !Number.isFinite(ultimo)) return null;
  // O MAIOR entre o prazo do toque e o intervalo mínimo desde o último que saiu.
  const intervalo = (n === 3 ? INTERVALO_MINIMO_DO_TOQUE_4_DIAS : INTERVALO_MINIMO_DOS_TOQUES_DIAS) * DIA_MS;
  return {
    passo: n === 5 ? 'fecho' : ((n + 1) as 2 | 3 | 4 | 5),
    venceEm: Math.max(base + regra.dias * DIA_MS, ultimo + intervalo),
    ultimoToqueEm: String(c[n]),
  };
}

/** Os campos da sessão que decidem se ela entra no ciclo. */
export interface SessaoDeRetomada {
  estagio: string;
  telefone: string;
  nome: string | null;
  valor_txt: string;
  respostas?: number;
  grupo?: string;
  sem_retomada?: boolean;
  erro?: string | null;
  /** `outra_conversa`: mensagem nossa (outro robô, um humano) depois do toque anterior
   *  encerrou o ciclo de retomadas desta pessoa. */
  ciclo_encerrado?: string;
}

/**
 * A sessão entra no ciclo de retomadas? Só a fila principal (sem `grupo`, sem
 * `sem_retomada`), sem erro de envio, em `chamado`; ou em `conversando` com ZERO
 * respostas da Helena (a pessoa só mandou resposta automática do WhatsApp): para a
 * retomada ela vale como `chamado`. `adiado`, `humano`, `ofertou`, `agendado` e
 * `sem_interesse` não recebem.
 */
export function sessaoEntraNasRetomadas(s: SessaoDeRetomada): boolean {
  if (s.grupo || s.sem_retomada || s.erro || s.ciclo_encerrado || !s.telefone) return false;
  return s.estagio === 'chamado' || (s.estagio === 'conversando' && Number(s.respostas ?? 0) === 0);
}

export interface CandidatoRetomada {
  chave: string;
  telefone: string;
  nome: string | null;
  valorTxt: string;
  toque: 2 | 3 | 4 | 5;
  venceEm: number;
  vencidaHaDias: number;
  /** O carimbo do toque mais recente (ISO): daqui se conta a conversa nova. */
  ultimoToqueEm: string;
}

export interface FiltrosDeRetomada {
  silenciado: (tel: string) => boolean;
  bloqueado: (tel: string) => boolean;
  /** `carregarMudos(3, 60)`: quem já tem 3 toques sem resposta em 60 dias. */
  mudo: (tel: string) => boolean;
  /** Tem humano dentro da conversa agora (pausa humana). */
  comHumano: (tel: string) => boolean;
}

export type MotivoForaDasRetomadas = 'opt_out' | 'bloqueado' | 'mudo' | 'toques_em_60_dias' | 'humano_na_conversa';

export interface ResultadoRetomadas {
  /** Quem pode receber agora (passou nos cortes), a mais antiga primeiro. */
  fila: CandidatoRetomada[];
  /** Quem chegou ao fecho (7 dias depois do toque 5 sem resposta), o mais antigo primeiro. */
  fechos: Array<{ chave: string; venceEm: number }>;
  /** Vencidas pelo calendário, antes dos cortes. */
  vencidasPorToque: Record<2 | 3 | 4 | 5, number>;
  excluidos: Partial<Record<MotivoForaDasRetomadas, number>>;
}

/**
 * As retomadas e os fechos que vencem agora. Pura: recebe as sessões, os carimbos
 * (de `lerChaveDeToque`) e os cortes já lidos. Entre as vencidas, a mais antiga
 * primeiro (o que não coube hoje sai amanhã, na frente). `mudo` e `toques_em_60_dias`
 * são os dois cortes de mudo: quem cai neles só fica vencida e é reavaliada depois.
 */
export function montarRetomadas(
  sessoes: ReadonlyMap<string, SessaoDeRetomada>, carimbos: ReadonlyMap<string, CarimbosDosToques>,
  f: FiltrosDeRetomada, agoraMs: number,
): ResultadoRetomadas {
  const vencidasPorToque: ResultadoRetomadas['vencidasPorToque'] = { 2: 0, 3: 0, 4: 0, 5: 0 };
  const excluidos: ResultadoRetomadas['excluidos'] = {};
  const fora = (m: MotivoForaDasRetomadas) => { excluidos[m] = (excluidos[m] ?? 0) + 1; };
  const fila: CandidatoRetomada[] = [];
  const fechos: ResultadoRetomadas['fechos'] = [];
  for (const [chave, s] of sessoes) {
    if (!sessaoEntraNasRetomadas(s)) continue;
    const c = carimbos.get(chave);
    const passo = c ? proximoPassoDaRetomada(c) : null;
    if (!passo || passo.venceEm > agoraMs) continue;
    if (passo.passo === 'fecho') { fechos.push({ chave, venceEm: passo.venceEm }); continue; }
    vencidasPorToque[passo.passo]++;
    const recentes = Object.values(c!).filter(iso => {
      const t = Date.parse(String(iso));
      return Number.isFinite(t) && agoraMs - t <= JANELA_DOS_TOQUES_MS;
    }).length;
    if (f.silenciado(s.telefone)) { fora('opt_out'); continue; }
    if (f.bloqueado(s.telefone)) { fora('bloqueado'); continue; }
    if (f.comHumano(s.telefone)) { fora('humano_na_conversa'); continue; }
    if (f.mudo(s.telefone)) { fora('mudo'); continue; }
    if (recentes >= TOQUES_EM_60_DIAS_ATE_PARAR) { fora('toques_em_60_dias'); continue; }
    fila.push({
      chave, telefone: s.telefone, nome: s.nome, valorTxt: s.valor_txt, toque: passo.passo, venceEm: passo.venceEm,
      vencidaHaDias: Math.floor((agoraMs - passo.venceEm) / DIA_MS), ultimoToqueEm: passo.ultimoToqueEm,
    });
  }
  fila.sort((a, b) => a.venceEm - b.venceEm);
  fechos.sort((a, b) => a.venceEm - b.venceEm);
  return { fila, fechos, vencidasPorToque, excluidos };
}

/**
 * O texto da retomada: 3 variações por toque, escolhidas de forma fixa pela chave E
 * pelo número do toque (a mesma pessoa não recebe a mesma redação em dois toques
 * seguidos). `indice` -1 = a reserva, sem nome.
 */
export function renderRetomada(
  toque: 2 | 3 | 4 | 5, chave: string, nome: unknown, valorTxt: unknown,
): { indice: number; texto: string } {
  const textos = RETOMADAS[toque];
  const p = primeiroNome(nome);
  const indice = p ? (indicePorChave(chave, textos.variacoes.length) + toque) % textos.variacoes.length : -1;
  const molde = indice >= 0 ? textos.variacoes[indice]! : textos.reserva;
  return { indice, texto: molde.split('{nome}').join(p ?? '').split('{valor}').join(valorNaFrase(valorTxt)) };
}

// ═════════════════════════════════════════════════════════════════════════════
// RECUPERAÇÃO DA ESCOLHA PENDENTE (12/10/2026)
//
// Quando uma leva de mensagens foi lida e não virou reunião nem resposta (a
// pessoa escolheu o horário e a escolha se perdeu), a sessão fica em `ofertou` e a
// pessoa fica no vácuo. Esta é a regra pura de quem está nessa condição.
// ═════════════════════════════════════════════════════════════════════════════

/** A última fala dela precisa ter esta idade para ser reprocessada. */
export const RECUPERACAO_IDADE_MIN_MS = 10 * 60_000;
/** Reprocessamentos por rodada. */
export const RECUPERACOES_POR_RODADA = 2;

/** A recuperação só roda entre 08:00 e 20:00 de Brasília. */
export function dentroDaJanelaDeRecuperacao(agora: Date): boolean {
  const h = noFusoDeBrasilia(agora).getUTCHours();
  return h >= 8 && h < 20;
}

export interface EscolhaPendente {
  /** O `momment` da última fala dela: vira o carimbo `recuperado_ate`. */
  ultima: string;
  /** As falas dela depois da nossa última mensagem. */
  novas: MsgDaConversa[];
  /** A conversa até a primeira dessas falas. */
  historico: MsgDaConversa[];
}

/**
 * A sessão em `ofertou` tem uma escolha esperando? Sim quando, na conversa (mais
 * antiga primeiro): a última mensagem é DELA, mais nova que a nossa última, com
 * mais de 10 minutos; o cursor da sessão (`ate`) já passou dela (foi lida e não
 * deu em nada); e ela ainda não foi reprocessada (`recuperadoAte`).
 */
export function escolhaPendenteDe(
  conversa: readonly MsgDaConversa[], ate: string | null | undefined, recuperadoAte: string | null | undefined, agoraMs: number,
): EscolhaPendente | null {
  const falas = [...conversa].filter(m => String(m.texto || '').trim() || (m.tipo && m.tipo !== 'texto'))
    .sort((a, b) => (a.momment < b.momment ? -1 : a.momment > b.momment ? 1 : 0));
  const ultima = falas[falas.length - 1];
  if (!ultima || ultima.from_me) return null;
  if (!String(ultima.texto || '').trim()) return null;               // áudio, figurinha: nada a reprocessar
  const t = Date.parse(ultima.momment);
  if (!Number.isFinite(t) || agoraMs - t <= RECUPERACAO_IDADE_MIN_MS) return null;
  if (!ate || ultima.momment > ate) return null;                    // ainda não foi lida: é da rodada normal
  if (recuperadoAte && ultima.momment <= recuperadoAte) return null;   // já reprocessada, nunca repete
  let i = falas.length - 1;
  while (i > 0 && !falas[i - 1]!.from_me) i--;
  return { ultima: ultima.momment, novas: falas.slice(i), historico: falas.slice(0, i) };
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVAÇÃO DO CARD
// ═════════════════════════════════════════════════════════════════════════════

export interface DadosDaConversa {
  valor_confirmado?: string;
  pagamento?: string;
  tem_ponto?: string;
  cidade?: string;
}

/** Texto livre numa linha só, sem os caracteres que o banco usa como marcador
 *  (o ponto médio e o travessão separam o perfil e a nota na leitura do trigger). */
const umaLinha = (s: unknown, max = 200): string =>
  String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s*[·—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * "Como pretende investir" só entra quando o que a pessoa disse cabe numa das
 * respostas da LP, porque o banco transforma esta linha em coluna
 * (`capital_faixa`). Resposta que não cabe fica só na linha de pagamento, em
 * texto livre: melhor coluna vazia do que coluna inventada.
 */
export function comoPretendeInvestir(pagamento: unknown): string | null {
  const t = String(pagamento ?? '').toLowerCase();
  if (!t) return null;
  const proprio = /pr[óo]pri/.test(t) || /(?<!\p{L})[àa] vista/u.test(t);
  const financia = /financ|banco|cr[ée]dito|empr[ée]stimo/.test(t) && !/sem financ|n[ãa]o (vou|quero|pretendo|preciso) financ/.test(t);
  // O texto EXATO da opção da LP (dashboard/public/io/eletroposto/index.html,
  // option "proprio_credito"): o trigger do banco casa "Recurso pr%prio + cart%"
  // para gravar capital_faixa = proprio_credito. Outra redação cairia em "proprio".
  if (proprio && financia) return 'Recurso próprio + cartão ou financiamento';
  if (proprio) return 'Recurso próprio';
  if (financia) return 'Financiamento pelo banco';
  return null;
}

const ROTULO_ORIGEM: Record<'parceria' | 'nota1', string> = {
  parceria: 'cadastro de investidor (eletroposto_parceria)',
  nota1: 'ficha da LP (eletroposto_nota1)',
};

const dataCurtaBrasilia = (iso: unknown): string => {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return 'sem data';
  const d = new Date(t - TRES_HORAS_MS);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

export interface DadosDoCard {
  valorTxt: string;
  dados: DadosDaConversa;
  cidadeDoCadastro: string | null;
  origem: 'parceria' | 'nota1';
  id: number;
  cadastroEm: string | null;
  resumo: string;
}

/**
 * A observação do card, no formato que a LP grava.
 *
 * A 1ª LINHA É CONTRATO: o trigger `eletroposto_estruturar` roda em todo card
 * cuja origem tem "eletroposto" e lê `LP ELETROPOSTO · <perfil>` para preencher
 * `perfil_slug`. Com "Investidor" o perfil vira `investidor`, igual ao de quem
 * entra pela porta do investidor na página.
 *
 * O QUE NÃO ENTRA, de propósito: as linhas `Ponto:`, `Decisor:`, `NOTA n ·`,
 * `Endereço:` e `Local é seu:`. O banco transforma cada uma em coluna e a régua
 * de descarte lê essas colunas; a Helena não pergunta com as respostas da LP,
 * então escrever ali seria inventar a coluna. O que a conversa descobriu vai em
 * rótulos próprios, que ninguém lê por máquina.
 */
export function montarObservacao(c: DadosDoCard): string {
  const como = comoPretendeInvestir(c.dados.pagamento);
  const cidade = umaLinha(c.dados.cidade, 80) || umaLinha(c.cidadeDoCadastro, 80);
  const resumo = String(c.resumo ?? '')
    .split(/\r?\n|(?<=[.!?])\s+/).map(l => umaLinha(l, 240)).filter(Boolean).slice(0, 3);
  return [
    'LP ELETROPOSTO · Investidor',
    'AGENTE HELENA: reunião marcada pela agente de investidores no WhatsApp',
    `Quanto pretende investir: ${umaLinha(c.valorTxt, 60)}`,
    `Valor confirmado na conversa: ${umaLinha(c.dados.valor_confirmado) || 'não informado'}`,
    ...(como ? [`Como pretende investir: ${como}`] : []),
    `Pagamento (o que disse): ${umaLinha(c.dados.pagamento) || 'não informado'}`,
    `Tem ponto (o que disse): ${umaLinha(c.dados.tem_ponto) || 'não informado'}`,
    `Cidade: ${cidade || 'não informada'}`,
    `Cadastro de origem: ${ROTULO_ORIGEM[c.origem]} #${c.id}, de ${dataCurtaBrasilia(c.cadastroEm)}`,
    'Resumo da conversa:',
    ...(resumo.length ? resumo.map(l => `- ${l}`) : ['- (sem resumo)']),
  ].join('\n').slice(0, 4000);
}

// ═════════════════════════════════════════════════════════════════════════════
// IA: o que vai e o que volta
// ═════════════════════════════════════════════════════════════════════════════

export type AcaoHelena = 'continuar' | 'oferecer_horarios' | 'agendar' | 'adiar' | 'humano' | 'sem_interesse' | 'parar';
export const ACOES_HELENA: readonly AcaoHelena[] = ['continuar', 'oferecer_horarios', 'agendar', 'adiar', 'humano', 'sem_interesse', 'parar'];

export interface ContextoHelena {
  nome: string | null;
  valorTxt: string;
  cidade: string | null;
  consultor: string;
  /** Os horários já enviados, quando a pessoa está escolhendo. */
  oferta: readonly string[];
  dados: DadosDaConversa;
  /** As linhas de cadastro da pessoa, cruas: o que ela JÁ respondeu no formulário. */
  formulario?: readonly FonteDoFormulario[];
  /** A hora de agora, para a IA saber que dia é hoje e amanhã. */
  agora?: Date;
  /** Conversa de RESGATE: o `quando` (ISO) da reunião que não aconteceu. Com isto
   *  os fatos ganham o parágrafo "CONVERSA DE RESGATE". Fila principal: ausente. */
  resgateEm?: string | null;
}

// ── O QUE A PESSOA JÁ RESPONDEU NO FORMULÁRIO (11/10/2026) ───────────────────
// Ordem do dono: a Helena tem que entender contexto. Quem preencheu a página já
// disse se tem local, como pretende pagar e quem decide; perguntar de novo é
// dizer na cara que ninguém leu. Estas respostas entram nos fatos do sistema.
//
// O QUE NÃO ENTRA: o cabeçalho da ficha ("LP ELETROPOSTO ...") e qualquer linha
// de NOTA ou pontuação. Nota é régua interna, e régua interna não pode chegar
// perto de texto que vai para cliente. Também ficam de fora as contas do
// simulador (investimento estimado, payback, lucro): a Helena não fala número.

export interface FonteDoFormulario { origem: 'parceria' | 'nota1'; r: Record<string, unknown> }

/** Teto do bloco inteiro nos fatos do sistema. */
export const TETO_DO_FORMULARIO = 1500;

const COLUNAS_DO_CADASTRO: ReadonlyArray<[string, string]> = [
  ['cidade', 'Cidade'],
  ['lado', 'Entrou pelo cadastro de'],
  ['capital_faixa', 'Quanto pretende investir'],
  ['prazo', 'Quando pretende começar'],
  ['ponto_relacao', 'Local é seu'],
  ['ponto_tipo', 'Tipo de local'],
  ['ponto_endereco', 'Endereço do local'],
  ['ponto_vagas', 'Vagas disponíveis'],
  ['ponto_fluxo', 'Movimento do local'],
  ['ponto_energia', 'Entrada de energia'],
];
const LADO_POR_EXTENSO: Record<string, string> = {
  capital: 'investidor (quer investir)',
  ponto: 'dono de local (tem um ponto)',
};
/** Linha da ficha que é nota interna, e por isso não entra. */
const RE_LINHA_INTERNA = /\bnota\b|\bpts\b|\d\s*\/\s*11\b|pontua/i;
/** Rótulo de conta do simulador (a resposta "Financiamento · empresa com CNPJ e
 *  faturamento" é resposta da pessoa e fica: por isso o teste é só no RÓTULO). */
const RE_ROTULO_DE_CONTA = /investimento estimado|payback|lucro|faturamento|simul/i;
const RE_ROTULO_E_RESPOSTA = /^([^:]{2,45}):\s*(\S.*)$/;

/**
 * LISTA DE PERMISSÃO dos rótulos da ficha (ressalva da revisão de 11/10/2026).
 * Só entra na conversa o que a página do eletroposto realmente pergunta à pessoa
 * (dashboard/public/io/eletroposto/index.html). Rótulo que não está aqui fica de
 * fora, mesmo que pareça inofensivo: a ficha é texto livre montado por código
 * que muda, e o que é novo ali pode ser nota interna com cara de resposta.
 * Comparação sem acento e em minúsculo.
 *
 * De fora de propósito, embora a página escreva: "Investimento estimado" (conta
 * do simulador), "Instalação", "Potência", "Unidades", "Software e app", "Outro"
 * e "Para onde vai" (são da porta de compra de carregador e de uso interno).
 */
const ROTULOS_DA_FICHA: ReadonlySet<string> = new Set([
  'local e seu', 'ponto', 'como pretende investir', 'quanto pretende investir', 'decisor',
  'entrada trifasica', 'cidade', 'modelo de interesse', 'vagas disponiveis',
  'endereco', 'endereco em negociacao', 'rota de passagem', 'prazo',
]);

/** As linhas "Rótulo: resposta" de uma ficha da página: só os rótulos da lista de
 *  permissão, sem cabeçalho e sem nota. */
export function respostasDaFicha(ficha: unknown): string[] {
  const out: string[] = [];
  for (const bruta of String(ficha ?? '').split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha || /^LP ELETROPOSTO/i.test(linha) || RE_LINHA_INTERNA.test(linha)) continue;
    const m = RE_ROTULO_E_RESPOSTA.exec(linha);
    if (!m) continue;   // marcador solto, sem "Rótulo: resposta"
    if (RE_ROTULO_DE_CONTA.test(m[1]!)) continue;
    if (!ROTULOS_DA_FICHA.has(semAcento(m[1]).replace(/\s+/g, ' ').trim())) continue;
    out.push(`${m[1]!.trim()}: ${umaLinha(m[2], 160)}`);
  }
  return out;
}

/**
 * O bloco "o que ela já respondeu", pronto para os fatos do sistema. Junta as
 * duas fontes quando a pessoa está nas duas tabelas, sem repetir a mesma
 * resposta, e para em 1.500 caracteres. Sem resposta nenhuma devolve lista vazia.
 */
export function fatosDoFormulario(fontes: readonly FonteDoFormulario[] | undefined): string[] {
  const linhas: string[] = [];
  const vistas = new Set<string>();
  let tamanho = 0;
  const cabe = (l: string): boolean => {
    if (tamanho + l.length + 1 > TETO_DO_FORMULARIO) return false;
    linhas.push(l); tamanho += l.length + 1;
    return true;
  };
  for (const f of fontes ?? []) {
    const respostas: string[] = [];
    if (f.origem === 'nota1') {
      respostas.push(...respostasDaFicha(f.r.ficha));
      const cidade = umaLinha(f.r.cidade, 80);
      if (cidade) respostas.push(`Cidade: ${cidade}`);
      const valor = umaLinha(f.r.valor_investir, 80);
      if (valor) respostas.push(`Quanto pretende investir: ${valor}`);
    } else {
      for (const [coluna, rotulo] of COLUNAS_DO_CADASTRO) {
        const bruto = umaLinha(f.r[coluna], 160);
        if (!bruto) continue;
        respostas.push(`${rotulo}: ${coluna === 'lado' ? (LADO_POR_EXTENSO[bruto] ?? bruto) : bruto}`);
      }
    }
    const novas = respostas.filter(r => {
      const k = semAcento(r).replace(/\s+/g, ' ');
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
    if (!novas.length) continue;
    const data = dataCurtaBrasilia(f.r.created_at);
    const quando = data === 'sem data' ? '' : ` (preencheu o formulário em ${data})`;
    const titulo = f.origem === 'nota1' ? `Na página do eletroposto${quando}:` : `No cadastro de parceria${quando}:`;
    if (!cabe(titulo)) break;
    let estourou = false;
    for (const r of novas) if (!cabe(`  ${r}`)) { estourou = true; break; }
    if (estourou) break;
  }
  return linhas;
}

// ── QUE DIA É HOJE ───────────────────────────────────────────────────────────
// Sem isto "amanhã de manhã" não quer dizer nada para o modelo, e ele não sabe
// que amanhã é domingo ou feriado. A régua é a da casa: feriadosBR e agendaAbre.

const SEMANA_POR_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Os fatos de calendário: hoje, amanhã, e quando o consultor atende. */
export function fatosDeHoje(agora: Date): string[] {
  const hoje = noFusoDeBrasilia(agora);
  const maisDias = (n: number): Date => new Date(hoje.getTime() + n * 86_400_000);
  const ymd = (d: Date): string => d.toISOString().slice(0, 10);
  const dia = (d: Date): string => `${SEMANA_POR_EXTENSO[d.getUTCDay()]}, ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const situacao = (d: Date): string => {
    if (ehFeriadoBR(ymd(d))) return 'é feriado nacional: não tem atendimento';
    if (d.getUTCDay() === 0) return 'é domingo: não tem atendimento';
    if (d.getUTCDay() === 6) return 'é sábado: não tem atendimento';
    if (!agendaAbre(ymd(d))) return 'está com a agenda fechada: não tem atendimento';
    return 'é dia útil: tem atendimento';
  };
  let proximo: Date | null = null;
  for (let i = 1; i <= 14 && !proximo; i++) if (agendaAbre(ymd(maisDias(i)))) proximo = maisDias(i);
  return [
    `Agora são ${p2(hoje.getUTCHours())}:${p2(hoje.getUTCMinutes())} de ${dia(hoje)}, horário de Brasília.`,
    `Hoje ${situacao(hoje)}.`,
    `Amanhã, ${dia(maisDias(1))}, ${situacao(maisDias(1))}.`,
    'O consultor atende de segunda a sexta-feira, menos em feriado. Sábado e domingo não tem reunião.',
    ...(proximo ? [`O próximo dia com atendimento é ${dia(proximo)}.`] : []),
    'O dia e a hora exatos saem na lista que o sistema envia: você não promete nem confirma horário por conta própria.',
  ];
}

/** O "sistema" da conversa: as regras do redator, os fatos desta pessoa e o
 *  formato da resposta. As regras vêm de investidorAgenteTextos.ts. */
export function montarSistema(ctx: ContextoHelena): string {
  const regras = REGRAS_DO_PROMPT.split('{consultor}').join(ctx.consultor);
  const sabido = [
    ctx.dados.valor_confirmado ? `Valor: ${ctx.dados.valor_confirmado}` : '',
    ctx.dados.pagamento ? `Pagamento: ${ctx.dados.pagamento}` : '',
    ctx.dados.tem_ponto ? `Ponto: ${ctx.dados.tem_ponto}` : '',
    ctx.dados.cidade ? `Cidade: ${ctx.dados.cidade}` : '',
  ].filter(Boolean);
  const doFormulario = fatosDoFormulario(ctx.formulario);
  const fatos = [
    `Primeiro nome: ${primeiroNome(ctx.nome) || 'não informado'}`,
    `Valor que ela marcou no formulário: ${ctx.valorTxt}`,
    `Cidade no cadastro: ${ctx.cidade || 'não informada'}`,
    `Consultor que vai atender: ${ctx.consultor}`,
    ...(doFormulario.length ? [
      'O que ela JÁ RESPONDEU no formulário:',
      ...doFormulario,
      'O que já está respondido aqui você NÃO pergunta de novo. Confirme em uma frase se for útil e siga para o que falta.',
    ] : []),
    ...(sabido.length ? ['O que a conversa já descobriu:', ...sabido.map(s => `  ${s}`)] : []),
    ...(ctx.resgateEm ? ['', paragrafoDeResgate(ctx.resgateEm)] : []),
    ...(ctx.oferta.length ? [
      'Você já enviou esta lista de horários e a pessoa ainda não escolheu:',
      ...ctx.oferta.map((iso, i) => `  ${linhaDoHorario(iso, i)}`),
      'Se ela escolher um deles sem dizer o número, e a escolha for clara, use a ação "agendar" com a posição dele em "opcao". Se não ficar claro qual, pergunte qual. Se nenhum servir, use a ação "oferecer_horarios" para o sistema mandar outros.',
    ] : []),
  ].join('\n');

  return [
    regras,
    '',
    'O QUE VOCÊ SABE DESTA PESSOA',
    fatos,
    '',
    ...(ctx.agora ? ['QUE DIA É HOJE', ...fatosDeHoje(ctx.agora), 'Cada linha da conversa traz a data e a hora em que foi escrita. Mensagem de dias atrás é conversa antiga, não é o assunto de agora.', ''] : []),
    'COMO DEVOLVER A RESPOSTA',
    'Devolva só um JSON com os campos "bolhas", "acao", "opcao", "dados" e "resumo".',
    '"bolhas": lista com 0, 1 ou 2 mensagens curtas, na ordem em que saem. Lista vazia quando não há o que responder.',
    '"acao", escolha uma:',
    '- "continuar": a conversa segue. O que estiver em "bolhas" é enviado.',
    '- "oferecer_horarios": a pessoa aceitou receber os horários, ou pediu outros. O sistema envia a lista.',
    '- "agendar": use SÓ quando a lista de horários já foi enviada e a pessoa escolheu, sem ambiguidade, um dos horários da lista, em número ou em palavras ("pode ser terça às 10h", "o primeiro", "quarta à tarde" quando só existe um horário de quarta à tarde). Informe em "opcao" a posição dele na lista. Se a escolha não bate com a lista, é ambígua, ou a pessoa recusou os horários, NÃO use "agendar": use "oferecer_horarios" para o sistema mandar outra lista, ou "continuar" para perguntar qual. O sistema grava a reunião e envia a confirmação pronta.',
    '- "adiar": ela quer ser procurada mais para frente ("mês que vem eu te procuro"). O sistema confirma que anotou e não cobra mais. Diga no resumo quando ela pediu para ser procurada.',
    '- "humano": pediu para falar com uma pessoa, reclamou, ou o assunto não é com você. O sistema envia a mensagem de passagem e avisa o consultor.',
    '- "sem_interesse": disse que não tem interesse ou que desistiu. O sistema envia a despedida.',
    '- "parar": pediu para não receber mais mensagem. O sistema confirma e não escreve mais.',
    'Em "oferecer_horarios", "agendar", "adiar", "humano", "sem_interesse" e "parar" o sistema manda a mensagem pronta no seu lugar: deixe "bolhas" vazia, porque o que estiver nela não é enviado.',
    '"opcao": número inteiro. Em "agendar", a posição do horário escolhido na lista (1 a 4). Em todas as outras ações, 0.',
    '"dados": o que a pessoa já disse, em texto curto, com os campos "valor_confirmado", "pagamento", "tem_ponto" e "cidade". Campo que você não sabe fica vazio.',
    '"resumo": até 3 frases curtas para o consultor, dizendo o que a pessoa quer e o que já contou.',
    'Na conversa, a linha marcada como "(áudio transcrito)" é a fala da pessoa em áudio, já passada para texto: trate como se ela tivesse escrito. A transcrição pode ter erro: se algo essencial ficar ambíguo (valor, cidade, horário escolhido), confirme em uma frase antes de seguir. Não comente que a mensagem era um áudio. Isso vale só para áudio transcrito: quando a mensagem aparece como [audio] (sem transcrição), ou como imagem ou arquivo, você não adivinha o conteúdo e pede, em uma frase, para a pessoa escrever.',
    'Palavras proibidas na resposta: retorno, rendimento, rentabilidade, lucro, payback, garantia, juros, por cento, cota. Para falar disso, diga "os números".',
  ].join('\n');
}

/** Teto da transcrição no pedido: áudio longo fecha com o pedido no fim, então o fim não pode cair. */
export const TETO_TRANSCRICAO = 4000;
const INICIO_TRANSCRICAO = 2500;
const FIM_TRANSCRICAO = 1500;
/** Passou do teto: fica o COMEÇO e o FIM, com [...] no meio. */
export function cortarTranscricao(t: string): string {
  if (t.length <= TETO_TRANSCRICAO) return t;
  return `${t.slice(0, INICIO_TRANSCRICAO).trimEnd()} [...] ${t.slice(-FIM_TRANSCRICAO).trimStart()}`;
}

export interface MsgDaConversa {
  from_me: boolean | null; texto: string | null; tipo: string | null; momment: string;
  /** Id da linha em `wa_mensagens` (chave do cache da transcrição). Só áudio carrega. */
  id?: number | string | null;
  /** Endereço do arquivo (Z-API), lido só nas mensagens novas de áudio. */
  media_url?: string | null;
  /**
   * Transcrição do áudio (13/10/2026). Campo À PARTE de `texto` de propósito: `texto`
   * alimenta o pedido de parada, o número solto de horário, a recuperação de escolha
   * pendente e o recado à equipe, e nada disso muda por causa de um áudio. Só o
   * pedido ao modelo (`montarPedido`) e os valores liberados leem este campo.
   */
  transcricao?: string | null;
}

/** Mensagem de áudio que ainda precisa de transcrição para o modelo entender. */
export const ehAudioSemTexto = (m: Pick<MsgDaConversa, 'tipo' | 'texto'>): boolean =>
  m.tipo === 'audio' && !String(m.texto ?? '').trim();

/** A conversa no 5040, mais antiga primeiro, e as mensagens novas que pedem resposta. */
export function montarPedido(historico: readonly MsgDaConversa[], novas: readonly MsgDaConversa[]): string {
  // Cada linha leva a data e a hora de Brasília na frente: "[18/09 14:32] Nós: ...".
  // Sem isso uma mensagem de outro robô, de três semanas atrás, parecia ter sido
  // dita agora. Data que não dá para ler fica sem carimbo, em vez de inventada.
  const carimbo = (iso: string): string => {
    // Só carimbo de verdade (ISO): o Date.parse aceita "3" e devolve março de 2001.
    if (!/^\d{4}-\d{2}-\d{2}T/.test(String(iso ?? ''))) return '';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t - TRES_HORAS_MS);
    return `[${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}] `;
  };
  const linha = (m: MsgDaConversa): string => {
    const quem = m.from_me ? 'Nós' : 'Cliente';
    const digitado = (m.texto || '').trim();
    // Áudio com transcrição: a fala da pessoa, marcada. Sem transcrição segue "[audio]".
    const falado = !digitado && m.tipo === 'audio' ? String(m.transcricao ?? '').trim() : '';
    if (falado) return `${carimbo(m.momment)}${quem} (áudio transcrito): ${cortarTranscricao(falado)}`;
    const conteudo = digitado || (m.tipo && m.tipo !== 'texto' ? `[${m.tipo}]` : '');
    return conteudo ? `${carimbo(m.momment)}${quem}: ${conteudo.slice(0, 1200)}` : '';
  };
  const conversa = historico.map(linha).filter(Boolean).join('\n');
  const ultimas = novas.map(linha).filter(Boolean).join('\n');
  return `Conversa até agora no WhatsApp (mais antiga primeiro):\n${conversa || '(vazia)'}\n\nMensagens novas do cliente, que você vai responder:\n${ultimas}`;
}

export const SCHEMA_SAIDA_HELENA = {
  type: 'object',
  properties: {
    bolhas: { type: 'array', items: { type: 'string' } },
    acao: { type: 'string', enum: [...ACOES_HELENA] },
    dados: {
      type: 'object',
      properties: {
        valor_confirmado: { type: 'string' },
        pagamento: { type: 'string' },
        tem_ponto: { type: 'string' },
        cidade: { type: 'string' },
      },
      required: ['valor_confirmado', 'pagamento', 'tem_ponto', 'cidade'],
      additionalProperties: false,
    },
    opcao: { type: 'integer' },
    resumo: { type: 'string' },
  },
  required: ['bolhas', 'acao', 'opcao', 'dados', 'resumo'],
  additionalProperties: false,
} as const;

export interface SaidaHelena {
  /** false = o modelo não devolveu um JSON que dê para usar. Aí ninguém responde
   *  ao cliente: a ação vira `humano` e o consultor é avisado. */
  valido: boolean;
  acao: AcaoHelena;
  bolhas: string[];
  dados: DadosDaConversa;
  resumo: string;
  /** Só na ação `agendar`: a posição (1 a N) do horário escolhido na lista. 0 nas outras. */
  opcao?: number;
}

const SAIDA_INVALIDA: SaidaHelena = { valido: false, acao: 'humano', bolhas: [], dados: {}, resumo: '' };

/** Até duas bolhas, sem travessão e sem emoji, cada uma começando com maiúscula. */
export function limparBolhas(bolhas: readonly unknown[]): string[] {
  return bolhas
    .map(b => String(b ?? '')
      .replace(/\s*[—–]\s*/g, ', ')
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .slice(0, 2)
    .map(b => (b.charAt(0).toLocaleUpperCase('pt-BR') + b.slice(1)).slice(0, 700));
}

/**
 * Lê a saída do modelo. O formato vem forçado, mas a reserva (sem formato
 * forçado) pode embrulhar o JSON em texto: pega do primeiro { ao último }.
 * Qualquer coisa fora do combinado (não é JSON, ação desconhecida) é inválida.
 */
export function lerSaida(texto: unknown): SaidaHelena {
  const s = String(texto ?? '');
  const ini = s.indexOf('{'), fim = s.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return SAIDA_INVALIDA;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(s.slice(ini, fim + 1)) as Record<string, unknown>;
  } catch {
    return SAIDA_INVALIDA;
  }
  if (!j || typeof j !== 'object' || !ACOES_HELENA.includes(j.acao as AcaoHelena)) return SAIDA_INVALIDA;
  const brutas = Array.isArray(j.bolhas) ? j.bolhas : typeof j.bolhas === 'string' ? j.bolhas.split('||') : [];
  const d = (j.dados && typeof j.dados === 'object' ? j.dados : {}) as Record<string, unknown>;
  const campo = (k: string): string => umaLinha(d[k], 160);
  return {
    valido: true,
    acao: j.acao as AcaoHelena,
    bolhas: limparBolhas(brutas),
    dados: {
      valor_confirmado: campo('valor_confirmado'), pagamento: campo('pagamento'),
      tem_ponto: campo('tem_ponto'), cidade: campo('cidade'),
    },
    resumo: String(j.resumo ?? '').trim().slice(0, 600),
    opcao: Number.isInteger(j.opcao) ? Number(j.opcao) : (typeof j.opcao === 'string' && /^\s*\d+\s*$/.test(j.opcao) ? Number(j.opcao) : 0),
  };
}

/** Junta o que a conversa descobriu: o que veio agora ganha, vazio não apaga. */
export function juntarDados(antes: DadosDaConversa | undefined, agora: DadosDaConversa): DadosDaConversa {
  const out: DadosDaConversa = { ...(antes ?? {}) };
  for (const k of ['valor_confirmado', 'pagamento', 'tem_ponto', 'cidade'] as const) {
    const v = String(agora[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return out;
}

// ── NÚMERO NA FALA DA HELENA (13/10/2026) ───────────────────────────────────
// Até aqui só a instrução do modelo dizia "não fale número", e frase como "sai por
// R$ 180 mil", "80 kW e 45 dias" ou "15 recargas por dia" passava pela trava. Agora
// é código: valor em reais, potência, prazo e volume de recarga barram, com o mesmo
// tratamento das outras regras (uma reescrita, depois `humano`).
//
// A única exceção de valor é o que a PRÓPRIA PESSOA disse: o que ela declarou no
// formulário e o que escreveu na conversa. Ecoar o valor dela ("nos seus R$ 140 mil")
// é ler o contexto; inventar outro é a Helena prometendo número.

/** Um número como a pessoa escreve: 140, 1,5, 140.000, 1.500,50. */
const NUM = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?`;

/** "140.000" e "1.500,50" são milhar com ponto; "1,5" e "1.5" são decimal. */
function lerNumero(txt: string): number {
  const milhar = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(txt);
  const limpo = milhar ? txt.replace(/\./g, '').replace(',', '.') : txt.replace(',', '.');
  return Number(limpo);
}

function multiplicador(sufixo: string | undefined): number {
  if (!sufixo) return 1;
  if (sufixo === 'mil' || sufixo === 'k') return 1_000;
  if (/^milh/.test(sufixo)) return 1_000_000;
  return 1;   // "reais"
}

/**
 * Os valores em reais citados num texto, já em reais (140 mil = R$ 140 mil = 140000).
 * `soComMoeda: true` é a leitura ESTREITA da fala da Helena: só `R$ n` ou `n` seguido de
 * "mil reais", "reais", "milhão" ou "milhões". Sem ela (leitura LARGA, do que a pessoa
 * escreveu) "140 mil", "140k" e "300000" também contam, porque quem escreve não usa
 * sempre a moeda. Texto sem acento e em minúsculo, como o resto da trava.
 */
export function valoresEmReais(textoSemAcento: string, soComMoeda: boolean): number[] {
  const t = textoSemAcento;
  const achados: number[] = [];
  // R$ 140 mil, R$ 1,5 milhao, R$ 140.000,00, R$140
  const comCifrao = new RegExp(String.raw`r\$\s*(` + NUM + String.raw`)(?:\s*(mil|k|milhoes|milhao)\b)?`, 'g');
  for (const m of t.matchAll(comCifrao)) achados.push(lerNumero(m[1]!) * multiplicador(m[2]));
  // 140 mil reais, 80 reais, 1,5 milhao, 2 milhoes
  const comPalavra = new RegExp(String.raw`(?<![\d.,])(` + NUM + String.raw`)\s*(mil\s+reais|reais|milhoes|milhao)\b`, 'g');
  for (const m of t.matchAll(comPalavra)) {
    const suf = m[2]!.startsWith('mil ') ? 'mil' : m[2];
    achados.push(lerNumero(m[1]!) * multiplicador(suf));
  }
  // "180 mil" sem o R$: na fala da Helena (estreita) também é valor; "140k" e o número
  // cru de seis algarismos (300000) só contam na leitura larga, do que a pessoa escreve.
  const sufixoMil = soComMoeda ? 'mil' : 'mil|k';
  const mil = new RegExp(String.raw`(?<![\d.,])(` + NUM + String.raw`)\s*(` + sufixoMil + String.raw`)\b`, 'g');
  for (const m of t.matchAll(mil)) achados.push(lerNumero(m[1]!) * 1_000);
  if (!soComMoeda) {
    for (const m of t.matchAll(/(?<![\d.,])(\d{6,})(?![\d.,])/g)) achados.push(Number(m[1]));
  }
  // Sem repetição: "R$ 140 mil" é pego pelo cifrão e pelo "mil", e é um valor só.
  return [...new Set(achados.filter(n => Number.isFinite(n) && n > 0))];
}

/**
 * Os valores em reais que a Helena PODE repetir: o que a pessoa declarou no cadastro
 * (o valor da sessão, o confirmado na conversa, as linhas do formulário) e tudo que
 * ela mesma escreveu. A fala da própria Helena e as contas do simulador NÃO entram.
 */
export function valoresLiberados(
  ctx: Pick<ContextoHelena, 'valorTxt' | 'dados' | 'formulario'>,
  historico: readonly MsgDaConversa[], novas: readonly MsgDaConversa[],
): number[] {
  const textos: string[] = [
    ctx.valorTxt, ctx.dados?.valor_confirmado ?? '',
    ...fatosDoFormulario(ctx.formulario),
    ...[...historico, ...novas].filter(m => m.from_me === false).map(m => m.texto ?? ''),
    // O que a pessoa FALOU em áudio também é dela: a Helena pode repetir o valor.
    ...[...historico, ...novas].filter(m => m.from_me === false && m.tipo === 'audio').map(m => m.transcricao ?? ''),
  ];
  return textos.flatMap(x => valoresEmReais(semAcento(x), false));
}

/** Achou número com unidade de potência, prazo ou volume de recarga na fala? Devolve o motivo. */
function numeroProibido(t: string): string | null {
  // Potência: "80 kW", "7,4 kWh". A palavra "kWh" sem número segue liberada.
  const potencia = /\d\s*kwh?\b/.exec(t);
  if (potencia) return `citou potência ("${potencia[0].trim()}")`;
  // Prazo: só dia, semana, mês e ano contam, e só quando é promessa de prazo.
  //  · "em <n> dias/semanas/meses/anos" sempre barra ("fica pronto em 45 dias");
  //  · "<n> dias..." solto barra se, a até 40 caracteres, há palavra de prazo, obra,
  //    instalação, entrega, homologação, "pronto", "paga" ou "retorno" ("a obra leva uns 2 meses");
  //  · tempo que já passou ou conversa não barra: "faz 2 semanas", "há 1 mês", "nos
  //    últimos/próximos 2 dias", "daqui a 3 dias". Data ("13/10"), hora ("10:00", "24h")
  //    e "30 minutos" não têm essa unidade e seguem livres.
  const emPrazo = /\bem\s+\d+\s+(?:dias?|semanas?|mes|meses|anos?)\b/.exec(t);
  if (emPrazo) return `citou prazo ("${emPrazo[0]}")`;
  for (const m of t.matchAll(/(?<![\d/:.,])\d+\s+(?:dias?|semanas?|mes|meses|anos?)\b/g)) {
    const i = m.index ?? 0;
    const antes = t.slice(Math.max(0, i - 20), i);
    if (/(?:\bfaz|\bha|nos ultimos|nos proximos|daqui a)\s*$/.test(antes)) continue;
    const janela = t.slice(Math.max(0, i - 40), i + m[0].length + 40);
    if (/\b(?:prazo|obras?|instala\w*|entrega\w*|homologa\w*|pront[oa]s?|paga|retorno)\b/.test(janela)) {
      return `citou prazo ("${m[0]}")`;
    }
  }
  // Volume de recarga: "<n> recarga(s)" (número colado, com até um adjetivo no meio) e
  // "recarga(s) por dia/mês/semana/hora". Dígito solto perto da palavra NÃO barra:
  // "24h ... mapas de recarga" e "terça 13/10 às 10:00 ... a recarga" são conversa.
  const volume = /(?<![\d/:.,])\d+(?:\s+[a-z]{4,})?\s+recargas?\b/.exec(t)
    ?? /\brecargas?\s+por\s+(?:dia|mes|semana|hora)\b/.exec(t);
  if (volume) return `citou volume de recargas ("${volume[0]}")`;
  return null;
}

/**
 * A resposta quebra uma regra que não pode quebrar nunca? Regra que precisa
 * valer 100% das vezes é código, não pedido: se o modelo escrever "cota", link
 * ou percentual, a mensagem não sai e a conversa vai para o consultor.
 *
 * @param valoresDaPessoa os valores em reais (já em reais) que a PRÓPRIA pessoa disse;
 *   só eles podem aparecer na fala. Sem a lista, nenhum valor em reais passa.
 */
export function violaRegras(bolhas: readonly string[], valoresDaPessoa: readonly number[] = []): string | null {
  // Sem acento e em minúsculo: "Rentável", "RENTAVEL" e "rentável" são a mesma
  // palavra, e depois disso o \b do JavaScript volta a funcionar ("cotação" vira
  // "cotacao", que não é "cota").
  const t = semAcento(bolhas.join(' '));
  if (/\bcot(?:a|ista)s?\b/.test(t)) return 'falou em cota';
  // "rend" pega rende, rendendo, rendimento e renda; "se paga" é prazo de retorno
  // dito de outro jeito (ressalva da revisão de 11/10/2026).
  const promessa = /\b(retornos?|rend\w*|rentabilidade|rentav\w*|lucros?|lucrativ\w*|payback|garant\w*|juros?)\b|\bpor cento\b|\bse pagam?\b/.exec(t);
  if (promessa) return `usou a palavra "${promessa[0]}"`;
  // "ganhar" sozinho é conversa ("você ganha tempo"); com número ou "por mês" na
  // mesma frase é promessa de ganho.
  for (const frase of t.split(/[.!?]+/)) {
    if (/\bganh\w*/.test(frase) && (/\d/.test(frase) || /\bpor mes\b/.test(frase))) return 'falou em ganho com número ou por mês';
  }
  if (/\d\s*%/.test(t)) return 'citou percentual';
  // O FORMATO da reunião (11/10/2026, ordem do dono: "não mostre que é vídeo, tem
  // gente que não gosta, cita que será uma reunião"). Ela diz "reunião" ou
  // "conversa com o consultor" e nada além. Celular, computador e telefone NÃO
  // entram aqui de propósito: são palavras de conversa comum e dariam falso
  // positivo; ficam só na instrução do prompt.
  const formato = /\b(videos?|videochamadas?|chamadas? de video|links?|on-?line|meet|zoom|presencia\w*)\b|\bsem instalar\b/.exec(t);
  if (formato) return `falou do formato da reunião ("${formato[0]}")`;
  if (/https?:\/\/|www\./.test(t)) return 'colocou link';
  // Domínio solto, sem http: "solardoc.app/x", "wa.me/55...", "site.com.br".
  const dominio = /\b[a-z0-9][a-z0-9-]*\.(?:com|app|br|net|me|io|org)\b/.exec(t);
  if (dominio) return `colocou endereço de site (${dominio[0]})`;
  // Valor em reais que a pessoa não disse. Compara pelo número: 140 mil = 140.000.
  const liberados = new Set(valoresDaPessoa.map(v => Math.round(v)));
  const inventado = valoresEmReais(t, true).find(v => !liberados.has(Math.round(v)));
  if (inventado !== undefined) return `citou valor em reais que a pessoa não disse (R$ ${inventado.toLocaleString('pt-BR')})`;
  return numeroProibido(t);
}

/** O recado que volta para o modelo quando a resposta dele foi barrada: UMA
 *  segunda chance de reescrever. Se quebrar de novo, a conversa vai para gente. */
export function pedidoDeReescrita(pedido: string, quebra: string, bolhas: readonly string[]): string {
  return [
    pedido,
    '',
    'ATENÇÃO: a resposta que você escreveu foi barrada e NÃO foi enviada. Motivo: ' + quebra + '.',
    'O que você tinha escrito: ' + bolhas.join(' / '),
    'Reescreva a resposta sem isso. Não fale de rendimento, prazo, percentual nem site, e não escreva número que a pessoa não disse (valor em reais, potência em kW, prazo em dias ou meses, quantidade de recargas): para esses assuntos diga "os números" e que o consultor mostra na reunião. Não diga como a reunião acontece: diga só "reunião" ou "conversa com o consultor", e que ele combina os detalhes pelo WhatsApp dele.',
  ].join('\n');
}
