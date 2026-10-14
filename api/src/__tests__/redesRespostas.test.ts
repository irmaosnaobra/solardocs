import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Resposta de gente a comentário (redes, fase 1): carimbo por comentário, livro somando o motor, 20 s entre
// respostas, mesmo autor e texto igual até 3 por hora, 300 por dia, parada compartilhada e FB que diz
// "não saiu" quando a Meta recusa. Banco, Instagram e Facebook são dublês.

const h = vi.hoisted(() => ({
  ig: null as null | ((id: string, texto: string, token: string) => Promise<any>),
  fb: null as null | ((id: string, texto: string) => Promise<any>),
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));
vi.mock('../services/instagram/igClient', () => ({
  getIgConfig: vi.fn(async () => ({ access_token: 'igtk', ig_user_id: '17841400000001' })),
  replyToComment: vi.fn(async (id: string, texto: string, token: string) => (h.ig ? h.ig(id, texto, token) : { id: 'R-IG' })),
}));
vi.mock('../services/instagram/igEngine', () => ({ chaveRespostaGenteIg: (id: string) => `ig_sent:gente:${id}` }));
vi.mock('../services/instagram/fbComentarios', () => ({
  PAGINA_FB: '704395102766155',
  tokenDaPaginaFb: vi.fn(async () => 'pgtk'),
  chaveRespostaGenteFb: (id: string) => `fb_gente:${id}`,
  lerComentariosRecentesFb: vi.fn(async () => []),
  responderComentarioFb: vi.fn(async (id: string, texto: string) => (h.fb ? h.fb(id, texto) : { ok: true, id: 'R-FB' })),
}));

import { banco, chaves, valorDe } from './redesBancoFalso';
import { replyToComment } from '../services/instagram/igClient';
import { responderComentarioFb } from '../services/instagram/fbComentarios';
import { responderComentario, situacaoResposta, tetoPorHora, hashDoTexto } from '../services/gerador/redes/respostas';

const T0 = new Date('2026-10-15T15:00:00Z');
const seg = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

const responder = (rede: string, id: string, texto: string, agora?: Date, por = 'nilce') =>
  responderComentario({ rede, comentario_id: id, texto, por, agora });

function comentarioIg(id: string, autor = `U${id}`, texto = 'quero saber'): void {
  (banco.tabelas.ig_events ??= []).push({ id: `e${id}`, tipo: 'comment', ref: id, raw: { id, text: texto, from: { id: autor, username: `u${id}` } }, criado_em: new Date().toISOString() });
}
function cacheFb(itens: Array<{ id: string; autor_id: string | null }>): void {
  banco.tabelas.system_state = (banco.tabelas.system_state ?? []).filter(l => l.key !== 'redes_cx_cache:facebook');
  banco.tabelas.system_state.push({
    key: 'redes_cx_cache:facebook', updated_at: new Date().toISOString(),
    value: { em: new Date().toISOString(), itens: itens.map(i => ({ ...i, texto: 'oi', autor_nome: 'x', post_id: 'P', criado_em: null })) },
  });
}
/** Os comentários do Facebook que a caixa já leu (a resposta só vale para comentário da caixa). */
const semearFb = (): void => cacheFb(['C12345', 'F12345'].map(id => ({ id, autor_id: `U${id}` })));
const linhasSent = (n: number, minutosAtras = 5) => {
  const t = new Date(Date.now() - minutosAtras * 60_000).toISOString();
  (banco.tabelas.system_state ??= []).push(...Array.from({ length: n }, (_, i) => ({ key: `ig_sent:motor${i}`, value: '1', updated_at: t })));
};

beforeEach(() => {
  banco.reiniciar(); h.ig = null; h.fb = null; semearFb();
  vi.mocked(replyToComment).mockClear(); vi.mocked(responderComentarioFb).mockClear();
  process.env.REDES_RESPOSTA_IG_LIGADA = '1';
  process.env.REDES_RESPOSTA_FB_LIGADA = '1';
  process.env.META_SYSTEM_USER_TOKEN = 'tk';
  delete process.env.IG_MAX_POR_HORA;
});
afterEach(() => { for (const k of ['REDES_RESPOSTA_IG_LIGADA', 'REDES_RESPOSTA_FB_LIGADA', 'META_SYSTEM_USER_TOKEN', 'IG_MAX_POR_HORA']) delete process.env[k]; });

describe('resposta de gente: chave e entrada', () => {
  it('sem a env da rede nada sai; cada rede tem a sua', async () => {
    delete process.env.REDES_RESPOSTA_IG_LIGADA;
    expect(await responder('instagram', 'C12345', 'oi')).toMatchObject({ ok: false, http: 403, motivo: 'chave_desligada' });
    expect(replyToComment).not.toHaveBeenCalled();
    expect((await responder('facebook', 'C12345', 'oi')).ok).toBe(true);
  });

  it('um comentário e um texto: lista, número, vazio e texto longo viram 400 sem tocar na rede', async () => {
    for (const p of [
      { rede: ['instagram'], comentario_id: 'C12345', texto: 'oi' },
      { rede: 'instagram', comentario_id: ['C12345', 'C67890'], texto: 'oi' },
      { rede: 'instagram', comentario_id: 'C12345', texto: ['oi', 'ola'] },
      { rede: 'instagram', comentario_id: 'C12345', texto: 5 },
      { rede: 'instagram', comentario_id: 'C12345', texto: '   ' },
      { rede: 'instagram', comentario_id: 'C12345', texto: 'x'.repeat(1001) },
      { rede: 'instagram', comentario_id: '../../x', texto: 'oi' },
    ]) {
      expect((await responderComentario({ ...p, por: 'nilce' } as any)).http).toBe(400);
    }
    expect(replyToComment).not.toHaveBeenCalled();
    expect(chaves(banco, 'ig_sent:')).toEqual([]);
  });
});

describe('resposta de gente: carimbo, livro e ritmo', () => {
  it('Instagram: usa o replyToComment como está, grava o carimbo no livro ig_sent: (quem clicou) e NÃO cria ig_events.ref', async () => {
    comentarioIg('C12345');
    const r = await responder('instagram', 'C12345', 'Obrigado pelo carinho!', T0);
    expect(r).toMatchObject({ ok: true, http: 200, motivo: 'enviada', resposta_id: 'R-IG' });
    expect(vi.mocked(replyToComment).mock.calls[0]).toEqual(['C12345', 'Obrigado pelo carinho!', 'igtk']);
    expect(valorDe(banco, 'ig_sent:gente:C12345')).toMatchObject({ por: 'nilce', estado: 'enviado', resposta_id: 'R-IG', autor: 'UC12345' });
    expect((banco.tabelas.ig_events ?? []).filter(e => e.tipo !== 'comment')).toEqual([]);
  });

  it('o 2º clique no mesmo comentário recusa e a contagem do livro fica igual', async () => {
    comentarioIg('C12345');
    expect((await responder('instagram', 'C12345', 'um', T0)).ok).toBe(true);
    const antes = chaves(banco, 'ig_sent:').length;
    expect(await responder('instagram', 'C12345', 'dois', seg(T0, 60))).toMatchObject({ ok: false, http: 409, motivo: 'ja_respondido' });
    expect(chaves(banco, 'ig_sent:').length).toBe(antes);
    expect(replyToComment).toHaveBeenCalledTimes(1);
  });

  it('dois cliques no mesmo comentário juntos: só um responde (o insert é o claim)', async () => {
    comentarioIg('C12345');
    const [a, b] = await Promise.all([responder('instagram', 'C12345', 'um', T0), responder('instagram', 'C12345', 'dois', T0)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(replyToComment).toHaveBeenCalledTimes(1);
  });

  it('20 s entre respostas de gente: a 2ª, 5 s depois, recusa e desfaz o claim; 21 s depois passa', async () => {
    comentarioIg('C11111'); comentarioIg('C22222');
    expect((await responder('instagram', 'C11111', 'a', T0)).ok).toBe(true);
    const cedo = await responder('instagram', 'C22222', 'b', seg(T0, 5));
    expect(cedo).toMatchObject({ ok: false, motivo: 'espacamento' });
    expect(cedo.abre_em).toBe(seg(T0, 20).toISOString());
    expect(chaves(banco, 'ig_sent:gente:')).toEqual(['ig_sent:gente:C11111']);
    expect((await responder('instagram', 'C22222', 'b', seg(T0, 21))).ok).toBe(true);
  });

  it('livro da hora SOMANDO o motor: 179 do motor + 1 de gente passa; com 180 recusa; a env só baixa o teto', async () => {
    comentarioIg('C12345');
    linhasSent(179);
    expect((await responder('instagram', 'C12345', 'oi')).ok).toBe(true);
    banco.reiniciar(); process.env.REDES_RESPOSTA_IG_LIGADA = '1';
    comentarioIg('C12345'); linhasSent(180);
    expect(await responder('instagram', 'C12345', 'oi')).toMatchObject({ ok: false, http: 429, motivo: 'teto_hora' });
    expect(replyToComment).toHaveBeenCalledTimes(1);
    process.env.IG_MAX_POR_HORA = '999';
    expect(tetoPorHora('instagram')).toBe(180);
    process.env.IG_MAX_POR_HORA = '10';
    expect(tetoPorHora('instagram')).toBe(10);
    banco.reiniciar(); process.env.REDES_RESPOSTA_IG_LIGADA = '1';
    comentarioIg('C12345'); linhasSent(10);
    expect((await responder('instagram', 'C12345', 'oi')).motivo).toBe('teto_hora');
  });

  it('mesmo autor: 3 por hora, a 4ª recusa (autor lido do ig_events, nunca do navegador)', async () => {
    for (const id of ['C10001', 'C10002', 'C10003', 'C10004']) comentarioIg(id, 'MESMA-PESSOA');
    for (let i = 0; i < 3; i++) expect((await responder('instagram', `C1000${i + 1}`, `resposta ${i}`, seg(T0, i * 25))).ok).toBe(true);
    expect(await responder('instagram', 'C10004', 'resposta 3', seg(T0, 80))).toMatchObject({ ok: false, motivo: 'mesmo_autor' });
    expect(replyToComment).toHaveBeenCalledTimes(3);
    // Outra pessoa não é afetada.
    comentarioIg('C10005', 'OUTRA');
    expect((await responder('instagram', 'C10005', 'resposta 5', seg(T0, 110))).ok).toBe(true);
  });

  it('texto igual: 3 por hora na conta, mesmo de autores diferentes; maiúscula e espaço não enganam', async () => {
    for (const id of ['C20001', 'C20002', 'C20003', 'C20004']) comentarioIg(id);
    const textos = ['Valeu!', 'valeu!', '  VALEU!  '];
    for (let i = 0; i < 3; i++) expect((await responder('instagram', `C2000${i + 1}`, textos[i]!, seg(T0, i * 25))).ok).toBe(true);
    expect(await responder('instagram', 'C20004', 'valeu!', seg(T0, 80))).toMatchObject({ ok: false, motivo: 'mesmo_texto' });
    expect(hashDoTexto('Valeu!')).toBe(hashDoTexto('  VALEU! '));
  });

  it('300 de gente em 24 h: o 301º recusa', async () => {
    comentarioIg('C12345');
    const t = new Date(Date.now() - 5 * 3600_000).toISOString();
    (banco.tabelas.system_state ??= []).push(...Array.from({ length: 300 }, (_, i) => ({ key: `ig_sent:gente:velho${i}`, value: { autor: `A${i}`, texto_hash: `h${i}` }, updated_at: t })));
    expect(await responder('instagram', 'C12345', 'oi')).toMatchObject({ ok: false, http: 429, motivo: 'teto_dia' });
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it('erro de leitura do livro fecha: nada é enviado', async () => {
    banco.falha = (t, op) => (t === 'system_state' && op === 'select' ? 'XX000' : null);
    const r = await responder('instagram', 'C12345', 'oi');
    expect(r).toMatchObject({ ok: false, motivo: 'erro_livro' });
    expect(replyToComment).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('SECRETO');
  });
});

describe('resposta de gente: só comentário que a caixa leu', () => {
  it('id que não está entre os comentários lidos (id de post, por exemplo) recusa sem tocar na rede e sem carimbar', async () => {
    comentarioIg('C12345');
    const ig = await responder('instagram', 'POSTMEDIA123', 'oi', T0);
    expect(ig).toMatchObject({ ok: false, http: 404, motivo: 'comentario_desconhecido' });
    const fb = await responder('facebook', 'F99999_POST', 'oi', T0);
    expect(fb).toMatchObject({ ok: false, http: 404, motivo: 'comentario_desconhecido' });
    expect(replyToComment).not.toHaveBeenCalled();
    expect(responderComentarioFb).not.toHaveBeenCalled();
    expect(chaves(banco, 'ig_sent:gente:')).toEqual([]);
    expect(chaves(banco, 'fb_gente:')).toEqual([]);
    expect(chaves(banco, 'redes_resp_ultima')).toEqual([]);
    // O comentário que a caixa leu segue valendo.
    expect((await responder('instagram', 'C12345', 'oi', seg(T0, 1))).ok).toBe(true);
  });
});

describe('resposta de gente: o que a rede responde', () => {
  it('Facebook com r.ok falso diz "não saiu", NÃO carimba e libera a faixa de 20 s', async () => {
    h.fb = async () => ({ ok: false, http: 400, corpo: '{"error":{"message":"Unsupported post request","code":100}}', rede: false });
    const r = await responder('facebook', 'F12345', 'oi', T0);
    expect(r).toMatchObject({ ok: false, motivo: 'nao_saiu' });
    expect(r.mensagem).toMatch(/Não saiu/);
    expect(chaves(banco, 'fb_gente:')).toEqual([]);
    expect(chaves(banco, 'redes_resp_ultima')).toEqual([]);
    h.fb = null;
    expect((await responder('facebook', 'F12345', 'oi', seg(T0, 1))).ok).toBe(true);    // nada ficou preso
    expect(valorDe(banco, 'fb_gente:F12345')).toMatchObject({ estado: 'enviado', por: 'nilce', resposta_id: 'R-FB' });
  });

  it('Facebook com 5xx ou queda de rede é "incerto": o carimbo FICA e nada se refaz', async () => {
    h.fb = async () => ({ ok: false, http: 503, corpo: 'oops', rede: false });
    const r = await responder('facebook', 'F12345', 'oi', T0);
    expect(r).toMatchObject({ ok: false, http: 202, motivo: 'incerto', incerto: true });
    expect(valorDe(banco, 'fb_gente:F12345').estado).toBe('incerto');
    h.fb = null;
    expect(await responder('facebook', 'F12345', 'oi', seg(T0, 60))).toMatchObject({ ok: false, motivo: 'ja_respondido' });
    expect(responderComentarioFb).toHaveBeenCalledTimes(1);
  });

  it('Instagram: 4xx do replyToComment é "não saiu" (carimbo volta); 5xx e queda de rede são "incerto" (carimbo fica)', async () => {
    comentarioIg('C12345'); comentarioIg('C67890');
    h.ig = async () => { throw new Error('replyToComment 400: {"error":{"message":"comentário apagado","code":100}}'); };
    expect(await responder('instagram', 'C12345', 'oi', T0)).toMatchObject({ ok: false, motivo: 'nao_saiu' });
    expect(chaves(banco, 'ig_sent:gente:')).toEqual([]);
    h.ig = async () => { throw new Error('fetch failed'); };
    expect(await responder('instagram', 'C67890', 'oi', seg(T0, 30))).toMatchObject({ ok: false, http: 202, motivo: 'incerto' });
    expect(chaves(banco, 'ig_sent:gente:')).toEqual(['ig_sent:gente:C67890']);
  });

  it('autor desconhecido (a Meta não devolveu quem comentou): responde, avisa, e o limite por autor não se aplica', async () => {
    cacheFb([{ id: 'F12345', autor_id: null }]);
    const r = await responder('facebook', 'F12345', 'oi', T0);
    expect(r).toMatchObject({ ok: true, autor_desconhecido: true });
    expect(valorDe(banco, 'fb_gente:F12345').autor).toBeNull();
  });

  it('Facebook: 60/h somando o motor (cada resposta privada do motor vale 2); 29 do motor deixam passar, 30 não', async () => {
    const t = new Date(Date.now() - 10 * 60_000).toISOString();
    const motor = (n: number) => { banco.tabelas.ig_events = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, tipo: 'fb_private_reply', ref: `X${i}`, raw: {}, criado_em: t })); };
    motor(29);
    expect((await responder('facebook', 'F12345', 'oi')).ok).toBe(true);     // 58 + 1 = 59 < 60
    banco.reiniciar(); semearFb(); process.env.REDES_RESPOSTA_FB_LIGADA = '1'; process.env.META_SYSTEM_USER_TOKEN = 'tk';
    motor(30);
    expect(await responder('facebook', 'F12345', 'oi')).toMatchObject({ ok: false, motivo: 'teto_hora' });
  });
});

describe('resposta de gente: a parada é uma só para publicar e responder', () => {
  it('parada gravada pelo publicador bloqueia a resposta sem chamar a rede', async () => {
    (banco.tabelas.system_state ??= []).push({ key: 'redes_parada:instagram', value: { ate: seg(T0, 600).toISOString(), codigo: 613 }, updated_at: T0.toISOString() });
    comentarioIg('C12345');
    expect(await responder('instagram', 'C12345', 'oi', T0)).toMatchObject({ ok: false, http: 429, motivo: 'parada' });
    expect(replyToComment).not.toHaveBeenCalled();
    // Outra rede não é afetada.
    expect((await responder('facebook', 'F12345', 'oi', T0)).ok).toBe(true);
  });

  it('erro 613 na resposta grava a MESMA parada que o publicador lê', async () => {
    comentarioIg('C12345');
    h.ig = async () => { throw new Error('replyToComment 400: {"error":{"message":"limite","code":613}}'); };
    await responder('instagram', 'C12345', 'oi', T0);
    expect(valorDe(banco, 'redes_parada:instagram')).toMatchObject({ codigo: 613 });
    const { paradaVigente } = await import('../services/gerador/redes/comum');
    expect(await paradaVigente('instagram', seg(T0, 60).getTime())).toMatchObject({ motivo: 'parada_meta_613' });
    expect(await paradaVigente('instagram', seg(T0, 16 * 60).getTime())).toBeNull();
  });
});

describe('resposta de gente: limites para a tela', () => {
  it('conta a hora (somando o motor) e o dia, e diz quando o espaço de 20 s abre', async () => {
    comentarioIg('C12345');
    linhasSent(4);
    const antes = await situacaoResposta('instagram');
    expect(antes).toMatchObject({ ligado: true, pode: true, hora: { usadas: 4, teto: 180 }, dia: { usadas: 0, teto: 300 } });
    expect((await responder('instagram', 'C12345', 'oi', new Date())).ok).toBe(true);
    const depois = await situacaoResposta('instagram');
    expect(depois).toMatchObject({ pode: false, motivo: 'espacamento', hora: { usadas: 5 }, dia: { usadas: 1 } });
    delete process.env.REDES_RESPOSTA_IG_LIGADA;
    expect(await situacaoResposta('instagram')).toMatchObject({ ligado: false, pode: false });
  });
});
