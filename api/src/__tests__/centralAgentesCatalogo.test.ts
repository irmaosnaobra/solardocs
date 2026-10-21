import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// A lista da Central das Agentes. O dono perguntou "estão todos ali?", e a
// resposta tem que ser conferida pela máquina, não por quem lê a tela:
//   1. todo robô de chefe/classes.ts cai em algum cartão (ou numa lista curta de
//      "não é robô"), então robô novo sem cartão derruba este teste;
//   2. todo cartão tem nome, uma linha do que faz, área, estado e um arquivo que
//      existe (robô apagado do código sai da tela);
//   3. o selo copia a chave que o código do robô lê: valor errado não vira selo.

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        select() { return q; }, or() { return q; }, eq() { return q; },
        like() { return q; }, order() { return q; }, gte() { return q; },
        limit() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        select() { return q; }, in() { return q; }, eq() { return q; }, is() { return q; },
        not() { return q; }, gte() { return q; }, lt() { return q; }, order() { return q; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  tetosVigentesLinha: vi.fn(async () => ({ hora: 6, dia: 40 })),
}));
vi.mock('../services/agents/whatsapp/carlaThrottle', () => ({ MAX_CARLA_POR_HORA: 4 }));
vi.mock('../services/agents/zapiClient', () => ({ solardocViaIo: () => false }));

import {
  AREAS, CATALOGO, IGNORADOS, estadoDaRegra, chaveDaRegra,
  type ChavesDoBanco, type RegraDaChave, type Selo,
} from '../services/io/centralAgentesCatalogo';
import { CLASSE_POR_ROBO, ROBOS_META } from '../services/chefe/classes';

const SEM_BANCO: ChavesDoBanco = { recepcaoAtiva: false, helenaOff: false };
const porId = (id: string) => CATALOGO.find(c => c.id === id)!;
const selo = (id: string, env: Record<string, string>, banco: ChavesDoBanco = SEM_BANCO): Selo =>
  estadoDaRegra(porId(id).regra, env as NodeJS.ProcessEnv, banco).selo;

describe('o catálogo cobre todos os robôs do código', () => {
  const cobertos = new Set(CATALOGO.flatMap(c => c.robos));
  const todosOsRobos = [...Object.keys(CLASSE_POR_ROBO), ...Object.keys(ROBOS_META)];

  it('todo robô de CLASSE_POR_ROBO e ROBOS_META tem cartão, ou está na lista de "não é robô"', () => {
    const soltos = todosOsRobos.filter(r => !cobertos.has(r) && !(r in IGNORADOS));
    expect(soltos).toEqual([]);
  });

  it('nenhum cartão cita um nome que não existe no código (typo ou robô apagado)', () => {
    const existentes = new Set(todosOsRobos);
    const orfaos = [...cobertos].filter(r => !existentes.has(r));
    expect(orfaos).toEqual([]);
  });

  it('o mesmo robô não mora em dois cartões, nem na lista de ignorados', () => {
    const todos = CATALOGO.flatMap(c => c.robos);
    expect(todos.length).toBe(new Set(todos).size);
    expect(todos.filter(r => r in IGNORADOS)).toEqual([]);
  });

  it('os robôs citados na tarefa estão na tela', () => {
    for (const id of ['helena', 'duda_recepcao', 'duda_quiz', 'solar_giovanna', 'semente', 'pesquisa_satisfacao',
      'reagenda_solar', 'sentinela_vacuo', 'lembrete_followup', 'placar_giovanna', 'agenda_proxima', 'reagendar_digest']) {
      expect(porId(id), id).toBeTruthy();
    }
  });
});

describe('cada cartão da lista', () => {
  it('ids únicos, e os ids antigos continuam (rosto, cérebro e roteamento dependem deles)', () => {
    const ids = CATALOGO.map(c => c.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const antigo of ['bia', 'cora', 'giovanna', 'curso19', 'instagram', 'eletroposto', 'agenda_eletroposto',
      'solar_boas_vindas', 'roteamento_solar', 'indicacao', 'prospeccao', 'email']) {
      expect(ids, antigo).toContain(antigo);
    }
  });

  it('tem nome, o que faz em uma linha (até 60 caracteres), texto longo e área válida', () => {
    const areas = new Set(AREAS.map(a => a.id));
    for (const c of CATALOGO) {
      expect(c.nome.trim().length, c.id).toBeGreaterThan(2);
      expect(c.resumo.length, `${c.id}: resumo "${c.resumo}"`).toBeGreaterThan(10);
      expect(c.resumo.length, `${c.id}: resumo "${c.resumo}"`).toBeLessThanOrEqual(60);
      expect(c.papel.trim().length, c.id).toBeGreaterThan(40);
      expect(areas.has(c.area), c.id).toBe(true);
    }
  });

  it('texto começa com maiúscula, sem travessão e sem ponto final no resumo', () => {
    for (const c of CATALOGO) {
      for (const t of [c.nome, c.resumo, c.papel]) {
        expect(t[0], `${c.id}: "${t.slice(0, 20)}"`).toBe(t[0]!.toUpperCase());
        expect(/[—–]/.test(t), `${c.id} tem travessão`).toBe(false);
      }
      expect(c.resumo.endsWith('.'), `${c.id}: resumo termina em ponto`).toBe(false);
    }
  });

  it('o arquivo do robô existe (robô apagado sai da tela)', () => {
    const raiz = join(__dirname, '..');
    for (const c of CATALOGO) expect(existsSync(join(raiz, c.fonte)), `${c.id} → ${c.fonte}`).toBe(true);
  });

  it('toda área tem pelo menos um cartão', () => {
    for (const a of AREAS) expect(CATALOGO.some(c => c.area === a.id), a.id).toBe(true);
  });

  it('o estado sai da regra e é um dos três selos', () => {
    for (const c of CATALOGO) {
      const e = estadoDaRegra(c.regra, {}, SEM_BANCO);
      expect(['ligado', 'pausado', 'desligado'], c.id).toContain(e.selo);
      // "Sempre ligado" = sem chave. Com chave, é só o NOME dela.
      expect(chaveDaRegra(c.regra) === undefined, c.id).toBe(c.regra.tipo === 'sempre');
    }
  });
});

describe('o selo copia a chave que o código do robô lê', () => {
  it('chave _OFF de valor "1": só o texto 1 desliga, e o true não', () => {
    expect(selo('agenda_eletroposto', {})).toBe('ligado');
    expect(selo('agenda_eletroposto', { EP_LEMBRETES_OFF: '1' })).toBe('desligado');
    expect(selo('agenda_eletroposto', { EP_LEMBRETES_OFF: ' 1 ' })).toBe('desligado');   // o serviço faz trim
    // A Central antiga aceitava 'true' e mostrava Desligado para um robô que seguia rodando.
    expect(selo('agenda_eletroposto', { EP_LEMBRETES_OFF: 'true' })).toBe('ligado');
    expect(selo('ep_cobra_sim', { EP_COBRA_SIM_OFF: 'true' })).toBe('ligado');
    expect(selo('sentinela_vacuo', { VACUO_OFF: '0' })).toBe('ligado');
  });

  it('ficha e sentinela (interruptor): ligam pela env OU pela chave do banco, e a env 0 vence a chave', () => {
    for (const [id, env, nome] of [['ficha_consultor_5040', 'AGENTES5040_FICHA', 'ficha'], ['sentinela_ferramentas', 'AGENTES5040_SENTINELA', 'sentinela']] as const) {
      expect(selo(id, {}), id).toBe('desligado');
      expect(selo(id, {}, { ...SEM_BANCO, interruptores: {} }), id).toBe('desligado');
      expect(selo(id, {}, { ...SEM_BANCO, interruptores: null }), id).toBe('desligado');
      expect(selo(id, { [env]: '1' }), id).toBe('ligado');
      expect(selo(id, { [env]: ' 1 ' }), id).toBe('ligado');
      expect(selo(id, {}, { ...SEM_BANCO, interruptores: { [nome]: true } }), id).toBe('ligado');
      expect(selo(id, {}, { ...SEM_BANCO, interruptores: { [nome]: false } }), id).toBe('desligado');
      expect(selo(id, { [env]: '0' }, { ...SEM_BANCO, interruptores: { [nome]: true } }), id).toBe('desligado');
      expect(selo(id, { [env]: '1' }, { ...SEM_BANCO, interruptores: { [nome]: false } }), id).toBe('ligado');
      expect(chaveDaRegra(porId(id).regra), id).toBe(`${env} ou ag5040_interruptores`);
    }
    // um interruptor de outra peça não liga esta
    expect(selo('sentinela_ferramentas', {}, { ...SEM_BANCO, interruptores: { ficha: true } })).toBe('desligado');
  });

  it('PESQUISA_WHATSAPP_OFF compara sem trim, como o serviço', () => {
    expect(selo('pesquisa_satisfacao', { PESQUISA_WHATSAPP_OFF: '1' })).toBe('desligado');
    expect(selo('pesquisa_satisfacao', { PESQUISA_WHATSAPP_OFF: ' 1' })).toBe('ligado');
  });

  it('prospecção, Facebook e IG: só o texto true desliga, e o 1 não', () => {
    for (const [id, env] of [['prospeccao', 'PROSPECCAO_APIFY_OFF'], ['prospeccao_aviso', 'PROSPECCAO_AVISO_OFF'],
      ['prospeccao_ig', 'PROSPECCAO_IA_OFF'], ['fb_comentarios', 'FB_COMENTARIOS_OFF'], ['fb_inbox', 'FB_INBOX_OFF']] as const) {
      expect(selo(id, {}), id).toBe('ligado');
      expect(selo(id, { [env]: 'true' }), id).toBe('desligado');
      expect(selo(id, { [env]: '1' }), id).toBe('ligado');
    }
  });

  it('opt-in nasce desligado e só liga com true', () => {
    for (const [id, env] of [['semente', 'SEMENTE_ON'], ['curso19', 'CAMPANHA_CURSO19_ON'], ['carla_retomada', 'CARLA_RETOMADA_ON'],
      ['confianca_email', 'CONFIANCA_ENABLED'], ['confianca_wa', 'CONFIANCA_WA_ENABLED']] as const) {
      expect(selo(id, {}), id).toBe('desligado');
      expect(selo(id, { [env]: '1' }), id).toBe('desligado');
      expect(selo(id, { [env]: 'true' }), id).toBe('ligado');
    }
    // Estes comparam em minúsculas; o Instagram e a Bia comparam o texto cru.
    expect(selo('semente', { SEMENTE_ON: ' TRUE ' })).toBe('ligado');
    expect(selo('instagram', { IG_AUTOMACAO_ENABLED: 'TRUE' })).toBe('desligado');
    expect(selo('instagram', { IG_AUTOMACAO_ENABLED: ' true ' })).toBe('ligado');
    const linhaIo = { ZAPI_INSTANCE_ID_IO: 'x', ZAPI_TOKEN_IO: 'y' };
    expect(selo('bia', { ...linhaIo, RECUP_ENABLED: 'true' })).toBe('ligado');
    expect(selo('bia', { ...linhaIo, RECUP_ENABLED: ' true' })).toBe('desligado');
    expect(selo('bia', { ...linhaIo, RECUP_ENABLED: '1' })).toBe('desligado');
  });

  it('o recado do solar também para com SOLAR_BOASVINDAS_OFF (solarRespostas.ts:284)', () => {
    expect(selo('solar_respostas', {})).toBe('ligado');
    expect(selo('solar_respostas', { SOLAR_RESPOSTAS_OFF: '1' })).toBe('desligado');
    expect(selo('solar_respostas', { SOLAR_BOASVINDAS_OFF: '1' })).toBe('desligado');
    expect(selo('solar_respostas', { SOLAR_BOASVINDAS_OFF: 'true' })).toBe('ligado');
    expect(estadoDaRegra(porId('solar_respostas').regra, {}, SEM_BANCO).chave).toBe('SOLAR_RESPOSTAS_OFF ou SOLAR_BOASVINDAS_OFF');
  });

  it('Duda do quiz: SOLAR_BOASVINDAS_OFF para só a primeira mensagem, então é Pausada', () => {
    expect(selo('duda_quiz', {})).toBe('ligado');
    expect(selo('duda_quiz', { SOLAR_AGENTE_OFF: '1' })).toBe('desligado');
    expect(selo('duda_quiz', { SOLAR_BOASVINDAS_OFF: '1' })).toBe('pausado');
    expect(selo('duda_quiz', { SOLAR_AGENTE_OFF: '1', SOLAR_BOASVINDAS_OFF: '1' })).toBe('desligado');
  });

  it('curso19 e retomada só comparam em minúsculas, sem trim: " true" deixa o robô parado e o cartão diz Desligado', () => {
    for (const [id, env] of [['curso19', 'CAMPANHA_CURSO19_ON'], ['carla_retomada', 'CARLA_RETOMADA_ON']] as const) {
      expect(selo(id, { [env]: 'TRUE' }), id).toBe('ligado');
      expect(selo(id, { [env]: ' true' }), id).toBe('desligado');
      expect(selo(id, { [env]: 'true ' }), id).toBe('desligado');
    }
  });

  it('cada chave confere com o jeito exato do robô (espaço em volta do valor)', () => {
    // Com trim no código: o espaço NÃO muda o resultado.
    expect(selo('semente', { SEMENTE_ON: ' true ' })).toBe('ligado');
    expect(selo('confianca_email', { CONFIANCA_ENABLED: ' true ' })).toBe('ligado');
    expect(selo('confianca_wa', { CONFIANCA_WA_ENABLED: ' true ' })).toBe('ligado');
    for (const [id, env] of [['solar_boas_vindas', 'SOLAR_BOASVINDAS_OFF'], ['duda_quiz', 'SOLAR_AGENTE_OFF'],
      ['solar_giovanna', 'SOLAR_GIOVANNA_OFF'], ['reagenda_solar', 'SOLAR_REAGENDA_OFF'], ['avisos_pauta', 'AVISOS_OFF'],
      ['sentinela_vacuo', 'VACUO_OFF'], ['lembrete_followup', 'LEMBRETE_OFF'], ['placar_giovanna', 'PLACAR_OFF'],
      ['ep_estudo', 'EP_ESTUDO_OFF'], ['ep_top_pontos', 'EP_TOP_OFF'], ['ep_retorno', 'EP_RETORNO_OFF']] as const) {
      expect(selo(id, { [env]: ' 1 ' }), id).toBe('desligado');
    }
    for (const [id, env] of [['prospeccao', 'PROSPECCAO_APIFY_OFF'], ['fb_inbox', 'FB_INBOX_OFF']] as const) {
      expect(selo(id, { [env]: ' true ' }), id).toBe('desligado');
      expect(selo(id, { [env]: 'TRUE' }), id).toBe('ligado');     // sem minúsculas no código
    }
  });

  it('Bia também precisa das credenciais da linha IO (só o nome da variável aparece)', () => {
    const com = { RECUP_ENABLED: 'true', ZAPI_INSTANCE_ID_IO: 'x', ZAPI_TOKEN_IO: 'y' };
    expect(selo('bia', com)).toBe('ligado');
    const e = estadoDaRegra(porId('bia').regra, { RECUP_ENABLED: 'true', ZAPI_INSTANCE_ID_IO: 'x' } as NodeJS.ProcessEnv, SEM_BANCO);
    expect(e.selo).toBe('desligado');
    expect(e.motivo).toContain('ZAPI_TOKEN_IO');
  });

  it('Duda: o freio de mão vence, e sem a chave do banco ela fica desligada', () => {
    expect(selo('duda_recepcao', {}, { recepcaoAtiva: true, helenaOff: false })).toBe('ligado');
    expect(selo('duda_recepcao', {}, { recepcaoAtiva: false, helenaOff: false })).toBe('desligado');
    expect(selo('duda_recepcao', {}, { recepcaoAtiva: null, helenaOff: null })).toBe('desligado');
    expect(selo('duda_recepcao', { RECEPCAO_IO_OFF: '1' }, { recepcaoAtiva: true, helenaOff: false })).toBe('desligado');
  });

  it('Helena: pausada pela chave do banco ou pelo freio de mão, ligada sem os dois', () => {
    expect(selo('helena', {}, { recepcaoAtiva: true, helenaOff: false })).toBe('ligado');
    expect(selo('helena', {}, { recepcaoAtiva: true, helenaOff: true })).toBe('pausado');
    expect(selo('helena', { INVESTIDOR_AGENTE_OFF: '1' }, { recepcaoAtiva: true, helenaOff: false })).toBe('pausado');
    // Disjuntor armado: as aberturas param, e a tela não diz "ligada".
    expect(selo('helena', {}, { recepcaoAtiva: true, helenaOff: false, helenaDisjuntor: true })).toBe('pausado');
    expect(selo('helena', {}, { recepcaoAtiva: true, helenaOff: false, helenaDisjuntor: false })).toBe('ligado');
    // Sem conseguir ler o banco o robô trata como desligado, e a tela não diz "ligada".
    expect(selo('helena', {}, { recepcaoAtiva: null, helenaOff: null })).toBe('pausado');
  });

  it('o estado nunca carrega o valor de uma variável, só o nome', () => {
    const regra: RegraDaChave = { tipo: 'desliga', env: 'EP_COBRA_SIM_OFF', valor: '1', trim: true };
    const e = estadoDaRegra(regra, { EP_COBRA_SIM_OFF: '1' } as NodeJS.ProcessEnv, SEM_BANCO);
    expect(e.chave).toBe('EP_COBRA_SIM_OFF');
    expect(JSON.stringify(e)).not.toMatch(/=\s*1|"1"/);
  });
});

describe('a resposta da Central', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T15:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  it('traz todos os cartões, cada um com nome, o que faz, área, selo e chave só pelo nome', async () => {
    const { montarCentralAgentes } = await import('../services/io/centralAgentes');
    const p = await montarCentralAgentes();
    expect(p.agentes.map(a => a.id).sort()).toEqual(CATALOGO.map(c => c.id).sort());
    expect(p.areas.map(a => a.id)).toEqual(AREAS.map(a => a.id));
    const areas = new Set(p.areas.map(a => a.id));
    for (const a of p.agentes) {
      expect(a.nome, a.id).toBeTruthy();
      expect(a.resumo, a.id).toBeTruthy();
      expect(areas.has(a.area), a.id).toBe(true);
      expect(['ligado', 'pausado', 'desligado'], a.id).toContain(a.selo);
      // Compatibilidade com a tela antiga, que lê `estado`.
      expect(['ativo', 'dark', 'desligado'], a.id).toContain(a.estado);
      // O destaque aponta para métricas que existem: no máximo duas.
      expect(a.destaque.length, a.id).toBeLessThanOrEqual(2);
      for (const i of a.destaque) expect(a.metricas[i], `${a.id} destaque ${i}`).toBeTruthy();
      if (a.chave) expect(a.chave, a.id).toMatch(/^[A-Za-z_:0-9]+( ou [A-Za-z_:0-9]+)*$/);
    }
    expect(p.resumo.ativos + p.resumo.pausados + p.resumo.desligados).toBe(p.agentes.length);
  }, 30_000);

  it('a resposta não leva telefone nem número de ficha escondido em texto de conversa', async () => {
    const { montarCentralAgentes } = await import('../services/io/centralAgentes');
    const p = await montarCentralAgentes();
    const texto = JSON.stringify(p);
    // Telefone brasileiro escrito por extenso (10 ou 11 dígitos seguidos, com ou sem 55).
    expect(texto).not.toMatch(/(?<!\d)(55)?\d{10,11}(?!\d)/);
  }, 30_000);
});
