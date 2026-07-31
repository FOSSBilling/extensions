-- Absolute expiry for the central auth service's github_orgs claim. A missing
-- or past value means the local copy is no longer valid organization evidence.
ALTER TABLE users ADD COLUMN github_orgs_expires_at TEXT;
