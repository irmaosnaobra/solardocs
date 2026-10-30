import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { motivoDePassagem, normalizarRajada } from '../services/agentes5040/passagemPorRegra';

// A passagem por regra: função pura. Terça 12:00 em Brasília (horário comercial) e sábado 12:00 (fora).
const COMERCIAL = new Date('2026-10-20T15:00:00.000Z');
const SABADO = new Date('2026-10-24T15:00:00.000Z');
const NOITE = new Date('2026-10-20T23:30:00.000Z');          // 20:30 em Brasília

const motivo = (t: string, persona: 'duda' | 'carla' | 'helena' = 'duda', agora: Date = COMERCIAL) => motivoDePassagem(t, persona, agora)?.motivo ?? null;

describe('dinheiro_de_volta: só PEDIDO', () => {
  it.each([
    'Quero o reembolso', 'quero meu reembolso agora', 'preciso de um estorno', 'vou pedir chargeback', 'chargeback',
    'Quero o meu dinheiro de volta', 'quero meu dinheiro de volta!', 'quero devolver o produto e quero o dinheiro de volta',
    'exijo meu dinheiro de volta', 'cadê o meu reembolso?', 'cade o estorno', 'cadê o meu dinheiro?',
    'devolvam o meu dinheiro', 'me devolvam o dinheiro', 'me devolve o meu dinheiro', 'preciso da devolução do meu dinheiro',
    'meu reembolso não chegou', 'pedi o reembolso e nada', 'solicito o estorno', 'quero pedir o reembolso', 'quero pedir estorno',
    'vou contestar a cobrança', 'quero contestar essa compra',
    // reclamação real com palavra de pré-venda mais longe do pedido
    'se vocês não resolverem quero meu dinheiro de volta', 'já tem 10 dias e quero meu reembolso', 'eu tenho direito e quero meu reembolso',
    // falsos negativos seguros
    'quero o valor de volta', 'me devolve o valor', 'devolvam o valor',
  ])('dispara: %s', t => expect(motivo(t)).toBe('dinheiro_de_volta'));

  it('vale para as três personas, de dia ou de noite', () => {
    for (const p of ['duda', 'carla', 'helena'] as const) {
      expect(motivo('quero reembolso', p, COMERCIAL)).toBe('dinheiro_de_volta');
      expect(motivo('quero reembolso', p, SABADO)).toBe('dinheiro_de_volta');
      expect(motivo('quero reembolso', p, NOITE)).toBe('dinheiro_de_volta');
    }
  });

  it.each([
    // pergunta de pré-venda, garantia e condição
    'se eu não gostar tem reembolso?', 'tem garantia de reembolso?', 'se eu cancelar tem estorno?', 'estorno no cartão?',
    'se não gostar tenho meu dinheiro de volta?', 'e se eu quiser meu dinheiro de volta?', 'posso pedir reembolso depois?', 'como faço pra pedir o reembolso?',
    'qual o prazo do reembolso?', 'existe reembolso?', 'reembolso', 'podem devolver meu dinheiro?', 'se eu devolver o produto vocês devolvem o dinheiro?', 'posso pedir reembolso depois', 'o estorno é em quantos dias?',
    // conta de luz não é nosso reembolso
    'quero contestar a cobrança da Cemig', 'vou contestar a cobrança da conta de luz', 'quero contestar a fatura de energia da concessionária',
  ])('não dispara: %s', t => expect(motivo(t)).toBeNull());
});

describe('juridico: só AMEAÇA em 1ª pessoa', () => {
  it.each([
    'vou no Procon', 'vou acionar o PROCON', 'vou processar vocês', 'vou processar a empresa', 'vou te processar', 'processar a empresa',
    'vou entrar na justiça', 'vamos entrar na justiça', 'vou levar isso na justiça', 'vamos colocar vocês na justiça', 'vou levar pra justiça', 'vou na justiça',
    'vou entrar com ação contra vocês', 'vou abrir uma ação judicial', 'vou ao juizado', 'vou no juizado de pequenas causas', 'juizado de pequenas causas',
    'vou postar no Reclame Aqui', 'vou reclamar no reclameaqui', 'já postei no Reclame Aqui', 'vou no consumidor.gov', 'consumidor.gov',
    // advogado, só a ameaça
    'meu advogado vai entrar com ação', 'meu advogado vai entrar com processo', 'minha advogada vai acionar vocês',
    'vou acionar o advogado', 'vou acionar meu advogado', 'vou acionar a justiça', 'vou tomar providências com meu advogado',
  ])('dispara: %s', t => expect(motivo(t)).toBe('juridico'));

  it('vale para qualquer persona e hora', () => {
    for (const p of ['duda', 'carla', 'helena'] as const) expect(motivo('vou no procon', p, SABADO)).toBe('juridico');
  });

  it.each([
    'o contrato passa pelo meu advogado antes de assinar', 'nosso advogado vai analisar o contrato', 'minha advogada me indicou vocês',
    'vou passar a proposta pro meu advogado analisar', 'meu advogado vai ler o contrato', 'meu advogado vai entrar na análise do contrato',
    'a Cemig está na justiça', 'meu vizinho entrou na justiça contra a Cemig', 'já vi gente na justiça por isso', 'ação judicial', 'acionar o advogado',
    'vou mostrar pro meu advogado', 'vou passar pro meu advogado dar uma olhada', 'vou levar pro meu advogado', 'vou mandar pro meu advogado',
    'vou passar isso pro meu advogado', 'vou enviar pro meu advogado',
    'vi vocês no Reclame Aqui, são bons', 'o reclame aqui tem boas notas de vocês', 'meu advogado', 'não vou entrar na justiça',
  ])('não dispara: %s', t => expect(motivo(t)).toBeNull());
});

describe('pessoa', () => {
  it.each([
    'quero falar com uma pessoa', 'Quero falar com um atendente', 'preciso falar com um humano', 'posso falar com alguém de verdade?',
    'quero falar com um vendedor', 'quero falar com uma vendedora', 'me passa para um atendente', 'pode me passar pra um atendente?',
    'me transfere para um humano', 'quero atendimento humano', 'atendimento humano', 'prefiro atendimento humano',
    'quero um atendente', 'preciso de um humano', 'quero falar com um ser humano', 'chama um atendente', 'quero ser atendido por um humano',
    'quero falar com uma pessoa de verdade', 'me coloca em contato com um atendente', 'atendente', 'humano', 'falar com uma pessoa',
    'quero falar com uma pessoa, por favor', 'quero falar com uma pessoa.', 'quero falar com o responsável', 'posso falar com o responsável?', 'quero falar com o responsável agora',
  ])('dispara (Duda, horário comercial): %s', t => expect(motivo(t)).toBe('pessoa'));

  it('só a Duda e só em horário comercial: Carla, Helena, noite e sábado deixam o modelo decidir', () => {
    expect(motivo('quero falar com um atendente', 'carla')).toBeNull();
    expect(motivo('quero falar com um atendente', 'helena')).toBeNull();
    expect(motivo('quero falar com um atendente', 'duda', SABADO)).toBeNull();
    expect(motivo('quero falar com um atendente', 'duda', NOITE)).toBeNull();
  });

  it('dinheiro e jurídico têm prioridade sobre o pedido de pessoa, e valem mesmo onde a pessoa não vale', () => {
    expect(motivo('quero falar com um atendente, vou no procon')).toBe('juridico');
    expect(motivo('quero falar com um atendente, quero reembolso')).toBe('dinheiro_de_volta');
    expect(motivo('quero falar com um atendente e quero o reembolso', 'carla')).toBe('dinheiro_de_volta');
  });
});

describe('negativos: nada disto dispara', () => {
  it.each([
    'qual o processo de instalação', 'como é o processo de homologação?', 'qual o processo?',
    'cancelar a reunião', 'quero cancelar a visita', 'cancelar',
    'sou advogado', 'sou advogada', 'trabalho com advocacia', 'meu cunhado é advogado',
    'devolver a ligação', 'pode me devolver a ligação?', 'devolve a ligação amanhã',
    'não quero falar com ninguém', 'nao quero falar com ninguem',
    'a pessoa que me atendeu foi ótima', 'o atendente foi ótimo', 'falei com uma pessoa ontem', 'já falei com um atendente',
    'vou falar com uma pessoa da minha família', 'vou falar com uma pessoa e te retorno', 'preciso falar com minha esposa',
    'posso passar o número pra uma pessoa da família?', 'você é uma pessoa de verdade?', 'você é humano?',
    // para depois, ou outra pessoa fala
    'posso falar com o vendedor depois?', 'quero falar com o vendedor amanhã', 'quero falar com um atendente mais tarde', 'quero falar com o vendedor semana que vem',
    'vou pedir pra minha esposa falar com a vendedora', 'minha esposa quer falar com o vendedor', 'vou falar com o vendedor depois', 'quero falar com o responsável outro dia',
    // negação do verbo
    'não preciso falar com atendente', 'não vou processar ninguém', 'não preciso de um humano',
    // conversa normal
    'quero saber o preço', 'minha conta de luz é R$ 280', 'ok, pode ser amanhã', 'obrigado', '',
  ])('%s', t => expect(motivo(t)).toBeNull());
});

describe('opt-out tem precedência', () => {
  it.each([
    'para de me mandar mensagem', 'nao quero mais, quero reembolso', 'sai da lista e vou no procon', 'não quero, quero falar com um atendente',
    'stop', 'nunca mais me chame, vou processar vocês',
  ])('devolve null: %s', t => expect(motivoDePassagem(t, 'duda', COMERCIAL)).toBeNull());
});

describe('o resultado', () => {
  it('traz o trecho que casou (curto) e normaliza acento, caixa e espaço', () => {
    const r = motivoDePassagem('  Quero   o  REEMBOLSO   do Pix ', 'carla', COMERCIAL)!;
    expect(r.motivo).toBe('dinheiro_de_volta');
    expect(r.trecho).toBe('quero o reembolso');
    expect(r.trecho.length).toBeLessThanOrEqual(60);
    expect(normalizarRajada(' Ação   JUDICIAL ')).toBe('acao judicial');
    expect(motivoDePassagem('vou entrar na JUSTIÇA', 'carla', COMERCIAL)).toMatchObject({ motivo: 'juridico' });
  });
});

describe('isolamento do arquivo', () => {
  it('não importa envio, banco nem rede', () => {
    const arq = join(__dirname, '..', 'services', 'agentes5040', 'passagemPorRegra.ts');
    expect(existsSync(arq)).toBe(true);
    const imports = [...readFileSync(arq, 'utf8').matchAll(/^import[^;]*from\s+'([^']+)'/gm)].map(m => m[1]!);
    expect(imports.sort()).toEqual(['./baseRegras', './relogio', './tipos', './trava']);
    for (const i of imports) expect(i).not.toMatch(/zapi|ioSend|vivoEnvio|fichaEnvio|agendaEnvio|baseEnvio|supabase|lineThrottle/i);
  });
});
