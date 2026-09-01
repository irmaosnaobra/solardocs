import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Quantas vezes um envio que falhou bate na porta.
//
// A linha IO já caiu três vezes. Em toda queda o sistema fazia a pior coisa
// possível: cada envio que falhava virava TRÊS chamadas (retries = 2), então o
// tráfego triplicava exatamente no momento em que a linha estava pedindo
// silêncio. Só "Instance not found" era tratado como definitivo.
//
// A regra agora: 4xx é a linha dizendo NÃO (número inválido, desconectado,
// sessão caída, limite) e não se retenta, porque retentar não muda a resposta.
// 429 e 408 são o servidor pedindo espera, e aí esperar é a resposta certa.
// 5xx é problema do lado deles e costuma passar na segunda.
// ═══════════════════════════════════════════════════════════════════════════

const ENV = {
  ZAPI_INSTANCE_ID: 'inst', ZAPI_TOKEN: 'tok', ZAPI_CLIENT_TOKEN: 'cli',
  ZAPI_INSTANCE_ID_IO: 'instio', ZAPI_TOKEN_IO: 'tokio', ZAPI_CLIENT_TOKEN_IO: 'cliio',
};

function respostaCom(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => `erro ${status}`,
  } as unknown as Response;
}

describe('zapiPost: retry', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, ENV);
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // O sleep entre tentativas não pode fazer o teste esperar de verdade.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('4xx bate UMA vez só: retentar não muda a resposta e triplica o tráfego', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      // resetModules a cada volta porque o cooldown é estado de módulo: sem
      // isso, o 4xx do primeiro status calaria os seguintes e o teste passaria
      // pelo motivo errado.
      vi.resetModules();
      fetchSpy.mockReset();
      fetchSpy.mockResolvedValue(respostaCom(status));
      const { zapiPost } = await import('../services/agents/zapiClient');
      await expect(zapiPost('send-text', {}, 2, 'io')).rejects.toThrow();
      expect(fetchSpy, `status ${status}`).toHaveBeenCalledTimes(1);
    }
  });

  it('429 continua retentando: ali o servidor está pedindo espera', async () => {
    fetchSpy.mockResolvedValue(respostaCom(429));
    const { zapiPost } = await import('../services/agents/zapiClient');
    await expect(zapiPost('send-text', {}, 2, 'io')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('5xx continua retentando: é do lado deles e costuma passar', async () => {
    fetchSpy.mockResolvedValue(respostaCom(503));
    const { zapiPost } = await import('../services/agents/zapiClient');
    await expect(zapiPost('send-text', {}, 2, 'io')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('depois de um 4xx a instância entra em cooldown e o próximo envio nem toca a rede', async () => {
    // É esta parte que quebra o ciclo: sem o cooldown, o próximo tick do cron
    // recomeça o flood dez segundos depois.
    fetchSpy.mockResolvedValue(respostaCom(403));
    const { zapiPost } = await import('../services/agents/zapiClient');
    await expect(zapiPost('send-text', {}, 2, 'io')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await expect(zapiPost('send-text', {}, 2, 'io')).rejects.toThrow(/cooldown/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);   // não bateu de novo
  });

  it('sucesso passa direto, sem retentar nada', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":1}' } as unknown as Response);
    const { zapiPost } = await import('../services/agents/zapiClient');
    await expect(zapiPost('send-text', {}, 2, 'io')).resolves.toEqual({ ok: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
