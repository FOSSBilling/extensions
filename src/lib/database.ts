// Queries the shared D1 database (extensions_data) directly.
// If the D1 schema changes, update fossbilling/api AND this file.
import {
  type Extension,
  type Author,
  type AuthorProfile,
  type Release,
  type Repository,
} from '@/types';

// Omits readme (large field) — used for index page listings.
const SELECT_EXTENSIONS_LIST = `
  SELECT e.id, e.type, e.author_id,
         a.type AS author_type, a.name AS author_name, a.url AS author_url,
         e.name, e.description, e.website, e.license,
         e.icon_url, e.source, e.version, e.download_url, e.releases
  FROM extensions e
  LEFT JOIN authors a ON e.author_id = a.id
`;

const SELECT_EXTENSIONS_BY_OWNER = `
  ${SELECT_EXTENSIONS_LIST}
  WHERE a.owner_user_id = ?
  ORDER BY e.name
`;

// Includes readme — used for detail pages.
const SELECT_EXTENSION_DETAIL = `
  SELECT e.id, e.type, e.author_id,
         a.type AS author_type, a.name AS author_name, a.url AS author_url,
         e.name, e.description, e.releases, e.website, e.license,
         e.icon_url, e.readme, e.source, e.version, e.download_url
  FROM extensions e
  LEFT JOIN authors a ON e.author_id = a.id
`;

export async function getAllExtensions(db: D1Database): Promise<Extension[]> {
  let result;
  try {
    result = await db
      .prepare(`${SELECT_EXTENSIONS_LIST} ORDER BY e.name`)
      .all<Record<string, unknown>>();
  } catch {
    return [];
  }
  if (!result.success) return [];
  return result.results.map(parseExtensionRow);
}

export async function getExtensionById(
  db: D1Database,
  id: string,
): Promise<Extension | null> {
  let row;
  try {
    row = await db
      .prepare(`${SELECT_EXTENSION_DETAIL} WHERE LOWER(e.id) = LOWER(?)`)
      .bind(id)
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  return row ? parseExtensionRow(row) : null;
}

// Extensions published under an author the given user owns (authors.owner_user_id,
// added by the api repo's v2 migration — see that repo's
// src/services/extensions/v2/db/migrations/0001_add_v2_tables.sql).
export async function getExtensionsByOwner(
  db: D1Database,
  userId: string,
): Promise<Extension[]> {
  let result;
  try {
    result = await db
      .prepare(SELECT_EXTENSIONS_BY_OWNER)
      .bind(userId)
      .all<Record<string, unknown>>();
  } catch {
    return [];
  }
  if (!result.success) return [];
  return result.results.map(parseExtensionRow);
}

export async function getAuthorByOwner(
  db: D1Database,
  userId: string,
): Promise<AuthorProfile | null> {
  let row;
  try {
    row = await db
      .prepare(
        'SELECT id, type, name, url, approved_at FROM authors WHERE owner_user_id = ?',
      )
      .bind(userId)
      .first<{
        id: string;
        type: string;
        name: string;
        url: string | null;
        approved_at: string | null;
      }>();
  } catch {
    return null;
  }
  if (!row) return null;
  return {
    type: row.type as 'organization' | 'user',
    name: row.name,
    id: row.id.toLowerCase() as Lowercase<string>,
    URL: row.url ?? undefined,
    approved: row.approved_at !== null,
  } as AuthorProfile;
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value !== undefined && value !== null ? (value as T) : fallback;
}

function parseExtensionRow(row: Record<string, unknown>): Extension {
  return {
    id: row.id as string,
    type: row.type as Extension['type'],
    name: row.name as string,
    description: row.description as string,
    author: {
      type: (row.author_type as 'organization' | 'user') ?? 'user',
      name: (row.author_name as string) ?? '',
      id: ((row.author_id as string | undefined)?.toLowerCase() ??
        '') as Lowercase<string>,
      URL: typeof row.author_url === 'string' ? row.author_url : undefined,
    } as Author,
    releases: parseJSON<Release[]>(row.releases, []),
    website: row.website as string,
    license: parseJSON(row.license, { name: '' }),
    icon_url: typeof row.icon_url === 'string' ? row.icon_url : undefined,
    readme: (row.readme as string | undefined) ?? '',
    source: parseJSON<Repository>(row.source, { type: 'custom', repo: '' }),
    version: row.version as string,
    download_url: row.download_url as string,
  };
}
