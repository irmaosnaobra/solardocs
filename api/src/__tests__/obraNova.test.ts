import { describe, it, expect } from 'vitest';
import { itensDaEtapaObra, obraMaterializada, etapaAtualCompleta, itensIniciais, LISTA_PRONTA, materialDaCompra, type CargaObra, type ItemCompra, type ObraPrivada } from '../services/gerador/jornadaObra';
import type { LancamentoObra } from '../services/gerador/jornadaDinheiro';
import { cifrar } from '../services/gerador/cofreObra';
import { SLOTS_FOTO_ENTREGA } from '../services/gerador/obraDocs';
import { obraPrivadaVazia, obraVazia, normalizarObraPrivada } from '../services/gerador/jornadaObraBanco';
import { AJUSTES_PADRAO, livroDaObra } from '../services/gerador/jornadaDinheiro';
import { aplicarPortoes, forcarEtapa, portaoCompra, portaoEntrega, portaoLogistica, portaoObra, ultimoCarimbo } from '../services/gerador/obraPortoes';
import { itensQueContam, orcadoApenas, serieDoInversor, statusDoKit, statusDoMaterial } from '../services/gerador/compraKit';
import { concluirComissionamento } from '../services/gerador/comissionamento';
import { equipamentoFinal, itensParaTermo } from '../services/gerador/equipamentoFinal';
import { aplicarDocumentoNaCompra, compraExistenteDoDocumento, tipoDoDocumento, type DocLido } from '../services/gerador/compraLeitura';
import { tipoDaDescricao, parecidos } from '../services/gerador/compraTexto';
import { colunasDaPlanilha, listaParaCopiar } from '../services/gerador/planilhaContratos';
import { enviarParaPlanilha } from '../services/gerador/planilhaEnvio';

const AGORA = '2026-11-19T12:00:00.000Z';
const item = (id: string, o: Partial<ItemCompra> = {}): ItemCompra => ({
  id, origem: 'manual', tipo: 'outro', descricao: id, quantidade: 1, unidade: 'un', marca: '', modelo: '', potencia_w: null, potencia_kw: null,
  garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: null, fornecedor: '', valor_centavos: null, data: null,
  etapa: 4, criado_por: 'thiago', criado_em: AGORA, comprado: false, orcado_centavos: null, lido_de: '', documento_id: '', serie: '', ...o,
});
const carga = (o: Partial<CargaObra> = {}): CargaObra => ({
  id: 'g-1', nome: 'Carga 1', itens: ['m', 'i'], saida: { lugar: 'Uberlândia, Av. X 10', em: '2026-11-20' }, chegada: { lugar: '', destino: 'obra', em: '' },
  transporte: { empresa: '', motorista: 'Zé', cpf: '52998224725', placa: 'ABC1D23', carro: '' }, compras: [], recebido_por: { nome: 'Diego', cpf: '', assinatura_id: '' },
  conferencia: { itens_ok: [], foto_id: '' }, fotos: ['f-1'], avaria: { tem: false, descricao: '', foto_id: '', o_que_fazer: '', resolvida: false },
  frete: { valor_centavos: null, forma: '' }, documentos: [], ...o,
});
const kit = (comprado: boolean): ItemCompra[] => [
  item('m', { tipo: 'modulo', origem: 'proposta', comprado, quantidade: 10, potencia_w: 600 }), item('i', { tipo: 'inversor', origem: 'proposta', comprado }),
];
const CHECK = Object.fromEntries(['estrutura', 'placas', 'strings', 'inversor', 'dps', 'aterramento', 'cabos', 'padrao'].map((k) => [k, true]));
const existe = (ids: string[]) => new Set(ids);
const emObra = (n: number) => obraMaterializada(7, n, AGORA, AGORA);

describe('os portões novos (sem botão Concluir)', () => {
  it('Compra: libera com módulos e inversor comprados; falta um, não libera; estrutura e material não seguram', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [...kit(true), item('e1', { tipo: 'eletrico', comprado: false })];
    expect(portaoCompra(p)).toBe(true);   // material elétrico pendente não segura
    p.compra.itens = [kit(true)[0], kit(false)[1]];
    expect(portaoCompra(p)).toBe(false);
    expect(statusDoKit(p.compra.itens).faltam).toEqual(['inversor']);
    p.compra.itens = [...kit(true), item('t', { tipo: 'estrutura' })];
    expect(portaoCompra(p)).toBe(true);   // A1: a estrutura não comprada NÃO segura o portão (o fechamento a cobra)
    expect(portaoCompra(obraPrivadaVazia())).toBe(false);
  });

  it('Compra: o previsto da proposta trocado pelo comprado de outra marca não segura o kit', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [item('m0', { tipo: 'modulo', origem: 'proposta' }), item('m1', { tipo: 'modulo', origem: 'arquivo', comprado: true }), kit(true)[1]];
    expect(portaoCompra(p)).toBe(true);
  });

  it('Compra: os itens trazem o nível (kit obrigatório, material elétrico opcional)', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [...kit(false), item('e1', { tipo: 'eletrico' })];
    const itens = itensDaEtapaObra(4, { jo: emObra(4), privada: p, livro: livroDaObra({ lancamentos: [], ignoradas: 0, vendaCentavos: null, vendedor: 'x', regra: AJUSTES_PADRAO.comissoes.nilce, previsto: null, pendenciasDaObra: [], adm: true }), slots: new Map(), docsIds: new Set() });
    expect(itens.map((i) => [i.chave, i.nivel, i.feito])).toEqual([['kit', 'obrigatorio', false], ['eletrico', 'opcional', false]]);
  });

  it('Logística: carga do kit completa libera; cada falta segura; carga de material incompleta não segura', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [...kit(true), item('e1', { tipo: 'eletrico' })];
    p.logistica.cargas = [carga()];
    const ok = existe(['f-1']);
    const livre = (c: CargaObra) => { p.logistica.cargas = [c]; return portaoLogistica(p, (id) => ok.has(id)); };
    expect(livre(carga())).toBe(true);
    expect(livre(carga({ saida: { lugar: '', em: '2026-11-20' } }))).toBe(false);
    expect(livre(carga({ saida: { lugar: 'X', em: '' } }))).toBe(false);
    expect(livre(carga({ transporte: { empresa: '', motorista: 'Zé', cpf: '52998224725', placa: 'ABC12', carro: '' } }))).toBe(false);
    expect(livre(carga({ transporte: { empresa: '', motorista: 'Zé', cpf: '', placa: 'ABC1D23', carro: '' } }))).toBe(false);
    expect(livre(carga({ recebido_por: { nome: '', cpf: '', assinatura_id: '' } }))).toBe(false);
    expect(livre(carga({ fotos: [] }))).toBe(false);
    expect(livre(carga({ fotos: [], conferencia: { itens_ok: [], foto_id: 'f-1' } }))).toBe(true);   // a foto antiga também vale
    expect(livre(carga({ itens: ['m'] }))).toBe(false);   // o inversor não está em nenhuma carga
    // Carga só de material, incompleta: não segura (e vem como opcional).
    p.logistica.cargas = [carga(), carga({ id: 'g-2', itens: ['e1'], saida: { lugar: '', em: '' }, fotos: [] })];
    expect(portaoLogistica(p, (id) => ok.has(id))).toBe(true);
    const itens = itensDaEtapaObra(5, { jo: emObra(5), privada: p, livro: livroDaObra({ lancamentos: [], ignoradas: 0, vendaCentavos: null, vendedor: 'x', regra: AJUSTES_PADRAO.comissoes.nilce, previsto: null, pendenciasDaObra: [], adm: true }), slots: new Map(), docsIds: ok });
    expect(itens.find((i) => i.chave === 'retirada_g-2')).toMatchObject({ feito: false, nivel: 'opcional' });
    expect(itens.find((i) => i.chave === 'retirada_g-1')).toMatchObject({ feito: true, nivel: 'obrigatorio' });
  });

  it('Obra: checklist completo e 1 dia do diário com foto liberam; sem foto existente ou checklist incompleto, não', () => {
    const p = obraPrivadaVazia();
    p.obra.checklist = { ...CHECK };
    p.obra.diario = [{ data: '2026-11-25', chegada: '', saida: '', fotos: ['f-1'], ocorrencia: '', equipe: '' }];
    expect(portaoObra(p, (id) => id === 'f-1')).toBe(true);
    expect(portaoObra(p, () => false)).toBe(false);
    p.obra.checklist.dps = false;
    expect(portaoObra(p, (id) => id === 'f-1')).toBe(false);
  });

  it('aplicarPortoes: abre em cadeia, grava concluida_em e o histórico uma vez; segunda chamada não muda nada', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = kit(true);
    p.logistica.cargas = [carga()];
    p.obra.checklist = { ...CHECK };
    p.obra.diario = [{ data: '2026-11-25', chegada: '', saida: '', fotos: ['f-1'], ocorrencia: '', equipe: '' }];
    const e0 = emObra(4);
    const e1 = aplicarPortoes(e0, { privada: p, docsIds: existe(['f-1']), slots: new Map() }, AGORA, 'diego');
    expect([4, 5, 6].map((n) => !!e1.etapas[n as 4].concluida_em)).toEqual([true, true, true]);
    expect(e1.etapas[7].aberta_em).toBe(AGORA);
    expect(etapaAtualCompleta(null, e1, null)).toBe(7);
    expect(e1.historico.filter((h) => h.acao === 'concluir').map((h) => [h.etapa, h.por])).toEqual([[4, 'diego'], [5, 'diego'], [6, 'diego']]);
    expect(aplicarPortoes(e1, { privada: p, docsIds: existe(['f-1']), slots: new Map() }, '2026-11-20T00:00:00.000Z', 'thiago')).toBe(e1);
  });

  it('aplicarPortoes: obra antiga não regride (etapa concluída segue concluída com o dado vazio) e a Logística só abre com a Compra concluída', () => {
    const e = emObra(6);   // 4 e 5 concluídas pelo estado antigo
    const vazio = aplicarPortoes(e, { privada: obraPrivadaVazia(), docsIds: new Set(), slots: new Map() }, AGORA, 'diego');
    expect(vazio).toBe(e);
    expect(vazio.etapas[4].concluida_em).toBeTruthy();
    expect(etapaAtualCompleta(null, vazio, null)).toBe(6);
    // Compra incompleta: a carga completa não adianta.
    const p = obraPrivadaVazia();
    p.compra.itens = kit(false);
    p.logistica.cargas = [carga()];
    const e4 = emObra(4);
    expect(aplicarPortoes(e4, { privada: p, docsIds: existe(['f-1']), slots: new Map() }, AGORA, 'diego')).toBe(e4);
    // Conta fechada não muda.
    const fechada = { ...emObra(4), fechada: { em: AGORA, por: 'thiago' } };
    p.compra.itens = kit(true);
    expect(aplicarPortoes(fechada, { privada: p, docsIds: new Set(), slots: new Map() }, AGORA, 'diego')).toBe(fechada);
  });

  it('o item guardado antes do tique "Comprado" conta como comprado quando já estava ligado a uma compra', () => {
    const p = normalizarObraPrivada({ ...obraPrivadaVazia(), compra: { compras: [], itens: [{ id: 'i-1', tipo: 'modulo', compra_id: 'c-1' }, { id: 'i-2', tipo: 'inversor' }] } });
    expect(p.compra.itens.map((i) => i.comprado)).toEqual([true, false]);
    expect(p.compra.documentos).toEqual([]);
  });
});

describe('o Comissionamento (botão final)', () => {
  it('conclui a 7 e a 8 juntas, fecha a conta e deixa o histórico que os robôs leem', () => {
    const r = concluirComissionamento(emObra(7), 'thiago', AGORA);
    if ('recusa' in r) throw new Error('recusou');
    expect(r.etapas[7].concluida_em).toBe(AGORA);
    expect(r.etapas[8]).toMatchObject({ concluida_em: AGORA, concluida_por: 'thiago' });
    expect(r.fechada).toEqual({ em: AGORA, por: 'thiago' });
    expect(r.historico.slice(-4).map((h) => [h.acao, h.etapa])).toEqual([['concluir', 7], ['abrir', 8], ['concluir', 8], ['fechar', 8]]);
    expect(r.historico.filter((h) => h.acao === 'concluir').map((h) => h.etapa)).toEqual([7, 8]);
    expect(etapaAtualCompleta(null, r, null)).toBe(9);
  });
  it('a 7 já concluída no estado antigo continua; só a 8 conclui; antes da 7 ou com a conta fechada recusa', () => {
    const antiga = emObra(8);
    const r = concluirComissionamento(antiga, 'thiago', AGORA);
    if ('recusa' in r) throw new Error('recusou');
    expect(r.etapas[7].concluida_em).toBe(antiga.etapas[7].concluida_em);
    expect(r.historico.filter((h) => h.acao === 'concluir').map((h) => h.etapa)).toEqual([8]);
    expect(concluirComissionamento(emObra(6), 'thiago', AGORA)).toMatchObject({ http: 409 });
    expect(concluirComissionamento({ ...emObra(7), fechada: { em: AGORA, por: 'x' } }, 'thiago', AGORA)).toMatchObject({ http: 409 });
    expect(concluirComissionamento(obraVazia(7), 'thiago', AGORA)).toMatchObject({ http: 409 });
  });
});

describe('a Entrega (etapa 7) também abre a 8 sozinha', () => {
  const entregaPronta = (): ObraPrivada => {
    const p = obraPrivadaVazia();
    p.entrega.testes = { string1_voc: '412', string2_voc: '409', isolamento_ok: true, gerando_kw: '6,2', gerando_hora: '11:40', wifi_ok: true, disjuntores_ok: true };
    p.entrega.monitoramento = { app: 'iSolarCloud', conta: 'c@x.com', usina: 'Casa', online: true, serie: 'INV-1', comissionamento: '' };
    p.entrega.cofre = { ...cifrar('senha'), em: AGORA, por: 'diego' };
    p.entrega.termo = { assinado_em: AGORA, nome: 'Marcos', arquivo_id: 'a-ass', chk: ['sim', 'sim', 'sim', 'sim', 'sim', 'na'], ressalva: '' };
    return p;
  };
  const fotos = (n: number) => new Map(SLOTS_FOTO_ENTREGA.slice(0, n).map((s) => [s, [`a-${s}`]] as [string, string[]]));

  it('com o portão da 7 verdadeiro, conclui a 7, abre a 8 e grava concluir+abrir com quem salvou; idempotente', () => {
    const p = entregaPronta();
    const e0 = emObra(7);
    expect(portaoEntrega(p, fotos(8), (id) => id === 'a-ass')).toBe(true);
    const e1 = aplicarPortoes(e0, { privada: p, docsIds: existe(['a-ass']), slots: fotos(8) }, AGORA, 'diego');
    expect(e1.etapas[7]).toMatchObject({ concluida_em: AGORA, concluida_por: 'diego' });
    expect(e1.etapas[8].aberta_em).toBe(AGORA);
    expect(e1.etapas[8].concluida_em).toBeNull();
    expect(etapaAtualCompleta(null, e1, null)).toBe(8);   // a obra vira etapa 8 (dono Thiago) para a fila e a escalada
    expect(e1.historico.slice(-2).map((h) => [h.acao, h.etapa, h.por])).toEqual([['concluir', 7, 'diego'], ['abrir', 8, 'diego']]);
    expect(aplicarPortoes(e1, { privada: p, docsIds: existe(['a-ass']), slots: fotos(8) }, '2026-11-20T00:00:00.000Z', 'thiago')).toBe(e1);
  });

  it('cada falta da 7 segura: 7 de 8 fotos, termo sem arquivo, sem cofre, teste vermelho', () => {
    const e0 = emObra(7);
    const tenta = (p: ObraPrivada, slots: Map<string, string[]>, docs = ['a-ass']) => aplicarPortoes(e0, { privada: p, docsIds: existe(docs), slots }, AGORA, 'diego');
    expect(tenta(entregaPronta(), fotos(7))).toBe(e0);
    expect(tenta(entregaPronta(), fotos(8), [])).toBe(e0);
    const semCofre = entregaPronta(); semCofre.entrega.cofre = null;
    expect(tenta(semCofre, fotos(8))).toBe(e0);
    const teste = entregaPronta(); teste.entrega.testes.wifi_ok = false;
    expect(tenta(teste, fotos(8))).toBe(e0);
  });

  it('o botão final conclui só a 8 quando a 7 já está concluída (e a 7 junto só se ainda não estava)', () => {
    const e1 = aplicarPortoes(emObra(7), { privada: entregaPronta(), docsIds: existe(['a-ass']), slots: fotos(8) }, AGORA, 'diego');
    const r = concluirComissionamento(e1, 'thiago', '2026-11-20T10:00:00.000Z');
    if ('recusa' in r) throw new Error('recusou');
    expect(r.etapas[7].concluida_por).toBe('diego');
    expect(r.historico.filter((h) => h.acao === 'concluir').map((h) => [h.etapa, h.por]).slice(-2)).toEqual([[7, 'diego'], [8, 'thiago']]);
    expect(r.fechada).toMatchObject({ por: 'thiago' });
  });
});

describe('o equipamento final', () => {
  const proposta = { qtdPlacas: 10, modeloPlaca: 'Tsun TSM 600', potPlaca: 600, qtdInversor: 1, inversor: 'SAJ 6K' };
  it('sem item comprado vem da proposta, com a etiqueta; com item comprado, da compra', () => {
    const a = equipamentoFinal([], proposta);
    expect(a).toMatchObject({ origem: 'proposta', etiqueta: 'da proposta', qtd_modulos: 10, kwp: 6 });
    const b = equipamentoFinal([item('m', { tipo: 'modulo', comprado: true, quantidade: 12, potencia_w: 620, marca: 'Jinko', descricao: 'Modulo Jinko 620W' }), item('i', { tipo: 'inversor', origem: 'proposta', modelo: 'SAJ 6K' })], proposta);
    expect(b).toMatchObject({ origem: 'compra', etiqueta: 'Comprado', qtd_modulos: 12, potencia_modulo_w: 620 });
    expect(b.inversores[0].origem).toBe('proposta');   // a categoria sem compra segue da proposta
    expect(b.diferencas.join(' ')).toContain('12 no lugar de 10');
    expect(equipamentoFinal([], null).origem).toBe('vazio');
  });
  it('o termo usa os comprados de cada categoria', () => {
    const its = [item('m0', { tipo: 'modulo', origem: 'proposta' }), item('m1', { tipo: 'modulo', comprado: true }), item('i0', { tipo: 'inversor' })];
    expect(itensParaTermo(its).map((i) => i.id)).toEqual(['m1', 'i0']);
  });
});

describe('a Compra lida sozinha (mescla pura)', () => {
  let n = 0;
  const ctx = { por: 'thiago', agora: AGORA, novoId: (p: string) => `${p}-${++n}00000` };
  const nota = (tipo: DocLido['tipo'], itens: DocLido['itens'], fornecedor = 'Solar Centro'): DocLido => ({ tipo, fornecedor, numero: '123', chave: null, data: '2026-11-18', total_centavos: 100_000, itens, origem: 'ia' });
  const arq = (sha = 'a'.repeat(64)) => ({ nome: 'nota.pdf', sha256: sha, path: 'fin/7/x.pdf' });
  const linhas = [
    { descricao: 'MODULO FOTOVOLTAICO TSUN 600W TSM-600', quantidade: 10, unidade: 'un', valor_unitario_centavos: 60_000, valor_total_centavos: 600_000 },
    { descricao: 'Cabo solar 6 mm preto', quantidade: 100, unidade: 'm', valor_unitario_centavos: 500, valor_total_centavos: 50_000 },
  ];

  it('reconhece o tipo e o "parecido"', () => {
    expect(tipoDaDescricao('MODULO FOTOVOLTAICO TSUN 600W')).toBe('modulo');
    expect(tipoDaDescricao('Inversor SAJ 6K')).toBe('inversor');
    expect(tipoDaDescricao('Gancho para telha')).toBe('estrutura');
    expect(tipoDaDescricao('Cabo solar 6 mm')).toBe('eletrico');
    expect(parecidos('Módulo Tsun TSM-600 600 W', 'MODULO FOTOVOLTAICO TSUN 600W')).toBe(true);
    expect(parecidos('Cabo solar 6 mm', 'Cabo solar 4 mm')).toBe(false);
    expect(tipoDoDocumento({ origem: 'xml' })).toBe('nota_fiscal');
    expect(tipoDoDocumento({ tipo: 'outro' })).toBe('orcamento');
  });

  it('NOTA: item que existe recebe só os campos vazios e fica comprado; o que não existe entra como "lido do arquivo"', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [item('m', { tipo: 'modulo', origem: 'proposta', descricao: 'Módulo Tsun 600 W', modelo: 'Tsun TSM-600', quantidade: 12, fornecedor: 'Outro Forn' })];
    const r = aplicarDocumentoNaCompra(p, nota('nota_fiscal', linhas), arq(), ctx);
    if ('repetido' in r) throw new Error('repetido');
    const m = r.privada.compra.itens.find((i) => i.id === 'm')!;
    expect(m).toMatchObject({ comprado: true, quantidade: 12, fornecedor: 'Outro Forn', valor_centavos: 600_000, data: '2026-11-18', potencia_w: 600 });   // quantidade e fornecedor já existiam: ficam
    expect(m.compra_id).toBeTruthy();
    const novo = r.privada.compra.itens.find((i) => i.id !== 'm')!;
    expect(novo).toMatchObject({ origem: 'arquivo', tipo: 'eletrico', comprado: true, lido_de: 'nota.pdf', quantidade: 100, valor_centavos: 50_000 });
    expect(r.privada.compra.compras).toHaveLength(1);
    expect(r.privada.compra.compras[0].fornecedor).toBe('Solar Centro');
    expect(r.privada.compra.documentos[0]).toMatchObject({ tipo: 'nota_fiscal', itens: 2, compra_id: r.resumo.compra_id });
    expect(r.resumo).toMatchObject({ atualizados: 1, novos: 1, marcados_comprados: 2 });
  });

  it('ORÇAMENTO: só fornecedor e valor orçado; não marca comprado, não cria compra, não mexe em valor pago', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = kit(false);
    p.compra.itens[0].descricao = 'Módulo Tsun 600 W';
    const r = aplicarDocumentoNaCompra(p, nota('orcamento', linhas), arq(), ctx);
    if ('repetido' in r) throw new Error('repetido');
    const m = r.privada.compra.itens.find((i) => i.id === 'm')!;
    expect(m).toMatchObject({ comprado: false, orcado_centavos: 600_000, valor_centavos: null, fornecedor: 'Solar Centro', compra_id: null });
    expect(r.privada.compra.compras).toHaveLength(0);
    expect(portaoCompra(r.privada)).toBe(false);
    // Depois a NOTA do mesmo item marca comprado e troca o documento ligado.
    const r2 = aplicarDocumentoNaCompra(r.privada, nota('nota_fiscal', linhas), arq('b'.repeat(64)), ctx);
    if ('repetido' in r2) throw new Error('repetido');
    const m2 = r2.privada.compra.itens.find((i) => i.id === 'm')!;
    expect(m2.comprado).toBe(true);
    expect(m2.orcado_centavos).toBe(600_000);
    expect(m2.documento_id).not.toBe(m.documento_id);
  });

  it('o mesmo arquivo (sha) não é aplicado duas vezes', () => {
    const p = obraPrivadaVazia();
    const r = aplicarDocumentoNaCompra(p, nota('pedido', linhas), arq(), ctx);
    if ('repetido' in r) throw new Error('repetido');
    expect(aplicarDocumentoNaCompra(r.privada, nota('pedido', linhas), arq(), ctx)).toEqual({ repetido: true });
  });
});

describe('a planilha antiga', () => {
  const equip = equipamentoFinal([
    item('m', { tipo: 'modulo', comprado: true, quantidade: 10, marca: 'Tsun', potencia_w: 600 }), item('i', { tipo: 'inversor', comprado: true, marca: 'SAJ', modelo: '6K' }),
  ], null);
  const entrada = {
    codigo: '#0058', titularConta: 'Maria Souza', telefone: '34999990000', endereco: 'Rua A, 10', cidade: 'Uberlândia', uf: 'MG', concessionaria: '',
    valorCentavos: 3_890_000, formasDePagamento: ['pix', 'financiamento'], equip, excedente: true, liberadaEm: '2026-11-06',
  };
  const cols = colunasDaPlanilha(entrada);
  const por = (c: string) => cols.find((x) => x.coluna === c);

  it('só colunas com dado certo, e NUNCA as internas', () => {
    expect(por('F')).toMatchObject({ valor: 38_900, sensivel: true });
    expect(por('G')?.texto).toBe('Pix + Financiamento');
    expect(por('U')?.texto).toBe('Tsun 600W');
    expect(por('Z')?.texto).toBe('SAJ 6K');
    expect(por('T')?.valor).toBe(10);
    expect(por('AM')).toMatchObject({ tipo: 'data', texto: '06/11/2026' });
    expect(por('AP')?.texto).toBe('Cemig');
    expect(por('AO')?.texto).toBe('Tem Excedente');
    for (const interna of ['D', 'E', 'H', 'I', 'K', 'P', 'Q', 'R', 'S', 'W', 'AA', 'AC', 'AD', 'AG', 'AQ', 'AR', 'AZ']) expect(por(interna), interna).toBeUndefined();
    const vazia = colunasDaPlanilha({ ...entrada, titularConta: '', telefone: '', valorCentavos: null, formasDePagamento: [], liberadaEm: null, excedente: false, equip: equipamentoFinal([], null) });
    expect(vazia.map((c) => c.coluna)).toEqual(['A', 'M', 'N', 'O', 'AE', 'AF', 'AN', 'AP']);
    expect(vazia.find((c) => c.coluna === 'F')).toBeUndefined();
    expect(vazia.find((c) => c.coluna === 'C')).toBeUndefined();
  });

  it('sem env devolve só a lista; quem não vê o valor da venda não recebe F nem G', () => {
    const l = listaParaCopiar(cols, false);
    expect(l.find((x) => x.coluna === 'F')).toBeUndefined();
    expect(l.find((x) => x.coluna === 'G')).toBeUndefined();
    expect(listaParaCopiar(cols, true).find((x) => x.coluna === 'F')?.texto).toBe('R$ 38.900,00');
    return enviarParaPlanilha('#0058', cols, { url: '', segredo: '' }).then((r) => expect(r.status).toBe('nao_ligada'));
  });

  it('com env: envia só colunas escritas (sem A) e devolve gravadas x puladas; falha vira status, nunca lança', async () => {
    let corpo: { segredo: string; codigo: number; colunas: Array<{ coluna: string }> } | null = null;
    const ok = await enviarParaPlanilha('#0058', cols, {
      url: 'https://exemplo.invalid/exec', segredo: 'x', fetch: (async (_u: unknown, init: { body: string }) => {
        corpo = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ ok: true, linha: 59, gravadas: ['F', 'U'], puladas: [{ coluna: 'C', motivo: 'ja_preenchida' }] }) };
      }) as unknown as typeof fetch,
    });
    expect(ok).toMatchObject({ status: 'preenchida', linha: 59, gravadas: ['F', 'U'], puladas: [{ coluna: 'C', motivo: 'ja_preenchida' }] });
    expect(corpo!.codigo).toBe(58);
    expect(corpo!.colunas.map((c) => c.coluna)).not.toContain('A');
    const cai = await enviarParaPlanilha('#0058', cols, { url: 'https://exemplo.invalid/exec', segredo: 'x', fetch: (async () => { throw new Error('rede'); }) as unknown as typeof fetch });
    expect(cai).toMatchObject({ status: 'falhou', motivo: 'rede' });
    const http = await enviarParaPlanilha('#0058', cols, { url: 'https://exemplo.invalid/exec', segredo: 'x', fetch: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch });
    expect(http).toMatchObject({ status: 'falhou', motivo: 'http_500' });
    const nada = await enviarParaPlanilha('#0058', cols, { url: 'https://exemplo.invalid/exec', segredo: 'x', fetch: (async () => ({ ok: true, status: 200, json: async () => ({ ok: true, linha: 59, gravadas: [], puladas: [] }) })) as unknown as typeof fetch });
    expect(nada.status).toBe('nada_a_gravar');
  });
});


// ── As regras novas do dono do produto (A1 a A4) e os achados do revisor (B1, B3, B4) ──────────────────────────────────────────────────────────

const docOrc = (id: string): ObraPrivada['compra']['documentos'][number] => ({
  id, tipo: 'orcamento', nome: 'orc.pdf', sha256: 'a'.repeat(64), path: 'fin/7/o.pdf', fornecedor: 'Loja', numero: '1', data: '2026-11-01', total_centavos: 9_000, itens: 1, origem: 'ia', compra_id: null, em: AGORA, por: 'thiago',
});
const orcado = (id: string, o: Partial<ItemCompra> = {}): ItemCompra => item(id, { origem: 'arquivo', comprado: false, orcado_centavos: 9_000, documento_id: 'd-orc', lido_de: 'orc.pdf', ...o });
const pago = (compraId: string, valor: number): LancamentoObra => ({ apagado: false, valor_centavos: valor, categoria: 'material', obra: { grupo: 'custo', compra_id: compraId, estorno_de: null } }) as unknown as LancamentoObra;

describe('A1: o portão da Compra é só módulos e inversor; a estrutura é cobrada no fechamento', () => {
  it('estrutura prevista pela proposta e não comprada não segura a Compra nem a Logística, mas entra na exigência do fechamento', () => {
    const p = obraPrivadaVazia();
    p.compra.compras = [{ id: 'c-1', fornecedor: 'F', cidade: '', data: '2026-11-01', forma: '', nota_chega: 'anexada', nota: null }];
    const comprado = (id: string, tipo: ItemCompra['tipo']) => item(id, { tipo, comprado: true, fornecedor: 'F', valor_centavos: 10_000, data: '2026-11-01', compra_id: 'c-1' });
    p.compra.itens = [comprado('m', 'modulo'), comprado('i', 'inversor'), item('est', { tipo: 'estrutura', origem: 'proposta' })];
    expect(portaoCompra(p)).toBe(true);
    const kit3 = statusDoKit(p.compra.itens);
    expect(kit3.completo).toBe(true);
    expect(kit3.ativos.map((i) => i.id)).toEqual(['m', 'i', 'est']);   // a estrutura segue no grupo kit da resposta
    // A Logística também não espera a estrutura: basta o módulo e o inversor numa carga completa.
    p.logistica.cargas = [carga({ itens: ['m', 'i'] })];
    expect(portaoLogistica(p, (id) => id === 'f-1')).toBe(true);
    // O fechamento cobra: 2 de 3 (a estrutura não foi comprada).
    expect(materialDaCompra(p, [pago('c-1', 20_000)])).toEqual({ com_origem: 2, total: 3 });
    // Comprada, a estrutura entra no 3 de 3.
    p.compra.itens[2] = comprado('est', 'estrutura');
    expect(materialDaCompra(p, [pago('c-1', 30_000)])).toEqual({ com_origem: 3, total: 3 });
  });
});

describe('A2: item "orçado, não comprado" não conta para nada', () => {
  it('só vale como orçado o item de arquivo, de documento orçamento, sem o tique; nota, pedido e o tique à mão mudam isso', () => {
    const docs = [docOrc('d-orc'), { ...docOrc('d-nf'), tipo: 'nota_fiscal' as const }];
    expect(orcadoApenas(orcado('a'), docs)).toBe(true);
    expect(orcadoApenas(orcado('b', { comprado: true }), docs)).toBe(false);
    expect(orcadoApenas(orcado('c', { documento_id: 'd-nf' }), docs)).toBe(false);   // veio de nota e a pessoa tirou o tique: segue exigido
    expect(orcadoApenas(item('d', { origem: 'proposta' }), docs)).toBe(false);
    expect(orcadoApenas(item('e', { origem: 'manual' }), docs)).toBe(false);
  });
  it('não entra no kit, no material, no equipamento final nem no termo; não trava o portão e não entra no total do fechamento', () => {
    const p = obraPrivadaVazia();
    p.compra.documentos = [docOrc('d-orc')];
    p.compra.itens = [...kit(true), orcado('orc-m', { tipo: 'modulo' }), orcado('orc-cabo', { tipo: 'eletrico' })];
    expect(portaoCompra(p)).toBe(true);
    expect(statusDoKit(p.compra.itens, p.compra.documentos).ativos.map((i) => i.id)).toEqual(['m', 'i']);
    expect(statusDoMaterial(p.compra.itens, p.compra.documentos)).toMatchObject({ total: 0, completo: false });
    expect(materialDaCompra(p, [])).toEqual({ com_origem: 0, total: 2 });   // só o kit comprado conta (sem fornecedor e valor: 0 de 2)
    expect(equipamentoFinal(p.compra.itens, null, p.compra.documentos).modulos.map((m) => m.item_id)).toEqual(['m']);
    expect(itensParaTermo(p.compra.itens, p.compra.documentos).map((i) => i.id)).toEqual(['m', 'i']);
    // Um módulo SÓ orçado não basta para a Compra: sem módulo comprado o portão segue fechado.
    p.compra.itens = [orcado('orc-m', { tipo: 'modulo' }), kit(true)[1]];
    expect(portaoCompra(p)).toBe(false);
    expect(statusDoKit(p.compra.itens, p.compra.documentos).faltam).toEqual(['módulos']);
  });
  it('um ORÇAMENTO lido cria o item como orçado; a NOTA depois o tira do orçado e o faz contar', () => {
    let n = 0;
    const ctx = { por: 'thiago', agora: AGORA, novoId: (pf: string) => `${pf}-${++n}00000` };
    const doc = (tipo: DocLido['tipo']): DocLido => ({ tipo, fornecedor: 'Loja', numero: '9', chave: null, data: '2026-11-18', total_centavos: 5_000, origem: 'ia', itens: [{ descricao: 'Cabo solar 6 mm preto', quantidade: 100, unidade: 'm', valor_unitario_centavos: 50, valor_total_centavos: 5_000 }] });
    const r = aplicarDocumentoNaCompra(obraPrivadaVazia(), doc('orcamento'), { nome: 'o.pdf', sha256: 'a'.repeat(64), path: 'fin/7/o.pdf' }, ctx);
    if ('repetido' in r) throw new Error('repetido');
    const novo = r.privada.compra.itens[0];
    expect(orcadoApenas(novo, r.privada.compra.documentos)).toBe(true);
    expect(materialDaCompra(r.privada, [])).toEqual({ com_origem: 0, total: 0 });
    const r2 = aplicarDocumentoNaCompra(r.privada, doc('nota_fiscal'), { nome: 'n.pdf', sha256: 'b'.repeat(64), path: 'fin/7/n.pdf' }, ctx);
    if ('repetido' in r2) throw new Error('repetido');
    expect(orcadoApenas(r2.privada.compra.itens[0], r2.privada.compra.documentos)).toBe(false);
    expect(materialDaCompra(r2.privada, []).total).toBe(1);
  });
});

describe('A3: `sugeridos` é só o kit da proposta; a lista pronta fica à parte', () => {
  it('módulos e inversor da proposta, nenhum item da lista pronta; sem proposta, nada', () => {
    const s = itensIniciais({ qtdPlacas: 10, modeloPlaca: 'Tsun TSM-600', potPlaca: 600, qtdInversor: 1, inversor: 'SAJ 6K' });
    expect(s.map((i) => [i.tipo, i.origem, i.id])).toEqual([['modulo', 'proposta', null], ['inversor', 'proposta', null]]);
    expect(s.every((i) => !i.comprado)).toBe(true);
    expect(itensIniciais(null)).toEqual([]);
    expect(LISTA_PRONTA).toHaveLength(15);   // a lista pronta inteira continua disponível (em `lista_pronta` da resposta)
  });
});

describe('A4: campos novos normalizados (carro, equipe do dia, observações finais)', () => {
  it('guarda com o limite e sem caractere de controle; sem o campo, texto vazio', () => {
    const base = obraPrivadaVazia();
    const n = normalizarObraPrivada({
      ...base,
      logistica: { cargas: [{ id: 'g-1', transporte: { motorista: 'Zé', carro: `Fiat Strada\u0007\n branca${'x'.repeat(200)}` } }] },
      obra: { ...base.obra, diario: [{ data: '2026-11-25', fotos: [], equipe: `Pablo\u0000 e 2 ajudantes${'y'.repeat(300)}` }] },
      entrega: { ...base.entrega, observacoes: `Cliente pediu${'z'.repeat(2000)}\u001b` },
    });
    expect(n.logistica.cargas[0].transporte.carro.startsWith('Fiat Strada')).toBe(true);
    expect(n.logistica.cargas[0].transporte.carro).not.toMatch(/[\u0000-\u001f]/);
    expect(n.logistica.cargas[0].transporte.carro.length).toBeLessThanOrEqual(80);
    expect(n.obra.diario[0].equipe.startsWith('Pablo')).toBe(true);
    expect(n.obra.diario[0].equipe).not.toMatch(/[\u0000-\u001f]/);
    expect(n.obra.diario[0].equipe.length).toBeLessThanOrEqual(160);
    expect(n.entrega.observacoes.startsWith('Cliente pediu')).toBe(true);
    expect(n.entrega.observacoes.length).toBeLessThanOrEqual(1000);
    const vazio = normalizarObraPrivada({ ...base, logistica: { cargas: [{ id: 'g-2' }] }, obra: { ...base.obra, diario: [{ data: '2026-11-25' }] } });
    expect([vazio.logistica.cargas[0].transporte.carro, vazio.obra.diario[0].equipe, vazio.entrega.observacoes]).toEqual(['', '', '']);
  });
});

describe('B1: o previsto da proposta trocado pelo comprado não fica no total do "material"', () => {
  it('placa comprada de outra marca fecha o material em N de N (não N de N+1)', () => {
    const p = obraPrivadaVazia();
    p.compra.compras = [{ id: 'c-1', fornecedor: 'Solar Centro', cidade: '', data: '2026-11-01', forma: '', nota_chega: 'anexada', nota: null }];
    const comprado = (id: string, tipo: ItemCompra['tipo'], valor: number) => item(id, { tipo, origem: 'arquivo', comprado: true, fornecedor: 'Solar Centro', valor_centavos: valor, data: '2026-11-01', compra_id: 'c-1' });
    p.compra.itens = [item('m-prev', { tipo: 'modulo', origem: 'proposta' }), comprado('m-real', 'modulo', 50_000), comprado('i', 'inversor', 20_000)];
    expect(materialDaCompra(p, [pago('c-1', 70_000)])).toEqual({ com_origem: 2, total: 2 });
    // Sem a troca (ninguém comprou o módulo), o previsto segue contando e o fechamento segue cobrando.
    p.compra.itens = [item('m-prev', { tipo: 'modulo', origem: 'proposta' }), comprado('i', 'inversor', 20_000)];
    expect(materialDaCompra(p, [pago('c-1', 20_000)])).toEqual({ com_origem: 1, total: 2 });
  });
});

describe('B3: pedido e depois a nota são UMA compra; a segunda nota do mesmo modelo não engole a quantidade', () => {
  let n = 0;
  const ctx = { por: 'thiago', agora: AGORA, novoId: (pf: string) => `${pf}-${++n}00000` };
  const modulo = (qtd: number) => ({ descricao: 'MODULO FOTOVOLTAICO TSUN 600W TSM-600', quantidade: qtd, unidade: 'un', valor_unitario_centavos: 50_000, valor_total_centavos: qtd * 50_000 });
  const doc = (tipo: DocLido['tipo'], itens: DocLido['itens'], fornecedor = 'Solar Centro'): DocLido => ({ tipo, fornecedor, numero: '77', chave: null, data: '2026-11-18', total_centavos: 100_000, itens, origem: 'ia' });
  const arq = (c: string, nome = 'x.pdf') => ({ nome, sha256: c.repeat(64), path: `fin/7/${c}.pdf` });
  const aplica = (p: ObraPrivada, d: DocLido, a: ReturnType<typeof arq>, extra: { compraId?: string; nfId?: string } = {}) => {
    const r = aplicarDocumentoNaCompra(p, d, a, { ...ctx, ...extra });
    if ('repetido' in r) throw new Error('repetido');
    return r;
  };

  it('PEDIDO e depois NOTA da mesma compra: a nota pendura na compra do pedido (nasce uma compra só)', () => {
    const r1 = aplica(obraPrivadaVazia(), doc('pedido', [modulo(10)]), arq('a', 'pedido.pdf'));
    expect(r1.privada.compra.compras).toHaveLength(1);
    expect(r1.privada.compra.compras[0].nota).toBeNull();
    const c1 = r1.privada.compra.compras[0].id;
    expect(compraExistenteDoDocumento(r1.privada, doc('nota_fiscal', [modulo(10)]))).toBe(c1);
    const r2 = aplica(r1.privada, doc('nota_fiscal', [modulo(10)]), arq('b', 'nota.pdf'), { nfId: 'nf-1' });
    expect(r2.privada.compra.compras).toHaveLength(1);
    expect(r2.privada.compra.compras[0]).toMatchObject({ id: c1, nota: { path: 'fin/7/b.pdf', nf_id: 'nf-1' } });
    expect(r2.resumo.compra_id).toBe(c1);
    expect(r2.privada.compra.itens).toHaveLength(1);   // o mesmo item, não uma linha nova
    expect(r2.privada.compra.itens[0].compra_id).toBe(c1);
    expect(r2.privada.compra.documentos.map((d) => d.compra_id)).toEqual([c1, c1]);
    // Quando a rota já registrou a nota com o id da compra existente, a mescla usa esse id.
    const r3 = aplica(r1.privada, doc('nota_fiscal', [modulo(10)]), arq('c'), { compraId: c1, nfId: 'nf-2' });
    expect(r3.privada.compra.compras).toHaveLength(1);
    expect(r3.privada.compra.compras[0].nota?.nf_id).toBe('nf-2');
  });

  it('segunda NOTA do mesmo modelo: compra própria e linha própria, cada uma com a sua quantidade (nada é somado nem sobrescrito)', () => {
    const r1 = aplica(obraPrivadaVazia(), doc('nota_fiscal', [modulo(10)]), arq('a'), { nfId: 'nf-1' });
    const r2 = aplica(r1.privada, doc('nota_fiscal', [modulo(4)], 'Outro Forn'), arq('b'), { nfId: 'nf-2' });
    const mods = r2.privada.compra.itens.filter((i) => i.tipo === 'modulo');
    expect(mods.map((m) => m.quantidade)).toEqual([10, 4]);
    expect(mods.map((m) => m.valor_centavos)).toEqual([500_000, 200_000]);
    expect(r2.privada.compra.compras).toHaveLength(2);
    expect(mods[0].compra_id).not.toBe(mods[1].compra_id);
    expect(mods[1].compra_id).toBe(r2.resumo.compra_id);
    expect(r2.resumo).toMatchObject({ novos: 1, atualizados: 0 });
    // A primeira nota segue intacta.
    expect(r2.privada.compra.compras[0].nota?.nf_id).toBe('nf-1');
  });

  it('item previsto da proposta que ainda não foi comprado segue sendo preenchido pela primeira nota (não vira linha nova)', () => {
    const p = obraPrivadaVazia();
    p.compra.itens = [item('m', { tipo: 'modulo', origem: 'proposta', descricao: 'Módulo Tsun 600 W', modelo: 'Tsun TSM-600', quantidade: 10 })];
    const r = aplica(p, doc('nota_fiscal', [modulo(10)]), arq('a'));
    expect(r.privada.compra.itens).toHaveLength(1);
    expect(r.privada.compra.itens[0]).toMatchObject({ id: 'm', comprado: true });
  });
});

describe('B4: a abertura forçada (obra presa)', () => {
  it('conclui a etapa da vez, abre a seguinte e grava forcar + concluir + abrir com o nome de quem forçou', () => {
    const e = forcarEtapa(emObra(5), 5, AGORA, 'thiago');
    if (!e) throw new Error('recusou');
    expect(e.etapas[5]).toMatchObject({ concluida_em: AGORA, concluida_por: 'thiago' });
    expect(e.etapas[6].aberta_em).toBe(AGORA);
    expect(e.historico.slice(-3).map((h) => [h.acao, h.etapa, h.por])).toEqual([['forcar', 5, 'thiago'], ['concluir', 5, 'thiago'], ['abrir', 6, 'thiago']]);
    expect(etapaAtualCompleta(null, e, null)).toBe(6);
    expect(normalizarObraPrivada({ ...obraPrivadaVazia(), forcadas: [{ em: AGORA, por: 'thiago', etapa: 5, motivo: 'Kit numa linha só' }] }).forcadas).toEqual([{ em: AGORA, por: 'thiago', etapa: 5, motivo: 'Kit numa linha só' }]);
  });
  it('nunca volta nem pula: etapa que não é a da vez, já concluída ou com a conta fechada não muda', () => {
    expect(forcarEtapa(emObra(5), 6, AGORA, 'thiago')).toBeNull();     // a 6 ainda não é a da vez
    expect(forcarEtapa(emObra(6), 5, AGORA, 'thiago')).toBeNull();     // a 5 já foi concluída
    expect(forcarEtapa({ ...emObra(5), fechada: { em: AGORA, por: 'x' } }, 5, AGORA, 'thiago')).toBeNull();
  });
});

describe('B5: a visão do GET usa a data gravada, não "agora"', () => {
  it('`ultimoCarimbo` é o mais recente carimbo do estado e a visão com ele não muda de uma leitura para a outra', () => {
    const e = emObra(4);
    expect(ultimoCarimbo(e)).toBe(AGORA);
    expect(ultimoCarimbo(obraVazia(7))).toBeNull();
    const p = obraPrivadaVazia();
    p.compra.itens = kit(true);
    const a = aplicarPortoes(e, { privada: p, docsIds: new Set(), slots: new Map() }, ultimoCarimbo(e) ?? 'x', 'leitura');
    const b = aplicarPortoes(e, { privada: p, docsIds: new Set(), slots: new Map() }, ultimoCarimbo(e) ?? 'x', 'leitura');
    expect(a.etapas[5].aberta_em).toBe(AGORA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('serie do inversor no item da Compra', () => {
  it('é normalizada (texto limpo, 60 caracteres) e o equipamento final, o termo e o portão da Entrega a leem quando a da Entrega está vazia', () => {
    const base = obraPrivadaVazia();
    const n = normalizarObraPrivada({ ...base, compra: { compras: [], itens: [{ id: 'i-i', tipo: 'inversor', comprado: true, serie: `SN-${'9'.repeat(100)}` }, { id: 'i-m', tipo: 'modulo' }] } });
    expect(n.compra.itens[0].serie.startsWith('SN')).toBe(true);
    expect(n.compra.itens[0].serie.length).toBeLessThanOrEqual(60);
    expect(n.compra.itens[0].serie).not.toMatch(/[ -]/);
    expect(n.compra.itens[1].serie).toBe('');
    const itens = [item('m', { tipo: 'modulo', comprado: true }), item('i', { tipo: 'inversor', comprado: true, serie: 'INV-77' })];
    expect(serieDoInversor(itens)).toBe('INV-77');
    expect(equipamentoFinal(itens, null).inversores[0].serie).toBe('INV-77');
    expect(equipamentoFinal(itens, null, [], 'DA-ENTREGA').inversores[0].serie).toBe('DA-ENTREGA');   // a da Entrega vale primeiro
    // O portão da Entrega aceita a série do item quando a do monitoramento está vazia.
    const p = obraPrivadaVazia();
    p.compra.itens = itens;
    p.entrega.monitoramento = { app: 'a', conta: 'c', usina: 'u', online: true, serie: '', comissionamento: '' };
    p.entrega.cofre = { ...cifrar('s'), em: AGORA, por: 'diego' };
    expect(itensDaEtapaObra(7, { jo: emObra(7), privada: p, livro: livroDaObra({ lancamentos: [], ignoradas: 0, vendaCentavos: null, vendedor: 'x', regra: AJUSTES_PADRAO.comissoes.nilce, previsto: null, pendenciasDaObra: [], adm: true }), slots: new Map(), docsIds: new Set() }).find((i) => i.chave === 'monitoramento')?.feito).toBe(true);
    p.compra.itens = [item('i', { tipo: 'inversor', comprado: true })];
    expect(itensDaEtapaObra(7, { jo: emObra(7), privada: p, livro: livroDaObra({ lancamentos: [], ignoradas: 0, vendaCentavos: null, vendedor: 'x', regra: AJUSTES_PADRAO.comissoes.nilce, previsto: null, pendenciasDaObra: [], adm: true }), slots: new Map(), docsIds: new Set() }).find((i) => i.chave === 'monitoramento')?.feito).toBe(false);
  });
});

export type _Tipos = ObraPrivada;

describe('B7: a 1ª leitura com a compra vazia parte do kit da proposta', () => {
  let n = 0;
  const ctx = { por: 'thiago', agora: AGORA, novoId: (pf: string) => `${pf}-${++n}00000`, equip: { qtdPlacas: 10, modeloPlaca: 'Tsun TSM-600', potPlaca: 600, qtdInversor: 1, inversor: 'SAJ 6K' } };
  const linha = (descricao: string, quantidade: number, unit: number) => ({ descricao, quantidade, unidade: 'un', valor_unitario_centavos: unit, valor_total_centavos: quantidade * unit });
  const nota = (itens: DocLido['itens']): DocLido => ({ tipo: 'nota_fiscal', fornecedor: 'Solar Centro', numero: '88', chave: null, data: '2026-11-18', total_centavos: 900_000, itens, origem: 'ia' });
  const arq = { nome: 'nf.pdf', sha256: 'b'.repeat(64), path: 'fin/7/nf.pdf' };
  const aplica = (d: DocLido, equip: typeof ctx.equip | null = ctx.equip) => {
    const r = aplicarDocumentoNaCompra(obraPrivadaVazia(), d, arq, { ...ctx, equip });
    if ('repetido' in r) throw new Error('repetido');
    return r;
  };
  const MODULO = 'MODULO FOTOVOLTAICO TSUN 600W TSM-600';

  it('NF com o mesmo módulo e inversor: 2 itens da proposta atualizados e comprados; só o cabo é novo', () => {
    const r = aplica(nota([linha(MODULO, 10, 50_000), linha('Inversor SAJ 6K', 1, 200_000), linha('Cabo solar 6 mm preto', 100, 50)]));
    expect(r.resumo).toMatchObject({ atualizados: 2, novos: 1, marcados_comprados: 3 });
    const itens = r.privada.compra.itens;
    expect(itens.map((i) => [i.tipo, i.origem, i.comprado])).toEqual([['modulo', 'proposta', true], ['inversor', 'proposta', true], ['eletrico', 'arquivo', true]]);
    expect(itens[0]).toMatchObject({ quantidade: 10, valor_centavos: 500_000, documento_id: r.resumo.documento_id });
    expect(statusDoKit(itens, r.privada.compra.documentos)).toMatchObject({ completo: true, comprados: 2, total: 2 });
  });

  it('módulo de OUTRA marca: o previsto da proposta fica de fora e o kit fecha em N de N (não N de N+1)', () => {
    const r = aplica(nota([linha('MODULO FOTOVOLTAICO JINKO 550W JKM-550', 10, 50_000), linha('Inversor SAJ 6K', 1, 200_000)]));
    const itens = r.privada.compra.itens;
    expect(itens.filter((i) => i.tipo === 'modulo').map((i) => [i.origem, i.comprado])).toEqual([['proposta', false], ['arquivo', true]]);
    const kitSt = statusDoKit(itens, r.privada.compra.documentos);
    expect(kitSt).toMatchObject({ completo: true, comprados: 2, total: 2 });
    expect(itensQueContam(itens, r.privada.compra.documentos)).toHaveLength(2);
  });

  it('sem proposta nada é semeado: tudo entra como novo, como antes', () => {
    const r = aplica(nota([linha(MODULO, 10, 50_000)]), null);
    expect(r.resumo).toMatchObject({ atualizados: 0, novos: 1 });
    expect(r.privada.compra.itens.map((i) => i.origem)).toEqual(['arquivo']);
  });
});
