import { Router, Request, Response, NextFunction } from 'express';
import { PLANILHA_CSV_URL } from '../services/insightsService';
import { exigeConsultor } from './geradorDossie';
import { comLimite, limitesSolar } from './geradorSolar';
import { ehSocio, podeVer, codigoCanonico } from '../services/gerador/solarObras';
import {
  lerGrade, montarCatalogo, montarLinhas, colunasPara, colunaPublica, totais, validarValor, celulaDe,
  progressoDe, houveConflito, aplicarGravacao, consultorEfetivo, nomeComparavel, GRUPOS, GRUPO_OUTROS,
  COLUNAS_PESSOAIS, celulaEhFixa, lerRegistro,
  type Grade, type ColunaInterna, type RegistroGestao, type Celula, type Derivada,
} from '../services/gerador/gestaoClientes';
import {
  lerRegistros, lerRegistroComVersao, gravarRegistro, ErroGestao, lerRegistrosDoGerador, lerRegistroDoGeradorComVersao, gravarRegistroDoGerador,
} from '../services/gerador/gestaoClientesBanco';
import { paresDoGerador, derivarPares, derivadaDe, CHAVES_DERIVADAS, type ResumoCsv } from '../services/gerador/linhasGerador';
import { equipamentoDaPlanilha, type EquipamentoSolar } from '../services/gerador/docsCliente';
import { lerCardSolarVendido, lerLigacao, type VendaCsvParaVinculo } from '../services/gerador/vendaSolarHub';
import { codigoDoAlocadorDoCard, lerEstadoDoRegistro, ehCodigoDoAlocador } from '../services/gerador/vendaSolarRegistro';
import { POR_GERADOR } from '../services/gerador/vendaSolarHub';
import type { CardVendido } from '../services/gerador/fichaEletroposto';

// ─────────────────────────────────────────────────────────────────────────────
// GESTÃO DE CLIENTES (solar) no /gerador: a Planilha Mestre como grade editável.
// Montada dentro de /gerador. Duas rotas:
//   GET  /clientes/solar         catálogo + linhas (já cortados pelo PAPEL)
//   POST /clientes/solar/campo   grava UMA célula (com conferência de conflito)
//
// A planilha continua sendo a base e é SÓ LEITURA; o que se preenche aqui mora
// em `system_state` (`gestao_cliente:<NNNN>`) e vale por cima, campo a campo.
//
// CACHE GUARDA DADO, NUNCA RESPOSTA. A grade em cache traz TODAS as colunas (com
// custo e lucro); cada requisição monta a resposta para o seu papel. Consultor
// nunca recebe coluna `socio`: nem no catálogo, nem nas células, nem em erro.
//
// Nenhum valor de célula vai para log: só o código do erro do banco.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 5 * 60_000;
const VALIDADE_COPIA_VELHA_MS = 6 * 3_600_000;   // cópia velha demais engana mais do que ajuda
const TENTATIVAS_GRAVAR = 4;

interface CacheGrade { grade: Grade; cols: ColunaInterna[]; ts: number }
let cache: CacheGrade | null = null;
let voando: Promise<CacheGrade> | null = null;

/** Para os testes: o cache em módulo faria a ordem dos testes importar. */
export function limparCacheClientes(): void { cache = null; voando = null; }

function baixar(): Promise<CacheGrade> {
  return comLimite(async (sinal) => {
    const r = await fetch(PLANILHA_CSV_URL, { signal: sinal });
    if (!r.ok) throw new Error(`planilha respondeu ${r.status}`);
    const grade = lerGrade(await r.text());
    if (!grade.vendas.length) throw new Error('planilha sem nenhuma venda');
    return { grade, cols: montarCatalogo(grade.cabecalho, grade.vendas), ts: Date.now() };
  }, limitesSolar.planilhaMs, 'planilha');
}

async function grade(fresco: boolean): Promise<{ dados: CacheGrade; atual: boolean }> {
  if (!fresco && cache && Date.now() - cache.ts < TTL_MS) return { dados: cache, atual: true };
  try {
    if (!voando || fresco) {
      const p = baixar();
      voando = p;
      p.then(() => { if (voando === p) voando = null; }, () => { if (voando === p) voando = null; });
    }
    const dados = await (voando as Promise<CacheGrade>);
    cache = dados;
    return { dados, atual: true };
  } catch (err) {
    console.error('[clientes] planilha falhou', String((err as Error)?.message || 'erro').slice(0, 80));
    if (cache && Date.now() - cache.ts < VALIDADE_COPIA_VELHA_MS) return { dados: cache, atual: false };
    throw err;
  }
}

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

/** Falha de leitura (planilha ou banco) ao conferir a posse de uma venda do Solar, para as rotas de documentos. */
export class ErroVendaSolar extends Error {
  constructor(public http: 502 | 500) { super('venda-solar'); }
}
export interface VendaSolarDoDono {
  venda: Grade['vendas'][number];
  cols: ColunaInterna[];
  reg: RegistroGestao;
}

/**
 * A venda `#NNNN` do Solar SE quem pede é o dono (ou sócio); null quando não existe OU é de outra pessoa (as duas
 * coisas são iguais para quem pede). Usa o MESMO cache da planilha da Gestão e o consultor EFETIVO (um sócio pode
 * ter trocado o consultor no `gestao_cliente`), então não há segundo download da planilha nem segunda regra de posse.
 */
export async function vendaSolarDoDono(nome: string, socio: boolean, codigo: string): Promise<VendaSolarDoDono | null> {
  let pl: { dados: CacheGrade; atual: boolean };
  try { pl = await grade(false); } catch { throw new ErroVendaSolar(502); }
  const venda = pl.dados.grade.vendas.find((v) => v.codigo === codigo);
  if (!venda) return null;
  try {
    const { reg } = await lerRegistroComVersao(codigo);
    return socio || podeVer(nome, consultorEfetivo(pl.dados.cols, venda.celulas, reg)) ? { venda, cols: pl.dados.cols, reg } : null;
  } catch {
    throw new ErroVendaSolar(500);
  }
}

/** Todos os códigos canônicos (`#NNNN`) da planilha, para varrer os vínculos. */
export async function codigosSolar(): Promise<string[]> {
  let pl: { dados: CacheGrade; atual: boolean };
  try { pl = await grade(false); } catch { throw new ErroVendaSolar(502); }
  return pl.dados.grade.vendas.map((v) => v.codigo);
}

/**
 * Os códigos da planilha lidos AGORA (`grade(true)`), para quem vai reservar um número novo: cache de até 5 min ou cópia velha de até
 * 6 h poderiam esconder uma venda recém-numerada. Planilha que não respondeu (cópia, `atual: false`) é erro 502, nunca um valor velho.
 */
export async function codigosSolarAtuais(): Promise<string[]> {
  let pl: { dados: CacheGrade; atual: boolean };
  try { pl = await grade(true); } catch { throw new ErroVendaSolar(502); }
  if (!pl.atual) throw new ErroVendaSolar(502);
  return pl.dados.grade.vendas.map((v) => v.codigo);
}

/**
 * O que o hub da venda solar precisa de cada venda da planilha para casar com o card: nome, nome da homologação, telefone, data e
 * consultor EFETIVO.
 */
export type VendaPlanilhaResumo = VendaCsvParaVinculo;

/**
 * Todas as vendas da planilha (código `#NNNN`, cliente, nome da homologação, telefone, data da venda e consultor efetivo), já com o
 * que o sistema gravou por cima (`gestao_cliente:<NNNN>`): telefone e consultor corrigidos lá valem. Uso interno do servidor: o
 * telefone nunca sai na resposta.
 */
export async function vendasDaPlanilha(): Promise<VendaPlanilhaResumo[]> {
  let pl: { dados: CacheGrade; atual: boolean };
  try { pl = await grade(false); } catch { throw new ErroVendaSolar(502); }
  return resumoDasVendas(pl.dados);
}

/**
 * A planilha lida AGORA (`grade(true)`), para o alocador do `#NNNN`: os códigos e o resumo de cada venda. Cache de até 5 min ou
 * cópia velha de até 6 h poderiam esconder uma venda recém-numerada: planilha que não respondeu (`atual: false`) é erro 502.
 */
export async function leituraAtualDaPlanilha(): Promise<{ codigos: string[]; vendas: VendaPlanilhaResumo[] }> {
  let pl: { dados: CacheGrade; atual: boolean };
  try { pl = await grade(true); } catch { throw new ErroVendaSolar(502); }
  if (!pl.atual) throw new ErroVendaSolar(502);
  const vendas = await resumoDasVendas(pl.dados);
  return { codigos: pl.dados.grade.vendas.map((v) => v.codigo), vendas };
}

/**
 * A mesma leitura, do cache de 5 min (ou da cópia velha de até 6 h), como o `codigosSolar` da fase 1. SÓ para a PRÉVIA do cartão do
 * Trello: ela não escreve nada e o número dela é provisório. A criação usa `leituraAtualDaPlanilha`.
 */
export async function leituraDaPlanilhaEmCache(): Promise<{ codigos: string[]; vendas: VendaPlanilhaResumo[] }> {
  let pl: { dados: CacheGrade; atual: boolean };
  try { pl = await grade(false); } catch { throw new ErroVendaSolar(502); }
  // Cópia de conferência: se os overlays não respondem, vale o CSV puro (os códigos estão completos; só o que foi corrigido por cima falta).
  const vendas = await resumoDasVendas(pl.dados, true);
  return { codigos: pl.dados.grade.vendas.map((v) => v.codigo), vendas };
}

/**
 * A CÓPIA de conferência do alocador quando a leitura fresca falha: SÓ o cache do módulo (até 6 h), sem baixar nada (o Excel fora
 * não pode segurar a trava do número com outra espera de download). Sem cache: erro (o Excel fica desconhecido).
 */
export async function leituraDaPlanilhaDoCache(): Promise<{ codigos: string[]; vendas: VendaPlanilhaResumo[] }> {
  if (!cache || Date.now() - cache.ts >= VALIDADE_COPIA_VELHA_MS) throw new ErroVendaSolar(502);
  const dados = cache;
  const vendas = await resumoDasVendas(dados, true);
  return { codigos: dados.grade.vendas.map((v) => v.codigo), vendas };
}

async function resumoDasVendas(dados: CacheGrade, semOverlayVale = false): Promise<VendaPlanilhaResumo[]> {
  const { cols, grade: g } = dados;
  let regs: Map<string, RegistroGestao>;
  let semOverlay = false;
  try { regs = await lerRegistros(g.vendas.map((v) => v.codigo)); } catch {
    if (!semOverlayVale) throw new ErroVendaSolar(500);
    console.error('[clientes] overlays fora; resumo só com o CSV', 'overlay_fora');
    regs = new Map();
    semOverlay = true;
  }
  const col = (chave: string): ColunaInterna | undefined => cols.find((c) => c.chave === chave);
  const [cCliente, cHomologacao, cContato, cData] = [col('cliente'), col('homologacao'), col('contato'), col('cadastro_trello')];
  const texto = (c: ColunaInterna | undefined, bruto: string[], reg: RegistroGestao | undefined): string => {
    if (!c) return '';
    const v = celulaDe(c, bruto[c.indice] ?? '', reg).valor;
    return v === null || v === undefined ? '' : String(v);
  };
  return g.vendas.map((v) => {
    const reg = regs.get(v.codigo);
    return {
      codigo: v.codigo,
      cliente: texto(cCliente, v.celulas, reg),
      homologacao: texto(cHomologacao, v.celulas, reg),
      telefone: texto(cContato, v.celulas, reg),
      data: texto(cData, v.celulas, reg).slice(0, 10),
      // Sem overlay o consultor do CSV pode não ser o EFETIVO (um sócio pode tê-lo trocado): vazio, e só sócio vê a linha.
      consultor: semOverlay ? '' : consultorEfetivo(cols, v.celulas, reg),
    };
  });
}

/**
 * A venda da planilha ligada ao card vale como PERMISSÃO (o consultor dela passa na guarda do card)? Não quando o código foi dado
 * pelo alocador do servidor a ESTE card (registro assinado `codigo_solar:<NNNN>` com `card` igual): se o Excel ganhar depois uma
 * linha com esse número de OUTRO cliente, o consultor dela leria o cadastro e os documentos deste. Ligação feita por gente, ou a
 * antiga `por: 'auto'`: confia, como sempre. Erro de banco sobe (`ErroHub`). Nunca lê cadastro nem compara nome.
 */
export async function vendaLigadaVale(cardId: number, codigo: string, por?: string): Promise<boolean> {
  // Ligação `por: 'gerador'` é do alocador mesmo sem o registro (a chave pública pode apagar `codigo_solar:*`).
  if (por === POR_GERADOR) return false;
  // Registro presente com assinatura inválida também nega (na dúvida, o consultor da planilha não ganha o card).
  return !(await codigoDoAlocadorDoCard(codigo, cardId));
}

/**
 * Quem pode ver e mexer na venda solar de um card (a guarda da linha `vendasolar`): o card existe, é SOLAR (não eletroposto) e
 * está `fechou`; e quem pede é sócio, ou o `vendedor_nome` do card, ou o consultor EFETIVO da venda da planilha ligada ao card
 * (mesma regra de `vendaSolarDoDono`), SÓ quando a venda ligada não é um código do alocador deste card (`vendaLigadaVale`). A
 * ordem importa: sócio e vendedor passam sem tocar na planilha, então planilha fora do ar não barra o próprio vendedor. Devolve
 * null quando não existe OU não pode (as duas coisas são iguais para quem pede).
 */
export async function acessoVendaSolar(nome: string, socio: boolean, cardId: number): Promise<CardVendido | null> {
  const card = await lerCardSolarVendido(cardId);
  if (!card) return null;
  if (socio || podeVer(nome, String(card.vendedor_nome ?? ''))) return card;
  const { lig } = await lerLigacao(cardId);
  if (lig.venda && await vendaLigadaVale(cardId, lig.venda, lig.por) && await vendaSolarDoDono(nome, false, lig.venda)) return card;
  return null;
}

/** O que `sincronizarNomeHomologacao` fez: gravou, já estava igual, deixou o que alguém digitou, ou a venda não tem a coluna. */
export type ResultadoSincNome = 'gravou' | 'igual' | 'preservou' | 'sem_coluna' | 'ocupado' | 'sem_conferir' | 'sem_acesso';

/**
 * Escreve o NOME da homologação (coluna `homologacao`, "Nome na homologação") da venda `#NNNN` da planilha mãe, a partir do cadastro
 * da venda solar pelo card. Mesmas peças da gravação de uma célula da Planilha do Cliente (`validarValor`, `aplicarGravacao` com o
 * autor e a trilha de alterações, `gravarRegistro` com conferência de versão), mas SEM conflito de `base_em`: a regra de não
 * sobrescrever é outra. Só grava quando a célula EFETIVA (a do sistema por cima da planilha) está vazia, ou quando o valor dela
 * é o que esta mesma via escreveu da última vez (`nomeAnterior`, o nome da homologação do cadastro antes desta gravação). Valor
 * digitado por gente, na planilha ou na Planilha do Cliente, fica como está. Nunca grava vazio. Só o nome: nada de CPF.
 * Decide com a planilha FRESCA (nunca o cache de 5 min nem a cópia velha): se não deu para baixá-la agora, não escreve
 * (`sem_conferir`). Exige a mesma posse da rota da célula (sócio, ou `podeVer` do consultor efetivo da venda): quem grava o
 * cadastro mas não enxerga aquela venda não escreve nela (`sem_acesso`). Lança se o banco falhar (quem chama transforma em aviso).
 */
export async function sincronizarNomeHomologacao(
  codigoVenda: string, nome: string, nomeAnterior: string, por: string, socio: boolean,
): Promise<ResultadoSincNome> {
  const novo = nome.replace(/\s+/g, ' ').trim();
  if (!novo) return 'igual';
  const codigo = codigoCanonico(codigoVenda);
  const { dados, atual: fresca } = await grade(true);
  if (!fresca) return 'sem_conferir';
  const venda = dados.grade.vendas.find((v) => v.codigo === codigo);
  const col = dados.cols.find((c) => c.chave === 'homologacao');
  if (!venda || !col || col.calculada) return 'sem_coluna';
  const v = validarValor(col, novo);
  if (!v.ok) return 'preservou';
  for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
    const { reg, versao } = await lerRegistroComVersao(codigo);
    if (!(socio || podeVer(por, consultorEfetivo(dados.cols, venda.celulas, reg)))) return 'sem_acesso';
    const antes = celulaDe(col, venda.celulas[col.indice] ?? '', reg);
    const atual = antes.valor === null || antes.valor === undefined ? '' : String(antes.valor).replace(/\s+/g, ' ').trim();
    if (atual && nomeComparavel(atual) === nomeComparavel(novo)) return 'igual';
    const foiDestaVia = antes.origem === 'sistema' && !!nomeAnterior && nomeComparavel(atual) === nomeComparavel(nomeAnterior);
    if (atual && !foiDestaVia) return 'preservou';
    const agora = new Date().toISOString();
    if (await gravarRegistro(codigo, aplicarGravacao(reg, col, v.valor, antes.valor, por, agora), versao, agora)) return 'gravou';
  }
  return 'ocupado';
}

function quem(req: Request): { nome: string; socio: boolean } {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
}

const MSG_PLANILHA = 'Não consegui ler a planilha agora. Tente de novo em instantes.';
const MSG_BANCO = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const MSG_PESSOAL = 'Esta informação vem do cadastro do card. Para mudar, edite no card da agenda.';
const MSG_CONSULTOR_DO_CARD = 'O consultor vem do card da agenda. Para trocar, transfira o card.';

function celulaPublica(c: Celula): Celula {
  const base: Celula = c.origem === 'sistema' ? { valor: c.valor, origem: c.origem, por: c.por, em: c.em } : { valor: c.valor, origem: c.origem };
  return c.fixa ? { ...base, fixa: true } : base;
}

function textoValor(v: unknown): string {
  return v === null || v === undefined ? 'vazio' : String(v);
}

/** O resumo de UMA linha do CSV para a classificação da camada do /gerador (com o overlay já aplicado). */
function resumoDaLinha(cols: ColunaInterna[], venda: Grade['vendas'][number], reg: RegistroGestao | undefined, nome: string, socio: boolean): ResumoCsv {
  const texto = (chave: string): string => {
    const c = cols.find((x) => x.chave === chave);
    if (!c) return '';
    const v = celulaDe(c, venda.celulas[c.indice] ?? '', reg).valor;
    return v === null || v === undefined ? '' : String(v);
  };
  const consultor = consultorEfetivo(cols, venda.celulas, reg);
  // "Vazia" só quando TODAS as colunas pessoais e o equipamento estão vazios (senão é a linha de algum cliente: confere o nome).
  const vazia = [...COLUNAS_PESSOAIS, ...COLUNAS_EQUIPAMENTO].every((k) => !texto(k).trim());
  return { visivel: socio || podeVer(nome, consultor), cliente: texto('cliente'), homologacao: texto('homologacao'), telefone: texto('contato'), consultor, vazia };
}
const COLUNAS_EQUIPAMENTO = ['qtd_placa', 'modelo_placa', 'pot_placa', 'qtd_inversor', 'modelo_inversor', 'modelo_voltagem_inversor', 'obs', 'outro_equip'];

/**
 * O equipamento da venda ligada ao card, para o relatório da venda solar. Sem venda ligada: null. Código de gente (sem registro do
 * alocador): como sempre, a linha da planilha SE quem pede a enxerga. Código do alocador (registro válido deste card OU presente com
 * assinatura inválida): a linha que o /gerador monta; em `junta`, completando a do CSV; em conflito, SÓ o derivado (nada da linha do
 * outro cliente). Qualquer falha de leitura: null (o relatório sai sem equipamento, nunca com o da planilha na dúvida).
 */
export async function equipamentoDoCardParaRelatorio(
  nome: string, socio: boolean, card: CardVendido, lig: { venda: string | null; por?: string },
): Promise<EquipamentoSolar | null> {
  if (!lig.venda) return null;
  let doAlocador: boolean;
  try {
    doAlocador = await ehCodigoDoAlocador(lig, card.id);
  } catch (err) {
    console.error('[clientes] registro do código indisponível no relatório', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
    return null;
  }
  if (!doAlocador) {
    // Ligação feita por gente: como sempre (planilha fora do ar relança `ErroVendaSolar`).
    const s = await vendaSolarDoDono(nome, socio, lig.venda);
    return s ? equipamentoDaPlanilha(s.cols, s.venda.celulas, s.reg) : null;
  }
  try {
    const { dados } = await grade(false);
    const venda = dados.grade.vendas.find((v) => v.codigo === lig.venda);
    const regCodigo = venda ? (await lerRegistroComVersao(lig.venda)).reg : undefined;
    const csv = new Map<string, ResumoCsv>(venda ? [[venda.codigo, resumoDaLinha(dados.cols, venda, regCodigo, nome, socio)]] : []);
    const d0 = await derivadaDe(lig.venda, { nome, socio, csv });
    const d = d0 === 'pulado' ? null : d0;
    if (!d || d.card !== card.id) return null;   // o par tem que ser DESTE card
    const doCard = (await lerRegistroDoGeradorComVersao(d.card)).reg;
    if (d.modo === 'junta' && venda) return equipamentoDaPlanilha(dados.cols, venda.celulas, regCodigo ?? lerRegistro(undefined), d.valores, doCard);
    if (d.modo === 'so_gerador') return equipamentoDaPlanilha(dados.cols, [], lerRegistro(undefined), d.valores, doCard);
    return equipamentoDaPlanilha(dados.cols, [], lerRegistro(undefined), d.valores);   // conflito: só o montado
  } catch (err) {
    console.error('[clientes] equipamento do relatório indisponível', err instanceof ErroGestao ? err.codigo : 'interno');
    return null;
  }
}

export function mountClientes(router: Router): void {
  // ── Grade ──────────────────────────────────────────────────────────────────
  router.get('/clientes/solar', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    let pl: { dados: CacheGrade; atual: boolean };
    try { pl = await grade(socio && String(req.query.fresco || '') === '1'); } catch {
      res.status(502).json({ ok: false, error: MSG_PLANILHA });
      return;
    }
    // O instante vem ANTES da leitura: uma edição que caia entre as duas fica depois do `base_em` e gera 409, nunca sobrescrita calada.
    const agora = new Date().toISOString();
    let registros: Map<string, RegistroGestao>;
    try { registros = await lerRegistros(pl.dados.grade.vendas.map((v) => v.codigo)); } catch (err) {
      console.error('[clientes] leitura dos registros falhou', err instanceof ErroGestao ? err.codigo : 'interno');
      res.status(502).json({ ok: false, error: MSG_BANCO });
      return;
    }
    // Camada do /gerador (fase 2): falha NUNCA derruba a grade; vira `fonte.gerador: false` e a grade segue só com o CSV.
    let derivadas: Map<string, Derivada> | undefined;
    let overlays: Map<number, RegistroGestao> | undefined;
    let pulados: Set<string> | undefined;
    let fonteGerador = true;
    let fonteCadastro = true;
    try {
      const csv = new Map<string, ResumoCsv>();
      for (const v of pl.dados.grade.vendas) csv.set(v.codigo, resumoDaLinha(pl.dados.cols, v, registros.get(v.codigo), nome, socio));
      const r = await derivarPares(await paresDoGerador(), { nome, socio, csv });
      // O overlay do card vale na linha só do /gerador e em `junta` (S2); a leitura entra neste mesmo try (S7).
      overlays = await lerRegistrosDoGerador([...r.derivadas.values()].filter((d) => d.modo !== 'conflito').map((d) => d.card));
      derivadas = r.derivadas;
      pulados = r.pulados;
      fonteCadastro = r.cadastroOk;
    } catch (err) {
      console.error('[clientes] camada do gerador falhou', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
      fonteGerador = false;
      fonteCadastro = false;
      derivadas = undefined;
      overlays = undefined;
    }
    const { colunas, linhas } = montarLinhas(pl.dados.grade, pl.dados.cols, registros, nome, socio, derivadas, overlays, pulados);
    const presentes = new Set(colunas.map((c) => c.grupo));
    res.json({
      ok: true,
      papel: socio ? 'socio' : 'consultor',
      consultor: nome,
      em: agora,
      atualizadoEm: new Date(pl.dados.ts).toISOString(),
      fonte: { planilha: pl.atual, gerador: fonteGerador, cadastro: fonteCadastro },
      catalogo: {
        grupos: [...GRUPOS, GRUPO_OUTROS].filter((g) => presentes.has(g)),
        colunas: colunas.map(colunaPublica),
      },
      linhas: linhas.map((l) => ({
        codigo: l.codigo, cliente: l.cliente, consultor: l.consultor, progresso: l.progresso,
        celulas: Object.fromEntries(Object.entries(l.celulas).map(([k, c]) => [k, celulaPublica(c)])),
        ...(l.so_gerador ? { so_gerador: true } : {}),
        ...(l.card !== undefined ? { card: l.card } : {}),
        ...(l.exibir ? { exibir: l.exibir } : {}),
        ...(l.conflito ? { conflito: l.conflito } : {}),
        ...(l.venda_desfeita ? { venda_desfeita: true } : {}),
        ...(l.somente_leitura ? { somente_leitura: true } : {}),
        ...(l.aviso_telefone ? { aviso_telefone: l.aviso_telefone } : {}),
      })),
      totais: totais(linhas),
    });
  });

  // ── Gravar uma célula ──────────────────────────────────────────────────────
  router.post('/clientes/solar/campo', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const b = (req.body || {}) as { codigo?: unknown; coluna?: unknown; valor?: unknown; base_em?: unknown; card?: unknown };
    const codigoRaw = String(b.codigo ?? '').trim();
    const colunaRaw = typeof b.coluna === 'string' ? b.coluna.trim() : '';
    const baseEm = typeof b.base_em === 'string' ? b.base_em : '';
    if (!/^#?\d{1,6}$/.test(codigoRaw) || !colunaRaw || colunaRaw.length > 60) {
      res.status(400).json({ ok: false, error: 'Pedido inválido.' });
      return;
    }
    if (!baseEm || !Number.isFinite(Date.parse(baseEm)) || new Date(baseEm).toISOString() !== baseEm) {
      res.status(400).json({ ok: false, error: 'Pedido inválido: falta o instante da leitura (base_em).' });
      return;
    }
    if (typeof b.valor === 'string' && b.valor.length > 2000) {
      res.status(400).json({ ok: false, error: 'Valor longo demais.' });
      return;
    }
    // G-9: a tela manda o `card` quando a edição vem de uma linha só do /gerador.
    if (b.card !== undefined && !(typeof b.card === 'number' && Number.isInteger(b.card) && b.card > 0)) {
      res.status(400).json({ ok: false, error: 'Pedido inválido.' });
      return;
    }
    const cardPedido = b.card as number | undefined;
    const codigo = codigoCanonico(codigoRaw);

    let pl: { dados: CacheGrade; atual: boolean };
    try { pl = await grade(false); } catch {
      res.status(502).json({ ok: false, error: MSG_PLANILHA });
      return;
    }
    const cols = pl.dados.cols;
    // 1º a POSSE da linha, antes de qualquer outra conferência: inexistente e de outro consultor respondem IGUAL (404).
    const venda = pl.dados.grade.vendas.find((v) => v.codigo === codigo);
    // A linha do /gerador deste código (lida no máximo uma vez, do cache de 60 s; nunca varre as ligações a cada célula).
    // `pulado`: o par existe mas ficou de fora (cadastro do card não respondeu e era preciso conferir o nome).
    let deriv: Derivada | null | 'pulado' | undefined;
    let pulado = false;
    const lerDeriv = async (reg: RegistroGestao | undefined): Promise<Derivada | null> => {
      if (deriv === undefined) {
        const csv = new Map<string, ResumoCsv>(venda ? [[codigo, resumoDaLinha(cols, venda, reg, nome, socio)]] : []);
        deriv = await derivadaDe(codigo, { nome, socio, csv });
      }
      if (deriv === 'pulado') { pulado = true; return null; }
      return deriv;
    };
    let dono = false;
    let regPosse: RegistroGestao | undefined;
    if (venda) {
      try {
        const { reg } = await lerRegistroComVersao(codigo);
        regPosse = reg;
        dono = socio || podeVer(nome, consultorEfetivo(cols, venda.celulas, reg));
        if (!dono) {
          // S1: na linha `junta` a grade vê pelo MESMO consultor efetivo (com o do card); a posse aqui é a mesma.
          try {
            const d = await lerDeriv(reg);
            if (d && d.modo === 'junta') dono = podeVer(nome, consultorEfetivo(cols, venda.celulas, reg, d.consultor));
          } catch { /* sem a camada do /gerador vale a posse do CSV */ }
        }
      } catch (err) {
        console.error('[clientes] leitura falhou', err instanceof ErroGestao ? err.codigo : 'interno');
        res.status(500).json({ ok: false, error: MSG_GRAVAR });
        return;
      }
    } else {
      let d: Derivada | null;
      try { d = await lerDeriv(undefined); } catch (err) {
        console.error('[clientes] linha do gerador indisponível', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
        res.status(503).json({ ok: false, error: MSG_GRAVAR });
        return;
      }
      dono = !!d && d.modo === 'so_gerador' && (socio || podeVer(nome, d.consultor));
    }
    if (!dono) { res.status(404).json({ ok: false, error: 'Venda não encontrada.' }); return; }
    // G-9: a tela editou a linha só do /gerador deste card; se o código entrou no CSV de outro jeito (ou é de outro card), a linha mudou.
    if (cardPedido !== undefined) {
      let d: Derivada | null;
      try { d = await lerDeriv(regPosse); } catch {
        res.status(503).json({ ok: false, error: MSG_GRAVAR });
        return;
      }
      // Só confere para quem é dono do card (quem só vê a linha pelo CSV não descobre o card ligado testando valores).
      const confere = !!d && d.card === cardPedido && (venda ? d.modo === 'junta' : d.modo === 'so_gerador')
        && (socio || podeVer(nome, d.consultor));
      if (!confere) { res.status(409).json({ ok: false, error: 'A linha mudou. Recarregue a página.' }); return; }
    }
    // Coluna de sócio para consultor dá a MESMA resposta de coluna que não existe.
    const col = cols.find((c) => c.chave === colunaRaw);
    if (!col || (!socio && col.quem_ve === 'socio')) {
      res.status(400).json({ ok: false, error: 'Coluna não encontrada.' });
      return;
    }
    if (col.chave === 'codigo' || col.calculada) {
      res.status(400).json({ ok: false, error: 'Esta coluna não pode ser editada.' });
      return;
    }
    // Travas da fase 2, independentes da camada derivada (não abrem com o /gerador fora do ar):
    // (a) coluna pessoal em linha só do /gerador, ou em linha do CSV cujo código tem registro do alocador (válido ou não).
    if (COLUNAS_PESSOAIS.has(col.chave)) {
      let travada = !venda;
      if (!travada) {
        try {
          // Registro do alocador (válido ou não, de qualquer card) OU ligação `por: 'gerador'` com este código (registro apagado).
          travada = (await lerEstadoDoRegistro(codigo)).estado !== 'ausente';
          if (!travada) {
            for (const p of (await paresDoGerador()).filter((x) => x.codigo === codigo)) {
              if (await ehCodigoDoAlocador({ venda: p.codigo, por: p.por }, p.card)) { travada = true; break; }
            }
          }
        } catch (err) {
          console.error('[clientes] registro do código indisponível', (err as { codigo?: unknown } | null)?.codigo ?? 'interno');
          res.status(503).json({ ok: false, error: MSG_GRAVAR });
          return;
        }
      }
      if (travada) { res.status(400).json({ ok: false, error: MSG_PESSOAL }); return; }
    }
    // (b) consultor em linha só do /gerador, mesmo de sócio.
    if (!venda && col.chave === 'consultor') { res.status(400).json({ ok: false, error: MSG_CONSULTOR_DO_CARD }); return; }

    // O consultor confere contra as opções que ELE recebe (escritas + as das vendas dele), nunca contra o catálogo inteiro:
    // senão "Marcos" digitado viraria a grafia de um engenheiro de venda alheia.
    let colValida: ColunaInterna = col;
    if (!socio && col.tipo === 'lista' && col.livre && col.chave !== 'consultor') {
      try {
        const regs = await lerRegistros(pl.dados.grade.vendas.map((x) => x.codigo));
        const dele = montarLinhas(pl.dados.grade, cols, regs, nome, false).colunas.find((c) => c.chave === col.chave);
        if (dele) colValida = dele;
      } catch (err) {
        console.error('[clientes] leitura falhou', err instanceof ErroGestao ? err.codigo : 'interno');
        res.status(500).json({ ok: false, error: MSG_GRAVAR });
        return;
      }
    }
    const v = validarValor(colValida, b.valor);
    if (!v.ok) { res.status(400).json({ ok: false, error: v.erro }); return; }
    const colunas = colunasPara(cols, socio);

    try {
      if (!venda) {
        // Linha só do /gerador: o overlay mora na chave do CARD (S2), com a mesma conferência de versão.
        const d = deriv as Derivada;   // só-Gerador: lida (e não pulada) na posse
        for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
          const { reg, versao } = await lerRegistroDoGeradorComVersao(d.card);
          const celDe = (c: ColunaInterna, r: RegistroGestao): Celula => {
            const cel = celulaDe(c, '', undefined, d.valores[c.chave], r);
            return celulaEhFixa(c.chave, d, false) ? { ...cel, fixa: true } : cel;
          };
          const antesCel = celDe(col, reg);
          const outro = houveConflito(reg, col.chave, baseEm, nome);
          if (outro) {
            res.status(409).json({
              ok: false, conflito: true, error: `${outro.por} alterou esta célula agora. Valor atual: ${textoValor(antesCel.valor)}`,
              por: outro.por, em: outro.em, celula: celulaPublica(antesCel),
            });
            return;
          }
          const mesmo = v.valor === null ? !reg.campos[col.chave] : (antesCel.origem === 'sistema' && antesCel.valor === v.valor);
          const agora = new Date().toISOString();
          let novo = reg;
          if (!mesmo) {
            // A trilha nunca guarda o valor que veio do /gerador (cadastro, proposta): seria dado pessoal em `system_state`.
            novo = aplicarGravacao(reg, col, v.valor, antesCel.origem === 'gerador' ? null : antesCel.valor, nome, agora);
            if (!(await gravarRegistroDoGerador(d.card, novo, versao, agora))) continue;
          }
          const celulas: Record<string, Celula> = {};
          for (const c of colunas) if (c.chave !== 'codigo') celulas[c.chave] = celDe(c, novo);
          res.json({ ok: true, celula: celulaPublica(celulas[col.chave]), em: agora, progresso: progressoDe(colunas, celulas) });
          return;
        }
        res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
        return;
      }
      // G-3: o card ligado a este código (dos pares em cache; nunca varre as ligações a cada célula), para o overlay da linha `junta`.
      let parCard: number | null = null;
      try { parCard = (await paresDoGerador()).find((p) => p.codigo === codigo)?.card ?? null; } catch { parCard = null; }
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { reg, versao } = await lerRegistroComVersao(codigo);
        if (!(socio || podeVer(nome, consultorEfetivo(cols, venda.celulas, reg, deriv && deriv !== 'pulado' && deriv.modo === 'junta' ? deriv.consultor : undefined)))) {
          res.status(404).json({ ok: false, error: 'Venda não encontrada.' });
          return;
        }
        if (col.chave === 'consultor' && !socio) {
          res.status(403).json({ ok: false, error: 'Só sócio troca o consultor da venda.' });
          return;
        }
        const doCard = parCard !== null ? await lerRegistroDoGeradorComVersao(parCard) : null;
        // A linha do /gerador só é lida em coluna que tem fonte derivada (S6) ou que tem algo digitado no card. Se falhar, a gravação
        // segue como hoje, e o `progresso` não vai (a tela recalcula): um número que ignora o /gerador mentiria.
        let d: Derivada | null | undefined = deriv === 'pulado' ? null : deriv;
        if (deriv === undefined && (CHAVES_DERIVADAS.has(col.chave) || !!doCard?.reg.campos[col.chave])) {
          try { d = await lerDeriv(reg); } catch { d = undefined; }
        }
        const junta = d && d.modo === 'junta' && doCard && d.card === parCard ? d : null;
        const derivados = junta ? junta.valores : undefined;
        const regCard = junta && doCard ? doCard.reg : undefined;
        const antesCel = celulaDe(col, venda.celulas[col.indice] ?? '', reg, derivados?.[col.chave], regCard);
        const outro = houveConflito(reg, col.chave, baseEm, nome);
        if (outro) {
          res.status(409).json({
            ok: false, conflito: true,
            error: `${outro.por} alterou esta célula agora. Valor atual: ${textoValor(antesCel.valor)}`,
            por: outro.por, em: outro.em, celula: celulaPublica(antesCel),
          });
          return;
        }
        const celulasDepois = (reg2: RegistroGestao, regCard2: RegistroGestao | undefined): Record<string, Celula> => {
          const m: Record<string, Celula> = {};
          for (const c of colunas) if (c.chave !== 'codigo') m[c.chave] = celulaDe(c, venda.celulas[c.indice] ?? '', reg2, derivados?.[c.chave], regCard2);
          return m;
        };
        // A trilha nunca guarda o valor que veio do /gerador (cadastro, proposta): seria dado pessoal em `system_state`.
        const antes = antesCel.origem === 'gerador' ? null : antesCel.valor;
        const agora = new Date().toISOString();
        let novo = reg;
        let novoCard = regCard;
        if (v.valor === null && !reg.campos[col.chave] && regCard?.campos[col.chave] && antesCel.origem === 'sistema' && doCard && parCard !== null) {
          // Apagar um valor que só existe no overlay do card apaga ali, com a mesma conferência de versão.
          novoCard = aplicarGravacao(regCard, col, null, antes, nome, agora);
          if (!(await gravarRegistroDoGerador(parCard, novoCard, doCard.versao, agora))) continue;
        } else {
          const mesmo = v.valor === null ? !reg.campos[col.chave] : (antesCel.origem === 'sistema' && antesCel.valor === v.valor);
          if (!mesmo) {
            novo = aplicarGravacao(reg, col, v.valor, antes, nome, agora);
            if (!(await gravarRegistro(codigo, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
          }
        }
        const celulas = celulasDepois(novo, novoCard);
        res.json({
          ok: true,
          celula: celulaPublica(celulas[col.chave]),
          em: agora,
          // Sem a linha do /gerador lida (ou com o par pulado), o número mentiria: a tela recalcula.
          ...(d !== undefined && !pulado ? { progresso: progressoDe(colunas, celulas) } : {}),
        });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
    } catch (err) {
      console.error('[clientes] gravar falhou', err instanceof ErroGestao ? err.codigo : 'interno');
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
  });
}
