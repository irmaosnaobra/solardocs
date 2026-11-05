import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';

// Imagens do portfólio da proposta Completa: fotos de obras, logos de empresas atendidas
// e marcas de bancos parceiros. Ficam no bucket privado `documentos`, em
// portfolio/{userId}/{tipo}/{timestamp}-{aleatório}.{ext}, e a proposta guarda o `path`.
// A URL que vai para o HTML é sempre assinada AQUI, na geração (renovarUrlsPortfolio):
// o Puppeteer roda no servidor, então URL vinda do cliente nunca entra no template.

const BUCKET = 'documentos';
const CINCO_ANOS_S = 5 * 365 * 24 * 3600;
const MAX_BYTES = 3 * 1024 * 1024;
// 3 MB em base64 são ~4,2 milhões de caracteres. Acima disso nem decodifica.
const MAX_DATAURL_CHARS = Math.ceil(MAX_BYTES * 4 / 3) + 128;

const TIPOS = ['obra', 'empresa', 'banco'] as const;
type TipoPortfolio = (typeof TIPOS)[number];

const uploadSchema = z.object({
  tipo: z.enum(TIPOS),
  dataUrl: z.string().min(1),
});

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

// O mime declarado tem que bater com os primeiros bytes do arquivo: um HTML ou um SVG
// com o cabeçalho trocado não vira "imagem" no bucket.
function bateComAssinatura(mime: string, b: Buffer): boolean {
  if (mime === 'jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
}

export async function uploadPortfolioImagem(req: Request, res: Response): Promise<void> {
  const parsed = uploadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados da imagem inválidos. Informe o tipo e a imagem.' });
    return;
  }
  const { tipo, dataUrl } = parsed.data;

  if (dataUrl.length > MAX_DATAURL_CHARS) {
    res.status(400).json({ error: 'A imagem é grande demais. O limite é 3 MB.' });
    return;
  }
  const m = DATA_URL.exec(dataUrl);
  if (!m) {
    res.status(400).json({ error: 'Formato de imagem não aceito. Envie JPEG, PNG ou WebP.' });
    return;
  }
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_BYTES) {
    res.status(400).json({ error: 'A imagem é grande demais. O limite é 3 MB.' });
    return;
  }
  if (!bateComAssinatura(m[1], buffer)) {
    res.status(400).json({ error: 'O arquivo não é uma imagem válida.' });
    return;
  }

  const path = `portfolio/${req.userId}/${tipo}/${Date.now()}-${randomBytes(5).toString('hex')}.${EXT[m[1]]}`;
  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: `image/${m[1]}`, upsert: false });
    if (upErr) throw upErr;
    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, CINCO_ANOS_S);
    if (signErr || !signed?.signedUrl) throw signErr ?? new Error('sem URL assinada');
    res.json({ path, url: signed.signedUrl });
  } catch (err) {
    logger.error('portfolio', 'upload da imagem do portfólio falhou', err);
    res.status(500).json({ error: 'Não foi possível enviar a imagem agora. Tente novamente em instantes.' });
  }
}

// ─── Reassinatura na geração ─────────────────────────────────────────────────

export const LIMITE_FOTOS_OBRAS = 6;
export const LIMITE_EMPRESAS = 12;
export const LIMITE_BANCOS = 8;
const MAX_TEXTO = 80;

const NOME_ARQUIVO = /^\d+-[a-f0-9]{6,}\.(jpg|png|webp)$/;

export function pathDoUsuario(path: unknown, userId: string, tipo: TipoPortfolio): path is string {
  if (typeof path !== 'string' || path.length > 200) return false;
  const partes = path.split('/');
  return partes.length === 4
    && partes[0] === 'portfolio'
    && partes[1] === userId
    && partes[2] === tipo
    && NOME_ARQUIVO.test(partes[3]);
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_TEXTO).trim() : '';
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Assina de uma vez os paths do bucket. Nunca lança: se o storage falhar devolve o mapa vazio
 * (o item fica sem `url` e o template não o desenha). Associa pelo path, nunca pela posição.
 */
export async function assinarPaths(paths: string[]): Promise<Map<string, string>> {
  const assinadas = new Map<string, string>();
  if (!paths.length) return assinadas;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, CINCO_ANOS_S);
    if (error) throw error;
    for (const r of data ?? []) {
      if (r && r.path && r.signedUrl && !r.error && /^https:\/\//.test(r.signedUrl)) assinadas.set(r.path, r.signedUrl);
    }
  } catch (err) {
    logger.error('portfolio', 'falha assinando as imagens do portfólio; a proposta sai sem elas', err);
  }
  return assinadas;
}

/**
 * Fotos de obras da empresa (company.fotos_obras): fica só o que é path DESTE usuário em
 * portfolio/{userId}/obra/, no máximo 6, legenda aparada em 80. O resto é descartado.
 */
export function sanitizarFotosObras(userId: string, v: unknown): Array<{ path: string; legenda?: string }> {
  const out: Array<{ path: string; legenda?: string }> = [];
  if (!Array.isArray(v)) return out;
  for (const it of v.slice(0, 60)) {
    if (out.length >= LIMITE_FOTOS_OBRAS) break;
    if (!ehObjeto(it) || !pathDoUsuario(it.path, userId, 'obra')) continue;
    const legenda = texto(it.legenda);
    out.push({ path: it.path, ...(legenda ? { legenda } : {}) });
  }
  return out;
}

/** Mesma lista, cada item com a `url` assinada agora (sem `url` se a assinatura falhar). */
export async function fotosObrasComUrl(userId: string, v: unknown): Promise<Array<{ path: string; legenda?: string; url?: string }>> {
  const lista = sanitizarFotosObras(userId, v);
  const assinadas = await assinarPaths(lista.map((i) => i.path));
  return lista.map((i) => {
    const url = assinadas.get(i.path);
    return url ? { ...i, url } : { ...i };
  });
}

type ItemBanco = { nome: string; path?: string; url?: string };

/**
 * Devolve uma cópia de `fields` com as galerias da proposta Completa limpas e com URL nova.
 * - Só fica item cujo `path` é deste usuário e do tipo certo; o resto sai.
 * - O `url` que veio do cliente é ignorado: a URL é sempre assinada aqui (evita SSRF no Puppeteer).
 * - Se a assinatura falhar, o item continua salvo (path e texto) mas sem `url`; o template não o desenha.
 * - Banco sem `path` fica só com o nome.
 * - Chave ausente continua ausente; sem galeria nenhuma, `fields` volta como veio.
 */
export async function renovarUrlsPortfolio(userId: string, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const temObras = 'fotos_obras' in fields;
  const temEmpresas = 'empresas_atendidas' in fields;
  const temBancos = 'bancos_parceiros' in fields;
  if (!temObras && !temEmpresas && !temBancos) return fields;

  // Itens inválidos saem antes de contar o limite; só se lê até 60 entradas de cada lista.
  const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 60) : []);

  const obras: Array<{ path: string; legenda?: string }> = [];
  for (const it of lista(fields.fotos_obras)) {
    if (obras.length >= LIMITE_FOTOS_OBRAS) break;
    if (!ehObjeto(it) || !pathDoUsuario(it.path, userId, 'obra')) continue;
    const legenda = texto(it.legenda);
    obras.push({ path: it.path, ...(legenda ? { legenda } : {}) });
  }
  const empresas: Array<{ path: string; nome?: string }> = [];
  for (const it of lista(fields.empresas_atendidas)) {
    if (empresas.length >= LIMITE_EMPRESAS) break;
    if (!ehObjeto(it) || !pathDoUsuario(it.path, userId, 'empresa')) continue;
    const nome = texto(it.nome);
    empresas.push({ path: it.path, ...(nome ? { nome } : {}) });
  }
  const bancos: Array<{ nome: string; path?: string }> = [];
  for (const it of lista(fields.bancos_parceiros)) {
    if (bancos.length >= LIMITE_BANCOS) break;
    if (!ehObjeto(it)) continue;
    const nome = texto(it.nome);
    const temPath = it.path !== undefined && it.path !== null && it.path !== '';
    if (temPath) {
      if (!pathDoUsuario(it.path, userId, 'banco')) continue;
      bancos.push({ nome, path: it.path });
    } else if (nome) {
      bancos.push({ nome });
    }
  }

  // Uma só chamada para todas as imagens. O resultado é associado pelo path, nunca pela posição.
  const paths = Array.from(new Set([...obras, ...empresas, ...bancos].map((i) => ('path' in i ? i.path : undefined)).filter((p): p is string => !!p)));
  const assinadas = await assinarPaths(paths);

  // O item limpo (path do próprio usuário e texto) vai para o dados_json MESMO sem URL: se o storage
  // falhar agora, a galeria não some das próximas propostas (o kit vem da última). Só a `url` fica de
  // fora, e item sem URL não aparece no PDF (o template descarta).
  const comUrl = <T extends { path: string }>(o: T): T & { url?: string } => {
    const url = assinadas.get(o.path);
    return url ? { ...o, url } : { ...o };
  };
  const out: Record<string, unknown> = { ...fields };
  if (temObras) out.fotos_obras = obras.map(comUrl);
  if (temEmpresas) out.empresas_atendidas = empresas.map(comUrl);
  if (temBancos) {
    out.bancos_parceiros = bancos.map((b): ItemBanco => {
      if (!b.path) return { nome: b.nome };
      const url = assinadas.get(b.path);
      return url ? { nome: b.nome, path: b.path, url } : { nome: b.nome, path: b.path };
    });
  }
  return out;
}
