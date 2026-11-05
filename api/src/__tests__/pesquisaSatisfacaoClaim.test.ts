import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Pesquisa de satisfação (chefe-antiban, 05/11/2026): o claim de "já enviado" é um UPDATE condicional (`pesquisa_sent_at` is null) que devolve a
// linha pega. Duas rodadas juntas (Vercel + GitHub Actions) leem o mesmo fila[0]: só uma envia, e a que perdeu não cai no fila[1].
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  frio: [] as Array<{ tel: string; partes: string[] }>,
  frioErro: false,
  frioRetorno: true,
  suprimidos: new Set<string>(),
  mudos: new Set<string>(),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p,
  sendFrio: vi.fn(async (tel: string, partes: string[]) => {
    h.frio.push({ tel, partes });
    if (h.frioErro) throw new Error('Z-API 400');
    return h.frioRetorno;
  }),
}));
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  TOQUES_ATE_DESISTIR: 3,
  motivosDaSupressao: vi.fn(async (tel: string) => (h.suprimidos.has(tel) ? ['opt_out'] : [])),
  carregarMudos: vi.fn(async () => (tel: string) => h.mudos.has(tel)),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ dentroDaJanelaDiurna: () => true }));
vi.mock('../services/agents/whatsapp/carlaThrottle', () => ({
  dentroDoTetoCarla: vi.fn(async () => true),
  marcarEnvioCarla: vi.fn(async () => undefined),
}));

import { banco } from './_bancoFalso';
import { dispararPesquisaSatisfacao } from '../services/pesquisaSatisfacao';

const AGORA = '2026-11-05T15:00:00.000Z';

/** Um cliente ativo, com 6 dias seguidos de proposta (passa o piso de amostra e a continuidade). */
function cliente(n: number): void {
  const id = `u${n}`;
  banco.poe('users', {
    id, email: `u${n}@x.com`, nome: 'Leo Silva', whatsapp: `553499110000${n}`, plano: 'pro', billing_status: 'active',
    whatsapp_opt_out: false, is_admin: false, pesquisa_sent_at: null, created_at: '2026-01-01T00:00:00.000Z',
  });
  for (let d = 0; d < 6; d++) {
    banco.poe('documents', {
      user_id: id, tipo: 'propostaSolar', cliente_nome: `C${d}`,
      created_at: new Date(Date.parse(AGORA) - d * 86_400_000).toISOString(),
    });
  }
}
const u = (id: string) => banco.linhas('users').find(x => x.id === id)!;

beforeEach(() => {
  banco.reset();
  h.frio.length = 0; h.frioErro = false; h.frioRetorno = true; h.suprimidos.clear(); h.mudos.clear();
  delete process.env.PESQUISA_WHATSAPP_OFF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AGORA));
});
afterEach(() => { vi.useRealTimers(); });

describe('pesquisa de satisfação: claim atômico', () => {
  it('duas rodadas simultâneas dão UM envio só, e a que perdeu não cai no fila[1]', async () => {
    cliente(1); cliente(2);
    const [a, b] = await Promise.all([dispararPesquisaSatisfacao(), dispararPesquisaSatisfacao()]);
    expect(h.frio).toHaveLength(1);
    expect([a.enviado, b.enviado].filter(Boolean)).toHaveLength(1);
    expect([a.motivo, b.motivo]).toContain('outra rodada já pegou');
    expect(banco.linhas('users').filter(x => x.pesquisa_sent_at)).toHaveLength(1);
  });

  it('uma pessoa recebe uma vez para sempre: a rodada seguinte manda para a próxima', async () => {
    cliente(1); cliente(2);
    await dispararPesquisaSatisfacao();
    await dispararPesquisaSatisfacao();
    await dispararPesquisaSatisfacao();
    expect(h.frio).toHaveLength(2);
    expect(new Set(h.frio.map(f => f.tel)).size).toBe(2);
  });

  it('PESQUISA_WHATSAPP_OFF=1 não envia nem marca', async () => {
    cliente(1);
    process.env.PESQUISA_WHATSAPP_OFF = '1';
    const r = await dispararPesquisaSatisfacao();
    expect(r.enviado).toBeNull();
    expect(h.frio).toHaveLength(0);
    expect(u('u1').pesquisa_sent_at).toBeNull();
  });

  it('envio que lança erro MANTÉM o carimbo (1 por pessoa para sempre) e grava a falha', async () => {
    cliente(1);
    h.frioErro = true;
    const r = await dispararPesquisaSatisfacao();
    expect(r.motivo).toMatch(/falha no envio/);
    expect(u('u1').pesquisa_sent_at).not.toBeNull();
    expect(banco.linhas('system_state').map(x => x.key)).toContain('pesquisa_falha:u1');
    h.frioErro = false;
    await dispararPesquisaSatisfacao();
    expect(h.frio).toHaveLength(1);   // não reenvia
  });

  it('sendFrio devolve false (calou): 0 envio, o claim é desfeito e a pessoa segue elegível', async () => {
    cliente(1);
    h.frioRetorno = false;
    const r = await dispararPesquisaSatisfacao();
    expect(r.enviado).toBeNull();
    expect(r.motivo).toMatch(/calou/);
    expect(u('u1').pesquisa_sent_at).toBeNull();
    h.frioRetorno = true;
    const r2 = await dispararPesquisaSatisfacao();
    expect(r2.enviado).toBe('u1@x.com');
  });

  it('pessoa suprimida ou muda: 0 envio, fica marcada e sai da fila', async () => {
    cliente(1); cliente(2);
    h.suprimidos.add('5534991100001');
    h.mudos.add('5534991100002');
    const a = await dispararPesquisaSatisfacao();
    const b = await dispararPesquisaSatisfacao();
    expect(h.frio).toHaveLength(0);
    expect([a.motivo, b.motivo].every(m => /cortada/.test(String(m)))).toBe(true);
    expect(banco.linhas('users').every(x => x.pesquisa_sent_at)).toBe(true);
    const c = await dispararPesquisaSatisfacao();
    expect(c.motivo).toBe('ninguém pendente');
  });
});
