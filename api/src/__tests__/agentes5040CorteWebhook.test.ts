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

// A porta (assumirNaEntrada) decide a dona com o porteiro REAL; só a leitura da conversa e dos fatos é falsa.
const porta = vi.hoisted(() => ({
  fatos: {} as Record<string, unknown>,
  lerFatos: null as null | ((...a: any[]) => void),
}));
vi.mock('../services/agentes5040/contexto', () => ({
  lerConversa: async () => ({ msgs: [], completa: true }),
  lerFatosPorteiro: async (...a: any[]) => {
    const msgs = a[1] as any[];
    const primeiro = msgs.find(m => m.autor === 'lead' && String(m.texto ?? '').trim());
    porta.lerFatos?.(...a);
    return { leituraOk: true, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false, donaAtual: null,
      ehClienteSolarDoc: false, anuncio: a[2], origemCadastro: null, outroRoboAtivo: false, ...porta.fatos,
      primeiroTextoDoLead: primeiro ? String(primeiro.texto) : null };
  },
}));
vi.mock('../services/io/metaConjuntos', () => ({
  buscarOrigemDoAnuncio: async () => ({ ok: true, campanha: { nome: 'Solar' } }),
  lerMapaCampanhaProduto: async () => ({}),
  produtoDaCampanha: () => 'solar',
}));

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

// O /webhook/io responde 200 ANTES de processar (o processamento segue em segundo plano), então o supertest volta
// cedo e o import() frio de ./porteiro ainda estaria rodando. Em vez de adivinhar um tempo, guardamos a promessa
// REAL do handler (a camada POST /io do roteador) e esperamos por ela. Nada de um teste vaza para o seguinte.
const pendentes = new Set<Promise<unknown>>();
for (const camada of (router as any).stack as any[]) {
  for (const sub of camada.route?.stack ?? []) {
    if (camada.route.path !== '/io' || sub.method !== 'post') continue;
    const original = sub.handle;
    sub.handle = (...a: unknown[]) => {
      const p = Promise.resolve(original.apply(sub, a));
      pendentes.add(p);
      return p;
    };
  }
}
const esvaziar = async (): Promise<void> => {
  while (pendentes.size) {
    const lote = [...pendentes];
    await Promise.allSettled(lote);
    for (const p of lote) pendentes.delete(p);
  }
  await new Promise(res => setImmediate(res));      // o bloco em segundo plano do fim do handler (sem timers) termina aqui
  await new Promise(res => setImmediate(res));
};
const postar = async (corpo: unknown) => {
  const r = await request(app).post('/webhook/io').send(corpo as object);
  await esvaziar();
  return r;
};

beforeEach(() => {
  banco.reset(); h.bia.mockClear(); h.leadsBia.clear(); h.pendentePix.clear(); h.avisos.length = 0;
  h.transcrever.mockClear();
  interruptores({}); zerarCacheInterruptores();
  h.leadsBia.add(X); h.leadsBia.add(Y);
  porta.fatos = {}; porta.lerFatos = null;
});
afterEach(async () => { await esvaziar(); interruptores({}); zerarCacheInterruptores(); });

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
    await vi.waitFor(() => expect(h.avisos).toHaveLength(1));   // o aviso sai de um bloco em segundo plano que o handler não espera
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

describe('/webhook/io: a porta decide a Duda na entrada (B1c-1)', () => {
  const BOTAO = 'Olá! Quero simular meu projeto de energia solar';
  const posses = () => banco.linhas('whatsapp_sessions').filter(l => l.tipo === 'ag5040');

  it('lead do alvo SEM posse e com texto de botão do solar: a porta grava a posse da Duda e a Bia cala', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    await postar(texto(X, BOTAO));
    expect(posses()).toHaveLength(1);
    expect(posses()[0]).toMatchObject({ tipo: 'ag5040', lead_data: { dona: 'duda', estado: 'viva' } });
    expect(h.bia).not.toHaveBeenCalled();
  });

  it('o payload do anúncio e o texto desta mensagem chegam ao porteiro (anúncio do solar decide sem botão)', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    const vistos: any[] = [];
    porta.lerFatos = (...a: any[]) => { vistos.push(a); };
    await postar({ ...texto(X, 'oi, vi o anúncio'), externalAdReply: { sourceId: '120210000000000001', sourceUrl: 'https://fb.me/x' } });
    expect(vistos).toHaveLength(1);
    expect(vistos[0]![2]).toEqual({ adId: '120210000000000001', produto: 'solar' });
    expect((vistos[0]![1] as any[]).slice(-1)[0]).toMatchObject({ autor: 'lead', texto: 'oi, vi o anúncio' });
    expect(posses()).toHaveLength(1);
    expect(h.bia).not.toHaveBeenCalled();
  });

  it('o momment do payload (ms) ancora a posse: desde = momento da mensagem - 60 s', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    const momment = Date.now() - 3 * 60_000;
    await postar({ ...texto(X, BOTAO), momment });
    expect(posses()).toHaveLength(1);
    expect(posses()[0]!.lead_data.desde).toBe(new Date(momment - 60_000).toISOString());
  });

  it('lead de fora do alvo, o mesmo texto: sem posse e a Bia segue como hoje', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    await postar(texto(Y, BOTAO));
    expect(posses()).toHaveLength(0);
    expect(h.bia).toHaveBeenCalledTimes(1);
  });

  it('porteiro sem sinal do assunto (passo 7): a porta devolve false, sem posse, e a Bia segue como hoje', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    await postar(texto(X, 'oi'));
    expect(posses()).toHaveLength(0);
    expect(h.bia).toHaveBeenCalledTimes(1);
  });

  it('recepção antiga já na conversa (outro robô ativo): a porta não assume e o antigo termina a conversa', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    porta.fatos = { outroRoboAtivo: true };
    await postar(texto(X, BOTAO));
    expect(posses()).toHaveLength(0);
    expect(h.bia).toHaveBeenCalledTimes(1);
  });
});
