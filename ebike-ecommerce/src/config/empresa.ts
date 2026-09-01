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
} as const;

/**
 * As garantias que a loja pode prometer HOJE, e nada além.
 *
 * O fabricante não publica prazo de garantia em lugar nenhum: nem na ficha do
 * fornecedor, nem no manual que ele linka. Então a loja cita a garantia LEGAL,
 * que existe por lei e não depende de ninguém confirmar, e para por aí.
 *
 * Falta perguntar à Soollar qual é a garantia de fábrica (o normal no setor é
 * 6 a 12 meses em motor e quadro, 3 a 6 na bateria). Quando ela vier, entra
 * aqui e esta seção deixa de ser defensiva.
 */
export const DIREITOS = [
  {
    titulo: 'Nota fiscal em toda venda',
    texto: `Vendido e faturado por ${'AIOROS LTDA'}, CNPJ ${'63.636.043/0001-88'}. Você recebe a nota junto com a bike.`,
  },
  {
    titulo: '7 dias para desistir',
    texto:
      'Comprou pela internet e se arrependeu? Devolve em até 7 dias do recebimento e recebe tudo de volta, inclusive o frete. É o direito de arrependimento do Código de Defesa do Consumidor (art. 49).',
  },
  {
    titulo: 'Garantia legal de 90 dias',
    texto:
      'Defeito de fabricação em produto durável tem 90 dias de garantia por lei (CDC, art. 26). A gente resolve com o fabricante; você fala com a gente.',
  },
  {
    titulo: 'Preço e frete fechados antes de você decidir',
    texto:
      'O valor da bike e o do frete até o seu CEP aparecem na tela, com a conta aberta. Nada de "consulte o valor" depois que você já escolheu.',
  },
] as const;
