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
import { horasDoDia, agendaAbre, ehHorarioDeAlmoco } from '../services/io/eletropostoVagas';

const LP = join(__dirname, '../../../dashboard/public/io/eletroposto/index.html');

/** Recorta da LP só os pedaços que decidem a grade e devolve o `gradeDoDia` dela. */
function funcoesDaLP() {
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
    fatia('const GRADE_INICIO_MIN', '// Busca o que já está ocupado') +
    `\nreturn { gradeDoDia, ehHorarioDeAlmoco };`;
  return new Function(fonte)() as { gradeDoDia: (ymd: string) => string[]; ehHorarioDeAlmoco: (hhmm: string) => boolean };
}

/** Os 17 horários de lead novo (13/10/2026): 08:00 às 17:30 sem o almoço. */
const GRADE_ESPERADA = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
];

describe('a grade da LP e a do backend são a mesma', () => {
  it('concordam dia a dia por 18 meses, feriados incluídos', () => {
    const gradeLP = funcoesDaLP().gradeDoDia;
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

  it('a amostra que importa: os feriados de 2026 fecham e a terça depois deles não herda nada', () => {
    const gradeLP = funcoesDaLP().gradeDoDia;
    // 07/09, 12/10 e 20/11 caem em segunda-feira; 02/11 também.
    for (const feriado of ['2026-09-07', '2026-10-12', '2026-11-02', '2026-11-20', '2026-12-25']) {
      expect(gradeLP(feriado)).toEqual([]);
      expect(agendaAbre(feriado)).toBe(false);
    }
    // Desde 13/10/2026 a terça depois do feriado tem a MESMA grade de qualquer dia.
    for (const terca of ['2026-09-08', '2026-10-13', '2026-11-03']) {
      expect(horasDoDia(terca)).toEqual(GRADE_ESPERADA);
      expect(gradeLP(terca)).toEqual(GRADE_ESPERADA);
    }
  });

  it('uma segunda, uma terça pós-feriado e uma sexta: LP e servidor entregam os mesmos 17 horários', () => {
    const gradeLP = funcoesDaLP().gradeDoDia;
    // 14/09 segunda comum, 13/10 terça depois do feriado de 12/10, 16/10 sexta.
    for (const dia of ['2026-09-14', '2026-10-13', '2026-10-16']) {
      expect(agendaAbre(dia)).toBe(true);
      expect([...horasDoDia(dia)]).toEqual(GRADE_ESPERADA);
      expect(gradeLP(dia)).toEqual(GRADE_ESPERADA);
      expect(gradeLP(dia)).toHaveLength(17);
    }
  });

  it('o almoço é o mesmo dos dois lados: nada que começa de 12:00 até 13:29 existe', () => {
    const { ehHorarioDeAlmoco: almocoLP, gradeDoDia: gradeLP } = funcoesDaLP();
    for (let m = 0; m < 24 * 60; m += 15) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      expect(almocoLP(hhmm)).toBe(ehHorarioDeAlmoco(hhmm));
    }
    for (const h of ['12:00', '12:15', '12:30', '12:45', '13:00', '13:15']) expect(ehHorarioDeAlmoco(h)).toBe(true);
    for (const h of ['11:45', '13:30', '13:45']) expect(ehHorarioDeAlmoco(h)).toBe(false);
    for (const h of ['12:00', '12:30', '13:00']) {
      expect(horasDoDia('2026-10-13')).not.toContain(h);
      expect(gradeLP('2026-10-13')).not.toContain(h);
    }
  });
});
