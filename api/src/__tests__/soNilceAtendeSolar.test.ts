import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 23/11/2026, decisão do dono: o lead SOLAR é dividido por conta de luz (era só a Nilce desde 24/10/2026). O arquivo guarda o nome antigo
// de propósito (histórico do git), mas trava a divisão: os grupos, o déficit da fatia, o fallback de quem não tem horário, o freio
// SOLAR_DIVISAO_OFF e, do outro lado, que o ELETROPOSTO não andou.
//   · conta abaixo de R$ 800 (inclui "menos de R$ 400"): Nilce 50% e Giovanna 50%
//   · conta de R$ 800 para cima: Nilce 40%, Thiago 30% e Diego 30%

let linhasDoBanco: Array<Record<string, unknown>> = [];
let consultas = 0;
const cadeia = (): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'neq', 'gte', 'order']) c[m] = () => c;
  c.range = () => { consultas++; return Promise.resolve({ data: linhasDoBanco, error: null }); };
  return c;
};
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => cadeia() } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn().mockResolvedValue(false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { limparRespostas, decidirEMontar, msDe, horariosDoQuizDe, type Ocupacao } from '../services/io/solarQuiz';
import {
  decidirCaminho, donoDaFaixa, DONAS_LIGACAO, DONOS_DE_SOLAR, reservaDe, donoQueAindaAtendeSolar, grupoDaConta, grupoDaFaixaConta,
  ordenarPorDeficit, candidatosPadrao, GRUPOS_SOLAR, FAIXAS_CONTA, FAIXAS_CONTA_LEGADO,
} from '../services/agenda/solarRota';
import {
  candidatosDoGrupo, candidatosPorFaixa, candidatosPorKwh, candidatosPorReais, contarCards, reaisDaObservacao, grupoDaObservacao,
  grupoPorKwh, grupoPorReais, _limparCacheDivisao, ORIGENS_SOLAR_DIVISAO,
} from '../services/agenda/divisaoSolar';
import { donoDaVolta } from '../services/agenda/reagendaSolarNaoAtendido';
import { SOLAR_ORIGENS } from '../services/io/solarBoasVindas';
import { TEL_AVISO, EQUIPE as EQUIPE_SOLAR } from '../routes/ioSolar';

const AGORA = msDe('2026-10-26', '07:00');   // segunda-feira
// Nota 100 (pesos de 23/11/2026): prazo 35, decisor 20, pagamento 20, imóvel 15, orçamento 10 (já tem outro orçamento = 'nao').
const NOTA_100 = { urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', concorrente: 'nao', tipo: 'casa' };

/** Um card solar de `vendedor` na faixa de conta pedida (a observação do quiz: "Conta de luz: ..."). */
const card = (vendedor: string, contaTxt: string, extra: Record<string, unknown> = {}) =>
  ({ vendedor_nome: vendedor, observacao: `LP SOLAR QUIZ · Casa · LIGAÇÃO\nConta de luz: ${contaTxt} (~1.000 kWh/mês)`, status: 'agendado', ...extra });
const muitos = (vendedor: string, contaTxt: string, n: number) => Array.from({ length: n }, () => card(vendedor, contaTxt));

beforeEach(() => { _limparCacheDivisao(); linhasDoBanco = []; consultas = 0; delete process.env.SOLAR_DIVISAO_OFF; });
afterEach(() => { delete process.env.SOLAR_DIVISAO_OFF; });

describe('os grupos pela conta em reais', () => {
  it('a tabela: menor 50/50, maior 40/30/30, nesta ordem', () => {
    expect(GRUPOS_SOLAR.menor).toEqual({ Nilce: 50, Giovanna: 50 });
    expect(GRUPOS_SOLAR.maior).toEqual({ Nilce: 40, Thiago: 30, Diego: 30 });
    expect([...DONOS_DE_SOLAR].sort()).toEqual(['Diego', 'Giovanna', 'Nilce', 'Thiago']);
  });

  it('R$ 800 vai para o grupo maior; abaixo disso, o menor; sem valor legível, o menor', () => {
    expect(grupoDaConta(799.99)).toBe('menor');
    expect(grupoDaConta(800)).toBe('maior');
    expect(grupoDaConta(5000)).toBe('maior');
    expect(grupoDaConta(null)).toBe('menor');
    expect(grupoDaConta(0)).toBe('menor');
  });

  it('as 4 faixas do quiz', () => {
    expect(grupoDaFaixaConta('ate400')).toBe('menor');
    expect(grupoDaFaixaConta('400_800')).toBe('menor');
    expect(grupoDaFaixaConta('800_1200')).toBe('maior');
    expect(grupoDaFaixaConta('1200_mais')).toBe('maior');
    expect(FAIXAS_CONTA).toHaveLength(4);
  });

  it('as faixas legadas caem pelo valor típico', () => {
    const esperado: Record<string, string> = { ate300: 'menor', '300_600': 'menor', '600_1050': 'maior', '1050_2000': 'maior', '2000_5000': 'maior', '5000_mais': 'maior' };
    for (const f of FAIXAS_CONTA_LEGADO) expect(grupoDaFaixaConta(f.v), f.v).toBe(esperado[f.v]);
    expect(grupoDaFaixaConta('lixo')).toBe('menor');
  });

  it('Meta (kWh) e ManyChat (reais) convertem pela tarifa; sem consumo legível, grupo menor', () => {
    expect(grupoPorKwh('700 a 900')).toBe('maior');       // meio 800 kWh = R$ 840
    expect(grupoPorKwh('300 a 500')).toBe('menor');       // 400 kWh = R$ 420
    expect(grupoPorKwh('até 700')).toBe('menor');         // 350 kWh
    expect(grupoPorKwh('')).toBe('menor');
    expect(grupoPorKwh('não sei')).toBe('menor');
    expect(grupoPorReais('R$ 800 a R$ 1.500')).toBe('maior');
    expect(grupoPorReais('R$ 800')).toBe('maior');        // exatamente R$ 800 passa para o maior (centavos arredondados)
    expect(grupoPorReais('R$ 300 a R$ 500')).toBe('menor');
    expect(grupoPorReais('')).toBe('menor');
  });

  it('a observação do card: "Conta de luz:" (reais) e "Consumo:" (kWh ou reais)', () => {
    expect(reaisDaObservacao('x\nConta de luz: R$ 400 a R$ 800 (~571 kWh/mês)')).toBe(600);
    expect(reaisDaObservacao('x\nConta de luz: Acima de R$ 1.200 (~1.144 kWh/mês)')).toBe(1201);
    expect(reaisDaObservacao('x\nConsumo: 700 a 900')).toBe(840);
    expect(reaisDaObservacao('x\nConsumo: R$ 800 a R$ 1.500')).toBe(1150);
    expect(reaisDaObservacao('sem conta')).toBeNull();
    expect(grupoDaObservacao('sem conta')).toBe('menor');
  });
});

describe('a escolha por déficit', () => {
  it('sem nenhum card, vale a ordem da tabela (a Nilce primeiro)', () => {
    expect(ordenarPorDeficit('menor', {})).toEqual(['Nilce', 'Giovanna']);
    expect(ordenarPorDeficit('maior', {})).toEqual(['Nilce', 'Thiago', 'Diego']);
  });

  it('quem está mais abaixo da fatia vem primeiro; empate fica na ordem da tabela', () => {
    expect(ordenarPorDeficit('menor', { Nilce: 5, Giovanna: 2 })).toEqual(['Giovanna', 'Nilce']);
    expect(ordenarPorDeficit('menor', { Nilce: 2, Giovanna: 5 })).toEqual(['Nilce', 'Giovanna']);
    expect(ordenarPorDeficit('menor', { Nilce: 3, Giovanna: 3 })).toEqual(['Nilce', 'Giovanna']);
    expect(ordenarPorDeficit('maior', { Nilce: 4, Thiago: 0, Diego: 3 })).toEqual(['Thiago', 'Diego', 'Nilce']);
    expect(ordenarPorDeficit('maior', { Nilce: 4, Thiago: 3, Diego: 3 })).toEqual(['Nilce', 'Thiago', 'Diego']);   // 40/30/30 exatos: empate
  });

  it('girando um a um, a proporção fecha em 50/50 e 40/30/30', () => {
    for (const [g, n] of [['menor', 100], ['maior', 100]] as const) {
      const c: Record<string, number> = {};
      for (let i = 0; i < n; i++) { const p = ordenarPorDeficit(g, c)[0]; c[p] = (c[p] ?? 0) + 1; }
      for (const [nome, fatia] of Object.entries(GRUPOS_SOLAR[g])) expect(Math.abs((c[nome] ?? 0) - fatia), `${g} ${nome}`).toBeLessThanOrEqual(1);
    }
  });

  it('contarCards: separa por grupo e fora da conta ficam cancelado, SAIU SEM MARCAR e dono fora dos quatro', () => {
    const c = contarCards([
      card('Nilce', 'R$ 400 a R$ 800'), card('Giovanna', 'R$ 400 a R$ 800'), card('Thiago', 'R$ 800 a R$ 1.200'),
      card('Nilce', 'R$ 800 a R$ 1.200', { status: 'cancelado' }),
      { vendedor_nome: 'Nilce', observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO\nConta de luz: R$ 400 a R$ 800', status: 'agendado' },
      card('Luma', 'R$ 400 a R$ 800'),
      card('Thiago', 'R$ 400 a R$ 800'),   // sócio no grupo menor não conta (não está na tabela dele)
    ]);
    expect(c.menor).toEqual({ Nilce: 1, Giovanna: 1 });
    expect(c.maior).toEqual({ Thiago: 1 });
  });

  it('as origens da contagem são as mesmas de SOLAR_ORIGENS', () => {
    expect([...ORIGENS_SOLAR_DIVISAO].sort()).toEqual([...SOLAR_ORIGENS].sort());
  });
});

describe('a escolha no banco (cache, reserva, freio)', () => {
  it('conta de R$ 600: Giovanna quando a Nilce já tem mais, Nilce quando a Giovanna tem mais', async () => {
    linhasDoBanco = [...muitos('Nilce', 'R$ 400 a R$ 800', 4), ...muitos('Giovanna', 'R$ 400 a R$ 800', 1)];
    expect(await candidatosPorFaixa('400_800')).toEqual(['Giovanna', 'Nilce']);
    _limparCacheDivisao();
    linhasDoBanco = [...muitos('Nilce', 'R$ 400 a R$ 800', 1), ...muitos('Giovanna', 'R$ 400 a R$ 800', 4)];
    expect(await candidatosPorFaixa('400_800')).toEqual(['Nilce', 'Giovanna']);
  });

  it('conta de R$ 1.000 com o Thiago abaixo da fatia: Thiago primeiro', async () => {
    linhasDoBanco = [...muitos('Nilce', 'R$ 800 a R$ 1.200', 4), ...muitos('Diego', 'R$ 800 a R$ 1.200', 3), ...muitos('Thiago', 'R$ 800 a R$ 1.200', 1)];
    expect(await candidatosPorFaixa('800_1200')).toEqual(['Thiago', 'Diego', 'Nilce']);
  });

  it('o card de outro grupo não entra na conta: 20 cards pequenos da Nilce não atrasam a vez dela no grupo maior', async () => {
    linhasDoBanco = [...muitos('Nilce', 'R$ 400 a R$ 800', 20), ...muitos('Thiago', 'R$ 800 a R$ 1.200', 1)];
    expect((await candidatosPorFaixa('1200_mais'))[0]).toBe('Nilce');
  });

  it('Meta e ManyChat usam a mesma lista, pelo grupo da conta', async () => {
    linhasDoBanco = [...muitos('Nilce', 'R$ 800 a R$ 1.200', 5), ...muitos('Thiago', 'R$ 800 a R$ 1.200', 3), ...muitos('Diego', 'R$ 800 a R$ 1.200', 2)];
    expect((await candidatosPorKwh('1.000 a 1.400'))[0]).toBe('Diego');
    expect((await candidatosPorReais('R$ 1.000'))[0]).toBe('Diego');
    expect(await candidatosPorKwh('200 a 300')).toEqual(['Nilce', 'Giovanna']);   // grupo menor, sem card: ordem da tabela
  });

  it('a contagem fica em cache por 60 s: um lead atrás do outro lê o banco uma vez só', async () => {
    linhasDoBanco = muitos('Nilce', 'R$ 400 a R$ 800', 1);
    await candidatosDoGrupo('menor', { agoraMs: 1_000_000 });
    await candidatosDoGrupo('maior', { agoraMs: 1_030_000 });
    expect(consultas).toBe(1);
    await candidatosDoGrupo('menor', { agoraMs: 1_061_000 });
    expect(consultas).toBe(2);
  });

  it('com `reservar`, a escolha já entra na contagem: o lote do mesmo sync não cai todo na mesma pessoa', async () => {
    const vistos: string[] = [];
    for (let i = 0; i < 6; i++) vistos.push((await candidatosDoGrupo('menor', { reservar: true }))[0]);
    expect(vistos).toEqual(['Nilce', 'Giovanna', 'Nilce', 'Giovanna', 'Nilce', 'Giovanna']);
  });

  it('banco fora do ar: a ordem da tabela, sem lançar', async () => {
    const { supabaseGerador } = await import('../utils/supabaseGerador');
    const original = (supabaseGerador as { from: unknown }).from;
    (supabaseGerador as { from: unknown }).from = () => { throw new Error('banco fora'); };
    try { expect(await candidatosDoGrupo('maior')).toEqual(['Nilce', 'Thiago', 'Diego']); }
    finally { (supabaseGerador as { from: unknown }).from = original; }
  });

  it('o freio SOLAR_DIVISAO_OFF=1 volta a ser só a Nilce, sem tocar no banco', async () => {
    process.env.SOLAR_DIVISAO_OFF = '1';
    linhasDoBanco = muitos('Nilce', 'R$ 800 a R$ 1.200', 9);
    expect(await candidatosPorFaixa('800_1200')).toEqual(['Nilce']);
    expect(await candidatosPorFaixa('ate400')).toEqual(['Nilce']);
    expect(consultas).toBe(0);
    expect(candidatosPadrao('maior')).toEqual(['Nilce']);
    expect(donoDaFaixa(2000)).toBe('Nilce');
    expect(donoQueAindaAtendeSolar('Giovanna')).toBeNull();
    const r = limparRespostas({ conta: '800_1200', cidade: 'Uberlândia', ...NOTA_100 });
    expect(decidirCaminho(r, null, null, ['Thiago', 'Diego']).candidatos).toEqual(['Nilce']);
    expect(decidirEMontar(r, null, [], AGORA, null, { grade: 'quiz' }).dono).toBe('Nilce');
    expect(decidirEMontar(r, 'Thiago', [], AGORA, null, { grade: 'quiz' }).dono).toBe('Nilce');   // com o freio, cliente de sócio vira da Nilce
  });
});

describe('lead novo de solar: ligação, com o dono da divisão', () => {
  // As faixas do quiz que representam ~250 kWh (a menor), ~800 kWh e ~2.000 kWh ou mais.
  const casos = [
    { rotulo: 'conta menor que R$ 400', conta: 'ate400', lista: ['Nilce', 'Giovanna'] },
    { rotulo: 'conta de R$ 800 a R$ 1.200', conta: '800_1200', lista: ['Nilce', 'Thiago', 'Diego'] },
    { rotulo: 'conta acima de R$ 1.200', conta: '1200_mais', lista: ['Nilce', 'Thiago', 'Diego'] },
  ];

  for (const c of casos) {
    it(`${c.rotulo}, nota 100, em Uberlândia: ligação, candidatos ${c.lista.join(', ')}`, () => {
      const r = limparRespostas({ conta: c.conta, cidade: 'Uberlândia', ...NOTA_100 });
      const dec = decidirCaminho(r);
      expect(dec.pontos).toBe(100);
      expect(dec).toMatchObject({ caminho: 'ligacao', candidatos: c.lista });
      expect(dec.treino).toBeFalsy();
      expect(reservaDe(dec)).toBeNull();
    });
  }

  it('a conta grande dentro do raio guarda a visita só como informação, sem campo novo', () => {
    const grande = decidirCaminho(limparRespostas({ conta: '1200_mais', cidade: 'Uberlândia', ...NOTA_100 }));
    expect(grande.qualifica).toBe('vistoria');
    expect(decidirCaminho(limparRespostas({ conta: 'ate400', cidade: 'Uberlândia', ...NOTA_100 })).qualifica).toBeNull();
  });

  it('curioso continua curioso, sem agenda', () => {
    const r = limparRespostas({ conta: '1200_mais', cidade: 'Uberlândia', urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado', tipo: 'casa' });
    expect(decidirCaminho(r)).toMatchObject({ caminho: 'curioso', candidatos: [] });
  });

  it('o cliente que já tem dono fica com ele, os quatro valem (a Giovanna volta a ser dona de solar)', () => {
    const r = limparRespostas({ conta: 'ate400', cidade: 'Uberlândia', ...NOTA_100 });
    expect(decidirCaminho(r, 'Giovanna')).toMatchObject({ caminho: 'ligacao', candidatos: ['Giovanna'] });
    expect(decidirCaminho(r, 'Nilce')).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'] });
    expect(donoQueAindaAtendeSolar('Giovanna')).toBe('Giovanna');
    expect(donoQueAindaAtendeSolar('')).toBeNull();
    expect([...DONAS_LIGACAO]).toEqual(['Nilce', 'Giovanna']);
  });
});

describe('a vitrine do quiz, por pessoa', () => {
  const r800 = limparRespostas({ conta: '800_1200', cidade: 'Uberlândia', ...NOTA_100 });
  const r600 = limparRespostas({ conta: '400_800', cidade: 'Uberlândia', ...NOTA_100 });
  const cheia = (dono: string): Ocupacao => ({ dono, ini: AGORA - 3_600_000, fim: AGORA + 20 * 86_400_000 });

  it('a vitrine mostra os horários do 1º candidato da lista, sem misturar donos', () => {
    const v = decidirEMontar(r800, null, [], AGORA, null, { grade: 'quiz', candidatos: ['Thiago', 'Diego', 'Nilce'] });
    expect(v.dono).toBe('Thiago');
    expect(v.semHorario).toBe(false);
    for (const d of v.dias) for (const h of d.horas) expect(h.dono).toBe('Thiago');
    expect(v.dec.candidatos[0]).toBe('Thiago');
  });

  it('o sócio sem horário nos 14 dias passa para o próximo da lista', () => {
    const v = decidirEMontar(r800, null, [cheia('Thiago')], AGORA, null, { grade: 'quiz', candidatos: ['Thiago', 'Diego', 'Nilce'] });
    expect(v.dono).toBe('Diego');
    for (const d of v.dias) for (const h of d.horas) expect(h.dono).toBe('Diego');
    const v2 = decidirEMontar(r800, null, [cheia('Thiago'), cheia('Diego')], AGORA, null, { grade: 'quiz', candidatos: ['Thiago', 'Diego', 'Nilce'] });
    expect(v2.dono).toBe('Nilce');
  });

  it('ninguém com horário: sem vitrine, e o dono é o 1º da lista', () => {
    const v = decidirEMontar(r600, null, [cheia('Nilce'), cheia('Giovanna')], AGORA, null, { grade: 'quiz', candidatos: ['Giovanna', 'Nilce'] });
    expect(v).toMatchObject({ semHorario: true, dias: [], dono: 'Giovanna' });
  });

  it('cada pessoa tem a sua grade: Nilce a do quiz, Giovanna a de cliente novo, sócios as meias-horas encaixadas', () => {
    const seg = '2026-10-26';
    expect(horariosDoQuizDe('Nilce', seg)[0]).toBe('07:00');
    expect(horariosDoQuizDe('Giovanna', seg)[0]).toBe('08:00');
    expect(horariosDoQuizDe('Giovanna', seg)[horariosDoQuizDe('Giovanna', seg).length - 1]).toBe('16:30');
    expect(horariosDoQuizDe('Thiago', seg)).toContain('13:30');
    expect(horariosDoQuizDe('Thiago', seg)).not.toContain('10:00');
    expect(horariosDoQuizDe('Diego', seg)).toEqual(horariosDoQuizDe('Thiago', seg));
    expect(horariosDoQuizDe('Giovanna', '2026-10-31')).toEqual([]);   // sábado: só a Nilce
    expect(horariosDoQuizDe('Nilce', '2026-10-31').length).toBeGreaterThan(0);
    expect(horariosDoQuizDe('Luma', seg)).toEqual([]);
  });

  it('a ocupação real do sócio (o eletroposto também) tira o horário dele', () => {
    const ep: Ocupacao = { dono: 'Thiago', ini: msDe('2026-10-26', '08:00'), fim: msDe('2026-10-26', '08:30') };
    const v = decidirEMontar(r800, null, [ep], AGORA, null, { grade: 'quiz', candidatos: ['Thiago'] });
    expect(v.dias[0].horas.map(h => h.h)).not.toContain('08:00');
    expect(v.dias[0].horas.map(h => h.h)).toContain('08:30');
  });

  it('cliente que já tem dono tem só o dono na vitrine (o dono vence a lista)', () => {
    const v = decidirEMontar(r600, 'Giovanna', [], AGORA, null, { grade: 'quiz', candidatos: ['Nilce', 'Giovanna'] });
    expect(v.dono).toBe('Giovanna');
    expect(v.dec.candidatos).toEqual(['Giovanna']);
  });
});

describe('o aviso da ficha do quiz chega em quem atende (TEL_AVISO)', () => {
  it('os quatro têm telefone no mapa, o que já existe no código', () => {
    for (const k of ['nilce', 'giovanna', 'thiago', 'diego']) expect(TEL_AVISO[k], k).toBeTruthy();
    expect(EQUIPE_SOLAR.nilce).toBe(TEL_AVISO.nilce);
  });
});

describe('o NÃO ATENDEU mantém o mesmo dono', () => {
  it('sem nenhuma env, a Giovanna segue com a Giovanna e todos ficam onde estão', () => {
    delete process.env.SOLAR_NAO_ATENDEU_TROCA_ON;
    for (const d of ['Nilce', 'Giovanna', 'Thiago', 'Diego']) expect(donoDaVolta(d, 'nao_atendeu')).toBe(d);
  });
  it('com o freio SOLAR_DIVISAO_OFF=1, o card da Giovanna volta para a Nilce (a regra de 24/10)', () => {
    process.env.SOLAR_DIVISAO_OFF = '1';
    expect(donoDaVolta('Giovanna', 'nao_atendeu')).toBe('Nilce');
    expect(donoDaVolta('Thiago', 'nao_atendeu')).toBe('Thiago');
  });
});

describe('o eletroposto continua com o roteamento de antes', () => {
  const SRC = join(__dirname, '..');
  const lerImports = (arq: string) => readFileSync(arq, 'utf8').split(/\r?\n/).filter(l => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /require\(/.test(l));
  const arquivosEletroposto = (): string[] => ['services/io', 'services/agenda', 'routes'].flatMap(pasta =>
    readdirSync(join(SRC, pasta)).filter(f => /^eletroposto.*\.ts$/i.test(f) || /^ioEletroposto.*\.ts$/.test(f) || /^geradorEletroposto.*\.ts$/.test(f))
      .map(f => join(SRC, pasta, f)));

  it('nenhum arquivo de eletroposto lê o roteamento do solar que mudou', () => {
    const arquivos = arquivosEletroposto();
    expect(arquivos.length).toBeGreaterThan(10);
    const proibido = /['"][^'"]*\/(solarRota|leadSolarFicha|reagendaSolarNaoAtendido|divisaoSolar|filaContaBaixa)['"]/;
    for (const arq of arquivos) {
      for (const linha of lerImports(arq)) expect(linha, arq).not.toMatch(proibido);
    }
  });

  it('o EQUIPE do eletroposto segue sendo só Thiago e Diego', async () => {
    const { EQUIPE } = await import('../routes/ioEletroposto');
    expect(Object.keys(EQUIPE).sort()).toEqual(['diego', 'thiago']);
  });

  it('o card de eletroposto continua valendo 30 min (15 na faixa de remarcação), como antes', async () => {
    const { blocoDaFicha } = await import('../services/io/solarQuiz');
    const dur = (a: Record<string, unknown>) => { const b = blocoDaFicha(a as never)!; return (b.fim - b.ini) / 60000; };
    expect(dur({ quando: '2026-10-26T14:00:00-03:00', created_by: 'lp_eletroposto', vendedor_nome: 'Diego' })).toBe(30);
    expect(dur({ quando: '2026-10-26T14:15:00-03:00', created_by: 'lp_eletroposto', vendedor_nome: 'Diego' })).toBe(15);
  });

  it('a tabela de destino da recepção segue Thiago e Diego (e solar sem card cai na Nilce, 1 destino)', () => {
    const src = readFileSync(join(SRC, 'services', 'io', 'recepcaoIo.ts'), 'utf8');
    expect(src).toMatch(/eletroposto:\s*\['thiago', 'diego'\]/);
    expect(src).toMatch(/solar:\s*\['nilce'\]/);
    expect(src).toMatch(/solardoc:\s*\['thiago'\]/);
  });

  it('a tabela de destino da sentinela (desde 08/11/2026): Giovanna e Diego no eletroposto, Giovanna no resto; solar com card vai ao dono do card', () => {
    const src = readFileSync(join(SRC, 'services', 'io', 'sentinelaVacuo.ts'), 'utf8');
    expect(src).toMatch(/eletroposto:\s*\['giovanna', 'diego'\]/);
    expect(src).toMatch(/solar:\s*\['nilce'\]/);
    expect(src).toMatch(/solardoc:\s*\['giovanna'\]/);
    expect(src).toMatch(/\[card\.dono, \.\.\.nivel\.sobe\]/);
  });
});
