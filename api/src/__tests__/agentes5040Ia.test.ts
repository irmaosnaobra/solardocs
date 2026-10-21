import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nunca chamada real: se alguma coisa tentar criar o cliente de verdade, o teste quebra.
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));

import {
  perguntarAgente, pensar, montarPedido, classificarFalhaIA, MODELO_PRINCIPAL, MODELO_RESERVA, type ClienteIA,
} from '../services/agentes5040/ia';
import { schemaSaidaAgente, lerSaida, type ContextoLead, type PersonaDef } from '../services/agentes5040/tipos';
import { msg, conversaDoLead } from './_agentes5040Util';

const persona: PersonaDef = {
  persona: 'duda',
  sistemaFixo: 'SISTEMA FIXO DE TESTE',
  fatos: () => 'FATO-DO-LEAD-123',
  acoes: ['continuar', 'passar'],
};

const dadoBom = (bolhas: string[], extra: Record<string, unknown> = {}) => ({
  bolhas, acao: 'continuar', peca: null, dados: [{ chave: 'cidade', valor: 'Uberaba' }], resumo: 'r', sabe_contexto: true, ...extra,
});
const resposta = (saida: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text: typeof saida === 'string' ? saida : JSON.stringify(saida) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 5 },
  ...extra,
});

/** Cliente falso: cada create tira o próximo item da fila (função, erro ou resposta). */
function falso(fila: Array<unknown>) {
  const chamadas: any[] = [];
  const cliente: ClienteIA = {
    messages: {
      create: async (body: any) => {
        chamadas.push(body);
        const item = fila.shift();
        if (item instanceof Error) throw item;
        return item;
      },
    },
  };
  return { cliente, chamadas };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

describe('ia: a chamada', () => {
  it('system[0] leva o bloco fixo com cache de 1 hora; os fatos NÃO entram no system', async () => {
    const f = falso([resposta(dadoBom(['Oi, tudo bem?']))]);
    const r = await perguntarAgente({ persona, pedido: 'Pedido com FATO-DO-LEAD-123 dentro', cliente: f.cliente });
    expect(r.saida?.bolhas).toEqual(['Oi, tudo bem?']);
    const body = f.chamadas[0];
    expect(body.model).toBe(MODELO_PRINCIPAL);
    expect(body.system).toHaveLength(1);
    expect(body.system[0]).toMatchObject({ type: 'text', text: 'SISTEMA FIXO DE TESTE', cache_control: { type: 'ephemeral', ttl: '1h' } });
    expect(JSON.stringify(body.system)).not.toContain('FATO-DO-LEAD-123');
    expect(JSON.stringify(body.messages)).toContain('FATO-DO-LEAD-123');
  });

  it('saída por json_schema, sem thinking, sem repetição automática do SDK', async () => {
    const f = falso([resposta(dadoBom(['Oi.']))]);
    await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
    const body = f.chamadas[0];
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.properties.acao.enum).toEqual(['continuar', 'passar']);
    expect('thinking' in body).toBe(false);
  });

  it('o principal é o claude-opus-5-5 e a reserva é o claude-sonnet-5-5', () => {
    expect(MODELO_PRINCIPAL).toBe('claude-opus-5-5');
    expect(MODELO_RESERVA).toBe('claude-sonnet-5-5');
  });

  it('o dados volta como mapa (a lista chave/valor é convertida)', async () => {
    const f = falso([resposta(dadoBom(['Oi.']))]);
    const r = await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
    expect(r.saida?.dados).toEqual({ cidade: 'Uberaba' });
  });

  it('o uso soma entrada, cache criado, cache lido e saída', async () => {
    const f = falso([resposta(dadoBom(['Oi.']), { usage: { input_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 90, output_tokens: 3 } })]);
    const r = await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
    expect(r.uso).toEqual({ entrada: 7, cache_criado: 0, cache_lido: 90, saida: 3 });
  });

  it('mídia vai na mensagem do usuário, antes do pedido', async () => {
    const f = falso([resposta(dadoBom(['Oi.']))]);
    await perguntarAgente({
      persona, pedido: 'PEDIDO', cliente: f.cliente,
      midias: [{ msgId: 5, tipo: 'texto', texto: '(áudio transcrito) oi' }, { msgId: 6, tipo: 'imagem', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } }],
    });
    const conteudo = f.chamadas[0].messages[0].content;
    expect(conteudo.map((b: any) => b.type)).toEqual(['text', 'image', 'text']);
    expect(conteudo[2].text).toBe('PEDIDO');
  });
});

describe('ia: reserva', () => {
  it('erro no principal: a mesma pergunta vai ao claude-sonnet-5-5, também com json_schema', async () => {
    const f = falso([new Error('boom'), resposta(dadoBom(['Oi, tudo bem?']))]);
    const r = await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
    expect(r.saida?.bolhas).toEqual(['Oi, tudo bem?']);
    expect(r.modelo).toBe(MODELO_RESERVA);
    expect(f.chamadas.map(c => c.model)).toEqual([MODELO_PRINCIPAL, MODELO_RESERVA]);
    expect(f.chamadas[1].output_config.format.type).toBe('json_schema');
    expect('thinking' in f.chamadas[1]).toBe(false);
    expect(f.chamadas[1].system[0].cache_control.ttl).toBe('1h');
  });

  it('refusal, max_tokens e saída fora do formato também vão à reserva', async () => {
    for (const ruim of [
      resposta(dadoBom(['x']), { stop_reason: 'refusal' }),
      resposta(dadoBom(['x']), { stop_reason: 'max_tokens' }),
      resposta('isto não é json'),
      resposta(dadoBom(['x'], { acao: 'inventada' })),
    ]) {
      const f = falso([ruim, resposta(dadoBom(['Oi, tudo bem?']))]);
      const r = await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
      expect(r.modelo, JSON.stringify(ruim).slice(0, 60)).toBe(MODELO_RESERVA);
      expect(f.chamadas).toHaveLength(2);
    }
  });

  it('as duas falham: saida null e a causa', async () => {
    const f = falso([new Error('overloaded_error'), new Error('overloaded_error')]);
    const r = await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
    expect(r.saida).toBeNull();
    expect(r.causa).toBe('ia_limite');
  });

  it('crédito zerado ou chave recusada: sem reserva (é a mesma conta) e a causa aparece', async () => {
    const f = falso([new Error('Your credit balance is too low to access the Anthropic API')]);
    const r = await perguntarAgente({ persona, pedido: 'p', cliente: f.cliente });
    expect(r).toMatchObject({ saida: null, causa: 'ia_sem_credito' });
    expect(f.chamadas).toHaveLength(1);
    const g = falso([new Error('401 authentication_error')]);
    expect((await perguntarAgente({ persona, pedido: 'p', cliente: g.cliente })).causa).toBe('ia_chave');
  });

  it('classificarFalhaIA', () => {
    expect(classificarFalhaIA('429 rate_limit')).toBe('ia_limite');
    expect(classificarFalhaIA('algo')).toBe('outro');
  });
});

describe('ia: pensar (trava, uma reescrita, e cala)', () => {
  const conv = conversaDoLead();
  const trava = { completa: true };

  it('fala limpa: uma chamada só', async () => {
    const f = falso([resposta(dadoBom(['Em qual cidade você mora?']))]);
    const r = await pensar({ persona, pedido: 'P', conv, trava, cliente: f.cliente });
    expect(r.falou).toBe(true);
    expect(f.chamadas).toHaveLength(1);
  });

  it('barrou na primeira, passou na reescrita: o recado leva o motivo e o uso soma as duas', async () => {
    const f = falso([resposta(dadoBom(['Oi \u{1F600}'])), resposta(dadoBom(['Oi, tudo bem?']))]);
    const r = await pensar({ persona, pedido: 'PEDIDO-ORIGINAL', conv, trava, cliente: f.cliente });
    expect(r).toMatchObject({ falou: true });
    if (r.falou) {
      expect(r.saida.bolhas).toEqual(['Oi, tudo bem?']);
      expect(r.reescrita?.join()).toMatch(/emoji/);
      expect(r.uso.entrada).toBe(20);
    }
    expect(f.chamadas).toHaveLength(2);
    const recado = JSON.stringify(f.chamadas[1].messages);
    expect(recado).toContain('PEDIDO-ORIGINAL');
    expect(recado).toContain('emoji');
  });

  it('quebrou de novo: UMA reescrita só e a agente não fala', async () => {
    const f = falso([resposta(dadoBom(['Oi \u{1F600}'])), resposta(dadoBom(['Oi \u{1F600}'])), resposta(dadoBom(['Oi, tudo bem?']))]);
    const r = await pensar({ persona, pedido: 'P', conv, trava, cliente: f.cliente });
    expect(r.falou).toBe(false);
    if (!r.falou) expect(r.motivo).toMatch(/emoji.*na reescrita.*emoji/);
    expect(f.chamadas).toHaveLength(2);
  });

  it('sem contexto (sabe_contexto=false) ou histórico incompleto: não fala e não gasta reescrita', async () => {
    const f = falso([resposta(dadoBom(['Oi.'], { sabe_contexto: false }))]);
    const r = await pensar({ persona, pedido: 'P', conv, trava, cliente: f.cliente });
    expect(r.falou).toBe(false);
    expect(f.chamadas).toHaveLength(1);
    // Histórico incompleto é conferido ANTES de chamar o modelo: zero chamadas.
    const g = falso([resposta(dadoBom(['Oi, tudo bem?']))]);
    const r2 = await pensar({ persona, pedido: 'P', conv, trava: { completa: false }, cliente: g.cliente });
    expect(r2.falou).toBe(false);
    if (!r2.falou) expect(r2.motivo).toMatch(/histórico incompleto/);
    expect(g.chamadas).toHaveLength(0);
    const h = falso([resposta(dadoBom(['Oi, tudo bem?']))]);
    await pensar({ persona, pedido: 'P', conv, trava: { completa: undefined as unknown as boolean }, cliente: h.cliente });
    expect(h.chamadas).toHaveLength(0);
  });

  it('IA fora do ar: não fala e devolve a causa (para o disjuntor de quem chama)', async () => {
    const f = falso([new Error('credit balance is too low')]);
    const r = await pensar({ persona, pedido: 'P', conv, trava, cliente: f.cliente });
    expect(r).toMatchObject({ falou: false, causa: 'ia_sem_credito' });
  });

  it('as regras da persona valem (Duda não dá preço)', async () => {
    const f = falso([resposta(dadoBom(['Sai por R$ 20 mil.'])), resposta(dadoBom(['Posso pedir pra Nilce te ligar?']))]);
    const r = await pensar({ persona, pedido: 'P', conv, trava, cliente: f.cliente });
    expect(r.falou).toBe(true);
    expect(f.chamadas).toHaveLength(2);
  });
});

describe('ia: pedido e schema', () => {
  it('o pedido leva a conversa com carimbo de Brasília e os fatos da persona', () => {
    const ctx = { msgs: [msg('lead', 'Oi', { momment: '2026-10-20T15:30:00Z' })], completa: true } as unknown as ContextoLead;
    const p = montarPedido(persona, ctx);
    expect(p).toContain('[20/10 12:30] Cliente: Oi');
    expect(p).toContain('FATO-DO-LEAD-123');
  });

  it('o schema é estrito: nenhum objeto aberto, peca aceita null, acao é enum', () => {
    const s: any = schemaSaidaAgente(['a', 'b']);
    const abertos: string[] = [];
    const varre = (n: any, caminho: string) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'object' && n.additionalProperties !== false) abertos.push(caminho);
      for (const [k, v] of Object.entries(n)) varre(v, `${caminho}.${k}`);
    };
    varre(s, 'raiz');
    expect(abertos).toEqual([]);
    expect(s.properties.peca.anyOf.some((x: any) => x.type === 'null')).toBe(true);
    expect(s.properties.acao.enum).toEqual(['a', 'b']);
    expect(s.required).toEqual(['bolhas', 'acao', 'peca', 'dados', 'resumo', 'sabe_contexto']);
  });

  it('lerSaida rejeita sem corrigir', () => {
    expect(lerSaida('{}').ok).toBe(false);
    expect(lerSaida(JSON.stringify(dadoBom(['x'], { peca: { tipo: 'video', id: 'a' } }))).ok).toBe(false);
    expect(lerSaida(JSON.stringify(dadoBom(['x'], { acao: 'z' })), ['a']).ok).toBe(false);
    expect(lerSaida(JSON.stringify(dadoBom(['x'], { peca: { tipo: 'link', id: 'a' } }))).ok).toBe(true);
  });
});
