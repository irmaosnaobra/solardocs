// Ajuda dos testes da leitura por IA (não é um teste). A saída da IA mudou de um objeto por campo
// (`{ nome: { valor, slot, confianca } }`) para uma LISTA (`{ campos: [{ campo, valor, indice, confianca, nota }], documentos }`),
// porque a API recusou o esquema antigo ("Schema is too complex"). Os testes mais antigos escrevem a resposta no jeito curto
// (campo -> { valor, slot, confianca }); esta função a traduz para o formato novo ANTES de ela chegar ao servidor, achando o
// `indice` pelo `slot`: o primeiro arquivo do pedido naquele item. Slot que não está no pedido vira indice 0 (origem
// desconhecida). Resposta que já tem `campos` passa direto. Os testes novos escrevem no formato de lista.
type Bloco = { type?: string; text?: string };

export function saidaEmLista(saida: unknown, content: unknown): unknown {
  if (!saida || typeof saida !== 'object' || Array.isArray((saida as { campos?: unknown }).campos)) return saida;
  const arquivos = (Array.isArray(content) ? (content as Bloco[]) : [])
    .filter((b) => b?.type === 'text' && /^Arquivo \d+,/.test(String(b.text)))
    .map((b) => ({ n: Number(/^Arquivo (\d+),/.exec(String(b.text))?.[1]), slot: /slot "(\w+)"/.exec(String(b.text))?.[1] ?? '' }));
  const campos: unknown[] = [];
  const resto: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(saida as Record<string, unknown>)) {
    const x = v as { valor?: unknown; slot?: unknown; indice?: unknown; confianca?: unknown; nota?: unknown } | null;
    if (chave === 'documentos' || !x || typeof x !== 'object' || !('valor' in x)) { resto[chave] = v; continue; }
    if (!x.valor) continue;   // campo vazio não aparece na lista
    const indice = typeof x.indice === 'number' ? x.indice : (arquivos.find((a) => a.slot === x.slot)?.n ?? 0);
    campos.push({ campo: chave, valor: x.valor, indice, confianca: x.confianca, nota: x.nota ?? '' });
  }
  return { ...resto, campos };
}
