import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// LEMBRETE DE RENOVAÇÃO DO PIX (pixVipReminderService) atrás do portão anti-ban da linha 5040 (chefe-antiban, 04/11/2026).
// Banco em memória e relógio fixo (só o Date). Janela, claim e o texto são os REAIS; o envio, o teto/espaçamento, a pausa humana
// e a lista de mudos são falsos e controlados.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  frio: [] as Array<{ tel: string; partes: string[]; instancia: string }>,
  frioRetorno: true as boolean,
  frioErro: false as boolean,
  teto: true,
  espacamento: true,
  podeFalar: true,
  mudos: new Set<string>(),
  suprimidos: new Set<string>(),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, linhaEmCooldown: () => false, solardocViaIo: () => false, sleep: async () => undefined,
  sendHuman: vi.fn(async () => { throw new Error('o lembrete não pode usar sendHuman'); }),
  sendFrio: vi.fn(async (tel: string, partes: string[], instancia: string) => {
    h.frio.push({ tel, partes, instancia });
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
import { runPixVipReminder, montarPartes, LINK_PIX_AUTOMATICO_RENOVACAO } from '../services/agents/whatsapp/pixVipReminderService';
import { dentroDoTetoHorarioLinha } from '../services/agents/whatsapp/lineThrottle';
import { emBolhas } from '../services/agents/bolhas';

// Quarta-feira, 04/11/2026, 10h de Brasília: dia útil, sem feriado.
const DEZ_BRT = '2026-11-04T13:00:00.000Z';
const VINTE_E_UMA_BRT = '2026-11-05T00:00:00.000Z';
const DOMINGO_DEZ_BRT = '2026-11-08T13:00:00.000Z';
const VENCE = '2026-11-05T12:00:00.000Z';

function usuario(over: Record<string, unknown> = {}): void {
  const n = banco.linhas('users').length + 1;
  banco.poe('users', {
    id: `u${n}`, email: `u${n}@x.com`, nome: 'Leo Silva', whatsapp: `55349911100${n}`, plano: 'ilimitado',
    plano_expira_em: VENCE, pix_reminder_last_sent_at: null, whatsapp_opt_out: false, ...over,
  });
}
const u = (id: string) => banco.linhas('users').find(x => x.id === id)!;
const claims = () => banco.linhas('system_state').filter(r => String(r.key).startsWith('pix_vip_sent:'));

beforeEach(() => {
  banco.reset();
  h.frio.length = 0; h.frioRetorno = true; h.frioErro = false; h.teto = true; h.espacamento = true; h.podeFalar = true;
  h.mudos.clear(); h.suprimidos.clear();
  delete process.env.PIX_MENSAL_OFF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(DEZ_BRT));
});
afterEach(() => { vi.useRealTimers(); });

describe('texto do lembrete de renovação', () => {
  it('L1 (com nome) e L2 (sem nome), data dd/mm, link do Pix automático sem utm_term, UMA bolha', () => {
    const link = 'https://solardoc.app/?pagar=pix&utm_source=renovacao&utm_medium=whatsapp';
    expect(LINK_PIX_AUTOMATICO_RENOVACAO).toBe(link);
    const l1 = montarPartes('Leo Silva', VENCE);
    expect(l1).toEqual([`Oi, Leo, aqui é a Carla, da SolarDoc. Seu acesso vence em 05/11. Que tal assinar o Pix automático em ${link}, para não precisar pagar nem mandar comprovante todo mês? Na hora de assinar, use o e-mail da sua conta.`]);
    const l2 = montarPartes(null, VENCE);
    expect(l2[0]).toMatch(/^Oi, aqui é a Carla, da SolarDoc\. Seu acesso vence em 05\/11\./);
    for (const t of [l1, l2]) {
      expect(t).toHaveLength(1);
      expect(emBolhas(t[0], { maxBolhas: 1, max: 900 })).toHaveLength(1);
      expect(t[0]).not.toContain('utm_term');
      expect(t[0]).not.toMatch(/000201|kiwify|sicredi|—|–/i);
    }
  });
  it('a data sai no horário de Brasília (vence 01h UTC do dia 6 = noite do dia 5)', () => {
    expect(montarPartes(null, '2026-11-06T01:00:00.000Z')[0]).toContain('vence em 05/11');
  });
});

describe('runPixVipReminder atrás do portão', () => {
  it('às 10h de um dia útil: 1 sendFrio, 1 bolha, pela linha solardoc, 1 claim por vencimento, cooldown gravado', async () => {
    usuario();
    const r = await runPixVipReminder();
    expect(r).toEqual({ enviados: 1, pulados: 0, erros: 0 });
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.instancia).toBe('solardoc');
    expect(h.frio[0]!.partes).toHaveLength(1);
    expect(claims().map(c => c.key)).toEqual(['pix_vip_sent:u1:2026-11-05']);
    expect(u('u1').pix_reminder_last_sent_at).toBeTruthy();
    // Rodada seguinte: o cooldown e o claim seguram.
    await runPixVipReminder();
    expect(h.frio).toHaveLength(1);
  });

  it('às 21h e no domingo, 0 envio', async () => {
    usuario();
    vi.setSystemTime(new Date(VINTE_E_UMA_BRT));
    await runPixVipReminder();
    vi.setSystemTime(new Date(DOMINGO_DEZ_BRT));
    await runPixVipReminder();
    expect(h.frio).toHaveLength(0);
    expect(claims()).toHaveLength(0);
    expect(u('u1').pix_reminder_last_sent_at).toBeNull();
  });

  it('teto cheio, 0 envio; espaçamento segurando, 0 envio; depois libera e sai', async () => {
    usuario();
    h.teto = false;
    await runPixVipReminder();
    h.teto = true; h.espacamento = false;
    await runPixVipReminder();
    expect(h.frio).toHaveLength(0);
    h.espacamento = true;
    await runPixVipReminder();
    expect(h.frio).toHaveLength(1);
  });

  it('o teto é consultado com o robô pix_vip_lembrete e sem transacional', async () => {
    usuario();
    await runPixVipReminder();
    expect(dentroDoTetoHorarioLinha).toHaveBeenCalledWith({ transacional: false, robo: 'pix_vip_lembrete' });
  });

  it('duas rodadas juntas (dois relógios): 1 envio só', async () => {
    usuario();
    await Promise.all([runPixVipReminder(), runPixVipReminder()]);
    expect(h.frio).toHaveLength(1);
    expect(claims()).toHaveLength(1);
  });

  it('opt-out, supressão e mudo: 0 envio', async () => {
    usuario({ whatsapp_opt_out: true });
    usuario({ whatsapp: '5534992220002' });
    usuario({ whatsapp: '5534992220003' });
    h.suprimidos.add('5534992220002');
    h.mudos.add('5534992220003');
    const r = await runPixVipReminder();
    expect(h.frio).toHaveLength(0);
    expect(r.enviados).toBe(0);
    expect(r.pulados).toBe(3);
  });

  it('1 envio por rodada: o segundo usuário espera a rodada seguinte', async () => {
    usuario();
    usuario();
    const r = await runPixVipReminder();
    expect(r.enviados).toBe(1);
    expect(h.frio).toHaveLength(1);
    await runPixVipReminder();
    expect(h.frio).toHaveLength(2);
  });

  it('erro lançado no envio: a rodada para, o claim fica e o próximo usuário não é tentado', async () => {
    h.frioErro = true;
    usuario();
    usuario();
    const r = await runPixVipReminder();
    expect(r.erros).toBe(1);
    expect(h.frio).toHaveLength(1);
    expect(claims()).toHaveLength(1);
    expect(u('u1').pix_reminder_last_sent_at).toBeNull();
  });

  it('sendFrio devolvendo false (pausa humana): o claim é desfeito e a rodada para', async () => {
    h.frioRetorno = false;
    usuario();
    usuario();
    await runPixVipReminder();
    expect(h.frio).toHaveLength(1);
    expect(claims()).toHaveLength(0);
    expect(u('u1').pix_reminder_last_sent_at).toBeNull();
  });

  it('janela do vencimento: vence em 2 dias envia o L1; venceu ontem envia a variante "venceu"; venceu há 10 dias não envia', async () => {
    const link = LINK_PIX_AUTOMATICO_RENOVACAO;
    // Vence em 2 dias (dentro da janela, que é "agora + 2 dias").
    usuario({ plano_expira_em: new Date(Date.now() + 2 * 86_400_000 - 60_000).toISOString() });
    await runPixVipReminder();
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.partes[0]).toMatch(/^Oi, Leo, aqui é a Carla, da SolarDoc\. Seu acesso vence em \d\d\/\d\d\. Que tal assinar o Pix automático em /);
    expect(h.frio[0]!.partes[0]).toContain('para não precisar pagar nem mandar comprovante todo mês?');

    // Venceu ontem.
    banco.reset(); h.frio.length = 0;
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    usuario({ plano_expira_em: ontem });
    await runPixVipReminder();
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0]!.partes[0]).toBe(`Oi, Leo, aqui é a Carla, da SolarDoc. Seu acesso venceu em 03/11. Que tal assinar o Pix automático em ${link}, para voltar a usar e não precisar pagar nem mandar comprovante todo mês? Na hora de assinar, use o e-mail da sua conta.`);
    expect(claims().map(c => c.key)).toEqual([`pix_vip_sent:u1:${ontem.slice(0, 10)}`]);

    // Venceu há 10 dias: fica para a retomada.
    banco.reset(); h.frio.length = 0;
    usuario({ plano_expira_em: new Date(Date.now() - 10 * 86_400_000).toISOString() });
    await runPixVipReminder();
    expect(h.frio).toHaveLength(0);
    expect(claims()).toHaveLength(0);
  });

  it('a variante "venceu" também existe sem nome, em 1 bolha', () => {
    const t = montarPartes(null, '2026-11-03T12:00:00.000Z', new Date(DEZ_BRT).getTime());
    expect(t).toHaveLength(1);
    expect(t[0]).toMatch(/^Oi, aqui é a Carla, da SolarDoc\. Seu acesso venceu em 03\/11\. Que tal assinar o Pix automático em /);
    expect(t[0]).toContain('para voltar a usar e não precisar pagar nem mandar comprovante todo mês?');
    expect(emBolhas(t[0], { maxBolhas: 1, max: 900 })).toHaveLength(1);
  });
});
