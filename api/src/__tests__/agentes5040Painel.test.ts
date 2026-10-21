import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Painel do ensaio (A3). Login simulado, bucket em memória (banco falso do ensaio) e o replay trocado por um espião.
// Prova: 401, 403 (fora da equipe), 400 (nota inválida), notas que não se sobrescrevem, DELETE só do autor,
// replay só do sócio, e que nenhuma resposta nem nenhum log carrega o telefone.

const h = vi.hoisted(() => ({
  principal: null as any,
  usuarios: {} as Record<string, string>,
  replay: null as any,
}));

vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
  },
}));
vi.mock('../services/agentes5040/replay', () => ({ runReplay: (...a: unknown[]) => h.replay(...a) }));

import { novoBanco, type BancoFalso } from './_agentes5040Fake';
import { mountEnsaio5040 } from '../routes/geradorEnsaio5040';
import { hmacDe } from '../services/agentes5040/hmac';
import { zerarCacheArmazem, type TurnoGravado } from '../services/agentes5040/armazem';
import { emParalelo, gravarNota, zerarCacheNotas } from '../services/agentes5040/notas';

const TELEFONE = '5511988880001';
const CHAVE = '1188880001';

const r = Router();
mountEnsaio5040(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const THIAGO = 'Bearer tk-thiago';   // sócio e equipe
const NILCE = 'Bearer tk-nilce';     // equipe, não sócio
const FORA = 'Bearer tk-fora';       // consultor fora da equipe
const ESTRANHO = 'Bearer tk-estranho';

let banco: BancoFalso;
let HM: string;
let erroConsole: ReturnType<typeof vi.spyOn>;
let logConsole: ReturnType<typeof vi.spyOn>;

const turno = (waId: number, extra: Partial<TurnoGravado> = {}): TurnoGravado => ({
  v: 1, origem: 'vivo', dia: '2026-10-20', hmac: HM, wa_id: waId, momento: `2026-10-20T14:${10 + waId}:00Z`, kind: 'resposta',
  dona: 'duda', passo: 6, motivo_porteiro: 'card recente', persona: 'duda', falou: true, bolhas: ['Oi, Maria. Quanto você gasta de luz?'],
  acao: 'continuar', peca: null, dados: {}, resumo: null, motivo_silencio: null, reescrita: null, modelo: 'm', uso: null,
  qualificado: false, pergunta_porteiro: null,
  entrada: [{ id: waId, autor: 'lead', tipo: 'texto', texto: 'quero energia solar', momento: `2026-10-20T14:${10 + waId}:00Z` }],
  n_historico: 1, real: [{ id: waId + 1, autor: 'robo', tipo: 'texto', texto: 'Resposta de verdade', momento: '2026-10-20T14:20:00Z' }],
  gravado_em: '2026-10-20T15:00:00Z', ...extra,
});

const semear = (t: TurnoGravado): void => { banco.objetos.set(`turnos/${t.dia}/${t.hmac}/${t.wa_id}.json`, JSON.stringify(t)); };
const notasDe = (waId: number): string[] => [...banco.objetos.keys()].filter(k => k.startsWith(`notas/${waId}/`)).sort();
const corpo = (extra: Record<string, unknown> = {}) => ({ conversa: HM, turno: 11, certo: true, nota: 8, comentario: 'Boa.', ...extra });

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.CAIXA_EQUIPE; delete process.env.SOLAR_SOCIOS;
  HM = hmacDe(CHAVE)!;
  banco = novoBanco(); h.principal = banco; zerarCacheArmazem(); zerarCacheNotas();
  banco.bucket = { existe: true, publico: false, criado: false };
  h.usuarios = {
    'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-nilce': 'nilce@irmaosnaobra.app',
    'tk-fora': 'fulano@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com',
  };
  h.replay = vi.fn(async () => ({
    ok: true, ligado: true, dry: false, conversasVistas: 4, conversasProcessadas: 2, turnosGravados: 5, turnosJaExistiam: 1,
    chamadasIA: 5, parou: null, janelaTruncada: false, puladas: { sem_turno_na_janela: 1 }, turnos: [{ hmac8: 'abcdef12' }],
  }));
  semear(turno(11)); semear(turno(12, { persona: null, dona: null, falou: false, bolhas: [], motivo_silencio: 'porteiro: ninguém' }));
  erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
  logConsole = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { erroConsole.mockRestore(); logConsole.mockRestore(); vi.restoreAllMocks(); });

const ROTAS: Array<['get' | 'post' | 'delete', string]> = [
  ['get', '/gerador/ensaio/conversas'], ['get', '/gerador/ensaio/conversa?id=' + 'a'.repeat(64)], ['post', '/gerador/ensaio/nota'],
  ['delete', '/gerador/ensaio/nota?turno=11&nota=thiago-1790000000000'], ['get', '/gerador/ensaio/placar'], ['post', '/gerador/ensaio/replay'],
];

describe('travas de acesso', () => {
  it('sem token: 401 em toda rota, e a resposta sai sem cache', async () => {
    for (const [m, url] of ROTAS) {
      const res = await (request(app) as any)[m](url);
      expect(res.status, `${m} ${url}`).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('conta que não é de consultor: 403 do login', async () => {
    const res = await request(app).get('/gerador/ensaio/placar').set('Authorization', ESTRANHO);
    expect(res.status).toBe(403);
    expect(res.body.precisa).toBe('login');
  });

  it('consultor fora da equipe: 403 com marcador próprio, sem dado e sem tocar no bucket', async () => {
    for (const [m, url] of ROTAS) {
      const res = await (request(app) as any)[m](url).set('Authorization', FORA).send(corpo());
      expect(res.status, `${m} ${url}`).toBe(403);
      expect(res.body.precisa).toBe('equipe');
    }
    expect(notasDe(11)).toEqual([]);
    expect(h.replay).not.toHaveBeenCalled();
  });

  it('CAIXA_EQUIPE troca a lista', async () => {
    process.env.CAIXA_EQUIPE = 'fulano';
    expect((await request(app).get('/gerador/ensaio/placar').set('Authorization', FORA)).status).toBe(200);
    expect((await request(app).get('/gerador/ensaio/placar').set('Authorization', THIAGO)).status).toBe(403);
  });
});

describe('nota', () => {
  it('nota inválida: 400, e nada é gravado', async () => {
    const ruins: Array<Record<string, unknown>> = [
      { nota: 11 }, { nota: -1 }, { nota: 5.5 }, { nota: '7' }, { nota: undefined }, { certo: 'sim' }, { certo: undefined },
      { comentario: 'x'.repeat(501) }, { comentario: 42 }, { turno: 0 }, { turno: '11' }, { conversa: 'abc' }, { conversa: undefined }, { dia: '../x' },
    ];
    for (const extra of ruins) {
      const res = await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo(extra));
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(notasDe(11)).toEqual([]);
  });

  it('comentário de 500 caracteres passa; 0 e 10 são notas válidas', async () => {
    for (const nota of [0, 10]) {
      expect((await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ nota, comentario: 'y'.repeat(500) }))).status).toBe(201);
    }
  });

  it('turno que não existe: 404', async () => {
    const res = await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ turno: 999 }));
    expect(res.status).toBe(404);
    expect(notasDe(999)).toEqual([]);
  });

  it('persona e origem vêm do turno gravado, não do cliente', async () => {
    const res = await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ persona: 'carla', origem: 'replay' }));
    expect(res.status).toBe(201);
    const gravada = JSON.parse(banco.objetos.get(`notas/11/${res.body.id}.json`)!);
    expect(gravada).toMatchObject({ persona: 'duda', origem: 'vivo', autor: 'thiago', certo: true, nota: 8, hmac: HM, turno: 11 });
  });

  it('duas notas não se sobrescrevem (mesmo autor, mesmo milissegundo)', async () => {
    const a = await gravarNota({ turno: 11, hmac: HM, persona: 'duda', origem: 'vivo', autor: 'thiago', certo: true, nota: 9, comentario: 'primeira' }, 1_790_000_000_000);
    const b = await gravarNota({ turno: 11, hmac: HM, persona: 'duda', origem: 'vivo', autor: 'thiago', certo: false, nota: 2, comentario: 'segunda' }, 1_790_000_000_000);
    expect(a.id).not.toBe(b.id);
    expect(notasDe(11)).toHaveLength(2);
    expect(JSON.parse(banco.objetos.get(`notas/11/${a.id}.json`)!).comentario).toBe('primeira');
    expect(JSON.parse(banco.objetos.get(`notas/11/${b.id}.json`)!).comentario).toBe('segunda');
  });

  it('duas notas pela rota viram dois arquivos, e a conversa devolve as duas', async () => {
    expect((await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ comentario: 'um' }))).status).toBe(201);
    expect((await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ comentario: 'dois', certo: false, nota: 3 }))).status).toBe(201);
    expect((await request(app).post('/gerador/ensaio/nota').set('Authorization', NILCE).send(corpo({ comentario: 'da nilce' }))).status).toBe(201);
    expect(notasDe(11)).toHaveLength(3);
    const res = await request(app).get('/gerador/ensaio/conversa').query({ id: HM }).set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    const t11 = res.body.turnos.find((t: any) => t.turno === 11);
    expect(t11.notas.map((n: any) => n.comentario).sort()).toEqual(['da nilce', 'dois', 'um']);
    expect(t11.notas.filter((n: any) => n.minha)).toHaveLength(2);
  });
});

describe('DELETE da nota', () => {
  it('só o autor apaga: outro recebe 403 e a nota fica', async () => {
    const criada = await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo());
    const id = criada.body.id as string;
    const alheio = await request(app).delete('/gerador/ensaio/nota').query({ turno: 11, nota: id }).set('Authorization', NILCE);
    expect(alheio.status).toBe(403);
    expect(notasDe(11)).toHaveLength(1);
    // Nome do arquivo trocado pelo de outro autor também não passa.
    const disfarce = await request(app).delete('/gerador/ensaio/nota').query({ turno: 11, nota: id.replace('thiago', 'nilce') }).set('Authorization', NILCE);
    expect(disfarce.status).toBe(404);
    expect(notasDe(11)).toHaveLength(1);
    const meu = await request(app).delete('/gerador/ensaio/nota').query({ turno: 11, nota: id }).set('Authorization', THIAGO);
    expect(meu.status).toBe(200);
    expect(notasDe(11)).toEqual([]);
    expect((await request(app).delete('/gerador/ensaio/nota').query({ turno: 11, nota: id }).set('Authorization', THIAGO)).status).toBe(404);
  });

  it('pedido malformado: 400', async () => {
    for (const q of [{}, { turno: 11 }, { nota: 'thiago-1790000000000' }, { turno: 'x', nota: 'thiago-1790000000000' }, { turno: 11, nota: '../x' }]) {
      const res = await request(app).delete('/gerador/ensaio/nota').query(q).set('Authorization', THIAGO);
      expect(res.status, JSON.stringify(q)).toBe(400);
    }
  });
});

describe('placar e listas', () => {
  it('placar por agente: avaliados, % certo, média e quantos faltam para 50; devolve se é sócio', async () => {
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ certo: true, nota: 9 }));
    await request(app).post('/gerador/ensaio/nota').set('Authorization', NILCE).send(corpo({ certo: false, nota: 3 }));
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ turno: 12, certo: true, nota: 10 }));
    const res = await request(app).get('/gerador/ensaio/placar').set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.socio).toBe(true);
    const duda = res.body.placar.find((p: any) => p.persona === 'duda');
    expect(duda).toMatchObject({ turnos_avaliados: 1, avaliacoes: 2, certos: 1, pct_certo: 50, media: 6, faltam: 49 });
    expect(res.body.placar.find((p: any) => p.persona === 'carla')).toMatchObject({ turnos_avaliados: 0, pct_certo: null, faltam: 50 });
    expect(res.body.placar.find((p: any) => p.persona === 'ninguem')).toMatchObject({ turnos_avaliados: 1 });
    expect((await request(app).get('/gerador/ensaio/placar').set('Authorization', NILCE)).body.socio).toBe(false);
  });

  it('a nota mais nova de cada autor é a que conta no placar', async () => {
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ certo: false, nota: 1 }));
    await gravarNota({ turno: 11, hmac: HM, persona: 'duda', origem: 'vivo', autor: 'thiago', certo: true, nota: 7, comentario: '' }, Date.now() + 5000);
    const res = await request(app).get('/gerador/ensaio/placar').set('Authorization', THIAGO);
    expect(res.body.placar.find((p: any) => p.persona === 'duda')).toMatchObject({ avaliacoes: 1, certos: 1, media: 7 });
  });

  it('lista de conversas: hmac, agente, produto, datas, turnos, com nota e média; filtros funcionam', async () => {
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ nota: 8 }));
    const res = await request(app).get('/gerador/ensaio/conversas').query({ dias: 7 }).set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.conversas).toHaveLength(1);
    expect(res.body.conversas[0]).toMatchObject({ id: HM, persona: 'duda', produto: 'Solar', turnos: 2, com_nota: 1, media_nota: 8, primeira_data: '2026-10-20', origem: 'vivo' });
    const so = (q: Record<string, string>) => request(app).get('/gerador/ensaio/conversas').query(q).set('Authorization', THIAGO);
    // O último turno (wa_id 12) foi barrado pelo porteiro, mas a conversa é da Duda (turno 11): continua no filtro dela.
    expect((await so({ persona: 'duda' })).body.conversas).toHaveLength(1);
    expect((await so({ produto: 'solar' })).body.conversas).toHaveLength(1);
    expect((await so({ persona: 'ninguem' })).body.conversas).toHaveLength(0);
    expect((await so({ persona: 'helena' })).body.conversas).toHaveLength(0);
    expect((await so({ origem: 'replay' })).body.conversas).toHaveLength(0);
    expect((await so({ produto: 'banana' })).status).toBe(400);
    expect((await so({ persona: 'banana' })).status).toBe(400);
    expect((await so({ origem: 'banana' })).status).toBe(400);
  });

  it('conversa: entrada, bolhas, motivo do silêncio e o que foi respondido de verdade; id inválido = 400', async () => {
    const res = await request(app).get('/gerador/ensaio/conversa').query({ id: HM }).set('Authorization', NILCE);
    expect(res.status).toBe(200);
    const [a, b] = res.body.turnos;
    expect(a).toMatchObject({ turno: 11, persona: 'duda', falou: true, bolhas: ['Oi, Maria. Quanto você gasta de luz?'] });
    expect(a.entrada[0]).toMatchObject({ autor: 'lead', texto: 'quero energia solar' });
    expect(a.real[0].texto).toBe('Resposta de verdade');
    expect(b).toMatchObject({ turno: 12, falou: false, motivo_silencio: 'porteiro: ninguém' });
    expect((await request(app).get('/gerador/ensaio/conversa').query({ id: '3491112222' }).set('Authorization', NILCE)).status).toBe(400);
  });
});

describe('replay', () => {
  it('só sócio: quem é da equipe mas não é sócio recebe 403 e o replay não roda', async () => {
    const res = await request(app).post('/gerador/ensaio/replay').set('Authorization', NILCE).send({});
    expect(res.status).toBe(403);
    expect(res.body.precisa).toBe('socio');
    expect(h.replay).not.toHaveBeenCalled();
  });

  it('sócio: roda com janela e teto fixos no servidor, sem repassar dry, e a resposta só leva números', async () => {
    const res = await request(app).post('/gerador/ensaio/replay').set('Authorization', THIAGO).send({ dias: 999, conversas: 999, dry: true, maxTurnos: 999 });
    expect(res.status).toBe(200);
    expect(h.replay).toHaveBeenCalledTimes(1);
    const arg = h.replay.mock.calls[0][0];
    expect(arg.dry).toBeUndefined();
    expect(arg.maxConversas).toBe(5);
    expect(arg.maxTurnos).toBe(8);
    expect(Math.round((arg.ate.getTime() - arg.desde.getTime()) / 86_400_000)).toBe(30);
    expect(res.body).toMatchObject({ ok: true, conversas_processadas: 2, turnos_gravados: 5 });
    expect(JSON.stringify(res.body)).not.toContain('abcdef12');
  });

  it('replay desligado vira aviso (motivo), sem erro de servidor', async () => {
    h.replay = vi.fn(async () => ({ ok: true, ligado: false, motivo: 'interruptor replay desligado', conversasVistas: 0, conversasProcessadas: 0, turnosGravados: 0, turnosJaExistiam: 0, chamadasIA: 0, parou: null, janelaTruncada: false, puladas: {}, turnos: [] }));
    const res = await request(app).post('/gerador/ensaio/replay').set('Authorization', THIAGO).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ligado: false, motivo: 'interruptor replay desligado' });
  });
});

describe('telefone', () => {
  it('nenhuma resposta e nenhum log carrega o telefone, nem quando o bucket falha com o número na mensagem', async () => {
    const respostas: string[] = [];
    const ver = (res: { text: string }) => { respostas.push(res.text); };
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo()).then(ver);
    ver(await request(app).get('/gerador/ensaio/conversas').set('Authorization', THIAGO));
    ver(await request(app).get('/gerador/ensaio/conversa').query({ id: HM }).set('Authorization', THIAGO));
    ver(await request(app).get('/gerador/ensaio/placar').set('Authorization', THIAGO));
    ver(await request(app).post('/gerador/ensaio/replay').set('Authorization', THIAGO).send({}));

    // Falha do bucket com o telefone dentro da mensagem do driver.
    banco.cliente.storage.getBucket = async () => ({ data: null, error: { message: `falha ${TELEFONE} ${CHAVE}`, statusCode: '500' } });
    zerarCacheArmazem(); zerarCacheNotas();
    for (const [m, url] of [['get', '/gerador/ensaio/conversas'], ['get', '/gerador/ensaio/placar'], ['post', '/gerador/ensaio/nota']] as const) {
      const res = await (request(app) as any)[m](url).set('Authorization', THIAGO).send(corpo());
      expect(res.status, url).toBe(502);
      ver(res);
    }
    const tudo = respostas.join('\n') + JSON.stringify(erroConsole.mock.calls) + JSON.stringify(logConsole.mock.calls);
    expect(tudo).not.toContain(TELEFONE);
    expect(tudo).not.toContain(CHAVE);
    expect(tudo).not.toMatch(/55\d{10,11}/);
    expect(erroConsole).toHaveBeenCalled();   // o erro foi registrado, só com o código
    // Nem o caminho do bucket nem o nome do arquivo trazem telefone.
    expect([...banco.objetos.keys()].join('\n')).not.toContain(CHAVE);
  });

  it('o bucket continua privado e a rota só escreve em notas/', async () => {
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo());
    expect(banco.bucket.publico).toBe(false);
    const novos = [...banco.objetos.keys()].filter(k => !k.startsWith('turnos/'));
    expect(novos.every(k => k.startsWith('notas/'))).toBe(true);
    expect(banco.escritas).toEqual([]);   // nenhuma escrita em tabela
  });
});

describe('leitura em paralelo', () => {
  it('emParalelo respeita o teto de simultâneos e devolve na ordem dos itens', async () => {
    let ativos = 0; let pico = 0;
    const r = await emParalelo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], async x => {
      ativos++; pico = Math.max(pico, ativos);
      await new Promise(ok => setTimeout(ok, 5));
      ativos--;
      return x * 2;
    }, 3);
    expect(r).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(pico).toBeLessThanOrEqual(3);
    expect(pico).toBeGreaterThan(1);
    expect(await emParalelo([], async x => x)).toEqual([]);
  });

  it('a conversa só lê a pasta de notas dos turnos que têm nota', async () => {
    await request(app).post('/gerador/ensaio/nota').set('Authorization', THIAGO).send(corpo({ turno: 12 }));
    banco.objetos.set('notas/99999/thiago-1790000000000.json', '{}');   // turno de outra conversa
    const listados: string[] = [];
    const lerLista = banco.cliente.storage.from;
    banco.cliente.storage.from = (b: string) => {
      const o = lerLista(b);
      const lista = o.list;
      o.list = async (prefixo: string, op: unknown) => { listados.push(prefixo); return lista(prefixo, op); };
      return o;
    };
    zerarCacheNotas();
    const res = await request(app).get('/gerador/ensaio/conversa').query({ id: HM }).set('Authorization', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.turnos.find((t: any) => t.turno === 12).notas).toHaveLength(1);
    expect(listados).toContain('notas/12');
    expect(listados).not.toContain('notas/11');
  });
});

describe('controles do sócio: interruptores e comandos', () => {
  const estado = (k: string): any => banco.tabelas.system_state?.find((l: any) => l.key === k)?.value;
  const semear2 = (key: string, value: unknown): void => { (banco.tabelas.system_state ??= []).push({ key, value, updated_at: '2026-10-20T10:00:00Z' }); };
  const NOVAS: Array<['get' | 'put' | 'post', string]> = [
    ['get', '/gerador/ensaio/interruptores'], ['put', '/gerador/ensaio/interruptores'],
    ['get', '/gerador/ensaio/comando'], ['post', '/gerador/ensaio/comando'],
  ];
  beforeEach(() => {
    for (const n of ['ENSAIO', 'REPLAY', 'FICHA', 'SENTINELA']) delete process.env[`AGENTES5040_${n}`];
  });
  const pedir = (m: 'get' | 'put' | 'post', url: string, quem: string, corpoReq: unknown = {}) =>
    (request(app) as any)[m](url).set('Authorization', quem).send(corpoReq);

  it('sem token 401; fora da equipe 403; equipe que não é sócio 403, e nada é gravado', async () => {
    for (const [m, url] of NOVAS) {
      expect((await pedir(m, url, 'Bearer nada')).status, `${m} ${url}`).toBe(401);
      const fora = await pedir(m, url, FORA, { acao: 'sonda_armazem', ensaio: true });
      expect(fora.status, `${m} ${url}`).toBe(403);
      expect(fora.body.precisa).toBe('equipe');
      const nilce = await pedir(m, url, NILCE, { acao: 'sonda_armazem', ensaio: true });
      expect(nilce.status, `${m} ${url}`).toBe(403);
      expect(nilce.body.precisa).toBe('socio');
      expect(nilce.body.error).toBe('Só sócio usa os controles.');
    }
    expect(banco.escritas).toEqual([]);
  });

  it('GET interruptores: estado do banco, e a env só aparece como 1, 0 ou ausente', async () => {
    semear2('ag5040_interruptores', { ensaio: true, ficha: false });
    process.env.AGENTES5040_REPLAY = '1';
    process.env.AGENTES5040_SENTINELA = 'valor-secreto-da-vercel';
    process.env.AGENTES5040_FICHA = '0';
    const res = await pedir('get', '/gerador/ensaio/interruptores', THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.interruptores).toEqual({
      ensaio: { banco: true, env: null, ligado: true },
      replay: { banco: null, env: '1', ligado: true },
      ficha: { banco: false, env: '0', ligado: false },
      sentinela: { banco: null, env: null, ligado: false },
    });
    expect(JSON.stringify(res.body)).not.toContain('valor-secreto');
  });

  it('PUT interruptores: só os 4 nomes e só booleano; o resto do mapa fica; o cache é zerado', async () => {
    for (const ruim of [{}, { ensaio: 'sim' }, { ensaio: 1 }, { ensaio: null }, { foo: true }, { ensaio: true, foo: false }, []]) {
      const res = await pedir('put', '/gerador/ensaio/interruptores', THIAGO, ruim);
      expect(res.status, JSON.stringify(ruim)).toBe(400);
    }
    expect(estado('ag5040_interruptores')).toBeUndefined();
    // Uma chave que não é das 4 (de outra versão, por exemplo) já está no JSON: o PUT não pode apagá-la.
    semear2('ag5040_interruptores', { ficha: false, extra: 'fica', aninhado: { a: 1 } });
    expect((await pedir('put', '/gerador/ensaio/interruptores', THIAGO, { replay: true })).status).toBe(200);
    const res = await pedir('put', '/gerador/ensaio/interruptores', THIAGO, { ensaio: true });
    expect(res.status).toBe(200);
    expect(estado('ag5040_interruptores')).toEqual({ ficha: false, extra: 'fica', aninhado: { a: 1 }, replay: true, ensaio: true });
    expect(res.body.interruptores.ensaio.ligado).toBe(true);
    const { ligado } = await import('../services/agentes5040/interruptores');
    expect(await ligado('ensaio')).toBe(true);
    await pedir('put', '/gerador/ensaio/interruptores', THIAGO, { ensaio: false });
    expect(await ligado('ensaio')).toBe(false);   // sem o cache velho de 60 s
  });

  it('comando fora da lista, ou com parâmetro fora do limite: 400, e nada é gravado', async () => {
    const ruins: Array<Record<string, unknown>> = [
      { acao: 'apagar_tudo' }, { acao: 42 }, {}, { acao: 'enviar_mensagem', params: { telefone: '1' } },
      { acao: 'anuncios', params: { dias: 99 } }, { acao: 'anuncios', params: { dias: 0 } },
      { acao: 'replay_dry', params: { maxConversas: 2 } }, { acao: 'replay_dry', params: { maxTurnos: 3 } },
      { acao: 'replay_dry', params: { desde: 'ontem' } },
      { acao: 'replay_dry', params: { desde: '2026-10-20T00:00:00Z', ate: '2026-10-19T00:00:00Z' } },
      { acao: 'ficha_sonda', params: {} }, { acao: 'ficha_sonda', params: { card: -3 } },
    ];
    for (const c of ruins) {
      const res = await pedir('post', '/gerador/ensaio/comando', THIAGO, c);
      expect(res.status, JSON.stringify(c)).toBe(400);
    }
    expect(estado('ag5040_comando')).toBeUndefined();
  });

  it('ficha_teste sem confirmar:true dá 400; com ele grava o pedido (sem o campo confirmar)', async () => {
    for (const extra of [{}, { confirmar: false }, { confirmar: 'true' }, { confirmar: 1 }]) {
      const res = await pedir('post', '/gerador/ensaio/comando', THIAGO, { acao: 'ficha_teste', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(res.body.precisa).toBe('confirmar');
    }
    expect(estado('ag5040_comando')).toBeUndefined();
    const ok = await pedir('post', '/gerador/ensaio/comando', THIAGO, { acao: 'ficha_teste', confirmar: true });
    expect(ok.status).toBe(202);
    expect(estado('ag5040_comando')).toEqual({ acao: 'ficha_teste', params: {}, pedido_em: ok.body.pedido_em });
  });

  it('comando válido só GRAVA o pedido (parâmetros normalizados), e um segundo pedido espera o primeiro', async () => {
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const res = await pedir('post', '/gerador/ensaio/comando', THIAGO, { acao: 'replay_dry', params: { desde, extra: 'cai' } });
    expect(res.status).toBe(202);
    const gravado = estado('ag5040_comando');
    expect(gravado.acao).toBe('replay_dry');
    expect(gravado.pedido_em).toBe(res.body.pedido_em);
    expect(gravado.params).toMatchObject({ maxConversas: 1, maxTurnos: 2, desde });
    expect(gravado.params.extra).toBeUndefined();
    expect(Number.isFinite(Date.parse(gravado.params.ate))).toBe(true);
    expect(banco.escritas.map((e: any) => e.tabela)).toEqual(['system_state']);
    const outro = await pedir('post', '/gerador/ensaio/comando', THIAGO, { acao: 'sonda_armazem' });
    expect(outro.status).toBe(409);
    expect(estado('ag5040_comando').acao).toBe('replay_dry');
    expect(h.replay).not.toHaveBeenCalled();   // a rota não executa nada
  });

  it('GET comando: pendente, resultado e pedido velho (mais de 30 min não conta como pendente)', async () => {
    const vazio = await pedir('get', '/gerador/ensaio/comando', THIAGO);
    expect(vazio.body).toMatchObject({ ok: true, pendente: false, comando: null, resultado: null });
    semear2('ag5040_comando_resultado', { acao: 'anuncios', pedido_em: 'x', ok: true, resultado: { mensagens_recebidas: 3 }, terminou_em: '2026-10-20T10:00:00Z' });
    await pedir('post', '/gerador/ensaio/comando', THIAGO, { acao: 'anuncios', params: { dias: 7 } });
    const pend = await pedir('get', '/gerador/ensaio/comando', THIAGO);
    expect(pend.body.pendente).toBe(true);
    expect(pend.body.comando).toMatchObject({ acao: 'anuncios', params: { dias: 7 } });
    expect(pend.body.resultado.resultado).toEqual({ mensagens_recebidas: 3 });
    // pedido esquecido há 2 h: não é pendente e não trava um pedido novo
    banco.tabelas.system_state = banco.tabelas.system_state.filter((l: any) => l.key !== 'ag5040_comando');
    semear2('ag5040_comando', { acao: 'anuncios', params: {}, pedido_em: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    expect((await pedir('get', '/gerador/ensaio/comando', THIAGO)).body.pendente).toBe(false);
    expect((await pedir('post', '/gerador/ensaio/comando', THIAGO, { acao: 'sonda_armazem' })).status).toBe(202);
  });

  it('erro de banco vira 502 genérico, sem vazar a mensagem do driver', async () => {
    banco.falhar.system_state = { code: 'XX000', message: `falha ${TELEFONE}` };
    for (const [m, url] of [['get', '/gerador/ensaio/interruptores'], ['get', '/gerador/ensaio/comando']] as const) {
      const res = await pedir(m, url, THIAGO);
      expect(res.status).toBe(502);
      expect(res.text).not.toContain(TELEFONE);
    }
    expect(JSON.stringify(erroConsole.mock.calls)).not.toContain(TELEFONE);
  });
});
