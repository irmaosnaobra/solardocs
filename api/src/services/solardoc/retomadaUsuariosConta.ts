// ─────────────────────────────────────────────────────────────────────────────
// A CONTA DE QUEM RECEBEU A RETOMADA DA CARLA (03/11/2026). SÓ LEITURA: este arquivo não insere, não atualiza e não apaga nada, e não
// importa a NEXUS nem a Z-API. O vivo.ts lê a conta a cada turno da conversa e a persona (fatosDaRetomada) a transforma em fatos.
//
// A situação é RELIDA a cada turno e não copiada da posse: se a venda passar a `paid` depois do envio, ou a pessoa voltar a assinar,
// os fatos já saem certos. O telefone do cadastro tem que casar com a chave da conversa (`conta_nao_casa` lança).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { chaveContato } from '../agents/whatsapp/silenciar';
import type { DadosPosse } from '../agentes5040/posse';
import type { ContaRetomada } from '../agentes5040/tipos';
import { ADIANTO_DO_DOCUMENTO_MS, cnpjDe14, grupoDoTexto, mascararEmail, provaDePagamento, segmentoDaConta, type VendaRet } from './retomadaUsuariosRegras';

const iso = (ms: number | null): string | null => (ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString());
const tempo = (v: unknown): number | null => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

/**
 * A conta que a posse da retomada guarda. Erro LANÇA (o vivo.ts solta a vez e não fala): conta que não existe mais, telefone que não casa
 * com a conversa ou leitura que falhou nunca viram uma resposta com a situação errada.
 */
export async function lerContaDaRetomada(posse: DadosPosse, chave: string, agora: Date = new Date()): Promise<ContaRetomada> {
  const r = (posse.retomada ?? {}) as { user_id?: unknown; primeiro_nome?: unknown; texto?: unknown; em?: unknown; entrevista_saida?: unknown };
  const userId = String(r.user_id ?? '');
  if (!userId) throw new Error('conta_sem_user_id');

  const { data: u, error } = await supabase.from('users')
    .select('plano, billing_status, plano_expira_em, created_at, last_canceled_at, email, whatsapp').eq('id', userId).maybeSingle();
  if (error) throw new Error('ler_a_conta');
  if (!u) throw new Error('conta_nao_existe');
  const conta = u as {
    plano?: string | null; plano_expira_em?: string | null; created_at?: string | null; last_canceled_at?: string | null;
    email?: string | null; whatsapp?: string | null;
  };
  if (chaveContato(conta.whatsapp) !== chave) throw new Error('conta_nao_casa');

  const email = String(conta.email ?? '').trim().toLowerCase();
  const [doc, emp, vendas] = await Promise.all([
    supabase.from('documents').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
    supabase.from('company').select('cnpj').eq('user_id', userId).limit(5),
    email ? supabase.from('sales').select('valor, status').eq('email', email) : Promise.resolve({ data: [] as VendaRet[], error: null }),
  ]);
  if (doc.error || emp.error || vendas.error) throw new Error('ler_a_situacao');

  const ultimoDocBruto = tempo(((doc.data ?? []) as Array<{ created_at?: unknown }>)[0]?.created_at);
  const temCnpj = ((emp.data ?? []) as Array<{ cnpj?: unknown }>).some(c => cnpjDe14(c.cnpj));
  const lista = (vendas.data ?? []) as VendaRet[];
  const seg = segmentoDaConta(conta, { vendas: lista, ultimoDocumentoBrutoMs: ultimoDocBruto, temCnpj }, agora.getTime());

  return {
    user_id: userId,
    plano: String(conta.plano ?? 'free'),
    segmento: seg.segmento,
    grupo: grupoDoTexto(seg.segmento, provaDePagamento(lista)),
    criada_em: iso(tempo(conta.created_at)),
    saiu_em: iso(seg.saiuEm),
    forma_antiga: seg.formaAntiga,
    ultimo_documento_em: iso(ultimoDocBruto === null ? null : ultimoDocBruto - ADIANTO_DO_DOCUMENTO_MS),
    tem_cnpj: temCnpj,
    email_mascarado: mascararEmail(email),
    primeiro_nome: typeof r.primeiro_nome === 'string' && r.primeiro_nome.trim() ? r.primeiro_nome.trim() : null,
    texto_enviado: typeof r.texto === 'string' && r.texto.trim() ? r.texto : null,
    enviado_em: typeof r.em === 'string' && r.em.trim() ? r.em : null,
    ...(r.entrevista_saida === true ? { entrevista_saida: true } : {}),
  };
}
