// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 1 (05/11/2026): leitura e gravação do ESTADO das etapas.
//
//   - Estado das etapas ... `system_state`, chave `jornada_solar:<id do card>`, valor ASSINADO por HMAC (a chave pública do banco
//     principal lê e escreve aquela tabela). Nada pessoal, nenhum texto livre e nenhum dinheiro. Escrita com compare-and-swap pelo
//     `updated_at`, igual ao `gravarDocs`.
//   - Dinheiro e texto livre ... JSON PRIVADO no bucket `cadastros-venda`, `vendasolar/<id>.jornada.json` (trava `jornada:<id>`).
//
// Serviço: NÃO importa rota. Nada aqui põe valor pessoal em log: só o código.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { segredoDoVinculo } from './vendaSolarHub';
import { nomeSimples } from './solarObras';
import { lerJsonBruto, gravarJsonBruto, comTrava } from './cadastroVendaBanco';
import {
  ACOES_HISTORICO, FALHAS_NUMERO, FORMAS_PAGAMENTO, MOTIVOS_ESPERA,
  type AcaoHistorico, type EstadoJornada, type FalhaNumero, type FormaPagamento, type MotivoEspera, type PapelGerado, type PrivadoJornada,
} from './jornadaSolar';

export const PREFIXO_JORNADA = 'jornada_solar:';
export const chaveJornada = (card: number): string => `${PREFIXO_JORNADA}${card}`;

export class ErroJornada extends Error {
  constructor(public codigo: string) { super(`jornada-solar: ${codigo}`); this.name = 'ErroJornada'; }
}
const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

// ── Normalização (chaves escritas à mão, em TODO nível, na ordem do contrato) ────────────────────────────────────────
// A coluna `value` é jsonb e o Postgres guarda as chaves de objeto em OUTRA ordem. A assinatura é sobre o JSON do objeto normalizado,
// montado aqui sempre na mesma ordem: lido de qualquer jeito, o normalizado sai igual. Nada de espalhamento (`...`) do valor de
// entrada e `null` no lugar de `undefined`.

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const nome = (v: unknown): string => nomeSimples(txt(v, 60)).slice(0, 60);
const dataIso = (v: unknown): string | null => {
  const t = txt(v, 40);
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(t) ? t : null;
};
const ymd = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const inteiro = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

function etapaBase(v: unknown): { aberta_em: string | null; concluida_em: string | null; concluida_por: string } {
  const o = obj(v) ?? {};
  return { aberta_em: dataIso(o.aberta_em), concluida_em: dataIso(o.concluida_em), concluida_por: nome(o.concluida_por) };
}
function papel(v: unknown): PapelGerado | null {
  const o = obj(v);
  const em = o ? dataIso(o.gerado_em) : null;
  return o && em ? { gerado_em: em, por: nome(o.por) } : null;
}

export function normalizarJornada(card: number, value: unknown): EstadoJornada | null {
  const o = obj(value);
  if (!o || o.v !== 1 || !Number.isInteger(card) || card <= 0 || o.card !== card) return null;
  const et = obj(o.etapas) ?? {};
  const e1 = obj(et['1']) ?? {};
  const e2 = obj(et['2']) ?? {};
  const pp = obj(e2.papeis) ?? {};
  const e3 = obj(et['3']) ?? {};
  const e4 = obj(et['4']) ?? {};
  const b1 = etapaBase(e1);
  const b2 = etapaBase(e2);
  const b3 = etapaBase(e3);

  const rat = obj(e3.rateio);
  const ratEm = rat ? dataIso(rat.conferido_em) : null;
  const ratMarca = rat && typeof rat.marca === 'string' && /^[0-9a-f]{16}$/.test(rat.marca) ? rat.marca : null;
  const prot = obj(e3.protocolo);
  const protNum = prot && typeof prot.numero === 'string' && /^[A-Za-z0-9./-]{1,40}$/.test(prot.numero) ? prot.numero : null;
  const protEm = prot ? ymd(prot.em) : null;
  const tre = obj(e3.trello);
  const treUrl = tre && typeof tre.url === 'string' && /^https:\/\/trello\.com\/c\/[A-Za-z0-9]{6,12}$/.test(tre.url) ? tre.url : null;
  const treEm = tre ? dataIso(tre.criado_em) : null;

  const esp = obj(o.esperando);
  const espMotivo = esp && MOTIVOS_ESPERA.includes(esp.motivo as MotivoEspera) ? esp.motivo as MotivoEspera : null;
  const espAte = esp ? ymd(esp.ate) : null;
  const espEtapa = esp ? inteiro(esp.etapa, 1, 3) : null;
  const espEm = esp ? dataIso(esp.em) : null;
  const can = obj(o.cancelada);
  const canEm = can ? dataIso(can.em) : null;
  const canEtapa = can ? inteiro(can.etapa, 1, 9) : null;
  const num = obj(o.numero) ?? {};

  const hist: EstadoJornada['historico'] = [];
  for (const h of Array.isArray(o.historico) ? o.historico : []) {
    const ho = obj(h);
    const em = ho ? dataIso(ho.em) : null;
    if (!ho || !em || !ACOES_HISTORICO.includes(ho.acao as AcaoHistorico)) continue;
    hist.push({ em, por: nome(ho.por), acao: ho.acao as AcaoHistorico, etapa: inteiro(ho.etapa, 1, 9) });
  }

  return {
    v: 1,
    card,
    origem: o.origem === 'leitura' ? 'leitura' : 'vendido',
    vendido_em: dataIso(o.vendido_em),
    vendido_por: nome(o.vendido_por),
    vendedor: nome(o.vendedor),
    etapas: {
      1: { aberta_em: b1.aberta_em, concluida_em: b1.concluida_em, concluida_por: b1.concluida_por, excedente: e1.excedente === 'sim' ? 'sim' : e1.excedente === 'nao' ? 'nao' : null },
      2: {
        aberta_em: b2.aberta_em, concluida_em: b2.concluida_em, concluida_por: b2.concluida_por,
        papeis: { contrato: papel(pp.contrato), procuracao: papel(pp.procuracao), recibo: papel(pp.recibo) },
      },
      3: {
        aberta_em: b3.aberta_em, concluida_em: b3.concluida_em, concluida_por: b3.concluida_por,
        rateio: rat && ratEm && ratMarca ? { conferido_em: ratEm, por: nome(rat.por), marca: ratMarca } : null,
        protocolo: prot && protNum && protEm ? { numero: protNum, em: protEm } : null,
        engenheiro: e3.engenheiro === 'pago' ? 'pago' : e3.engenheiro === 'a_pagar' ? 'a_pagar' : null,
        trello: tre && treUrl && treEm ? { url: treUrl, criado_em: treEm, por: nome(tre.por) } : null,
      },
      4: { aberta_em: dataIso(e4.aberta_em) },
    },
    esperando: esp && espMotivo && espAte && espEtapa && espEm
      ? { motivo: espMotivo, ate: espAte, etapa: espEtapa as 1 | 2 | 3, em: espEm, por: nome(esp.por) } : null,
    cancelada: can && canEm && canEtapa ? { em: canEm, por: nome(can.por), etapa: canEtapa, com_numero: can.com_numero === true } : null,
    numero: {
      tentado_em: dataIso(num.tentado_em),
      falha: FALHAS_NUMERO.includes(num.falha as FalhaNumero) ? num.falha as FalhaNumero : null,
      nasceu_em: dataIso(num.nasceu_em),
    },
    historico: hist.slice(-50),
  };
}

// ── Assinatura ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** HMAC de `jornada|card|JSON` do objeto normalizado (sem `sig`), ou null sem segredo. */
export function assinarJornada(card: number, e: EstadoJornada): string | null {
  const segredo = segredoDoVinculo();
  if (!segredo) return null;
  const n = normalizarJornada(card, e);
  if (!n) return null;
  return crypto.createHmac('sha256', segredo).update(`jornada|${card}|${JSON.stringify(n)}`).digest('hex');
}

const jaLogadas = new Set<number>();
/** Para os testes. */
export function reiniciarLogsDaJornada(): void { jaLogadas.clear(); }

/** O estado do `value` do banco SE a assinatura confere; senão null (e um log único por card, só o código). */
export function jornadaAssinada(card: number, value: unknown): EstadoJornada | null {
  const n = normalizarJornada(card, value);
  const sig = obj(value)?.sig;
  const esperada = n ? assinarJornada(card, n) : null;
  if (n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8'))) return n;
  if (!jaLogadas.has(card)) {
    jaLogadas.add(card);
    console.error('[jornada-solar] estado sem assinatura válida, ignorado', 'sig_invalida');
  }
  return null;
}

// ── Leitura e gravação com compare-and-swap ─────────────────────────────────────────────────────────────────────────────

/** `versao`: null = a linha não existe; '' = existe sem `updated_at`; senão o `updated_at`. Linha com assinatura inválida: estado null, mas com a versão dela. */
export async function lerJornadaComVersao(card: number): Promise<{ estado: EstadoJornada | null; versao: string | null }> {
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chaveJornada(card)).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  if (!l) return { estado: null, versao: null };
  return { estado: jornadaAssinada(card, l.value), versao: l.updated_at ?? '' };
}

/** true = gravou; false = perdeu a corrida (quem chama lê de novo). */
export async function gravarJornada(card: number, e: EstadoJornada, versaoLida: string | null, agora: string): Promise<boolean> {
  const n = normalizarJornada(card, e);
  const sig = n ? assinarJornada(card, n) : null;
  if (!n || !sig) throw new ErroJornada('sem_segredo');
  const value = { ...n, sig };
  const chave = chaveJornada(card);
  if (versaoLida === null) {
    const { error } = await supabase.from('system_state').insert({ key: chave, value, updated_at: agora });
    if (!error) return true;
    if (codigoDe(error) === '23505') return false;
    throw new ErroJornada(codigoDe(error));
  }
  const alvo = supabase.from('system_state').update({ value, updated_at: agora }).eq('key', chave);
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroJornada(codigoDe(error));
  return Array.isArray(data) && data.length > 0;
}

/** Todos os estados válidos (card -> estado). Lê em páginas de 1000; no LIKE o `_` é curinga, então o `startsWith` descarta o excesso. */
export async function lerTodasJornadas(): Promise<Map<number, EstadoJornada>> {
  const mapa = new Map<number, EstadoJornada>();
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${PREFIXO_JORNADA}%`).order('key', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const k = String(l.key);
      if (!k.startsWith(PREFIXO_JORNADA)) continue;
      const id = Number(k.slice(PREFIXO_JORNADA.length));
      if (!Number.isInteger(id) || id <= 0) continue;
      const e = jornadaAssinada(id, l.value);
      if (e) mapa.set(id, e);
    }
    if (lote.length < 1000) break;
  }
  return mapa;
}

export type Recusa = { recusa: string; http: number; extra?: Record<string, unknown> };
export const ehRecusa = (x: unknown): x is Recusa => !!x && typeof x === 'object' && typeof (x as { recusa?: unknown }).recusa === 'string';

/**
 * Lê com versão, monta (`base()` quando não há estado), aplica `fn` e grava. Até 4 voltas; perdeu as 4: `ErroJornada('ocupado')`.
 * `fn` devolve o estado novo ou uma recusa (nada grava).
 */
export async function mudarJornada(
  card: number, base: () => EstadoJornada, fn: (e: EstadoJornada) => EstadoJornada | Recusa,
): Promise<EstadoJornada | Recusa> {
  if (!segredoDoVinculo()) throw new ErroJornada('sem_segredo');
  for (let t = 0; t < 4; t++) {
    const { estado, versao } = await lerJornadaComVersao(card);
    const atual = estado ?? base();
    const novo = fn(normalizarJornada(card, atual) ?? atual);
    if (ehRecusa(novo)) return novo;
    const n = normalizarJornada(card, novo);
    if (!n) throw new ErroJornada('formato');
    if (await gravarJornada(card, n, versao, new Date().toISOString())) return n;
  }
  throw new ErroJornada('ocupado');
}

// ── O JSON privado (dinheiro e texto livre) ────────────────────────────────────────────────────────────────────────────

export const caminhoPrivadoJornada = (card: number): string => `vendasolar/${card}.jornada.json`;
export const privadoVazio = (): PrivadoJornada => ({ v: 1, venda: null, cancelamento: null, descancelamentos: [], trazidas: [] });

export const MAX_NOTA = 500;
export const MAX_PRAZO = 200;

export function normalizarPrivado(value: unknown): PrivadoJornada {
  const o = obj(value);
  if (!o || o.v !== 1) return privadoVazio();
  const v = obj(o.venda);
  let venda: PrivadoJornada['venda'] = null;
  if (v) {
    const valor = inteiro(v.valor_centavos, 0, 10_000_000_000) ?? 0;
    const pagamento: NonNullable<PrivadoJornada['venda']>['pagamento'] = [];
    for (const p of Array.isArray(v.pagamento) ? v.pagamento.slice(0, 6) : []) {
      const po = obj(p);
      const forma = po && FORMAS_PAGAMENTO.includes(po.forma as FormaPagamento) ? po.forma as FormaPagamento : null;
      const pv = po ? inteiro(po.valor_centavos, 1, 10_000_000_000) : null;
      if (po && forma && pv) pagamento.push({ forma, valor_centavos: pv, obs: txt(po.obs, 60) });
    }
    const editado: NonNullable<PrivadoJornada['venda']>['editado'] = [];
    for (const ed of Array.isArray(v.editado) ? v.editado : []) {
      const eo = obj(ed);
      const em = eo ? dataIso(eo.em) : null;
      if (!eo || !em) continue;
      editado.push({ em, por: nome(eo.por), campos: (Array.isArray(eo.campos) ? eo.campos : []).filter((c): c is string => typeof c === 'string').map((c) => txt(c, 30)).slice(0, 10) });
    }
    venda = {
      valor_centavos: valor,
      pagamento,
      desconto_centavos: inteiro(v.desconto_centavos, 0, 10_000_000_000),
      prazo_prometido: txt(v.prazo_prometido, MAX_PRAZO),
      nota: txt(v.nota, MAX_NOTA),
      kit_confirmado: v.kit_confirmado === true,
      combinado_por: nome(v.combinado_por),
      combinado_em: dataIso(v.combinado_em) ?? '',
      editado: editado.slice(-30),
    };
  }
  const motivoDe = (x: unknown): { motivo: string; em: string; por: string } | null => {
    const xo = obj(x);
    const em = xo ? dataIso(xo.em) : null;
    const motivo = xo ? txt(xo.motivo, 300) : '';
    return xo && em && motivo.length >= 3 ? { motivo, em, por: nome(xo.por) } : null;
  };
  return {
    v: 1,
    venda,
    cancelamento: motivoDe(o.cancelamento),
    descancelamentos: (Array.isArray(o.descancelamentos) ? o.descancelamentos : []).map(motivoDe).filter((x): x is NonNullable<ReturnType<typeof motivoDe>> => !!x).slice(-10),
    trazidas: (Array.isArray(o.trazidas) ? o.trazidas : []).map(motivoDe).filter((x): x is NonNullable<ReturnType<typeof motivoDe>> => !!x).slice(-10),
  };
}

/** O JSON privado da obra, ou null quando o objeto não existe. Qualquer outra falha lança. */
export async function lerPrivadoJornada(card: number): Promise<PrivadoJornada | null> {
  const bruto = await lerJsonBruto(caminhoPrivadoJornada(card));
  return bruto === null ? null : normalizarPrivado(bruto);
}

/** Lê, aplica e grava o JSON privado dentro da trava `jornada:<card>`. */
export async function mudarPrivadoJornada(
  card: number, por: string, fn: (p: PrivadoJornada) => PrivadoJornada,
): Promise<PrivadoJornada> {
  return comTrava(`jornada:${card}`, por, async () => {
    const lido = await lerJsonBruto(caminhoPrivadoJornada(card));
    const novo = normalizarPrivado(fn(lido === null ? privadoVazio() : normalizarPrivado(lido)));
    await gravarJsonBruto(caminhoPrivadoJornada(card), novo);
    return novo;
  });
}

