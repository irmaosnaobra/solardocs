/**
 * OFF-GRID — motor de dimensionamento e orçamento.
 *
 * Regra do módulo: NENHUM fator é escrito aqui. Tudo vem de constantes.ts, e
 * todo preço vem de catalogo.ts. O template do PDF não recalcula nada — recebe
 * estes números prontos. É o que impede o kit dizer "2 dias" e a tela de
 * autonomia dizer outra coisa.
 */

import { CONST, tensaoBanco } from './constantes';
import {
  CARGAS, BATERIAS, INVERSORES, MODULO, BOS,
  hspPiorMes, type Carga, type Bateria, type Inversor,
} from './catalogo';

// ─────────────────────────────────────────────────────────────────────────────

/** Aparelho digitado à mão pelo integrador. */
export interface CargaLivre {
  id: string;
  nome: string;
  w: number;
  h: number;
  qtd: number;
  motor: boolean;
  essencial: boolean;
  momentanea: boolean;
}

export interface EntradaOffGrid {
  uf: string;
  cidade?: string;
  /** 'cargas' = montou a lista de aparelhos. 'conta' = só sabe o kWh/mês. */
  modoConsumo: 'cargas' | 'conta';
  /** id da carga → quantidade. */
  qtds: Record<string, number>;
  /** id da carga → horas/dia (override do padrão). */
  horas: Record<string, number>;
  /** id da carga → é essencial? (override do padrão). */
  essenciais: Record<string, boolean>;
  /**
   * Aparelhos que não estão no catálogo. Nenhuma lista cobre tudo (elevador,
   * ar central, câmara fria grande, máquina do cliente), e um catálogo fechado
   * obrigaria o integrador a chutar em cima de outro item.
   */
  personalizados: CargaLivre[];
  consumoMensalKwh: number;
  /** 0-1. Só usado no modo 'conta'. */
  fracaoEssencial: number;
  /**
   * Potência do MAIOR motor da instalação (W). Só usado no modo 'conta' — no
   * modo lista sai da própria lista. Motor puxa 3 a 5× na partida: sem esta
   * informação o inversor é escolhido pela média e desarma quando a bomba liga.
   */
  maiorMotorW: number;
  /**
   * Critério do arranjo. 'pior' dimensiona pelo mês de menos sol do ano — o
   * sistema fecha a conta em junho também, e é o único critério honesto pra
   * quem não tem rede atrás. 'media' usa a média anual: sai bem mais barato e
   * é o que o kit de prateleira faz, mas no inverno o banco não fecha o ciclo.
   */
  criterioHsp: 'pior' | 'media';
  /** Dias que o banco precisa segurar sem sol nenhum. */
  diasAutonomia: number;
  /** O banco segura só o essencial ou a casa inteira nos dias sem sol? */
  autonomiaSobre: 'essencial' | 'tudo';
  /** Sombra sobre o arranjo ao longo do dia. */
  sombra: 'nenhuma' | 'leve' | 'media';
  /**
   * Fração do consumo que roda DE DIA, com sol na telha. Afeta só o desgaste do
   * banco (quantos ciclos por dia) — NUNCA o tamanho do banco nem a autonomia.
   * Num dia sem sol não existe consumo diurno: tudo cai na bateria. Encolher o
   * banco por isso entregaria um kit vendido como "2 dias" que dura 1,4.
   */
  fracaoDiurna: number;
  /** % que o integrador põe em cima do fornecimento. */
  margemPct: number;
  /** R$ de instalação/serviço que o integrador cobra. */
  maoDeObra: number;
  /** R$ de deslocamento, guindaste, obra civil etc. */
  extras: number;
}

/** Linha do kit SEM dinheiro. O preço vem do servidor, por id. */
export interface LinhaItem {
  id: string;
  nome: string;
  qtd: number;
  kg: number;
  garantia?: number;
}

export interface Aviso {
  nivel: 'erro' | 'atencao' | 'info';
  titulo: string;
  texto: string;
}

export interface ResultadoOffGrid {
  // Consumo
  consumoTotalDia: number;      // kWh/dia AC
  consumoEssencialDia: number;  // kWh/dia AC
  consumoMensal: number;        // kWh/mês AC
  demandaPico: number;          // W contínuos exigidos do inversor
  maiorMotor: number;           // W do maior motor
  surtoNecessario: number;      // W de surto exigido

  // Banco
  bateria: Bateria;
  qtdBaterias: number;
  bancoNominal: number;         // kWh
  bancoUtilizavel: number;      // kWh (nominal × DoD de projeto)
  bancoReserva: number;         // kWh que ficam guardados como reserva do BMS
  tensao: 12 | 24 | 48;
  ciclosDia: number;            // quanto do banco gira por dia

  // Autonomia — a pergunta que mais aparece
  autonomia: {
    essencialDias: number;
    essencialHoras: number;
    tudoDias: number;
    tudoHoras: number;
    /** Dias aguentando o essencial com o céu FECHADO (painel rendendo pouco). */
    chuvaDias: number;
    chuvaInfinita: boolean;
    /** Dias de sol pra devolver o banco a 100% depois da autonomia cheia. */
    recargaDias: number;
    geracaoDiaFechado: number;  // kWh/dia
  };
  /** Quanto tempo o banco cheio segura CADA aparelho sozinho. */
  porAparelho: { nome: string; w: number; horas: number }[];

  // Geração
  hspAnual: number;
  hspPior: number;
  hspProjeto: number;
  criterioHsp: 'pior' | 'media';
  /** Ligação dos módulos: série × paralelo, com as tensões de ponta. */
  arranjo: Arranjo;
  fatorSombra: number;
  prEfetivo: number;
  kwp: number;
  qtdModulos: number;
  areaM2: number;
  geracaoDiaPior: number;       // kWh/dia AC no mês pior
  geracaoDiaMedia: number;      // kWh/dia AC na média do ano
  geracaoMesMedia: number;      // kWh/mês
  fatorRecarga: number;
  sobra: number;                // % de folga da geração sobre o consumo

  // Equipamento
  inversor: Inversor;

  /** O kit, SEM dinheiro: o preço vem do servidor (ver /offgrid/orcar). */
  itens: LinhaItem[];
  pesoTotal: number;

  avisos: Aviso[];
  /** kWp por kWh de banco — sanidade contra o que o mercado vende. */
  razaoKwpKwh: number;
}

// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number, def: number) => (isFinite(v) && v >= 0 && v <= 1 ? v : def);

/** Número em português pros textos de aviso, que vão direto pra tela. */
const nb = (v: number, casas = 2) =>
  (isFinite(v) ? v : 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });

const round = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

function cargaHoras(c: Carga, e: EntradaOffGrid): number {
  const h = e.horas[c.id];
  return typeof h === 'number' && isFinite(h) && h >= 0 ? h : c.h;
}

function cargaEssencial(c: Carga, e: EntradaOffGrid): boolean {
  const v = e.essenciais[c.id];
  return typeof v === 'boolean' ? v : !!c.essencial;
}

/**
 * Escolhe banco + inversor JUNTOS, pelo custo do par.
 *
 * Separar as duas escolhas dá resultado pior e é o erro clássico: 24V economiza
 * no inversor mas encarece o kWh de bateria; 48V é o contrário. Só olhando os
 * dois no mesmo bolso o kit sai certo. A tensão viável é limitada por potência
 * (corrente em 12V vira cabo grosso e calor) e por tamanho de banco.
 */
function escolherArquitetura(
  necessarioKwh: number,
  wRequerido: number,
  kwpEstimado: number,
): { bateria: Bateria; qtd: number; kwh: number; inversor: Inversor } {
  const tensaoTeto = tensaoBanco(necessarioKwh, wRequerido);
  const opcoes: { bateria: Bateria; qtd: number; kwh: number; inversor: Inversor; custo: number }[] = [];

  for (const b of BATERIAS) {
    // Sistema grande não desce pra tensão baixa, mas sistema pequeno pode subir
    // pra 48V se o par sair mais barato — por isso o teto, não a igualdade.
    if (b.volts < tensaoTeto) continue;
    const qtd = Math.max(1, Math.ceil(necessarioKwh / b.kwh));
    const kwh = round(qtd * b.kwh);

    const candidatos = INVERSORES.filter((i) => i.volts === b.volts);
    // O inversor precisa dar conta da carga E receber o arranjo: FV muito acima
    // da nominal é geração cortada ao meio-dia.
    const inv =
      candidatos.find((i) => i.w >= wRequerido && i.w * 1.3 >= kwpEstimado * 1000) ||
      candidatos.find((i) => i.w >= wRequerido) ||
      candidatos[candidatos.length - 1];
    if (!inv) continue;

    opcoes.push({ bateria: b, qtd, kwh, inversor: inv, custo: qtd * b.custoRel + inv.custoRel });
  }

  if (!opcoes.length) {
    const b = BATERIAS[BATERIAS.length - 1];
    const qtd = Math.max(1, Math.ceil(necessarioKwh / b.kwh));
    return { bateria: b, qtd, kwh: round(qtd * b.kwh), inversor: INVERSORES[INVERSORES.length - 1] };
  }

  opcoes.sort((a, b) => a.custo - b.custo || a.kwh - b.kwh);
  const { bateria, qtd, kwh, inversor } = opcoes[0];
  return { bateria, qtd, kwh, inversor };
}

export interface Arranjo {
  serie: number;
  paralelo: number;
  total: number;
  /** Tensão da string na manhã mais fria — é ela que não pode passar do Voc
   *  máximo da entrada do inversor. */
  vocFrio: number;
  /** Tensão de operação na tarde mais quente — precisa continuar acima do
   *  mínimo do MPPT, senão o inversor larga a string justo no pico do calor. */
  vmpQuente: number;
  correnteA: number;
  ok: boolean;
}

/**
 * Ligação em série e paralelo dos módulos.
 *
 * As duas pontas de temperatura é que mandam: a manhã fria SOBE o Voc (e é ela
 * que estoura a entrada do inversor, não o meio-dia), e a tarde quente DERRUBA
 * o Vmp abaixo da janela do MPPT. Entre esses dois limites, prefere-se a maior
 * série possível — menos corrente, cabo mais fino, menos perda.
 *
 * A quantidade final de módulos sobe pro próximo arranjo que fecha strings
 * IGUAIS: string com número diferente de módulos desequilibra o MPPT e é erro
 * de instalação comum.
 */
function calcularArranjo(minimoModulos: number, inv: Inversor): Arranjo {
  const dTFrio = CONST.TEMP_MIN_CELULA - 25;
  const dTQuente = CONST.TEMP_MAX_CELULA - 25;
  const vocFrioMod = MODULO.voc * (1 + CONST.TEMP_COEF_VOC * dTFrio);
  const vmpQuenteMod = MODULO.vmp * (1 + CONST.TEMP_COEF_VMP * dTQuente);
  const vmpFrioMod = MODULO.vmp * (1 + CONST.TEMP_COEF_VMP * dTFrio);

  const serieMax = Math.min(
    Math.floor(inv.vocMax / vocFrioMod),        // não estoura a entrada
    Math.floor(inv.mpptMax / vmpFrioMod),        // fica dentro da janela do MPPT
  );
  const serieMin = Math.max(1, Math.ceil(inv.mpptMin / vmpQuenteMod));

  let melhor: Arranjo | null = null;
  for (let s = Math.max(1, serieMin); s <= Math.max(serieMin, serieMax); s++) {
    const p = Math.max(1, Math.ceil(minimoModulos / s));
    const total = s * p;
    const cand: Arranjo = {
      serie: s, paralelo: p, total,
      vocFrio: Math.round(s * vocFrioMod * 10) / 10,
      vmpQuente: Math.round(s * vmpQuenteMod * 10) / 10,
      correnteA: Math.round(p * MODULO.imp * 10) / 10,
      ok: serieMax >= serieMin,
    };
    // Menos módulos ganha; empatou, ganha a série maior (menos corrente).
    if (!melhor || cand.total < melhor.total || (cand.total === melhor.total && cand.serie > melhor.serie)) {
      melhor = cand;
    }
  }

  if (!melhor) {
    // Nenhuma série cabe na janela — devolve o mínimo pedido e marca como não-ok
    // pra virar aviso na tela em vez de um projeto errado impresso.
    return {
      serie: 1, paralelo: minimoModulos, total: minimoModulos,
      vocFrio: Math.round(vocFrioMod * 10) / 10,
      vmpQuente: Math.round(vmpQuenteMod * 10) / 10,
      correnteA: Math.round(minimoModulos * MODULO.imp * 10) / 10,
      ok: false,
    };
  }
  return melhor;
}

export function dimensionar(e: EntradaOffGrid): ResultadoOffGrid {
  const avisos: Aviso[] = [];

  // ── 1. Consumo ────────────────────────────────────────────────────────────
  let totalDia = 0;
  let essencialDia = 0;
  let somaW = 0;
  let maiorMotor = 0;
  /** Potências de uso momentâneo — pra achar a maior e a segunda maior. */
  const momentaneas: number[] = [];
  const porAparelho: { nome: string; w: number; horas: number }[] = [];

  if (e.modoConsumo === 'cargas') {
    for (const c of CARGAS) {
      const q = e.qtds[c.id] || 0;
      if (q <= 0) continue;
      const kwhDia = (c.w * q * cargaHoras(c, e)) / 1000;
      totalDia += kwhDia;
      if (cargaEssencial(c, e)) essencialDia += kwhDia;
      // Momentânea entra na conta de PICO por uma unidade só (ninguém liga dois
      // secadores de cabelo no mesmo segundo) e nunca na demanda contínua.
      if (c.momentanea) momentaneas.push(c.w);
      else somaW += c.w * q;
      if (c.motor) maiorMotor = Math.max(maiorMotor, c.w);
    }
    // Aparelhos fora do catálogo entram pela MESMA conta — sem atalho e sem
    // tratamento especial, senão o kit sai diferente conforme onde foi digitado.
    for (const p of e.personalizados || []) {
      if (!(p.qtd > 0) || !(p.w > 0)) continue;
      const kwhDia = (p.w * p.qtd * Math.max(0, p.h)) / 1000;
      totalDia += kwhDia;
      if (p.essencial) essencialDia += kwhDia;
      if (p.momentanea) momentaneas.push(p.w);
      else somaW += p.w * p.qtd;
      if (p.motor) maiorMotor = Math.max(maiorMotor, p.w);
    }
  } else {
    totalDia = (e.consumoMensalKwh || 0) / 30;
    essencialDia = totalDia * (e.fracaoEssencial || CONST.FRACAO_ESSENCIAL_PADRAO);
    // Sem lista de aparelhos não dá pra saber o pico. Estimativa de casa: a
    // demanda contínua costuma dar 3× o consumo médio horário do período ativo.
    somaW = (totalDia * 1000) / 8 * 3;
    maiorMotor = e.maiorMotorW > 0 ? e.maiorMotorW : 550;
    momentaneas.push(1500); // uma air fryer / ferro / micro-ondas sempre aparece
  }

  totalDia = round(totalDia, 3);
  essencialDia = round(Math.min(essencialDia, totalDia), 3);

  // Demanda = o que fica ligado (com simultaneidade) + o maior aparelho de uso
  // momentâneo + metade do segundo maior. Somar TODAS as momentâneas como se
  // ligassem no mesmo segundo especificaria um inversor gigante que nunca é usado.
  momentaneas.sort((a, b) => b - a);
  const picoMomentaneo = (momentaneas[0] || 0) + 0.5 * (momentaneas[1] || 0);
  const cargaContinua = somaW * CONST.SIMULTANEIDADE;
  const demandaPico = Math.round(cargaContinua + picoMomentaneo);
  const surtoNecessario = Math.round(maiorMotor * CONST.SURTO_MOTOR);
  // A partida do motor acontece COM o resto da casa ligada: soma, não substitui.
  const wRequerido = Math.max(demandaPico, cargaContinua + surtoNecessario / CONST.SOBRECARGA_INVERSOR);

  // ── 2. Geração (vem antes do banco: o arranjo pesa na escolha do inversor) ─
  const { anual: hspAnual, pior: hspPior } = hspPiorMes(e.uf, e.cidade);
  const hspProjeto = e.criterioHsp === 'media' ? hspAnual : hspPior;
  const fatorRecarga = CONST.FATOR_RECARGA[e.diasAutonomia] ?? 1.35;
  // Sombra entra como fator PRÓPRIO, multiplicando o PR. Escondida dentro do PR
  // viraria um sistema que não fecha a conta sem ninguém saber por quê.
  const fatorSombra = CONST.FATOR_SOMBRA[e.sombra] ?? 1;
  const prEfetivo = round(CONST.PR_OFFGRID * fatorSombra, 3);
  const kwpBruto = (totalDia / (hspProjeto * prEfetivo)) * fatorRecarga;
  const modulosMinimo = Math.max(1, Math.ceil((kwpBruto * 1000) / MODULO.wp));
  // Estimativa só pra escolher o inversor; a quantidade FINAL sai do arranjo
  // (strings iguais), calculado logo depois que o inversor é conhecido.
  const kwpEstimado = round((modulosMinimo * MODULO.wp) / 1000);

  // ── 3. Banco + inversor ───────────────────────────────────────────────────
  const baseAutonomia = e.autonomiaSobre === 'tudo' ? totalDia : essencialDia;
  // AC → DC: o que a bateria precisa entregar é maior que o que a tomada usa.
  const dcDia = baseAutonomia / (CONST.ETA_INV * CONST.ETA_FIOS);
  const bancoNecessario = (dcDia * e.diasAutonomia) / CONST.DOD_PROJETO;

  const banco = escolherArquitetura(bancoNecessario, wRequerido, kwpEstimado);
  const inversor = banco.inversor;
  const bancoNominal = banco.kwh;

  // Arranjo elétrico real: quantos módulos em série e quantas strings.
  const arranjo = calcularArranjo(modulosMinimo, inversor);
  const qtdModulos = arranjo.total;
  const kwp = round((qtdModulos * MODULO.wp) / 1000);
  const bancoUtilizavel = round(bancoNominal * CONST.DOD_PROJETO);
  const bancoReserva = round(bancoNominal - bancoUtilizavel);

  // DC → AC: o caminho de volta usa os MESMOS fatores. É isto que garante que
  // "kit de 2 dias" e "aguenta 2 dias" sejam o mesmo número.
  const acDisponivel = bancoUtilizavel * CONST.ETA_INV * CONST.ETA_FIOS;
  const autEssencial = essencialDia > 0 ? acDisponivel / essencialDia : 0;
  const autTudo = totalDia > 0 ? acDisponivel / totalDia : 0;

  // ── 4. O que o arranjo entrega ────────────────────────────────────────────
  const geracaoDiaPior = round(kwp * hspPior * prEfetivo);
  const geracaoDiaMedia = round(kwp * hspAnual * prEfetivo);
  const geracaoMesMedia = Math.round(geracaoDiaMedia * 30);
  const geracaoDiaFechado = round(kwp * hspPior * prEfetivo * CONST.GERACAO_DIA_FECHADO);

  // Dia de céu fechado não é dia sem geração: o painel ainda entrega ~12%. A
  // bateria só cobre o BURACO entre o consumo essencial e o que chegou do sol.
  const buracoChuva = essencialDia - geracaoDiaFechado;
  const chuvaInfinita = buracoChuva <= 0;
  const chuvaDias = chuvaInfinita ? 0 : acDisponivel / buracoChuva;

  // Recarga: o que sobra da geração depois de atender o consumo do dia volta pro
  // banco. Se não sobrar nada, o sistema não se recupera — vira aviso.
  const sobraDia = geracaoDiaPior - totalDia;
  const recargaDias = sobraDia > 0 ? (bancoUtilizavel * e.diasAutonomia) / sobraDia / e.diasAutonomia : 0;
  const recargaReal = sobraDia > 0 ? bancoUtilizavel / sobraDia : 0;

  const tensao = banco.bateria.volts;
  if (kwp * 1000 > inversor.w * 1.3) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Arranjo maior que o inversor',
      texto: `O arranjo de ${nb(kwp)} kWp passa do que o inversor de ${inversor.w / 1000} kW aproveita. Em dia de sol forte parte da geração é cortada. Considere dois inversores em paralelo — fale com a gente antes de fechar.`,
    });
  }

  // ── 5. Lista de fornecimento ──────────────────────────────────────────────
  const itens: LinhaItem[] = [];
  const push = (id: string, nome: string, qtd: number, kg: number, garantia?: number) => {
    if (qtd <= 0) return;
    itens.push({ id, nome, qtd, kg: round(qtd * kg, 1), garantia });
  };

  push(MODULO.id, MODULO.nome, qtdModulos, MODULO.kg, MODULO.garantia);
  push(banco.bateria.id, banco.bateria.nome, banco.qtd, banco.bateria.kg, banco.bateria.garantia);
  push(inversor.id, inversor.nome, 1, inversor.kg, inversor.garantia);
  push(BOS.estruturaPorModulo.id, BOS.estruturaPorModulo.nome, qtdModulos, BOS.estruturaPorModulo.kg);
  push(BOS.caboPorModulo.id, BOS.caboPorModulo.nome, qtdModulos, BOS.caboPorModulo.kg);
  push(BOS.stringBox.id, BOS.stringBox.nome, 1, BOS.stringBox.kg);
  push(BOS.quadroCA.id, BOS.quadroCA.nome, 1, BOS.quadroCA.kg);
  push(BOS.cabeamentoBanco.id, BOS.cabeamentoBanco.nome, 1, BOS.cabeamentoBanco.kg);
  push(BOS.aterramento.id, BOS.aterramento.nome, 1, BOS.aterramento.kg);
  if (banco.qtd >= 2) push(BOS.rackBateria.id, BOS.rackBateria.nome, 1, BOS.rackBateria.kg);

  const pesoTotal = round(itens.reduce((s, i) => s + i.kg, 0), 1);

  // ── 6. Autonomia por aparelho (banco cheio, um de cada vez) ───────────────
  const paraLista: { nome: string; w: number; qtd: number }[] = [
    ...CARGAS.map((c) => ({ nome: c.nome, w: c.w, qtd: e.modoConsumo === 'cargas' ? (e.qtds[c.id] || 0) : 0 })),
    ...(e.modoConsumo === 'cargas' ? (e.personalizados || []).map((p) => ({ nome: p.nome, w: p.w, qtd: p.qtd })) : []),
  ];
  for (const c of paraLista) {
    if (e.modoConsumo === 'cargas' && c.qtd <= 0) continue;
    if (!(c.w > 0)) continue;
    const w = c.w * Math.max(1, c.qtd);
    porAparelho.push({ nome: c.nome + (c.qtd > 1 ? ` (${c.qtd}×)` : ''), w, horas: round((acDisponivel * 1000) / w, 1) });
  }
  porAparelho.sort((a, b) => b.w - a.w);

  // ── 7. Avisos ─────────────────────────────────────────────────────────────
  if (e.modoConsumo === 'conta' && e.consumoMensalKwh >= 250) {
    // A conta de luz inclui chuveiro elétrico — que NÃO vai pro off-grid. Numa
    // casa de 400 kWh/mês o chuveiro pode ser 200: dimensionar em cima disso
    // dobra o kit à toa, ou pior, o cliente segue tomando banho elétrico e o
    // sistema cai toda noite.
    avisos.push({
      nivel: 'atencao',
      titulo: 'Tire o chuveiro da conta',
      texto: `${e.consumoMensalKwh} kWh/mês é o consumo COM rede. Chuveiro e torneira elétrica não entram no off-grid e costumam ser 30% a 50% da conta de uma casa. Informe aqui só o que vai ficar ligado no sistema isolado — ou monte a lista de aparelhos, que é mais seguro.`,
    });
  }
  if (totalDia <= 0) {
    avisos.push({ nivel: 'erro', titulo: 'Falta o consumo', texto: 'Marque os aparelhos ou informe o consumo da conta de luz pra o sistema ser dimensionado.' });
  }
  if (sobraDia <= 0 && totalDia > 0) {
    avisos.push({
      nivel: 'erro',
      titulo: 'O sistema não se recupera',
      texto: `No mês pior do ano a geração (${nb(geracaoDiaPior, 1)} kWh/dia) não cobre o consumo (${nb(totalDia, 1)} kWh/dia). O banco desce e não volta. Aumente o arranjo ou corte consumo.`,
    });
  }
  // Proporção do banco no kit: sai do índice relativo, não de reais — a conta é
  // a mesma e o preço continua no servidor.
  const relBanco = banco.qtd * banco.bateria.custoRel;
  const relKit = relBanco + inversor.custoRel + qtdModulos * MODULO.custoRel;
  if (relBanco > relKit * 0.55) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'O banco domina o orçamento',
      texto: `As baterias são ${Math.round((relBanco / relKit) * 100)}% do kit. Autonomia é a parte cara do off-grid — cada dia a mais custa um banco inteiro. Com 1 dia a menos, ou com a autonomia só no essencial, o kit cai bastante.`,
    });
  }
  if (e.diasAutonomia >= 3 && hspPior < 4.2) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Autonomia longa em região de inverno fraco',
      texto: `Aqui o mês pior tem ${nb(hspPior)} horas de sol pleno. Segurar ${e.diasAutonomia} dias exige banco grande E arranjo grande. Um gerador a diesel/gasolina de apoio costuma sair mais barato que o terceiro dia de bateria.`,
    });
  }
  if (e.criterioHsp === 'media' && hspPior < hspAnual * 0.9) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Arranjo dimensionado pela média do ano',
      texto: `Aqui o mês pior tem ${nb(hspPior)} h de sol contra ${nb(hspAnual)} h da média. Pela média o kit sai mais barato, mas no inverno a geração cai pra ~${nb(kwp * hspPior * prEfetivo, 1)} kWh/dia contra um consumo de ${nb(totalDia, 1)} kWh/dia. Combine isso com o cliente por escrito.`,
    });
  }
  if (!arranjo.ok) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Ligação precisa de conferência',
      texto: `Com este inversor (MPPT de ${inversor.mpptMin} a ${inversor.mpptMax} V, máximo ${inversor.vocMax} V) não fecha uma string cheia com o módulo de ${MODULO.wp} Wp. Confirme o arranjo com a gente antes de comprar o cabo.`,
    });
  } else if (arranjo.total > modulosMinimo) {
    avisos.push({
      nivel: 'info',
      titulo: `Arranjo fechou em ${arranjo.total} módulos`,
      texto: `A conta pedia ${modulosMinimo}, mas ${arranjo.paralelo} string${arranjo.paralelo > 1 ? 's' : ''} de ${arranjo.serie} em série é o que dá strings IGUAIS — string desigual desequilibra o MPPT. Os módulos a mais viram geração de sobra.`,
    });
  }
  if (arranjo.paralelo > inversor.mppts * 3) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Muitas strings em paralelo',
      texto: `${arranjo.paralelo} strings em ${inversor.mppts} entrada${inversor.mppts > 1 ? 's' : ''} de MPPT exige string box com fusível por string e cabo tronco reforçado (${nb(arranjo.correnteA, 1)} A no total).`,
    });
  }
  if (e.sombra === 'media') {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Sombra pesada no arranjo',
      texto: `Com sombra média o arranjo entrega ${Math.round((1 - fatorSombra) * 100)}% a menos e o kit cresce pra compensar. Se der pra reposicionar os módulos ou podar, o cliente economiza mais que qualquer negociação de preço.`,
    });
  }
  if (recargaReal > 4 && sobraDia > 0) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Recarga lenta depois de um temporal',
      texto: `Sobram ${nb(sobraDia, 1)} kWh/dia pra devolver energia ao banco, então recuperar os ${nb(bancoUtilizavel)} kWh utilizáveis leva ~${Math.round(recargaReal)} dias de sol. Mais dois módulos derrubam esse tempo pela metade.`,
    });
  }
  if (e.autonomiaSobre === 'tudo' && totalDia > 8) {
    avisos.push({
      nivel: 'info',
      titulo: 'Autonomia da casa inteira',
      texto: 'O banco está segurando TODO o consumo nos dias sem sol, inclusive ar-condicionado e conforto. Se o combinado com o cliente for "não falta geladeira, luz e água", troque pra autonomia no essencial e o kit fica bem menor.',
    });
  }
  if (inversor.w < wRequerido) {
    avisos.push({
      nivel: 'atencao',
      titulo: 'Pico acima do maior inversor da tabela',
      texto: `A demanda pede ${Math.round(wRequerido)} W contínuos. O maior inversor da tabela é ${inversor.w} W. Vai precisar de dois em paralelo — fale com a gente antes de fechar.`,
    });
  }
  const correnteCarga = (kwp * 1000) / tensao;
  if (correnteCarga > inversor.cargaA * 1.15) {
    avisos.push({
      nivel: 'info',
      titulo: 'Carga do banco no limite',
      texto: `O arranjo pode entregar mais corrente do que o inversor injeta no banco (${inversor.cargaA} A). Não é defeito: a recarga fica um pouco mais lenta que a conta acima.`,
    });
  }

  return {
    consumoTotalDia: round(totalDia),
    consumoEssencialDia: round(essencialDia),
    consumoMensal: Math.round(totalDia * 30),
    demandaPico,
    maiorMotor,
    surtoNecessario,

    bateria: banco.bateria,
    qtdBaterias: banco.qtd,
    bancoNominal,
    bancoUtilizavel,
    bancoReserva,
    tensao,
    // Só o que NÃO roda de dia passa pela bateria — é isso que gasta ciclo.
    // A fração diurna mexe no DESGASTE, nunca no tamanho do banco.
    ciclosDia: round(totalDia > 0 ? (totalDia * (1 - clamp01(e.fracaoDiurna, CONST.FRACAO_DIURNA))) / Math.max(0.01, bancoUtilizavel) : 0),

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
    porAparelho: porAparelho.slice(0, 12),

    hspAnual,
    hspPior,
    hspProjeto,
    criterioHsp: e.criterioHsp,
    arranjo,
    fatorSombra,
    prEfetivo,
    kwp,
    qtdModulos,
    areaM2: round(qtdModulos * MODULO.m2, 1),
    geracaoDiaPior,
    geracaoDiaMedia,
    geracaoMesMedia,
    fatorRecarga,
    sobra: totalDia > 0 ? Math.round(((geracaoDiaPior - totalDia) / totalDia) * 100) : 0,

    inversor,

    itens,
    pesoTotal,

    avisos,
    razaoKwpKwh: round(kwp / Math.max(0.01, bancoNominal)),
  };
}

/** Entrada zerada — usada pela tela e pelos testes de bancada. */
export function entradaPadrao(): EntradaOffGrid {
  return {
    uf: 'MG',
    cidade: '',
    modoConsumo: 'cargas',
    qtds: { led: 8, geladeira: 1, tv: 1, wifi: 1, celular: 1, bombapoco: 1 },
    horas: {},
    essenciais: {},
    personalizados: [],
    consumoMensalKwh: 300,
    fracaoEssencial: CONST.FRACAO_ESSENCIAL_PADRAO,
    maiorMotorW: 550,
    sombra: 'nenhuma',
    fracaoDiurna: CONST.FRACAO_DIURNA,
    criterioHsp: 'pior',
    diasAutonomia: 2,
    autonomiaSobre: 'essencial',
    margemPct: 35,
    maoDeObra: 0,
    extras: 0,
  };
}
