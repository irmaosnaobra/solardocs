import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emBolhas } from '../services/agents/bolhas';
import { textoBoasVindasPix, textoSenhaNaoCriada, textoPrimeiraProposta, mascararEmail, nomeParaSaudar } from '../services/solardoc/ativacaoPosVendaTextos';

// Pós-venda da SolarDoc (04/11/2026, aprovado pelo chefe-antiban): os 4 carimbos novos entram na conta CERTA da linha.
//   boasvindas_pix_sent: e ativ_senha_sent: = linha inteira E agenda (o frio não os soma);
//   ativ_proposta_sent: e depo_sent:        = linha inteira e FRIO (fora de PREFIXOS_AGENDA).
// A sonda grava `<prefixo>sonda` num banco falso e confere que a conta certa sobe e que apagar a devolve.

type Row = { key: string; value?: unknown; updated_at: string };
const db: { rows: Row[] } = { rows: [] };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const filtros: Array<(r: Row) => boolean> = [];
      const q: any = {
        select() { return q; },
        or(expr: string) {
          const ps = expr.split(',').map(p => p.replace(/^key\.like\./, '').replace(/%$/, ''));
          filtros.push(r => ps.some(p => r.key.startsWith(p))); return q;
        },
        like(_c: string, p: string) { const pre = p.replace(/%$/, ''); filtros.push(r => r.key.startsWith(pre)); return q; },
        gte(_c: string, v: string) { filtros.push(r => r.updated_at >= v); return q; },
        eq(_c: string, v: string) { filtros.push(r => r.key === v); return q; },
        maybeSingle() { const r = db.rows.find(x => filtros.every(f => f(x))); return Promise.resolve({ data: r ? { value: r.value } : null, error: null }); },
        limit(n: number) { return Promise.resolve({ data: db.rows.filter(r => filtros.every(f => f(r))).slice(0, n).map(r => ({ key: r.key })), error: null }); },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const envOriginal = { ...process.env };
beforeEach(() => { db.rows = []; vi.resetModules(); delete process.env.LINHA_RECONECTADA_EM; });
afterEach(() => { process.env = { ...envOriginal }; });

const carregar = () => import('../services/agents/whatsapp/lineThrottle');
const grava = (key: string) => db.rows.push({ key, updated_at: new Date(Date.now() - 5 * 60_000).toISOString() });
const apaga = (key: string) => { db.rows = db.rows.filter(r => r.key !== key); };

describe('pós-venda: os prefixos novos estão na lista certa', () => {
  it('boasvindas_pix_sent: e ativ_senha_sent: contam na linha e são de agenda; ativ_proposta_sent: e depo_sent: contam na linha e são FRIOS', async () => {
    const { prefixosDaLinha, PREFIXOS_AGENDA } = await carregar();
    for (const p of ['boasvindas_pix_sent:', 'ativ_senha_sent:', 'ativ_proposta_sent:', 'depo_sent:']) expect(prefixosDaLinha(), p).toContain(p);
    for (const p of ['boasvindas_pix_sent:', 'ativ_senha_sent:']) expect([...PREFIXOS_AGENDA], p).toContain(p);
    for (const p of ['ativ_proposta_sent:', 'depo_sent:']) expect([...PREFIXOS_AGENDA], p).not.toContain(p);
  });

  it('o CHEFE deriva os mesmos baldes', async () => {
    const { prefixosAgendaDerivados, prefixosFriosDerivados } = await import('../services/chefe/classes');
    expect(prefixosAgendaDerivados()).toEqual(expect.arrayContaining(['boasvindas_pix_sent:', 'ativ_senha_sent:']));
    expect(prefixosAgendaDerivados()).not.toContain('ativ_proposta_sent:');
    expect(prefixosAgendaDerivados()).not.toContain('depo_sent:');
    expect(prefixosFriosDerivados({ solardocViaIo: false })).toEqual(expect.arrayContaining(['ativ_proposta_sent:', 'depo_sent:']));
    expect(prefixosFriosDerivados({ solardocViaIo: false })).not.toContain('ativ_senha_sent:');
    expect(prefixosFriosDerivados({ solardocViaIo: false })).not.toContain('boasvindas_pix_sent:');
  });
});

describe('pós-venda: a sonda (gravar `<prefixo>sonda` sobe a conta certa, apagar devolve)', () => {
  it.each(['ativ_proposta_sent:', 'depo_sent:'])('%s sobe o FRIO e a linha inteira; apagar volta', async (prefixo) => {
    const { vagasDoFrioLinha, carimbosDaLinhaNaHora } = await carregar();
    const antes = { frio: (await vagasDoFrioLinha()).hora.usadas, linha: await carimbosDaLinhaNaHora() };
    grava(`${prefixo}sonda`);
    expect((await vagasDoFrioLinha()).hora.usadas).toBe(antes.frio + 1);
    expect(await carimbosDaLinhaNaHora()).toBe(antes.linha + 1);
    apaga(`${prefixo}sonda`);
    expect((await vagasDoFrioLinha()).hora.usadas).toBe(antes.frio);
    expect(await carimbosDaLinhaNaHora()).toBe(antes.linha);
  });

  it.each(['boasvindas_pix_sent:', 'ativ_senha_sent:'])('%s sobe a linha inteira (teto transacional) e NÃO sobe o frio; apagar volta', async (prefixo) => {
    const { vagasDoFrioLinha, carimbosDaLinhaNaHora, dentroDoTetoHorarioLinha } = await carregar();
    const antes = { frio: (await vagasDoFrioLinha()).hora.usadas, linha: await carimbosDaLinhaNaHora() };
    grava(`${prefixo}sonda`);
    expect((await vagasDoFrioLinha()).hora.usadas).toBe(antes.frio);
    expect(await carimbosDaLinhaNaHora()).toBe(antes.linha + 1);
    apaga(`${prefixo}sonda`);
    expect(await carimbosDaLinhaNaHora()).toBe(antes.linha);
    // o teto TRANSACIONAL enxerga a linha inteira: carimbos demais na hora o fecham, e o teto do frio segue aberto
    for (let i = 0; i < 40; i++) grava(`${prefixo}${i}`);
    expect(await dentroDoTetoHorarioLinha({ transacional: true })).toBe(false);
    expect(await dentroDoTetoHorarioLinha()).toBe(true);
  });
});

describe('pós-venda: uma bolha só', () => {
  const textos = [
    textoBoasVindasPix('Maria da Silva', 'joao@gmail.com'),
    textoBoasVindasPix(null, 'joao@gmail.com'),
    textoSenhaNaoCriada('Maria', 'joao@gmail.com'),
    textoSenhaNaoCriada('Cliente', 'joao@gmail.com'),
    textoPrimeiraProposta('Maria'),
    textoPrimeiraProposta(''),
  ];
  it.each(textos.map((t, i) => [i, t] as const))('texto %i sai em 1 bolha com maxBolhas 1 e max 900', (_i, t) => {
    expect(t.length).toBeLessThanOrEqual(900);
    expect(emBolhas(t, { maxBolhas: 1, max: 900 })).toHaveLength(1);
  });

  it('os textos são os aprovados, com e sem nome ("Cliente" conta como sem nome), e o e-mail sai mascarado', () => {
    expect(textoBoasVindasPix('Maria da Silva', 'joao@gmail.com')).toBe('Oi, Maria, aqui é a Giovanna, do suporte da SolarDoc. Seu pagamento foi confirmado e o link para criar sua senha chegou no e-mail j***@gmail.com. Se não achar, é só responder aqui que eu te ajudo.');
    expect(textoBoasVindasPix('Cliente', 'joao@gmail.com')).toBe('Oi, aqui é a Giovanna, do suporte da SolarDoc. Seu pagamento foi confirmado e o link para criar sua senha chegou no e-mail j***@gmail.com. Se não achar, é só responder aqui que eu te ajudo.');
    expect(textoSenhaNaoCriada('Ana', 'ana@x.com')).toBe('Oi, Ana, aqui é a Giovanna, da SolarDoc. Seu pagamento caiu, mas a senha ainda não foi criada. O link está no e-mail a***@x.com, e se você responder aqui eu reenvio.');
    expect(textoSenhaNaoCriada(null, 'ana@x.com').startsWith('Oi, aqui é a Giovanna, da SolarDoc. Seu pagamento caiu')).toBe(true);
    expect(textoPrimeiraProposta('Ana')).toBe('Oi, Ana, aqui é a Giovanna, do suporte da SolarDoc. Se quiser, eu te guio na sua 1ª proposta aqui pelo WhatsApp. Ela sai em poucos minutos, com a logo e a cor da sua empresa, pronta para mandar no WhatsApp. O suporte está junto com você, é só chamar quando for fazer.');
    expect(textoPrimeiraProposta(undefined).startsWith('Oi, aqui é a Giovanna, do suporte da SolarDoc. Se quiser')).toBe(true);
    expect(mascararEmail('joao@gmail.com')).toBe('j***@gmail.com');
    expect(nomeParaSaudar('cliente')).toBeNull();
    expect(nomeParaSaudar('  JOSÉ  carlos')).toBe('José');
  });
});
