import type { AstroCookies } from 'astro';
import { decodeSignedValue, encodeSignedValue } from './signed-value';

// The GitHub re-verify cooldown is the last piece of per-visitor state that
// used to live in the KV-backed Astro session. It is just a timestamp, so
// like flash messages (lib/flash.ts) it now rides in a short-lived,
// HMAC-signed cookie — no storage round-trips, and the KV binding itself
// becomes unnecessary. Unlike flash, the cookie is deliberately NOT cleared
// on read: the point is to survive repeated retry attempts until it lapses.

export const REVERIFY_COOLDOWN_COOKIE = 'fb_reverify_cd';

// The cooldown itself is one minute; the cookie is allowed to outlive it
// slightly so the value stays readable until it is definitively stale.
const COOLDOWN_MS = 60_000;
const COOKIE_MAX_AGE_SECONDS = 300;

interface CooldownContext {
  cookies: AstroCookies;
  url: URL;
}

export async function setReverifyCooldown(
  context: CooldownContext,
  secret: string,
): Promise<void> {
  const until = Date.now() + COOLDOWN_MS;
  const value = await encodeSignedValue({ until }, secret);

  context.cookies.set(REVERIFY_COOLDOWN_COOKIE, value, {
    httpOnly: true,
    secure: context.url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

// Returns the epoch-ms timestamp until which the cooldown runs, or 0 when
// absent, malformed, tampered, or signed with the wrong secret.
export async function takeReverifyCooldown(
  cookies: AstroCookies,
  secret: string,
): Promise<number> {
  const value = cookies.get(REVERIFY_COOLDOWN_COOKIE)?.value;
  if (!value) return 0;

  const payload = await decodeSignedValue(value, secret);
  if (!payload || typeof payload !== 'object') return 0;
  const { until } = payload as { until?: unknown };
  return typeof until === 'number' ? until : 0;
}
