import { describe, it, expect, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O GATILHO DA OFERTA DE HORÁRIOS.
//
// `querRemarcar` é o que decide se o cliente recebe três horários na hora ou se
// a conversa vai pro humano. Duas direções de erro, e elas não são simétricas:
//
//   · não reconhecer  → o cliente avisa que não dá e, em vez da lista, leva
//                       "é agora! o consultor já está te esperando". Foi o que
//                       aconteceu com a ficha 1218, que escreveu exatamente
//                       "Vamos deixar pra amanhã" e não era coberta por padrão
//                       nenhum.
//   · reconhecer demais → quem CANCELOU ("não tenho mais interesse") recebe três
//                       horários. É pior: responde uma coisa que a pessoa não
//                       perguntou, logo depois de ela dizer que quer sair.
//
// Por isso o veto do RE_CANCELAR é testado com o mesmo cuidado que o gatilho.
// As frases são reais, de 30 dias de `wa_mensagens` da linha IO.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: () => {}, error: () => {}, warn: () => {} } }));
vi.mock('../services/agents/zapiClient', () => ({ sendHuman: async () => {}, sendWhatsApp: async () => {} }));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: async () => ({ pode: true, motivo: 'sem-pausa' }),
  registrarBloqueio: async () => {},
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({ dentroDoTetoHorarioLinha: async () => true }));
vi.mock('../services/io/eletropostoVagas', () => ({
  proximasVagas: async () => [], aindaLivre: async () => true, diaBRT: () => '',
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34991360223' } }));

import { querRemarcar } from '../services/io/eletropostoRemarcar';

describe('querRemarcar', () => {
  // ── o que DEVE virar oferta de horários ──────────────────────────────────
  const OFERECE = [
    // A família que faltava e que motivou esta mudança.
    'Vamos deixar pra amanhã',
    'Vamos deixar pra próxima',
    'Vamos deixar pra mais na frente',
    // Imprevisto, com e sem o typo que apareceu duas vezes na base.
    'Tive um imprevisto',
    'Hoje tive um emprevisto não vou conseguir',
    'Aconteceu imprevisto',
    // Participação.
    'Não vou poder participar',
    'Infelizmente não vou poder participar',
    'Não vou conseguir participar da reunião.',
    // As que já funcionavam, e que não podem quebrar.
    'Preciso remarcar',
    'Vamos remarcar',
    'Estou em reunião tem como remarcar',
    'Para outro dia',
    'Não vou poder',
    'Hoje não consigo',
    'nao posso hoje',
    'Hoje nao da',
  ];

  it.each(OFERECE)('oferece horários para: %s', (frase) => {
    expect(querRemarcar([frase])).toBe(true);
  });

  // ── o que NÃO pode virar oferta ──────────────────────────────────────────
  const NAO_OFERECE = [
    // Cancelou de verdade: vai pro humano, não recebe lista de horários.
    'Eu vou cancelar a reunião de hoje',
    'Cancela pra mim por favor',
    'quero desmarcar',
    'desisti',
    'Não tenho mais interesse',
    'não quero mais',
    // O veto vale mesmo quando a frase TAMBÉM pede pra remarcar: a segunda
    // metade é que manda, e o comentário do módulo diz isso desde antes.
    'não vai dar, quero cancelar',
    // Conversa comum, nada a ver com a reunião.
    'Sim',
    'ok',
    'Bom dia',
    'Quanto fica pra colocar mais 4placas',
    '',
  ];

  it.each(NAO_OFERECE)('NÃO oferece para: %s', (frase) => {
    expect(querRemarcar([frase])).toBe(false);
  });

  it('lê a leva inteira, não só a última mensagem', () => {
    // O cliente manda "Olá boa tarde" e depois "Não vou poder": a intenção está
    // na segunda, e o robô processa as duas juntas.
    expect(querRemarcar(['Olá boa tarde', 'Não vou poder'])).toBe(true);
    // E o cancelamento em QUALQUER uma desliga tudo.
    expect(querRemarcar(['preciso remarcar', 'na verdade pode cancelar'])).toBe(false);
  });

  it('aguenta lixo sem estourar', () => {
    for (const lixo of [[], [''], ['   '], [null as unknown as string]]) {
      expect(() => querRemarcar(lixo)).not.toThrow();
      expect(querRemarcar(lixo)).toBe(false);
    }
  });
});
