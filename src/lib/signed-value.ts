import { base64urlDecode, base64urlEncode } from './base64url';

// HMAC signing for every signed cookie (auth session, flash messages,
// re-verify cooldown, OAuth transaction). One module owns the key cache, the
// sign/verify primitives, and the envelope format — base64url(payload) + "." +
// base64url(HMAC(payloadB64)) — so it stays identical everywhere.
//
// All signed cookies share SESSION_SECRET's key material. Domain separation
// comes from each consumer validating its own payload shape strictly (see
// verifySessionCookieValue in session.ts): a payload from one cookie type
// cannot satisfy another's validation, so a token cannot be replayed across
// cookie types even though the same key verifies them.

// WebCrypto key import happens on every request (session verification in
// the header island) — cache the imported CryptoKey per secret for the
// lifetime of the isolate. Secrets only change across deployments, so the
// map stays effectively size-bounded.
const signingKeys = new Map<string, Promise<CryptoKey>>();

export function importSigningKey(secret: string): Promise<CryptoKey> {
  let key = signingKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    key.catch(() => signingKeys.delete(secret));
    signingKeys.set(secret, key);
  }
  return key;
}

export async function signPayload(
  payloadB64: string,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importSigningKey(secret),
    new TextEncoder().encode(payloadB64),
  );
  return base64urlEncode(new Uint8Array(signature));
}

export async function verifyPayloadSignature(
  payloadB64: string,
  signatureB64: string,
  secret: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      'HMAC',
      await importSigningKey(secret),
      base64urlDecode(signatureB64),
      new TextEncoder().encode(payloadB64),
    );
  } catch {
    return false;
  }
}

// Envelope form shared by every signed cookie: encode the payload, sign it,
// join the two parts with a ".". Consumers own their payload shape.
export async function encodeSignedValue(
  payload: unknown,
  secret: string,
): Promise<string> {
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${payloadB64}.${await signPayload(payloadB64, secret)}`;
}

// Verifies and decodes a signed cookie value, returning the parsed payload,
// or null when the envelope is malformed, fails verification, or does not
// parse as JSON. Consumers validate the decoded shape for their cookie type.
export async function decodeSignedValue(
  value: string,
  secret: string,
): Promise<unknown | null> {
  const [payloadB64, signatureB64] = value.split('.');
  if (!payloadB64 || !signatureB64) return null;
  if (!(await verifyPayloadSignature(payloadB64, signatureB64, secret))) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return null;
  }
}
