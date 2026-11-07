import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createApiClient: vi.fn(),
  getDeveloperByIdentifier: vi.fn(),
}));

// paginateAll stays real: the adapters under test route their whole-list
// walks through it, and only the facade boundary is mocked out.
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  createApiClient: mocks.createApiClient,
  getDeveloperByIdentifier: mocks.getDeveloperByIdentifier,
}));

import {
  getDeveloperByIdentifier,
  getDeveloperByOwner,
  getExtensionsByOwner,
  getOwnedExtension,
  toOwnedExtensionDetail,
} from '@/lib/extensions-data';
import { makeEnv } from './helpers/env';

const env = makeEnv();

const developer = {
  id: '019a0000-0000-7000-8000-000000000001',
  identifier: 'developer',
  type: 'organization' as const,
  name: 'Example developer',
  approved: true,
  unclaimed: false,
};

beforeEach(() => {
  mocks.createApiClient.mockReset();
  mocks.getDeveloperByIdentifier.mockReset();
});

describe('API-backed extension data adapters', () => {
  it('treats a failed or unauthorized owner detail read as a missing resource', async () => {
    mocks.createApiClient.mockReturnValue({
      getMyExtension: vi.fn().mockRejectedValue(new Error('API unavailable')),
    });

    await expect(
      getOwnedExtension(env, 'user-subject', 'example'),
    ).resolves.toBe(null);
  });

  it('splits the owner detail response into published/pendingRevision/lastReview', async () => {
    mocks.createApiClient.mockReturnValue({
      getMyExtension: vi.fn().mockResolvedValue({
        id: '019a0000-0000-7000-8000-000000000002',
        identifier: 'example',
        developer,
        published: {
          manifest_version: 1 as const,
          author: { name: 'Package Author' },
          requires: {
            fossbilling: '^0.8.9 || ^1.0',
            php: '>=8.3 <9',
            modules: { branding: '^1.2' },
          },
          type: 'module',
          name: 'Example',
          description: 'desc',
          releases: [],
          homepage_url: 'https://example.test',
          license: 'MIT',
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

    const detail = await getOwnedExtension(env, 'user-subject', 'example');

    expect(detail).toMatchObject({
      id: '019a0000-0000-7000-8000-000000000002',
      identifier: 'example',
      developer: { id: developer.id, identifier: developer.identifier },
      published: {
        id: '019a0000-0000-7000-8000-000000000002',
        identifier: 'example',
      },
    });
    expect(detail?.published?.name).toBe('Example');
    expect(detail?.published?.author).toEqual({ name: 'Package Author' });
    expect(detail?.published?.requires).toEqual({
      fossbilling: '^0.8.9 || ^1.0',
      php: '>=8.3 <9',
      modules: { branding: '^1.2' },
    });
    expect(detail?.published?.homepage_url).toBe('https://example.test');
    expect(detail?.published?.license).toBe('MIT');
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

  it('maps either detail view to the same shape, delisted state included', () => {
    const detail = toOwnedExtensionDetail({
      id: '019a0000-0000-7000-8000-000000000002',
      identifier: 'example',
      developer,
      published: {
        manifest_version: 1 as const,
        author: { name: 'Package Author' },
        requires: {
          fossbilling: '^0.8.9 || ^1.0',
          php: '>=8.3 <9',
          modules: { branding: '^1.2' },
        },
        type: 'module',
        name: 'Example',
        description: 'desc',
        releases: [],
        homepage_url: 'https://example.test',
        license: 'MIT',
        readme: '# Example',
        source: { type: 'github', repo: 'fossbilling/example' },
        version: '1.0.0',
        download_url: 'https://example.test/example.zip',
      },
      pending_revision: null,
      last_review: null,
      delisted: { reason: 'gone', at: '2026-02-01T00:00:00Z' },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    });

    expect(detail.published?.name).toBe('Example');
    expect(detail.delisted).toEqual({
      reason: 'gone',
      at: '2026-02-01T00:00:00Z',
    });
  });

  it('treats failed public developer reads as missing profiles', async () => {
    mocks.getDeveloperByIdentifier.mockRejectedValue(
      new Error('API unavailable'),
    );

    await expect(
      getDeveloperByIdentifier(env, 'developer-id'),
    ).resolves.toBeNull();
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
