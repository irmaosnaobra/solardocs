import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O sinal que ensina o Meta qual é o cliente bom. O risco aqui não é mandar de
// menos: é mandar ERRADO. Cada evento é uma instrução pro algoritmo caçar mais
// gente parecida — reportar lead pequeno como bom faz o Meta trazer mais lead
// pequeno, e isso custa dinheiro por semanas sem ninguém ver.

let linhas: any[] = [];
let jaEnviados: any[] = [];
const inserts: any[] = [];
const eventos: Array<{ leadId: string; evento: string; opts: any }> = [];
let metaOk = true;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _ins: null as any,
        select() { return q; }, not() { return q; }, gte() { return q; },
        eq() { return q; }, in() { return q; },
        insert(row: any) { inserts.push(row); return Promise.resolve({ error: null }); },
        limit() {
          return Promise.resolve({
            data: tabela === 'capi_conversoes_enviadas' ? jaEnviados : linhas, error: null,
          });
        },
        then(res: any, rej: any) {
          // `capi_conversoes_enviadas` é lido com .in(...) sem .limit()
          return Promise.resolve({
            data: tabela === 'capi_conversoes_enviadas' ? jaEnviados : linhas, error: null,
          }).then(res, rej);
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/metaPixel', () => ({
  sendCrmLeadEvent: vi.fn(async (leadId: string, evento: string, opts: any) => {
    eventos.push({ leadId, evento, opts });
    return metaOk ? { ok: true, status: 200, received: 1 } : { ok: false, status: 400, error: 'recusado' };
  }),
}));

const linha = (over: Partial<any> = {}) => ({
  lead_id: '123456789012345',
  agendado_id: 10,
  agendamentos: {
    id: 10, status: 'fez_orcamento',
    observacao: '[Lead Instagram]\nConsumo: 900 a 1200\nImóvel: Proprio',
    created_at: '2026-08-01T10:00:00.000Z',
  },
  ...over,
});
const comObs = (consumo: string, over: Partial<any> = {}) =>
  linha({ agendamentos: { ...linha().agendamentos, observacao: `Consumo: ${consumo}`, ...over } });

const envOriginal = { ...process.env };
beforeEach(() => {
  linhas = [linha()]; jaEnviados = []; inserts.length = 0; eventos.length = 0; metaOk = true;
});
afterEach(() => { process.env = { ...envOriginal }; vi.resetModules(); });

async function run(opts: any = {}) {
  const m = await import('../services/agenda/capiLeadQualificadoService');
  return m.runCapiLeadQualificado(opts);
}

describe('quem é reportado como cliente bom', () => {
  it('conta grande que orçou vira evento pro Meta', async () => {
    const r = await run();
    expect(r.enviados).toBe(1);
    expect(eventos[0]).toMatchObject({ leadId: '123456789012345', evento: 'Sales Opportunity' });
    // event_id estável: reprocessar não conta duas vezes nem do lado do Meta.
    expect(eventos[0]!.opts.eventId).toBe('qualificado_123456789012345');
  });

  // O corte é o MESMO do roteamento (KWH_CORTE_TIME). Se um dia divergirem, o
  // Meta passa a caçar um perfil que a casa não considera bom.
  it('conta pequena NÃO é reportada, mesmo tendo orçado', async () => {
    linhas = [comObs('- 500')];
    expect((await run()).motivo).toBe('nenhum_lead_bom');
    expect(eventos).toHaveLength(0);
  });

  it('conta grande que ainda não orçou não é reportada', async () => {
    linhas = [linha({ agendamentos: { ...linha().agendamentos, status: 'agendado' } })];
    expect((await run()).motivo).toBe('nenhum_lead_bom');
  });

  // Quem passou de "orçou" também orçou — a ficha nem sempre registra o degrau.
  it('proposta apresentada e fechou também contam', async () => {
    for (const status of ['proposta_apresentada', 'fechou']) {
      linhas = [linha({ agendamentos: { ...linha().agendamentos, status } })];
      eventos.length = 0;
      expect((await run()).enviados).toBe(1);
    }
  });

  // Sem resposta de consumo não é lead bom nem ruim: é lead sem informação, e
  // ensinar o algoritmo com achismo é pior que não ensinar.
  it('sem consumo respondido fica de fora', async () => {
    linhas = [linha({ agendamentos: { ...linha().agendamentos, observacao: 'Imóvel: Proprio' } })];
    expect((await run()).motivo).toBe('nenhum_lead_bom');
  });

  // Este é o bug que quase passou: observação de linha única fazia o "30" de
  // "30 dias" entrar na conta e derrubar "700 a 900" pra 365 — o lead bom nunca
  // seria reportado, e o Meta seguiria aprendendo o perfil errado.
  it('observação de linha única é lida certo', async () => {
    linhas = [comObs('700 a 900 · Telhado: Cimento · Urgencia: 30 dias')];
    expect((await run()).enviados).toBe(1);
  });

  // A DM responde em REAIS. Ler R$ 800 como 800 kWh reportaria conta pequena
  // como cliente bom — o erro mais caro possível aqui.
  it('valor em reais é convertido antes de julgar', async () => {
    linhas = [comObs('R$ 400 a R$ 800')];       // ≈ 571 kWh
    expect((await run()).motivo).toBe('nenhum_lead_bom');
    linhas = [comObs('R$ 800 a R$ 1.500')];     // ≈ 1095 kWh
    expect((await run()).enviados).toBe(1);
  });

  it('lead_id inválido não vira evento', async () => {
    linhas = [linha({ lead_id: 'abc' })];
    expect((await run()).motivo).toBe('nenhum_lead_bom');
  });
});

describe('não repetir e não mentir', () => {
  it('quem o Meta já ouviu não é reportado de novo', async () => {
    jaEnviados = [{ lead_id: '123456789012345' }];
    const r = await run();
    expect(r.motivo).toBe('nada_novo');
    expect(eventos).toHaveLength(0);
  });

  // Dedup gravado só quando o Meta ACEITOU: recusa tem que voltar na próxima
  // rodada, senão um erro de rede apaga o lead pra sempre.
  it('recusa do Meta não grava dedup', async () => {
    metaOk = false;
    const r = await run();
    expect(r.falhas).toBe(1);
    expect(r.enviados).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('envio aceito grava o dedup', async () => {
    await run();
    expect(inserts[0]).toMatchObject({ lead_id: '123456789012345', event_name: 'Sales Opportunity' });
  });

  it('dry lista quem seria reportado e não envia nada', async () => {
    const r = await run({ dry: true });
    expect(r.novos).toBe(1);
    expect(r.detalhes?.[0]).toMatchObject({ ficha: 10, kwh: 1050 });
    expect(eventos).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('kill-switch desliga', async () => {
    process.env.CAPI_QUALIFICADO_OFF = '1';
    vi.resetModules();
    expect((await run()).motivo).toBe('desligado');
    expect(eventos).toHaveLength(0);
  });
});
