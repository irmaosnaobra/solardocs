import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O CORTE DA GIOVANNA NA RETOMADA DA CARLA (03/11/2026). Quem tem conta GRÁTIS e está numa conversa aberta pelo robô carla_retomada_usuarios
// (posse viva da Carla, origem retomada_usuarios, ainda valendo) é respondido pela Carla: a Giovanna não chama o modelo, não envia nada e não
// grava sessão. Só o comprovante de Pix passa (libera +1 mês na conta que já existe), e o PARE e a denúncia ficam gravados mesmo com a IA da
// Carla parada. Posse e interruptores são os REAIS sobre o banco em memória; Anthropic, Z-API e o leitor de comprovante são falsos.

const h = vi.hoisted(() => ({
  create: vi.fn(),
  sendHuman: vi.fn(),
  comprovante: vi.fn(async () => false),
  logErro: vi.fn(),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: h.logErro, warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({ messages: { create: h.create } }) }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, sendHuman: h.sendHuman, sendImage: vi.fn(), sendWhatsApp: vi.fn(), linhaEmCooldown: () => false,
}));
vi.mock('../utils/ofertaCupom', () => ({ ofertaCupomAtiva: async () => null, bolhasOferta: () => [] }));
vi.mock('../utils/pixInfo', () => ({ pixBlocoWhatsApp: () => '' }));
vi.mock('../utils/pixBrCode', () => ({ gerarPixCopiaECola: () => '00020126PIXFALSO' }));
vi.mock('../utils/mediaProcessor', () => ({
  transcribeAudio: vi.fn(async () => null),
  downloadImageAsAnthropicSource: vi.fn(async () => ({ type: 'base64', media_type: 'image/jpeg', data: 'AAAA' })),
  downloadPdfAsAnthropicSource: vi.fn(async () => null),
}));
vi.mock('../services/agents/whatsapp/promoGeradorActivation', () => ({
  detectAndActivatePromoCredits: async () => ({ ativado: false, ja_ativado_antes: false }),
}));
vi.mock('../services/io/encaminharMidiaConsultor', () => ({ encaminharMidiaAoConsultor: vi.fn() }));
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  tryProcessAbandonedPixComprovante: vi.fn(async () => false), tryProcessPixComprovante: h.comprovante,
}));

import { banco } from './_bancoFalso';
import { interruptores, semearAlvo } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import { handleIncomingWhatsApp } from '../services/agents/whatsapp/whatsappAgentService';

const X = '5534991110001';
const DIA = 86_400_000;

type Over = Record<string, unknown>;

function semearConta(plano = 'free', over: Over = {}): void {
  banco.poe('users', { id: 'u1', email: 'ana@exemplo.com', plano, billing_status: null, whatsapp: X, whatsapp_opt_out: false, email_opt_out: false, ...over });
}

/** A posse que o robô da retomada grava: dona Carla, origem retomada_usuarios e `retomada.ate` no futuro (ou o que o teste mandar). */
function semearRetomada(over: { estado?: string; origem?: string | null; ate?: string; dona?: string } = {}): void {
  const origem = over.origem === undefined ? 'retomada_usuarios' : over.origem;
  banco.poe('whatsapp_sessions', {
    phone: chaveContato(X), tipo: 'ag5040',
    lead_data: {
      dona: over.dona ?? 'carla', estado: over.estado ?? 'viva', desde: '2026-11-04T12:00:00.000Z', ate_wa_id: null, respostas: 0, imagens: [], links: [],
      ...(origem ? { origem } : {}),
      retomada: { user_id: 'u1', segmento: 'gratis', grupo: 'nunca_pagou', variacao: 0, primeiro_nome: 'Ana', texto: 'Oi.', em: '2026-11-04T12:00:00.000Z', ate: over.ate ?? new Date(Date.now() + 20 * DIA).toISOString() },
    },
  });
}

const chegou = (texto: string, linha: 'io' | 'solardoc' = 'io', media?: { url: string; type: string; mime: string }) =>
  handleIncomingWhatsApp(X, texto, 'Ana', undefined, media, linha);
const usuario = () => banco.linhas('users').find(u => u.id === 'u1');
const supressoes = () => banco.linhas('whatsapp_suppression');
const sessoesDaGiovanna = () => banco.linhas('whatsapp_sessions').filter(s => s.tipo === 'platform');
const calada = (): void => {
  expect(h.create).not.toHaveBeenCalled();
  expect(h.sendHuman).not.toHaveBeenCalled();
  expect(sessoesDaGiovanna()).toHaveLength(0);
};

beforeEach(() => {
  banco.reset();
  h.create.mockReset().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi! Posso ajudar com a proposta?' }] });
  h.sendHuman.mockReset().mockResolvedValue(undefined);
  h.comprovante.mockReset().mockResolvedValue(false);
  h.logErro.mockReset();
  interruptores({ carla: true }); zerarCacheInterruptores();
  semearAlvo([], { carla: 'todos' });
});
afterEach(() => { interruptores({}); zerarCacheInterruptores(); });

describe('conta grátis com a posse viva da retomada, na linha io: a Carla responde, a Giovanna cala', () => {
  it('a Giovanna não chama o modelo, não envia nada e não grava sessão, mas a conta é marcada como respondida', async () => {
    semearConta(); semearRetomada();
    await chegou('oi, vi a mensagem de vocês');
    calada();
    expect(usuario()!.whatsapp_replied_at).toBeTruthy();
    expect(usuario()!.whatsapp_opt_out).toBe(false);
    expect(supressoes()).toHaveLength(0);
  });

  it('a mesma conta mandando a foto do comprovante: o leitor de comprovante é chamado com o user da conta', async () => {
    semearConta(); semearRetomada();
    await chegou('paguei', 'io', { url: 'https://x/c.jpg', type: 'image', mime: 'image/jpeg' });
    expect(h.comprovante).toHaveBeenCalledTimes(1);
    const [user, fonte, telefone, linha] = h.comprovante.mock.calls[0]! as unknown as [Over, Over, string, string];
    expect(user).toMatchObject({ id: 'u1', plano: 'free' });
    expect(fonte).toMatchObject({ type: 'base64' });
    expect(telefone).toBe(X);
    expect(linha).toBe('io');
    calada();
  });

  it('o comprovante que estoura não derruba o corte: erro logado e a Giovanna segue calada', async () => {
    semearConta(); semearRetomada();
    h.comprovante.mockRejectedValueOnce(new Error('leitor fora'));
    await chegou('paguei', 'io', { url: 'https://x/c.jpg', type: 'image', mime: 'image/jpeg' });
    expect(h.logErro).toHaveBeenCalledWith('whatsapp', 'pix-comprovante na retomada da Carla falhou', expect.any(Error));
    calada();
  });
});

describe('o PARE e a denúncia ficam gravados na conta, mesmo com a IA da Carla parada', () => {
  const frasesDeParar: Array<[string, boolean]> = [
    ['PARE', false], ['não quero mais receber', false], ['chega de mensagem', false],
    ['isso é spam', true], ['vou no procon', true],
  ];

  it.each(frasesDeParar)('%j: grava as duas colunas da conta, sem despedida e sem excluir a conta', async (frase, denuncia) => {
    semearConta(); semearRetomada();
    await chegou(frase);
    expect(usuario()).toMatchObject({ whatsapp_opt_out: true, email_opt_out: true });
    expect(banco.linhas('users')).toHaveLength(1);        // a Giovanna antiga apagava a conta grátis; o corte não
    calada();
    // A denúncia entra também na supressão (o envio da Carla lê a supressão, não a coluna); o pedido de parar sem denúncia NÃO,
    // para a despedida da Carla poder sair (a supressão dele fica a cargo do nao_incomodar dela).
    if (denuncia) {
      expect(supressoes()).toHaveLength(1);
      expect(supressoes()[0]).toMatchObject({ phone: X, motivo: 'denuncia', user_deletado: false });
    } else {
      expect(supressoes()).toHaveLength(0);
    }
  });

  it('com a gravação da coluna falhando: o erro é logado e a Giovanna segue calada', async () => {
    semearConta(); semearRetomada();
    // A 1ª escrita em users é o whatsapp_replied_at; a 2ª, a do opt-out, é a que falha.
    banco.falhas['users.update'] = { erro: { code: '57014', message: 'timeout' }, pular: 1, uma: true };
    await chegou('PARE');
    expect(h.logErro).toHaveBeenCalledWith('whatsapp', 'opt-out na retomada da Carla não gravou', expect.anything());
    calada();
  });

  it('"não tenho interesse" nenhum dos três padrões pega: nada é gravado e a conversa segue com a Carla', async () => {
    semearConta(); semearRetomada();
    await chegou('não tenho interesse');
    expect(usuario()).toMatchObject({ whatsapp_opt_out: false, email_opt_out: false });
    expect(supressoes()).toHaveLength(0);
    calada();
  });
});

describe('quando o corte NÃO vale, a Giovanna responde como hoje', () => {
  it('posse em passou_humano ou nao_incomodar: continua calada (a conversa é de gente, ou a pessoa pediu para parar)', async () => {
    for (const estado of ['passou_humano', 'nao_incomodar']) {
      banco.reset(); h.create.mockClear(); h.sendHuman.mockClear(); semearAlvo([], { carla: 'todos' });
      semearConta(); semearRetomada({ estado });
      await chegou('oi');
      calada();
    }
  });

  it('posse encerrada: a Giovanna responde', async () => {
    semearConta(); semearRetomada({ estado: 'encerrada' });
    await chegou('oi, preciso de ajuda com a proposta');
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.sendHuman).toHaveBeenCalled();
  });

  it('posse vencida (30 dias passaram): a Giovanna responde', async () => {
    semearConta(); semearRetomada({ ate: new Date(Date.now() - DIA).toISOString() });
    await chegou('oi, preciso de ajuda com a proposta');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('assinante com a posse da retomada: a Giovanna responde (o suporte de quem paga é dela)', async () => {
    semearConta('ilimitado'); semearRetomada();
    await chegou('minha proposta não gera');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('a linha do SolarDoc segue como hoje: o corte é só da linha io', async () => {
    semearConta(); semearRetomada();
    await chegou('oi, preciso de ajuda com a proposta', 'solardoc');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('posse sem a origem da retomada (Carla de lead): a Giovanna responde como hoje', async () => {
    semearConta(); semearRetomada({ origem: null });
    await chegou('oi, preciso de ajuda com a proposta');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('posse da retomada de outra dona (não é da Carla): a Giovanna responde como hoje', async () => {
    semearConta(); semearRetomada({ dona: 'duda' });
    await chegou('oi, preciso de ajuda com a proposta');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('sem a Carla atendendo todos (modo teste): o corte não vale e a Giovanna responde', async () => {
    banco.reset(); semearAlvo([], { carla: 'teste' }); zerarCacheInterruptores();
    semearConta(); semearRetomada();
    await chegou('oi, preciso de ajuda com a proposta');
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
