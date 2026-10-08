import { describe, it, expect } from 'vitest';
import {
  acharCidadeRaio, caminhoPelasRespostas, decidirCaminho, kwhDaFaixa, FAIXAS_CONTA, KWH_VISITA,
  CIDADES_RAIO, kmDaBase, RAIO_VISITA_KM, blocoDoCompromisso, chegadaDeRota, pontuar, reservaDe, PONTOS_CURIOSO,
  horariosDoCaminho, ocupacaoDaFichaSolar, caminhoDaFicha, socioMaisPerto, MARCA_QUIZ,
} from '../services/agenda/solarRota';

const H = 60 * 60 * 1000;

describe('faixas da conta', () => {
  it('nenhuma faixa atravessa o corte de 1.000 kWh', () => {
    // O limite de cima de cada faixa tem que cair do mesmo lado que o valor típico dela.
    const lim: Record<string, [number, number]> = {
      ate300: [0, 300], '300_600': [300, 600], '600_1050': [600, 1050],
      '1050_2000': [1050, 2000], '2000_5000': [2000, 5000], '5000_mais': [5000, 1e9],
    };
    // "Grande" é acima de 1.000 kWh. Cada faixa inteira tem que ficar de um lado só:
    // o piso e o teto (em kWh) do mesmo lado que o valor típico que a régua usa.
    const grande = (reais: number) => reais / 1.05 > KWH_VISITA + 1e-9;
    for (const f of FAIXAS_CONTA) {
      const [de, ate] = lim[f.v];
      const tipico = kwhDaFaixa(f.v)! > KWH_VISITA;
      expect(grande(de + 1)).toBe(tipico);
      expect(grande(Math.min(ate, 1e6))).toBe(tipico);
    }
  });
  it('lê pelo meio a R$ 1,05', () => {
    expect(kwhDaFaixa('300_600')).toBe(429);
    expect(kwhDaFaixa('600_1050')).toBe(786);
    expect(kwhDaFaixa('1050_2000')).toBe(1452);
    expect(kwhDaFaixa('xx')).toBeNull();
  });
});

describe('cidades do raio', () => {
  it('são 44, todas até 150 km da base mais perto', () => {
    expect(CIDADES_RAIO).toHaveLength(44);
    for (const c of CIDADES_RAIO) expect(kmDaBase(c)).toBeLessThanOrEqual(RAIO_VISITA_KM);
  });
  it('acha com acento, sem acento, com UF e pelo apelido', () => {
    expect(acharCidadeRaio('Uberlândia')?.nome).toBe('Uberlândia');
    expect(acharCidadeRaio('uberlandia mg')?.nome).toBe('Uberlândia');
    expect(acharCidadeRaio('Uberlândia - MG')?.nome).toBe('Uberlândia');
    expect(acharCidadeRaio('Catalão-GO')?.nome).toBe('Catalão');
    expect(acharCidadeRaio('Udi')?.nome).toBe('Uberlândia');
    expect(acharCidadeRaio('Patos de Minas')).toBeNull();
    expect(acharCidadeRaio('')).toBeNull();
  });
  it('quem chega mais rápido vai', () => {
    expect(socioMaisPerto(acharCidadeRaio('Catalão')!)).toBe('Thiago');
    expect(socioMaisPerto(acharCidadeRaio('Uberaba')!)).toBe('Diego');
    expect(socioMaisPerto(acharCidadeRaio('Ituiutaba')!)).toBe('Diego');
  });
});

// Respostas de quem está fechando: para já, decide sozinho, à vista, imóvel próprio, comparando (100).
const QUENTE = { urgencia: 'ja', decisor: 'eu', pagamento: 'vista', imovel: 'proprio', concorrente: 'sim' };
// Quem está no meio: 3 meses, decide junto, financia, próprio, primeiro orçamento (18+14+16+15+5 = 68).
const MORNO = { urgencia: '3meses', decisor: 'junto', pagamento: 'financiamento', imovel: 'proprio', concorrente: 'nao' };
// Curioso: pesquisando, outra pessoa decide, não sabe pagar, alugado (0+0+0+0+5 = 5).
const FRIO = { urgencia: 'pesquisando', decisor: 'outro', pagamento: 'naosei', imovel: 'alugado', concorrente: 'nao' };

describe('a pontuação (0 a 100)', () => {
  it('quem está fechando faz 100; o morno 68; o curioso 5', () => {
    expect(pontuar(QUENTE).pontos).toBe(100);
    expect(pontuar(MORNO).pontos).toBe(68);
    expect(pontuar(FRIO).pontos).toBe(5);
  });
  it('"nos próximos 3 meses" com o resto no máximo não passa de 90', () => {
    expect(pontuar({ ...QUENTE, urgencia: '3meses' }).pontos).toBe(83);
  });
  it('financiar e não estar comparando ainda passa de 90', () => {
    expect(pontuar({ ...QUENTE, pagamento: 'financiamento', concorrente: 'nao' }).pontos).toBe(91);
  });
  it('resposta que falta vale zero', () => {
    expect(pontuar({}).pontos).toBe(0);
  });
});

describe('o caminho (regras de 08/10)', () => {
  it('abaixo de 40 pontos é curioso, sem agenda, de qualquer tamanho', () => {
    expect(PONTOS_CURIOSO).toBe(40);
    const d = caminhoPelasRespostas({ conta: '5000_mais', cidade: 'Uberlândia', ...FRIO });
    expect(d.caminho).toBe('curioso');
    expect(d.candidatos).toEqual([]);
  });
  it('acima de 1.000 kWh, acima de 90 pontos e até 150 km de Uberlândia: visita do Diego', () => {
    expect(caminhoPelasRespostas({ conta: '1050_2000', cidade: 'Uberlândia', ...QUENTE })).toMatchObject({ caminho: 'vistoria', candidatos: ['Diego'] });
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE })).toMatchObject({ caminho: 'vistoria', candidatos: ['Diego'] });
  });
  it('acima de 1.000 kWh sem os 90 pontos: atendimento do Thiago, sem visita', () => {
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: 'Uberlândia', ...MORNO })).toMatchObject({ caminho: 'video', candidatos: ['Thiago'] });
  });
  it('acima de 1.000 kWh e 90 pontos, mas longe de Uberlândia: Thiago (Caldas Novas fica a 173 km do Diego)', () => {
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: 'Caldas Novas', ...QUENTE })).toMatchObject({ caminho: 'video', candidatos: ['Thiago'] });
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: 'Patos de Minas', ...QUENTE })).toMatchObject({ caminho: 'video', candidatos: ['Thiago'] });
  });
  it('de 300 a 1.000 kWh é ligação da Nilce; até 300, da Giovanna', () => {
    expect(caminhoPelasRespostas({ conta: '300_600', cidade: 'Uberlândia', ...QUENTE })).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'] });
    expect(caminhoPelasRespostas({ conta: '600_1050', cidade: 'Uberaba', ...MORNO })).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'] });
    expect(caminhoPelasRespostas({ conta: 'ate300', cidade: 'Uberlândia', ...QUENTE })).toMatchObject({ caminho: 'ligacao', candidatos: ['Giovanna'] });
  });
});

describe('quem atende quando o telefone já tem dono', () => {
  it('cliente da Nilce fica com ela e a ficha diz o que ele qualificaria', () => {
    const d = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE }, 'Nilce');
    expect(d).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'], qualifica: 'vistoria' });
  });
  it('cliente do Thiago que qualifica visita: o Thiago atende e marca com o Diego', () => {
    const d = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE }, 'Thiago');
    expect(d).toMatchObject({ caminho: 'video', candidatos: ['Thiago'], qualifica: 'vistoria' });
  });
  it('curioso continua curioso mesmo com dono', () => {
    expect(decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...FRIO }, 'Diego').caminho).toBe('curioso');
  });
  it('sem horário a visita desce para o Thiago e o Thiago para a Nilce', () => {
    const v = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão', ...QUENTE });
    const r1 = reservaDe(v)!;
    expect(r1).toMatchObject({ caminho: 'video', candidatos: ['Thiago'], qualifica: 'vistoria' });
    expect(reservaDe(r1)).toMatchObject({ caminho: 'ligacao', candidatos: ['Nilce'], qualifica: 'vistoria' });
    expect(reservaDe(reservaDe(r1)!)).toBeNull();
  });
});

describe('tempo de agenda', () => {
  it('visita em Catalão ocupa a manhã do Thiago, da saída à volta', () => {
    const cat = acharCidadeRaio('Catalão')!;
    expect(chegadaDeRota(cat, 'Thiago')).toBe('09:00');   // sai 08:00, 58 min de estrada
    const t = new Date('2026-10-13T09:00:00-03:00').getTime();
    const b = blocoDoCompromisso('vistoria', t, 'Thiago', cat);
    expect((t - b.ini) / 60000).toBe(58);
    expect((b.fim - t) / 60000).toBe(60 + 58);
  });
  it('estrada acima de 1h40 sai às 07:30', () => {
    expect(chegadaDeRota(acharCidadeRaio('Ituiutaba')!, 'Diego')).toBe('09:30');   // 07:30 + 112 min
  });
  it('visita na base usa a grade dos sócios; fora, uma chegada por manhã de terça a sexta', () => {
    const udi = acharCidadeRaio('Uberlândia')!, cat = acharCidadeRaio('Catalão')!;
    expect(horariosDoCaminho('vistoria', '2026-10-13', 'Diego', udi)).toContain('08:00');
    expect(horariosDoCaminho('vistoria', '2026-10-13', 'Thiago', cat)).toEqual(['09:00']);   // terça
    expect(horariosDoCaminho('vistoria', '2026-10-12', 'Thiago', cat)).toEqual([]);          // segunda
    expect(horariosDoCaminho('ligacao', '2026-10-12', 'Nilce', null)).toHaveLength(14);
    expect(horariosDoCaminho('vistoria', '2026-10-13', 'Nilce', udi)).toEqual([]);
  });
});

describe('ocupação de ficha que já existe', () => {
  const q = '2026-10-13T09:00:00-03:00';
  it('ficha do quiz lê o caminho da primeira linha', () => {
    expect(caminhoDaFicha(`${MARCA_QUIZ} · Casa · VISTORIA PRESENCIAL\nConta`)).toBe('vistoria');
    expect(caminhoDaFicha(`${MARCA_QUIZ} · Empresa · VIDEOCHAMADA`)).toBe('video');
    expect(caminhoDaFicha(`${MARCA_QUIZ} · Casa · LIGAÇÃO`)).toBe('ligacao');
    expect(caminhoDaFicha('LP SOLAR — Residência')).toBeNull();
  });
  it('vistoria do quiz em Catalão bloqueia da saída à volta', () => {
    const o = ocupacaoDaFichaSolar({ quando: q, vendedor_nome: 'Thiago', created_by: 'lp_solar', cidade: 'Catalão-GO', observacao: `${MARCA_QUIZ} · Empresa · VISTORIA PRESENCIAL` })!;
    expect((o.fim - o.ini) / 60000).toBe(58 + 60 + 58);
  });
  it('ficha antiga da LP vale 1h no sócio e 15 min no resto, como antes', () => {
    const t = new Date(q).getTime();
    expect(ocupacaoDaFichaSolar({ quando: q, vendedor_nome: 'Diego', created_by: 'lp_solar', observacao: 'LP SOLAR — Residência' })).toEqual({ ini: t, fim: t + H });
    expect(ocupacaoDaFichaSolar({ quando: q, vendedor_nome: 'Nilce', created_by: 'lp_solar' })).toEqual({ ini: t, fim: t + H / 4 });
  });
  it('ficha de outra origem não é com este arquivo', () => {
    expect(ocupacaoDaFichaSolar({ quando: q, vendedor_nome: 'Diego', created_by: 'lead-meta' })).toBeNull();
  });
});
