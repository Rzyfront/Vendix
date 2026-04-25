-- DATA IMPACT:
--   Tables affected:
--     * permissions           — duplicate rows collapsed into the lowest-id canonical row
--     * role_permissions      — FKs pointing at non-canonical permissions are re-pointed
--                               at the canonical id (or deleted when that would create
--                               a (role_id, permission_id) pair that already exists)
--   Tables preserved:         all others
--   Expected row changes:     ~12 duplicate `permissions` rows removed (one per shared name)
--                             plus any additional rows sharing (path, method) but not name.
--                             role_permissions is re-pointed, not truncated.
--   Cascade risk:             permissions is referenced by role_permissions via FK.
--                             Handled by re-pointing role_permissions BEFORE deleting.
--                             No CASCADE, no TRUNCATE, no unscoped DELETE.
--   Authorization:            explicitly approved in conversation before drafting.
--   Idempotent:               yes. CTEs with HAVING COUNT(*) > 1 resolve to the empty
--                             set on a clean DB, turning every statement into a no-op.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Collapse duplicates that share the same `name`.
--    The unique index permissions_name_key was reported VALID by pg_index
--    yet the table holds multiple rows with identical `name`. That state can
--    only arise from historical data drift; we repair it deterministically
--    by keeping MIN(id) as canonical and redirecting every FK.
-- ---------------------------------------------------------------------------

-- 1a) Re-point role_permissions to the canonical id where safe.
UPDATE role_permissions rp
SET permission_id = sub.canonical_id
FROM (
  SELECT p.id AS dup_id, c.canonical_id
  FROM permissions p
  JOIN (
    SELECT name, MIN(id) AS canonical_id
    FROM permissions
    GROUP BY name
    HAVING COUNT(*) > 1
  ) c ON c.name = p.name AND p.id <> c.canonical_id
) sub
WHERE rp.permission_id = sub.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = rp.role_id
      AND rp2.permission_id = sub.canonical_id
  );

-- 1b) Drop role_permissions rows that cannot be re-pointed (would violate
--     the (role_id, permission_id) unique key because the canonical grant
--     already exists for that role).
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT p.id
  FROM permissions p
  JOIN (
    SELECT name, MIN(id) AS canonical_id
    FROM permissions
    GROUP BY name
    HAVING COUNT(*) > 1
  ) c ON c.name = p.name AND p.id <> c.canonical_id
);

-- 1c) Delete the duplicate permission rows themselves.
DELETE FROM permissions
WHERE id IN (
  SELECT p.id
  FROM permissions p
  JOIN (
    SELECT name, MIN(id) AS canonical_id
    FROM permissions
    GROUP BY name
    HAVING COUNT(*) > 1
  ) c ON c.name = p.name AND p.id <> c.canonical_id
);

-- ---------------------------------------------------------------------------
-- 2) Collapse duplicates that share (path, method). After step 1 every name
--    is unique, so any remaining duplicates are distinct names that
--    accidentally collide on the (path, method) index. We keep MIN(id) and
--    redirect role assignments, preserving the oldest canonical name.
-- ---------------------------------------------------------------------------

UPDATE role_permissions rp
SET permission_id = sub.canonical_id
FROM (
  SELECT p.id AS dup_id, c.canonical_id
  FROM permissions p
  JOIN (
    SELECT path, method, MIN(id) AS canonical_id
    FROM permissions
    GROUP BY path, method
    HAVING COUNT(*) > 1
  ) c ON c.path = p.path AND c.method = p.method AND p.id <> c.canonical_id
) sub
WHERE rp.permission_id = sub.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = rp.role_id
      AND rp2.permission_id = sub.canonical_id
  );

DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT p.id
  FROM permissions p
  JOIN (
    SELECT path, method, MIN(id) AS canonical_id
    FROM permissions
    GROUP BY path, method
    HAVING COUNT(*) > 1
  ) c ON c.path = p.path AND c.method = p.method AND p.id <> c.canonical_id
);

DELETE FROM permissions
WHERE id IN (
  SELECT p.id
  FROM permissions p
  JOIN (
    SELECT path, method, MIN(id) AS canonical_id
    FROM permissions
    GROUP BY path, method
    HAVING COUNT(*) > 1
  ) c ON c.path = p.path AND c.method = p.method AND p.id <> c.canonical_id
);

-- ---------------------------------------------------------------------------
-- 3) Rebuild the two unique indexes. If the table was clean this is a fast
--    no-op; if the indexes were silently inconsistent it restores integrity.
-- ---------------------------------------------------------------------------
REINDEX INDEX permissions_name_key;
REINDEX INDEX permissions_path_method_key;

COMMIT;
