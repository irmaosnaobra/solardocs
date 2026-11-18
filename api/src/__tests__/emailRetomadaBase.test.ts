import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// RETOMADA DA BASE POR E-MAIL (18/11/2026): segmentação nos 3 grupos, exclusões, claim único, teto por rodada, desligada por padrão,
// o contador sem envio, a tarefa dentro do /cron/master e o link com o e-mail codificado.

const enviados: any[] = [];
vi.mock('resend', () => ({ Resend: class { emails = { send: async (o: any) => { enviados.push(o); return { error: null }; } }; } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classificarParaEmail, contarEmailRetomada, dentroDaJanelaDoEmail, emailRetomadaLigada, montarFilaEmail, rodarEmailRetomada,
  PREFIXO_CLAIM_EMAIL_RETOMADA, TETO_EMAIL_RETOMADA_POR_RODADA, ESGOTADA_VALE_MS, erroDoDestinatario, type DepsEmailRetomada, type ExtrasEmail, type UsuarioEmail,
} from '../services/solardoc/emailRetomada';
import {
  TEXTOS_EMAIL_RETOMADA, linkDaRetomada, montarEmailRetomada, varianteDoUsuario, type SegmentoEmailRetomada,
} from '../services/solardoc/emailRetomadaTextos';
import { sendEmailRetomadaBase } from '../utils/mailer';

const AGORA = new Date('2026-11-18T15:00:00Z');   // 12h em Brasília, dentro da janela
const dia = (n: number): string => new Date(AGORA.getTime() - n * 86_400_000).toISOString();

const usuario = (id: string, extra: Partial<UsuarioEmail> = {}): UsuarioEmail => ({
  id, email: `${id}@exemplo.com`, nome: 'Carlos Andrade', plano: 'free', billing_status: 'active', plano_expira_em: null,
  created_at: dia(90), is_admin: false, last_canceled_at: null, documentos_usados: 0, origem_aquisicao: null, email_opt_out: false, ...extra,
});
const SEM_NADA: ExtrasEmail = { vendas: [], temDocumento: false };
const seg = (u: UsuarioEmail, x: ExtrasEmail = SEM_NADA, jaRecebeu = false) => classificarParaEmail(u, x, AGORA.getTime(), jaRecebeu);

/** Dependências falsas com claims em memória (a chave única decide, como no banco). */
function falsas(usuarios: UsuarioEmail[], extras: Record<string, ExtrasEmail> = {}, tamanhoPagina?: number) {
  const claims = new Set<string>();
  const f = {
    claims,
    esgotada: null as number | null,
    liberados: [] as string[],
    enviadosPara: [] as Array<{ to: string; userId: string; nome: string; segmento: SegmentoEmailRetomada; variante: string }>,
    falhaEnvio: null as Error | null,
    deps: {
      tamanhoPagina,
      lerPagina: vi.fn(async (de: number, ate: number) => usuarios.slice(de, ate + 1)),
      lerEsgotada: vi.fn(async () => f.esgotada),
      gravarEsgotada: vi.fn(async (agora: Date) => { f.esgotada = agora.getTime(); }),
      jaReceberam: vi.fn(async (ids: readonly string[]) => new Set(ids.filter(id => claims.has(`${PREFIXO_CLAIM_EMAIL_RETOMADA}${id}`)))),
      lerExtras: vi.fn(async (us: readonly UsuarioEmail[]) => new Map(us.map(u => [u.id, extras[u.id] ?? SEM_NADA] as const))),
      reservar: vi.fn(async (chave: string) => { if (claims.has(chave)) return 'ja_existe' as const; claims.add(chave); return 'reservada' as const; }),
      liberar: vi.fn(async (chave: string) => { claims.delete(chave); f.liberados.push(chave); }),
      enviar: vi.fn(async (a: any) => { if (f.falhaEnvio) throw f.falhaEnvio; f.enviadosPara.push(a); }),
    } as DepsEmailRetomada,
  };
  return f;
}

beforeEach(() => { enviados.length = 0; delete process.env.EMAIL_RETOMADA_LIGADA; });
afterEach(() => { delete process.env.EMAIL_RETOMADA_LIGADA; });

describe('segmentação: os 3 grupos', () => {
  it('grátis que já gerou documento (contador) = e-mail 1', () => {
    expect(seg(usuario('a', { documentos_usados: 4 }))).toEqual({ ok: true, segmento: 'gratis_usou' });
  });
  it('grátis que já gerou documento (só a tabela documents, contador zerado) = e-mail 1', () => {
    expect(seg(usuario('a'), { vendas: [], temDocumento: true })).toEqual({ ok: true, segmento: 'gratis_usou' });
  });
  it('grátis que nunca gerou documento = e-mail 2', () => {
    expect(seg(usuario('b'))).toEqual({ ok: true, segmento: 'gratis_nunca_usou' });
  });
  it('ex-assinante = e-mail 3, por cancelamento, por plano vencido ou por venda paga', () => {
    expect(seg(usuario('c', { last_canceled_at: dia(40) }))).toEqual({ ok: true, segmento: 'ex_assinante' });
    expect(seg(usuario('c', { plano_expira_em: dia(30) }))).toEqual({ ok: true, segmento: 'ex_assinante' });
    expect(seg(usuario('c'), { vendas: [{ valor: 67, status: 'paid' }], temDocumento: true })).toEqual({ ok: true, segmento: 'ex_assinante' });
  });
  it('a fila conta cada grupo e ordena ex-assinante, grátis que usou, grátis que nunca usou', async () => {
    const us = [usuario('n1'), usuario('u1', { documentos_usados: 2 }), usuario('e1', { last_canceled_at: dia(60) }), usuario('n2')];
    const f = await montarFilaEmail(AGORA, falsas(us).deps);
    expect(f.aptos.map(a => a.segmento)).toEqual(['ex_assinante', 'gratis_usou', 'gratis_nunca_usou', 'gratis_nunca_usou']);
    expect(f.lidos).toBe(4);
  });
});

describe('exclusões (as da retomada pelo WhatsApp, com email_opt_out e sem exigir WhatsApp)', () => {
  const motivo = (u: UsuarioEmail, x: ExtrasEmail = SEM_NADA, jaRecebeu = false) => {
    const r = seg(u, x, jaRecebeu);
    return r.ok ? null : r.motivo;
  };
  it('quem paga hoje fica fora (plano pago, cobrança em aberto ou Pix ainda valendo)', () => {
    expect(motivo(usuario('p', { plano: 'pro' }))).toBe('paga_hoje');
    expect(motivo(usuario('p', { billing_status: 'past_due' }))).toBe('paga_hoje');
    expect(motivo(usuario('p', { plano_expira_em: new Date(AGORA.getTime() + 86_400_000).toISOString() }))).toBe('paga_hoje');
  });
  it('admin e conta de teste ficam fora', () => {
    expect(motivo(usuario('t', { is_admin: true }))).toBe('admin_ou_teste');
    expect(motivo(usuario('t', { email: 'maria.teste@exemplo.com' }))).toBe('admin_ou_teste');
    expect(motivo(usuario('t', { email: 'alguem@solardoc.app' }))).toBe('admin_ou_teste');
  });
  it('comprador de outro produto (kit-integrador e plugcash) fica fora', () => {
    expect(motivo(usuario('k', { origem_aquisicao: 'kit-integrador' }))).toBe('kit_integrador');
    expect(motivo(usuario('k', { origem_aquisicao: 'plugcash' }))).toBe('plugcash');
  });
  it('quem saiu há menos de 14 dias fica fora; há mais, entra', () => {
    expect(motivo(usuario('s', { last_canceled_at: dia(5) }))).toBe('saiu_ha_pouco');
    expect(motivo(usuario('s', { last_canceled_at: dia(20) }))).toBeNull();
  });
  it('quem saiu com estorno ou contestação fica fora', () => {
    for (const status of ['refunded', 'reembolsado', 'chargeback', 'disputed', 'contestado', 'estornado']) {
      expect(motivo(usuario('r', { last_canceled_at: dia(40) }), { vendas: [{ valor: 67, status }], temDocumento: true })).toBe('estorno_ou_contestacao');
    }
  });
  it('descadastro por e-mail, e-mail inválido e conta com menos de 14 dias ficam fora', () => {
    expect(motivo(usuario('o', { email_opt_out: true }))).toBe('email_opt_out');
    for (const email of ['', null, 'sem-arroba', 'a@b', 'dois@@x.com', 'a b@x.com']) expect(motivo(usuario('i', { email }))).toBe('email_invalido');
    expect(motivo(usuario('n', { created_at: dia(3) }))).toBe('conta_recente');
    expect(motivo(usuario('n', { created_at: null }))).toBe('data_ilegivel');
  });
  it('WhatsApp não é exigido: sem telefone e com whatsapp_opt_out entra do mesmo jeito', () => {
    expect(seg({ ...usuario('w'), whatsapp: null, whatsapp_opt_out: true })).toEqual({ ok: true, segmento: 'gratis_nunca_usou' });
  });
  it('quem já recebeu esta campanha fica fora', () => {
    expect(motivo(usuario('j'), SEM_NADA, true)).toBe('ja_recebeu');
  });
  it('na fila, os motivos de quem ficou fora são contados e `sales` só é lido de quem passou nas exclusões baratas', async () => {
    const f = falsas([usuario('ok'), usuario('fora', { plano: 'pro' }), usuario('op', { email_opt_out: true })]);
    f.claims.add(`${PREFIXO_CLAIM_EMAIL_RETOMADA}ja`);
    const r = await montarFilaEmail(AGORA, { ...f.deps, lerPagina: async () => [usuario('ok'), usuario('fora', { plano: 'pro' }), usuario('op', { email_opt_out: true }), usuario('ja')] });
    expect(r.aptos.map(a => a.u.id)).toEqual(['ok']);
    expect(r.porMotivo).toEqual({ paga_hoje: 1, email_opt_out: 1, ja_recebeu: 1 });
    expect((f.deps.lerExtras as any).mock.calls[0][0].map((u: UsuarioEmail) => u.id)).toEqual(['ok']);
  });
});

describe('desligada por padrão', () => {
  it('sem a env, nada é lido e nada é enviado', async () => {
    const f = falsas([usuario('a')]);
    expect(await rodarEmailRetomada(AGORA, f.deps)).toEqual({ enviados: 0, erros: 0, motivo: 'desligada' });
    expect(f.deps.lerPagina).not.toHaveBeenCalled();
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it('só o valor true liga (1, sim e vazio não ligam)', () => {
    expect(emailRetomadaLigada(undefined)).toBe(false);
    expect(emailRetomadaLigada('')).toBe(false);
    expect(emailRetomadaLigada('1')).toBe(false);
    expect(emailRetomadaLigada('sim')).toBe(false);
    expect(emailRetomadaLigada('false')).toBe(false);
    expect(emailRetomadaLigada('true')).toBe(true);
    expect(emailRetomadaLigada(' TRUE ')).toBe(true);
  });
  it('ligada, envia', async () => {
    process.env.EMAIL_RETOMADA_LIGADA = 'true';
    const f = falsas([usuario('a')]);
    expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(1);
  });
});

describe('janela de 8h às 20h de Brasília', () => {
  it('dentro e fora', () => {
    expect(dentroDaJanelaDoEmail(new Date('2026-11-18T10:59:00Z'))).toBe(false);   // 7h59
    expect(dentroDaJanelaDoEmail(new Date('2026-11-18T11:00:00Z'))).toBe(true);    // 8h
    expect(dentroDaJanelaDoEmail(new Date('2026-11-18T22:59:00Z'))).toBe(true);    // 19h59
    expect(dentroDaJanelaDoEmail(new Date('2026-11-18T23:00:00Z'))).toBe(false);   // 20h
  });
  it('fora da janela a rodada não lê nem envia', async () => {
    process.env.EMAIL_RETOMADA_LIGADA = 'true';
    const f = falsas([usuario('a')]);
    expect(await rodarEmailRetomada(new Date('2026-11-19T02:00:00Z'), f.deps)).toEqual({ enviados: 0, erros: 0, motivo: 'fora_da_janela' });
    expect(f.deps.lerPagina).not.toHaveBeenCalled();
  });
});

describe('claim único e teto por rodada', () => {
  beforeEach(() => { process.env.EMAIL_RETOMADA_LIGADA = 'true'; });

  it('o claim é tomado ANTES do envio, com a chave email_retomada_sent:<user_id>', async () => {
    const f = falsas([usuario('abc')]);
    const ordem: string[] = [];
    (f.deps.reservar as any).mockImplementation(async (chave: string) => { ordem.push(`reservar:${chave}`); return 'reservada'; });
    (f.deps.enviar as any).mockImplementation(async () => { ordem.push('enviar'); });
    await rodarEmailRetomada(AGORA, f.deps);
    expect(ordem).toEqual(['reservar:email_retomada_sent:abc', 'enviar']);
  });
  it('uma pessoa recebe UM e-mail para sempre: a 2ª rodada não envia de novo', async () => {
    const f = falsas([usuario('a'), usuario('b')]);
    expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(2);
    expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(0);
    expect(f.enviadosPara).toHaveLength(2);
  });
  it('claim que outra rodada já tomou (corrida) não envia e não gasta o teto', async () => {
    const f = falsas([usuario('a'), usuario('b')]);
    (f.deps.jaReceberam as any).mockResolvedValue(new Set());   // a leitura não viu, mas o insert vê
    f.claims.add(`${PREFIXO_CLAIM_EMAIL_RETOMADA}a`);
    const r = await rodarEmailRetomada(AGORA, f.deps);
    expect(r.enviados).toBe(1);
    expect(f.enviadosPara.map(e => e.userId)).toEqual(['b']);
  });
  it('claim que não gravou: não envia e encerra a rodada', async () => {
    const f = falsas([usuario('a'), usuario('b')]);
    (f.deps.reservar as any).mockResolvedValue('erro');
    expect(await rodarEmailRetomada(AGORA, f.deps)).toMatchObject({ enviados: 0, erros: 1 });
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it('no máximo 25 por rodada; o resto sai nas rodadas seguintes', async () => {
    expect(TETO_EMAIL_RETOMADA_POR_RODADA).toBe(25);
    const f = falsas(Array.from({ length: 60 }, (_, i) => usuario(`u${String(i).padStart(2, '0')}`)));
    const r1 = await rodarEmailRetomada(AGORA, f.deps);
    expect(r1.enviados).toBe(25);
    expect(r1.aptos).toBe(60);
    expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(25);
    expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(10);
    expect((await rodarEmailRetomada(AGORA, f.deps)).motivo).toBe('sem_apto');
    expect(new Set(f.enviadosPara.map(e => e.userId)).size).toBe(60);
  });
  it('só o erro do destinatário (validation_error) mantém o claim; a rodada segue', async () => {
    const f = falsas([usuario('a'), usuario('b')]);
    (f.deps.enviar as any).mockImplementationOnce(async () => { throw new Error('Resend error: validation_error - Invalid `to` field'); });
    const r = await rodarEmailRetomada(AGORA, f.deps);
    expect(r).toMatchObject({ enviados: 1, erros: 1 });
    expect(f.liberados).toEqual([]);
    expect(f.claims.has(`${PREFIXO_CLAIM_EMAIL_RETOMADA}a`)).toBe(true);
  });
  const ERROS_NOSSOS = [
    'Resend error: application_error - Unable to fetch data. The request could not be resolved.',
    'Resend error: daily_quota_exceeded - You have reached your daily email sending quota.',
    'Resend error: monthly_quota_exceeded - You have reached your monthly email sending quota.',
    'Resend error: invalid_from_address - Invalid `from` field.',
    'Resend error: missing_api_key - Missing API key',
    'Resend error: invalid_api_key - API key is invalid',
    'Resend error: rate_limit_exceeded - Too many requests',
    'algo que ninguém previu',
  ];
  for (const msg of ERROS_NOSSOS) {
    it(`erro nosso (${msg.slice(14, 45)}): solta o claim e PARA a rodada; a pessoa é tentada de novo depois`, async () => {
      expect(erroDoDestinatario(new Error(msg))).toBe(false);
      const f = falsas([usuario('a'), usuario('b')]);
      f.falhaEnvio = new Error(msg);
      const r = await rodarEmailRetomada(AGORA, f.deps);
      expect(r).toMatchObject({ enviados: 0, erros: 1, motivo: 'erro_envio' });
      expect(f.liberados).toEqual([`${PREFIXO_CLAIM_EMAIL_RETOMADA}a`]);
      expect(f.deps.enviar).toHaveBeenCalledTimes(1);
      expect(f.claims.size).toBe(0);
      f.falhaEnvio = null;
      expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(2);
    });
  }
  it('erro que não é Error (string solta) também é tratado como nosso', async () => {
    const f = falsas([usuario('a')]);
    (f.deps.enviar as any).mockImplementationOnce(async () => { throw 'quebrou'; });
    expect(await rodarEmailRetomada(AGORA, f.deps)).toMatchObject({ enviados: 0, erros: 1 });
    expect(f.liberados).toEqual([`${PREFIXO_CLAIM_EMAIL_RETOMADA}a`]);
  });
  it('só reconhece como do destinatário o validation_error do Resend', () => {
    expect(erroDoDestinatario(new Error('Resend error: validation_error - Invalid `to` field'))).toBe(true);
    expect(erroDoDestinatario(new Error('Resend error: invalid_from_address - x'))).toBe(false);
  });
  it('leitura que falha: nada é enviado e a rodada não lança', async () => {
    const f = falsas([usuario('a')]);
    (f.deps.lerPagina as any).mockRejectedValue(new Error('banco fora'));
    expect(await rodarEmailRetomada(AGORA, f.deps)).toEqual({ enviados: 0, erros: 1, motivo: 'erro_leitura' });
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
  it('o envio leva o primeiro nome limpo, o e-mail da conta, o segmento e a variante estável', async () => {
    const f = falsas([usuario('a', { nome: 'ANA PAULA SOUZA', documentos_usados: 2 })]);
    await rodarEmailRetomada(AGORA, f.deps);
    expect(f.enviadosPara[0]).toEqual({ to: 'a@exemplo.com', userId: 'a', nome: 'Ana', segmento: 'gratis_usou', variante: varianteDoUsuario('a') });
  });
});

describe('a rodada não lê a base inteira toda hora', () => {
  beforeEach(() => { process.env.EMAIL_RETOMADA_LIGADA = 'true'; });
  const base = (n: number) => Array.from({ length: n }, (_, i) => usuario(`u${String(i).padStart(3, '0')}`));

  it('para de ler ao juntar 25 aptos, paginando', async () => {
    const f = falsas(base(100), {}, 10);
    const r = await rodarEmailRetomada(AGORA, f.deps);
    expect(r.enviados).toBe(25);
    expect((f.deps.lerPagina as any).mock.calls).toHaveLength(3);   // 3 páginas de 10 já dão 30 aptos
    expect(f.esgotada).toBeNull();
  });
  it('base cheia de gente já atendida: lê tudo, acha 0 apto e grava a chave de esgotada', async () => {
    const us = base(35).map(u => ({ ...u, email_opt_out: true }));
    const f = falsas(us, {}, 10);
    const r = await rodarEmailRetomada(AGORA, f.deps);
    expect(r).toMatchObject({ enviados: 0, motivo: 'sem_apto' });
    expect((f.deps.lerPagina as any).mock.calls).toHaveLength(4);
    expect(f.deps.gravarEsgotada).toHaveBeenCalledTimes(1);
    expect(f.esgotada).toBe(AGORA.getTime());
  });
  it('com a chave de esgotada de menos de 24 h as rodadas saem cedo, sem ler a base; depois de 24 h leem de novo', async () => {
    const f = falsas(base(5));
    f.esgotada = AGORA.getTime() - 3 * 3_600_000;
    expect(await rodarEmailRetomada(AGORA, f.deps)).toEqual({ enviados: 0, erros: 0, motivo: 'esgotada' });
    expect(f.deps.lerPagina).not.toHaveBeenCalled();
    const depois = new Date(AGORA.getTime() + ESGOTADA_VALE_MS - 3 * 3_600_000 + 1000);
    expect((await rodarEmailRetomada(depois, f.deps)).enviados).toBe(5);
  });
  it('rodada que achou alguém apto não grava a chave, mesmo lendo a base toda', async () => {
    const f = falsas(base(8), {}, 10);
    expect((await rodarEmailRetomada(AGORA, f.deps)).enviados).toBe(8);
    expect(f.deps.gravarEsgotada).not.toHaveBeenCalled();
    expect((await rodarEmailRetomada(AGORA, f.deps)).motivo).toBe('sem_apto');
    expect(f.esgotada).toBe(AGORA.getTime());
  });
  it('rodada com a leitura quebrada não grava a chave', async () => {
    const f = falsas(base(3));
    (f.deps.lerPagina as any).mockRejectedValue(new Error('banco fora'));
    await rodarEmailRetomada(AGORA, f.deps);
    expect(f.deps.gravarEsgotada).not.toHaveBeenCalled();
  });
  it('o contar lê tudo e ignora a chave de esgotada', async () => {
    const f = falsas(base(95), {}, 10);
    f.esgotada = AGORA.getTime();
    const c = await contarEmailRetomada(AGORA, f.deps);
    expect(c.total).toBe(95);
    expect(c.lidos).toBe(95);
    expect((f.deps.lerPagina as any).mock.calls).toHaveLength(10);
    expect(f.deps.lerEsgotada).not.toHaveBeenCalled();
    expect(f.deps.gravarEsgotada).not.toHaveBeenCalled();
  });
});

describe('contar sem enviar', () => {
  it('devolve quantos por segmento e os motivos, sem reservar nem enviar nada, mesmo desligada e fora da janela', async () => {
    const f = falsas(
      [usuario('u1', { documentos_usados: 3 }), usuario('u2', { documentos_usados: 1 }), usuario('n1'), usuario('e1', { last_canceled_at: dia(45) }), usuario('x', { plano: 'pro' }), usuario('o', { email_opt_out: true })],
    );
    const c = await contarEmailRetomada(new Date('2026-11-19T03:00:00Z'), f.deps);
    expect(c.total).toBe(4);
    expect(c.por_segmento).toEqual({ gratis_usou: 2, gratis_nunca_usou: 1, ex_assinante: 1 });
    expect(c.por_variante.A + c.por_variante.B).toBe(4);
    expect(c.por_motivo).toEqual({ paga_hoje: 1, email_opt_out: 1 });
    expect(c.lidos).toBe(6);
    expect(f.deps.reservar).not.toHaveBeenCalled();
    expect(f.deps.enviar).not.toHaveBeenCalled();
  });
});

describe('o link do botão e o e-mail montado', () => {
  it('Pix automático com o e-mail codificado, a origem e a variante', () => {
    expect(linkDaRetomada('ana+solar@exemplo.com.br', 'gratis_usou', 'A')).toBe(
      'https://solardoc.app/?pagar=pix&email=ana%2Bsolar%40exemplo.com.br&utm_source=email&utm_medium=retomada&utm_campaign=base_gratis_usou&utm_content=A',
    );
    expect(linkDaRetomada('b@x.com', 'ex_assinante', 'B')).toContain('utm_campaign=base_ex_assinante&utm_content=B');
    expect(linkDaRetomada('c@x.com', 'gratis_nunca_usou', 'A')).toContain('utm_campaign=base_gratis_nunca_usou');
  });
  it('e-mail com & ou espaço não quebra a URL, e no HTML o & do href vai escapado', () => {
    const link = linkDaRetomada('a&b c@x.com', 'gratis_usou', 'A');
    expect(link).toContain('email=a%26b%20c%40x.com&utm_source=email');
    const m = montarEmailRetomada({ nome: 'Ana', email: 'ana+solar@exemplo.com', segmento: 'gratis_usou', variante: 'A' });
    expect(m.html).toContain('href="https://solardoc.app/?pagar=pix&amp;email=ana%2Bsolar%40exemplo.com&amp;utm_source=email&amp;utm_medium=retomada&amp;utm_campaign=base_gratis_usou&amp;utm_content=A"');
  });
  it('assunto A leva o nome e B não; sem nome o assunto A começa com maiúscula', () => {
    const base = { email: 'a@x.com', segmento: 'gratis_usou' as const };
    expect(montarEmailRetomada({ ...base, nome: 'Ana', variante: 'A' }).subject).toBe('Ana, a SolarDoc mudou bastante desde o seu teste');
    expect(montarEmailRetomada({ ...base, nome: '', variante: 'A' }).subject).toBe('A SolarDoc mudou bastante desde o seu teste');
    expect(montarEmailRetomada({ ...base, nome: 'Ana', variante: 'B' }).subject).toBe('Proposta Moderna com a logo da sua empresa na capa');
    expect(montarEmailRetomada({ email: 'a@x.com', segmento: 'gratis_nunca_usou', nome: 'Ana', variante: 'A' }).subject).toBe('Ana, falta só a sua primeira proposta');
    expect(montarEmailRetomada({ email: 'a@x.com', segmento: 'ex_assinante', nome: 'Ana', variante: 'B' }).subject).toBe('Vistoria com assinatura, 12 bancos e proposta Moderna');
  });
  it('a variante é estável por user_id e as duas aparecem', () => {
    const v = Array.from({ length: 40 }, (_, i) => varianteDoUsuario(`id-${i}`));
    expect(v).toEqual(Array.from({ length: 40 }, (_, i) => varianteDoUsuario(`id-${i}`)));
    expect(new Set(v)).toEqual(new Set(['A', 'B']));
  });
  it('os 3 e-mails têm pré-cabeçalho, corpo, botão e PS, sem travessão, sem emoji e começando com maiúscula', () => {
    for (const s of ['gratis_usou', 'gratis_nunca_usou', 'ex_assinante'] as const) {
      const t = TEXTOS_EMAIL_RETOMADA[s];
      const m = montarEmailRetomada({ nome: 'Ana', email: 'a@x.com', segmento: s, variante: 'A' });
      expect(m.html).toContain(t.preCabecalho);
      expect(m.html).toContain('Oi, Ana.');
      expect(m.html).toContain(`>${t.botao}</a>`);
      expect(m.html).toContain(`PS: ${t.ps}`);
      expect(m.html).toContain('Carla, da SolarDoc');
      for (const linha of t.corpo) { expect(m.html).toContain(linha); expect(linha).toMatch(/^\p{Lu}/u); }
      expect(`${m.subject}${m.html}`).not.toMatch(/[—–]/);
      expect(`${m.subject}${m.html}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(montarEmailRetomada({ nome: '', email: 'a@x.com', segmento: 'ex_assinante', variante: 'A' }).html).toContain('>Oi.</p>');
  });
});

describe('o envio pelo mailer', () => {
  it('sai pelo sendMarketingEmail: assunto, botão com o link, descadastro e List-Unsubscribe', async () => {
    await sendEmailRetomadaBase({ to: 'ana@exemplo.com', userId: 'u-1', nome: 'Ana', segmento: 'ex_assinante', variante: 'A' });
    expect(enviados).toHaveLength(1);
    const e = enviados[0];
    expect(e.to).toBe('ana@exemplo.com');
    expect(e.subject).toBe('Ana, entrou muita coisa nova na SolarDoc desde que você saiu');
    expect(e.html).toContain('pagar=pix&amp;email=ana%40exemplo.com');
    expect(e.html).toContain('utm_campaign=base_ex_assinante');
    expect(e.html).toContain('Descadastrar');
    expect(e.headers['List-Unsubscribe']).toMatch(/unsubscribe\?u=u-1/);
    expect(e.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('a ligação no /cron/master', () => {
  const fonte = readFileSync(join(__dirname, '..', 'routes', 'cron.ts'), 'utf8');
  const master = fonte.slice(fonte.indexOf('// ─── MASTER CRON'));
  it('a tarefa email-retomada está na lista do master, no formato [chave, () => fn()], e ESTÁ FORA do /process-messages', () => {
    expect(master).toMatch(/\['email-retomada',\s*\(\)\s*=>\s*rodarEmailRetomada\(\)\]/);
    expect(fonte.slice(0, fonte.indexOf('// ─── MASTER CRON'))).not.toContain('rodarEmailRetomada()');
  });
  it('a rota de contar só conta: nunca chama a rodada', () => {
    const rota = fonte.slice(fonte.indexOf("router.get('/email-retomada-contar'"), fonte.indexOf("router.get('/pesquisa-satisfacao'"));
    expect(rota).toContain('contarEmailRetomada()');
    expect(rota).toContain('verifyCronSecret');
    expect(rota).not.toContain('rodarEmailRetomada');
  });
});
