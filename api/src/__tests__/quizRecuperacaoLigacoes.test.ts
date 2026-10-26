import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { prefixosTotalDaLinha, prefixosDaLinha, PREFIXOS_AGENDA } from '../services/agents/whatsapp/lineThrottle';
import { CLASSE_POR_ROBO } from '../services/chefe/classes';
import { CATALOGO, estadoDaRegra, type ChavesDoBanco } from '../services/io/centralAgentesCatalogo';
import { fatosCarla, fatosDoQuiz } from '../services/agentes5040/personas/carla';
import { contextoDoQuiz } from '../services/solardoc/quizContexto';
import type { ContextoLead } from '../services/agentes5040/tipos';

// Ligações do B2: ordem no cron, registro do robô, contexto da Carla.

const lerFonte = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('routes/cron.ts: a ordem dos ticks do SolarDoc', () => {
  const fonte = lerFonte('routes/cron.ts');
  it('o tick de desistência (B1) roda ANTES do robô da Carla, os dois depois do allSettled', () => {
    const tarefas = fonte.indexOf('Promise.allSettled(TAREFAS.map');
    const b1 = fonte.indexOf('await runSolardocQuizDesistenciaTick()', tarefas);
    const robo = fonte.indexOf('await runQuizRecuperacaoTick()', tarefas);
    expect(tarefas).toBeGreaterThan(0);
    expect(b1).toBeGreaterThan(tarefas);
    expect(robo).toBeGreaterThan(b1);
    expect(fonte).toContain("resultados['quiz_recuperacao_carla']");
  });
  it('o robô não está na lista TAREFAS (que roda toda junta)', () => {
    expect(fonte).not.toMatch(/\['quiz_recuperacao_carla',\s*\(\)\s*=>/);
  });
});

describe('o robô quiz_recuperacao_5040 nos registros', () => {
  it('classe frio_receita_p4, carimbo frio quiz_rec_sent:, arquivo próprio', () => {
    const r = CLASSE_POR_ROBO.quiz_recuperacao_5040!;
    expect(r.classe).toBe('frio_receita_p4');
    expect(r.arquivos).toEqual(['services/solardoc/recuperacaoCarla.ts']);
    expect(r.carimbos).toEqual([{ prefixo: 'quiz_rec_sent:', contaHoje: 'frio' }]);
    expect(r.maxBolhas).toBe(1);
    expect(r.respeitaPausa).toBe(true);
  });
  it('o carimbo conta na linha e no frio: está em BOT_SENT_PREFIXES e fora de PREFIXOS_AGENDA', () => {
    expect(prefixosDaLinha()).toContain('quiz_rec_sent:');
    expect(prefixosTotalDaLinha()).toContain('quiz_rec_sent:');
    expect((PREFIXOS_AGENDA as readonly string[]).includes('quiz_rec_sent:')).toBe(false);
  });
  it('a vez de 10 min (quiz_rec_vez:) NÃO é carimbo de envio', () => {
    expect(prefixosTotalDaLinha().some(p => 'quiz_rec_vez:'.startsWith(p))).toBe(false);
  });
  it('o catálogo da Central: nasce ligada; a env 0 desliga; a chave do banco pausa; leitura que falha pausa', () => {
    const card = CATALOGO.find(c => c.robos.includes('quiz_recuperacao_5040'))!;
    const banco = (extra: Partial<ChavesDoBanco> = {}): ChavesDoBanco => ({ recepcaoAtiva: false, helenaOff: false, quizRecPausa: false, ...extra });
    expect(estadoDaRegra(card.regra, {}, banco()).selo).toBe('ligado');
    expect(estadoDaRegra(card.regra, { QUIZ_RECUPERACAO_LIGADA: '0' }, banco()).selo).toBe('desligado');
    expect(estadoDaRegra(card.regra, { QUIZ_RECUPERACAO_LIGADA: '1' }, banco()).selo).toBe('ligado');
    expect(estadoDaRegra(card.regra, {}, banco({ quizRecPausa: true })).selo).toBe('pausado');
    expect(estadoDaRegra(card.regra, {}, banco({ quizRecPausa: null })).selo).toBe('pausado');
  });
});

const ctx = (quizSolardoc: ContextoLead['quizSolardoc']): ContextoLead => ({
  chave: '3499998888', nome: 'Carlos', msgs: [], completa: true, card: null, leadsMeta: null, quizSolardoc, cadastros: [],
  ehClienteSolarDoc: false, anuncio: null, qualificado: false, agora: '2026-10-21T17:00:00.000Z',
});

describe('o contexto do quiz para a Carla', () => {
  const linha = {
    form_id: 'quiz_solardoc', cidade: 'Uberlândia-MG',
    field_data: [
      { name: 'Código', values: ['SD-AB23'] }, { name: 'Índice', values: ['37'] }, { name: 'Perfil nome', values: ['Proposta no braço'] },
      { name: 'propostas_mes', values: ['6a15'] }, { name: 'como_faz_hoje', values: ['planilha'] }, { name: 'tempo_por_proposta', values: ['t60'] },
      { name: 'objecao', values: ['preco'] }, { name: 'quando_comecar', values: ['semana'] }, { name: 'cnpj', values: ['sim'] },
    ],
  };
  it('traz código, índice, perfil, propostas, como faz hoje, tempo, cidade, objeção e quando quer começar', () => {
    const q = contextoDoQuiz(linha)!;
    expect(q).toEqual({
      codigo: 'SD-AB23', indice: '37', perfil: 'Proposta no braço', propostas_mes: 'de 6 a 15', como_faz_hoje: 'numa planilha',
      tempo_por_proposta: 'de 30 minutos a 1 hora', cidade: 'Uberlândia-MG', objecao: 'o preço', quando_comecar: 'esta semana',
    });
    const t = fatosCarla(ctx(q));
    for (const parte of ['SD-AB23', '37 de 100', 'Proposta no braço', 'de 6 a 15', 'numa planilha', 'de 30 minutos a 1 hora', 'Uberlândia-MG', 'o preço', 'esta semana']) {
      expect(t).toContain(parte);
    }
  });
  it('junta a instrução de não repetir pergunta que o quiz já respondeu', () => {
    const f = fatosDoQuiz(ctx(contextoDoQuiz(linha)));
    expect(f.join(' ')).toMatch(/Não repita pergunta que o quiz já respondeu/);
  });
  it('quem não fez o quiz (ou outro form) não ganha linha nenhuma', () => {
    expect(contextoDoQuiz({ ...linha, form_id: 'quiz_solar' })).toBeNull();
    expect(contextoDoQuiz(null)).toBeNull();
    expect(fatosDoQuiz(ctx(null))).toEqual([]);
    expect(fatosCarla(ctx(null))).not.toContain('quiz do SolarDoc');
  });
  it('campo que o quiz não gravou fica de fora, sem "undefined" nem vazio', () => {
    const t = fatosDoQuiz(ctx(contextoDoQuiz({ form_id: 'quiz_solardoc', field_data: [{ name: 'Índice', values: ['50'] }] }))).join(' ');
    expect(t).toContain('índice: 50 de 100');
    expect(t).not.toMatch(/undefined|null|propostas por mês:|objeção:/);
  });
  it('o bloco fixo da Carla (tom, limites, preço) não mudou: o quiz só entra nos fatos', () => {
    const fonte = lerFonte('services/agentes5040/personas/carla.ts');
    const fixo = fonte.slice(fonte.indexOf('SISTEMA_FIXO_CARLA'), fonte.indexOf('export function fatosDoQuiz'));
    expect(fixo).not.toMatch(/quizSolardoc|diagnóstico do quiz/);
  });
});
