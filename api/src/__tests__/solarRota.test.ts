import { describe, it, expect } from 'vitest';
import {
  acharCidadeRaio, caminhoPelasRespostas, decidirCaminho, kwhDaFaixa, FAIXAS_CONTA, KWH_VISITA,
  CIDADES_RAIO, kmDaBase, RAIO_VISITA_KM, CIDADES_VISITA_SEMPRE, blocoDoCompromisso, chegadaDeRota,
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

describe('o caminho (ordem de 07/10: presencial só acima de 1.000 kWh)', () => {
  it('Uberlândia com conta pequena começa pela ligação', () => {
    expect(CIDADES_VISITA_SEMPRE).toHaveLength(0);
    expect(caminhoPelasRespostas({ conta: '300_600', cidade: 'Uberlândia', urgencia: 'ja' }).caminho).toBe('ligacao');
  });
  it('acima de 1.000 kWh no raio é vistoria, inclusive na base', () => {
    expect(caminhoPelasRespostas({ conta: '1050_2000', cidade: 'Uberlândia' }).caminho).toBe('vistoria');
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: 'Catalão' }).caminho).toBe('vistoria');
    expect(caminhoPelasRespostas({ conta: '5000_mais', cidade: 'Comendador Gomes' }).caminho).toBe('vistoria');
  });
  it('acima de 1.000 kWh fora do raio é videochamada', () => {
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: 'Patos de Minas' }).caminho).toBe('video');
    expect(caminhoPelasRespostas({ conta: '2000_5000', cidade: '' }).caminho).toBe('video');
  });
  it('até 1.000 kWh em qualquer lugar é ligação', () => {
    expect(caminhoPelasRespostas({ conta: '600_1050', cidade: 'Uberaba' }).caminho).toBe('ligacao');
    expect(caminhoPelasRespostas({ conta: 'ate300', cidade: 'Belo Horizonte' }).caminho).toBe('ligacao');
  });
});

describe('quem atende', () => {
  it('vistoria fora da base vai para o sócio mais perto, com o outro de reserva', () => {
    expect(decidirCaminho({ conta: '2000_5000', cidade: 'Catalão' }).candidatos).toEqual(['Thiago', 'Diego']);
    expect(decidirCaminho({ conta: '2000_5000', cidade: 'Uberaba' }).candidatos).toEqual(['Diego', 'Thiago']);
  });
  it('vistoria em Uberlândia segue o rodízio', () => {
    expect(decidirCaminho({ conta: '1050_2000', cidade: 'Uberlândia' }, null, 'Diego').candidatos).toEqual(['Diego', 'Thiago']);
    expect(decidirCaminho({ conta: '1050_2000', cidade: 'Uberlândia' }, null, 'Thiago').candidatos).toEqual(['Thiago', 'Diego']);
  });
  it('ligação é da Nilce', () => {
    expect(decidirCaminho({ conta: '300_600', cidade: 'Uberlândia' }).candidatos).toEqual(['Nilce']);
  });
  it('cliente da Nilce fica com ela e a ficha diz o que ele qualificaria', () => {
    const d = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão' }, 'Nilce');
    expect(d.caminho).toBe('ligacao');
    expect(d.candidatos).toEqual(['Nilce']);
    expect(d.qualifica).toBe('vistoria');
  });
  it('cliente de sócio fica com o sócio no caminho calculado', () => {
    const d = decidirCaminho({ conta: '2000_5000', cidade: 'Catalão' }, 'Diego');
    expect(d.caminho).toBe('vistoria');
    expect(d.candidatos).toEqual(['Diego']);
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
