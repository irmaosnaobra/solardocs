import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// POST /io/eletroposto/alerta lê o tipo guardado do card (`tipo_card:<id>`, gravado
// pelo /agendar antes de responder à LP) e escolhe o aviso da equipe por ele. Sem a
// chave, ou com a leitura falhando, o aviso é o de sempre. Banco e WhatsApp simulados.

const h = vi.hoisted(() => ({
  enviados: [] as Array<{ numero: string; texto: string }>,
  tipo: undefined as unknown,
  leituraErro: false,
  leituraExplode: false,
  idLido: '' as string,
  ficha: null as Record<string, unknown> | null,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_c: string, chave: string) => ({
          maybeSingle: async () => {
            h.idLido = chave;
            if (h.leituraExplode) throw new Error('rede caiu');
            if (h.leituraErro) return { data: null, error: { message: 'system_state fora' } };
            return { data: h.tipo === undefined ? null : { value: h.tipo }, error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = { select: () => q, eq: () => q, single: async () => ({ data: h.ficha, error: null }) };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (numero: string, texto: string) => { h.enviados.push({ numero, texto }); }),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn() }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(() => ({})), garantirEstudo: vi.fn(async () => null) }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn(), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));

import router from '../routes/ioEletroposto';

const app = express();
app.use(express.json());
app.use('/io/eletroposto', router);

let proximoId = 9000;
beforeEach(() => {
  h.enviados.length = 0; h.tipo = undefined; h.leituraErro = false; h.leituraExplode = false; h.idLido = '';
  proximoId += 1;   // o aviso é idempotente por id em memória: cada teste usa o seu
  h.ficha = {
    id: proximoId, vendedor_nome: 'Diego', quando: '2026-10-14T13:00:00.000Z', cliente_nome: 'Voltz Energia Ltda',
    cliente_telefone: '5534991113333', cidade: 'Uberlândia', temperatura: 'quente', created_at: new Date().toISOString(),
    created_by: 'lp_eletroposto',
    observacao: 'LP ELETROPOSTO · Integrador\nEmpresa: Voltz Energia\nO que faz: Instalação\nComo quer trabalhar: Revendendo',
  };
});

const alertar = () => request(app).post('/io/eletroposto/alerta').send({ id: proximoId });

describe('POST /alerta com o tipo guardado do card', () => {
  it('integrador: o aviso é o do parceiro, para a equipe toda', async () => {
    h.tipo = { tipo: 'integrador', em: '2026-10-13T10:00:00Z', por: 'lp' };
    const r = await alertar();
    expect(r.body).toEqual({ ok: true, enviados: 2 });
    expect(h.idLido).toBe(`tipo_card:${proximoId}`);
    expect(h.enviados).toHaveLength(2);
    for (const e of h.enviados) {
      expect(e.texto).toContain('🤝 *NOVA REUNIÃO · PARCEIRO INTEGRADOR*');
      expect(e.texto).toContain('*Voltz Energia*');
      expect(e.texto).toContain('*Como quer trabalhar:* Revendendo');
      expect(e.texto).not.toContain('SEM NOTA');
    }
  });

  it('o tipo pode vir como texto JSON', async () => {
    h.tipo = '{"tipo":"arrendamento"}';
    await alertar();
    expect(h.enviados[0]!.texto).toContain('📍 *NOVA REUNIÃO · ARRENDAMENTO*');
  });

  for (const [nome, ajuste] of [
    ['sem a chave', () => { h.tipo = undefined; }],
    ['valor torto', () => { h.tipo = 'isto não é json {'; }],
    ['tipo fora dos três', () => { h.tipo = { tipo: 'carregador' }; }],
    ['leitura com erro do banco', () => { h.leituraErro = true; }],
    ['leitura que estoura', () => { h.leituraExplode = true; }],
  ] as const) {
    it(`${nome}: o aviso de sempre sai, sem erro`, async () => {
      ajuste();
      const r = await alertar();
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, enviados: 2 });
      expect(h.enviados[0]!.texto).toContain('*NOVA REUNIÃO — ELETROPOSTO*');
    });
  }
});
