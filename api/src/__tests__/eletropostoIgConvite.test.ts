import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Convite pra LP de quem veio do Instagram. O risco aqui é o mesmo de todo
// outbound frio: mandar duas vezes, mandar de madrugada, ou mandar "vai
// preencher a página" pra quem já preencheu e tem reunião marcada.

let fichas: any[] = [];          // eletroposto_nota1, origem instagram_dm, sem convite
let ultimoConvite: any[] = [];   // a ficha mais recente que JÁ recebeu convite
let agendas: any[] = [];
let suprimidos: string[] = [];
let tetoOk = true;
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const updates: Array<{ id: any; patch: any }> = [];

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _notNull: false, _fora: [] as string[], _id: null as any, _patch: null as any,
        select() { return q; },
        eq(coluna: string, valor: any) { if (coluna === 'id') q._id = valor; return q; },
        ilike() { return q; },
        is() { return q; },
        gte() { return q; },
        order() { return q; },
        not(_c: string, op: string, valor?: any) {
          if (op === 'is') q._notNull = true;
          // `.not('status','in','(cancelado,sem_interesse)')` — o filtro que decide
          // se quem desistiu volta pra fila. Sem aplicá-lo aqui o teste passaria
          // por engano.
          if (op === 'in') q._fora = String(valor).replace(/[()]/g, '').split(',');
          return q;
        },
        update(patch: any) { q._patch = patch; return q; },
        limit() {
          if (tabela === 'agendamentos') {
            return Promise.resolve({ data: agendas.filter(a => !q._fora.includes(a.status)), error: null });
          }
          return Promise.resolve({ data: q._notNull ? ultimoConvite : fichas, error: null });
        },
        then(resolve: any) {
          // `.update(...).eq('id', n)` termina a cadeia sem .limit() — é aqui que ela resolve.
          if (q._patch) updates.push({ id: q._id, patch: q._patch });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
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

const DENTRO = new Date('2026-08-19T15:00:00.000Z');   // 12h BRT
const FORA = new Date('2026-08-19T02:15:00.000Z');     // 23h15 BRT — a hora do card 826
const ONTEM = '2026-08-18T12:00:00.000Z';

function ficha(over: Partial<any> = {}) {
  return { id: 1, nome: 'Renato Silva', telefone: '5534991110001', created_at: ONTEM, ...over };
}
/** Card do CRM do MESMO telefone da ficha — é ele que decide se o convite sai. */
function card(over: Partial<any> = {}) {
  return {
    cliente_telefone: '5534991110001', created_by: 'lp_eletroposto',
    quando: '2026-08-20T14:00:00Z', status: 'agendado', ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  enviadas.length = 0; updates.length = 0;
  fichas = [ficha()]; ultimoConvite = []; agendas = []; suprimidos = []; tetoOk = true;
  vi.useFakeTimers(); vi.setSystemTime(DENTRO);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; });

async function mod() { return import('../services/io/eletropostoIgConvite'); }
async function publico() { return (await mod()).publicoIgConvite(); }
async function tick() { return (await mod()).runEletropostoIgConviteTick(); }

describe('convite pra LP do lead que veio do Instagram', () => {
  it('manda uma mensagem só e carimba a ficha antes de enviar', async () => {
    const r = await tick();
    expect(r.enviados).toBe(1);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.bolhas).toHaveLength(1);          // sendFrio: 1 toque = 1 mensagem
    expect(updates[0]!.patch.convite_enviado_at).toBeTruthy();
    expect(updates[0]!.id).toBe(1);
  });

  it('a mensagem leva a LP etiquetada de Instagram', async () => {
    await tick();
    const texto = enviadas[0]!.bolhas[0]!;
    expect(texto).toContain('/io/eletroposto?utm_source=instagram');
    expect(texto).toContain('utm_medium=dm');
  });

  it('não sai de madrugada — a hora do card que virou reunião das 8h', async () => {
    vi.setSystemTime(FORA);
    const r = await tick();
    expect(r.motivo).toBe('fora_da_janela');
    expect(enviadas).toHaveLength(0);
  });

  it('quem já tem reunião marcada não recebe convite pra marcar', async () => {
    agendas = [card({ quando: '2026-08-20T14:00:00Z', status: 'agendado' })];
    expect(await publico()).toHaveLength(0);
    expect((await tick()).motivo).toBe('ninguem_pendente');
  });

  it('quem JÁ VIU PROPOSTA semanas atrás também não recebe — a trava não tem janela de data', async () => {
    agendas = [card({ quando: '2026-07-20T14:00:00Z', status: 'proposta_apresentada' })];
    expect(await publico()).toHaveLength(0);
  });

  it('reunião cancelada não segura o convite — esse voltou pra fila', async () => {
    agendas = [card({ quando: '2026-08-20T14:00:00Z', status: 'cancelado' })];
    expect(await publico()).toHaveLength(1);
  });

  it('card de SOLAR não segura o convite — é outro produto', async () => {
    agendas = [card({ created_by: 'lead-meta', status: 'em_atendimento' })];
    expect(await publico()).toHaveLength(1);
  });

  it('mesmos 8 dígitos em DDD diferente não é a mesma pessoa', async () => {
    agendas = [card({ cliente_telefone: '5511991110001', status: 'agendado' })];
    expect(await publico()).toHaveLength(1);
  });

  it('respeita a supressão de quem pediu pra parar', async () => {
    suprimidos = ['991110001'];
    expect(await publico()).toHaveLength(0);
  });

  it('segura o segundo convite dentro do intervalo de 10 min', async () => {
    ultimoConvite = [{ convite_enviado_at: new Date(DENTRO.getTime() - 3 * 60_000).toISOString() }];
    const r = await tick();
    expect(r.motivo).toBe('intervalo');
    expect(enviadas).toHaveLength(0);
  });

  it('passa quando o último convite já é velho', async () => {
    ultimoConvite = [{ convite_enviado_at: new Date(DENTRO.getTime() - 40 * 60_000).toISOString() }];
    expect((await tick()).enviados).toBe(1);
  });

  it('teto da linha segura o envio', async () => {
    tetoOk = false;
    const r = await tick();
    expect(r.motivo).toBe('teto_linha');
    expect(enviadas).toHaveLength(0);
  });

  it('kill-switch desliga tudo', async () => {
    process.env.EP_IG_CONVITE_OFF = '1';
    const r = await tick();
    expect(r.motivo).toBe('desligado');
    expect(enviadas).toHaveLength(0);
  });

  it('a arroba do Instagram não vira saudação', async () => {
    const { bolhaConviteLP } = await mod();
    expect(bolhaConviteLP('@rennysoncarvalho')[0]).toContain('Oi rennysoncarvalho!');
    expect(bolhaConviteLP('Lead Instagram')[0]).toContain('Oi Lead!');
    expect(bolhaConviteLP(null)[0]).toContain('Oi tudo bem!');
  });

  it('dry não manda nada mas mostra a prévia', async () => {
    const r = await (await mod()).runEletropostoIgConviteTick({ dry: true });
    expect(r.enviados).toBe(0);
    expect(r.publico).toBe(1);
    expect(r.previa?.[0]).toContain('/io/eletroposto');
    expect(enviadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
