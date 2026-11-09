import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Recibo da entrada da 5040 (chefe-antiban, 05/11/2026): claim por INSERT, uma chave por dia+turno+destinatário, ANTES do envio.
// Duas rodadas juntas dão um recibo só; a 2ª pessoa sai na rodada seguinte, nunca colada na 1ª.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ envios: [] as Array<{ tel: string; instancia: string }>, erro: false, tabela: { ok: true } as { ok: boolean } }));
const TEL_GIOVANNA = '34900000009';

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string, _t: string, instancia: string) => {
    h.envios.push({ tel, instancia });
    if (h.erro) throw new Error('Z-API 500');
  }),
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34900000001', diego: '34900000002' } }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: vi.fn(async () => (h.tabela.ok ? { ok: true, mapa: new Map([['giovanna', '34900000009']]) } : { ok: false, codigo: 'x' })),
  telefoneDoConsultor: (mapa: Map<string, string>, nome: string) => mapa.get(nome.toLowerCase()) ?? null,
}));

import { banco } from './_bancoFalso';
import { runEntradaIoDigest } from '../services/io/entradaIoDigest';

// Quinta-feira, 05/11/2026 (Brasília = UTC-3).
const BRT = (hhmm: string): Date => new Date(`2026-11-05T${hhmm}:00.000-03:00`);
const chaves = () => banco.linhas('system_state').filter(r => String(r.key).startsWith('entrada_io_digest:')).map(r => r.key as string).sort();

beforeEach(() => {
  banco.reset();
  h.envios.length = 0; h.erro = false; h.tabela.ok = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BRT('12:17'));
  banco.poe('sdr_message_dedup', { phone: '5511999990001', processed_at: BRT('11:00').toISOString() });
});
afterEach(() => { vi.useRealTimers(); });

describe('recibo da entrada da 5040', () => {
  it('duas rodadas juntas no mesmo turno dão UM recibo só', async () => {
    const [a, b] = await Promise.all([runEntradaIoDigest(), runEntradaIoDigest()]);
    expect(h.envios).toHaveLength(1);
    expect(h.envios[0]).toEqual({ tel: TEL_GIOVANNA, instancia: 'io' });
    expect([a.enviado, b.enviado].filter(Boolean)).toHaveLength(1);
    expect(chaves()).toEqual(['entrada_io_digest:2026-11-05:12:giovanna']);
  });

  it('a 2ª pessoa só sai na rodada seguinte, e cada destinatário recebe uma vez no turno', async () => {
    await runEntradaIoDigest();
    vi.setSystemTime(BRT('12:20'));
    expect((await runEntradaIoDigest()).motivo).toBe('espacando_destinatarios');
    expect(h.envios).toHaveLength(1);

    vi.setSystemTime(BRT('13:17'));
    const r = await runEntradaIoDigest();
    expect(r.destinatario).toBe('diego');
    expect(h.envios.map(e => e.tel)).toEqual([TEL_GIOVANNA, '34900000002']);

    vi.setSystemTime(BRT('14:17'));
    expect((await runEntradaIoDigest()).motivo).toBe('ja_enviado_neste_turno');
    expect(h.envios).toHaveLength(2);
    expect(chaves()).toHaveLength(2);
  });

  it('fora do turno (9h, 16h, 21h) não envia', async () => {
    for (const hh of ['16:17', '21:17', '09:17']) {
      vi.setSystemTime(BRT(hh));
      expect((await runEntradaIoDigest()).motivo).toBe('fora_do_turno');
    }
    expect(h.envios).toHaveLength(0);
  });

  it('chave antiga do turno (sem destinatário) conta como os dois já atendidos', async () => {
    banco.poe('system_state', { key: 'entrada_io_digest:2026-11-05:12', value: {}, updated_at: BRT('12:00').toISOString() });
    expect((await runEntradaIoDigest()).motivo).toBe('ja_enviado_neste_turno');
    vi.setSystemTime(BRT('13:17'));
    expect((await runEntradaIoDigest()).motivo).toBe('ja_enviado_neste_turno');
    expect(h.envios).toHaveLength(0);
  });

  it('envio que falha não é repetido (a chave fica)', async () => {
    h.erro = true;
    await runEntradaIoDigest();
    h.erro = false;
    vi.setSystemTime(BRT('12:40'));
    await runEntradaIoDigest();   // ainda espaçando
    expect(h.envios).toHaveLength(1);
    expect(chaves()).toEqual(['entrada_io_digest:2026-11-05:12:giovanna']);
  });

  it('forcar às 12h05 manda para a equipe toda e grava a chave antiga: a rodada das 12h17 e as seguintes não reenviam', async () => {
    vi.setSystemTime(BRT('12:05'));
    const r = await runEntradaIoDigest({ forcar: true });
    expect(r.enviado).toBe(true);
    expect(h.envios).toHaveLength(2);
    vi.setSystemTime(BRT('12:17'));
    expect((await runEntradaIoDigest()).motivo).toBe('ja_enviado_neste_turno');
    vi.setSystemTime(BRT('13:17'));
    expect((await runEntradaIoDigest()).motivo).toBe('ja_enviado_neste_turno');
    expect(h.envios).toHaveLength(2);
  });

  it('o Thiago não recebe: só Giovanna e Diego, nesta ordem', async () => {
    await runEntradaIoDigest({ forcar: true });
    expect(h.envios.map(e => e.tel)).toEqual([TEL_GIOVANNA, '34900000002']);
    expect(h.envios.map(e => e.tel)).not.toContain('34900000001');
  });

  it('sem o telefone da Giovanna (nem na reserva), o aviso segue só para o Diego', async () => {
    h.tabela.ok = false;
    const r = await runEntradaIoDigest();
    expect(r.destinatario).toBe('diego');
    expect(h.envios.map(e => e.tel)).toEqual(['34900000002']);
  });

  it('dry não reserva chave nem envia', async () => {
    const r = await runEntradaIoDigest({ dry: true });
    expect(r.motivo).toBe('dry');
    expect(chaves()).toHaveLength(0);
    expect(h.envios).toHaveLength(0);
  });
});
