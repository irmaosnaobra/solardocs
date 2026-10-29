import type { MapaStatus } from './avaliacao';

// Vistoria solar: lista de compras (materiais, serviços e anotações do técnico).
//
// Este arquivo é PURO: sem banco, sem rede, sem logger e sem import de extras.ts (quem lê a coluna é o
// lerCompras, em extras.ts). Ele faz três coisas:
//   1. sanear o que o técnico manda e o que está gravado (nunca lança e nunca confia no formato);
//   2. derivar o prazo de cada linha a partir do status do item da vistoria;
//   3. preparar os dados do relatório (grupos, quantidade por extenso, resumo e anotações).
//
// O dashboard repete, idênticas, as funções limparTexto, lerQtd, formatarQtd, unidadePorExtenso, frasesResumo
// e prazoDe, e a regra de sanitizarLinha. Um teste (vistoriaComprasDashboard) prova que as duas pontas dão a
// mesma saída. Mudou aqui, muda lá.
//
// Não há preço, marca de fabricante nem nome de loja em lugar nenhum da lista: o link do relatório é público.

export const UNIDADES = ['un', 'm', 'pc', 'cj', 'barra', 'servico'] as const;
export type Unidade = typeof UNIDADES[number];

export const QUEM = ['integrador', 'cliente', 'a_definir'] as const;
export type Quem = typeof QUEM[number];

/** As 12 chaves do checklist da vistoria (as mesmas de CHECKLIST_VISTORIA, na mesma ordem). */
export const CHAVES_ITENS = [
  'conta_luz', 'documento_pessoal', 'padrao', 'medidor', 'disjuntor_padrao', 'quadro_distribuicao',
  'inversores', 'telhado', 'tipo_telha', 'estrutura', 'cabeamento', 'sombreamento',
] as const;

export const LIMITES = { linhas: 60, nome: 80, esp: 140, obsLinha: 200, obsNota: 500, qtdMax: 99999, json: 48000 } as const;

export interface LinhaCompra {
  id: string;
  tipo: 'material' | 'obs';
  nome?: string;
  esp?: string;
  qtd?: number | null;
  un?: Unidade;
  quem?: Quem;
  item?: string;
  cid?: string;
  obs: string;
  ts?: string;
}

export interface Compras {
  v: 1;
  publica: boolean;
  linhas: LinhaCompra[];
}

/** Lista nunca usada: vazia e visível. É o que '{}' (o padrão da coluna) significa. */
export const comprasVazio = (): Compras => ({ v: 1, publica: true, linhas: [] });

// ---------------------------------------------------------------------------------------------------------
// Limpeza de texto
// ---------------------------------------------------------------------------------------------------------

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
const CONTROLE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Limpa todo texto de linha. Só aceita string (o resto vira ''). Troca travessão (U+2013 e U+2014) por hífen,
 * tira emoji e símbolos, troca caractere de controle por espaço, junta espaços e quebras de linha num espaço só,
 * apara, corta no limite e põe a primeira letra em maiúscula.
 */
export function limparTexto(bruto: unknown, max: number): string {
  if (typeof bruto !== 'string') return '';
  let t = bruto.replace(/[\u2013\u2014]/g, '-').replace(EMOJI, '').replace(CONTROLE, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

// ---------------------------------------------------------------------------------------------------------
// Saneamento da linha e da lista
// ---------------------------------------------------------------------------------------------------------

const RE_ID = /^[a-z0-9]{6,24}$/;
const RE_CID = /^[a-z0-9-]{1,40}$/;
const RE_TS = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function ehUnidade(v: unknown): v is Unidade {
  return typeof v === 'string' && (UNIDADES as readonly string[]).includes(v);
}
function ehQuem(v: unknown): v is Quem {
  return typeof v === 'string' && (QUEM as readonly string[]).includes(v);
}
function ehChaveItem(v: unknown): v is string {
  return typeof v === 'string' && (CHAVES_ITENS as readonly string[]).includes(v);
}

/**
 * Quantidade: só number finito, de 0,01 a 99.999, com no máximo 2 casas. Qualquer outra coisa (texto, NaN,
 * zero, negativo, acima do teto) vira null e NÃO derruba a linha. O dashboard repete este algoritmo em lerQtd:
 *   1. v não é number finito: null.
 *   2. v < 0.005 ou v > 100000: null (arredondaria para zero ou passaria do teto; também evita a notação
 *      exponencial de String(v), que quebraria o passo 3).
 *   3. r = Number(Math.round(Number(`${v}e2`)) + 'e-2'). Arredonda pela escrita decimal e o meio sobe;
 *      v * 100 erra em ponto flutuante (1.005 * 100 dá 100.49999999999999).
 *   4. r não finito, r < 0.01 ou r > 99999: null.
 *   5. senão r.
 */
function lerQtd(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0.005 || v > 100000) return null;
  const r = Number(Math.round(Number(`${v}e2`)) + 'e-2');
  if (!Number.isFinite(r) || r < 0.01 || r > LIMITES.qtdMax) return null;
  return r;
}

/** ISO de data ou de data e hora, até 32 caracteres. Qualquer outra coisa é omitida. */
function lerTs(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0 || t.length > 32 || !RE_TS.test(t) || Number.isNaN(Date.parse(t))) return undefined;
  return t;
}

/**
 * Sanea UMA linha. Nunca lança. Devolve null quando a linha não presta: id fora de ^[a-z0-9]{6,24}$, tipo
 * desconhecido, material sem nome de 2 letras ou mais, nota sem texto.
 *
 * Forma de saída:
 *   material: id, tipo, nome, esp (se houver), qtd (sempre presente, number ou null), un, quem, item e cid (se
 *   válidos), obs (sempre string, '' se não houver) e ts (se válido). Serviço grava qtd null.
 *   obs (nota livre): id, tipo, obs, item, cid e ts. Sem nome, esp, qtd, un nem quem.
 */
export function sanitizarLinha(bruto: unknown): LinhaCompra | null {
  try {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
    const b = bruto as Record<string, unknown>;

    const id = b.id;
    if (typeof id !== 'string' || !RE_ID.test(id)) return null;

    const item = ehChaveItem(b.item) ? b.item : undefined;
    const cid = typeof b.cid === 'string' && RE_CID.test(b.cid) ? b.cid : undefined;
    const ts = lerTs(b.ts);

    if (b.tipo === 'obs') {
      const obs = limparTexto(b.obs, LIMITES.obsNota);
      if (!obs) return null;
      return {
        id,
        tipo: 'obs',
        ...(item ? { item } : {}),
        ...(cid ? { cid } : {}),
        obs,
        ...(ts ? { ts } : {}),
      };
    }

    if (b.tipo === 'material') {
      const nome = limparTexto(b.nome, LIMITES.nome);
      if (nome.length < 2) return null;
      const esp = limparTexto(b.esp, LIMITES.esp);
      const un: Unidade = ehUnidade(b.un) ? b.un : 'un';
      const quem: Quem = ehQuem(b.quem) ? b.quem : 'a_definir';
      return {
        id,
        tipo: 'material',
        nome,
        ...(esp ? { esp } : {}),
        qtd: un === 'servico' ? null : lerQtd(b.qtd),
        un,
        quem,
        ...(item ? { item } : {}),
        ...(cid ? { cid } : {}),
        obs: limparTexto(b.obs, LIMITES.obsLinha),
        ...(ts ? { ts } : {}),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Sanea a lista inteira, na ordem recebida. NÃO corta em 60 (quem recebe decide: o PUT responde 400 acima do
 * limite e a leitura corta). Primeiro sanea cada linha, depois resolve o id repetido entre as válidas: a última
 * ocorrência vale e fica na posição da primeira. Uma repetição inválida no fim não apaga a válida anterior.
 *
 * `descartadas` = recebidas menos mantidas: conta a linha inválida e também a ocorrência anterior de um id
 * repetido que foi substituída. Entrada que não é lista dá lista vazia e 0.
 */
export function sanitizarLinhas(brutos: unknown[]): { linhas: LinhaCompra[]; descartadas: number } {
  const recebidas = Array.isArray(brutos) ? brutos : [];
  const linhas: LinhaCompra[] = [];
  const posicao = new Map<string, number>();
  for (const bruta of recebidas) {
    const l = sanitizarLinha(bruta);
    if (!l) continue;
    const i = posicao.get(l.id);
    if (i === undefined) {
      posicao.set(l.id, linhas.length);
      linhas.push(l);
    } else {
      linhas[i] = l;
    }
  }
  return { linhas, descartadas: recebidas.length - linhas.length };
}

/**
 * Leitura tolerante do que está gravado. Aceita o envelope { v, publica, linhas }, uma lista pura de linhas,
 * '{}' (objeto ou texto), null, undefined e até um JSON em texto. Nada disso lança. `publica` só é false
 * quando vem o boolean false. Corta em 60 linhas DEPOIS de sanear (linha ruim não ocupa vaga). Chave
 * desconhecida do envelope é ignorada.
 */
export function sanitizarCompras(bruto: unknown): Compras {
  let fonte: unknown = bruto;
  if (typeof fonte === 'string') {
    try {
      fonte = JSON.parse(fonte);
    } catch {
      return comprasVazio();
    }
  }
  let publica = true;
  let brutas: unknown[] = [];
  if (Array.isArray(fonte)) {
    brutas = fonte;
  } else if (fonte && typeof fonte === 'object') {
    const o = fonte as Record<string, unknown>;
    publica = o.publica !== false;
    brutas = Array.isArray(o.linhas) ? o.linhas : [];
  }
  const { linhas } = sanitizarLinhas(brutas);
  return { v: 1, publica, linhas: linhas.slice(0, LIMITES.linhas) };
}

/** A lista que o relatório, o PDF e o hash enxergam. Null se a coluna não existe, se está oculta ou se está vazia. */
export function comprasVisiveis(c: Compras, disponivel: boolean): Compras | null {
  if (!disponivel || !c || !c.publica || !Array.isArray(c.linhas) || c.linhas.length === 0) return null;
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Prazo, quantidade e resumo
// ---------------------------------------------------------------------------------------------------------

export type Prazo = 'alta' | 'media' | null;

/** O prazo nasce do status do item ligado: não conforme é alta, atenção é média, o resto não tem prazo. */
export function prazoDe(item: string | undefined, status: MapaStatus): Prazo {
  if (!item || !status) return null;
  const s = status[item];
  if (s === 'nao_conforme') return 'alta';
  if (s === 'atencao') return 'media';
  return null;
}

/**
 * Quantidade em pt-BR sem Intl: vírgula nos decimais, ponto no milhar, sem zero sobrando. 12.5 vira "12,5",
 * 1200 vira "1.200", 3 vira "3". Pensada para valor já saneado (2 casas). Não finito dá ''.
 */
export function formatarQtd(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const [inteira, decimais] = Math.abs(n).toFixed(2).split('.');
  const resto = (decimais ?? '').replace(/0+$/, '');
  const milhar = (inteira ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sinal = n < 0 && (Number(inteira) !== 0 || resto !== '') ? '-' : '';
  return `${sinal}${milhar}${resto ? ',' + resto : ''}`;
}

const POR_EXTENSO: Record<Unidade, [string, string]> = {
  un: ['unidade', 'unidades'],
  m: ['metro', 'metros'],
  pc: ['peça', 'peças'],
  cj: ['conjunto', 'conjuntos'],
  barra: ['barra', 'barras'],
  servico: ['serviço', 'serviços'],
};

/** Singular só quando a quantidade é exatamente 1. Quantidade a definir (null) e qualquer outro número ficam no plural. */
export function unidadePorExtenso(un: Unidade, qtd: number | null): string {
  const par = ehUnidade(un) ? POR_EXTENSO[un] : POR_EXTENSO.un;
  return qtd === 1 ? par[0] : par[1];
}

/**
 * "8 materiais, 2 serviços e 3 observações." Omite o que for zero, usa o singular quando é 1 e fecha com
 * ponto. Serviço é a linha de material com unidade `servico`. Lista vazia dá ''.
 */
export function frasesResumo(linhas: LinhaCompra[]): string {
  let materiais = 0;
  let servicos = 0;
  let notas = 0;
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || typeof l !== 'object') continue;
    if (l.tipo === 'obs') notas++;
    else if (l.un === 'servico') servicos++;
    else materiais++;
  }
  const partes: string[] = [];
  if (materiais) partes.push(`${materiais} ${materiais === 1 ? 'material' : 'materiais'}`);
  if (servicos) partes.push(`${servicos} ${servicos === 1 ? 'serviço' : 'serviços'}`);
  if (notas) partes.push(`${notas} ${notas === 1 ? 'observação' : 'observações'}`);
  if (partes.length === 0) return '';
  const texto = partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
  return `${texto}.`;
}

// ---------------------------------------------------------------------------------------------------------
// Dados do relatório
// ---------------------------------------------------------------------------------------------------------

export interface LinhaRelatorio {
  nome: string;
  esp: string;
  /** A nota da própria linha (o campo obs da linha). A tela escreve "Nota: ..." na frente. */
  nota: string;
  /** '' para serviço e para quantidade a definir. Senão "3 unidades", com espaço sem quebra entre número e unidade. */
  qtdTexto: string;
  aDefinir: boolean;
  servico: boolean;
  itemChave?: string;
  itemRotulo?: string;
  prazo: Prazo;
}

export interface GrupoRelatorio {
  quem: Quem;
  titulo: string;
  apoio: string;
  linhas: LinhaRelatorio[];
}

export interface DadosRelatorio {
  resumo: string;
  /** Não há material nem serviço, só anotações. Lista vazia não é "só anotações". */
  soNotas: boolean;
  grupos: GrupoRelatorio[];
  notas: { texto: string; itemRotulo?: string }[];
  /** Quantas linhas de material e de serviço têm prazo alto e médio. Anotação não conta. */
  prazos: { alta: number; media: number };
}

const GRUPOS: { quem: Quem; titulo: string; apoio: string }[] = [
  { quem: 'cliente', titulo: 'Por conta do cliente', apoio: 'O cliente providencia estes itens e serviços.' },
  { quem: 'integrador', titulo: 'Por conta da empresa instaladora', apoio: 'Estes itens e serviços ficam com a empresa instaladora.' },
  { quem: 'a_definir', titulo: 'A combinar', apoio: 'Ainda não foi definido quem providencia. Combinar antes do orçamento.' },
];

const POSTO_PRAZO = { alta: 0, media: 1, sem: 2 } as const;

/**
 * Prepara a lista para o relatório (tela e PDF usam a mesma saída). Grupos na ordem cliente, empresa
 * instaladora e a combinar, só os que têm linha. Dentro do grupo: prazo alto, prazo médio e sem prazo, e
 * dentro de cada um a ordem gravada. O rótulo do item vem de `rotuloDoItem` (o label do item na vistoria).
 */
export function agruparParaRelatorio(
  c: Compras,
  status: MapaStatus,
  rotuloDoItem: (chave: string) => string,
): DadosRelatorio {
  const linhas = Array.isArray(c?.linhas) ? c.linhas : [];
  const porQuem = new Map<Quem, { linha: LinhaRelatorio; ordem: number }[]>();
  const notas: DadosRelatorio['notas'] = [];
  const prazos = { alta: 0, media: 0 };
  let comMaterial = 0;

  linhas.forEach((l, ordem) => {
    if (!l || typeof l !== 'object') return;
    const rotulo = l.item ? rotuloDoItem(l.item) : '';

    if (l.tipo === 'obs') {
      notas.push(rotulo ? { texto: l.obs ?? '', itemRotulo: rotulo } : { texto: l.obs ?? '' });
      return;
    }

    comMaterial++;
    const un: Unidade = ehUnidade(l.un) ? l.un : 'un';
    const servico = un === 'servico';
    const qtd = servico || typeof l.qtd !== 'number' ? null : l.qtd;
    const prazo = prazoDe(l.item, status);
    if (prazo === 'alta') prazos.alta++;
    else if (prazo === 'media') prazos.media++;

    const linha: LinhaRelatorio = {
      nome: l.nome ?? '',
      esp: l.esp ?? '',
      nota: l.obs ?? '',
      qtdTexto: qtd === null ? '' : `${formatarQtd(qtd)}\u00A0${unidadePorExtenso(un, qtd)}`,
      aDefinir: !servico && qtd === null,
      servico,
      ...(l.item ? { itemChave: l.item } : {}),
      ...(rotulo ? { itemRotulo: rotulo } : {}),
      prazo,
    };
    const quem: Quem = ehQuem(l.quem) ? l.quem : 'a_definir';
    const lista = porQuem.get(quem);
    if (lista) lista.push({ linha, ordem });
    else porQuem.set(quem, [{ linha, ordem }]);
  });

  const grupos: GrupoRelatorio[] = [];
  for (const g of GRUPOS) {
    const lista = porQuem.get(g.quem);
    if (!lista || lista.length === 0) continue;
    lista.sort((a, b) => POSTO_PRAZO[a.linha.prazo ?? 'sem'] - POSTO_PRAZO[b.linha.prazo ?? 'sem'] || a.ordem - b.ordem);
    grupos.push({ quem: g.quem, titulo: g.titulo, apoio: g.apoio, linhas: lista.map((x) => x.linha) });
  }

  return {
    resumo: frasesResumo(linhas),
    soNotas: comMaterial === 0 && notas.length > 0,
    grupos,
    notas,
    prazos,
  };
}

/**
 * Para o "Na lista:" do cartão de pendência: chave do item da vistoria -> nomes das linhas de material ligadas
 * a ele, na ordem gravada. Entram as linhas de tipo `material`, serviço inclusive (a poda ligada a Sombreamento
 * é o que resolve a pendência). Anotação (tipo `obs`) e linha sem item ficam de fora.
 */
export function nomesPorItem(c: Compras): Record<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const l of Array.isArray(c?.linhas) ? c.linhas : []) {
    if (!l || l.tipo !== 'material' || !l.item || !l.nome) continue;
    const lista = mapa.get(l.item);
    if (lista) lista.push(l.nome);
    else mapa.set(l.item, [l.nome]);
  }
  return Object.fromEntries(mapa);
}
