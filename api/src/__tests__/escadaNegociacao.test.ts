import { describe, it, expect, afterEach } from 'vitest';
import {
  horasDoDegrau as horasEp, degrauDaProximaVolta as degrauEp, tetoDoDegrauH as tetoEp,
} from '../services/io/eletropostoReagendaAuto';
import {
  horasDoDegrau as horasSolar, degrauDaProximaVolta as degrauSolar, tetoDoDegrauH as tetoSolar,
} from '../services/agenda/reagendaSolarNaoAtendido';

// ── A ESCADA DA NEGOCIAÇÃO (01/10/2026) ────────────────────────────────────
//
// Ordem do Thiago: "chave na mão, carregador, 50/50 e arrendamento, após receber
// sua etiqueta é agendado novamente 48 hrs; se manter uma dessas etiquetas,
// 72hrs; se manter novamente, 96; se manter novamente, 120hrs, e assim por
// diante até ter um fim".
//
// A aritmética é o contrato, então ela é testada SOZINHA, sem banco e sem mock:
// `horasDoDegrau` e `degrauDaProximaVolta` são puras de propósito. Teste que
// precisa de tick inteiro pra conferir "48, 72, 96, 120" é teste que ninguém lê
// quando o número muda.
//
// O par vive nos DOIS módulos, com envs próprias, e tem que dar o mesmo
// resultado: dois cards idênticos no quadro se comportando diferente é o tipo de
// coisa que ninguém reporta como bug, só desiste de usar.

// APAGA SÓ AS CHAVES QUE ESTE ARQUIVO ESCREVE, em vez de trocar o `process.env`
// inteiro por uma cópia.
//
// Trocar o objeto todo é o que os outros arquivos deste diretório fazem, e dentro
// de um arquivo só funciona. Entre arquivos, não: a cópia é tirada quando ESTE
// módulo carrega, então restaurá-la depois apaga o que outro arquivo tinha posto
// no meio. Foi assim que `reagendaSolarNaoAtendido.test.ts` passou isolado e caiu
// na suíte inteira — e o jeito que isso aparece ("passa sozinho, cai junto") é o
// mais caro de diagnosticar que existe.
const MINHAS = [
  'EP_NEGOCIACAO_H', 'EP_NEGOCIACAO_PASSO_H',
  'SOLAR_NEGOCIACAO_H', 'SOLAR_NEGOCIACAO_PASSO_H',
];
afterEach(() => { for (const k of MINHAS) delete process.env[k]; });

const produtos = [
  { nome: 'eletroposto', horas: horasEp, teto: tetoEp, degrau: degrauEp, baseEnv: 'EP_NEGOCIACAO_H', passoEnv: 'EP_NEGOCIACAO_PASSO_H' },
  { nome: 'solar', horas: horasSolar, teto: tetoSolar, degrau: degrauSolar, baseEnv: 'SOLAR_NEGOCIACAO_H', passoEnv: 'SOLAR_NEGOCIACAO_PASSO_H' },
] as const;

for (const p of produtos) {
  describe(`a escada do ${p.nome}`, () => {
    it('é 48, 72, 96, 120 e segue subindo de 24 em 24', () => {
      expect(p.horas(1)).toBe(48);
      expect(p.horas(2)).toBe(72);
      expect(p.horas(3)).toBe(96);
      expect(p.horas(4)).toBe(120);
      expect(p.horas(5)).toBe(144);
      expect(p.horas(10)).toBe(48 + 24 * 9);
    });

    it('e PARA no teto, que sai da janela do reciclo (03/10/2026)', () => {
      // Este teste dizia "sem teto. Se um dia alguém puser um, este teste cai",
      // e foi exatamente o que aconteceu — ele avisou no mesmo dia. O que mudou
      // foi a janela do reciclo: de 365 dias pra 21. Sem teto, a escada passa a
      // janela, e no degrau 21 o card só fica elegível com `quando` de 22 dias
      // atrás, um dia DEPOIS de a janela já tê-lo excluído. Ele sumiria sozinho,
      // sem ninguém ter decidido isso.
      //
      // O teto não é um número solto: ele é `(janelaDias − 3) · 24`, então quem
      // mexer na janela mexe no teto sem saber que mexeu.
      expect(p.horas(999)).toBe(p.teto());
      expect(p.teto()).toBe((21 - 3) * 24);
      // a folga de 3 dias existe porque ELEGÍVEL NÃO É REMARCADO: entre uma
      // coisa e a outra tem rampa, teto por dia e janela de horário. O card
      // precisa de alguns ticks dentro da janela pra ser pego de verdade.
      expect(p.teto()).toBeLessThan(21 * 24);
    });

    it('degrau 0 ou negativo não desce abaixo do piso de 48h', () => {
      // Não deveria acontecer, mas dado estragado no `system_state` não pode
      // virar "volta de 24 em 24h" nem "volta já".
      expect(p.horas(0)).toBe(48);
      expect(p.horas(-3)).toBe(48);
    });

    it('base e passo mudam sem deploy', () => {
      process.env[p.baseEnv] = '36';
      process.env[p.passoEnv] = '12';
      expect(p.horas(1)).toBe(36);
      expect(p.horas(3)).toBe(60);
    });

    describe('e o degrau da próxima volta', () => {
      it('ficha que nunca voltou começa no 1, que são 48h', () => {
        expect(p.degrau(undefined, 'chave_na_mao')).toBe(1);
        expect(p.horas(p.degrau(undefined, 'chave_na_mao'))).toBe(48);
      });

      it('MESMA etiqueta sobe um degrau', () => {
        expect(p.degrau({ status: 'arrendamento', degrau: 1 }, 'arrendamento')).toBe(2);
        expect(p.degrau({ status: 'arrendamento', degrau: 3 }, 'arrendamento')).toBe(4);
        expect(p.horas(p.degrau({ status: 'arrendamento', degrau: 3 }, 'arrendamento'))).toBe(120);
      });

      // O CORAÇÃO DA REGRA: "se manter uma dessas etiquetas". Manter é que faz
      // subir, então MUDAR tem que zerar. Um `arrendamento` que virou
      // `chave_na_mao` é a negociação andando, e quem anda merece o toque curto.
      it('etiqueta DIFERENTE zera a escada, mesmo depois de muitas voltas', () => {
        expect(p.degrau({ status: 'arrendamento', degrau: 7 }, 'chave_na_mao')).toBe(1);
        expect(p.horas(p.degrau({ status: 'arrendamento', degrau: 7 }, 'chave_na_mao'))).toBe(48);
      });

      it('carimbo antigo, sem etiqueta gravada, cai no 1 — ninguém é pulado na virada', () => {
        // Todo carimbo escrito antes de 01/10/2026 é assim. Tratá-lo como degrau
        // alto faria as fichas que já estavam rodando sumirem por 5 dias sem
        // ninguém entender por quê.
        expect(p.degrau({ degrau: 4 }, 'chave_na_mao')).toBe(1);
        expect(p.degrau({}, 'chave_na_mao')).toBe(1);
      });

      it('degrau estragado não vira degrau estragado maior', () => {
        expect(p.degrau({ status: 'x', degrau: 0 }, 'x')).toBe(2);
        expect(p.degrau({ status: 'x', degrau: -5 }, 'x')).toBe(2);
        expect(p.degrau({ status: 'x', degrau: NaN }, 'x')).toBe(2);
        expect(p.degrau({ status: 'x', degrau: 2.7 }, 'x')).toBe(3);
      });
    });
  });
}

describe('os dois produtos contam a mesma escada', () => {
  it('degrau por degrau, do 1 ao 12', () => {
    for (let d = 1; d <= 12; d++) expect(horasSolar(d)).toBe(horasEp(d));
  });

  it('e reagem igual à etiqueta que muda', () => {
    const est = { status: 'em_atendimento', degrau: 5 };
    expect(degrauSolar(est, 'em_atendimento')).toBe(degrauEp(est, 'em_atendimento'));
    expect(degrauSolar(est, 'fez_orcamento')).toBe(degrauEp(est, 'fez_orcamento'));
  });

  it('a escada é um passeio só: cada degrau pede 24h mais que o anterior', () => {
    // Prende a FORMA, não os números: se alguém trocar o passo por algo que não
    // seja aritmético (dobrar, por exemplo), este teste cai mesmo que 48 e 72
    // continuem certos.
    for (let d = 1; d < 15; d++) expect(horasEp(d + 1) - horasEp(d)).toBe(24);
  });
});
