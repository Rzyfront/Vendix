-- DATA IMPACT:
-- Tables affected:
--   users            -> email (lower-normalize, guarded), main_store_id (backfill)
--   user_settings    -> app_type (VENDIX_LANDING -> ORG_ADMIN / STORE_ADMIN for staff)
--   user_roles       -> INSERT default 'employee' for role-less staff with a store link
--   store_users      -> INSERT missing membership for main_store; DELETE surplus rows
--                       for non-high-priv staff with >1 store (row-scoped collapse)
-- Expected row changes: proportional to legacy drift; on a clean dataset all steps are no-ops
-- Destructive operations: ONE row-scoped DELETE on store_users (collapse multi-store staff).
--   Keeps the row matching main_store_id, else the most recent (createdAt desc, store_id desc).
--   NO TRUNCATE, NO CASCADE, NO unscoped DELETE/UPDATE.
-- FK/cascade risk: store_users is a leaf join table (no business rows depend on a specific
--   membership id); the collapse only removes redundant memberships, never a user.
-- Idempotency: every step guarded by WHERE / NOT EXISTS / ON CONFLICT DO NOTHING; safe to re-run.
-- Collapse rule: keep main_store_id membership, else most recent (createdAt desc, store_id desc). [CONFIRMED 2026-07-07].
-- Approval: NOT YET APPLIED TO PROD. Requires explicit user approval + prod snapshot + prod dry-run of the collapse DELETE.
--   Validated via BEGIN/ROLLBACK dry-run on dev 2026-07-07: VENDIX_LANDING staff 4->0, main_store-without-membership 3->0,
--   collapse 0 rows (dev has no multi-store non-high-priv staff), 6 irreparable non-high-priv orphans reported.
-- High-privilege roles (multi-store allowed, storeless allowed): owner, admin, super_admin.

-- =====================================================================
-- STEP 1: Normalizar email a minúsculas (solo no-NULL, solo si cambia).
--   Pre-flight: abortar si la normalización fusionaría dos cuentas
--   NO-customer distintas (A1: unicidad de email solo para staff/owner).
-- =====================================================================
DO $$
DECLARE collisions int;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT lower(u.email) le
    FROM users u
    WHERE u.email IS NOT NULL
      AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND lower(r.name) <> 'customer')
    GROUP BY lower(u.email)
    HAVING count(*) > 1
       AND count(*) FILTER (WHERE u.email <> lower(u.email)) > 0
  ) x;
  IF collisions > 0 THEN
    RAISE EXCEPTION 'Abort: lower-normalization would merge % non-customer email collision(s); resolve manually first', collisions;
  END IF;
END $$;

UPDATE users
SET email = lower(email)
WHERE email IS NOT NULL
  AND email <> lower(email);

-- =====================================================================
-- STEP 2: Backfill app_type para staff con VENDIX_LANDING (huérfanos de
--   app_type). Alto privilegio -> ORG_ADMIN; resto del staff -> STORE_ADMIN.
--   Los customers (STORE_ECOMMERCE) NO se tocan.
-- =====================================================================
UPDATE user_settings us
SET app_type = 'ORG_ADMIN'
WHERE us.app_type = 'VENDIX_LANDING'
  AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = us.user_id AND lower(r.name) IN ('owner','admin','super_admin'));

UPDATE user_settings us
SET app_type = 'STORE_ADMIN'
WHERE us.app_type = 'VENDIX_LANDING'
  AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = us.user_id)
  AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = us.user_id AND lower(r.name) IN ('owner','admin','super_admin','customer'));

-- =====================================================================
-- STEP 3: Rol por defecto 'employee' para staff CON vínculo de tienda
--   (main_store o membresía) pero SIN ningún rol asignado.
-- =====================================================================
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, (SELECT id FROM roles WHERE lower(name) = 'employee' LIMIT 1)
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
  AND (u.main_store_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM store_users su WHERE su.user_id = u.id))
ON CONFLICT (user_id, role_id) DO NOTHING;

-- =====================================================================
-- STEP 4: Colapsar staff NO-privilegiado con >1 tienda a una sola.
--   Conserva la membresía = main_store_id si existe; si no, la más reciente.
--   DELETE row-scoped (WHERE por store_id+user_id), sin CASCADE.
-- =====================================================================
DELETE FROM store_users su
USING (
  SELECT ranked.user_id, ranked.store_id, ranked.rn FROM (
    SELECT su2.user_id, su2.store_id,
      row_number() OVER (
        PARTITION BY su2.user_id
        ORDER BY (CASE WHEN su2.store_id = u.main_store_id THEN 0 ELSE 1 END),
                 su2."createdAt" DESC NULLS LAST,
                 su2.store_id DESC
      ) rn
    FROM store_users su2
    JOIN users u ON u.id = su2.user_id
    WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = su2.user_id)
      AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = su2.user_id
                        AND lower(r.name) IN ('owner','admin','super_admin','customer'))
      AND (SELECT count(*) FROM store_users s3 WHERE s3.user_id = su2.user_id) > 1
  ) ranked
  WHERE ranked.rn > 1
) doomed
WHERE su.user_id = doomed.user_id
  AND su.store_id = doomed.store_id;

-- =====================================================================
-- STEP 5: Backfill main_store_id = única membresía, para staff (rol
--   no-customer) que quedó con exactamente una tienda y main_store NULL.
-- =====================================================================
UPDATE users u
SET main_store_id = (SELECT su.store_id FROM store_users su WHERE su.user_id = u.id LIMIT 1)
WHERE u.main_store_id IS NULL
  AND (SELECT count(*) FROM store_users su WHERE su.user_id = u.id) = 1
  AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND lower(r.name) <> 'customer');

-- =====================================================================
-- STEP 6: Crear membresía faltante para usuarios con main_store_id pero
--   sin fila store_users correspondiente (confía en main_store como intención).
-- =====================================================================
INSERT INTO store_users (store_id, user_id)
SELECT u.main_store_id, u.id
FROM users u
WHERE u.main_store_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM store_users su
                  WHERE su.user_id = u.id AND su.store_id = u.main_store_id)
ON CONFLICT (store_id, user_id) DO NOTHING;

-- =====================================================================
-- STEP 7: Reporte de huérfanos irreparables — staff NO-privilegiado, con
--   rol, sin membresía y sin main_store. NO se mutan: requieren asignación
--   manual de tienda (el login A4 los bloquea hasta que se resuelvan).
-- =====================================================================
DO $$
DECLARE rec record; cnt int := 0;
BEGIN
  FOR rec IN
    SELECT u.id, u.email
    FROM users u
    WHERE u.main_store_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM store_users su WHERE su.user_id = u.id)
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                      WHERE ur.user_id = u.id AND lower(r.name) IN ('owner','admin','super_admin','customer'))
    ORDER BY u.id
  LOOP
    RAISE NOTICE 'IRREPARABLE ORPHAN staff user_id=% email=% (needs manual store assignment)', rec.id, rec.email;
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'Total irreparable orphan staff (non-high-priv, no store): %', cnt;
END $$;
