import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RECUPERAÇÃO DE CHECKOUT ABANDONADO — a condição de PARADA.
//
// Contexto (14/08/2026): a cadência existia, rodava e não entregava nada. A regra
// de "já recuperou" era "o e-mail existe em users" — verdadeira só enquanto o
// abandono vinha do checkout público (onde ninguém tem conta antes de pagar).
// Quando o webhook passou a capturar TAMBÉM o abandono de quem já está logado
// (metadata.userId, o UpgradeModal), ter conta virou sinônimo de recuperado:
// 7 de 7 abandonos capturados foram marcados 'recovered' sem UM toque enviado —
// incluindo um usuário free que nunca comprou nada.
//
// Estes testes travam a regra nova: recuperado = tem acesso pago DE PÉ, ou
// comprou DEPOIS do abandono.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const db: Record<string, Row[]> = { abandoned_checkouts: [], users: [], sales: [] };

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' = 'select';

  const linhas = () => db[table].filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos, error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    lt: (c: string, v: any) => { filtros.push((r) => Number(r[c] ?? 0) < Number(v)); return q; },
    lte: (c: string, v: any) => { filtros.push((r) => String(r[c]) <= String(v)); return q; },
    gte: (c: string, v: any) => { filtros.push((r) => String(r[c]) >= String(v)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    limit: () => q,
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));

const emails: any[] = [];
const alertas: any[] = [];
vi.mock('../utils/mailer', () => ({
  sendAbandonedCartEmail: vi.fn(async (o: any) => { emails.push(o); }),
  sendOpsAlert: vi.fn(async (assunto: string) => { alertas.push(assunto); }),
  sendFollowupEmail: vi.fn(), sendNoContractsReminderEmail: vi.fn(), sendCnpjOngoingEmail: vi.fn(),
  sendCheckoutRecoveryEmail: vi.fn(), sendCheckoutCompletionEmail: vi.fn(), sendUpgradeNudgeEmail: vi.fn(),
}));

const openers: any[] = [];
vi.mock('../services/agents/whatsapp/pixRecoveryAgentService', () => ({
  enviarOpenerRecuperacao: vi.fn(async (phone: string, nome: string | null, touch: number, opts: any) => {
    openers.push({ phone, nome, touch, opts });
    return true;
  }),
}));

import { recoverAbandonedCheckouts } from '../services/followupService';

const HORAS = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function abandono(over: Row = {}): Row {
  return {
    id: 'ab-' + (db.abandoned_checkouts.length + 1),
    email: 'lead@teste.com', phone: null, nome: null, plano: null,
    status: 'abandoned', recovery_attempts: 0, recovery_sent_at: null,
    created_at: HORAS(3), ...over,
  };
}

beforeEach(() => {
  db.abandoned_checkouts = []; db.users = []; db.sales = [];
  emails.length = 0; alertas.length = 0; openers.length = 0;
  process.env.SOLARDOC_PIX_CHECKOUT_URL = 'https://pay.kiwify.com.br/TESTE';
});

describe('recoverAbandonedCheckouts — quem é "recuperado"', () => {
  it('TER CONTA não é ter comprado: o free abandonado recebe o toque', async () => {
    db.abandoned_checkouts.push(abandono());
    db.users.push({ id: 'u1', email: 'lead@teste.com', nome: 'Lead', whatsapp: null, plano: 'free', billing_status: 'active', plano_expira_em: null });

    const r = await recoverAbandonedCheckouts();
    expect(r.recovered).toBe(0);
    expect(r.sent).toBe(1);
    expect(emails).toHaveLength(1);
    expect(db.abandoned_checkouts[0].recovery_attempts).toBe(1);
  });

  it('assinante ativo é recuperado — e não recebe "faltou pouco pra assinar"', async () => {
    db.abandoned_checkouts.push(abandono());
    db.users.push({ id: 'u1', email: 'lead@teste.com', plano: 'pro', billing_status: 'active', plano_expira_em: null });

    const r = await recoverAbandonedCheckouts();
    expect(r.recovered).toBe(1);
    expect(emails).toHaveLength(0);
    expect(db.abandoned_checkouts[0].status).toBe('recovered');
  });

  it('acesso pago por Pix (plano_expira_em no futuro) também encerra a cadência', async () => {
    // É assim que a volta pelo checkout da Kiwify se anuncia: o webhook carimba
    // plano_expira_em e a cadência para sozinha, sem plumbing nenhum.
    db.abandoned_checkouts.push(abandono());
    db.users.push({
      id: 'u1', email: 'lead@teste.com', plano: 'ilimitado', billing_status: 'active',
      plano_expira_em: new Date(Date.now() + 25 * 86400_000).toISOString(),
    });

    const r = await recoverAbandonedCheckouts();
    expect(r.recovered).toBe(1);
  });

  it('venda ANTIGA não conta: só compra posterior ao abandono é recuperação', async () => {
    db.abandoned_checkouts.push(abandono({ created_at: HORAS(3) }));
    db.users.push({ id: 'u1', email: 'lead@teste.com', plano: 'free', billing_status: 'active', plano_expira_em: null });
    db.sales.push({ email: 'lead@teste.com', created_at: HORAS(700) });

    const r = await recoverAbandonedCheckouts();
    expect(r.recovered).toBe(0);
    expect(r.sent).toBe(1);
  });

  it('venda depois do abandono encerra a cadência', async () => {
    db.abandoned_checkouts.push(abandono({ created_at: HORAS(5) }));
    db.sales.push({ email: 'lead@teste.com', created_at: HORAS(1) });

    const r = await recoverAbandonedCheckouts();
    expect(r.recovered).toBe(1);
  });

  it('quem está em dunning é do dunningService — a cadência não fala por cima', async () => {
    db.abandoned_checkouts.push(abandono());
    db.users.push({ id: 'u1', email: 'lead@teste.com', plano: 'pro', billing_status: 'past_due', plano_expira_em: null });

    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(0);
    expect(r.recovered).toBe(0);       // pode resolver e voltar — não é "recuperado"
    expect(db.abandoned_checkouts[0].status).toBe('abandoned');
    expect(emails).toHaveLength(0);
  });
});

describe('recoverAbandonedCheckouts — por onde a Giovanna fala', () => {
  it('sem telefone na Stripe, usa o WhatsApp do cadastro (e avisa que é usuário logado)', async () => {
    db.abandoned_checkouts.push(abandono());
    db.users.push({ id: 'u1', email: 'lead@teste.com', nome: 'Lead da Silva', whatsapp: '34999990000', plano: 'free', billing_status: 'active', plano_expira_em: null });

    await recoverAbandonedCheckouts();
    expect(openers).toHaveLength(1);
    expect(openers[0].phone).toBe('34999990000');
    expect(openers[0].nome).toBe('Lead da Silva');
    // userId → o opener entra na sessão da plataforma, não abre uma 'recovery'
    // paralela (duas Giovannas no mesmo fio de conversa).
    expect(openers[0].opts.userId).toBe('u1');
  });

  it('o telefone digitado no checkout ganha do cadastro', async () => {
    db.abandoned_checkouts.push(abandono({ phone: '34988887777' }));
    db.users.push({ id: 'u1', email: 'lead@teste.com', whatsapp: '34999990000', plano: 'free', billing_status: 'active', plano_expira_em: null });

    await recoverAbandonedCheckouts();
    expect(openers[0].phone).toBe('34988887777');
  });

  it('sem telefone em lugar nenhum, o e-mail vai sozinho', async () => {
    db.abandoned_checkouts.push(abandono());

    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(1);
    expect(emails).toHaveLength(1);
    expect(openers).toHaveLength(0);
  });

  it('cadência respeita a carência de 1h', async () => {
    db.abandoned_checkouts.push(abandono({ created_at: HORAS(0.2) }));
    const r = await recoverAbandonedCheckouts();
    expect(r.sent).toBe(0);
  });

  // ESTE TESTE PRECISA SER O ÚLTIMO DO ARQUIVO. O aviso é "uma vez por instância
  // fria" (flag de módulo, pra não virar spam a cada rodada do cron), então um
  // teste acima dele que rodasse sem a env queimaria o único disparo.
  it('sem link de Pix configurado, grita — o caminho manual não pode ser silencioso', async () => {
    delete process.env.SOLARDOC_PIX_CHECKOUT_URL;
    db.abandoned_checkouts.push(abandono());

    await recoverAbandonedCheckouts();
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toContain('Pix');
  });
});
