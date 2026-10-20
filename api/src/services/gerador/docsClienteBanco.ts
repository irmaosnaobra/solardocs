// Leitura e gravação dos documentos da ficha de clientes.
//   - arquivos ........ Storage do banco PRINCIPAL, bucket PRIVADO `fichas-docs`
//   - metadados ....... banco principal, `system_state` (`docs_cliente:<linha>:<codigo>`)
//   - propostas ....... banco do GERADOR, tabela `propostas` (só o resumo, para o vínculo do Solar)
//
// Nada daqui põe caminho, nome de arquivo ou mensagem do Storage em erro ou log: o texto do erro do Storage traz o
// caminho. Só o CÓDIGO do erro sobe (`ErroDocs.codigo`).
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import {
  BUCKET_DOCS, LIMITE_BYTES, MIMES_ACEITOS, chaveDocs, lerRegistroDocs, normalizarMime,
  type Linha, type RegistroDocs,
} from './docsCliente';

export class ErroDocs extends Error {
  constructor(public codigo: string, public http = 502, public mensagem = 'Não consegui acessar os documentos agora. Tente de novo.') {
    super(`docs-cliente: ${codigo}`);
    this.name = 'ErroDocs';
  }
}
const codigoDe = (e: unknown): string => String((e as { code?: unknown; statusCode?: unknown; status?: unknown } | null)?.code
  ?? (e as { statusCode?: unknown } | null)?.statusCode ?? (e as { status?: unknown } | null)?.status ?? 'desconhecido');
const naoAchou = (err: unknown): boolean => {
  const e = err as { message?: unknown; statusCode?: unknown; status?: unknown } | null;
  return /not.?found/i.test(String(e?.message ?? '')) || String(e?.statusCode ?? e?.status ?? '') === '404';
};

// ── Bucket ───────────────────────────────────────────────────────────────────

const opcoesDoBucket = () => ({ public: false, fileSizeLimit: LIMITE_BYTES, allowedMimeTypes: [...MIMES_ACEITOS] });

const mesmosTipos = (a: unknown): boolean => {
  const esperado = [...MIMES_ACEITOS].sort();
  return Array.isArray(a) && a.length === esperado.length && [...a].map(String).sort().every((t, i) => t === esperado[i]);
};

let bucketOkAte = 0;
/** Para os testes. */
export function limparCacheBucketDocs(): void { bucketOkAte = 0; }

/**
 * Garante o bucket PRIVADO, com 10 MB e só jpeg, png, webp e pdf. Confere por `getBucket` (o `list()` mente sobre
 * bucket que não existe) e só cria quando o erro é claro de "não existe". Bucket PÚBLICO dá 502 (o arquivo ficaria
 * aberto a quem soubesse o caminho). Existindo SEM os limites, é atualizado; se a atualização falhar, 502.
 * O resultado bom vale 60 s: as rotas chamam isto a cada pedido.
 */
export async function garantirBucketDocs(): Promise<void> {
  if (Date.now() < bucketOkAte) return;
  const { data, error } = await supabase.storage.getBucket(BUCKET_DOCS);
  if (!error && data) {
    if (data.public) throw new ErroDocs('bucket_publico', 502, 'O depósito dos documentos está aberto ao público. Avise o suporte.');
    const limite = Number((data as { file_size_limit?: number | null }).file_size_limit);
    const tipos = (data as { allowed_mime_types?: string[] | null }).allowed_mime_types;
    if (!(limite === LIMITE_BYTES && mesmosTipos(tipos))) {
      const { error: eAtualiza } = await supabase.storage.updateBucket(BUCKET_DOCS, opcoesDoBucket());
      if (eAtualiza) throw new ErroDocs('bucket_sem_limites', 502, 'O depósito dos documentos está sem limite de tamanho e de tipo e não consegui ajustar. Avise o suporte.');
    }
    bucketOkAte = Date.now() + 60_000;
    return;
  }
  if (!error || !naoAchou(error)) throw new ErroDocs('bucket_erro');
  const { error: eCria } = await supabase.storage.createBucket(BUCKET_DOCS, opcoesDoBucket());
  if (eCria) {
    // Outra chamada pode ter criado no mesmo instante: confere de novo antes de desistir.
    const { data: de2, error: e2 } = await supabase.storage.getBucket(BUCKET_DOCS);
    if (e2 || !de2) throw new ErroDocs('bucket_nao_criou');
    if (de2.public) throw new ErroDocs('bucket_publico', 502, 'O depósito dos documentos está aberto ao público. Avise o suporte.');
  }
  bucketOkAte = Date.now() + 60_000;
}

export interface EnvioAssinado { upload_url: string; token: string }

export async function assinarEnvio(caminho: string): Promise<EnvioAssinado> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).createSignedUploadUrl(caminho);
  if (error || !data?.signedUrl) throw new ErroDocs('assinar_envio');
  return { upload_url: data.signedUrl, token: data.token };
}

export type SondaObjeto = { existe: false } | { existe: true; bytes: number; mime: string };

/** Confere o objeto NESSE caminho exato. Tamanho e tipo vêm do Storage (`info`), nunca do corpo do pedido. */
export async function sondarObjeto(caminho: string): Promise<SondaObjeto> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).info(caminho);
  if (error) {
    if (naoAchou(error)) return { existe: false };
    throw new ErroDocs('info_objeto');
  }
  if (!data) return { existe: false };
  const d = data as { size?: unknown; contentType?: unknown; metadata?: { size?: unknown; mimetype?: unknown } | null };
  const bytes = Number(d.size ?? d.metadata?.size);
  const mime = normalizarMime(d.contentType ?? d.metadata?.mimetype);
  return { existe: true, bytes: Number.isFinite(bytes) ? bytes : 0, mime };
}

/**
 * Os primeiros 16 bytes do objeto (URL assinada de 60 s + `Range`), para conferir a assinatura do arquivo contra o tipo
 * declarado: o Storage guarda o `content-type` que o navegador mandou, e isso o cliente escolhe. A URL nunca é logada.
 */
export async function lerPrimeirosBytes(caminho: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).createSignedUrl(caminho, 60);
  if (error || !data?.signedUrl) throw new ErroDocs('assinar_bytes');
  let r: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try { r = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-15' }, signal: ctrl.signal }); } finally { clearTimeout(t); }
  } catch { throw new ErroDocs('ler_bytes'); }
  if (!r.ok) throw new ErroDocs('ler_bytes');
  // Servidor que ignora o Range devolve o arquivo inteiro (no máximo 10 MB): só os 16 primeiros bytes interessam.
  return new Uint8Array(await r.arrayBuffer()).subarray(0, 16);
}

/** Baixa o objeto inteiro (leitura por IA, feita no servidor). Só o código do erro sobe; o caminho nunca. */
export async function baixarObjeto(caminho: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).download(caminho);
  if (error || !data) {
    // O erro do download não diz com segurança "não existe" (veja cadastroVendaBanco): quem decide é a sonda (`info`).
    let ausente = false;
    try { ausente = !(await sondarObjeto(caminho)).existe; } catch { /* sonda falhou: erro de armazenamento */ }
    throw new ErroDocs(ausente ? 'objeto_ausente' : 'baixar_objeto');
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Remove o objeto. Caminho que já não existe não é erro (o Storage devolve lista vazia). */
export async function removerObjeto(caminho: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET_DOCS).remove([caminho]);
  if (error && !naoAchou(error)) throw new ErroDocs('remover_objeto');
}

/** URLs assinadas de vários caminhos numa chamada. Caminho que não assinou fica de fora do mapa. */
export async function assinarVarios(caminhos: string[], segundos: number): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!caminhos.length) return mapa;
  const { data, error } = await supabase.storage.from(BUCKET_DOCS).createSignedUrls(caminhos, segundos);
  if (error || !Array.isArray(data)) throw new ErroDocs('assinar_leitura');
  for (const l of data as Array<{ path?: string | null; signedUrl?: string | null; error?: unknown }>) {
    if (l && typeof l.path === 'string' && l.signedUrl && !l.error) mapa.set(l.path, l.signedUrl);
  }
  return mapa;
}

// ── Metadados ────────────────────────────────────────────────────────────────

const POR_CONSULTA = 100;

export async function lerDocsComVersao(linha: Linha, codigo: string): Promise<{ reg: RegistroDocs; versao: string | null }> {
  const { data, error } = await supabase.from('system_state')
    .select('key, value, updated_at').eq('key', chaveDocs(linha, codigo)).maybeSingle();
  if (error) throw new ErroDocs(codigoDe(error), 502);
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  return { reg: lerRegistroDocs(l?.value), versao: l ? (l.updated_at ?? '') : null };
}

/**
 * Grava só se a linha continua igual à lida (compare-and-swap pelo `updated_at`): ler, mesclar e gravar não é atômico, e
 * dois envios no mesmo instante perderiam um deles sem erro nenhum. false = perdeu a corrida (quem chama lê de novo).
 */
export async function gravarDocs(linha: Linha, codigo: string, reg: RegistroDocs, versaoLida: string | null, agora: string): Promise<boolean> {
  const chave = chaveDocs(linha, codigo);
  if (versaoLida === null) {
    const { error } = await supabase.from('system_state').insert({ key: chave, value: reg, updated_at: agora });
    if (!error) return true;
    if (codigoDe(error) === '23505') return false;   // outra pessoa criou a linha agora
    throw new ErroDocs(codigoDe(error), 502);
  }
  const alvo = supabase.from('system_state').update({ value: reg, updated_at: agora }).eq('key', chave);
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroDocs(codigoDe(error), 502);
  return Array.isArray(data) && data.length > 0;
}

/** Vínculos de proposta das vendas pedidas (códigos em dígitos), em lotes de `.in` (nunca LIKE: o `_` é curinga). venda → proposta. */
export async function lerVinculos(codigos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const prefixo = chaveDocs('solar', '');
  for (let i = 0; i < codigos.length; i += POR_CONSULTA) {
    const lote = codigos.slice(i, i + POR_CONSULTA);
    const { data, error } = await supabase.from('system_state').select('key, value').in('key', lote.map((c) => chaveDocs('solar', c)));
    if (error) throw new ErroDocs(codigoDe(error), 502);
    for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
      const p = lerRegistroDocs(l.value).vinculo?.proposta;
      if (p && String(l.key).startsWith(prefixo)) mapa.set(String(l.key).slice(prefixo.length), p);
    }
  }
  return mapa;
}

// ── Propostas (banco do Gerador) ─────────────────────────────────────────────

export interface PropostaResumo {
  codigo: string;
  cliente_nome: string;
  cliente_cidade: string;
  vendido: boolean;
  consultor_nome: string;
  created_at: string;
}
const COLUNAS_PROPOSTA = 'codigo, cliente_nome, cliente_cidade, vendido, consultor_nome, created_at';
const resumo = (r: Record<string, unknown>): PropostaResumo => ({
  codigo: String(r.codigo ?? ''), cliente_nome: String(r.cliente_nome ?? ''), cliente_cidade: String(r.cliente_cidade ?? ''),
  vendido: !!r.vendido, consultor_nome: String(r.consultor_nome ?? ''), created_at: String(r.created_at ?? ''),
});

export async function lerPropostaResumo(codigo: string): Promise<PropostaResumo | null> {
  const { data, error } = await supabaseGerador.from('propostas').select(COLUNAS_PROPOSTA).eq('codigo', codigo).maybeSingle();
  if (error) throw new ErroDocs(codigoDe(error), 502);
  return data ? resumo(data as Record<string, unknown>) : null;
}

/**
 * O que a proposta guarda de geração e de consumo (formato do gerador): `dados.mediaMensalGerada` e `dados.geracaoAnualKwh`
 * (números), `dados.mensalKwh` (ARRAY de 12 valores de geração, um por mês) e `dados.consumoKwh` (o consumo informado no
 * dimensionamento). Só esses quatro valores (o `dados` inteiro leva o dossiê). O array vem inteiro (`->`, JSON), os outros como
 * texto (`->>`). null = a proposta não existe.
 */
export async function lerGeracaoDaProposta(codigo: string): Promise<{
  mediaMensalGerada: unknown; geracaoAnualKwh: unknown; mensalKwh: unknown; consumoKwh: unknown;
} | null> {
  const { data, error } = await supabaseGerador.from('propostas')
    .select('media:dados->>mediaMensalGerada, anual:dados->>geracaoAnualKwh, mensal:dados->mensalKwh, consumo:dados->>consumoKwh')
    .eq('codigo', codigo).maybeSingle();
  if (error) throw new ErroDocs(codigoDe(error), 502);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { mediaMensalGerada: r.media ?? null, geracaoAnualKwh: r.anual ?? null, mensalKwh: r.mensal ?? null, consumoKwh: r.consumo ?? null };
}

/** Todas as propostas vendidas. Lê em páginas: o PostgREST corta em 1000 linhas e ignora `.limit()`. */
export async function listarPropostasVendidas(): Promise<PropostaResumo[]> {
  const tudo: PropostaResumo[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabaseGerador.from('propostas').select(COLUNAS_PROPOSTA)
      .eq('vendido', true).order('created_at', { ascending: true }).order('codigo', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroDocs(codigoDe(error), 502);
    const lote = (data ?? []) as Array<Record<string, unknown>>;
    tudo.push(...lote.map(resumo));
    if (lote.length < 1000) break;
  }
  return tudo;
}
