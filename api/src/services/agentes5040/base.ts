// ─────────────────────────────────────────────────────────────────────────────
// A BASE DAS AGENTES (B4a): quem as agentes Duda (solar) e Helena (eletroposto) seguram e que AINDA NÃO está com
// o consultor. SÓ LEITURA: este arquivo não envia nada e não escreve em nenhuma tabela. Alimenta a coluna "Base"
// do CRM do /gerador (rota GET /gerador/base-5040).
//
// Fonte: posses `ag5040` em whatsapp_sessions (lead_data.dona/estado/desde/base.estacionado_ate), cruzadas com os
// cards do produto (agendamentos, banco do Gerador) pelo telefone (DDD + 8 últimos) e com a conversa
// (wa_mensagens, lida por lerConversa: resolve LID e usa `momment`).
//
// Quem entra: posse VIVA da dona do produto cujo card mais novo do produto (por `quando`, depois `id`) não existe
// ou está cancelado/nao_atendeu. Card em qualquer outro status = o consultor já está com ele: fora.
//
// Etapas (a primeira que valer):
//   estacionado  lead_data.base.estacionado_ate está no futuro (volta_em = essa data);
//   chegou       nenhuma mensagem NOSSA (robô ou equipe) depois do `desde` da posse;
//   sem_resposta a última mensagem da conversa é nossa e já passou HORAS_SEM_RESPOSTA h sem o lead falar;
//   em_conversa  o resto. Conversa que não foi lida por inteiro (completa=false) também cai aqui: sem saber o que
//                já foi dito, não se afirma "chegou" nem "sem resposta".
// Telefone cru nunca vai para o log: o log leva só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { ErroBanco, lerPaginado } from '../gerador/caixaWhatsapp';
import { lerConversa } from './contexto';
import type { MsgConversa } from './tipos';

export type ProdutoBase = 'solar' | 'eletroposto';
export type EtapaBase = 'chegou' | 'em_conversa' | 'sem_resposta' | 'estacionado';
export type DonaBase = 'duda' | 'helena';

export const DONA_DO_PRODUTO: Record<ProdutoBase, DonaBase> = { solar: 'duda', eletroposto: 'helena' };
export const HORAS_SEM_RESPOSTA = 3;

/** Ajustáveis só pelo teste. */
export const limitesBase = { pagina: 1000, maxPaginas: 5, lote: 25, simultaneas: 5 };

export interface ItemBase {
  cardId: number | null;
  etapa: EtapaBase;
  dona: DonaBase;
  nome: string;
  telefone: string;
  cidade: string;
  desde: string | null;
  ultima_fala_em: string | null;
  volta_em: string | null;
}

export interface ResultadoBase { itens: ItemBase[]; cortou: boolean }

export interface CardDaBase {
  id: number;
  status: string | null;
  quando: string | null;
  created_by: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  cidade: string | null;
}

interface PosseLida { chave: string; dados: Record<string, unknown> }

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();
const stamp = (iso: string | null | undefined): number => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : NaN; };

/** O card é de eletroposto? A mesma regra da tela e da agenda: created_by com "eletroposto". */
export const cardEhEletroposto = (c: Pick<CardDaBase, 'created_by'>): boolean => norm(c.created_by).includes('eletroposto');

/** O card mais novo do produto: `quando` decrescente, `id` decrescente (a mesma ordem do `agRecente` da tela). */
export function cardMaisNovoDoProduto(cards: ReadonlyArray<CardDaBase>, produto: ProdutoBase): CardDaBase | null {
  const doProduto = cards.filter(c => cardEhEletroposto(c) === (produto === 'eletroposto'));
  if (!doProduto.length) return null;
  const peso = (c: CardDaBase): number => { const t = stamp(c.quando); return Number.isFinite(t) ? t : -Infinity; };
  return [...doProduto].sort((a, b) => (peso(b) - peso(a)) || (b.id - a.id) || 0)[0] ?? null;
}

/** O card ainda não está com o consultor? Sem card, cancelado ou não atendeu. */
export function cardLiberaBase(card: CardDaBase | null): boolean {
  if (!card) return true;
  const s = norm(card.status);
  return s === 'cancelado' || s === 'nao_atendeu';
}

/**
 * A etapa da posse. `msgs` = a conversa inteira em ordem do tempo (só o que conta como conversa), `completa` = a leitura não foi
 * cortada. `desde` e `estacionadoAte` são ISO (ou nulos).
 */
export function etapaDaPosse(p: {
  desde: string | null; estacionadoAte: string | null; msgs: ReadonlyArray<Pick<MsgConversa, 'from_me' | 'momment'>>;
  completa: boolean; agora: number;
}): { etapa: EtapaBase; ultima_fala_em: string | null; volta_em: string | null } {
  const ultima = p.msgs.length ? p.msgs[p.msgs.length - 1]! : null;
  const ultima_fala_em = p.completa && ultima ? ultima.momment : null;
  const ate = stamp(p.estacionadoAte);
  if (Number.isFinite(ate) && ate > p.agora) {
    return { etapa: 'estacionado', ultima_fala_em, volta_em: new Date(ate).toISOString() };
  }
  if (!p.completa) return { etapa: 'em_conversa', ultima_fala_em: null, volta_em: null };
  const d = stamp(p.desde);
  const nossaDepois = p.msgs.some(m => m.from_me && (!Number.isFinite(d) || stamp(m.momment) >= d));
  if (!nossaDepois) return { etapa: 'chegou', ultima_fala_em, volta_em: null };
  if (ultima && ultima.from_me && p.agora - stamp(ultima.momment) >= HORAS_SEM_RESPOSTA * 3600_000) {
    return { etapa: 'sem_resposta', ultima_fala_em, volta_em: null };
  }
  return { etapa: 'em_conversa', ultima_fala_em, volta_em: null };
}

/** Telefone para a tela a partir da chave de 10 dígitos: celular (começa em 6 a 9) ganha de volta o nono dígito. Com 55 na frente. */
export function telefoneDaChave(chave: string): string {
  if (!/^\d{10}$/.test(chave)) return '';
  const ddd = chave.slice(0, 2);
  const fim = chave.slice(2);
  return `55${ddd}${/^[6-9]/.test(fim) ? '9' : ''}${fim}`;
}

// ── leitura ──────────────────────────────────────────────────────────────────

async function lerPosses(dona: DonaBase): Promise<{ posses: PosseLida[]; cortou: boolean }> {
  const vistos = new Set<string>();
  const posses: PosseLida[] = [];
  for (let p = 0; p < limitesBase.maxPaginas; p++) {
    const de = p * limitesBase.pagina;
    const { data, error } = await supabase.from('whatsapp_sessions')
      .select('phone, lead_data')
      .eq('tipo', 'ag5040').eq('lead_data->>dona', dona).eq('lead_data->>estado', 'viva')
      .order('phone', { ascending: true })
      .range(de, de + limitesBase.pagina - 1);
    if (error) throw new ErroBanco(String((error as { code?: string }).code ?? 'desconhecido'));
    const lote = (data ?? []) as Array<{ phone: string | null; lead_data: unknown }>;
    for (const l of lote) {
      const chave = chaveContato(l.phone);
      const ld = l.lead_data;
      if (!chave || vistos.has(chave) || !ld || typeof ld !== 'object' || Array.isArray(ld)) continue;
      vistos.add(chave);
      posses.push({ chave, dados: ld as Record<string, unknown> });
    }
    if (lote.length < limitesBase.pagina) return { posses, cortou: false };
  }
  return { posses, cortou: true };
}

/** Os cards (todos os produtos) das chaves, em lotes: um `or` de ilike pelos 8 últimos dígitos; o DDD é conferido em código. */
async function lerCardsDasChaves(chaves: string[]): Promise<Map<string, CardDaBase[]>> {
  const porChave = new Map<string, CardDaBase[]>();
  for (let i = 0; i < chaves.length; i += limitesBase.lote) {
    const lote = chaves.slice(i, i + limitesBase.lote);
    const filtro = lote.map(c => `cliente_telefone.ilike.*${c.slice(-8)}`).join(',');
    const { linhas } = await lerPaginado<CardDaBase>((de, ate) =>
      supabaseGerador.from('agendamentos')
        .select('id, status, quando, created_by, cliente_nome, cliente_telefone, cidade')
        .or(filtro).order('id', { ascending: true }).range(de, ate) as any, 3, limitesBase.pagina);
    const quer = new Set(lote);
    for (const c of linhas) {
      const k = chaveContato(c.cliente_telefone);
      if (!k || !quer.has(k)) continue;
      const lista = porChave.get(k) ?? [];
      lista.push(c);
      porChave.set(k, lista);
    }
  }
  return porChave;
}

async function emLotes<T, R>(itens: T[], simultaneas: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async (): Promise<void> => {
    while (proximo < itens.length) { const i = proximo++; out[i] = await fn(itens[i]!); }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneas, itens.length) }, trabalhador));
  return out;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A lista da coluna Base de um produto. Erro de banco LANÇA (a rota responde 500 genérico, sem detalhe). */
export async function listarBase(produto: ProdutoBase, agora: number = Date.now()): Promise<ResultadoBase> {
  const dona = DONA_DO_PRODUTO[produto];
  const { posses, cortou } = await lerPosses(dona);
  if (!posses.length) return { itens: [], cortou };
  const cards = await lerCardsDasChaves(posses.map(p => p.chave));

  // Quem tem card que o consultor já segura sai antes de ler a conversa (a leitura é a parte cara).
  const candidatas = posses
    .map(p => ({ p, card: cardMaisNovoDoProduto(cards.get(p.chave) ?? [], produto) }))
    .filter(x => cardLiberaBase(x.card));

  const itens = await emLotes(candidatas, limitesBase.simultaneas, async ({ p, card }): Promise<ItemBase> => {
    const desde = texto(p.dados.desde) || null;
    const base = (p.dados.base && typeof p.dados.base === 'object' && !Array.isArray(p.dados.base))
      ? p.dados.base as Record<string, unknown> : {};
    const conv = await lerConversa(p.chave);
    const e = etapaDaPosse({
      desde, estacionadoAte: texto(base.estacionado_ate) || null, msgs: conv.msgs, completa: conv.completa, agora,
    });
    const tel = String(card?.cliente_telefone ?? '').replace(/\D/g, '');
    return {
      cardId: card ? card.id : null,
      etapa: e.etapa,
      dona,
      nome: texto(card?.cliente_nome) || texto(p.dados.nome),
      telefone: tel || telefoneDaChave(p.chave),
      cidade: texto(card?.cidade) || texto(p.dados.cidade),
      desde,
      ultima_fala_em: e.ultima_fala_em,
      volta_em: e.volta_em,
    };
  });

  // Mais recente primeiro (a última fala; sem ela, a chegada).
  const quando = (i: ItemBase): number => { const t = stamp(i.ultima_fala_em ?? i.desde); return Number.isFinite(t) ? t : 0; };
  itens.sort((a, b) => quando(b) - quando(a));
  return { itens, cortou };
}
