-- Keyed by the central auth service's `sub`. Ownership, roles, and other
-- authorization concepts belong in this app's own tables, not here.
-- display_name/bio are a user-editable personal profile, distinct from the
-- name/email/picture synced from the auth provider on every login (see
-- upsertUser in src/lib/users.ts, which never touches these two columns) and
-- distinct from any developer/publisher identity (the `authors` table, owned
-- by the api repo). Not shown publicly yet; intended for future comments/
-- ratings attribution.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY NOT NULL,
  name           TEXT,
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  picture        TEXT,
  is_moderator   INTEGER NOT NULL DEFAULT 0,
  display_name   TEXT,
  bio            TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
