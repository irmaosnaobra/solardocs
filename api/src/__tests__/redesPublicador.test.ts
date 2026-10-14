import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Publicador de Reels (redes, fase 1): claim por (rede, conta, hash), cota lida antes, paradas por código,
// leitura do contêiner no máximo 1 vez por minuto, falha honesta depois de 5 min e nada se refaz sozinho.
// A Meta, o banco e o Storage são dublês: nenhuma chamada real.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));
const tk = vi.hoisted(() => ({ pendurar: false }));
vi.mock('../services/instagram/fbComentarios', () => ({
  PAGINA_FB: '704395102766155',
  tokenDaPaginaFb: vi.fn(() => (tk.pendurar ? new Promise<string>(() => undefined) : Promise.resolve('pgtk'))),
}));

import { banco, chaves, valorDe } from './redesBancoFalso';
import {
  publicarReel, avancarPublicacao, avancarPendentes, listarPublicacoes, situacaoReels, limparCachePublicador, idValido, limitesPublicador,
} from '../services/gerador/redes/publicador';

const BASE = 'https://x.supabase.co/storage/v1/object/public/redes-videos/2026/10/';
const video = (n: string) => `${BASE}${n}.mp4`;
const T0 = new Date('2026-10-15T15:00:00Z');
const mais = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const IG = '17841400000001';
const PAGINA = '704395102766155';

interface Chamada { metodo: string; url: string; corpo: any; cab: Record<string, string> }
let chamadas: Chamada[] = [];
type Regra = (c: Chamada) => { status: number; json: any } | null;
let regras: Regra[] = [];

const ok = (json: any) => ({ status: 200, json });
const erro = (status: number, code: number, sub?: number) => ({ status, json: { error: { message: 'x', code, error_subcode: sub } } });

function rotasPadrao(): Regra[] {
  return [
    c => (c.metodo === 'HEAD' ? ok({}) : null),
    c => (c.url.includes(`/${PAGINA}?fields=instagram_business_account`) ? ok({ instagram_business_account: { id: IG } }) : null),
    c => (c.url.includes('/content_publishing_limit') ? ok({ data: [{ quota_usage: 3, config: { quota_total: 50 } }] }) : null),
    c => (c.metodo === 'POST' && c.url.endsWith(`/${IG}/media`) ? ok({ id: 'CONT1' }) : null),
    c => (c.metodo === 'POST' && c.url.endsWith(`/${IG}/media_publish`) ? ok({ id: 'MEDIA1' }) : null),
    c => (c.url.includes('/CONT1?fields=status_code') ? ok({ status_code: 'FINISHED' }) : null),
    c => (c.metodo === 'POST' && c.url.endsWith(`/${PAGINA}/video_reels`) && c.corpo?.upload_phase === 'start'
      ? ok({ video_id: 'VID1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/VID1' }) : null),
    c => (c.metodo === 'POST' && c.url.startsWith('https://rupload.facebook.com/') ? ok({ success: true }) : null),
    c => (c.metodo === 'POST' && c.url.endsWith(`/${PAGINA}/video_reels`) && c.corpo?.upload_phase === 'finish' ? ok({ success: true }) : null),
    c => (c.url.includes('/VID1?fields=status') ? ok({ status: { video_status: 'ready', publishing_phase: { status: 'complete' } } }) : null),
  ];
}

const fetchMock = vi.fn(async (url: string, init?: any) => {
  const metodo = String(init?.method || 'GET').toUpperCase();
  let corpo: any = null;
  try { corpo = init?.body ? JSON.parse(init.body) : null; } catch { corpo = null; }
  const c: Chamada = { metodo, url: String(url), corpo, cab: init?.headers ?? {} };
  chamadas.push(c);
  for (const r of regras) {
    const x = r(c);
    if (x) {
      if (x.status === -1) return new Promise<Response>(() => undefined);   // chamada que nunca volta
      if (c.metodo === 'HEAD') {
        return { ok: true, status: 200, headers: new Headers({ 'content-length': '20000000', 'content-type': 'video/mp4', etag: `"${c.url.split('/').pop()}"` }) } as unknown as Response;
      }
      return { ok: x.status < 400, status: x.status, text: async () => JSON.stringify(x.json) } as unknown as Response;
    }
  }
  return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'sem rota no teste', code: 100 } }) } as unknown as Response;
});

const escritas = (): string[] => chamadas.filter(c => c.metodo === 'POST').map(c => c.url.replace('https://graph.facebook.com/v21.0', ''));
const pub = (rede: 'instagram' | 'facebook', nome: string, agora = T0, extra: Record<string, unknown> = {}) =>
  publicarReel({ rede, video_url: video(nome), legenda: 'Reel de teste', por: 'giovanna', agora, ...extra });

beforeEach(() => {
  banco.reiniciar(); limparCachePublicador();
  chamadas = []; regras = [...rotasPadrao()];
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.META_SYSTEM_USER_TOKEN = 'tk';
  process.env.REDES_REELS_IG_LIGADO = '1';
  process.env.REDES_REELS_FB_LIGADO = '1';
  delete process.env.REDES_IG_USER_ID;
  tk.pendurar = false; limitesPublicador.tokenMs = 10_000; limitesPublicador.cronMs = 20_000;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['META_SYSTEM_USER_TOKEN', 'REDES_REELS_IG_LIGADO', 'REDES_REELS_FB_LIGADO']) delete process.env[k];
});

describe('Reels: chave, entrada e claim', () => {
  it('sem a env da rede nada sai (cada rede tem a sua); nenhuma chamada à Meta', async () => {
    delete process.env.REDES_REELS_IG_LIGADO;
    expect(await pub('instagram', 'a')).toMatchObject({ ok: false, http: 403, motivo: 'chave_desligada' });
    expect(chamadas).toEqual([]);
    expect((await pub('facebook', 'a')).ok).toBe(true);   // a do Facebook segue ligada
  });

  it('rede ou legenda fora do formato: 400 antes de qualquer chamada', async () => {
    expect((await publicarReel({ rede: ['instagram', 'facebook'], video_url: video('a'), legenda: '', por: 'x', agora: T0 })).http).toBe(400);
    expect((await publicarReel({ rede: 'status', video_url: video('a'), legenda: '', por: 'x', agora: T0 })).http).toBe(400);
    expect((await publicarReel({ rede: 'instagram', video_url: video('a'), legenda: 'x'.repeat(2201), por: 'x', agora: T0 })).http).toBe(400);
    expect((await publicarReel({ rede: 'instagram', video_url: video('a'), legenda: 5, por: 'x', agora: T0 })).http).toBe(400);
    expect(chamadas).toEqual([]);
  });

  it('claim: o registro (rede, conta, hash) existe ANTES da primeira escrita na Meta, e o mesmo vídeo duas vezes recusa sem chamar a Meta', async () => {
    let registroNaEscrita: string[] = [];
    regras.unshift(c => {
      if (c.metodo === 'POST' && c.url.endsWith(`/${IG}/media`)) registroNaEscrita = chaves(banco, 'redes_pub:');
      return null;
    });
    const r = await pub('instagram', 'a');
    expect(r).toMatchObject({ ok: true, http: 202, motivo: 'aguardando' });
    expect(registroNaEscrita).toHaveLength(1);
    expect(registroNaEscrita[0]).toMatch(new RegExp(`^redes_pub:instagram\\.${IG}\\.[0-9a-f]{16}$`));
    chamadas = [];
    const dup = await pub('instagram', 'a', mais(T0, 45));
    expect(dup).toMatchObject({ ok: false, http: 409, motivo: 'mesmo_video' });
    expect(escritas()).toEqual([]);
    expect(chaves(banco, 'redes_pub:')).toHaveLength(1);
  });

  it('dois cliques no mesmo vídeo no mesmo instante: um só chega à Meta', async () => {
    const [x, y] = await Promise.all([pub('instagram', 'a'), pub('instagram', 'a')]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(escritas().filter(u => u.endsWith('/media'))).toHaveLength(1);
  });

  it('30 minutos entre publicações da conta; a outra rede não é afetada; vídeo de fora ou grande recusa', async () => {
    expect((await pub('instagram', 'a')).ok).toBe(true);
    const cedo = await pub('instagram', 'b', mais(T0, 10));
    expect(cedo).toMatchObject({ ok: false, motivo: 'espacamento' });
    expect(cedo.abre_em).toBe(mais(T0, 30).toISOString());
    expect(chaves(banco, 'redes_pub:')).toHaveLength(1);
    expect((await pub('facebook', 'b', mais(T0, 10))).ok).toBe(true);
    expect((await pub('instagram', 'c', mais(T0, 31))).ok).toBe(true);
    expect((await publicarReel({ rede: 'instagram', video_url: 'https://outro.com/v.mp4', legenda: '', por: 'x', agora: mais(T0, 90) })).motivo).toBe('video_de_fora');
  });

  it('sem a conta do Instagram na Página: 502 e nada é escrito', async () => {
    regras.unshift(c => (c.url.includes('fields=instagram_business_account') ? ok({}) : null));
    expect(await pub('instagram', 'a')).toMatchObject({ ok: false, http: 502, motivo: 'conta_indisponivel' });
    expect(escritas()).toEqual([]);
    expect(chaves(banco, 'redes_pub')).toEqual([]);
  });
});

describe('Reels no Instagram: cota lida antes e paradas por código', () => {
  it('a cota é lida ANTES de criar o contêiner', async () => {
    await pub('instagram', 'a');
    const iCota = chamadas.findIndex(c => c.url.includes('/content_publishing_limit'));
    const iMedia = chamadas.findIndex(c => c.metodo === 'POST' && c.url.endsWith('/media'));
    expect(iCota).toBeGreaterThan(-1);
    expect(iMedia).toBeGreaterThan(iCota);
  });

  it('leitura da cota que falha FECHA: não publica, e o vídeo pode ser tentado de novo depois', async () => {
    regras.unshift(c => (c.url.includes('/content_publishing_limit') ? erro(500, 1) : null));
    expect(await pub('instagram', 'a')).toMatchObject({ ok: false, motivo: 'cota_lida_falhou' });
    expect(escritas()).toEqual([]);
    expect(valorDe(banco, chaves(banco, 'redes_pub:')[0]!).estado).toBe('nao_saiu');
    regras.shift();
    expect((await pub('instagram', 'a', mais(T0, 31))).ok).toBe(true);   // retomada: o registro era "não saiu"
  });

  it('cota esgotada: não publica', async () => {
    regras.unshift(c => (c.url.includes('/content_publishing_limit') ? ok({ data: [{ quota_usage: 50, config: { quota_total: 50 } }] }) : null));
    expect(await pub('instagram', 'a')).toMatchObject({ ok: false, http: 429, motivo: 'cota_esgotada' });
    expect(escritas()).toEqual([]);
  });

  it.each([4, 17, 32, 368, 613])('código %i da Meta na escrita para a conta por 15 min: a próxima publicação recusa sem chamar a Meta', async (codigo) => {
    regras.unshift(c => (c.metodo === 'POST' && c.url.endsWith('/media') ? erro(400, codigo) : null));
    expect(await pub('instagram', 'a')).toMatchObject({ ok: false, motivo: 'meta_recusou' });
    expect(valorDe(banco, 'redes_parada:instagram').codigo).toBe(codigo);
    regras.shift();                                                    // a Meta volta ao normal: só a parada segura
    chamadas = [];
    const parado = await pub('instagram', 'b', mais(T0, 10));
    expect(parado).toMatchObject({ ok: false, http: 429, motivo: 'parada' });
    expect(parado.abre_em).toBe(mais(T0, 15).toISOString());
    expect(chamadas).toEqual([]);
    expect((await pub('instagram', 'b', mais(T0, 31))).ok).toBe(true); // passou a parada e a faixa de 30 min
  });

  it('código que não é de parada (ex.: 100) recusa só aquele pedido e não grava parada', async () => {
    regras.unshift(c => (c.metodo === 'POST' && c.url.endsWith('/media') ? erro(400, 100) : null));
    await pub('instagram', 'a');
    expect(chaves(banco, 'redes_parada')).toEqual([]);
  });

  it('erro de cota na escrita para a conta até o dia seguinte', async () => {
    regras.unshift(c => (c.metodo === 'POST' && c.url.endsWith('/media') ? erro(400, 9, 2207042) : null));
    await pub('instagram', 'a');
    expect(chaves(banco, 'redes_cota:')).toEqual(['redes_cota:instagram']);
    expect(valorDe(banco, 'redes_cota:instagram').ate).toBe('2026-10-16T03:00:00.000Z');
    expect((await pub('instagram', 'b', mais(T0, 40))).motivo).toBe('parada');
  });

  it('5xx ou queda de rede na escrita conta como feito: "incerto", registro mantido, nada se refaz', async () => {
    regras.unshift(c => (c.metodo === 'POST' && c.url.endsWith('/media') ? { status: 502, json: {} } : null));
    const r = await pub('instagram', 'a');
    expect(r).toMatchObject({ ok: false, http: 202, motivo: 'meta_incerto' });
    expect(valorDe(banco, chaves(banco, 'redes_pub:')[0]!).estado).toBe('incerto');
    chamadas = [];
    expect((await pub('instagram', 'a', mais(T0, 45))).motivo).toBe('mesmo_video');
    expect(escritas()).toEqual([]);
  });
});

describe('Reels no Instagram: avançar o contêiner', () => {
  async function criar(): Promise<string> {
    const r = await pub('instagram', 'a');
    return r.publicacao!.id;
  }

  it('o id tem o formato rede.conta.hash; id torto é "não encontrada"', async () => {
    const id = await criar();
    expect(idValido(id)).toBe(true);
    expect(idValido('instagram.1.zz')).toBe(false);
    expect((await avancarPublicacao('../x', T0.getTime())).http).toBe(404);
    expect((await avancarPublicacao(`instagram.${IG}.0000000000000000`, T0.getTime())).http).toBe(404);
  });

  it('no máximo 1 leitura por minuto: antes de 1 min não chama a Meta; depois lê; de novo no mesmo minuto não lê', async () => {
    const id = await criar();
    chamadas = [];
    regras.unshift(c => (c.url.includes('/CONT1?fields=status_code') ? ok({ status_code: 'IN_PROGRESS' }) : null));
    const cedo = await avancarPublicacao(id, mais(T0, 0.5).getTime());
    expect(cedo).toMatchObject({ ok: true, lido: false });
    expect(chamadas).toEqual([]);
    const lida = await avancarPublicacao(id, mais(T0, 1.1).getTime());
    expect(lida).toMatchObject({ lido: true, motivo: 'aguardando' });
    expect(chamadas.filter(c => c.url.includes('/CONT1'))).toHaveLength(1);
    const outra = await avancarPublicacao(id, mais(T0, 1.5).getTime());
    expect(outra.lido).toBe(false);
    expect(chamadas.filter(c => c.url.includes('/CONT1'))).toHaveLength(1);
  });

  it('tela e cron no mesmo segundo: uma só leitura (a troca com versão decide)', async () => {
    const id = await criar();
    chamadas = [];
    regras.unshift(c => (c.url.includes('/CONT1?fields=status_code') ? ok({ status_code: 'IN_PROGRESS' }) : null));
    const t = mais(T0, 2).getTime();
    await Promise.all([avancarPublicacao(id, t), avancarPublicacao(id, t + 5)]);
    expect(chamadas.filter(c => c.url.includes('/CONT1'))).toHaveLength(1);
  });

  it('FINISHED publica UMA vez, mesmo com duas chamadas juntas; o resultado traz o id da mídia', async () => {
    const id = await criar();
    chamadas = [];
    const t = mais(T0, 2).getTime();
    const [a, b] = await Promise.all([avancarPublicacao(id, t), avancarPublicacao(id, t + 3)]);
    expect(escritas().filter(u => u.endsWith('/media_publish'))).toHaveLength(1);
    expect([a.motivo, b.motivo].sort()).toEqual(['aguardando', 'publicado']);
    expect(valorDe(banco, `redes_pub:${id}`)).toMatchObject({ estado: 'publicado', media_id: 'MEDIA1' });
    chamadas = [];
    expect((await avancarPublicacao(id, mais(T0, 4).getTime())).motivo).toBe('publicado');
    expect(chamadas).toEqual([]);
  });

  it('falha honesta depois de 5 minutos sem confirmação: não lê mais e não publica', async () => {
    const id = await criar();
    regras.unshift(c => (c.url.includes('/CONT1?fields=status_code') ? ok({ status_code: 'IN_PROGRESS' }) : null));
    await avancarPublicacao(id, mais(T0, 2).getTime());
    await avancarPublicacao(id, mais(T0, 4).getTime());
    chamadas = [];
    const r = await avancarPublicacao(id, mais(T0, 5.1).getTime());
    expect(r).toMatchObject({ motivo: 'demorou', publicacao: { estado: 'falhou' } });
    expect(chamadas).toEqual([]);
    expect(valorDe(banco, `redes_pub:${id}`).estado).toBe('falhou');
  });

  it('ERROR ou EXPIRED do contêiner falha e não publica', async () => {
    const id = await criar();
    regras.unshift(c => (c.url.includes('/CONT1?fields=status_code') ? ok({ status_code: 'ERROR' }) : null));
    const r = await avancarPublicacao(id, mais(T0, 2).getTime());
    expect(r.motivo).toBe('falhou_processar');
    expect(escritas().filter(u => u.endsWith('/media_publish'))).toEqual([]);
  });

  it('erro de parada na leitura do contêiner para a conta; 5xx no media_publish vira incerto e não repete', async () => {
    const id = await criar();
    regras.unshift(c => (c.url.includes('/CONT1?fields=status_code') ? erro(400, 613) : null));
    const r = await avancarPublicacao(id, mais(T0, 2).getTime());
    expect(r).toMatchObject({ lido: true, motivo: 'leitura_falhou' });
    expect(valorDe(banco, 'redes_parada:instagram').codigo).toBe(613);
    regras.shift();
    banco.tabelas.system_state = banco.tabelas.system_state!.filter(x => x.key !== 'redes_parada:instagram');
    regras.unshift(c => (c.metodo === 'POST' && c.url.endsWith('/media_publish') ? { status: 500, json: {} } : null));
    const r2 = await avancarPublicacao(id, mais(T0, 4).getTime());
    expect(r2).toMatchObject({ motivo: 'meta_incerto', publicacao: { estado: 'incerto' } });
    chamadas = [];
    await avancarPublicacao(id, mais(T0, 6).getTime());
    expect(escritas()).toEqual([]);
  });

  it('"publicando" parado há mais de 5 min aparece como incerto na lista', async () => {
    const id = await criar();
    const k = `redes_pub:${id}`;
    const v = valorDe(banco, k);
    banco.tabelas.system_state!.find(x => x.key === k)!.value = { ...v, estado: 'publicando', ultima_leitura_em: T0.toISOString() };
    const lista = await listarPublicacoes(30, mais(T0, 6).getTime());
    expect(lista[0]).toMatchObject({ id, estado: 'incerto' });
  });

  it('o cron só avança o que está aguardando e respeita o 1 por minuto; sem as envs de Reels, sai na hora', async () => {
    const id = await criar();
    chamadas = [];
    const r = await avancarPendentes(mais(T0, 2).getTime());
    expect(r).toMatchObject({ vistas: 1, avancadas: 1 });
    expect(valorDe(banco, `redes_pub:${id}`).estado).toBe('publicado');
    chamadas = [];
    expect(await avancarPendentes(mais(T0, 3).getTime())).toMatchObject({ vistas: 0 });
    expect(chamadas).toEqual([]);
    delete process.env.REDES_REELS_IG_LIGADO; delete process.env.REDES_REELS_FB_LIGADO;
    expect(await avancarPendentes(mais(T0, 3).getTime())).toMatchObject({ reason: 'desligado' });
  });
});

describe('Reels na Página: início, envio e fim', () => {
  it('início, envio por file_url a um endereço da Meta e fim com a legenda; depois o avanço lê e publica', async () => {
    const r = await pub('facebook', 'a');
    expect(r).toMatchObject({ ok: true, http: 202, motivo: 'aguardando' });
    const ords = chamadas.filter(c => c.metodo === 'POST');
    expect(ords.map(c => c.corpo?.upload_phase ?? 'envio')).toEqual(['start', 'envio', 'finish']);
    expect(ords[1]!.url).toBe('https://rupload.facebook.com/video-upload/v21.0/VID1');
    expect(ords[1]!.cab).toMatchObject({ Authorization: 'OAuth pgtk', file_url: video('a') });
    expect(ords[2]!.corpo).toMatchObject({ video_id: 'VID1', video_state: 'PUBLISHED', description: 'Reel de teste' });
    const id = r.publicacao!.id;
    expect(id).toMatch(new RegExp(`^facebook\\.${PAGINA}\\.`));
    expect(await avancarPublicacao(id, mais(T0, 0.3).getTime())).toMatchObject({ lido: false });
    expect(await avancarPublicacao(id, mais(T0, 1.2).getTime())).toMatchObject({ motivo: 'publicado', lido: true });
    expect(valorDe(banco, `redes_pub:${id}`)).toMatchObject({ estado: 'publicado', media_id: 'VID1' });
  });

  it('endereço de envio fora da Meta: o token não vai para lá e nada é publicado', async () => {
    regras.unshift(c => (c.metodo === 'POST' && c.corpo?.upload_phase === 'start' ? ok({ video_id: 'VID1', upload_url: 'https://evil.example.com/up' }) : null));
    const r = await pub('facebook', 'a');
    expect(r.ok).toBe(false);
    expect(chamadas.some(c => c.url.startsWith('https://evil.example.com'))).toBe(false);
    expect(chamadas.filter(c => c.corpo?.upload_phase === 'finish')).toEqual([]);
  });

  it('erro de limite na Página (613) para a Página por 15 min', async () => {
    regras.unshift(c => (c.metodo === 'POST' && c.corpo?.upload_phase === 'start' ? erro(400, 613) : null));
    expect((await pub('facebook', 'a')).ok).toBe(false);
    expect(valorDe(banco, 'redes_parada:facebook').codigo).toBe(613);
    regras.shift();
    chamadas = [];
    expect((await pub('facebook', 'b', mais(T0, 10))).motivo).toBe('parada');
    expect(chamadas).toEqual([]);
    expect((await pub('facebook', 'b', mais(T0, 31))).ok).toBe(true);
  });

  it('video_state ERROR falha; o Reel da Página sem confirmação em 5 min fica incerto', async () => {
    const r = await pub('facebook', 'a');
    const id = r.publicacao!.id;
    regras.unshift(c => (c.url.includes('/VID1?fields=status') ? ok({ status: { video_status: 'processing' } }) : null));
    expect((await avancarPublicacao(id, mais(T0, 2).getTime())).motivo).toBe('aguardando');
    // Na Página o `finish` com PUBLISHED já saiu: depois de 5 min o estado é INCERTO, nunca "falhou" (pode estar no ar).
    const tarde = await avancarPublicacao(id, mais(T0, 5.5).getTime());
    expect(tarde).toMatchObject({ motivo: 'pedido_ja_feito', publicacao: { estado: 'incerto' } });
    expect(tarde.mensagem).toBe('O pedido já foi feito. Confira a Página antes de subir de novo.');
    expect(valorDe(banco, `redes_pub:${id}`).estado).toBe('incerto');
    const r2 = await pub('facebook', 'b', mais(T0, 40));
    regras.unshift(c => (c.url.includes('/VID1?fields=status') ? ok({ status: { video_status: 'error' } }) : null));
    expect((await avancarPublicacao(r2.publicacao!.id, mais(T0, 42).getTime())).motivo).toBe('falhou_processar');
  });
});

describe('Reels: limites para a tela', () => {
  it('desligado, aberto, dentro dos 30 min e em parada dizem o que e quando', async () => {
    delete process.env.REDES_REELS_IG_LIGADO;
    expect(await situacaoReels('instagram', T0.getTime())).toMatchObject({ ligado: false, pode: false, motivo: 'chave_desligada' });
    process.env.REDES_REELS_IG_LIGADO = '1';
    expect(await situacaoReels('instagram', T0.getTime())).toMatchObject({ ligado: true, pode: true });
    await pub('instagram', 'a');
    const cedo = await situacaoReels('instagram', mais(T0, 10).getTime());
    expect(cedo).toMatchObject({ pode: false, motivo: 'espacamento', abre_em: mais(T0, 30).toISOString() });
    banco.tabelas.system_state!.push({ key: 'redes_parada:instagram', value: { ate: mais(T0, 50).toISOString(), codigo: 17 }, updated_at: T0.toISOString() });
    const parada = await situacaoReels('instagram', mais(T0, 40).getTime());
    expect(parada).toMatchObject({ pode: false, motivo: 'parada_meta_17' });
    expect(parada.abre_em).toBe(mais(T0, 50).toISOString());
  });
});

describe('Reels: desligar a env para o avanço, prazos e a versão que o banco gravou', () => {
  it('Reel pendente com a env DA REDE dele desligada: nenhuma chamada à Meta (nem leitura, nem media_publish); religada, segue', async () => {
    const r = await pub('instagram', 'a');
    const id = r.publicacao!.id;
    chamadas = [];
    delete process.env.REDES_REELS_IG_LIGADO;
    const res = await avancarPublicacao(id, mais(T0, 2).getTime());
    expect(res).toMatchObject({ ok: false, http: 403, motivo: 'chave_desligada', lido: false });
    expect(chamadas).toEqual([]);
    expect(valorDe(banco, `redes_pub:${id}`).estado).toBe('aguardando');
    // O cron também: com só a env do Facebook ligada, o Reel do Instagram pendente não é tocado.
    expect(await avancarPendentes(mais(T0, 2).getTime())).toMatchObject({ vistas: 1, avancadas: 0 });
    expect(chamadas).toEqual([]);
    process.env.REDES_REELS_IG_LIGADO = '1';
    expect((await avancarPublicacao(id, mais(T0, 3).getTime())).motivo).toBe('publicado');
  });

  it('o mesmo na Página: env desligada, nenhuma leitura; e o prazo de 5 min também só vale com a env ligada', async () => {
    const id = (await pub('facebook', 'a')).publicacao!.id;
    chamadas = [];
    delete process.env.REDES_REELS_FB_LIGADO;
    expect((await avancarPublicacao(id, mais(T0, 2).getTime())).http).toBe(403);
    expect(chamadas).toEqual([]);
  });

  it('o token da Página tem prazo: pendurado, a publicação na Página volta "conta indisponível" sem escrever, e o avanço diz que não leu', async () => {
    limitesPublicador.tokenMs = 20;
    tk.pendurar = true;
    const t0 = Date.now();
    expect(await pub('facebook', 'a')).toMatchObject({ ok: false, motivo: 'conta_indisponivel' });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(escritas()).toEqual([]);
    tk.pendurar = false;
    const id = (await pub('facebook', 'b', mais(T0, 31))).publicacao!.id;
    tk.pendurar = true;
    expect(await avancarPublicacao(id, mais(T0, 33).getTime())).toMatchObject({ motivo: 'leitura_falhou' });
  });

  it('o cron tem prazo total: uma leitura pendurada na Meta não segura a rodada', async () => {
    await pub('instagram', 'a');
    limitesPublicador.cronMs = 60;
    regras.unshift(c => (c.url.includes('/CONT1?fields=status_code') ? { status: -1, json: {} } : null));
    const t0 = Date.now();
    const r = await avancarPendentes(mais(T0, 2).getTime());
    expect(r).toMatchObject({ reason: 'prazo' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('a versão da troca é o updated_at que o BANCO gravou, não o relógio de quem chamou: com relógio de servidor, o fluxo inteiro fecha', async () => {
    banco.relogioServidor = true;
    const id = (await pub('instagram', 'a')).publicacao!.id;
    chamadas = [];
    const res = await avancarPublicacao(id, mais(T0, 2).getTime());
    expect(res).toMatchObject({ motivo: 'publicado', lido: true });
    expect(escritas().filter(u => u.endsWith('/media_publish'))).toHaveLength(1);
    const { trocarSe } = await import('../services/gerador/redes/comum');
    const linha = banco.tabelas.system_state!.find(x => x.key === 'redes_pub:' + id)!;
    const gravado = await trocarSe('redes_pub:' + id, linha.value, linha.updated_at, '2000-01-01T00:00:00.000Z');
    expect(gravado).toBe(linha.updated_at);                 // devolve o que o banco gravou
    expect(gravado).toMatch(/\+00:00$/);
    expect(await trocarSe('redes_pub:' + id, linha.value, '1999-01-01T00:00:00.000Z')).toBeNull();   // versão velha perde
  });
});
