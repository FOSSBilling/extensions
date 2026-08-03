import { describe, expect, it, vi } from 'vitest';
import {
  getExtensionForSubmission,
  getExtensionsByOwner,
} from '@/lib/database';

function mockDatabase({
  first,
  all,
}: {
  first?: Record<string, unknown> | null;
  all?: { success: boolean; results: Record<string, unknown>[] };
}): D1Database {
  const statement = {
    all: vi.fn().mockResolvedValue(all ?? { success: true, results: [] }),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(first ?? null),
  };

  return {
    prepare: vi.fn().mockReturnValue(statement),
  } as unknown as D1Database;
}

const validRow = {
  id: 'Example',
  type: 'mod',
  name: 'Example extension',
  description: 'An example extension.',
  website: 'https://example.test',
  version: '1.0.0',
  download_url: 'https://example.test/download.zip',
  developer_id: 'Developer',
  developer_type: 'organization',
  developer_name: 'Example developer',
  developer_url: null,
  developer_approved_at: '2026-01-01T00:00:00Z',
  releases: JSON.stringify([
    {
      tag: '1.0.0',
      date: '2026-01-01T00:00:00Z',
      download_url: 'https://example.test/download.zip',
      min_fossbilling_version: '0.6.0',
    },
  ]),
  license: JSON.stringify({ name: 'MIT' }),
  source: JSON.stringify({ type: 'github', repo: 'example/repo' }),
  icon_url: null,
  readme: '# Example',
};

describe('D1 domain parsing', () => {
  it('parses supported JSON fields without asserting the whole row as an API DTO', async () => {
    const extension = await getExtensionForSubmission(
      mockDatabase({
        first: {
          ...validRow,
          releases: JSON.stringify([
            ...JSON.parse(String(validRow.releases)),
            { malformed: true },
          ]),
          license: '{invalid json',
          source: JSON.stringify({ type: 'unknown', repo: 'ignored' }),
        },
      }),
      'Example',
    );

    expect(extension).toMatchObject({
      id: 'Example',
      releases: [
        {
          tag: '1.0.0',
          min_fossbilling_version: '0.6.0',
        },
      ],
      license: { name: '' },
      source: { type: 'custom', repo: '' },
    });
  });

  it('skips malformed extension rows instead of returning invalid domain objects', async () => {
    const malformedRow = { ...validRow, type: 'not-a-supported-type' };
    const extensions = await getExtensionsByOwner(
      mockDatabase({
        all: { success: true, results: [validRow, malformedRow] },
      }),
      'owner-id',
    );

    expect(extensions).toHaveLength(1);
    expect(extensions[0]?.id).toBe('Example');
  });
});
