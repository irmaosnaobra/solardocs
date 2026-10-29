import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// O relatório semanal de melhoria (melhoria.ts), com banco falso e IA falsa. Nada de rede, nada de modelo de verdade.
// Cobre: a janela de 7 dias, a agregação, "poucos dados", o pulo e o `forcar`, o `dry`, uma chamada por agente, cota,
// disjuntor, interruptor, a conferência do que a IA devolve e a rota (sem telefone).

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

import { iaFalsa, novoBanco, respostaIA, type BancoFalso } from './_agentes5040Fake';
import {
  valorJaExiste, AGENTES, SISTEMA_MELHORIA, agregarNotas, corpoDoEmail, diasDaSemana, ehSegunda, escolherExemplos, lerItensIA, limparRegra, paraTela,
  runMelhoriaTick, schemaDaAgente, segundaDe, textosDasRegras, topTipos, type RelatorioMelhoria,
} from '../services/agentes5040/melhoria';
import { mountEnsaio5040 } from '../routes/geradorEnsaio5040';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { CHAVE_DISJUNTOR, tetoDe } from '../services/agentes5040/cota';
import { MODELO_PRINCIPAL } from '../services/agentes5040/ia';

const AGORA = new Date('2026-10-26T10:45:00.000Z');   // segunda, 07:45 em Brasília
const SEMANA = '2026-10-26';
const hm = (i: number): string => i.toString(16).padStart(64, '0');

let banco: BancoFalso;

interface Opcoes { agente?: string; qualidade?: string; problemas?: Array<{ tipo: string; trecho?: string; explicacao?: string }> }

/** Semeia a nota da conversa i no dia dado. */
function nota(dia: string, i: number, op: Opcoes = {}): string {
  const caminho = `qualidade/${dia}/${hm(i)}.json`;
  banco.objetos.set(caminho, JSON.stringify({
    dia, hmac: hm(i), agente: op.agente ?? 'duda', produto: 'solar', qualidade: op.qualidade ?? 'com_problema',
    problemas: (op.problemas ?? [{ tipo: 'repetiu_pergunta' }]).map(p => ({ trecho: p.trecho ?? `trecho ${i}`, explicacao: p.explicacao ?? `explicação ${i}`, ...p })),
  }));
  return caminho;
}

/** Uma semana cheia: duda 4 repetiu_pergunta + 1 quebrou_regra (critica), carla 2 alucinacao, helena 1 tom_errado. */
function semanaCheia(): void {
  nota('2026-10-19', 1, { agente: 'duda' });
  nota('2026-10-20', 2, { agente: 'duda' });
  nota('2026-10-21', 3, { agente: 'duda', problemas: [{ tipo: 'repetiu_pergunta' }, { tipo: 'repetiu_pergunta' }] });
  nota('2026-10-22', 4, { agente: 'duda' });
  nota('2026-10-23', 5, { agente: 'duda', qualidade: 'critica', problemas: [{ tipo: 'quebrou_regra' }] });
  nota('2026-10-24', 6, { agente: 'carla', problemas: [{ tipo: 'alucinacao' }] });
  nota('2026-10-25', 7, { agente: 'carla', problemas: [{ tipo: 'alucinacao' }] });
  nota('2026-10-25', 8, { agente: 'helena', problemas: [{ tipo: 'tom_errado' }] });
  nota('2026-10-25', 9, { agente: 'helena', qualidade: 'boa', problemas: [] });
}

const regraDoModelo = (tipo: string, extra: Record<string, unknown> = {}) => ({
  problema_tipo: tipo, vezes: 99, exemplos: [], regra_atual: '', regra_proposta: 'Ao ouvir a cidade do cliente, use a cidade na próxima pergunta.', onde: 'personas/duda.ts', por_que: 'Evita a pergunta repetida.', ...extra,
});

/** A IA falsa: devolve uma sugestão para o tipo mais frequente da agente do pedido. */
const iaPorAgente = (responder?: (agente: string, body: any) => unknown) => iaFalsa((body) => {
  const pedido = String(body.messages[0].content[0].text);
  const agente = /Agente: (\w+),/.exec(pedido)![1]!.toLowerCase();
  const tipo = agente === 'duda' ? 'repetiu_pergunta' : agente === 'carla' ? 'alucinacao' : 'tom_errado';
  const itens = responder ? responder(agente, body) : [regraDoModelo(tipo, { onde: `personas/${agente}.ts` })];
  return respostaIA(JSON.stringify({ itens }));
});

const relatorioGravado = (semana = SEMANA): RelatorioMelhoria | null => {
  const t = banco.objetos.get(`melhoria/${semana}.json`);
  return t ? JSON.parse(t) : null;
};

beforeEach(() => {
  banco = novoBanco(); h.principal = banco;
  banco.bucket = { existe: true, publico: false, criado: false };
  for (const k of ['AGENTES5040_QUALIDADE', 'AGENTES5040_TETO_MELHORIA', 'CAIXA_EQUIPE', 'SOLAR_SOCIOS']) delete process.env[k];
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-fora': 'fulano@irmaosnaobra.app' };
  zerarCacheArmazem(); zerarCacheInterruptores();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a semana', () => {
  it('a segunda-feira identifica a semana e o relatório cobre os 7 dias anteriores', () => {
    expect(segundaDe('2026-10-28')).toBe('2026-10-26');
    expect(segundaDe('2026-10-26')).toBe('2026-10-26');
    expect(segundaDe('2026-11-01')).toBe('2026-10-26');   // domingo
    expect(ehSegunda('2026-10-26')).toBe(true);
    expect(ehSegunda('2026-10-27')).toBe(false);
    expect(ehSegunda('2026-02-30')).toBe(false);
    expect(diasDaSemana(SEMANA)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(diasDaSemana('2026-03-02')[0]).toBe('2026-02-23');   // atravessa o mês
  });

  it('semana que não é segunda é recusada, sem ler nada', async () => {
    const r = await runMelhoriaTick({ agora: AGORA, semana: '2026-10-27' });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/segunda/);
    expect(banco.leituras).toEqual([]);
  });
});

describe('a agregação', () => {
  it('conta por agente e por tipo, uma vez por conversa, e só nos 7 dias', async () => {
    semanaCheia();
    nota('2026-10-26', 20, { agente: 'duda' });   // a própria segunda: fora
    nota('2026-10-18', 21, { agente: 'carla' });  // a segunda anterior menos um dia: fora
    const r = await runMelhoriaTick({ agora: AGORA, dry: true });
    expect(r.notasLidas).toBe(9);
    expect(r.notasComProblema).toBe(8);
    expect(r.agentesComProblema).toEqual(['duda', 'carla', 'helena']);
    expect(r.top3).toEqual([{ tipo: 'repetiu_pergunta', vezes: 4 }, { tipo: 'alucinacao', vezes: 2 }, { tipo: 'quebrou_regra', vezes: 1 }]);
  });

  it('agregarNotas: por_tipo, críticas, notas sem problema e agente inválido', () => {
    const a = agregarNotas([
      { dia: '2026-10-19', notas: [
        { hmac: hm(1), nota: { agente: 'duda', qualidade: 'critica', problemas: [{ tipo: 'alucinacao', trecho: 'a', explicacao: 'b' }, { tipo: 'alucinacao', trecho: 'c', explicacao: 'd' }] } },
        { hmac: hm(2), nota: { agente: 'duda', qualidade: 'boa', problemas: [] } },
        { hmac: hm(3), nota: { agente: 'ninguem' as any, qualidade: 'boa', problemas: [] } },
      ] },
      { dia: '2026-10-20', notas: [{ hmac: hm(4), nota: { agente: 'carla', qualidade: 'com_problema', problemas: [{ tipo: 'inventado' as any, trecho: 'x', explicacao: 'y' }] } }] },
    ]);
    expect(a.notasLidas).toBe(3);
    expect(a.notasComProblema).toBe(2);
    expect(a.porAgente.duda).toEqual({ notas: 2, com_problema: 1, criticas: 1, por_tipo: { alucinacao: 1 } });
    expect(a.porAgente.carla!.por_tipo).toEqual({ outro: 1 });
    expect(a.problemas).toHaveLength(2);
  });

  it('os exemplos são no máximo 60, repartidos entre as agentes, com os tipos frequentes e as notas críticas na frente', () => {
    const porDia = [{ dia: '2026-10-19', notas: [] as Array<{ hmac: string; nota: any }> }];
    let i = 1;
    for (let k = 0; k < 50; k++) porDia[0]!.notas.push({ hmac: hm(i++), nota: { agente: 'duda', qualidade: 'com_problema', problemas: [{ tipo: k < 30 ? 'repetiu_pergunta' : 'tom_errado', trecho: 't', explicacao: 'e' }] } });
    for (let k = 0; k < 50; k++) porDia[0]!.notas.push({ hmac: hm(i++), nota: { agente: 'carla', qualidade: k === 49 ? 'critica' : 'com_problema', problemas: [{ tipo: 'alucinacao', trecho: 't', explicacao: 'e' }] } });
    porDia[0]!.notas.push({ hmac: hm(i++), nota: { agente: 'helena', qualidade: 'com_problema', problemas: [{ tipo: 'tom_errado', trecho: 't', explicacao: 'e' }] } });
    const ex = escolherExemplos(agregarNotas(porDia));
    expect(ex.duda!.length + ex.carla!.length + ex.helena!.length).toBe(60);
    expect(ex.helena).toHaveLength(1);                                  // quem tem pouco não fica sem
    expect(ex.duda!.length).toBeGreaterThanOrEqual(29);
    expect(ex.carla!.length).toBeGreaterThanOrEqual(29);
    expect(ex.duda!.slice(0, 30).every(p => p.tipo === 'repetiu_pergunta')).toBe(true);
    expect(ex.carla![0]!.critica).toBe(true);                           // a crítica vem primeiro
    expect(topTipos({ duda: { notas: 1, com_problema: 1, criticas: 0, por_tipo: { a: 2, b: 5 } } as any })).toEqual([{ tipo: 'b', vezes: 5 }, { tipo: 'a', vezes: 2 }]);
  });
});

describe('a rodada', () => {
  it('poucos dados (menos de 5 notas com problema): grava o relatório e NÃO chama a IA', async () => {
    nota('2026-10-20', 1); nota('2026-10-21', 2); nota('2026-10-22', 3); nota('2026-10-23', 4, { agente: 'carla' });
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.ok).toBe(true); expect(r.poucosDados).toBe(true); expect(r.gravou).toBe(true); expect(r.novo).toBe(true); expect(r.itens).toBe(0);
    const g = relatorioGravado()!;
    expect(g.poucos_dados).toBe(true);
    expect(g.notas_lidas).toBe(4);
    expect(g.itens_por_agente).toEqual({ duda: [], carla: [], helena: [] });
  });

  it('semana cheia: UMA chamada por agente com problema, no modelo principal, e o relatório sai completo', async () => {
    semanaCheia();
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.ok).toBe(true); expect(r.gravou).toBe(true); expect(r.novo).toBe(true); expect(r.chamadasIA).toBe(3); expect(r.itens).toBe(3);
    expect(ia.chamadas).toHaveLength(3);
    const agentes = ia.chamadas.map(c => /Agente: (\w+),/.exec(c.body.messages[0].content[0].text)![1]);
    expect(agentes.sort()).toEqual(['Carla', 'Duda', 'Helena']);
    for (const c of ia.chamadas) {
      expect(c.body.model).toBe(MODELO_PRINCIPAL);
      expect(c.body.output_config.format.type).toBe('json_schema');
      expect(c.body.system[0].text).toBe(SISTEMA_MELHORIA);
    }
    const g = relatorioGravado()!;
    expect(g.semana).toBe(SEMANA);
    expect(g.periodo).toEqual({ de: '2026-10-19', ate: '2026-10-25' });
    expect(g.modelo).toBe(MODELO_PRINCIPAL);
    expect(g.notas_lidas).toBe(9);
    expect(g.por_agente.duda).toEqual({ notas: 5, com_problema: 5, criticas: 1, por_tipo: { repetiu_pergunta: 4, quebrou_regra: 1 } });
    expect(g.itens_por_agente.duda).toHaveLength(1);
    const item = g.itens_por_agente.duda![0]!;
    expect(item.vezes).toBe(4);                                   // a contagem é nossa, não a que a IA disse (99)
    expect(item.exemplos).toHaveLength(3);
    expect(item.exemplos[0]).toMatchObject({ hmac: expect.stringMatching(/^[0-9a-f]{64}$/), trecho: expect.stringMatching(/^trecho \d$/) });
    expect(g.falhou).toBeUndefined();
    // o pedido leva o texto atual das regras
    const pedidoDuda = ia.chamadas.find(c => /Agente: Duda,/.test(c.body.messages[0].content[0].text))!.body.messages[0].content[0].text as string;
    expect(pedidoDuda).toContain('personas/duda.ts');
    expect(pedidoDuda).toContain('personas/comum.ts');
    expect(pedidoDuda).toContain('REGRAS DE ESCRITA');
    expect(pedidoDuda).toContain('- repetiu_pergunta: 4 conversas');
  });

  it('relatório que já existe é pulado; forcar refaz', async () => {
    semanaCheia();
    process.env.AGENTES5040_TETO_MELHORIA = '20';
    const ia = iaPorAgente();
    await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(3);
    const pulo = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(pulo.pulou).toBe(true); expect(pulo.gravou).toBe(false); expect(pulo.existe).toBe(true);
    expect(ia.chamadas).toHaveLength(3);
    const refeito = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente, forcar: true });
    expect(refeito.gravou).toBe(true); expect(refeito.pulou).toBe(false);
    expect(refeito.novo).toBe(false);                             // refazer com forcar não é relatório novo: sem e-mail de novo
    expect(ia.chamadas).toHaveLength(6);
    expect(relatorioGravado()!.semana).toBe(SEMANA);
  });

  it('dry só conta: não chama a IA, não grava e passa por cima do interruptor', async () => {
    semanaCheia();
    process.env.AGENTES5040_QUALIDADE = '0';
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente, dry: true });
    expect(r.ok).toBe(true); expect(r.dry).toBe(true);
    expect(r.notasLidas).toBe(9); expect(r.agentesComProblema).toHaveLength(3);
    expect(ia.chamadas).toHaveLength(0);
    expect(relatorioGravado()).toBeNull();
    expect(banco.escritas.filter(e => e.tabela === 'system_state')).toEqual([]);
  });

  it('o interruptor qualidade desligado não roda: nenhuma leitura, nenhuma chamada, nenhum arquivo', async () => {
    semanaCheia();
    process.env.AGENTES5040_QUALIDADE = '0';
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(r.ligado).toBe(false); expect(r.ok).toBe(true); expect(r.gravou).toBe(false);
    expect(ia.chamadas).toHaveLength(0);
    expect(relatorioGravado()).toBeNull();
  });

  it('a cota por dia (padrão 4) vale: com teto 2, duas agentes são atendidas, a terceira fica em falhou e nova rodada refaz só ela', async () => {
    semanaCheia();
    process.env.AGENTES5040_TETO_MELHORIA = '2';
    expect(tetoDe('melhoria')).toBe(2);
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(2);
    expect(r.gravou).toBe(true); expect(r.novo).toBe(true); expect(r.parou).toBe('teto'); expect(r.falhou).toHaveLength(1);
    const g = relatorioGravado()!;
    expect(g.falhou).toHaveLength(1);
    const quemFalhou = g.falhou![0]!;
    expect(g.itens_por_agente[quemFalhou]).toEqual([]);
    // depois: sem forcar, só a que falhou é refeita, as outras ficam como estavam
    process.env.AGENTES5040_TETO_MELHORIA = '10';
    const antes = { ...g.itens_por_agente };
    const ia2 = iaPorAgente();
    const r2 = await runMelhoriaTick({ agora: AGORA, cliente: ia2.cliente });
    expect(ia2.chamadas).toHaveLength(1);
    expect(r2.pulou).toBe(false); expect(r2.gravou).toBe(true);
    expect(r2.novo).toBe(false);                                  // completou um relatório que já existia: sem e-mail de novo
    const g2 = relatorioGravado()!;
    expect(g2.falhou).toBeUndefined();
    expect(g2.itens_por_agente[quemFalhou]).toHaveLength(1);
    for (const a of AGENTES) if (a !== quemFalhou) expect(g2.itens_por_agente[a]).toEqual(antes[a]);
  });

  it('teto zerado na hora: nenhuma chamada boa, NADA é gravado e a próxima tentativa não é barrada', async () => {
    semanaCheia();
    process.env.AGENTES5040_TETO_MELHORIA = '1';
    // a vaga única do dia já foi usada
    (banco.tabelas.system_state ??= []).push({ key: 'ag5040_ia:melhoria:2026-10-26:1', value: {}, updated_at: AGORA.toISOString() });
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.gravou).toBe(false); expect(r.parou).toBe('teto'); expect(r.ok).toBe(true);
    expect(relatorioGravado()).toBeNull();
  });

  it('disjuntor aberto: nenhuma chamada, nada gravado', async () => {
    semanaCheia();
    (banco.tabelas.system_state ??= []).push({ key: CHAVE_DISJUNTOR, value: { causa: 'ia_sem_credito', ate: '2026-10-26T12:00:00.000Z' }, updated_at: AGORA.toISOString() });
    const ia = iaPorAgente();
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(0);
    expect(r.gravou).toBe(false); expect(r.parou).toBe('disjuntor');
    expect(relatorioGravado()).toBeNull();
  });

  it('IA que devolve formato torto não grava nada (ok:false, para a rota dar 500)', async () => {
    semanaCheia();
    const ia = iaFalsa(() => respostaIA('isto não é json'));
    const r = await runMelhoriaTick({ agora: AGORA, cliente: ia.cliente });
    expect(ia.chamadas).toHaveLength(3);
    expect(r.ok).toBe(false); expect(r.gravou).toBe(false); expect(r.falhou).toHaveLength(3);
    expect(relatorioGravado()).toBeNull();
  });

  it('nada vai para as tabelas de produção: só o bucket e as vagas da cota', async () => {
    semanaCheia();
    await runMelhoriaTick({ agora: AGORA, cliente: iaPorAgente().cliente });
    const tabelas = new Set(banco.escritas.map(e => e.tabela));
    expect([...tabelas]).toEqual(['system_state']);
    for (const e of banco.escritas) for (const k of e.chaves ?? []) expect(k).toMatch(/^ag5040_ia:melhoria:/);
  });
});

describe('o que a IA devolve é conferido', () => {
  const agente = 'duda' as const;
  const ctx = (extra: Record<string, unknown> = {}) => {
    const problemas = [
      { agente, tipo: 'repetiu_pergunta' as const, trecho: 'Qual a sua cidade?', explicacao: 'já tinha dito', dia: '2026-10-20', hmac: hm(1), critica: false },
      { agente, tipo: 'repetiu_pergunta' as const, trecho: 'E a cidade?', explicacao: 'de novo', dia: '2026-10-21', hmac: hm(2), critica: true },
      { agente, tipo: 'tom_errado' as const, trecho: 'Beleza!', explicacao: 'seca', dia: '2026-10-22', hmac: hm(3), critica: false },
    ];
    return { agente, contagem: { notas: 5, com_problema: 3, criticas: 1, por_tipo: { repetiu_pergunta: 2, tom_errado: 1 } }, exemplos: problemas.slice(0, 2), todos: problemas, ...extra };
  };
  const lerUm = (item: Record<string, unknown>) => lerItensIA(JSON.stringify({ itens: [regraDoModelo('repetiu_pergunta', item)] }), ctx());

  it('regra_atual literal do bloco comum vira personas/comum.ts; o que não está no texto vira vazio e avisa', () => {
    const [ok] = lerUm({ regra_atual: 'Nunca diga "assistente   virtual".', onde: 'personas/duda.ts' })!;
    expect(ok!.onde).toBe('personas/comum.ts');
    expect(ok!.regra_atual_confere).toBe(true);
    expect(ok!.regra_atual).toContain('assistente');
    const [inventada] = lerUm({ regra_atual: 'Sempre fale em inglês com o cliente.' })!;
    expect(inventada!.regra_atual).toBe('');
    expect(inventada!.regra_atual_confere).toBe(false);
    const [semRegra] = lerUm({ regra_atual: '' })!;
    expect(semRegra!.regra_atual_confere).toBe(true);
    // um trecho que só o arquivo da persona tem
    const so = textosDasRegras('duda').persona.split('\n').find(l => l.trim().length > 40 && !l.includes('regras comuns'))!.trim();
    const [daPersona] = lerUm({ regra_atual: so, onde: 'personas/comum.ts' })!;
    expect(daPersona!.onde).toBe('personas/duda.ts');
  });

  it('exemplos: só os que a IA recebeu; hmac inventado sai e o trecho vem do nosso dado', () => {
    const [it1] = lerUm({ exemplos: [
      { dia: '2026-10-21', hmac: hm(2), trecho: 'texto que a IA reescreveu' },
      { dia: '2026-10-21', hmac: hm(999), trecho: 'conversa que não existe' },
      { dia: '2026-10-22', hmac: hm(3), trecho: 'existe, mas não foi mostrado' },
    ] })!;
    expect(it1!.exemplos).toEqual([{ dia: '2026-10-21', hmac: hm(2), trecho: 'E a cidade?' }]);
    // sem nenhum válido, completa com os nossos do mesmo tipo (no máximo 3)
    const [it2] = lerUm({ exemplos: [{ dia: '2026-10-21', hmac: hm(999), trecho: 'x' }] })!;
    expect(it2!.exemplos.map(e => e.hmac)).toEqual([hm(1), hm(2)]);
  });

  it('item fora das regras sai: tipo sem conversa, travessão vira vírgula, emoji, preço novo, negar ser IA', () => {
    const itens = lerItensIA(JSON.stringify({ itens: [
      regraDoModelo('alucinacao'),                                                       // tipo que não houve
      regraDoModelo('repetiu_pergunta', { regra_proposta: 'ao ouvir a cidade — use a cidade na próxima pergunta, sem repetir.' }),
      regraDoModelo('tom_errado', { regra_proposta: 'Responda com calor humano e um ponto final. \u{1F600}' }),
    ] }), ctx())!;
    expect(itens.map(i => i.problema_tipo)).toEqual(['repetiu_pergunta']);
    expect(itens[0]!.regra_proposta).toBe('Ao ouvir a cidade, use a cidade na próxima pergunta, sem repetir.');
    const rejeita = (regra: string): boolean => lerItensIA(JSON.stringify({ itens: [regraDoModelo('repetiu_pergunta', { regra_proposta: regra })] }), ctx())!.length === 0;
    expect(rejeita('Diga que o plano custa R$ 49 por mês para fechar mais rápido.')).toBe(true);
    expect(rejeita('Ofereça 20% de desconto a quem hesitar na conversa.')).toBe(true);
    expect(rejeita('Se perguntarem, negue ser IA e diga que você é uma pessoa da equipe.')).toBe(true);
    expect(rejeita('Curta.')).toBe(true);
    // o preço que já está nas regras de hoje (R$ 67 na Carla) não é preço novo; na Duda, que não tem esse valor, é
    const preco = 'Quando perguntarem o valor, diga só R$ 67.';
    expect(lerItensIA(JSON.stringify({ itens: [regraDoModelo('repetiu_pergunta', { regra_proposta: preco })] }), ctx({ agente: 'carla' }))).toHaveLength(1);
    expect(rejeita(preco)).toBe(true);
  });

  it('percentual e prazo: o número inteiro conta (50% não passa por causa de 10%) e prazo novo não passa', () => {
    const rejeita = (regra: string): boolean => lerItensIA(JSON.stringify({ itens: [regraDoModelo('repetiu_pergunta', { regra_proposta: regra })] }), ctx())!.length === 0;
    expect(rejeita('Ofereça 50% a mais de atenção ao cliente que hesitar.')).toBe(true);
    expect(rejeita('Responda em 3 dias úteis quando o cliente pedir retorno.')).toBe(true);
    expect(rejeita('Retorne em 2 horas ao cliente que pediu proposta.')).toBe(true);
    expect(rejeita('Retorne após 5 horas ao cliente que pediu proposta.')).toBe(true);
    // sem número de prazo ou de valor, passa
    expect(rejeita('Ao ouvir a cidade do cliente, use a cidade na próxima pergunta.')).toBe(false);
  });

  it('50% contra um texto atual que tem 10%: barra; o 10% que já existe passa', () => {
    // a Carla tem "garantia de N dias" no texto atual; pegamos um percentual e um prazo que existem de verdade nas regras dela
    const { persona, comum } = textosDasRegras('carla');
    const atual = `${persona} ${comum}`;
    const dias = /(\d+)\s*dias/.exec(atual);
    expect(dias).not.toBeNull();
    const ctxCarla = ctx({ agente: 'carla' });
    const proposta = (t: string) => lerItensIA(JSON.stringify({ itens: [regraDoModelo('repetiu_pergunta', { regra_proposta: t })] }), ctxCarla)!.length;
    expect(proposta(`Lembre a garantia de ${dias![1]} dias sempre que o cliente hesitar.`)).toBe(1);
    expect(proposta(`Lembre a garantia de ${Number(dias![1]) + 999} dias sempre que o cliente hesitar.`)).toBe(1);   // "N dias" solto não é prazo de resposta
    expect(proposta(`Responda em ${Number(dias![1]) + 999} dias sempre que o cliente hesitar.`)).toBe(0);
    // o percentual: 50% contra um texto atual que tem 10%
    const texto = 'Ofereça até 10% e 150% de atenção'.toLowerCase().replace(/\s/g, '');
    expect(valorJaExiste('50%', texto)).toBe(false);
    expect(valorJaExiste('10%', texto)).toBe(true);
    expect(valorJaExiste('150%', texto)).toBe(true);
    expect(valorJaExiste('em 2 dias', 'retorne em2dias')).toBe(true);
    expect(valorJaExiste('em 2 dias', 'retorne em12dias')).toBe(false);
  });

  it('regra_atual curta demais (menos de 15 caracteres) não vale como literal: vai vazia com o aviso', () => {
    const [curta] = lerUm({ regra_atual: 'Sem emoji' })!;          // existe no texto, mas é curto demais para provar qualquer coisa
    expect(textosDasRegras('duda').comum).toContain('Sem emoji');
    expect(curta!.regra_atual).toBe('');
    expect(curta!.regra_atual_confere).toBe(false);
    const [ok] = lerUm({ regra_atual: 'Sem emoji, nenhum.' })!;      // 18 caracteres, literal
    expect(ok!.regra_atual_confere).toBe(true);
    expect(ok!.onde).toBe('personas/comum.ts');
  });

  it('crase e cifrão-chave não passam; no máximo 3 itens e um por tipo; a ordem é por quantidade', () => {
    expect(limparRegra('Use `esta` regra e ${isso}.')).toBe("Use 'esta' regra e {isso}.");
    expect(limparRegra('ligue para 34 99111-0000 hoje')).not.toMatch(/99111/);
    const muitos = ['tom_errado', 'repetiu_pergunta', 'repetiu_pergunta', 'tom_errado'].map(t => regraDoModelo(t));
    const lidos = lerItensIA(JSON.stringify({ itens: muitos }), ctx())!;
    expect(lidos.map(i => i.problema_tipo)).toEqual(['repetiu_pergunta', 'tom_errado']);
    expect(lerItensIA('{"itens": 3}', ctx())).toBeNull();
    expect(lerItensIA('não é json', ctx())).toBeNull();
    expect(lerItensIA('{"itens": []}', ctx())).toEqual([]);
  });

  it('o schema pede enum para o tipo e para o arquivo, e o prompt traz os limites', () => {
    const s: any = schemaDaAgente('carla');
    const props = s.properties.itens.items.properties;
    expect(props.problema_tipo.enum).toContain('alucinacao');
    expect(props.onde.enum).toEqual(['personas/carla.ts', 'personas/comum.ts']);
    expect(s.additionalProperties).toBe(false);
    expect(SISTEMA_MELHORIA).not.toContain('`');
    expect(SISTEMA_MELHORIA).not.toMatch(/[—–]/);
    expect(SISTEMA_MELHORIA).toMatch(/Nunca proponha que a agente negue ser IA/);
    expect(SISTEMA_MELHORIA).toMatch(/opt-out/);
  });

  it('o e-mail leva só números e rótulos', () => {
    const corpo = corpoDoEmail(SEMANA, 120, [{ tipo: 'repetiu_pergunta', vezes: 4 }, { tipo: 'alucinacao', vezes: 1 }]);
    expect(corpo).toContain('19/10 a 25/10');
    expect(corpo).toContain('120');
    expect(corpo).toContain('Repetiu pergunta: 4 conversas');
    expect(corpo).toContain('Informação inventada: 1 conversa<');
    expect(corpo).toContain('Veja na aba Ensaio do /gerador.');
    expect(corpo).not.toMatch(/[—–]/);
  });
});

describe('a rota GET /gerador/ensaio/melhoria', () => {
  const r = Router();
  mountEnsaio5040(r);
  const app = express();
  app.use(express.json());
  app.use('/gerador', r);
  const NILCE = 'Bearer tk-nilce';
  const FORA = 'Bearer tk-fora';

  const relatorio = (semana: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    semana, periodo: { de: '2026-10-12', ate: '2026-10-18' }, gerado_em: '2026-10-19T10:45:00.000Z', modelo: 'claude-opus-5-5', notas_lidas: 40, notas_com_problema: 9,
    por_agente: { duda: { notas: 20, com_problema: 6, criticas: 1, por_tipo: { repetiu_pergunta: 4 } }, carla: { notas: 10, com_problema: 2, criticas: 0, por_tipo: {} }, helena: { notas: 10, com_problema: 1, criticas: 0, por_tipo: {} } },
    itens_por_agente: {
      duda: [{
        problema_tipo: 'repetiu_pergunta', vezes: 4, regra_atual: '', regra_atual_confere: true, regra_proposta: 'Use a cidade que o cliente disse.', onde: 'personas/duda.ts', por_que: 'Evita repetir.',
        exemplos: [{ dia: '2026-10-14', hmac: hm(1), trecho: 'Fale comigo no 34 99111-0000 amanhã', telefone: '5534991110000' }, { dia: '2026-10-15', hmac: 'nao-e-hmac', trecho: 'x' }],
        telefone: '5534991110000',
      }],
      carla: [], helena: [],
    },
    telefone: '5534991110000', ...extra,
  });

  it('devolve o mais recente e a lista das semanas; sem telefone em lugar nenhum, só HMAC', async () => {
    banco.objetos.set('melhoria/2026-10-19.json', JSON.stringify(relatorio('2026-10-19')));
    banco.objetos.set('melhoria/2026-10-12.json', JSON.stringify(relatorio('2026-10-12')));
    banco.objetos.set('melhoria/lixo.json', '{}');
    const res = await request(app).get('/gerador/ensaio/melhoria').set('Authorization', NILCE);
    expect(res.status).toBe(200);
    expect(res.body.semana).toBe('2026-10-19');
    expect(res.body.semanas).toEqual(['2026-10-19', '2026-10-12']);
    const item = res.body.relatorio.itens_por_agente.duda[0];
    expect(item.exemplos).toHaveLength(1);                      // o hmac torto saiu
    expect(item.exemplos[0].hmac).toBe(hm(1));
    const corpo = JSON.stringify(res.body);
    expect(corpo).not.toMatch(/telefone/i);
    expect(corpo).not.toContain('5534991110000');
    expect(corpo).not.toContain('99111-0000');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('semana pedida: devolve ela; semana que não existe volta vazia com a lista; semana torta é 400; fora da equipe é 403; sem relatório nenhum não quebra', async () => {
    banco.objetos.set('melhoria/2026-10-19.json', JSON.stringify(relatorio('2026-10-19')));
    banco.objetos.set('melhoria/2026-10-12.json', JSON.stringify(relatorio('2026-10-12', { notas_lidas: 7 })));
    const antiga = await request(app).get('/gerador/ensaio/melhoria?semana=2026-10-12').set('Authorization', NILCE);
    expect(antiga.body.relatorio.notas_lidas).toBe(7);
    const inexistente = await request(app).get('/gerador/ensaio/melhoria?semana=2026-10-05').set('Authorization', NILCE);
    expect(inexistente.status).toBe(200);
    expect(inexistente.body.relatorio).toBeNull();
    expect(inexistente.body.semanas).toEqual(['2026-10-19', '2026-10-12']);
    expect((await request(app).get('/gerador/ensaio/melhoria?semana=2026-10-13').set('Authorization', NILCE)).status).toBe(400);
    expect((await request(app).get('/gerador/ensaio/melhoria?semana=amanha').set('Authorization', NILCE)).status).toBe(400);
    expect((await request(app).get('/gerador/ensaio/melhoria').set('Authorization', FORA)).status).toBe(403);
    banco.objetos.clear();
    const vazia = await request(app).get('/gerador/ensaio/melhoria').set('Authorization', NILCE);
    expect(vazia.body).toMatchObject({ ok: true, semana: null, semanas: [], relatorio: null });
  });

  it('paraTela devolve null para lixo e preenche os campos que faltam', () => {
    expect(paraTela(null)).toBeNull();
    expect(paraTela({ semana: 'x' })).toBeNull();
    const p: any = paraTela({ semana: '2026-10-19' });
    expect(p.itens_por_agente).toEqual({ duda: [], carla: [], helena: [] });
    expect(p.poucos_dados).toBe(false);
  });
});
