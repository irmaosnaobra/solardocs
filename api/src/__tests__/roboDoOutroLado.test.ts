import { describe, it, expect } from 'vitest';
import { pareceRoboDeles, nossaRespostaJaDesconfiou } from '../services/agents/whatsapp/roboDoOutroLado';

// Todas as frases deste arquivo são MENSAGENS REAIS, tiradas de wa_mensagens em
// 25/08/2026 (amostra aleatória de inbound de 20 dias + a conversa da Luz Energy
// que originou a mudança). O teste que importa não é o de detectar robô — é o de
// NÃO detectar gente: falso positivo aqui emudece cliente pagante por 12h.

describe('robô do outro lado — gente NUNCA pode ser calada', () => {
  const GENTE_DE_VERDADE = [
    'Atualmente estou pagando em torno de 400 reais',
    'Bom dia, Irmãos nas obras. não vou concluir a compra nesse momento.',
    'O Salar Doc tem suporte para sistemas híbridos e off-grid?',
    'Tem as ruas toda com iluminação',
    'Minha conta não passa de 120',
    'Estas são as últimas duas contas',
    'Praça das bandeiras 174 bairro bandeirantes contagem mg',
    'Podemos marcar pra amanhã no mesmo horário',
    'Vi o anúncio do eletroposto no Instagram',
    'tenho interesse nos eletropostos',
    'Assim que sair mando um oi pra vcs',
    'Meu acesso agora é somente pelo vilsonprimo@gmail.com né',
    'Vou acessar e fazer uma proposta',
    'Certo, já conseguiram arrumar?',
    'Devo trocar ele por um de 112 kva',
    'O terreno não tem energia.',
    'Sim mais com vcs só as placas',
    'Diz que minha conta é grátis e não é liberado para outras funções',
    'Assim que der me retorna por gentileza',
    'Parabéns 🙏🏻🚀 Mais uma etapa concluída.',
    'Se não é muita gente pra gerir',
    'Tem outra nas partes investimento  Aonde colocar desconto vc coloca desaparece  o preço  do projeto',
    'lá na empresa a gente usa a belenus pra comprar os materiais geralmente',
    'Olá! Estou usando o SolarDoc Pro e preciso de ajuda.',
    'Queria saber como funciona',
    'Consegue esse retorno antes das 17h ?',
    'Tentei entrat aqui mas o link esta indisponivel',
    'E me passa as condições desse valor parcelado tbm como fica',
    'Bom dia! Tudo bem? O consumo fica em torno de R$550,00 e R$650,00',
    'Boa tarde! Tudo bem? Essa uma das unidades da rede postos gasolina na Capital SP.',
    'Só tenho a area.  Quero apenas o orçamento',
    'Podemos marcar pra amanhã no mesmo horário',
    // O caso perigoso: integrador falando do cliente DELE. Não pode ser calado.
    'meu cliente tem interesse em energia solar, consigo gerar a proposta aqui?',
    'o cliente pediu informações sobre energia solar, dá pra mandar pelo app?',
    'estou à disposição pra qualquer coisa, obrigado',
  ];

  for (const t of GENTE_DE_VERDADE) {
    it(`não cala: "${t.slice(0, 52)}"`, () => {
      expect(pareceRoboDeles(t).nivel).toBe('nenhum');
    });
  }
});

describe('robô do outro lado — o que TEM que ser cortado', () => {
  // Certeza: cala 12h.
  const CERTEZA = [
    ['Desculpe, mas não posso ajudar com esse tipo de mensagem. Se precisar de informações sobre energia solar ou orçamentos, estou à disposição! 😊', 'Luz Energy, 1a msg'],
    ['Oi! Sou o assistente da BR Solar 👋 Vi que você demonstrou interesse em energia solar. Qual é o principal motivo que te trouxe até aqui?', 'BR Solar'],
    ['Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.', 'recado de ausência'],
    ['Encaminhei sua mensagem para nossa equipe. Alguém falará com você em breve.', 'autoresponder de triagem'],
    ['Olá, sou a assistente virtual da empresa, como vai?', 'assistente virtual'],
  ];
  for (const [t, nome] of CERTEZA) {
    it(`cala 12h (${nome})`, () => {
      expect(pareceRoboDeles(t).nivel).toBe('certeza');
    });
  }

  // Suspeita: pula a resposta, sem calar.
  const SUSPEITA = [
    ['Caso você ou alguém que conheça tenha interesse em nossas soluções de energia solar para reduzir custos, estou à disposição para tirar dúvidas ou fazer um orçamento. Como posso ajudar hoje?', 'bot de captação solar'],
    ['Pode sim!   Manda sua pergunta sobre a Maquininha Smart ou sobre os pagamentos que te ajudo rapidinho 😉', 'bot da Stone'],
  ];
  for (const [t, nome] of SUSPEITA) {
    it(`pula a resposta (${nome})`, () => {
      expect(pareceRoboDeles(t).nivel).toBe('suspeita');
    });
  }
});

describe('quando a própria Giovanna desconfia, aquela é a última', () => {
  it('pega a frase real que ela escreveu e depois ignorou 3x', () => {
    expect(nossaRespostaJaDesconfiou('Parece que estou falando com um sistema automático de vocês — sem problema nenhum!')).toBe(true);
  });
  it('pega a segunda variação da mesma conversa', () => {
    expect(nossaRespostaJaDesconfiou('Entendido! Parece que é um sistema automático de vocês. Quando o Lucas precisar de suporte com o SolarDoc, é só chamar aqui. 👋')).toBe(true);
  });
  it('não dispara numa resposta normal dela', () => {
    expect(nossaRespostaJaDesconfiou('Oi, Ana Clara! Sou a Giovanna, da SolarDoc Pro. Posso te ajudar com algo na plataforma hoje?')).toBe(false);
  });
  it('não dispara falando de automação do PRODUTO', () => {
    expect(nossaRespostaJaDesconfiou('O SolarDoc gera a proposta automática em segundos, quer ver?')).toBe(false);
  });
});
