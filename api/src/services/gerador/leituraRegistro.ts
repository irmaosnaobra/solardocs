import { comTrava, gravarJsonBruto, lerJsonBruto } from './cadastroVendaBanco';

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRO DAS LEITURAS POR IA DA VENDA SOLAR (`vendasolar/<card>.leitura.json`, bucket privado dos cadastros; o da PESSOA vive em
// `leitura-pessoa/<nome>.json`). Sempre mexido sob trava (`comTrava`), lido e gravado INTEIRO. O formato (v1, só cresce):
//   lidos     a cota e o dedupe: uma entrada por chamada à IA ({sha, em, id?}); só as últimas 100 contam;
//   arquivos  os arquivos que já foram lidos, por id ({id, sha?}); o que está nos itens legíveis e NÃO está aqui é "pendente";
//   rodando   quando começou a leitura em lote (GET da obra); marca com mais de 3 min é velha e não vale;
//   falha_em  quando a IA falhou no lote (espera de 10 min antes de tentar de novo);
//   ultima_em quando a última leitura deu certo.
// A cota é por hora e por dono do registro (a venda: 20; a pessoa: 30, só no "Ler tudo"). Nada daqui vai para log além do código do erro.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_LEITURAS_POR_HORA = 20;
/** "Ler tudo": o teto de pedidos por hora de uma mesma pessoa, em todas as vendas. */
export const MAX_LEITURAS_POR_PESSOA_HORA = 30;
export const MARCADOR_VELHO_MS = 3 * 60 * 1000;
export const ESPERA_APOS_FALHA_MS = 10 * 60 * 1000;
export const UMA_HORA_MS = 60 * 60 * 1000;
const MAX_LIDOS = 100;
const MAX_ARQUIVOS = 600;
const TRAVA = { tentativas: 10, esperaMs: 300 };

export interface EntradaLida { sha: string; em: string; id?: string }
export interface ArquivoLido { id: string; sha?: string }
export interface Registro {
  v: 1; lidos: EntradaLida[]; arquivos: ArquivoLido[]; rodando: string | null; falha_em: string | null; ultima_em: string | null;
}

export const caminhoLeituraAuto = (card: number): string => `vendasolar/${card}.leitura.json`;

/** Uma cota por hora: onde ficam as leituras (bucket privado), a trava que protege o registro e o teto. */
export interface Cota { caminho: string; trava: string; limite: number }
export const cotaDaVenda = (card: number): Cota => ({ caminho: caminhoLeituraAuto(card), trava: `leitura-auto:${card}`, limite: MAX_LEITURAS_POR_HORA });
export const cotaDaPessoa = (nome: string): Cota => {
  const slug = nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'sem_nome';
  return { caminho: `leitura-pessoa/${slug}.json`, trava: `leitura-pessoa:${slug}`, limite: MAX_LEITURAS_POR_PESSOA_HORA };
};

const RE_SHA = /^[0-9a-f]{64}$/;
const RE_ID = /^[0-9a-zA-Z_-]{1,64}$/;
const iso = (x: unknown): string | null => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);

export function normalizarRegistro(v: unknown): Registro {
  const o = obj(v);
  const lidos = (Array.isArray(o?.lidos) ? o!.lidos as unknown[] : []).flatMap((x): EntradaLida[] => {
    const e = obj(x);
    return e && typeof e.sha === 'string' && RE_SHA.test(e.sha) && iso(e.em) ? [{ sha: e.sha, em: e.em as string, ...(typeof e.id === 'string' && RE_ID.test(e.id) ? { id: e.id } : {}) }] : [];
  });
  const arquivos = (Array.isArray(o?.arquivos) ? o!.arquivos as unknown[] : []).flatMap((x): ArquivoLido[] => {
    const e = obj(x);
    return e && typeof e.id === 'string' && RE_ID.test(e.id) ? [{ id: e.id, ...(typeof e.sha === 'string' && RE_SHA.test(e.sha) ? { sha: e.sha } : {}) }] : [];
  });
  return { v: 1, lidos: lidos.slice(-MAX_LIDOS), arquivos: arquivos.slice(-MAX_ARQUIVOS), rodando: iso(o?.rodando), falha_em: iso(o?.falha_em), ultima_em: iso(o?.ultima_em) };
}

export async function lerRegistro(caminho: string): Promise<Registro> {
  return normalizarRegistro(await lerJsonBruto(caminho));
}
const gravar = (caminho: string, r: Registro): Promise<void> =>
  gravarJsonBruto(caminho, { ...r, lidos: r.lidos.slice(-MAX_LIDOS), arquivos: r.arquivos.slice(-MAX_ARQUIVOS) });

/** Junta ids ao registro (quem já está não repete; o sha novo completa o que veio sem). */
function comArquivosLidos(r: Registro, itens: readonly ArquivoLido[]): Registro {
  const mapa = new Map(r.arquivos.map((a) => [a.id, a]));
  for (const i of itens) { const a = mapa.get(i.id); mapa.set(i.id, { id: i.id, ...((i.sha ?? a?.sha) ? { sha: (i.sha ?? a?.sha) as string } : {}) }); }
  return { ...r, arquivos: [...mapa.values()] };
}

/** Quantas leituras a cota já gastou na última hora (só olha, não reserva). */
export const gastoNaHora = (r: Registro): number => r.lidos.filter((x) => Date.now() - Date.parse(x.em) < UMA_HORA_MS).length;
export const marcadorValido = (r: Registro): boolean => !!r.rodando && Date.now() - Date.parse(r.rodando) < MARCADOR_VELHO_MS;
export const emEspera = (r: Registro): boolean => !!r.falha_em && Date.now() - Date.parse(r.falha_em) < ESPERA_APOS_FALHA_MS;

/**
 * Reserva (sob trava) uma leitura: o mesmo sha não lê duas vezes (`dedupe`; o arquivo `id` conta como lido) e a cota por hora vale para o dono do
 * registro. Reservada, o arquivo `id` já conta como lido (quem falhar devolve).
 */
export async function reservar(c: Cota, nome: string, sha: string, dedupe: boolean, id?: string): Promise<'ok' | 'repetido' | 'cota'> {
  return comTrava(c.trava, nome, async (): Promise<'ok' | 'repetido' | 'cota'> => {
    const r = await lerRegistro(c.caminho);
    if (dedupe && (r.lidos.some((x) => x.sha === sha) || r.arquivos.some((x) => x.sha === sha))) {
      if (id) await gravar(c.caminho, comArquivosLidos(r, [{ id, sha }]));
      return 'repetido';
    }
    if (gastoNaHora(r) >= c.limite) return 'cota';
    const lidos = [...r.lidos, { sha, em: new Date().toISOString(), ...(id ? { id } : {}) }];
    await gravar(c.caminho, id ? comArquivosLidos({ ...r, lidos }, [{ id, sha }]) : { ...r, lidos });
    return 'ok';
  }, 60_000, TRAVA);
}

/** Leitura que falha (ou que estourou o tempo) devolve a reserva: tira a entrada da cota e o arquivo da lista dos lidos. */
export async function devolver(c: Cota, nome: string, sha: string, ids: readonly string[] = []): Promise<void> {
  try {
    await comTrava(c.trava, nome, async () => {
      const r = await lerRegistro(c.caminho);
      await gravar(c.caminho, { ...r, lidos: r.lidos.filter((x) => x.sha !== sha), arquivos: r.arquivos.filter((a) => !ids.includes(a.id)) });
    }, 60_000, TRAVA);
  } catch (e) { console.error('[leitura-registro] devolver a reserva', (e as { codigo?: unknown } | null)?.codigo ?? 'interno'); }
}

/** Marca arquivos como lidos (e, se for o caso, a hora da última leitura que deu certo). */
export async function marcarLidos(c: Cota, nome: string, itens: readonly ArquivoLido[], sucesso = false): Promise<void> {
  await comTrava(c.trava, nome, async () => {
    const r = await lerRegistro(c.caminho);
    await gravar(c.caminho, { ...comArquivosLidos(r, itens), ...(sucesso ? { ultima_em: new Date().toISOString() } : {}) });
  }, 60_000, TRAVA);
}

/** Pega o marcador "rodando" (sob trava): false = outra leitura em lote está rodando (marca com menos de 3 min). */
export async function tomarMarcador(c: Cota, nome: string): Promise<boolean> {
  return comTrava(c.trava, nome, async () => {
    const r = await lerRegistro(c.caminho);
    if (marcadorValido(r)) return false;
    await gravar(c.caminho, { ...r, rodando: new Date().toISOString() });
    return true;
  }, 60_000, TRAVA);
}

/** Solta o marcador. `falha`: a IA falhou (começa a espera de 10 min). `sucesso`: guarda a hora da leitura. Nunca lança. */
export async function soltarMarcador(c: Cota, nome: string, o: { falha?: boolean; sucesso?: boolean } = {}): Promise<void> {
  try {
    await comTrava(c.trava, nome, async () => {
      const r = await lerRegistro(c.caminho);
      const agora = new Date().toISOString();
      await gravar(c.caminho, { ...r, rodando: null, ...(o.falha ? { falha_em: agora } : {}), ...(o.sucesso ? { ultima_em: agora, falha_em: null } : {}) });
    }, 60_000, TRAVA);
  } catch (e) { console.error('[leitura-registro] soltar o marcador', (e as { codigo?: unknown } | null)?.codigo ?? 'interno'); }
}
