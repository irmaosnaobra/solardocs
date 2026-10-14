// Funil do NOTA 1 (rota pública GET /io/eletroposto/funil): leitura completa de `pc_eventos` e chave de motivo limpa.
// Módulo folha: sem import de rota, para o teste carregar sem arrastar o resto do boot.

export const TAMANHO_PAGINA = 1000;          // o PostgREST corta em 1000 linhas e ignora `.limit()`
export const TETO_PAGINAS = 500;             // 500 mil eventos: bem acima do real; bater aqui é sinal de alerta, não rotina
export const MOTIVO_MAX = 60;
export const MOTIVO_OUTRO = 'outro';

/** Linha lida do banco. A rota pede só `id, tipo, motivo:payload->>motivo` (o payload inteiro nunca sai do banco);
 *  `payload` fica opcional para quem ainda monta o evento por inteiro. */
export interface EventoFunil { tipo: string; motivo?: unknown; payload?: unknown; created_at?: string }
type Pagina = { data: EventoFunil[] | null; error: unknown };

/**
 * Lê TODAS as páginas por `range`, até uma vir incompleta. `consulta(de, ate)` precisa ordenar por uma chave única
 * (o `id`), senão a paginação pula ou repete linha. Erro de banco sobe (quem chama responde "não consegui contar").
 * Bateu o teto: `aoBaterTeto` avisa e as contagens saem marcadas como truncadas pelo retorno.
 */
export async function lerEventosDoFunil(
  consulta: (de: number, ate: number) => PromiseLike<Pagina>,
  aoBaterTeto: (lidas: number) => void,
  tetoPaginas: number = TETO_PAGINAS,
): Promise<{ eventos: EventoFunil[]; truncado: boolean }> {
  const eventos: EventoFunil[] = [];
  for (let p = 0; p < tetoPaginas; p++) {
    const de = p * TAMANHO_PAGINA;
    const { data, error } = await consulta(de, de + TAMANHO_PAGINA - 1);
    if (error) throw error;
    const lote = data ?? [];
    eventos.push(...lote);
    if (lote.length < TAMANHO_PAGINA) return { eventos, truncado: false };
  }
  aoBaterTeto(eventos.length);
  return { eventos, truncado: true };
}

/**
 * Chave de `por_motivo`. O texto vem de payload livre de um POST público: corta em 60 caracteres, tira caractere de
 * controle e quebra de linha, e o que sobrar vazio vira "outro". Ausente/vazio (sem motivo) devolve null: não conta.
 */
export function chaveDoMotivo(motivo: unknown): string | null {
  if (motivo === undefined || motivo === null || motivo === '' || motivo === false || motivo === 0) return null;
  if (typeof motivo !== 'string' && typeof motivo !== 'number') return MOTIVO_OUTRO;
  const limpo = String(motivo)
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cortado = Array.from(limpo).slice(0, MOTIVO_MAX).join('').trim();
  return cortado || MOTIVO_OUTRO;
}

/** Contagens do funil. Mapas (não objetos soltos): a chave "__proto__" vira chave comum, não muda o protótipo. */
export function contarFunil(eventos: EventoFunil[]): { total: Record<string, number>; por_motivo: Record<string, Record<string, number>> } {
  const total = new Map<string, number>();
  const porMotivo = new Map<string, Map<string, number>>();
  for (const e of eventos) {
    total.set(e.tipo, (total.get(e.tipo) ?? 0) + 1);
    const chave = chaveDoMotivo('motivo' in e ? e.motivo : (e.payload as { motivo?: unknown } | null | undefined)?.motivo);
    if (chave === null) continue;
    const m = porMotivo.get(chave) ?? new Map<string, number>();
    m.set(e.tipo, (m.get(e.tipo) ?? 0) + 1);
    porMotivo.set(chave, m);
  }
  return {
    total: Object.fromEntries(total),
    por_motivo: Object.fromEntries([...porMotivo].map(([k, m]) => [k, Object.fromEntries(m)])),
  };
}

export interface ResultadoFunil {
  total: Record<string, number>;
  por_motivo: Record<string, Record<string, number>>;
  /** Só existe (true) quando a leitura bateu o teto: as contagens ficaram parciais. */
  truncado?: true;
}

export const FUNIL_COLUNAS = 'id, tipo, motivo:payload->>motivo';

/** Lê e conta o funil de uma janela. Quem chama passa a consulta paginada e o aviso do teto. */
export async function montarFunil(
  consulta: (de: number, ate: number) => PromiseLike<Pagina>,
  aoBaterTeto: (lidas: number) => void,
  tetoPaginas?: number,
): Promise<ResultadoFunil> {
  const { eventos, truncado } = await lerEventosDoFunil(consulta, aoBaterTeto, tetoPaginas);
  const r: ResultadoFunil = contarFunil(eventos);
  if (truncado) r.truncado = true;
  return r;
}
