-- Adds is_moderator to a `users` table created before this column existed.
-- Fresh databases don't need this — users.sql already includes the column.
-- Run once against any already-provisioned local or remote database:
--   npx wrangler d1 execute DB_EXTENSIONS --local  --file=./src/lib/db/migrations/0001_add_is_moderator.sql
--   npx wrangler d1 execute DB_EXTENSIONS --remote --file=./src/lib/db/migrations/0001_add_is_moderator.sql
-- Read by the api repo's UsersDatabase.isModerator() — see that repo's
-- src/services/extensions/v2/users-database.ts.

ALTER TABLE users ADD COLUMN is_moderator INTEGER NOT NULL DEFAULT 0;
