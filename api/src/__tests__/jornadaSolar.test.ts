import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  comissoesDaVenda, deduzirEtapa, diasUteisDepois, donosDaEtapa, estadoMaterializado, iniciais, itensDaEtapa, marcaDoRateio, podeConcluir,
  prazoDaEtapa, rateioDoCadastro, situacao, somarDiasUteis, totalDoRateio, veObra, type EstadoJornada, type PrivadoJornada,
} from '../services/gerador/jornadaSolar';
import {
  assinarJornada, jornadaAssinada, normalizarJornada, reiniciarLogsDaJornada, normalizarPrivado,
} from '../services/gerador/jornadaSolarBanco';
import { descricaoDoCartao } from '../services/gerador/trelloVendaSolar';
import type { Cadastro } from '../services/gerador/cadastroVenda';

// Regras puras da Jornada (fase 1, 05/11/2026). Sem banco e sem relógio. Dados inventados.

const AGORA = '2026-09-15T13:00:00.000Z';
const novo = (card = 10): EstadoJornada => ({
  ...estadoMaterializado(card, 'Nilce', 1, AGORA), origem: 'vendido', vendido_em: AGORA, vendido_por: 'nilce',
  historico: [{ em: AGORA, por: 'nilce', acao: 'vendido', etapa: 1 }],
});
const cad = (campos: Record<string, string>): Cadastro => ({
  v: 1, alteracoes: [], em: null,
  campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'x', em: AGORA, fonte: 'manual' }])),
} as unknown as Cadastro);

beforeEach(() => { process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste'; reiniciarLogsDaJornada(); delete process.env.SOLAR_ADM; delete process.env.SOLAR_SOCIOS; });
afterEach(() => { delete process.env.VINCULO_SOLAR_SECRET; });

/** Reordena as chaves como o jsonb: por tamanho e depois alfabética, em TODOS os níveis. */
const comoJsonb = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(comoJsonb);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a.length - b.length) || (a < b ? -1 : 1)).map(([k, x]) => [k, comoJsonb(x)]));
  }
  return v;
};
const invertido = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(invertido);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, invertido(x)]));
  return v;
};

describe('normalizarJornada', () => {
  it('é idempotente, descarta o que não conhece e segura as últimas 50 do histórico', () => {
    const e = novo();
    const sujo = {
      ...e, lixo: 'x', etapas: { ...e.etapas, 3: { ...e.etapas[3], trello: { url: 'https://evil.example/c/abcdef', criado_em: AGORA, por: 'x' } } },
      historico: Array.from({ length: 70 }, (_, i) => ({ em: AGORA, por: 'nilce', acao: i === 3 ? 'inventada' : 'concluir', etapa: 1 })),
    };
    const n = normalizarJornada(10, sujo)!;
    expect(JSON.stringify(normalizarJornada(10, n))).toBe(JSON.stringify(n));
    expect(JSON.stringify(n)).not.toContain('lixo');
    expect(n.etapas[3].trello).toBeNull();
    expect(n.historico.length).toBe(50);
    expect(n.historico.every((h) => h.acao === 'concluir')).toBe(true);
    expect(normalizarJornada(11, e)).toBeNull();
  });
  it('aceita o link do Trello no formato do quadro e nenhum outro', () => {
    const e = novo();
    e.etapas[3].trello = { url: 'https://trello.com/c/AbC123xY', criado_em: AGORA, por: 'thiago' };
    expect(normalizarJornada(10, e)!.etapas[3].trello?.url).toBe('https://trello.com/c/AbC123xY');
  });
});

describe('assinatura (HMAC com versão)', () => {
  it('o estado assinado volta igual, mesmo relido com as chaves embaralhadas em TODOS os níveis (inversas e como o jsonb guarda)', () => {
    const e = novo();
    e.etapas[3].protocolo = { numero: '0923-48117', em: '2026-09-23' };
    e.esperando = { motivo: 'cemig', ate: '2026-09-30', etapa: 3, em: AGORA, por: 'thiago' };
    const sig = assinarJornada(10, e)!;
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    for (const v of [{ ...e, sig }, { ...(invertido(e) as object), sig }, { ...(comoJsonb(e) as object), sig }]) {
      expect(jornadaAssinada(10, v)).toEqual(normalizarJornada(10, e));
    }
  });
  it('mexer em qualquer campo invalida; a assinatura de um card não vale em outro; sem segredo é null', () => {
    const e = novo();
    const sig = assinarJornada(10, e)!;
    const mexido = { ...e, vendedor: 'carla', sig };
    expect(jornadaAssinada(10, mexido)).toBeNull();
    expect(jornadaAssinada(10, { ...e, etapas: { ...e.etapas, 1: { ...e.etapas[1], concluida_em: AGORA } }, sig })).toBeNull();
    expect(jornadaAssinada(11, { ...normalizarJornada(11, { ...e, card: 11 }), sig })).toBeNull();
    delete process.env.VINCULO_SOLAR_SECRET;
    delete process.env.SUPABASE_SERVICE_KEY;
    expect(assinarJornada(10, e)).toBeNull();
  });
});

describe('dias úteis e situação', () => {
  it('os exemplos da SPEC', () => {
    expect(somarDiasUteis('2026-09-15', 2)).toBe('2026-09-17');
    expect(somarDiasUteis('2026-09-17', 3)).toBe('2026-09-22');
    expect(somarDiasUteis('2026-09-23', 15)).toBe('2026-10-15');   // 12/10 é feriado
    expect(somarDiasUteis('2026-09-18', 1)).toBe('2026-09-21');    // sexta + 1 = segunda
    expect(diasUteisDepois('2026-09-17', '2026-09-22')).toBe(3);
  });
  it('no prazo, vence hoje, atrasada 1, travada com 3 e com 5', () => {
    const e = novo();   // vendida 15/09 (terça): vence 17/09
    expect(prazoDaEtapa(1, e).vence).toBe('2026-09-17');
    expect(situacao(1, e, '2026-09-16')).toMatchObject({ tipo: 'no_prazo', texto: 'No prazo · vence 17/09' });
    expect(situacao(1, e, '2026-09-17')).toMatchObject({ tipo: 'vence_hoje', texto: 'Vence hoje' });
    expect(situacao(1, e, '2026-09-18')).toMatchObject({ tipo: 'atrasada', texto: 'Atrasada 1 dia', dias: 1 });
    expect(situacao(1, e, '2026-09-22')).toMatchObject({ tipo: 'travada', dias: 3 });
    expect(situacao(1, e, '2026-09-24')).toMatchObject({ tipo: 'travada', dias: 5, texto: 'Atrasada 5 dias · Travada' });
  });
  it('esperando antes da data; depois dela a cobrança conta do maior entre o prazo e a data; etapa 4 sem prazo', () => {
    const e = novo();
    e.esperando = { motivo: 'cliente', ate: '2026-09-25', etapa: 1, em: AGORA, por: 'nilce' };
    expect(situacao(1, e, '2026-09-24')).toMatchObject({ tipo: 'esperando', texto: 'Esperando até 25/09 · Cliente' });
    expect(situacao(1, e, '2026-09-25')).toMatchObject({ tipo: 'vence_hoje' });
    expect(situacao(1, e, '2026-09-28')).toMatchObject({ tipo: 'atrasada', dias: 1 });
    expect(situacao(4, e, '2026-12-01').tipo).toBe('sem_prazo');
  });
  it('etapa 3: protocolar até 2 dias úteis; com protocolo, 15 dias úteis da Cemig', () => {
    const e = novo();
    e.etapas[3].aberta_em = '2026-09-21T13:00:00.000Z';
    expect(prazoDaEtapa(3, e)).toEqual({ vence: '2026-09-23', rotulo: 'Protocolar até' });
    e.etapas[3].protocolo = { numero: '1', em: '2026-09-23' };
    expect(prazoDaEtapa(3, e)).toEqual({ vence: '2026-10-15', rotulo: 'Prazo da Cemig' });
  });
});

describe('itensDaEtapa', () => {
  const slotsOk = new Set(['fachada', 'padrao', 'disjuntor', 'conta_luz', 'documento_titular']);
  const base = (e: EstadoJornada | null, slots: Set<string>, c: Cadastro, privado: PrivadoJornada | null = null) => ({
    lig: { proposta: 'P1', venda: null }, slots, cad: c, privado, estado: e,
  });
  const privadoOk = (): PrivadoJornada => normalizarPrivado({
    v: 1, venda: { valor_centavos: 3890000, pagamento: [{ forma: 'pix', valor_centavos: 1167000, obs: '' }, { forma: 'financiamento', valor_centavos: 2723000, obs: 'BV' }],
      desconto_centavos: null, prazo_prometido: 'até 60 dias', nota: '', kit_confirmado: true, combinado_por: 'nilce', combinado_em: AGORA, editado: [] },
    cancelamento: null, descancelamentos: [],
  });
  const cadOk = () => cad({ nome: 'Marcos Andrade', endereco_ponto: 'Rua A, 10', telefone: '34999990000', email: 'a@b.c' });
  const falta = (itens: ReturnType<typeof itensDaEtapa>) => itens.filter((i) => !i.feito).map((i) => i.chave);
  const papeisGerados = (e: EstadoJornada) => {
    e.etapas[2].papeis = { contrato: { gerado_em: AGORA, por: 'nilce' }, procuracao: { gerado_em: AGORA, por: 'nilce' }, recibo: null };
  };
  it('etapa 1 (Venda): blocos cliente, venda e papeis, nesta ordem e com estas chaves; o kit NÃO está aqui', () => {
    const e = novo();
    const itens = itensDaEtapa(1, base(e, new Set(), cadOk(), privadoOk()));
    expect(itens.map((i) => [i.bloco, i.chave])).toEqual([
      ['cliente', 'nome'], ['cliente', 'endereco_usina'], ['cliente', 'telefone'], ['cliente', 'email'],
      ['venda', 'proposta'], ['venda', 'valor'], ['venda', 'prazo'],
      ['papeis', 'papel_contrato'], ['papeis', 'papel_procuracao'],
    ]);
    expect(itens.map((i) => i.texto)).toEqual([
      'Nome completo', 'Endereço da usina', 'Telefone de contato', 'E-mail do cliente', 'Proposta aceita ligada', 'Valor e forma de pagamento',
      'Prazo prometido ao cliente', 'Contrato gerado', 'Procuração gerada',
    ]);
    expect(itens.some((i) => i.chave === 'kit')).toBe(false);
    expect(itens.some((i) => i.chave === 'contrato_assinado')).toBe(false);   // o assinado é da etapa 2
    expect(falta(itens)).toEqual(['papel_contrato', 'papel_procuracao']);
  });
  it('etapa 1: contrato e procuração gerados vêm de etapas[2].papeis (recibo não é item); sem cadastro, o bloco cliente falta inteiro', () => {
    const e = novo();
    papeisGerados(e);
    const todos = itensDaEtapa(1, base(e, new Set(), cadOk(), privadoOk()));
    expect(falta(todos)).toEqual([]);
    expect(todos.some((i) => i.chave.includes('recibo'))).toBe(false);
    expect(falta(itensDaEtapa(1, base(e, new Set(), cad({}), privadoOk())))).toEqual(['nome', 'endereco_usina', 'telefone', 'email']);
    expect(falta(itensDaEtapa(1, base(null, new Set(), cadOk(), null)))).toEqual(['valor', 'prazo', 'papel_contrato', 'papel_procuracao']);
  });
  it('etapa 2 (Documentos e vistoria): documentos, fotos e os DOIS papéis assinados (contrato e procuração), no bloco portao', () => {
    const e = novo();
    e.etapas[1].excedente = 'nao';
    const itens = itensDaEtapa(2, base(e, new Set(), cadOk()));
    expect(itens.map((i) => [i.bloco, i.chave])).toEqual([
      ['documentos', 'documento'], ['documentos', 'conta_luz'], ['documentos', 'excedente'],
      ['fotos', 'fachada'], ['fotos', 'padrao'], ['fotos', 'disjuntor'], ['fotos', 'medidor'], ['portao', 'contrato_assinado'], ['portao', 'procuracao'],
    ]);
    expect(itens.find((i) => i.chave === 'procuracao')!.texto).toBe('Procuração assinada anexada');
    expect(falta(itens)).toEqual(['documento', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor', 'contrato_assinado', 'procuracao']);
    expect(itens.find((i) => i.chave === 'contrato_assinado')!.texto).toBe('Contrato assinado anexado');
    expect(falta(itensDaEtapa(2, base(e, new Set([...slotsOk, 'medidor', 'procuracao']), cadOk())))).toEqual(['contrato_assinado']);
    expect(falta(itensDaEtapa(2, base(e, new Set([...slotsOk, 'medidor', 'procuracao', 'contrato_assinado']), cadOk())))).toEqual([]);
  });
  it('etapa 2: conta_excedente só entra com excedente "sim" e conta o slot conta_luz_beneficiaria', () => {
    const e = novo();
    e.etapas[1].excedente = 'nao';
    expect(itensDaEtapa(2, base(e, new Set(), cadOk())).some((i) => i.chave === 'conta_excedente')).toBe(false);
    e.etapas[1].excedente = 'sim';
    const c = cad({ email: 'a@b.c', titular_conta: 'Marcos Andrade', benef_1_uc: '3012', benef_1_titular: 'Maria Andrade' });
    const sem = itensDaEtapa(2, base(e, slotsOk, c));
    expect(sem.find((i) => i.chave === 'conta_excedente')).toMatchObject({ bloco: 'documentos', texto: 'Conta de luz do excedente', feito: false });
    expect(sem.find((i) => i.chave === 'excedente')!.texto).toBe('Todas as contas do excedente no nome de Marcos Andrade');
    expect(itensDaEtapa(2, base(e, new Set([...slotsOk, 'conta_luz_beneficiaria']), c)).find((i) => i.chave === 'conta_excedente')!.feito).toBe(true);
  });
  it('excedente null falta; "nao" não pede beneficiária', () => {
    const e = novo();
    const c = cad({ email: 'a@b.c' });
    const ex = () => itensDaEtapa(2, base(e, slotsOk, c, privadoOk())).find((i) => i.chave === 'excedente')!;
    expect(ex()).toMatchObject({ feito: false, texto: 'Diga se tem excedente para outras contas' });
    e.etapas[1].excedente = 'nao';
    expect(ex().feito).toBe(true);
  });
  it('etapa 3: o bloco equipamento vem PRIMEIRO (kit, datasheets e KMZ) e o resto segue como era', () => {
    const e = novo();
    const itens = itensDaEtapa(3, base(e, new Set(), cadOk(), null));
    expect(itens.map((i) => [i.bloco, i.chave])).toEqual([
      ['equipamento', 'kit'], ['equipamento', 'datasheet_modulo'], ['equipamento', 'datasheet_inversor'], ['equipamento', 'kmz'],
      ['portao', 'trello'], ['portao', 'art'], ['portao', 'protocolo'], ['portao', 'parecer'],
    ]);
    expect(itens.slice(0, 4).map((i) => i.texto)).toEqual(['Todo o equipamento confirmado', 'Datasheet da placa', 'Datasheet do inversor', 'KMZ do local']);
    const tudo = itensDaEtapa(3, base(e, new Set(['datasheet_modulo', 'datasheet_inversor', 'kmz']), cadOk(), privadoOk())).slice(0, 4);
    expect(tudo.map((i) => i.feito)).toEqual([true, true, true, true]);
    const semKit = privadoOk();
    semKit.venda!.kit_confirmado = false;
    expect(itensDaEtapa(3, base(e, new Set(['kmz']), cadOk(), semKit))[0].feito).toBe(false);
  });
  it('etapa 3: o rateio que mudou depois da conferência volta a faltar; sem excedente o item não entra; engenheiro a pagar não trava', () => {
    const e = novo();
    const c = cad({ geradora_pct: '85', benef_1_uc: '3012', benef_1_pct: '15' });
    expect(itensDaEtapa(3, base(e, new Set(), c)).some((i) => i.chave === 'rateio')).toBe(false);
    e.etapas[1].excedente = 'sim';
    e.etapas[3].rateio = { conferido_em: AGORA, por: 'thiago', marca: marcaDoRateio(c) };
    const item = (cc: Cadastro) => itensDaEtapa(3, base(e, new Set(), cc)).find((i) => i.chave === 'rateio')!;
    expect(item(c).feito).toBe(true);
    expect(item(cad({ geradora_pct: '80', benef_1_uc: '3012', benef_1_pct: '20' })).feito).toBe(false);
    e.etapas[3].engenheiro = 'a_pagar';
    expect(itensDaEtapa(3, base(e, new Set(), c)).some((i) => i.chave.includes('engenheiro'))).toBe(false);
  });
  it('rateio: aceita vírgula e soma', () => {
    const c = cad({ geradora_pct: '85,5', benef_1_uc: '1', benef_1_pct: '14,5' });
    expect(totalDoRateio(rateioDoCadastro(c))).toBe(100);
  });
});

describe('comissões', () => {
  it('Nilce com R$ 38.900,00 dá 194.500, 77.800 e 77.800 centavos, tudo inteiro', () => {
    const { linhas, aviso } = comissoesDaVenda('Nilce', 3890000);
    expect(linhas.map((l) => [l.nome, l.papel, l.valor_centavos])).toEqual([['nilce', 'venda', 194500], ['thiago', 'socio', 77800], ['diego', 'socio', 77800]]);
    expect(aviso).toBeNull();
  });
  it('Diego, Thiago, Giovanna e um nome fora da tabela (com o aviso)', () => {
    expect(comissoesDaVenda('diego', 100000).linhas.map((l) => [l.nome, l.pb])).toEqual([['diego', 500], ['diego', 200], ['thiago', 200]]);
    expect(comissoesDaVenda('thiago', 100000).linhas.map((l) => [l.nome, l.pb])).toEqual([['thiago', 500], ['thiago', 200], ['diego', 200]]);
    expect(comissoesDaVenda('giovanna', 100000).linhas[0]).toMatchObject({ pb: 300, valor_centavos: 3000 });
    const x = comissoesDaVenda('Carla', 33333);
    expect(x.aviso).toBe('Regra padrão. Confirme com o Thiago.');
    expect(x.linhas.every((l) => Number.isInteger(l.valor_centavos))).toBe(true);
  });
});

describe('deduzirEtapa (venda antiga, sem estado)', () => {
  const v = (slots: string[], o: Partial<Parameters<typeof deduzirEtapa>[0]> = {}) => deduzirEtapa({ temNumero: false, slots: new Set(slots), ...o });
  it('cada linha da tabela', () => {
    expect(v([], { temNumero: true, planilha: 'concluida' })).toMatchObject({ etapa: 9, posvenda: true });
    expect(v([], { temNumero: true, planilha: 'vistoria' }).etapa).toBe(8);
    expect(v([], { temNumero: true, planilha: 'liberado' }).etapa).toBe(8);
    expect(v([], { temNumero: true, planilha: 'instalacao' }).etapa).toBe(6);
    expect(v([], { temNumero: true, planilha: 'material' }).etapa).toBe(4);
    expect(v([], { temNumero: true, planilha: 'projeto' }).etapa).toBe(3);
    expect(v(['contrato_assinado', 'procuracao'], { temNumero: true, planilha: 'venda' }).etapa).toBe(3);
    expect(v([], { temNumero: true })).toMatchObject({ trilho: 'sem_trilho', etapa: null });
    expect(v(['contrato_assinado', 'procuracao'], { temNumero: true, planilhaFora: true })).toMatchObject({ trilho: 'sem_trilho', etapa: null });
    expect(v(['contrato_assinado', 'procuracao']).etapa).toBe(2);
    const e2 = ['documento_titular', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor', 'procuracao'];
    // o par assinado OU as fotos e documentos da vistoria põem a venda na etapa 2; só com o par e COM número ela vai à 3
    expect(v(['fachada', 'padrao', 'disjuntor', 'medidor', 'conta_luz', 'documento_titular']).etapa).toBe(2);
    expect(v(['fachada', 'padrao', 'disjuntor', 'medidor', 'conta_luz', 'documento_titular_uc']).etapa).toBe(2);
    expect(v(['contrato_assinado']).etapa).toBe(1);   // só o contrato, sem a procuração nem as fotos
    expect(v(['procuracao', ...e2.slice(0, -1)]).etapa).toBe(2);
    // sem número, o par assinado (e até tudo da etapa 2) fica na etapa 2: o número nasce ao concluí-la e a etapa 3 só vem depois dele
    expect(v(['contrato_assinado', ...e2]).etapa).toBe(2);
    expect(v(['contrato_assinado', 'procuracao']).etapa).toBe(2);
    expect(v(['contrato_assinado', ...e2], { temNumero: true }).etapa).toBe(3);
    expect(v(['fachada']).etapa).toBe(1);
  });
});

describe('quem vê e quem conclui', () => {
  it('a Nilce vê só o que vendeu; Giovanna, Diego e Thiago veem tudo; vendedor forjado no estado não dá acesso', () => {
    expect(veObra('nilce', 'Nilce')).toBe(true);
    expect(veObra('nilce', 'Carla')).toBe(false);
    for (const n of ['giovanna', 'diego', 'thiago']) expect(veObra(n, 'Carla')).toBe(true);
    // o estado forjado diz vendedor 'carla', mas veObra recebe o vendedor do CARD
    const forjado = novo();
    forjado.vendedor = 'carla';
    expect(veObra('carla', 'Nilce')).toBe(false);
    expect(donosDaEtapa(1, 'Nilce')).toEqual(['nilce']);
    expect(iniciais('Nilce')).toBe('NI');
  });
  it('podeConcluir: o dono da etapa; a 4 é só do Thiago', () => {
    expect(podeConcluir('nilce', 1, 'Nilce')).toBe(true);
    expect(podeConcluir('giovanna', 1, 'Nilce')).toBe(false);
    expect(podeConcluir('giovanna', 2, 'Nilce')).toBe(true);
    expect(podeConcluir('thiago', 3, 'Nilce')).toBe(true);
    expect(podeConcluir('diego', 4, 'Nilce')).toBe(false);
    expect(podeConcluir('thiago', 4, 'Nilce')).toBe(true);
  });
});

describe('descrição do cartão com o rateio', () => {
  const rateio = [
    { papel: 'geradora' as const, uc: '111', titular: 'Ana', pct: 85 },
    { papel: 'beneficiaria' as const, uc: '222', titular: 'Ana', pct: 15 },
  ];
  const a = { telefone: '34988880001', email: 'a@b.c', ligacao: '', equip: null };
  it('sem beneficiária a saída é igual à de hoje; privado leva o titular; público não', () => {
    expect(descricaoDoCartao({ ...a, rateio: [rateio[0]] })).toBe(descricaoDoCartao(a));
    expect(descricaoDoCartao({ ...a, rateio })).toContain('Beneficiária · UC 222 · Ana · 15%');
    expect(descricaoDoCartao({ ...a, rateio })).toContain('Geradora · UC 111 · Ana · 85%');
    const pub = descricaoDoCartao({ ...a, rateio, publico: true });
    expect(pub).toContain('Beneficiária · UC 222 · 15%');
    expect(pub).not.toContain('Ana');
  });
});
