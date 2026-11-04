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
import { runDunning, sendDunningDay0, textoWhatsappDunning, LINK_PIX_AUTOMATICO_DUNNING } from '../services/dunningService';
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
