-- Adds is_moderator to the users table created by 0001_create_users.sql.
-- Read by the api repo's UsersDatabase.isModerator() — see that repo's
-- src/services/extensions/v2/users-database.ts.

ALTER TABLE users ADD COLUMN is_moderator INTEGER NOT NULL DEFAULT 0;
