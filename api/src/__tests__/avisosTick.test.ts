import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// O Menu de Avisos manda mensagem de verdade pela linha da empresa (34998165040),
// que já foi bloqueada 3× em 7 dias por leva de envio. Erro aqui não dá tela
// vermelha: vira rajada no WhatsApp, ou a mesma pauta chegando duas vezes pra
// quem já tinha recebido. Por isso o que este arquivo trava é comportamento de
// FREIO — um envio por tick, quem pediu pra sair não recebe, telefone repetido
// conta uma vez — e não o caminho feliz.
// ─────────────────────────────────────────────────────────────────────────────

interface LinhaAviso {
  id: string; titulo: string | null; corpo: string; publicos: string[];
  midia_url: string | null; midia_tipo: string | null; status: string;
  alvo: number; sucesso: number; falha: number; iniciado_em: string | null;
  criado_em: string; tick_lock_until: string | null; finalizado_em?: string | null;
}
interface LinhaEnvio { aviso_id: string; phone: string; status: string; enviado_em: string }
interface LinhaParceria {
  telefone: string; nome: string | null; cidade: string | null; lado: string;
  status: string | null; created_at: string;
}

const db: { avisos: LinhaAviso[]; aviso_envios: LinhaEnvio[]; eletroposto_parceria: LinhaParceria[] } = {
  avisos: [], aviso_envios: [], eletroposto_parceria: [],
};

/** Builder mínimo do PostgREST: só o que o serviço realmente encadeia. */
function fakeFrom(tabela: string) {
  const q: any = {
    _filtros: [] as Array<(r: any) => boolean>,
    _contando: false,
    select(_c?: string, opts?: { count?: string; head?: boolean }) {
      q._contando = opts?.count === 'exact';
      return q;
    },
    eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return q; },
    gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
    in(col: string, vals: any[]) { q._filtros.push((r: any) => vals.includes(r[col])); return q; },
    or() { return q; },
    order() { return q; },
    limit() { return q; },
    insert(linha: any) {
      (db as any)[tabela].push({ enviado_em: new Date().toISOString(), ...linha });
      return Promise.resolve({ data: null, error: null });
    },
    update(patch: any) {
      return {
        eq(col: string, val: any) {
          (db as any)[tabela].filter((r: any) => r[col] === val).forEach((r: any) => Object.assign(r, patch));
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    _resolver() {
      const linhas = ((db as any)[tabela] || []).filter((r: any) => q._filtros.every((f: any) => f(r)));
      return Promise.resolve({ data: q._contando ? null : linhas, error: null, count: linhas.length });
    },
    then(res: any, rej: any) { return q._resolver().then(res, rej); },
  };
  return q;
}

const upsertSpy = vi.fn(async () => ({ error: null }));
// Banco MAIN: guarda o marcador da linha (upsert) e os envios do disparo do
// /admin, que o tick consulta pra não sair logo depois de um blast.
const dbMain: { io_broadcast_envios: Array<{ id: number; enviado_em: string }> } = { io_broadcast_envios: [] };
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => ({
      upsert: (...args: any[]) => {
        const p: any = upsertSpy(...(args as []));
        // O serviço encadeia .then(cb) no upsert pra logar erro de marcador.
        return { then: (res: any, rej: any) => p.then(res, rej) };
      },
      select: () => {
        const q: any = {
          _filtros: [] as Array<(r: any) => boolean>,
          gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
          limit() { return q; },
          then(res: any, rej: any) {
            const linhas = ((dbMain as any)[tabela] || []).filter((r: any) => q._filtros.every((f: any) => f(r)));
            return Promise.resolve({ data: linhas, error: null }).then(res, rej);
          },
        };
        return q;
      },
    }),
  },
}));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => fakeFrom(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const enviarZapiIO = vi.fn(async () => ({ ok: true, zaapId: 'z1', messageId: 'm1' }));
vi.mock('../services/io/ioSend', () => ({
  enviarZapiIO: (...a: any[]) => enviarZapiIO(...(a as [])),
  adquirirLockBlast: vi.fn(async () => true),
  liberarLockBlast: vi.fn(async () => undefined),
}));

// Silêncio é mockado; chaveContato NÃO — ela é a régua de identidade de telefone
// que o dedupe deste serviço usa, e testar contra uma cópia não provaria nada.
const silenciados = new Set<string>();
vi.mock('../services/agents/whatsapp/silenciar', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/agents/whatsapp/silenciar')>();
  return {
    ...real,
    carregarSilenciados: vi.fn(async () => (phone: string) => silenciados.has(real.chaveContato(phone) || '')),
  };
});

// O teto COMPARTILHADO da linha não entra aqui de propósito (vive estourado
// pelos agentes com piso próprio; a medição está no serviço). O que vale pro
// aviso é a janela, o espaçamento da linha e o teto próprio dele.
const gates = { janela: true, espaco: true };
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDaJanelaDiurna: () => gates.janela,
  respeitaEspacamentoLinha: async () => gates.espaco,
}));

import { runAvisosTick, montarTextoAviso, previsaoDias, telefoneValido } from '../services/io/avisosTickService';

const avisoBase = (over: Partial<LinhaAviso> = {}): LinhaAviso => ({
  id: 'a1', titulo: 'Oportunidade', corpo: 'Chegou ponto novo em {cidade}, {nome}.',
  publicos: ['capital'], midia_url: null, midia_tipo: null, status: 'rodando',
  alvo: 0, sucesso: 0, falha: 0, iniciado_em: null,
  criado_em: '2026-09-17T09:00:00Z', tick_lock_until: null, ...over,
});
const contato = (tel: string, over: Partial<LinhaParceria> = {}): LinhaParceria => ({
  telefone: tel, nome: 'Maria Silva', cidade: 'Uberlândia', lado: 'capital',
  status: 'novo', created_at: '2026-09-10T12:00:00Z', ...over,
});

beforeEach(() => {
  db.avisos = []; db.aviso_envios = []; db.eletroposto_parceria = [];
  dbMain.io_broadcast_envios = [];
  silenciados.clear();
  gates.janela = true; gates.espaco = true;
  enviarZapiIO.mockClear(); upsertSpy.mockClear();
  delete process.env.AVISOS_OFF;
  delete process.env.AVISOS_TETO_DIA;
  delete process.env.AVISOS_TETO_HORA;
  delete process.env.AVISOS_DIAS_ENTRE;
});

describe('montarTextoAviso', () => {
  it('troca {nome} pelo primeiro nome e {cidade} pela cidade do cadastro', () => {
    const t = montarTextoAviso({ titulo: 'Ponto novo', corpo: 'Oi {nome}, apareceu ponto em {cidade}.' },
      { nome: 'Maria Silva', cidade: 'Uberlândia' });
    expect(t).toContain('*Ponto novo*');
    expect(t).toContain('Oi Maria, apareceu ponto em Uberlândia.');
  });

  it('cadastro sem nome não vira "Oi ," na cara do cliente', () => {
    const t = montarTextoAviso({ titulo: null, corpo: 'Oi {nome}, tudo bem?' }, { nome: null });
    expect(t).toContain('Oi, tudo bem?');
    expect(t).not.toContain('Oi ,');
  });

  it('carrega sempre a linha de por que a pessoa está recebendo', () => {
    const t = montarTextoAviso({ titulo: null, corpo: 'Pauta.' }, {});
    expect(t).toContain('se cadastrou como parceiro do eletroposto');
  });
});

describe('previsaoDias e telefoneValido', () => {
  it('diz em quantos dias a pauta chega em todo mundo', () => {
    expect(previsaoDias(81, 20)).toBe(5);
    expect(previsaoDias(0, 20)).toBe(0);
  });
  it('recusa telefone que a Z-API não aceita', () => {
    expect(telefoneValido('5534998165040')).toBe('5534998165040');
    expect(telefoneValido('34998165040')).toBeNull();      // sem DDI
    expect(telefoneValido('')).toBeNull();
  });
});

describe('runAvisosTick — os freios', () => {
  it('manda UM contato por tick, mesmo com fila cheia', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351'), contato('5585988830882'), contato('5513991983752')];

    const r = await runAvisosTick();

    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
    expect(r.enviados).toBe(1);
    expect(r.restantes).toBe(2);
    expect(db.avisos[0].status).toBe('rodando');
  });

  it('carimba o marcador da linha pra os outros robôs recuarem', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];

    await runAvisosTick();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(String((upsertSpy.mock.calls[0] as any[])[0].key)).toMatch(/^aviso_sent:5511960284351:/);
  });

  it('quem a equipe marcou sem_interesse não recebe', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351', { status: 'sem_interesse' })];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('todos_receberam');
  });

  it('quem pediu pra parar não recebe', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    silenciados.add('11960284351'.slice(0, 2) + '60284351');

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('todos_receberam');
  });

  it('o mesmo telefone com e sem o nono dígito conta uma vez só', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5534991360172'), contato('553491360172')];

    await runAvisosTick();
    expect(enviarZapiIO).toHaveBeenCalledTimes(1);

    // Segundo tick: o primeiro já foi, e a outra grafia do MESMO número não pode
    // virar um segundo envio.
    await runAvisosTick();
    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
    expect(db.avisos[0].status).toBe('concluido');
  });

  it('não repete quem já recebeu este aviso', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    db.aviso_envios = [{ aviso_id: 'a1', phone: '5511960284351', status: 'ok', enviado_em: '2026-09-17T10:00:00Z' }];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.status).toBe('concluido');
  });

  it('segura quem levou OUTRO aviso faz pouco tempo, sem dar a pauta por concluída', async () => {
    db.avisos = [avisoBase({ id: 'a2' })];
    db.eletroposto_parceria = [contato('5511960284351')];
    db.aviso_envios = [{
      aviso_id: 'a1', phone: '5511960284351', status: 'ok',
      enviado_em: new Date(Date.now() - 6 * 3600_000).toISOString(),
    }];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('aguardando_piso_de_dias');
    expect(db.avisos[0].status).toBe('rodando');
  });

  it('teto do dia estourado segura o envio', async () => {
    process.env.AVISOS_TETO_DIA = '1';
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    db.aviso_envios = [{ aviso_id: 'a0', phone: '5599999999999', status: 'ok', enviado_em: new Date().toISOString() }];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('teto_dia_avisos');
  });

  it('fora da janela diurna não sai nada', async () => {
    gates.janela = false;
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('fora_da_janela');
  });

  it('disparo em andamento segura o aviso, mesmo sem marcador na linha', async () => {
    // Os motores de blast não carimbam system_state: se o tick olhasse só o
    // marcador, um aviso sairia 1 segundo depois da décima mensagem de uma
    // campanha, que é a forma exata da rajada que derruba número.
    dbMain.io_broadcast_envios = [{ id: 1, enviado_em: new Date(Date.now() - 60_000).toISOString() }];
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('blast_em_andamento');
  });

  it('disparo de ontem não segura nada', async () => {
    dbMain.io_broadcast_envios = [{ id: 1, enviado_em: new Date(Date.now() - 26 * 3600_000).toISOString() }];
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];

    await runAvisosTick();

    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
  });

  it('espaçamento da linha (outro robô acabou de mandar) segura o aviso', async () => {
    gates.espaco = false;
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('espacamento_linha');
  });

  it('kill-switch AVISOS_OFF congela tudo', async () => {
    process.env.AVISOS_OFF = '1';
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];

    expect((await runAvisosTick()).motivo).toBe('desligado');
    expect(enviarZapiIO).not.toHaveBeenCalled();
  });

  it('dry anda o caminho inteiro, diz quem seria o próximo e não escreve nada', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351'), contato('5585988830882')];

    const r = await runAvisosTick({ dry: true });

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('passaria_agora');
    expect(r.proximo).toBe('5511960284351');
    expect(r.restantes).toBe(2);
    expect(db.aviso_envios).toHaveLength(0);
    expect(db.avisos[0].tick_lock_until).toBeNull();
    expect(db.avisos[0].sucesso).toBe(0);
  });

  it('só fala com os grupos escolhidos na tela', async () => {
    db.avisos = [avisoBase({ publicos: ['integrador'] })];
    db.eletroposto_parceria = [
      contato('5511960284351', { lado: 'capital' }),
      contato('5564984216277', { lado: 'integrador', nome: 'Anderson' }),
    ];

    await runAvisosTick();

    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
    expect((enviarZapiIO.mock.calls[0] as any[])[0]).toBe('5564984216277');
  });
});
