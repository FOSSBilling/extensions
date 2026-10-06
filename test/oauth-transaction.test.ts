import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/pages/auth/login';
import { readOAuthTransaction, oauthTransactionCookie } from '@/lib/oauth';

describe('OAuth login transaction', () => {
  it.each(['https://extensions.example.test', 'http://localhost:4321'])(
    'preserves login on %s',
    async (origin) => {
      const url = new URL('/auth/login?redirect=%2Faccount', origin);
      const cookies = { set: vi.fn(), delete: vi.fn() };
      const ctx = {
        url,
        cookies,
        locals: { env: { sessionSecret: 'secret', authClientId: 'client' } },
        redirect: (location: string) =>
          new Response(null, { status: 302, headers: { location } }),
      } as unknown as Parameters<typeof GET>[0];
      const response = await GET(ctx);
      const [name, value, options] = cookies.set.mock.calls[0];
      expect(name).toBe(
        origin.startsWith('https:')
          ? '__Host-fb_oauth_transaction'
          : 'fb_oauth_transaction',
      );
      expect(options).toEqual({
        httpOnly: true,
        secure: origin.startsWith('https:'),
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      });
      expect(options).not.toHaveProperty('domain');
      const transaction = await readOAuthTransaction(value, url, 'secret');
      const authorize = new URL(response.headers.get('location')!);
      expect(transaction?.state).toBe(authorize.searchParams.get('state'));
      expect(transaction?.redirect).toBe('/account');
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(transaction!.verifier),
      );
      expect(Buffer.from(digest).toString('base64url')).toBe(
        authorize.searchParams.get('code_challenge'),
      );
      expect(await readOAuthTransaction(value, url, 'wrong-secret')).toBeNull();
    },
  );
  it('stores an unsafe redirect as the root path fallback', async () => {
    // The write-side open-redirect guard: ?redirect=//evil.test must never
    // enter the signed transaction — the callback would bounce the user
    // off-site after a successful login.
    const url = new URL(
      '/auth/login?redirect=%2F%2Fevil.test',
      'https://extensions.example.test',
    );
    const cookies = { set: vi.fn(), delete: vi.fn() };
    const ctx = {
      url,
      cookies,
      locals: { env: { sessionSecret: 'secret', authClientId: 'client' } },
      redirect: (location: string) =>
        new Response(null, { status: 302, headers: { location } }),
    } as unknown as Parameters<typeof GET>[0];
    await GET(ctx);

    const [name, value] = cookies.set.mock.calls[0];
    const transaction = await readOAuthTransaction(value, url, 'secret');
    expect(name).toBe('__Host-fb_oauth_transaction');
    expect(transaction?.redirect).toBe('/');
  });
  it('warns when the transaction cookie will be refused on plain HTTP', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = new URL(
      '/auth/login?redirect=%2Faccount',
      'http://192.168.1.20:4321',
    );
    const cookies = { set: vi.fn(), delete: vi.fn() };
    const ctx = {
      url,
      cookies,
      locals: { env: { sessionSecret: 'secret', authClientId: 'client' } },
      redirect: (location: string) =>
        new Response(null, { status: 302, headers: { location } }),
    } as unknown as Parameters<typeof GET>[0];
    await GET(ctx);
    expect(cookies.set.mock.calls[0][0]).toBe('__Host-fb_oauth_transaction');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
  it('never permits an unprefixed transaction on non-loopback HTTP', () => {
    expect(
      oauthTransactionCookie(new URL('http://extensions.example.test')).options
        .secure,
    ).toBe(true);
    expect(
      oauthTransactionCookie(new URL('http://extensions.example.test')).name,
    ).toBe('__Host-fb_oauth_transaction');
  });
});
