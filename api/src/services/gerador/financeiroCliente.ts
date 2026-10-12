// ── FINANCEIRO POR CLIENTE ──────────────────────────────────────────────────
//
// Cada cliente vendido é um card da agenda (id inteiro). Aqui se lança cada
// ENTRADA e cada SAÍDA de dinheiro desse card, uma chave por lançamento no
// `system_state` do banco PRINCIPAL: `fin:<cardId>:<id>`.
//
// TODO DINHEIRO É CENTAVO INTEIRO. Nenhuma soma em reais com ponto flutuante:
// 0,1 + 0,2 em reais dá 0,30000000000000004, e 10 + 20 centavos dá 30.
//
// Módulo PURO: sem banco e sem relógio. Quem chama passa o instante e o dia de
// Brasília.
//
// NADA disto vai para `agendamentos`: aquela tabela é legível pela chave pública
// que está no HTML do /gerador, e valor de custo ali vazaria.

export const FIN_PREFIX = 'fin:';
export const chaveLancamento = (cardId: number, id: string): string => `${FIN_PREFIX}${cardId}:${id}`;
export const prefixoDoCard = (cardId: number): string => `${FIN_PREFIX}${cardId}:`;

export const CATEGORIAS_ENTRADA: Record<string, string> = {
  sinal: 'Sinal',
  parcela: 'Parcela',
  a_vista: 'Pagamento à vista',
  financiamento: 'Financiamento liberado',
  remuneracao: 'Remuneração mensal',
  outros: 'Outros',
};

export const CATEGORIAS_SAIDA: Record<string, string> = {
  equipamento: 'Equipamento',
  frete: 'Frete',
  obra: 'Obra',
  material: 'Material',
  mao_de_obra: 'Mão de obra',
  projeto_art: 'Projeto e ART',
  taxa_distribuidora: 'Taxa da distribuidora',
  comissao: 'Comissão',
  imposto: 'Imposto',
  outros: 'Outros',
};

export const FORMAS: Record<string, string> = {
  pix: 'Pix',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
  financiamento: 'Financiamento',
  outro: 'Outro',
};

export const ID_LANCAMENTO = /^[A-Za-z0-9-]{8,64}$/;
/** R$ 100 milhões, em centavos. */
export const VALOR_MAX_CENTAVOS = 10_000_000_000;
export const DATA_MIN = '2020-01-01';
export const DIAS_A_FRENTE = 366;
export const MAX_DESCRICAO = 200;
export const MAX_CONTRAPARTE = 80;
export const MAX_ID_TRANSACAO = 80;
export const MAX_NOME_ARQUIVO = 120;
export const MAX_ALTERACOES = 20;
/** Teto do arquivo cru. O porquê está em routes/geradorDossie.ts: a Vercel
 *  corta o corpo em ~4,5 MB e o base64 infla o arquivo em 1/3. */
export const MAX_BYTES_ARQUIVO = 3 * 1024 * 1024;
export const TIPOS_ARQUIVO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export type TipoLancamento = 'entrada' | 'saida';

export type ArquivoLancamento = { path: string; nome: string; tipo: string; tamanho: number; sha256: string };
export type LidoPelaIa = { valor_centavos: number | null; data: string | null; id_transacao: string | null };
export type Alteracao = { em: string; por: string; antes: Record<string, unknown> };

export type Lancamento = {
  /** gerado no navegador; é a chave de idempotência */
  id: string;
  card_id: number;
  tipo: TipoLancamento;
  categoria: string;
  /** inteiro, > 0 */
  valor_centavos: number;
  /** 'YYYY-MM-DD' */
  data: string;
  forma: string;
  descricao: string;
  /** quem pagou ou recebeu */
  contraparte: string;
  id_transacao: string;
  arquivo: ArquivoLancamento | null;
  // `origem` e `lido_pela_ia` vêm do NAVEGADOR. O servidor não tem como saber
  // se a IA leu mesmo aquilo: servem de pista de auditoria, não de prova.
  origem: 'manual' | 'ia';
  /** o que a IA sugeriu (dito pelo navegador) */
  lido_pela_ia: LidoPelaIa | null;
  criado_por: string;
  criado_em: string;
  /** no máximo 20: a PRIMEIRA de todas e as 19 mais recentes */
  alteracoes: Alteracao[];
  /** Marca que não volta atrás: este lançamento é ou já foi SAÍDA. O histórico
   *  é cortado em 20, então a alteração que virou a saída em entrada some um
   *  dia; sem esta marca, o que é do tempo de saída voltaria a aparecer para
   *  quem não é sócio. Ausente = nunca foi saída. */
  ja_foi_saida?: boolean;
  apagado: boolean;
  apagado_por: string;
  apagado_em: string;
  motivo_apagado: string;
};

const lista = (m: Record<string, string>) => Object.entries(m).map(([slug, rotulo]) => ({ slug, rotulo }));

export function catalogoFinanceiro() {
  return { entrada: lista(CATEGORIAS_ENTRADA), saida: lista(CATEGORIAS_SAIDA), formas: lista(FORMAS) };
}

const tem = (m: Record<string, string>, k: string): boolean => Object.prototype.hasOwnProperty.call(m, k);
const categoriasDe = (tipo: TipoLancamento) => (tipo === 'entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA);

/** `YYYY-MM-DD` que existe no calendário (recusa 2026-02-30). */
export function dataReal(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma de dias sobre `YYYY-MM-DD` em UTC puro, sem fuso. */
export function somaDias(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Reais (como o `pos_venda` e o comprovante trazem) para centavos inteiros.
 *  null, NaN, infinito e negativo devolvem null. */
export function centavosDeReais(n: number | null | undefined): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const valorValido = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= VALOR_MAX_CENTAVOS;

type Falha = { ok: false; erro: string };
const falha = (erro: string): Falha => ({ ok: false, erro });

/** Só os cinco campos gravados. A tela devolve o objeto que recebeu do upload,
 *  que traz a `url` assinada: ela vence em 1 hora e não pode ir para o banco. */
function lerArquivo(v: unknown, cardId: number): { ok: true; arquivo: ArquivoLancamento | null } | Falha {
  if (v === null) return { ok: true, arquivo: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return falha('arquivo_invalido');
  const a = v as Record<string, unknown>;
  if (typeof a.path !== 'string' || typeof a.nome !== 'string' || typeof a.tipo !== 'string'
    || typeof a.sha256 !== 'string' || typeof a.tamanho !== 'number') return falha('arquivo_invalido');
  if (!a.path || a.path.length > 200 || a.path.includes('..') || !/^[A-Za-z0-9/._-]+$/.test(a.path)) return falha('arquivo_invalido');
  if (!(TIPOS_ARQUIVO as readonly string[]).includes(a.tipo)) return falha('arquivo_invalido');
  if (!/^[a-f0-9]{64}$/.test(a.sha256)) return falha('arquivo_invalido');
  if (!Number.isInteger(a.tamanho) || a.tamanho <= 0 || a.tamanho > MAX_BYTES_ARQUIVO) return falha('arquivo_invalido');
  if (!a.path.startsWith(`fin/${cardId}/`)) return falha('arquivo_de_outro_card');
  return {
    ok: true,
    arquivo: { path: a.path, nome: a.nome.trim().slice(0, MAX_NOME_ARQUIVO), tipo: a.tipo, tamanho: a.tamanho, sha256: a.sha256 },
  };
}

function lerLido(v: unknown): { ok: true; lido: LidoPelaIa | null } | Falha {
  if (v === null) return { ok: true, lido: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return falha('corpo_invalido');
  const l = v as Record<string, unknown>;
  const valor = l.valor_centavos ?? null;
  const data = l.data ?? null;
  const idt = l.id_transacao ?? null;
  if (valor !== null && !(typeof valor === 'number' && Number.isInteger(valor) && valor >= 0)) return falha('corpo_invalido');
  if (data !== null && !dataReal(data)) return falha('corpo_invalido');
  if (idt !== null && typeof idt !== 'string') return falha('corpo_invalido');
  return {
    ok: true,
    lido: {
      valor_centavos: valor as number | null,
      data: data as string | null,
      id_transacao: idt === null ? null : (idt as string).trim().slice(0, MAX_ID_TRANSACAO),
    },
  };
}

const CAMPOS_EDITAVEIS = [
  'tipo', 'categoria', 'valor_centavos', 'data', 'forma', 'descricao', 'contraparte',
  'id_transacao', 'arquivo', 'origem', 'lido_pela_ia',
] as const;
type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

/** Igualdade por VALOR, com as chaves em ordem. O `jsonb` do Postgres devolve as
 *  chaves reordenadas (por tamanho, depois alfabética): comparar o JSON cru
 *  acusaria mudança em todo `arquivo` e `lido_pela_ia` que voltasse do banco. */
const emOrdem = (v: unknown): unknown => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v ?? null;
  const o = v as Record<string, unknown>;
  return Object.keys(o).sort().map((k) => [k, o[k] ?? null]);
};
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(emOrdem(a)) === JSON.stringify(emOrdem(b));

export type ContextoLancamento = { cardId: number; autor: string; agoraIso: string; hojeBr: string };
export type ResultadoLancamento =
  | { ok: true; lancamento: Lancamento; criou: boolean; mudou: CampoEditavel[] }
  | Falha;

/**
 * Valida e monta o lançamento.
 *
 * CRIAÇÃO (`atual` null): todos os campos obrigatórios têm de vir.
 * EDIÇÃO: aplica só o que veio, e guarda em `alteracoes` o valor ANTIGO de cada
 * campo que mudou. Se nada mudou, devolve o próprio `atual` com `mudou: []` (é
 * assim que o mesmo pedido repetido não vira alteração).
 *
 * `id`, `card_id` e `criado_*` nunca mudam. O autor vem do contexto (o token),
 * nunca da entrada.
 */
export function montarLancamento(entrada: unknown, atual: Lancamento | null, ctx: ContextoLancamento): ResultadoLancamento {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return falha('corpo_invalido');
  const e = entrada as Record<string, unknown>;
  if (atual?.apagado) return falha('apagado');

  // id
  if (atual) {
    if (e.id !== undefined && e.id !== atual.id) return falha('id_invalido');
  } else if (typeof e.id !== 'string' || !ID_LANCAMENTO.test(e.id)) {
    return falha('id_invalido');
  }
  const id = atual ? atual.id : (e.id as string);

  // tipo
  let tipo: TipoLancamento;
  if (e.tipo !== undefined) {
    if (e.tipo !== 'entrada' && e.tipo !== 'saida') return falha('tipo_invalido');
    tipo = e.tipo;
  } else if (atual) {
    tipo = atual.tipo;
  } else {
    return falha('tipo_invalido');
  }

  // categoria (sempre conferida contra o tipo FINAL: trocar o tipo sem trocar a
  // categoria pode deixar 'frete' numa entrada)
  const categoria = e.categoria !== undefined ? e.categoria : atual?.categoria;
  if (typeof categoria !== 'string' || !tem(categoriasDe(tipo), categoria)) return falha('categoria_invalida');

  // valor
  const valor = e.valor_centavos !== undefined ? e.valor_centavos : atual?.valor_centavos;
  if (!valorValido(valor)) return falha('valor_invalido');

  // data (só confere a janela quando a data veio agora: a que já está gravada passou por aqui)
  let data: string;
  if (e.data !== undefined) {
    if (!dataReal(e.data) || e.data < DATA_MIN || e.data > somaDias(ctx.hojeBr, DIAS_A_FRENTE)) return falha('data_invalida');
    data = e.data;
  } else if (atual) {
    data = atual.data;
  } else {
    return falha('data_invalida');
  }

  // forma
  let forma = atual?.forma ?? '';
  if (e.forma !== undefined) {
    if (typeof e.forma !== 'string' || (e.forma !== '' && !tem(FORMAS, e.forma))) return falha('forma_invalida');
    forma = e.forma;
  }

  // textos
  for (const k of ['descricao', 'contraparte', 'id_transacao'] as const) {
    if (e[k] !== undefined && typeof e[k] !== 'string') return falha('texto_invalido');
  }
  const txt = (k: 'descricao' | 'contraparte' | 'id_transacao', max: number): string =>
    (e[k] !== undefined ? (e[k] as string).trim().slice(0, max) : atual?.[k] ?? '');
  const descricao = txt('descricao', MAX_DESCRICAO);
  const contraparte = txt('contraparte', MAX_CONTRAPARTE);
  const idTransacao = txt('id_transacao', MAX_ID_TRANSACAO);
  if (categoria === 'outros' && !descricao) return falha('descricao_obrigatoria');

  // arquivo
  let arquivo: ArquivoLancamento | null = atual?.arquivo ?? null;
  if (e.arquivo !== undefined) {
    const r = lerArquivo(e.arquivo, ctx.cardId);
    if (!r.ok) return r;
    arquivo = r.arquivo;
  }

  // origem e o que a IA leu. Os dois são o que o NAVEGADOR diz: pista de
  // auditoria, não prova. Nenhuma regra de dinheiro ou de acesso se apoia neles.
  let origem: 'manual' | 'ia' = atual?.origem ?? 'manual';
  if (e.origem !== undefined) {
    if (e.origem !== 'manual' && e.origem !== 'ia') return falha('corpo_invalido');
    origem = e.origem;
  }
  let lido: LidoPelaIa | null = atual?.lido_pela_ia ?? null;
  if (e.lido_pela_ia !== undefined) {
    const r = lerLido(e.lido_pela_ia);
    if (!r.ok) return r;
    lido = r.lido;
  }

  const campos = {
    tipo, categoria, valor_centavos: valor, data, forma, descricao, contraparte,
    id_transacao: idTransacao, arquivo, origem, lido_pela_ia: lido,
  };

  if (!atual) {
    return {
      ok: true,
      criou: true,
      mudou: [...CAMPOS_EDITAVEIS],
      lancamento: {
        id, card_id: ctx.cardId, ...campos,
        criado_por: ctx.autor, criado_em: ctx.agoraIso,
        alteracoes: [],
        apagado: false, apagado_por: '', apagado_em: '', motivo_apagado: '',
        ...(tipo === 'saida' ? { ja_foi_saida: true } : {}),
      },
    };
  }

  const antes: Record<string, unknown> = {};
  const mudou: CampoEditavel[] = [];
  for (const k of CAMPOS_EDITAVEIS) {
    if (!igual(atual[k], campos[k])) { antes[k] = atual[k] ?? null; mudou.push(k); }
  }
  if (!mudou.length) return { ok: true, criou: false, mudou, lancamento: atual };

  const alteracoes = cortarHistorico(
    [...(Array.isArray(atual.alteracoes) ? atual.alteracoes : []), { em: ctx.agoraIso, por: ctx.autor, antes }],
  );
  const foiSaida = atual.ja_foi_saida === true || atual.tipo === 'saida' || tipo === 'saida';
  return {
    ok: true,
    criou: false,
    mudou,
    lancamento: { ...atual, ...campos, alteracoes, ...(foiSaida ? { ja_foi_saida: true } : {}) },
  };
}

/** No máximo 20, mas a PRIMEIRA alteração nunca sai: é ela que guarda o valor
 *  com que o lançamento nasceu. Cortar só pelas mais recentes deixava 20
 *  edições na descrição apagarem o valor original. Ficam a primeira e as 19
 *  mais recentes. */
export function cortarHistorico(hist: Alteracao[]): Alteracao[] {
  if (hist.length <= MAX_ALTERACOES) return hist;
  return [hist[0], ...hist.slice(-(MAX_ALTERACOES - 1))];
}

/** Apagar é marcar: a linha e o arquivo ficam, só saem da conta. */
export function marcarApagado(
  atual: Lancamento,
  ctx: { autor: string; agoraIso: string },
  motivo: unknown,
): { ok: true; lancamento: Lancamento; mudou: boolean } | Falha {
  if (atual.apagado) return { ok: true, lancamento: atual, mudou: false };
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (m.length < 3 || m.length > 200) return falha('motivo_obrigatorio');
  return {
    ok: true,
    mudou: true,
    lancamento: { ...atual, apagado: true, apagado_por: ctx.autor, apagado_em: ctx.agoraIso, motivo_apagado: m },
  };
}

export type Totais = {
  recebido: number;
  gasto: number;
  resultado_caixa: number;
  a_receber: number | null;
  recebido_a_mais: number;
  resultado_previsto: number | null;
  margem_prevista: number | null;
  por_categoria: { entrada: Record<string, number>; saida: Record<string, number> };
  qtd_entradas: number;
  qtd_saidas: number;
};

type ParaSomar = Pick<Lancamento, 'tipo' | 'categoria' | 'valor_centavos' | 'apagado'>;

/** Tudo em centavos inteiros. Ignora os apagados. `valorVendaCentavos` null =
 *  venda sem valor registrado: o que depende dele sai null, não zero. */
export function totais(lancamentos: readonly ParaSomar[], valorVendaCentavos: number | null): Totais {
  const venda = typeof valorVendaCentavos === 'number' && Number.isInteger(valorVendaCentavos) && valorVendaCentavos >= 0
    ? valorVendaCentavos : null;
  let recebido = 0; let gasto = 0; let qtdEntradas = 0; let qtdSaidas = 0;
  const entrada: Record<string, number> = {};
  const saida: Record<string, number> = {};
  for (const l of lancamentos) {
    if (!l || l.apagado) continue;
    // Linha estragada no banco não pode pôr fração nem NaN na soma.
    if (!Number.isInteger(l.valor_centavos) || l.valor_centavos <= 0) continue;
    const cat = String(l.categoria || 'outros');
    if (l.tipo === 'entrada') {
      recebido += l.valor_centavos; qtdEntradas++;
      entrada[cat] = (entrada[cat] ?? 0) + l.valor_centavos;
    } else if (l.tipo === 'saida') {
      gasto += l.valor_centavos; qtdSaidas++;
      saida[cat] = (saida[cat] ?? 0) + l.valor_centavos;
    }
  }
  const previsto = venda === null ? null : venda - gasto;
  return {
    recebido,
    gasto,
    resultado_caixa: recebido - gasto,
    a_receber: venda === null ? null : Math.max(0, venda - recebido),
    recebido_a_mais: venda === null ? 0 : Math.max(0, recebido - venda),
    resultado_previsto: previsto,
    margem_prevista: venda === null || venda === 0 || previsto === null ? null : Math.round((previsto / venda) * 1000) / 10,
    por_categoria: { entrada, saida },
    qtd_entradas: qtdEntradas,
    qtd_saidas: qtdSaidas,
  };
}

export type TotaisDoConsultor = {
  recebido: number;
  gasto: null;
  resultado_caixa: null;
  a_receber: number | null;
  recebido_a_mais: number;
  resultado_previsto: null;
  margem_prevista: null;
  por_categoria: { entrada: Record<string, number>; saida: null };
  qtd_entradas: number;
  qtd_saidas: null;
};

/** O total que quem NÃO é sócio pode ver. Montado campo a campo, por lista
 *  branca: campo novo em `Totais` não vaza sozinho. */
export function mascararTotais(t: Totais): TotaisDoConsultor {
  return {
    recebido: t.recebido,
    gasto: null,
    resultado_caixa: null,
    a_receber: t.a_receber,
    recebido_a_mais: t.recebido_a_mais,
    resultado_previsto: null,
    margem_prevista: null,
    por_categoria: { entrada: { ...t.por_categoria.entrada }, saida: null },
    qtd_entradas: t.qtd_entradas,
    qtd_saidas: null,
  };
}

/**
 * Tira do histórico o tempo em que o lançamento foi SAÍDA.
 *
 * Um sócio pode corrigir uma saída virando-a entrada. A entrada passa a ser
 * visível para o consultor, mas o histórico dela guarda `antes: { tipo: 'saida',
 * valor_centavos: <o gasto> }`, e as alterações anteriores a essa também são do
 * tempo de saída (essas nem trazem `tipo`, então não dá para filtrar uma a uma).
 * Fica só o que veio DEPOIS da última alteração cujo `antes.tipo` é 'saida'.
 *
 * O `lido_pela_ia` sai junto: a leitura pode ter sido feita quando o
 * lançamento era saída, e ela guarda o valor lido.
 *
 * Se a alteração que virou a saída em entrada já foi cortada do histórico (ele
 * guarda a primeira e as 19 mais recentes), quem diz que houve saída é a marca
 * `ja_foi_saida`. Nesse caso as 19 recentes são todas de depois da virada, e a
 * primeira é de antes: sai só ela.
 */
export function semHistoricoDeSaida<L extends { alteracoes?: Alteracao[]; lido_pela_ia?: unknown; ja_foi_saida?: boolean }>(l: L): L {
  const hist = Array.isArray(l.alteracoes) ? l.alteracoes : [];
  let corte = -1;
  hist.forEach((a, i) => { if (a?.antes && a.antes.tipo === 'saida') corte = i; });
  if (corte < 0 && l.ja_foi_saida !== true) return l;
  const limpo = { ...l, alteracoes: corte >= 0 ? hist.slice(corte + 1) : hist.slice(1), lido_pela_ia: null };
  delete limpo.ja_foi_saida;
  return limpo;
}

/** O que quem NÃO é sócio pode ver: só as entradas (sem o histórico do tempo
 *  em que alguma foi saída), e os totais sem nada que dependa de custo.
 *  `recebido` e `a_receber` continuam verdadeiros. */
export function visaoDoConsultor<L extends { tipo: string; alteracoes?: Alteracao[]; lido_pela_ia?: unknown; ja_foi_saida?: boolean }>(
  lancamentos: readonly L[],
  totaisCompletos: Totais,
): { lancamentos: L[]; totais: TotaisDoConsultor } {
  return {
    lancamentos: lancamentos.filter((l) => l.tipo === 'entrada').map(semHistoricoDeSaida),
    totais: mascararTotais(totaisCompletos),
  };
}

export type MotivoDuplicado = 'mesmo_arquivo' | 'mesma_transacao' | 'mesmo_valor_e_data';
export type Duplicado = {
  id: string; tipo: TipoLancamento; valor_centavos: number; data: string; categoria: string; motivo: MotivoDuplicado;
};

type ParaComparar = Pick<Lancamento, 'id' | 'tipo' | 'valor_centavos' | 'data' | 'id_transacao'> & {
  arquivo: { sha256: string } | null;
};

/** Lançamentos vivos, de outro id, que parecem o mesmo dinheiro lançado de novo.
 *  O motivo mais forte ganha: arquivo, depois transação, depois valor e data. */
export function possiveisDuplicados(novo: ParaComparar, existentes: readonly Lancamento[]): Duplicado[] {
  const sha = novo.arquivo?.sha256 || '';
  const idt = String(novo.id_transacao || '').trim();
  const achados: Duplicado[] = [];
  for (const l of existentes) {
    if (!l || l.apagado || l.id === novo.id) continue;
    let motivo: MotivoDuplicado | null = null;
    if (sha && l.arquivo?.sha256 === sha) motivo = 'mesmo_arquivo';
    else if (idt && String(l.id_transacao || '').trim() === idt) motivo = 'mesma_transacao';
    else if (l.tipo === novo.tipo && l.valor_centavos === novo.valor_centavos && l.data === novo.data) motivo = 'mesmo_valor_e_data';
    if (motivo) {
      achados.push({ id: l.id, tipo: l.tipo, valor_centavos: l.valor_centavos, data: l.data, categoria: l.categoria, motivo });
    }
  }
  return achados;
}

/** Linha do `system_state` para lançamento, ou null se não tem cara de um. */
export function lancamentoDe(value: unknown): Lancamento | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !ID_LANCAMENTO.test(v.id)) return null;
  if (v.tipo !== 'entrada' && v.tipo !== 'saida') return null;
  if (typeof v.card_id !== 'number' || typeof v.valor_centavos !== 'number' || typeof v.data !== 'string') return null;
  const a = v.arquivo && typeof v.arquivo === 'object' ? (v.arquivo as ArquivoLancamento) : null;
  const lido = v.lido_pela_ia && typeof v.lido_pela_ia === 'object' && !Array.isArray(v.lido_pela_ia)
    ? (v.lido_pela_ia as Record<string, unknown>) : null;
  return {
    id: v.id,
    card_id: v.card_id,
    tipo: v.tipo,
    categoria: String(v.categoria ?? ''),
    valor_centavos: v.valor_centavos,
    data: v.data,
    forma: String(v.forma ?? ''),
    descricao: String(v.descricao ?? ''),
    contraparte: String(v.contraparte ?? ''),
    id_transacao: String(v.id_transacao ?? ''),
    arquivo: a && typeof a.path === 'string'
      ? { path: a.path, nome: String(a.nome ?? ''), tipo: String(a.tipo ?? ''), tamanho: Number(a.tamanho) || 0, sha256: String(a.sha256 ?? '') }
      : null,
    origem: v.origem === 'ia' ? 'ia' : 'manual',
    lido_pela_ia: lido
      ? {
        valor_centavos: typeof lido.valor_centavos === 'number' ? lido.valor_centavos : null,
        data: typeof lido.data === 'string' ? lido.data : null,
        id_transacao: typeof lido.id_transacao === 'string' ? lido.id_transacao : null,
      }
      : null,
    criado_por: String(v.criado_por ?? ''),
    criado_em: String(v.criado_em ?? ''),
    alteracoes: Array.isArray(v.alteracoes) ? (v.alteracoes as Alteracao[]) : [],
    apagado: v.apagado === true,
    apagado_por: String(v.apagado_por ?? ''),
    apagado_em: String(v.apagado_em ?? ''),
    motivo_apagado: String(v.motivo_apagado ?? ''),
    ...(v.ja_foi_saida === true ? { ja_foi_saida: true } : {}),
  };
}

/** Mais novo primeiro: `data` decrescente, depois `criado_em` decrescente. */
export function ordenarLancamentos<L extends { data: string; criado_em: string }>(ls: readonly L[]): L[] {
  return [...ls].sort((a, b) =>
    (a.data < b.data ? 1 : a.data > b.data ? -1 : 0) || (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0));
}
