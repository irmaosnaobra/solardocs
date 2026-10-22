import { Router, Request, Response, NextFunction } from 'express';
import { PLANILHA_CSV_URL } from '../services/insightsService';
import { exigeConsultor } from './geradorDossie';
import { comLimite, limitesSolar } from './geradorSolar';
import { ehSocio, podeVer, codigoCanonico } from '../services/gerador/solarObras';
import {
  lerGrade, montarCatalogo, montarLinhas, colunasPara, colunaPublica, totais, validarValor, celulaDe,
  progressoDe, houveConflito, aplicarGravacao, consultorEfetivo, nomeComparavel, GRUPOS, GRUPO_OUTROS,
  type Grade, type ColunaInterna, type RegistroGestao, type Celula,
} from '../services/gerador/gestaoClientes';
import { lerRegistros, lerRegistroComVersao, gravarRegistro, ErroGestao } from '../services/gerador/gestaoClientesBanco';
import { lerCardSolarVendido, lerLigacao, type VendaCsvParaVinculo } from '../services/gerador/vendaSolarHub';
import { codigoDoAlocadorDoCard } from '../services/gerador/vendaSolarRegistro';
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
export async function vendaLigadaVale(cardId: number, codigo: string): Promise<boolean> {
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
  if (lig.venda && await vendaLigadaVale(cardId, lig.venda) && await vendaSolarDoDono(nome, false, lig.venda)) return card;
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

function celulaPublica(c: Celula): Celula {
  return c.origem === 'sistema' ? { valor: c.valor, origem: c.origem, por: c.por, em: c.em } : { valor: c.valor, origem: c.origem };
}

function textoValor(v: unknown): string {
  return v === null || v === undefined ? 'vazio' : String(v);
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
    const { colunas, linhas } = montarLinhas(pl.dados.grade, pl.dados.cols, registros, nome, socio);
    const presentes = new Set(colunas.map((c) => c.grupo));
    res.json({
      ok: true,
      papel: socio ? 'socio' : 'consultor',
      consultor: nome,
      em: agora,
      atualizadoEm: new Date(pl.dados.ts).toISOString(),
      fonte: { planilha: pl.atual },
      catalogo: {
        grupos: [...GRUPOS, GRUPO_OUTROS].filter((g) => presentes.has(g)),
        colunas: colunas.map(colunaPublica),
      },
      linhas: linhas.map((l) => ({
        codigo: l.codigo, cliente: l.cliente, consultor: l.consultor, progresso: l.progresso,
        celulas: Object.fromEntries(Object.entries(l.celulas).map(([k, c]) => [k, celulaPublica(c)])),
      })),
      totais: totais(linhas),
    });
  });

  // ── Gravar uma célula ──────────────────────────────────────────────────────
  router.post('/clientes/solar/campo', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const b = (req.body || {}) as { codigo?: unknown; coluna?: unknown; valor?: unknown; base_em?: unknown };
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
    const codigo = codigoCanonico(codigoRaw);

    let pl: { dados: CacheGrade; atual: boolean };
    try { pl = await grade(false); } catch {
      res.status(502).json({ ok: false, error: MSG_PLANILHA });
      return;
    }
    // 1º a POSSE da venda, antes de qualquer outra conferência: venda inexistente e venda de outro
    // consultor respondem IGUAL (404, mesma mensagem), senão a ordem das recusas revelaria que o código existe.
    const venda = pl.dados.grade.vendas.find((v) => v.codigo === codigo);
    let dono = false;
    if (venda) {
      try {
        const { reg } = await lerRegistroComVersao(codigo);
        dono = socio || podeVer(nome, consultorEfetivo(pl.dados.cols, venda.celulas, reg));
      } catch (err) {
        console.error('[clientes] leitura falhou', err instanceof ErroGestao ? err.codigo : 'interno');
        res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
        return;
      }
    }
    if (!venda || !dono) { res.status(404).json({ ok: false, error: 'Venda não encontrada.' }); return; }
    // Coluna de sócio para consultor dá a MESMA resposta de coluna que não existe.
    const col = pl.dados.cols.find((c) => c.chave === colunaRaw);
    if (!col || (!socio && col.quem_ve === 'socio')) {
      res.status(400).json({ ok: false, error: 'Coluna não encontrada.' });
      return;
    }
    if (col.chave === 'codigo' || col.calculada) {
      res.status(400).json({ ok: false, error: 'Esta coluna não pode ser editada.' });
      return;
    }
    // O consultor confere contra as opções que ELE recebe (escritas + as das vendas dele), nunca contra o catálogo inteiro:
    // senão "Marcos" digitado viraria a grafia de um engenheiro de venda alheia.
    let colValida: ColunaInterna = col;
    if (!socio && col.tipo === 'lista' && col.livre && col.chave !== 'consultor') {
      try {
        const regs = await lerRegistros(pl.dados.grade.vendas.map((x) => x.codigo));
        const dele = montarLinhas(pl.dados.grade, pl.dados.cols, regs, nome, false).colunas.find((c) => c.chave === col.chave);
        if (dele) colValida = dele;
      } catch (err) {
        console.error('[clientes] leitura falhou', err instanceof ErroGestao ? err.codigo : 'interno');
        res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
        return;
      }
    }
    const v = validarValor(colValida, b.valor);
    if (!v.ok) { res.status(400).json({ ok: false, error: v.erro }); return; }

    try {
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { reg, versao } = await lerRegistroComVersao(codigo);
        if (!(socio || podeVer(nome, consultorEfetivo(pl.dados.cols, venda.celulas, reg)))) {
          res.status(404).json({ ok: false, error: 'Venda não encontrada.' });
          return;
        }
        if (col.chave === 'consultor' && !socio) {
          res.status(403).json({ ok: false, error: 'Só sócio troca o consultor da venda.' });
          return;
        }
        const antesCel = celulaDe(col, venda.celulas[col.indice] ?? '', reg);
        const outro = houveConflito(reg, col.chave, baseEm, nome);
        if (outro) {
          res.status(409).json({
            ok: false, conflito: true,
            error: `${outro.por} alterou esta célula agora. Valor atual: ${textoValor(antesCel.valor)}`,
            por: outro.por, em: outro.em, celula: celulaPublica(antesCel),
          });
          return;
        }
        const colunas = colunasPara(pl.dados.cols, socio);
        const celulasDepois = (reg2: RegistroGestao): Record<string, Celula> => {
          const m: Record<string, Celula> = {};
          for (const c of colunas) if (c.chave !== 'codigo') m[c.chave] = celulaDe(c, venda.celulas[c.indice] ?? '', reg2);
          return m;
        };
        const mesmo = v.valor === null ? !reg.campos[col.chave] : (antesCel.origem === 'sistema' && antesCel.valor === v.valor);
        const agora = new Date().toISOString();
        let novo = reg;
        if (!mesmo) {
          novo = aplicarGravacao(reg, col, v.valor, antesCel.valor, nome, agora);
          if (!(await gravarRegistro(codigo, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
        }
        const celulas = celulasDepois(novo);
        res.json({
          ok: true,
          celula: celulaPublica(celulas[col.chave]),
          em: agora,
          progresso: progressoDe(colunas, celulas),
        });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
    } catch (err) {
      console.error('[clientes] gravar falhou', err instanceof ErroGestao ? err.codigo : 'interno');
      res.status(500).json({ ok: false, error: 'Não consegui gravar agora. Tente de novo.' });
    }
  });
}
