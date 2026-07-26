import { base64urlEncode } from './base64url';

// Mints a short-lived compact HS256 assertion (header.payload.signature) that
// the api repo's bearerAssertionVerifier verifies — see that repo's
// src/lib/auth/bearer-assertion.ts. Not a general-purpose JWT: the header is
// fixed and never parsed by the verifier, only included in the signed input.
const ASSERTION_TTL_SECONDS = 60;

const HEADER = base64urlEncode(
  new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
);

export async function mintBearerAssertion(
  sub: string,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ sub, iat: now, exp: now + ASSERTION_TTL_SECONDS }),
    ),
  );

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signingInput = `${HEADER}.${payload}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}
