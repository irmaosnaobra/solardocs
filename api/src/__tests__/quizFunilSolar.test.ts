import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  montarFunil, CONFIG_SOLAR, PERGUNTAS_SOLAR, CAMINHOS_SOLAR, DESTINOS_SOLAR, ehVisitaDaLpSolar, type EventoQuiz,
} from '../services/io/quizFunil';

// O painel só enxerga o que a página grava. Se um passo mudar de id na página,
// a pergunta some do painel sem erro: este teste lê o HTML e pega antes do deploy.
const html = readFileSync(join(__dirname, '../../../dashboard/public/io/solar/index.html'), 'utf8');
const idsDaPagina = [...html.matchAll(/\{ id:'([a-z]+)'/g)].map(m => m[1]);

describe('o painel e a página do quiz solar falam dos mesmos passos', () => {
  it('cada passo da página tem pergunta no painel, na mesma ordem', () => {
    expect(idsDaPagina.length).toBeGreaterThan(10);
    expect(idsDaPagina).toEqual(Object.keys(PERGUNTAS_SOLAR));
  });
  it('os caminhos usam só passos que existem', () => {
    for (const c of CAMINHOS_SOLAR) for (const p of c.passos) expect(idsDaPagina).toContain(p);
  });
  it('a página manda lp:solar e todo destino que ela grava tem nome no painel', () => {
    expect(html).toContain("lp: 'solar'");
    const destinos = [...html.matchAll(/fimDoQuiz\('([a-z_]+)'\)/g)].map(m => m[1]);
    for (const d of destinos) expect(Object.keys(DESTINOS_SOLAR)).toContain(d);
    for (const c of ['vistoria', 'video', 'ligacao']) expect(Object.keys(DESTINOS_SOLAR)).toContain(c);
  });
  it('a página não carrega cópia da régua (quem decide é o servidor)', () => {
    expect(html).not.toMatch(/KWH_CORTE|KWH_VISITA|RAIO_VISITA|GRADE_SOCIOS|GRADE_NILCE/);
  });
});

describe('a conta do funil com a configuração do solar', () => {
  const ev = (s: string, tipo: string, d: Record<string, unknown>, seq: number): EventoQuiz =>
    ({ session_id: s, event_type: tipo, event_data: { lp: 'solar', pl: 1, seq, ...d }, created_at: '2026-10-08T12:00:00Z' });
  it('conta quem parou e quem marcou, e ignora evento do eletroposto', () => {
    const eventos: EventoQuiz[] = [
      ev('a', 'quiz_passo', { passo: 'conta', caminho: 'inicio' }, 1),
      ev('a', 'quiz_passo', { passo: 'tipo', caminho: 'respondendo' }, 2),
      ev('b', 'quiz_passo', { passo: 'conta', caminho: 'inicio' }, 1),
      ev('b', 'quiz_passo', { passo: 'horario', caminho: 'vistoria' }, 2),
      ev('b', 'quiz_fim', { destino: 'vistoria', caminho: 'vistoria' }, 3),
      { session_id: 'c', event_type: 'quiz_passo', event_data: { lp: 'eletroposto', passo: 'p-porta', pl: 1, seq: 1 }, created_at: '2026-10-08T12:00:00Z' },
    ];
    const f = montarFunil(eventos, [{ session_id: 'b', landing_url: 'https://solardoc.app/io/solar?utm_campaign=x', utm_campaign: 'x' }], { config: CONFIG_SOLAR });
    expect(f.abriram).toBe(2);
    expect(f.terminaram).toBe(1);
    expect(f.destinos).toEqual({ vistoria: 1 });
    const resp = f.caminhos.find(c => c.id === 'respondendo')!;
    expect(resp.passos.find(p => p.id === 'tipo')!.pararam).toBe(1);
    expect(f.campanhas[0]).toMatchObject({ campanha: 'x', reunioes: 1 });
  });
  it('visita da LP é a /io/solar, não o simulador antigo', () => {
    expect(ehVisitaDaLpSolar('https://solardoc.app/io/solar')).toBe(true);
    expect(ehVisitaDaLpSolar('https://solardoc.app/io/solar?utm_term=1')).toBe(true);
    expect(ehVisitaDaLpSolar('https://solardoc.app/io/solar/simulador')).toBe(false);
  });
});
