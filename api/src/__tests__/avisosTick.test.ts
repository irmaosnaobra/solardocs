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

const db: { avisos: LinhaAviso[]; aviso_envios: LinhaEnvio[]; eletroposto_parceria: LinhaParceria[];
            eletroposto_nota1: any[]; agendamentos: any[] } = {
  avisos: [], aviso_envios: [], eletroposto_parceria: [], eletroposto_nota1: [], agendamentos: [],
};
/** Tabelas que respondem com ERRO nesta rodada: é como se prova o fail-closed. */
const falhar = new Set<string>();
/** Tabela -> começo do `range` que responde com ERRO (prova que erro na página 2 não envia). */
const falharNaPaginaDe = new Map<string, number>();
/** O PostgREST real devolve no máximo 1000 linhas por resposta, em silêncio. */
const MAX_LINHAS_RESPOSTA = 1000;

/** Builder mínimo do PostgREST: só o que o serviço realmente encadeia. */
function fakeFrom(tabela: string) {
  const q: any = {
    _filtros: [] as Array<(r: any) => boolean>,
    _contando: false,
    _faixa: null as [number, number] | null,
    select(_c?: string, opts?: { count?: string; head?: boolean }) {
      q._contando = opts?.count === 'exact';
      return q;
    },
    eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return q; },
    gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
    in(col: string, vals: any[]) { q._filtros.push((r: any) => vals.includes(r[col])); return q; },
    ilike(col: string, padrao: string) {
      const partes = String(padrao).toLowerCase().split('%').filter(Boolean);
      q._filtros.push((r: any) => partes.every(t => String(r[col] ?? '').toLowerCase().includes(t)));
      return q;
    },
    contains(col: string, vals: any[]) { q._filtros.push((r: any) => vals.every(v => (r[col] || []).includes(v))); return q; },
    or() { return q; },
    order() { return q; },
    limit() { return q; },
    range(de: number, ate: number) { q._faixa = [de, ate]; return q; },
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
      if (falhar.has(tabela)) return Promise.resolve({ data: null, error: { message: 'caiu' }, count: null });
      if (q._faixa && falharNaPaginaDe.get(tabela) === q._faixa[0]) {
        return Promise.resolve({ data: null, error: { message: 'caiu na pagina' }, count: null });
      }
      const todas = ((db as any)[tabela] || []).filter((r: any) => q._filtros.every((f: any) => f(r)));
      const faixa = q._faixa ? todas.slice(q._faixa[0], q._faixa[1] + 1) : todas;
      const linhas = faixa.slice(0, MAX_LINHAS_RESPOSTA);
      return Promise.resolve({ data: q._contando ? null : linhas, error: null, count: todas.length });
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
// O serviço lê em modo ESTRITO (11/10): o mock registra o argumento pra provar isso.
const leituraFalha = { optout: false, pausas: false };
const carregarSilenciadosMock = vi.fn(async (_o?: { estrito?: boolean }) => {
  if (leituraFalha.optout) throw new Error('leitura do opt-out falhou: caiu');
  return null as unknown;
});
vi.mock('../services/agents/whatsapp/silenciar', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/agents/whatsapp/silenciar')>();
  return {
    ...real,
    carregarSilenciados: async (o?: { estrito?: boolean }) => {
      await carregarSilenciadosMock(o);
      return (phone: string) => silenciados.has(real.chaveContato(phone) || '');
    },
  };
});
const carregarPausasMock = vi.fn(async (_o?: { estrito?: boolean }) => {
  if (leituraFalha.pausas) throw new Error('leitura das pausas falhou: caiu');
});
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  carregarPausas: async (o?: { estrito?: boolean }) => {
    await carregarPausasMock(o);
    return () => ({ pode: true, motivo: 'sem-pausa' });
  },
}));

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
  db.avisos = []; db.aviso_envios = []; db.eletroposto_parceria = []; db.eletroposto_nota1 = []; db.agendamentos = [];
  falhar.clear(); falharNaPaginaDe.clear();
  leituraFalha.optout = false; leituraFalha.pausas = false;
  carregarSilenciadosMock.mockClear(); carregarPausasMock.mockClear();
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

  it('o Curioso NÃO ouve que se cadastrou: a maioria só preencheu a ficha da LP', () => {
    const t = montarTextoAviso({ titulo: null, corpo: 'Quanto pensa em investir?' }, { lado: 'curioso' });
    expect(t).toContain('pediu informações sobre eletroposto');
    expect(t).not.toContain('se cadastrou');
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

describe('o grupo CURIOSO (21/09/2026)', () => {
  const curiosoBase = () => {
    db.eletroposto_parceria = [
      // disse 140 mil: é investidor, não recebe a pergunta
      { ...contato('5511900000001', { lado: 'capital' }), id: 1, capital_faixa: 'R$ 140 mil' } as any,
      // "depende do ponto": curioso
      { ...contato('5511900000002', { lado: 'capital' }), id: 2, capital_faixa: 'Depende do ponto' } as any,
    ];
    db.eletroposto_nota1 = [
      { id: 7, telefone: '5511900000003', nome: 'Ficha Lp', cidade: 'Goiânia', ficha: '', valor_investir: null,
        status: 'novo', created_at: '2026-09-12T12:00:00Z' },
    ];
    db.avisos = [avisoBase({ publicos: ['curioso'], corpo: 'Oi {nome}, quanto pensa em investir?' })];
  };

  it('manda pra quem não disse o valor, de cadastro e de ficha, com o rodapé do Curioso', async () => {
    curiosoBase();
    const r = await runAvisosTick();
    expect(r.enviados).toBe(1);
    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
    const texto = String((enviarZapiIO.mock.calls[0] as any[])[1]);
    expect(texto).toContain('pediu informações sobre eletroposto');
    const envio = db.aviso_envios[0] as any;
    expect(envio.lado).toBe('curioso');
    expect(['parceria:2', 'nota1:7']).toContain(envio.origem_ref);
    // o investidor de 140 mil não está na audiência
    expect(db.avisos[0].alvo).toBe(2);
  });

  it('a pauta anda até os dois e só então conclui', async () => {
    curiosoBase();
    await runAvisosTick();
    await runAvisosTick();
    const fones = db.aviso_envios.map(e => e.phone).sort();
    expect(fones).toEqual(['5511900000002', '5511900000003']);
    expect(db.avisos[0].status).toBe('concluido');
  });

  it('ERRO lendo as fichas não conclui a pauta: sem lista não sai nada, e ela continua na fila', async () => {
    curiosoBase();
    falhar.add('eletroposto_nota1');
    const r = await runAvisosTick();
    expect(r.motivo).toBe('erro_lista');
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(db.avisos[0].status).toBe('rodando');
  });
});


// -----------------------------------------------------------------------------
// O GRUPO "DONO NAO PERGUNTADO" (29/09/2026)
//
// Tem endereco na ficha e ninguem perguntou de quem e o local. A resposta vale uma
// vaga em Arrendamento, e sao 117 pessoas: a pauta e uma pergunta so.
//
// O que este bloco trava: a reuniao PERDIDA entra (o desfecho da reuniao nao e
// status de cadastro, e passar 'sem_interesse' pra frente descartaria justamente
// ela), quem ja respondeu NAO recebe, e o rodape e o do Curioso, porque essa
// pessoa nunca se cadastrou como parceiro.
// -----------------------------------------------------------------------------
describe('o grupo DONO NAO PERGUNTADO (29/09/2026)', () => {
  const base = () => {
    db.eletroposto_parceria = [
      // cadastro de investidor com endereco e sem resposta: entra
      { ...contato('5511900000010', { lado: 'capital' }), id: 10,
        ponto_endereco: 'Av. X, 10', capital_faixa: 'R$ 140 mil' } as any,
    ];
    db.eletroposto_nota1 = [
      // respondeu que ainda nao e dele: nao recebe a pergunta de novo
      { id: 20, telefone: '5511900000011', nome: 'Respondeu', cidade: 'Goiânia',
        endereco: 'Rua Z, 30', ficha: 'Local é seu: Ainda não é meu', status: 'novo',
        created_at: '2026-09-12T12:00:00Z' },
    ];
    db.agendamentos = [
      // ── ESTA FICHA ERA `sem_interesse` ATÉ 05/10/2026 ────────────────────
      //
      // Ela nasceu em 29/09 escrita assim, com o comentário "reuniao perdida por
      // falta de dinheiro, com endereco: ENTRA" — e era a regra certa naquele
      // dia: quem perdeu a reunião por não ter capital continua sendo dono de um
      // LOCAL, que é outro eixo.
      //
      // A ordem do dono em 05/10 inverte isso, e ele a repetiu três vezes: "sem
      // interesse, quando eu colocar, eu não quero falar com essa pessoa por agora
      // mais". Medido no dia: 37 das 111 pessoas desta audiência estavam em
      // `sem_interesse`.
      //
      // A ficha virou `cancelado` pra o teste continuar provando o que ele
      // existe pra provar — reunião MORTA com endereço entra — porque `cancelado`
      // é posto por robô (a régua do SIM), não é declaração de ninguém.
      { id: 800, created_by: 'lp_eletroposto', status: 'cancelado', cliente_nome: 'Dono Perdido',
        cliente_telefone: '5511900000012', cidade: 'Anápolis',
        observacao: 'LP ELETROPOSTO — Posto\nEndereço: Av. K, 50', created_at: '2026-09-14T12:00:00Z' },
      // reuniao de outro produto: fora
      { id: 801, created_by: 'lp_solar', status: 'agendado', cliente_nome: 'Solar',
        cliente_telefone: '5511900000013', cidade: 'Anápolis',
        observacao: 'Endereço: Av. M, 70', created_at: '2026-09-14T12:00:00Z' },
      // DISSE NÃO (05/10/2026): tem endereço, nunca foi perguntado, e mesmo assim
      // NÃO entra. O corte vive em `precisaPerguntarDoDono`, não aqui no tick: a
      // linha que vem da agenda chega ao tick com `status: null` de propósito, e
      // por isso o `continue` de `sem_interesse` do tick nunca a tocava.
      { id: 802, created_by: 'lp_eletroposto', status: 'sem_interesse', cliente_nome: 'Disse Nao',
        cliente_telefone: '5511900000014', cidade: 'Anápolis',
        observacao: 'LP ELETROPOSTO — Posto\nEndereço: Av. Q, 90', created_at: '2026-09-14T12:00:00Z' },
    ];
    db.avisos = [avisoBase({ publicos: ['sem_dono'], corpo: 'Oi {nome}, o local do seu ponto é seu mesmo?' })];
  };

  it('a reunião perdida recebe a pergunta, e quem já respondeu não', async () => {
    base();
    const r = await runAvisosTick();
    expect(r.enviados).toBe(1);
    // dois na audiência: o cadastro sem resposta e a reunião morta.
    // O terceiro candidato (802) tem endereço e nunca foi perguntado, e mesmo
    // assim não conta: ele disse NÃO. Se o corte cair, este número vira 3.
    expect(db.avisos[0].alvo).toBe(2);
    const fones = db.aviso_envios.map(e => e.phone);
    expect(['5511900000010', '5511900000012']).toContain(fones[0]);
    expect(fones).not.toContain('5511900000011');   // já respondeu
    expect(fones).not.toContain('5511900000013');   // outro produto
    expect(fones).not.toContain('5511900000014');   // disse NÃO (05/10/2026)
  });

  it('quem está em SEM INTERESSE não recebe, nem na segunda volta', async () => {
    // O par do teste acima. A pauta anda 1 por tick: só olhar o primeiro envio
    // não prova que o 802 ficou fora, prova que ele não foi o primeiro. Aqui a
    // pauta anda até CONCLUIR, e aí a lista inteira de quem recebeu é o veredito.
    base();
    await runAvisosTick();
    await runAvisosTick();
    await runAvisosTick();
    const fones = db.aviso_envios.map(e => e.phone).sort();
    expect(fones).toEqual(['5511900000010', '5511900000012']);
    expect(fones).not.toContain('5511900000014');
    expect(db.avisos[0].status).toBe('concluido');
  });

  it('o rodapé é o do Curioso: essa pessoa nunca se cadastrou como parceiro', async () => {
    base();
    await runAvisosTick();
    const texto = String((enviarZapiIO.mock.calls[0] as any[])[1]);
    expect(texto).toContain('pediu informações sobre eletroposto');
    expect(texto).not.toContain('se cadastrou como parceiro');
  });

  it('a pauta anda até os dois e só então conclui', async () => {
    base();
    await runAvisosTick();
    await runAvisosTick();
    expect(db.aviso_envios.map(e => e.phone).sort()).toEqual(['5511900000010', '5511900000012']);
    expect(db.avisos[0].status).toBe('concluido');
  });

  it('ERRO lendo a agenda não conclui a pauta: sem lista não sai nada', async () => {
    base();
    falhar.add('agendamentos');
    const r = await runAvisosTick();
    expect(r.motivo).toBe('erro_lista');
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(db.avisos[0].status).toBe('rodando');
  });
});

// -----------------------------------------------------------------------------
// A LISTA DE QUEM JA RECEBEU E LIDA POR PAGINA (15/10/2026)
//
// O PostgREST corta em 1000 linhas sem erro. Lida sem paginar, uma pauta com mais
// de 1000 envios fazia quem ja recebeu parecer novo, e a mensagem saia de novo.
// O fake acima corta em 1000 como o real, entao estes testes falham no codigo antigo.
// -----------------------------------------------------------------------------
describe('aviso_envios paginado: a pauta grande nao reenvia', () => {
  const fone = (i: number) => `55119${String(i).padStart(8, '0')}`;
  const envioOk = (i: number): LinhaEnvio => ({
    aviso_id: 'a1', phone: fone(i), status: 'ok', enviado_em: '2026-09-18T12:00:00Z',
  });

  it('2500 envios ja feitos: ninguem deles recebe de novo, mesmo os que ficam alem da linha 1000', async () => {
    db.avisos = [avisoBase()];
    // A audiencia sao os 3 ULTIMOS da lista de envios: o corte de 1000 os esconderia.
    db.aviso_envios = Array.from({ length: 2500 }, (_, i) => envioOk(i));
    db.eletroposto_parceria = [2497, 2498, 2499].map(i => contato(fone(i)));

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toBe('todos_receberam');
    expect(db.aviso_envios).toHaveLength(2500);
  });

  it('com 2500 envios feitos, quem ainda nao recebeu e o unico que sai', async () => {
    db.avisos = [avisoBase()];
    db.aviso_envios = Array.from({ length: 2500 }, (_, i) => envioOk(i));
    db.eletroposto_parceria = [contato(fone(2499)), contato(fone(9000000))];

    await runAvisosTick();

    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
    expect((enviarZapiIO.mock.calls[0] as any[])[0]).toBe(fone(9000000));
  });

  it('ERRO na pagina 2 nao envia nada: sem a lista inteira todo mundo pareceria novo', async () => {
    db.avisos = [avisoBase()];
    db.aviso_envios = Array.from({ length: 2500 }, (_, i) => envioOk(i));
    db.eletroposto_parceria = [contato(fone(2499)), contato(fone(9000000))];
    falharNaPaginaDe.set('aviso_envios', 1000);

    const r = await runAvisosTick();

    expect(r.motivo).toBe('erro_envios');
    expect(r.enviados).toBe(0);
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(db.avisos[0].status).toBe('rodando');
  });

  it('o piso entre avisos tambem e lido inteiro: erro na pagina 2 nao envia nada', async () => {
    process.env.AVISOS_DIAS_ENTRE = '7';
    db.avisos = [avisoBase()];
    const recente = new Date(Date.now() - 86400_000).toISOString();
    db.aviso_envios = Array.from({ length: 2500 }, (_, i) => ({
      aviso_id: 'outra', phone: fone(i), status: 'ok', enviado_em: recente,
    }));
    db.eletroposto_parceria = [contato(fone(9000000))];
    falharNaPaginaDe.set('aviso_envios', 1000);

    const r = await runAvisosTick();

    expect(r.motivo).toBe('piso_indisponivel');
    expect(enviarZapiIO).not.toHaveBeenCalled();
  });

  it('o piso entre avisos enxerga quem recebeu de OUTRA pauta alem da linha 1000', async () => {
    process.env.AVISOS_DIAS_ENTRE = '7';
    db.avisos = [avisoBase()];
    const recente = new Date(Date.now() - 86400_000).toISOString();
    db.aviso_envios = Array.from({ length: 2500 }, (_, i) => ({
      aviso_id: 'outra', phone: fone(i), status: 'ok', enviado_em: recente,
    }));
    db.eletroposto_parceria = [contato(fone(2499))];

    const r = await runAvisosTick();

    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('aguardando_piso_de_dias');
  });
});

// -----------------------------------------------------------------------------
// OPT-OUT, PAUSA HUMANA E SEM_INTERESSE LIDOS INTEIROS (15/10/2026)
// Os tres so REDUZEM envio. O modo normal das leituras de bloqueio para em 1000
// linhas e, no erro, libera todo mundo.
// -----------------------------------------------------------------------------
describe('lista de exclusao: estrita, inteira e fechada', () => {
  it('le o opt-out e as pausas em modo estrito', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    await runAvisosTick();
    expect(carregarSilenciadosMock).toHaveBeenCalledWith({ estrito: true });
    expect(carregarPausasMock).toHaveBeenCalledWith({ estrito: true });
    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
  });

  it('ERRO lendo o opt-out nao envia nada (erro_optout)', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    leituraFalha.optout = true;
    const r = await runAvisosTick();
    expect(r.motivo).toBe('erro_optout');
    expect(r.enviados).toBe(0);
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(db.avisos[0].status).toBe('rodando');
  });

  it('ERRO lendo as pausas nao envia nada (erro_pausas)', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    leituraFalha.pausas = true;
    const r = await runAvisosTick();
    expect(r.motivo).toBe('erro_pausas');
    expect(enviarZapiIO).not.toHaveBeenCalled();
  });

  it('quem esta no opt-out nao recebe, e a pauta conclui sem enviar', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato('5511960284351')];
    silenciados.add('11' + '60284351');
    const r = await runAvisosTick();
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.motivo).toBe('todos_receberam');
  });

  it('sem_interesse alem da linha 1000 de uma fonte NAO entra pela outra', async () => {
    db.avisos = [avisoBase({ publicos: ['capital', 'curioso'] })];
    const fone = (i: number) => `55119${String(i).padStart(8, '0')}`;
    // 1500 linhas de ruido do mesmo lado; a pessoa que disse NAO e a ULTIMA da lista
    // (fora das 1000 que a leitura de entrada enxerga) e tambem consta numa ficha.
    const ruido = Array.from({ length: 1500 }, (_, i) =>
      contato(fone(i), { lado: 'capital', status: 'sem_interesse' }));
    const quemDisseNao = contato(fone(5000000), { lado: 'ponto', status: 'sem_interesse' });
    db.eletroposto_parceria = [...ruido, quemDisseNao];
    db.eletroposto_nota1 = [{
      id: 7, nome: 'Joao', telefone: fone(5000000), cidade: 'Uberlandia',
      ficha: 'Quanto pretende investir: 10 mil', valor_investir: null, status: 'novo', created_at: '2026-09-10T12:00:00Z',
    }];
    const r = await runAvisosTick();
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  const fone2 = (i: number) => `55119${String(i).padStart(8, '0')}`;
  const cardAgenda = (i: number, tel: string, status: string) => ({
    id: i, cliente_nome: 'Ana', cliente_telefone: tel, cidade: 'Uberlandia', status,
    created_by: 'eletroposto', created_at: '2026-09-10T12:00:00Z',
  });

  it.each(['perdido', 'sem_interesse'])('card da AGENDA em %s: o telefone nao entra pela base de parceria', async (status) => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato(fone2(1))];
    db.agendamentos = [cardAgenda(1, fone2(1), status)];
    const r = await runAvisosTick();
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it('card da agenda que disse nao ALEM DA LINHA 1000 tambem barra, inclusive pela ficha', async () => {
    db.avisos = [avisoBase({ publicos: ['capital', 'curioso'] })];
    db.agendamentos = [
      ...Array.from({ length: 1500 }, (_, i) => cardAgenda(i + 1, fone2(100 + i), 'perdido')),
      cardAgenda(9999, fone2(5000000), 'sem_interesse'),
    ];
    db.eletroposto_parceria = [contato(fone2(5000000), { lado: 'capital' })];
    db.eletroposto_nota1 = [{
      id: 7, nome: 'Joao', telefone: fone2(5000000), cidade: 'Uberlandia',
      ficha: 'Quanto pretende investir: 10 mil', valor_investir: null, status: 'novo', created_at: '2026-09-10T12:00:00Z',
    }];
    const r = await runAvisosTick();
    expect(enviarZapiIO).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it('card da agenda em outro status (ex.: agendado) NAO barra', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato(fone2(1))];
    db.agendamentos = [cardAgenda(1, fone2(1), 'agendado')];
    await runAvisosTick();
    expect(enviarZapiIO).toHaveBeenCalledTimes(1);
  });

  it('ERRO lendo os cards da agenda nao envia nada (erro_lista)', async () => {
    db.avisos = [avisoBase()];
    db.eletroposto_parceria = [contato(fone2(1))];
    falhar.add('agendamentos');
    const r = await runAvisosTick();
    expect(r.motivo).toBe('erro_lista');
    expect(enviarZapiIO).not.toHaveBeenCalled();
  });
});
