import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// OAuth do MCP FECHADO em 03/11/2026: o /oauth/authorize dava código a qualquer um e o /oauth/token trocava por MCP_TOKEN.
vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));

import mcpRouter from '../routes/mcp';

const app = express();
app.use(express.json());
app.use('/mcp', mcpRouter);

describe('MCP OAuth fechado', () => {
  it('authorize dá 403 oauth_desligado, sem Location e sem código', async () => {
    const r = await request(app).get('/mcp/oauth/authorize?redirect_uri=https://exemplo.invalido/cb&state=abc');
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'oauth_desligado' });
    expect(r.headers.location).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('code');
  });

  it('token dá 400 invalid_grant e nunca devolve access_token, nem com MCP_TOKEN setado', async () => {
    const antes = process.env.MCP_TOKEN;
    process.env.MCP_TOKEN = 'falso-mcp-token-de-teste';
    try {
      const r = await request(app).post('/mcp/oauth/token').send({ code: 'qualquer', grant_type: 'authorization_code' });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'invalid_grant' });
      expect(r.text).not.toContain('access_token');
      expect(r.text).not.toContain('falso-mcp-token-de-teste');
    } finally {
      if (antes === undefined) delete process.env.MCP_TOKEN; else process.env.MCP_TOKEN = antes;
    }
  });

  it('o POST / sem Bearer continua 401', async () => {
    const r = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.status).toBe(401);
  });
});
