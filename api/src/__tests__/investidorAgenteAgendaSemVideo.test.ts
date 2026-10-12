import { describe, it, expect, vi } from 'vitest';

// Ordem do dono (11/10/2026): "marca mas não mostre que é vídeo, tem gente que não
// gosta, cita que será uma reunião". As seis mensagens da agenda que falavam de
// vídeo, link, clicar ou internet ganharam uma variante para o card da Helena
// (created_by 'agente_eletroposto'). Aqui se provam as duas metades:
//   · para o card dela, nenhuma bolha das seis diz como a reunião acontece;
//   · para qualquer outro card, o texto é o de antes, sem mudar um caractere.

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
import { ehCardDaHelena } from '../services/agenda/origemEtiqueta';

const QUANDO = '2026-10-13T16:00:00.000Z';   // terça 13/10, 13h00 de Brasília
const ANTES = '2026-10-09T16:00:00.000Z';    // sexta 09/10, 13h00
const TEL = '5534991360172';
const HELENA = 'agente_eletroposto';
const FORMATO = /v[ií]deo|link|clicar|internet/i;

/** As seis funções, com a origem do card como último argumento. */
const seis = (origem?: string | null): Record<string, string[]> => ({
  confirmacao: bolhasConfirmacao('Irineu de Almeida', QUANDO, 'Diego', TEL, origem),
  manha: bolhasManha('Irineu de Almeida', QUANDO, 'Diego', TEL, origem),
  umaHora: bolhas1h('Irineu de Almeida', QUANDO, 'Diego', TEL, origem),
  cincoMin: bolhas5min('Irineu de Almeida', QUANDO, 'Diego', TEL, origem),
  remarcado: bolhasRemarcado('Irineu', QUANDO, ANTES, 'Diego', TEL, origem),
  reagendado: bolhasReagendado('Irineu', ANTES, QUANDO, 'Diego', TEL, 1, origem),
});
/** As mesmas seis, sem o telefone do consultor (o outro ramo de cada texto). */
const seisSemTelefone = (origem?: string | null): Record<string, string[]> => ({
  confirmacao: bolhasConfirmacao('Irineu', QUANDO, null, null, origem),
  manha: bolhasManha('Irineu', QUANDO, null, null, origem),
  umaHora: bolhas1h('lead', QUANDO, 'Diego', null, origem),
  cincoMin: bolhas5min('lead', QUANDO, null, null, origem),
  remarcado: bolhasRemarcado('', QUANDO, ANTES, 'Diego', '', origem),
  reagendado: bolhasReagendado('', ANTES, QUANDO, 'Diego', null, 99, origem),
});

describe('quem é card da Helena', () => {
  it('só a origem exata dela; as outras de eletroposto não', () => {
    expect(ehCardDaHelena('agente_eletroposto')).toBe(true);
    expect(ehCardDaHelena(' AGENTE_ELETROPOSTO ')).toBe(true);
    for (const o of ['lp_eletroposto', 'manychat_eletroposto', 'prosp_eletroposto', 'convite_investidor_eletroposto', 'lp_solar', '', null, undefined]) {
      expect(ehCardDaHelena(o), String(o)).toBe(false);
    }
  });
});

describe('card da Helena: nenhuma das seis mensagens diz como a reunião acontece', () => {
  for (const [nome, fonte] of [['com o telefone do consultor', seis], ['sem o telefone do consultor', seisSemTelefone]] as const) {
    it(`${nome}: nada de vídeo, link, clicar ou internet`, () => {
      for (const [funcao, bolhas] of Object.entries(fonte(HELENA))) {
        expect(bolhas.length, funcao).toBeGreaterThan(0);
        for (const b of bolhas) expect(b, `${funcao}: ${b}`).not.toMatch(FORMATO);
      }
    });
  }

  it('continua dizendo o essencial: é uma reunião, com quem, quando, e que ele chama no WhatsApp dele', () => {
    const h = seis(HELENA);
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
    // O número de bolhas é o mesmo do texto de sempre.
    const padrao = seis('lp_eletroposto');
    for (const k of Object.keys(h)) expect(h[k]!.length, k).toBe(padrao[k]!.length);
  });
});

describe('qualquer outro card: o texto de antes, sem mudar um caractere', () => {
  it('com lp_eletroposto, com outra origem de eletroposto e sem origem nenhuma o texto é o mesmo', () => {
    const semOrigem = seis();
    for (const origem of ['lp_eletroposto', 'manychat_eletroposto', 'prosp_eletroposto', null, '']) {
      expect(seis(origem), String(origem)).toEqual(semOrigem);
      expect(seisSemTelefone(origem), String(origem)).toEqual(seisSemTelefone());
    }
  });

  it('e esse texto é, letra por letra, o que saía antes desta mudança', () => {
    expect(seis('lp_eletroposto')).toMatchInlineSnapshot(`
      {
        "cincoMin": [
          "Irineu, é agora! Sua reunião começa às *13h00* e o *Diego* já está te esperando. O link cai no WhatsApp dele, *(34) 99136-0172* a qualquer momento: é só clicar e entrar. Se demorar uns minutos, não desiste: a reunião de antes costuma esticar quando o cliente fecha.",
        ],
        "confirmacao": [
          "Oi, Irineu! Aqui é da *NEXUS Eletropostos*. Sua reunião com o *Diego* está confirmada: *terça-feira, 13/10 às 13h00* (Brasília). É por vídeo e o link chega pelo WhatsApp do *Diego*, o *(34) 99136-0172*.

      Responde *SIM* que eu travo o horário. Se precisar desmarcar, me avisa antes que eu remarco: a procura está alta e o horário fica bloqueado.",
        ],
        "manha": [
          "Bom dia, Irineu! Hoje é o dia: sua reunião de eletroposto é *13h00*, com o *Diego*, e o link chega no WhatsApp dele, *(34) 99136-0172*. Se não der mais, me fala agora que eu remarco: a procura está alta e o horário fica bloqueado.",
        ],
        "reagendado": [
          "Oi, Irineu! Aqui é da *NEXUS Eletropostos*. Você não conseguiu entrar na apresentação do eletroposto de sexta, 09/10 às 13h00 — sem problema, acontece.",
          "Já separei outro pra você: *terça, 13/10 às 13h00* (Brasília), com o *Diego*. É por vídeo e o link chega no WhatsApp dele, o *(34) 99136-0172*.",
          "Me responde *SIM* que eu travo o horário. Se não der nesse dia, me fala qual fica melhor que eu troco.",
        ],
        "remarcado": [
          "Pronto, Irineu! Sua reunião agora é *terça-feira, 13/10 às 13h00*, com o *Diego*. Já liberei o horário de sexta, 09/10 às 13h00 pra outra pessoa. O link continua chegando no WhatsApp dele, o *(34) 99136-0172*, e eu te lembro no dia.",
        ],
        "umaHora": [
          "Oi, Irineu! Falta *1 hora*: sua reunião com o *Diego* é às *13h00*, por vídeo. O link cai pelo WhatsApp do *Diego*, o *(34) 99136-0172*, fica de olho lá e separa um canto com internet.

      Se ele atrasar uns minutos, segura aí: a reunião de antes costuma esticar quando o cliente fecha. Se está de pé, responde *SIM*. Se aconteceu um imprevisto, me avisa que eu remarco.",
        ],
      }
    `);
  });

  it('o texto de sempre continua falando do vídeo e do link (a mudança é só para o card da Helena)', () => {
    const p = seis('lp_eletroposto');
    expect(p.confirmacao![0]).toContain('É por vídeo e o link chega');
    expect(p.manha![0]).toContain('o link chega no WhatsApp dele');
    expect(p.umaHora![0]).toContain('por vídeo');
    expect(p.umaHora![0]).toContain('separa um canto com internet');
    expect(p.cincoMin![0]).toContain('é só clicar e entrar');
    expect(p.remarcado![0]).toContain('O link continua chegando no WhatsApp dele');
    expect(p.reagendado![0]).toContain('Você não conseguiu entrar na apresentação do eletroposto');
    expect(p.reagendado![1]).toContain('É por vídeo e o link chega no WhatsApp dele');
  });
});
