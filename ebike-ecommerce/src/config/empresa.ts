/**
 * Quem vende.
 *
 * O Decreto 7.962/2013 (art. 2º) manda todo site de venda mostrar, em local de
 * destaque, o nome empresarial, o CNPJ e o endereço físico e eletrônico do
 * fornecedor. Nada disso aparece aqui por decisão do Thiago (03/09/2026): em
 * site e LP a gente se apresenta como IRMÃOS NA OBRA e ponto — o CNPJ e a
 * razão social só entram no contrato/nota do fechamento. É escolha comercial
 * consciente, e deixa a loja fora desse item do decreto.
 *
 * Os campos `cnpj` e `razaoSocial` foram APAGADOS deste arquivo de propósito,
 * não só das telas: sem campo, nenhuma tela nova reimprime o dado por descuido
 * e o `tsc` derruba o build de quem tentar. Não repor.
 *
 * O e-mail também saiu, pelo mesmo motivo: `aiorosgroup@gmail.com` soletra na
 * tela exatamente o nome que era para não aparecer. O canal de contato da loja
 * é o WhatsApp da central. No dia em que existir uma caixa neutra —
 * contato@irmaosnaobra.com.br hoje tem MX nulo e devolve tudo — é só recolocar.
 *
 * E o ENDEREÇO saiu em 03/09, no mesmo pedido ("todos os sites, evitar o
 * endereço também"). Sobrou a CIDADE, e de propósito: a página do frete já diz
 * de qual base a bike sai ("Sai de Uberlândia — MG"), porque quem vai pagar
 * frete precisa saber de onde ele vem. Esconder a cidade no rodapé enquanto a
 * tela do frete a anuncia não protegeria nada e deixaria a loja sem lugar
 * nenhum no mundo.
 *
 * O que sobra, então, é só a marca e a cidade.
 *
 * De propósito NÃO entra aqui o capital social: R$ 30.000 ao lado de um
 * triciclo de R$ 14.000 argumenta contra a loja, não a favor.
 */
export const EMPRESA = {
  /** Como a loja se apresenta. NÃO é a razão social — essa fica no contrato. */
  nome: 'Irmãos na Obra',
  /** Só a cidade. O endereço com rua, número e CEP não existe mais aqui. */
  cidade: 'Uberlândia — MG',
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
    texto: `Toda bike sai com nota fiscal em seu nome, emitida pela ${EMPRESA.nome}. Você recebe junto com a bike.`,
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
    texto:
      'WhatsApp direto com um dos sócios. Sem cadastro, sem formulário, sem fila de atendimento.',
  },
  {
    titulo: 'Preço e frete fechados antes de você decidir',
    texto:
      'O valor da bike e o do frete até o seu CEP aparecem na tela, com a conta aberta. Nada de "consulte o valor" depois que você já escolheu.',
  },
] as const;
