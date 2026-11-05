import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/cuponsService', () => ({ buscarCupomValido: async () => null, aplicarCupom: () => null }));
vi.mock('../services/asaas/asaasClient', () => ({ asaasHabilitado: () => true, AsaasError: class extends Error {}, asaasFetch: async () => ({}) }));

// A validade REAL do código do Pix automático (05/11/2026): data do Asaas, fallback, vencimento para troca, fase da recuperação e "até quando vale" por extenso.
// Regras puras: nada aqui toca banco, Asaas ou relógio.

import {
  normalizarExpiracao, expiracaoParaGravar, validadeDoCodigoMs, restanteDoCodigoMs, codigoVencidoParaTroca, codigoReenviavel, validadePorExtenso,
  FOLGA_VENCIMENTO_MS, QR_SEGUNDOS_PADRAO, QR_SEGUNDOS_FALLBACK, QR24H_DESDE_PADRAO, horaCurtaBRT, pagamentoValeDesde,
} from '../services/asaas/pixAutoValidade';
import { faseDoCodigo } from '../services/solardoc/recuperacaoCarlaRegras';
import { contratoPendenteVencido, CONTRATO_PENDENTE_VALE_MS } from '../services/asaas/pixRecorrenteService';

const H = 3_600_000;
const MIN = 60_000;
// Quarta 04/11/2026, 12:00 em Brasília (15:00Z).
const AGORA = Date.parse('2026-11-04T15:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const CODIGO = '000201010212BR.GOV.BCB.PIX6304ABCD';

describe('normalizarExpiracao: o formato do expirationDate do Asaas', () => {
  it('com Z ou deslocamento vale como veio', () => {
    expect(normalizarExpiracao('2026-11-05T15:00:00Z')).toBe('2026-11-05T15:00:00.000Z');
    expect(normalizarExpiracao('2026-11-05T12:00:00-03:00')).toBe('2026-11-05T15:00:00.000Z');
    expect(normalizarExpiracao('2026-11-05T12:00:00-0300')).toBe('2026-11-05T15:00:00.000Z');
    expect(normalizarExpiracao('2026-11-05T18:00:00+03:00')).toBe('2026-11-05T15:00:00.000Z');
  });
  it('SEM fuso é hora de Brasília (-03:00), nunca a do servidor', () => {
    expect(normalizarExpiracao('2026-11-05 12:00:00')).toBe('2026-11-05T15:00:00.000Z');
    expect(normalizarExpiracao('2026-11-05T12:00:00')).toBe('2026-11-05T15:00:00.000Z');
    expect(normalizarExpiracao('2026-11-05 12:00')).toBe('2026-11-05T15:00:00.000Z');
  });
  it('ausente ou ilegível = null', () => {
    for (const x of [undefined, null, '', '   ', 'amanhã', 12345, '05/11/2026 12:00']) expect(normalizarExpiracao(x)).toBeNull();
  });
});

describe('expiracaoParaGravar: a data do Asaas ou a de criação mais os segundos que valeram', () => {
  it('data legível, futura e dentro de 25 h: é a do Asaas', () => {
    const r = expiracaoParaGravar(iso(AGORA + 24 * H), AGORA, QR_SEGUNDOS_PADRAO);
    expect(r).toEqual({ expira_em: iso(AGORA + 24 * H), fallback: false });
  });
  it('ausente, ilegível, no passado ou além de 25 h: criação + os segundos pedidos', () => {
    expect(expiracaoParaGravar(undefined, AGORA, QR_SEGUNDOS_PADRAO)).toEqual({ expira_em: iso(AGORA + 24 * H), fallback: true });
    expect(expiracaoParaGravar('lixo', AGORA, QR_SEGUNDOS_FALLBACK)).toEqual({ expira_em: iso(AGORA + H), fallback: true });
    expect(expiracaoParaGravar(iso(AGORA - H), AGORA, QR_SEGUNDOS_PADRAO).fallback).toBe(true);
    expect(expiracaoParaGravar(iso(AGORA + 30 * H), AGORA, QR_SEGUNDOS_PADRAO).fallback).toBe(true);
  });
  it('sem fuso e em Brasília: 3 h de diferença que não pode errar', () => {
    // 04/11 15:00Z = 12:00 BRT; o Asaas diz "2026-11-05 11:30:00" (11:30 BRT de amanhã) = 14:30Z, 23,5 h à frente.
    expect(expiracaoParaGravar('2026-11-05 11:30:00', AGORA, QR_SEGUNDOS_PADRAO)).toEqual({ expira_em: '2026-11-05T14:30:00.000Z', fallback: false });
  });
});

describe('a validade do contrato', () => {
  it('com a data gravada vale ela; contrato antigo (sem a chave) vale criação + 60 min', () => {
    expect(validadeDoCodigoMs({ created_at: iso(AGORA - 10 * MIN), expira_em: iso(AGORA + 5 * H) })).toBe(AGORA + 5 * H);
    expect(validadeDoCodigoMs({ created_at: iso(AGORA - 10 * MIN), expira_em: null })).toBe(AGORA + 50 * MIN);
    expect(validadeDoCodigoMs({ created_at: null, expira_em: null })).toBeNull();
  });
  it('só troca o contrato depois do vencimento real MAIS a folga de 5 min', () => {
    const c = { created_at: iso(AGORA - 30 * H), expira_em: iso(AGORA - 3 * MIN) };
    expect(codigoVencidoParaTroca(c, AGORA)).toBe(false);                       // venceu há 3 min: ainda na folga
    expect(codigoVencidoParaTroca(c, AGORA + 3 * MIN)).toBe(true);               // 6 min depois do vencimento
    expect(codigoVencidoParaTroca({ created_at: iso(AGORA), expira_em: iso(AGORA + 23 * H) }, AGORA)).toBe(false);
    expect(codigoVencidoParaTroca({ created_at: null, expira_em: null }, AGORA)).toBe(false);
  });
  it('vivo para reenviar = faltam 2 h ou mais', () => {
    expect(codigoReenviavel({ expira_em: iso(AGORA + 2 * H) }, AGORA)).toBe(true);
    expect(codigoReenviavel({ expira_em: iso(AGORA + 2 * H - 1) }, AGORA)).toBe(false);
    expect(restanteDoCodigoMs({ expira_em: iso(AGORA + H) }, AGORA)).toBe(H);
  });
  it('contratoPendenteVencido do serviço usa a data real; sem ela mantém os 60 + 5 min de antes', () => {
    expect(CONTRATO_PENDENTE_VALE_MS).toBe(65 * MIN);
    const base = { status: 'pendente', modo: 'automatico' };
    // QR de 24 h criado há 70 min: NÃO vencido (antes, pela regra dos 65 min, viraria expirado e abriria um segundo QR vivo).
    expect(contratoPendenteVencido({ ...base, created_at: iso(AGORA - 70 * MIN), expira_em: iso(AGORA + 23 * H) }, AGORA)).toBe(false);
    expect(contratoPendenteVencido({ ...base, created_at: iso(AGORA - 70 * MIN), expira_em: null }, AGORA)).toBe(true);
    expect(contratoPendenteVencido({ ...base, created_at: iso(AGORA - 30 * H), expira_em: iso(AGORA - H) }, AGORA)).toBe(true);
    expect(contratoPendenteVencido({ status: 'ativo', modo: 'automatico', created_at: iso(AGORA - 30 * H), expira_em: iso(AGORA - H) }, AGORA)).toBe(false);
    expect(contratoPendenteVencido({ status: 'pendente', modo: 'assinatura', created_at: iso(AGORA - 30 * H), expira_em: null }, AGORA)).toBe(false);
  });
});

describe('faseDoCodigo pela data REAL (não mais 55 e 65 min)', () => {
  const c = (expiraEmMs: number | null, extra: Record<string, unknown> = {}) => ({
    status: 'pendente', created_at: iso(AGORA - 5 * MIN), qr_payload: CODIGO, expira_em: expiraEmMs === null ? null : iso(expiraEmMs), ...extra,
  });
  it('faltam 2 h ou mais: código vivo (mesmo com o contrato criado há horas)', () => {
    expect(faseDoCodigo(c(AGORA + 23 * H), AGORA)).toBe('codigo');
    expect(faseDoCodigo(c(AGORA + 2 * H), AGORA)).toBe('codigo');
    expect(faseDoCodigo({ ...c(AGORA + 2 * H), created_at: iso(AGORA - 22 * H) }, AGORA)).toBe('codigo');
  });
  it('perto do fim (menos de 2 h) e até 5 min depois do vencimento: espera', () => {
    expect(faseDoCodigo(c(AGORA + 2 * H - 1), AGORA)).toBe('espera');
    expect(faseDoCodigo(c(AGORA + 10 * MIN), AGORA)).toBe('espera');
    expect(faseDoCodigo(c(AGORA - 4 * MIN), AGORA)).toBe('espera');
  });
  it('vencido (passou a folga): vai para o código novo', () => {
    expect(faseDoCodigo(c(AGORA - FOLGA_VENCIMENTO_MS - 1), AGORA)).toBe('vencido');
    expect(faseDoCodigo(c(AGORA - 3 * H), AGORA)).toBe('vencido');
  });
  it('contrato `expirado` vai para o código novo; cancelado e outros status não são chamados', () => {
    expect(faseDoCodigo(c(AGORA + 20 * H, { status: 'expirado' }), AGORA)).toBe('vencido');
    expect(faseDoCodigo(c(AGORA + 20 * H, { status: 'cancelado' }), AGORA)).toBe('nada');
  });
  it('contrato antigo (sem a data): nunca tem 2 h sobrando, então espera até os 65 min e depois vai para o novo', () => {
    expect(faseDoCodigo(c(null, { created_at: iso(AGORA - 5 * MIN) }), AGORA)).toBe('espera');
    expect(faseDoCodigo(c(null, { created_at: iso(AGORA - 64 * MIN) }), AGORA)).toBe('espera');
    expect(faseDoCodigo(c(null, { created_at: iso(AGORA - 66 * MIN) }), AGORA)).toBe('vencido');
  });
  it('código que não é copia e cola de verdade (não começa em 000201) nunca é "vivo"', () => {
    expect(faseDoCodigo(c(AGORA + 23 * H, { qr_payload: 'https://exemplo' }), AGORA)).toBe('espera');
    expect(faseDoCodigo(c(AGORA + 23 * H, { qr_payload: null }), AGORA)).toBe('espera');
  });
  it('sem data de criação nem de validade: espera (nunca envia)', () => {
    expect(faseDoCodigo({ status: 'pendente', created_at: null, qr_payload: CODIGO, expira_em: null }, AGORA)).toBe('espera');
  });
});

describe('validadePorExtenso: hora de Brasília arredondada PARA BAIXO', () => {
  it('hoje, amanhã e outro dia', () => {
    // AGORA = 04/11 12:00 BRT
    expect(validadePorExtenso(Date.parse('2026-11-04T23:59:59-03:00'), AGORA)).toBe('até hoje às 23h');
    expect(validadePorExtenso(Date.parse('2026-11-05T21:40:00-03:00'), AGORA)).toBe('até amanhã às 21h');
    expect(validadePorExtenso(Date.parse('2026-11-08T09:05:00-03:00'), AGORA)).toBe('até 08/11 às 9h');
  });
  it('nunca arredonda para cima (21h59 é 21h)', () => {
    expect(validadePorExtenso(Date.parse('2026-11-05T21:59:59-03:00'), AGORA)).toBe('até amanhã às 21h');
  });
  it('o dia de Brasília manda, não o do servidor (01h30 BRT de amanhã = 04h30Z)', () => {
    expect(validadePorExtenso(Date.parse('2026-11-05T01:30:00-03:00'), AGORA)).toBe('até amanhã às 1h');
  });
});

describe('bloqueio 1: contrato SEM a chave pix_auto_exp (a gravação falhou) nunca reabre outro QR com o de 24 h pagável', () => {
  const corte = Date.parse(QR24H_DESDE_PADRAO);
  it('criado DEPOIS do corte e sem a chave: vale 24 h (e a folga na troca), não 60 min', () => {
    const criado = corte + 6 * H;
    expect(validadeDoCodigoMs({ created_at: iso(criado), expira_em: null })).toBe(criado + 24 * H);
    // 70 min depois: o QR de 24 h está pagável, então o contrato NÃO pode ser trocado
    expect(codigoVencidoParaTroca({ created_at: iso(criado), expira_em: null }, criado + 70 * MIN)).toBe(false);
    expect(codigoVencidoParaTroca({ created_at: iso(criado), expira_em: null }, criado + 24 * H + 4 * MIN)).toBe(false);   // dentro da folga
    expect(codigoVencidoParaTroca({ created_at: iso(criado), expira_em: null }, criado + 24 * H + 6 * MIN)).toBe(true);
    expect(contratoPendenteVencido({ status: 'pendente', modo: 'automatico', created_at: iso(criado), expira_em: null }, criado + 70 * MIN)).toBe(false);
  });
  it('criado ANTES do corte e sem a chave: o QR era de 60 min, como sempre', () => {
    const criado = corte - 6 * H;
    expect(validadeDoCodigoMs({ created_at: iso(criado), expira_em: null })).toBe(criado + H);
    expect(codigoVencidoParaTroca({ created_at: iso(criado), expira_em: null }, criado + 66 * MIN)).toBe(true);
  });
  it('a env PIX_QR24H_DESDE acerta o corte para a hora real do deploy', () => {
    const criado = corte + 6 * H;
    process.env.PIX_QR24H_DESDE = iso(criado + H);
    try { expect(validadeDoCodigoMs({ created_at: iso(criado), expira_em: null })).toBe(criado + H); } finally { delete process.env.PIX_QR24H_DESDE; }
  });
  it('com a chave gravada vale ela, antes ou depois do corte', () => {
    const criado = corte + H;
    expect(validadeDoCodigoMs({ created_at: iso(criado), expira_em: iso(criado + 23 * H) })).toBe(criado + 23 * H);
  });
});

describe('bloqueio 4: o que conta como pago', () => {
  const ontem = AGORA - 24 * H;
  it('só `ativo`, ou pagamento DEPOIS da criação do contrato', () => {
    expect(pagamentoValeDesde({ status: 'ativo' }, AGORA)).toBe(true);
    expect(pagamentoValeDesde({ status: 'pendente', ultimo_pagamento_em: iso(AGORA + MIN) }, AGORA)).toBe(true);
    expect(pagamentoValeDesde({ status: 'expirado', ultimo_pagamento_id: 'pay_1' }, AGORA)).toBe(true);   // o webhook grava o id antes do ativo
  });
  it('`inadimplente` e `cancelado` com pagamento ANTIGO (de antes do contrato) NÃO contam', () => {
    expect(pagamentoValeDesde({ status: 'inadimplente', ultimo_pagamento_em: iso(ontem) }, AGORA)).toBe(false);
    expect(pagamentoValeDesde({ status: 'cancelado', ultimo_pagamento_em: iso(ontem) }, AGORA)).toBe(false);
    expect(pagamentoValeDesde({ status: 'inadimplente' }, AGORA)).toBe(false);
  });
});

describe('horaCurtaBRT: "15h40" ou "21h", em Brasília', () => {
  it('minuto zero some; minuto vem com dois dígitos; o dia de Brasília manda, não o do servidor', () => {
    expect(horaCurtaBRT(Date.parse('2026-11-05T18:40:00.000Z'))).toBe('15h40');
    expect(horaCurtaBRT(Date.parse('2026-11-05T00:00:00.000Z'))).toBe('21h');
    expect(horaCurtaBRT(Date.parse('2026-11-05T12:05:30.000Z'))).toBe('9h05');
    expect(horaCurtaBRT(Date.parse('2026-11-05T03:00:00.000Z'))).toBe('0h');
  });
});
