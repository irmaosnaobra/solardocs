import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A REGRA DA AGENDA DE 13/10/2026, lida do JavaScript REAL da LP do eletroposto.
//
// Ordem do dono (12/10/2026): "Todos os ARRENDAMENTOS, INVESTIDORES e PARCEIROS
// cairão na agenda com suas etiquetas já colocadas. Apenas os CURIOSOS permanecem
// só na lista de cadastro." Vale para quem entrar a partir de 13/10/2026, 00:00 de
// Brasília; antes disso o quiz é o de antes.
//
// A decisão mora numa função pura da própria página (`regraDaAgenda`), dentro do
// bloco OS QUATRO CAMINHOS DO QUIZ. Este teste fatia a página do mesmo jeito que o
// eletropostoQuizDestino.test.ts e roda a função com o relógio que quiser. Se
// alguém mudar um valor de <option> ou a data, é aqui que aparece.
import { ETIQUETAS_DE_NEGOCIO } from '../services/agenda/salaDeEspera';

const LP = join(__dirname, '../../../dashboard/public/io/eletroposto/index.html');
const html = readFileSync(LP, 'utf8').split('\r\n').join('\n');
const ROTA = readFileSync(join(__dirname, '../routes/ioEletroposto.ts'), 'utf8');

const fatia = (de: string, ate: string, desde = 0): string => {
  const i = html.indexOf(de, desde);
  const j = html.indexOf(ate, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu da LP: "${de}" … "${ate}"`);
  return html.slice(i, j);
};

type Decisao = { caminho: string; tipo: string };
type Respostas = Partial<Record<'porta' | 'capLocal' | 'invValor' | 'ponto' | 'relacao' | 'modelo' | 'valor' | 'invest', string>> & { nota1?: boolean };
const quiz = new Function(
  fatia('const MODELO_DINHEIRO_NOSSO', 'function onModelo(')
  + fatia('// ══ OS QUATRO CAMINHOS DO QUIZ', '// ══ FIM DOS QUATRO CAMINHOS')
  + '\nreturn { regraDaAgenda, fichaDaAgendaNova, REGRA_AGENDA_DESDE, VALOR_CURIOSO };',
)() as {
  regraDaAgenda: (r: Respostas, agoraMs: number) => Decisao;
  fichaDaAgendaNova: (caminho: string, r: Record<string, string>) => string;
  REGRA_AGENDA_DESDE: string;
  VALOR_CURIOSO: Set<string>;
};

function opcoes(id: string): Array<{ value: string; texto: string }> {
  const m = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  if (!m) throw new Error(`select sumiu da LP: ${id}`);
  return [...m[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
    .map(o => ({ value: o[1], texto: o[2].trim() }))
    .filter(o => o.value);
}

const INICIO = Date.parse('2026-10-13T03:00:00Z');
const ANTES = Date.parse('2026-10-12T23:00:00Z');    // 20h de 12/10 em Brasília
const DEPOIS = Date.parse('2026-10-13T12:00:00Z');   // 09h de 13/10 em Brasília
const NADA: Decisao = { caminho: '', tipo: '' };

describe('a data da regra', () => {
  it('é 13/10/2026 às 00:00 de Brasília', () => {
    expect(quiz.REGRA_AGENDA_DESDE).toBe('2026-10-13T03:00:00Z');
    expect(new Date(INICIO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })).toContain('13/10/2026');
    expect(new Date(INICIO - 1).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })).toContain('12/10/2026');
  });

  it('um milissegundo antes não vale; no instante exato vale', () => {
    const integrador = { porta: 'integrador' };
    expect(quiz.regraDaAgenda(integrador, INICIO - 1)).toEqual(NADA);
    expect(quiz.regraDaAgenda(integrador, INICIO)).toEqual({ caminho: 'integrador', tipo: 'integrador' });
  });

  it('relógio ilegível não liga a regra', () => {
    expect(quiz.regraDaAgenda({ porta: 'integrador' }, NaN)).toEqual(NADA);
    expect(quiz.regraDaAgenda({ porta: 'integrador' }, undefined as unknown as number)).toEqual(NADA);
  });
});

describe('antes de 13/10 o quiz é exatamente o de antes', () => {
  const portas = opcoes('f-porta').map(o => o.value);

  it('as quatro portas existem', () => {
    expect(portas.sort()).toEqual(['carregador', 'comercio', 'integrador', 'investidor']);
  });

  it('nenhuma combinação de respostas abre agenda nova nem manda tipo', () => {
    let rodadas = 0;
    for (const porta of opcoes('f-porta'))
      for (const capLocal of ['', ...opcoes('f-cap-local').map(o => o.value)])
        for (const invValor of ['', ...opcoes('f-inv-valor').map(o => o.value)])
          for (const ponto of ['', ...opcoes('f-ponto').map(o => o.value)])
            for (const relacao of ['', ...opcoes('f-relacao').map(o => o.value)])
              for (const modelo of ['', ...opcoes('f-modelo').map(o => o.value)])
                for (const invest of ['', 'naosei', 'proprio']) {
                  rodadas++;
                  const r = { porta: porta.value, capLocal, invValor, ponto, relacao, modelo, valor: '', invest };
                  expect(quiz.regraDaAgenda(r, ANTES), JSON.stringify(r)).toEqual(NADA);
                }
    expect(rodadas).toBeGreaterThan(1000);
  });
});

describe('investidor sem local: do piso pra cima marca reunião, curioso fica na lista', () => {
  const locais = opcoes('f-cap-local').filter(o => o.value !== 'meu');

  it('com R$ 140 mil vai para a agenda como cotista; antes da data, não', () => {
    const r = { porta: 'investidor', capLocal: 'nao', invValor: '140' };
    expect(quiz.regraDaAgenda(r, DEPOIS)).toEqual({ caminho: 'cotista', tipo: 'cotista' });
    expect(quiz.regraDaAgenda(r, ANTES)).toEqual(NADA);
  });

  it('com "menos de R$ 50 mil" ou "ainda não sei" é Curioso: não muda', () => {
    for (const invValor of ['menos_50', 'naosei'])
      for (const l of locais)
        expect(quiz.regraDaAgenda({ porta: 'investidor', capLocal: l.value, invValor }, DEPOIS)).toEqual(NADA);
  });

  for (const l of locais) for (const v of opcoes('f-inv-valor')) {
    it(`${l.value} + "${v.texto}"`, () => {
      const d = quiz.regraDaAgenda({ porta: 'investidor', capLocal: l.value, invValor: v.value }, DEPOIS);
      expect(d).toEqual(quiz.VALOR_CURIOSO.has(v.value) ? NADA : { caminho: 'cotista', tipo: 'cotista' });
    });
  }

  it('quem ainda não respondeu o local ou o valor não abre agenda', () => {
    expect(quiz.regraDaAgenda({ porta: 'investidor' }, DEPOIS)).toEqual(NADA);
    expect(quiz.regraDaAgenda({ porta: 'investidor', capLocal: 'nao' }, DEPOIS)).toEqual(NADA);
  });
});

describe('arrendamento e parceiro passam a marcar reunião', () => {
  for (const relacao of ['administro', 'represento', 'inquilino']) {
    it(`comércio: ponto definido + ${relacao} + modelo 01 vai para a agenda como arrendamento`, () => {
      const r = { porta: 'comercio', ponto: 'definido', relacao, modelo: 'cedo_espaco', valor: '' };
      expect(quiz.regraDaAgenda(r, DEPOIS)).toEqual({ caminho: 'arrendamento', tipo: 'arrendamento' });
      expect(quiz.regraDaAgenda(r, ANTES)).toEqual(NADA);
    });
  }

  it('o investidor com local que administra e pede o modelo 01 também é arrendamento', () => {
    const r = { porta: 'investidor', capLocal: 'meu', ponto: 'definido', relacao: 'administro', modelo: 'cedo_espaco', valor: '' };
    expect(quiz.regraDaAgenda(r, DEPOIS)).toEqual({ caminho: 'arrendamento', tipo: 'arrendamento' });
  });

  it('integrador vai para a agenda como integrador', () => {
    expect(quiz.regraDaAgenda({ porta: 'integrador' }, DEPOIS)).toEqual({ caminho: 'integrador', tipo: 'integrador' });
  });
});

describe('quem já agendava: o fluxo não muda, só ganha a etiqueta quando há tipo claro', () => {
  const dono = { porta: 'comercio', ponto: 'definido', relacao: 'proprietario' };

  it('proprietário no modelo 01: arrendamento, sem cadastro novo', () => {
    expect(quiz.regraDaAgenda({ ...dono, modelo: 'cedo_espaco', valor: '' }, DEPOIS)).toEqual({ caminho: '', tipo: 'arrendamento' });
  });

  it('ponto definido e "não sei como vou pagar" (PONTO DISPONIVEL PARA INVESTIDOR): arrendamento', () => {
    expect(quiz.regraDaAgenda({ ...dono, modelo: 'chave_na_mao', valor: '140', invest: 'naosei' }, DEPOIS)).toEqual({ caminho: '', tipo: 'arrendamento' });
    // o marcador exige ponto DEFINIDO: negociando com "não sei" não leva
    expect(quiz.regraDaAgenda({ porta: 'comercio', ponto: 'negociando', modelo: 'chave_na_mao', valor: '140', invest: 'naosei' }, DEPOIS)).toEqual(NADA);
  });

  it('dono de comércio que paga o próprio eletroposto: sem tipo', () => {
    for (const modelo of ['meio_a_meio', 'chave_na_mao', 'nao_sei'])
      expect(quiz.regraDaAgenda({ ...dono, modelo, valor: '140', invest: 'proprio' }, DEPOIS), modelo).toEqual(NADA);
  });

  it('porta do investidor com local próprio e capital: cotista', () => {
    const r = { porta: 'investidor', capLocal: 'meu', ponto: 'definido', relacao: 'proprietario', modelo: 'chave_na_mao', valor: '280', invest: 'proprio' };
    expect(quiz.regraDaAgenda(r, DEPOIS)).toEqual({ caminho: '', tipo: 'cotista' });
  });

  it('quem não põe dinheiro não é cotista: investidor com local no modelo 01 sai arrendamento', () => {
    const r = { porta: 'investidor', capLocal: 'meu', ponto: 'definido', relacao: 'proprietario', modelo: 'cedo_espaco', valor: '' };
    expect(quiz.regraDaAgenda(r, DEPOIS)).toEqual({ caminho: '', tipo: 'arrendamento' });
  });

  it('carregador não muda', () => {
    expect(quiz.regraDaAgenda({ porta: 'carregador' }, DEPOIS)).toEqual(NADA);
  });
});

describe('curioso não muda', () => {
  it('negociando o local e querendo que a gente invista tudo: fica na lista', () => {
    expect(quiz.regraDaAgenda({ porta: 'comercio', ponto: 'negociando', modelo: 'cedo_espaco', valor: '' }, DEPOIS)).toEqual(NADA);
  });

  it('trilha do ponto sem local sob controle (NOTA 1) segue para o curso', () => {
    for (const porta of ['comercio', 'investidor'])
      expect(quiz.regraDaAgenda({ porta, capLocal: 'meu', ponto: 'sem_ideia', modelo: 'chave_na_mao', valor: '140', nota1: true }, DEPOIS)).toEqual(NADA);
  });
});

describe('o tipo que a LP manda é o que o servidor aceita', () => {
  it('os três tipos estão na lista da rota e na lista de etiquetas de negócio', () => {
    const m = ROTA.match(/TIPOS_DO_CARD_LP = new Set<string>\(\[([^\]]+)\]\)/);
    expect(m).toBeTruthy();
    const naRota = (m![1].match(/'([a-z_]+)'/g) || []).map(q => q.replace(/'/g, '')).sort();
    expect(naRota).toEqual(['arrendamento', 'cotista', 'integrador']);
    for (const t of naRota) expect(ETIQUETAS_DE_NEGOCIO.has(t), t).toBe(true);
  });

  it('a regra nunca devolve um tipo fora dessa lista', () => {
    const vistos = new Set<string>();
    for (const porta of opcoes('f-porta'))
      for (const capLocal of ['', ...opcoes('f-cap-local').map(o => o.value)])
        for (const invValor of ['', '140', 'menos_50'])
          for (const ponto of ['', ...opcoes('f-ponto').map(o => o.value)])
            for (const relacao of ['', ...opcoes('f-relacao').map(o => o.value)])
              for (const modelo of ['', ...opcoes('f-modelo').map(o => o.value)])
                for (const invest of ['', 'naosei'])
                  vistos.add(quiz.regraDaAgenda({ porta: porta.value, capLocal, invValor, ponto, relacao, modelo, valor: '', invest }, DEPOIS).tipo);
    expect([...vistos].sort()).toEqual(['', 'arrendamento', 'cotista', 'integrador']);
  });
});

describe('a ficha do card dos dois caminhos que não passam pela trilha do ponto', () => {
  // A 1ª linha é contrato com o trigger `eletroposto_estruturar` do banco, que
  // lê `^LP ELETROPOSTO [—·] (.+)$` para derivar o perfil.
  const PRIMEIRA = /^LP ELETROPOSTO [—·] (.+)$/;
  // Rótulos que a régua de descarte lê: esta pessoa não respondeu nenhuma delas.
  const DA_REGUA = [/^Ponto:/m, /^Decisor:/m, /^Como pretende investir:/m, /^NOTA [123]/m];

  it('investidor sem local: perfil na 1ª linha, o local e o valor que ele marcou', () => {
    const f = quiz.fichaDaAgendaNova('cotista', { local: 'Não tenho local, é o que eu preciso achar', valor: 'R$ 140 mil' });
    const linhas = f.split('\n');
    expect(linhas[0].match(PRIMEIRA)?.[1]).toBe('Investidor');
    expect(linhas).toContain('Local: Não tenho local, é o que eu preciso achar');
    // mesmo rótulo que o servidor lê para o LeadQuente
    expect(f).toMatch(/^Quanto pretende investir:\s*R\$ 140 mil$/m);
    for (const re of DA_REGUA) expect(f).not.toMatch(re);
  });

  it('parceiro: a ficha leva a empresa e o que ele faz', () => {
    const f = quiz.fichaDaAgendaNova('integrador', {
      empresa: 'Solar Minas Ltda', cnpj: '12.345.678/0001-90', atuacao: 'Instalo energia solar',
      experiencia: 'Nunca instalei', interesse: 'Quero instalar para a NEXUS', equipe: 'Equipe própria',
    });
    const linhas = f.split('\n');
    expect(linhas[0].match(PRIMEIRA)?.[1]).toBe('Integrador');
    expect(linhas).toContain('Empresa: Solar Minas Ltda');
    expect(linhas).toContain('O que faz: Instalo energia solar');
    expect(linhas).toContain('CNPJ: 12.345.678/0001-90');
    for (const re of DA_REGUA) expect(f).not.toMatch(re);
  });

  it('sem CNPJ a linha some em vez de sair vazia', () => {
    const f = quiz.fichaDaAgendaNova('integrador', { empresa: 'X', cnpj: '', atuacao: 'a', experiencia: 'b', interesse: 'c', equipe: 'd' });
    expect(f).not.toContain('CNPJ');
    expect(f.split('\n').every(l => l.trim().length > 0)).toBe(true);
  });
});

// ── A ORDEM QUE NÃO PODE INVERTER: cadastro, ok, e só então a agenda ─────────
// Não há DOM neste repo para rodar a página inteira, então o que se prende aqui é
// a FORMA do código, como o etiquetaPreservada.test.ts faz com a rota. Cada trecho
// é recortado por marcador; marcador que some quebra o teste em vez de passar.
describe('a ordem na página: grava o cadastro, confere o ok e só então abre a agenda', () => {
  const corpoDe = (assinatura: string): string => {
    const i = html.indexOf(assinatura);
    if (i < 0) throw new Error(`função sumiu da LP: ${assinatura}`);
    const j = html.indexOf('\n}\n', i);
    return html.slice(i, j);
  };
  const ordem = (txt: string, ...trechos: string[]) => {
    let de = -1;
    for (const t of trechos) {
      const i = txt.indexOf(t, de + 1);
      expect(i, `"${t}" fora de ordem ou ausente`).toBeGreaterThan(de);
      de = i;
    }
  };

  it('integrador: POST /parceria, ok, e só então o passo do horário', () => {
    const f = corpoDe('async function cadastrarIntegrador(){');
    ordem(f, "fetch('/_api/io/eletroposto/parceria'", "lado: 'integrador'", "if(!r.ok) throw",
      "track('integrador_cadastrado')", "abrirAgendaDoCadastro('integrador')", "'ag-ok-int'");
    expect(f).toContain("regraAgora().caminho === 'integrador' && abrirAgendaDoCadastro('integrador')");
  });

  it('investidor sem local: POST /parceria, ok, e só então o passo do horário; o curioso sai antes', () => {
    const f = corpoDe('async function cadastrarInvestidor(){');
    ordem(f, "if(r.rota === 'nota1')", 'return gravarCurioso(', "fetch('/_api/io/eletroposto/parceria'",
      "if(!resp.ok) throw", "track('investidor_do_quiz')", "abrirAgendaDoCadastro('cotista')", "mostrarFim('ag-ok-inv')");
    expect(f).toContain("regraAgora().caminho === 'cotista' && abrirAgendaDoCadastro('cotista')");
  });

  it('arrendamento: o cadastro sai na passagem para o horário, e o passo só abre depois do ok', () => {
    const passo = corpoDe('function passoProximo(){');
    ordem(passo, "vivos[passoAtual + 1].id === 'p-horario'", "regraAgora().caminho === 'arrendamento'",
      "!cadastroVale('arrendamento')", 'return cadastrarArrendamentoEAbrir();', 'passoAtual++; pintarPasso(); return;');
    const abrir = corpoDe('async function cadastrarArrendamentoEAbrir(){');
    ordem(abrir, 'await gravarCadastroArrendamento();', 'catch(e)', 'return erro(', "findIndex(p => p.id === 'p-horario')", 'pintarPasso();');
    const gravar = corpoDe('async function gravarCadastroArrendamento(){');
    ordem(gravar, "fetch('/_api/io/eletroposto/parceria'", "if(!r.ok) throw", "track('arrendamento_do_quiz')", "caminho: 'arrendamento'");
  });

  it('no clique de confirmar, o arrendamento sem cadastro grava antes de seguir; antes da data vê a tela de sempre', () => {
    const ag = corpoDe('async function agendar(){');
    ordem(ag, 'if(paraArrendamento(ponto.value, relacao.value, modelo.value, valor.value)){',
      "const comAgenda = regraAgora().caminho === 'arrendamento';", "if(!(comAgenda && cadastroVale('arrendamento'))){",
      'await gravarCadastroArrendamento();', 'if(!comAgenda){', "'ag-ok-arrend'", 'return;',
      "if(!slotSel) return erro('Escolha um horário na lista acima para confirmar.');", 'tipo: regraAgora().tipo');
  });

  it('o passo do horário só abre para os caminhos novos com o cadastro gravado', () => {
    expect(html).toContain("{ id:'p-horario', quando:() => vaiParaAgenda() || !!agendaDoCadastro(),");
    const f = corpoDe('function agendaDoCadastro(){');
    expect(f).toContain("(c === 'cotista' || c === 'integrador') && cadastroVale(c)");
    expect(html).toContain('!!cadastroFeito && cadastroFeito.caminho === caminho && cadastroFeito.tel === telParaBanco()');
  });

  it('no passo do horário o botão AGENDA, mesmo na porta do integrador e do investidor', () => {
    const f = corpoDe('function pintarPasso(){');
    ordem(f, "const fecha = !pronto ? 'proximo'", ": atual.id === 'p-horario' ? 'agendar'", ": soIntegrador()       ? 'integrador'",
      ": investidorSemLocal() ? 'investidor'");
  });

  it('os dois caminhos novos montam a ficha e passam pelo MESMO portão de presença', () => {
    const ag = corpoDe('async function agendar(){');
    ordem(ag, 'if(soCarregador()){', 'const caminhoNovo = agendaDoCadastro();', 'if(caminhoNovo){',
      "if(!slotSel) return erro(", 'fichaDaAgendaNova(caminhoNovo,', "origem: 'lp_eletroposto', tipo: caminhoNovo };",
      'abrirConfirma();', "if(!perfil.value)       return erro('Selecione seu perfil.');");
  });

  it('o POST do agendamento leva `tipo` só quando existe, e o card segue `agendado` e `lp_eletroposto`', () => {
    const g = corpoDe('async function gravarAgendamento(){');
    expect(g).toContain('const { nome, tel, cidade, perfil, obs, temperatura, origem, tipo } = pendente;');
    expect(g).toContain('...(tipo ? { tipo } : {}),');
    expect(g).toContain("status:           'agendado',");
    expect(g).toContain("created_by:       origem || 'lp_eletroposto',");
    // a confirmação é a mesma tela dos outros agendamentos
    ordem(g, 'await agendarNaApi({', "document.getElementById('ag-ok').style.display = 'block';");
  });

  it('nenhum caminho novo grava card com outra origem', () => {
    const origens = [...corpoDe('async function agendar(){').matchAll(/origem: '([a-z_]+)'/g)].map(m => m[1]);
    expect([...new Set(origens)].sort()).toEqual(['lp_eletroposto', 'lp_eletroposto_carregador']);
  });

  it('ficha de teste não dispara o Schedule do navegador', () => {
    const g = corpoDe('async function gravarAgendamento(){');
    ordem(g, 'if(!/^\\s*teste/i.test(nome)){', "fbq('track','Schedule'");
  });
});
