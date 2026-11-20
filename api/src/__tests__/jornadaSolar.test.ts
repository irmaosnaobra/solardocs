import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  CURTOS_ETAPA, NOMES_ETAPA, bancoPreenchido, comissoesDaVenda, confirmadosValidos, excedenteCpf, marcaDoValor, valorConfirmavel, vistoriaPct, deduzirEtapa, diasUteisDepois, donosDaEtapa, estadoMaterializado, iniciais, itensDaEtapa, marcaDoRateio, podeConcluir, concluiPorDaEtapa,
  prazoDaEtapa, rateioDoCadastro, situacao, somarDiasUteis, totalDoRateio, veObra, type ChaveConfirmar, type EstadoJornada, type PrivadoJornada,
} from '../services/gerador/jornadaSolar';
import type { BancoObra, VistoriaObra } from '../services/gerador/jornadaObra';
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
  const cadOk = () => cad({
    nome: 'Marcos Andrade', telefone: '34999990000', email: 'a@b.c', endereco_ponto: 'Rua A, 10', endereco: 'Rua B, 20', bairro: 'Centro', cidade: 'Uberlândia', uf: 'MG', cep: '38400000',
  });
  const equip = { qtdPlacas: 14, modeloPlaca: 'Canadian CS7N', potPlaca: 590, qtdInversor: 1, inversor: 'Growatt 10K' };
  const falta = (itens: ReturnType<typeof itensDaEtapa>) => itens.filter((i) => !i.feito).map((i) => i.chave);
  const papeisGerados = (e: EstadoJornada) => {
    e.etapas[2].papeis = { contrato: { gerado_em: AGORA, por: 'nilce' }, procuracao: { gerado_em: AGORA, por: 'nilce' }, recibo: null };
  };
  /** Confirma (com a marca em dia) cada chave pedida, como a rota /confirmar faz. */
  const confirma = (e: EstadoJornada, chaves: ChaveConfirmar[], f: ReturnType<typeof base>): void => {
    e.etapas[1].confirmados = Object.fromEntries(chaves.map((k) => [k, { em: AGORA, por: 'nilce', marca: marcaDoValor(k, valorConfirmavel(k, f)) }]));
  };
  const TODAS: ChaveConfirmar[] = ['nome', 'telefone', 'endereco', 'endereco_usina', 'email', 'placas', 'inversor', 'valor', 'pagamento'];
  it('etapa 1 (Venda): blocos cliente, venda, papeis, documentos, fotos e excedente, nesta ordem e com estas chaves; o kit NÃO está aqui', () => {
    const e = novo();
    const itens = itensDaEtapa(1, { ...base(e, new Set(), cadOk(), privadoOk()), equip });
    expect(itens.map((i) => [i.bloco, i.chave])).toEqual([
      ['cliente', 'nome'], ['cliente', 'telefone'], ['cliente', 'endereco'], ['cliente', 'endereco_usina'], ['cliente', 'email'],
      ['venda', 'proposta'], ['venda', 'prazo'], ['venda', 'placas'], ['venda', 'inversor'], ['venda', 'valor'], ['venda', 'pagamento'], ['venda', 'financiamento'],
      ['papeis', 'papel_contrato'], ['papeis', 'papel_procuracao'],
      ['documentos', 'documento'], ['documentos', 'conta_luz'], ['fotos', 'fachada'], ['fotos', 'padrao'], ['fotos', 'disjuntor'], ['fotos', 'medidor'],
      ['excedente', 'excedente'],
    ]);
    expect(itens.map((i) => i.texto)).toEqual([
      'Nome completo', 'Telefone de contato', 'Endereço completo', 'Endereço da usina', 'E-mail do cliente', 'Proposta aceita ligada', 'Prazo prometido ao cliente',
      'Placas: quantidade e marca', 'Inversor: quantidade e marca', 'Valor vendido', 'Forma de pagamento', 'Precisa de proposta de banco ou financiamento?',
      'Contrato gerado', 'Procuração gerada', 'CNH ou identidade', 'Conta de luz', 'Foto da fachada', 'Foto do padrão de entrada', 'Foto do disjuntor', 'Foto do medidor',
      'Diga se tem excedente para outras contas',
    ]);
    expect(itens.some((i) => i.chave === 'kit' || i.chave === 'contrato_assinado')).toBe(false);
  });
  it('etapa 1: dado presente SÓ fecha confirmado; mudou o valor, a confirmação deixa de valer e o item volta a pedir', () => {
    const e = novo();
    const f0 = { ...base(e, new Set(), cadOk(), privadoOk()), equip };
    expect(falta(itensDaEtapa(1, f0)).filter((k) => TODAS.includes(k as ChaveConfirmar))).toEqual(TODAS);   // tudo presente, nada confirmado
    confirma(e, TODAS, f0);
    const f1 = { ...f0, estado: e };
    expect(falta(itensDaEtapa(1, f1)).filter((k) => TODAS.includes(k as ChaveConfirmar))).toEqual([]);
    expect(Object.keys(confirmadosValidos(f1)).sort()).toEqual([...TODAS].sort());
    // o cadastro mudou o telefone e o endereço da usina; a proposta trocou o inversor; o valor vendido mudou
    const mudou = privadoOk(); mudou.venda!.valor_centavos = 3890100; mudou.venda!.pagamento[0].valor_centavos += 100;
    const f2 = { ...f1, cad: cad({ nome: 'Marcos Andrade', telefone: '34988880000', email: 'a@b.c', endereco_ponto: 'Rua Nova, 1', endereco: 'Rua B, 20', bairro: 'Centro', cidade: 'Uberlândia', uf: 'MG', cep: '38400000' }),
      equip: { ...equip, inversor: 'Fronius 10K' }, privado: mudou };
    expect(falta(itensDaEtapa(1, f2)).filter((k) => TODAS.includes(k as ChaveConfirmar))).toEqual(['telefone', 'endereco_usina', 'inversor', 'valor', 'pagamento']);
    expect(Object.keys(confirmadosValidos(f2)).sort()).toEqual(['email', 'endereco', 'nome', 'placas']);
    // sem o dado, a confirmação guardada não vale
    const f3 = { ...f1, cad: cad({}) };
    expect(falta(itensDaEtapa(1, f3))).toEqual(expect.arrayContaining(['nome', 'telefone', 'endereco', 'endereco_usina', 'email']));
    expect(valorConfirmavel('nome', f3)).toBe('');
    // endereço completo: faltando cidade, não é endereço
    expect(valorConfirmavel('endereco', { ...f1, cad: cad({ endereco: 'Rua B, 20', uf: 'MG' }) })).toBe('');
    // pagamento que não fecha com o valor não é confirmável
    const aberto = privadoOk(); aberto.venda!.pagamento[0].valor_centavos = 1;
    expect(valorConfirmavel('pagamento', { ...f1, privado: aberto })).toBe('');
    expect(valorConfirmavel('placas', { ...f1, equip: { ...equip, modeloPlaca: '' } })).toBe('');
  });
  it('etapa 1: financiamento fecha quando respondido (não, próprio ou financeira); só com "proprio" entra proposta_banco, que pede banco, agência e conta da obra', () => {
    const e = novo();
    const f = (fin: 'nao' | 'proprio' | 'financeira' | null, banco: BancoObra | null) => {
      if (fin) e.etapas[1].financiamento = fin; else delete e.etapas[1].financiamento;
      return { ...base(e, new Set(), cadOk(), privadoOk()), equip, obra: { vistoria: null, banco } };
    };
    const so = (x: ReturnType<typeof f>, chave: string) => itensDaEtapa(1, x).find((i) => i.chave === chave);
    expect(so(f(null, null), 'financiamento')).toMatchObject({ bloco: 'venda', feito: false });
    expect(so(f(null, null), 'proposta_banco')).toBeUndefined();
    expect(so(f('nao', null), 'financiamento')!.feito).toBe(true);
    expect(so(f('nao', null), 'proposta_banco')).toBeUndefined();
    expect(so(f('financeira', null), 'financiamento')!.feito).toBe(true);
    expect(so(f('financeira', null), 'proposta_banco')).toBeUndefined();
    const banco = { banco: 'BV', agencia: '0001', conta: '123-4', validade: '', prazo: '', origem: '', nota: '', desc: '', ger: '', eq_centavos: null, mo_centavos: null, fin: null };
    expect(so(f('proprio', null), 'financiamento')!.feito).toBe(true);
    expect(so(f('proprio', null), 'proposta_banco')).toMatchObject({ bloco: 'venda', texto: 'Proposta de banco preenchida', feito: false });
    expect(so(f('proprio', { ...banco, conta: ' ' }), 'proposta_banco')!.feito).toBe(false);
    expect(so(f('proprio', banco), 'proposta_banco')!.feito).toBe(true);
    expect(bancoPreenchido(banco)).toBe(true);
    expect(bancoPreenchido({ ...banco, agencia: '' })).toBe(false);
    expect(bancoPreenchido(null)).toBe(false);
  });
  it('etapa 1: financeira não acrescenta item nenhum (os documentos do titular são extras opcionais, não item); a etapa 2 também não', () => {
    const e = novo();
    const chaves = (n: 1 | 2, fin: 'nao' | 'proprio' | 'financeira'): string[] => {
      e.etapas[1].financiamento = fin;
      return itensDaEtapa(n, base(e, new Set(['documento_financiamento']), cadOk(), privadoOk())).map((i) => i.chave);
    };
    expect(chaves(1, 'financeira')).toEqual(chaves(1, 'nao'));
    expect(chaves(1, 'proprio')).toContain('proposta_banco');
    for (const fin of ['nao', 'proprio', 'financeira'] as const) {
      for (const n of [1, 2] as const) {
        expect(chaves(n, fin)).not.toContain('documento_financiamento');
        expect(chaves(n, fin)).not.toContain('comprovante_endereco_financiamento');
      }
    }
  });
  it('etapa 1: contrato e procuração gerados vêm de etapas[2].papeis (recibo não é item)', () => {
    const e = novo();
    expect(falta(itensDaEtapa(1, base(e, new Set(), cadOk(), privadoOk())))).toEqual(expect.arrayContaining(['papel_contrato', 'papel_procuracao']));
    papeisGerados(e);
    const todos = itensDaEtapa(1, base(e, new Set(), cadOk(), privadoOk()));
    expect(falta(todos)).not.toEqual(expect.arrayContaining(['papel_contrato']));
    expect(falta(todos)).not.toEqual(expect.arrayContaining(['papel_procuracao']));
    expect(todos.some((i) => i.chave.includes('recibo'))).toBe(false);
  });
  it('etapa 1: o papel assinado anexado conta como papel gerado (obra feita fora do sistema)', () => {
    const e = novo();
    const feito = (slots: string[], chave: string): boolean => itensDaEtapa(1, base(e, new Set(slots), cadOk(), privadoOk())).find((i) => i.chave === chave)!.feito;
    expect(feito([], 'papel_contrato')).toBe(false);
    expect(feito([], 'papel_procuracao')).toBe(false);
    expect(feito(['contrato_assinado'], 'papel_contrato')).toBe(true);
    expect(feito(['contrato_assinado'], 'papel_procuracao')).toBe(false);
    expect(feito(['procuracao'], 'papel_procuracao')).toBe(true);
    expect(feito(['procuracao'], 'papel_contrato')).toBe(false);
  });
  it('etapa 1: documentos e fotos do cliente fecham pelo ARQUIVO (CNH vale com documento_titular ou documento_titular_uc); o tique de pedido não é mais item', () => {
    const e = novo();
    const docs = (slots: string[]) => itensDaEtapa(1, base(e, new Set(slots), cadOk(), privadoOk())).filter((i) => i.bloco === 'documentos' || i.bloco === 'fotos').map((i) => [i.bloco, i.chave, i.feito]);
    expect(docs([])).toEqual([['documentos', 'documento', false], ['documentos', 'conta_luz', false], ['fotos', 'fachada', false], ['fotos', 'padrao', false], ['fotos', 'disjuntor', false], ['fotos', 'medidor', false]]);
    expect(docs(['documento_titular_uc', 'conta_luz', 'medidor'])).toEqual([['documentos', 'documento', true], ['documentos', 'conta_luz', true], ['fotos', 'fachada', false], ['fotos', 'padrao', false], ['fotos', 'disjuntor', false], ['fotos', 'medidor', true]]);
    expect(docs(['documento_titular'])[0]).toEqual(['documentos', 'documento', true]);
    // o tique de pedido continua no estado, mas não vira nem fecha item algum
    e.etapas[1].pedidos = { pedido_fachada: { em: AGORA, por: 'nilce' }, pedido_cnh: { em: AGORA, por: 'nilce' } };
    expect(docs([])).toEqual([['documentos', 'documento', false], ['documentos', 'conta_luz', false], ['fotos', 'fachada', false], ['fotos', 'padrao', false], ['fotos', 'disjuntor', false], ['fotos', 'medidor', false]]);
    expect(itensDaEtapa(1, base(e, new Set(), cadOk(), privadoOk())).some((i) => i.bloco === 'pedidos' || i.chave.startsWith('pedido_'))).toBe(false);
  });
  it('etapa 1: vistoria fecha com 80% dos campos de texto, data e escolha preenchidos (fotos e adequações não contam)', () => {
    const e = novo();
    const v = (cheios: number): VistoriaObra => {
      const campos = ['data', 'quem', 'acomp', 'concl', 'obs'];
      const t = ['tipo', 'estado', 'orient', 'incl', 'area', 'sombra', 'estr', 'acesso'];
      const en = ['padrao', 'tensao', 'disj', 'apto', 'aterr', 'quadro'];
      const iv = ['local', 'dist', 'abrig', 'wifi'];
      const todos = [...campos.map((k) => ['', k]), ...t.map((k) => ['telhado', k]), ...en.map((k) => ['entrada', k]), ...iv.map((k) => ['inversor', k])];
      const r: any = { data: '', quem: '', acomp: '', concl: '', adeq: ['x', 'y'], obs: '', telhado: {}, entrada: {}, inversor: {}, fotos: [{ arquivo_id: 'a', leg: '', txt: '' }] };
      for (const k of ['tipo', 'estado', 'orient', 'incl', 'area', 'sombra', 'estr', 'acesso']) r.telhado[k] = '';
      for (const k of en) r.entrada[k] = '';
      for (const k of iv) r.inversor[k] = '';
      todos.slice(0, cheios).forEach(([g, k]) => { if (g) r[g][k] = 'x'; else r[k] = k === 'concl' ? 'ok' : 'x'; });
      return r as VistoriaObra;
    };
    const feito = (vis: VistoriaObra | null) => itensDaEtapa(2, { ...base(e, new Set(), cadOk(), privadoOk()), obra: { vistoria: vis, banco: null } }).find((i) => i.chave === 'vistoria')!.feito;
    expect(vistoriaPct(null)).toBe(0);
    expect(vistoriaPct(v(0))).toBe(0);   // fotos e adequações não contam
    expect(vistoriaPct(v(23))).toBe(100);
    expect(vistoriaPct(v(18))).toBe(78);
    expect(vistoriaPct(v(19))).toBe(82);
    expect(feito(v(18))).toBe(false);   // 78%
    expect(feito(v(19))).toBe(true);    // 82%
    expect(feito(null)).toBe(false);
    expect(itensDaEtapa(2, base(e, new Set(), cadOk(), privadoOk())).find((i) => i.chave === 'vistoria')!.feito).toBe(false);   // sem a obra lida
    expect(itensDaEtapa(1, base(e, new Set(), cadOk(), privadoOk())).some((i) => i.chave === 'vistoria')).toBe(false);   // a vistoria é da etapa 2
  });
  it('etapa 1: excedente com CPF das duas pontas compara só dígitos; diferente não fecha e diz para passar para o mesmo CPF; sem CPF vale o nome', () => {
    const e = novo();
    e.etapas[1].excedente = 'sim';
    const dono = { cpf_cnpj: '529.982.247-25', titular_conta: 'Marcos Andrade', benef_1_uc: '3012', benef_1_titular: 'Maria Andrade' };
    const item = (c: Record<string, string>, slots: string[] = []) => itensDaEtapa(1, base(e, new Set(slots), cad({ ...dono, ...c }))).filter((i) => i.bloco === 'excedente');
    // CPF igual (com e sem máscara): fecha mesmo com o nome da conta diferente
    expect(item({ benef_1_doc: '52998224725' })[0]).toMatchObject({ chave: 'excedente', feito: true });
    expect(excedenteCpf(cad({ ...dono, benef_1_doc: '52998224725' }), true)).toEqual({ ok: true, texto: null });
    // CPF diferente: não fecha, com o texto da regra, mesmo com o nome igual
    const outro = item({ benef_1_doc: '111.444.777-35', benef_1_titular: 'Marcos Andrade' })[0];
    expect(outro).toMatchObject({ feito: false, texto: 'Conta do excedente em outro CPF. Peça ao cliente para passar para o mesmo CPF.' });
    expect(excedenteCpf(cad({ ...dono, benef_1_doc: '11144477735' }), true)).toEqual({ ok: false, texto: 'Conta do excedente em outro CPF. Peça ao cliente para passar para o mesmo CPF.' });
    // sem CPF de um dos lados: regra de nome de hoje
    expect(item({})[0]).toMatchObject({ feito: false, texto: 'Todas as contas do excedente no nome de Marcos Andrade' });
    expect(excedenteCpf(cad(dono), true)).toEqual({ ok: null, texto: null });
    expect(item({ benef_1_titular: 'Marcos Andrade' })[0].feito).toBe(true);
    expect(excedenteCpf(cad({ ...dono, cpf_cnpj: '', benef_1_doc: '52998224725' }), true)).toEqual({ ok: null, texto: null });
    // homologação em nome de outra pessoa: vale o CPF do titular da homologação
    const tuc = { homologacao_mesmo: 'outra_pessoa', tuc_cpf_cnpj: '111.444.777-35', benef_1_doc: '11144477735' };
    expect(excedenteCpf(cad({ ...dono, ...tuc }), true)).toEqual({ ok: true, texto: null });
    expect(excedenteCpf(cad({ ...dono, ...tuc, benef_1_doc: '52998224725' }), true).ok).toBe(false);
    // conta_excedente só com "sim"; conta o slot conta_luz_beneficiaria
    expect(item({}).map((i) => [i.chave, i.feito])).toEqual([['excedente', false], ['conta_excedente', false]]);
    expect(item({}, ['conta_luz_beneficiaria']).find((i) => i.chave === 'conta_excedente')).toMatchObject({ bloco: 'excedente', texto: 'Conta de luz do excedente', feito: true });
    e.etapas[1].excedente = 'nao';
    expect(item({}).map((i) => [i.chave, i.feito])).toEqual([['excedente', true]]);
    expect(excedenteCpf(cad(dono), false)).toEqual({ ok: null, texto: null });
  });
  it('etapa 2 (Assinaturas e vistoria): o contrato e a procuração assinados e a vistoria 80%; os documentos e fotos são da etapa 1', () => {
    const e = novo();
    e.etapas[1].excedente = 'sim';
    const itens = itensDaEtapa(2, base(e, new Set([...slotsOk, 'medidor']), cadOk()));
    expect(itens.map((i) => [i.bloco, i.chave])).toEqual([['anexos', 'contrato_assinado'], ['anexos', 'procuracao'], ['vistoria', 'vistoria']]);
    expect(itens.map((i) => i.texto)).toEqual(['Contrato assinado anexado', 'Procuração assinada anexada', 'Relatório de vistoria 80% preenchido']);
    expect(falta(itens)).toEqual(['contrato_assinado', 'procuracao', 'vistoria']);
    expect(falta(itensDaEtapa(2, base(e, new Set([...slotsOk, 'medidor', 'procuracao']), cadOk())))).toEqual(['contrato_assinado', 'vistoria']);   // documentos e fotos já anexados não voltam como item
    expect(itensDaEtapa(2, base(e, new Set([...slotsOk, 'medidor', 'procuracao']), cadOk())).some((i) => i.bloco === 'pendentes')).toBe(false);
  });
  it('etapa 2: o que a etapa 1 (regra antiga) deixou sem arquivo volta como pendência da etapa 1, e a etapa não conclui até anexar', () => {
    const e = novo();
    const fechavel = ['procuracao', 'contrato_assinado'];
    const vis = { vistoria: null, banco: null };
    const sem = itensDaEtapa(2, { ...base(e, new Set(fechavel), cadOk()), obra: vis });
    expect(sem.filter((i) => i.bloco === 'pendentes').map((i) => [i.chave, i.texto, i.feito])).toEqual([
      ['documento', 'CNH ou identidade (pendente da etapa 1)', false], ['conta_luz', 'Conta de luz (pendente da etapa 1)', false],
      ['fachada', 'Foto da fachada (pendente da etapa 1)', false], ['padrao', 'Foto do padrão de entrada (pendente da etapa 1)', false],
      ['disjuntor', 'Foto do disjuntor (pendente da etapa 1)', false], ['medidor', 'Foto do medidor (pendente da etapa 1)', false],
    ]);
    // só a CNH falta: só ela aparece, e a etapa não conclui
    const soCnh = itensDaEtapa(2, { ...base(e, new Set([...fechavel, 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor']), cadOk()), obra: vis });
    expect(soCnh.filter((i) => i.bloco === 'pendentes').map((i) => i.chave)).toEqual(['documento']);
    expect(soCnh.filter((i) => i.bloco === 'pendentes').every((i) => !i.feito)).toBe(true);
    // com tudo anexado (CNH vale como documento_titular_uc também) nenhuma pendência sobra
    const tudo = itensDaEtapa(2, { ...base(e, new Set([...fechavel, 'documento_titular_uc', 'conta_luz', 'fachada', 'padrao', 'disjuntor', 'medidor']), cadOk()), obra: vis });
    expect(tudo.some((i) => i.bloco === 'pendentes')).toBe(false);
    expect(falta(tudo)).toEqual(['vistoria']);
  });
  it('etapa 2: o par assinado ainda é o que importa', () => {
    const e = novo();
    expect(falta(itensDaEtapa(2, base(e, new Set([...slotsOk, 'medidor', 'procuracao', 'contrato_assinado', 'outros']), cadOk())))).toEqual(['vistoria']);
    expect(NOMES_ETAPA[2]).toBe('Assinaturas e vistoria');
    expect(CURTOS_ETAPA[2]).toBe('Assinaturas');
  });
  it('etapa 3: o bloco equipamento vem PRIMEIRO (datasheets e KMZ; o kit saiu para a etapa 1) e o resto segue como era', () => {
    const e = novo();
    const itens = itensDaEtapa(3, base(e, new Set(), cadOk(), null));
    expect(itens.map((i) => [i.bloco, i.chave])).toEqual([
      ['equipamento', 'datasheet_modulo'], ['equipamento', 'datasheet_inversor'], ['equipamento', 'kmz'],
      ['portao', 'trello'], ['portao', 'art'], ['portao', 'protocolo'], ['portao', 'parecer'],
    ]);
    expect(itens.slice(0, 3).map((i) => i.texto)).toEqual(['Datasheet da placa', 'Datasheet do inversor', 'KMZ do local']);
    const tudo = itensDaEtapa(3, base(e, new Set(['datasheet_modulo', 'datasheet_inversor', 'kmz']), cadOk(), privadoOk())).slice(0, 3);
    expect(tudo.map((i) => i.feito)).toEqual([true, true, true]);
    const semKit = privadoOk();
    semKit.venda!.kit_confirmado = false;
    expect(itensDaEtapa(3, base(e, new Set(['kmz']), cadOk(), semKit)).some((i) => i.chave === 'kit')).toBe(false);
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
  it('podeConcluir: o dono da etapa; a 2 é do Thiago e do Diego; a 4 é só do Thiago', () => {
    expect(podeConcluir('nilce', 1, 'Nilce')).toBe(true);
    expect(podeConcluir('giovanna', 1, 'Nilce')).toBe(false);
    expect(podeConcluir('diego', 2, 'Nilce')).toBe(true);
    expect(podeConcluir('thiago', 2, 'Nilce')).toBe(true);
    expect(podeConcluir('giovanna', 2, 'Nilce')).toBe(false);   // saiu da Giovanna em 20/11
    expect(podeConcluir('nilce', 2, 'Nilce')).toBe(false);
    expect(podeConcluir('thiago', 3, 'Nilce')).toBe(true);
    expect(podeConcluir('diego', 4, 'Nilce')).toBe(false);
    expect(podeConcluir('thiago', 4, 'Nilce')).toBe(true);
    expect(podeConcluir('thiago', 10, 'Nilce')).toBe(false);    // etapa que não existe não conclui, nem para o ADM
  });
  it('podeConcluir: o ADM conclui qualquer etapa; quem não é dono nem ADM continua barrado', () => {
    const antes = process.env.SOLAR_ADM;
    process.env.SOLAR_ADM = 'thiago,carla';
    try {
      for (let n = 1; n <= 9; n++) expect(podeConcluir('carla', n, 'Nilce')).toBe(true);
      expect(podeConcluir('Carla', 2, 'Nilce')).toBe(true);
      expect(podeConcluir('giovanna', 3, 'Nilce')).toBe(false);
      expect(podeConcluir('nilce', 2, 'Nilce')).toBe(false);
      expect(podeConcluir('carla', 1, '')).toBe(true);   // etapa do vendedor sem vendedor conhecido: o ADM conclui
    } finally { if (antes === undefined) delete process.env.SOLAR_ADM; else process.env.SOLAR_ADM = antes; }
  });
  it('concluiPorDaEtapa: nomes de exibição, sem ADM; a 1 e a 9 são do vendedor', () => {
    expect(concluiPorDaEtapa(1, 'nilce')).toEqual(['Nilce']);
    expect(concluiPorDaEtapa(1, '')).toEqual([]);
    expect(concluiPorDaEtapa(2, 'Nilce')).toEqual(['Thiago', 'Diego']);
    expect(concluiPorDaEtapa(3, 'Nilce')).toEqual(['Thiago']);
    expect(concluiPorDaEtapa(4, 'Nilce')).toEqual(['Thiago']);
    expect(concluiPorDaEtapa(5, 'Nilce')).toEqual(['Diego']);
    expect(concluiPorDaEtapa(9, 'Nilce')).toEqual(['Nilce']);
    expect(concluiPorDaEtapa(99, 'Nilce')).toEqual([]);
    expect(donosDaEtapa(2, 'Nilce')).toEqual(['giovanna']);   // quem recebe o aviso "É sua" não mudou
  });
  it('concluiPorDaEtapa: o vendedor sai com o acento do card ("João"), não o da comparação; nome diferente do card cai no nome simples', () => {
    expect(concluiPorDaEtapa(1, 'joao', 'João')).toEqual(['João']);
    expect(concluiPorDaEtapa(9, 'joao', '  joão  ')).toEqual(['João']);
    expect(concluiPorDaEtapa(1, 'jose maria', 'José Maria')).toEqual(['José Maria']);
    expect(concluiPorDaEtapa(1, 'joao')).toEqual(['Joao']);                 // sem o nome do card, o que há
    expect(concluiPorDaEtapa(1, 'joao', 'Carla')).toEqual(['Joao']);        // card de outra pessoa não troca o nome
    expect(concluiPorDaEtapa(2, 'joao', 'João')).toEqual(['Thiago', 'Diego']);   // etapa de dono fixo não vira o vendedor
    expect(concluiPorDaEtapa(1, '', 'João')).toEqual([]);
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

describe('assinatura de antes dos 3 tipos de financiamento', () => {
  /** A assinatura que o servidor gravava quando o estado guardava `financiamento: 'sim'` (hoje `proprio`). */
  const assinaturaAntiga = (card: number, n: EstadoJornada): string =>
    crypto.createHmac('sha256', 'segredo-de-teste')
      .update(`jornada|${card}|${JSON.stringify({ ...n, etapas: { ...n.etapas, 1: { ...n.etapas[1], financiamento: 'sim' } } })}`).digest('hex');
  const comFinanciamento = (valor: string): { n: EstadoJornada; bruto: Record<string, any> } => {
    const base = novo(10);
    const n = normalizarJornada(10, { ...base, etapas: { ...base.etapas, 1: { ...base.etapas[1], financiamento: valor as never } } })!;
    return { n, bruto: JSON.parse(JSON.stringify(n)) };
  };

  it("estado com 'sim' assinado do jeito antigo ainda carrega, como 'proprio'", () => {
    const { n, bruto } = comFinanciamento('proprio');
    expect(n.etapas[1].financiamento).toBe('proprio');
    const guardado = { ...bruto, etapas: { ...bruto.etapas, 1: { ...bruto.etapas[1], financiamento: 'sim' } }, sig: assinaturaAntiga(10, n) };
    expect(jornadaAssinada(10, guardado)?.etapas[1].financiamento).toBe('proprio');
    expect(jornadaAssinada(10, { ...guardado, etapas: { ...guardado.etapas, 1: { ...guardado.etapas[1], financiamento: 'sim' } }, vendedor: 'outro' })).toBeNull();   // mexeu no resto: a assinatura antiga não vale
  });

  it("'financeira' (e 'nao') com a assinatura do jeito antigo é recusado: o atalho vale só para o 'sim'", () => {
    for (const tipo of ['financeira', 'nao']) {
      const { n, bruto } = comFinanciamento(tipo);
      expect(n.etapas[1].financiamento).toBe(tipo);
      expect(jornadaAssinada(10, { ...bruto, sig: assinaturaAntiga(10, n) }), tipo).toBeNull();
    }
    // e a assinatura de hoje de 'financeira' vale
    const f = comFinanciamento('financeira');
    expect(jornadaAssinada(10, { ...f.bruto, sig: assinarJornada(10, f.n) })?.etapas[1].financiamento).toBe('financeira');
  });
});
