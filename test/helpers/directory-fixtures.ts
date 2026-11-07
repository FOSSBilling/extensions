import { createHash } from 'node:crypto';
import type { ExtensionListItem } from '@/lib/api/client';

// Keep record UUIDs distinct from public identifiers in API fixtures.
export function item(identifier: string, name = identifier): ExtensionListItem {
  const suffix = createHash('sha256')
    .update(identifier.toLowerCase())
    .digest('hex')
    .slice(0, 12);
  return {
    id: `019a0000-0000-7000-8000-${suffix}`,
    identifier,
    manifest_version: 1 as const,
    author: { name: 'Package Author' },
    type: 'module',
    name,
    description: `${name} description`,
    homepage_url: `https://example.test/${identifier}`,
    license: 'MIT',
    source: { type: 'github', repo: `fossbilling/${identifier}` },
    version: '1.0.0',
    download_url: `https://example.test/${identifier}.zip`,
    developer: {
      id: '019a0000-0000-7000-8000-000000000001',
      identifier: 'fossbilling',
      type: 'organization',
      name: 'FOSSBilling',
      approved: true,
      unclaimed: false,
    },
  };
}

// A paginated API response body for any row type — directory items, claim
// rows, history entries — shaped like the generated Pagination envelope.
export function page<T>(
  result: T[],
  next_cursor: string | null,
  has_more: boolean,
): {
  result: T[];
  pagination: { next_cursor: string | null; has_more: boolean };
} {
  return { result, pagination: { next_cursor, has_more } };
}
