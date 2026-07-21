-- Local user/profile table, keyed by the central auth service's `sub`.
-- Identity only comes from auth.fossbilling.net; anything about what a user
-- can *do* here (extension ownership, submitter/moderator status, etc.) is
-- modeled in this app's own tables, referencing users(id).
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY NOT NULL,
  name           TEXT,
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  picture        TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
