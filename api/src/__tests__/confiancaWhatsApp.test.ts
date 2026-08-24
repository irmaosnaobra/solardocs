import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// BRAÇO DE WHATSAPP DA CADÊNCIA DE CONFIANÇA.
//
// O teste que importa mais aqui é o do CARIMBO. `sendImage` não passa pelo
// `sendHuman`, então não alimenta régua nenhuma sozinho: um envio sem
// `marcarEnvioCarla` seria invisível pro teto/hora, pro teto/dia e pra margem de
// 5 min — e ainda deixaria o PRÓXIMO agente disparar colado, que foi como saíram
// 4 mensagens em 37 segundos em 06/ago.
//
// Depois dele, as duas travas que mantêm a cadência "tranquila": só quem paga,
// e nunca no mesmo dia de um e-mail da mesma cadência.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>;
const db: Record<string, Row[]> = { users: [] };

function query(table: string) {
  const filtros: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let modo: 'select' | 'update' = 'select';

  const linhas = () => db[table].filter((r) => filtros.every((f) => f(r)));

  function executa(): { data: any; error: any } {
    if (modo === 'update') {
      const alvos = linhas();
      alvos.forEach((r) => Object.assign(r, patch));
      return { data: alvos, error: null };
    }
    return { data: linhas().map((r) => ({ ...r })), error: null };
  }

  const q: any = {
    select: () => q,
    update: (p: Row) => { modo = 'update'; patch = p; return q; },
    eq: (c: string, v: any) => { filtros.push((r) => String(r[c]) === String(v)); return q; },
    neq: (c: string, v: any) => { filtros.push((r) => String(r[c]) !== String(v)); return q; },
    lt: (c: string, v: any) => { filtros.push((r) => Number(r[c] ?? 0) < Number(v)); return q; },
    not: (c: string, _op: string, _v: any) => { filtros.push((r) => r[c] != null); return q; },
    then: (resolve: (v: any) => void) => resolve(executa()),
  };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => query(t) } }));

const imagens: any[] = [];
vi.mock('../services/agents/zapiClient', () => ({
  sendImage: vi.fn(async (phone: string, image: string, caption: string) => {
    imagens.push({ phone, image, caption });
  }),
}));

const carimbos: string[] = [];
let tetoLivre = 99;
let janelaAberta = true;
vi.mock('../services/agents/whatsapp/carlaThrottle', () => ({
  dentroDoTetoCarla: vi.fn(async () => carimbos.length < tetoLivre),
  marcarEnvioCarla: vi.fn(async (userId: string) => { carimbos.push(userId); }),
  dentroDaJanelaDeEnvio: vi.fn(() => janelaAberta),
}));

const sessoes: any[] = [];
vi.mock('../services/agents/whatsapp/whatsappAgentService', () => ({
  registrarMsgProativa: vi.fn(async (a: any) => { sessoes.push(a); }),
}));

// A âncora tem teste próprio no braço de e-mail; aqui ela é entrada.
const ancoras = new Map<string, number>();
vi.mock('../services/confiancaService', () => ({
  ancorasPorEmail: vi.fn(async () => ancoras),
}));

import { runConfiancaWhatsApp } from '../services/confiancaWhatsAppService';

const DIAS_ATRAS = (d: number) => Date.now() - d * 24 * 3600_000;

function pagante(diasDeCasa: number, over: Row = {}): Row {
  const n = db.users.length + 1;
  const email = `cliente${n}@teste.com`;
  const u: Row = {
    id: `u${n}`, email, nome: 'Cliente Teste', whatsapp: `3499000000${n}`,
    plano: 'ilimitado', whatsapp_opt_out: false, whatsapp_replied_at: null,
    confianca_wa_count: 0, confianca_wa_last_at: null, confianca_last_sent_at: null,
    ...over,
  };
  db.users.push(u);
  ancoras.set(email, DIAS_ATRAS(diasDeCasa));
  return u;
}

beforeEach(() => {
  db.users = []; imagens.length = 0; carimbos.length = 0; sessoes.length = 0;
  ancoras.clear();
  tetoLivre = 99; janelaAberta = true;
  process.env.CONFIANCA_WA_ENABLED = 'true';
});

describe('o carimbo do teto', () => {
  it('todo envio carimba a régua da linha — sem isso a imagem fura todos os tetos', async () => {
    pagante(6);
    const r = await runConfiancaWhatsApp();

    expect(r.enviados).toBe(1);
    expect(imagens).toHaveLength(1);
    expect(carimbos).toHaveLength(1);            // marcarEnvioCarla foi chamado
    expect(carimbos[0]).toBe(db.users[0].id);
  });

  it('para de varrer quando o teto da linha estoura, em vez de continuar', async () => {
    for (let i = 0; i < 5; i++) pagante(6);
    tetoLivre = 2;

    const r = await runConfiancaWhatsApp();
    expect(r.enviados).toBe(2);
    expect(imagens).toHaveLength(2);
    expect(r.previstos).toBe(5);                 // os outros 3 ficam pro próximo ciclo
  });

  it('fora da janela diurna não sai nada', async () => {
    pagante(6);
    janelaAberta = false;
    const r = await runConfiancaWhatsApp();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toContain('janela');
  });

  it('guarda o toque na sessão pra Giovanna ter contexto se ele responder', async () => {
    pagante(6);
    await runConfiancaWhatsApp();
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0].content).toContain('Deixo aqui');
  });
});

describe('trava de segurança', () => {
  it('sem CONFIANCA_WA_ENABLED não manda nada', async () => {
    delete process.env.CONFIANCA_WA_ENABLED;
    pagante(6);
    const r = await runConfiancaWhatsApp();
    expect(r.enviados).toBe(0);
    expect(r.motivo).toContain('CONFIANCA_WA_ENABLED');
    expect(imagens).toHaveLength(0);
  });

  it('o modo seco mostra imagem e legenda sem enviar nem carimbar', async () => {
    delete process.env.CONFIANCA_WA_ENABLED;
    pagante(6);

    const r = await runConfiancaWhatsApp({ seco: true });
    expect(r.previstos).toBe(1);
    expect(r.fila?.[0].card).toContain('card-alessandro-forca-solar.png');
    expect(r.fila?.[0].legenda).toContain('Cliente');
    expect(imagens).toHaveLength(0);
    expect(carimbos).toHaveLength(0);
    expect(db.users[0].confianca_wa_count).toBe(0);
  });
});

describe('quem recebe', () => {
  it('só quem paga — free não entra nesta cadência', async () => {
    pagante(6, { plano: 'free' });
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });

  it('quem já respondeu sai: a conversa é de gente a partir dali', async () => {
    pagante(6, { whatsapp_replied_at: new Date().toISOString() });
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });

  it('opt-out de WhatsApp é respeitado', async () => {
    pagante(6, { whatsapp_opt_out: true });
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });

  it('sem âncora de venda não entra', async () => {
    const u = pagante(6);
    ancoras.delete(u.email);
    const r = await runConfiancaWhatsApp();
    expect(r.enviados).toBe(0);
    expect(r.semAncora).toBe(1);
  });

  it('antes do dia 5 ainda não recebe', async () => {
    pagante(4);
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });
});

describe('canal cruzado', () => {
  it('levou e-mail da MESMA cadência hoje? o WhatsApp não vai junto', async () => {
    pagante(6, { confianca_last_sent_at: new Date().toISOString() });
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });

  it('passadas 23h do e-mail, o card pode sair', async () => {
    pagante(6, { confianca_last_sent_at: new Date(DIAS_ATRAS(2)).toISOString() });
    expect((await runConfiancaWhatsApp()).enviados).toBe(1);
  });

  it('dois cards nossos não saem no mesmo dia', async () => {
    pagante(13, { confianca_wa_count: 1, confianca_wa_last_at: new Date().toISOString() });
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });
});

describe('entrada e sequência', () => {
  it('quem já tem 30 dias de casa recebe só o último card e encerra', async () => {
    pagante(30);
    const r = await runConfiancaWhatsApp();
    expect(r.enviados).toBe(1);
    expect(imagens[0].image).toContain('card-antonio-exxel-solar.png');
    expect(db.users[0].confianca_wa_count).toBe(3);
  });

  it('quem está no meio avança de um em um, sem pular card', async () => {
    pagante(30, { confianca_wa_count: 1 });
    const r = await runConfiancaWhatsApp();
    expect(r.enviados).toBe(1);
    expect(imagens[0].image).toContain('card-lucas-rsc-solar.png');   // o 2, não o 3
    expect(db.users[0].confianca_wa_count).toBe(2);
  });

  it('termina no terceiro e não recomeça', async () => {
    pagante(90, { confianca_wa_count: 3 });
    expect((await runConfiancaWhatsApp()).enviados).toBe(0);
  });
});
