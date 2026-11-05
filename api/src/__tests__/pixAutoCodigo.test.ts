import { describe, it, expect, vi, beforeEach } from 'vitest';

// O código do Pix automático na conversa (E) e a criação do código novo (B), 05/11/2026. Dependências falsas: nada toca banco, Asaas ou rede.

const h = vi.hoisted(() => ({
  criacoes: [] as Array<Record<string, any>>,
  retornoCriar: null as null | Record<string, any>,
  linhasPagas: [] as Array<Record<string, unknown>>,
  atribuicao: null as null | Record<string, unknown>,
  filtroOr: '' as string,
  abandonados: [] as Array<Record<string, unknown>>,
  usuarios: [] as Array<Record<string, unknown>>,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        select: () => q, eq: () => q, limit: () => q, filter: () => q,
        or: (f: string) => { h.filtroOr = f; return q; },
        maybeSingle: async () => ({ data: tabela === 'system_state' ? (h.atribuicao ? { value: h.atribuicao } : null) : tabela === 'users' ? { id: 'u-1' } : null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({
          data: tabela === 'abandoned_checkouts' ? h.abandonados : tabela === 'users' ? h.usuarios : h.linhasPagas, error: null,
        }).then(ok),
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/asaas/pixRecorrenteService', () => ({
  soDigitos: (v: string | null | undefined) => (v || '').replace(/\D/g, ''),
  criarPixRecorrente: async (a: Record<string, any>) => { h.criacoes.push(a); if (h.retornoCriar instanceof Error) throw h.retornoCriar; return h.retornoCriar; },
}));

import {
  cpfValido, extrairCpf, extrairEmail, resolverPixConversa, gerarCodigoNovo, pagouCpfOuEmail, contratoFoiPago, codigoDeEnsaio,
  identidadePorTelefone, chaveTelefoneDdd8, erroEhPermanente, CodigoNovoPermanente,
  type DepsPixConversa, type ContratoBase,
} from '../services/solardoc/pixAutoCodigo';
import { hmacDoPagamento } from '../services/solardoc/marcaPagamentoQuiz';
import { situacaoDaConta } from '../utils/clientePagante';
import { pixValidoComoPeca } from '../services/agentes5040/vivoEnvio';

const MIN = 60_000;
const H = 3_600_000;
const AGORA = new Date('2026-11-04T15:00:00.000Z');
const TEL = '5534991230001';
const CPF = '52998224725';   // CPF de teste com dígitos verificadores corretos
const CODIGO_VELHO = '000201VELHO6304AAAA';
const CODIGO_NOVO = '000201NOVO6304BBBB';
const iso = (ms: number): string => new Date(ms).toISOString();

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  h.criacoes = []; h.retornoCriar = null; h.linhasPagas = []; h.atribuicao = null; h.filtroOr = ''; h.abandonados = []; h.usuarios = [];
});

const contrato = (over: Partial<ContratoBase> = {}): ContratoBase => ({
  contract_id: 'SD-VIP-1', user_id: null, email: 'ana@exemplo.com', cpf_cnpj: CPF, plano: 'ilimitado', cupom: null, status: 'pendente',
  created_at: iso(AGORA.getTime() - 3 * H), qr_payload: CODIGO_VELHO, modo: 'automatico', ultimo_pagamento_em: null, ultimo_pagamento_id: null,
  expira_em: iso(AGORA.getTime() + 21 * H), ...over,
});

interface Estado {
  marca: { contratoId: string; nome: string | null; email: string | null } | null | 'erro';
  contratos: Record<string, ContratoBase>;
  conversa: { contractId: string; em: string } | null | 'erro';
  pagou: boolean;
  identidade: { email: string; nome: string | null; userId: string | null } | null;
  falhaCriar: boolean;
  pagante: 'vigente' | 'tolerancia' | 'prospect' | 'erro';
  criados: string[]; reservas: Array<{ contractId: string; trocar: boolean }>; apagou: number; marcaMovida: Array<[string, string]>;
}
function falsas(over: Partial<Estado> = {}): { d: DepsPixConversa; s: Estado } {
  const s: Estado = {
    marca: { contratoId: 'SD-VIP-1', nome: 'Ana', email: 'ana@exemplo.com' }, contratos: { 'SD-VIP-1': contrato() }, conversa: null, pagou: false,
    identidade: { email: 'ana@exemplo.com', nome: 'Ana', userId: null }, falhaCriar: false, pagante: 'prospect', criados: [], reservas: [], apagou: 0, marcaMovida: [], ...over,
  };
  const novoCriado = { contractId: 'SD-VIP-NOVO', qrPayload: CODIGO_NOVO, expiraEm: iso(AGORA.getTime() + 24 * H) };
  const d: DepsPixConversa = {
    agora: () => AGORA,
    marca: async () => s.marca,
    contrato: async (id) => s.contratos[id] ?? null,
    pagouCpfOuEmail: async () => s.pagou,
    contaPagante: async () => s.pagante,
    conversa: async () => s.conversa,
    reservarConversa: async (_h, v, trocar) => { s.reservas.push({ contractId: v.contractId, trocar }); s.conversa = { contractId: v.contractId, em: v.em }; return 'ok'; },
    atualizarConversa: async (_h, contractId) => {
      s.conversa = { contractId, em: AGORA.toISOString() };
      s.contratos[contractId] = contrato({ contract_id: contractId, qr_payload: CODIGO_NOVO, created_at: AGORA.toISOString(), expira_em: novoCriado.expiraEm });
    },
    apagarConversa: async () => { s.apagou++; s.conversa = null; },
    gerarNovo: async () => { if (s.falhaCriar) throw new Error('asaas fora'); s.criados.push('antigo'); return novoCriado; },
    criarComCpf: async () => { if (s.falhaCriar) throw new Error('asaas fora'); s.criados.push('cpf'); return novoCriado; },
    identidade: async () => s.identidade,
    moverMarca: async (_h, antigo, novo) => { s.marcaMovida.push([antigo, novo]); return true; },
  };
  return { d, s };
}
const pedir = (d: DepsPixConversa, texto = 'quero pagar no pix', extra: Record<string, unknown> = {}) => resolverPixConversa({ tel: TEL, nome: 'Ana', textoDoLead: texto, ...extra }, d);

describe('CPF e e-mail em texto livre', () => {
  it('valida os dígitos verificadores e rejeita repetidos', () => {
    expect(cpfValido(CPF)).toBe(true);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224726')).toBe(false);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });
  it('extrai o primeiro CPF válido do texto, com ou sem pontos; telefone e CNPJ não passam', () => {
    expect(extrairCpf(`meu cpf é ${CPF}, obrigado`)).toBe(CPF);
    expect(extrairCpf('cpf: 529.982.247-25')).toBe(CPF);
    expect(extrairCpf('34991230001')).toBeNull();
    expect(extrairCpf('12.345.678/0001-95')).toBeNull();
    expect(extrairCpf('quero pagar no pix')).toBeNull();
    expect(extrairCpf(null)).toBeNull();
  });
  it('extrai o e-mail', () => {
    expect(extrairEmail('é Ana@Exemplo.com.br ok')).toBe('ana@exemplo.com.br');
    expect(extrairEmail('sem')).toBeNull();
  });
});

describe('E: o marcador de Pix automático na conversa', () => {
  it('código vivo (2 h ou mais sobrando): reenvia o MESMO, sem criar nada', async () => {
    const { d, s } = falsas();
    const r = await pedir(d);
    expect(r).toEqual({ tipo: 'codigo', codigo: CODIGO_VELHO, validadeMs: AGORA.getTime() + 21 * H, novo: false });
    expect(s.criados).toHaveLength(0);
    expect(s.reservas).toHaveLength(0);
  });

  it('código vencido: cria um novo (mesma regra do B), reserva 1 por conversa e a marca passa a apontar para o novo', async () => {
    const { d, s } = falsas({ contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - 20 * MIN) }) } });
    const r = await pedir(d);
    expect(r).toMatchObject({ tipo: 'codigo', codigo: CODIGO_NOVO, novo: true });
    expect(s.criados).toEqual(['antigo']);
    expect(s.reservas).toEqual([{ contractId: 'SD-VIP-1', trocar: false }]);
    expect(s.marcaMovida).toEqual([['SD-VIP-1', 'SD-VIP-NOVO']]);
  });

  it('pedido repetido dentro de 24 h reenvia o MESMO código vivo; a criação aconteceu uma vez só', async () => {
    const { d, s } = falsas({ contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - 20 * MIN) }) } });
    const primeiro = await pedir(d);
    const segundo = await pedir(d);
    const terceiro = await pedir(d, 'manda de novo o pix');
    expect(primeiro).toMatchObject({ codigo: CODIGO_NOVO, novo: true });
    expect(segundo).toMatchObject({ tipo: 'codigo', codigo: CODIGO_NOVO, novo: false });
    expect(terceiro).toMatchObject({ tipo: 'codigo', codigo: CODIGO_NOVO, novo: false });
    expect(s.criados).toHaveLength(1);
  });

  it('o código novo da conversa venceu e passaram menos de 24 h: NÃO cria outro (limite de 1 por conversa em 24 h), responde com o link', async () => {
    const { d, s } = falsas({
      conversa: { contractId: 'SD-VIP-NOVO', em: iso(AGORA.getTime() - 3 * H) },
      contratos: { 'SD-VIP-NOVO': contrato({ contract_id: 'SD-VIP-NOVO', expira_em: iso(AGORA.getTime() - 30 * MIN) }) },
    });
    expect(await pedir(d)).toEqual({ tipo: 'link' });   // sem código novo dentro das 24 h; o link do Pix automático segue valendo
    expect(s.criados).toHaveLength(0);
  });

  it('depois de 24 h o código novo pode vir de novo (a reserva velha é trocada)', async () => {
    const { d, s } = falsas({
      conversa: { contractId: 'SD-VIP-NOVO', em: iso(AGORA.getTime() - 25 * H) },
      contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - 26 * H) }) },
      marca: { contratoId: 'SD-VIP-1', nome: 'Ana', email: 'ana@exemplo.com' },
    });
    const r = await pedir(d);
    expect(r).toMatchObject({ tipo: 'codigo', novo: true });
    expect(s.reservas).toEqual([{ contractId: 'SD-VIP-1', trocar: true }]);
  });

  it('código vivo com MENOS de 30 min: não cria outro (seria um segundo QR vivo) e diz até que horas vale; vencido na folga: link; passada a folga de 5 min cria', async () => {
    const ate = AGORA.getTime() + 10 * MIN;
    const { d: d1, s: s1 } = falsas({ contratos: { 'SD-VIP-1': contrato({ expira_em: iso(ate) }) } });
    expect(await pedir(d1)).toEqual({ tipo: 'aguardar', ateMs: ate });
    expect(s1.criados).toHaveLength(0);
    expect(s1.reservas).toHaveLength(0);
    const { d: d2, s: s2 } = falsas({ contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - 4 * MIN) }) } });
    expect(await pedir(d2)).toEqual({ tipo: 'link' });
    expect(s2.criados).toHaveLength(0);
    const { d: d3, s: s3 } = falsas({ contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - 6 * MIN) }) } });
    expect(await pedir(d3)).toMatchObject({ tipo: 'codigo', novo: true });
    expect(s3.criados).toHaveLength(1);
  });

  it('já pagou (contrato ou outro do mesmo CPF/e-mail): nada é criado', async () => {
    const a = falsas({ pagou: true, contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) } });
    expect(await pedir(a.d)).toEqual({ tipo: 'ja_pagou' });
    expect(a.s.criados).toHaveLength(0);
    const b = falsas({ contratos: { 'SD-VIP-1': contrato({ status: 'ativo' }) } });
    expect(await pedir(b.d)).toEqual({ tipo: 'ja_pagou' });
  });

  it('falha do Asaas: cai no link (nunca inventa código), libera a reserva e a marca não anda', async () => {
    const { d, s } = falsas({ falhaCriar: true, contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) } });
    expect(await pedir(d)).toEqual({ tipo: 'link' });
    expect(s.apagou).toBe(1);
    expect(s.marcaMovida).toHaveLength(0);
  });

  it('sem contrato e sem CPF: a agente PEDE o CPF (resposta, nada é criado)', async () => {
    const { d, s } = falsas({ marca: null });
    expect(await pedir(d)).toEqual({ tipo: 'pedir_cpf' });
    expect(s.criados).toHaveLength(0);
    expect(s.reservas).toHaveLength(0);
  });

  it('a pessoa manda o CPF: cria com ele e devolve o código novo', async () => {
    const { d, s } = falsas({ marca: null });
    const r = await pedir(d, `meu cpf é ${CPF}`);
    expect(r).toMatchObject({ tipo: 'codigo', codigo: CODIGO_NOVO, novo: true });
    expect(s.criados).toEqual(['cpf']);
  });

  it('CPF inválido não vale (pede de novo); sem e-mail conhecido cai no link; o e-mail pode vir no mesmo texto', async () => {
    const a = falsas({ marca: null });
    expect(await pedir(a.d, 'meu cpf é 52998224726')).toEqual({ tipo: 'pedir_cpf' });
    const b = falsas({ marca: null, identidade: null });
    expect(await pedir(b.d, `cpf ${CPF}`)).toEqual({ tipo: 'link' });
    const c = falsas({ marca: null, identidade: null });
    expect(await pedir(c.d, `cpf ${CPF} e o e-mail é ana@exemplo.com`)).toMatchObject({ tipo: 'codigo', novo: true });
  });

  it('telefone ilegível ou leitura que falha: o link (o Pix automático segue valendo)', async () => {
    const { d } = falsas({ marca: 'erro' });
    expect(await pedir(d)).toEqual({ tipo: 'link' });
    const x = falsas({ conversa: 'erro' });
    expect(await pedir(x.d)).toEqual({ tipo: 'link' });
    expect(await resolverPixConversa({ tel: 'abc' }, x.d)).toEqual({ tipo: 'link' });
  });

  it('rodada seca (dry): nada é criado nem reservado, e o código de ensaio é um BR Code sintático que nunca é enviado', async () => {
    const { d, s } = falsas({ contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) } });
    const r = await pedir(d, 'quero pix', { dry: true });
    expect(r).toMatchObject({ tipo: 'codigo', novo: true });
    expect(s.criados).toHaveLength(0);
    expect(s.reservas).toHaveLength(0);
    expect(codigoDeEnsaio().startsWith('000201')).toBe(true);
    expect(pixValidoComoPeca(codigoDeEnsaio())).toBe(true);
  });

  it('o hmac da conversa é o do telefone (a marca quiz_pagto é por ele)', () => {
    expect(hmacDoPagamento(TEL)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('B: gerarCodigoNovo confere o que o criador devolve', () => {
  const retorno = (over: Record<string, any> = {}) => ({
    contractId: 'SD-VIP-NOVO', status: 'pendente', qrPayload: CODIGO_NOVO, expiraEm: iso(Date.now() + 23 * H), ...over,
  });

  it('chama o criador com o CPF e o e-mail do contrato antigo, só automático, com a atribuição (rota publica e whatsapp)', async () => {
    h.retornoCriar = retorno();
    h.atribuicao = { origem: 'lp_solardoc', utm_term: 'conj1', rota: 'publica' };
    const r = await gerarCodigoNovo({ antigo: contrato({ user_id: 'u1', cupom: 'ACESSO' }), nome: 'Ana', tel: TEL });
    expect(r.contractId).toBe('SD-VIP-NOVO');
    expect(h.criacoes[0]).toMatchObject({
      userId: 'u1', email: 'ana@exemplo.com', cpfCnpj: CPF, planKey: 'ilimitado', cupom: 'ACESSO', exigirAutomatico: true, whatsapp: TEL,
      atribuicao: { origem: 'lp_solardoc', utm_term: 'conj1', rota: 'publica', whatsapp: TEL },
    });
  });

  it('sem atribuição antiga: rota publica e o telefone mesmo assim', async () => {
    h.retornoCriar = retorno();
    await gerarCodigoNovo({ antigo: contrato(), nome: null, tel: TEL });
    expect(h.criacoes[0]!.atribuicao).toEqual({ rota: 'publica', whatsapp: TEL });
  });

  it.each([
    ['o mesmo contrato (o criador não achou o antigo vencido)', { contractId: 'SD-VIP-1' }],
    ['contrato que não é pendente (já ativo: pagou)', { status: 'ativo' }],
    ['sem copia e cola', { qrPayload: null }],
    ['código que não é Pix', { qrPayload: 'https://x' }],
    ['validade no passado', { expiraEm: iso(Date.now() - H) }],
    ['sem validade', { expiraEm: null }],
  ])('LANÇA com %s (o robô vira releitura e nada sai)', async (_nome, over) => {
    h.retornoCriar = retorno(over as Record<string, any>);
    await expect(gerarCodigoNovo({ antigo: contrato(), nome: 'Ana', tel: TEL })).rejects.toThrow();
  });
});

describe('B: "estado primeiro, mensagem depois"', () => {
  it('pagouCpfOuEmail olha TODOS os contratos do CPF ou e-mail, não só o mais novo', async () => {
    h.linhasPagas = [{ status: 'expirado', ultimo_pagamento_em: null, ultimo_pagamento_id: null }, { status: 'ativo', ultimo_pagamento_em: null, ultimo_pagamento_id: null }];
    expect(await pagouCpfOuEmail(CPF, 'Ana@Exemplo.com')).toBe(true);
    expect(h.filtroOr).toBe(`cpf_cnpj.eq.${CPF},email.eq.ana@exemplo.com`);
    h.linhasPagas = [{ status: 'pendente', ultimo_pagamento_em: null, ultimo_pagamento_id: null }, { status: 'expirado', ultimo_pagamento_em: null, ultimo_pagamento_id: null }];
    expect(await pagouCpfOuEmail(CPF, 'ana@exemplo.com')).toBe(false);
    h.linhasPagas = [{ status: 'cancelado', ultimo_pagamento_em: '2026-10-01T00:00:00Z', ultimo_pagamento_id: null }];
    expect(await pagouCpfOuEmail(CPF, 'ana@exemplo.com')).toBe(true);
    expect(contratoFoiPago({ status: 'pendente', ultimo_pagamento_em: null, ultimo_pagamento_id: 'pay_1', created_at: null })).toBe(true);
  });
});

describe('opcional: pedido repetido na conversa só reenvia o código com 30 min ou mais sobrando', () => {
  it('20 min sobrando: aguarda (com a hora); 40 min: reenvia o mesmo', async () => {
    const mk = (min: number) => falsas({
      conversa: { contractId: 'SD-VIP-NOVO', em: iso(AGORA.getTime() - 2 * H) },
      contratos: { 'SD-VIP-NOVO': contrato({ contract_id: 'SD-VIP-NOVO', qr_payload: CODIGO_NOVO, expira_em: iso(AGORA.getTime() + min * MIN) }) },
    });
    const a = mk(20);
    expect(await pedir(a.d)).toEqual({ tipo: 'aguardar', ateMs: AGORA.getTime() + 20 * MIN });
    const b = mk(40);
    expect(await pedir(b.d)).toMatchObject({ tipo: 'codigo', codigo: CODIGO_NOVO, novo: false });
    expect(a.s.criados).toHaveLength(0);
    expect(b.s.criados).toHaveLength(0);
  });
});

describe('bloqueio 3: cliente com plano VIGENTE nunca recebe código (cobrança dobrada)', () => {
  it('contrato antigo vencido + conta com plano vigente: ja_pagou, nada criado, nada reservado', async () => {
    const { d, s } = falsas({ pagante: 'vigente', contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) } });
    expect(await pedir(d)).toEqual({ tipo: 'ja_pagou' });
    expect(s.criados).toHaveLength(0);
    expect(s.reservas).toHaveLength(0);
  });
  it('mesmo com o código vivo: não reenvia o código a quem já paga', async () => {
    const { d, s } = falsas({ pagante: 'vigente' });
    expect(await pedir(d)).toEqual({ tipo: 'ja_pagou' });
    expect(s.criados).toHaveLength(0);
  });
  it('sem contrato (CPF + e-mail da identidade): também confere a conta antes de criar', async () => {
    const { d, s } = falsas({ marca: null, pagante: 'vigente' });
    expect(await pedir(d, `meu cpf ${CPF}`)).toEqual({ tipo: 'ja_pagou' });
    expect(s.criados).toHaveLength(0);
  });
  it('no passo do código novo da conversa também', async () => {
    const { d } = falsas({
      pagante: 'vigente', conversa: { contractId: 'SD-VIP-NOVO', em: iso(AGORA.getTime() - H) },
      contratos: { 'SD-VIP-NOVO': contrato({ contract_id: 'SD-VIP-NOVO', qr_payload: CODIGO_NOVO }) },
    });
    expect(await pedir(d)).toEqual({ tipo: 'ja_pagou' });
  });
  it('plano VENCIDO (dentro dos 30 dias de tolerância): NÃO diz "já liberada" e NÃO cria código; devolve o link (a página do Pix tem a própria trava)', async () => {
    for (const marca of [true, false]) {
      const { d, s } = falsas({
        pagante: 'tolerancia', ...(marca ? {} : { marca: null }),
        contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) },
      });
      expect(await pedir(d, `meu cpf ${CPF}`)).toEqual({ tipo: 'link' });
      expect(s.criados).toHaveLength(0);
      expect(s.reservas).toHaveLength(0);
    }
    const reuso = falsas({ pagante: 'tolerancia' });   // até o código vivo deixa de ser reenviado
    expect(await pedir(reuso.d)).toEqual({ tipo: 'link' });
  });
  it('conta free (prospect): segue o fluxo normal de código', async () => {
    const { d, s } = falsas({ pagante: 'prospect', contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) } });
    expect(await pedir(d)).toMatchObject({ tipo: 'codigo', novo: true });
    expect(s.criados).toHaveLength(1);
  });
  it('não deu para conferir a conta: o link, nunca um código às cegas', async () => {
    const { d, s } = falsas({ pagante: 'erro', contratos: { 'SD-VIP-1': contrato({ expira_em: iso(AGORA.getTime() - H) }) } });
    expect(await pedir(d)).toEqual({ tipo: 'link' });
    expect(s.criados).toHaveLength(0);
  });
});

describe('bloqueio 4: "já pagou" só com a regra corrigida', () => {
  it('contrato `inadimplente` ou `cancelado` com pagamento ANTIGO não é "já pagou": a pessoa ganha o código', async () => {
    for (const status of ['inadimplente', 'cancelado']) {
      const antigo = contrato({ status, expira_em: iso(AGORA.getTime() - H), created_at: iso(AGORA.getTime() - 30 * H), ultimo_pagamento_em: iso(AGORA.getTime() - 90 * 24 * H) });
      expect(contratoFoiPago(antigo)).toBe(false);
    }
    const { d, s } = falsas({ contratos: { 'SD-VIP-1': contrato({ status: 'expirado', expira_em: iso(AGORA.getTime() - H), created_at: iso(AGORA.getTime() - 30 * H), ultimo_pagamento_em: iso(AGORA.getTime() - 90 * 24 * H) }) } });
    expect(await pedir(d)).toMatchObject({ tipo: 'codigo', novo: true });
    expect(s.criados).toHaveLength(1);
  });
  it('pagamento DEPOIS da criação do contrato conta; `ativo` conta', () => {
    expect(contratoFoiPago(contrato({ status: 'inadimplente', ultimo_pagamento_em: iso(AGORA.getTime() - H) }))).toBe(true);
    expect(contratoFoiPago(contrato({ status: 'ativo' }))).toBe(true);
  });
  it('pagouCpfOuEmail: outro contrato do mesmo CPF `inadimplente`/`cancelado` pago ANTES do contrato recuperado não conta; depois, conta', async () => {
    const desde = iso(AGORA.getTime() - 3 * H);
    h.linhasPagas = [
      { status: 'inadimplente', ultimo_pagamento_em: iso(AGORA.getTime() - 60 * 24 * H), ultimo_pagamento_id: null },
      { status: 'cancelado', ultimo_pagamento_em: iso(AGORA.getTime() - 30 * 24 * H), ultimo_pagamento_id: 'pay_antigo' },
    ];
    expect(await pagouCpfOuEmail(CPF, 'ana@exemplo.com', desde)).toBe(false);
    h.linhasPagas = [...h.linhasPagas, { status: 'cancelado', ultimo_pagamento_em: iso(AGORA.getTime() - H), ultimo_pagamento_id: null }];
    expect(await pagouCpfOuEmail(CPF, 'ana@exemplo.com', desde)).toBe(true);
    h.linhasPagas = [{ status: 'ativo', ultimo_pagamento_em: null, ultimo_pagamento_id: null }];
    expect(await pagouCpfOuEmail(CPF, 'ana@exemplo.com', desde)).toBe(true);
  });
});

describe('bloqueio 2: a identidade pelo telefone casa DDD + 8 dígitos e exige EXATAMENTE uma pessoa', () => {
  it('a chave é DDD + 8 últimos (tira o 55, ignora o 9º dígito)', () => {
    expect(chaveTelefoneDdd8('5534991230001')).toBe('3491230001');
    expect(chaveTelefoneDdd8('(34) 99123-0001')).toBe('3491230001');
    expect(chaveTelefoneDdd8('34 9123-0001')).toBe('3491230001');
    expect(chaveTelefoneDdd8('123')).toBeNull();
  });
  it('uma pessoa só (checkout + conta com o mesmo e-mail): usa e traz o user_id', async () => {
    h.abandonados = [{ email: 'Ana@Exemplo.com', nome: 'Ana', phone: '5534991230001' }];
    h.usuarios = [{ id: 'u-9', email: 'ana@exemplo.com', nome: 'Ana S', whatsapp: '34991230001' }];
    expect(await identidadePorTelefone(TEL)).toEqual({ email: 'ana@exemplo.com', nome: 'Ana S', userId: 'u-9' });
  });
  it('DOIS resultados (e-mails diferentes pelo mesmo telefone): não usa nenhum, não chuta', async () => {
    h.abandonados = [{ email: 'ana@exemplo.com', nome: 'Ana', phone: '5534991230001' }];
    h.usuarios = [{ id: 'u-2', email: 'outra@exemplo.com', nome: 'Outra', whatsapp: '34991230001' }];
    expect(await identidadePorTelefone(TEL)).toBeNull();
    h.usuarios = []; h.abandonados = [
      { email: 'a@exemplo.com', nome: 'A', phone: '5534991230001' }, { email: 'b@exemplo.com', nome: 'B', phone: '34991230001' },
    ];
    expect(await identidadePorTelefone(TEL)).toBeNull();
  });
  it('ZERO resultados, ou só quem tem os mesmos 8 últimos dígitos em OUTRO DDD: null', async () => {
    expect(await identidadePorTelefone(TEL)).toBeNull();
    h.abandonados = [{ email: 'x@exemplo.com', nome: 'X', phone: '5511991230001' }];   // mesmos 8 dígitos, DDD 11
    h.usuarios = [{ id: 'u-3', email: 'y@exemplo.com', nome: 'Y', whatsapp: '(21) 99123-0001' }];
    expect(await identidadePorTelefone(TEL)).toBeNull();
  });
  it('o mesmo e-mail repetido em várias linhas é UMA pessoa', async () => {
    h.abandonados = [{ email: 'ana@exemplo.com', nome: 'Ana', phone: '5534991230001' }, { email: 'ANA@exemplo.com', nome: 'Ana', phone: '34991230001' }];
    expect((await identidadePorTelefone(TEL))?.email).toBe('ana@exemplo.com');
  });
  it('no resolver: identidade ambígua (null) + CPF sem e-mail no texto = link; com e-mail no texto, cria', async () => {
    const a = falsas({ marca: null, identidade: null });
    expect(await pedir(a.d, `cpf ${CPF}`)).toEqual({ tipo: 'link' });
    expect(a.s.criados).toHaveLength(0);
    const b = falsas({ marca: null, identidade: null });
    expect(await pedir(b.d, `cpf ${CPF}, e-mail ana@exemplo.com`)).toMatchObject({ tipo: 'codigo' });
  });
});

describe('bloqueio 6: erro permanente x passageiro no código novo', () => {
  const retorno = (over: Record<string, any> = {}) => ({ contractId: 'SD-VIP-NOVO', status: 'pendente', qrPayload: CODIGO_NOVO, expiraEm: iso(Date.now() + 23 * H), ...over });
  it('4xx do Asaas (400, 422, 404) é PERMANENTE; 408, 429, 5xx e erro sem status NÃO', async () => {
    for (const [status, permanente] of [[400, true], [422, true], [404, true], [408, false], [429, false], [500, false], [503, false], [0, false]] as Array<[number, boolean]>) {
      h.retornoCriar = Object.assign(new Error('asaas'), { asaasStatus: status });
      h.criacoes = [];
      const erro = await gerarCodigoNovo({ antigo: contrato(), nome: 'Ana', tel: TEL }).catch((e: unknown) => e);
      expect(erroEhPermanente(erro), `status ${status}`).toBe(permanente);
    }
  });
  it('mesmo_contrato, status que não é pendente, sem código e sem validade: permanentes', async () => {
    for (const over of [{ contractId: 'SD-VIP-1' }, { status: 'ativo' }, { qrPayload: null }, { expiraEm: iso(Date.now() - H) }]) {
      h.retornoCriar = retorno(over);
      const erro = await gerarCodigoNovo({ antigo: contrato(), nome: 'Ana', tel: TEL }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(CodigoNovoPermanente);
      expect(erroEhPermanente(erro)).toBe(true);
    }
  });
});

describe('situacaoDaConta: vigente, tolerância e prospect', () => {
  const dia = 24 * H;
  const agoraMs = AGORA.getTime();
  it('vigente = plano != free E plano_expira_em no futuro', () => {
    expect(situacaoDaConta({ plano: 'ilimitado', plano_expira_em: iso(agoraMs + 5 * dia) }, agoraMs)).toBe('vigente');
  });
  it('vencido há 10 dias (ou plano sem data): tolerância, NÃO vigente', () => {
    expect(situacaoDaConta({ plano: 'ilimitado', plano_expira_em: iso(agoraMs - 10 * dia) }, agoraMs)).toBe('tolerancia');
    expect(situacaoDaConta({ plano: 'ilimitado', plano_expira_em: null }, agoraMs)).toBe('tolerancia');
    expect(situacaoDaConta({ plano: 'free', plano_expira_em: iso(agoraMs - 10 * dia) }, agoraMs)).toBe('tolerancia');
  });
  it('free sem data, vencido há mais de 30 dias e sem conta: prospect', () => {
    expect(situacaoDaConta({ plano: 'free', plano_expira_em: null }, agoraMs)).toBe('prospect');
    expect(situacaoDaConta({ plano: 'ilimitado', plano_expira_em: iso(agoraMs - 40 * dia) }, agoraMs)).toBe('tolerancia');   // plano != free sempre é cliente pela régua do /publico
    expect(situacaoDaConta({ plano: 'free', plano_expira_em: iso(agoraMs - 40 * dia) }, agoraMs)).toBe('prospect');
    expect(situacaoDaConta(null, agoraMs)).toBe('prospect');
  });
});
