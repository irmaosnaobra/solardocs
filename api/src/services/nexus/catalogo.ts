// Catálogo e marca da NEXUS Eletropostos, fonte única do Portal do Parceiro. O front estático lê tudo daqui pela API.
//
// v2 (21/10/2026): preço de tabela do portal = teto para o cliente final (DC 80 R$ 69.990, DC 120 R$ 89.990).
// NÃO existe preço de parceiro: o portal mostra "Negociado com o comercial" e abre uma solicitação. As envs
// NEXUS_PRECO_REVENDA_* e o card de margem saíram.
// Spec técnica não inventada: o que não tem dado é null, e o documento escreve "Consulte ficha técnica".

export interface Specs {
  conectores: string | null;
  atendimento: string | null;
  comunicacao: string | null;
  refrigeracao: string | null;
  tela: string | null;
  monitoramento: string | null;
  corrente: string | null;
  tensaoEntrada: string | null;
  eficiencia: string | null;
  protecao: string | null;
  certificacao: string | null;
  garantia: string | null;
  dimensoes: string | null;
}

export interface ProdutoCatalogo {
  id: string;
  nome: string;
  potenciaKw: number;
  precoSugerido: number;
  specs: Specs;
}

// O que a NEXUS já publica em /nexus (dashboard/public/nexus/index.html). O que não está publicado fica null, e a
// tela e os documentos escrevem "Consulte ficha técnica": tensão de entrada, eficiência, proteção, certificação,
// garantia e dimensões.
const SPECS_PUBLICADAS = {
  conectores: 'CCS2, 2 plugues',
  comunicacao: 'OCPP 1.6J',
  refrigeracao: 'Ativa',
  tela: 'Sensível ao toque',
  monitoramento: 'Telemetria de cada tomada em tempo real',
  corrente: 'Contínua (DC)',
  tensaoEntrada: null,
  eficiencia: null,
  protecao: null,
  certificacao: null,
  garantia: null,
  dimensoes: null,
};

const SPECS_DC80: Specs = Object.freeze({ ...SPECS_PUBLICADAS, atendimento: 'Dois carros ao mesmo tempo' });
const SPECS_DC120: Specs = Object.freeze({ ...SPECS_PUBLICADAS, atendimento: 'Divide a potência entre as vagas' });

export const marca = Object.freeze({
  nome: 'NEXUS Eletropostos',
  slogan: 'Energia que move o amanhã',
  fonte: 'Montserrat',
  cores: Object.freeze({
    verde: '#39FF14',
    azul: '#0085FF',
    azulTexto: '#0060C7',
    fundo: '#0B1A2B',
    cinza: '#E5E7EB',
  }),
  pilares: Object.freeze([
    'Recarga rápida e segura',
    'Energia limpa e sustentável',
    'Tecnologia de ponta',
    'Mobilidade para todos',
  ]),
  logos: Object.freeze({
    papel: '/gerador/nexus-logo-papel.png',
    tela: '/gerador/nexus-logo-tela.png',
    simbolo: '/gerador/nexus-x.png',
  }),
  imagens: '/nexus/img/',
  // Linha pequena do rodapé dos documentos. Uma constante para trocar em uma linha.
  distribuidor: 'Equipamento NEXUS Eletropostos · AIOROS GROUP LTDA · CNPJ 63.636.043/0001-88',
});

/** Número público do comercial (linha 5040), o mesmo que a /nexus/partner já mostra. */
export const WHATSAPP_COMERCIAL = '5534998165040';

export const PRODUTOS: readonly ProdutoCatalogo[] = Object.freeze([
  Object.freeze({ id: 'nexus-dc-80', nome: 'NEXUS DC 80 kW', potenciaKw: 80, precoSugerido: 69990, specs: SPECS_DC80 }),
  Object.freeze({ id: 'nexus-dc-120', nome: 'NEXUS DC 120 kW', potenciaKw: 120, precoSugerido: 89990, specs: SPECS_DC120 }),
]);

/** Texto de entrega mostrado no portal e nos documentos (editável na tela de proposta). */
export const ENTREGA = 'Entrega na primeira quinzena de dezembro';

/** Financiamento de referência: Price, 96x com 120 dias de carência, taxa de referência editável. Sujeito à análise de crédito. */
export const FINANCIAMENTO = Object.freeze({ parcelas: 96, carenciaDias: 120, taxaRefMensal: 1.49 });

export function catalogoParaFront(): { marca: typeof marca; produtos: ProdutoCatalogo[] } {
  return {
    marca,
    produtos: PRODUTOS.map((p) => ({ ...p, specs: { ...p.specs } })),
  };
}

// ── Serviços NEXUS (v3, 21/10/2026) ──────────────────────────────────────────
// Produtos que o parceiro revende com margem. NENHUM preço numérico de serviço no código: o preço de parceiro é
// sempre "Negociado com o comercial".

export const PRECO_NEGOCIADO = 'Negociado com o comercial';
export const PACOTES_ENGENHARIA = Object.freeze([3, 5, 10] as const);
export type PacoteEngenharia = (typeof PACOTES_ENGENHARIA)[number];

/** Versão do Termo de Parceria que a API aceita no POST /termo/aceitar. O texto mora em dashboard/public/nexus/app/dados/. */
export const TERMO_VERSAO = 'v1';

/** Escopo de 1 projeto de engenharia; o pacote de N projetos repete este escopo N vezes. */
export const ESCOPO_PROJETO_ENGENHARIA: readonly string[] = Object.freeze([
  'Projeto elétrico do eletroposto',
  'ART do projeto',
  'Pedido de acesso e acompanhamento da homologação na distribuidora',
  'Estudo da entrada de energia',
]);

export interface ServicoNexus {
  id: 'eng-3' | 'eng-5' | 'eng-10' | 'consultoria' | 'plataforma';
  grupo: 'engenharia' | 'consultoria' | 'plataforma';
  nome: string;
  /** O que o parceiro recebe. Na engenharia é o escopo de CADA projeto do pacote. */
  escopo: readonly string[];
  /** Quantos projetos o pacote tem (só engenharia). */
  pacote: PacoteEngenharia | null;
  /** Como se cobra: 'por pacote' ou 'por atendimento'. */
  unidade: string | null;
  /** Preço de parceiro. Sempre texto, nunca número. */
  preco: string;
  /** Nível mínimo e a chave de `libera` que destrava o botão de pedido. */
  libera: 'partner' | 'pro';
  chave_libera: 'pacotes_engenharia' | 'consultoria' | 'plataforma';
  /** Só a plataforma: o que ela é e a parte do parceiro. */
  descricao: string | null;
  para_o_parceiro: string | null;
  sua_parte: string | null;
}

const engenharia = (n: PacoteEngenharia): ServicoNexus => ({
  id: `eng-${n}` as ServicoNexus['id'],
  grupo: 'engenharia',
  nome: `Pacote de engenharia · ${n} projetos`,
  escopo: ESCOPO_PROJETO_ENGENHARIA,
  pacote: n,
  unidade: 'por pacote',
  preco: PRECO_NEGOCIADO,
  libera: 'partner',
  chave_libera: 'pacotes_engenharia',
  descricao: null,
  para_o_parceiro: null,
  sua_parte: null,
});

export const SERVICOS: readonly ServicoNexus[] = Object.freeze([
  ...PACOTES_ENGENHARIA.map(engenharia),
  {
    id: 'consultoria',
    grupo: 'consultoria',
    nome: 'Consultoria de vendas NEXUS',
    escopo: [
      'Especialista NEXUS na reunião com o seu cliente (online)',
      'Revisão da proposta antes de enviar',
      'Análise do ponto: entrada de energia, fluxo e potência indicada',
    ],
    pacote: null,
    unidade: 'por atendimento',
    preco: PRECO_NEGOCIADO,
    libera: 'partner',
    chave_libera: 'consultoria',
    descricao: null,
    para_o_parceiro: null,
    sua_parte: null,
  },
  {
    id: 'plataforma',
    grupo: 'plataforma',
    nome: 'Plataforma NEXUS de gestão',
    escopo: [
      'Cobrança de cada recarga',
      'Monitoramento do carregador',
      'Relatórios de uso e de receita',
      'App do motorista',
    ],
    pacote: null,
    unidade: null,
    preco: PRECO_NEGOCIADO,
    libera: 'pro',
    chave_libera: 'plataforma',
    descricao: 'Cobrança de cada recarga, monitoramento, relatórios e app do motorista. O ponto paga 10% do que fatura em recarga.',
    para_o_parceiro: 'Você revende a plataforma e recebe parte dos 10% todo mês, enquanto o ponto operar.',
    sua_parte: 'Negociada com o comercial',
  },
] as ServicoNexus[]);

export function servicosParaFront(): ServicoNexus[] {
  return SERVICOS.map((s) => ({ ...s, escopo: [...s.escopo] }));
}
