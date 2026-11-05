// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): O DINHEIRO DA OBRA. Regras puras: sem banco, sem rota e sem relógio.
//
//   - O lançamento do solar é o MESMO lançamento do financeiro (`fin:<card>:<id>`, `Lancamento` de `financeiroCliente.ts`), com dois
//     campos a mais: `obra` (etapa, grupo, conferência da IA, estorno, comissão, compra, carga) e `sig`. Todo lançamento solar é ASSINADO
//     (HMAC-SHA256 com `segredoDoVinculo()`): a chave pública do banco principal escreve no `system_state`, e uma linha forjada zeraria o
//     "a receber". Linha sem assinatura válida fica FORA da conta e conta em `ignoradas`, que trava o fechamento.
//   - Lançamento não se edita nem se apaga: o erro se corrige por ESTORNO, uma linha nova que anula a original na conta.
//   - Dinheiro é sempre centavo inteiro. Nenhuma soma em reais com ponto flutuante.
//   - A comissão de quem vendeu é CUSTO da obra. Os 2% de cada sócio são RETIRADA, à parte e fora do custo.
//
// Nada aqui põe valor, nome ou texto em log.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { segredoDoVinculo } from './vendaSolarHub';
import { listaSocios, nomeSimples } from './solarObras';
import type { LinhaComissao } from './jornadaSolar';
import {
  FORMAS, ID_LANCAMENTO, VALOR_MAX_CENTAVOS, DATA_MIN, DIAS_A_FRENTE, MAX_DESCRICAO, MAX_CONTRAPARTE, MAX_ID_TRANSACAO, MAX_NOME_ARQUIVO,
  dataReal, somaDias, ordenarLancamentos,
  type ArquivoLancamento, type Lancamento, type LidoPelaIa,
} from './financeiroCliente';

// ── Categorias ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type GrupoLanc = 'entrada' | 'custo' | 'retirada';
export type GrupoPrevisto = 'comissao_venda' | 'homologacao' | 'material' | 'frete' | 'mao_de_obra' | 'outros';
export const GRUPOS_DO_PREVISTO: ReadonlyArray<{ grupo: GrupoPrevisto; rotulo: string }> = [
  { grupo: 'comissao_venda', rotulo: 'Comissão de venda' },
  { grupo: 'homologacao', rotulo: 'Homologação (ART e projeto)' },
  { grupo: 'material', rotulo: 'Material' },
  { grupo: 'frete', rotulo: 'Frete' },
  { grupo: 'mao_de_obra', rotulo: 'Mão de obra' },
  { grupo: 'outros', rotulo: 'Outros' },
];

export interface CategoriaObra {
  tipo: 'entrada' | 'saida';
  slug: string;
  rotulo: string;
  grupo: GrupoLanc;
  previsto: GrupoPrevisto | null;
  /** 'rota' = só pela rota da comissão. */
  quem: 'giovanna_adm' | 'quem_ve' | 'rota';
}
const ent = (slug: string, rotulo: string): CategoriaObra => ({ tipo: 'entrada', slug, rotulo, grupo: 'entrada', previsto: null, quem: 'giovanna_adm' });
const sai = (slug: string, rotulo: string, previsto: GrupoPrevisto, quem: CategoriaObra['quem'] = 'quem_ve'): CategoriaObra =>
  ({ tipo: 'saida', slug, rotulo, grupo: 'custo', previsto, quem });

export const CATEGORIAS_OBRA: readonly CategoriaObra[] = [
  ent('entrada', 'Entrada'),
  ent('parcela', 'Parcela'),
  ent('financiamento', 'Financiamento liberado'),
  ent('a_vista', 'Pagamento à vista'),
  ent('outros', 'Outra entrada (descrição obrigatória)'),
  sai('comissao_venda', 'Comissão de venda', 'comissao_venda', 'rota'),
  sai('art', 'ART', 'homologacao'),
  sai('projeto_eletrico', 'Projeto elétrico (engenheiro)', 'homologacao'),
  sai('taxa_distribuidora', 'Taxa da distribuidora', 'homologacao'),
  sai('equipamento', 'Equipamento (kit)', 'material'),
  sai('material', 'Material', 'material'),
  sai('material_extra', 'Material extra', 'outros'),
  sai('frete', 'Frete', 'frete'),
  sai('mao_de_obra', 'Mão de obra', 'mao_de_obra'),
  sai('combustivel', 'Combustível', 'outros'),
  sai('alimentacao', 'Alimentação da equipe', 'outros'),
  sai('cartorio', 'Cartório', 'outros'),
  sai('imposto', 'Imposto', 'outros'),
  sai('outros', 'Outros (descrição obrigatória)', 'outros'),
  sai('premio_indicacao', 'Prêmio de quem indicou', 'outros', 'giovanna_adm'),
  { tipo: 'saida', slug: 'retirada_socio', rotulo: 'Retirada do sócio', grupo: 'retirada', previsto: null, quem: 'rota' },
];

/** Há prêmio de indicação vivo (não apagado, não estorno e não estornado) entre os lançamentos de uma obra? */
export const premioVivo = (ls: readonly LancamentoObra[]): boolean => {
  const vivos = ls.filter((l) => l.apagado === false);
  const estornados = new Set(vivos.filter((l) => l.obra.estorno_de).map((l) => l.obra.estorno_de as string));
  return vivos.some((l) => l.categoria === 'premio_indicacao' && !l.obra.estorno_de && !estornados.has(l.id));
};

export const categoriaObra = (tipo: unknown, slug: unknown): CategoriaObra | null =>
  CATEGORIAS_OBRA.find((c) => c.tipo === tipo && c.slug === slug) ?? null;

// ── O lançamento da obra ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * `conferido_adm`: o ADM marcou como conferida uma linha que a IA não conferiu (`sem_leitura`, `baixa_confianca` ou `divergente`).
 * `divergente` (05/11/2026): a IA leu um valor diferente do que a pessoa digitou; a linha salva e fica para o ADM conferir.
 * `sem_comprovante` (05/11/2026): saída lançada sem arquivo; fica pendente até anexar ou até o ADM fechar sem comprovante.
 * Valor novo entra SEMPRE no fim da lista, e campo novo da linha só entra como chave condicional (`...(x ? { x } : {})`): a assinatura de cada
 * linha que já existe é sobre o JSON normalizado, e uma chave nova emitida sempre mudaria o JSON de todas elas.
 */
export const CONFERENCIAS = ['bateu', 'sem_leitura', 'baixa_confianca', 'divergente_adm', 'estorno', 'conferido_adm', 'divergente', 'sem_comprovante'] as const;
export type Conferencia = typeof CONFERENCIAS[number];
export interface ComissaoLanc { nome: string; papel: 'venda' | 'socio'; pb: number }
export interface ObraLanc {
  v: 1;
  etapa: number;
  grupo: GrupoLanc;
  conferencia: Conferencia;
  estorno_de: string | null;
  motivo_estorno: string;
  devolucao: boolean;
  comissao: ComissaoLanc | null;
  compra_id: string | null;
  carga_id: string | null;
  /** Só existe quando a IA não reconheceu o arquivo como comprovante ("A IA não reconheceu como comprovante"). */
  nota_ia?: string;
  /** Só existe na linha `divergente`: o valor que a IA leu e o que a pessoa digitou. */
  divergencia?: { lido_centavos: number; digitado_centavos: number };
  /** Só existe quando o ADM marcou "Fechar sem comprovante": a linha sem arquivo deixa de travar o fechamento. */
  dispensa?: { em: string; por: string; motivo: string };
}
/** Quem mudou a marca de conferência da linha, quando e de quê para quê (a linha é reassinada; nada se apaga). */
export interface AlteracaoObra { em: string; por: string; de: string; para: string; motivo?: string }
export type LancamentoObraSemSig = Omit<Lancamento, 'ja_foi_saida' | 'obra' | 'sig' | 'alteracoes'> & { obra: ObraLanc; alteracoes: AlteracaoObra[] };
export type LancamentoObra = LancamentoObraSemSig & { sig: string };

export const ID_VINCULO = /^[A-Za-z0-9-]{3,40}$/;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const inteiro = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const tem = (m: Record<string, string>, k: string): boolean => Object.prototype.hasOwnProperty.call(m, k);

/** O id fixo do estorno (D4): o segundo estorno da mesma linha bate no 23505 e vira 409. */
export const idDoEstorno = (idOriginal: string): string => `est-${crypto.createHash('sha256').update(String(idOriginal)).digest('hex').slice(0, 40)}`;

function arquivoNormal(v: unknown): ArquivoLancamento | null {
  const a = obj(v);
  if (!a || typeof a.path !== 'string' || !a.path) return null;
  return {
    path: a.path.slice(0, 300), nome: txt(a.nome, MAX_NOME_ARQUIVO), tipo: txt(a.tipo, 60),
    tamanho: inteiro(a.tamanho, 0, 100_000_000) ?? 0, sha256: typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256) ? a.sha256 : '',
  };
}
function lidoNormal(v: unknown): LidoPelaIa | null {
  const l = obj(v);
  if (!l) return null;
  return {
    valor_centavos: inteiro(l.valor_centavos, 0, VALOR_MAX_CENTAVOS),
    data: typeof l.data === 'string' && dataReal(l.data) ? l.data : null,
    id_transacao: typeof l.id_transacao === 'string' ? txt(l.id_transacao, MAX_ID_TRANSACAO) : null,
  };
}
function obraNormal(v: unknown, tipo: 'entrada' | 'saida'): ObraLanc | null {
  const o = obj(v);
  if (!o || o.v !== 1) return null;
  const etapa = inteiro(o.etapa, 1, 9);
  if (!etapa) return null;
  const grupo = o.grupo;
  if (grupo !== 'entrada' && grupo !== 'custo' && grupo !== 'retirada') return null;
  if ((tipo === 'entrada') !== (grupo === 'entrada')) return null;
  const conferencia = CONFERENCIAS.find((c) => c === o.conferencia);
  if (!conferencia) return null;
  const est = typeof o.estorno_de === 'string' && ID_LANCAMENTO.test(o.estorno_de) ? o.estorno_de : null;
  const com = obj(o.comissao);
  const pb = com ? inteiro(com.pb, 0, 2000) : null;
  const comNome = com ? nomeSimples(txt(com.nome, 60)).slice(0, 60) : '';
  const comissao: ComissaoLanc | null = com && pb !== null && comNome && (com.papel === 'venda' || com.papel === 'socio')
    ? { nome: comNome, papel: com.papel, pb } : null;
  const notaIa = txt(o.nota_ia, 120);
  const dv = obj(o.divergencia);
  const lidoC = dv ? inteiro(dv.lido_centavos, 1, VALOR_MAX_CENTAVOS) : null;
  const digC = dv ? inteiro(dv.digitado_centavos, 1, VALOR_MAX_CENTAVOS) : null;
  const dp = obj(o.dispensa);
  const dpEm = dp ? txt(dp.em, 40) : '';
  const dpPor = dp ? nomeSimples(txt(dp.por, 60)).slice(0, 60) : '';
  const dpMotivo = dp ? txt(dp.motivo, 300) : '';
  return {
    v: 1, etapa, grupo, conferencia, estorno_de: est, motivo_estorno: est ? txt(o.motivo_estorno, 300) : '',
    devolucao: est !== null && o.devolucao === true, comissao,
    compra_id: typeof o.compra_id === 'string' && ID_VINCULO.test(o.compra_id) ? o.compra_id : null,
    carga_id: typeof o.carga_id === 'string' && ID_VINCULO.test(o.carga_id) ? o.carga_id : null,
    // Chaves condicionais, no fim: a linha que já existe (sem nenhuma delas) continua com o mesmo JSON e a mesma assinatura.
    ...(notaIa ? { nota_ia: notaIa } : {}),
    ...(lidoC !== null && digC !== null ? { divergencia: { lido_centavos: lidoC, digitado_centavos: digC } } : {}),
    ...(dpEm && dpPor && dpMotivo ? { dispensa: { em: dpEm, por: dpPor, motivo: dpMotivo } } : {}),
  };
}

/**
 * O lançamento da obra no formato fixo (chaves escritas à mão, em TODO nível, na ordem do contrato; nada de espalhamento do valor de
 * entrada). `value` vem do jsonb, que guarda as chaves em OUTRA ordem: a assinatura é sobre este normalizado. null = não é um lançamento
 * solar válido (categoria fora da lista do tipo, valor, data ou `obra` inválidos, ou card diferente).
 */
export function normalizarLancamentoObra(card: number, value: unknown): LancamentoObraSemSig | null {
  const v = obj(value);
  if (!v || !Number.isInteger(card) || card <= 0 || v.card_id !== card) return null;
  if (typeof v.id !== 'string' || !ID_LANCAMENTO.test(v.id)) return null;
  if (v.tipo !== 'entrada' && v.tipo !== 'saida') return null;
  const tipo = v.tipo;
  const cat = categoriaObra(tipo, v.categoria);
  if (!cat) return null;
  const valor = inteiro(v.valor_centavos, 1, VALOR_MAX_CENTAVOS);
  if (!valor || typeof v.data !== 'string' || !dataReal(v.data)) return null;
  const obra = obraNormal(v.obra, tipo);
  if (!obra || obra.grupo !== cat.grupo) return null;
  const forma = typeof v.forma === 'string' && (v.forma === '' || tem(FORMAS, v.forma)) ? v.forma : '';
  return {
    id: v.id, card_id: card, tipo, categoria: cat.slug, valor_centavos: valor, data: v.data, forma,
    descricao: txt(v.descricao, MAX_DESCRICAO), contraparte: txt(v.contraparte, MAX_CONTRAPARTE), id_transacao: txt(v.id_transacao, MAX_ID_TRANSACAO),
    arquivo: arquivoNormal(v.arquivo), origem: v.origem === 'ia' ? 'ia' : 'manual', lido_pela_ia: lidoNormal(v.lido_pela_ia),
    criado_por: nomeSimples(txt(v.criado_por, 60)).slice(0, 60), criado_em: txt(v.criado_em, 40),
    alteracoes: lista(v.alteracoes).map((a) => obj(a)).filter((a): a is Record<string, unknown> => !!a && typeof a.em === 'string' && typeof a.por === 'string')
      .map((a) => ({ em: txt(a.em, 40), por: nomeSimples(txt(a.por, 60)).slice(0, 60), de: txt(a.de, 30), para: txt(a.para, 30), ...(txt(a.motivo, 300) ? { motivo: txt(a.motivo, 300) } : {}) })).slice(-10),
    apagado: false, apagado_por: '', apagado_em: '', motivo_apagado: '',
    obra,
  };
}

/** HMAC de `fin_obra|card|id|JSON` do normalizado (sem `sig`), ou null sem segredo ou sem formato válido. */
export function assinarLancamentoObra(card: number, l: unknown): string | null {
  const segredo = segredoDoVinculo();
  if (!segredo) return null;
  const n = normalizarLancamentoObra(card, l);
  if (!n) return null;
  return crypto.createHmac('sha256', segredo).update(`fin_obra|${card}|${n.id}|${JSON.stringify(n)}`).digest('hex');
}

/** Normalizado + `sig` pronto para gravar, ou null. */
export function lancamentoObraParaGravar(card: number, l: unknown): LancamentoObra | null {
  const n = normalizarLancamentoObra(card, l);
  const sig = n ? assinarLancamentoObra(card, n) : null;
  return n && sig ? { ...n, sig } : null;
}

/** O lançamento do `value` do banco SE a assinatura confere; senão null. */
export function lancamentoObraAssinado(card: number, value: unknown): LancamentoObra | null {
  const n = normalizarLancamentoObra(card, value);
  const sig = obj(value)?.sig;
  const esperada = n ? assinarLancamentoObra(card, n) : null;
  if (n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8'))) return { ...n, sig };
  return null;
}

// ── Montagem (a validação de entrada de UM lançamento novo) ───────────────────────────────────────────────────────────────

export type ContextoObra = { cardId: number; autor: string; agoraIso: string; hojeBr: string };
export type ResultadoMontagem = { ok: true; lancamento: LancamentoObraSemSig } | { ok: false; erro: string };
const falha = (erro: string): { ok: false; erro: string } => ({ ok: false, erro });

/**
 * Valida e monta UM lançamento novo. `entrada` mistura o que o navegador mandou (tipo, categoria, valor, data, forma, textos, etapa,
 * compra e carga) com o que SÓ o servidor sabe (`arquivo`, `lido_pela_ia`, `id_transacao`, `origem`, `conferencia`, `comissao`,
 * `estorno_de`...). O autor vem do contexto, nunca da entrada. O grupo sai da categoria.
 */
export function montarLancamentoObra(entrada: unknown, ctx: ContextoObra): ResultadoMontagem {
  const e = obj(entrada);
  if (!e) return falha('corpo_invalido');
  if (typeof e.id !== 'string' || !ID_LANCAMENTO.test(e.id)) return falha('id_invalido');
  if (e.tipo !== 'entrada' && e.tipo !== 'saida') return falha('tipo_invalido');
  const cat = categoriaObra(e.tipo, e.categoria);
  if (!cat) return falha('categoria_invalida');
  if (typeof e.valor_centavos !== 'number' || !Number.isInteger(e.valor_centavos) || e.valor_centavos < 1 || e.valor_centavos > VALOR_MAX_CENTAVOS) return falha('valor_invalido');
  if (typeof e.data !== 'string' || !dataReal(e.data) || e.data < DATA_MIN || e.data > somaDias(ctx.hojeBr, DIAS_A_FRENTE)) return falha('data_invalida');
  if (e.forma !== undefined && (typeof e.forma !== 'string' || (e.forma !== '' && !tem(FORMAS, e.forma)))) return falha('forma_invalida');
  for (const k of ['descricao', 'contraparte', 'id_transacao'] as const) {
    if (e[k] !== undefined && typeof e[k] !== 'string') return falha('texto_invalido');
  }
  const descricao = txt(e.descricao, MAX_DESCRICAO);
  if (cat.slug === 'outros' && !descricao) return falha('descricao_obrigatoria');
  const etapa = inteiro(e.etapa, 1, 9);
  if (!etapa) return falha('etapa_invalida');
  const conferencia = CONFERENCIAS.find((c) => c === e.conferencia);
  if (!conferencia) return falha('corpo_invalido');
  for (const k of ['compra_id', 'carga_id'] as const) {
    if (e[k] !== undefined && e[k] !== null && (typeof e[k] !== 'string' || !ID_VINCULO.test(e[k] as string))) return falha('vinculo_invalido');
  }
  const estorno = typeof e.estorno_de === 'string' ? e.estorno_de : null;
  const com = obj(e.comissao);
  const candidato = {
    id: e.id, card_id: ctx.cardId, tipo: e.tipo, categoria: cat.slug, valor_centavos: e.valor_centavos, data: e.data,
    forma: typeof e.forma === 'string' ? e.forma : '', descricao, contraparte: txt(e.contraparte, MAX_CONTRAPARTE),
    id_transacao: txt(e.id_transacao, MAX_ID_TRANSACAO), arquivo: e.arquivo ?? null, origem: e.origem === 'ia' ? 'ia' : 'manual',
    lido_pela_ia: e.lido_pela_ia ?? null, criado_por: ctx.autor, criado_em: ctx.agoraIso,
    obra: {
      v: 1, etapa, grupo: cat.grupo, conferencia, estorno_de: estorno, motivo_estorno: txt(e.motivo_estorno, 300),
      devolucao: e.devolucao === true, comissao: com ?? null,
      compra_id: typeof e.compra_id === 'string' ? e.compra_id : null, carga_id: typeof e.carga_id === 'string' ? e.carga_id : null,
      nota_ia: e.nota_ia, divergencia: e.divergencia,
    },
  };
  const n = normalizarLancamentoObra(ctx.cardId, candidato);
  if (!n) return falha('corpo_invalido');
  return { ok: true, lancamento: n };
}

// ── Os Ajustes (a regra das comissões) ───────────────────────────────────────────────────────────────────────────────

export interface LinhaRegra { nome: string; papel: 'venda' | 'socio'; pb: number }
export interface AjustesSolar {
  v: 1;
  comissoes: Record<string, LinhaRegra[]>;
  dinheiro_aberto: boolean;
  editado_em: string;
  editado_por: string;
}
const L = (nome: string, papel: 'venda' | 'socio', pb: number): LinhaRegra => ({ nome, papel, pb });
export const CHAVES_FIXAS_AJUSTES = ['nilce', 'diego', 'thiago', 'giovanna', 'padrao'] as const;
const regraPadrao = (): Record<string, LinhaRegra[]> => ({
  nilce: [L('nilce', 'venda', 500), L('thiago', 'socio', 200), L('diego', 'socio', 200)],
  diego: [L('diego', 'venda', 500), L('diego', 'socio', 200), L('thiago', 'socio', 200)],
  thiago: [L('thiago', 'venda', 500), L('thiago', 'socio', 200), L('diego', 'socio', 200)],
  giovanna: [L('giovanna', 'venda', 300), L('thiago', 'socio', 200), L('diego', 'socio', 200)],
  padrao: [L('*', 'venda', 500), L('thiago', 'socio', 200), L('diego', 'socio', 200)],
});
export const AJUSTES_PADRAO: AjustesSolar = { v: 1, comissoes: regraPadrao(), dinheiro_aberto: true, editado_em: '', editado_por: '' };

export const MAX_NOMES_EXTRAS = 6;
export const MAX_PB = 2000;

/** Valida as comissões do PUT. Chave que falta nas cinco fixas fica com o padrão. */
export function validarAjustes(entrada: unknown, socios: readonly string[] = listaSocios()): { ok: true; comissoes: Record<string, LinhaRegra[]> } | { ok: false; erro: string } {
  const e = obj(entrada);
  if (!e) return falha('ajustes_invalidos');
  const padrao = regraPadrao();
  const fixas: ReadonlySet<string> = new Set(CHAVES_FIXAS_AJUSTES);
  const extras = Object.keys(e).filter((k) => !fixas.has(k)).sort();
  if (extras.length > MAX_NOMES_EXTRAS) return falha('nomes_demais');
  const saida: Record<string, LinhaRegra[]> = {};
  const pares: Array<[string, unknown]> = [];
  for (const k of CHAVES_FIXAS_AJUSTES) pares.push([k, e[k] === undefined ? padrao[k] : e[k]]);
  for (const k of extras) pares.push([nomeSimples(k), e[k]]);
  for (const [chave, lista] of pares) {
    if (!fixas.has(chave) && (!/^[a-z0-9][a-z0-9 _-]{1,29}$/.test(chave) || chave in saida)) return falha('nome_invalido');
    if (!Array.isArray(lista) || lista.length < 1 || lista.length > 4) return falha('lista_invalida');
    const linhas: LinhaRegra[] = [];
    let vendas = 0;
    let soma = 0;
    for (const x of lista) {
      const o = obj(x);
      if (!o || (o.papel !== 'venda' && o.papel !== 'socio')) return falha('linha_invalida');
      const pb = inteiro(o.pb, 0, MAX_PB);
      if (pb === null) return falha('pb_invalido');
      const nome = nomeSimples(txt(o.nome, 60)).slice(0, 60);
      if (o.papel === 'venda') {
        vendas++;
        if (nome !== (chave === 'padrao' ? '*' : chave)) return falha('venda_invalida');
      } else if (!nome || !socios.includes(nome)) {
        return falha('socio_invalido');
      }
      soma += pb;
      linhas.push({ nome, papel: o.papel, pb });
    }
    if (vendas !== 1) return falha('uma_venda');
    if (soma > MAX_PB) return falha('soma_alta');
    saida[chave] = linhas;
  }
  return { ok: true, comissoes: saida };
}

function ordemDasChaves(c: Record<string, LinhaRegra[]>): string[] {
  const fixas: ReadonlySet<string> = new Set(CHAVES_FIXAS_AJUSTES);
  return [...CHAVES_FIXAS_AJUSTES.filter((k) => k in c), ...Object.keys(c).filter((k) => !fixas.has(k)).sort()];
}

/** O normalizado (chaves em ordem fixa) de um `value`, ou null quando não vale. */
export function normalizarAjustes(value: unknown): AjustesSolar | null {
  const v = obj(value);
  if (!v || v.v !== 1) return null;
  const r = validarAjustes(v.comissoes);
  if (!r.ok) return null;
  const comissoes: Record<string, LinhaRegra[]> = {};
  for (const k of ordemDasChaves(r.comissoes)) comissoes[k] = r.comissoes[k].map((l) => ({ nome: l.nome, papel: l.papel, pb: l.pb }));
  const em = typeof v.editado_em === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v.editado_em) ? v.editado_em : '';
  return { v: 1, comissoes, dinheiro_aberto: v.dinheiro_aberto !== false, editado_em: em, editado_por: nomeSimples(txt(v.editado_por, 60)).slice(0, 60) };
}

/** HMAC de `ajustes_solar|JSON`, ou null sem segredo ou sem formato válido. */
export function assinarAjustes(a: unknown): string | null {
  const segredo = segredoDoVinculo();
  const n = normalizarAjustes(a);
  if (!segredo || !n) return null;
  return crypto.createHmac('sha256', segredo).update(`ajustes_solar|${JSON.stringify(n)}`).digest('hex');
}

/** Os Ajustes do `value` SE a assinatura confere; senão null (quem chama usa o padrão). */
export function ajustesAssinados(value: unknown): AjustesSolar | null {
  const n = normalizarAjustes(value);
  const sig = obj(value)?.sig;
  const esperada = n ? assinarAjustes(n) : null;
  return n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8')) ? n : null;
}

/**
 * A regra do vendedor: `comissoes[nomeSimples(vendedor)]`, senão `padrao` (o `*` vira o vendedor) com o aviso "Regra padrão. Confirme com o Thiago.".
 */
export function regraDoVendedor(vendedor: string, ajustes: AjustesSolar = AJUSTES_PADRAO): { linhas: LinhaRegra[]; aviso: string | null } {
  const v = nomeSimples(vendedor);
  const propria = v ? ajustes.comissoes[v] : undefined;
  if (propria) return { linhas: propria.map((l) => ({ ...l })), aviso: null };
  const padrao = ajustes.comissoes.padrao ?? AJUSTES_PADRAO.comissoes.padrao;
  return { linhas: padrao.map((l) => (l.nome === '*' ? { ...l, nome: v || 'vendedor' } : { ...l })), aviso: 'Regra padrão. Confirme com o Thiago.' };
}

/** A regra do vendedor aplicada ao valor vendido. Mesmo arredondamento da Fase 1 (`comissoesDaVenda`). */
export function comissoesPelaRegra(vendedor: string, valorCentavos: number, ajustes: AjustesSolar = AJUSTES_PADRAO): { linhas: LinhaComissao[]; aviso: string | null } {
  const r = regraDoVendedor(vendedor, ajustes);
  return { linhas: linhasDaRegra(r.linhas, valorCentavos), aviso: r.aviso };
}

/** Aplica uma lista de linhas ao valor vendido (centavos inteiros, `Math.round(valor * pb / 10000)`). */
export function linhasDaRegra(regra: readonly LinhaRegra[], valorCentavos: number): LinhaComissao[] {
  const valor = Number.isFinite(valorCentavos) && valorCentavos > 0 ? Math.round(valorCentavos) : 0;
  return regra.map((l) => ({
    nome: l.nome, papel: l.papel, pb: l.pb, valor_centavos: Math.round(valor * l.pb / 10000), onde: l.papel === 'venda' ? 'custo' : 'retirada',
  }));
}

// ── O livro ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const reaisBR = (centavos: number): string => {
  const neg = centavos < 0;
  const a = Math.abs(Math.round(centavos));
  const inteiros = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${inteiros},${String(a % 100).padStart(2, '0')}`;
};
const pbTexto = (pb: number): string => `${String(pb / 100).replace('.', ',')}%`;
/** Percentual com uma casa: `Math.round(parte * 1000 / venda) / 10`. */
export const percentual = (parte: number, venda: number): number => Math.round(parte * 1000 / venda) / 10;
const nomeBonito = (n: string): string => (n ? n.charAt(0).toUpperCase() + n.slice(1) : n);

export interface Pendencia {
  tipo: 'comissao' | 'engenheiro' | 'compra' | 'equipe' | 'frete'; texto: string; valor_centavos: number | null; etapa: number;
  /** Comissão paga a mais que a devida (a venda foi corrigida para baixo): o valor é o que falta DEVOLVER e não soma no "a pagar". */
  devolver?: boolean;
  /** Só na pendência de comissão: de quem VENDEU (custo) ou do sócio (retirada, que só o ADM e a Giovanna veem). */
  papel?: 'venda' | 'socio';
}

export interface EntradaLivro {
  /** Já conferidos pela assinatura. */
  lancamentos: readonly LancamentoObra[];
  ignoradas: number;
  vendaCentavos: number | null;
  vendedor: string;
  /** A regra vigente: a congelada na obra, senão a dos Ajustes. */
  regra: readonly LinhaRegra[];
  regraCongelada?: boolean;
  regraAviso?: string | null;
  previsto: PrevistoCentavos | null;
  pendenciasDaObra: readonly Pendencia[];
  /** Etapa 3 marcada "engenheiro a pagar". */
  engenheiroAPagar?: boolean;
  /** O item "material com origem" da Compra (N de M). */
  material?: { com_origem: number; total: number };
  adm: boolean;
}
type PrevistoCentavos = { homologacao: number; material: number; frete: number; mao_de_obra: number; outros: number };

export interface LinhaLivro {
  id: string; tipo: 'entrada' | 'saida'; data: string; etapa: number; grupo: GrupoLanc; categoria: string; rotulo: string; descricao: string;
  contraparte: string; forma: string; valor_centavos: number; criado_por: string; criado_em: string; conferencia: Conferencia;
  comprovante: { nome: string; url: string | null } | null;
  estornada: { id: string; em: string; por: string; motivo: string } | null;
  estorno_de: string | null; devolucao: boolean; compra_id: string | null; carga_id: string | null;
  comissao: ComissaoLanc | null;
  /** Saída sem arquivo que ainda trava o fechamento (não estornada, nem estorno, nem liberada pelo ADM). */
  sem_comprovante: boolean;
  /** O ADM marcou "Fechar sem comprovante". */
  dispensa: { em: string; por: string; motivo: string } | null;
  /** Só na linha `divergente`: o que a IA leu e o que a pessoa digitou. */
  divergencia: { lido_centavos: number; digitado_centavos: number } | null;
  nota_ia: string;
}
/** `pago`: a última linha viva e não estornada. `pago_centavos`: o líquido pago (estornos subtraem). `diferenca_centavos`: devida (pelo valor ATUAL da venda) menos paga. */
export interface LinhaComissaoLivro extends LinhaComissao { pago: { id: string; data: string } | null; pago_centavos: number; diferenca_centavos: number }
export interface GrupoPrevistoLivro { grupo: GrupoPrevisto; rotulo: string; previsto: number; real: number; diferenca: number }
export interface Fechamento {
  a_receber: number | null;
  a_pagar_total: number;
  pendencias: number;
  /** `com` = tem arquivo, foi liberada pelo ADM ou foi estornada. */
  comprovantes: { com: number; total: number };
  custo: number;
  previsto: number | null;
  diferenca: number | null;
  material: { com_origem: number; total: number };
  faltam: string[];
  pode_fechar: boolean;
  /** `pode_fechar` sem contar o item de material (o item "dinheiro" da etapa 8). */
  pode_fechar_sem_material: boolean;
  adm?: { sobra: number | null; sobra_pct: number | null; retirada: number; fica: number | null; fica_pct: number | null };
}
export interface Livro {
  venda_centavos: number | null;
  recebido: number;
  recebido_a_mais: number;
  a_receber: number | null;
  gasto: number;
  retirada: number;
  saldo: number;
  por_etapa: Record<string, number>;
  linhas: LinhaLivro[];
  comissoes: { vendedor: string; aviso: string | null; congelada: boolean; liberadas: boolean; linhas: LinhaComissaoLivro[] };
  previsto: { grupos: GrupoPrevistoLivro[]; total: { previsto: number; real: number; diferenca: number } } | null;
  a_pagar: Pendencia[];
  ignoradas: number;
  fechamento: Fechamento;
}

/** A linha não tem arquivo e o ADM não a liberou. Estorno sem devolução nunca tem arquivo e fica de fora. */
const semComprovante = (l: LancamentoObra): boolean => !l.arquivo && !l.obra.dispensa && !(l.obra.estorno_de && !l.obra.devolucao);
/** A IA não conferiu o valor e o ADM ainda não marcou: a conta não fecha. */
const NAO_CONFERIDAS: readonly Conferencia[] = ['sem_leitura', 'baixa_confianca', 'divergente'];
const TXT_FALTA_COMPROVANTE = 'Falta comprovante:';
const textoFaltaComprovante = (n: number): string => `${TXT_FALTA_COMPROVANTE} ${n} ${n === 1 ? 'lançamento' : 'lançamentos'}.`;

export function livroDaObra(e: EntradaLivro): Livro {
  const vivos = e.lancamentos.filter((l) => l.apagado === false);
  // Estornada = existe um estorno vivo (da mesma obra) apontando para o id dela.
  const estornoDe = new Map<string, LancamentoObra>();
  for (const l of vivos) if (l.obra.estorno_de) estornoDe.set(l.obra.estorno_de, l);
  const sinal = (l: LancamentoObra): number => (l.obra.estorno_de ? -l.valor_centavos : l.valor_centavos);
  const estornada = (l: LancamentoObra): boolean => !l.obra.estorno_de && estornoDe.has(l.id);

  let recebido = 0;
  let gasto = 0;
  let retirada = 0;
  const porEtapa: Record<string, number> = {};
  for (let n = 1; n <= 9; n++) porEtapa[String(n)] = 0;
  const realDoGrupo = new Map<GrupoPrevisto, number>();
  for (const l of vivos) {
    const s = sinal(l);
    if (l.obra.grupo === 'entrada') recebido += s;
    else if (l.obra.grupo === 'retirada') retirada += s;
    else {
      gasto += s;
      porEtapa[String(l.obra.etapa)] += s;
      const g = categoriaObra(l.tipo, l.categoria)?.previsto;
      if (g) realDoGrupo.set(g, (realDoGrupo.get(g) ?? 0) + s);
    }
  }
  const venda = e.vendaCentavos;
  const aReceber = venda === null ? null : Math.max(0, venda - recebido);
  const aMais = venda === null ? 0 : Math.max(0, recebido - venda);
  const saldo = recebido - gasto - retirada;

  const linhas: LinhaLivro[] = ordenarLancamentos(vivos).map((l) => {
    const est = estornada(l) ? estornoDe.get(l.id)! : null;
    return {
      id: l.id, tipo: l.tipo, data: l.data, etapa: l.obra.etapa, grupo: l.obra.grupo, categoria: l.categoria,
      rotulo: categoriaObra(l.tipo, l.categoria)?.rotulo ?? l.categoria, descricao: l.descricao, contraparte: l.contraparte, forma: l.forma,
      valor_centavos: l.valor_centavos, criado_por: l.criado_por, criado_em: l.criado_em, conferencia: l.obra.conferencia,
      comprovante: l.arquivo ? { nome: l.arquivo.nome, url: null } : null,
      estornada: est ? { id: est.id, em: est.criado_em, por: est.criado_por, motivo: est.obra.motivo_estorno } : null,
      estorno_de: l.obra.estorno_de, devolucao: l.obra.devolucao, compra_id: l.obra.compra_id, carga_id: l.obra.carga_id, comissao: l.obra.comissao,
      sem_comprovante: semComprovante(l) && !estornada(l), dispensa: l.obra.dispensa ?? null, divergencia: l.obra.divergencia ?? null, nota_ia: l.obra.nota_ia ?? '',
    };
  });

  // Comissões pela regra vigente, sobre o valor ATUAL da venda. Paga = os lançamentos vivos com o mesmo nome e papel (o estorno subtrai).
  const liberadas = recebido > 0;
  const regraLinhas = linhasDaRegra(e.regra, venda ?? 0);
  const comLinhas: LinhaComissaoLivro[] = regraLinhas.map((r) => {
    const deles = vivos.filter((l) => l.obra.comissao && l.obra.comissao.nome === r.nome && l.obra.comissao.papel === r.papel);
    const liquido = deles.reduce((acc, l) => acc + sinal(l), 0);
    const ult = [...deles].reverse().find((l) => !l.obra.estorno_de && !estornada(l));
    return { ...r, pago: liquido > 0 && ult ? { id: ult.id, data: ult.data } : null, pago_centavos: liquido, diferenca_centavos: r.valor_centavos - liquido };
  });

  // O "a pagar" (seção 3.3). A comissão que a venda corrigida deixou maior que a paga aparece como diferença; a paga a mais, como "a devolver".
  const pend: Pendencia[] = [];
  if (liberadas && venda) {
    for (const r of comLinhas) {
      const papel = r.papel === 'venda' ? `venda ${pbTexto(r.pb)}` : `sócio ${pbTexto(r.pb)}`;
      const quem = `Comissão de ${nomeBonito(r.nome)} (${papel})`;
      if (r.pago_centavos <= 0) {
        if (r.valor_centavos > 0) pend.push({ tipo: 'comissao', texto: `${quem}: ${reaisBR(r.valor_centavos)}`, valor_centavos: r.valor_centavos, etapa: 2, papel: r.papel });
      } else if (r.diferenca_centavos > 0) {
        pend.push({ tipo: 'comissao', texto: `${quem}: faltam ${reaisBR(r.diferenca_centavos)}`, valor_centavos: r.diferenca_centavos, etapa: 2, papel: r.papel });
      } else if (r.diferenca_centavos < 0) {
        pend.push({ tipo: 'comissao', texto: `${quem}: a devolver ${reaisBR(-r.diferenca_centavos)}`, valor_centavos: -r.diferenca_centavos, etapa: 2, devolver: true, papel: r.papel });
      }
    }
  }
  if (e.engenheiroAPagar && !vivos.some((l) => l.categoria === 'projeto_eletrico' && !l.obra.estorno_de && !estornada(l))) {
    pend.push({ tipo: 'engenheiro', texto: 'Engenheiro: valor a lançar', valor_centavos: null, etapa: 3 });
  }
  pend.push(...e.pendenciasDaObra);

  // Previsto x real.
  let previsto: Livro['previsto'] = null;
  if (e.previsto) {
    const prevComissao = regraLinhas.filter((r) => r.papel === 'venda').reduce((s, r) => s + r.valor_centavos, 0);
    const prev: Record<GrupoPrevisto, number> = {
      comissao_venda: prevComissao, homologacao: e.previsto.homologacao, material: e.previsto.material, frete: e.previsto.frete,
      mao_de_obra: e.previsto.mao_de_obra, outros: e.previsto.outros,
    };
    const grupos = GRUPOS_DO_PREVISTO.map(({ grupo, rotulo }) => {
      const real = realDoGrupo.get(grupo) ?? 0;
      return { grupo, rotulo, previsto: prev[grupo], real, diferenca: prev[grupo] - real };
    });
    const tp = grupos.reduce((s, g) => s + g.previsto, 0);
    const tr = grupos.reduce((s, g) => s + g.real, 0);
    previsto = { grupos, total: { previsto: tp, real: tr, diferenca: tp - tr } };
  }

  // Fechamento (seção 3.4).
  const material = e.material ?? { com_origem: 0, total: 0 };
  const total = vivos.filter((l) => !(l.obra.estorno_de && !l.obra.devolucao));
  const comprovantes = { com: total.filter((l) => l.arquivo || l.obra.dispensa || estornada(l)).length, total: total.length };
  const faltaComprovante = vivos.filter((l) => semComprovante(l) && !estornada(l)).length;
  const faltam: string[] = [];
  if (venda === null) faltam.push('Sem valor de venda');
  else if (aReceber! > 0) faltam.push(`A receber: ${reaisBR(aReceber!)}`);
  if (aMais > 0) faltam.push(`Recebido a mais: ${reaisBR(aMais)}`);
  for (const p of pend) faltam.push(p.texto);
  if (faltaComprovante > 0) faltam.push(textoFaltaComprovante(faltaComprovante));
  // A IA não conferiu o valor (`sem_leitura`, `baixa_confianca` ou `divergente`) e o ADM ainda não marcou como conferida: a conta não fecha.
  const naoConferidas = vivos.filter((l) => !l.obra.estorno_de && !estornada(l) && NAO_CONFERIDAS.includes(l.obra.conferencia)).length;
  if (naoConferidas > 0) faltam.push(`${naoConferidas} ${naoConferidas === 1 ? 'lançamento não conferido pela IA' : 'lançamentos não conferidos pela IA'}. O Thiago confere.`);
  const semMaterial = [...faltam];
  if (material.total === 0) faltam.push('Nenhum item de material na Compra');
  else if (material.com_origem < material.total) faltam.push(`Material com origem: ${material.com_origem} de ${material.total}`);
  if (e.ignoradas > 0) { const t = `${e.ignoradas} ${e.ignoradas === 1 ? 'linha do dinheiro sem assinatura' : 'linhas do dinheiro sem assinatura'}. Fale com o Thiago.`; faltam.push(t); semMaterial.push(t); }

  const fechamento: Fechamento = {
    a_receber: aReceber,
    a_pagar_total: pend.reduce((acc, p) => acc + (p.devolver ? 0 : (p.valor_centavos ?? 0)), 0),
    pendencias: pend.length,
    comprovantes,
    custo: gasto,
    previsto: previsto ? previsto.total.previsto : null,
    diferenca: previsto ? previsto.total.previsto - gasto : null,
    material,
    faltam,
    pode_fechar: faltam.length === 0,
    pode_fechar_sem_material: semMaterial.length === 0,
  };
  if (e.adm) {
    const sobra = venda === null ? null : venda - gasto;
    const fica = sobra === null ? null : sobra - retirada;
    fechamento.adm = {
      sobra, sobra_pct: sobra !== null && venda ? percentual(sobra, venda) : null, retirada,
      fica, fica_pct: fica !== null && venda ? percentual(fica, venda) : null,
    };
  }

  return {
    venda_centavos: venda, recebido, recebido_a_mais: aMais, a_receber: aReceber, gasto, retirada, saldo, por_etapa: porEtapa, linhas,
    comissoes: { vendedor: nomeSimples(e.vendedor), aviso: e.regraAviso ?? null, congelada: e.regraCongelada === true, liberadas, linhas: comLinhas },
    previsto, a_pagar: pend, ignoradas: e.ignoradas, fechamento,
  };
}

// ── O que cada pessoa vê da retirada dos sócios ────────────────────────────────────────────────────────────────────────────

/** Quem vê a retirada dos sócios (os 2% de cada sócio): o ADM e a dona da etapa 2, a Giovanna, que paga essas comissões e lança o comprovante. */
export const veRetiradaDosSocios = (nome: string, adm: boolean): boolean => adm || String(nome ?? '').trim().toLowerCase() === 'giovanna';

export type LivroSemRetirada = Omit<Livro, 'retirada'> & { retirada?: undefined };

/**
 * O livro como a pessoa pode ver. Quem não vê a retirada recebe um livro SEM as linhas dela, sem o total, com o saldo igual a recebido menos gasto
 * e sem nenhum campo do qual ela se deduza (linhas de sócio das comissões, pendência e comprovantes delas). A comissão de quem VENDEU, que é custo, fica.
 * O servidor decide o fechamento com o livro inteiro; este recorte é só para a resposta.
 */
export function recortarLivro(l: Livro, veRetirada: boolean): Livro | LivroSemRetirada {
  if (veRetirada) return l;
  const linhas = l.linhas.filter((x) => x.grupo !== 'retirada');
  const socio = (p: Pendencia): boolean => p.tipo === 'comissao' && p.papel === 'socio';
  const textosSocio = new Set(l.a_pagar.filter(socio).map((p) => p.texto));
  const a_pagar = l.a_pagar.filter((p) => !socio(p));
  const contam = linhas.filter((x) => !(x.estorno_de && !x.devolucao));
  const comprovantes = { com: contam.filter((x) => x.comprovante || x.dispensa || x.estornada).length, total: contam.length };
  const faltaComprovante = linhas.filter((x) => x.sem_comprovante).length;
  const naoConferidas = linhas.filter((x) => !x.estorno_de && !x.estornada && NAO_CONFERIDAS.includes(x.conferencia)).length;
  const ehMaterial = (t: string): boolean => t === 'Nenhum item de material na Compra' || t.startsWith('Material com origem:');
  const base = l.fechamento.faltam.filter((t) => !textosSocio.has(t) && !t.startsWith(TXT_FALTA_COMPROVANTE) && !/ não conferidos? pela IA\./.test(t));
  const faltam = [...base];
  if (faltaComprovante > 0) faltam.push(textoFaltaComprovante(faltaComprovante));
  if (naoConferidas > 0) faltam.push(`${naoConferidas} ${naoConferidas === 1 ? 'lançamento não conferido pela IA' : 'lançamentos não conferidos pela IA'}. O Thiago confere.`);
  const { retirada: _r, ...resto } = l;
  void _r;
  const { adm: _a, ...fech } = l.fechamento;
  void _a;
  return {
    ...resto, saldo: l.recebido - l.gasto, linhas,
    comissoes: { ...l.comissoes, linhas: l.comissoes.linhas.filter((x) => x.papel !== 'socio') },
    a_pagar,
    fechamento: {
      ...fech, a_pagar_total: a_pagar.reduce((acc, p) => acc + (p.devolver ? 0 : (p.valor_centavos ?? 0)), 0), pendencias: a_pagar.length, comprovantes, faltam,
      pode_fechar: faltam.length === 0, pode_fechar_sem_material: faltam.filter((t) => !ehMaterial(t)).length === 0,
    },
  };
}
