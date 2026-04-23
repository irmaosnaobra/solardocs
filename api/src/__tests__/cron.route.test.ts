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
vi.mock('../services/agents/sdr/sdrFollowupService', () => ({
  runSdrFollowups: vi.fn().mockResolvedValue({ enviados: 0, perdidos: 0 }),
}));
vi.mock('../services/agents/whatsapp/whatsappFollowupService', () => ({
  runWhatsappFollowup:    vi.fn().mockResolvedValue({ sent: 0, abandoned: 0 }),
  runInactiveEngagement:  vi.fn().mockResolvedValue({ sent: 0 }),
}));
vi.mock('../services/followupService', () => ({
  runFollowupCnpj:      vi.fn().mockResolvedValue({ sent: 0 }),
  blastFollowupDay1:    vi.fn().mockResolvedValue({ sent: 0 }),
  stampFollowupStarted: vi.fn().mockResolvedValue({ stamped: 0 }),
}));

import app from '../app';

const CRON_SECRET = 'solardocs_master_cron_2024';

// ─── GET /cron/master ────────────────────────────────────────────────
describe('GET /cron/master', () => {
  it('retorna 200 com token válido', async () => {
    const res = await request(app)
      .get('/cron/master')
      .set('Authorization', `Bearer ${CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results).toHaveProperty('executed');
  });

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
});

// ─── GET /cron/sdr-followup ──────────────────────────────────────────
describe('GET /cron/sdr-followup', () => {
  it('retorna 200 com enviados e perdidos', async () => {
    const res = await request(app)
      .get('/cron/sdr-followup')
      .set('Authorization', `Bearer ${CRON_SECRET}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, enviados: 0, perdidos: 0 });
  });
});
