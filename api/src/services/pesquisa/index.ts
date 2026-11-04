// O tick único das pesquisas (04/11/2026): os dois e-mails e o WhatsApp do depoimento. O /cron/master chama este arquivo (1 linha em cron.ts).
// Cada peça falha sozinha: o e-mail que cai não segura o WhatsApp, e o contrário.
import { rodarEmailsPesquisa } from './emailTick';
import { runDepoimentoPedidoTick } from './depoimentoWhatsApp';

export async function runPesquisasTick(): Promise<Record<string, unknown>> {
  const emails = await rodarEmailsPesquisa().catch((err) => ({ ok: false, error: String(err) }));
  const whatsapp = await runDepoimentoPedidoTick().catch((err) => ({ ok: false, error: String(err) }));
  return { emails, whatsapp_depoimento: whatsapp };
}
