// PostHog do lado do SERVIDOR.
//
// POR QUÊ existe: o PostHog do navegador é contador, não é livro-caixa —
// bloqueador de anúncio e Safari comem um pedaço grande (no LimpaPro o pixel via
// 19% das visitas). Evento que vira dinheiro (venda, lead, agendamento) tem que
// sair daqui, do servidor, senão o número não serve pra decidir nada.
import { PostHog } from 'posthog-node';

const apiKey = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

export const posthogAtivo = Boolean(apiKey);

// flushAt: 1 → sai na hora, sem lote. Em serverless a instância congela depois da
// resposta; com o lote padrão (20) o evento fica preso na memória e some.
const client = apiKey ? new PostHog(apiKey, { host, flushAt: 1 }) : null;

/**
 * Registra um evento e espera ele sair de verdade.
 *
 * Nunca lança: se o PostHog estiver fora do ar, o request do cliente segue igual.
 * Sempre com await — sem isso o processo pode congelar antes do envio.
 */
export async function registrarEvento(
  evento: string,
  distinctId: string,
  propriedades: Record<string, unknown> = {}
): Promise<void> {
  if (!client) return;
  try {
    client.capture({ distinctId, event: evento, properties: propriedades });
    await client.flush();
  } catch {
    // Telemetria nunca pode derrubar request.
  }
}
