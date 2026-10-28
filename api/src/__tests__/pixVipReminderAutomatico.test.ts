import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quem tem Pix AUTOMÁTICO ativo é debitado pelo banco: não recebe o lembrete de copia-e-cola.
// Vale para 'ativo' e 'inadimplente' (o banco tenta de novo por 7 dias; lembrar faria pagar em dobro).
// Contrato 'pendente' (nunca autorizou) continua recebendo. Leitura de contratos falhou: rodada sem envio.

type Row = Record<string, any>;
let users: Row[] = [];
let contratos: Row[] = [];
let falhaContratos = false;
let leituras = 0; // quantas vezes a tabela de contratos foi lida
const enviados: string[] = [];

vi.mock('../utils/supabase', () => {
  function tabela(nome: string) {
    const f: Array<(r: Row) => boolean> = [];
    let modo = 'select';
    const q: any = {
      select: () => q,
      neq: () => q, not: () => q, lte: () => q,
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { f.push((r) => vs.includes(r[c])); return q; },
      update: () => { modo = 'update'; return q; },
      range: async () => {
        if (nome === 'asaas_pix_assinaturas') leituras++;
        if (nome === 'asaas_pix_assinaturas' && falhaContratos) return { data: null, error: { message: 'fora' } };
        return { data: contratos.filter((r) => f.every((x) => x(r))), error: null };
      },
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve(modo === 'update' ? { data: null, error: null } : { data: users, error: null }).then(ok),
    };
    return q;
  }
  return { supabase: { from: (n: string) => tabela(n) } };
});
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (fone: string) => { enviados.push(fone); }),
}));

import { runPixVipReminder } from '../services/agents/whatsapp/pixVipReminderService';

const base = { plano: 'ilimitado', plano_expira_em: '2026-10-28T00:00:00Z', pix_reminder_last_sent_at: null };

beforeEach(() => {
  enviados.length = 0; falhaContratos = false; leituras = 0;
  delete process.env.PIX_MENSAL_OFF;
  users = [
    { id: 'u-auto', email: 'auto@x.com', nome: 'Auto', whatsapp: '111', ...base },
    { id: 'u-email', email: '  Mail@X.com ', nome: 'Mail', whatsapp: '222', ...base },
    { id: 'u-pend', email: 'pend@x.com', nome: 'Pend', whatsapp: '333', ...base },
    { id: 'u-inad', email: 'inad@x.com', nome: 'Inad', whatsapp: '444', ...base },
    { id: 'u-inad2', email: 'inad2@x.com', nome: 'Inad2', whatsapp: '555', ...base },
  ];
  contratos = [
    { user_id: 'u-auto', email: 'outro@x.com', modo: 'automatico', status: 'ativo' },
    { user_id: null, email: ' MAIL@x.com ', modo: 'automatico', status: 'ativo' },
    { user_id: 'u-pend', email: 'pend@x.com', modo: 'automatico', status: 'pendente' },
    { user_id: 'u-inad', email: 'inad@x.com', modo: 'automatico', status: 'inadimplente' },
    { user_id: null, email: 'INAD2@x.com', modo: 'automatico', status: 'inadimplente' },
    { user_id: 'u-pend', email: 'pend@x.com', modo: 'assinatura', status: 'ativo' }, // assinatura não é automático
  ];
});

describe('runPixVipReminder x Pix automático', () => {
  it('pula automático ativo e inadimplente (por user_id e por e-mail, sem se importar com caixa e espaços); só o pendente recebe', async () => {
    const r = await runPixVipReminder();
    expect(enviados).toEqual(['333']);
    expect(r).toEqual({ enviados: 1, pulados: 4, erros: 0 });
  });

  it('lê os contratos UMA vez por rodada, não uma por usuário', async () => {
    await runPixVipReminder();
    expect(leituras).toBe(1);
  });

  it('se a leitura dos contratos falha, NÃO manda nada na rodada', async () => {
    falhaContratos = true;
    const r = await runPixVipReminder();
    expect(enviados).toEqual([]);
    expect(r).toEqual({ enviados: 0, pulados: 0, erros: 1 });
  });
});
