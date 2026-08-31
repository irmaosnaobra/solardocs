/**
 * Como o frete é calculado.
 *
 *     frete = PISO + (km de ida e volta x R$/km)
 *
 * É o modelo de ENTREGA DEDICADA: sai de Uberlândia, leva a bike e volta. O
 * caminhão volta vazio, então quem paga a viagem paga os dois trechos. Por isso
 * a conta é sobre ida e volta, e não sobre a distância até o cliente.
 *
 * Dentro de Uberlândia a rodagem é perto de zero e o cliente paga só o piso.
 * Foi assim que o Thiago descreveu, e é assim que está.
 */

/** PISO. Número do Thiago: é o que se cobra em Uberlândia, na porta. */
export const FRETE_MINIMO = 250;

/**
 * Quanto custa cada quilômetro rodado. É o número do Thiago.
 *
 * Onde ele se encaixa: o piso legal da ANTT para carga geral em veículo de 2
 * eixos é R$ 3,9826/km (Resolução 6.076/2026). Esse piso vale para CAMINHÃO
 * CONTRATADO. Para entrega própria em utilitário não existe piso legal, e
 * R$ 3,00 fica coerente com combustível, desgaste e o tempo do motorista.
 *
 * Regra prática: se um dia a entrega passar a ser feita por transportadora
 * contratada, este número tem que subir para 3,98 ou mais, senão o frete sai do
 * seu bolso.
 */
export const REAIS_POR_KM = 3.0;

/**
 * Até onde a entrega própria faz sentido, em quilômetros de IDA.
 *
 * Além disso a viagem dedicada vira absurdo: São Paulo daria R$ 6.383 de frete
 * numa bike de R$ 6.000. Fora do raio a tela para de dar número e manda cotar
 * no atendimento, que é onde se decide entre transportadora e entrega própria.
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
 * Onde temos veículo próprio.
 *
 * Só daqui a gente sabe o preço da entrega, porque é a nossa van que roda. De
 * qualquer outra base a bike existe e está perto do cliente, mas quem leva é
 * transportadora, e esse valor a gente ainda não tem contratado: a tela diz de
 * onde sai e manda fechar o frete no atendimento.
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
