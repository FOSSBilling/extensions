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

import { FLASH_COOKIE } from '@/lib/flash';
import { ApiRequestError } from '@/lib/api/client';
import { requireModerator, requireUser } from '@/lib/auth-guard';
import { makeEnv } from './helpers/env';

type TestContext = Parameters<typeof requireUser>[0] & {
  cookies: { delete: ReturnType<typeof vi.fn> };
};

const env = makeEnv();

const account = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  display_name: null,
  is_moderator: false,
  github_linked: false,
  ...overrides,
});

function context() {
  const cookies = { delete: vi.fn() };
  return {
    cookies,
    redirect: vi.fn(
      (path: string) =>
        new Response(null, { status: 302, headers: { location: path } }),
    ),
    rewrite: vi.fn(
      (path: string) =>
        new Response(null, { status: 404, headers: { 'x-rewrite': path } }),
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
  it('redirects an anonymous visitor to login with the original path', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const requestContext = context();

    const result = await requireUser(requestContext, env);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get('location')).toBe(
      `/auth/login?redirect=${encodeURIComponent('/account')}`,
    );
    expect(requestContext.cookies.delete).not.toHaveBeenCalled();
  });

  it('returns the session user with the live account attached', async () => {
    mocks.getUser.mockResolvedValue(account({ is_moderator: true }));
    const requestContext = context();

    const result = await requireUser(requestContext, env);

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({
      sub: 'user-subject',
      name: 'User',
      account: { active: true, is_moderator: true },
    });
    expect(requestContext.redirect).not.toHaveBeenCalled();
  });

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
    mocks.getUser.mockResolvedValue(account({ active: false }));
    const requestContext = context();

    const result = await requireUser(requestContext, env);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    // The flash cookie is not session-scoped, so it goes with the session.
    expect(requestContext.cookies.delete).toHaveBeenCalledWith('fb_session', {
      path: '/',
    });
    expect(requestContext.cookies.delete).toHaveBeenCalledWith(FLASH_COOKIE, {
      path: '/',
    });
    expect(requestContext.redirect).toHaveBeenCalledOnce();
  });

  it('clears the session only when the API confirms the account is missing', async () => {
    mocks.getUser.mockRejectedValue(
      new ApiRequestError(404, 'not_found', 'User not found'),
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

describe('requireModerator', () => {
  it('passes the guarded user through for a moderator', async () => {
    mocks.getUser.mockResolvedValue(account({ is_moderator: true }));
    const requestContext = context();

    const result = await requireModerator(requestContext, env);

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({
      sub: 'user-subject',
      account: { is_moderator: true },
    });
    expect(requestContext.rewrite).not.toHaveBeenCalled();
  });

  it('rewrites to the 404 page for a non-moderator so the admin surface does not appear to exist', async () => {
    mocks.getUser.mockResolvedValue(account({ is_moderator: false }));
    const requestContext = context();

    const result = await requireModerator(requestContext, env);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(requestContext.rewrite).toHaveBeenCalledWith('/404');
  });
});
