import { describe, it, expect } from 'vitest';

import { automacaoDoDestino } from '../services/instagram/fbComentarios';

// Recorte das automações reais (só o que a regra olha).
const AUTOS = [
  { id: 'eletro', link_url: 'https://solardoc.app/io/eletroposto?src=ig&utm_source=instagram' },
  { id: 'solar', link_url: 'https://solardoc.app/simular?utm_source=instagram&utm_medium=dm' },
  { id: 'kit', link_url: 'https://solardoc.app/kit?utm_source=instagram' },
  { id: 'bike', link_url: 'https://wa.me/5534998165040' },
  { id: 'menu', link_url: null },
];

describe('produto do anúncio manda no Facebook', () => {
  it('anúncio do eletroposto responde com a automação do eletroposto', () => {
    // O link do anúncio vem sem os utm que a automação tem — casa mesmo assim.
    expect(automacaoDoDestino('https://solardoc.app/io/eletroposto', AUTOS)?.id).toBe('eletro');
    expect(automacaoDoDestino('https://solardoc.app/kit', AUTOS)?.id).toBe('kit');
  });

  it('anúncio de produto sem automação aqui (LimpaPro) é PULADO, não vira menu', () => {
    // 9 dos 18 anúncios ativos da Página são LimpaPro. Responder com
    // "SOLAR / ELETROPOSTO / BIKE" seria falar de outro produto com quem
    // perguntou de limpeza de placa.
    expect(automacaoDoDestino('https://limpapro.solardoc.app/', AUTOS)).toBe('pular');
    expect(automacaoDoDestino('https://pay.kiwify.com.br/pEC1YJP', AUTOS)).toBe('pular');
  });

  it('anúncio de clique-pra-Messenger não diz o produto: cai no roteamento por palavra-chave', () => {
    expect(automacaoDoDestino('http://fb.me/', AUTOS)).toBeNull();
    expect(automacaoDoDestino('', AUTOS)).toBeNull();
    expect(automacaoDoDestino('https://m.me/irmaosnaobra', AUTOS)).toBeNull();
  });
});

describe('o destino mais específico ganha, não o primeiro da lista', () => {
  const SIMULACAO = { id: 'simulacao', link_url: 'https://solardoc.app/io/solar' };
  const SOLARDOC = { id: 'solardoc', link_url: 'https://solardoc.app' };

  it('solardoc.app/ vai para a SolarDoc, em qualquer ordem', () => {
    expect(automacaoDoDestino('https://solardoc.app/', [SIMULACAO, SOLARDOC])?.id).toBe('solardoc');
    expect(automacaoDoDestino('https://solardoc.app/', [SOLARDOC, SIMULACAO])?.id).toBe('solardoc');
  });

  it('link igual ganha; entre iguais, a primeira da lista', () => {
    const outra = { id: 'outra', link_url: 'https://solardoc.app/?utm_source=x' };
    expect(automacaoDoDestino('https://solardoc.app/io/solar', [SOLARDOC, SIMULACAO])?.id).toBe('simulacao');
    expect(automacaoDoDestino('https://solardoc.app', [outra, SOLARDOC])?.id).toBe('outra');
  });

  it('automação é prefixo do destino: o prefixo mais longo ganha', () => {
    const longa = { id: 'longa', link_url: 'https://solardoc.app/io' };
    const mais = { id: 'mais', link_url: 'https://solardoc.app/io/solar' };
    const d = 'https://solardoc.app/io/solar/obrigado';
    expect(automacaoDoDestino(d, [SOLARDOC, longa, mais])?.id).toBe('mais');
    expect(automacaoDoDestino(d, [mais, longa, SOLARDOC])?.id).toBe('mais');
  });

  it('destino é prefixo da automação: o link mais curto ganha', () => {
    const curta = { id: 'curta', link_url: 'https://solardoc.app/io/solar' };
    const comprida = { id: 'comprida', link_url: 'https://solardoc.app/io/solar/extra' };
    expect(automacaoDoDestino('https://solardoc.app/io', [comprida, curta])?.id).toBe('curta');
    expect(automacaoDoDestino('https://solardoc.app/io', [curta, comprida])?.id).toBe('curta');
  });

  it('sem automação do produto devolve pular; destino vazio devolve null', () => {
    expect(automacaoDoDestino('https://limpapro.solardoc.app/', [SIMULACAO, SOLARDOC])).toBe('pular');
    expect(automacaoDoDestino('', [SIMULACAO, SOLARDOC])).toBeNull();
  });
});
