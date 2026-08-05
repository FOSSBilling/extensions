import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'fb_session',
  getSessionUser: mocks.getSessionUser,
}));
vi.mock('@/lib/users', () => ({ getUser: mocks.getUser }));

import { ApiRequestError } from '@/lib/api/client';
import { requireUser } from '@/lib/auth-guard';
import type { ApplicationEnv } from '@/lib/runtime';

type TestContext = Parameters<typeof requireUser>[0] & {
  cookies: { delete: ReturnType<typeof vi.fn> };
};

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

function context() {
  const cookies = { delete: vi.fn() };
  return {
    cookies,
    redirect: vi.fn(
      (path: string) =>
        new Response(null, { status: 302, headers: { location: path } }),
    ),
    url: new URL('https://extensions.example.test/account'),
  } as unknown as TestContext;
}

beforeEach(() => {
  mocks.getSessionUser.mockResolvedValue({
    sub: 'user-subject',
    name: 'User',
    email: 'user@example.test',
  });
  mocks.getUser.mockReset();
});

describe('requireUser', () => {
  it.each([401, 429])(
    'keeps the session for a transient or auth-related %s response',
    async (status) => {
      mocks.getUser.mockRejectedValue(
        new ApiRequestError(status, 'request_failed', 'Request failed'),
      );
      const requestContext = context();

      const result = await requireUser(requestContext, env);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(503);
      expect(requestContext.cookies.delete).not.toHaveBeenCalled();
      expect(requestContext.redirect).not.toHaveBeenCalled();
    },
  );

  it('clears the session when the API reports an inactive account', async () => {
    mocks.getUser.mockResolvedValue({
      active: false,
      display_name: null,
      is_moderator: false,
      github_linked: false,
    });
    const requestContext = context();

    const result = await requireUser(requestContext, env);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect(requestContext.cookies.delete).toHaveBeenCalledWith('fb_session', {
      path: '/',
    });
    expect(requestContext.redirect).toHaveBeenCalledOnce();
  });

  it('clears the session only when the API confirms the account is missing', async () => {
    mocks.getUser.mockRejectedValue(
      new ApiRequestError(404, 'NOT_FOUND', 'User not found'),
    );
    const requestContext = context();

    const result = await requireUser(requestContext, env);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect(requestContext.cookies.delete).toHaveBeenCalledWith('fb_session', {
      path: '/',
    });
    expect(requestContext.redirect).toHaveBeenCalledOnce();
  });
});
