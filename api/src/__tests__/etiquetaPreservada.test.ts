import { describe, it, expect } from 'vitest';
import {
  ETIQUETA_PREFIX, ETIQUETAS_DE_NEGOCIO, STATUS_TERMINAIS,
  APALAVRADO_PREFIX, esperaAte, naSalaDeEspera,
} from '../services/agenda/salaDeEspera';

// ── A ETIQUETA SOBREVIVE AO STATUS TERMINAL (01/10/2026) ───────────────────
//
// Ordem do Thiago: "o sem interesse poderia muito bem preservar a etiqueta, e
// quando colocar a etiqueta de SEM INTERESSE ficariam as 2, e no CRM o lead
// ficaria na SEM INTERESSE".
//
// O que se prende aqui são as DUAS LISTAS, e elas são o contrato entre três
// lugares: o servidor (que recusa etiqueta fora da lista), o CRM e a agenda (que
// decidem quando gravar e quando mostrar). As três cópias divergindo é o defeito
// que este arquivo existe pra pegar — e já aconteceu neste repo com a lista de
// status que ocupa horário na agenda.

describe('as duas listas da etiqueta preservada', () => {
  it('as etiquetas de negociação são as oito que o quadro tem coluna pra mostrar', () => {
    expect([...ETIQUETAS_DE_NEGOCIO].sort()).toEqual([
      'arrendamento', 'carregador', 'chave_na_mao', 'em_atendimento',
      'falando_whatsapp', 'fez_orcamento', 'meio_a_meio', 'proposta_apresentada',
    ]);
  });

  it('os terminais são os cinco que apagam a etiqueta', () => {
    expect([...STATUS_TERMINAIS].sort()).toEqual([
      'cancelado', 'fechou', 'fechou_concorrente', 'perdido', 'sem_interesse',
    ]);
  });

  // AS DUAS LISTAS NÃO PODEM SE CRUZAR. Se um status estivesse nas duas, gravar
  // ele dispararia o ramo que GUARDA e o ramo que APAGA na mesma troca, e qual
  // dos dois ganha dependeria da ordem do `if` — bug que só aparece num status.
  it('nenhum status está nas duas listas', () => {
    const cruzam = [...ETIQUETAS_DE_NEGOCIO].filter(s => STATUS_TERMINAIS.has(s));
    expect(cruzam).toEqual([]);
  });

  // `apalavrado` fica FORA das duas de propósito: ele não é etiqueta de
  // negociação (é a sala de espera, e desde 01/10 nem é status) e não é terminal
  // (o card volta pela data). Entrar em qualquer uma faria a espera apagar a
  // etiqueta que ela existe pra preservar.
  it('apalavrado não está em nenhuma das duas', () => {
    expect(ETIQUETAS_DE_NEGOCIO.has('apalavrado')).toBe(false);
    expect(STATUS_TERMINAIS.has('apalavrado')).toBe(false);
  });

  it('`agendado` e `nao_atendeu` também ficam fora: eles não são negociação', () => {
    // O card volta pra eles pela régua da agenda, e eles não dizem modelo de
    // negócio nenhum — guardar "AGENDADO" como etiqueta preservada seria ruído.
    for (const st of ['agendado', 'nao_atendeu', 'reagendar']) {
      expect(ETIQUETAS_DE_NEGOCIO.has(st)).toBe(false);
      expect(STATUS_TERMINAIS.has(st)).toBe(false);
    }
  });

  it('os dois prefixos de marca são diferentes, senão uma sobrescreve a outra', () => {
    expect(ETIQUETA_PREFIX).not.toBe(APALAVRADO_PREFIX);
    expect(ETIQUETA_PREFIX.endsWith(':')).toBe(true);
    expect(APALAVRADO_PREFIX.endsWith(':')).toBe(true);
    // E nenhum é prefixo do outro: a leitura em lote separa as duas por
    // `startsWith`, e um ser prefixo do outro faria a etiqueta cair no mapa das
    // esperas.
    expect(ETIQUETA_PREFIX.startsWith(APALAVRADO_PREFIX)).toBe(false);
    expect(APALAVRADO_PREFIX.startsWith(ETIQUETA_PREFIX)).toBe(false);
  });
});

// A sala de espera ganhou companhia no mesmo arquivo, então as bordas dela vão
// aqui também: elas são a razão de o módulo ser neutro.
describe('as bordas da data da sala de espera', () => {
  it('data boa é a data', () => {
    expect(esperaAte({ retomar_em: '2026-10-30T15:00:00.000Z' }))
      .toBe(Date.parse('2026-10-30T15:00:00.000Z'));
  });

  it('data ilegível cai em 30 dias desde que foi marcada, não em silêncio eterno', () => {
    const em = '2026-10-01T00:00:00.000Z';
    expect(esperaAte({ retomar_em: 'amanhã de manhã', em }))
      .toBe(Date.parse(em) + 30 * 86400_000);
  });

  it('marca sem data NENHUMA devolve null, e aí a ficha continua rodando', () => {
    // Carimbo quebrado não pode ser a razão de um cliente desaparecer: entre
    // "volta pra agenda sem precisar" e "nunca mais volta", o primeiro custa um
    // horário e o segundo custa o cliente.
    expect(esperaAte({ aguardando: 'esperando o investidor' })).toBe(null);
    expect(esperaAte(null)).toBe(null);
    expect(esperaAte(undefined)).toBe(null);
  });

  it('naSalaDeEspera compara com o agora que recebe, sem relógio próprio', () => {
    const agora = Date.parse('2026-10-15T12:00:00.000Z');
    expect(naSalaDeEspera({ retomar_em: '2026-10-30' }, agora)).toBe(true);
    expect(naSalaDeEspera({ retomar_em: '2026-10-01' }, agora)).toBe(false);
    expect(naSalaDeEspera({}, agora)).toBe(false);
  });
});
