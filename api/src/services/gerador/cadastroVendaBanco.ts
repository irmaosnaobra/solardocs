// Acesso ao CADASTRO DA VENDA do eletroposto, num bucket PRIVADO PRÓPRIO do banco principal:
//   cadastros-venda / eletroposto/<id do card>.json
//
// Por que bucket e não `system_state`: a chave pública do banco principal está num HTML público e LÊ `system_state`.
// CPF, RG, nascimento, e-mail e endereço não podem morar lá. O bucket é privado e só a API (service key) escreve.
//
// Por que um bucket só dele: o `fichas-docs` (documentos) fica intocado. Falha aqui (criar, ler, escrever) derruba só o
// cadastro, nunca os documentos. O bucket nasce no primeiro acesso (leitura da grade, GET ou escrita) em que ele ainda
// não existe; depois do primeiro sucesso a instância memoriza e não confere mais. NUNCA é atualizado (`updateBucket`
// não existe neste arquivo).
//
// FAIL-CLOSED: bucket inacessível é erro (`ErroCadastro`), nunca "cadastro vazio". Só o objeto que comprovadamente NÃO
// EXISTE (confirmado por `info`) conta como cadastro ainda não criado. Nada daqui põe caminho, valor de campo ou texto de
// erro do Storage em log: só o código.
//
// TRAVA POR VENDA (`comTrava`): ler, mesclar e gravar o JSON não é atômico. Uma linha SEM dado pessoal em `system_state`
// (`cadastro_trava:<id>`, value { por, ate }) serializa as escritas da mesma venda.
import { supabase } from '../../utils/supabase';

export class ErroCadastro extends Error {
  constructor(public codigo: string) {
    super(`cadastro-venda: ${codigo}`);
    this.name = 'ErroCadastro';
  }
}

export const BUCKET_CADASTROS = 'cadastros-venda';
export const LIMITE_CADASTRO_BYTES = 256 * 1024;
const OPCOES_DO_BUCKET = { public: false, fileSizeLimit: LIMITE_CADASTRO_BYTES, allowedMimeTypes: ['application/json'] };

export const caminhoCadastro = (id: number | string): string => `eletroposto/${id}.json`;

const codigoDe = (e: unknown): string => String((e as { code?: unknown; statusCode?: unknown; status?: unknown } | null)?.code
  ?? (e as { statusCode?: unknown } | null)?.statusCode ?? (e as { status?: unknown } | null)?.status ?? 'desconhecido');
const naoAchou = (err: unknown): boolean => {
  const e = err as { message?: unknown; statusCode?: unknown; status?: unknown } | null;
  return /not.?found/i.test(String(e?.message ?? '')) || String(e?.statusCode ?? e?.status ?? '') === '404';
};

// ── Bucket ───────────────────────────────────────────────────────────────────

let bucketOk = false;
/** Para os testes. */
export function limparCacheBucketCadastros(): void { bucketOk = false; }

/**
 * Confere o bucket (por `getBucket`) e só o cria quando o erro é claro de "não existe". Existindo PÚBLICO, é erro (o
 * cadastro ficaria aberto). Existindo com outra configuração, segue como está: nada é atualizado. Sucesso é memorizado.
 */
async function garantirBucketCadastros(): Promise<void> {
  if (bucketOk) return;
  const { data, error } = await supabase.storage.getBucket(BUCKET_CADASTROS);
  if (!error && data) {
    if (data.public) throw new ErroCadastro('bucket_publico');
    bucketOk = true;
    return;
  }
  if (!error || !naoAchou(error)) throw new ErroCadastro('bucket');
  const { error: eCria } = await supabase.storage.createBucket(BUCKET_CADASTROS, OPCOES_DO_BUCKET);
  if (eCria) {
    // Outra instância pode ter criado no mesmo instante: confere de novo antes de desistir.
    const { data: d2, error: e2 } = await supabase.storage.getBucket(BUCKET_CADASTROS);
    if (e2 || !d2) throw new ErroCadastro('bucket_nao_criou');
    if (d2.public) throw new ErroCadastro('bucket_publico');
  }
  bucketOk = true;
}

/**
 * O objeto não existe? O erro do `download` NÃO é confiável para isso: dependendo da versão do storage-js a mensagem sai
 * vazia ("{}") e o status vem como 400. A resposta vem de `info`. Sonda que falha, ou objeto que existe, é erro de verdade.
 */
async function objetoAusente(caminho: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(BUCKET_CADASTROS).info(caminho);
  if (error) return naoAchou(error);
  return !data;
}

/** O JSON do cadastro, ou null se o objeto não existe. Qualquer outra falha (rede, bucket, JSON torto) lança. */
export async function lerCadastroBruto(id: number): Promise<unknown | null> {
  await garantirBucketCadastros();
  const caminho = caminhoCadastro(id);
  const { data, error } = await supabase.storage.from(BUCKET_CADASTROS).download(caminho);
  if (error) {
    let ausente = false;
    try { ausente = await objetoAusente(caminho); } catch { /* sonda falhou: erro de leitura */ }
    if (ausente) return null;
    throw new ErroCadastro('ler');
  }
  if (!data) throw new ErroCadastro('ler');
  try { return JSON.parse(await data.text()); } catch { throw new ErroCadastro('json'); }
}

/** Grava (sobrescreve) o JSON do cadastro. `cacheControl` zero: a leitura seguinte não pode ver a versão velha. */
export async function gravarCadastroBruto(id: number, valor: unknown): Promise<void> {
  await garantirBucketCadastros();
  const corpo = Buffer.from(JSON.stringify(valor), 'utf8');
  if (corpo.length > LIMITE_CADASTRO_BYTES) throw new ErroCadastro('grande');
  const { error } = await supabase.storage.from(BUCKET_CADASTROS).upload(caminhoCadastro(id), corpo, {
    contentType: 'application/json', upsert: true, cacheControl: '0',
  });
  if (error) throw new ErroCadastro('gravar');
}

/**
 * Ids de card que TÊM cadastro (`eletroposto/<id>.json`). Serve para a grade da ficha só baixar o que existe, em vez de um
 * download por venda. Avança pelo que veio e só uma página vazia encerra (o Storage pode cortar abaixo do limite pedido).
 */
export async function listarIdsComPasta(): Promise<Set<number>> {
  await garantirBucketCadastros();
  const ids = new Set<number>();
  const PAGINA = 1000;
  for (let de = 0; de < 200_000;) {
    const { data, error } = await supabase.storage.from(BUCKET_CADASTROS).list('eletroposto', {
      limit: PAGINA, offset: de, sortBy: { column: 'name', order: 'asc' },
    });
    if (error || !Array.isArray(data)) throw new ErroCadastro('listar');
    if (data.length === 0) break;
    for (const e of data as Array<{ name?: unknown }>) {
      const m = /^(\d{1,12})\.json$/.exec(String(e?.name ?? ''));
      const n = m ? Number(m[1]) : NaN;
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
    de += data.length;
  }
  return ids;
}

// ── Trava por venda ──────────────────────────────────────────────────────────

export const TRAVA_PREFIXO = 'cadastro_trava:';
export const TRAVA_TTL_MS = 15_000;
export const TRAVA_TENTATIVAS = 5;
export const TRAVA_ESPERA_MS = 250;
const dorme = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Tenta pegar a trava da venda. true = pegou (e `meuStamp` identifica a linha dele). Trava vencida (`ate` no passado) é
 * tomada com delete condicional pelo `updated_at` lido, para duas instâncias não tomarem a mesma.
 */
async function pegarTrava(chave: string, por: string, meuStamp: string): Promise<boolean> {
  for (let rodada = 0; rodada < 3; rodada++) {
    const ate = new Date(Date.now() + TRAVA_TTL_MS).toISOString();
    const { error } = await supabase.from('system_state').insert({ key: chave, value: { por, ate }, updated_at: meuStamp });
    if (!error) return true;
    if (codigoDe(error) !== '23505') throw new ErroCadastro('trava');
    // Ocupada. Vencida?
    const { data, error: eLe } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chave).maybeSingle();
    if (eLe) throw new ErroCadastro('trava');
    if (!data) continue;   // soltaram agora: tenta de novo já
    const l = data as { value?: { ate?: unknown } | null; updated_at?: string | null };
    const ate0 = Date.parse(String(l.value?.ate ?? ''));
    if (Number.isFinite(ate0) && ate0 >= Date.now()) return false;
    const alvo = supabase.from('system_state').delete().eq('key', chave);
    const { error: eDel } = await (l.updated_at ? alvo.eq('updated_at', l.updated_at) : alvo.is('updated_at', null)).select('key');
    if (eDel) throw new ErroCadastro('trava');
    // Apagou a vencida (ou outro apagou antes): tenta pegar de novo.
  }
  return false;
}

async function soltarTrava(chave: string, meuStamp: string): Promise<void> {
  try {
    await supabase.from('system_state').delete().eq('key', chave).eq('updated_at', meuStamp).select('key');
  } catch { /* o TTL de 15 s limpa */ }
}

/**
 * Roda `fn` com a trava da venda. Escritas da mesma venda esperam (até ~5 tentativas curtas); sem conseguir, lança
 * `ErroCadastro('ocupado')`. A trava SEMPRE é solta no `finally`, e só se ainda for a dele.
 */
export async function comTrava<T>(id: number, por: string, fn: () => Promise<T>): Promise<T> {
  const chave = `${TRAVA_PREFIXO}${id}`;
  const meuStamp = new Date().toISOString();
  let pegou = false;
  for (let t = 0; t < TRAVA_TENTATIVAS && !pegou; t++) {
    pegou = await pegarTrava(chave, por, meuStamp);
    if (!pegou && t < TRAVA_TENTATIVAS - 1) await dorme(TRAVA_ESPERA_MS);
  }
  if (!pegou) throw new ErroCadastro('ocupado');
  try {
    return await fn();
  } finally {
    await soltarTrava(chave, meuStamp);
  }
}
