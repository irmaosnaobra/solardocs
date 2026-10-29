import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Excluir documento (29/10/2026): DELETE /documents/:id.
// Cobre: só o dono apaga; o arquivo do Storage sai e uma falha ali não derruba a resposta;
// a cota (users.documentos_usados) NÃO volta; o contador de numeração é garantido ANTES de
// apagar a proposta (senão o número dela seria reaproveitado e o link antigo abriria outra
// proposta); e a corrida com regenerate e PATCH /:id/file (update em zero linhas = 404 e o
// upload novo não fica órfão). Banco falso em memória; nada sai para a rede.

const { mockUpload, mockRemove } = vi.hoisted(() => ({
  mockUpload: vi.fn().mockResolvedValue({ error: null }),
  mockRemove: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('../utils/supabase', async () => {
  const f = await import('./_bancoFalso');
  return {
    supabase: {
      from: f.supabase.from,
      rpc: f.supabase.rpc,
      storage: { from: () => ({ upload: mockUpload, remove: mockRemove }) },
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
vi.mock('../services/templateService', () => ({
  generateFromTemplate: vi.fn().mockReturnValue('<html>template</html>'),
  propostaDiasValidade: vi.fn().mockReturnValue(7),
}));

import app from '../app';
import { banco } from './_bancoFalso';

const AUTH = 'Bearer valid-token';
const USER = 'user-123';

function semearDoc(over: Record<string, unknown> = {}) {
  banco.poe('documents', {
    id: 'doc-1', user_id: USER, tipo: 'propostaSolar', cliente_id: null, terceiro_id: null,
    cliente_nome: 'Cliente Padrao', codigo_curto: null, arquivo_url: `${USER}/doc-1-1.html`,
    content: '<html>conteudo</html>', dados_json: { a: 1 }, created_at: '2026-10-01T12:00:00.000Z', ...over,
  });
}
const apagar = (id = 'doc-1') => request(app).delete(`/documents/${id}`).set('Authorization', AUTH);
const doc = (id = 'doc-1') => banco.linhas('documents').find((d) => d.id === id);
const escritasDe = (tabela: string, op?: string) => banco.escritas.filter((e) => e.tabela === tabela && (!op || e.op === op));
const contador = () => banco.linhas('documentos_numeracao').find((c) => c.user_id === USER && c.ano === 2026);

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  vi.clearAllMocks();
  mockUpload.mockResolvedValue({ error: null });
  mockRemove.mockResolvedValue({ error: null });
  banco.poe('users', { id: USER, plano: 'pro', is_admin: false, documentos_usados: 4, limite_documentos: 5 });
  banco.poe('company', { id: 'comp-1', user_id: USER, nome: 'Empresa', cnpj: '00.000.000/0001-00', slug: 'empresa' });
});

describe('DELETE /documents/:id', () => {
  it('apaga o próprio: a linha some, o arquivo sai do Storage e a cota NÃO volta', async () => {
    semearDoc();

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(doc()).toBeUndefined();
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith([`${USER}/doc-1-1.html`]);
    expect(banco.linhas('users')[0]!.documentos_usados).toBe(4);
    expect(escritasDe('users')).toHaveLength(0);
  });

  it('documento de outro usuário: 404, nada é apagado e o Storage não é tocado', async () => {
    semearDoc({ user_id: 'outro-user' });

    const res = await apagar();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Arquivo não encontrado.' });
    expect(doc()).toBeDefined();
    expect(escritasDe('documents')).toHaveLength(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('id inexistente: 404', async () => {
    const res = await apagar('nao-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Arquivo não encontrado.' });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('id que não é uuid (erro 22P02 do banco): 404, não 500', async () => {
    banco.falhas['documents.select'] = { erro: { code: '22P02', message: 'invalid input syntax for type uuid' } };
    const res = await apagar('lixo');
    expect(res.status).toBe(404);
  });

  it('sem token: 401', async () => {
    semearDoc();
    const res = await request(app).delete('/documents/doc-1');
    expect(res.status).toBe(401);
    expect(doc()).toBeDefined();
  });

  it('sem arquivo_url: 200 e o Storage não é chamado', async () => {
    semearDoc({ arquivo_url: null });

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(doc()).toBeUndefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('o Storage falha ao remover: 200 mesmo assim (a linha já saiu)', async () => {
    semearDoc();
    mockRemove.mockResolvedValueOnce({ error: { message: 'storage fora do ar' } });
    const res = await apagar();
    expect(res.status).toBe(200);
    expect(doc()).toBeUndefined();

    semearDoc({ id: 'doc-2', arquivo_url: `${USER}/doc-2-1.html` });
    mockRemove.mockRejectedValueOnce(new Error('rede'));
    const res2 = await apagar('doc-2');
    expect(res2.status).toBe(200);
    expect(doc('doc-2')).toBeUndefined();
  });

  it('arquivo_url fora da pasta do usuário: a linha sai, o arquivo não é tocado', async () => {
    semearDoc({ arquivo_url: 'outro-user/doc-x.html' });
    const res = await apagar();
    expect(res.status).toBe(200);
    expect(doc()).toBeUndefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('linha ligada a outro registro (23503): 409 e o arquivo fica', async () => {
    semearDoc();
    banco.falhas['documents.delete'] = { erro: { code: '23503', message: 'violates foreign key constraint' } };

    const res = await apagar();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Esse arquivo está ligado a outro registro e não pode ser excluído.');
    expect(doc()).toBeDefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('outro erro no delete: 500 e o arquivo fica', async () => {
    semearDoc();
    banco.falhas['documents.delete'] = { erro: { code: 'XX000', message: 'boom' } };

    const res = await apagar();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Não consegui excluir agora. Tente de novo.');
    expect(doc()).toBeDefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('DELETE /documents/:id: contador de numeração', () => {
  it('proposta 20260050 sem linha no contador: cria { ano: 2026, ultimo: 50 } ANTES do delete', async () => {
    semearDoc({ codigo_curto: '20260050' });

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(contador()).toMatchObject({ user_id: USER, ano: 2026, ultimo: 50 });
    const ordem = banco.escritas.map((e) => `${e.tabela}.${e.op}`);
    expect(ordem.indexOf('documentos_numeracao.insert')).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf('documentos_numeracao.insert')).toBeLessThan(ordem.indexOf('documents.delete'));
  });

  it('contador já em 80: continua 80, sem escrita nele', async () => {
    banco.poe('documentos_numeracao', { user_id: USER, ano: 2026, ultimo: 80 });
    semearDoc({ codigo_curto: '20260050' });

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(contador()!.ultimo).toBe(80);
    expect(escritasDe('documentos_numeracao')).toHaveLength(0);
  });

  it('contador atrás (30): sobe para 50 antes do delete', async () => {
    banco.poe('documentos_numeracao', { user_id: USER, ano: 2026, ultimo: 30 });
    semearDoc({ codigo_curto: '20260050' });

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(contador()!.ultimo).toBe(50);
    const ordem = banco.escritas.map((e) => `${e.tabela}.${e.op}`);
    expect(ordem.indexOf('documentos_numeracao.update')).toBeLessThan(ordem.indexOf('documents.delete'));
  });

  it('falha ao gravar o contador (insert): 500, a linha e o arquivo continuam', async () => {
    semearDoc({ codigo_curto: '20260050' });
    banco.falhas['documentos_numeracao.insert'] = { erro: { code: 'XX000', message: 'boom' } };

    const res = await apagar();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Não consegui excluir agora. Tente de novo.');
    expect(doc()).toBeDefined();
    expect(escritasDe('documents', 'delete')).toHaveLength(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('falha ao subir o contador (update): 500 e nada é apagado', async () => {
    banco.poe('documentos_numeracao', { user_id: USER, ano: 2026, ultimo: 30 });
    semearDoc({ codigo_curto: '20260050' });
    banco.falhas['documentos_numeracao.update'] = { erro: { code: 'XX000', message: 'boom' } };

    const res = await apagar();

    expect(res.status).toBe(500);
    expect(doc()).toBeDefined();
    expect(contador()!.ultimo).toBe(30);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('falha ao LER o contador: 500 e nada é apagado', async () => {
    semearDoc({ codigo_curto: '20260050' });
    banco.falhas['documentos_numeracao.select'] = { erro: { code: 'XX000', message: 'boom' } };

    const res = await apagar();

    expect(res.status).toBe(500);
    expect(doc()).toBeDefined();
  });

  it('outra requisição criou o contador no meio (23505): relê e segue', async () => {
    semearDoc({ codigo_curto: '20260050' });
    banco.falhas['documentos_numeracao.insert'] = { erro: { code: '23505', message: 'duplicate key' }, uma: true };

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(doc()).toBeUndefined();
    expect(contador()!.ultimo).toBe(50);
  });

  it('documento sem codigo_curto (contrato) não mexe no contador', async () => {
    semearDoc({ tipo: 'contratoSolar', codigo_curto: null });

    const res = await apagar();

    expect(res.status).toBe(200);
    expect(banco.linhas('documentos_numeracao')).toHaveLength(0);
    expect(escritasDe('documentos_numeracao')).toHaveLength(0);
  });
});

// A linha some entre a conferência do começo e o update final (outra aba excluiu).
// O upload novo não pode ficar órfão e o arquivo antigo não pode sair.
describe('corrida: documento excluído durante a edição', () => {
  const ANTIGO = `${USER}/doc-edit-antigo.html`;
  const sumirNoUpload = () =>
    mockUpload.mockImplementationOnce(async () => { banco.tabelas.documents = []; return { error: null }; });

  it('regenerate com o update em zero linhas: 404, o upload novo é removido e o antigo não', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, dados_json: { valor_total: '20000' } });
    sumirNoUpload();

    const res = await request(app).post('/documents/doc-edit/regenerate').set('Authorization', AUTH)
      .send({ fields: { valor_total: '22000' }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Esse arquivo foi excluído.' });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const novo = mockUpload.mock.calls[0]![0] as string;
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith([novo]);
    expect(mockRemove).not.toHaveBeenCalledWith([ANTIGO]);
  });

  it('regenerate normal: o arquivo antigo só sai DEPOIS do update', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, dados_json: { valor_total: '20000' } });
    // O remove é silencioso (engole exceção), então o que a linha apontava na hora dele é anotado e conferido depois.
    let apontavaNaHora: unknown = 'nunca chamou';
    mockRemove.mockImplementationOnce(async () => { apontavaNaHora = doc('doc-edit')!.arquivo_url; return { error: null }; });

    const res = await request(app).post('/documents/doc-edit/regenerate').set('Authorization', AUTH)
      .send({ fields: { valor_total: '22000' }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith([ANTIGO]);
    // Quando o antigo é removido, a linha já aponta para o arquivo novo (update antes do remove).
    expect(apontavaNaHora).toMatch(new RegExp('^' + USER + '/doc-edit-[0-9]+[.]html$'));
  });

  it('regenerate: remove do antigo que rejeita não derruba a resposta (a edição já está salva)', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, dados_json: { valor_total: '20000' } });
    mockRemove.mockRejectedValueOnce(new Error('rede'));

    const res = await request(app).post('/documents/doc-edit/regenerate').set('Authorization', AUTH)
      .send({ fields: { valor_total: '22000' }, useTemplate: true, modeloNumero: 2 });

    expect(res.status).toBe(200);
    expect(doc('doc-edit')!.dados_json).toEqual({ valor_total: '22000' });
  });

  const FOLHA = '[[HTML]]<style>.ct{color:#000}</style><div class="ct" data-run-header="MH"><p>'
    + 'Cláusula primeira, do objeto deste contrato de instalação de usina fotovoltaica. '.repeat(6)
    + '</p></div>';
  const arquivo = (corpo: string) =>
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head><body>${corpo}</body></html>`;
  const patch = () => {
    const revisado = FOLHA.replace('do objeto', 'do objeto (revisado)');
    return request(app).patch('/documents/doc-edit/file').set('Authorization', AUTH)
      .send({ content: revisado, html_content: arquivo(revisado) });
  };

  it('PATCH /:id/file com o update em zero linhas: 404, o upload novo é removido e o antigo não', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, content: FOLHA, cliente_nome: null });
    sumirNoUpload();

    const res = await patch();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Esse arquivo foi excluído.' });
    const novo = mockUpload.mock.calls[0]![0] as string;
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith([novo]);
    expect(mockRemove).not.toHaveBeenCalledWith([ANTIGO]);
  });

  it('PATCH /:id/file com erro no update: 503, o upload novo é removido e o antigo fica', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, content: FOLHA, cliente_nome: null });
    banco.falhas['documents.update'] = { erro: { code: 'XX000', message: 'boom' } };

    const res = await patch();

    expect(res.status).toBe(503);
    const novo = mockUpload.mock.calls[0]![0] as string;
    expect(mockRemove).toHaveBeenCalledWith([novo]);
    expect(mockRemove).not.toHaveBeenCalledWith([ANTIGO]);
    expect(doc('doc-edit')!.arquivo_url).toBe(ANTIGO);
  });

  it('PATCH /:id/file normal: 200 e o antigo sai depois do update', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, content: FOLHA, cliente_nome: null });

    let apontavaNaHora: unknown = 'nunca chamou';
    mockRemove.mockImplementationOnce(async () => { apontavaNaHora = doc('doc-edit')!.arquivo_url; return { error: null }; });

    const res = await patch();

    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith([ANTIGO]);
    expect(doc('doc-edit')!.arquivo_url).not.toBe(ANTIGO);
    // Update antes do remove: na hora de remover o antigo, a linha já apontava para o novo.
    expect(apontavaNaHora).toBe(doc('doc-edit')!.arquivo_url);
  });

  it('PATCH /:id/file: remove do antigo que rejeita não derruba a resposta', async () => {
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ANTIGO, content: FOLHA, cliente_nome: null });
    mockRemove.mockRejectedValueOnce(new Error('rede'));

    const res = await patch();

    expect(res.status).toBe(200);
  });

  it('arquivo_url fora da pasta do usuário nunca é removido (regenerate e PATCH)', async () => {
    const ALHEIO = 'outro-user/doc-x.html';
    banco.linhas('users').splice(0, 1);
    banco.poe('users', { id: USER, plano: 'ilimitado', is_admin: false, documentos_usados: 4, limite_documentos: 999999 });
    semearDoc({ id: 'doc-edit', tipo: 'contratoSolar', arquivo_url: ALHEIO, content: FOLHA, dados_json: { valor_total: '1' } });

    const r1 = await request(app).post('/documents/doc-edit/regenerate').set('Authorization', AUTH)
      .send({ fields: { valor_total: '22000' }, useTemplate: true, modeloNumero: 2 });
    expect(r1.status).toBe(200);
    expect(mockRemove).not.toHaveBeenCalledWith([ALHEIO]);

    banco.linhas('documents').find((d) => d.id === 'doc-edit')!.arquivo_url = ALHEIO;
    const r2 = await patch();
    expect(r2.status).toBe(200);
    expect(mockRemove).not.toHaveBeenCalledWith([ALHEIO]);
  });
});

// Falha passageira do banco não pode virar 404: o front trata 404 como "excluído" e sai da edição.
describe('leitura do documento na edição: ausência é 404, falha do banco é 503', () => {
  const regen = () => request(app).post('/documents/doc-1/regenerate').set('Authorization', AUTH)
    .send({ fields: { valor_total: '22000' }, useTemplate: true, modeloNumero: 2 });
  const abrir = () => request(app).get('/documents/doc-1/edit').set('Authorization', AUTH);

  it('GET /:id/edit: sem linha (PGRST116) é 404', async () => {
    expect((await abrir()).status).toBe(404);
    banco.falhas['documents.select'] = { erro: { code: 'PGRST116', message: 'nenhuma linha' }, uma: true };
    expect((await abrir()).status).toBe(404);
  });

  it('GET /:id/edit: outro erro do banco é 503, não 404', async () => {
    semearDoc();
    banco.falhas['documents.select'] = { erro: { code: 'XX000', message: 'banco caiu' }, uma: true };
    const res = await abrir();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Não consegui abrir agora. Tente de novo.' });
  });

  it('regenerate: sem linha é 404 e erro do banco é 503, sem escrever nada', async () => {
    expect((await regen()).status).toBe(404);

    semearDoc();
    banco.falhas['documents.select'] = { erro: { code: 'XX000', message: 'banco caiu' }, uma: true };
    const res = await regen();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Não consegui abrir agora. Tente de novo.' });
    expect(escritasDe('documents')).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
