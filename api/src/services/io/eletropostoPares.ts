// ─────────────────────────────────────────────────────────────────────────────
// QUEM ESTÁ PERTO DE QUEM — a dica de par no aviso da equipe.
//
// Entrou um ponto? o aviso já diz quais investidores estão perto dele.
// Entrou um investidor? diz quais pontos. É o que transforma "chegou cadastro"
// em "liga pra esses dois".
//
// POR QUE OS N MAIS PRÓXIMOS, E NÃO "MESMA UF":
// mesma UF é proximidade de mentira num país deste tamanho. O balde BA junta
// Lauro de Freitas com Vitória da Conquista (500 km); o MG entregaria Miradouro
// a 662 km como "perto". E raio fixo tem o problema inverso: 300 km devolve
// sete nomes em São Paulo e um em Manaus — mede densidade, não responde "quem eu
// ligo". Então: os mais próximos, EM ORDEM, com a distância escrita do lado, e
// um teto de 400 km só pra não chamar de par quem está em outro estado longe.
//
// A DICA É ENFEITE; O CADASTRO É O FATO. Se a cidade não resolve, se o pool está
// vazio, se qualquer coisa aqui falha — o aviso sai igual, só sem o bloco.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { resolverCidade, distanciaKm } from './geoCidade';

/**
 * Acima disso não é par, é outro mercado.
 *
 * 200 km é o número do Thiago (18/08). É UM número só, e ele vale nos três
 * lugares — o aviso no WhatsApp, a coluna "quem está perto" e a lista de match.
 * Dois tetos diferentes fariam a mensagem citar alguém que a tela não considera
 * par, e ninguém entenderia por quê.
 *
 * O que ele custa, com a base de hoje: 22 pares a 400 km viram 10 a 200 km. Os
 * que caem não somem da tela — aparecem como "o mais perto está a X km, longe
 * demais pra chamar de par", que é informação, não silêncio.
 */
export const TETO_KM = 200;
/** Três nomes cabem numa mensagem de WhatsApp sem virar lista. */
export const MAX_PARES = 3;

export type Lado = 'capital' | 'ponto';

export interface Candidato {
  nome: string;
  telefone: string;
  cidade: string | null;
  /** Onde a pessoa está, resolvido — não o que ela digitou. */
  municipio?: string;
  uf?: string;
  km?: number;
  lat?: number;
  lng?: number;
  /** De onde a linha veio, pra equipe saber se a pessoa se cadastrou ou não. */
  daFicha: boolean;
  /** 'agenda' = o consultor marcou ARRENDAMENTO no card. O mesmo nome curto que a
   *  aba Cadastros do /gerador usa (CAD_ORIGEM), porque os pares chegam por ele. */
  tab: 'parceria' | 'nota1' | 'agenda';
  id: number;
  /** O que a pessoa respondeu em "O local é seu?", como ela viu na tela. `null` =
   *  ninguém perguntou (ficha velha, ou reunião marcada na mão). */
  relacao?: string | null;
  /** O local é DELA. Só no lado do ponto; no capital é sempre false. */
  proprio: boolean;
}

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

// ─────────────────────────────────────────────────────────────────────────────
// PRA ONDE CADA PESSOA VAI (regra do dono, 21/09/2026)
//
// Duas respostas decidem, e so elas:
//   1. O local e seu?      -> pode ceder (dono, inquilino, representante) ou nao
//   2. Quanto investe?     -> R$ 50 mil ou mais / abaixo / nao disse
// e o resultado:
//   PODE CEDER                         -> ARRENDAMENTO (ponto)
//   nao pode, declarou >= R$ 50 mil    -> INVESTIDORES (capital)
//   nao pode, abaixo ou NAO DISSE      -> CURIOSO (a equipe liga e pergunta; quem
//                                         responde um valor volta pra Investidores)
//
// "Pode ceder" e o contrato de arrendamento (Cl. 16.1): proprietario, inquilino
// com anuencia do dono, administrador ou representante com poderes. Quem
// "negocia com o proprietario" ou "ainda nao e dono" nao assina.
//
// O PISO E R$ 50 MIL ("de 50 mil pra cima", o dono, 21/09/2026). Comecou em 70,
// o menor ingresso da LP, e desceu quando a conta mostrou 26 cadastros com "Ate
// R$ 50 mil" parados no Curioso. Numa faixa vale o TETO, entao "Ate R$ 50 mil"
// alcanca o piso e "R$ 50 a 100 mil" tambem. O numero e UM so: PISO_INVESTIDOR_MIL
// aqui e CAD_PISO_MIL no /gerador, e o teste gemeo prova que os dois concordam.
//
// ESTA REGRA TEM GEMEA em cadDestino() no /gerador (aba Cadastros). Mudar uma sem
// a outra faz a aba listar alguem que o Match nao oferece, ou o contrario.
// ─────────────────────────────────────────────────────────────────────────────
export type Destino = 'ponto' | 'capital' | 'curioso';

/** Tem poder de ceder o local? A ordem importa: "negociando com o PROPRIETARIO"
 *  e "ainda nao e meu" contem palavras de dono sem ser dono. */
export function podeCeder(relacao: unknown): boolean {
  const t = String(relacao ?? '').toLowerCase();
  if (!t || /ainda n[aã]o [eé] meu|negoci|em vista|n[aã]o conversei/.test(t)) return false;
  return /propriet|inquilin|represent|administr/.test(t);
}

// ─────────────────────────────────────────────────────────────────────────────
// PONTO PRÓPRIO — quem o Match pode oferecer (ordem do dono, 28/09/2026)
//
// `podeCeder` continua sendo quem entra na aba ARRENDAMENTO: proprietário,
// inquilino, administrador e representante, os quatro que assinam pelo contrato
// (Cl. 16.1). O MATCH é mais estreito, e de propósito: apresentar um investidor
// a um inquilino é marcar reunião que depende de um terceiro que ninguém falou
// com — o dono do imóvel. Quem indica dupla indica ponto PRÓPRIO.
//
// SÃO DUAS RÉGUAS, NÃO UMA. Estreitar `podeCeder` jogaria inquilino e
// representante fora do Arrendamento e dentro de Investidores/Curioso, o que
// muda a aba, os grupos do Menu de Avisos e o contrato. Eles continuam na lista,
// continuam na fila da equipe — só não viram dupla automática.
//
// A base em 28/09/2026: 33 pontos no pool, 19 próprios. Os 14 que saem do Match
// são 10 inquilinos, 2 representantes, 1 administrador e 1 da agenda.
// ─────────────────────────────────────────────────────────────────────────────

/** O local é da própria pessoa? A ORDEM importa, e por dois motivos: "REPRESENTO
 *  o proprietário" e "estou NEGOCIANDO com o proprietário" contêm a palavra dono
 *  sem ser dono. Mesma leitura do selo PRÓPRIO na aba Cadastros do /gerador. */
export function ehProprio(relacao: unknown): boolean {
  const t = String(relacao ?? '').toLowerCase();
  if (!t) return false;                                    // ninguém perguntou: não afirma nada
  if (/ainda n[aã]o [eé] meu|nao_e_meu|negoci|em vista|n[aã]o conversei/.test(t)) return false;
  if (/represent|administr|inquilin/.test(t)) return false;
  return /propriet|sou o dono|[eé] meu/.test(t);
}

/** O lado do PONTO como o Match o vê. Existe como função com nome para que as
 *  duas pontas — a dica no WhatsApp e a tela — filtrem pela MESMA linha. */
export const soPontosProprios = (lista: Candidato[]): Candidato[] => lista.filter(c => c.proprio);

/**
 * O valor declarado, em MIL reais, ou null quando a pessoa nao disse. Le os tres
 * jeitos que o valor chega: opcao da LP ("R$ 140 mil"), faixa do cadastro
 * ("R$ 50 mil a R$ 100 mil", "Ate R$ 50 mil") e resposta livre no WhatsApp
 * ("uns 100k", "R$ 70.000", "1,5 milhao"). Numa faixa vale o TETO: quem diz
 * "ate 100 mil" topa o piso. "Menos de" fica logo abaixo do numero.
 */
export function valorEmMil(texto: unknown): number | null {
  const t = String(texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || /depende/.test(t)) return null;
  const nums = numerosEmMil(t);
  if (!nums.length) return null;
  const teto = Math.max(...nums);
  return /menos de|abaixo de/.test(t) ? teto - 0.01 : teto;
}

/** Todos os numeros do texto, em MIL reais ("70.000" = 70, "1,5 milhao" = 1500). */
export function numerosEmMil(texto: unknown): number[] {
  const t = String(texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const nums: number[] = [];
  const re = /(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(milh[aãoõ]es|milh[aã]o|mi\b|mil|k\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const bruto = m[1];
    const unid = m[2] || '';
    let n: number;
    if (/[.\s]\d{3}$/.test(bruto) && !/,/.test(bruto)) n = Number(bruto.replace(/[.\s]/g, ''));
    else n = Number(bruto.replace(',', '.'));
    if (!isFinite(n)) continue;
    if (/milh|^mi$/.test(unid)) n = n * 1000;          // milhao -> mil
    else if (unid === 'mil' || unid === 'k') { /* ja esta em mil */ }
    else if (n >= 1000) n = n / 1000;                   // "70000" -> 70
    nums.push(n);
  }
  return nums;
}

/** O piso de Investidores, em mil reais. Gemeo de CAD_PISO_MIL no /gerador. */
export const PISO_INVESTIDOR_MIL = 50;

/** Declarou o piso ou mais? true / false (declarou abaixo) / null (nao disse).
 *  "Menos de X" e um TETO: com X acima do piso ele nao prova nada ("Menos de R$ 70
 *  mil", a opcao antiga do Registrar valor, pode ser 10 mil), entao e "nao disse". */
export function valorOk(texto: unknown): boolean | null {
  const v = valorEmMil(texto);
  if (v === null) return null;
  if (/menos de|abaixo de/.test(String(texto).toLowerCase()) && v >= PISO_INVESTIDOR_MIL) return null;
  return v >= PISO_INVESTIDOR_MIL;
}

// ─────────────────────────────────────────────────────────────────────────────
// OS DOIS EIXOS (ordem do dono, 28/09/2026)
//
// "Temos que considerar todos que tem endereco proprio como opcao de
// arrendamento. Tem gente que chega querendo comprar e no final nao tem dinheiro
// e podemos oferecer arrendamento."
//
// Isso separa duas coisas que estavam grudadas numa unica classificacao:
//
//   EIXO DO LOCAL    -> pode ceder um local? e opcao de ARRENDAMENTO. Vale de
//                       QUALQUER porta (cadastro do ponto, cadastro de capital,
//                       ficha, reuniao) e em QUALQUER desfecho da reuniao — quem
//                       foi SEM INTERESSE por falta de dinheiro e justamente o
//                       melhor arrendador. E `ehOpcaoArrendamento`.
//   EIXO DO DINHEIRO -> declarou R$ 50 mil ou mais? Investidores; nao disse?
//                       Curioso. E `destinoDe`, e ele NAO muda.
//
// A MESMA PESSOA PODE ESTAR NOS DOIS, e isso e informacao, nao defeito: quem tem
// o local E o dinheiro e venda direta, nao precisa de par. Era por isso que o
// pool antigo tirava o telefone de um lado quando ele aparecia no outro; agora
// quem impede a pessoa de virar par DELA MESMA e a chave de telefone em
// `montarPares`, no momento de cruzar.
//
// O QUE ESTAVA SENDO PERDIDO, medido em 28/09: 120 reunioes da LP respondem "Sou
// o proprietario" e so 12 estavam marcadas ARRENDAMENTO. As outras 108 morreram
// em cancelado (28), agendado (15), sem_interesse (15), em_atendimento (13), nao
// atendeu (11)... todas com o endereco na ficha.
// ─────────────────────────────────────────────────────────────────────────────

/** Reuniao cujo local JA ganhou carregador: arrendar ali e alugar ponto ocupado.
 *  Os outros desfechos continuam todos valendo, e isso e proposital —
 *  `carregador`, `50/50` e `chave na mao` sao o MODELO em negociacao, nao venda
 *  (o rotulo de venda e `fechou`/VENDIDO). Hoje isso barra 0 pessoas. */
export const STATUS_LOCAL_OCUPADO = new Set(['fechou', 'fechou_concorrente']);

/** A pergunta "O local e seu?" escrita como o lead a viu. */
const ROTULO_LOCAL = /Local (?:é|e) seu:\s*([^\n]+)/i;

/**
 * A resposta de "O local e seu?" numa linha qualquer, de qualquer origem.
 *
 * A COLUNA NAO BASTA. `agendamentos.ponto_relacao` existe desde a migration de
 * 29/08 e esta VAZIA em 96% das linhas: em setembro, 190 reunioes trazem a linha
 * no texto e 18 tem a coluna preenchida (as que o botao ARRENDAMENTO gravou). O
 * trigger que deveria enche-la nao enche. Entao o texto e a fonte, e a coluna e
 * so um atalho pra quando ela existir.
 */
export function relacaoDaLinha(origem: 'parceria' | 'nota1' | 'agenda',
                               r: Record<string, unknown>): string | null {
  const col = String(r.ponto_relacao ?? '').trim();
  if (col) return col;
  const texto = origem === 'nota1' ? r.ficha : r.observacao;
  return campoDaFicha(texto, ROTULO_LOCAL);
}

/**
 * E opcao de ARRENDAMENTO? O eixo do LOCAL, sem olhar dinheiro nenhum.
 *
 * GEMEO de cadEhOpcaoArrendamento() no /gerador. Mudar um sem o outro faz a aba
 * listar quem o Match nao oferece, ou o contrario.
 */
export function ehOpcaoArrendamento(origem: 'parceria' | 'nota1' | 'agenda',
                                    r: Record<string, unknown>): boolean {
  if (origem === 'agenda') {
    if (STATUS_LOCAL_OCUPADO.has(String(r.status || ''))) return false;
    // Quem aperta ARRENDAMENTO no card ja perguntou de quem e o local.
    if (String(r.status || '') === 'arrendamento') return true;
  }
  return podeCeder(relacaoDaLinha(origem, r));
}

// ─────────────────────────────────────────────────────────────────────────────
// A PERGUNTA QUE FALTA: "DE QUEM É O LOCAL?" (29/09/2026)
//
// O eixo do local so funciona com a resposta na mao, e 117 pessoas TEM ENDERECO
// na ficha e nunca foram perguntadas. Elas nao estao em lista nenhuma: nao sao
// Arrendamento (ninguem disse que podem ceder) e o endereco delas esta ali,
// escrito, esperando a pergunta de uma linha.
//
// QUEM JA RESPONDEU NAO RECEBE. "Ainda nao e meu" e "estou negociando com o
// proprietario" SAO respostas: repetir a pergunta pra quem respondeu e dizer na
// cara que ninguem leu. Sao 9 pessoas, e elas ficam de fora de proposito. Quem a
// LP marcou como "nao respondeu" entra, porque ai a pergunta nao foi feita.
//
// Reuniao que virou venda ou foi pro concorrente fica fora pelo mesmo motivo do
// eixo do local: o lugar ja tem carregador.
// ─────────────────────────────────────────────────────────────────────────────

/** Respondeu de quem e o local? "nao respondeu", vazio e nulo sao a MESMA coisa:
 *  a pergunta nao foi feita. */
export function respondeuDeQuemE(relacao: unknown): boolean {
  const t = String(relacao ?? '').trim().toLowerCase();
  return !!t && !/^n[aã]o respondeu$/.test(t);
}

/** Tem endereco anotado? E o que faz a pergunta valer a pena: sem endereco nao
 *  ha local pra arrendar, so uma pessoa interessada. */
export function temEndereco(origem: 'parceria' | 'nota1' | 'agenda',
                            r: Record<string, unknown>): boolean {
  if (origem === 'parceria') return String(r.ponto_endereco ?? '').trim() !== '';
  if (origem === 'nota1') return String(r.endereco ?? '').trim() !== '';
  return /Endere[çc]o:\s*\S/i.test(String(r.observacao ?? ''));
}

/** Entra na pauta "Dono nao perguntado"? Tem endereco, ninguem perguntou, e ela
 *  ainda nao e opcao de arrendamento.
 *
 *  GEMEO de cadPrecisaPerguntarDono() no /gerador. */
export function precisaPerguntarDoDono(origem: 'parceria' | 'nota1' | 'agenda',
                                       r: Record<string, unknown>): boolean {
  // Ficha de teste fica fora: o telefone dela costuma ser o NOSSO, e a pauta gasta
  // um envio da linha pra mandar pergunta pra dentro de casa. Mesma regra da aba
  // Prospeccao, que ja corta nome comecando com "teste".
  if (/^\s*teste\b/i.test(String(r.nome ?? r.cliente_nome ?? ''))) return false;
  if (origem === 'agenda' && STATUS_LOCAL_OCUPADO.has(String(r.status || ''))) return false;
  if (ehOpcaoArrendamento(origem, r)) return false;
  if (!temEndereco(origem, r)) return false;
  return !respondeuDeQuemE(relacaoDaLinha(origem, r));
}

/** O "Local e seu:" e o "Quanto pretende investir:" moram no TEXTO da ficha. */
const campoDaFicha = (ficha: unknown, rotulo: RegExp): string | null => {
  const m = String(ficha ?? '').match(rotulo);
  return m ? m[1].trim() : null;
};

/** Pra onde a linha vai, nas quatro origens. */
export function destinoDe(origem: 'parceria' | 'nota1' | 'agenda', r: Record<string, unknown>): Destino {
  // O consultor marcou ARRENDAMENTO no card e disse de quem e o local.
  if (origem === 'agenda') return 'ponto';
  if (origem === 'parceria') {
    if (r.lado === 'ponto' && podeCeder(r.ponto_relacao)) return 'ponto';
    return valorOk(r.capital_faixa) ? 'capital' : 'curioso';
  }
  // ficha da LP: o valor registrado pelo consultor ganha do texto da ficha
  if (podeCeder(campoDaFicha(r.ficha, /Local (?:é|e) seu:\s*([^\n]+)/i))) return 'ponto';
  const valor = r.valor_investir || campoDaFicha(r.ficha, /Quanto pretende investir:\s*([^\n]+)/i);
  return valorOk(valor) ? 'capital' : 'curioso';
}

/** Uma linha de qualquer das tres origens, com os campos crus da tabela. */
export interface LinhaOrigem { origem: 'parceria' | 'nota1' | 'agenda'; r: Record<string, unknown> }

/**
 * Cada TELEFONE no seu melhor destino: Arrendamento > Investidores > Curioso.
 * Dentro do destino ganha a primeira linha da lista, que chega na ordem da aba:
 * cadastro > ficha > agenda, a mais nova primeiro. Linha sem telefone fica no
 * proprio destino, sem dedupe.
 *
 * GEMEO do agrupamento em cadCarregar() no /gerador: o teste eletropostoDestino
 * roda os dois lado a lado. E ele que garante que a aba Curioso e a lista que
 * recebe a pergunta do valor sao as mesmas pessoas.
 */
export function agruparPorDestino(linhas: LinhaOrigem[]): Record<Destino, LinhaOrigem[]> {
  const PESO: Record<Destino, number> = { ponto: 0, capital: 1, curioso: 2 };
  const tel = (l: LinhaOrigem) => soDigitos(l.origem === 'agenda' ? l.r.cliente_telefone : l.r.telefone);
  const comDestino = linhas.map(l => ({ l, d: destinoDe(l.origem, l.r) }));
  const melhor = new Map<string, Destino>();
  for (const { l, d } of comDestino) {
    const t = tel(l);
    if (t && (!melhor.has(t) || PESO[d] < PESO[melhor.get(t)!])) melhor.set(t, d);
  }
  const saida: Record<Destino, LinhaOrigem[]> = { ponto: [], capital: [], curioso: [] };
  const vistos = new Set<string>();
  for (const { l, d } of comDestino) {
    const t = tel(l);
    if (t) {
      if (vistos.has(t) || melhor.get(t) !== d) continue;
      vistos.add(t);
    }
    saida[d].push(l);
  }
  return saida;
}

export interface ContatoCurioso {
  telefone: string;
  nome: string | null;
  cidade: string | null;
  status: string | null;
  /** 'nota1:123' ou 'parceria:45': a linha onde a resposta do valor vai ser gravada. */
  ref: string;
}

/**
 * Quem esta no CURIOSO agora: a mesma leitura e o mesmo agrupamento da aba.
 *
 * Erro de leitura SOBE, nunca vira lista vazia. Lista vazia faria o motor de
 * Avisos concluir a pauta como "todos receberam" sem ter mandado nada, que e a
 * pior falha possivel ali: parece sucesso.
 */
export async function curiosos(): Promise<ContatoCurioso[]> {
  // 1000 e o teto de linhas da API do Supabase; a aba le com o mesmo numero.
  const [cad, fic, ag] = await Promise.all([
    supabaseGerador.from('eletroposto_parceria')
      .select('id, nome, telefone, cidade, lado, ponto_relacao, capital_faixa, status, created_at')
      .in('lado', ['ponto', 'capital']).order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('eletroposto_nota1')
      .select('id, nome, telefone, cidade, ficha, valor_investir, status, created_at')
      .order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('agendamentos')
      .select('id, cliente_telefone, created_at').eq('status', 'arrendamento')
      .order('created_at', { ascending: false }).limit(1000),
  ]);
  if (cad.error) throw new Error(`curiosos: leitura dos cadastros falhou: ${cad.error.message}`);
  if (fic.error) throw new Error(`curiosos: leitura das fichas falhou: ${fic.error.message}`);
  if (ag.error) throw new Error(`curiosos: leitura da agenda falhou: ${ag.error.message}`);
  const linhas: LinhaOrigem[] = [
    ...((cad.data || []) as Record<string, unknown>[]).map(r => ({ origem: 'parceria' as const, r })),
    ...((fic.data || []) as Record<string, unknown>[]).map(r => ({ origem: 'nota1' as const, r })),
    ...((ag.data || []) as Record<string, unknown>[]).map(r => ({ origem: 'agenda' as const, r })),
  ];
  return agruparPorDestino(linhas).curioso.map(({ origem, r }) => ({
    telefone: soDigitos(r.telefone),
    nome: (r.nome as string) || null,
    cidade: (r.cidade as string) || null,
    status: (r.status as string) || null,
    ref: `${origem}:${r.id}`,
  }));
}

export interface ContatoSemDono {
  telefone: string;
  nome: string | null;
  cidade: string | null;
  /** Status do CADASTRO (novo/falando/sem_interesse). `null` nas linhas que vem da
   *  agenda: lá `status` é o desfecho da REUNIÃO, e reunião perdida por falta de
   *  dinheiro é justamente quem a gente quer perguntar. Passar o desfecho aqui
   *  faria a audiência descartar 27 pessoas por "sem_interesse" que não é dela. */
  status: string | null;
  /** 'agenda:1128', 'nota1:7' ou 'parceria:45'. */
  ref: string;
}

/**
 * Quem tem endereço e nunca respondeu de quem é o local.
 *
 * Um telefone uma vez, na linha mais rica (cadastro > ficha > agenda), a mesma
 * ordem do pool. Erro de leitura SOBE, nunca vira lista vazia: lista vazia faria
 * a pauta concluir sem ter mandado nada, com cara de sucesso.
 */
export async function semDonoDeclarado(): Promise<ContatoSemDono[]> {
  const [cad, fic, ag] = await Promise.all([
    supabaseGerador.from('eletroposto_parceria')
      .select('id, nome, telefone, cidade, lado, ponto_relacao, ponto_endereco, capital_faixa, status, created_at')
      .order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('eletroposto_nota1')
      .select('id, nome, telefone, cidade, endereco, ficha, valor_investir, status, created_at')
      .order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('agendamentos')
      .select('id, cliente_nome, cliente_telefone, cidade, status, ponto_relacao, observacao, created_at')
      .ilike('created_by', '%eletroposto%')
      .order('created_at', { ascending: false }).limit(1000),
  ]);
  if (cad.error) throw new Error(`sem-dono: leitura dos cadastros falhou: ${cad.error.message}`);
  if (fic.error) throw new Error(`sem-dono: leitura das fichas falhou: ${fic.error.message}`);
  if (ag.error) throw new Error(`sem-dono: leitura da agenda falhou: ${ag.error.message}`);

  const saida: ContatoSemDono[] = [];
  const vistos = new Set<string>();
  const poe = (tel: string, c: ContatoSemDono) => {
    const k = tel.slice(-8);
    if (!k || vistos.has(k)) return;
    vistos.add(k);
    saida.push(c);
  };
  for (const r of (cad.data || []) as Record<string, unknown>[]) {
    if (!precisaPerguntarDoDono('parceria', r)) continue;
    const tel = soDigitos(r.telefone);
    poe(tel, { telefone: tel, nome: (r.nome as string) || null, cidade: (r.cidade as string) || null,
               status: (r.status as string) || null, ref: `parceria:${r.id}` });
  }
  for (const r of (fic.data || []) as Record<string, unknown>[]) {
    if (!precisaPerguntarDoDono('nota1', r)) continue;
    const tel = soDigitos(r.telefone);
    poe(tel, { telefone: tel, nome: (r.nome as string) || null, cidade: (r.cidade as string) || null,
               status: (r.status as string) || null, ref: `nota1:${r.id}` });
  }
  for (const r of (ag.data || []) as Record<string, unknown>[]) {
    if (!precisaPerguntarDoDono('agenda', r)) continue;
    const tel = soDigitos(r.cliente_telefone);
    poe(tel, { telefone: tel, nome: (r.cliente_nome as string) || null, cidade: (r.cidade as string) || null,
               status: null, ref: `agenda:${r.id}` });
  }
  return saida;
}

/**
 * Carrega um lado inteiro, das três origens, já com coordenada quando dá.
 *
 * OS DOIS LADOS PODEM CONTER A MESMA PESSOA (28/09/2026), porque são dois eixos:
 * quem tem local próprio é opção de arrendamento mesmo tendo dinheiro, e quem
 * tem dinheiro é investidor mesmo tendo local. Até 28/09 o lado do ponto
 * "ganhava a disputa" e apagava a pessoa do outro lado — o que escondia o melhor
 * lead que existe. Quem impede alguém de virar par DELE MESMO agora é a chave de
 * telefone em `montarPares`, na hora de cruzar, e não a exclusão no pool.
 */
export async function pool(lado: Lado): Promise<Candidato[]> {
  // As tres origens inteiras: quem decide o lado e destinoDe(), nao o filtro do
  // banco. Um cadastro de "ponto" que ainda negocia o local, e declarou dinheiro,
  // e INVESTIDOR — so a regra enxerga isso. A ORDEM (mais novo primeiro) e a da aba
  // Cadastros: quando o mesmo telefone tem duas linhas no mesmo destino, as duas
  // telas escolhem a mesma, e a coluna "perto" acha a linha que a tela mostra.
  const [cadastros, fichas, agenda] = await Promise.all([
    supabaseGerador.from('eletroposto_parceria')
      .select('id, nome, telefone, cidade, lado, ponto_relacao, capital_faixa')
      .in('lado', ['ponto', 'capital']).order('created_at', { ascending: false }).limit(1000),
    supabaseGerador.from('eletroposto_nota1')
      .select('id, nome, telefone, cidade, ficha, valor_investir')
      .order('created_at', { ascending: false }).limit(1000),
    // TODA REUNIAO DE ELETROPOSTO (28/09), nao so a marcada ARRENDAMENTO: a
    // resposta "o local e seu?" esta na observacao de 197 delas, e e ela que diz
    // quem e opcao de arrendamento. Sao 192 KB de observacao no total, entao ler
    // o texto sai mais barato do que depender da coluna vazia.
    lado === 'ponto'
      ? supabaseGerador.from('agendamentos')
          .select('id, cliente_nome, cliente_telefone, cidade, status, ponto_relacao, observacao')
          .ilike('created_by', '%eletroposto%')
          .order('created_at', { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const linhas: Candidato[] = [];
  // Um telefone aparece uma vez DENTRO do lado, na linha mais rica.
  const vistos = new Set<string>();
  // No lado do ponto manda o eixo do LOCAL; no do capital, o eixo do DINHEIRO.
  const entra = (origem: 'parceria' | 'nota1', r: Record<string, unknown>) =>
    lado === 'ponto' ? ehOpcaoArrendamento(origem, r) : destinoDe(origem, r) === 'capital';

  for (const c of (cadastros.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(c.telefone);
    if (!tel || vistos.has(tel)) continue;
    if (!entra('parceria', c)) continue;
    vistos.add(tel);
    const rel = relacaoDaLinha('parceria', c);
    linhas.push({ nome: String(c.nome || '—'), telefone: tel, cidade: (c.cidade as string) || null,
                  daFicha: false, tab: 'parceria', id: Number(c.id),
                  relacao: rel, proprio: lado === 'ponto' && ehProprio(rel) });
  }

  // A ficha de NOTA 1 nao se declarou de lado nenhum: quem a separa e
  // destinoDe(), a mesma regra da aba Cadastros. Cadastro ganha da ficha.
  for (const f of (fichas.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(f.telefone);
    if (!tel || vistos.has(tel)) continue;
    if (!entra('nota1', f)) continue;
    vistos.add(tel);
    // A ficha não tem coluna de relação (a migration só criou a de `agendamentos`):
    // a resposta mora no TEXTO, na mesma linha que destinoDe() lê.
    const rel = relacaoDaLinha('nota1', f);
    linhas.push({ nome: String(f.nome || '—'), telefone: tel, cidade: (f.cidade as string) || null,
                  daFicha: true, tab: 'nota1', id: Number(f.id),
                  relacao: rel, proprio: lado === 'ponto' && ehProprio(rel) });
  }

  // A agenda vem por ULTIMO no mesmo `vistos`: cadastro > ficha > agenda. Quem ja
  // esta no pool por outro caminho nao entra de novo (e a linha rica ganha).
  for (const a of (agenda.data || []) as Record<string, unknown>[]) {
    const tel = soDigitos(a.cliente_telefone);
    if (!tel || vistos.has(tel)) continue;
    if (!ehOpcaoArrendamento('agenda', a)) continue;
    vistos.add(tel);
    // A resposta vem da coluna quando existe e do texto da observação quando não
    // (o caso de 96% das linhas). Reunião marcada ARRENDAMENTO na mão não tem
    // resposta nenhuma: fica no Arrendamento, porque o consultor perguntou, e
    // fora do Match, porque ninguém registrou de quem é o local.
    const rel = relacaoDaLinha('agenda', a);
    linhas.push({ nome: String(a.cliente_nome || '—'), telefone: tel, cidade: (a.cidade as string) || null,
                  daFicha: false, tab: 'agenda', id: Number(a.id),
                  relacao: rel, proprio: ehProprio(rel) });
  }

  for (const l of linhas) {
    const g = resolverCidade(l.cidade);
    if (g.status === 'ok') { l.lat = g.lat; l.lng = g.lng; l.municipio = g.municipio; l.uf = g.uf; }
  }
  return linhas;
}

// ─────────────────────────────────────────────────────────────────────────────
// O CRUZAMENTO — o que a aba Cadastros recebe pronto
//
// Mora aqui, e nao na rota, por dois motivos: a trava de auto-par precisa de
// teste (os dois lados agora podem conter a mesma pessoa), e o teto por ponto e
// uma decisao de produto, nao de HTTP.
//
// TETO POR PONTO: com 19 pontos a lista de duplas tinha 308 linhas; com o eixo
// do local ela passaria de 1.500, e fila de 1.500 linhas ninguem trabalha. Cada
// ponto entra com os MAX_PARES investidores mais perto — o mesmo 3 que cabe numa
// mensagem de WhatsApp. A aba DIZ que e isso que ela mostra.
// ─────────────────────────────────────────────────────────────────────────────

/** Os 8 últimos dígitos: a mesma chave do resto da casa (`cadTel8` na tela). O 55
 *  e o 9 extra aparecem e somem, e comparar dígito por dígito deixaria a mesma
 *  pessoa virar par DELA MESMA a 0 km, no topo da fila. */
const tel8 = (t: unknown) => soDigitos(t).slice(-8);

export interface ParesDaTela {
  /** ref -> quem está perto dele, em ordem de distância. */
  pares: Record<string, Array<{ ref: string; km: number; proprio: boolean }>>;
  /** As duplas oferecidas: só ponto próprio, MAX_PARES por ponto. */
  matches: Array<{ ponto: string; capital: string; km: number }>;
  /** Refs de quem não tem cidade que dê pra localizar. */
  sem_mapa: string[];
  /** Refs de ponto que não é próprio: está na lista, não vira dupla. */
  sem_dono: string[];
}

/** O cruzamento inteiro, puro: mesma entrada, mesma saída, sem banco. */
export function montarPares(pontos: Candidato[], capital: Candidato[]): ParesDaTela {
  const chave = (c: Candidato) => `${c.tab}:${c.id}`;
  const pares: ParesDaTela['pares'] = {};
  const semMapa: string[] = [];

  const cruzar = (lado: Candidato[], outro: Candidato[]) => {
    for (const eu of lado) {
      if (typeof eu.lat !== 'number') { semMapa.push(chave(eu)); continue; }
      pares[chave(eu)] = outro
        .filter(o => typeof o.lat === 'number' && tel8(o.telefone) !== tel8(eu.telefone))
        .map(o => ({ ref: chave(o), km: distanciaKm(
          { lat: eu.lat!, lng: eu.lng! }, { lat: o.lat!, lng: o.lng! }), proprio: o.proprio }))
        .filter(o => o.km <= TETO_KM)
        .sort((a, b) => a.km - b.km);
    }
  };
  // O investidor ve a vizinhanca INTEIRA, com cada ponto marcado: mandar so os
  // proprios aqui escreveria "0" na celula de quem tem tres inquilinos do lado, e
  // 0 a equipe le como "ninguem por perto". Quem decide dupla e o Match.
  cruzar(capital, pontos);
  // Do lado do ponto e o contrario: quem nao e dono nao recebe lista nenhuma,
  // porque a lista seria a propria indicacao que a regra tirou.
  cruzar(soPontosProprios(pontos), capital);

  const matches: ParesDaTela['matches'] = [];
  for (const p of soPontosProprios(pontos)) {
    for (const o of (pares[chave(p)] || []).slice(0, MAX_PARES)) {
      matches.push({ ponto: chave(p), capital: o.ref, km: o.km });
    }
  }
  matches.sort((a, b) => a.km - b.km);

  return { pares, matches, sem_mapa: semMapa, sem_dono: pontos.filter(p => !p.proprio).map(chave) };
}

export interface Sugestao {
  /** 'ok' tem pares; os outros explicam POR QUE não tem, e isso vai pra mensagem. */
  status: 'ok' | 'longe' | 'sem_mapa' | 'pool_vazio';
  perto: Candidato[];
  /** O mais próximo mesmo estando fora do teto — vira a frase do caso 'longe'. */
  maisProximo?: Candidato;
  motivo?: string;
}

/**
 * Quem do lado `alvo` está perto de `cidadeTexto`.
 * `excluirTelefone` tira a própria pessoa quando ela existe nos dois lados.
 */
export async function sugerirPares(
  cidadeTexto: string | null | undefined,
  alvo: Lado,
  excluirTelefone?: string,
): Promise<Sugestao> {
  const eu = resolverCidade(cidadeTexto);
  // Dica de par E indicacao de match: no lado do ponto vale a regra estreita
  // (soPontosProprios). Um inquilino citado aqui e uma dupla que a tela nao
  // oferece — e a equipe liga sem saber que falta o dono do imovel na conversa.
  const doLado = await pool(alvo);
  const candidatos = (alvo === 'ponto' ? soPontosProprios(doLado) : doLado)
    .filter(c => c.telefone !== soDigitos(excluirTelefone));

  if (!candidatos.length) return { status: 'pool_vazio', perto: [] };

  if (eu.status !== 'ok') {
    // Não sei onde ESTE lead está. O aviso diz isso em vez de calar — é a
    // diferença entre "não tem ninguém perto" e "não consegui medir".
    return { status: 'sem_mapa', perto: [], motivo: eu.motivo };
  }

  const comMapa = candidatos.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number');
  // Tem gente do outro lado, mas de NINGUÉM eu sei a cidade. Não é pool vazio
  // (a frase "ninguém cadastrado ainda" seria mentira com 45 pessoas na base) e
  // não é "longe" (não medi distância nenhuma) — é o mesmo caso de não saber
  // medir, só que do outro lado.
  if (!comMapa.length) {
    return { status: 'sem_mapa', perto: [],
             motivo: `nenhum dos ${candidatos.length} do outro lado tem cidade que eu consiga localizar` };
  }
  for (const c of comMapa) {
    c.km = distanciaKm({ lat: eu.lat!, lng: eu.lng! }, { lat: c.lat!, lng: c.lng! });
  }
  comMapa.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));

  const perto = comMapa.filter(c => (c.km ?? 1e9) <= TETO_KM).slice(0, MAX_PARES);
  if (perto.length) return { status: 'ok', perto };
  return { status: 'longe', perto: [], maisProximo: comMapa[0] };
}

/** "Uberlândia-MG (mesma cidade)" · "Araguari-MG (44 km)" */
function ondeEstá(c: Candidato): string {
  const lugar = c.municipio && c.uf ? `${c.municipio}-${c.uf}` : (c.cidade || '—');
  if (c.km === 0) return `${lugar} (mesma cidade)`;
  return `${lugar} (${c.km} km)`;
}

/**
 * As linhas da dica dentro do aviso. Bloco CONDICIONAL na mesma mensagem —
 * nunca um segundo `sendWhatsApp`: dobrar o toque na linha pra entregar isto
 * seria gastar o dobro pra dizer menos.
 */
export function blocoPares(s: Sugestao, alvo: Lado): string[] {
  // Sem emoji: este bloco entra DENTRO do aviso, e lá o emoji é só da primeira
  // linha (a regra está em montarAvisoPonto). Um símbolo aqui viraria o segundo
  // da mensagem e roubaria o cabeçalho, que é o que separa ponto de investidor.
  // "PROPRIOS" no titulo nao e enfeite: sem ele, quem conhece um inquilino da
  // base le a lista curta como falha de calculo e vai procurar o que nao saiu.
  const titulo = alvo === 'capital' ? '*INVESTIDORES MAIS PERTO*' : '*PONTOS PRÓPRIOS MAIS PERTO*';
  const nada = alvo === 'capital' ? 'investidor' : 'ponto próprio';

  if (s.status === 'ok') {
    return ['', titulo, ...s.perto.map(c =>
      `• ${c.nome} — ${ondeEstá(c)} — wa.me/${c.telefone}${c.daFicha ? ' _(da ficha, nunca falamos)_'
        : c.tab === 'agenda' ? ' _(marcado ARRENDAMENTO na agenda)_' : ''}`)];
  }
  if (s.status === 'longe' && s.maisProximo) {
    return ['', `_O ${nada} mais perto é ${s.maisProximo.nome}, em ${ondeEstá(s.maisProximo)}. `
              + `Longe demais pra chamar de par._`];
  }
  if (s.status === 'sem_mapa') {
    return ['', `_Não consegui localizar a cidade no mapa (${s.motivo || 'sem motivo'}) — sem sugestão de par._`];
  }
  return ['', `_Nenhum ${nada} cadastrado ainda — este lead entra na fila._`];
}

/** Nunca deixa a dica derrubar o aviso: erro aqui vira bloco vazio. */
export async function blocoParesSeguro(
  cidadeTexto: string | null | undefined,
  alvo: Lado,
  excluirTelefone?: string,
): Promise<string[]> {
  try {
    return blocoPares(await sugerirPares(cidadeTexto, alvo, excluirTelefone), alvo);
  } catch (err) {
    logger.error('eletroposto-pares', 'falha montando a dica de pares', err);
    return [];
  }
}
