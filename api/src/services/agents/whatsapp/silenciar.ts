// ─────────────────────────────────────────────────────────────────────────────
// SILENCIAR CONTATO, um lugar só pra "esta pessoa pediu pra parar".
//
// Por que existe. Em 31/08/2026 a tabela whatsapp_suppression tinha QUATRO
// linhas na base inteira, e três handlers de opt-out (Bia, gerador, LimpaPro)
// detectavam "para de me mandar", respondiam "sem problema, parei por aqui" e
// gravavam só no estado da própria sessão, que nenhum agente de SAÍDA lê. Ou
// seja: a pessoa pedia pra parar, era acolhida, e continuava recebendo de todas
// as outras trilhas. Não existe jeito mais rápido de virar denúncia, e denúncia
// é o que a Meta usa pra derrubar número.
//
// A CHAVE, que é o segundo bug e o mais silencioso. A supressão antiga casava
// por `slice(-10)`, os dez últimos dígitos. No Brasil isso QUEBRA, porque a
// Z-API alterna o nono dígito entre mensagens do mesmo contato:
//
//   5534991360172 (13 dígitos) → slice(-10) = "4991360172"
//    553491360172 (12 dígitos) → slice(-10) = "3491360172"
//
// É o MESMO telefone e dá duas chaves diferentes. Quem pediu pra parar num
// formato voltava a receber no outro, e ninguém veria: falha de chave não dá
// erro, dá silêncio do lado errado.
//
// A chave daqui é DDD + os 8 últimos dígitos, que é estável nas duas formas
// (34 + 91360172 nos dois casos acima). Fixo não vira celular e vice-versa,
// porque o que muda entre as duas formas é sempre o nono dígito, nunca o DDD.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';

/**
 * Chave estável de contato: DDD + os 8 últimos dígitos.
 *
 * Devolve null pro que não dá pra normalizar com segurança (curto demais, ou
 * id de grupo, que tem 18 dígitos e nenhum DDD). Null nunca casa com nada, e é
 * de propósito: na dúvida a mensagem passa, porque silenciar por engano é pior
 * do que deixar passar uma.
 */
export function chaveContato(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;   // > 13 é grupo, não pessoa
  const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (semDdi.length < 10) return null;
  return semDdi.slice(0, 2) + semDdi.slice(-8);
}

export type MotivoSilencio = 'opt_out' | 'denuncia' | 'nunca_respondeu' | 'pediu_humano';

/**
 * Grava o pedido de parada. Idempotente, e nunca derruba o atendimento: quem
 * chama está no meio de responder ao cliente, e falhar aqui não pode virar
 * silêncio pra quem acabou de escrever.
 *
 * Guarda o telefone em dígitos puros, como a tabela sempre guardou, porque a
 * leitura normaliza dos dois lados. Assim linhas antigas continuam valendo.
 */
export async function silenciarContato(
  phone: string,
  motivo: MotivoSilencio,
  origem: string,
): Promise<void> {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits || !chaveContato(digits)) return;
  try {
    await supabase.from('whatsapp_suppression').upsert(
      { phone: digits, motivo, origem, user_deletado: false },
      { onConflict: 'phone' },
    );
    logger.info('silenciar', `${digits} silenciado (${motivo} via ${origem})`);
  } catch (err) {
    logger.error('silenciar', `falhou ao silenciar ${digits}`, err);
  }
}

/**
 * Devolve um predicado "este telefone pediu pra parar?".
 *
 * Lê a tabela uma vez e devolve função, porque quem usa isso está num laço de
 * disparo e não pode fazer um select por contato.
 *
 * Fail-open com log: se a leitura falhar, ninguém é bloqueado. Um disparo a mais
 * é ruim; a régua inteira parando porque o banco piscou é pior, e sem o log
 * viraria mistério.
 */
export async function carregarSilenciados(): Promise<(phone: string) => boolean> {
  const chaves = new Set<string>();
  try {
    const { data, error } = await supabase.from('whatsapp_suppression').select('phone');
    if (error) throw error;
    for (const r of data ?? []) {
      const k = chaveContato((r as { phone: string }).phone);
      if (k) chaves.add(k);
    }
  } catch (err) {
    logger.error('silenciar', 'leitura da supressão falhou: ninguém será bloqueado nesta rodada', err);
  }
  return (phone: string): boolean => {
    const k = chaveContato(phone);
    return k !== null && chaves.has(k);
  };
}
