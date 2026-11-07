import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getOwnDeveloper: vi.fn(),
  getMyExtension: vi.fn(),
  getExtensionByIdentifier: vi.fn(),
  createApiClient: vi.fn(),
}));
vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  createApiClient: mocks.createApiClient,
  getExtensionByIdentifier: mocks.getExtensionByIdentifier,
}));
import { loadExtensionView } from '@/lib/extension-view';
import { ApiRequestError } from '@/lib/api/client';
import { makeEnv } from './helpers/env';
const env = makeEnv();
const user = { sub: 'owner', name: 'Owner', email: 'owner@example.test' };
const published = {
  id: '019a0000-0000-7000-8000-000000000001',
  identifier: 'sample',
  name: 'Published',
};
const owned = {
  id: published.id,
  identifier: 'sample',
  developer: {
    id: '019a0000-0000-7000-8000-000000000002',
    identifier: 'my-profile',
  },
  published,
  pending_revision: { content: { name: 'Private pending' } },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createApiClient.mockReturnValue(mocks);
  mocks.getOwnDeveloper.mockResolvedValue({
    id: owned.developer.id,
    identifier: 'my-profile',
  });
  mocks.getMyExtension.mockResolvedValue(owned);
  mocks.getExtensionByIdentifier.mockResolvedValue(published);
});
describe('permission-aware extension view', () => {
  it('uses only the public read for anonymous visitors', async () => {
    expect(await loadExtensionView(env, 'sample', null)).toEqual({
      kind: 'public',
      extension: published,
    });
    expect(mocks.getExtensionByIdentifier).toHaveBeenCalledWith(env, 'sample');
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });
  it('enables editing only for the API-verified owner', async () => {
    expect(await loadExtensionView(env, 'sample', user)).toEqual({
      kind: 'owner',
      owned,
      userId: user.sub,
    });
    expect(mocks.createApiClient).toHaveBeenCalledWith(env, user.sub);
    expect(mocks.getMyExtension).toHaveBeenCalledWith('sample');
    expect(mocks.getExtensionByIdentifier).not.toHaveBeenCalled();
  });
  it('allows an owner to view a first submission without a public listing', async () => {
    mocks.getMyExtension.mockResolvedValue({ ...owned, published: null });
    expect((await loadExtensionView(env, 'sample', user)).kind).toBe('owner');
    expect(mocks.getExtensionByIdentifier).not.toHaveBeenCalled();
  });
  it('does not grant editing from a moderator cookie flag', async () => {
    mocks.getOwnDeveloper.mockResolvedValue(null);
    expect(
      await loadExtensionView(env, 'sample', { ...user, is_moderator: true }),
    ).toEqual({ kind: 'public', extension: published });
    expect(mocks.getExtensionByIdentifier).toHaveBeenCalledWith(env, 'sample');
    expect(mocks.getMyExtension).not.toHaveBeenCalled();
  });
  it('does not grant editing when a profile identifier has been reused', async () => {
    // The profile can be deleted and its identifier reused between the two
    // API reads. A moderator can then read the replacement's extension.
    mocks.getMyExtension.mockResolvedValue({
      ...owned,
      developer: {
        id: '019a0000-0000-7000-8000-000000000003',
        identifier: 'my-profile',
      },
    });
    expect(await loadExtensionView(env, 'sample', user)).toEqual({
      kind: 'public',
      extension: published,
    });
    expect(mocks.getExtensionByIdentifier).toHaveBeenCalledWith(env, 'sample');
  });
  it.each([403, 404])(
    'falls back to public content when the account/profile is unavailable (%s)',
    async (status) => {
      mocks.getOwnDeveloper.mockRejectedValue(
        new ApiRequestError(status, 'FORBIDDEN', 'Unavailable'),
      );
      expect((await loadExtensionView(env, 'sample', user)).kind).toBe(
        'public',
      );
      expect(mocks.getExtensionByIdentifier).toHaveBeenCalledWith(
        env,
        'sample',
      );
    },
  );
  it('falls back to public content for another developer’s extension', async () => {
    mocks.getMyExtension.mockRejectedValue(
      new ApiRequestError(404, 'NOT_FOUND', 'Not owned'),
    );
    expect(await loadExtensionView(env, 'sample', user)).toEqual({
      kind: 'public',
      extension: published,
    });
    expect(mocks.getExtensionByIdentifier).toHaveBeenCalledWith(env, 'sample');
  });
  it('keeps unpublished content inaccessible to unrelated visitors', async () => {
    mocks.getOwnDeveloper.mockResolvedValue(null);
    mocks.getExtensionByIdentifier.mockRejectedValue(
      new ApiRequestError(404, 'NOT_FOUND', 'Not published'),
    );
    await expect(loadExtensionView(env, 'sample', user)).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.getExtensionByIdentifier).toHaveBeenCalledWith(env, 'sample');
  });
  it.each(['getOwnDeveloper', 'getMyExtension'] as const)(
    'keeps %s outages retryable rather than hiding owner controls',
    async (method) => {
      mocks[method].mockRejectedValue(
        new ApiRequestError(503, 'SERVICE_UNAVAILABLE', 'Offline'),
      );
      await expect(
        loadExtensionView(env, 'sample', user),
      ).rejects.toMatchObject({ status: 503 });
      expect(mocks.getExtensionByIdentifier).not.toHaveBeenCalled();
    },
  );
});
