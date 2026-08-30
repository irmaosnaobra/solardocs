import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Convite do grupo pra quem esfriou no eletroposto. O risco aqui é convidar duas
// vezes (quem já entrou como NOTA 1), convidar quem ainda está em jogo (reunião
// marcada) ou fingir primeiro contato com quem acabou de dizer não.

const state = new Map<string, { key: string; value: any; updated_at: string }>();
let fichas: any[] = [];
let nota1: any[] = [];
let suprimidos: string[] = [];
let tetoOk = true;
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _like: null as string | null, _key: null as string | null,
        select() { return q; },
        like(_c: string, p: string) { q._like = p.replace(/%$/, ''); return q; },
        gte() { return q; },
        eq(_c: string, v: string) { q._key = v; return q; },
        limit() {
          return Promise.resolve({
            data: [...state.values()].filter(r => !q._like || r.key.startsWith(q._like)), error: null,
          });
        },
        maybeSingle() { return Promise.resolve({ data: q._key ? state.get(q._key) ?? null : null, error: null }); },
        upsert(p: any) { for (const r of (Array.isArray(p) ? p : [p])) state.set(r.key, r); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        select() { return q; }, eq() { return q; }, order() { return q; },
        limit() { return Promise.resolve({ data: tabela === 'eletroposto_nota1' ? nota1 : fichas, error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoOk),
}));
vi.mock('../services/io/ioSend', () => ({
  carregarSupressao: vi.fn(async () => (tel: string) => suprimidos.some(s => tel.includes(s))),
}));

const DENTRO = new Date('2026-08-10T15:00:00.000Z');  // 12h BRT
const FORA = new Date('2026-08-10T23:30:00.000Z');    // 20h30 BRT
const VELHA = '2026-08-01T12:00:00.000Z';
const HOJE = '2026-08-10T12:00:00.000Z';

function ficha(over: Partial<any> = {}) {
  return {
    cliente_nome: 'João Souza', cliente_telefone: '5534991110001',
    status: 'nao_atendeu', quando: null, created_at: VELHA, created_by: 'lp_eletroposto', ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  state.clear(); enviadas.length = 0; suprimidos = []; tetoOk = true;
  fichas = [ficha()]; nota1 = [];
  vi.useFakeTimers(); vi.setSystemTime(DENTRO);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

async function mod() { return import('../services/io/eletropostoGrupoFrios'); }
async function publico() { return (await mod()).publicoGrupoFrio(); }
async function tick() { return (await mod()).runGrupoFriosTick(); }

describe('convite do grupo — quem entra', () => {
  it('não atendeu e sem interesse entram', async () => {
    fichas = [ficha(), ficha({ cliente_telefone: '5534991110002', status: 'sem_interesse' })];
    expect((await publico()).map(p => p.status).sort()).toEqual(['nao_atendeu', 'sem_interesse']);
  });

  it('quem tem reunião marcada no futuro fica de fora', async () => {
    fichas = [ficha({ quando: '2026-08-20T12:00:00.000Z' })];
    expect(await publico()).toHaveLength(0);
  });

  it('quem já foi convidado como NOTA 1 não recebe de novo', async () => {
    nota1 = [{ telefone: '5534991110001', convite_enviado_at: VELHA }];
    expect(await publico()).toHaveLength(0);
  });

  it('ficha de hoje espera esfriar', async () => {
    fichas = [ficha({ created_at: HOJE })];
    expect(await publico()).toHaveLength(0);
  });

  it('quem pediu PARAR nunca recebe', async () => {
    suprimidos = ['991110001'];
    expect(await publico()).toHaveLength(0);
  });

  // O tick está PARADO desde 30/08/2026 (grupo descontinuado + pesquisa em campo), então
  // a régua de "convida uma vez só" agora se prova pelo PÚBLICO, não pelo envio: quem já
  // tem marcador não aparece na lista. É a mesma garantia, medida um passo antes.
  it('quem já tem o marcador sai do público', async () => {
    expect(await publico()).toHaveLength(1);
    const chave = (await publico())[0].chave;
    state.set(`ep_grupo_frio:${chave}`, { key: `ep_grupo_frio:${chave}`, value: {}, updated_at: HOJE });
    expect(await publico()).toHaveLength(0);
  });

  it('o tick não envia mais nada — está parado', async () => {
    const r = await tick();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toContain('parado-30-08');
  });
});

describe('convite do grupo — o que fala', () => {
  it('quem não atendeu ouve "tentei falar"; quem disse não ouve "sem insistir"', async () => {
    const { bolhasGrupoFrio } = await mod();
    expect(bolhasGrupoFrio('nao_atendeu', 'João')[0]).toContain('tentei falar');
    expect(bolhasGrupoFrio('sem_interesse', 'João')[1]).toContain('sem insistir');
  });

  it('sempre leva o link do grupo e a saída PARAR', async () => {
    const { bolhasGrupoFrio } = await mod();
    for (const s of ['nao_atendeu', 'sem_interesse']) {
      const txt = bolhasGrupoFrio(s, 'João').join(' ');
      expect(txt).toContain('chat.whatsapp.com');
      expect(txt).toContain('PARAR');
    }
  });

  // A parada vem ANTES da janela e do teto: com o tick parado, nenhum dos dois chega a
  // ser consultado. O que estes testes ainda garantem é o que importa — não sai mensagem.
  it('não envia fora da janela nem com o teto estourado', async () => {
    vi.setSystemTime(FORA);
    expect((await tick()).enviados).toBe(0);
    vi.setSystemTime(DENTRO);
    tetoOk = false;
    expect((await tick()).enviados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('kill-switch desliga', async () => {
    process.env.EP_GRUPO_FRIOS_OFF = '1';
    vi.resetModules();
    expect((await tick()).motivo).toBe('desligado');
  });
});
