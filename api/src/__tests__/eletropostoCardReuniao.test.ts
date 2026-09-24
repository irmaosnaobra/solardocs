import { describe, it, expect } from 'vitest';
import { montarMensagem } from '../routes/ioEletroposto';
import { extraDoCard } from '../services/io/eletropostoEstudoGarantir';

// ─────────────────────────────────────────────────────────────────────────────
// O card que o Thiago e o Diego recebem quando a LP do eletroposto marca reunião.
// Desde 15/09/2026 a nota vem só do ponto (11/11 dono, 10/11 quem administra,
// representa ou aluga, 9/11 local em negociação) e é a linha do modelo que diz qual
// conversa é. A ficha é texto
// escrito pela LP: cada rótulo aqui é o mesmo string de `obs` no index.html.
// ─────────────────────────────────────────────────────────────────────────────

const ficha = (linhas: string[], extra: Record<string, unknown> = {}) => ({
  quando: '2026-09-16T17:00:00Z', vendedor_nome: 'Diego', cliente_nome: 'Fulano',
  cliente_telefone: '+55 34 99999-0000', cidade: 'Uberlândia-MG', temperatura: 'quente',
  observacao: linhas.join('\n'), ...extra,
});

const PONTO_PROPRIO = [
  'LP ELETROPOSTO · Dono de posto de combustível',
  'NOTA 3 · 11/11 pts',
  'Endereço: Av. Brasil, 100 · Centro · Uberlândia-MG',
  'Ponto: Já tenho o ponto definido',
  'Local é seu: Sou o proprietário',
  'Modelo de interesse: 02 · Sociedade meio a meio',
  'Como pretende investir: Recurso próprio',
];

describe('montarMensagem — card da reunião de eletroposto', () => {
  it('ponto próprio: prioridade com 11/11 e a linha do modelo', () => {
    const msg = montarMensagem(ficha(PONTO_PROPRIO));
    expect(msg).toContain('*NOTA 3 — PRIORIDADE*  (11/11 pts)');
    expect(msg).toContain('*Modelo:* 02 · Sociedade meio a meio');
    // o prefixo da LP usa ponto médio: o card não pode repetir "LP ELETROPOSTO" no perfil
    expect(msg).toContain('*Perfil:* Dono de posto de combustível');
  });

  it('local em negociação: 9/11, com endereço, e nunca como nutrição', () => {
    const msg = montarMensagem(ficha([
      'LP ELETROPOSTO · Investidor',
      'NOTA 3 · 9/11 pts',
      'Endereço: Rua X, 5 · Bairro · Uberlândia-MG',
      'Ponto: Tenho um local em negociação com o proprietário',
      'Local é seu: Estou negociando com o proprietário',
      'Modelo de interesse: 01 · Cedo o espaço e vocês investem 100%',
      'Como pretende investir: Não se aplica · modelo 01, a NEXUS investe 100%',
    ]));
    expect(msg).toContain('(9/11 pts)');
    expect(msg).toContain('*Endereço:* Rua X, 5');
    expect(msg).toContain('*Local é seu:* Estou negociando com o proprietário');
    expect(msg).toContain('*Como pretende investir:* Não se aplica');
    expect(msg).not.toContain('NUTRIÇÃO');
  });

  it('ficha antiga, sem modelo nem nota: não inventa linha e usa a temperatura', () => {
    const msg = montarMensagem(ficha(
      ['LP ELETROPOSTO — Outro', 'Simulou 80 kW com 10 carros/dia'],
      { temperatura: 'morno' },
    ));
    expect(msg).not.toContain('*Modelo:*');
    expect(msg).toContain('*NOTA 2');
    expect(msg).toContain('*Perfil:* Outro');
  });

  it('vagas e valor (15/09): entram no card quando a ficha traz, e só então', () => {
    const msg = montarMensagem(ficha([
      'LP ELETROPOSTO · Estacionamento',
      'NOTA 3 · 11/11 pts',
      'Ponto: Já tenho o ponto definido',
      'Local é seu: Sou o proprietário',
      'Vagas disponíveis: 6 a 10',
      'Modelo de interesse: 03 · Chave na mão, o eletroposto é meu',
      'Como pretende investir: Recurso próprio',
      'Quanto pretende investir: R$ 280 mil',
    ]));
    expect(msg).toContain('*Vagas:* 6 a 10');
    expect(msg).toContain('*Quanto pretende investir:* R$ 280 mil');
    const semNada = montarMensagem(ficha(['LP ELETROPOSTO · Investidor', 'NOTA 3 · 9/11 pts']));
    expect(semNada).not.toContain('*Vagas:*');
    expect(semNada).not.toContain('*Quanto pretende investir:*');
  });
});

describe('ficha sem a trifásica (quiz de 16/09)', () => {
  it('a linha some do card quando a ficha não traz, e fica quando traz', () => {
    const nova = montarMensagem(ficha([
      'LP ELETROPOSTO · Dono de posto de combustível',
      'NOTA 3 · 11/11 pts',
      'Ponto: Já tenho o ponto definido',
      'Local é seu: Sou o proprietário',
      'Como pretende investir: Recurso próprio',
      'Decisor: Eu decido',
    ]));
    expect(nova).not.toContain('Entrada trifásica');
    expect(nova).toContain('*Decisor:* Eu decido');

    const antiga = montarMensagem(ficha([
      'LP ELETROPOSTO · Dono de posto de combustível',
      'NOTA 3 · 11/11 pts',
      'Ponto: Já tenho o ponto definido',
      'Decisor: Eu decido',
      'Entrada trifásica: Sim',
    ]));
    expect(antiga).toContain('*Entrada trifásica:* Sim');
  });
});

describe('card com o estudo do local (15/09)', () => {
  const URL = `https://solardoc.app/_api/io/eletroposto/estudo/${'a'.repeat(64)}`;

  it('pré-nota e link logo depois do endereço', () => {
    const f = ficha(PONTO_PROPRIO);
    const msg = montarMensagem(f, extraDoCard(f.observacao, 'a'.repeat(64)));
    const linhas = msg.split('\n');
    const i = linhas.findIndex(l => l.startsWith('*Endereço:*'));
    expect(linhas[i + 1]).toBe('*Pré-nota do local:* 100 de 100');
    expect(linhas[i + 2]).toBe(`*Estudo do local:* ${URL} (fica pronto em até 15 min)`);
  });

  it('sem estudo criado: só a pré-nota', () => {
    const f = ficha(PONTO_PROPRIO);
    const msg = montarMensagem(f, extraDoCard(f.observacao, null));
    expect(msg).toContain('*Pré-nota do local:* 100 de 100');
    expect(msg).not.toContain('*Estudo do local:*');
  });

  it('ficha sem endereço não ganha linha nenhuma', () => {
    const f = ficha(['LP ELETROPOSTO · Investidor', 'NOTA 3 · 9/11 pts']);
    expect(extraDoCard(f.observacao, 'a'.repeat(64))).toEqual({});
    expect(montarMensagem(f, extraDoCard(f.observacao, 'a'.repeat(64)))).toBe(montarMensagem(f));
  });

  it('sem extra, o card é o de antes, nos três formatos', () => {
    for (const f of [
      ficha(PONTO_PROPRIO),
      ficha(['LP ELETROPOSTO · Investidor', 'NOTA 3 · 9/11 pts', 'Endereço: Rua X, 5 · Bairro · Uberlândia-MG']),
      ficha(['LP ELETROPOSTO — Outro', 'Simulou 80 kW com 10 carros/dia'], { temperatura: 'morno' }),
    ]) {
      const msg = montarMensagem(f);
      expect(msg).not.toContain('Pré-nota');
      expect(msg).not.toContain('Estudo do local');
      expect(montarMensagem(f, {})).toBe(msg);
    }
  });

  it('a pré-nota nunca tem barra: o selo procura /11 no card', () => {
    const f = ficha(PONTO_PROPRIO);
    const linha = montarMensagem(f, extraDoCard(f.observacao)).split('\n').find(l => l.startsWith('*Pré-nota'));
    expect(linha).not.toContain('/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O CARD DE QUEM COMPRA CARREGADOR (24/09/2026)
//
// A quarta porta do quiz não responde nenhuma pergunta do ponto. O primeiro card
// que saiu em produção provou o estrago: seis traços seguidos (Ponto, Como
// pretende investir, Decisor, Simulou, Investimento, Resultado) e NENHUMA das
// seis respostas que o lead deu. Estes testes travam os dois lados.
// ═══════════════════════════════════════════════════════════════════════════
describe('card de compra de carregador', () => {
  const FICHA_COMPRA = [
    'LP ELETROPOSTO · COMPRA DE CARREGADOR',
    'VENDA DE EQUIPAMENTO',
    'Potência: 120 kW',
    'Unidades: 2 a 5 unidades',
    'Para onde vai: Meu negócio',
    'Software e app: Sim, quero o software e o app',
    'Instalação: Só o equipamento, eu instalo',
    'Prazo: O quanto antes',
  ].join('\n');

  const compra = (obs: string) => montarMensagem({
    quando: '2026-09-24T20:30:00.000Z', vendedor_nome: 'Diego',
    cliente_nome: 'Roberto Silva', cliente_telefone: '5534991360223',
    cidade: 'Araguari', temperatura: 'quente', observacao: obs,
  });

  it('mostra as seis respostas e nenhum traço de pergunta que ele não viu', () => {
    const t = compra(FICHA_COMPRA);
    expect(t).toContain('COMPRA DE CARREGADOR');
    expect(t).toContain('120 kW');
    expect(t).toContain('2 a 5 unidades');
    expect(t).toContain('Meu negócio');
    expect(t).toContain('Sim, quero o software e o app');
    expect(t).toContain('O quanto antes');
    // o que ele nunca respondeu não pode aparecer, nem como traço
    for (const fora of ['*Ponto:*', '*Como pretende investir:*', '*Decisor:*', '*Simulou', '*Resultado:*']) {
      expect(t).not.toContain(fora);
    }
  });

  it('não inventa NOTA: a escala mede o ponto, e este lead não tem ponto', () => {
    const t = compra(FICHA_COMPRA);
    expect(t).not.toContain('NOTA 3');
    expect(t).not.toContain('PRIORIDADE');
  });

  it('grita quando ele quer a obra junto', () => {
    const comObra = FICHA_COMPRA + '\nCOM OBRA';
    expect(compra(comObra)).toContain('COM OBRA');
    expect(compra(FICHA_COMPRA)).not.toContain('COM OBRA');
  });

  // A segunda venda escondida na pergunta da obra: quem ja tem eletricista ainda
  // precisa de projeto e ART, e o consultor tem que chegar sabendo.
  it('grita quando a obra e dele e o projeto e nosso', () => {
    const comProjeto = FICHA_COMPRA + '\nPROJETO E ART';
    expect(compra(comProjeto)).toContain('PROJETO E ART');
    expect(compra(comProjeto)).not.toContain('COM OBRA');
    expect(compra(FICHA_COMPRA)).not.toContain('PROJETO E ART');
  });

  // O simbolo de posto e o UNICO emoji do card, e so na primeira linha. Um emoji
  // por linha vira enfeite: quando tudo tem simbolo, nenhum simbolo chama. Sem
  // este teste um deles volta numa linha de rotulo no proximo ajuste, calado.
  it('o simbolo de posto abre o card e e o unico emoji', () => {
    const linhas = compra(FICHA_COMPRA + '\nCOM OBRA').split('\n');
    expect(linhas[0]).toContain('\u26fd');
    for (const l of linhas.slice(1)) expect(l).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('a ficha do ponto continua com o card de sempre', () => {
    const t = montarMensagem(ficha(PONTO_PROPRIO));
    expect(t).toContain('NOVA REUNIÃO');
    expect(t).not.toContain('COMPRA DE CARREGADOR');
  });
});
