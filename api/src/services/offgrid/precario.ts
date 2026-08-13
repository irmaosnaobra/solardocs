/**
 * OFF-GRID — preçário de fornecimento. VIVE NO SERVIDOR, de propósito.
 *
 * Estes são os preços que NÓS cobramos do integrador. Enquanto moraram no
 * bundle do dashboard, qualquer pessoa com o devtools aberto lia a nossa tabela
 * de custo — inclusive quem nunca pagou o acesso e inclusive concorrente. O
 * cadeado só é cadeado se o número não sair daqui sem passar pela checagem.
 *
 * O DIMENSIONAMENTO continua no front (autonomia, banco, arranjo): é a parte
 * que a gente QUER que todo mundo veja, porque é ela que vende. O que fica
 * atrás do cadeado é o dinheiro.
 *
 * ── COMO O PREÇO É FORMADO ──────────────────────────────────────────────────
 * CUSTO = o que a gente paga no distribuidor onde somos cadastrados (print de
 * 13/08/2026, com código do item pra conferência).
 * FORNECIMENTO = custo ÷ (1 - MARGEM_LIQUIDA). É o que o integrador paga pra
 * nós, e deixa 20% líquidos sobre essa venda.
 * Depois disso o integrador ainda põe a margem dele, que é outra conta e mora
 * na tela dele.
 *
 * Mudou preço no distribuidor? Mexe só no CUSTO e sobe TABELA_VERSAO. O markup
 * fica separado justamente pra não ter que recalcular item por item na mão.
 */

export const TABELA_VERSAO = '2026-08-13';

/**
 * Nossa margem: 20% LÍQUIDOS sobre o preço de venda — não 20% em cima do custo.
 *
 * A diferença não é detalhe. Custo 100 com "+20%" vende a 120, e desses 120 a
 * margem é 16,7%. Pra sobrar 20% de verdade, o divisor é (1 - 0,20): vende a
 * 125. Em cima de um kit de R$25 mil isso é mais de R$1.000 por venda que some
 * sem ninguém ver.
 */
export const MARGEM_LIQUIDA = 0.20;
export const MARKUP_FORNECEDOR = 1 / (1 - MARGEM_LIQUIDA); // 1,25

export interface ItemPrecario {
  /** O que pagamos no distribuidor (R$). */
  custo: number;
  /** Código do item no distribuidor — pra conferir na hora de comprar. */
  codigo?: string;
  nome: string;
}

/**
 * Custo no distribuidor. Preços de 13/08/2026.
 * O preço de FORNECIMENTO sai de `precoFornecimento()`, nunca daqui direto.
 *
 * ⚠ MUDOU PREÇO AQUI? Atualize também o `custoRel` do item em
 * dashboard/src/lib/offgrid/catalogo.ts. É um índice relativo (bateria = 1,000)
 * que o motor usa pra escolher a combinação mais barata de banco + inversor sem
 * publicar a tabela no navegador. Se ele ficar velho, o kit continua sendo
 * montado pela proporção ANTIGA e ninguém percebe — o orçamento fecha, só que
 * com o inversor errado.
 *   custoRel = custo do item ÷ custo da bateria
 */
export const CUSTOS: Record<string, ItemPrecario> = {
  // ── Geração ──
  'mod-620': { custo: 496.00, codigo: '658183', nome: 'Módulo 620W N-Plus bifacial 30mm' },

  // ── Inversores híbridos SAJ H2, bateria de baixa tensão (48V) ──
  'inv-5000-48':  { custo: 3999.29, codigo: '322525', nome: 'Inversor SAJ H2 5kW mono 220V 2MPPT' },
  'inv-10000-48': { custo: 5999.48, codigo: '322541', nome: 'Inversor SAJ H2 10kW mono 220V 2MPPT' },

  // ── Armazenamento ──
  'bat-48-100': { custo: 4450.00, codigo: '383670', nome: 'Bateria SAJ B3 5,0 kWh 48V LFP' },

  // ── Balanço do sistema (BOS) ──
  // Não vêm do mesmo distribuidor: são compras de material elétrico e estrutura.
  // Ficam com o mesmo markup pra conta fechar num lugar só.
  'bos-estrutura':   { custo: 96,  nome: 'Estrutura de fixação (por módulo)' },
  'bos-cabo':        { custo: 68,  nome: 'Cabo solar 6mm² + conectores MC4 (por módulo)' },
  'bos-stringbox':   { custo: 490, nome: 'String box CC com DPS e fusíveis' },
  'bos-quadro':      { custo: 540, nome: 'Quadro CA com disjuntores e DPS' },
  'bos-banco':       { custo: 395, nome: 'Cabos de banco, barramento e disjuntor CC' },
  'bos-aterramento': { custo: 330, nome: 'Kit de aterramento (haste, cordoalha, TAP)' },
  'bos-rack':        { custo: 460, nome: 'Rack de acomodação do banco' },
};

/** Preço de fornecimento de um item: custo do distribuidor + nossa margem. */
export function precoFornecimento(id: string): number | null {
  const item = CUSTOS[id];
  if (!item) return null;
  return Math.round(item.custo * MARKUP_FORNECEDOR * 100) / 100;
}

/** Vida do banco pra conta de R$/kWh armazenado. Espelha CONST no front. */
export const VIDA_ANOS_BANCO = 10;
/** DoD de projeto — o mesmo do motor. Só entra na conta do kWh armazenado. */
export const DOD_PROJETO = 0.8;

export interface ItemPedido { id: string; nome: string; qtd: number }

export interface OrcamentoCalculado {
  itens: { id: string; nome: string; qtd: number; unitario: number; total: number }[];
  custoEquipamentos: number;
  frete: number;
  freteRegiao: string;
  fretePrazo: string;
  freteDetalhe?: string;
  custoFornecimento: number;
  maoDeObra: number;
  extras: number;
  baseIntegrador: number;
  margemValor: number;
  precoCliente: number;
  custoKwhArmazenado: number;
  tabelaVersao: string;
  pesoKg: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Preço do kit. Item que não existe no preçário é IGNORADO (não vira zero
 * silencioso nem quebra o orçamento inteiro) — o front manda ids do catálogo e
 * um id desconhecido só pode ser front desatualizado.
 */
export function orcar(entrada: {
  itens: ItemPedido[];
  pesoKg: number;
  margemPct: number;
  maoDeObra: number;
  extras: number;
  bancoKwh: number;
  frete: { valor: number; regiao: string; prazo: string; detalhe?: string };
}): OrcamentoCalculado {
  const itens = entrada.itens
    .filter((i) => CUSTOS[i.id] !== undefined && i.qtd > 0)
    .map((i) => {
      const unitario = precoFornecimento(i.id)!;
      return { id: i.id, nome: i.nome, qtd: i.qtd, unitario, total: r2(unitario * i.qtd) };
    });

  const custoEquipamentos = r2(itens.reduce((s, i) => s + i.total, 0));
  const frete = entrada.frete.valor;
  const custoFornecimento = r2(custoEquipamentos + frete);

  const maoDeObra = Math.max(0, entrada.maoDeObra || 0);
  const extras = Math.max(0, entrada.extras || 0);
  const baseIntegrador = r2(custoFornecimento + maoDeObra + extras);
  const margemValor = r2(baseIntegrador * (Math.max(0, entrada.margemPct || 0) / 100));
  const precoCliente = Math.round(baseIntegrador + margemValor);

  // R$ por kWh guardado ao longo da vida do banco — argumento de venda do lítio.
  const custoBanco = itens
    .filter((i) => i.id.startsWith('bat-'))
    .reduce((s, i) => s + i.total, 0);
  const utilizavel = Math.max(0.01, (entrada.bancoKwh || 0) * DOD_PROJETO);
  const custoKwhArmazenado = Math.round((custoBanco / (utilizavel * 365 * VIDA_ANOS_BANCO)) * 1000) / 1000;

  return {
    itens,
    custoEquipamentos,
    frete,
    freteRegiao: entrada.frete.regiao,
    fretePrazo: entrada.frete.prazo,
    freteDetalhe: entrada.frete.detalhe,
    custoFornecimento,
    maoDeObra,
    extras,
    baseIntegrador,
    margemValor,
    precoCliente,
    custoKwhArmazenado,
    tabelaVersao: TABELA_VERSAO,
    pesoKg: entrada.pesoKg,
  };
}
