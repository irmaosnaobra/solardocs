/**
 * Como o frete é calculado.
 *
 *     frete = PISO + (km de ida e volta x R$/km)
 *
 * É o modelo de ENTREGA DEDICADA, e desde 31/08 vale para TODAS as unidades: o
 * piso de R$ 250 conta da sede de cada uma, não só de Uberlândia. Quem está em
 * São Paulo é atendido de São Bernardo pelo mesmo preço de tabela que quem está
 * em Uberlândia é atendido daqui.
 *
 * O caminhão volta vazio, então quem paga a viagem paga os dois trechos: a
 * conta é sobre ida e volta, não sobre a distância até o cliente.
 *
 * Na cidade da unidade a rodagem é perto de zero e o cliente paga só o piso.
 */

/** PISO. Número do Thiago: é o que se cobra na cidade da unidade, na porta. */
export const FRETE_MINIMO = 250;

/**
 * Quanto custa cada quilômetro rodado. É o número do Thiago.
 *
 * Onde ele se encaixa: o piso legal da ANTT para carga geral em veículo de 2
 * eixos é R$ 3,9826/km (Resolução 6.076/2026). Esse piso vale para CAMINHÃO
 * CONTRATADO. Para entrega própria em utilitário não existe piso legal.
 *
 * Passou de 3,00 para 2,00 em 31/08, por decisão do Thiago, junto com a
 * extensão do piso a todas as unidades — o que faz sentido: com a bike saindo
 * de perto, a rodagem é curta e o piso já cobre a maior parte do serviço.
 *
 * Regra prática que continua valendo: se a entrega passar a ser feita por
 * transportadora contratada, este número tem que subir para 3,98 ou mais,
 * senão o frete sai do bolso de vocês.
 */
export const REAIS_POR_KM = 2.0;

/**
 * Até onde a entrega própria faz sentido, em quilômetros de IDA.
 *
 * Com a bike saindo da unidade mais perto, quase todo mundo cai dentro. O raio
 * segue existindo para o caso que sobra: ninguém no meio do Amazonas deve ver
 * "R$ 6.250 de frete" numa bike de R$ 6.000. Fora do raio a tela para de dar
 * número e manda cotar no atendimento.
 */
export const RAIO_MAXIMO_KM = 300;

/**
 * A partir daqui a bike deixa de ser "perto de você".
 *
 * Fica aqui, e não na vitrine, porque o card e o quadro de frete precisam
 * concordar: um dizendo "perto" e o outro tratando como longe é pior do que
 * qualquer um dos dois sozinho.
 */
export const PERTO_KM = 150;

/**
 * De onde sai a entrega.
 *
 * `null` = a bike sai da base do fornecedor mais perto do cliente, contando só
 * as que TÊM aquele modelo. Das 22 bases, 13 estocam bike; o Norte e o Nordeste
 * inteiros não têm nenhuma. Uberlândia tem os 29 modelos.
 *
 * Preencher com um slug prende tudo numa base só.
 */
export const ORIGEM_UNICA: string | null = null;

/**
 * A nossa casa. Já NÃO decide mais preço.
 *
 * Até 31/08 só daqui saía valor, porque só aqui roda a nossa van; de qualquer
 * outra base a tela dizia "cotamos no atendimento". Com o piso valendo da sede
 * de cada unidade, toda base cota, e a origem passou a ser simplesmente a mais
 * perto de quem compra — que é também a mais barata.
 *
 * Continua servindo para o texto da loja saber qual base é a nossa.
 */
export const BASE_PROPRIA = 'cduberlandiamg';

/** Estimativa de prazo da viagem dedicada. */
export const KM_POR_DIA = 500;
export const DIAS_DE_SEPARACAO = 2;

/**
 * Fator de cubagem rodoviário: 300 kg/m3. Não entra no PREÇO neste modelo,
 * porque numa viagem dedicada quem custa é a viagem, não o quilo. Fica no
 * cálculo porque o peso taxado é o que a transportadora pergunta, e ter o
 * número na tela poupa uma ida e volta com o cliente.
 */
export const KG_POR_M3 = 300;

/**
 * Quando o fabricante não publica peso nem medida.
 *
 * ASSUNÇÃO MINHA, tirada da faixa dos modelos que publicam: as scooters do
 * catálogo vão de 66 a 118 kg e de 0,37 a 0,90 m3. Bicicleta é mais leve e
 * ocupa menos.
 */
export const PRESUMIDO: Record<string, { pesoKg: number; m3: number }> = {
  'Scooter elétrica': { pesoKg: 90, m3: 0.55 },
  'Bicicleta elétrica': { pesoKg: 35, m3: 0.38 },
  padrao: { pesoKg: 60, m3: 0.45 },
};

export function apenasDigitos(cep: string): string {
  return cep.replace(/\D/g, '');
}

export function formatarCep(cep: string): string {
  const d = apenasDigitos(cep).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
