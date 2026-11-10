import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { BancoFalso } from './bancoFalsoQuiz';

// A ORIGEM DO LEAD NO CARD (10/11/2026): fbc, fbp, IP e navegador vão para `agendamento_rastreio` (tabela fechada), o id do anúncio
// vai para `agendamentos.ad_id`, e a visita guarda fbc, fbp e fbclid. O rastreio NUNCA derruba a agenda, e o ctwaClid nunca é gravado.
// Banco, Meta e WhatsApp são falsos: nada alcança a rede.

const h = vi.hoisted(() => ({
  ger: null as any,
  main: null as any,
  /** O que o upsert do helper recebe, na ordem. */
  upserts: [] as Array<{ linha: any; opcoes: any }>,
  /** Como o supabaseGerador responde ao upsert de agendamento_rastreio. */
  modo: 'ok' as 'ok' | 'erro' | 'lanca' | 'rejeita',
  bloqueado: false,
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: (t: string) => {
      if (t === 'agendamento_rastreio' && h.modo !== 'ok') {
        return {
          upsert: () => {
            if (h.modo === 'lanca') throw new Error('Supabase caiu com o telefone 5534991112222');
            if (h.modo === 'rejeita') return Promise.reject(new Error('rede'));
            return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied para 5534991112222' } });
          },
        };
      }
      const q = h.ger.from(t);
      if (t !== 'agendamento_rastreio') return q;
      const upsert = q.upsert.bind(q);
      q.upsert = (linha: any, opcoes: any) => { h.upserts.push({ linha, opcoes }); return upsert(linha, opcoes); };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async () => undefined), linhaEmCooldown: vi.fn(() => false) }));
vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: vi.fn(async () => ({ ok: true, status: 200 })) }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn(async () => h.bloqueado),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));

import router from '../routes/ioSolar';
import { trackVisit } from '../controllers/trackingController';
import { gravarCardSolar } from '../services/agentes5040/agendaSolar';
import { gravarCardEletroposto } from '../services/io/eletropostoCard';
import { origemDoCardDaAgente } from '../services/rastreio/origemCard';
import { gravarRastreioCard, rastreioDaRequisicao, adIdDeUtmContent } from '../services/rastreio/gravarRastreioCard';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/solar', router);

const FBC = 'fb.1.1760000000000.AbCdEf123';
const FBP = 'fb.1.1760000000000.1234567890';
const AD = '120210000000012345';
const rastreios = (): any[] => h.ger.tabela('agendamento_rastreio');
const cartoes = (): any[] => h.ger.tabela('agendamentos');
/** Tudo que ficou gravado nos dois bancos, para procurar o que NÃO pode estar lá. */
const tudoGravado = (): string => JSON.stringify([h.ger.tabelas, h.main.tabelas, h.upserts]);

beforeEach(() => {
  h.ger = new BancoFalso(); h.main = new BancoFalso();
  h.upserts = []; h.modo = 'ok'; h.bloqueado = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('gravarRastreioCard: o helper', () => {
  it('grava a linha com on conflict do nothing (o primeiro registro vale) e corta os campos no teto', async () => {
    await gravarRastreioCard(55, { fbc: FBC, fbp: FBP, fbclid: ` ${'x'.repeat(600)} `, client_ip: '200.1.2.3', user_agent: 'Mozilla/5.0', landing_url: 'https://solardoc.app/io/solar', referrer: '' });
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]!.opcoes).toEqual({ onConflict: 'agendamento_id', ignoreDuplicates: true });
    expect(rastreios()).toHaveLength(1);
    expect(rastreios()[0]).toMatchObject({ agendamento_id: 55, fbc: FBC, fbp: FBP, client_ip: '200.1.2.3', user_agent: 'Mozilla/5.0' });
    expect(rastreios()[0].fbclid).toHaveLength(500);
    expect(rastreios()[0]).not.toHaveProperty('referrer');          // vazio não vira coluna
  });

  it('tudo vazio (ou id inválido): não grava nada', async () => {
    await gravarRastreioCard(55, {});
    await gravarRastreioCard(55, { fbc: '', fbp: '   ', fbclid: null, client_ip: undefined });
    await gravarRastreioCard(55, null);
    await gravarRastreioCard(55, undefined);
    await gravarRastreioCard(null, { fbc: FBC });
    await gravarRastreioCard(0, { fbc: FBC });
    await gravarRastreioCard('abc', { fbc: FBC });
    expect(h.upserts).toHaveLength(0);
    expect(rastreios()).toHaveLength(0);
  });

  it.each(['erro', 'lanca', 'rejeita'] as const)('NUNCA lança, mesmo com o Supabase em "%s": só um console.warn sem dado pessoal', async (modo) => {
    h.modo = modo;
    await expect(gravarRastreioCard(55, { fbc: FBC, client_ip: '200.1.2.3', user_agent: 'Mozilla/5.0' })).resolves.toBeUndefined();
    const avisos = JSON.stringify((console.warn as any).mock.calls);
    expect(avisos).toContain('gravarRastreioCard');
    expect(avisos).not.toContain('5534991112222');
    expect(avisos).not.toContain(FBC);
    expect(avisos).not.toContain('200.1.2.3');
  });

  it('rastreioDaRequisicao: corpo primeiro, depois o _capi do field_data, req.ip e user-agent; fbc fora do formato do Meta não passa', () => {
    const req = { ip: '200.1.2.3', headers: { 'user-agent': 'UA-Req' } } as any;
    expect(rastreioDaRequisicao(req, { fbc: FBC, fbp: 'lixo', fbclid: 'IwAR0abc', landing_url: 'https://x.com/a', referrer: 'https://instagram.com' })).toEqual({
      fbc: FBC, fbp: null, fbclid: 'IwAR0abc', client_ip: '200.1.2.3', user_agent: 'UA-Req', landing_url: 'https://x.com/a', referrer: 'https://instagram.com',
    });
    const capi = [{ name: '_capi', values: [JSON.stringify({ ts: '2026-11-10T12:00:00Z', fbc: FBC, fbp: FBP, client_user_agent: 'UA-Capi', client_ip_address: '9.9.9.9' })] }];
    const r = rastreioDaRequisicao({ ip: undefined, headers: {} } as any, {}, capi);
    expect(r).toMatchObject({ fbc: FBC, fbp: FBP, client_ip: '9.9.9.9', user_agent: 'UA-Capi' });
    expect(rastreioDaRequisicao(req, { fbc: FBC }, capi).fbp).toBe(FBP);       // o corpo manda no que tem; o resto vem do _capi
  });

  it('adIdDeUtmContent: só dígitos, 10 a 20', () => {
    expect(adIdDeUtmContent(AD)).toBe(AD);
    expect(adIdDeUtmContent(` ${AD} `)).toBe(AD);
    for (const v of ['video-1', '123', '1'.repeat(21), '12345abcde67', '', null, undefined]) expect(adIdDeUtmContent(v)).toBeNull();
  });
});

describe('trackVisit: fbc, fbp e fbclid na visita', () => {
  const chamar = async (body: Record<string, unknown>) => {
    const res: any = { json: vi.fn(), status: vi.fn(() => res) };
    await trackVisit({ body, headers: { 'user-agent': 'UA-T' }, socket: { remoteAddress: '1.2.3.4' } } as any, res);
    return res;
  };

  it('grava os três, aparados e cortados em 500; vazio vira null', async () => {
    const res = await chamar({ session_id: 's1', utm_content: AD, fbc: ` ${FBC} `, fbp: FBP, fbclid: 'y'.repeat(700) });
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    const v = h.main.tabela('page_visits')[0];
    expect(v).toMatchObject({ session_id: 's1', utm_content: AD, fbc: FBC, fbp: FBP, user_agent: 'UA-T', ip: '1.2.3.4' });
    expect(v.fbclid).toHaveLength(500);
    await chamar({ session_id: 's2', fbc: '   ', fbp: 123, fbclid: '' });
    expect(h.main.tabela('page_visits')[1]).toMatchObject({ fbc: null, fbp: null, fbclid: null });
  });

  it('quem manda sem esses campos continua funcionando', async () => {
    const res = await chamar({ session_id: 's3', utm_source: 'meta' });
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(h.main.tabela('page_visits')[0]).toMatchObject({ session_id: 's3', utm_source: 'meta', fbc: null, fbp: null, fbclid: null });
  });
});

describe('ioSolar POST /agendar (card da LP solar)', () => {
  const corpo = (o: Record<string, unknown> = {}) => ({
    cliente_nome: 'Ana Souza', cliente_telefone: '5534991112222', vendedor_nome: 'Nilce', quando: '2026-11-12T13:00:00.000Z',
    observacao: 'LP SOLAR', utm_source: 'meta', utm_campaign: 'camp-1', utm_content: AD, fbc: FBC, fbp: FBP, fbclid: 'IwAR0abc',
    landing_url: 'https://solardoc.app/io/solar', ...o,
  });

  it('grava ad_id e os utm_* no card e chama o helper: fbc, fbp, IP e navegador vão para a tabela fechada', async () => {
    const r = await request(app).post('/io/solar/agendar').set('User-Agent', 'UA-Solar').send(corpo());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0]).toMatchObject({ created_by: 'lp_solar', ad_id: AD, utm_source: 'meta', utm_campaign: 'camp-1', utm_content: AD });
    // O que é pessoal NUNCA vai para agendamentos (ela é lida pela chave pública do /gerador).
    for (const k of ['fbc', 'fbp', 'fbclid', 'client_ip', 'user_agent']) expect(cartoes()[0]).not.toHaveProperty(k);
    expect(rastreios()).toHaveLength(1);
    expect(rastreios()[0]).toMatchObject({ agendamento_id: cartoes()[0].id, fbc: FBC, fbp: FBP, fbclid: 'IwAR0abc', user_agent: 'UA-Solar', landing_url: 'https://solardoc.app/io/solar' });
    expect(rastreios()[0].client_ip).toBeTruthy();
  });

  it('utm_content que não é id de anúncio: sem ad_id. E o rastreio com erro não derruba a agenda', async () => {
    h.modo = 'erro';
    const r = await request(app).post('/io/solar/agendar').send(corpo({ utm_content: 'video-3' }));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(cartoes()).toHaveLength(1);
    expect(cartoes()[0]).not.toHaveProperty('ad_id');
    expect(cartoes()[0].utm_content).toBe('video-3');
  });
});

describe('gravarCardSolar: o card do quiz e o da agente da 5040', () => {
  const ficha = { dono: 'Nilce', quando: '2026-11-12T13:00:00.000Z', nome: 'Ana Souza', tel: '5534991112222', cidade: 'Uberlândia-MG', observacao: 'LP SOLAR QUIZ · LIGAÇÃO\nx' };

  it('quiz: utm_content com id vira ad_id e o rastreio é gravado com o id do card; sem origem, o gatilho do banco decide (a rota não manda)', async () => {
    const g = await gravarCardSolar({ ...ficha, utm: { utm_source: 'meta', utm_content: AD }, rastreio: { fbc: FBC, client_ip: '200.1.2.3', user_agent: 'UA-Q' } });
    expect(g.status).toBe('ok');
    expect(cartoes()[0]).toMatchObject({ created_by: 'lp_solar', ad_id: AD });
    expect(cartoes()[0]).not.toHaveProperty('origem');
    expect(rastreios()[0]).toMatchObject({ agendamento_id: cartoes()[0].id, fbc: FBC, client_ip: '200.1.2.3', user_agent: 'UA-Q' });
  });

  it('agente da 5040: conversa de anúncio grava origem whatsapp_anuncio e ad_id (o sourceId)', async () => {
    const g = await gravarCardSolar({ ...ficha, ...origemDoCardDaAgente(AD) });
    expect(g.status).toBe('ok');
    expect(cartoes()[0]).toMatchObject({ origem: 'whatsapp_anuncio', ad_id: AD });
    expect(rastreios()).toHaveLength(0);                                   // sem navegador, sem rastreio
  });

  it('agente da 5040: sem anúncio grava origem whatsapp e nenhum ad_id', async () => {
    const g = await gravarCardSolar({ ...ficha, ...origemDoCardDaAgente(null) });
    expect(g.status).toBe('ok');
    expect(cartoes()[0]).toMatchObject({ origem: 'whatsapp' });
    expect(cartoes()[0]).not.toHaveProperty('ad_id');
    expect(origemDoCardDaAgente(undefined)).toEqual({ origem: 'whatsapp' });
  });

  it('adId que não é só dígitos nunca vira ad_id', async () => {
    await gravarCardSolar({ ...ficha, origem: 'whatsapp_anuncio', adId: 'ctwa-lixo' });
    expect(cartoes()[0]).not.toHaveProperty('ad_id');
  });

  it('rastreio com erro no banco não muda o resultado do card', async () => {
    h.modo = 'lanca';
    const g = await gravarCardSolar({ ...ficha, rastreio: { fbc: FBC } });
    expect(g.status).toBe('ok');
    expect(cartoes()).toHaveLength(1);
  });
});

describe('gravarCardEletroposto', () => {
  const ficha = { vendedor_nome: 'Thiago', quando: '2026-11-12T13:00:00.000Z', cliente_nome: 'Carlos Lima', cliente_telefone: '5534991113333', status: 'agendado', created_by: 'lp_eletroposto', utm_content: AD };

  it('utm_content com id vira ad_id e o rastreio vai para a tabela fechada', async () => {
    const r = await gravarCardEletroposto(ficha, { fbc: FBC, fbp: FBP, client_ip: '200.1.2.3' });
    expect(r.bloqueado).toBe(false);
    expect(cartoes()[0]).toMatchObject({ ad_id: AD, utm_content: AD });
    expect(rastreios()[0]).toMatchObject({ agendamento_id: r.id, fbc: FBC, fbp: FBP });
  });

  it('sem id de anúncio e sem rastreio: o insert é o de antes (sem ad_id, sem upsert)', async () => {
    await gravarCardEletroposto({ ...ficha, utm_content: 'video-1' });
    expect(cartoes()[0]).not.toHaveProperty('ad_id');
    expect(h.upserts).toHaveLength(0);
  });

  it('telefone bloqueado: nada é gravado, nem rastreio', async () => {
    h.bloqueado = true;
    const r = await gravarCardEletroposto(ficha, { fbc: FBC });
    expect(r).toEqual({ id: null, bloqueado: true });
    expect(cartoes()).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);
  });
});

describe('o ctwaClid nunca fica gravado', () => {
  it('nem pelo helper, nem pelas rotas, mesmo quando o corpo traz', async () => {
    const CLID = 'CTWA-SEGREDO-123456';
    await request(app).post('/io/solar/agendar').send({
      cliente_nome: 'Ana Souza', cliente_telefone: '5534991112222', vendedor_nome: 'Nilce', quando: '2026-11-12T13:00:00.000Z',
      utm_content: AD, fbc: FBC, ctwaClid: CLID, ctwa_clid: CLID,
    });
    await gravarRastreioCard(1, { fbc: FBC, ...({ ctwaClid: CLID } as object) });
    await gravarCardSolar({ dono: 'Nilce', quando: '2026-11-13T13:00:00.000Z', nome: 'Ana', tel: '5534991112222', cidade: null, observacao: 'x', ...origemDoCardDaAgente(AD) });
    expect(cartoes().length).toBeGreaterThanOrEqual(2);
    const tudo = tudoGravado();
    expect(tudo).not.toContain(CLID);
    expect(tudo).not.toMatch(/ctwa/i);
  });
});
