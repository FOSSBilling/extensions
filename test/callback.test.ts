import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(),
  fetchUserInfo: vi.fn(),
  upsertUser: vi.fn(),
  getDeveloperByOwner: vi.fn(),
  reverifyDeveloper: vi.fn(),
  createSessionCookieValue: vi.fn(),
  setFlash: vi.fn(),
}));

vi.mock('@/lib/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth')>();
  return {
    ...actual,
    exchangeCodeForToken: mocks.exchangeCodeForToken,
    fetchUserInfo: mocks.fetchUserInfo,
  };
});
vi.mock('@/lib/users', () => ({ upsertUser: mocks.upsertUser }));
vi.mock('@/lib/extensions-data', () => ({
  getDeveloperByOwner: mocks.getDeveloperByOwner,
}));
vi.mock('@/lib/api/client', () => ({
  createApiClient: () => ({ reverifyDeveloper: mocks.reverifyDeveloper }),
}));
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return {
    ...actual,
    createSessionCookieValue: mocks.createSessionCookieValue,
  };
});
vi.mock('@/lib/flash', () => ({ setFlash: mocks.setFlash }));

import { createOAuthTransaction, oauthTransactionCookie } from '@/lib/oauth';
import { GET } from '@/pages/auth/callback';
import { makeEnv } from './helpers/env';

const env = makeEnv();

const userInfo = {
  sub: 'user-subject',
  name: 'Test User',
  email: 'user@example.test',
};

async function context(overrides: { redirectTo?: string; url?: string } = {}) {
  const store = new Map<string, string>();
  const url = new URL(
    overrides.url ??
      'https://extensions.example.test/auth/callback?code=code&state=ssssssssssssssssssssss',
  );
  store.set(
    oauthTransactionCookie(url).name,
    await createOAuthTransaction(
      url,
      'v'.repeat(43),
      's'.repeat(22),
      overrides.redirectTo ?? '/',
      env.sessionSecret,
    ),
  );
  const cookies = {
    get: vi.fn((name: string) =>
      store.has(name) ? { value: store.get(name) } : undefined,
    ),
    delete: vi.fn(),
    set: vi.fn(),
  };
  return {
    cookies,
    redirect: vi.fn(
      (path: string) =>
        new Response(null, { status: 302, headers: { location: path } }),
    ),
    url: new URL(
      overrides.url ??
        'https://extensions.example.test/auth/callback?code=code&state=ssssssssssssssssssssss',
    ),
    session: {},
    locals: { env },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForToken.mockResolvedValue({ access_token: 'at' });
  mocks.fetchUserInfo.mockResolvedValue(userInfo);
  mocks.upsertUser.mockResolvedValue({ is_moderator: false });
  mocks.getDeveloperByOwner.mockResolvedValue(null);
  mocks.createSessionCookieValue.mockResolvedValue('session-value');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /auth/callback', () => {
  it.each([
    'legacy',
    'development',
    'unsigned',
    'tampered',
    'expired',
    'other-origin',
  ])('rejects %s transaction injection before exchange', async (attack) => {
    const ctx = await context();
    const valid = await createOAuthTransaction(
      ctx.url,
      'v'.repeat(43),
      's'.repeat(22),
      '/account',
      env.sessionSecret,
    );
    const value =
      attack === 'tampered'
        ? valid.replace(/^./, valid[0] === 'A' ? 'B' : 'A')
        : attack === 'unsigned'
          ? 'attacker-state.attacker-verifier'
          : attack === 'other-origin'
            ? await createOAuthTransaction(
                new URL('https://sibling.example.test'),
                'v'.repeat(43),
                's'.repeat(22),
                '/',
                env.sessionSecret,
              )
            : valid;
    if (attack === 'expired')
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
    vi.mocked(ctx.cookies.get).mockImplementation((name) => {
      if (attack === 'legacy')
        return name === 'fb_oauth_state'
          ? ({ value: 's'.repeat(22) } as never)
          : name === 'fb_oauth_verifier'
            ? ({ value: 'v'.repeat(43) } as never)
            : undefined;
      if (attack === 'development')
        return name === 'fb_oauth_transaction'
          ? ({ value } as never)
          : undefined;
      return { value } as never;
    });
    const result = await GET(ctx);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(mocks.createSessionCookieValue).not.toHaveBeenCalled();
    expect(ctx.cookies.delete).toHaveBeenCalledWith(
      '__Host-fb_oauth_transaction',
      { path: '/', secure: true },
    );
  });

  it('redirects with a flash instead of throwing when session mint fails', async () => {
    mocks.createSessionCookieValue.mockRejectedValue(new Error('bad secret'));
    const ctx = await context();

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(ctx.cookies.set).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[auth/callback] session-mint failed',
      expect.anything(),
    );
  });

  it('redirects with a flash when token exchange fails', async () => {
    mocks.exchangeCodeForToken.mockRejectedValue(new Error('upstream 500'));
    const ctx = await context();

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it('redirects with a flash when identity sync fails', async () => {
    mocks.upsertUser.mockRejectedValue(new Error('api down'));
    const ctx = await context();

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.createSessionCookieValue).not.toHaveBeenCalled();
  });

  it('sets the session and follows a safe redirect on success', async () => {
    const ctx = await context({ redirectTo: '/account' });

    const result = await GET(ctx);

    expect(ctx.cookies.set).toHaveBeenCalledWith(
      'fb_session',
      'session-value',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(result.headers.get('location')).toBe('/account');
  });

  it('mints the moderator flag from the synced account projection', async () => {
    mocks.upsertUser.mockResolvedValue({ is_moderator: true });
    const ctx = await context({ redirectTo: '/account/admin' });

    const result = await GET(ctx);

    expect(mocks.createSessionCookieValue).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-subject', is_moderator: true }),
      'session-secret',
    );
    expect(result.headers.get('location')).toBe('/account/admin');
  });

  it('mints a non-moderator session when the account is not flagged', async () => {
    const ctx = await context({ redirectTo: '/account' });

    const result = await GET(ctx);

    expect(mocks.createSessionCookieValue).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-subject', is_moderator: false }),
      'session-secret',
    );
    expect(result.headers.get('location')).toBe('/account');
  });

  it('rejects a signed transaction with an unsafe redirect target', async () => {
    const ctx = await context({ redirectTo: '//evil.test' });

    const result = await GET(ctx);

    expect(result.headers.get('location')).toBe('/');
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('redirects with a flash when the provider returns an error', async () => {
    const ctx = await context({
      url: 'https://extensions.example.test/auth/callback?error=access_denied&state=ssssssssssssssssssssss',
    });

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects a provider error without valid state', async () => {
    const ctx = await context({
      url: 'https://extensions.example.test/auth/callback?error=access_denied&state=wrong',
    });

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('redirects with a flash on CSRF state mismatch', async () => {
    const ctx = await context({
      url: 'https://extensions.example.test/auth/callback?code=code&state=wrong',
    });

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('still signs in when opportunistic re-verification fails', async () => {
    mocks.getDeveloperByOwner.mockResolvedValue({
      github_verified_at: '2020-01-01T00:00:00Z',
    });
    mocks.reverifyDeveloper.mockRejectedValue(new Error('api down'));
    const ctx = await context({ redirectTo: '/account' });

    const result = await GET(ctx);

    expect(mocks.reverifyDeveloper).toHaveBeenCalledOnce();
    expect(ctx.cookies.set).toHaveBeenCalledWith(
      'fb_session',
      'session-value',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(result.headers.get('location')).toBe('/account');
  });
});
