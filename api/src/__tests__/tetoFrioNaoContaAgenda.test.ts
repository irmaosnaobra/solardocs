import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// De 14 a 17/09/2026 nenhum follow-up da casa saiu. Nem a retomada da Carla, nem
// a Bia, nem a semente, nem a repescagem do eletroposto. Eles não estavam
// quebrados: o teto do FRIO somava também os envios da AGENDA, e a agenda fez
// 83, 89, 122 e 116 envios nesses dias. Com teto frio de 30/dia, sobrava zero.
//
// Este teste tranca a separação. Se alguém voltar a somar agenda na conta do
// frio, o sintoma não é tela vermelha: é o follow-up sumir de novo, calado, e
// só aparecer semanas depois como "ninguém está respondendo os leads".
// ─────────────────────────────────────────────────────────────────────────────

const db: { state: Array<{ key: string; updated_at: string }> } = { state: [] };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _filtros: [] as Array<(r: any) => boolean>,
        select() { return q; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        eq() { return q; },
        or(expr: string) {
          const prefixos = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
          q._filtros.push((r: any) => prefixos.some(p => String(r.key).startsWith(p)));
          return q;
        },
        gte(col: string, val: string) { q._filtros.push((r: any) => String(r[col]) >= val); return q; },
        limit(n: number) {
          const linhas = db.state.filter(r => q._filtros.every((f: any) => f(r))).slice(0, n);
          return Promise.resolve({ data: linhas, error: null });
        },
      };
      return q;
    },
  },
}));

const agora = () => new Date().toISOString();
function semear(prefixo: string, quantos: number) {
  for (let i = 0; i < quantos; i++) db.state.push({ key: `${prefixo}pessoa${i}`, updated_at: agora() });
}

const envOriginal = { ...process.env };
beforeEach(() => { db.state = []; vi.resetModules(); });
afterEach(() => { process.env = { ...envOriginal }; });

const linha = () => import('../services/agents/whatsapp/lineThrottle');

describe('teto frio × tráfego de agenda', () => {
  it('dia cheio de agenda NÃO cala o follow-up (o caso de 14 a 17/09)', async () => {
    semear('ep_agenda_sent:', 68);        // agendamento do eletroposto
    semear('solar_giovanna_sent:', 50);   // toques do dia da reunião
    const { dentroDoTetoHorarioLinha } = await linha();

    expect(await dentroDoTetoHorarioLinha()).toBe(true);
  });

  it('o teto do frio continua valendo entre os robôs frios', async () => {
    semear('carla_retomada:', 30);        // o próprio frio encheu o dia
    const { dentroDoTetoHorarioLinha } = await linha();

    expect(await dentroDoTetoHorarioLinha()).toBe(false);
  });

  it('quem é transacional continua enxergando a linha inteira', async () => {
    semear('ep_agenda_sent:', 68);
    const { dentroDoTetoHorarioLinha } = await linha();

    // Sem piso, o transacional vê os 68 da agenda e segura: é ele quem decide
    // passar por cima, com piso declarado na chamada.
    expect(await dentroDoTetoHorarioLinha({ transacional: true })).toBe(false);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora: 200, pisoDia: 200 })).toBe(true);
  });

  it('o espaçamento continua enxergando a agenda — follow-up não sai colado em lembrete', async () => {
    db.state.push({ key: 'ep_agenda_sent:alguem', updated_at: agora() });
    const { respeitaEspacamentoLinha } = await linha();

    expect(await respeitaEspacamentoLinha()).toBe(false);
  });

  it('teto por HORA do frio: seis envios frios na hora seguram o sétimo', async () => {
    semear('gerador_followup:', 6);
    const { dentroDoTetoHorarioLinha } = await linha();

    expect(await dentroDoTetoHorarioLinha()).toBe(false);
  });
});
