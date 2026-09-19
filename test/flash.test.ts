import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AstroCookies } from 'astro';
import { FLASH_COOKIE, setFlash, takeFlash } from '@/lib/flash';

const SECRET = 'flash-test-secret';
const MESSAGE = {
  category: 'success' as const,
  title: 'Profile Updated.',
  description: 'Changes are live.',
};

function fakeCookies() {
  const jar = new Map<string, string>();
  const set = vi.fn(
    (name: string, value: string, _options?: Record<string, unknown>) => {
      jar.set(name, value);
    },
  );
  const remove = vi.fn((name: string) => jar.delete(name));
  const get = vi.fn((name: string) => {
    const value = jar.get(name);
    return value === undefined ? undefined : { value };
  });
  return {
    jar,
    set,
    delete: remove,
    get,
    cookies: { get, set, delete: remove } as unknown as AstroCookies,
  };
}

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
