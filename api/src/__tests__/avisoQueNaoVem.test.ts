import { describe, it, expect, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// "ELE AVISOU QUE NÃO VEM" — o detector que corta os lembretes da agenda.
//
// Todas as frases deste arquivo são REAIS: saíram de `wa_mensagens` da linha IO
// numa varredura de 30 dias feita em 23/09/2026. Não invente frase nova aqui
// sem medir antes — o valor deste teste é justamente ele falar a língua do
// cliente de verdade, que escreve "nao posso hoje" sem acento e "Cancela" seco.
//
// Os dois lados custam caro e em direções opostas:
//   · deixar passar  → o cliente avisa que não vem e leva "é agora! o Diego já
//                      está te esperando" uma hora depois (8 de 10 casos medidos)
//   · pegar demais   → cala o lembrete de quem IA comparecer, e a pessoa perde a
//                      reunião por culpa nossa
// Por isso os falsos positivos abaixo são tão importantes quanto os positivos.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));
vi.mock('../services/agents/zapiClient', () => ({ sendHuman: async () => {}, sendWhatsApp: async () => {} }));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ dentroDoTetoHorarioLinha: async () => true }));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223' } }));

import { ehAvisoDeQueNaoVem } from '../services/io/eletropostoAgenda';

describe('avisou que não vem', () => {
  const DESMARCOU = [
    'Cancela',
    'Cancela pra mim por favor',
    'Eu vou cancelar a reunião de hoje',
    'Bom dia tudo bem?\nSurgiu um imprevisto aqui cancela a reunião por gentileza',
    'Hoje não consigo',
    'nao consigo hoje',
    'nao posso hoje',
    'Hoje nao da',
    'Hoje não vou conseguir',
    'Hoje tive um emprevisto não vou conseguir',
    'Não vou conseguir participar',
    'Não vou conseguir participar da reunião.',
    'Infelizmente não vou poder participar',
    'Não vou poder',
    'Tive um imprevisto',
    'Aconteceu imprevisto',
    'Imprevisto',
    'Preciso remarcar',
    'Precisamos remarcar',
    'Vamos remarcar',
    'Teremos que remarcar.',
    'Vou ter q remarcar',
    'Estou em reunião tem como remarcar',
    'Vamos deixar pra amanhã',
    'Vamos deixar pra próxima',
    'Para outro dia',
    'Oi Thiago, eu não vou poder ir, essa semana tá corrido aqui',
  ];

  it.each(DESMARCOU)('entende que desmarcou: %s', (frase) => {
    expect(ehAvisoDeQueNaoVem(frase)).toBe(true);
  });

  // ── o outro lado, que é o que faz a pessoa perder a reunião ───────────────
  const NAO_DESMARCOU = [
    // Está TENTANDO entrar. Calar o lembrete dele é o oposto do que se quer.
    'Não consigo ouvir audio',
    'não consigo abrir o link',
    'nao consigo acessar o link',
    // Não é sobre a reunião.
    'Eu gostaria de cancelar o cadastro da minha empresa não é o caso',
    'Mas tô recebendo email que vai cancelar',
    // O robô do outro lado. Ele não é cliente e não desmarcou nada.
    'Desculpe, não consigo ajudar com isso.',
    'Desculpe, mas não consigo ajudar com isso.',
    // Falsos positivos que a versão frouxa do regex pegava, medidos na base.
    'Quanto fica pra colocar mais 4placas',
    'Nesse valor nao da pra liberar nem mas 2 acessos',
    'Não consigo arrumar um eletricista para dar uma olhada na rede',
    // O caso mais comum de todos: a confirmação.
    'Sim',
    'ok',
    'Confirmado',
    '1',
    '',
    '   ',
  ];

  it.each(NAO_DESMARCOU)('NÃO trata como desmarcação: %s', (frase) => {
    expect(ehAvisoDeQueNaoVem(frase)).toBe(false);
  });

  it('aguenta lixo sem estourar', () => {
    for (const lixo of [null, undefined, 123, {}, []] as unknown[]) {
      expect(() => ehAvisoDeQueNaoVem(lixo as string)).not.toThrow();
      expect(ehAvisoDeQueNaoVem(lixo as string)).toBe(false);
    }
  });
});
