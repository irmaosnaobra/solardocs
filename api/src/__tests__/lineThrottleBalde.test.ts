import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Terceiro balde do lineThrottle (21/10/2026): ag5040_sent: e ficha_lead: (as respostas das agentes da 5040 e a ficha ao
// consultor) contam SÓ no ESPAÇAMENTO da linha, com janela curta de 2 min. NÃO contam no teto do frio nem em nenhuma conta do
// transacional (hora ou dia): robô de agenda e boas-vindas não podem ser segurados por resposta das agentes. O 20/1 h, o 120/24 h e o
// 60/450 das agentes moram no vivoEnvio.

type Row = { key: string; value?: unknown; updated_at: string };
const db: { rows: Row[]; chamadas: number; erro: boolean } = { rows: [], chamadas: 0, erro: false };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      db.chamadas++;
      const filtros: Array<(r: Row) => boolean> = [];
      const q: any = {
        select() { return q; },
        or(expr: string) {
          const ps = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
          filtros.push(r => ps.some(p => r.key.startsWith(p))); return q;
        },
        like(_c: string, p: string) { const pre = p.replace(/%$/, ''); filtros.push(r => r.key.startsWith(pre)); return q; },
        gte(_c: string, v: string) { filtros.push(r => r.updated_at >= v); return q; },
        eq(_c: string, v: string) { filtros.push(r => r.key === v); return q; },
        maybeSingle() { const r = db.rows.find(x => filtros.every(f => f(x))); return Promise.resolve({ data: r ? { value: r.value } : null, error: null }); },
        limit(n: number) {
          if (db.erro) return Promise.resolve({ data: null, error: { message: 'banco caiu' } });
          return Promise.resolve({ data: db.rows.filter(r => filtros.every(f => f(r))).slice(0, n).map(r => ({ key: r.key })), error: null });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const envOriginal = { ...process.env };
beforeEach(() => { db.rows = []; db.chamadas = 0; db.erro = false; vi.resetModules(); delete process.env.LINHA_RECONECTADA_EM; });
afterEach(() => { process.env = { ...envOriginal }; });

const haMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const poe = (prefixo: string, n: number, minAtras: (i: number) => number) => {
  for (let i = 0; i < n; i++) db.rows.push({ key: `${prefixo}${i}`, updated_at: haMin(minAtras(i)) });
};
const carregar = () => import('../services/agents/whatsapp/lineThrottle');

describe('terceiro balde: ag5040_sent: e ficha_lead:', () => {
  it('a lista própria existe e NÃO está em prefixosDaLinha() (de onde saem os prefixos do frio)', async () => {
    const { PREFIXOS_RESPOSTA_AGENTES, prefixosDaLinha, prefixosTotalDaLinha } = await carregar();
    expect([...PREFIXOS_RESPOSTA_AGENTES]).toEqual(['ag5040_sent:', 'ficha_lead:', 'solardoc_aviso_sent:', 'solar_quiz_env:']);
    for (const p of PREFIXOS_RESPOSTA_AGENTES) {
      expect(prefixosDaLinha()).not.toContain(p);
      expect(prefixosTotalDaLinha()).toContain(p);
    }
    expect(prefixosTotalDaLinha().length).toBe(prefixosDaLinha().length + 4);
    const { PREFIXOS_AGENDA } = await carregar();
    for (const p of PREFIXOS_RESPOSTA_AGENTES) expect([...PREFIXOS_AGENDA]).not.toContain(p);
  });

  it('ESPAÇAMENTO: o balde tem janela de 2 min. Frio 3 min depois de uma resposta das agentes passa; 1 min depois espera', async () => {
    const { respeitaEspacamentoLinha } = await carregar();
    db.rows = [{ key: 'ag5040_sent:abc:1', updated_at: haMin(3) }];
    expect(await respeitaEspacamentoLinha()).toBe(true);
    db.rows = [{ key: 'ag5040_sent:abc:1', updated_at: haMin(1) }];
    expect(await respeitaEspacamentoLinha()).toBe(false);
    db.rows = [{ key: 'ficha_lead:abc', updated_at: haMin(3) }];
    expect(await respeitaEspacamentoLinha()).toBe(true);
    db.rows = [{ key: 'ficha_lead:abc', updated_at: haMin(1) }];
    expect(await respeitaEspacamentoLinha()).toBe(false);
  });

  it('ESPAÇAMENTO: o resto da linha segue com 10-15 min (carimbo comum há 3 min espera; há 20 min libera)', async () => {
    const { respeitaEspacamentoLinha } = await carregar();
    db.rows = [{ key: 'limpapro_grupo_sent:a@b.com', updated_at: haMin(3) }];
    expect(await respeitaEspacamentoLinha()).toBe(false);
    db.rows = [{ key: 'limpapro_grupo_sent:a@b.com', updated_at: haMin(20) }];
    expect(await respeitaEspacamentoLinha()).toBe(true);
    db.rows = [{ key: 'ag5040_sent:abc:1', updated_at: haMin(20) }];
    expect(await respeitaEspacamentoLinha()).toBe(true);
  });

  it('ESPAÇAMENTO com prefixos explícitos (a Carla fora do desvio) continua só com os dela', async () => {
    const { respeitaEspacamentoLinha } = await carregar();
    db.rows.push({ key: 'ag5040_sent:abc:1', updated_at: haMin(1) });
    expect(await respeitaEspacamentoLinha(['carla_sent:'])).toBe(true);
  });

  it('ESPACAMENTO_OFF=1 desliga o balde também', async () => {
    process.env.ESPACAMENTO_OFF = '1';
    const { respeitaEspacamentoLinha } = await carregar();
    db.rows.push({ key: 'ag5040_sent:abc:1', updated_at: haMin(1) });
    expect(await respeitaEspacamentoLinha()).toBe(true);
  });

  it('o balde NÃO entra no total da hora do transacional (agenda nunca bloqueia): 18 ag5040_sent: na hora, o transacional com piso 18 passa', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    poe('ag5040_sent:', 18, i => 5 + i * 3);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora: 18 })).toBe(true);
    expect(await dentroDoTetoHorarioLinha({ transacional: true })).toBe(true);       // nem sem piso
    poe('ficha_lead:', 18, i => 6 + i * 3);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora: 18 })).toBe(true);
  });

  it('controle: 18 solar_giovanna_sent: (agenda de verdade) na hora FECHAM o transacional de piso 18', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    poe('solar_giovanna_sent:', 18, i => 5 + i * 3);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, pisoHora: 18 })).toBe(false);
  });

  it('6 ag5040_sent: na hora: o frio continua sem enxergar o balde no teto (6/h e 30/24 h), mas espera a resposta mais recente de 2 min', async () => {
    const { respeitaEspacamentoLinha, dentroDoTetoHorarioLinha } = await carregar();
    poe('ag5040_sent:', 6, i => 1 + i * 8);   // 1, 9, ... 41 min atrás
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    expect(await respeitaEspacamentoLinha()).toBe(false);
  });

  it('a conta de 24 h NÃO muda: 150 respostas das agentes fora da última hora não fecham o frio nem o transacional (agenda nunca bloqueia)', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    poe('ag5040_sent:', 100, i => 90 + i * 10);
    poe('ficha_lead:', 50, i => 100 + i * 10);
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    expect(await dentroDoTetoHorarioLinha({ transacional: true })).toBe(true);
    expect(await dentroDoTetoHorarioLinha({ transacional: true, pisoDia: 200 })).toBe(true);
  });

  it('o teto do frio de 30/24 h continua valendo igual: 29 frios passam, 30 fecham, com ou sem respostas das agentes', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    poe('limpapro_recovery:', 29, i => 90 + i * 10);
    poe('ag5040_sent:', 40, i => 90 + i * 10);
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    poe('semente:', 1, () => 300);
    expect(await dentroDoTetoHorarioLinha()).toBe(false);
  });

  it('sem robo o número de consultas do teto é o de sempre (aquecimento, 1 h e 24 h)', async () => {
    const { dentroDoTetoHorarioLinha } = await carregar();
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    expect(db.chamadas).toBe(3);
  });
});

describe('a retomada dos usuários (03/11/2026): usu_rec_sent: pesa no frio, e a agenda tem a vez', () => {
  it('usu_rec_sent: está nos prefixos da linha e é FRIO (fora de PREFIXOS_AGENDA); a marca e a vez não são prefixo de envio', async () => {
    const { prefixosDaLinha, PREFIXOS_AGENDA } = await carregar();
    expect(prefixosDaLinha()).toContain('usu_rec_sent:');
    expect([...PREFIXOS_AGENDA]).not.toContain('usu_rec_sent:');
    for (const p of ['usu_rec_fora:', 'usu_rec_vez:', 'usu_rec_pausa', 'usu_rec_largada', 'usu_rec_resumo']) {
      expect(prefixosDaLinha().some(x => p.startsWith(x)), p).toBe(false);
    }
  });

  it('o teto do frio e as vagas enxergam a retomada: 6 envios na hora fecham o teto de 6/h, 5 não; e a agenda não os soma', async () => {
    const { dentroDoTetoHorarioLinha, vagasDoFrioLinha } = await carregar();
    poe('usu_rec_sent:', 5, i => 5 + i * 8);
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    poe('usu_rec_sent:', 1, () => 50);
    db.rows[db.rows.length - 1]!.key = 'usu_rec_sent:sexto';
    expect(await dentroDoTetoHorarioLinha()).toBe(false);
    expect((await vagasDoFrioLinha()).hora).toEqual({ teto: 6, usadas: 6 });
    // a agenda de verdade não entra na conta do frio, e a retomada não entra na da agenda
    db.rows = [];
    poe('ep_agenda_sent:', 12, i => 5 + i * 3);
    expect((await vagasDoFrioLinha()).hora.usadas).toBe(0);
  });

  it('as marcas usu_rec_fora: e as vezes usu_rec_vez: não contam no teto nem no espaçamento', async () => {
    const { dentroDoTetoHorarioLinha, respeitaEspacamentoLinha } = await carregar();
    poe('usu_rec_fora:', 40, i => 1 + i);
    poe('usu_rec_vez:', 10, () => 1);
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
    expect(await respeitaEspacamentoLinha()).toBe(true);
    poe('usu_rec_sent:', 1, () => 3);
    expect(await respeitaEspacamentoLinha()).toBe(false);          // o envio recente da retomada espera 10 a 15 min
  });

  it('carimbosDaLinhaNaHora conta agenda e frio juntos, na última hora, e nada de ag5040_sent: nem de mais de 1 h', async () => {
    const { carimbosDaLinhaNaHora } = await carregar();
    poe('ep_agenda_sent:', 2, i => 5 + i * 10);
    poe('usu_rec_sent:', 1, () => 20);
    poe('quiz_rec_sent:', 1, () => 30);
    poe('ag5040_sent:', 5, () => 2);                // resposta de agente: fora da conta da linha
    poe('ep_agenda_sent:velho', 1, () => 90);       // mais de 1 h
    poe('usu_rec_fora:', 3, () => 1);               // marca: não é envio
    expect(await carimbosDaLinhaNaHora()).toBe(4);
  });

  it('carimbosDaLinhaNaHora para no limite (padrão 5) e devolve o limite pedido', async () => {
    const { carimbosDaLinhaNaHora } = await carregar();
    poe('usu_rec_sent:', 9, i => 1 + i);
    expect(await carimbosDaLinhaNaHora()).toBe(5);
    expect(await carimbosDaLinhaNaHora(new Date(), 2)).toBe(2);
  });

  it('carimbosDaLinhaNaHora LANÇA quando a leitura falha (quem chama trata como "não envia"), ao contrário do contar() do teto', async () => {
    const { carimbosDaLinhaNaHora, dentroDoTetoHorarioLinha } = await carregar();
    db.erro = true;
    await expect(carimbosDaLinhaNaHora()).rejects.toThrow('carimbos_da_linha_na_hora');
    // o teto do frio, ao contrário, lê erro como zero (não muda nada do que já era)
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
  });
});
