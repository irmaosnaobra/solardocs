import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { BancoFalso } from './bancoFalsoQuiz';

// O CÓDIGO DO BOTÃO DO QUIZ SOLAR E A RELIGAÇÃO DO CARD (03/11/2026, card 1714). Rotas (/quiz/agendar e /quiz/agora devolvem codigo_whats e gravam
// quizsolar_codigo:<código> SEM telefone) e religarQuizPelaEntrada (travas, marcador só com HMACs, troca do número). Banco e WhatsApp em memória.

const h = vi.hoisted(() => ({
  main: null as any,
  ger: null as any,
  enviados: [] as Array<{ numero: string; texto: string }>,
  capi: vi.fn(),
  conversa: { msgs: [], completa: true } as { msgs: any[]; completa: boolean },
  conversasLidas: [] as string[],
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: (t: string) => h.ger.from(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (numero: string, texto: string) => { h.enviados.push({ numero, texto }); }),
  linhaEmCooldown: vi.fn(() => false),
  solardocViaIo: () => false,
}));
vi.mock('../utils/metaCapi', async (orig) => ({ ...(await orig<typeof import('../utils/metaCapi')>()), enviarEventoMeta: h.capi }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/agentes5040/contexto', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/contexto')>()),
  lerConversa: vi.fn(async (chave: string) => { h.conversasLidas.push(chave); return h.conversa; }),
}));

import router from '../routes/ioSolar';
import { religarQuizPelaEntrada, falasComCodigoRecentes } from '../services/agentes5040/religarQuiz';
import { codigoDoTexto, gerarCodigoQuiz, ALFABETO_CODIGO, PREFIXO_CODIGO, PREFIXO_RELIGADO } from '../services/agentes5040/quizCodigo';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import { prefixosDaLinha, PREFIXOS_AGENDA, PREFIXOS_RESPOSTA_AGENTES } from '../services/agents/whatsapp/lineThrottle';

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/io/solar', router);

const brt = (ymd: string, hhmm: string): number => Date.parse(`${ymd}T${hhmm}:00-03:00`);
const SEXTA_14H = brt('2026-10-23', '14:00');
const SEGREDO = 'segredo-de-teste-codigo';
const RESP_BOA = {
  conta: '600_1050', cidade: 'Uberlândia-MG', tipo: 'casa', imovel: 'proprio', urgencia: 'ja', concorrente: 'sim', pagamento: 'vista', decisor: 'eu', grupoa: 'nao',
  telhado: 'ceramica', sombra: 'sol', aumento: 'nao', dor: 'sobe', tempo: 'meses', travou: 'caro', desejo: 'viajar', criterio: 'parcela',
};
const TEL_QUIZ = '5511991112222';       // o número que o cliente digitou no quiz (DDD 11)
const TEL_QUEM_ESCREVEU = '5534991360223';   // o número do WhatsApp de onde ele escreveu (DDD 34)
const CODIGO_RE = /^[A-HJKMNP-Z2-9]{5}$/;
const corpo = (extra: Record<string, unknown> = {}) => ({ nome: 'Ana Souza', tel: TEL_QUIZ, respostas: RESP_BOA, event_id: 'agd_abc123xyz', ...extra });
const agendar = (extra: Record<string, unknown> = {}) => corpo({ ymd: '2026-10-24', h: '07:00', dono: 'Nilce', ...extra });
const codigos = () => h.main.tabela('system_state').filter((l: any) => String(l.key).startsWith(PREFIXO_CODIGO));

beforeEach(() => {
  h.main = new BancoFalso();
  h.ger = new BancoFalso();
  h.enviados.length = 0; h.conversasLidas.length = 0;
  h.conversa = { msgs: [], completa: true };
  h.capi.mockReset().mockResolvedValue({ ok: true, status: 200 });
  process.env.AGENTES5040_FICHA = '0';
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  process.env.CRON_SECRET = SEGREDO;
});
afterEach(() => { vi.useRealTimers(); });

describe('o código: formato e leitura da fala', () => {
  it('5 caracteres de um alfabeto sem 0/O e sem 1/I/L, sorteados', () => {
    expect(ALFABETO_CODIGO).not.toMatch(/[01OIL]/);
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) { const c = gerarCodigoQuiz(); expect(c).toMatch(CODIGO_RE); vistos.add(c); }
    expect(vistos.size).toBeGreaterThan(150);
  });
  it('lê "Código: XXXXX" do fim da fala, sem acento e em minúsculas também; recusa o que não é código', () => {
    expect(codigoDoTexto('Oi! Acabei de preencher a simulação de energia solar. Código: K7M2P')).toBe('K7M2P');
    expect(codigoDoTexto('oi codigo:k7m2p')).toBe('K7M2P');
    expect(codigoDoTexto('Código: K7M2PX')).toBeNull();      // 6 caracteres
    expect(codigoDoTexto('Código: K7M2')).toBeNull();
    expect(codigoDoTexto('Código: K0M2P')).toBeNull();       // o 0 não existe no alfabeto
    expect(codigoDoTexto('Oi! Acabei de preencher a simulação de energia solar.')).toBeNull();
    expect(codigoDoTexto(null)).toBeNull();
  });
  it('as chaves quizsolar_* não casam com nenhum prefixo que a linha conta (tetos e espaçamento)', () => {
    const contados = [...new Set([...prefixosDaLinha(), ...PREFIXOS_AGENDA, ...PREFIXOS_RESPOSTA_AGENTES])];
    expect(contados.length).toBeGreaterThan(10);
    for (const chave of [`${PREFIXO_CODIGO}K7M2P`, `${PREFIXO_RELIGADO}1714`]) {
      for (const p of contados) expect(chave.startsWith(p), `${chave} casa com ${p}`).toBe(false);
    }
  });
});

describe('POST /quiz/agora devolve o código do botão; o /quiz/agendar não (a tela "marcado" não tem botão)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(SEXTA_14H); });

  it('/agendar não gera código: sem codigo_whats na resposta e nenhuma linha quizsolar_codigo no banco, com o card criado', async () => {
    const r = await request(app).post('/io/solar/quiz/agendar').send(agendar());
    expect(r.status).toBe(200);
    expect(r.body.id).toBeGreaterThan(0);
    expect(r.body.codigo_whats).toBeUndefined();
    expect(codigos()).toHaveLength(0);
    const t = await request(app).post('/io/solar/quiz/agendar').set('x-cron-secret', SEGREDO).send(agendar({ teste: true, tel: '5534991113333', h: '07:30' }));
    expect(t.body.teste).toBe(true);
    expect(t.body.codigo_whats).toBeUndefined();
    expect(codigos()).toHaveLength(0);
  });

  it('/agora: codigo_whats no formato, gravado em system_state SEM telefone, sem o id do card nem o quiz_<DDD+8> como código', async () => {
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo());
    expect(r.status).toBe(200);
    expect(r.body.codigo_whats).toMatch(CODIGO_RE);
    const linhas = codigos();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].key).toBe(`${PREFIXO_CODIGO}${r.body.codigo_whats}`);
    expect(Object.keys(linhas[0].value).sort()).toEqual(['card_id', 'criado_em']);
    expect(linhas[0].value.card_id).toBe(r.body.id);
    expect(linhas[0].value.criado_em).toBe(new Date(SEXTA_14H).toISOString());
    expect(JSON.stringify(linhas[0])).not.toMatch(/1112222|91112222|5534|11991/);
    expect(r.body.codigo_whats).not.toBe(String(r.body.id));
    expect(r.body.codigo_whats.toLowerCase()).not.toContain('quiz');
  });

  it('modo teste do /agora grava o código também (a sonda lê)', async () => {
    const g = await request(app).post('/io/solar/quiz/agora').set('x-cron-secret', SEGREDO).send(corpo({ teste: true, tel: '5534991113333' }));
    expect(g.body.teste).toBe(true);
    expect(g.body.codigo_whats).toMatch(CODIGO_RE);
    expect(h.ger.tabela('agendamentos')[0].created_by).toBe('lp_solar_teste');
    expect(codigos().map((l: any) => l.key)).toEqual([`${PREFIXO_CODIGO}${g.body.codigo_whats}`]);
  });

  it('falha ao gravar o código não derruba a rota /agora: 200, o card nasce, a resposta sai sem codigo_whats', async () => {
    const original = h.main.from.bind(h.main);
    h.main.from = (t: string) => {
      const q = original(t);
      if (t === 'system_state') q.insert = () => Promise.resolve({ data: null, error: { code: 'XX000', message: 'banco fora' } });
      return q;
    };
    const r = await request(app).post('/io/solar/quiz/agora').send(corpo());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.codigo_whats).toBeUndefined();
    expect(h.ger.tabela('agendamentos')).toHaveLength(1);
  });
});

// ── a religação ──────────────────────────────────────────────────────────────

const AGORA = Date.parse('2026-10-29T15:00:00.000Z');
const MIN = 60_000; const HORA = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const FALA = 'Oi! Acabei de preencher a simulação de energia solar. Código: K7M2P';
const CK_QUEM_ESCREVEU = chaveContato(TEL_QUEM_ESCREVEU)!;

function semear(opts: { codigo?: Record<string, unknown> | null; card?: Record<string, unknown> | null } = {}): void {
  if (opts.codigo !== null) h.main.tabela('system_state').push({
    key: `${PREFIXO_CODIGO}K7M2P`, value: { card_id: 1714, criado_em: iso(AGORA - 5 * MIN), ...(opts.codigo ?? {}) }, updated_at: iso(AGORA - 5 * MIN),
  });
  if (opts.card !== null) h.ger.tabela('agendamentos').push({
    id: 1714, cliente_telefone: TEL_QUIZ, status: 'agendado', created_by: 'lp_solar', created_at: iso(AGORA - 5 * MIN), quando: iso(AGORA + HORA), vendedor_nome: 'Nilce',
    ...(opts.card ?? {}),
  });
}
const religar = (tel = TEL_QUEM_ESCREVEU, texto = FALA) => religarQuizPelaEntrada(chaveContato(tel)!, tel, texto, AGORA);
const telDoCard = (): string => h.ger.tabela('agendamentos').find((c: any) => c.id === 1714).cliente_telefone;
const marcador = () => h.main.tabela('system_state').find((l: any) => l.key === `${PREFIXO_RELIGADO}1714`);
const nadaMudou = () => { expect(telDoCard()).toBe(TEL_QUIZ); expect(marcador()).toBeUndefined(); };

describe('religarQuizPelaEntrada: a religação certa', () => {
  it('troca o telefone do card para o de quem escreveu, grava o marcador só com HMACs, marca o código como usado e não manda nada', async () => {
    semear();
    const r = await religar();
    expect(r).toEqual({ religou: true, cardId: 1714, motivo: 'religado' });
    expect(telDoCard()).toBe(TEL_QUEM_ESCREVEU);
    const m = marcador()!;
    expect(m.value.de).toBe(hmacDe(chaveContato(TEL_QUIZ)));
    expect(m.value.para).toBe(hmacDe(CK_QUEM_ESCREVEU));
    expect(m.value.hmac_id).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(m)).not.toMatch(/1112222|1360223|5534|5511/);
    expect(h.main.tabela('system_state').find((l: any) => l.key === `${PREFIXO_CODIGO}K7M2P`)!.value.usado_em).toBe(iso(AGORA));
    expect(h.conversasLidas).toEqual([chaveContato(TEL_QUIZ)]);   // leu a conversa do número do CARD
    expect(h.enviados).toHaveLength(0);
  });

  it('não escreve no telefone_norm (coluna GERADA do banco) e filtra o UPDATE pelo número que leu', async () => {
    semear({ card: { telefone_norm: '1191112222' } });
    await religar();
    expect(h.ger.tabela('agendamentos')[0].telefone_norm).toBe('1191112222');   // o banco a recalcula; o código nunca a toca
  });

  it('um cancelado de quem escreveu não conta como card aberto', async () => {
    semear();
    h.ger.tabela('agendamentos').push({ id: 1500, cliente_telefone: TEL_QUEM_ESCREVEU, status: 'cancelado', created_by: 'lp_solar', created_at: iso(AGORA - 3 * 86_400_000) });
    expect((await religar()).religou).toBe(true);
  });
});

describe('religarQuizPelaEntrada: as travas (na dúvida, não religa)', () => {
  it('fala sem código, código que não existe e número fora do padrão', async () => {
    semear();
    expect((await religar(TEL_QUEM_ESCREVEU, 'Oi! Acabei de preencher a simulação de energia solar.')).motivo).toBe('sem_codigo');
    expect((await religar(TEL_QUEM_ESCREVEU, 'Código: ZZZZZ')).motivo).toBe('codigo_desconhecido');
    expect((await religarQuizPelaEntrada('lid:123', '123456789012345678', FALA, AGORA)).motivo).toBe('telefone_invalido');
    nadaMudou();
  });

  it('código vencido (2 h) não religa', async () => {
    semear({ codigo: { criado_em: iso(AGORA - 2 * HORA - MIN) } });
    expect(await religar()).toMatchObject({ religou: false, motivo: 'codigo_vencido' });
    nadaMudou();
  });

  it('código já usado não religa', async () => {
    semear({ codigo: { usado_em: iso(AGORA - MIN) } });
    expect(await religar()).toMatchObject({ religou: false, motivo: 'codigo_usado' });
    nadaMudou();
  });

  it('o número do card que JÁ escreveu à linha não religa', async () => {
    semear();
    h.conversa = { completa: true, msgs: [{ id: 1, from_me: false, texto: 'oi', momment: iso(AGORA - 10 * MIN) }] };
    expect(await religar()).toMatchObject({ religou: false, motivo: 'card_ja_escreveu' });
    nadaMudou();
  });

  it('leitura da conversa que falha (incompleta) não religa', async () => {
    semear();
    h.conversa = { completa: false, msgs: [] };
    expect(await religar()).toMatchObject({ religou: false, motivo: 'leitura_falhou' });
    nadaMudou();
  });

  it('quem escreveu já tem outro card solar aberto: não religa, motivo outro_card', async () => {
    semear();
    h.ger.tabela('agendamentos').push({ id: 1715, cliente_telefone: TEL_QUEM_ESCREVEU, status: 'agendado', created_by: 'agente_duda', created_at: iso(AGORA - MIN), quando: iso(AGORA + HORA) });
    expect(await religar()).toMatchObject({ religou: false, motivo: 'outro_card', cardId: 1714 });
    nadaMudou();
  });

  it('mesmo número: motivo mesmo_numero e nada é feito', async () => {
    semear();
    const r = await religar(TEL_QUIZ);
    expect(r).toMatchObject({ religou: false, motivo: 'mesmo_numero' });
    nadaMudou();
    // o código fica gasto: a rede da fila não relê a mesma fala por 30 min
    expect(h.main.tabela('system_state').find((l: any) => l.key === `${PREFIXO_CODIGO}K7M2P`)!.value.usado_em).toBe(iso(AGORA));
    expect(await religar(TEL_QUIZ)).toMatchObject({ religou: false, motivo: 'codigo_usado' });
  });

  it('card que não serve: de teste, cancelado ou com mais de 2 h', async () => {
    for (const card of [{ created_by: 'lp_solar_teste' }, { status: 'cancelado' }, { created_at: iso(AGORA - 3 * HORA) }]) {
      h.main = new BancoFalso(); h.ger = new BancoFalso();
      semear({ card });
      expect(await religar(), JSON.stringify(card)).toMatchObject({ religou: false, motivo: 'card_nao_serve' });
      nadaMudou();
    }
  });

  it('já religado (23505 no marcador): não faz de novo', async () => {
    semear();
    h.main.tabela('system_state').push({ key: `${PREFIXO_RELIGADO}1714`, value: { card_id: 1714 }, updated_at: iso(AGORA - MIN) });
    expect(await religar()).toMatchObject({ religou: false, motivo: 'ja_religado' });
    expect(telDoCard()).toBe(TEL_QUIZ);
  });

  it('o card trocou de número entre a leitura e a escrita: desfaz o marcador e não religa', async () => {
    semear();
    const original = h.ger.from.bind(h.ger);
    h.ger.from = (t: string) => {
      const q = original(t);
      if (t === 'agendamentos') { const upd = q.update; q.update = (p: any) => { h.ger.tabela('agendamentos')[0].cliente_telefone = '5511977776666'; return upd(p); }; }
      return q;
    };
    const rr = await religar();
    expect(rr).toMatchObject({ religou: false, motivo: 'card_mudou' });
    expect(marcador()).toBeUndefined();
  });
});

describe('religarQuizPelaEntrada: o marcador que não deu para apagar', () => {
  it('card que mudou e delete do marcador que falha: loga uma linha sem telefone e não religa', async () => {
    semear();
    const aviso = (await import('../utils/logger')).logger.warn as any;
    aviso.mockClear();
    const origemGer = h.ger.from.bind(h.ger);
    h.ger.from = (t: string) => {
      const q = origemGer(t);
      if (t === 'agendamentos') { const upd = q.update; q.update = (p: any) => { h.ger.tabela('agendamentos')[0].cliente_telefone = '5511977776666'; return upd(p); }; }
      return q;
    };
    const origemMain = h.main.from.bind(h.main);
    h.main.from = (t: string) => {
      const q = origemMain(t);
      if (t === 'system_state') q.delete = () => Promise.resolve({ data: null, error: { code: 'XX000', message: 'banco fora' } });
      return q;
    };
    expect(await religar()).toMatchObject({ religou: false, motivo: 'card_mudou' });
    const chamadas = aviso.mock.calls.map((c: any[]) => String(c[1]));
    expect(chamadas.some((m: string) => m.includes('não apaguei o marcador do card 1714'))).toBe(true);
    for (const m of chamadas) expect(m).not.toMatch(/\d{10}/);
  });
});

describe('a rede da fila: falas recentes com código', () => {
  it('lê só falas do lead na janela, com código e telefone legível', async () => {
    process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
    h.main.tabela('wa_mensagens').push(
      { id: 1, instancia: 'inst-io', from_me: false, is_group: false, telefone: TEL_QUEM_ESCREVEU, texto: FALA, momment: iso(AGORA - 5 * MIN) },
      { id: 2, instancia: 'inst-io', from_me: false, is_group: false, telefone: TEL_QUEM_ESCREVEU, texto: FALA, momment: iso(AGORA - 50 * MIN) },     // fora da janela
      { id: 3, instancia: 'inst-io', from_me: true, is_group: false, telefone: TEL_QUEM_ESCREVEU, texto: FALA, momment: iso(AGORA - 5 * MIN) },       // fala nossa
      { id: 4, instancia: 'inst-io', from_me: false, is_group: false, telefone: '123456789012345678', texto: FALA, momment: iso(AGORA - 5 * MIN) },   // LID
      { id: 5, instancia: 'inst-io', from_me: false, is_group: false, telefone: TEL_QUEM_ESCREVEU, texto: 'Código de barras', momment: iso(AGORA - 5 * MIN) },
    );
    expect(await falasComCodigoRecentes(AGORA)).toEqual([{ telefone: TEL_QUEM_ESCREVEU, texto: FALA }]);
  });
});
