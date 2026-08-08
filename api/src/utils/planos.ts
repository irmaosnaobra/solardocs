// Preço e limite de cada plano, num lugar só.
//
// A autoridade do lado da Stripe continua sendo o PLAN_MAP do paymentsController
// (é lá que vive o price_id). Este arquivo existe pros lugares que precisam do
// PREÇO sem arrastar junto o controller inteiro — importar o paymentsController
// de um serviço de WhatsApp fecharia um ciclo (ele já importa o agente pra
// mandar a boas-vindas). Se o preço mudar, muda nos dois.

export interface PlanoInfo {
  plano: string;
  nome: string;
  valor: number;   // R$/mês
  limite: number;  // documentos por mês
}

export const PLANOS: Record<string, PlanoInfo> = {
  pro:       { plano: 'pro',       nome: 'PRO', valor: 27, limite: 90 },
  ilimitado: { plano: 'ilimitado', nome: 'VIP', valor: 67, limite: 999999 },
};

// O plano que a LP vende hoje (oferta única desde 06/08/2026).
export const PLANO_PUBLICO = PLANOS.ilimitado;
