import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Onde está cada lead do quiz do SolarDoc (26/10/2026): regras puras, o lote do `.in` e a leitura inteira sobre dependências falsas.
// Nada aqui toca banco de verdade.

const h = vi.hoisted(() => ({
  tamanhosDoIn: [] as number[],
  tabelasLidas: [] as string[],
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (t: string) => {
      h.tabelasLidas.push(t);
      return { select: () => ({ in: async (_c: string, lote: string[]) => { h.tamanhosDoIn.push(lote.length); return { data: lote.map((key) => ({ key, value: {} })), error: null }; } }) };
    },
  },
}));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: () => { throw new Error('sem banco'); } } }));

import {
  carlaDoLead, avisoDoLead, compraNoClaim, emLotes, limitarDias, statusLeadsQuiz, depsStatusReais,
  MOTIVO_ANTES_DA_LARGADA, MOTIVO_TESTE, DIAS_PADRAO, DIAS_MAXIMO, LOTE_CHAVES,
  type DepsStatus, type LinhaEstado,
} from '../services/solardoc/statusLeadsQuiz';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveDoTelefone, normalizarTelefoneSd } from '../services/solardoc/quizSolardoc';
import { PREFIXO_CARIMBO_REC } from '../services/solardoc/recuperacaoCarlaRegras';
import { PREFIXO_CLAIM_QUIZ } from '../services/solardoc/avisoGrupoSolardoc';
import { PREFIXO_FOLLOWUP } from '../services/solardoc/followupQuizSolardoc';
import type { LeadRec } from '../services/solardoc/recuperacaoCarlaRegras';

const AGORA = new Date('2026-10-26T18:00:00.000Z');
const LARGADA = Date.parse('2026-10-25T12:00:00.000Z');
const DEPOIS = '2026-10-26T15:00:00.000Z';
const ANTES = '2026-10-24T15:00:00.000Z';

const hmacDoTel = (tel: string): string => hmacDe(chaveDoTelefone(normalizarTelefoneSd(tel) as string)) as string;
const campos = (extra: Record<string, string> = {}) =>
  Object.entries({ cnpj: 'sim', 'Índice': '80', lp_session: 'lp-1', ...extra }).map(([name, v]) => ({ name, values: [v] }));
let seq = 0;
const lead = (o: Partial<LeadRec> & { fd?: Record<string, string> } = {}): LeadRec => {
  seq++;
  const tel = `3499${String(1000000 + seq).slice(-7)}`;
  return {
    lead_id: `sdquiz_${chaveDoTelefone('55' + tel)}`, nome: 'Maria Teste', whatsapp: tel, cidade: 'Uberlândia-MG',
    created_time: DEPOIS, field_data: campos(o.fd), ...o,
  };
};
const linha = (key: string, value: unknown): LinhaEstado => ({ key, value });

beforeEach(() => {
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  delete process.env.AGENTES5040_HMAC;
  h.tamanhosDoIn = []; h.tabelasLidas = []; seq = 0;
});

describe('carlaDoLead: o mapa da chave quiz_rec_sent para o estado', () => {
  const l = lead();
  const base = { lead: l, hmac: 'abc', leituraOk: true, largadaMs: LARGADA as number | null | undefined };
  it('estado enviado = chamou, com a hora', () => {
    expect(carlaDoLead({ ...base, claim: linha('k', { em: DEPOIS, estado: 'enviado' }) })).toEqual({ estado: 'chamou', em: DEPOIS, motivo: null });
  });
  it('nao_saiu e incerto = tentou, com o detalhe', () => {
    expect(carlaDoLead({ ...base, claim: linha('k', { em: DEPOIS, estado: 'nao_saiu' }) })).toEqual({ estado: 'tentou', em: DEPOIS, motivo: null, detalhe: 'nao_saiu' });
    expect(carlaDoLead({ ...base, claim: linha('k', { em: DEPOIS, estado: 'incerto' }) })).toEqual({ estado: 'tentou', em: DEPOIS, motivo: null, detalhe: 'incerto' });
  });
  it('claim sem estado (nasce só com a hora) ou com estado desconhecido = sem_confirmacao, nunca chamou nem tentou', () => {
    expect(carlaDoLead({ ...base, claim: linha('k', { em: DEPOIS }) })).toEqual({ estado: 'sem_confirmacao', em: DEPOIS, motivo: null });
    expect(carlaDoLead({ ...base, claim: linha('k', { em: DEPOIS, estado: 'outra_coisa' }) }).estado).toBe('sem_confirmacao');
    expect(carlaDoLead({ ...base, claim: linha('k', null) }).estado).toBe('sem_confirmacao');
  });
  it('sem chave = nao_chamou', () => {
    expect(carlaDoLead({ ...base, claim: undefined })).toEqual({ estado: 'nao_chamou', em: null, motivo: null });
  });
  it('leitura que falhou (ou sem hmac) = nao_conferiu, nunca nao_chamou', () => {
    expect(carlaDoLead({ ...base, leituraOk: false, claim: undefined }).estado).toBe('nao_conferiu');
    expect(carlaDoLead({ ...base, hmac: null, claim: undefined }).estado).toBe('nao_conferiu');
  });
});

describe('carlaDoLead: o motivo de nao_chamou', () => {
  it('lead de antes da largada', () => {
    const r = carlaDoLead({ lead: lead({ created_time: ANTES }), hmac: 'abc', leituraOk: true, claim: undefined, largadaMs: LARGADA });
    expect(r).toEqual({ estado: 'nao_chamou', em: null, motivo: MOTIVO_ANTES_DA_LARGADA });
    expect(MOTIVO_ANTES_DA_LARGADA).toBe('Chegou antes de a Carla começar');
  });
  it('lead de depois da largada não leva esse motivo', () => {
    expect(carlaDoLead({ lead: lead(), hmac: 'abc', leituraOk: true, claim: undefined, largadaMs: LARGADA }).motivo).toBeNull();
  });
  it('largada que não se leu (undefined) ou que ainda não houve (null) não inventa motivo', () => {
    expect(carlaDoLead({ lead: lead({ created_time: ANTES }), hmac: 'abc', leituraOk: true, claim: undefined, largadaMs: undefined }).motivo).toBeNull();
    expect(carlaDoLead({ lead: lead({ created_time: ANTES }), hmac: 'abc', leituraOk: true, claim: undefined, largadaMs: null }).motivo).toBeNull();
  });
  it('teste', () => {
    const t = lead({ fd: { teste: 'sim' } });
    expect(carlaDoLead({ lead: t, hmac: 'abc', leituraOk: true, claim: undefined, largadaMs: LARGADA }).motivo).toBe(MOTIVO_TESTE);
  });
});

describe('avisoDoLead e compraNoClaim', () => {
  const desist = (estado: string) => avisoDoLead({ leituraOk: true, hmac: 'h', desistencia: linha('k', { tipo: 'desistencia', estado, em: DEPOIS, texto: 'Maria' }), semVaga: undefined });
  const semVaga = (estado: string) => avisoDoLead({ leituraOk: true, hmac: 'h', desistencia: undefined, semVaga: linha('k', { tipo: 'sem_vaga', estado, em: DEPOIS, texto: 'Maria' }) });
  it('chave da desistência: enviado, enviado_cartao, email, sem_grupo, falhou e expirado contam (o e-mail sai sem regravar a chave)', () => {
    for (const e of ['enviado', 'enviado_cartao', 'email', 'sem_grupo', 'email_sem_grupo', 'falhou', 'expirado']) expect(desist(e)).toEqual({ em: DEPOIS, tipo: 'desistencia' });
  });
  it('chave da desistência: novo, pendente e comprou não contam', () => {
    for (const e of ['novo', 'pendente', 'comprou']) expect(desist(e)).toBeNull();
  });
  it('sem_grupo_falhou (o e-mail do robô também falhou) não conta como avisado em nenhuma das duas chaves', () => {
    expect(desist('sem_grupo_falhou')).toBeNull();
    expect(semVaga('sem_grupo_falhou')).toBeNull();
  });
  it('chave :semvaga: enviado, enviado_cartao, email_sem_grupo (e-mail do robô, 27/10), falhou e expirado; sem_grupo (passado) e email NÃO contam', () => {
    for (const e of ['enviado', 'enviado_cartao', 'email_sem_grupo', 'falhou', 'expirado']) expect(semVaga(e)).toEqual({ em: DEPOIS, tipo: 'sem_vaga' });
    for (const e of ['sem_grupo', 'email', 'novo', 'pendente', 'comprou']) expect(semVaga(e)).toBeNull();
  });
  it('o texto do aviso (leva o nome) nunca sai', () => {
    expect(JSON.stringify(desist('enviado'))).not.toMatch(/Maria/);
  });
  it('leitura que falhou = nao_conferiu', () => {
    expect(avisoDoLead({ leituraOk: false, hmac: 'h', desistencia: undefined, semVaga: undefined })).toEqual({ nao_conferiu: true });
  });
  it('o claim do comprador dá a compra com a data', () => {
    expect(compraNoClaim(linha('k', { tipo: 'desistencia', estado: 'comprou', em: DEPOIS }))).toEqual({ em: DEPOIS });
    expect(compraNoClaim(linha('k', { estado: 'enviado' }))).toBeNull();
    expect(compraNoClaim(undefined)).toBeNull();
  });
});

describe('lotes e limites', () => {
  it('emLotes parte em pedaços de até 100', () => {
    const lotes = emLotes(Array.from({ length: 250 }, (_, i) => `k${i}`));
    expect(lotes.map((x) => x.length)).toEqual([100, 100, 50]);
    expect(emLotes([])).toEqual([]);
    expect(LOTE_CHAVES).toBe(100);
  });
  it('a leitura de system_state manda o .in em pedaços de até 100 e devolve tudo', async () => {
    const chaves = Array.from({ length: 230 }, (_, i) => `quiz_rec_sent:${i}`);
    const lidas = await depsStatusReais().chaves(chaves);
    expect(h.tamanhosDoIn).toEqual([100, 100, 30]);
    expect(h.tabelasLidas.every((t) => t === 'system_state')).toBe(true);
    expect(lidas?.size).toBe(230);
  });
  it('dias: 60 por padrão, no mínimo 1 e no máximo 180', () => {
    expect(limitarDias(undefined)).toBe(DIAS_PADRAO);
    expect(limitarDias('abc')).toBe(DIAS_PADRAO);
    expect(limitarDias('0')).toBe(DIAS_PADRAO);
    expect(limitarDias('-5')).toBe(DIAS_PADRAO);
    expect(limitarDias('30')).toBe(30);
    expect(limitarDias('9999')).toBe(DIAS_MAXIMO);
  });
});

describe('statusLeadsQuiz sobre dependências falsas', () => {
  function deps(o: {
    leads: LeadRec[]; estado?: Map<string, LinhaEstado> | null; largada?: number | null | 'erro'; ligada?: boolean;
    vendas?: 'erro' | { sessoes?: Record<string, string>; chaves?: Record<string, string>; truncada?: boolean };
    plano?: (chave: string) => boolean | 'erro';
  }): DepsStatus & { comprasConsultadas: string[]; chamadasPlanos: () => number } {
    const consultadas: string[] = [];
    let chamadas = 0;
    return {
      comprasConsultadas: consultadas,
      chamadasPlanos: () => chamadas,
      leads: async () => o.leads,
      chaves: async () => (o.estado === undefined ? new Map() : o.estado),
      estado: async () => ({ ligada: o.ligada ?? true, motivo: o.ligada === false ? 'pausa_no_banco' : 'ligada' }),
      largada: async () => { if (o.largada === 'erro') throw new Error('x'); return o.largada === undefined ? LARGADA : o.largada; },
      vendas: async () => {
        if (o.vendas === 'erro') throw new Error('x');
        const v = o.vendas ?? {};
        return { sessoes: new Map(Object.entries(v.sessoes ?? {})), chaves: new Map(Object.entries(v.chaves ?? {})), truncada: !!v.truncada };
      },
      planos: async (chaves) => {
        chamadas++;
        consultadas.push(...chaves);
        const pagas = new Set<string>();
        for (const c of chaves) {
          const p = o.plano ? o.plano(c) : false;
          if (p === 'erro') throw new Error('x');
          if (p) pagas.add(c);
        }
        return pagas;
      },
    };
  }
  const chaveDe = (l: LeadRec) => chaveDoTelefone(normalizarTelefoneSd(l.whatsapp) as string);

  it('junta Carla, aviso e compra por lead_id, sem nome nem telefone', async () => {
    const chamou = lead(), tentou = lead(), nao = lead(), antigo = lead({ created_time: ANTES }), comprador = lead({ fd: { lp_session: 'lp-compra' } }), teste = lead({ fd: { teste: 'sim' } });
    const estado = new Map<string, LinhaEstado>([
      [`${PREFIXO_CARIMBO_REC}${hmacDoTel(chamou.whatsapp as string)}`, linha('k', { em: DEPOIS, estado: 'enviado' })],
      [`${PREFIXO_CLAIM_QUIZ}${hmacDoTel(chamou.whatsapp as string)}`, linha('k', { tipo: 'desistencia', estado: 'enviado', em: '2026-10-26T15:20:00.000Z', texto: 'Maria' })],
      [`${PREFIXO_CARIMBO_REC}${hmacDoTel(tentou.whatsapp as string)}`, linha('k', { em: DEPOIS })],
    ]);
    const d = deps({ leads: [chamou, tentou, nao, antigo, comprador, teste], estado, vendas: { sessoes: { 'lp-compra': '2026-10-26T16:00:00.000Z' } } });
    const r = await statusLeadsQuiz({ agora: AGORA }, d);
    expect(r.ok).toBe(true);
    expect(r.carla_ligada).toBe(true);
    expect(r.largada).toBe(new Date(LARGADA).toISOString());
    expect(r.truncado).toBe(false);
    expect(Object.keys(r.status)).toHaveLength(6);
    expect(r.status[chamou.lead_id as string].carla.estado).toBe('chamou');
    expect(r.status[chamou.lead_id as string].aviso).toEqual({ em: '2026-10-26T15:20:00.000Z', tipo: 'desistencia' });
    expect(r.status[tentou.lead_id as string].carla.estado).toBe('sem_confirmacao');   // claim só com a hora
    expect(r.status[nao.lead_id as string].carla).toEqual({ estado: 'nao_chamou', em: null, motivo: null });
    expect(r.status[antigo.lead_id as string].carla.motivo).toBe(MOTIVO_ANTES_DA_LARGADA);
    expect(r.status[teste.lead_id as string].carla.motivo).toBe(MOTIVO_TESTE);
    expect(r.status[comprador.lead_id as string].comprou).toEqual({ em: '2026-10-26T16:00:00.000Z' });
    expect(r.status[nao.lead_id as string].comprou).toBeNull();
    expect(r.status[teste.lead_id as string].comprou).toBeNull();
    expect(d.comprasConsultadas).not.toContain(chaveDe(teste));   // teste não gasta consulta
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/Maria/);
    expect(texto).not.toContain(String(chamou.whatsapp));
  });

  it('followup vem em cada lead e a fila só conta quem está devido (teste e comprador ficam de fora)', async () => {
    const novo = lead({ created_time: '2026-10-26T15:00:00.000Z' });                                  // chegou há 3 h: devido
    const recente = lead({ created_time: '2026-10-26T17:50:00.000Z' });                               // chegou há 10 min: ainda não
    const adiado = lead({ created_time: '2026-10-26T14:00:00.000Z' });                                // não atendeu hoje: próximo = amanhã
    const comprador = lead({ fd: { lp_session: 'lp-compra' } });
    const teste = lead({ fd: { teste: 'sim' } });
    const estado = new Map<string, LinhaEstado>([
      [`${PREFIXO_FOLLOWUP}${hmacDoTel(adiado.whatsapp as string)}`, linha('k', { v: 1, hist: [{ acao: 'nao_atendeu', em: '2026-10-26T16:00:00.000Z', por: 'giovanna' }] })],
      [`${PREFIXO_FOLLOWUP}${hmacDoTel(comprador.whatsapp as string)}`, linha('k', { v: 1, hist: [{ acao: 'falou', em: '2026-10-26T16:00:00.000Z', por: 'giovanna' }] })],
    ]);
    const d = deps({ leads: [novo, recente, adiado, comprador, teste], estado, vendas: { sessoes: { 'lp-compra': '2026-10-26T17:00:00.000Z' } } });
    const r = await statusLeadsQuiz({ agora: AGORA }, d);
    for (const l of [novo, recente, adiado, comprador, teste]) expect(r.status[l.lead_id as string].followup).toBeDefined();
    expect(r.status[novo.lead_id as string].followup).toMatchObject({ estado: 'novo', proximo: '2026-10-26', devido: true, aberto: true, tentativas: 0, ultima: null });
    expect(r.status[recente.lead_id as string].followup).toMatchObject({ estado: 'novo', devido: false });
    expect(r.status[adiado.lead_id as string].followup).toMatchObject({ estado: 'nao_atendeu', tentativas: 1, proximo: '2026-10-27', devido: false });
    expect(r.status[adiado.lead_id as string].followup?.ultima).toEqual({ acao: 'nao_atendeu', em: '2026-10-26T16:00:00.000Z', por: 'giovanna' });
    expect(r.status[comprador.lead_id as string].followup).toMatchObject({ estado: 'comprou', aberto: false, devido: false, proximo: null });
    expect(r.status[teste.lead_id as string].followup?.devido).toBe(true);   // o teste TEM follow-up devido, mas não entra na fila
    expect(r.fila).toEqual({ para_ligar_hoje: 1, incompleta: false });
  });

  it('leitura do system_state que falha: followup nulo (nunca "novo"), lead fora da fila e fila.incompleta', async () => {
    const a = lead({ created_time: '2026-10-26T15:00:00.000Z' }), b = lead({ created_time: '2026-10-26T15:00:00.000Z' });
    const r = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [a, b], estado: null }));
    expect(r.status[a.lead_id as string].followup).toBeNull();
    expect(r.status[b.lead_id as string].followup).toBeNull();
    expect(r.fila).toEqual({ para_ligar_hoje: 0, incompleta: true });
  });

  it('lead de teste com leitura falha não deixa a fila incompleta; o de verdade deixa', async () => {
    const teste = lead({ fd: { teste: 'sim' } });
    const so = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [teste], estado: null }));
    expect(so.status[teste.lead_id as string].followup).toBeNull();
    expect(so.fila).toEqual({ para_ligar_hoje: 0, incompleta: false });
    const real = lead();
    const com = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [teste, real], estado: null }));
    expect(com.fila.incompleta).toBe(true);
  });

  it('lead sem hmac (sem segredo) também vem com followup nulo e a fila fica incompleta', async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const l = lead();
    const r = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [l] }));
    expect(r.status[l.lead_id as string].followup).toBeNull();
    expect(r.fila).toEqual({ para_ligar_hoje: 0, incompleta: true });
  });

  it('sem_interesse com a leitura OK continua fechado e fora da fila (e a fila não fica incompleta)', async () => {
    const fechado = lead({ created_time: '2026-10-26T15:00:00.000Z' });
    const estado = new Map<string, LinhaEstado>([
      [`${PREFIXO_FOLLOWUP}${hmacDoTel(fechado.whatsapp as string)}`, linha('k', { v: 1, hist: [{ acao: 'sem_interesse', em: '2026-10-26T16:00:00.000Z', por: 'giovanna' }] })],
    ]);
    const r = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [fechado], estado }));
    expect(r.status[fechado.lead_id as string].followup).toMatchObject({ estado: 'sem_interesse', aberto: false, devido: false, proximo: null });
    expect(r.fila).toEqual({ para_ligar_hoje: 0, incompleta: false });
  });

  it('o follow-up lê a chave quiz_followup do hmac do telefone (pedida junto das outras)', async () => {
    const l = lead();
    const pedidas: string[][] = [];
    const d = { ...deps({ leads: [l] }), chaves: async (c: string[]) => { pedidas.push(c); return new Map<string, LinhaEstado>(); } };
    await statusLeadsQuiz({ agora: AGORA }, d);
    expect(pedidas[0]).toContain(`quiz_followup:${hmacDoTel(l.whatsapp as string)}`);
  });

  it('leitura do system_state que falha: nao_conferiu na Carla e no aviso, nunca "não chamou"', async () => {
    const l = lead();
    const r = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [l], estado: null }));
    const s = r.status[l.lead_id as string];
    expect(s.carla.estado).toBe('nao_conferiu');
    expect(s.aviso).toEqual({ nao_conferiu: true });
  });

  it('sem segredo de HMAC não dá para ler a chave: nao_conferiu', async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const l = lead();
    const r = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [l] }));
    expect(r.status[l.lead_id as string].carla.estado).toBe('nao_conferiu');
  });

  it('compra: ledger que falha ou que foi cortado não prova "não comprou"; plano pago prova "sim"', async () => {
    const a = lead(), b = lead(), c = lead();
    const falhou = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [a], vendas: 'erro' }));
    expect(falhou.status[a.lead_id as string].comprou).toEqual({ nao_conferiu: true });
    const cortado = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [b], vendas: { truncada: true } }));
    expect(cortado.status[b.lead_id as string].comprou).toEqual({ nao_conferiu: true });
    const plano = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [c], vendas: 'erro', plano: () => true }));
    expect(plano.status[c.lead_id as string].comprou).toEqual({ em: null });
    const erroPlano = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: [c], plano: () => 'erro' }));
    expect(erroPlano.status[c.lead_id as string].comprou).toEqual({ nao_conferiu: true });
  });

  it('o plano pago de todos os leads sem venda sai numa leitura só (em lote)', async () => {
    const varios = Array.from({ length: 7 }, () => lead());
    const d = deps({ leads: varios, plano: (c) => c === chaveDe(varios[3]) });
    const r = await statusLeadsQuiz({ agora: AGORA }, d);
    expect(d.chamadasPlanos()).toBe(1);
    expect(d.comprasConsultadas).toHaveLength(7);
    expect(r.status[varios[3].lead_id as string].comprou).toEqual({ em: null });
    expect(r.status[varios[0].lead_id as string].comprou).toBeNull();
  });

  it('o claim do aviso com estado comprou dá a compra com data, sem consultar mais nada', async () => {
    const l = lead();
    const estado = new Map<string, LinhaEstado>([[`${PREFIXO_CLAIM_QUIZ}${hmacDoTel(l.whatsapp as string)}`, linha('k', { tipo: 'desistencia', estado: 'comprou', em: DEPOIS })]]);
    const d = deps({ leads: [l], estado });
    const r = await statusLeadsQuiz({ agora: AGORA }, d);
    expect(r.status[l.lead_id as string].comprou).toEqual({ em: DEPOIS });
    expect(r.status[l.lead_id as string].aviso).toBeNull();
    expect(d.comprasConsultadas).toEqual([]);
  });

  it('1000 leads lidos = truncado; Carla pausada é refletida; largada ilegível não inventa motivo', async () => {
    const muitos = Array.from({ length: 1000 }, () => lead({ created_time: ANTES }));
    const r = await statusLeadsQuiz({ agora: AGORA }, deps({ leads: muitos, ligada: false, largada: 'erro' }));
    expect(r.truncado).toBe(true);
    expect(r.carla_ligada).toBe(false);
    expect(r.largada).toBeNull();
    expect(r.status[muitos[0].lead_id as string].carla.motivo).toBeNull();
  });

  it('a leitura dos leads que falha sobe (a rota responde 502)', async () => {
    const d = { ...deps({ leads: [] }), leads: async () => { throw new Error('banco fora'); } };
    await expect(statusLeadsQuiz({ agora: AGORA }, d)).rejects.toThrow('banco fora');
  });
});

describe('estrutura: cada tabela no seu banco', () => {
  const fonte = readFileSync(join(__dirname, '..', 'services', 'solardoc', 'statusLeadsQuiz.ts'), 'utf8');
  it('zero leads_meta no cliente principal', () => {
    expect(fonte).not.toMatch(/\bsupabase\s*\.from\(\s*['"`]leads_meta['"`]/);
    expect(fonte).toMatch(/supabaseGerador\s*\.from\(\s*['"`]leads_meta['"`]/);
  });
  it('zero system_state no cliente do Gerador', () => {
    expect(fonte).not.toMatch(/supabaseGerador\s*\.from\(\s*['"`]system_state['"`]/);
    expect(fonte).toMatch(/\bsupabase\s*\.from\(\s*['"`]system_state['"`]/);
  });
  it('só lê: nenhum insert, update, upsert nem delete', () => {
    expect(fonte).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
