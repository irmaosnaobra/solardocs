// ── CLIENTES QUENTES: A PARTE PURA (09/10/2026) ──────────────────────────────
// Pedido do dono: "ensina ao Meta quais os melhores clientes, você tem base dos
// 2 hoje". Aqui mora só a conta: quem é quente, quanto vale e como vira a linha
// do público. Nada de banco, nada de rede. Fica separado do serviço porque é
// aqui que o erro custa caro (ensinar o Meta com cliente frio faz ele caçar mais
// cliente frio por semanas) e é aqui que o teste precisa chegar sem mock.
//
// O valor (R$) vira LOOKALIKE_VALUE no público e `value` no evento. O Meta usa
// como peso: quem vale mais puxa o parecido mais forte. Por isso o valor é uma
// escada de ticket, não um número solto: fechou vale o ticket inteiro, orçamento
// vale um terço, e assim por diante.

import { normFone, normCidade, normUf, separarNome, semAcento, sha256 } from '../../utils/metaCapi';
import type { ProdutoQuente as ProdutoMeta } from '../../utils/metaCapi';
import { TARIFA_KWH, RE_CAMPO_CONSUMO } from '../agenda/leadSolarFicha';

/** Ticket do solar quando a planilha não responde: faixa típica de um sistema residencial. */
export const TICKET_SOLAR_PADRAO = 20000;
/** Ticket do eletroposto: obra média ~R$ 154 mil, arredondada para baixo. Constante
 *  de propósito, não há planilha de venda do eletroposto para tirar média. */
export const TICKET_ELETRO = 150000;

/** Peso de cada status do card, em fração do ticket. Fora do mapa, o card não é quente. */
export const PESO_SOLAR: Readonly<Record<string, number>> = {
  fechou: 1,
  fechou_concorrente: 0.5, // comprou solar em outro lugar: é o mesmo perfil
  fez_orcamento: 0.35,
  proposta_apresentada: 0.35,
  apalavrado: 0.35,
  em_atendimento: 0.2,
};
export const PESO_ELETRO: Readonly<Record<string, number>> = {
  fechou: 1,
  apalavrado: 0.6,
  chave_na_mao: 0.4,
  meio_a_meio: 0.35,
  cotista: 0.3,
  proposta_apresentada: 0.3,
  carregador: 0.2,
  integrador: 0.15,
  arrendamento: 0.15,
  em_atendimento: 0.1,
};

/**
 * O PESO BASE DO LEAD (29/10/2026). Pedido do dono: "aponte no meta todos os leads que virarem cards e meta entenda qual nosso publico e
 * encontre". Todo card que nasceu de um canal de lead entra no PÚBLICO com um peso pequeno, mesmo no status que não tem peso (agendado,
 * confirmado, nao_atendeu...): é isso que mostra ao Meta quem é o nosso público. SÓ o público: o peso base NUNCA gera ClienteQuente nem
 * Purchase (candidatosDeEvento lê pesoDoStatus, que não mudou). O maior valor vence (juntar), então o base nunca rebaixa ninguém.
 */
export const PESO_BASE_SOLAR = 0.1;
export const PESO_BASE_ELETRO = 0.05; // abaixo de em_atendimento (0,1)
/** Os canais de lead. Lista fechada de propósito: cadastro_eletroposto (lote de 298), prosp_*, os testes e os cards criados por gente no /gerador ficam de fora. */
export const ORIGENS_DE_LEAD: ReadonlySet<string> = new Set([
  'lp_solar', 'lp_eletroposto', 'manychat', 'manychat_eletroposto', 'lead-meta', 'agente_eletroposto', 'indicacao',
]);
const STATUS_SEM_PESO_BASE: ReadonlySet<string> = new Set(['cancelado', 'sem_interesse']);

/** O peso base do card, ou null. Só vale para status SEM peso próprio, origem de lead e card que não morreu. */
export function pesoBaseDoCard(produto: ProdutoMeta, createdBy: unknown, status: unknown): number | null {
  if (!ORIGENS_DE_LEAD.has(String(createdBy ?? '').trim().toLowerCase())) return null;
  if (pesoDoStatus(produto, status) != null) return null;
  if (STATUS_SEM_PESO_BASE.has(String(status ?? '').trim().toLowerCase())) return null;
  return produto === 'eletroposto' ? PESO_BASE_ELETRO : PESO_BASE_SOLAR;
}

export const PESO_QUIZ_QUENTE = 0.25;
export const PESO_CONSUMO_ALTO = 0.15;
export const PESO_CAPITAL = 0.2;
export const PESO_NOTA_3 = 0.1;
export const KWH_QUENTE = 900;
export const PONTOS_QUIZ_QUENTE = 80;
/** Lead bom do quiz (03/11/2026): nota de 70 para cima, o mesmo corte do descarte do quiz (abaixo de 70 nem vira card). */
export const PESO_QUIZ_BOM = 0.15;
export const PONTOS_QUIZ_BOM = 70;
export const CAPITAL_MINIMO = 100000;

export const pesoDoStatus = (produto: ProdutoMeta, status: unknown): number | null => {
  const tab = produto === 'eletroposto' ? PESO_ELETRO : PESO_SOLAR;
  const k = String(status ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(tab, k) ? tab[k] : null;
};

export const ehTeste = (nome: unknown): boolean => semAcento(nome).includes('teste');

// ── Consumo ──────────────────────────────────────────────────────────────────

/** Converte "1.100" e "300,00" em número. Ponto seguido de 3 dígitos é milhar. */
function numeros(texto: string): number[] {
  const achados = texto.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g) || [];
  return achados.map(n => Number(n.replace(/\./g, '').replace(',', '.'))).filter(n => Number.isFinite(n));
}

/**
 * O consumo respondido, em número. Os rótulos vêm de três formulários que nunca
 * combinaram (Forms do Meta, DM, quiz), então a regra é por forma, não por campo:
 *  • "~N kWh" no texto (rótulo do quiz): N, é o dado mais exato que existe;
 *  • "mais de N" / "acima de N": N + 50, porque a faixa de cima é aberta;
 *  • "+ N": N (o próprio piso);
 *  • "A a B" ou "A ~ B": o meio da faixa;
 *  • número solto: ele mesmo.
 * Sem número, null (lead sem informação não é quente nem frio).
 */
export function consumoKwh(bruto: unknown): number | null {
  const t = String(bruto ?? '').trim();
  if (!t) return null;
  const kwh = /~\s*(\d[\d.]*)\s*kwh/i.exec(t);
  if (kwh) {
    const n = Number(kwh[1].replace(/\./g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const ns = numeros(t);
  if (!ns.length) return null;
  let v: number;
  if (/mais[_\s]*de|acima/i.test(t)) v = ns[0] + 50;
  else if (t.includes('+')) v = ns[0];
  else if (ns.length >= 2) v = (ns[0] + ns[1]) / 2;
  else v = ns[0];
  // Valor em REAIS ("R$", sem kWh explícito) vira kWh pela tarifa da casa: ler
  // R$ 900 como 900 kWh poria conta pequena na lista de quentes.
  return /r\$/i.test(t) ? Math.round(v / TARIFA_KWH) : v;
}

export const consumoEhAlto = (bruto: unknown): boolean => (consumoKwh(bruto) ?? 0) >= KWH_QUENTE;

// ── Capital da parceria ──────────────────────────────────────────────────────

/** "R$ 50 mil a R$ 100 mil" vira 50000 (limite de baixo da faixa). "Depende do ponto" vira null. */
export function valorCapital(bruto: unknown): number | null {
  const t = semAcento(bruto);
  const m = /(\d+(?:[.,]\d+)?)\s*(milhoes|milhao|mil|k)?/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[2] ? (m[2].startsWith('milh') ? 1_000_000 : 1000) : 1;
  const v = n * mult;
  return v >= 1000 ? v : null;
}

// ── Planilha Mestre ──────────────────────────────────────────────────────────

/** `codigo` é o número do `#NNNN` da coluna A e `data` a "Data da venda" (CADASTRO TRELLO) em AAAA-MM-DD: só o valorDaVenda os lê. */
export interface VendaPlanilha { nome: string; telefone: string; cidade: string; uf: string; valor: number; codigo?: number | null; data?: string | null }

/** "#0065", "0065" e "#65" viram 65. Só a série solar (dígitos); `#E001` e texto viram null. */
export function numeroDoCodigoSolar(bruto: unknown): number | null {
  const m = /^\s*#?\s*(\d+)(?!\d)/.exec(String(bruto ?? ''));
  return m ? Number(m[1]) : null;
}

/** "25/10/2026" ou "2026-10-25" viram AAAA-MM-DD; o resto, null. */
export function dataDaPlanilha(bruto: unknown): string | null {
  const t = String(bruto ?? '').trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  const [a, m, d] = br ? [br[3], br[2].padStart(2, '0'), br[1].padStart(2, '0')] : (/^(\d{4})-(\d{2})-(\d{2})/.exec(t) ?? []).slice(1);
  if (!a) return null;
  const iso = `${a}-${m}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "R$ 6.990,00" vira 6990. */
export function valorBR(s: unknown): number {
  const n = parseFloat(String(s ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lê as vendas da planilha. As colunas são achadas pelo NOME do cabeçalho. A
 * célula A1 está quebrada hoje ("J49" no lugar de "CODIGO"), então linha de venda
 * é a que começa com "#<número>" na primeira coluna, não a que bate com A1.
 */
export function lerPlanilha(linhas: string[][]): { vendas: VendaPlanilha[]; ticket: number; teto?: number | null } {
  const hIdx = linhas.slice(0, 5).findIndex(r => r.some(c => c.trim().toUpperCase() === 'NOME CLIENTE'));
  if (hIdx < 0) return { vendas: [], ticket: TICKET_SOLAR_PADRAO };
  const cab = linhas[hIdx].map(c => c.trim().toUpperCase());
  const i = (nome: string) => cab.indexOf(nome);
  const [iNome, iFone, iCidade, iUf, iValor, iData] = ['NOME CLIENTE', 'CONTATO', 'CIDADE', 'UF', 'VALOR DA VENDA', 'CADASTRO TRELLO'].map(i);
  const cel = (r: string[], k: number) => (k >= 0 ? String(r[k] ?? '').trim() : '');
  const vendas: VendaPlanilha[] = [];
  for (const r of linhas.slice(hIdx + 1)) {
    if (!/^#\d+/.test(String(r[0] ?? '').trim())) continue;
    vendas.push({
      nome: cel(r, iNome), telefone: cel(r, iFone), cidade: cel(r, iCidade),
      uf: cel(r, iUf), valor: valorBR(cel(r, iValor)),
      codigo: numeroDoCodigoSolar(r[0]), data: dataDaPlanilha(cel(r, iData)),
    });
  }
  // Teto de 3× a mediana em cada venda. Uma venda de R$ 380 mil entre vendas de
  // R$ 7 a 30 mil puxava sozinha o ticket médio (e com ele o valor de todo
  // ClienteQuente e Purchase do solar) e pesava como dezenas de clientes no
  // público com valor, ensinando o Meta a caçar um perfil que é exceção.
  const ordenados = vendas.map(v => v.valor).filter(v => v > 0).sort((a, b) => a - b);
  let teto: number | null = null;
  if (ordenados.length) {
    const meio = Math.floor(ordenados.length / 2);
    const mediana = ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
    teto = Math.round(mediana * TETO_VENDA_MEDIANAS);
    for (const v of vendas) if (v.valor > teto) v.valor = teto;
  }
  const comValor = vendas.filter(v => v.valor > 0);
  const ticket = comValor.length
    ? Math.round(comValor.reduce((a, v) => a + v.valor, 0) / comValor.length)
    : TICKET_SOLAR_PADRAO;
  return { vendas, ticket, teto };
}

/** Quantas medianas uma venda pode valer, no máximo (ver lerPlanilha). */
export const TETO_VENDA_MEDIANAS = 3;

// ── A lista de quentes ───────────────────────────────────────────────────────

export interface Quente {
  telefone: string; // normFone, com 55
  nome: string;
  cidade: string;
  uf: string;
  valor: number;
  motivo: string;
}
export type ListaQuentes = Map<string, Quente>;

const melhorNome = (a: string, b: string): string => {
  const pa = a.trim().split(/\s+/).filter(Boolean).length;
  const pb = b.trim().split(/\s+/).filter(Boolean).length;
  return pb > pa ? b.trim() : (a.trim() || b.trim());
};

/** Junta por telefone: fica o MAIOR valor (com o motivo que o deu) e o melhor nome/cidade. */
export function juntar(lista: ListaQuentes, p: { telefone: unknown; nome?: unknown; cidade?: unknown; uf?: unknown; valor: number; motivo: string }): void {
  const fone = normFone(p.telefone);
  if (!fone || ehTeste(p.nome)) return;
  const valor = Math.max(1, Math.round(p.valor));
  const nome = String(p.nome ?? '');
  const cidade = String(p.cidade ?? '').trim();
  const uf = String(p.uf ?? '').trim();
  const at = lista.get(fone);
  if (!at) { lista.set(fone, { telefone: fone, nome: nome.trim(), cidade, uf, valor, motivo: p.motivo }); return; }
  at.nome = melhorNome(at.nome, nome);
  at.cidade = at.cidade || cidade;
  at.uf = at.uf || uf;
  if (valor > at.valor) { at.valor = valor; at.motivo = p.motivo; }
}

export interface AgCard {
  id: number;
  cliente_nome?: string | null;
  cliente_telefone?: string | null;
  cidade?: string | null;
  status?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  nota?: unknown;
  capital_faixa?: string | null;
}
export interface LeadMeta {
  lead_id?: string | null;
  nome?: string | null;
  whatsapp?: string | null;
  cidade?: string | null;
  field_data?: Array<{ name?: string; values?: unknown[] }> | null;
}
export interface Parceria { lado?: string | null; nome?: string | null; telefone?: string | null; cidade?: string | null; capital_faixa?: string | null }

export const campo = (fd: LeadMeta['field_data'], ...nomes: string[]): string => {
  const alvo = nomes.map(n => n.toLowerCase());
  const f = (Array.isArray(fd) ? fd : []).find(x => alvo.includes(String(x?.name ?? '').trim().toLowerCase()));
  const v = f?.values?.[0];
  return v == null ? '' : String(v);
};

/** O consumo do lead: "Consumo"/"Consuma" (quiz e DM) ou o rótulo longo do formulário do Meta. */
export const campoConsumo = (fd: LeadMeta['field_data']): string => {
  const f = (Array.isArray(fd) ? fd : []).find(x => RE_CAMPO_CONSUMO.test(String(x?.name ?? '').toLowerCase().trim()));
  const v = f?.values?.[0];
  return v == null ? '' : String(v);
};

/** Pontos do quiz: o campo é só o número ("85"). */
export const pontosDoLead = (fd: LeadMeta['field_data']): number | null => {
  const n = parseInt(campo(fd, 'Pontos'), 10);
  return Number.isFinite(n) ? n : null;
};

export function listaSolar(a: { cards: AgCard[]; leads: LeadMeta[]; vendas: VendaPlanilha[]; ticket: number; ehEletro: (c: unknown) => boolean }): ListaQuentes {
  const L: ListaQuentes = new Map();
  const T = a.ticket;
  for (const v of a.vendas) {
    juntar(L, { telefone: v.telefone, nome: v.nome, cidade: v.cidade, uf: v.uf, valor: v.valor > 0 ? v.valor : T, motivo: 'venda_planilha' });
  }
  for (const c of a.cards) {
    if (a.ehEletro(c.created_by)) continue;
    const peso = pesoDoStatus('solar', c.status);
    if (peso == null) {
      const base = pesoBaseDoCard('solar', c.created_by, c.status);
      if (base != null) juntar(L, { telefone: c.cliente_telefone, nome: c.cliente_nome, cidade: c.cidade, valor: base * T, motivo: 'card_de_lead' });
      continue;
    }
    juntar(L, { telefone: c.cliente_telefone, nome: c.cliente_nome, cidade: c.cidade, valor: peso * T, motivo: String(c.status) });
  }
  for (const l of a.leads) {
    const fd = l.field_data;
    const base = { telefone: l.whatsapp, nome: l.nome, cidade: l.cidade };
    if (String(l.lead_id ?? '').startsWith('quiz_')) {
      const pts = pontosDoLead(fd);
      if (pts != null && pts >= PONTOS_QUIZ_BOM && campo(fd, 'Caminho').trim().toLowerCase() !== 'curioso') {
        if (pts >= PONTOS_QUIZ_QUENTE) juntar(L, { ...base, valor: PESO_QUIZ_QUENTE * T, motivo: 'quiz_pontos_80' });
        else juntar(L, { ...base, valor: PESO_QUIZ_BOM * T, motivo: 'quiz_pontos_70' });
      }
    }
    if (consumoEhAlto(campoConsumo(fd))) {
      juntar(L, { ...base, valor: PESO_CONSUMO_ALTO * T, motivo: 'consumo_900kwh' });
    }
  }
  return L;
}

export function listaEletroposto(a: { cards: AgCard[]; parceria: Parceria[]; ehEletro: (c: unknown) => boolean }): ListaQuentes {
  const L: ListaQuentes = new Map();
  const T = TICKET_ELETRO;
  for (const c of a.cards) {
    if (!a.ehEletro(c.created_by)) continue;
    const base = { telefone: c.cliente_telefone, nome: c.cliente_nome, cidade: c.cidade };
    const peso = pesoDoStatus('eletroposto', c.status);
    if (peso != null) juntar(L, { ...base, valor: peso * T, motivo: String(c.status) });
    else {
      const pb = pesoBaseDoCard('eletroposto', c.created_by, c.status);
      if (pb != null) juntar(L, { ...base, valor: pb * T, motivo: 'card_de_lead' });
    }
    if (Number(c.nota) === 3) juntar(L, { ...base, valor: PESO_NOTA_3 * T, motivo: 'nota_3' });
  }
  for (const p of a.parceria) {
    if (String(p.lado ?? '').trim().toLowerCase() !== 'capital') continue;
    const cap = valorCapital(p.capital_faixa);
    if (cap != null && cap >= CAPITAL_MINIMO) {
      juntar(L, { telefone: p.telefone, nome: p.nome, cidade: p.cidade, valor: PESO_CAPITAL * cap, motivo: 'parceria_capital' });
    }
  }
  return L;
}

// ── O valor real da venda (03/11/2026) ───────────────────────────────────────
// Pedido do dono: "todos que virar venda, informa ao meta qual lead, assim vamos apurando os melhores". O Purchase ia com o ticket
// médio da planilha; com o valor da venda o Meta aprende quem compra mais. Na dúvida, o ticket de hoje: valor errado ensina o
// Meta errado, e o ticket é o que sempre foi.
//
// Ordem de confiança (a primeira que casa SEM ambiguidade vence):
//   1. planilha, pelo MESMO código: o `#NNNN` da ligação assinada do card (`venda_solar:<card>`) tem uma única linha, com valor > 0;
//   2. a proposta ligada ao card (`propostas.valor_vendido`, a que o consultor marcou como vendida): existe na hora do `fechou`,
//      quando a linha da planilha costuma chegar atrasada;
//   3. planilha, pelo TELEFONE: só quando o card não tem código, o telefone tem UMA venda na planilha e UM card fechado, a venda é
//      recente, ninguém mais ligou aquele código e o nome é compatível. Família usa o mesmo número (o pai e o filho): telefone
//      sozinho NUNCA escolhe valor.
// Todo valor passa pelo MESMO teto do público (3× a mediana da planilha). Sem planilha lida não há teto, então não há valor.
// Eletroposto fica no ticket: não há fonte de valor ligada ao card que a gente confie hoje.

/** A venda da planilha só vale para o telefone se for dos últimos N dias (a do card que acabou de fechar). */
export const JANELA_VENDA_RECENTE_DIAS = 60;

export type OrigemDoValor = 'planilha_codigo' | 'proposta' | 'planilha_telefone' | 'ticket';

export interface FontesDeValor {
  /** O ticket do solar de hoje (média da planilha). O do eletroposto é TICKET_ELETRO. */
  ticket: number;
  ehEletro: (createdBy: unknown) => boolean;
  /** A planilha lida. `ok` falso, ou sem `teto`, quer dizer que não há planilha para conferir: tudo vira ticket. */
  planilha: { ok: boolean; vendas: readonly VendaPlanilha[]; teto?: number | null } | null;
  /** card -> números `#NNNN` das ligações ASSINADAS (de todos os cards: serve também para saber quem já é dono de um código). */
  codigosDoCard: ReadonlyMap<number, readonly number[]>;
  /** card -> `valor_vendido` da proposta ligada (a proposta só ligada a este card, marcada como vendida). */
  valorDaProposta: ReadonlyMap<number, number>;
  /** Todos os cards, só para saber se o telefone tem mais de um card fechado. */
  cards: readonly AgCard[];
  agora?: number;
}

const PARTICULAS_DO_NOME: ReadonlySet<string> = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
/** O sufixo marca OUTRA pessoa da família: "Hermantino Silva Filho" não é o "Hermantino Silva". */
const SUFIXOS_DO_NOME: ReadonlySet<string> = new Set(['filho', 'junior', 'jr', 'neto', 'sobrinho']);

const palavrasDoNome = (n: unknown): string[] =>
  semAcento(n).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(p => p && !PARTICULAS_DO_NOME.has(p));

/**
 * Os dois nomes são da mesma pessoa? Nome igual (sem acento, sem partículas), OU pelo menos duas palavras em comum, e nos dois casos
 * com o MESMO sufixo (filho, junior, jr, neto, sobrinho): quem tem sufixo que o outro não tem é outra pessoa. Primeiro nome sozinho
 * não basta: na dúvida, ticket.
 */
export function nomesCompativeis(a: unknown, b: unknown): boolean {
  const [pa, pb] = [palavrasDoNome(a), palavrasDoNome(b)];
  if (!pa.length || !pb.length) return false;
  const sufixos = (p: string[]) => [...new Set(p.filter(w => SUFIXOS_DO_NOME.has(w)))].sort().join(',');
  if (sufixos(pa) !== sufixos(pb)) return false;
  const [ua, ub] = [[...new Set(pa)], [...new Set(pb)]];
  if (ua.length === ub.length && ua.every(w => ub.includes(w))) return true;
  const comuns = ua.filter(w => !SUFIXOS_DO_NOME.has(w) && ub.includes(w));
  return comuns.length >= 2;
}

/**
 * O PISO DO VALOR. O campo "valor da venda" do /gerador é type="number": quem digita "145.000" grava 145, e o Meta receberia um
 * Purchase de R$ 145. Valor abaixo de teto/30 (ou de ticket/10, se não há teto) é digitação errada: vale o ticket.
 */
export const DIVISOR_PISO_DO_TETO = 30;
export const DIVISOR_PISO_DO_TICKET = 10;
export const pisoDoValor = (teto: number | null | undefined, ticket: number): number =>
  typeof teto === 'number' && Number.isFinite(teto) && teto > 0 ? teto / DIVISOR_PISO_DO_TETO : ticket / DIVISOR_PISO_DO_TICKET;

const finitoPositivo = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function valorDaVenda(card: AgCard, f: FontesDeValor): { valor: number; origem: OrigemDoValor } {
  const eletro = f.ehEletro(card.created_by);
  const doTicket = { valor: Math.round(eletro ? TICKET_ELETRO : f.ticket), origem: 'ticket' as const };
  const pl = f.planilha;
  const teto = pl?.teto;
  if (eletro || !pl || !pl.ok || !finitoPositivo(teto)) return doTicket;
  const piso = pisoDoValor(teto, f.ticket);
  const aceita = (v: unknown): v is number => finitoPositivo(v) && v >= piso;
  const limitado = (v: number) => ({ valor: Math.round(Math.min(v, teto)) });

  // 1. o mesmo código
  const codigos = [...new Set(f.codigosDoCard.get(card.id) ?? [])];
  if (codigos.length > 1) return doTicket; // dois códigos para o mesmo card: dúvida
  if (codigos.length === 1) {
    const linhas = pl.vendas.filter(v => v.codigo === codigos[0]);
    if (linhas.length > 1) return doTicket; // o código repetido na planilha: dúvida
    if (linhas.length === 1) {
      return aceita(linhas[0].valor) ? { ...limitado(linhas[0].valor), origem: 'planilha_codigo' } : doTicket;
    }
  }

  // 2. a proposta ligada
  const daProposta = f.valorDaProposta.get(card.id);
  if (daProposta !== undefined) return aceita(daProposta) ? { ...limitado(daProposta), origem: 'proposta' } : doTicket;

  // 3. o telefone, com todas as travas. Card que já tem código não cai aqui: a linha dele ainda não chegou à planilha.
  if (codigos.length) return doTicket;
  const fone = normFone(card.cliente_telefone);
  if (!fone) return doTicket;
  const vendasDoFone = pl.vendas.filter(v => normFone(v.telefone) === fone);
  if (vendasDoFone.length !== 1) return doTicket;
  const venda = vendasDoFone[0];
  const donos = new Set<number>();
  for (const lista of f.codigosDoCard.values()) for (const c of lista) donos.add(c);
  if (venda.codigo == null || donos.has(venda.codigo)) return doTicket; // a linha é de outro card (ou não tem número)
  const fechadosDoFone = f.cards.filter(c =>
    !f.ehEletro(c.created_by) && String(c.status ?? '').trim().toLowerCase() === 'fechou' && normFone(c.cliente_telefone) === fone);
  if (fechadosDoFone.length !== 1 || fechadosDoFone[0].id !== card.id) return doTicket; // o mesmo número em mais de um card
  if (!venda.data) return doTicket;
  const dias = ((f.agora ?? Date.now()) - Date.parse(`${venda.data}T12:00:00Z`)) / 86_400_000;
  if (!(dias >= -2 && dias <= JANELA_VENDA_RECENTE_DIAS)) return doTicket;
  if (!nomesCompativeis(venda.nome, card.cliente_nome)) return doTicket;
  return aceita(venda.valor) ? { ...limitado(venda.valor), origem: 'planilha_telefone' } : doTicket;
}

// ── Payload do público ───────────────────────────────────────────────────────

export const ESQUEMA_PUBLICO = ['PHONE', 'FN', 'LN', 'CT', 'ST', 'COUNTRY', 'LOOKALIKE_VALUE'] as const;
const h = (s: string): string => (s ? sha256(s) : '');

/** Uma linha do público. Tudo hasheado, menos o valor (o Meta lê o número em texto puro). */
export function linhaPublico(q: Quente): Array<string | number> {
  const { fn, ln } = separarNome(q.nome);
  const st = normUf(q.uf) || normUf(q.cidade);
  return [sha256(q.telefone), h(fn), h(ln), h(normCidade(q.cidade)), h(st), sha256('br'), q.valor];
}

export const LOTE_PUBLICO = 10000;

/** Quebra a lista em lotes de sessão do Meta: batch_seq de 1 em diante, last_batch_flag só no último. */
export function lotesPublico(lista: Quente[], sessionId: number, tam = LOTE_PUBLICO) {
  const lotes: Array<{ payload: { schema: readonly string[]; data: Array<Array<string | number>> }; session: Record<string, unknown> }> = [];
  const n = lista.length;
  const total = Math.max(1, Math.ceil(n / tam));
  for (let k = 0; k < total; k++) {
    lotes.push({
      payload: { schema: ESQUEMA_PUBLICO, data: lista.slice(k * tam, (k + 1) * tam).map(linhaPublico) },
      session: { session_id: sessionId, batch_seq: k + 1, last_batch_flag: k === total - 1, estimated_num_total: n },
    });
  }
  return lotes;
}

export const mascararFone = (f: string): string => '*'.repeat(Math.max(0, f.length - 4)) + f.slice(-4);

export function previa(lista: ListaQuentes) {
  const porMotivo: Record<string, number> = {};
  for (const q of lista.values()) porMotivo[q.motivo] = (porMotivo[q.motivo] || 0) + 1;
  const amostra = [...lista.values()].sort((a, b) => b.valor - a.valor).slice(0, 5)
    .map(q => ({ telefone: mascararFone(q.telefone), nome: q.nome, cidade: q.cidade, valor: q.valor, motivo: q.motivo }));
  return { pessoas: lista.size, porMotivo, amostra };
}
