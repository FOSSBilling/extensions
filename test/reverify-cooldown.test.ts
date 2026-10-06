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

describe('setReverifyCooldown', () => {
  it('stores a signed cookie whose payload expires in one minute', async () => {
    const { jar, context } = cooldownContext();

    await setReverifyCooldown(context, SECRET);

    expect(jar.set).toHaveBeenCalledOnce();
    const [, value, options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    const [payloadB64] = value.split('.');
    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(payload.until).toBe(
      new Date('2026-09-19T12:00:00Z').getTime() + 60_000,
    );
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
});

describe('takeReverifyCooldown', () => {
  it('round-trips the cooldown timestamp without clearing the cookie', async () => {
    const { jar, context } = cooldownContext();
    await setReverifyCooldown(context, SECRET);

    const until = await takeReverifyCooldown(jar.cookies, SECRET);

    expect(until).toBe(new Date('2026-09-19T12:00:00Z').getTime() + 60_000);
    // Unlike flash, the cookie must survive the read so repeated retries
    // stay rate limited until it lapses on its own.
    expect(jar.delete).not.toHaveBeenCalled();
    expect(jar.get(REVERIFY_COOLDOWN_COOKIE)).toBeDefined();
  });

  it('returns 0 when no cooldown cookie is present', async () => {
    const { jar } = cooldownContext();
    await expect(takeReverifyCooldown(jar.cookies, SECRET)).resolves.toBe(0);
  });

  it('returns 0 for tampered or wrong-secret cookies', async () => {
    const { jar, context } = cooldownContext();
    await setReverifyCooldown(context, SECRET);
    const [payloadB64] = jar.get(REVERIFY_COOLDOWN_COOKIE)!.value.split('.');

    jar.set(REVERIFY_COOLDOWN_COOKIE, `${payloadB64}.tampered`);
    await expect(takeReverifyCooldown(jar.cookies, SECRET)).resolves.toBe(0);
    await expect(
      takeReverifyCooldown(jar.cookies, 'other-secret'),
    ).resolves.toBe(0);
  });

  it('returns 0 for malformed cookie values', async () => {
    const { jar } = cooldownContext();
    jar.set(REVERIFY_COOLDOWN_COOKIE, 'garbage');

    await expect(takeReverifyCooldown(jar.cookies, SECRET)).resolves.toBe(0);
  });
});
