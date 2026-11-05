import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('../utils/logger', () => ({ logger: log }));
const mail = vi.hoisted(() => ({ reset: vi.fn() }));
vi.mock('../utils/mailer', () => ({
  sendPasswordResetEmail: mail.reset,
  sendWelcomeEmail: vi.fn(), sendPurchaseEmail: vi.fn(), sendCheckoutCompletionEmail: vi.fn(),
}));
const zapi = vi.hoisted(() => ({ sendFrio: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: zapi.sendFrio,
  fmtPhone: (raw: string) => { const d = raw.replace(/\D/g, ''); return d.startsWith('55') ? d : `55${d}`; },
}));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(), sendWelcomeWhatsApp: vi.fn(), sendPurchaseWhatsApp: vi.fn(),
}));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('stripe', () => ({ default: class {} }));

import { banco } from './_bancoFalso';
import { forgotPassword } from '../controllers/authController';

function chamar(email: unknown) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    set() { return res; },
  };
  return forgotPassword({ body: { email } } as any, res).then(() => out);
}

let consoles: Array<ReturnType<typeof vi.spyOn>>;
const tudoQueFoiLogado = () => JSON.stringify([
  ...consoles.flatMap(s => s.mock.calls), ...log.error.mock.calls, ...log.warn.mock.calls, ...log.info.mock.calls,
]);

beforeEach(() => {
  banco.reset();
  mail.reset.mockReset(); mail.reset.mockResolvedValue(undefined);
  zapi.sendFrio.mockReset(); zapi.sendFrio.mockResolvedValue(true);
  Object.values(log).forEach(f => f.mockReset());
  consoles = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
  banco.poe('users', { id: 'u1', email: 'cliente@a.com', whatsapp: '34998364589', plano: 'pro', billing_status: 'active', reset_token: null, reset_token_expires: null });
});
afterEach(() => { consoles.forEach(s => s.mockRestore()); });

describe('forgotPassword', () => {
  it('resposta idêntica (status e corpo) para e-mail que existe e que não existe', async () => {
    const existe = await chamar('Cliente@A.com ');
    const naoExiste = await chamar('ninguem@a.com');
    expect(existe).toEqual(naoExiste);
    expect(existe.status).toBe(200);
    expect(existe.body.message).toMatch(/se o email estiver cadastrado/i);
  });

  it('e-mail que existe: e-mail com o link e WhatsApp com o MESMO link; o token vive no banco', async () => {
    await chamar('cliente@a.com');
    const token = String(banco.linhas('users')[0]!.reset_token);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(mail.reset).toHaveBeenCalledTimes(1);
    expect(mail.reset.mock.calls[0]![0]).toBe('cliente@a.com');
    expect(mail.reset.mock.calls[0]![1]).toBe(`https://solardoc.app/auth?mode=redefinir&token=${token}`);
    expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
    expect(zapi.sendFrio.mock.calls[0]![0]).toBe('5534998364589');
    expect(zapi.sendFrio.mock.calls[0]![1][0]).toContain(`token=${token}`);
  });

  it('conta GRÁTIS: só o e-mail, sem WhatsApp, e a resposta é idêntica à da conta paga', async () => {
    const paga = await chamar('cliente@a.com');
    expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
    zapi.sendFrio.mockClear(); mail.reset.mockClear(); banco.reset();
    banco.poe('users', { id: 'u2', email: 'gratis@a.com', whatsapp: '34998364589', plano: 'free', billing_status: null, plano_expira_em: null, reset_token: null, reset_token_expires: null });
    const gratis = await chamar('gratis@a.com');
    expect(gratis).toEqual(paga);
    expect(mail.reset).toHaveBeenCalledTimes(1);
    expect(zapi.sendFrio).not.toHaveBeenCalled();
  });

  it('conta com Pix vigente (plano_expira_em no futuro) conta como paga', async () => {
    Object.assign(banco.linhas('users')[0]!, { plano: 'free', billing_status: null, plano_expira_em: new Date(Date.now() + 86_400_000).toISOString() });
    await chamar('cliente@a.com');
    expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
  });

  it('erro do e-mail com o token no MEIO de uma mensagem longa: o error_logs sai sem o token, nem pedaço', async () => {
    await chamar('cliente@a.com');
    const token = String(banco.linhas('users')[0]!.reset_token);
    log.error.mockReset();
    mail.reset.mockRejectedValue(new Error(`${'a'.repeat(280)} ${token} ${'b'.repeat(100)}`));
    await chamar('cliente@a.com');
    const erro = log.error.mock.calls.find(c => c[0] === 'forgot-password');
    expect(erro).toBeTruthy();
    expect(JSON.stringify(erro)).not.toContain(token.slice(0, 10));
  });

  it('e-mail que não existe: não manda e-mail nem WhatsApp', async () => {
    await chamar('ninguem@a.com');
    expect(mail.reset).not.toHaveBeenCalled();
    expect(zapi.sendFrio).not.toHaveBeenCalled();
  });

  it('segundo pedido reaproveita o token vivo (não gira)', async () => {
    await chamar('cliente@a.com');
    const t1 = banco.linhas('users')[0]!.reset_token;
    await chamar('cliente@a.com');
    expect(banco.linhas('users')[0]!.reset_token).toBe(t1);
    expect(mail.reset.mock.calls[1]![1]).toBe(mail.reset.mock.calls[0]![1]);
  });

  it('e-mail falhando 2x: tenta de novo, vai pro logger.error sem token e a resposta não muda', async () => {
    mail.reset.mockRejectedValue(new Error('resend fora'));
    const falhou = await chamar('cliente@a.com');
    expect(mail.reset).toHaveBeenCalledTimes(2);
    const erro = log.error.mock.calls.find(c => c[0] === 'forgot-password');
    expect(erro).toBeTruthy();
    expect(erro![1]).toBe('e-mail de redefinição falhou');
    expect(erro![2]).toMatchObject({ userId: 'u1' });
    expect(JSON.stringify(erro)).not.toContain(String(banco.linhas('users')[0]!.reset_token));
    expect(falhou).toEqual(await chamar('ninguem@a.com'));
    expect(zapi.sendFrio).toHaveBeenCalled();           // o WhatsApp segue mesmo com o e-mail fora
  });

  it('e-mail falha na 1ª e passa na 2ª: sem erro no log', async () => {
    mail.reset.mockRejectedValueOnce(new Error('resend fora'));
    await chamar('cliente@a.com');
    expect(mail.reset).toHaveBeenCalledTimes(2);
    expect(log.error.mock.calls.find(c => c[0] === 'forgot-password')).toBeUndefined();
  });

  it('WhatsApp que explode ou é barrado não muda a resposta', async () => {
    zapi.sendFrio.mockRejectedValue(new Error('z-api fora'));
    const a = await chamar('cliente@a.com');
    banco.reset(); banco.poe('users', { id: 'u1', email: 'cliente@a.com', whatsapp: null, plano: 'pro', billing_status: 'active', reset_token: null, reset_token_expires: null });
    const b = await chamar('cliente@a.com');
    expect(a).toEqual(b);
    expect(a.status).toBe(200);
  });

  it('falha de banco ao gravar o link vira 503, igual para qualquer e-mail', async () => {
    banco.falhas['users.update'] = { erro: { code: '42501', message: 'permission denied' } };
    const r = await chamar('cliente@a.com');
    expect(r.status).toBe(503);
    expect(mail.reset).not.toHaveBeenCalled();
  });

  it('falha de banco na busca do e-mail vira 503', async () => {
    banco.falhas['users.select'] = { erro: { code: '57014', message: 'timeout' } };
    expect((await chamar('cliente@a.com')).status).toBe(503);
  });

  it('o token e a URL não aparecem em nenhum console nem logger (nem com tudo falhando)', async () => {
    await chamar('cliente@a.com');
    const token = String(banco.linhas('users')[0]!.reset_token);
    mail.reset.mockRejectedValue(new Error(`resend: ${token}`));
    zapi.sendFrio.mockRejectedValue(new Error(`z-api: https://solardoc.app/auth?mode=redefinir&token=${token}`));
    banco.tabelas['system_state'] = [];
    await chamar('cliente@a.com');
    const logado = tudoQueFoiLogado();
    expect(logado).not.toContain(token);
    expect(logado).not.toContain('mode=redefinir');
    expect(logado).toContain('link reaproveitado');
  });

  it('e-mail ausente: 400', async () => {
    expect((await chamar('')).status).toBe(400);
  });
});
