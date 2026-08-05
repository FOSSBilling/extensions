import { describe, expect, it } from 'vitest';
import { mintBearerAssertion } from '@/lib/assertion';

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function decodeBase64UrlBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe('bearer assertions', () => {
  it('mints an HS256 header and contextual 60-second payload', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await mintBearerAssertion('user-42', 'test-secret');
    const after = Math.floor(Date.now() / 1000);
    const [header, payload, signature] = token.split('.');

    expect(JSON.parse(decodeBase64Url(header))).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('test-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    await expect(
      crypto.subtle.verify(
        'HMAC',
        key,
        decodeBase64UrlBytes(signature),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).resolves.toBe(true);

    const decoded = JSON.parse(decodeBase64Url(payload)) as Record<
      string,
      unknown
    >;
    expect(decoded).toEqual({
      sub: 'user-42',
      iat: expect.any(Number),
      exp: expect.any(Number),
      iss: 'fossbilling-extensions',
      aud: 'fossbilling-api/extensions-v2',
      purpose: 'user-authentication',
      ver: 1,
    });
    expect(decoded.iat).toBeGreaterThanOrEqual(before);
    expect(decoded.iat).toBeLessThanOrEqual(after);
    expect(Number.isInteger(decoded.iat)).toBe(true);
    expect(Number.isInteger(decoded.exp)).toBe(true);
    expect(decoded.exp).toBe((decoded.iat as number) + 60);
  });
});
