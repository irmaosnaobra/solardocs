import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// O financeiro por cliente do /gerador: as funcoes puras de
// dashboard/public/gerador/financeiro.js, carregadas num `window` falso. O
// pos-venda.js vai ANTES e no MESMO contexto, porque o financeiro le o campo de
// dinheiro com PosVenda.parseValor.
const DIR = join(__dirname, '../../../dashboard/public/gerador/');

function carregar(extra: Record<string, unknown> = {}): any {
  const w: any = {};
  const ctx = vm.createContext({ window: w, Intl, Date, Math, String, Number, Object, Array, JSON, parseFloat, isFinite, isNaN, RegExp, Error, Promise, ...extra });
  vm.runInContext(readFileSync(join(DIR, 'pos-venda.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(DIR, 'financeiro.js'), 'utf8'), ctx);
  return w.Financeiro;
}
const F = carregar();

let seq = 0;
const L = (tipo: 'entrada' | 'saida', categoria: string, valor_centavos: number, extra: Record<string, unknown> = {}) =>
  ({ id: 'l' + (++seq), tipo, categoria, valor_centavos, data: '2026-10-10', apagado: false, ...extra });
const soma = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

describe('centavosDeTexto', () => {
  it('converte o que a pessoa digita em centavos inteiros', () => {
    expect(F.centavosDeTexto('145.000,00')).toBe(14500000);
    expect(F.centavosDeTexto('0,10')).toBe(10);
    expect(F.centavosDeTexto('1.234,56')).toBe(123456);
    expect(F.centavosDeTexto('R$ 19,99')).toBe(1999);
    expect(F.centavosDeTexto('1,1')).toBe(110);
  });
  it('vazio vira null e texto que nao e numero vira NaN', () => {
    expect(F.centavosDeTexto('')).toBe(null);
    expect(F.centavosDeTexto('   ')).toBe(null);
    expect(F.centavosDeTexto(null)).toBe(null);
    expect(Number.isNaN(F.centavosDeTexto('70 mil'))).toBe(true);
    expect(Number.isNaN(F.centavosDeTexto('-5'))).toBe(true);
    expect(Number.isNaN(F.centavosDeTexto('1.2.3'))).toBe(true);
  });
  it('sai sempre inteiro, mesmo onde o ponto flutuante erra', () => {
    for (const t of ['0,29', '1,15', '4,35', '8,2', '1.005,01', '33,33']) {
      const c = F.centavosDeTexto(t);
      expect(Number.isInteger(c)).toBe(true);
    }
    expect(F.centavosDeTexto('0,29')).toBe(29);
    expect(F.centavosDeTexto('4,35')).toBe(435);
  });
});

describe('fmtCentavos', () => {
  it('formata com milhar e duas casas', () => {
    expect(F.fmtCentavos(123456)).toBe('R$ 1.234,56');
    expect(F.fmtCentavos(0)).toBe('R$ 0,00');
    expect(F.fmtCentavos(5)).toBe('R$ 0,05');
    expect(F.fmtCentavos(10)).toBe('R$ 0,10');
    expect(F.fmtCentavos(14500000)).toBe('R$ 145.000,00');
    expect(F.fmtCentavos(100000000000)).toBe('R$ 1.000.000.000,00');
  });
  it('negativo leva o sinal na frente e null vira vazio', () => {
    expect(F.fmtCentavos(-123456)).toBe('-R$ 1.234,56');
    expect(F.fmtCentavos(-1)).toBe('-R$ 0,01');
    expect(F.fmtCentavos(null)).toBe('');
    expect(F.fmtCentavos(undefined)).toBe('');
    expect(F.fmtCentavos(NaN)).toBe('');
  });
  it('numCentavos e o texto que volta para o campo e e relido igual', () => {
    for (const c of [1, 10, 99, 100, 123456, 14500000, 999999999]) {
      expect(F.centavosDeTexto(F.numCentavos(c))).toBe(c);
    }
  });
});

describe('totais', () => {
  it('10 + 20 centavos da 30', () => {
    const t = F.totais([L('entrada', 'sinal', 10), L('entrada', 'sinal', 20)], null);
    expect(t.recebido).toBe(30);
    expect(t.qtd_entradas).toBe(2);
  });
  it('mil lancamentos de 1 centavo dao 1000', () => {
    const lista = Array.from({ length: 1000 }, () => L('entrada', 'parcela', 1));
    expect(F.totais(lista, null).recebido).toBe(1000);
    const saidas = Array.from({ length: 1000 }, () => L('saida', 'material', 1));
    expect(F.totais(saidas, null).gasto).toBe(1000);
  });
  it('apagado nao conta em nada', () => {
    const t = F.totais([
      L('entrada', 'sinal', 5000), L('entrada', 'sinal', 700, { apagado: true }),
      L('saida', 'material', 1200), L('saida', 'frete', 300, { apagado: true }),
    ], 10000);
    expect(t.recebido).toBe(5000);
    expect(t.gasto).toBe(1200);
    expect(t.qtd_entradas).toBe(1);
    expect(t.qtd_saidas).toBe(1);
    expect(t.por_categoria.saida.frete).toBeUndefined();
    expect(t.a_receber).toBe(5000);
  });
  it('sem valor da venda: a receber, previsto e margem ficam null', () => {
    const t = F.totais([L('entrada', 'sinal', 5000), L('saida', 'material', 1200)], null);
    expect(t.recebido).toBe(5000);
    expect(t.gasto).toBe(1200);
    expect(t.resultado_caixa).toBe(3800);
    expect(t.a_receber).toBe(null);
    expect(t.resultado_previsto).toBe(null);
    expect(t.margem_prevista).toBe(null);
    expect(t.recebido_a_mais).toBe(0);
    expect(F.totais([], undefined).a_receber).toBe(null);
  });
  it('com valor da venda: a receber, previsto e margem com 1 casa', () => {
    const t = F.totais([L('entrada', 'sinal', 5000000), L('saida', 'material', 3333333)], 14500000);
    expect(t.a_receber).toBe(9500000);
    expect(t.recebido_a_mais).toBe(0);
    expect(t.resultado_caixa).toBe(1666667);
    expect(t.resultado_previsto).toBe(11166667);
    expect(t.margem_prevista).toBe(77);
    expect(F.totais([L('saida', 'material', 1000)], 3000).margem_prevista).toBe(66.7);
  });
  it('resultado negativo sai negativo', () => {
    const t = F.totais([L('entrada', 'sinal', 1000), L('saida', 'material', 4000)], 3000);
    expect(t.resultado_caixa).toBe(-3000);
    expect(t.resultado_previsto).toBe(-1000);
    expect(t.margem_prevista).toBe(-33.3);
  });
  it('recebido maior que a venda: a receber 0 e o excesso em recebido_a_mais', () => {
    const t = F.totais([L('entrada', 'sinal', 9000), L('entrada', 'parcela', 2500)], 10000);
    expect(t.recebido).toBe(11500);
    expect(t.a_receber).toBe(0);
    expect(t.recebido_a_mais).toBe(1500);
  });
  it('a soma de por_categoria fecha com recebido e com gasto', () => {
    const lista = [
      L('entrada', 'sinal', 1234), L('entrada', 'parcela', 10), L('entrada', 'parcela', 20), L('entrada', 'outros', 999999),
      L('saida', 'material', 4321), L('saida', 'frete', 1), L('saida', 'material', 99), L('saida', 'outros', 5, { apagado: true }),
    ];
    const t = F.totais(lista, 2000000);
    expect(soma(t.por_categoria.entrada)).toBe(t.recebido);
    expect(soma(t.por_categoria.saida)).toBe(t.gasto);
    expect(F.somaMapa(t.por_categoria.entrada)).toBe(t.recebido);
    expect(t.por_categoria.entrada.parcela).toBe(30);
    expect(t.por_categoria.saida.material).toBe(4420);
  });
  it('lista vazia ou ausente da tudo zero', () => {
    const t = F.totais(undefined, 1000);
    expect(t.recebido).toBe(0);
    expect(t.gasto).toBe(0);
    expect(t.a_receber).toBe(1000);
  });
});

describe('confere', () => {
  const lista = [L('entrada', 'sinal', 5000), L('entrada', 'parcela', 2500), L('saida', 'material', 1200), L('saida', 'frete', 77, { apagado: true })];
  const servidor = F.totais(lista, 10000);

  it('bate quando a lista mostrada e a mesma do servidor', () => {
    expect(F.confere(JSON.parse(JSON.stringify(servidor)), lista, 10000)).toBe(true);
    expect(F.diferencas(servidor, lista, 10000)).toEqual([]);
  });
  it('nao bate quando um lancamento some da lista', () => {
    const faltando = lista.slice(1);
    expect(F.confere(servidor, faltando, 10000)).toBe(false);
    expect(F.diferencas(servidor, faltando, 10000)).toContain('recebido');
    expect(F.confere(servidor, lista.filter(l => l.tipo !== 'saida'), 10000)).toBe(false);
  });
  it('nao bate quando o valor da venda e outro', () => {
    expect(F.confere(servidor, lista, 20000)).toBe(false);
  });
  it('ignora campo null de quem nao e socio', () => {
    const soEntradas = lista.filter(l => l.tipo === 'entrada');
    const visto = { ...F.totais(soEntradas, 10000), gasto: null, resultado_caixa: null, resultado_previsto: null, margem_prevista: null, qtd_saidas: null };
    visto.por_categoria = { entrada: visto.por_categoria.entrada, saida: null };
    expect(F.confere(visto, soEntradas, 10000)).toBe(true);
    // mesmo que o servidor mande a contagem real de saidas, a lista de quem nao e socio nao as tem
    expect(F.confere({ ...visto, qtd_saidas: 3 }, soEntradas, 10000)).toBe(true);
    // e continua acusando entrada que sumiu
    expect(F.confere(visto, soEntradas.slice(1), 10000)).toBe(false);
  });
  it('categoria que o servidor manda zerada nao e diferenca', () => {
    const t = JSON.parse(JSON.stringify(servidor));
    t.por_categoria.entrada.outros = 0;
    t.por_categoria.saida.frete = 0;
    expect(F.confere(t, lista, 10000)).toBe(true);
    t.por_categoria.entrada.outros = 1;
    expect(F.confere(t, lista, 10000)).toBe(false);
  });
  it('sem totais nao confere', () => {
    expect(F.confere(null, lista, 10000)).toBe(false);
  });
});

describe('rotulos e duplicado', () => {
  const CAT = {
    entrada: [{ slug: 'sinal', rotulo: 'Sinal' }, { slug: 'outros', rotulo: 'Outros' }],
    saida: [{ slug: 'material', rotulo: 'Material' }],
    formas: [{ slug: 'pix', rotulo: 'Pix' }],
  };
  it('rotulo e rotuloForma caem no slug quando o catalogo nao tem', () => {
    expect(F.rotulo(CAT, 'entrada', 'sinal')).toBe('Sinal');
    expect(F.rotulo(CAT, 'saida', 'material')).toBe('Material');
    expect(F.rotulo(CAT, 'saida', 'nao_existe')).toBe('nao_existe');
    expect(F.rotulo(null, 'entrada', 'sinal')).toBe('sinal');
    expect(F.rotuloForma(CAT, 'pix')).toBe('Pix');
    expect(F.rotuloForma(CAT, 'boleto')).toBe('boleto');
    expect(F.rotuloForma(CAT, '')).toBe('');
  });
  it('textoDuplicado diz o tipo, o valor, a data e o motivo', () => {
    expect(F.textoDuplicado({ id: 'x', tipo: 'entrada', valor_centavos: 123456, data: '2026-10-09', categoria: 'sinal', motivo: 'mesmo_valor_e_data' }))
      .toBe('Entrada de R$ 1.234,56 em 09/10/2026 (mesmo valor e mesma data)');
    expect(F.textoDuplicado({ tipo: 'saida', valor_centavos: 500, data: '2026-01-02', motivo: 'mesmo_arquivo' }))
      .toBe('Saída de R$ 5,00 em 02/01/2026 (mesmo arquivo)');
    expect(F.textoDuplicado({ tipo: 'entrada', valor_centavos: 500, data: '2026-01-02', motivo: 'mesma_transacao' }))
      .toBe('Entrada de R$ 5,00 em 02/01/2026 (mesmo código de transação)');
    expect(F.textoDuplicado(null)).toBe('');
  });
});

describe('mensagemErro', () => {
  const m = (codigo: string, status = 400) => F.mensagemErro({ codigo, status });
  it('traduz cada codigo da rota', () => {
    expect(m('valor_invalido')).toBe('Esse valor não foi aceito. Confira o número.');
    expect(m('data_invalida')).toBe('Essa data não foi aceita. Escolha outra.');
    expect(m('descricao_obrigatoria')).toBe('Em Outros, escreva do que se trata.');
    expect(m('categoria_invalida')).toBe('Escolha a categoria.');
    expect(m('so_socio', 403)).toBe('Só sócio lança ou vê saída.');
    expect(m('arquivo_grande')).toBe('Esse arquivo passa de 3 MB. Envie um print ou um PDF menor.');
    expect(m('heic_nao_suportado')).toBe('Esse formato de foto do iPhone não é aceito. Envie como JPG, PNG ou PDF.');
    expect(m('tipo_nao_aceito')).toBe('Só imagem ou PDF.');
    expect(m('arquivo_invalido')).toBe('Não consegui abrir esse arquivo. Tente outro.');
    expect(m('motivo_obrigatorio')).toBe('Escreva o motivo para apagar.');
  });
  it('traduz pelo status quando nao ha codigo conhecido', () => {
    expect(F.mensagemErro({ status: 401, codigo: '' })).toBe('Sua sessão venceu. Entre de novo para usar o financeiro.');
    expect(F.mensagemErro({ status: 403, codigo: '' })).toBe('Esta conta não tem acesso ao financeiro.');
    expect(F.mensagemErro({ status: 429, codigo: '' })).toBe('Muitas leituras seguidas. Espere um minuto.');
  });
  it('qualquer outro caso tem a mensagem padrao', () => {
    const padrao = 'Não deu para falar com o financeiro. Tente de novo.';
    expect(F.mensagemErro({ status: 500, codigo: '' })).toBe(padrao);
    expect(F.mensagemErro({ status: 400, codigo: 'codigo_que_nao_existe' })).toBe(padrao);
    expect(F.mensagemErro({ status: 0, codigo: '' })).toBe(padrao);
    expect(F.mensagemErro(null)).toBe(padrao);
    expect(F.mensagemErro({ status: 400, codigo: 'toString' })).toBe(padrao);
  });
  it('nenhuma mensagem tem travessao', () => {
    const codigos = ['valor_invalido', 'data_invalida', 'descricao_obrigatoria', 'categoria_invalida', 'so_socio', 'arquivo_grande', 'heic_nao_suportado', 'tipo_nao_aceito', 'arquivo_invalido', 'motivo_obrigatorio', ''];
    for (const c of codigos) for (const s of [400, 401, 403, 429, 500]) expect(F.mensagemErro({ codigo: c, status: s })).not.toMatch(/[—–]/);
  });
});

describe('arquivo', () => {
  it('aceita imagem e PDF e recusa o resto com o codigo do servidor', () => {
    expect(F.checarArquivo({ type: 'image/png', name: 'print.png', size: 1000 })).toBe(null);
    expect(F.checarArquivo({ type: 'image/jpeg', name: 'a.jpg', size: 1000 })).toBe(null);
    expect(F.checarArquivo({ type: 'image/webp', name: 'a.webp', size: 1000 })).toBe(null);
    expect(F.checarArquivo({ type: 'application/pdf', name: 'a.pdf', size: 1000 })).toBe(null);
    expect(F.checarArquivo({ type: 'text/plain', name: 'a.txt', size: 10 })).toBe('tipo_nao_aceito');
    expect(F.checarArquivo({ type: 'image/gif', name: 'a.gif', size: 10 })).toBe('tipo_nao_aceito');
  });
  it('HEIC e recusado pelo tipo ou pela extensao (o tipo costuma vir vazio)', () => {
    expect(F.checarArquivo({ type: 'image/heic', name: 'IMG_1.HEIC', size: 10 })).toBe('heic_nao_suportado');
    expect(F.checarArquivo({ type: '', name: 'IMG_1.heic', size: 10 })).toBe('heic_nao_suportado');
    expect(F.checarArquivo({ type: '', name: 'IMG_1.HEIF', size: 10 })).toBe('heic_nao_suportado');
  });
  it('acima de 3 MB e recusado, a nao ser que so se confira o tipo', () => {
    const grande = { type: 'application/pdf', name: 'a.pdf', size: 3 * 1024 * 1024 + 1 };
    expect(F.checarArquivo(grande)).toBe('arquivo_grande');
    expect(F.checarArquivo(grande, true)).toBe(null);
    expect(F.checarArquivo({ type: 'application/pdf', name: 'a.pdf', size: 3 * 1024 * 1024 })).toBe(null);
  });
  it('sem tipo, vale a extensao', () => {
    expect(F.tipoDoArquivo({ type: '', name: 'comprovante.PDF' })).toBe('application/pdf');
    expect(F.tipoDoArquivo({ type: '', name: 'foto.jpeg' })).toBe('image/jpeg');
    expect(F.tipoDoArquivo({ type: 'image/jpg', name: 'x' })).toBe('image/jpeg');
    expect(F.tipoDoArquivo({ type: '', name: 'semextensao' })).toBe('');
  });
});

describe('uuid', () => {
  it('gera um v4 mesmo sem crypto.randomUUID', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const a = F.uuid(), b = F.uuid();
    expect(a).toMatch(re);
    expect(b).toMatch(re);
    expect(a).not.toBe(b);
    const comCrypto = carregar({ crypto: { randomUUID: () => 'fixo-do-navegador' } });
    expect(comCrypto.uuid()).toBe('fixo-do-navegador');
  });
});

describe('rede', () => {
  const resp = (status: number, corpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  it('manda o token e o corpo em centavos, e devolve o que a rota respondeu', async () => {
    const vistos: any[] = [];
    const Fx = carregar({ fetch: async (url: string, o: any) => { vistos.push({ url, o }); return resp(200, { ok: true, lancamento: { id: 'a' }, totais: {} }); } });
    const r = await Fx.gravar('http://api', 'TOK', 301, { id: 'a', valor_centavos: 123456 });
    expect(r.lancamento.id).toBe('a');
    expect(vistos[0].url).toBe('http://api/gerador/financeiro/301/lancamento');
    expect(vistos[0].o.method).toBe('POST');
    expect(vistos[0].o.headers.Authorization).toBe('Bearer TOK');
    expect(JSON.parse(vistos[0].o.body).valor_centavos).toBe(123456);
    await Fx.apagar('http://api', 'TOK', 301, 'abc', 'lancado errado');
    expect(vistos[1].url).toBe('http://api/gerador/financeiro/301/lancamento/abc/apagar');
    expect(JSON.parse(vistos[1].o.body)).toEqual({ motivo: 'lancado errado' });
    await Fx.subir('http://api', 'TOK', 301, { base64: 'QUJD', media_type: 'image/png', nome: 'p.png', ler: true });
    expect(vistos[2].url).toBe('http://api/gerador/financeiro/301/arquivo');
    expect(JSON.parse(vistos[2].o.body)).toEqual({ base64: 'QUJD', media_type: 'image/png', nome: 'p.png', ler: true });
    await Fx.ler('http://api', 'TOK', 301);
    expect(vistos[3].url).toBe('http://api/gerador/financeiro/301');
    expect(vistos[3].o.method).toBe('GET');
    expect(vistos[3].o.body).toBeUndefined();
  });
  it('409 vira erro com os duplicados; 400 leva o codigo; rede fora vira status 0', async () => {
    const dup = [{ id: 'z', tipo: 'entrada', valor_centavos: 10, data: '2026-10-10', categoria: 'sinal', motivo: 'mesmo_valor_e_data' }];
    const F409 = carregar({ fetch: async () => resp(409, { error: 'possivel_duplicado', duplicados: dup }) });
    await expect(F409.gravar('b', 't', 1, {})).rejects.toMatchObject({ status: 409, codigo: 'possivel_duplicado', duplicados: dup });
    const F400 = carregar({ fetch: async () => resp(400, { error: 'valor_invalido' }) });
    await expect(F400.gravar('b', 't', 1, {})).rejects.toMatchObject({ status: 400, codigo: 'valor_invalido' });
    const F401 = carregar({ fetch: async () => resp(401, { precisa: 'login' }) });
    await expect(F401.ler('b', 't', 1)).rejects.toMatchObject({ status: 401, codigo: '' });
    const Fora = carregar({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(Fora.ler('b', 't', 1)).rejects.toMatchObject({ status: 0 });
    const Html = carregar({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('nao e json'); } }) });
    await expect(Html.ler('b', 't', 1)).rejects.toMatchObject({ status: 200 });
  });
  it('resumo junta os lotes de 400 ids', async () => {
    const urls: string[] = [];
    const Fx = carregar({ fetch: async (url: string) => {
      urls.push(url);
      const ids = url.split('ids=')[1].split(',');
      const resumo: any = {};
      ids.forEach((i) => { resumo[i] = { recebido: Number(i), gasto: null, qtd: 1 }; });
      return resp(200, { ok: true, socio: false, resumo });
    } });
    const ids = Array.from({ length: 950 }, (_, i) => i + 1);
    const r = await Fx.resumo('http://api', 'TOK', ids);
    expect(urls.length).toBe(3);
    expect(Object.keys(r.resumo).length).toBe(950);
    expect(r.resumo['950'].recebido).toBe(950);
    expect(r.socio).toBe(false);
    const vazio = await Fx.resumo('http://api', 'TOK', []);
    expect(vazio.resumo).toEqual({});
    expect(urls.length).toBe(3);
  });
});
