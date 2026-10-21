import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Corte do /webhook/io (Fase B1b): conversa que uma agente nova segura não cai na Bia por cima dela.
// Posse e interruptores REAIS sobre o banco em memória; tudo que fala é falso.

const h = vi.hoisted(() => ({
  bia: vi.fn(async () => undefined),
  leadsBia: new Set<string>(),
  pendentePix: new Set<string>(),
  transcrever: vi.fn(async () => null),
  avisos: [] as string[],
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/supabaseGerador', async () => ({ supabaseGerador: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  handleIncomingWhatsApp: vi.fn(async () => undefined),
  ehGatilhoSolarDoc: (t: string) => /solardoc/i.test(t),
  vendedoraJaAtende: async () => false,
}));
vi.mock('../services/agents/sdr/sdrAgentService', () => ({ tryClaimMessage: async () => true }));
vi.mock('../services/agents/sdr/sdrGroupAgent', () => ({ handleGroupMessage: vi.fn() }));
vi.mock('../services/agents/whatsapp/biaInboundService', () => ({
  handleBiaInbound: h.bia,
  ehLeadRecuperacao: async (p: string) => h.leadsBia.has(p),
  marcarTakeoverBia: vi.fn(async () => undefined),
}));
vi.mock('../services/io/recepcaoIo', () => ({ recepcaoJaAtende: async () => false }));
vi.mock('../services/agents/whatsapp/pixSolicitado', () => ({
  acharEmail: () => null,
  temComprovantePendente: async (p: string) => h.pendentePix.has(p),
}));
vi.mock('../services/agents/whatsapp/comprovanteHandoff', () => ({ HANDOFF_CEDE_MIN: 5, temHandoffComprovante: async () => false }));
vi.mock('../services/io/encaminharMidiaConsultor', () => ({ encaminharMidiaAoConsultor: vi.fn(async () => undefined) }));
vi.mock('../utils/mediaProcessor', () => ({ transcribeAudio: h.transcrever, downloadImageAsAnthropicSource: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn(async (_t: string, msg: string) => { h.avisos.push(msg); }) }));
vi.mock('../controllers/limpaproController', () => ({ kiwifyWebhook: vi.fn() }));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: [] }));

import router from '../routes/webhook';
import { banco } from './_bancoFalso';
import { interruptores, semearAlvo, semearPosse } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';

const app = express();
app.use(express.json());
app.use('/webhook', router);

const X = '5534991110001';
const Y = '5534992220002';
const texto = (phone: string, msg = 'oi, vi o anúncio') => ({ phone, fromMe: false, isGroup: false, messageId: `M${Math.random()}`, text: { message: msg } });
const postar = async (corpo: unknown) => {
  const r = await request(app).post('/webhook/io').send(corpo as object);
  await new Promise(res => setTimeout(res, 30));   // o processamento segue em segundo plano
  return r;
};

beforeEach(() => {
  banco.reset(); h.bia.mockClear(); h.leadsBia.clear(); h.pendentePix.clear(); h.avisos.length = 0;
  h.transcrever.mockClear();
  interruptores({}); zerarCacheInterruptores();
  h.leadsBia.add(X); h.leadsBia.add(Y);
});
afterEach(() => { interruptores({}); zerarCacheInterruptores(); });

describe('/webhook/io: corte para as agentes novas', () => {
  it('tudo desligado: a Bia responde o lead de recuperação como hoje', async () => {
    await postar(texto(X));
    expect(h.bia).toHaveBeenCalledTimes(1);
  });

  it('lead no alvo com posse viva: a Bia cala; o lead de fora do alvo segue com a Bia', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda');
    await postar(texto(X));
    expect(h.bia).not.toHaveBeenCalled();
    await postar(texto(Y));
    expect(h.bia).toHaveBeenCalledTimes(1);
    expect((h.bia.mock.calls[0] as unknown[])[0]).toBe(Y);
  });

  it('o corte vale para mídia: áudio sem transcrição de lead com posse não gera o aviso "digite pra mim"', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda');
    const audio = { phone: X, fromMe: false, isGroup: false, messageId: 'A1', audio: { audioUrl: 'https://x/a.ogg', mimeType: 'audio/ogg' } };
    await postar(audio);
    expect(h.avisos).toEqual([]);
    // controle: sem o corte (posse encerrada) o mesmo áudio gera o aviso, então o teste não é vazio
    banco.reset(); zerarCacheInterruptores();
    interruptores({ duda: true }); semearAlvo([X]); semearPosse(X, 'duda', 'encerrada');
    h.leadsBia.clear();
    await postar({ ...audio, messageId: 'A2' });
    expect(h.avisos).toHaveLength(1);
  });

  it('comprovante Pix pendente continua ACIMA do corte: o lead com posse segue cedendo à fila do Pix (nada muda)', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda');
    h.pendentePix.add(X);
    await postar(texto(X));
    expect(h.bia).not.toHaveBeenCalled();
  });

  it('posse encerrada: a Bia volta a atender', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    semearPosse(X, 'duda', 'encerrada');
    await postar(texto(X));
    expect(h.bia).toHaveBeenCalledTimes(1);
  });
});
