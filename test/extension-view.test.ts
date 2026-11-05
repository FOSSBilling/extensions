import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getOwnDeveloper: vi.fn(),
  getMyExtension: vi.fn(),
  getExtensionById: vi.fn(),
  createApiClient: vi.fn(),
}));
vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  createApiClient: mocks.createApiClient,
  getExtensionById: mocks.getExtensionById,
}));
import { loadExtensionView } from '@/lib/extension-view';
import { ApiRequestError } from '@/lib/api/client';
import { makeEnv } from './helpers/env';
const env = makeEnv();
const user = { sub: 'owner', name: 'Owner', email: 'owner@example.test' };
const published = { id: 'sample', name: 'Published' };
const owned = {
  id: 'sample',
  developer: { id: 'my-profile' },
  published,
  pending_revision: { content: { name: 'Private pending' } },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createApiClient.mockReturnValue(mocks);
  mocks.getOwnDeveloper.mockResolvedValue({ id: 'my-profile' });
  mocks.getMyExtension.mockResolvedValue(owned);
  mocks.getExtensionById.mockResolvedValue(published);
});
describe('permission-aware extension view', () => {
  it('uses only the public read for anonymous visitors', async () => {
    expect(await loadExtensionView(env, 'sample', null)).toEqual({
      kind: 'public',
      extension: published,
    });
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });
  it('enables editing only for the API-verified owner', async () => {
    expect(await loadExtensionView(env, 'sample', user)).toEqual({
      kind: 'owner',
      owned,
      userId: user.sub,
    });
    expect(mocks.createApiClient).toHaveBeenCalledWith(env, user.sub);
    expect(mocks.getExtensionById).not.toHaveBeenCalled();
  });
  it('allows an owner to view a first submission without a public listing', async () => {
    mocks.getMyExtension.mockResolvedValue({ ...owned, published: null });
    expect((await loadExtensionView(env, 'sample', user)).kind).toBe('owner');
    expect(mocks.getExtensionById).not.toHaveBeenCalled();
  });
  it('does not grant editing from a moderator cookie flag', async () => {
    mocks.getOwnDeveloper.mockResolvedValue(null);
    expect(
      await loadExtensionView(env, 'sample', { ...user, is_moderator: true }),
    ).toEqual({ kind: 'public', extension: published });
    expect(mocks.getMyExtension).not.toHaveBeenCalled();
  });
  it('does not mistake a moderator-readable record for an owned extension', async () => {
    mocks.getMyExtension.mockResolvedValue({
      ...owned,
      developer: { id: 'someone-else' },
    });
    expect(await loadExtensionView(env, 'sample', user)).toEqual({
      kind: 'public',
      extension: published,
    });
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
  });
  it('keeps unpublished content inaccessible to unrelated visitors', async () => {
    mocks.getOwnDeveloper.mockResolvedValue(null);
    mocks.getExtensionById.mockRejectedValue(
      new ApiRequestError(404, 'NOT_FOUND', 'Not published'),
    );
    await expect(loadExtensionView(env, 'sample', user)).rejects.toMatchObject({
      status: 404,
    });
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
      expect(mocks.getExtensionById).not.toHaveBeenCalled();
    },
  );
});
