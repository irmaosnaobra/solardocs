import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O motor que está no ar (comentário que vira DM) muda o MÍNIMO: a resposta PÚBLICA pula o comentário que gente já
// respondeu pela caixa do /gerador. A DM do motor segue igual. Aqui: a fila do Instagram (drainIgQueue) e a
// varredura do Facebook (varrerComentariosFacebook), com banco, Graph e envios simulados.

const h = vi.hoisted(() => {
  process.env.META_SYSTEM_USER_TOKEN = 'tk';
  process.env.IG_AUTOMACAO_ENABLED = 'true';
  return { respostaPublica: [] as string[], dms: [] as string[] };
});

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => { throw new Error('não deve ser usado'); } }, geradorComServiceKey: false }));
vi.mock('../services/agenda/manychatLeadService', () => ({ ingestManychatLead: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(), solardocViaIo: () => false }));
vi.mock('../services/io/prospeccaoConversaIg', () => ({ tratarRespostaProspeccao: vi.fn() }));
vi.mock('../services/instagram/igIa', () => ({ responderComIa: vi.fn(), conversaAtiva: vi.fn(async () => false) }));
vi.mock('../services/instagram/igClient', async () => {
  const real = await vi.importActual<any>('../services/instagram/igClient');
  return {
    ...real,
    igEnv: () => ({ enabled: true, appId: 'a', appSecret: 's', redirectUri: '', verifyToken: '' }),
    getIgConfig: vi.fn(async () => ({ access_token: 'igtk', ig_user_id: '17841400000001' })),
    sendPrivateReply: vi.fn(async (_ig: string, comentario: string) => { h.dms.push(comentario); return { message_id: 'm1' }; }),
    sendDM: vi.fn(async () => ({ message_id: 'm2' })),
    replyToComment: vi.fn(async (comentario: string) => { h.respostaPublica.push(comentario); return { id: 'r1' }; }),
  };
});

import { banco } from './redesBancoFalso';
import { drainIgQueue, chaveRespostaGenteIg } from '../services/instagram/igEngine';
import { replyToComment, sendPrivateReply } from '../services/instagram/igClient';

function fila(id: string, tipo: string, comentario: string, extra: Record<string, unknown> = {}): void {
  (banco.tabelas.ig_queue ??= []).push({
    id, tipo, automation_id: 'a1', recipient: comentario, payload: { text: 'oi', ...extra }, status: 'pending',
    needs_window: false, enviar_apos: '2000-01-01T00:00:00.000Z', criado_em: `2026-10-15T10:00:0${id.slice(-1)}.000Z`, tentativas: 0,
  });
}
const statusDe = (id: string) => banco.tabelas.ig_queue!.find(r => r.id === id)!;
const carimboDeGente = (comentario: string) => (banco.tabelas.system_state ??= []).push({
  key: chaveRespostaGenteIg(comentario), value: { por: 'diego', em: new Date().toISOString(), estado: 'enviado' }, updated_at: new Date().toISOString(),
});

beforeEach(() => { banco.reiniciar(); h.respostaPublica.length = 0; h.dms.length = 0; vi.mocked(replyToComment).mockClear(); vi.mocked(sendPrivateReply).mockClear(); });

describe('Instagram: a fila pula a resposta PÚBLICA quando gente já respondeu o comentário', () => {
  it('com o carimbo de gente: não responde em público, marca "skipped / resposta_de_gente"; sem carimbo, responde', async () => {
    fila('q1', 'public_reply', 'COMENT1');
    fila('q2', 'public_reply', 'COMENT2');
    carimboDeGente('COMENT1');
    const r = await drainIgQueue();
    expect(h.respostaPublica).toEqual(['COMENT2']);
    expect(statusDe('q1')).toMatchObject({ status: 'skipped', erro: 'resposta_de_gente' });
    expect(statusDe('q2').status).toBe('sent');
    expect(r).toMatchObject({ enviados: 1, pulados: 1 });
  });

  it('a DM do motor NÃO é calada: o private_reply sai mesmo com resposta de gente, e a pública que ele enfileira também é pulada depois', async () => {
    fila('q1', 'private_reply', 'COMENT1', { pub_ok: 'Te chamei no direct' });
    carimboDeGente('COMENT1');
    await drainIgQueue();
    expect(h.dms).toEqual(['COMENT1']);
    expect(statusDe('q1').status).toBe('sent');
    const publica = banco.tabelas.ig_queue!.find(r => r.tipo === 'public_reply')!;
    expect(publica).toBeTruthy();
    await drainIgQueue();
    expect(h.respostaPublica).toEqual([]);
    expect(banco.tabelas.ig_queue!.find(r => r.tipo === 'public_reply')).toMatchObject({ status: 'skipped', erro: 'resposta_de_gente' });
  });

  it('erro ao ler o carimbo não segura o motor: responde como antes', async () => {
    fila('q1', 'public_reply', 'COMENT1');
    carimboDeGente('COMENT1');
    banco.falha = (t, op) => (t === 'system_state' && op === 'select' ? 'XX000' : null);
    await drainIgQueue();
    expect(h.respostaPublica).toEqual(['COMENT1']);
  });

  it('o carimbo de gente fica no livro ig_sent: (conta nos 180/h) e nunca vira ig_events.ref', () => {
    expect(chaveRespostaGenteIg('ABC')).toBe('ig_sent:gente:ABC');
  });
});

// ── Facebook: a varredura ────────────────────────────────────────────────────

describe('Facebook: a varredura pula o aviso PÚBLICO do motor, e só ele', () => {
  const PAGINA = '704395102766155';
  let chamadas: Array<{ metodo: string; url: string }> = [];

  beforeEach(() => {
    chamadas = [];
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const metodo = String(init?.method || 'GET');
      chamadas.push({ metodo, url: String(url) });
      const u = String(url);
      const resp = (json: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) }) as unknown as Response;
      if (u.includes('me/accounts')) return resp({ data: [{ id: PAGINA, access_token: 'pgtk' }] });
      if (u.includes('published_posts')) return resp({ data: [{ id: 'P1' }] });
      if (u.includes('me/adaccounts')) return resp({ data: [] });
      if (u.includes('/P1/comments')) {
        return resp({ data: [{ id: 'COM1', message: 'Tenho interesse', created_time: new Date().toISOString(), from: { id: 'U1', name: 'Ana' } }] });
      }
      if (metodo === 'POST' && u.endsWith(`/${PAGINA}/messages`)) return resp({ message_id: 'm1' });
      if (metodo === 'POST' && u.endsWith('/COM1/comments')) return resp({ id: 'resp1' });
      return resp({});
    }));
    vi.doMock('../services/instagram/igEngine', () => ({
      loadAutomations: vi.fn(async () => [{ id: 'a1', link_url: '' }]),
      decidirComentario: vi.fn(() => ({ id: 'a1', produto: 'solar', link_url: '' })),
      depositarOuAvisar: vi.fn(), tratarHostil: vi.fn(), welcomePayload: vi.fn(() => ({ text: 'oi' })),
      chaveRespostaGenteIg: (id: string) => `ig_sent:gente:${id}`,
    }));
    vi.doMock('../services/instagram/igClient', () => ({ buildMessage: vi.fn(() => ({ text: 'oi' })) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('../services/instagram/igEngine'); vi.doUnmock('../services/instagram/igClient'); });

  const postsEm = (sufixo: string) => chamadas.filter(c => c.metodo === 'POST' && c.url.endsWith(sufixo)).length;

  it('sem resposta de gente: a DM e o aviso público saem, e o ig_events guarda o fb_private_reply', async () => {
    const { varrerComentariosFacebook } = await import('../services/instagram/fbComentarios');
    const r = await varrerComentariosFacebook();
    expect(r.respondidos).toBe(1);
    expect(postsEm(`/${PAGINA}/messages`)).toBe(1);
    expect(postsEm('/COM1/comments')).toBe(1);
    expect(banco.tabelas.ig_events!.filter(e => e.tipo === 'fb_private_reply' && e.ref === 'COM1')).toHaveLength(1);
  });

  it('com resposta de gente no comentário: a DM sai, o aviso público do motor NÃO', async () => {
    (banco.tabelas.system_state ??= []).push({ key: 'fb_gente:COM1', value: { por: 'nilce', estado: 'enviado' }, updated_at: new Date().toISOString() });
    const { varrerComentariosFacebook } = await import('../services/instagram/fbComentarios');
    const r = await varrerComentariosFacebook();
    expect(r.respondidos).toBe(1);
    expect(postsEm(`/${PAGINA}/messages`)).toBe(1);
    expect(postsEm('/COM1/comments')).toBe(0);
  });

  it('banco sem a tabela do carimbo ou com erro de leitura: o motor segue como antes (responde em público)', async () => {
    (banco.tabelas.system_state ??= []).push({ key: 'fb_gente:COM1', value: {}, updated_at: new Date().toISOString() });
    banco.falha = (t, op) => (t === 'system_state' && op === 'select' ? 'XX000' : null);
    const { varrerComentariosFacebook } = await import('../services/instagram/fbComentarios');
    await varrerComentariosFacebook();
    expect(postsEm('/COM1/comments')).toBe(1);
  });
});
