/**
 * OFF-GRID — constantes de engenharia. FONTE ÚNICA.
 *
 * REGRA DE OURO deste módulo: o dimensionamento do banco e a tela de autonomia
 * ("quanto tempo aguenta sem sol") são o MESMO cálculo lido em direções
 * opostas. Se as duas usarem constantes diferentes, o kit dimensionado pra
 * "2 dias" mostra "1,6 dia" na tela de autonomia — em cima da pergunta que mais
 * aparece na boca do cliente. Por isso tudo que é fator vive AQUI e nada é
 * redigitado no engine, na tela ou no template do PDF.
 *
 * Sentido da cadeia (uma direção só, sempre):
 *   consumo AC (o que o aparelho puxa da tomada)
 *     ÷ ETA_INV ÷ ETA_FIOS  →  energia DC que sai da bateria
 *     ÷ DOD_PROJETO         →  capacidade NOMINAL de banco necessária
 * E o inverso, pra autonomia:
 *   banco nominal × DOD_PROJETO × ETA_INV × ETA_FIOS ÷ consumo AC/dia = dias
 *
 * Química: LiFePO4 apenas. Chumbo-ácido ficou fora de propósito — exigiria
 * tabela de correção por temperatura (Kt), DoD de 30%, e troca a cada 3-5 anos
 * que envenena o custo de posse. Todo o catálogo de fornecimento é lítio.
 */

export const TABELA_VERSAO = '2026-08';

export const CONST = {
  /** Rendimento do inversor senoidal puro DC→AC. Fabricantes anunciam 93-96%
   *  em carga ótima; 92% é o que sobra no dia real (carga parcial, standby). */
  ETA_INV: 0.92,

  /** Perda de cabeamento CC entre banco, inversor e barramento. */
  ETA_FIOS: 0.98,

  /** Round-trip do LiFePO4 (carga + descarga + BMS). Só entra no cálculo do FV,
   *  porque a energia que vai pra bateria paga esse pedágio duas vezes. */
  ETA_BAT_RT: 0.95,

  /** Profundidade de descarga de PROJETO. O LiFePO4 aguenta 90% com folga, mas
   *  quem projeta em 90% entrega um banco que vive raspando o fundo: o BMS corta
   *  antes, o cliente liga que "acabou a energia" e o ciclo de vida encurta.
   *  80% é o número do projeto — os 20% que sobram SÃO a reserva do BMS, não uma
   *  segunda margem. Não aplicar outro piso de SoC por cima disto. */
  DOD_PROJETO: 0.80,

  /** Performance Ratio de sistema ISOLADO. Engloba temperatura da célula,
   *  sujeira, cabos CC, MPPT e o pedágio do banco. Sistema on-grid trabalha com
   *  0,80; isolado é sempre pior porque a energia passa pela bateria e porque
   *  o MPPT corta geração quando o banco enche (clipping de meio-dia). */
  PR_OFFGRID: 0.70,

  /** Sobra de geração pra RECARREGAR o banco depois dos dias sem sol. É um fator
   *  NOMEADO e separado do PR — some os dois num número só e o kit sai 40% mais
   *  caro sem ninguém saber por quê. Só entra quando a autonomia pedida passa de
   *  1 dia: quem pede 1 dia aceita voltar ao normal no dia seguinte. Na prática
   *  equivale a devolver o banco cheio em ~3 dias de sol depois do temporal —
   *  número que a tela mostra como "recarga". */
  FATOR_RECARGA: { 1: 1.1, 2: 1.25, 3: 1.35, 4: 1.4, 5: 1.4 } as Record<number, number>,

  /** Geração num dia FECHADO, como fração de um dia de sol. A pesquisa de
   *  mercado dá 10-25% (nublado carregado / chuva). Usamos a ponta conservadora
   *  na conta e mostramos a faixa na tela — prometer 25% em dia de temporal é
   *  como o cliente descobre que a proposta mentiu. */
  GERACAO_DIA_FECHADO: 0.12,
  GERACAO_DIA_FECHADO_FAIXA: [0.1, 0.25] as const,

  /** Fator de simultaneidade: numa casa, nunca tudo liga junto. Aplicado sobre a
   *  soma das potências pra achar a demanda contínua do inversor. */
  SIMULTANEIDADE: 0.65,

  /** Motor (geladeira, bomba, ar) puxa de 3 a 5× a potência na partida. O
   *  inversor senoidal aguenta ~2× a nominal por alguns segundos, então a
   *  nominal precisa cobrir metade do surto do maior motor. */
  SURTO_MOTOR: 3.5,
  SOBRECARGA_INVERSOR: 2.0,

  /** Fração do consumo total que é ESSENCIAL, quando o integrador informa só a
   *  conta de luz e não monta a lista de aparelhos. Geladeira + luz + tomadas +
   *  internet costumam dar 40-50% de uma casa comum. */
  FRACAO_ESSENCIAL_PADRAO: 0.45,

  /** Fração do consumo que roda de DIA, com sol na telha, sem passar pela
   *  bateria. Usado só pra estimar o ciclo diário do banco na ficha técnica. */
  FRACAO_DIURNA: 0.40,

  /** Vida útil pra conta de custo por kWh armazenado. LiFePO4 sério entrega
   *  6.000 ciclos a 80% DoD; a 1 ciclo/dia isso é ~16 anos, mas o mercado
   *  garante 10. Usamos 10 anos na conta de posse. */
  CICLOS_LIFEPO4: 6000,
  VIDA_ANOS_LIFEPO4: 10,

  /** Sombra sobre o arranjo. Multiplica o PR e é mostrado SEPARADO — sombra
   *  escondida dentro do PR vira sistema que não fecha a conta e ninguém
   *  descobre por quê. Árvore que hoje é pequena cresce: quando houver dúvida,
   *  o certo é o nível de cima. */
  FATOR_SOMBRA: { nenhuma: 1.0, leve: 0.92, media: 0.82 } as Record<string, number>,

  /** Coeficientes térmicos do módulo (%/°C) e temperaturas de projeto.
   *  Voc SOBE no frio — é a manhã fria que estoura a entrada do inversor, não
   *  o meio-dia. Vmp CAI no calor, e é isso que derruba a string abaixo da
   *  janela do MPPT à tarde. As duas pontas mandam na ligação em série. */
  TEMP_COEF_VOC: -0.0025,
  TEMP_COEF_VMP: -0.0035,
  TEMP_MIN_CELULA: 8,
  TEMP_MAX_CELULA: 65,
} as const;

/**
 * Custos das ALTERNATIVAS ao off-grid — o comparativo que responde "por que
 * isso custa tudo isso?". Um sistema isolado quase nunca disputa com o telhado
 * do vizinho: disputa com puxar poste da concessionária ou com queimar diesel.
 *
 * Fontes (ago/2026): orçamentos reais de extensão rural da CEMIG divulgados por
 * clientes (R$9.235 por 78 m e R$20.210 por 55 m — R$118/m e R$367/m, a
 * diferença é o transformador); preço do diesel S10 na ANP (R$6,25 a R$7,15/L
 * em 2026); consumo específico de grupo gerador em carga parcial (0,3-0,4
 * L/kWh); geradores 6 kVA de R$5.600 a R$8.850 no varejo.
 *
 * TODOS editáveis na tela: o número que vale é o que a concessionária orça.
 */
export const ALTERNATIVAS = {
  /** R$ por METRO de rede rural monofásica. Metro, não km: o sítio típico está
   *  a 300-800 m do último poste e km com decimal é onde nasce erro de vírgula. */
  REDE_POR_METRO: 120,
  REDE_POR_METRO_FAIXA: [118, 367] as const,
  /** Transformador + padrão de entrada, quando o ramal exige. */
  REDE_TRANSFORMADOR: 14000,
  /** Taxa mínima (custo de disponibilidade) que a conta cobra mesmo sem consumo. */
  REDE_TAXA_MINIMA_MES: 90,
  /** Inflação da tarifa de energia ao ano. */
  INFLACAO_TARIFA: 0.06,

  DIESEL_EQUIPAMENTO: 7500,
  DIESEL_LITRO: 6.8,
  /** Litros por kWh gerado em carga parcial — que é como um gerador de sítio
   *  trabalha. Em carga ótima (70-80%) daria 0,25; ninguém opera assim. */
  DIESEL_L_POR_KWH: 0.35,
  DIESEL_MANUTENCAO_ANO: 1200,
  /** Anos até trocar o grupo gerador rodando todo dia. */
  DIESEL_VIDA_ANOS: 6,

  /** Limpeza de módulo e revisão do sistema isolado, por ano. */
  OFFGRID_MANUTENCAO_ANO: 300,
  /**
   * R$/kWh de VAREJO pra repor o banco daqui a 10 anos. É preço de mercado, de
   * propósito: usar o nosso custo de fornecimento aqui faria a margem vazar
   * pro PDF do cliente por dedução. Lítio cai de preço ano a ano, então isto é
   * o teto — a troca real tende a sair mais barata.
   */
  REPOSICAO_BANCO_KWH: 1400,

  /** Horizonte da comparação. */
  HORIZONTE_ANOS: 10,
} as const;

/**
 * Tensão do banco. Depende do TAMANHO do banco e da POTÊNCIA que o inversor
 * precisa entregar — corrente alta em 12V vira cabo de motor de caminhão e
 * perda em calor. Um sistema de cerca elétrica não precisa de 48V; uma casa com
 * bomba e split não roda em 24V.
 */
export function tensaoBanco(kwhBanco: number, wInversor: number): 12 | 24 | 48 {
  if (kwhBanco <= 1.6 && wInversor <= 1200) return 12;
  if (kwhBanco <= 8 && wInversor <= 2600) return 24;
  return 48;
}

/** Cargas resistivas de aquecimento. Off-grid não roda chuveiro elétrico: 5.500 W
 *  por 15 minutos são 1,4 kWh — um terço de uma bateria inteira, por banho. É
 *  bloqueio, não aviso: quem vende isso entrega uma obra que falha na primeira
 *  semana e a proposta com a marca do integrador é a prova do erro. */
export const CARGAS_BLOQUEADAS = [
  { nome: 'Chuveiro elétrico', w: 5500, saida: 'Aquecedor solar (boiler) ou chuveiro a gás' },
  { nome: 'Torneira elétrica', w: 3500, saida: 'Aquecedor de passagem a gás' },
  { nome: 'Boiler / aquecedor elétrico de água', w: 3000, saida: 'Aquecedor solar térmico ou a gás' },
  { nome: 'Forno elétrico', w: 2500, saida: 'Forno a gás' },
  { nome: 'Fogão de indução de 4 bocas', w: 7000, saida: 'Fogão a gás (o cooktop de 1 boca cabe)' },
  { nome: 'Aquecedor de ambiente', w: 2000, saida: 'Aquecedor a gás ou lenha' },
  { nome: 'Secadora de roupa', w: 3000, saida: 'Varal — ou rodar só com sol a pino' },
  { nome: 'Sauna elétrica', w: 6000, saida: 'Sauna a gás ou a lenha' },
  { nome: 'Aquecimento de piscina elétrico', w: 4500, saida: 'Trocador a gás ou aquecimento solar' },
] as const;
