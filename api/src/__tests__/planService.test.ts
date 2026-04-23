import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../utils/apiError';

const mockSingle = vi.fn();
const mockUpdate = vi.fn();
const mockEq     = vi.fn();

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn((..._a: unknown[]) => ({ single: mockSingle, eq: mockEq })),
      update: vi.fn(() => ({ eq: mockEq })),
    })),
  },
}));

import { checkLimit, incrementUsed } from '../services/planService';

beforeEach(() => vi.clearAllMocks());

// ─── checkLimit ──────────────────────────────────────────────────────
describe('checkLimit', () => {
  it('não lança erro para plano ilimitado', async () => {
    mockSingle.mockResolvedValue({ data: { plano: 'ilimitado', documentos_usados: 999, limite_documentos: 0 } });
    await expect(checkLimit('user-1')).resolves.toBeUndefined();
  });

  it('não lança erro quando abaixo do limite', async () => {
    mockSingle.mockResolvedValue({ data: { plano: 'pro', documentos_usados: 5, limite_documentos: 90 } });
    await expect(checkLimit('user-1')).resolves.toBeUndefined();
  });

  it('lança 403 LIMIT_REACHED quando no limite', async () => {
    mockSingle.mockResolvedValue({ data: { plano: 'pro', documentos_usados: 90, limite_documentos: 90 } });
    await expect(checkLimit('user-1')).rejects.toThrow(ApiError);
    await expect(checkLimit('user-1')).rejects.toMatchObject({ statusCode: 403, message: 'LIMIT_REACHED' });
  });

  it('lança 404 quando usuário não existe', async () => {
    mockSingle.mockResolvedValue({ data: null });
    await expect(checkLimit('user-x')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── incrementUsed ───────────────────────────────────────────────────
describe('incrementUsed', () => {
  it('incrementa documentos_usados em 1', async () => {
    mockSingle.mockResolvedValue({ data: { documentos_usados: 4 } });
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn() });
    const { supabase } = await import('../utils/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnValue({ single: mockSingle }),
      update: updateMock,
    });

    await incrementUsed('user-1');
    expect(updateMock).toHaveBeenCalledWith({ documentos_usados: 5 });
  });

  it('não lança erro se usuário não existe', async () => {
    mockSingle.mockResolvedValue({ data: null });
    await expect(incrementUsed('user-x')).resolves.toBeUndefined();
  });
});
