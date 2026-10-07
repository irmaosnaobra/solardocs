import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Contrato do monitor da linha IO (zapiHealthMonitor).
//
// Dois defeitos consertados aqui, os dois apontados na crítica do CHEFE/ÍRIS:
//
// 1. "No ar" aceitava smartphoneConnected=true. A sessão caída com o celular
//    vivo (connected=false + smartphoneConnected=true) é a queda mais comum, e
//    passava como linha sã. Agora 'up' só com connected === true.
//
// 2. Nenhuma chamada externa tinha prazo. Uma Z-API pendurada segurava o
//    /master até os 300 s da função. Agora cada uma tem 8 s com AbortController.
//
// E um formato que NÃO pode mudar: o system_state zapi_io_health é lido pelo
// lineThrottle (reconectadoEm arma a rampa de 72h), pelo eletropostoReagendaAuto
// (downStreak > 0 = linha fora do ar) e pelo centralAgentes.
// ═══════════════════════════════════════════════════════════════════════════

const db = vi.hoisted(() => ({
  estado: null as Record<string, unknown> | null,
  erroLeitura: null as { message: string } | null,
  pendurarLeitura: false,
  pendurarGravacao: false,
  leituras: 0,
  upserts: [] as Array<{ tabela: string; linha: any; opcoes: any }>,
  sinaisBanco: [] as AbortSignal[],
}));

const mail = vi.hoisted(() => ({ sendOpsAlert: vi.fn() }));

vi.mock('../utils/supabase', () => {
  const nunca = () => new Promise<never>(() => {});
  return {
    supabase: {
      from(tabela: string) {
        return {
          select() {
            const b: any = {
              eq: () => b,
              abortSignal: (s: AbortSignal) => { db.sinaisBanco.push(s); return b; },
              maybeSingle: () => {
                db.leituras++;
                if (db.pendurarLeitura) return nunca();
                return Promise.resolve({ data: db.estado ? { value: db.estado } : null, error: db.erroLeitura });
              },
            };
            return b;
          },
          upsert(linha: any, opcoes: any) {
            db.upserts.push({ tabela, linha, opcoes });
            return {
              abortSignal: (s: AbortSignal) => {
                db.sinaisBanco.push(s);
                return db.pendurarGravacao ? nunca() : Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
  };
});
vi.mock('../utils/mailer', () => ({ sendOpsAlert: mail.sendOpsAlert }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { checarConexaoZapi, runZapiHealthCheck, ZAPI_HEALTH_TIMEOUT_MS } from '../services/io/zapiHealthMonitor';

const CREDS = { id: 'inst-teste', token: 'tok-teste', client: 'cli-teste' };
const ENV = { ZAPI_INSTANCE_ID_IO: CREDS.id, ZAPI_TOKEN_IO: CREDS.token, ZAPI_CLIENT_TOKEN_IO: CREDS.client };
const CHAVES_DO_ESTADO = ['alertadoEm', 'downStreak', 'reconectadoEm', 'ultimaConexao'];

// Prazo curto pros testes que penduram de verdade (relógio real). O padrão de 8 s
// é provado à parte, com relógio falso.
const PRAZO_TESTE = 40;
const FOLGA_MS = 1_500;

function resposta(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const nunca = () => new Promise<never>(() => {});
const horasAtras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

let fetchSpy: ReturnType<typeof vi.fn>;
const envAntes: Record<string, string | undefined> = {};

beforeEach(() => {
  db.estado = null;
  db.erroLeitura = null;
  db.pendurarLeitura = false;
  db.pendurarGravacao = false;
  db.leituras = 0;
  db.upserts = [];
  db.sinaisBanco = [];
  mail.sendOpsAlert.mockReset();
  mail.sendOpsAlert.mockResolvedValue(undefined);
  for (const [k, v] of Object.entries(ENV)) { envAntes[k] = process.env[k]; process.env[k] = v; }
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) {
    if (envAntes[k] === undefined) delete process.env[k]; else process.env[k] = envAntes[k];
  }
});

/** A única gravação da rodada, já conferida contra o formato que os leitores esperam. */
function gravacaoUnica(): Record<string, unknown> {
  expect(db.upserts).toHaveLength(1);
  const { tabela, linha, opcoes } = db.upserts[0];
  expect(tabela).toBe('system_state');
  expect(opcoes).toEqual({ onConflict: 'key' });
  expect(Object.keys(linha).sort()).toEqual(['key', 'updated_at', 'value']);
  expect(linha.key).toBe('zapi_io_health');
  expect(Number.isFinite(Date.parse(linha.updated_at))).toBe(true);
  // toEqual ignora chave com undefined; a lista de chaves não.
  expect(Object.keys(linha.value).sort()).toEqual(CHAVES_DO_ESTADO);
  return linha.value;
}

const isoRecente = (v: unknown) =>
  typeof v === 'string' && Math.abs(Date.now() - Date.parse(v)) < 60_000;

// ─────────────────────────────────────────────────────────────────────────────
describe('checarConexaoZapi: o que conta como linha no ar', () => {
  it('connected=true → up', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true, smartphoneConnected: true }));
    expect(await checarConexaoZapi(CREDS)).toBe('up');
  });

  it('connected=true com o celular fora → up (a sessão é o que manda)', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true, smartphoneConnected: false }));
    expect(await checarConexaoZapi(CREDS)).toBe('up');
  });

  it('connected=false com o celular VIVO → down (o bug: antes dava up)', async () => {
    fetchSpy.mockResolvedValue(resposta({
      connected: false, smartphoneConnected: true, error: 'You need to restore the session.',
    }));
    expect(await checarConexaoZapi(CREDS)).toBe('down');
  });

  it('connected=false com o celular fora → down', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false, smartphoneConnected: false }));
    expect(await checarConexaoZapi(CREDS)).toBe('down');
  });

  it('só smartphoneConnected=true, sem connected → unknown (não é mais up)', async () => {
    fetchSpy.mockResolvedValue(resposta({ smartphoneConnected: true }));
    expect(await checarConexaoZapi(CREDS)).toBe('unknown');
  });

  it('connected "parecido" com true (string, 1) → unknown', async () => {
    fetchSpy.mockResolvedValueOnce(resposta({ connected: 'true' }));
    expect(await checarConexaoZapi(CREDS)).toBe('unknown');
    fetchSpy.mockResolvedValueOnce(resposta({ connected: 1 }));
    expect(await checarConexaoZapi(CREDS)).toBe('unknown');
  });

  it('HTTP de erro com connected=true no corpo → unknown', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true }, 500));
    expect(await checarConexaoZapi(CREDS)).toBe('unknown');
  });

  it('corpo que não é JSON → unknown', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
    expect(await checarConexaoZapi(CREDS)).toBe('unknown');
  });

  it('erro de rede → unknown, sem estourar', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    expect(await checarConexaoZapi(CREDS)).toBe('unknown');
  });

  it('bate no /status da instância com o Client-Token e um AbortSignal', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true }));
    await checarConexaoZapi(CREDS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://api.z-api.io/instances/${CREDS.id}/token/${CREDS.token}/status`);
    expect(init.headers).toEqual({ 'Client-Token': CREDS.client });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checarConexaoZapi: prazo (Z-API pendurada não segura o master)', () => {
  it('o prazo padrão é 8 s, e é ele que vale sem opção', async () => {
    expect(ZAPI_HEALTH_TIMEOUT_MS).toBe(8_000);
    vi.useFakeTimers();
    fetchSpy.mockImplementation(nunca);
    let resultado: string | undefined;
    const p = checarConexaoZapi(CREDS).then((r) => { resultado = r; return r; });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(resultado).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('unknown');
  });

  it('fetch que IGNORA o sinal e nunca responde → unknown dentro do prazo', async () => {
    fetchSpy.mockImplementation(nunca);
    const t0 = Date.now();
    expect(await checarConexaoZapi(CREDS, { timeoutMs: PRAZO_TESTE })).toBe('unknown');
    expect(Date.now() - t0).toBeLessThan(FOLGA_MS);
  });

  it('fetch que honra o sinal: o AbortController aborta de verdade, sem rejeição solta', async () => {
    const soltas: unknown[] = [];
    const naoTratada = (e: unknown) => { soltas.push(e); };
    process.on('unhandledRejection', naoTratada);
    try {
      let sinal: AbortSignal | undefined;
      fetchSpy.mockImplementation((_url: string, init: RequestInit) => new Promise((_, rejeita) => {
        sinal = init.signal ?? undefined;
        sinal?.addEventListener('abort', () => rejeita(new DOMException('aborted', 'AbortError')));
      }));
      expect(await checarConexaoZapi(CREDS, { timeoutMs: PRAZO_TESTE })).toBe('unknown');
      expect(sinal?.aborted).toBe(true);
      await new Promise((r) => setTimeout(r, 30));
      expect(soltas).toEqual([]);
    } finally {
      process.off('unhandledRejection', naoTratada);
    }
  });

  it('cabeçalho chega mas o corpo trava → unknown (o prazo cobre o corpo)', async () => {
    let sinal: AbortSignal | undefined;
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      sinal = init.signal ?? undefined;
      return { ok: true, status: 200, json: nunca } as unknown as Response;
    });
    const t0 = Date.now();
    expect(await checarConexaoZapi(CREDS, { timeoutMs: PRAZO_TESTE })).toBe('unknown');
    expect(Date.now() - t0).toBeLessThan(FOLGA_MS);
    expect(sinal?.aborted).toBe(true);
  });

  it('resposta rápida não deixa o sinal abortado (o relógio é desarmado)', async () => {
    let sinal: AbortSignal | undefined;
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      sinal = init.signal ?? undefined;
      return resposta({ connected: true });
    });
    expect(await checarConexaoZapi(CREDS, { timeoutMs: PRAZO_TESTE })).toBe('up');
    await new Promise((r) => setTimeout(r, PRAZO_TESTE * 2));
    expect(sinal?.aborted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runZapiHealthCheck: rodada com prazo', () => {
  it('sem credencial → sem_credencial, sem chamar nada', async () => {
    delete process.env.ZAPI_INSTANCE_ID_IO;
    expect(await runZapiHealthCheck()).toEqual({ status: 'sem_credencial' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.leituras).toBe(0);
  });

  it('/status pendurado → inconclusivo, sem ler nem gravar estado e sem e-mail', async () => {
    fetchSpy.mockImplementation(nunca);
    db.estado = { downStreak: 1, alertadoEm: null, ultimaConexao: horasAtras(2), reconectadoEm: null };
    const t0 = Date.now();
    expect(await runZapiHealthCheck({ timeoutMs: PRAZO_TESTE })).toEqual({ status: 'inconclusivo' });
    expect(Date.now() - t0).toBeLessThan(FOLGA_MS);
    expect(db.leituras).toBe(0);
    expect(db.upserts).toHaveLength(0);
    expect(mail.sendOpsAlert).not.toHaveBeenCalled();
  });

  it('erro na leitura do estado → inconclusivo e NADA gravado (não apaga o reconectadoEm)', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    db.erroLeitura = { message: 'falhou' };
    expect(await runZapiHealthCheck({ timeoutMs: PRAZO_TESTE }))
      .toEqual({ status: 'inconclusivo', motivo: 'estado_ilegivel' });
    expect(db.upserts).toHaveLength(0);
    expect(mail.sendOpsAlert).not.toHaveBeenCalled();
  });

  it('leitura do estado pendurada → inconclusivo dentro do prazo e NADA gravado', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    db.pendurarLeitura = true;
    const t0 = Date.now();
    expect(await runZapiHealthCheck({ timeoutMs: PRAZO_TESTE }))
      .toEqual({ status: 'inconclusivo', motivo: 'estado_ilegivel' });
    expect(Date.now() - t0).toBeLessThan(FOLGA_MS);
    expect(db.upserts).toHaveLength(0);
  });

  it('e-mail de queda pendurado → a rodada termina e o alerta fica carimbado', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    db.estado = { downStreak: 1, alertadoEm: null, ultimaConexao: horasAtras(3), reconectadoEm: null };
    mail.sendOpsAlert.mockImplementation(nunca);
    const t0 = Date.now();
    expect(await runZapiHealthCheck({ timeoutMs: PRAZO_TESTE })).toEqual({ status: 'down', alertou: 'sim' });
    expect(Date.now() - t0).toBeLessThan(FOLGA_MS);
    expect(isoRecente(gravacaoUnica().alertadoEm)).toBe(true);
  });

  it('gravação pendurada → a rodada termina mesmo assim', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true }));
    db.estado = { downStreak: 0, alertadoEm: null, ultimaConexao: horasAtras(1), reconectadoEm: null };
    db.pendurarGravacao = true;
    const t0 = Date.now();
    expect(await runZapiHealthCheck({ timeoutMs: PRAZO_TESTE })).toEqual({ status: 'up' });
    expect(Date.now() - t0).toBeLessThan(FOLGA_MS);
  });

  it('toda chamada ao banco leva um AbortSignal', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    db.estado = { downStreak: 0, alertadoEm: null, ultimaConexao: horasAtras(1), reconectadoEm: null };
    await runZapiHealthCheck();
    expect(db.leituras).toBe(1);
    expect(db.upserts).toHaveLength(1);
    expect(db.sinaisBanco).toHaveLength(2);
    for (const s of db.sinaisBanco) expect(s).toBeInstanceOf(AbortSignal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('formato gravado em zapi_io_health (lineThrottle, eletropostoReagendaAuto, centralAgentes)', () => {
  it('voltou depois de queda: zera a queda, carimba ultimaConexao e reconectadoEm, avisa', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true }));
    db.estado = { downStreak: 2, alertadoEm: horasAtras(2), ultimaConexao: horasAtras(9), reconectadoEm: null };
    expect(await runZapiHealthCheck()).toEqual({ status: 'up', alertou: 'reconectou' });
    const v = gravacaoUnica();
    expect(v.downStreak).toBe(0);
    expect(v.alertadoEm).toBeNull();
    expect(isoRecente(v.ultimaConexao)).toBe(true);
    // O lineThrottle faz Date.parse(reconectadoEm) pra armar a rampa de 72h.
    expect(isoRecente(v.reconectadoEm)).toBe(true);
    expect(mail.sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('no ar e seguia no ar: preserva o reconectadoEm anterior, sem e-mail', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: true }));
    const reconectadoEm = horasAtras(30);
    db.estado = { downStreak: 0, alertadoEm: null, ultimaConexao: horasAtras(1), reconectadoEm };
    expect(await runZapiHealthCheck()).toEqual({ status: 'up' });
    const v = gravacaoUnica();
    expect(v.downStreak).toBe(0);
    expect(v.reconectadoEm).toBe(reconectadoEm);
    expect(mail.sendOpsAlert).not.toHaveBeenCalled();
  });

  it('primeira queda sem estado anterior: downStreak 1 e o resto null, sem e-mail', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    db.estado = null;
    expect(await runZapiHealthCheck()).toEqual({ status: 'down' });
    expect(gravacaoUnica()).toEqual({ downStreak: 1, alertadoEm: null, ultimaConexao: null, reconectadoEm: null });
    expect(mail.sendOpsAlert).not.toHaveBeenCalled();
  });

  it('segunda queda seguida: alerta, carimba alertadoEm e preserva ultimaConexao e reconectadoEm', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    const ultimaConexao = horasAtras(5);
    const reconectadoEm = horasAtras(40);
    db.estado = { downStreak: 1, alertadoEm: null, ultimaConexao, reconectadoEm };
    expect(await runZapiHealthCheck()).toEqual({ status: 'down', alertou: 'sim' });
    const v = gravacaoUnica();
    expect(v.downStreak).toBe(2);
    expect(isoRecente(v.alertadoEm)).toBe(true);
    expect(v.ultimaConexao).toBe(ultimaConexao);
    expect(v.reconectadoEm).toBe(reconectadoEm);
    expect(mail.sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('caída e já avisada há menos de 6h: soma a queda e não reavisa', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false }));
    const alertadoEm = horasAtras(1);
    db.estado = { downStreak: 3, alertadoEm, ultimaConexao: horasAtras(5), reconectadoEm: null };
    expect(await runZapiHealthCheck()).toEqual({ status: 'down' });
    const v = gravacaoUnica();
    expect(v.downStreak).toBe(4);
    expect(v.alertadoEm).toBe(alertadoEm);
    expect(mail.sendOpsAlert).not.toHaveBeenCalled();
  });

  it('sessão caída com o celular vivo agora acende a queda (downStreak > 0 cala o reagenda)', async () => {
    fetchSpy.mockResolvedValue(resposta({ connected: false, smartphoneConnected: true }));
    db.estado = { downStreak: 0, alertadoEm: null, ultimaConexao: horasAtras(1), reconectadoEm: null };
    expect(await runZapiHealthCheck()).toEqual({ status: 'down' });
    expect(Number(gravacaoUnica().downStreak)).toBeGreaterThan(0);
  });
});
