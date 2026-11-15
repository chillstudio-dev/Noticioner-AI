-- Preserve existing care-team capabilities; new grants default to least privilege.
ALTER TABLE care_relationships ADD COLUMN access_level text NOT NULL DEFAULT 'edit'
  CHECK (access_level IN ('view','edit'));
ALTER TABLE care_relationships ALTER COLUMN access_level SET DEFAULT 'view';
INSERT INTO practice_migrations(version) VALUES(3);
