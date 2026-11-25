// Resposta de GET /admin/dominaia/quiz-funil (contrato de 19/11/2026).
// Mesmo formato do serviço da api: mudou lá, muda aqui.

export type Linha = {
  chave: string;
  rotulo: string;
  sessoes: number;
  leads: number;
  ofertas: number;
  checkouts: number;
  compras: number;
  conversao: number;
  receitaCentavos: number;
};

export type EtapaDominaia = {
  n: number;
  chave: string;
  rotulo: string;
  tipo: string;
  chegaram: number;
  pctInicio: number;
  sairam: number;
  pctSaida: number;
  medianaSegundos: number | null;
  pularam?: number;
  /** Etapa que entra ou sai do quiz (ISO UTC) e quantas sessões do período ela se aplica. Zero: o degrau não aparece. */
  desde?: string;
  ate?: string;
  aplicaveis?: number;
};

export type FunilDominaia = {
  periodo: string;
  desde: string;
  ate: string;
  atualizadoEm: string;
  inicioRastreio: string | null;   // primeiro evento gravado, em qualquer período
  truncado: boolean;
  filtros: {
    paises: { codigo: string; nome: string; sessoes: number }[];
    aparelhos: { chave: string; sessoes: number }[];
    anuncios: { id: string; nome: string; conjunto: string; sessoes: number }[];
  };
  totais: {
    sessoes: number; leads: number; ofertas: number; checkouts: number; compras: number;
    comprasBasico: number; comprasPlus: number; upgrades: number; receitaCentavos: number;
    conversao: number; ticketMedioCentavos: number;
    /** Sessões que foram direto à oferta (atalho da tela 1, ou volta de quem já passou pelo quiz). Ausente em api antiga. */
    atalho?: number; voltas?: number;
  };
  etapas: EtapaDominaia[];
  recortes: {
    pais: Linha[]; aparelho: Linha[]; sistema: Linha[]; navegador: Linha[];
    anuncio: Linha[]; conjunto: Linha[]; dia: Linha[]; hora: Linha[];
  };
  respostas: {
    chave: string;
    pergunta: string;
    opcoes: { valor: string; rotulo: string; sessoes: number; pct: number; chegaramOferta: number; compras: number; conversao: number }[];
  }[];
  app: { abriram: number; instalaram: number; upgradeClicks: number };
};
