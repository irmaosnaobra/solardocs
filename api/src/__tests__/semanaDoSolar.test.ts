import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── A SEMANA DO SOLAR VIVE EM QUATRO ARQUIVOS (01/10/2026) ─────────────────
//
// A LP vende os horários, dois serviços marcam, e o reciclo devolve. Os quatro
// precisam concordar sobre que dia existe — e em 01/10 não concordavam: o
// reciclo era o único que achava sábado dia útil, com um comentário dizendo que
// a LP vendia sábado. A LP não vende.
//
// O preço, medido no dia em que o ciclo passou a devolver a base inteira: 30
// cards no sábado 03/10, 22 deles com "bom dia, hoje tem ligação" marcado pra
// uma manhã em que ninguém atende.
//
// Este teste lê o FONTE dos quatro. É teste de estrutura, de propósito: o que
// quebrou não foi uma conta, foi duas cópias da mesma regra divergindo — e
// nenhum teste de comportamento de um dos lados pega isso, porque cada lado
// está certo sozinho.
//
// Se um dia o sábado ABRIR, ele abre nos quatro, e este teste é o lugar onde
// isso fica escrito.

const RAIZ = join(__dirname, '..', '..', '..');
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');

/** As quatro pontas e o trecho que decide o dia da semana em cada uma. */
const PONTAS: Array<{ nome: string; fonte: string; alvo: RegExp }> = [
  {
    nome: 'LP do solar (vitrine)',
    fonte: ler('dashboard', 'public', 'io', 'solar', 'index.html'),
    alvo: /if\(dow === 0 \|\| dow === 6\) return \[\];/,
  },
  {
    nome: 'nilceParaGiovanna (bom dia e oi)',
    fonte: ler('api', 'src', 'services', 'agenda', 'nilceParaGiovanna.ts'),
    alvo: /dow !== 0 && dow !== 6/,
  },
  {
    nome: 'leadsMetaService (entrada do Meta)',
    fonte: ler('api', 'src', 'services', 'agenda', 'leadsMetaService.ts'),
    alvo: /dow !== 0 && dow !== 6/,
  },
  {
    nome: 'reagendaSolarNaoAtendido (o reciclo)',
    fonte: ler('api', 'src', 'services', 'agenda', 'reagendaSolarNaoAtendido.ts'),
    alvo: /dow !== 0 && dow !== 6 && !ehFeriadoBR\(ymd\)/,
  },
];

describe('as quatro pontas fecham o fim de semana', () => {
  for (const p of PONTAS) {
    it(`${p.nome} fecha sábado e domingo`, () => {
      expect(p.fonte).toMatch(p.alvo);
    });
  }

  // A FORMA QUE FALHOU. `dow !== 0` sozinho fecha só o domingo, e foi assim que
  // o reciclo ficou aberto no sábado por semanas sem ninguém ver.
  it('nenhuma delas fecha SÓ o domingo', () => {
    const soDomingo = /dow !== 0 &&(?! dow !== 6)/;
    const erradas = PONTAS.filter(p => soDomingo.test(p.fonte)).map(p => p.nome);
    expect(erradas).toEqual([]);
  });
});

// O reciclo do solar e o do eletroposto escrevem na MESMA agenda. Se um achar
// que o sábado existe e o outro não, a grade fica com dois donos discordando —
// que é a mesma classe de defeito, só que entre produtos.
describe('o eletroposto também fecha, e pelo caminho dele', () => {
  it('a grade do eletroposto usa DIAS_UTEIS, e sábado não está lá', () => {
    const vagas = ler('api', 'src', 'services', 'io', 'eletropostoVagas.ts');
    const m = vagas.match(/const DIAS_UTEIS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(m).toBeTruthy();
    const dias = [...(m![1].matchAll(/\d/g))].map(x => Number(x[0])).sort();
    // 1..5 = segunda a sexta. 0 = domingo, 6 = sábado.
    expect(dias).toEqual([1, 2, 3, 4, 5]);
  });
});
