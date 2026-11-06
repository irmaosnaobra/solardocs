import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('../utils/logger', () => ({ logger: log }));
const zapi = vi.hoisted(() => ({ sendFrio: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: zapi.sendFrio,
  fmtPhone: (raw: string) => { const d = raw.replace(/\D/g, ''); return d.startsWith('55') ? d : `55${d}`; },
}));
const sessao = vi.hoisted(() => ({ registrar: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({ registrarMsgProativa: sessao.registrar }));

import { banco } from './_bancoFalso';
import { diaBRT } from '../services/agentes5040/relogio';
import { _deps, contaPaga, enviarLinkDeSenha, linkVivoDeSenha, semSegredo } from '../services/solardoc/linkDeSenha';

const UID = 'user-1';
const URL_DO_LINK = 'https://solardoc.app/auth?mode=redefinir&token=TOKEN-SECRETO';
const AGORA = new Date('2026-11-05T01:30:00.000Z');   // 22h30 de 04/11 em Brasília
const DIA = diaBRT(AGORA);

const chaves = (prefixo: string) => banco.linhas('system_state').filter(x => String(x.key).startsWith(prefixo));
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  banco.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  zapi.sendFrio.mockReset();
  zapi.sendFrio.mockResolvedValue(true);
  sessao.registrar.mockReset();
  Object.values(log).forEach(f => f.mockReset());
  _deps.dormir = vi.fn(async () => {});
  delete process.env.DASHBOARD_URL;
  banco.poe('users', { id: UID, whatsapp: '(34) 99836-4589', reset_token: null, reset_token_expires: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('linkVivoDeSenha', () => {
  it('sem token: gera um de 24 h, grava, relê e monta a URL com solardoc.app', async () => {
    const r = await linkVivoDeSenha(UID);
    const u = banco.linhas('users')[0]!;
    expect(r.reaproveitado).toBe(false);
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    expect(u.reset_token).toBe(r.token);
    expect((Date.parse(u.reset_token_expires) - AGORA.getTime()) / 3_600_000).toBe(24);
    expect(r.url).toBe(`https://solardoc.app/auth?mode=redefinir&token=${r.token}`);
  });

  it('DASHBOARD_URL manda na base da URL', async () => {
    process.env.DASHBOARD_URL = 'https://painel.exemplo.com/';
    expect((await linkVivoDeSenha(UID)).url).toMatch(/^https:\/\/painel\.exemplo\.com\/auth\?mode=redefinir&token=/);
  });

  it('token que ainda vale (>= 60 min) é reaproveitado, não gira, e o vencimento é renovado para agora + 24 h', async () => {
    Object.assign(banco.linhas('users')[0]!, { reset_token: 'VIVO', reset_token_expires: new Date(AGORA.getTime() + 2 * 3_600_000).toISOString() });
    const r = await linkVivoDeSenha(UID);
    expect(r).toMatchObject({ token: 'VIVO', reaproveitado: true });
    const u = banco.linhas('users')[0]!;
    expect(u.reset_token).toBe('VIVO');
    expect((Date.parse(u.reset_token_expires) - AGORA.getTime()) / 3_600_000).toBe(24);
  });

  it('token com vencimento maior que 24 h (o de 30 dias de quem não tem senha) NUNCA é encurtado, e nem é regravado', async () => {
    const trintaDias = new Date(AGORA.getTime() + 30 * 86_400_000).toISOString();
    Object.assign(banco.linhas('users')[0]!, { reset_token: 'LONGO', reset_token_expires: trintaDias });
    const r = await linkVivoDeSenha(UID);
    expect(r).toMatchObject({ token: 'LONGO', reaproveitado: true });
    expect(banco.linhas('users')[0]!.reset_token_expires).toBe(trintaDias);
    expect(banco.escritas.filter(e => e.tabela === 'users')).toHaveLength(0);
  });

  it('CORRIDA: dois pedidos ao mesmo tempo (site e Giovanna) terminam com o MESMO token, o que está no banco', async () => {
    const [a, b] = await Promise.all([linkVivoDeSenha(UID), linkVivoDeSenha(UID)]);
    const doBanco = String(banco.linhas('users')[0]!.reset_token);
    expect(a.token).toBe(doBanco);
    expect(b.token).toBe(doBanco);
    expect(a.url).toBe(b.url);
    expect([a.reaproveitado, b.reaproveitado].sort()).toEqual([false, true]);   // um escreveu, o outro usou o do vencedor
  });

  it('CORRIDA com token vencido: a gravação é condicional ao token lido; quem perdeu usa o do vencedor', async () => {
    Object.assign(banco.linhas('users')[0]!, { reset_token: 'VELHO', reset_token_expires: new Date(AGORA.getTime() - 1000).toISOString() });
    const [a, b, c] = await Promise.all([linkVivoDeSenha(UID), linkVivoDeSenha(UID), linkVivoDeSenha(UID)]);
    const doBanco = String(banco.linhas('users')[0]!.reset_token);
    expect(doBanco).not.toBe('VELHO');
    expect([a.token, b.token, c.token]).toEqual([doBanco, doBanco, doBanco]);
  });

  it('CORRIDA: e-mail e WhatsApp carregam o token que está no banco', async () => {
    const [a, b] = await Promise.all([linkVivoDeSenha(UID), linkVivoDeSenha(UID)]);
    await enviarLinkDeSenha(UID, 'site', 'solardoc', a.url);
    const doBanco = String(banco.linhas('users')[0]!.reset_token);
    expect(b.url).toContain(`token=${doBanco}`);
    expect(zapi.sendFrio.mock.calls[0]![1][0]).toContain(`token=${doBanco}`);
  });

  it.each([
    ['vencido', -1000],
    ['a menos de 60 min', 59 * 60_000],
  ])('token %s gera um novo', async (_n, deslocamento) => {
    Object.assign(banco.linhas('users')[0]!, { reset_token: 'VELHO', reset_token_expires: new Date(AGORA.getTime() + deslocamento).toISOString() });
    const r = await linkVivoDeSenha(UID);
    expect(r.reaproveitado).toBe(false);
    expect(r.token).not.toBe('VELHO');
  });

  it('erro de banco na gravação lança (quem chama decide)', async () => {
    banco.falhas['users.update'] = { erro: { code: '57014', message: 'timeout' } };
    await expect(linkVivoDeSenha(UID)).rejects.toThrow();
  });
});

describe('enviarLinkDeSenha: envio', () => {
  it('pedido do site: número da conta normalizado, em 1 bolha, COM transacional (passa com humano na conversa)', async () => {
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
    expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
    const args = zapi.sendFrio.mock.calls[0]!;
    expect(args[3]).toEqual({ transacional: true });
    expect(args[0]).toBe('5534998364589');
    expect(args[2]).toBe('solardoc');
    expect(args[1]).toHaveLength(1);
    expect(args[1][0]).toBe(`Aqui está o link para você criar uma senha nova na SolarDoc:\n${URL_DO_LINK}\nEle vale por 24 horas. Se não foi você que pediu, pode ignorar esta mensagem.`);
    expect(args[1][0]).not.toMatch(/[—–]/);
  });

  it('origem giovanna: SEM 4º argumento (a pausa humana vale)', async () => {
    expect(await enviarLinkDeSenha(UID, 'giovanna', 'solardoc', URL_DO_LINK)).toBe('enviado');
    expect(zapi.sendFrio.mock.calls[0]![3]).toBeUndefined();
  });

  it('respeita a linha pedida', async () => {
    await enviarLinkDeSenha(UID, 'giovanna', 'io', URL_DO_LINK);
    expect(zapi.sendFrio.mock.calls[0]![2]).toBe('io');
  });

  it('grava as duas reservas: a da conta e o carimbo do robô do dia', async () => {
    await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK);
    expect(chaves(`link_senha_conta:${UID}:`)).toHaveLength(1);
    expect(chaves(`link_senha_sent:${DIA}:`).map(x => x.key)).toEqual([`link_senha_sent:${DIA}:1`]);
  });

  it('a qualquer hora: 22h30 em Brasília sai (nenhuma janela de horário)', async () => {
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
  });

  it('pelo site registra o contexto na sessão SEM o link; pela Giovanna não registra', async () => {
    await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK);
    expect(sessao.registrar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sessao.registrar.mock.calls[0])).not.toContain('TOKEN-SECRETO');
    expect(JSON.stringify(sessao.registrar.mock.calls[0])).not.toContain('http');
    sessao.registrar.mockClear();
    banco.tabelas['system_state'] = [];
    await enviarLinkDeSenha(UID, 'giovanna', 'solardoc', URL_DO_LINK);
    expect(sessao.registrar).not.toHaveBeenCalled();
  });
});

describe('enviarLinkDeSenha: sem WhatsApp, supressão e pausa', () => {
  it.each([[null], [''], ['12345'], ['(34) 99999-99999-99']])('whatsapp %j da conta devolve sem_whatsapp', async (w) => {
    banco.linhas('users')[0]!.whatsapp = w;
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('sem_whatsapp');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('telefone suprimido (qualquer motivo) não manda e não gasta vaga', async () => {
    banco.poe('whatsapp_suppression', { phone: '5534998364589', motivo: 'opt_out' });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('suprimido');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    expect(banco.linhas('system_state')).toHaveLength(0);
  });

  it('erro na leitura da supressão também barra', async () => {
    banco.falhas['whatsapp_suppression.select'] = { erro: { code: '57014', message: 'timeout' } };
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('suprimido');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
  });

  it('pausa humana na origem giovanna (sendFrio devolve false): devolve "pausa" e libera as duas chaves', async () => {
    zapi.sendFrio.mockResolvedValue(false);
    expect(await enviarLinkDeSenha(UID, 'giovanna', 'solardoc', URL_DO_LINK)).toBe('pausa');
    expect(chaves('link_senha_conta:')).toHaveLength(0);
    expect(chaves('link_senha_sent:')).toHaveLength(0);
    expect(sessao.registrar).not.toHaveBeenCalled();
  });

  it('erro da Z-API: devolve "erro", as chaves ficam e o log não leva o link', async () => {
    zapi.sendFrio.mockRejectedValue(new Error(`HTTP 500 ${URL_DO_LINK}`));
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('erro');
    expect(chaves('link_senha_conta:')).toHaveLength(1);
    expect(chaves('link_senha_sent:')).toHaveLength(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('TOKEN-SECRETO');
  });

  it('nunca lança: banco fora na leitura da conta devolve "erro"', async () => {
    banco.falhas['users.select'] = { erro: { code: '57014', message: 'timeout' } };
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('erro');
  });
});

describe('enviarLinkDeSenha: tetos', () => {
  it('duplo clique em 10 min: o segundo pedido é teto_conta e só sai uma mensagem', async () => {
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('teto_conta');
    expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
  });

  it('3 por conta em 24 h: o 4º é teto_conta; reserva com mais de 24 h não conta', async () => {
    for (const n of [1, 2, 3]) banco.poe('system_state', { key: `link_senha_conta:${UID}:${n}`, value: {}, updated_at: horasAtras(n * 2) });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('teto_conta');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    banco.linhas('system_state')[0]!.updated_at = horasAtras(25);
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
  });

  it('o teto da conta é por conta: outra conta não é afetada', async () => {
    for (const n of [1, 2, 3]) banco.poe('system_state', { key: `link_senha_conta:outra:${n}`, value: {}, updated_at: horasAtras(1) });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
  });

  it('teto do robô: 6 carimbos na última hora barram e devolvem a reserva da conta', async () => {
    for (let n = 1; n <= 6; n++) banco.poe('system_state', { key: `link_senha_sent:${DIA}:${n}`, value: {}, updated_at: horasAtras(0.5) });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('teto_robo');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    expect(chaves('link_senha_conta:')).toHaveLength(0);
  });

  it('teto do robô: 5 na última hora ainda passa (e espera os 10 s do último, se for o caso)', async () => {
    for (let n = 1; n <= 5; n++) banco.poe('system_state', { key: `link_senha_sent:${DIA}:${n}`, value: {}, updated_at: horasAtras(0.5) });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
    expect(_deps.dormir).not.toHaveBeenCalled();
    expect(chaves(`link_senha_sent:${DIA}:`)).toHaveLength(6);
  });

  it('teto do robô: 20 no dia barram, mesmo com carimbos de horas atrás', async () => {
    for (let n = 1; n <= 20; n++) banco.poe('system_state', { key: `link_senha_sent:${DIA}:${n}`, value: {}, updated_at: horasAtras(2) });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('teto_robo');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    expect(chaves('link_senha_conta:')).toHaveLength(0);
  });

  it('passo de 10 s: janela já tomada, espera a próxima e envia; a reserva do passo fica fora da linha', async () => {
    banco.poe('system_state', { key: `link_senha_passo:${Math.floor(AGORA.getTime() / 10_000)}`, value: {}, updated_at: AGORA.toISOString() });
    _deps.dormir = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
    expect(_deps.dormir).toHaveBeenCalledTimes(1);
    expect(vi.mocked(_deps.dormir).mock.calls[0]![0]).toBe(10_025);   // até a virada da janela de 10 s
    expect(chaves('link_senha_passo:')).toHaveLength(2);
  });

  it('passo de 10 s: se as 3 tentativas encontram a janela tomada, devolve teto_robo, libera a conta e não envia', async () => {
    // O relógio parado (dormir não anda): a janela continua tomada nas 3 tentativas.
    banco.poe('system_state', { key: `link_senha_passo:${Math.floor(AGORA.getTime() / 10_000)}`, value: {}, updated_at: AGORA.toISOString() });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('teto_robo');
    expect(_deps.dormir).toHaveBeenCalledTimes(2);
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    expect(chaves('link_senha_conta:')).toHaveLength(0);
    expect(chaves('link_senha_sent:')).toHaveLength(0);
  });

  it('duplo clique é janela MÓVEL: reserva da conta de 9 min atrás (de outro bloco de 10 min) barra; de 11 min não', async () => {
    banco.poe('system_state', { key: `link_senha_conta:${UID}:antigo`, value: {}, updated_at: new Date(AGORA.getTime() - 9 * 60_000).toISOString() });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('teto_conta');
    expect(zapi.sendFrio).not.toHaveBeenCalled();
    banco.linhas('system_state')[0]!.updated_at = new Date(AGORA.getTime() - 11 * 60_000).toISOString();
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
  });

  describe('em paralelo (várias instâncias da Vercel ao mesmo tempo)', () => {
    const contas = (n: number) => {
      for (let i = 1; i <= n; i++) banco.poe('users', { id: `conta-${i}`, whatsapp: `3499836450${i}` });
      return Array.from({ length: n }, (_, i) => `conta-${i + 1}`);
    };

    it('8 contas diferentes no mesmo instante, relógio parado: só 1 envio (1 por passo de 10 s); as outras desistem', async () => {
      const r = await Promise.all(contas(8).map(id => enviarLinkDeSenha(id, 'site', 'solardoc', URL_DO_LINK)));
      expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
      expect(r.filter(x => x === 'enviado')).toHaveLength(1);
      expect(r.filter(x => x === 'teto_robo')).toHaveLength(7);
      expect(chaves('link_senha_sent:')).toHaveLength(1);
      expect(chaves('link_senha_conta:')).toHaveLength(1);          // as 7 que desistiram devolveram a reserva da conta
    });

    it('8 contas no mesmo instante, relógio andando: no máximo 6 envios na hora, cada um com o seu passo', async () => {
      _deps.dormir = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
      const r = await Promise.all(contas(8).map(id => enviarLinkDeSenha(id, 'site', 'solardoc', URL_DO_LINK)));
      const enviados = r.filter(x => x === 'enviado').length;
      expect(enviados).toBeGreaterThanOrEqual(1);
      expect(enviados).toBeLessThanOrEqual(6);
      expect(zapi.sendFrio).toHaveBeenCalledTimes(enviados);
      expect(chaves('link_senha_sent:')).toHaveLength(enviados);     // nenhuma vaga fica presa sem envio
      expect(chaves('link_senha_passo:').length).toBeGreaterThanOrEqual(enviados);
      expect(r.every(x => x === 'enviado' || x === 'teto_robo')).toBe(true);
    });

    it('a recontagem depois da reserva: 5 carimbos na hora, 3 pedidos que passaram juntos pela leitura, só 1 envia', async () => {
      for (let n = 1; n <= 5; n++) banco.poe('system_state', { key: `link_senha_sent:${DIA}:${n}`, value: {}, updated_at: horasAtras(0.5) });
      _deps.dormir = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
      const r = await Promise.all(contas(3).map(id => enviarLinkDeSenha(id, 'site', 'solardoc', URL_DO_LINK)));
      expect(r.filter(x => x === 'enviado')).toHaveLength(1);
      expect(r.filter(x => x === 'teto_robo')).toHaveLength(2);
      expect(zapi.sendFrio).toHaveBeenCalledTimes(1);
      expect(chaves('link_senha_sent:')).toHaveLength(6);             // 5 + o que enviou; as outras devolveram a própria
      expect(chaves('link_senha_conta:')).toHaveLength(1);
    });
  });

  it('carimbo de outro dia não ocupa a vaga de hoje', async () => {
    banco.poe('system_state', { key: 'link_senha_sent:2026-11-03:1', value: {}, updated_at: horasAtras(30) });
    expect(await enviarLinkDeSenha(UID, 'site', 'solardoc', URL_DO_LINK)).toBe('enviado');
    expect(chaves(`link_senha_sent:${DIA}:`).map(x => x.key)).toEqual([`link_senha_sent:${DIA}:1`]);
  });
});

describe('semSegredo e contaPaga', () => {
  it('tira o token do MEIO de uma mensagem longa antes de qualquer corte', () => {
    const token = 'a1'.repeat(32);
    const longa = `${'x'.repeat(190)} falha em https://solardoc.app/auth?mode=redefinir&token=${token} e de novo ${token} ${'y'.repeat(300)}`;
    const limpa = semSegredo(new Error(longa), `https://solardoc.app/auth?mode=redefinir&token=${token}`, token);
    expect(limpa).not.toContain(token);
    expect(limpa).not.toContain(token.slice(0, 12));
    expect(limpa).not.toContain('mode=redefinir');
  });

  it('o log de erro da Z-API com o token no meio de um texto longo sai sem o token (nem pedaço)', async () => {
    const token = 'b2'.repeat(32);
    const url = `https://solardoc.app/auth?mode=redefinir&token=${token}`;
    zapi.sendFrio.mockRejectedValue(new Error(`${'z'.repeat(150)} corpo: ${url} ${'w'.repeat(100)} ${token}`));
    await enviarLinkDeSenha(UID, 'site', 'solardoc', url);
    const logado = JSON.stringify(log.warn.mock.calls);
    expect(logado).not.toContain(token.slice(0, 10));
    expect(logado).not.toContain('mode=redefinir');
  });

  const dia = 86_400_000;
  it.each([
    [{ plano: 'pro', billing_status: 'active' }, true],
    [{ plano: 'ilimitado', billing_status: 'trialing' }, true],
    [{ plano: 'free', billing_status: 'active' }, false],
    [{ plano: 'pro', billing_status: 'suspended' }, false],
    [{ plano: 'free', billing_status: null }, false],
    // Datas a partir do AGORA congelado: Date.now() aqui roda na coleta, com o relógio real.
    [{ plano: 'free', billing_status: null, plano_expira_em: new Date(AGORA.getTime() + dia).toISOString() }, true],
    [{ plano: 'free', billing_status: null, plano_expira_em: new Date(AGORA.getTime() - dia).toISOString() }, false],
    [null, false],
  ])('contaPaga %j = %s', (u, esperado) => {
    expect(contaPaga(u as any)).toBe(esperado);
  });
});
