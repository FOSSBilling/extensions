import type { UserInfo } from './oauth';

export async function upsertUser(
  db: D1Database,
  info: UserInfo,
): Promise<void> {
  const now = new Date().toISOString();
  const githubLogin =
    info['https://fossbilling.org/claims/github_login'] ?? null;
  const githubOrgs = info['https://fossbilling.org/claims/github_orgs'];
  await db
    .prepare(
      `INSERT INTO users (id, name, email, email_verified, picture, github_login, github_orgs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         email_verified = excluded.email_verified,
         picture = excluded.picture,
         github_login = excluded.github_login,
         github_orgs = excluded.github_orgs,
         updated_at = excluded.updated_at`,
    )
    .bind(
      info.sub,
      info.name ?? null,
      info.email ?? null,
      info.email_verified ? 1 : 0,
      info.picture ?? null,
      githubLogin,
      githubOrgs ? JSON.stringify(githubOrgs) : null,
      now,
      now,
    )
    .run();
}

export async function userExists(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM users WHERE id = ?')
    .bind(userId)
    .first();
  return row !== null;
}

export async function isModerator(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT is_moderator FROM users WHERE id = ?')
    .bind(userId)
    .first<{ is_moderator: number }>();
  return row?.is_moderator === 1;
}

// True once a user's GitHub org memberships have actually been fetched —
// checked via github_orgs, NOT github_login. github_login is set on every
// GitHub sign-in unconditionally, but github_orgs is only written when the
// read:org-scoped org-membership fetch succeeds (see the auth repo's
// persistGithubProfile/fetchActiveOrgLogins) — it stays null if that scope
// was never granted or the fetch failed, which can happen even though
// github_login is already set. Checking github_login here would mark those
// accounts as "linked" and permanently hide the reconnect prompt, leaving
// their developer-profile claims stuck on unverified/manual review with no
// visible way to fix it. An empty (but non-null) github_orgs is a
// legitimate "confirmed zero memberships" and correctly counts as linked.
export async function hasLinkedGithub(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT github_orgs FROM users WHERE id = ?')
    .bind(userId)
    .first<{ github_orgs: string | null }>();
  return row?.github_orgs != null;
}

export async function deleteUser(
  db: D1Database,
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
  db: D1Database,
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
  db: D1Database,
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
