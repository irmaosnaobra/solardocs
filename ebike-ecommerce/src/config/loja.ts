/**
 * Configuração pública da loja. Tudo aqui pode aparecer no navegador:
 * NADA de custo, margem ou credencial neste arquivo.
 */

/**
 * O nome nasceu do próprio produto: corrente é a peça que move a bicicleta e é
 * a corrente elétrica que move o motor. As duas coisas são literalmente
 * verdade sobre o que se vende aqui, e é isso que faz o nome grudar em vez de
 * só soar bonito.
 */
export const LOJA = {
  nome: 'Corrente Mobilidade Elétrica',
  nomeCurto: 'Corrente',
  /** Descritor do logotipo: o que a marca vende, embaixo do nome. */
  descritor: 'Bikes elétricas',
  slogan: 'Sem gasolina. Sem desculpa.',
  chamada: 'Bicicletas e scooters elétricas, entregues em todo o Brasil',
  descricao:
    'Catálogo completo de bicicletas e scooters elétricas. Você escolhe o modelo, calcula o frete pelo seu CEP e fala direto com quem vende.',
} as const;

/**
 * Quem atende. É uma LISTA de propósito: quando entrar um terceiro vendedor,
 * basta acrescentar aqui. Nenhum código depende de existirem exatamente dois.
 */
export type Consultor = { nome: string; whatsapp: string; apelido: string };

export const CONSULTORES: Consultor[] = [
  { nome: 'Thiago', apelido: 'thiago', whatsapp: '5534991360223' },
  { nome: 'Diego', apelido: 'diego', whatsapp: '5534991360172' },
];

/** Como a pessoa quer pagar. Vai junto na mensagem do WhatsApp. */
export type FormaDePagamento = { id: string; rotulo: string; detalhe: string };

export const FORMAS_DE_PAGAMENTO: FormaDePagamento[] = [
  { id: 'avista', rotulo: 'À vista', detalhe: 'Pagamento em uma vez' },
  { id: 'cartao', rotulo: 'Cartão de crédito', detalhe: 'Parcelado no cartão' },
];

export function consultorPorApelido(apelido: string | null | undefined): Consultor | null {
  if (!apelido) return null;
  return CONSULTORES.find((c) => c.apelido === apelido.toLowerCase()) ?? null;
}

/**
 * Até quantas vezes no cartão. Número do Thiago (31/08).
 *
 * A loja NÃO estampa o valor da parcela, só a quantidade. O valor depende de
 * juros que ele nunca confirmou, e "18x de R$ 388,89" numa página pública é uma
 * promessa que quem atende teria de desdizer na conversa. A escolha viaja no
 * WhatsApp e o vendedor fecha a condição.
 */
export const PARCELAS_MAXIMAS = 18;

export function formaPorId(id: string | null | undefined): FormaDePagamento | null {
  if (!id) return null;
  return FORMAS_DE_PAGAMENTO.find((f) => f.id === id) ?? null;
}

/** Monta o link do WhatsApp já com modelo, código, preço e forma de pagamento. */
export function linkWhatsApp(opcoes: {
  consultor: Consultor;
  titulo: string;
  codigo: string;
  preco: number;
  pagamento?: FormaDePagamento | null;
  parcelas?: number | null;
  entrega?: string | null;
  frete?: string | null;
  saiDe?: string | null;
  url?: string;
}): string {
  const preco = opcoes.preco.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const linhas = [
    `Olá, ${opcoes.consultor.nome}! Vi no site da ${LOJA.nomeCurto} e quero esta:`,
    '',
    `Modelo: ${opcoes.titulo}`,
    `Código: ${opcoes.codigo}`,
    `Valor: ${preco}`,
  ];
  if (opcoes.pagamento) {
    const emVezes = opcoes.parcelas && opcoes.parcelas > 1 ? ` em ${opcoes.parcelas}x` : '';
    linhas.push(`Pagamento: ${opcoes.pagamento.rotulo}${emVezes}`);
  }
  if (opcoes.entrega) linhas.push(`Entrega em: ${opcoes.entrega}`);
  // Sem preço na tela, o consultor precisa saber DE ONDE cotar. Sem isso ele
  // devolve "vou verificar" e a conversa esfria justamente na hora da decisão.
  if (opcoes.saiDe) linhas.push(`Sai de: ${opcoes.saiDe}`);
  if (opcoes.frete) linhas.push(`Frete calculado: ${opcoes.frete}`);
  if (opcoes.url) linhas.push('', opcoes.url);
  return `https://wa.me/${opcoes.consultor.whatsapp}?text=${encodeURIComponent(linhas.join('\n'))}`;
}

export function emReais(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}
