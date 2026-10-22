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
  + '\nreturn { regraDaAgenda, fichaDaAgendaNova, cartoesDaConfirmacao, textoSemHorario, REGRA_AGENDA_DESDE, VALOR_CURIOSO };',
)() as {
  regraDaAgenda: (r: Respostas, agoraMs: number) => Decisao;
  fichaDaAgendaNova: (caminho: string, r: Record<string, string>) => string;
  cartoesDaConfirmacao: (caminho?: string) => { c2: [string, string]; c3: [string, string] } | null;
  textoSemHorario: (cadastrado: boolean) => string;
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
    // 22/10/2026: o comércio sem ponto (NOTA 1 sem capital, curioso) não vê o passo (destinoDoComercio)
    expect(html).toContain("{ id:'p-horario', quando:() => (vaiParaAgenda() && destinoDoComercio() !== 'sem_horario') || !!agendaDoCadastro(),");
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
      "if(!slotSel) return erro(", 'fichaDaAgendaNova(caminhoNovo,', "origem: 'lp_eletroposto', tipo: caminhoNovo,",
      'abrirConfirma();', "if(!perfil.value)       return erro('Selecione seu perfil.');");
  });

  it('o POST do agendamento leva `tipo` só quando existe, e o card segue `agendado` e `lp_eletroposto`', () => {
    const g = corpoDe('async function gravarAgendamento(){');
    expect(g).toContain('const { nome, tel, cidade, perfil, obs, temperatura, origem, tipo, cartoes } = pendente;');
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

// ACABAMENTO DA LANDING (13/10/2026): a reunião não é "por vídeo" na tela, o
// investidor sem local e o parceiro não ouvem falar de "estudo do seu ponto", e o
// dia sem horário muda de texto para quem já está cadastrado.
describe('os cartões da confirmação de quem marcou sem ter ponto', () => {
  it('investidor sem local e parceiro recebem a variação do redator, palavra por palavra', () => {
    expect(quiz.cartoesDaConfirmacao('cotista')).toEqual({
      c2: ['Vamos preparar a conversa.', 'Na reunião, o consultor mostra as opções de negócio que encaixam no valor que você indicou aqui.'],
      c3: ['Traga suas dúvidas.', 'Energia, obra, prazo, formas de pagamento: é a hora de perguntar tudo.'],
    });
    expect(quiz.cartoesDaConfirmacao('integrador')).toEqual({
      c2: ['Vamos conversar sobre a parceria.', 'Na reunião, o consultor conversa com você sobre como trabalhar junto.'],
      c3: ['Traga suas dúvidas.', 'Como a parceria funciona, a sua região, o que você instala hoje: é a hora de perguntar tudo.'],
    });
  });

  it('comércio, arrendamento, carregador e quem não tem caminho ficam com os cartões de hoje', () => {
    for (const c of ['arrendamento', '', undefined, 'carregador', 'comercio', 'toString', '__proto__']) {
      expect(quiz.cartoesDaConfirmacao(c), String(c)).toBeNull();
    }
  });

  it('a escolha parte do caminho do cadastro, não do tipo: investidor COM local tem tipo cotista e fica com os de hoje', () => {
    const comLocal = quiz.regraDaAgenda({ porta: 'investidor', capLocal: 'meu', ponto: 'definido', relacao: 'proprietario', modelo: 'chave_na_mao', valor: '280', invest: 'proprio' }, DEPOIS);
    expect(comLocal).toEqual({ caminho: '', tipo: 'cotista' });
    expect(quiz.cartoesDaConfirmacao(comLocal.caminho)).toBeNull();
    const semLocal = quiz.regraDaAgenda({ porta: 'investidor', capLocal: 'nao', invValor: '140' }, DEPOIS);
    expect(quiz.cartoesDaConfirmacao(semLocal.caminho)).not.toBeNull();
    const parceiro = quiz.regraDaAgenda({ porta: 'integrador' }, DEPOIS);
    expect(quiz.cartoesDaConfirmacao(parceiro.caminho)).not.toBeNull();
    const arrend = quiz.regraDaAgenda({ porta: 'comercio', ponto: 'definido', relacao: 'inquilino', modelo: 'cedo_espaco' }, DEPOIS);
    expect(arrend.caminho).toBe('arrendamento');
    expect(quiz.cartoesDaConfirmacao(arrend.caminho)).toBeNull();
    expect(quiz.cartoesDaConfirmacao(quiz.regraDaAgenda({ porta: 'carregador' }, DEPOIS).caminho)).toBeNull();
  });

  it('só o ramo novo guarda o caminho no pendente, e a troca roda antes de mostrar a tela', () => {
    expect((html.match(/cartoes: caminhoNovo/g) || []).length).toBe(1);
    const i = html.indexOf('async function gravarAgendamento(){');
    const g = html.slice(i, html.indexOf('\nmontarSlots();', i));
    const a = g.indexOf('aplicarCartoesDoOk(cartoes);');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(g.indexOf("document.getElementById('ag-ok').style.display = 'block';"));
    // os dois cartões têm onde receber o texto
    expect(html).toContain('<div class="okTx" id="ok-c2">');
    expect(html).toContain('<div class="okTx" id="ok-c3">');
  });
});

describe('a tela de dia sem horário', () => {
  it('quem já tem o cadastro gravado vê o texto novo', () => {
    expect(quiz.textoSemHorario(true)).toBe('Seu cadastro ficou registrado. A agenda dos próximos dias está cheia, e a equipe chama você pelo WhatsApp para marcar a reunião.');
  });

  it('quem não tem cadastro gravado segue com o texto de hoje', () => {
    expect(quiz.textoSemHorario(false)).toBe('Sem horários nos próximos dias. Fale com a gente no WhatsApp que a gente encaixa.');
  });

  it('o cadastro "gravado" é o do caminho que a regra manda: arrendamento antes da data não conta', () => {
    const i = html.indexOf('async function montarSlots(){');
    const m = html.slice(i, html.indexOf('\n}\n', i));
    expect(m).toContain('const cadCaminho = regraAgora().caminho;');
    expect(m).toContain('const cadastrado = !!cadCaminho && cadastroVale(cadCaminho);');
    expect(m).toContain('textoSemHorario(cadastrado)');
    // antes da data a regra não devolve caminho: nenhum cadastro conta
    expect(quiz.regraDaAgenda({ porta: 'comercio', ponto: 'definido', relacao: 'inquilino', modelo: 'cedo_espaco' }, ANTES).caminho).toBe('');
  });
});


// ── 22/10/2026: O COMÉRCIO SEM PONTO (NOTA 1) E O CURIOSO NÃO ESCOLHEM HORÁRIO ──────────────
// Antes, a trilha do comércio inteira passava por `p-horario`: quem caía em NOTA 1 escolhia o
// horário, apertava "Confirmar agendamento" e NÃO ganhava reunião (ia para o curso). Agora:
//   NOTA 1 com capital do piso pra cima (investidor pela regra de 12/10) -> mantém o horário e
//     MARCA reunião com a etiqueta 'cotista', como o investidor sem local;
//   NOTA 1 sem capital e o curioso que negocia o local -> o horário nem aparece.
// Este bloco é a atualização DELIBERADA do que era "toda a trilha do comércio vê o horário".
const lpMaisPontuar = new Function(
  fatia('const PESO_PERFIL = {', '// A rota de passagem só faz sentido')
  + fatia('const MODELO_DINHEIRO_NOSSO', 'function onModelo(')
  + fatia('// ══ OS QUATRO CAMINHOS DO QUIZ', '// ══ FIM DOS QUATRO CAMINHOS')
  + '\nreturn { pontuar, destinoSemPonto, valorNoPiso, regraDaAgenda, paraCuriosoDoComercio };',
)() as {
  pontuar: (f: Record<string, string>) => { nota: number };
  destinoSemPonto: (r: { ponto: string; modelo: string; valor: string; nota1: boolean }, agoraMs: number) => string;
  valorNoPiso: (v: string) => boolean;
  regraDaAgenda: (r: Respostas, agoraMs: number) => Decisao;
  paraCuriosoDoComercio: (p: string, m: string, v: string) => boolean;
};

describe('NOTA 1 do comércio: reunião cotista com capital, sem horário sem ele', () => {
  const D = lpMaisPontuar.destinoSemPonto;
  const nota1 = (ponto: string, relacao = '') => lpMaisPontuar.pontuar({ ponto, relacao }).nota === 1;

  it('o piso é UMA função: a do investidor sem local e a do comércio concordam em toda faixa', () => {
    for (const v of opcoes('f-inv-valor')) {
      const cotista = lpMaisPontuar.regraDaAgenda({ porta: 'investidor', capLocal: 'nao', invValor: v.value }, DEPOIS).caminho === 'cotista';
      expect(lpMaisPontuar.valorNoPiso(v.value), v.value).toBe(cotista);
    }
    expect(lpMaisPontuar.valorNoPiso('')).toBe(false);
    expect(html).toContain("if(!r.capLocal || !valorNoPiso(r.invValor)) return nada;");
  });

  it('as faixas do comércio (f-valor) começam em R$ 70 mil: todas passam do piso de R$ 50 mil', () => {
    const faixas = opcoes('f-valor').map(o => o.value);
    expect(faixas.length).toBeGreaterThan(0);
    for (const v of faixas) expect(lpMaisPontuar.valorNoPiso(v), v).toBe(true);
  });

  it('NOTA 1 com capital em qualquer faixa: reunião (e nada antes de 13/10)', () => {
    for (const ponto of ['sem_ideia', 'em_vista'])
      for (const v of opcoes('f-valor')) {
        expect(D({ ponto, modelo: 'meio_a_meio', valor: v.value, nota1: nota1(ponto) }, DEPOIS), `${ponto} ${v.value}`).toBe('reuniao');
        expect(D({ ponto, modelo: 'meio_a_meio', valor: v.value, nota1: nota1(ponto) }, ANTES), `${ponto} ${v.value} antes`).toBe('sem_horario');
      }
    // o local que não é dele também é NOTA 1
    expect(D({ ponto: 'definido', modelo: 'chave_na_mao', valor: '140', nota1: nota1('definido', 'nao_e_meu') }, DEPOIS)).toBe('reuniao');
  });

  it('NOTA 1 sem capital (modelo 01 não pergunta o valor) e abaixo do piso: sem horário', () => {
    for (const ponto of ['sem_ideia', 'em_vista'])
      for (const valor of ['', 'menos_50', 'naosei'])
        expect(D({ ponto, modelo: 'cedo_espaco', valor, nota1: nota1(ponto) }, DEPOIS), `${ponto} "${valor}"`).toBe('sem_horario');
  });

  it('o curioso que negocia o local e quer que a gente invista tudo: sem horário', () => {
    expect(lpMaisPontuar.paraCuriosoDoComercio('negociando', 'cedo_espaco', '')).toBe(true);
    expect(D({ ponto: 'negociando', modelo: 'cedo_espaco', valor: '', nota1: nota1('negociando') }, DEPOIS)).toBe('sem_horario');
    // negociando e pondo dinheiro vai para a agenda como sempre
    expect(D({ ponto: 'negociando', modelo: 'chave_na_mao', valor: '140', nota1: nota1('negociando') }, DEPOIS)).toBe('');
  });

  it('ponto sob controle agenda como sempre, com qualquer modelo e valor', () => {
    for (const relacao of ['proprietario', 'administro', 'represento', 'inquilino'])
      for (const modelo of opcoes('f-modelo').map(o => o.value))
        for (const valor of ['', ...opcoes('f-valor').map(o => o.value)])
          expect(D({ ponto: 'definido', modelo, valor, nota1: nota1('definido', relacao) }, DEPOIS), `${relacao} ${modelo} ${valor}`).toBe('');
  });

  it('nenhuma combinação de respostas termina fora destes três destinos, e reunião só com NOTA 1 + valor do piso', () => {
    let rodadas = 0;
    for (const ponto of ['', ...opcoes('f-ponto').map(o => o.value)])
      for (const relacao of ['', ...opcoes('f-relacao').map(o => o.value)])
        for (const modelo of ['', ...opcoes('f-modelo').map(o => o.value)])
          for (const valor of ['', ...opcoes('f-valor').map(o => o.value), 'menos_50', 'naosei'])
            for (const agora of [ANTES, DEPOIS, NaN]) {
              rodadas++;
              const n1 = nota1(ponto, relacao);
              const d = D({ ponto, modelo, valor, nota1: n1 }, agora);
              const r = JSON.stringify({ ponto, relacao, modelo, valor, agora });
              expect(['', 'reuniao', 'sem_horario'], r).toContain(d);
              if (d === 'reuniao') {
                expect(n1, r).toBe(true);
                expect(lpMaisPontuar.valorNoPiso(valor), r).toBe(true);
                expect(agora >= INICIO, r).toBe(true);
              }
              if (n1 && !lpMaisPontuar.valorNoPiso(valor)) expect(d, r).toBe('sem_horario');
              if (!n1 && !lpMaisPontuar.paraCuriosoDoComercio(ponto, modelo, valor)) expect(d, r).toBe('');
            }
    expect(rodadas).toBeGreaterThan(2000);
  });
});

describe('na página: o horário só existe para quem marca, e o fim de cada um é o certo', () => {
  const corpoDe = (assinatura: string): string => {
    const i = html.indexOf(assinatura);
    if (i < 0) throw new Error(`função sumiu da LP: ${assinatura}`);
    return html.slice(i, html.indexOf('\n}\n', i));
  };
  const ordem = (txt: string, ...trechos: string[]) => {
    let de = -1;
    for (const t of trechos) {
      const i = txt.indexOf(t, de + 1);
      expect(i, `"${t}" fora de ordem ou ausente`).toBeGreaterThan(de);
      de = i;
    }
  };

  it('o passo do horário sai da trilha de quem destinoDoComercio manda sem horário', () => {
    expect(html).toContain("{ id:'p-horario', quando:() => (vaiParaAgenda() && destinoDoComercio() !== 'sem_horario') || !!agendaDoCadastro(),");
    const f = corpoDe('function comercioDecidido(){');
    // enquanto o ponto, o modelo (e o valor, quando o modelo pergunta) não foram respondidos, o passo conta como vivo
    expect(f).toContain("if(!ponto || !modelo) return false;");
    expect(f).toContain("if(ponto === 'definido' && !val('f-relacao')) return false;");
    expect(f).toContain("return MODELO_SEM_CAPITAL.has(modelo) || !!val('f-valor');");
    expect(html).toContain('const destinoDoComercio = () => trilhaComercio() && comercioDecidido()');
  });

  it('sem horário o botão do último passo (WhatsApp) diz "Concluir", e só o passo do horário diz "Confirmar agendamento"', () => {
    const f = corpoDe('function pintarPasso(){');
    expect(f).toContain("fecha === 'agendar'    ? (atual.id === 'p-horario' ? 'Confirmar agendamento →' : 'Concluir →')");
    expect(html.match(/Confirmar agendamento →/g)!.length).toBeGreaterThan(0);
  });

  it('o agendar() chega no NOTA 1, no curioso e no arrendamento ANTES de exigir o horário, e NOTA 1 com capital marca cotista', () => {
    const ag = corpoDe('async function agendar(){');
    // o único `if(!slotSel)` fora do carregador e do caminho novo vem DEPOIS de NOTA 1, curioso e arrendamento
    ordem(ag, 'if(q.nota === 1){', 'gravarNota1DaTela()', "const comReuniao = destinoDoComercio() === 'reuniao';", 'if(comReuniao){',
      "if(!slotSel) return erro('Escolha um horário na lista acima para confirmar.');",
      'const obsN1 = [', 'LP ELETROPOSTO · ${perfilTexto(perfil)}', 'Vagas disponíveis: ${txt(vagas)}', 'Modelo de interesse: ${txt(modelo)}', 'obs: obsN1,',
      "tipo: 'cotista', cartoes: 'cotista'", 'abrirConfirma();', 'irProCurso(',
      'if(paraCuriosoDoComercio(ponto.value, modelo.value, valor.value)){',
      'if(paraArrendamento(ponto.value, relacao.value, modelo.value, valor.value)){',
      "if(!slotSel) return erro('Escolha um horário na lista acima para confirmar.');", 'tipo: regraAgora().tipo');
    // NOTA 1 com capital segue o MESMO portão de presença (e o mesmo /alerta) do investidor sem local
    expect(ag.slice(ag.indexOf('if(comReuniao){'), ag.indexOf('irProCurso('))).toContain("temperatura: 'quente', origem: 'lp_eletroposto'");
  });

  it('o /parceria lado capital da NOTA 1 vai com automatico:true (o aviso é o /alerta da reunião) e só para quem passa do piso', () => {
    const g = corpoDe('async function gravarNota1DaTela(){');
    ordem(g, "fetch('/_api/io/eletroposto/nota1'", 'if(pagaCapital && valorNoPiso(valor.value)){', "fetch('/_api/io/eletroposto/parceria'",
      "lado: 'capital'", "origem: 'lp_nota1', automatico: true,", 'nota1GravadoPara = telE164');
    // ninguém mais grava o cadastro de capital dentro do agendar(): uma porta só, idempotente por telefone
    expect(corpoDe('async function agendar(){')).not.toContain("fetch('/_api/io/eletroposto/parceria'");
    expect(g).toContain("if(nota1GravadoPara === telE164) return true;");
  });

  it('a passagem para o horário grava a ficha e o cadastro ANTES de abrir a lista, sem travar quem demorar', () => {
    const p = corpoDe('function passoProximo(){');
    ordem(p, "vivos[passoAtual + 1].id === 'p-horario' && destinoDoComercio() === 'reuniao'", 'nota1GravadoPara !== telParaBanco()',
      'return gravarNota1EAbrir();', 'passoAtual++; pintarPasso(); return;');
    const a = corpoDe('async function gravarNota1EAbrir(){');
    ordem(a, 'await Promise.race([gravarNota1DaTela(), new Promise(r => setTimeout(r, 6000))]);', "findIndex(p => p.id === 'p-horario')", 'pintarPasso();');
  });

  it('o Enter no último passo faz o que o botão faz, e botão desabilitado não dispara duas vezes', () => {
    const i = html.indexOf("document.getElementById('ag-form').addEventListener('keydown'");
    const k = html.slice(i, html.indexOf('\n});', i));
    ordem(k, "if(b.disabled) return;", "b.dataset.acao !== 'proximo'", 'return passoAcao();', 'passoProximo();');
  });

  it('f-car-local é resposta em botão, e o endereço segue a resposta (onCarLocal repinta)', () => {
    expect(html).toMatch(/const SELECTS_EM_BOTAO = \[[^\]]*'f-car-local'/);
    expect(html).toContain('<select id="f-car-local" onchange="onCarLocal()">');
    expect(corpoDe('function onCarLocal(){')).toContain('pintarPasso()');
  });
});

describe('nome de lead: no mínimo 3 letras, igual às rotas (/agendar, /nota1, /parceria)', () => {
  it('nenhuma validação do nome do lead aceita 2 letras, e o aviso é o do passo do nome', () => {
    expect(html).not.toMatch(/nome\.length\s*<\s*2/);
    expect(html).not.toMatch(/val\('f-nome'\)\.length\s*>=\s*2/);
    expect(html).toContain("ok:() => val('f-nome').length >= 3 ? null : 'Escreva o seu nome completo.' }");
    expect((html.match(/nome\.length < 3\)\s*return erro\('Escreva o seu nome completo\.'\)/g) || []).length).toBe(3);
  });

  it('as três rotas recusam abaixo de 3, que é o que a página agora cobra', () => {
    expect((ROTA.match(/nome\.length < 3\)\s*\{ res\.status\(400\)\.json\(\{ error: 'nome invalido' \}\)/g) || []).length).toBe(3);
  });
});

describe('telefone com +55 ou 0 na frente (preenchimento automático do celular)', () => {
  const NL = String.fromCharCode(10);
  const maskTel = new Function(fatia('function maskTel(i){', '// ViaCEP:') + 'return maskTel;')() as (i: { value: string }) => void;
  const masc = (valor: string) => { const i = { value: valor }; maskTel(i); return i.value; };
  const tela = new Function('campo',
    'const document = { getElementById: () => ({ value: campo.value }) };' + NL
    + fatia('const val = id =>', '/** Só quem tem ponto segue para a agenda')
    + fatia('function telParaBanco(){', NL + '}' + NL) + NL + '}' + NL
    + 'return { telefoneConfere, telParaBanco };',
  ) as (c: { value: string }) => { telefoneConfere: () => boolean; telParaBanco: () => string };

  it('"+55 34 99816-5040" e "034 99816-5040" viram o mesmo número que "34 99816-5040"', () => {
    expect(masc('+55 34 99816-5040')).toBe('(34) 99816-5040');
    expect(masc('+5534998165040')).toBe('(34) 99816-5040');
    expect(masc('034 99816-5040')).toBe('(34) 99816-5040');
    expect(masc('34 99816-5040')).toBe('(34) 99816-5040');
    expect(masc('(34) 99816-5040')).toBe('(34) 99816-5040');
  });

  it('o DDD 55 (Santa Maria) não perde dígito, com ou sem o 55 do país na frente', () => {
    expect(masc('(55) 99999-9999')).toBe('(55) 99999-9999');
    expect(masc('55 99999-9999')).toBe('(55) 99999-9999');
    expect(masc('+55 55 99999-9999')).toBe('(55) 99999-9999');
  });

  it('digitar devagar não quebra: cada passo da máscara continua parcial', () => {
    expect(masc('3')).toBe('3');
    expect(masc('34')).toBe('34');
    expect(masc('349')).toBe('(34) 9');
  });

  it('fixo com +55 (10 dígitos) também fica sem o 55', () => {
    expect(masc('+55 34 3333-4444').replace(/\D/g, '')).toBe('3433334444');
  });

  it('telParaBanco grava 55 + DDD + número UMA vez, mesmo com o campo não mascarado', () => {
    for (const bruto of ['(34) 99816-5040', '+55 34 99816-5040', '034 99816-5040', '5534998165040', '34998165040']) {
      const t = tela({ value: bruto });
      expect(t.telParaBanco(), bruto).toBe('5534998165040');
      expect(t.telefoneConfere(), bruto).toBe(true);
    }
    expect(tela({ value: '(34) 9981' }).telefoneConfere()).toBe(false);
    expect(tela({ value: '' }).telefoneConfere()).toBe(false);
  });
});

describe('a reunião não aparece como vídeo na tela', () => {
  it('nenhum texto da página fala em vídeo, chamada, link da reunião ou online', () => {
    // A VSL do parceiro (22/10/2026) é o vídeo de apresentação da parceria NEXUS, não a
    // reunião: o bloco dela (markup e script), a URL do arquivo e o seletor de CSS
    // do <video> ficam fora da conta. O resto da página continua proibido de falar em vídeo.
    const semComentario = html
      .replace(/<div class="passo" id="p-vsl">[\s\S]*?id="vsl-status"[^\n]*\n\s*<\/div>\n/, '')
      .replace(/\/\/ ══ VSL DO PARCEIRO[\s\S]*?(?=\/\*\* O corpo do cadastro de arrendamento)/, '')
      .split('\n').filter(l => !/^const VSL_PARCEIRO|^\s*\.vslCaixa video/.test(l)).join('\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
      .replace(/<link [^>]*>/g, '');
    expect(semComentario).not.toMatch(/v[ií]deo|chamada|online|sem instalar/i);
    expect(semComentario).not.toMatch(/link d[ao]s? reuni/i);
  });
});
