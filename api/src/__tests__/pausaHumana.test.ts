import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// A pausa humana é uma trava de SILÊNCIO, e trava de silêncio erra calada: se a
// chave não casa, ninguém vê erro nenhum, o robô simplesmente continua falando
// por cima da Giovanna. Foi assim que o takeover antigo passou meses inoperante
// (casava telefone contra LID e nunca batia).
//
// Por isso o que este arquivo trava são os modos de FALHA, não o caminho feliz:
//   • o 9º dígito indo e voltando entre 12 e 13 dígitos
//   • o LID de 15 dígitos que a Z-API manda quando o humano digita no celular
//   • o robô (fromApi) NÃO podendo se confundir com humano
//   • banco fora do ar não podendo calar a linha inteira
// ─────────────────────────────────────────────────────────────────────────────

interface LinhaPausa {
  chave: string; telefone: string; linha?: string; origem?: string; quem: string | null;
  pausado_em?: string; ultima_fala_humano: string; ultima_fala_lead: string | null;
  liberado_em: string | null; liberado_por?: string | null; motivo_liberacao?: string | null;
  bloqueios?: number;
}

const db: {
  atendimento_pausa: LinhaPausa[];
  wa_lid_telefone: Array<{ lid: string; telefone: string; chave: string }>;
  wa_lid_pendente: Array<Record<string, any>>;
  webhook_debug: Array<{ payload: any; created_at: string }>;
} = { atendimento_pausa: [], wa_lid_telefone: [], wa_lid_pendente: [], webhook_debug: [] };

/** Tabelas que respondem ERRO nesta rodada: é como se prova o fail-open. */
const falhar = new Set<string>();

function fakeFrom(tabela: string) {
  const q: any = {
    _filtros: [] as Array<(r: any) => boolean>,
    select() { return q; },
    eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return q; },
    is(col: string, val: any) { q._filtros.push((r: any) => (r[col] ?? null) === val); return q; },
    lt(col: string, val: any) { q._filtros.push((r: any) => String(r[col] ?? '') < String(val)); return q; },
    gte(col: string, val: any) { q._filtros.push((r: any) => String(r[col]) >= String(val)); return q; },
    in(col: string, vals: any[]) { q._filtros.push((r: any) => vals.includes(r[col])); return q; },
    order() { return q; },
    limit() { return q; },
    _linhas() { return ((db as any)[tabela] as any[]).filter(r => q._filtros.every((f: any) => f(r))); },
    maybeSingle() {
      if (falhar.has(tabela)) return Promise.resolve({ data: null, error: { message: 'caiu' } });
      return Promise.resolve({ data: q._linhas()[0] ?? null, error: null });
    },
    upsert(linhas: any) {
      const arr = Array.isArray(linhas) ? linhas : [linhas];
      for (const l of arr) {
        const chave = l.chave ?? l.lid;
        const campo = l.lid !== undefined ? 'lid' : 'chave';
        const alvo = (db as any)[tabela].find((r: any) => r[campo] === (l.lid ?? chave));
        if (alvo) Object.assign(alvo, l); else (db as any)[tabela].push({ ...l });
      }
      return Promise.resolve({ data: null, error: null });
    },
    update(patch: any) {
      const aplicar = () => {
        q._linhas().forEach((r: any) => Object.assign(r, patch));
        return Promise.resolve({ data: null, error: null });
      };
      const enc: any = {
        eq(col: string, val: any) { q._filtros.push((r: any) => r[col] === val); return enc; },
        is(col: string, val: any) { q._filtros.push((r: any) => (r[col] ?? null) === val); return enc; },
        in(col: string, vals: any[]) { q._filtros.push((r: any) => vals.includes(r[col])); return enc; },
        then(res: any, rej: any) { return aplicar().then(res, rej); },
      };
      return enc;
    },
    then(res: any, rej: any) {
      const p = falhar.has(tabela)
        ? Promise.resolve({ data: null, error: { message: 'caiu' } })
        : Promise.resolve({ data: q._linhas(), error: null });
      return p.then(res, rej);
    },
  };
  return q;
}

vi.mock('../utils/supabase', () => ({
  supabase: { from: (t: string) => fakeFrom(t), rpc: () => Promise.resolve({ data: null, error: null }) },
}));
vi.mock('../utils/logger', () => ({
  logger: { info: () => {}, error: () => {}, warn: () => {} },
}));

import { carregarPausas, podeFalarComLead, pausarContato, liberarPausa } from '../services/agents/whatsapp/pausaHumana';
import { rodarPausaHumanaTick } from '../services/agents/whatsapp/pausaHumanaTick';

const AGORA = Date.now();
const hMin = (h: number) => new Date(AGORA - h * 3600_000).toISOString();

beforeEach(() => {
  db.atendimento_pausa = [];
  db.wa_lid_telefone = [];
  db.wa_lid_pendente = [];
  db.webhook_debug = [];
  falhar.clear();
  delete process.env.PAUSA_HUMANA_OFF;
  process.env.ZAPI_INSTANCE_ID_IO = 'INST_IO';
});

describe('o gate', () => {
  it('cala o robô quando tem humano na conversa', async () => {
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: 'Tarcísio',
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    const pausa = await carregarPausas();
    expect(pausa('5534991360172').pode).toBe(false);
  });

  it('casa o MESMO contato com e sem o 9º dígito', async () => {
    // A Z-API alterna entre as duas formas pro mesmo telefone. Se a chave não
    // for estável, a pessoa é pausada num formato e atropelada no outro — e
    // isso não dá erro nenhum, dá silêncio do lado errado.
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    const pausa = await carregarPausas();
    expect(pausa('5534991360172').pode).toBe(false);  // 13 dígitos
    expect(pausa('553491360172').pode).toBe(false);   // 12 dígitos, mesmo contato
  });

  it('deixa passar o transacional, que é sobre algo que o próprio lead marcou', async () => {
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    const pausa = await carregarPausas();
    expect(pausa('5534991360172', { transacional: true }).pode).toBe(true);
  });

  it('devolve a conversa quando esfria (ninguém fala há 24h)', async () => {
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(30), ultima_fala_lead: null, liberado_em: null,
    });
    const pausa = await carregarPausas();
    expect(pausa('5534991360172').pode).toBe(true);
  });

  it('NÃO esfria se o lead falou agora, mesmo com o humano calado há dias', async () => {
    // Lead escrevendo e ninguém respondendo é caso da sentinela do vácuo, não
    // convite pro robô entrar no meio.
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(72), ultima_fala_lead: hMin(1), liberado_em: null,
    });
    const pausa = await carregarPausas();
    expect(pausa('5534991360172').pode).toBe(false);
  });

  it('volta a falar depois que um humano libera', async () => {
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    expect(await liberarPausa('5534991360172', 'grupo')).toBe(true);
    expect((await carregarPausas())('5534991360172').pode).toBe(true);
  });

  it('banco fora do ar NÃO cala a linha inteira', async () => {
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    falhar.add('atendimento_pausa');
    const pausa = await carregarPausas();
    expect(pausa('5534991360172').pode).toBe(true);
    expect((await podeFalarComLead('5534991360172')).pode).toBe(true);
  });

  it('NUNCA lança, nem com telefone lixo — gate que estoura emudece o robô', async () => {
    // Regressão de verdade: o `chaveContato` estava fora do try e qualquer
    // exceção aqui era engolida pelo catch de quem chama, deixando o LEAD sem
    // resposta. Derrubou 6 testes da recepção; em produção não derrubaria nada,
    // só calaria a Duda em silêncio.
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    const pausa = await carregarPausas();
    for (const lixo of ['', 'abc', '123', null as any, undefined as any, {} as any]) {
      expect(() => pausa(lixo)).not.toThrow();
      expect(pausa(lixo).pode).toBe(true);
      await expect(podeFalarComLead(lixo)).resolves.toMatchObject({ pode: true });
    }
  });

  it('o carimbo do humano só anda pra frente', async () => {
    await pausarContato('5534991360172', hMin(1));
    await pausarContato('5534991360172', hMin(10));   // webhook reentregue, velho
    expect(db.atendimento_pausa[0]!.ultima_fala_humano).toBe(hMin(1));
  });
});

describe('o tick, que é onde mora o LID', () => {
  const ev = (p: Record<string, any>, quando = new Date(AGORA - 60_000).toISOString()) =>
    db.webhook_debug.push({ payload: { instanceId: 'INST_IO', isGroup: false, ...p }, created_at: quando });

  it('resolve o LID pelo telefone que veio junto em OUTRA mensagem', async () => {
    // O robô (ou o lead) traz phone real + chatLid; o humano digitando traz só
    // o LID. Sem essa ponte, nenhum takeover por celular funciona.
    ev({ phone: '5534991360172', chatLid: '253068247589084@lid', fromMe: true, fromApi: true });
    ev({ phone: '253068247589084@lid', chatLid: '253068247589084@lid', fromMe: true, fromApi: false, chatName: 'Tarcísio' });

    const r = await rodarPausaHumanaTick();
    expect(r.pausas).toBe(1);
    expect((await carregarPausas())('5534991360172').pode).toBe(false);
  });

  it('LID sem mapa vira PENDENTE em vez de sumir calado', async () => {
    ev({ phone: '999888777666555@lid', chatLid: '999888777666555@lid', fromMe: true, fromApi: false });
    const r = await rodarPausaHumanaTick();
    expect(r.pausas).toBe(0);
    expect(r.pendentes).toBe(1);
    expect(db.wa_lid_pendente[0]!.lid).toBe('999888777666555');
  });

  it('repesca o pendente assim que o mapa enche', async () => {
    db.wa_lid_pendente.push({
      lid: '999888777666555', primeira_fala: hMin(2), ultima_fala: hMin(2),
      chat_name: null, tentativas: 0, resolvido_em: null,
    });
    db.wa_lid_telefone.push({ lid: '999888777666555', telefone: '5534991360172', chave: '3491360172' });

    const r = await rodarPausaHumanaTick();
    expect(r.resolvidosDaFila).toBe(1);
    // A pausa nasce com a hora em que o humano REALMENTE falou, não com agora:
    // senão a régua de esfriamento contaria do momento errado.
    expect(db.atendimento_pausa[0]!.ultima_fala_humano).toBe(hMin(2));
  });

  it('mensagem do ROBÔ (fromApi) não vira pausa', async () => {
    ev({ phone: '5534991360172', chatLid: '253068247589084@lid', fromMe: true, fromApi: true });
    const r = await rodarPausaHumanaTick();
    expect(r.pausas).toBe(0);
    expect(db.atendimento_pausa).toHaveLength(0);
  });

  it('ignora outra instância Z-API', async () => {
    db.webhook_debug.push({
      payload: { instanceId: 'OUTRA', isGroup: false, phone: '5534991360172', fromMe: true, fromApi: false },
      created_at: new Date(AGORA - 60_000).toISOString(),
    });
    const r = await rodarPausaHumanaTick();
    expect(r.pausas).toBe(0);
  });

  it('PAUSA_HUMANA_OFF=1 solta tudo', async () => {
    process.env.PAUSA_HUMANA_OFF = '1';
    db.atendimento_pausa.push({
      chave: '3491360172', telefone: '5534991360172', quem: null,
      ultima_fala_humano: hMin(1), ultima_fala_lead: null, liberado_em: null,
    });
    expect((await carregarPausas())('5534991360172').pode).toBe(true);
    expect((await rodarPausaHumanaTick()).pausas).toBe(0);
  });
});
