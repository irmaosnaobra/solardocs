import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Cortes na Carla antiga (whatsappAgentService, número SEM conta, linha IO): Fase B1b.
// Posse e interruptores REAIS sobre o banco em memória; Carla, Pix e envio são falsos.

const h = vi.hoisted(() => ({
  carla: vi.fn(async () => undefined),
  recup: vi.fn(async () => false),
  comprovante: vi.fn(async () => false),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({ messages: { create: vi.fn() } }) }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, sendHuman: vi.fn(), sendImage: vi.fn(), sendWhatsApp: vi.fn(), linhaEmCooldown: () => false,
}));
vi.mock('../utils/ofertaCupom', () => ({ ofertaCupomAtiva: async () => null, bolhasOferta: () => [] }));
vi.mock('../utils/pixInfo', () => ({ pixBlocoWhatsApp: () => '' }));
vi.mock('../services/agents/whatsapp/promoGeradorActivation', () => ({
  detectAndActivatePromoCredits: async () => ({ ativado: false, ja_ativado_antes: false }),
}));
vi.mock('../services/io/encaminharMidiaConsultor', () => ({ encaminharMidiaAoConsultor: vi.fn() }));
vi.mock('../services/agents/sdr/sdrB2bAgentService', () => ({ handleSolarDocB2bLead: h.carla }));
vi.mock('../services/agents/whatsapp/pixRecoveryAgentService', () => ({ handleRecoveryReply: h.recup }));
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  tryProcessAbandonedPixComprovante: h.comprovante, tryProcessPixComprovante: vi.fn(async () => false),
}));

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

import { banco } from './_bancoFalso';
import { interruptores, semearAlvo, semearPosse } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { handleIncomingWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';

const X = '5534991110001';
const Y = '5534992220002';
const ANUNCIO = { ctwa_clid: 'clid-1' };
const chegou = (tel: string, linha: 'io' | 'solardoc' = 'io', texto = 'oi, vi o anúncio') =>
  handleIncomingWhatsApp(tel, texto, 'Ana', ANUNCIO, undefined, linha);

beforeEach(() => {
  banco.reset(); h.carla.mockClear(); h.recup.mockClear().mockResolvedValue(false); h.comprovante.mockClear();
  interruptores({}); zerarCacheInterruptores();
  porta.fatos = {}; porta.lerFatos = null;
});
afterEach(() => { interruptores({}); zerarCacheInterruptores(); });

describe('Carla antiga: corte da conversa (cedeAAgente)', () => {
  it('tudo desligado: o lead do anúncio na linha IO cai na Carla como hoje', async () => {
    await chegou(X);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('carla_vivo ligado e o lead com posse viva: a Carla antiga cala; o lead de fora do alvo segue com ela', async () => {
    interruptores({ carla: true });
    semearAlvo([X]);
    semearPosse(X, 'carla');
    await chegou(X);
    expect(h.carla).not.toHaveBeenCalled();
    await chegou(Y);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('o corte é só da linha IO: a mesma conversa chegando na linha do SolarDoc segue como hoje', async () => {
    interruptores({ carla: true });
    semearAlvo([X]);
    semearPosse(X, 'carla');
    await chegou(X, 'solardoc');
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('o comprovante de Pix e a recuperação ficam ACIMA do corte: lead com posse ainda é lido por eles', async () => {
    interruptores({ carla: true });
    semearAlvo([X]);
    semearPosse(X, 'carla');
    h.recup.mockResolvedValue(true);
    await chegou(X);
    expect(h.recup).toHaveBeenCalledTimes(1);
    expect(h.carla).not.toHaveBeenCalled();
  });
});

describe('Carla antiga: só deixa de abrir conversa nova quando a POSSE existe (não basta o escopo)', () => {
  it('carla_vivo ligado, X no alvo e SEM posse nem sessão: a antiga abre como hoje (o escopo sozinho não cala); Y também', async () => {
    interruptores({ carla: true });
    semearAlvo([X]);
    await chegou(X);
    expect(h.carla).toHaveBeenCalledTimes(1);
    await chegou(Y);
    expect(h.carla).toHaveBeenCalledTimes(2);
  });

  it('X no alvo COM posse da Carla nova e sem sessão antiga: a antiga cala (não abre conversa nova); Y abre', async () => {
    interruptores({ carla: true });
    semearAlvo([X]);
    semearPosse(X, 'carla');
    await chegou(X);
    expect(h.carla).not.toHaveBeenCalled();
    await chegou(Y);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('X no alvo mas com sessão sdr_b2b já aberta (em outro formato de telefone) e sem posse: a antiga termina a conversa', async () => {
    interruptores({ carla: true });
    semearAlvo([X]);
    banco.poe('whatsapp_sessions', { phone: '553491110001', tipo: 'sdr_b2b', messages: [], lead_data: {} });
    await chegou(X);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('interruptor ligado e nenhum alvo gravado: ninguém é da nova, a antiga abre como hoje', async () => {
    interruptores({ carla: true });
    await chegou(X);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });
});

describe('Carla antiga: a porta decide a Duda na entrada da fila (B1c-1)', () => {
  const BOTAO = 'Olá! Quero simular meu projeto de energia solar';
  const posses = () => banco.linhas('whatsapp_sessions').filter(l => l.tipo === 'ag5040');

  it('lead do alvo sem posse e com texto de botão do solar, na linha IO: a porta grava a posse da Duda e a Carla antiga cala', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    const vistos: any[] = [];
    porta.lerFatos = (...a: any[]) => { vistos.push(a); };
    await chegou(X, 'io', BOTAO);
    expect(posses()).toHaveLength(1);
    expect(posses()[0]).toMatchObject({ lead_data: { dona: 'duda', estado: 'viva' } });
    expect(h.carla).not.toHaveBeenCalled();
    // a fila não traz o payload do anúncio: só o texto da mensagem vai para a porta (anúncio nulo)
    expect(vistos[0]![2]).toBeNull();
  });

  it('o mesmo lead na linha do SolarDoc: a porta nem é consultada (o corte é só da linha IO)', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    await chegou(X, 'solardoc', BOTAO);
    expect(posses()).toHaveLength(0);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('lead de fora do alvo: sem posse e a Carla antiga abre como hoje', async () => {
    interruptores({ duda: true });
    semearAlvo([X]);
    await chegou(Y, 'io', BOTAO);
    expect(posses()).toHaveLength(0);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });

  it('a porta só assume a Duda: lead do alvo com porteiro em Carla (anúncio do SolarDoc) segue com a Carla antiga', async () => {
    interruptores({ duda: true, carla: true });
    semearAlvo([X]);
    // sem posse e sem sinal de solar: passo 7, ninguém assume
    await chegou(X, 'io', 'oi');
    expect(posses()).toHaveLength(0);
    expect(h.carla).toHaveBeenCalledTimes(1);
  });
});
