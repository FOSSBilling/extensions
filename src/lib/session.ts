import type { AstroCookies } from 'astro';
import { base64urlEncode, base64urlDecode } from './base64url';
import { signPayload, verifyPayloadSignature } from './signed-value';

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
  // Domain-side moderator flag, minted at login so the site chrome can offer
  // the Admin menu without an API round-trip on every page. Navigation-only:
  // the moderator guards re-check the live account and stay authoritative.
  // Optional so sessions minted before this field existed keep verifying —
  // they simply don't offer the Admin menu until the next login.
  is_moderator?: boolean;
};

type SessionPayload = SessionUser & { exp: number };

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
  return `${payloadB64}.${await signPayload(payloadB64, secret)}`;
}

async function verifySessionCookieValue(
  value: string,
  secret: string,
): Promise<SessionUser | null> {
  const [payloadB64, signatureB64] = value.split('.');
  if (!payloadB64 || !signatureB64) return null;
  if (!(await verifyPayloadSignature(payloadB64, signatureB64, secret))) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return null;
  }

  // Require the session shape, not just a valid signature: every signed
  // cookie (flash, cooldown) shares this key, and only the session payload
  // carries these identity fields.
  if (
    typeof payload.exp !== 'number' ||
    typeof payload.sub !== 'string' ||
    payload.sub === '' ||
    typeof payload.name !== 'string' ||
    payload.name === '' ||
    typeof payload.email !== 'string' ||
    payload.email === ''
  ) {
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
    is_moderator: payload.is_moderator,
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
