import { describe, expect, it, vi } from 'vitest';
import {
  getExtensionForSubmission,
  getExtensionsByOwner,
} from '@/lib/database';
import type { SqlDatabase } from '@/lib/runtime';

function mockDatabase({
  first,
  all,
}: {
  first?: Record<string, unknown> | null;
  all?: { success: boolean; results: Record<string, unknown>[] };
}): SqlDatabase {
  const statement = {
    all: vi.fn().mockResolvedValue(all ?? { success: true, results: [] }),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(first ?? null),
  };

  return {
    prepare: vi.fn().mockReturnValue(statement),
  } as unknown as SqlDatabase;
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

describe('SQL domain parsing', () => {
  it('parses valid serialized license and source fields', async () => {
    const extension = await getExtensionForSubmission(
      mockDatabase({ first: validRow }),
      'Example',
    );

    expect(extension?.license).toEqual({ name: 'MIT' });
    expect(extension?.source).toEqual({
      type: 'github',
      repo: 'example/repo',
    });
  });

  it('falls back for malformed JSON fields without asserting the whole row as an API DTO', async () => {
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
    const malformedRow = {
      ...validRow,
      id: 'Malformed',
      type: 'not-a-supported-type',
    };
    const extensions = await getExtensionsByOwner(
      mockDatabase({
        all: { success: true, results: [validRow, malformedRow] },
      }),
      'owner-id',
    );

    expect(extensions).toHaveLength(1);
    expect(extensions[0]?.id).toBe('Example');
    expect(extensions[0]?.name).toBe('Example extension');
  });

  it('keeps rows with empty website and download URLs', async () => {
    const row = { ...validRow, website: '', download_url: '' };

    const extension = await getExtensionForSubmission(
      mockDatabase({ first: row }),
      'Example',
    );
    const extensions = await getExtensionsByOwner(
      mockDatabase({ all: { success: true, results: [row] } }),
      'owner-id',
    );

    expect(extension).toMatchObject({ website: '', download_url: '' });
    expect(extensions).toHaveLength(1);
  });
});
