import { SignJWT } from 'jose';

// Mints a short-lived compact HS256 assertion (header.payload.signature) that
// the api repo's bearerAssertionVerifier verifies — see that repo's
// src/lib/auth/bearer-assertion.ts. The API pins HS256 and validates this
// assertion's contextual claims and lifetime.
const ASSERTION_TTL_SECONDS = 60;
const ASSERTION_ISSUER = 'fossbilling-extensions';
const ASSERTION_AUDIENCE = 'fossbilling-api/extensions-v2';
const ASSERTION_PURPOSE = 'user-authentication';
const ASSERTION_VERSION = 1;

// Assertions are minted per authenticated API request; importing the HMAC
// key each time is wasted work for the lifetime of the isolate, so the
// imported key is cached per secret (secrets only change across deploys).
const assertionKeys = new Map<string, Promise<CryptoKey>>();

function assertionSigningKey(secret: string): Promise<CryptoKey> {
  let key = assertionKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    key.catch(() => assertionKeys.delete(secret));
    assertionKeys.set(secret, key);
  }
  return key;
}

export async function mintBearerAssertion(
  sub: string,
  secret: string,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);

  return new SignJWT({
    purpose: ASSERTION_PURPOSE,
    ver: ASSERTION_VERSION,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuedAt(iat)
    .setIssuer(ASSERTION_ISSUER)
    .setAudience(ASSERTION_AUDIENCE)
    .setExpirationTime(iat + ASSERTION_TTL_SECONDS)
    .sign(await assertionSigningKey(secret));
}
