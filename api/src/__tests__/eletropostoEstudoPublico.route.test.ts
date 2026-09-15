import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

const h = vi.hoisted(() => ({
  configurado: true,
  achado: null as any,
  imagem: vi.fn(),
  permitidas: { satelite: true, rua: true },
}));

vi.mock('../services/io/eletropostoEstudoBanco', () => ({
  bancoConfigurado: () => h.configurado,
  lerPorToken: vi.fn(async () => h.achado),
}));
vi.mock('../services/io/eletropostoEstudoFontes', () => ({
  imagemSatelite: (...a: unknown[]) => h.imagem('satelite', ...a),
  imagemRua: (...a: unknown[]) => h.imagem('rua', ...a),
}));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ estudoDesligado: () => false }));
vi.mock('../services/io/eletropostoEstudoPagina', () => ({
  renderEstudo: (l: any) => `<html>estudo ${l.status}</html>`,
  paginaPreparando: () => '<html>Estudo em preparação</html>',
  pagina404: () => '<html>Estudo não encontrado</html>',
  imagensPermitidas: () => h.permitidas,
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import rotas, { CSP_ESTUDO } from '../routes/eletropostoEstudoPublico';
import { lerPorToken } from '../services/io/eletropostoEstudoBanco';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use('/io/eletroposto/estudo', rotas);

const TOKEN = 'e'.repeat(64);

const achado = (status: string, dados: Record<string, unknown> = {}) => ({
  estudo: {
    id: 1, agendamento_id: 9, token: TOKEN, status, dados, fontes: {}, custo_usd: '0.1100',
    created_at: '2026-09-15T20:00:00Z', pronto_em: status === 'pronto' ? '2026-09-15T20:05:00Z' : null,
    coords_apagadas_em: null, erro: 'detalhe interno', aviso_enviado_em: null,
  },
  reuniao: { quando: '2026-09-20T17:00:00Z', status: 'agendado', vendedor_nome: 'Diego', cliente_nome: 'Ana', cidade: 'Uberaba-MG', observacao: '' },
});

beforeEach(() => {
  h.configurado = true;
  h.achado = null;
  h.permitidas = { satelite: true, rua: true };
  h.imagem.mockReset();
  vi.mocked(lerPorToken).mockClear();
});
afterEach(() => { delete process.env.EP_ESTUDO_IMG_OFF; });

describe('página do estudo', () => {
  it('token torto e token inexistente dão a mesma 404, sem ir ao banco no torto', async () => {
    const torto = await request(app).get('/io/eletroposto/estudo/ABC');
    const inexistente = await request(app).get(`/io/eletroposto/estudo/${'0'.repeat(64)}`);
    expect(torto.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(torto.text).toBe(inexistente.text);
    expect(lerPorToken).toHaveBeenCalledTimes(1);
  });

  it('pronta: 200, uma CSP só (a do estudo), noindex, sem referrer e cache curto', async () => {
    h.achado = achado('pronto');
    const r = await request(app).get(`/io/eletroposto/estudo/${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('estudo pronto');
    expect(r.headers['content-security-policy']).toBe(CSP_ESTUDO);
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['cache-control']).toBe('private, max-age=60');
    expect(r.text).not.toContain('detalhe interno');
  });

  it('em preparação: página de espera sem cache', async () => {
    h.achado = achado('pendente');
    const r = await request(app).get(`/io/eletroposto/estudo/${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Estudo em preparação');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('sem o segredo do banco: 404, sem consultar', async () => {
    h.configurado = false;
    const r = await request(app).get(`/io/eletroposto/estudo/${TOKEN}`);
    expect(r.status).toBe(404);
    expect(lerPorToken).not.toHaveBeenCalled();
  });
});

describe('imagens por proxy', () => {
  const comLocal = () => achado('pronto', {
    local: { place_id: 'x', lat: -19.7, lng: -47.9, formatado: null, estabelecimento: null, rodovia: false },
    rua: { pano_id: 'pano1', data: '2024-03', heading: 80, pano_lat: -19.7, pano_lng: -47.9 },
    imagens: { satelite_ok: true, rua_ok: true },
  });

  it('satélite permitido: repassa a imagem com cache privado de um dia', async () => {
    h.achado = comLocal();
    h.imagem.mockResolvedValue({ ok: true, dado: { corpo: Buffer.from([0xff, 0xd8, 0xff]), tipo: 'image/jpeg' }, status: 'ok' });
    const r = await request(app).get(`/io/eletroposto/estudo/${TOKEN}/satelite.jpg`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['cache-control']).toBe('private, max-age=86400');
    expect(h.imagem).toHaveBeenCalledWith('satelite', { lat: -19.7, lng: -47.9 });
  });

  it('rua usa o panorama e o rumo gravados', async () => {
    h.achado = comLocal();
    h.imagem.mockResolvedValue({ ok: true, dado: { corpo: Buffer.from([1]), tipo: 'image/jpeg' }, status: 'ok' });
    await request(app).get(`/io/eletroposto/estudo/${TOKEN}/rua.jpg`);
    expect(h.imagem).toHaveBeenCalledWith('rua', 'pano1', 80);
  });

  it('fora da janela de 7 dias, Google com erro ou fotos desligadas: 404 sem corpo', async () => {
    h.achado = comLocal();
    h.permitidas = { satelite: false, rua: false };
    const fora = await request(app).get(`/io/eletroposto/estudo/${TOKEN}/satelite.jpg`);
    expect(fora.status).toBe(404);
    expect(h.imagem).not.toHaveBeenCalled();

    h.permitidas = { satelite: true, rua: true };
    h.imagem.mockResolvedValue({ ok: false, dado: null, status: 'erro:403' });
    const erro = await request(app).get(`/io/eletroposto/estudo/${TOKEN}/satelite.jpg`);
    expect(erro.status).toBe(404);
    expect(erro.text || '').toBe('');

    process.env.EP_ESTUDO_IMG_OFF = '1';
    h.imagem.mockClear();
    const desligada = await request(app).get(`/io/eletroposto/estudo/${TOKEN}/rua.jpg`);
    expect(desligada.status).toBe(404);
    expect(h.imagem).not.toHaveBeenCalled();
  });
});
