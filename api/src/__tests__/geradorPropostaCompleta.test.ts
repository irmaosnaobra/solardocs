import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromTemplate } from '../services/templateService';
import {
  CARGO_ASSINANTE, empresaParaTemplate, marcaDoModulo, montarCamposOrcamento, orcamentoOficialDisponivel, separarCidadeUf, separarInversor,
  fotosDeObraDoOrcamento, tipoDoDocumento, MAX_OBRAS_GALERIA,
} from '../services/geradorPropostaCompleta';
import { FOTOS_OBRA_IO } from '../services/templates/fotosObraIo';

// O orçamento do /gerador no papel do modelo 4. Os números mandam: o que o /gerador e o WhatsApp dizem ao cliente é o que o
// papel imprime. Dados inventados, no formato do `dados` que o /gerador grava (kit de tabela, SAJ 6K, cartão 18x e 21x).

const empresaRow = {
  nome: 'Empresa Exemplo Solar LTDA', nome_fantasia: 'Exemplo Energia', cnpj: '12.345.678/0001-90',
  endereco: 'Rua A, 10, Centro', socio_adm: 'Maria Souza', cor_marca: '#14235B', cor_secundaria: '#F7B500',
  whatsapp: '34999990000', cidade: 'Uberlândia MG', dados_bancarios: { banco: 'NAO-DEVE-SAIR' }, email: 'x@y.com',
};

const dadosBase = (): Record<string, unknown> => ({
  nome: 'Cliente Teste', telefone: '(34) 99999-0000', cidade: 'Uberlândia, MG', telhado: 'Fibrocimento',
  item: { n: 14, g: 1050, kwp: 8.4, invs: 1 }, tab: { inv: 'SAJ 6K', mod: 'TCL 600W', pot: 600 }, qtdInv: 1, garInv: '10',
  tarifa: 1.09, taxaMin: 95, inflTarifa: 0.06, inflTaxaMin: 0.06, consumoKwh: 1050, mediaMensalGerada: 1050,
  garPaineis: '25', garEstrutura: '10', garInstalacao: '1', prazoInstalacao: '30',
  precoVista: 21497, precoOrcamento: 21497,
  parcelasCartao: { 18: 25040.7, 21: 25643.1 }, fin36x: 949.9032916315784, fin48x: 796.027909032868, fin60x: 707.730688758823,
  pagOpts: {
    vista: false, cartao: { ativo: true, parcelas: [18, 21] }, fin: { ativo: false, p36: false, p48: false, p60: false },
    entrada: { ativo: false, valor: '', modo: 'dias', dias: '30' }, custom: '',
  },
  consultor: 'Nilce', consultorWhats: '5534991516846',
  validadeModo: 'sexta', validadeDias: 4, expiraEmISO: '2026-11-13T21:00:00.000Z',
  dataEmissao: '2026-11-10T12:20:50.235Z', bateria: null, controlador: null, fotoTelhado: '',
});

const CPF_TESTE = '529.982.247-25';
const CNPJ_TESTE = '11.222.333/0001-81';
const monta = (d: Record<string, unknown> = dadosBase(), assinar?: { nome: string; documento: string }) =>
  montarCamposOrcamento(d, { codigo: '202600951', criadaEm: '2026-11-10T12:20:51.000Z', empresa: empresaParaTemplate(empresaRow), assinar });
const html = (d?: Record<string, unknown>, assinar?: { nome: string; documento: string }) => {
  const { fields, client, company } = monta(d, assinar);
  return generateFromTemplate('propostaSolar', company as never, client as never, fields, 4);
};
const texto = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ');

describe('leitores pequenos', () => {
  it('cidade e UF', () => {
    expect(separarCidadeUf('Uberlândia, MG')).toEqual({ cidade: 'Uberlândia', uf: 'MG' });
    expect(separarCidadeUf('Uberlândia-MG')).toEqual({ cidade: 'Uberlândia', uf: 'MG' });
    expect(separarCidadeUf('São José do Rio Preto SP')).toEqual({ cidade: 'São José do Rio Preto', uf: 'SP' });
    expect(separarCidadeUf('Araguari')).toEqual({ cidade: 'Araguari', uf: '' });
  });
  it('inversor: marca e potência em kW', () => {
    expect(separarInversor('SAJ 6K')).toEqual({ marca: 'SAJ', potencia: '6' });
    expect(separarInversor('Deye 2,25K')).toEqual({ marca: 'Deye', potencia: '2,25' });
    expect(separarInversor('Micro Holmilles 2,0KW')).toEqual({ marca: 'Micro Holmilles', potencia: '2,0' });
    expect(separarInversor('micro Saj')).toEqual({ marca: 'micro Saj', potencia: '' });
  });
  it('módulo: marca sem a potência', () => {
    expect(marcaDoModulo('TCL 600W')).toBe('TCL');
    expect(marcaDoModulo('Era 620W')).toBe('Era');
    expect(marcaDoModulo('TCU')).toBe('TCU');
  });
  it('a empresa não leva dados bancários nem e-mail', () => {
    const e = empresaParaTemplate(empresaRow) as unknown as Record<string, unknown>;
    expect(e.dados_bancarios).toBeUndefined();
    expect(e.email).toBeUndefined();
    expect(e.cnpj).toBe('12.345.678/0001-90');
  });
});

describe('mapeador: números do /gerador -> campos do modelo 4', () => {
  it('preço, consumo, tarifa, taxa mínima, inflações e geração', () => {
    const { fields: f } = monta();
    expect(f.investimento).toBe('21497,00');
    expect(f.preco_avista).toBe('21497,00');
    expect(f.consumo_kwh).toBe('1050,00');
    expect(f.tarifa_kwh).toBe('1,09');
    expect(f.taxa_minima).toBe('95,00');
    expect(f.inflacao_aa).toBe('6');
    expect(f.taxa_minima_inflacao_aa).toBe('6');
    expect(f.geracao_media_kwh).toBe('1050,00');
    expect(f.cidade).toBe('Uberlândia');
    expect(f.uf).toBe('MG');
    expect(f.tipo_telhado).toBe('Fibrocimento');
    expect(f.codigo).toBe('202600951');
    expect(f.emitido_em).toBe('2026-11-10T12:20:51.000Z');
  });

  it('preço com centavos vai com vírgula (o ponto viraria milhar no parseBRL)', () => {
    const d = dadosBase();
    d.precoOrcamento = 21497.5;
    expect(monta(d).fields.investimento).toBe('21497,50');
  });

  it('sem consumo informado, o consumo é a geração (a mesma conta que o /gerador faz)', () => {
    const d = dadosBase();
    d.consumoKwh = null;
    expect(monta(d).fields.consumo_kwh).toBe('1050,00');
  });

  it('módulos e inversores', () => {
    const { fields: f } = monta();
    expect(f.qtd_modulos).toBe('14');
    expect(f.potencia_modulo).toBe('600');
    expect(f.marca_modulo).toBe('TCL');
    expect(f.inversores).toEqual([{ qtd: '1', marca: 'SAJ', potencia: '6', garantia: '10' }]);
    expect(f.garantia_paineis).toBe('25');
    expect(f.garantia_estrutura).toBe('10');
    expect(f.garantia_instalacao).toBe('1');
    expect(f.prazo_instalacao_dias).toBe('30');
  });

  it('3 inversores: a quantidade e a garantia do /gerador', () => {
    const d = dadosBase();
    d.tab = { inv: 'Deye 2,25K', mod: 'TCL 600W', pot: 600 };
    d.qtdInv = 3; d.garInv = '15';
    expect(monta(d).fields.inversores).toEqual([{ qtd: '3', marca: 'Deye', potencia: '2,25', garantia: '15' }]);
  });

  it('cartão: só as parcelas marcadas, com o valor pronto arredondado como o /gerador imprime', () => {
    const { fields: f } = monta();
    expect(f.pag_cartao).toBe(true);
    expect(f.pag_cartao_18).toBe(true);
    expect(f.pag_cartao_21).toBe(true);
    expect(f.pag_cartao_10).toBeUndefined();
    expect(f.parcelas_cartao_prontas).toEqual({ 18: 25041, 21: 25643 });
    expect(f.pag_fin).toBe(false);
    expect(f.parcelas_fin_prontas).toEqual({});
    expect(f.pag_vista).toBe(false);
  });

  it('financiamento: fin36x, fin48x e fin60x do /gerador, na carência de 4 meses', () => {
    const d = dadosBase();
    (d.pagOpts as Record<string, unknown>).fin = { ativo: true, p36: true, p48: false, p60: true };
    const { fields: f } = monta(d);
    expect(f.pag_fin).toBe(true);
    expect(f.pag_fin_36).toBe(true);
    expect(f.pag_fin_48).toBeUndefined();
    expect(f.pag_fin_60).toBe(true);
    expect(f.parcelas_fin_prontas).toEqual({ 36: 950, 60: 708 });
  });

  it('proposta antiga sem parcelas gravadas: calcula pela tabela do /gerador e pelo Price com carência', () => {
    const d = dadosBase();
    delete d.parcelasCartao; delete d.fin36x; delete d.fin48x; delete d.fin60x;
    (d.pagOpts as Record<string, unknown>).cartao = { ativo: true, parcelas: [21] };
    (d.pagOpts as Record<string, unknown>).fin = { ativo: true, p36: true, p48: false, p60: false };
    const { fields: f } = monta(d);
    expect(f.parcelas_cartao_prontas).toEqual({ 21: Math.round((21497 * 1.1928) / 21) });
    expect((f.parcelas_fin_prontas as Record<string, number>)[36]).toBe(950);
  });

  it('pagOpts no formato antigo (p10, p12, p18) e sem pagOpts', () => {
    const d = dadosBase();
    d.pagOpts = { vista: true, cartao: { ativo: true, p10: true, p12: false, p18: true }, fin: { ativo: false } };
    d.parc10x = 2403.15; d.parc18x = 1391.21; delete d.parcelasCartao;
    expect(monta(d).fields.parcelas_cartao_prontas).toEqual({ 10: 2403, 18: 1391 });
    delete d.pagOpts;
    const { fields: f } = monta(d);
    expect(f.pag_cartao_10).toBe(true);
    expect(f.pag_cartao_12).toBe(true);
    expect(f.pag_cartao_18).toBe(true);
    expect(f.pag_fin_48).toBe(true);
    expect(f.pag_fin_60).toBe(true);
  });

  it('entrada e condição especial', () => {
    const d = dadosBase();
    (d.pagOpts as Record<string, unknown>).entrada = { ativo: true, valor: '5000', modo: 'montagem', dias: '30' };
    (d.pagOpts as Record<string, unknown>).custom = ' Troco por um carro ';
    const { fields: f } = monta(d);
    expect(f.pag_entrada).toBe(true);
    expect(f.entrada_valor).toBe('5000,00');
    expect(f.entrada_modo).toBe('montagem');
    expect(f.pag_custom).toBe('Troco por um carro');
  });

  it('validade: a data exata de expiraEmISO; no modo por dias, os dias corridos', () => {
    expect(monta().fields.validade_ate_iso).toBe('2026-11-13T21:00:00.000Z');
    const d = dadosBase();
    d.validadeModo = 'dias'; d.validadeDias = 3; d.expiraEmISO = null;
    const { fields: f } = monta(d);
    expect(f.validade_dias).toBe('3');
    expect('validade_ate_iso' in f).toBe(false);
  });

  it('vendedor, CNPJ visível, Fio B e dados bancários desligados, 12 bancos (bancos_logos ausente)', () => {
    const { fields: f } = monta();
    expect(f.vendedor_nome).toBe('Nilce');
    expect(f.vendedor_whatsapp).toBe('5534991516846');
    expect(f.mostrar_vendedor_nome).toBe(true);
    expect(f.mostrar_vendedor_contato).toBe(true);
    expect(f.mostrar_cnpj).toBe(true);
    expect(f.empresa_cnpj).toBe('12.345.678/0001-90');
    expect(f.fio_b_mostrar).toBeUndefined();
    expect(f.mostrar_dados_bancarios).toBeUndefined();
    expect(f.bancos_logos).toBeUndefined();
  });

  it('assinatura Não (padrão): o mapeador não manda `assinatura` nem campo de aceite em branco', () => {
    const { fields } = monta();
    expect(fields.assinatura).toBeUndefined();
    expect(fields.aceite_documento_em_branco).toBeUndefined();
    // nome ou documento faltando/inválido também não vira folha de aceite
    expect(monta(dadosBase(), { nome: '', documento: CPF_TESTE }).fields.assinatura).toBeUndefined();
    expect(monta(dadosBase(), { nome: 'Cliente Teste', documento: '111.111.111-11' }).fields.assinatura).toBeUndefined();
  });

  it('assinatura Sim com CPF: aceite da empresa (razão social, CNPJ, sócio) e do cliente como pessoa física', () => {
    const f = monta(dadosBase(), { nome: 'Cliente Teste da Silva', documento: CPF_TESTE }).fields.assinatura as {
      local: string; cliente: Record<string, string>; empresa: Record<string, string>;
    };
    expect(f.local).toBe('Uberlândia MG');
    expect(f.cliente).toEqual({ nome: 'Cliente Teste da Silva', tipo: 'PF', documento: '52998224725' });
    expect(f.empresa).toEqual({ razao_social: 'Empresa Exemplo Solar LTDA', cnpj: '12.345.678/0001-90', representante: 'Maria Souza', cargo: CARGO_ASSINANTE });
  });

  it('assinatura Sim com CNPJ: cliente como pessoa jurídica (numérico e alfanumérico)', () => {
    const f = monta(dadosBase(), { nome: 'Mercado Exemplo LTDA', documento: CNPJ_TESTE }).fields.assinatura as { cliente: Record<string, string> };
    expect(f.cliente).toEqual({ nome: 'Mercado Exemplo LTDA', tipo: 'PJ', documento: '11222333000181' });
    expect(tipoDoDocumento(CPF_TESTE)).toBe('PF');
    expect(tipoDoDocumento(CNPJ_TESTE)).toBe('PJ');
    expect(tipoDoDocumento('12.ABC.345/01DE-35')).toBe('PJ');
    expect(tipoDoDocumento('123.456.789-00')).toBeNull();
    expect(tipoDoDocumento('')).toBeNull();
  });

  it('bateria só com a marca; sem marca a linha não sai', () => {
    const d = dadosBase();
    d.bateria = { incluir: true, modelo: 'BYD', capacidade: 10.24, qtd: 2, garantiaAnos: 10 };
    const f = monta(d).fields;
    expect(f.bateria_marca).toBe('BYD');
    expect(f.bateria_capacidade_kwh).toBe('10.24');
    expect(f.bateria_qtd).toBe('2');
    expect(f.bateria_garantia_anos).toBe('10');
    d.bateria = { incluir: true, modelo: '', capacidade: 5, qtd: 1, garantiaAnos: 5 };
    expect(monta(d).fields.bateria_marca).toBeUndefined();
  });
});

describe('orçamento oficial: critério e inflação', () => {
  const casos: Array<[string, unknown, boolean]> = [
    ['proposta nova completa', dadosBase(), true],
    ['números como texto (vindos de ->>)', { ...dadosBase(), item: { n: '14' }, tab: { pot: '600' }, precoOrcamento: '21497' }, true],
    ['eletroposto', { ...dadosBase(), produto: 'eletroposto' }, false],
    ['sem item', { ...dadosBase(), item: undefined }, false],
    ['item sem n', { ...dadosBase(), item: { g: 1050 } }, false],
    ['item.n zero', { ...dadosBase(), item: { n: 0 } }, false],
    ['sem tab', { ...dadosBase(), tab: null }, false],
    ['tab sem potência', { ...dadosBase(), tab: { inv: 'SAJ 6K' } }, false],
    ['sem preço', { ...dadosBase(), precoOrcamento: 0 }, false],
    ['preço ausente', { ...dadosBase(), precoOrcamento: undefined }, false],
    ['item é array', { ...dadosBase(), item: [1] }, false],
    ['null', null, false],
    ['texto', 'x', false],
    ['vazio', {}, false],
  ];

  it('servidor: só solar com kit e preço vira o papel oficial', () => {
    for (const [nome, d, esperado] of casos) expect(orcamentoOficialDisponivel(d), nome).toBe(esperado);
  });

  it('o /gerador (orcOficialOk, em index.html) aplica o MESMO critério que o servidor', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'dashboard', 'public', 'gerador', 'index.html'), 'utf8');
    const m = /\/\/ <orcOficialOk>\r?\n([\s\S]*?)\/\/ <\/orcOficialOk>/.exec(fonte);
    expect(m).not.toBeNull();
    const orcOficialOk = new Function(`${m![1]}\nreturn orcOficialOk;`)() as (d: unknown) => boolean;
    for (const [nome, d, esperado] of casos) {
      expect(orcOficialOk(d), `front: ${nome}`).toBe(esperado);
      expect(orcOficialOk(d), nome).toBe(orcamentoOficialDisponivel(d));
    }
  });

  it('inflação: 0% digitado vale 0%; ausente cai nos 6%', () => {
    const zero = { ...dadosBase(), inflTarifa: 0, inflTaxaMin: 0 };
    const f = monta(zero).fields;
    expect(f.inflacao_aa).toBe('0');
    expect(f.taxa_minima_inflacao_aa).toBe('0');
    expect(texto(html(zero))).toContain('cresce 0% a.a. · taxa mínima cresce 0% a.a.');
    const ausente = { ...dadosBase(), inflTarifa: undefined, inflTaxaMin: null };
    expect(monta(ausente).fields.inflacao_aa).toBe('6');
    expect(monta(ausente).fields.taxa_minima_inflacao_aa).toBe('6');
    expect(monta({ ...dadosBase(), inflTarifa: 0.065 }).fields.inflacao_aa).toBe('6.5');
  });

  it('a SolarDoc (sem o campo do /gerador) continua tratando 0 como o padrão de 6%', () => {
    const f = {
      emitido_em: '2026-10-15T12:00:00.000Z', cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '650', qtd_modulos: '12',
      potencia_modulo: '550', marca_inversor: 'Growatt', potencia_inversor: '5', investimento: '28.900,00',
      inflacao_aa: '0', taxa_minima_inflacao_aa: '0',
    };
    const x = texto(generateFromTemplate('propostaSolar', empresaRow as never, { nome: 'Cliente Exemplo' } as never, f, 4));
    expect(x).toContain('cresce 6% a.a. · taxa mínima cresce 6% a.a.');
  });
});

describe('o papel que sai', () => {
  const h = html();
  const t = texto(h);

  it('imprime as parcelas do /gerador, e só as marcadas', () => {
    expect(t).toMatch(/18× de R\$ 25\.041/);
    expect(t).toMatch(/21× de R\$ 25\.643/);
    expect(t).not.toContain('10× de');
    expect(t).not.toContain('Financiamento bancário');
  });

  it('o financiamento imprime fin36x e fin60x, não a conta da SolarDoc', () => {
    const d = dadosBase();
    (d.pagOpts as Record<string, unknown>).fin = { ativo: true, p36: true, p48: false, p60: true };
    const x = texto(html(d));
    expect(x).toMatch(/Financiamento bancário/);
    expect(x).toMatch(/36× de R\$ 950/);
    expect(x).toMatch(/60× de R\$ 708/);
    expect(x).not.toContain('48× de');
  });

  it('preço, validade da sexta às 18h, data de emissão e número da proposta', () => {
    expect(t).toMatch(/Preço do projeto R\$ 21\.497,00/);
    expect(t).toContain('VÁLIDO ATÉ 13/11/2026');
    expect(t).toContain('Válido até 13 de novembro de 2026, às 18h'.toUpperCase());
    expect(t).toContain('10/11/2026');
    expect(t).not.toContain('Válido por');
  });

  it('modo por dias: "Válido por N dias" com a data da emissão mais N', () => {
    const d = dadosBase();
    d.validadeModo = 'dias'; d.validadeDias = 3; d.expiraEmISO = null;
    const x = texto(html(d));
    expect(x).toContain('VÁLIDO POR 3 DIAS · ATÉ 13/11/2026');
  });

  it('equipamento, garantias e vendedor', () => {
    expect(t).toMatch(/14 módulos TCL de 600 W/);
    expect(t).toMatch(/1 inversor SAJ de 6 kW/);
    expect(t).toContain('inversor 10 anos');
    expect(t).toContain('Nilce');
    expect(t).toContain('(34) 99151-6846');
    expect(t).toContain('12.345.678/0001-90');
    expect(t).toMatch(/Estrutura para telhado fibrocimento/);
    expect(t).toMatch(/até 30 dias úteis/);
  });

  it('economia e retorno saem da mesma conta do /gerador (consumo x tarifa menos a taxa mínima, inflação dos dois lados)', () => {
    expect(t).toMatch(/Economia de R\$ 1\.050,00 todo mês/);
    expect(t).toMatch(/Em 1 ano e 9 meses o sistema se paga sozinho/);
  });

  it('sem assinatura: o papel sai SEM folha de aceite, sem linha de CPF, sem "undefined" nem NaN', () => {
    expect(h).not.toContain('Aceite da proposta');
    expect(t).not.toContain('CPF: ____');
    expect(t).not.toContain('Pelo cliente');
    expect(h).not.toContain('aceite_documento_em_branco');
    expect(h).not.toContain('undefined');
    expect(h).not.toContain('NaN');
    expect(h.match(/<div class="rowf"><span>CPF<\/span>/g)).toBeNull();
  });

  it('com assinatura (CPF): a folha de aceite sai com o nome e o CPF formatado; com CNPJ, rótulo CNPJ', () => {
    const x = html(undefined, { nome: 'Fabiano de Souza', documento: CPF_TESTE });
    const tx = texto(x);
    expect(x).toContain('Aceite da proposta');
    expect(tx).toContain('Fabiano de Souza');
    expect(tx).toContain('529.982.247-25');
    expect(tx).toContain('Pelo cliente');
    expect(tx).toMatch(/Proposta 202600951/);
    expect(tx).toContain('Até 13/11/2026');
    expect(tx).toContain('Maria Souza, Sócio administrador');
    expect((x.match(/<div class="page[ "]/g) || []).length).toBe(5);
    const pj = texto(html(undefined, { nome: 'Mercado Exemplo LTDA', documento: CNPJ_TESTE }));
    expect(pj).toContain('11.222.333/0001-81');
    expect(pj).toContain('CNPJ');
  });

  it('Fio B desligado, 12 bancos, sem dados bancários', () => {
    expect(t).not.toContain('Fio B');
    expect(h.match(/<div class="bk fx">/g)!.length).toBe(12);
    expect(t).not.toContain('Dados para pagamento');
    expect(h).not.toContain('NAO-DEVE-SAIR');
  });

  it('as 5 folhas (o aceite não entra sem assinatura), sem foto de obra quando a rota não entrega nenhuma', () => {
    expect((h.match(/<div class="page[ "]/g) || []).length).toBe(5);
    expect(h).not.toContain('Quem já confia na gente');
  });

  it('com foto do telhado (data URI) a folha "Local da instalação" sai; foto inválida não entra', () => {
    const d = dadosBase();
    d.fotoTelhado = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(html(d)).toContain('Local da instalação');
    d.fotoTelhado = 'javascript:alert(1)';
    expect(html(d)).not.toContain('Local da instalação');
  });

  it('foto de obra sem legenda (ou só com espaço) não ganha caixa de legenda vazia; com legenda, ganha', () => {
    const { fields, client, company } = monta();
    const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u/obra/1.jpg?token=x';
    const obras = (leg: (i: number) => string) => Array.from({ length: 6 }, (_, i) => ({ url: HTTPS, legenda: leg(i) }));
    const gera = (leg: (i: number) => string) => generateFromTemplate('propostaSolar', company as never, client as never, { ...fields, fotos_obras: obras(leg) }, 4);
    const sem = gera(() => '');
    expect(sem).toContain('Obras realizadas');
    expect(sem.match(/<div class="ob">/g)!.length).toBe(6);
    expect(sem).not.toContain('<div class="cap"');
    expect(gera(() => '   ')).not.toContain('<div class="cap"');
    const mista = gera((i) => (i === 0 ? 'Obra em Uberlândia' : ''));
    expect(mista.match(/<div class="cap">/g)!.length).toBe(1);
    expect(mista).toContain('Obra em Uberlândia');
  });

  it('fotos de obra: 10 primeiras da galeria, na ordem, mais as 2 fixas do site (sem legenda)', () => {
    const galeria = Array.from({ length: 12 }, (_, i) => ({ url: `https://p.supabase.co/g${i + 1}.jpg`, legenda: i === 0 ? 'Obra A' : '' }));
    const r = fotosDeObraDoOrcamento(galeria);
    expect(r).toHaveLength(12);
    expect(r.slice(0, 10).map((f) => f.url)).toEqual(galeria.slice(0, 10).map((f) => f.url));
    expect(r[0].legenda).toBe('Obra A');
    expect(r[10].url).toBe(FOTOS_OBRA_IO[0].url);
    expect(r[11].url).toBe(FOTOS_OBRA_IO[1].url);
    expect(r[10].legenda).toBe('');
    expect(r[11].legenda).toBe('');
    expect(FOTOS_OBRA_IO).toHaveLength(2);
    expect(FOTOS_OBRA_IO.every((f) => /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(f.url))).toBe(true);
    expect(MAX_OBRAS_GALERIA).toBe(10);
  });

  it('fotos de obra: galeria com 4 -> 4 + 2 fixas; sem galeria, só as 2; item sem URL não conta', () => {
    const g4 = Array.from({ length: 4 }, (_, i) => ({ url: `https://p.supabase.co/g${i + 1}.jpg`, legenda: '' }));
    const r = fotosDeObraDoOrcamento([{ legenda: 'sem url' }, ...g4]);
    expect(r).toHaveLength(6);
    expect(r.slice(0, 4).map((f) => f.url)).toEqual(g4.map((f) => f.url));
    expect(fotosDeObraDoOrcamento(undefined)).toHaveLength(2);
  });

  it('fotos de obra no papel: galeria de 4 + 2 fixas = 6 fotos (fileira completa), sem caixa de legenda; 12 -> 10 + 2', () => {
    const g = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://p.supabase.co/g${i + 1}.jpg`, legenda: '' }));
    const gera = (n: number) => {
      const { fields, client, company } = monta();
      return generateFromTemplate('propostaSolar', company as never, client as never, { ...fields, fotos_obras: fotosDeObraDoOrcamento(g(n)) }, 4);
    };
    const x4 = gera(4);
    expect(x4.match(/<div class="ob">/g)!.length).toBe(6);
    expect(x4).not.toContain('<div class="cap"');
    const x12 = gera(12);
    expect(x12.match(/<div class="ob">/g)!.length).toBe(12);
    expect(x12).toContain('https://p.supabase.co/g10.jpg');
    expect(x12).not.toContain('https://p.supabase.co/g11.jpg');
    expect(x12).toContain(FOTOS_OBRA_IO[1].url);
  });

  it('nome do cliente com HTML sai escapado', () => {
    const d = dadosBase();
    d.nome = 'Fulano <script>x</script>';
    const x = html(d);
    expect(x).not.toContain('<script>x</script>');
    expect(x).toContain('&lt;script&gt;');
  });

  it('proposta da SolarDoc (sem os campos do /gerador) continua calculando a parcela pela taxa, e a validade por dias', () => {
    const f = {
      emitido_em: '2026-10-15T12:00:00.000Z', cidade: 'Uberlândia', uf: 'MG', consumo_kwh: '650', qtd_modulos: '12',
      potencia_modulo: '550', marca_modulo: 'Canadian', marca_inversor: 'Growatt', potencia_inversor: '5',
      investimento: '28.900,00', pag_cartao_12: true, pag_fin_60: true, validade_dias: '5',
    };
    const x = texto(generateFromTemplate('propostaSolar', empresaRow as never, { nome: 'Cliente Exemplo' } as never, f, 4));
    // Cartão 12x pela tabela da SolarDoc (12,70%): 28.900 x 1,127 / 12 = 2.714,2 -> teto 2.715. Não é a tabela do /gerador.
    expect(x).toMatch(/12× de R\$ 2\.715/);
    expect(x).toContain('VÁLIDO POR 5 DIAS · ATÉ 20/10/2026');
  });
});
