import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// ─── mocks antes do import de app ───────────────────────────────────
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      not:    vi.fn().mockReturnThis(),
      lte:    vi.fn().mockReturnThis(),
      in:     vi.fn().mockReturnThis(),
      lt:     vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      limit:  vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
    storage: { from: vi.fn(() => ({ remove: vi.fn() })) },
  },
}));
// O banco do Gerador também precisa ser fake: várias tarefas do /master e do
// /process-messages leem dele (agenda do eletroposto, prospecção, grupo diário).
// Sem este mock o teste abre conexão de verdade e estoura o timeout de 5s — o
// que reprova a rota por causa da rede, não por causa do código.
vi.mock('../utils/supabaseGerador', () => {
  const q: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return undefined;                       // não é promise
      if (prop === 'single' || prop === 'maybeSingle') return vi.fn().mockResolvedValue({ data: null, error: null });
      if (prop === 'limit') return vi.fn().mockResolvedValue({ data: [], error: null });
      return vi.fn(() => q);                                       // select/eq/in/gte/order/update/insert…
    },
  });
  return { supabaseGerador: { from: vi.fn(() => q) } };
});
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('stripe', () => ({
  default: class { customers = { list: vi.fn().mockResolvedValue({ data: [] }) } },
}));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('../utils/mailer',    () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  sendWelcomeWhatsApp:    vi.fn(),
  handleIncomingWhatsApp: vi.fn(),
  processMessageQueue:    vi.fn().mockResolvedValue({ processed: 0 }),
}));
// A retomada dos usuários pela Carla (03/11/2026): o tick vira um espião, para o teste provar que o /process-messages o chama e devolve o resultado.
const retomada = vi.hoisted(() => ({ tick: vi.fn() }));
vi.mock('../services/solardoc/retomadaUsuarios', () => ({ runRetomadaUsuariosTick: async (...a: unknown[]) => retomada.tick(...a) }));
vi.mock('../services/agents/whatsapp/whatsappFollowupService', () => ({
  runWhatsappFollowup:    vi.fn().mockResolvedValue({ sent: 0, abandoned: 0 }),
  runInactiveEngagement:  vi.fn().mockResolvedValue({ sent: 0 }),
}));
vi.mock('../services/agents/whatsapp/carlaPlatformFollowupService', () => ({
  runCarlaSemCnpjFollowup:  vi.fn().mockResolvedValue({ enviados: 0, encerrados: 0 }),
  runCarlaInativoFollowup:  vi.fn().mockResolvedValue({ enviados: 0, encerrados: 0 }),
}));
vi.mock('../services/followupService', () => ({
  runFollowupCnpj:            vi.fn().mockResolvedValue({ sent: 0 }),
  blastFollowupDay1:          vi.fn().mockResolvedValue({ sent: 0 }),
  stampFollowupStarted:       vi.fn().mockResolvedValue({ stamped: 0 }),
  // /master também invoca estes — sem o mock, viram undefined() → throw síncrono → 500.
  runCheckoutAbandonRecovery: vi.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
  recoverOrphanCheckouts:     vi.fn().mockResolvedValue({ sent: 0, skipped: 0, scanned: 0 }),
  runUpgradeNudge:            vi.fn().mockResolvedValue({ sent: 0, skipped: 0, eligiveis: 0 }),
  recoverAbandonedCheckouts:  vi.fn().mockResolvedValue({ sent: 0, recovered: 0, skipped: 0 }),
  // Importado pelo cron.ts mesmo com a tarefa pausada no /master: sem o mock, o
  // import do módulo já entra incompleto.
  runNoContractsEmailReminder: vi.fn().mockResolvedValue({ sent: 0, skipped: 0 }),
}));

import app from '../app';

const CRON_SECRET = 'falso-cron-secret-de-teste-0000';

// ─── GET /cron/master ────────────────────────────────────────────────
describe('GET /cron/master', () => {
  it('retorna 200 com token válido', async () => {
    const res = await request(app)
      .get('/cron/master')
      .set('Authorization', `Bearer ${CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // /master retorna results como ARRAY de {task, status, ...} — não objeto com 'executed'.
    expect(Array.isArray(res.body.results)).toBe(true);
    // 20s, não os 5s padrão: o /master percorre ~40 tarefas em série e o import do
    // Sentry/OpenTelemetry (instrument.ts) deixou tudo mais lento sob teste. Mede
    // ~6s aqui — o limite de 5s reprovava a rota por relógio, não por defeito.
  }, 20_000);

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/cron/master');
    expect(res.status).toBe(401);
  });

  it('retorna 401 com token errado', async () => {
    const res = await request(app)
      .get('/cron/master')
      .set('Authorization', 'Bearer token-errado');
    expect(res.status).toBe(401);
  });
});

// ─── GET /cron/process-messages ──────────────────────────────────────
describe('GET /cron/process-messages', () => {
  it('retorna 200 e processed count', async () => {
    const res = await request(app)
      .get('/cron/process-messages')
      .set('Authorization', `Bearer ${CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('chama a retomada dos usuários e devolve o resultado dela; as duas cadências velhas da Giovanna não rodam mais aqui', async () => {
    retomada.tick.mockReset().mockResolvedValue({ ok: true, ligada: true, motivo: 'sem_texto', enviou: false });
    const res = await request(app)
      .get('/cron/process-messages')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(retomada.tick).toHaveBeenCalledTimes(1);
    expect(res.body.carla_retomada_usuarios).toEqual({ ok: true, ligada: true, motivo: 'sem_texto', enviou: false });
    expect(res.body).not.toHaveProperty('carla_sem_cnpj');
    expect(res.body).not.toHaveProperty('carla_inativo');
  });

  it('tick que estoura não derruba a rota: o erro vai no campo da retomada e o resto segue', async () => {
    retomada.tick.mockReset().mockRejectedValue(new Error('banco caiu'));
    const res = await request(app)
      .get('/cron/process-messages')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(String(res.body.carla_retomada_usuarios.error)).toContain('banco caiu');
  });
});

// ─── as seis rotas cruas que mandavam WhatsApp saíram (03/11/2026) ────
describe('rotas desligadas: 410 com o segredo, 401 sem ele', () => {
  const ROTAS = [
    '/cron/followup-whatsapp', '/cron/inactive-engagement', '/cron/giovanna-test-followup', '/cron/carla-pergunta-cnpj',
    '/cron/carla-sem-cnpj', '/cron/carla-inativo',
  ];

  it.each(ROTAS)('%s responde 410 com o segredo e diz por quê', async (rota) => {
    const res = await request(app).get(rota).set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ ok: false, error: 'rota_desligada' });
    expect(String(res.body.motivo).length).toBeGreaterThan(10);
  });

  it.each(ROTAS)('%s responde 401 sem o segredo (o segredo vem antes do 410)', async (rota) => {
    expect((await request(app).get(rota)).status).toBe(401);
    expect((await request(app).get(rota).set('Authorization', 'Bearer token-errado')).status).toBe(401);
  });

  it('o /master não executa mais as cadências carla-sem-cnpj e carla-inativo', async () => {
    const res = await request(app).get('/cron/master').set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    const nomes = (res.body.results as Array<{ task?: string; name?: string }>).map(r => r.task ?? r.name);
    expect(nomes).not.toContain('carla-sem-cnpj');
    expect(nomes).not.toContain('carla-inativo');
    expect(nomes).toContain('curso-entrada-19');
  }, 20_000);
});
