import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  APALAVRADO_PREFIX, ETIQUETA_PREFIX, MOTIVO_PREFIX,
  MOTIVOS_SOLAR, MOTIVOS_ELETROPOSTO, MOTIVOS_DO_NAO,
  STATUS_QUE_ACEITAM_MOTIVO, STATUS_TERMINAIS,
} from '../services/agenda/salaDeEspera';

// ── O MOTIVO DO NÃO (02/10/2026) ───────────────────────────────────────────
//
// A opção B. Ela existe por um número só: 589 reuniões de solar já aconteceram,
// 498 estão em SEM INTERESSE (85%) e nenhuma diz por quê.
//
// O RISCO DESTA MUDANÇA NÃO É O VOCABULÁRIO, é a TERCEIRA CHAVE. A leitura em
// lote do `/gerador/apalavrado` buscava duas marcas por card e separava com um
// `else` pega-tudo no ramo da espera. Com uma terceira chave, esse `else` passaria
// a engolir o motivo: o card apareceria em SALA DE ESPERA por ter dito não, sairia
// do ciclo de 48h e ninguém mais falaria com ele. Nada em tela diria por quê.
//
// Então o que se prende aqui é a SEPARAÇÃO, nos dois níveis: os prefixos não podem
// se confundir, e o código que separa não pode ter ramo pega-tudo.

describe('as tres marcas do card nao se confundem', () => {
  const TODAS = { APALAVRADO_PREFIX, ETIQUETA_PREFIX, MOTIVO_PREFIX };

  it('os tres prefixos sao diferentes', () => {
    const vs = Object.values(TODAS);
    expect(new Set(vs).size).toBe(vs.length);
  });

  it('nenhum prefixo e prefixo de outro', () => {
    // A leitura em lote separa por `startsWith`. Se um fosse prefixo do outro, a
    // marca cairia no mapa errado — e qual dos dois ganharia dependeria da ORDEM
    // dos `if`, que é o tipo de defeito que só aparece em produção.
    for (const [na, a] of Object.entries(TODAS)) {
      for (const [nb, b] of Object.entries(TODAS)) {
        if (na === nb) continue;
        expect(a.startsWith(b), `${na} comeca com ${nb}`).toBe(false);
      }
    }
  });

  it('todos terminam em dois-pontos, pra o id nao colar no nome', () => {
    for (const [n, p] of Object.entries(TODAS)) {
      expect(p.endsWith(':'), n).toBe(true);
    }
  });
});

describe('o vocabulario do motivo', () => {
  it('sao quatro por produto, e nao mais', () => {
    // Quatro é escolha, não acidente: a lição medida nesta casa é que menu grande
    // não é apertado. São 11 botões de status hoje e dois têm zero uso no solar.
    expect(MOTIVOS_SOLAR.size).toBe(4);
    expect(MOTIVOS_ELETROPOSTO.size).toBe(4);
  });

  it('os dois vocabularios nao se cruzam', () => {
    // Motivo que serve nos dois produtos esconde a diferença entre eles, que é
    // justamente o que o placar existe pra mostrar.
    const nos2 = [...MOTIVOS_SOLAR].filter(m => MOTIVOS_ELETROPOSTO.has(m));
    expect(nos2).toEqual([]);
  });

  it('a allowlist da rota e a uniao dos dois', () => {
    expect([...MOTIVOS_DO_NAO].sort())
      .toEqual([...MOTIVOS_SOLAR, ...MOTIVOS_ELETROPOSTO].sort());
    expect(MOTIVOS_DO_NAO.size).toBe(8);
  });

  it('os slugs sao minusculos, sem acento e sem espaco', () => {
    // Eles vão pra dentro de um JSON no `system_state` e viram chave de placar.
    for (const m of MOTIVOS_DO_NAO) expect(m).toMatch(/^[a-z][a-z_]*[a-z]$/);
  });

  it('reusa os slugs que o trigger do banco ja usa', () => {
    // `motivo_descarte` em `agendamentos` é escrito por um TRIGGER, a partir da
    // régua da LP do eletroposto, e 446 linhas já estão preenchidas com
    // `fluxo_baixo`, `sem_capital` e `nao_decisor`. Colunas diferentes, mesmo
    // vocabulário: quem cruzar os dois um dia não vai ter que traduzir.
    expect(MOTIVOS_ELETROPOSTO.has('sem_capital')).toBe(true);
    expect(MOTIVOS_SOLAR.has('nao_decisor')).toBe(true);
  });

  it('motivo so vale em card que disse nao', () => {
    // Gravar motivo num card vivo seria guardar a razão de uma recusa que não
    // houve, e o placar passaria a contar negociação em curso como perda.
    for (const st of STATUS_QUE_ACEITAM_MOTIVO) {
      expect(STATUS_TERMINAIS.has(st), st + ' deveria ser terminal').toBe(true);
    }
    // `fechou` é terminal e NÃO aceita motivo: é venda, não recusa.
    expect(STATUS_QUE_ACEITAM_MOTIVO.has('fechou')).toBe(false);
  });
});

// ── A SEPARAÇÃO NO CÓDIGO DA ROTA ──────────────────────────────────────────
//
// Teste de ESTRUTURA porque o defeito é de forma, a rota não tem harness, e o que
// precisa ser impedido é um `else` pega-tudo VOLTAR. O recorte é tolerante e todo
// `expect` fica dentro de um `it`: `expect` no corpo de um `describe` roda na
// coleta e derruba o arquivo inteiro, e o vitest responde "no tests" — o pior jeito
// de descobrir uma regressão. Já aconteceu duas vezes neste repo.
describe('a leitura em lote separa as tres marcas', () => {
  const rota = readFileSync(join(__dirname, '..', 'routes', 'gerador.ts'), 'utf8');
  const trecho = (() => {
    const i = rota.indexOf("router.get('/apalavrado'");
    if (i < 0) return '';
    const fim = rota.indexOf("router.post('/apalavrado'", i);
    return fim > i ? rota.slice(i, fim) : rota.slice(i, i + 6000);
  })();

  it('a rota existe e foi encontrada', () => {
    expect(trecho.length).toBeGreaterThan(0);
  });

  it('busca as TRES chaves por card', () => {
    for (const p of ['APALAVRADO_PREFIX', 'ETIQUETA_PREFIX', 'MOTIVO_PREFIX']) {
      expect(trecho).toContain(`\${${p}}\${x}`);
    }
  });

  it('cada prefixo e testado EXPLICITO: nenhum ramo pega-tudo', () => {
    // É esta linha que impede o motivo de virar sala de espera.
    for (const p of ['ETIQUETA_PREFIX', 'MOTIVO_PREFIX', 'APALAVRADO_PREFIX']) {
      expect(trecho).toMatch(new RegExp('startsWith\\(' + p + '\\)'));
    }
    // E o `} else {` solto não pode voltar ao bloco que separa as marcas.
    const sep = trecho.slice(trecho.indexOf('const esperas'));
    expect(sep.includes('} else {')).toBe(false);
  });

  it('o lote cabe na URL: tres chaves por id', () => {
    // 700 ids (1400 chaves) devolveu Bad Request em produção. Com a terceira
    // chave, 200 ids seriam 600 — ainda passa, mas a margem encolheu sem ninguém
    // mexer no número, que é como um corte silencioso nasce.
    const m = trecho.match(/const POR_CONSULTA = (\d+)/);
    expect(m, 'nao achei o POR_CONSULTA').toBeTruthy();
    const porConsulta = Number(m![1]);
    expect(porConsulta * 3).toBeLessThanOrEqual(500);
  });

  it('o motivo vem na resposta, inclusive na vazia', () => {
    expect(trecho).toMatch(/esperas: \{\}, etiquetas: \{\}, motivos: \{\}/);
    expect(trecho).toMatch(/res\.json\(\{ ok: true, esperas, etiquetas, motivos/);
  });
});

describe('a rota que grava o motivo', () => {
  const rota = readFileSync(join(__dirname, '..', 'routes', 'gerador.ts'), 'utf8');
  const trecho = (() => {
    const i = rota.indexOf("router.post('/motivo'");
    if (i < 0) return '';
    const fim = rota.indexOf("router.get('/motivos/placar'", i);
    return fim > i ? rota.slice(i, fim) : rota.slice(i, i + 3000);
  })();

  it('a rota existe', () => {
    expect(trecho.length).toBeGreaterThan(0);
  });

  it('recusa motivo fora da allowlist', () => {
    // Sem isto a marca vira campo de texto livre dentro do `system_state`, escrito
    // por uma rota pública do dashboard.
    expect(trecho).toMatch(/MOTIVOS_DO_NAO\.has\(motivo\)/);
    expect(trecho).toMatch(/status\(400\)/);
  });

  it('motivo vazio APAGA, em vez de gravar vazio', () => {
    // Clique errado tem que ter desfazer, senão o placar guarda o erro pra sempre.
    expect(trecho).toMatch(/if \(!motivo\)/);
    expect(trecho).toMatch(/\.delete\(\)\s*\.eq\('key', chave\)/);
  });

  it('guarda quem marcou e quando', () => {
    expect(trecho).toMatch(/motivo, em: agora, por:/);
  });
});

describe('o placar do nao', () => {
  const rota = readFileSync(join(__dirname, '..', 'routes', 'gerador.ts'), 'utf8');
  const trecho = (() => {
    const i = rota.indexOf("router.get('/motivos/placar'");
    return i < 0 ? '' : rota.slice(i, i + 4000);
  })();

  it('existe: sem ele a opcao B nao paga nada', () => {
    expect(trecho.length).toBeGreaterThan(0);
  });

  it('pagina por range: o PostgREST corta em 1000 e ignora o .limit()', () => {
    // Placar truncado mente PRA BAIXO e sem avisar, que é o pior jeito de um
    // número errado chegar numa decisão de verba.
    expect(trecho).toMatch(/\.range\(/);
    expect(trecho).toMatch(/parte\.length < 1000/);
  });

  it('separa por produto pela regra da casa, e o nulo cai no solar', () => {
    expect(trecho).toMatch(/includes\('eletroposto'\)/);
    expect(trecho).toMatch(/created_by \?\? ''/);
  });

  // ── O BANCO CERTO (02/10/2026) ──────────────────────────────────────────
  //
  // Este repo fala com DOIS Supabase, e eles não têm as mesmas tabelas:
  // `system_state` mora no PRINCIPAL, `agendamentos` mora no do GERADOR. Eu
  // escrevi o placar lendo `agendamentos` pelo cliente errado; o tsc passou, o
  // deploy passou, e a rota devolveu 200 em produção — porque com ZERO marcas o
  // laço nem roda. Só apareceu quando a sonda gravou uma marca antes de ler:
  // "Could not find the table 'public.agendamentos' in the schema cache".
  //
  // Teste de estrutura porque o erro é de ESCOLHA DE CLIENTE, e nenhum tipo o pega.
  it('le `agendamentos` pelo cliente do GERADOR e `system_state` pelo PRINCIPAL', () => {
    expect(trecho).toMatch(/supabaseGerador\.from\('agendamentos'\)/);
    // e o inverso: a tabela do principal NAO pode ser lida pelo cliente do gerador
    expect(trecho).not.toMatch(/supabaseGerador\.from\('system_state'\)/);
    expect(trecho).toMatch(/supabase\.from\('system_state'\)/);
  });

  it('nenhuma outra rota deste arquivo le `agendamentos` pelo cliente errado', () => {
    const todo = readFileSync(join(__dirname, '..', 'routes', 'gerador.ts'), 'utf8');
    // `supabase.from('agendamentos')` tem que ser ZERO: a tabela nao existe nesse
    // projeto, e qualquer ocorrencia e um 500 esperando a primeira linha de dado.
    const erradas = todo.match(/(?<!Gerador)supabase\.from\('agendamentos'\)/g) || [];
    expect(erradas).toEqual([]);
  });

  it('conta o que perdeu: marca sem ficha vem na resposta', () => {
    // Placar que não diz o que não conseguiu contar é placar que mente.
    expect(trecho).toMatch(/semFicha/);
  });
});
