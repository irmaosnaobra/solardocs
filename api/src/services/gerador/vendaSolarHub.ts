// ─────────────────────────────────────────────────────────────────────────────
// HUB DA VENDA SOLAR (20/10/2026): o CARD VENDIDO é o centro (chave = id do card, como no eletroposto). Antes o card solar não
// tinha ligação com a proposta (de onde vem o dossiê de homologação) nem com a venda da planilha mãe (`gestao_cliente:<NNNN>`).
//
// A ligação mora em `system_state`, chave `venda_solar:<id do card>`, valor { proposta, venda, por, em }. SEM dado pessoal:
// só o código da proposta, o código da venda (`#NNNN`), quem ligou e quando. A chave pública do banco principal lê aquela tabela.
//
// Módulo de acesso a dados e regras puras. NÃO importa rota (ciclo de boot em CommonJS): quem precisa da planilha passa os dados.
// Nada daqui põe valor pessoal em log: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import type { CardVendido } from './fichaEletroposto';
import { nomeSimples } from './solarObras';

export const PREFIXO_VENDA_SOLAR = 'venda_solar:';
export const chaveVendaSolar = (card: number): string => `${PREFIXO_VENDA_SOLAR}${card}`;
/**
 * Trava dos vínculos. UMA só para todos os cards: "uma proposta (ou venda) só pode estar ligada a UM card" é uma regra entre
 * cards, e uma trava por card não serializa dois cards disputando a mesma proposta.
 */
export const TRAVA_VINCULOS = 'vendasolar_vinculos';

export class ErroHub extends Error {
  constructor(public codigo: string) { super(`venda-solar-hub: ${codigo}`); this.name = 'ErroHub'; }
}
const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

// ── Cache em memória (por instância) ─────────────────────────────────────────
// A lista de propostas vendidas e a leitura da planilha são pesadas e o GET de vínculos as pede a cada abertura de card: ficam
// 60 s em memória. Falha NÃO entra no cache. `invalidarCachesHub()` roda quando um vínculo é gravado. A leitura das ligações
// (`venda_solar:%`) NÃO passa por aqui: ela segue direto no banco, dentro da trava quando é para decidir unicidade.
export const TTL_CACHE_HUB_MS = 60_000;
const cacheHub = new Map<string, { ts: number; valor: Promise<unknown> }>();

export function comCacheHub<T>(chave: string, ler: () => Promise<T>): Promise<T> {
  const c = cacheHub.get(chave);
  if (c && Date.now() - c.ts < TTL_CACHE_HUB_MS) return c.valor as Promise<T>;
  const valor = ler();
  const entrada = { ts: Date.now(), valor };
  cacheHub.set(chave, entrada);
  valor.catch(() => { if (cacheHub.get(chave) === entrada) cacheHub.delete(chave); });
  return valor;
}
export function invalidarCachesHub(): void { cacheHub.clear(); }

// ── Card ─────────────────────────────────────────────────────────────────────

const COLUNAS_CARD = 'id, cliente_nome, cliente_telefone, cidade, vendedor_nome, created_by, status, created_at';

/** É venda SOLAR pelo card: `fechou` e a origem (`created_by`) NÃO é de eletroposto. */
export function ehCardSolarVendido(c: Partial<CardVendido> | null | undefined): c is CardVendido {
  return !!c && Number.isInteger(c.id) && (c.id as number) > 0
    && String(c.status ?? '').trim().toLowerCase() === 'fechou'
    && !ehOrigemEletroposto(c.created_by);
}

/** O card vendido solar, ou null se não existe, não está `fechou` ou é de eletroposto (as três coisas são iguais para quem pede). */
export async function lerCardSolarVendido(id: number): Promise<CardVendido | null> {
  const { data, error } = await supabaseGerador.from('agendamentos').select(COLUNAS_CARD).eq('id', id).maybeSingle();
  if (error) throw new ErroHub(codigoDe(error));
  const c = data as unknown as CardVendido | null;
  return ehCardSolarVendido(c) ? c : null;
}

// ── Ligação ──────────────────────────────────────────────────────────────────

/**
 * `trello_card` (21/10/2026): o id do cartão do Trello criado ou achado para este card (24 hex). Opcional: ligação antiga não tem.
 * Entra na assinatura SÓ quando existe, para as ligações já gravadas continuarem valendo.
 */
export interface Ligacao { proposta: string | null; venda: string | null; por: string; em: string; trello_card?: string | null }
export const ligacaoVazia = (): Ligacao => ({ proposta: null, venda: null, por: '', em: '' });

/** Quem gravou a ligação só para guardar o cartão do Trello (nenhuma proposta nem venda ligada, nenhuma decisão de gente). */
export const POR_TRELLO = 'trello';
/** A ligação existe só por causa do Trello: o vínculo automático por telefone ainda vale, como se a chave nunca tivesse sido gravada. */
export const ligacaoSoDoTrello = (l: Ligacao): boolean => !l.proposta && !l.venda && l.por === POR_TRELLO;

// ── Assinatura ───────────────────────────────────────────────────────────────
// A chave pública do banco principal alcança o `system_state` e pode ESCREVER nele. Cada ligação gravada leva `sig`, o HMAC-SHA256
// (hex) de `card|proposta|venda|por|em`, e na leitura ligação sem `sig` válida é IGNORADA (como se não existisse): senão uma linha
// injetada daria a um consultor o acesso ao card e ao dossiê. O segredo é `VINCULO_SOLAR_SECRET`; sem ele, deriva da chave de
// serviço do banco principal com um rótulo fixo. NUNCA o `JWT_SECRET`. Sem segredo nenhum, a ligação não grava e nenhuma vale.
export const ROTULO_SEGREDO_VINCULO = 'vinculo-solar-v1';

/** O segredo das assinaturas, ou null quando o ambiente não tem nenhum. Lido a cada chamada. */
export function segredoDoVinculo(): Buffer | null {
  const proprio = (process.env.VINCULO_SOLAR_SECRET ?? '').trim();
  if (proprio) return Buffer.from(proprio, 'utf8');
  const servico = (process.env.SUPABASE_SERVICE_KEY ?? '').trim();
  return servico ? crypto.createHmac('sha256', servico).update(ROTULO_SEGREDO_VINCULO).digest() : null;
}

/** A assinatura da ligação deste card, ou null sem segredo. */
export function assinarLigacao(card: number, l: Ligacao): string | null {
  const segredo = segredoDoVinculo();
  if (!segredo) return null;
  // `|trello:<id>` só quando há cartão: a ligação sem ele assina exatamente o texto de antes (as já gravadas seguem válidas).
  const trello = l.trello_card ? `|trello:${l.trello_card}` : '';
  return crypto.createHmac('sha256', segredo).update(`${card}|${l.proposta ?? ''}|${l.venda ?? ''}|${l.por}|${l.em}${trello}`).digest('hex');
}

/** A `sig` guardada confere com a ligação deste card? Sem segredo ou sem `sig`: não. */
export function assinaturaConfere(card: number, l: Ligacao, sig: unknown): boolean {
  const esperada = assinarLigacao(card, l);
  if (!esperada || typeof sig !== 'string' || sig.length !== esperada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8'));
}

/** O que o banco guarda: a ligação mais a `sig`. Lança `ErroHub('sem_segredo')` se o ambiente não tem segredo. */
function comAssinatura(card: number, l: Ligacao): Ligacao & { sig: string } {
  const sig = assinarLigacao(card, l);
  if (!sig) throw new ErroHub('sem_segredo');
  return { ...l, sig };
}

const RE_PROPOSTA = /^[A-Za-z0-9._-]{1,40}$/;
const RE_VENDA = /^#\d{4,6}$/;
/** Id de cartão do Trello: 24 caracteres hexadecimais. */
export const RE_ID_TRELLO = /^[0-9a-f]{24}$/;

/** O `value` do banco pode vir torto (a chave pública lê a tabela): só entra proposta e venda de formato válido. */
export function lerLigacaoBruta(value: unknown): Ligacao {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    proposta: typeof v.proposta === 'string' && RE_PROPOSTA.test(v.proposta) ? v.proposta : null,
    venda: typeof v.venda === 'string' && RE_VENDA.test(v.venda) ? v.venda : null,
    por: typeof v.por === 'string' ? v.por.slice(0, 60) : '',
    em: typeof v.em === 'string' ? v.em.slice(0, 40) : '',
    // A chave só existe quando há cartão (ligação sem cartão tem o mesmo formato de antes).
    ...(typeof v.trello_card === 'string' && RE_ID_TRELLO.test(v.trello_card) ? { trello_card: v.trello_card } : {}),
  };
}

const jaLogadas = new Set<number>();
/** Para os testes: esquece quais cards já tiveram o aviso de assinatura inválida. */
export function reiniciarLogsDoHub(): void { jaLogadas.clear(); }

/**
 * A ligação do `value` do banco SE a assinatura confere; senão null. Registro sem `sig` válida (injetado, adulterado, ou sem
 * segredo no ambiente) é ignorado, com um log sem dado pessoal (só o código).
 */
export function ligacaoAssinada(card: number, value: unknown): Ligacao | null {
  const lig = lerLigacaoBruta(value);
  const sig = value && typeof value === 'object' ? (value as { sig?: unknown }).sig : undefined;
  if (assinaturaConfere(card, lig, sig)) return lig;
  // Uma vez por card por instância: o GET de vínculos lê isso a cada abertura e o log não pode virar enxurrada.
  if (!jaLogadas.has(card)) {
    jaLogadas.add(card);
    console.error('[venda-solar] ligação sem assinatura válida, ignorada', 'sig_invalida');
  }
  return null;
}

/**
 * A ligação de um card. `existe: false` = a chave NUNCA foi gravada (nem para desligar): é a única hora do vínculo automático.
 * Ligação sem assinatura válida conta como inexistente (e o vínculo automático pode regravá-la, já assinada).
 */
export async function lerLigacao(card: number): Promise<{ lig: Ligacao; existe: boolean }> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', chaveVendaSolar(card)).maybeSingle();
  if (error) throw new ErroHub(codigoDe(error));
  const l = data as { value?: unknown } | null;
  const lig = l ? ligacaoAssinada(card, l.value) : null;
  return lig ? { lig, existe: true } : { lig: ligacaoVazia(), existe: false };
}

/** Todas as ligações (card -> ligação). Lê em páginas: o PostgREST corta em 1000 e ignora `.limit()`. No LIKE o `_` é curinga (casa a mais): o `startsWith` descarta o excesso. */
export async function lerTodasLigacoes(): Promise<Map<number, Ligacao>> {
  const mapa = new Map<number, Ligacao>();
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${PREFIXO_VENDA_SOLAR}%`).order('key', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroHub(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const k = String(l.key);
      if (!k.startsWith(PREFIXO_VENDA_SOLAR)) continue;
      const id = Number(k.slice(PREFIXO_VENDA_SOLAR.length));
      if (!Number.isInteger(id) || id <= 0) continue;
      const lig = ligacaoAssinada(id, l.value);
      if (lig) mapa.set(id, lig);
    }
    if (lote.length < 1000) break;
  }
  return mapa;
}

/** Grava (cria ou troca) a ligação, ASSINADA. Quem chama está dentro da `TRAVA_VINCULOS`. Sem segredo no ambiente: `ErroHub('sem_segredo')`. */
export async function gravarLigacao(card: number, lig: Ligacao): Promise<void> {
  const value = comAssinatura(card, lig);
  const { error } = await supabase.from('system_state').upsert(
    { key: chaveVendaSolar(card), value, updated_at: lig.em || new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (error) throw new ErroHub(codigoDe(error));
}

/** Os cards (que não `card`) que já usam essa proposta ou essa venda. */
export function quemUsa(todas: ReadonlyMap<number, Ligacao>, card: number, tipo: 'proposta' | 'venda', codigo: string): number | null {
  for (const [id, l] of todas) if (id !== card && l[tipo] === codigo) return id;
  return null;
}

// ── Candidatos (telefone e nome) ─────────────────────────────────────────────

/** Os últimos 8 dígitos do telefone (casa com ou sem DDI/DDD/9). '' = telefone curto demais para casar. */
export function ultimos8(tel: unknown): string {
  const d = String(tel ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : '';
}

export type MotivoCandidato = 'telefone' | 'nome';
export interface CandidatoProposta { codigo: string; cliente: string; cidade: string; kwp: number | null; data: string; motivo: MotivoCandidato }
export interface CandidatoVenda { codigo: string; cliente: string; data: string; motivo: MotivoCandidato }

/** O telefone só em dígitos, sem o 55 do país (quando sobram 10 ou 11 dígitos). */
export function telefoneNacional(tel: unknown): string {
  const d = String(tel ?? '').replace(/\D/g, '');
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d;
}

/**
 * Como dois telefones se parecem. 'forte': os DOIS têm DDD (10 ou 11 dígitos) e o DDD e os 8 últimos dígitos batem (o nono dígito
 * não atrapalha). 'fraca': um dos lados não tem DDD e só os 8 últimos batem: vale como SUGESTÃO, nunca para ligar sozinho.
 * null: não casa (inclusive DDD diferente, ou número curto demais).
 */
export type ForcaTelefone = 'forte' | 'fraca' | null;
export function compararTelefones(a: unknown, b: unknown): ForcaTelefone {
  const [na, nb] = [telefoneNacional(a), telefoneNacional(b)];
  if (na.length < 8 || nb.length < 8 || na.slice(-8) !== nb.slice(-8)) return null;
  const comDdd = (t: string): boolean => t.length === 10 || t.length === 11;
  if (comDdd(na) && comDdd(nb)) return na.slice(0, 2) === nb.slice(0, 2) ? 'forte' : null;
  return 'fraca';
}

/** Mesmo consultor (nome sem acento e em minúscula, como na posse). Vazio nunca é igual. */
export const mesmoConsultor = (a: unknown, b: unknown): boolean => {
  const [x, y] = [nomeSimples(a), nomeSimples(b)];
  return !!x && x === y;
};

/** Uma proposta vendida de solar com o que o vínculo precisa. `telefones`: `dados.telefoneDigitos` e `dados.telefone` (os dois, como no `admin.ts`). */
export interface PropostaVendida { codigo: string; cliente: string; cidade: string; kwp: number | null; data: string; consultor: string; telefones: string[] }

/**
 * TODAS as propostas vendidas que não são de eletroposto (`tipo` nulo vale solar), com os telefones. Lê em páginas (o PostgREST corta
 * em 1000 e ignora `.limit()`). Quem chama guarda o resultado 60 s (`comCacheHub`): o casamento por telefone e por nome é feito em
 * memória, sem LIKE no banco.
 */
export async function listarVendidasParaVinculo(): Promise<PropostaVendida[]> {
  const saida: PropostaVendida[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabaseGerador.from('propostas')
      .select('codigo, cliente_nome, cliente_cidade, kwp, created_at, consultor_nome, tipo, tel:dados->>telefoneDigitos, tel2:dados->>telefone')
      .eq('vendido', true)
      .order('created_at', { ascending: true }).order('codigo', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroHub(codigoDe(error));
    const lote = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const r of lote) {
      if (String(r.tipo ?? 'solar').toLowerCase() === 'eletroposto') continue;
      const kwp = Number(r.kwp);
      saida.push({
        codigo: String(r.codigo ?? ''), cliente: String(r.cliente_nome ?? ''), cidade: String(r.cliente_cidade ?? ''),
        kwp: Number.isFinite(kwp) && kwp > 0 ? kwp : null, data: String(r.created_at ?? '').slice(0, 10), consultor: String(r.consultor_nome ?? ''),
        telefones: [r.tel, r.tel2].map((t) => String(t ?? '')).filter(Boolean),
      });
    }
    if (lote.length < 1000) break;
  }
  return saida;
}
