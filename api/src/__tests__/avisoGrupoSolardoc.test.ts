import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── banco em memória: só o suficiente para system_state, leads_meta, sales e users ──
type Linha = Record<string, any>;
const tabelas: Record<string, Linha[]> = { system_state: [], leads_meta: [], sales: [], users: [] };
const DUP = { code: '23505', message: 'duplicate key' };
const valorDe = (r: Linha, col: string): unknown => {
  if (col.includes('->>')) { const [c, k] = col.split('->>'); return r[c!]?.[k!]; }
  return r[col];
};

/** Gancho opt-in: devolve `error` num select. Padrão null (nada falha). `max` é o .limit() da consulta. */
let falhaSelect: ((q: { tabela: string; or: string; max: number; ordenada: boolean }) => boolean) | null = null;

function construtor(tabela: string) {
  const filtros: Array<(r: Linha) => boolean> = [];
  let orExpr = '';
  let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  let valores: Linha = {};
  let max = 1000;
  let desde = 0;
  let unico = false;
  let ordem: { col: string; asc: boolean } | null = null;
  const q: any = {
    select: () => q,
    insert: (v: Linha) => { op = 'insert'; valores = v; return q; },
    upsert: (v: Linha) => { op = 'upsert'; valores = v; return q; },
    update: (v: Linha) => { op = 'update'; valores = v; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (c: string, v: unknown) => { filtros.push(r => valorDe(r, c) === v); return q; },
    neq: (c: string, v: unknown) => { filtros.push(r => r[c] !== v); return q; },
    in: (c: string, vs: unknown[]) => { filtros.push(r => vs.includes(r[c])); return q; },
    gte: (c: string, v: string) => { filtros.push(r => String(r[c]) >= v); return q; },
    lte: (c: string, v: string) => { filtros.push(r => String(r[c]) <= v); return q; },
    lt: (c: string, v: string) => { filtros.push(r => String(r[c]) < v); return q; },
    or: (expr: string) => {
      orExpr = expr;
      const pref = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
      filtros.push(r => pref.some(p => String(r.key).startsWith(p)));
      return q;
    },
    contains: () => q,
    order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { max = n; return q; },
    range: (a: number, b: number) => { desde = a; max = b - a + 1; return q; },
    maybeSingle: () => { unico = true; return q; },
    then: (res: (v: unknown) => unknown) => {
      let alvo = tabelas[tabela]!.filter(r => filtros.every(f => f(r)));
      if (op === 'select' && falhaSelect?.({ tabela, or: orExpr, max, ordenada: ordem !== null })) {
        return res({ data: null, error: { message: 'leitura falhou (teste)' } });
      }
      if (op === 'insert') {
        if (tabela === 'system_state' && tabelas[tabela]!.some(r => r.key === valores.key)) return res({ data: null, error: DUP });
        tabelas[tabela]!.push({ ...valores });
        return res({ data: null, error: null });
      }
      if (op === 'upsert') {
        const ja = tabelas[tabela]!.find(r => r.key === valores.key);
        if (ja) Object.assign(ja, valores); else tabelas[tabela]!.push({ ...valores });
        return res({ data: null, error: null });
      }
      if (op === 'update') {
        alvo.forEach(r => Object.assign(r, valores));
        return res({ data: alvo.map(r => ({ key: r.key })), error: null });
      }
      if (op === 'delete') {
        tabelas[tabela] = tabelas[tabela]!.filter(r => !alvo.includes(r));
        return res({ data: null, error: null });
      }
      if (ordem) {
        const { col, asc } = ordem;
        alvo = [...alvo].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      const lista = alvo.slice(desde, desde + max).map(r => ({ ...r }));
      return res({ data: unico ? (lista[0] ?? null) : lista, error: null });
    },
  };
  return q;
}

const sendToGroup = vi.fn(async (_g: string, _t: string, _i?: string) => ({ messageId: 'm1' }));
const sendWhatsApp = vi.fn(async () => undefined);
const sendOpsAlert = vi.fn(async () => undefined);
const emCooldown = vi.fn(() => false);

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => construtor(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => construtor(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: (...a: unknown[]) => (sendOpsAlert as any)(...a) }));
vi.mock('../services/agents/zapiClient', () => ({
  sendToGroup: (...a: [string, string, string?]) => sendToGroup(...a),
  sendWhatsApp: (...a: unknown[]) => (sendWhatsApp as any)(...a),
  linhaEmCooldown: () => emCooldown(),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ prefixosTotalDaLinha: () => ['linha_x:'], PREFIXOS_AGENDA: ['agenda_x:'] }));

import {
  avisarDesistencia, avisarSemVaga, avisarCompra, descarregarPendentes, grupoVendas, idDeVenda, TEMPOS_AVISO,
  type LeadQuizLinha,
} from '../services/solardoc/avisoGrupoSolardoc';
import { montarAviso, MODELOS, telefoneComDdi, type ModeloAviso } from '../services/solardoc/avisoGrupoTextos';
import { runSolardocQuizDesistenciaTick } from '../services/solardoc/desistenciaQuizTick';
import { gruposInternosDaCasa, ehDestinoInterno } from '../services/chefe/destinos';
import { GRUPO_VENDAS_SOLARDOC } from '../services/solardoc/grupoVendasId';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';

const GRUPO = '120363999999999999-group';
const agora = () => new Date().toISOString();
const minAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const lead = (extra: Partial<LeadQuizLinha> = {}, campos: Array<{ name: string; values: string[] }> = []): LeadQuizLinha => ({
  lead_id: 'sdquiz_3499998888', nome: 'Carlos Andrade', whatsapp: '5534999998888', cidade: 'Uberlândia-MG',
  created_time: minAtras(20),
  field_data: [
    { name: 'Origem', values: ['Quiz SolarDoc'] }, { name: 'Código', values: ['SD-AB23'] }, { name: 'Índice', values: ['37'] },
    { name: 'Perfil nome', values: ['Proposta no braço'] }, { name: 'Empresa', values: ['Solar Andrade'] },
    { name: 'propostas_mes', values: ['6a15'] }, { name: 'quando_comecar', values: ['semana'] }, { name: 'lp_session', values: ['lp-1'] },
    ...campos,
  ],
  ...extra,
});

const claims = () => tabelas.system_state!.filter(r => /^(quiz_aviso|compra_aviso):/.test(r.key));
const chave = (k: string) => tabelas.system_state!.find(r => r.key === k);
/** Os carimbos dos envios do módulo ficam com 5 min (passou o espaçamento de 25 a 60 s da linha). */
const envelhecerCarimbos = () => { for (const r of tabelas.system_state!) if (r.key.startsWith('solardoc_aviso_sent:')) r.updated_at = minAtras(5); };
/** Libera a vez de 2 min (como se tivessem passado 2 min; o espaçamento contra o último envio também passou). */
const liberarVez = () => { tabelas.system_state = tabelas.system_state!.filter(r => r.key !== 'quiz_aviso_vez'); envelhecerCarimbos(); };
/** Libera também a chave do cartão (como se tivessem passado 10 min). */
const liberarTudo = () => { liberarVez(); tabelas.system_state = tabelas.system_state!.filter(r => r.key !== 'quiz_aviso_cartao_ultimo'); };
/** Compra: só reivindica o claim (pendente); quem envia é o cartão do tick. */
const compra = (id: string, extra: Record<string, unknown> = {}) =>
  avisarCompra({ id, canal: 'cartao', planoAtivo: true, valor: 67, nome: `Cliente ${id}`, ...extra } as any);
/** Um aviso AVULSO (desistência) de uma pessoa por id: é o que exercita a vez, o teto, o espaçamento e o envio físico. */
const pessoas = new Map<string, string>();
const telDe = (id: string): string => {
  if (!pessoas.has(id)) pessoas.set(id, `55349${String(20000000 + pessoas.size)}`);
  return pessoas.get(id)!;
};
const avulso = (id: string, extra: Partial<LeadQuizLinha> = {}) => avisarDesistencia(lead({ nome: `Cliente ${id}`, whatsapp: telDe(id), ...extra }));
const textoDe = (k: string): string => String(chave(k)!.value.texto);

beforeEach(() => {
  for (const k of Object.keys(tabelas)) tabelas[k] = [];
  falhaSelect = null; pessoas.clear();
  sendToGroup.mockReset(); sendWhatsApp.mockClear(); sendOpsAlert.mockClear(); emCooldown.mockReset();
  sendToGroup.mockImplementation(async () => ({ messageId: 'm1' }));
  emCooldown.mockReturnValue(false);
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  process.env.ZAPI_SOLARDOC_GRUPO_ID = GRUPO;
  delete process.env.QUIZ_RECUPERACAO_LIGADA;
  delete process.env.QUIZ_DESISTENCIA_OFF;
  delete process.env.ZAPI_IO_GROUP_ID;
  delete process.env.IO_GRUPO_ELETROPOSTO_ID;
});
afterEach(() => { delete process.env.ZAPI_SOLARDOC_GRUPO_ID; });

describe('textos dos avisos', () => {
  const todos = Object.keys(MODELOS) as ModeloAviso[];
  it('nenhum modelo sai com colchete sobrando, mesmo sem dado nenhum', () => {
    for (const m of todos) {
      expect(montarAviso(m, {}, { carlaLigada: false })).not.toMatch(/\[|\]/);
      expect(montarAviso(m, {}, { carlaLigada: true })).not.toMatch(/\[|\]/);
      const cheio = montarAviso(m, { nome_completo: 'Carlos Andrade', empresa: 'Solar Andrade', cidade: 'Uberlândia-MG', telefone: '34999998888', indice: 37, perfil: 'Proposta no braço', propostas_mes: 'de 6 a 15', quando: 'esta semana', hora_carla: '10:15', valor: 67, codigo: 'SD-AB23' });
      expect(cheio).not.toMatch(/\[|\]|undefined|null|NaN/);
    }
  });
  it('telefone sai com +55', () => {
    expect(telefoneComDdi('34999998888')).toBe('+55 (34) 99999-8888');
    expect(telefoneComDdi('5534999998888')).toBe('+55 (34) 99999-8888');
    expect(telefoneComDdi('123')).toBe('não informado');
  });
  it('a linha da Carla muda com o robô desligado ou ligado', () => {
    expect(montarAviso('desistencia', { hora_carla: '10:15' }, { carlaLigada: false })).toContain('A Carla ainda não chama quem vem do quiz.');
    expect(montarAviso('desistencia', { hora_carla: '10:15' }, { carlaLigada: true })).toContain('A Carla falou às 10:15.');
    expect(montarAviso('desistencia', {}, { carlaLigada: false })).not.toContain('falou às');
  });
  it('origem: quiz com o código, ou outra', () => {
    expect(montarAviso('compraCartao', { codigo: 'SD-AB23', valor: 67 })).toContain('Origem: quiz, código SD-AB23');
    expect(montarAviso('compraCartao', { valor: 67 })).toContain('Origem: outra');
    expect(montarAviso('compraComprovante', { valor: 67 })).toContain('Ainda não foi confirmado pelo banco');
  });
  it('assinatura em teste (trialing) não sai como "Pagamento confirmado"', () => {
    const t = montarAviso('compraCartaoTeste', { valor: 67, nome_completo: 'A' });
    expect(t).not.toMatch(/Pagamento confirmado/i);
    expect(t).toContain('Assinatura em teste');
    expect(t).toContain('Ainda não houve cobrança');
  });
});

describe('grupo e envio', () => {
  it('vai por sendToGroup na instância io, nunca por sendWhatsApp, em 1 bolha', async () => {
    expect(await avisarDesistencia(lead())).toBe('enviado');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(sendToGroup.mock.calls[0]![0]).toBe(GRUPO);
    expect(sendToGroup.mock.calls[0]![2]).toBe('io');
    expect(sendWhatsApp).not.toHaveBeenCalled();
    const texto = sendToGroup.mock.calls[0]![1];
    expect(texto).toContain('Carlos Andrade, Solar Andrade, Uberlândia-MG');
    expect(texto).toContain('+55 (34) 99999-8888');
    expect(texto).toContain('Propostas por mês: de 6 a 15');
    expect(texto).toContain('Quer começar: esta semana');
    expect(texto).toContain('perfil Proposta no braço');
    expect(texto).not.toMatch(/\[|\]|6a15/);
  });
  it('recusa o grupo do agendamento da IO e o do eletroposto (nunca o ZAPI_IO_GROUP_ID)', async () => {
    process.env.ZAPI_SOLARDOC_GRUPO_ID = '120363424419098566-group';
    expect(grupoVendas()).toBe('');
    process.env.ZAPI_SOLARDOC_GRUPO_ID = '120363410228854732@g.us';
    expect(grupoVendas()).toBe('');
    process.env.ZAPI_SOLARDOC_GRUPO_ID = GRUPO;
    process.env.IO_GRUPO_ELETROPOSTO_ID = GRUPO;
    expect(grupoVendas()).toBe('');
    delete process.env.IO_GRUPO_ELETROPOSTO_ID;
    process.env.ZAPI_IO_GROUP_ID = GRUPO;
    expect(grupoVendas()).toBe('');
    expect(await avisarDesistencia(lead())).toBe('sem_grupo');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('sem id de grupo não envia nem manda e-mail por aviso (o resumo é do tick); o claim impede repetir', async () => {
    delete process.env.ZAPI_SOLARDOC_GRUPO_ID;
    expect(await avisarDesistencia(lead())).toBe('sem_grupo');
    expect(await avisarDesistencia(lead())).toBe('duplicado');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(sendOpsAlert).not.toHaveBeenCalled();
    expect(claims()[0]!.value.estado).toBe('sem_grupo');
  });
  it('falha do WhatsApp cai no e-mail e o claim não deixa repetir', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 503 — fora'));
    expect(await avisarDesistencia(lead())).toBe('falhou');
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(await avisarDesistencia(lead())).toBe('duplicado');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    // 5xx não grava a trava de 1 h
    expect(chave('quiz_aviso_trava')).toBeUndefined();
    // e o carimbo do envio que falhou FICA (5xx e timeout podem ter saído)
    expect(tabelas.system_state!.filter(r => r.key.startsWith('solardoc_aviso_sent:'))).toHaveLength(1);
  });
  it('lead de teste (raio-x-teste) nunca gera aviso', async () => {
    const t = lead({}, [{ name: 'utm_source', values: ['raio-x-teste'] }]);
    expect(await avisarDesistencia(t)).toBe('ignorado');
    expect(await avisarSemVaga(t)).toBe('ignorado');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
  it('lead de teste pelo campo teste=sim (sem utm) também nunca gera aviso, nem de compra', async () => {
    const t = lead({}, [{ name: 'teste', values: ['sim'] }]);
    expect(await avisarDesistencia(t)).toBe('ignorado');
    expect(await avisarSemVaga(t)).toBe('ignorado');
    tabelas.leads_meta!.push({ ...t, form_id: 'quiz_solardoc' });
    expect(await compra('cs_teste', { telefone: '34999998888' })).toBe('ignorado');
    expect(await compra('cs_teste2', { utmSource: 'raio-x-teste' })).toBe('ignorado');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
});

describe('claim único', () => {
  it('desistência: um por pessoa, mesmo com o telefone escrito de outro jeito', async () => {
    expect(await avisarDesistencia(lead())).toBe('enviado');
    expect(await avisarDesistencia(lead({ whatsapp: '34999998888' }))).toBe('duplicado');
    expect(await avisarDesistencia(lead({ whatsapp: '553499998888' }))).toBe('duplicado');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(claims()[0]!.key).toMatch(/^quiz_aviso:[0-9a-f]{64}$/);
    expect(JSON.stringify(claims())).not.toContain('99998888');
  });
  it('sem vaga: uma vez por pessoa por dia, e não bloqueia a desistência', async () => {
    expect(await avisarSemVaga(lead(), { dia: '2026-10-25' })).toBe('enviado');
    expect(await avisarSemVaga(lead(), { dia: '2026-10-25' })).toBe('duplicado');
    liberarVez();
    expect(await avisarSemVaga(lead(), { dia: '2026-10-26' })).toBe('enviado');
    liberarVez();
    expect(await avisarDesistencia(lead())).toBe('enviado');
    expect(sendToGroup).toHaveBeenCalledTimes(3);
  });
  it('compra: um aviso por venda, não importa o canal; o webhook só reivindica e o tick envia', async () => {
    const base = { id: 'cs_test_1', planoAtivo: true, valor: 67, nome: 'Carlos Andrade', telefone: '34999998888' };
    expect(await avisarCompra({ ...base, canal: 'cartao' })).toBe('pendente');
    expect(await avisarCompra({ ...base, canal: 'comprovante' })).toBe('duplicado');
    expect(await avisarCompra({ ...base, canal: 'asaas' })).toBe('duplicado');
    expect(await avisarCompra({ ...base, id: 'asaas:abc', canal: 'asaas' })).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims().map(c => c.key).sort()).toEqual(['compra_aviso:asaas:abc', 'compra_aviso:cs_test_1']);
    expect(claims().every(c => c.value.estado === 'pendente')).toBe(true);
    // o tick leva as duas num cartão só
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.pendentes).toBe(2);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(claims().every(c => c.value.estado === 'enviado_cartao')).toBe(true);
  });
});

describe('compra', () => {
  it('só com plano ativo', async () => {
    expect(await avisarCompra({ id: 'cs_1', canal: 'cartao', planoAtivo: false, valor: 67, nome: 'A' })).toBe('ignorado');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
  it('id nulo nunca vira chave (asaas:null, pix:undefined): pula e não grava claim', async () => {
    for (const id of ['asaas:null', 'pix:undefined', 'asaas:', '', 'null', 'pix:NaN', ' ']) {
      expect(await compra(id)).toBe('ignorado');
    }
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
  it('idDeVenda usa o primeiro candidato que existe e devolve null sem nenhum', () => {
    expect(idDeVenda('asaas:', null, undefined, '', 'null', 'ctr_9', 'x')).toBe('asaas:ctr_9');
    expect(idDeVenda('pix:', undefined, 'E123:67')).toBe('pix:E123:67');
    expect(idDeVenda('asaas:', null, undefined, '', 'undefined')).toBeNull();
    expect(idDeVenda('', 'cs_1')).toBe('cs_1');
  });
  it('casa com o lead do quiz pelo telefone e traz empresa e código', async () => {
    tabelas.leads_meta!.push({ ...lead(), form_id: 'quiz_solardoc' });
    expect(await compra('cs_2', { nome: 'Outro Nome', telefone: '(34) 99999-8888' })).toBe('pendente');
    const t = textoDe('compra_aviso:cs_2');
    expect(t).toContain('Quem: Carlos Andrade, Solar Andrade');
    expect(t).toContain('Origem: quiz, código SD-AB23');
    expect(t).toContain('Valor: R$ 67');
    expect(t).toContain('Pagamento confirmado');
  });
  it('cartão em teste (emTeste) sai como assinatura em teste', async () => {
    await compra('cs_t', { emTeste: true });
    const t = textoDe('compra_aviso:cs_t');
    expect(t).toContain('Assinatura em teste');
    expect(t).not.toMatch(/Pagamento confirmado/);
  });
  it('sem lead, a origem é "outra"; com origem quiz mas sem lead, calcula o código pelo telefone', async () => {
    await avisarCompra({ id: 'cs_3', canal: 'asaas', planoAtivo: true, valor: 67, nome: 'Maria', telefone: '11988887777' });
    expect(textoDe('compra_aviso:cs_3')).toContain('Origem: outra');
    await compra('cs_4', { nome: 'Maria', telefone: '11988887777', origemQuiz: true });
    expect(textoDe('compra_aviso:cs_4')).toMatch(/Origem: quiz, código SD-[A-Z2-9]{4}/);
  });
  it('sem nome: o e-mail do cliente NUNCA entra no texto do grupo (Stripe: "Sem nome na Stripe")', async () => {
    await avisarCompra({ id: 'cs_6', canal: 'cartao', planoAtivo: true, valor: 67, email: 'segredo@cliente.com', telefone: '11988887777' });
    await avisarCompra({ id: 'asaas:z1', canal: 'asaas', planoAtivo: true, valor: 67, email: 'segredo@cliente.com' });
    await avisarCompra({ id: 'pix:z2', canal: 'comprovante', planoAtivo: true, valor: 67, email: 'segredo@cliente.com' });
    expect(textoDe('compra_aviso:cs_6')).toContain('Quem: Sem nome na Stripe, sem empresa');
    expect(textoDe('compra_aviso:asaas:z1')).toContain('Quem: nome não informado');
    expect(textoDe('compra_aviso:pix:z2')).toContain('Quem: nome não informado');
    expect(JSON.stringify(claims())).not.toContain('segredo@cliente.com');
    expect(JSON.stringify(claims())).not.toContain('@');
  });
  it('o webhook nunca envia: com tudo livre a compra fica pendente e o grupo não recebe nada', async () => {
    expect(await compra('cs_7')).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(chave('quiz_aviso_vez')).toBeUndefined();
    expect(chave('compra_aviso:cs_7')!.value.texto).toContain('Cliente cs_7');
  });
  it('compra sem grupo não manda e-mail e devolve sem_grupo', async () => {
    delete process.env.ZAPI_SOLARDOC_GRUPO_ID;
    expect(await compra('cs_5')).toBe('sem_grupo');
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });
});

describe('um aviso avulso por vez, o resto em cartão', () => {
  it('o segundo aviso colado fica pendente; o cartão sai depois e junta o que esperou', async () => {
    expect(await avulso('v1')).toBe('enviado');
    expect(await compra('v2')).toBe('pendente');
    expect(await avulso('v3')).toBe('pendente');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    // com a vez ainda ocupada, o cartão espera (e devolve a chave dele)
    envelhecerCarimbos();
    expect((await descarregarPendentes()).motivo).toBe('vez_ocupada');
    liberarVez();
    const r = await descarregarPendentes();
    expect(r.enviados).toBe(2);
    expect(sendToGroup).toHaveBeenCalledTimes(2);
    const cartao = sendToGroup.mock.calls[1]![1];
    expect(cartao).toContain('Cliente v2');
    expect(cartao).toContain('Cliente v3');
    expect(sendToGroup.mock.calls[1]![2]).toBe('io');
    expect(claims().filter(c => c.value.estado === 'pendente')).toHaveLength(0);
    // outro cartão antes de 10 min: não sai
    liberarVez();
    expect(await avulso('v4')).toBe('enviado');
    expect(await compra('v5')).toBe('pendente');
    envelhecerCarimbos();
    expect((await descarregarPendentes()).motivo).toBe('cartao_recente');
  });
  it('o cartão também respeita a vez de 2 min e devolve a chave do cartão', async () => {
    await avulso('v1');
    await compra('v2');
    tabelas.system_state = tabelas.system_state!.filter(r => r.key !== 'quiz_aviso_cartao_ultimo');
    envelhecerCarimbos();
    expect((await descarregarPendentes()).motivo).toBe('vez_ocupada');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    // a chave do cartão foi devolvida: passados 2 min da vez, o cartão sai
    tabelas.system_state!.find(r => r.key === 'quiz_aviso_vez')!.updated_at = minAtras(3);
    expect((await descarregarPendentes()).enviados).toBe(1);
  });
  it('teto de 12 por hora: o 13º aviso fica pendente mesmo com a vez livre', async () => {
    for (let i = 0; i < 12; i++) { liberarVez(); expect(await avulso(`t${i}`)).toBe('enviado'); }
    liberarVez();
    expect(await avulso('t12')).toBe('pendente');
    expect(sendToGroup).toHaveBeenCalledTimes(12);
  });
  it('linha com 40 envios na hora: o aviso espera', async () => {
    for (let i = 0; i < 40; i++) tabelas.system_state!.push({ key: `linha_x:${i}`, value: {}, updated_at: minAtras(5) });
    expect(await avisarDesistencia(lead())).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('cada envio físico deixa carimbo solardoc_aviso_sent:, e os carimbos entram na conta de 40 por hora', async () => {
    expect(await avulso('c1')).toBe('enviado');
    expect(tabelas.system_state!.filter(r => r.key.startsWith('solardoc_aviso_sent:'))).toHaveLength(1);
    liberarVez();
    await avulso('c2');
    await avulso('c3');
    liberarVez();
    expect((await descarregarPendentes()).enviados).toBe(1);
    expect(tabelas.system_state!.filter(r => r.key.startsWith('solardoc_aviso_sent:'))).toHaveLength(3);
    // 38 envios próprios + 1 de outro robô = 39 (+ nada); com mais 1 chega a 40 e o próximo espera
    tabelas.system_state = tabelas.system_state!.filter(r => !r.key.startsWith('solardoc_aviso_sent:'));
    for (let i = 0; i < 40; i++) tabelas.system_state!.push({ key: `solardoc_aviso_sent:x${i}`, value: {}, updated_at: minAtras(5) });
    liberarVez();
    expect(await avulso('c9')).toBe('pendente');
  });
});

describe('linha pausada e trava do grupo', () => {
  it('ag5040_linha_pausa de pé: o aviso vira pendente e o cartão não sai', async () => {
    tabelas.system_state!.push({ key: 'ag5040_linha_pausa', value: { ate: new Date(Date.now() + 10 * 60_000).toISOString() }, updated_at: agora() });
    expect(await compra('p1')).toBe('pendente');
    expect((await descarregarPendentes()).motivo).toBe('linha_caida');
    expect(sendToGroup).not.toHaveBeenCalled();
    // pausa vencida: volta ao normal
    tabelas.system_state!.find(r => r.key === 'ag5040_linha_pausa')!.value = { ate: minAtras(1) };
    expect((await descarregarPendentes()).enviados).toBe(1);
  });
  it('linhaEmCooldown("io") também segura o aviso e o cartão', async () => {
    emCooldown.mockReturnValue(true);
    expect(await avulso('p2')).toBe('pendente');
    expect((await descarregarPendentes()).motivo).toBe('linha_caida');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('o primeiro 4xx grava a trava de 1 h: só e-mail nesse tempo, nada de nova tentativa no grupo', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 400 — not a member'));
    expect(await avulso('q1')).toBe('falhou');
    const trava = chave('quiz_aviso_trava');
    expect(trava).toBeDefined();
    expect(Date.parse(trava!.value.ate) - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    liberarVez();
    expect(await compra('q2')).toBe('pendente');
    expect((await descarregarPendentes()).motivo).toBe('trava_4xx');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    // passada a hora, volta
    trava!.value = { ate: minAtras(1) };
    liberarVez();
    expect((await descarregarPendentes()).enviados).toBe(1);
  });
  it('429 e 408 não gravam a trava (pedem só espera)', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 429 — slow down'));
    expect(await avulso('r1')).toBe('falhou');
    expect(chave('quiz_aviso_trava')).toBeUndefined();
  });
  it('falha do cartão manda e-mail, devolve a vez e grava a trava no 4xx', async () => {
    await avulso('s1');
    await compra('s2');
    liberarVez();
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 403 — nope'));
    const r = await descarregarPendentes();
    expect(r.motivo).toBe('falhou');
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(chave('quiz_aviso_trava')).toBeDefined();
    expect(claims().find(c => c.key === 'compra_aviso:s2')!.value.estado).toBe('falhou');
  });
});

describe('desistência não espera 24 h: trava de 4xx e pausa da linha viram UM e-mail por rodada', () => {
  const leadsMeta = (extra: Partial<LeadQuizLinha> = {}) => ({ ...lead(), form_id: 'quiz_solardoc', ...extra });
  const tel = (i: number) => `55349${String(10000000 + i)}`;
  const quatro = () => {
    for (let i = 0; i < 4; i++) tabelas.leads_meta!.push(leadsMeta({ lead_id: `sdquiz_${i}`, whatsapp: tel(i), nome: `Lead ${i}`, created_time: minAtras(20 + i) }));
  };
  const trava = (status = '400') => tabelas.system_state!.push({ key: 'quiz_aviso_trava', value: { ate: new Date(Date.now() + 40 * 60_000).toISOString(), status }, updated_at: agora() });
  const pausa = () => tabelas.system_state!.push({ key: 'ag5040_linha_pausa', value: { ate: new Date(Date.now() + 10 * 60_000).toISOString() }, updated_at: agora() });

  it('o 4xx de verdade grava o status na trava', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 400 — not a member'));
    await avulso('t0');
    expect(chave('quiz_aviso_trava')!.value.status).toBe('400');
  });
  it('trava ativa: 1 e-mail na rodada, 0 envios ao grupo, itens marcados email; depois da trava, 0 envios para os mesmos itens', async () => {
    quatro();
    trava('403');
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    const corpo = JSON.stringify(sendOpsAlert.mock.calls[0]);
    expect(corpo).toMatch(/travado até \d\d:\d\d \(Brasília\) por erro 403/);
    for (let i = 0; i < 4; i++) expect(corpo).toContain(`Lead ${i}`);
    const dos4 = claims().filter(c => c.key.startsWith('quiz_aviso:'));
    expect(dos4).toHaveLength(4);
    expect(dos4.every(c => c.value.estado === 'email')).toBe(true);
    // a trava acaba: nada dos mesmos itens vai ao grupo, nem pelo tick nem pelo cartão
    chave('quiz_aviso_trava')!.value = { ate: minAtras(1), status: '403' };
    liberarTudo();
    await runSolardocQuizDesistenciaTick();
    expect((await descarregarPendentes()).enviados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });
  it('pausa da linha ativa: 1 e-mail na rodada, nada ao grupo', async () => {
    quatro();
    pausa();
    await runSolardocQuizDesistenciaTick();
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendOpsAlert.mock.calls[0])).toMatch(/pausada até \d\d:\d\d \(Brasília\)/);
    expect(claims().filter(c => c.key.startsWith('quiz_aviso:')).every(c => c.value.estado === 'email')).toBe(true);
  });
  it('cooldown curto: o item fica pendente para a próxima rodada, sem e-mail', async () => {
    emCooldown.mockReturnValue(true);
    expect(await avisarDesistencia(lead())).toBe('pendente');
    expect(sendOpsAlert).not.toHaveBeenCalled();
    expect(sendToGroup).not.toHaveBeenCalled();
    emCooldown.mockReturnValue(false);
    liberarTudo();
    expect((await descarregarPendentes()).enviados).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
  });
  it('desistência já pendente + lead novo na mesma rodada de trava: UM e-mail só, com os dois', async () => {
    expect(await avisarDesistencia(lead({ whatsapp: tel(50), nome: 'Primeiro' })) ).toBe('enviado');
    expect(await avisarDesistencia(lead({ whatsapp: tel(51), nome: 'Pendente Antigo' }))).toBe('pendente');
    tabelas.leads_meta!.push(leadsMeta({ lead_id: 'sdquiz_novo', whatsapp: tel(60), nome: 'Lead Novo', created_time: minAtras(20) }));
    trava();
    await runSolardocQuizDesistenciaTick();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    const corpo = JSON.stringify(sendOpsAlert.mock.calls[0]);
    expect(corpo).toContain('Pendente Antigo');
    expect(corpo).toContain('Lead Novo');
    expect(sendToGroup).toHaveBeenCalledTimes(1);   // só o "Primeiro", de antes da trava
    expect(claims().filter(c => c.value.estado === 'pendente')).toHaveLength(0);
  });
  it('compra não muda: na trava fica pendente (o Thiago já recebeu), sem e-mail de resumo', async () => {
    trava();
    expect(await compra('k1')).toBe('pendente');
    const r = await descarregarPendentes();
    expect(r.motivo).toBe('trava_4xx');
    expect(r.porEmail).toBeUndefined();
    expect(sendOpsAlert).not.toHaveBeenCalled();
    expect(claims().find(c => c.key === 'compra_aviso:k1')!.value.estado).toBe('pendente');
  });
});

describe('pendente com mais de 24 h não some calado', () => {
  it('vira UM e-mail e fica expirado, com ou sem grupo', async () => {
    for (const id of ['o1', 'o2']) {
      tabelas.system_state!.push({ key: `compra_aviso:${id}`, value: { tipo: 'compra_cartao', estado: 'pendente', texto: `texto ${id}` }, updated_at: new Date(Date.now() - 25 * 3600_000).toISOString() });
    }
    delete process.env.ZAPI_SOLARDOC_GRUPO_ID;
    const r = await descarregarPendentes();
    expect(r.expirados).toBe(2);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sendOpsAlert.mock.calls[0])).toContain('texto o1');
    expect(claims().every(c => c.value.estado === 'expirado')).toBe(true);
    expect((await descarregarPendentes()).expirados).toBeUndefined();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });
  it('o tick esvazia os pendentes ANTES do QUIZ_DESISTENCIA_OFF', async () => {
    await avulso('d1');
    await compra('d2');
    liberarVez();
    process.env.QUIZ_DESISTENCIA_OFF = '1';
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.motivo).toBe('desligado');
    expect(r.pendentes).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(2);
  });
  it('e antes do robô da Carla ligado', async () => {
    process.env.QUIZ_RECUPERACAO_LIGADA = '1';
    await avulso('e1');
    await compra('e2');
    liberarVez();
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.motivo).toBe('robo_da_carla_avisa');
    expect(r.pendentes).toBe(1);
  });
});

describe('tick de desistência', () => {
  const leadsMeta = (extra: Partial<LeadQuizLinha> = {}) => ({ ...lead(), form_id: 'quiz_solardoc', ...extra });
  const tel = (i: number) => `55349${String(10000000 + i)}`;   // 13 dígitos, válidos e distintos

  it('avisa quem tem 15 min a 48 h e não comprou, uma vez só', async () => {
    tabelas.leads_meta!.push(
      leadsMeta({ lead_id: 'sdquiz_a', whatsapp: '5534999998888', created_time: minAtras(20) }),
      leadsMeta({ lead_id: 'sdquiz_b', whatsapp: '5511988887777', nome: 'Cedo Demais', created_time: minAtras(5) }),
      leadsMeta({ lead_id: 'sdquiz_c', whatsapp: '5521977776666', nome: 'Velho Demais', created_time: minAtras(49 * 60) }),
    );
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(sendToGroup.mock.calls[0]![1]).toContain('Carlos Andrade');
    liberarVez();
    expect((await runSolardocQuizDesistenciaTick()).avisados).toBe(0);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
  });
  it('não avisa quem comprou: por lp_session, por telefone da venda ou por plano pago', async () => {
    tabelas.leads_meta!.push(
      leadsMeta({ lead_id: 'sdquiz_a', whatsapp: '5534999998888' }),
      leadsMeta({ lead_id: 'sdquiz_b', whatsapp: '5511988887777', field_data: [{ name: 'lp_session', values: ['lp-x'] }] }),
      leadsMeta({ lead_id: 'sdquiz_c', whatsapp: '5521977776666' }),
      leadsMeta({ lead_id: 'sdquiz_d', whatsapp: '5531955554444' }),
    );
    tabelas.sales!.push(
      { phone: '34999998888', attribution_session_id: null, created_at: agora() },
      { phone: null, attribution_session_id: 'lp-x', created_at: agora() },
    );
    tabelas.users!.push({ id: 'u1', whatsapp: '5521977776666', plano: 'ilimitado' });
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    expect(r.tentativas).toBe(1);   // quem comprou não conta tentativa
    expect(sendToGroup.mock.calls[0]![1]).toContain('+55 (31) 95555-4444');
    // quem comprou ganha o claim `comprou` (sem envio): a próxima rodada nem consulta sales e users
    const comprou = claims().filter(c => c.value.estado === 'comprou');
    expect(comprou).toHaveLength(3);
    expect(comprou.every(c => /^quiz_aviso:[0-9a-f]{64}$/.test(c.key) && c.value.tipo === 'desistencia')).toBe(true);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    const r2 = await runSolardocQuizDesistenciaTick();
    expect(r2.tentativas).toBe(0);
    expect(claims().filter(c => c.value.estado === 'comprou')).toHaveLength(3);
  });
  it('dry não grava o claim comprou', async () => {
    tabelas.leads_meta!.push(leadsMeta({ lead_id: 'sdquiz_a', whatsapp: '5534999998888' }));
    tabelas.sales!.push({ phone: '34999998888', attribution_session_id: null, created_at: agora() });
    await runSolardocQuizDesistenciaTick({ dry: true });
    expect(claims()).toHaveLength(0);
  });
  it('lead de teste não é avisado (pelo utm ou pelo campo teste=sim)', async () => {
    tabelas.leads_meta!.push(
      leadsMeta({ lead_id: 'sdquiz_t1', field_data: [{ name: 'utm_source', values: ['raio-x-teste'] }] }),
      leadsMeta({ lead_id: 'sdquiz_t2', whatsapp: '5511988887777', field_data: [{ name: 'teste', values: ['sim'] }] }),
    );
    expect((await runSolardocQuizDesistenciaTick()).avisados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
  it('com o robô da Carla ligado o tick só descarrega pendentes (o robô avisa)', async () => {
    process.env.QUIZ_RECUPERACAO_LIGADA = '1';
    tabelas.leads_meta!.push(leadsMeta());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.motivo).toBe('robo_da_carla_avisa');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('dry não envia nem grava', async () => {
    tabelas.leads_meta!.push(leadsMeta());
    const r = await runSolardocQuizDesistenciaTick({ dry: true });
    expect(r.previa).toHaveLength(1);
    expect(r.previa![0]!.texto).toContain('Desistência no quiz');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
  it('lê do mais novo para o mais antigo e pula quem já tem claim: com mais de 100 leads, o novo não fica de fora', async () => {
    // 120 leads antigos já avisados (claim de 3 h atrás) e 1 lead NOVO, que é o mais recente
    for (let i = 0; i < 120; i++) {
      tabelas.leads_meta!.push(leadsMeta({ lead_id: `sdquiz_old${i}`, whatsapp: tel(i), nome: `Antigo ${i}`, created_time: minAtras(60 + i) }));
      const h = hmacDe(chaveDoTelefone(normalizarTelefoneSd(tel(i))!))!;
      tabelas.system_state!.push({ key: `quiz_aviso:${h}`, value: { estado: 'enviado' }, updated_at: minAtras(180) });
    }
    tabelas.leads_meta!.push(leadsMeta({ lead_id: 'sdquiz_novo', whatsapp: '5534988880000', nome: 'Lead Novo', created_time: minAtras(30) }));
    // e 1 lead MAIS ANTIGO que os 120, ainda sem claim: só aparece se a leitura paginar
    tabelas.leads_meta!.push(leadsMeta({ lead_id: 'sdquiz_fundo', whatsapp: '5534977770000', nome: 'Lead Fundo', created_time: minAtras(60 + 130) }));
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBeGreaterThanOrEqual(1);
    const textos = sendToGroup.mock.calls.map(c => c[1]).join('\n');
    expect(textos).toContain('Lead Novo');
    // o novo foi atendido primeiro (leitura do mais novo para o mais antigo)
    expect(sendToGroup.mock.calls[0]![1]).toContain('Lead Novo');
    // e o mais fundo (depois dos 120 já avisados) também foi alcançado, na página seguinte
    expect(claims().filter(c => c.updated_at > minAtras(5))).toHaveLength(2);
  });
  it('o limite por rodada conta toda tentativa, enviada ou pendente: no máximo 10', async () => {
    for (let i = 0; i < 25; i++) tabelas.leads_meta!.push(leadsMeta({ lead_id: `sdquiz_${i}`, whatsapp: tel(i), nome: `Lead ${i}`, created_time: minAtras(20 + i) }));
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.tentativas).toBe(10);
    expect(claims().filter(c => c.key.startsWith('quiz_aviso:'))).toHaveLength(10);
    expect(sendToGroup).toHaveBeenCalledTimes(1);   // 1 avulso; 9 pendentes para o cartão
    expect(claims().filter(c => c.value.estado === 'pendente')).toHaveLength(9);
  });
  it('o primeiro falhou encerra a rodada', async () => {
    for (let i = 0; i < 5; i++) tabelas.leads_meta!.push(leadsMeta({ lead_id: `sdquiz_${i}`, whatsapp: tel(i), nome: `Lead ${i}`, created_time: minAtras(20 + i) }));
    sendToGroup.mockRejectedValue(new Error('[zapi:io] HTTP 503 — fora'));
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.motivo).toBe('envio_falhou');
    expect(r.tentativas).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(claims()).toHaveLength(1);
  });
  it('sem id de grupo: UM e-mail de resumo por rodada, nunca um por lead', async () => {
    delete process.env.ZAPI_SOLARDOC_GRUPO_ID;
    for (let i = 0; i < 6; i++) tabelas.leads_meta!.push(leadsMeta({ lead_id: `sdquiz_${i}`, whatsapp: tel(i), nome: `Lead ${i}`, created_time: minAtras(20 + i) }));
    await runSolardocQuizDesistenciaTick();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    const corpo = JSON.stringify(sendOpsAlert.mock.calls[0]);
    for (let i = 0; i < 6; i++) expect(corpo).toContain(`Lead ${i}`);
    expect(sendToGroup).not.toHaveBeenCalled();
    // segunda rodada: ninguém novo, nenhum e-mail
    await runSolardocQuizDesistenciaTick();
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
  });
});

describe('B1.2: espaçamento, erro de linha, teto do cartão, claim velho, emoji', () => {
  const erroLinha = () => chave('ag5040_linha_erros');
  const pausa = () => chave('ag5040_linha_pausa');

  it('espaçamento: o último envio da linha há 10 s deixa o aviso pendente (sem sleep e sem gastar a vez); há 2 min, envia', async () => {
    tabelas.system_state!.push({ key: 'linha_x:1', value: {}, updated_at: new Date(Date.now() - 10_000).toISOString() });
    const t0 = Date.now();
    expect(await avulso('e1')).toBe('pendente');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(chave('quiz_aviso_vez')).toBeUndefined();
    tabelas.system_state!.find(r => r.key === 'linha_x:1')!.updated_at = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(await avulso('e2')).toBe('enviado');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
  });
  it('espaçamento: vale também para a agenda (PREFIXOS_AGENDA) e para o carimbo do próprio módulo', async () => {
    tabelas.system_state!.push({ key: 'agenda_x:9', value: {}, updated_at: new Date(Date.now() - 10_000).toISOString() });
    expect(await avulso('e3')).toBe('pendente');
    tabelas.system_state = tabelas.system_state!.filter(r => r.key !== 'agenda_x:9');
    expect(await avulso('e4')).toBe('enviado');            // o carimbo novo é do módulo
    liberarVez(); tabelas.system_state = tabelas.system_state!.filter(r => r.key !== 'quiz_aviso_vez');
    tabelas.system_state!.find(r => r.key.startsWith('solardoc_aviso_sent:'))!.updated_at = new Date(Date.now() - 10_000).toISOString();
    expect(await avulso('e5')).toBe('pendente');
  });
  it('o sorteio de 0 a 35 s entra: com o sorteio no máximo, 40 s ainda é cedo; sem sorteio, passa', async () => {
    tabelas.system_state!.push({ key: 'linha_x:1', value: {}, updated_at: new Date(Date.now() - 40_000).toISOString() });
    const sorteio = vi.spyOn(TEMPOS_AVISO, 'sorteio').mockReturnValue(35_000);
    expect(await avulso('e6')).toBe('pendente');
    sorteio.mockReturnValue(0);
    expect(await avulso('e7')).toBe('enviado');
    sorteio.mockRestore();
  });
  it('espaçamento: leitura que falha vale como "ainda não" (pendente)', async () => {
    falhaSelect = q => q.ordenada && q.max === 1 && q.or.includes('solardoc_aviso_sent:');
    expect(await avulso('e8')).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('o cartão também espera o espaçamento e não gasta a chave dele', async () => {
    await compra('g1');
    tabelas.system_state!.push({ key: 'linha_x:1', value: {}, updated_at: new Date(Date.now() - 10_000).toISOString() });
    expect((await descarregarPendentes()).motivo).toBe('linha_espacando');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(chave('quiz_aviso_cartao_ultimo')).toBeUndefined();
    expect(chave('quiz_aviso_vez')).toBeUndefined();
    tabelas.system_state!.find(r => r.key === 'linha_x:1')!.updated_at = minAtras(2);
    expect((await descarregarPendentes()).enviados).toBe(1);
  });

  it('erro de linha 2 vezes seguidas grava a pausa de 15 min; o 1º só conta', async () => {
    sendToGroup.mockRejectedValue(new Error('[zapi:io] HTTP 503 — fora'));
    expect(await avulso('f1')).toBe('falhou');
    expect(erroLinha()!.value.n).toBe(1);
    expect(pausa()).toBeUndefined();
    liberarVez();
    expect(await avulso('f2')).toBe('falhou');
    expect(erroLinha()!.value.n).toBe(2);
    expect(pausa()).toBeDefined();
    const ate = Date.parse(pausa()!.value.ate) - Date.now();
    expect(ate).toBeGreaterThan(14 * 60_000);
    expect(ate).toBeLessThanOrEqual(15 * 60_000);
    expect(chave('quiz_aviso_trava')).toBeUndefined();
  });
  it('timeout e instância fora também são erro de linha', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('timeout'));
    await avulso('f3');
    expect(erroLinha()!.value.n).toBe(1);
  });
  it('envio ok zera a conta de erros seguidos', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 500 — fora'));
    expect(await avulso('f4')).toBe('falhou');
    expect(erroLinha()!.value.n).toBe(1);
    liberarVez();
    expect(await avulso('f5')).toBe('enviado');
    expect(erroLinha()!.value.n).toBe(0);
    liberarVez();
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 500 — fora'));
    await avulso('f6');
    expect(erroLinha()!.value.n).toBe(1);
    expect(pausa()).toBeUndefined();
  });
  it('4xx de destino arma SÓ a trava de 1 h: não conta erro de linha nem pausa a linha', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 400 — not a member'));
    expect(await avulso('h1')).toBe('falhou');
    expect(chave('quiz_aviso_trava')).toBeDefined();
    expect(erroLinha()).toBeUndefined();
    expect(pausa()).toBeUndefined();
  });
  it('o carimbo de um envio que falhou fica (5xx e 4xx), e conta no espaçamento', async () => {
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 502 — fora'));
    await avulso('i1');
    expect(tabelas.system_state!.filter(r => r.key.startsWith('solardoc_aviso_sent:'))).toHaveLength(1);
    liberarVez();
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 400 — nope'));
    await avulso('i2');
    expect(tabelas.system_state!.filter(r => r.key.startsWith('solardoc_aviso_sent:'))).toHaveLength(2);
  });
  it('o cartão que falha por erro de linha conta nos 2 seguidos; o ok zera', async () => {
    await compra('j1');
    sendToGroup.mockRejectedValueOnce(new Error('[zapi:io] HTTP 503 — fora'));
    expect((await descarregarPendentes()).motivo).toBe('falhou');
    expect(erroLinha()!.value.n).toBe(1);
    expect(tabelas.system_state!.filter(r => r.key.startsWith('solardoc_aviso_sent:'))).toHaveLength(1);
  });

  it('o cartão não sai com a linha em 40 por hora (e não gasta a chave do cartão)', async () => {
    await compra('k1'); await compra('k2');
    for (let i = 0; i < 40; i++) tabelas.system_state!.push({ key: `linha_x:${i}`, value: {}, updated_at: minAtras(5) });
    const r = await descarregarPendentes();
    expect(r.motivo).toBe('linha_cheia');
    expect(r.enviados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(chave('quiz_aviso_cartao_ultimo')).toBeUndefined();
    expect(claims().every(c => c.value.estado === 'pendente')).toBe(true);
  });
  it('o cartão não sai com erro de leitura do teto da linha (conta como linha cheia)', async () => {
    await compra('k3');
    falhaSelect = q => q.max === 41;   // a leitura dos envios da linha na hora
    const r = await descarregarPendentes();
    expect(r.motivo).toBe('linha_cheia');
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(chave('quiz_aviso_cartao_ultimo')).toBeUndefined();
    falhaSelect = null;
    expect((await descarregarPendentes()).enviados).toBe(1);
  });
  it('o aviso avulso também fica pendente com erro de leitura do teto (dos 12 por hora ou da linha)', async () => {
    falhaSelect = q => q.max === 41;
    expect(await avulso('k4')).toBe('pendente');
    liberarVez();
    falhaSelect = q => q.max === 200 && !q.ordenada;   // os avisos da última hora
    expect(await avulso('k5')).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('o teto de 12 avulsos por hora NÃO vale para o cartão', async () => {
    for (let i = 0; i < 12; i++) tabelas.system_state!.push({ key: `quiz_aviso:enviado${i}`, value: { estado: 'enviado' }, updated_at: minAtras(10) });
    await compra('k6');
    expect((await descarregarPendentes()).enviados).toBe(1);
  });

  it('claim parado em `novo` há mais de 10 min vale como pendente e sai no cartão; o de 5 min não', async () => {
    tabelas.system_state!.push(
      { key: 'quiz_aviso:velho', value: { tipo: 'desistencia', estado: 'novo', texto: '🔔 Aviso velho' }, updated_at: minAtras(11) },
      { key: 'quiz_aviso:fresco', value: { tipo: 'desistencia', estado: 'novo', texto: '🔔 Aviso fresco' }, updated_at: minAtras(5) },
      { key: 'quiz_aviso:semtexto', value: { tipo: 'desistencia', estado: 'novo' }, updated_at: minAtras(30) },
    );
    const r = await descarregarPendentes();
    expect(r.enviados).toBe(1);
    expect(sendToGroup.mock.calls[0]![1]).toBe('🔔 Aviso velho');
    expect(chave('quiz_aviso:velho')!.value.estado).toBe('enviado_cartao');
    expect(chave('quiz_aviso:fresco')!.value.estado).toBe('novo');
    expect(chave('quiz_aviso:semtexto')!.value.estado).toBe('novo');
  });
  it('o claim novo já nasce com o texto', async () => {
    let visto = '';
    sendToGroup.mockImplementationOnce(async () => { visto = String(chave(claims()[0]!.key)?.value.texto); return { messageId: 'm' }; });
    await avulso('l1');
    expect(visto).toContain('Desistência no quiz');
  });

  it('o cartão tem emoji só na primeira linha: o dos avisos cai fora (todos os 6 modelos)', async () => {
    const modelos = Object.keys(MODELOS) as ModeloAviso[];
    modelos.forEach((m, i) => tabelas.system_state!.push({
      key: `compra_aviso:em${i}`, value: { tipo: 'compra_cartao', estado: 'pendente', texto: montarAviso(m, { nome_completo: `Pessoa ${i}`, valor: 67 }) }, updated_at: minAtras(30 - i),
    }));
    const r = await descarregarPendentes();
    expect(r.enviados).toBe(modelos.length);
    const linhas = String(sendToGroup.mock.calls[0]![1]).split('\n');
    expect(linhas[0]).toMatch(/^📋 6 avisos/);
    expect(linhas.slice(1).join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
    for (let i = 0; i < modelos.length; i++) expect(linhas.join('\n')).toContain(`Pessoa ${i}`);
    expect(linhas.join('\n')).toContain('Desistência no quiz');
    expect(linhas.join('\n')).toContain('Compra no cartão (Stripe)');
  });
  it('um aviso só sai do jeito que foi montado (com o emoji dele)', async () => {
    await compra('m1');
    await descarregarPendentes();
    expect(sendToGroup.mock.calls[0]![1]).toMatch(/^✅ Compra no cartão/);
  });
});

describe('lista de grupos internos do CHEFE', () => {
  it('traz o do agendamento e o de vendas do SolarDoc, sem repetir nem trazer vazio', () => {
    expect(gruposInternosDaCasa({})).toEqual(['120363424419098566-group']);
    expect(gruposInternosDaCasa({ ZAPI_SOLARDOC_GRUPO_ID: GRUPO, GRUPO_VENDAS_SOLARDOC })).toEqual(['120363424419098566-group', GRUPO]);
    const lista = gruposInternosDaCasa({ GRUPO_VENDAS_SOLARDOC: GRUPO });
    expect(ehDestinoInterno(GRUPO, [], { grupos: lista })).toBe(true);
    expect(ehDestinoInterno('120363111111111111-group', [], { grupos: lista })).toBe(false);
    expect(GRUPO_VENDAS_SOLARDOC).toBe('');
  });
});
