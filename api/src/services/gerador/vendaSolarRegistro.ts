// ─────────────────────────────────────────────────────────────────────────────
// REGISTRO "CÓDIGO -> CARD" (fase 2, 22/10/2026). Cada código dado pelo alocador do servidor (`vendaSolarCodigo.ts`) ganha UMA linha
// em `system_state`, chave `<prefixo da série><dígitos>` (solar: `codigo_solar:0065`), valor { codigo, card, por, em, origem, sig }.
//
// SEM dado pessoal: só o código, o id do card, quem pediu, quando e de onde veio o número ('novo' ou 'trello'). A chave pública do
// banco principal lê e pode escrever naquela tabela: por isso cada registro é ASSINADO (HMAC-SHA256 com o mesmo segredo das
// ligações), e registro sem assinatura válida é ignorado (o código dele vira só um número a PULAR, nunca um número ocupado).
//
// SÉRIE: o formato do código, o prefixo da chave e a trava são parâmetros (`SerieCodigo`), com o padrão da série solar `#NNNN`.
// Outra série (ex.: `#E001`) usa o mesmo módulo com a sua própria `SerieCodigo`.
//
// Serviço: NÃO importa rota (ciclo de boot em CommonJS). Nada daqui põe valor em log além do código do erro.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { ErroHub, segredoDoVinculo } from './vendaSolarHub';

/** Uma série de códigos: como o código se escreve, onde o registro mora e qual trava serializa a numeração. */
export interface SerieCodigo {
  /** Prefixo da chave do registro em `system_state` (ex.: `codigo_solar:`). */
  prefixoChave: string;
  /** Trava global da numeração desta série (`cadastro_trava:<trava>`). */
  trava: string;
  /** O código completo; o grupo 1 são os dígitos (que vão na chave). */
  reCodigo: RegExp;
  /** Número -> código (ex.: 65 -> `#0065`). */
  formatar: (n: number) => string;
  /** Maior número da série. */
  maximo: number;
}

/** A série solar: `#NNNN`, chave `codigo_solar:NNNN`, a MESMA trava do número da fase 1. */
export const SERIE_SOLAR: SerieCodigo = {
  prefixoChave: 'codigo_solar:',
  trava: 'trello_numero_solar',
  reCodigo: /^#(\d{4})$/,
  formatar: (n: number) => `#${String(n).padStart(4, '0')}`,
  maximo: 9999,
};

export const PREFIXO_CODIGO_SOLAR = SERIE_SOLAR.prefixoChave;
export type OrigemCodigo = 'novo' | 'trello';
export interface RegistroCodigo { codigo: string; card: number; por: string; em: string; origem: OrigemCodigo }

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

/** O número do código na série, ou null se o código não é desta série. */
export function numeroDoCodigo(codigo: unknown, serie: SerieCodigo = SERIE_SOLAR): number | null {
  const m = serie.reCodigo.exec(String(codigo ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** `#0065` -> `codigo_solar:0065` (na série pedida). */
export function chaveCodigoSolar(codigo: string, serie: SerieCodigo = SERIE_SOLAR): string {
  const m = serie.reCodigo.exec(String(codigo ?? '').trim());
  if (!m) throw new ErroHub('codigo_invalido');
  return `${serie.prefixoChave}${m[1]}`;
}

/** O código de uma chave bem formada da série, ou null. */
export function codigoDaChaveSolar(chave: string, serie: SerieCodigo = SERIE_SOLAR): string | null {
  const k = String(chave ?? '');
  if (!k.startsWith(serie.prefixoChave)) return null;
  const d = k.slice(serie.prefixoChave.length);
  if (!/^\d+$/.test(d)) return null;
  const codigo = serie.formatar(Number(d));
  const m = serie.reCodigo.exec(codigo);
  return m && m[1] === d ? codigo : null;
}

/**
 * HMAC do registro. O prefixo `codigo|` o separa da assinatura da ligação (que começa pelo número do card), e o prefixo da chave da
 * SÉRIE impede que a assinatura de uma série valha em outra. null sem segredo.
 */
export function assinarRegistro(r: RegistroCodigo, serie: SerieCodigo = SERIE_SOLAR): string | null {
  const segredo = segredoDoVinculo();
  if (!segredo) return null;
  return crypto.createHmac('sha256', segredo)
    .update(`codigo|${serie.prefixoChave}|${r.codigo}|${r.card}|${r.por}|${r.em}|${r.origem}`).digest('hex');
}

/**
 * O registro do `value` do banco SE ele é bem formado, bate com a chave e a assinatura confere; senão null. Sem segredo no ambiente
 * nenhum vale.
 */
export function registroAssinado(chave: string, value: unknown, serie: SerieCodigo = SERIE_SOLAR): RegistroCodigo | null {
  const codigoDaChave = codigoDaChaveSolar(chave, serie);
  if (!codigoDaChave || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.codigo !== 'string' || v.codigo !== codigoDaChave) return null;
  if (typeof v.card !== 'number' || !Number.isInteger(v.card) || v.card <= 0) return null;
  if (typeof v.por !== 'string' || v.por.length > 60) return null;
  if (typeof v.em !== 'string' || v.em.length > 40) return null;
  if (v.origem !== 'novo' && v.origem !== 'trello') return null;
  const r: RegistroCodigo = { codigo: v.codigo, card: v.card, por: v.por, em: v.em, origem: v.origem };
  const esperada = assinarRegistro(r, serie);
  if (!esperada || typeof v.sig !== 'string' || v.sig.length !== esperada.length) return null;
  return crypto.timingSafeEqual(Buffer.from(v.sig, 'utf8'), Buffer.from(esperada, 'utf8')) ? r : null;
}

const jaLogados = new Set<string>();
/** Para os testes: esquece quais códigos já tiveram o aviso de assinatura inválida. */
export function reiniciarLogsDoRegistro(): void { jaLogados.clear(); }
function logaInvalido(codigo: string): void {
  if (jaLogados.has(codigo)) return;
  jaLogados.add(codigo);
  console.error('[venda-solar] registro de código sem assinatura válida, ignorado', 'sig_invalida');
}

/**
 * Todos os registros da série. `validos`: código -> registro assinado. `naoAssinados`: códigos de chave bem formada cujo valor não
 * vale (injetado, adulterado, segredo trocado): são números a PULAR, nunca números ocupados. Lê em páginas de 1000 (o PostgREST
 * corta e ignora `.limit()`); no LIKE o `_` é curinga, então o `startsWith` descarta o excesso.
 */
export async function lerRegistrosDeCodigos(serie: SerieCodigo = SERIE_SOLAR): Promise<{ validos: Map<string, RegistroCodigo>; naoAssinados: Set<string> }> {
  const validos = new Map<string, RegistroCodigo>();
  const naoAssinados = new Set<string>();
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${serie.prefixoChave}%`).order('key', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroHub(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const k = String(l.key);
      if (!k.startsWith(serie.prefixoChave)) continue;
      const codigo = codigoDaChaveSolar(k, serie);
      if (!codigo) continue;
      const r = registroAssinado(k, l.value, serie);
      if (r) validos.set(codigo, r);
      else { naoAssinados.add(codigo); logaInvalido(codigo); }
    }
    if (lote.length < 1000) break;
  }
  return { validos, naoAssinados };
}

/**
 * O registro de UM código em TRÊS estados: `ausente` (não há linha), `valido` (assinado) ou `invalido` (há linha, mas a assinatura
 * não confere: injetada, adulterada ou segredo trocado). Quem decide acesso trata `invalido` como código do alocador (nega na
 * dúvida). Erro de banco lança `ErroHub`.
 */
export type EstadoDoRegistro = { estado: 'ausente' } | { estado: 'valido'; registro: RegistroCodigo } | { estado: 'invalido' };
export async function lerEstadoDoRegistro(codigo: string, serie: SerieCodigo = SERIE_SOLAR): Promise<EstadoDoRegistro> {
  if (numeroDoCodigo(codigo, serie) === null) return { estado: 'ausente' };
  const chave = chaveCodigoSolar(codigo, serie);
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', chave).maybeSingle();
  if (error) throw new ErroHub(codigoDe(error));
  const l = data as { value?: unknown } | null;
  if (!l) return { estado: 'ausente' };
  const r = registroAssinado(chave, l.value, serie);
  if (r) return { estado: 'valido', registro: r };
  logaInvalido(String(codigo).trim());
  return { estado: 'invalido' };
}

/** O registro de UM código, ou null se não existe ou não vale. Erro de banco lança `ErroHub`. */
export async function lerRegistroDoCodigo(codigo: string, serie: SerieCodigo = SERIE_SOLAR): Promise<RegistroCodigo | null> {
  const e = await lerEstadoDoRegistro(codigo, serie);
  return e.estado === 'valido' ? e.registro : null;
}

/**
 * O código ligado a ESTE card é (ou pode ser) do alocador? Sim quando o registro é válido e do card, ou quando existe com assinatura
 * inválida (na dúvida, nega). Erro de banco lança.
 */
export async function codigoDoAlocadorDoCard(codigo: string, cardId: number): Promise<boolean> {
  const e = await lerEstadoDoRegistro(codigo);
  return e.estado === 'invalido' || (e.estado === 'valido' && e.registro.card === cardId);
}

/**
 * Cria o registro (INSERT, nunca sobrescreve). `'ocupado'` quando a chave já existe (23505). Sem segredo: `ErroHub('sem_segredo')`;
 * outro erro: `ErroHub(código)`.
 */
export async function inserirRegistro(r0: RegistroCodigo, serie: SerieCodigo = SERIE_SOLAR): Promise<'ok' | 'ocupado'> {
  // O mesmo limite da leitura: um login longo não pode gravar um registro que nunca valida.
  const r: RegistroCodigo = { ...r0, por: String(r0.por ?? '').slice(0, 60) };
  const sig = assinarRegistro(r, serie);
  if (!sig) throw new ErroHub('sem_segredo');
  const value = { codigo: r.codigo, card: r.card, por: r.por, em: r.em, origem: r.origem, sig };
  const { error } = await supabase.from('system_state').insert({ key: chaveCodigoSolar(r.codigo, serie), value, updated_at: r.em });
  if (!error) return 'ok';
  if (codigoDe(error) === '23505') return 'ocupado';
  throw new ErroHub(codigoDe(error));
}

/** Apaga o registro de um código (compensação do alocador, ou o número de uma venda desfeita que volta a ficar livre). */
export async function apagarRegistro(codigo: string, serie: SerieCodigo = SERIE_SOLAR): Promise<void> {
  const { error } = await supabase.from('system_state').delete().eq('key', chaveCodigoSolar(codigo, serie));
  if (error) throw new ErroHub(codigoDe(error));
}
