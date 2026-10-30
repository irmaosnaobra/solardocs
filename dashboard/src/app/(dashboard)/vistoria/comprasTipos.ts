// Lista de compras da vistoria: tipos e constantes puras da tela do técnico.
//
// ESPELHO EXATO de api/src/services/vistoria/compras.ts: mesmas unidades, mesmos valores de "quem providencia",
// mesmas 12 chaves de item e mesmos limites. Mudou lá, muda aqui. O teste vistoriaComprasDashboard (na api/)
// lê este arquivo por texto e compara as duas pontas.
//
// SEM imports. Este arquivo, comprasTextos.ts, catalogoCompras.ts e comprasPuro.ts só podem importar uns dos
// outros por caminho relativo (./arquivo), porque o teste os carrega fora do Next.

export const UNIDADES = ['un', 'm', 'pc', 'cj', 'barra', 'servico'] as const;
export type Unidade = typeof UNIDADES[number];

export const QUEM = ['integrador', 'cliente', 'a_definir'] as const;
export type Quem = typeof QUEM[number];

/** As 12 chaves do checklist da vistoria (as mesmas de CHECKLIST_VISTORIA, na mesma ordem). */
export const CHAVES_ITENS = [
  'conta_luz', 'documento_pessoal', 'padrao', 'medidor', 'disjuntor_padrao', 'quadro_distribuicao',
  'inversores', 'telhado', 'tipo_telha', 'estrutura', 'cabeamento', 'sombreamento',
] as const;

export const LIMITES = { linhas: 60, nome: 80, esp: 140, obsLinha: 200, obsNota: 500, qtdMax: 99999, json: 48000 } as const;

export interface LinhaCompra {
  id: string;
  tipo: 'material' | 'obs';
  nome?: string;
  esp?: string;
  qtd?: number | null;
  un?: Unidade;
  quem?: Quem;
  item?: string;
  cid?: string;
  obs: string;
  ts?: string;
}

/** O que a tela mostra e o que vai no PUT: o interruptor "mostrar no relatório" e as linhas na ordem do técnico. */
export interface ComprasEstado {
  publica: boolean;
  linhas: LinhaCompra[];
}

export type StatusKey = 'conforme' | 'atencao' | 'nao_conforme' | 'na';
export type MapaStatus = Partial<Record<string, StatusKey>>;

/** Prazo derivado do status do item ligado: não conforme é alta, atenção é média, o resto não tem prazo. */
export type Prazo = 'alta' | 'media' | null;

// ---------------------------------------------------------------------------------------------------------
// Catálogo e sugestões
// ---------------------------------------------------------------------------------------------------------

/** A = atenção, N = não conforme. `peso` 1 aparece antes de 2, que aparece antes de 3. */
export type Gatilho = { item: string; quando: 'A' | 'N' | 'AN'; peso: 1 | 2 | 3 };

export interface EntradaCatalogo {
  cid: string;
  nome: string;
  cat: string;
  un: Unidade;
  quem: Quem;
  esp: string;
  gatilhos?: Gatilho[];
  sempre?: true;
  alternativa?: 'telha' | 'laje';
  aviso?: 'amianto';
}

export interface EntradaSugerida {
  entrada: EntradaCatalogo;
  peso: 1 | 2 | 3;
}

export interface GrupoSugestao {
  item: string;
  status: 'atencao' | 'nao_conforme';
  entradas: EntradaSugerida[];
}

/** Resultado de textoFornecedor e textoCliente. `fora` e `avisos` são frases prontas para a folha. */
export interface TextoGerado {
  texto: string;
  pode: boolean;
  fora: string;
  avisos: string[];
}

// ---------------------------------------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------------------------------------

/** Botões e leitor de tela. */
export const ROTULO_UNIDADE: Record<Unidade, string> = {
  un: 'Unidade',
  m: 'Metro',
  pc: 'Peça',
  cj: 'Conjunto',
  barra: 'Barra',
  servico: 'Serviço',
};

/** Linha da lista, depois do número. Minúsculas de propósito. */
export const ABREV_UNIDADE: Record<Unidade, string> = {
  un: 'un',
  m: 'm',
  pc: 'pç',
  cj: 'cj',
  barra: 'barra',
  servico: 'serviço',
};

export const ROTULO_QUEM: Record<Quem, string> = {
  integrador: 'Integrador',
  cliente: 'Cliente',
  a_definir: 'A combinar',
};

/** Os 12 `label` do CHECKLIST_VISTORIA (api/src/routes/vistorias.ts), copiados. */
export const ROTULO_ITEM: Record<string, string> = {
  conta_luz: 'Conta de luz',
  documento_pessoal: 'CNH / Identidade',
  padrao: 'Padrão de entrada',
  medidor: 'Medidor / Relógio',
  disjuntor_padrao: 'Disjuntor do padrão',
  quadro_distribuicao: 'Quadro de distribuição',
  inversores: 'Local dos inversores / Disjuntor C.A',
  telhado: 'Telhado',
  tipo_telha: 'Tipo de telha',
  estrutura: 'Estrutura apropriada',
  cabeamento: 'Caminho do cabeamento',
  sombreamento: 'Sombreamento',
};

/** Só os dois status que pedem providência. */
export const ROTULO_STATUS: Record<'atencao' | 'nao_conforme', string> = {
  atencao: 'Atenção',
  nao_conforme: 'Não conforme',
};
