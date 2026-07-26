-- Adds a personal display_name/bio profile to the users table, separate
-- from the name/email/picture synced from the auth provider (see upsertUser
-- in src/lib/users.ts) and from any developer/publisher identity (the
-- `developers` table, owned by the api repo).

ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
