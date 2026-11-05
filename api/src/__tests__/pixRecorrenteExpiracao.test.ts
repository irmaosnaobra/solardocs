import { describe, it, expect, vi, beforeEach } from 'vitest';

// O QR de 24 h do Pix automático (05/11/2026): expirationSeconds 86400, fallback UMA vez com 3600 só em erro de validação (400/422), a validade REAL
// gravada por contrato em pix_auto_exp e devolvida em `expiraEm`. Nada aqui toca banco, Asaas ou rede.

const h = vi.hoisted(() => ({
  existente: null as Record<string, unknown> | null,
  /** valor de pix_auto_exp:<contrato> do contrato existente: undefined = chave ausente; 'erro' = a leitura falha. */
  exp: undefined as unknown,
  upserts: [] as Array<{ key: string; value: Record<string, unknown> }>,
  atualizacoes: [] as Array<Record<string, unknown>>,
  corpos: [] as Array<Record<string, any>>,
  /** respostas/erros da POST /pix/automatic/authorizations, na ordem de chamada */
  respostas: [] as Array<unknown>,
  /** quantas gravações de pix_auto_exp falham antes de dar certo */
  falhasUpsert: 0,
  /** linhas que o update ... .select('id') devolve (a corrida do expirado) */
  linhasMudadas: [{ id: 'velho-id' }] as Array<{ id: string }>,
  /** o que a busca devolve na 2ª vez (depois de perder a corrida) */
  existenteDepois: undefined as Record<string, unknown> | null | undefined,
  buscas: 0,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      let chave = '';
      const q: any = {
        select: () => q, or: () => q, in: () => q, order: () => q, limit: () => q,
        eq: (_c: string, v: string) => { chave = v; return q; },
        maybeSingle: async () => {
          if (q.inserindo) return { data: { id: 'novo-id' }, error: null };
          if (tabela === 'system_state') {
            if (h.exp === 'erro') return { data: null, error: { message: 'x' } };
            return { data: h.exp === undefined || !chave.startsWith('pix_auto_exp:') ? null : { value: h.exp }, error: null };
          }
          if (tabela === 'asaas_pix_assinaturas') { h.buscas++; return { data: h.buscas > 1 && h.existenteDepois !== undefined ? h.existenteDepois : h.existente, error: null }; }
          return { data: null, error: null };
        },
        update: (valor: Record<string, unknown>) => { h.atualizacoes.push(valor); q.atualizando = true; return q; },
        insert: () => { q.inserindo = true; return q; },
        upsert: async (linha: { key: string; value: Record<string, unknown> }) => {
          if (h.falhasUpsert > 0 && linha.key.startsWith('pix_auto_exp:')) { h.falhasUpsert--; return { error: { message: 'caiu' } }; }
          h.upserts.push(linha); return { error: null };
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: q.atualizando ? h.linhasMudadas : null, error: null }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/cuponsService', () => ({ buscarCupomValido: async () => null, aplicarCupom: () => null }));
vi.mock('../services/asaas/asaasClient', () => ({
  asaasHabilitado: () => true,
  AsaasError: class extends Error {},
  asaasFetch: async (url: string, opts?: { body?: Record<string, any> }) => {
    if (url.startsWith('/customers?')) return { data: [{ id: 'cus_1' }] };
    if (url === '/pix/automatic/authorizations') {
      h.corpos.push(opts?.body ?? {});
      const r = h.respostas.shift();
      if (r instanceof Error || (r && typeof r === 'object' && 'erro' in (r as object))) throw (r as { erro: unknown }).erro ?? r;
      return r;
    }
    return {};
  },
}));

import { criarPixRecorrente } from '../services/asaas/pixRecorrenteService';
import { logger } from '../utils/logger';

const MIN = 60_000;
const H = 3_600_000;
const erroHttp = (status: number) => ({ erro: Object.assign(new Error(`HTTP ${status}`), { status }) });
const ok = (expirationDate?: string) => ({
  id: 'auth_1', status: 'CREATED', payload: '000201NOVO6304ABCD', encodedImage: 'img',
  immediateQrCode: { conciliationIdentifier: 'conc-1', ...(expirationDate ? { expirationDate } : {}) },
});
const criar = () => criarPixRecorrente({
  userId: null, email: 'ana@exemplo.com', nome: 'Ana', cpfCnpj: '12345678901', whatsapp: '34999990000', planKey: 'ilimitado', exigirAutomatico: true,
});

beforeEach(() => {
  h.existente = null; h.exp = undefined; h.upserts = []; h.atualizacoes = []; h.corpos = []; h.respostas = []; h.falhasUpsert = 0;
  h.linhasMudadas = [{ id: 'velho-id' }]; h.existenteDepois = undefined; h.buscas = 0;
  delete process.env.PIX_QR24H_DESDE;
  vi.mocked(logger.error).mockClear();
});

describe('A: o QR de 24 h', () => {
  it('pede 86400 s, grava a validade REAL do Asaas em pix_auto_exp:<contrato> e devolve expiraEm (ISO)', async () => {
    const expira = new Date(Date.now() + 24 * H - MIN).toISOString();
    h.respostas = [ok(expira)];
    const r = await criar();
    expect(h.corpos).toHaveLength(1);
    expect(h.corpos[0]!.immediateQrCode.expirationSeconds).toBe(86400);
    const gravado = h.upserts.find(u => u.key === `pix_auto_exp:${r.contractId}`);
    expect(gravado?.value).toMatchObject({ expira_em: expira, segundos: 86400, fallback: false });
    expect(r.expiraEm).toBe(expira);
    expect(r.status).toBe('pendente');
  });

  it('o Asaas devolve a data sem fuso (hora de Brasília): vale -03:00, não a do servidor', async () => {
    const alvo = new Date(Date.now() + 20 * H);
    const brt = new Date(alvo.getTime() - 3 * H).toISOString().slice(0, 19).replace('T', ' ');
    h.respostas = [ok(brt)];
    const r = await criar();
    expect(Math.abs(Date.parse(r.expiraEm!) - Date.parse(alvo.toISOString().slice(0, 19) + 'Z'))).toBeLessThan(2000);
  });

  it('sem a data na resposta: criação + 24 h, marcado como fallback', async () => {
    h.respostas = [ok()];
    const r = await criar();
    expect(Math.abs(Date.parse(r.expiraEm!) - (Date.now() + 24 * H))).toBeLessThan(5000);
    expect(h.upserts.find(u => u.key.startsWith('pix_auto_exp:'))?.value.fallback).toBe(true);
  });

  it.each([400, 422])('erro de VALIDAÇÃO (%i): repete UMA vez com 3600 e o mesmo contractId', async (status) => {
    h.respostas = [erroHttp(status), ok()];
    const r = await criar();
    expect(h.corpos.map(c => c.immediateQrCode.expirationSeconds)).toEqual([86400, 3600]);
    expect(h.corpos[1]!.contractId).toBe(h.corpos[0]!.contractId);
    expect(Math.abs(Date.parse(r.expiraEm!) - (Date.now() + H))).toBeLessThan(5000);
    expect(h.upserts.find(u => u.key.startsWith('pix_auto_exp:'))?.value).toMatchObject({ segundos: 3600, fallback: true });
  });

  it('o fallback também falha: sobe o erro (502) e não faz uma terceira tentativa', async () => {
    h.respostas = [erroHttp(422), erroHttp(422)];
    await expect(criar()).rejects.toMatchObject({ statusCode: 502 });
    expect(h.corpos).toHaveLength(2);
  });

  it.each([500, 502, 503, 401, 403, 429])('HTTP %i NÃO repete (a autorização pode ter sido criada)', async (status) => {
    h.respostas = [erroHttp(status), ok()];
    await expect(criar()).rejects.toBeTruthy();
    expect(h.corpos).toHaveLength(1);
  });

  it('timeout (erro sem status) NÃO repete', async () => {
    h.respostas = [{ erro: new Error('timeout') }, ok()];
    await expect(criar()).rejects.toBeTruthy();
    expect(h.corpos).toHaveLength(1);
  });
});

describe('A: o contrato pendente só vence pela data real', () => {
  const linha = (criadoHaMin: number) => ({
    id: 'velho-id', user_id: null, email: 'ana@exemplo.com', modo: 'automatico', authorization_id: 'auth_velho', subscription_id: null,
    contract_id: 'SD-VIP-VELHO', plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', qr_payload: '000201VELHO6304ABCD',
    ultimo_pagamento_em: null, proximo_vencimento: null, created_at: new Date(Date.now() - criadoHaMin * MIN).toISOString(),
  });

  it('QR de 24 h criado há 70 min: devolve o MESMO contrato (nada de segundo QR vivo) e o expiraEm dele', async () => {
    h.existente = linha(70);
    h.exp = { expira_em: new Date(Date.now() + 22 * H).toISOString() };
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(h.corpos).toHaveLength(0);
    expect(h.atualizacoes.some(u => u.status === 'expirado')).toBe(false);
    expect(Date.parse(r.expiraEm!)).toBeGreaterThan(Date.now() + 21 * H);
  });

  it('venceu há mais de 5 min pela data real: vira expirado e nasce outro', async () => {
    h.existente = linha(24 * 60 + 30);
    h.exp = { expira_em: new Date(Date.now() - 10 * MIN).toISOString() };
    h.respostas = [ok()];
    const r = await criar();
    expect(h.atualizacoes.some(u => u.status === 'expirado')).toBe(true);
    expect(r.contractId).not.toBe('SD-VIP-VELHO');
  });

  it('a leitura da validade falhou: vale NÃO vencido (devolver o QR vivo é seguro; expirar um vivo abriria dois)', async () => {
    h.existente = linha(24 * 60 + 30);
    h.exp = 'erro';
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(h.atualizacoes.some(u => u.status === 'expirado')).toBe(false);
    expect(h.corpos).toHaveLength(0);
  });

  it('contrato antigo (criado antes do corte, sem a chave): a regra velha de 60 + 5 min', async () => {
    process.env.PIX_QR24H_DESDE = new Date(Date.now() + 24 * H).toISOString();
    h.existente = linha(66);
    h.respostas = [ok()];
    const r = await criar();
    expect(r.contractId).not.toBe('SD-VIP-VELHO');
    h.existente = linha(40);
    h.corpos = [];
    expect((await criar()).contractId).toBe('SD-VIP-VELHO');
  });
});

describe('bloqueio 1: a chave pix_auto_exp que não gravou', () => {
  const linha = (criadoHaMin: number) => ({
    id: 'velho-id', user_id: null, email: 'ana@exemplo.com', modo: 'automatico', authorization_id: 'auth_velho', subscription_id: null,
    contract_id: 'SD-VIP-VELHO', plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', qr_payload: '000201VELHO6304ABCD',
    ultimo_pagamento_em: null, proximo_vencimento: null, created_at: new Date(Date.now() - criadoHaMin * MIN).toISOString(),
  });

  it('contrato criado DEPOIS do corte e SEM a chave vale 24 h: 70 min depois devolve o MESMO contrato, nunca abre um segundo QR', async () => {
    process.env.PIX_QR24H_DESDE = new Date(Date.now() - 24 * H).toISOString();
    h.existente = linha(70);
    h.exp = undefined;   // a gravação falhou: a chave não existe
    const r = await criar();
    expect(r.contractId).toBe('SD-VIP-VELHO');
    expect(h.corpos).toHaveLength(0);
    expect(h.atualizacoes.some(u => u.status === 'expirado')).toBe(false);
    // e o expiraEm devolvido é o do lado seguro: criação + 24 h
    expect(Math.abs(Date.parse(r.expiraEm!) - (Date.now() - 70 * MIN + 24 * H))).toBeLessThan(5000);
  });

  it('a gravação de pix_auto_exp falha uma vez: tenta DE NOVO e grava; cada falha vai para o log', async () => {
    h.respostas = [ok()];
    h.falhasUpsert = 1;
    const r = await criar();
    expect(h.upserts.some(u => u.key === `pix_auto_exp:${r.contractId}`)).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('asaas-pix', expect.stringContaining('NÃO gravou (tentativa 1)'), expect.anything());
  });

  it('falha duas vezes: grita no log (PERDIDO) e o contrato nasce mesmo assim, valendo a regra do corte', async () => {
    h.respostas = [ok()];
    h.falhasUpsert = 2;
    const r = await criar();
    expect(r.status).toBe('pendente');
    expect(h.upserts.some(u => u.key.startsWith('pix_auto_exp:'))).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('asaas-pix', expect.stringContaining('PERDIDO depois de 2 tentativas'));
  });
});

describe('opcional: a corrida do expirado (só quem mudou exatamente 1 linha cria o contrato novo)', () => {
  const linha = {
    id: 'velho-id', user_id: null, email: 'ana@exemplo.com', modo: 'automatico', authorization_id: 'auth_velho', subscription_id: null,
    contract_id: 'SD-VIP-VELHO', plano: 'ilimitado', valor: 67, primeiro_mes: 67, cupom: null, status: 'pendente', qr_payload: '000201VELHO6304ABCD',
    ultimo_pagamento_em: null, proximo_vencimento: null, created_at: new Date(Date.now() - 30 * H).toISOString(),
  };
  beforeEach(() => { h.existente = linha; h.exp = { expira_em: new Date(Date.now() - H).toISOString() }; });

  it('1 linha mudou: este é o dono do contrato novo', async () => {
    h.respostas = [ok()];
    const r = await criar();
    expect(h.corpos).toHaveLength(1);
    expect(r.contractId).not.toBe('SD-VIP-VELHO');
  });

  it('0 linhas mudaram (outra chamada expirou primeiro): NÃO cria nada e devolve o contrato novo da outra chamada', async () => {
    h.linhasMudadas = [];
    h.existenteDepois = { ...linha, id: 'novo-da-outra', contract_id: 'SD-VIP-DA-OUTRA', created_at: new Date().toISOString(), qr_payload: '000201OUTRA6304ABCD' };
    const r = await criar();
    expect(h.corpos).toHaveLength(0);   // nenhuma autorização nova no Asaas
    expect(r.contractId).toBe('SD-VIP-DA-OUTRA');
  });

  it('0 linhas mudaram e nada existe agora: erro passageiro, nunca cria às cegas', async () => {
    h.linhasMudadas = [];
    h.existenteDepois = null;
    await expect(criar()).rejects.toMatchObject({ statusCode: 503 });
    expect(h.corpos).toHaveLength(0);
  });
});
