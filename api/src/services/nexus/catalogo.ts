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
