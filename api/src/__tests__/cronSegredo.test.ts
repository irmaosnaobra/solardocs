import { describe, it, expect, afterEach } from 'vitest';
import { slotDoSegredo, deveAvisarSlot } from '../utils/cronSegredo';

// Valores falsos e óbvios: nenhum segredo real aparece aqui.
const A = 'falso-cron-secret-aaaaaaaa';
const G = 'falso-github-secret-bbbbbbbb';
const V = 'falso-anterior-secret-cccccc';

describe('slotDoSegredo', () => {
  it('cada slot casa com o seu valor', () => {
    const env = { CRON_SECRET: A, GITHUB_CRON_SECRET: G, CRON_SECRET_ANTERIOR: V } as NodeJS.ProcessEnv;
    expect(slotDoSegredo(A, env)).toBe('CRON_SECRET');
    expect(slotDoSegredo(G, env)).toBe('GITHUB_CRON_SECRET');
    expect(slotDoSegredo(V, env)).toBe('CRON_SECRET_ANTERIOR');
  });

  it('faz trim do recebido e do valor da env', () => {
    const env = { CRON_SECRET: `  ${A}\n` } as NodeJS.ProcessEnv;
    expect(slotDoSegredo(`  ${A} `, env)).toBe('CRON_SECRET');
  });

  it('devolve o primeiro slot na ordem quando dois têm o mesmo valor', () => {
    const env = { CRON_SECRET: A, CRON_SECRET_ANTERIOR: A } as NodeJS.ProcessEnv;
    expect(slotDoSegredo(A, env)).toBe('CRON_SECRET');
  });

  it('env vazia é ignorada; valor curto vale como antes (o GITHUB_CRON_SECRET não dá para medir)', () => {
    expect(slotDoSegredo('', { CRON_SECRET: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(slotDoSegredo('x', { CRON_SECRET: '   ' } as NodeJS.ProcessEnv)).toBeNull();
    expect(slotDoSegredo('curto', { GITHUB_CRON_SECRET: 'curto' } as NodeJS.ProcessEnv)).toBe('GITHUB_CRON_SECRET');
  });

  it('o aviso de slot sai no máximo 1 vez por hora por chave', () => {
    const t0 = 1_000_000_000_000;
    expect(deveAvisarSlot('k-teste', t0)).toBe(true);
    expect(deveAvisarSlot('k-teste', t0 + 60_000)).toBe(false);
    expect(deveAvisarSlot('k-outra', t0 + 60_000)).toBe(true);
    expect(deveAvisarSlot('k-teste', t0 + 3_600_001)).toBe(true);
  });

  it('recebido ausente, vazio ou que não é texto dá null', () => {
    const env = { CRON_SECRET: A } as NodeJS.ProcessEnv;
    expect(slotDoSegredo(undefined, env)).toBeNull();
    expect(slotDoSegredo('', env)).toBeNull();
    expect(slotDoSegredo('   ', env)).toBeNull();
    expect(slotDoSegredo(['a'], env)).toBeNull();
    expect(slotDoSegredo(123, env)).toBeNull();
  });

  it('valor errado dá null', () => {
    const env = { CRON_SECRET: A, GITHUB_CRON_SECRET: G } as NodeJS.ProcessEnv;
    expect(slotDoSegredo('falso-cron-secret-aaaaaaab', env)).toBeNull();
  });

  it('tamanho diferente não lança e dá null', () => {
    const env = { CRON_SECRET: A } as NodeJS.ProcessEnv;
    expect(() => slotDoSegredo(A + 'x', env)).not.toThrow();
    expect(slotDoSegredo(A + 'x', env)).toBeNull();
    expect(slotDoSegredo(A.slice(0, -1), env)).toBeNull();
    // mesmo número de caracteres, mas em bytes é maior (acento ocupa 2 bytes)
    expect(() => slotDoSegredo('falso-cron-secret-aaaaaaá', env)).not.toThrow();
    expect(slotDoSegredo('falso-cron-secret-aaaaaaá', env)).toBeNull();
  });

  it('sem CRON_SECRET_ANTERIOR o velho não passa', () => {
    const env = { CRON_SECRET: A } as NodeJS.ProcessEnv;
    expect(slotDoSegredo(V, env)).toBeNull();
    expect(slotDoSegredo(V, { ...env, CRON_SECRET_ANTERIOR: V } as NodeJS.ProcessEnv)).toBe('CRON_SECRET_ANTERIOR');
  });

  describe('lê process.env na hora da chamada', () => {
    const antes = { ...process.env };
    afterEach(() => {
      for (const k of ['CRON_SECRET', 'GITHUB_CRON_SECRET', 'CRON_SECRET_ANTERIOR']) {
        if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k];
      }
    });

    it('muda o resultado quando a env muda depois do import', () => {
      process.env.CRON_SECRET = A;
      delete process.env.CRON_SECRET_ANTERIOR;
      expect(slotDoSegredo(V)).toBeNull();
      process.env.CRON_SECRET_ANTERIOR = V;
      expect(slotDoSegredo(V)).toBe('CRON_SECRET_ANTERIOR');
      expect(slotDoSegredo(A)).toBe('CRON_SECRET');
    });
  });
});
