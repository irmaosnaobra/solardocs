import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O aviso do Pix automático gerado e não pago (17/11/2026): 1 aviso por contrato, nada fora das 9h às 20h de Brasília, nada para contrato pago,
// e SEMPRE pelo `emitir` (claim `quiz_aviso:pixpend:<contrato>` pendente; o cartão do tick é quem envia), nunca `sendToGroup` direto.

type Linha = Record<string, any>;
const tabelas: Record<string, Linha[]> = { system_state: [], leads_meta: [], asaas_pix_assinaturas: [], sales: [], users: [] };
const DUP = { code: '23505', message: 'duplicate key' };

function construtor(tabela: string) {
  const filtros: Array<(r: Linha) => boolean> = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let valores: Linha = {};
  let max = 1000;
  let unico = false;
  let ordem: { col: string; asc: boolean } | null = null;
  const q: any = {
    select: () => q,
    insert: (v: Linha) => { op = 'insert'; valores = v; return q; },
    update: (v: Linha) => { op = 'update'; valores = v; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (c: string, v: unknown) => { filtros.push(r => r[c] === v); return q; },
    neq: (c: string, v: unknown) => { filtros.push(r => r[c] !== v); return q; },
    in: (c: string, vs: unknown[]) => { filtros.push(r => vs.includes(r[c])); return q; },
    gte: (c: string, v: string) => { filtros.push(r => String(r[c]) >= v); return q; },
    lte: (c: string, v: string) => { filtros.push(r => String(r[c]) <= v); return q; },
    like: (c: string, pat: string) => { const pre = pat.replace(/%$/, ''); filtros.push(r => String(r[c]).startsWith(pre)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return q; },
    limit: (n: number) => { max = n; return q; },
    maybeSingle: () => { unico = true; return q; },
    then: (res: (v: unknown) => unknown) => {
      const alvo = tabelas[tabela]!.filter(r => filtros.every(f => f(r)));
      if (op === 'insert') {
        if (tabela === 'system_state' && tabelas[tabela]!.some(r => r.key === valores.key)) return res({ data: null, error: DUP });
        tabelas[tabela]!.push({ ...valores });
        return res({ data: null, error: null });
      }
      if (op === 'delete') { tabelas[tabela] = tabelas[tabela]!.filter(r => !alvo.includes(r)); return res({ data: null, error: null }); }
      if (op === 'update') { alvo.forEach(r => Object.assign(r, valores)); return res({ data: null, error: null }); }
      let lista = [...alvo];
      if (ordem) { const { col, asc } = ordem; lista = lista.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1)); }
      lista = lista.slice(0, max).map(r => ({ ...r }));
      return res({ data: unico ? (lista[0] ?? null) : lista, error: null });
    },
  };
  return q;
}

const sendToGroup = vi.fn(async () => ({ messageId: 'm1' }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => construtor(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => construtor(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn(async () => undefined) }));
vi.mock('../services/agents/zapiClient', () => ({
  sendToGroup: (...a: unknown[]) => (sendToGroup as any)(...a),
  sendWhatsApp: vi.fn(async () => undefined),
  linhaEmCooldown: () => false,
}));

import { runAvisoPixPendenteTick, dentroDaJanelaDoAvisoPix, linhaDaCarlaNoPix } from '../services/solardoc/avisoPixPendenteTick';
import { montarAvisoPixPendente, duracaoCurta } from '../services/solardoc/avisoGrupoTextos';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, leadIdDoQuiz, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';

// Quarta-feira, 18/11/2026, 12:00 de Brasília.
const AGORA = new Date('2026-11-18T15:00:00.000Z');
const minAtras = (m: number, de: Date = AGORA): string => new Date(de.getTime() - m * 60_000).toISOString();
const TEL = '34991234567';
const claim = (id: string): string => `quiz_aviso:pixpend:${id}`;

function contrato(id: string, over: Linha = {}, tel: string | null = TEL): void {
  tabelas.asaas_pix_assinaturas!.push({ contract_id: id, status: 'pendente', created_at: minAtras(45), ultimo_pagamento_id: null, ultimo_pagamento_em: null, ...over });
  if (tel) tabelas.system_state!.push({ key: `pix_auto_atrib:${id}`, value: { whatsapp: tel, origem: 'quiz_solardoc' }, updated_at: minAtras(45) });
}
const estadosDe = (id: string): unknown => tabelas.system_state!.find(r => r.key === claim(id))?.value?.estado;
const claims = (): Linha[] => tabelas.system_state!.filter(r => String(r.key).startsWith('quiz_aviso:pixpend:'));

beforeEach(() => {
  tabelas.system_state = []; tabelas.leads_meta = []; tabelas.asaas_pix_assinaturas = []; tabelas.sales = []; tabelas.users = [];
  sendToGroup.mockClear();
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.AVISO_PIX_PENDENTE_OFF;
  process.env.ZAPI_SOLARDOC_GRUPO_ID = '120363000000000000-group';
});
afterEach(() => { delete process.env.AVISO_PIX_PENDENTE_OFF; });

describe('o texto', () => {
  it('leva minutos, nome, empresa, telefone e a frase da Carla, sem emoji nem travessão', () => {
    const t = montarAvisoPixPendente({ minutos: 45, nome: 'Carlos Andrade', empresa: 'Solar Andrade', telefone: TEL, linhaCarla: 'A Carla já chamou às 11:50.' });
    expect(t).toBe('Pix automático gerado e não pago há 45 min.\nCarlos Andrade, da Solar Andrade, telefone +55 (34) 99123-4567.\nVale um humano chamar agora.\nA Carla já chamou às 11:50.');
    expect(t).not.toMatch(/[–—]|\p{Extended_Pictographic}|\[|\]/u);
  });
  it('sem empresa não cita empresa; sem nome sai "Nome não informado"; mais de 2 h vira horas', () => {
    const t = montarAvisoPixPendente({ minutos: 200, nome: null, empresa: '', telefone: TEL, linhaCarla: 'x' });
    expect(t).toContain('há 3 h.');
    expect(t).toContain('Nome não informado, telefone +55 (34)');
    expect(t).not.toContain(' da ');
    expect(duracaoCurta(30)).toBe('30 min');
  });
  it('a linha da Carla: chamou (hora de Brasília), não vai chamar, ou chama no próximo horário', () => {
    expect(linhaDaCarlaNoPix({ em: '2026-11-18T14:50:00.000Z' }, false)).toBe('A Carla já chamou às 11:50.');
    expect(linhaDaCarlaNoPix({ em: '2026-11-18T14:50:00.000Z', estado: 'nao_saiu' }, false)).toMatch(/chama no próximo horário/);
    expect(linhaDaCarlaNoPix(null, true)).toMatch(/não vai chamar/);
    expect(linhaDaCarlaNoPix(null, false)).toMatch(/chama no próximo horário/);
  });
});

describe('a janela de 9h às 20h de Brasília', () => {
  it('8h59 fora, 9h dentro, 19h59 dentro, 20h fora', () => {
    expect(dentroDaJanelaDoAvisoPix(new Date('2026-11-18T11:59:00.000Z'))).toBe(false);
    expect(dentroDaJanelaDoAvisoPix(new Date('2026-11-18T12:00:00.000Z'))).toBe(true);
    expect(dentroDaJanelaDoAvisoPix(new Date('2026-11-18T22:59:00.000Z'))).toBe(true);
    expect(dentroDaJanelaDoAvisoPix(new Date('2026-11-18T23:00:00.000Z'))).toBe(false);
  });
});

describe('quem já pagou e a pessoa repetida', () => {
  it('pagou no cartão aos 20 min (venda com o e-mail do contrato): sem aviso, contrato sai da fila como descartado', async () => {
    contrato('c1', { email: 'ana@exemplo.com' });
    tabelas.sales!.push({ email: 'ana@exemplo.com', phone: null, attribution_session_id: null, created_at: minAtras(25), status: 'paid', valor: 67 });
    const r = await runAvisoPixPendenteTick(AGORA);
    expect(r.avisados).toBe(0);
    expect(claims()).toHaveLength(1);
    expect(claims()[0]!.value.estado).toBe('descartado');
    expect(sendToGroup).not.toHaveBeenCalled();
    // na rodada seguinte nem relê: o claim já tira o contrato
    expect((await runAvisoPixPendenteTick(new Date(AGORA.getTime() + 2 * 60_000))).avisados).toBe(0);
    expect(claims()).toHaveLength(1);
  });

  it('plano vigente da conta (user_id) ou outro contrato Pix ativo da pessoa também barram', async () => {
    contrato('u1', { email: 'bia@exemplo.com', user_id: 'user-1' }, '34991110010');
    tabelas.users!.push({ id: 'user-1', plano: 'ilimitado', plano_expira_em: new Date(AGORA.getTime() + 20 * 86_400_000).toISOString() });
    contrato('o1', { email: 'caio@exemplo.com' }, '34991110011');
    tabelas.asaas_pix_assinaturas!.push({ contract_id: 'o1b', email: 'caio@exemplo.com', user_id: null, status: 'ativo', created_at: minAtras(300), ultimo_pagamento_id: 'pay_1', ultimo_pagamento_em: minAtras(290) });
    const r = await runAvisoPixPendenteTick(AGORA);
    expect(r.avisados).toBe(0);
    expect(claims().map(c => c.value.estado)).toEqual(['descartado', 'descartado']);
  });

  it('dois contratos pendentes da mesma pessoa: UM aviso (o segundo é descartado); outra pessoa segue avisada; 24 h depois volta', async () => {
    contrato('c1', { email: 'ana@exemplo.com' });
    contrato('c2', { email: 'ana@exemplo.com', created_at: minAtras(40) });
    contrato('c3', {}, '34998887766');
    const r = await runAvisoPixPendenteTick(AGORA);
    expect(r.avisados).toBe(2);
    expect(estadosDe('c1')).toBe('pendente');
    expect(estadosDe('c2')).toBe('descartado');
    expect(estadosDe('c3')).toBe('pendente');
    const depois = new Date(AGORA.getTime() + 25 * 3600_000);
    contrato('c4', { email: 'ana@exemplo.com', created_at: minAtras(45, depois) });
    const r2 = await runAvisoPixPendenteTick(depois);
    expect(r2.avisados).toBe(1);
    expect(estadosDe('c4')).toBe('pendente');
  });
});

describe('o tick', () => {
  it('gera 1 aviso por contrato (claim pendente com o texto) e NÃO repete na rodada seguinte; nunca chama sendToGroup', async () => {
    contrato('c1');
    const r1 = await runAvisoPixPendenteTick(AGORA);
    expect(r1.avisados).toBe(1);
    expect(claims()).toHaveLength(1);
    expect(claims()[0]!.key).toBe(claim('c1'));
    expect(claims()[0]!.value.estado).toBe('pendente');
    expect(claims()[0]!.value.texto).toContain('Pix automático gerado e não pago há 45 min.');
    expect(claims()[0]!.value.texto).toContain('+55 (34) 99123-4567');
    await runAvisoPixPendenteTick(new Date(AGORA.getTime() + 2 * 60_000));
    await runAvisoPixPendenteTick(new Date(AGORA.getTime() + 4 * 60_000));
    expect(claims()).toHaveLength(1);
    expect(sendToGroup).not.toHaveBeenCalled();
  });

  it('dois contratos geram dois avisos, cada um uma vez', async () => {
    contrato('c1');
    contrato('c2', {}, '34998887766');
    await runAvisoPixPendenteTick(AGORA);
    await runAvisoPixPendenteTick(AGORA);
    expect(claims().map(c => c.key).sort()).toEqual([claim('c1'), claim('c2')]);
  });

  it('nada fora da janela (8h de Brasília e 20h) e nada com AVISO_PIX_PENDENTE_OFF=true', async () => {
    contrato('c1', { created_at: '2026-11-18T09:00:00.000Z' });
    const cedo = new Date('2026-11-18T11:30:00.000Z');
    expect((await runAvisoPixPendenteTick(cedo)).motivo).toBe('fora_da_janela');
    expect((await runAvisoPixPendenteTick(new Date('2026-11-18T23:10:00.000Z'))).motivo).toBe('fora_da_janela');
    expect(claims()).toHaveLength(0);
    process.env.AVISO_PIX_PENDENTE_OFF = 'true';
    expect((await runAvisoPixPendenteTick(AGORA)).motivo).toBe('desligado');
    expect(claims()).toHaveLength(0);
  });

  it('nada para contrato pago, nem para o que não é pendente, nem para o de menos de 30 min, nem para o de mais de 16 h', async () => {
    contrato('ativo', { status: 'ativo' });
    contrato('pago', { ultimo_pagamento_id: 'pay_1' }, '34991110001');
    contrato('pagoEm', { ultimo_pagamento_em: minAtras(10) }, '34991110002');
    contrato('recente', { created_at: minAtras(29) }, '34991110003');
    contrato('velho', { created_at: minAtras(17 * 60) }, '34991110004');
    const r = await runAvisoPixPendenteTick(AGORA);
    expect(r.avisados).toBe(0);
    expect(claims()).toHaveLength(0);
  });

  it('contrato sem WhatsApp na atribuição não gera aviso (ninguém para chamar)', async () => {
    contrato('semtel', {}, null);
    const r = await runAvisoPixPendenteTick(AGORA);
    expect(r.avisados).toBe(0);
    expect(r.pulados).toBe(1);
    expect(claims()).toHaveLength(0);
  });

  it('diz que a Carla já chamou (carimbo do 1º toque) e leva nome e empresa do lead do quiz', async () => {
    contrato('c1');
    const tel = normalizarTelefoneSd(TEL) as string;
    const h = hmacDe(chaveDoTelefone(tel)) as string;
    tabelas.system_state!.push({ key: `quiz_rec_sent:${h}`, value: { em: '2026-11-18T14:50:00.000Z', tipo: 'pix' }, updated_at: minAtras(10) });
    tabelas.leads_meta!.push({ lead_id: leadIdDoQuiz(tel), form_id: 'quiz_solardoc', nome: 'Carlos Andrade', whatsapp: TEL, cidade: 'Uberlândia-MG', field_data: [{ name: 'Empresa', values: ['Solar Andrade'] }], created_time: minAtras(60) });
    await runAvisoPixPendenteTick(AGORA);
    const t = claims()[0]!.value.texto as string;
    expect(t).toContain('Carlos Andrade, da Solar Andrade, telefone');
    expect(t).toContain('A Carla já chamou às 11:50.');
  });
});
