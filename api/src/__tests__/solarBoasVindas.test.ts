import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Boas-vindas do solar. Os riscos aqui são: falar de horário (o pedido do dono é
// justamente NÃO falar), acordar o backlog inteiro no dia em que o switch ligar,
// mandar duas vezes, e prometer contato sem passar contato nenhum.

let fichas: any[] = [];
let consultores: any[] = [];
let falhaOr = false;   // faz a leitura dos carimbos da abertura (.or) devolver { error }
let erroDoUpdate: any = null;   // simula o supabase-js devolvendo { error } sem lançar
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const updates: Array<{ id: number; campo: string }> = [];
// system_state fora dos carimbos da linha (o estado do alarme de perdidos).
const estado = new Map<string, any>();

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        _update: null as any,
        _condicao: [] as Array<[string, any]>,
        // update(...).eq().is().select() é a RESERVA da ficha: como no banco, só
        // devolve a linha se a condição ainda valia na hora de gravar.
        select() { return q._update ? q._gravar(true) : q; },
        in(col: string, vals: any[]) { q._filtros[col] = vals; return q; },
        is(col: string, v: any) {
          if (q._update) { q._condicao.push([col, v]); return q; }
          q._filtros[`is_${col}`] = v; return q;
        },
        // O filtro de status virou "não está nesta lista" (era `= agendado`, e
        // era ele que descartava 71 de 99 fichas). `lt` é do contarPerdidos.
        not(col: string, _op: string, lista: string) {
          q._filtros[`not_${col}`] = lista.replace(/[()]/g, '').split(',');
          return q;
        },
        lt(col: string, v: any) { q._filtros[`lt_${col}`] = v; return q; },
        eq(col: string, v: any) {
          if (q._update) { q._condicao.push([col, v]); return q; }
          q._filtros[col] = v; return q;
        },
        neq(col: string, v: any) { q._filtros[`neq_${col}`] = v; return q; },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        // update sem select (devolver a ficha pra fila) é aguardado direto.
        then(ok: any, falha: any) {
          return (q._update ? q._gravar(false) : Promise.resolve({ data: null, error: null })).then(ok, falha);
        },
        _gravar(comSelect: boolean) {
          const patch = q._update; const condicao: Array<[string, any]> = q._condicao;
          q._update = null; q._condicao = [];
          const id = condicao.find(([c]) => c === 'id')?.[1];
          updates.push({ id, campo: Object.keys(patch)[0] });
          if (erroDoUpdate) return Promise.resolve({ data: null, error: erroDoUpdate });
          const f = fichas.find((x) => x.id === id);
          const vale = !!f && condicao.every(([c, v]) => f[c] === v);
          if (vale) Object.assign(f, patch);
          return Promise.resolve({ data: comSelect ? (vale ? [{ id }] : []) : null, error: null });
        },
        limit() {
          if (tabela === 'consultores') return Promise.resolve({ data: consultores, error: null });
          const origens: string[] = q._filtros['created_by'] ?? [];
          // Mesmo telefone já atendido por outra ficha (telefoneJaRecebeu).
          if (q._filtros['telefone_norm'] !== undefined) {
            return Promise.resolve({
              data: fichas.filter(f => origens.includes(f.created_by)
                && f.telefone_norm === q._filtros['telefone_norm'] && f.id !== q._filtros['neq_id']
                && f.boas_vindas_at !== null && String(f.boas_vindas_at) >= q._filtros['gte_boas_vindas_at']),
              error: null,
            });
          }
          // Reservas com mais de 15 minutos (conferirReservasSemEnvio).
          if (q._filtros['lt_boas_vindas_at'] !== undefined) {
            return Promise.resolve({
              data: fichas.filter(f => origens.includes(f.created_by) && f.boas_vindas_at !== null
                && String(f.boas_vindas_at) >= q._filtros['gte_boas_vindas_at']
                && String(f.boas_vindas_at) < q._filtros['lt_boas_vindas_at']),
              error: null,
            });
          }
          const barrados: string[] = q._filtros['not_status'] ?? [];
          const piso = q._filtros['gte_created_at'];
          const teto = q._filtros['lt_created_at'];
          return Promise.resolve({
            data: fichas.filter(f =>
              origens.includes(f.created_by) && !barrados.includes(f.status)
              && f.boas_vindas_at === null && String(f.created_at) >= piso
              && (!teto || String(f.created_at) < teto)),
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
  supabase: {
    from: () => {
      const q: any = {
        _chave: '',
        select() { return q; },
        eq(_col: string, v: any) { q._chave = String(v); return q; },
        // select('key').in('key', [...]): quais marcadores existem (varredura de reservas).
        in: async (_col: string, chaves: string[]) => ({
          data: chaves.filter((k) => carimbos.includes(k) || estado.has(k)).map((key) => ({ key })),
          error: null,
        }),
        // select('key, value').or('key.like.<prefixo>%,...'): os carimbos da abertura do quiz (varredura de reservas). O prefixo termina em
        // ":", então o id 7 nunca casa com o 70. Devolve o value (o alarme só aceita o carimbo com estado 'enviado').
        or: async (filtro: string) => {
          if (falhaOr) return { data: null, error: { message: 'falhou' } };
          const prefixos = filtro.split(',').map((c) => c.replace(/^key\.like\./, '').replace(/%$/, ''));
          const todas = [...carimbos, ...estado.keys()];
          return { data: todas.filter((k) => prefixos.some((p) => k.startsWith(p))).map((key) => ({ key, value: estado.get(key) ?? null })), error: null };
        },
        maybeSingle: async () => ({ data: estado.has(q._chave) ? { value: estado.get(q._chave) } : null, error: null }),
        upsert: async (r: any) => {
          if (String(r.key).startsWith('solar_boasvindas_sent:')) carimbos.push(String(r.key));
          else estado.set(String(r.key), r.value);
          return { error: null };
        },
      };
      return q;
    },
  },
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));

// Fase B1b: força o corte por posse (cedeAAgente) em telefones escolhidos; o resto segue o posse REAL.
const cortes = vi.hoisted(() => ({ cede: new Set<string>() }));
vi.mock('../services/agentes5040/posse', async (orig) => {
  const real = await orig<typeof import('../services/agentes5040/posse')>();
  return { ...real, cedeAAgente: async (t: string) => (cortes.cede.has(String(t)) ? true : real.cedeAAgente(t)) };
});

const AGORA = new Date('2026-08-20T16:00:00.000Z');
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
  carimbos.length = 0; tetoLivre = true; estado.clear();
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

  // [13/08] A janela foi de 6h pra 24h: 12 de 99 receberam em 30 dias, e o tempo
  // médio até o envio (59 min, por causa do teto de 6/h da linha) fazia gente cair
  // da beirada. 7 horas agora ainda é dentro; 26 continua fora.
  it('cadastro de 7 horas atrás ainda recebe', async () => {
    fichas = [ficha({ created_at: minutosAtras(420) })];
    expect((await tick()).enviadas).toBe(1);
  });

  // Quem envelheceu além da janela sem receber vira NÚMERO, não silêncio. E a
  // contagem roda na rodada SEM candidato — que é justamente a rodada em que todo
  // mundo caiu da janela. Contar depois da saída por "nada novo" faria o agente
  // relatar "nada a fazer" no momento em que mais gente ficou no escuro: foi esse
  // tipo de silêncio que deixou 87 pessoas passarem em branco por 30 dias.
  it('quem passou da janela sem receber é contado como perdido', async () => {
    fichas = [ficha({ created_at: minutosAtras(60 * 30) })];   // 30h: fora da janela, depois do piso
    const r = await tick();
    expect(r.enviadas).toBe(0);
    expect(r.motivo ?? 'nenhum_cadastro_novo').toBe('nenhum_cadastro_novo');
    expect(r.perdidos).toBe(1);
  });

  it('quem recebeu, ou disse não, não entra na conta de perdidos', async () => {
    fichas = [
      ficha({ id: 1, created_at: minutosAtras(60 * 30), boas_vindas_at: minutosAtras(60 * 29) }),
      ficha({ id: 2, created_at: minutosAtras(60 * 30), status: 'sem_interesse' }),
    ];
    expect((await tick()).perdidos).toBe(0);
  });

  // Até 14/09/2026 a mesma linha "12 cadastro(s)..." ia pro error_logs a cada ~2
  // minutos sobre um conjunto parado: 682 por dia. Alarme que repete ninguém lê.
  it('o alarme de perdidos grita uma vez por lista, não a cada rodada', async () => {
    const { logger } = await import('../utils/logger');
    vi.mocked(logger.error).mockClear();
    fichas = [ficha({ created_at: minutosAtras(60 * 30) })];
    await tick(); await tick(); await tick();
    const gritos = vi.mocked(logger.error).mock.calls.filter(([, msg]) => String(msg).includes('passaram da janela'));
    expect(gritos).toHaveLength(1);

    // A lista mudou: grita de novo.
    fichas.push(ficha({ id: 2, created_at: minutosAtras(60 * 28), cliente_telefone: '5534991110002' }));
    await tick();
    expect(vi.mocked(logger.error).mock.calls.filter(([, msg]) => String(msg).includes('passaram da janela'))).toHaveLength(2);
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

  // Quem disse não, quem já viu proposta e quem já fechou (com a gente ou com outro)
  // não recebe recibo de cadastro.
  it('cancelado, sem_interesse, fez_orcamento, perdido, fechou e fechou_concorrente não recebem', async () => {
    for (const status of ['cancelado', 'sem_interesse', 'fez_orcamento', 'perdido', 'fechou', 'fechou_concorrente']) {
      fichas = [ficha({ status })];
      expect((await tick()).enviadas).toBe(0);
    }
  });

  // A causa nº 1 de 87 pessoas não terem recebido nada em 30 dias: o filtro era
  // `status = 'agendado'` e a ficha sai desse status em minutos. Quem ainda não
  // teve conversa RECEBE, esteja em que status estiver.
  it('em_atendimento e nao_atendeu RECEBEM — a conversa ainda não aconteceu', async () => {
    // Id diferente por status: a rede em memória (`jaTocadas`) é por id e vive
    // enquanto o módulo estiver carregado — repetir o id daria 0 por engano.
    fichas = ['em_atendimento', 'nao_atendeu'].map((status, i) =>
      ficha({ id: i + 1, status, cliente_telefone: `553499111000${i}` }));
    expect((await tick()).enviadas).toBe(2);
  });

  // Ordem do dono: "vamos fazer daqui pra frente". Alargar a janela e o status não
  // pode acordar o backlog de julho — 87 pessoas que já foram atendidas, já
  // disseram não, ou já esqueceram que preencheram.
  it('o piso de "daqui pra frente" segura o backlog antigo', async () => {
    vi.setSystemTime(new Date('2026-08-14T02:00:00.000Z'));        // dentro das 24h do piso
    fichas = [ficha({ id: 1, created_at: '2026-08-13T21:00:00.000Z' })];   // 1h ANTES do piso
    expect((await tick()).enviadas).toBe(0);
    fichas = [ficha({ id: 2, created_at: '2026-08-13T23:00:00.000Z' })];   // 1h depois
    expect((await tick()).enviadas).toBe(1);
  });

  // O supabase-js NÃO lança quando a escrita falha: devolve { error }. A flag agora
  // é gravada ANTES do envio (reserva): se ela não se confirma, a mensagem não sai.
  // Mandar sem flag é o que vira rajada a cada rodada, na linha que já foi bloqueada.
  it('reserva que não grava é erro alto e a mensagem NÃO sai', async () => {
    erroDoUpdate = { message: 'timeout' };
    const r = await tick();
    expect(r).toMatchObject({ enviadas: 0, erros: 1 });
    expect(enviadas).toHaveLength(0);
  });

  // 8 fichas levaram as 5 bolhas duas vezes entre 15/08 e 14/09/2026: o tick roda
  // em mais de um caminho, e duas rodadas sobrepostas liam a mesma ficha vazia.
  it('duas rodadas ao mesmo tempo mandam UMA vez só', async () => {
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a.enviadas + b.enviadas).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  it('envio que falha devolve a ficha pra fila e a próxima rodada tenta de novo', async () => {
    const { sendHuman } = await import('../services/agents/zapiClient');
    vi.mocked(sendHuman).mockRejectedValueOnce(new Error('zapi fora'));
    expect(await tick()).toMatchObject({ enviadas: 0, erros: 1 });
    expect(fichas[0].boas_vindas_at).toBeNull();

    expect((await tick()).enviadas).toBe(1);
    expect(fichas[0].boas_vindas_at).not.toBeNull();
  });

  // Um telefone levou 5 boas-vindas completas entre 25/08 e 14/09/2026: o intake cria
  // ficha nova pro mesmo número e a reserva é por ficha.
  it('mesmo telefone que já recebeu por outra ficha: marca sem mandar de novo', async () => {
    fichas = [
      ficha({ id: 1, telefone_norm: '3491110001', created_at: minutosAtras(60 * 24 * 3), boas_vindas_at: minutosAtras(60 * 24 * 3) }),
      ficha({ id: 2, telefone_norm: '3491110001' }),
    ];
    const r = await tick();
    expect(r.enviadas).toBe(0);
    expect(enviadas).toHaveLength(0);
    expect(fichas[1].boas_vindas_at).not.toBeNull();
    expect(estado.has('solar_bv_dedup:2')).toBe(true);
    expect(carimbos).toHaveLength(0);   // nada saiu, nada conta no teto da linha
  });

  it('duas fichas do mesmo telefone na mesma rodada: só uma recebe', async () => {
    fichas = [
      ficha({ id: 1, telefone_norm: '3491110001', created_at: minutosAtras(3) }),
      ficha({ id: 2, telefone_norm: '3491110001', created_at: minutosAtras(2) }),
    ];
    const r = await tick();
    expect(r.enviadas).toBe(1);
    expect(enviadas).toHaveLength(1);
    expect(fichas.every((f) => f.boas_vindas_at !== null)).toBe(true);
  });

  // A flag é gravada antes do envio. Reserva com mais de 15 minutos sem carimbo de
  // envio é envio que não se confirmou (função morta no meio, 504 na reserva): some
  // de todo painel como "atendida", então tem que virar alarme.
  it('reserva antiga sem prova de envio vira alarme, uma vez por lista', async () => {
    const { logger } = await import('../utils/logger');
    vi.mocked(logger.error).mockClear();
    fichas = [
      ficha({ id: 7, created_at: minutosAtras(60), boas_vindas_at: minutosAtras(30) }),
      ficha({ id: 8, created_at: minutosAtras(60), boas_vindas_at: minutosAtras(30), cliente_telefone: '5534991110008' }),
    ];
    carimbos.push('solar_boasvindas_sent:8');   // a 8 saiu de verdade
    await tick(); await tick();
    const alarmes = vi.mocked(logger.error).mock.calls.filter(([, msg]) => String(msg).includes('sem envio confirmado'));
    expect(alarmes).toHaveLength(1);
    expect(alarmes[0][2]).toEqual({ ids: [7] });
  });

  // A abertura do quiz (agentes5040) reserva boas_vindas_at e entrega pela fila de agenda da Duda: o carimbo dela é outro.
  describe('a abertura do quiz não dá alarme falso', () => {
    const reservaAntiga = (id: number) =>
      ficha({ id, created_at: minutosAtras(60), boas_vindas_at: minutosAtras(30), cliente_telefone: `55349911100${String(id).padStart(2, '0')}` });
    const alarmes = async () => {
      const { logger } = await import('../utils/logger');
      return vi.mocked(logger.error).mock.calls.filter(([, msg]) => String(msg).includes('sem envio confirmado'));
    };

    it('abertura enviada (ag5040_agenda_sent com estado enviado) e abertura ainda na fila (ag5040_agenda_fila) são calados', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(21), reservaAntiga(22)];
      estado.set('ag5040_agenda_sent:21:abertura:20260820T170000Z', { tipo: 'abertura', card_id: 21, estado: 'enviado' });
      estado.set('ag5040_agenda_fila:22:abertura:20260820T170000Z', { tipo: 'abertura' });
      await tick();
      expect(await alarmes()).toHaveLength(0);
    });

    it('o reenvio (carimbo :re com estado enviado) cala, mesmo com o carimbo principal em falhou', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(23)];
      estado.set('ag5040_agenda_sent:23:abertura:20260820T170000Z', { estado: 'falhou', reenviavel: true });
      estado.set('ag5040_agenda_sent:23:abertura:20260820T170000Z:re', { estado: 'enviado', reenvio: true });
      await tick();
      expect(await alarmes()).toHaveLength(0);
    });

    it('carimbo em reservado ou em falhou NÃO cala: o envio pode ter morrido no meio, e o alarme acusa', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(31), reservaAntiga(32), reservaAntiga(33), reservaAntiga(34)];
      estado.set('ag5040_agenda_sent:31:abertura:20260820T170000Z', { estado: 'reservado' });
      estado.set('ag5040_agenda_sent:32:abertura:20260820T170000Z', { estado: 'falhou', erro: 'http_400' });
      estado.set('ag5040_agenda_sent:33:abertura:20260820T170000Z', {});                       // sem estado nenhum
      estado.set('ag5040_agenda_sent:34:abertura:20260820T170000Z', { estado: 'enviado' });    // esta saiu
      await tick();
      const a = await alarmes();
      expect(a).toHaveLength(1);
      expect(a[0][2]).toEqual({ ids: [31, 32, 33] });
    });

    it('a abertura que a fila descartou de propósito (solar_bv_dedup) também cala, e a fila ainda com o item cala mesmo com o carimbo em falhou', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(41), reservaAntiga(42)];
      estado.set('solar_bv_dedup:41', { em: 'x', origem: 'abertura_descartada', motivo: 'opt_out' });
      estado.set('ag5040_agenda_sent:42:abertura:20260820T170000Z', { estado: 'falhou', reenviavel: true });
      estado.set('ag5040_agenda_fila:42:abertura:20260820T170000Z', { tipo: 'abertura' });
      await tick();
      expect(await alarmes()).toHaveLength(0);
    });

    it('a leitura dos carimbos da abertura falhou: o alarme sai mesmo assim (na dúvida, acusa)', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(7)];
      falhaOr = true;
      await tick();
      expect(await alarmes()).toHaveLength(1);
      falhaOr = false;
    });

    it('a reserva sem envio de verdade continua acusada, e o carimbo de outro id ou de outro tipo não a salva', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(7), reservaAntiga(8), reservaAntiga(9), reservaAntiga(10)];
      estado.set('ag5040_agenda_sent:8:abertura:20260820T170000Z', { estado: 'enviado' });   // a 8 saiu
      estado.set('ag5040_agenda_sent:70:abertura:20260820T170000Z', {});                     // a 70 não é a 7
      estado.set('ag5040_agenda_sent:9:confirma:20260820T170000Z', {});                      // confirma sem estado enviado não salva
      await tick(); await tick();
      const a = await alarmes();
      expect(a).toHaveLength(1);
      expect(a[0][2]).toEqual({ ids: [7, 9, 10] });
    });

    it('a confirmação do card de quem já tem posse da Duda: enviada ou ainda na fila cala; reservado ou falhou acusa; o reenvio :re enviado cala', async () => {
      const { logger } = await import('../utils/logger');
      vi.mocked(logger.error).mockClear();
      fichas = [reservaAntiga(51), reservaAntiga(52), reservaAntiga(53), reservaAntiga(54), reservaAntiga(55)];
      estado.set('ag5040_agenda_sent:51:confirma:20260820T170000Z', { tipo: 'confirma', card_id: 51, estado: 'enviado' });
      estado.set('ag5040_agenda_fila:52:confirma:20260820T170000Z', { tipo: 'confirma' });
      estado.set('ag5040_agenda_sent:53:confirma:20260820T170000Z', { estado: 'reservado' });
      estado.set('ag5040_agenda_sent:54:confirma:20260820T170000Z', { estado: 'falhou', reenviavel: true });
      estado.set('ag5040_agenda_sent:54:confirma:20260820T170000Z:re', { estado: 'enviado', reenvio: true });
      estado.set('ag5040_agenda_sent:550:confirma:20260820T170000Z', { estado: 'enviado' });   // a 550 não é a 55
      await tick();
      const a = await alarmes();
      expect(a).toHaveLength(1);
      expect(a[0][2]).toEqual({ ids: [53, 55] });
    });
  });

  it('o dry não grava estado de alarme nenhum', async () => {
    fichas = [ficha({ created_at: minutosAtras(60 * 30) })];
    await tick({ dry: true });
    expect(estado.size).toBe(0);
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

  // 14/09/2026: a agenda do eletroposto (piso 200) somou 65 envios em 24h e as
  // boas-vindas, sem piso, ficaram paradas o dia inteiro atrás do teto do dia.
  it('passa pelo teto com o mesmo piso do dia dos outros transacionais', async () => {
    const { dentroDoTetoHorarioLinha } = await import('../services/agents/whatsapp/lineThrottle');
    vi.mocked(dentroDoTetoHorarioLinha).mockClear();
    await tick();
    expect(dentroDoTetoHorarioLinha).toHaveBeenCalledWith({ transacional: true, pisoDia: 200 });
  });

  // Fechar ficha de telefone repetido não manda nada: não pode esperar a linha abrir.
  it('telefone repetido é fechado mesmo com a linha cheia', async () => {
    tetoLivre = false;
    fichas = [
      ficha({ id: 1, telefone_norm: '3491110001', created_at: minutosAtras(60 * 24 * 3), boas_vindas_at: minutosAtras(60 * 24 * 3) }),
      ficha({ id: 2, telefone_norm: '3491110001' }),
    ];
    expect((await tick()).enviadas).toBe(0);
    expect(enviadas).toHaveLength(0);
    expect(fichas[1].boas_vindas_at).not.toBeNull();
    expect(estado.has('solar_bv_dedup:2')).toBe(true);
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

// ═════════════════════════════════════════════════════════════════════════════
// AGENTES DA LINHA 5040 (Fase B1b): a Duda nova abre o card do quiz; o antigo é a rede de segurança.
// Interruptores e alvo REAIS (env + system_state), o corte é por LEAD.
// ═════════════════════════════════════════════════════════════════════════════
describe('Fase B: a Duda nova e as boas-vindas antigas', () => {
  const QUIZ = 'LP SOLAR QUIZ · Casa · LIGAÇÃO';
  const X = '5534991110001';
  const Y = '5534992220002';
  const cardQuiz = (id: number, tel: string, minutos: number, over: Partial<any> = {}) =>
    ficha({ id, cliente_telefone: tel, telefone_norm: tel.slice(-10), observacao: QUIZ, created_at: minutosAtras(minutos), ...over });
  async function alvo(tels: string[], modos: Record<string, string> = {}) {
    process.env.AGENTES5040_HMAC = 'segredo-de-teste';
    process.env.AGENTES5040_DUDA_VIVO = '1';
    const { hmacDe, idChaveHmac } = await import('../services/agentes5040/hmac');
    const { chaveContato } = await import('../services/agents/whatsapp/silenciar');
    estado.set('ag5040_vivo_alvo', { kid: idChaveHmac(), hmacs: tels.map(t => hmacDe(chaveContato(t)!)), modos });
  }
  // O posse real guarda o alvo em cache de 60 s e sobrevive ao resetModules. O relógio do teste é fixo, então
  // cada teste avança 61 s sobre o anterior (os cards de 2 min viram, no máximo, 9 min: ainda abaixo dos 15).
  let n = 0;
  // Este describe grava AGENTES5040_DUDA_VIVO e AGENTES5040_HMAC no process.env: guarda o que havia e devolve ao fim.
  const CHAVES_ENV = ['AGENTES5040_DUDA_VIVO', 'AGENTES5040_HMAC'] as const;
  let envAntes: Record<string, string | undefined> = {};
  beforeEach(() => {
    envAntes = Object.fromEntries(CHAVES_ENV.map(k => [k, process.env[k]]));
    cortes.cede.clear();
    vi.setSystemTime(new Date(AGORA.getTime() + (++n) * 61_000));
  });
  afterEach(() => {
    for (const k of CHAVES_ENV) { if (envAntes[k] === undefined) delete process.env[k]; else process.env[k] = envAntes[k]; }
  });

  it('TESTE OBRIGATÓRIO: duda_vivo ligado, alvo = [X]: o lead Y recebe as boas-vindas antigas; o X (card novo) fica para a Duda nova', async () => {
    await alvo([X]);
    fichas = [cardQuiz(1, X, 2), cardQuiz(2, Y, 2)];
    const r = await tick();
    expect(r.enviadas).toBe(1);
    expect(enviadas.map(e => e.phone)).toEqual([Y]);
    expect(updates).toEqual([{ id: 2, campo: 'boas_vindas_at' }]);
    expect(fichas[0].boas_vindas_at).toBeNull();   // intacto: a reserva é da Duda nova
  });

  it('o X com mais de 15 min sem boas-vindas: o antigo manda como hoje (rede de segurança)', async () => {
    await alvo([X]);
    fichas = [cardQuiz(1, X, 20)];
    expect((await tick()).enviadas).toBe(1);
    expect(enviadas.map(e => e.phone)).toEqual([X]);
  });

  it('card que não é do quiz, mesmo do X: o antigo manda (a Duda nova só abre card do quiz)', async () => {
    await alvo([X]);
    fichas = [ficha({ id: 1, created_by: 'lead-meta', cliente_telefone: X, telefone_norm: X.slice(-10), created_at: minutosAtras(2) })];
    expect((await tick()).enviadas).toBe(1);
  });

  it('sem alvo gravado: a Duda nova não atende ninguém e o antigo manda como hoje', async () => {
    process.env.AGENTES5040_HMAC = 'segredo-de-teste';
    process.env.AGENTES5040_DUDA_VIVO = '1';
    fichas = [cardQuiz(1, X, 2)];
    expect((await tick()).enviadas).toBe(1);
  });

  it('interruptor desligado, mesmo com o alvo gravado: o antigo manda como hoje', async () => {
    await alvo([X]);
    process.env.AGENTES5040_DUDA_VIVO = '0';
    fichas = [cardQuiz(1, X, 2)];
    expect((await tick()).enviadas).toBe(1);
  });

  it('modo todos gravado, mas a Duda ainda fora da lista de liberadas: vale como teste e o antigo manda como hoje', async () => {
    // A lista de liberadas é de produção (a Duda já está nela): este teste prova a regra com a lista VAZIA e devolve a lista no fim.
    const { DONAS_LIBERADAS_PARA_TODOS } = await import('../services/agentes5040/posse');
    const lista = DONAS_LIBERADAS_PARA_TODOS as string[];
    const salvas = [...lista];
    lista.length = 0;
    try {
      await alvo([X], { duda: 'todos' });
      fichas = [cardQuiz(1, X, 2), cardQuiz(2, Y, 2)];
      const r = await tick();
      expect(r.enviadas).toBe(1);
      expect(enviadas.map(e => e.phone)).toEqual([Y]);   // só o X (alvo) espera a Duda nova
    } finally { lista.length = 0; lista.push(...salvas); }
  });

  it('modo todos (Duda liberada): card novo do quiz de qualquer lead espera a Duda nova (15 min); depois disso o antigo manda', async () => {
    const { DONAS_LIBERADAS_PARA_TODOS } = await import('../services/agentes5040/posse');
    const lista = DONAS_LIBERADAS_PARA_TODOS as string[];
    const salvas = [...lista];
    if (!lista.includes('duda')) lista.push('duda');
    try {
      await alvo([], { duda: 'todos' });
      fichas = [cardQuiz(1, X, 2), cardQuiz(2, Y, 20)];
      expect((await tick()).enviadas).toBe(1);
      expect(enviadas.map(e => e.phone)).toEqual([Y]);
    } finally { lista.length = 0; lista.push(...salvas); }
  });

  it('conversa que uma agente nova já segura (posse): o antigo não manda por cima, em idade nenhuma, e a ficha não é marcada', async () => {
    cortes.cede.add('5534991110001');
    fichas = [cardQuiz(1, X, 60), cardQuiz(2, Y, 60)];
    const r = await tick();
    expect(r.enviadas).toBe(1);
    expect(enviadas.map(e => e.phone)).toEqual([Y]);
    expect(updates).toEqual([{ id: 2, campo: 'boas_vindas_at' }]);
  });
});
