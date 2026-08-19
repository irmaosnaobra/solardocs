import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Repescagem do card VERMELHO: quem não apareceu recebe até 3 convites pra
// remarcar, com horários novos.
//
// Os riscos aqui são todos do mesmo tipo — falar DEMAIS com quem sumiu: mandar o
// convite antes de o horário passar (ele ainda podia entrar), mandar em cima de
// uma lista de horários que já está na mesa (o "2" dele viraria a reunião
// errada), mandar pra quem já respondeu, mandar de novo no mesmo dia e, o pior,
// ligar o módulo e disparar pra todo vermelho velho do banco de uma vez.

let fichas: any[] = [];
const state = new Map<string, { key: string; value: any; updated_at: string }>();
const historicos: Array<{ id: number; texto: string }> = [];

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: () => {
      const q: any = {
        _update: null as any,
        _filtros: {} as Record<string, any>,
        select() { return q; },
        eq(col: string, v: any) {
          if (q._update) {
            historicos.push({ id: Number(v), texto: String(q._update.historico || '') });
            return Promise.resolve({ error: null });
          }
          q._filtros[col] = v; return q;
        },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        lte(col: string, v: any) { q._filtros[`lte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          const piso = new Date(q._filtros['gte_quando']).getTime();
          const teto = new Date(q._filtros['lte_quando']).getTime();
          return Promise.resolve({
            data: fichas.filter(f =>
              f.status === q._filtros['status']
              && new Date(f.quando).getTime() >= piso
              && new Date(f.quando).getTime() <= teto),
            error: null,
          });
        },
      };
      return q;
    },
  },
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: async (_col: string, chaves: string[]) => ({
          data: chaves.filter(k => state.has(k)).map(k => state.get(k)), error: null,
        }),
      }),
      upsert: async (r: any) => { state.set(r.key, r); return { error: null }; },
    }),
  },
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

// A oferta em si é do `eletropostoRemarcar` e tem teste próprio. Aqui o que
// importa é QUANDO ela é chamada, com que tentativa, e o que fica gravado.
const ofertas: Array<{ id: number; rodada: number; bolhas: string[] }> = [];
let resultadoDaOferta: any = { acao: 'ofertou', ofertas: ['2026-08-21T16:00:00.000Z', '2026-08-21T17:00:00.000Z'] };
vi.mock('../services/io/eletropostoRemarcar', () => ({
  EP_REMARCAR_PREFIX: 'ep_remarcar:',
  bolhasRepescagemNoShow: (nome: string, ofs: string[], quem: string, _perdido: string, tentativa: number) =>
    [`tentativa ${tentativa} pra ${nome} com ${quem} (${ofs.length} horários)`],
  ofertarPorConta: vi.fn(async (ficha: any, copy: any, opts: any) => {
    ofertas.push({ id: ficha.id, rodada: opts?.rodada ?? 0, bolhas: copy('Irineu', ['x'], 'Diego') });
    return resultadoDaOferta;
  }),
}));
vi.mock('../services/io/eletropostoAgenda', () => ({
  quandoPorExtenso: (iso: string) => `dia ${iso}`,
}));

// 20/08/2026 (quinta), 15h BRT = 18h UTC — dentro da janela de 9h–19h.
const AGORA = new Date('2026-08-20T18:00:00.000Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

function ficha(over: Partial<any> = {}) {
  return {
    id: 3, cliente_nome: 'Irineu de Almeida', cliente_telefone: '5577991110001',
    quando: horasAtras(2), vendedor_nome: 'Diego', created_by: 'lp_eletroposto',
    status: 'nao_atendeu', lead_resposta_at: null, historico: null, ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  fichas = [ficha()]; state.clear(); historicos.length = 0; ofertas.length = 0;
  resultadoDaOferta = { acao: 'ofertou', ofertas: ['2026-08-21T16:00:00.000Z', '2026-08-21T17:00:00.000Z'] };
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function tick(opts: any = {}) {
  return (await import('../services/io/eletropostoNoShow')).runEletropostoNoShowTick(opts);
}

describe('primeiro convite', () => {
  it('quem perdeu a reunião há 2h recebe a lista de horários novos', async () => {
    const r = await tick();
    expect(r.ofertados).toBe(1);
    expect(ofertas).toHaveLength(1);
    expect(ofertas[0].bolhas[0]).toContain('tentativa 1');
    expect(state.get('ep_noshow:3')?.value).toMatchObject({ n: 1 });
  });

  it('a tentativa vira linha no card — vermelho parado e vermelho trabalhado não podem ser a mesma tela', async () => {
    await tick();
    expect(historicos).toHaveLength(1);
    expect(historicos[0].texto).toContain('Repescagem 1/3');
  });

  it('não fala com quem acabou de perder o horário (o toque de 5 min ainda estava saindo)', async () => {
    fichas = [ficha({ quando: new Date(AGORA.getTime() - 20 * 60_000).toISOString() })];
    expect((await tick()).ofertados).toBe(0);
  });

  it('reunião anterior ao piso duro não é repescada — ligar o módulo não pode virar disparo', async () => {
    fichas = [ficha({ quando: '2026-08-18T18:00:00.000Z' })];
    expect((await tick()).ofertados).toBe(0);
  });
});

describe('quem fica de fora', () => {
  it('quem escreveu depois de perder o horário é conversa de gente, não fila de robô', async () => {
    fichas = [ficha({ lead_resposta_at: horasAtras(1) })];
    expect((await tick()).ofertados).toBe(0);
  });

  it('quem já tem lista de horários na mesa não recebe outra', async () => {
    state.set('ep_remarcar:3', { key: 'ep_remarcar:3', value: {}, updated_at: horasAtras(3) });
    expect((await tick()).ofertados).toBe(0);
  });

  it('oferta velha (mais de 24h) não segura a repescagem', async () => {
    state.set('ep_remarcar:3', { key: 'ep_remarcar:3', value: {}, updated_at: horasAtras(30) });
    expect((await tick()).ofertados).toBe(1);
  });

  it('ficha de solar não entra — a régua de cor é do eletroposto', async () => {
    fichas = [ficha({ created_by: 'lead-meta' })];
    expect((await tick()).ofertados).toBe(0);
  });

  it('ficha sem consultor não entra: não há agenda de quem consultar', async () => {
    fichas = [ficha({ vendedor_nome: null })];
    expect((await tick()).ofertados).toBe(0);
  });

  it('fora da janela de 9h–19h ninguém é chamado', async () => {
    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'));   // 8h BRT
    expect((await tick()).motivo).toBe('fora_da_janela');
  });

  it('kill-switch', async () => {
    process.env.EP_NOSHOW_OFF = '1';
    expect((await tick()).motivo).toBe('desligado');
  });
});

describe('o ritmo das três tentativas', () => {
  const jaTentou = (n: number, hAtras: number) =>
    state.set('ep_noshow:3', { key: 'ep_noshow:3', value: { n, ultimo: horasAtras(hAtras) }, updated_at: horasAtras(hAtras) });

  it('a segunda espera o dia seguinte', async () => {
    jaTentou(1, 5);
    expect((await tick()).ofertados).toBe(0);
    jaTentou(1, 21);
    expect((await tick()).ofertados).toBe(1);
    expect(ofertas[0].bolhas[0]).toContain('tentativa 2');
  });

  it('a terceira espera dois dias', async () => {
    jaTentou(2, 30);
    expect((await tick()).ofertados).toBe(0);
    jaTentou(2, 50);
    expect((await tick()).ofertados).toBe(1);
    expect(ofertas[0].bolhas[0]).toContain('tentativa 3');
  });

  it('depois de três convites o robô cala', async () => {
    jaTentou(3, 100);
    expect((await tick()).ofertados).toBe(0);
  });

  it('convite que NÃO foi pra rua não gasta tentativa', async () => {
    // Teto da linha estourado, agenda sem vaga, leitura falha: a pessoa não
    // recebeu nada, então perder um dos três seria perder um convite de verdade.
    resultadoDaOferta = { acao: 'sem_vaga' };
    const r = await tick();
    expect(r.ofertados).toBe(0);
    expect(state.has('ep_noshow:3')).toBe(false);
    expect(historicos).toHaveLength(0);
  });
});

describe('dry', () => {
  it('mostra quem seria chamado e não gasta nem tentativa nem mensagem', async () => {
    const r = await tick({ dry: true });
    expect(r.ofertados).toBe(1);
    expect(r.previa?.[0]).toMatchObject({ id: 3, tentativa: 1 });
    expect(ofertas).toHaveLength(0);
    expect(state.has('ep_noshow:3')).toBe(false);
  });
});
