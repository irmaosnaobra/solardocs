import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ETIQUETA_PREFIX, ETIQUETAS_DE_NEGOCIO, STATUS_TERMINAIS,
  APALAVRADO_PREFIX, esperaAte, naSalaDeEspera,
} from '../services/agenda/salaDeEspera';

// ── A ETIQUETA SOBREVIVE AO STATUS TERMINAL (01/10/2026) ───────────────────
//
// Ordem do Thiago: "o sem interesse poderia muito bem preservar a etiqueta, e
// quando colocar a etiqueta de SEM INTERESSE ficariam as 2, e no CRM o lead
// ficaria na SEM INTERESSE".
//
// O que se prende aqui são as DUAS LISTAS, e elas são o contrato entre três
// lugares: o servidor (que recusa etiqueta fora da lista), o CRM e a agenda (que
// decidem quando gravar e quando mostrar). As três cópias divergindo é o defeito
// que este arquivo existe pra pegar — e já aconteceu neste repo com a lista de
// status que ocupa horário na agenda.

describe('as duas listas da etiqueta preservada', () => {
  it('as etiquetas de negociação são as dez que dizem de que negócio se tratava', () => {
    // COTISTA e INTEGRADOR entraram em 01/10/2026, junto com os botões. Os três
    // riscados no mesmo dia (`em_atendimento`, `proposta_apresentada`,
    // `falando_whatsapp`) FICAM: eles perderam o botão, não o passado — 97
    // fichas ainda os carregam, e é justo essa etiqueta que o terminal precisa
    // guardar pra o card não virar só "sem interesse" sem assunto.
    expect([...ETIQUETAS_DE_NEGOCIO].sort()).toEqual([
      'arrendamento', 'carregador', 'chave_na_mao', 'cotista', 'em_atendimento',
      'falando_whatsapp', 'fez_orcamento', 'integrador', 'meio_a_meio',
      'proposta_apresentada',
    ]);
  });

  it('os terminais são os cinco que apagam a etiqueta', () => {
    expect([...STATUS_TERMINAIS].sort()).toEqual([
      'cancelado', 'fechou', 'fechou_concorrente', 'perdido', 'sem_interesse',
    ]);
  });

  // AS DUAS LISTAS NÃO PODEM SE CRUZAR. Se um status estivesse nas duas, gravar
  // ele dispararia o ramo que GUARDA e o ramo que APAGA na mesma troca, e qual
  // dos dois ganha dependeria da ordem do `if` — bug que só aparece num status.
  it('nenhum status está nas duas listas', () => {
    const cruzam = [...ETIQUETAS_DE_NEGOCIO].filter(s => STATUS_TERMINAIS.has(s));
    expect(cruzam).toEqual([]);
  });

  // `apalavrado` fica FORA das duas de propósito: ele não é etiqueta de
  // negociação (é a sala de espera, e desde 01/10 nem é status) e não é terminal
  // (o card volta pela data). Entrar em qualquer uma faria a espera apagar a
  // etiqueta que ela existe pra preservar.
  it('apalavrado não está em nenhuma das duas', () => {
    expect(ETIQUETAS_DE_NEGOCIO.has('apalavrado')).toBe(false);
    expect(STATUS_TERMINAIS.has('apalavrado')).toBe(false);
  });

  it('`agendado` e `nao_atendeu` também ficam fora: eles não são negociação', () => {
    // O card volta pra eles pela régua da agenda, e eles não dizem modelo de
    // negócio nenhum — guardar "AGENDADO" como etiqueta preservada seria ruído.
    for (const st of ['agendado', 'nao_atendeu', 'reagendar']) {
      expect(ETIQUETAS_DE_NEGOCIO.has(st)).toBe(false);
      expect(STATUS_TERMINAIS.has(st)).toBe(false);
    }
  });

  // ── AS TRÊS CÓPIAS DA LISTA (01/10/2026) ──────────────────────────────────
  //
  // O cabeçalho deste arquivo sempre disse que o defeito a pegar é "as três
  // cópias divergindo", e nenhum teste comparava as três. Hoje eu mesmo editei a
  // lista nos três lugares à mão pra entrar com COTISTA e INTEGRADOR: é
  // exatamente o movimento em que uma fica pra trás.
  //
  // E o estrago é silencioso dos dois lados. Se a tela manda uma etiqueta que o
  // servidor não tem na lista, a rota recusa e o card perde o assunto do
  // negócio. Se a tela não manda a que o servidor tem, ninguém nem tenta.
  // Nenhum dos dois dá erro em tela: só falta informação depois.
  it('as três cópias da lista são a MESMA lista', () => {
    const lista = (txt: string, nome: string): string[] => {
      const i = txt.indexOf(nome);
      expect(i).toBeGreaterThan(-1);
      const fim = txt.indexOf(']', i);
      expect(fim).toBeGreaterThan(i);
      return (txt.slice(i, fim).match(/'([a-z_]+)'/g) || [])
        .map(q => q.replace(/'/g, '')).sort();
    };
    const pub = join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador');
    const naAgenda = lista(
      readFileSync(join(pub, 'agenda', 'index.html'), 'utf8'), 'const ETIQUETAS_NEGOCIO');
    const noCrm = lista(
      readFileSync(join(pub, 'index.html'), 'utf8'), 'const CRM_ETIQUETAS_NEGOCIO');
    const noServidor = [...ETIQUETAS_DE_NEGOCIO].sort();

    expect(naAgenda).toEqual(noServidor);
    expect(noCrm).toEqual(noServidor);
  });

  // Mesma ideia pros terminais: é a outra metade do par, e um terminal que só
  // existe numa das telas apaga a etiqueta num lugar e preserva no outro.
  it('os terminais também são os mesmos nas três', () => {
    const lista = (txt: string, nome: string): string[] => {
      const i = txt.indexOf(nome);
      expect(i).toBeGreaterThan(-1);
      const fim = txt.indexOf(']', i);
      return (txt.slice(i, fim).match(/'([a-z_]+)'/g) || [])
        .map(q => q.replace(/'/g, '')).sort();
    };
    const pub = join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador');
    expect(lista(readFileSync(join(pub, 'agenda', 'index.html'), 'utf8'),
      'const STATUS_TERMINAIS')).toEqual([...STATUS_TERMINAIS].sort());
    expect(lista(readFileSync(join(pub, 'index.html'), 'utf8'),
      'const CRM_STATUS_TERMINAIS')).toEqual([...STATUS_TERMINAIS].sort());
  });

  it('os dois prefixos de marca são diferentes, senão uma sobrescreve a outra', () => {
    expect(ETIQUETA_PREFIX).not.toBe(APALAVRADO_PREFIX);
    expect(ETIQUETA_PREFIX.endsWith(':')).toBe(true);
    expect(APALAVRADO_PREFIX.endsWith(':')).toBe(true);
    // E nenhum é prefixo do outro: a leitura em lote separa as duas por
    // `startsWith`, e um ser prefixo do outro faria a etiqueta cair no mapa das
    // esperas.
    expect(ETIQUETA_PREFIX.startsWith(APALAVRADO_PREFIX)).toBe(false);
    expect(APALAVRADO_PREFIX.startsWith(ETIQUETA_PREFIX)).toBe(false);
  });
});

// A sala de espera ganhou companhia no mesmo arquivo, então as bordas dela vão
// aqui também: elas são a razão de o módulo ser neutro.
describe('as bordas da data da sala de espera', () => {
  it('data boa é a data', () => {
    expect(esperaAte({ retomar_em: '2026-10-30T15:00:00.000Z' }))
      .toBe(Date.parse('2026-10-30T15:00:00.000Z'));
  });

  it('data ilegível cai em 30 dias desde que foi marcada, não em silêncio eterno', () => {
    const em = '2026-10-01T00:00:00.000Z';
    expect(esperaAte({ retomar_em: 'amanhã de manhã', em }))
      .toBe(Date.parse(em) + 30 * 86400_000);
  });

  it('marca sem data NENHUMA devolve null, e aí a ficha continua rodando', () => {
    // Carimbo quebrado não pode ser a razão de um cliente desaparecer: entre
    // "volta pra agenda sem precisar" e "nunca mais volta", o primeiro custa um
    // horário e o segundo custa o cliente.
    expect(esperaAte({ aguardando: 'esperando o investidor' })).toBe(null);
    expect(esperaAte(null)).toBe(null);
    expect(esperaAte(undefined)).toBe(null);
  });

  it('naSalaDeEspera compara com o agora que recebe, sem relógio próprio', () => {
    const agora = Date.parse('2026-10-15T12:00:00.000Z');
    expect(naSalaDeEspera({ retomar_em: '2026-10-30' }, agora)).toBe(true);
    expect(naSalaDeEspera({ retomar_em: '2026-10-01' }, agora)).toBe(false);
    expect(naSalaDeEspera({}, agora)).toBe(false);
  });
});

// ── O `soltar` NAO PODE LEVAR O CONTADOR DE VOLTAS JUNTO (01/10/2026) ──────
//
// A rota `/gerador/apalavrado/soltar` e chamada pelas DUAS telas em toda troca
// de status, inclusive apertar NAO ATENDEU de novo, que e o movimento normal de
// quem acabou de ligar e nao foi atendido.
//
// Por algumas horas de 01/10 ela apagou o carimbo do ciclo INTEIRO pra zerar a
// escada. So que o mesmo valor guarda `n`, que e o unico teto do caminho que
// manda mensagem: um card que ja tinha tomado as tres mensagens "voce nao
// conseguiu entrar na apresentacao" ganhava mais tres a cada toque.
//
// E teste de ESTRUTURA porque o defeito e de forma: a rota nao tem harness, e o
// que precisa ser impedido e um `delete` numa chave especifica voltar ao codigo.
describe('a rota que solta a espera', () => {
  const rota = readFileSync(join(__dirname, '..', 'routes', 'gerador.ts'), 'utf8');
  // O recorte é TOLERANTE e o `expect` fica dentro dos testes. `expect` no corpo
  // de um `describe` roda na COLETA e derruba o arquivo inteiro: o vitest
  // responde "no tests", que é o pior jeito de descobrir uma regressão. Já
  // aconteceu uma vez hoje, no teste do relatório do cron.
  const trecho = (() => {
    const i = rota.indexOf("router.post('/apalavrado/soltar'");
    if (i < 0) return '';
    const fim = rota.indexOf('});', rota.indexOf('} catch', i));
    return fim > i ? rota.slice(i, fim) : '';
  })();

  it('a rota existe e foi encontrada', () => {
    expect(trecho.length).toBeGreaterThan(0);
  });

  it('apaga a marca da espera', () => {
    expect(trecho).toMatch(/delete\(\)\s*\.eq\('key', `\$\{APALAVRADO_PREFIX\}\$\{id\}`\)/);
  });

  it('NAO apaga o carimbo do ciclo: ele guarda o teto de voltas', () => {
    // A primeira versão deste teste procurava `.delete()` seguido, em até 200
    // caracteres, do nome de uma chave de ciclo. Era largo demais: casava o
    // delete LEGÍTIMO da espera com a menção às chaves no bloco de baixo, e
    // acusava o código consertado. Teste que acusa o certo é tão ruim quanto
    // teste que deixa passar o errado.
    //
    // A régua precisa é: existe UM delete só, e ele é o da marca da espera.
    const deletes = [...trecho.matchAll(/\.delete\(\)/g)].length;
    expect(deletes).toBe(1);
    expect(trecho).toMatch(/\.delete\(\)\s*\.eq\('key', `\$\{APALAVRADO_PREFIX\}\$\{id\}`\)/);
    // e nenhum delete em lote, que era a forma antiga
    expect(trecho).not.toMatch(/\.delete\(\)[\s\S]{0,40}\.in\('key'/);
  });

  it('zera a escada reescrevendo o carimbo, sem levar `n` nem `relogio`', () => {
    expect(trecho).toContain("delete v.status;");
    expect(trecho).toContain("delete v.degrau;");
    // o que NAO pode ser apagado
    expect(trecho).not.toContain('delete v.n;');
    expect(trecho).not.toContain('delete v.relogio;');
    expect(trecho).not.toContain('delete v.ultimo;');
  });
});
