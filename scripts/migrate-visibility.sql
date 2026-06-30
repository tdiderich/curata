-- RBAC migration: rename visibility values for pages and folders
-- Run after prisma db push applies the new schema defaults.
-- Safe to run multiple times (idempotent).

BEGIN;

-- Backfill NULLs to 'org' (pre-RBAC pages had no visibility column)
UPDATE pages SET visibility = 'org' WHERE visibility IS NULL;
UPDATE folders SET visibility = 'org' WHERE visibility IS NULL;

-- Pages: personal → private, shared → org
UPDATE pages SET visibility = 'private' WHERE visibility = 'personal';
UPDATE pages SET visibility = 'org' WHERE visibility = 'shared';

-- Folders: personal → private, shared → org
UPDATE folders SET visibility = 'private' WHERE visibility = 'personal';
UPDATE folders SET visibility = 'org' WHERE visibility = 'shared';

COMMIT;
