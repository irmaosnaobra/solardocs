import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Boas-vindas do solar. Os riscos aqui são: falar de horário (o pedido do dono é
// justamente NÃO falar), acordar o backlog inteiro no dia em que o switch ligar,
// mandar duas vezes, e prometer contato sem passar contato nenhum.

let fichas: any[] = [];
let consultores: any[] = [];
let erroDoUpdate: any = null;   // simula o supabase-js devolvendo { error } sem lançar
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const updates: Array<{ id: number; campo: string }> = [];

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        _update: null as any,
        select() { return q; },
        in(col: string, vals: any[]) { q._filtros[col] = vals; return q; },
        is(col: string, v: any) { q._filtros[`is_${col}`] = v; return q; },
        eq(col: string, v: any) {
          if (q._update) {
            updates.push({ id: v, campo: Object.keys(q._update)[0] });
            return Promise.resolve({ error: erroDoUpdate });
          }
          q._filtros[col] = v; return q;
        },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          if (tabela === 'consultores') return Promise.resolve({ data: consultores, error: null });
          const origens: string[] = q._filtros['created_by'] ?? [];
          const status = q._filtros['status'];
          const piso = q._filtros['gte_created_at'];
          return Promise.resolve({
            data: fichas.filter(f =>
              origens.includes(f.created_by) && f.status === status
              && f.boas_vindas_at === null && String(f.created_at) >= piso),
            error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
// Teto anti-ban da linha IO — compartilhado com a Bia e o resto. Foi ele que
// faltava nos dois agentes de ficha quando o 5040 bloqueou em 04/08.
let tetoLivre = true;
const carimbos: string[] = [];
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoLivre),
}));
vi.mock('../utils/supabase', () => ({
  supabase: { from: () => ({ upsert: async (r: any) => { carimbos.push(String(r.key)); return { error: null }; } }) },
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));

const AGORA = new Date('2026-08-10T16:00:00.000Z');
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

function ficha(over: Partial<any> = {}) {
  return {
    id: 1, vendedor_nome: 'Nilce', cliente_nome: 'Irineu de Almeida', cliente_telefone: '5534991110001',
    created_by: 'lp_solar', status: 'agendado', created_at: minutosAtras(2),
    quando: '2026-08-12T17:00:00.000Z',   // a ficha TEM horário — a mensagem não pode citar
    boas_vindas_at: null, ...over,
  };
}

const envOriginal = { ...process.env };
beforeEach(() => {
  enviadas.length = 0; updates.length = 0; erroDoUpdate = null;
  carimbos.length = 0; tetoLivre = true;
  fichas = [ficha()];
  consultores = [{ nome: 'Nilce', whatsapp: '5534991516846' }, { nome: 'Diego', whatsapp: '5534991360172' }];
  delete process.env.SOLAR_BOASVINDAS_OFF;   // no ar por padrão desde a aprovação de 04/08
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function mod() { return import('../services/io/solarBoasVindas'); }
async function tick(opts: any = {}) { return (await mod()).runSolarBoasVindasTick(opts); }

describe('quem recebe', () => {
  it('cadastro recém-criado recebe na hora, e a flag é a coluna própria', async () => {
    const r = await tick();
    expect(r.enviadas).toBe(1);
    expect(updates).toEqual([{ id: 1, campo: 'boas_vindas_at' }]);
    expect(enviadas[0].phone).toBe('5534991110001');
  });

  it('as quatro origens de solar entram', async () => {
    fichas = ['lp_solar', 'lead-meta', 'leads-meta', 'manychat']
      .map((o, i) => ficha({ id: i + 1, created_by: o, cliente_telefone: `553499111000${i}` }));
    expect((await tick()).enviadas).toBe(4);
  });

  it('indicação NÃO entra: quem foi indicado não preencheu formulário nenhum', async () => {
    fichas = [ficha({ created_by: 'indicacao' })];
    expect((await tick()).enviadas).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('eletroposto não entra por engano', async () => {
    fichas = [ficha({ created_by: 'lp_eletroposto' })];
    expect((await tick()).enviadas).toBe(0);
  });
});

describe('o backlog não vira rajada', () => {
  it('ficha de ontem não recebe "recebi seu cadastro"', async () => {
    fichas = [ficha({ created_at: minutosAtras(60 * 26) })];
    expect((await tick()).enviadas).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  // O cron promete 5 min e entrega ~2h (medido em 04/08: gaps de 70 a 216 min).
  // Uma janela de 1h fazia o cadastro envelhecer antes do primeiro tick — e a
  // pessoa não recebia nada, sem nem virar log.
  it('cadastro de 3 horas atrás ainda recebe — o cron real atrasa horas', async () => {
    fichas = [ficha({ created_at: minutosAtras(180) })];
    expect((await tick()).enviadas).toBe(1);
  });

  it('mas 7 horas já é tarde demais', async () => {
    fichas = [ficha({ created_at: minutosAtras(420) })];
    expect((await tick()).enviadas).toBe(0);
  });

  it('ficha anterior ao dia em que o agente existiu nunca recebe', async () => {
    vi.setSystemTime(new Date('2026-08-04T00:20:00.000Z'));   // piso ainda manda
    fichas = [ficha({ created_at: '2026-08-03T23:50:00.000Z' })];
    expect((await tick()).enviadas).toBe(0);
  });

  it('sync do Meta com 12 fichas de uma vez sai no máximo 5 por rodada', async () => {
    fichas = Array.from({ length: 12 }, (_, i) =>
      ficha({ id: i + 1, created_by: 'lead-meta', cliente_telefone: `55349911100${String(i).padStart(2, '0')}` }));
    expect((await tick()).enviadas).toBe(5);
  });

  it('quem já recebeu não recebe de novo', async () => {
    fichas = [ficha({ boas_vindas_at: minutosAtras(1) })];
    expect((await tick()).enviadas).toBe(0);
  });

  it('ficha cancelada não recebe', async () => {
    fichas = [ficha({ status: 'cancelado' })];
    expect((await tick()).enviadas).toBe(0);
  });

  // O supabase-js NÃO lança quando a escrita falha: devolve { error }. Sem
  // conferir isso, a ficha ficava sem flag, dentro da janela de 1h, e recebia as
  // 6 bolhas de novo a cada 5 min — a rajada exata que as travas existem pra evitar.
  it('flag que não grava é erro alto, com retry, e a pessoa NÃO recebe de novo', async () => {
    erroDoUpdate = { message: 'timeout' };
    const r = await tick();
    expect(r).toMatchObject({ enviadas: 1, erros: 1 });
    expect(updates).toHaveLength(2);            // tentou gravar duas vezes

    // Mesmo processo, próxima rodada: o banco continua dizendo que ninguém foi
    // tocado, e mesmo assim a mensagem não sai de novo.
    enviadas.length = 0;
    await tick();
    expect(enviadas).toHaveLength(0);
  });
});

// O 5040 bloqueou 2× (01–03/ago e 04/08). Na segunda foi a fila de atraso do
// eletroposto soltando 8 pessoas numa hora, 37 mensagens, num teto de 12 — os
// dois agentes de ficha estavam FORA do teto por decisão.
describe('teto anti-ban da linha', () => {
  it('teto estourado segura o envio pro próximo tick', async () => {
    tetoLivre = false;
    expect((await tick()).enviadas).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('cada envio deixa carimbo, senão o agente fura o teto em silêncio', async () => {
    await tick();
    expect(carimbos).toEqual(['solar_boasvindas_sent:1']);
  });

  it('o dry não consulta o teto nem carimba nada', async () => {
    tetoLivre = false;
    expect((await tick({ dry: true })).enviadas).toBe(1);
    expect(carimbos).toHaveLength(0);
  });
});

describe('o switch', () => {
  it('SOLAR_BOASVINDAS_OFF=1 cala o agente', async () => {
    process.env.SOLAR_BOASVINDAS_OFF = '1';
    expect(await tick()).toMatchObject({ enviadas: 0, motivo: 'desligado' });
    expect(enviadas).toHaveLength(0);
  });

  it('mas o dry funciona desligado — é assim que a copy é revisada sem tocar em ninguém', async () => {
    process.env.SOLAR_BOASVINDAS_OFF = '1';
    const r = await tick({ dry: true });
    expect(r.enviadas).toBe(1);
    expect(r.previa?.[0].bolhas.length).toBeGreaterThan(0);
    expect(enviadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe('a mensagem', () => {
  const texto = async () => { await tick(); return enviadas[0].bolhas.join('\n'); };

  it('não fala de horário, dia, reunião nem vistoria', async () => {
    const t = (await texto()).toLowerCase();
    for (const proibido of ['horário', 'horario', 'reunião', 'reuniao', 'vistoria', 'agendad', 'às ', 'amanhã', 'segunda', 'terça', 'quarta', 'quinta', 'sexta']) {
      expect(t).not.toContain(proibido);
    }
    expect(t).not.toMatch(/\d{1,2}h\d{2}/);
    expect(t).not.toMatch(/\d{2}\/\d{2}/);
  });

  it('passa o nome e o WhatsApp do consultor dono da ficha', async () => {
    const t = await texto();
    expect(t).toContain('Nilce');
    expect(t).toContain('(34) 99151-6846');
  });

  it('promete que NÓS entramos em contato', async () => {
    expect(await texto()).toContain('entramos em contato com você');
  });

  // Pedido do dono (13/08): a mensagem tem que deixar claro que isto é um
  // PRÉ-atendimento e que quem atende de verdade é gente que entende do assunto —
  // senão o lead lê o robô e acha que a empresa inteira é robô.
  it('se apresenta como pré-atendimento e promete atendimento humano especializado', async () => {
    const t = await texto();
    expect(t).toContain('pré-atendimento');
    expect(t).toContain('especialista em energia solar');
    expect(t).toContain('atendimento com gente');
  });

  // "Consultor especializado" erraria o gênero da Nilce, que hoje recebe a maior
  // parte do volume. O rodízio é Thiago→Diego→Nilce e a frase serve pros três.
  it('não usa cargo com gênero', async () => {
    const t = (await texto()).toLowerCase();
    // Só o CARGO. "uma foto dela" fala da conta de luz, não de quem atende — a
    // primeira versão deste teste proibia " dela " e reprovava a própria pergunta.
    for (const proibido of ['o consultor', 'a consultora', 'consultor especializado', 'especialista dele', 'especialista dela'])
      expect(t).not.toContain(proibido);
  });

  it('pergunta o consumo', async () => {
    expect(await texto()).toContain('qual o seu consumo hoje?');
  });

  // Decisão do dono: UMA pergunta. Questionário no primeiro contato é o jeito
  // mais rápido de não receber resposta nenhuma.
  it('e pergunta SÓ isso — uma interrogação na mensagem inteira', async () => {
    const t = await texto();
    expect(t.match(/\?/g) ?? []).toHaveLength(1);
    expect(t.toLowerCase()).not.toContain('segurou');
    expect(t.toLowerCase()).not.toContain('procurar agora');
  });

  it('sem consultor com WhatsApp cadastrado, ainda passa um contato nosso', async () => {
    consultores = [];
    const t = await texto();
    expect(t).toContain('nossa central');
    expect(t).not.toContain('( ) -');
  });

  it('nome torto não vira "Oi, Lead"', async () => {
    fichas = [ficha({ cliente_nome: 'Lead' })];
    const t = await texto();
    expect(t.startsWith('Oi! ')).toBe(true);
  });

  it('não promete prazo nem responde no lugar do consultor', async () => {
    const t = (await texto()).toLowerCase();
    for (const proibido of ['em instantes', 'em alguns minutos', 'ainda hoje', 'em até']) {
      expect(t).not.toContain(proibido);
    }
  });
});
