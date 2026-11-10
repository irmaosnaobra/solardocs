import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RECEPÇÃO DE USUÁRIOS NOVOS DA SOLARDOC (09/11/2026): o robô de WhatsApp e o de e-mail, as regras puras e a convivência com a 2b do pós-venda.
// O banco falso impõe chave única em system_state (o claim por INSERT). O portão da linha (recuperacaoCheckoutPortao) é o de verdade; o teto e o
// espaçamento da linha são trocados por contas sobre as chaves `recep_sent:` (as mesmas que a linha real conta).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const H = vi.hoisted(() => ({
  db: {} as Record<string, Array<Record<string, any>>>,
  envios: [] as Array<{ tel: string; partes: string[]; instancia: string }>,
  sendFrio: { retorno: true as boolean, lanca: false },
  sessao: [] as any[],
  emails: [] as any[],
  emailFalha: false,
  passos: {} as Record<string, any>,
  conversa: ((_chave: string) => ({ msgs: [], completa: true })) as (chave: string) => { msgs: any[]; completa: boolean },
  sondaQuebrada: false,
  erroTabela: null as null | string,
}));
const db = H.db;

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: 'select' | 'insert' | 'delete' = 'select';
  let pendente: Row | null = null;
  let max = Infinity;
  let ordem: { col: string; asc: boolean } | null = null;
  const linhas = () => {
    let l = (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));
    if (ordem) l = [...l].sort((a, b) => (String(a[ordem!.col]) < String(b[ordem!.col]) ? -1 : 1) * (ordem!.asc ? 1 : -1));
    return l.slice(0, max);
  };
  function executa(): { data: any; error: any } {
    if (!db[table]) db[table] = [];
    if (modo === 'insert') {
      if (table === 'system_state' && db[table].some((r) => r.key === pendente!.key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      db[table].push({ ...pendente });
      return { data: null, error: null };
    }
    if (modo === 'delete') {
      const alvos = new Set(linhas());
      db[table] = db[table].filter((r) => !alvos.has(r));
      return { data: null, error: null };
    }
    if (H.erroTabela === table) return { data: null, error: { code: 'XX000', message: 'banco fora' } };
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }
  const q: any = {
    select: () => q,
    insert: (r: Row) => { modo = 'insert'; pendente = r; return q; },
    delete: () => { modo = 'delete'; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    is: (c: string, v: any) => { filtros.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
    not: (c: string, op: string, v: any) => { filtros.push((r) => (op === 'is' && v === null ? r[c] != null : true)); return q; },
    in: (c: string, vs: any[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    gte: (c: string, v: any) => { filtros.push((r) => String(r[c]) >= String(v)); return q; },
    lte: (c: string, v: any) => { filtros.push((r) => String(r[c]) <= String(v)); return q; },
    like: (c: string, p: string) => { const pre = p.replace(/%$/, ''); filtros.push((r) => String(r[c]).startsWith(pre)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { const { data, error } = executa(); return Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error }); },
    then: (res: (v: any) => void) => res(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('stripe', () => ({ default: class { } }));
vi.mock('../services/agents/whatsapp/pixRecoveryAgentService', () => ({ enviarOpenerRecuperacao: vi.fn() }));
vi.mock('../services/agentes5040/posse', () => ({ cedeAAgente: vi.fn(), lerPosse: vi.fn() }));
vi.mock('../utils/mailer', () => ({
  sendFollowupEmail: vi.fn(), sendNoContractsReminderEmail: vi.fn(), sendCnpjOngoingEmail: vi.fn(), sendCheckoutRecoveryEmail: vi.fn(),
  sendCheckoutCompletionEmail: vi.fn(), sendUpgradeNudgeEmail: vi.fn(), sendAbandonedCartEmail: vi.fn(),
  sendRecepcaoEmail: vi.fn(async (o: any) => { if (H.emailFalha) throw new Error('resend fora'); H.emails.push(o); return true; }),
  sendOpsAlert: vi.fn(async () => {}),
}));
vi.mock('../services/agents/zapiClient', () => ({
  solardocViaIo: vi.fn(() => false),
  sendFrio: vi.fn(async (tel: string, partes: string[], instancia: string) => {
    if (H.sendFrio.lanca) throw new Error('z-api fora');
    H.envios.push({ tel, partes, instancia });
    return H.sendFrio.retorno;
  }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async () => {
  const real = await vi.importActual<typeof import('../services/agents/whatsapp/lineThrottle')>('../services/agents/whatsapp/lineThrottle');
  // O espaçamento real olha 10 a 15 min e a vaga do dia olha 24 h (a hora do relógio do teste é a de AGORA, fixa).
  const AGORA_T = Date.parse('2026-11-11T15:00:00Z');
  const carimbos = (janelaMs: number) => (db.system_state ?? []).filter((r) => String(r.key).startsWith('recep_sent:') && Date.parse(String(r.updated_at)) >= AGORA_T - janelaMs).length;
  return {
    ...real,
    dentroDoTetoHorarioLinha: vi.fn(async () => true),
    respeitaEspacamentoLinha: vi.fn(async () => carimbos(15 * 60_000) === 0),
    vagasDoFrioLinha: vi.fn(async () => {
      const n = H.sondaQuebrada ? 0 : carimbos(24 * 3_600_000);
      return { hora: { teto: 6, usadas: n }, dia: { teto: 30, usadas: n } };
    }),
  };
});
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  TOQUES_ATE_DESISTIR: 3,
  motivosDaSupressao: vi.fn(async () => []),
  carregarMudos: vi.fn(async () => () => false),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({ podeFalarComLead: vi.fn(async () => ({ pode: true })) }));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ CHAVE_LINHA_PAUSA: 'ag5040_linha_pausa' }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(async (a: any) => { H.sessao.push(a); }),
}));
vi.mock('../services/agentes5040/contexto', () => ({ lerConversa: vi.fn(async (chave: string) => H.conversa(chave)) }));
vi.mock('../services/solardoc/primeirosPassos', async () => {
  const real = await vi.importActual<typeof import('../services/solardoc/primeirosPassos')>('../services/solardoc/primeirosPassos');
  return {
    ...real,
    carregarPassosEmLote: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => H.passos[id]).map((id) => [id, H.passos[id]]))),
    carregarPassos: vi.fn(async (id: string) => H.passos[id]?.resultado ?? null),
  };
});

import { calcularPassos } from '../services/solardoc/primeirosPassos';
import {
  rodarSondaRecepcao, type DepsSondaRecep, enviarRecepcaoWhatsApp, enviarRecepcaoEmail, rodarRecepcaoWhatsApp, decidirPelaConversa, ancorasDosToquesNossos, emailDaRecepcaoPodeIr, instanciaDaLinhaSolardoc,
  escolherToque, textoRecepcao, conteudoEmailRecepcao, chaveRecepSent, chaveRecepPulo, chaveRecepEmail, chaveRecepEmailPulo, chavesRecepSentDe,
  ESPERA_TOQUE_MS, CHAVE_RECEP_SONDA_OK, CHAVE_RECEP_SONDA_FALHOU, TOQUES, type ToqueRecep,
} from '../services/solardoc/recepcaoNovoUsuario';
import { enviarPrimeiraProposta } from '../services/solardoc/ativacaoPosVenda';
import { prefixosDaLinha, PREFIXOS_AGENDA } from '../services/agents/whatsapp/lineThrottle';

// Quarta-feira, 12h em Brasília: dentro da janela da Base.
const AGORA = new Date('2026-11-11T15:00:00Z');
const HORA = 3_600_000;
const iso = (horasAtras: number) => new Date(AGORA.getTime() - horasAtras * HORA).toISOString();
const envOriginal = { ...process.env };

const fechadoSet = (...ts: ToqueRecep[]) => new Set<ToqueRecep>(ts);

function usuario(id: string, horas: number, extra: Row = {}): void {
  (db.users ??= []).push({
    id, email: `${id}@exemplo.com`, nome: 'Joao Silva', whatsapp: `3499999${id.replace(/\D/g, '').padStart(4, '0')}`, plano: 'free',
    created_at: iso(horas), password_hash: 'hash', is_admin: false, whatsapp_opt_out: null, email_opt_out: null, ...extra,
  });
}
/** Os passos que o robô enxerga (a leitura de verdade é trocada; a conta é a calcularPassos real). */
function passos(id: string, e: { empresa?: boolean; logo?: boolean; fotos?: number; proposta?: boolean; plano?: string; linhaEmpresa?: boolean } = {}): void {
  const resultado = calcularPassos({
    empresaNome: e.empresa ? 'Solar Ltda' : '', empresaCnpj: e.empresa ? '11222333000181' : '', logo: e.logo ? 'data:image/png;base64,xx' : '',
    qtdFotos: e.fotos ?? 0, temProposta: e.proposta === true, whatsapp: '34999990001', plano: e.plano ?? 'free',
  });
  H.passos[id] = { resultado, temLinhaEmpresa: e.linhaEmpresa ?? e.empresa === true, plano: e.plano ?? 'free' };
}
const chaves = (prefixo: string): string[] => (db.system_state ?? []).map((r) => String(r.key)).filter((k) => k.startsWith(prefixo)).sort();
const marcaSondaOk = () => (db.system_state ??= []).push({ key: CHAVE_RECEP_SONDA_OK, value: {}, updated_at: iso(1) });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  H.envios.length = 0; H.sessao.length = 0; H.emails.length = 0;
  H.sendFrio.retorno = true; H.sendFrio.lanca = false; H.emailFalha = false; H.sondaQuebrada = false; H.erroTabela = null;
  for (const k of Object.keys(H.passos)) delete H.passos[k];
  H.conversa = () => ({ msgs: [], completa: true });
  delete process.env.RECEPCAO_OFF;
  process.env.ZAPI_INSTANCE_ID = 'inst-solardoc';
});
afterEach(() => { process.env = { ...envOriginal }; });

// ── regras puras ─────────────────────────────────────────────────────────────

describe('calcularPassos', () => {
  const base = { qtdFotos: 0, temProposta: false };
  it('conta nova: nada feito, o próximo é a empresa, WhatsApp à parte', () => {
    const r = calcularPassos({ ...base, plano: 'free' });
    expect(r).toEqual({
      passos: [
        { id: 'empresa', feito: false }, { id: 'logo', feito: false }, { id: 'fotos', feito: false, qtd: 0, minimo: 6 },
        { id: 'proposta', feito: false }, { id: 'whatsapp', feito: false },
      ],
      proximo: 'empresa', feitos: 0, total: 4, tudoPronto: false, pago: false,
    });
  });
  it('empresa só vale com nome E cnpj não vazios (espaço não conta)', () => {
    expect(calcularPassos({ ...base, empresaNome: 'X', empresaCnpj: '' }).passos[0]).toEqual({ id: 'empresa', feito: false });
    expect(calcularPassos({ ...base, empresaNome: '  ', empresaCnpj: '1' }).passos[0]).toEqual({ id: 'empresa', feito: false });
    expect(calcularPassos({ ...base, empresaNome: 'X', empresaCnpj: '1' }).passos[0]).toEqual({ id: 'empresa', feito: true });
  });
  it('fotos: 6 ou mais; com 5 falta e a quantidade aparece', () => {
    expect(calcularPassos({ ...base, qtdFotos: 5 }).passos[2]).toEqual({ id: 'fotos', feito: false, qtd: 5, minimo: 6 });
    expect(calcularPassos({ ...base, qtdFotos: 6 }).passos[2]).toEqual({ id: 'fotos', feito: true, qtd: 6, minimo: 6 });
    expect(calcularPassos({ ...base, qtdFotos: 12 }).passos[2]).toMatchObject({ feito: true, qtd: 12 });
  });
  it('o próximo respeita a ordem empresa, logo, fotos, proposta; o WhatsApp não entra na conta', () => {
    const r = calcularPassos({ empresaNome: 'X', empresaCnpj: '1', logo: '', qtdFotos: 9, temProposta: true, whatsapp: '34999990001' });
    expect(r.proximo).toBe('logo');
    expect(r.feitos).toBe(3);
    expect(r.tudoPronto).toBe(false);
    expect(r.passos[4]).toEqual({ id: 'whatsapp', feito: true });
    const sem = calcularPassos({ empresaNome: 'X', empresaCnpj: '1', logo: 'l', qtdFotos: 6, temProposta: true, whatsapp: '' });
    expect(sem).toMatchObject({ proximo: null, feitos: 4, tudoPronto: true });
    expect(sem.passos[4]).toEqual({ id: 'whatsapp', feito: false });
  });
  it('pago = plano diferente de free', () => {
    expect(calcularPassos({ ...base, plano: 'free' }).pago).toBe(false);
    expect(calcularPassos({ ...base, plano: 'pro' }).pago).toBe(true);
    expect(calcularPassos({ ...base, plano: 'ilimitado' }).pago).toBe(true);
  });
});

describe('escolherToque', () => {
  const idade = (t: ToqueRecep | 0, mais = 0) => (t === 0 ? 5 * HORA : ESPERA_TOQUE_MS[t] + mais);
  it('antes de 20 h nada vence', () => { expect(escolherToque(19 * HORA, 'empresa', fechadoSet())).toEqual({ enviar: null, pular: [] }); });
  it('só vale o toque mais alto que venceu; os menores abertos viram pulados', () => {
    expect(escolherToque(idade(1, 1), 'logo', fechadoSet())).toEqual({ enviar: 1, pular: [] });
    expect(escolherToque(idade(2, 1), 'logo', fechadoSet())).toEqual({ enviar: 2, pular: [1] });
    expect(escolherToque(idade(3, 1), 'logo', fechadoSet())).toEqual({ enviar: 3, pular: [1, 2] });
  });
  it('toque já enviado ou pulado não volta, e o menor já fechado não entra em pular', () => {
    expect(escolherToque(idade(2, 1), 'logo', fechadoSet(1))).toEqual({ enviar: 2, pular: [] });
    expect(escolherToque(idade(3, 1), 'logo', fechadoSet(1, 2, 3))).toEqual({ enviar: null, pular: [] });
    expect(escolherToque(idade(3, 1), 'logo', fechadoSet(3, 1))).toEqual({ enviar: null, pular: [2] });
  });
  it('toque aberto abaixo de um já fechado nunca sai: o R1 não volta depois do R2 enviado', () => {
    expect(escolherToque(idade(2, 1), 'logo', fechadoSet(2))).toEqual({ enviar: null, pular: [1] });
    expect(escolherToque(idade(3, 1), 'logo', fechadoSet(3))).toEqual({ enviar: null, pular: [1, 2] });
    expect(escolherToque(idade(3, 1), 'logo', fechadoSet(2))).toEqual({ enviar: 3, pular: [1] });
  });
  it('tudo pronto: R1 e R2 viram pulados (nada sai); o R3 sai para todos', () => {
    expect(escolherToque(idade(1, 1), null, fechadoSet())).toEqual({ enviar: null, pular: [1] });
    expect(escolherToque(idade(2, 1), null, fechadoSet())).toEqual({ enviar: null, pular: [1, 2] });
    expect(escolherToque(idade(2, 1), null, fechadoSet(1))).toEqual({ enviar: null, pular: [2] });
    expect(escolherToque(idade(3, 1), null, fechadoSet())).toEqual({ enviar: 3, pular: [1, 2] });
  });
});

describe('textos do WhatsApp', () => {
  const ctxs = [
    ...(['empresa', 'logo', 'fotos', 'proposta'] as const).map((p) => ({ proximo: p, temProposta: false, fotosFeito: false })),
    { proximo: null, temProposta: false, fotosFeito: false }, { proximo: null, temProposta: true, fotosFeito: false },
    { proximo: null, temProposta: true, fotosFeito: true }, { proximo: 'proposta' as const, temProposta: false, fotosFeito: true },
  ];
  const todos = (): string[] => {
    const out: string[] = [];
    for (const nome of ['Maria', null, 'Cliente', 'Joao Pedro']) for (const toque of TOQUES) for (const c of ctxs) {
      const t = textoRecepcao(toque, nome, c);
      if (t) out.push(t);
    }
    return out;
  };
  it('até 900 caracteres, sem travessão, sem emoji, sem link e começando em maiúscula', () => {
    const lista = todos();
    expect(lista.length).toBeGreaterThan(30);
    for (const t of lista) {
      expect(t.length, t).toBeLessThanOrEqual(900);
      expect(t, t).not.toMatch(/[—–]/);
      expect(t, t).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(t, t).not.toMatch(/https?:|www\./);
      expect(t[0]).toBe('O');
    }
  });
  it('abertura da Giovanna + espaço + corpo; R1 e R2 sem próximo passo não têm texto', () => {
    expect(textoRecepcao(1, 'Maria', { proximo: 'empresa', temProposta: false, fotosFeito: false }))
      .toBe('Oi, Maria, aqui é a Giovanna, do suporte da SolarDoc. Vi que você criou sua conta na SolarDoc. O próximo passo é cadastrar os dados da empresa. Só razão social e CNPJ são obrigatórios. Você faz isso uma vez e depois eles entram sozinhos em toda proposta. Fica no menu Empresa. Se travar em algum campo, me responde aqui.');
    expect(textoRecepcao(1, 'Maria', { proximo: null, temProposta: true, fotosFeito: true })).toBeNull();
    expect(textoRecepcao(2, null, { proximo: null, temProposta: true, fotosFeito: true })).toBeNull();
  });
  it('R3 sem proposta leva o fecho; R3 com proposta leva a linha das fotos só quando faltam fotos', () => {
    const sem = textoRecepcao(3, 'Ana', { proximo: 'proposta', temProposta: false, fotosFeito: false })!;
    expect(sem).toContain('Faz uma semana que você entrou');
    expect(sem).not.toContain('Ah, e faltam as fotos');
    expect(sem.endsWith('Se precisar de algo, me responde aqui.')).toBe(true);
    const comFaltaFoto = textoRecepcao(3, 'Ana', { proximo: 'fotos', temProposta: true, fotosFeito: false })!;
    expect(comFaltaFoto).toContain('Ah, e faltam as fotos das obras');
    expect(comFaltaFoto.endsWith('Se precisar de algo, me responde aqui.')).toBe(true);
    const comTudo = textoRecepcao(3, 'Ana', { proximo: null, temProposta: true, fotosFeito: true })!;
    expect(comTudo).toContain('Como está sendo usar a SolarDoc?');
    expect(comTudo).not.toContain('Ah, e faltam as fotos');
  });
});

describe('textos do e-mail', () => {
  const p = (e: Parameters<typeof passos>[1] = {}) => { passos('x', e); return H.passos.x.resultado; };
  const textoDe = (c: NonNullable<ReturnType<typeof conteudoEmailRecepcao>>): string =>
    [c.assunto, c.preheader, c.saudacao, c.botao.texto, ...c.blocos.flatMap((b) => (b.tipo === 'p' ? [b.texto] : b.tipo === 'passos' ? [b.titulo, ...b.itens] : b.itens.flatMap((i) => [i.rotulo, i.titulo, i.descricao])))].join('\n');
  it('E1 lista os 4 passos com Feito e Pendente e o botão segue o próximo passo', () => {
    const c = conteudoEmailRecepcao(1, 'Maria', p({ empresa: true, logo: false }))!;
    expect(c.assunto).toBe('Faltam 3 passos para sua primeira proposta');
    expect(c.saudacao).toBe('Oi, Maria.');
    const lista = c.blocos.find((b) => b.tipo === 'lista') as { itens: Array<{ rotulo: string; titulo: string }> };
    expect(lista.itens.map((i) => `${i.titulo}:${i.rotulo}`)).toEqual([
      'Dados da empresa:Feito', 'Logo da empresa:Pendente', 'Fotos dos seus trabalhos:Pendente', 'Primeira proposta:Pendente',
    ]);
    expect(c.botao).toEqual({ texto: 'Subir minha logo', url: 'https://solardoc.app/empresa#empresa-logo' });
    expect(conteudoEmailRecepcao(1, null, p({ empresa: true, logo: true, fotos: 6 }))!.assunto).toBe('Falta 1 passo para sua primeira proposta');
    const um = conteudoEmailRecepcao(1, null, p({ empresa: true, logo: true, fotos: 6 }))!;
    expect(um.blocos[0]).toEqual({ tipo: 'p', texto: 'Sua conta na SolarDoc está criada. Falta 1 passo para começar.' });
    expect(c.blocos[0]).toEqual({ tipo: 'p', texto: 'Sua conta na SolarDoc está criada. Faltam 3 passos para começar.' });
    expect(conteudoEmailRecepcao(1, null, p({}))!.saudacao).toBe('Oi,');
  });
  it('E2 escolhe o texto pelo próximo passo; E1 e E2 sem próximo passo não existem', () => {
    expect(conteudoEmailRecepcao(2, 'Ana', p({}))!.assunto).toBe('Cadastre sua empresa em 3 passos');
    expect(conteudoEmailRecepcao(2, 'Ana', p({ empresa: true }))!.assunto).toBe('Coloque sua logo em 3 passos');
    expect(conteudoEmailRecepcao(2, 'Ana', p({ empresa: true, logo: true }))!.assunto).toBe('Escolha as fotos dos seus trabalhos em 3 passos');
    const prop = conteudoEmailRecepcao(2, 'Ana', p({ empresa: true, logo: true, fotos: 6 }))!;
    expect(prop.assunto).toBe('Faça sua primeira proposta em 3 passos');
    expect(prop.botao.url).toBe('https://solardoc.app/documentos?tipo=proposta');
    const pronto = p({ empresa: true, logo: true, fotos: 6, proposta: true });
    expect(conteudoEmailRecepcao(1, 'Ana', pronto)).toBeNull();
    expect(conteudoEmailRecepcao(2, 'Ana', pronto)).toBeNull();
  });
  it('E3 leva o parágrafo extra só sem proposta e o botão do suporte', () => {
    const extra = 'Se ainda não fez a primeira, ela está a um clique: Nova proposta, no topo do menu.';
    const sem = conteudoEmailRecepcao(3, 'Ana', p({ empresa: true }))!;
    const com = conteudoEmailRecepcao(3, 'Ana', p({ empresa: true, logo: true, fotos: 6, proposta: true }))!;
    expect(textoDe(sem)).toContain(extra);
    expect(textoDe(com)).not.toContain(extra);
    expect(sem.botao.texto).toBe('Falar com o suporte no WhatsApp');
    expect(sem.botao.url.startsWith('https://wa.me/5534998165040?text=')).toBe(true);
  });
  it('nenhum e-mail tem travessão nem emoji, e todo botão é URL absoluta https', () => {
    for (const toque of TOQUES) for (const e of [{}, { empresa: true }, { empresa: true, logo: true }, { empresa: true, logo: true, fotos: 6 }]) {
      const c = conteudoEmailRecepcao(toque, 'Ana', p(e));
      if (!c) continue;
      expect(textoDe(c)).not.toMatch(/[—–]/);
      expect(textoDe(c)).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(c.botao.url).toMatch(/^https:\/\//);
    }
  });
  it('free SEM empresa é pulado (a cadência de CNPJ já cobre); free com empresa e pagante entram', () => {
    expect(emailDaRecepcaoPodeIr({ plano: 'free', temLinhaEmpresa: false })).toBe(false);
    expect(emailDaRecepcaoPodeIr({ plano: 'free', temLinhaEmpresa: true })).toBe(true);
    expect(emailDaRecepcaoPodeIr({ plano: 'pro', temLinhaEmpresa: false })).toBe(true);
  });
});

describe('a conversa da linha SolarDoc', () => {
  const m = (autor: 'lead' | 'robo' | 'equipe', horasAtras: number) => ({ autor, momment: iso(horasAtras) });
  const agoraMs = AGORA.getTime();
  it('sem conversa: segue', () => { expect(decidirPelaConversa([], agoraMs)).toBe('ok'); });
  it('toque nosso nas últimas 48 h (de robô ou da equipe): espera esta rodada', () => {
    expect(decidirPelaConversa([m('robo', 47)], agoraMs)).toBe('esperar');
    expect(decidirPelaConversa([m('equipe', 2)], agoraMs)).toBe('esperar');
    expect(decidirPelaConversa([m('robo', 49)], agoraMs)).toBe('ok');
  });
  it('fala da pessoa nas últimas 24 h: espera; mais antiga, segue', () => {
    expect(decidirPelaConversa([m('lead', 23)], agoraMs)).toBe('esperar');
    expect(decidirPelaConversa([m('lead', 30)], agoraMs)).toBe('ok');
  });
  it('3 toques nossos e nenhuma resposta: mudo; com uma resposta depois deles, não', () => {
    expect(decidirPelaConversa([m('robo', 100), m('robo', 90), m('robo', 80)], agoraMs)).toBe('mudo');
    expect(decidirPelaConversa([m('robo', 100), m('robo', 90), m('robo', 80), m('lead', 70)], agoraMs)).toBe('ok');
  });
  // Minutos antes de agora; bolhas seguidas, até 1 h da primeira, são 1 toque.
  const bolha = (minAtras: number) => ({ autor: 'robo' as const, momment: new Date(agoraMs - minAtras * 60_000).toISOString() });
  it('as 3 bolhas da boas-vindas no minuto 0 são 1 toque: com 50 h e sem resposta, segue (o R1 sai)', () => {
    const boasVindas = [bolha(50 * 60), bolha(50 * 60 - 1), bolha(50 * 60 - 2)];
    expect(ancorasDosToquesNossos(boasVindas)).toHaveLength(1);
    expect(decidirPelaConversa(boasVindas, agoraMs)).toBe('ok');
  });
  it('boas-vindas + R1 + R2 sem resposta são 3 toques: mudo (o R3 vira pulado)', () => {
    const conv = [bolha(170 * 60), bolha(170 * 60 - 1), bolha(170 * 60 - 2), bolha(150 * 60), bolha(100 * 60)];
    expect(ancorasDosToquesNossos(conv)).toHaveLength(3);
    expect(decidirPelaConversa(conv, agoraMs)).toBe('mudo');
  });
  it('a âncora é a primeira mensagem do toque: bolhas a cada 40 min por 3 h viram mais de 1 toque', () => {
    const encadeada = [0, 40, 80, 120, 160].map(min => bolha(100 * 60 - min));
    expect(ancorasDosToquesNossos(encadeada)).toHaveLength(3);          // [0,40] [80,120] [160]
    expect(decidirPelaConversa(encadeada, agoraMs)).toBe('mudo');
  });
  it('a pessoa respondeu depois do 1º toque: não corta', () => {
    const conv = [bolha(170 * 60), bolha(170 * 60 - 1), { autor: 'lead' as const, momment: new Date(agoraMs - 160 * 3_600_000).toISOString() }, bolha(150 * 60), bolha(100 * 60)];
    expect(decidirPelaConversa(conv, agoraMs)).toBe('ok');
  });
});

describe('a linha conta o carimbo da recepção', () => {
  it('BOT_SENT_PREFIXES tem recep_sent: como frio, fora de PREFIXOS_AGENDA; pulado e e-mail ficam de fora', () => {
    const linha = prefixosDaLinha();
    expect(linha).toContain('recep_sent:');
    expect((PREFIXOS_AGENDA as readonly string[]).includes('recep_sent:')).toBe(false);
    for (const fora of ['recep_pulo:', 'recep_email:', 'recep_email_pulo:', 'recep_sonda_ok']) expect(linha).not.toContain(fora);
    expect(linha.some((p) => p.startsWith('recep_pulo') || p.startsWith('recep_email'))).toBe(false);
  });
  it('as chaves são exatas', () => {
    expect(chaveRecepSent('u1', 2)).toBe('recep_sent:u1:r2');
    expect(chaveRecepPulo('u1', 3)).toBe('recep_pulo:u1:r3');
    expect(chaveRecepEmail('u1', 1)).toBe('recep_email:u1:e1');
    expect(chaveRecepEmailPulo('u1', 2)).toBe('recep_email_pulo:u1:e2');
    expect(chavesRecepSentDe('u1')).toEqual(['recep_sent:u1:r1', 'recep_sent:u1:r2', 'recep_sent:u1:r3']);
  });
  it('a instância da linha SolarDoc é a da B2B (a IO só com o desvio ligado)', () => {
    expect(instanciaDaLinhaSolardoc()).toBe('inst-solardoc');
  });
});

// ── o robô de WhatsApp ───────────────────────────────────────────────────────

describe('enviarRecepcaoWhatsApp', () => {
  it('RECEPCAO_OFF=1: nada acontece', async () => {
    process.env.RECEPCAO_OFF = '1';
    usuario('u1', 25); passos('u1');
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r).toMatchObject({ enviados: 0, motivo: 'desligado' });
    expect(H.envios).toHaveLength(0);
    expect(db.system_state ?? []).toHaveLength(0);
  });

  it('1ª rodada: a sonda roda, passa, grava recep_sonda_ok, não deixa a chave de teste e só então envia o R1 (1 bolha, instância solardoc)', async () => {
    usuario('u1', 25); passos('u1');
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r).toMatchObject({ enviados: 1, erros: 0 });
    expect(chaves('recep_sonda_ok')).toEqual(['recep_sonda_ok']);
    expect(chaves('recep_sent:sonda:')).toEqual([]);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r1']);
    expect(H.envios).toHaveLength(1);
    expect(H.envios[0]).toMatchObject({ instancia: 'solardoc' });
    expect(H.envios[0]!.partes).toHaveLength(1);
    expect(H.envios[0]!.partes[0]).toBe('Oi, Joao, aqui é a Giovanna, do suporte da SolarDoc. Vi que você criou sua conta na SolarDoc. O próximo passo é cadastrar os dados da empresa. Só razão social e CNPJ são obrigatórios. Você faz isso uma vez e depois eles entram sozinhos em toda proposta. Fica no menu Empresa. Se travar em algum campo, me responde aqui.');
    expect(H.sessao).toHaveLength(1);
  });

  it('sonda reprovada: não envia, não grava pulado nenhum e fica parada até apagarem a marca', async () => {
    H.sondaQuebrada = true;
    usuario('u1', 25); passos('u1');
    usuario('u2', 30); passos('u2', { empresa: true, logo: true, fotos: 6, proposta: true });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r).toMatchObject({ enviados: 0, motivo: 'sonda_falhou' });
    expect(H.envios).toHaveLength(0);
    expect(chaves('recep_pulo:')).toEqual([]);
    expect(chaves(CHAVE_RECEP_SONDA_FALHOU)).toEqual([CHAVE_RECEP_SONDA_FALHOU]);
    expect(chaves('recep_sent:')).toEqual([]);                    // nem a chave de teste ficou
    const r2 = await enviarRecepcaoWhatsApp(AGORA);
    expect(r2).toMatchObject({ enviados: 0, motivo: 'sonda_falhou' });
  });

  it('só vale o toque mais alto: com 70 h sai o R2 e o R1 vira pulado', async () => {
    marcaSondaOk();
    usuario('u1', 70); passos('u1', { empresa: true });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r2']);
    expect(chaves('recep_pulo:')).toEqual(['recep_pulo:u1:r1']);
    expect(H.envios[0]!.partes[0]).toContain('Posso te ajudar com a logo?');
  });

  it('com 170 h sai o R3 (sem proposta) e R1 e R2 viram pulados; não sai de novo na rodada seguinte', async () => {
    marcaSondaOk();
    usuario('u1', 170); passos('u1', { empresa: true });
    await enviarRecepcaoWhatsApp(AGORA);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r3']);
    expect(chaves('recep_pulo:')).toEqual(['recep_pulo:u1:r1', 'recep_pulo:u1:r2']);
    expect(H.envios[0]!.partes[0]).toContain('Faz uma semana que você entrou');
    const r2 = await enviarRecepcaoWhatsApp(new Date(AGORA.getTime() + 2 * HORA));
    expect(r2.enviados).toBe(0);
    expect(H.envios).toHaveLength(1);
  });

  it('tudo pronto: o R1 vira pulado sem enviar nada; o R3 sai para todos', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1', { empresa: true, logo: true, fotos: 6, proposta: true });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
    expect(chaves('recep_pulo:')).toEqual(['recep_pulo:u1:r1']);
    expect(chaves('recep_sent:')).toEqual([]);
    H.envios.length = 0;
    const depois = new Date(AGORA.getTime() + 150 * HORA);       // 175 h de conta
    const r3 = await enviarRecepcaoWhatsApp(depois);
    expect(r3.enviados).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r3']);
    expect(H.envios[0]!.partes[0]).toContain('Como está sendo usar a SolarDoc?');
  });

  it('1 envio por rodada: o mais antigo primeiro, o outro espera', async () => {
    marcaSondaOk();
    usuario('u2', 40); passos('u2');
    usuario('u1', 60); passos('u1');
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r1']);
  });

  it('conversa: toque nosso em 48 h ou fala da pessoa em 24 h pulam só esta rodada, sem gravar nada', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    H.conversa = () => ({ msgs: [{ autor: 'robo', momment: iso(10) }], completa: true });
    expect(await enviarRecepcaoWhatsApp(AGORA)).toMatchObject({ enviados: 0, motivo: 'conversa_recente' });
    H.conversa = () => ({ msgs: [{ autor: 'lead', momment: iso(3) }], completa: true });
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(0);
    expect(chaves('recep_pulo:')).toEqual([]);
    expect(chaves('recep_sent:')).toEqual([]);
    H.conversa = () => ({ msgs: [], completa: true });
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
  });

  it('boas-vindas de 3 bolhas no minuto 0 e conta de 50 h sem resposta: o R1 sai; com R1 e R2 já ditos, o R3 vira pulado', async () => {
    marcaSondaOk();
    usuario('u1', 50); passos('u1');
    const bolhas = (h: number) => [0, 1, 2].map(min => ({ autor: 'robo', momment: new Date(AGORA.getTime() - h * HORA + min * 60_000).toISOString() }));
    H.conversa = () => ({ msgs: bolhas(50), completa: true });
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r1']);
    for (const k of Object.keys(db)) delete db[k];
    marcaSondaOk(); usuario('u2', 170); passos('u2');
    H.conversa = () => ({ msgs: [...bolhas(170), { autor: 'robo', momment: iso(150) }, { autor: 'robo', momment: iso(100) }], completa: true });
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(0);
    expect(chaves('recep_pulo:')).toEqual(['recep_pulo:u2:r1', 'recep_pulo:u2:r2', 'recep_pulo:u2:r3']);
  });

  it('R1 enviado há 10 h e R2 vencido por idade, com a conversa vazia: não sai (a trava do carimbo não depende da conversa)', async () => {
    marcaSondaOk();
    usuario('u1', 70); passos('u1', { empresa: true });
    (db.system_state ??= []).push({ key: 'recep_sent:u1:r1', value: {}, updated_at: iso(10) });
    H.conversa = () => ({ msgs: [], completa: true });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r).toMatchObject({ enviados: 0, motivo: 'carimbo_recente' });
    expect(H.envios).toHaveLength(0);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r1']);
    // Passadas 48 h do carimbo, o R2 sai.
    const r2 = await enviarRecepcaoWhatsApp(new Date(AGORA.getTime() + 46 * HORA));   // sexta, 10h em Brasília
    expect(r2.enviados).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u1:r1', 'recep_sent:u1:r2']);
  });

  it('comprador avulso (entitlement de compra ou cortesia, pedido pago do kit por conta ou por e-mail) não recebe nada; falha de leitura = ninguém recebe', async () => {
    marcaSondaOk();
    usuario('v1', 25); passos('v1'); (db.entitlements ??= []).push({ user_id: 'v1', origem: 'compra' });
    usuario('v2', 26); passos('v2'); db.entitlements.push({ user_id: 'v2', origem: 'cortesia' });
    usuario('v3', 27); passos('v3'); (db.kit_pedidos ??= []).push({ user_id: 'v3', email: null, status: 'paid' });
    usuario('v4', 28); passos('v4'); db.kit_pedidos.push({ user_id: null, email: 'v4@exemplo.com', status: 'paid' });
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(0);
    expect((await enviarRecepcaoEmail(AGORA)).enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
    expect(H.emails).toHaveLength(0);
    // Quem tem entitlement que não é compra (assinatura/admin) ou pedido não pago NÃO é avulso: entra.
    usuario('v5', 29); passos('v5'); db.entitlements.push({ user_id: 'v5', origem: 'assinatura' });
    usuario('v6', 30); passos('v6', { empresa: true }); db.kit_pedidos.push({ user_id: 'v6', email: null, status: 'pending' });
    expect((await enviarRecepcaoEmail(AGORA)).enviados).toBe(1);   // só o v6 tem empresa (free sem empresa fica fora do e-mail)
    expect(H.emails.map((e) => e.userId)).toEqual(['v6']);
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:v6:r1']);   // o mais antigo dos que entram é o v6 (30 h)
  });

  it('falha ao ler os compradores avulsos: não manda (falha fechada), WhatsApp e e-mail', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1', { empresa: true });
    for (const tabela of ['entitlements', 'kit_pedidos']) {
      H.erroTabela = tabela;
      expect(await enviarRecepcaoWhatsApp(AGORA)).toMatchObject({ enviados: 0, motivo: 'leitura_falhou' });
      expect(await enviarRecepcaoEmail(AGORA)).toMatchObject({ enviados: 0, motivo: 'leitura_falhou' });
    }
    expect(H.envios).toHaveLength(0);
    expect(H.emails).toHaveLength(0);
    expect(chaves('recep_pulo:')).toEqual([]);
  });

  it('erro ANTES do sendFrio (os passos lançam) solta o claim; o erro do próprio sendFrio mantém', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    const { carregarPassos } = await import('../services/solardoc/primeirosPassos');
    vi.mocked(carregarPassos).mockImplementationOnce(async () => { throw new Error('banco fora'); });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.erros).toBe(1);
    expect(chaves('recep_sent:')).toEqual([]);
    expect(H.envios).toHaveLength(0);
    // Na rodada seguinte o toque sai normalmente.
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
  });

  it('a 2b enviou o convite da 1ª proposta há 10 h: a recepção espera 48 h (trava do carimbo, sem depender da conversa)', async () => {
    marcaSondaOk();
    usuario('u1', 70); passos('u1', { empresa: true });
    (db.system_state ??= []).push({ key: 'ativ_proposta_sent:u1', value: {}, updated_at: iso(10) });
    H.conversa = () => ({ msgs: [], completa: true });
    expect(await enviarRecepcaoWhatsApp(AGORA)).toMatchObject({ enviados: 0, motivo: 'carimbo_recente' });
    expect(H.envios).toHaveLength(0);
    // Chave de OUTRA conta não segura esta.
    db.system_state.length = 1; db.system_state[0] = { key: 'ativ_proposta_sent:outra', value: {}, updated_at: iso(10) };
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
  });

  it('conversa não lida por inteiro: na dúvida, não fala', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    H.conversa = () => ({ msgs: [], completa: false });
    expect(await enviarRecepcaoWhatsApp(AGORA)).toMatchObject({ enviados: 0, motivo: 'conversa_nao_lida' });
    expect(db.system_state?.some((r) => String(r.key).startsWith('recep_sent:'))).toBe(false);
  });

  it('3 toques nossos sem resposta: os toques restantes viram pulados e nunca mais sai', async () => {
    marcaSondaOk();
    usuario('u1', 170); passos('u1');
    H.conversa = () => ({ msgs: [{ autor: 'robo', momment: iso(100) }, { autor: 'robo', momment: iso(90) }, { autor: 'robo', momment: iso(80) }], completa: true });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(0);
    expect(chaves('recep_pulo:')).toEqual(['recep_pulo:u1:r1', 'recep_pulo:u1:r2', 'recep_pulo:u1:r3']);
    H.conversa = () => ({ msgs: [], completa: true });
    expect((await enviarRecepcaoWhatsApp(new Date(AGORA.getTime() + 3 * HORA))).enviados).toBe(0);
  });

  it('o sendFrio calou (devolveu false): solta o claim e segue; o toque volta na rodada seguinte', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    H.sendFrio.retorno = false;
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(0);
    expect(chaves('recep_sent:')).toEqual([]);
    H.sendFrio.retorno = true;
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
  });

  it('o sendFrio lançou: o claim FICA (talvez saiu) e a rodada para', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    usuario('u2', 26); passos('u2');
    H.sendFrio.lanca = true;
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.erros).toBe(1);
    expect(chaves('recep_sent:')).toEqual(['recep_sent:u2:r1']);   // o mais antigo é o u2 (26 h)
    expect(H.sessao).toHaveLength(0);
  });

  it('quem fez o passo no meio da rodada recebe o texto certo (ou nada): a releitura manda', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    const { carregarPassos } = await import('../services/solardoc/primeirosPassos');
    vi.mocked(carregarPassos).mockImplementationOnce(async () => calcularPassos({ empresaNome: 'X', empresaCnpj: '1', logo: 'l', qtdFotos: 6, temProposta: true, plano: 'free' }));
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(0);
    expect(chaves('recep_sent:')).toEqual([]);
  });

  it('fica de fora: admin, teste, opt-out, sem WhatsApp válido, sem senha, conta com menos de 20 h, conta de mais de 15 dias e parceiro da NEXUS', async () => {
    marcaSondaOk();
    usuario('a1', 30, { is_admin: true }); passos('a1');
    usuario('a2', 30, { email: 'fulano.teste@exemplo.com' }); passos('a2');
    usuario('a3', 30, { whatsapp_opt_out: true }); passos('a3');
    usuario('a4', 30, { whatsapp: '123' }); passos('a4');
    usuario('a5', 30, { password_hash: null }); passos('a5');
    usuario('a6', 19); passos('a6');
    usuario('a7', 16 * 24); passos('a7');
    usuario('a8', 30); passos('a8');
    (db.nexus_parceiros ??= []).push({ user_id: 'a8' });
    const r = await enviarRecepcaoWhatsApp(AGORA);
    expect(r.enviados).toBe(0);
    expect(H.envios).toHaveLength(0);
    expect(chaves('recep_')).toEqual(['recep_sonda_ok']);
  });

  it('opt-out nulo NÃO derruba a conta (o filtro de opt-out é feito em código)', async () => {
    marcaSondaOk();
    usuario('u1', 25, { whatsapp_opt_out: null }); passos('u1');
    expect((await enviarRecepcaoWhatsApp(AGORA)).enviados).toBe(1);
  });

  it('rodarRecepcaoWhatsApp nunca lança', async () => {
    marcaSondaOk();
    usuario('u1', 25); passos('u1');
    const { carregarPassosEmLote } = await import('../services/solardoc/primeirosPassos');
    vi.mocked(carregarPassosEmLote).mockImplementationOnce(async () => { throw new Error('banco fora'); });
    await expect(rodarRecepcaoWhatsApp(AGORA)).resolves.toMatchObject({ erros: 1, motivo: 'leitura_falhou' });
  });
});

// ── o e-mail ─────────────────────────────────────────────────────────────────

describe('enviarRecepcaoEmail', () => {
  it('manda o toque mais alto e pula os menores; chaves próprias, fora da linha', async () => {
    usuario('u1', 70); passos('u1', { empresa: true });
    const r = await enviarRecepcaoEmail(AGORA);
    expect(r.enviados).toBe(1);
    expect(H.emails[0]).toMatchObject({ to: 'u1@exemplo.com', userId: 'u1', toque: 2 });
    expect(chaves('recep_email:')).toEqual(['recep_email:u1:e2']);
    expect(chaves('recep_email_pulo:')).toEqual(['recep_email_pulo:u1:e1']);
    expect(chaves('recep_sent:')).toEqual([]);
    expect((await enviarRecepcaoEmail(AGORA)).enviados).toBe(0);
  });

  it('não exige WhatsApp, respeita email_opt_out e fica fora de admin e de parceiro da NEXUS', async () => {
    usuario('u1', 25, { whatsapp: null }); passos('u1', { empresa: true });
    usuario('u2', 25, { email_opt_out: true }); passos('u2', { empresa: true });
    usuario('u3', 25, { is_admin: true }); passos('u3', { empresa: true });
    usuario('u4', 25); passos('u4', { empresa: true });
    (db.nexus_parceiros ??= []).push({ user_id: 'u4' });
    usuario('u5', 25, { whatsapp_opt_out: true }); passos('u5', { empresa: true });   // opt-out do WhatsApp não vale para o e-mail
    await enviarRecepcaoEmail(AGORA);
    expect(H.emails.map((e) => e.userId).sort()).toEqual(['u1', 'u5']);
  });

  it('free sem empresa é pulado; tudo pronto vira pulado; o E3 sai para todos', async () => {
    usuario('u1', 25); passos('u1', { linhaEmpresa: false });
    usuario('u2', 25); passos('u2', { empresa: true, logo: true, fotos: 6, proposta: true });
    usuario('u3', 170, { plano: 'pro' }); passos('u3', { plano: 'pro', linhaEmpresa: false, empresa: true, logo: true, fotos: 6, proposta: true });
    const r = await enviarRecepcaoEmail(AGORA);
    expect(H.emails.map((e) => `${e.userId}:${e.toque}`)).toEqual(['u3:3']);
    expect(chaves('recep_email:')).toEqual(['recep_email:u3:e3']);
    expect(chaves('recep_email_pulo:')).toEqual(['recep_email_pulo:u2:e1', 'recep_email_pulo:u3:e1', 'recep_email_pulo:u3:e2']);
    expect(r.enviados).toBe(1);
  });

  it('1 e-mail nosso por dia: quem levou e-mail de outra cadência (qualquer das 4 colunas) nas últimas 23 h fica para depois', async () => {
    const colunas = ['followup_email_last_sent_at', 'upgrade_nudge_last_sent_at', 'contract_reminder_last_sent_at', 'confianca_last_sent_at'];
    colunas.forEach((col, i) => {
      usuario(`c${i}`, 25 + i); passos(`c${i}`, { empresa: true });
      db.users![db.users!.length - 1]![col] = new Date(Date.now() - 3_600_000).toISOString();
    });
    usuario('c9', 40); passos('c9', { empresa: true });
    db.users![db.users!.length - 1]!.followup_email_last_sent_at = new Date(Date.now() - 30 * 3_600_000).toISOString();   // há 30 h: já passou
    await enviarRecepcaoEmail(AGORA);
    expect(H.emails.map((e) => e.userId)).toEqual(['c9']);
  });

  it('no máximo 10 por rodada', async () => {
    for (let i = 1; i <= 14; i++) { usuario(`m${i}`, 25 + i); passos(`m${i}`, { empresa: true }); }
    const r = await enviarRecepcaoEmail(AGORA);
    expect(r.enviados).toBe(10);
    expect(H.emails).toHaveLength(10);
  });

  it('o envio falhou: solta o claim e para a rodada (volta na seguinte)', async () => {
    usuario('u1', 25); passos('u1', { empresa: true });
    usuario('u2', 26); passos('u2', { empresa: true });
    H.emailFalha = true;
    const r = await enviarRecepcaoEmail(AGORA);
    expect(r).toMatchObject({ enviados: 0, erros: 1 });
    expect(chaves('recep_email:')).toEqual([]);
    H.emailFalha = false;
    expect((await enviarRecepcaoEmail(AGORA)).enviados).toBe(2);
  });

  it('RECEPCAO_OFF=1 desliga o e-mail também', async () => {
    process.env.RECEPCAO_OFF = '1';
    usuario('u1', 25); passos('u1', { empresa: true });
    expect(await enviarRecepcaoEmail(AGORA)).toMatchObject({ motivo: 'desligado' });
    expect(H.emails).toHaveLength(0);
  });
});

// ── convivência com a 2b do pós-venda ────────────────────────────────────────

describe('a 2b do pós-venda pula quem já levou a recepção', () => {
  function pagante(id: string): void {
    (db.sales ??= []).push({ email: `${id}@exemplo.com`, card_passed_at: new Date(AGORA.getTime() - 3 * 24 * HORA).toISOString() });
    usuario(id, 24 * 3, { plano: 'pro' });
  }
  it('sem recep_sent a 2b envia', async () => {
    pagante('p1');
    expect((await enviarPrimeiraProposta(AGORA)).enviados).toBe(1);
  });
  it('com recep_sent:<id>:r1, r2 ou r3 a 2b pula (chave exata)', async () => {
    for (const n of [1, 2, 3]) {
      for (const k of Object.keys(db)) delete db[k];
      H.envios.length = 0;
      pagante('p1');
      (db.system_state ??= []).push({ key: `recep_sent:p1:r${n}`, value: {}, updated_at: iso(1) });
      const r = await enviarPrimeiraProposta(AGORA);
      expect(r.enviados, `r${n}`).toBe(0);
      expect(H.envios).toHaveLength(0);
    }
  });
  it('recep_pulo (pulado, nada saiu) NÃO bloqueia a 2b', async () => {
    pagante('p1');
    (db.system_state ??= []).push({ key: 'recep_pulo:p1:r1', value: {}, updated_at: iso(1) });
    expect((await enviarPrimeiraProposta(AGORA)).enviados).toBe(1);
  });
});

// ── a sonda automática ───────────────────────────────────────────────────────

describe('rodarSondaRecepcao', () => {
  const agora = AGORA;
  function deps(over: Partial<DepsSondaRecep> = {}): { d: DepsSondaRecep; chaves: Map<string, number>; avisos: string[] } {
    const chaves = new Map<string, number>();
    const avisos: string[] = [];
    const frias = () => [...chaves.keys()].filter((k) => k.startsWith('recep_sent:')).length;
    const d: DepsSondaRecep = {
      vagas: async () => ({ hora: { teto: 6, usadas: frias() }, dia: { teto: 30, usadas: frias() } }),
      inserir: async (k) => { if (chaves.has(k)) return 'ja'; chaves.set(k, agora.getTime()); return 'ok'; },
      apagar: async (k) => { chaves.delete(k); return true; },
      espacamento: async () => frias() === 0,
      atualizadoEm: async (k) => (chaves.has(k) ? new Date(chaves.get(k)!).toISOString() : null),
      apagarSeIgual: async (k, u) => { if (!chaves.has(k) || chaves.get(k) !== Date.parse(u)) return false; chaves.delete(k); return true; },
      avisar: async (a) => { avisos.push(a); },
      ...over,
    };
    return { d, chaves, avisos };
  }

  it('passa: grava recep_sonda_ok e não deixa claim nem carimbo de teste', async () => {
    const { d, chaves } = deps();
    expect(await rodarSondaRecepcao(agora, d)).toBe('ok');
    expect([...chaves.keys()]).toEqual([CHAVE_RECEP_SONDA_OK]);
  });

  it('o espaçamento não leu ANTES de gravar nada: é erro passageiro (adiada), sem marca de falha e sem claim', async () => {
    const { d, chaves, avisos } = deps({ espacamento: async () => { throw new Error('banco fora'); } });
    expect(await rodarSondaRecepcao(agora, d)).toBe('adiada');
    expect([...chaves.keys()]).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it('a leitura das vagas falhou ANTES de gravar nada: adiada, sem recep_sonda_falhou', async () => {
    const { d, chaves, avisos } = deps({ vagas: async () => null });
    expect(await rodarSondaRecepcao(agora, d)).toBe('adiada');
    expect(chaves.has(CHAVE_RECEP_SONDA_FALHOU)).toBe(false);
    expect([...chaves.keys()]).toEqual([]);
    expect(avisos).toEqual([]);
  });

  it('reprovação depois de gravar o carimbo continua sendo falha de verdade (marca e aviso)', async () => {
    const { d, chaves, avisos } = deps({ vagas: async () => ({ hora: { teto: 6, usadas: 0 }, dia: { teto: 30, usadas: 0 } }) });
    expect(await rodarSondaRecepcao(agora, d)).toBe('falhou');
    expect(chaves.has(CHAVE_RECEP_SONDA_FALHOU)).toBe(true);
    expect(avisos).toHaveLength(1);
  });

  it('claim recente segura (ocupada); claim com mais de 10 min é ignorado e a sonda roda', async () => {
    const recente = deps();
    recente.chaves.set('recep_sonda_claim', agora.getTime() - 60_000);
    expect(await rodarSondaRecepcao(agora, recente.d)).toBe('ocupada');
    expect(recente.chaves.has(CHAVE_RECEP_SONDA_OK)).toBe(false);

    const velho = deps();
    velho.chaves.set('recep_sonda_claim', agora.getTime() - 11 * 60_000);
    expect(await rodarSondaRecepcao(agora, velho.d)).toBe('ok');
    expect(velho.chaves.has(CHAVE_RECEP_SONDA_OK)).toBe(true);
    expect(velho.chaves.has('recep_sonda_claim')).toBe(false);
  });

  it('claim velho: apaga só a linha lida (key E updated_at); se outro tick já trocou o claim, este não o apaga e a sonda não roda', async () => {
    const lidos: Array<[string, string]> = [];
    const velho = deps();
    velho.chaves.set('recep_sonda_claim', agora.getTime() - 11 * 60_000);
    const apagarSeIgual = velho.d.apagarSeIgual;
    velho.d.apagarSeIgual = async (k, u) => { lidos.push([k, u]); return apagarSeIgual(k, u); };
    expect(await rodarSondaRecepcao(agora, velho.d)).toBe('ok');
    expect(lidos).toEqual([['recep_sonda_claim', new Date(agora.getTime() - 11 * 60_000).toISOString()]]);

    // Corrida: entre a leitura e o apagar, o outro tick trocou o claim por um novo. A condição por updated_at não casa: nada é apagado.
    const corrida = deps();
    corrida.chaves.set('recep_sonda_claim', agora.getTime() - 11 * 60_000);
    corrida.d.atualizadoEm = async () => new Date(agora.getTime() - 11 * 60_000).toISOString();
    corrida.chaves.set('recep_sonda_claim', agora.getTime() - 1_000);        // o claim novo do outro tick
    expect(await rodarSondaRecepcao(agora, corrida.d)).toBe('ocupada');
    expect(corrida.chaves.get('recep_sonda_claim')).toBe(agora.getTime() - 1_000);
    expect(corrida.chaves.has(CHAVE_RECEP_SONDA_OK)).toBe(false);
  });
});
