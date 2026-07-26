// Queries the shared D1 database (extensions_data) directly.
// If the D1 schema changes, update fossbilling/api AND this file.
import {
  type Extension,
  type Developer,
  type DeveloperProfile,
  type PublicDeveloperProfile,
  type Release,
  type Repository,
} from '@/types';

// Omits readme (large field) — used for index page listings.
// extensions.author_id is v1's own column, kept as-is by the api repo's
// authors->developers rename (only the table it references was renamed) —
// aliased to developer_id here so nothing downstream depends on that name.
const SELECT_EXTENSIONS_LIST = `
  SELECT e.id, e.type, e.author_id AS developer_id,
         d.type AS developer_type, d.name AS developer_name, d.url AS developer_url,
         e.name, e.description, e.website, e.license,
         e.icon_url, e.source, e.version, e.download_url, e.releases
  FROM extensions e
  LEFT JOIN developers d ON e.author_id = d.id
`;

const SELECT_EXTENSIONS_BY_OWNER = `
  ${SELECT_EXTENSIONS_LIST}
  WHERE d.owner_user_id = ?
  ORDER BY e.name
`;

const SELECT_EXTENSIONS_BY_DEVELOPER = `
  ${SELECT_EXTENSIONS_LIST}
  WHERE LOWER(d.id) = LOWER(?)
  ORDER BY e.name
`;

// contact_email is deliberately never selected here — this repo has no
// public-facing query that should return it. Only getDeveloperByOwner
// (below) selects it, for prefilling the owner's own self-management form.
// unclaimed is derived, never the raw owner_user_id — exposing the actual
// owner's sub would leak another user's identifier publicly.
const SELECT_DEVELOPER_PUBLIC = `
  SELECT id, type, name, url, avatar_url, approved_at,
         (owner_user_id IS NULL) AS unclaimed
  FROM developers
`;

type DeveloperProfileRow = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  avatar_url: string | null;
  contact_email?: string | null;
  approved_at: string | null;
  unclaimed?: number;
  // Not selected by SELECT_DEVELOPER_PUBLIC — getDeveloperById's return type
  // omits content_revision, so the fallback below is never exposed there.
  content_revision?: number;
};

function parseDeveloperProfileRow(row: DeveloperProfileRow): DeveloperProfile {
  return {
    type: row.type as 'organization' | 'user',
    name: row.name,
    id: row.id.toLowerCase() as Lowercase<string>,
    URL: row.url ?? undefined,
    avatar_url: row.avatar_url ?? undefined,
    contact_email: row.contact_email ?? undefined,
    approved: row.approved_at !== null,
    content_revision: row.content_revision ?? 1,
    unclaimed: row.unclaimed === 1,
  } as DeveloperProfile;
}

// Includes readme — used for detail pages.
const SELECT_EXTENSION_DETAIL = `
  SELECT e.id, e.type, e.author_id AS developer_id,
         d.type AS developer_type, d.name AS developer_name, d.url AS developer_url,
         e.name, e.description, e.releases, e.website, e.license,
         e.icon_url, e.readme, e.source, e.version, e.download_url
  FROM extensions e
  LEFT JOIN developers d ON e.author_id = d.id
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

// Extensions published under a developer the given user owns
// (developers.owner_user_id, added by the api repo's v2 migration — see
// that repo's src/services/extensions/v2/db/migrations/0001_add_v2_tables.sql).
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
export async function getDeveloperByOwner(
  db: D1Database,
  userId: string,
): Promise<DeveloperProfile | null> {
  let row;
  try {
    row = await db
      .prepare(
        'SELECT id, type, name, url, avatar_url, contact_email, approved_at, content_revision FROM developers WHERE owner_user_id = ?',
      )
      .bind(userId)
      .first<DeveloperProfileRow>();
  } catch {
    return null;
  }
  return row ? parseDeveloperProfileRow(row) : null;
}

// Public read for the /developer/[id] page — never selects contact_email.
export async function getDeveloperById(
  db: D1Database,
  id: string,
): Promise<PublicDeveloperProfile | null> {
  let row;
  try {
    row = await db
      .prepare(`${SELECT_DEVELOPER_PUBLIC} WHERE LOWER(id) = LOWER(?)`)
      .bind(id)
      .first<DeveloperProfileRow>();
  } catch {
    return null;
  }
  return row ? parseDeveloperProfileRow(row) : null;
}

// Public listing for the /developer/[id] page.
export async function getExtensionsByDeveloperId(
  db: D1Database,
  developerId: string,
): Promise<Extension[]> {
  let result;
  try {
    result = await db
      .prepare(SELECT_EXTENSIONS_BY_DEVELOPER)
      .bind(developerId)
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
    developer: {
      type: (row.developer_type as 'organization' | 'user') ?? 'user',
      name: (row.developer_name as string) ?? '',
      id: ((row.developer_id as string | undefined)?.toLowerCase() ??
        '') as Lowercase<string>,
      URL:
        typeof row.developer_url === 'string' ? row.developer_url : undefined,
    } as Developer,
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
