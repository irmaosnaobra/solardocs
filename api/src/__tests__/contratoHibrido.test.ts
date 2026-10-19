import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Contrato híbrido (dois modelos num papel): combinações, plano da IA, validação no servidor, conflitos, plano B do modelo
// e a rota. A Anthropic, o login, o limite de IA e o log são simulados; nenhuma chamada sai para a rede. Dados inventados.

type Entrada = { erro?: unknown; saida?: unknown; parada?: string };
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
            return { stop_reason: e.parada ?? 'end_turn', parsed_output: e.saida, usage: { input_tokens: 10, output_tokens: 5 } };
          },
        };
      },
    },
  }),
}));
vi.mock('../middleware/rateLimiter', () => ({
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => token === 'tk-nilce'
        ? { data: { user: { email: 'nilce@irmaosnaobra.app', email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
        : { data: { user: null }, error: { message: 'jwt' } }),
    },
  },
}));
vi.mock('../utils/supabase', () => ({ supabase: {} }));

import {
  PedidoHibrido, SaidaHibridoIa, pedirHibrido, validarCombinacao, montarPlano, AUTONOMIA_ITENS, AUTONOMIA_TITULO, AVISO_JURIDICO,
  type PedidoHibrido as PedidoHibridoT,
} from '../services/gerador/contratoHibrido';
import { pedirMudancaContrato, MODELO_CONTRATO_IA, MODELO_PLANO_B_CONTRATO, PedidoContratoIa } from '../services/gerador/contratoIa';
import { mountContratoHibrido } from '../routes/geradorContratoHibrido';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const it_ = (key: string, html: string, extra: { travado?: boolean; campo?: string } = {}) =>
  ({ key, html, travado: !!extra.travado, ...(extra.campo ? { campo: extra.campo } : {}) });
const cl = (key: string, titulo: string, itens: ReturnType<typeof it_>[]) => ({ key, titulo, itens });

const PII = 'João da Silva, CPF 123.456.789-00, rua das Flores 10';

const completo = () => [
  cl('partes', 'Das partes', [it_('partes.1', PII, { travado: true, campo: 'partes' })]),
  cl('objeto', 'Do objeto', [it_('objeto.1', 'Instalação do carregador.')]),
  cl('preco', 'Do preço e do pagamento', [
    it_('preco.total', 'R$ 99.999,00 secreto', { travado: true, campo: 'preço total' }),
    it_('preco.mora', 'Multa de 2% ao mês e juros de 1% em caso de atraso.'),
  ]),
  cl('garantia', 'Da garantia', [it_('garantia.1', 'Garantia de 24 meses.', { campo: 'garantia' })]),
  cl('lgpd', 'Da proteção de dados', [it_('lgpd.1', 'As partes tratam dados conforme a LGPD.')]),
  cl('foro', 'Do foro', [it_('foro.1', 'Fica eleito o foro de Uberlândia.', { campo: 'foro' })]),
  cl('assinaturas', 'Das assinaturas', [it_('assinaturas.1', 'Assinatura de fulano', { travado: true, campo: 'assinaturas' })]),
];
const arrend = () => [
  cl('partes', 'Das partes', [it_('partes.1', PII, { travado: true, campo: 'partes' })]),
  cl('objeto', 'Do objeto', [it_('objeto.1', 'Cessão da área.')]),
  cl('remuneracao', 'Da remuneração', [
    it_('rem.pct', 'ignorado', { travado: true, campo: 'percentual da remuneração' }),
    it_('rem.piso', 'ignorado', { travado: true, campo: 'piso mensal' }),
  ]),
  cl('vigencia', 'Da vigência', [it_('vigencia.1', 'Vigência de 10 anos.', { campo: 'vigência' })]),
  cl('lgpd', 'Da proteção de dados', [it_('lgpd.1', 'LGPD da cessão.')]),
  cl('foro', 'Do foro', [it_('foro.1', 'Fica eleito o foro de Uberaba.', { campo: 'foro' })]),
  cl('assinaturas', 'Das assinaturas', [it_('assinaturas.1', 'Assinatura de ciclano', { travado: true, campo: 'assinaturas' })]),
];
const corpo = (extra: Partial<PedidoHibridoT> = {}): PedidoHibridoT => ({
  tipos: ['completo', 'arrend'], modelos: { completo: completo(), arrend: arrend() }, pedido: 'Junte a obra com a cessão.', ...extra,
});

const op = (o: Record<string, unknown>) => ({ alvo: null, depois_de: null, id_novo: null, titulo: null, texto: null, itens: null, modelo: 'completo', ...o });
/** O plano que a IA devolveria num dia bom. */
const planoIa = (sobre: Partial<SaidaHibridoIa> = {}): SaidaHibridoIa => ({
  partes_titulos: [{ modelo: 'completo', titulo: 'Obra do eletroposto' }, { modelo: 'arrend', titulo: 'Operação do eletroposto' }],
  comuns: [
    { modelo: 'completo', key: 'partes', posicao: 'antes' }, { modelo: 'arrend', key: 'partes', posicao: 'antes' },
    { modelo: 'completo', key: 'lgpd', posicao: 'depois' }, { modelo: 'completo', key: 'foro', posicao: 'depois' },
    { modelo: 'completo', key: 'assinaturas', posicao: 'depois' }, { modelo: 'arrend', key: 'assinaturas', posicao: 'depois' },
  ],
  secoes: [
    { modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia'] },
    { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] },
  ],
  operacoes: [], conflitos: [], avisos: [], recusa: null, ...sobre,
} as SaidaHibridoIa);

const fila = (saida: unknown, mais: Partial<Entrada> = {}) => { h.fila.push({ saida, ...mais }); };
const chamar = async (c = corpo()) => pedirHibrido(PedidoHibrido.parse(c));
const ok = async (c = corpo()) => {
  const r = await chamar(c);
  if (!r.ok) throw new Error(`esperava ok, veio ${r.status} ${r.erro}`);
  return r;
};

beforeEach(() => { h.fila.length = 0; h.chamadas.length = 0; h.logs.length = 0; delete process.env.CONTRATO_IA_MODELO; });
afterEach(() => { delete process.env.CONTRATO_IA_MODELO; });

// ── Combinações ──────────────────────────────────────────────────────────────
describe('combinações de modelos', () => {
  it('aceita as 9 combinações de dois modelos distintos entre completo, socio50 OU cotas, arrend e equip', () => {
    const base = ['completo', 'socio50', 'cotas', 'arrend', 'equip'];
    let validas = 0;
    for (const a of base) for (const b of base) {
      if (a >= b) continue;
      const r = validarCombinacao([a, b]);
      if (r.ok) validas++;
      else expect([a, b].sort()).toEqual(['cotas', 'socio50']);
    }
    expect(validas).toBe(9);
  });
  it('recusa com motivo: o mesmo modelo duas vezes, socio50 com cotas, termos, tamanho errado e modelo desconhecido', () => {
    const motivo = (t: string[]) => { const r = validarCombinacao(t); return r.ok ? '' : r.motivo; };
    expect(motivo(['arrend', 'arrend'])).toMatch(/diferentes/);
    expect(motivo(['socio50', 'cotas'])).toMatch(/não se combinam/);
    expect(motivo(['cotas', 'socio50'])).toMatch(/não se combinam/);
    expect(motivo(['termo_arr', 'completo'])).toMatch(/termos/);
    expect(motivo(['completo', 'termo_inv'])).toMatch(/termos/);
    expect(motivo(['completo'])).toMatch(/exatamente dois/);
    expect(motivo(['completo', 'arrend', 'equip'])).toMatch(/exatamente dois/);
    expect(motivo(['completo', 'foguete'])).toMatch(/desconhecido/);
  });
  it('pedirHibrido não chama a IA quando a combinação é inválida ou os modelos não batem com os tipos', async () => {
    const a = await chamar(corpo({ tipos: ['socio50', 'cotas'] }));
    expect(a).toMatchObject({ ok: false, status: 400 });
    const b = await chamar(corpo({ modelos: { completo: completo() } }));
    expect(b).toMatchObject({ ok: false, status: 400 });
    const c = await chamar(corpo({ modelos: { completo: completo(), arrend: arrend(), equip: completo() } }));
    expect(c).toMatchObject({ ok: false, status: 400 });
    const d = await chamar(corpo({ modelos: { completo: [...completo(), completo()[0]], arrend: arrend() } }));
    expect(d).toMatchObject({ ok: false, status: 400 });
    expect(h.chamadas).toHaveLength(0);
  });
});

// ── O que vai ao modelo ──────────────────────────────────────────────────────
describe('o que vai ao modelo', () => {
  it('nenhum conteúdo de item travado chega à IA: o servidor troca por marcador, mesmo que o front mande o dado', async () => {
    fila(planoIa());
    await ok();
    const msg = h.chamadas[0].corpo.messages[0].content as string;
    expect(msg).not.toContain('João da Silva');
    expect(msg).not.toContain('123.456.789-00');
    expect(msg).not.toContain('secreto');
    expect(msg).toContain('[travado: partes]');
    expect(msg).toContain('[travado: preço total]');
    expect(msg).toContain('Multa de 2% ao mês');          // o item livre segue inteiro
    expect(h.chamadas[0].corpo.system).not.toContain('João');
  });
  it('o log não leva pedido nem texto de contrato', async () => {
    fila(planoIa());
    await ok(corpo({ pedido: 'Cliente Maria Souza quer foro em Uberaba' }));
    const tudo = JSON.stringify(h.logs);
    expect(tudo).not.toContain('Maria Souza');
    expect(tudo).not.toContain('foro de Uberlândia');
  });
  it('o prompt de sistema explica a venda casada, a autonomia, os conflitos e a recusa', async () => {
    fila(planoIa());
    await ok();
    const s = h.chamadas[0].corpo.system as string;
    expect(s).toMatch(/art\. 39, I/);
    expect(s).toMatch(/venda casada/);
    expect(s).toMatch(/Uma qualificação só, um foro só/);
    expect(s).toMatch(/percentual E por valor fixo/);
    expect(s).toMatch(/Quando recusar/);
    expect(s).not.toMatch(/[–—]/);
  });
  it('usa claude-opus-5-5 por padrão, com streaming e saída estruturada', async () => {
    fila(planoIa());
    const r = await ok();
    expect(h.chamadas[0].corpo.model).toBe('claude-opus-5-5');
    expect(h.chamadas[0].corpo.output_config.format).toBeTruthy();
    expect(r.modelo_ia).toBe('claude-opus-5-5');
  });
});

// ── Plano ────────────────────────────────────────────────────────────────────
describe('plano montado', () => {
  it('caminho feliz: títulos com Parte I e II, comuns, seções, autonomia, aviso jurídico, sem bloqueio', async () => {
    fila(planoIa());
    const r = await ok();
    expect(r.bloqueado).toBe(false);
    expect(r.partes_titulos).toEqual({ completo: 'Parte I. Obra do eletroposto', arrend: 'Parte II. Operação do eletroposto' });
    expect(r.comuns).toHaveLength(6);
    expect(r.secoes).toEqual([
      { modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia'] },
      { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] },
    ]);
    expect(r.aviso_juridico).toBe(AVISO_JURIDICO);
    expect(r.conflitos).toEqual([]);
    // O foro e a LGPD repetidos do arrend ficaram de fora e o consultor é avisado.
    expect(r.avisos.join(' ')).toMatch(/Ficaram de fora do contrato \(Parte II\): Da proteção de dados; Do foro/);
  });
  it('arrend com percentual e piso mensal, e completo com multa de 2%, NÃO são conflito de remuneração', async () => {
    fila(planoIa());
    const r = await ok();
    expect(r.conflitos.filter(c => /remunera/.test(c.descricao))).toEqual([]);
    expect(r.bloqueado).toBe(false);
  });
  it('o prefixo Parte I/II é do servidor: título da IA com prefixo errado é corrigido, e título vazio vira o padrão', async () => {
    fila(planoIa({ partes_titulos: [{ modelo: 'completo', titulo: 'Parte II. obra' }, { modelo: 'arrend', titulo: '   ' }] }));
    const r = await ok();
    expect(r.partes_titulos.completo).toBe('Parte I. Obra');
    expect(r.partes_titulos.arrend).toBe('Parte II. Cessão onerosa de área (arrendamento do ponto)');
  });
  it('chave que não existe no modelo de origem é ignorada, com aviso; a chave de OUTRO modelo também', async () => {
    fila(planoIa({
      secoes: [
        { modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia', 'nao_existe'] },
        { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia', 'garantia'] },     // garantia só existe no completo
      ],
    }));
    const r = await ok();
    expect(r.secoes[0].clausulas).not.toContain('nao_existe');
    expect(r.secoes[1].clausulas).not.toContain('garantia');
    expect(r.avisos.join(' ')).toMatch(/não existe no contrato \(nao_existe/);
    expect(r.avisos.join(' ')).toMatch(/não existe no contrato \(garantia, Parte II\)/);
  });
  it('cláusula travada que a IA deixou de fora volta para a Parte do próprio modelo, na ordem de origem', async () => {
    fila(planoIa({ secoes: [{ modelo: 'completo', clausulas: ['objeto', 'garantia'] }, { modelo: 'arrend', clausulas: ['objeto', 'vigencia'] }] }));
    const r = await ok();
    expect(r.secoes[0].clausulas).toEqual(['objeto', 'preco', 'garantia']);        // preco (travada) voltou entre objeto e garantia
    expect(r.secoes[1].clausulas).toEqual(['objeto', 'remuneracao', 'vigencia']);
    expect(r.avisos.join(' ')).toMatch(/"Do preço e do pagamento" é travada e a IA a tinha deixado de fora; ela voltou para a Parte I/);
  });
  it('assinaturas e partes de cada modelo nunca somem, mesmo que a IA os tire dos comuns', async () => {
    fila(planoIa({ comuns: [{ modelo: 'completo', key: 'foro', posicao: 'depois' }] }));
    const r = await ok();
    const todas = [...r.comuns.map(c => `${c.modelo}|${c.key}`), ...r.secoes.flatMap(s => s.clausulas.map(k => `${s.modelo}|${k}`))];
    for (const t of ['completo', 'arrend']) for (const k of ['partes', 'preco', 'assinaturas', 'remuneracao', 'objeto']) {
      if (t === 'completo' && k === 'remuneracao') continue;
      if (t === 'arrend' && k === 'preco') continue;
      expect(todas).toContain(`${t}|${k}`);
    }
  });
  it('cláusula duplicada no plano: fica a primeira ocorrência e avisa', async () => {
    fila(planoIa({
      comuns: [...planoIa().comuns, { modelo: 'completo', key: 'preco', posicao: 'antes' }],        // preco também está nas seções
    }));
    const r = await ok();
    const quantas = [...r.comuns.map(c => `${c.modelo}|${c.key}`), ...r.secoes.flatMap(s => s.clausulas.map(k => `${s.modelo}|${k}`))]
      .filter(x => x === 'completo|preco');
    expect(quantas).toHaveLength(1);
    expect(r.comuns.some(c => c.key === 'preco')).toBe(true);
    expect(r.secoes[0].clausulas).not.toContain('preco');
    expect(r.avisos.join(' ')).toMatch(/apareceu duas vezes/);
  });
  it('a mesma chave nos dois modelos (foro, partes) é tratada por par modelo+chave', async () => {
    fila(planoIa({ comuns: [...planoIa().comuns.filter(c => !(c.key === 'assinaturas')), { modelo: 'completo', key: 'assinaturas', posicao: 'depois' }] }));
    const r = await ok();
    // arrend|assinaturas, travada, voltou sozinha; completo|assinaturas não foi tomada como duplicata dela.
    expect(r.secoes[1].clausulas).toContain('assinaturas');
    expect(r.comuns.filter(c => c.key === 'partes')).toHaveLength(2);
  });
  it('cláusula nova da IA sem id ganha id do servidor e entra na Parte, depois da referência', async () => {
    fila(planoIa({
      operacoes: [op({ modelo: 'arrend', tipo: 'inserir_clausula', depois_de: 'objeto', titulo: 'Da manutenção preventiva', itens: ['Visita semestral.'] })] as any,
    }));
    const r = await ok();
    const nova = r.operacoes[0];
    expect(nova.id_novo).toMatch(/^hib\.arrend\.\d+$/);
    expect(r.secoes[1].clausulas).toEqual(['objeto', nova.id_novo, 'remuneracao', 'vigencia']);
  });
  it('mudança que mira um modelo fora do par é descartada com aviso', () => {
    const m = montarPlano(['completo', 'arrend'], { completo: completoMod(), arrend: arrendMod() }, planoIa({
      operacoes: [op({ modelo: 'equip', tipo: 'remover_item', alvo: 'x' })] as any,
    }));
    expect(m.ok && m.plano.operacoes).toEqual([]);
    expect(m.ok && m.plano.avisos.join(' ')).toMatch(/não está neste contrato/);
  });
});

// Os modelos internos para chamar `montarPlano` direto.
function modelosInternos(base: ReturnType<typeof completo>) {
  return base.map(c => {
    const itens = c.itens.map(i => ({ key: i.key, html: i.html, travado: i.travado, campo: (i as any).campo ?? null }));
    return { key: c.key, titulo: c.titulo, travada: itens.some(i => i.travado), itens };
  });
}
const completoMod = () => modelosInternos(completo());
const arrendMod = () => modelosInternos(arrend());

// ── Operações ────────────────────────────────────────────────────────────────
describe('operações do plano', () => {
  it('operação em alvo travado é descartada, por modelo, com aviso', async () => {
    fila(planoIa({
      operacoes: [
        op({ modelo: 'completo', tipo: 'substituir_item', alvo: 'preco.total', texto: 'R$ 1,00' }),
        op({ modelo: 'completo', tipo: 'remover_clausula', alvo: 'preco' }),
        op({ modelo: 'arrend', tipo: 'remover_item', alvo: 'rem.pct' }),
        op({ modelo: 'completo', tipo: 'substituir_item', alvo: 'garantia.1', texto: 'Garantia de <b>36 meses</b>.' }),
      ] as any,
    }));
    const r = await ok();
    expect(r.operacoes).toHaveLength(1);
    expect(r.operacoes[0]).toMatchObject({ tipo: 'substituir_item', alvo: 'garantia.1', modelo: 'completo' });
    expect(r.avisos.join(' ')).toMatch(/Parte I: Uma mudança não entrou \(substituir_item em preco\.total\)/);
    expect(r.avisos.join(' ')).toMatch(/Parte II: Uma mudança não entrou \(remover_item em rem\.pct\)/);
  });
  it('a chave é validada contra o modelo do alvo: rem.pct não existe no completo', async () => {
    fila(planoIa({ operacoes: [op({ modelo: 'completo', tipo: 'remover_item', alvo: 'rem.pct' })] as any }));
    const r = await ok();
    expect(r.operacoes).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/não existe/);
  });
  it('remover uma cláusula livre tira ela do plano sem aviso de chave inexistente', async () => {
    fila(planoIa({
      secoes: [{ modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia'] }, { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] }],
      operacoes: [op({ modelo: 'completo', tipo: 'remover_clausula', alvo: 'garantia' })] as any,
    }));
    const r = await ok();
    expect(r.secoes[0].clausulas).toEqual(['objeto', 'preco']);
    expect(r.avisos.join(' ')).not.toMatch(/não existe no contrato/);
  });
});

// ── Autonomia ────────────────────────────────────────────────────────────────
describe('cláusula de autonomia', () => {
  it('está em toda resposta, com o texto fixo do servidor, e a chave não colide com nenhum modelo', async () => {
    fila(planoIa());
    const r = await ok();
    expect(r.autonomia.titulo).toBe(AUTONOMIA_TITULO);
    expect(r.autonomia.itens).toEqual(AUTONOMIA_ITENS);
    expect(r.autonomia.posicao).toBe('antes');
    const chaves = new Set([...completo(), ...arrend()].flatMap(c => [c.key, ...c.itens.map(i => i.key)]));
    expect(chaves.has(r.autonomia.key)).toBe(false);
    const txt = r.autonomia.itens.join(' ');
    expect(txt).toMatch(/autônomos entre si/);
    expect(txt).toMatch(/não é condição/);
    expect(txt).toMatch(/não extingue o outro, salvo se as partes assim decidirem por escrito/);
    expect(txt).toMatch(/rescisão/);
  });
  it('a IA que tenta escrever a sua própria cláusula de autonomia é descartada, e a do sistema fica', async () => {
    fila(planoIa({
      operacoes: [op({ modelo: 'completo', tipo: 'inserir_clausula', depois_de: 'objeto', id_novo: 'autonomia', titulo: 'Da Autonomia', itens: ['Texto da IA.'] })] as any,
    }));
    const r = await ok();
    expect(r.operacoes).toEqual([]);
    expect(r.autonomia.itens).toEqual(AUTONOMIA_ITENS);
    expect(r.avisos.join(' ')).toMatch(/autonomia dos objetos/);
  });
  it('está presente até na recusa', async () => {
    fila(planoIa({ comuns: [], secoes: [], recusa: 'O pedido liga os dois objetos.' }));
    const r = await ok();
    expect(r.autonomia.itens).toEqual(AUTONOMIA_ITENS);
  });
  it('se um modelo já tem a chave padrão, o servidor escolhe outra', () => {
    const c = completoMod();
    c.push({ key: 'hibrido.autonomia', titulo: 'Qualquer', travada: false, itens: [{ key: 'hibrido.autonomia_', html: 'x', travado: false, campo: null }] });
    const m = montarPlano(['completo', 'arrend'], { completo: c, arrend: arrendMod() }, planoIa());
    expect(m.ok && m.plano.autonomia.key).toBe('hibrido.autonomia__');
  });
});

// ── Conflitos ────────────────────────────────────────────────────────────────
describe('conflitos', () => {
  const comItemNaRemuneracao = (texto: string) => planoIa({
    operacoes: [op({ modelo: 'arrend', tipo: 'inserir_item', depois_de: 'rem.pct', texto })] as any,
  });
  it('percentual e valor fixo para o mesmo objeto bloqueiam', async () => {
    fila(comItemNaRemuneracao('A CESSIONÁRIA pagará à CEDENTE remuneração fixa de R$ 2.000,00 por mês.'));
    const r = await ok();
    expect(r.bloqueado).toBe(true);
    const c = r.conflitos.find(x => /percentual e também por valor fixo/.test(x.descricao));
    expect(c).toMatchObject({ resolvido: false, origem: 'servidor' });
    expect(c!.descricao).toMatch(/Parte II/);
  });
  it('piso mensal e garantia não são valor fixo: o mesmo item com a palavra piso não bloqueia', async () => {
    fila(comItemNaRemuneracao('O piso mensal garantido é de R$ 2.000,00 por mês.'));
    const r = await ok();
    expect(r.bloqueado).toBe(false);
  });
  it('dois foros bloqueiam (os dois entram no plano)', async () => {
    fila(planoIa({ comuns: [...planoIa().comuns, { modelo: 'arrend', key: 'foro', posicao: 'depois' }] }));
    const r = await ok();
    expect(r.bloqueado).toBe(true);
    expect(r.conflitos.find(x => /2 foros eleitos/.test(x.descricao))).toMatchObject({ origem: 'servidor', resolvido: false });
  });
  it('foro em item de outra cláusula conta como foro (por chave ou campo)', async () => {
    const c = completoMod();
    c[1].itens.push({ key: 'objeto.foro', html: 'x', travado: false, campo: null });
    const m = montarPlano(['completo', 'arrend'], { completo: c, arrend: arrendMod() }, planoIa());
    expect(m.ok && m.plano.bloqueado).toBe(true);
  });
  it('"Disposições gerais e foro" vale pelos itens: sem o item do foro não é foro, com ele é', async () => {
    const gerais = (itens: Array<{ key: string; html: string }>) =>
      ({ key: 'gerais', titulo: 'Disposições gerais e foro', travada: false, itens: itens.map(i => ({ ...i, travado: false, campo: null })) });
    const plano = planoIa({ secoes: [{ modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia'] }, { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia', 'gerais'] }] });
    const sem = montarPlano(['completo', 'arrend'], { completo: completoMod(), arrend: [...arrendMod(), gerais([{ key: 'gerais.1', html: 'Tolerância não é renúncia.' }])] }, plano);
    expect(sem.ok && sem.plano.bloqueado).toBe(false);
    const com = montarPlano(['completo', 'arrend'], { completo: completoMod(), arrend: [...arrendMod(), gerais([{ key: 'gerais.1', html: 'x' }, { key: 'foro.comarca', html: 'Fica eleito o foro da comarca de Uberaba.' }])] }, plano);
    expect(com.ok && com.plano.conflitos.some(x => /2 foros eleitos/.test(x.descricao))).toBe(true);
  });
  it('duas vigências na mesma Parte bloqueiam: a comum conta para as duas Partes', async () => {
    const c = [...completoMod(), { key: 'vig', titulo: 'Da vigência do contrato', travada: false, itens: [{ key: 'vig.1', html: 'Dois anos.', travado: false, campo: null }] }];
    const m = montarPlano(['completo', 'arrend'], { completo: c, arrend: arrendMod() }, planoIa({
      comuns: [...planoIa().comuns, { modelo: 'completo', key: 'vig', posicao: 'depois' }],
    }));
    expect(m.ok && m.plano.bloqueado).toBe(true);
    expect(m.ok && m.plano.conflitos.some(x => /Parte II.*vigência/.test(x.descricao))).toBe(true);
    expect(m.ok && m.plano.conflitos.some(x => /Parte I\..*vigência/.test(x.descricao))).toBe(false);
  });
  it('duas cláusulas de multa na mesma Parte bloqueiam', async () => {
    const c = [...completoMod(),
      { key: 'multa1', titulo: 'Da multa por atraso', travada: false, itens: [{ key: 'm1', html: '2%.', travado: false, campo: null }] },
      { key: 'multa2', titulo: 'Da multa rescisória', travada: false, itens: [{ key: 'm2', html: '10%.', travado: false, campo: null }] }];
    const m = montarPlano(['completo', 'arrend'], { completo: c, arrend: arrendMod() }, planoIa({
      secoes: [{ modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia', 'multa1', 'multa2'] }, { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] }],
    }));
    expect(m.ok && m.plano.conflitos.some(x => /2 cláusulas de multa/.test(x.descricao))).toBe(true);
  });
  it('conflito da IA não resolvido bloqueia; resolvido (com o como) não bloqueia', async () => {
    fila(planoIa({ conflitos: [{ descricao: 'As duas partes dizem quem paga a energia.', resolvido: false, como: null }] }));
    const a = await ok();
    expect(a.bloqueado).toBe(true);
    expect(a.conflitos[0]).toMatchObject({ origem: 'ia', resolvido: false });
    fila(planoIa({ conflitos: [{ descricao: 'Dois foros.', resolvido: true, como: 'O pedido mandou usar Uberlândia.' }] }));
    const b = await ok();
    expect(b.bloqueado).toBe(false);
    expect(b.conflitos[0]).toMatchObject({ resolvido: true, como: 'O pedido mandou usar Uberlândia.' });
  });
  it('a IA diz que resolveu mas o plano ainda tem dois foros: a checagem do servidor bloqueia', async () => {
    fila(planoIa({
      comuns: [...planoIa().comuns, { modelo: 'arrend', key: 'foro', posicao: 'depois' }],
      conflitos: [{ descricao: 'Dois foros.', resolvido: true, como: 'Mantive os dois.' }],
    }));
    const r = await ok();
    expect(r.bloqueado).toBe(true);
  });
});

describe('travas nas operações da IA (autonomia e venda casada)', () => {
  const avisos = (r: { avisos: string[] }) => r.avisos.join(' ');
  it('autonomia: sem acento e em título, id, texto ou itens de QUALQUER operação, inclusive "Dos objetos autônomos"', async () => {
    fila(planoIa({
      operacoes: [
        op({ modelo: 'completo', tipo: 'inserir_clausula', depois_de: 'objeto', id_novo: 'x1', titulo: 'Dos objetos autônomos', itens: ['Texto.'] }),
        op({ modelo: 'completo', tipo: 'inserir_clausula', depois_de: 'objeto', id_novo: 'x2', titulo: 'Da separação', itens: ['Os objetos têm AUTONOMIA entre si.'] }),
        op({ modelo: 'completo', tipo: 'substituir_item', alvo: 'garantia.1', texto: 'Garantia, com autonomia dos objetos.' }),
        op({ modelo: 'arrend', tipo: 'inserir_item', depois_de: 'objeto.1', texto: 'Cada objeto é autônomo.' }),
        op({ modelo: 'arrend', tipo: 'renomear_clausula', alvo: 'objeto', titulo: 'Da Autonomia' }),
      ] as any,
    }));
    const r = await ok();
    expect(r.operacoes).toEqual([]);
    expect(avisos(r)).toMatch(/autonomia dos objetos/);
    expect(r.autonomia.itens).toEqual(AUTONOMIA_ITENS);
  });
  it('venda casada: texto que condiciona um objeto ao outro é descartado com aviso, em qualquer operação', async () => {
    fila(planoIa({
      operacoes: [
        op({ modelo: 'completo', tipo: 'substituir_item', alvo: 'garantia.1', texto: 'A garantia fica condicionada à contratação da operação do eletroposto.' }),
        op({ modelo: 'arrend', tipo: 'inserir_item', depois_de: 'objeto.1', texto: 'A cessão somente se aplica se o CEDENTE contratar a obra.' }),
        op({ modelo: 'completo', tipo: 'inserir_clausula', depois_de: 'objeto', id_novo: 'desc', titulo: 'Do desconto', itens: ['O desconto vale desde que contrate também a cessão da área.'] }),
        op({ modelo: 'completo', tipo: 'inserir_item', depois_de: 'garantia.1', texto: 'A obra só será executada se a operação for contratada.' }),
        op({ modelo: 'arrend', tipo: 'inserir_item', depois_de: 'vigencia.1', texto: 'Há obrigatoriedade de contratar o outro objeto.' }),
      ] as any,
    }));
    const r = await ok();
    expect(r.operacoes).toEqual([]);
    expect(avisos(r).match(/ligava um objeto ao outro/g)).toHaveLength(5);
  });
  it('mudança comum, com palavras parecidas mas sem ligar os objetos, passa', async () => {
    fila(planoIa({
      operacoes: [
        op({ modelo: 'completo', tipo: 'substituir_item', alvo: 'garantia.1', texto: 'Garantia de <b>36 meses</b>, condicionada à manutenção preventiva anual.' }),
        op({ modelo: 'arrend', tipo: 'inserir_item', depois_de: 'vigencia.1', texto: 'O prazo é vinculado ao número de série do carregador.' }),
      ] as any,
    }));
    const r = await ok();
    expect(r.operacoes).toHaveLength(2);
  });
});

describe('conflito pela origem, não pelo título renomeado', () => {
  const duasMultas = () => [...completoMod(),
    { key: 'multa1', titulo: 'Da multa por atraso', travada: false, itens: [{ key: 'm1', html: 'Dois por cento.', travado: false, campo: null }] },
    { key: 'multa2', titulo: 'Da multa rescisória', travada: false, itens: [{ key: 'm2', html: 'Dez por cento.', travado: false, campo: null }] }];
  const secComMultas = [
    { modelo: 'completo' as const, clausulas: ['objeto', 'preco', 'garantia', 'multa1', 'multa2'] },
    { modelo: 'arrend' as const, clausulas: ['objeto', 'remuneracao', 'vigencia'] },
  ];
  it('a IA renomeia "Da multa" para "Da mora" e a duplicata continua bloqueando', () => {
    const m = montarPlano(['completo', 'arrend'], { completo: duasMultas(), arrend: arrendMod() }, planoIa({
      secoes: secComMultas,
      operacoes: [op({ modelo: 'completo', tipo: 'renomear_clausula', alvo: 'multa2', titulo: 'Da mora' })] as any,
    }));
    expect(m.ok && m.plano.operacoes).toHaveLength(1);                       // a renomeação entrou
    expect(m.ok && m.plano.bloqueado).toBe(true);
    expect(m.ok && m.plano.conflitos.some(x => /2 cláusulas de multa/.test(x.descricao))).toBe(true);
  });
  it('a IA renomeia "Da vigência" para "Do prazo do contrato" e a duplicata continua bloqueando', () => {
    const c = [...completoMod(), { key: 'vig', titulo: 'Da vigência do contrato', travada: false, itens: [{ key: 'vig.1', html: 'Dois anos.', travado: false, campo: null }] }];
    const m = montarPlano(['completo', 'arrend'], { completo: c, arrend: arrendMod() }, planoIa({
      comuns: [...planoIa().comuns, { modelo: 'completo', key: 'vig', posicao: 'depois' }],
      operacoes: [op({ modelo: 'completo', tipo: 'renomear_clausula', alvo: 'vig', titulo: 'Do prazo do contrato' })] as any,
    }));
    expect(m.ok && m.plano.bloqueado).toBe(true);
    expect(m.ok && m.plano.conflitos.some(x => /Parte II.*vigência/.test(x.descricao))).toBe(true);
  });
  it('multa e vigência são reconhecidas pela chave do item (rescisao.multa, prazo.vigencia) e pelo texto', () => {
    const base = completoMod();
    const comMultaPorChave = [...base,
      { key: 'r1', titulo: 'Da rescisão', travada: false, itens: [{ key: 'rescisao.multa', html: 'x', travado: false, campo: null }] },
      { key: 'r2', titulo: 'Do encerramento', travada: false, itens: [{ key: 'r2.1', html: 'Em caso de rescisão, a parte que der causa paga multa de 10% sobre o valor do contrato.', travado: false, campo: null }] }];
    const m1 = montarPlano(['completo', 'arrend'], { completo: comMultaPorChave, arrend: arrendMod() }, planoIa({
      secoes: [{ modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia', 'r1', 'r2'] }, { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] }],
    }));
    expect(m1.ok && m1.plano.conflitos.some(x => /2 cláusulas de multa/.test(x.descricao))).toBe(true);
    const comVig = [...base,
      { key: 'p1', titulo: 'Dos prazos', travada: false, itens: [{ key: 'prazo.vigencia', html: 'x', travado: false, campo: null }] },
      { key: 'p2', titulo: 'Da duração', travada: false, itens: [{ key: 'p2.1', html: 'O contrato vigerá por 5 anos.', travado: false, campo: null }] }];
    const m2 = montarPlano(['completo', 'arrend'], { completo: comVig, arrend: arrendMod() }, planoIa({
      secoes: [{ modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia', 'p1', 'p2'] }, { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] }],
    }));
    expect(m2.ok && m2.plano.conflitos.some(x => /Parte I\..*vigência/.test(x.descricao))).toBe(true);
  });
  it('"sem multa" e menção solta a multa de mora não contam como segunda multa', () => {
    const c = [...completoMod(),
      { key: 'r1', titulo: 'Da rescisão', travada: false, itens: [{ key: 'r1.1', html: 'Qualquer parte pode encerrar sem multa se a obra não começar.', travado: false, campo: null }] }];
    const m = montarPlano(['completo', 'arrend'], { completo: c, arrend: arrendMod() }, planoIa({
      secoes: [{ modelo: 'completo', clausulas: ['objeto', 'preco', 'garantia', 'r1'] }, { modelo: 'arrend', clausulas: ['objeto', 'remuneracao', 'vigencia'] }],
    }));
    expect(m.ok && m.plano.bloqueado).toBe(false);
  });
});

describe('conflito da IA e do servidor na mesma categoria viram uma entrada só', () => {
  const comFixo = (conflitos: SaidaHibridoIa['conflitos']) => planoIa({
    operacoes: [op({ modelo: 'arrend', tipo: 'inserir_item', depois_de: 'rem.pct', texto: 'A CESSIONÁRIA pagará à CEDENTE remuneração fixa de R$ 2.000,00 por mês.' })] as any,
    conflitos,
  });
  it('percentual + fixo listado pela IA e achado pelo servidor aparece uma vez, origem ia+servidor, não resolvido', async () => {
    fila(comFixo([{ descricao: 'A remuneração da cessão aparece por percentual e por valor fixo.', resolvido: false, como: null }]));
    const r = await ok();
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ origem: 'ia+servidor', resolvido: false, como: null });
    expect(r.conflitos[0].descricao).toMatch(/percentual e por valor fixo/);       // fica o texto da IA
    expect(r.bloqueado).toBe(true);
    expect(r.conflitos[0]).not.toHaveProperty('categoria');
  });
  it('mesmo se a IA disse "resolvido", a junção volta para não resolvido', async () => {
    fila(comFixo([{ descricao: 'Remuneração por percentual e valor fixo na Parte II.', resolvido: true, como: 'Mantive os dois.' }]));
    const r = await ok();
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ origem: 'ia+servidor', resolvido: false, como: null });
  });
  it('categoria diferente, ou outra Parte, não se junta', async () => {
    fila(comFixo([{ descricao: 'Há dois prazos de vigência.', resolvido: false, como: null }]));
    const a = await ok();
    expect(a.conflitos.map(c => c.origem).sort()).toEqual(['ia', 'servidor']);
    fila(comFixo([{ descricao: 'Remuneração por percentual e valor fixo na Parte I.', resolvido: false, como: null }]));
    const b = await ok();
    expect(b.conflitos.map(c => c.origem).sort()).toEqual(['ia', 'servidor']);
  });
});

// ── Recusa e formato ─────────────────────────────────────────────────────────
describe('recusa e resposta fora do formato', () => {
  it('recusa com plano vazio: bloqueado, sem consertar nada', async () => {
    fila(planoIa({ comuns: [], secoes: [], recusa: 'Não dá para condicionar a obra à operação.' }));
    const r = await ok();
    expect(r.bloqueado).toBe(true);
    expect(r.recusa).toMatch(/condicionar/);
    expect(r.comuns).toEqual([]);
    expect(r.secoes.every(s => s.clausulas.length === 0)).toBe(true);     // as travadas NÃO foram recolocadas
    expect(r.aviso_juridico).toBe(AVISO_JURIDICO);
  });
  it('plano vazio sem recusa é resposta fora do formato (502)', async () => {
    fila(planoIa({ comuns: [], secoes: [] }));
    expect(await chamar()).toMatchObject({ ok: false, status: 502 });
  });
  it('saída que não bate com o schema, recusa do modelo e corte por tamanho', async () => {
    fila({ lixo: true });
    expect(await chamar()).toMatchObject({ ok: false, status: 502, erro: expect.stringMatching(/fora do formato/) });
    fila(planoIa(), { parada: 'refusal' });
    expect(await chamar()).toMatchObject({ ok: false, status: 422 });
    fila(planoIa(), { parada: 'max_tokens' });
    expect(await chamar()).toMatchObject({ ok: false, status: 502, erro: expect.stringMatching(/cortada/) });
  });
  it('o schema de saída é aceito pela API: objetos fechados, sem record, tupla nem propriedades livres', () => {
    const f: any = zodOutputFormat(SaidaHibridoIa as any);
    const json = JSON.stringify(f.schema);
    expect(json).not.toMatch(/prefixItems|patternProperties|propertyNames|"additionalProperties":true|"additionalProperties":\{/);
    const objetos: any[] = [];
    const anda = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'object') objetos.push(n);
      Object.values(n).forEach(anda);
    };
    anda(f.schema);
    expect(objetos.length).toBeGreaterThan(5);
    for (const o of objetos) expect(o.additionalProperties).toBe(false);
  });
});

// ── Plano B do modelo ────────────────────────────────────────────────────────
describe('troca de modelo', () => {
  it('modelo inexistente (404): tenta o plano B claude-opus-5 e o resultado volta normal', async () => {
    h.fila.push({ erro: Object.assign(new Error('model: claude-opus-5-5'), { status: 404 }) });
    fila(planoIa());
    const r = await ok();
    expect(h.chamadas.map(c => c.corpo.model)).toEqual(['claude-opus-5-5', 'claude-opus-5']);
    expect(r.modelo_ia).toBe('claude-opus-5');
    expect(MODELO_PLANO_B_CONTRATO).toBe('claude-opus-5');
    expect(MODELO_CONTRATO_IA).toBe('claude-opus-5-5');
  });
  it('400 que diz que o modelo não existe também troca; 400 de outro assunto não troca e vira 502 genérico', async () => {
    h.fila.push({ erro: Object.assign(new Error('The model does not exist'), { status: 400 }) });
    fila(planoIa());
    await ok();
    expect(h.chamadas).toHaveLength(2);
    h.chamadas.length = 0;
    h.fila.push({ erro: Object.assign(new Error('output_config: schema inválido SEGREDO-INTERNO'), { status: 400 }) });
    const r = await chamar();
    expect(h.chamadas).toHaveLength(1);
    expect(r).toEqual({ ok: false, status: 502, erro: 'A IA não respondeu agora. Tente de novo em instantes.' });
  });
  it('CONTRATO_IA_MODELO troca o primeiro modelo, lido a cada chamada, e o plano B segue o mesmo', async () => {
    process.env.CONTRATO_IA_MODELO = 'claude-teste-9';
    h.fila.push({ erro: Object.assign(new Error('not found'), { status: 404 }) });
    fila(planoIa());
    await ok();
    expect(h.chamadas.map(c => c.corpo.model)).toEqual(['claude-teste-9', 'claude-opus-5']);
  });
  it('se o env já aponta para o plano B, não repete o mesmo modelo', async () => {
    process.env.CONTRATO_IA_MODELO = 'claude-opus-5';
    h.fila.push({ erro: Object.assign(new Error('not found'), { status: 404 }) });
    expect(await chamar()).toMatchObject({ ok: false, status: 502 });
    expect(h.chamadas).toHaveLength(1);
  });
  it('o /contrato/redesenhar usa o mesmo modelo e o mesmo plano B', async () => {
    const pedido = PedidoContratoIa.parse({
      pedido: 'garantia de 36 meses',
      clausulas: [{ key: 'garantia', numero: '7ª', titulo: 'Da garantia', travada: false, itens: [{ key: 'garantia.1', numero: '7.1', texto: 'x', travado: false }] }],
    });
    h.fila.push({ erro: Object.assign(new Error('nf'), { status: 404 }) });
    fila({ operacoes: [], avisos: [], recusa: null });
    const r = await pedirMudancaContrato(pedido);
    expect(r.ok).toBe(true);
    expect(h.chamadas.map(c => c.corpo.model)).toEqual(['claude-opus-5-5', 'claude-opus-5']);
  });
});

// ── Rota ─────────────────────────────────────────────────────────────────────
describe('POST /gerador/contrato/hibrido', () => {
  const r = Router();
  mountContratoHibrido(r);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/gerador', r);
  const post = (corpoReq: unknown, auth: string | null = 'Bearer tk-nilce') => {
    const q = request(app).post('/gerador/contrato/hibrido');
    if (auth) q.set('Authorization', auth);
    return q.send(corpoReq as object);
  };

  it('sem login ou com token de quem não é consultor: 401, e a IA não é chamada', async () => {
    expect((await post(corpo(), null)).status).toBe(401);
    expect((await post(corpo(), 'Bearer outro')).status).toBe(401);
    expect(h.chamadas).toHaveLength(0);
  });
  it('200 com o plano', async () => {
    fila(planoIa());
    const res = await post(corpo());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, tipos: ['completo', 'arrend'], bloqueado: false });
    expect(res.body.autonomia.itens).toHaveLength(3);
    expect(res.body.aviso_juridico).toBe(AVISO_JURIDICO);
  });
  it('pedido ausente, null ou vazio vale: a IA monta da melhor forma', async () => {
    for (const pedido of [undefined, null, '', '   ']) {
      fila(planoIa());
      const res = await post({ ...corpo(), pedido });
      expect(res.status).toBe(200);
    }
    expect(h.chamadas[0].corpo.messages[0].content).toMatch(/Monte o contrato híbrido da melhor forma/);
  });
  it('400 com o motivo quando a combinação não vale, e quando o corpo é de outro formato', async () => {
    const a = await post(corpo({ tipos: ['socio50', 'cotas'] }));
    expect(a.status).toBe(400);
    expect(a.body.error).toMatch(/não se combinam/);
    const b = await post(corpo({ tipos: ['termo_arr', 'completo'] }));
    expect(b.status).toBe(400);
    expect(b.body.error).toMatch(/termos/);
    const c = await post({ tipos: 'completo', modelos: 1 });
    expect(c.status).toBe(400);
    expect(c.body.error).toBe('pedido inválido');
    const d = await post(corpo({ modelos: { completo: completo() } }));
    expect(d.status).toBe(400);
    expect(h.chamadas).toHaveLength(0);
  });
  it('413 quando o corpo passa do teto do redesenhar', async () => {
    const grande = [cl('g', 'Grande', Array.from({ length: 40 }, (_, i) => it_(`g.${i}`, 'x'.repeat(6000))))];
    const res = await post(corpo({ modelos: { completo: grande, arrend: arrend() } }));
    expect(res.status).toBe(413);
    expect(h.chamadas).toHaveLength(0);
  });
  it('erro da IA vira 502 genérico, sem vazar a mensagem do erro', async () => {
    h.fila.push({ erro: new Error('chave sk-ant-SEGREDO inválida') });
    const res = await post(corpo());
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'A IA não respondeu agora. Tente de novo em instantes.' });
    expect(JSON.stringify(res.body)).not.toContain('SEGREDO');
  });
});
