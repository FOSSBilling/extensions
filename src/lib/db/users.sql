-- Keyed by the central auth service's `sub`. Ownership, roles, and other
-- authorization concepts belong in this app's own tables, not here.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY NOT NULL,
  name           TEXT,
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  picture        TEXT,
  is_moderator   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
