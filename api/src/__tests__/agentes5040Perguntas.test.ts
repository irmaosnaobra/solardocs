import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Perguntas em aberto: a fila (criar e somar, nunca reabrir), a validação da resposta, as rotas (só sócio responde), a injeção
// no conhecimento (um bloco SEPARADO do fixo, por produto, com teto) e os interruptores que nascem ligados.

const h = vi.hoisted(() => ({ principal: null as any, usuarios: {} as Record<string, string> }));

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
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { mountEnsaio5040 } from '../routes/geradorEnsaio5040';
import {
  MAX_CARACTERES_DO_BLOCO, MAX_RESPOSTAS_NO_BLOCO, TITULO_DO_BLOCO, blocoDeRespostasDoDono, chaveDaPergunta, montarBlocoDeRespostas,
  normalizarPergunta, registrarPergunta, validarResposta, zerarCacheRespostasDono, type Pergunta,
} from '../services/agentes5040/perguntas';
import { NOMES_INTERRUPTORES, ligado, zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { perguntarAgente } from '../services/agentes5040/ia';
import { pensarTurno } from '../services/agentes5040/turno';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe } from '../services/agentes5040/hmac';
import type { ContextoLead, PersonaDef } from '../services/agentes5040/tipos';
import { msg } from './_agentes5040Util';

const AGORA = new Date('2026-10-21T10:00:00.000Z');
const HM = 'a'.repeat(64);

let banco: BancoFalso;

const ocorrencia = (extra: Record<string, unknown> = {}) => ({
  produto: 'solar' as const, pergunta_curta: 'Tem garantia da instalação?', dia: '2026-10-20', hmac: HM, como_respondeu: 'Disse que depende', ...extra,
});
const linhaDe = (chave: string) => banco.tabelas.system_state?.find(l => l.key === chave);

const pergunta = (extra: Partial<Pergunta> = {}): Pergunta => ({
  produto: 'solar', pergunta: 'Qual a garantia?', exemplos: [], vezes: 1, criada_em: '2026-10-20T10:00:00Z', atualizada_em: '2026-10-20T10:00:00Z',
  status: 'respondida', resposta: 'Os painéis têm garantia de fábrica.', respondida_por: 'thiago', respondida_em: '2026-10-20T11:00:00Z', ...extra,
});

/** Semeia uma pergunta no banco falso e devolve a chave. */
function semear(produto: 'solar' | 'solardoc' | 'eletroposto', curta: string, extra: Partial<Pergunta> = {}): string {
  const chave = chaveDaPergunta(produto, curta);
  (banco.tabelas.system_state ??= []).push({ key: chave, value: pergunta({ produto, pergunta: curta, ...extra }), updated_at: '2026-10-20T11:00:00Z' });
  return chave;
}

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.CAIXA_EQUIPE; delete process.env.SOLAR_SOCIOS;
  for (const k of ['AGENTES5040_RESPOSTAS_DONO', 'AGENTES5040_QUALIDADE']) delete process.env[k];
  banco = novoBanco(); h.principal = banco;
  banco.bucket = { existe: true, publico: false, criado: false };
  zerarCacheArmazem(); zerarCacheInterruptores(); zerarCacheRespostasDono();
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-fora': 'fulano@irmaosnaobra.app' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a fila: cria, soma, nunca reabre', () => {
  it('a chave leva o produto e 16 hex do sha1 da pergunta normalizada', () => {
    expect(chaveDaPergunta('solar', 'Tem garantia da instalação?')).toMatch(/^ag5040_pergunta:solar:[0-9a-f]{16}$/);
    expect(normalizarPergunta('Tem GARANTIA da instalação?!')).toBe('tem garantia da instalacao');
    expect(chaveDaPergunta('solar', 'Tem garantia da instalação?')).toBe(chaveDaPergunta('solar', '  tem garantia da INSTALACAO '));
    expect(chaveDaPergunta('solar', 'x y')).not.toBe(chaveDaPergunta('solardoc', 'x y'));
  });

  it('cria a pergunta e, na repetição, soma vezes e exemplos (no máximo 5)', async () => {
    expect(await registrarPergunta(ocorrencia(), AGORA)).toBe('criada');
    const chave = chaveDaPergunta('solar', ocorrencia().pergunta_curta);
    expect(linhaDe(chave)!.value).toMatchObject({ produto: 'solar', pergunta: 'Tem garantia da instalação?', vezes: 1, status: 'aberta', criada_em: AGORA.toISOString() });
    for (let i = 0; i < 6; i++) expect(await registrarPergunta(ocorrencia({ hmac: String(i).repeat(64) }), AGORA)).toBe('somada');
    const v = linhaDe(chave)!.value;
    expect(v.vezes).toBe(7);
    expect(v.exemplos).toHaveLength(5);
    expect(banco.tabelas.system_state!.filter(l => l.key.startsWith('ag5040_pergunta:'))).toHaveLength(1);
  });

  it('o exemplo guarda só dia, hmac e como a agente respondeu: a fala do lead não vai para o system_state', async () => {
    await registrarPergunta({ ...ocorrencia(), trecho: 'FALA-LITERAL-DO-LEAD' } as any, AGORA);
    const v = linhaDe(chaveDaPergunta('solar', ocorrencia().pergunta_curta))!.value;
    expect(v.exemplos[0]).toEqual({ dia: '2026-10-20', hmac: HM, como_respondeu: 'Disse que depende' });
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain('FALA-LITERAL-DO-LEAD');
  });

  it('corrida com o sócio: se ele respondeu entre a leitura e a gravação, o relógio não apaga a resposta', async () => {
    const chave = semear('solar', 'Qual o prazo?', { status: 'aberta', resposta: undefined });
    const linha = banco.tabelas.system_state!.find(l => l.key === chave)!;
    // o sócio responde logo depois da leitura do relógio: o espião muda a linha quando o relógio vai gravar
    const original = banco.cliente.from.bind(banco.cliente);
    let leu = false;
    banco.cliente.from = (nome: string) => {
      const b = original(nome);
      const upd = b.update;
      b.update = (payload: any) => {
        if (nome === 'system_state' && !leu) {
          leu = true;
          linha.value = { ...linha.value, status: 'respondida', resposta: 'Uns 30 dias.', respondida_por: 'thiago' };
          linha.updated_at = '2026-10-21T09:59:00Z';
        }
        return upd(payload);
      };
      return b;
    };
    expect(await registrarPergunta(ocorrencia({ pergunta_curta: 'Qual o prazo?' }), AGORA)).toBe('fechada');
    banco.cliente.from = original;
    expect(linha.value).toMatchObject({ status: 'respondida', resposta: 'Uns 30 dias.', vezes: 1 });
  });

  it('nunca reabre pergunta respondida ou ignorada', async () => {
    const respondida = semear('solar', 'Qual a garantia?');
    const ignorada = semear('solar', 'Vocês atendem em Goiás?', { status: 'ignorada', resposta: undefined });
    expect(await registrarPergunta(ocorrencia({ pergunta_curta: 'Qual a garantia?' }), AGORA)).toBe('fechada');
    expect(await registrarPergunta(ocorrencia({ pergunta_curta: 'Vocês atendem em Goiás?' }), AGORA)).toBe('fechada');
    expect(linhaDe(respondida)!.value).toMatchObject({ status: 'respondida', vezes: 1, resposta: 'Os painéis têm garantia de fábrica.' });
    expect(linhaDe(ignorada)!.value).toMatchObject({ status: 'ignorada', vezes: 1 });
  });
});

describe('a validação da resposta', () => {
  it('aceita resposta normal e recusa fora de 3 a 400 caracteres', () => {
    expect(validarResposta('Os painéis têm garantia de fábrica.')).toBeNull();
    expect(validarResposta('ok')).toMatch(/pelo menos 3/);
    expect(validarResposta('a'.repeat(401))).toMatch(/400/);
    expect(validarResposta('a'.repeat(400))).toBeNull();
    expect(validarResposta(undefined)).toMatch(/Escreva/);
  });

  it('recusa travessão, emoji e dinheiro, com mensagem clara', () => {
    expect(validarResposta('Tem garantia — de 10 anos')).toMatch(/travessão/);
    expect(validarResposta('Tem garantia – de 10 anos')).toMatch(/travessão/);
    expect(validarResposta('Tem garantia \u{1F600}')).toMatch(/emoji/);
    expect(validarResposta('Tem garantia ✅')).toMatch(/emoji/);
    for (const t of [
      'Sai por R$ 5 mil', 'Custa 67 reais', 'O plano é 67 por mês', 'São 2.000 por mes', 'Sai por 100 ao mês', 'Custa $ 10',
      'a partir de 18 mil', 'Fica em 18 mil', 'São 10k', '67 mensais', 'Tem mensalidade', 'O plano é mensal', 'sai 1.500', 'custa 67',
      'Fica 200 no total', 'Garantia por 97', 'Tem 20% de desconto', 'Desconto de 15 %',
    ]) {
      expect(validarResposta(t), t).toMatch(/Preço fica no conhecimento fixo/);
    }
    for (const t of [
      'A garantia dura 12 meses.', 'Em 2 dias úteis', 'Instalação em 1 dia', 'Garantia de 25 anos', 'Fica pronto em 2 dias', 'Garantia por 25 anos',
      'Sai em 3 semanas', 'Custa pouco tempo de obra', 'O sistema de 5 kWp atende', 'Atende 3 cidades',
    ]) {
      expect(validarResposta(t), t).toBeNull();
    }
  });
});

describe('as rotas', () => {
  const r = Router();
  mountEnsaio5040(r);
  const app = express();
  app.use(express.json());
  app.use('/gerador', r);
  const THIAGO = 'Bearer tk-thiago';   // sócio e equipe
  const NILCE = 'Bearer tk-nilce';     // equipe, não sócio
  const FORA = 'Bearer tk-fora';       // fora da equipe

  const idDe = (chave: string): string => chave.replace('ag5040_pergunta:', '');
  const post = (id: string, acao: string, token: string, corpo?: object) =>
    (request(app).post(`/gerador/ensaio/perguntas/${id}/${acao}`) as any).set('Authorization', token).send(corpo ?? {});

  it('GET lista por status para a equipe (e diz se é sócio); fora da equipe, 403', async () => {
    semear('solar', 'Qual a garantia?');
    semear('solardoc', 'Tem plano anual?', { status: 'aberta', resposta: undefined, vezes: 3 });
    const todas = await request(app).get('/gerador/ensaio/perguntas').set('Authorization', NILCE);
    expect(todas.status).toBe(200);
    expect(todas.body.socio).toBe(false);
    expect(todas.body.perguntas).toHaveLength(2);
    expect(todas.body.perguntas[0].id).toMatch(/^(solar|solardoc):[0-9a-f]{16}$/);
    // linha antiga que ainda leve o texto do lead: a rota não devolve
    banco.tabelas.system_state!.push({ key: chaveDaPergunta('solar', 'Linha antiga?'), updated_at: '2026-10-20T12:00:00Z', value: pergunta({
      pergunta: 'Linha antiga?', status: 'aberta', resposta: undefined, exemplos: [{ dia: '2026-10-19', hmac: HM, trecho: 'TEXTO-DO-LEAD', como_respondeu: 'Rodeio' }] as any,
    }) });
    const antiga = await request(app).get('/gerador/ensaio/perguntas?status=aberta').set('Authorization', THIAGO);
    expect(JSON.stringify(antiga.body)).not.toContain('TEXTO-DO-LEAD');
    expect(antiga.body.perguntas.find((p: any) => p.pergunta === 'Linha antiga?').exemplos[0]).toEqual({ dia: '2026-10-19', hmac: HM, como_respondeu: 'Rodeio' });
    const abertas = await request(app).get('/gerador/ensaio/perguntas?status=aberta').set('Authorization', THIAGO);
    expect(abertas.body.socio).toBe(true);
    expect(abertas.body.perguntas.map((p: any) => p.pergunta).sort()).toEqual(['Linha antiga?', 'Tem plano anual?']);
    expect(abertas.body.perguntas).toHaveLength(2);
    expect((await request(app).get('/gerador/ensaio/perguntas?status=xis').set('Authorization', THIAGO)).status).toBe(400);
    expect((await request(app).get('/gerador/ensaio/perguntas').set('Authorization', FORA)).status).toBe(403);
    expect((await request(app).get('/gerador/ensaio/perguntas')).status).toBe(401);
  });

  it('responder: quem não é sócio recebe 403 e nada é gravado', async () => {
    const chave = semear('solar', 'Qual o prazo?', { status: 'aberta', resposta: undefined });
    const res = await post(idDe(chave), 'responder', NILCE, { resposta: 'Uns 30 dias.' });
    expect(res.status).toBe(403);
    expect(res.body.precisa).toBe('socio');
    expect(linhaDe(chave)!.value.status).toBe('aberta');
    for (const acao of ['ignorar', 'reabrir']) expect((await post(idDe(chave), acao, NILCE)).status).toBe(403);
    expect(banco.escritas).toEqual([]);
  });

  it('responder recusa dinheiro, travessão, emoji e tamanho; id inválido e pergunta inexistente', async () => {
    const chave = semear('solar', 'Qual o prazo?', { status: 'aberta', resposta: undefined });
    for (const resposta of ['Sai por R$ 5 mil', 'Uns 30 dias — depende', 'Uns 30 dias \u{1F600}', 'ok', 'a'.repeat(401), 'O plano é 67 por mês']) {
      const res = await post(idDe(chave), 'responder', THIAGO, { resposta });
      expect(res.status, resposta.slice(0, 20)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    expect(linhaDe(chave)!.value.status).toBe('aberta');
    expect((await post('nada', 'responder', THIAGO, { resposta: 'Uns 30 dias.' })).status).toBe(400);
    expect((await post(`solar:${'0'.repeat(16)}`, 'responder', THIAGO, { resposta: 'Uns 30 dias.' })).status).toBe(404);
  });

  it('responder grava a resposta, quem respondeu e a hora; ignorar e reabrir tiram dela', async () => {
    const chave = semear('solar', 'Qual o prazo?', { status: 'aberta', resposta: undefined });
    const ok = await post(idDe(chave), 'responder', THIAGO, { resposta: '  Uns 30 dias\ncorridos.  ' });
    expect(ok.status).toBe(200);
    expect(linhaDe(chave)!.value).toMatchObject({ status: 'respondida', resposta: 'Uns 30 dias corridos.', respondida_por: 'thiago' });
    expect(typeof linhaDe(chave)!.value.respondida_em).toBe('string');
    // ignorar uma respondida não pode: reabrir antes
    expect((await post(idDe(chave), 'ignorar', THIAGO)).status).toBe(409);
    const re = await post(idDe(chave), 'reabrir', THIAGO);
    expect(re.status).toBe(200);
    const v = linhaDe(chave)!.value;
    expect(v.status).toBe('aberta');
    expect(v).not.toHaveProperty('resposta');
    expect(v).not.toHaveProperty('respondida_por');
    expect(v).not.toHaveProperty('respondida_em');
    expect((await post(idDe(chave), 'reabrir', THIAGO)).status).toBe(409);
    expect((await post(idDe(chave), 'ignorar', THIAGO)).status).toBe(200);
    expect(linhaDe(chave)!.value.status).toBe('ignorada');
    expect((await post(idDe(chave), 'reabrir', THIAGO)).status).toBe(200);
  });

  it('responder e reabrir mexem no que a agente vê, na hora (o cache da injeção é zerado)', async () => {
    const chave = semear('solar', 'Qual o prazo?', { status: 'aberta', resposta: undefined });
    expect(await blocoDeRespostasDoDono('duda')).toBeNull();
    await post(idDe(chave), 'responder', THIAGO, { resposta: 'Uns 30 dias corridos.' });
    expect(await blocoDeRespostasDoDono('duda')).toContain('Uns 30 dias corridos.');
    await post(idDe(chave), 'reabrir', THIAGO);
    expect(await blocoDeRespostasDoDono('duda')).toBeNull();
  });

  it('GET qualidade devolve o resumo e as notas do dia, pelo HMAC e sem telefone', async () => {
    banco.objetos.set(`qualidade/2026-10-20/${HM}.json`, JSON.stringify({ dia: '2026-10-20', hmac: HM, agente: 'duda', qualidade: 'boa', desfecho: 'sumiu', problemas: [] }));
    banco.objetos.set(`qualidade/2026-10-20/${'b'.repeat(64)}.json`, JSON.stringify({ dia: '2026-10-20', hmac: 'b'.repeat(64), agente: 'carla', qualidade: 'critica', desfecho: 'pagou', problemas: [] }));
    banco.objetos.set('qualidade/2026-10-20/_resumo.json', JSON.stringify({ dia: '2026-10-20', total: 2 }));
    const res = await request(app).get('/gerador/ensaio/qualidade?dia=2026-10-20').set('Authorization', NILCE);
    expect(res.status).toBe(200);
    expect(res.body.resumo).toEqual({ dia: '2026-10-20', total: 2 });
    expect(res.body.notas.map((n: any) => n.qualidade)).toEqual(['critica', 'boa']);   // a pior primeiro
    expect((await request(app).get('/gerador/ensaio/qualidade?dia=ontem').set('Authorization', NILCE)).status).toBe(400);
    expect((await request(app).get('/gerador/ensaio/qualidade?dia=2026-10-20').set('Authorization', FORA)).status).toBe(403);
    expect((await request(app).get('/gerador/ensaio/qualidade')).status).toBe(401);
    const semNota = await request(app).get('/gerador/ensaio/qualidade?dia=2026-10-19').set('Authorization', NILCE);
    expect(semNota.body).toMatchObject({ ok: true, resumo: null, notas: [] });
  });
});

describe('a injeção no conhecimento', () => {
  it('cada produto recebe só as suas respostas', async () => {
    semear('solar', 'Pergunta do solar?', { resposta: 'Resposta do solar.' });
    semear('solardoc', 'Pergunta do solardoc?', { resposta: 'Resposta do solardoc.' });
    semear('eletroposto', 'Pergunta do eletroposto?', { resposta: 'Resposta do eletroposto.' });
    semear('solar', 'Ainda aberta?', { status: 'aberta', resposta: undefined });
    semear('solar', 'Ignorada?', { status: 'ignorada', resposta: undefined });
    const duda = (await blocoDeRespostasDoDono('duda'))!;
    const carla = (await blocoDeRespostasDoDono('carla'))!;
    const helena = (await blocoDeRespostasDoDono('helena'))!;
    expect(duda).toContain('Resposta do solar.');
    expect(duda).not.toMatch(/solardoc|eletroposto|Ainda aberta|Ignorada/);
    expect(carla).toContain('Resposta do solardoc.');
    expect(carla).not.toMatch(/do solar\.|eletroposto/);
    expect(helena).toContain('Resposta do eletroposto.');
    expect(helena).not.toMatch(/do solar\.|solardoc/);
    expect(duda.startsWith(TITULO_DO_BLOCO)).toBe(true);
    expect(TITULO_DO_BLOCO).not.toMatch(/[—–]/);
  });

  it('o teto vale: no máximo 40 respostas e 6000 caracteres, as mais novas primeiro', () => {
    const muitas = Array.from({ length: 60 }, (_, i) => pergunta({
      pergunta: `Pergunta ${i}?`, resposta: `Resposta ${i}.`, respondida_em: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    const bloco = montarBlocoDeRespostas(muitas)!;
    expect(bloco.match(/- Pergunta:/g)).toHaveLength(MAX_RESPOSTAS_NO_BLOCO);
    expect(bloco).toContain('Pergunta 59?');          // a mais nova entra
    expect(bloco).not.toContain('Pergunta 0?');       // a mais antiga fica de fora
    const longas = Array.from({ length: 30 }, (_, i) => pergunta({
      pergunta: `P${i}?`, resposta: 'x'.repeat(390), respondida_em: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    const b2 = montarBlocoDeRespostas(longas)!;
    expect(b2.length).toBeLessThanOrEqual(MAX_CARACTERES_DO_BLOCO);
    expect(b2.match(/- Pergunta:/g)!.length).toBeLessThan(30);
    expect(b2).toContain('P29?');
    expect(montarBlocoDeRespostas([])).toBeNull();
    expect(montarBlocoDeRespostas([pergunta({ status: 'aberta', resposta: undefined })])).toBeNull();
  });

  it('cache de 60 segundos, com função de zerar', async () => {
    let lidas = 0;
    let agora = 1_000;
    const ler = async () => { lidas++; return [pergunta()]; };
    const opts = { ler, agora: () => agora };
    await blocoDeRespostasDoDono('duda', opts);
    await blocoDeRespostasDoDono('duda', opts);
    expect(lidas).toBe(1);
    agora += 61_000;
    await blocoDeRespostasDoDono('duda', opts);
    expect(lidas).toBe(2);
    zerarCacheRespostasDono();
    await blocoDeRespostasDoDono('duda', opts);
    expect(lidas).toBe(3);
  });

  it('turnos simultâneos dividem uma leitura só', async () => {
    let lidas = 0;
    const ler = async () => { lidas++; await new Promise(r => setTimeout(r, 20)); return [pergunta()]; };
    const todos = await Promise.all([1, 2, 3, 4].map(() => blocoDeRespostasDoDono('duda', { ler })));
    expect(lidas).toBe(1);
    for (const b of todos) expect(b).toContain('garantia');
  });

  it('leitura lenta cai em "sem bloco" no prazo e o cache vazio vale 30 s, sem martelar o banco', async () => {
    let lidas = 0;
    let agora = 1_000;
    const ler = () => { lidas++; return new Promise<Pergunta[]>(() => {}); };   // nunca responde
    const opts = { ler, agora: () => agora, esperaMs: 30 };
    const t0 = Date.now();
    expect(await blocoDeRespostasDoDono('duda', opts)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(lidas).toBe(1);
    // dentro dos 30 s não consulta de novo
    agora += 29_000;
    expect(await blocoDeRespostasDoDono('duda', opts)).toBeNull();
    expect(lidas).toBe(1);
    // passados 30 s, tenta de novo
    agora += 2_000;
    expect(await blocoDeRespostasDoDono('duda', opts)).toBeNull();
    expect(lidas).toBe(2);
  });

  it('erro de leitura também guarda o cache vazio por 30 s', async () => {
    let lidas = 0;
    let agora = 1_000;
    const ler = async (): Promise<Pergunta[]> => { lidas++; throw new Error('banco fora'); };
    const opts = { ler, agora: () => agora };
    expect(await blocoDeRespostasDoDono('carla', opts)).toBeNull();
    agora += 29_000;
    expect(await blocoDeRespostasDoDono('carla', opts)).toBeNull();
    expect(lidas).toBe(1);
  });

  it('leitura com erro não quebra: a agente segue sem o bloco', async () => {
    expect(await blocoDeRespostasDoDono('duda', { ler: async () => { throw new Error('banco fora'); } })).toBeNull();
    banco.falhar.system_state = { code: 'XX000' };
    expect(await blocoDeRespostasDoDono('carla')).toBeNull();
  });

  it('RESPOSTAS_DONO desligado tira o bloco (env e chave do banco)', async () => {
    semear('solar', 'Qual a garantia?');
    expect(await blocoDeRespostasDoDono('duda')).toContain('garantia');
    process.env.AGENTES5040_RESPOSTAS_DONO = '0';
    zerarCacheRespostasDono();
    expect(await blocoDeRespostasDoDono('duda')).toBeNull();
    delete process.env.AGENTES5040_RESPOSTAS_DONO;
    zerarCacheInterruptores(); zerarCacheRespostasDono();
    banco.tabelas.system_state!.push({ key: 'ag5040_interruptores', value: { respostas_dono: false }, updated_at: AGORA.toISOString() });
    expect(await blocoDeRespostasDoDono('duda')).toBeNull();
  });

  const persona: PersonaDef = { persona: 'duda', sistemaFixo: 'SISTEMA FIXO DE TESTE', fatos: () => 'FATO', acoes: ['continuar'] };
  const dadoBom = JSON.stringify({ bolhas: ['Oi, tudo bem?'], acao: 'continuar', peca: null, dados: [], resumo: 'r', sabe_contexto: true });

  it('o bloco vai SEPARADO, depois do sistemaFixo, sem cache_control; sem bloco o system fica como era', async () => {
    const ia = iaFalsa(() => respostaIA(dadoBom));
    await perguntarAgente({ persona, pedido: 'p', cliente: ia.cliente, sistemaExtra: 'BLOCO DO DONO' });
    const s = ia.chamadas[0]!.body.system;
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ type: 'text', text: 'SISTEMA FIXO DE TESTE', cache_control: { type: 'ephemeral', ttl: '1h' } });
    expect(s[1]).toEqual({ type: 'text', text: 'BLOCO DO DONO' });
    const sem = iaFalsa(() => respostaIA(dadoBom));
    await perguntarAgente({ persona, pedido: 'p', cliente: sem.cliente, sistemaExtra: null });
    expect(sem.chamadas[0]!.body.system).toHaveLength(1);
  });

  const base = (msgs: ReturnType<typeof msg>[]): ContextoLead => ({
    chave: '3491112222', nome: 'Tadeu', msgs, completa: true, card: null, leadsMeta: null, cadastros: [],
    ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: AGORA.toISOString(),
  });

  it('pensarTurno injeta só as respostas do produto da persona, depois do sistemaFixo', async () => {
    semear('solar', 'Qual a garantia do solar?', { resposta: 'Garantia de fábrica do solar.' });
    semear('solardoc', 'Qual o prazo do solardoc?', { resposta: 'Prazo do solardoc.' });
    const msgs = [msg('lead', 'Oi, quero energia solar')];
    const ia = iaFalsa(() => respostaIA(saidaJson(['Oi, aqui é a Duda. Onde você mora?'])));
    await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    const s = ia.chamadas[0]!.body.system;
    expect(s).toHaveLength(2);
    expect(s[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(s[1].cache_control).toBeUndefined();
    expect(s[1].text).toContain('Garantia de fábrica do solar.');
    expect(s[1].text).not.toContain('solardoc');
    expect(s[0].text).not.toContain('Garantia de fábrica do solar.');
    // a Carla nunca recebe resposta de solar
    const ia2 = iaFalsa(() => respostaIA(saidaJson(['Oi! Você já usa o SolarDoc?'])));
    await pensarTurno({ persona: 'carla', ctx: base([msg('lead', 'Oi, vi o anúncio do SolarDoc')]), novas: [msg('lead', 'Oi, vi o anúncio do SolarDoc')], dadosAnteriores: {}, abertura: false, cliente: ia2.cliente, cacheMidia: new Map() });
    const t = JSON.stringify(ia2.chamadas[0]!.body.system);
    expect(t).toContain('Prazo do solardoc.');
    expect(t).not.toContain('Garantia de fábrica do solar.');
  });

  it('pensarTurno: a Helena recebe só as respostas do eletroposto, e a Carla e a Duda não as veem', async () => {
    semear('eletroposto', 'Qual a potência do carregador?', { resposta: 'O carregador entrega energia de acordo com o padrão do ponto.' });
    semear('solar', 'Qual a garantia do solar?', { resposta: 'Garantia de fábrica do solar.' });
    const msgs = [msg('lead', 'Oi, quero saber do eletroposto')];
    const ia = iaFalsa(() => respostaIA(saidaJson(['Oi, aqui é a Helena. O ponto é seu?'])));
    await pensarTurno({ persona: 'helena', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    const s = ia.chamadas[0]!.body.system;
    expect(s).toHaveLength(2);
    expect(s[1].text.startsWith(TITULO_DO_BLOCO)).toBe(true);
    expect(s[1].text).toContain('padrão do ponto');
    expect(s[1].text).not.toContain('solar');
  });

  it('pensarTurno com RESPOSTAS_DONO desligado: o modelo recebe só o sistemaFixo', async () => {
    semear('solar', 'Qual a garantia do solar?', { resposta: 'Garantia de fábrica do solar.' });
    const msgs = [msg('lead', 'Oi, quero energia solar')];
    const rodar = async () => {
      const ia = iaFalsa(() => respostaIA(saidaJson(['Oi, aqui é a Duda. Onde você mora?'])));
      await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
      return ia.chamadas[0]!.body.system as Array<{ text: string }>;
    };
    expect(await rodar()).toHaveLength(2);
    process.env.AGENTES5040_RESPOSTAS_DONO = '0';
    zerarCacheRespostasDono(); zerarCacheInterruptores();
    const desligado = await rodar();
    expect(desligado).toHaveLength(1);
    expect(JSON.stringify(desligado)).not.toContain('Garantia de fábrica do solar.');
    // pela chave do banco também
    delete process.env.AGENTES5040_RESPOSTAS_DONO;
    zerarCacheRespostasDono(); zerarCacheInterruptores();
    banco.tabelas.system_state!.push({ key: 'ag5040_interruptores', value: { respostas_dono: false }, updated_at: AGORA.toISOString() });
    expect(await rodar()).toHaveLength(1);
  });

  it('com a leitura quebrada o turno sai normal, sem o bloco', async () => {
    semear('solar', 'Qual a garantia do solar?', { resposta: 'Garantia de fábrica do solar.' });
    banco.falhar.system_state = { code: 'XX000' };
    const msgs = [msg('lead', 'Oi, quero energia solar')];
    const ia = iaFalsa(() => respostaIA(saidaJson(['Oi, aqui é a Duda. Onde você mora?'])));
    const r = await pensarTurno({ persona: 'duda', ctx: base(msgs), novas: msgs, dadosAnteriores: {}, abertura: false, cliente: ia.cliente, cacheMidia: new Map() });
    expect(r.pensamento.falou).toBe(true);
    expect(ia.chamadas[0]!.body.system).toHaveLength(1);
  });
});

describe('os interruptores novos', () => {
  it('QUALIDADE e RESPOSTAS_DONO existem e nascem LIGADOS; os outros seguem desligados', async () => {
    expect(NOMES_INTERRUPTORES).toContain('qualidade');
    expect(NOMES_INTERRUPTORES).toContain('respostas_dono');
    expect(await ligado('qualidade')).toBe(true);
    expect(await ligado('respostas_dono')).toBe(true);
    expect(await ligado('ensaio')).toBe(false);
    expect(await ligado('duda_vivo')).toBe(false);
  });

  it('a env e a chave do banco mandam por cima do padrão', async () => {
    expect(await ligado('qualidade', { env: { AGENTES5040_QUALIDADE: '0' } })).toBe(false);
    expect(await ligado('respostas_dono', { ler: async () => ({ respostas_dono: false }) })).toBe(false);
    zerarCacheInterruptores();
    expect(await ligado('qualidade', { ler: async () => ({ qualidade: false }) })).toBe(false);
    zerarCacheInterruptores();
    // erro de leitura do banco: cai no padrão do nome
    expect(await ligado('qualidade', { ler: async () => { throw new Error('banco'); } })).toBe(true);
    zerarCacheInterruptores();
    expect(await ligado('ensaio', { ler: async () => { throw new Error('banco'); } })).toBe(false);
  });

  it('o hmac do teste é de verdade (controle)', () => { expect(hmacDe('3491112222')).toMatch(/^[0-9a-f]{64}$/); });
});
