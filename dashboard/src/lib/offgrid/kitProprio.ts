/**
 * OFF-GRID — avaliação de um kit que o INTEGRADOR trouxe ("Meu equipamento").
 *
 * Função pura: recebe o resultado de dimensionar() (que carrega `requisitos`) e
 * o kit do integrador, e devolve se o kit atende e os números recalculados com
 * o kit DELE. Mesmas constantes e mesmas fórmulas do engine.ts (secções 3 e 4),
 * pra proposta fechar a conta sem mostrar número do catálogo SAJ.
 *
 * Não importa catalogo.ts de propósito: nada do kit do catálogo entra aqui.
 */

import { CONST } from './constantes';
import type { ResultadoOffGrid } from './engine';

export interface KitProprio {
  /** Potência nominal contínua do inversor, em kW. */
  inversorKw: number;
  /** Wp de cada placa. */
  moduloWp: number;
  qtdModulos: number;
  /** kWh NOMINAIS de cada bateria. */
  bateriaKwh: number;
  qtdBaterias: number;
}

/** Um item do kit: atende ou não, e o que falta (0 quando atende). */
export interface ItemAtende {
  atende: boolean;
  /** Quanto falta na unidade do item (kWp, kWh ou W). 0 quando atende. */
  falta: number;
  /** Falta convertida em unidades do integrador (placas, baterias), quando faz sentido. */
  faltaUnidades?: number;
}

export interface AvaliacaoKit {
  kwp: number;
  geracaoDiaPiorKwh: number;
  geracaoDiaMediaKwh: number;
  geracaoMesMediaKwh: number;
  geracaoDiaFechadoKwh: number;
  bancoNominalKwh: number;
  bancoUtilizavelKwh: number;
  /** MESMO formato de `resultado.autonomia` do engine, calculado com o kit do integrador. */
  autonomia: ResultadoOffGrid['autonomia'];
  /** Sobra de geração no mês pior sobre o consumo, em % (igual a `sobra` do motor). */
  sobraPct: number;
  atende: {
    modulos: ItemAtende;   // kWp do kit contra o kWp bruto exigido
    banco: ItemAtende;     // kWh nominais contra o banco necessário
    inversor: ItemAtende;  // W contínuos contra a demanda
    surto: ItemAtende;     // W contra (contínua + surto / sobrecarga)
    /** true só se os quatro itens atendem. */
    tudo: boolean;
  };
}

const round = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

/** Tolerância numérica: evita "falta 0,00" por ruído de ponto flutuante. */
const EPS = 1e-9;

export function avaliarKitProprio(resultado: ResultadoOffGrid, kit: KitProprio): AvaliacaoKit {
  const req = resultado.requisitos;
  if (!req) throw new Error('avaliarKitProprio: o resultado não traz `requisitos` (use dimensionar() atual).');

  const inversorW = Math.max(0, kit.inversorKw) * 1000;
  const modulos = Math.max(0, Math.floor(kit.qtdModulos) || 0);
  const baterias = Math.max(0, Math.floor(kit.qtdBaterias) || 0);
  const moduloWp = Math.max(0, kit.moduloWp);
  const bateriaKwh = Math.max(0, kit.bateriaKwh);

  // ── Geração (engine.ts, secção 4) ─────────────────────────────────────────
  const kwp = round((modulos * moduloWp) / 1000);
  const geracaoDiaPior = round(kwp * req.hspPiorMes * req.prEfetivo);
  const geracaoDiaMedia = round(kwp * req.hspAnual * req.prEfetivo);
  const geracaoMesMedia = Math.round(geracaoDiaMedia * 30);
  const geracaoDiaFechado = round(kwp * req.hspPiorMes * req.prEfetivo * CONST.GERACAO_DIA_FECHADO);

  // ── Banco ─────────────────────────────────────────────────────────────────
  // A bateria do integrador usa o DoD de projeto do catálogo (LFP, 80%): o
  // motor só trabalha com lítio, então a mesma régua vale pro kit dele.
  const bancoNominal = round(baterias * bateriaKwh);
  const bancoUtilizavel = round(bancoNominal * CONST.DOD_PROJETO);
  const acDisponivel = bancoUtilizavel * CONST.ETA_INV * CONST.ETA_FIOS;
  const autEssencial = req.consumoEssencialDiaKwh > 0 ? acDisponivel / req.consumoEssencialDiaKwh : 0;
  const autTudo = req.consumoTotalDiaKwh > 0 ? acDisponivel / req.consumoTotalDiaKwh : 0;
  const buracoChuva = req.consumoEssencialDiaKwh - geracaoDiaFechado;
  const chuvaInfinita = buracoChuva <= 0;
  const chuvaDias = chuvaInfinita ? 0 : acDisponivel / buracoChuva;

  const sobraDia = geracaoDiaPior - req.consumoTotalDiaKwh;
  // Recarga: dias de sol pra devolver o banco utilizável a 100% com a sobra do dia (engine.ts).
  const recargaReal = sobraDia > 0 ? bancoUtilizavel / sobraDia : 0;
  const sobraPct = req.consumoTotalDiaKwh > 0 ? Math.round((sobraDia / req.consumoTotalDiaKwh) * 100) : 0;

  // ── O kit atende? ─────────────────────────────────────────────────────────
  const faltaKwp = Math.max(0, req.kwpBrutoNecessario - kwp);
  const faltaBanco = Math.max(0, req.bancoNecessarioKwh - bancoNominal);
  const faltaInv = Math.max(0, req.demandaPicoW - inversorW);
  // Surto: o inversor do integrador aceita a mesma sobrecarga de partida (2x)
  // que o motor admite no do catálogo, porque o kit dele não informa outra.
  const surtoExigidoW = req.cargaContinuaW + req.surtoNecessarioW / req.sobrecargaInversor;
  const faltaSurto = Math.max(0, surtoExigidoW - inversorW);

  const atende = {
    modulos: {
      atende: faltaKwp <= EPS,
      falta: faltaKwp <= EPS ? 0 : round(faltaKwp),
      faltaUnidades: faltaKwp <= EPS || moduloWp <= 0 ? 0 : Math.ceil((faltaKwp * 1000) / moduloWp - EPS),
    },
    banco: {
      atende: faltaBanco <= EPS,
      falta: faltaBanco <= EPS ? 0 : round(faltaBanco),
      faltaUnidades: faltaBanco <= EPS || bateriaKwh <= 0 ? 0 : Math.ceil(faltaBanco / bateriaKwh - EPS),
    },
    inversor: { atende: faltaInv <= EPS, falta: faltaInv <= EPS ? 0 : Math.round(faltaInv) },
    surto: { atende: faltaSurto <= EPS, falta: faltaSurto <= EPS ? 0 : Math.round(faltaSurto) },
    tudo: false,
  };
  atende.tudo = atende.modulos.atende && atende.banco.atende && atende.inversor.atende && atende.surto.atende;

  return {
    kwp,
    geracaoDiaPiorKwh: geracaoDiaPior,
    geracaoDiaMediaKwh: geracaoDiaMedia,
    geracaoMesMediaKwh: geracaoMesMedia,
    geracaoDiaFechadoKwh: geracaoDiaFechado,
    bancoNominalKwh: bancoNominal,
    bancoUtilizavelKwh: bancoUtilizavel,
    autonomia: {
      essencialDias: round(autEssencial),
      essencialHoras: Math.round(autEssencial * 24),
      tudoDias: round(autTudo),
      tudoHoras: Math.round(autTudo * 24),
      chuvaDias: round(chuvaDias),
      chuvaInfinita,
      recargaDias: round(recargaReal),
      geracaoDiaFechado,
    },
    sobraPct,
    atende,
  };
}
