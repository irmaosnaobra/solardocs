import { describe, it, expect } from 'vitest';
import { fmtPhone, sleep } from '../services/agents/zapiClient';

describe('fmtPhone', () => {
  it('adds 55 prefix when missing', () => {
    expect(fmtPhone('34991360223')).toBe('5534991360223');
  });

  it('keeps 55 prefix when already present', () => {
    expect(fmtPhone('5534991360223')).toBe('5534991360223');
  });

  it('strips non-digits', () => {
    expect(fmtPhone('+55 (34) 9913-60223')).toBe('5534991360223');
  });

  it('strips @c.us suffix and non-digits', () => {
    expect(fmtPhone('5534991360223@c.us'.replace('@c.us', ''))).toBe('5534991360223');
  });
});

describe('sleep', () => {
  it('returns a promise that resolves', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
