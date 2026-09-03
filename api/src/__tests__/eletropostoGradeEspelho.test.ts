import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A LP E O BACKEND TÊM QUE VENDER A MESMA GRADE.
//
// O comentário nos dois arquivos pede isso desde sempre — "mudou lá, muda aqui,
// senão o robô oferece no WhatsApp horário que a página não vende" — e até aqui
// quem garantia era a disciplina de quem editava. São duas linguagens, dois
// arquivos, e desde 03/09 duas implementações da mesma conta de feriado e do
// mesmo "este dia absorve a emenda?".
//
// Este teste LÊ o JavaScript da LP e roda os dois lado a lado. Se alguém mexer
// num só, ele aponta o dia exato em que discordaram.
import { horasDoDia, agendaAbre } from '../services/io/eletropostoVagas';

const LP = join(__dirname, '../../../dashboard/public/io/eletroposto/index.html');

/** Recorta da LP só os pedaços que decidem a grade e devolve o `gradeDoDia` dela. */
function gradeDoDiaDaLP(): (ymd: string) => string[] {
  const html = readFileSync(LP, 'utf8');
  const fatia = (de: string, ate: string): string => {
    const i = html.indexOf(de);
    const j = html.indexOf(ate);
    // Marcador que sumiu = LP refatorada. Falhar aqui é o ponto: melhor um teste
    // quebrado do que um teste que passa sem comparar nada.
    if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu da LP: "${de}" … "${ate}"`);
    return html.slice(i, j);
  };
  const fonte =
    `const TZ_BR='America/Sao_Paulo';\n` +
    fatia('const _p2 = n =>', 'const TZ_BR') +
    fatia('const FAIXAS_SEGUNDA', '// Busca o que já está ocupado') +
    `\nreturn gradeDoDia;`;
  return new Function(fonte)() as (ymd: string) => string[];
}

describe('a grade da LP e a do backend são a mesma', () => {
  it('concordam dia a dia por 18 meses, feriados incluídos', () => {
    const gradeLP = gradeDoDiaDaLP();
    const divergencias: string[] = [];

    const d = new Date(Date.UTC(2026, 8, 1));   // 01/09/2026
    for (let i = 0; i < 550; i++) {
      const ymd = d.toISOString().slice(0, 10);
      const backend = agendaAbre(ymd) ? [...horasDoDia(ymd)] : [];
      const lp = gradeLP(ymd);
      if (JSON.stringify(backend) !== JSON.stringify(lp)) {
        divergencias.push(`${ymd}\n  backend: ${backend.join(' ') || '(fechado)'}\n  LP     : ${lp.join(' ') || '(fechado)'}`);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }

    expect(divergencias.join('\n')).toBe('');
  });

  it('a amostra que importa: os feriados de 2026 e as terças que herdam', () => {
    const gradeLP = gradeDoDiaDaLP();
    // 07/09, 12/10 e 20/11 caem em segunda-feira; 02/11 também.
    for (const feriado of ['2026-09-07', '2026-10-12', '2026-11-02', '2026-11-20', '2026-12-25']) {
      expect(gradeLP(feriado)).toEqual([]);
      expect(agendaAbre(feriado)).toBe(false);
    }
    // A terça seguinte a cada feriado de segunda herda a manhã.
    for (const terca of ['2026-09-08', '2026-10-13', '2026-11-03']) {
      expect(horasDoDia(terca)).toContain('10:00');
      expect(gradeLP(terca)).toContain('10:00');
      expect(horasDoDia(terca).length).toBe(12);
    }
  });
});
