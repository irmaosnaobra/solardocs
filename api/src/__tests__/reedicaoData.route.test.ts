import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Reeditar um contrato, procuração, recibo ou proposta de banco reimprime a data da EMISSÃO,
// não a do dia da correção. O template real roda aqui (nada é mockado nele); o banco é o falso.

vi.mock('../utils/supabase', async () => {
  const f = await import('./_bancoFalso');
  return {
    supabase: {
      from: (t: string) => f.supabase.from(t),
      rpc: f.supabase.rpc,
      storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }), createSignedUrl: vi.fn() }) },
    },
  };
});
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/jwt', () => ({
  signToken: vi.fn().mockReturnValue('mock-token'),
  verifyToken: vi.fn((t: string) => {
    if (t === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  }),
}));
vi.mock('stripe', () => ({ default: class { customers = { list: vi.fn().mockResolvedValue({ data: [] }) } } }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('../utils/mailer', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  sendWelcomeWhatsApp: vi.fn(),
  handleIncomingWhatsApp: vi.fn(),
  processMessageQueue: vi.fn().mockResolvedValue({ processed: 0 }),
}));
vi.mock('../services/aiService', () => ({ generateDocumentWithAI: vi.fn().mockResolvedValue('<html>doc</html>') }));

import app from '../app';
import { banco } from './_bancoFalso';
import { generateFromTemplate } from '../services/templateService';

const AUTH = 'Bearer valid-token';
const C1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const empresa = { id: 'comp-1', user_id: 'user-123', nome: 'Empresa Solar', cnpj: '00.000.000/0001-00', slug: 'empresa', cidade: 'Campina Grande', uf: 'PB' };
const cliente = { id: C1, user_id: 'user-123', nome: 'João da Silva', cpf_cnpj: '111.111.111-11', cidade: 'Campina Grande', uf: 'PB', endereco: 'Rua A, 10' };

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  banco.poe('company', empresa);
  banco.poe('clients', cliente);
  banco.poe('users', { id: 'user-123', plano: 'pro', is_admin: false, documentos_usados: 3, limite_documentos: 90 });
});
afterEach(() => vi.useRealTimers());

describe('reedição mantém a data da emissão', () => {
  it('contrato criado em 10/09 e reeditado depois imprime 10 de setembro, não o dia da edição', async () => {
    // O created_at de documents vem 3h adiantado: 10/09 15:00 gravado = 10/09 12:00 em Brasília.
    banco.poe('documents', {
      id: 'doc-c', user_id: 'user-123', tipo: 'contratoSolar', cliente_id: C1, terceiro_id: null,
      cliente_nome: 'João da Silva', codigo_curto: null, arquivo_url: null,
      dados_json: { potencia_kwp: '5', valor_total: '20000' }, created_at: '2026-09-10T15:00:00.000Z',
    });

    const res = await request(app).post('/documents/doc-c/regenerate').set('Authorization', AUTH)
      .send({ fields: { potencia_kwp: '6', valor_total: '22000' }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    expect(res.body.content).toContain('10 de setembro de 2026');
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    if (hoje !== '10 de setembro de 2026') expect(res.body.content).not.toContain(hoje);
    // A data base não vai para o dados_json.
    const salvo = banco.linhas('documents')[0]!.dados_json as Record<string, unknown>;
    expect(JSON.stringify(salvo)).not.toMatch(/dataBase|data_base|setembro/);
  });

  it('o generate segue imprimindo a data de hoje', () => {
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const html = generateFromTemplate('contratoSolar', empresa as never, cliente as never, { potencia_kwp: '5' }, 2);
    expect(html).toContain(hoje);
  });

  it('a data base de uma chamada não vaza para a seguinte', () => {
    const base = new Date('2026-09-10T15:00:00.000Z');
    generateFromTemplate('contratoSolar', empresa as never, cliente as never, { potencia_kwp: '5' }, 2, undefined, base);
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const depois = generateFromTemplate('contratoSolar', empresa as never, cliente as never, { potencia_kwp: '5' }, 2);
    expect(depois).toContain(hoje);
  });

  it('procuração reeditada também mantém a data', async () => {
    banco.poe('documents', {
      id: 'doc-p', user_id: 'user-123', tipo: 'procuracao', cliente_id: C1, terceiro_id: null,
      cliente_nome: 'João da Silva', codigo_curto: null, arquivo_url: null,
      dados_json: { uc: '1', concessionaria: 'Energisa' }, created_at: '2026-09-10T15:00:00.000Z',
    });

    const res = await request(app).post('/documents/doc-p/regenerate').set('Authorization', AUTH)
      .send({ fields: { uc: '2', concessionaria: 'Energisa', foro_cidade: 'Campina Grande' }, useTemplate: true, modeloNumero: 1 });

    expect(res.status).toBe(200);
    expect(res.body.content).toMatch(/10 de setembro de 2026|10\/09\/2026/);
  });
});
