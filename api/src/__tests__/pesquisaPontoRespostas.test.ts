import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pareceMensagemDoLead, avisoDeResposta } from '../services/io/pesquisaPontoRespostas';

// O QUE ESTE TESTE SEGURA (22/09/2026)
//
// A régua do SIM liberou 18 horários às 14h50 e avisou cada pessoa. Minutos
// depois a equipe recebeu "RESPONDEU A PESQUISA DO PONTO — Respondeu (sem texto
// legível)" de quatro leads que não tinham escrito nada: era a NOSSA mensagem
// mexendo na conversa e o polling lendo movimento como resposta. Um deles virou
// três avisos. Aqui ficam as duas peças que impedem a volta disso.

describe('quem escreveu foi o lead?', () => {
  it('texto na última mensagem é prova (o /chats não devolve o texto do que a gente manda)', () => {
    expect(pareceMensagemDoLead('quero remarcar', false)).toBe(true);
    expect(pareceMensagemDoLead('  ok  ', false)).toBe(true);
  });

  it('sem texto, vale o recebimento registrado pela recepção', () => {
    expect(pareceMensagemDoLead(null, true)).toBe(true);
    expect(pareceMensagemDoLead('', true)).toBe(true);
  });

  it('sem texto e sem recebimento é o eco do nosso próprio envio', () => {
    expect(pareceMensagemDoLead(null, false)).toBe(false);
    expect(pareceMensagemDoLead('   ', false)).toBe(false);
    expect(pareceMensagemDoLead(undefined, false)).toBe(false);
  });
});

describe('o aviso diz o que aconteceu com a reunião', () => {
  const base = { telefone: '5534999735521', nome: 'Flávio', origem: 'reuniao' as const };

  it('sem texto, o aviso não diz "respondeu" — diz que veio mídia', () => {
    const msg = avisoDeResposta({ ...base, contexto: 'Última reunião: 22/09, 17:00 com Thiago — CANCELADA (não confirmou e perdeu o horário). Ponto: definido.' }, null);
    expect(msg).toContain('ESCREVEU NA LINHA');
    expect(msg).toContain('Mandou áudio, foto ou figurinha');
    expect(msg).not.toContain('PESQUISA DO PONTO');
    expect(msg).toContain('CANCELADA');
    expect(msg).toContain('Thiago');
    expect(msg).toContain('wa.me/5534999735521');
  });

  it('com texto, mostra o que a pessoa disse', () => {
    const msg = avisoDeResposta({ ...base, contexto: 'Ficha da LP que não virou reunião.' }, 'consigo amanhã de manhã');
    expect(msg).toContain('Disse: "consigo amanhã de manhã"');
  });
});

describe('o polling só age quando o lead escreveu', () => {
  const poller = readFileSync(join(__dirname, '../services/agents/sdr/sdrIoPolling.ts'), 'utf8');

  it('a trava vem ANTES dos avisos e do lead novo', () => {
    const trava = poller.indexOf('pareceMensagemDoLead(chat.lastMessage');
    expect(trava, 'a trava sumiu do polling').toBeGreaterThan(0);
    expect(trava).toBeLessThan(poller.indexOf('respostaPendenteRepescagem(phone)'));
    expect(trava).toBeLessThan(poller.indexOf('respostaDeCampanhaPonto(phone)'));
    expect(trava).toBeLessThan(poller.indexOf('handleSdrLead(phone, FRASE_PADRAO_ANUNCIO'));
  });

  it('o aviso de quem já está na base sai uma vez por dia', () => {
    expect(poller).toContain('`campanha:${phone}:${new Date().toISOString().slice(0, 10)}`');
  });
});
