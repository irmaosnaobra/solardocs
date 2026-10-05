import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// O RELATÓRIO DO /cron/process-messages TEM QUE DIZER DE QUEM É CADA NÚMERO.
//
// Isto é um teste de ESTRUTURA do fonte, e é de propósito: o defeito que ele
// prende não é de comportamento, é de forma. O jeito honesto de testar o
// comportamento seria mockar as 40 tarefas do tick e conferir onde cada valor
// cai — um arquivo de mock maior que a rota, que ninguém mantém.
//
// ── O QUE ACONTECEU, DUAS VEZES ────────────────────────────────────────────
//
// A rota montava a resposta com um destructure POSICIONAL: uma lista de nomes à
// esquerda casando por posição com uma lista de chamadas.
//
//   19/08/2026: 25 nomes pra 27 chamadas. Tudo a partir do 11º vinha rotulado
//               errado. Corrigido realinhando.
//   01/10/2026: 36 nomes pra 40 chamadas, deriva a partir do 22º. O
//               `ep_reagenda_auto` mostrava o resultado da régua do SIM e o
//               `reagenda_solar` mostrava o da recepção da linha IO. Os quatro
//               últimos ticks não apareciam de jeito nenhum.
//
// Nas duas vezes os ticks RODARAM: `allSettled` chama tudo que está na lista.
// Quem mentia era o relatório — e o relatório é exatamente onde a gente olha
// quando desconfia de um tick. Em 01/10 ele me fez concluir, lendo a resposta de
// produção, que o reciclo do solar estava rodando código velho. Não estava: o
// número era de outro módulo.
//
// Realinhar uma terceira vez seria combinar com a quarta. A lista virou
// `[chave, chamada]`, e este teste é o que impede a volta do formato antigo.

const fonte = readFileSync(join(__dirname, '..', 'routes', 'cron.ts'), 'utf8');

// O recorte é tolerante de propósito: se a lista não existir, `bloco` vem vazio
// e quem reclama é um TESTE, com nome e mensagem. Jogar aqui, no corpo do
// módulo, faria o arquivo inteiro morrer na coleta e o vitest dizer só
// "no tests" — que é o pior jeito de descobrir uma regressão.
const marca = 'const TAREFAS: Array<[string, () => Promise<unknown>]> = [';
const bloco = (() => {
  const achou = fonte.indexOf(marca);
  if (achou < 0) return '';
  // Começa DEPOIS da declaração: a anotação de tipo tem um `() =>` dentro dela,
  // e ele entraria na contagem de thunks.
  const i = achou + marca.length;
  const fim = fonte.indexOf('\n    ];', i);
  return fim > i ? fonte.slice(i, fim) : '';
})();

/** Os pares `['chave', () => chamada()]` da lista, na ordem. */
const pares = [...bloco.matchAll(/\['([a-z0-9_]+)',\s*\(\)\s*=>\s*([A-Za-z0-9_]+)\(\)\]/g)]
  .map(m => ({ chave: m[1]!, fn: m[2]! }));

describe('o relatório do process-messages é por nome, não por posição', () => {
  it('a lista de tarefas com nome existe e foi encontrada', () => {
    expect(fonte).toContain(marca);
    expect(bloco.length).toBeGreaterThan(0);
  });

  it('toda tarefa da lista tem chave e chamada no mesmo par', () => {
    // Se alguém escrever uma chamada solta no meio da lista, ela não casa com o
    // par e a contagem de `=>` passa a ser maior que a de pares.
    const thunks = (bloco.match(/\(\)\s*=>/g) || []).length;
    expect(pares.length).toBe(thunks);
    // Piso baixo de propósito: a guarda de verdade é pares === thunks. A limpeza
    // de 05/10 tirou robôs mortos da lista, e um piso justo quebraria cada revert.
    expect(pares.length).toBeGreaterThanOrEqual(30);
  });

  it('nenhuma chave aparece duas vezes — a segunda apagaria a primeira', () => {
    const chaves = pares.map(p => p.chave);
    expect(chaves.length).toBe(new Set(chaves).size);
  });

  it('nenhuma função é chamada duas vezes na mesma rodada', () => {
    const fns = pares.map(p => p.fn);
    expect(fns.length).toBe(new Set(fns).size);
  });

  it('o destructure posicional não volta', () => {
    // A forma exata que falhou em 19/08 e em 01/10. Se ela reaparecer em
    // qualquer rota deste arquivo, este teste cai.
    expect(fonte).not.toMatch(/Result\]\s*=\s*await Promise\.allSettled/);
  });

  it('a resposta é espalhada da lista, não escrita chave por chave', () => {
    // 36 linhas `chave: xResult.status === 'fulfilled' ? ...` eram a segunda
    // lista que desalinhava da primeira. Uma lista só, e não há o que divergir.
    expect(fonte).toContain('...resultados,');
    expect(fonte).not.toMatch(/epReagendaResult\.status/);
  });

  it('os módulos que tinham o resultado DESCARTADO estão na lista, com a chave deles', () => {
    // Os quatro últimos de 01/10, que não apareciam na resposta, e os três do
    // meio que não tinham nome nenhum.
    const porFn = new Map(pares.map(p => [p.fn, p.chave]));
    expect(porFn.get('runReagendaSolarTick')).toBe('reagenda_solar');
    expect(porFn.get('runLembreteFollowupTick')).toBe('lembrete_followup');
    expect(porFn.get('runSentinelaVacuo')).toBe('vacuo');
    expect(porFn.get('runAvisosTick')).toBe('avisos');
    expect(porFn.get('runEletropostoReagendaAutoTick')).toBe('ep_reagenda_auto');
    expect(porFn.get('runEletropostoCobraSimTick')).toBe('ep_cobra_sim');
    expect(porFn.get('runEletropostoRetornoTick')).toBe('ep_retorno');
    expect(porFn.get('runEletropostoNaoAtendidoFupTick')).toBe('ep_nao_atendido');
    expect(porFn.get('runSolarAgendaGiovannaTick')).toBe('solar_giovanna');
  });
});
