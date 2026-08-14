import { describe, it, expect } from 'vitest';
import {
  NOTA1_MATERIAL_DESDE, inicioDaJanela, linhasDoFunil, doNota1, somaColuna,
} from '../services/io/nota1Funil';

/** Horário de Brasília → ISO, pra o teste ler como o painel lê. */
const brt = (ymd: string, hhmm = '12:00') => new Date(`${ymd}T${hhmm}:00-03:00`).toISOString();
const ev = (tipo: string, ymd: string, sess: string, motivo?: string, hhmm?: string) =>
  ({ tipo, session_id: sess, payload: motivo ? { motivo } : null, created_at: brt(ymd, hhmm) });

describe('o piso do redirect', () => {
  // Antes de 07/08 o nota 1 via o convite do grupo de WhatsApp. Contar aquelas
  // fichas como "mandadas pra página" inventaria gente que nunca teve pra onde ir.
  it('30 dias atrás não passa do dia em que a página virou o destino', () => {
    const agora = new Date('2026-08-20T15:00:00Z').getTime();
    expect(inicioDaJanela(30, agora)).toBe(new Date(`${NOTA1_MATERIAL_DESDE}T00:00:00-03:00`).toISOString());
  });

  it('janela curta manda: 7 dias em setembro começa em setembro, não no piso', () => {
    const agora = new Date('2026-09-20T15:00:00Z').getTime();
    expect(inicioDaJanela(7, agora)).toBe(new Date('2026-09-13T15:00:00Z').toISOString());
  });
});

describe('quem veio da recusa e quem entrou por fora', () => {
  it('motivo carimbado é nota 1; neutro e vazio são de fora', () => {
    expect(doNota1({ payload: { motivo: 'sem_ponto' } })).toBe(true);
    expect(doNota1({ payload: { motivo: 'fluxo_baixo' } })).toBe(true);
    expect(doNota1({ payload: { motivo: 'neutro' } })).toBe(false);
    expect(doNota1({ payload: null })).toBe(false);
  });

  // 08/08/2026 foi o lançamento do curso: 21 sessões neutras contra 5 da recusa.
  // Somar tudo faria a conversão do nota 1 passar de 400%.
  it('as duas colunas não se misturam', () => {
    const linhas = linhasDoFunil(
      [{ created_at: brt('2026-08-08') }, { created_at: brt('2026-08-08') }],
      [
        ev('material_view', '2026-08-08', 's1', 'sem_ponto'),
        ev('material_view', '2026-08-08', 's2', 'neutro'),
        ev('material_view', '2026-08-08', 's3', 'neutro'),
      ],
      [],
    );
    expect(linhas[0]).toMatchObject({ mandados: 2, chegaram: 1, chegaram_fora: 2 });
  });

  // Recarregar a página dispara material_view de novo. Contar evento em vez de
  // sessão diria que 1 pessoa viraram 3.
  it('a mesma sessão só conta uma vez, por mais que a página recarregue', () => {
    const linhas = linhasDoFunil([], [
      ev('material_view', '2026-08-09', 's1', 'sem_ponto'),
      ev('material_view', '2026-08-09', 's1', 'sem_ponto'),
      ev('material_view', '2026-08-09', 's1', 'sem_ponto'),
    ], []);
    expect(linhas[0].chegaram).toBe(1);
  });
});

describe('o alerta de medição furada', () => {
  // O bug real: 12 a 14/08/2026, o `var API` ficava ABAIXO do beacon da visita,
  // o fetch saía pra "undefined/plugcash/evento" e o .catch engolia. A rolagem
  // continuava certa porque dispara depois. Rolagem sem visita é impossível.
  it('acende quando tem rolagem e nenhuma visita', () => {
    const linhas = linhasDoFunil(
      [{ created_at: brt('2026-08-13') }],
      [ev('material_scroll', '2026-08-13', 's1'), ev('material_scroll', '2026-08-13', 's2')],
      [],
    );
    expect(linhas[0].medicao_furada).toBe(true);
  });

  // 09/08 teve 6 fichas e 5 sessões medidas, e nada estava quebrado: quem
  // preenche 23h58 e abre a página 00h01 cai em dias diferentes. Se a régua
  // fosse "chegaram < mandados", o painel gritaria vermelho num dia saudável.
  it('NÃO acende só porque chegou menos gente do que foi mandada', () => {
    const linhas = linhasDoFunil(
      Array.from({ length: 6 }, () => ({ created_at: brt('2026-08-09') })),
      [
        ev('material_view', '2026-08-09', 's1', 'sem_ponto'),
        ev('material_scroll', '2026-08-09', 's1'),
      ],
      [],
    );
    expect(linhas[0]).toMatchObject({ mandados: 6, chegaram: 1, medicao_furada: false });
  });

  // 10/08: 5 sessões, todas neutras, e zero ficha no dia. A visita FOI medida —
  // só não veio da recusa. Vermelho aqui seria alarme falso.
  it('visita de quem veio por fora também conta como medição viva', () => {
    const linhas = linhasDoFunil([], [
      ev('material_view', '2026-08-10', 's1', 'neutro'),
      ev('material_scroll', '2026-08-10', 's1'),
    ], []);
    expect(linhas[0].medicao_furada).toBe(false);
  });

  it('dia sem rolagem nenhuma não é dia furado — é dia sem gente', () => {
    const linhas = linhasDoFunil([{ created_at: brt('2026-08-11') }], [], []);
    expect(linhas[0].medicao_furada).toBe(false);
  });
});

describe('o total', () => {
  // O total é o número pra olhar justamente porque não sofre com a virada do dia:
  // a ficha de 23h58 e a visita de 00h01 caem em linhas diferentes e na mesma soma.
  it('soma as duas pontas da meia-noite', () => {
    const linhas = linhasDoFunil(
      [{ created_at: brt('2026-08-12', '23:58') }],
      [ev('material_view', '2026-08-13', 's1', 'sem_ponto', '00:01')],
      [],
    );
    expect(linhas).toHaveLength(2);
    expect(somaColuna(linhas, 'mandados')).toBe(1);
    expect(somaColuna(linhas, 'chegaram')).toBe(1);
  });

  it('a linha mais recente vem primeiro', () => {
    const linhas = linhasDoFunil(
      [{ created_at: brt('2026-08-08') }, { created_at: brt('2026-08-13') }], [], [],
    );
    expect(linhas.map((l) => l.dia)).toEqual(['2026-08-13', '2026-08-08']);
  });
});
