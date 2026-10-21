import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// B3a: os 3 cortes de quem não dava a vez à agente nova da linha 5040 (Fase B). Posse e interruptores REAIS sobre o banco
// em memória; o envio, a IA e os limites de horário são falsos. Cada corte tem o contraste: posse viva = 0 envio; número
// sem posse (ou tudo desligado) = 1 envio, igual a hoje.
//   1. recoverAbandonedCheckouts (followupService): o opener da Giovanna 1 h depois do checkout abandonado;
//   2. runCarlaRetomada (agents/sdr/carlaRetomada): a retomada da Carla antiga no 1x1 do SolarDoc;
//   3. carlaPlatformFollowupService: carla_sem_cnpj e carla_inativo.

const h = vi.hoisted(() => ({
  enviados: [] as Array<{ tel: string; partes: string[] }>,
  emails: [] as unknown[],
  openers: [] as Array<{ phone: string }>,
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({ messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'oi, voltei aqui, deu certo por aí?' }] })) } }),
}));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, linhaEmCooldown: () => false, solardocViaIo: () => false, sendImage: vi.fn(), sendWhatsApp: vi.fn(),
  sleep: async () => undefined,
  sendHuman: vi.fn(async (tel: string, partes: string[]) => { h.enviados.push({ tel, partes }); }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async () => ({
  ...(await vi.importActual<typeof import('../services/agents/whatsapp/lineThrottle')>('../services/agents/whatsapp/lineThrottle')),
  dentroDoTetoHorarioLinha: async () => true,
  dentroDaJanelaDiurna: () => true,
}));
vi.mock('../services/agents/whatsapp/carlaThrottle', () => ({
  dentroDoTetoCarla: async () => true, marcarEnvioCarla: vi.fn(async () => undefined), dentroDaJanelaDeEnvio: () => true,
}));
vi.mock('../services/io/ioSend', () => ({ carregarBloqueioProativo: async () => () => false }));
vi.mock('../services/io/cerebroAgentes', () => ({ carregarCerebro: async () => null }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ registrarMsgProativa: vi.fn(async () => undefined) }));
vi.mock('../utils/mailer', () => ({
  sendAbandonedCartEmail: vi.fn(async (o: unknown) => { h.emails.push(o); }),
  sendOpsAlert: vi.fn(async () => undefined),
  sendFollowupEmail: vi.fn(), sendNoContractsReminderEmail: vi.fn(), sendCnpjOngoingEmail: vi.fn(),
  sendCheckoutRecoveryEmail: vi.fn(), sendCheckoutCompletionEmail: vi.fn(), sendUpgradeNudgeEmail: vi.fn(),
}));
vi.mock('../services/agents/whatsapp/pixRecoveryAgentService', () => ({
  enviarOpenerRecuperacao: vi.fn(async (phone: string) => { h.openers.push({ phone }); return true; }),
}));

import { banco, supabase } from './_bancoFalso';
import { interruptores, semearAlvo, semearPosse } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { recoverAbandonedCheckouts } from '../services/followupService';
import { runCarlaRetomada } from '../services/agents/sdr/carlaRetomada';
import { runCarlaSemCnpjFollowup, runCarlaInativoFollowup } from '../services/agents/whatsapp/carlaPlatformFollowupService';

const X = '5534991110001';   // o lead do alvo da rodada viva
const Y = '5534992220002';   // outro número, fora do alvo
const HORAS = (n: number): string => new Date(Date.now() - n * 3_600_000).toISOString();

/** Tudo desligado por env explícito: nenhuma leitura de interruptor, alvo ou posse no banco. */
const tudoDesligado = (): void => interruptores({ duda: false, helena: false, carla: false });
/** A Carla viva no alvo [X], com posse viva sobre X: o robô antigo tem que ceder. */
const posseViva = (): void => { interruptores({ carla: true }); semearAlvo([X]); semearPosse(X, 'carla'); };

/** Registra o que o código leu do banco (coluna=valor dos .eq), para provar que o corte não lê nada com tudo desligado. */
function espiarLeituras(): string[] {
  const lidos: string[] = [];
  const original = supabase.from;
  vi.spyOn(supabase, 'from').mockImplementation((t: string) => {
    const q: any = original(t);
    const eq = q.eq.bind(q);
    q.eq = (c: string, v: unknown) => { lidos.push(`${t}.${c}=${String(v)}`); return eq(c, v); };
    return q;
  });
  return lidos;
}
const leuPosseOuAlvo = (lidos: string[]): boolean =>
  lidos.some(l => l.includes('ag5040_vivo_alvo') || l.includes('ag5040_interruptores') || l === 'whatsapp_sessions.tipo=ag5040');

beforeEach(() => {
  banco.reset(); h.enviados.length = 0; h.emails.length = 0; h.openers.length = 0;
  interruptores({}); zerarCacheInterruptores();
  process.env.SOLARDOC_PIX_CHECKOUT_URL = 'https://pay.kiwify.com.br/TESTE';
  process.env.CARLA_RETOMADA_ON = 'true';
});
afterEach(() => { vi.restoreAllMocks(); interruptores({}); zerarCacheInterruptores(); delete process.env.CARLA_RETOMADA_ON; });

// ── 1. recoverAbandonedCheckouts ──────────────────────────────────────────────
describe('corte 1: recoverAbandonedCheckouts (opener da Giovanna)', () => {
  const abandono = (over: Record<string, unknown> = {}): void => banco.poe('abandoned_checkouts', {
    id: 'ab-1', email: 'lead@teste.com', phone: X, nome: 'Lead', plano: null, status: 'abandoned',
    recovery_attempts: 0, recovery_sent_at: null, created_at: HORAS(3), ...over,
  });

  it('tudo desligado: o opener sai como hoje, o e-mail também, e o corte não lê posse nem alvo', async () => {
    tudoDesligado(); abandono();
    const lidos = espiarLeituras();
    const r = await recoverAbandonedCheckouts();
    expect(h.openers).toEqual([{ phone: X }]);
    expect(h.emails).toHaveLength(1);
    expect(r.sent).toBe(1);
    expect(banco.linhas('abandoned_checkouts')[0]!.recovery_attempts).toBe(1);
    expect(leuPosseOuAlvo(lidos)).toBe(false);
  });

  it('posse viva da Carla sobre o número: 0 opener; o e-mail segue e o toque conta', async () => {
    posseViva(); abandono();
    const r = await recoverAbandonedCheckouts();
    expect(h.openers).toHaveLength(0);
    expect(h.emails).toHaveLength(1);
    expect(r.sent).toBe(1);
    expect(banco.linhas('abandoned_checkouts')[0]!.recovery_attempts).toBe(1);
  });

  it('posse viva e sem e-mail: nada sai e o toque NÃO conta (volta quando a posse acabar)', async () => {
    posseViva(); abandono({ email: null });
    const r = await recoverAbandonedCheckouts();
    expect(h.openers).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(banco.linhas('abandoned_checkouts')[0]!.recovery_attempts).toBe(0);
  });

  it('contraste: o mesmo número SEM posse (interruptor ligado, alvo gravado) recebe o opener', async () => {
    interruptores({ carla: true }); semearAlvo([X]); abandono();
    await recoverAbandonedCheckouts();
    expect(h.openers).toEqual([{ phone: X }]);
  });

  it('contraste: posse encerrada não corta; número fora do alvo com a posse de outro também não', async () => {
    interruptores({ carla: true }); semearAlvo([X]); semearPosse(X, 'carla', 'encerrada'); abandono();
    await recoverAbandonedCheckouts();
    expect(h.openers).toHaveLength(1);
    h.openers.length = 0; banco.reset(); interruptores({ carla: true }); semearAlvo([X]); semearPosse(X, 'carla'); abandono({ phone: Y });
    await recoverAbandonedCheckouts();
    expect(h.openers).toEqual([{ phone: Y }]);
  });
});

// ── 2. runCarlaRetomada ───────────────────────────────────────────────────────
describe('corte 2: runCarlaRetomada (retomada da Carla antiga)', () => {
  const lead = (phone: string): void => {
    banco.poe('sdr_leads', { phone, nome: 'Rafa', estagio: 'negociando', instance: 'solardoc', tipo: 'b2b', updated_at: HORAS(48) });
    banco.poe('whatsapp_sessions', {
      phone, tipo: 'sdr_b2b',
      messages: [{ role: 'user', content: 'oi, quanto custa?' }, { role: 'assistant', content: 'R$ 67 por mês' }, { role: 'user', content: 'vou ver' }],
    });
  };

  it('tudo desligado: a retomada sai como hoje e o corte não lê posse nem alvo', async () => {
    tudoDesligado(); lead(X);
    const lidos = espiarLeituras();
    const r = await runCarlaRetomada();
    expect(r.enviados).toBe(1);
    expect(h.enviados.map(e => e.tel)).toEqual([X]);
    expect(leuPosseOuAlvo(lidos)).toBe(false);
  });

  it('posse viva da Carla nova sobre o número: 0 envio, nenhum toque gravado, e o pulado diz por quê', async () => {
    posseViva(); lead(X);
    const r = await runCarlaRetomada();
    expect(r.enviados).toBe(0);
    expect(h.enviados).toHaveLength(0);
    expect(r.pulados.join()).toContain('agente nova segura a conversa');
    expect(banco.linhas('system_state').filter(l => String(l.key).startsWith('carla_retomada:'))).toEqual([]);
  });

  it('o dry também respeita o corte (a prévia não mostra quem a agente nova segura)', async () => {
    posseViva(); lead(X);
    const r = await runCarlaRetomada({ dry: true });
    expect(r.previa).toEqual([]);
  });

  it('contraste: número SEM posse recebe 1 envio; só o número com posse é cortado', async () => {
    posseViva(); lead(X); lead(Y);
    const r = await runCarlaRetomada();
    expect(r.enviados).toBe(1);
    expect(h.enviados.map(e => e.tel)).toEqual([Y]);
  });
});

// ── 3. carlaPlatformFollowupService ───────────────────────────────────────────
describe('corte 3: carla_sem_cnpj e carla_inativo (follow-up da Carla para quem tem conta)', () => {
  const usuario = (id: string, whatsapp: string): void => banco.poe('users', {
    id, nome: 'Ana Souza', whatsapp, created_at: HORAS(24 * 10), carla_sem_cnpj_count: 0, carla_inativo_count: 0,
    whatsapp_opt_out: false, whatsapp_replied_at: null, plano: 'free',
  });

  describe('sem_cnpj', () => {
    it('tudo desligado: sai 1 toque como hoje e o corte não lê posse nem alvo', async () => {
      tudoDesligado(); usuario('u1', X);
      const lidos = espiarLeituras();
      const r = await runCarlaSemCnpjFollowup();
      expect(r.enviados).toBe(1);
      expect(h.enviados.map(e => e.tel)).toEqual([X]);
      expect(banco.linhas('users')[0]!.carla_sem_cnpj_count).toBe(1);
      expect(leuPosseOuAlvo(lidos)).toBe(false);
    });

    it('posse viva: 0 envio e o contador do toque NÃO anda', async () => {
      posseViva(); usuario('u1', X);
      const r = await runCarlaSemCnpjFollowup();
      expect(r.enviados).toBe(0);
      expect(h.enviados).toHaveLength(0);
      expect(banco.linhas('users')[0]!.carla_sem_cnpj_count).toBe(0);
    });

    it('contraste: sem posse = 1 envio; só o número com posse é cortado', async () => {
      posseViva(); usuario('u1', X); usuario('u2', Y);
      const r = await runCarlaSemCnpjFollowup();
      expect(r.enviados).toBe(1);
      expect(h.enviados.map(e => e.tel)).toEqual([Y]);
    });
  });

  describe('inativo', () => {
    const comEmpresa = (id: string): void => banco.poe('company', { user_id: id });

    it('tudo desligado: sai 1 toque como hoje e o corte não lê posse nem alvo', async () => {
      tudoDesligado(); usuario('u1', X); comEmpresa('u1');
      const lidos = espiarLeituras();
      const r = await runCarlaInativoFollowup();
      expect(r.enviados).toBe(1);
      expect(h.enviados.map(e => e.tel)).toEqual([X]);
      expect(banco.linhas('users')[0]!.carla_inativo_count).toBe(1);
      expect(leuPosseOuAlvo(lidos)).toBe(false);
    });

    it('posse viva: 0 envio e o contador do toque NÃO anda', async () => {
      posseViva(); usuario('u1', X); comEmpresa('u1');
      const r = await runCarlaInativoFollowup();
      expect(r.enviados).toBe(0);
      expect(h.enviados).toHaveLength(0);
      expect(banco.linhas('users')[0]!.carla_inativo_count).toBe(0);
    });

    it('contraste: sem posse = 1 envio; só o número com posse é cortado', async () => {
      posseViva(); usuario('u1', X); usuario('u2', Y); comEmpresa('u1'); comEmpresa('u2');
      const r = await runCarlaInativoFollowup();
      expect(r.enviados).toBe(1);
      expect(h.enviados.map(e => e.tel)).toEqual([Y]);
    });
  });
});
