/**
 * OFF-GRID — catálogo de cargas e de EQUIPAMENTOS (sem preço).
 *
 * PREÇO NÃO MORA AQUI. A tabela de fornecimento vive no servidor
 * (api/src/services/offgrid/precario.ts) porque isto aqui vira bundle público:
 * enquanto o custo esteve neste arquivo, qualquer um com o devtools aberto lia
 * quanto a gente cobra — inclusive quem nunca pagou o acesso.
 *
 * O que fica aqui é o que a gente QUER que apareça: specs, peso, garantia e as
 * tensões que mandam na ligação. O dimensionamento roda inteiro no navegador; o
 * dinheiro vem do servidor, e só pra quem tem direito a ver.
 */



// ─────────────────────────────────────────────────────────────────────────────
// CARGAS — o que o cliente vai ligar
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoCarga =
  | 'luz' | 'cozinha' | 'sala' | 'conforto' | 'lavanderia'
  | 'higiene' | 'agua' | 'seguranca' | 'trabalho' | 'campo';

export interface Carga {
  id: string;
  nome: string;
  /** Potência de regime, em W. */
  w: number;
  /** Horas por dia de uso típico. O integrador ajusta. */
  h: number;
  /** Motor? Entra na conta de surto do inversor (parte puxando 3 a 5×). */
  motor?: boolean;
  /** Entra no "modo essencial" — o que precisa continuar de pé sem sol. */
  essencial?: boolean;
  /** Fica ligado 24h (geladeira/freezer): as horas já são o ciclo do compressor. */
  continuo?: boolean;
  /**
   * Uso momentâneo (micro-ondas, ferro, secador, furadeira). Consome POUCA
   * energia no dia mas puxa MUITA potência no minuto em que roda. Somar todos
   * esses no pico como se ligassem juntos infla o inversor à toa — ninguém
   * secando cabelo passa roupa e usa a air fryer no mesmo instante. O motor
   * conta só o maior deles + metade do segundo.
   */
  momentanea?: boolean;
  grupo: GrupoCarga;
}

/**
 * Potências de placa típicas do mercado brasileiro (Inmetro / manual de
 * fabricante). São valores de REGIME: geladeira de 150 W não puxa 150 W o dia
 * inteiro — puxa nos ~8 h em que o compressor roda, e é isso que o campo `h`
 * já representa. O integrador ajusta hora a hora na tela.
 */
export const CARGAS: Carga[] = [
  // ── Iluminação ──
  { id: 'led',        nome: 'Lâmpada LED (bulbo comum)',   w: 9,   h: 5,  essencial: true, grupo: 'luz' },
  { id: 'ledpainel',  nome: 'Painel/plafon LED de teto',   w: 24,  h: 5,  essencial: true, grupo: 'luz' },
  { id: 'fita',       nome: 'Fita LED / luminária',        w: 15,  h: 4,  grupo: 'luz' },
  { id: 'refletor',   nome: 'Refletor LED externo',        w: 50,  h: 6,  grupo: 'luz' },
  { id: 'poste',      nome: 'Poste solar / luz de área',   w: 30,  h: 8,  grupo: 'luz' },

  // ── Cozinha ──
  { id: 'geladeira',  nome: 'Geladeira frost free',        w: 150, h: 8,  motor: true, essencial: true, continuo: true, grupo: 'cozinha' },
  { id: 'geladeira2', nome: 'Geladeira duplex / side by side', w: 220, h: 9, motor: true, essencial: true, continuo: true, grupo: 'cozinha' },
  { id: 'frigobar',   nome: 'Frigobar',                    w: 90,  h: 8,  motor: true, continuo: true, grupo: 'cozinha' },
  { id: 'freezer',    nome: 'Freezer horizontal',          w: 200, h: 8,  motor: true, essencial: true, continuo: true, grupo: 'cozinha' },
  { id: 'freezerv',   nome: 'Freezer vertical',            w: 180, h: 8,  motor: true, continuo: true, grupo: 'cozinha' },
  { id: 'microondas', nome: 'Micro-ondas',                 w: 1200, h: 0.3, momentanea: true, grupo: 'cozinha' },
  { id: 'airfryer',   nome: 'Air fryer',                   w: 1500, h: 0.3, momentanea: true, grupo: 'cozinha' },
  { id: 'inducao',    nome: 'Cooktop de indução (1 boca)', w: 2000, h: 0.5, momentanea: true, grupo: 'cozinha' },
  { id: 'cafeteira',  nome: 'Cafeteira elétrica',          w: 800, h: 0.2, momentanea: true, grupo: 'cozinha' },
  { id: 'torradeira', nome: 'Sanduicheira / torradeira',   w: 800, h: 0.1, momentanea: true, grupo: 'cozinha' },
  { id: 'panelaarroz',nome: 'Panela elétrica de arroz',    w: 700, h: 0.5, momentanea: true, grupo: 'cozinha' },
  { id: 'liquid',     nome: 'Liquidificador / batedeira',  w: 400, h: 0.2, motor: true, momentanea: true, grupo: 'cozinha' },
  { id: 'lavalouca',  nome: 'Máquina de lavar louça',      w: 1200, h: 0.7, motor: true, grupo: 'cozinha' },
  { id: 'coifa',      nome: 'Exaustor / coifa',            w: 150, h: 1,  motor: true, grupo: 'cozinha' },
  { id: 'bebedouro',  nome: 'Purificador / bebedouro',     w: 100, h: 5,  continuo: true, grupo: 'cozinha' },
  { id: 'adega',      nome: 'Adega climatizada',           w: 100, h: 8,  motor: true, continuo: true, grupo: 'cozinha' },

  // ── Sala e eletrônicos ──
  { id: 'tv43',       nome: 'TV LED 43"',                  w: 80,  h: 5,  grupo: 'sala' },
  { id: 'tv',         nome: 'TV LED 50-55"',               w: 110, h: 5,  essencial: true, grupo: 'sala' },
  { id: 'tv65',       nome: 'TV LED 65" ou maior',         w: 160, h: 5,  grupo: 'sala' },
  { id: 'receptor',   nome: 'Receptor / TV box / antena',  w: 25,  h: 5,  grupo: 'sala' },
  { id: 'som',        nome: 'Som / home theater',          w: 120, h: 3,  grupo: 'sala' },
  { id: 'videogame',  nome: 'Videogame',                   w: 150, h: 2,  grupo: 'sala' },
  { id: 'wifi',       nome: 'Roteador / internet fibra',   w: 25,  h: 24, essencial: true, continuo: true, grupo: 'sala' },
  { id: 'starlink',   nome: 'Starlink',                    w: 60,  h: 24, essencial: true, continuo: true, grupo: 'sala' },
  { id: 'celular',    nome: 'Carregadores de celular',     w: 15,  h: 4,  essencial: true, grupo: 'sala' },
  { id: 'notebook',   nome: 'Notebook',                    w: 65,  h: 5,  grupo: 'sala' },
  { id: 'desktop',    nome: 'Computador desktop + monitor', w: 285, h: 5, grupo: 'sala' },
  { id: 'impressora', nome: 'Impressora',                  w: 50,  h: 0.3, momentanea: true, grupo: 'sala' },

  // ── Conforto térmico ──
  { id: 'ventilador', nome: 'Ventilador de mesa / coluna', w: 90,  h: 6,  motor: true, grupo: 'conforto' },
  { id: 'ventteto',   nome: 'Ventilador de teto',          w: 120, h: 8,  motor: true, grupo: 'conforto' },
  { id: 'split9',     nome: 'Ar-condicionado 9.000 BTU inverter',  w: 750,  h: 6, motor: true, grupo: 'conforto' },
  { id: 'split12',    nome: 'Ar-condicionado 12.000 BTU inverter', w: 1000, h: 6, motor: true, grupo: 'conforto' },
  { id: 'split18',    nome: 'Ar-condicionado 18.000 BTU inverter', w: 1500, h: 6, motor: true, grupo: 'conforto' },
  { id: 'split24',    nome: 'Ar-condicionado 24.000 BTU inverter', w: 2000, h: 6, motor: true, grupo: 'conforto' },
  { id: 'circulador', nome: 'Climatizador / umidificador', w: 130, h: 6,  motor: true, grupo: 'conforto' },

  // ── Lavanderia e limpeza ──
  { id: 'maquina',    nome: 'Máquina de lavar roupa',      w: 500, h: 1,  motor: true, grupo: 'lavanderia' },
  { id: 'tanquinho',  nome: 'Tanquinho',                   w: 350, h: 0.5, motor: true, grupo: 'lavanderia' },
  { id: 'aspirador',  nome: 'Aspirador de pó',             w: 1200, h: 0.3, motor: true, momentanea: true, grupo: 'lavanderia' },
  { id: 'ferro',      nome: 'Ferro de passar',             w: 1100, h: 0.3, momentanea: true, grupo: 'lavanderia' },
  { id: 'vaporizador',nome: 'Vaporizador de roupa',        w: 1500, h: 0.2, momentanea: true, grupo: 'lavanderia' },

  // ── Higiene ──
  { id: 'secador',    nome: 'Secador de cabelo',           w: 1800, h: 0.15, momentanea: true, grupo: 'higiene' },
  { id: 'chapinha',   nome: 'Chapinha / prancha',          w: 60,  h: 0.2, grupo: 'higiene' },
  { id: 'barbeador',  nome: 'Barbeador / escova elétrica', w: 10,  h: 0.2, grupo: 'higiene' },

  // ── Água ──
  { id: 'bombapoco',  nome: 'Bomba d\'água 1/2 cv',        w: 550, h: 1.5, motor: true, essencial: true, grupo: 'agua' },
  { id: 'bomba1cv',   nome: 'Bomba d\'água 1 cv',          w: 1100, h: 2, motor: true, essencial: true, grupo: 'agua' },
  { id: 'bomba2cv',   nome: 'Bomba submersa 2 cv',         w: 2200, h: 3, motor: true, grupo: 'agua' },
  { id: 'pressurizad',nome: 'Pressurizador / recalque',    w: 370, h: 1,  motor: true, grupo: 'agua' },
  { id: 'boilerbomba',nome: 'Bomba do aquecedor solar',    w: 100, h: 6,  motor: true, grupo: 'agua' },
  { id: 'piscina',    nome: 'Bomba de piscina 1/2 cv',     w: 550, h: 4,  motor: true, grupo: 'agua' },

  // ── Segurança e área externa ──
  { id: 'cameras',    nome: 'Câmeras / DVR',               w: 60,  h: 24, essencial: true, continuo: true, grupo: 'seguranca' },
  { id: 'alarme',     nome: 'Alarme / central',            w: 20,  h: 24, essencial: true, continuo: true, grupo: 'seguranca' },
  { id: 'interfone',  nome: 'Interfone / vídeo porteiro',  w: 15,  h: 24, continuo: true, grupo: 'seguranca' },
  { id: 'portao',     nome: 'Portão eletrônico',           w: 300, h: 0.2, motor: true, momentanea: true, grupo: 'seguranca' },
  { id: 'cerca',      nome: 'Cerca elétrica / eletrificador', w: 25, h: 24, essencial: true, continuo: true, grupo: 'seguranca' },

  // ── Trabalho / oficina ──
  { id: 'freezer2',   nome: 'Câmara fria / expositor',     w: 350, h: 10, motor: true, essencial: true, continuo: true, grupo: 'trabalho' },
  { id: 'furadeira',  nome: 'Furadeira / esmeril / serra', w: 800, h: 1,  motor: true, momentanea: true, grupo: 'trabalho' },
  { id: 'compressor', nome: 'Compressor de ar',            w: 1500, h: 0.5, motor: true, momentanea: true, grupo: 'trabalho' },
  { id: 'solda',      nome: 'Máquina de solda inversora',  w: 4000, h: 0.3, momentanea: true, grupo: 'trabalho' },
  { id: 'betoneira',  nome: 'Betoneira',                   w: 1500, h: 1,  motor: true, grupo: 'trabalho' },

  // ── Sítio e produção rural ──
  { id: 'ordenha',    nome: 'Ordenhadeira',                w: 750, h: 2,  motor: true, essencial: true, grupo: 'campo' },
  { id: 'irrigacao',  nome: 'Motobomba de irrigação 1 cv', w: 1100, h: 3, motor: true, grupo: 'campo' },
  { id: 'forrageira', nome: 'Forrageira / triturador',     w: 2200, h: 0.5, motor: true, momentanea: true, grupo: 'campo' },
  { id: 'aerador',    nome: 'Aerador de tanque de peixe',  w: 370, h: 8,  motor: true, essencial: true, grupo: 'campo' },
  { id: 'chocadeira', nome: 'Chocadeira / estufa',         w: 200, h: 12, essencial: true, continuo: true, grupo: 'campo' },
  { id: 'resfriador', nome: 'Resfriador de leite',         w: 900, h: 6,  motor: true, essencial: true, continuo: true, grupo: 'campo' },
];

export const GRUPOS_CARGA: Record<GrupoCarga, string> = {
  luz:        'Iluminação',
  cozinha:    'Cozinha',
  sala:       'Sala e eletrônicos',
  conforto:   'Conforto térmico',
  lavanderia: 'Lavanderia e limpeza',
  higiene:    'Higiene',
  agua:       'Água e bombas',
  seguranca:  'Segurança e área externa',
  trabalho:   'Trabalho / oficina',
  campo:      'Sítio e produção rural',
};

export const ORDEM_GRUPOS: GrupoCarga[] = [
  'luz', 'cozinha', 'sala', 'conforto', 'lavanderia', 'higiene', 'agua', 'seguranca', 'trabalho', 'campo',
];

/**
 * Pontos de partida. O integrador clica, vê a casa montada e ajusta — é bem
 * mais rápido que marcar 60 itens do zero na frente do cliente.
 */
export const PERFIS: { id: string; nome: string; desc: string; qtds: Record<string, number> }[] = [
  {
    id: 'basico',
    nome: 'Casa simples',
    desc: 'Luz, geladeira, TV, internet e água',
    qtds: { led: 8, geladeira: 1, tv: 1, wifi: 1, celular: 2, bombapoco: 1, ventilador: 1, maquina: 1, microondas: 1 },
  },
  {
    id: 'completa',
    nome: 'Casa completa',
    desc: 'Tudo da casa simples + freezer, ar, eletros de cozinha',
    qtds: {
      led: 14, ledpainel: 4, geladeira: 1, freezer: 1, tv: 1, tv43: 1, wifi: 1, celular: 3, notebook: 1,
      bombapoco: 1, maquina: 1, microondas: 1, airfryer: 1, cafeteira: 1, liquid: 1, coifa: 1,
      ventteto: 2, split12: 1, ferro: 1, secador: 1, cameras: 1, portao: 1,
    },
  },
  {
    id: 'sitio',
    nome: 'Sítio / chácara',
    desc: 'Casa + poço, cerca, câmeras e Starlink',
    qtds: {
      led: 10, refletor: 2, geladeira: 1, freezer: 1, tv: 1, starlink: 1, celular: 2,
      bombapoco: 1, cerca: 1, cameras: 1, portao: 1, maquina: 1, microondas: 1, ventteto: 1, furadeira: 1,
    },
  },
  {
    id: 'produtor',
    nome: 'Produção rural',
    desc: 'Ordenha, resfriador de leite, irrigação',
    qtds: {
      led: 8, refletor: 2, geladeira: 1, ordenha: 1, resfriador: 1, irrigacao: 1, bombapoco: 1,
      cerca: 1, cameras: 1, starlink: 1, tv: 1, freezer: 1, forrageira: 1,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FORNECIMENTO — o que sai do nosso estoque
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemFornecimento {
  id: string;
  nome: string;
  /**
   * Custo RELATIVO (adimensional), com a bateria de 48V/100Ah valendo 1. Serve
   * só pra escolher a combinação mais barata de banco + inversor, decisão que
   * precisa acontecer ao vivo junto com o dimensionamento. Uma escala relativa
   * dá exatamente a MESMA escolha que os reais dariam, sem publicar a tabela.
   * Mexeu muito no preçário do servidor? Reveja estes índices.
   */
  custoRel: number;
  /** Peso unitário em kg, pro frete. Bateria de lítio é o que pesa a conta. */
  kg: number;
  /** Garantia em anos, pra sair na proposta do cliente. */
  garantia?: number;
}

export interface Bateria extends ItemFornecimento {
  kwh: number;
  volts: 12 | 24 | 48;
  ah: number;
}

/** Bancos de lítio. Módulos de 48V são empilháveis: 2 unidades = 10,24 kWh. */
/**
 * Banco: SAJ B3 5,0 kWh 48V, empilhável (o fabricante permite paralelo até
 * 76,8 kWh). Só existe UMA bateria no catálogo porque só existe uma no nosso
 * fornecedor — inventar opção que não dá pra comprar é orçamento que não fecha.
 */
export const BATERIAS: Bateria[] = [
  { id: 'bat-48-100', nome: 'Bateria SAJ B3 5,0 kWh 51,2V LiFePO4', kwh: 5.0, volts: 48, ah: 100, custoRel: 1.000, kg: 50, garantia: 10 },
];

export interface Inversor extends ItemFornecimento {
  /** Potência nominal contínua (W). */
  w: number;
  volts: 12 | 24 | 48;
  /** Saída. Bifásico 127/220 atende casa com poço e motor 220. */
  saida: string;
  /** MPPT embutido (all-in-one) dispensa controlador separado. */
  mpptEmbutido: boolean;
  /** Corrente máxima de carga do banco (A) — trava o quanto o FV recarrega. */
  cargaA: number;
  /** Janela de rastreamento do MPPT (V). Abaixo do mínimo o inversor não puxa
   *  a string; acima do Voc máximo ele queima. É o que define a ligação. */
  mpptMin: number;
  mpptMax: number;
  vocMax: number;
  /** Quantas entradas independentes de string. */
  mppts: number;
}

/**
 * Inversores SAJ H2 monofásicos 220V de BAIXA tensão (banco 40-60V), que é o
 * que casa com a bateria acima. Janela de MPPT 90-480V e 2 MPPTs são do
 * datasheet do fabricante.
 *
 * `vocMax` está travado em 480 V de propósito: o Voc máximo absoluto não estava
 * no datasheet que consultei, e o topo da janela de MPPT é um número que EU SEI.
 * Como o Voc absoluto de qualquer inversor é sempre ≥ o topo da janela, usar 480
 * garante que a string nunca passa do que o equipamento aceita rastrear — e
 * jamais chega perto de queimar. Custa um módulo a menos por string; queimar
 * inversor em campo custa a obra inteira. Se o manual confirmar um Voc maior, é
 * só subir aqui.
 */
export const INVERSORES: Inversor[] = [
  { id: 'inv-5000-48',  nome: 'Inversor SAJ H2 5 kW mono 220V — 2 MPPT',  w: 5000,  volts: 48, saida: '220V', mpptEmbutido: true, cargaA: 110, mpptMin: 90, mpptMax: 480, vocMax: 480, mppts: 2, custoRel: 0.899, kg: 22, garantia: 5 },
  { id: 'inv-10000-48', nome: 'Inversor SAJ H2 10 kW mono 220V — 2 MPPT', w: 10000, volts: 48, saida: '220V', mpptEmbutido: true, cargaA: 190, mpptMin: 90, mpptMax: 480, vocMax: 480, mppts: 2, custoRel: 1.348, kg: 30, garantia: 5 },
];

/**
 * Módulo de referência. Voc/Vmp/Isc/Imp são de datasheet de painel N-type
 * TOPCon 144 meias-células — é com eles que a ligação em série/paralelo é
 * calculada. Sem esses quatro números, contar string por potência é chute
 * impresso como projeto, e o integrador liga o painel em cima do chute.
 */
export const MODULO: ItemFornecimento & {
  wp: number; m2: number; voc: number; vmp: number; isc: number; imp: number;
} = {
  id: 'mod-620',
  nome: 'Módulo 620 Wp N-Plus bifacial (30mm)',
  wp: 620,
  m2: 2.7,
  // Elétricos de painel N-type TOPCon 620W de 144 meias-células — o formato que
  // bate com o do fornecedor (2382×1134×30mm, 23,0%). São eles que definem
  // quantos módulos entram em série.
  //
  // O Voc está no valor ALTO da faixa que o mercado pratica (55,7 contra ~53,5
  // de alguns fabricantes) de propósito: Voc maior = string mais curta = mais
  // longe do limite do inversor. Errar pra menos aqui é a única forma de estourar
  // a entrada CC numa manhã fria. Conferir na etiqueta do lote e ajustar.
  voc: 55.7,
  vmp: 46.1,
  isc: 14.3,
  imp: 13.6,
  custoRel: 0.111,
  kg: 30,
  garantia: 25,
};

/** Balanço do sistema (BOS). Quantidade derivada do porte, não chutada. */
export const BOS = {
  estruturaPorModulo:  { id: 'bos-estrutura',    nome: 'Estrutura de fixação (por módulo)',             kg: 3.2 },
  caboPorModulo:       { id: 'bos-cabo',         nome: 'Cabo solar 6mm² + conectores MC4 (por módulo)', kg: 1.1 },
  stringBox:           { id: 'bos-stringbox',    nome: 'String box CC com DPS e fusíveis',              kg: 2.5 },
  quadroCA:            { id: 'bos-quadro',       nome: 'Quadro CA com disjuntores e DPS',               kg: 4 },
  cabeamentoBanco:     { id: 'bos-banco',        nome: 'Cabos de banco, barramento e disjuntor CC',     kg: 5 },
  aterramento:         { id: 'bos-aterramento',  nome: 'Kit de aterramento (haste, cordoalha, TAP)',    kg: 6 },
  rackBateria:         { id: 'bos-rack',         nome: 'Rack de acomodação do banco',                   kg: 11 },
} as const;


/**
 * HSP (horas de sol pleno) — média anual, base CRESESB.
 * Espelha a tabela do Gerador de Proposta on-grid (api/src/services/
 * propostaSolarData.ts). Off-grid usa o MÊS PIOR, não a média: um sistema
 * isolado que só fecha a conta em novembro deixa o cliente no escuro em junho.
 * O fator abaixo converte média anual → mês pior por região.
 */
export const HSP_UF: Record<string, number> = {
  AC: 4.6, AM: 4.5, AP: 4.6, PA: 4.8, RO: 4.7, RR: 4.7, TO: 5.4,
  AL: 5.7, BA: 5.6, CE: 5.9, MA: 5.6, PB: 5.8, PE: 5.7, PI: 5.8, RN: 5.8, SE: 5.6,
  DF: 5.5, GO: 5.5, MS: 5.3, MT: 5.4,
  ES: 5.3, MG: 5.4, RJ: 5.1, SP: 5.0,
  PR: 4.8, RS: 4.7, SC: 4.6,
};

/**
 * HSP por cidade — MESMA tabela do gerador on-grid (propostaSolarData.ts). Sem
 * ela, Curitiba (4,65) e Londrina (5,15) seriam os dois "PR = 4,8" e as duas
 * ferramentas dariam números diferentes pro mesmo endereço.
 */
const HSP_CIDADE: Record<string, number> = {
  'sao paulo': 4.95, 'campinas': 5.25, 'ribeirao preto': 5.65, 'sao jose dos campos': 5.10,
  'sorocaba': 5.20, 'santos': 4.85, 'sao bernardo do campo': 4.95, 'osasco': 4.95,
  'guarulhos': 4.95, 'piracicaba': 5.30, 'bauru': 5.45, 'presidente prudente': 5.55,
  'belo horizonte': 5.45, 'uberlandia': 5.65, 'uberaba': 5.70, 'juiz de fora': 5.20,
  'contagem': 5.45, 'montes claros': 5.95, 'governador valadares': 5.55, 'ipatinga': 5.40,
  'rio de janeiro': 5.05, 'niteroi': 5.10, 'campos dos goytacazes': 5.25, 'petropolis': 4.95,
  'nova iguacu': 5.05, 'duque de caxias': 5.05,
  'vitoria': 5.30, 'vila velha': 5.30, 'serra': 5.30, 'cariacica': 5.30,
  'salvador': 5.65, 'feira de santana': 5.75, 'vitoria da conquista': 5.85, 'juazeiro': 6.20,
  'barreiras': 5.95, 'ilheus': 5.50,
  'recife': 5.70, 'petrolina': 6.20, 'caruaru': 5.80, 'jaboatao dos guararapes': 5.70,
  'fortaleza': 5.90, 'sobral': 6.10, 'juazeiro do norte': 6.10,
  'joao pessoa': 5.85, 'campina grande': 5.85, 'natal': 5.95, 'mossoro': 6.15,
  'maceio': 5.65, 'aracaju': 5.55, 'sao luis': 5.55, 'teresina': 5.85,
  'goiania': 5.55, 'anapolis': 5.50, 'brasilia': 5.55, 'cuiaba': 5.55,
  'campo grande': 5.40, 'dourados': 5.30,
  'curitiba': 4.65, 'londrina': 5.15, 'maringa': 5.20, 'cascavel': 5.05,
  'florianopolis': 4.55, 'joinville': 4.45, 'blumenau': 4.45, 'chapeco': 4.85,
  'porto alegre': 4.75, 'caxias do sul': 4.80, 'pelotas': 4.65, 'santa maria': 4.85,
  'manaus': 4.55, 'belem': 4.85, 'palmas': 5.50, 'porto velho': 4.75,
  'rio branco': 4.65, 'macapa': 4.65, 'boa vista': 4.75,
};

function normalizeCidade(cidade: string): string {
  return (cidade || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Norte/Nordeste varia pouco no ano (0,92 da média no pior mês); Sul e Sudeste
 *  despencam no inverno (0,78). Mesma sazonalidade do gerador on-grid. */
const UF_PLANA = ['AC','AM','AP','PA','RO','RR','TO','AL','BA','CE','MA','PB','PE','PI','RN','SE','GO','DF','MT','MS'];

export function hspPiorMes(uf: string, cidade?: string): { anual: number; pior: number; porCidade: boolean } {
  const u = (uf || '').trim().toUpperCase();
  const daCidade = cidade ? HSP_CIDADE[normalizeCidade(cidade)] : undefined;
  const anual = daCidade ?? HSP_UF[u] ?? 5.2;
  const fator = UF_PLANA.includes(u) ? 0.92 : 0.78;
  return { anual, pior: Math.round(anual * fator * 100) / 100, porCidade: daCidade !== undefined };
}

export const UFS = Object.keys(HSP_UF).sort();
