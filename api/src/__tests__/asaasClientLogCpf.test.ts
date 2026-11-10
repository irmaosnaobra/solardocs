import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { pathParaLog } from '../services/asaas/asaasClient';

describe('log do Asaas nao carrega o CPF inteiro', () => {
  it('mascara o cpfCnpj do path (CPF e CNPJ), mantendo o resto', () => {
    expect(pathParaLog('/customers?cpfCnpj=52998224725&limit=1')).toBe('/customers?cpfCnpj=529***25&limit=1');
    expect(pathParaLog('/customers?cpfCnpj=12345678000199&limit=1')).toBe('/customers?cpfCnpj=123***99&limit=1');
    expect(pathParaLog('/payments/pay_1/pixQrCode')).toBe('/payments/pay_1/pixQrCode');
  });
});
