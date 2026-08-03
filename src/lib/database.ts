// Queries the shared SQLite-compatible extensions database directly.
// If the D1 schema changes, update fossbilling/api AND this file.
import {
  isDeveloperType,
  isExtensionType,
  isSourceType,
  type DeveloperProfile,
  type Extension,
  type License,
  type PublicDeveloperProfile,
  type Release,
  type Repository,
} from '@/types';
import type { SqlDatabase } from './runtime';

// Omits readme (large field) — used for account-owned extension lists where
// the full detail content is not rendered.
// extensions.author_id is v1's own column, kept as-is by the api repo's
// authors->developers rename (only the table it references was renamed) —
// aliased to developer_id here so nothing downstream depends on that name.
const SELECT_EXTENSIONS_LIST = `
  SELECT e.id, e.type, e.author_id AS developer_id,
         d.type AS developer_type, d.name AS developer_name, d.url AS developer_url,
         d.approved_at AS developer_approved_at,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function sqlBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return undefined;
}

function parseDeveloperProfileRow(
  row: Record<string, unknown>,
): DeveloperProfile | null {
  const id = stringValue(row.id);
  const name = stringValue(row.name);
  const type = stringValue(row.type);
  if (!id || !name || !type || !isDeveloperType(type)) {
    return null;
  }

  return {
    type,
    name,
    id: id.toLowerCase(),
    URL: stringValue(row.url),
    avatar_url: stringValue(row.avatar_url),
    contact_email: stringValue(row.contact_email),
    approved: row.approved_at != null,
    content_revision: numberValue(row.content_revision) ?? 1,
    unclaimed: row.unclaimed === 1,
    github_org_verified: sqlBoolean(row.github_org_verified),
    github_verification_note: stringValue(row.github_verification_note),
    github_verified_at: stringValue(row.github_verified_at),
    github_url_verified: row.github_url_verified === 1 ? true : undefined,
  };
}

// Includes readme and releases — used when an owner edits a submission.
const SELECT_EXTENSION_DETAIL = `
  SELECT e.id, e.type, e.author_id AS developer_id,
         d.type AS developer_type, d.name AS developer_name, d.url AS developer_url,
         d.approved_at AS developer_approved_at,
         e.name, e.description, e.releases, e.website, e.license,
         e.icon_url, e.readme, e.source, e.version, e.download_url
  FROM extensions e
  LEFT JOIN developers d ON e.author_id = d.id
`;

export async function getExtensionForSubmission(
  db: SqlDatabase,
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
  db: SqlDatabase,
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
  return result.results.flatMap((row) => {
    const extension = parseExtensionRow(row);
    return extension ? [extension] : [];
  });
}

// Includes contact_email — this is the owner viewing/editing their own
// profile, not a public read.
export async function getDeveloperByOwner(
  db: SqlDatabase,
  userId: string,
): Promise<DeveloperProfile | null> {
  let row;
  try {
    row = await db
      .prepare(
        'SELECT id, type, name, url, avatar_url, contact_email, approved_at, content_revision, github_org_verified, github_verification_note, github_verified_at, github_url_verified FROM developers WHERE owner_user_id = ?',
      )
      .bind(userId)
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  return row ? parseDeveloperProfileRow(row) : null;
}

// Whether a developer profile has a transfer link that's still usable —
// mirrors the "pending" definition the api repo's acceptTransfer() checks
// (developers-database.ts): not yet accepted, not revoked, not expired.
export async function hasPendingTransfer(
  db: SqlDatabase,
  developerId: string,
): Promise<boolean> {
  let row;
  try {
    row = await db
      .prepare(
        `SELECT 1 FROM developer_transfers
         WHERE developer_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         LIMIT 1`,
      )
      .bind(developerId)
      .first();
  } catch {
    return false;
  }
  return row != null;
}

// Public read for the /developer/[id] page — never selects contact_email.
export async function getDeveloperById(
  db: SqlDatabase,
  id: string,
): Promise<PublicDeveloperProfile | null> {
  let row;
  try {
    row = await db
      .prepare(`${SELECT_DEVELOPER_PUBLIC} WHERE LOWER(id) = LOWER(?)`)
      .bind(id)
      .first<Record<string, unknown>>();
  } catch {
    return null;
  }
  return row ? parseDeveloperProfileRow(row) : null;
}

function parseJSON(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

function parseRelease(value: unknown): Release | null {
  if (!isRecord(value)) return null;

  const tag = stringValue(value.tag);
  const date = stringValue(value.date);
  const downloadUrl = stringValue(value.download_url);
  const minVersion = stringValue(value.min_fossbilling_version);
  if (!tag || !date || !downloadUrl || !minVersion) return null;

  const changelogUrl = stringValue(value.changelog_url);
  return {
    tag,
    date,
    download_url: downloadUrl,
    min_fossbilling_version: minVersion,
    ...(changelogUrl ? { changelog_url: changelogUrl } : {}),
  };
}

function parseReleases(value: unknown): Release[] {
  const parsed = parseJSON(value);
  return Array.isArray(parsed)
    ? parsed.flatMap((release) => {
        const parsedRelease = parseRelease(release);
        return parsedRelease ? [parsedRelease] : [];
      })
    : [];
}

function parseLicense(value: unknown): License {
  const parsed = parseJSON(value);
  if (!isRecord(parsed)) return { name: '' };

  const URL = stringValue(parsed.URL);
  return {
    name: stringValue(parsed.name) ?? '',
    ...(URL ? { URL } : {}),
  };
}

function parseRepository(value: unknown): Repository {
  const parsed = parseJSON(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.type !== 'string' ||
    !isSourceType(parsed.type) ||
    typeof parsed.repo !== 'string'
  ) {
    return { type: 'custom', repo: '' };
  }

  return { type: parsed.type, repo: parsed.repo };
}

function parseExtensionRow(row: Record<string, unknown>): Extension | null {
  const id = stringValue(row.id);
  const type = stringValue(row.type);
  const name = stringValue(row.name);
  const description = stringValue(row.description);
  const website = stringValue(row.website);
  const version = stringValue(row.version);
  const downloadUrl = stringValue(row.download_url);
  if (
    !id ||
    !type ||
    !isExtensionType(type) ||
    !name ||
    !description ||
    website === undefined ||
    !version ||
    downloadUrl === undefined
  ) {
    return null;
  }

  const developerType = stringValue(row.developer_type);

  return {
    id,
    type,
    name,
    description,
    developer: {
      type:
        developerType && isDeveloperType(developerType)
          ? developerType
          : 'user',
      name: stringValue(row.developer_name) ?? '',
      id: stringValue(row.developer_id)?.toLowerCase() ?? '',
      URL: stringValue(row.developer_url),
      approved: row.developer_approved_at != null,
    },
    releases: parseReleases(row.releases),
    website,
    license: parseLicense(row.license),
    icon_url: stringValue(row.icon_url),
    readme: stringValue(row.readme) ?? '',
    source: parseRepository(row.source),
    version,
    download_url: downloadUrl,
  };
}
