import type { AstroCookies } from 'astro';
import { base64urlEncode, base64urlDecode } from './base64url';

// A self-contained, HMAC-signed session cookie. Deliberately does not persist
// or depend on the auth service's own tokens past the initial code exchange —
// once we have the user's identity we mint our own session, independent of
// the auth service's access/refresh token lifetimes.

export const SESSION_COOKIE = 'fb_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type SessionUser = {
  sub: string;
  name: string;
  email: string;
  picture?: string;
};

type SessionPayload = SessionUser & { exp: number };

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionCookieValue(
  user: SessionUser,
  secret: string,
): Promise<string> {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64),
  );
  return `${payloadB64}.${base64urlEncode(new Uint8Array(signature))}`;
}

async function verifySessionCookieValue(
  value: string,
  secret: string,
): Promise<SessionUser | null> {
  const [payloadB64, signatureB64] = value.split('.');
  if (!payloadB64 || !signatureB64) return null;

  const key = await importSigningKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(signatureB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    sub: payload.sub,
    name: payload.name,
    email: payload.email,
    picture: payload.picture,
  };
}

export async function getSessionUser(
  cookies: AstroCookies,
  secret: string,
): Promise<SessionUser | null> {
  const value = cookies.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  return verifySessionCookieValue(value, secret);
}
