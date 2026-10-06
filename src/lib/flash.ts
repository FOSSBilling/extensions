import type { AstroCookies } from 'astro';
import { decodeSignedValue, encodeSignedValue } from './signed-value';

// One-shot flash messages carried across a POST -> redirect -> GET cycle via
// a short-lived, HMAC-signed cookie — distinct from the signed auth-cookie
// session (getSessionUser/SESSION_SECRET, see lib/session.ts). Keeping flash
// out of the KV-backed Astro session means no storage round-trips and no
// cross-colo consistency window between the POST and its redirect: the
// cookie is definitionally present on the next GET. The signature keeps the
// content server-controlled — a tampered cookie simply fails verification,
// which matters because the toast fragment is rendered from this payload.

export interface FlashAction {
  label: string;
  href: string;
}

export interface FlashMessage {
  category?: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
  // Optional call-to-action rendered next to Dismiss (e.g. deep-linking the
  // user from a warning to the page that can actually resolve it).
  action?: FlashAction;
}

export const FLASH_COOKIE = 'fb_flash';
const FLASH_MAX_AGE_SECONDS = 120;

// The toast renders action.href as a link, so a malformed action must fail
// the shape check rather than render (or throw on a null dereference).
function isFlashAction(value: unknown): value is FlashAction {
  if (typeof value !== 'object' || value === null) return false;
  const { label, href } = value as Record<string, unknown>;
  return (
    typeof label === 'string' &&
    label.length > 0 &&
    label.length <= 100 &&
    typeof href === 'string' &&
    href.length > 0 &&
    href.length <= 2048
  );
}

// Structural subset shared by AstroGlobal (in .astro pages) and the
// destructured or full APIContext (in .ts API routes), so flash helpers work
// in both.
interface FlashContext {
  cookies: AstroCookies;
  url: URL;
}

function parseFlashPayload(
  payload: unknown,
): { message: FlashMessage; exp: number } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { message, exp } = payload as {
    message?: FlashMessage;
    exp?: number;
  };
  if (
    !message ||
    typeof exp !== 'number' ||
    typeof message.title !== 'string'
  ) {
    return null;
  }
  if (
    (message.category !== undefined &&
      !['success', 'error', 'info', 'warning'].includes(message.category)) ||
    (message.description !== undefined &&
      typeof message.description !== 'string') ||
    (message.action !== undefined && !isFlashAction(message.action))
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
  const value = await encodeSignedValue({ message, exp }, secret);

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

  const payload = parseFlashPayload(await decodeSignedValue(value, secret));
  if (!payload) return undefined;
  if (payload.exp < Math.floor(Date.now() / 1000)) return undefined;

  return payload.message;
}
