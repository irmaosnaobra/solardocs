import { describe, it, expect } from 'vitest';
import * as T from '../services/io/investidorAgenteTextos';

// Os textos da Helena vieram do redator e são trocados por ele. Este teste não
// fixa a redação: fixa o que QUALQUER versão tem que respeitar para o código
// funcionar (as variáveis) e para a linha não parecer robô (as regras da casa).

const fixos: Array<[string, readonly string[]]> = [
  ['OFERTA_HORARIOS', T.OFERTA_HORARIOS],
  ['CONFIRMACAO', T.CONFIRMACAO],
  ['NAO_ENTENDI_O_NUMERO', T.NAO_ENTENDI_O_NUMERO],
  ['PASSAGEM_PARA_O_CONSULTOR', T.PASSAGEM_PARA_O_CONSULTOR],
  ['DESPEDIDA', T.DESPEDIDA],
  ['PAROU', T.PAROU],
  ['SOU_ASSISTENTE_VIRTUAL', T.SOU_ASSISTENTE_VIRTUAL],
];

const tudoQueOClienteLe: string[] = [
  ...T.ABERTURAS, T.ABERTURA_SEM_NOME, T.HORARIO_FOI_OCUPADO, ...fixos.flatMap(([, v]) => [...v]),
];

describe('textos da Helena: as variáveis que o código troca', () => {
  it('5 aberturas, todas com {nome} e {valor}', () => {
    expect(T.ABERTURAS).toHaveLength(5);
    for (const a of T.ABERTURAS) {
      expect(a).toContain('{nome}');
      expect(a).toContain('{valor}');
    }
  });

  it('a reserva tem {valor} e não chama ninguém pelo nome', () => {
    expect(T.ABERTURA_SEM_NOME).toContain('{valor}');
    expect(T.ABERTURA_SEM_NOME).not.toContain('{nome}');
  });

  it('cada texto fixo tem 2 variações', () => {
    for (const [nome, v] of fixos) expect(v.length, nome).toBe(2);
  });

  it('a oferta traz as 4 linhas numeradas, uma por horário', () => {
    for (const o of T.OFERTA_HORARIOS) {
      for (const n of [1, 2, 3, 4]) expect(o.split('\n')).toContain(`${n}. {h${n}}`);
    }
  });

  it('a confirmação tem {quando} e {consultor}', () => {
    for (const c of T.CONFIRMACAO) {
      expect(c).toContain('{quando}');
      expect(c).toContain('{consultor}');
    }
  });

  it('nenhuma variável desconhecida ficou no texto', () => {
    const conhecidas = new Set(['{nome}', '{valor}', '{consultor}', '{quando}', '{h1}', '{h2}', '{h3}', '{h4}']);
    for (const t of [...tudoQueOClienteLe, T.REGRAS_DO_PROMPT]) {
      for (const v of t.match(/\{[^}]*\}/g) ?? []) expect(conhecidas.has(v), v).toBe(true);
    }
  });
});

describe('textos da Helena: as regras da casa', () => {
  it('nenhum travessão e nenhum emoji no que o cliente lê', () => {
    for (const t of tudoQueOClienteLe) {
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('toda mensagem começa com maiúscula (ou com o nome da pessoa)', () => {
    for (const t of tudoQueOClienteLe) expect(t, t.slice(0, 30)).toMatch(/^(\{nome\}|[A-ZÀ-Ý])/);
  });

  it('nunca "cota" nem "cotista" no que o cliente lê, e nenhum link', () => {
    for (const t of tudoQueOClienteLe) {
      expect(t).not.toMatch(/(?<!\p{L})cot(?:a|ista)s?(?!\p{L})/iu);
      expect(t).not.toMatch(/https?:\/\/|www\./i);
    }
  });

  it('a abertura cabe numa bolha só do envio frio, mesmo com nome e valor longos', () => {
    for (const a of [...T.ABERTURAS, T.ABERTURA_SEM_NOME]) {
      const cheia = a.replace('{nome}', 'Maximiliano').replace('{valor}', 'R$ 100 mil a R$ 200 mil');
      expect(cheia.length).toBeLessThanOrEqual(900);
    }
  });

  it('a abertura se apresenta, cita o formulário e deixa a porta de saída', () => {
    for (const a of [...T.ABERTURAS, T.ABERTURA_SEM_NOME]) {
      expect(a).toContain('Helena');
      expect(a).toContain('Irmãos na Obra');
      expect(a).toContain('formulário');
      expect(a).toContain('não insisto');
    }
  });
});

describe('regras do prompt', () => {
  const r = T.REGRAS_DO_PROMPT;

  it('levam o consultor como variável e não falam mais do separador ||', () => {
    expect(r).toContain('{consultor}');
    expect(r).not.toContain('||');
    expect(r).toContain('cada uma em um item da lista "bolhas"');
  });

  it('as proibições que o dono pediu estão escritas', () => {
    expect(r).toContain('Nunca prometa nem sugira rendimento, retorno, lucro ou prazo de retorno');
    expect(r).toContain('Nunca use as palavras "cota" ou "cotista"');
    expect(r).toContain('"opções de negócio"');
    expect(r).toContain('Nunca diga que é humana');
    expect(r).toContain('assistente virtual');
    expect(r).toContain('Nunca use emoji');
    expect(r).toContain('Nunca use travessão');
    expect(r).toContain('Toda mensagem e toda frase começam com letra maiúscula');
    expect(r).toContain('no máximo uma pergunta por resposta');
  });

  it('o próprio texto das regras não tem travessão nem crase', () => {
    expect(r).not.toMatch(/[—–]/);
    expect(r).not.toContain('`');
  });
});
