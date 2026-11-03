import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { JWT_SECRET, signToken, verifyToken, segredosDeVerificacao } from '../utils/jwt';
import { unsubToken, conferirDescadastro } from '../controllers/unsubscribeController';

// Valor falso e óbvio para o segredo "anterior".
const ANTERIOR = 'falso-jwt-anterior-0123456789';
const USER = '00000000-0000-4000-8000-000000000001';
const hmac = (segredo: string, uid: string) => crypto.createHmac('sha256', segredo).update(`unsub:${uid}`).digest('hex').slice(0, 32);

describe('rotação do JWT_SECRET', () => {
  const antes = process.env.JWT_SECRET_ANTERIOR;
  beforeEach(() => { delete process.env.JWT_SECRET_ANTERIOR; });
  afterEach(() => { if (antes === undefined) delete process.env.JWT_SECRET_ANTERIOR; else process.env.JWT_SECRET_ANTERIOR = antes; });

  it('sem anterior, só o JWT_SECRET vale para verificar', () => {
    expect(segredosDeVerificacao()).toEqual([JWT_SECRET]);
  });

  it('com anterior, o novo vem primeiro e o anterior depois (lido na hora da chamada)', () => {
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    expect(segredosDeVerificacao()).toEqual([JWT_SECRET, ANTERIOR]);
  });

  it('anterior vazio, curto ou igual ao novo não existe', () => {
    process.env.JWT_SECRET_ANTERIOR = '   ';
    expect(segredosDeVerificacao()).toEqual([JWT_SECRET]);
    process.env.JWT_SECRET_ANTERIOR = 'curto';
    expect(segredosDeVerificacao()).toEqual([JWT_SECRET]);
    process.env.JWT_SECRET_ANTERIOR = JWT_SECRET;
    expect(segredosDeVerificacao()).toEqual([JWT_SECRET]);
  });

  it('o token assinado agora usa o JWT_SECRET e vale com ou sem anterior', () => {
    const t = signToken(USER);
    expect(jwt.verify(t, JWT_SECRET, { algorithms: ['HS256'] })).toMatchObject({ userId: USER });
    expect(verifyToken(t).userId).toBe(USER);
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    expect(verifyToken(t).userId).toBe(USER);
  });

  it('token assinado com o anterior vale quando JWT_SECRET_ANTERIOR está setado', () => {
    const velho = jwt.sign({ userId: USER }, ANTERIOR, { expiresIn: '7d' });
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    expect(verifyToken(velho).userId).toBe(USER);
  });

  it('o anterior é usado cru (com espaço ou quebra de linha no fim, como assinou o token velho)', () => {
    const cru = `${ANTERIOR}
`;
    const velho = jwt.sign({ userId: USER }, cru, { expiresIn: '7d' });
    process.env.JWT_SECRET_ANTERIOR = cru;
    expect(segredosDeVerificacao()).toEqual([JWT_SECRET, cru]);
    expect(verifyToken(velho).userId).toBe(USER);
    expect(conferirDescadastro(USER, hmac(cru, USER))).toBe(true);
  });

  it('token assinado com o anterior falha quando JWT_SECRET_ANTERIOR não está setado', () => {
    const velho = jwt.sign({ userId: USER }, ANTERIOR, { expiresIn: '7d' });
    expect(() => verifyToken(velho)).toThrow();
  });

  it('segredo desconhecido falha mesmo com anterior setado', () => {
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    const outro = jwt.sign({ userId: USER }, 'falso-outro-segredo-9876543210', { expiresIn: '7d' });
    expect(() => verifyToken(outro)).toThrow();
  });

  it('token expirado continua falhando (a assinatura certa não perdoa o prazo)', () => {
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    const expirado = jwt.sign({ userId: USER }, ANTERIOR, { expiresIn: -10 });
    expect(() => verifyToken(expirado)).toThrow(/expired/i);
  });

  it('algoritmo diferente de HS256 é recusado, com o novo ou com o anterior', () => {
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    const h384Novo = jwt.sign({ userId: USER }, JWT_SECRET, { algorithm: 'HS384' });
    const h512Velho = jwt.sign({ userId: USER }, ANTERIOR, { algorithm: 'HS512' });
    expect(() => verifyToken(h384Novo)).toThrow();
    expect(() => verifyToken(h512Velho)).toThrow();
  });

  it('alg none é recusado', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: USER })}.`;
    expect(() => verifyToken(none)).toThrow();
  });
});

describe('link de descadastro na rotação', () => {
  const antes = process.env.JWT_SECRET_ANTERIOR;
  beforeEach(() => { delete process.env.JWT_SECRET_ANTERIOR; });
  afterEach(() => { if (antes === undefined) delete process.env.JWT_SECRET_ANTERIOR; else process.env.JWT_SECRET_ANTERIOR = antes; });

  it('o link novo é gerado com o JWT_SECRET e confere', () => {
    expect(unsubToken(USER)).toBe(hmac(JWT_SECRET, USER));
    expect(conferirDescadastro(USER, unsubToken(USER))).toBe(true);
  });

  it('o link do segredo anterior vale quando JWT_SECRET_ANTERIOR está setado', () => {
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    expect(conferirDescadastro(USER, hmac(ANTERIOR, USER))).toBe(true);
  });

  it('o link assinado com o antigo vale quando DESCADASTRO_SEGREDO_ANTIGO está setado (sem JWT_SECRET_ANTERIOR)', () => {
    const antigo = process.env.DESCADASTRO_SEGREDO_ANTIGO;
    try {
      process.env.DESCADASTRO_SEGREDO_ANTIGO = ANTERIOR;
      expect(conferirDescadastro(USER, hmac(ANTERIOR, USER))).toBe(true);
      expect(conferirDescadastro(USER, hmac('falso-outro-segredo-xyz', USER))).toBe(false);
      process.env.DESCADASTRO_SEGREDO_ANTIGO = '  ';
      expect(conferirDescadastro(USER, hmac('', USER))).toBe(false);
    } finally {
      if (antigo === undefined) delete process.env.DESCADASTRO_SEGREDO_ANTIGO; else process.env.DESCADASTRO_SEGREDO_ANTIGO = antigo;
    }
  });

  it('o link do segredo anterior NÃO vale sem JWT_SECRET_ANTERIOR', () => {
    expect(conferirDescadastro(USER, hmac(ANTERIOR, USER))).toBe(false);
  });

  it('link de outro usuário, adulterado ou de tamanho errado falha sem lançar', () => {
    process.env.JWT_SECRET_ANTERIOR = ANTERIOR;
    expect(conferirDescadastro('00000000-0000-4000-8000-000000000002', hmac(ANTERIOR, USER))).toBe(false);
    expect(conferirDescadastro(USER, hmac(ANTERIOR, USER).slice(0, 31))).toBe(false);
    expect(conferirDescadastro(USER, '')).toBe(false);
    expect(conferirDescadastro(USER, 'x'.repeat(32))).toBe(false);
  });
});
