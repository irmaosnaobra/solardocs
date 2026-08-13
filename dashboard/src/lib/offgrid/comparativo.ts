/**
 * OFF-GRID — comparativo econômico contra as alternativas REAIS.
 *
 * Quem instala sistema isolado quase nunca está escolhendo entre off-grid e
 * telhado ligado na rua. Está escolhendo entre três coisas:
 *   1. puxar rede da concessionária até a propriedade (e pagar conta pra sempre);
 *   2. queimar diesel num grupo gerador;
 *   3. gerar e guardar a própria energia.
 * Sem essa conta na mesa, o preço do off-grid parece caro no vácuo. Com ela, a
 * pergunta deixa de ser "por que custa isso" e vira "em quanto tempo se paga".
 *
 * REGRA: aqui só entra o PREÇO AO CLIENTE. Custo de fornecimento e margem não
 * aparecem nem por dedução — a reposição do banco usa preço de VAREJO por kWh,
 * não o nosso custo.
 */

import { ALTERNATIVAS, CONST } from './constantes';

export interface EntradaComparativo {
  /** Consumo diário atendido pelo sistema (kWh/dia). */
  consumoDiaKwh: number;
  /** O que o cliente paga nesta proposta. Nunca o custo de fornecimento. */
  investimentoOffGrid: number;
  /** Banco nominal, pra estimar a reposição a preço de varejo. */
  bancoKwh: number;
  /** Metros de rede até o poste mais próximo. 0 = já tem rede na porta. */
  distanciaRedeM: number;
  /** R$/m que a concessionária cobra. Editável — só ela dá o número exato. */
  precoMetroRede: number;
  /** O ramal exige transformador próprio? */
  precisaTransformador: boolean;
  /** R$/kWh da conta de luz na região. */
  tarifaKwh: number;
}

export interface Opcao {
  id: 'rede' | 'diesel' | 'offgrid';
  nome: string;
  /** Desembolso de entrada. */
  entrada: number;
  /** O que continua saindo do bolso, por mês, na média do horizonte. */
  mensalMedio: number;
  /** Tudo somado no horizonte. */
  total: number;
  /** R$ por kWh consumido no horizonte. */
  porKwh: number;
  linhas: { rotulo: string; valor: number }[];
  observacao: string;
}

export interface ResultadoComparativo {
  anos: number;
  kwhTotal: number;
  opcoes: Opcao[];
  /** Diferença entre a melhor alternativa e o off-grid, no horizonte. */
  economiaContraRede: number;
  economiaContraDiesel: number;
  /** Metros de rede a partir dos quais o off-grid já sai na frente. */
  equilibrioMetros: number;
  /** true = o off-grid ganha mesmo com o poste na porta (0 m de obra). */
  venceComRedeNaPorta: boolean;
  /** Meses até o desembolso acumulado de cada alternativa alcançar o off-grid.
   *  0 = o off-grid já custa menos na ENTRADA, não há o que esperar. */
  paybackVsRede: number;
  paybackVsDiesel: number;
  vencedor: 'rede' | 'diesel' | 'offgrid';
}

const round = (n: number) => Math.round(n);

/** Soma um custo anual corrigido pela inflação, ao longo de N anos. */
function somaComInflacao(valorAno1: number, anos: number, inflacao: number): number {
  let s = 0;
  for (let a = 1; a <= anos; a++) s += valorAno1 * Math.pow(1 + inflacao, a - 1);
  return s;
}

export function compararAlternativas(e: EntradaComparativo): ResultadoComparativo {
  const anos = ALTERNATIVAS.HORIZONTE_ANOS;
  const kwhAno = e.consumoDiaKwh * 365;
  const kwhTotal = kwhAno * anos;

  // ── 1. Puxar a rede ───────────────────────────────────────────────────────
  // A obra é só a entrada: depois dela a conta chega todo mês, pra sempre, e
  // sobe acima da inflação geral há duas décadas.
  const obraRede = e.distanciaRedeM * e.precoMetroRede
    + (e.precisaTransformador ? ALTERNATIVAS.REDE_TRANSFORMADOR : 0);
  const contaAno1 = Math.max(
    ALTERNATIVAS.REDE_TAXA_MINIMA_MES * 12,
    kwhAno * e.tarifaKwh,
  );
  const contasRede = somaComInflacao(contaAno1, anos, ALTERNATIVAS.INFLACAO_TARIFA);
  const totalRede = obraRede + contasRede;

  // ── 2. Gerador a diesel ───────────────────────────────────────────────────
  // Combustível é o item que não perdoa: cada kWh sai queimando 0,35 litro.
  const trocasGerador = Math.max(0, Math.ceil(anos / ALTERNATIVAS.DIESEL_VIDA_ANOS) - 1);
  const equipDiesel = ALTERNATIVAS.DIESEL_EQUIPAMENTO * (1 + trocasGerador);
  const combustivelAno1 = kwhAno * ALTERNATIVAS.DIESEL_L_POR_KWH * ALTERNATIVAS.DIESEL_LITRO;
  const combustivel = somaComInflacao(combustivelAno1, anos, ALTERNATIVAS.INFLACAO_TARIFA);
  const manutencaoDiesel = somaComInflacao(ALTERNATIVAS.DIESEL_MANUTENCAO_ANO, anos, ALTERNATIVAS.INFLACAO_TARIFA);
  const totalDiesel = equipDiesel + combustivel + manutencaoDiesel;

  // ── 3. Off-grid ───────────────────────────────────────────────────────────
  // Inclui a reposição do banco no fim do horizonte. Omitir isso seria o mesmo
  // truque que a ferramenta existe pra desmontar.
  const reposicaoBanco = e.bancoKwh * ALTERNATIVAS.REPOSICAO_BANCO_KWH;
  const manutencaoOff = somaComInflacao(ALTERNATIVAS.OFFGRID_MANUTENCAO_ANO, anos, ALTERNATIVAS.INFLACAO_TARIFA);
  const totalOffGrid = e.investimentoOffGrid + reposicaoBanco + manutencaoOff;

  const opcoes: Opcao[] = [
    {
      id: 'rede',
      nome: 'Puxar a rede da concessionária',
      entrada: round(obraRede),
      mensalMedio: round(contasRede / (anos * 12)),
      total: round(totalRede),
      porKwh: totalRede / kwhTotal,
      linhas: [
        { rotulo: `Obra de ${e.distanciaRedeM} m de rede`, valor: round(e.distanciaRedeM * e.precoMetroRede) },
        ...(e.precisaTransformador ? [{ rotulo: 'Transformador e padrão', valor: ALTERNATIVAS.REDE_TRANSFORMADOR }] : []),
        { rotulo: `Contas de luz em ${anos} anos`, valor: round(contasRede) },
      ],
      observacao: 'O valor da obra é estimativa: só a concessionária fecha o orçamento, e ele muda com o terreno, a travessia e a necessidade de transformador.',
    },
    {
      id: 'diesel',
      nome: 'Gerador a diesel',
      entrada: ALTERNATIVAS.DIESEL_EQUIPAMENTO,
      mensalMedio: round((combustivel + manutencaoDiesel) / (anos * 12)),
      total: round(totalDiesel),
      porKwh: totalDiesel / kwhTotal,
      linhas: [
        { rotulo: `Grupo gerador${trocasGerador ? ` (${1 + trocasGerador}×, troca a cada ${ALTERNATIVAS.DIESEL_VIDA_ANOS} anos)` : ''}`, valor: round(equipDiesel) },
        { rotulo: `Diesel em ${anos} anos`, valor: round(combustivel) },
        { rotulo: 'Óleo, filtros e revisão', valor: round(manutencaoDiesel) },
      ],
      observacao: `Conta feita com ${ALTERNATIVAS.DIESEL_L_POR_KWH.toFixed(2).replace('.', ',')} L por kWh a R$ ${ALTERNATIVAS.DIESEL_LITRO.toFixed(2).replace('.', ',')} o litro, que é o consumo de um gerador em carga parcial — e ainda tem o barulho e o combustível pra buscar.`,
    },
    {
      id: 'offgrid',
      nome: 'Sistema off-grid (esta proposta)',
      entrada: round(e.investimentoOffGrid),
      mensalMedio: round((reposicaoBanco + manutencaoOff) / (anos * 12)),
      total: round(totalOffGrid),
      porKwh: totalOffGrid / kwhTotal,
      linhas: [
        { rotulo: 'Sistema completo, instalado', valor: round(e.investimentoOffGrid) },
        { rotulo: `Troca do banco no ano ${CONST.VIDA_ANOS_LIFEPO4}`, valor: round(reposicaoBanco) },
        { rotulo: 'Limpeza e revisão anual', valor: round(manutencaoOff) },
      ],
      observacao: 'Já inclui a troca das baterias no fim do período, a preço de mercado de hoje. Sem conta de luz, sem combustível e sem depender de rede.',
    },
  ];

  // Ponto de equilíbrio: com quantos metros de rede a obra + as contas passam a
  // custar mais que o sistema isolado. Quando a conta de luz sozinha já supera o
  // off-grid no período, o número dá negativo — e o que isso quer dizer é que
  // nem com o poste na porta a rede compensa. Dizer "0 m" esconderia a notícia.
  const bruto = e.precoMetroRede > 0
    ? (totalOffGrid - contasRede - (e.precisaTransformador ? ALTERNATIVAS.REDE_TRANSFORMADOR : 0)) / e.precoMetroRede
    : 0;
  const venceComRedeNaPorta = bruto <= 0;
  const equilibrioMetros = Math.max(0, Math.round(bruto));

  // Payback contra CADA alternativa, não contra a "mais barata no total": quem
  // decide olha o próprio bolso mês a mês, e as duas contas são diferentes.
  const meses = (entradaAlt: number, mensalAlt: number) =>
    mensalAlt > 0 ? Math.max(0, Math.ceil((e.investimentoOffGrid - entradaAlt) / mensalAlt)) : 0;
  const paybackVsRede = meses(obraRede, contaAno1 / 12);
  const paybackVsDiesel = meses(
    ALTERNATIVAS.DIESEL_EQUIPAMENTO,
    (combustivelAno1 + ALTERNATIVAS.DIESEL_MANUTENCAO_ANO) / 12,
  );

  const menor = opcoes.reduce((a, b) => (a.total <= b.total ? a : b));

  return {
    anos,
    kwhTotal: round(kwhTotal),
    opcoes,
    economiaContraRede: round(totalRede - totalOffGrid),
    economiaContraDiesel: round(totalDiesel - totalOffGrid),
    equilibrioMetros,
    venceComRedeNaPorta,
    paybackVsRede,
    paybackVsDiesel,
    vencedor: menor.id,
  };
}

/**
 * Parcela no cartão / financiamento. Fica AQUI (e não no template do PDF) pelo
 * mesmo motivo de todo o resto: o documento imprime o que recebe, não recalcula.
 */
export const TAXA_CARTAO: Record<number, number> = {
  1: 3.99, 2: 5.30, 3: 5.99, 4: 6.68, 5: 7.35, 6: 8.02, 7: 9.47, 8: 10.13,
  9: 10.78, 10: 11.43, 11: 12.06, 12: 12.70, 13: 13.32, 14: 13.94, 15: 14.56,
  16: 15.17, 17: 15.77, 18: 16.37, 19: 16.97, 20: 17.57, 21: 18.17,
};

/** Parcela do cartão: taxa da maquininha embutida e dividida. */
export function parcelaCartao(valor: number, n: number): number {
  const taxa = TAXA_CARTAO[n] ?? 0;
  return Math.ceil((valor * (1 + taxa / 100)) / n);
}

/** Parcela de financiamento (Price) com carência em meses. */
export function parcelaFinanciamento(valor: number, jurosMes: number, n: number, carenciaMeses = 3): number {
  const i = jurosMes / 100;
  const saldo = valor * Math.pow(1 + i, carenciaMeses);
  if (i <= 0) return Math.ceil(saldo / n);
  return Math.ceil((saldo * i) / (1 - Math.pow(1 + i, -n)));
}
