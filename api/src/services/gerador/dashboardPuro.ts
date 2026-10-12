// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD DO /GERADOR: a conta pura (sem banco, sem rede, sem relógio).
//
// Quem lê o banco e a planilha é a rota (routes/geradorDashboard.ts). Aqui entram
// os dados BRUTOS e o instante ("agora" injetável) e sai o JSON de cada tela.
//
// UMA FONTE POR NÚMERO. Cada número vem da mesma fonte da tela para onde ele
// leva: obras e a receber saem de `resumirObras`/`montarObra` (Planilha Mestre),
// venda de solar é linha da planilha, venda de eletroposto é card `fechou` com o
// registro de pós-venda. Nunca se soma fonte diferente num número só.
//
// DIA E MÊS SÃO DE BRASÍLIA (UTC-3). O servidor roda em UTC e 22h de Brasília já
// é o dia seguinte lá: toda data civil passa por `diaBRT`/`hojeBRT`.
//
// DINHEIRO: a conta é feita para quem pede. Para consultor comum as chaves de
// valor NEM EXISTEM no objeto devolvido (não são zeradas nem escondidas).
// Nada aqui muta o que recebe: o dado bruto fica em cache e é compartilhado.
// ─────────────────────────────────────────────────────────────────────────────
import { diaBRT, campoDoLead, type PainelQuizSolar } from '../io/painelQuizSolarPuro';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { hojeBRT, montarObra, resumirObras, podeVer, nomeSimples, type ObraBruta } from './solarObras';

// ── Status ───────────────────────────────────────────────────────────────────

/** Esperando a reunião acontecer (ou ser remarcada). */
export const AGUARDANDO = ['agendado', 'reagendar'];
/** A conversa acabou: ganhou, perdeu ou desistiu. */
export const RESOLVIDOS = ['sem_interesse', 'fechou', 'fechou_concorrente', 'perdido'];
/** Conversa viva e andando: já houve proposta, orçamento ou modelo escolhido. */
export const NEGOCIACAO = [
  'fez_orcamento', 'proposta_apresentada', 'em_atendimento', 'falando_whatsapp', 'chave_na_mao',
  'meio_a_meio', 'carregador', 'cotista', 'integrador', 'arrendamento', 'apalavrado',
];

const status = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export type GrupoAgenda = 'aguardando' | 'retornos' | 'resolvidos';

/** Grupo do card na agenda. `cancelado` fica fora de tudo (é o mesmo filtro da
 *  página da agenda). Status desconhecido é retorno: vivo por padrão. */
export function grupoDaAgenda(st: unknown): GrupoAgenda | null {
  const s = status(st);
  if (s === 'cancelado') return null;
  if (AGUARDANDO.includes(s)) return 'aguardando';
  if (RESOLVIDOS.includes(s)) return 'resolvidos';
  return 'retornos';
}

export type Familia = 'solar' | 'eletroposto';
/** ELETROPOSTO é a família nomeada no `created_by`; SOLAR é todo o resto, inclusive nulo. */
export const familiaDe = (createdBy: unknown): Familia => (ehOrigemEletroposto(createdBy) ? 'eletroposto' : 'solar');

// ── Dias de Brasília ─────────────────────────────────────────────────────────

const DIA_MS = 86_400_000;

export function somaDias(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
}

/** Todos os dias de `de` a `ate`, inclusive. Sem o teto de 31 dias de
 *  `diasDoPeriodo`: o período de 90 dias precisa dos 90. */
export function listaDeDias(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = de; d <= ate && dias.length < 400; d = somaDias(d, 1)) dias.push(d);
  return dias;
}

/** HH:MM de Brasília de um instante em ms. */
export function horaBRT(ms: number): string {
  return new Date(ms - 3 * 3600_000).toISOString().slice(11, 16);
}

export type ChavePeriodo = 'mes' | '30dias' | '90dias';
export const PERIODOS_DASHBOARD: ChavePeriodo[] = ['mes', '30dias', '90dias'];
const ROTULOS: Record<ChavePeriodo, string> = { mes: 'Este mês', '30dias': 'Últimos 30 dias', '90dias': 'Últimos 90 dias' };

/** Valor inválido cai em `mes`. */
export function chaveDoPeriodo(pedido: unknown): ChavePeriodo {
  const p = String(pedido ?? '').trim();
  return (PERIODOS_DASHBOARD as string[]).includes(p) ? (p as ChavePeriodo) : 'mes';
}

export interface Periodo { chave: ChavePeriodo; de: string; ate: string; rotulo: string }

/** `mes` = do dia 1 do mês corrente até hoje; os outros, N dias corridos até hoje, inclusive. */
export function periodoDe(chave: ChavePeriodo, hoje: string): Periodo {
  const de = chave === 'mes' ? `${hoje.slice(0, 8)}01` : somaDias(hoje, -(chave === '30dias' ? 29 : 89));
  return { chave, de, ate: hoje, rotulo: ROTULOS[chave] };
}

/** Os `n` últimos meses de calendário (AAAA-MM), o corrente por último. */
export function mesesRecentes(hoje: string, n = 6): string[] {
  const [a, m] = hoje.split('-').map(Number);
  const meses: string[] = [];
  for (let i = n - 1; i >= 0; i--) meses.push(new Date(Date.UTC(a, m - 1 - i, 1)).toISOString().slice(0, 7));
  return meses;
}

// ── Tipos de entrada ─────────────────────────────────────────────────────────

export interface CardBruto {
  id: number; quando: string | null; status: string | null;
  vendedor_nome: string | null; cliente_nome: string | null; cidade: string | null;
  created_at: string | null; created_by: string | null;
}
export interface PropostaBruta { consultor_nome: string | null; created_at: string | null }
export interface LeadQuizBruto {
  lead_id: string | null; created_time: string | null; field_data: unknown;
  agendado_id?: unknown; consultor?: string | null;
}
export interface DashboardBruto { cards: CardBruto[]; propostas: PropostaBruta[]; leads: LeadQuizBruto[] }
export interface Quem { nome: string; socio: boolean }

const ms = (iso: unknown): number => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? t : NaN;
};

/** Consultor comum só enxerga o que é dele (nome sem acento e sem caixa do lado do dado). */
export function cortarCards(cards: CardBruto[], q: Quem): CardBruto[] {
  return q.socio ? cards : cards.filter((c) => podeVer(q.nome, c.vendedor_nome ?? ''));
}

/** "Ana Souza Lima" vira "Ana L."; um nome só fica como está. Nunca telefone:
 *  cadastro sem nome guarda o número, às vezes formatado ("(34) 99999-1234"),
 *  então contam-se os dígitos do texto inteiro: 7 ou mais vira "Cliente". */
export function nomeAbreviado(nome: unknown): string {
  const bruto = String(nome ?? '').trim();
  if (bruto.replace(/\D/g, '').length >= 7) return 'Cliente';
  // Só palavra feita de letra: pedaço com número ("Ana99812"), e-mail ou "Tel:" fica de fora.
  const p = bruto.split(/\s+/).filter((x) => /^\p{L}[\p{L}'’.-]*$/u.test(x));
  if (!p.length) return 'Cliente';
  if (p.length === 1) return p[0];
  return `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}

const rotuloConsultor = (n: unknown): string => String(n ?? '').trim() || 'Sem consultor';
const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

// ── Agenda ───────────────────────────────────────────────────────────────────

interface ContagemDia { total: number; aguardando: number; retornos: number; resolvidos: number }
const zeroDia = (): ContagemDia => ({ total: 0, aguardando: 0, retornos: 0, resolvidos: 0 });

function cardsDoDia(cards: CardBruto[], dia: string): CardBruto[] {
  return cards.filter((c) => c.quando && diaBRT(c.quando) === dia && grupoDaAgenda(c.status) !== null);
}

function somarDia(acc: ContagemDia, c: CardBruto): void {
  const g = grupoDaAgenda(c.status) as GrupoAgenda;
  acc[g]++;
  acc.total++;
}

export function montarAgendaHoje(cards: CardBruto[], hoje: string, agora: Date) {
  const doDia = cardsDoDia(cards, hoje);
  const total = zeroDia();
  const linhas = new Map<string, { consultor: string; c: ContagemDia; proximoMs: number }>();
  const t0 = agora.getTime();
  for (const c of doDia) {
    somarDia(total, c);
    const chave = nomeSimples(c.vendedor_nome);
    const l = linhas.get(chave) || { consultor: rotuloConsultor(c.vendedor_nome), c: zeroDia(), proximoMs: Infinity };
    somarDia(l.c, c);
    const t = ms(c.quando);
    if (grupoDaAgenda(c.status) !== 'resolvidos' && t >= t0 && t < l.proximoMs) l.proximoMs = t;
    linhas.set(chave, l);
  }
  // Os próximos: a partir de 15 minutos atrás, para o atraso curto não sumir da tela.
  const proximos = doDia
    .filter((c) => grupoDaAgenda(c.status) !== 'resolvidos' && ms(c.quando) >= t0 - 15 * 60_000)
    .sort((a, b) => ms(a.quando) - ms(b.quando) || a.id - b.id)
    .slice(0, 8)
    .map((c) => ({
      id: c.id,
      hora: horaBRT(ms(c.quando)),
      cliente: nomeAbreviado(c.cliente_nome),
      consultor: rotuloConsultor(c.vendedor_nome),
      produto: familiaDe(c.created_by),
      grupo: grupoDaAgenda(c.status) === 'aguardando' ? 'aguardando' : 'retorno',
      status: status(c.status),
      cidade: String(c.cidade ?? '').trim() || null,
    }));
  const amanhaDia = zeroDia();
  for (const c of cardsDoDia(cards, somaDias(hoje, 1))) somarDia(amanhaDia, c);
  return {
    total: total.total, aguardando: total.aguardando, retornos: total.retornos, resolvidos: total.resolvidos,
    porConsultor: [...linhas.values()].sort((a, b) => porNome(a.consultor, b.consultor)).map((l) => ({
      consultor: l.consultor, aguardando: l.c.aguardando, retornos: l.c.retornos, resolvidos: l.c.resolvidos,
      proximo: Number.isFinite(l.proximoMs) ? horaBRT(l.proximoMs) : null,
    })),
    proximos,
    amanha: { total: amanhaDia.total, aguardando: amanhaDia.aguardando, retornos: amanhaDia.retornos },
  };
}

// ── Pendências ───────────────────────────────────────────────────────────────

/** Agendado que já passou do dia e ninguém resolveu. */
export function montarVencidos(cards: CardBruto[], hoje: string) {
  const vencidos = cards.filter((c) => c.quando && AGUARDANDO.includes(status(c.status)) && diaBRT(c.quando) < hoje && diaBRT(c.quando) !== '');
  let maisAntigo = '';
  const r = { total: vencidos.length, maisAntigoDias: 0, solar: 0, eletroposto: 0 };
  for (const c of vencidos) {
    r[familiaDe(c.created_by)]++;
    const d = diaBRT(c.quando);
    if (!maisAntigo || d < maisAntigo) maisAntigo = d;
  }
  if (maisAntigo) r.maisAntigoDias = diasEntre(maisAntigo, hoje);
  return r;
}

/** Lead do quiz que respondeu e ficou sem horário, nos últimos 7 dias. O filtro
 *  de prefixo e de `agendado_id` se repete aqui porque o `_` do LIKE é curinga e
 *  porque o dado em cache já veio do banco. */
export function montarQuizSemHorario(leads: LeadQuizBruto[], q: Quem, agora: Date) {
  const desde = agora.getTime() - 7 * DIA_MS;
  let total = 0;
  for (const l of leads) {
    if (!String(l.lead_id ?? '').startsWith('quiz_')) continue;
    const t = ms(l.created_time);
    if (!(t >= desde)) continue;
    if (l.agendado_id !== null && l.agendado_id !== undefined && l.agendado_id !== '') continue;
    if (campoDoLead(l.field_data, 'Caminho').toLowerCase() === 'curioso') continue;
    if (!q.socio && !podeVer(q.nome, l.consultor ?? '')) continue;
    total++;
  }
  return { total };
}

// ── Funil, por dia, time ─────────────────────────────────────────────────────

export interface LinhaFunil {
  agendaram: number; conversaram: number; avancaram: number; semInteresse: number;
  naoAtendeu: number; cancelados: number; aguardando: number;
}
const zeroFunil = (): LinhaFunil => ({ agendaram: 0, conversaram: 0, avancaram: 0, semInteresse: 0, naoAtendeu: 0, cancelados: 0, aguardando: 0 });

function somarFunil(f: LinhaFunil, c: CardBruto): void {
  const s = status(c.status);
  f.agendaram++;
  if (s === 'cancelado') f.cancelados++;
  else if (s === 'nao_atendeu') f.naoAtendeu++;
  else if (AGUARDANDO.includes(s)) f.aguardando++;
  // Fora de AGUARDANDO, nao_atendeu e cancelado: conversou. Status desconhecido entra aqui.
  if (!AGUARDANDO.includes(s) && s !== 'nao_atendeu' && s !== 'cancelado') f.conversaram++;
  if (NEGOCIACAO.includes(s) || s === 'fechou') f.avancaram++;
  if (s === 'sem_interesse') f.semInteresse++;
}

/** Coorte: os cards CRIADOS no período (dia de Brasília do `created_at`). */
export function cardsCriadosNoPeriodo(cards: CardBruto[], p: Periodo): CardBruto[] {
  return cards.filter((c) => { const d = diaBRT(c.created_at); return d !== '' && d >= p.de && d <= p.ate; });
}

export function montarFunil(coorte: CardBruto[]): Record<Familia, LinhaFunil> {
  const f = { solar: zeroFunil(), eletroposto: zeroFunil() };
  for (const c of coorte) somarFunil(f[familiaDe(c.created_by)], c);
  return f;
}

export function montarPorDia(coorte: CardBruto[], p: Periodo) {
  const linhas = new Map(listaDeDias(p.de, p.ate).map((d) => [d, { dia: d, solar: 0, eletroposto: 0 }]));
  for (const c of coorte) linhas.get(diaBRT(c.created_at))![familiaDe(c.created_by)]++;
  return [...linhas.values()];
}

/** Uma linha por consultor, em ordem alfabética. Quem decide QUAIS consultores
 *  entram é `montarDashboard`: sócio recebe o time, consultor comum só a linha dele. */
export function montarTime(coorte: CardBruto[], propostas: PropostaBruta[], p: Periodo) {
  const por = new Map<string, { consultor: string; f: LinhaFunil; propostas: number }>();
  const linha = (nome: unknown) => {
    const chave = nomeSimples(nome);
    if (!chave) return null;
    if (!por.has(chave)) por.set(chave, { consultor: rotuloConsultor(nome), f: zeroFunil(), propostas: 0 });
    return por.get(chave)!;
  };
  for (const c of coorte) { const l = linha(c.vendedor_nome); if (l) somarFunil(l.f, c); }
  for (const pr of propostas) {
    const d = diaBRT(pr.created_at);
    if (d === '' || d < p.de || d > p.ate) continue;
    const l = linha(pr.consultor_nome);
    if (l) l.propostas++;
  }
  return [...por.values()].sort((a, b) => porNome(a.consultor, b.consultor)).map((l) => ({
    consultor: l.consultor, agendaram: l.f.agendaram, conversaram: l.f.conversaram,
    avancaram: l.f.avancaram, propostas: l.propostas,
  }));
}

// ── Rota 1 inteira ───────────────────────────────────────────────────────────

/** O corpo de GET /gerador/dashboard (a rota acrescenta `ok` e `geradoEm`). */
export function montarDashboard(bruto: DashboardBruto, q: Quem, chave: ChavePeriodo, agora: Date) {
  const hoje = hojeBRT(agora);
  const periodo = periodoDe(chave, hoje);
  const meus = cortarCards(bruto.cards, q);
  const coorteMeus = cardsCriadosNoPeriodo(meus, periodo);
  // Desempenho de colega não é do consultor comum: ele recebe só a própria linha.
  const minhasPropostas = q.socio ? bruto.propostas : bruto.propostas.filter((p) => podeVer(q.nome, p.consultor_nome ?? ''));
  return {
    hoje,
    consultor: q.nome,
    verTudo: q.socio,
    verDinheiro: q.socio,
    periodo,
    // `porProduto` repete a agenda inteira só com os cards de cada produto: o filtro
    // Solar/Eletroposto da tela troca o bloco todo, sem somar um produto no outro.
    agendaHoje: {
      ...montarAgendaHoje(meus, hoje, agora),
      porProduto: {
        solar: montarAgendaHoje(meus.filter((c) => familiaDe(c.created_by) === 'solar'), hoje, agora),
        eletroposto: montarAgendaHoje(meus.filter((c) => familiaDe(c.created_by) === 'eletroposto'), hoje, agora),
      },
    },
    pendencias: {
      agendadosVencidos: montarVencidos(meus, hoje),
      quizSemHorario: montarQuizSemHorario(bruto.leads, q, agora),
    },
    funil: montarFunil(coorteMeus),
    porDia: montarPorDia(coorteMeus, periodo),
    time: montarTime(coorteMeus, minhasPropostas, periodo),
    notas: { semOrigem: coorteMeus.filter((c) => !String(c.created_by ?? '').trim()).length },
  };
}

// ── Rota 2: negócio ──────────────────────────────────────────────────────────

function dataReal(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export interface VendaEletroposto { id: number; consultor: string; dia: string; valor: number | null; semRegistro: boolean }

/** Venda de eletroposto = card `fechou` da família com o registro `pos_venda:<id>`
 *  (valor e `vendido_em` do registro). Sem registro, ou com o valor em branco no
 *  registro, a venda conta com `valor: null` (não se sabe, que é diferente de
 *  zero); sem registro, o dia é o de criação do card. */
export function vendasEletroposto(cards: CardBruto[], registros: Map<number, unknown>): VendaEletroposto[] {
  const out: VendaEletroposto[] = [];
  for (const c of cards) {
    if (status(c.status) !== 'fechou' || familiaDe(c.created_by) !== 'eletroposto') continue;
    const reg = registros.get(c.id);
    const r = (reg && typeof reg === 'object' && !Array.isArray(reg) ? reg : null) as { valor?: unknown; vendido_em?: unknown } | null;
    // Data que não existe ("2026-13-45") cairia num mês que não existe e a venda sumiria da conta.
    const vendidoEm = dataReal(r?.vendido_em) ? r.vendido_em : '';
    const valor = typeof r?.valor === 'number' && Number.isFinite(r.valor) && r.valor > 0 ? r.valor : null;
    out.push({
      id: c.id, consultor: String(c.vendedor_nome ?? ''), semRegistro: !r,
      dia: vendidoEm || diaBRT(c.created_at), valor,
    });
  }
  return out;
}

export interface TrafegoResumo { rotulo: string; meta_ok: boolean; gasto?: number; agendados?: number; custoPorAgendado?: number | null }

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Tráfego sai do painel do quiz (a tela para onde o número leva). Meta fora:
 *  sem `gasto` nem custo, para nunca mostrar zero no lugar de "não sei". */
export function resumirTrafego(painel: PainelQuizSolar | null): TrafegoResumo {
  const rotulo = 'Últimos 30 dias';
  if (!painel || !painel.meta_ok) {
    return { rotulo, meta_ok: false, ...(painel ? { agendados: painel.resultado.agendados } : {}) };
  }
  const gasto = centavos(painel.porAnuncio.reduce((s, a) => s + (a.gasto || 0), 0));
  const agendados = painel.resultado.agendados;
  // Sem gasto não existe custo por agendamento: R$ 0,00 por horário seria mentira.
  return { rotulo, gasto, agendados, custoPorAgendado: agendados > 0 && gasto > 0 ? centavos(gasto / agendados) : null, meta_ok: true };
}

export interface EntradaNegocio {
  /** `null` = planilha fora do ar. */
  planilha: ObraBruta[] | null;
  cards: CardBruto[];
  registros: Map<number, unknown>;
  posVendaOk: boolean;
  /** Só é lido para sócio. */
  trafego: TrafegoResumo | null;
  quem: Quem;
  chave: ChavePeriodo;
  agora: Date;
}

interface Folha { qtd?: number; valor?: number; semValor?: number; indisponivel?: true }

/** `valor` soma só as vendas que TÊM valor. Se nenhuma tem, a chave não sai: a
 *  tela escreve "sem valor registrado", nunca R$ 0,00. `semValor` diz quantas
 *  ficaram fora da soma. Sem venda nenhuma, zero é verdade e sai como zero.
 *  Fonte fora do ar não sabe nem a quantidade: sai SÓ `indisponivel`, sem zero nenhum. */
function folha(itens: Array<{ valor: number | null }>, socio: boolean, indisponivel = false): Folha {
  if (indisponivel) return { indisponivel: true };
  const f: Folha = { qtd: itens.length };
  if (socio) {
    const comValor = itens.filter((i) => i.valor !== null);
    if (comValor.length || !itens.length) f.valor = centavos(comValor.reduce((s, i) => s + (i.valor as number), 0));
    if (comValor.length < itens.length) f.semValor = itens.length - comValor.length;
  }
  return f;
}

export function montarNegocio(e: EntradaNegocio) {
  const { quem: q } = e;
  const hoje = hojeBRT(e.agora);
  const periodo = periodoDe(e.chave, hoje);
  const meses = mesesRecentes(hoje);

  const obras = e.planilha ? e.planilha.filter((b) => podeVer(q.nome, b.consultor)).map((b) => montarObra(b, hoje)) : null;
  // Linha da planilha com o valor em branco entra na contagem e fica fora da soma.
  const solar = (obras ?? []).map((o) => ({ dia: o.vendaEm, valor: o.valores.venda > 0 ? o.valores.venda : null }));
  const ep = vendasEletroposto(q.socio ? e.cards : cortarCards(e.cards, q), e.registros);
  const noPeriodo = <T extends { dia: string | null }>(xs: T[]) => xs.filter((x) => !!x.dia && x.dia >= periodo.de && x.dia <= periodo.ate);
  const doMes = <T extends { dia: string | null }>(xs: T[], m: string) => xs.filter((x) => !!x.dia && x.dia.slice(0, 7) === m);
  const semPlanilha = !obras;
  // Sem o registro de pós-venda não se sabe o dia nem o valor da venda de eletroposto.
  const semPosVenda = !e.posVendaOk;

  const vendas = {
    fonteSolar: 'Planilha Mestre',
    fonteEletroposto: 'Vendas marcadas no card',
    periodo: {
      solar: folha(noPeriodo(solar), q.socio, semPlanilha),
      eletroposto: folha(noPeriodo(ep), q.socio, semPosVenda),
    },
    porMes: meses.map((m) => ({
      mes: m,
      // A planilha recebe as vendas com atraso: o mês corrente nunca está fechado.
      parcial: m === hoje.slice(0, 7),
      solar: folha(doMes(solar, m), q.socio, semPlanilha),
      eletroposto: folha(doMes(ep, m), q.socio, semPosVenda),
    })),
  };

  const andamento = (obras ?? []).filter((o) => o.etapaAtual !== 'concluida');
  const resumo = resumirObras(obras ?? [], false);
  const blocoObras = obras
    ? {
      emAndamento: resumo.emAndamento, concluidas: resumo.concluidas, porEtapa: resumo.porEtapa,
      paradas15: andamento.filter((o) => (o.paradoHaDias ?? 0) >= 15).length,
      maiorParadaDias: andamento.reduce((m, o) => Math.max(m, o.paradoHaDias ?? 0), 0),
    }
    : { indisponivel: true };

  const corpo: Record<string, unknown> = {
    verTudo: q.socio, verDinheiro: q.socio, periodo, vendas,
  };
  if (q.socio) {
    if (!obras) corpo.aReceber = { indisponivel: true };
    else {
      // O mesmo recorte e a mesma soma da aba Obras (`resumirObras`): só o "Não Quitado"
      // tem saldo. Venda em aberto com o valor em branco na planilha não vira R$ 0:
      // fica fora da soma e sai em `semValor`.
      const abertas = obras.filter((o) => o.recebimento === 'nao_quitado');
      const comValor = abertas.filter((o) => o.valores.venda > 0);
      const r: { vendas: number; valor?: number; semValor?: number } = { vendas: abertas.length };
      if (comValor.length || !abertas.length) r.valor = centavos(comValor.reduce((s, o) => s + o.valores.aReceber, 0));
      if (comValor.length < abertas.length) r.semValor = abertas.length - comValor.length;
      corpo.aReceber = r;
    }
  }
  corpo.obras = blocoObras;
  if (q.socio) corpo.trafego = e.trafego ?? { rotulo: 'Últimos 30 dias', meta_ok: false };
  corpo.fontes = { planilha: !semPlanilha, posVenda: e.posVendaOk };
  // Nota de fonte fora do ar não existe: zero ali diria "nenhuma", e a verdade é "não sei".
  const notas: Record<string, number> = {};
  if (!semPlanilha) notas.vendasSemData = solar.filter((s) => !s.dia).length;
  if (!semPosVenda) notas.eletropostoSemRegistro = ep.filter((v) => v.semRegistro).length;
  corpo.notas = notas;
  return corpo;
}
