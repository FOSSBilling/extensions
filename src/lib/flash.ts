import type { AstroCookies } from 'astro';
import { base64urlDecode, base64urlEncode } from './base64url';
import { importSigningKey } from './session';

// One-shot flash messages carried across a POST -> redirect -> GET cycle via
// a short-lived, HMAC-signed cookie — distinct from the signed auth-cookie
// session (getSessionUser/SESSION_SECRET, see lib/session.ts). Keeping flash
// out of the KV-backed Astro session means no storage round-trips and no
// cross-colo consistency window between the POST and its redirect: the
// cookie is definitionally present on the next GET. The signature keeps the
// content server-controlled — a tampered cookie simply fails verification,
// which matters because the toast fragment is rendered from this payload.

export interface FlashMessage {
  category?: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
}

export const FLASH_COOKIE = 'fb_flash';
const FLASH_MAX_AGE_SECONDS = 120;

// Structural subset shared by AstroGlobal (in .astro pages) and the
// destructured or full APIContext (in .ts API routes), so flash helpers work
// in both.
interface FlashContext {
  cookies: AstroCookies;
  url: URL;
}

async function signPayload(
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

async function verifyPayloadSignature(
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

function parseFlashPayload(
  value: string,
): { message: FlashMessage; exp: number } | null {
  const [payloadB64, signatureB64] = value.split('.');
  if (!payloadB64 || !signatureB64) return null;

  let payload: { message?: FlashMessage; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return null;
  }

  const { message, exp } = payload;
  if (
    !message ||
    typeof exp !== 'number' ||
    typeof message.title !== 'string' ||
    (message.category !== undefined &&
      !['success', 'error', 'info', 'warning'].includes(message.category)) ||
    (message.description !== undefined &&
      typeof message.description !== 'string')
  ) {
    return null;
  }

  return { message, exp };
}

export async function setFlash(
  context: FlashContext,
  secret: string,
  message: FlashMessage,
): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + FLASH_MAX_AGE_SECONDS;
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify({ message, exp })),
  );
  const value = `${payloadB64}.${await signPayload(payloadB64, secret)}`;

  context.cookies.set(FLASH_COOKIE, value, {
    httpOnly: true,
    secure: context.url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: FLASH_MAX_AGE_SECONDS,
  });
}

// Reads and clears the flash in one call — it's meant to be shown exactly
// once, so reloading the page after the toast has rendered must not
// resurface it. Anything unverifiable, expired, or malformed is silently
// dropped: flashes are cosmetic, never a security boundary, and must not
// block rendering.
export async function takeFlash(
  cookies: AstroCookies,
  secret: string,
): Promise<FlashMessage | undefined> {
  const value = cookies.get(FLASH_COOKIE)?.value;
  if (!value) return undefined;
  cookies.delete(FLASH_COOKIE, { path: '/' });

  const [payloadB64, signatureB64] = value.split('.');
  if (!payloadB64 || !signatureB64) return undefined;
  if (!(await verifyPayloadSignature(payloadB64, signatureB64, secret))) {
    return undefined;
  }

  const payload = parseFlashPayload(value);
  if (!payload) return undefined;
  if (payload.exp < Math.floor(Date.now() / 1000)) return undefined;

  return payload.message;
}
