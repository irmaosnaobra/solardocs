/**
 * Quem vende. Isto não é enfeite de rodapé: é obrigação.
 *
 * O Decreto 7.962/2013 (art. 2º) manda todo site de venda mostrar, em local de
 * destaque, o NOME EMPRESARIAL, o CNPJ e o endereço físico e eletrônico do
 * fornecedor. A loja ficou no ar sem nada disso.
 *
 * E tem o lado comercial, que é ainda mais direto: quem vai gastar oito mil
 * reais numa marca criada ontem procura o CNPJ. Se achar uma empresa cujo ramo
 * declarado é energia elétrica e nenhuma explicação, desiste — a consulta que
 * era para tranquilizar vira suspeita. Por isso o texto AMARRA as duas coisas:
 * Corrente é a marca, AIOROS LTDA é a empresa. Uma frase, e a consulta passa a
 * confirmar em vez de assustar.
 *
 * Dados conferidos na base pública da Receita em 31/08/2026 (CNPJ ativo desde
 * 12/11/2025). O CNAE 4789-0/99 — comércio varejista de outros produtos —
 * cobre a venda de bicicleta e scooter, então a nota fiscal sai.
 *
 * De propósito NÃO entra aqui o capital social: R$ 30.000 ao lado de um
 * triciclo de R$ 14.000 argumenta contra a loja, não a favor.
 */
export const EMPRESA = {
  razaoSocial: 'AIOROS LTDA',
  cnpj: '63.636.043/0001-88',
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
    texto: `Vendido e faturado por ${EMPRESA.razaoSocial}, CNPJ ${EMPRESA.cnpj}. Você recebe a nota junto com a bike.`,
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
