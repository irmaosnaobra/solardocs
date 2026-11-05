import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/mailer', () => ({
  sendPasswordResetEmail: vi.fn(), sendWelcomeEmail: vi.fn(), sendPurchaseEmail: vi.fn(), sendCheckoutCompletionEmail: vi.fn(),
}));
vi.mock('../services/agents/zapiClient', () => ({ sendFrio: vi.fn(), fmtPhone: (r: string) => r }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(), sendWelcomeWhatsApp: vi.fn(), sendPurchaseWhatsApp: vi.fn(),
}));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('stripe', () => ({ default: class {} }));
const jwt = vi.hoisted(() => ({ sign: vi.fn() }));
vi.mock('../utils/jwt', async () => ({ ...(await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt')), signToken: jwt.sign }));

import { banco } from './_bancoFalso';
import { resetPassword } from '../controllers/authController';

const TOKEN = 'a'.repeat(64);
const daquiA = (ms: number) => new Date(Date.now() + ms).toISOString();

function chamar(body: Record<string, unknown>) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    set() { return res; },
  };
  return resetPassword({ body } as any, res).then(() => out);
}

let consoles: Array<ReturnType<typeof vi.spyOn>>;
const tudoQueFoiLogado = () => JSON.stringify(consoles.flatMap(s => s.mock.calls));

beforeEach(() => {
  banco.reset();
  banco.projeta = true;   // o PostgREST devolve só as colunas pedidas; o banco falso só faz isso ligado
  jwt.sign.mockReset(); jwt.sign.mockReturnValue('jwt-da-sessao');
  consoles = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
  banco.poe('users', {
    id: 'u1', email: 'cliente@a.com', nome: 'Cliente', password_hash: 'hash-velho', plano: 'pro', limite_documentos: 50, documentos_usados: 3,
    data_reset: null, created_at: '2026-01-01T00:00:00Z', is_admin: false, billing_status: 'active',
    reset_token: TOKEN, reset_token_expires: daquiA(3_600_000),
  });
});
afterEach(() => { consoles.forEach(s => s.mockRestore()); });

describe('resetPassword: sessão aberta ao criar a senha nova', () => {
  it('sucesso devolve message, token e user (sem password_hash nem reset_token), e o banco fica com a senha nova e sem token', async () => {
    const r = await chamar({ token: TOKEN, password: 'senha-nova-123' });
    expect(r.status).toBe(200);
    expect(r.body.message).toBe('Senha redefinida com sucesso!');
    expect(r.body.token).toBe('jwt-da-sessao');
    expect(jwt.sign).toHaveBeenCalledWith('u1');
    expect(r.body.user).toMatchObject({ id: 'u1', email: 'cliente@a.com', nome: 'Cliente', plano: 'pro', is_admin: false, billing_status: 'active' });
    expect(r.body.user).not.toHaveProperty('password_hash');
    expect(r.body.user).not.toHaveProperty('reset_token');
    expect(r.body.user).not.toHaveProperty('reset_token_expires');
    const u = banco.linhas('users')[0]!;
    expect(u.password_hash).not.toBe('hash-velho');
    expect(u.reset_token).toBeNull();
    expect(u.reset_token_expires).toBeNull();
  });

  it('o token é de uso único: o segundo uso do mesmo link dá 400 e não abre sessão', async () => {
    expect((await chamar({ token: TOKEN, password: 'senha-nova-123' })).status).toBe(200);
    jwt.sign.mockClear();
    const de_novo = await chamar({ token: TOKEN, password: 'outra-senha-456' });
    expect(de_novo.status).toBe(400);
    expect(de_novo.body.token).toBeUndefined();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('dois cliques ao mesmo tempo: só um abre sessão', async () => {
    const [a, b] = await Promise.all([chamar({ token: TOKEN, password: 'senha-nova-123' }), chamar({ token: TOKEN, password: 'senha-nova-123' })]);
    const comSessao = [a, b].filter(r => r.status === 200 && r.body.token);
    expect(comSessao).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('token vencido: 400 e não grava nada', async () => {
    banco.linhas('users')[0]!.reset_token_expires = daquiA(-60_000);
    banco.escritas = [];
    const r = await chamar({ token: TOKEN, password: 'senha-nova-123' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/expirado/i);
    expect(r.body.token).toBeUndefined();
    expect(banco.escritas).toHaveLength(0);
    expect(banco.linhas('users')[0]!.password_hash).toBe('hash-velho');
  });

  it('token que não existe: 400', async () => {
    const r = await chamar({ token: 'b'.repeat(64), password: 'senha-nova-123' });
    expect(r.status).toBe(400);
    expect(r.body.token).toBeUndefined();
  });

  it('falha ao assinar o JWT: a senha já mudou, então responde sucesso SEM token, e o log não leva o token', async () => {
    jwt.sign.mockImplementation(() => { throw new Error('secretOrPrivateKey must have a value'); });
    const r = await chamar({ token: TOKEN, password: 'senha-nova-123' });
    expect(r.status).toBe(200);
    expect(r.body.message).toBe('Senha redefinida com sucesso!');
    expect(r.body.token).toBeUndefined();
    expect(r.body.user).toBeUndefined();
    expect(banco.linhas('users')[0]!.reset_token).toBeNull();
    expect(consoles[1]!).toHaveBeenCalled();
    expect(tudoQueFoiLogado()).not.toContain(TOKEN);
    expect(tudoQueFoiLogado()).not.toContain('jwt-da-sessao');
  });

  it('senha curta e campos faltando seguem 400', async () => {
    expect((await chamar({ token: TOKEN, password: '123' })).status).toBe(400);
    expect((await chamar({ password: 'senha-nova-123' })).status).toBe(400);
  });
});
