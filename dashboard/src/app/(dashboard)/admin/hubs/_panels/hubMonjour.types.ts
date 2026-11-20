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
};
