import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVERIFY_COOLDOWN_COOKIE,
  setReverifyCooldown,
  takeReverifyCooldown,
} from '@/lib/reverify-cooldown';
import { fakeCookies } from './helpers/fake-cookies';

const SECRET = 'cooldown-test-secret';

function cooldownContext(secure = true) {
  const jar = fakeCookies();
  return {
    jar,
    context: {
      cookies: jar.cookies,
      url: new URL(
        secure
          ? 'https://extensions.example.test/account'
          : 'http://localhost:4321/account',
      ),
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
});

describe('setReverifyCooldown / takeReverifyCooldown', () => {
  it('stores a cookie that outlives the one-minute cooldown and survives reads', async () => {
    const { jar, context } = cooldownContext();

    await setReverifyCooldown(context, SECRET);

    expect(jar.set).toHaveBeenCalledOnce();
    const [, , options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    // The cookie outlives the cooldown itself (300s vs 60s) so the value
    // stays readable until it is definitively stale.
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });

    // The cooldown is one minute past now, read back through the public API
    // (envelope format is owned by signed-value's own tests).
    const until = await takeReverifyCooldown(jar.cookies, SECRET);
    expect(until).toBe(new Date('2026-09-19T12:00:00Z').getTime() + 60_000);
    // Unlike flash, the cookie must survive the read so repeated retries
    // stay rate limited until it lapses on its own.
    expect(jar.delete).not.toHaveBeenCalled();
    expect(jar.get(REVERIFY_COOLDOWN_COOKIE)).toBeDefined();
  });

  it('omits the secure attribute over plaintext local development', async () => {
    const { jar, context } = cooldownContext(false);

    await setReverifyCooldown(context, SECRET);

    const [, , options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(options.secure).toBe(false);
  });

  it('returns 0 when no cooldown cookie is present', async () => {
    const { jar } = cooldownContext();
    await expect(takeReverifyCooldown(jar.cookies, SECRET)).resolves.toBe(0);
  });

  it('returns 0 for tampered, wrong-secret, and malformed cookies', async () => {
    // The envelope's rejection paths are owned by signed-value's own suite;
    // this pins that the consumer surfaces them as "no cooldown".
    const { jar, context } = cooldownContext();
    await setReverifyCooldown(context, SECRET);
    const value = jar.get(REVERIFY_COOLDOWN_COOKIE)!.value;

    const tampered = `${value.slice(0, -2)}xx`;
    await expect(takeReverifyCooldown(jar.cookies, tampered)).resolves.toBe(0);
    await expect(
      takeReverifyCooldown(jar.cookies, 'other-secret'),
    ).resolves.toBe(0);
    jar.set(REVERIFY_COOLDOWN_COOKIE, 'garbage');
    await expect(takeReverifyCooldown(jar.cookies, SECRET)).resolves.toBe(0);
  });
});
