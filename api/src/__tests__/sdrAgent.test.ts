import { describe, it, expect, vi } from 'vitest';

// Mock modules with side effects before importing the target
vi.mock('../utils/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../utils/metaPixel', () => ({ sendMetaEvent: vi.fn() }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p,
  sendHuman: vi.fn(),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn().mockResolvedValue({ content: [{ text: 'Olá! [ESTAGIO:novo]' }] }) } },
}));

import { extractEstagio, extractLeadInfo } from '../services/agents/sdr/sdrAgentService';

describe('extractEstagio', () => {
  it('extracts estagio from tag', () => {
    const { estagio, text } = extractEstagio('Oi tudo bem? [ESTAGIO:morno]');
    expect(estagio).toBe('morno');
    expect(text).toBe('Oi tudo bem?');
  });

  it('returns novo when tag is missing', () => {
    const { estagio } = extractEstagio('Olá, qual seu nome?');
    expect(estagio).toBe('novo');
  });

  it('strips tag from text', () => {
    const { text } = extractEstagio('Agendado! [ESTAGIO:quente]');
    expect(text).not.toContain('[ESTAGIO:');
  });

  it('is case insensitive', () => {
    const { estagio } = extractEstagio('[ESTAGIO:PERDIDO]');
    expect(estagio).toBe('perdido');
  });
});

describe('extractLeadInfo', () => {
  it('extracts city from "sou de"', () => {
    const info = extractLeadInfo([{ role: 'user', content: 'sou de Uberlândia' }]);
    expect(info.cidade).toBe('uberlândia'); // function lowercases input before matching
  });

  it('extracts consumo from "conta"', () => {
    const info = extractLeadInfo([{ role: 'user', content: 'conta 800 reais' }]);
    expect(info.consumo).toBe('800');
  });

  it('detects aumento_carga when "piscina" mentioned', () => {
    const info = extractLeadInfo([{ role: 'user', content: 'quero instalar uma piscina' }]);
    expect(info.aumento_carga).toBe(true);
  });

  it('returns undefined when no info found', () => {
    const info = extractLeadInfo([{ role: 'user', content: 'oi' }]);
    expect(info.cidade).toBeUndefined();
    expect(info.consumo).toBeUndefined();
    expect(info.aumento_carga).toBeUndefined();
  });
});
