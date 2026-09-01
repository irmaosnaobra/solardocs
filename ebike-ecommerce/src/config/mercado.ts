/**
 * O preço que o mercado pratica, por modelo.
 *
 * REGRA DE OURO: só entra aqui número que foi CARREGADO de uma página de loja,
 * com a ficha técnica conferida contra a nossa. Resumo de busca não vale,
 * estimativa não vale, "acho que custa" não vale. O valor deste arquivo é ser
 * um punhado de fatos, não uma tabela de palpites — no dia em que alguém puser
 * um chute aqui, ele deixa de servir para decidir preço.
 *
 * Cada linha diz de onde veio. Quem for atualizar, atualize a fonte junto.
 *
 * Conferido em 01/09/2026.
 */

export type Ancora = {
  /** Preço à vista na loja concorrente, em reais. */
  preco: number;
  /** Que produto foi comparado, e onde. */
  fonte: string;
  /** Como a ficha dele se compara com a nossa. */
  ficha: string;
};

/**
 * Por CÓDIGO do fornecedor. Código é o que não muda quando ele renomeia o
 * produto — e ele renomeia.
 */
export const MERCADO: Record<string, Ancora> = {
  // --- Bicicleta 500W chumbo-ácido -----------------------------------------
  // A nossa: Chumbo Ácido 48V 12Ah, 25/30 km, 32 km/h.
  '695723': {
    preco: 4249.9,
    fonte: 'Bikelete Smart 500W 48V',
    ficha: 'chumbo-ácido 48V 12Ah, 25 km, 32 km/h — ficha idêntica',
  },
  '695730': {
    preco: 4249.9,
    fonte: 'Bikelete Smart 500W 48V',
    ficha: 'chumbo-ácido 48V 12Ah, 25 km, 32 km/h — ficha idêntica',
  },
};

/**
 * Âncora por FAIXA, para os modelos que não têm concorrente exato mas dividem
 * a mesma ficha. A chave é a bateria normalizada + a potência.
 */
export const MERCADO_POR_FICHA: Array<{ quando: RegExp; ancora: Ancora }> = [
  {
    // Bicicletas 750W lítio 48V 18,2Ah, 50 km. A concorrente tem 15Ah — a
    // nossa leva bateria MAIOR pelo mesmo dinheiro.
    quando: /750\s*W/i,
    ancora: {
      preco: 6990,
      fonte: 'Zurbe V8S 750W 48V 15Ah',
      ficha: 'lítio 48V 15Ah, 50 km — a nossa tem 18,2Ah',
    },
  },
  {
    // Scooters com bateria de grafeno. A concorrente tem 20Ah e 50 km; as
    // nossas têm 26Ah e 70 a 95 km.
    quando: /grafeno/i,
    ancora: {
      preco: 8990,
      fonte: 'Zurbe Scooter Ibiza 1000W',
      ficha: 'grafeno 60V 20Ah, 50 km, 32 km/h — a nossa tem 26Ah e 95 km',
    },
  },
  {
    // Scooters 1000W de lítio 60V. A concorrente faz 45 km; as nossas, 60 a 80.
    quando: /l[ií]tio\s*60\s*V/i,
    ancora: {
      preco: 12150,
      fonte: 'Neon Mobilidade JET 1000W',
      ficha: 'lítio 60V 20Ah, 45 km, 32 km/h — a nossa faz 60 a 80 km',
    },
  },
];
