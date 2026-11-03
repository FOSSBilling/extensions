import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/lib/hash';

describe('sha256Hex', () => {
  it('returns lowercase hex over the UTF-8 bytes', async () => {
    // Well-known SHA-256 vector for 'abc'.
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('distinguishes inputs that only differ outside ASCII', async () => {
    expect(await sha256Hex('café')).not.toBe(await sha256Hex('cafe'));
    expect(await sha256Hex('café')).toMatch(/^[a-f0-9]{64}$/);
  });
});
