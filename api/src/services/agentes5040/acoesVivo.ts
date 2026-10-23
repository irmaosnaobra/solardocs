// ─────────────────────────────────────────────────────────────────────────────
// AS PEÇAS DAS AÇÕES DA DUDA NA RODADA VIVA (B1d-2c). Este arquivo NÃO envia mensagem e NÃO importa módulo de
// envio: quem fala com o lead e com o consultor é o vivo.ts (por vivoEnvio, fichaEnvio e agendaEnvio).
//
// O que mora aqui, tudo pequeno e testável:
//  · kwhDoLead: o consumo do lead em kWh (kWh que ele disse primeiro; senão o gasto em reais ÷ TARIFA_KWH, a MESMA
//    conversão do quiz: leadSolarFicha.ts TARIFA_KWH = 1,05 e consumoTipico(…, 'reais'), solarRota.kwhDaFaixa);
//  · cardSolarDe / situacaoDoCard / alvoDaAgenda: com quem a agenda é e em que faixa (:00/:30 novo, :15/:45 remarcação);
//  · ofertaDeHorarios + acharVaga: os horários que vão aos fatos e o casamento EXATO do que a IA escolheu;
//  · camposDeHorario / opcaoPorExtenso / bolhaLigarAgoraOk: os textos curtos das bolhas fixas;
//  · desfazerCardSolar: UPDATE para 'cancelado' (o DELETE em agendamentos foi revogado de anon em 29/09/2026 e a API
//    pode estar com a chave pública), conferido por .select('id') com 1 linha;
//  · lerCardParaFicha: o card como a ficha o lê.
// Telefone cru nunca vai para log nem para texto de bolha.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { TARIFA_KWH, consumoTipico } from '../agenda/leadSolarFicha';
import { temDuasFaixas } from '../agenda/solarRota';
import { consultoraDaFaixa, vagasSolar, type FaixaSolar } from './agendaSolarVagas';
import { produtoDoCard, type CardDaFicha } from './ficha';
import { quandoPorExtenso } from './personas/comum';
import { primeiroNome } from './textosAgenda';
import type { CardResumo } from './tipos';

const LOG = 'acoes-vivo-5040';
const semAcento = (s: unknown): string => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Potência (kWp) NÃO é consumo (kWh): a chave 'potência' e qualquer valor em kWp ficam de fora (correção 11 do B1d-2).
const CHAVE_DE_ENERGIA = /kwh|consumo/;
const VALOR_EM_KWP = /kwp/i;

export { primeiroNome, diaCurto, camposDeHorario, opcaoPorExtenso, citaAHora } from './textosAgenda';

// ── o consumo ────────────────────────────────────────────────────────────────

/**
 * O consumo do lead em kWh, ou null (sem gasto = a Duda não marca sozinha).
 * 1º o que ele disse em kWh (`dados` com consumo/kwh; se o valor vier em reais, converte; kWp nunca entra). 2º o gasto em reais que
 * ele disse (valoresDaPessoa, o 1º citado) ÷ TARIFA_KWH, a conversão do quiz (leadSolarFicha.ts:114 e :178).
 */
export function kwhDoLead(dados: Readonly<Record<string, string>>, valoresReais: readonly number[]): number | null {
  const chaves = Object.keys(dados ?? {}).filter(k => CHAVE_DE_ENERGIA.test(semAcento(k)))
    .sort((a, b) => Number(semAcento(b).includes('kwh')) - Number(semAcento(a).includes('kwh')));
  for (const k of chaves) {
    const v = String(dados[k] ?? '');
    if (VALOR_EM_KWP.test(v)) continue;
    const n = /r\$|reais?/i.test(v) ? consumoTipico(v, 'reais') : consumoTipico(v, 'kwh');
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  for (const v of valoresReais ?? []) if (Number.isFinite(v) && v > 0) return Math.round(v / TARIFA_KWH);
  return null;
}

// ── o card e quem atende ─────────────────────────────────────────────────────

/** O card do SOLAR deste lead (o mais novo pode ser de eletroposto: a Duda não mexe nele). */
export const cardSolarDe = (card: CardResumo | null | undefined): CardResumo | null =>
  card && produtoDoCard(card.created_by) === 'solar' ? card : null;

export type SituacaoCard = 'sem_card' | 'remarcavel' | 'bloqueado';
const STATUS_REMARCAVEIS = ['agendado', 'nao_atendeu'];

/**
 * sem_card: nenhum card do solar, ou o último foi cancelado (a Duda cria um novo).
 * remarcavel: 'agendado' ou 'nao_atendeu' (a Duda remarca o MESMO card).
 * bloqueado: qualquer outro status (negociação, vendido...) é de gente: a Duda passa ao humano, nunca cria card por cima.
 */
export function situacaoDoCard(card: CardResumo | null | undefined): SituacaoCard {
  const c = cardSolarDe(card);
  if (!c) return 'sem_card';
  const st = semAcento(c.status);
  if (st === 'cancelado') return 'sem_card';
  if (!st || STATUS_REMARCAVEIS.includes(st)) return 'remarcavel';
  return 'bloqueado';
}

export interface AlvoAgenda { dono: string; faixa: FaixaSolar; origem: 'card' | 'gasto' }

/**
 * Com quem é a agenda: o vendedor do card que ela vai remarcar; sem card, a faixa de kWh do gasto (consultoraDaFaixa);
 * sem os dois, null (passa ao humano). Quem tem as duas faixas (Nilce e Giovanna) remarca nos :15/:45; sócio só tem a de novo.
 */
export function alvoDaAgenda(card: CardResumo | null | undefined, kwh: number | null): AlvoAgenda | null {
  if (situacaoDoCard(card) === 'remarcavel') {
    const dono = String(cardSolarDe(card)?.vendedor_nome ?? '').trim();
    if (dono) return { dono, faixa: temDuasFaixas(dono) ? 'remarcacao' : 'novo', origem: 'card' };
  }
  if (kwh === null) return null;
  return { dono: consultoraDaFaixa(kwh), faixa: 'novo', origem: 'gasto' };
}

// ── os horários ──────────────────────────────────────────────────────────────

export interface Oferta { alvo: AlvoAgenda | null; vagas: string[] }

/** As próximas vagas (ISO) do alvo. Erro de leitura ou sem alvo = lista vazia: ninguém oferece horário que não leu. */
export async function ofertaDeHorarios(alvo: AlvoAgenda | null, agoraIso: string, n = 4): Promise<Oferta> {
  if (!alvo) return { alvo: null, vagas: [] };
  try {
    const vagas = await vagasSolar({ dono: alvo.dono, caminho: 'ligacao', n, agora: Date.parse(agoraIso), faixa: alvo.faixa });
    return { alvo, vagas: Array.isArray(vagas) ? vagas : [] };
  } catch (err) {
    logger.error(LOG, 'leitura das vagas falhou', err);
    return { alvo, vagas: [] };
  }
}

/** O texto por extenso que vai aos fatos (com o `agora` do turno, para "hoje" e "amanhã" saírem iguais). */
export const horariosPorExtenso = (vagas: readonly string[], agoraIso: string): string[] =>
  vagas.map(v => quandoPorExtenso(v, agoraIso)).filter(Boolean);

const normaliza = (s: unknown): string => semAcento(s).replace(/\s+/g, ' ').replace(/[.\s]+$/, '');

/**
 * O ISO da vaga que o texto da IA nomeia, ou null. Casamento EXATO (depois de tirar acento, caixa e espaço sobrando)
 * com o texto que foi aos fatos: nada de aproximação, porque a bolha já prometeu aquele dia e aquela hora.
 */
export function acharVaga(texto: string | null | undefined, vagas: readonly string[], agoraIso: string): string | null {
  const alvo = normaliza(texto);
  if (!alvo) return null;
  return vagas.find(v => normaliza(quandoPorExtenso(v, agoraIso)) === alvo) ?? null;
}

// ── os textos curtos ─────────────────────────────────────────────────────────

// ── o que fazer quando a bolha do turno é recusada depois de o card ser escrito ──────────────────────────────

export type DestinoDaRecusa = 'fila' | 'fila_reforco' | 'humano';

/**
 * A bolha do turno (confirmação de horário) foi recusada com o card JÁ escrito. Só a recusa PASSAGEIRA vai para a fila de
 * agenda: teto das agentes, teto da linha, prazo, espaçamento, linha pausada e pausa humana. Erro de linha só se a
 * prova é de que nada saiu (cooldown, credencial, reserva que não gravou); 5xx e timeout podem ter chegado, então a fila
 * leva o texto de reforço. O resto (já respondido, robô do outro lado, mudo, bloqueado, bolha inválida, pediu humano,
 * 4xx, erro desconhecido) passa ao humano, sem fila.
 */
export function destinoDaRecusa(res: { motivo: string; detalhe?: string }): DestinoDaRecusa {
  switch (res.motivo) {
    case 'teto_agentes': case 'teto_linha': case 'prazo': case 'espacamento': case 'linha_pausada': case 'pausa_humana':
      return 'fila';
    case 'erro_linha': {
      const d = String(res.detalhe ?? '');
      if (d === 'cooldown' || d === 'credenciais' || d === 'reserva_falhou') return 'fila';
      if (/^http_5\d\d$/.test(d) || d === 'timeout') return 'fila_reforco';
      return 'humano';
    }
    default:
      return 'humano';
  }
}

/** A bolha fixa do "ligar agora" quando a IA não escreveu a dela. null = sem nome da consultora. */
export function bolhaLigarAgoraOk(dono: string): string | null {
  const c = primeiroNome(dono);
  return c ? `A ${c} já recebeu seu pedido e vai ligar em instantes.` : null;
}

/** A observação do card que a Duda cria. A 1ª linha é a marca do quiz (é por ela que o resto do sistema reconhece a ficha). */
export function observacaoDoCardDaDuda(kwh: number | null): string {
  return ['LP SOLAR QUIZ · LIGAÇÃO', 'Origem: conversa com a Duda no WhatsApp', ...(kwh ? [`Consumo: ~${kwh.toLocaleString('pt-BR')} kWh/mês`] : [])].join('\n');
}

// ── o card, na escrita e na leitura ──────────────────────────────────────────

/**
 * Desfaz o card que a Duda criou agora e não pôde sustentar (o aviso à consultora não saiu): status 'cancelado' e uma linha
 * no historico. Não é DELETE de propósito (revogado de anon em 29/09/2026). true SÓ se o banco devolveu a linha atualizada.
 */
export async function desfazerCardSolar(cardId: number): Promise<boolean> {
  try {
    const lido = await supabaseGerador.from('agendamentos').select('id, historico, created_by').eq('id', cardId).maybeSingle();
    if (lido.error || !lido.data) return false;
    const card = lido.data as { historico?: string | null; created_by?: string | null };
    if (card.created_by !== 'lp_solar') return false;
    const carimbo = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·');
    const linha = `[${carimbo} · Sistema] Card desfeito: a Duda não conseguiu avisar a consultora do pedido de ligação imediata.`;
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({ status: 'cancelado', historico: card.historico ? `${linha}\n\n${card.historico}` : linha })
      .eq('id', cardId).eq('created_by', 'lp_solar').select('id');
    return !error && Array.isArray(data) && data.length === 1;
  } catch (err) {
    logger.error(LOG, `desfazer o card ${cardId} falhou`, err);
    return false;
  }
}

// ── orçamento por escrito e ficha da trava (pacote 2b) ───────────────────────

/** A bolha FIXA depois da ficha do orçamento por escrito (a bolha do modelo nunca vai). Cabe nos 160 com o aviso de IA na frente. */
export const BOLHA_ORCAMENTO_ESCRITO = 'Combinado. A consultora monta o seu orçamento por escrito e manda por aqui mesmo.';
/** A 1ª linha da ficha: a consultora não liga, escreve. */
export const TOPO_ORCAMENTO_ESCRITO = 'PEDIU ORÇAMENTO POR ESCRITO, NÃO LIGAR.';
/** Com ligação já marcada no card (reunião futura), a ligação segue de pé e a consultora combina com ele. */
export const TOPO_ORCAMENTO_COM_LIGACAO = 'PEDIU ORÇAMENTO POR ESCRITO. TEM LIGAÇÃO MARCADA: COMBINE COM ELE.';
/** O topo certo da ficha: o card tem reunião futura? */
export const topoDoOrcamentoEscrito = (quandoDoCard: string | null | undefined, agoraMs: number): string =>
  Date.parse(String(quandoDoCard ?? '')) > agoraMs ? TOPO_ORCAMENTO_COM_LIGACAO : TOPO_ORCAMENTO_ESCRITO;

const consumoEmTexto = (kwh: number | null): string => (kwh ? `~${kwh.toLocaleString('pt-BR')} kWh por mês` : '');

/**
 * Os dados que o lead já deu e que a ficha leva ao consultor: cidade, conta de luz (como ele disse) e consumo em kWh. Só entra o que
 * existe. A cidade vem de `dados` primeiro e, depois, das fontes na ordem dada (card, lead do anúncio, cadastro).
 */
export function dadosDoLeadParaFicha(p: {
  dados?: Readonly<Record<string, string>>; cidades?: ReadonlyArray<string | null | undefined>; kwh: number | null;
}): Record<string, string> {
  const limpa = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out: Record<string, string> = {};
  const cidade = [p.dados?.cidade, ...(p.cidades ?? [])].map(c => limpa(c, 60)).find(Boolean);
  if (cidade) out['Cidade'] = cidade;
  const conta = limpa(p.dados?.conta, 60);
  if (conta) out['Conta de luz'] = conta;
  const consumo = consumoEmTexto(p.kwh);
  if (consumo) out['Consumo'] = consumo;
  return out;
}

/** As linhas que a ficha do orçamento por escrito leva (o título e o link da conversa vêm do fichaDeCampos). */
export function linhasDoOrcamentoEscrito(p: { dados: Readonly<Record<string, string>>; temFoto: boolean; comLigacaoMarcada?: boolean }): string[] {
  const d = p.dados;
  return [
    `Pedido: o cliente quer o orçamento por escrito, pelo WhatsApp, e ${p.comLigacaoMarcada ? 'tem ligação marcada' : 'não quer ligação'}`,
    d['Cidade'] ? `Cidade: ${d['Cidade']}` : 'Cidade: não informada',
    ...(d['Consumo'] ? [`Consumo: ${d['Consumo']}`] : []),
    ...(d['Conta de luz'] ? [`Conta de luz: ${d['Conta de luz']}`] : []),
    ...(!d['Consumo'] && !d['Conta de luz'] ? ['Valor da conta: não informado'] : []),
    p.temFoto ? 'Mandou a foto da conta de luz na conversa' : 'Não mandou a foto da conta de luz',
  ];
}

const COLUNAS_FICHA = 'id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade, observacao, created_by, created_at, status';

/** O card como a ficha o lê (com o telefone, que só vai ao celular do consultor). null = não achou ou erro. */
export async function lerCardParaFicha(cardId: number): Promise<CardDaFicha | null> {
  try {
    const { data, error } = await supabaseGerador.from('agendamentos').select(COLUNAS_FICHA).eq('id', cardId).maybeSingle();
    if (error || !data) return null;
    return data as CardDaFicha;
  } catch {
    return null;
  }
}
