// ─────────────────────────────────────────────────────────────────────────────
// QUEM JÁ COMPROU (24/10/2026). A conta de compra do lead do quiz do SolarDoc, num lugar só: o tick de
// desistência do B1 e o robô da Carla casam a compra do MESMO jeito (o quiz não coleta e-mail, então e-mail não casa):
//   1. `sales.attribution_session_id` = o `lp_session` gravado no lead;
//   2. `sales.phone` com a mesma chave do contato (DDD + 8 últimos): Stripe e Asaas;
//   3. `users.whatsapp` com plano que não é 'free': cobre o Pix por comprovante e quem já era cliente.
// Erro de leitura LANÇA: quem chama não avisa nem envia.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { chaveDoContato } from '../chefe/destinos';
import { variantesDaChave } from '../gerador/caixaWhatsapp';
import { JANELA_MAX_MS } from './recuperacaoCarlaRegras';

interface VendaLinha { phone?: string | null; attribution_session_id?: string | null }

export interface VendasRecentes { sessoes: Set<string>; chaves: Set<string> }

/** Quem comprou: sessões e chaves de telefone das vendas recentes do ledger. */
export async function vendasRecentes(agora: number): Promise<VendasRecentes> {
  const sessoes = new Set<string>();
  const chaves = new Set<string>();
  const desde = new Date(agora - JANELA_MAX_MS - 3600_000).toISOString();
  const { data, error } = await supabase.from('sales').select('phone, attribution_session_id').gte('created_at', desde).limit(2000);
  if (error) throw new Error(`ler vendas: ${error.message}`);
  for (const v of (data ?? []) as VendaLinha[]) {
    if (v.attribution_session_id) sessoes.add(String(v.attribution_session_id));
    const k = chaveDoContato(v.phone);
    if (k) chaves.add(k);
  }
  return { sessoes, chaves };
}

/** Já tem plano pago com este número? (cobre o Pix por comprovante.) Erro sobe: na dúvida, ninguém é avisado. */
export async function temPlanoPago(chave: string): Promise<boolean> {
  const variantes = variantesDaChave(chave);
  if (!variantes.length) return false;
  const { data, error } = await supabase.from('users').select('id').in('whatsapp', variantes).neq('plano', 'free').limit(1);
  if (error) throw new Error(`ler users: ${error.message}`);
  return (data ?? []).length > 0;
}

/** O lead comprou? `lp` é o lp_session gravado; `chave` é DDD + 8 últimos. Erro sobe. */
export async function comprouLead(vendas: VendasRecentes, lp: string, chave: string): Promise<boolean> {
  if ((lp && vendas.sessoes.has(lp)) || vendas.chaves.has(chave)) return true;
  return temPlanoPago(chave);
}

// ── só leitura, para a tela do /gerador (26/10/2026) ─────────────────────────
// As funções acima não mudam. Esta lê a MESMA tabela e as MESMAS duas chaves de casamento, mas com a data da venda e uma janela
// que o chamador escolhe (a tela olha até 180 dias; o robô olha 48 h), para a tela poder escrever "Sim, em 26/10".

export interface VendasComData { sessoes: Map<string, string>; chaves: Map<string, string>; truncada: boolean }

/** O PostgREST entrega no máximo 1000 linhas por pedido e ignora um `.limit()` maior: lê-se por páginas de 1000. */
export const PAGINA_VENDAS = 1000;
export const PAGINAS_VENDAS_MAX = 5;

/**
 * Vendas do ledger desde `desdeMs`, com a data da primeira venda de cada sessão e de cada telefone. Erro de leitura LANÇA.
 * Lê até 5 páginas de 1000 (`.range()`, do mais novo ao mais antigo, com o id para desempatar) e para na primeira página incompleta.
 * Se as 5 vierem cheias pode haver venda mais antiga sem ler: `truncada` fica true.
 */
export async function vendasDesde(desdeMs: number): Promise<VendasComData> {
  const sessoes = new Map<string, string>();
  const chaves = new Map<string, string>();
  const desde = new Date(desdeMs).toISOString();
  let truncada = false;
  const linhas: Array<VendaLinha & { created_at?: string | null }> = [];
  for (let pagina = 0; pagina < PAGINAS_VENDAS_MAX; pagina++) {
    const de = pagina * PAGINA_VENDAS;
    const { data, error } = await supabase.from('sales').select('phone, attribution_session_id, created_at')
      .gte('created_at', desde).order('created_at', { ascending: false }).order('id', { ascending: false }).range(de, de + PAGINA_VENDAS - 1);
    if (error) throw new Error(`ler vendas: ${error.message}`);
    const lote = (data ?? []) as Array<VendaLinha & { created_at?: string | null }>;
    linhas.push(...lote);
    if (lote.length < PAGINA_VENDAS) break;
    if (pagina === PAGINAS_VENDAS_MAX - 1) truncada = true;
  }
  // Do mais novo para o mais antigo: a última escrita é a primeira venda.
  for (const v of linhas) {
    const quando = String(v.created_at ?? '');
    if (v.attribution_session_id) sessoes.set(String(v.attribution_session_id), quando);
    const k = chaveDoContato(v.phone);
    if (k) chaves.set(k, quando);
  }
  return { sessoes, chaves, truncada };
}

/**
 * Das chaves (DDD + 8 últimos) dadas, quais têm plano pago em `users` (plano diferente de 'free'). A mesma conta de `temPlanoPago`,
 * mas em lote: um `.in()` por até 25 chaves (100 variantes de número), em vez de uma consulta por lead. Erro de leitura LANÇA.
 */
export async function chavesComPlanoPago(chaves: readonly string[]): Promise<Set<string>> {
  const pagas = new Set<string>();
  const validas = [...new Set(chaves)].filter((c) => variantesDaChave(c).length > 0);
  for (let i = 0; i < validas.length; i += 25) {
    const lote = validas.slice(i, i + 25);
    const { data, error } = await supabase.from('users').select('whatsapp')
      .in('whatsapp', lote.flatMap((c) => variantesDaChave(c))).neq('plano', 'free').limit(1000);
    if (error) throw new Error(`ler users: ${error.message}`);
    for (const u of (data ?? []) as Array<{ whatsapp?: string | null }>) {
      const k = chaveDoContato(u.whatsapp);
      if (k) pagas.add(k);
    }
  }
  return pagas;
}
