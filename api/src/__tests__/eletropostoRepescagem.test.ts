import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Repescagem do eletroposto: fala UMA vez com quem chegou durante o apagão da
// linha (01–03/ago). O ritmo é a trava — 1 pessoa a cada 20min, só das 07h às 20h.
// Um erro aqui não dá tela vermelha: vira mensagem em rajada de madrugada, que é
// exatamente como a linha foi bloqueada da primeira vez.

const store = new Map<string, { key: string; value: any; updated_at: string }>();
let tetoLinhaOk = true;
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
let falharEnvio = false;

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _like: null as string | null,
        _key: null as string | null,
        _delete: false,
        select() { return q; },
        like(_col: string, padrao: string) { q._like = padrao.replace(/%$/, ''); return q; },
        or() { return q; },
        eq(_col: string, val: string) { q._key = val; return q; },
        delete() { q._delete = true; return q; },
        limit() {
          const linhas = [...store.values()].filter(r => !q._like || r.key.startsWith(q._like));
          return Promise.resolve({ data: linhas, error: null });
        },
        maybeSingle() {
          const r = q._key ? store.get(q._key) : undefined;
          if (q._delete && r) store.delete(q._key!);
          return Promise.resolve({ data: r ? (q._delete ? { key: r.key } : r) : null, error: null });
        },
        upsert(payload: any) {
          for (const r of (Array.isArray(payload) ? payload : [payload])) store.set(r.key, r);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => {
    if (falharEnvio) throw new Error('[zapi:io] HTTP 400 — whatsapp is disconnected');
    enviadas.push({ phone, bolhas });
  }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoLinhaOk),
}));

const PEND = 'ep_repescagem_pending:';
const ONTEM = '2026-08-02T14:00:00.000Z';

function enfileirar(telefone: string, tipo: 'convite' | 'consultor', readyAt: string) {
  store.set(`${PEND}${telefone}`, {
    key: `${PEND}${telefone}`,
    value: { tipo, nome: 'Fulano de Tal', dono: 'Thiago', ficha_em: ONTEM, ready_at: readyAt, tentativas: 0 },
    updated_at: readyAt,
  });
}

// 12h BRT = dentro da janela; 23h BRT = fora.
const DENTRO = new Date('2026-08-04T15:00:00.000Z');
const FORA = new Date('2026-08-04T02:00:00.000Z');

const envOriginal = { ...process.env };
beforeEach(() => {
  store.clear(); enviadas.length = 0;
  tetoLinhaOk = true; falharEnvio = false;
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

async function tick() {
  const mod = await import('../services/io/eletropostoRepescagem');
  return mod.runRepescagemTick();
}

describe('repescagem do eletroposto', () => {
  it('manda UMA pessoa por tick, mesmo com a fila cheia', async () => {
    vi.setSystemTime(DENTRO);
    enfileirar('5511999990001', 'consultor', '2026-08-04T14:00:00.000Z');
    enfileirar('5511999990002', 'convite',   '2026-08-04T14:10:00.000Z');
    enfileirar('5511999990003', 'consultor', '2026-08-04T14:20:00.000Z');

    const r = await tick();
    expect(r.enviados).toBe(1);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].phone).toBe('5511999990001');   // o mais antigo primeiro
    expect(store.has(`${PEND}5511999990001`)).toBe(false); // consumido
    expect(store.has(`${PEND}5511999990002`)).toBe(true);  // espera a vez
  });

  it('segura o próximo antes de 20min do anterior', async () => {
    vi.setSystemTime(DENTRO);
    enfileirar('5511999990001', 'consultor', '2026-08-04T14:00:00.000Z');
    enfileirar('5511999990002', 'consultor', '2026-08-04T14:00:00.000Z');

    expect((await tick()).enviados).toBe(1);

    vi.setSystemTime(new Date(DENTRO.getTime() + 5 * 60 * 1000));   // +5min
    const r2 = await tick();
    expect(r2.enviados).toBe(0);
    expect(r2.motivo).toBe('intervalo');

    vi.setSystemTime(new Date(DENTRO.getTime() + 21 * 60 * 1000));  // +21min
    expect((await tick()).enviados).toBe(1);
    expect(enviadas).toHaveLength(2);
  });

  it('não manda nada fora de 07h–20h', async () => {
    vi.setSystemTime(FORA);
    enfileirar('5511999990001', 'consultor', '2026-08-04T01:00:00.000Z');

    const r = await tick();
    expect(r.motivo).toBe('fora_da_janela');
    expect(enviadas).toHaveLength(0);
    expect(store.has(`${PEND}5511999990001`)).toBe(true); // marcador intacto
  });

  it('respeita o teto da linha (Bia e followup saem pelo mesmo número)', async () => {
    vi.setSystemTime(DENTRO);
    tetoLinhaOk = false;
    enfileirar('5511999990001', 'consultor', '2026-08-04T14:00:00.000Z');

    const r = await tick();
    expect(r.motivo).toBe('teto_linha');
    expect(store.has(`${PEND}5511999990001`)).toBe(true);
  });

  it('envio que falha volta pra fila, não some', async () => {
    vi.setSystemTime(DENTRO);
    falharEnvio = true;
    enfileirar('5511999990001', 'consultor', '2026-08-04T14:00:00.000Z');

    const r = await tick();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toBe('erro_envio');
    const devolvido = store.get(`${PEND}5511999990001`);
    expect(devolvido).toBeTruthy();
    expect(devolvido!.value.tentativas).toBe(1);
    expect(new Date(devolvido!.value.ready_at).getTime()).toBeGreaterThan(DENTRO.getTime());
  });

  it('kill-switch congela a fila', async () => {
    vi.setSystemTime(DENTRO);
    process.env.EP_REPESCAGEM_OFF = '1';
    enfileirar('5511999990001', 'consultor', '2026-08-04T14:00:00.000Z');

    const r = await tick();
    expect(r.motivo).toBe('desligado');
    expect(enviadas).toHaveLength(0);
  });

  it('o convite atrasado não diz "acabou de fazer" e leva o link do grupo', async () => {
    vi.setSystemTime(DENTRO);
    enfileirar('5511999990002', 'convite', '2026-08-04T14:00:00.000Z');

    await tick();
    const texto = enviadas[0].bolhas.join(' ');
    expect(texto).not.toContain('acabou de fazer');
    expect(texto).toContain('fora do ar');
    expect(texto).toContain('chat.whatsapp.com');
  });

  it('quem preencheu HOJE não ouve "fora do ar por dois dias"', async () => {
    vi.setSystemTime(DENTRO);
    store.set(`${PEND}5511999990009`, {
      key: `${PEND}5511999990009`,
      value: { tipo: 'consultor', nome: 'Fulano', dono: 'Diego', ficha_em: DENTRO.toISOString(), ready_at: '2026-08-04T14:00:00.000Z', tentativas: 0 },
      updated_at: '2026-08-04T14:00:00.000Z',
    });

    await tick();
    const texto = enviadas[0].bolhas.join(' ');
    expect(texto).toContain('hoje de manhã');
    expect(texto).not.toContain('dois dias');
  });

  it('resposta de quem foi repescado é reconhecida uma vez só (e sem o 9º dígito)', async () => {
    vi.setSystemTime(DENTRO);
    const mod = await import('../services/io/eletropostoRepescagem');
    store.set('ep_repescagem_sent:5511999990001', {
      key: 'ep_repescagem_sent:5511999990001',
      value: { sent_at: DENTRO.toISOString(), tipo: 'consultor', nome: 'Victor' },
      updated_at: DENTRO.toISOString(),
    });

    // inbound chega sem o 9 e sem DDI — tem que casar mesmo assim
    const r1 = await mod.respostaPendenteRepescagem('1199990001');
    expect(r1?.nome).toBe('Victor');

    await mod.marcarRespostaAvisada(r1!.telefone, 'quero sim');
    expect(await mod.respostaPendenteRepescagem('5511999990001')).toBeNull();
  });

  it('quem nunca recebeu a repescagem não vira aviso', async () => {
    vi.setSystemTime(DENTRO);
    const mod = await import('../services/io/eletropostoRepescagem');
    expect(await mod.respostaPendenteRepescagem('5511988887777')).toBeNull();
  });

  it('os horários da fila caem de 20 em 20min dentro da janela', async () => {
    vi.setSystemTime(DENTRO);
    const mod = await import('../services/io/eletropostoRepescagem');
    const s = mod.slots(4, DENTRO);

    expect(s).toHaveLength(4);
    for (let i = 1; i < s.length; i++) {
      const dif = new Date(s[i]).getTime() - new Date(s[i - 1]).getTime();
      expect(dif).toBe(20 * 60 * 1000);
    }
  });
});
