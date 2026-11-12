import { describe, it, expect } from 'vitest';
import * as T from '../services/io/investidorAgenteTextos';
import { violaRegras } from '../services/io/investidorAgentePuro';

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
  ['ENCERRAMENTO_DO_PREPARO', T.ENCERRAMENTO_DO_PREPARO],
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
    expect(acoes).toContain('Nas ações `humano` e `parar`, o sistema envia uma mensagem pronta');
    expect(acoes).toContain('Em `adiar`, a sua bolha curta é a própria despedida');
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
    expect(corpoDe('SE DESCONFIAR ("ISSO É GOLPE?", "COMO CONSEGUIU MEU NÚMERO?")')).toContain('Diga com calma que o número veio do formulário que ela preencheu');
    expect(corpoDe('SE DISSER "AGORA NÃO TENHO TEMPO", "VOU PENSAR" OU "DEPOIS EU VEJO"')).toContain("Em 'agora não' ou 'não tenho tempo', não insista e não ofereça horário.");
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
      .replace('Nunca coloque link.', '')
      // Seção DEPOIS DE MARCAR (rodada 2): o "link" é o pedido que a PESSOA deixou em aberto, não instrução de formato.
      .replace('como a conta no papel ou o link', '');
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
    expect(r).not.toContain('Preço, mínimo e resultado continuam com {consultor}.');
    expect(r).toContain("Você só dá os números da seção 'PREÇOS QUE VOCÊ PODE DIZER'.");
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
      'SE ELA ESTIVER COM PRESSA ("RESUME", "VAI DIRETO", "ME MANDA TUDO")', 'SE ELA PERGUNTAR PREÇO, MÍNIMO OU RESULTADO NO MEIO DO ROTEIRO', 'EXEMPLOS DE TROCA (só mostram o formato: nunca copie as palavras deles, nem a reação nem a pergunta; escreva com palavras suas, a partir do que a pessoa de fato disse)',
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
    expect(r).toContain('Se ela quiser ajuda para achar o local, diga que a empresa indica locais para quem investe com ela e leve o assunto para a reunião com {consultor}, sem citar lugar, cidade nem prazo');
    expect(r).not.toContain('sem prometer que a empresa encontra');
    expect(r).toContain('Não comente piso nem faixa: qualquer pessoa pode ser convidada para a reunião.');
    expect(r).toContain('siga o roteiro de Arrendamento');
  });

  it('o prompt diz que o consultor é o `{consultor}` e que o convite é a única pergunta da resposta', () => {
    expect(r).toContain('vale uma conversa com {consultor}, que olha o caso dela com os números. Termine perguntando se pode mandar os horários.');
    expect(r).toContain('Esse convite é a sua única pergunta daquela resposta.');
    expect(r).toContain('Não use as palavras "arrendamento" nem "aluguel": fale em "ceder o espaço".');
  });
});

describe('ajuste de voz do redator (12/11/2026)', () => {
  const r = T.REGRAS_DO_PROMPT;
  it('as seis instruções entraram', () => {
    expect(r).toContain("Alterne. Não comece a reação com 'Então você' e não use 'Entendi', 'Certo', 'Faz sentido' nem 'Tudo bem' mais de uma vez na mesma conversa.");
    expect(r).toContain('diga que perguntou mal e refaça com duas opções.');
    expect(r).toContain("Diga em primeira pessoa, em uma frase, que você é a assistente virtual da equipe. Se já for hora de convidar, termine com o convite para a reunião com {consultor} (pode te mandar os horários?). Só se ela pedir para falar com uma pessoa agora, passe com 'humano'.");
    expect(r).toContain('não repita as mesmas palavras: responda o que ela disse e retome com uma frase nova.');
    expect(r).toContain('Se a cidade não estiver nos fatos do sistema, pergunte a cidade uma vez só. Se ela não responder ou desviar, desista da cidade e convide.');
    // Rodada 2 (12/11/2026): o prazo deixou de segurar o convite e passou para o DEPOIS DE MARCAR.
    expect(r).not.toContain('Antes de convidar, tente saber quando ela pensa em começar');
    expect(r).toContain('Não segure o convite para saber quando ela pensa em começar: isso você pergunta depois de marcar.');
  });
  it('preço, limite de 5 respostas, curioso e quem decide (12/11/2026)', () => {
    const t = String(r);
    const sec = "Se você ainda não sabe quando ela pensa em começar, siga a seção 'SE ELA PERGUNTAR PREÇO, MÍNIMO OU RESULTADO NO MEIO DO ROTEIRO' antes de convidar.";
    expect(t).toContain("Diga com palavras suas que entendeu que ela quer saber se compensa, sem abrir com 'Você quer saber se'.");
    expect(t).toContain("convide na mesma resposta, terminando em 'Posso te mandar os horários?'. Se ela insistir em faixa ou retorno, não repita o preço nem a recusa");
    expect(t).not.toContain('troque o convite por uma pergunta de preparo');
    expect(t).toContain("Só dê os números da seção de preços, nenhum outro, e nunca confirme nem negue rendimento, retorno ou prazo.");
    expect(t).not.toContain('Nunca dê número nem faixa');
    expect(t.split(sec).length - 1).toBe(0);   // a pergunta de prazo agora é do DEPOIS DE MARCAR
    expect(t).toContain('em geral de 3 a 5 respostas dela');
    expect(t).toContain('Não passe de 5 respostas dela sem convidar: da 5ª em diante, toda resposta sua termina no convite, mesmo faltando cidade ou prazo, e o consultor pergunta o resto.');
    expect(t).not.toContain('6 respostas');
    expect(t).toContain("Se ele só quer carregar o próprio carro, faça UMA pergunta para ver se há interesse de negócio, por exemplo 'Você pensa em ter um ponto seu ou é mais para saber onde carregar?'.");
    expect(t).toContain('Nunca diga que {consultor} orienta sobre onde carregar.');
    expect(t).toContain('Só pergunte depois da 4ª resposta dela, e nunca segure o convite por isso.');
  });
  it('o texto fixo de assistente virtual fala em primeira pessoa', () => {
    for (const t of T.SOU_ASSISTENTE_VIRTUAL) expect(t).not.toMatch(/a Helena (é|sou)/);
  });
});

describe('preços que o dono liberou para a Helena dizer (12/11/2026)', () => {
  const r = String(T.REGRAS_DO_PROMPT);
  const SEC = "'PREÇOS QUE VOCÊ PODE DIZER'";
  const pos = (t: string): number => { const i = r.indexOf(`\n${t}\n`); expect(i, t).toBeGreaterThan(-1); return i; };

  it('a seção nova vem logo depois de "O QUE VOCÊ PODE EXPLICAR" e antes de "ME MANDA POR AQUI MESMO", uma linha por item', () => {
    const ordem = ['O QUE VOCÊ PODE EXPLICAR', 'PREÇOS QUE VOCÊ PODE DIZER', 'SE DISSER "ME MANDA POR AQUI MESMO" OU "ME PASSA AS INFORMAÇÕES"'].map(pos);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(r.split('\nPREÇOS QUE VOCÊ PODE DIZER\n').length - 1).toBe(1);
    const linhas = r.split('\n');
    const i = linhas.indexOf('PREÇOS QUE VOCÊ PODE DIZER');
    expect(linhas[i + 1]).toContain('chave na mão a partir de R$ 145 mil; sociedade 50/50, em que a pessoa entra com o local e R$ 72.500, ficamos sócios da operação e dividimos os lucros; carregador de 80 kW por R$ 69.990 e de 120 kW por R$ 89.990, os dois com mangueiras com malha de aço.');
    expect(linhas[i + 2]).toContain('Qual opção dizer: fale só da que serve à pessoa, no máximo duas, em uma ou duas frases.');
    expect(linhas[i + 3]).toContain("Diga sempre 'a partir de' no chave na mão.");
    expect(linhas[i + 4]).toContain('Depois do preço, leve para a reunião: diga em uma frase que {consultor} mostra como isso se encaixa no caso dela');
    expect(linhas[i + 5]).toBe('');
  });

  it('as seções que proibiam preço apontam para a seção nova', () => {
    for (const t of [
      `Diga o preço que serve a ela, conforme a seção ${SEC}, e que o caso dela, com os números completos, {consultor} mostra na reunião.`,
      `Dê só os números da seção ${SEC} e nunca confirme nem negue o que ela disser sobre rendimento, retorno ou prazo.`,
      `Você só dá os números da seção ${SEC}.`,
      `Para 'qual o mínimo', diga o preço de entrada da opção que serve a ela, sem usar a palavra mínimo.`,
      `A única menção a lucro é 'dividimos os lucros', na sociedade 50/50, sem número. Só informe os preços da seção ${SEC}. Nunca informe outro preço, condição de pagamento, financiamento, desconto ou detalhe de contrato.`,
      `nenhum valor em reais nem potência fora da seção ${SEC}, nenhum nome de modelo,`,
      `nem como o lucro é dividido, além do 'dividimos os lucros' da sociedade 50/50`,
      `Não mande material; número só o da seção ${SEC}.`,
      `Quem fecha os números do caso é o consultor, na reunião. Os preços da seção ${SEC} você pode dizer.`,
      'Fale só da opção que serve à pessoa.',
    ]) expect(r, t).toContain(t);
    for (const velho of [
      'Diga que os números dependem do caso dela e que {consultor} mostra na reunião.',
      'Não responda número nenhum, nem confirme nem negue o que a pessoa disser.',
      'Você não dá número nenhum, nem para confirmar nem para negar.',
      'não diga que existe ou não existe um mínimo',
      'Nunca informe preço, valor de equipamento, condição de pagamento ou detalhe de contrato.',
      'Não mande material nem número.',
      'Quem apresenta as opções de negócio e os números é o consultor, na reunião, nunca você.',
      'sem detalhar nenhuma opção',
    ]) expect(r, velho).not.toContain(velho);
  });

  it('ajuda para achar local e parceiro', () => {
    expect(r.split('diga que a empresa indica locais para quem investe com ela e leve o assunto para a reunião com {consultor}, sem citar lugar, cidade nem prazo').length - 1).toBe(2);
    expect(r).toContain('e que o chave na mão não exige local próprio');
    expect(r).not.toContain('nem todas exigem local próprio, e que o chave na mão');
    expect(r).toContain('A empresa procura parceiros que queiram vender a marca NEXUS: diga isso quando ele falar de revenda ou for integrador.');
  });

  it('os três exemplos de preço entraram, um por rótulo, e as falas da Helena neles passam na trava', () => {
    const exemplos = [
      ['Preço, investidor sem local:', 'Pessoa: Quanto preciso para entrar?', 'Helena, bolha 1: Temos o chave na mão a partir de R$ 145 mil, e a empresa indica locais para quem investe com a gente.', 'Helena, bolha 2: Para o {consultor} já chegar com a conta do seu caso, me conta: quando você pensa em começar?'],
      ['Preço, arrendamento:', 'Pessoa: O terreno é meu, quanto eu preciso pôr?', 'Helena, bolha 1: Com o terreno seu, temos a sociedade 50/50: você entra com o local e R$ 72.500, ficamos sócios da operação e dividimos os lucros.', 'Helena, bolha 2: O {consultor} mostra como isso fica no seu caso. Posso te mandar os horários?'],
      ['Preço, parceiro:', 'Pessoa: Qual o preço do carregador?', 'Helena, bolha 1: Temos de 80 kW por R$ 69.990 e de 120 kW por R$ 89.990, com mangueiras com malha de aço.', 'Helena, bolha 2: Quem fala de parceria para vender a marca é o {consultor}. Posso te mandar os horários?'],
    ];
    for (const ex of exemplos) {
      expect(r, ex[0]).toContain(`\n${ex.join('\n')}\n`);
      expect(violaRegras(ex.slice(2).map(l => l.replace(/^Helena, bolha \d: /, '').replace('{consultor}', 'Diego'))), ex[0]).toBeNull();
    }
  });

  it('a frase de preços da seção, dita pela Helena, passa na trava', () => {
    const linhas = r.split('\n');
    const i = linhas.indexOf('PREÇOS QUE VOCÊ PODE DIZER');
    expect(violaRegras([linhas[i + 1]!.split('. A empresa também')[0]! + '.'])).toBeNull();
  });
});

describe('rodada 2 do redator: voz, DEPOIS DE MARCAR e textos fixos (12/11/2026)', () => {
  const r = String(T.REGRAS_DO_PROMPT);
  const tem = (t: string) => expect(r, t.slice(0, 60)).toContain(t);

  it('as trocas do prompt (A1 a A12) estão presentes', () => {
    tem("Se não houver, não peça a cidade e não convide: diga com simpatia que você não tem lista de pontos nem tarifa, que os aplicativos e mapas de recarga mostram os pontos perto dele, e use sem_interesse.");
    tem("Em 'agora não' ou 'não tenho tempo', não insista e não ofereça horário. Se ela já disse quando prefere ser procurada, registre com as palavras dela e use adiar, sem perguntar de novo. Se não disse, pergunte uma vez só quando prefere que você chame. Depois de qualquer recusa clara de reunião, nunca volte a convidar: ofereça uma vez falar depois (adiar) ou encerre (sem_interesse).");
    expect(r).not.toContain('Uma tentativa e pronto.');
    tem("Se for um pedido claro de adiar, não faça tentativa: aceite e use adiar. A tentativa leve só vale para 'vou pensar' e 'depois eu vejo', sem data.");
    tem("Se ela perguntar de onde veio o número, diga que foi o formulário de eletroposto que ela preencheu, com o mês se estiver nos fatos do sistema.");
    tem("Ofereça passar para {consultor} uma só vez na conversa inteira, e não convide para reunião enquanto a desconfiança durar. Se ela disser que sem esse dado não segue, aceite com respeito e use humano.");
    expect(r).not.toContain('Se a desconfiança continuar, não insista');
    tem("A empresa do eletroposto é a NEXUS Eletroposto, da Irmãos na Obra, com CNPJ 03.945.372/0001-89 e sede em Araguari, MG. Diga isso quando a pessoa desconfiar ou pedir os dados da empresa.");
    tem("Todo convite termina numa pergunta clara de horário ('Posso te mandar os horários?' ou variação), nunca só em 'o consultor mostra na reunião'. Se ela já aceitou os horários sem outra pergunta, use oferecer_horarios na hora.");
    tem("Se ela impôs uma condição ('me diz X que eu marco'), responda o que puder e convide mesmo assim; o que você não souber, diga que {consultor} define.");
    tem("Releia a última mensagem inteira: toda dúvida ou receio nela, mesmo no fim ou depois de um 'pode mandar', tem que ser respondido ou acolhido em uma frase antes de qualquer convite.");
    tem("Espelhe o jeito dela: se escreve curto e solto, escreva leve e curto, sem resumo nem lista.");
    tem("Se ela perguntar se o dono precisa aprovar, diga que isso {consultor} explica na reunião e pergunte se ela já conversou com o dono. Para quem só quer ceder o espaço, não fale de análise de carga nem de compra de equipamento.");
    tem("Para eletricista que quer instalar, não enquadre como venda: pergunte o que ele imagina da parceria. Se mostrar medo de não dar conta, acolha em uma frase e diga que {consultor} explica como funciona, sem prometer treinamento. Se perguntar margem, exclusividade ou condições, diga que quem define é {consultor}, sem número, e convide com os horários.");
    tem("Com quem responde seco, use pergunta de duas opções: 'já tem um local em vista ou prefere que a gente indique?', 'sozinho ou com sócio?'.");
  });

  it('nenhuma seção manda mais perguntar o prazo antes de convidar (A8)', () => {
    expect(r).not.toContain('Se você ainda não sabe quando ela pensa em começar');
  });

  it('a seção DEPOIS DE MARCAR vem logo depois da reunião e da empresa e antes de O QUE VOCÊ PODE EXPLICAR', () => {
    const linhas = r.split('\n');
    const i = linhas.indexOf('DEPOIS DE MARCAR');
    expect(i).toBeGreaterThan(linhas.indexOf('COMO É A REUNIÃO E QUEM É A EMPRESA'));
    expect(i).toBeLessThan(linhas.indexOf('O QUE VOCÊ PODE EXPLICAR'));
    expect(linhas.filter(l => l === 'DEPOIS DE MARCAR')).toHaveLength(1);
    expect(linhas[i + 1]).toContain('O horário já está marcado e a confirmação já foi enviada. Agora você prepara {consultor}, com no máximo 2 perguntas, UMA por vez, sempre a que mais falta, nesta ordem.');
    expect(linhas[i + 1]).toContain('Terceiro, quem decide junto, mas só se ela não disse que decide sozinha, que é MEI, autônoma ou dona do negócio.');
    expect(linhas[i + 1]).toContain("sem abrir duas mensagens seguidas com 'Anotei' ou 'Deixei anotado'");
    expect(linhas[i + 2]).toContain("No encerramento, agradeça em uma frase, sem 'em mãos' e sem 'anotado', e cite o dia como está na confirmação, nunca 'amanhã' nem 'hoje'.");
    expect(linhas[i + 2]).toContain('A pergunta de preparo não é condição: se ela não responder ou responder seco, não insista.');
    expect(linhas[i + 2]).toContain('Nunca fale de outro horário nem volte a falar de preço.');
    expect(linhas[i + 3]).toBe('');
  });

  it('os textos fixos (C) são os do redator, com duas variações cada', () => {
    expect(T.PASSAGEM_PARA_O_CONSULTOR).toEqual([
      'Entendi. Vou chamar o consultor da equipe: é ele quem responde isso com os números do seu caso, e ele fala com você por aqui mesmo.',
      'Certo, vou passar para o consultor da equipe, que tira essas dúvidas direto com você. Ele te chama por aqui mesmo.',
    ]);
    expect(T.ADIADO).toEqual([
      'Deixei anotado. Não vou ficar te cobrando por aqui: se quiser retomar antes, é só me chamar.',
      'Tudo bem, sem pressa. Deixei anotado do jeito que você pediu. Se quiser conversar antes, é só me chamar por aqui.',
    ]);
    expect(T.DESPEDIDA).toEqual([
      'Tudo bem, obrigada por me avisar e boa sorte por aí! Se um dia o assunto voltar a fazer sentido, é só me chamar por aqui.',
      'Entendido, obrigada pela atenção. Se algo mudar mais para frente, pode me chamar por aqui.',
    ]);
  });
});

// "O Giovanna" não existe: {consultor} é o primeiro nome de quem atende, de homem ou de mulher, então nenhum TEXTO FIXO
// (o que o código envia sem o modelo) põe artigo antes dele. No PROMPT o modelo usa o artigo pelo gênero do nome (rodada 5).
// "pelo espaço {consultor}" não conta: o artigo é de "espaço".
describe('textos fixos da Helena: nenhum artigo antes de {consultor}', () => {
  const ARTIGO = /(?:^|[^\p{L}])(?:o|a|os|as|do|da|ao|à|no|na|pro|pra|pelo|pela|com o|com a|para o|para a)\s+\{consultor\}/iu;
  const todos: Array<[string, string]> = [];
  for (const [nome, valor] of Object.entries(T)) {
    if (nome === 'REGRAS_DO_PROMPT') continue;
    if (typeof valor === 'string') todos.push([nome, valor]);
    else if (Array.isArray(valor)) valor.forEach((v, i) => { if (typeof v === 'string') todos.push([`${nome}[${i}]`, v]); });
  }
  it('há textos com {consultor} para conferir', () => {
    expect(todos.filter(([, t]) => t.includes('{consultor}')).length).toBeGreaterThan(3);
  });
  it.each(todos.filter(([, t]) => t.includes('{consultor}')))('%s', (_nome, texto) => {
    const m = ARTIGO.exec(texto);
    expect(m ? texto.slice(Math.max(0, m.index - 20), m.index + 40) : null).toBeNull();
  });
});

// Rodada 4 (descoberta antes do preço e do convite): as 9 trocas do prompt.
describe('rodada 4 do prompt: descobrir antes de convidar', () => {
  const r = String(T.REGRAS_DO_PROMPT);
  const tem = (t: string) => expect(r, t.slice(0, 60)).toContain(t);

  it('as 9 trocas estão no prompt', () => {
    tem("Se você ainda sabe menos de 2 pontos do roteiro do tipo dela (os de 'O QUE DESCOBRIR ANTES DO CONVITE'), além do que o formulário trouxe, responda em UMA frase e faça UMA pergunta do roteiro ligada ao que ela já contou, de preferência com duas opções, sem convidar ainda: o convite vem na resposta seguinte. Isso vale uma vez só na conversa.");
    tem("Se ela já insistiu em número duas vezes, condicionou a reunião a um número, respondeu seco duas vezes ou disse que está com pressa, não pergunte: convide na mesma resposta, terminando em 'Posso te mandar os horários?'.");
    tem("Depois do preço, leve para a reunião: diga em uma frase que {consultor} mostra como isso se encaixa no caso dela e pergunte se pode mandar os horários. Exceção: se a seção 'SE ELA PERGUNTAR PREÇO...' mandar fazer antes uma pergunta do roteiro, faça só essa pergunta.");
    tem("Parceiro: os carregadores de 80 kW e 120 kW só quando ele perguntar o preço do carregador, e que procuramos parceiros para vender a marca NEXUS. Margem, comissão, proposta, condições e exclusividade não são pergunta de preço: não cite tabela, diga em uma frase que quem define é {consultor} e siga a regra de descoberta.");
    tem("Se ele for integrador, o consultor precisa saber: o que já instala e em que volume, se atende cliente comercial ou só residencial, se tem equipe e o que ele imagina vender.");
    tem("Se ela contar que tem um espaço (clínica, loja, terreno, estacionamento), o espaço vira a pergunta do roteiro: onde fica, se tem área livre e quantas vagas cabem. Cite o espaço na primeira reação, mesmo que ela tenha pedido material ou preço.");
    tem("Se o local é herança ou de família, pergunte quem decide e se há outros herdeiros ou inventário em andamento.");
    tem("Se ela insistir em número de retorno depois da sua primeira resposta, não repita o argumento: pergunte uma vez que tipo de número ajudaria ela a decidir, e convide na resposta seguinte.");
    tem("Na primeira resposta, mesmo que ela tenha feito uma pergunta, cite em meia frase o detalhe mais pessoal que ela contou (profissão, lugar, espaço, família) antes de responder. Cada uma destas expressões vale no máximo uma vez na conversa inteira: 'com calma', 'o seu caso', 'com os números', 'se vê depois', 'lá no local', 'já chegar com'. Nem toda resposta precisa citar {consultor}.");
    tem("Use as duas perguntas sempre que ela estiver respondendo bem; só pare na primeira se ela responder seco ou disser que não quer falar mais. Se ela tem um espaço, a primeira pergunta é sobre ele. Se ela condicionou a decisão a um número, a segunda é que número ou valor ela tinha em mente.");
    expect(r).not.toContain('Depois do preço, SEMPRE leve');
  });
});

// Rodada 5: passagem ao consultor só em caso real, preço só com pergunta de preço, adiar com a mensagem do modelo.
describe('rodada 5 do prompt: passagem, preço e adiar', () => {
  const r = String(T.REGRAS_DO_PROMPT);
  const tem = (t: string) => expect(r, t.slice(0, 60)).toContain(t);

  it('as trocas do prompt estão presentes e as frases antigas saíram', () => {
    tem("Passe com `humano` só quando a pessoa pedir para falar com uma pessoa agora, quando houver reclamação, quando for suporte de quem já é cliente ou quando o assunto não for eletroposto. Dúvida que você não sabe responder, pedido de material e condição repetida não são motivo: diga que {consultor} responde na reunião e convide.");
    tem("Depois da segunda insistência, convide uma última vez com palavras novas (a reunião é onde ela vê o caso dela) e, se ela recusar, use `adiar` ou `sem_interesse`. Quando passar com `humano`, não tente contornar nem continue a conversa.");
    tem("Se você ainda sabe menos de 2 pontos do roteiro do tipo dela, faça antes UMA pergunta do roteiro ligada ao que ela contou, sem convidar ainda (vale uma vez só); senão, convide para ver os horários. Se ela insistir em receber por escrito, não discuta e não passe para {consultor}");
    tem("não repita: convide de novo com palavras novas, dizendo que a reunião é onde ela vê o caso dela; se ela recusar, use `adiar` ou `sem_interesse`.");
    tem("não tente uma terceira vez: convide para a reunião com a pergunta de horário.");
    tem("se ela repetir a condição, convide uma última vez com palavras novas (a reunião é onde ela vê o caso dela) e, se ela recusar, use `adiar` ou `sem_interesse`.");
    tem("Diga o preço SÓ depois de a pessoa perguntar preço, custo ou valor. 'Como funciona', 'o que está incluso', pedido de material, cansaço ou dúvida sobre o negócio não são pergunta de preço: nesses casos não diga nenhum valor, nem o 'a partir de'.");
    tem("Quando falar do consultor, use o artigo antes do nome conforme o gênero do nome ('o Thiago', 'com o Thiago', 'a Giovanna'); nunca 'com Thiago' nem 'Isso Thiago monta'.");
    tem("'já ajuda', 'bom para o consultor saber', 'pro consultor chegar'");
    tem("Se ela disser que não sabe se o dono deixa, acolha em uma frase, pergunte se o dono já sabe da ideia e convide, dizendo que {consultor} explica como isso funciona com o dono.");
    tem("Se ela escreveu seco ou irritada, diga só quem você é e por que escreveu, em uma bolha, sem explicar a empresa; explique só se ela perguntar. Se não, diga em uma frase o que a empresa faz.");
    tem("Ao adiar, escreva você mesma a mensagem de despedida, curta e ancorada no combinado: se ela pediu para você chamar, diga que chama no tempo que ela falou ('Combinado, te chamo na semana que vem'); se ela mesma vai chamar, diga que fica no aguardo. Nunca diga que não vai cobrar.");
    expect(r).not.toContain('ou quando for qualquer coisa que você não saiba responder');
    expect(r).not.toContain('Diga o preço só depois de a pessoa perguntar preço, valor ou como funciona');
  });

  it('o texto fixo de passagem tem as duas variações novas', () => {
    expect([...T.PASSAGEM_PARA_O_CONSULTOR]).toEqual([
      'Entendi. Vou chamar o consultor da equipe: é ele quem responde isso com os números do seu caso, e ele fala com você por aqui mesmo.',
      'Certo, vou passar para o consultor da equipe, que tira essas dúvidas direto com você. Ele te chama por aqui mesmo.',
    ]);
  });
});
