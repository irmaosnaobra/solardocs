import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const https = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('https', () => ({ default: https, ...https }));

import { executePixelEvent } from '../controllers/pixelController';

describe('pixelController sem token escrito no código', () => {
  const antes = process.env.META_SYSTEM_USER_TOKEN;
  const antesReserva = process.env.META_PIXEL_TOKEN;
  afterEach(() => {
    if (antes === undefined) delete process.env.META_SYSTEM_USER_TOKEN; else process.env.META_SYSTEM_USER_TOKEN = antes;
    if (antesReserva === undefined) delete process.env.META_PIXEL_TOKEN; else process.env.META_PIXEL_TOKEN = antesReserva;
    https.request.mockReset();
  });

  it('o arquivo-fonte não contém token do Meta (EAA...)', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'pixelController.ts'), 'utf8');
    expect(fonte).not.toMatch(/EAA[A-Za-z0-9]{20,}/);
  });

  it('sem META_SYSTEM_USER_TOKEN nem META_PIXEL_TOKEN não envia e não lança', async () => {
    delete process.env.META_SYSTEM_USER_TOKEN;
    delete process.env.META_PIXEL_TOKEN;
    await expect(executePixelEvent({ phone: '5534999999999', event_name: 'Lead' })).resolves.toEqual({ skipped: 'sem_token' });
    expect(https.request).not.toHaveBeenCalled();
  });

  it('pixel fora da lista continua lançando', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'falso-token-de-teste';
    await expect(executePixelEvent({ pixel_id: '1', event_name: 'Lead' })).rejects.toThrow(/Pixel/);
    expect(https.request).not.toHaveBeenCalled();
  });

  it('com token e pixel permitido, envia ao Graph com o token do env', async () => {
    process.env.META_SYSTEM_USER_TOKEN = 'falso-token-de-teste';
    let caminho = '';
    https.request.mockImplementation((opts: any, cb: any) => {
      caminho = opts.path;
      const res: any = { on: (ev: string, f: any) => { if (ev === 'data') f('{"events_received":1}'); if (ev === 'end') f(); } };
      cb(res);
      return { on: vi.fn(), write: vi.fn(), end: vi.fn() };
    });
    const r = await executePixelEvent({ pixel_id: '824905216831401', event_name: 'Lead', phone: '5534999999999' });
    expect(r).toEqual({ events_received: 1 });
    expect(caminho).toBe('/v19.0/824905216831401/events?access_token=falso-token-de-teste');
  });

  it('sem META_SYSTEM_USER_TOKEN usa a reserva META_PIXEL_TOKEN; com os dois, vale o SYSTEM_USER', async () => {
    const caminhos: string[] = [];
    https.request.mockImplementation((opts: any, cb: any) => {
      caminhos.push(opts.path);
      const res: any = { on: (ev: string, f: any) => { if (ev === 'data') f('{"events_received":1}'); if (ev === 'end') f(); } };
      cb(res);
      return { on: vi.fn(), write: vi.fn(), end: vi.fn() };
    });
    delete process.env.META_SYSTEM_USER_TOKEN;
    process.env.META_PIXEL_TOKEN = 'falso-reserva';
    await executePixelEvent({ pixel_id: '824905216831401', event_name: 'Lead', phone: '5534999999999' });
    process.env.META_SYSTEM_USER_TOKEN = 'falso-principal';
    await executePixelEvent({ pixel_id: '824905216831401', event_name: 'Lead', phone: '5534999999999' });
    expect(caminhos).toEqual([
      '/v19.0/824905216831401/events?access_token=falso-reserva',
      '/v19.0/824905216831401/events?access_token=falso-principal',
    ]);
  });
});
