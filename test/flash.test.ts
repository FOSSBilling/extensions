import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLASH_COOKIE, setFlash, takeFlash } from '@/lib/flash';
import { fakeCookies } from './helpers/fake-cookies';

const SECRET = 'flash-test-secret';
const MESSAGE = {
  category: 'success' as const,
  title: 'Profile Updated.',
  description: 'Changes are live.',
};

function flashContext(secure = true) {
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

afterEach(() => {
  vi.useRealTimers();
});

describe('setFlash', () => {
  it('stores a signed cookie with one-shot lifetime attributes', async () => {
    const { jar, context } = flashContext();

    await setFlash(context, SECRET, MESSAGE);

    expect(jar.set).toHaveBeenCalledOnce();
    const [, value, options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 120,
    });
  });

  it('omits the secure attribute on plaintext local development', async () => {
    const { jar, context } = flashContext(false);

    await setFlash(context, SECRET, MESSAGE);

    const [, , options] = jar.set.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(options.secure).toBe(false);
  });
});

describe('takeFlash', () => {
  it('round-trips a set flash and clears the cookie', async () => {
    const { jar, context } = flashContext();
    await setFlash(context, SECRET, MESSAGE);

    const message = await takeFlash(jar.cookies, SECRET);

    expect(message).toEqual(MESSAGE);
    expect(jar.delete).toHaveBeenCalledWith(FLASH_COOKIE, { path: '/' });
    expect(jar.get(FLASH_COOKIE)).toBeUndefined();
  });

  it('returns undefined when no flash cookie is present', async () => {
    const { jar } = flashContext();
    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
    expect(jar.delete).not.toHaveBeenCalled();
  });

  it('drops flashes signed with a different secret', async () => {
    const { jar, context } = flashContext();
    await setFlash(context, 'other-secret', MESSAGE);

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
  });

  it('drops tampered payloads', async () => {
    const { jar, context } = flashContext();
    await setFlash(context, SECRET, MESSAGE);
    const [payloadB64] = jar.get(FLASH_COOKIE)!.value.split('.');
    jar.set(FLASH_COOKIE, `${payloadB64}.tampered-signature`);

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
  });

  it('drops expired flashes', async () => {
    const { jar, context } = flashContext();
    await setFlash(context, SECRET, MESSAGE);
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z').getTime() + 121_000);

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
  });

  it('drops malformed cookie values without throwing', async () => {
    const { jar } = flashContext();
    jar.set(FLASH_COOKIE, 'not-a-signed-flash');

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
    expect(jar.delete).toHaveBeenCalled();
  });

  it('round-trips a flash with an action link', async () => {
    const { jar, context } = flashContext();
    const withAction = {
      ...MESSAGE,
      action: { label: 'Reconnect GitHub', href: 'https://auth.example.test/' },
    };
    await setFlash(context, SECRET, withAction);

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toEqual(withAction);
  });

  // The action shape check guards two distinct things: cross-cookie payload
  // replay (every signed cookie shares this key, so a foreign payload must
  // fail the shape check) and server bugs — setFlash is typed, so a
  // malformed action can only enter a validly-signed cookie through one of
  // those. Two representative cases cover the branch; the well-signed
  // invalid-shape test below isolates it from signature failure.
  it.each([
    ['non-object action', 'reconnect'],
    ['over-long href', { label: 'Reconnect', href: `/${'x'.repeat(2048)}` }],
  ])('drops flashes with a malformed action (%s)', async (_name, action) => {
    const { jar, context } = flashContext();
    await setFlash(context, SECRET, {
      ...MESSAGE,
      action: action as unknown as { label: string; href: string },
    });

    // setFlash stores anything; the read-time shape check rejects it, so a
    // malformed action can never render as a link (or throw when read).
    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
  });

  it('drops flashes whose category is not one of the known ones', async () => {
    const { jar, context } = flashContext();
    await setFlash(context, SECRET, {
      ...MESSAGE,
      category: 'urgent' as unknown as 'success',
    });

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
  });

  it('drops well-signed payloads with an invalid shape', async () => {
    const { jar, context } = flashContext();
    await setFlash(context, SECRET, MESSAGE);
    const forged = btoa(
      JSON.stringify({ message: { title: 42 }, exp: 9999999999 }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    // Re-sign the forged payload so only the shape check can reject it.
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(forged),
    );
    jar.set(
      FLASH_COOKIE,
      `${forged}.${btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')}`,
    );

    await expect(takeFlash(jar.cookies, SECRET)).resolves.toBeUndefined();
  });
});
