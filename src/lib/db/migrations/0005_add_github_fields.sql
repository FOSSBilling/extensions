-- Linked GitHub identity, synced from the auth service's custom OIDC claims
-- on every login (see auth/callback.ts). github_orgs is a JSON-encoded array
-- of lowercase org logins. Both null until a user completes a GitHub login
-- after the auth service started requesting the read:org scope. Read by the
-- api repo (same DB_EXTENSIONS binding) to verify developer profile claims —
-- see the api repo's developers-database.ts claim().

ALTER TABLE users ADD COLUMN github_login TEXT;
ALTER TABLE users ADD COLUMN github_orgs TEXT;
