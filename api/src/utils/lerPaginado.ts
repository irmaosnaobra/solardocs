/** O PostgREST devolve no máximo 1000 linhas por resposta, sem avisar. */
export const LINHAS_POR_PAGINA = 1000;
/** Teto de segurança: 200 páginas = 200 mil linhas. Passou disso, algo está errado. */
export const TETO_PAGINAS = 200;

/**
 * Lê TUDO de uma consulta, de 1000 em 1000, até vir uma página incompleta.
 * `pagina` recebe o intervalo e tem que ordenar por coluna única (id), senão a
 * paginação pula ou repete linha. Erro em qualquer página, teto estourado ou
 * resposta que não é lista SOBE: lista de "quem já recebeu" ou de "quem pediu pra
 * não receber" lida pela metade faz essa gente parecer nova, e a mensagem sai.
 * Quem chama trata como falha fechada (não envia nada).
 *
 * `data` que não é lista lança em QUALQUER página, a 1ª inclusa. O Supabase devolve
 * lista vazia ([]) para consulta sem linha; nulo sem erro é resposta quebrada, e
 * tratar como "completo" abriria a porta em lista de exclusão (vazio = ninguém barrado).
 */
export async function lerPaginado<T>(
  rotulo: string,
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = [];
  for (let p = 0; p < TETO_PAGINAS; p++) {
    const de = p * LINHAS_POR_PAGINA;
    const { data, error } = await pagina(de, de + LINHAS_POR_PAGINA - 1);
    if (error) throw new Error(`${rotulo}: página ${p + 1}: ${error.message}`);
    if (!Array.isArray(data)) throw new Error(`${rotulo}: página ${p + 1} não veio como lista`);
    for (const l of data) todas.push(l);
    if (data.length < LINHAS_POR_PAGINA) return todas;
  }
  throw new Error(`${rotulo}: passou do teto de ${TETO_PAGINAS} páginas`);
}
