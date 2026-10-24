import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// POST /solardoc/quiz: validação, conta no servidor, gravação em leads_meta (com
// ?dry=1 não grava) e Lead pela API de Conversões. O banco e o Meta são simulados.

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  ops: [] as Array<{ tabela: string; op: string; arg?: any; filtros: Array<[string, unknown]> }>,
  existe: false,
  erroGravar: null as unknown,
}));

vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.enviar }));
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => {
  const cadeia = (tabela: string) => {
    const reg: { tabela: string; op: string; arg?: any; filtros: Array<[string, unknown]> } = { tabela, op: 'select', filtros: [] };
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') {
          return (ok: (v: unknown) => void) => {
            if (reg.op !== 'select') { h.ops.push(reg); ok({ error: h.erroGravar }); }
            else ok({ data: h.existe ? [{ lead_id: 'x' }] : [], error: null });
          };
        }
        return (...a: unknown[]) => {
          if (k === 'insert' || k === 'update') { reg.op = String(k); reg.arg = a[0]; }
          if (k === 'eq') reg.filtros.push([String(a[0]), a[1]]);
          return c;
        };
      },
    });
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});

import router from '../routes/solardocQuiz';
import { logger } from '../utils/logger';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/solardoc', router);

const FBC = 'fb.1.1760000000000.AbCdEf123';
const FBP = 'fb.1.1760000000000.1234567890';
const corpo = {
  nome: 'Carlos Andrade', whatsapp: '(34) 99816-5040', empresa: 'Sol do Cerrado Energia', uf: 'MG', cidade: 'Uberlândia-MG',
  respostas: {
    papel: 'dono', cnpj: 'sim', propostas_mes: '6a15', vendas_mes: 'v1a2', como_faz_hoje: 'word', gasto_ferramenta: 'nada',
    tempo_por_proposta: 't120', quando_monta: 'noite', demora_envio: 'd1a2', cliente_entende: 'explico', erro_proposta: 'atempo',
    papelada: 'viro', tem_marca: 'asvezes', mostra_economia: 'so_total', economia_25: 'nao', financiamento: 'aparte',
    usa_conta: 'digito', contrato_pronto: 'depois', modelos: 'mesmo', followup: 'lembro', clientes: ['casas'],
  },
  utm: { utm_source: 'fb', utm_campaign: 'camp1', utm_term: '1234567890' },
  fbp: FBP, fbc: FBC, lp_session: 'sd-abc_123', event_id: 'lead_abc123xyz', url: 'https://solardoc.app/diagnostico',
};

beforeEach(() => {
  h.enviar.mockReset().mockResolvedValue({ ok: true, status: 200 });
  h.ops.length = 0;
  h.existe = false;
  h.erroGravar = null;
});

const campo = (reg: { arg?: any }, nome: string): string[] | undefined =>
  (reg.arg.field_data as Array<{ name: string; values: string[] }>).find((f) => f.name === nome)?.values;

describe('POST /solardoc/quiz', () => {
  it('calcula no servidor, grava o lead e devolve código, índice e perfil', async () => {
    const r = await request(app).post('/solardoc/quiz').send(corpo);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, indice: 37, perfil: 'braco', perfil_nome: 'Proposta no braço' });
    expect(r.body.codigo).toMatch(/^SD-[A-HJ-NP-Z2-9]{4}$/);
    expect(h.ops).toHaveLength(1);
    const g = h.ops[0];
    expect(g).toMatchObject({ tabela: 'leads_meta', op: 'insert' });
    expect(g.arg).toMatchObject({
      lead_id: 'sdquiz_3498165040', form_id: 'quiz_solardoc', nome: 'Carlos Andrade', whatsapp: '5534998165040',
      cidade: 'Uberlândia-MG', fora_area: false,
    });
    expect(g.arg.lead_id.startsWith('quiz_')).toBe(false);
    expect(campo(g, 'Código')).toEqual([r.body.codigo]);
    expect(campo(g, 'Índice')).toEqual(['37']);
    expect(campo(g, 'Perfil')).toEqual(['braco']);
    expect(campo(g, 'Empresa')).toEqual(['Sol do Cerrado Energia']);
    expect(campo(g, 'propostas_mes')).toEqual(['6a15']);
    expect(campo(g, 'clientes')).toEqual(['casas']);
    expect(campo(g, 'utm_campaign')).toEqual(['camp1']);
    expect(campo(g, 'fbp')).toEqual([FBP]);
    expect(campo(g, 'lp_session')).toEqual(['sd-abc_123']);
  });

  it('nenhum nome de campo do lead casa com o que os outros quizzes procuram', async () => {
    await request(app).post('/solardoc/quiz').send(corpo);
    const nomes = (h.ops[0].arg.field_data as Array<{ name: string }>).map((f) => f.name);
    for (const n of nomes) {
      expect(n.toLowerCase()).not.toMatch(/^(consumo|consuma)|consumo_m[eé]dio|conta_de_luz/);
      expect(['Pontos', 'Caminho']).not.toContain(n);
    }
  });

  it('?dry=1 calcula e responde igual, sem gravar e sem mandar nada ao Meta', async () => {
    const real = await request(app).post('/solardoc/quiz').send(corpo);
    h.ops.length = 0; h.enviar.mockClear();
    const dry = await request(app).post('/solardoc/quiz?dry=1').send(corpo);
    expect(dry.status).toBe(200);
    expect(dry.body).toEqual(real.body);
    expect(h.ops).toHaveLength(0);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('o mesmo telefone voltando atualiza o lead (não cria outro) e o código é o mesmo', async () => {
    const a = await request(app).post('/solardoc/quiz').send(corpo);
    h.ops.length = 0; h.existe = true;
    const b = await request(app).post('/solardoc/quiz').send({ ...corpo, whatsapp: '+55 34 99816-5040' });
    expect(b.body.codigo).toBe(a.body.codigo);
    expect(h.ops).toHaveLength(1);
    expect(h.ops[0].op).toBe('update');
    expect(h.ops[0].filtros).toContainEqual(['lead_id', 'sdquiz_3498165040']);
  });

  it('telefone com 55, com 0 e com 11 dígitos chegam ao mesmo lead; telefone ruim é 400', async () => {
    for (const w of ['5534998165040', '034998165040', '34998165040']) {
      h.ops.length = 0;
      const r = await request(app).post('/solardoc/quiz').send({ ...corpo, whatsapp: w });
      expect(r.status).toBe(200);
      expect(h.ops[0].arg.whatsapp).toBe('5534998165040');
    }
    for (const w of ['', '123', '99816504', '0000000000']) {
      h.ops.length = 0;
      const r = await request(app).post('/solardoc/quiz').send({ ...corpo, whatsapp: w });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('telefone invalido');
      expect(h.ops).toHaveLength(0);
    }
  });

  it('nome com menos de 2 caracteres é 400', async () => {
    for (const nome of ['', ' ', 'A', undefined]) {
      const r = await request(app).post('/solardoc/quiz').send({ ...corpo, nome });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('nome invalido');
    }
    expect(h.ops).toHaveLength(0);
  });

  it('respostas que não são um objeto são 400; id estranho dentro delas é descartado', async () => {
    expect((await request(app).post('/solardoc/quiz').send({ ...corpo, respostas: 'oi' })).status).toBe(400);
    expect((await request(app).post('/solardoc/quiz').send({ ...corpo, respostas: [1] })).status).toBe(400);
    const r = await request(app).post('/solardoc/quiz').send({ ...corpo, respostas: { papel: 'dono', tem_marca: 'sim', xablau: 'a', cnpj: 'lua' }, indice: 100, perfil: 'crescer' });
    expect(r.status).toBe(200);
    expect(r.body.indice).toBe(9); // só tem_marca=sim (9) pontua; o índice que a página mandar é ignorado
    expect(r.body.perfil).not.toBe('crescer');
    const nomes = (h.ops[0].arg.field_data as Array<{ name: string }>).map((f) => f.name);
    expect(nomes).not.toContain('xablau');
    expect(campo(h.ops[0], 'cnpj')).toBeUndefined();
  });

  it('o Lead vai ao pixel da SolarDoc com o event_id da página, depois de gravar', async () => {
    await request(app).post('/solardoc/quiz').send(corpo);
    expect(h.enviar).toHaveBeenCalledTimes(1);
    const ev = h.enviar.mock.calls[0][0];
    expect(ev).toMatchObject({
      produto: 'solardoc', nome: 'Lead', eventId: 'lead_abc123xyz', origem: 'website', urlDaPagina: 'https://solardoc.app/diagnostico',
    });
    expect(ev.pessoa).toMatchObject({ telefone: '5534998165040', nome: 'Carlos Andrade', uf: 'MG' });
    expect(ev.navegador).toMatchObject({ fbc: FBC, fbp: FBP });
    expect(JSON.stringify(ev.dados)).not.toMatch(/Carlos|99816/);
  });

  it('sem event_id válido o Meta não é chamado (contaria em dobro com o pixel do navegador)', async () => {
    await request(app).post('/solardoc/quiz').send({ ...corpo, event_id: undefined });
    await request(app).post('/solardoc/quiz').send({ ...corpo, event_id: 'a b' });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('banco fora do ar: a pessoa recebe a conta mesmo assim e o Meta não é chamado', async () => {
    h.erroGravar = { message: 'caiu' };
    const r = await request(app).post('/solardoc/quiz').send(corpo);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, indice: 37, perfil: 'braco' });
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('o log de erro de gravação não leva o telefone nem o lead_id (sdquiz_<DDD+8>), só um hash curto', async () => {
    process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
    const espiao = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    h.erroGravar = { message: 'caiu' };
    await request(app).post('/solardoc/quiz').send(corpo);
    const chamadas = espiao.mock.calls.filter(c => String(c[0]) === 'solardoc-quiz');
    expect(chamadas.length).toBeGreaterThan(0);
    const tudo = JSON.stringify(chamadas);
    expect(tudo).not.toContain('sdquiz_');
    expect(tudo).not.toContain('99816');
    expect(tudo).not.toContain('34998165040');
    expect(String(chamadas[0]![1])).toMatch(/rascunho do lead [0-9a-f]{10} falhou/);
    espiao.mockRestore();
  });

  it('Meta fora do ar não derruba a rota', async () => {
    h.enviar.mockRejectedValue(new Error('rede'));
    const r = await request(app).post('/solardoc/quiz').send(corpo);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('a cidade sem sufixo ganha a UF do corpo', async () => {
    await request(app).post('/solardoc/quiz').send({ ...corpo, cidade: 'Uberaba', uf: 'MG' });
    expect(h.ops[0].arg.cidade).toBe('Uberaba-MG');
  });
});
