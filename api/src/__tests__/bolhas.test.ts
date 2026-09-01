import { describe, it, expect } from 'vitest';
import { emBolhas, porBarras } from '../services/agents/bolhas';
import { gerarPixCopiaECola } from '../utils/pixBrCode';

// O que este teste protege: nenhum humano recebe parede de texto, e NADA é
// truncado no caminho (um Pix copia-e-cola cortado = pagamento que falha calado).

const semEspaco = (s: string): string => s.replace(/\s+/g, '');

describe('emBolhas', () => {
  it('frase curta continua UMA bolha', () => {
    expect(emBolhas('Bora fechar?')).toEqual(['Bora fechar?']);
  });

  it('vazio/nulo não vira bolha em branco', () => {
    expect(emBolhas('')).toEqual([]);
    expect(emBolhas(null)).toEqual([]);
    expect(emBolhas('   ||  || ')).toEqual([]);
  });

  it('respeita o || do autor e nunca junta o que ele separou', () => {
    expect(emBolhas('Oi Thiago || Tudo certo?')).toEqual(['Oi Thiago', 'Tudo certo?']);
  });

  it('parágrafo gigante sem || vira várias bolhas, no fim de frase', () => {
    const parede =
      'Thiago, vi que você cadastrou e parou no começo da configuração da empresa. ' +
      'A plataforma monta proposta com payback e contrato com a sua marca em uns dois minutos. ' +
      'Isso costuma encurtar bastante o tempo entre a visita e a assinatura do cliente. ' +
      'Faz sentido testar sete dias grátis pra ver funcionando na prática?';

    // Com teto de 5 esta parede cabia em bolhas de 160. Com teto de 2 (baixado em
    // 31/08/2026 porque o WhatsApp conta BOLHA e o robô gastava 3,78 por toque) a
    // válvula precisa juntar, e junta acima de 160 DE PROPÓSITO: o módulo nunca
    // trunca, e bolha grande é menos pior que metralhadora. O que continua
    // inegociável é não perder texto, e é isso que a última linha guarda.
    const bolhas = emBolhas(parede);
    expect(bolhas.length).toBeGreaterThan(1);
    expect(bolhas.length).toBeLessThanOrEqual(2);
    expect(semEspaco(bolhas.join(' '))).toBe(semEspaco(parede));

    // Sem o teto apertando, o corte por tamanho continua valendo.
    for (const b of emBolhas(parede, { maxBolhas: 9 })) expect(b.length).toBeLessThanOrEqual(160);
  });

  it('template curto com linha em branco continua UMA bolha (link não desgruda)', () => {
    const msg = 'Tua conta tá pronta. Te mando o link pra você salvar:\n\n🔗 solardoc.app/auth';
    expect(emBolhas(msg)).toEqual([msg]);
  });

  it('bloco longo quebra na linha em branco', () => {
    const msg =
      'Quer instalar como app no celular? Em 1 toque vira ícone na tela:\n\n' +
      'iPhone: Safari, depois Compartilhar, depois Adicionar à Tela de Início.\n\n' +
      'Android: Chrome, depois os 3 pontinhos, depois Instalar app.\n\n' +
      'Tô aqui se travar em algo, é só chamar. Bom uso!';
    const bolhas = emBolhas(msg);
    expect(bolhas.length).toBeGreaterThan(1);
    expect(semEspaco(bolhas.join(' '))).toBe(semEspaco(msg));
  });

  it('teto vale pra MENSAGEM inteira, não por parte — nada de metralhadora', () => {
    // é assim que o sendHuman chama: as partes viram um texto só separado por ||
    const partes = Array.from({ length: 8 }, (_, i) => `Parágrafo ${i} do template, com um tanto de texto pra encher a bolha e forçar o teto a agir.`);
    const bolhas = emBolhas(partes.join('||'), { maxBolhas: 5 });
    expect(bolhas.length).toBeLessThanOrEqual(5);
    expect(semEspaco(bolhas.join(' '))).toBe(semEspaco(partes.join(' ')));
  });

  it('Pix copia-e-cola sai INTEIRO, mesmo passando do teto', () => {
    const pix = gerarPixCopiaECola({ valor: 67, txid: 'SOLARDOCVIP' });
    expect(emBolhas(pix)).toEqual([pix]);
    // teto absurdo de propósito: nem assim pode cortar (Pix cortado = venda perdida)
    expect(emBolhas(pix, { max: 40 })).toEqual([pix]);
  });

  it('Pix junto de texto: o código continua uma bolha só', () => {
    const pix = gerarPixCopiaECola({ valor: 19, txid: 'CURSO19' });
    const bolhas = emBolhas(`Toma o código aqui ó. || ${pix} || Me manda o comprovante que eu libero na hora!`);
    expect(bolhas).toContain(pix);
  });

  it('URL longa não é quebrada no meio', () => {
    const url = 'https://solardoc.app/checkout/recuperar?session=cs_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6';
    const bolhas = emBolhas(`Retomar leva 1 minutinho, é só clicar aqui. ${url}`);
    expect(bolhas.some(b => b.includes(url))).toBe(true);
  });

  it('não corta em abreviação nem em item numerado', () => {
    const texto =
      'Sr. Thiago, o passo a passo é rapidinho e cabe numa tarde de trabalho tranquila. ' +
      '1. Cadastre o CNPJ da empresa no menu Empresa. ' +
      '2. Suba a sua logo e a sua cor pra marca sair em tudo.';
    for (const b of emBolhas(texto)) {
      expect(b).not.toBe('Sr.');
      expect(b).not.toBe('1.');
      expect(b).not.toBe('2.');
    }
  });

  it('teto de bolhas segura a metralhadora (nada some)', () => {
    const muitas = Array.from({ length: 12 }, (_, i) => `Frase número ${i} pra encher.`).join(' ');
    const bolhas = emBolhas(muitas, { maxBolhas: 3 });
    expect(bolhas.length).toBeLessThanOrEqual(3);
    expect(semEspaco(bolhas.join(' '))).toBe(semEspaco(muitas));
  });

  it('é idempotente enquanto o teto não estoura (bolha pronta não é refatiada)', () => {
    const bolhas = emBolhas('Oi! Tudo bem por aí? || Vi que você parou no cadastro do CNPJ, quer ajuda?');
    expect(bolhas.flatMap(b => emBolhas(b))).toEqual(bolhas);
  });

  it('porBarras respeita só a fronteira do autor (quem corta por tamanho é o sendHuman)', () => {
    const parede = 'Frase um bem comprida pra passar do teto de caracteres sozinha, com sobra. Frase dois igualmente comprida pra garantir que nada disso caiba numa bolha só.';
    expect(porBarras(`${parede} || ok`)).toEqual([parede, 'ok']);
    expect(porBarras('  ||  ')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Travessão nunca chega no cliente.
//
// A regra está escrita em três lugares do cérebro da Carla e ela escreveu
// "no envio do pix — isso é real" no primeiro teste da retomada. Regra de estilo
// que precisa valer 100% das vezes é código, não pedido ao modelo.
// ═══════════════════════════════════════════════════════════════════════════
describe('emBolhas: travessão', () => {
  it('travessão separando oração vira vírgula', () => {
    expect(emBolhas('foi falha nossa — sem justificativa')[0])
      .toBe('foi falha nossa, sem justificativa');
  });

  it('pega o travessão médio também', () => {
    expect(emBolhas('são R$ 67 – sem fidelidade')[0]).toBe('são R$ 67, sem fidelidade');
  });

  it('não inventa vírgula dupla quando já havia pontuação', () => {
    expect(emBolhas('entendi, — e agora?')[0]).not.toMatch(/,\s*,/);
  });

  it('hífen de palavra composta continua intacto', () => {
    // copia-e-cola, bem-vindo e afins não podem virar vírgula.
    expect(emBolhas('te mando o copia-e-cola, é bem-vindo')[0])
      .toBe('te mando o copia-e-cola, é bem-vindo');
  });

  it('o código do Pix atravessa sem ser tocado', () => {
    const pix = gerarPixCopiaECola({ valor: 67, txid: 'SOLARDOCVIP' });
    expect(emBolhas(`segue o código||${pix}`)).toContain(pix);
  });
});
