import { describe, it, expect, vi, beforeEach } from 'vitest';

// O lembrete de inativo por e-mail (runNoContractsEmailReminder) espera 15 dias: conta nova é da recepção de usuários novos (09/11/2026).

const H = vi.hoisted(() => ({ tabelas: {} as Record<string, any[]>, enviados: [] as string[], erroTabela: null as null | string }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      const q: any = {};
      for (const m of ['select', 'in', 'order', 'eq', 'update', 'not', 'gte', 'lte', 'is', 'or']) q[m] = () => q;
      q.then = (res: (v: unknown) => void) => res({ data: H.erroTabela === t ? null : (H.tabelas[t] ?? []), error: H.erroTabela === t ? { message: 'banco fora' } : null });
      return q;
    },
  },
}));
vi.mock('stripe', () => ({ default: class { } }));
vi.mock('../utils/mailer', () => ({
  sendFollowupEmail: vi.fn(), sendCnpjOngoingEmail: vi.fn(), sendCheckoutRecoveryEmail: vi.fn(), sendCheckoutCompletionEmail: vi.fn(),
  sendUpgradeNudgeEmail: vi.fn(), sendAbandonedCartEmail: vi.fn(),
  sendNoContractsReminderEmail: vi.fn(async (email: string) => { H.enviados.push(email); }),
}));
vi.mock('../services/agents/whatsapp/pixRecoveryAgentService', () => ({ enviarOpenerRecuperacao: vi.fn() }));
vi.mock('../services/agentes5040/posse', () => ({ cedeAAgente: vi.fn(), lerPosse: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({ sendFrio: vi.fn(), solardocViaIo: () => false }));

import { runNoContractsEmailReminder, idsComEmailDaRecepcaoRecente, pulaPorEmailDaRecepcao } from '../services/followupService';

const DIA = 86_400_000;
const lin = (id: string, diasDeConta: number) => ({
  id, email: `${id}@exemplo.com`, nome: 'Ana', created_at: new Date(Date.now() - diasDeConta * DIA).toISOString(),
  contract_reminder_last_sent_at: null, contract_reminder_count: 0, email_opt_out: false, followup_email_last_sent_at: null, upgrade_nudge_last_sent_at: null,
});

beforeEach(() => { H.enviados.length = 0; H.erroTabela = null; H.tabelas = { company: [{ user_id: 'novo' }, { user_id: 'velho' }], documents: [] }; });

const hora = 3_600_000;
const chaveRecep = (id: string, horasAtras: number, e = 'e1') => ({ key: `recep_email:${id}:${e}`, updated_at: new Date(Date.now() - horasAtras * hora).toISOString() });

describe('runNoContractsEmailReminder e o e-mail da recepção (1 e-mail nosso por dia)', () => {
  it('quem levou e-mail da recepção nas últimas 23 h é pulado; com o e-mail da recepção de 30 h atrás, segue', async () => {
    H.tabelas.company = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }];
    H.tabelas.users = [lin('a', 20), lin('b', 20), lin('c', 20)];
    H.tabelas.system_state = [chaveRecep('a', 2, 'e2'), chaveRecep('b', 30)];
    await runNoContractsEmailReminder();
    expect(H.enviados.sort()).toEqual(['b@exemplo.com', 'c@exemplo.com']);
  });

  it('idsComEmailDaRecepcaoRecente devolve null quando a leitura falha (nunca um conjunto vazio)', async () => {
    H.tabelas.system_state = [chaveRecep('a', 2)];
    expect(await idsComEmailDaRecepcaoRecente(['a', 'b'])).toEqual(new Set(['a']));
    H.erroTabela = 'system_state';
    expect(await idsComEmailDaRecepcaoRecente(['a', 'b'])).toBeNull();
  });

  it('com a leitura nula, cada cadência pula SÓ as contas com menos de 15 dias; as antigas seguem como antes', () => {
    const novo = { id: 'n', created_at: new Date(Date.now() - 5 * 86_400_000).toISOString() };
    const velho = { id: 'v', created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() };
    expect(pulaPorEmailDaRecepcao(novo, null)).toBe(true);
    expect(pulaPorEmailDaRecepcao(velho, null)).toBe(false);
    expect(pulaPorEmailDaRecepcao(novo, new Set())).toBe(false);
    expect(pulaPorEmailDaRecepcao(novo, new Set(['n']))).toBe(true);
  });
});

describe('runNoContractsEmailReminder e a recepção (conta com menos de 15 dias)', () => {
  it('conta nova COM recep_email de qualquer data é pulada; conta nova que ficou fora da recepção volta a receber; a antiga segue', async () => {
    H.tabelas.company = [{ user_id: 'comRecep' }, { user_id: 'foraDaRecep' }, { user_id: 'velho' }];
    H.tabelas.users = [lin('comRecep', 10), lin('foraDaRecep', 10), lin('velho', 16)];
    H.tabelas.system_state = [chaveRecep('comRecep', 5 * 24, 'e1')];     // há 5 dias: fora das 23 h, mas a recepção atendeu
    await runNoContractsEmailReminder();
    expect(H.enviados.sort()).toEqual(['foraDaRecep@exemplo.com', 'velho@exemplo.com']);
  });

  it('leitura dos recep_email falhou: pula as contas com menos de 15 dias, as antigas seguem', async () => {
    H.tabelas.company = [{ user_id: 'novo' }, { user_id: 'velho' }];
    H.tabelas.users = [lin('novo', 10), lin('velho', 16)];
    H.erroTabela = 'system_state';
    const r = await runNoContractsEmailReminder();
    expect(H.enviados).toEqual(['velho@exemplo.com']);
    expect(r).toEqual({ sent: 1, skipped: 1 });
  });
});
