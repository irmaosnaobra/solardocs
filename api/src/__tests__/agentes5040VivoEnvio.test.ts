import { describe, it, expect, vi, beforeEach } from 'vitest';

// B1c-2, o envio da resposta ao vivo (vivoEnvio.ts). Banco, WhatsApp e gates simulados na memória. Prova: cada checagem
// barra e NADA é enviado nem carimbado; a ordem das checagens; os tetos nos limites (19/20, 59/60, 119/120, 449/450);
// o espaçamento de 10 s medido no banco; a reserva duplicada; a peça só sai se a bolha saiu; os 2 erros de linha
// gravam a pausa e o envio ok zera; o carimbo de envio que falhou fica; nada de telefone no que se grava.

type Linha = { value: any; updated_at: string };

const h = vi.hoisted(() => ({
  estado: new Map<string, Linha>(),
  wa: new Map<number, string | null>(),
  enviados: [] as Array<{ tel: string; partes: string[]; inst: string; opts: any }>,
  falhas: [] as Array<Error | null>, // uma entrada por chamada ao sendHuman; vazio = ok
  cooldown: false,
  pode: { pode: true, motivo: 'sem-pausa' } as any,
  bloqueado: false,
  /** Os motivos de supressão do telefone (whatsapp_suppression); [] = sem registro. */
  motivos: [] as string[],
  motivosLanca: false,
  mudosLidos: 0,
  temRobo: false,
  veredito: { nivel: 'nenhum' } as any,
  marcou: [] as string[],
  podeChamadas: 0,
  falhaLeitura: null as null | { tabela: string; code: string },
}));

function consulta(tabela: string) {
  let op = 'select'; let payload: any = null; let unico = false; let max: number | null = null;
  let faixa: [number, number] | null = null; let ordem: { col: string; asc: boolean } | null = null;
  const filtros: Array<(k: string, r: Linha) => boolean> = [];
  const q: any = {
    select: () => q,
    insert: (p: any) => { op = 'insert'; payload = p; return q; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return q; },
    update: (p: any) => { op = 'update'; payload = p; return q; },
    eq: (c: string, v: any) => { filtros.push((k, r) => (c === 'key' ? k === v : c === 'id' ? k === String(v) : (r as any)[c] === v)); return q; },
    like: (c: string, p: string) => { const pre = p.replace(/%$/, ''); filtros.push(k => k.startsWith(pre)); return q; },
    or: (expr: string) => {
      const pres = expr.split(',').map(s => s.replace(/^key\.like\./, '').replace(/%$/, ''));
      filtros.push(k => pres.some(p => k.startsWith(p))); return q;
    },
    gte: (_c: string, v: string) => { filtros.push((_k, r) => Date.parse(r.updated_at) >= Date.parse(v)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
    range: (de: number, ate: number) => { faixa = [de, ate]; return q; },
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { unico = true; return q; },
    then: (ok: (v: any) => any, ko?: (e: any) => any) => {
      let res: any;
      if (h.falhaLeitura && h.falhaLeitura.tabela === tabela && op === 'select') {
        res = { data: null, error: { code: h.falhaLeitura.code } };
      } else if (tabela === 'wa_mensagens') {
        const casa = [...h.wa.entries()].filter(([id]) => filtros.every(f => f(String(id), { value: null, updated_at: '' })));
        const rows = casa.map(([id, texto]) => ({ id, texto }));
        res = { data: unico ? (rows[0] ?? null) : rows, error: null };
      } else if (op === 'insert') {
        if (h.estado.has(payload.key)) res = { data: null, error: { code: '23505' } };
        else { h.estado.set(payload.key, { value: payload.value, updated_at: payload.updated_at }); res = { data: null, error: null }; }
      } else if (op === 'upsert') {
        h.estado.set(payload.key, { value: payload.value, updated_at: payload.updated_at });
        res = { data: null, error: null };
      } else if (op === 'update') {
        for (const [k, r] of [...h.estado.entries()].filter(([k, r]) => filtros.every(f => f(k, r)))) {
          h.estado.set(k, { value: payload.value ?? r.value, updated_at: payload.updated_at ?? r.updated_at });
        }
        res = { data: null, error: null };
      } else {
        let casa = [...h.estado.entries()].filter(([k, r]) => filtros.every(f => f(k, r)));
        if (ordem) {
          const o = ordem;
          casa.sort((a, b) => {
            const va = o.col === 'key' ? a[0] : a[1].updated_at; const vb = o.col === 'key' ? b[0] : b[1].updated_at;
            return (va < vb ? -1 : va > vb ? 1 : 0) * (o.asc ? 1 : -1);
          });
        }
        if (faixa) casa = casa.slice(faixa[0], faixa[1] + 1);
        if (max !== null) casa = casa.slice(0, max);
        const rows = casa.map(([k, r]) => ({ key: k, value: r.value, updated_at: r.updated_at }));
        res = { data: unico ? (rows[0] ?? null) : rows, error: null };
      }
      return Promise.resolve(res).then(ok, ko);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  solardocViaIo: () => false,
  linhaEmCooldown: () => h.cooldown,
  sendHuman: vi.fn(async (tel: string, partes: string[], inst: string, opts: any) => {
    h.enviados.push({ tel, partes, inst, opts });
    const f = h.falhas.shift();
    if (f) throw f;
  }),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', () => ({
  podeFalarComLead: vi.fn(async () => { h.podeChamadas++; return h.pode; }),
}));
vi.mock('../services/agents/whatsapp/silenciar', async () => {
  const real = await vi.importActual<typeof import('../services/agents/whatsapp/silenciar')>('../services/agents/whatsapp/silenciar');
  return {
    ...real,
    estaBloqueado: vi.fn(async () => h.bloqueado),
    motivosDaSupressao: vi.fn(async () => { if (h.motivosLanca) throw new Error('leitura estrita falhou'); return [...h.motivos]; }),
    // Os mudos (wa_mudos) são regra de toque proativo: a resposta nem os lê. O contador prova.
    carregarMudos: vi.fn(async () => { h.mudosLidos++; return () => true; }),
  };
});
vi.mock('../services/agents/whatsapp/roboDoOutroLado', () => ({
  temRoboAtendendo: vi.fn(async () => h.temRobo),
  pareceRoboDeles: vi.fn(() => h.veredito),
  marcarRoboDoOutroLado: vi.fn(async (_tel: string, sinal: string) => { h.marcou.push(sinal); }),
}));

import { enviarResposta, codigoDoErroDeEnvio, TEMPOS, CHAVE_LINHA_PAUSA, CHAVE_LINHA_ERROS, type PedidoEnvio } from '../services/agentes5040/vivoEnvio';
import { prefixosDaLinha, PREFIXOS_AGENDA } from '../services/agents/whatsapp/lineThrottle';
import { sendHuman } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';

const AGORA = new Date('2026-10-21T15:00:00.000Z');
const TEL = '5534991360223';
const ant = (ms: number): string => new Date(AGORA.getTime() - ms).toISOString();
const MIN = 60_000; const HORA = 3_600_000;

const pedido = (extra: Partial<PedidoEnvio> = {}): PedidoEnvio => ({
  dona: 'duda', telefone: TEL, waIdAlvo: 1001, momentoFalaLead: ant(60_000), bolha: 'Oi, tudo bem? Me conta a média da sua conta de luz.', ...extra,
});

const semear = (prefixo: string, n: number, quandoMs: number, base = 0): void => {
  for (let i = 0; i < n; i++) h.estado.set(`${prefixo}${base + i}:1`, { value: { estado: 'enviado' }, updated_at: ant(quandoMs) });
};
const carimbosDasAgentes = (): string[] => [...h.estado.keys()].filter(k => k.startsWith('ag5040_sent:'));
const chamadas = (): number => (sendHuman as any).mock.calls.length;

beforeEach(() => {
  h.estado.clear(); h.wa.clear(); h.enviados.length = 0; h.falhas.length = 0; h.marcou.length = 0;
  h.cooldown = false; h.pode = { pode: true, motivo: 'sem-pausa' }; h.bloqueado = false; h.motivos = []; h.mudosLidos = 0;
  h.motivosLanca = false; h.temRobo = false; h.veredito = { nivel: 'nenhum' }; h.podeChamadas = 0; h.falhaLeitura = null;
  for (const id of [1, 2, 3, 1001, 1002]) h.wa.set(id, 'oi, quero saber mais');
  TEMPOS.entreBolhaEPecaMs = () => 0;
  (sendHuman as any).mockClear();
});

describe('vivoEnvio: o caminho feliz', () => {
  it('uma bolha pela linha io, com maxBolhas 1 e max 160, e o carimbo :1 gravado', async () => {
    const r = await enviarResposta(pedido(), AGORA);
    expect(r).toEqual({ ok: true, enviadas: 1, carimbos: ['ag5040_sent:1001:1'] });
    expect(chamadas()).toBe(1);
    expect(h.enviados[0]).toMatchObject({ tel: TEL, inst: 'io', opts: { maxBolhas: 1, max: 160 } });
    expect(h.enviados[0]!.partes).toEqual(['Oi, tudo bem? Me conta a média da sua conta de luz.']);
    expect(h.estado.get('ag5040_sent:1001:1')!.updated_at).toBe(AGORA.toISOString());
    expect(h.estado.get('ag5040_sent:1001:1')!.value.estado).toBe('enviado');
  });

  it('nada do que se grava leva o telefone (nem a chave, nem o valor)', async () => {
    await enviarResposta(pedido({ peca: { tipo: 'link', texto: 'https://solardoc.app/pix' } }), AGORA);
    h.falhas.push(new Error('z-api fora'));
    await enviarResposta(pedido({ waIdAlvo: 1002 }), new Date(AGORA.getTime() + 30_000));
    const tudo = JSON.stringify([...h.estado.entries()]);
    expect(tudo).not.toContain('34991360223');
    expect(tudo).not.toContain(TEL);
  });

  it('o prefixo ag5040_sent: não entra na lista da linha do HEAD (fica fora de BOT_SENT_PREFIXES)', () => {
    expect(prefixosDaLinha().some(p => p.startsWith('ag5040'))).toBe(false);
    for (const a of PREFIXOS_AGENDA) expect(prefixosDaLinha()).toContain(a);
  });
});

describe('vivoEnvio: cada checagem barra e nada sai nem é carimbado', () => {
  const semRastro = (): void => {
    expect(chamadas()).toBe(0);
    expect(carimbosDasAgentes()).toEqual([]);
  };

  it.each([
    ['vazia', ''],
    ['mais de 160', 'a'.repeat(161)],
    ['travessão', 'Oi — tudo bem?'],
    ['meio travessão', 'Oi – tudo bem?'],
    ['duas bolhas', 'Oi||tudo bem?'],
  ])('bolha_invalida: %s', async (_n, bolha) => {
    const r = await enviarResposta(pedido({ bolha }), AGORA);
    expect(r).toMatchObject({ ok: false, motivo: 'bolha_invalida' });
    semRastro();
    expect(h.podeChamadas).toBe(0);
  });

  it('bolha_invalida: 160 exatos passam', async () => {
    const r = await enviarResposta(pedido({ bolha: 'a'.repeat(160) }), AGORA);
    expect(r.ok).toBe(true);
    expect(chamadas()).toBe(1);
  });

  it('bolha_invalida: peça vazia, com travessão ou com separador', async () => {
    for (const texto of ['', 'link — aqui', 'a||b']) {
      expect(await enviarResposta(pedido({ peca: { tipo: 'link', texto } }), AGORA)).toMatchObject({ ok: false, motivo: 'bolha_invalida' });
    }
    semRastro();
  });

  it('prazo: fala de 16 min atrás barra; 15 min exatos passam', async () => {
    expect(await enviarResposta(pedido({ momentoFalaLead: ant(16 * MIN) }), AGORA)).toMatchObject({ ok: false, motivo: 'prazo' });
    semRastro();
    expect((await enviarResposta(pedido({ momentoFalaLead: ant(15 * MIN) }), AGORA)).ok).toBe(true);
    expect(chamadas()).toBe(1);
  });

  it('prazo: momento ilegível também barra', async () => {
    expect(await enviarResposta(pedido({ momentoFalaLead: 'ontem' }), AGORA)).toMatchObject({ ok: false, motivo: 'prazo' });
    semRastro();
  });

  it('linha_pausada: a pausa gravada vale até o fim e some depois', async () => {
    h.estado.set(CHAVE_LINHA_PAUSA, { value: { ate: new Date(AGORA.getTime() + 5 * MIN).toISOString() }, updated_at: ant(MIN) });
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'linha_pausada' });
    semRastro();
    h.estado.set(CHAVE_LINHA_PAUSA, { value: { ate: ant(1000) }, updated_at: ant(20 * MIN) });
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
  });

  it('linha_pausada: cooldown da linha na memória barra ANTES da reserva (o carimbo não é queimado)', async () => {
    h.cooldown = true;
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'linha_pausada', detalhe: 'cooldown' });
    semRastro();
  });

  it('linha_pausada: leitura da pausa que falha barra', async () => {
    h.falhaLeitura = { tabela: 'system_state', code: 'XX000' };
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'linha_pausada', detalhe: 'leitura_falhou' });
    expect(chamadas()).toBe(0);
  });

  it('pausa_humana: humano na conversa barra', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' };
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'pausa_humana' });
    semRastro();
    expect(h.podeChamadas).toBe(1);
  });

  it('pausa_humana: telefone sem chave (LID cru) barra sem perguntar ao gate, que falharia aberto', async () => {
    expect(await enviarResposta(pedido({ telefone: '253068247589084@lid' }), AGORA)).toMatchObject({ ok: false, motivo: 'pausa_humana', detalhe: 'telefone_sem_chave' });
    semRastro();
    expect(h.podeChamadas).toBe(0);
  });

  it('bloqueado: fora do padrão barra', async () => {
    h.bloqueado = true;
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'bloqueado' });
    semRastro();
  });

  it('mudo: opt_out e denuncia barram; erro de leitura estrita barra', async () => {
    h.motivos = ['opt_out'];
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'mudo', detalhe: 'opt_out' });
    h.motivos = ['denuncia'];
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'mudo', detalhe: 'denuncia' });
    h.motivos = []; h.motivosLanca = true;
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'mudo', detalhe: 'leitura_falhou' });
    semRastro();
  });

  it('fora_do_padrao na supressão barra como bloqueado (mesmo se o estaBloqueado falhasse aberto)', async () => {
    h.motivos = ['fora_do_padrao'];
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'bloqueado' });
    semRastro();
  });

  it("pediu_humano: não fala e devolve o motivo próprio (a rodada passa ao humano, sem bolha)", async () => {
    h.motivos = ['pediu_humano'];
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'pediu_humano' });
    semRastro();
  });

  it("opt_out vence pediu_humano quando o telefone tem os dois registros", async () => {
    h.motivos = ['pediu_humano', 'opt_out'];
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'mudo' });
  });

  it("'nunca_respondeu' e os mudos (wa_mudos) NÃO barram resposta a quem acabou de escrever; carregarMudos nem é lido", async () => {
    h.motivos = ['nunca_respondeu'];
    const r = await enviarResposta(pedido(), AGORA);
    expect(r.ok).toBe(true);
    expect(chamadas()).toBe(1);
    expect(h.mudosLidos).toBe(0);
  });

  it('robo_do_outro_lado: silêncio de 12 h barra', async () => {
    h.temRobo = true;
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'robo_do_outro_lado' });
    semRastro();
  });

  it('robo_do_outro_lado: certeza na fala marca o número; suspeita só não responde; fala que não se acha barra', async () => {
    h.veredito = { nivel: 'certeza', sinal: 'bot de atendimento' };
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'robo_do_outro_lado' });
    expect(h.marcou).toEqual(['bot de atendimento']);
    h.veredito = { nivel: 'suspeita', sinal: 'menu numerado' };
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'robo_do_outro_lado' });
    expect(h.marcou).toEqual(['bot de atendimento']);
    h.veredito = { nivel: 'nenhum' };
    expect(await enviarResposta(pedido({ waIdAlvo: 999 }), AGORA)).toMatchObject({ ok: false, motivo: 'robo_do_outro_lado', detalhe: 'fala_nao_achada' });
    semRastro();
  });
});

describe('vivoEnvio: rodada seca não cala número real', () => {
  it('certeza de robô do outro lado no dry recusa mas NÃO marca o número; fora do dry marca', async () => {
    h.veredito = { nivel: 'certeza', sinal: 'bot de atendimento' };
    expect(await enviarResposta(pedido({ dry: true }), AGORA)).toMatchObject({ ok: false, motivo: 'robo_do_outro_lado' });
    expect(h.marcou).toEqual([]);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'robo_do_outro_lado' });
    expect(h.marcou).toEqual(['bot de atendimento']);
  });
});

describe('vivoEnvio: erro do Z-API não repete o telefone em lugar nenhum', () => {
  const ERRO = (): Error => new Error(`[zapi:io] HTTP 500 — {"error":"falha","phone":"${TEL}","message":"Phone ${TEL} not found"}`);
  const logs = (): string => JSON.stringify((logger.error as any).mock.calls);

  it('bolha: o carimbo, o detalhe da recusa e o log levam só o código http_500', async () => {
    (logger.error as any).mockClear();
    h.falhas.push(ERRO());
    const r = await enviarResposta(pedido(), AGORA);
    expect(r).toEqual({ ok: false, motivo: 'erro_linha', detalhe: 'http_500' });
    expect(h.estado.get('ag5040_sent:1001:1')!.value).toEqual({ estado: 'falhou', erro: 'http_500' });
    const tudo = JSON.stringify([...h.estado.entries()]) + JSON.stringify(r) + logs();
    expect(tudo).not.toContain('34991360223');
  });

  it('peça: o carimbo :2 leva só o código e o log também', async () => {
    (logger.error as any).mockClear();
    h.falhas.push(null as any, ERRO());
    const r = await enviarResposta(pedido({ peca: { tipo: 'link', texto: 'https://solardoc.app/pix' } }), AGORA);
    expect(r).toMatchObject({ ok: true, enviadas: 1 });
    expect(h.estado.get('ag5040_sent:1001:2')!.value).toEqual({ estado: 'falhou', erro: 'http_500' });
    expect(JSON.stringify([...h.estado.entries()]) + logs()).not.toContain('34991360223');
  });

  it.each([
    ['[zapi:io] em cooldown (instância indisponível há <60s) — pulando envio', 'cooldown'],
    ['[zapi:io] credenciais Z-API ausentes', 'credenciais'],
    ['request timeout 5534991360223', 'timeout'],
    ['fetch failed 5534991360223', 'falha'],
  ])('codigoDoErroDeEnvio: %s', (msg, esperado) => {
    expect(codigoDoErroDeEnvio(new Error(msg))).toBe(esperado);
  });
});

describe('vivoEnvio: os tetos', () => {
  it('teto das agentes por hora: 19 carimbos na última hora passam, 20 barram', async () => {
    semear('ag5040_sent:', 19, 30 * MIN);
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
    expect(chamadas()).toBe(1);
    h.estado.clear(); (sendHuman as any).mockClear();
    semear('ag5040_sent:', 20, 30 * MIN);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_agentes' });
    expect(chamadas()).toBe(0);
    expect(carimbosDasAgentes()).toHaveLength(20);
  });

  it('teto das agentes por 24 h: 119 passam, 120 barram (carimbos fora da última hora)', async () => {
    semear('ag5040_sent:', 119, 5 * HORA);
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
    h.estado.clear(); (sendHuman as any).mockClear();
    semear('ag5040_sent:', 120, 5 * HORA);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_agentes', detalhe: 'dia:120' });
    expect(chamadas()).toBe(0);
  });

  it('carimbo de mais de 24 h não conta', async () => {
    semear('ag5040_sent:', 200, 25 * HORA);
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
  });

  it('a contagem é paginada: 1100 carimbos na janela barram (o PostgREST cortaria em 1000)', async () => {
    semear('ag5040_sent:', 1100, 5 * HORA);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_agentes' });
  });

  it('teto da linha por hora: 59 passam, 60 barram, somando frio e agenda', async () => {
    semear('limpapro_recovery:', 30, 20 * MIN);
    semear('ep_agenda_sent:', 29, 20 * MIN);
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
    h.estado.clear(); (sendHuman as any).mockClear();
    semear('limpapro_recovery:', 30, 20 * MIN);
    semear('ep_agenda_sent:', 30, 20 * MIN);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_linha', detalhe: 'hora:60' });
    expect(chamadas()).toBe(0);
    expect(carimbosDasAgentes()).toEqual([]);
  });

  it('a ficha ao consultor (ficha_lead:) sai pela mesma linha e pesa no teto de emergência', async () => {
    semear('limpapro_recovery:', 30, 20 * MIN);
    semear('ficha_lead:', 29, 20 * MIN);
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
    h.estado.clear(); (sendHuman as any).mockClear();
    semear('limpapro_recovery:', 30, 20 * MIN);
    semear('ficha_lead:', 30, 20 * MIN);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_linha', detalhe: 'hora:60' });
    expect(chamadas()).toBe(0);
  });

  it('o carimbo das agentes também pesa no teto da linha', async () => {
    semear('limpapro_recovery:', 41, 20 * MIN);
    semear('ag5040_sent:', 19, 20 * MIN); // 60 no total, e as agentes ainda estão em 19
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_linha' });
  });

  it('teto da linha por 24 h: 449 passam, 450 barram', async () => {
    semear('gerador_followup:', 449, 5 * HORA);
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
    h.estado.clear(); (sendHuman as any).mockClear();
    semear('gerador_followup:', 450, 5 * HORA);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'teto_linha', detalhe: 'dia:450' });
    expect(chamadas()).toBe(0);
  });

  it('leitura de contagem que falha barra', async () => {
    h.falhaLeitura = { tabela: 'system_state', code: 'XX000' };
    const r = await enviarResposta(pedido(), AGORA);
    expect(r.ok).toBe(false);
    expect(chamadas()).toBe(0);
  });
});

describe('vivoEnvio: espaçamento de 10 s contra o último carimbo no banco', () => {
  it('último a 9 s barra; a 11 s passa', async () => {
    h.estado.set('ag5040_sent:555:1', { value: {}, updated_at: ant(9_000) });
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'espacamento' });
    expect(chamadas()).toBe(0);
    expect(carimbosDasAgentes()).toEqual(['ag5040_sent:555:1']);
    h.estado.set('ag5040_sent:555:1', { value: {}, updated_at: ant(11_000) });
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
    expect(chamadas()).toBe(1);
  });

  it('só o carimbo das agentes conta: carimbo de outro robô a 1 s não barra aqui', async () => {
    h.estado.set('limpapro_recovery:x', { value: {}, updated_at: ant(1_000) });
    expect((await enviarResposta(pedido(), AGORA)).ok).toBe(true);
  });

  it('duas respostas seguidas na mesma hora: a 2ª só passa 10 s depois', async () => {
    expect((await enviarResposta(pedido({ waIdAlvo: 1 }), AGORA)).ok).toBe(true);
    expect(await enviarResposta(pedido({ waIdAlvo: 2 }), new Date(AGORA.getTime() + 5_000))).toMatchObject({ ok: false, motivo: 'espacamento' });
    expect((await enviarResposta(pedido({ waIdAlvo: 2 }), new Date(AGORA.getTime() + 10_000))).ok).toBe(true);
    expect(chamadas()).toBe(2);
  });
});

describe('vivoEnvio: a ordem das checagens', () => {
  it('dry encerra depois de todas as checagens e não reserva nem envia', async () => {
    const r = await enviarResposta(pedido({ dry: true }), AGORA);
    expect(r).toEqual({ ok: false, motivo: 'dry' });
    expect(chamadas()).toBe(0);
    expect(carimbosDasAgentes()).toEqual([]);
  });

  it('dry com uma checagem que barra devolve o motivo da checagem, não dry', async () => {
    h.bloqueado = true;
    expect(await enviarResposta(pedido({ dry: true }), AGORA)).toMatchObject({ ok: false, motivo: 'bloqueado' });
  });

  it('a bolha inválida vence o prazo; o prazo vence todo o resto', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' }; h.bloqueado = true; h.temRobo = true; h.motivos = ['opt_out']; h.cooldown = true;
    h.estado.set(CHAVE_LINHA_PAUSA, { value: { ate: new Date(AGORA.getTime() + HORA).toISOString() }, updated_at: ant(MIN) });
    semear('ag5040_sent:', 130, 20 * MIN);
    expect(await enviarResposta(pedido({ momentoFalaLead: ant(20 * MIN), bolha: '' }), AGORA)).toMatchObject({ motivo: 'bolha_invalida' });
    expect(await enviarResposta(pedido({ momentoFalaLead: ant(20 * MIN) }), AGORA)).toMatchObject({ motivo: 'prazo' });
    expect(h.podeChamadas).toBe(0);
  });

  it('linha pausada vence a pausa humana; pausa humana vence bloqueado; bloqueado vence mudo; mudo vence robô; robô vence os tetos', async () => {
    h.pode = { pode: false, motivo: 'humano-ativo' }; h.bloqueado = true; h.motivos = ['opt_out']; h.temRobo = true;
    semear('ag5040_sent:', 130, 20 * MIN);
    h.estado.set(CHAVE_LINHA_PAUSA, { value: { ate: new Date(AGORA.getTime() + HORA).toISOString() }, updated_at: ant(MIN) });
    expect((await enviarResposta(pedido(), AGORA)).ok === false && (await enviarResposta(pedido(), AGORA))).toMatchObject({ motivo: 'linha_pausada' });
    h.estado.delete(CHAVE_LINHA_PAUSA);
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'pausa_humana' });
    h.pode = { pode: true, motivo: 'sem-pausa' };
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'bloqueado' });
    h.bloqueado = false;
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'mudo' });
    h.motivos = [];
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'robo_do_outro_lado' });
    h.temRobo = false;
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'teto_agentes' });
    expect(chamadas()).toBe(0);
  });

  it('teto das agentes vence o da linha; os dois vencem o espaçamento', async () => {
    semear('ag5040_sent:', 20, 30 * MIN);
    semear('limpapro_recovery:', 60, 30 * MIN);
    h.estado.set('ag5040_sent:777:1', { value: {}, updated_at: ant(1_000) });
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'teto_agentes' });
    for (const k of carimbosDasAgentes()) h.estado.delete(k);
    h.estado.set('ag5040_sent:777:1', { value: {}, updated_at: ant(1_000) });
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ motivo: 'teto_linha' });
    expect(chamadas()).toBe(0);
  });
});

describe('vivoEnvio: a reserva', () => {
  it('fala já reservada = ja_respondido, sem enviar', async () => {
    h.estado.set('ag5040_sent:1001:1', { value: { estado: 'enviado' }, updated_at: ant(HORA) });
    expect(await enviarResposta(pedido(), AGORA)).toEqual({ ok: false, motivo: 'ja_respondido' });
    expect(chamadas()).toBe(0);
  });

  it('duas chamadas ao mesmo tempo para a mesma fala: uma envia, a outra é ja_respondido', async () => {
    const [a, b] = await Promise.all([enviarResposta(pedido(), AGORA), enviarResposta(pedido(), AGORA)]);
    expect([a, b].filter(r => r.ok)).toHaveLength(1);
    expect([a, b].filter(r => !r.ok && r.motivo === 'ja_respondido')).toHaveLength(1);
    expect(chamadas()).toBe(1);
  });
});

describe('vivoEnvio: a peça (link ou Pix)', () => {
  it('a peça sai em 2ª chamada, depois da bolha, com o carimbo :2', async () => {
    const codigoPix = '00020126580014br.gov.bcb.pix0136' + 'x'.repeat(200);
    const r = await enviarResposta(pedido({ peca: { tipo: 'pix', texto: codigoPix } }), AGORA);
    expect(r).toEqual({ ok: true, enviadas: 2, carimbos: ['ag5040_sent:1001:1', 'ag5040_sent:1001:2'] });
    expect(chamadas()).toBe(2);
    expect(h.enviados[1]!.partes).toEqual([codigoPix]);
    expect(h.enviados[1]!.inst).toBe('io');
    expect(h.enviados[1]!.opts.maxBolhas).toBe(1);
    expect(carimbosDasAgentes().sort()).toEqual(['ag5040_sent:1001:1', 'ag5040_sent:1001:2']);
  });

  it('bolha que falha: a peça NÃO sai e não ganha carimbo; o :1 fica', async () => {
    h.falhas.push(new Error('z-api 500'));
    const r = await enviarResposta(pedido({ peca: { tipo: 'link', texto: 'https://solardoc.app/pix' } }), AGORA);
    expect(r).toMatchObject({ ok: false, motivo: 'erro_linha' });
    expect(chamadas()).toBe(1);
    expect(carimbosDasAgentes()).toEqual(['ag5040_sent:1001:1']);
  });

  it('peça que falha com a bolha já fora: resultado ok com 1 enviada, o :2 fica e o erro conta', async () => {
    h.falhas.push(null as any, new Error('z-api 500'));
    const r = await enviarResposta(pedido({ peca: { tipo: 'link', texto: 'https://solardoc.app/pix' } }), AGORA);
    expect(r).toEqual({ ok: true, enviadas: 1, carimbos: ['ag5040_sent:1001:1', 'ag5040_sent:1001:2'] });
    expect(chamadas()).toBe(2);
    expect(h.estado.get(CHAVE_LINHA_ERROS)!.value.n).toBe(1);
  });
});

describe('vivoEnvio: erro de linha', () => {
  it('o carimbo do envio que falhou FICA e a mesma fala não é reenviada', async () => {
    h.falhas.push(new Error('z-api 500'));
    expect(await enviarResposta(pedido(), AGORA)).toMatchObject({ ok: false, motivo: 'erro_linha' });
    expect(carimbosDasAgentes()).toEqual(['ag5040_sent:1001:1']);
    expect(h.estado.get('ag5040_sent:1001:1')!.value.estado).toBe('falhou');
    expect(await enviarResposta(pedido(), new Date(AGORA.getTime() + 30_000))).toEqual({ ok: false, motivo: 'ja_respondido' });
    expect(chamadas()).toBe(1);
  });

  it('1 erro só conta; 2 seguidos gravam a pausa de 15 min; depois a linha fica pausada', async () => {
    h.falhas.push(new Error('z-api 500'), new Error('z-api 500'));
    await enviarResposta(pedido({ waIdAlvo: 1 }), AGORA);
    expect(h.estado.get(CHAVE_LINHA_ERROS)!.value.n).toBe(1);
    expect(h.estado.has(CHAVE_LINHA_PAUSA)).toBe(false);
    const t2 = new Date(AGORA.getTime() + 20_000);
    await enviarResposta(pedido({ waIdAlvo: 2, momentoFalaLead: new Date(t2.getTime() - 5_000).toISOString() }), t2);
    expect(h.estado.get(CHAVE_LINHA_ERROS)!.value.n).toBe(2);
    expect(h.estado.get(CHAVE_LINHA_PAUSA)!.value.ate).toBe(new Date(t2.getTime() + 15 * MIN).toISOString());
    const t3 = new Date(t2.getTime() + 60_000);
    expect(await enviarResposta(pedido({ waIdAlvo: 3, momentoFalaLead: new Date(t3.getTime() - 5_000).toISOString() }), t3))
      .toMatchObject({ ok: false, motivo: 'linha_pausada' });
    expect(chamadas()).toBe(2);
  });

  it('um envio ok entre dois erros zera o contador: não pausa', async () => {
    h.falhas.push(new Error('z-api 500'));
    await enviarResposta(pedido({ waIdAlvo: 1 }), AGORA);
    expect(h.estado.get(CHAVE_LINHA_ERROS)!.value.n).toBe(1);
    const t2 = new Date(AGORA.getTime() + 20_000);
    expect((await enviarResposta(pedido({ waIdAlvo: 2, momentoFalaLead: new Date(t2.getTime() - 5_000).toISOString() }), t2)).ok).toBe(true);
    expect(h.estado.get(CHAVE_LINHA_ERROS)!.value.n).toBe(0);
    h.falhas.push(new Error('z-api 500'));
    const t3 = new Date(t2.getTime() + 20_000);
    await enviarResposta(pedido({ waIdAlvo: 3, momentoFalaLead: new Date(t3.getTime() - 5_000).toISOString() }), t3);
    expect(h.estado.get(CHAVE_LINHA_ERROS)!.value.n).toBe(1);
    expect(h.estado.has(CHAVE_LINHA_PAUSA)).toBe(false);
  });

  it('a primeira falha depois da pausa pausa de novo (o contador não foi zerado pela pausa)', async () => {
    h.estado.set(CHAVE_LINHA_ERROS, { value: { n: 2 }, updated_at: ant(HORA) });
    h.estado.set(CHAVE_LINHA_PAUSA, { value: { ate: ant(MIN) }, updated_at: ant(20 * MIN) });
    h.falhas.push(new Error('z-api 500'));
    await enviarResposta(pedido(), AGORA);
    expect(h.estado.get(CHAVE_LINHA_PAUSA)!.value.ate).toBe(new Date(AGORA.getTime() + 15 * MIN).toISOString());
  });
});
