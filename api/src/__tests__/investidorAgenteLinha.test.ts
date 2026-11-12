import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Os freios da linha para as respostas da Helena (parecer do chefe anti-ban, 12/11/2026): 60/h, 450/24 h,
// 10 s entre conversas diferentes, uma chave por bolha, falha de leitura fecha.

const db = vi.hoisted(() => ({ agora: Date.parse('2026-11-12T15:00:00Z'), hora: 0, dia: 0, ultima: null as null | { key: string; updated_at: string }, erro: false, gravados: [] as any[] }));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const st = { head: false, desde: '' };
      const q: any = {
        select: (_c: string, o?: { head?: boolean }) => { st.head = !!o?.head; return q; },
        or: () => q,
        gte: (_c: string, v: string) => { st.desde = v; return q; },
        like: () => q, order: () => q, limit: () => q,
        upsert: (linhas: any) => { db.gravados.push(...linhas); return Promise.resolve({ error: null }); },
        then: (ok: any) => {
          if (db.erro) return Promise.resolve({ data: null, error: { message: 'x' }, count: null }).then(ok);
          if (st.head) {
            const horaMs = db.agora - Date.parse(st.desde);
            return Promise.resolve({ error: null, count: horaMs <= 3_600_000 + 5 ? db.hora : db.dia }).then(ok);
          }
          return Promise.resolve({ error: null, data: db.ultima ? [db.ultima] : [] }).then(ok);
        },
      };
      return q;
    },
  },
}));

import { conferirLinhaParaResposta, registrarBolhas, registrarFichaNaLinha, PREFIXO_FICHA_NA_LINHA, LIMITES_DA_RESPOSTA, PREFIXO_ENV } from '../services/io/investidorAgenteLinha';
import { PREFIXOS_RESPOSTA_AGENTES } from '../services/agents/whatsapp/lineThrottle';

const AGORA = Date.parse('2026-11-12T15:00:00Z');
beforeEach(() => { Object.assign(db, { hora: 0, dia: 0, ultima: null, erro: false }); db.gravados.length = 0; });

describe('os freios da linha para as respostas', () => {
  it('os números são os do parecer: 60 por hora, 450 em 24 h, 10 s', () => {
    expect(LIMITES_DA_RESPOSTA).toEqual({ horaLinha: 60, diaLinha: 450, entreConversasMs: 10_000 });
  });

  it('o prefixo das bolhas está em PREFIXOS_RESPOSTA_AGENTES (entra nos 2 min do frio e no teto de emergência)', () => {
    expect(PREFIXOS_RESPOSTA_AGENTES).toContain(PREFIXO_ENV);
  });

  it('cabe com 58 na hora (as 2 bolhas); com 59 já não, e o mesmo vale para 24 h', async () => {
    db.hora = 58; db.dia = 100;
    expect(await conferirLinhaParaResposta('3499990001', AGORA)).toMatchObject({ ok: true });
    db.hora = 59;
    expect(await conferirLinhaParaResposta('3499990001', AGORA)).toEqual({ ok: false, motivo: 'teto_hora' });
    db.hora = 0; db.dia = 449;
    expect(await conferirLinhaParaResposta('3499990001', AGORA)).toEqual({ ok: false, motivo: 'teto_dia' });
  });

  it('10 s entre conversas DIFERENTES: a espera é o que falta, nunca mais de 10 s; na mesma conversa não espera', async () => {
    db.ultima = { key: `${PREFIXO_ENV}3499990002:${AGORA - 4000}:1`, updated_at: new Date(AGORA - 4000).toISOString() };
    expect(await conferirLinhaParaResposta('3499990001', AGORA)).toEqual({ ok: true, esperaMs: 6000 });
    expect(await conferirLinhaParaResposta('3499990002', AGORA)).toEqual({ ok: true, esperaMs: 0 });
    db.ultima = { key: `${PREFIXO_ENV}3499990002:1:1`, updated_at: new Date(AGORA - 30_000).toISOString() };
    expect(await conferirLinhaParaResposta('3499990001', AGORA)).toEqual({ ok: true, esperaMs: 0 });
  });

  it('falha de leitura FECHA: sem saber quanto a linha falou, a resposta espera', async () => {
    db.erro = true;
    expect(await conferirLinhaParaResposta('3499990001', AGORA)).toEqual({ ok: false, motivo: 'leitura_falhou' });
  });

  it('a ficha ao consultor entra na conta da linha: a chave nasce no molde `ficha_lead:` das agentes', async () => {
    expect(PREFIXOS_RESPOSTA_AGENTES).toContain('ficha_lead:');
    await registrarFichaNaLinha(901, AGORA);
    expect(db.gravados.map(g => g.key)).toEqual([`${PREFIXO_FICHA_NA_LINHA}901`]);
    expect(PREFIXOS_RESPOSTA_AGENTES.some(p => db.gravados[0]!.key.startsWith(p))).toBe(true);
  });

  it('uma chave por bolha enviada', async () => {
    await registrarBolhas('3499990001', 2, AGORA);
    expect(db.gravados.map(g => g.key)).toEqual([`${PREFIXO_ENV}3499990001:${AGORA}:1`, `${PREFIXO_ENV}3499990001:${AGORA}:2`]);
  });
});

describe('o registro da resposta fria', () => {
  it('inv_agente_frio: está em BOT_SENT_PREFIXES (teto do frio) e NUNCA debaixo de inv_agente_sent:', () => {
    const lt = readFileSync(join(__dirname, '../services/agents/whatsapp/lineThrottle.ts'), 'utf8');
    expect(lt).toMatch(/^\s*'inv_agente_frio:',/m);
    expect('inv_agente_frio:'.startsWith('inv_agente_sent:')).toBe(false);
    const ag = readFileSync(join(__dirname, '../services/io/investidorAgente.ts'), 'utf8');
    expect(ag).toContain("INV_FRIO_PREFIX = 'inv_agente_frio:'");
  });
});
