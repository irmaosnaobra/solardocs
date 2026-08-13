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
 * Base: pesquisa de varejo ago/2026 (NeoSolar, Minha Casa Solar, MeuGerador,
 * Braspower) com desconto de distribuidor. Mexeu em preço? Sobe TABELA_VERSAO —
 * tabela sem data é tabela que envelhece calada.
 */

export const TABELA_VERSAO = '2026-08';

/** id do catálogo → custo unitário de fornecimento (R$). */
export const PRECOS: Record<string, number> = {
  // Módulo
  'mod-585': 638,

  // Baterias de lítio
  'bat-12-100': 1780,
  'bat-24-100': 3290,
  'bat-48-100': 5390,
  'bat-48-200': 9890,

  // Inversores
  'inv-1500-12': 1690,
  'inv-3000-24': 3180,
  'inv-3600-48': 4390,
  'inv-5000-48': 5690,
  'inv-8000-48': 9250,
  'inv-12000-48': 14400,

  // Balanço do sistema
  'bos-estrutura': 96,
  'bos-cabo': 68,
  'bos-stringbox': 490,
  'bos-quadro': 540,
  'bos-banco': 395,
  'bos-aterramento': 330,
  'bos-rack': 460,
};

/** Frete por região, R$/kg com piso. Bateria de lítio é carga restrita
 *  (ONU 3480): não vai em qualquer transportadora, e isso está no preço. */
export const FRETE: Record<string, { nome: string; porKg: number; piso: number; prazo: string }> = {
  SE: { nome: 'Sudeste',      porKg: 1.25, piso: 380, prazo: '5 a 8 dias úteis' },
  S:  { nome: 'Sul',          porKg: 1.45, piso: 420, prazo: '6 a 10 dias úteis' },
  CO: { nome: 'Centro-Oeste', porKg: 1.85, piso: 480, prazo: '7 a 12 dias úteis' },
  NE: { nome: 'Nordeste',     porKg: 2.15, piso: 560, prazo: '8 a 14 dias úteis' },
  N:  { nome: 'Norte',        porKg: 3.20, piso: 780, prazo: '12 a 20 dias úteis' },
};

const UF_REGIAO: Record<string, keyof typeof FRETE> = {
  SP: 'SE', RJ: 'SE', MG: 'SE', ES: 'SE',
  PR: 'S', SC: 'S', RS: 'S',
  GO: 'CO', MT: 'CO', MS: 'CO', DF: 'CO',
  BA: 'NE', SE: 'NE', AL: 'NE', PE: 'NE', PB: 'NE', RN: 'NE', CE: 'NE', PI: 'NE', MA: 'NE',
  PA: 'N', AM: 'N', AC: 'N', RO: 'N', RR: 'N', AP: 'N', TO: 'N',
};

export function regiaoDaUf(uf: string): keyof typeof FRETE {
  return UF_REGIAO[(uf || '').trim().toUpperCase()] || 'SE';
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
  custoFornecimento: number;
  maoDeObra: number;
  extras: number;
  baseIntegrador: number;
  margemValor: number;
  precoCliente: number;
  custoKwhArmazenado: number;
  tabelaVersao: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Preço do kit. Item que não existe no preçário é IGNORADO (não vira zero
 * silencioso nem quebra o orçamento inteiro) — o front manda ids do catálogo e
 * um id desconhecido só pode ser front desatualizado.
 */
export function orcar(entrada: {
  itens: ItemPedido[];
  uf: string;
  pesoKg: number;
  margemPct: number;
  maoDeObra: number;
  extras: number;
  bancoKwh: number;
}): OrcamentoCalculado {
  const itens = entrada.itens
    .filter((i) => PRECOS[i.id] !== undefined && i.qtd > 0)
    .map((i) => {
      const unitario = PRECOS[i.id];
      return { id: i.id, nome: i.nome, qtd: i.qtd, unitario, total: r2(unitario * i.qtd) };
    });

  const custoEquipamentos = r2(itens.reduce((s, i) => s + i.total, 0));
  const reg = FRETE[regiaoDaUf(entrada.uf)];
  const peso = Math.max(0, entrada.pesoKg || 0);
  const frete = Math.max(reg.piso, Math.round(peso * reg.porKg));
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
    freteRegiao: reg.nome,
    fretePrazo: reg.prazo,
    custoFornecimento,
    maoDeObra,
    extras,
    baseIntegrador,
    margemValor,
    precoCliente,
    custoKwhArmazenado,
    tabelaVersao: TABELA_VERSAO,
  };
}
