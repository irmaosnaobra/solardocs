// ── COMPROVANTES DO FINANCEIRO POR CLIENTE ──────────────────────────────────
//
// Bucket PRIVADO `financeiro-clientes`, no Supabase PRINCIPAL (service role).
// Não é o `dossie-vendas` nem o cliente `supabaseGerador`: a chave de serviço do
// Gerador não existe em produção, e sem ela não se cria bucket nem se assina url.
//
// Nada daqui escreve em log o base64, o nome do arquivo ou o caminho: só código
// de erro e o id do card.

import { createHash, randomUUID } from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { diaDeBrasilia } from '../agenda/viradaDoDia';
import { MAX_BYTES_ARQUIVO, MAX_NOME_ARQUIVO, type ArquivoLancamento } from './financeiroCliente';

const LOG = 'gerador-financeiro';
export const BUCKET_FINANCEIRO = 'financeiro-clientes';

type ErroStorage = { message?: string } | null;

/** O pedaço do Storage que este módulo usa. Entra por parâmetro para o teste
 *  simular sem rede. */
export interface StorageFinanceiro {
  from(bucket: string): {
    upload(path: string, corpo: Buffer, opcoes: { contentType: string; upsert: boolean }): PromiseLike<{ error: ErroStorage }>;
    createSignedUrl(path: string, segundos: number): PromiseLike<{ data: { signedUrl?: string } | null; error: ErroStorage }>;
    download(path: string): PromiseLike<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: ErroStorage }>;
  };
  createBucket(nome: string, opcoes: { public: boolean; fileSizeLimit: number }): PromiseLike<{ error: ErroStorage }>;
  getBucket(nome: string): PromiseLike<{ data: { public?: boolean } | null; error: ErroStorage }>;
}

const storagePadrao = (): StorageFinanceiro => supabase.storage as unknown as StorageFinanceiro;

const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
const HEIC = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];

/** `image/jpg` não existe no registro, mas é o que muito celular manda. */
export function normalizarTipo(mediaType: unknown): string {
  const t = String(mediaType ?? '').toLowerCase().split(';')[0].trim();
  return t === 'image/jpg' || t === 'image/pjpeg' ? 'image/jpeg' : t;
}

/** Os primeiros bytes dizem o que o arquivo É. O tipo declarado é só o que o
 *  navegador achou, e um `.exe` renomeado chega aqui como `image/png`. */
export function assinaturaConfere(bytes: Buffer, tipo: string): boolean {
  const comeca = (...b: number[]) => bytes.length >= b.length && b.every((x, i) => bytes[i] === x);
  switch (tipo) {
    case 'application/pdf': return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/jpeg': return comeca(0xff, 0xd8, 0xff);
    case 'image/png': return comeca(0x89, 0x50, 0x4e, 0x47);
    case 'image/webp':
      return bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
}

/** `Buffer.from(s, 'base64')` NUNCA lança: pula o caractere inválido calado e
 *  devolve lixo. Por isso a forma é conferida antes de decodificar. */
function decodificar(base64: unknown): Buffer | null {
  if (typeof base64 !== 'string') return null;
  // Tolera o prefixo de data URL (o FileReader do navegador entrega assim) e quebra de linha.
  const limpo = base64.replace(/^data:[^,]{0,100},/, '').replace(/\s+/g, '');
  if (!limpo || limpo.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) return null;
  const bytes = Buffer.from(limpo, 'base64');
  return bytes.length ? bytes : null;
}

export function caminhoEhDoCard(path: unknown, cardId: number): boolean {
  return typeof path === 'string' && path.startsWith(`fin/${cardId}/`) && !path.includes('..');
}

export type ErroUpload =
  | 'tipo_nao_aceito' | 'heic_nao_suportado' | 'arquivo_invalido' | 'arquivo_grande'
  | 'bucket_indisponivel' | 'armazenamento_falhou';

export type ComprovanteSubido = ArquivoLancamento & { bytes: Buffer };

const bucketNaoExiste = (e: ErroStorage): boolean => /not found|NoSuchBucket/i.test(String(e?.message || e || ''));

// ── O bucket é PRIVADO? ──────────────────────────────────────────────────────
// Criar privado quando não existe não basta: se alguém criou o bucket público
// no painel, por engano, todo comprovante fica aberto a quem tiver o caminho.
// Antes do primeiro upload de cada instância o bucket é lido; público, ou
// impossível de conferir, nada sobe (falha fechada). Passou uma vez, fica
// guardado na memória do módulo para não repetir a chamada a cada upload.
let bucketConferido = false;

/** Para os testes: a memória do módulo faria a ordem dos testes importar. */
export function esquecerConferenciaDoBucket(): void { bucketConferido = false; }

type Conferencia = 'privado' | 'nao_existe' | 'publico' | 'indeterminado';

async function conferirBucket(storage: StorageFinanceiro, cardId: number): Promise<Conferencia> {
  if (bucketConferido) return 'privado';
  let lido: { data: { public?: boolean } | null; error: ErroStorage };
  try {
    lido = await storage.getBucket(BUCKET_FINANCEIRO);
  } catch (err: any) {
    lido = { data: null, error: { message: String(err?.message || err) } };
  }
  if (lido.error || !lido.data) {
    if (bucketNaoExiste(lido.error)) return 'nao_existe';
    logger.error(LOG, 'não consegui conferir se o bucket do financeiro é privado; nada sobe', { card: cardId, erro: String(lido.error?.message || '') });
    return 'indeterminado';
  }
  if (lido.data.public !== false) {
    logger.error(LOG, 'o bucket do financeiro está PÚBLICO; nada sobe até ele voltar a ser privado', { card: cardId });
    return 'publico';
  }
  bucketConferido = true;
  return 'privado';
}

/**
 * Confere e sobe UM comprovante.
 *
 * O caminho é `fin/<cardId>/<AAAAMM>/<uuid>.<ext>`: o nome que veio do usuário
 * nunca entra nele (fica só em `nome`, para mostrar na tela).
 *
 * TENTA PRIMEIRO, cria o bucket depois, e só UMA vez. Não se pergunta ao
 * Storage se o bucket existe: `list()` em bucket inexistente devolve vazio sem
 * erro, igual a bucket vazio.
 */
export async function subirComprovante(
  cardId: number,
  entrada: { base64: unknown; media_type: unknown; nome?: unknown },
  storage: StorageFinanceiro = storagePadrao(),
  agora: Date = new Date(),
): Promise<{ ok: true; arquivo: ComprovanteSubido } | { ok: false; erro: ErroUpload }> {
  const tipo = normalizarTipo(entrada.media_type);
  if (HEIC.includes(tipo)) return { ok: false, erro: 'heic_nao_suportado' };
  const ext = EXTENSAO[tipo];
  if (!ext) return { ok: false, erro: 'tipo_nao_aceito' };

  // Grande demais já pelo tamanho do texto: nem decodifica.
  if (typeof entrada.base64 === 'string' && entrada.base64.length > Math.ceil((MAX_BYTES_ARQUIVO * 4) / 3) + 1024) {
    return { ok: false, erro: 'arquivo_grande' };
  }
  const bytes = decodificar(entrada.base64);
  if (!bytes) return { ok: false, erro: 'arquivo_invalido' };
  if (bytes.length > MAX_BYTES_ARQUIVO) return { ok: false, erro: 'arquivo_grande' };
  if (!assinaturaConfere(bytes, tipo)) return { ok: false, erro: 'arquivo_invalido' };

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const mes = diaDeBrasilia(agora).slice(0, 7).replace('-', '');
  const path = `fin/${cardId}/${mes}/${randomUUID()}.${ext}`;
  const nome = (typeof entrada.nome === 'string' ? entrada.nome.trim() : '').slice(0, MAX_NOME_ARQUIVO) || `comprovante.${ext}`;

  const conferencia = await conferirBucket(storage, cardId);
  if (conferencia === 'publico' || conferencia === 'indeterminado') return { ok: false, erro: 'bucket_indisponivel' };

  const subir = () => storage.from(BUCKET_FINANCEIRO).upload(path, bytes, { contentType: tipo, upsert: false });
  try {
    let { error } = await subir();
    if (error && bucketNaoExiste(error)) {
      const criado = await storage.createBucket(BUCKET_FINANCEIRO, { public: false, fileSizeLimit: MAX_BYTES_ARQUIVO });
      // Duas subidas ao mesmo tempo no bucket que ainda não existe: uma cria, a
      // outra recebe "já existe". As duas seguem.
      if (criado.error && !/already exists|duplicate/i.test(String(criado.error.message || ''))) {
        logger.error(LOG, 'bucket do financeiro não existe e não consegui criar', { card: cardId, erro: String(criado.error.message || '') });
        return { ok: false, erro: 'bucket_indisponivel' };
      }
      // Nasceu aqui, privado: está conferido. Se foi a outra subida que criou
      // ("já existe"), a próxima confere pelo getBucket.
      if (!criado.error) bucketConferido = true;
      ({ error } = await subir());
    }
    if (error) {
      logger.error(LOG, 'upload do comprovante falhou', { card: cardId, erro: String(error.message || '') });
      return { ok: false, erro: 'armazenamento_falhou' };
    }
  } catch (err: any) {
    logger.error(LOG, 'upload do comprovante lançou erro', { card: cardId, erro: String(err?.message || err) });
    return { ok: false, erro: 'armazenamento_falhou' };
  }
  return { ok: true, arquivo: { path, nome, tipo, tamanho: bytes.length, sha256, bytes } };
}

/** URL assinada, ou null se falhar (a tela mostra o lançamento sem o link). */
export async function assinarComprovante(
  path: string,
  segundos = 3600,
  storage: StorageFinanceiro = storagePadrao(),
): Promise<string | null> {
  try {
    const { data, error } = await storage.from(BUCKET_FINANCEIRO).createSignedUrl(path, segundos);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** Os bytes de um comprovante já guardado, ou null. */
export async function baixarComprovante(
  path: string,
  storage: StorageFinanceiro = storagePadrao(),
): Promise<Buffer | null> {
  try {
    const { data, error } = await storage.from(BUCKET_FINANCEIRO).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}
