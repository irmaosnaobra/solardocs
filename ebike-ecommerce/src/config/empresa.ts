/**
 * Quem vende.
 *
 * O Decreto 7.962/2013 (art. 2º) manda todo site de venda mostrar, em local de
 * destaque, o nome empresarial, o CNPJ e o endereço físico e eletrônico do
 * fornecedor. O CNPJ foi RETIRADO do site por decisão do Thiago (03/09/2026):
 * ele só aparece no contrato/nota do fechamento, nunca na vitrine. É uma
 * escolha comercial consciente e ela deixa a loja fora desse item do decreto —
 * o campo não existe mais neste arquivo justamente para que ninguém reponha o
 * número numa tela sem querer.
 *
 * O que continua aqui é o mínimo que identifica o vendedor: razão social,
 * endereço físico e endereço eletrônico. A razão social precisa ficar porque é
 * ela que emite a nota fiscal — "vendido e faturado por" sem nome não diz nada.
 *
 * De propósito NÃO entra aqui o capital social: R$ 30.000 ao lado de um
 * triciclo de R$ 14.000 argumenta contra a loja, não a favor.
 */
export const EMPRESA = {
  razaoSocial: 'AIOROS LTDA',
  endereco: 'Rua Ana Godoy de Sousa, 890 — Santa Mônica, Uberlândia/MG, 38408-290',
  cidade: 'Uberlândia — MG',
  /** Endereço eletrônico. O Decreto 7.962/2013 exige junto com o físico. */
  email: 'aiorosgroup@gmail.com',
} as const;

/**
 * O que a loja promete, e nada além.
 *
 * A garantia é de 90 dias (informado pelo Thiago em 01/09). Vale registrar que
 * isso é EXATAMENTE a garantia legal de produto durável do CDC (art. 26, II):
 * não é vantagem sobre concorrente nenhum, é o mínimo que a lei já obriga. Por
 * isso o texto não vende os 90 dias como diferencial — diz o prazo, diz quem
 * resolve, e deixa o argumento de venda para o frete e a nota fiscal, que aí
 * sim nem todo mundo dá.
 */
export const DIREITOS = [
  {
    titulo: 'Nota fiscal em toda venda',
    texto: `Vendido e faturado por ${EMPRESA.razaoSocial}. Você recebe a nota junto com a bike.`,
  },
  {
    titulo: '7 dias para desistir',
    texto:
      'Comprou pela internet e se arrependeu? Devolve em até 7 dias do recebimento e recebe tudo de volta, inclusive o frete. É o direito de arrependimento do Código de Defesa do Consumidor (art. 49).',
  },
  {
    titulo: 'Garantia de 90 dias',
    texto:
      'Defeito de fabricação nos primeiros 90 dias, a gente resolve com o fabricante — você fala com a gente, não com o fornecedor. É o prazo do Código de Defesa do Consumidor (art. 26) para produto durável.',
  },
  {
    titulo: 'Fala com gente, não com robô',
    texto: `WhatsApp direto com um dos sócios, ou ${EMPRESA.email}. Sem cadastro, sem formulário, sem fila.`,
  },
  {
    titulo: 'Preço e frete fechados antes de você decidir',
    texto:
      'O valor da bike e o do frete até o seu CEP aparecem na tela, com a conta aberta. Nada de "consulte o valor" depois que você já escolheu.',
  },
] as const;
