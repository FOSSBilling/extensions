import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createApiClient: vi.fn(),
  getDeveloperById: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  createApiClient: mocks.createApiClient,
  getDeveloperById: mocks.getDeveloperById,
}));

import {
  getDeveloperById,
  getDeveloperByOwner,
  getExtensionsByOwner,
  getOwnedExtension,
} from '@/lib/extensions-data';
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

const developer = {
  id: 'developer',
  type: 'organization' as const,
  name: 'Example developer',
  approved: true,
  unclaimed: false,
};

beforeEach(() => {
  mocks.createApiClient.mockReset();
  mocks.getDeveloperById.mockReset();
});

describe('API-backed extension data adapters', () => {
  it('treats a failed or unauthorized owner detail read as a missing resource', async () => {
    mocks.createApiClient.mockReturnValue({
      getMyExtension: vi.fn().mockRejectedValue(new Error('API unavailable')),
    });

    await expect(
      getOwnedExtension(env, 'user-subject', 'extension-id'),
    ).resolves.toBe(null);
  });

  it('splits the owner detail response into published/pendingRevision/lastReview', async () => {
    mocks.createApiClient.mockReturnValue({
      getMyExtension: vi.fn().mockResolvedValue({
        id: 'extension-id',
        developer,
        published: {
          type: 'mod',
          name: 'Example',
          description: 'desc',
          releases: [],
          website: 'https://example.test',
          license: { name: 'MIT' },
          readme: '# Example',
          source: { type: 'github', repo: 'fossbilling/example' },
          version: '1.0.0',
          download_url: 'https://example.test/example.zip',
        },
        pending_revision: {
          id: 'revision-1',
          created_at: '2026-01-01T00:00:00Z',
          content: { name: 'Example (edited)' },
        },
        last_review: {
          revision_id: 'revision-0',
          status: 'approved',
          review_note: null,
          reviewed_at: '2025-12-01T00:00:00Z',
        },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    });

    const detail = await getOwnedExtension(env, 'user-subject', 'extension-id');

    expect(detail?.published?.name).toBe('Example');
    expect(detail?.pendingRevision).toEqual({
      id: 'revision-1',
      createdAt: '2026-01-01T00:00:00Z',
      content: { name: 'Example (edited)' },
    });
    expect(detail?.lastReview).toEqual({
      revisionId: 'revision-0',
      status: 'approved',
      reviewNote: null,
      reviewedAt: '2025-12-01T00:00:00Z',
    });
  });

  it('treats failed public developer reads as missing profiles', async () => {
    mocks.getDeveloperById.mockRejectedValue(new Error('API unavailable'));

    await expect(getDeveloperById(env, 'developer-id')).resolves.toBeNull();
  });

  it('keeps owner pages usable when the API cannot load the profile or list', async () => {
    mocks.createApiClient.mockReturnValue({
      getOwnDeveloper: vi.fn().mockRejectedValue(new Error('API unavailable')),
      listMyExtensions: vi.fn().mockRejectedValue(new Error('API unavailable')),
    });

    await expect(getDeveloperByOwner(env, 'user-subject')).resolves.toBeNull();
    await expect(getExtensionsByOwner(env, 'user-subject')).resolves.toEqual(
      [],
    );
  });

  it('can preserve owner API failures for pages that render an error state', async () => {
    const error = new Error('API unavailable');
    mocks.createApiClient.mockReturnValue({
      getOwnDeveloper: vi.fn().mockRejectedValue(error),
      listMyExtensions: vi.fn().mockRejectedValue(error),
    });

    await expect(
      getDeveloperByOwner(env, 'user-subject', { failSoft: false }),
    ).rejects.toBe(error);
    await expect(
      getExtensionsByOwner(env, 'user-subject', { failSoft: false }),
    ).rejects.toBe(error);
  });
});
