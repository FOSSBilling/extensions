import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createApiClient: vi.fn(),
  syncIdentity: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  createApiClient: mocks.createApiClient,
}));

import { upsertUser } from '@/lib/users';
import type { UserInfo } from '@/lib/oauth';
import type { ApplicationEnv } from '@/lib/runtime';

const env: ApplicationEnv = {
  extensionsApiBaseUrl: 'https://api.example.test',
  authClientId: 'client-id',
  authClientSecret: 'client-secret',
  sessionSecret: 'session-secret',
  assertionSigningSecret: 'assertion-secret',
};

const baseInfo: UserInfo = {
  sub: 'user-subject',
  name: 'Test User',
  email: 'user@example.test',
  email_verified: true,
  picture: 'https://example.test/user.png',
  'https://fossbilling.org/claims/github_login': 'test-user',
};

const futureExpiry = '2099-01-01T00:00:00Z';
const orgsClaim = 'https://fossbilling.org/claims/github_orgs' as const;
const expiryClaim =
  'https://fossbilling.org/claims/github_orgs_expires_at' as const;

beforeEach(() => {
  mocks.syncIdentity.mockReset();
  mocks.createApiClient.mockReturnValue({ syncIdentity: mocks.syncIdentity });
});

describe('upsertUser', () => {
  it('synchronizes valid, future GitHub organization evidence', async () => {
    const info: UserInfo = {
      ...baseInfo,
      [orgsClaim]: ['fossbilling'],
      [expiryClaim]: futureExpiry,
    };

    await upsertUser(env, info);

    expect(mocks.createApiClient).toHaveBeenCalledWith(env, baseInfo.sub);
    expect(mocks.syncIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        github_login: 'test-user',
        github_orgs: ['fossbilling'],
        github_orgs_expires_at: futureExpiry,
      }),
    );
  });

  it.each([
    ['an expired expiry', '2020-01-01T00:00:00Z', ['fossbilling']],
    ['a malformed expiry', 'not-a-timestamp', ['fossbilling']],
    ['a malformed organization list', futureExpiry, ['fossbilling', 42]],
    ['a non-array organization list', futureExpiry, 'fossbilling'],
  ])(
    'clears both evidence fields for %s',
    async (_description, expiry, orgs) => {
      const info = {
        ...baseInfo,
        [orgsClaim]: orgs,
        [expiryClaim]: expiry,
      } as unknown as UserInfo;

      await upsertUser(env, info);

      expect(mocks.syncIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          github_login: 'test-user',
          github_orgs: null,
          github_orgs_expires_at: null,
        }),
      );
    },
  );
});
