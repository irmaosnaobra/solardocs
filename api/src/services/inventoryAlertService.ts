import { supabase } from '../utils/supabase';
import { sendInventoryLowStockEmail, LowStockItem } from '../utils/mailer';
import { logger } from '../utils/logger';

interface LowStockRow {
  user_id: string;
  email: string;
  nome: string | null;
  itens: LowStockItem[];
}

// Digest diário de estoque baixo. Só notifica quem definiu estoque mínimo e caiu
// até/abaixo dele. Idempotência natural: roda 1x/dia (via master). GATED por
// enquanto — ligar só depois que o inventário tiver adoção (o badge in-app já é
// o alerta sempre-ligado). ?dry=1 conta sem enviar.
export async function runInventoryLowStockAlert(
  opts: { dry?: boolean } = {},
): Promise<{ users: number; emails: number; skipped: number; dry: boolean }> {
  const { data, error } = await supabase.rpc('inventory_low_stock_users');
  if (error) throw error;

  const rows = (data ?? []) as LowStockRow[];
  let emails = 0;
  let skipped = 0;

  for (const r of rows) {
    if (!r.email || !r.itens?.length) {
      skipped++;
      continue;
    }
    if (opts.dry) continue;
    try {
      await sendInventoryLowStockEmail(r.email, r.user_id, r.nome, r.itens);
      emails++;
    } catch (e) {
      logger.error('inventory', 'low-stock email falhou', { user: r.user_id, err: String(e) });
      skipped++;
    }
  }

  return { users: rows.length, emails, skipped, dry: !!opts.dry };
}
