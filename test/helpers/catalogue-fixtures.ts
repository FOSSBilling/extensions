import type { ExtensionListItem } from '@/lib/api/client';

// Full ExtensionListItem fixture: the generated DTO requires every field,
// even though most tests only assert on ids.
export function item(id: string, name = id): ExtensionListItem {
  return {
    id,
    type: 'mod',
    name,
    description: `${name} description`,
    website: `https://example.test/${id}`,
    license: { name: 'MIT' },
    source: { type: 'github', repo: `fossbilling/${id}` },
    version: '1.0.0',
    download_url: `https://example.test/${id}.zip`,
    developer: {
      id: 'fossbilling',
      type: 'organization',
      name: 'FOSSBilling',
      approved: true,
      unclaimed: false,
    },
  };
}

// A paginated API response body for any row type — catalogue items, claim
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
