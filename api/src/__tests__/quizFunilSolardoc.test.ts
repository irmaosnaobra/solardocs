import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  montarFunil, CONFIG_SOLARDOC, PERGUNTAS_SOLARDOC, CURTAS_SOLARDOC, CAMINHOS_SOLARDOC, DESTINOS_SOLARDOC,
  ehVisitaDaLpSolardoc, type EventoQuiz,
} from '../services/io/quizFunil';
import { IDS_PERGUNTAS_SD } from '../services/solardoc/quizSolardoc';

// O painel só enxerga o que a página grava. Se um passo mudar de id na página, a
// pergunta some do painel sem erro: este teste lê o HTML e pega antes do deploy.
// A página nasce no outro lado do plano (dashboard/public/diagnostico/index.html);
// enquanto o arquivo não existir, a conferência é pulada (aparece como "skipped").
const CAMINHO = join(__dirname, '../../../dashboard/public/diagnostico/index.html');
const existe = existsSync(CAMINHO);
const html = existe ? readFileSync(CAMINHO, 'utf8') : '';

describe('o painel e a página do diagnóstico falam dos mesmos passos', () => {
  it.skipIf(!existe)('cada pergunta da página tem texto no painel, na mesma ordem', () => {
    const idsDaPagina = [...html.matchAll(/\bQ\(\s*\d+\s*,\s*['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]);
    expect(idsDaPagina.length).toBeGreaterThanOrEqual(39);
    const doPainel = Object.keys(PERGUNTAS_SOLARDOC).filter((id) => !['capa', 'resultado', 'nome', 'whatsapp'].includes(id));
    expect(idsDaPagina).toEqual(doPainel);
  });
  it.skipIf(!existe)("a página manda lp: 'solardoc' e o caminho principal", () => {
    expect(html).toMatch(/lp\s*:\s*['"]solardoc['"]/);
    expect(html).toMatch(/caminho\s*:\s*['"]principal['"]/);
  });
  it.skipIf(!existe)('todo destino que a página grava tem nome no painel', () => {
    const destinos = [...html.matchAll(/destino\s*:\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]);
    for (const d of destinos) expect(Object.keys(DESTINOS_SOLARDOC)).toContain(d);
  });
  it.skipIf(!existe)('a página chama a rota do lead pelo mesmo domínio', () => {
    expect(html).toContain("'/_api'");
    expect(html).toContain("'/solardoc/quiz'");
  });
});

describe('a configuração do painel do SolarDoc', () => {
  it('cada pergunta que vai em respostas tem texto, rótulo curto e lugar no caminho', () => {
    const passos = CAMINHOS_SOLARDOC[0].passos;
    for (const id of IDS_PERGUNTAS_SD) {
      expect(PERGUNTAS_SOLARDOC[id], id).toBeTruthy();
      expect(CURTAS_SOLARDOC[id], id).toBeTruthy();
      expect(passos).toContain(id);
    }
  });
  it('são 39 perguntas (as 36 de respostas, mais empresa, uf e cidade), a capa, o resultado e o portão', () => {
    const ids = Object.keys(PERGUNTAS_SOLARDOC);
    expect(ids).toHaveLength(39 + 4);
    for (const extra of ['empresa', 'uf', 'cidade', 'capa', 'resultado', 'nome', 'whatsapp']) expect(ids).toContain(extra);
    expect(Object.keys(CURTAS_SOLARDOC)).toEqual(ids);
  });
  it('a ordem do painel é a da página: o resultado fica entre followup e documentos, e o portão no fim', () => {
    const ids = Object.keys(PERGUNTAS_SOLARDOC);
    expect(ids[0]).toBe('capa');
    expect(ids.indexOf('followup') + 1).toBe(ids.indexOf('resultado'));
    expect(ids.indexOf('resultado') + 1).toBe(ids.indexOf('documentos'));
    expect(ids.slice(-3)).toEqual(['quando_comecar', 'nome', 'whatsapp']);
  });
  it('lp, destinos e visita', () => {
    expect(CONFIG_SOLARDOC.lp).toBe('solardoc');
    expect(CONFIG_SOLARDOC.medindoDesde).toBe('2026-10-24');
    expect(Object.keys(DESTINOS_SOLARDOC)).toEqual(['cartao', 'pix', 'pix_auto', 'duvida', 'equipe', 'carla', 'socio', 'plano']);
    expect(CAMINHOS_SOLARDOC.map((c) => c.id)).toEqual(['principal']);
    expect(ehVisitaDaLpSolardoc('https://solardoc.app/diagnostico')).toBe(true);
    expect(ehVisitaDaLpSolardoc('https://solardoc.app/diagnostico?utm_term=1')).toBe(true);
    expect(ehVisitaDaLpSolardoc('https://solardoc.app/diagnostico/')).toBe(true);
    expect(ehVisitaDaLpSolardoc('https://solardoc.app/diagnosticos')).toBe(false);
    expect(ehVisitaDaLpSolardoc('https://solardoc.app/io/solar')).toBe(false);
    expect(ehVisitaDaLpSolardoc(null)).toBe(false);
  });
});

describe('a conta do funil com a configuração do SolarDoc', () => {
  const ev = (s: string, tipo: string, d: Record<string, unknown>, seq: number, lp = 'solardoc'): EventoQuiz =>
    ({ session_id: s, event_type: tipo, event_data: { lp, caminho: 'principal', pl: 1, seq, ...d }, created_at: '2026-10-25T12:00:00Z' });
  it('conta quem parou e quem foi ao cartão, e ignora evento de outra LP', () => {
    const eventos: EventoQuiz[] = [
      ev('a', 'quiz_passo', { passo: 'capa' }, 1),
      ev('a', 'quiz_passo', { passo: 'papel' }, 2),
      ev('b', 'quiz_passo', { passo: 'capa' }, 1),
      ev('b', 'quiz_passo', { passo: 'whatsapp' }, 2),
      ev('b', 'quiz_fim', { destino: 'cartao' }, 3),
      ev('c', 'quiz_passo', { passo: 'conta' }, 1, 'solar'),
    ];
    const f = montarFunil(eventos, [{ session_id: 'b', landing_url: 'https://solardoc.app/diagnostico?utm_campaign=x', utm_campaign: 'x' }], { config: CONFIG_SOLARDOC });
    expect(f.abriram).toBe(2);
    expect(f.terminaram).toBe(1);
    expect(f.destinos).toEqual({ cartao: 1 });
    const c = f.caminhos.find((x) => x.id === 'principal')!;
    expect(c.passos.find((p) => p.id === 'papel')!.pararam).toBe(1);
    expect(c.passos.find((p) => p.id === 'papel')!.pergunta).toBe('Qual é o seu papel na venda de energia solar?');
    expect(f.campanhas[0]).toMatchObject({ campanha: 'x', reunioes: 1 });
  });
});
