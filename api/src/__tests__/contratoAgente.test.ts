import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Agente do contrato: lista branca de campos, validação de cada ação no servidor, conflito, limite por e-mail, plano B do
// modelo e as três rotas. A Anthropic, o login e o log são simulados; nenhuma chamada sai para a rede. Dados inventados.

const h = vi.hoisted(() => ({
  fila: [] as Array<{ erro?: unknown; saida?: unknown; parada?: string }>,
  chamadas: [] as Array<{ corpo: any }>,
  logs: [] as unknown[][],
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: (...a: unknown[]) => { h.logs.push(a); }, warn: (...a: unknown[]) => { h.logs.push(a); }, info: (...a: unknown[]) => { h.logs.push(a); },
  },
}));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => ({
    messages: {
      stream: (corpo: unknown) => {
        h.chamadas.push({ corpo });
        const e = h.fila.shift() ?? { erro: new Error('fila vazia') };
        return {
          finalMessage: async () => {
            if (e.erro) throw e.erro;
            return {
              stop_reason: e.parada ?? 'end_turn', parsed_output: e.saida,
              usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 4000, cache_read_input_tokens: 0 },
            };
          },
        };
      },
    },
  }),
}));
vi.mock('../utils/supabaseGerador', () => {
  const quem: Record<string, string> = { 'tk-nilce': 'nilce', 'tk-outro': 'outro', 'tk-limite': 'limite' };
  return {
    geradorComServiceKey: false,
    supabaseGerador: {
      auth: {
        getUser: vi.fn(async (token: string) => quem[token]
          ? { data: { user: { email: `${quem[token]}@irmaosnaobra.app`, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } }),
      },
    },
  };
});
vi.mock('../utils/supabase', () => ({ supabase: {} }));

import { ehTextoDeAutonomia } from '../services/gerador/contratoHibrido';
import { PedidoAgente, SaidaAgenteIa, pedirAgente, textoChat, checarConflitos, PedidoConflitos, SISTEMA_AGENTE, BLOCOS_SISTEMA } from '../services/gerador/contratoAgente';
import { CAMPOS_AGENTE, CAMPO_POR_ID, dinheiroBR, validarValorCampo } from '../services/gerador/contratoAgenteCampos';
import { mountContratoAgente } from '../routes/geradorContratoAgente';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PII = 'João da Silva, CPF 123.456.789-00, rua das Flores 10';
const it_ = (key: string, html: string, extra: { travado?: boolean; campo?: string } = {}) =>
  ({ key, html, travado: !!extra.travado, ...(extra.campo ? { campo: extra.campo } : {}) });
const cl = (key: string, titulo: string, itens: ReturnType<typeof it_>[], modelo?: string) => ({ ...(modelo ? { modelo } : {}), key, titulo, itens });

const completo = () => [
  cl('partes', 'Das partes', [it_('partes.1', PII, { travado: true, campo: 'partes' })]),
  cl('objeto', 'Do objeto', [it_('objeto.1', 'Instalação do carregador.')]),
  cl('preco', 'Do preço e do pagamento', [
    it_('preco.total', 'R$ 99.999,00 secreto', { travado: true, campo: 'Valor e formas de pagamento > Valor total do projeto' }),
    it_('preco.mora', 'O atraso sujeita a multa de 2% e juros de 1% ao mês.', { campo: 'Valor e formas de pagamento > Multa por atraso e Juros de mora' }),
  ]),
  cl('garantia', 'Da garantia', [it_('garantia.instalacao', 'A garantia da instalação é de 24 meses.', { campo: 'Prazos > Garantia da instalação' })]),
  cl('foro', 'Do foro', [it_('foro.comarca', 'Fica eleito o foro da comarca de Uberlândia/MG.', { campo: 'Foro, assinatura e cláusulas extras > Foro (comarca)' })]),
  cl('gerais', 'Das disposições gerais', [it_('gerais.1', 'Alterações só por escrito.')]),
];
const arrend = () => [
  cl('objeto', 'Do objeto', [it_('objeto.cessao', 'Cessão da área.', { travado: true, campo: 'objeto' })]),
  cl('remuneracao', 'Da remuneração', [
    it_('remuneracao.pct', '10% do faturamento bruto.', { travado: true, campo: 'Arrendamento > Percentual do faturamento bruto' }),
    it_('remuneracao.fixo', 'Valor mensal fixo de R$ 2.000,00.', { travado: true, campo: 'Arrendamento > Valor mensal fixo' }),
  ]),
];

const corpo = (extra: Record<string, unknown> = {}) => ({
  tipo: 'completo', hibrido: null, clausulas: completo(), campos: [], emitente: 'nexus',
  cadastro: { tem: true, faltando: [] }, historico: [], mensagem: 'faça a mudança', ...extra,
});

const NULO = { id: null, valor: null, modelo: null, op: null, tipos: null, pedido: null, emitente: null };
const campo = (id: string, valor: string) => ({ tipo: 'campo' as const, ...NULO, id, valor });
const opBase = { tipo: 'substituir_item', alvo: null, depois_de: null, id_novo: null, titulo: null, texto: null, itens: null };
const operacao = (op: Record<string, unknown>, modelo: string | null = null) => ({ tipo: 'operacao' as const, ...NULO, modelo, op: { ...opBase, ...op } });
const hib = (tipos: string[], pedido: string | null = null) => ({ tipo: 'hibrido' as const, ...NULO, tipos, pedido });
const mod = (modelo: string) => ({ tipo: 'modelo' as const, ...NULO, modelo });
const simples = (tipo: 'cadastro' | 'previa') => ({ tipo, ...NULO });
const emit = (e: string) => ({ tipo: 'emitente' as const, ...NULO, emitente: e });
const ia = (p: Record<string, unknown> = {}) => ({ resposta: 'Feito.', acoes: [], achados: [], pergunta: null, avisos: [], conflitos: [], continuar: false, ...p });
const fila = (saida: unknown) => { h.fila.push({ saida }); };
const chamar = (extra: Record<string, unknown> = {}) => pedirAgente(PedidoAgente.parse(corpo(extra)));
const ok = async (extra: Record<string, unknown> = {}) => {
  const r = await chamar(extra);
  if (!r.ok) throw new Error('esperava ok: ' + JSON.stringify(r));
  return r;
};

beforeEach(() => { h.fila.length = 0; h.chamadas.length = 0; h.logs.length = 0; delete process.env.CONTRATO_IA_MODELO; delete process.env.CONTRATO_AGENTE_EFFORT; delete process.env.CONTRATO_AGENTE_EFFORT_REVISAR; });
afterEach(() => { delete process.env.CONTRATO_IA_MODELO; delete process.env.CONTRATO_AGENTE_EFFORT; delete process.env.CONTRATO_AGENTE_EFFORT_REVISAR; });

// ── Lista branca ─────────────────────────────────────────────────────────────
describe('lista branca de campos', () => {
  it('ids únicos, todos com modelos, e nenhum campo de identidade, endereço, contato, banco ou dado da empresa', () => {
    const ids = CAMPOS_AGENTE.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAMPOS_AGENTE) expect(c.modelos.length).toBeGreaterThan(0);
    const proibido = /(contratante|-doc$|-end$|-cep$|-tel$|-email$|-rep|-ie$|-int-|-dados$|cidade|-local$|qualif|-num$|matricula|cartorio|iptu|-uc$|distribuidora|-pep$|faixa|-origem$|regiao|ponto$|pag-dados|^orc-|ctr-tipo$)/;
    expect(ids.filter(i => proibido.test(i))).toEqual([]);
    // O campo "cadastro" nunca aparece no texto do formulário que o agente muda.
    for (const c of CAMPOS_AGENTE) if (c.tipo === 'texto') expect(c.maxLen).toBeGreaterThan(0);
  });
  it('preço total, sinal, aporte, depósito e a tabela de pagamento (observação) são sensíveis; prazo e garantia não', () => {
    const sens = (id: string) => !!CAMPO_POR_ID.get(id)?.sensivel;
    for (const id of ['ctr-total', 'ctr-sinal', 'ctr-soc-invest', 'ctr-soc-aporte', 'ctr-ti-deposito', 'ctr-pag-obs', 'ctr-arr-pct',
      'ctr-pct', 'ctr-soc-software', 'ctr-soc-arrend', 'ctr-arr-reajuste', 'ctr-soc-n', 'ctr-soc-qtd']) expect(sens(id), id).toBe(true);
    for (const id of ['ctr-garantia', 'ctr-prazo-obra', 'ctr-multa', 'ctr-foro', 'ctr-arr-vigencia']) expect(sens(id), id).toBe(false);
  });
  it('"O cedente é" (qualidade do cedente, que define a parte) não está na lista branca, e o agente não o muda', async () => {
    expect(CAMPO_POR_ID.has('ctr-arr-relacao')).toBe(false);
    expect(CAMPOS_AGENTE.some(c => /relacao/.test(c.id))).toBe(false);
    fila(ia({ acoes: [campo('ctr-arr-relacao', 'locatario')] }));
    const r = await ok({ tipo: 'arrend', clausulas: [cl('objeto', 'Do objeto', [it_('objeto.1', 'Cessão.')])] });
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/não está na lista/);
  });
  it('cada campo sensível volta com confirmar:true quando o agente o muda', async () => {
    const casos: Array<[string, string, string, string]> = [
      ['completo', 'ctr-pct', '12', '12'], ['socio50', 'ctr-soc-software', '10', '10'], ['socio50', 'ctr-soc-arrend', '5', '5'],
      ['arrend', 'ctr-arr-reajuste', '8', '8'], ['cotas', 'ctr-soc-n', '4', '4'], ['cotas', 'ctr-soc-qtd', '2', '2'],
    ];
    for (const [tipo, id, valor] of casos) {
      fila(ia({ acoes: [campo(id, valor)] }));
      const r = await ok({ tipo, clausulas: [cl('objeto', 'Do objeto', [it_('objeto.1', 'Texto.')])] });
      expect(r.acoes, id).toEqual([expect.objectContaining({ tipo: 'campo', id, confirmar: true })]);
    }
  });
  it('cada item citado em `itens` é de um modelo em que o campo vale', () => {
    for (const c of CAMPOS_AGENTE) for (const m of Object.keys(c.itens || {})) expect(c.modelos, `${c.id} -> ${m}`).toContain(m);
  });
  it('o sistema é um bloco só, com cache_control, e traz o catálogo inteiro', () => {
    expect(BLOCOS_SISTEMA).toHaveLength(1);
    expect(BLOCOS_SISTEMA[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    for (const c of CAMPOS_AGENTE) expect(SISTEMA_AGENTE).toContain(`"id":"${c.id}"`);
  });
});

// ── Valores ──────────────────────────────────────────────────────────────────
describe('validação do valor', () => {
  const v = (id: string, valor: unknown) => validarValorCampo(CAMPO_POR_ID.get(id)!, valor);
  it('dinheiro: "145.000" vira "145.000,00", nunca 145', () => {
    for (const [entrada, saida] of [['145.000', '145.000,00'], ['145000', '145.000,00'], ['R$ 145.000,00', '145.000,00'], ['145000,5', '145.000,50'], ['1.234,56', '1.234,56'], ['145000.50', '145.000,50']]) {
      expect(v('ctr-total', entrada)).toEqual({ ok: true, valor: saida });
    }
    expect(dinheiroBR('145.000')).toEqual({ ok: true, centavos: 14_500_000 });
  });
  it('dinheiro ambíguo ou inválido é recusado (não adivinha o preço)', () => {
    for (const x of ['145,000', '1,234.56', '1,2,3', 'abc', '', '12a', '-5']) expect(v('ctr-total', x).ok, x).toBe(false);
    expect(v('ctr-total', '0').ok).toBe(false);          // preço zero não vale
    expect(v('ctr-total', '999999999999').ok).toBe(false);
  });
  it('zero: sinal aceita "0,00"; piso "limpa" o campo', () => {
    expect(v('ctr-sinal', '0')).toEqual({ ok: true, valor: '0,00' });
    expect(v('ctr-arr-piso', '0')).toEqual({ ok: true, valor: '' });
    expect(v('ctr-arr-piso', '')).toEqual({ ok: true, valor: '' });
  });
  it('percentual: vírgula nos campos de texto, ponto nos <input type=number>; faixa respeitada', () => {
    expect(v('ctr-pct', '12.5')).toEqual({ ok: true, valor: '12,5' });          // type=text, vírgula
    expect(v('ctr-multa', '2,5%')).toEqual({ ok: true, valor: '2.5' });          // type=number, ponto
    expect(v('ctr-multa', '50').ok).toBe(false);
    expect(v('ctr-pct', '0').ok).toBe(false);
  });
  it('inteiro, data, opção e texto', () => {
    expect(v('ctr-garantia', '36')).toEqual({ ok: true, valor: '36' });
    expect(v('ctr-garantia', '36 meses').ok).toBe(false);
    // "1.000" é mil: inteiro com separador seguido de três dígitos é recusado, nunca vira 1.
    for (const id of ['ctr-ti-raio', 'ctr-soc-prazo']) for (const x of ['1.000', '1,000', '2.500']) expect(v(id, x).ok, `${id} ${x}`).toBe(false);
    expect(v('ctr-ti-raio', '1000')).toEqual({ ok: true, valor: '1000' });
    expect(v('ctr-garantia', '36.0')).toEqual({ ok: true, valor: '36' });
    // Percentual: "1.500" e "1,500" são ambíguos, recusados; "1.5" e "1,5" valem.
    for (const x of ['1.500', '1,500']) { expect(v('ctr-multa', x).ok, x).toBe(false); expect(v('ctr-pct', x).ok, x).toBe(false); }
    expect(v('ctr-multa', '1.5')).toEqual({ ok: true, valor: '1.5' });
    expect(v('ctr-pct', '1,5')).toEqual({ ok: true, valor: '1,5' });
    expect(v('ctr-garantia', '999').ok).toBe(false);
    expect(v('ctr-garantia', '0').ok).toBe(false);
    expect(v('ctr-ti-desist', '3').ok).toBe(false);                               // mínimo 7
    expect(v('ctr-data', '30/10/2026')).toEqual({ ok: true, valor: '2026-10-30' });
    expect(v('ctr-data', '2026-02-31').ok).toBe(false);
    expect(v('ctr-prazo-unid', 'Corridos')).toEqual({ ok: true, valor: 'corridos' });
    expect(v('ctr-prazo-unid', 'semanas').ok).toBe(false);
    expect(v('ctr-foro', ' Uberlândia/MG ')).toEqual({ ok: true, valor: 'Uberlândia/MG' });
    expect(v('ctr-foro', 'Foro de quem tem CPF 123.456.789-00').ok).toBe(false);
    expect(v('ctr-foro', 'fale com maria@exemplo.com').ok).toBe(false);
    // Qualquer "<" ou ">" sai, mesmo sem a tag fechada.
    expect(v('ctr-foro', 'Uberlândia <script')).toEqual({ ok: true, valor: 'Uberlândia script' });
    expect(v('ctr-foro', 'Uberaba <b>MG</b> > x')).toEqual({ ok: true, valor: 'Uberaba MG x' });
    expect(v('ctr-extras', 'linha 1 <img src=x\nlinha 2 <')).toEqual({ ok: true, valor: 'linha 1 img src=x\nlinha 2' });
    expect(v('ctr-foro', '<<>>').ok).toBe(false);
  });
});

// ── O agente ─────────────────────────────────────────────────────────────────
describe('pedirAgente: ações de campo', () => {
  it('campo fora da lista é descartado com aviso; campos do pedido fora da lista nem chegam ao modelo', async () => {
    fila(ia({ acoes: [campo('ctr-contratante', 'Fulano de Tal'), campo('orc-cli-doc', '123.456.789-00'), campo('ctr-garantia', '36')] }));
    const r = await ok({ campos: [{ id: 'ctr-contratante', valor: 'SEGREDO-NOME' }, { id: 'ctr-garantia', valor: '24' }] });
    expect(r.acoes).toEqual([{ tipo: 'campo', id: 'ctr-garantia', rotulo: 'Garantia da instalação', valor: '36', antes: '24', confirmar: false }]);
    expect(r.avisos.filter(a => /não está na lista/.test(a))).toHaveLength(1);       // o mesmo aviso não se repete
    const msg = h.chamadas[0].corpo.messages[0].content;
    expect(msg).not.toContain('SEGREDO-NOME');
    expect(msg).toContain('"ctr-garantia":"24"');
  });
  it('dinheiro "145.000" vira "145.000,00" e, sendo preço, pede confirmação', async () => {
    fila(ia({ acoes: [campo('ctr-total', '145.000')] }));
    const r = await ok({ campos: [{ id: 'ctr-total', valor: '99.999,00' }] });
    expect(r.acoes).toEqual([{ tipo: 'campo', id: 'ctr-total', rotulo: 'Valor total do projeto', valor: '145.000,00', antes: '99.999,00', confirmar: true }]);
  });
  it('sinal e depósito exigem confirmação; garantia não', async () => {
    fila(ia({ acoes: [campo('ctr-sinal', '5000'), campo('ctr-garantia', '48')] }));
    const r = await ok();
    const por = Object.fromEntries(r.acoes.map((a: any) => [a.id, a.confirmar]));
    expect(por).toEqual({ 'ctr-sinal': true, 'ctr-garantia': false });
  });
  it('faixa inválida, opção inválida e valor ambíguo são descartados', async () => {
    fila(ia({ acoes: [campo('ctr-garantia', '999'), campo('ctr-multa', '40'), campo('ctr-prazo-unid', 'quinzenas'), campo('ctr-total', '145,000')] }));
    const r = await ok();
    expect(r.acoes).toEqual([]);
    expect(r.avisos.filter(a => /não entrou/.test(a))).toHaveLength(4);
  });
  it('campo de outro modelo não entra; com a troca de modelo no mesmo turno, entra', async () => {
    fila(ia({ acoes: [campo('ctr-arr-vigencia', '60')] }));
    const a = await ok();
    expect(a.acoes).toEqual([]);
    expect(a.avisos.join(' ')).toMatch(/não existe neste contrato/);
    fila(ia({ acoes: [mod('arrend'), campo('ctr-arr-vigencia', '60')] }));
    const b = await ok();
    expect(b.acoes.map((x: any) => x.tipo)).toEqual(['modelo', 'campo']);
  });
  it('valor igual ao que já está na tela não vira ação', async () => {
    fila(ia({ acoes: [campo('ctr-garantia', '24')] }));
    const r = await ok({ campos: [{ id: 'ctr-garantia', valor: '24' }] });
    expect(r.acoes).toEqual([]);
  });
  it('sem modelo aberto, campo não entra (escolha o modelo antes)', async () => {
    fila(ia({ acoes: [campo('ctr-garantia', '36')] }));
    const r = await ok({ tipo: null, clausulas: [] });
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/escolha antes o modelo/);
  });
  it('texto com venda casada, autonomia ou dado pessoal não entra num campo de texto', async () => {
    fila(ia({ acoes: [campo('ctr-extras', 'Desconto condicionado à contratação do arrendamento.'), campo('ctr-sinal-destino', 'Fale com 34 99999-1234')] }));
    const r = await ok();
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/venda casada/);
  });
});

describe('pedirAgente: operações de texto', () => {
  it('operação e campo no mesmo item: a operação é descartada, o campo fica', async () => {
    fila(ia({ acoes: [campo('ctr-garantia', '36'), operacao({ tipo: 'substituir_item', alvo: 'garantia.instalacao', texto: 'A garantia é de 36 meses.' })] }));
    const r = await ok();
    expect(r.acoes.map((a: any) => a.tipo)).toEqual(['campo']);
    expect(r.avisos.join(' ')).toMatch(/Mudei pelo campo "Garantia da instalação"/);
  });
  it('sem ação de campo para o item, a operação de texto vale (o pedido muda mais que o número)', async () => {
    fila(ia({ acoes: [operacao({ tipo: 'substituir_item', alvo: 'garantia.instalacao', texto: 'A garantia é de <b>36 meses</b>, com revisão anual.' })] }));
    const r = await ok();
    expect(r.acoes).toEqual([{ tipo: 'operacao', modelo: 'completo', op: expect.objectContaining({ tipo: 'substituir_item', alvo: 'garantia.instalacao', texto: 'A garantia é de <b>36 meses</b>, com revisão anual.' }) }]);
  });
  it('o campo de OUTRO item não derruba a operação', async () => {
    fila(ia({ acoes: [campo('ctr-multa', '2'), operacao({ tipo: 'substituir_item', alvo: 'garantia.instalacao', texto: 'Garantia de 36 meses.' })] }));
    const r = await ok({ campos: [{ id: 'ctr-multa', valor: '3' }] });
    expect(r.acoes.map((a: any) => a.tipo)).toEqual(['campo', 'operacao']);
  });
  it('operação em item travado é descartada, e o html é higienizado', async () => {
    fila(ia({ acoes: [
      operacao({ tipo: 'substituir_item', alvo: 'preco.total', texto: 'Preço alterado.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Texto <script>alert(1)</script> com <b>negrito</b>.' }),
    ] }));
    const r = await ok();
    expect(r.acoes).toHaveLength(1);
    const op = (r.acoes[0] as any).op;
    expect(op.texto).not.toContain('<script>');
    expect(op.texto).toContain('<b>negrito</b>');
    expect(r.avisos.join(' ')).toMatch(/campo próprio na tela/);
  });
  it('texto de autonomia e de venda casada é descartado', async () => {
    fila(ia({ acoes: [
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Os objetos são autônomos, e a autonomia entre eles vale sempre.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'O desconto fica condicionado à contratação da operação do eletroposto.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Cada parte arca com as suas despesas.' }),
    ] }));
    const r = await ok();
    expect(r.acoes).toHaveLength(1);
    expect(r.avisos.join(' ')).toMatch(/autonomia/);
    expect(r.avisos.join(' ')).toMatch(/venda casada/);
  });
  it('marcador interno copiado pela IA ([doc removido], [travado: ...]) não vai para o contrato nem para um campo de texto', async () => {
    fila(ia({ acoes: [
      operacao({ tipo: 'substituir_item', alvo: 'gerais.1', texto: 'Pagar por Pix para o CNPJ [doc removido].' }),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Ver [travado: partes] para as partes.' }),
      operacao({ tipo: 'inserir_clausula', depois_de: 'gerais', titulo: 'Do contato', itens: ['Escreva para [e-mail removido].'], id_novo: 'contato' }),
      campo('ctr-extras', 'Pagamento para [telefone removido].'),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Texto normal e limpo.' }),
    ] }));
    const r = await ok();
    expect(r.acoes.map((a: any) => a.tipo)).toEqual(['operacao']);
    expect((r.acoes[0] as any).op.texto).toBe('Texto normal e limpo.');
    expect(r.avisos.join(' ')).toMatch(/marcador interno/);
  });
  it('autonomia: só a das partes/objetos é descartada; "autonomia da bateria" e "profissional autônomo" passam', async () => {
    const aceitos = ['A autonomia da bateria do carregador é de 4 horas.', 'O profissional autônomo contratado responde pela revisão.'];
    const barrados = ['Os objetos são autônomos entre si.', 'Há independência entre os objetos contratados.', 'Vale a autonomia dos objetos.', 'Cada objeto é autônomo.', 'A autonomia entre si é total.'];
    fila(ia({ acoes: [...aceitos, ...barrados].map(texto => operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto })) }));
    const r = await ok();
    expect(r.acoes.map((a: any) => a.op.texto)).toEqual(aceitos);
    expect(r.avisos.join(' ')).toMatch(/autonomia dos objetos/);
    expect(ehTextoDeAutonomia(null, null, ['bateria com autonomia de 300 km'])).toBe(false);
    expect(ehTextoDeAutonomia('Da Autonomia', null, [])).toBe(true);
    expect(ehTextoDeAutonomia('Da autonomia da bateria', null, ['Texto'])).toBe(false);
    expect(ehTextoDeAutonomia('Do foro', 'hibrido.autonomia', [])).toBe(true);
  });
  it('remover_clausula que contém item cujo campo mudou no mesmo turno é descartada; sem o campo, vale', async () => {
    fila(ia({ acoes: [campo('ctr-garantia', '36'), operacao({ tipo: 'remover_clausula', alvo: 'garantia' })] }));
    const a = await ok();
    expect(a.acoes.map((x: any) => x.tipo)).toEqual(['campo']);
    expect(a.avisos.join(' ')).toMatch(/Mudei pelo campo "Garantia da instalação"/);
    fila(ia({ acoes: [operacao({ tipo: 'remover_clausula', alvo: 'garantia' })] }));
    expect((await ok()).acoes.map((x: any) => x.tipo)).toEqual(['operacao']);
  });
  it('a observação de pagamento (ctr-pag-obs) é a origem de preco.forma: operação sobre esse item cai', async () => {
    const clausulas = [...completo(), cl('pagamento', 'Do pagamento', [it_('preco.forma', 'O pagamento é por Pix ou cartão.', { campo: 'Valor e formas de pagamento > formas de pagamento' })])];
    fila(ia({ acoes: [campo('ctr-pag-obs', 'Cartão em até 6 vezes'), operacao({ tipo: 'substituir_item', alvo: 'preco.forma', texto: 'Pagamento por cartão.' })] }));
    const r = await ok({ clausulas });
    expect(r.acoes.map((x: any) => x.tipo)).toEqual(['campo']);
    expect(r.acoes[0]).toMatchObject({ id: 'ctr-pag-obs', confirmar: true });
  });
  it('valor em dinheiro ou percentual que o contrato e os campos não têm só muda pelo campo', async () => {
    const clausulas = [...arrend(), cl('mora', 'Da mora', [it_('mora.1', 'O atraso sujeita a multa de 2% e juros de 1% ao mês.')])];
    fila(ia({ acoes: [
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'Há também valor fixo de <b>R$ 800,00</b> por mês.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'Há também comissão de 7% sobre a venda.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'Há também reajuste de 800 reais.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'A multa de 2% e os juros de 1% valem para as duas partes.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'O valor fixo de R$ 2.000,00 vale desde o primeiro mês.' }),
      operacao({ tipo: 'inserir_clausula', depois_de: 'mora', titulo: 'Do bônus', itens: ['Bônus de 3%.'], id_novo: 'bonus' }),
    ] }));
    const r = await ok({ tipo: 'arrend', clausulas, campos: [{ id: 'ctr-arr-fixo', valor: '2.000,00' }] });
    expect(r.acoes.map((a: any) => a.op.texto)).toEqual(['A multa de 2% e os juros de 1% valem para as duas partes.', 'O valor fixo de R$ 2.000,00 vale desde o primeiro mês.']);
    expect(r.avisos.filter(a => a === 'Valor e percentual só mudam pelo campo.')).toHaveLength(1);
    // O valor de um campo mudado NO MESMO turno também conta como existente.
    fila(ia({ acoes: [campo('ctr-arr-fixo', '800'), operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'O valor fixo é de R$ 800,00.' })] }));
    const r2 = await ok({ tipo: 'arrend', clausulas });
    expect(r2.acoes.map((a: any) => a.tipo)).toEqual(['campo', 'operacao']);
  });
  it('valor por extenso ("145 mil reais", "dez por cento") que o contrato não tem também só muda pelo campo; o que já existe passa', async () => {
    const clausulas = [...completo(), cl('mora', 'Da mora', [it_('mora.1', 'A multa é de dez por cento e o sinal é de cinco mil reais.')])];
    fila(ia({ acoes: [
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'O preço é de 145 mil reais.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'A comissão é de quinze por cento.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'A taxa é de 12 por cento.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'Vale a multa de dez por cento e o sinal de cinco mil reais.' }),
      operacao({ tipo: 'inserir_item', depois_de: 'mora.1', texto: 'Os valores são pagos em reais.' }),
    ] }));
    const r = await ok({ clausulas });
    expect(r.acoes.map((a: any) => a.op.texto)).toEqual(['Vale a multa de dez por cento e o sinal de cinco mil reais.', 'Os valores são pagos em reais.']);
    expect(r.avisos.filter(a => a === 'Valor e percentual só mudam pelo campo.')).toHaveLength(1);
  });
  it('remover a cláusula que contém um item protegido também é barrado', async () => {
    const clausulas = [...arrend(), cl('qualidade', 'Da qualidade', [it_('cedente.legitimidade', 'O CEDENTE é o proprietário.', { campo: 'Arrendamento > O cedente é' }), it_('qualidade.2', 'Outro item.')]),
      cl('livre', 'Livre', [it_('livre.1', 'Item livre.')])];
    fila(ia({ acoes: [operacao({ tipo: 'remover_clausula', alvo: 'qualidade' }), operacao({ tipo: 'remover_clausula', alvo: 'livre' })] }));
    const r = await ok({ tipo: 'arrend', clausulas });
    expect(r.acoes.map((a: any) => `${a.op.tipo}:${a.op.alvo}`)).toEqual(['remover_clausula:livre']);
    expect(r.avisos.join(' ')).toMatch(/define uma parte ou identifica o imóvel/);
  });
  it('venda casada: rescisão cruzada e "negócio único e indivisível" caem; texto comum passa', async () => {
    const barrados = ['A rescisão de um implica a rescisão do outro.', 'A rescisão de um contrato acarreta a do outro.', 'Formam um negócio único e indivisível.', 'Os contratos são indivisíveis.'];
    const aceitos = ['A rescisão do contrato por inadimplência exige aviso prévio.', 'Cada parte responde pelos seus atos e pelos de seus prepostos.', 'O negócio jurídico se prova por escrito.'];
    fila(ia({ acoes: [...barrados, ...aceitos].map(texto => operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto })) }));
    const r = await ok();
    expect(r.acoes.map((a: any) => a.op.texto)).toEqual(aceitos);
    expect(r.avisos.join(' ')).toMatch(/venda casada/);
  });
  it('"O cedente é" (cedente.legitimidade) define a parte: operação de texto sobre ele cai', async () => {
    const clausulas = [...arrend(), cl('qualidade', 'Da qualidade', [it_('cedente.legitimidade', 'O CEDENTE é o proprietário do IMÓVEL.', { campo: 'Arrendamento > O cedente é' })])];
    fila(ia({ acoes: [operacao({ tipo: 'substituir_item', alvo: 'cedente.legitimidade', texto: 'O CEDENTE é inquilino.' }), operacao({ tipo: 'remover_item', alvo: 'cedente.legitimidade' })] }));
    const r = await ok({ tipo: 'arrend', clausulas });
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/define uma parte/);
  });
  it('cláusula de ligação nova: ligacao.* e devolucao.retirada nascem de ctr-arr-energia; ligacao.imovel é protegido', async () => {
    const { camposDoItem } = await import('../services/gerador/contratoAgenteCampos');
    expect(camposDoItem('arrend', 'ligacao.autoriza')).toEqual(['ctr-arr-energia']);
    expect(camposDoItem('arrend', 'ligacao.qualquer.coisa')).toEqual(['ctr-arr-energia']);
    expect(camposDoItem('arrend', 'devolucao.retirada').sort()).toEqual(['ctr-arr-energia', 'ctr-arr-retirada']);
    expect(camposDoItem('completo', 'ligacao.autoriza')).toEqual([]);
    const clausulas = [...arrend(), cl('ligacao', 'Da ligação nova', [
      it_('ligacao.autoriza', 'O CEDENTE autoriza a ligação nova em nome da CESSIONÁRIA.', { campo: 'Arrendamento > Energia do ponto' }),
      it_('ligacao.imovel', 'O IMÓVEL tem matrícula informada na tela.', { campo: 'Termo do Arrendador > Matrícula nº' }),
    ])];
    fila(ia({ acoes: [
      campo('ctr-arr-energia', 'sub'),
      operacao({ tipo: 'substituir_item', alvo: 'ligacao.autoriza', texto: 'Autoriza a ligação.' }),
      operacao({ tipo: 'substituir_item', alvo: 'ligacao.imovel', texto: 'Matrícula escrita pela IA.' }),
    ] }));
    const r = await ok({ tipo: 'arrend', clausulas });
    expect(r.acoes.map((a: any) => a.tipo)).toEqual(['campo']);
    expect(r.avisos.join(' ')).toMatch(/Mudei pelo campo "Energia do ponto"/);
    expect(r.avisos.join(' ')).toMatch(/define uma parte ou identifica o imóvel/);
  });
  it('CPF e CNPJ sem pontuação (11 e 14 dígitos) são mascarados antes de sair para o modelo; 10 e 12 dígitos seguem', async () => {
    fila(ia());
    await ok({
      clausulas: [...completo(), cl('extra', 'Extra', [it_('extra.1', 'CPF 12345678901 e CNPJ 12345678000199, protocolo 1234567890 e 123456789012.')])],
      mensagem: 'o cliente é 98765432100 / 11222333000181',
    });
    const msg = h.chamadas[0].corpo.messages[0].content as string;
    expect(msg).not.toMatch(/12345678901(?!\d)|12345678000199|98765432100|11222333000181/);
    expect(msg).toContain('[doc removido]');
    expect(msg).toContain('1234567890 e 123456789012');
  });
  it('chave inexistente e operação sem alvo são descartadas pela validação de sempre', async () => {
    fila(ia({ acoes: [operacao({ tipo: 'remover_item', alvo: 'nao.existe' }), { tipo: 'operacao', ...NULO, op: null }] }));
    const r = await ok();
    expect(r.acoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/não existe no contrato/);
  });
  it('trocando o modelo no mesmo turno, as operações ficam para o próximo passo', async () => {
    fila(ia({ acoes: [mod('arrend'), operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Cada parte arca com as suas despesas.' })], continuar: true }));
    const r = await ok();
    expect(r.acoes.map((a: any) => a.tipo)).toEqual(['modelo']);
    expect(r.avisos.join(' ')).toMatch(/próximo passo/);
    expect(r.continuar).toBe(true);
  });
  it('no híbrido a operação precisa dizer o modelo, e age só nas cláusulas dele', async () => {
    const hibridoClausulas = [
      ...completo().map(c => ({ ...c, modelo: 'completo' })),
      ...arrend().map(c => ({ ...c, modelo: 'arrend' })),
    ];
    fila(ia({ acoes: [
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Cada parte arca com as suas despesas.' }, null),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Cada parte arca com as suas despesas.' }, 'completo'),
      operacao({ tipo: 'inserir_item', depois_de: 'gerais.1', texto: 'Cada parte arca com as suas despesas.' }, 'arrend'),
    ] }));
    const r = await ok({ tipo: null, hibrido: { tipos: ['completo', 'arrend'] }, clausulas: hibridoClausulas });
    expect(r.acoes.map((a: any) => `${a.tipo}:${a.modelo}`)).toEqual(['operacao:completo']);
    expect(r.avisos.join(' ')).toMatch(/não diz em qual dos dois modelos/);
    expect(r.avisos.join(' ')).toMatch(/Parte II/);
  });
});

describe('pedirAgente: modelo, híbrido, cadastro, emitente e prévia', () => {
  it('modelo e híbrido inválidos são descartados; os válidos passam', async () => {
    fila(ia({ acoes: [
      hib(['completo', 'termo_arr']), hib(['completo', 'completo']), hib(['socio50', 'cotas']), hib(['completo']),
    ] }));
    const r = await ok();
    expect(r.acoes).toEqual([]);
    expect(r.avisos.filter(a => /híbrido foi descartada/.test(a))).toHaveLength(4);
    fila(ia({ acoes: [hib(['completo', 'arrend'], 'monte do jeito mais simples')] }));
    const v = await ok();
    expect(v.acoes).toEqual([{ tipo: 'hibrido', tipos: ['completo', 'arrend'], pedido: 'monte do jeito mais simples' }]);
  });
  it('pedido do híbrido que liga os objetos perde o pedido, não a ação', async () => {
    fila(ia({ acoes: [hib(['completo', 'arrend'], 'só faça a obra se a operação for contratada, ficando condicionada à contratação da operação')] }));
    const r = await ok();
    expect(r.acoes).toEqual([{ tipo: 'hibrido', tipos: ['completo', 'arrend'] }]);
    expect(r.avisos.join(' ')).toMatch(/venda casada/);
  });
  it('cadastro só sem cadastro é descartado; emitente igual ao atual é ignorado; prévia vai por último', async () => {
    fila(ia({ acoes: [simples('previa'), simples('cadastro'), emit('nexus'), emit('aioros')] }));
    const r = await ok({ cadastro: { tem: false, faltando: ['CPF'] } });
    expect(r.acoes).toEqual([{ tipo: 'emitente', emitente: 'aioros' }, { tipo: 'previa' }]);
    expect(r.avisos.join(' ')).toMatch(/Não há cadastro/);
    fila(ia({ acoes: [simples('cadastro')] }));
    expect((await ok()).acoes).toEqual([{ tipo: 'cadastro' }]);
  });
  it('troca para o mesmo modelo já aberto não vira ação', async () => {
    fila(ia({ acoes: [mod('completo')] }));
    expect((await ok()).acoes).toEqual([]);
  });
});

describe('pedirAgente: continuar, achados, pergunta e texto da resposta', () => {
  it('continuar só vale com etapa estrutural, sem pergunta e sem bloqueio', async () => {
    fila(ia({ acoes: [campo('ctr-garantia', '36')], continuar: true }));
    expect((await ok()).continuar).toBe(false);
    fila(ia({ acoes: [hib(['completo', 'arrend'])], continuar: true }));
    expect((await ok()).continuar).toBe(true);
    fila(ia({ acoes: [hib(['completo', 'arrend'])], continuar: true, pergunta: 'Qual o foro?' }));
    expect((await ok()).continuar).toBe(false);
    fila(ia({ acoes: [simples('cadastro')], continuar: true }));
    expect((await ok()).continuar).toBe(true);
  });
  it('achados vêm com ações conferidas de um clique; ação inválida sai, o achado fica', async () => {
    fila(ia({ achados: [
      { texto: 'a garantia está curta para o equipamento', acoes: [campo('ctr-garantia', '36'), campo('ctr-contratante', 'Fulano')] },
      { texto: 'Falta o foro; decida a comarca', acoes: [] },
    ] }));
    const r = await ok({ campos: [{ id: 'ctr-garantia', valor: '24' }] });
    expect(r.achados).toEqual([
      { texto: 'A garantia está curta para o equipamento', acoes: [{ tipo: 'campo', id: 'ctr-garantia', rotulo: 'Garantia da instalação', valor: '36', antes: '24', confirmar: false }] },
      { texto: 'Falta o foro; decida a comarca', acoes: [] },
    ]);
    expect(r.avisos.join(' ')).not.toMatch(/Fulano|lista que a IA/);   // o aviso das ações dos achados não vaza para a lista
  });
  it('achado sem ação não promete clique nem aplicação; com ação, o texto fica como está', async () => {
    fila(ia({ achados: [
      { texto: 'Falta a matrícula. O clique reaplica o campo.', acoes: [] },
      { texto: 'Clique para aplicar.', acoes: [] },
      { texto: 'A garantia está curta. Clique para aplicar 36 meses.', acoes: [campo('ctr-garantia', '36')] },
    ] }));
    const r = await ok();
    expect(r.achados.map(a => a.texto)).toEqual(['Falta a matrícula.', 'Confira este ponto no contrato.', 'A garantia está curta. Clique para aplicar 36 meses.']);
    expect(SISTEMA_AGENTE).toMatch(/só fala em clique ou em aplicar quando o achado traz ações/);
  });
  it('texto da conversa: maiúscula, sem travessão, sem emoji, sem tag e cortado em fim de frase', () => {
    expect(textoChat('pronto — mudei a garantia 😀 <b>agora</b> vale 36 meses', 600)).toBe('Pronto, mudei a garantia agora vale 36 meses');
    const longo = 'Frase curta aqui. '.repeat(80);
    const c = textoChat(longo, 100);
    expect(c.length).toBeLessThanOrEqual(100);
    expect(c.endsWith('.')).toBe(true);
  });
  it('resposta, pergunta e avisos saem limpos; resposta vazia ganha texto padrão', async () => {
    fila(ia({ resposta: '  garantia mudada — veja a prévia 👍  ', avisos: ['atenção — confira o foro'], pergunta: 'qual é a comarca?' }));
    const r = await ok();
    expect(r.resposta).toBe('Garantia mudada, veja a prévia');
    expect(r.avisos).toEqual(['Atenção, confira o foro']);
    expect(r.pergunta).toBe('Qual é a comarca?');
    fila(ia({ resposta: '   ' }));
    expect((await ok()).resposta).toMatch(/Não entendi/);
  });
});

describe('pedirAgente: conflitos no estado', () => {
  it('percentual e valor fixo no mesmo contrato simples: conflito do servidor e bloqueado', async () => {
    fila(ia({ resposta: 'Revisei.' }));
    const r = await ok({ tipo: 'arrend', clausulas: arrend() });
    expect(r.bloqueado).toBe(true);
    expect(r.conflitos).toEqual([expect.objectContaining({ origem: 'servidor', resolvido: false, descricao: expect.stringContaining('percentual e também por valor fixo') })]);
    expect(r.conflitos[0].descricao).toMatch(/^Este contrato:/);
  });
  it('contrato sem conflito não bloqueia; conflito da IA não resolvido bloqueia, e o resolvido não', async () => {
    fila(ia());
    expect((await ok()).bloqueado).toBe(false);
    fila(ia({ conflitos: [{ descricao: 'dois foros diferentes', resolvido: false, como: null }] }));
    expect((await ok()).bloqueado).toBe(true);
    fila(ia({ conflitos: [{ descricao: 'dois foros diferentes', resolvido: true, como: 'o consultor escolheu Uberlândia' }] }));
    const r = await ok();
    expect(r.bloqueado).toBe(false);
    expect(r.conflitos[0]).toMatchObject({ resolvido: true, origem: 'ia' });
  });
  it('a checagem enxerga as operações válidas: uma cláusula de multa inserida duplica a multa e bloqueia', async () => {
    const base = [cl('multa', 'Da multa', [it_('multa.1', 'Multa por rescisão: 10% do valor, a título de cláusula penal.')])];
    fila(ia({ acoes: [operacao({ tipo: 'inserir_clausula', depois_de: 'multa', titulo: 'Da penalidade', itens: ['Penalidade de 10% do valor em caso de descumprimento contratual.'], id_novo: 'pen' })] }));
    const r = await ok({ clausulas: base });
    expect(r.acoes).toHaveLength(1);
    expect(r.bloqueado).toBe(true);
    expect(r.conflitos[0].descricao).toMatch(/multa/i);
  });
});

// ── Segurança do que vai ao modelo ───────────────────────────────────────────
describe('o que vai ao modelo', () => {
  it('item travado vira marcador, dado pessoal no texto é mascarado e o histórico entra como dado, não como turnos', async () => {
    fila(ia());
    await ok({
      clausulas: [...completo(), cl('extra', 'Extra', [it_('extra.1', 'Falar com ana@exemplo.com ou 111.222.333-44 sobre a entrega.')])],
      historico: [{ papel: 'usuario', texto: 'quero garantia maior' }, { papel: 'usuario', texto: 'dois seguidos' }, { papel: 'assistente', texto: 'ok, qual prazo? CPF 555.666.777-88' }],
      mensagem: 'meu e-mail é eu@exemplo.com, ponha 36 meses',
    });
    const c = h.chamadas[0].corpo;
    const msg = c.messages[0].content as string;
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].role).toBe('user');
    expect(msg).not.toContain('João da Silva');
    expect(msg).not.toContain('123.456.789-00');
    expect(msg).not.toContain('99.999,00');
    expect(msg).toContain('[travado: partes]');
    expect(msg).not.toMatch(/ana@exemplo|111\.222\.333-44|eu@exemplo|555\.666\.777-88/);
    expect(msg).toContain('CONVERSA ANTERIOR');
    expect(msg).toContain('Consultor: dois seguidos');
    expect(msg).toContain('Você: ok, qual prazo?');
  });
  it('o corpo da chamada: Opus 5.5 com plano B, saída estruturada, cache_control no sistema e conteúdo estático', async () => {
    fila(ia());
    await ok();
    fila(ia());
    await ok({ mensagem: 'outra mensagem, mesmo sistema' });
    const [a, b] = h.chamadas.map(c => c.corpo);
    expect(a.model).toBe('claude-opus-5-5');
    expect(a.output_config.effort).toBe('low');
    expect(a.output_config.format).toBeTruthy();
    expect(a.max_tokens).toBe(16000);
    expect(a.system).toEqual([{ type: 'text', text: expect.stringContaining('agente de contratos da NEXUS'), cache_control: { type: 'ephemeral' } }]);
    expect(JSON.stringify(a.system)).toBe(JSON.stringify(b.system));        // byte a byte igual: é o que o cache exige
    expect(a.system[0].text).not.toContain('outra mensagem');
  });
  it('CONTRATO_AGENTE_EFFORT troca o esforço; valor estranho cai no padrão', async () => {
    process.env.CONTRATO_AGENTE_EFFORT = 'high';
    fila(ia());
    await ok();
    process.env.CONTRATO_AGENTE_EFFORT = 'ultra';
    fila(ia());
    await ok();
    expect(h.chamadas.map(c => c.corpo.output_config.effort)).toEqual(['high', 'low']);
  });
  it('esforço: mudança rápida é low; revisar, híbrido aberto e mensagem sobre híbrido usam medium, trocável por CONTRATO_AGENTE_EFFORT_REVISAR', async () => {
    const hibridoClausulas = [...completo().map(c => ({ ...c, modelo: 'completo' })), ...arrend().map(c => ({ ...c, modelo: 'arrend' }))];
    for (const extra of [{}, { modo: 'normal' }, { modo: 'revisar' }, { tipo: null, hibrido: { tipos: ['completo', 'arrend'] }, clausulas: hibridoClausulas }, { mensagem: 'monte o contrato híbrido' }]) {
      fila(ia());
      await ok(extra);
    }
    expect(h.chamadas.map(c => c.corpo.output_config.effort)).toEqual(['low', 'low', 'medium', 'medium', 'medium']);
    h.chamadas.length = 0;
    process.env.CONTRATO_AGENTE_EFFORT_REVISAR = 'high';
    fila(ia());
    await ok({ modo: 'revisar' });
    process.env.CONTRATO_AGENTE_EFFORT_REVISAR = 'ultra';
    fila(ia());
    await ok({ modo: 'revisar' });
    expect(h.chamadas.map(c => c.corpo.output_config.effort)).toEqual(['high', 'medium']);
    expect(h.chamadas[0].corpo.messages[0].content).toContain('MODO: revisar');
  });
  it('o modo inválido é 400; resposta passa de 400 caracteres é cortada em fim de frase; no máximo 6 achados', async () => {
    expect(PedidoAgente.safeParse({ ...corpo(), modo: 'turbo' }).success).toBe(false);
    fila(ia({
      resposta: 'Frase curta de teste aqui. '.repeat(40),
      achados: Array.from({ length: 9 }, (_, i) => ({ texto: `achado número ${i}`, acoes: [] })),
    }));
    const r = await ok();
    expect(r.resposta.length).toBeLessThanOrEqual(400);
    expect(r.resposta.endsWith('.')).toBe(true);
    expect(r.achados).toHaveLength(6);
  });
  it('o prompt traz as duas famílias, a base da ligação nova, o estilo e o aviso de onde preencher o que não é campo', () => {
    for (const trecho of ['CESSÃO / ARRENDAMENTO DE ÁREA', 'a NEXUS/AIOROS NÃO é parte', 'FORNECIMENTO E INSTALAÇÃO', 'REN ANEEL 1.000/2021, art. 67, IX', 'arts. 12 e 14',
      '75 kW', 'MP 2.200-2, art. 10, § 2º', 'No modo REVISAR de uma cessão', 'Matrícula nº', 'Cartório de registro de imóveis', 'Inscrição do IPTU', 'O cedente é', 'VALOR E PERCENTUAL SÓ MUDAM PELO CAMPO']) {
      expect(SISTEMA_AGENTE, trecho).toContain(trecho);
    }
    expect(SISTEMA_AGENTE).not.toContain('"id":"ctr-arr-relacao"');
    expect(SISTEMA_AGENTE).not.toContain('"id":"ctr-ta-matricula"');
  });
  it('modelo inexistente (404): tenta o plano B; o uso do cache vai para o log sem texto do usuário', async () => {
    h.fila.push({ erro: Object.assign(new Error('model: claude-opus-5-5'), { status: 404 }) });
    fila(ia());
    const r = await ok({ mensagem: 'texto-secreto-do-consultor' });
    expect(h.chamadas.map(c => c.corpo.model)).toEqual(['claude-opus-5-5', 'claude-opus-5']);
    expect(r.modelo_ia).toBe('claude-opus-5');
    const log = JSON.stringify(h.logs);
    expect(log).toContain('cache_criado');
    expect(log).not.toContain('texto-secreto-do-consultor');
    expect(log).not.toContain('Uberlândia');
  });
  it('o esquema de saída é aceito pelo formato estruturado: objetos fechados e sem union nas ações', () => {
    const fmt: any = zodOutputFormat(SaidaAgenteIa);
    const json = JSON.stringify(fmt.schema ?? fmt);
    expect(json).not.toMatch(/"oneOf"|"prefixItems"|"minItems"|"maxItems"|"minLength"|"maxLength"|"patternProperties"/);
  });
  it('erro da IA vira 502 genérico, sem vazar a mensagem; recusa e corte têm mensagem própria; saída fora do formato é 502', async () => {
    h.fila.push({ erro: new Error('boom SEGREDO-INTERNO') });
    expect(await chamar()).toEqual({ ok: false, status: 502, erro: 'A IA não respondeu agora. Tente de novo em instantes.' });
    h.fila.push({ saida: ia(), parada: 'refusal' });
    expect(await chamar()).toMatchObject({ ok: false, status: 422 });
    h.fila.push({ saida: ia(), parada: 'max_tokens' });
    expect(await chamar()).toMatchObject({ ok: false, status: 502 });
    h.fila.push({ saida: { lixo: true } });
    expect(await chamar()).toMatchObject({ ok: false, status: 502, erro: 'A IA respondeu fora do formato. Tente de novo.' });
  });
  it('modelo desconhecido e híbrido inválido na entrada: 400 antes de chamar a IA', async () => {
    expect(await chamar({ tipo: 'foo' })).toMatchObject({ ok: false, status: 400 });
    expect(await chamar({ tipo: null, hibrido: { tipos: ['completo', 'termo_inv'] } })).toMatchObject({ ok: false, status: 400 });
    expect(h.chamadas).toHaveLength(0);
  });
});

// ── Rotas ────────────────────────────────────────────────────────────────────
describe('rotas do agente', () => {
  const r = Router();
  mountContratoAgente(r);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/gerador', r);
  const post = (url: string, corpoReq: unknown, auth: string | null = 'Bearer tk-nilce') => {
    const q = request(app).post('/gerador' + url);
    if (auth) q.set('Authorization', auth);
    return q.send(corpoReq as object);
  };

  it('GET /gerador/contrato/agente/campos: só consultor, devolve a lista branca', async () => {
    expect((await request(app).get('/gerador/contrato/agente/campos')).status).toBe(401);
    const res = await request(app).get('/gerador/contrato/agente/campos').set('Authorization', 'Bearer tk-nilce');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.campos.length).toBe(CAMPOS_AGENTE.length);
    expect(res.body.campos.find((c: any) => c.id === 'ctr-total')).toMatchObject({ tipo: 'dinheiro', sensivel: true, modelos: ['completo'], espelho: true });
    expect(res.body.campos.find((c: any) => c.id === 'ctr-mostra-pct')).toMatchObject({ tipo: 'opcao', opcoes: ['mostrar', 'omitir'], valoresHtml: { mostrar: '1', omitir: '' } });
    expect(h.chamadas).toHaveLength(0);
  });

  it('POST /contrato/agente: sem login 401, corpo inválido 400, e o 200 traz o contrato inteiro da resposta', async () => {
    expect((await post('/contrato/agente', corpo(), null)).status).toBe(401);
    expect((await post('/contrato/agente', corpo(), 'Bearer qualquer')).status).toBe(401);
    const invalido = await post('/contrato/agente', { ...corpo(), mensagem: '' });
    expect(invalido.status).toBe(400);
    expect(invalido.body.error).toBe('Pedido inválido.');
    expect((await post('/contrato/agente', { ...corpo(), tipo: 'foo' })).status).toBe(400);
    expect(h.chamadas).toHaveLength(0);
    fila(ia({ acoes: [campo('ctr-garantia', '36')], resposta: 'Garantia de 36 meses.' }));
    const res = await post('/contrato/agente', corpo());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, resposta: 'Garantia de 36 meses.', pergunta: null, avisos: [], conflitos: [], bloqueado: false, continuar: false, achados: [],
      modelo_ia: 'claude-opus-5-5',
    });
    expect(res.body.acoes).toEqual([{ tipo: 'campo', id: 'ctr-garantia', rotulo: 'Garantia da instalação', valor: '36', antes: null, confirmar: false }]);
    expect(typeof res.body.ms).toBe('number');
    expect(res.body.aviso_juridico).toMatch(/advogado/);
  });

  it('corpo acima de 250 KB: 413, sem chamar a IA', async () => {
    const grande = Array.from({ length: 12 }, (_, i) => cl(`c${i}`, 'Cláusula', Array.from({ length: 40 }, (_, j) => it_(`c${i}.${j}`, 'x'.repeat(6000)))));
    const res = await post('/contrato/agente', corpo({ clausulas: grande }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Contrato grande demais para mandar à IA.' });
    expect(h.chamadas).toHaveLength(0);
  });

  it('erro da IA vira 502 genérico na rota', async () => {
    h.fila.push({ erro: new Error('boom SEGREDO-INTERNO') });
    h.fila.push({ erro: new Error('boom SEGREDO-INTERNO') });
    const res = await post('/contrato/agente', corpo());
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'A IA não respondeu agora. Tente de novo em instantes.' });
  });

  it('limite por e-mail do consultor: 30 em 5 minutos, o 31º dá 429 no formato { error }, e outro consultor segue livre', async () => {
    for (let i = 0; i < 31; i++) fila(ia());
    fila(ia());
    for (let i = 0; i < 30; i++) {
      const res = await post('/contrato/agente', corpo(), 'Bearer tk-limite');
      expect(res.status, `pedido ${i + 1}`).toBe(200);
    }
    const bloqueado = await post('/contrato/agente', corpo(), 'Bearer tk-limite');
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body).toEqual({ error: expect.stringMatching(/Muitos pedidos/) });
    expect(h.chamadas).toHaveLength(30);                        // o 31º nem chegou à IA
    const outro = await post('/contrato/agente', corpo(), 'Bearer tk-outro');
    expect(outro.status).toBe(200);
  });

  it('POST /contrato/conflitos: sem IA, bloqueia percentual + valor fixo e libera o contrato limpo', async () => {
    const sujo = await post('/contrato/conflitos', { tipo: 'arrend', clausulas: arrend() });
    expect(sujo.status).toBe(200);
    expect(sujo.body).toMatchObject({ ok: true, bloqueado: true });
    expect(sujo.body.conflitos[0]).toMatchObject({ origem: 'servidor', resolvido: false });
    const limpo = await post('/contrato/conflitos', { tipo: 'completo', clausulas: completo() });
    expect(limpo.body).toEqual({ ok: true, conflitos: [], bloqueado: false });
    expect(h.chamadas).toHaveLength(0);
    expect((await post('/contrato/conflitos', { tipo: 'completo', clausulas: completo() }, null)).status).toBe(401);
    expect((await post('/contrato/conflitos', { tipo: 'foo', clausulas: [] })).status).toBe(400);
    expect((await post('/contrato/conflitos', { hibrido: { tipos: ['completo', 'termo_arr'] }, clausulas: [] })).status).toBe(400);
  });
});

describe('vigência x renovação', () => {
  const prazo = () => cl('prazo', 'Do prazo', [
    it_('prazo.vigencia', 'O contrato vale pelo prazo mínimo de <b>60 meses</b> de funcionamento do PONTO.', { campo: 'Arrendamento > Prazo mínimo' }),
    it_('prazo.firme', 'Durante esse prazo, nenhuma das partes pode encerrar o contrato sem motivo.'),
    it_('prazo.renovacao', 'Ao fim do prazo mínimo, o contrato se renova automaticamente por <b>60 meses</b>, nas mesmas condições. Nova vigência de 12 meses só por acordo.', { campo: 'Arrendamento > Renova sozinho por mais' }),
    it_('prazo.implantacao', 'Da assinatura ao início do funcionamento corre a fase de obra, de até <b>180 dias</b>.', { campo: 'Arrendamento > Fase de obra' }),
  ]);
  it('renovação e prorrogação não são uma segunda vigência (o arrendamento real não bloqueia)', () => {
    const rescisao = cl('rescisao', 'Da rescisão', [it_('rescisao.cedente', 'O custo é amortizado de forma linear pelo prazo mínimo da {{i:prazo.vigencia}}, e a renovação da {{i:prazo.renovacao}} não muda isso.')]);
    const renovacao = cl('renovacao', 'Da renovação', [it_('renovacao.1', 'O prazo de vigência renova-se por igual período, nas mesmas condições.'), it_('renovacao.2', 'A prorrogação depende de acordo escrito; a vigência de 12 meses se renova.')]);
    const r = checarConflitos(PedidoConflitos.parse({ tipo: 'arrend', clausulas: [prazo(), rescisao, renovacao] }));
    expect(r).toEqual({ ok: true, conflitos: [], bloqueado: false });
  });
  it('segunda vigência real em texto continua bloqueando mesmo com "prorrogável"/"renovando-se"; "renova-se por igual período" sozinha não', () => {
    const com = (texto: string) => checarConflitos(PedidoConflitos.parse({ tipo: 'arrend', clausulas: [prazo(), cl('extra', 'Das condições', [it_('extra.1', texto)])] }));
    for (const t of ['O prazo de vigência será de 36 meses, prorrogável por igual período.', 'Este contrato vigerá por 24 meses, renovando-se automaticamente.',
      'O prazo de vigência é de 36 meses; a prorrogação depende de acordo.']) {
      const r = com(t);
      expect(r.ok && r.bloqueado, t).toBe(true);
    }
    for (const t of ['O prazo de vigência renova-se por igual período.', 'Renova-se por igual período, nas mesmas condições.', 'A prorrogação do prazo de vigência depende de acordo escrito.']) {
      expect(com(t), t).toEqual({ ok: true, conflitos: [], bloqueado: false });
    }
  });
  it('o mesmo no híbrido: vigência real em texto numa Parte bloqueia, renovação sozinha não', () => {
    const hib = (texto: string) => checarConflitos(PedidoConflitos.parse({
      hibrido: { tipos: ['completo', 'arrend'] },
      clausulas: [...completo().map(c => ({ ...c, modelo: 'completo' })), { ...prazo(), modelo: 'arrend' }, { ...cl('extra', 'Das condições', [it_('extra.1', texto)]), modelo: 'arrend' }],
    }));
    const a = hib('O prazo de vigência será de 36 meses, prorrogável por igual período.');
    expect(a.ok && a.bloqueado).toBe(true);
    expect(a.ok && a.conflitos[0].descricao).toMatch(/Parte II.*vigência/);
    const b = hib('Este contrato vigerá por 24 meses, renovando-se automaticamente.');
    expect(b.ok && b.bloqueado).toBe(true);
    expect(hib('O prazo de vigência renova-se por igual período.')).toEqual({ ok: true, conflitos: [], bloqueado: false });
  });
  it('uma segunda vigência de verdade continua bloqueando', () => {
    const outra = cl('vig', 'Da vigência do contrato', [it_('vig.1', 'Dois anos.')]);
    const r = checarConflitos(PedidoConflitos.parse({ tipo: 'arrend', clausulas: [prazo(), outra] }));
    expect(r.ok && r.bloqueado).toBe(true);
    expect(r.ok && r.conflitos[0].descricao).toMatch(/mais de um prazo de vigência/);
  });
});

describe('checarConflitos no híbrido', () => {
  it('dois foros (um por modelo) bloqueiam; as comuns contam para as duas Partes', () => {
    const doisForos = [
      ...completo().map(c => ({ ...c, modelo: 'completo' })),
      { modelo: 'arrend', key: 'foro', titulo: 'Do foro', itens: [it_('foro.comarca', 'Foro de Uberaba/MG.', { campo: 'Foro' })] },
    ];
    const r = checarConflitos(PedidoConflitos.parse({ hibrido: { tipos: ['completo', 'arrend'] }, clausulas: doisForos }));
    expect(r).toMatchObject({ ok: true, bloqueado: true });
    if (r.ok) expect(r.conflitos.map(c => c.descricao).join(' ')).toMatch(/foros eleitos/);
    const umForo = checarConflitos(PedidoConflitos.parse({
      hibrido: { tipos: ['completo', 'arrend'] },
      clausulas: [...completo(), ...arrend().map(c => ({ ...c, modelo: 'arrend' }))].map((c: any, i, a) => (c.modelo ? c : { ...c, modelo: null })),
    }));
    expect(umForo.ok).toBe(true);
  });
});
