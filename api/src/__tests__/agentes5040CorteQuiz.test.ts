import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Cortes nos robôs do quiz solar (Fase B1b): a agente do quiz (solarAgenteQuiz) e a mensagem de
// "não marcou" (runSolarQuizLeadsTick). Banco em memória, Z-API e IA falsas. A posse e os interruptores
// são os REAIS: o que se prova é o corte por LEAD, não um dublê da posse.

const h = vi.hoisted(() => ({
  humano: [] as Array<{ tel: string; bolhas: string[] }>,
  create: vi.fn(),
}));

vi.mock('../utils/supabase', async () => {
  const { supabase } = await import('./_bancoFalso');
  const { clienteComLte } = await import('./_clienteComLte');
  return { supabase: clienteComLte(supabase) };
});
vi.mock('../utils/supabaseGerador', async () => {
  const { supabase } = await import('./_bancoFalso');
  const { clienteComLte } = await import('./_clienteComLte');
  return { supabaseGerador: clienteComLte(supabase) };
});
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({ messages: { create: h.create } }) }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (tel: string, bolhas: string[]) => { h.humano.push({ tel, bolhas }); }),
  sendWhatsApp: vi.fn(async () => undefined),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: vi.fn(async () => ({ pode: true })),
  registrarBloqueio: vi.fn(async () => undefined),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ dentroDoTetoHorarioLinha: vi.fn(async () => true) }));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn(async () => false),
}));
vi.mock('../services/io/solarRespostas', () => ({ INSTANCE_ID_IO: 'INSTANCIA_TESTE' }));

import { banco } from './_bancoFalso';
import { interruptores, semearAlvo, semearPosse } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { runSolarAgenteQuizTick, SOLAR_AGENTE_PREFIX } from '../services/io/solarAgenteQuiz';
import { runSolarQuizLeadsTick, SOLAR_BV_PREFIX } from '../services/io/solarBoasVindas';

const AGORA = new Date('2026-10-21T15:00:00.000Z');   // 12h em Brasília
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

const X = '5534991110001';   // celular de teste
const CHAVE_X = '3491110001';
const Y = '5534992220002';   // outro lead
const CHAVE_Y = '3492220002';

function lead(tel: string, chave: string, criadoHaMin = 120) {
  return {
    lead_id: `quiz_${chave}`, form_id: 'quiz_solar', nome: 'Maria Souza', whatsapp: tel, cidade: 'Uberlândia',
    field_data: [{ name: 'Caminho', values: ['ligacao'] }], agendado_id: null, consultor: 'Nilce',
    created_time: minutosAtras(criadoHaMin),
  };
}
const escreveu = (tel: string, texto = 'Pode ser às 10h?') => banco.poe('wa_mensagens', {
  telefone: tel, texto, tipo: 'texto', momment: minutosAtras(3), from_me: false, is_group: false, instancia: 'INSTANCIA_TESTE',
});

beforeEach(() => {
  banco.reset();
  h.humano.length = 0;
  h.create.mockReset().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ resposta: 'Combinado, Maria.', acao: 'nada', resumo: 'Perguntou o horário.' }) }],
  });
  banco.poe('consultores', { nome: 'Nilce', whatsapp: '5534991516846' });
  delete process.env.SOLAR_AGENTE_OFF;
  interruptores({});
  zerarCacheInterruptores();
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); interruptores({}); zerarCacheInterruptores(); });

describe('agente do quiz: a Duda antiga e a nova', () => {
  it('tudo desligado: responde o lead como hoje', async () => {
    banco.poe('leads_meta', lead(X, CHAVE_X));
    escreveu(X);
    const r = await runSolarAgenteQuizTick();
    expect(r.respondidas).toBe(1);
    expect(h.humano.map(e => e.tel)).toEqual([X]);
  });

  it('duda_vivo ligado e o lead no alvo, sem conversa aberta e SEM posse: a antiga abre como hoje (escopo sozinho não cala)', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    banco.poe('leads_meta', lead(X, CHAVE_X));
    escreveu(X);
    const r = await runSolarAgenteQuizTick();
    expect(r.respondidas).toBe(1);
    expect(h.humano.map(e => e.tel)).toEqual([X]);
  });

  it('duda_vivo ligado, o lead no alvo, sem conversa aberta e COM posse da nova: a antiga NÃO abre conversa nova e não escreve nada', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda');
    banco.poe('leads_meta', lead(X, CHAVE_X));
    escreveu(X);
    const antes = banco.escritas.length;
    const r = await runSolarAgenteQuizTick();
    expect(r.respondidas).toBe(0);
    expect(h.humano).toEqual([]);
    expect(h.create).not.toHaveBeenCalled();
    expect(banco.escritas.length).toBe(antes);   // nem marcador, nem sessão
  });

  it('duda_vivo ligado com o alvo em OUTRO número: o lead de fora é respondido pela antiga, como hoje', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    banco.poe('leads_meta', lead(Y, CHAVE_Y));
    escreveu(Y);
    const r = await runSolarAgenteQuizTick();
    expect(r.respondidas).toBe(1);
    expect(h.humano.map(e => e.tel)).toEqual([Y]);
  });

  it('duda_vivo ligado e nenhum alvo gravado: a nova não atende ninguém, a antiga segue', async () => {
    interruptores({ duda: true });
    banco.poe('leads_meta', lead(X, CHAVE_X));
    escreveu(X);
    expect((await runSolarAgenteQuizTick()).respondidas).toBe(1);
  });

  it('lead no alvo mas com conversa JÁ ABERTA na antiga (há marcador) e sem posse da nova: a antiga termina a conversa', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    banco.poe('leads_meta', lead(X, CHAVE_X));
    banco.poe('system_state', { key: `${SOLAR_AGENTE_PREFIX}quiz_${CHAVE_X}`, value: { ate: minutosAtras(60), respostas: 1 } });
    escreveu(X);
    expect((await runSolarAgenteQuizTick()).respondidas).toBe(1);
  });

  it('a nova tem a posse (viva): a antiga cala, mesmo com conversa aberta', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda');
    banco.poe('leads_meta', lead(X, CHAVE_X));
    banco.poe('system_state', { key: `${SOLAR_AGENTE_PREFIX}quiz_${CHAVE_X}`, value: { ate: minutosAtras(60), respostas: 1 } });
    escreveu(X);
    const r = await runSolarAgenteQuizTick();
    expect(r.respondidas).toBe(0);
    expect(h.humano).toEqual([]);
  });

  it('posse encerrada: a antiga volta a atender', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda', 'encerrada');
    banco.poe('leads_meta', lead(X, CHAVE_X));
    banco.poe('system_state', { key: `${SOLAR_AGENTE_PREFIX}quiz_${CHAVE_X}`, value: { ate: minutosAtras(60), respostas: 1 } });
    escreveu(X);
    expect((await runSolarAgenteQuizTick()).respondidas).toBe(1);
  });
});

describe('quiz: a mensagem de quem não marcou (runSolarQuizLeadsTick)', () => {
  it('tudo desligado: manda como hoje, uma vez, com o carimbo', async () => {
    banco.poe('leads_meta', lead(X, CHAVE_X, 60));
    const r = await runSolarQuizLeadsTick();
    expect(r.enviadas).toBe(1);
    expect(h.humano.map(e => e.tel)).toEqual([X]);
    expect(banco.linhas('system_state').some(l => l.key === `${SOLAR_BV_PREFIX}quiz_quiz_${CHAVE_X}`)).toBe(true);
  });

  it('lead cuja conversa é da agente nova: não recebe por cima e não ganha carimbo; o outro lead recebe (o tick não cede inteiro)', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda');
    banco.poe('leads_meta', lead(X, CHAVE_X, 60), lead(Y, CHAVE_Y, 60));
    const r = await runSolarQuizLeadsTick();
    expect(r.enviadas).toBe(1);
    expect(h.humano.map(e => e.tel)).toEqual([Y]);
    expect(banco.linhas('system_state').some(l => String(l.key).includes(CHAVE_X))).toBe(false);
  });

  it('lead no alvo mas SEM posse: a antiga manda (o corte desta mensagem é a posse, não o alvo)', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    banco.poe('leads_meta', lead(X, CHAVE_X, 60));
    expect((await runSolarQuizLeadsTick()).enviadas).toBe(1);
  });
});
