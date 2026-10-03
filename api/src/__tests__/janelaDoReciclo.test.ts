import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── "ESSES FICAM ONDE ESTAVAM" (03/10/2026) ────────────────────────────────
//
// Ordem do dono depois de abrir a agenda de 05 a 09/10 e achar 53 cards cuja
// reunião de origem era de julho, de junho, de maio. O pior tinha 136 dias e
// chegou com a etiqueta "Ciclo de 48h, 1ª volta".
//
// A causa não foi defeito de código: foi um NÚMERO. Em 29/09 ele pediu os
// antigos de volta e eu troquei a janela dos dois reciclos de 7 pra 365 dias. O
// efeito levou uma semana pra aparecer porque a rampa solta poucas fichas por
// dia — quando a fila chegou nos antigos, ela despejou a base de maio em cima
// da semana dele.
//
// É exatamente o tipo de erro que teste de comportamento não pega: cada peça
// funcionou como foi escrita. O que este arquivo prende é o NÚMERO, e o fato de
// que os dois reciclos têm que ter o mesmo, porque o Thiago vê UMA agenda.

const RAIZ = join(__dirname, '..');
const EP = readFileSync(join(RAIZ, 'services', 'io', 'eletropostoReagendaAuto.ts'), 'utf8');
const SO = readFileSync(join(RAIZ, 'services', 'agenda', 'reagendaSolarNaoAtendido.ts'), 'utf8');

/**
 * O default escrito no `num('ENV', N)`.
 *
 * Sem regex montado em string de propósito: neste repo o heredoc já comeu a
 * barra do `\d` mais de uma vez, e sonda que erra o padrão não falha — ela
 * passa, porque não acha nada.
 */
const janelaDe = (txt: string, env: string): number => {
  const marca = "num('" + env + "',";
  const i = txt.indexOf(marca);
  if (i < 0) throw new Error('nao achei a chamada de ' + env);
  const depois = txt.slice(i + marca.length).trim();
  const digitos = depois.slice(0, depois.indexOf(')')).trim();
  const n = Number(digitos);
  if (!Number.isFinite(n)) throw new Error('o default de ' + env + ' nao e numero: ' + digitos);
  return n;
};

describe('a janela dos dois reciclos', () => {
  it('a sonda sabe ler o numero (senao ela aprova qualquer coisa)', () => {
    // Prova de que o `indexOf` acha mesmo o que eu quero que ele ache. Sem
    // isto, um `num(` renomeado faria os testes abaixo passarem por engano.
    expect(() => janelaDe(EP, 'EP_NAO_EXISTE_ESTA_CHAVE')).toThrow();
    expect(janelaDe(EP, 'EP_REAGENDA_JANELA_DIAS')).toBeTypeOf('number');
  });

  it('o eletroposto enxerga 21 dias pra tras, nao um ano', () => {
    expect(janelaDe(EP, 'EP_REAGENDA_JANELA_DIAS')).toBe(21);
  });

  it('o solar enxerga os mesmos 21', () => {
    expect(janelaDe(SO, 'SOLAR_REAGENDA_JANELA_DIAS')).toBe(21);
  });

  it('os dois sao IGUAIS: uma agenda, um corte', () => {
    // Divergir aqui faz o quadro mentir de um jeito difícil de ver: metade dos
    // cards velhos volta (os do produto com a janela maior) e a outra não.
    expect(janelaDe(EP, 'EP_REAGENDA_JANELA_DIAS'))
      .toBe(janelaDe(SO, 'SOLAR_REAGENDA_JANELA_DIAS'));
  });

  it('nenhum dos dois volta pra ordem de grandeza de MES', () => {
    const casos: Array<[string, number]> = [
      ['eletroposto', janelaDe(EP, 'EP_REAGENDA_JANELA_DIAS')],
      ['solar', janelaDe(SO, 'SOLAR_REAGENDA_JANELA_DIAS')],
    ];
    for (const [nome, n] of casos) {
      // 31 já é o começo do que ele mandou parar.
      expect(n, nome + ': janela de ' + n + ' dias traz cadaver de volta').toBeLessThanOrEqual(30);
      // E nem some: menos de 8 dias mataria a própria escada do `negocia`, que
      // cresce 24h por volta e passa de uma semana nos degraus de cima.
      expect(n, nome + ': janela de ' + n + ' dias corta a escada de 48h').toBeGreaterThanOrEqual(8);
    }
  });

  it('a escada NUNCA passa a janela: senao o card some sozinho', () => {
    // O defeito que isto prende, achado em 03/10 junto com o conserto da janela:
    // `horasDoDegrau` era `48 + 24·(d−1)` sem teto. Com a janela em 365 isso
    // nunca encostava em nada. Com ela em 21, o degrau 21 pede 528h de descanso
    // — o card só ficaria elegível com `quando` de 22 dias atrás, um dia DEPOIS
    // de a janela ja te-lo excluido. Ele viraria numero no log de "FORA da
    // janela" e nao voltaria nunca mais, sem ninguem ter decidido isso.
    //
    // A trava nao e o numero do teto: e o teto SAIR da janela. Quem mexer num
    // dos dois mexe no outro sem saber que mexeu.
    for (const [nome, txt] of [['eletroposto', EP], ['solar', SO]] as [string, string][]) {
      expect(txt, nome + ': horasDoDegrau sem Math.min, a escada nao tem teto')
        .toContain('export const horasDoDegrau = (d: number): number => Math.min(');
      expect(txt, nome + ': o teto do degrau nao sai de janelaDias()')
        .toContain('(janelaDias() - FOLGA_ATE_A_BORDA_DIAS) * 24');
    }
  });

  it('e o teto medido fica DENTRO da janela, com folga', async () => {
    // Prova de verdade: chama as funções e compara. O teste de texto acima pega
    // quem apagar o `Math.min`; este pega quem trocar a conta por dentro.
    const ep = await import('../services/io/eletropostoReagendaAuto');
    const so = await import('../services/agenda/reagendaSolarNaoAtendido');
    for (const [nome, m, env] of [
      ['eletroposto', ep, 'EP_REAGENDA_JANELA_DIAS'],
      ['solar', so, 'SOLAR_REAGENDA_JANELA_DIAS'],
    ] as [string, { tetoDoDegrauH: () => number; horasDoDegrau: (d: number) => number }, string][]) {
      const janelaH = janelaDe(nome === 'solar' ? SO : EP, env) * 24;
      expect(m.tetoDoDegrauH(), nome + ': o teto do degrau passa a janela')
        .toBeLessThan(janelaH);
      // e nenhum degrau, nem um absurdo, escapa do teto
      for (const d of [1, 2, 5, 13, 21, 50, 999]) {
        expect(m.horasDoDegrau(d), nome + ': degrau ' + d + ' passa a janela')
          .toBeLessThan(janelaH);
      }
      // a escada continua subindo onde importa: 48h no 1, 72h no 2
      expect(m.horasDoDegrau(1), nome + ': o degrau 1 deixou de ser 48h').toBe(48);
      expect(m.horasDoDegrau(2), nome + ': o degrau 2 deixou de ser 72h').toBe(72);
      expect(m.horasDoDegrau(999), nome + ': o degrau 999 nao bateu no teto')
        .toBe(m.tetoDoDegrauH());
    }
  });

  it('os dois CONTAM o que a janela deixou de fora', () => {
    // A janela agora ignora ficha de propósito. Ignorar calado é o defeito que
    // este módulo já levou uma vez, no corte de 1000 linhas do PostgREST.
    const casos: Array<[string, string]> = [['eletroposto', EP], ['solar', SO]];
    for (const [nome, txt] of casos) {
      expect(txt, nome + ' nao conta o que ficou fora da janela')
        .toContain("count: 'exact', head: true");
      expect(txt, nome + ' conta mas nao avisa').toContain('FORA da janela');
    }
  });
});
