// Resposta de GET /admin/monjour/quiz-funil (contrato de 19/11/2026).
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

export type EtapaMonjour = {
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

export type FunilMonjour = {
  periodo: string;
  desde: string;
  ate: string;
  atualizadoEm: string;
  inicioRastreio: string | null;   // primeiro evento monjour gravado, em qualquer período
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
    /** Sessões que foram direto à oferta (atalho da tela 1, ou volta de quem já fez o test). Ausente em api antiga. */
    atalho?: number; voltas?: number;
  };
  etapas: EtapaMonjour[];
  saidas: { finSeguridad: number; partidaSemSaida: number };
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
  /**
   * Página de venda direta (/plan/), separada do funil do quiz: as sessões dela
   * não entram em `totais` nem em `etapas`. Opcional: a api e o dashboard sobem
   * em deploys separados, então o painel não pode depender do campo.
   * visitas: abriram a página; planes: viram os planos; compra: abriram a folha
   * de compra; checkouts: clicaram em pagar (foram para a Stripe); compras: compraram.
   * secoes: cada seção da página, na ordem em que ela aparece, com as sessões que a viram (rolagem).
   * cliques: os elementos clicados, já ordenados por sessões; total conta todos os cliques.
   * secoes e cliques são opcionais: a api manda os dois em deploy à parte.
   */
  paginaVenta?: {
    visitas: number; planes: number; compra: number; checkouts: number; compras: number;
    secoes?: { codigo: string; nome: string; sessoes: number }[];
    cliques?: { codigo: string; nome: string; sessoes: number; total: number }[];
  };
};
