// ─────────────────────────────────────────────────────────────────────────────
// MEU PERFIL (equipe do /gerador): WhatsApp e foto de cada consultor.
//
// O NOME NÃO SE EDITA, e nada daqui o põe em um patch. Ele é a chave de junção de
// vários lugares (`consultoresFotos[nome]` e `consultoresWhats[nome]` na página,
// o mapa dos robôs, o `vendedor_nome` dos cards, o rodízio da prospecção). Trocar
// quebra sem dar erro.
//
// ONDE GRAVA:
//  - `consultores` (banco do GERADOR), pelo mesmo cliente `supabaseGerador` que o
//    dossiê usa para gravar `propostas.dados.dossie` (dossieVenda.ts:210-227). A
//    service key desse banco não existe na Vercel, então na prática é a chave
//    publishable, que vale por uma política de UPDATE aberta: RISCO QUE JÁ EXISTE
//    (ver memória "chave do gerador"): quem tem a chave da página consegue
//    reescrever esta tabela por fora da API. A API fecha a porta que ela controla
//    (login, papel, validação); o resto depende de passar as escritas pela service key.
//  - foto: Storage do banco PRINCIPAL (service key existe), bucket público
//    `equipe-fotos`, o mesmo banco onde o Financeiro guarda comprovante.
//  - trilha: `system_state` (banco principal), chave `perfil_alteracoes`.
//
// UPDATE QUE NÃO ACHA LINHA OU É BARRADO PELA POLÍTICA volta 200 com lista vazia, sem
// erro nenhum. Por isso a gravação usa `.select()` e vazio é falha, nunca sucesso.
//
// WHATSAPP: vai direto para CLIENTE (seis serviços leem na hora). Formato gravado:
// só dígitos, com o 55 na frente (13 dígitos). Motivo: `fmtPhone` (zapiClient.ts)
// só põe o 55 quando o número NÃO começa com 55, e o DDD 55 (RS) existe; a página
// (wa.me) e `telefoneBonito`/`crmTelDisplay` também tratam um 55 inicial como país.
// Com o 55 gravado, os quatro leem certo em qualquer DDD.
//
// Nada daqui põe telefone, base64 ou caminho em log: só código de erro.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';

export const BUCKET_FOTOS = 'equipe-fotos';
export const MAX_BYTES_FOTO = Math.floor(1.5 * 1024 * 1024);
export const CHAVE_TRILHA = 'perfil_alteracoes';
export const MAX_TRILHA = 200;

export class ErroPerfil extends Error {
  constructor(public codigo: string) { super(`perfil: ${codigo}`); }
}
const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

// ── WhatsApp ─────────────────────────────────────────────────────────────────

/** Todos os DDDs do Brasil (Anatel). */
const DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export const MSG_WHATSAPP = 'Número de WhatsApp inválido. Informe um celular do Brasil com DDD, por exemplo (34) 9XXXX-XXXX.';

/** Dígitos com o 55 na frente (13), ou null se não for celular brasileiro válido. */
export function normalizarWhatsapp(entrada: unknown): string | null {
  if (typeof entrada !== 'string' || entrada.length > 40) return null;
  let d = entrada.replace(/\D/g, '');
  // 13 dígitos com 55 na frente: é o país. 11 dígitos: DDD + celular (inclusive DDD 55).
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 11) return null;
  if (!DDDS.has(d.slice(0, 2))) return null;
  if (d[2] !== '9') return null;
  // 9 digitado repetido (99999-9999) não é número de ninguém.
  if (/^(\d)\1{8}$/.test(d.slice(2))) return null;
  return `55${d}`;
}

/** Compara dois números gravados em formatos diferentes (com ou sem 55). */
export function mesmoWhatsapp(a: unknown, b: unknown): boolean {
  const n = (v: unknown): string => {
    const d = String(v ?? '').replace(/\D/g, '');
    return d.length === 13 && d.startsWith('55') ? d.slice(2) : d;
  };
  const x = n(a); const y = n(b);
  return !!x && x === y;
}

// ── consultores (banco do Gerador) ───────────────────────────────────────────

export interface Consultor { nome: string; whatsapp: string | null; foto_url: string | null }

export async function lerConsultores(): Promise<Consultor[]> {
  const { data, error } = await supabaseGerador.from('consultores').select('nome, whatsapp, foto_url').limit(200);
  if (error) throw new ErroPerfil(codigoDe(error));
  return ((data ?? []) as Array<Partial<Consultor>>)
    .filter((c) => typeof c.nome === 'string' && c.nome.trim())
    .map((c) => ({ nome: String(c.nome), whatsapp: c.whatsapp ? String(c.whatsapp) : null, foto_url: c.foto_url ? String(c.foto_url) : null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** O nome vem do e-mail (minúsculo) e na tabela tem maiúscula: compara sem caixa, EM JS.
 *  Nunca `ilike`: `_` e `%` seriam curinga. */
export function acharConsultor(lista: Consultor[], nome: string): Consultor | null {
  const alvo = String(nome ?? '').trim().toLowerCase();
  if (!alvo) return null;
  return lista.find((c) => c.nome.trim().toLowerCase() === alvo) ?? null;
}

/**
 * Grava WhatsApp e/ou foto da linha. O filtro é o nome CANÔNICO lido da tabela, e o
 * patch só pode ter estas duas chaves: o nome nunca entra. Lista vazia = falha.
 */
export async function gravarConsultor(nomeCanonico: string, patch: { whatsapp?: string; foto_url?: string }): Promise<void> {
  const corpo: { whatsapp?: string; foto_url?: string } = {};
  if (patch.whatsapp !== undefined) corpo.whatsapp = patch.whatsapp;
  if (patch.foto_url !== undefined) corpo.foto_url = patch.foto_url;
  if (!Object.keys(corpo).length) return;
  const { data, error } = await supabaseGerador.from('consultores').update(corpo).eq('nome', nomeCanonico).select('nome');
  if (error) throw new ErroPerfil(codigoDe(error));
  if (!Array.isArray(data) || data.length === 0) throw new ErroPerfil('update_sem_efeito');
}

// ── foto (Storage do banco principal) ────────────────────────────────────────

type ErroStorage = { message?: string } | null;

/** O pedaço do Storage que este módulo usa. Entra por parâmetro para o teste simular sem rede. */
export interface StorageEquipe {
  from(bucket: string): {
    upload(path: string, corpo: Buffer, opcoes: { contentType: string; upsert: boolean }): PromiseLike<{ error: ErroStorage }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
  createBucket(nome: string, opcoes: { public: boolean; fileSizeLimit: number; allowedMimeTypes?: string[] }): PromiseLike<{ error: ErroStorage }>;
  getBucket(nome: string): PromiseLike<{ data: { public?: boolean } | null; error: ErroStorage }>;
}

const storagePadrao = (): StorageEquipe => supabase.storage as unknown as StorageEquipe;

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

/** `image/jpg` não existe no registro, mas é o que muito celular manda. */
function tipoNormalizado(t: unknown): string {
  const v = String(t ?? '').toLowerCase().split(';')[0].trim();
  return v === 'image/jpg' || v === 'image/pjpeg' ? 'image/jpeg' : v;
}

/** Os primeiros bytes dizem o que o arquivo É; o tipo declarado é só o que o navegador achou. */
function assinaturaConfere(bytes: Buffer, tipo: string): boolean {
  const comeca = (...b: number[]) => bytes.length >= b.length && b.every((x, i) => bytes[i] === x);
  if (tipo === 'image/jpeg') return comeca(0xff, 0xd8, 0xff);
  if (tipo === 'image/png') return comeca(0x89, 0x50, 0x4e, 0x47);
  if (tipo === 'image/webp') {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  return false;
}

/** `Buffer.from(s, 'base64')` nunca lança: pula o caractere inválido calado. A forma é conferida antes. */
function decodificar(base64: unknown): Buffer | null {
  if (typeof base64 !== 'string') return null;
  const limpo = base64.replace(/^data:[^,]{0,100},/, '').replace(/\s+/g, '');
  if (!limpo || limpo.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpo)) return null;
  const bytes = Buffer.from(limpo, 'base64');
  return bytes.length ? bytes : null;
}

export type ErroFoto = 'tipo_nao_aceito' | 'foto_invalida' | 'foto_grande';
export interface FotoValida { bytes: Buffer; tipo: string }

/** Confere a foto SEM tocar em nada fora daqui. Roda antes de qualquer gravação. */
export function validarFoto(foto: unknown): { ok: true; foto: FotoValida } | { ok: false; erro: ErroFoto } {
  if (!foto || typeof foto !== 'object') return { ok: false, erro: 'foto_invalida' };
  const f = foto as { tipo?: unknown; base64?: unknown };
  const tipo = tipoNormalizado(f.tipo);
  if (!TIPOS_FOTO.includes(tipo)) return { ok: false, erro: 'tipo_nao_aceito' };
  // Grande demais pelo tamanho do texto: nem decodifica.
  if (typeof f.base64 === 'string' && f.base64.length > Math.ceil((MAX_BYTES_FOTO * 4) / 3) + 1024) return { ok: false, erro: 'foto_grande' };
  const bytes = decodificar(f.base64);
  if (!bytes) return { ok: false, erro: 'foto_invalida' };
  if (bytes.length > MAX_BYTES_FOTO) return { ok: false, erro: 'foto_grande' };
  if (!assinaturaConfere(bytes, tipo)) return { ok: false, erro: 'foto_invalida' };
  return { ok: true, foto: { bytes, tipo } };
}

/** Pasta no Storage: o nome da pessoa, sem acento, minúsculo, só [a-z0-9-]. */
export function pastaDoNome(nome: string): string {
  const s = String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'consultor';
}

const bucketNaoExiste = (e: ErroStorage): boolean => /not found|NoSuchBucket/i.test(String(e?.message || e || ''));
const jaExiste = (e: ErroStorage): boolean => /already exists|duplicate/i.test(String(e?.message || e || ''));

// O bucket PRECISA ser público: a URL gravada em `consultores.foto_url` é aberta pelo
// navegador sem login, e bucket privado dá imagem quebrada sem erro nenhum (o inverso
// do Financeiro, que falha fechada se ele estiver público). A existência é conferida
// por `getBucket`, nunca por `list()`, que devolve vazio para bucket inexistente.
let bucketConferido = false;

/** Para os testes: a memória do módulo faria a ordem dos testes importar. */
export function esquecerConferenciaDoBucket(): void { bucketConferido = false; }

async function garantirBucketPublico(storage: StorageEquipe): Promise<'ok' | 'privado' | 'indisponivel'> {
  if (bucketConferido) return 'ok';
  let lido: { data: { public?: boolean } | null; error: ErroStorage };
  try {
    lido = await storage.getBucket(BUCKET_FOTOS);
  } catch (err: any) {
    lido = { data: null, error: { message: String(err?.message || err) } };
  }
  if (!lido.error && lido.data) {
    if (lido.data.public !== true) {
      console.error('[perfil] o bucket equipe-fotos existe e está PRIVADO; a foto não abriria. Nada sobe até ele ficar público.');
      return 'privado';
    }
    bucketConferido = true;
    return 'ok';
  }
  if (!bucketNaoExiste(lido.error)) {
    console.error('[perfil] não consegui conferir o bucket equipe-fotos', String(lido.error?.message || '').slice(0, 80));
    return 'indisponivel';
  }
  try {
    const criado = await storage.createBucket(BUCKET_FOTOS, { public: true, fileSizeLimit: MAX_BYTES_FOTO, allowedMimeTypes: TIPOS_FOTO });
    // Duas gravações juntas no bucket que ainda não existe: uma cria, a outra recebe "já existe" e segue.
    if (criado.error && !jaExiste(criado.error)) {
      console.error('[perfil] o bucket equipe-fotos não existe e não consegui criar', String(criado.error.message || '').slice(0, 80));
      return 'indisponivel';
    }
    if (!criado.error) bucketConferido = true;   // nasceu aqui, público; se foi a outra gravação, a próxima confere por getBucket
    return 'ok';
  } catch (err: any) {
    console.error('[perfil] criar o bucket equipe-fotos lançou erro', String(err?.message || err).slice(0, 80));
    return 'indisponivel';
  }
}

export type ResultadoFoto = { ok: true; url: string } | { ok: false; erro: 'bucket_indisponivel' | 'armazenamento_falhou' };

/** Sobe a foto já validada em `<pasta>/<instante>.jpg` e devolve a URL pública. */
export async function subirFoto(
  nomeCanonico: string,
  foto: FotoValida,
  storage: StorageEquipe = storagePadrao(),
  agora: number = Date.now(),
): Promise<ResultadoFoto> {
  const bucket = await garantirBucketPublico(storage);
  if (bucket !== 'ok') return { ok: false, erro: 'bucket_indisponivel' };
  // `.jpg` fixo, como combinado: a tela reduz tudo para JPEG de 512 px. O Content-Type é o real do arquivo.
  const path = `${pastaDoNome(nomeCanonico)}/${agora}.jpg`;
  try {
    const { error } = await storage.from(BUCKET_FOTOS).upload(path, foto.bytes, { contentType: foto.tipo, upsert: false });
    if (error) {
      console.error('[perfil] upload da foto falhou', String(error.message || '').slice(0, 80));
      return { ok: false, erro: 'armazenamento_falhou' };
    }
    const url = String(storage.from(BUCKET_FOTOS).getPublicUrl(path)?.data?.publicUrl || '');
    if (!/^https:\/\//.test(url)) return { ok: false, erro: 'armazenamento_falhou' };
    return { ok: true, url };
  } catch (err: any) {
    console.error('[perfil] upload da foto lançou erro', String(err?.message || err).slice(0, 80));
    return { ok: false, erro: 'armazenamento_falhou' };
  }
}

// ── trilha (system_state, banco principal) ───────────────────────────────────

export interface Alteracao {
  em: string;
  por: string;
  alvo: string;
  campo: 'whatsapp' | 'foto';
  antes: string | null;
  depois: string | null;
}

const TENTATIVAS_TRILHA = 4;

/**
 * Acrescenta à trilha e corta nas últimas 200. Ler, acrescentar e gravar não é
 * atômico, então a gravação confere o `updated_at` lido (compare-and-swap, o mesmo
 * jeito de gestaoClientesBanco.gravarRegistro) e tenta de novo se perdeu a corrida.
 * Devolve false se não conseguiu: quem chama avisa na resposta, não engole.
 * Guarda o valor de antes e de depois de propósito: é o que permite desfazer um número errado.
 */
export async function registrarAlteracoes(itens: Alteracao[]): Promise<boolean> {
  if (!itens.length) return true;
  try {
    for (let t = 0; t < TENTATIVAS_TRILHA; t++) {
      const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', CHAVE_TRILHA).maybeSingle();
      if (error) { console.error('[perfil] trilha: leitura falhou', codigoDe(error)); return false; }
      const lido = data as { value?: unknown; updated_at?: string | null } | null;
      const atual = lido && Array.isArray(lido.value) ? (lido.value as Alteracao[]) : [];
      const novo = [...atual, ...itens].slice(-MAX_TRILHA);
      const agora = new Date().toISOString();
      if (!lido) {
        const { error: e } = await supabase.from('system_state').insert({ key: CHAVE_TRILHA, value: novo, updated_at: agora });
        if (!e) return true;
        if (codigoDe(e) === '23505') continue;   // outra pessoa criou a linha agora: lê de novo
        console.error('[perfil] trilha: gravação falhou', codigoDe(e));
        return false;
      }
      const alvo = supabase.from('system_state').update({ value: novo, updated_at: agora }).eq('key', CHAVE_TRILHA);
      const versao = lido.updated_at ?? null;
      const { data: gravou, error: e } = await (versao === null ? alvo.is('updated_at', null) : alvo.eq('updated_at', versao)).select('key');
      if (e) { console.error('[perfil] trilha: gravação falhou', codigoDe(e)); return false; }
      if (Array.isArray(gravou) && gravou.length > 0) return true;
    }
    console.error('[perfil] trilha: perdeu a corrida de gravação nas tentativas');
    return false;
  } catch (err: any) {
    console.error('[perfil] trilha lançou erro', String(err?.message || err).slice(0, 80));
    return false;
  }
}
