import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// DUNNING (dunningService) atrás do portão anti-ban da linha 5040 (chefe-antiban, 04/11/2026).
// D1 a D4 = lembrete frio (portão + claim `dunning_sent:<userId>:<dia>`); D0 = evento (sem portão, 1 bolha, com claim).
// Banco em memória e relógio fixo (só o Date); o envio, o e-mail e as travas da linha são falsos e controlados.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  frio: [] as Array<{ tel: string; partes: string[]; instancia: string; opts?: { transacional?: boolean } }>,
  frioRetorno: true as boolean,
  frioErro: false as boolean,
  emails: [] as Array<{ to: string; subject: string }>,
  proativas: [] as Array<{ userId: string; content: string }>,
  teto: true,
  espacamento: true,
  podeFalar: true,
  mudos: new Set<string>(),
  suprimidos: new Set<string>(),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('resend', () => ({
  Resend: class { emails = { send: vi.fn(async (o: { to: string; subject: string }) => { h.emails.push({ to: o.to, subject: o.subject }); return { error: null }; }) }; },
}));
vi.mock('stripe', () => ({ default: class { subscriptions = { list: async () => ({ data: [] }), cancel: async () => ({}) }; customers = { list: async () => ({ data: [] }) }; } }));
vi.mock('../services/planService', () => ({ FREE_LIMIT: 3 }));
vi.mock('../utils/pixInfo', () => ({ pixBlocoEmailHtml: () => '<div>pix</div>' }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(async (a: { userId: string; content: string }) => { h.proativas.push({ userId: a.userId, content: a.content }); }),
}));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, linhaEmCooldown: () => false, solardocViaIo: () => false, sleep: async () => undefined,
  sendWhatsApp: vi.fn(async () => undefined),
  sendHuman: vi.fn(async () => { throw new Error('o dunning não pode usar sendHuman'); }),
  sendFrio: vi.fn(async (tel: string, partes: string[], instancia: string, opts?: { transacional?: boolean }) => {
    h.frio.push({ tel, partes, instancia, opts });
    if (h.frioErro) throw new Error('Z-API 400: numero invalido');
    return h.frioRetorno;
  }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async () => ({
  ...(await vi.importActual<typeof import('../services/agents/whatsapp/lineThrottle')>('../services/agents/whatsapp/lineThrottle')),
  dentroDoTetoHorarioLinha: vi.fn(async () => h.teto),
  respeitaEspacamentoLinha: vi.fn(async () => h.espacamento),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: vi.fn(async () => (h.podeFalar ? { pode: true, motivo: 'sem-pausa' } : { pode: false, motivo: 'humano-ativo', desde: '', quem: null })),
}));
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  TOQUES_ATE_DESISTIR: 3,
  motivosDaSupressao: vi.fn(async (tel: string) => (h.suprimidos.has(tel) ? ['opt_out'] : [])),
  carregarMudos: vi.fn(async () => (tel: string) => h.mudos.has(tel)),
}));

import { banco } from './_bancoFalso';
import { runDunning, sendDunningDay0, sendDunningRecovered, textoWhatsappDunning, LINK_PIX_AUTOMATICO_DUNNING } from '../services/dunningService';
import { dentroDoTetoHorarioLinha } from '../services/agents/whatsapp/lineThrottle';
import { emBolhas } from '../services/agents/bolhas';

// Quarta-feira, 04/11/2026, 10h de Brasília: dia útil, sem feriado.
const DEZ_BRT = '2026-11-04T13:00:00.000Z';
const VINTE_E_UMA_BRT = '2026-11-05T00:00:00.000Z';
const DOMINGO_DEZ_BRT = '2026-11-08T13:00:00.000Z';
const H = (n: number): string => new Date(Date.now() - n * 3_600_000).toISOString();

function inadimplente(over: Record<string, unknown> = {}): void {
  const n = banco.linhas('users').length + 1;
  banco.poe('users', {
    id: `u${n}`, email: `u${n}@x.com`, nome: 'Leo Silva', whatsapp: `55349911100${n}`, whatsapp_opt_out: false,
    billing_status: 'past_due', past_due_since: H(25), dunning_last_day_sent: 0, plano_expira_em: null, ...over,
  });
}
const u = (id: string) => banco.linhas('users').find(x => x.id === id)!;
const claims = () => banco.linhas('system_state').filter(r => String(r.key).startsWith('dunning_sent:'));

beforeEach(() => {
  banco.reset();
  h.frio.length = 0; h.emails.length = 0; h.proativas.length = 0;
  h.frioRetorno = true; h.frioErro = false; h.teto = true; h.espacamento = true; h.podeFalar = true;
  h.mudos.clear(); h.suprimidos.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(DEZ_BRT));
});
afterEach(() => { vi.useRealTimers(); });

describe('texto do WhatsApp do dunning', () => {
  it('D0 a D4: UMA bolha, com o link do Pix automático (sem utm_term) dentro da frase, sem travessão', () => {
    expect(LINK_PIX_AUTOMATICO_DUNNING).toBe('https://solardoc.app/?pagar=pix&utm_source=dunning&utm_medium=whatsapp');
    for (const dia of [0, 1, 2, 3, 4]) {
      for (const nome of ['Leo Silva', null]) {
        const t = textoWhatsappDunning(nome, dia);
        expect(emBolhas(t, { maxBolhas: 1, max: 900 })).toHaveLength(1);
        expect(t).toContain(LINK_PIX_AUTOMATICO_DUNNING);
        expect(t).not.toContain('utm_term');
        expect(t).not.toMatch(/000201|kiwify|sicredi|—|–/i);
        expect(t).toMatch(/^Oi/);
      }
    }
    expect(textoWhatsappDunning('Leo Silva', 2)).toContain('Oi, Leo!');
    expect(textoWhatsappDunning('Leo Silva', 2)).toContain('mais 3 dias');
  });
});

describe('runDunning D1-D4 atrás do portão', () => {
  it('às 10h de um dia útil: 1 sendFrio em 1 bolha (linha solardoc), 1 claim, e-mail, o dia avança e o histórico é gravado', async () => {
    inadimplente();
    const r = await runDunning();
    expect(r.notified).toBe(1);
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.instancia).toBe('solardoc');
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(h.frio[0]!.opts).toBeUndefined();            // lembrete é frio: a trava de pausa humana vale
    expect(claims().map(c => c.key)).toEqual([`dunning_sent:u1:${H(25).slice(0, 10)}:1`]);   // a chave leva o CICLO (data do past_due_since)
    expect(h.emails).toHaveLength(1);
    expect(u('u1').dunning_last_day_sent).toBe(1);
    expect(h.proativas).toHaveLength(1);
    expect(dentroDoTetoHorarioLinha).toHaveBeenCalledWith({ transacional: false, robo: 'dunning_lembrete' });
  });

  it('às 21h e no domingo: o e-mail sai uma vez, o WhatsApp não, o dia não avança, e o e-mail não repete', async () => {
    inadimplente();
    vi.setSystemTime(new Date(VINTE_E_UMA_BRT));
    banco.linhas('users')[0]!.past_due_since = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await runDunning();
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(1);
    expect(u('u1').dunning_last_day_sent).toBe(0);
    expect(claims()).toHaveLength(0);

    vi.setSystemTime(new Date(DOMINGO_DEZ_BRT));
    banco.linhas('users')[0]!.past_due_since = new Date(Date.now() - 25 * 3_600_000).toISOString();
    banco.linhas('system_state').length = 0;
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(u('u1').dunning_last_day_sent).toBe(0);
  });

  it('teto cheio, 0 envio; espaçamento, 0 envio; depois libera, sai, e o e-mail do dia não repete', async () => {
    inadimplente();
    h.teto = false;
    await runDunning();
    h.teto = true; h.espacamento = false;
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(1);
    h.espacamento = true;
    await runDunning();
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(u('u1').dunning_last_day_sent).toBe(1);
  });

  it('duas rodadas juntas: 1 envio de WhatsApp e 1 e-mail', async () => {
    inadimplente();
    await Promise.all([runDunning(), runDunning()]);
    expect(h.frio).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(claims()).toHaveLength(1);
  });

  it('opt-out, supressão e mudo: sem WhatsApp, e o e-mail e o dia seguem', async () => {
    inadimplente({ whatsapp_opt_out: true });
    inadimplente({ whatsapp: '5534992220002' });
    inadimplente({ whatsapp: '5534992220003' });
    h.suprimidos.add('5534992220002');
    h.mudos.add('5534992220003');
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(h.emails).toHaveLength(3);
    for (const id of ['u1', 'u2', 'u3']) expect(u(id).dunning_last_day_sent).toBe(1);
  });

  it('1 envio por rodada: o segundo usuário espera o próximo tick e o dia dele não avança', async () => {
    inadimplente();
    inadimplente();
    await runDunning();
    expect(h.frio).toHaveLength(1);
    expect(u('u1').dunning_last_day_sent).toBe(1);
    expect(u('u2').dunning_last_day_sent).toBe(0);
    expect(h.emails).toHaveLength(2);
    await runDunning();
    expect(h.frio).toHaveLength(2);
    expect(h.emails).toHaveLength(2);
    expect(u('u2').dunning_last_day_sent).toBe(1);
  });

  it('pausa humana (sendFrio devolve false): o claim é desfeito e o dia não avança', async () => {
    h.frioRetorno = false;
    inadimplente();
    await runDunning();
    expect(claims()).toHaveLength(0);
    expect(u('u1').dunning_last_day_sent).toBe(0);
  });

  it('sendFrio lança erro: o claim fica, o dia avança só com o e-mail e a rodada para', async () => {
    h.frioErro = true;
    inadimplente();
    inadimplente();
    await runDunning();
    expect(h.frio).toHaveLength(1);
    expect(claims()).toHaveLength(1);
    expect(u('u1').dunning_last_day_sent).toBe(1);
    expect(u('u2').dunning_last_day_sent).toBe(0);
  });
});

describe('D0 (evento)', () => {
  it('sai na hora, mesmo às 21h e sem teto, mas em 1 bolha e sem a trava de pausa (transacional)', async () => {
    vi.setSystemTime(new Date(VINTE_E_UMA_BRT));
    h.teto = false;
    inadimplente({ dunning_last_day_sent: null, past_due_since: H(0) });
    await sendDunningDay0('u1');
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(h.frio[0]!.opts).toEqual({ transacional: true });
    expect(emBolhas(h.frio[0]!.partes[0], { maxBolhas: 1, max: 900 })).toHaveLength(1);
    expect(h.frio[0]!.partes[0]).toContain(LINK_PIX_AUTOMATICO_DUNNING);
    expect(claims().map(c => c.key)).toEqual([`dunning_sent:u1:${new Date().toISOString().slice(0, 10)}:0`]);
    expect(u('u1').dunning_last_day_sent).toBe(0);
  });

  it('o webhook e o stripe-sync chamando juntos: 1 WhatsApp só', async () => {
    inadimplente({ dunning_last_day_sent: null, past_due_since: H(0) });
    await Promise.all([sendDunningDay0('u1'), sendDunningDay0('u1')]);
    expect(h.frio).toHaveLength(1);
  });
});

describe('ciclos de cobrança', () => {
  it('um 2º ciclo (past_due_since diferente) manda D0 a D4 de novo, por WhatsApp e por e-mail', async () => {
    inadimplente({ dunning_last_day_sent: null, past_due_since: '2026-11-09T13:00:00.000Z' });
    const ciclo = async (inicio: string) => {
      const t0 = Date.parse(inicio);
      banco.linhas('users')[0]!.past_due_since = inicio;
      banco.linhas('users')[0]!.dunning_last_day_sent = null;
      banco.linhas('users')[0]!.billing_status = 'past_due';
      for (let d = 0; d <= 4; d++) {
        vi.setSystemTime(new Date(t0 + d * 86_400_000 + 3_600_000));   // 11h de Brasília do dia d: dia útil, dentro da janela
        if (d === 0) await sendDunningDay0('u1'); else await runDunning();
        expect(u('u1').dunning_last_day_sent).toBe(d);
      }
    };
    await ciclo('2026-11-09T13:00:00.000Z');                  // segunda: D1 a D4 de terça a sexta
    expect(h.frio).toHaveLength(5);
    expect(h.emails).toHaveLength(5);
    await ciclo('2027-03-08T13:00:00.000Z');                  // o cartão falha de novo em março
    expect(h.frio).toHaveLength(10);
    expect(h.emails).toHaveLength(10);
    const chaves = claims().map(c => c.key);
    expect(chaves).toContain('dunning_sent:u1:2026-11-09:1');
    expect(chaves).toContain('dunning_sent:u1:2027-03-08:1');
    expect(chaves).toContain('dunning_sent:u1:2027-03-08:4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D5 (chefe-antiban, 05/11/2026): o cancelamento e o e-mail saem na hora; o WhatsApp vira pendência `dunning_d5_pend:` (gravada ANTES de o
// past_due_since virar null) e sai pelo mesmo portão do D1 a D4 (janela 9h-20h seg-sáb), 1 por rodada, claim `dunning_sent:<id>:<ciclo>:5`.
// ─────────────────────────────────────────────────────────────────────────────
describe('D5: WhatsApp pendente, pelo portão', () => {
  const DUAS_BRT_SEGUNDA = '2026-11-09T05:00:00.000Z';   // segunda 02h de Brasília
  const DEZ_BRT_SEGUNDA = '2026-11-09T13:00:00.000Z';    // segunda 10h de Brasília
  const pend = () => banco.linhas('system_state').filter(r => String(r.key).startsWith('dunning_d5_pend:'));

  /** Roda o D5 às 02h: cancela, manda o e-mail e deixa o WhatsApp pendente. */
  async function d5DeMadrugada(): Promise<string> {
    vi.setSystemTime(new Date(DUAS_BRT_SEGUNDA));
    inadimplente({ past_due_since: H(5 * 24 + 1), dunning_last_day_sent: 4 });
    const ciclo = String(u('u1').past_due_since).slice(0, 10);
    await runDunning();
    return ciclo;
  }

  it('às 02h: cancela, manda o e-mail, grava a pendência e NÃO manda WhatsApp', async () => {
    const ciclo = await d5DeMadrugada();
    expect(u('u1').plano).toBe('free');
    expect(u('u1').past_due_since).toBeNull();
    expect(u('u1').dunning_last_day_sent).toBe(5);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]!.subject).toMatch(/cancelada/);
    expect(h.frio).toHaveLength(0);
    expect(pend().map(r => r.key)).toEqual([`dunning_d5_pend:u1:${ciclo}`]);
    expect(pend()[0]!.value.estado).toBeUndefined();
    expect(claims()).toHaveLength(0);
  });

  it('às 10h de segunda: manda 1 vez (texto de cancelamento, 1 bolha, claim do ciclo); a rodada seguinte não reenvia', async () => {
    const ciclo = await d5DeMadrugada();
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));
    await runDunning();
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(h.frio[0]!.partes[0]).toContain('Assinatura cancelada');
    expect(h.frio[0]!.partes[0]).not.toContain('último dia');
    expect(h.frio[0]!.opts).toBeUndefined();
    expect(claims().map(c => c.key)).toEqual([`dunning_sent:u1:${ciclo}:5`]);
    expect(pend()[0]!.value.estado).toBe('enviado');
    expect(h.proativas).toHaveLength(1);
    expect(h.emails).toHaveLength(1);   // o e-mail do D5 não repete

    vi.setSystemTime(new Date(Date.parse(DEZ_BRT_SEGUNDA) + 3_600_000));
    await runDunning();
    expect(h.frio).toHaveLength(1);
  });

  it('quem voltou a pagar é descartado (o texto "cancelada" estaria errado)', async () => {
    await d5DeMadrugada();
    u('u1').plano = 'pro';
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(pend()[0]!.value).toMatchObject({ estado: 'descartado', motivo: 'voltou_a_pagar' });
  });

  it('a pendência de 5 dias é descartada, sem envio', async () => {
    await d5DeMadrugada();
    vi.setSystemTime(new Date('2026-11-14T13:00:00.000Z'));   // sábado 10h, 5 dias depois
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(pend()[0]!.value).toMatchObject({ estado: 'descartado', motivo: 'velha' });
  });

  it('fora da janela (segunda 21h30) só espera: nada marcado, nada enviado', async () => {
    await d5DeMadrugada();
    vi.setSystemTime(new Date('2026-11-10T00:30:00.000Z'));   // segunda 21h30 de Brasília: fora da janela
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(pend()[0]!.value.estado).toBeUndefined();
  });

  it('domingo às 10h: sem envio, a pendência fica aberta, e na segunda 10h sai', async () => {
    vi.setSystemTime(new Date('2026-11-07T05:00:00.000Z'));   // sábado 02h: o D5 nasce
    inadimplente({ past_due_since: H(5 * 24 + 1), dunning_last_day_sent: 4 });
    await runDunning();
    vi.setSystemTime(new Date(DOMINGO_DEZ_BRT));              // domingo 10h
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(pend()[0]!.value.estado).toBeUndefined();
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));              // segunda 10h, ainda dentro dos 4 dias
    await runDunning();
    expect(h.frio).toHaveLength(1);
    expect(pend()[0]!.value.estado).toBe('enviado');
  });

  it('o webhook subscription.deleted grava billing_status "suspended" na conta rebaixada: a pendência NÃO é descartada e sai 1 vez', async () => {
    await d5DeMadrugada();
    u('u1').billing_status = 'suspended';   // o que o paymentsController faz depois do cancelamento da Stripe
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));
    await runDunning();
    expect(h.frio).toHaveLength(1);
    expect(pend()[0]!.value.estado).toBe('enviado');
  });

  it('duas rodadas juntas dão 1 envio só, a pendência fica "enviado" e a perdedora não manda para outra pessoa', async () => {
    await d5DeMadrugada();
    inadimplente({ past_due_since: H(5 * 24 + 1), dunning_last_day_sent: 4 });   // u2: segunda pendência
    await runDunning();                                                          // 02h: u2 vira pendência também
    expect(pend()).toHaveLength(2);
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));
    await Promise.all([runDunning(), runDunning()]);
    expect(h.frio).toHaveLength(1);
    expect(claims()).toHaveLength(1);
    const estados = pend().map(r => r.value.estado);
    expect(estados.filter(e => e === 'enviado')).toHaveLength(1);
    expect(estados.filter(e => e === undefined)).toHaveLength(1);                // a outra espera a próxima rodada
    expect(pend().some(r => r.value.estado === 'descartado')).toBe(false);
  });

  it('claim ANTIGO (envio saiu, a pendência não fechou): a 1ª fecha como enviado/claim_antigo, sem reenviar, e a 2ª sai', async () => {
    const ciclo = await d5DeMadrugada();
    inadimplente({ past_due_since: H(5 * 24 + 1), dunning_last_day_sent: 4 });
    await runDunning();                                                         // u2 vira pendência
    banco.poe('system_state', { key: `dunning_sent:u1:${ciclo}:5`, value: { em: new Date(Date.parse(DUAS_BRT_SEGUNDA) + 60_000).toISOString() }, updated_at: DUAS_BRT_SEGUNDA });
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));                                // o claim tem 8h
    await runDunning();
    const p1 = pend().find(r => String(r.key).startsWith('dunning_d5_pend:u1:'))!;
    const p2 = pend().find(r => String(r.key).startsWith('dunning_d5_pend:u2:'))!;
    expect(p1.value).toMatchObject({ estado: 'enviado', motivo: 'claim_antigo' });
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.tel).toBe(u('u2').whatsapp);                              // nada foi reenviado ao u1
    expect(p2.value.estado).toBe('enviado');
  });

  it('claim RECENTE (corrida de verdade): a rodada para, a pendência fica aberta e a próxima não recebe', async () => {
    const ciclo = await d5DeMadrugada();
    inadimplente({ past_due_since: H(5 * 24 + 1), dunning_last_day_sent: 4 });
    await runDunning();
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));
    banco.poe('system_state', { key: `dunning_sent:u1:${ciclo}:5`, value: { em: new Date(Date.now() - 60_000).toISOString() }, updated_at: new Date().toISOString() });
    await runDunning();
    expect(h.frio).toHaveLength(0);
    expect(pend().every(r => r.value.estado === undefined)).toBe(true);
  });

  it('o vencedor do claim que calou (sendFrio false) solta o claim e a pendência continua aberta', async () => {
    await d5DeMadrugada();
    h.frioRetorno = false;
    vi.setSystemTime(new Date(DEZ_BRT_SEGUNDA));
    await runDunning();
    expect(pend()[0]!.value.estado).toBeUndefined();
    expect(claims()).toHaveLength(0);
    h.frioRetorno = true;
    vi.setSystemTime(new Date(Date.parse(DEZ_BRT_SEGUNDA) + 3_600_000));
    await runDunning();
    expect(h.frio.filter(f => f.tel).length).toBe(2);   // 1 tentativa que calou + 1 envio
    expect(pend()[0]!.value.estado).toBe('enviado');
  });
});

describe('sendDunningRecovered: claim contra o reenvio do webhook do Stripe', () => {
  it('dois webhooks iguais dão 1 WhatsApp (e a chave leva o ciclo)', async () => {
    inadimplente({ billing_status: 'active', past_due_since: null, dunning_last_day_sent: null });
    const { sendWhatsApp } = await import('../services/agents/zapiClient');
    const antes = vi.mocked(sendWhatsApp).mock.calls.length;
    await Promise.all([sendDunningRecovered('u1'), sendDunningRecovered('u1')]);
    await sendDunningRecovered('u1');
    expect(vi.mocked(sendWhatsApp).mock.calls.length - antes).toBe(1);
    expect(banco.linhas('system_state').filter(r => String(r.key).startsWith('dunning_recov:u1:'))).toHaveLength(1);
  });
});
