import { describe, it, expect } from 'vitest';
import { RE_PARE_TESTE } from '../services/io/blastRespostas';

// Este regex decide silenciar um número PARA SEMPRE. Errar pra qualquer lado é
// caro: deixar passar um "pare" custa uma denúncia; suprimir quem não pediu
// mata um lead que respondeu ao anúncio. A primeira versão tinha \b só na
// abertura e bloqueava "esse preço me parece alto".
describe('regex de pedido de parada', () => {
  const DEVE_SUPRIMIR = [
    'pare de me mandar',
    'pode parar',
    'para de mandar mensagem',
    'não quero receber',
    'nao quero',
    'sem interesse',
    'me tira dessa lista',
    'me exclui dessa lista',
    'remove ai',
    'quero descadastrar',
    'sair da lista por favor',
    'isso e spam',
    'vou denunciar',
    'vou bloquear',
  ];

  const NAO_PODE_SUPRIMIR = [
    'parece bom, me manda mais',
    'esse preco me parece alto',
    'a parede do galpao é de 200m2',
    'parabens pelo material',
    'quanto custa?',
    'me manda o link',
    'tenho interesse sim',
    'vou comparar com outro orçamento',
    'qual a garantia do painel?',
  ];

  for (const frase of DEVE_SUPRIMIR) {
    it(`suprime: "${frase}"`, () => expect(RE_PARE_TESTE.test(frase)).toBe(true));
  }
  for (const frase of NAO_PODE_SUPRIMIR) {
    it(`NÃO suprime: "${frase}"`, () => expect(RE_PARE_TESTE.test(frase)).toBe(false));
  }
});
