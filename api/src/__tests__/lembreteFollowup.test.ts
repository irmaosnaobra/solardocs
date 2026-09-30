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
  type CardAberto,
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
    for (const morto of ['sem_interesse', 'perdido', 'fechou', 'fechou_concorrente', 'cancelado', 'arrendamento']) {
      expect(ESTAGIOS_ABERTOS as readonly string[]).not.toContain(morto);
    }
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
    const msg = montarLembrete(card(), 30, 2);
    expect(msg).toContain('2º lembrete');
    expect(msg).toContain('muda o status na ficha');
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
