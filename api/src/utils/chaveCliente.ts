/**
 * Chave do cliente: a forma de comparar nomes que não liga para acento, maiúscula
 * nem espaço repetido. "PAROQUIA DE SÃO JOSÉ" e "  paroquia de  sao jose " dão a
 * mesma chave. É a única função de comparação de cliente do módulo de documentos:
 * a pasta do cliente, o filtro do /documents/list e a trava de cota do regenerate
 * usam esta, para nunca divergirem.
 */
export function chaveCliente(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
