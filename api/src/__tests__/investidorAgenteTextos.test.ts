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

const abertoras = Object.values(T.ABERTURAS_POR_TIPO).flat();
const retomadas = Object.values(T.RETOMADAS_POR_VARIANTE).flatMap(v => [v.local, v.capital]);
/** O molde sem o nome, que é o que sai para quem não tem primeiro nome que dê para usar. */
const semNome = [...abertoras, ...retomadas].map(T.moldeSemNome);

const tudoQueOClienteLe: string[] = [
  ...abertoras, ...retomadas, ...semNome, T.HORARIO_FOI_OCUPADO, ...fixos.flatMap(([, v]) => [...v]),
];

describe('textos da Helena: as variáveis que o código troca', () => {
  it('os 4 tipos têm 3 aberturas cada, todas com {nome}; {valor} só no Investidor e {cidade} só na 2ª do Arrendamento', () => {
    expect(Object.keys(T.ABERTURAS_POR_TIPO).sort()).toEqual(['arrendamento', 'curioso', 'investidor', 'parceiro']);
    for (const [tipo, lista] of Object.entries(T.ABERTURAS_POR_TIPO)) {
      expect(lista, tipo).toHaveLength(3);
      for (const [i, a] of lista.entries()) {
        expect(a, `${tipo} ${i}`).toContain('{nome}');
        expect(a.includes('{valor}'), `${tipo} ${i} valor`).toBe(tipo === 'investidor');
        expect(a.includes('{cidade}'), `${tipo} ${i} cidade`).toBe(tipo === 'arrendamento' && i === 1);
      }
    }
  });

  it('as retomadas: toques 2 a 5, uma por variante (local e capital), todas com {nome}', () => {
    expect(Object.keys(T.RETOMADAS_POR_VARIANTE)).toEqual(['2', '3', '4', '5']);
    for (const v of Object.values(T.RETOMADAS_POR_VARIANTE)) {
      expect(v.local).toContain('{nome}');
      expect(v.capital).toContain('{nome}');
      expect(v.local).not.toBe(v.capital);
    }
  });

  it('o molde sem nome é o MESMO texto do redator sem "{nome}" e sem pontuação solta', () => {
    for (const molde of [...abertoras, ...retomadas]) {
      const t = T.moldeSemNome(molde);
      expect(t).not.toContain('{nome}');
      expect(t).not.toMatch(/\s,|,\s*[,!.]|^\s*[,!.]|\s{2,}/);
      expect(t).toMatch(/^[A-ZÀ-Ý]/);
    }
    expect(T.moldeSemNome('Oi, {nome}, tudo bem? Aqui é a Helena.')).toBe('Oi, tudo bem? Aqui é a Helena.');
    expect(T.moldeSemNome('{nome}, tudo bem? Sou a Helena.')).toBe('Tudo bem? Sou a Helena.');
    expect(T.moldeSemNome('Olá, {nome}! Helena aqui.')).toBe('Olá! Helena aqui.');
    expect(T.moldeSemNome('Oi, {nome}. Vou parar.')).toBe('Oi. Vou parar.');
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
    const conhecidas = new Set(['{nome}', '{valor}', '{cidade}', '{consultor}', '{quando}', '{h1}', '{h2}', '{h3}', '{h4}']);
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

  it('a abertura e a retomada cabem numa bolha só do envio frio, mesmo com nome, valor e cidade longos', () => {
    for (const a of [...abertoras, ...retomadas]) {
      const cheia = a.replace('{nome}', 'Maximiliano').replace('{valor}', 'R$ 100 mil a R$ 200 mil').replace('{cidade}', 'Governador Valadares');
      expect(cheia.length).toBeLessThanOrEqual(900);
    }
  });

  it('a abertura se apresenta como Helena, da Irmãos na Obra, e cita o formulário de eletroposto', () => {
    for (const a of abertoras) {
      expect(a).toContain('Helena');
      expect(a).toContain('Irmãos na Obra');
      expect(a).toMatch(/formulário|cadastro/);
      expect(a).toContain('eletroposto');
    }
  });

  it('o retorno usa o texto do toque 4, que se apresenta e reconhece o tempo que passou', () => {
    for (const v of ['local', 'capital'] as const) {
      expect(T.RETOMADAS_POR_VARIANTE[4][v]).toContain('Faz um tempo que a gente não se fala');
      expect(T.RETOMADAS_POR_VARIANTE[4][v]).toContain('Helena');
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
      .replace('Escreva como alguém calma e simpática digitando no celular:', '')
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

describe('o bloco de conhecimento (12/10/2026)', () => {
  const r = T.REGRAS_DO_PROMPT;
  const pos = (t: string): number => { const i = r.indexOf(`
${t}
`); expect(i, t).toBeGreaterThan(-1); return i; };

  it('as três seções estão no prompt, na ordem: reunião e empresa, o que explicar, preço, informação antes de aceitar', () => {
    const ordem = [
      'COMO É A REUNIÃO E QUEM É A EMPRESA',
      'O QUE VOCÊ PODE EXPLICAR',
      'SE DISSER "ME MANDA POR AQUI MESMO" OU "ME PASSA AS INFORMAÇÕES"',
      'SE PERGUNTAR QUANTO CUSTA, QUANTO DÁ DE RESULTADO OU QUAL O MÍNIMO',
      'SE A PESSOA QUISER INFORMAÇÃO ANTES DE ACEITAR A REUNIÃO',
      'SE DISSER QUE NÃO LEMBRA DO FORMULÁRIO OU PERGUNTAR QUEM É VOCÊ',
    ].map(pos);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it('a seção de preço foi SUBSTITUÍDA: existe uma só, e a redação antiga saiu', () => {
    expect(r.split('SE PERGUNTAR QUANTO CUSTA, QUANTO DÁ DE RESULTADO OU QUAL O MÍNIMO').length - 1).toBe(1);
    expect(r).not.toContain('Continua valendo: nenhum número, nem para confirmar nem para negar.');
    expect(r).toContain('Preço, mínimo e resultado continuam com {consultor}.');
    expect(r).toContain('Não diga se o valor dela cobre cada item');
  });

  it('o que entra, o que não entra, e o que continua fora', () => {
    expect(r).toContain('projeto elétrico, parecer de acesso na concessionária, obra civil, cabeamento, proteção e comissionamento');
    expect(r).toContain('O que não entra: aluguel do terreno, impostos da operação da própria pessoa e eventual reforço de entrada que a concessionária peça.');
    expect(r).toContain('não é franquia, então não tem taxa de entrada, royalties nem exclusividade de território');
    expect(r).toContain('Nunca diga que o valor da pessoa cobre ou não cobre um item.');
    expect(r).toContain('passe para {consultor} com `humano`');
  });

  it('a seção nova diz para não repetir a mesma recusa', () => {
    expect(r).toContain('Não repita "isso é com {consultor}" em duas respostas seguidas.');
  });

  it('só variáveis conhecidas e nenhum travessão no bloco (já cobertos pelos testes gerais)', () => {
    for (const v of r.match(/\{[^}]*\}/g) ?? []) expect(['{consultor}']).toContain(v);
    expect(r).not.toMatch(/[—–]/);
  });
});

describe('o roteiro de descoberta por tipo (redator, 12/11/2026)', () => {
  const r = T.REGRAS_DO_PROMPT;
  const linhas = r.split('\n');

  it('o bloco A entrou inteiro, na ordem, e o roteiro antigo de 4 passos saiu', () => {
    const titulos = [
      'QUEM É A PESSOA, POR TIPO DE CADASTRO', 'COMO VOCÊ CONVERSA', 'COMO REAGIR ANTES DE PERGUNTAR', 'O QUE DESCOBRIR ANTES DO CONVITE',
      'QUANDO E COMO CONVIDAR PARA A REUNIÃO', 'SE A RESPOSTA FOR CURTA ("SIM", "NORMAL", "NÃO SEI", "TÔ VENDO")',
      'SE ELA ESTIVER COM PRESSA ("RESUME", "VAI DIRETO", "ME MANDA TUDO")', 'SE ELA PERGUNTAR PREÇO, MÍNIMO OU RESULTADO NO MEIO DO ROTEIRO', 'EXEMPLOS DE TROCA',
    ];
    const onde = titulos.map(t => linhas.indexOf(t));
    for (const [i, pos] of onde.entries()) expect(pos, titulos[i]).toBeGreaterThan(0);
    expect([...onde].sort((a, b) => a - b)).toEqual(onde);
    expect(linhas).not.toContain('O QUE DESCOBRIR');
    expect(r).not.toContain('Descubra nesta ordem, uma coisa por vez e sem interrogatório');
  });

  it('as contradições do roteiro antigo foram resolvidas: sem piso, sem "só investidor", sem "ajuda para achar ponto vai para humano"', () => {
    expect(r).not.toContain('R$ 50 mil');
    expect(r).not.toContain('declararam quanto pretendem investir');
    expect(r).not.toContain('confirmar se o interesse e o valor continuam');
    expect(r).not.toContain('Se ela quiser apenas ajuda para achar um ponto, passe');
    expect(r).not.toContain('não force o roteiro de investimento: passe para {consultor}');
    expect(r).toContain('Se ela quiser ajuda para achar o local, anote e leve para a reunião');
    expect(r).toContain('Não comente piso nem faixa: qualquer pessoa pode ser convidada para a reunião.');
    expect(r).toContain('siga o roteiro de Arrendamento');
  });

  it('o prompt diz que o consultor é o `{consultor}` e que o convite é a única pergunta da resposta', () => {
    expect(r).toContain('vale uma conversa com {consultor}, que olha o caso dela com os números. Termine perguntando se pode mandar os horários.');
    expect(r).toContain('Esse convite é a sua única pergunta daquela resposta.');
    expect(r).toContain('Não use as palavras "arrendamento" nem "aluguel": fale em "ceder o espaço".');
  });
});
