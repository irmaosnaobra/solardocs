/**
 * Regras de entrega.
 *
 * As FAIXAS são reais: o CEP é resolvido em cidade e UF de verdade, então a
 * loja sabe dizer se entrega ali. Os VALORES começam vazios de propósito, e
 * enquanto estiverem assim a página diz "combinado no atendimento" em vez de
 * inventar um preço de frete que ninguém autorizou.
 *
 * Para ligar o valor na tela, preencha `valor` (em reais) e `prazo`. É só isso.
 */

export type Zona = 'uberlandia' | 'minas' | 'brasil';

export type RegraDeFrete = {
  rotulo: string;
  /** Em reais. `null` = a combinar no atendimento. `0` = sem custo. */
  valor: number | null;
  /** Texto livre, ex.: "2 a 3 dias úteis". `null` = a combinar. */
  prazo: string | null;
};

export const FRETE: Record<Zona, RegraDeFrete> = {
  uberlandia: { rotulo: 'Uberlândia e região', valor: null, prazo: null },
  minas: { rotulo: 'Minas Gerais', valor: null, prazo: null },
  brasil: { rotulo: 'Demais estados', valor: null, prazo: null },
};

export function zonaDe(cidade: string, uf: string): Zona {
  if (uf === 'MG' && cidade.trim().toLowerCase() === 'uberlândia') return 'uberlandia';
  if (uf === 'MG') return 'minas';
  return 'brasil';
}

export function apenasDigitos(cep: string): string {
  return cep.replace(/\D/g, '');
}

export function formatarCep(cep: string): string {
  const d = apenasDigitos(cep).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
