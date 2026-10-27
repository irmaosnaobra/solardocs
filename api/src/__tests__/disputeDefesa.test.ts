import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mocks do watcher (declarados antes de importar o módulo) ──────────────────
const S = vi.hoisted(() => ({
  disputes: { list: vi.fn(), update: vi.fn(), retrieve: vi.fn() },
  customers: { search: vi.fn() },
  charges: { list: vi.fn() },
  subscriptions: { list: vi.fn() },
  radar: { earlyFraudWarnings: { list: vi.fn() } },
}));
const mail = vi.hoisted(() => ({ sendOpsAlert: vi.fn() }));

vi.mock('stripe', () => ({ default: class { constructor() { return S as any; } } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/mailer', () => mail);
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { banco } from './_bancoFalso';
import {
  CAMPOS_ARQUIVO, CAMPOS_TEXTO, CtxDefesa, ctxVazio, decidirDefesa, montarEvidencia, TETO_CAMPO, cortar,
} from '../services/disputeDefesa';
import { runDisputeWatch, preverDefesa } from '../services/disputeWatcher';

const AGORA = Date.parse('2026-10-27T15:00:00Z');
const seg = (ms: number) => Math.floor(ms / 1000);
const H = 3_600_000;
const D = 86_400_000;

const cobranca = (o: any = {}) => ({
  id: 'ch_1', amount: 6700, created: seg(AGORA - 5 * D), customer: 'cus_A', status: 'succeeded',
  refunded: false, amount_refunded: 0, disputed: true,
  billing_details: { name: 'Fulano de Tal', email: 'Fulano@Exemplo.com' },
  payment_method_details: { card: { brand: 'mastercard', last4: '3859', country: 'BR', checks: { cvc_check: 'pass' }, three_d_secure: { result: 'authenticated' } } },
  outcome: { type: 'authorized' },
  ...o,
});

const disputa = (o: any = {}) => ({
  id: 'du_1',
  status: 'needs_response',
  reason: 'fraudulent',
  amount: 6700,
  created: seg(AGORA - 1 * H),
  evidence: { customer_purchase_ip: '179.135.228.149' },
  evidence_details: { due_by: seg(AGORA + 10 * D), has_evidence: false, submission_count: 0 },
  charge: cobranca(),
  ...o,
});

const resumo = (o: any = {}) => ({
  id: 'ch_2', amount: 6700, created: seg(AGORA - 5 * D + 1 * D), email: 'fulano@exemplo.com', customer: 'cus_B',
  status: 'succeeded', refunded: false, amount_refunded: 0, disputed: false, ...o,
});

const ctxComUso = (o: Partial<CtxDefesa> = {}): CtxDefesa => ({
  ...ctxVazio(),
  conta: { id: 'u1', email: 'fulano@exemplo.com', created_at: '2026-06-01T10:00:00Z', plano: 'pro' },
  empresa: { nome: 'Solar Tal Ltda', cnpj: '12.345.678/0001-90', cidade: 'Cacoal / RO' },
  docs: {
    total: 3, primeiro: '2026-10-20T04:00:00Z', // gravado 3h adiantado: o dia REAL em Brasília é 19/10
    rows: [
      { created_at: '2026-10-26T14:00:00Z', tipo: 'proposta' },
      { created_at: '2026-10-22T14:00:00Z', tipo: 'proposta' },
      { created_at: '2026-10-20T04:00:00Z', tipo: 'contrato' },
    ],
  },
  eventos: { total: 12, ultimo: '2026-10-26T15:00:00Z' },
  ...o,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('decidirDefesa', () => {
  const dec = (d: any, ctx = ctxComUso()) => decidirDefesa(d, ctx, AGORA).acao;

  it('ignora o que não está esperando resposta', () => {
    for (const status of ['under_review', 'won', 'lost', 'needs_response_closed'])
      expect(dec(disputa({ status }))).toBe('ignorar');
  });

  it('aceita needs_response e warning_needs_response', () => {
    expect(dec(disputa({ status: 'warning_needs_response', created: seg(AGORA - 3 * D) }))).toBe('enviar');
  });

  it('ja_enviada quando a Stripe já tem submissão, mesmo com o freio ligado', () => {
    const d = disputa({ evidence_details: { due_by: seg(AGORA + 10 * D), has_evidence: true, submission_count: 1 } });
    expect(dec(d)).toBe('ja_enviada');
    expect(dec(d, ctxComUso({ autoOff: true }))).toBe('ja_enviada');
  });

  it('desligado com DISPUTA_AUTO_OFF', () => {
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctxComUso({ autoOff: true }))).toBe('desligado');
  });

  it('avisar_rascunho quando já há evidência salva à mão', () => {
    const d = disputa({ created: seg(AGORA - 3 * D), evidence_details: { due_by: seg(AGORA + 10 * D), has_evidence: true, submission_count: 0 } });
    expect(dec(d)).toBe('avisar_rascunho');
  });

  it('avisar_duplicada quando o motivo é duplicate', () => {
    expect(dec(disputa({ reason: 'duplicate', created: seg(AGORA - 3 * D) }))).toBe('avisar_duplicada');
  });

  it('avisar_duplicada por OUTRO Customer com o mesmo e-mail, mesmo valor, perto no tempo', () => {
    const ctx = ctxComUso({ cobrancasEmail: [resumo({ id: 'ch_1', customer: 'cus_A' }), resumo()] });
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctx)).toBe('avisar_duplicada');
  });

  it('a própria cobrança contestada não conta como duplicata', () => {
    const ctx = ctxComUso({ cobrancasEmail: [resumo({ id: 'ch_1' })] });
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctx)).toBe('enviar');
  });

  it('não é duplicata: valor diferente, estornada, falhou ou mais de 25 dias de distância', () => {
    const base = seg(AGORA - 5 * D);
    const casos = [
      resumo({ amount: 2700 }),
      resumo({ refunded: true, amount_refunded: 6700 }),
      resumo({ amount_refunded: 100 }),
      resumo({ status: 'failed' }),
      resumo({ created: base - 26 * 86400 }),
    ];
    for (const c of casos) {
      expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctxComUso({ cobrancasEmail: [c] }))).toBe('enviar');
    }
  });

  it('é duplicata a 25 dias de distância (limite incluso)', () => {
    const c = resumo({ created: seg(AGORA - 5 * D) - 25 * 86400 });
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctxComUso({ cobrancasEmail: [c] }))).toBe('avisar_duplicada');
  });

  it('avisar_duplicada quando o e-mail tem mais de 1 assinatura ativa', () => {
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctxComUso({ assinaturasAtivasEmail: 2 }))).toBe('avisar_duplicada');
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctxComUso({ assinaturasAtivasEmail: 1 }))).toBe('enviar');
  });

  it('avisar_sem_uso: sem conta, sem documento e sem evento', () => {
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctxVazio())).toBe('avisar_sem_uso');
  });

  it('avisar_sem_uso também quando a conta existe com 0 documentos e 0 eventos', () => {
    const ctx = ctxComUso({ docs: { total: 0, primeiro: null, rows: [] }, eventos: { total: 0, ultimo: null } });
    const r = decidirDefesa(disputa({ created: seg(AGORA - 3 * D) }), ctx, AGORA);
    expect(r.acao).toBe('avisar_sem_uso');
    expect(r.motivo).toContain('a conta existe');
  });

  it('só documento ou só evento já basta para defender', () => {
    const soDoc = ctxComUso({ eventos: { total: 0, ultimo: null } });
    const soEvento = ctxComUso({ docs: { total: 0, primeiro: null, rows: [] } });
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), soDoc)).toBe('enviar');
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), soEvento)).toBe('enviar');
  });

  it('sem conta mas com algum uso registrado ainda defende', () => {
    const ctx = ctxComUso({ conta: null });
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }), ctx)).toBe('enviar');
  });

  it('esperar dentro das 48h com prazo folgado', () => {
    expect(dec(disputa())).toBe('esperar');
  });

  it('as 48h contam da abertura (d.created), não de aviso nenhum', () => {
    expect(dec(disputa({ created: seg(AGORA - 47 * H) }))).toBe('esperar');
    expect(dec(disputa({ created: seg(AGORA - 49 * H) }))).toBe('enviar');
  });

  it('prazo de 2 dias ou menos força o envio mesmo dentro das 48h', () => {
    const curto = (ms: number) => disputa({ evidence_details: { due_by: seg(AGORA + ms), has_evidence: false, submission_count: 0 } });
    expect(dec(curto(36 * H))).toBe('enviar');
    expect(dec(curto(2 * D))).toBe('enviar');           // exatamente 2 dias não é "mais de 2"
    expect(dec(curto(2 * D + 60_000))).toBe('esperar');
  });

  it('enviar nos demais casos', () => {
    expect(dec(disputa({ created: seg(AGORA - 3 * D) }))).toBe('enviar');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('montarEvidencia', () => {
  const ev = (d: any = disputa(), ctx = ctxComUso()) => montarEvidencia(d, d.charge, ctx);

  it('só campos de texto: nenhum campo de arquivo, nenhum fora da lista', () => {
    const e = ev();
    for (const k of Object.keys(e)) {
      expect(CAMPOS_TEXTO as readonly string[]).toContain(k);
      expect(CAMPOS_ARQUIVO as readonly string[]).not.toContain(k);
    }
    for (const arquivo of CAMPOS_ARQUIVO) expect(e).not.toHaveProperty(arquivo);
  });

  it('não escreve política de reembolso nem de cancelamento (não há termos no ar para citar)', () => {
    const e = ev();
    expect(e).not.toHaveProperty('refund_policy_disclosure');
    expect(e).not.toHaveProperty('cancellation_policy_disclosure');
  });

  it('preenche os campos esperados com dado da Stripe e do banco', () => {
    const e = ev();
    expect(e.product_description).toContain('https://solardoc.app');
    expect(e.customer_name).toBe('Fulano de Tal');
    expect(e.customer_email_address).toBe('fulano@exemplo.com');
    expect(e.customer_purchase_ip).toBe('179.135.228.149');
    expect(e.access_activity_log).toContain('Documentos gerados na plataforma: 3');
    expect(e.access_activity_log).toContain('12.345.678/0001-90');
    expect(e.uncategorized_text).toContain('Cartão Mastercard final 3859');
    expect(e.uncategorized_text).toContain('CVC');
    expect(e.uncategorized_text).toContain('3D Secure');
  });

  it('service_date é AAAA-MM-DD no dia da cobrança em Brasília', () => {
    const d = disputa({ charge: cobranca({ created: seg(Date.parse('2026-10-22T01:30:00Z')) }) }); // 21/10 22:30 em Brasília
    expect(ev(d).service_date).toBe('2026-10-21');
  });

  it('customer_purchase_ip só entra se o IP existir', () => {
    expect(ev(disputa({ evidence: {} }))).not.toHaveProperty('customer_purchase_ip');
  });

  it('dia do documento desconta as 3h do banco', () => {
    // gravado 20/10 04:00Z => real 20/10 01:00Z => 19/10 22:00 em Brasília
    const log = ev().access_activity_log;
    expect(log).toContain('primeiro em 19/10/2026');
    expect(log).not.toContain('primeiro em 20/10/2026');
  });

  it('datas em dd/mm/aaaa', () => {
    const e = ev();
    expect(e.access_activity_log).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(e.access_activity_log).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('teto de 5.000 caracteres por campo', () => {
    const e = ev(disputa(), ctxComUso({ empresa: { nome: 'X'.repeat(9000), cnpj: '1', cidade: 'Y' } }));
    for (const v of Object.values(e)) expect(v.length).toBeLessThanOrEqual(TETO_CAMPO);
    expect(e.access_activity_log.length).toBe(Math.min(e.access_activity_log.length, TETO_CAMPO));
  });

  it('cortar não passa do limite e corta em linha inteira quando dá', () => {
    const t = Array.from({ length: 400 }, (_, i) => `linha numero ${i}`).join('\n');
    const c = cortar(t, 1000);
    expect(c.length).toBeLessThanOrEqual(1000);
    expect(c.endsWith('…')).toBe(true);
    expect(cortar('curto', 1000)).toBe('curto');
  });

  it('sem travessão em nenhum texto', () => {
    const e = ev(disputa(), ctxComUso({ empresa: { nome: 'Solar — Tal – Ltda', cnpj: '1', cidade: 'Y' } }));
    for (const v of Object.values(e)) expect(v).not.toMatch(/[—–]/);
  });

  it('cancellation_rebuttal só em subscription_canceled, com fato da Stripe', () => {
    const sub = { id: 'sub_1', status: 'active', created: seg(AGORA - 40 * D), canceled_at: null, cancel_at: null, cancel_at_period_end: false, trial_end: null };
    const cancelada = disputa({ reason: 'subscription_canceled' });
    const e = ev(cancelada, ctxComUso({ assinaturaDaCobranca: sub }));
    expect(e.cancellation_rebuttal).toContain('sub_1');
    expect(e.cancellation_rebuttal).toContain('cancel_at_period_end falso');

    // outro motivo: nunca
    expect(ev(disputa(), ctxComUso({ assinaturaDaCobranca: sub }))).not.toHaveProperty('cancellation_rebuttal');
    // sem assinatura achada: não inventa
    expect(ev(cancelada, ctxComUso())).not.toHaveProperty('cancellation_rebuttal');
    // cancelada ANTES da cobrança: não contesta o fato
    const antes = { ...sub, status: 'canceled', canceled_at: seg(AGORA - 20 * D) };
    expect(ev(cancelada, ctxComUso({ assinaturaDaCobranca: antes }))).not.toHaveProperty('cancellation_rebuttal');
    // cancelamento marcado para o fim do período
    const agendada = { ...sub, cancel_at_period_end: true };
    expect(ev(cancelada, ctxComUso({ assinaturaDaCobranca: agendada }))).not.toHaveProperty('cancellation_rebuttal');
    // cancelada DEPOIS da cobrança: vale
    const depois = { ...sub, status: 'canceled', canceled_at: seg(AGORA - 1 * D) };
    expect(ev(cancelada, ctxComUso({ assinaturaDaCobranca: depois })).cancellation_rebuttal).toContain('sub_1');
  });

  it('cobranças anteriores do mesmo e-mail que nunca foram contestadas entram no texto', () => {
    const ctx = ctxComUso({
      cobrancasEmail: [
        resumo({ id: 'ch_1', created: seg(AGORA - 5 * D), disputed: true }),
        resumo({ id: 'ch_old1', created: seg(Date.parse('2026-08-20T12:00:00Z')) }),
        resumo({ id: 'ch_old2', created: seg(Date.parse('2026-09-20T12:00:00Z')) }),
        resumo({ id: 'ch_dis', created: seg(Date.parse('2026-07-20T12:00:00Z')), disputed: true }),
        resumo({ id: 'ch_ref', created: seg(Date.parse('2026-06-20T12:00:00Z')), refunded: true, amount_refunded: 6700 }),
      ],
    });
    const t = ev(disputa(), ctx).uncategorized_text;
    expect(t).toContain('2 cobranças que nunca foram contestadas');
    expect(t).toContain('20/08/2026');
    expect(t).toContain('20/09/2026');
    expect(t).not.toContain('20/07/2026');
  });

  it('conta sem uso não afirma uso', () => {
    const e = ev(disputa(), ctxComUso({ docs: { total: 0, primeiro: null, rows: [] }, eventos: { total: 0, ultimo: null }, empresa: null }));
    expect(e.access_activity_log).toContain('Documentos gerados na plataforma: 0');
    expect(e.uncategorized_text).toContain('Não há registro de documentos gerados nem de ferramentas usadas');
  });

  it('o período vem do intervalo da Stripe: mensal, anual, ou nenhum', () => {
    const base = { id: 'sub_1', status: 'active', created: seg(AGORA - 40 * D), canceled_at: null, cancel_at: null, cancel_at_period_end: false, trial_end: null };
    const com = (intervalo: string | null | undefined) => ev(disputa(), ctxComUso({ assinaturaDaCobranca: { ...base, intervalo } }));
    expect(com('month').product_description).toContain('assinatura mensal');
    expect(com('month').uncategorized_text).toContain('por assinatura mensal');
    expect(com('year').product_description).toContain('assinatura anual');
    expect(com('year').uncategorized_text).not.toContain('mensal');
    for (const e of [com(null), com(undefined), ev(disputa(), ctxComUso())]) {
      expect(e.product_description).not.toMatch(/mensal|anual/);
      expect(e.uncategorized_text).not.toMatch(/mensal|anual/);
    }
  });

  it('exemplo de saída (fixture)', () => {
    const e = ev();
    if (process.env.MOSTRAR_EVIDENCIA) {
      // Só para o dono conferir o texto: MOSTRAR_EVIDENCIA=<arquivo> grava o exemplo.
      require('fs').writeFileSync(
        process.env.MOSTRAR_EVIDENCIA,
        `--- access_activity_log ---\n${e.access_activity_log}\n--- uncategorized_text ---\n${e.uncategorized_text}`,
      );
    }
    expect(e.uncategorized_text.length).toBeGreaterThan(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDisputeWatch (stripe e supabase falsos)', () => {
  const chargeBruto = (o: any = {}) => cobranca({ ...o });
  let autoOffAntes: string | undefined;

  function preparar(d: any, cobrancasDoCliente: any[] = [chargeBruto()], subs: any[] = []) {
    banco.reset();
    banco.poe('users', { id: 'u1', email: 'fulano@exemplo.com', created_at: '2026-06-01T10:00:00Z', plano: 'pro' });
    banco.poe('documents', { user_id: 'u1', created_at: '2026-10-20T04:00:00Z', tipo: 'proposta' }, { user_id: 'u1', created_at: '2026-10-26T14:00:00Z', tipo: 'proposta' });
    banco.poe('feature_events', { user_id: 'u1', created_at: '2026-10-26T15:00:00Z' });
    banco.poe('company', { user_id: 'u1', nome: 'Solar Tal Ltda', cnpj: '12.345.678/0001-90', cidade: 'Cacoal / RO' });
    S.disputes.list.mockResolvedValue({ data: [d] });
    S.disputes.update.mockResolvedValue({ id: d.id, status: 'under_review' });
    S.customers.search.mockResolvedValue({ data: [{ id: 'cus_A' }] });
    S.charges.list.mockResolvedValue({ data: cobrancasDoCliente });
    S.subscriptions.list.mockResolvedValue({ data: subs });
    S.radar.earlyFraudWarnings.list.mockResolvedValue({ data: [] });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    Object.values(S).forEach((g: any) => Object.values(g).forEach((f: any) => (f.mockReset ? f.mockReset() : Object.values(f).forEach((x: any) => x.mockReset()))));
    mail.sendOpsAlert.mockReset();
    mail.sendOpsAlert.mockResolvedValue(undefined);
    autoOffAntes = process.env.DISPUTA_AUTO_OFF;
    delete process.env.DISPUTA_AUTO_OFF;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (autoOffAntes === undefined) delete process.env.DISPUTA_AUTO_OFF; else process.env.DISPUTA_AUTO_OFF = autoOffAntes;
  });

  it('ENVIA com submit:true explícito só na ação enviar, e avisa o dono com o texto inteiro', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    const r = await runDisputeWatch();

    expect(S.disputes.update).toHaveBeenCalledTimes(1);
    const [id, corpo] = S.disputes.update.mock.calls[0]!;
    expect(id).toBe('du_1');
    expect(corpo.submit).toBe(true);
    for (const k of Object.keys(corpo.evidence)) {
      expect(CAMPOS_TEXTO as readonly string[]).toContain(k);
      expect(CAMPOS_ARQUIVO as readonly string[]).not.toContain(k);
    }
    expect(r.defendidas).toBe(1);

    const assuntos = mail.sendOpsAlert.mock.calls.map((c) => c[0] as string);
    const defendida = mail.sendOpsAlert.mock.calls.find((c) => /Contestação defendida automaticamente/.test(c[0]));
    expect(assuntos.some((a) => /R\$ 67,00/.test(a))).toBe(true);
    expect(defendida).toBeTruthy();
    expect(defendida![1]).toContain('https://dashboard.stripe.com/disputes/du_1');
    expect(defendida![1]).toContain('uncategorized_text');
    expect(defendida![1]).toContain('access_activity_log');

    const estado = banco.linhas('system_state').find((x) => x.key === 'stripe_dispute_watch')!.value;
    expect(estado.auto.du_1.acao).toBe('enviada');
  });

  it('dentro das 48h: não envia e o e-mail de abertura diz quando a defesa sai', async () => {
    preparar(disputa());
    const r = await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(r.defendidas).toBe(0);
    const abertura = mail.sendOpsAlert.mock.calls[0]!;
    expect(abertura[1]).toContain('A defesa sai sozinha em 29/10');
    expect(abertura[1]).toContain('DISPUTA_AUTO_OFF=1');
    expect(abertura[1]).not.toContain('submit=false');
  });

  it('esperar de ontem vira enviar hoje, mesmo sem novo e-mail de abertura', async () => {
    preparar(disputa());
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    vi.setSystemTime(AGORA + 3 * D);
    S.disputes.list.mockResolvedValue({ data: [disputa()] });
    await runDisputeWatch();
    expect(S.disputes.update).toHaveBeenCalledTimes(1);
    expect(S.disputes.update.mock.calls[0]![1].submit).toBe(true);
  });

  it('duplicada por outro Customer com o mesmo e-mail: NÃO envia e explica por e-mail', async () => {
    const d = disputa({ created: seg(AGORA - 3 * D) });
    preparar(d, [chargeBruto(), chargeBruto({ id: 'ch_2', customer: 'cus_B', disputed: false, created: seg(AGORA - 4 * D), billing_details: { email: 'fulano@exemplo.com' } })]);
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(mail.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(mail.sendOpsAlert.mock.calls[0]![1]).toContain('NÃO será defendida automaticamente');
    expect(mail.sendOpsAlert.mock.calls[0]![1]).toContain('aceitar a disputa');
  });

  it('DISPUTA_AUTO_OFF: não envia e o aviso de hoje continua igual', async () => {
    process.env.DISPUTA_AUTO_OFF = '1';
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(mail.sendOpsAlert.mock.calls[0]![1]).toContain('submit=false');
  });

  it('rascunho e submissão já feita: nunca chama update', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D), evidence_details: { due_by: seg(AGORA + 10 * D), has_evidence: true, submission_count: 0 } }));
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();

    preparar(disputa({ created: seg(AGORA - 3 * D), evidence_details: { due_by: seg(AGORA + 10 * D), has_evidence: true, submission_count: 1 } }));
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
  });

  it('conta sem uso: não envia', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    banco.reset();
    S.disputes.list.mockResolvedValue({ data: [disputa({ created: seg(AGORA - 3 * D) })] });
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(mail.sendOpsAlert.mock.calls[0]![1]).toContain('NÃO será defendida automaticamente');
  });

  it('falha da Stripe: e-mail FALHOU no máximo 1 por dia e tenta de novo na rodada seguinte', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    S.disputes.update.mockRejectedValue(new Error('No such file_upload'));
    await runDisputeWatch();
    const falhou = () => mail.sendOpsAlert.mock.calls.filter((c) => /Defesa automática FALHOU/.test(c[0])).length;
    expect(falhou()).toBe(1);
    expect(mail.sendOpsAlert.mock.calls.find((c) => /FALHOU/.test(c[0]))![1]).toContain('No such file_upload');

    await runDisputeWatch(); // mesma data
    expect(S.disputes.update).toHaveBeenCalledTimes(2);
    expect(falhou()).toBe(1);

    vi.setSystemTime(AGORA + 1 * D);
    await runDisputeWatch();
    expect(S.disputes.update).toHaveBeenCalledTimes(3);
    expect(falhou()).toBe(2);
  });

  it('o estado só guarda disputas abertas', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    await runDisputeWatch();
    S.disputes.list.mockResolvedValue({ data: [] });
    await runDisputeWatch();
    const estado = banco.linhas('system_state').find((x) => x.key === 'stripe_dispute_watch')!.value;
    expect(estado.auto).toEqual({});
    expect(estado.avisadas).toEqual({});
  });

  it('a prévia não traz e-mail, nome completo, CNPJ, IP nem final do cartão', async () => {
    const d = disputa({ created: seg(AGORA - 3 * D), evidence: { customer_purchase_ip: '179.135.228.149', customer_name: 'Fulano de Tal' } });
    preparar(d);
    S.disputes.retrieve.mockResolvedValue(d);
    const r = await preverDefesa('du_1');
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/fulano@exemplo.com/i);
    expect(json).not.toContain('12.345.678/0001-90');
    expect(json).not.toContain('12345678000190');
    expect(json).not.toContain('179.135.228.149');
    expect(json).not.toContain('3859');
    expect(json).not.toContain('Fulano de Tal');
    expect(json.toLowerCase()).toContain('f***@exemplo.com');
    expect(json).toContain('**.***.***/****-90');
    expect(json).toContain('final ****');
    expect(r.evidencia).not.toHaveProperty('customer_purchase_ip');
    expect(r.evidencia.customer_name).toBe('Fulano');
  });

  it('a evidência que vai para a Stripe NÃO é mascarada', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    await runDisputeWatch();
    const ev = S.disputes.update.mock.calls[0]![1].evidence;
    expect(ev.customer_email_address).toBe('fulano@exemplo.com');
    expect(ev.customer_purchase_ip).toBe('179.135.228.149');
    expect(ev.access_activity_log).toContain('12.345.678/0001-90');
    expect(ev.uncategorized_text).toContain('final 3859');
  });

  it('FALHOU: erro do banco no meio da busca nunca vira enviar nem "0 documentos"', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    banco.falhas['feature_events.select'] = { erro: { message: 'boom' }, uma: true };
    const r = await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(r.defendidas).toBe(0);
    const falhou = mail.sendOpsAlert.mock.calls.find((c) => /Defesa automática FALHOU/.test(c[0]));
    expect(falhou).toBeTruthy();
    expect(falhou![1]).toContain('feature_events');
    const estado = banco.linhas('system_state').find((x) => x.key === 'stripe_dispute_watch')!.value;
    expect(estado.auto.du_1.acao).toBe('falhou');
  });

  it('FALHOU: erro na consulta de users também não envia', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    banco.falhas['users.select'] = { erro: { message: 'sem users' } };
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(mail.sendOpsAlert.mock.calls.some((c) => /FALHOU/.test(c[0]) && /users/.test(c[1]))).toBe(true);
  });

  it('FALHOU: erro do customers.search não envia', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    S.customers.search.mockRejectedValue(new Error('search indisponivel'));
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    const falhou = mail.sendOpsAlert.mock.calls.find((c) => /Defesa automática FALHOU/.test(c[0]));
    expect(falhou![1]).toContain('search indisponivel');
  });

  it('o update leva idempotencyKey com a disputa e o dia (AAAA-MM-DD)', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    await runDisputeWatch();
    expect(S.disputes.update.mock.calls[0]![2]).toEqual({ idempotencyKey: 'defesa-du_1-2026-10-27' });
  });

  it('customers.search: só entra Customer cujo e-mail é igual em minúsculas', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    S.customers.search.mockResolvedValue({ data: [{ id: 'cus_A', email: 'FULANO@exemplo.com' }, { id: 'cus_X', email: 'fulano@exemplo.com.br' }] });
    await runDisputeWatch();
    const clientes = S.charges.list.mock.calls.map((c) => c[0].customer);
    expect(clientes).toContain('cus_A');
    expect(clientes).not.toContain('cus_X');
  });

  it('não-defesa: só marca "já avisei" se o e-mail saiu; se não saiu, avisa de novo depois', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }), [chargeBruto(), chargeBruto({ id: 'ch_2', customer: 'cus_B', disputed: false, created: seg(AGORA - 4 * D) })]);
    mail.sendOpsAlert.mockRejectedValue(new Error('resend fora'));
    await runDisputeWatch();
    let estado = banco.linhas('system_state').find((x) => x.key === 'stripe_dispute_watch')!.value;
    expect(estado.auto?.du_1).toBeUndefined();

    mail.sendOpsAlert.mockReset();
    mail.sendOpsAlert.mockResolvedValue(undefined);
    await runDisputeWatch();
    expect(mail.sendOpsAlert.mock.calls.some((c) => /NÃO defendida automaticamente/.test(c[0]))).toBe(true);
    estado = banco.linhas('system_state').find((x) => x.key === 'stripe_dispute_watch')!.value;
    expect(estado.auto.du_1.acao).toBe('avisar_duplicada');
  });

  it('conta que existe com 0 documentos e 0 eventos: não envia', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    banco.tabelas['documents'] = [];
    banco.tabelas['feature_events'] = [];
    await runDisputeWatch();
    expect(S.disputes.update).not.toHaveBeenCalled();
    expect(mail.sendOpsAlert.mock.calls[0]![1]).toContain('a conta existe');
  });

  it('prévia: razão social de MEI com CPF, cidade e CPF solto não aparecem; a evidência enviada continua inteira', async () => {
    const d = disputa({ created: seg(AGORA - 3 * D) });
    preparar(d);
    banco.tabelas['company'] = [{ user_id: 'u1', nome: 'JOAO DA SILVA 12345678901', cnpj: '12.345.678/0001-90', cidade: 'Cacoal / RO' }];
    banco.poe('documents', { user_id: 'u1', created_at: '2026-10-21T10:00:00Z', tipo: 'contrato 123.456.789-01' });
    S.disputes.retrieve.mockResolvedValue(d);
    const json = JSON.stringify(await preverDefesa('du_1'));
    expect(json).not.toContain('JOAO DA SILVA');
    expect(json).not.toContain('12345678901');
    expect(json).not.toContain('123.456.789-01');
    expect(json).not.toContain('Cacoal');
    expect(json).toContain('JOAO');
    expect(json).not.toMatch(/\d{11}/);

    await runDisputeWatch();
    const ev = S.disputes.update.mock.calls[0]![1].evidence;
    expect(ev.access_activity_log).toContain('JOAO DA SILVA 12345678901');
    expect(ev.access_activity_log).toContain('Cacoal / RO');
  });

  it('usuário com 2 empresas: a consulta usa limit(1) e a disputa é defendida (não cai em FALHOU)', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    banco.poe('company', { user_id: 'u1', nome: 'Segunda Empresa Ltda', cnpj: '98.765.432/0001-10', cidade: 'Ji-Parana / RO' });
    expect(banco.linhas('company').length).toBe(2);
    const r = await runDisputeWatch();
    expect(r.defendidas).toBe(1);
    expect(S.disputes.update).toHaveBeenCalledTimes(1);
    expect(mail.sendOpsAlert.mock.calls.some((c) => /FALHOU/.test(c[0]))).toBe(false);
  });

  it('falha de ontem à noite (Brasília) conta como "hoje" até a meia-noite de Brasília, não a UTC', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    S.disputes.update.mockRejectedValue(new Error('x'));
    vi.setSystemTime(Date.parse('2026-10-27T22:00:00Z')); // 19:00 em Brasília
    await runDisputeWatch();
    vi.setSystemTime(Date.parse('2026-10-28T01:00:00Z')); // 22:00 em Brasília, já é dia 28 em UTC
    await runDisputeWatch();
    const falhou = mail.sendOpsAlert.mock.calls.filter((c) => /Defesa automática FALHOU/.test(c[0])).length;
    expect(falhou).toBe(1);
    vi.setSystemTime(Date.parse('2026-10-28T04:00:00Z')); // 01:00 do dia 28 em Brasília
    await runDisputeWatch();
    expect(mail.sendOpsAlert.mock.calls.filter((c) => /Defesa automática FALHOU/.test(c[0])).length).toBe(2);
  });

  it('preverDefesa nunca chama disputes.update, nem em disputa que mandaria enviar', async () => {
    preparar(disputa({ created: seg(AGORA - 3 * D) }));
    S.disputes.retrieve.mockResolvedValue(disputa({ created: seg(AGORA - 3 * D) }));
    const r = await preverDefesa('du_1');
    expect(r.decisao.acao).toBe('enviar');
    expect(r.evidencia.uncategorized_text).toBeTruthy();

    S.disputes.retrieve.mockResolvedValue(disputa({ status: 'lost' }));
    expect((await preverDefesa('du_1')).decisao.acao).toBe('ignorar');
    expect(S.disputes.update).not.toHaveBeenCalled();
  });
});
