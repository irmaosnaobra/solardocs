/**
 * Como o frete é calculado.
 *
 * A estrutura é a que transportadora usa em carga fracionada, não uma regra de
 * três sobre distância:
 *
 *     peso taxado = maior entre o peso real e o peso cubado
 *     frete-peso  = R$/kg/km x peso taxado x km rodados
 *     frete-valor = ad valorem sobre o preço da bike (GRIS + seguro)
 *     frete       = maior entre o PISO e (frete-peso + frete-valor)
 *
 * Por que peso taxado e não peso: bicicleta e scooter ocupam muito espaço para
 * o que pesam. A scooter B3 tem 101 kg de balança e 149x44x83 cm, o que dá
 * 0,544 m3 e 163 kg de peso cubado. Quem paga o caminhão paga pelo espaço, e é
 * por isso que toda transportadora cobra pelo maior dos dois.
 *
 * Por que o piso: perto de uma base, o custo do deslocamento é irrelevante
 * diante de coleta, despacho e entrega. Como o fornecedor tem 22 bases, a
 * maioria dos clientes cai dentro do piso, e isso é vantagem comercial, não
 * defeito do modelo.
 */

/** PISO. Número do Thiago: é o que se cobra em Uberlândia, na porta da base. */
export const FRETE_MINIMO = 250;

/**
 * Fator de cubagem rodoviário. 300 kg/m3 é o padrão do modal no Brasil: um
 * metro cúbico é cobrado como se pesasse 300 kg.
 */
export const KG_POR_M3 = 300;

/**
 * Coeficiente de deslocamento da ANTT para carga geral em veículo de 2 eixos,
 * tabela de 2026 (Resolução 6.076/2026, reajustada pela 6.084 de 16/07/2026).
 * É o piso legal por quilômetro RODADO do caminhão inteiro.
 */
export const CCD_ANTT_POR_KM = 3.9826;

/**
 * Quantos quilos pagantes o caminhão de 2 eixos leva na prática.
 *
 * ASSUNÇÃO MINHA, e é a que mais mexe no resultado. Um toco carrega mais que
 * isso no papel; em carga fracionada a ocupação real fica bem abaixo da lotação
 * porque volume acaba antes do peso. Subir este número barateia o frete longo;
 * baixar encarece.
 */
export const CAPACIDADE_PAGANTE_KG = 4000;

/**
 * De custo de caminhoneiro para preço de transportadora.
 *
 * O piso da ANTT é o CUSTO de quem roda, não o PREÇO que a transportadora
 * cobra. Entre um e outro entram terminal, transbordo, administração, margem e
 * imposto. O fator abaixo faz essa ponte.
 *
 * ESTE É O NÚMERO PARA CALIBRAR. Peça uma cotação real de uma scooter para uma
 * cidade longe, compare com a tabela, e mexa só aqui: 2,5 sobe para 3 se o
 * frete real vier mais caro, cai para 2 se vier mais barato.
 */
export const FATOR_MERCADO = 2.5;

/** O que cabe a cada quilo taxado, por quilômetro. Sai das constantes acima. */
export const REAIS_POR_KG_KM = (CCD_ANTT_POR_KM / CAPACIDADE_PAGANTE_KG) * FATOR_MERCADO;

/**
 * Ad valorem: GRIS mais seguro, sobre o valor da mercadoria. 0,30% é a faixa
 * usual do mercado. ASSUNÇÃO MINHA até você conferir com a transportadora.
 */
export const AD_VALOREM = 0.003;

/** Estimativa de prazo. Carga fracionada anda menos que carreta de lotação. */
export const KM_POR_DIA = 450;
export const DIAS_DE_COLETA_E_ENTREGA = 3;

/**
 * Quando o fabricante não publica peso nem medida.
 *
 * ASSUNÇÃO MINHA, tirada da faixa dos modelos que publicam: as scooters do
 * catálogo vão de 66 a 118 kg e de 0,37 a 0,90 m3. Bicicleta é mais leve e
 * ocupa menos. Trocar aqui muda só os itens sem ficha completa.
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
