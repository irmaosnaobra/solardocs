import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// O tick do grupo de vendas do SolarDoc roda DEPOIS do allSettled dos outros ticks do /process-messages, sozinho:
// os envios da linha 5040 daqueles ticks já aconteceram, e o aviso ao grupo não sai colado neles.

const fonte = readFileSync(join(__dirname, '..', 'routes', 'cron.ts'), 'utf8');

describe('routes/cron.ts: a vez do tick de desistência do SolarDoc', () => {
  it('não está na lista TAREFAS (que roda toda junta)', () => {
    expect(fonte).not.toMatch(/\['solardoc_quiz_desistencia',\s*\(\)\s*=>/);
  });
  it('roda depois do Promise.allSettled das tarefas e entra na resposta', () => {
    const tarefas = fonte.indexOf('Promise.allSettled(TAREFAS.map');
    const chamada = fonte.indexOf('await runSolardocQuizDesistenciaTick()', tarefas);
    expect(tarefas).toBeGreaterThan(0);
    expect(chamada).toBeGreaterThan(tarefas);
    expect(fonte).toContain("resultados['solardoc_quiz_desistencia']");
  });
});
