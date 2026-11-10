/**
 * OFF-GRID: os campos que a tela manda para gerar a proposta (tipo `propostaOffGrid`, `modeloNumero: 2`).
 *
 * O servidor NÃO recalcula nada: o que sai impresso é o que chega aqui. Por isso, no modo "Meu equipamento", projeto e
 * autonomia saem do kit do integrador (kWp, placas, banco, baterias, inversor, geração, autonomia) e NADA do catálogo da
 * casa entra: sem `arranjo_*`, `bateria_nome`, `bateria_garantia`, `inversor_nome`, `inversor_saida`, `area_m2`,
 * `tensao` nem `prazo_entrega`.
 *
 * Sem importar nada com `@/`: o script de prova roda este arquivo direto com tsx.
 */
import type { EntradaOffGrid, ResultadoOffGrid } from './engine';
import { CARGAS } from './catalogo';
import type { ResultadoComparativo } from './comparativo';
import type { AvaliacaoKit, KitProprio } from './kitProprio';
import { camposPagamento, type PagamentoEstado } from './pagamento';

export interface AssinaturaCampos {
  empresa: { razao_social: string; cnpj: string; representante: string; cargo: string };
  cliente: { tipo: 'PF' | 'PJ'; nome: string; documento: string; representante?: string };
  local?: string;
}

export interface ParamsCampos {
  modo: 'casa' | 'proprio';
  r: ResultadoOffGrid;
  e: EntradaOffGrid;
  cidadeObra: string;
  endereco: string;
  validadeDias: number;
  /** Preço final ao cliente: o da casa (vindo do servidor) ou o que o integrador digitou. */
  preco: number;
  /** Só no modo casa: o prazo da transportadora. */
  prazoEntrega: string;
  /** Linhas que o cliente vê. Sem preço. */
  itensCliente: { nome: string; qtd: number; garantia?: number }[];
  /** Só no modo próprio. */
  kitProprio?: { kit: KitProprio; av: AvaliacaoKit };
  comparativo: { cmp: ResultadoComparativo; distanciaM: number } | null;
  pagamento: PagamentoEstado;
  bancos: string[];
  mostrarDadosBancarios: boolean;
  assinatura: AssinaturaCampos | null;
}

/** Aparelhos da lista, no formato que o template aceita. Vazio no modo "sei o kWh". */
export function aparelhosDaEntrada(e: EntradaOffGrid): { nome: string; qtd: number; w: number; horas: number; essencial: boolean }[] {
  if (e.modoConsumo !== 'cargas') return [];
  const lista: { nome: string; qtd: number; w: number; horas: number; essencial: boolean }[] = [];
  for (const c of CARGAS) {
    const qtd = e.qtds[c.id] || 0;
    if (qtd <= 0) continue;
    lista.push({
      nome: c.nome, qtd, w: c.w,
      horas: typeof e.horas[c.id] === 'number' ? e.horas[c.id] : c.h,
      essencial: typeof e.essenciais[c.id] === 'boolean' ? e.essenciais[c.id] : !!c.essencial,
    });
  }
  for (const p of e.personalizados) {
    lista.push({ nome: p.nome, qtd: p.qtd, w: p.w, horas: p.h, essencial: !!p.essencial });
  }
  return lista.slice(0, 60);
}

export function camposDaProposta(p: ParamsCampos): Record<string, unknown> {
  const { r, e } = p;
  const proprio = p.modo === 'proprio';
  const campos: Record<string, unknown> = {
    modo_equipamento: p.modo,
    cidade: p.cidadeObra || e.cidade || '',
    uf: e.uf,
    endereco: p.endereco,
    validade_dias: p.validadeDias,
    // Consumo
    consumo_dia: r.consumoTotalDia,
    consumo_essencial_dia: r.consumoEssencialDia,
    consumo_mes: r.consumoMensal,
    autonomia_sobre: e.autonomiaSobre,
    // Sol do lugar
    hsp_anual: r.hspAnual,
    hsp_pior: r.hspPior,
    criterio_hsp: r.criterioHsp,
    sombra: e.sombra,
    aparelhos: aparelhosDaEntrada(e),
    // Lista que o cliente vê, SEM preço unitário. Dinheiro: só o preço final.
    itens_cliente: p.itensCliente,
    investimento: p.preco,
    // Formas de pagamento: os mesmos nomes da proposta solar. `parcela_cartao` e `parcela_financiamento` não vão mais.
    ...camposPagamento(p.pagamento, p.preco),
    bancos_logos: p.bancos,
    mostrar_dados_bancarios: p.mostrarDadosBancarios,
  };

  if (proprio && p.kitProprio) {
    const { kit, av } = p.kitProprio;
    // "Projeto feito para N dias seguidos sem sol": só sai se o banco do integrador atende. Senão o template cai no
    // texto genérico, e a proposta não promete o que o kit dele não entrega.
    if (av.atende.banco.atende) campos.dias_pedidos = e.diasAutonomia;
    // Placas do integrador que não cobrem o mês de menos sol: o template não promete que a geração fecha a conta.
    campos.kit_atende_placas = av.atende.modulos.atende;
    // Autonomia, geração e banco do kit DO INTEGRADOR. `recargaDias` só entra se a avaliação trouxer.
    const aut = av.autonomia as AvaliacaoKit['autonomia'] & { recargaDias?: number };
    Object.assign(campos, {
      kwp: av.kwp,
      qtd_modulos: kit.qtdModulos,
      banco_kwh: av.bancoNominalKwh,
      banco_utilizavel: av.bancoUtilizavelKwh,
      banco_reserva: Math.round((av.bancoNominalKwh - av.bancoUtilizavelKwh) * 100) / 100,
      qtd_baterias: kit.qtdBaterias,
      inversor_kw: kit.inversorKw,
      aut_essencial_dias: aut.essencialDias,
      aut_tudo_dias: aut.tudoDias,
      aut_chuva_dias: aut.chuvaDias,
      aut_chuva_infinita: aut.chuvaInfinita,
      geracao_dia_fechado: av.geracaoDiaFechadoKwh,
      geracao_dia_pior: av.geracaoDiaPiorKwh,
      geracao_mes_media: av.geracaoMesMediaKwh,
      ...(typeof aut.recargaDias === 'number' ? { aut_recarga_dias: aut.recargaDias } : {}),
    });
  } else {
    campos.dias_pedidos = e.diasAutonomia;
    Object.assign(campos, {
      aut_essencial_dias: r.autonomia.essencialDias,
      aut_tudo_dias: r.autonomia.tudoDias,
      aut_chuva_dias: r.autonomia.chuvaDias,
      aut_chuva_infinita: r.autonomia.chuvaInfinita,
      aut_recarga_dias: r.autonomia.recargaDias,
      geracao_dia_fechado: r.autonomia.geracaoDiaFechado,
      kwp: r.kwp,
      qtd_modulos: r.qtdModulos,
      area_m2: r.areaM2,
      banco_kwh: r.bancoNominal,
      banco_utilizavel: r.bancoUtilizavel,
      banco_reserva: r.bancoReserva,
      qtd_baterias: r.qtdBaterias,
      bateria_nome: r.bateria.nome,
      bateria_garantia: r.bateria.garantia,
      inversor_nome: r.inversor.nome,
      inversor_kw: r.inversor.w / 1000,
      inversor_saida: r.inversor.saida,
      tensao: r.tensao,
      // Arranjo elétrico do kit da casa: o integrador liga por isto, então vai impresso.
      arranjo_serie: r.arranjo.serie,
      arranjo_paralelo: r.arranjo.paralelo,
      arranjo_voc_frio: r.arranjo.vocFrio,
      arranjo_vmp_quente: r.arranjo.vmpQuente,
      arranjo_corrente: r.arranjo.correnteA,
      arranjo_ok: r.arranjo.ok,
      ciclos_dia: r.ciclosDia,
      geracao_dia_pior: r.geracaoDiaPior,
      geracao_mes_media: r.geracaoMesMedia,
      prazo_entrega: p.prazoEntrega,
    });
  }

  if (p.comparativo) {
    const { cmp, distanciaM } = p.comparativo;
    Object.assign(campos, {
      comp_anos: cmp.anos,
      comp_opcoes: cmp.opcoes.map((o) => ({
        id: o.id, nome: o.nome, entrada: o.entrada, mensal: o.mensalMedio,
        total: o.total, porKwh: Math.round(o.porKwh * 100) / 100,
        linhas: o.linhas, observacao: o.observacao,
      })),
      comp_economia_rede: cmp.economiaContraRede,
      comp_economia_diesel: cmp.economiaContraDiesel,
      comp_equilibrio_m: cmp.equilibrioMetros,
      comp_vence_na_porta: cmp.venceComRedeNaPorta,
      comp_payback_diesel: cmp.paybackVsDiesel,
      comp_vencedor: cmp.vencedor,
      comp_distancia_m: distanciaM,
    });
  }

  // Aceite: só vai se a pessoa ligou e a assinatura está completa. Em branco, a chave nem existe.
  if (p.assinatura) campos.assinatura = p.assinatura;
  return campos;
}
