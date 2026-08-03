import type { UserInfo } from './oauth';
import type { SqlDatabase } from './runtime';

const GITHUB_ORGS_EXPIRES_AT_CLAIM =
  'https://fossbilling.org/claims/github_orgs_expires_at' as const;
const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function parseRfc3339Timestamp(value: string): number | null {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match || match[0] !== value) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (day > daysInMonth) return null;

  if (match[7] !== 'Z') {
    const offset = /[+-](\d{2}):(\d{2})/.exec(match[7]);
    if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) {
      return null;
    }
  }

  // Date.parse normalizes invalid components, so only call it after the
  // RFC3339 fields and calendar date have been checked above.
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isFutureGithubOrgsExpiry(
  value: unknown,
  now = Date.now(),
): value is string {
  if (typeof value !== 'string') return false;
  const expiresAt = parseRfc3339Timestamp(value);
  return expiresAt !== null && expiresAt > now;
}

function isGithubOrgList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((org) => typeof org === 'string');
}

export async function upsertUser(
  db: SqlDatabase,
  info: UserInfo,
): Promise<void> {
  const now = new Date().toISOString();
  const githubLogin =
    info['https://fossbilling.org/claims/github_login'] ?? null;
  const githubOrgs = info['https://fossbilling.org/claims/github_orgs'];
  const githubOrgsExpiresAt = info[GITHUB_ORGS_EXPIRES_AT_CLAIM];
  const hasFreshGithubOrgs =
    isGithubOrgList(githubOrgs) &&
    isFutureGithubOrgsExpiry(githubOrgsExpiresAt);
  await db
    .prepare(
      `INSERT INTO users (id, name, email, email_verified, picture, github_login, github_orgs, github_orgs_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         email_verified = excluded.email_verified,
         picture = excluded.picture,
         github_login = excluded.github_login,
         github_orgs = excluded.github_orgs,
         github_orgs_expires_at = excluded.github_orgs_expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      info.sub,
      info.name ?? null,
      info.email ?? null,
      info.email_verified ? 1 : 0,
      info.picture ?? null,
      githubLogin,
      hasFreshGithubOrgs ? JSON.stringify(githubOrgs) : null,
      hasFreshGithubOrgs ? githubOrgsExpiresAt : null,
      now,
      now,
    )
    .run();
}

export async function userExists(
  db: SqlDatabase,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM users WHERE id = ?')
    .bind(userId)
    .first();
  return row !== null;
}

export async function isModerator(
  db: SqlDatabase,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT is_moderator FROM users WHERE id = ?')
    .bind(userId)
    .first<{ is_moderator: number }>();
  return row?.is_moderator === 1;
}

// True while a user's GitHub org memberships have actually been fetched and
// the central auth service's absolute expiry is still in the future — checked
// via github_orgs + github_orgs_expires_at, NOT github_login. github_login is
// set on every GitHub sign-in unconditionally, but github_orgs is only written
// when the read:org-scoped org-membership fetch succeeds. Missing or expired
// evidence must keep the reconnect prompt visible. An empty (but non-null)
// github_orgs with a future expiry is a legitimate "confirmed zero
// memberships" and counts as linked.
export async function hasLinkedGithub(
  db: SqlDatabase,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT github_orgs, github_orgs_expires_at FROM users WHERE id = ?',
    )
    .bind(userId)
    .first<{
      github_orgs: string | null;
      github_orgs_expires_at: string | null;
    }>();
  if (
    !row?.github_orgs ||
    !isFutureGithubOrgsExpiry(row.github_orgs_expires_at)
  ) {
    return false;
  }
  try {
    return isGithubOrgList(JSON.parse(row.github_orgs));
  } catch {
    return false;
  }
}

export async function deleteUser(
  db: SqlDatabase,
  userId: string,
): Promise<void> {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
}

export type UserProfile = {
  display_name: string | null;
};

// display_name is a personal profile, separate from the name/email/
// picture synced from the auth provider on every login (upsertUser above
// never touches it) and separate from any developer/publisher identity.
export async function getUserProfile(
  db: SqlDatabase,
  userId: string,
): Promise<UserProfile> {
  const row = await db
    .prepare('SELECT display_name FROM users WHERE id = ?')
    .bind(userId)
    .first<UserProfile>();
  return row ?? { display_name: null };
}

// Callback.ts deliberately doesn't fail sign-in if upsertUser fails (a
// transient write error shouldn't block signing in), which can leave a
// signed-in user with no `users` row. Without the row, an UPDATE here
// would silently affect zero rows — this would report success while saving
// nothing. Ensure the row exists first so the UPDATE always lands.
export async function updateUserProfile(
  db: SqlDatabase,
  userId: string,
  profile: UserProfile,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(userId, now, now)
    .run();

  await db
    .prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
    .bind(profile.display_name, now, userId)
    .run();
}
