/**
 * Como o frete é calculado.
 *
 * O cálculo já é REAL: o CEP do cliente vira coordenada, a loja escolhe entre
 * as 22 bases do fornecedor a mais perto de quem comprou (só entre as que têm
 * aquele modelo), mede a distância e sabe o peso que o fabricante publicou.
 *
 * O que falta é a TABELA abaixo. Enquanto os números forem nulos, a tela mostra
 * de onde sai, quantos quilômetros e quantos quilos, e diz que o valor é
 * combinado no atendimento. Preencher qualquer um deles liga o preço na hora.
 *
 * Nada aqui é chute meu: são os números que só quem paga a transportadora sabe.
 *
 * SOBRE COTAR NA TRANSPORTADORA. A Rodonaves tem API
 * (quotation-apigateway.rte.com.br), mas a cotação exige contrato: client_id e
 * secret, o CNPJ do remetente e sete chamadas encadeadas, incluindo cadastrar o
 * destinatário antes de cotar. Correios não resolve: uma scooter de 101 kg
 * passa muito do limite de 30 kg. Ou seja, cotação automática na
 * transportadora depende de credencial que hoje não existe. Com ela na mão, o
 * lugar de plugar é `src/lib/frete.ts`, na função `cotar`, mantendo a tabela
 * abaixo como plano B quando a transportadora não responder.
 */

export type TabelaDeFrete = {
  /** Cobrado por envio, independente da distância. Em reais. */
  base: number | null;
  /** Reais por quilômetro rodado. */
  porKm: number | null;
  /** Reais por quilo. */
  porKg: number | null;
  /** Peso presumido quando o fabricante não publica o do modelo. Em quilos. */
  pesoPadraoKg: number | null;
  /** Dias fixos de separação e coleta. */
  prazoBaseDias: number | null;
  /** Quilômetros que a carga anda por dia, para estimar o prazo. */
  kmPorDia: number | null;
};

export const TABELA: TabelaDeFrete = {
  base: null,
  porKm: null,
  porKg: null,
  pesoPadraoKg: null,
  prazoBaseDias: null,
  kmPorDia: null,
};

/** Frete grátis a partir deste valor de compra. `null` = não existe. */
export const FRETE_GRATIS_ACIMA_DE: number | null = null;

export function tabelaPreenchida(): boolean {
  return TABELA.base !== null || TABELA.porKm !== null || TABELA.porKg !== null;
}

export function apenasDigitos(cep: string): string {
  return cep.replace(/\D/g, '');
}

export function formatarCep(cep: string): string {
  const d = apenasDigitos(cep).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
