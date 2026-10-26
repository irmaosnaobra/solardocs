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
    like: (c: string, pat: string) => { const pre = pat.replace(/%$/, ''); filtros.push(r => String(r[c]).startsWith(pre)); return q; },
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
const av = vi.hoisted(() => ({
  avaliar: vi.fn(),
  /** A janela da linha (9h às 20h, seg a sáb) AGORA: o tick usa o relógio de verdade, então o teste a controla. */
  janela: true,
  /** lerPosse do tick (só o motivo `posse`). */
  posse: vi.fn(),
}));
// A avaliacao do robo tem os testes dela (quizRecuperacaoCarla.test.ts): aqui so importa o que o tick faz com o resultado.
vi.mock('../services/solardoc/recuperacaoCarla', () => ({
  avaliarLead: (...a: unknown[]) => av.avaliar(...a),
  depsAvaliarReais: () => ({}),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  prefixosTotalDaLinha: () => ['linha_x:'], PREFIXOS_AGENDA: ['agenda_x:'], dentroDaJanelaDaBaseLinha: () => av.janela,
}));
vi.mock('../services/agentes5040/posse', () => ({ lerPosse: (...a: unknown[]) => av.posse(...a) }));

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
  process.env.QUIZ_RECUPERACAO_LIGADA = '0';   // os testes antigos do B1 rodam com o robô DESLIGADO (o robô nasce ligado; os testes do B2 apagam esta env)
  delete process.env.QUIZ_DESISTENCIA_OFF;
  delete process.env.ZAPI_IO_GROUP_ID;
  delete process.env.IO_GRUPO_ELETROPOSTO_ID;
});
afterEach(() => { delete process.env.ZAPI_SOLARDOC_GRUPO_ID; });

describe('textos dos avisos', () => {
  const todos = Object.keys(MODELOS) as ModeloAviso[];
  it('nenhum modelo sai com colchete sobrando, mesmo sem dado nenhum', () => {
    for (const m of todos) {
      expect(montarAviso(m, {})).not.toMatch(/\[|\]/);
      expect(montarAviso(m, { motivo_carla: 'A Carla está desligada agora.' })).not.toMatch(/\[|\]/);
      const cheio = montarAviso(m, { nome_completo: 'Carlos Andrade', empresa: 'Solar Andrade', cidade: 'Uberlândia-MG', telefone: '34999998888', indice: 37, perfil: 'Proposta no braço', propostas_mes: 'de 6 a 15', quando: 'esta semana', hora_carla: '10:15', valor: 67, codigo: 'SD-AB23' });
      expect(cheio).not.toMatch(/\[|\]|undefined|null|NaN/);
    }
  });
  it('telefone sai com +55', () => {
    expect(telefoneComDdi('34999998888')).toBe('+55 (34) 99999-8888');
    expect(telefoneComDdi('5534999998888')).toBe('+55 (34) 99999-8888');
    expect(telefoneComDdi('123')).toBe('não informado');
  });
  it('a linha da Carla: o motivo vale por cima da hora; sem nenhum dos dois não afirma que ela falou', () => {
    expect(montarAviso('desistencia', { hora_carla: '10:15' })).toContain('A Carla falou às 10:15.');
    expect(montarAviso('desistencia', { hora_carla: '10:15', motivo_carla: 'A Carla está desligada agora.' })).toContain('A Carla está desligada agora.');
    expect(montarAviso('desistencia', { hora_carla: '10:15', motivo_carla: 'A Carla está desligada agora.' })).not.toContain('falou às');
    expect(montarAviso('desistencia', {})).not.toContain('falou às');
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
  it('sem vaga: UMA vez por pessoa, para sempre (chave sem o dia), e não bloqueia a desistência', async () => {
    expect(await avisarSemVaga(lead())).toBe('enviado');
    expect(await avisarSemVaga(lead())).toBe('duplicado');
    liberarVez();
    expect(await avisarSemVaga(lead({ whatsapp: '34999998888' }))).toBe('duplicado');
    expect(claims().map(c => c.key)).toEqual([expect.stringMatching(/^quiz_aviso:[0-9a-f]{64}:semvaga$/)]);
    expect(await avisarDesistencia(lead())).toBe('enviado');
    expect(sendToGroup).toHaveBeenCalledTimes(2);
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
  it('e com o robô da Carla ligado (os pendentes saem do mesmo jeito)', async () => {
    delete process.env.QUIZ_RECUPERACAO_LIGADA;
    await avulso('e1');
    await compra('e2');
    liberarVez();
    const r = await runSolardocQuizDesistenciaTick();
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


// ── B2 (24/10/2026): o tick decide POR LEAD quem avisa o quê ──────────────────
describe('B2: o tick de desistência com o robô da Carla ligado', () => {
  // lead com CNPJ; `semCnpj` é o mesmo sem o campo
  const leadQuiz = (extra: Partial<LeadQuizLinha> = {}) => ({ ...lead({}, [{ name: 'cnpj', values: ['sim'] }]), form_id: 'quiz_solardoc', ...extra });
  const semCnpj = (extra: Partial<LeadQuizLinha> = {}) => ({ ...lead(), form_id: 'quiz_solardoc', ...extra });
  const hmacDoLead = (tel: string) => hmacDe(chaveDoTelefone(normalizarTelefoneSd(tel)!))!;
  const ligar = () => { delete process.env.QUIZ_RECUPERACAO_LIGADA; };
  const naoChama = (motivo: string) => av.avaliar.mockResolvedValue({ ok: false, motivo });
  const podeChamar = () => av.avaliar.mockResolvedValue({ ok: true, tel: '5534999998888', chave: '3499998888', hmac: 'x', codigo: 'SD-AB23' });
  /** A largada do robô: 3 dias atrás (a menos que o teste diga outra). */
  const semearLargada = (minutosAtras = 3 * 24 * 60) => tabelas.system_state!.push({ key: 'quiz_rec_largada', value: { em: minAtras(minutosAtras) }, updated_at: agora() });
  const textoEnviado = (): string => String(sendToGroup.mock.calls[0]![1]);
  beforeEach(() => { ligar(); av.avaliar.mockReset(); av.posse.mockReset(); av.janela = true; semearLargada(); });

  it('segura para o robô só com as TRÊS coisas juntas (ligado, janela aberta agora, menos de 60 min): o tick NÃO avisa e não gasta a conta', async () => {
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(0);
    expect(r.deixadosAoRobo).toBe(1);
    expect(av.avaliar).not.toHaveBeenCalled();
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(claims()).toHaveLength(0);
  });
  it('fora da janela da linha o tick avisa JÁ: "A Carla chama no próximo horário", com a Giovanna, e a Carla ainda pode chamar', async () => {
    av.janela = false;
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    const t = textoEnviado();
    expect(t).toContain('A Carla chama no próximo horário da linha, de segunda a sábado, das 9h às 20h.');
    expect(t.endsWith('A responsável é a Giovanna.')).toBe(true);
    expect(t).not.toMatch(/—|falou às/);
    // a marca que deixa a Carla chamar mais tarde foi gravada ANTES do aviso
    expect(chave(`quiz_rec_ainda:${hmacDoLead('5534999998888')}`)).toBeTruthy();
    // e quando ela chamar, o aviso dela cai como duplicado: um aviso só por lead
    expect(await avisarDesistencia(leadQuiz(), { horaCarla: '09:05', soReivindicar: true })).toBe('duplicado');
    expect(claims()).toHaveLength(1);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
  });
  it('dentro da janela mas com 60 min sem a Carla: "A Carla ainda não teve vaga para chamar."', async () => {
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(61) }));
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    const t = textoEnviado();
    expect(t).toContain('A Carla ainda não teve vaga para chamar.');
    expect(t.endsWith('A responsável é a Giovanna.')).toBe(true);
    expect(chave(`quiz_rec_ainda:${hmacDoLead('5534999998888')}`)).toBeTruthy();
  });
  it('59 min com a janela aberta ainda é do robô; a linha fecha no meio e o mesmo lead é avisado', async () => {
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(59) }));
    expect((await runSolardocQuizDesistenciaTick()).avisados).toBe(0);
    av.janela = false;
    expect((await runSolardocQuizDesistenciaTick()).avisados).toBe(1);
    expect(textoEnviado()).toContain('A Carla chama no próximo horário');
  });
  it('a Carla não vai chamar (sem CNPJ): o tick avisa aos 15 min, mesmo com a janela aberta, com a linha do motivo e a Giovanna', async () => {
    tabelas.leads_meta!.push(semCnpj());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    const t = textoEnviado();
    expect(t).toContain('A Carla não vai chamar: ainda sem CNPJ.');
    expect(t).toContain('A responsável é a Giovanna.');
    expect(t).not.toContain('falou às');
    expect(av.avaliar).not.toHaveBeenCalled();   // conferência que não lê banco
    expect(chave(`quiz_rec_ainda:${hmacDoLead('5534999998888')}`)).toBeUndefined();   // essa a Carla NÃO chama: sem marca
  });
  it('um motivo por caso: já falou, suprimido (60 min ou mais), antes da largada (sem ler banco)', async () => {
    for (const [motivo, frase] of [['ja_falou', 'ele já falou com a linha'], ['suprimido', 'ele pediu para não receber mensagem'], ['mudo', 'ele não respondeu aos últimos toques da linha']] as const) {
      for (const k of Object.keys(tabelas)) tabelas[k] = [];
      semearLargada();
      sendToGroup.mockClear(); liberarTudo();
      naoChama(motivo);
      tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(90) }));
      await runSolardocQuizDesistenciaTick();
      expect(textoEnviado()).toContain(`A Carla não vai chamar: ${frase}.`);
    }
    for (const k of Object.keys(tabelas)) tabelas[k] = [];
    semearLargada(5);   // a Carla começou há 5 min: o lead de 20 min é de antes dela
    sendToGroup.mockClear(); liberarTudo(); av.avaliar.mockClear();
    tabelas.leads_meta!.push(leadQuiz());
    await runSolardocQuizDesistenciaTick();
    expect(textoEnviado()).toContain('A Carla não vai chamar: o lead é de antes de ela começar.');
    expect(av.avaliar).not.toHaveBeenCalled();
  });
  it('leitura que falhou não é motivo: não avisa e não toma o claim', async () => {
    naoChama('leitura_falhou');
    tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(90) }));
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(0);
    expect(claims()).toHaveLength(0);
  });
  it('robô desligado pela env: "A Carla está desligada agora." aos 15 min', async () => {
    process.env.QUIZ_RECUPERACAO_LIGADA = '0';
    tabelas.leads_meta!.push(leadQuiz());
    await runSolardocQuizDesistenciaTick();
    expect(textoEnviado()).toContain('A Carla está desligada agora.');
    expect(av.avaliar).not.toHaveBeenCalled();
  });
  it('robô pausado pela chave do banco: também "desligada agora"', async () => {
    tabelas.system_state!.push({ key: 'quiz_rec_pausa', value: { motivo: 'dono' }, updated_at: agora() });
    tabelas.leads_meta!.push(leadQuiz());
    await runSolardocQuizDesistenciaTick();
    expect(textoEnviado()).toContain('A Carla está desligada agora.');
  });
  it('qualquer outro valor da env não desliga: o robô segue ligado e o tick deixa o lead com ele', async () => {
    process.env.QUIZ_RECUPERACAO_LIGADA = '1';
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('venceu em 48 h sem a Carla chamar: o tick avisa (lê até 50 h)', async () => {
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(49 * 60) }));
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    expect(textoEnviado()).toContain('A Carla não chamou: passou de 48 horas sem vaga.');
  });
  it('mais de 50 h: nem lê', async () => {
    podeChamar();
    tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(51 * 60) }));
    expect((await runSolardocQuizDesistenciaTick()).avisados).toBe(0);
  });
  it('a Carla chamou e o aviso dela não foi tomado em 5 min (o robô caiu): o tick assume, com a hora', async () => {
    const h = hmacDoLead('5534999998888');
    tabelas.system_state!.push({ key: `quiz_rec_sent:${h}`, value: { em: minAtras(10) }, updated_at: minAtras(10) });
    tabelas.leads_meta!.push(leadQuiz());
    await runSolardocQuizDesistenciaTick();
    expect(textoEnviado()).toMatch(/A Carla falou às \d\d:\d\d\./);
    expect(av.avaliar).not.toHaveBeenCalled();
  });
  it('a Carla chamou há pouco: o aviso é do robô, o tick espera', async () => {
    const h = hmacDoLead('5534999998888');
    tabelas.system_state!.push({ key: `quiz_rec_sent:${h}`, value: { em: minAtras(1) }, updated_at: minAtras(1) });
    tabelas.leads_meta!.push(leadQuiz());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
  });
  it('o sendFrio calou (carimbo nao_saiu): o tick avisa NA HORA com o motivo e nunca com "falou às"', async () => {
    const h = hmacDoLead('5534999998888');
    tabelas.system_state!.push({ key: `quiz_rec_sent:${h}`, value: { em: minAtras(1), estado: 'nao_saiu' }, updated_at: minAtras(1) });
    tabelas.leads_meta!.push(leadQuiz());
    const r = await runSolardocQuizDesistenciaTick();
    expect(r.avisados).toBe(1);
    expect(textoEnviado()).toContain('A Carla não chamou: a mensagem não chegou a sair.');
    expect(textoEnviado()).not.toContain('falou às');
  });
  it('o aviso do robô ("A Carla falou às 14:00.") entra PENDENTE, sai uma vez só e o tick não avisa em dobro', async () => {
    const l = leadQuiz();
    expect(await avisarDesistencia(l, { horaCarla: '14:00', soReivindicar: true })).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();   // o robô nunca envia na mesma rodada
    expect(claims()).toHaveLength(1);
    envelhecerCarimbos();
    tabelas.leads_meta!.push(l);
    naoChama('ja_falou');   // mesmo que o tick achasse um motivo, o claim do robô vale: um aviso por lead
    const r1 = await runSolardocQuizDesistenciaTick();
    expect(r1.pendentes).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(textoEnviado()).toContain('A Carla falou às 14:00.');
    expect(textoEnviado()).not.toContain('não vai chamar');
    liberarTudo();
    const r2 = await runSolardocQuizDesistenciaTick();
    expect(r2.avisados).toBe(0);
    expect(r2.pendentes).toBe(0);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
  });
  it('o aviso do robô e o do tick disputam o mesmo claim: quem chega depois recebe duplicado', async () => {
    const l = leadQuiz();
    expect(await avisarDesistencia(l, { motivoCarla: 'A Carla não vai chamar: ainda sem CNPJ.' })).toBe('enviado');
    expect(await avisarDesistencia(l, { horaCarla: '14:00', soReivindicar: true })).toBe('duplicado');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
  });

  describe('a conta de 12 avaliações por rodada', () => {
    const tel = (i: number) => `55349${String(10000000 + i)}`;
    it('12 leads novos segurados para o robô + 1 antigo sem CNPJ: o antigo é avisado na mesma rodada, sem gastar a conta', async () => {
      podeChamar();
      for (let i = 0; i < 12; i++) tabelas.leads_meta!.push(leadQuiz({ lead_id: `sdquiz_n${i}`, whatsapp: tel(i), nome: `Novo ${i}`, created_time: minAtras(16 + i) }));
      tabelas.leads_meta!.push(semCnpj({ lead_id: 'sdquiz_velho', whatsapp: tel(99), nome: 'Antigo Sem Cnpj', created_time: minAtras(300) }));
      const r = await runSolardocQuizDesistenciaTick();
      expect(r.deixadosAoRobo).toBe(12);
      expect(r.avisados).toBe(1);
      expect(textoEnviado()).toContain('Antigo Sem Cnpj');
      expect(textoEnviado()).toContain('A Carla não vai chamar: ainda sem CNPJ.');
      expect(av.avaliar).not.toHaveBeenCalled();   // nem os segurados nem o sem CNPJ leem banco
    });
    it('quem precisa de leitura continua limitado a 12 por rodada', async () => {
      naoChama('leitura_falhou');   // não avisa, então só a conta de 12 (e não as 10 tentativas) limita
      for (let i = 0; i < 13; i++) tabelas.leads_meta!.push(leadQuiz({ lead_id: `sdquiz_o${i}`, whatsapp: tel(i), nome: `Velho ${i}`, created_time: minAtras(120 + i) }));
      await runSolardocQuizDesistenciaTick();
      expect(av.avaliar).toHaveBeenCalledTimes(12);
    });
  });

  describe('corrida com a rodada do robô (o carimbo é relido antes de avisar)', () => {
    const h = () => hmacDoLead('5534999998888');
    it('a Carla chamou DEPOIS da leitura da página: o tick não avisa "outra agente", deixa para o caminho do robô', async () => {
      // a avaliação vê a posse que o robô acabou de tomar; o carimbo dele já existe (o robô grava o carimbo ANTES da posse)
      av.avaliar.mockImplementation(async () => {
        tabelas.system_state!.push({ key: `quiz_rec_sent:${h()}`, value: { em: agora() }, updated_at: agora() });
        return { ok: false, motivo: 'posse' };
      });
      tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(90) }));
      const r = await runSolardocQuizDesistenciaTick();
      expect(r.avisados).toBe(0);
      expect(r.deixadosAoRobo).toBe(1);
      expect(sendToGroup).not.toHaveBeenCalled();
      expect(claims()).toHaveLength(0);
      expect(av.posse).not.toHaveBeenCalled();
    });
    it('o mesmo com a linha fechada: não escreve "chama no próximo horário" para quem a Carla acabou de chamar', async () => {
      av.janela = false;
      av.avaliar.mockImplementation(async () => {
        tabelas.system_state!.push({ key: `quiz_rec_sent:${h()}`, value: { em: agora() }, updated_at: agora() });
        return { ok: true, tel: '5534999998888', chave: '3499998888', hmac: 'x', codigo: 'SD-AB23' };
      });
      tabelas.leads_meta!.push(leadQuiz());
      const r = await runSolardocQuizDesistenciaTick();
      expect(r.avisados).toBe(0);
      expect(sendToGroup).not.toHaveBeenCalled();
      expect(claims()).toHaveLength(0);
      expect(chave(`quiz_rec_ainda:${h()}`)).toBeUndefined();
    });
    it('carimbo de mais de 5 min achado na releitura: o aviso sai com a hora da Carla', async () => {
      av.janela = false;
      av.avaliar.mockImplementation(async () => {
        tabelas.system_state!.push({ key: `quiz_rec_sent:${h()}`, value: { em: minAtras(9) }, updated_at: minAtras(9) });
        return { ok: false, motivo: 'posse' };
      });
      tabelas.leads_meta!.push(leadQuiz());
      await runSolardocQuizDesistenciaTick();
      expect(textoEnviado()).toMatch(/A Carla falou às \d\d:\d\d\./);
    });
    it('posse da própria Carla (viva, sem carimbo) não é "outra agente"; posse de outra é; posse que sumiu não avisa', async () => {
      naoChama('posse');
      tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(90) }));
      av.posse.mockResolvedValue({ dona: 'carla', estado: 'viva' });
      await runSolardocQuizDesistenciaTick();
      expect(textoEnviado()).toContain('A Carla não vai chamar: ele já falou com a linha.');
      expect(textoEnviado()).not.toContain('outra agente');

      for (const k of Object.keys(tabelas)) tabelas[k] = [];
      semearLargada(); sendToGroup.mockClear(); liberarTudo();
      tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(90) }));
      av.posse.mockResolvedValue({ dona: 'duda', estado: 'viva' });
      await runSolardocQuizDesistenciaTick();
      expect(textoEnviado()).toContain('A Carla não vai chamar: outra agente já está com a conversa.');

      for (const k of Object.keys(tabelas)) tabelas[k] = [];
      semearLargada(); sendToGroup.mockClear(); liberarTudo();
      tabelas.leads_meta!.push(leadQuiz({ created_time: minAtras(90) }));
      av.posse.mockResolvedValue(null);
      const r = await runSolardocQuizDesistenciaTick();
      expect(r.avisados).toBe(0);
      expect(claims()).toHaveLength(0);
    });
  });
});

// ── pedidos de 24/10: aviso que já saiu não sai de novo, e o teto dos 12 só conta o que saiu ──
describe('o claim parado em `novo` depois de um envio que deu certo', () => {
  const velho = (k: string, estado: string, min = 11) => {
    const r = chave(k)!;
    r.value = { tipo: r.value.tipo, estado, texto: r.value.texto ?? 'texto do aviso' };   // o claim `novo` nasce com o texto
    r.updated_at = minAtras(min);
  };

  it('envio ok e `marcar(enviado)` que falhou: 10 min depois NÃO reenvia (o carimbo leva a chave do aviso)', async () => {
    expect(await avulso('r1')).toBe('enviado');
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    const k = claims()[0]!.key;
    const carimbo = tabelas.system_state!.find(r => r.key.startsWith('solardoc_aviso_sent:'))!;
    expect(carimbo.value.chaves).toEqual([k]);
    velho(k, 'novo');                       // como se o marcar tivesse falhado
    liberarTudo();
    const r = await descarregarPendentes();
    expect(r.enviados).toBe(0);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(chave(k)!.value.estado).toBe('enviado');
  });
  it('sem o carimbo (a função caiu antes do envio) o `novo` velho ainda vira pendente e sai uma vez', async () => {
    expect(await avulso('r2')).toBe('enviado');
    const k = claims()[0]!.key;
    tabelas.system_state = tabelas.system_state!.filter(r => !r.key.startsWith('solardoc_aviso_sent:'));
    velho(k, 'novo');
    liberarTudo();
    expect((await descarregarPendentes()).enviados).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(2);
  });
  it('cartão enviado e `marcar(enviado_cartao)` que falhou: o pendente não volta ao grupo', async () => {
    await compra('c1');
    liberarTudo();
    expect((await descarregarPendentes()).enviados).toBe(1);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    velho('compra_aviso:c1', 'pendente', 1);
    liberarTudo();
    const r = await descarregarPendentes();
    expect(r.enviados).toBe(0);
    expect(sendToGroup).toHaveBeenCalledTimes(1);
    expect(chave('compra_aviso:c1')!.value.estado).toBe('enviado_cartao');
  });
  it('e-mail do resumo da parada e `marcar(email)` que falhou: o `novo` velho não vai ao grupo depois', async () => {
    tabelas.system_state!.push({ key: 'ag5040_linha_pausa', value: { ate: new Date(Date.now() + 10 * 60_000).toISOString() }, updated_at: agora() });
    expect(await avulso('m1')).toBe('por_email');
    const k = claims()[0]!.key;
    expect(tabelas.system_state!.some(r => r.key === `solardoc_aviso_mail:${k}`)).toBe(true);
    velho(k, 'novo');
    tabelas.system_state = tabelas.system_state!.filter(r => r.key !== 'ag5040_linha_pausa');
    liberarTudo();
    const r = await descarregarPendentes();
    expect(r.enviados).toBe(0);
    expect(sendToGroup).not.toHaveBeenCalled();
    expect(chave(k)!.value.estado).toBe('email');
  });
});

describe('o teto de 12 avulsos por hora só conta o que de fato saiu', () => {
  const claimFalso = (i: number, estado: string) => tabelas.system_state!.push({
    key: `quiz_aviso:${String(i).padStart(64, '0')}`, value: { tipo: 'desistencia', estado, texto: 'x' }, updated_at: agora(),
  });

  it('pendente, email e sem_grupo na última hora não gastam o teto', async () => {
    const estados = ['pendente', 'email', 'sem_grupo', 'falhou', 'novo', 'comprou', 'enviado_cartao'];
    for (let i = 0; i < 30; i++) claimFalso(i, estados[i % estados.length]!);
    expect(await avulso('t1')).toBe('enviado');
  });
  it('mais de 200 claims que não saíram não escondem os 12 que saíram: o 13º fica pendente', async () => {
    for (let i = 0; i < 210; i++) claimFalso(1000 + i, 'pendente');
    for (let i = 0; i < 12; i++) claimFalso(i, 'enviado');
    expect(await avulso('t2')).toBe('pendente');
  });
  it('12 `enviado` na hora enchem o teto', async () => {
    for (let i = 0; i < 12; i++) claimFalso(i, 'enviado');
    expect(await avulso('t3')).toBe('pendente');
    expect(sendToGroup).not.toHaveBeenCalled();
  });
});
