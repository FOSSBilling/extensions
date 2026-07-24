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

const SELECT_EXTENSIONS_BY_AUTHOR = `
  ${SELECT_EXTENSIONS_LIST}
  WHERE LOWER(a.id) = LOWER(?)
  ORDER BY e.name
`;

// contact_email is deliberately never selected here — this repo has no
// public-facing query that should return it. Only getAuthorByOwner (below)
// selects it, for prefilling the owner's own self-management form.
const SELECT_AUTHOR_PUBLIC = `
  SELECT id, type, name, url, bio, avatar_url, approved_at FROM authors
`;

type AuthorProfileRow = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  bio?: string | null;
  avatar_url: string | null;
  contact_email?: string | null;
  approved_at: string | null;
};

function parseAuthorProfileRow(row: AuthorProfileRow): AuthorProfile {
  return {
    type: row.type as 'organization' | 'user',
    name: row.name,
    id: row.id.toLowerCase() as Lowercase<string>,
    URL: row.url ?? undefined,
    bio: row.bio ?? undefined,
    avatar_url: row.avatar_url ?? undefined,
    contact_email: row.contact_email ?? undefined,
    approved: row.approved_at !== null,
  } as AuthorProfile;
}

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

// Includes contact_email — this is the owner viewing/editing their own
// profile, not a public read.
export async function getAuthorByOwner(
  db: D1Database,
  userId: string,
): Promise<AuthorProfile | null> {
  let row;
  try {
    row = await db
      .prepare(
        'SELECT id, type, name, url, bio, avatar_url, contact_email, approved_at FROM authors WHERE owner_user_id = ?',
      )
      .bind(userId)
      .first<AuthorProfileRow>();
  } catch {
    return null;
  }
  return row ? parseAuthorProfileRow(row) : null;
}

// Public read for the /developer/[id] page — never selects contact_email.
export async function getAuthorById(
  db: D1Database,
  id: string,
): Promise<AuthorProfile | null> {
  let row;
  try {
    row = await db
      .prepare(`${SELECT_AUTHOR_PUBLIC} WHERE LOWER(id) = LOWER(?)`)
      .bind(id)
      .first<AuthorProfileRow>();
  } catch {
    return null;
  }
  return row ? parseAuthorProfileRow(row) : null;
}

// Public listing for the /developer/[id] page.
export async function getExtensionsByAuthorId(
  db: D1Database,
  authorId: string,
): Promise<Extension[]> {
  let result;
  try {
    result = await db
      .prepare(SELECT_EXTENSIONS_BY_AUTHOR)
      .bind(authorId)
      .all<Record<string, unknown>>();
  } catch {
    return [];
  }
  if (!result.success) return [];
  return result.results.map(parseExtensionRow);
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
