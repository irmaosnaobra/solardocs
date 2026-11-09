import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Avisos de venda e renovação da SolarDoc: Thiago de sempre e, desde 08/11/2026, o Diego também.
// Aqui roda o auxiliar de verdade (avisoVendaDiego) e o `avisarVendaAoDono`/`avisarRenovacaoAoDono` reais; só a
// leitura da tabela `consultores`, o WhatsApp e o banco são falsos.
// Regra do dono: se não der para falar com o Diego, o aviso ao Thiago NUNCA deixa de sair.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  process.env.VENDA_AVISO_PHONE = '34900000001';   // lido na importação de vendaAviso
  return {
  envios: [] as Array<{ tel: string; texto: string; linha: string }>,
  tabela: { modo: 'ok' as 'ok' | 'falha' | 'sem_diego' },
  envioAoDiegoFalha: false,
  state: new Set<string>(),
  TEL_DIEGO: '34900000002',
  TEL_THIAGO: '34900000001',
  };
});

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => undefined) }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string, texto: string, linha: string) => {
    if (h.envioAoDiegoFalha && tel === h.TEL_DIEGO) throw new Error('z-api fora');
    h.envios.push({ tel, texto, linha });
  }),
}));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: vi.fn(async () => {
    if (h.tabela.modo === 'falha') return { ok: false, codigo: 'PGRST000' };
    return { ok: true, mapa: new Map(h.tabela.modo === 'sem_diego' ? [] : [['diego', h.TEL_DIEGO]]) };
  }),
  telefoneDoConsultor: (mapa: Map<string, string>, nome: string) => mapa.get(nome.toLowerCase()) ?? null,
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      const q: any = {
        update: () => q, eq: () => q, is: () => q, select: () => q,
        insert: async (l: { key: string }) => {
          if (t === 'system_state') {
            if (h.state.has(l.key)) return { error: { code: '23505' } };
            h.state.add(l.key);
          }
          return { error: null };
        },
        then: (ok: any, er: any) => Promise.resolve({ data: [], error: null }).then(ok, er),
        maybeSingle: async () => ({ data: { id: 'venda-1' }, error: null }),
      };
      return q;
    },
  },
}));

import { avisarDiegoDaVenda } from '../services/avisoVendaDiego';
import { avisarVendaAoDono, avisarRenovacaoAoDono } from '../services/vendaAviso';
import { logger } from '../utils/logger';

const venda = () => ({
  produto: 'VIP', valor: 67, cobrouAgora: true, email: 'novo@integrador.com', nome: 'Fulano', phone: '34999990000',
});
const renov = () => ({ produto: 'VIP', valor: 67, email: 'novo@integrador.com', nome: 'Fulano', phone: '34999990000' } as never);

afterAll(() => { delete process.env.VENDA_AVISO_PHONE; });

beforeEach(() => {
  h.envios.length = 0; h.tabela.modo = 'ok'; h.envioAoDiegoFalha = false; h.state.clear();
  vi.mocked(logger.warn).mockClear(); vi.mocked(logger.error).mockClear();
});

describe('avisarDiegoDaVenda', () => {
  it('manda o texto ao telefone do Diego pela linha da SolarDoc', async () => {
    expect(await avisarDiegoDaVenda('oi', 'venda')).toBe('enviado');
    expect(h.envios).toEqual([{ tel: h.TEL_DIEGO, texto: 'oi', linha: 'solardoc' }]);
  });
  it('falha ao ler a tabela: não manda, registra no log e não lança', async () => {
    h.tabela.modo = 'falha';
    expect(await avisarDiegoDaVenda('oi', 'venda')).toBe('sem_telefone');
    expect(h.envios).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
  it('Diego fora da tabela: não manda e registra', async () => {
    h.tabela.modo = 'sem_diego';
    expect(await avisarDiegoDaVenda('oi', 'venda')).toBe('sem_telefone');
    expect(logger.warn).toHaveBeenCalled();
  });
  it('envio ao Diego falha: não lança', async () => {
    h.envioAoDiegoFalha = true;
    expect(await avisarDiegoDaVenda('oi', 'venda')).toBe('falhou');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('venda e renovação: Thiago e Diego', () => {
  it('venda: um envio para cada, com o mesmo texto, e a reentrega não repete', async () => {
    await avisarVendaAoDono('venda-1', venda());
    expect(h.envios.map(e => e.tel)).toEqual([h.TEL_THIAGO, h.TEL_DIEGO]);
    expect(h.envios[0].texto).toBe(h.envios[1].texto);
  });

  it('renovação: um envio para cada, e a reentrega da mesma fatura não repete', async () => {
    expect(await avisarRenovacaoAoDono('in_1', renov())).toBe('enviado');
    expect(await avisarRenovacaoAoDono('in_1', renov())).toBe('duplicado');
    expect(h.envios.map(e => e.tel)).toEqual([h.TEL_THIAGO, h.TEL_DIEGO]);
  });

  it('falha ao ler o telefone do Diego: o Thiago recebe a venda e a renovação do mesmo jeito', async () => {
    h.tabela.modo = 'falha';
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('enviado');
    expect(await avisarRenovacaoAoDono('in_2', renov())).toBe('enviado');
    expect(h.envios.map(e => e.tel)).toEqual([h.TEL_THIAGO, h.TEL_THIAGO]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('envio ao Diego estoura: o resultado do Thiago não muda', async () => {
    h.envioAoDiegoFalha = true;
    expect(await avisarVendaAoDono('venda-1', venda())).toBe('enviado');
    expect(await avisarRenovacaoAoDono('in_3', renov())).toBe('enviado');
    expect(h.envios.map(e => e.tel)).toEqual([h.TEL_THIAGO, h.TEL_THIAGO]);
  });
});
