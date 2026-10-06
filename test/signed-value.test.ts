import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '@/lib/base64url';
import {
  decodeSignedValue,
  encodeSignedValue,
  signPayload,
} from '@/lib/signed-value';

const SECRET = 'signed-value-test-secret';

// Contract owner for the signed-cookie envelope every consumer shares
// (session, flash, cooldown, OAuth transaction): base64url(payload) + "." +
// base64url(HMAC). The consumer suites only cover their own distinct
// semantics on top of this — payload shape validation and cookie lifecycle.
describe('signed cookie envelope', () => {
  it('round-trips a payload through encode/decode', async () => {
    const payload = { message: 'hello', exp: 123, nested: { ok: true } };
    const value = await encodeSignedValue(payload, SECRET);
    expect(await decodeSignedValue(value, SECRET)).toEqual(payload);
  });

  it('produces two dot-separated base64url parts', async () => {
    const value = await encodeSignedValue({ a: 1 }, SECRET);
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects a tampered payload', async () => {
    const value = await encodeSignedValue({ a: 1 }, SECRET);
    const tampered = value.replace(/^./, value[0] === 'A' ? 'B' : 'A');
    expect(await decodeSignedValue(tampered, SECRET)).toBeNull();
  });

  it('rejects a value signed with a different secret', async () => {
    const value = await encodeSignedValue({ a: 1 }, SECRET);
    expect(await decodeSignedValue(value, 'other-secret')).toBeNull();
  });

  it.each([
    ['no separator', 'garbage'],
    ['empty payload part', '.c2ln'],
    ['empty signature part', 'eyJhIjoxfQ.'],
  ])('rejects a malformed envelope (%s)', async (_name, value) => {
    expect(await decodeSignedValue(value, SECRET)).toBeNull();
  });

  it('rejects a validly-signed payload that is not JSON', async () => {
    // Hand-builds the envelope so the signature is genuinely valid — the
    // JSON-parse guard is the only thing that can reject this.
    const payloadB64 = base64urlEncode(new TextEncoder().encode('not json'));
    const value = `${payloadB64}.${await signPayload(payloadB64, SECRET)}`;
    expect(await decodeSignedValue(value, SECRET)).toBeNull();
  });
});
