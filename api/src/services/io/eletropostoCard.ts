// ─────────────────────────────────────────────────────────────────────────────
// O CARD DE ELETROPOSTO NA AGENDA: o rodízio e o gravador, num lugar só.
//
// Moravam dentro da rota (`routes/ioEletroposto.ts`, GET /agenda e POST /agendar).
// Saíram de lá em 10/10/2026 porque a agente de investidores (investidorAgente.ts)
// grava o mesmo card e não pode importar a rota para isso. A rota continua
// fazendo exatamente o que fazia: ela chama estas funções com os mesmos
// argumentos de antes.
//
// O QUE NÃO ESTÁ AQUI, de propósito: os eventos do Meta (Schedule e LeadQuente).
// Eles continuam na rota, que é quem tem o navegador e o event_id da página. O
// card gravado por um robô não dispara evento de anúncio.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { estaBloqueado } from '../agents/whatsapp/silenciar';

/** Só os donos que a LP do eletroposto distribui. */
export const DONOS_EP = ['Thiago', 'Diego'];

export const ORIGEM_LP_EP = 'lp_eletroposto';
/** Card marcado pela Helena, a agente de investidores. Guarda a palavra
 *  "eletroposto" de propósito: é por ela que a régua da agenda (confirmação,
 *  lembretes, régua do SIM) reconhece o card. */
export const ORIGEM_AGENTE_EP = 'agente_eletroposto';

/** A contagem que alimenta o rodízio: quantos cards já nasceram destas origens. */
export function consultaDoRodizio(origens: readonly string[] = [ORIGEM_LP_EP]) {
  return supabaseGerador.from('agendamentos')
    .select('id', { count: 'exact', head: true })
    .in('created_by', [...origens]);
}

/** O próximo dono pelo total já marcado. Total que não veio vale zero. */
export function donoDaVez(total: number | null | undefined): string {
  return DONOS_EP[(total || 0) % DONOS_EP.length]!;
}

/**
 * Grava a ficha na agenda.
 *
 * FORA DO PADRÃO (02/10/2026): ficha nova não nasce para telefone bloqueado.
 * Devolve `bloqueado: true` e quem chama decide o que dizer (a rota responde
 * `ok` para a pessoa não saber que foi bloqueada).
 *
 * Erro de gravação SOBE com o código do banco: 23505 é o índice de horário
 * (`agendamentos_vq_naosolar_uniq`), ou seja, alguém pegou aquele horário.
 */
export async function gravarCardEletroposto(
  ficha: Record<string, unknown>,
): Promise<{ id: number | null; bloqueado: boolean }> {
  if (await estaBloqueado(String(ficha.cliente_telefone ?? ''))) return { id: null, bloqueado: true };
  const { data, error } = await supabaseGerador
    .from('agendamentos').insert(ficha).select('id').single();
  if (error) throw error;
  return { id: (data?.id as number | undefined) ?? null, bloqueado: false };
}
