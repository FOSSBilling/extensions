import { SignJWT } from 'jose';
import { importSigningKey } from './signed-value';

// Mints a short-lived compact HS256 assertion (header.payload.signature) that
// the api repo's bearerAssertionVerifier verifies — see that repo's
// src/lib/auth/bearer-assertion.ts. The API pins HS256 and validates this
// assertion's contextual claims and lifetime.
const ASSERTION_TTL_SECONDS = 60;
const ASSERTION_ISSUER = 'fossbilling-extensions';
const ASSERTION_AUDIENCE = 'fossbilling-api/extensions-v2';
const ASSERTION_PURPOSE = 'user-authentication';
const IDENTITY_SYNC_PURPOSE = 'identity-sync';
const ASSERTION_VERSION = 1;

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
    .sign(await importSigningKey(secret));
}

// Identity-sync proofs are scoped to PUT /users/me/identity only: the API's
// requireIdentitySync middleware requires purpose 'identity-sync' plus a
// body_sha256 claim holding the lowercase hex SHA-256 of the exact UTF-8
// JSON request bytes. Proofs minted here return 403 on every other route,
// and user-authentication assertions return 403 on the sync route.
export async function mintIdentitySyncAssertion(
  sub: string,
  secret: string,
  bodySha256: string,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);

  return new SignJWT({
    purpose: IDENTITY_SYNC_PURPOSE,
    ver: ASSERTION_VERSION,
    body_sha256: bodySha256,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuedAt(iat)
    .setIssuer(ASSERTION_ISSUER)
    .setAudience(ASSERTION_AUDIENCE)
    .setExpirationTime(iat + ASSERTION_TTL_SECONDS)
    .sign(await importSigningKey(secret));
}
