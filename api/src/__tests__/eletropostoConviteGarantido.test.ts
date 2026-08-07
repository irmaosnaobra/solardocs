import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// "Todo NOTA 1 entra no grupo, sempre" — regra do dono.
// O envio da LP falha em silêncio de três jeitos (linha caída, teto de 40/h,
// erro sem retry). Este tick é a rede embaixo. O que os testes trancam é o que
// impede a rede de virar um novo problema: janela de horário, intervalo entre
// convites, não repetir quem a repescagem já vai chamar e desistir depois de 3.

// O mesmo fake atende duas tabelas: `system_state` (chave/valor, o uso original)
// e `pc_cursos`, que o gate da oferta consulta por slug. Daí os campos opcionais.
const state = new Map<string, {
  key: string; value?: any; updated_at?: string;
  status?: string; checkout_url?: string | null;
}>();
let nota1: any[] = [];
let tetoOk = true;
let falharEnvio = false;
const enviadas: string[] = [];
const marcados: number[] = [];

function fakeMain() {
  return {
    from: () => {
      const q: any = {
        _like: null as string | null, _key: null as string | null, _del: false,
        select() { return q; },
        like(_c: string, p: string) { q._like = p.replace(/%$/, ''); return q; },
        or(expr: string) {
          q._prefixos = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
          return q;
        },
        eq(_c: string, v: string) { q._key = v; return q; },
        delete() { q._del = true; return q; },
        limit() {
          const linhas = [...state.values()].filter(r =>
            q._prefixos ? q._prefixos.some((p: string) => r.key.startsWith(p))
              : (!q._like || r.key.startsWith(q._like)));
          return Promise.resolve({ data: linhas, error: null });
        },
        maybeSingle() {
          const r = q._key ? state.get(q._key) : undefined;
          if (q._del && r) state.delete(q._key!);
          return Promise.resolve({ data: r ?? null, error: null });
        },
        upsert(p: any) {
          for (const r of (Array.isArray(p) ? p : [p])) state.set(r.key, r);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
}

function fakeGerador() {
  return {
    from: () => {
      const q: any = {
        _upd: null as any, _id: null as number | null,
        select() { return q; },
        is() { return q; },
        gte() { return q; },
        lte() { return q; },
        order() { return q; },
        eq(_c: string, v: number) { q._id = v; return q; },
        update(patch: any) { q._upd = patch; return q; },
        limit() { return Promise.resolve({ data: nota1, error: null }); },
        then(res: any, rej: any) {
          if (q._upd && q._id != null) {
            if (q._upd.convite_enviado_at) marcados.push(q._id);
            nota1 = nota1.map(l => (l.id === q._id ? { ...l, ...q._upd } : l));
          }
          return Promise.resolve({ error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

vi.mock('../utils/supabase', () => ({ supabase: fakeMain() }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: fakeGerador() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string) => {
    if (falharEnvio) throw new Error('[zapi:io] HTTP 400 — disconnected');
    enviadas.push(phone);
  }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoOk),
}));
vi.mock('../services/io/eletropostoRepescagem', () => ({
  bolhasConviteParaFicha: (nome: string) => [`convite pra ${nome}`],
}));

const DENTRO = new Date('2026-08-05T15:00:00.000Z');  // 12h BRT
const FORA = new Date('2026-08-05T02:00:00.000Z');    // 23h BRT
const ONTEM = '2026-08-04T14:00:00.000Z';

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); enviadas.length = 0; marcados.length = 0;
  tetoOk = true; falharEnvio = false;
  nota1 = [{ id: 10, nome: 'Fulano', telefone: '5511999990001', created_at: ONTEM }];
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

async function tick() {
  const mod = await import('../services/io/eletropostoConviteGarantido');
  return mod.runConviteNota1Garantido();
}

describe('todo nota 1 entra no grupo', () => {
  it('convida quem ficou sem convite e marca a ficha', async () => {
    vi.setSystemTime(DENTRO);
    const r = await tick();
    expect(r.enviados).toBe(1);
    expect(enviadas).toEqual(['5511999990001']);
    expect(marcados).toEqual([10]);   // convite_enviado_at gravado
  });

  it('não convida de madrugada', async () => {
    vi.setSystemTime(FORA);
    const r = await tick();
    expect(r.motivo).toBe('fora_da_janela');
    expect(enviadas).toHaveLength(0);
  });

  it('espera o intervalo entre um convite e outro', async () => {
    vi.setSystemTime(DENTRO);
    nota1 = [
      { id: 10, nome: 'A', telefone: '5511999990001', created_at: ONTEM },
      { id: 11, nome: 'B', telefone: '5511999990002', created_at: ONTEM },
    ];
    expect((await tick()).enviados).toBe(1);
    vi.setSystemTime(new Date(DENTRO.getTime() + 60_000));
    expect((await tick()).motivo).toBe('intervalo');
    vi.setSystemTime(new Date(DENTRO.getTime() + 5 * 60_000));
    expect((await tick()).enviados).toBe(1);
    expect(enviadas).toHaveLength(2);
  });

  it('não fala com quem a repescagem já vai chamar', async () => {
    vi.setSystemTime(DENTRO);
    state.set('ep_repescagem_pending:5511999990001', {
      key: 'ep_repescagem_pending:5511999990001', value: {}, updated_at: DENTRO.toISOString(),
    });
    const r = await tick();
    expect(r.motivo).toBe('todos_ja_na_fila');
    expect(enviadas).toHaveLength(0);
  });

  it('respeita o teto da linha', async () => {
    vi.setSystemTime(DENTRO);
    tetoOk = false;
    expect((await tick()).motivo).toBe('teto_linha');
    expect(enviadas).toHaveLength(0);
  });

  it('desiste depois de 3 tentativas, em vez de tentar pra sempre', async () => {
    vi.setSystemTime(DENTRO);
    state.set('ep_convite_tentativa:10', {
      key: 'ep_convite_tentativa:10', value: { n: 3 }, updated_at: DENTRO.toISOString(),
    });
    const r = await tick();
    expect(r.motivo).toBe('tentativas_esgotadas');
    expect(enviadas).toHaveLength(0);
  });

  it('erro de envio conta tentativa e NÃO marca a ficha como convidada', async () => {
    vi.setSystemTime(DENTRO);
    falharEnvio = true;
    const r = await tick();
    expect(r.motivo).toBe('erro_envio');
    expect(marcados).toHaveLength(0);
    expect(state.get('ep_convite_tentativa:10')?.value.n).toBe(1);
  });

  it('kill-switch congela a rede', async () => {
    vi.setSystemTime(DENTRO);
    process.env.EP_CONVITE_GARANTIDO_OFF = '1';
    expect((await tick()).motivo).toBe('desligado');
  });
  // ── O gate que a oferta paga adicionou ─────────────────────────────────────
  // Depois que o NOTA 1 passou a ir pra pagina de venda, TODO lead novo fica com
  // `convite_enviado_at` nulo — que e exatamente o que esta varredura procura.
  // Sem o gate, ela mandaria o grupo de graca no WhatsApp de quem acabou de ver
  // uma oferta de R$ 197. Este teste e o que impede a rede de virar o furo.
  it('para sozinho quando a oferta de entrada esta vendavel', async () => {
    vi.setSystemTime(DENTRO);
    state.set('fundamentos', { key: 'fundamentos', status: 'publicado', checkout_url: 'https://pay.kiwify.com.br/abc' });
    const r = await tick();
    expect(r.motivo).toBe('oferta_no_ar');
    expect(enviadas).toHaveLength(0);
    expect(marcados).toHaveLength(0);
  });

  it('continua convidando enquanto o curso estiver publicado SEM link de checkout', async () => {
    vi.setSystemTime(DENTRO);
    // Meio caminho e o pior caso: a pagina abriria com um botao que nao compra
    // nada. Enquanto isso, o grupo e melhor que nada.
    state.set('fundamentos', { key: 'fundamentos', status: 'publicado', checkout_url: null });
    const r = await tick();
    expect(r.enviados).toBe(1);
  });

  it('convida quando o curso ainda esta em rascunho', async () => {
    vi.setSystemTime(DENTRO);
    state.set('fundamentos', { key: 'fundamentos', status: 'rascunho', checkout_url: 'https://pay.kiwify.com.br/abc' });
    expect((await tick()).enviados).toBe(1);
  });

  it('EP_NOTA1_CONVITE_GRUPO=1 segura o grupo mesmo com a oferta no ar', async () => {
    vi.setSystemTime(DENTRO);
    state.set('fundamentos', { key: 'fundamentos', status: 'publicado', checkout_url: 'https://pay.kiwify.com.br/abc' });
    process.env.EP_NOTA1_CONVITE_GRUPO = '1';
    expect((await tick()).enviados).toBe(1);
  });

  it('EP_NOTA1_CONVITE_GRUPO=0 desliga o grupo mesmo sem oferta cadastrada', async () => {
    vi.setSystemTime(DENTRO);
    process.env.EP_NOTA1_CONVITE_GRUPO = '0';
    expect((await tick()).motivo).toBe('oferta_no_ar');
    expect(enviadas).toHaveLength(0);
  });
});
