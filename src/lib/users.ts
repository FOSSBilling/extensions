import type { UserInfo } from './oauth';

export async function upsertUser(
  db: D1Database,
  info: UserInfo,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, name, email, email_verified, picture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         email_verified = excluded.email_verified,
         picture = excluded.picture,
         updated_at = excluded.updated_at`,
    )
    .bind(
      info.sub,
      info.name ?? null,
      info.email ?? null,
      info.email_verified ? 1 : 0,
      info.picture ?? null,
      now,
      now,
    )
    .run();
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

export type UserProfile = {
  display_name: string | null;
  bio: string | null;
};

// display_name/bio are a personal profile, separate from the name/email/
// picture synced from the auth provider on every login (upsertUser above
// never touches them) and separate from any developer/publisher identity.
export async function getUserProfile(
  db: D1Database,
  userId: string,
): Promise<UserProfile> {
  const row = await db
    .prepare('SELECT display_name, bio FROM users WHERE id = ?')
    .bind(userId)
    .first<UserProfile>();
  return row ?? { display_name: null, bio: null };
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  profile: UserProfile,
): Promise<void> {
  await db
    .prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?')
    .bind(profile.display_name, profile.bio, userId)
    .run();
}
