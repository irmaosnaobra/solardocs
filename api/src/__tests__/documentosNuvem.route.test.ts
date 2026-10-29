import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Todos os documentos na nuvem, editáveis, para todos os planos (28/10/2026).
// Cobre: lista sem bloqueio por plano e sem corte de 30 dias, paginada e filtrada no servidor;
// resumo e pasta do cliente; regenerate (mesmo registro, sem cota, trava de cliente);
// e a limpeza do plano pro que deixou de apagar. Banco falso em memória; nada sai para a rede.

const { mockUpload, mockRemove, mockSign } = vi.hoisted(() => ({
  mockUpload: vi.fn().mockResolvedValue({ error: null }),
  mockRemove: vi.fn().mockResolvedValue({ error: null }),
  mockSign: vi.fn(async (p: string) => ({ data: { signedUrl: `https://storage.exemplo/${p}` }, error: null })),
}));

// O banco falso só entende like/eq dentro de .or(); a busca do /list usa ilike. O acréscimo
// fica aqui, no teste, para não mexer no arquivo compartilhado.
vi.mock('../utils/supabase', async () => {
  const f = await import('./_bancoFalso');
  const casa = (valor: unknown, padrao: string) =>
    new RegExp('^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'is').test(String(valor ?? ''));
  const comIlike = (q: any) => {
    // O banco falso guarda uma ordenação só; o desempate .order('id') (que o Postgres usa)
    // não pode apagar a ordenação por data.
    const ordenar = q.order.bind(q);
    q.order = (col: string, o?: { ascending?: boolean }) => (col === 'id' ? q : ordenar(col, o));
    const original = q.or.bind(q);
    q.or = (expr: string) => {
      if (!/\.ilike\./.test(expr)) return original(expr);
      const partes = expr.split(',').map((p) => {
        const m = /^(.+?)\.ilike\.(.*)$/.exec(p)!;
        return { c: m[1]!, v: m[2]! };
      });
      q.filtros.push((r: Record<string, unknown>) => partes.some((p) => casa(r[p.c], p.v)));
      return q;
    };
    return q;
  };
  return {
    supabase: {
      from: (t: string) => comIlike(f.supabase.from(t)),
      rpc: f.supabase.rpc,
      storage: { from: () => ({ upload: mockUpload, remove: mockRemove, createSignedUrl: mockSign }) },
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
import { chaveCliente } from '../utils/chaveCliente';
import { cleanupProDocuments } from '../controllers/documentsController';
import { generateFromTemplate } from '../services/templateService';

const AUTH = 'Bearer valid-token';
const C1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const C2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const T1 = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

let seq = 0;
function doc(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `doc-${String(seq).padStart(4, '0')}`,
    user_id: 'user-123',
    tipo: 'contratoSolar',
    cliente_id: null,
    terceiro_id: null,
    cliente_nome: 'Cliente Padrao',
    codigo_curto: null,
    modelo_usado: 'modelo-1',
    arquivo_url: null,
    content: '<html>conteudo pesado</html>',
    dados_json: { segredo: 'nao pode sair na lista' },
    created_at: diasAtras(1),
    ...over,
  };
}

function usuario(plano: string, extra: Record<string, unknown> = {}) {
  banco.poe('users', { id: 'user-123', plano, is_admin: false, documentos_usados: 3, limite_documentos: 5, ...extra });
}

beforeEach(() => {
  banco.reset();
  banco.projeta = true;
  seq = 0;
  vi.clearAllMocks();
  banco.poe('company', { id: 'comp-1', user_id: 'user-123', nome: 'Empresa', cnpj: '00.000.000/0001-00', slug: 'empresa' });
});

// ─── chaveCliente ────────────────────────────────────────────────────
describe('chaveCliente', () => {
  it('ignora acento, maiúscula e espaço repetido', () => {
    expect(chaveCliente('PAROQUIA DE SÃO JOSÉ')).toBe('paroquia de sao jose');
    expect(chaveCliente('  paroquia   de sao  jose ')).toBe('paroquia de sao jose');
    expect(chaveCliente('João  da Silva')).toBe(chaveCliente('joao da silva'));
  });
  it('nome vazio vira chave vazia, nunca "null"', () => {
    expect(chaveCliente(null)).toBe('');
    expect(chaveCliente(undefined)).toBe('');
    expect(chaveCliente('   ')).toBe('');
  });
});

// ─── GET /documents/list ─────────────────────────────────────────────
describe('GET /documents/list', () => {
  it('free e iniciante veem os documentos, sem corte de 30 dias', async () => {
    for (const plano of ['free', 'iniciante', 'pro']) {
      banco.reset(); banco.projeta = true;
      usuario(plano);
      banco.poe('documents', doc({ created_at: diasAtras(400) }), doc({ created_at: diasAtras(2) }));

      const res = await request(app).get('/documents/list').set('Authorization', AUTH);

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.historico).toBe(true);
    }
  });

  it('devolve do mais novo para o mais velho e não leva content nem dados_json', async () => {
    usuario('free');
    banco.poe('documents', doc({ id: 'velho', created_at: diasAtras(50) }), doc({ id: 'novo', created_at: diasAtras(1) }));

    const res = await request(app).get('/documents/list').set('Authorization', AUTH);

    expect(res.body.documents.map((d: { id: string }) => d.id)).toEqual(['novo', 'velho']);
    for (const d of res.body.documents) {
      expect(d).not.toHaveProperty('content');
      expect(d).not.toHaveProperty('dados_json');
      expect(d).not.toHaveProperty('arquivo_url');
    }
  });

  it('nao mostra documento de outro usuario', async () => {
    usuario('free');
    banco.poe('documents', doc({ id: 'meu' }), doc({ id: 'alheio', user_id: 'user-999' }));

    const res = await request(app).get('/documents/list').set('Authorization', AUTH);

    expect(res.body.documents.map((d: { id: string }) => d.id)).toEqual(['meu']);
  });

  it('pagina: 120 documentos em páginas de 50, total e has_more corretos', async () => {
    usuario('free');
    for (let i = 0; i < 120; i++) banco.poe('documents', doc({ created_at: diasAtras(300 - i) }));

    const p1 = await request(app).get('/documents/list').query({ page: 1, limit: 50 }).set('Authorization', AUTH);
    const p3 = await request(app).get('/documents/list').query({ page: 3, limit: 50 }).set('Authorization', AUTH);

    expect(p1.body.documents).toHaveLength(50);
    expect(p1.body).toMatchObject({ total: 120, page: 1, limit: 50, has_more: true });
    expect(p3.body.documents).toHaveLength(20);
    expect(p3.body).toMatchObject({ total: 120, page: 3, has_more: false });
    const idsP1 = new Set(p1.body.documents.map((d: { id: string }) => d.id));
    expect(p3.body.documents.some((d: { id: string }) => idsP1.has(d.id))).toBe(false);
  });

  it('offset: depois de excluir um da primeira página, o próximo lote não pula ninguém', async () => {
    usuario('free');
    for (let i = 0; i < 25; i++) banco.poe('documents', doc({ id: `d-${String(i).padStart(2, '0')}`, created_at: diasAtras(100 - i) }));
    const ordem = (r: { body: { documents: Array<{ id: string }> } }) => r.body.documents.map((d) => d.id);

    const p1 = await request(app).get('/documents/list').query({ limit: 20 }).set('Authorization', AUTH);
    expect(p1.body.documents).toHaveLength(20);
    expect(p1.body).toMatchObject({ total: 25, offset: 0, has_more: true });
    const todos = ordem(p1);
    // Exclui um da tela. O documento da posição 20 sobe para a 19.
    banco.tabelas.documents = banco.linhas('documents').filter((d) => d.id !== todos[3]);

    const prox = await request(app).get('/documents/list').query({ limit: 20, offset: 19 }).set('Authorization', AUTH);
    expect(prox.body).toMatchObject({ total: 24, offset: 19, has_more: false });
    expect(prox.body.documents).toHaveLength(5);
    // Por página, o lote começaria na posição 20 e pularia o que subiu.
    const porPagina = await request(app).get('/documents/list').query({ limit: 20, page: 2 }).set('Authorization', AUTH);
    expect(porPagina.body.documents).toHaveLength(4);
    expect(ordem(prox).slice(1)).toEqual(ordem(porPagina));
  });

  it('offset tem precedência sobre page; offset inválido é ignorado e vale page', async () => {
    usuario('free');
    for (let i = 0; i < 30; i++) banco.poe('documents', doc({ id: `e-${String(i).padStart(2, '0')}`, created_at: diasAtras(100 - i) }));
    const ids = (r: { body: { documents: Array<{ id: string }> } }) => r.body.documents.map((d) => d.id);

    const base = await request(app).get('/documents/list').query({ limit: 10 }).set('Authorization', AUTH);
    const comOffset = await request(app).get('/documents/list').query({ limit: 10, page: 1, offset: 5 }).set('Authorization', AUTH);
    expect(ids(comOffset)).toEqual(ids(await request(app).get('/documents/list').query({ limit: 10, offset: 5 }).set('Authorization', AUTH)));
    expect(ids(comOffset)[0]).toBe(ids(base)[5]);

    const p2 = await request(app).get('/documents/list').query({ limit: 10, page: 2 }).set('Authorization', AUTH);
    for (const ruim of ['-1', 'abc', '1.5', '']) {
      const r = await request(app).get('/documents/list').query({ limit: 10, page: 2, offset: ruim }).set('Authorization', AUTH);
      expect(ids(r)).toEqual(ids(p2));
    }
  });

  it('limit passa de 100 vira 100', async () => {
    usuario('free');
    for (let i = 0; i < 130; i++) banco.poe('documents', doc());

    const res = await request(app).get('/documents/list').query({ limit: 500 }).set('Authorization', AUTH);

    expect(res.body.limit).toBe(100);
    expect(res.body.documents).toHaveLength(100);
  });

  it('filtra por tipo (um ou vários)', async () => {
    usuario('free');
    banco.poe('documents',
      doc({ id: 'p', tipo: 'propostaSolar' }), doc({ id: 'c', tipo: 'contratoSolar' }),
      doc({ id: 'r', tipo: 'recibo' }), doc({ id: 'pr', tipo: 'procuracao' }));

    const um = await request(app).get('/documents/list').query({ tipo: 'recibo' }).set('Authorization', AUTH);
    const varios = await request(app).get('/documents/list').query({ tipo: 'contratoSolar,procuracao' }).set('Authorization', AUTH);

    expect(um.body.documents.map((d: { id: string }) => d.id)).toEqual(['r']);
    expect(varios.body.documents.map((d: { id: string }) => d.id).sort()).toEqual(['c', 'pr']);
  });

  it('busca por parte do nome do cliente (sem ligar para maiúscula) e pelo código', async () => {
    usuario('free');
    banco.poe('documents',
      doc({ id: 'a', cliente_nome: 'MARIA SILVA' }),
      doc({ id: 'b', cliente_nome: 'Pedro Alves', codigo_curto: '20260042' }));

    const nome = await request(app).get('/documents/list').query({ q: 'maria' }).set('Authorization', AUTH);
    const codigo = await request(app).get('/documents/list').query({ q: '2026004' }).set('Authorization', AUTH);

    expect(nome.body.documents.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(codigo.body.documents.map((d: { id: string }) => d.id)).toEqual(['b']);
  });

  it('busca com vírgula e parêntese não quebra a consulta', async () => {
    usuario('free');
    banco.poe('documents', doc({ cliente_nome: 'Maria' }));

    const res = await request(app).get('/documents/list').query({ q: 'ma,ri(a)*%' }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
  });

  it('filtra por período (de e ate)', async () => {
    usuario('free');
    banco.poe('documents',
      doc({ id: 'antigo', created_at: '2026-01-10T12:00:00.000Z' }),
      doc({ id: 'meio', created_at: '2026-06-15T12:00:00.000Z' }),
      doc({ id: 'recente', created_at: '2026-10-20T12:00:00.000Z' }));

    const desde = await request(app).get('/documents/list').query({ de: '2026-06-01' }).set('Authorization', AUTH);
    const janela = await request(app).get('/documents/list').query({ de: '2026-06-01', ate: '2026-06-15' }).set('Authorization', AUTH);

    expect(desde.body.documents.map((d: { id: string }) => d.id)).toEqual(['recente', 'meio']);
    // O dia final entra inteiro (15/06 às 12h está dentro de ate=2026-06-15).
    expect(janela.body.documents.map((d: { id: string }) => d.id)).toEqual(['meio']);
  });

  it('filtra por cliente_id', async () => {
    usuario('free');
    banco.poe('documents', doc({ id: 'x', cliente_id: C1 }), doc({ id: 'y', cliente_id: C2 }), doc({ id: 'z' }));

    const res = await request(app).get('/documents/list').query({ cliente_id: C1 }).set('Authorization', AUTH);

    expect(res.body.documents.map((d: { id: string }) => d.id)).toEqual(['x']);
  });

  it('cliente_chave junta os documentos sem id pelo nome, sem ligar para acento nem espaço', async () => {
    usuario('free');
    banco.poe('documents',
      doc({ id: 'a', cliente_nome: 'PAROQUIA DE SÃO JOSÉ' }),
      doc({ id: 'b', cliente_nome: 'paroquia  de sao jose ' }),
      doc({ id: 'c', cliente_nome: 'Outra Paroquia' }),
      // Tem id de cliente: não entra pela chave (a pasta dele é a do id).
      doc({ id: 'd', cliente_nome: 'Paroquia de Sao Jose', cliente_id: C2 }));

    const res = await request(app).get('/documents/list').query({ cliente_chave: 'paroquia de sao jose' }).set('Authorization', AUTH);

    expect(res.body.documents.map((d: { id: string }) => d.id).sort()).toEqual(['a', 'b']);
    expect(res.body.total).toBe(2);
  });

  it('cliente_id junto com cliente_chave: os do id e os sem id de mesmo nome', async () => {
    usuario('free');
    banco.poe('documents',
      doc({ id: 'pelo-id', cliente_id: C1, cliente_nome: 'Joao Silva' }),
      doc({ id: 'pelo-nome', cliente_nome: 'JOÃO SILVA' }),
      doc({ id: 'outro-cliente', cliente_id: C2, cliente_nome: 'Joao Silva' }),
      doc({ id: 'homonimo-parcial', cliente_nome: 'Joao Silva Neto' }));

    const res = await request(app).get('/documents/list')
      .query({ cliente_id: C1, cliente_chave: 'joao silva' }).set('Authorization', AUTH);

    expect(res.body.documents.map((d: { id: string }) => d.id).sort()).toEqual(['pelo-id', 'pelo-nome']);
  });

  it('link publico só em proposta; sem número curto cai no UUID; contrato sem arquivo fica processando', async () => {
    usuario('free');
    banco.poe('documents',
      doc({ id: 'prop', tipo: 'propostaSolar', codigo_curto: '20260001' }),
      doc({ id: 'prop-sem-numero', tipo: 'propostaSolar', codigo_curto: null }),
      doc({ id: 'contrato', tipo: 'contratoSolar' }),
      doc({ id: 'contrato-arquivado', tipo: 'contratoSolar', arquivo_url: 'user-123/c.html' }));

    const res = await request(app).get('/documents/list').set('Authorization', AUTH);
    const por = (id: string) => res.body.documents.find((d: { id: string }) => d.id === id);

    expect(por('prop').link_publico).toBe('/p/empresa.20260001');
    expect(por('prop-sem-numero').link_publico).toBe('/p/prop-sem-numero');
    expect(por('contrato').link_publico).toBeNull();
    expect(por('contrato').pdf_disponivel).toBe(false);
    expect(por('contrato-arquivado').pdf_disponivel).toBe(true);
    expect(por('contrato-arquivado').signed_url).toContain('user-123/c.html');
    expect(por('prop').pdf_disponivel).toBe(true);
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app).get('/documents/list');
    expect(res.status).toBe(401);
  });
});

// ─── GET /documents/resumo ───────────────────────────────────────────
describe('GET /documents/resumo', () => {
  it('conta o mês e junta o documento sem id na pasta do cliente cadastrado de mesmo nome', async () => {
    usuario('free');
    banco.poe('clients', { id: C1, user_id: 'user-123', nome: 'João da Silva' });
    banco.poe('documents',
      doc({ tipo: 'propostaSolar', cliente_id: C1, cliente_nome: 'João da Silva', created_at: new Date().toISOString() }),
      doc({ tipo: 'contratoSolar', cliente_nome: 'JOAO DA SILVA', created_at: new Date().toISOString() }),
      doc({ tipo: 'procuracao', cliente_nome: 'Maria Souza', created_at: diasAtras(90) }));

    const res = await request(app).get('/documents/resumo').set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.indicadores).toMatchObject({
      documentos_mes: 2, propostas_mes: 1, contratos_procuracoes_mes: 1, clientes_com_documento: 2, total: 3,
    });
    const joao = res.body.pastas.find((p: { cliente_id: string | null }) => p.cliente_id === C1);
    expect(joao).toMatchObject({ nome: 'João da Silva', total: 2 });
    expect(joao.tipos).toEqual({ propostaSolar: 1, contratoSolar: 1 });
    const maria = res.body.pastas.find((p: { nome: string }) => p.nome === 'Maria Souza');
    expect(maria).toMatchObject({ cliente_id: null, total: 1 });
  });

  it('um usuário com 250 documentos vê 250 (a lista é paginada, a contagem não)', async () => {
    usuario('pro');
    for (let i = 0; i < 250; i++) {
      banco.poe('documents', doc({ tipo: i % 5 === 0 ? 'contratoSolar' : 'propostaSolar', created_at: i < 100 ? '2026-09-15T12:00:00.000Z' : '2026-10-15T12:00:00.000Z' }));
    }

    const lista = await request(app).get('/documents/list').set('Authorization', AUTH);
    const res = await request(app).get('/documents/resumo').set('Authorization', AUTH);

    expect(lista.body.documents).toHaveLength(50); // a lista só traz a página
    expect(res.body.indicadores.total).toBe(250);
    expect(res.body.por_mes).toEqual({ '2026-09': 100, '2026-10': 150 });
    expect(res.body.por_tipo).toEqual({ contratoSolar: 50, propostaSolar: 200 });
  });

  it('passa de 1000 documentos: lê todas as páginas do banco, sem perder nem repetir', async () => {
    usuario('ilimitado');
    for (let i = 0; i < 1200; i++) banco.poe('documents', doc({ created_at: '2026-10-15T12:00:00.000Z' }));

    const res = await request(app).get('/documents/resumo').set('Authorization', AUTH);

    expect(res.body.indicadores.total).toBe(1200);
    expect(Object.values(res.body.por_mes)).toEqual([1200]);
  });

  it('retorna 401 sem token', async () => {
    expect((await request(app).get('/documents/resumo')).status).toBe(401);
  });
});

// ─── POST /documents/save ────────────────────────────────────────────
describe('POST /documents/save', () => {
  const corpo = { tipo: 'contratoSolar', cliente_nome: 'Fulano', content: '<html>x</html>' };

  it('gasta cota como o generate: soma 1 no uso', async () => {
    usuario('pro', { documentos_usados: 3, limite_documentos: 5 });

    const res = await request(app).post('/documents/save').set('Authorization', AUTH).send(corpo);

    expect(res.status).toBe(201);
    expect(banco.linhas('users')[0]!.documentos_usados).toBe(4);
    expect(banco.linhas('documents')).toHaveLength(1);
  });

  it('no limite: 403 LIMIT_REACHED e nada é gravado', async () => {
    usuario('pro', { documentos_usados: 5, limite_documentos: 5 });

    const res = await request(app).post('/documents/save').set('Authorization', AUTH).send(corpo);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('LIMIT_REACHED');
    expect(banco.linhas('documents')).toHaveLength(0);
  });

  it('ilimitado salva sem limite', async () => {
    usuario('ilimitado', { documentos_usados: 900, limite_documentos: 5 });
    expect((await request(app).post('/documents/save').set('Authorization', AUTH).send(corpo)).status).toBe(201);
  });
});

// ─── GET /documents/por-cliente ──────────────────────────────────────
describe('GET /documents/por-cliente', () => {
  function semear() {
    usuario('free');
    banco.poe('clients', { id: C1, user_id: 'user-123', nome: 'João da Silva' });
    banco.poe('documents',
      doc({ id: 'd-id', cliente_id: C1 }),
      doc({ id: 'd-nome', cliente_nome: 'JOAO DA SILVA' }),
      doc({ id: 'd-outro', cliente_nome: 'Maria' }));
    banco.poe('vistorias',
      { id: 'v-id', user_id: 'user-123', cliente_id: C1, cliente_nome: 'João da Silva', status: 'concluida', created_at: diasAtras(5) },
      { id: 'v-nome', user_id: 'user-123', cliente_id: null, cliente_nome: 'joao  da silva', status: 'em_andamento', created_at: diasAtras(3) },
      { id: 'v-outro', user_id: 'user-123', cliente_id: null, cliente_nome: 'Maria', status: 'concluida', created_at: diasAtras(2) });
    banco.poe('manutencoes',
      { id: 'm-id', user_id: 'user-123', cliente_id: C1, cliente_nome: 'João da Silva', codigo: 'MP20260001', status: 'concluida', created_at: diasAtras(9) });
  }

  it('junta documentos, vistorias e manutenções pelo id e pelo nome', async () => {
    semear();

    const res = await request(app).get('/documents/por-cliente').query({ cliente_id: C1 }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.documentos.map((d: { id: string }) => d.id).sort()).toEqual(['d-id', 'd-nome']);
    expect(res.body.vistorias.map((v: { id: string }) => v.id)).toEqual(['v-nome', 'v-id']);
    expect(res.body.manutencoes.map((m: { id: string }) => m.id)).toEqual(['m-id']);
  });

  it('tolera a tabela de manutenções ainda não existir', async () => {
    semear();
    banco.falhas['manutencoes.select'] = { erro: { code: 'PGRST205', message: 'Could not find the table' } };

    const res = await request(app).get('/documents/por-cliente').query({ cliente_id: C1 }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.manutencoes).toEqual([]);
    expect(res.body.documentos).toHaveLength(2);
  });

  it('pasta só de nome (sem cliente_id) funciona pela chave', async () => {
    semear();

    const res = await request(app).get('/documents/por-cliente').query({ cliente_chave: 'maria' }).set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.documentos.map((d: { id: string }) => d.id)).toEqual(['d-outro']);
    expect(res.body.vistorias.map((v: { id: string }) => v.id)).toEqual(['v-outro']);
  });

  it('cliente de outro usuário é 404 e sem parâmetro é 400', async () => {
    semear();
    banco.poe('clients', { id: C2, user_id: 'user-999', nome: 'Alheio' });

    expect((await request(app).get('/documents/por-cliente').query({ cliente_id: C2 }).set('Authorization', AUTH)).status).toBe(404);
    expect((await request(app).get('/documents/por-cliente').set('Authorization', AUTH)).status).toBe(400);
  });
});

// ─── POST /documents/:id/regenerate ──────────────────────────────────
describe('POST /documents/:id/regenerate', () => {
  function semearDoc(over: Record<string, unknown> = {}) {
    banco.poe('documents', doc({
      id: 'doc-edit', tipo: 'contratoSolar', cliente_id: C1, cliente_nome: 'João da Silva',
      codigo_curto: '20260007', dados_json: { valor_total: '20000' }, created_at: '2026-10-01T12:00:00.000Z', ...over,
    }));
    banco.poe('clients', { id: C1, user_id: 'user-123', nome: 'João da Silva' });
  }
  const post = (body: Record<string, unknown> = {}) =>
    request(app).post('/documents/doc-edit/regenerate').set('Authorization', AUTH)
      .send({ fields: { valor_total: '22000' }, useTemplate: true, modeloNumero: 2, ...body });

  it('mantém id, número e data, e NÃO gasta cota (plano com limite, no limite)', async () => {
    usuario('pro', { documentos_usados: 5, limite_documentos: 5 }); // cota esgotada: gerar novo daria 403
    semearDoc();

    const res = await post();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ doc_id: 'doc-edit', codigo_curto: '20260007' });
    const linha = banco.linhas('documents').find((d) => d.id === 'doc-edit')!;
    expect(linha.id).toBe('doc-edit');
    expect(linha.codigo_curto).toBe('20260007');
    expect(linha.created_at).toBe('2026-10-01T12:00:00.000Z');
    expect(linha.dados_json).toEqual({ valor_total: '22000' });
    expect(banco.linhas('users')[0]!.documentos_usados).toBe(5);
    // Nenhuma escrita em users, e a única em documents é um update sem id/codigo/data.
    expect(banco.escritas.filter((e) => e.tabela === 'users')).toHaveLength(0);
    const upd = banco.escritas.filter((e) => e.tabela === 'documents');
    expect(upd).toHaveLength(1);
    expect(upd[0]!.op).toBe('update');
    for (const k of ['id', 'codigo_curto', 'created_at']) expect(upd[0]!.payload).not.toHaveProperty(k);
  });

  it('plano com limite não troca o cliente_id: 409 cliente_diferente e nada é gravado', async () => {
    usuario('pro');
    semearDoc();
    banco.poe('clients', { id: C2, user_id: 'user-123', nome: 'Outra Pessoa' });

    const res = await post({ cliente_id: C2 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'cliente_diferente', message: 'Para outro cliente, gere um documento novo.' });
    expect(banco.escritas.filter((e) => e.tabela === 'documents')).toHaveLength(0);
  });

  it('plano com limite não troca o nome do avulso: 409; só acento, maiúscula e espaço passam', async () => {
    usuario('free');
    semearDoc({ tipo: 'propostaSolar', cliente_id: null, cliente_nome: 'João Silva' });

    const outro = await post({ cliente_nome_avulso: 'Maria Souza' });
    expect(outro.status).toBe(409);
    expect(outro.body.error).toBe('cliente_diferente');

    const mesmo = await post({ cliente_nome_avulso: '  JOAO   silva ' });
    expect(mesmo.status).toBe(200);
  });

  it('ilimitado troca o cliente: o documento passa a ser do novo cliente', async () => {
    usuario('ilimitado');
    semearDoc();
    banco.poe('clients', { id: C2, user_id: 'user-123', nome: 'Outra Pessoa' });

    const res = await post({ cliente_id: C2 });

    expect(res.status).toBe(200);
    const linha = banco.linhas('documents').find((d) => d.id === 'doc-edit')!;
    expect(linha.cliente_id).toBe(C2);
    expect(linha.cliente_nome).toBe('Outra Pessoa');
  });

  it('admin também troca o cliente', async () => {
    usuario('free', { is_admin: true });
    semearDoc({ tipo: 'propostaSolar', cliente_id: null, cliente_nome: 'João Silva' });

    const res = await post({ cliente_nome_avulso: 'Maria Souza' });

    expect(res.status).toBe(200);
    expect(banco.linhas('documents').find((d) => d.id === 'doc-edit')!.cliente_nome).toBe('Maria Souza');
  });

  it('o nome que o formulário carrega em fields não contorna a trava', async () => {
    usuario('pro');
    semearDoc();

    await post({ fields: { valor_total: '22000', cliente_nome: 'Outro Nome Qualquer' } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields.cliente_nome).toBe('João da Silva');
  });

  it('prestacaoServico (plano com limite) reedita no mesmo registro com o cliente final SALVO', async () => {
    usuario('pro');
    banco.poe('terceiros', { id: T1, user_id: 'user-123', nome: 'Montadora Sol' });
    // O cadastro mudou depois da emissão (endereço e padrão novos): em plano com limite não entra.
    banco.poe('clients', { id: C1, user_id: 'user-123', nome: 'Dona Maria', endereco: 'Rua NOVA, 99', padrao: 'Trifásico' });
    banco.poe('documents', doc({
      id: 'doc-edit', tipo: 'prestacaoServico', terceiro_id: T1, cliente_id: C1, cliente_nome: 'Montadora Sol',
      codigo_curto: null,
      dados_json: { cliente_final_nome: 'Dona Maria', cliente_final_telefone: '111', cliente_final_endereco_instalacao: 'Rua A, 10', cliente_final_padrao: 'Monofásico' },
    }));

    const res = await post({ fields: { valor_servico: '3000', telefone_cliente: '8399999', endereco_instalacao: 'Rua Y' } });

    expect(res.status).toBe(200);
    const linha = banco.linhas('documents').find((d) => d.id === 'doc-edit')!;
    expect(linha.terceiro_id).toBe(T1);
    expect(linha.cliente_id).toBe(C1);
    expect(linha.dados_json).toMatchObject({
      valor_servico: '3000', cliente_final_nome: 'Dona Maria', cliente_final_telefone: '111',
      cliente_final_endereco_instalacao: 'Rua A, 10', cliente_final_padrao: 'Monofásico',
    });
  });

  it('prestacaoServico (ilimitado) refaz a injeção com o corpo e o cadastro atual', async () => {
    usuario('ilimitado');
    banco.poe('terceiros', { id: T1, user_id: 'user-123', nome: 'Montadora Sol' });
    banco.poe('clients', { id: C1, user_id: 'user-123', nome: 'Dona Maria', endereco: 'Rua NOVA, 99', padrao: 'Trifásico' });
    banco.poe('documents', doc({
      id: 'doc-edit', tipo: 'prestacaoServico', terceiro_id: T1, cliente_id: C1, cliente_nome: 'Montadora Sol',
      dados_json: { cliente_final_nome: 'Dona Maria', cliente_final_padrao: 'Monofásico' },
    }));

    await post({ fields: { valor_servico: '3000', telefone_cliente: '8399999' } });

    const linha = banco.linhas('documents').find((d) => d.id === 'doc-edit')!;
    expect(linha.dados_json).toMatchObject({
      cliente_final_telefone: '8399999', cliente_final_endereco_instalacao: 'Rua NOVA, 99', cliente_final_padrao: 'Trifásico',
    });
  });

  it('cliente renomeado no cadastro: plano com limite recebe 409 (contrato)', async () => {
    usuario('pro');
    semearDoc();                                   // salvo como "João da Silva"
    banco.linhas('clients')[0]!.nome = 'João da Silva Júnior';

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'cliente_diferente', message: 'Este cliente mudou de nome no cadastro. Para o novo nome, gere um documento novo.' });
    expect(banco.escritas.filter((e) => e.tabela === 'documents')).toHaveLength(0);
  });

  it('cliente renomeado no cadastro: plano com limite recebe 409 (proposta com cadastro)', async () => {
    usuario('free');
    semearDoc({ tipo: 'propostaSolar' });
    banco.linhas('clients')[0]!.nome = 'Maria Souza';

    expect((await post()).status).toBe(409);
  });

  it('só acento ou caixa no cadastro não bloqueia; ilimitado reedita mesmo com o nome novo', async () => {
    usuario('pro');
    semearDoc();
    banco.linhas('clients')[0]!.nome = 'JOAO DA SILVA';
    expect((await post()).status).toBe(200);

    banco.reset(); banco.projeta = true;
    banco.poe('company', { id: 'comp-1', user_id: 'user-123', nome: 'Empresa', cnpj: '00', slug: 'empresa' });
    usuario('ilimitado');
    semearDoc();
    banco.linhas('clients')[0]!.nome = 'Outro Nome Totalmente';
    const vip = await post();
    expect(vip.status).toBe(200);
    expect(banco.linhas('documents').find((d) => d.id === 'doc-edit')!.cliente_nome).toBe('Outro Nome Totalmente');
  });

  function semearPrestacao() {
    banco.poe('terceiros', { id: T1, user_id: 'user-123', nome: 'Montadora Sol' });
    // O cliente final foi apagado do cadastro: só sobra o que está salvo no dados_json.
    banco.poe('documents', doc({
      id: 'doc-edit', tipo: 'prestacaoServico', terceiro_id: T1, cliente_id: C1, cliente_nome: 'Montadora Sol',
      dados_json: { cliente_final_nome: 'Dona Maria', cliente_final_padrao: 'Monofásico' },
    }));
  }

  it('plano com limite: cliente_final_* do corpo são ignorados, valem os salvos', async () => {
    usuario('pro');
    semearPrestacao();

    const res = await post({ fields: { cliente_final_nome: 'Outra Pessoa', cliente_final_padrao: 'Trifásico', valor_servico: '1' } });

    expect(res.status).toBe(200);
    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields).toMatchObject({ cliente_final_nome: 'Dona Maria', cliente_final_padrao: 'Monofásico' });
  });

  it('ilimitado pode mandar os seus cliente_final_*', async () => {
    usuario('ilimitado');
    semearPrestacao();

    await post({ fields: { cliente_final_nome: 'Outra Pessoa', valor_servico: '1' } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields.cliente_final_nome).toBe('Outra Pessoa');
  });

  it('proposta de banco: plano com limite imprime o CPF/CNPJ salvo, não o do formulário', async () => {
    usuario('pro');
    semearDoc({ tipo: 'propostaBanco', dados_json: { cpf_cnpj: '111.111.111-11', banco: 'X' } });

    await post({ fields: { cpf_cnpj: '999.999.999-99', banco: 'X' } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields.cpf_cnpj).toBe('111.111.111-11');
  });

  it('proposta de banco: salvo sem CPF (usava o do cadastro) continua sem CPF no formulário', async () => {
    usuario('pro');
    semearDoc({ tipo: 'propostaBanco', dados_json: { banco: 'X' } });

    await post({ fields: { cpf_cnpj: '999.999.999-99', banco: 'X' } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields).not.toHaveProperty('cpf_cnpj');
  });

  it('proposta de banco: ilimitado pode trocar o CPF/CNPJ', async () => {
    usuario('ilimitado');
    semearDoc({ tipo: 'propostaBanco', dados_json: { cpf_cnpj: '111.111.111-11' } });

    await post({ fields: { cpf_cnpj: '999.999.999-99' } });

    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields.cpf_cnpj).toBe('999.999.999-99');
  });

  it('contrato não ganha número nem data de emissão no dados_json', async () => {
    usuario('pro');
    semearDoc();

    await post();

    const fields = vi.mocked(generateFromTemplate).mock.calls[0]![3] as Record<string, unknown>;
    expect(fields).not.toHaveProperty('emitido_em');
    expect(fields).not.toHaveProperty('codigo');
  });

  it('documento de outro usuário é 404', async () => {
    usuario('pro');
    semearDoc({ user_id: 'user-999' });
    expect((await post()).status).toBe(404);
  });
});

// ─── GET /documents/:id/edit ─────────────────────────────────────────
describe('GET /documents/:id/edit', () => {
  it('devolve os ids e diz se o plano pode trocar o cliente', async () => {
    banco.poe('documents', doc({ id: 'doc-edit', cliente_id: C1, terceiro_id: T1, dados_json: { a: '1' } }));

    usuario('pro');
    const pro = await request(app).get('/documents/doc-edit/edit').set('Authorization', AUTH);
    expect(pro.body.document).toMatchObject({ cliente_id: C1, terceiro_id: T1, pode_trocar_cliente: false });

    banco.linhas('users')[0]!.plano = 'ilimitado';
    const vip = await request(app).get('/documents/doc-edit/edit').set('Authorization', AUTH);
    expect(vip.body.document.pode_trocar_cliente).toBe(true);
  });
});

// ─── Nada mais é apagado ─────────────────────────────────────────────
describe('cleanupProDocuments', () => {
  it('não apaga mais nenhum documento do plano pro, nem o arquivo', async () => {
    banco.poe('users', { id: 'user-123', plano: 'pro', is_admin: false });
    banco.poe('documents',
      doc({ id: 'velho', created_at: diasAtras(400), arquivo_url: 'user-123/velho.html' }),
      doc({ id: 'novo', created_at: diasAtras(1) }));

    await cleanupProDocuments();

    expect(banco.linhas('documents').map((d) => d.id).sort()).toEqual(['novo', 'velho']);
    expect(banco.escritas.filter((e) => e.op === 'delete')).toHaveLength(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
