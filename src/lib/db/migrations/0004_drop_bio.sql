-- Drops the personal-profile bio column added by 0003_add_profile_fields.sql
-- — the feature was removed; display_name is kept.

ALTER TABLE users DROP COLUMN bio;
