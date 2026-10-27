import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BancoFalso } from './bancoFalsoQuiz';

// Itens 7b e 10 do quiz solar (24/10/2026): quem a Nilce já atendeu ("falei") não recebe o "oi" de 5 min nem a mensagem da Duda
// de "você não marcou"; o card do "agora" recente também não recebe o "oi". Leitura que falha segue como antes.

const h = vi.hoisted(() => ({ main: null as any, ger: null as any, enviadas: [] as Array<{ phone: string; bolhas: string[] }>, quebrar: false }));

vi.mock('../utils/supabase', () => ({
  supabase: { from: (t: string) => { if (h.quebrar) throw new Error('banco fora'); return h.main.from(t); } },
}));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: (t: string) => h.ger.from(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { h.enviadas.push({ phone, bolhas }); }),
  sendWhatsApp: vi.fn(),
}));
vi.mock('../services/agentes5040/posse', () => ({ cedeAAgente: vi.fn(async () => false) }));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn(async () => false), chaveContato: vi.fn() }));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: vi.fn(async () => ({ pode: true })), registrarBloqueio: vi.fn(),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ dentroDoTetoHorarioLinha: vi.fn(async () => true) }));
vi.mock('../services/io/solarRespostas', () => ({ INSTANCE_ID_IO: 'INSTANCIA_IO' }));

import { semOiDoQuiz } from '../services/io/solarAgendaGiovanna';
import { runSolarQuizLeadsTick } from '../services/io/solarBoasVindas';

const MIN = 60_000;

beforeEach(() => { h.main = new BancoFalso(); h.ger = new BancoFalso(); h.enviadas.length = 0; h.quebrar = false; });

const ficha = (id: number, extra: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Ana', cliente_telefone: '5534991112222', vendedor_nome: 'Nilce', status: 'agendado', created_by: 'lp_solar',
  bomdia_at: null, lembrete_5min_at: null, quando: new Date(Date.now() + 5 * MIN).toISOString(), created_at: new Date(Date.now() - MIN).toISOString(),
  observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO', ...extra,
});

describe('7b: o "oi" de 5 min', () => {
  it('não sai para o card do "agora" criado menos de 15 min antes do horário', async () => {
    const s = await semOiDoQuiz([ficha(1, { observacao: 'LP SOLAR QUIZ · AGORA\nOnde: Casa' })] as never);
    expect([...s]).toEqual([1]);
  });
  it('não sai para card cujo lead já tem solar_falei; sai para os outros', async () => {
    h.main.tabela('system_state').push({ key: 'solar_falei:quiz_3491112222', value: {}, updated_at: new Date().toISOString() });
    const s = await semOiDoQuiz([ficha(1), ficha(2, { cliente_telefone: '5534988887777' })] as never);
    expect([...s]).toEqual([1]);
  });
  it('card "agora" marcado com muita antecedência (mais de 15 min) não é silenciado só por isso', async () => {
    const s = await semOiDoQuiz([ficha(3, { observacao: 'LP SOLAR QUIZ · AGORA', quando: new Date(Date.now() + 40 * MIN).toISOString() })] as never);
    expect(s.size).toBe(0);
  });
  it('se a leitura falhar, segue como hoje (ninguém é tirado)', async () => {
    h.quebrar = true;
    const s = await semOiDoQuiz([ficha(1)] as never);
    expect(s.size).toBe(0);
  });
});

describe('10: a mensagem da Duda para quem não marcou', () => {
  const lead = () => h.ger.tabela('leads_meta').push({
    lead_id: 'quiz_3491112222', nome: 'Ana Souza', whatsapp: '5534991112222', cidade: 'Uberlândia-MG', agendado_id: null, consultor: 'Nilce',
    form_id: 'quiz_solar', created_time: new Date(Date.now() - 40 * MIN).toISOString(),
    field_data: [{ name: 'Caminho', values: ['ligacao'] }],
  });
  // A mensagem só sai das 8h às 20h de Brasília: ancora o relógio ao meio-dia.
  const meioDia = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-10-23T15:00:00Z')); };

  it('sem "falei", envia como sempre; com "falei", não envia', async () => {
    meioDia(); lead();
    const a = await runSolarQuizLeadsTick();
    expect(a.enviadas).toBe(1);
    h.main.zerar(); h.enviadas.length = 0;
    h.main.tabela('system_state').push({ key: 'solar_falei:quiz_3491112222', value: {}, updated_at: new Date().toISOString() });
    const b = await runSolarQuizLeadsTick();
    expect(b.enviadas).toBe(0);
    expect(h.enviadas).toHaveLength(0);
    vi.useRealTimers();
  });
  it('se a leitura do "falei" falhar, envia como antes', async () => {
    meioDia(); lead();
    const orig = h.main.from.bind(h.main);
    h.main.from = (t: string) => { const q = orig(t); q.maybeSingle = () => Promise.resolve({ data: null, error: { message: 'boom' } }); return q; };
    const r = await runSolarQuizLeadsTick();
    expect(r.enviadas).toBe(1);
    vi.useRealTimers();
  });

  // 27/10/2026 (B): o claim do 1º contato. O card de quem saiu sem marcar, quando fala, ganha `solar_quiz_1o:<lead>`; o "não marcou"
  // de 4 bolhas ganha o MESMO claim antes de enviar. Quem ganha fala; os dois nunca saem juntos.
  const chaves = (): string[] => h.main.tabela('system_state').map((l: any) => String(l.key));
  it('o claim solar_quiz_1o já existe (a abertura da Duda tem o 1º contato): o "não marcou" NÃO sai e não deixa carimbo', async () => {
    meioDia(); lead();
    h.main.tabela('system_state').push({ key: 'solar_quiz_1o:quiz_3491112222', value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() });
    const r = await runSolarQuizLeadsTick();
    expect(r.enviadas).toBe(0);
    expect(h.enviadas).toHaveLength(0);
    expect(chaves().filter(k => k.startsWith('solar_boasvindas_sent:'))).toHaveLength(0);
    vi.useRealTimers();
  });
  it('sem o claim, o "não marcou" ganha o solar_quiz_1o (o card que fala cai para MUDO) e a rodada seguinte não repete', async () => {
    meioDia(); lead();
    const a = await runSolarQuizLeadsTick();
    expect(a.enviadas).toBe(1);
    expect(chaves()).toContain('solar_quiz_1o:quiz_3491112222');
    expect(chaves()).toContain('solar_boasvindas_sent:quiz_quiz_3491112222');
    const b = await runSolarQuizLeadsTick();
    expect(b.enviadas).toBe(0);
    vi.useRealTimers();
  });
  it('envio que falha devolve AS DUAS chaves, e a rodada seguinte tenta de novo', async () => {
    meioDia(); lead();
    const { sendHuman } = await import('../services/agents/zapiClient');
    vi.mocked(sendHuman).mockRejectedValueOnce(new Error('z-api fora'));
    const a = await runSolarQuizLeadsTick();
    expect(a.enviadas).toBe(0);
    expect(a.erros).toBe(1);
    expect(chaves().filter(k => k === 'solar_quiz_1o:quiz_3491112222' || k.startsWith('solar_boasvindas_sent:'))).toHaveLength(0);
    const b = await runSolarQuizLeadsTick();
    expect(b.enviadas).toBe(1);
    vi.useRealTimers();
  });
});

describe('7b: o "falei" antigo NÃO corta o "oi" de 5 min', () => {
  const falei = (emMs: number) => h.main.tabela('system_state').push({ key: 'solar_falei:quiz_3491112222', value: { em: new Date(emMs).toISOString() }, updated_at: new Date(emMs).toISOString() });
  it('"falei" gravado ANTES de o card nascer não corta; depois do card, corta', async () => {
    const card = ficha(1, { created_at: new Date(Date.now() - 2 * MIN).toISOString() });
    falei(Date.now() - 3 * MIN);   // antes do card
    expect((await semOiDoQuiz([card] as never)).size).toBe(0);
    h.main.zerar();
    falei(Date.now() - 1 * MIN);   // depois do card
    expect([...(await semOiDoQuiz([card] as never))]).toEqual([1]);
  });
  it('"falei" com mais de 24 h não corta, mesmo que seja mais novo que o card', async () => {
    const card = ficha(1, { created_at: new Date(Date.now() - 30 * 3_600_000).toISOString() });
    falei(Date.now() - 25 * 3_600_000);
    expect((await semOiDoQuiz([card] as never)).size).toBe(0);
  });
});
