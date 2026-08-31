/**
 * "Sob encomenda" vale enquanto a data não chegou.
 *
 * A marcação não é julgamento nosso: o fornecedor escreve no PRÓPRIO NOME do
 * produto, "PREVISÃO 28/08 - SCOOTER ELETRICA B3...". A gente só lê.
 *
 * O problema é que ele não apaga o aviso depois que a carga chega. Em 31/08
 * havia 5 itens anunciados como encomenda com data de 25/08 e 28/08, ou seja,
 * já tinham chegado. A loja repetia isso e mandava embora quem queria levar
 * hoje.
 *
 * Por isso a conta é feita na HORA DE MOSTRAR, não na hora de ler o catálogo:
 * assim o aviso caduca sozinho, mesmo que a leitura do fornecedor fique presa
 * na cópia de reserva.
 */

/** O nome só traz dia e mês. Data muito para trás é do ano que vem. */
const DIAS_DE_TOLERANCIA = 45;

export function chegadaPrevista(previsao: string | null, hoje = new Date()): Date | null {
  if (!previsao) return null;
  const m = previsao.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const data = new Date(hoje.getFullYear(), mes - 1, dia);
  const diasAtras = (hoje.getTime() - data.getTime()) / 86_400_000;
  if (diasAtras > DIAS_DE_TOLERANCIA) data.setFullYear(hoje.getFullYear() + 1);

  return data;
}

/** True só enquanto a data prometida ainda não passou. */
export function aindaVaiChegar(previsao: string | null, hoje = new Date()): boolean {
  const data = chegadaPrevista(previsao, hoje);
  if (!data) return false;
  const inicioDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return data.getTime() >= inicioDeHoje.getTime();
}
