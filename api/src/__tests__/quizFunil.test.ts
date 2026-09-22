import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  montarFunil, CAMINHOS, PERGUNTAS, CURTAS, DESTINOS, ehVisitaDaLp, inicioDoPeriodo, fimDoPeriodo,
  type EventoQuiz,
} from '../services/io/quizFunil';

// O painel do quiz só enxerga o que a LP grava. Se um passo mudar de id lá, a
// pergunta some do painel sem erro nenhum; se a LP deixar de mandar o fim de um
// caminho, o painel conta quem terminou como quem desistiu. Os dois primeiros
// blocos deste teste leem o HTML da LP para pegar isso antes do deploy.
const LP = join(__dirname, '../../../dashboard/public/io/eletroposto/index.html');
const html = readFileSync(LP, 'utf8');

describe('o painel e a LP falam dos mesmos passos', () => {
  const inicio = html.indexOf('const PASSOS = [');
  const fim = html.indexOf('];', inicio);
  const idsDaLp = [...html.slice(inicio, fim).matchAll(/\{ id:'(p-[a-z-]+)'/g)].map((m) => m[1]);

  it('toda pergunta da LP tem texto no painel', () => {
    expect(idsDaLp.length).toBeGreaterThan(10);
    for (const id of idsDaLp) expect(PERGUNTAS[id], id).toBeTruthy();
    for (const id of idsDaLp) expect(CURTAS[id], id).toBeTruthy();
  });

  it('todo passo de caminho existe na LP', () => {
    for (const c of CAMINHOS) for (const p of c.passos) expect(idsDaLp, `${c.id}: ${p}`).toContain(p);
  });

  it('a LP grava pergunta vista, erro e fim', () => {
    expect(html).toContain("lpFunil('quiz_passo'");
    expect(html).toContain("lpFunil('quiz_erro'");
    expect(html).toContain("lpFunil('quiz_fim'");
    expect(html).toContain("window.quizFim('reuniao'");
    expect(html).toContain('window.lpEvt = evt');
  });

  it('todo destino que a LP grava tem nome no painel', () => {
    const mapa = html.slice(html.indexOf('var FIM_DO_QUIZ = {'), html.indexOf('};', html.indexOf('var FIM_DO_QUIZ = {')));
    const destinos = [...mapa.matchAll(/:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(destinos.length).toBeGreaterThan(3);
    for (const d of [...destinos, 'reuniao', 'curso']) expect(DESTINOS[d], d).toBeTruthy();
  });
});

// ── a conta ──────────────────────────────────────────────────────────────────
let n = 0;
const ev = (sid: string, tipo: string, dados: Record<string, unknown>, criado?: string): EventoQuiz => ({
  session_id: sid,
  event_type: tipo,
  event_data: { lp: 'eletroposto', pl: 1000, seq: ++n, ...dados },
  created_at: criado || new Date(Date.UTC(2026, 8, 22, 12, 0, n)).toISOString(),
});
const passos = (sid: string, caminho: string, ids: string[]) =>
  ids.map((p) => ev(sid, 'quiz_passo', { passo: p, caminho }));

describe('montarFunil', () => {
  n = 0;
  const eventos: EventoQuiz[] = [
    // A: abriu e não escolheu porta
    ...passos('A', 'inicio', ['p-porta']),
    // B: comércio, parou no ponto, levou erro de endereço
    ...passos('B', 'inicio', ['p-porta']),
    ...passos('B', 'comercio', ['p-porta', 'p-horario', 'p-nome', 'p-cidade', 'p-perfil', 'p-ponto']),
    ev('B', 'quiz_erro', { passo: 'p-ponto', msg: 'Informe a rua ou avenida do ponto.', caminho: 'comercio' }),
    // C: comércio até o fim, reunião
    ...passos('C', 'comercio', ['p-porta', 'p-horario', 'p-nome', 'p-cidade', 'p-perfil', 'p-ponto', 'p-modelo', 'p-decisor', 'p-whatsapp']),
    ev('C', 'quiz_fim', { destino: 'reuniao', caminho: 'comercio' }),
    // D: investidor sem local, cadastrado
    ...passos('D', 'investidor', ['p-porta', 'p-cap-local']),
    ...passos('D', 'investidor_sem_local', ['p-inv-valor', 'p-nome', 'p-cidade', 'p-whatsapp']),
    ev('D', 'quiz_fim', { destino: 'investidor', caminho: 'investidor_sem_local' }),
    // E: comércio que chegou no WhatsApp; o evento do WhatsApp chegou ANTES do
    // da cidade no banco, mas foi clicado depois. Parou no WhatsApp.
    ...passos('E', 'comercio', ['p-porta', 'p-horario', 'p-nome']),
    ev('E', 'quiz_passo', { passo: 'p-whatsapp', caminho: 'comercio', seq: 900 }, '2026-09-22T11:00:00.000Z'),
    ev('E', 'quiz_passo', { passo: 'p-cidade', caminho: 'comercio', seq: 800 }, '2026-09-22T13:00:00.000Z'),
    // F: evento de outra LP não entra
    { session_id: 'F', event_type: 'quiz_passo', event_data: { lp: 'outra', passo: 'p-porta' }, created_at: '2026-09-22T12:00:00Z' },
  ];
  const visitas = [
    { session_id: 'A', landing_url: 'https://solardoc.app/io/eletroposto?utm_campaign=x', utm_campaign: 'camp1' },
    { session_id: 'B', landing_url: 'https://solardoc.app/io/eletroposto', utm_campaign: 'camp1' },
    { session_id: 'C', landing_url: 'https://solardoc.app/io/eletroposto', utm_campaign: 'camp2' },
    { session_id: 'D', landing_url: 'https://solardoc.app/io/eletroposto', utm_campaign: 'camp2' },
    { session_id: 'E', landing_url: 'https://solardoc.app/io/eletroposto', utm_campaign: null },
    { session_id: 'G', landing_url: 'https://solardoc.app/io/eletroposto', utm_campaign: 'camp1' },
    { session_id: 'H', landing_url: 'https://solardoc.app/io/eletroposto/parceria', utm_campaign: 'camp1' },
  ];
  const f = montarFunil(eventos, visitas);
  const cam = (id: string) => f.caminhos.find((c) => c.id === id)!;
  const passo = (c: string, p: string) => cam(c).passos.find((x) => x.id === p)!;

  it('conta a ponta do funil', () => {
    expect(f.visitas).toBe(6);            // H é da /parceria
    expect(f.abriram).toBe(5);            // G só visitou; F é de outra LP
    expect(f.escolheram_porta).toBe(4);
    expect(f.terminaram).toBe(2);
    expect(f.destinos).toEqual({ reuniao: 1, investidor: 1 });
  });

  it('cada sessão cai no caminho em que estava por último', () => {
    expect(cam('inicio').sessoes).toBe(1);
    expect(cam('comercio').sessoes).toBe(3);
    expect(cam('investidor_sem_local').sessoes).toBe(1);
    expect(cam('investidor').sessoes).toBe(0);
  });

  it('parou é a última pergunta vista de quem não terminou, na ordem do clique', () => {
    expect(passo('inicio', 'p-porta').pararam).toBe(1);
    expect(passo('comercio', 'p-ponto').pararam).toBe(1);
    expect(passo('comercio', 'p-whatsapp').pararam).toBe(1);   // E, pelo seq
    expect(passo('comercio', 'p-cidade').pararam).toBe(0);
    expect(passo('comercio', 'p-whatsapp').chegaram).toBe(2);   // C e E
    expect(passo('comercio', 'p-porta').chegaram).toBe(3);
  });

  it('o erro fica na pergunta em que travou', () => {
    expect(passo('comercio', 'p-ponto').erros).toEqual([{ msg: 'Informe a rua ou avenida do ponto.', sessoes: 1 }]);
  });

  it('campanha: visitas, quem abriu e quem terminou', () => {
    const c1 = f.campanhas.find((c) => c.campanha === 'camp1')!;
    const c2 = f.campanhas.find((c) => c.campanha === 'camp2')!;
    expect(c1).toMatchObject({ visitas: 3, abriram: 2, terminaram: 0, reunioes: 0 });
    expect(c2).toMatchObject({ visitas: 2, abriram: 2, terminaram: 2, reunioes: 1 });
    expect(f.campanhas.find((c) => c.campanha === '(sem campanha)')).toMatchObject({ visitas: 1 });
  });
});

describe('miúdos', () => {
  it('visita da LP não inclui as páginas-filhas', () => {
    expect(ehVisitaDaLp('https://solardoc.app/io/eletroposto')).toBe(true);
    expect(ehVisitaDaLp('https://solardoc.app/io/eletroposto?pagina=1')).toBe(true);
    expect(ehVisitaDaLp('https://solardoc.app/io/eletroposto#simulador')).toBe(true);
    expect(ehVisitaDaLp('https://solardoc.app/io/eletroposto/parceria?lado=capital')).toBe(false);
    expect(ehVisitaDaLp('https://solardoc.app/io/eletroposto/material')).toBe(false);
    expect(ehVisitaDaLp('https://solardoc.app/io/eletropostox')).toBe(false);
  });

  it('hoje começa à meia-noite de São Paulo, e ontem termina nela', () => {
    const agora = Date.parse('2026-09-22T01:30:00Z');   // 21/09 22:30 em SP
    expect(inicioDoPeriodo('hoje', agora)).toBe('2026-09-21T03:00:00.000Z');
    expect(inicioDoPeriodo('ontem', agora)).toBe('2026-09-20T03:00:00.000Z');
    expect(fimDoPeriodo('ontem', agora)).toBe('2026-09-21T03:00:00.000Z');
    expect(fimDoPeriodo('7dias', agora)).toBeNull();
  });
});
