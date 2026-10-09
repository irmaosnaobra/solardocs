import { describe, it, expect, vi } from 'vitest';

// As duas faixas da Nilce e da Giovanna (09/10/2026): cliente novo em :00 e :30,
// follow-up em :15 e :45, das 08 às 17. Três pontas marcam horário nessas
// agendas e as três têm que concordar (a lição do eletroposto, 30/09: quando
// duas pontas discordam, uma vende o que a outra recusa). Este arquivo compara.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));

import {
  GRADE_NOVO_LIGACAO, GRADE_FOLLOWUP_LIGACAO, GRADE_LIGACAO, temDuasFaixas, decidirCaminho,
} from '../services/agenda/solarRota';
import { primeiraVaga, gradeDoFollowup, GRADE_NILCE } from '../services/agenda/reagendaSolarNaoAtendido';
import { montarVitrine, msDe, type Ocupacao } from '../services/io/solarQuiz';

const minuto = (h: string) => h.slice(3);

describe('as duas faixas', () => {
  it('cliente novo: 08:00 a 16:30, só :00 e :30', () => {
    expect(GRADE_NOVO_LIGACAO[0]).toBe('08:00');
    expect(GRADE_NOVO_LIGACAO[GRADE_NOVO_LIGACAO.length - 1]).toBe('16:30');
    expect(GRADE_NOVO_LIGACAO).toHaveLength(18);
    expect(GRADE_NOVO_LIGACAO.every(h => ['00', '30'].includes(minuto(h)))).toBe(true);
    expect(GRADE_NOVO_LIGACAO).toContain('12:00');   // almoço aberto: ele deu a janela inteira
  });
  it('follow-up: 08:15 a 16:45, só :15 e :45', () => {
    expect(GRADE_FOLLOWUP_LIGACAO[0]).toBe('08:15');
    expect(GRADE_FOLLOWUP_LIGACAO[GRADE_FOLLOWUP_LIGACAO.length - 1]).toBe('16:45');
    expect(GRADE_FOLLOWUP_LIGACAO).toHaveLength(18);
    expect(GRADE_FOLLOWUP_LIGACAO.every(h => ['15', '45'].includes(minuto(h)))).toBe(true);
  });
  it('as faixas não se cruzam', () => {
    expect(GRADE_NOVO_LIGACAO.filter(h => GRADE_FOLLOWUP_LIGACAO.includes(h))).toEqual([]);
  });
  it('vale para a Nilce e a Giovanna; os sócios ficam na grade antiga', () => {
    expect(temDuasFaixas('Giovanna')).toBe(true);
    expect(temDuasFaixas('Nilce')).toBe(true);
    expect(temDuasFaixas('Thiago')).toBe(false);
    expect(gradeDoFollowup('Giovanna')).toBe(GRADE_FOLLOWUP_LIGACAO);
    expect(gradeDoFollowup('Diego')).toBe(GRADE_NILCE);
  });
});

describe('as três pontas concordam', () => {
  const AGORA = msDe('2026-10-12', '07:00');   // segunda 12/10 (feriado): o primeiro dia útil é a terça 13/10

  it('a vitrine do quiz vende a faixa de cliente novo', () => {
    expect(GRADE_LIGACAO).toBe(GRADE_NOVO_LIGACAO);
    const dias = montarVitrine(decidirCaminho({ conta: 'ate300', cidade: 'Uberaba', urgencia: '3meses', decisor: 'junto', pagamento: 'financiamento', imovel: 'proprio' }), [], AGORA);
    expect(dias[0].horas.map(x => x.h)).toEqual([...GRADE_NOVO_LIGACAO]);
  });

  it('follow-up em todos os :15 e :45 do dia não tira nenhum horário da vitrine', () => {
    const cheio: Ocupacao[] = GRADE_FOLLOWUP_LIGACAO.map(h => ({ dono: 'Giovanna', ini: msDe('2026-10-13', h), fim: msDe('2026-10-13', h) + 15 * 60_000 }));
    const dias = montarVitrine(decidirCaminho({ conta: 'ate300', cidade: 'Uberaba', urgencia: '3meses', decisor: 'junto', pagamento: 'financiamento', imovel: 'proprio' }), cheio, AGORA);
    expect(dias[0].ymd).toBe('2026-10-13');
    expect(dias[0].horas).toHaveLength(18);
  });

  it('o robô de follow-up da Giovanna nunca devolve :00 nem :30', () => {
    const novos = GRADE_NOVO_LIGACAO.map(h => ({ ini: msDe('2026-10-13', h), dur: 15 * 60_000 }));
    const iso = primeiraVaga(novos, AGORA, ['2026-10-13'], gradeDoFollowup('Giovanna'))!;
    expect(new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })).toBe('08:15');
    for (let i = 0; i < 18; i++) {
      const ocupados = GRADE_FOLLOWUP_LIGACAO.slice(0, i).map(h => ({ ini: msDe('2026-10-13', h), dur: 15 * 60_000 }));
      const v = primeiraVaga([...novos, ...ocupados], AGORA, ['2026-10-13'], gradeDoFollowup('Giovanna'))!;
      expect(['15', '45']).toContain(new Date(v).toISOString().slice(14, 16));
    }
  });
});
