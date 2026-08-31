/** Uma linha da ficha técnica, exatamente como o fabricante escreveu. */
export type ItemFicha = { rotulo: string; valor: string };

/**
 * O que a página de venda mostra. De propósito NÃO tem custo nem margem:
 * este objeto é serializado para o navegador, então tudo que estiver aqui
 * é público. Custo e margem vivem só em `BikeInterna`.
 */
export type Bike = {
  id: string;
  slug: string;
  /** Código do produto no fornecedor. */
  codigo: string;
  titulo: string;
  /** Nome do fornecedor, sem edição. */
  nomeOriginal: string;
  marca: string;
  linha: string | null;
  cor: string | null;
  categoria: string;
  potencia: string | null;
  bateria: string | null;
  autonomia: string | null;
  velocidade: string | null;
  recarga: string | null;
  ficha: ItemFicha[];
  imagens: string[];
  /** Preço de venda em reais, já com a nossa margem. */
  preco: number;
  /** Unidades no CD. `null` = o fornecedor não informou nesta sessão. */
  estoque: number | null;
  disponivel: boolean;
  /** Data de chegada quando o item ainda não está no CD (ex.: "28/08"). */
  previsao: string | null;
  /** Peso em quilos, como o fabricante publicou. Entra no cálculo do frete. */
  pesoKg: number | null;
  /** Bases do fornecedor que têm este modelo, por slug. */
  bases: string[];
};

/**
 * O recorte que a vitrine manda para o navegador. A ficha técnica inteira das
 * 27 bikes não cabe no payload de uma listagem que nem mostra ficha.
 */
export type Cartao = Pick<
  Bike,
  | 'id'
  | 'slug'
  | 'codigo'
  | 'titulo'
  | 'marca'
  | 'linha'
  | 'cor'
  | 'categoria'
  | 'potencia'
  | 'autonomia'
  | 'velocidade'
  | 'preco'
  | 'estoque'
  | 'previsao'
> & { capa: string };

/** A mesma bike com os números que só nós podemos ver. */
export type BikeInterna = Bike & {
  custo: number;
  margem: number;
  /** De onde saiu o custo. Muda a confiança do número. */
  origemDoCusto: 'preco-logado' | 'tabela-publica';
};

export type OrigemCatalogo = 'ao-vivo' | 'reserva';

export type MetaCatalogo = {
  /** ISO da hora em que os dados foram lidos do fornecedor. */
  atualizadoEm: string;
  origem: OrigemCatalogo;
  /** True quando a leitura usou a conta do fornecedor (traz estoque real). */
  logado: boolean;
  cd: string;
  secao: string;
  total: number;
  /** Preenchido quando a leitura ao vivo falhou e caímos na reserva. */
  erro?: string;
};

export type Catalogo = { bikes: Bike[]; meta: MetaCatalogo };
export type CatalogoInterno = { bikes: BikeInterna[]; meta: MetaCatalogo };
