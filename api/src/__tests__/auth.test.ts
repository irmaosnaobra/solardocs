import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';

vi.mock('../utils/jwt', () => ({
  verifyToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { userId: 'user-123' };
    throw new Error('invalid');
  }),
}));

function mockReq(authHeader?: string): Request {
  return { headers: { authorization: authHeader } } as unknown as Request;
}

function mockRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('authMiddleware', () => {
  const next = vi.fn() as unknown as NextFunction;

  beforeEach(() => vi.clearAllMocks());

  it('calls next and sets userId on valid token', () => {
    const req = mockReq('Bearer valid-token');
    const res = mockRes();
    authMiddleware(req as Request, res as unknown as Response, next);
    expect((req as any).userId).toBe('user-123');
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no authorization header', () => {
    const req = mockReq();
    const res = mockRes();
    authMiddleware(req as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 on invalid token', () => {
    const req = mockReq('Bearer bad-token');
    const res = mockRes();
    authMiddleware(req as Request, res as unknown as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
