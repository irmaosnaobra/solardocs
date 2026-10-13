import { describe, it, expect, vi } from 'vitest';

// Ordem do dono (11/10/2026, para a Helena): "marca mas não mostre que é vídeo, tem
// gente que não gosta, cita que será uma reunião". Em 13/10/2026 ele estendeu a todo
// lead de eletroposto. As seis mensagens da agenda (confirmação, bom dia, 1 hora,
// 5 minutos, remarcado e reagendado) dizem "reunião", dizem que o consultor chama no
// WhatsApp dele e NÃO dizem como a reunião acontece. O texto é um só, para qualquer
// origem de card: o ramo antigo com "vídeo" e "link" foi apagado.

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(), sendFrio: vi.fn(), sendWhatsApp: vi.fn(), solardocViaIo: () => false,
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => true),
  respeitaEspacamentoLinha: vi.fn(async () => true),
  rampaReconexaoVigente: vi.fn(async () => null),
  dentroDaJanelaDiurna: () => true,
  maxPorDia: () => 40,
  maxPorHora: () => 6,
}));

import { bolhasConfirmacao, bolhasManha, bolhas1h, bolhas5min } from '../services/io/eletropostoAgenda';
import { bolhasRemarcado } from '../services/io/eletropostoRemarcar';
import { bolhasReagendado } from '../services/io/eletropostoReagendaAuto';

const QUANDO = '2026-10-13T16:00:00.000Z';   // terça 13/10, 13h00 de Brasília
const ANTES = '2026-10-09T16:00:00.000Z';    // sexta 09/10, 13h00
const TEL = '5534991360172';
const FORMATO = /v[ií]deo|link|clicar|internet|apresenta[cç][aã]o/i;

const seis = (): Record<string, string[]> => ({
  confirmacao: bolhasConfirmacao('Irineu de Almeida', QUANDO, 'Diego', TEL),
  manha: bolhasManha('Irineu de Almeida', QUANDO, 'Diego', TEL),
  umaHora: bolhas1h('Irineu de Almeida', QUANDO, 'Diego', TEL),
  cincoMin: bolhas5min('Irineu de Almeida', QUANDO, 'Diego', TEL),
  remarcado: bolhasRemarcado('Irineu', QUANDO, ANTES, 'Diego', TEL),
  reagendado: bolhasReagendado('Irineu', ANTES, QUANDO, 'Diego', TEL, 1),
});
/** As mesmas seis, sem o telefone do consultor (o outro ramo de cada texto). */
const seisSemTelefone = (): Record<string, string[]> => ({
  confirmacao: bolhasConfirmacao('Irineu', QUANDO, null, null),
  manha: bolhasManha('Irineu', QUANDO, null, null),
  umaHora: bolhas1h('lead', QUANDO, 'Diego', null),
  cincoMin: bolhas5min('lead', QUANDO, null, null),
  remarcado: bolhasRemarcado('', QUANDO, ANTES, 'Diego', ''),
  reagendado: bolhasReagendado('', ANTES, QUANDO, 'Diego', null, 99),
});

describe('toda reunião de eletroposto: nenhuma das seis mensagens diz como a reunião acontece', () => {
  for (const [nome, fonte] of [['com o telefone do consultor', seis], ['sem o telefone do consultor', seisSemTelefone]] as const) {
    it(`${nome}: nada de vídeo, link, clicar, internet nem apresentação`, () => {
      for (const [funcao, bolhas] of Object.entries(fonte())) {
        expect(bolhas.length, funcao).toBeGreaterThan(0);
        for (const b of bolhas) expect(b, `${funcao}: ${b}`).not.toMatch(FORMATO);
      }
    });
  }

  it('continua dizendo o essencial: é uma reunião, com quem, quando, e que ele chama no WhatsApp dele', () => {
    const h = seis();
    expect(h.confirmacao![0]).toContain('Sua reunião com o *Diego* está confirmada');
    expect(h.confirmacao![0]).toContain('Na hora, ele te chama');
    expect(h.confirmacao![0]).toContain('Responde *SIM* que eu travo o horário');
    expect(h.manha![0]).toContain('ele te chama no WhatsApp dele');
    expect(h.umaHora![0]).toContain('Falta *1 hora*');
    expect(h.umaHora![0]).toContain('salva o contato e fica de olho lá');
    expect(h.cincoMin![0]).toContain('Ele vai te chamar no WhatsApp dele');
    expect(h.remarcado![0]).toContain('Ele te chama no WhatsApp dele');
    expect(h.reagendado![0]).toContain('Você não conseguiu participar da reunião do eletroposto');
    expect(h.reagendado![1]).toContain('Ele te chama no WhatsApp dele');
  });

  it('o número de bolhas de cada função não mudou (1, 1, 1, 1, 1 e 3)', () => {
    const h = seis();
    expect(Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.length]))).toEqual({
      confirmacao: 1, manha: 1, umaHora: 1, cincoMin: 1, remarcado: 1, reagendado: 3,
    });
  });

  it('a confirmação, letra por letra', () => {
    expect(seis().confirmacao![0]).toBe(
      'Oi, Irineu! Aqui é da *NEXUS Eletropostos*. Sua reunião com o *Diego* está confirmada: '
      + '*terça-feira, 13/10 às 13h00* (Brasília). Na hora, ele te chama pelo WhatsApp do *Diego*, o *(34) 99136-0172*.\n\n'
      + 'Responde *SIM* que eu travo o horário. Se precisar desmarcar, me avisa antes que eu remarco: '
      + 'a procura está alta e o horário fica bloqueado.',
    );
  });
});
