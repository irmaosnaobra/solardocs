import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// A MÁQUINA DE LEMBRETE DE FOLLOW-UP — E OS JEITOS DE ELA VIRAR RUÍDO.
//
// Ela manda "liga agora nesse cliente" no celular do consultor, um a cada 30
// minutos. O risco nunca é o envio: é o cerco.
//
//   · FALAR FORA DE HORA. 10h às 20h, sem domingo. Um "liga agora" às 3h da
//     manhã é o fim da credibilidade do robô no primeiro dia.
//   · REPETIR NO MESMO SLOT. O tick roda de ~2 em 2 minutos. Sem um número de
//     slot estável, o mesmo lembrete sai 15 vezes na mesma meia hora.
//   · LIGAR PRO CLIENTE ERRADO PRIMEIRO. Quem viu proposta e sumiu vale mais
//     que quem nunca atendeu. Se a fila inverte, a máquina gasta os 20 slots do
//     dia no que menos importa.
//   · INSISTIR PRA SEMPRE. Card teimoso que volta todo dia come todos os slots.
//   · MENTIR O TEMPO. "Parado há 3 dias" contado no relógio de parede é falso
//     na segunda de manhã: sexta 18h até segunda 10h é uma hora de trabalho.

import {
  slotAgora, pontuarCard, ultimoToque, contextoDoCard, esperaPorExtenso,
  montarLembrete, chaveSlot, chaveCard, telExibicao, ESTAGIOS_ABERTOS,
  ESTAGIOS_CICLO, dormindo, linhaDaEspera,
  type CardAberto, type Pausa,
} from '../services/io/lembreteFollowupService';

const card = (over: Partial<CardAberto> = {}): CardAberto => ({
  id: 1, vendedor_nome: 'Diego', cliente_nome: 'Paulo Sergio', cliente_telefone: '5534999887766',
  cidade: 'Uberlândia', status: 'fez_orcamento', temperatura: 'frio',
  quando: '2026-09-20T17:00:00Z', observacao: null, historico: null,
  created_at: '2026-09-01T12:00:00Z', proposta_em: null, apresentacao_em: null,
  lead_resposta_at: null, presenca_confirmada_at: null, confirmacao_at: null,
  ...over,
});

/** Um instante de Brasília escrito como UTC (o servidor roda em UTC, BRT é -3). */
const brt = (dia: string, hora: number, min = 0): Date =>
  new Date(`${dia}T${String(hora + 3).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);

describe('janela e slot', () => {
  // 29/09/2026 é uma terça-feira, e não é feriado.
  it('cala fora da janela de 10h às 20h', () => {
    expect(slotAgora(brt('2026-09-29', 9, 59)).ok).toBe(false);
    expect(slotAgora(brt('2026-09-29', 9, 59)).motivo).toBe('fora_da_janela');
    expect(slotAgora(brt('2026-09-29', 20, 0)).ok).toBe(false);
    expect(slotAgora(brt('2026-09-29', 3, 0)).ok).toBe(false);
  });

  it('fala dentro da janela', () => {
    expect(slotAgora(brt('2026-09-29', 10, 0)).ok).toBe(true);
    expect(slotAgora(brt('2026-09-29', 19, 59)).ok).toBe(true);
  });

  it('cala no domingo', () => {
    // 27/09/2026 é domingo.
    const r = slotAgora(brt('2026-09-27', 14, 0));
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('domingo');
  });

  it('cala em feriado nacional', () => {
    const r = slotAgora(brt('2026-12-25', 14, 0));
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('feriado');
  });

  // O CORAÇÃO DO ANTI-REPETIÇÃO. O tick chega de 2 em 2 minutos; tudo que cair
  // na mesma meia hora TEM que devolver o mesmo número, senão o carimbo não
  // segura nada e o consultor leva 15 bolhas iguais.
  it('dá o mesmo slot pra tudo dentro da mesma meia hora, e um novo na seguinte', () => {
    const a = slotAgora(brt('2026-09-29', 14, 0)).slot;
    const b = slotAgora(brt('2026-09-29', 14, 2)).slot;
    const c = slotAgora(brt('2026-09-29', 14, 29)).slot;
    const d = slotAgora(brt('2026-09-29', 14, 30)).slot;
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(d).toBe((a as number) + 1);
  });

  it('a janela inteira cabe em 20 slots', () => {
    expect(slotAgora(brt('2026-09-29', 10, 0)).slot).toBe(0);
    expect(slotAgora(brt('2026-09-29', 19, 30)).slot).toBe(19);
  });

  it('a chave do slot separa pessoa, dia e slot', () => {
    expect(chaveSlot('Diego', '2026-09-29', 7)).toBe('lembrete_slot:diego:2026-09-29:7');
    expect(chaveSlot('Diego', '2026-09-29', 7)).not.toBe(chaveSlot('Nilce', '2026-09-29', 7));
    expect(chaveCard(1287)).toBe('lembrete_card:1287');
  });
});

describe('a conta que escolhe o cliente da vez', () => {
  it('põe quem já viu proposta na frente de quem nunca atendeu', () => {
    const proposta = pontuarCard('proposta_apresentada', 'frio', 11);
    const naoAtendeu = pontuarCard('nao_atendeu', 'quente', 11);
    expect(proposta).toBeGreaterThan(naoAtendeu);
  });

  // 29/09/2026: A TEMPERATURA NÃO DECIDE MAIS NADA.
  //
  // Ordem do Thiago: "as colunas quente, morno e frio não têm necessidade, tem
  // que acompanhar os botões de status existentes". A temperatura é palpite
  // gravado uma vez no formulário; o status é o que alguém apertou DEPOIS de
  // falar com a pessoa. Quando discordam, quem sabe mais é o status.
  //
  // O teste é de indiferença, e ele é mais forte que um teste de ordem: prova que
  // nenhum valor de temperatura muda a nota, incluindo os que nem existem.
  it('a temperatura é indiferente para a nota, qualquer valor', () => {
    const base = pontuarCard('fez_orcamento', null, 11);
    for (const t of ['quente', 'morno', 'frio', 'QUENTE', '', null, 'inventado']) {
      expect(pontuarCard('fez_orcamento', t as string | null, 11)).toBe(base);
    }
  });

  it('quem nunca atendeu não passa na frente de quem viu proposta, nem sendo quente', () => {
    expect(pontuarCard('proposta_apresentada', 'frio', 11))
      .toBeGreaterThan(pontuarCard('nao_atendeu', 'quente', 11));
  });

  it('o tempo desempata mas não atropela o estágio', () => {
    const velhoFraco = pontuarCard('agendado', null, 11 * 15);       // parado 15 dias
    const novoForte = pontuarCard('proposta_apresentada', null, 11); // parado 1 dia
    expect(novoForte).toBeGreaterThan(velhoFraco);
    // e, no mesmo estágio, o mais parado sobe
    expect(pontuarCard('agendado', null, 110)).toBeGreaterThan(pontuarCard('agendado', null, 11));
  });

  it('status desconhecido não quebra a conta', () => {
    expect(Number.isFinite(pontuarCard('status_que_nao_existe', null, 0))).toBe(true);
  });

  it('a lista de estágios abertos não tem desfecho dentro', () => {
    // `arrendamento` SAIU desta lista em 30/09/2026 e virou estágio aberto: ele
    // é lead vivo (quem cede o ponto), não desfecho. Ver ESTAGIOS_ABERTOS.
    for (const morto of ['sem_interesse', 'perdido', 'fechou', 'fechou_concorrente', 'cancelado']) {
      expect(ESTAGIOS_ABERTOS as readonly string[]).not.toContain(morto);
    }
  });

  // ── O CICLO DE 48H (30/09/2026) ───────────────────────────────────────────
  // "Chave na mão, arrendamento, negociando, 50-50: volta sempre 48h depois,
  // pra gente fechar ou não fechar." O risco desta mudança é o card do
  // eletroposto cair no `?? 1` da pontuação e dormir no fim da fila justamente
  // por ser novo na lista.

  it('os quatro modelos do eletroposto entraram na varredura', () => {
    for (const vivo of ['arrendamento', 'carregador', 'meio_a_meio', 'chave_na_mao']) {
      expect(ESTAGIOS_ABERTOS as readonly string[]).toContain(vivo);
    }
  });

  it('modelo escolhido no eletroposto vem na FRENTE de proposta apresentada', () => {
    // Mesmo tempo parado: quem já escolheu por qual porta entrar está um passo
    // adiante de quem só viu o preço.
    for (const modelo of ['chave_na_mao', 'meio_a_meio', 'arrendamento', 'carregador']) {
      expect(pontuarCard(modelo, null, 20)).toBeGreaterThan(pontuarCard('proposta_apresentada', null, 20));
    }
  });

  it('nenhum estágio do ciclo cai no peso padrão de desconhecido', () => {
    // O bug que este teste prende: sem entrada no PESO_ESTAGIO o card vale 1 e
    // fica atrás até de `agendado`.
    for (const e of ESTAGIOS_CICLO) {
      expect(pontuarCard(e, null, 0)).toBeGreaterThan(pontuarCard('agendado', null, 0));
    }
  });

  it('a família do ciclo é exatamente a que o Thiago nomeou, e nada além', () => {
    expect([...ESTAGIOS_CICLO].sort()).toEqual([
      'arrendamento', 'carregador', 'chave_na_mao', 'em_atendimento',
      'fez_orcamento', 'meio_a_meio', 'proposta_apresentada',
    ]);
    // `nao_atendeu` e `agendado` ficam FORA de propósito: "não atendeu continua
    // a mesma regra", e quem cuida dele é a régua de remarcação.
    expect(ESTAGIOS_CICLO.has('nao_atendeu')).toBe(false);
    expect(ESTAGIOS_CICLO.has('agendado')).toBe(false);
  });
});

describe('último toque', () => {
  it('pega o carimbo mais recente, não o primeiro que aparece', () => {
    const t = ultimoToque(card({
      created_at: '2026-09-01T12:00:00Z',
      quando: '2026-09-10T12:00:00Z',
      proposta_em: '2026-09-15T12:00:00Z',
    }));
    expect(t?.toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });

  // Reunião marcada pra semana que vem não é card parado: é card em pé. Se o
  // `quando` do futuro contasse como toque, a espera viraria negativa e o card
  // entraria na fila do jeito errado.
  it('ignora carimbo no futuro', () => {
    const futuro = new Date(Date.now() + 5 * 86400_000).toISOString();
    const t = ultimoToque(card({ quando: futuro, created_at: '2026-09-01T12:00:00Z', proposta_em: null }));
    expect(t?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('devolve nulo quando não há carimbo nenhum', () => {
    expect(ultimoToque(card({ quando: null, created_at: null }))).toBeNull();
  });
});

describe('a informação relevante', () => {
  const OBS_LEAD = [
    '[Lead Instagram]', 'Consumo: 500 a 700', 'Vai aumentar consumo: Sim',
    'Imóvel: Proprio', 'Urgência: 30 dias', 'Pagamento: Finan',
    'Quem decide: Decide Junto', 'Motivo: Pesando orçamento', 'O que importa: Qualidade',
  ].join('\n');

  it('tira do card os campos que decidem o tom da ligação', () => {
    const ctx = contextoDoCard(card({ observacao: OBS_LEAD }));
    expect(ctx[0]).toBe('Consumo: 500 a 700');
    expect(ctx).toContain('Urgência: 30 dias');
    expect(ctx.length).toBeLessThanOrEqual(4);
    // O rótulo da fonte não é informação pra quem vai ligar.
    expect(ctx.join(' ')).not.toContain('[Lead Instagram]');
  });

  it('quando a observação é texto solto, leva o texto', () => {
    const ctx = contextoDoCard(card({ observacao: 'Pediu pra ligar depois das 18h' }));
    expect(ctx).toEqual(['Pediu pra ligar depois das 18h']);
  });

  it('sem observação, cai na última linha escrita no histórico', () => {
    const ctx = contextoDoCard(card({ observacao: null, historico: 'Ligou e caiu na caixa postal' }));
    expect(ctx).toEqual(['Ligou e caiu na caixa postal']);
  });

  it('card cru não inventa contexto', () => {
    expect(contextoDoCard(card({ observacao: null, historico: null }))).toEqual([]);
  });
});

describe('o recado que chega no celular', () => {
  it('abre com o nome e o telefone, e fecha com a ficha', () => {
    const msg = montarLembrete(card({ observacao: 'Consumo: 900 kWh' }), 30, 1);
    expect(msg.split('\n')[0]).toContain('LIGA AGORA: Paulo Sergio');
    expect(msg).toContain('34999887766');              // sem o 55, do jeito que se disca
    expect(msg).toContain('wa.me/5534999887766');      // com o 55, do jeito que o link precisa
    expect(msg).toContain('/gerador/agenda?ag=1&ver=1');
    expect(msg).toContain('Consumo: 900 kWh');
  });

  // Duas etiquetas discordando no celular fazem quem lê obedecer a errada.
  it('mostra só o status, nunca a temperatura', () => {
    const msg = montarLembrete(card({ status: 'nao_atendeu', temperatura: 'quente' }), 30, 1);
    expect(msg).toContain('Status: NÃO ATENDEU');
    expect(msg.toLowerCase()).not.toContain('temperatura');
    expect(msg.toLowerCase()).not.toContain('quente');
  });

  it('diz o motivo da ligação em vez de só mostrar o status', () => {
    expect(montarLembrete(card({ status: 'proposta_apresentada' }), 30, 1))
      .toContain('Viu a proposta e não voltou');
    expect(montarLembrete(card({ status: 'nao_atendeu' }), 30, 1))
      .toContain('Não atendeu da última vez');
  });

  // Emoji só na primeira linha, e nenhum travessão: é recado de gente pra gente.
  it('é escrito como gente escreve', () => {
    const msg = montarLembrete(card(), 30, 1);
    const linhas = msg.split('\n');
    const comEmoji = linhas.filter(l => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(l));
    expect(comEmoji.length).toBe(1);
    expect(comEmoji[0]).toBe(linhas[0]);
    expect(msg).not.toContain('—');
  });

  // ISTO JÁ PASSOU VERMELHO NO AR. A primeira versão filtrava a lista por
  // `l !== ''` pra tirar o telefone quando o card não tinha número, e junto
  // levava TODOS os parágrafos: o recado chegou no celular como um bloco de 9
  // linhas coladas. Passou por 27 testes porque nenhum deles olhava o desenho.
  it('chega em parágrafos, não em parede de texto', () => {
    const msg = montarLembrete(card({ observacao: 'Consumo: 900 kWh' }), 30, 1);
    expect(msg.split('\n').filter(l => l === '').length).toBeGreaterThanOrEqual(3);
    expect(msg).toContain('\n\n');
  });

  it('card sem telefone não deixa linha solta nem come o parágrafo', () => {
    const msg = montarLembrete(card({ cliente_telefone: null }), 30, 1);
    expect(msg.split('\n')[1]).toBe('');            // o telefone saiu, o parágrafo ficou
    expect(msg).not.toContain('wa.me/');
    expect(msg).toContain('\n\n');
  });

  it('a partir do 2º toque avisa que é repetição e ensina a sair da fila', () => {
    // `nao_atendeu` está FORA da família do ciclo, então ele mantém a frase
    // antiga. O fixture padrão é `fez_orcamento`, que desde 30/09/2026 cicla e
    // fecha com as três saídas — a versão dele é testada em "o ciclo da
    // família que negocia".
    const msg = montarLembrete(card({ status: 'nao_atendeu' }), 30, 2);
    expect(msg).toContain('2º lembrete');
    expect(msg).toContain('muda o status na ficha');
  });

  it('todo recado ensina ALGUMA saída, cicle ele ou não', () => {
    // A garantia que importa: nenhum status sai com um "liga agora" que não
    // diga como fazer o card parar de voltar.
    for (const st of ['fez_orcamento', 'nao_atendeu', 'chave_na_mao', 'agendado', 'arrendamento']) {
      expect(montarLembrete(card({ status: st }), 30, 2).toLowerCase()).toContain('status');
    }
  });
});

describe('detalhes que já morderam', () => {
  it('a espera é contada em dia de trabalho, não em dia de calendário', () => {
    expect(esperaPorExtenso(0.5)).toBe('30min');
    expect(esperaPorExtenso(5)).toBe('5h');
    expect(esperaPorExtenso(11)).toBe('1 dia(s) de trabalho');
    expect(esperaPorExtenso(33)).toBe('3 dia(s) de trabalho');
  });

  it('o telefone de exibição tira o 55 e só o 55', () => {
    expect(telExibicao('5534999887766')).toBe('34999887766');
    expect(telExibicao('34999887766')).toBe('34999887766');
    expect(telExibicao(null)).toBe('');
  });
});

describe('kill-switch e envs', () => {
  const salvo = { ...process.env };
  beforeEach(() => { process.env = { ...salvo }; });
  afterEach(() => { process.env = { ...salvo }; });

  it('a janela é configurável sem deploy', () => {
    process.env.LEMBRETE_INICIO_H = '8';
    process.env.LEMBRETE_FIM_H = '22';
    expect(slotAgora(brt('2026-09-29', 8, 30)).ok).toBe(true);
    expect(slotAgora(brt('2026-09-29', 21, 0)).ok).toBe(true);
  });

  it('env lixo não derruba a janela padrão', () => {
    process.env.LEMBRETE_INICIO_H = 'meia-noite';
    expect(slotAgora(brt('2026-09-29', 9, 0)).ok).toBe(false);
    expect(slotAgora(brt('2026-09-29', 11, 0)).ok).toBe(true);
  });
});

// ── A SALA DE ESPERA (`apalavrado`, 30/09/2026) ─────────────────────────────
//
// "Quando a pessoa vai arrendar, a gente tem que concluir com ela... entre o
// perdido e o vendido vai ter aquela margem da pessoa que está em stand-by. Ela
// é uma pessoa que não fica recebendo mais mensagem."
//
// Os dois casos reais que ele deu: o cliente de Guarapari, apalavrado no 50/50,
// esperando só o investidor; e o Cristiano de Curitiba, esperando um terreno em
// Catalão pra entrar com o investimento.
//
// São DOIS jeitos de errar, opostos, e os dois estragam a mesma coisa:
//   · cobrar quem já disse sim — transforma o sim em não;
//   · deixar dormir pra sempre — a sala de espera vira o cemitério onde o
//     negócio morre sem ninguém assinar embaixo, que é o contrário de "dar
//     destino".
describe('a sala de espera', () => {
  const agora = new Date('2026-09-30T15:00:00Z');
  const DIAS = 30;

  it('cala enquanto o prazo que o dono deu não venceu', () => {
    const p: Pausa = { aguardando: 'o investidor', retomar_em: '2026-10-20T12:00:00Z' };
    expect(dormindo(p, agora, new Date('2026-09-01T12:00:00Z'), DIAS)).toBe(true);
  });

  it('acorda no dia seguinte ao prazo, sem ninguém mexer', () => {
    const p: Pausa = { aguardando: 'o terreno em Catalão', retomar_em: '2026-09-29T12:00:00Z' };
    expect(dormindo(p, agora, new Date('2026-09-01T12:00:00Z'), DIAS)).toBe(false);
  });

  // O caso que morde depois que a tela existir: o CRM grava o status direto no
  // banco, e o carimbo da espera é uma SEGUNDA escrita que pode não acontecer.
  // Se "sem carimbo" quisesse dizer "acorda agora", apertar APALAVRADO
  // devolveria uma cobrança no mesmo dia.
  it('sem carimbo nenhum, dorme o prazo padrão em vez de cobrar na hora', () => {
    expect(dormindo(undefined, agora, new Date('2026-09-28T12:00:00Z'), DIAS)).toBe(true);
  });

  it('sem carimbo, mas parado além do prazo padrão, acorda', () => {
    expect(dormindo(undefined, agora, new Date('2026-07-01T12:00:00Z'), DIAS)).toBe(false);
  });

  it('data ilegível não vira sumiço permanente: cai no prazo padrão', () => {
    const p: Pausa = { aguardando: 'sei lá', retomar_em: 'quando der' };
    expect(dormindo(p, agora, new Date('2026-07-01T12:00:00Z'), DIAS)).toBe(false);
    expect(dormindo(p, agora, new Date('2026-09-29T12:00:00Z'), DIAS)).toBe(true);
  });

  it('o recado diz o que estava esperando e qual prazo venceu', () => {
    const linha = linhaDaEspera({ aguardando: 'o investidor', retomar_em: '2026-09-29T12:00:00Z' });
    expect(linha).toContain('o investidor');
    expect(linha).toContain('29/09');
  });

  it('espera sem nada escrito não inventa linha', () => {
    expect(linhaDaEspera(undefined)).toBeNull();
    expect(linhaDaEspera({})).toBeNull();
  });

  it('o card que acordou é cobrado nomeando as três saídas', () => {
    const msg = montarLembrete(
      card({ status: 'apalavrado' }), 40, 1,
      { pausa: { aguardando: 'o investidor', retomar_em: '2026-09-29T12:00:00Z' } },
    );
    expect(msg).toContain('APALAVRADO');
    expect(msg).toContain('o investidor');
    expect(msg.toLowerCase()).toContain('prazo');
  });
});

// ── MODO ESPELHO ────────────────────────────────────────────────────────────
// "A partir de hoje não manda para ninguém e manda para si próprio."
describe('modo espelho', () => {
  it('o recado diz de quem ele seria', () => {
    const msg = montarLembrete(card({ vendedor_nome: 'Diego' }), 20, 1, { espelhoDe: 'diego' });
    expect(msg.split('\n')[0]).toContain('ESPELHO');
    expect(msg.split('\n')[0]).toContain('DIEGO');
  });

  it('fora do espelho não sobra cabeçalho nenhum', () => {
    const msg = montarLembrete(card(), 20, 1);
    expect(msg).not.toContain('ESPELHO');
    expect(msg.split('\n')[0]).toContain('LIGA AGORA');
  });
});

// ── O CICLO NÃO TEM TETO, MAS TEM DESCANSO ──────────────────────────────────
describe('o ciclo da família que negocia', () => {
  it('o recado do ciclo avisa que volta a cada 48h e ensina as três saídas', () => {
    const msg = montarLembrete(card({ status: 'chave_na_mao' }), 60, 7);
    expect(msg).toContain('48h');
    expect(msg).toContain('Vendido');
    expect(msg).toContain('Sem interesse');
    expect(msg).toContain('Apalavrado');
  });

  it('no 7º toque ele ainda fala como ciclo, não como "já insisti demais"', () => {
    // O teto de 3 não vale aqui: sem esta garantia o card volta a ser calado no
    // 4º toque e o ciclo que o Thiago pediu morre em silêncio.
    const msg = montarLembrete(card({ status: 'em_atendimento' }), 60, 7);
    expect(msg).toContain('7º lembrete');
  });

  it('fora da família, o recado antigo continua igual', () => {
    const msg = montarLembrete(card({ status: 'nao_atendeu' }), 60, 2);
    expect(msg).not.toContain('48h');
    expect(msg).toContain('2º lembrete deste card');
  });
});
