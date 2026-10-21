// Versões dos contratos e papéis do /gerador, ligadas ao card do cliente. Entrega 1 de 2 (21/10/2026).
//
// Mora num bucket PRIVADO PRÓPRIO, `contratos-versoes` (nunca em `system_state`: o contrato leva CPF, endereço e valores; e não no
// `cadastros-venda`, que tem teto de 256 KB por arquivo):
//   <linha>/<card>/<versaoId>.json   a versão inteira (snapshot do formulário + HTML exato da 2ª via, já limpo de script)
//   <linha>/<card>/indice.json       só os campos leves, para a lista não baixar até 200 arquivos grandes
//
// O bucket nasce no primeiro uso, por consulta e criação EXPLÍCITAS (getBucket/createBucket); `list()` do Storage devolve
// `{error:null,data:[]}` para bucket inexistente e por isso nunca serve de prova. Existindo público, é erro. Nada é atualizado.
//
// APPEND-ONLY: a versão nunca é sobrescrita (upload sem upsert). Quem grava e quem apaga passa pela trava do card (`comTrava`,
// linha sem dado pessoal em `system_state`), que também torna atômico o teto de 200 versões. O HTML passa por `limparHtmlPapel`
// antes de gravar: outra pessoa vai imprimi-lo. Nada daqui põe conteúdo, nome ou texto de erro do Storage em log: só o código.
import { supabase } from '../../utils/supabase';
import { ErroCadastro, comTrava } from './cadastroVendaBanco';
import { limparHtmlPapel } from './htmlPapelSeguro';

export const BUCKET_VERSOES = 'contratos-versoes';
export const TETO_BUCKET_BYTES = 5 * 1024 * 1024;
const OPCOES_DO_BUCKET = { public: false, fileSizeLimit: TETO_BUCKET_BYTES, allowedMimeTypes: ['application/json'] };

export const LINHAS_CONTRATO = ['eletroposto', 'vendasolar'] as const;
export type LinhaContrato = (typeof LINHAS_CONTRATO)[number];
export const ehLinhaContrato = (x: unknown): x is LinhaContrato => x === 'eletroposto' || x === 'vendasolar';
export const ehUuid = (x: unknown): x is string =>
  typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

/** 4 MB por versão (o bucket aceita 5 MB) e 200 por card. */
export const LIMITE_VERSAO_BYTES = 4_000_000;
export const LIMITE_VERSOES = 200;

export interface VersaoLeve {
  id: string; tipo: string; rotulo: string; modelo: string; num: string; data: string; em: string; autor: string; editado: boolean; bytes: number;
}
export interface VersaoInteira extends VersaoLeve {
  snap: unknown; html: string; arquivo: string; titulo: string; opts: unknown; emit: unknown; emitSelo: string;
}

const pasta = (linha: LinhaContrato, card: number | string): string => `${linha}/${card}`;
const caminhoIndice = (linha: LinhaContrato, card: number | string): string => `${pasta(linha, card)}/indice.json`;
const caminhoVersao = (linha: LinhaContrato, card: number | string, id: string): string => `${pasta(linha, card)}/${id}.json`;
const chaveTrava = (linha: LinhaContrato, card: number | string): string => `contratos:${linha}:${card}`;

const naoAchou = (err: unknown): boolean => {
  const e = err as { message?: unknown; statusCode?: unknown; status?: unknown } | null;
  return /not.?found/i.test(String(e?.message ?? '')) || String(e?.statusCode ?? e?.status ?? '') === '404';
};

let bucketOk = false;
/** Para os testes. */
export function limparCacheBucketVersoes(): void { bucketOk = false; }

/** Confere o bucket por `getBucket` e só o cria quando o erro é claro de "não existe". Público é erro. Sucesso é memorizado. */
async function garantirBucket(): Promise<void> {
  if (bucketOk) return;
  const { data, error } = await supabase.storage.getBucket(BUCKET_VERSOES);
  if (!error && data) {
    if (data.public) throw new ErroCadastro('bucket_publico');
    bucketOk = true;
    return;
  }
  if (!error || !naoAchou(error)) throw new ErroCadastro('bucket');
  const { error: eCria } = await supabase.storage.createBucket(BUCKET_VERSOES, OPCOES_DO_BUCKET);
  if (eCria) {
    // Outra instância pode ter criado no mesmo instante: confere de novo antes de desistir.
    const { data: d2, error: e2 } = await supabase.storage.getBucket(BUCKET_VERSOES);
    if (e2 || !d2) throw new ErroCadastro('bucket_nao_criou');
    if (d2.public) throw new ErroCadastro('bucket_publico');
  }
  bucketOk = true;
}

/** O JSON de um caminho, ou null se o objeto comprovadamente não existe (confirmado por `info`). Qualquer outra falha lança. */
async function lerJson(caminho: string): Promise<unknown | null> {
  const { data, error } = await supabase.storage.from(BUCKET_VERSOES).download(caminho);
  if (error) {
    let ausente = false;
    try {
      const r = await supabase.storage.from(BUCKET_VERSOES).info(caminho);
      ausente = r.error ? naoAchou(r.error) : !r.data;
    } catch { /* sonda falhou: erro de leitura */ }
    if (ausente) return null;
    throw new ErroCadastro('ler');
  }
  if (!data) throw new ErroCadastro('ler');
  try { return JSON.parse(await data.text()); } catch { throw new ErroCadastro('json'); }
}

async function lerIndice(linha: LinhaContrato, card: number | string): Promise<VersaoLeve[]> {
  const bruto = await lerJson(caminhoIndice(linha, card));
  if (bruto === null) return [];
  const lista = (bruto as { versoes?: unknown } | null)?.versoes;
  if (!Array.isArray(lista)) throw new ErroCadastro('json');
  return lista as VersaoLeve[];
}

async function enviar(caminho: string, valor: unknown, upsert: boolean): Promise<void> {
  const corpo = Buffer.from(JSON.stringify(valor), 'utf8');
  const { error } = await supabase.storage.from(BUCKET_VERSOES).upload(caminho, corpo, { contentType: 'application/json', upsert, cacheControl: '0' });
  if (error) {
    const e = error as { statusCode?: unknown; status?: unknown; message?: unknown };
    if (String(e.statusCode ?? e.status ?? '') === '413' || /exceed|too large|maximum allowed/i.test(String(e.message ?? ''))) throw new ErroCadastro('grande_bucket');
    throw new ErroCadastro('gravar');
  }
}

/** A lista, da mais nova para a mais antiga. Sem o HTML nem o snapshot. */
export async function listarVersoes(linha: LinhaContrato, card: number | string): Promise<VersaoLeve[]> {
  await garantirBucket();
  const l = await lerIndice(linha, card);
  return [...l].sort((a, b) => String(b.em).localeCompare(String(a.em)));
}

/** A versão inteira, ou null se não existe. */
export async function lerVersao(linha: LinhaContrato, card: number | string, id: string): Promise<VersaoInteira | null> {
  await garantirBucket();
  if (!(await lerIndice(linha, card)).some((v) => v.id === id)) return null;
  const v = await lerJson(caminhoVersao(linha, card, id));
  return v && typeof v === 'object' ? (v as VersaoInteira) : null;
}

/** Grava uma versão nova. Lança `limite` (200 por card), `grande` (acima de 4 MB), `grande_bucket`, `ocupado` ou erro de Storage. */
export async function gravarVersao(
  linha: LinhaContrato, card: number | string, por: string, dados: Omit<VersaoInteira, 'id' | 'em' | 'bytes'>,
): Promise<VersaoLeve> {
  const id = crypto.randomUUID();
  const em = new Date().toISOString();
  const inteira: VersaoInteira = { ...dados, html: limparHtmlPapel(dados.html), id, em, bytes: 0 };
  inteira.bytes = Buffer.byteLength(JSON.stringify(inteira), 'utf8');
  if (inteira.bytes > LIMITE_VERSAO_BYTES) throw new ErroCadastro('grande');
  const leve: VersaoLeve = {
    id, tipo: inteira.tipo, rotulo: inteira.rotulo, modelo: inteira.modelo, num: inteira.num, data: inteira.data, em, autor: inteira.autor,
    editado: inteira.editado, bytes: inteira.bytes,
  };
  await garantirBucket();
  // O arquivo grande sobe ANTES da trava: o caminho tem uuid novo, então não colide com ninguém, e a trava (que dura 15 s) fica só
  // para o que precisa ser serial: ler o índice, conferir o teto e gravar o índice. Duas gravações juntas não disputam a trava por
  // causa de megabytes de upload.
  await enviar(caminhoVersao(linha, card, id), inteira, false);
  try {
    await comTrava(chaveTrava(linha, card), por, async () => {
      const indice = await lerIndice(linha, card);
      if (indice.length >= LIMITE_VERSOES) throw new ErroCadastro('limite');
      await enviar(caminhoIndice(linha, card), { v: 1, versoes: [...indice, leve] }, true);
    });
  } catch (e) {
    // Limite, trava ocupada ou falha do índice: o arquivo subido não tem dono na lista, então sai.
    await supabase.storage.from(BUCKET_VERSOES).remove([caminhoVersao(linha, card, id)]).catch(() => undefined);
    throw e;
  }
  return leve;
}

/** Apaga a versão. false = não existe neste card. */
export async function apagarVersao(linha: LinhaContrato, card: number | string, por: string, id: string): Promise<boolean> {
  await garantirBucket();
  return comTrava(chaveTrava(linha, card), por, async () => {
    const indice = await lerIndice(linha, card);
    if (!indice.some((v) => v.id === id)) return false;
    // Primeiro sai do índice (some da lista); o objeto vai depois. Se o remove falhar, sobra um arquivo solto e inalcançável.
    await enviar(caminhoIndice(linha, card), { v: 1, versoes: indice.filter((v) => v.id !== id) }, true);
    const { error } = await supabase.storage.from(BUCKET_VERSOES).remove([caminhoVersao(linha, card, id)]);
    if (error) console.error('[contratos-versoes] objeto ficou solto', 'remover');
    return true;
  });
}
