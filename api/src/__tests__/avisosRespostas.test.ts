import { describe, it, expect, vi } from 'vitest';

// O que se tranca aqui é um NÚMERO QUE A EQUIPE VAI LER na tela. Errar pra mais
// é pior que errar pra menos: "5 responderam" numa pauta que não converteu faz
// parar de insistir. Então cada caso abaixo é uma forma de inflar esse número.

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/io/ioSend', () => ({
  enviarZapiIO: vi.fn(), adquirirLockBlast: vi.fn(), liberarLockBlast: vi.fn(), MediaType: {},
}));

import { casarRespostas } from '../services/io/avisosTickService';

const envio = (phone: string, quando: string) => ({ phone, enviado_em: quando });
const fala = (telefone: string, quando: string, texto: string, nome?: string) =>
  ({ telefone, momment: quando, texto, chat_name: nome ?? null });

describe('casarRespostas', () => {
  it('conta quem falou DEPOIS de receber', () => {
    const r = casarRespostas(
      [envio('5511989437206', '2026-09-18T14:58:00Z')],
      [fala('5511989437206', '2026-09-18T15:17:00Z', 'Fale sobre essa oportunidade', 'Wellington')],
    );
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe('Wellington');
    expect(r[0].texto).toContain('oportunidade');
  });

  it('conversa ANTERIOR ao envio não é resposta', () => {
    // O caso que mais infla o número: a pauta cai em quem já falava com a gente.
    const r = casarRespostas(
      [envio('5511989437206', '2026-09-18T14:58:00Z')],
      [fala('5511989437206', '2026-09-18T09:00:00Z', 'bom dia, tudo certo?')],
    );
    expect(r).toHaveLength(0);
  });

  it('quem não respondeu não aparece', () => {
    const r = casarRespostas(
      [envio('5562991015952', '2026-09-17T22:38:00Z'), envio('5511989437206', '2026-09-18T14:58:00Z')],
      [fala('5511989437206', '2026-09-18T15:17:00Z', 'quero saber mais')],
    );
    expect(r.map(x => x.phone)).toEqual(['5511989437206']);
  });

  it('"Bom dia" não pode ser o que a tela mostra quando veio "quero saber" logo atrás', () => {
    // Caso real do Wellington, 18/09/2026: ele mandou o cumprimento e o assunto
    // no mesmo minuto. O horário é o da primeira (foi quando reagiu), o texto é
    // o da que diz alguma coisa.
    const r = casarRespostas(
      [envio('5511989437206', '2026-09-18T14:58:00Z')],
      [
        fala('5511989437206', '2026-09-18T15:17:31Z', 'Bom dia'),
        fala('5511989437206', '2026-09-18T15:17:45Z', 'Fale sobre essa oportunidade'),
      ],
    );
    expect(r).toHaveLength(1);
    expect(r[0].quando).toBe('2026-09-18T15:17:31Z');       // reagiu aqui
    expect(r[0].texto).toBe('Fale sobre essa oportunidade'); // disse isto
  });

  it('mensagem de dias depois não rouba o texto da reação', () => {
    const r = casarRespostas(
      [envio('5511989437206', '2026-09-18T14:58:00Z')],
      [
        fala('5511989437206', '2026-09-18T15:17:00Z', 'quero saber mais sobre o ponto'),
        fala('5511989437206', '2026-09-21T10:00:00Z', 'desculpa a demora, estava viajando e agora consigo falar'),
      ],
    );
    expect(r[0].texto).toBe('quero saber mais sobre o ponto');
  });

  it('cinco mensagens da mesma pessoa contam como UMA resposta, e vale a primeira', () => {
    const r = casarRespostas(
      [envio('5511989437206', '2026-09-18T14:58:00Z')],
      [
        fala('5511989437206', '2026-09-18T15:17:00Z', 'Fale sobre essa oportunidade'),
        fala('5511989437206', '2026-09-18T15:19:00Z', 'Recebi uma msg de vcs'),
        fala('5511989437206', '2026-09-18T15:20:00Z', 'ok'),
      ],
    );
    expect(r).toHaveLength(1);
    expect(r[0].texto).toContain('Fale sobre essa oportunidade');   // não o "ok"
  });

  it('o mesmo número escrito de outro jeito é a mesma pessoa', () => {
    // 55 + DDD + 9 na frente: o WhatsApp devolve as duas formas e contar duas
    // vezes dobraria o número na tela.
    const r = casarRespostas(
      [envio('553488041112', '2026-09-18T14:00:00Z')],
      [fala('5534988041112', '2026-09-18T14:30:00Z', 'tenho o ponto')],
    );
    expect(r).toHaveLength(1);
  });

  it('recebeu duas vezes: vale o PRIMEIRO envio, então a resposta do meio conta', () => {
    const r = casarRespostas(
      [envio('5511989437206', '2026-09-18T14:58:00Z'), envio('5511989437206', '2026-09-18T18:00:00Z')],
      [fala('5511989437206', '2026-09-18T15:17:00Z', 'me conta mais')],
    );
    expect(r).toHaveLength(1);
  });

  it('sem envio nenhum, ninguém responde', () => {
    expect(casarRespostas([], [fala('5511989437206', '2026-09-18T15:17:00Z', 'oi')])).toHaveLength(0);
  });
});
