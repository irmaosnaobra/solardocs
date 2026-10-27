import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Fila de ligação do quiz do SolarDoc (27/10/2026): a cadência pura, o registro com bancos falsos e a rota (login e validação).
// Referência de calendário: 26/10/2026 é segunda-feira; 24/10 sábado; 25/10 domingo; 23/10 sexta.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  chamadas: [] as unknown[][],
  falha: null as null | 'nao_encontrado' | 'sem_telefone' | 'historico_vazio' | 'banco',
  /** true = registrarFollowup de verdade (testes do serviço); false = simulado (testes da rota). */
  real: true,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => { throw new Error('sem banco'); } } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: () => { throw new Error('sem banco'); },
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
vi.mock('../services/solardoc/statusLeadsQuiz', () => ({ statusLeadsQuiz: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/solardoc/followupQuizSolardoc', async (orig) => {
  const real = await orig<typeof import('../services/solardoc/followupQuizSolardoc')>();
  return {
    ...real,
    registrarFollowup: vi.fn(async (...a: unknown[]) => {
      if (h.real) return (real.registrarFollowup as (...x: unknown[]) => unknown)(...a);
      h.chamadas.push(a);
      if (h.falha === 'banco') throw new Error('connection refused postgres://user:segredo@db');
      if (h.falha) throw new real.FollowupErro(h.falha, `erro ${h.falha}`);
      return { estado: 'nao_atendeu', tentativas: 1, proximo: '2026-10-27', devido: false, aberto: true, ultima: null };
    }),
  };
});

import { mountSolardocQuizStatus } from '../routes/geradorSolardocQuiz';
import {
  estadoDoFollowup, aplicarAcao, registrarFollowup, histDoValor, hmacDoWhatsapp, dataBRT, FORM_ID_FOLLOWUP, PREFIXO_FOLLOWUP, MAX_HIST,
  FollowupErro, type EntradaFollowup, type DepsFollowup,
} from '../services/solardoc/followupQuizSolardoc';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';

const reg = (acao: EntradaFollowup['acao'], em: string, por = 'giovanna'): EntradaFollowup => ({ acao, em, por });
const estado = (hist: EntradaFollowup[], agora: string, criadoEm = '2026-10-26T12:00:00.000Z', comprou = false) =>
  estadoDoFollowup({ hist, criadoEm, comprou, agora: new Date(agora) });

describe('estadoDoFollowup: lead novo', () => {
  it('sem histórico: novo, próximo = dia do cadastro em BRT, aberto', () => {
    const e = estado([], '2026-10-26T18:00:00.000Z', '2026-10-26T12:00:00.000Z');
    expect(e).toEqual({ estado: 'novo', tentativas: 0, proximo: '2026-10-26', devido: true, aberto: true, ultima: null });
  });
  it('só fica devido 15 min depois do cadastro', () => {
    const criado = '2026-10-26T15:00:00.000Z';
    expect(estado([], '2026-10-26T15:14:59.000Z', criado).devido).toBe(false);
    expect(estado([], '2026-10-26T15:15:00.000Z', criado).devido).toBe(true);
    expect(estado([], '2026-10-26T15:14:59.000Z', criado)).toMatchObject({ estado: 'novo', aberto: true, proximo: '2026-10-26' });
  });
  it('virada do dia: 02h30 UTC ainda é 23h30 do dia anterior em BRT', () => {
    expect(dataBRT(Date.parse('2026-10-27T02:30:00.000Z'))).toBe('2026-10-26');
    expect(dataBRT(Date.parse('2026-10-27T03:00:00.000Z'))).toBe('2026-10-27');
    // lead que chegou às 23h30 BRT de segunda: o dia dele é segunda, e terça de manhã já é devido
    expect(estado([], '2026-10-27T10:00:00.000Z', '2026-10-27T02:30:00.000Z')).toMatchObject({ proximo: '2026-10-26', devido: true });
    // não atendeu às 23h30 BRT de segunda: volta TERÇA (+1 dia), não quarta
    const e = estado([reg('nao_atendeu', '2026-10-27T02:30:00.000Z')], '2026-10-27T10:00:00.000Z');
    expect(e.proximo).toBe('2026-10-27');
    expect(e.devido).toBe(true);
  });
  it('lead que chegou no domingo vai para a segunda', () => {
    const criado = '2026-10-25T15:00:00.000Z';   // domingo 12h BRT
    expect(estado([], '2026-10-25T20:00:00.000Z', criado)).toMatchObject({ proximo: '2026-10-26', devido: false });
    expect(estado([], '2026-10-26T12:00:00.000Z', criado)).toMatchObject({ proximo: '2026-10-26', devido: true });
  });
  it('criadoEm ilegível: aberto, mas nunca devido', () => {
    const e = estadoDoFollowup({ hist: [], criadoEm: 'lixo', comprou: false, agora: new Date('2026-10-26T18:00:00.000Z') });
    expect(e).toMatchObject({ estado: 'novo', aberto: true, devido: false, proximo: null });
  });
});

describe('estadoDoFollowup: cadência', () => {
  it('1 não atendeu: +1 dia; devido só a partir dele', () => {
    const hist = [reg('nao_atendeu', '2026-10-26T14:00:00.000Z')];
    expect(estado(hist, '2026-10-26T22:00:00.000Z')).toMatchObject({ estado: 'nao_atendeu', tentativas: 1, proximo: '2026-10-27', devido: false, aberto: true });
    expect(estado(hist, '2026-10-27T11:00:00.000Z').devido).toBe(true);
    expect(estado(hist, '2026-10-27T11:00:00.000Z').ultima).toEqual(hist[0]);
  });
  it('2 não atendeu: +2 dias da última', () => {
    const hist = [reg('nao_atendeu', '2026-10-26T14:00:00.000Z'), reg('nao_atendeu', '2026-10-27T14:00:00.000Z')];
    expect(estado(hist, '2026-10-28T20:00:00.000Z')).toMatchObject({ estado: 'nao_atendeu', tentativas: 2, proximo: '2026-10-29', devido: false });
    expect(estado(hist, '2026-10-29T12:00:00.000Z').devido).toBe(true);
  });
  it('3 não atendeu seguidos: sem_resposta, fechado', () => {
    const hist = [reg('nao_atendeu', '2026-10-26T14:00:00.000Z'), reg('nao_atendeu', '2026-10-27T14:00:00.000Z'), reg('nao_atendeu', '2026-10-29T14:00:00.000Z')];
    expect(estado(hist, '2026-11-20T12:00:00.000Z')).toEqual({ estado: 'sem_resposta', tentativas: 3, proximo: null, devido: false, aberto: false, ultima: hist[2] });
  });
  it('falou no meio zera a conta das tentativas', () => {
    const hist = [reg('nao_atendeu', '2026-10-20T14:00:00.000Z'), reg('nao_atendeu', '2026-10-21T14:00:00.000Z'), reg('falou', '2026-10-22T14:00:00.000Z'), reg('nao_atendeu', '2026-10-26T14:00:00.000Z')];
    expect(estado(hist, '2026-10-26T20:00:00.000Z')).toMatchObject({ estado: 'nao_atendeu', tentativas: 1, proximo: '2026-10-27' });
  });
  it('falou: em_conversa, volta em +2 dias', () => {
    const hist = [reg('falou', '2026-10-26T14:00:00.000Z')];
    expect(estado(hist, '2026-10-27T20:00:00.000Z')).toMatchObject({ estado: 'em_conversa', tentativas: 0, proximo: '2026-10-28', devido: false, aberto: true });
    expect(estado(hist, '2026-10-28T12:00:00.000Z').devido).toBe(true);
  });
  it('sem_interesse (última ação) fecha, mesmo depois de outras ações', () => {
    const hist = [reg('falou', '2026-10-26T14:00:00.000Z'), reg('sem_interesse', '2026-10-27T14:00:00.000Z')];
    expect(estado(hist, '2026-11-20T12:00:00.000Z')).toEqual({ estado: 'sem_interesse', tentativas: 0, proximo: null, devido: false, aberto: false, ultima: hist[1] });
  });
  it('quem fechou e foi reaberto com "falou" volta a ser conversa', () => {
    const hist = [reg('sem_interesse', '2026-10-26T14:00:00.000Z'), reg('falou', '2026-10-27T14:00:00.000Z')];
    expect(estado(hist, '2026-10-27T20:00:00.000Z').estado).toBe('em_conversa');
  });
  it('comprou fecha sempre, seja qual for o histórico', () => {
    for (const hist of [[], [reg('nao_atendeu', '2026-10-26T14:00:00.000Z')], [reg('falou', '2026-10-26T14:00:00.000Z')], [reg('sem_interesse', '2026-10-26T14:00:00.000Z')]]) {
      expect(estado(hist, '2026-11-20T12:00:00.000Z', '2026-10-26T12:00:00.000Z', true)).toMatchObject({ estado: 'comprou', proximo: null, devido: false, aberto: false });
    }
  });
  it('domingo vai para a segunda', () => {
    // não atendeu no sábado 24/10: +1 = domingo 25 -> segunda 26
    const sab = [reg('nao_atendeu', '2026-10-24T15:00:00.000Z')];
    expect(estado(sab, '2026-10-24T20:00:00.000Z', '2026-10-20T12:00:00.000Z').proximo).toBe('2026-10-26');
    expect(estado(sab, '2026-10-25T20:00:00.000Z', '2026-10-20T12:00:00.000Z').devido).toBe(false);   // domingo: não
    expect(estado(sab, '2026-10-26T11:00:00.000Z', '2026-10-20T12:00:00.000Z').devido).toBe(true);
    // falou na sexta 23/10: +2 = domingo 25 -> segunda 26
    expect(estado([reg('falou', '2026-10-23T15:00:00.000Z')], '2026-10-24T20:00:00.000Z', '2026-10-20T12:00:00.000Z').proximo).toBe('2026-10-26');
  });
  it('histórico com lixo é ignorado em vez de quebrar', () => {
    const lixo = [{ acao: 'xpto', em: '2026-10-26T14:00:00.000Z', por: 'a' }, { acao: 'falou', em: 'não é data', por: 'a' }, null] as unknown as EntradaFollowup[];
    expect(estado(lixo, '2026-10-26T18:00:00.000Z')).toMatchObject({ estado: 'novo', ultima: null });
  });
});

describe('aplicarAcao', () => {
  const agora = new Date('2026-10-26T15:00:00.000Z');
  it('acrescenta a entrada com ISO e o nome, sem mexer no original', () => {
    const base: EntradaFollowup[] = [];
    const novo = aplicarAcao(base, 'nao_atendeu', 'nilce', agora);
    expect(novo).toEqual([{ acao: 'nao_atendeu', em: '2026-10-26T15:00:00.000Z', por: 'nilce' }]);
    expect(base).toEqual([]);
  });
  it('guarda só as últimas 30', () => {
    let hist: EntradaFollowup[] = [];
    for (let i = 0; i < 35; i++) hist = aplicarAcao(hist, 'nao_atendeu', `p${i}`, new Date(agora.getTime() + i * 60_000));
    expect(hist).toHaveLength(MAX_HIST);
    expect(hist[0]!.por).toBe('p5');
    expect(hist[29]!.por).toBe('p34');
  });
  it('desfazer tira a última entrada', () => {
    const hist = [reg('nao_atendeu', '2026-10-25T10:00:00.000Z'), reg('falou', '2026-10-26T10:00:00.000Z')];
    expect(aplicarAcao(hist, 'desfazer', 'x', agora)).toEqual([hist[0]]);
    expect(hist).toHaveLength(2);
  });
  it('desfazer com histórico vazio dá erro', () => {
    expect(() => aplicarAcao([], 'desfazer', 'x', agora)).toThrow(FollowupErro);
    try { aplicarAcao([], 'desfazer', 'x', agora); } catch (e) { expect((e as FollowupErro).codigo).toBe('historico_vazio'); }
  });
  it('ação desconhecida dá erro', () => {
    for (const a of ['', 'ligou', 'FALOU', 'comprou']) {
      expect(() => aplicarAcao([], a, 'x', agora)).toThrow(FollowupErro);
    }
  });
  it('histDoValor lê só o formato { v, hist }', () => {
    expect(histDoValor(null)).toEqual([]);
    expect(histDoValor({ hist: 'x' })).toEqual([]);
    expect(histDoValor({ v: 1, hist: [reg('falou', '2026-10-26T10:00:00.000Z')] })).toHaveLength(1);
  });
});

describe('registrarFollowup (bancos falsos)', () => {
  const AGORA = new Date('2026-10-26T15:00:00.000Z');
  function deps(o: { lead?: { whatsapp: string | null; created_time: string | null } | null; valor?: unknown; hmac?: string | null } = {}) {
    const gravados: Array<{ chave: string; valor: unknown; em: string }> = [];
    const d: DepsFollowup = {
      lerLead: vi.fn(async () => (o.lead === undefined ? { whatsapp: '5534999998888', created_time: '2026-10-26T12:00:00.000Z' } : o.lead)),
      lerValor: vi.fn(async () => o.valor ?? null),
      gravar: vi.fn(async (chave, valor, em) => { gravados.push({ chave, valor, em }); }),
      hmac: () => (o.hmac === undefined ? 'abc123' : o.hmac),
      agora: () => AGORA,
    };
    return { d, gravados };
  }
  it('grava em quiz_followup:<hmac> com { v:1, hist } e devolve o estado (comprou falso)', async () => {
    const { d, gravados } = deps();
    const e = await registrarFollowup('sdquiz_3499998888', 'nao_atendeu', 'nilce', d);
    expect(gravados).toEqual([{ chave: 'quiz_followup:abc123', valor: { v: 1, hist: [{ acao: 'nao_atendeu', em: AGORA.toISOString(), por: 'nilce' }] }, em: AGORA.toISOString() }]);
    expect(e).toMatchObject({ estado: 'nao_atendeu', tentativas: 1, proximo: '2026-10-27', devido: false, aberto: true });
  });
  it('soma ao histórico que já existe e desfazer volta atrás', async () => {
    const antes = { v: 1, hist: [reg('nao_atendeu', '2026-10-25T10:00:00.000Z')] };
    const a = deps({ valor: antes });
    await registrarFollowup('sdquiz_3499998888', 'falou', 'giovanna', a.d);
    expect((a.gravados[0]!.valor as { hist: unknown[] }).hist).toHaveLength(2);
    const b = deps({ valor: antes });
    const e = await registrarFollowup('sdquiz_3499998888', 'desfazer', 'giovanna', b.d);
    expect((b.gravados[0]!.valor as { hist: unknown[] }).hist).toEqual([]);
    expect(e.estado).toBe('novo');
  });
  it('lead que não existe: nao_encontrado e nada gravado', async () => {
    const { d, gravados } = deps({ lead: null });
    await expect(registrarFollowup('sdquiz_3499998888', 'falou', 'x', d)).rejects.toMatchObject({ codigo: 'nao_encontrado' });
    expect(gravados).toEqual([]);
  });
  it('lead sem telefone válido (sem hmac): sem_telefone e nada gravado', async () => {
    const { d, gravados } = deps({ hmac: null });
    await expect(registrarFollowup('sdquiz_3499998888', 'falou', 'x', d)).rejects.toMatchObject({ codigo: 'sem_telefone' });
    expect(gravados).toEqual([]);
  });
  it('ação inválida e desfazer sem histórico: erro antes de gravar', async () => {
    const { d, gravados } = deps();
    await expect(registrarFollowup('sdquiz_3499998888', 'ligou', 'x', d)).rejects.toMatchObject({ codigo: 'acao_invalida' });
    await expect(registrarFollowup('sdquiz_3499998888', 'desfazer', 'x', d)).rejects.toMatchObject({ codigo: 'historico_vazio' });
    expect(gravados).toEqual([]);
  });
  it('o hmac é o mesmo das outras chaves (hmacDe da chave do telefone)', () => {
    process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste'; delete process.env.AGENTES5040_HMAC;
    const tel = normalizarTelefoneSd('34999998888') as string;
    expect(hmacDoWhatsapp('34999998888')).toBe(hmacDe(chaveDoTelefone(tel)));
    expect(hmacDoWhatsapp('123')).toBeNull();
    expect(PREFIXO_FOLLOWUP).toBe('quiz_followup:');
  });
});

describe('estrutura: cada tabela no seu banco', () => {
  const fonte = readFileSync(join(__dirname, '..', 'services', 'solardoc', 'followupQuizSolardoc.ts'), 'utf8');
  it('zero leads_meta no cliente principal e zero system_state no cliente do Gerador', () => {
    expect(fonte).not.toMatch(/\bsupabase\s*\.from\(\s*['"`]leads_meta['"`]/);
    expect(fonte).not.toMatch(/supabaseGerador\s*\.from\(\s*['"`]system_state['"`]/);
    expect(fonte).toMatch(/supabaseGerador\s*\.from\(\s*['"`]leads_meta['"`]/);
    expect(fonte).toMatch(/\bsupabase\s*\.from\(\s*['"`]system_state['"`]/);
  });
  it('o form_id é o mesmo do statusLeadsQuiz e a chave não usa os prefixos que outros códigos varrem', () => {
    const status = readFileSync(join(__dirname, '..', 'services', 'solardoc', 'statusLeadsQuiz.ts'), 'utf8');
    expect(status).toContain(`FORM_ID_QUIZ_SD = '${FORM_ID_FOLLOWUP}'`);
    expect(PREFIXO_FOLLOWUP).not.toMatch(/^(quiz_aviso|quiz_rec_)/);
  });
});

describe('POST /gerador/solardoc/quiz-followup', () => {
  const URL = '/gerador/solardoc/quiz-followup';
  function app() {
    const router = Router();
    mountSolardocQuizStatus(router);
    const a = express();
    a.use(express.json());
    a.use('/gerador', router);
    return a;
  }
  beforeEach(() => {
    h.usuarios = { 'tok-nilce': 'nilce@irmaosnaobra.app', 'tok-fora': 'alguem@gmail.com' };
    h.chamadas = []; h.falha = null; h.real = false;
  });
  const corpo = { lead_id: 'sdquiz_3499998888', acao: 'nao_atendeu' };

  it('sem login, com chave publishable, token inválido e conta de fora: 401/401/401/403 e nada gravado', async () => {
    expect((await request(app()).post(URL).send(corpo)).status).toBe(401);
    expect((await request(app()).post(URL).set('Authorization', 'Bearer sb_publishable_abc').send(corpo)).status).toBe(401);
    expect((await request(app()).post(URL).set('Authorization', 'Bearer qualquer').send(corpo)).status).toBe(401);
    expect((await request(app()).post(URL).set('Authorization', 'Bearer tok-fora').send(corpo)).status).toBe(403);
    expect(h.chamadas).toHaveLength(0);
  });
  it('consultor logado: 200 { ok, followup }, sem cache, e o "por" é o nome da sessão', async () => {
    const r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send(corpo);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.followup).toMatchObject({ estado: 'nao_atendeu', tentativas: 1 });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(h.chamadas).toEqual([['sdquiz_3499998888', 'nao_atendeu', 'nilce']]);
  });
  it('desfazer é aceito (lead de 11 dígitos também)', async () => {
    const r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send({ lead_id: 'sdquiz_34999988887', acao: 'desfazer' });
    expect(r.status).toBe(200);
  });
  it('lead_id inválido: 400 { ok:false, erro } e nada gravado', async () => {
    for (const lead_id of ['', 'sdquiz_123', 'sdquiz_349999888877', 'quiz_3499998888', 'sdquiz_34999988ab', ' sdquiz_3499998888', 3499998888, null, { a: 1 }]) {
      const r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send({ lead_id, acao: 'falou' });
      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(typeof r.body.erro).toBe('string');
    }
    expect(h.chamadas).toHaveLength(0);
  });
  it('ação inválida ou corpo vazio: 400', async () => {
    for (const acao of ['', 'ligou', 'comprou', 'FALOU', 1, null, ['falou']]) {
      const r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send({ lead_id: 'sdquiz_3499998888', acao });
      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
    }
    expect((await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send({})).status).toBe(400);
    expect(h.chamadas).toHaveLength(0);
  });
  it('telefone e hmac do corpo são ignorados: o serviço só recebe lead_id, ação e o nome da sessão', async () => {
    await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send({ ...corpo, whatsapp: '5511999990000', hmac: 'zzz', por: 'outro' });
    expect(h.chamadas).toEqual([['sdquiz_3499998888', 'nao_atendeu', 'nilce']]);
  });
  it('lead que não existe: 404; sem telefone: 422; desfazer sem histórico: 400', async () => {
    h.falha = 'nao_encontrado';
    let r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send(corpo);
    expect(r.status).toBe(404); expect(r.body.ok).toBe(false);
    h.falha = 'sem_telefone';
    r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send(corpo);
    expect(r.status).toBe(422);
    h.falha = 'historico_vazio';
    r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send({ lead_id: 'sdquiz_3499998888', acao: 'desfazer' });
    expect(r.status).toBe(400);
  });
  it('banco que falha: 502 sem vazar o erro', async () => {
    h.falha = 'banco';
    const r = await request(app()).post(URL).set('Authorization', 'Bearer tok-nilce').send(corpo);
    expect(r.status).toBe(502);
    expect(r.body.ok).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|segredo/);
  });
});
