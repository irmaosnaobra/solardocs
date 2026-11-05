import { describe, it, expect, vi, beforeEach } from 'vitest';

// O comprovante tratado na retomada da Carla (05/11/2026, conserto 1 do chefe-antiban):
//  · idDoComprovanteTratado: volta do fim da conversa, para na 1ª mensagem NOSSA e exige EXATAMENTE 1 imagem ou documento do lead nesse trecho;
//  · avancarAteWaIdDaRetomada: update condicional no banco (posse ainda da retomada, viva e `ate_wa_id` atual menor que o alvo);
//  · marcarComprovanteDaRetomadaAtendido junta as duas. Posse e banco são os REAIS em memória; a conversa é falsa.

const h = vi.hoisted(() => ({
  lerConversa: vi.fn(),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({ messages: { create: vi.fn() } }) }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p, sendHuman: vi.fn(), sendImage: vi.fn(), sendWhatsApp: vi.fn(), linhaEmCooldown: () => false,
}));
vi.mock('../utils/ofertaCupom', () => ({ ofertaCupomAtiva: async () => null, bolhasOferta: () => [] }));
vi.mock('../utils/pixBrCode', () => ({ gerarPixCopiaECola: () => '00020126PIXFALSO' }));
vi.mock('../utils/mediaProcessor', () => ({
  transcribeAudio: vi.fn(async () => null),
  downloadImageAsAnthropicSource: vi.fn(async () => null),
  downloadPdfAsAnthropicSource: vi.fn(async () => null),
}));
vi.mock('../services/agents/whatsapp/promoGeradorActivation', () => ({
  detectAndActivatePromoCredits: async () => ({ ativado: false, ja_ativado_antes: false }),
}));
vi.mock('../services/io/encaminharMidiaConsultor', () => ({ encaminharMidiaAoConsultor: vi.fn() }));
vi.mock('../services/agents/whatsapp/pixComprovanteService', () => ({
  tryProcessAbandonedPixComprovante: vi.fn(async () => false), tryProcessPixComprovante: vi.fn(async () => false),
}));
vi.mock('../services/agentes5040/contexto', async (orig) => ({ ...(await orig<typeof import('../services/agentes5040/contexto')>()), lerConversa: h.lerConversa }));

import { banco } from './_bancoFalso';
import { avancarAteWaIdDaRetomada, lerPosse } from '../services/agentes5040/posse';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import { idDoComprovanteTratado, marcarComprovanteDaRetomadaAtendido } from '../services/agents/whatsapp/whatsappAgentService';

const TEL = '5534991110001';
const CHAVE = chaveContato(TEL)!;

type Msg = { id: number; autor: 'lead' | 'robo' | 'equipe'; tipo: string };
const m = (id: number, autor: Msg['autor'], tipo = 'texto'): Msg => ({ id, autor, tipo });

function semearPosse(over: Record<string, unknown> = {}): void {
  banco.poe('whatsapp_sessions', {
    phone: CHAVE, tipo: 'ag5040',
    lead_data: {
      dona: 'carla', estado: 'viva', origem: 'retomada_usuarios', desde: '2026-11-05T17:00:00.000Z', ate_wa_id: 5, respostas: 1, imagens: [], links: [],
      retomada: { user_id: 'u1', ate: '2099-01-01T00:00:00.000Z' }, ...over,
    },
  });
}
const lead = (): Record<string, unknown> => banco.linhas('whatsapp_sessions').find(l => l.phone === CHAVE)!.lead_data as Record<string, unknown>;

beforeEach(() => { banco.reset(); h.lerConversa.mockReset(); });

describe('idDoComprovanteTratado: do fim, até a 1ª mensagem nossa, exatamente 1 imagem ou documento', () => {
  it('uma imagem depois da nossa última fala: é ela', () => {
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'image')])).toBe(2);
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'document')])).toBe(2);
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'imagem')])).toBe(2);
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'image'), m(3, 'lead', 'texto')])).toBe(2);      // um texto depois não atrapalha
  });

  it('imagem de ANTES da nossa última fala não conta (o trecho para na 1ª nossa, vindo do fim)', () => {
    expect(idDoComprovanteTratado([m(1, 'lead', 'image'), m(2, 'robo'), m(3, 'lead', 'texto')])).toBeNull();
    expect(idDoComprovanteTratado([m(1, 'lead', 'image'), m(2, 'equipe'), m(3, 'lead', 'image')])).toBe(3);
  });

  it('duas ou mais imagens ou documentos do lead no trecho: não dá para saber qual foi tratada (null)', () => {
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'image'), m(3, 'lead', 'image')])).toBeNull();
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'image'), m(3, 'lead', 'document')])).toBeNull();
    expect(idDoComprovanteTratado([m(2, 'lead', 'image'), m(3, 'lead', 'image'), m(4, 'lead', 'image')])).toBeNull();
  });

  it('nenhuma imagem, ou conversa vazia: null; sem nenhuma fala nossa, o trecho é a conversa inteira', () => {
    expect(idDoComprovanteTratado([])).toBeNull();
    expect(idDoComprovanteTratado([m(1, 'robo'), m(2, 'lead', 'texto')])).toBeNull();
    expect(idDoComprovanteTratado([m(1, 'lead', 'image')])).toBe(1);
    expect(idDoComprovanteTratado([m(1, 'lead', 'texto'), m(2, 'lead', 'image')])).toBe(2);
  });

  it('mensagem da equipe também é "nossa" e encerra o trecho', () => {
    expect(idDoComprovanteTratado([m(1, 'lead', 'image'), m(2, 'equipe')])).toBeNull();
  });
});

describe('avancarAteWaIdDaRetomada: update condicional', () => {
  it('avança o ate_wa_id quando a posse é da retomada, está viva e o atual é menor que o alvo', async () => {
    semearPosse({ ate_wa_id: 5 });
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(true);
    expect(lead().ate_wa_id).toBe(10);
    expect(lead()).toMatchObject({ dona: 'carla', estado: 'viva', origem: 'retomada_usuarios', respostas: 1 });       // o resto da posse não muda
  });

  it('ate_wa_id nulo avança; 9 para 10 avança (nada de comparar texto: "9" seria maior que "10")', async () => {
    semearPosse({ ate_wa_id: null });
    expect(await avancarAteWaIdDaRetomada(TEL, 7)).toBe(true);
    expect(lead().ate_wa_id).toBe(7);
    banco.reset(); semearPosse({ ate_wa_id: 9 });
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(true);
    expect(lead().ate_wa_id).toBe(10);
  });

  it('atual igual ou maior que o alvo: devolve true sem escrever nada e nunca recua o valor', async () => {
    semearPosse({ ate_wa_id: 20 });
    const antes = banco.escritas.length;
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(true);
    expect(await avancarAteWaIdDaRetomada(TEL, 20)).toBe(true);
    expect(banco.escritas.length).toBe(antes);
    expect(lead().ate_wa_id).toBe(20);
  });

  it('posse que não é da retomada, não está viva ou nem existe: false e nada muda', async () => {
    semearPosse({ origem: 'pedido_depoimento', ate_wa_id: 5 });
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(false);
    expect(lead().ate_wa_id).toBe(5);
    banco.reset(); semearPosse({ dona: 'duda', ate_wa_id: 5 });
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(false);
    for (const estado of ['encerrada', 'passou_humano', 'nao_incomodar']) {
      banco.reset(); semearPosse({ estado, ate_wa_id: 5 });
      expect(await avancarAteWaIdDaRetomada(TEL, 10), estado).toBe(false);
      expect(lead().ate_wa_id, estado).toBe(5);
    }
    banco.reset();
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(false);
    expect(await avancarAteWaIdDaRetomada('abc', 10)).toBe(false);
    expect(await avancarAteWaIdDaRetomada(TEL, Number.NaN)).toBe(false);
  });

  it('a Carla respondeu entre a leitura e a escrita (ate_wa_id mudou): não sobrescreve, false', async () => {
    semearPosse({ ate_wa_id: 5 });
    const p = avancarAteWaIdDaRetomada(TEL, 10);              // a leitura já correu; a escrita ainda não
    banco.linhas('whatsapp_sessions')[0]!.lead_data = { ...lead(), ate_wa_id: 12, respostas: 2 };
    expect(await p).toBe(false);
    expect(lead()).toMatchObject({ ate_wa_id: 12, respostas: 2 });
  });

  it('a posse virou outra coisa entre a leitura e a escrita (encerrada): não escreve por cima, false', async () => {
    semearPosse({ ate_wa_id: 5 });
    const p = avancarAteWaIdDaRetomada(TEL, 10);
    banco.linhas('whatsapp_sessions')[0]!.lead_data = { ...lead(), estado: 'encerrada' };
    expect(await p).toBe(false);
    expect(lead()).toMatchObject({ estado: 'encerrada', ate_wa_id: 5 });
  });

  it('erro de banco na escrita: false, sem lançar', async () => {
    semearPosse({ ate_wa_id: 5 });
    banco.falhas['whatsapp_sessions.update'] = { erro: { code: 'XX000', message: 'caiu' } };
    expect(await avancarAteWaIdDaRetomada(TEL, 10)).toBe(false);
    expect(lead().ate_wa_id).toBe(5);
  });

  it('lerPosse continua enxergando o valor novo', async () => {
    semearPosse({ ate_wa_id: 5 });
    await avancarAteWaIdDaRetomada(TEL, 10);
    expect((await lerPosse(TEL))?.ate_wa_id).toBe(10);
  });
});

describe('marcarComprovanteDaRetomadaAtendido (junta os dois)', () => {
  const conversa = (msgs: Msg[], completa = true) => h.lerConversa.mockResolvedValue({ msgs, completa });

  it('uma imagem depois da nossa fala: marca o id dela na posse', async () => {
    semearPosse({ ate_wa_id: 5 });
    conversa([m(4, 'robo'), m(8, 'lead', 'image')]);
    expect(await marcarComprovanteDaRetomadaAtendido(TEL)).toBe(true);
    expect(lead().ate_wa_id).toBe(8);
  });

  it('o comprovante antigo (antes da nossa fala) não vira o alvo: vale o novo, e o antigo não puxa o marcador para trás', async () => {
    semearPosse({ ate_wa_id: 5 });
    conversa([m(2, 'lead', 'image'), m(4, 'robo'), m(8, 'lead', 'image')]);
    expect(await marcarComprovanteDaRetomadaAtendido(TEL)).toBe(true);
    expect(lead().ate_wa_id).toBe(8);
  });

  it('duas imagens depois da nossa fala, ou nenhuma: não marca nada (a Carla responde), false', async () => {
    for (const msgs of [[m(4, 'robo'), m(8, 'lead', 'image'), m(9, 'lead', 'document')], [m(4, 'robo'), m(8, 'lead', 'texto')], [m(1, 'lead', 'image'), m(4, 'robo')]]) {
      banco.reset(); semearPosse({ ate_wa_id: 5 });
      conversa(msgs);
      expect(await marcarComprovanteDaRetomadaAtendido(TEL)).toBe(false);
      expect(lead().ate_wa_id).toBe(5);
    }
  });

  it('conversa incompleta, que lança, ou telefone que não é de pessoa: false', async () => {
    semearPosse({ ate_wa_id: 5 });
    conversa([m(4, 'robo'), m(8, 'lead', 'image')], false);
    expect(await marcarComprovanteDaRetomadaAtendido(TEL)).toBe(false);
    h.lerConversa.mockRejectedValue(new Error('caiu'));
    expect(await marcarComprovanteDaRetomadaAtendido(TEL)).toBe(false);
    expect(await marcarComprovanteDaRetomadaAtendido('abc')).toBe(false);
    expect(lead().ate_wa_id).toBe(5);
  });

  it('posse que deixou de ser da retomada: não marca', async () => {
    semearPosse({ estado: 'encerrada', ate_wa_id: 5 });
    conversa([m(4, 'robo'), m(8, 'lead', 'image')]);
    expect(await marcarComprovanteDaRetomadaAtendido(TEL)).toBe(false);
    expect(lead().ate_wa_id).toBe(5);
  });
});
