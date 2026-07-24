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
