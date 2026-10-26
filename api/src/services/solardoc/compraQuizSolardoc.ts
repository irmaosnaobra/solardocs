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
