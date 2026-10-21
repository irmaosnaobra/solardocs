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

// ── Serviços NEXUS (v5, 22/10/2026) ──────────────────────────────────────────
// Catálogo com PREÇO, em três grupos: plataforma, engenharia e suporte. Os preços moram na constante PRECOS abaixo (uma
// linha para trocar). O `libera` e o `bloqueio` de cada item saem do nível do parceiro (função servicosParaFront).

export const PRECOS = Object.freeze({
  engenharia1: 3000,
  engenharia3: 7500,
  engenharia5: 10000,
  manutencaoMes: 200, // por carregador; é o mesmo valor da premissa de manutenção do Simulador
  apoioVenda: 500, // por atendimento; a primeira reunião de cada parceiro é por conta da NEXUS
});

/** Pacotes de engenharia que o parceiro pode pedir. O 10 saiu da venda (linha antiga no banco continua valendo no saldo). */
export const PACOTES_ENGENHARIA = Object.freeze([1, 3, 5] as const);
export type PacoteEngenharia = (typeof PACOTES_ENGENHARIA)[number];

/** Quantidade de carregadores aceita no pedido do plano de manutenção. */
export const MANUTENCAO_MIN = 1;
export const MANUTENCAO_MAX = 50;

/** Versão do Termo de Parceria que a API aceita no POST /termo/aceitar. O texto mora em dashboard/public/nexus/app/dados/. */
export const TERMO_VERSAO = 'v1';

export type GrupoServico = 'plataforma' | 'engenharia' | 'suporte';
export type IdServico = 'plataforma' | 'eng-1' | 'eng-3' | 'eng-5' | 'suporte_incluido' | 'manutencao' | 'apoio_venda';
/** Tipo de pedido que o botão do serviço manda no POST /nexus/pedidos. */
export type TipoPedidoServico = 'engenharia' | 'manutencao' | 'consultoria';

/** Subconjunto de `libera` (niveis.ts) que o catálogo consulta. */
export interface LiberaServicos {
  basico: boolean;
  pacotes_engenharia: boolean;
  consultoria: boolean;
  plataforma: boolean;
  manutencao: boolean;
}

export interface ServicoNexus {
  id: IdServico;
  grupo: GrupoServico;
  nome: string;
  /** Preço em texto, como a tela mostra. */
  preco_texto: string;
  /** Valor em reais; null quando não é um valor fixo em reais (plataforma é percentual, suporte incluído não se compra). */
  preco_valor: number | null;
  /** Como se cobra (ou o que o preço cobre). */
  unidade: string;
  /** O parceiro já pode contratar? */
  libera: boolean;
  /** Texto de quando libera; null quando já libera. */
  bloqueio: string | null;
  /** 'pedido' = POST /pedidos (ver pedido_tipo); 'solicitacao' = POST /solicitacoes; null = não se compra. */
  acao: 'pedido' | 'solicitacao' | null;
  /** Extras para a tela montar o botão e o desconto sem refazer conta. */
  pedido_tipo: TipoPedidoServico | null;
  pacote: PacoteEngenharia | null;
  preco_por_projeto: number | null;
  economia: number | null;
}

interface ServicoBase {
  id: IdServico;
  grupo: GrupoServico;
  nome: string;
  preco_texto: string;
  preco_valor: number | null;
  unidade: string;
  /** Chave de `libera` que destrava o item; null = sempre liberado. */
  chave: keyof LiberaServicos | null;
  /** Texto do cadeado. */
  motivo: string | null;
  acao: 'pedido' | 'solicitacao' | null;
  pedido_tipo: TipoPedidoServico | null;
  pacote: PacoteEngenharia | null;
}

/** "R$ 7.500" sem depender do ICU do Node. */
export function reais(v: number): string {
  return 'R$ ' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const TEXTO_COMPRA = 'Libera com a sua primeira compra de carregador NEXUS.';
const TEXTO_PARTNER = 'Libera no nível Partner.';

const valorDoPacote = (n: PacoteEngenharia): number => (n === 1 ? PRECOS.engenharia1 : n === 3 ? PRECOS.engenharia3 : PRECOS.engenharia5);

const pacoteBase = (n: PacoteEngenharia): ServicoBase => ({
  id: `eng-${n}` as IdServico,
  grupo: 'engenharia',
  nome: n === 1 ? 'Engenharia NEXUS · 1 projeto' : `Engenharia NEXUS · pacote de ${n} projetos`,
  preco_texto: reais(valorDoPacote(n)),
  preco_valor: valorDoPacote(n),
  unidade: n === 1 ? 'por projeto' : `${n} projetos, ${reais(valorDoPacote(n) / n)} cada`,
  chave: n === 1 ? 'basico' : 'pacotes_engenharia',
  motivo: n === 1 ? 'O projeto avulso libera quando o seu perfil estiver completo.' : 'Os pacotes com desconto liberam no nível Partner.',
  acao: 'pedido',
  pedido_tipo: 'engenharia',
  pacote: n,
});

export const SERVICOS: readonly ServicoBase[] = Object.freeze([
  {
    id: 'plataforma', grupo: 'plataforma', nome: 'Plataforma NEXUS',
    preco_texto: '10% do que o ponto fatura em recarga', preco_valor: null, unidade: 'Sem mensalidade e sem taxa de adesão',
    chave: 'plataforma', motivo: TEXTO_COMPRA, acao: 'solicitacao', pedido_tipo: null, pacote: null,
  },
  ...PACOTES_ENGENHARIA.map(pacoteBase),
  {
    id: 'suporte_incluido', grupo: 'suporte', nome: 'Suporte incluído no carregador',
    preco_texto: 'Sem custo', preco_valor: null, unidade: 'Já vem em todo carregador NEXUS',
    chave: null, motivo: null, acao: null, pedido_tipo: null, pacote: null,
  },
  {
    id: 'manutencao', grupo: 'suporte', nome: 'Plano de manutenção NEXUS',
    preco_texto: reais(PRECOS.manutencaoMes), preco_valor: PRECOS.manutencaoMes, unidade: 'por mês por carregador',
    chave: 'manutencao', motivo: TEXTO_COMPRA, acao: 'pedido', pedido_tipo: 'manutencao', pacote: null,
  },
  {
    id: 'apoio_venda', grupo: 'suporte', nome: 'Apoio de venda',
    preco_texto: reais(PRECOS.apoioVenda), preco_valor: PRECOS.apoioVenda, unidade: 'por atendimento',
    chave: 'consultoria', motivo: TEXTO_PARTNER, acao: 'pedido', pedido_tipo: 'consultoria', pacote: null,
  },
] as ServicoBase[]);

/** O projeto avulso (pacote 1) libera com o perfil completo; os pacotes de 3 e 5 no Partner. Mesma regra do catálogo e do POST /pedidos. */
export function liberaEngenharia(pacote: number, libera: Pick<LiberaServicos, 'basico' | 'pacotes_engenharia'>): boolean {
  return pacote === 1 ? libera.basico : libera.pacotes_engenharia;
}

/** Os serviços no /eu, já com `libera` e `bloqueio` do parceiro. */
export function servicosParaFront(libera: LiberaServicos): ServicoNexus[] {
  return SERVICOS.map((s) => {
    const livre = s.chave === null ? true : libera[s.chave] === true;
    const unitario = s.pacote ? (s.preco_valor as number) / s.pacote : null;
    return {
      id: s.id, grupo: s.grupo, nome: s.nome, preco_texto: s.preco_texto, preco_valor: s.preco_valor, unidade: s.unidade,
      libera: livre,
      bloqueio: livre ? null : s.motivo,
      acao: s.acao, pedido_tipo: s.pedido_tipo, pacote: s.pacote,
      preco_por_projeto: unitario,
      economia: s.pacote && s.pacote > 1 ? PRECOS.engenharia1 * s.pacote - (s.preco_valor as number) : null,
    };
  });
}
