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
  ['ADIADO', T.ADIADO],
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

  it('o próprio texto das regras não tem travessão', () => {
    expect(r).not.toMatch(/[—–]/);
  });

  it('o bloco de contorno do redator (11/10/2026) substituiu "SE A PESSOA NÃO QUISER"', () => {
    const linhas = r.split('\n');
    expect(linhas).not.toContain('SE A PESSOA NÃO QUISER');
    const titulos = [
      'A META E COMO CONTORNAR', 'ANTES DE RESPONDER, ENTENDA O QUE A PESSOA FEZ', 'QUANDO A RESPOSTA SAI DO ROTEIRO',
      'COMO CONTORNAR, EM TRÊS MOVIMENTOS', 'COMO É A REUNIÃO E QUEM É A EMPRESA', 'LIMITES DO CONTORNO', 'NÃO FIRME E NÃO MOLE',
      'QUANDO PASSAR PARA {consultor} EM VEZ DE CONTORNAR', 'COMO VOCÊ INFORMA SUA DECISÃO', 'SE PEDIR PARA FALAR COM UMA PESSOA',
    ];
    const onde = titulos.map(t => linhas.indexOf(t));
    for (const [i, pos] of onde.entries()) expect(pos, titulos[i]).toBeGreaterThan(0);
    // Na ordem: o contorno, depois o parágrafo das ações, depois o que já existia.
    expect([...onde].sort((a, b) => a - b)).toEqual(onde);
    // O que a seção antiga dizia continua valendo, agora dentro do "não firme".
    expect(r).toContain('Se disser que não tem interesse ou que desistiu, agradeça em uma frase e não insista, não argumente e não faça pergunta.');
  });

  it('o parágrafo das ações cita as seis ações com o nome que o código entende', () => {
    const acoes = r.split('\n')[r.split('\n').indexOf('COMO VOCÊ INFORMA SUA DECISÃO') + 1]!;
    for (const a of ['continuar', 'oferecer_horarios', 'adiar', 'humano', 'sem_interesse', 'parar']) expect(acoes).toContain('`' + a + '`');
    expect(acoes).toContain('Nas ações `humano`, `adiar`, `sem_interesse` e `parar`, o sistema envia uma mensagem pronta');
  });

  it('o contorno proíbe urgência falsa e manda respeitar o não firme', () => {
    expect(r).toContain('Nunca crie urgência, escassez ou prazo falso');
    expect(r).toContain('Na dúvida entre firme e mole, trate como firme.');
    expect(r).toContain('Faça UMA tentativa por objeção.');
  });
});

describe('a Helena marca "reunião" sem dizer o formato (11/10/2026)', () => {
  const r = T.REGRAS_DO_PROMPT;
  const linhas = r.split('\n');
  const corpoDe = (titulo: string): string => linhas[linhas.indexOf(titulo) + 1] ?? '';

  it('as cinco seções do redator substituíram as de mesmo título', () => {
    expect(corpoDe('COMO É A REUNIÃO E QUEM É A EMPRESA')).toContain('A reunião é uma conversa com {consultor}.');
    expect(corpoDe('COMO É A REUNIÃO E QUEM É A EMPRESA')).toContain('{consultor} combina os detalhes com ela pelo WhatsApp dele antes do horário');
    expect(corpoDe('SE DISSER "ME MANDA POR AQUI MESMO" OU "ME PASSA AS INFORMAÇÕES"')).toContain('numa conversa com ela');
    expect(corpoDe('SE DESCONFIAR ("ISSO É GOLPE?", "COMO CONSEGUIU MEU NÚMERO?")')).toContain('Diga que a reunião serve para {consultor} entender o caso');
    expect(corpoDe('SE DISSER "AGORA NÃO TENHO TEMPO", "VOU PENSAR" OU "DEPOIS EU VEJO"')).toContain('ela escolhe o horário que encaixar na agenda dela');
    expect(corpoDe('SE QUISER FALAR AGORA OU PEDIR PARA LIGAR')).toContain('combina os detalhes da conversa com ela pelo WhatsApp dele');
    // Cada título aparece uma vez só.
    for (const t of ['COMO É A REUNIÃO E QUEM É A EMPRESA', 'SE QUISER FALAR AGORA OU PEDIR PARA LIGAR']) {
      expect(linhas.filter(l => l === t)).toHaveLength(1);
    }
  });

  it('a regra de palavras está escrita, e é a única frase que cita o formato', () => {
    const regra = 'Regra de palavras: nunca use vídeo, videochamada, chamada de vídeo, link, online, Meet, Zoom, celular, computador nem "sem instalar", e nunca diga que a reunião é presencial ou por telefone: diga sempre "reunião" ou "conversa com {consultor}".';
    expect(r).toContain(regra);
    // Fora dela sobram duas frases do bloco original do redator, que são instrução
    // de ESTILO e não dica de formato: "digitando no celular" e "Nunca coloque link".
    const resto = r.replace(regra, '')
      .replace('Escreva como uma pessoa digitando no celular:', '')
      .replace('Nunca coloque link.', '');
    expect(resto).not.toMatch(/v[ií]deo|link|celular|computador|sem instalar/i);
  });

  it('o que saiu não volta: nada de "por vídeo", "entra pelo celular" nem "sem instalar nada"', () => {
    expect(r).not.toContain('conversa por vídeo');
    expect(r).not.toContain('entra pelo celular');
    expect(r).not.toContain('sem instalar nada');
    expect(r).not.toContain('manda o link');
  });
});

