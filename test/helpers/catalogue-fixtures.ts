import type {
  ExtensionListItem,
  ExtensionListResponse,
} from '@/lib/api/client';

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

export function page(
  result: ExtensionListItem[],
  next_cursor: string | null,
  has_more: boolean,
): ExtensionListResponse {
  return { result, pagination: { next_cursor, has_more } };
}
