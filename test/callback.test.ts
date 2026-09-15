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

import { GET } from '@/pages/auth/callback';
import type { ApplicationEnv } from '@/lib/runtime';

const env: ApplicationEnv = {
  extensionsApi: {
    baseUrl: 'https://api.example.test',
    fetch: (...args) => globalThis.fetch(...args),
  },
  authClientId: 'client-id',
  authClientSecret: 'client-secret',
  sessionSecret: 'session-secret',
  assertionSigningSecret: 'assertion-secret',
};

const userInfo = {
  sub: 'user-subject',
  name: 'Test User',
  email: 'user@example.test',
};

function context(overrides: { redirectTo?: string; url?: string } = {}) {
  const store = new Map<string, string>();
  store.set('fb_oauth_verifier', 'verifier');
  store.set('fb_oauth_state', 'state');
  if (overrides.redirectTo !== undefined) {
    store.set('fb_oauth_redirect', overrides.redirectTo);
  }
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
        'https://extensions.example.test/auth/callback?code=code&state=state',
    ),
    session: {},
    locals: { env },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForToken.mockResolvedValue({ access_token: 'at' });
  mocks.fetchUserInfo.mockResolvedValue(userInfo);
  mocks.upsertUser.mockResolvedValue(undefined);
  mocks.getDeveloperByOwner.mockResolvedValue(null);
  mocks.createSessionCookieValue.mockResolvedValue('session-value');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /auth/callback', () => {
  it('redirects with a flash instead of throwing when session mint fails', async () => {
    mocks.createSessionCookieValue.mockRejectedValue(new Error('bad secret'));
    const ctx = context();

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
    const ctx = context();

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it('redirects with a flash when identity sync fails', async () => {
    mocks.upsertUser.mockRejectedValue(new Error('api down'));
    const ctx = context();

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.createSessionCookieValue).not.toHaveBeenCalled();
  });

  it('sets the session and follows a safe redirect on success', async () => {
    const ctx = context({ redirectTo: '/account' });

    const result = await GET(ctx);

    expect(ctx.cookies.set).toHaveBeenCalledWith(
      'fb_session',
      'session-value',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(result.headers.get('location')).toBe('/account');
  });

  it('falls back to / for an unsafe redirect target', async () => {
    const ctx = context({ redirectTo: '//evil.test' });

    const result = await GET(ctx);

    expect(result.headers.get('location')).toBe('/');
  });

  it('redirects with a flash when the provider returns an error', async () => {
    const ctx = context({
      url: 'https://extensions.example.test/auth/callback?error=access_denied',
    });

    const result = await GET(ctx);

    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/');
    expect(mocks.setFlash).toHaveBeenCalledOnce();
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('redirects with a flash on CSRF state mismatch', async () => {
    const ctx = context({
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
    const ctx = context({ redirectTo: '/account' });

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
