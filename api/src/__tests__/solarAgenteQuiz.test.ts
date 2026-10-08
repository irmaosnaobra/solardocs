import { describe, it, expect, vi } from 'vitest';

// Só as partes puras da agente: o que vai para a IA e o que volta dela.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../services/agents/zapiClient', () => ({ sendHuman: vi.fn(), sendWhatsApp: vi.fn() }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: vi.fn() }));
vi.mock('../services/io/solarRespostas', () => ({ INSTANCE_ID_IO: 'INSTANCIA_TESTE' }));

import { telKey, montarSistema, montarPedido, lerSaida, bolhasDe, ehCurioso, type ContextoLead } from '../services/io/solarAgenteQuiz';

const CTX: ContextoLead = {
  nome: 'Roberto Lima',
  cidade: 'Catalão',
  caminho: 'vistoria',
  quem: 'Diego',
  quandoIso: '2026-10-13T09:30:00-03:00',
  confirmou: false,
  status: 'agendado',
  respostas: ['Consumo: De R$ 2.000 a R$ 5.000', 'Urgência: O quanto antes'],
};

describe('a chave do telefone', () => {
  it('DDD + 8 últimos, com ou sem 55, com ou sem o 9, com sufixo do WhatsApp', () => {
    expect(telKey('5534991360223')).toBe('3491360223');
    expect(telKey('34991360223')).toBe('3491360223');
    expect(telKey('553491360223')).toBe('3491360223');
    expect(telKey('5534991360223@c.us')).toBe('3491360223');
    expect(telKey('12345')).toBeNull();
  });
});

describe('de quem é a conversa', () => {
  it('curioso não é conversa da agente (08/10: nós não falamos com ele)', () => {
    expect(ehCurioso([{ name: 'Caminho', values: ['curioso'] }, { name: 'Pontos', values: ['12'] }])).toBe(true);
    expect(ehCurioso([{ name: 'Caminho', values: ['ligacao'] }])).toBe(false);
    expect(ehCurioso(null)).toBe(false);
  });
});

describe('o que a IA recebe', () => {
  it('sabe quem atende, quando, se confirmou e as respostas', () => {
    const s = montarSistema(CTX);
    expect(s).toContain('Quem atende o cliente: Diego');
    expect(s).toMatch(/Horário marcado: .*13\/10 às 09h30/);
    expect(s).toContain('Já confirmou presença: ainda não');
    expect(s).toContain('Consumo: De R$ 2.000 a R$ 5.000');
    expect(s).toContain('NUNCA informe preço');
    expect(s).toContain('não se apresente de novo');
  });
  it('não marcou: sem horário, e a frase de "quem atende" não fica pela metade', () => {
    const s = montarSistema({ ...CTX, caminho: 'nao_marcou', quem: null, quandoIso: null, status: null });
    expect(s).toContain('não escolheu horário');
    expect(s).not.toContain('Horário marcado');
    expect(s).not.toContain('Já confirmou');
    expect(s).toContain('quem atende traz o estudo');
  });
  it('a conversa vai em ordem, mídia vira etiqueta e linha vazia some', () => {
    const p = montarPedido(
      [{ from_me: true, texto: 'Oi, Roberto!', tipo: 'texto', momment: '1' }, { from_me: false, texto: '', tipo: 'texto', momment: '2' }],
      [{ from_me: false, texto: null, tipo: 'imagem', momment: '3' }, { from_me: false, texto: 'Mandei a conta', tipo: 'texto', momment: '4' }],
    );
    expect(p).toContain('Nós: Oi, Roberto!');
    expect(p).not.toContain('Cliente: \n');
    expect(p).toMatch(/Cliente: \[imagem\]\nCliente: Mandei a conta$/);
  });
});

describe('o que volta da IA', () => {
  it('lê o JSON mesmo embrulhado em texto e troca ação desconhecida por "nada"', () => {
    expect(lerSaida('Claro: {"resposta":"Combinado.","acao":"confirmou","resumo":"Confirmou."} fim'))
      .toEqual({ resposta: 'Combinado.', acao: 'confirmou', resumo: 'Confirmou.' });
    expect(lerSaida('{"resposta":"x","acao":"fechar_venda","resumo":""}')?.acao).toBe('nada');
    expect(lerSaida('sem json')).toBeNull();
    expect(lerSaida('{quebrado')).toBeNull();
  });
  it('no máximo duas bolhas, sem travessão', () => {
    expect(bolhasDe('Pode sim — o Diego leva o estudo. || Até lá! || Terceira')).toEqual(['Pode sim, o Diego leva o estudo.', 'Até lá!']);
    expect(bolhasDe('')).toEqual([]);
    expect(bolhasDe('  ||  ')).toEqual([]);
  });
});
