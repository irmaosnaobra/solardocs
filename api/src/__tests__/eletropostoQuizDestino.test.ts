import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// O QUIZ DA LP E AS ABAS DO /gerador TÊM QUE SER OS MESMOS QUATRO CAMINHOS.
//
// Desde 21/09/2026 ninguém sai do quiz da LP do eletroposto: cada pessoa termina
// numa das listas da aba Cadastros (Arrendamento, Investidores, Curioso, Parceiros).
// Quem escolhe a lista é a regra do servidor (destinoDe); o quiz só monta o que é
// gravado. Este teste LÊ o JavaScript e as opções da própria LP, monta o corpo que
// o quiz gravaria para cada combinação de respostas e passa pela regra. Se alguém
// encurtar um rótulo ("Sou o proprietário" vira "Dono") ou trocar um valor, a
// pessoa cairia na lista errada em silêncio, e é aqui que isso aparece.
import { destinoDe, podeCeder } from '../services/io/eletropostoPares';

const LP = join(__dirname, '../../../dashboard/public/io/eletroposto/index.html');
const html = readFileSync(LP, 'utf8');

const fatia = (de: string, ate: string): string => {
  const i = html.indexOf(de);
  const j = html.indexOf(ate, i);
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu da LP: "${de}" … "${ate}"`);
  return html.slice(i, j);
};

type Fn = (...a: any[]) => any;
const quiz = new Function(
  fatia('const MODELO_DINHEIRO_NOSSO', 'function onModelo(')
  + fatia('// ══ OS QUATRO CAMINHOS DO QUIZ', '// ══ FIM DOS QUATRO CAMINHOS')
  + '\nreturn { paraArrendamento, paraCuriosoDoComercio, corpoDoInvestidor, corpoDoArrendamento, corpoDoCurioso, VALOR_CURIOSO };',
)() as Record<string, Fn> & { VALOR_CURIOSO: Set<string> };

/** As opções de um <select> da LP, na ordem da tela, sem o "Selecione". */
function opcoes(id: string): Array<{ value: string; texto: string }> {
  const m = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  if (!m) throw new Error(`select sumiu da LP: ${id}`);
  return [...m[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
    .map(o => ({ value: o[1], texto: o[2].trim() }))
    .filter(o => o.value);
}

const PESSOA = { nome: 'Maria Teste', telefone: '5534999990001', cidade: 'Uberlândia, MG' };
const ficha = (corpo: any) => ({ ficha: corpo.ficha, valor_investir: corpo.valor_investir });

describe('investidor sem local: o valor decide Investidores ou Curioso', () => {
  const valores = opcoes('f-inv-valor');
  const locais = opcoes('f-cap-local').filter(o => o.value !== 'meu');

  it('a pergunta existe e tem opção pra cair no Curioso', () => {
    expect(valores.length).toBeGreaterThan(3);
    expect(valores.some(v => quiz.VALOR_CURIOSO.has(v.value))).toBe(true);
    expect(locais.map(l => l.value).sort()).toEqual(['em_vista', 'nao']);
  });

  for (const local of opcoes('f-cap-local').filter(o => o.value !== 'meu')) {
    for (const v of opcoes('f-inv-valor')) {
      it(`${local.value} + "${v.texto}"`, () => {
        const r = quiz.corpoDoInvestidor({ ...PESSOA, local: local.texto, valor: v.texto, valorCodigo: v.value });
        if (quiz.VALOR_CURIOSO.has(v.value)) {
          // Curioso vai SÓ pra ficha: como investidor ele receberia pauta de Investidores.
          expect(r.rota).toBe('nota1');
          expect(destinoDe('nota1', ficha(r.corpo))).toBe('curioso');
        } else {
          expect(r.rota).toBe('parceria');
          expect(r.corpo.lado).toBe('capital');
          expect(destinoDe('parceria', r.corpo)).toBe('capital');
        }
      });
    }
  }

  it('só "Menos de R$ 50 mil" e "Ainda não sei" são Curioso; o resto é do piso pra cima', () => {
    const curiosos = opcoes('f-inv-valor').filter(v => quiz.VALOR_CURIOSO.has(v.value)).map(v => v.texto);
    expect(curiosos.sort()).toEqual(['Ainda não sei', 'Menos de R$ 50 mil']);
  });
});

describe('dono de comércio: quem pode ceder é Arrendamento, quem negocia é Curioso', () => {
  const relacoes = opcoes('f-relacao');
  const texto = (v: string) => relacoes.find(r => r.value === v)!.texto;

  it('as opções de "O local é seu?" que cedem o local são as que a regra reconhece', () => {
    const cedem = relacoes.filter(r => podeCeder(r.texto)).map(r => r.value).sort();
    expect(cedem).toEqual(['administro', 'inquilino', 'proprietario', 'represento']);
  });

  for (const v of ['administro', 'represento', 'inquilino']) {
    it(`definido + ${v} + modelo 01 vira Arrendamento, e a aba concorda`, () => {
      expect(quiz.paraArrendamento('definido', v, 'cedo_espaco', '')).toBe(true);
      const corpo = quiz.corpoDoArrendamento({
        ...PESSOA, relacao: texto(v), perfil: 'Estacionamento', endereco: 'Rua A, 10 · Centro',
        vagas: '3 a 5', fluxo: '', modelo: '01 · Cedo o espaço e vocês investem 100%',
      });
      expect(destinoDe('parceria', corpo)).toBe('ponto');
    });
  }

  it('o proprietário não vai pro arrendamento do quiz: ele tem reunião', () => {
    expect(quiz.paraArrendamento('definido', 'proprietario', 'cedo_espaco', '')).toBe(false);
  });

  it('negociando + modelo 01 vira Curioso (não pode ceder e não põe dinheiro), e a aba concorda', () => {
    expect(quiz.paraArrendamento('negociando', '', 'cedo_espaco', '')).toBe(false);
    expect(quiz.paraCuriosoDoComercio('negociando', 'cedo_espaco', '')).toBe(true);
    const corpo = quiz.corpoDoCurioso({
      ...PESSOA, perfil: 'Estacionamento', ponto: 'Tenho um local em negociação com o proprietário',
      endereco: 'Rua A, 10 · Centro', linhas: [
        'Modelo de interesse: 01 · Cedo o espaço e vocês investem 100%',
        'Ponto: Tenho um local em negociação com o proprietário',
        'Endereço em negociação: Rua A, 10 · Centro',
      ],
    });
    expect(destinoDe('nota1', ficha(corpo))).toBe('curioso');
  });

  it('quem põe dinheiro (modelo 02 ou 03) não cai em nenhum dos dois: vai pra reunião', () => {
    for (const m of ['meio_a_meio', 'chave_na_mao', 'nao_sei']) {
      expect(quiz.paraArrendamento('definido', 'inquilino', m, '')).toBe(false);
      expect(quiz.paraCuriosoDoComercio('negociando', m, '')).toBe(false);
    }
  });
});

describe('a LP não manda mais ninguém embora', () => {
  it('não existe mais o desvio para /io/eletroposto/parceria no quiz', () => {
    expect(html).not.toMatch(/irParaCadastro/);
    expect(html).not.toMatch(/parceria\/\?'\s*\+/);
  });
  it('as quatro telas de fim existem na página', () => {
    for (const id of ['ag-ok-arrend', 'ag-ok-inv', 'ag-ok-cur', 'ag-ok-int']) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
