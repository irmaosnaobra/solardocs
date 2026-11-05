import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chaveNfeValida, etapaAtualCompleta, itensDaEtapaObra, materialDaCompra, obraMaterializada, pendenciasDaObra, prazoDaEtapaObra, situacaoObra,
  type EstadoObra, type ItemCompra, type ObraPrivada,
} from '../services/gerador/jornadaObra';
import { estadoMaterializado, situacao, situacaoComPrazo, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { obraPrivadaVazia, obraVazia } from '../services/gerador/jornadaObraBanco';
import { AJUSTES_PADRAO, categoriaObra, livroDaObra, type LancamentoObra } from '../services/gerador/jornadaDinheiro';
import { camposDoTermo, termoGarantiaHtml, travaDoBook } from '../services/gerador/termoGarantia';
import { cifrar, decifrar } from '../services/gerador/cofreObra';
import { limparNota } from '../services/gerador/notaLeitura';

// As etapas 4 a 8 da Jornada, Fase 2 (06/11/2026): regras puras, sem banco e sem relógio. Dados inventados.

const AGORA = '2026-10-14T15:00:00.000Z';
beforeEach(() => { process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste'; delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS; });
afterEach(() => { delete process.env.VINCULO_SOLAR_SECRET; });

const js = (etapa = 4): EstadoJornada => ({ ...estadoMaterializado(7, 'Nilce', etapa, AGORA), origem: 'vendido', vendido_em: AGORA, vendido_por: 'nilce' });

describe('etapa atual completa e materialização', () => {
  it('a Fase 1 manda de 1 a 3; com `jornada_obra`, a primeira de 4 a 8 sem conclusão; tudo concluído é 9; sem estado, a deduzida', () => {
    expect(etapaAtualCompleta(js(2), null, null)).toBe(2);
    expect(etapaAtualCompleta(js(3), obraVazia(7), 6)).toBe(3);
    expect(etapaAtualCompleta(js(4), null, null)).toBe(4);
    const jo = obraMaterializada(7, 6, AGORA, AGORA);
    expect(etapaAtualCompleta(js(4), jo, null)).toBe(6);
    expect(etapaAtualCompleta(null, jo, null)).toBe(6);
    expect(etapaAtualCompleta(null, null, 5)).toBe(5);
    expect(etapaAtualCompleta(null, null, null)).toBeNull();
    expect(etapaAtualCompleta(js(4), obraMaterializada(7, 9, AGORA, AGORA), null)).toBe(9);
  });
  it('`obraMaterializada` da 4 à 8: as anteriores concluídas por `leitura`, a n aberta, as seguintes fechadas', () => {
    for (const n of [4, 5, 6, 7, 8]) {
      const e = obraMaterializada(7, n, '2026-10-10T10:00:00.000Z', AGORA);
      for (const i of [4, 5, 6, 7, 8] as const) {
        if (i < n) expect(e.etapas[i]).toMatchObject({ concluida_em: AGORA, concluida_por: 'leitura' });
        else if (i === n) expect(e.etapas[i]).toMatchObject({ concluida_em: null });
        else expect(e.etapas[i]).toEqual({ aberta_em: null, concluida_em: null, concluida_por: '' });
      }
      expect(e.etapas[4].aberta_em).toBe('2026-10-10T10:00:00.000Z');
      expect(e.historico[0]).toMatchObject({ acao: 'materializada', etapa: n });
    }
  });
  it('`situacaoComPrazo` tem a mesma saída do `situacao` da Fase 1 em todos os casos', () => {
    const e = js(2);
    for (const hoje of ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-23']) {
      for (const n of [1, 2, 3]) {
        expect(situacao(n, e, hoje)).toEqual(situacao(n, e, hoje));
      }
    }
    const esp = { motivo: 'cemig' as const, ate: '2026-10-20' };
    expect(situacaoComPrazo('2026-10-15', null, false, '2026-10-14')).toEqual({ tipo: 'no_prazo', texto: 'No prazo · vence 15/10', vence: '2026-10-15' });
    expect(situacaoComPrazo('2026-10-15', null, false, '2026-10-15')).toMatchObject({ tipo: 'vence_hoje' });
    expect(situacaoComPrazo('2026-10-15', null, false, '2026-10-16')).toMatchObject({ tipo: 'atrasada', dias: 1 });
    expect(situacaoComPrazo('2026-10-15', null, false, '2026-10-20')).toMatchObject({ tipo: 'travada' });
    expect(situacaoComPrazo('2026-10-15', esp, false, '2026-10-16')).toEqual({ tipo: 'esperando', texto: 'Esperando até 20/10 · Cemig' });
    expect(situacaoComPrazo(null, null, false, '2026-10-16')).toEqual({ tipo: 'sem_prazo', texto: 'Sem prazo' });
    expect(situacaoComPrazo('2026-10-15', null, true, '2026-10-16')).toEqual({ tipo: 'sem_prazo', texto: '' });
    // E o `situacao` antigo, que agora chama o novo, continua dando o que dava.
    const e2 = { ...js(2), esperando: { motivo: 'cliente' as const, ate: '2026-10-20', etapa: 2 as const, em: AGORA, por: 'giovanna' } };
    expect(situacao(2, e2, '2026-10-16')).toEqual({ tipo: 'esperando', texto: 'Esperando até 20/10 · Cliente' });
    expect(situacao(2, null, '2026-10-16')).toEqual({ tipo: 'sem_prazo', texto: '' });
  });
});

describe('prazos das etapas 4 a 8', () => {
  const jo = (mut: (e: EstadoObra) => void = () => undefined): EstadoObra => { const e = obraMaterializada(7, 4, AGORA, AGORA); mut(e); return e; };
  it('4: 2 dias úteis; 7: 1 dia útil; os dois contam do dia (de Brasília) em que abriram', () => {
    expect(prazoDaEtapaObra(4, js(4), jo())).toEqual({ vence: '2026-10-16', rotulo: 'Prazo' });
    const e7 = jo((e) => { e.etapas[7] = { aberta_em: '2026-10-23T15:00:00.000Z', concluida_em: null, concluida_por: '' }; });
    expect(prazoDaEtapaObra(7, js(4), e7)).toEqual({ vence: '2026-10-26', rotulo: 'Prazo' });   // sexta 23/10 + 1 dia útil = segunda 26/10
  });
  it('5: o dia útil anterior ao primeiro dia da obra; sem dias, sem prazo; 6: o último dia', () => {
    expect(prazoDaEtapaObra(5, js(4), jo()).vence).toBeNull();
    expect(prazoDaEtapaObra(5, js(4), jo()).rotulo).toBe('Marque os dias da obra na etapa 6');
    const e = jo((x) => { x.dias_obra = [{ data: '2026-10-26', equipe: 'pablo' }, { data: '2026-10-27', equipe: 'pablo' }]; });
    expect(prazoDaEtapaObra(5, js(4), e)).toEqual({ vence: '2026-10-23', rotulo: 'Material na obra até' });   // segunda: o útil anterior é sexta
    expect(prazoDaEtapaObra(6, js(4), e)).toEqual({ vence: '2026-10-27', rotulo: 'Último dia da obra' });
    expect(prazoDaEtapaObra(6, js(4), jo()).vence).toBeNull();
  });
  it('8: sem pedido, 1 dia útil para pedir; com pedido, 7 dias úteis a contar do pedido (feriado no meio empurra um dia)', () => {
    const e8 = jo((x) => { x.etapas[8] = { aberta_em: '2026-10-14T15:00:00.000Z', concluida_em: null, concluida_por: '' }; });
    expect(prazoDaEtapaObra(8, js(4), e8)).toEqual({ vence: '2026-10-15', rotulo: 'Pedir até' });
    const com = jo((x) => { x.pedido = { numero: '1026-50392', em: '2026-10-26' }; });
    expect(prazoDaEtapaObra(8, js(4), com)).toEqual({ vence: '2026-11-05', rotulo: 'Prazo da Cemig' });   // sem feriado seria 04/11; 02/11 (Finados) não conta
    expect(prazoDaEtapaObra(1, js(4), com)).toEqual({ vence: null, rotulo: '' });
  });
  it('`situacaoObra`: conta fechada ou etapa concluída é `sem_prazo`; a espera da etapa vale', () => {
    const e = obraMaterializada(7, 5, AGORA, AGORA);
    expect(situacaoObra(4, js(4), e, '2026-12-01')).toEqual({ tipo: 'sem_prazo', texto: '' });
    expect(situacaoObra(4, js(4), null, '2026-10-14')).toMatchObject({ tipo: 'no_prazo' });
    const esp = { ...e, esperando: { motivo: 'fornecedor' as const, ate: '2026-10-20', etapa: 5 as const, em: AGORA, por: 'diego' } };
    expect(situacaoObra(5, js(4), esp, '2026-10-16')).toEqual({ tipo: 'esperando', texto: 'Esperando até 20/10 · Fornecedor' });
    expect(situacaoObra(5, js(4), { ...esp, fechada: { em: AGORA, por: 'thiago' } }, '2026-10-16')).toEqual({ tipo: 'sem_prazo', texto: '' });
  });
});

// ── O portão ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const item = (id: string, o: Partial<ItemCompra> = {}): ItemCompra => ({
  id, origem: 'manual', tipo: 'outro', descricao: id, quantidade: 1, unidade: 'un', marca: '', modelo: '', potencia_w: null, potencia_kw: null,
  garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null, compra_id: null, fornecedor: '', valor_centavos: null, data: null,
  etapa: 4, criado_por: 'thiago', criado_em: AGORA, ...o,
});
const lanc = (compra: string | null, valor: number, o: { estorno?: string } = {}): LancamentoObra => {
  const cat = categoriaObra('saida', 'material')!;
  return {
    id: `lan-${Math.random().toString(16).slice(2, 10)}`, card_id: 7, tipo: 'saida', categoria: 'material', valor_centavos: valor, data: '2026-10-15', forma: 'pix', descricao: '', contraparte: '',
    id_transacao: '', arquivo: { path: 'fin/7/202610/x.pdf', nome: 'x', tipo: 'application/pdf', tamanho: 1, sha256: 'a'.repeat(64) }, origem: 'manual', lido_pela_ia: null,
    criado_por: 'thiago', criado_em: AGORA, alteracoes: [], apagado: false, apagado_por: '', apagado_em: '', motivo_apagado: '',
    obra: { v: 1, etapa: 4, grupo: cat.grupo, conferencia: 'bateu', estorno_de: o.estorno ?? null, motivo_estorno: o.estorno ? 'erro' : '', devolucao: false, comissao: null, compra_id: compra, carga_id: null }, sig: 'x',
  };
};
const livroDe = (p: ObraPrivada, ls: LancamentoObra[]) => livroDaObra({
  lancamentos: ls, ignoradas: 0, vendaCentavos: 3_890_000, vendedor: 'nilce', regra: AJUSTES_PADRAO.comissoes.nilce, previsto: null,
  pendenciasDaObra: pendenciasDaObra(p, ls), material: materialDaCompra(p, ls), adm: true,
});
const fonte = (p: ObraPrivada, ls: LancamentoObra[], jo: EstadoObra | null = null, slots: Record<string, string[]> = {}, docs: string[] = []) =>
  ({ jo, privada: p, livro: livroDe(p, ls), slots: new Map(Object.entries(slots)), docsIds: new Set(docs) });
const texto = (n: number, f: ReturnType<typeof fonte>, chave: string) => itensDaEtapaObra(n, f).find((i) => i.chave === chave)!;

/** A Compra do exemplo da SPEC: 11 itens, 5 com origem, valor e data. */
function compra11(): { p: ObraPrivada; ls: LancamentoObra[] } {
  const p = obraPrivadaVazia();
  p.compra.compras = [
    { id: 'c-1', fornecedor: 'Distribuidora Solar Centro', cidade: 'Uberlândia', data: '2026-10-15', forma: 'boleto', nota_chega: 'com_a_carga', nota: null },
    { id: 'c-2', fornecedor: 'Elétrica Central', cidade: 'Uberlândia', data: '2026-10-16', forma: 'cartao', nota_chega: 'anexada', nota: null },
  ];
  const pago = (id: string, i: number) => item(id, { compra_id: 'c-1', fornecedor: 'Distribuidora Solar Centro', valor_centavos: 100_000, data: '2026-10-15', descricao: `kit ${i}` });
  p.compra.itens = [
    ...[1, 2, 3, 4, 5].map((i) => pago(`i-${i}`, i)),
    ...[6, 7, 8, 9, 10, 11].map((i) => item(`i-${i}`, { compra_id: 'c-2', fornecedor: 'Elétrica Central', valor_centavos: 15_000, data: '2026-10-16' })),
  ];
  return { p, ls: [lanc('c-1', 500_000)] };
}

describe('o portão da Compra e das outras etapas', () => {
  it('Compra: "5 de 11" falta e "11 de 11" fecha; item sem data falta; compra paga a menos falta', () => {
    const { p, ls } = compra11();
    const f = fonte(p, ls);
    expect(texto(4, f, 'material')).toMatchObject({ feito: false, texto: 'Todo o material com origem, valor e data, um item por linha (5 de 11)' });
    expect(texto(4, f, 'comprovante').feito).toBe(false);   // a compra 2 ainda não tem lançamento
    const fecha = [...ls, lanc('c-2', 90_000)];
    expect(texto(4, fonte(p, fecha), 'material')).toMatchObject({ feito: true, texto: expect.stringContaining('11 de 11') });
    expect(texto(4, fonte(p, fecha), 'comprovante').feito).toBe(true);
    // Item sem data: sai do N.
    const semData = JSON.parse(JSON.stringify(p)) as ObraPrivada;
    semData.compra.itens[10].data = null;
    expect(texto(4, fonte(semData, fecha), 'material')).toMatchObject({ feito: false, texto: expect.stringContaining('10 de 11') });
    // Compra paga a menos: os 6 itens dela saem do N.
    expect(texto(4, fonte(p, [...ls, lanc('c-2', 80_000)]), 'material')).toMatchObject({ feito: false, texto: expect.stringContaining('5 de 11') });
    // Sem nenhum item: falta.
    expect(texto(4, fonte(obraPrivadaVazia(), []), 'material').feito).toBe(false);
    expect(texto(4, fonte(obraPrivadaVazia(), []), 'comprovante').feito).toBe(false);
  });

  it('Logística: nota faltando, avaria não resolvida e frete sem comprovante travam, cada um sozinho', () => {
    const { p } = compra11();
    const ls = [lanc('c-1', 500_000), lanc('c-2', 90_000)];
    const itens4 = p.compra.itens.map((i) => i.id);
    p.logistica.cargas = [{
      id: 'g-1', nome: 'Carga 1', itens: itens4, saida: { lugar: 'Uberlândia', em: '2026-10-20T08:00' }, chegada: { lugar: 'Obra', destino: 'obra', em: '2026-10-22T10:00' },
      transporte: { empresa: 'Frete Rápido Udi', motorista: 'Zé' }, compras: ['c-1', 'c-2'], recebido_por: { nome: 'Diego', assinatura_id: 'a-ass' },
      conferencia: { itens_ok: itens4, foto_id: 'a-conf' }, avaria: { tem: false, descricao: '', foto_id: '', o_que_fazer: '', resolvida: false },
      frete: { valor_centavos: 25_000, forma: 'pix' }, documentos: [],
    }];
    p.compra.compras = p.compra.compras.map((c) => ({ ...c, nota: { path: 'fin/7/x.pdf', sha256: 'a'.repeat(64), numero: '1', chave: '', nf_id: 'nf-1' } }));
    const docs = ['a-conf', 'a-ass'];
    const comFrete = [...ls, { ...lanc(null, 25_000), categoria: 'frete', obra: { ...lanc(null, 1).obra, etapa: 5, carga_id: 'g-1' } } as LancamentoObra];
    const tudo = fonte(p, comFrete, null, {}, docs);
    for (const c of ['cargas', 'conferencia', 'notas', 'avarias', 'frete']) expect(texto(5, tudo, c), c).toMatchObject({ feito: true });
    // Frete sem comprovante.
    expect(texto(5, fonte(p, ls, null, {}, docs), 'frete').feito).toBe(false);
    expect(livroDe(p, ls).a_pagar.map((x) => x.tipo)).toContain('frete');
    // Avaria não resolvida.
    const av = JSON.parse(JSON.stringify(p)) as ObraPrivada;
    av.logistica.cargas[0].avaria = { tem: true, descricao: 'caixa amassada', foto_id: '', o_que_fazer: 'trocar', resolvida: false };
    expect(texto(5, fonte(av, comFrete, null, {}, docs), 'avarias').feito).toBe(false);
    av.logistica.cargas[0].avaria.resolvida = true;
    expect(texto(5, fonte(av, comFrete, null, {}, docs), 'avarias').feito).toBe(true);
    // Nota faltando.
    const sn = JSON.parse(JSON.stringify(p)) as ObraPrivada;
    sn.compra.compras[1].nota = null;
    expect(texto(5, fonte(sn, comFrete, null, {}, docs), 'notas').feito).toBe(false);
    // Foto da conferência que sumiu do depósito.
    expect(texto(5, fonte(p, comFrete, null, {}, ['a-ass']), 'conferencia').feito).toBe(false);
    // Item da carga fora da conferência.
    const cf = JSON.parse(JSON.stringify(p)) as ObraPrivada;
    cf.logistica.cargas[0].conferencia.itens_ok = itens4.slice(1);
    expect(texto(5, fonte(cf, comFrete, null, {}, docs), 'conferencia').feito).toBe(false);
  });

  it('Obra: o diário do dia 2 sem saída trava (J06); equipe paga com comprovante', () => {
    const p = obraPrivadaVazia();
    p.obra.plano = [
      { data: '2026-10-23', inicio: '08:00', fim: '17:00', equipe: 'pablo', ajudantes: 2, servico: 'estrutura e placas' },
      { data: '2026-10-24', inicio: '08:00', fim: '17:00', equipe: 'pablo', ajudantes: 2, servico: 'ligação' },
    ];
    p.obra.diario = [
      { data: '2026-10-23', chegada: '08:00', saida: '17:00', fotos: ['f-1'], ocorrencia: '' },
      { data: '2026-10-24', chegada: '08:00', saida: '', fotos: ['f-2'], ocorrencia: '' },
    ];
    p.obra.checklist = Object.fromEntries(['estrutura', 'placas', 'strings', 'inversor', 'dps', 'aterramento', 'cabos', 'padrao'].map((k) => [k, true]));
    p.obra.equipe = { combinado_centavos: 165_000, descricao: '15 placas a R$ 110,00' };
    const docs = ['f-1', 'f-2'];
    const pgEquipe = (v: number) => ({ ...lanc(null, v), categoria: 'mao_de_obra', obra: { ...lanc(null, 1).obra, etapa: 6 } }) as LancamentoObra;
    expect(texto(6, fonte(p, [pgEquipe(165_000)], null, {}, docs), 'diario')).toMatchObject({ feito: false, texto: 'Diário dos 2 dias com fotos' });
    p.obra.diario[1].saida = '16:30';
    expect(texto(6, fonte(p, [pgEquipe(165_000)], null, {}, docs), 'diario').feito).toBe(true);
    expect(texto(6, fonte(p, [pgEquipe(165_000)], null, {}, ['f-1']), 'diario').feito).toBe(false);   // a foto do dia 2 sumiu
    expect(texto(6, fonte(p, [pgEquipe(165_000)], null, {}, docs), 'checklist').feito).toBe(true);
    expect(texto(6, fonte(p, [pgEquipe(165_000)], null, {}, docs), 'equipe').feito).toBe(true);
    expect(texto(6, fonte(p, [pgEquipe(82_500)], null, {}, docs), 'equipe').feito).toBe(false);
    expect(pendenciasDaObra(p, [pgEquipe(82_500)]).map((x) => x.tipo)).toEqual(['equipe']);
    p.obra.checklist.dps = false;
    expect(texto(6, fonte(p, [pgEquipe(165_000)], null, {}, docs), 'checklist').feito).toBe(false);
  });

  it('Entrega: 7 de 8 fotos trava; testes, monitoramento com o cofre e termo assinado', () => {
    const p = obraPrivadaVazia();
    const fotos = ['ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro', 'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo'];
    const slots = Object.fromEntries(fotos.slice(0, 7).map((s) => [s, [`a-${s}`]]));
    expect(texto(7, fonte(p, [], null, slots), 'fotos')).toMatchObject({ feito: false, texto: 'Fotos de tudo pronto (7 de 8)' });
    slots[fotos[7]] = ['a-ultima'];
    expect(texto(7, fonte(p, [], null, slots), 'fotos').feito).toBe(true);
    p.entrega.testes = { string1_voc: '412', string2_voc: '409', isolamento_ok: true, gerando_kw: '6,2', gerando_hora: '11:40', wifi_ok: true, disjuntores_ok: true };
    expect(texto(7, fonte(p, []), 'testes').feito).toBe(true);
    p.entrega.testes.wifi_ok = false;
    expect(texto(7, fonte(p, []), 'testes').feito).toBe(false);
    p.entrega.monitoramento = { app: 'iSolarCloud', conta: 'cliente@exemplo.com', usina: 'Casa', online: true, serie: 'INV-1', comissionamento: '' };
    expect(texto(7, fonte(p, []), 'monitoramento').feito).toBe(false);   // sem a senha no cofre
    p.entrega.cofre = { ...cifrar('senha'), em: AGORA, por: 'diego' };
    expect(texto(7, fonte(p, []), 'monitoramento').feito).toBe(true);
    p.entrega.termo = { assinado_em: AGORA, nome: 'Marcos', arquivo_id: 'a-ass', chk: ['sim', 'sim', 'sim', 'sim', 'sim', 'na'], ressalva: '' };
    expect(texto(7, fonte(p, [], null, {}, ['a-ass']), 'termo').feito).toBe(true);
    expect(texto(7, fonte(p, [], null, {}, []), 'termo').feito).toBe(false);
    p.entrega.termo.chk[2] = 'pend';
    expect(texto(7, fonte(p, [], null, {}, ['a-ass']), 'termo').feito).toBe(false);
    p.entrega.termo.ressalva = 'Falta o treinamento do app';
    expect(texto(7, fonte(p, [], null, {}, ['a-ass']), 'termo').feito).toBe(true);
  });

  it('Liberação: pedido com protocolo e print, vistoria, liberação e "a receber" diferente de zero trava', () => {
    const { p, ls } = compra11();
    const todos = [...ls, lanc('c-2', 90_000)];
    p.liberacao.passos = {
      pedido: { data: '2026-10-26', arquivo_id: 'a-ped' }, vistoria: { data: '2026-11-03', arquivo_id: 'a-vis' }, medidor: { data: '2026-11-05', arquivo_id: 'a-med' },
      liberada: { data: '2026-11-06', arquivo_id: 'a-lib' },
    };
    const jo = { ...obraVazia(7), pedido: { numero: '1026-50392', em: '2026-10-26' } };
    const docs = ['a-ped', 'a-vis', 'a-med', 'a-lib'];
    // Sem entrada: "a receber" é a venda inteira.
    expect(texto(8, fonte(p, todos, jo, {}, docs), 'dinheiro').feito).toBe(false);
    expect(texto(8, fonte(p, todos, jo, {}, docs), 'pedido').feito).toBe(true);
    const entrada = { ...lanc(null, 3_890_000), tipo: 'entrada', categoria: 'entrada', obra: { ...lanc(null, 1).obra, grupo: 'entrada', etapa: 2 } } as LancamentoObra;
    const paga = [
      ...todos, entrada,
      { ...lanc(null, 194_500), categoria: 'comissao_venda', obra: { ...lanc(null, 1).obra, etapa: 2, comissao: { nome: 'nilce', papel: 'venda' as const, pb: 500 } } },
      { ...lanc(null, 77_800), categoria: 'retirada_socio', obra: { ...lanc(null, 1).obra, etapa: 2, grupo: 'retirada' as const, comissao: { nome: 'thiago', papel: 'socio' as const, pb: 200 } } },
      { ...lanc(null, 77_800), categoria: 'retirada_socio', obra: { ...lanc(null, 1).obra, etapa: 2, grupo: 'retirada' as const, comissao: { nome: 'diego', papel: 'socio' as const, pb: 200 } } },
    ] as LancamentoObra[];
    for (const c of ['pedido', 'vistoria', 'liberacao', 'dinheiro', 'material']) expect(texto(8, fonte(p, paga, jo, {}, docs), c), c).toMatchObject({ feito: true });
    expect(texto(8, fonte(p, paga, { ...jo, pedido: null }, {}, docs), 'pedido').feito).toBe(false);
    expect(texto(8, fonte(p, paga, jo, {}, ['a-ped', 'a-vis']), 'liberacao').feito).toBe(false);
    expect(texto(8, fonte(p, paga, jo, {}, docs), 'vistoria').texto).toBe('Vistoria aprovada');
  });

  it('`pendenciasDaObra`: compra, equipe e frete', () => {
    const { p, ls } = compra11();
    expect(pendenciasDaObra(p, ls).map((x) => [x.tipo, x.valor_centavos])).toEqual([['compra', 90_000]]);
    expect(pendenciasDaObra(p, ls)[0].texto).toBe('Compra Elétrica Central: falta pagar R$ 900,00');
    expect(pendenciasDaObra(p, [...ls, lanc('c-2', 90_000)])).toEqual([]);
    // O estorno da compra volta a pendência.
    const pago = lanc('c-2', 90_000);
    expect(pendenciasDaObra(p, [...ls, pago, lanc('c-2', 90_000, { estorno: pago.id })]).map((x) => x.tipo)).toEqual(['compra']);
    p.logistica.cargas = [{ id: 'g-1', nome: 'Carga 1', frete: { valor_centavos: 25_000, forma: 'pix' } } as never];
    expect(pendenciasDaObra(p, [...ls, pago]).map((x) => x.tipo)).toEqual(['frete']);
    expect(pendenciasDaObra(null, [])).toEqual([]);
  });
});

describe('a chave de acesso da nota', () => {
  // O dígito verificador calculado de outro jeito (soma ponderada da esquerda para a direita, pesos invertidos).
  const comDv = (c43: string): string => {
    let soma = 0;
    for (let i = 0; i < 43; i++) soma += Number(c43[i]) * (2 + ((42 - i) % 8));
    const dv = 11 - (soma % 11);
    return c43 + String(dv >= 10 ? 0 : dv);
  };
  it('43 dígitos com o DV certo passam; trocar o último dígito reprova; 43 ou 45 dígitos reprovam', () => {
    for (const c43 of ['3126100123456700019055001000000123100000012', '3526109999999900010155001000004567100004567', '3126101111111111111155001000000001100000001']) {
      const ok = comDv(c43);
      expect(ok).toHaveLength(44);
      expect(chaveNfeValida(ok), ok).toBe(true);
      const ruim = ok.slice(0, 43) + String((Number(ok[43]) + 1) % 10);
      expect(chaveNfeValida(ruim)).toBe(false);
      expect(chaveNfeValida(ok.slice(0, 43))).toBe(false);
      expect(chaveNfeValida(ok + '0')).toBe(false);
    }
    expect(chaveNfeValida('abc')).toBe(false);
    expect(chaveNfeValida(null)).toBe(false);
  });
  it('a segunda conferência da leitura: chave inválida vale como não lida; valores viram centavos; até 60 itens', () => {
    const chave = comDv('3126100123456700019055001000000123100000012');
    const base = {
      eh_documento: true, tipo: 'nota_fiscal', emitente: 'Elétrica Central', cnpj_emitente: '12.345.678/0001-90', numero: '123', data: '2026-10-16', chave_acesso: chave, valor_total: 890,
      itens: [{ descricao: 'Cabo solar 6 mm', quantidade: 100, unidade: 'm', valor_unitario: 4.5, valor_total: 450 }], confianca: 'Alta',
    };
    const ok = limparNota(base, '2026-11-06');
    expect(ok.nota).toMatchObject({ tipo: 'nota_fiscal', chave, valor_total_centavos: 89_000, data: '2026-10-16', confianca: 'alta', cnpj: '12345678000190' });
    expect(ok.nota.itens[0]).toMatchObject({ valor_unitario_centavos: 450, valor_total_centavos: 45_000 });
    expect(limparNota({ ...base, chave_acesso: chave.slice(0, 43) + '9' }, '2026-11-06').nota.chave).toBeNull();
    expect(limparNota({ ...base, data: '2027-01-01' }, '2026-11-06').nota.data).toBeNull();
    expect(limparNota({ ...base, itens: Array.from({ length: 80 }, () => base.itens[0]) }, '2026-11-06').nota.itens).toHaveLength(60);
    expect(limparNota({ ...base, eh_documento: false }, '2026-11-06').eh_documento).toBe(false);
  });
});

describe('o Termo de garantia e a trava do Book', () => {
  const contrato = () => ({
    gerado_em: AGORA, por: 'giovanna', fonte: 'gerado' as const, versao_garantia: '2', garantia_modulos_anos: '25', garantia_inversor_anos: '10', garantia_instalacao_anos: '1',
    garantia_instalacao_unidade: 'anos', garantia_resposta_dias: '2', empresa_nome: 'AIOROS LTDA', empresa_cnpj: '63.636.043/0001-88', empresa_telefone: '(34) 90000-0000',
    cliente_nome: 'Marcos Vinícius Andrade', cliente_doc: '000.000.000-00', cliente_tipo: 'fisica', endereco_instalacao: 'Rua Exemplo, 100', cidade: 'Uberlândia', uf: 'MG',
    kwp: '8,25', quantidade_modulos: '15', marca_modulos: 'JA Solar', quantidade_inversores: '1', marca_inversor: 'SAJ',
  });
  const itens = (): ItemCompra[] => [
    item('i-1', { tipo: 'modulo', quantidade: 15, marca: 'JA Solar', modelo: 'JAM72S30', potencia_w: 550, garantia_fabricacao_anos: 12, garantia_desempenho_anos: 25 }),
    item('i-2', { tipo: 'inversor', quantidade: 1, marca: 'SAJ', modelo: 'R5 8K', potencia_kw: 8, garantia_anos: 10 }),
  ];
  const campos = (c = contrato(), its = itens()) => camposDoTermo({
    codigo: '#0065', privadaContrato: c, itensCompra: its, monitoramento: { serie: 'INV-8K-2610-4471' }, termoEntrega: { assinado_em: '2026-10-30T15:00:00.000Z' },
    contratoData: '2026-10-10', entregaYmd: '2026-10-30', responsavel: 'Diego',
  });

  it('com os campos da Parte B sai o texto da cláusula 4 v2', () => {
    const k = campos();
    expect(k).toMatchObject({ sistema_kwp: '8,25', data_entrega: '30/10/2026', instalacao_garantia_fim: '30/10/2027', contrato_data: '10/10/2026', prazo_resposta: '2 (dois) dias úteis', pj: false });
    const h = termoGarantiaHtml(k);
    for (const t of [
      '12 (doze) anos', '25 (vinte e cinco) anos', '10 (dez) anos', '1 (um) ano, até 30/10/2027', 'Sujeira acumulada por falta de limpeza dos módulos.',
      'Sobretensão ou sobrecarga da rede elétrica.', 'A garantia continua valendo para o resto da usina.', 'Obra #0065'.replace('Obra ', 'Obra '),
      '15 placas JA Solar JAM72S30, de 550 W cada, num total de 8,25 kWp.', 'número de série INV-8K-2610-4471', 'responde em até 2 (dois) dias úteis',
    ]) expect(h, t).toContain(t);
    expect(h).not.toContain('Sobretensão da rede.');
    expect(h).not.toContain('<script');
  });
  it('pessoa física tem a frase da lei e a empresa não; o 5º item de "como pedir" muda para empresa', () => {
    const pf = termoGarantiaHtml(campos());
    expect(pf).toContain('Essas garantias se somam à garantia que a lei dá.');
    expect(pf).toContain('A Irmãos na Obra fala com o fabricante por você, abre o pedido e acompanha até o conserto ou a troca.');
    const pj = termoGarantiaHtml(campos({ ...contrato(), cliente_tipo: 'juridica', cliente_doc: '12.345.678/0001-90' }));
    expect(pj).not.toContain('Essas garantias se somam à garantia que a lei dá.');
    expect(pj).toContain('A garantia dos equipamentos é dos fabricantes. A Irmãos na Obra ajuda você');
    expect(pj).toContain('CNPJ 12.345.678/0001-90');
  });
  it('todo texto sai escapado', () => {
    const c = { ...contrato(), cliente_nome: '<b>Marcos</b> & "Filho"' };
    const h = termoGarantiaHtml(campos(c));
    expect(h).toContain('&lt;b&gt;Marcos&lt;/b&gt; &amp; &quot;Filho&quot;');
    expect(h).not.toContain('<b>Marcos</b>');
    const x = termoGarantiaHtml(campos(contrato(), itens().map((i) => ({ ...i, modelo: '<script>alert(1)</script>' }))));
    expect(x).not.toContain('<script>alert');
    expect(x).toContain('&lt;script&gt;');
  });
  it('mais de um inversor: uma linha por inversor, com a garantia de cada um', () => {
    const its = [...itens(), item('i-3', { tipo: 'inversor', quantidade: 1, marca: 'Growatt', modelo: 'MIN 3000', potencia_kw: 3, garantia_anos: 5 })];
    const h = termoGarantiaHtml(campos(contrato(), its));
    expect(h).toContain('Inversor (SAJ)');
    expect(h).toContain('Inversor (Growatt):</b> garantia do fabricante de 5 (cinco) anos');
  });
  it('a trava: as 4 da SPEC J07, cada uma sozinha, e nenhuma com os dados da #0065', () => {
    const livre = (c = contrato(), its = itens(), assinado = true) => travaDoBook(campos(c, its), c, its, assinado);
    expect(livre()).toEqual([]);
    expect(livre({ ...contrato(), marca_modulos: 'Canadian' })).toEqual(['A marca das placas da Compra (JA Solar) é diferente da do contrato (Canadian).']);
    expect(livre({ ...contrato(), kwp: '8,8' })).toHaveLength(1);
    expect(livre({ ...contrato(), kwp: '8,8' })[0]).toContain('potência das placas');
    expect(livre({ ...contrato(), quantidade_modulos: '14' })[0]).toContain('quantidade de placas');
    expect(livre({ ...contrato(), garantia_inversor_anos: '5' })).toEqual(['A garantia do inversor da Compra (10 anos) é diferente da do contrato (5 anos).']);
    expect(livre({ ...contrato(), garantia_modulos_anos: '30' })).toEqual(['A garantia de desempenho das placas da Compra (25 anos) é diferente da do contrato (30 anos).']);
    expect(livre({ ...contrato(), garantia_instalacao_anos: '' })).toEqual(['O contrato não tem a garantia da instalação.']);
    // Faltas de dado.
    expect(livre(contrato(), itens().map((i) => (i.tipo === 'inversor' ? { ...i, garantia_anos: null } : i)))).toEqual(['Falta a garantia do inversor na Compra.']);
    expect(livre(contrato(), itens().map((i) => (i.tipo === 'modulo' ? { ...i, garantia_fabricacao_anos: null } : i)))).toEqual(['Falta a garantia de fabricação e de desempenho das placas na Compra.']);
    expect(livre(contrato(), itens(), false)).toEqual(['Falta o termo de entrega assinado.']);
    expect(livre({ ...contrato(), cliente_doc: '' })).toEqual(['O contrato não tem o nome ou o documento do cliente.']);
    expect(travaDoBook(campos(), null, itens(), true)).toHaveLength(1);
  });
});

describe('o cofre', () => {
  it('cifrar e decifrar voltam o texto; duas cifras do mesmo texto saem diferentes; tag mexida lança; o texto não aparece na cifra', () => {
    const a = cifrar('Senha-do-App#1');
    const b = cifrar('Senha-do-App#1');
    expect(decifrar(a)).toBe('Senha-do-App#1');
    expect(a.cifra).not.toBe(b.cifra);
    expect(a.iv).not.toBe(b.iv);
    expect(JSON.stringify(a)).not.toContain('Senha-do-App');
    const tag = Buffer.from(a.tag, 'base64');
    tag[0] ^= 1;
    expect(() => decifrar({ ...a, tag: tag.toString('base64') })).toThrow();
    const c = Buffer.from(a.cifra, 'base64');
    c[0] ^= 1;
    expect(() => decifrar({ ...a, cifra: c.toString('base64') })).toThrow();
  });
  it('trocar o segredo apaga o acesso (a rota responde "o cofre não abriu"); sem segredo lança', () => {
    const a = cifrar('abc');
    process.env.VINCULO_SOLAR_SECRET = 'outro-segredo';
    expect(() => decifrar(a)).toThrow();
    delete process.env.VINCULO_SOLAR_SECRET;
    const antes = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    try { expect(() => cifrar('x')).toThrow(); } finally { if (antes !== undefined) process.env.SUPABASE_SERVICE_KEY = antes; }
  });
});
