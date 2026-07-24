-- Adds display_name/bio to a `users` table created before these columns
-- existed. Fresh databases don't need this — users.sql already includes them.
-- Run once against any already-provisioned local or remote database:
--   npx wrangler d1 execute DB_EXTENSIONS --local  --file=./src/lib/db/migrations/0002_add_profile_fields.sql
--   npx wrangler d1 execute DB_EXTENSIONS --remote --file=./src/lib/db/migrations/0002_add_profile_fields.sql

ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
