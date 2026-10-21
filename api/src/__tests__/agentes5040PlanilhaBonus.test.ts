import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Bônus da planilha (B3c): registrar quem tem direito, nunca enviar nada ───
// O que se prova: o direito só nasce quando a promessa e o fechamento são do MESMO dia em
// Brasília; nada de telefone cru em system_state; e nada daqui lança (o gancho roda dentro do
// webhook de pagamento).

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let quebrar = false; // todo acesso ao banco lança
let travar = false; // o banco nunca responde

function query(table: string) {
  if (quebrar) throw new Error('banco fora');
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'upsert' = 'select';
  let pendente: Row | null = null;
  let onConflict = '';
  function executa(): { data: any; error: any } {
    const t = (db[table] ??= []);
    if (modo === 'insert') {
      if (t.some((r) => r.key === pendente!.key)) return { data: null, error: { code: '23505' } };
      t.push({ ...pendente! });
      return { data: pendente, error: null };
    }
    if (modo === 'upsert') {
      const ex = t.find((r) => r[onConflict] === pendente![onConflict]);
      if (ex) Object.assign(ex, pendente); else t.push({ ...pendente! });
      return { data: pendente, error: null };
    }
    return { data: t.filter((r) => filtros.every((f) => f(r))).map((r) => ({ ...r })), error: null };
  }
  const q: any = {
    select: () => q,
    insert: (row: Row) => { modo = 'insert'; pendente = row; return q; },
    upsert: (row: Row, o?: { onConflict?: string }) => { modo = 'upsert'; pendente = row; onConflict = o?.onConflict || ''; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    maybeSingle: async () => {
      if (travar) return new Promise(() => {});
      const { data, error } = executa();
      return { data: Array.isArray(data) ? data[0] ?? null : data, error };
    },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));

import {
  registrarPromessa, concederSeFechouNoDia, tentarBonusPosPagamento, PREFIXO_PROMESSA, PREFIXO_BONUS,
} from '../services/agentes5040/planilhaBonus';

const TEL = '5534991112222';
const TEL_USERS = '34991112222';
const USER = 'u-123';
const HOJE = new Date('2026-10-21T15:00:00Z'); // 12:00 em Brasília
const bonus = () => db.system_state.filter((r) => String(r.key).startsWith(PREFIXO_BONUS));

beforeEach(() => {
  db.system_state = []; db.users = [];
  quebrar = false; travar = false;
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
});
afterEach(() => { vi.useRealTimers(); });

describe('planilhaBonus', () => {
  it('promessa e fechamento no mesmo dia concedem, e o registro leva só dia e origem', async () => {
    expect(await registrarPromessa(TEL, HOJE)).toBe(true);
    const ok = await concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'stripe', agora: new Date('2026-10-21T20:00:00Z') });
    expect(ok).toBe(true);
    expect(bonus()).toHaveLength(1);
    expect(bonus()[0]).toMatchObject({ key: PREFIXO_BONUS + USER, value: { dia: '2026-10-21', origem: 'stripe' } });
  });

  it('nenhum telefone cru em system_state (chave nem valor)', async () => {
    await registrarPromessa(TEL, HOJE);
    await concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'kiwify_pix', agora: HOJE });
    const tudo = JSON.stringify(db.system_state);
    expect(tudo).not.toContain('991112222');
    expect(tudo).not.toContain('3499111');
    expect(db.system_state.some((r) => String(r.key).startsWith(PREFIXO_PROMESSA))).toBe(true);
  });

  it('promessa de outro dia não concede', async () => {
    await registrarPromessa(TEL, new Date('2026-10-20T15:00:00Z'));
    const ok = await concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'stripe', agora: HOJE });
    expect(ok).toBe(false);
    expect(bonus()).toHaveLength(0);
  });

  it('o dia é o de Brasília, não o de UTC', async () => {
    // 21/10 01:30 UTC = 20/10 22:30 BRT
    await registrarPromessa(TEL, new Date('2026-10-21T01:30:00Z'));
    // 21/10 02:30 UTC = 20/10 23:30 BRT: mesmo dia de Brasília
    expect(await concederSeFechouNoDia({ userId: 'a', telefone: TEL, origem: 'stripe', agora: new Date('2026-10-21T02:30:00Z') })).toBe(true);
    // 21/10 03:30 UTC = 21/10 00:30 BRT: virou o dia
    expect(await concederSeFechouNoDia({ userId: 'b', telefone: TEL, origem: 'stripe', agora: new Date('2026-10-21T03:30:00Z') })).toBe(false);
  });

  it('pagamento às 23:59 de Brasília, processado às 00:01 (agora = hora do pagamento), ainda concede', async () => {
    await registrarPromessa(TEL, new Date('2026-10-21T01:00:00Z')); // 20/10 22:00 BRT
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T03:01:00Z')); // 00:01 BRT de 21/10: o relógio já virou
    db.users.push({ id: USER, email: 'a@b.com', whatsapp: TEL_USERS });
    const pagoEm = new Date('2026-10-21T02:59:00Z'); // 20/10 23:59 BRT
    expect(await tentarBonusPosPagamento({ userId: USER, origem: 'stripe', agora: pagoEm })).toBe(true);
    expect(bonus()[0]!.value.dia).toBe('2026-10-20');
  });

  it('sem promessa não concede', async () => {
    expect(await concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'pix_comprovante', agora: HOJE })).toBe(false);
    expect(bonus()).toHaveLength(0);
  });

  it('o mesmo contato em outro formato (sem 55, com máscara) casa com a promessa', async () => {
    await registrarPromessa(TEL, HOJE);
    expect(await concederSeFechouNoDia({ userId: USER, telefone: '(34) 99111-2222', origem: 'stripe', agora: HOJE })).toBe(true);
  });

  it('segunda concessão no mesmo usuário não regrava (reentrega do webhook)', async () => {
    await registrarPromessa(TEL, HOJE);
    expect(await concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'stripe', agora: HOJE })).toBe(true);
    expect(await concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'pix_comprovante', agora: HOJE })).toBe(false);
    expect(bonus()).toHaveLength(1);
    expect(bonus()[0]!.value.origem).toBe('stripe');
  });

  it('telefone inútil, usuário vazio ou sem segredo de HMAC: false, sem gravar', async () => {
    expect(await registrarPromessa('123', HOJE)).toBe(false);
    expect(await registrarPromessa(null, HOJE)).toBe(false);
    expect(await concederSeFechouNoDia({ userId: '', telefone: TEL, origem: 'stripe', agora: HOJE })).toBe(false);
    delete process.env.AGENTES5040_HMAC;
    const k = process.env.SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_KEY;
    expect(await registrarPromessa(TEL, HOJE)).toBe(false);
    if (k) process.env.SUPABASE_SERVICE_KEY = k;
    expect(db.system_state).toHaveLength(0);
  });

  it('erro de banco nunca lança', async () => {
    await registrarPromessa(TEL, HOJE);
    quebrar = true;
    await expect(registrarPromessa(TEL, HOJE)).resolves.toBe(false);
    await expect(concederSeFechouNoDia({ userId: USER, telefone: TEL, origem: 'stripe', agora: HOJE })).resolves.toBe(false);
    await expect(tentarBonusPosPagamento({ userId: USER, telefone: TEL, origem: 'stripe', agora: HOJE })).resolves.toBe(false);
  });

  it('o gancho acha o telefone em users.whatsapp (pelo e-mail)', async () => {
    db.users.push({ id: USER, email: 'a@b.com', whatsapp: TEL_USERS });
    await registrarPromessa(TEL, HOJE);
    expect(await tentarBonusPosPagamento({ email: 'A@B.com', origem: 'kiwify_pix', agora: HOJE })).toBe(true);
    expect(bonus()[0]!.key).toBe(PREFIXO_BONUS + USER);
  });

  it('o gancho usa o telefone do pagamento quando o usuário não tem WhatsApp', async () => {
    db.users.push({ id: USER, email: 'a@b.com', whatsapp: null });
    await registrarPromessa(TEL, HOJE);
    expect(await tentarBonusPosPagamento({ userId: USER, telefone: TEL, origem: 'pix_comprovante', agora: HOJE })).toBe(true);
  });

  it('banco que não responde: o gancho desiste no prazo e resolve false', async () => {
    vi.useFakeTimers();
    travar = true;
    db.users.push({ id: USER, email: 'a@b.com', whatsapp: TEL_USERS });
    const p = tentarBonusPosPagamento({ userId: USER, origem: 'stripe', agora: HOJE });
    await vi.advanceTimersByTimeAsync(2600);
    await expect(p).resolves.toBe(false);
  });
});
