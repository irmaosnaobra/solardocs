import { describe, it, expect, vi } from 'vitest';

// Os carimbos dos robôs de agenda que a Helena lê antes do claim (1.6). A decisão é pura; os prefixos são conferidos com o
// export real de cada robô, porque a Helena não importa os módulos de envio deles.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  motivoDeCeder, PREFIXO_REAGENDA_AUTO, PREFIXO_FUP_NAO_ATENDIDO, PREFIXO_LIBERADO_SIM, janelaDoReagendaDias, janelaDoFollowupDias, RETORNO_RECENTE_DIAS,
} from '../services/io/investidorAgenteCede';
import { RESERVA_DA_FICHA } from '../services/io/investidorAgenteAvisos';
import { EP_REAGENDA_PREFIX, maxVoltas } from '../services/io/eletropostoReagendaAuto';
import { EP_FUP_NAOATENDIDO_PREFIX } from '../services/io/eletropostoNaoAtendidoFup';
import { EP_LIBERADO_PREFIX } from '../services/io/eletropostoCobraSim';
import { FICHA_HELENA_PREFIX } from '../services/io/investidorAgente';

const AGORA = Date.parse('2026-11-12T15:00:00Z');
const DIA = 86_400_000;
const card = (id: number, status: string, diasAtras: number, origem = 'lp_eletroposto') =>
  ({ id, status, quando: new Date(AGORA - diasAtras * DIA).toISOString(), created_by: origem });

describe('a Helena cede aos robôs de agenda', () => {
  it('os prefixos e os números são os dos robôs', () => {
    expect(PREFIXO_REAGENDA_AUTO).toBe(EP_REAGENDA_PREFIX);
    expect(PREFIXO_FUP_NAO_ATENDIDO).toBe(EP_FUP_NAOATENDIDO_PREFIX);
    expect(PREFIXO_LIBERADO_SIM).toBe(EP_LIBERADO_PREFIX);
    expect(RESERVA_DA_FICHA).toBe(FICHA_HELENA_PREFIX);
    expect(maxVoltas()).toBe(3);
    expect(janelaDoReagendaDias()).toBe(21);
    expect(janelaDoFollowupDias()).toBe(2);
    expect(RETORNO_RECENTE_DIAS).toBe(8);
  });

  it('a) nao_atendeu fora do lote, reunião de até 21 dias, abaixo de 3 voltas: cede; 3 voltas, lote, 22 dias ou outro status: não', () => {
    const voltas = (n: number) => [{ key: `${EP_REAGENDA_PREFIX}1`, value: { n }, updated_at: null }];
    expect(motivoDeCeder([card(1, 'nao_atendeu', 5)], [], AGORA)).toBe('reagenda_com_voltas');
    expect(motivoDeCeder([card(1, 'nao_atendeu', 5)], voltas(2), AGORA)).toBe('reagenda_com_voltas');
    expect(motivoDeCeder([card(1, 'nao_atendeu', 5)], voltas(3), AGORA)).toBeNull();
    expect(motivoDeCeder([card(1, 'nao_atendeu', 22)], [], AGORA)).toBeNull();
    expect(motivoDeCeder([card(1, 'nao_atendeu', 5, 'cadastro_eletroposto')], [], AGORA)).toBeNull();
    expect(motivoDeCeder([card(1, 'cancelado', 5)], [], AGORA)).toBeNull();
  });

  it('b) escada aberta (passo sem :lista) SÓ cede com o card ainda nao_atendeu, fora do lote e dentro da janela do follow-up (2 dias)', () => {
    const k = (resto: string) => ({ key: `${EP_FUP_NAOATENDIDO_PREFIX}${resto}`, value: {}, updated_at: null });
    const sem3Voltas = { key: `${EP_REAGENDA_PREFIX}9`, value: { n: 3 }, updated_at: null };   // o reagenda já largou: só a escada decide
    expect(motivoDeCeder([card(9, 'nao_atendeu', 1)], [k('9:r1'), sem3Voltas], AGORA)).toBe('escada_do_followup_aberta');
    // r1 solto, sem a :lista, de um card que não está mais nao_atendeu: NÃO prende a pessoa.
    expect(motivoDeCeder([card(9, 'cancelado', 1)], [k('9:r1'), sem3Voltas], AGORA)).toBeNull();
    expect(motivoDeCeder([card(9, 'agendado', 1)], [k('9:r1'), sem3Voltas], AGORA)).toBeNull();
    // nao_atendeu fora da janela de 2 dias: o robô nem olha mais o card, a :lista pode nunca chegar.
    expect(motivoDeCeder([card(9, 'nao_atendeu', 3)], [k('9:r1'), sem3Voltas], AGORA)).toBeNull();
    // Lote e outro produto não contam.
    expect(motivoDeCeder([card(9, 'nao_atendeu', 1, 'cadastro_eletroposto')], [k('9:r1')], AGORA)).toBeNull();
    expect(motivoDeCeder([card(9, 'nao_atendeu', 1, 'lp_solar')], [k('9:r1')], AGORA)).toBeNull();
    // Com a :lista a escada acabou.
    expect(motivoDeCeder([card(9, 'nao_atendeu', 1)], [k('9:r1'), k('9:r2'), k('9:lista'), sem3Voltas], AGORA)).toBeNull();
    // Sem card lido, o r1 sozinho não prende.
    expect(motivoDeCeder([], [k('9:r1')], AGORA)).toBeNull();
  });

  it('as janelas vêm do ambiente como nos robôs (EP_REAGENDA_JANELA_DIAS e EP_FUP_NAOATENDIDO_DIAS)', () => {
    const antes = { ...process.env };
    try {
      process.env.EP_REAGENDA_JANELA_DIAS = '30';
      expect(motivoDeCeder([card(1, 'nao_atendeu', 25)], [], AGORA)).toBe('reagenda_com_voltas');
      process.env.EP_FUP_NAOATENDIDO_DIAS = '5';
      const k = { key: `${EP_FUP_NAOATENDIDO_PREFIX}9:r1`, value: {}, updated_at: null };
      const tres = { key: `${EP_REAGENDA_PREFIX}9`, value: { n: 3 }, updated_at: null };
      expect(motivoDeCeder([card(9, 'nao_atendeu', 4)], [k, tres], AGORA)).toBe('escada_do_followup_aberta');
    } finally { process.env = antes; }
  });

  it('c) retorno com menos de 8 dias cede; com mais, não', () => {
    const lib = (dias: number) => [{ key: `${EP_LIBERADO_PREFIX}9`, value: {}, updated_at: new Date(AGORA - dias * DIA).toISOString() }];
    expect(motivoDeCeder([], lib(7), AGORA)).toBe('retorno_recente');
    expect(motivoDeCeder([], lib(9), AGORA)).toBeNull();
  });

  it('sem nada com a pessoa: pode chamar', () => {
    expect(motivoDeCeder([card(1, 'cancelado', 40)], [], AGORA)).toBeNull();
  });
});
